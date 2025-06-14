import { NextApiRequest, NextApiResponse } from 'next';
import { generateInventoryCsv, uploadCsvToSyncService, getSchedulerSettings, updateSchedulerSettings } from '../../actions/csvActions';
import fs from 'fs';
import path from 'path';

// Store the interval instance
let scheduledInterval: NodeJS.Timeout | null = null;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'GET') {
    // Get current scheduler settings
    try {
      const settings = await getSchedulerSettings();
      return res.status(200).json(settings);
    } catch (error) {
      console.error('Error getting scheduler settings:', error);
      return res.status(500).json({ message: 'Failed to get scheduler settings' });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { action, intervalMinutes, uploadToSync } = req.body;

  try {
    if (action === 'start') {
      // Stop existing interval if running
      if (scheduledInterval) {
        clearInterval(scheduledInterval);
        scheduledInterval = null;
      }

      // Use provided settings or get from database
      let settings;
      if (intervalMinutes && uploadToSync !== undefined) {
        // Update database with new settings
        settings = await updateSchedulerSettings({
          scheduleRateMinutes: intervalMinutes,
          uploadToSync: uploadToSync,
          isScheduled: true,
          nextRunAt: new Date(Date.now() + intervalMinutes * 60 * 1000)
        });
      } else {
        // Use existing settings from database
        settings = await getSchedulerSettings();
        await updateSchedulerSettings({ isScheduled: true });
      }

      // Validate interval
      if (!settings.scheduleRateMinutes || settings.scheduleRateMinutes < 1 || settings.scheduleRateMinutes > 1440) {
        return res.status(400).json({ message: 'Invalid interval. Must be between 1 and 1440 minutes.' });
      }

      // Create the scheduled interval with performance optimizations
      const intervalMs = settings.scheduleRateMinutes * 60 * 1000;
      
      const scheduledTask = async () => {
        const startTime = Date.now();
        console.log(`[${new Date().toISOString()}] Running scheduled CSV generation...`);
        
        try {
          // Get current settings for this run
          const currentSettings = await getSchedulerSettings();
          
          // Update last run time and increment total runs
          await updateSchedulerSettings({
            lastRunAt: new Date(),
            nextRunAt: new Date(Date.now() + currentSettings.scheduleRateMinutes * 60 * 1000),
            totalRuns: currentSettings.totalRuns + 1
          });

          // Generate CSV with performance tracking
          const result = await generateInventoryCsv();
          
          if (result.success && result.csv) {
            // Save CSV to exports directory
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `inventory-${timestamp}.csv`;
            const exportsDir = path.join(process.cwd(), 'exports');
            
            // Ensure exports directory exists
            if (!fs.existsSync(exportsDir)) {
              fs.mkdirSync(exportsDir, { recursive: true });
            }
            
            const filePath = path.join(exportsDir, filename);
            
            // Use async file writing for better performance
            await fs.promises.writeFile(filePath, result.csv, 'utf8');
            
            // Update database with last generated CSV info
            await updateSchedulerSettings({
              lastCsvGenerated: filename
            });
            
            const fileSize = Buffer.byteLength(result.csv, 'utf8');
            console.log(`[${new Date().toISOString()}] CSV saved: ${filename} (${result.recordCount} records, ${fileSize} bytes, generated in ${result.generationTime}ms)`);
            
            // Upload to sync service if enabled
            if (currentSettings.uploadToSync) {
              const uploadResult = await uploadCsvToSyncService(result.csv);
              if (uploadResult.success) {
                console.log(`[${new Date().toISOString()}] CSV uploaded to sync service successfully`);
              } else {
                console.error(`[${new Date().toISOString()}] Failed to upload CSV:`, uploadResult.message);
              }
            }
          } else {
            console.error(`[${new Date().toISOString()}] Failed to generate CSV:`, result.message);
          }
          
          const totalTime = Date.now() - startTime;
          console.log(`[${new Date().toISOString()}] Scheduled task completed in ${totalTime}ms`);
        } catch (error) {
          console.error(`[${new Date().toISOString()}] Error in scheduled CSV generation:`, error);
        }
      };

      // Start the interval
      scheduledInterval = setInterval(scheduledTask, intervalMs);
      
      console.log(`CSV scheduler started with ${settings.scheduleRateMinutes} minute interval`);
      return res.status(200).json({ 
        message: `Scheduler started successfully. CSV will be generated every ${settings.scheduleRateMinutes} minutes.`,
        settings: settings
      });
      
    } else if (action === 'stop') {
      // Check database state instead of relying on in-memory variable
      const currentSettings = await getSchedulerSettings();
      
      if (currentSettings.isScheduled) {
        // Clear the interval if it exists in memory
        if (scheduledInterval) {
          clearInterval(scheduledInterval);
          scheduledInterval = null;
        }
        
        // Update database to mark scheduler as stopped
        await updateSchedulerSettings({ isScheduled: false });
        
        console.log('CSV scheduler stopped');
        return res.status(200).json({ message: 'Scheduler stopped successfully.' });
      } else {
        return res.status(400).json({ message: 'No scheduler is currently running.' });
      }
      
    } else {
      return res.status(400).json({ message: 'Invalid action. Use "start" or "stop".' });
    }
    
  } catch (error) {
    console.error('Error in CSV scheduler API:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}