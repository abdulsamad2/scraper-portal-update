'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Zap, Bell, BellOff, Loader2, AlertTriangle, CheckCheck, Search,
  Clock, Ticket, Radio, RefreshCw, XCircle,
} from 'lucide-react';

import { getDrops, acknowledgeDrops, acknowledgeAllDrops } from '@/actions/dropActions';
import type { DropStats } from '@/actions/dropActions';

type DropStatus = 'active' | 'gone';

interface Drop {
  _id: string;
  eventId: string;
  event_name?: string;
  venue_name?: string;
  event_date?: string;
  section: string;
  row: string;
  newSeats: string[];
  newSeatCount: number;
  totalSeatsInRow?: number;
  listPrice?: number;
  isNewListing?: boolean;
  detectedAt: string;
  status: DropStatus;
  seatsRemaining?: string[];
  lastSeenAt?: string;
  cyclesSeen?: number;
  missCount?: number;
  goneAt?: string | null;
  secondsAlive?: number | null;
  seen?: boolean;
}

const POLL_MS = 5000;
const FLASH_MS = 12_000; // how long a freshly-arrived drop stays highlighted

function timeAgo(iso?: string | null): string {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 10) return 'just now';
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function duration(seconds?: number | null): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function clockTime(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Two-tone chime via WebAudio — no asset file, and it cuts through a busy room. */
function useAlarm(muted: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);

  // Browsers block audio until the user has interacted with the page.
  useEffect(() => {
    const unlock = () => {
      if (!ctxRef.current) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctor) ctxRef.current = new Ctor();
      }
      void ctxRef.current?.resume();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  return useCallback(() => {
    if (muted) return;
    const ctx = ctxRef.current;
    if (!ctx) return;
    const beep = (freq: number, at: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.3);
    };
    beep(880, 0);
    beep(1320, 0.16);
  }, [muted]);
}

export default function DropsPage() {
  const [drops, setDrops] = useState<Drop[]>([]);
  const [stats, setStats] = useState<DropStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'gone'>('all');
  const [search, setSearch] = useState('');
  const [muted, setMuted] = useState(false);
  const [live, setLive] = useState(true);
  const [acking, setAcking] = useState(false);
  const [, setTick] = useState(0);

  // ids already rendered, so we can tell a genuinely new drop from a re-poll
  const knownIds = useRef<Set<string> | null>(null);
  const [flashing, setFlashing] = useState<Record<string, number>>({});
  const alarm = useAlarm(muted);

  useEffect(() => {
    const stored = localStorage.getItem('drops:muted');
    if (stored === '1') setMuted(true);
  }, []);
  useEffect(() => {
    localStorage.setItem('drops:muted', muted ? '1' : '0');
  }, [muted]);

  // Re-render once a second so "2m ago" stays honest between polls
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const fetchDrops = useCallback(async () => {
    try {
      const data = await getDrops({
        status: statusFilter,
        search: search.trim() || undefined,
        limit: 150,
      });
      if (!data.success) throw new Error(data.error || 'Request failed');

      const incoming: Drop[] = data.drops ?? [];
      setStats(data.stats);
      setDrops(incoming);
      setError(null);

      // First load establishes the baseline — it must not fire the alarm
      if (knownIds.current === null) {
        knownIds.current = new Set(incoming.map((d) => d._id));
      } else {
        const fresh = incoming.filter((d) => !knownIds.current!.has(d._id));
        if (fresh.length > 0) {
          const now = Date.now();
          setFlashing((prev) => {
            const next = { ...prev };
            fresh.forEach((d) => { next[d._id] = now; });
            return next;
          });
          alarm();
          fresh.forEach((d) => knownIds.current!.add(d._id));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load drops');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search, alarm]);

  useEffect(() => { void fetchDrops(); }, [fetchDrops]);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => { void fetchDrops(); }, POLL_MS);
    return () => clearInterval(id);
  }, [live, fetchDrops]);

  // Alarm the tab title too, so a background tab still gets noticed
  useEffect(() => {
    const unseen = stats?.unseen ?? 0;
    document.title = unseen > 0 ? `(${unseen}) Drops — Scraper Portal` : 'Drops — Scraper Portal';
    return () => { document.title = 'Scraper Portal'; };
  }, [stats?.unseen]);

  const acknowledge = async (ids?: string[]) => {
    setAcking(true);
    try {
      const res = ids ? await acknowledgeDrops(ids) : await acknowledgeAllDrops();
      if (!res.success) setError(res.error ?? 'Failed to acknowledge');
      await fetchDrops();
    } finally {
      setAcking(false);
    }
  };

  const isFlashing = (id: string) => {
    const at = flashing[id];
    return at !== undefined && Date.now() - at < FLASH_MS;
  };

  const grouped = useMemo(() => {
    const map = new Map<string, Drop[]>();
    for (const d of drops) {
      const key = d.eventId;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return [...map.entries()];
  }, [drops]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading drops…
      </div>
    );
  }

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
          <button
            onClick={() => setLive((v) => !v)}
            className={`px-3 py-2 text-sm rounded-lg flex items-center gap-2 ${
              live ? 'bg-green-100 text-green-800 hover:bg-green-200' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Radio className={`w-4 h-4 ${live ? 'animate-pulse' : ''}`} />
            {live ? `Live · ${POLL_MS / 1000}s` : 'Paused'}
          </button>
          <button
            onClick={() => setMuted((m) => !m)}
            title={muted ? 'Alarm muted' : 'Alarm on'}
            className={`px-3 py-2 text-sm rounded-lg flex items-center gap-2 ${
              muted ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
            }`}
          >
            {muted ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
            {muted ? 'Muted' : 'Alarm on'}
          </button>
          <button
            onClick={() => void fetchDrops()}
            className="px-3 py-2 text-sm rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button
            onClick={() => void acknowledge()}
            disabled={acking || (stats?.unseen ?? 0) === 0}
            className="px-3 py-2 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
          >
            {acking ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
            Mark all seen
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatTile label="On sale now" value={stats?.active ?? 0} tone="green" sub={`${stats?.seatsActive ?? 0} seats`} />
        <StatTile label="New (15 min)" value={stats?.last15Min ?? 0} tone="amber" sub="drops detected" />
        <StatTile label="Unacknowledged" value={stats?.unseen ?? 0} tone={(stats?.unseen ?? 0) > 0 ? 'red' : 'slate'} sub="need review" />
        <StatTile label="Gone again" value={stats?.gone ?? 0} tone="slate" sub="seats withdrawn" />
        <StatTile label="Events affected" value={stats?.eventsAffected ?? 0} tone="slate" sub="with live drops" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg overflow-hidden border border-slate-200">
          {(['all', 'active', 'gone'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-4 py-2 text-sm capitalize ${
                statusFilter === s ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {s === 'all' ? 'All' : s === 'active' ? 'On sale' : 'Gone'}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by event, venue, section…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-200"
          />
        </div>
      </div>

      {/* Drops */}
      {drops.length === 0 ? (
        <div className="text-center py-16 text-slate-500 bg-white rounded-xl border border-slate-200">
          <Ticket className="w-8 h-8 mx-auto mb-3 text-slate-300" />
          <p className="font-medium">No drops recorded yet</p>
          <p className="text-sm mt-1">
            A drop is written the moment new seat numbers appear on a tracked event.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([eventId, eventDrops]) => (
            <div key={eventId} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-semibold text-slate-800">
                    {eventDrops[0].event_name || eventId}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {eventDrops[0].venue_name || 'Unknown venue'}
                    {eventDrops[0].event_date && ` · ${new Date(eventDrops[0].event_date).toLocaleDateString()}`}
                    {` · ${eventId}`}
                  </p>
                </div>
                <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600">
                  {eventDrops.length} drop{eventDrops.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="divide-y divide-slate-100">
                {eventDrops.map((d) => (
                  <DropRow
                    key={d._id}
                    drop={d}
                    flashing={isFlashing(d._id)}
                    onAck={() => void acknowledge([d._id])}
                  />
                ))}
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
  tone: 'green' | 'amber' | 'red' | 'slate';
}) {
  const tones = {
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

function DropRow({ drop, flashing, onAck }: { drop: Drop; flashing: boolean; onAck: () => void }) {
  const gone = drop.status === 'gone';
  const partiallyGone =
    !gone && (drop.seatsRemaining?.length ?? 0) > 0 && drop.seatsRemaining!.length < drop.newSeatCount;

  return (
    <div
      className={`px-5 py-4 flex flex-wrap items-start gap-4 transition-colors duration-700 ${
        flashing ? 'bg-amber-50 ring-1 ring-inset ring-amber-300' : gone ? 'bg-slate-50/60' : 'bg-white'
      }`}
    >
      {/* Status */}
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
          <span className="block mt-1.5 text-[10px] font-semibold text-red-600 uppercase tracking-wide">
            New
          </span>
        )}
      </div>

      {/* Seats */}
      <div className="flex-1 min-w-[240px]">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className={`font-semibold ${gone ? 'text-slate-500' : 'text-slate-800'}`}>
            Section {drop.section} · Row {drop.row}
          </span>
          {drop.isNewListing && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 uppercase">
              New listing
            </span>
          )}
        </div>
        <p className={`text-sm mt-1 ${gone ? 'text-slate-400 line-through' : 'text-slate-600'}`}>
          <span className="font-medium">{drop.newSeatCount} seat{drop.newSeatCount === 1 ? '' : 's'}</span>
          {' · '}#{drop.newSeats.join(', ')}
          {drop.totalSeatsInRow ? ` · row now ${drop.totalSeatsInRow}` : ''}
        </p>
        {partiallyGone && (
          <p className="text-xs text-amber-700 mt-1">
            {drop.seatsRemaining!.length} of {drop.newSeatCount} still on sale (#{drop.seatsRemaining!.join(', ')})
          </p>
        )}
      </div>

      {/* Price */}
      <div className="w-24 shrink-0 text-right">
        <p className={`font-semibold ${gone ? 'text-slate-400' : 'text-slate-800'}`}>
          {drop.listPrice != null ? `$${drop.listPrice.toFixed(2)}` : '—'}
        </p>
        <p className="text-xs text-slate-400">list price</p>
      </div>

      {/* Lifecycle — the "appeared, then gone" story */}
      <div className="w-64 shrink-0 text-xs">
        <p className="text-slate-600 flex items-center gap-1">
          <Clock className="w-3 h-3 text-slate-400" />
          Appeared {clockTime(drop.detectedAt)} · {timeAgo(drop.detectedAt)}
        </p>
        {gone ? (
          <>
            <p className="text-slate-500 mt-1">
              Gone {clockTime(drop.goneAt)} · {timeAgo(drop.goneAt)}
            </p>
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

      {/* Ack */}
      <div className="shrink-0">
        {!drop.seen && (
          <button
            onClick={onAck}
            className="px-2.5 py-1.5 text-xs rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 flex items-center gap-1"
          >
            <CheckCheck className="w-3 h-3" /> Seen
          </button>
        )}
      </div>
    </div>
  );
}
