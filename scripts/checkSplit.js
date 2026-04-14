const fs = require('fs');
const path = require('path');
const envFile = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
envFile.split('\n').forEach(line => {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const eventRegex = /colorado rockies/i;
  const events = await db.collection('events').find({
    Event_Name: { $regex: eventRegex }
  }, {
    projection: { Event_Name: 1, Event_DateTime: 1, Venue: 1, mapping_id: 1 }
  }).toArray();

  const metsEvents = events.filter(e => /mets/i.test(e.Event_Name || ''));
  console.log(`\nFound ${metsEvents.length} Rockies vs Mets event(s):\n`);
  metsEvents.forEach(e => {
    console.log(`  _id: ${e._id}`);
    console.log(`  mapping_id: ${e.mapping_id}`);
    console.log(`  name: ${e.Event_Name}`);
    console.log(`  date: ${e.Event_DateTime}`);
    console.log(`  venue: ${e.Venue}\n`);
  });

  if (metsEvents.length === 0) {
    console.log('No matching events found. Sampling any Rockies events:');
    events.slice(0, 5).forEach(e => console.log(`  - ${e.Event_Name} | ${e.Event_DateTime}`));
    await mongoose.disconnect();
    return;
  }

  const mappingIds = metsEvents.map(e => e.mapping_id).filter(Boolean);
  function calculateSplitConfiguration(quantity, splitType, dbCustomSplit) {
    const isResale = splitType !== 'NEVERLEAVEONE';
    if (isResale) {
      if (dbCustomSplit && dbCustomSplit.trim().length > 0) {
        return { finalSplitType: 'CUSTOM', customSplit: dbCustomSplit.trim() };
      }
      if ((quantity % 2 === 0 && quantity >= 10) || (quantity % 2 === 1 && quantity >= 11)) return { finalSplitType: 'NEVERLEAVEONE', customSplit: '' };
      const table = {2:'2',3:'3',4:'4',5:'3,5',6:'2,4,6',7:'2,3,4,5,7',8:'2,4,6,8',9:'2,3,4,5,6,7,9',10:'2,4,6,8,10',11:'2,3,4,5,6,7,8,9,11'};
      if (table[quantity]) return { finalSplitType: 'CUSTOM', customSplit: table[quantity] };
      return { finalSplitType: 'NEVERLEAVEONE', customSplit: '' };
    }
    if (dbCustomSplit && dbCustomSplit.trim().length > 0) {
      const parsed = dbCustomSplit.split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n > 0);
      if (parsed.length > 0 && Math.min(...parsed) >= 4) {
        return { finalSplitType: 'CUSTOM', customSplit: dbCustomSplit.trim() };
      }
    }
    return { finalSplitType: 'NEVERLEAVEONE', customSplit: '' };
  }

  console.log('\n=== SIMULATED CSV OUTPUT for standard (NEVERLEAVEONE) rows ===\n');
  const allStandard = await db.collection('consecutivegroups').find({
    mapping_id: { $in: mappingIds },
    'inventory.splitType': 'NEVERLEAVEONE',
  }).toArray();

  const byResult = { CUSTOM: 0, NEVERLEAVEONE: 0 };
  allStandard.forEach(g => {
    const inv = g.inventory || {};
    const result = calculateSplitConfiguration(inv.quantity, inv.splitType, inv.customSplit);
    byResult[result.finalSplitType]++;
    console.log(`  ${g.section}/${g.row} qty=${inv.quantity} db="${inv.customSplit}" → ${result.finalSplitType}${result.customSplit ? ' ' + result.customSplit : ''}`);
  });
  console.log(`\nSummary: ${byResult.CUSTOM} CUSTOM, ${byResult.NEVERLEAVEONE} NEVERLEAVEONE (from ${allStandard.length} standard rows)\n`);

  const groups = await db.collection('consecutivegroups').find({
    mapping_id: { $in: mappingIds },
    $or: [
      { section: { $regex: /MRC|T22|t22/i } },
      { 'inventory.section': { $regex: /MRC|T22|t22/i } },
    ],
  }).toArray();

  const allSections = await db.collection('consecutivegroups').distinct('section', { mapping_id: { $in: mappingIds } });
  console.log(`\nAll distinct sections for this event (${allSections.length}):`);
  console.log(allSections.sort().join(', '));
  console.log('');

  console.log(`\nFound ${groups.length} consecutive group(s) for section matching "MRC T22":\n`);
  groups.forEach(g => {
    const inv = g.inventory || {};
    console.log(`  _id: ${g._id}`);
    console.log(`  section: ${g.section} | row: ${g.row} | seatCount: ${g.seatCount}`);
    console.log(`  inventory.section: ${inv.section} | inventory.row: ${inv.row}`);
    console.log(`  quantity: ${inv.quantity}`);
    console.log(`  splitType: ${JSON.stringify(inv.splitType)}`);
    console.log(`  customSplit: ${JSON.stringify(inv.customSplit)}`);
    console.log(`  tags: ${inv.tags}`);
    console.log('');
  });

  if (groups.length === 0) {
    console.log('No MRC T22 matches. Sampling sections for these events:');
    const sample = await db.collection('consecutivegroups').find({
      mapping_id: { $in: mappingIds }
    }).limit(15).project({ section: 1, 'inventory.section': 1, 'inventory.splitType': 1, 'inventory.customSplit': 1 }).toArray();
    sample.forEach(s => console.log(`  - section=${s.section} | inv.section=${s.inventory?.section} | splitType=${s.inventory?.splitType} | customSplit=${s.inventory?.customSplit}`));
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
