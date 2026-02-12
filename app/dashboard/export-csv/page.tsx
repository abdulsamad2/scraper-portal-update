'use client';

import React, { useState, useEffect } from 'react';
import moment from 'moment';
import { Download, Upload } from 'lucide-react';
import { generateInventoryCsv } from '../../../actions/csvActions';
import { deleteStaleInventory } from '../../../actions/seatActions';

// Simple toast notification function
const showMessage = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
  // Create a simple toast notification
  const toast = document.createElement('div');
  toast.className = `fixed top-4 right-4 px-4 py-2 rounded-md text-white z-50 ${
    type === 'success' ? 'bg-green-500' : 
    type === 'error' ? 'bg-red-500' : 'bg-blue-500'
  }`;
  toast.textContent = text;
  document.body.appendChild(toast);
  setTimeout(() => {
    document.body.removeChild(toast);
  }, 3000);
};

interface ExportSettings {
  uploadToSync: boolean;
  scheduleRateMinutes: number;
  isScheduled: boolean;
  eventUpdateFilterMinutes: number;
}

interface CsvStatus {
  lastUpload: string | null;
  lastGenerated: string | null;
  status: string;
}

interface AutoDeleteSettings {
  isEnabled: boolean;
  graceHours: number;
  scheduleIntervalHours: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  totalRuns: number;
  totalEventsDeleted: number;
  lastRunStats: LastRunStats | null;
  schedulerStatus: string;
}

interface EventPreview {
  id: string;
  name: string;
  dateTime: string;
  venue?: string;
}

interface AutoDeletePreview {
  count: number;
  events: EventPreview[];
  graceHours: number;
  cutoffTime: string;
}

interface LastRunStats {
  eventsChecked: number;
  eventsDeleted: number;
  errors?: string[];
}

interface PerformanceMetrics {
  totalRuns?: number;
  lastGenerated?: string;
  lastRunTime?: string;
  nextRunTime?: string;
  lastUploadAt?: string;
  lastUploadStatus?: string;
  lastUploadId?: string;
  lastUploadError?: string;
  lastClearAt?: string;
  lastCsvGenerated?: string;
  lastRunAt?: string;
  nextRunAt?: string;
  lastManualGeneration?: {
    recordCount: number;
    generationTime: number;
    totalTime?: number;
    timestamp: string;
  };
}

const ExportCsvPage: React.FC = () => {
  const [settings, setSettings] = useState<ExportSettings>({
    uploadToSync: false,
    scheduleRateMinutes: 60,
    isScheduled: false,
    eventUpdateFilterMinutes: 0,
  });
  const [schedulerStatus, setSchedulerStatus] = useState<string>('Stopped');
  const [csvStatus, setCsvStatus] = useState<CsvStatus>({
    lastUpload: null,
    lastGenerated: null,
    status: 'Idle',
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [performanceMetrics, setPerformanceMetrics] = useState<PerformanceMetrics | null>(null);
  const [clearStatus, setClearStatus] = useState('');
  const [isClearingInventory, setIsClearingInventory] = useState(false);
  const [staleCleanupStatus, setStaleCleanupStatus] = useState('');
  const [isCleaningStaleInventory, setIsCleaningStaleInventory] = useState(false);
  const [showClearInventoryDialog, setShowClearInventoryDialog] = useState(false);
  const [showStaleCleanupDialog, setShowStaleCleanupDialog] = useState(false);

  // Auto-delete state
  const [autoDeleteSettings, setAutoDeleteSettings] = useState<AutoDeleteSettings>({
    isEnabled: false,
    graceHours: 15,
    scheduleIntervalHours: 24,
    lastRunAt: null,
    nextRunAt: null,
    totalRuns: 0,
    totalEventsDeleted: 0,
    lastRunStats: null,
    schedulerStatus: 'Stopped'
  });
  const [autoDeletePreview, setAutoDeletePreview] = useState<AutoDeletePreview | null>(null);
  const [showAutoDeletePreview, setShowAutoDeletePreview] = useState(false);
  const [isLoadingAutoDelete, setIsLoadingAutoDelete] = useState(false);

  // Load settings from database on component mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch('/api/csv-scheduler');
        if (response.ok) {
          const data = await response.json();
          const dbSettings = data.settings;
          setSettings({
            scheduleRateMinutes: dbSettings.scheduleRateMinutes,
            uploadToSync: dbSettings.uploadToSync,
            isScheduled: dbSettings.isRunning,
            eventUpdateFilterMinutes: dbSettings.eventUpdateFilterMinutes || 0
          });
          setSchedulerStatus(dbSettings.isRunning ? 'Running' : 'Stopped');
          setPerformanceMetrics({
            totalRuns: dbSettings.totalRuns,
            lastRunAt: dbSettings.lastRunAt,
            nextRunAt: dbSettings.nextRunAt,
            lastCsvGenerated: dbSettings.lastCsvGenerated
          });
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
        showMessage('Failed to load scheduler settings', 'error');
      }
    };
    
    loadSettings();
  }, []);

  // Load auto-delete settings
  useEffect(() => {
    const loadAutoDeleteSettings = async () => {
      try {
        const response = await fetch('/api/auto-delete');
        if (response.ok) {
          const data = await response.json();
          setAutoDeleteSettings(data.settings);
        }
      } catch (error) {
        console.error('Failed to load auto-delete settings:', error);
      }
    };
    
    loadAutoDeleteSettings();
  }, []);


  const handleGenerateCsv = async () => {
    setLoading(true);
    setCsvStatus(prev => ({ ...prev, status: 'Generating...' }));
    const startTime = Date.now();
    
    try {
      const result = await generateInventoryCsv(settings.eventUpdateFilterMinutes);
      
      if (result.success && result.csv) {
        // Create and download the CSV file
        const blob = new Blob([result.csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `inventory-${moment().format('YYYY-MM-DD-HH-mm-ss')}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
        const totalTime = Date.now() - startTime;
        setCsvStatus(prev => ({ 
          ...prev, 
          lastGenerated: moment().toISOString(), 
          status: `Generated successfully! (${result.recordCount || 'Unknown'} records in ${totalTime}ms)` 
        }));
        showMessage(`CSV generated and downloaded successfully! ${result.recordCount || 'Records'} processed in ${result.generationTime || totalTime}ms`, 'success');
        
        // Update performance metrics
        setPerformanceMetrics((prev: PerformanceMetrics | null) => ({
          ...prev,
          lastManualGeneration: {
            recordCount: result.recordCount,
            generationTime: result.generationTime,
            totalTime: totalTime,
            timestamp: new Date().toISOString()
          }
        }));
      } else {
        setCsvStatus(prev => ({ ...prev, status: 'Generation failed' }));
        showMessage(result.message || 'Failed to generate CSV', 'error');
      }
    } catch (error) {
      console.error('CSV Generation Error:', error);
      setCsvStatus(prev => ({ ...prev, status: 'Generation failed' }));
      const errorMessage = error instanceof Error ? error.message : 'Unknown error generating CSV';
      showMessage(`Error generating CSV: ${errorMessage}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleUploadCsv = async () => {
    setLoading(true);
    showMessage('Uploading CSV...', 'info');
    try {
      // Call the API route that handles both generation and upload server-side
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minute timeout

      const response = await fetch('/api/export-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          eventUpdateFilterMinutes: settings.eventUpdateFilterMinutes 
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      const result = await response.json();
      
      if (result.success) {
        showMessage('CSV uploaded to sync service successfully!', 'success');
        setCsvStatus(prev => ({ 
          ...prev, 
          lastUpload: moment().toISOString(), 
          status: 'Uploaded' 
        }));
        
        // Update performance metrics with the upload info
        setPerformanceMetrics((prev: PerformanceMetrics | null) => ({
          ...prev,
          lastUploadAt: new Date().toISOString(),
          lastUploadStatus: 'success',
          lastUploadId: result.uploadId,
          lastManualGeneration: {
            recordCount: result.recordCount,
            generationTime: result.generationTime,
            timestamp: new Date().toISOString()
          }
        }));
      } else {
        showMessage(result.message || 'Failed to upload CSV.', 'error');
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.error('Request timed out:', error);
        showMessage('Upload request timed out. Please try again.', 'error');
      } else {
        console.error('Error uploading CSV:', error);
        showMessage('Error uploading CSV.', 'error');
      }
    }
    setLoading(false);
  };

  const handleStartScheduler = async () => {
    try {
      const response = await fetch('/api/csv-scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'start', 
          intervalMinutes: settings.scheduleRateMinutes,
          uploadToSync: settings.uploadToSync,
          eventUpdateFilterMinutes: settings.eventUpdateFilterMinutes
        })
      });
      
      if (response.ok) {
        setSettings(prev => ({ ...prev, isScheduled: true }));
        setSchedulerStatus('Running');
        showMessage(`Scheduler started - CSV will be generated every ${settings.scheduleRateMinutes} minutes`, 'success');
      } else {
        showMessage('Failed to start scheduler', 'error');
      }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_error) {
      showMessage('Error starting scheduler', 'error');
    }
  };

  const handleStopScheduler = async () => {
    try {
      const response = await fetch('/api/csv-scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' })
      });
      
      if (response.ok) {
        setSettings(prev => ({ ...prev, isScheduled: false }));
        setSchedulerStatus('Stopped');
        showMessage('Scheduler stopped', 'success');
      } else {
        showMessage('Failed to stop scheduler', 'error');
      }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      showMessage('Error stopping scheduler', 'error');
    }
  };

  const handleClearInventory = () => {
    setShowClearInventoryDialog(true);
  };

  const confirmClearInventory = async () => {
    setShowClearInventoryDialog(false);

    setIsClearingInventory(true);
    setClearStatus('Clearing inventory...');

    try {
      const response = await fetch('/api/clear-inventory', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();
      
      if (response.ok) {
        setClearStatus(`✅ ${result.message}`);
        // Refresh settings to get updated upload status
        const settingsResponse = await fetch('/api/csv-scheduler');
        if (settingsResponse.ok) {
          const settingsData = await settingsResponse.json();
          setSettings(settingsData);
          setSchedulerStatus(settingsData.isScheduled ? 'running' : 'stopped');
          // Create performance metrics from the settings data
          const metrics = {
            totalRuns: settingsData.totalRuns || 0,
            lastGenerated: settingsData.lastCsvGenerated,
            lastRunTime: settingsData.lastRunAt,
            nextRunTime: settingsData.nextRunAt
          };
          setPerformanceMetrics(metrics);
        }
      } else {
        setClearStatus(`❌ Error: ${result.message}`);
      }
    } catch (error) {
      setClearStatus('❌ Error clearing inventory.');
      console.error('Error clearing inventory:', error);
    } finally {
      setIsClearingInventory(false);
    }
  };

  const cancelClearInventory = () => {
    setShowClearInventoryDialog(false);
  };

  const handleCleanupStaleInventory = () => {
    setShowStaleCleanupDialog(true);
  };

  const confirmStaleCleanup = async () => {
    setShowStaleCleanupDialog(false);

    setIsCleaningStaleInventory(true);
    setStaleCleanupStatus('Cleaning up stale inventory...');

    try {
      const result = await deleteStaleInventory();
      
      if (result.success) {
        setStaleCleanupStatus(`✅ ${result.message || 'Stale inventory cleaned up successfully'}`);
        if (result.details) {
          setStaleCleanupStatus(prev => `${prev}\n📊 Details: ${result.details.join(', ')}`);
        }
        if (result.deletedCount) {
          setStaleCleanupStatus(prev => `${prev}\n🗑️ Total deleted: ${result.deletedCount} groups`);
        }
        showMessage(`Stale inventory cleaned up successfully! Deleted ${result.deletedCount} groups`, 'success');
      } else {
        setStaleCleanupStatus(`❌ Error: ${result.error || 'Failed to cleanup stale inventory'}`);
        showMessage(result.error || 'Failed to cleanup stale inventory', 'error');
      }
    } catch (error) {
      setStaleCleanupStatus('❌ Error cleaning up stale inventory.');
      console.error('Error cleaning up stale inventory:', error);
      showMessage('Error cleaning up stale inventory', 'error');
    } finally {
      setIsCleaningStaleInventory(false);
    }
  };

  const cancelStaleCleanup = () => {
    setShowStaleCleanupDialog(false);
  };

  // Auto-delete functions
  const handleAutoDeleteToggle = async (enabled: boolean) => {
    setIsLoadingAutoDelete(true);
    try {
      const response = await fetch('/api/auto-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: enabled ? 'start' : 'stop',
          graceHours: autoDeleteSettings.graceHours,
          scheduleIntervalHours: autoDeleteSettings.scheduleIntervalHours
        })
      });

      const result = await response.json();
      if (result.success) {
        setAutoDeleteSettings((prev: AutoDeleteSettings) => ({ 
          ...prev, 
          isEnabled: enabled,
          schedulerStatus: enabled ? 'Running' : 'Stopped'
        }));
        showMessage(result.message, 'success');
      } else {
        showMessage(result.error || 'Failed to update auto-delete', 'error');
      }
    } catch (error) {
      console.error('Error toggling auto-delete:', error);
      showMessage('Error updating auto-delete settings', 'error');
    } finally {
      setIsLoadingAutoDelete(false);
    }
  };

  const handleAutoDeleteSettingsUpdate = async (updates: Partial<AutoDeleteSettings>) => {
    setIsLoadingAutoDelete(true);
    try {
      const response = await fetch('/api/auto-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'update-settings',
          ...updates
        })
      });

      const result = await response.json();
      if (result.success) {
        setAutoDeleteSettings((prev: AutoDeleteSettings) => ({ ...prev, ...updates }));
        showMessage('Auto-delete settings updated', 'success');
      } else {
        showMessage(result.error || 'Failed to update settings', 'error');
      }
    } catch (error) {
      console.error('Error updating auto-delete settings:', error);
      showMessage('Error updating settings', 'error');
    } finally {
      setIsLoadingAutoDelete(false);
    }
  };

  const handleAutoDeletePreview = async () => {
    setIsLoadingAutoDelete(true);
    try {
      const response = await fetch('/api/auto-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'preview',
          graceHours: autoDeleteSettings.graceHours
        })
      });

      const result = await response.json();
      if (result.success) {
        setAutoDeletePreview(result);
        setShowAutoDeletePreview(true);
      } else {
        showMessage(result.error || 'Failed to get preview', 'error');
      }
    } catch (error) {
      console.error('Error getting auto-delete preview:', error);
      showMessage('Error getting preview', 'error');
    } finally {
      setIsLoadingAutoDelete(false);
    }
  };

  const handleAutoDeleteRunNow = async () => {
    setIsLoadingAutoDelete(true);
    try {
      const response = await fetch('/api/auto-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run-now' })
      });

      const result = await response.json();
      if (result.success) {
        showMessage(result.message, 'success');
        // Refresh settings
        const settingsResponse = await fetch('/api/auto-delete');
        if (settingsResponse.ok) {
          const data = await settingsResponse.json();
          setAutoDeleteSettings(data.settings);
        }
      } else {
        showMessage(result.error || 'Failed to run auto-delete', 'error');
      }
    } catch (error) {
      console.error('Error running auto-delete:', error);
      showMessage('Error running auto-delete', 'error');
    } finally {
      setIsLoadingAutoDelete(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/csv-scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'update-settings',
          intervalMinutes: settings.scheduleRateMinutes,
          uploadToSync: settings.uploadToSync,
          eventUpdateFilterMinutes: settings.eventUpdateFilterMinutes
        })
      });
      
      if (response.ok) {
        showMessage('Settings saved successfully!', 'success');
      } else {
        showMessage('Failed to save settings', 'error');
      }
    } catch (error) {
      showMessage('Error saving settings', 'error');
      console.error('Error saving settings:', error);
    }
  };

  return (
    <div className="p-5">
      <h2 className="text-2xl font-bold mb-6">Export Inventory CSV</h2>

      <div className="bg-white rounded-lg shadow-md p-6 mb-5">
        <h3 className="text-lg font-semibold mb-4 border-b pb-2">Configuration Settings</h3>
        <form onSubmit={handleSaveSettings} className="space-y-4">
          <div className="flex items-center">
            <input
              type="checkbox"
              id="uploadToSync"
              checked={settings.uploadToSync}
              onChange={(e) => setSettings(prev => ({ ...prev, uploadToSync: e.target.checked }))}
              className="mr-2 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="uploadToSync" className="text-sm font-medium text-gray-700">
              Upload to Sync Service Automatically
            </label>
          </div>
          <div>
             <label htmlFor="scheduleRateMinutes" className="block text-sm font-medium text-gray-700 mb-1">
               Schedule Rate (Minutes)
             </label>
             <input
               type="number"
               id="scheduleRateMinutes"
               value={settings.scheduleRateMinutes}
               onChange={(e) => setSettings(prev => ({ ...prev, scheduleRateMinutes: parseInt(e.target.value) || 60 }))}
               min="1"
               max="1440"
               placeholder="60"
               className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
             />
             <p className="text-xs text-gray-500 mt-1">Enter interval in minutes (1-1440)</p>
           </div>
           <div>
             <label htmlFor="eventUpdateFilterMinutes" className="block text-sm font-medium text-gray-700 mb-1">
               Event Update Filter (Minutes)
             </label>
             <input
               type="number"
               id="eventUpdateFilterMinutes"
               value={settings.eventUpdateFilterMinutes}
               onChange={(e) => setSettings(prev => ({ ...prev, eventUpdateFilterMinutes: parseInt(e.target.value) || 0 }))}
               min="0"
               max="10080"
               placeholder="0"
               className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
             />
             <p className="text-xs text-gray-500 mt-1">Filter events updated within last X minutes (0 = no filter, max 7 days)</p>
           </div>
           <div className="flex items-center space-x-4">
             <div className="flex items-center">
               <span className="text-sm font-medium text-gray-700 mr-2">Scheduler Status:</span>
               <span className={`text-sm font-semibold ${
                 schedulerStatus === 'Running' ? 'text-green-600' : 'text-red-600'
               }`}>
                 {schedulerStatus}
               </span>
             </div>
             {!settings.isScheduled ? (
               <button
                 type="button"
                 onClick={handleStartScheduler}
                 className="bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-md transition-colors"
               >
                 Start Scheduler
               </button>
             ) : (
               <button
                 type="button"
                 onClick={handleStopScheduler}
                 className="bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-md transition-colors"
               >
                 Stop Scheduler
               </button>
             )}
           </div>
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition-colors"
          >
            Save Settings
          </button>
        </form>
      </div>

      {/* Performance Metrics Section */}
      {performanceMetrics && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-5">
          <h3 className="text-lg font-semibold mb-4 border-b pb-2">Performance Metrics</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-50 p-3 rounded">
              <div className="text-sm text-gray-600">Total Scheduled Runs</div>
              <div className="text-lg font-semibold text-gray-900">{performanceMetrics.totalRuns || 0}</div>
            </div>
            <div className="bg-gray-50 p-3 rounded">
              <div className="text-sm text-gray-600">Last CSV Generated</div>
              <div className="text-sm font-medium text-gray-900">
                {performanceMetrics.lastCsvGenerated || 'None'}
              </div>
            </div>
            {performanceMetrics.lastRunAt && (
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-sm text-gray-600">Last Run</div>
                <div className="text-sm font-medium text-gray-900">
                  {moment(performanceMetrics.lastRunAt).format('YYYY-MM-DD HH:mm:ss')}
                </div>
              </div>
            )}
            {performanceMetrics.nextRunAt && settings.isScheduled && (
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-sm text-gray-600">Next Run</div>
                <div className="text-sm font-medium text-gray-900">
                  {moment(performanceMetrics.nextRunAt).format('YYYY-MM-DD HH:mm:ss')}
                </div>
              </div>
            )}
            
            {/* Upload Status Section */}
            {performanceMetrics.lastUploadAt && (
              <div className="bg-blue-50 p-3 rounded col-span-2">
                <div className="text-sm text-blue-600 mb-1">Sync Upload Status</div>
                <div className="text-xs text-blue-800">
                  Last Upload: {moment(performanceMetrics.lastUploadAt).format('YYYY-MM-DD HH:mm:ss')}
                  <br />
                  Status: <span className={`ml-1 px-2 py-1 rounded text-xs ${
                    performanceMetrics.lastUploadStatus === 'success' ? 'bg-green-100 text-green-800' :
                    performanceMetrics.lastUploadStatus === 'cleared' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {performanceMetrics.lastUploadStatus}
                  </span>
                  {performanceMetrics.lastUploadId && (
                    <><br />Upload ID: {performanceMetrics.lastUploadId}</>
                  )}
                  {performanceMetrics.lastUploadError && (
                    <><br />Error: <span className="text-red-600">{performanceMetrics.lastUploadError}</span></>
                  )}
                  {performanceMetrics.lastClearAt && (
                    <><br />Last Inventory Clear: {moment(performanceMetrics.lastClearAt).format('YYYY-MM-DD HH:mm:ss')}</>
                  )}
                </div>
              </div>
            )}
            
            {performanceMetrics.lastManualGeneration && (
              <div className="bg-blue-50 p-3 rounded col-span-2">
                <div className="text-sm text-blue-600 mb-1">Last Manual Generation</div>
                <div className="text-xs text-blue-800">
                  {performanceMetrics.lastManualGeneration.recordCount} records in {performanceMetrics.lastManualGeneration.generationTime}ms
                  <br />
                  Total time: {performanceMetrics.lastManualGeneration.totalTime}ms
                  <br />
                  {moment(performanceMetrics.lastManualGeneration.timestamp).format('YYYY-MM-DD HH:mm:ss')}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Auto-Delete Past Events Section */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-5">
        <h3 className="text-lg font-semibold mb-4 border-b pb-2">Auto-Delete Past Events</h3>
        <div className="space-y-4">
          <div className="bg-yellow-50 p-4 rounded-lg">
            <p className="text-yellow-800 text-sm">
              <strong>Auto-Delete Feature:</strong> Automatically deletes events that have already taken place after a configurable grace period. 
              Example: An event on September 11th at 9pm EST will be deleted 15 hours later (default) on September 12th at 12pm EST.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Grace Period (Hours)
              </label>
              <input
                type="number"
                value={autoDeleteSettings.graceHours}
                onChange={(e) => setAutoDeleteSettings((prev: AutoDeleteSettings) => ({ 
                  ...prev, 
                  graceHours: parseInt(e.target.value) || 15 
                }))}
                min="1"
                max="168"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">Hours to wait after event time before deletion (1-168 hours)</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Check Interval (Hours)
              </label>
              <input
                type="number"
                value={autoDeleteSettings.scheduleIntervalHours}
                onChange={(e) => setAutoDeleteSettings((prev: AutoDeleteSettings) => ({ 
                  ...prev, 
                  scheduleIntervalHours: parseInt(e.target.value) || 24 
                }))}
                min="1"
                max="168"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">How often to check for expired events (1-168 hours)</p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <span className="text-sm font-medium text-gray-700">Auto-Delete Status:</span>
              <span className={`text-sm font-semibold ${
                autoDeleteSettings.schedulerStatus === 'Running' ? 'text-green-600' : 'text-red-600'
              }`}>
                {autoDeleteSettings.schedulerStatus}
              </span>
            </div>
            
            <div className="flex space-x-2">
              <button
                onClick={() => handleAutoDeleteSettingsUpdate({
                  graceHours: autoDeleteSettings.graceHours,
                  scheduleIntervalHours: autoDeleteSettings.scheduleIntervalHours
                })}
                disabled={isLoadingAutoDelete}
                className="bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded-md transition-colors disabled:bg-gray-400"
              >
                Update Settings
              </button>

              {!autoDeleteSettings.isEnabled ? (
                <button
                  onClick={() => handleAutoDeleteToggle(true)}
                  disabled={isLoadingAutoDelete}
                  className="bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-md transition-colors disabled:bg-gray-400"
                >
                  {isLoadingAutoDelete ? 'Starting...' : 'Start Auto-Delete'}
                </button>
              ) : (
                <button
                  onClick={() => handleAutoDeleteToggle(false)}
                  disabled={isLoadingAutoDelete}
                  className="bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-md transition-colors disabled:bg-gray-400"
                >
                  {isLoadingAutoDelete ? 'Stopping...' : 'Stop Auto-Delete'}
                </button>
              )}
            </div>
          </div>

          <div className="flex space-x-2">
            <button
              onClick={handleAutoDeletePreview}
              disabled={isLoadingAutoDelete}
              className="bg-blue-100 hover:bg-blue-200 text-blue-800 font-medium py-2 px-4 rounded-md transition-colors disabled:bg-gray-100"
            >
              Preview Events to Delete
            </button>
            
            <button
              onClick={handleAutoDeleteRunNow}
              disabled={isLoadingAutoDelete || !autoDeleteSettings.isEnabled}
              className="bg-orange-500 hover:bg-orange-600 text-white font-medium py-2 px-4 rounded-md transition-colors disabled:bg-gray-400"
            >
              Run Now
            </button>
          </div>

          {/* Auto-Delete Statistics */}
          {autoDeleteSettings.lastRunAt && (
            <div className="bg-gray-50 p-4 rounded-lg">
              <h4 className="text-sm font-semibold mb-2">Auto-Delete Statistics</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-gray-600">Total Runs</div>
                  <div className="font-medium">{autoDeleteSettings.totalRuns}</div>
                </div>
                <div>
                  <div className="text-gray-600">Events Deleted</div>
                  <div className="font-medium">{autoDeleteSettings.totalEventsDeleted}</div>
                </div>
                <div>
                  <div className="text-gray-600">Last Run</div>
                  <div className="font-medium">
                    {moment(autoDeleteSettings.lastRunAt).format('MM/DD HH:mm')}
                  </div>
                </div>
                <div>
                  <div className="text-gray-600">Next Run</div>
                  <div className="font-medium">
                    {autoDeleteSettings.nextRunAt 
                      ? moment(autoDeleteSettings.nextRunAt).format('MM/DD HH:mm')
                      : 'Not scheduled'
                    }
                  </div>
                </div>
              </div>
              
              {autoDeleteSettings.lastRunStats && (
                <div className="mt-3 pt-3 border-t">
                  <div className="text-xs text-gray-600">
                    Last run: Checked {autoDeleteSettings.lastRunStats.eventsChecked} events, 
                    deleted {autoDeleteSettings.lastRunStats.eventsDeleted} expired events
                    {autoDeleteSettings.lastRunStats.errors && autoDeleteSettings.lastRunStats.errors.length > 0 && (
                      <span className="text-red-600 ml-2">
                        ({autoDeleteSettings.lastRunStats.errors.length} errors)
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Clear Inventory Section */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-5">
        <h3 className="text-lg font-semibold mb-4 border-b pb-2">Inventory Management</h3>
        <div className="space-y-4">
          <div>
            <p className="text-gray-600 mb-3">
              Clear all inventory from Sync service. This will upload an empty CSV to remove all existing inventory.
            </p>
            <button
              onClick={handleClearInventory}
              disabled={isClearingInventory}
              className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isClearingInventory ? 'Clearing...' : 'Clear All Inventory'}
            </button>
          </div>
          {clearStatus && (
            <div className={`p-3 rounded ${
              clearStatus.includes('✅') ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
            }`}>
              {clearStatus}
            </div>
          )}
          
          <div className="border-t pt-4">
            <p className="text-gray-600 mb-3">
              Clean up stale inventory from the database. This will remove consecutive groups for inactive events (Skip_Scraping = true) and orphaned inventory where events no longer exist.
            </p>
            <button
              onClick={handleCleanupStaleInventory}
              disabled={isCleaningStaleInventory}
              className="bg-orange-500 text-white px-4 py-2 rounded hover:bg-orange-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isCleaningStaleInventory ? 'Cleaning...' : 'Clean Up Stale Inventory'}
            </button>
          </div>
          {staleCleanupStatus && (
            <div className={`p-3 rounded whitespace-pre-line ${
              staleCleanupStatus.includes('✅') ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
            }`}>
              {staleCleanupStatus}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6 mb-5">
        <h3 className="text-lg font-semibold mb-4 border-b pb-2">CSV Generation and Download</h3>
        <div className="space-y-3">
          <button
            onClick={handleGenerateCsv}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-3 px-4 rounded-md transition-colors flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" />
            {loading ? 'Generating...' : 'Generate and Download CSV'}
          </button>
          {settings.uploadToSync && (
            <button
              onClick={handleUploadCsv}
              disabled={loading}
              className="w-full bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400 text-white font-medium py-3 px-4 rounded-md transition-colors flex items-center justify-center gap-2"
            >
              <Upload className="w-4 h-4" />
              {loading ? 'Uploading...' : 'Upload Latest CSV to Sync Service'}
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-lg font-semibold mb-4 border-b pb-2">CSV Status</h3>
        <div className="space-y-2 text-sm text-gray-700">
          <div>Last Generated: {csvStatus.lastGenerated ? moment(csvStatus.lastGenerated).format('YYYY-MM-DD HH:mm:ss') : 'N/A'}</div>
          <div>Last Uploaded: {csvStatus.lastUpload ? moment(csvStatus.lastUpload).format('YYYY-MM-DD HH:mm:ss') : 'N/A'}</div>
          <div>Current Status: {csvStatus.status}</div>
        </div>
      </div>

      {/* Clear All Inventory Confirmation Dialog */}
      {showClearInventoryDialog && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center">
          <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex items-center justify-center w-12 h-12 mx-auto bg-red-100 rounded-full mb-4">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div className="text-center">
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  Clear All Inventory?
                </h3>
                <p className="text-sm text-gray-500 mb-6">
                  Are you sure you want to clear all inventory from Sync?<br/><br/>
                  <span className="text-red-600 font-medium">This action cannot be undone.</span>
                </p>
                <div className="flex justify-center space-x-3">
                  <button
                    onClick={cancelClearInventory}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmClearInventory}
                    className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                  >
                    Clear All Inventory
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Clear Stale Inventory Confirmation Dialog */}
      {showStaleCleanupDialog && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center">
          <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex items-center justify-center w-12 h-12 mx-auto bg-yellow-100 rounded-full mb-4">
                <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <div className="text-center">
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  Clear Stale Inventory?
                </h3>
                <p className="text-sm text-gray-500 mb-6">
                  Are you sure you want to cleanup stale inventory?<br/><br/>
                  This will delete consecutive groups for inactive events and orphaned inventory.<br/><br/>
                  <span className="text-yellow-600 font-medium">This action cannot be undone.</span>
                </p>
                <div className="flex justify-center space-x-3">
                  <button
                    onClick={cancelStaleCleanup}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmStaleCleanup}
                    className="px-4 py-2 text-sm font-medium text-white bg-yellow-600 rounded-md hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500"
                  >
                    Clear Stale Inventory
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Auto-Delete Preview Dialog */}
      {showAutoDeletePreview && autoDeletePreview && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center">
          <div className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900">
                  Auto-Delete Preview
                </h3>
                <button
                  onClick={() => setShowAutoDeletePreview(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              <div className="mb-4">
                <p className="text-sm text-gray-600">
                  Grace period: <strong>{autoDeletePreview.graceHours} hours</strong>
                  <br />
                  Cutoff time: <strong>{moment(autoDeletePreview.cutoffTime).format('YYYY-MM-DD HH:mm:ss')}</strong>
                </p>
              </div>

              {autoDeletePreview.count === 0 ? (
                <div className="text-center py-8">
                  <div className="text-green-600 text-lg font-medium mb-2">
                    ✅ No events to delete
                  </div>
                  <p className="text-gray-500">
                    All events are still within the grace period or are scheduled for the future.
                  </p>
                </div>
              ) : (
                <div>
                  <div className="mb-4">
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-800">
                      {autoDeletePreview.count} events will be deleted
                    </span>
                  </div>
                  
                  <div className="max-h-64 overflow-y-auto border rounded-lg">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Event ID</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Event Name</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date/Time</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Venue</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {autoDeletePreview.events.map((event: EventPreview, index: number) => (
                          <tr key={index} className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-sm font-medium text-gray-900">{event.id}</td>
                            <td className="px-4 py-2 text-sm text-gray-900">{event.name}</td>
                            <td className="px-4 py-2 text-sm text-gray-500">
                              {moment(event.dateTime).format('YYYY-MM-DD HH:mm')}
                            </td>
                            <td className="px-4 py-2 text-sm text-gray-500">{event.venue || 'N/A'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 p-3 bg-yellow-50 rounded-lg">
                    <p className="text-yellow-800 text-sm">
                      <strong>Warning:</strong> These events and all their associated seat inventory will be permanently deleted.
                      This action cannot be undone.
                    </p>
                  </div>
                </div>
              )}

              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={() => setShowAutoDeletePreview(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExportCsvPage;