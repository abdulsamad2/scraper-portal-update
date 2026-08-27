/**
 * Offline coverage report: run the StubHub mapper across a real export and print
 * exactly what it cannot represent.
 *
 *   node scripts/stubhub-dry-map.mjs csv-exports/inventory-2026-08-20-09-25-10.csv
 *   node scripts/stubhub-dry-map.mjs <csv> --marketplaces StubHub,ReachPro
 *   node scripts/stubhub-dry-map.mjs <csv> --sample 2
 *
 * Why a CSV and not the database: the mapper's contract is that it consumes the
 * rows `generateInventoryCsv` produces, because that is where the second stage of
 * the markup chain is applied. Feeding it anything else — including reading
 * inventory.listPrice straight from Mongo — would validate a code path we don't
 * intend to ship. Point this at a file the portal actually generated and the
 * prices being checked are the prices that would really be sent.
 *
 * Nothing here touches the network or the database. It is safe to run at any time,
 * and it is the intended way to answer "what breaks if we cut over today?"
 */

import fs from 'node:fs';
import path from 'node:path';
import { mapRow } from '../lib/stubhub/mapRow.ts';

const args = process.argv.slice(2);
const csvPath = args.find(a => !a.startsWith('--'));
const flag = name => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};

if (!csvPath) {
  console.error('usage: node scripts/stubhub-dry-map.mjs <export.csv> [--marketplaces A,B] [--sample N]');
  process.exit(1);
}

const marketplaces = (flag('marketplaces') ?? 'StubHub').split(',').map(s => s.trim()).filter(Boolean);
const sampleCount = Number.parseInt(flag('sample') ?? '1', 10);

/** Minimal RFC 4180 reader — the export quotes fields containing commas. */
function parseCsv(text) {
  const rows = [];
  let field = '';
  let record = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { record.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { record.push(field); rows.push(record); record = []; field = ''; continue; }
    field += ch;
  }
  if (field.length || record.length) { record.push(field); rows.push(record); }

  const [header, ...body] = rows.filter(r => r.length > 1);
  return body.map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const num = v => (v === '' || v == null ? undefined : Number(v));

/** CSV cells are strings; InventoryRowInput expects the numeric columns typed. */
function toRow(raw) {
  return {
    inventory_id: num(raw.inventory_id) ?? 0,
    event_id: raw.event_id,
    event_name: raw.event_name,
    venue_name: raw.venue_name,
    event_date: raw.event_date,
    quantity: num(raw.quantity) ?? 0,
    section: raw.section,
    row: raw.row,
    seats: raw.seats,
    public_notes: raw.public_notes,
    internal_notes: raw.internal_notes,
    tags: raw.tags,
    list_price: num(raw.list_price) ?? 0,
    face_price: num(raw.face_price),
    taxed_cost: num(raw.taxed_cost),
    cost: num(raw.cost) ?? 0,
    hide_seats: raw.hide_seats,
    in_hand_date: raw.in_hand_date,
    split_type: raw.split_type,
    custom_split: raw.custom_split,
    stock_type: raw.stock_type,
    zone: raw.zone,
    shown_quantity: num(raw.shown_quantity),
  };
}

const rows = parseCsv(fs.readFileSync(csvPath, 'utf8')).map(toRow);

const skipped = new Map();      // reason -> count
const skipSamples = new Map();  // reason -> first detail seen
const splits = new Map();       // ApiSplitType -> count
const deliveries = new Map();   // ApiDeliveryType -> count
const warnings = new Map();     // warning kind -> count
const lossyRows = [];
const mapped = [];

const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);

for (const row of rows) {
  const result = mapRow(row, { marketplaces });
  if (!result.ok) {
    bump(skipped, result.reason);
    if (!skipSamples.has(result.reason)) skipSamples.set(result.reason, result.detail);
    continue;
  }
  mapped.push(result);
  bump(splits, result.create.splitType);
  bump(deliveries, result.create.deliveryType);
  for (const w of result.warnings) bump(warnings, w.split(':')[0]);
  if (result.warnings.some(w => w.startsWith('split:') || w.startsWith('delivery:'))) {
    lossyRows.push({ externalId: result.externalId, warnings: result.warnings });
  }
}

const pct = n => `${((n / Math.max(rows.length, 1)) * 100).toFixed(1)}%`;
const table = (m, total) => [...m.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `    ${String(k).padEnd(24)} ${String(v).padStart(6)}  ${((v / Math.max(total, 1)) * 100).toFixed(1)}%`)
  .join('\n');

console.log(`\nStubHub mapper coverage — ${path.basename(csvPath)}`);
console.log(`marketplaces: ${marketplaces.join(', ')}\n`);
console.log(`  rows in export        ${String(rows.length).padStart(6)}`);
console.log(`  mappable              ${String(mapped.length).padStart(6)}  ${pct(mapped.length)}`);
console.log(`  skipped               ${String(rows.length - mapped.length).padStart(6)}  ${pct(rows.length - mapped.length)}`);

if (skipped.size) {
  console.log('\n  SKIPPED — these rows cannot be listed at all:');
  console.log(table(skipped, rows.length));
  for (const [reason, detail] of skipSamples) console.log(`    e.g. ${reason}: ${detail}`);
}

if (mapped.length) {
  console.log('\n  split types:');
  console.log(table(splits, mapped.length));
  console.log('\n  delivery types:');
  console.log(table(deliveries, mapped.length));
}

console.log('\n  representation losses (row still sent, but something was approximated):');
console.log(warnings.size ? table(warnings, mapped.length) : '    none');

if (lossyRows.length) {
  console.log(`\n  ${lossyRows.length} row(s) with an approximated split or delivery type:`);
  for (const r of lossyRows.slice(0, 10)) {
    console.log(`    ${r.externalId}  ${r.warnings.join(' | ')}`);
  }
  if (lossyRows.length > 10) console.log(`    … and ${lossyRows.length - 10} more`);
}

for (const s of mapped.slice(0, Math.max(sampleCount, 0))) {
  console.log(`\n  sample payload for externalId ${s.externalId}:`);
  console.log('  create ' + JSON.stringify(s.create, null, 2).split('\n').join('\n  '));
  console.log('  update ' + JSON.stringify(s.update, null, 2).split('\n').join('\n  '));
}

console.log('');
