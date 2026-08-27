'use client';

/**
 * StubHub POS sync control panel.
 *
 * The CSV page controls a scheduler that runs on a timer; this one controls a
 * drain loop that runs continuously and sleeps only when the queue is empty. So
 * the numbers that matter here are different: not "when does it next run", but
 * how much is waiting, how long the oldest change has been waiting, and whether
 * anything is stuck.
 *
 * Dry run is the most important control on the page, which is why it is at the
 * top and reads as a state rather than a checkbox. Everything this system does is
 * reversible except sending something to a live marketplace.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Radio, Play, Square, Zap, ShieldCheck, ShieldAlert, Loader2,
  AlertTriangle, CheckCircle2, Clock, Layers, Trash2, RefreshCw, Search,
} from 'lucide-react';

interface DrainResult {
  claimed: number; created: number; updated: number; noop: number;
  skipped: number; failed: number; delisted: number; deleted: number;
  cancelled: number; aborted: string | null; more: boolean;
}

interface SyncStatus {
  success: boolean;
  running: boolean;
  startedAt: string | null;
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

const fmtLag = (s: number) => {
  if (s <= 0) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

export default function StubhubSyncPage() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastDrain, setLastDrain] = useState<DrainResult | null>(null);
  const [audit, setAudit] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/stubhub-sync', { cache: 'no-store' });
      if (res.status === 403) { setError('This feature is disabled. Enable "stubhubSync" in Admin.'); return; }
      const data = await res.json();
      if (data.success) { setStatus(data); setError(null); }
      else setError(data.message ?? 'Could not load status');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load status');
    }
  }, []);

  // Poll while the loop is running so the queue depth and lag stay honest;
  // slower when idle, since nothing is moving.
  useEffect(() => {
    load();
    const ms = status?.running ? 2000 : 6000;
    const t = setInterval(load, ms);
    return () => clearInterval(t);
  }, [load, status?.running]);

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
      if (!data.success) setError(data.message ?? `${action} failed`);
      if (action === 'drain' && data.claimed !== undefined) setLastDrain(data);
      if (action === 'audit') setAudit(data.summary ?? null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : `${action} failed`);
    } finally {
      setBusy(null);
    }
  };

  if (!status && !error) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
      </div>
    );
  }

  const live = status && !status.dryRun;
  const totals = status?.settings.totals;

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

      {status && !status.configured && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-4 flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="text-sm">
            <strong>Not configured.</strong> Set <code className="bg-amber-100 px-1 rounded">STUBHUB_BEARER_TOKEN</code>{' '}
            and <code className="bg-amber-100 px-1 rounded">STUBHUB_ACCOUNT_ID</code>, then restart.
          </div>
        </div>
      )}

      {/* Write mode — the control that actually matters. */}
      {status && (
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
                    ? 'Creates, price updates, delists and deletes are reaching the marketplace.'
                    : 'Payloads are built and logged in full, but no write leaves the process. Reads still happen.'}
                </p>
                {status.dryRunPinnedByEnv && (
                  <p className="text-xs mt-1 text-slate-600">
                    Pinned by <code>STUBHUB_DRY_RUN</code> in the environment — the toggle below cannot override it.
                  </p>
                )}
              </div>
            </div>
            <button
              disabled={busy !== null || status.dryRunPinnedByEnv}
              onClick={() => act('settings', { dryRun: !status.dryRun })}
              className={`px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-40 ${
                live ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {busy === 'settings'
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : live ? 'Switch to dry run' : 'Go live'}
            </button>
          </div>
        </section>
      )}

      {/* Queue */}
      {status && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat icon={<Layers className="w-4 h-4" />} label="Rows waiting" value={status.pendingRows}
                hint="Changes not yet pushed" />
          <Stat icon={<Trash2 className="w-4 h-4" />} label="Removals waiting" value={status.pendingTombstones}
                hint="Delist or delete pending" />
          <Stat icon={<Clock className="w-4 h-4" />} label="Sync lag" value={fmtLag(status.lagSeconds)}
                hint="Age of the oldest unpushed change"
                tone={status.lagSeconds > 300 ? 'warn' : undefined} />
          <Stat icon={<AlertTriangle className="w-4 h-4" />} label="Parked" value={status.failedRows}
                hint={`Failed ${status.maxAttempts}× — needs a look`}
                tone={status.failedRows > 0 ? 'bad' : undefined} />
        </section>
      )}

      {/* Controls */}
      {status && (
        <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-semibold text-slate-900">Worker</h2>
              <p className="text-sm text-slate-500">
                {status.running
                  ? 'Draining continuously — it sleeps only when the queue is empty.'
                  : 'Stopped. Changes will queue up until it is started.'}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                disabled={busy !== null || !status.configured}
                onClick={() => act('drain')}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-slate-200 hover:bg-slate-50 flex items-center gap-2 disabled:opacity-40"
                title="Run exactly one pass — the safe way to see what it would do"
              >
                {busy === 'drain' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Run once
              </button>
              {status.running ? (
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
                  disabled={busy !== null || !status.configured}
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
            <span>Marketplaces: <strong>{status.settings.marketplaces.join(', ')}</strong></span>
            {status.lease && <span>Lease held by <code className="text-xs">{status.lease.holder}</code></span>}
            {status.settings.lastDrainAt && (
              <span>Last pass {new Date(status.settings.lastDrainAt).toLocaleTimeString()} — {status.settings.lastDrainResult}</span>
            )}
          </div>

          {status.settings.lastError && (
            <div className="text-sm bg-red-50 border border-red-200 text-red-800 rounded-lg p-3">
              Last cycle aborted: {status.settings.lastError}
            </div>
          )}
        </section>
      )}

      {/* Last manual pass */}
      {lastDrain && (
        <section className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-teal-600" /> Last manual pass
          </h2>
          <div className="flex flex-wrap gap-2 text-sm">
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
            <p className="text-xs text-slate-500 mt-3">
              {lastDrain.noop} row(s) already matched what StubHub holds, so no call was made for them.
            </p>
          )}
          {lastDrain.aborted && (
            <p className="text-sm text-red-700 mt-3">Aborted: {lastDrain.aborted}</p>
          )}
        </section>
      )}

      {/* Totals + audit */}
      {status && (
        <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="font-semibold text-slate-900">Since counters were reset</h2>
            <button
              disabled={busy !== null || !status.configured}
              onClick={() => act('audit')}
              className="px-3 py-2 rounded-lg text-sm border border-slate-200 hover:bg-slate-50 flex items-center gap-2 disabled:opacity-40"
              title="Compare what StubHub holds against what we think we sent. Read-only."
            >
              {busy === 'audit' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Check for drift
            </button>
          </div>
          {totals && (
            <div className="flex flex-wrap gap-2 text-sm">
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
          {status.limiters.length > 0 && (
            <div className="text-xs text-slate-500 pt-3 border-t border-slate-100">
              Throttle state:{' '}
              {status.limiters.map(l => `${l.endpoint} every ${l.intervalMs}ms`).join(' · ')}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Stat({ icon, label, value, hint, tone }: {
  icon: React.ReactNode; label: string; value: number | string; hint: string;
  tone?: 'warn' | 'bad';
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
    tone === 'bad' ? 'bg-red-100 text-red-800 border-red-200'
    : tone === 'warn' ? 'bg-amber-100 text-amber-800 border-amber-200'
    : tone === 'good' && n > 0 ? 'bg-teal-100 text-teal-800 border-teal-200'
    : 'bg-slate-100 text-slate-700 border-slate-200';
  return (
    <span className={`px-2.5 py-1 rounded-lg border text-xs font-medium tabular-nums ${cls}`}>
      {n} {label}
    </span>
  );
}
