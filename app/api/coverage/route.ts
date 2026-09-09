import { NextRequest, NextResponse } from 'next/server';
import { currentHealth, cleanupExpiredJars } from '@/lib/farmHealth.js';
import { maybeAlert, sendTestAlert, alertConfig, alertHistory } from '@/lib/farmAlerts.js';
import { whatsAppStatus, initWhatsApp, stopWhatsApp, logoutWhatsApp } from '@/lib/whatsappClient.js';

/**
 * GET  /api/coverage              → live capacity snapshot + alert wiring status
 * POST /api/coverage              → { action: 'check-now' | 'cleanup' | 'cleanup-dry-run'
 *                                            | 'test-alert' | 'start' | 'stop' }
 *
 * The scheduler runs in-process on the portal, the same way the inventory watcher does.
 * That is deliberate: the farm cannot be trusted to alarm about its own death, and the
 * portal is the one process that is up whenever anyone would look at a dashboard.
 */

export const dynamic = 'force-dynamic';

const GLOBAL_KEY = '__farmHealthScheduler__';
// Checked every minute so a problem is alerted on almost as soon as it appears. The alert
// layer de-dupes, so a tight loop costs a Mongo read per minute, not a message per minute.
const DEFAULT_INTERVAL_MIN = Number(process.env.FARM_HEALTH_INTERVAL_MIN ?? 1);
const CLEANUP_EVERY_MS = Math.max(
  60 * 60_000,
  Number(process.env.FARM_CLEANUP_EVERY_HOURS ?? 6) * 3_600_000
);
const RUNNING_TIMEOUT_MS = 2 * 60 * 1000;

interface SchedulerState {
  interval: NodeJS.Timeout | null;
  initialized: boolean;
  runningStartedAt: number;
  intervalMs: number;
  lastRunAt: string | null;
  lastError: string | null;
  runCount: number;
  lastCleanupAt: number;
  lastCleanup: { matched: number; deleted: number; cutoff: string } | null;
}

function getState(): SchedulerState {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      interval: null,
      initialized: false,
      runningStartedAt: 0,
      intervalMs: 0,
      lastRunAt: null,
      lastError: null,
      runCount: 0,
      lastCleanupAt: 0,
      lastCleanup: null,
    } satisfies SchedulerState;
  }
  return g[GLOBAL_KEY] as SchedulerState;
}

async function runCheck() {
  const state = getState();
  const health = await currentHealth();
  state.lastRunAt = new Date().toISOString();
  state.runCount++;

  const alert = await maybeAlert(health);

  // Expired jars are swept on their own slower clock. Every 5 minutes would be a lot of
  // deleteMany against a collection whose garbage accumulates over days, and the sweep is
  // not what keeps the alarm honest — the capacity read already ignores expired records.
  const now = Date.now();
  if (now - state.lastCleanupAt >= CLEANUP_EVERY_MS) {
    state.lastCleanupAt = now;
    try {
      const res = await cleanupExpiredJars();
      state.lastCleanup = res;
      if (res.deleted) console.log(`[farmHealth] swept ${res.deleted} expired jar(s)`);
    } catch (e) {
      console.error('[coverage] cleanup failed:', e);
    }
  }

  return { health, alert };
}

function startScheduler(minutes: number) {
  const state = getState();
  if (state.interval) {
    clearInterval(state.interval);
    state.interval = null;
  }

  const intervalMs = Math.max(60_000, Math.round(minutes * 60_000));
  state.intervalMs = intervalMs;
  console.log(`[farmHealth] starting — every ${intervalMs / 1000}s`);

  state.interval = setInterval(async () => {
    const now = Date.now();
    // A check that hangs on a slow Mongo must not stack up behind itself.
    if (state.runningStartedAt > 0 && now - state.runningStartedAt < RUNNING_TIMEOUT_MS) return;
    state.runningStartedAt = now;
    try {
      await runCheck();
      state.lastError = null;
    } catch (e) {
      state.lastError = e instanceof Error ? e.message : String(e);
      console.error('[coverage] check failed:', e);
    } finally {
      state.runningStartedAt = 0;
    }
  }, intervalMs);
}

function stopScheduler() {
  const state = getState();
  if (state.interval) {
    clearInterval(state.interval);
    state.interval = null;
    console.log('[coverage] stopped');
  }
}

function initOnLoad() {
  const state = getState();
  if (state.initialized) return;
  state.initialized = true;
  const cfg = alertConfig();
  if (!cfg.whatsappReady && !cfg.discordReady) {
    console.log('[coverage] no alert transport configured — status page works, alarms will no-op');
  }
  startScheduler(DEFAULT_INTERVAL_MIN);
}

initOnLoad();

export async function GET() {
  const state = getState();
  try {
    const health = await currentHealth();
    return NextResponse.json({
      success: true,
      schedulerStatus: state.interval ? 'Running' : 'Stopped',
      intervalMs: state.intervalMs,
      lastRunAt: state.lastRunAt,
      lastError: state.lastError,
      runCount: state.runCount,
      lastCleanup: state.lastCleanup,
      alerts: alertConfig(),
      whatsapp: whatsAppStatus(),
      alertHistory: alertHistory(),
      ...health,
    });
  } catch (e) {
    console.error('[coverage] GET failed:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'failed' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { action, intervalMinutes } = await request.json();

    switch (action) {
      case 'check-now': {
        const { health, alert } = await runCheck();
        return NextResponse.json({ success: true, ...health, alert });
      }
      case 'cleanup-dry-run': {
        const result = await cleanupExpiredJars({ dryRun: true });
        return NextResponse.json({ success: true, result });
      }
      case 'cleanup': {
        const result = await cleanupExpiredJars();
        getState().lastCleanup = result;
        return NextResponse.json({ success: true, result });
      }
      case 'test-alert': {
        const result = await sendTestAlert();
        return NextResponse.json({ success: true, ...result });
      }
      // WhatsApp Web session control. `wa-link` boots Chromium and emits a QR the dashboard
      // renders; `wa-stop` keeps the session for a no-QR restart; `wa-logout` forgets it.
      case 'wa-link': {
        // Deliberately not awaited to completion: initialize() only settles once the client
        // is READY, which cannot happen until a human scans the QR. Awaiting it would hold
        // the request open past every sane timeout and the QR would never reach the page.
        initWhatsApp().catch(() => {});
        return NextResponse.json({ success: true, message: 'Starting — QR will appear shortly' });
      }
      case 'wa-stop': {
        return NextResponse.json({ success: true, result: await stopWhatsApp() });
      }
      case 'wa-logout': {
        return NextResponse.json({ success: true, result: await logoutWhatsApp() });
      }
      case 'wa-status': {
        return NextResponse.json({ success: true, whatsapp: whatsAppStatus() });
      }
      case 'start': {
        const mins = typeof intervalMinutes === 'number'
          ? Math.min(Math.max(intervalMinutes, 1), 120)
          : DEFAULT_INTERVAL_MIN;
        startScheduler(mins);
        return NextResponse.json({ success: true, message: `Started every ${mins}m` });
      }
      case 'stop': {
        stopScheduler();
        return NextResponse.json({ success: true, message: 'Stopped' });
      }
      default:
        return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
    }
  } catch (e) {
    console.error('[coverage] POST failed:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Operation failed' },
      { status: 500 }
    );
  }
}
