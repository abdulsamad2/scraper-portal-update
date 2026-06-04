/*
 * Replace old (7-digit Vivid) mapping_id with new 9-digit StubHub event id.
 *
 * Source: scripts/data/stubhub-id-remap.csv
 *   Columns: Event_Name, Event_DateTime, Venue, new_stubhub_id, old_mapping_id, extra
 *
 * Usage:
 *   node scripts/replaceStubhubMappingIds.js          # dry-run (default)
 *   node scripts/replaceStubhubMappingIds.js --apply  # actually update DB
 */

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});

const { MongoClient } = require('mongodb');

const APPLY = process.argv.includes('--apply');
const CSV_PATH = path.join(__dirname, 'data', 'stubhub-id-remap.csv');

function parseCsv(text) {
  const rows = [];
  let i = 0, field = '', row = [], inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { inQuotes = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function main() {
  console.log('Reading CSV...');
  const csvText = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCsv(csvText);
  const header = rows.shift();
  const idx = {
    name: header.indexOf('Event_Name'),
    newId: header.indexOf('new_stubhub_id'),
    oldId: header.indexOf('old_mapping_id'),
  };

  const remaps = [];
  const missingNew = [];
  for (const r of rows) {
    if (!r || r.every((c) => !c)) continue;
    const oldId = (r[idx.oldId] || '').trim();
    const newId = (r[idx.newId] || '').trim();
    const name = (r[idx.name] || '').trim();
    if (!oldId) continue;
    if (!newId) { missingNew.push({ oldId, name }); continue; }
    remaps.push({ oldId, newId, name });
  }
  console.log(`CSV rows with remap: ${remaps.length}`);
  console.log(`CSV rows missing new StubHub id: ${missingNew.length}`);

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set');

  console.log('Connecting to Mongo...');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  console.log('Connected.');

  const dbName = (uri.match(/\/([^/?]+)(\?|$)/) || [])[1];
  const db = dbName ? client.db(dbName) : client.db();
  const events = db.collection('events');

  const oldIds = remaps.map((r) => r.oldId);
  const newIds = remaps.map((r) => r.newId);

  console.log(`Fetching matching events from DB (by old + new mapping_id)...`);
  const docs = await events
    .find({ mapping_id: { $in: [...new Set([...oldIds, ...newIds])] } })
    .project({ _id: 1, mapping_id: 1, Event_Name: 1 })
    .toArray();
  console.log(`Fetched ${docs.length} candidate events from DB.`);

  const byMappingId = new Map();
  for (const d of docs) byMappingId.set(d.mapping_id, d);

  const planned = [];
  const noopAlreadyNew = [];
  const notInDb = [];
  const conflicts = [];

  for (const { oldId, newId, name } of remaps) {
    const oldDoc = byMappingId.get(oldId);
    const newDoc = byMappingId.get(newId);
    if (!oldDoc) {
      if (newDoc) noopAlreadyNew.push({ oldId, newId, name });
      else notInDb.push({ oldId, newId, name });
      continue;
    }
    if (newDoc && String(newDoc._id) !== String(oldDoc._id)) {
      conflicts.push({ oldId, newId, name, conflictingDocId: String(newDoc._id), conflictingName: newDoc.Event_Name });
      continue;
    }
    planned.push({ _id: oldDoc._id, oldId, newId, name: oldDoc.Event_Name });
  }

  console.log(`\n=== Summary ===`);
  console.log(`Planned updates:       ${planned.length}`);
  console.log(`Already migrated:      ${noopAlreadyNew.length}`);
  console.log(`Old id not in DB:      ${notInDb.length}`);
  console.log(`Conflicts (new id taken by another doc): ${conflicts.length}`);
  console.log(`Missing new id in CSV: ${missingNew.length}`);

  if (conflicts.length) {
    console.log(`\nConflicts (first 20):`);
    conflicts.slice(0, 20).forEach((c) => console.log(`  ${c.oldId} -> ${c.newId}  blocked by ${c.conflictingDocId} (${c.conflictingName})`));
  }
  if (missingNew.length) {
    console.log(`\nMissing new id in CSV (first 10):`);
    missingNew.slice(0, 10).forEach((m) => console.log(`  ${m.oldId}  ${m.name}`));
  }

  if (!APPLY) {
    console.log(`\nDry-run only. Re-run with --apply to write changes.`);
    await client.close();
    return;
  }

  console.log(`\nApplying ${planned.length} updates via bulkWrite...`);
  const BATCH = 500;
  let ok = 0, failed = 0;
  for (let i = 0; i < planned.length; i += BATCH) {
    const slice = planned.slice(i, i + BATCH);
    const ops = slice.map((p) => ({
      updateOne: { filter: { _id: p._id }, update: { $set: { mapping_id: p.newId } } },
    }));
    try {
      const res = await events.bulkWrite(ops, { ordered: false });
      ok += res.modifiedCount || 0;
    } catch (err) {
      failed += slice.length;
      console.log(`  batch starting ${i} FAILED: ${err.message}`);
    }
    console.log(`  ${Math.min(i + BATCH, planned.length)}/${planned.length}`);
  }
  console.log(`\nUpdated: ${ok}  Failed: ${failed}`);
  await client.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
