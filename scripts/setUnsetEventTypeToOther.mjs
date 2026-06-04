// One-shot: set eventType = "Other" on every event where it's currently null/missing.
// Usage: node --env-file=.env.local scripts/setUnsetEventTypeToOther.mjs
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI not set');
  process.exit(1);
}

await mongoose.connect(uri);
const col = mongoose.connection.collection('events');

const filter = {
  $or: [
    { eventType: null },
    { eventType: { $exists: false } },
    { eventType: '' },
  ],
};

const before = await col.countDocuments(filter);
console.log(`Events with unset eventType: ${before}`);

if (before === 0) {
  console.log('Nothing to update.');
} else {
  const res = await col.updateMany(filter, { $set: { eventType: 'Other' } });
  console.log(`Updated ${res.modifiedCount} event(s) to eventType="Other".`);
}

const after = await col.countDocuments(filter);
console.log(`Remaining with unset eventType: ${after}`);

await mongoose.disconnect();
