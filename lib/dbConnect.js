import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

console.log('🔍 Debug - MONGODB_URI value:', MONGODB_URI);

if (!MONGODB_URI) {
  throw new Error(
    'Please define the MONGODB_URI environment variable inside .env.local'
  );
}

async function dbConnect() {
  const opts = {
    bufferCommands: false,
    // Connection timeout options
    serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
    socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
    connectTimeoutMS: 10000, // Give up initial connection after 10 seconds
    // Heartbeat frequency
    heartbeatFrequencyMS: 10000, // Send a ping to check if server is alive every 10 seconds
    // Retry options
    retryWrites: true,
    retryReads: true,
    maxPoolSize: 10, // Maintain up to 10 socket connections
    minPoolSize: 2, // Maintain a minimum of 2 socket connections
    // DNS lookup timeout
    family: 4, // Use IPv4, skip trying IPv6
  };

  try {
    const connection = await mongoose.connect(MONGODB_URI, opts);
    console.log('✅ Connected to MongoDB successfully');
    return connection;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    throw error;
  }
}

export default dbConnect;
