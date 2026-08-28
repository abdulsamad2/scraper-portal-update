'use server';

import dbConnect from '@/lib/dbConnect';
import { SeatDrop } from '@/models/seatDropModel';

/**
 * Seat drops — new seats appearing on a tracked event.
 *
 * Written exclusively by the playwright scraper (helpers/SeatDropDetector.js).
 * The portal reads them and acknowledges them; it never creates or deletes one.
 */

export interface DropFilters {
  status?: 'all' | 'active' | 'gone';
  eventId?: string;
  search?: string;
  unseenOnly?: boolean;
  limit?: number;
  sinceMinutes?: number;
}

export interface DropStats {
  total: number;
  active: number;
  gone: number;
  unseen: number;
  seatsActive: number;
  last15Min: number;
  eventsAffected: number;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Newest drops plus the counters the drops page needs, in one round trip.
 * The page polls this, so it stays a single database hit per tick.
 */
export async function getDrops(filters: DropFilters = {}) {
  await dbConnect();
  try {
    const {
      status = 'all',
      eventId = '',
      search = '',
      unseenOnly = false,
      sinceMinutes = 0,
    } = filters;
    const limit = Math.min(Math.max(1, filters.limit ?? 150), 500);

    const query: Record<string, unknown> = {};
    if (status === 'active' || status === 'gone') query.status = status;
    if (eventId) query.eventId = eventId;
    if (unseenOnly) query.seen = false;
    if (sinceMinutes > 0) {
      query.detectedAt = { $gte: new Date(Date.now() - sinceMinutes * 60_000) };
    }
    if (search) {
      const rx = { $regex: escapeRegex(search), $options: 'i' };
      query.$or = [
        { event_name: rx },
        { venue_name: rx },
        { section: rx },
        { row: rx },
        { eventId: rx },
      ];
    }

    const fifteenMinAgo = new Date(Date.now() - 15 * 60_000);

    const [drops, counts, last15Min, eventsAffected] = await Promise.all([
      SeatDrop.find(query).sort({ detectedAt: -1 }).limit(limit).lean(),
      SeatDrop.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
            gone: { $sum: { $cond: [{ $eq: ['$status', 'gone'] }, 1, 0] } },
            unseen: { $sum: { $cond: [{ $eq: ['$seen', false] }, 1, 0] } },
            seatsActive: {
              $sum: { $cond: [{ $eq: ['$status', 'active'] }, '$newSeatCount', 0] },
            },
          },
        },
      ]),
      SeatDrop.countDocuments({ detectedAt: { $gte: fifteenMinAgo } }),
      SeatDrop.distinct('eventId', { status: 'active' }),
    ]);

    const c = counts[0] ?? { total: 0, active: 0, gone: 0, unseen: 0, seatsActive: 0 };

    const stats: DropStats = {
      total: c.total ?? 0,
      active: c.active ?? 0,
      gone: c.gone ?? 0,
      unseen: c.unseen ?? 0,
      seatsActive: c.seatsActive ?? 0,
      last15Min,
      eventsAffected: eventsAffected.length,
    };

    return {
      success: true as const,
      serverTime: new Date().toISOString(),
      stats,
      drops: JSON.parse(JSON.stringify(drops)),
    };
  } catch (error: unknown) {
    console.error('Error fetching seat drops:', error);
    return {
      success: false as const,
      error: error instanceof Error ? error.message : 'Failed to fetch seat drops',
    };
  }
}

/**
 * Acknowledge specific drops — clears the alarm only, never deletes history.
 */
export async function acknowledgeDrops(ids: string[]) {
  await dbConnect();
  try {
    if (!Array.isArray(ids) || ids.length === 0) {
      return { success: false as const, error: 'No drop ids provided' };
    }
    const res = await SeatDrop.updateMany(
      { _id: { $in: ids.slice(0, 500) } },
      { $set: { seen: true } }
    );
    return { success: true as const, acknowledged: res.modifiedCount };
  } catch (error: unknown) {
    console.error('Error acknowledging seat drops:', error);
    return {
      success: false as const,
      error: error instanceof Error ? error.message : 'Failed to acknowledge drops',
    };
  }
}

/** Acknowledge every outstanding drop. */
export async function acknowledgeAllDrops() {
  await dbConnect();
  try {
    const res = await SeatDrop.updateMany({ seen: false }, { $set: { seen: true } });
    return { success: true as const, acknowledged: res.modifiedCount };
  } catch (error: unknown) {
    console.error('Error acknowledging all seat drops:', error);
    return {
      success: false as const,
      error: error instanceof Error ? error.message : 'Failed to acknowledge drops',
    };
  }
}
