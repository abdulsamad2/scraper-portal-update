/**
 * Control surface for the StubHub sync worker.
 *
 *   GET                          → queue depth, lag, lease, settings, limiter state
 *   POST { action: 'drain' }     → run exactly one pass and report what happened
 *   POST { action: 'start' }     → run the drain loop until stopped
 *   POST { action: 'stop' }      → stop it
 *   POST { action: 'audit' }     → drift sweep (read-only)
 *   POST { action: 'settings' }  → change dryRun / marketplaces while running
 *   POST { action: 'retry' }     → return parked rows to the queue
 *   POST { action: 'clear-count' } → how many listings StubHub holds (read-only)
 *   POST { action: 'clear-all' }   → delete every listing on StubHub (destructive)
 *
 * A single manual pass exists because it is how you validate a cutover: run one
 * drain in dry-run, read exactly what it would have sent, and only then start the
 * loop. "Start it and watch the logs" is not a test.
 *
 * The loop deliberately lives in-process behind globalThis rather than as a
 * separate service, matching the existing csv-scheduler and auto-delete
 * schedulers. Correctness does not depend on that choice — the leader lease means
 * two instances cannot both drain — so it can be pulled out into its own process
 * later without touching the logic.
 */

import { NextRequest, NextResponse } from 'next/server';
import { drainOnce, syncStatus, recordDrain } from '@/lib/sync/worker.ts';
import { workerHandle, startWorker, stopWorker } from '@/lib/sync/runtime.ts';
import { startClearAll, clearProgress, clearRunning, countRemoteListings } from '@/lib/sync/clearAll.ts';
import { StubhubSyncSettings, getStubhubSyncSettings } from '@/models/stubhubSyncModel.js';
import { requireFeatureFlag } from '@/lib/featureFlags';
import dbConnect from '@/lib/dbConnect';
import { auditDrift, summariseDrift } from '@/lib/sync/audit.ts';
import { currentLease } from '@/lib/sync/leader.ts';
import { recentFailures, skipBreakdown, pendingByEvent, stateBreakdown } from '@/lib/sync/queue.ts';
import { createErrorLog } from '@/actions/errorLogActions';

// The worker handle and the start/stop logic live in lib/sync/runtime.ts because
// instrumentation.ts needs them too — a restored loop the API could not see or
// stop would be worse than one that was never restored.

export async function GET() {
  const blocked = await requireFeatureFlag('stubhubSync');
  if (blocked) return blocked;
  try {
    // Ensure the settings document exists so the UI has something to render on a
    // fresh install rather than a spinner and no explanation.
    await getStubhubSyncSettings();

    // Everything the page renders comes from this one call, deliberately.
    //
    // It used to return the counters only, and the page filled in the detail
    // panels from the server render — which meant the header said one thing and
    // "waiting, by event" said another as soon as the first poll landed, because
    // one half was live and the other was frozen at page load. Two numbers that
    // disagree on a diagnostic page are worse than one number that is slightly
    // stale: the operator stops trusting either. So the whole snapshot is
    // assembled together and replaced together.
    const [status, lease, failures, skips, byEvent, states] = await Promise.all([
      syncStatus(),
      currentLease().catch(() => null),
      recentFailures(25).catch(() => []),
      skipBreakdown().catch(() => []),
      pendingByEvent(12).catch(() => []),
      stateBreakdown().catch(() => ({})),
    ]);
    const s = workerHandle();

    return NextResponse.json({
      success: true,
      running: Boolean(s.controller),
      startedAt: s.startedAt ? new Date(s.startedAt).toISOString() : null,
      lease: lease ? { holder: lease.holder, expiresAt: lease.expiresAt } : null,
      // "Running" is per-instance; the lease is global. Under PM2 the instance
      // answering this request is often not the one draining, and reporting only
      // the local handle made a perfectly healthy system read as "Stopped" —
      // which invites an operator to press Start on an instance that will
      // correctly refuse, and see nothing happen.
      leaseActive: Boolean(lease && lease.expiresAt.getTime() > Date.now()),
      leaseIsOurs: Boolean(lease && s.holder && lease.holder === s.holder),
      ...status,
      // Sync lag in human terms: how long the oldest unpushed change has waited.
      lagSeconds: Math.round(status.lagMs / 1000),
      failures,
      skips,
      byEvent,
      states,
      clearJob: clearProgress(),
      clearRunning: clearRunning(),
      observedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : 'status failed' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const blocked = await requireFeatureFlag('stubhubSync');
  if (blocked) return blocked;

  let action = 'drain';
  try {
    const body = await request.json().catch(() => ({}));
    action = body?.action ?? 'drain';

    if (action === 'drain') {
      const result = await drainOnce();
      await recordDrain(result);
      return NextResponse.json({ success: !result.aborted, ...result });
    }

    if (action === 'clear-count') {
      const { count, truncated } = await countRemoteListings();
      return NextResponse.json({ success: true, count, truncated });
    }

    if (action === 'clear-all') {
      // A typed confirmation, checked on the server.
      //
      // This deletes the entire book from a live marketplace and there is no
      // undo — the listings are gone and rebuilding them means re-creating every
      // one, with new ids. A dialog the browser could skip, or a flag a stray
      // fetch could set, is not enough of a gate for that.
      if (body?.confirm !== 'DELETE ALL') {
        return NextResponse.json(
          { success: false, message: 'Confirmation phrase missing. Send confirm: "DELETE ALL".' },
          { status: 400 }
        );
      }
      if (clearRunning()) {
        return NextResponse.json({ success: true, message: 'Already running.', clearJob: clearProgress() });
      }
      // stopWorker is passed in rather than called here so the operation owns the
      // ordering: nothing may write to StubHub between the stop and the scan.
      const job = await startClearAll({ stop: stopWorker });
      return NextResponse.json({ success: true, clearJob: job });
    }

    if (action === 'retry') {
      const { retryParked } = await import('@/lib/sync/queue.ts');
      const revived = await retryParked();
      return NextResponse.json({ success: true, revived });
    }

    if (action === 'settings') {
      const update: Record<string, unknown> = {};
      if (typeof body?.dryRun === 'boolean') update.dryRun = body.dryRun;
      if (Array.isArray(body?.marketplaces)) update.marketplaces = body.marketplaces;
      if (Object.keys(update).length === 0) {
        return NextResponse.json({ success: false, message: 'nothing to update' }, { status: 400 });
      }
      await dbConnect();
      await StubhubSyncSettings.updateOne({}, { $set: update }, { upsert: true });
      return NextResponse.json({ success: true, ...update });
    }

    if (action === 'start') {
      const outcome = await startWorker();
      return NextResponse.json(outcome, { status: outcome.success ? 200 : 409 });
    }

    if (action === 'stop') {
      await stopWorker();
      return NextResponse.json({ success: true, message: 'worker stopping' });
    }

    if (action === 'audit') {
      const since = typeof body?.since === 'string' ? new Date(body.since) : undefined;
      const report = await auditDrift({ updatedDateSince: since });
      return NextResponse.json({ success: true, summary: summariseDrift(report), ...report });
    }

    return NextResponse.json(
      { success: false, message: `unknown action ${action}` },
      { status: 400 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'request failed';
    await createErrorLog({
      eventUrl: 'STUBHUB_SYNC_API',
      errorType: 'DATABASE_ERROR',
      message,
      metadata: { operation: action, timestamp: new Date() },
    }).catch(() => {});
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
