'use client';

/**
 * StubHub POS sync control panel — interactive half.
 *
 * Seeded with server-rendered state, so it is useful on first paint rather than
 * after a round-trip. It refreshes on a timer only to keep live numbers honest.
 *
 * The CSV page controls a scheduler that runs on a timer; this controls a drain
 * loop that runs continuously and sleeps only when the queue is empty. The
 * numbers that matter are therefore different: not "when does it next run", but
 * how much is waiting, how long the oldest change has waited, and what is stuck.
 *
 * Every render path assumes the data might be missing. This is the page someone
 * opens when something is wrong, so it has to survive a database that is slow,
 * unreachable, or has never had a sync run against it.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Radio, Play, Square, Zap, ShieldCheck, ShieldAlert, Loader2, AlertTriangle,
  Clock, Layers, Trash2, RefreshCw, Search, ChevronDown, ChevronRight, Ban,
} from 'lucide-react';

export interface SyncSnapshot {
  ok: boolean;
  loadError?: string;
  running: boolean;
  startedAt?: string | null;
  lease: { holder: string; expiresAt: string } | null;
  pendingRows: number;
  pendingTombstones: number;
  failedRows: number;
  lagSeconds: number;
  configured: boolean;
  dryRun: boolean;
  dryRunPinnedByEnv: boolean;
  maxAttempts: number;
  limiters: Array<{ endpoint: string; intervalMs: number }>;
  failures: Array<{ inventoryId: number; mappingId: string; section: string; row: string; error: string; attempts: number }>;
  skips: Array<{ reason: string; count: number }>;
  byEvent: Array<{ mappingId: string; count: number; oldest: string | null }>;
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

/** Unknown and zero are different facts. Never render one as the other. */
const num = (n: number | undefined | null) => (typeof n === 'number' ? n : '—');

const fmtLag = (s: number | undefined) => {
  if (typeof s !== 'number') return '—';
  if (s <= 0) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

const ago = (iso: string | null) => {
  if (!iso) return null;
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  return s < 0 ? 'just now' : `${fmtLag(s)} ago`;
};

export default function StubhubSyncClient({ initial }: { initial: SyncSnapshot }) {
  const [snap, setSnap] = useState<SyncSnapshot>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastDrain, setLastDrain] = useState<DrainResult | null>(null);
  const [audit, setAudit] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initial.loadError ?? null);
  const [showFailures, setShowFailures] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/stubhub-sync', { cache: 'no-store' });
      const data = await res.json();
      if (data?.success) {
        // A successful poll clears a failed initial render, so a transient outage
        // recovers on its own rather than needing a reload.
        // Merge rather than replace: the API status has no failures/skips/byEvent,
        // and dropping the server-rendered diagnostics on the first poll would
        // make the page visibly lose information a second after it loaded.
        setSnap(prev => ({ ...prev, ...data, ok: true }));
        setError(null);
      } else {
        setError(data?.message ?? 'Could not read sync state');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the sync API');
    }
  }, []);

  useEffect(() => {
    const ms = snap.running ? 2000 : 8000;
    const t = setInterval(load, ms);
    return () => clearInterval(t);
  }, [load, snap.running]);

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch('/api/stubhub-sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      if (!data?.success) setError(data?.message ?? `${action} failed`);
      if (action === 'drain' && typeof data?.claimed === 'number') setLastDrain(data);
      if (action === 'audit') setAudit(data?.summary ?? null);
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

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Radio className="w-6 h-6 text-teal-600" /> StubHub POS Sync
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Pushes inventory changes straight to StubHub. Replaces the CSV upload to Automatiq.
          </p>
        </div>
        <button
          onClick={load}
          className="px-3 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </header>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4 flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {!snap.configured && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-4 flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="text-sm">
            <strong>Not configured.</strong> Set{' '}
            <code className="bg-amber-100 px-1 rounded">STUBHUB_BEARER_TOKEN</code> and{' '}
            <code className="bg-amber-100 px-1 rounded">STUBHUB_ACCOUNT_ID</code>, then restart.
          </div>
        </div>
      )}

      {/* Write mode — the one control that is not reversible. */}
      <section className={`rounded-xl border p-5 ${live ? 'bg-red-50 border-red-300' : 'bg-emerald-50 border-emerald-200'}`}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            {live
              ? <ShieldAlert className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
              : <ShieldCheck className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />}
            <div>
              <div className={`font-semibold ${live ? 'text-red-800' : 'text-emerald-800'}`}>
                {live ? 'LIVE — writing to StubHub' : 'Dry run — nothing is sent'}
              </div>
              <p className={`text-sm mt-0.5 ${live ? 'text-red-700' : 'text-emerald-700'}`}>
                {live
                  ? `Creates, price updates, delists and deletes are reaching ${marketplaces.join(' and ')}.`
                  : 'Payloads are built and logged in full, but no write leaves the process. Reads still happen.'}
              </p>
              {snap.dryRunPinnedByEnv && (
                <p className="text-xs mt-1 text-slate-600">
                  Pinned by <code>STUBHUB_DRY_RUN</code> in the environment — this toggle cannot override it.
                </p>
              )}
            </div>
          </div>
          <button
            disabled={busy !== null || snap.dryRunPinnedByEnv}
            onClick={() => act('settings', { dryRun: !snap.dryRun })}
            className={`px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed ${
              live ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'
            }`}
          >
            {busy === 'settings'
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : live ? 'Switch to dry run' : 'Go live'}
          </button>
        </div>
      </section>

      {/* Queue */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={<Layers className="w-4 h-4" />} label="Rows waiting" value={num(snap.pendingRows)}
              hint="Changes not yet pushed" />
        <Stat icon={<Trash2 className="w-4 h-4" />} label="Removals waiting" value={num(snap.pendingTombstones)}
              hint="Delist or delete pending" />
        <Stat icon={<Clock className="w-4 h-4" />} label="Sync lag" value={fmtLag(snap.lagSeconds)}
              hint="Age of the oldest unpushed change"
              tone={(snap.lagSeconds ?? 0) > 300 ? 'warn' : undefined} />
        <Stat icon={<Ban className="w-4 h-4" />} label="Parked" value={num(snap.failedRows)}
              hint={`Gave up after ${snap.maxAttempts ?? 5} attempts`}
              tone={(snap.failedRows ?? 0) > 0 ? 'bad' : undefined} />
      </section>

      {/* Worker */}
      <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              Worker
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${
                snap.running ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-600'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${snap.running ? 'bg-teal-500 animate-pulse' : 'bg-slate-400'}`} />
                {snap.running ? 'draining' : 'stopped'}
              </span>
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {snap.running
                ? 'Running continuously — it sleeps only when the queue is empty.'
                : 'Stopped. Changes queue up until it is started; nothing is lost.'}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              disabled={busy !== null || !snap.configured}
              onClick={() => act('drain')}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-slate-200 hover:bg-slate-50 flex items-center gap-2 disabled:opacity-40"
              title="Run exactly one pass. The safe way to see what it would do."
            >
              {busy === 'drain' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              Run once
            </button>
            {snap.running ? (
              <button
                disabled={busy !== null}
                onClick={() => act('stop')}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-800 text-white hover:bg-slate-900 flex items-center gap-2 disabled:opacity-40"
              >
                {busy === 'stop' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
                Stop
              </button>
            ) : (
              <button
                disabled={busy !== null || !snap.configured}
                onClick={() => act('start')}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-teal-600 text-white hover:bg-teal-700 flex items-center gap-2 disabled:opacity-40"
              >
                {busy === 'start' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Start
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600 pt-3 border-t border-slate-100">
          <span>Marketplaces: <strong>{marketplaces.join(', ')}</strong></span>
          {snap.lease && <span className="truncate">Lease: <code className="text-xs">{snap.lease.holder}</code></span>}
          {snap.settings?.lastDrainAt && (
            <span>Last pass {ago(snap.settings.lastDrainAt)} — {snap.settings.lastDrainResult}</span>
          )}
        </div>

        {snap.settings?.lastError && (
          <div className="text-sm bg-red-50 border border-red-200 text-red-800 rounded-lg p-3">
            Last cycle aborted: {snap.settings.lastError}
          </div>
        )}

        {lastDrain && (
          <div className="pt-3 border-t border-slate-100">
            <div className="text-xs font-medium text-slate-500 mb-2">Last manual pass</div>
            <div className="flex flex-wrap gap-2">
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
      </section>

      {/* What is waiting, by event — the question you actually have mid-test */}
      {snap.byEvent?.length > 0 && (
        <section className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-semibold text-slate-900 mb-1">Waiting, by event</h2>
          <p className="text-xs text-slate-500 mb-3">
            Where the backlog is. A single queue depth cannot tell you whether one event is stuck
            or everything is simply busy.
          </p>
          <div className="space-y-1.5">
            {snap.byEvent.map(e => (
              <div key={e.mappingId} className="flex items-center justify-between text-sm py-1.5 border-b border-slate-50 last:border-0">
                <code className="text-xs text-slate-600">{e.mappingId || '(no mapping id)'}</code>
                <div className="flex items-center gap-4">
                  <span className="text-slate-400 text-xs">{ago(e.oldest)}</span>
                  <span className="font-medium tabular-nums text-slate-900">{e.count}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Skips — not failures, but a rising count means a data problem upstream */}
      {snap.skips?.length > 0 && (
        <section className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-semibold text-slate-900 mb-1">Skipped rows</h2>
          <p className="text-xs text-slate-500 mb-3">
            Not failures — these cannot be represented on StubHub, so they are ignored rather than
            retried. A rising count means something changed upstream.
          </p>
          <div className="flex flex-wrap gap-2">
            {snap.skips.map(s => (
              <span key={s.reason} className="px-2.5 py-1 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-xs font-medium">
                {s.count} × {s.reason}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Failures — the most useful thing on the page during a cutover */}
      {snap.failures?.length > 0 && (
        <section className="bg-white rounded-xl border border-slate-200 p-5">
          <button
            onClick={() => setShowFailures(v => !v)}
            className="w-full flex items-center justify-between gap-2 text-left"
          >
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              Rows needing attention ({snap.failures.length})
            </h2>
            {showFailures ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
          </button>
          {showFailures && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-slate-100">
                    <th className="text-left font-medium py-2">Inventory</th>
                    <th className="text-left font-medium py-2">Event</th>
                    <th className="text-left font-medium py-2">Seat</th>
                    <th className="text-left font-medium py-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.failures.map(f => (
                    <tr key={f.inventoryId} className="border-b border-slate-50 last:border-0 align-top">
                      <td className="py-2 pr-3"><code className="text-xs">{f.inventoryId}</code></td>
                      <td className="py-2 pr-3"><code className="text-xs text-slate-500">{f.mappingId}</code></td>
                      <td className="py-2 pr-3 text-slate-600 text-xs whitespace-nowrap">{f.section} {f.row}</td>
                      <td className="py-2 text-xs text-red-700">{f.error || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Totals + drift */}
      <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-semibold text-slate-900">Totals</h2>
          <button
            disabled={busy !== null || !snap.configured}
            onClick={() => act('audit')}
            className="px-3 py-2 rounded-lg text-sm border border-slate-200 hover:bg-slate-50 flex items-center gap-2 disabled:opacity-40"
            title="Compare what StubHub holds against what we believe we sent. Read-only — it never fixes anything."
          >
            {busy === 'audit' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Check for drift
          </button>
        </div>
        {totals && (
          <div className="flex flex-wrap gap-2">
            <Pill label="created" n={totals.created} />
            <Pill label="updated" n={totals.updated} />
            <Pill label="delisted" n={totals.delisted} />
            <Pill label="deleted" n={totals.deleted} />
            <Pill label="failed" n={totals.failed} tone={totals.failed ? 'bad' : undefined} />
          </div>
        )}
        {audit && (
          <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3">{audit}</p>
        )}
        {snap.limiters?.length > 0 && (
          <div className="text-xs text-slate-500 pt-3 border-t border-slate-100">
            Throttle: {snap.limiters.map(l => `${l.endpoint} every ${l.intervalMs}ms`).join(' · ')}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ icon, label, value, hint, tone }: {
  icon: React.ReactNode; label: string; value: number | string; hint: string; tone?: 'warn' | 'bad';
}) {
  const colour = tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : 'text-slate-900';
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-1.5 text-slate-500 text-xs font-medium">{icon}{label}</div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${colour}`}>{value}</div>
      <div className="text-xs text-slate-400 mt-0.5">{hint}</div>
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
      {n} {label}
    </span>
  );
}
