import dbConnect from '@/lib/dbConnect';
import { SeatDrop } from '@/models/seatDropModel';
import { Event } from '@/models/eventModel';

/**
 * Seat-drop queries. Plain server-side functions, not server actions — the
 * drops page is a Server Component and fetches during render, so there is no
 * reason to expose a POST endpoint for reads. Mutations live in
 * actions/dropActions.ts.
 *
 * DATE SEMANTICS — Event_DateTime stores the venue's LOCAL wall-clock encoded
 * as UTC (a 7pm Denver show is stored 19:00:00.000Z, see ImportEventsClient),
 * so every day window is built with Date.UTC and rendered with timeZone:'UTC'.
 */

export type DropDateRange = 'all' | 'today' | 'tomorrow' | 'week' | 'past';
export type DropSort = 'newest' | 'oldest' | 'eventDate' | 'event' | 'seats' | 'price';

export interface DropFilters {
  status?: 'all' | 'active' | 'gone';
  search?: string;
  dateRange?: DropDateRange;
  /** Operator's calendar day, YYYY-MM-DD. Defaults to the server's own day. */
  date?: string;
  sort?: DropSort;
  limit?: number;
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

export interface DropRecord {
  _id: string;
  eventId: string;
  event_name?: string;
  venue_name?: string;
  event_date?: string | null;
  event_url?: string | null;
  eventMissing?: boolean;
  section: string;
  row: string;
  newSeats: string[];
  newSeatCount: number;
  totalSeatsInRow?: number;
  listPrice?: number;
  isNewListing?: boolean;
  detectedAt: string;
  status: 'active' | 'gone';
  seatsRemaining?: string[];
  cyclesSeen?: number;
  missCount?: number;
  goneAt?: string | null;
  secondsAlive?: number | null;
  seen?: boolean;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Today as YYYY-MM-DD in the server's own timezone. */
export function serverToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function utcDayBounds(date: string, addDays = 0) {
  const [y, m, d] = date.split('-').map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, d + addDays, 0, 0, 0, 0)),
    end: new Date(Date.UTC(y, m - 1, d + addDays, 23, 59, 59, 999)),
  };
}

function windowFor(range: DropDateRange, date: string) {
  const today = utcDayBounds(date, 0);
  switch (range) {
    case 'today': return { $gte: today.start, $lte: today.end };
    case 'tomorrow': { const t = utcDayBounds(date, 1); return { $gte: t.start, $lte: t.end }; }
    case 'week': { const e = utcDayBounds(date, 6); return { $gte: today.start, $lte: e.end }; }
    case 'past': return { $lt: today.start };
    default: return null;
  }
}

const SORTS: Record<DropSort, Record<string, 1 | -1>> = {
  newest: { detectedAt: -1 },
  oldest: { detectedAt: 1 },
  eventDate: { event_date: 1, detectedAt: -1 },
  event: { event_name: 1, event_date: 1, detectedAt: -1 },
  seats: { newSeatCount: -1, detectedAt: -1 },
  price: { listPrice: -1, detectedAt: -1 },
};

/**
 * Drops matching the filters, plus portfolio-wide counters, in one round trip.
 *
 * Drops are enriched from the Event collection at read time: the scraper never
 * populates seat_drops.event_url, and the Event row is authoritative for the
 * link and date even if either changed after the drop was recorded.
 */
export async function fetchDrops(filters: DropFilters = {}) {
  await dbConnect();

  const {
    status = 'all',
    search = '',
    dateRange = 'all',
    sort = 'newest',
  } = filters;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(filters.date ?? '') ? filters.date! : serverToday();
  const limit = Math.min(Math.max(1, filters.limit ?? 150), 500);

  const query: Record<string, unknown> = {};
  if (status === 'active' || status === 'gone') query.status = status;

  if (search) {
    const rx = { $regex: escapeRegex(search), $options: 'i' };
    // Names are displayed from the Event join, so search has to resolve through
    // Event too — matching only the drop's denormalized copy misses anything
    // renamed since, or never denormalized at all.
    const matchedEventIds = await Event.distinct('Event_ID', {
      $or: [{ Event_Name: rx }, { Venue: rx }],
    });
    query.$or = [
      { eventId: { $in: matchedEventIds } },
      { eventId: rx },
      { section: rx },
      { row: rx },
      { event_name: rx },
      { venue_name: rx },
    ];
  }

  const dateWindow = windowFor(dateRange, date);
  if (dateWindow) {
    const ids = await Event.distinct('Event_ID', { Event_DateTime: dateWindow });
    // ANDed with any search $or above, so both constraints apply
    query.eventId = { $in: ids };
  }

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
          seatsActive: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, '$newSeatCount', 0] } },
        },
      },
    ]),
    SeatDrop.countDocuments({ detectedAt: { $gte: fifteenMinAgo } }),
    SeatDrop.distinct('eventId', { status: 'active' }),
    Event.distinct('Event_ID', { Event_DateTime: windowFor('today', date)! }),
  ]);

  const todayDrops = todayEventIds.length
    ? await SeatDrop.countDocuments({ eventId: { $in: todayEventIds } })
    : 0;

  const list = drops as unknown as DropRecord[];
  const ids = [...new Set(list.map((d) => d.eventId))];
  const events = ids.length
    ? await Event.find(
        { Event_ID: { $in: ids } },
        { Event_ID: 1, URL: 1, Event_DateTime: 1, Event_Name: 1, Venue: 1, _id: 0 }
      ).lean()
    : [];
  const byId = new Map(
    (events as unknown as Array<Record<string, unknown>>).map((e) => [e.Event_ID as string, e])
  );

  const enriched = list.map((d) => {
    const ev = byId.get(d.eventId);
    return {
      ...d,
      event_url: (ev?.URL as string) ?? null,
      event_date: (ev?.Event_DateTime as unknown as string) ?? d.event_date ?? null,
      event_name: (ev?.Event_Name as string) ?? d.event_name,
      venue_name: (ev?.Venue as string) ?? d.venue_name,
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
    stats,
    resolvedDate: date,
    drops: JSON.parse(JSON.stringify(enriched)) as DropRecord[],
  };
}
