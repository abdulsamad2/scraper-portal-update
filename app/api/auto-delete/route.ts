import { NextRequest, NextResponse } from 'next/server';
import { 
  getAutoDeleteSettings, 
  updateAutoDeleteSettings, 
  runAutoDelete, 
  getAutoDeletePreview 
} from '@/actions/csvActions';
import { createErrorLog } from '@/actions/errorLogActions';

// Store the interval instance for auto-delete scheduler
let autoDeleteInterval: NodeJS.Timeout | null = null;
let isAutoDeleteInitialized = false;

// Initialize auto-delete scheduler on server start
async function initializeAutoDeleteScheduler() {
  if (isAutoDeleteInitialized) return;
  
  try {
    const settings = await getAutoDeleteSettings();
    if (settings.isEnabled) {
      await startAutoDeleteScheduler();
    }
    isAutoDeleteInitialized = true;
  } catch (error) {
    console.error('Failed to initialize auto-delete scheduler:', error);
  }
}

// Start the auto-delete scheduler
async function startAutoDeleteScheduler() {
  if (autoDeleteInterval) {
    clearInterval(autoDeleteInterval);
  }

  try {
    const settings = await getAutoDeleteSettings();
    const intervalMs = settings.scheduleIntervalHours * 60 * 60 * 1000; // Convert hours to milliseconds

    console.log(`Starting auto-delete scheduler with ${settings.scheduleIntervalHours} hour interval`);

    autoDeleteInterval = setInterval(async () => {
      console.log('Auto-delete scheduler running...');
      try {
        const result = await runAutoDelete();
        console.log('Auto-delete result:', result);
      } catch (error) {
        console.error('Auto-delete scheduler error:', error);
        await createErrorLog({
          errorType: 'AUTO_DELETE_SCHEDULER_ERROR',
          errorMessage: `Auto-delete scheduler failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          stackTrace: error instanceof Error ? error.stack || '' : '',
          metadata: { schedulerInterval: settings.scheduleIntervalHours }
        });
      }
    }, intervalMs);

    // Update next run time
    await updateAutoDeleteSettings({
      nextRunAt: new Date(Date.now() + intervalMs)
    });

  } catch (error) {
    console.error('Failed to start auto-delete scheduler:', error);
    throw error;
  }
}

// Stop the auto-delete scheduler
function stopAutoDeleteScheduler() {
  if (autoDeleteInterval) {
    clearInterval(autoDeleteInterval);
    autoDeleteInterval = null;
    console.log('Auto-delete scheduler stopped');
  }
}

// Initialize on module load
initializeAutoDeleteScheduler();

export async function GET() {
  try {
    const settings = await getAutoDeleteSettings();
    
    return NextResponse.json({
      success: true,
      settings: {
        isEnabled: settings.isEnabled,
        graceHours: settings.graceHours,
        scheduleIntervalHours: settings.scheduleIntervalHours,
        lastRunAt: settings.lastRunAt,
        nextRunAt: settings.nextRunAt,
        totalRuns: settings.totalRuns,
        totalEventsDeleted: settings.totalEventsDeleted,
        lastRunStats: settings.lastRunStats,
        schedulerStatus: autoDeleteInterval ? 'Running' : 'Stopped'
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
    const { action, graceHours, scheduleIntervalHours } = body;

    switch (action) {
      case 'start':
        await updateAutoDeleteSettings({
          isEnabled: true,
          graceHours: graceHours || 15,
          scheduleIntervalHours: scheduleIntervalHours || 24
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
        const preview = await getAutoDeletePreview(graceHours);
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