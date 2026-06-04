// One-shot: align the shared `proxies` collection with the portal's proxy model.
// Run this ON THE PRODUCTION SERVER (where MONGODB_URI points at the real DB):
//   node --env-file=.env.local scripts/fixProxyIndexes.mjs
//
// It does three things, all idempotent:
//   1. Backfills `proxy_id` on any portal docs missing it (the scrapers'
//      collection has a UNIQUE index on proxy_id, so null/missing values
//      collide with E11000 on the 2nd+ insert).
//   2. Drops the stale `ip_1_port_1` UNIQUE index left by the old model — it
//      blocks gateway proxies that share an ip:port across rotating sessions.
//   3. Ensures the new `{ ip, port, username }` UNIQUE index exists.
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI not set');
  process.exit(1);
}

await mongoose.connect(uri);
const db = mongoose.connection.db;
console.log('Connected to DB:', db.databaseName);
const col = db.collection('proxies');

// 1) Backfill proxy_id from the identity tuple where it is null/missing.
const backfill = await col.updateMany(
  {
    $or: [{ proxy_id: { $exists: false } }, { proxy_id: null }],
    ip: { $exists: true },
    port: { $exists: true },
    username: { $exists: true },
  },
  [
    {
      $set: {
        proxy_id: {
          $concat: ['$ip', ':', '$port', ':', '$username'],
        },
      },
    },
  ]
);
console.log('Backfilled proxy_id on docs:', backfill.modifiedCount);

// 2) Drop the stale unique index on { ip, port } if present.
const before = await col.indexes();
console.log('Indexes before:', before.map((i) => i.name).join(', '));
if (before.some((i) => i.name === 'ip_1_port_1')) {
  await col.dropIndex('ip_1_port_1');
  console.log('Dropped stale index ip_1_port_1');
} else {
  console.log('No ip_1_port_1 index to drop');
}

// 3) Ensure the compound identity index exists.
await col.createIndex({ ip: 1, port: 1, username: 1 }, { unique: true });
console.log('Ensured ip_1_port_1_username_1 (unique)');

const after = await col.indexes();
console.log('Indexes after:', after.map((i) => i.name).join(', '));

await mongoose.disconnect();
