/**
 * Single-writer lease.
 *
 * The POS API has no optimistic concurrency anywhere in its 160 operations — no
 * If-Match, no ETag, no 412 in any response set. Two processes writing the same
 * listing produce a silent last-write-wins with no error and no way to detect it
 * afterwards. There is no server-side protection to fall back on, so the
 * protection has to be here.
 *
 * That matters concretely because the portal runs under PM2, and PM2 restarts,
 * reloads and cluster mode can all produce two live instances for a while. A
 * drain loop that assumed it was alone would be wrong exactly when things are
 * already going wrong.
 *
 * Implemented as a lease rather than a lock: the holder must keep renewing, and
 * an instance that dies stops renewing, so the lease expires and someone else
 * takes over without anyone having to notice the death or clean up after it.
 * A crash costs one lease TTL of idleness, never a stuck queue.
 */

import mongoose from 'mongoose';
import dbConnect from '@/lib/dbConnect';

const COLLECTION = 'sync_leader';

/** How long a lease is good for without renewal. */
export const LEASE_TTL_MS = 30_000;

/** Renew well inside the TTL so a slow renewal doesn't drop the lease. */
export const RENEW_INTERVAL_MS = 10_000;

export interface Lease {
  holder: string;
  expiresAt: Date;
}

function collection() {
  const db = mongoose.connection.db;
  if (!db) throw new Error('mongoose is not connected');
  return db.collection(COLLECTION);
}

/**
 * Take or extend the lease.
 *
 * The filter is the whole mechanism: claim only if the lease is unheld, expired,
 * or already ours. Mongo applies the update atomically against that condition, so
 * two instances racing produce exactly one winner and no torn state.
 */
export async function acquireLease(holder: string, name = 'inventory'): Promise<boolean> {
  await dbConnect();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LEASE_TTL_MS);

  try {
    const result = await collection().updateOne(
      {
        _id: name as unknown as never,
        $or: [{ expiresAt: { $lt: now } }, { holder }],
      },
      { $set: { holder, expiresAt, updatedAt: now } },
      { upsert: true }
    );
    return result.matchedCount > 0 || result.upsertedCount > 0;
  } catch (error) {
    // Two instances upserting simultaneously: one wins, the loser sees a
    // duplicate key. That is the lease working, not an error worth raising.
    if ((error as { code?: number })?.code === 11000) return false;
    throw error;
  }
}

/** Give up the lease immediately rather than making the next instance wait it out. */
export async function releaseLease(holder: string, name = 'inventory'): Promise<void> {
  await dbConnect();
  await collection().deleteOne({ _id: name as unknown as never, holder });
}

export async function currentLease(name = 'inventory'): Promise<Lease | null> {
  await dbConnect();
  const doc = await collection().findOne({ _id: name as unknown as never });
  return doc ? { holder: doc.holder as string, expiresAt: doc.expiresAt as Date } : null;
}

/** Stable per-process identity: host, pid, and a suffix to survive pid reuse. */
export function makeHolderId(): string {
  const host = process.env.HOSTNAME || 'local';
  return `${host}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;
}
