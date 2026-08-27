/**
 * Live connectivity and mapping check against the StubHub POS API.
 *
 *   node scripts/stubhub-smoke.mjs
 *
 * Reads only. Never writes, regardless of STUBHUB_DRY_RUN — the write path is
 * exercised by building a payload and printing it, which is the part worth
 * inspecting before anything is sent for real.
 *
 * Needs no database, so it can be run before the app is wired up and is the
 * fastest way to answer "is the token good and does our mapping produce
 * something StubHub would accept?"
 */

import fs from 'node:fs';
import { StubHubClient, StubHubError } from '../lib/stubhub/client.ts';
import { mapRow } from '../lib/stubhub/mapRow.ts';
import { comparePriceEcho } from '../lib/stubhub/price.ts';
import { payloadHash } from '../lib/stubhub/hash.ts';

// .env.local is Next's file, not Node's. Parse it directly, tolerating the
// leading whitespace and inline comments that accumulate in a hand-edited file.
function loadEnvLocal(path = '.env.local') {
  if (!fs.existsSync(path)) return {};
  const out = {};
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    // Strip surrounding quotes the way dotenv does. Without this a quoted token
    // is sent as `Bearer "eyJ..."` and every call comes back 401, which looks
    // exactly like a bad credential.
    const value = trimmed.slice(eq + 1).trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
    out[trimmed.slice(0, eq).trim()] = value;
  }
  return out;
}

const env = { ...loadEnvLocal(), ...process.env };
const client = new StubHubClient({
  baseUrl: env.STUBHUB_BASE_URL || 'https://pointofsaleapi.stubhub.net',
  bearerToken: env.STUBHUB_BEARER_TOKEN || '',
  accountId: env.STUBHUB_ACCOUNT_ID || '',
  dryRun: true,
  timeoutMs: 30_000,
  maxRetries: 2,
});

const ok = (m) => console.log(`  \x1b[32m✔\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✖\x1b[0m ${m}`);
let failures = 0;

async function step(name, fn) {
  try {
    const detail = await fn();
    ok(`${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    failures++;
    bad(`${name} — ${error instanceof StubHubError ? error.summary : String(error)}`);
  }
}

console.log('\nStubHub POS smoke test\n');

if (!client.configured) {
  bad('STUBHUB_BEARER_TOKEN / STUBHUB_ACCOUNT_ID not set');
  process.exit(1);
}
console.log(`  host    ${client.config.baseUrl}`);
console.log(`  account ${client.config.accountId}\n`);

await step('health', async () => {
  const r = await client.request({ method: 'GET', path: '/healthcheck/simple', endpoint: 'DEFAULT', idempotent: true });
  return r.data?.status ?? `HTTP ${r.status}`;
});

await step('auth — GET /accounts', async () => {
  const r = await client.request({ method: 'GET', path: '/accounts', endpoint: 'GET /accounts', idempotent: true });
  const a = (r.data ?? [])[0];
  if (!a) throw new Error('no account returned — token may be valid but unscoped');
  return a.sellerAccountName;
});

await step('event resolution — GET /events?eventId=159262123', async () => {
  const r = await client.request({ method: 'GET', path: '/events?eventId=159262123', endpoint: 'GET /events', idempotent: true });
  const e = r.data?.event;
  if (!e) throw new Error('event not found');
  return `${e.name} @ ${e.venue}`;
});

let sample = null;
await step('inventory export — GET /inventory/export', async () => {
  const r = await client.request({
    method: 'GET',
    path: '/inventory/export?pageSize=5&includePastEvents=true',
    endpoint: 'GET /inventory/export/all',
    idempotent: true,
  });
  const items = r.data?.inventory ?? [];
  sample = items.find((i) => i.listingPricesByMarketplace?.length) ?? items[0] ?? null;
  return `${r.data?.numberOfItems ?? 0} listing(s) on the account`;
});

await step('webhook topics — GET /webhooks/topics', async () => {
  const r = await client.request({ method: 'GET', path: '/webhooks/topics', endpoint: 'DEFAULT', idempotent: true });
  return `${(r.data ?? []).length} topics`;
});

// Which marketplaces this account is actually enabled for. ReachPro appears in
// the ApiMarketplace enum but nowhere else in the spec, so an echo from a real
// listing is the only evidence available without asking StubHub.
await step('marketplaces visible on a live listing', async () => {
  if (!sample) return 'no listings to inspect';
  const names = (sample.listingStatusByMarketplace ?? []).map((s) => s.marketplaceName);
  return names.length ? names.join(', ') : 'none reported';
});

// Prove the price field assumption against a real listing rather than the docs.
await step('price echo (ASK_PRICE_FIELD assumption)', async () => {
  if (!sample?.listingPricesByMarketplace?.length) return 'no priced listing to check';
  const theirs = sample.listingPricesByMarketplace.find((p) => p.marketplaceName === 'StubHub');
  if (!theirs?.listPrice) return 'no StubHub price on the sample';
  const echo = comparePriceEcho(theirs.listPrice, sample);
  if (!echo.match) throw new Error(echo.detail);
  return echo.detail;
});

// The write path, built but not sent.
console.log('\n  payload our mapper would send for a representative row:\n');
const mapped = mapRow({
  inventory_id: 2540402267,
  event_id: '159262123',
  quantity: 4,
  section: 'Courtside 103',
  row: 'D',
  seats: '3,4,5,6',
  public_notes: 'xfer, Seated Together',
  internal_notes: '-tnow -tmplus -geek',
  tags: 'RESALE BROKER',
  list_price: 688.56,
  face_price: 393,
  taxed_cost: 529.66,
  cost: 529.66,
  hide_seats: 'Y',
  in_hand_date: '2026-08-24',
  split_type: 'CUSTOM',
  custom_split: '2,4',
  stock_type: 'MOBILE_TRANSFER',
  zone: 'N',
});

if (!mapped.ok) {
  failures++;
  bad(`mapper rejected the sample row: ${mapped.reason} ${mapped.detail}`);
} else {
  const indent = (o) => JSON.stringify(o, null, 2).split('\n').map((l) => '    ' + l).join('\n');
  console.log('  POST /inventory');
  console.log(indent(mapped.create));
  console.log('\n  PATCH /inventory/{id}');
  console.log(indent(mapped.update));
  console.log(`\n  payload hash ${payloadHash([mapped.create, mapped.update]).slice(0, 16)}…`);
  if (mapped.warnings.length) {
    console.log('  warnings:');
    for (const w of mapped.warnings) console.log(`    · ${w}`);
  }
}

console.log(
  failures === 0
    ? '\n\x1b[32mall checks passed\x1b[0m — reads work, mapping produces a well-formed payload\n'
    : `\n\x1b[31m${failures} check(s) failed\x1b[0m\n`
);
process.exit(failures === 0 ? 0 : 1);
