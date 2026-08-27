/**
 * Measure how fast inventory actually changes.
 *
 *   node scripts/stubhub-measure-rate.mjs            # 10 minutes
 *   node scripts/stubhub-measure-rate.mjs --minutes 30
 *   node scripts/stubhub-measure-rate.mjs --minutes 5 --interval 10
 *
 * Read-only. Run it with the scrapers going and the sync worker STOPPED — a
 * stopped worker leaves rows in the queue where they can be counted, which is
 * what makes arrivals observable at all.
 *
 * ── Why this exists ────────────────────────────────────────────────────────────
 *
 * Every capacity figure in the design documents is parameterised on one number
 * nobody has measured: what share of the book changes per scrape cycle. Whether
 * one sync worker is enough or you need six, whether the API limits bind or sit
 * idle, whether 3,000 events is comfortable or impossible — all of it turns on
 * that single unknown, and everything else is arithmetic.
 *
 * The outbox makes it directly observable. A row entering the queue IS a change:
 * the scraper writes syncPendingSince in the same transaction that changes the
 * data. Counting arrivals over a window is therefore not a proxy for the change
 * rate, it is the change rate.
 */

import fs from 'node:fs';
import mongoose from 'mongoose';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(args[i + 1]);
};

const MINUTES = flag('minutes', 10);
const INTERVAL_S = flag('interval', 15);
const CYCLE_S = 120; // the scrapers revisit each event every two minutes

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^(['"])([\s\S]*)\1$/, '$2')];
    })
);

await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
const db = mongoose.connection.db;
const groups = db.collection('consecutivegroups');
const tombstones = db.collection('inventorytombstones');

const activeEvents = await db.collection('events')
  .countDocuments({ Skip_Scraping: { $ne: true } });
const bookSize = await groups.estimatedDocumentCount();

console.log(`\nmeasuring for ${MINUTES} min, sampling every ${INTERVAL_S}s`);
console.log(`  active events : ${activeEvents}`);
console.log(`  rows in book  : ${bookSize.toLocaleString()}`);
console.log(`\n  run this with the scrapers going and the SYNC WORKER STOPPED,`);
console.log(`  otherwise the worker drains arrivals before they can be counted.\n`);

const samples = [];
let since = new Date();
const started = Date.now();
const deadline = started + MINUTES * 60_000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

while (Date.now() < deadline) {
  await sleep(INTERVAL_S * 1000);
  const now = new Date();

  // Arrivals in this window. syncPendingSince is stamped by whoever changed the
  // row, so this counts changes rather than sync activity.
  const [rows, removals, byEvent] = await Promise.all([
    groups.countDocuments({ 'inventory.syncPendingSince': { $gt: since, $lte: now } }),
    tombstones.countDocuments({ createdAt: { $gt: since, $lte: now } }),
    groups.aggregate([
      { $match: { 'inventory.syncPendingSince': { $gt: since, $lte: now } } },
      { $group: { _id: '$mapping_id', n: { $sum: 1 } } },
    ]).toArray(),
  ]);

  const elapsed = (now - since) / 1000;
  samples.push({ rows, removals, events: byEvent.length, perSecond: (rows + removals) / elapsed });

  const mins = ((Date.now() - started) / 60_000).toFixed(1);
  console.log(
    `  +${mins.padStart(4)}m  ${String(rows).padStart(6)} rows  ${String(removals).padStart(5)} removals  ` +
    `across ${String(byEvent.length).padStart(3)} events   ${((rows + removals) / elapsed).toFixed(1)}/s`
  );
  since = now;
}

if (samples.length === 0) {
  console.log('\n  no samples taken — try a longer --minutes\n');
  await mongoose.disconnect();
  process.exit(0);
}

const rates = samples.map(s => s.perSecond).sort((a, b) => a - b);
const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
const median = rates[Math.floor(rates.length / 2)];
const peak = rates[rates.length - 1];
const perCycle = mean * CYCLE_S;
const peakPerCycle = peak * CYCLE_S;

console.log('\n─────────────────────────────────────────────────────────────');
console.log(`  mean    ${mean.toFixed(1)}/s   ${Math.round(perCycle).toLocaleString()} changes per 2-min cycle`);
console.log(`  median  ${median.toFixed(1)}/s`);
console.log(`  peak    ${peak.toFixed(1)}/s   ${Math.round(peakPerCycle).toLocaleString()} per cycle`);
if (bookSize > 0) {
  console.log(`  churn   ${(perCycle / bookSize * 100).toFixed(2)}% of the book per cycle (mean)`);
}

// Sizing. Peak matters more than mean: a system that keeps up on average and
// falls behind at peak accumulates a backlog it never recovers from, because
// there is no quiet period to catch up in — the scrapers never stop.
const BUILD_MS_PER_ROW = 6.3;                       // measured against this collection
const pipelineCapacity = 1000 / BUILD_MS_PER_ROW;   // rows/s per pipeline
const apiCeiling = (700 * 200) / 60;                // seek-verified bulk

console.log('\n  sizing against measured peak:');
console.log(`    pipelines needed   ${Math.max(1, Math.ceil(peak / pipelineCapacity))}   (each sustains ~${pipelineCapacity.toFixed(0)}/s)`);
console.log(`    API headroom       ${(peak / apiCeiling * 100).toFixed(1)}% of the ${apiCeiling.toFixed(0)}/s ceiling`);
console.log(peak > apiCeiling
  ? '    => EXCEEDS the API ceiling — ask StubHub to raise seek and the batch cap'
  : '    => within API limits; throughput is a matter of pipelines and workers');

if (activeEvents > 0) {
  const per3k = perCycle / activeEvents * 3000;
  console.log(`\n  projected at 3,000 events: ${Math.round(per3k).toLocaleString()} changes/cycle` +
              `, ${Math.max(1, Math.ceil((per3k / CYCLE_S) / pipelineCapacity))} pipelines`);
}
console.log('');

await mongoose.disconnect();
