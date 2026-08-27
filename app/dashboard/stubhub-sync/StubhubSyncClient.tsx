'use client';

/**
 * StubHub POS sync control panel — interactive half.
 *
 * Seeded with server-rendered state, so it is useful on first paint rather than
 * after a round-trip. It refreshes on a timer to keep the live numbers honest.
 *
 * ── What this page is for ──────────────────────────────────────────────────────
 *
 * The CSV page controlled a scheduler that ran on a timer, and "when does it next
 * run" was the only question worth asking. This controls a drain loop that runs
 * continuously and sleeps only when the queue is empty, so the useful questions
 * are different and there are three of them:
 *
 *   1. Is it keeping up?          lag, and whether the backlog is rising
 *   2. Is it doing anything?      throughput, not a cumulative counter
 *   3. What is stuck, and why?    parked rows with reasons, and a way to unstick
 *
 * The layout follows that order deliberately. A verdict first, because an
 * operator opening this page under pressure needs an answer before they need
 * data; then the rate of work; then the detail.
 *
 * ── Two things this page previously got wrong ──────────────────────────────────
 *
 * It rendered the header counters from a live poll and the detail panels from the
 * server render, so within two seconds of loading, "195 rows waiting" sat beside a
 * by-event list adding up to 379. Both were true once. Neither was true together.
 * The whole snapshot now arrives from one call and is replaced as one value —
 * never merged — so the panels cannot drift apart.
 *
 * And it showed lifetime totals as the only measure of activity. After a bug that
 * failed 3,259 rows, that column read "3,259 failed" against "1,368 created"
 * forever, long after the cause was fixed, which is worse than useless: it hides
 * the recovery it is supposed to show. Lifetime totals are still here, but small
 * and clearly labelled, and the number given prominence is what has happened
 * since this page was opened.
 *
 * Every render path assumes the data might be missing. This is the page someone
 * opens when something is wrong, so it has to survive a database that is slow,
 * unreachable, or has never had a sync run against it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Radio, Play, Square, Zap, ShieldCheck, ShieldAlert, Loader2, AlertTriangle,
  Clock, Layers, Trash2, RefreshCw, Search, ChevronDown, ChevronRight, Ban,
  Activity, CheckCircle2, RotateCcw, Gauge, TrendingUp, TrendingDown, Minus,
} from 'lucide-react';

export interface SyncSnapshot {
  ok: boolean;
  loadError?: string;
  running: boolean;
  startedAt?: string | null;
  observedAt?: string;
  lease: { holder: string; expiresAt: string } | null;
  pendingRows: number;
  pendingTombstones: number;
  failedRows: number;
  lagSeconds: number;
  configured: boolean;
  dryRun: boolean;
  dryRunPinnedByEnv: boolean;
  maxAttempts: number;
  limiters: Array<{ endpoint: string; perMinute: number; burst: number; capacity: number }>;
  failures: Array<{ inventoryId: number; mappingId: string; section: string; row: string; error: string; attempts: number }>;
  skips: Array<{ reason: string; count: number }>;
  byEvent: Array<{ mappingId: string; count: number; oldest: string | null }>;
  states: Record<string, number>;
  settings: {
    isRunning: boolean;
    dryRun: boolean;
    marketplaces: string[];
    lastDrainAt: string | null;
    lastDrainResult: string | null;
    lastError: string | null;
    totals: { created: number; updated: number; delisted: number; deleted: number; failed: number };
  };
}

interface DrainResult {
  claimed: number; created: number; updated: number; noop: number;
  skipped: number; failed: number; delisted: number; deleted: number;
  cancelled: number; aborted: string | null; more: boolean;
}

interface DriftResult {
  summary: string;
  scanned: number;
  tracked: number;
  pendingRemoval: number;
  orphans: Array<{ listingId: number; externalId: string | null }>;
  ghosts: Array<{ inventoryId: number; listingId: string }>;
  priceMismatches: Array<{ externalId: string; ours: number; theirs: number }>;
  truncated: boolean;
}

/** One poll, kept so the page can show a trend rather than an instant. */
interface Sample {
  at: number;
  pending: number;
  /** created + updated + delisted + deleted, lifetime. Differenced for a rate. */
  done: number;
}

/** How much history to keep. At 2s polls this is roughly the last four minutes. */
const HISTORY = 120;

/** Unknown and zero are different facts. Never render one as the other. */
const num = (n: number | undefined | null) =>
  typeof n === 'number' ? n.toLocaleString() : '—';

const fmtLag = (s: number | undefined) => {
  if (typeof s !== 'number') return '—';
  if (s <= 0) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

const ago = (iso: string | null | undefined) => {
  if (!iso) return null;
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  return s < 2 ? 'just now' : `${fmtLag(s)} ago`;
};

/**
 * The pipeline, in the order a row travels it.
 *
 * A single "rows waiting" number collapses all of this, and the collapse hides
 * the distinction that matters most during an incident: rows sitting in `pending`
 * mean the worker is not picking them up, while rows piled in `creating` mean it
 * picked them up and something downstream is not answering. Those need opposite
 * responses and look identical from a queue depth.
 */
const PIPELINE: Array<{ key: string; label: string; tone: 'wait' | 'work' | 'done' | 'bad' }> = [
  { key: 'pending',  label: 'Pending',  tone: 'wait' },
  { key: 'creating', label: 'Creating', tone: 'work' },
  { key: 'created',  label: 'Created',  tone: 'work' },
  { key: 'dirty',    label: 'Dirty',    tone: 'wait' },
  { key: 'updating', label: 'Updating', tone: 'work' },
  { key: 'synced',   label: 'Synced',   tone: 'done' },
  { key: 'deleting', label: 'Deleting', tone: 'work' },
  { key: 'failed',   label: 'Parked',   tone: 'bad'  },
  { key: 'skipped',  label: 'Skipped',  tone: 'bad'  },
];

export default function StubhubSyncClient({ initial }: { initial: SyncSnapshot }) {
  const [snap, setSnap] = useState<SyncSnapshot>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastDrain, setLastDrain] = useState<DrainResult | null>(null);
  const [drift, setDrift] = useState<DriftResult | null>(null);
  const [error, setError] = useState<string | null>(initial.loadError ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showFailures, setShowFailures] = useState(false);
  const [showDrift, setShowDrift] = useState(false);
  const [history, setHistory] = useState<Sample[]>([]);

  // Lifetime totals at the moment this page opened. Everything headline is
  // measured against this, so a counter poisoned by an old incident cannot go on
  // colouring the operator's read of what is happening now.
  const baseline = useRef<SyncSnapshot['settings']['totals'] | null>(null);

  const record = useCallback((s: SyncSnapshot) => {
    const t = s.settings?.totals;
    if (!t) return;
    if (!baseline.current) baseline.current = { ...t };
    const done = (t.created ?? 0) + (t.updated ?? 0) + (t.delisted ?? 0) + (t.deleted ?? 0);
    setHistory(prev => {
      const next = [...prev, { at: Date.now(), pending: s.pendingRows ?? 0, done }];
      return next.length > HISTORY ? next.slice(-HISTORY) : next;
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/stubhub-sync', { cache: 'no-store' });
      const data = await res.json();
      if (data?.success) {
        // Replaced wholesale, never merged. The API now returns the complete
        // snapshot, and merging is what let the header and the detail panels
        // describe two different moments in time.
        const next = { ...data, ok: true } as SyncSnapshot;
        setSnap(next);
        record(next);
        setError(null);
      } else {
        setError(data?.message ?? 'Could not read sync state');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the sync API');
    }
  }, [record]);

  useEffect(() => { record(initial); }, [initial, record]);

  useEffect(() => {
    const ms = snap.running ? 2000 : 8000;
    const t = setInterval(load, ms);
    return () => clearInterval(t);
  }, [load, snap.running]);

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/stubhub-sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      if (!data?.success) setError(data?.message ?? `${action} failed`);
      if (action === 'drain' && typeof data?.claimed === 'number') setLastDrain(data);
      if (action === 'audit' && data?.success) { setDrift(data as DriftResult); setShowDrift(true); }
      if (action === 'retry' && data?.success) {
        setNotice(
          data.revived > 0
            ? `${data.revived} row(s) returned to the queue with their attempt count reset.`
            : 'Nothing was parked — no rows to return.'
        );
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : `${action} failed`);
    } finally {
      setBusy(null);
    }
  };

  const live = snap.ok && snap.dryRun === false;
  const totals = snap.settings?.totals;
  const marketplaces = snap.settings?.marketplaces ?? ['StubHub'];

  // ── Derived measures ─────────────────────────────────────────────────────────
  //
  // Throughput is differenced from the lifetime counters rather than reported by
  // the worker, because the worker only writes its totals at the end of a pass
  // and a rate computed from that lands in bursts. Differencing polls gives a
  // number that moves continuously, which is what makes "is it doing anything"
  // answerable at a glance.
  const first = history[0];
  const last = history[history.length - 1];
  const windowSeconds = first && last ? (last.at - first.at) / 1000 : 0;
  const throughput = windowSeconds > 5 && last && first
    ? Math.max(0, (last.done - first.done) / windowSeconds) * 60
    : null;

  const sessionDone = baseline.current && totals
    ? {
        created: Math.max(0, totals.created - baseline.current.created),
        updated: Math.max(0, totals.updated - baseline.current.updated),
        delisted: Math.max(0, totals.delisted - baseline.current.delisted),
        deleted: Math.max(0, totals.deleted - baseline.current.deleted),
        failed: Math.max(0, totals.failed - baseline.current.failed),
      }
    : null;

  // Backlog direction over the last ~30 samples. "Falling behind" is not a queue
  // depth, it is a queue depth that keeps growing, and the two are easy to
  // confuse when a scrape cycle lands.
  const recent = history.slice(-30);
  const trend = recent.length >= 6
    ? recent[recent.length - 1].pending - recent[0].pending
    : 0;

  // Time to clear, from the observed rate. Only shown when there is a real rate
  // to divide by — an estimate built on a rate of zero is an infinity dressed up
  // as information.
  const etaMinutes = throughput && throughput > 1 && snap.pendingRows > 0
    ? snap.pendingRows / throughput
    : null;

  // A page that cannot read its own state must say so and stop, rather than
  // rendering zeros. "0 rows waiting" and "I cannot see the queue" look identical
  // on a dashboard and mean opposite things, and this is the page someone opens
  // precisely when they suspect something is wrong.
  if (!snap.ok) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Radio className="w-6 h-6 text-slate-400" /> StubHub POS Sync
        </h1>
        <div className="bg-red-50 border border-red-200 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <h2 className="font-semibold text-red-900">Cannot read sync state</h2>
              <p className="text-sm text-red-800 mt-1">
                {snap.loadError || error || 'The database did not answer.'}
              </p>
              <p className="text-xs text-red-700 mt-2">
                No queue numbers are shown because none could be read — they would be
                indistinguishable from an empty queue. The worker itself is unaffected by this
                page; if it was running, it still is.
              </p>
            </div>
          </div>
          <button
            onClick={load}
            className="mt-4 px-3 py-2 text-sm rounded-lg border border-red-300 bg-white hover:bg-red-50 flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" /> Try again
          </button>
        </div>
      </div>
    );
  }

  const verdict = assess(snap, trend);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Command rail ───────────────────────────────────────────────────────
          Status and every control on one line, fixed at the top. During a cutover
          you are switching between dry run and live and running single passes
          repeatedly; those controls should not move as panels below grow and
          shrink. */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2.5 mr-auto">
            <div className="w-9 h-9 rounded-lg bg-slate-900 flex items-center justify-center shrink-0">
              <Radio className="w-5 h-5 text-teal-400" />
            </div>
            <div className="leading-tight">
              <div className="font-semibold text-slate-900 text-sm">StubHub POS Sync</div>
              <div className="text-xs text-slate-500">
                {marketplaces.join(' · ')}
                {snap.observedAt && <> · read {ago(snap.observedAt)}</>}
              </div>
            </div>
          </div>

          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${
            live ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
          }`}>
            {live ? <ShieldAlert className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
            {live ? 'LIVE' : 'DRY RUN'}
          </span>

          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${
            snap.running ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-slate-100 text-slate-600 border-slate-200'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${snap.running ? 'bg-teal-500 animate-pulse' : 'bg-slate-400'}`} />
            {snap.running ? 'Draining' : 'Stopped'}
          </span>

          <div className="flex items-center gap-2">
            <button
              disabled={busy !== null || snap.dryRunPinnedByEnv}
              onClick={() => act('settings', { dryRun: !snap.dryRun })}
              title={snap.dryRunPinnedByEnv ? 'Pinned by STUBHUB_DRY_RUN in the environment' : undefined}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                live
                  ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                  : 'border-red-300 text-red-700 hover:bg-red-50'
              }`}
            >
              {busy === 'settings' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : live ? 'Switch to dry run' : 'Go live'}
            </button>

            <button
              disabled={busy !== null || !snap.configured}
              onClick={() => act('drain')}
              title="Run exactly one pass and report what it did. The safe way to see what it would do."
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 disabled:opacity-40"
            >
              {busy === 'drain' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              Run once
            </button>

            {snap.running ? (
              <button
                disabled={busy !== null}
                onClick={() => act('stop')}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 flex items-center gap-1.5 disabled:opacity-40"
              >
                {busy === 'stop' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
                Stop
              </button>
            ) : (
              <button
                disabled={busy !== null || !snap.configured}
                onClick={() => act('start')}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-teal-600 text-white hover:bg-teal-700 flex items-center gap-1.5 disabled:opacity-40"
              >
                {busy === 'start' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                Start
              </button>
            )}

            <button
              onClick={load}
              title="Refresh now"
              className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-5">
        {error && (
          <Banner tone="bad" icon={<AlertTriangle className="w-5 h-5" />}>{error}</Banner>
        )}
        {notice && (
          <Banner tone="good" icon={<CheckCircle2 className="w-5 h-5" />}>{notice}</Banner>
        )}
        {!snap.configured && (
          <Banner tone="warn" icon={<AlertTriangle className="w-5 h-5" />}>
            <strong>Not configured.</strong> Set{' '}
            <code className="bg-amber-100 px-1 rounded">STUBHUB_BEARER_TOKEN</code> and{' '}
            <code className="bg-amber-100 px-1 rounded">STUBHUB_ACCOUNT_ID</code>, then restart.
          </Banner>
        )}

        {/* ── Verdict ──────────────────────────────────────────────────────────
            One sentence, before any numbers. Someone opening this page under
            pressure needs to know whether to act before they need data to act
            on, and a grid of counters makes them derive that for themselves. */}
        <section className={`rounded-xl border p-5 ${verdict.wrap}`}>
          <div className="flex items-start gap-3.5">
            <div className={`shrink-0 mt-0.5 ${verdict.iconColour}`}>{verdict.icon}</div>
            <div className="min-w-0">
              <h2 className={`font-semibold ${verdict.titleColour}`}>{verdict.title}</h2>
              <p className={`text-sm mt-0.5 ${verdict.bodyColour}`}>{verdict.detail}</p>
              {verdict.notes.length > 0 && (
                <ul className={`text-xs mt-2 space-y-0.5 ${verdict.bodyColour}`}>
                  {verdict.notes.map(n => <li key={n}>· {n}</li>)}
                </ul>
              )}
            </div>
          </div>
        </section>

        {/* ── The five numbers ─────────────────────────────────────────────── */}
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Stat
            icon={<Layers className="w-4 h-4" />}
            label="Rows waiting"
            value={num(snap.pendingRows)}
            hint="Changes not yet pushed"
            trend={trend}
            spark={history.map(h => h.pending)}
          />
          <Stat
            icon={<Trash2 className="w-4 h-4" />}
            label="Removals waiting"
            value={num(snap.pendingTombstones)}
            hint="Deletes queued on StubHub"
          />
          <Stat
            icon={<Clock className="w-4 h-4" />}
            label="Sync lag"
            value={fmtLag(snap.lagSeconds)}
            hint="Age of the oldest unpushed change"
            tone={snap.lagSeconds > 300 ? 'bad' : snap.lagSeconds > 60 ? 'warn' : undefined}
          />
          <Stat
            icon={<Activity className="w-4 h-4" />}
            label="Throughput"
            value={throughput === null ? '—' : `${Math.round(throughput).toLocaleString()}/min`}
            hint={
              throughput === null ? 'Measuring…'
              : etaMinutes ? `Clears the backlog in ~${fmtLag(Math.round(etaMinutes * 60))}`
              : 'Rows written to StubHub'
            }
            tone={throughput !== null && throughput === 0 && snap.pendingRows > 0 ? 'bad' : undefined}
          />
          <Stat
            icon={<Ban className="w-4 h-4" />}
            label="Parked"
            value={num(snap.failedRows)}
            hint={`Gave up after ${snap.maxAttempts ?? 5} attempts`}
            tone={snap.failedRows > 0 ? 'bad' : undefined}
            action={snap.failedRows > 0 ? {
              label: busy === 'retry' ? 'Retrying…' : 'Return to queue',
              onClick: () => act('retry'),
              disabled: busy !== null,
            } : undefined}
          />
        </section>

        {/* ── Pipeline ─────────────────────────────────────────────────────────
            Where rows actually sit. See the PIPELINE comment above for why this
            is worth the space a single queue depth would take. */}
        <section className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-baseline justify-between gap-3 mb-4">
            <h2 className="font-semibold text-slate-900">Pipeline</h2>
            <p className="text-xs text-slate-500">
              Every tracked row, by the stage it is in right now.
            </p>
          </div>
          <PipelineStrip states={snap.states ?? {}} />
        </section>

        <div className="grid lg:grid-cols-2 gap-5">
          {/* ── Work done ────────────────────────────────────────────────────── */}
          <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <div>
              <h2 className="font-semibold text-slate-900">Work done</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Since this page was opened. Lifetime counters are below — they include
                every historical failure and are not a measure of current health.
              </p>
            </div>

            {sessionDone ? (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <Tile label="Created"  n={sessionDone.created}  tone="good" />
                <Tile label="Updated"  n={sessionDone.updated}  tone="good" />
                <Tile label="Delisted" n={sessionDone.delisted} />
                <Tile label="Deleted"  n={sessionDone.deleted} />
                <Tile label="Failed"   n={sessionDone.failed}   tone="bad" />
              </div>
            ) : (
              <p className="text-sm text-slate-400">Waiting for the first reading…</p>
            )}

            {lastDrain && (
              <div className="pt-3 border-t border-slate-100">
                <div className="text-xs font-medium text-slate-500 mb-2">Last manual pass</div>
                <div className="flex flex-wrap gap-1.5">
                  <Pill label="claimed" n={lastDrain.claimed} />
                  <Pill label="created" n={lastDrain.created} tone="good" />
                  <Pill label="updated" n={lastDrain.updated} tone="good" />
                  <Pill label="unchanged" n={lastDrain.noop} />
                  <Pill label="delisted" n={lastDrain.delisted} />
                  <Pill label="deleted" n={lastDrain.deleted} />
                  <Pill label="skipped" n={lastDrain.skipped} tone={lastDrain.skipped ? 'warn' : undefined} />
                  <Pill label="failed" n={lastDrain.failed} tone={lastDrain.failed ? 'bad' : undefined} />
                </div>
                {lastDrain.noop > 0 && (
                  <p className="text-xs text-slate-500 mt-2">
                    {lastDrain.noop} row(s) already matched what StubHub holds — no call was made for those.
                  </p>
                )}
                {lastDrain.aborted && <p className="text-sm text-red-700 mt-2">Aborted: {lastDrain.aborted}</p>}
              </div>
            )}

            {totals && (
              <div className="pt-3 border-t border-slate-100 text-xs text-slate-500">
                Lifetime: {totals.created.toLocaleString()} created · {totals.updated.toLocaleString()} updated ·{' '}
                {totals.delisted.toLocaleString()} delisted · {totals.deleted.toLocaleString()} deleted ·{' '}
                <span className={totals.failed > 0 ? 'text-slate-600 font-medium' : ''}>
                  {totals.failed.toLocaleString()} failed
                </span>
              </div>
            )}
          </section>

          {/* ── Backlog by event ─────────────────────────────────────────────── */}
          <section className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-semibold text-slate-900">Backlog by event</h2>
              {snap.byEvent?.length > 0 && (
                <span className="text-xs text-slate-400">top {snap.byEvent.length}</span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5 mb-3">
              A single queue depth cannot tell you whether one event is stuck or everything is
              simply busy.
            </p>
            {snap.byEvent?.length > 0 ? (
              <div className="space-y-1">
                {(() => {
                  const max = Math.max(...snap.byEvent.map(e => e.count), 1);
                  return snap.byEvent.map(e => (
                    <div key={e.mappingId || 'none'} className="flex items-center gap-3 text-sm py-1">
                      <code className="text-xs text-slate-600 w-28 shrink-0 truncate">
                        {e.mappingId || '(no mapping id)'}
                      </code>
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-teal-500 rounded-full"
                          style={{ width: `${(e.count / max) * 100}%` }}
                        />
                      </div>
                      <span className="text-slate-400 text-xs w-16 text-right shrink-0">{ago(e.oldest)}</span>
                      <span className="font-medium tabular-nums text-slate-900 w-12 text-right shrink-0">
                        {e.count.toLocaleString()}
                      </span>
                    </div>
                  ));
                })()}
              </div>
            ) : (
              <Empty>Nothing waiting.</Empty>
            )}
          </section>
        </div>

        {/* ── Parked rows ──────────────────────────────────────────────────────
            The most useful panel during a cutover, and the one that needed an
            action attached to it. Twice now, everything parked here was parked by
            a bug in this code rather than by bad data, and the only remedy was a
            hand-written database update. */}
        <section className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <button
              onClick={() => setShowFailures(v => !v)}
              className="flex items-center gap-2 text-left"
              disabled={!snap.failures?.length}
            >
              <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                {snap.failures?.length ? <AlertTriangle className="w-4 h-4 text-red-600" /> : <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                Rows needing attention
                {snap.failures?.length ? ` (${snap.failures.length})` : ''}
              </h2>
              {snap.failures?.length > 0 && (showFailures
                ? <ChevronDown className="w-4 h-4 text-slate-400" />
                : <ChevronRight className="w-4 h-4 text-slate-400" />)}
            </button>
            {snap.failedRows > 0 && (
              <button
                disabled={busy !== null}
                onClick={() => act('retry')}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 disabled:opacity-40"
                title="Reset the attempt count and put them back in the queue. Safe: every write path is idempotent."
              >
                {busy === 'retry' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                Return {snap.failedRows.toLocaleString()} to the queue
              </button>
            )}
          </div>

          {!snap.failures?.length && (
            <p className="text-xs text-slate-500 mt-1">Nothing has exhausted its retries.</p>
          )}

          {showFailures && snap.failures?.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm min-w-[680px]">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-slate-100">
                    <th className="text-left font-medium py-2">Inventory</th>
                    <th className="text-left font-medium py-2">Event</th>
                    <th className="text-left font-medium py-2">Seat</th>
                    <th className="text-right font-medium py-2 pr-3">Tries</th>
                    <th className="text-left font-medium py-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.failures.map(f => (
                    <tr key={f.inventoryId} className="border-b border-slate-50 last:border-0 align-top">
                      <td className="py-2 pr-3"><code className="text-xs">{f.inventoryId}</code></td>
                      <td className="py-2 pr-3"><code className="text-xs text-slate-500">{f.mappingId}</code></td>
                      <td className="py-2 pr-3 text-slate-600 text-xs whitespace-nowrap">{f.section} {f.row}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-xs text-slate-500">{f.attempts}</td>
                      <td className="py-2 text-xs text-red-700">{f.error || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {snap.skips?.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <h3 className="text-sm font-medium text-slate-700">Skipped</h3>
              <p className="text-xs text-slate-500 mt-0.5 mb-2">
                Not failures — these cannot be represented on StubHub, so they are ignored rather
                than retried. A rising count means something changed upstream.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {snap.skips.map(s => (
                  <span key={s.reason} className="px-2.5 py-1 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-xs font-medium">
                    {s.count.toLocaleString()} × {s.reason}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ── Drift ────────────────────────────────────────────────────────────
            Read-only reconciliation against what StubHub actually holds. An
            orphan is a live listing with nothing local pointing at it, which is
            the one failure mode this system cannot fix by itself: the row that
            named the listing is gone, so no amount of draining will reach it. */}
        <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-semibold text-slate-900">Drift</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Compares what StubHub holds against what we believe we sent. Read-only — it
                reports, it never fixes.
              </p>
            </div>
            <button
              disabled={busy !== null || !snap.configured}
              onClick={() => act('audit')}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 disabled:opacity-40"
            >
              {busy === 'audit' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              Check for drift
            </button>
          </div>

          {busy === 'audit' && (
            <p className="text-xs text-slate-500">
              Pulling the full export. Capped at one call per two minutes by StubHub, so this
              takes a moment.
            </p>
          )}

          {drift && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <Tile label="Scanned" n={drift.scanned} />
                <Tile label="Tracked" n={drift.tracked} tone="good" />
                <Tile label="Awaiting removal" n={drift.pendingRemoval} />
                <Tile label="Orphans" n={drift.orphans?.length ?? 0} tone="bad" />
                <Tile label="Price mismatches" n={drift.priceMismatches?.length ?? 0} tone="bad" />
              </div>

              {drift.truncated && (
                <Banner tone="warn" icon={<AlertTriangle className="w-5 h-5" />}>
                  The export was truncated — these numbers cover only part of the book.
                </Banner>
              )}

              {(drift.orphans?.length ?? 0) > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <button
                    onClick={() => setShowDrift(v => !v)}
                    className="flex items-center gap-2 text-left w-full"
                  >
                    <h3 className="text-sm font-semibold text-red-900">
                      {drift.orphans.length.toLocaleString()} orphaned listing(s) — these need a human
                    </h3>
                    {showDrift ? <ChevronDown className="w-4 h-4 text-red-400" /> : <ChevronRight className="w-4 h-4 text-red-400" />}
                  </button>
                  <p className="text-xs text-red-800 mt-1">
                    Live on StubHub with nothing local pointing at them. The worker cannot remove
                    them — it only acts on rows and tombstones, and for these there is neither.
                    They have to be deleted deliberately, by listing id.
                  </p>
                  {showDrift && (
                    <div className="mt-3 max-h-64 overflow-y-auto rounded border border-red-200 bg-white">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-red-50">
                          <tr className="text-red-700">
                            <th className="text-left font-medium py-1.5 px-3">Listing id</th>
                            <th className="text-left font-medium py-1.5 px-3">External id</th>
                          </tr>
                        </thead>
                        <tbody>
                          {drift.orphans.slice(0, 500).map(o => (
                            <tr key={o.listingId} className="border-t border-red-100">
                              <td className="py-1 px-3"><code>{o.listingId}</code></td>
                              <td className="py-1 px-3 text-slate-500"><code>{o.externalId ?? '—'}</code></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {drift.orphans.length > 500 && (
                        <p className="text-xs text-red-700 px-3 py-2">
                          Showing the first 500 of {drift.orphans.length.toLocaleString()}.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {(drift.priceMismatches?.length ?? 0) > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <h3 className="text-sm font-semibold text-amber-900">
                    {drift.priceMismatches.length.toLocaleString()} price mismatch(es)
                  </h3>
                  <p className="text-xs text-amber-800 mt-1">
                    StubHub holds a different price from ours. These resolve themselves on the next
                    change to the row; a count that does not fall is a real problem.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {drift.priceMismatches.slice(0, 12).map(m => (
                      <span key={m.externalId} className="px-2 py-1 rounded border border-amber-300 bg-white text-xs tabular-nums">
                        <code className="text-slate-500">{m.externalId}</code> {m.ours} → {m.theirs}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {(drift.orphans?.length ?? 0) === 0 && (drift.priceMismatches?.length ?? 0) === 0 && (
                <p className="text-sm text-emerald-700 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" /> No drift. StubHub matches our record.
                </p>
              )}
            </div>
          )}

          {!drift && busy !== 'audit' && <Empty>Not checked in this session.</Empty>}
        </section>

        {/* ── Capacity ─────────────────────────────────────────────────────────
            The rate limits are not in the OpenAPI spec and the API returns no
            X-RateLimit headers, so this table is the only view of the budget
            there is. It used to render as one run-on line of whichever endpoints
            happened to have been touched — which put the least interesting one
            first and gave no sense of headroom. */}
        <section className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              <Gauge className="w-4 h-4 text-slate-400" /> Rate limit budget
            </h2>
            <span className="text-xs text-slate-400">burst tokens available / capacity</span>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            StubHub publishes no rate-limit headers, so these are tracked locally. A bar near
            empty means the limiter is holding calls back.
          </p>
          {snap.limiters?.length > 0 ? (
            <div className="space-y-2">
              {[...snap.limiters]
                .sort((a, b) => a.burst / Math.max(a.capacity, 1) - b.burst / Math.max(b.capacity, 1))
                .map(l => {
                  const pct = l.capacity > 0 ? (l.burst / l.capacity) * 100 : 100;
                  const tight = pct < 25;
                  return (
                    <div key={l.endpoint} className="flex items-center gap-3 text-sm">
                      <code className="text-xs text-slate-600 w-56 shrink-0 truncate">{l.endpoint}</code>
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${tight ? 'bg-amber-500' : 'bg-teal-500'}`}
                          style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
                        />
                      </div>
                      <span className={`text-xs tabular-nums w-20 text-right shrink-0 ${tight ? 'text-amber-600 font-medium' : 'text-slate-400'}`}>
                        {l.burst}/{l.capacity}
                      </span>
                      <span className="text-xs text-slate-400 tabular-nums w-24 text-right shrink-0">
                        {l.perMinute.toLocaleString()}/min
                      </span>
                    </div>
                  );
                })}
            </div>
          ) : (
            <Empty>No endpoint has been called yet in this process.</Empty>
          )}
        </section>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <footer className="text-xs text-slate-400 flex flex-wrap gap-x-5 gap-y-1 pb-4">
          {snap.lease && (
            <span>
              Lease <code className="text-slate-500">{snap.lease.holder}</code>
              {' '}· expires {ago(snap.lease.expiresAt)?.replace(' ago', ' ago') ?? '—'}
            </span>
          )}
          {snap.settings?.lastDrainAt && (
            <span>Last pass {ago(snap.settings.lastDrainAt)} — {snap.settings.lastDrainResult}</span>
          )}
          {snap.startedAt && <span>Worker up {ago(snap.startedAt)?.replace(' ago', '')}</span>}
          <span>Replaces the CSV upload to Automatiq.</span>
        </footer>

        {snap.settings?.lastError && (
          <Banner tone="bad" icon={<AlertTriangle className="w-5 h-5" />}>
            Last cycle aborted: {snap.settings.lastError}
          </Banner>
        )}
      </div>
    </div>
  );
}

/**
 * The one-sentence answer.
 *
 * Ordered by what would make you act soonest, not by severity in the abstract:
 * a stopped worker with a backlog is more urgent than a large backlog being
 * worked through, even though the second has the bigger number.
 */
function assess(snap: SyncSnapshot, trend: number) {
  const notes: string[] = [];
  if (snap.failedRows > 0) notes.push(`${snap.failedRows.toLocaleString()} row(s) parked after ${snap.maxAttempts} attempts — use "Return to the queue" once the cause is fixed.`);
  if (snap.pendingTombstones > 0) notes.push(`${snap.pendingTombstones.toLocaleString()} removal(s) queued for StubHub.`);
  if (snap.dryRunPinnedByEnv) notes.push('STUBHUB_DRY_RUN is set in the environment and overrides the toggle above.');

  const tones = {
    bad:  { wrap: 'bg-red-50 border-red-200', titleColour: 'text-red-900', bodyColour: 'text-red-800', iconColour: 'text-red-600' },
    warn: { wrap: 'bg-amber-50 border-amber-200', titleColour: 'text-amber-900', bodyColour: 'text-amber-800', iconColour: 'text-amber-600' },
    good: { wrap: 'bg-emerald-50 border-emerald-200', titleColour: 'text-emerald-900', bodyColour: 'text-emerald-800', iconColour: 'text-emerald-600' },
    idle: { wrap: 'bg-slate-50 border-slate-200', titleColour: 'text-slate-900', bodyColour: 'text-slate-600', iconColour: 'text-slate-400' },
  };

  if (!snap.configured) {
    return { ...tones.bad, icon: <ShieldAlert className="w-6 h-6" />, notes,
      title: 'Not configured',
      detail: 'No StubHub credentials are loaded, so nothing can be written. Changes still queue safely.' };
  }

  if (!snap.running && snap.pendingRows + snap.pendingTombstones > 0) {
    return { ...tones.warn, icon: <Square className="w-6 h-6" />, notes,
      title: 'Stopped, with work waiting',
      detail: `${(snap.pendingRows + snap.pendingTombstones).toLocaleString()} change(s) are queued and nothing is draining them. Nothing is lost — press Start when you are ready.` };
  }

  if (!snap.running) {
    return { ...tones.idle, icon: <Square className="w-6 h-6" />, notes,
      title: 'Stopped, queue empty',
      detail: 'Nothing waiting and nothing draining. Changes will accumulate until the worker is started.' };
  }

  if (snap.dryRun) {
    return { ...tones.idle, icon: <ShieldCheck className="w-6 h-6" />, notes,
      title: 'Dry run — nothing is being sent',
      detail: 'Payloads are built and logged in full, but no write leaves the process. Reads still happen, so drift checks are real.' };
  }

  if (snap.lagSeconds > 300) {
    return { ...tones.bad, icon: <AlertTriangle className="w-6 h-6" />, notes,
      title: 'Falling behind',
      detail: `The oldest unpushed change has waited ${fmtLag(snap.lagSeconds)}. StubHub is showing stale prices for those rows.` };
  }

  if (trend > 50) {
    return { ...tones.warn, icon: <TrendingUp className="w-6 h-6" />, notes,
      title: 'Backlog is growing',
      detail: `The queue has grown by ${trend.toLocaleString()} rows over the last few minutes. Changes are arriving faster than they are being written.` };
  }

  if (snap.failedRows > 0) {
    return { ...tones.warn, icon: <AlertTriangle className="w-6 h-6" />, notes,
      title: 'Keeping up, but rows are parked',
      detail: `Live traffic is being written within ${fmtLag(snap.lagSeconds) === '—' ? 'seconds' : fmtLag(snap.lagSeconds)}, but ${snap.failedRows.toLocaleString()} row(s) have given up retrying and are not on StubHub.` };
  }

  return { ...tones.good, icon: <CheckCircle2 className="w-6 h-6" />, notes,
    title: 'Healthy — keeping up',
    detail: snap.pendingRows > 0
      ? `Draining ${snap.pendingRows.toLocaleString()} row(s); the oldest has waited ${fmtLag(snap.lagSeconds)}.`
      : 'Nothing waiting. Every change has reached StubHub.' };
}

/** The pipeline strip. Zero-count stages stay visible — an empty stage is a fact. */
function PipelineStrip({ states }: { states: Record<string, number> }) {
  const total = Object.values(states).reduce((a, b) => a + (b || 0), 0);
  const tones: Record<string, string> = {
    wait: 'bg-slate-100 text-slate-700 border-slate-200',
    work: 'bg-sky-50 text-sky-800 border-sky-200',
    done: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    bad:  'bg-red-50 text-red-800 border-red-200',
  };
  const bars: Record<string, string> = {
    wait: 'bg-slate-400', work: 'bg-sky-500', done: 'bg-emerald-500', bad: 'bg-red-500',
  };

  if (total === 0) return <Empty>No rows are being tracked yet.</Empty>;

  return (
    <>
      <div className="flex h-2 rounded-full overflow-hidden bg-slate-100 mb-4">
        {PIPELINE.filter(s => (states[s.key] ?? 0) > 0).map(s => (
          <div
            key={s.key}
            className={bars[s.tone]}
            style={{ width: `${((states[s.key] ?? 0) / total) * 100}%` }}
            title={`${s.label}: ${(states[s.key] ?? 0).toLocaleString()}`}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
        {PIPELINE.map(s => {
          const n = states[s.key] ?? 0;
          return (
            <div key={s.key} className={`rounded-lg border px-2.5 py-2 ${n > 0 ? tones[s.tone] : 'bg-white border-slate-100 text-slate-300'}`}>
              <div className="text-lg font-bold tabular-nums leading-none">{n.toLocaleString()}</div>
              <div className="text-[11px] font-medium mt-1">{s.label}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Stat({ icon, label, value, hint, tone, trend, spark, action }: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  hint: string;
  tone?: 'warn' | 'bad';
  trend?: number;
  spark?: number[];
  action?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  const colour = tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : 'text-slate-900';
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col">
      <div className="flex items-center gap-1.5 text-slate-500 text-xs font-medium">
        {icon}{label}
        {typeof trend === 'number' && trend !== 0 && (
          <span className={`ml-auto inline-flex items-center gap-0.5 text-[11px] ${trend > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
            {trend > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {trend > 0 ? '+' : ''}{trend.toLocaleString()}
          </span>
        )}
        {typeof trend === 'number' && trend === 0 && (
          <Minus className="w-3 h-3 ml-auto text-slate-300" />
        )}
      </div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${colour}`}>{value}</div>
      {spark && spark.length > 3 && <Spark values={spark} />}
      <div className="text-xs text-slate-400 mt-0.5">{hint}</div>
      {action && (
        <button
          onClick={action.onClick}
          disabled={action.disabled}
          className="mt-2 text-xs font-semibold text-red-700 hover:text-red-800 disabled:opacity-40 text-left"
        >
          {action.label} →
        </button>
      )}
    </div>
  );
}

/** Backlog over the polling window. Shape matters here, not the values. */
function Spark({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const span = Math.max(max - min, 1);
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${20 - ((v - min) / span) * 18}`)
    .join(' ');
  return (
    <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="w-full h-5 mt-1.5">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5"
                className="text-teal-500" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Tile({ label, n, tone }: { label: string; n: number; tone?: 'good' | 'bad' }) {
  const cls = n === 0 ? 'bg-slate-50 border-slate-100 text-slate-400'
    : tone === 'bad' ? 'bg-red-50 border-red-200 text-red-800'
    : tone === 'good' ? 'bg-teal-50 border-teal-200 text-teal-800'
    : 'bg-slate-50 border-slate-200 text-slate-700';
  return (
    <div className={`rounded-lg border px-3 py-2 ${cls}`}>
      <div className="text-lg font-bold tabular-nums leading-none">{n.toLocaleString()}</div>
      <div className="text-[11px] font-medium mt-1">{label}</div>
    </div>
  );
}

function Pill({ label, n, tone }: { label: string; n: number; tone?: 'good' | 'warn' | 'bad' }) {
  const cls =
    tone === 'bad' && n > 0 ? 'bg-red-100 text-red-800 border-red-200'
    : tone === 'warn' && n > 0 ? 'bg-amber-100 text-amber-800 border-amber-200'
    : tone === 'good' && n > 0 ? 'bg-teal-100 text-teal-800 border-teal-200'
    : 'bg-slate-100 text-slate-700 border-slate-200';
  return (
    <span className={`px-2.5 py-1 rounded-lg border text-xs font-medium tabular-nums ${cls}`}>
      {n.toLocaleString()} {label}
    </span>
  );
}

function Banner({ tone, icon, children }: {
  tone: 'good' | 'warn' | 'bad'; icon: React.ReactNode; children: React.ReactNode;
}) {
  const cls = tone === 'bad' ? 'bg-red-50 border-red-200 text-red-800'
    : tone === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-900'
    : 'bg-emerald-50 border-emerald-200 text-emerald-800';
  return (
    <div className={`border rounded-lg p-4 flex items-start gap-2.5 ${cls}`}>
      <span className="shrink-0 mt-0.5">{icon}</span>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-400 py-2">{children}</p>;
}
