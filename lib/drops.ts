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

export type DropDateRange = 'all' | 'last2' | 'today' | 'tomorrow' | 'week' | 'past';

/**
 * Scrape cycles a drop must survive before it stops being treated as a drop.
 *
 * Until then it is quarantined: hidden from this page and withheld from CSV
 * export (see buildDropQuarantineFilter in actions/csvActions.tsx). Once it
 * matures it is ordinary inventory — it leaves this page and joins the CSV.
 */
export const MATURE_CYCLES = Number(process.env.DROP_MATURE_CYCLES ?? 10);

/** A drop still under observation: on sale, but not yet proven. */
export const IMMATURE_MATCH = {
  status: 'active' as const,
  cyclesSeen: { $lt: MATURE_CYCLES },
};
export type DropSort = 'newest' | 'oldest' | 'eventDate' | 'event' | 'seats' | 'price';

export interface DropFilters {
  status?: 'all' | 'active' | 'gone';
  search?: string;
  dateRange?: DropDateRange;
  /** Operator's calendar day, YYYY-MM-DD. Defaults to the server's own day. */
  date?: string;
  sort?: DropSort;
  page?: number;
  pageSize?: number;
}

export interface DropStats {
  total: number;
  active: number;
  gone: number;
  unseen: number;
  seatsActive: number;
  last15Min: number;
  eventsAffected: number;
  windowDrops: number;
  windowEvents: number;
  /** Graduated to ordinary inventory — off this page, in the CSV. */
  matured: number;
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
    // Default view: yesterday and today, so an overnight drop is still on
    // screen the next morning.
    case 'last2': { const y = utcDayBounds(date, -1); return { $gte: y.start, $lte: today.end }; }
    case 'today': return { $gte: today.start, $lte: today.end };
    case 'tomorrow': { const t = utcDayBounds(date, 1); return { $gte: t.start, $lte: t.end }; }
    case 'week': { const e = utcDayBounds(date, 6); return { $gte: today.start, $lte: e.end }; }
    case 'past': return { $lt: today.start };
    default: return null;
  }
}

/**
 * Sorts run against the joined Event fields (joinedDate / joinedName), not the
 * drop's denormalized copies. Display and the date filter already resolve
 * through Event, so sorting on the stale copy would order the page by data the
 * viewer cannot see — and orders arbitrarily when a drop was written without
 * the denormalized fields at all.
 */
const SORTS: Record<DropSort, Record<string, 1 | -1>> = {
  newest: { detectedAt: -1 },
  oldest: { detectedAt: 1 },
  eventDate: { joinedDate: 1, detectedAt: -1 },
  event: { joinedName: 1, joinedDate: 1, detectedAt: -1 },
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
  const pageSize = Math.min(Math.max(1, filters.pageSize ?? 50), 200);
  const page = Math.max(1, filters.page ?? 1);

  const query: Record<string, unknown> = {};

  // Matured drops have graduated to ordinary inventory: off this page, and in
  // the CSV. Gone drops stay as history — they are not inventory any more.
  query.$and = [
    { $or: [{ status: 'gone' }, IMMATURE_MATCH] },
  ];

  if (status === 'active' || status === 'gone') query.status = status;

  if (search) {
    const rx = { $regex: escapeRegex(search), $options: 'i' };
    // Names are displayed from the Event join, so search has to resolve through
    // Event too — matching only the drop's denormalized copy misses anything
    // renamed since, or never denormalized at all.
    const matchedEventIds = await Event.distinct('Event_ID', {
      $or: [{ Event_Name: rx }, { Venue: rx }],
    });
    (query.$and as Record<string, unknown>[]).push({
      $or: [
        { eventId: { $in: matchedEventIds } },
        { eventId: rx },
        { section: rx },
        { row: rx },
        { event_name: rx },
        { venue_name: rx },
      ],
    });
  }

  const dateWindow = windowFor(dateRange, date);
  if (dateWindow) {
    const ids = await Event.distinct('Event_ID', { Event_DateTime: dateWindow });
    // ANDed with any search $or above, so both constraints apply
    query.eventId = { $in: ids };
  }

  const fifteenMinAgo = new Date(Date.now() - 15 * 60_000);

  // One aggregation: join Event, sort on the joined fields, then page. Joining
  // before the sort is what makes "event date" and "event name" order by what
  // is actually on screen.
  const eventsCollection = Event.collection.name;
  const pipeline = [
    { $match: query },
    {
      $lookup: {
        from: eventsCollection,
        localField: 'eventId',
        foreignField: 'Event_ID',
        as: '_event',
      },
    },
    { $addFields: { _event: { $first: '$_event' } } },
    {
      $addFields: {
        joinedDate: { $ifNull: ['$_event.Event_DateTime', '$event_date'] },
        joinedName: { $ifNull: ['$_event.Event_Name', '$event_name'] },
      },
    },
    { $sort: SORTS[sort] ?? SORTS.newest },
    { $skip: (page - 1) * pageSize },
    { $limit: pageSize },
  ];

  const [drops, total, counts, last15Min, eventsAffected, windowEventIds, matured] = await Promise.all([
    SeatDrop.aggregate(pipeline).allowDiskUse(true),
    SeatDrop.countDocuments(query),
    SeatDrop.aggregate([
      { $match: { $or: [{ status: 'gone' }, IMMATURE_MATCH] } },
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
    SeatDrop.distinct('eventId', { ...IMMATURE_MATCH }),
    Event.distinct('Event_ID', { Event_DateTime: windowFor(dateRange === 'all' ? 'last2' : dateRange, date) ?? {} }),
    SeatDrop.countDocuments({ status: 'active', cyclesSeen: { $gte: MATURE_CYCLES } }),
  ]);

  const windowDrops = windowEventIds.length
    ? await SeatDrop.countDocuments({
        eventId: { $in: windowEventIds },
        $or: [{ status: 'gone' }, IMMATURE_MATCH],
      })
    : 0;

  const list = drops as unknown as Array<DropRecord & {
    _event?: { URL?: string; Event_DateTime?: string; Event_Name?: string; Venue?: string };
    joinedDate?: unknown;
    joinedName?: unknown;
  }>;

  const enriched = list.map((d) => {
    const ev = d._event;
    const { _event, joinedDate, joinedName, ...rest } = d;
    void _event; void joinedDate; void joinedName; // join scaffolding, not payload
    return {
      ...rest,
      event_url: ev?.URL ?? null,
      event_date: ev?.Event_DateTime ?? d.event_date ?? null,
      event_name: ev?.Event_Name ?? d.event_name,
      venue_name: ev?.Venue ?? d.venue_name,
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
    windowDrops,
    windowEvents: windowEventIds.length,
    matured,
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return {
    stats,
    resolvedDate: date,
    page: Math.min(page, totalPages),
    pageSize,
    total,
    totalPages,
    drops: JSON.parse(JSON.stringify(enriched)) as DropRecord[],
  };
}
