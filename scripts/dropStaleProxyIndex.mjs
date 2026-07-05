// One-off: drop the stale ip_1_port_1 unique index left over from an older
// proxy schema. The current identity is ip:port:username:password, so gateway
// providers that share one ip:port across many rotating sessions collide on the
// old index. Run: node --env-file=.env.local scripts/dropStaleProxyIndex.mjs
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI not set');

await mongoose.connect(uri, { family: 4 });
const coll = mongoose.connection.db.collection('proxies');

const before = await coll.indexes();
console.log('Indexes before:', before.map(i => i.name));

if (before.some(i => i.name === 'ip_1_port_1')) {
  await coll.dropIndex('ip_1_port_1');
  console.log('Dropped ip_1_port_1');
} else {
  console.log('ip_1_port_1 not present — nothing to drop');
}

// Make sure the correct compound unique index exists.
await coll.createIndex(
  { ip: 1, port: 1, username: 1, password: 1 },
  { unique: true }
);
console.log('Ensured ip_1_port_1_username_1_password_1 (unique)');

console.log('Indexes after:', (await coll.indexes()).map(i => i.name));
await mongoose.disconnect();
