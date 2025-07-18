'use client';

import React, { useState, useEffect } from 'react';
import moment from 'moment';
import { Download, Upload } from 'lucide-react';
import { generateInventoryCsv, uploadCsvToSyncService } from '../../../actions/csvActions';
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [performanceMetrics, setPerformanceMetrics] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isLoading, setIsLoading] = useState(true);
  const [clearStatus, setClearStatus] = useState('');
  const [isClearingInventory, setIsClearingInventory] = useState(false);
  const [staleCleanupStatus, setStaleCleanupStatus] = useState('');
  const [isCleaningStaleInventory, setIsCleaningStaleInventory] = useState(false);

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
      } finally {
        setIsLoading(false);
      }
    };
    
    loadSettings();
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
        setPerformanceMetrics((prev: {
          totalRuns?: number;
          lastRunAt?: string;
          nextRunAt?: string;
          lastCsvGenerated?: string;
          lastUploadAt?: string;
          lastUploadStatus?: string;
          lastUploadId?: string;
          lastUploadError?: string;
          lastClearAt?: string;
          lastManualGeneration?: {
            recordCount: number;
            generationTime: number;
            totalTime: number;
            timestamp: string;
          };
        }) => ({
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_error) {
      setCsvStatus(prev => ({ ...prev, status: 'Generation failed' }));
      showMessage('Error generating CSV', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleUploadCsv = async () => {
    setLoading(true);
    showMessage('Uploading CSV...', 'info');
    try {
      // In a real application, you would get the latest generated CSV content to upload
      // For now, we'll assume it's available or re-generate if needed.
      const generateResult = await generateInventoryCsv(settings.eventUpdateFilterMinutes);
      if (!generateResult.success || !generateResult.csv) {
        showMessage(generateResult.message || 'Failed to get CSV content for upload.', 'error');
        setLoading(false);
        return;
      }

      const uploadResult = await uploadCsvToSyncService(generateResult.csv);
      if (uploadResult.success) {
        showMessage('CSV uploaded to sync service successfully!', 'success');
        setCsvStatus(prev => ({ ...prev, lastUpload: moment().toISOString(), status: 'Uploaded' }));
      } else {
        showMessage(uploadResult.message || 'Failed to upload CSV.', 'error');
      }
    } catch (error) {
      console.error('Error uploading CSV:', error);
      showMessage('Error uploading CSV.', 'error');
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

  const handleClearInventory = async () => {
    if (!confirm('Are you sure you want to clear all inventory from Sync? This action cannot be undone.')) {
      return;
    }

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

  const handleCleanupStaleInventory = async () => {
    if (!confirm('Are you sure you want to cleanup stale inventory? This will delete consecutive groups for inactive events and orphaned inventory.')) {
      return;
    }

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
    </div>
  );
};

export default ExportCsvPage;