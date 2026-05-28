// One-shot: flip the proxies feature flag to "enabled" in MongoDB.
// Usage: node --env-file=.env.local scripts/enableProxiesFlag.mjs
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI not set');
  process.exit(1);
}

await mongoose.connect(uri);
const col = mongoose.connection.collection('featureflags');

const before = await col.findOne({});
console.log('Before:', before ? { proxies: before.proxies } : 'no doc');

const res = await col.updateOne(
  {},
  { $set: { proxies: 'enabled' } },
  { upsert: true }
);
console.log('Update result:', { matched: res.matchedCount, modified: res.modifiedCount, upserted: res.upsertedCount });

const after = await col.findOne({});
console.log('After:', after ? { proxies: after.proxies } : 'no doc');

await mongoose.disconnect();
