// One-shot: align the shared `proxies` collection with the portal's proxy model.
// Run this ON THE PRODUCTION SERVER (where MONGODB_URI points at the real DB):
//   node --env-file=.env.local scripts/fixProxyIndexes.mjs
//
// It does three things, all idempotent:
//   1. Backfills `proxy_id` on any portal docs missing it (the scrapers'
//      collection has a UNIQUE index on proxy_id, so null/missing values
//      collide with E11000 on the 2nd+ insert).
//   2. Drops the stale `ip_1_port_1` AND `ip_1_port_1_username_1` UNIQUE
//      indexes left by older models — both collapse gateway proxies that
//      share an ip:port:username across rotating sessions onto one row.
//   3. Ensures the new `{ ip, port, username, password }` UNIQUE index exists
//      so each rotating session (distinguished by its password) is its own row.
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

// 1) Backfill proxy_id from the FULL identity tuple (incl. password) where it
//    is null/missing, so each rotating session gets a unique, stable proxy_id.
const backfill = await col.updateMany(
  {
    $or: [{ proxy_id: { $exists: false } }, { proxy_id: null }],
    ip: { $exists: true },
    port: { $exists: true },
    username: { $exists: true },
    password: { $exists: true },
  },
  [
    {
      $set: {
        proxy_id: {
          $concat: ['$ip', ':', '$port', ':', '$username', ':', '$password'],
        },
      },
    },
  ]
);
console.log('Backfilled proxy_id on docs:', backfill.modifiedCount);

// 2) Drop the stale unique indexes that collapse rotating sessions onto one row.
const before = await col.indexes();
console.log('Indexes before:', before.map((i) => i.name).join(', '));
for (const stale of ['ip_1_port_1', 'ip_1_port_1_username_1']) {
  if (before.some((i) => i.name === stale)) {
    await col.dropIndex(stale);
    console.log('Dropped stale index', stale);
  } else {
    console.log('No', stale, 'index to drop');
  }
}

// 3) Ensure the full-identity index exists (password included).
await col.createIndex({ ip: 1, port: 1, username: 1, password: 1 }, { unique: true });
console.log('Ensured ip_1_port_1_username_1_password_1 (unique)');

const after = await col.indexes();
console.log('Indexes after:', after.map((i) => i.name).join(', '));

await mongoose.disconnect();
