/**
 * Test script for Auto-Delete logic
 * 
 * Creates dummy events at various times relative to "now" and tests whether
 * the auto-delete logic correctly identifies which events to stop & delete
 * based on the stopBeforeHours setting.
 * 
 * Usage: node test-auto-delete.mjs
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';

// Load env
const envContent = readFileSync('.env.local', 'utf8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmed.substring(0, eqIndex).trim();
      const value = trimmed.substring(eqIndex + 1).trim();
      envVars[key] = value;
    }
  }
});

const MONGODB_URI = envVars.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in .env.local');
  process.exit(1);
}

// ── Event Schema (matches models/eventModel.js) ──
const eventSchema = new mongoose.Schema({
  mapping_id: { type: String, required: true, unique: true },
  Event_ID: { type: String, required: true, unique: true },
  Event_Name: { type: String, required: true },
  Event_DateTime: { type: Date, required: true },
  Venue: String,
  URL: { type: String, required: true },
  Zone: { type: String, default: 'none' },
  Available_Seats: { type: Number, default: 0 },
  Skip_Scraping: { type: Boolean, default: false },
  inHandDate: { type: Date, default: Date.now },
  priceIncreasePercentage: { type: Number, default: 25 },
  standardMarkupAdjustment: { type: Number, default: 0 },
  resaleMarkupAdjustment: { type: Number, default: 0 },
  Last_Updated: { type: Date, default: Date.now },
}, { timestamps: true });

const Event = mongoose.models.Event || mongoose.model('Event', eventSchema);

// ── Helper: create event at offset hours from now ──
function makeEvent(id, name, offsetHours, skipScraping = false) {
  const eventTime = new Date(Date.now() + offsetHours * 60 * 60 * 1000);
  return {
    mapping_id: `TEST_MAP_${id}`,
    Event_ID: `TEST_${id}`,
    Event_Name: name,
    Event_DateTime: eventTime,
    Venue: 'Test Venue',
    URL: `https://test.com/event-${id}`,
    Skip_Scraping: skipScraping,
  };
}

// ── Simulate the auto-delete query (same logic as autoDeleteActions.ts) ──
async function simulateAutoDelete(stopBeforeHours) {
  const now = new Date();
  const cutoffTime = new Date(now.getTime() + stopBeforeHours * 60 * 60 * 1000);

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`🔍 SIMULATING AUTO-DELETE with stopBeforeHours = ${stopBeforeHours}`);
  console.log(`   Current time : ${now.toISOString()}`);
  console.log(`   Cutoff time  : ${cutoffTime.toISOString()}`);
  console.log(`   Rule: Delete events where Event_DateTime <= cutoffTime`);
  console.log(`${'═'.repeat(70)}`);

  // Same query as deleteExpiredEvents
  const eventsToDelete = await Event.find({
    Event_ID: { $regex: /^TEST_/ },
    Event_DateTime: { $lte: cutoffTime }
  }).select('Event_ID Event_Name Event_DateTime Skip_Scraping').lean();

  const eventsSafe = await Event.find({
    Event_ID: { $regex: /^TEST_/ },
    Event_DateTime: { $gt: cutoffTime }
  }).select('Event_ID Event_Name Event_DateTime Skip_Scraping').lean();

  console.log(`\n🗑️  WOULD BE STOPPED & DELETED (${eventsToDelete.length} events):`);
  if (eventsToDelete.length === 0) {
    console.log('   (none)');
  }
  eventsToDelete.forEach(e => {
    const hoursUntilEvent = ((new Date(e.Event_DateTime)).getTime() - now.getTime()) / (60 * 60 * 1000);
    const status = e.Skip_Scraping ? '🔴 Stopped' : '🟢 Active';
    const timeLabel = hoursUntilEvent < 0
      ? `${Math.abs(hoursUntilEvent).toFixed(1)}h AGO`
      : `in ${hoursUntilEvent.toFixed(1)}h`;
    console.log(`   ${status} ${e.Event_ID} | ${e.Event_Name} | ${new Date(e.Event_DateTime).toLocaleString()} (${timeLabel})`);
  });

  console.log(`\n✅ SAFE - Would NOT be deleted (${eventsSafe.length} events):`);
  if (eventsSafe.length === 0) {
    console.log('   (none)');
  }
  eventsSafe.forEach(e => {
    const hoursUntilEvent = ((new Date(e.Event_DateTime)).getTime() - now.getTime()) / (60 * 60 * 1000);
    const status = e.Skip_Scraping ? '🔴 Stopped' : '🟢 Active';
    console.log(`   ${status} ${e.Event_ID} | ${e.Event_Name} | ${new Date(e.Event_DateTime).toLocaleString()} (in ${hoursUntilEvent.toFixed(1)}h)`);
  });

  return { deleted: eventsToDelete, safe: eventsSafe };
}

// ── Main test ──
async function runTest() {
  console.log('🚀 Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected!\n');

  // Clean up any previous test data
  const cleanResult = await Event.deleteMany({ Event_ID: { $regex: /^TEST_/ } });
  console.log(`🧹 Cleaned up ${cleanResult.deletedCount} previous test events\n`);

  // ── Create dummy events at various times ──
  const now = new Date();
  console.log(`📅 Current time: ${now.toLocaleString()} (${now.toISOString()})\n`);

  const dummyEvents = [
    makeEvent('PAST_24H',   'Concert Yesterday',         -24),    // 24h ago - already happened
    makeEvent('PAST_5H',    'Morning Show (5h ago)',      -5),     // 5h ago - already happened
    makeEvent('PAST_1H',    'Recent Show (1h ago)',       -1),     // 1h ago - just happened
    makeEvent('IN_30MIN',   'Starting in 30 min',         0.5),   // 30 min from now
    makeEvent('IN_1H',      'Show in 1 hour',             1),     // 1h from now
    makeEvent('IN_1H30',    'Show in 1.5 hours',          1.5),   // 1.5h from now
    makeEvent('IN_2H',      'Show in 2 hours',            2),     // 2h from now - edge case
    makeEvent('IN_3H',      'Evening Show in 3h',         3),     // 3h from now
    makeEvent('IN_5H',      'Late Show in 5h',            5),     // 5h from now
    makeEvent('IN_8H',      'Tomorrow Morning Show',      8),     // 8h from now
    makeEvent('IN_24H',     'Tomorrow Same Time',         24),    // 24h from now
    makeEvent('IN_48H',     'Day After Tomorrow',         48),    // 48h from now
    makeEvent('STOPPED_2H', 'Already Stopped (2h out)',   2, true), // 2h out, already stopped
  ];

  console.log('📝 Inserting dummy events...');
  for (const evt of dummyEvents) {
    try {
      await Event.create(evt);
      const offset = ((new Date(evt.Event_DateTime)).getTime() - now.getTime()) / (60 * 60 * 1000);
      const timeLabel = offset < 0 ? `${Math.abs(offset).toFixed(1)}h ago` : `in ${offset.toFixed(1)}h`;
      console.log(`   ✅ ${evt.Event_ID} → ${evt.Event_Name} @ ${new Date(evt.Event_DateTime).toLocaleString()} (${timeLabel})`);
    } catch (err) {
      console.log(`   ⚠️  ${evt.Event_ID} → ${err.message}`);
    }
  }

  // ── Test with different stopBeforeHours values ──
  console.log('\n\n' + '█'.repeat(70));
  console.log('  TEST 1: stopBeforeHours = 2 (default)');
  console.log('  Expected: Delete events at -24h, -5h, -1h, +30min, +1h, +1.5h, +2h');
  console.log('  Expected safe: +3h, +5h, +8h, +24h, +48h');
  console.log('█'.repeat(70));
  const test1 = await simulateAutoDelete(2);

  console.log('\n\n' + '█'.repeat(70));
  console.log('  TEST 2: stopBeforeHours = 0 (delete only past events)');
  console.log('  Expected: Delete events at -24h, -5h, -1h');
  console.log('  Expected safe: everything in the future');
  console.log('█'.repeat(70));
  const test2 = await simulateAutoDelete(0);

  console.log('\n\n' + '█'.repeat(70));
  console.log('  TEST 3: stopBeforeHours = 5 (aggressive - 5h before)');
  console.log('  Expected: Delete events at -24h, -5h, -1h, +30min, +1h, +1.5h, +2h, +3h, +5h');
  console.log('  Expected safe: +8h, +24h, +48h');
  console.log('█'.repeat(70));
  const test3 = await simulateAutoDelete(5);

  // ── Verify results ──
  console.log('\n\n' + '═'.repeat(70));
  console.log('📊 RESULTS SUMMARY');
  console.log('═'.repeat(70));
  
  const pass = (condition, label) => {
    console.log(`  ${condition ? '✅ PASS' : '❌ FAIL'} - ${label}`);
    return condition;
  };

  let allPassed = true;

  // Test 1: stopBeforeHours=2 → cutoff = now+2h → events at <=+2h deleted (7 events incl. STOPPED_2H)
  allPassed &= pass(test1.deleted.length === 7, `Test1: ${test1.deleted.length} deleted (expected 7 — past + within 2h)`);
  allPassed &= pass(test1.safe.length === 6, `Test1: ${test1.safe.length} safe (expected 6 — beyond 2h)`);

  // Test 2: stopBeforeHours=0 → cutoff = now → only past events
  allPassed &= pass(test2.deleted.length === 3, `Test2: ${test2.deleted.length} deleted (expected 3 — only past)`);
  allPassed &= pass(test2.safe.length === 10, `Test2: ${test2.safe.length} safe (expected 10 — all future)`);

  // Test 3: stopBeforeHours=5 → cutoff = now+5h → events at <=+5h
  allPassed &= pass(test3.deleted.length === 9, `Test3: ${test3.deleted.length} deleted (expected 9 — past + within 5h)`);
  allPassed &= pass(test3.safe.length === 4, `Test3: ${test3.safe.length} safe (expected 4 — beyond 5h)`);

  console.log(`\n  ${allPassed ? '🎉 ALL TESTS PASSED!' : '⚠️  SOME TESTS FAILED — check output above'}\n`);

  // ── Cleanup ──
  const finalClean = await Event.deleteMany({ Event_ID: { $regex: /^TEST_/ } });
  console.log(`🧹 Cleaned up ${finalClean.deletedCount} test events`);

  await mongoose.disconnect();
  console.log('👋 Disconnected from MongoDB');
}

runTest().catch(err => {
  console.error('❌ Test failed with error:', err);
  mongoose.disconnect();
  process.exit(1);
});
