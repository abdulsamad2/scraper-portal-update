/* eslint-disable @typescript-eslint/ban-ts-comment */
// Update the import path to match your project structure, e.g.:


// Adjust the path based on your project structure
// Or, if your tsconfig.json has a "paths" alias for "@", ensure it points to the correct directory.
import { getSchedulerSettings, updateSchedulerSettings } from '@/actions/csvActions';
import { generateInventoryCsv, uploadCsvToSyncService } from '@/actions/csvActions';
import { createErrorLog } from '@/actions/errorLogActions';
import { NextRequest, NextResponse } from 'next/server';

// Scheduler metrics for monitoring
interface SchedulerMetrics {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  averageGenerationTime: number;
  averageUploadTime: number;
  startTime: number;
  lastError?: string;
}

const schedulerMetrics: SchedulerMetrics = {
  totalRuns: 0,
  successfulRuns: 0,
  failedRuns: 0,
  averageGenerationTime: 0,
  averageUploadTime: 0,
  startTime: Date.now()
};

// Utility function to format uptime
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// Store the interval instance
let scheduledInterval: NodeJS.Timeout | null = null;
let isInitialized = false;

// Initialize scheduler on server start
async function initializeScheduler() {
  if (isInitialized) return;
  
  try {
    const settings = await getSchedulerSettings();
    
    // If scheduler was running before server restart, restart it
    if (settings.isScheduled && settings.scheduleRateMinutes) {
      console.log('🔄 Restoring scheduler from database settings...');
      await startScheduler(settings.scheduleRateMinutes, settings.uploadToSync, settings.eventUpdateFilterMinutes);
    }
    
    isInitialized = true;
  } catch (error) {
    console.error('Failed to initialize scheduler:', error);
  }
}

// Helper function to start the scheduler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function startScheduler(intervalMinutes: number, uploadToSync: boolean, eventUpdateFilterMinutes: number = 0) {
  // Stop existing interval if running
  if (scheduledInterval) {
    clearInterval(scheduledInterval);
    scheduledInterval = null;
  }

  // Validate interval
  if (!intervalMinutes || intervalMinutes < 1 || intervalMinutes > 1440) {
    throw new Error('Invalid interval. Must be between 1 and 1440 minutes.');
  }

  // Reset metrics when starting
  schedulerMetrics.totalRuns = 0;
  schedulerMetrics.successfulRuns = 0;
  schedulerMetrics.failedRuns = 0;
  schedulerMetrics.averageGenerationTime = 0;
  schedulerMetrics.averageUploadTime = 0;
  schedulerMetrics.startTime = Date.now();
  schedulerMetrics.lastError = undefined;

  // Create the scheduled interval
  const intervalMs = intervalMinutes * 60 * 1000;
  
  const scheduledTask = async () => {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();
    let generationTime = 0;
    let uploadTime = 0;
    
    console.log(`[${timestamp}] 🚀 Starting scheduled CSV generation...`);
    
    try {
      // Update metrics
      schedulerMetrics.totalRuns++;
      
      // Get current settings for this run
      const currentSettings = await getSchedulerSettings();
      
      // Update last run time and increment total runs
      await updateSchedulerSettings({
        //@ts-expect-error
        lastRunAt: new Date(),
        nextRunAt: new Date(Date.now() + currentSettings.scheduleRateMinutes * 60 * 1000),
        totalRuns: schedulerMetrics.totalRuns
      });

      // Generate CSV with performance tracking
      const generationStart = Date.now();
      const result = await generateInventoryCsv(currentSettings.eventUpdateFilterMinutes || 0);
      generationTime = Date.now() - generationStart;
      
      if (result.success && result.csv) {
        // Skip file saving to prevent storage issues - CSV is uploaded to sync service directly
        console.log(`[${timestamp}] ✅ CSV generated in memory (${result.recordCount} records, generated in ${generationTime}ms)`);
        
        // Upload to sync service if enabled
        if (currentSettings.uploadToSync) {
          const uploadStart = Date.now();
          const uploadResult = await uploadCsvToSyncService(result.csv);
          uploadTime = Date.now() - uploadStart;
          
          if (uploadResult.success) {
            console.log(`[${timestamp}] ☁️ CSV uploaded to sync service successfully (${uploadTime}ms)`);
            schedulerMetrics.successfulRuns++;
          } else {
            console.error(`[${timestamp}] ❌ Failed to upload CSV:`, uploadResult.message);
            schedulerMetrics.failedRuns++;
            schedulerMetrics.lastError = uploadResult.message;
            
            // Log error to database
            await createErrorLog({
              source: 'CSV_SCHEDULER_UPLOAD',
              type: 'DATABASE_ERROR',
              message: uploadResult.message || 'Unknown upload error',
              operation: 'scheduled_csv_upload',
              timestamp: new Date()
            });
          }
        } else {
          schedulerMetrics.successfulRuns++;
        }
        
        // Update performance metrics
        const totalTime = Date.now() - startTime;
        schedulerMetrics.averageGenerationTime = 
          (schedulerMetrics.averageGenerationTime * (schedulerMetrics.totalRuns - 1) + generationTime) / schedulerMetrics.totalRuns;
        schedulerMetrics.averageUploadTime = 
          (schedulerMetrics.averageUploadTime * (schedulerMetrics.totalRuns - 1) + uploadTime) / schedulerMetrics.totalRuns;
        
        console.log(`[${timestamp}] ✅ Scheduled task completed successfully (${totalTime}ms total)`);
      } else {
        console.error(`[${timestamp}] ❌ CSV generation failed:`, result.message);
        schedulerMetrics.failedRuns++;
        schedulerMetrics.lastError = result.message;
        
        // Log error to database
        await createErrorLog({
          source: 'CSV_SCHEDULER_GENERATION',
          type: 'DATABASE_ERROR',
          message: result.message || 'Unknown generation error',
          operation: 'scheduled_csv_generation',
          timestamp: new Date()
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[${timestamp}] ❌ Scheduled task failed:`, errorMessage);
      schedulerMetrics.failedRuns++;
      schedulerMetrics.lastError = errorMessage;
      
      // Log error to database
      await createErrorLog({
        source: 'CSV_SCHEDULER_TASK',
        type: 'DATABASE_ERROR',
        message: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        operation: 'scheduled_csv_task',
        timestamp: new Date()
      });
    }
  };
  
  // Set up the interval
  scheduledInterval = setInterval(scheduledTask, intervalMs);
  
  console.log(`📅 Scheduler started with ${intervalMinutes} minute interval`);
  
  return {
    success: true,
    message: `Scheduler started with ${intervalMinutes} minute interval`,
    nextRun: new Date(Date.now() + intervalMs)
  };
}

// Response interface for better type safety
interface SchedulerResponse {
  success: boolean;
  settings: {
    isRunning: boolean;
    scheduleRateMinutes: number;
    uploadToSync: boolean;
    eventUpdateFilterMinutes: number;
    lastRunAt: Date | null;
    nextRunAt: Date | null;
    totalRuns: number;
    lastCsvGenerated: string | null;
  };
  metrics?: {
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    averageGenerationTime: number;
    averageUploadTime: number;
    startTime: number;
    lastError?: string;
    uptime: number;
    uptimeFormatted: string;
    successRate: string;
    averageGenerationTimeFormatted: string;
    averageUploadTimeFormatted: string;
  };
}

export async function GET(request: Request) {
  try {
    // Initialize scheduler if not already done
    await initializeScheduler();
    
    const { searchParams } = new URL(request.url);
    const includeMetrics = searchParams.get('metrics') === 'true';
    
    const settings = await getSchedulerSettings();
    
    const response: SchedulerResponse = {
      success: true,
      settings: {
        isRunning: !!scheduledInterval,
        scheduleRateMinutes: settings.scheduleRateMinutes,
        uploadToSync: settings.uploadToSync,
        eventUpdateFilterMinutes: settings.eventUpdateFilterMinutes,
        lastRunAt: settings.lastRunAt,
        nextRunAt: settings.nextRunAt,
        totalRuns: settings.totalRuns,
        lastCsvGenerated: settings.lastCsvGenerated
      }
    };
    
    if (includeMetrics) {
       const uptime = schedulerMetrics.startTime ? Date.now() - schedulerMetrics.startTime : 0;
       response.metrics = {
         ...schedulerMetrics,
         uptime,
         uptimeFormatted: formatUptime(uptime),
         successRate: schedulerMetrics.totalRuns > 0 
           ? ((schedulerMetrics.successfulRuns / schedulerMetrics.totalRuns) * 100).toFixed(2) + '%'
           : '0%',
         averageGenerationTimeFormatted: `${Math.round(schedulerMetrics.averageGenerationTime)}ms`,
         averageUploadTimeFormatted: `${Math.round(schedulerMetrics.averageUploadTime)}ms`
       };
     }
    
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error getting scheduler settings:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to get scheduler settings' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, intervalMinutes, uploadToSync, eventUpdateFilterMinutes } = body;

  try {
    if (action === 'start') {
      // Use provided settings or get from database
      let settings;
      if (intervalMinutes && uploadToSync !== undefined) {
        // Update database with new settings
        settings = await updateSchedulerSettings({
          scheduleRateMinutes: intervalMinutes,
          uploadToSync: uploadToSync,
          isScheduled: true,
          eventUpdateFilterMinutes: eventUpdateFilterMinutes || 0,
          nextRunAt: new Date(Date.now() + intervalMinutes * 60 * 1000)
        });
      } else {
        // Use existing settings from database
        settings = await getSchedulerSettings();
        await updateSchedulerSettings({ isScheduled: true });
      }

      // Start the scheduler using the helper function
      const result = await startScheduler(
        settings.scheduleRateMinutes,
        settings.uploadToSync,
        settings.eventUpdateFilterMinutes || 0
      );

      return NextResponse.json(result);
              

      
    } else if (action === 'stop') {
      // Check database state instead of relying on in-memory variable
      const currentSettings = await getSchedulerSettings();
      
      if (currentSettings.isScheduled) {
        // Clear the interval if it exists in memory
        if (scheduledInterval) {
          clearInterval(scheduledInterval);
          scheduledInterval = null;
        }
        
        // Log final metrics before stopping
        const uptime = Date.now() - schedulerMetrics.startTime;
        const successRate = schedulerMetrics.totalRuns > 0 
          ? ((schedulerMetrics.successfulRuns / schedulerMetrics.totalRuns) * 100).toFixed(2)
          : '0';
        
        console.log(`🛑 CSV scheduler stopped. Final metrics:`);
        console.log(`   Total runs: ${schedulerMetrics.totalRuns}`);
        console.log(`   Success rate: ${successRate}%`);
        console.log(`   Uptime: ${formatUptime(uptime)}`);
        console.log(`   Avg generation time: ${Math.round(schedulerMetrics.averageGenerationTime)}ms`);
        console.log(`   Avg upload time: ${Math.round(schedulerMetrics.averageUploadTime)}ms`);
        
        // Update database to mark scheduler as stopped
        await updateSchedulerSettings({ isScheduled: false });
        
        return NextResponse.json({
          success: true,
          message: 'Scheduler stopped successfully',
          finalMetrics: {
            totalRuns: schedulerMetrics.totalRuns,
            successRate: `${successRate}%`,
            uptime: formatUptime(uptime),
            averageGenerationTime: `${Math.round(schedulerMetrics.averageGenerationTime)}ms`,
            averageUploadTime: `${Math.round(schedulerMetrics.averageUploadTime)}ms`
          }
        });
      } else {
        return NextResponse.json({ message: 'No scheduler is currently running.' }, { status: 400 });
      }
      
    } else if (action === 'update-settings') {
      // Update settings without starting/stopping scheduler
      const { intervalMinutes, uploadToSync, eventUpdateFilterMinutes } = body;
      
      const updates: unknown = {};
      if (intervalMinutes !== undefined) (updates as { scheduleRateMinutes?: number }).scheduleRateMinutes = intervalMinutes;
      if (uploadToSync !== undefined) (updates as { uploadToSync?: boolean }).uploadToSync = uploadToSync;
      if (eventUpdateFilterMinutes !== undefined) (updates as { eventUpdateFilterMinutes?: number }).eventUpdateFilterMinutes = eventUpdateFilterMinutes;
      
      await updateSchedulerSettings(updates as {
        scheduleRateMinutes?: number;
        uploadToSync?: boolean;
        eventUpdateFilterMinutes?: number;
      });
      
      console.log('Scheduler settings updated:', updates);
      return NextResponse.json({ message: 'Settings updated successfully.' });
      
    } else {
      return NextResponse.json({ message: 'Invalid action. Use "start", "stop", or "update-settings".' }, { status: 400 });
    }
    
  } catch (error) {
    console.error('Error in CSV scheduler API:', error);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}