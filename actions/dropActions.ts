'use server';

import dbConnect from '@/lib/dbConnect';
import { SeatDrop } from '@/models/seatDropModel';
import { Event } from '@/models/eventModel';

/**
 * Seat drops — new seats appearing on a tracked event.
 *
 * Written exclusively by the playwright scraper (helpers/SeatDropDetector.js).
 * The portal reads them and acknowledges them; it never creates or deletes one.
 *
 * DATE SEMANTICS — Event_DateTime stores the venue's LOCAL wall-clock encoded
 * as UTC (an 7pm show in Denver is stored 19:00:00.000Z, see
 * ImportEventsClient). So every day-window here is built with Date.UTC and
 * every date is rendered with timeZone:'UTC'. Using local-time boundaries would
 * silently shift events across the day line.
 */

export type DropDateRange = 'all' | 'today' | 'tomorrow' | 'week' | 'past';
export type DropSort = 'newest' | 'oldest' | 'eventDate' | 'event' | 'seats' | 'price';

export interface DropFilters {
  status?: 'all' | 'active' | 'gone';
  eventId?: string;
  search?: string;
  unseenOnly?: boolean;
  limit?: number;
  sinceMinutes?: number;
  dateRange?: DropDateRange;
  /**
   * The operator's local calendar day as YYYY-MM-DD. "Today" means the day the
   * person looking at the screen calls today, so the client supplies it rather
   * than the server guessing from its own clock.
   */
  localDate?: string;
  sort?: DropSort;
}

export interface DropStats {
  total: number;
  active: number;
  gone: number;
  unseen: number;
  seatsActive: number;
  last15Min: number;
  eventsAffected: number;
  todayDrops: number;
  todayEvents: number;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** UTC day bounds for a YYYY-MM-DD calendar date, offset by `addDays`. */
function utcDayBounds(localDate: string | undefined, addDays = 0) {
  let y: number, m: number, d: number;
  const parsed = localDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (parsed) {
    y = Number(parsed[1]); m = Number(parsed[2]); d = Number(parsed[3]);
  } else {
    const now = new Date();
    y = now.getFullYear(); m = now.getMonth() + 1; d = now.getDate();
  }
  const start = new Date(Date.UTC(y, m - 1, d + addDays, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y, m - 1, d + addDays, 23, 59, 59, 999));
  return { start, end };
}

function windowFor(range: DropDateRange, localDate?: string): { $gte?: Date; $lte?: Date; $lt?: Date } | null {
  const today = utcDayBounds(localDate, 0);
  switch (range) {
    case 'today':    return { $gte: today.start, $lte: today.end };
    case 'tomorrow': {
      const t = utcDayBounds(localDate, 1);
      return { $gte: t.start, $lte: t.end };
    }
    case 'week': {
      const end = utcDayBounds(localDate, 6);
      return { $gte: today.start, $lte: end.end };
    }
    case 'past':     return { $lt: today.start };
    default:         return null;
  }
}

const SORTS: Record<DropSort, Record<string, 1 | -1>> = {
  newest:    { detectedAt: -1 },
  oldest:    { detectedAt: 1 },
  // soonest event first, newest drop within an event
  eventDate: { event_date: 1, detectedAt: -1 },
  event:     { event_name: 1, event_date: 1, detectedAt: -1 },
  seats:     { newSeatCount: -1, detectedAt: -1 },
  price:     { listPrice: -1, detectedAt: -1 },
};

export interface EnrichedDrop extends Record<string, unknown> {
  _id: string;
  eventId: string;
  event_url?: string | null;
  event_date?: string | null;
  eventMissing?: boolean;
}

/**
 * Newest drops plus the counters the drops page needs, in one round trip.
 *
 * Drops are enriched from the Event collection at read time: the scraper does
 * not populate event_url, and the Event row is the authoritative source for the
 * link and the event date even if either changed after the drop was recorded.
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
      dateRange = 'all',
      localDate,
      sort = 'newest',
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

    // Date window resolves against the Event collection, not the drop's
    // denormalized copy, so a corrected event date is honoured immediately.
    const dateWindow = windowFor(dateRange, localDate);
    if (dateWindow) {
      const ids = await Event.distinct('Event_ID', { Event_DateTime: dateWindow });
      query.eventId = eventId ? eventId : { $in: ids };
      if (eventId && !ids.includes(eventId)) query.eventId = '__none__';
    }

    const todayWindow = windowFor('today', localDate)!;
    const fifteenMinAgo = new Date(Date.now() - 15 * 60_000);

    const [drops, counts, last15Min, eventsAffected, todayEventIds] = await Promise.all([
      SeatDrop.find(query).sort(SORTS[sort] ?? SORTS.newest).limit(limit).lean(),
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
      Event.distinct('Event_ID', { Event_DateTime: todayWindow }),
    ]);

    const todayDrops = todayEventIds.length
      ? await SeatDrop.countDocuments({ eventId: { $in: todayEventIds } })
      : 0;

    // Attach the live event link + date. One batched query, not one per drop.
    const dropList = drops as unknown as EnrichedDrop[];
    const ids = [...new Set(dropList.map((d) => d.eventId))];
    const events = ids.length
      ? await Event.find(
          { Event_ID: { $in: ids } },
          { Event_ID: 1, URL: 1, Event_DateTime: 1, Event_Name: 1, Venue: 1, _id: 0 }
        ).lean()
      : [];
    const byId = new Map(
      (events as unknown as Array<Record<string, unknown>>).map((e) => [e.Event_ID as string, e])
    );

    const enriched = dropList.map((d) => {
      const ev = byId.get(d.eventId);
      return {
        ...d,
        event_url: (ev?.URL as string) ?? d.event_url ?? null,
        event_date: (ev?.Event_DateTime as Date) ?? d.event_date ?? null,
        event_name: (ev?.Event_Name as string) ?? d.event_name,
        venue_name: (ev?.Venue as string) ?? d.venue_name,
        // the Event row was deleted after the drop was recorded
        eventMissing: !ev,
      };
    });

    const c = counts[0] ?? { total: 0, active: 0, gone: 0, unseen: 0, seatsActive: 0 };

    const stats: DropStats = {
      total: c.total ?? 0,
      active: c.active ?? 0,
      gone: c.gone ?? 0,
      unseen: c.unseen ?? 0,
      seatsActive: c.seatsActive ?? 0,
      last15Min,
      eventsAffected: eventsAffected.length,
      todayDrops,
      todayEvents: todayEventIds.length,
    };

    return {
      success: true as const,
      serverTime: new Date().toISOString(),
      stats,
      drops: JSON.parse(JSON.stringify(enriched)),
    };
  } catch (error: unknown) {
    console.error('Error fetching seat drops:', error);
    return {
      success: false as const,
      error: error instanceof Error ? error.message : 'Failed to fetch seat drops',
    };
  }
}

/** Acknowledge specific drops — clears the alarm only, never deletes history. */
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
