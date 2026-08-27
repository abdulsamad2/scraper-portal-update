/**
 * Prove a scraper-side change reaches StubHub.
 *
 *   node scripts/stubhub-test-change.mjs                    # change price, verify, revert
 *   node scripts/stubhub-test-change.mjs --field quantity   # see the note below first
 *   node scripts/stubhub-test-change.mjs --keep          # leave the change in place
 *   node scripts/stubhub-test-change.mjs --row <id>      # target a specific inventoryId
 *
 * ── What this actually tests ───────────────────────────────────────────────────
 *
 * The whole point of the outbox is that the scraper never calls a marketplace.
 * It writes the row and stamps it, in one write; the portal notices and does the
 * rest. So the honest way to test the pipeline is to do precisely what the
 * scraper does — change a field and set the two outbox fields, nothing else —
 * and then watch StubHub, without touching the sync worker at all.
 *
 * Concretely this reproduces helpers/inventoryPlan.js patchFields():
 *
 *     "inventory.<field>":        <new value>
 *     "inventory.syncState":      "dirty"
 *     "inventory.syncPendingSince": now
 *
 * Nothing else is written and no portal code is called directly. If the value
 * shows up on StubHub, every link in the chain worked: the outbox index found
 * the row, the worker claimed it, the exporter recomputed the payload including
 * both markup stages, the hash gate decided it genuinely differed, the write was
 * sent, and the read-back confirmed it.
 *
 * ── Reading the result ─────────────────────────────────────────────────────────
 *
 * A PASS means the value changed on StubHub. A timeout does not necessarily mean
 * a bug — the worker may simply be stopped — so the script checks that first and
 * says so rather than reporting a failure it cannot substantiate.
 *
 * ── --field quantity does not test what it looks like ──────────────────────────
 *
 * This script simulates the scraper by patching a row in place, which is right
 * for every field the marketplace can update. Quantity is not one of them.
 * StubHub's InventoryUpdateRequest has a `quantity`, but the spec restricts it to
 * placeholder (SeatSaver) listings behind a feature we do not have, so a PATCH
 * leaves the count untouched on an ordinary seated listing.
 *
 * The scraper therefore treats a quantity change as a delete-and-recreate, the
 * same as a seat change. Patching quantity here does not reproduce that, so the
 * mode is kept only for demonstrating the constraint — it is expected to report
 * NO CHANGE, and that is the API's behaviour rather than a fault in the pipeline.
 */

import fs from 'node:fs';
import mongoose from 'mongoose';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const has = name => args.includes(`--${name}`);

const FIELD = flag('field', 'price');
const KEEP = has('keep');
const TARGET_ROW = flag('row', null);
const TIMEOUT_MS = Number(flag('timeout', 180)) * 1000;

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^(['"])([\s\S]*)\1$/, '$2')];
    })
);

const API = 'https://pointofsaleapi.stubhub.net';
const headers = {
  Authorization: `Bearer ${env.STUBHUB_BEARER_TOKEN}`,
  'Account-Id': env.STUBHUB_ACCOUNT_ID,
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Read one listing straight from StubHub. */
async function readListing(listingId) {
  const res = await fetch(`${API}/inventory/seek?inventoryIds=${listingId}`, { headers });
  if (!res.ok) throw new Error(`seek returned ${res.status}`);
  const body = await res.json();
  const items = Array.isArray(body) ? body : body?.data ?? [];
  const flat = items.flatMap(i => (Array.isArray(i?.data) ? i.data : [i]));
  const listing = flat.find(l => Number(l?.id) === Number(listingId));
  if (!listing) return null;
  const price = (listing.listingPricesByMarketplace ?? [])
    .find(p => p.marketplaceName === 'StubHub')?.listPrice ?? null;
  // availableQuantity is what the API actually calls it — confirmed against a
  // live seek response. maxDisplayQuantity is the separate "show at most N" cap.
  return {
    quantity: listing.availableQuantity ?? null,
    maxDisplay: listing.maxDisplayQuantity ?? null,
    price,
    raw: listing,
  };
}

await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
const groups = mongoose.connection.db.collection('consecutivegroups');
const settings = await mongoose.connection.db.collection('stubhubsyncsettings').findOne({});

console.log('');
if (!settings?.isRunning) {
  console.log('  NOTE: the sync worker is recorded as stopped. Start it from the dashboard,');
  console.log('        or this test will time out through no fault of the pipeline.\n');
}
if (settings?.dryRun) {
  console.log('  NOTE: dry run is on. Nothing will be written to StubHub.\n');
}

// A settled row, so the starting point is unambiguous.
const query = TARGET_ROW
  ? { 'inventory.inventoryId': Number(TARGET_ROW) }
  : { 'inventory.syncState': 'synced', 'inventory.stubhubListingId': { $exists: true, $ne: null } };

const row = await groups.findOne(query);
if (!row?.inventory?.stubhubListingId) {
  console.log('  No synced row with a StubHub listing found. Let the worker create some first.\n');
  await mongoose.disconnect();
  process.exit(1);
}

const inv = row.inventory;
const listingId = inv.stubhubListingId;

console.log(`  row        inventoryId ${inv.inventoryId}  ${row.section} / ${row.row}`);
console.log(`  listing    ${listingId}`);

const before = await readListing(listingId);
if (!before) {
  console.log('  That listing does not exist on StubHub — the local record is stale.\n');
  await mongoose.disconnect();
  process.exit(1);
}

// The change, chosen so it cannot collide with the current value.
const oldValue = FIELD === 'price' ? inv.listPrice : inv.quantity;
const newValue = FIELD === 'price'
  ? Math.round((Number(oldValue) + 7.77) * 100) / 100
  : Math.max(1, Number(oldValue) === 2 ? 3 : 2);

console.log(`  change     inventory.${FIELD}: ${oldValue} -> ${newValue}`);
console.log(`  StubHub before: quantity ${before.quantity}, price ${before.price}`);

// Exactly what the scraper writes: the field, and the outbox stamp. Nothing else.
await groups.updateOne(
  { _id: row._id },
  {
    $set: {
      [`inventory.${FIELD === 'price' ? 'listPrice' : FIELD}`]: newValue,
      'inventory.syncState': 'dirty',
      'inventory.syncPendingSince': new Date(),
    },
  }
);
console.log('  stamped as dirty — the portal has not been told anything else\n');

const started = Date.now();
let settled = null;

while (Date.now() - started < TIMEOUT_MS) {
  await sleep(5000);
  const now = await groups.findOne({ _id: row._id }, { projection: { inventory: 1 } });
  const state = now?.inventory?.syncState;
  const after = await readListing(listingId);
  const elapsed = Math.round((Date.now() - started) / 1000);

  const observed = FIELD === 'price' ? after?.price : after?.quantity;
  console.log(`  +${String(elapsed).padStart(3)}s  syncState=${String(state).padEnd(9)} StubHub ${FIELD}=${observed}`);

  const changedOnStubHub = FIELD === 'price'
    ? after?.price != null && Math.abs(after.price - before.price) > 0.005
    : after?.quantity != null && after.quantity !== before.quantity;

  if (state === 'synced' && changedOnStubHub) {
    settled = { after, elapsed };
    break;
  }
  if (state === 'failed') {
    console.log(`\n  FAILED — ${now?.inventory?.syncError ?? 'no reason recorded'}\n`);
    break;
  }
}

console.log('');
if (settled) {
  console.log(`  PASS — the change reached StubHub in ${settled.elapsed}s`);
  console.log(`    quantity ${before.quantity} -> ${settled.after.quantity}`);
  console.log(`    price    ${before.price} -> ${settled.after.price}`);
  console.log('');
  console.log('  Every link worked: outbox stamp, claim, export (both markup stages),');
  console.log('  hash gate, write, and read-back confirmation.');
} else {
  console.log('  NO CHANGE OBSERVED within the timeout.');
  console.log('  Check: is the worker running, is dry run off, and does the dashboard show failures?');
}

if (!KEEP) {
  await groups.updateOne(
    { _id: row._id },
    {
      $set: {
        [`inventory.${FIELD === 'price' ? 'listPrice' : FIELD}`]: oldValue,
        'inventory.syncState': 'dirty',
        'inventory.syncPendingSince': new Date(),
      },
    }
  );
  console.log(`\n  reverted to ${oldValue} and re-queued; the worker will restore StubHub shortly.`);
} else {
  console.log('\n  --keep given: the change was left in place.');
}

console.log('');
await mongoose.disconnect();
