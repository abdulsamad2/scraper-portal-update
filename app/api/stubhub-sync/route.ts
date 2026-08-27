/**
 * Control surface for the StubHub sync worker.
 *
 *   GET                        → queue depth, lag, lease holder, limiter state
 *   POST { action: 'drain' }   → run exactly one pass and report what happened
 *   POST { action: 'start' }   → run the drain loop until stopped
 *   POST { action: 'stop' }    → stop it
 *   POST { action: 'audit' }   → drift sweep (read-only)
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
import { drainOnce, runWorker, syncStatus } from '@/lib/sync/worker.ts';
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
  try {
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
  let action = 'drain';
  try {
    const body = await request.json().catch(() => ({}));
    action = body?.action ?? 'drain';

    if (action === 'drain') {
      const result = await drainOnce();
      return NextResponse.json({ success: !result.aborted, ...result });
    }

    if (action === 'start') {
      const s = state();
      if (s.controller) {
        return NextResponse.json({ success: true, message: 'already running' });
      }
      s.controller = new AbortController();
      s.startedAt = Date.now();

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
