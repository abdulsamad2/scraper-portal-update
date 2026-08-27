/**
 * Control surface for the StubHub sync worker.
 *
 *   GET                          → queue depth, lag, lease, settings, limiter state
 *   POST { action: 'drain' }     → run exactly one pass and report what happened
 *   POST { action: 'start' }     → run the drain loop until stopped
 *   POST { action: 'stop' }      → stop it
 *   POST { action: 'audit' }     → drift sweep (read-only)
 *   POST { action: 'settings' }  → change dryRun / marketplaces while running
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
import { drainOnce, runWorker, syncStatus, recordDrain } from '@/lib/sync/worker.ts';
import { StubhubSyncSettings, getStubhubSyncSettings } from '@/models/stubhubSyncModel.js';
import { requireFeatureFlag } from '@/lib/featureFlags';
import dbConnect from '@/lib/dbConnect';
import { auditDrift, summariseDrift } from '@/lib/sync/audit.ts';
import { currentLease } from '@/lib/sync/leader.ts';
import { createErrorLog } from '@/actions/errorLogActions';

// PM2 reloads and Next's module re-evaluation can both re-import this file. Without
// a global handle the old loop would keep running unreferenced and a second one
// would start beside it — the exact scenario the lease protects against, but there
// is no reason to rely on the lease for something this avoidable.
const KEY = '__stubhubSyncWorker__';

interface WorkerState {
  controller: AbortController | null;
  startedAt: number | null;
}

function state(): WorkerState {
  const g = globalThis as Record<string, unknown>;
  if (!g[KEY]) g[KEY] = { controller: null, startedAt: null } satisfies WorkerState;
  return g[KEY] as WorkerState;
}

export async function GET() {
  const blocked = await requireFeatureFlag('stubhubSync');
  if (blocked) return blocked;
  try {
    // Ensure the settings document exists so the UI has something to render on a
    // fresh install rather than a spinner and no explanation.
    await getStubhubSyncSettings();
    const [status, lease] = await Promise.all([syncStatus(), currentLease()]);
    const s = state();

    return NextResponse.json({
      success: true,
      running: Boolean(s.controller),
      startedAt: s.startedAt ? new Date(s.startedAt).toISOString() : null,
      lease: lease ? { holder: lease.holder, expiresAt: lease.expiresAt } : null,
      ...status,
      // Sync lag in human terms: how long the oldest unpushed change has waited.
      lagSeconds: Math.round(status.lagMs / 1000),
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
      const s = state();
      if (s.controller) {
        return NextResponse.json({ success: true, message: 'already running' });
      }
      s.controller = new AbortController();
      s.startedAt = Date.now();
      // Persisted so the loop comes back by itself after a restart, the same way
      // the CSV scheduler restores isScheduled. A deploy should not silently stop
      // inventory syncing until somebody notices.
      await dbConnect();
      await StubhubSyncSettings.updateOne({}, { $set: { isRunning: true } }, { upsert: true });

      // Intentionally not awaited: the loop runs until stopped. Failures are
      // logged and clear the handle so a later start can succeed.
      void runWorker(s.controller.signal)
        .catch(async (error) => {
          console.error('[stubhub:worker] loop failed:', error);
          await createErrorLog({
            eventUrl: 'STUBHUB_SYNC_WORKER',
            errorType: 'DATABASE_ERROR',
            message: error instanceof Error ? error.message : String(error),
            metadata: { operation: 'runWorker', timestamp: new Date() },
          }).catch(() => {});
        })
        .finally(() => {
          const cur = state();
          cur.controller = null;
          cur.startedAt = null;
        });

      return NextResponse.json({ success: true, message: 'worker started' });
    }

    if (action === 'stop') {
      const s = state();
      s.controller?.abort();
      s.controller = null;
      s.startedAt = null;
      await dbConnect();
      await StubhubSyncSettings.updateOne({}, { $set: { isRunning: false } }, { upsert: true });
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
