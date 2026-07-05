import mongoose from 'mongoose';
const uri = process.env.MONGODB_URI;
await mongoose.connect(uri, { family: 4 });
const coll = mongoose.connection.db.collection('proxies');
const total = await coll.countDocuments({ ip: 'resipro.bartproxies.com', port: '7778' });
console.log('resipro.bartproxies.com:7778 rows:', total);
console.log('total proxies:', await coll.countDocuments({}));
await mongoose.disconnect();
