import Link from 'next/link';
import {
  Zap, CheckCheck, Search, Clock, Ticket, XCircle, ExternalLink, ArrowUpDown, CalendarDays,
} from 'lucide-react';

import { fetchDrops } from '@/lib/drops';
import type { DropDateRange, DropSort, DropRecord } from '@/lib/drops';
import { acknowledgeDrop, acknowledgeAllDrops } from '@/actions/dropActions';
import DropsLive from './DropsLive';

/**
 * Server-rendered drops view. All filter state lives in the URL, so filtering
 * and sorting are plain links the server resolves — no client state, no
 * client-side fetching. Only DropsLive ships JavaScript.
 */

export interface DropsSearchParams {
  status?: string;
  range?: string;
  sort?: string;
  q?: string;
  date?: string;
}

const DATE_RANGES: { value: DropDateRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'week', label: 'Next 7 days' },
  { value: 'past', label: 'Past' },
  { value: 'all', label: 'All dates' },
];

const SORT_OPTIONS: { value: DropSort; label: string }[] = [
  { value: 'eventDate', label: 'Event date — soonest' },
  { value: 'newest', label: 'Drop time — newest' },
  { value: 'oldest', label: 'Drop time — oldest' },
  { value: 'event', label: 'Event name — A→Z' },
  { value: 'seats', label: 'Most seats' },
  { value: 'price', label: 'Highest price' },
];

const STATUSES = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'On Sale' },
  { value: 'gone', label: 'Gone' },
] as const;

/** Date/time formatting copied verbatim from EventsTableServerSide so a show
 *  reads identically on both screens. Event_DateTime is venue wall-clock
 *  encoded as UTC — dropping timeZone:'UTC' shifts evening shows a day. */
function formatEventDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}
function formatEventTime(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  });
}
/** Drop timestamps are real instants, so these render in the server locale. */
function clockTime(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
function duration(seconds?: number | null) {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export default async function DropsView({
  searchParams,
}: {
  searchParams: Promise<DropsSearchParams>;
}) {
  const sp = await searchParams;

  const range = (DATE_RANGES.find((r) => r.value === sp.range)?.value ?? 'today') as DropDateRange;
  const sort = (SORT_OPTIONS.find((s) => s.value === sp.sort)?.value ?? 'eventDate') as DropSort;
  const status = (STATUSES.find((s) => s.value === sp.status)?.value ?? 'all');
  const search = sp.q ?? '';
  const date = sp.date;

  const { stats, drops, resolvedDate } = await fetchDrops({
    status, search, dateRange: range, sort, date, limit: 150,
  });

  /** Build a link that changes one filter and preserves the rest. */
  const hrefWith = (patch: Partial<DropsSearchParams>) => {
    const next = new URLSearchParams();
    const merged = { status, range, sort, q: search, date, ...patch };
    if (merged.status && merged.status !== 'all') next.set('status', merged.status);
    if (merged.range && merged.range !== 'today') next.set('range', merged.range);
    if (merged.sort && merged.sort !== 'eventDate') next.set('sort', merged.sort);
    if (merged.q) next.set('q', merged.q);
    if (merged.date) next.set('date', merged.date);
    const qs = next.toString();
    return qs ? `/dashboard/drops?${qs}` : '/dashboard/drops';
  };

  // Group by event, preserving the sort order the database returned
  const grouped = new Map<string, DropRecord[]>();
  for (const d of drops) {
    if (!grouped.has(d.eventId)) grouped.set(d.eventId, []);
    grouped.get(d.eventId)!.push(d);
  }

  const activeSort = SORT_OPTIONS.find((s) => s.value === sort)!;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Zap className="w-6 h-6 text-amber-500" />
            Seat Drops
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            New seats appearing on tracked events — live, with an alarm when a drop lands.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <DropsLive
            latestDropId={drops[0]?._id ?? null}
            unseenCount={stats.unseen}
            resolvedDate={resolvedDate}
          />
          <form action={acknowledgeAllDrops}>
            <button
              type="submit"
              disabled={stats.unseen === 0}
              className="px-3 py-2 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
            >
              <CheckCheck className="w-4 h-4" /> Mark all seen
            </button>
          </form>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <StatTile label="Today's events" value={stats.todayEvents} tone="blue" sub={`${stats.todayDrops} drops`} />
        <StatTile label="On sale now" value={stats.active} tone="green" sub={`${stats.seatsActive} seats`} />
        <StatTile label="New (15 min)" value={stats.last15Min} tone="amber" sub="drops detected" />
        <StatTile label="Unacknowledged" value={stats.unseen} tone={stats.unseen > 0 ? 'red' : 'slate'} sub="need review" />
        <StatTile label="Gone again" value={stats.gone} tone="slate" sub="seats withdrawn" />
        <StatTile label="Events affected" value={stats.eventsAffected} tone="slate" sub="with live drops" />
      </div>
      <p className="-mt-3 text-xs text-slate-400">
        Totals cover every tracked event. The list below follows the filters you pick.
        {' '}Today resolves to {formatEventDate(`${resolvedDate}T12:00:00.000Z`)}.
      </p>

      {/* Filters — links, resolved on the server */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg overflow-hidden border border-slate-200">
          {DATE_RANGES.map(({ value, label }) => (
            <Link
              key={value}
              href={hrefWith({ range: value })}
              className={`px-3 py-2 text-sm flex items-center gap-1.5 ${
                range === value ? 'bg-purple-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {value === 'today' && <CalendarDays className="w-3.5 h-3.5" />}
              {label}
            </Link>
          ))}
        </div>

        <div className="flex rounded-lg overflow-hidden border border-slate-200">
          {STATUSES.map(({ value, label }) => (
            <Link
              key={value}
              href={hrefWith({ status: value })}
              className={`px-4 py-2 text-sm ${
                status === value ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {label}
            </Link>
          ))}
        </div>

        {/* GET form — works without JavaScript */}
        <form method="GET" action="/dashboard/drops" className="relative flex-1 min-w-[220px] max-w-md">
          {status !== 'all' && <input type="hidden" name="status" value={status} />}
          {range !== 'today' && <input type="hidden" name="range" value={range} />}
          {sort !== 'eventDate' && <input type="hidden" name="sort" value={sort} />}
          {date && <input type="hidden" name="date" value={date} />}
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            name="q"
            defaultValue={search}
            placeholder="Filter by event, venue, section…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-200"
          />
        </form>

        {/* Native disclosure — a dropdown with no JavaScript. The key remounts
            it whenever a filter changes, which closes it after a selection;
            <details> keeps its open state across client navigation otherwise,
            leaving the panel overlaying the list. */}
        <details key={`${sort}-${range}-${status}`} className="relative">
          <summary className="list-none cursor-pointer px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 flex items-center gap-2">
            <ArrowUpDown className="w-4 h-4 text-slate-400" />
            {activeSort.label}
          </summary>
          <div className="absolute right-0 mt-1 z-20 w-56 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
            {SORT_OPTIONS.map(({ value, label }) => (
              <Link
                key={value}
                href={hrefWith({ sort: value })}
                className={`block px-3 py-2 text-sm hover:bg-slate-50 ${
                  sort === value ? 'bg-purple-50 text-purple-800 font-medium' : 'text-slate-700'
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
        </details>
      </div>

      {/* Drops */}
      {drops.length === 0 ? (
        <div className="text-center py-16 text-slate-500 bg-white rounded-xl border border-slate-200">
          <Ticket className="w-8 h-8 mx-auto mb-3 text-slate-300" />
          <p className="font-medium">
            No drops {range === 'all' ? 'recorded yet' : `for ${DATE_RANGES.find((r) => r.value === range)?.label.toLowerCase()}`}
          </p>
          <p className="text-sm mt-1">
            A drop is written the moment new seat numbers appear on a tracked event.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {[...grouped.entries()].map(([eventId, eventDrops]) => (
            <div key={eventId} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-semibold text-slate-800 flex items-center gap-2 flex-wrap">
                    <span>{eventDrops[0].event_name || eventId}</span>
                    {eventDrops[0].eventMissing && (
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 uppercase"
                        title="No matching row in the events collection — the event may have been deleted"
                      >
                        Event deleted
                      </span>
                    )}
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {eventDrops[0].venue_name || 'Unknown venue'}{` · ${eventId}`}
                  </p>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-medium text-slate-800">{formatEventDate(eventDrops[0].event_date)}</p>
                    <p className="text-xs text-slate-500">{formatEventTime(eventDrops[0].event_date)}</p>
                  </div>
                  <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600">
                    {eventDrops.length} drop{eventDrops.length === 1 ? '' : 's'}
                  </span>
                  {eventDrops[0].event_url ? (
                    <a
                      href={eventDrops[0].event_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open this event on Ticketmaster"
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg bg-purple-600 text-white hover:bg-purple-700 shadow-sm transition-colors whitespace-nowrap"
                    >
                      <ExternalLink className="w-4 h-4" /> View event
                    </a>
                  ) : (
                    <span
                      title="No event URL — the event row is missing"
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg bg-slate-100 text-slate-400 cursor-not-allowed whitespace-nowrap"
                    >
                      <ExternalLink className="w-4 h-4" /> No link
                    </span>
                  )}
                </div>
              </div>

              <div className="divide-y divide-slate-100">
                {eventDrops.map((d) => <DropRow key={d._id} drop={d} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, sub, tone }: {
  label: string; value: number; sub: string;
  tone: 'green' | 'amber' | 'red' | 'slate' | 'blue';
}) {
  const tones = {
    blue: 'bg-blue-50 border-blue-200 text-blue-900',
    green: 'bg-green-50 border-green-200 text-green-900',
    amber: 'bg-amber-50 border-amber-200 text-amber-900',
    red: 'bg-red-50 border-red-200 text-red-900',
    slate: 'bg-white border-slate-200 text-slate-900',
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <p className="text-xs uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      <p className="text-xs opacity-60 mt-0.5">{sub}</p>
    </div>
  );
}

/**
 * One added seat. Green = still on sale, struck grey = withdrawn again, so a
 * partially-pulled drop reads at a glance.
 */
function SeatChip({ seat, withdrawn }: { seat: string; withdrawn: boolean }) {
  return (
    <span
      title={withdrawn ? `Seat ${seat} — withdrawn` : `Seat ${seat} — on sale`}
      className={`inline-flex items-center justify-center min-w-[2rem] px-2 py-1 rounded-md border text-sm font-bold tabular-nums ${
        withdrawn
          ? 'bg-slate-100 border-slate-200 text-slate-400 line-through'
          : 'bg-green-50 border-green-300 text-green-800'
      }`}
    >
      {seat}
    </span>
  );
}

function DropRow({ drop }: { drop: DropRecord }) {
  const gone = drop.status === 'gone';
  const partiallyGone =
    !gone && (drop.seatsRemaining?.length ?? 0) > 0 && drop.seatsRemaining!.length < drop.newSeatCount;

  return (
    <div className={`px-5 py-4 flex flex-wrap items-start gap-4 ${gone ? 'bg-slate-50/60' : 'bg-white'}`}>
      <div className="w-28 shrink-0">
        {gone ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-slate-200 text-slate-700">
            <XCircle className="w-3 h-3" /> GONE
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-green-100 text-green-800">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> ON SALE
          </span>
        )}
        {!drop.seen && (
          <span className="block mt-1.5 text-[10px] font-semibold text-red-600 uppercase tracking-wide">New</span>
        )}
      </div>

      <div className="flex-1 min-w-[280px]">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`font-semibold ${gone ? 'text-slate-500' : 'text-slate-800'}`}>
            Section {drop.section} · Row {drop.row}
          </span>
          {drop.isNewListing && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 uppercase">
              New listing
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-2">
          <span className={`text-xs font-bold px-2 py-1 rounded-md shrink-0 ${
            gone ? 'bg-slate-200 text-slate-600' : 'bg-green-600 text-white'
          }`}>
            +{drop.newSeatCount} seat{drop.newSeatCount === 1 ? '' : 's'}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {drop.newSeats.map((seat) => (
              <SeatChip
                key={seat}
                seat={seat}
                withdrawn={gone || (drop.seatsRemaining ? !drop.seatsRemaining.includes(seat) : false)}
              />
            ))}
          </div>
        </div>

        <p className="text-xs text-slate-500 mt-1.5">
          {drop.totalSeatsInRow != null
            ? `Row went ${Math.max(0, drop.totalSeatsInRow - drop.newSeatCount)} → ${drop.totalSeatsInRow} seats`
            : 'Row size unknown'}
          {drop.listPrice != null && ` · $${drop.listPrice.toFixed(2)} per seat`}
        </p>

        {partiallyGone && (
          <p className="text-xs text-amber-700 mt-1 font-medium">
            {drop.newSeatCount - drop.seatsRemaining!.length} of {drop.newSeatCount} already withdrawn — struck seats are gone
          </p>
        )}
      </div>

      <div className="w-24 shrink-0 text-right">
        <p className={`font-semibold ${gone ? 'text-slate-400' : 'text-slate-800'}`}>
          {drop.listPrice != null ? `$${drop.listPrice.toFixed(2)}` : '—'}
        </p>
        <p className="text-xs text-slate-400">per seat</p>
      </div>

      <div className="w-64 shrink-0 text-xs">
        <p className="text-slate-600 flex items-center gap-1">
          <Clock className="w-3 h-3 text-slate-400" />
          Appeared {clockTime(drop.detectedAt)}
        </p>
        {gone ? (
          <>
            <p className="text-slate-500 mt-1">Gone {clockTime(drop.goneAt)}</p>
            <p className="mt-1 font-medium text-slate-700">
              Lasted {drop.cyclesSeen ?? 1} cycle{(drop.cyclesSeen ?? 1) === 1 ? '' : 's'} · {duration(drop.secondsAlive)}
            </p>
          </>
        ) : (
          <>
            <p className="text-slate-500 mt-1">
              Still on sale · seen {drop.cyclesSeen ?? 1} cycle{(drop.cyclesSeen ?? 1) === 1 ? '' : 's'}
            </p>
            {(drop.missCount ?? 0) > 0 && (
              <p className="mt-1 text-amber-700 font-medium">
                Missing for {drop.missCount} cycle{drop.missCount === 1 ? '' : 's'} — may be going
              </p>
            )}
          </>
        )}
      </div>

      <div className="shrink-0">
        {!drop.seen && (
          <form action={acknowledgeDrop}>
            <input type="hidden" name="id" value={drop._id} />
            <button
              type="submit"
              className="px-2.5 py-1.5 text-xs rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 flex items-center gap-1"
            >
              <CheckCheck className="w-3 h-3" /> Seen
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
