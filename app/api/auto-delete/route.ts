import { NextRequest, NextResponse } from 'next/server';
import { 
  getAutoDeleteSettings, 
  updateAutoDeleteSettings, 
  runAutoDelete, 
  getAutoDeletePreview 
} from '@/actions/csvActions';
import { createErrorLog } from '@/actions/errorLogActions';

// ═══════════════════════════════════════════════════════════════════
// Use globalThis to persist state across module re-evaluations.
// Without this, PM2/Next.js can re-import this module and create
// duplicate intervals (the old ones never get cleared).
// ═══════════════════════════════════════════════════════════════════

const GLOBAL_KEY = '__autoDeleteScheduler__';

interface SchedulerState {
  interval: NodeJS.Timeout | null;
  initialized: boolean;
  runningStartedAt: number; // 0 = not running, timestamp = when it started
  lastSkipLog: number;      // throttle "skipping" logs
}

const RUNNING_TIMEOUT_MS = 5 * 60 * 1000; // Force-reset running flag after 5 minutes
const SKIP_LOG_INTERVAL_MS = 60 * 1000;    // Only log "skipping" once per minute

function getState(): SchedulerState {
  if (!(globalThis as Record<string, unknown>)[GLOBAL_KEY]) {
    (globalThis as Record<string, unknown>)[GLOBAL_KEY] = {
      interval: null,
      initialized: false,
      runningStartedAt: 0,
      lastSkipLog: 0,
    };
  }
  return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as SchedulerState;
}

// Initialize auto-delete scheduler on server start
async function initializeAutoDeleteScheduler() {
  const state = getState();
  if (state.initialized) return;
  state.initialized = true; // set BEFORE async work to prevent re-entry
  
  try {
    const settings = await getAutoDeleteSettings();
    if (settings.isEnabled) {
      await startAutoDeleteScheduler();
    }
  } catch (error) {
    console.error('Failed to initialize auto-delete scheduler:', error);
    state.initialized = false; // allow retry on next module load
  }
}

// Start the auto-delete scheduler
async function startAutoDeleteScheduler() {
  const state = getState();
  
  // Always clear any existing interval first
  if (state.interval) {
    clearInterval(state.interval);
    state.interval = null;
  }

  try {
    const settings = await getAutoDeleteSettings();
    const minutes = settings.scheduleIntervalMinutes || 15; // fallback to 15 min
    const intervalMs = minutes * 60 * 1000;

    console.log(`Starting auto-delete scheduler with ${minutes} minute interval (${intervalMs}ms)`);

    state.interval = setInterval(async () => {
      const now = Date.now();

      // Prevent overlapping runs — with safety timeout (force-reset after 5 min)
      if (state.runningStartedAt > 0) {
        const elapsed = now - state.runningStartedAt;
        if (elapsed < RUNNING_TIMEOUT_MS) {
          // Throttle skip logs to once per minute
          if (now - state.lastSkipLog > SKIP_LOG_INTERVAL_MS) {
            console.log(`Auto-delete scheduler: previous run still in progress (${Math.round(elapsed / 1000)}s), skipping...`);
            state.lastSkipLog = now;
          }
          return;
        }
        // Stale flag — force reset
        console.warn(`Auto-delete scheduler: force-resetting stale running flag (was stuck for ${Math.round(elapsed / 1000)}s)`);
      }

      state.runningStartedAt = now;
      console.log('Auto-delete scheduler running...');
      try {
        const result = await runAutoDelete();
        console.log('Auto-delete result:', JSON.stringify(result).slice(0, 200));
      } catch (error) {
        console.error('Auto-delete scheduler error:', error);
        await createErrorLog({
          errorType: 'AUTO_DELETE_SCHEDULER_ERROR',
          errorMessage: `Auto-delete scheduler failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          stackTrace: error instanceof Error ? error.stack || '' : '',
          metadata: { schedulerIntervalMinutes: minutes }
        });
      } finally {
        state.runningStartedAt = 0;
      }
    }, intervalMs);

    // Update next run time (safe — intervalMs is guaranteed valid)
    const nextRun = new Date(Date.now() + intervalMs);
    if (!isNaN(nextRun.getTime())) {
      await updateAutoDeleteSettings({ nextRunAt: nextRun });
    }

  } catch (error) {
    console.error('Failed to start auto-delete scheduler:', error);
    throw error;
  }
}

// Stop the auto-delete scheduler
function stopAutoDeleteScheduler() {
  const state = getState();
  if (state.interval) {
    clearInterval(state.interval);
    state.interval = null;
    console.log('Auto-delete scheduler stopped');
  }
}

// Initialize on module load
initializeAutoDeleteScheduler();

export async function GET() {
  try {
    const settings = await getAutoDeleteSettings();
    const state = getState();
    
    return NextResponse.json({
      success: true,
      settings: {
        isEnabled: settings.isEnabled,
        stopBeforeHours: settings.stopBeforeHours,
        scheduleIntervalMinutes: settings.scheduleIntervalMinutes,
        lastRunAt: settings.lastRunAt,
        nextRunAt: settings.nextRunAt,
        totalRuns: settings.totalRuns,
        totalEventsDeleted: settings.totalEventsDeleted,
        lastRunStats: settings.lastRunStats,
        schedulerStatus: state.interval ? 'Running' : 'Stopped'
      }
    });
  } catch (error) {
    console.error('Error getting auto-delete settings:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to get auto-delete settings'
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, stopBeforeHours, scheduleIntervalMinutes } = body;

    switch (action) {
      case 'start':
        await updateAutoDeleteSettings({
          isEnabled: true,
          stopBeforeHours: stopBeforeHours || 2,
          scheduleIntervalMinutes: scheduleIntervalMinutes || 15
        });
        await startAutoDeleteScheduler();
        
        return NextResponse.json({
          success: true,
          message: 'Auto-delete scheduler started successfully'
        });

      case 'stop':
        await updateAutoDeleteSettings({
          isEnabled: false
        });
        stopAutoDeleteScheduler();
        
        return NextResponse.json({
          success: true,
          message: 'Auto-delete scheduler stopped successfully'
        });

      case 'run-now':
        const result = await runAutoDelete();
        return NextResponse.json(result);

      case 'preview':
        const preview = await getAutoDeletePreview(stopBeforeHours);
        return NextResponse.json(preview);

      case 'update-settings':
        const { isEnabled, ...settingsToUpdate } = body;
        
        await updateAutoDeleteSettings(settingsToUpdate);
        
        if (isEnabled !== undefined) {
          if (isEnabled) {
            await updateAutoDeleteSettings({ isEnabled: true });
            await startAutoDeleteScheduler();
          } else {
            await updateAutoDeleteSettings({ isEnabled: false });
            stopAutoDeleteScheduler();
          }
        }
        
        return NextResponse.json({
          success: true,
          message: 'Auto-delete settings updated successfully'
        });

      default:
        return NextResponse.json({
          success: false,
          error: 'Invalid action'
        }, { status: 400 });
    }
  } catch (error) {
    console.error('Error in auto-delete API:', error);
    return NextResponse.json({
      success: false,
      error: `Auto-delete operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    }, { status: 500 });
  }
}