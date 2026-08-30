import type { PipelineStage } from 'mongoose';

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
/**
 * How long a drop is held out of the CSV. Elapsed time, not a cycle count —
 * cycle cadence varies with load, so a count means a different amount of time
 * on every roster. Mirrors the scraper, which is what deletes a matured drop.
 */
export const MATURE_MIN_AGE_MS =
  Number(process.env.DROP_MATURE_MIN_AGE_MIN ?? 45) * 60 * 1000;

/**
 * How long a drop counts as "just landed".
 *
 * Freshness is decided on the server from detectedAt, not tracked in the
 * browser: the page re-renders every few seconds, and any class the client
 * pokes onto a row is wiped the moment React re-renders it.
 */
export const FRESH_WINDOW_MS = Number(process.env.DROP_FRESH_WINDOW_SEC ?? 60) * 1000;

/**
 * A drop still under observation: on sale and younger than MATURE_MIN_AGE_MS.
 * Built fresh each call because the cutoff moves with the clock.
 */
export function immatureMatch() {
  return {
    status: 'active' as const,
    detectedAt: { $gt: new Date(Date.now() - MATURE_MIN_AGE_MS) },
  };
}
export type DropSort = 'onSale' | 'newest' | 'oldest' | 'eventDate' | 'event' | 'seats' | 'price';

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
}

export interface DropRecord {
  _id: string;
  eventId: string;
  /**
   * From the Event join. event_name falls back to the drop's stored snapshot
   * only when the event row is gone; the others are join-only.
   */
  event_name?: string | null;
  venue_name?: string | null;
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
  /** Detected within FRESH_WINDOW_MS — "just landed", decided server-side. */
  isFresh?: boolean;
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
  // Default. 'active' sorts before 'gone' alphabetically, so seats you can
  // still act on come first and the newest of those is at the very top —
  // which is where a drop that just landed appears.
  onSale: { status: 1, detectedAt: -1 },
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

  // Base set: matured drops are gone from the collection entirely, gone ones
  // expire on their own TTL. This is only the status filter the viewer picked.
  const baseMatch: Record<string, unknown> = {
    $or: [{ status: 'gone' }, immatureMatch()],
  };
  if (status === 'active' || status === 'gone') baseMatch.status = status;

  const eventsCollection = Event.collection.name;

  // Date window and search both run against the JOINED event, so neither needs
  // a preliminary Event.distinct feeding a huge $in — those were two extra
  // round trips per refresh, and the $in grew with the roster.
  const postJoin: Record<string, unknown>[] = [];
  const dateWindow = windowFor(dateRange, date);
  if (dateWindow) postJoin.push({ joinedDate: dateWindow });
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: 'i' };
    postJoin.push({
      $or: [
        { joinedName: rx },
        { joinedVenue: rx },
        { eventId: rx },
        { section: rx },
        { row: rx },
      ],
    });
  }

  const freshCutoff = new Date(Date.now() - FRESH_WINDOW_MS);
  const fifteenMinAgo = new Date(Date.now() - 15 * 60_000);

  /**
   * One aggregation for the page: join, filter, then $facet out the rows, the
   * total, the events represented and how many just landed. Previously that was
   * five separate round trips, repeated every poll by every open tab.
   */
  const pipeline: PipelineStage[] = [
    { $match: baseMatch },
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
        joinedDate: '$_event.Event_DateTime',
        joinedName: '$_event.Event_Name',
        joinedVenue: '$_event.Venue',
      },
    },
    ...(postJoin.length ? [{ $match: { $and: postJoin } } as PipelineStage] : []),
    {
      $facet: {
        rows: [
          { $sort: SORTS[sort] ?? SORTS.onSale },
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
        ],
        total: [{ $count: 'n' }],
        events: [{ $group: { _id: '$eventId' } }, { $count: 'n' }],
        fresh: [{ $match: { detectedAt: { $gte: freshCutoff } } }, { $count: 'n' }],
      },
    },
  ];

  const [faceted, counts] = await Promise.all([
    SeatDrop.aggregate(pipeline).allowDiskUse(true),
    // Portfolio-wide counters for the tiles — deliberately unfiltered, which is
    // what the caption under them says.
    SeatDrop.aggregate([
      { $match: { $or: [{ status: 'gone' }, immatureMatch()] } },
      {
        $facet: {
          totals: [
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
          ],
          last15: [{ $match: { detectedAt: { $gte: fifteenMinAgo } } }, { $count: 'n' }],
          affected: [
            { $match: { status: 'active' } },
            { $group: { _id: '$eventId' } },
            { $count: 'n' },
          ],
        },
      },
    ]),
  ]);

  const facet = faceted[0] ?? {};
  const drops = (facet.rows ?? []) as unknown[];
  const total = facet.total?.[0]?.n ?? 0;
  const windowEvents = facet.events?.[0]?.n ?? 0;
  const freshCount = facet.fresh?.[0]?.n ?? 0;

  const statFacet = counts[0] ?? {};
  const c = statFacet.totals?.[0] ?? { total: 0, active: 0, gone: 0, unseen: 0, seatsActive: 0 };
  const last15Min = statFacet.last15?.[0]?.n ?? 0;
  const eventsAffected = statFacet.affected?.[0]?.n ?? 0;
  const windowDrops = total;

  const list = drops as unknown as Array<DropRecord & {
    _event?: { URL?: string; Event_DateTime?: string; Event_Name?: string; Venue?: string };
    joinedDate?: unknown;
    joinedName?: unknown;
    joinedVenue?: unknown;
  }>;

  const freshFrom = Date.now() - FRESH_WINDOW_MS;

  const enriched = list.map((d) => {
    const ev = d._event;
    const { _event, joinedDate, joinedName, joinedVenue, ...rest } = d;
    void _event; void joinedDate; void joinedName; void joinedVenue; // join scaffolding
    return {
      ...rest,
      event_url: ev?.URL ?? null,
      event_date: ev?.Event_DateTime ?? null,
      // The stored name is an epitaph for a deleted event, nothing more: the
      // live row wins whenever there is one, so the two cannot disagree.
      event_name: ev?.Event_Name ?? (ev ? null : d.event_name ?? null),
      venue_name: ev?.Venue ?? null,
      eventMissing: !ev,
      // Decided here, so it survives every re-render — the client cannot hold
      // a highlight of its own across a refresh.
      isFresh: new Date(d.detectedAt).getTime() >= freshFrom,
    };
  });

  const stats: DropStats = {
    total: c.total ?? 0,
    active: c.active ?? 0,
    gone: c.gone ?? 0,
    unseen: c.unseen ?? 0,
    seatsActive: c.seatsActive ?? 0,
    last15Min,
    eventsAffected,
    windowDrops,
    windowEvents,
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return {
    stats,
    resolvedDate: date,
    page: Math.min(page, totalPages),
    pageSize,
    total,
    totalPages,
    /** How many of the matched drops landed inside the fresh window. */
    freshCount,
    drops: JSON.parse(JSON.stringify(enriched)) as DropRecord[],
  };
}
