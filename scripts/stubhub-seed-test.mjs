/**
 * Seed (or remove) a small, clearly-marked fixture for exercising the sync worker.
 *
 *   node scripts/stubhub-seed-test.mjs seed
 *   node scripts/stubhub-seed-test.mjs clean
 *
 * Everything it creates carries POS_TEST_MARKER, and `clean` removes exactly that
 * and nothing else — so it can be pointed at a shared development database
 * without leaving anything behind or touching real rows.
 *
 * The fixture is built to prove one specific thing rather than just to exist: the
 * event carries a non-zero brokerMarkupAdjustment, and one of the three rows is
 * tagged broker. If the worker were reading inventory.listPrice straight from the
 * document — the mistake this whole design exists to avoid — that row's price
 * would come out unchanged instead of adjusted, and the difference is visible in
 * the dry-run payload.
 */

import fs from 'node:fs';
import mongoose from 'mongoose';

const MARKER = 'POS_TEST_MARKER';
const MAPPING_ID = '159262123'; // real StubHub event, verified via GET /events
const EVENT_ID = 'POS-TEST-EVENT-1';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^(['"])([\s\S]*)\1$/, '$2')];
    })
);

const mode = process.argv[2] ?? 'seed';
await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
const db = mongoose.connection.db;
console.log(`database: ${db.databaseName}\n`);

if (mode === 'clean') {
  const e = await db.collection('events').deleteMany({ Event_ID: EVENT_ID });
  const g = await db.collection('consecutivegroups').deleteMany({ 'inventory.notes': MARKER });
  const t = await db.collection('inventorytombstones').deleteMany({ mapping_id: MAPPING_ID });
  console.log(`removed ${e.deletedCount} event(s), ${g.deletedCount} row(s), ${t.deletedCount} tombstone(s)`);
  await mongoose.disconnect();
  process.exit(0);
}

// Far enough out that auto-delete and the past-event filters leave it alone.
const eventDate = new Date(Date.now() + 60 * 24 * 3600 * 1000);
const inHand = new Date(eventDate.getTime() - 24 * 3600 * 1000);

await db.collection('events').updateOne(
  { Event_ID: EVENT_ID },
  {
    $set: {
      Event_ID: EVENT_ID,
      mapping_id: MAPPING_ID,
      Event_Name: `${MARKER} Washington Nationals at Atlanta Braves`,
      Venue: 'Truist Park',
      Event_DateTime: eventDate,
      URL: 'https://example.invalid/pos-test',
      Skip_Scraping: false,
      Available_Seats: 3,
      priceIncreasePercentage: 30,
      // The point of the fixture. Stage two of the markup chain adds this on top
      // of the 30% the scraper already applied, for rows tagged broker.
      brokerMarkupAdjustment: 5,
      standardMarkupAdjustment: 0,
      resaleMarkupAdjustment: 0,
      includeStandardSeats: true,
      includeResaleSeats: true,
      Last_Updated: new Date(),
    },
  },
  { upsert: true }
);

const row = (n, seats, cost, tags, splitType, customSplit) => ({
  eventId: EVENT_ID,
  mapping_id: MAPPING_ID,
  event_name: `${MARKER} Washington Nationals at Atlanta Braves`,
  venue_name: 'Truist Park',
  event_date: eventDate,
  inHandDate: inHand,
  section: `TEST${n}`,
  row: 'A',
  seatCount: seats.length,
  seatRange: `${seats[0]}-${seats[seats.length - 1]}`,
  seats: seats.map(s => ({ number: String(s), price: cost * 1.3 })),
  inventory: {
    quantity: seats.length,
    section: `TEST${n}`,
    hideSeatNumbers: true,
    row: 'A',
    cost,
    stockType: 'MOBILE_TRANSFER',
    lineType: 'PURCHASE',
    seatType: 'CONSECUTIVE',
    inHandDate: inHand,
    notes: MARKER,
    tags,
    // Ten digits, deterministic, and far outside the range the generator
    // produces so a stray fixture can never collide with a real listing.
    inventoryId: 9900000000 + n,
    offerId: `${MARKER}-${n}`,
    splitType,
    customSplit,
    publicNotes: 'Test listing — do not sell',
    // Stage-one markup, exactly as the scraper persists it.
    listPrice: cost < 35 ? cost + 15 : cost * 1.3,
    face_price: cost,
    taxed_cost: cost,
    in_hand: false,
    instant_transfer: false,
    files_available: false,
    event_name: `${MARKER} Washington Nationals at Atlanta Braves`,
    venue_name: 'Truist Park',
    event_date: eventDate,
    eventId: EVENT_ID,
    mapping_id: MAPPING_ID,
    tickets: [],
    // Enter the outbox as never-sent.
    syncState: 'pending',
    syncPendingSince: new Date(),
    syncAttempts: 0,
  },
});

const rows = [
  row(1, [1, 2], 100, 'RESALE BROKER', 'CUSTOM', '2'),   // broker → +5 adjustment applies
  row(2, [5, 6, 7, 8], 200, 'RESALE', 'CUSTOM', '2,4'),  // resale → adjustment 0
  row(3, [11, 12], 20, 'STANDARD', 'NEVERLEAVEONE', ''), // under $35 → flat markup branch
];

await db.collection('consecutivegroups').deleteMany({ 'inventory.notes': MARKER });
await db.collection('consecutivegroups').insertMany(rows);

console.log(`seeded event ${EVENT_ID} (mapping_id ${MAPPING_ID}) with ${rows.length} rows\n`);
console.log('  what to expect in the dry-run payload:');
console.log('    9900000001  broker, cost 100 → stage1 130.00 → stage2 ×1.35/1.30 = 135.00');
console.log('    9900000002  resale, cost 200 → stage1 260.00 → no adjustment    = 260.00');
console.log('    9900000003  standard, cost 20 → flat +15      = 35.00 (sub-$35 branch)');
console.log('\n  if row 1 comes out at 130.00 the worker is reading the document, not the exporter.');

await mongoose.disconnect();
