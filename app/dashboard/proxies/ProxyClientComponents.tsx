'use client';

import React, { useState, useTransition } from 'react';
import {
  createProxy,
  updateProxy,
  deleteProxy,
  bulkDeleteProxies,
  bulkImportProxies,
  testProxy,
  deleteAllProxies,
  type ProxyData,
  type BulkImportResult
} from '@/actions/proxyActions';
import {
  Plus,
  Search,
  Upload,
  Trash2,
  Edit2,
  Globe,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Download
} from 'lucide-react';

interface Proxy {
  _id: string;
  proxy_id: string;
  server: string;
  ip: string;
  port: number;
  username?: string;
  password?: string;
  provider?: string;
  region?: string;
  status: 'active' | 'inactive' | 'blacklisted' | 'maintenance';
  is_working: boolean;
  success_rate?: number;
  total_requests?: number;
  failed_requests?: number;
  last_tested?: string;
  raw_proxy_string: string;
  createdAt: string;
  updatedAt: string;
}

interface ProxyClientComponentsProps {
  proxies: Proxy[];
}

export function BulkActions({ onRefresh }: { onRefresh: () => void }) {
  const [selectedProxies, setSelectedProxies] = useState<string[]>([]);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const [newProxyData, setNewProxyData] = useState({
    raw_proxy_string: '',
    provider: '',
    region: '',
    status: 'active' as const
  });

  const [bulkProxiesText, setBulkProxiesText] = useState('');
  const [bulkImportResult, setBulkImportResult] = useState<BulkImportResult | null>(null);
  const [bulkImportLoading, setBulkImportLoading] = useState(false);
  const [bulkValidationErrors, setBulkValidationErrors] = useState<string[]>([]);
  const [validProxies, setValidProxies] = useState<string[]>([]);
  const [bulkImportStep, setBulkImportStep] = useState<'input' | 'preview' | 'progress' | 'results'>('input');
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [importProgress, setImportProgress] = useState({ processed: 0, total: 0, startTime: 0 });

  const validateBulkProxies = (text: string) => {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const errors: string[] = [];
    const valid: string[] = [];

    lines.forEach((line, index) => {
      if (!line.includes(':')) {
        errors.push(`Line ${index + 1}: Missing colons. Expected format: ip:port:username:password`);
      } else {
        const parts = line.split(':');
        if (parts.length !== 4) {
          errors.push(`Line ${index + 1}: Expected 4 parts separated by colons, got ${parts.length}`);
        } else {
          const [ip, port, username, password] = parts;

          if (!ip || !ip.match(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/)) {
            errors.push(`Line ${index + 1}: Invalid IP address format`);
          } else if (!port || isNaN(parseInt(port)) || parseInt(port) < 1 || parseInt(port) > 65535) {
            errors.push(`Line ${index + 1}: Invalid port number (must be 1-65535)`);
          } else if (!username || username.trim().length === 0) {
            errors.push(`Line ${index + 1}: Username cannot be empty`);
          } else if (!password || password.trim().length === 0) {
            errors.push(`Line ${index + 1}: Password cannot be empty`);
          } else {
            valid.push(line);
          }
        }
      }
    });

    setBulkValidationErrors(errors);
    setValidProxies(valid);
    return { errors, valid };
  };

  // Remove client-side validation - let server handle formatting and validation
  const handleBulkImportTextChange = (text: string) => {
    setBulkProxiesText(text);
    // Clear previous validation state
    setBulkValidationErrors([]);
    setValidProxies([]);
  };

  const handleBulkImportPreview = () => {
    const lines = bulkProxiesText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    if (lines.length > 0) {
      setBulkImportStep('preview');
    } else {
      setMessage({ type: 'error', text: 'Please enter some proxies to import.' });
    }
  };

  const handleBulkImport = async () => {
    try {
      setBulkImportLoading(true);
      setBulkImportStep('progress');
      const startTime = Date.now();
      
      // Split raw text into lines
      const lines = bulkProxiesText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      setImportProgress({ processed: 0, total: lines.length, startTime });

      // Process in chunks of 100 for better progress tracking
      const chunkSize = 100;
      const chunks = [];
      for (let i = 0; i < lines.length; i += chunkSize) {
        chunks.push(lines.slice(i, i + chunkSize));
      }

      let totalSuccess = 0;
      let totalFailed = 0;
      let processed = 0;

      // Replace all existing first if needed
      if (replaceExisting && chunks.length > 0) {
        await bulkImportProxies('', {}, true); // Clear existing proxies
      }

      // Process chunks sequentially for reliable progress tracking
      for (const chunk of chunks) {
        const chunkText = chunk.join('\n');
        const result = await bulkImportProxies(chunkText, {
          provider: newProxyData.provider,
          region: newProxyData.region,
          status: 'active'
        }, false);

        totalSuccess += result.success;
        totalFailed += result.failed;
        processed += chunk.length;

        // Update progress after each chunk
        setImportProgress({ processed, total: lines.length, startTime });
      }

      setBulkImportResult({ success: totalSuccess, failed: totalFailed, errors: [], imported: [] });
      setBulkImportStep('results');

      if (totalSuccess > 0) {
        setMessage({
          type: 'success',
          text: `Successfully imported ${totalSuccess} proxies${totalFailed > 0 ? `, ${totalFailed} failed` : ''}`
        });
        startTransition(() => {
          onRefresh();
        });
      } else {
        setMessage({ type: 'error', text: 'Failed to import any proxies. Please check the format and try again.' });
      }

    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to import proxies' });
      console.error(err);
    } finally {
      setBulkImportLoading(false);
    }
  };

  const handleCreateProxy = async () => {
    try {
      const result = await createProxy(newProxyData as ProxyData);

      if ('error' in result) {
        setMessage({ type: 'error', text: result.error || 'Failed to create proxy' });
      } else {
        setMessage({ type: 'success', text: 'Proxy created successfully' });
        setShowAddModal(false);
        setNewProxyData({
          raw_proxy_string: '',
          provider: '',
          region: '',
          status: 'active'
        });
        startTransition(() => {
          onRefresh();
        });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to create proxy' });
      console.error(err);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedProxies.length === 0) return;

    if (!confirm(`Are you sure you want to delete ${selectedProxies.length} proxies?`)) return;

    try {
      const result = await bulkDeleteProxies(selectedProxies);

      if ('error' in result) {
        setMessage({ type: 'error', text: result.error || 'Failed to delete proxies' });
      } else {
        setMessage({ type: 'success', text: `Successfully deleted ${selectedProxies.length} proxies` });
        setSelectedProxies([]);
        startTransition(() => {
          onRefresh();
        });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to delete proxies' });
      console.error(err);
    }
  };

  const handleDeleteAll = async () => {
    const confirmMessage = 'Are you sure you want to DELETE ALL PROXIES? This action cannot be undone!';
    
    if (!confirm(confirmMessage)) return;

    // Double confirmation for safety
    const doubleConfirm = prompt('Type "DELETE ALL" to confirm you want to delete all proxies:');
    if (doubleConfirm !== 'DELETE ALL') {
      setMessage({ type: 'error', text: 'Deletion cancelled - confirmation text did not match' });
      return;
    }

    try {
      const result = await deleteAllProxies();

      if ('error' in result) {
        setMessage({ type: 'error', text: result.error || 'Failed to delete all proxies' });
      } else {
        setMessage({ type: 'success', text: `Successfully deleted all proxies (${result.deletedCount} removed)` });
        setSelectedProxies([]);
        startTransition(() => {
          onRefresh();
        });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to delete all proxies' });
      console.error(err);
    }
  };

  const resetBulkImport = () => {
    setBulkProxiesText('');
    setBulkImportResult(null);
    setBulkValidationErrors([]);
    setValidProxies([]);
    setBulkImportStep('input');
    setBulkImportLoading(false);
    setReplaceExisting(false);
    setImportProgress({ processed: 0, total: 0, startTime: 0 });
  };

  const closeBulkModal = () => {
    setShowBulkModal(false);
    resetBulkImport();
  };

  return (
    <>
      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors"
          disabled={isPending}
        >
          <Plus className="w-4 h-4" />
          Add Single Proxy
        </button>

        <button
          onClick={() => setShowBulkModal(true)}
          className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors"
          disabled={isPending}
        >
          <Upload className="w-4 h-4" />
          Bulk Import
        </button>

        {selectedProxies.length > 0 && (
          <button
            onClick={handleBulkDelete}
            className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors"
            disabled={isPending}
          >
            <Trash2 className="w-4 h-4" />
            Delete Selected ({selectedProxies.length})
          </button>
        )}

        <button
          onClick={handleDeleteAll}
          className="inline-flex items-center gap-2 bg-red-800 hover:bg-red-900 text-white px-4 py-2.5 rounded-lg font-medium transition-colors border-2 border-red-600"
          disabled={isPending}
        >
          <Trash2 className="w-4 h-4" />
          Delete All Proxies
        </button>

        <button
          onClick={onRefresh}
          className="inline-flex items-center gap-2 bg-slate-600 hover:bg-slate-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors"
          disabled={isPending}
        >
          <RefreshCw className={`w-4 h-4 ${isPending ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Messages */}
      {message && (
        <div className={`${message.type === 'error'
          ? 'bg-red-50 border border-red-200 text-red-700'
          : 'bg-emerald-50 border border-emerald-200 text-emerald-700'
          } rounded-xl p-4 flex items-start gap-3`}>
          {message.type === 'error' ? (
            <XCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" />
          )}
          <div className="flex-1">
            <p className="font-medium">{message.type === 'error' ? 'Error' : 'Success'}</p>
            <p className="text-sm mt-1">{message.text}</p>
          </div>
          <button onClick={() => setMessage(null)} className="hover:opacity-70">
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Add Single Proxy Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-xl w-full max-w-md shadow-2xl">
            <h2 className="text-xl font-bold mb-4">Add New Proxy</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Raw Proxy String</label>
                <p className="text-sm text-gray-500 mb-1">Format: ip:port:username:password</p>
                <input
                  type="text"
                  placeholder="139.171.128.91:5091:V6t6WYtx0m:pDdstBA9NM"
                  value={newProxyData.raw_proxy_string || ''}
                  onChange={(e) => setNewProxyData(prev => ({ ...prev, raw_proxy_string: e.target.value }))}
                  className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Provider</label>
                  <input
                    type="text"
                    value={newProxyData.provider || ''}
                    onChange={(e) => setNewProxyData(prev => ({ ...prev, provider: e.target.value }))}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Region</label>
                  <input
                    type="text"
                    value={newProxyData.region || ''}
                    onChange={(e) => setNewProxyData(prev => ({ ...prev, region: e.target.value }))}
                    className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>
              </div>
            </div>

            <div className="mt-6 flex gap-2">
              <button
                onClick={handleCreateProxy}
                disabled={!newProxyData.raw_proxy_string}
                className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                Add Proxy
              </button>
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 bg-gray-600 text-white py-2 px-4 rounded-md hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Import Modal */}
      {showBulkModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Bulk Import Proxies</h2>
                <p className="text-slate-600 text-xs">Format: ip:port:username:password</p>
              </div>
              <button
                onClick={closeBulkModal}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                disabled={bulkImportLoading}
              >
                <XCircle className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto max-h-[calc(85vh-120px)]">
              {/* Step 1: Input */}
              {bulkImportStep === 'input' && (
                <div className="space-y-4">
                  {/* Replace Option */}
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={replaceExisting}
                        onChange={(e) => setReplaceExisting(e.target.checked)}
                        className="w-4 h-4 text-orange-600"
                      />
                      <span className="font-medium text-orange-900 text-sm">Replace all existing proxies</span>
                    </label>
                    <p className="text-orange-700 text-xs mt-1">
                      {replaceExisting ? "⚠️ Will delete all current proxies" : "Will add alongside existing"}
                    </p>
                  </div>

                  {/* Input */}
                  <div>
                    <textarea
                      value={bulkProxiesText}
                      onChange={(e) => handleBulkImportTextChange(e.target.value)}
                      placeholder="139.171.128.91:5091:username:password&#10;192.168.1.1:8080:user:pass"
                      className="w-full h-48 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                      autoFocus
                    />
                    <div className="flex justify-between text-xs text-slate-600 mt-1">
                      <span>{bulkProxiesText.split('\n').filter(line => line.trim()).length} lines</span>
                      <span className="text-blue-600">Ready for server validation</span>
                    </div>
                  </div>

                  {/* Optional Fields */}
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="Provider (optional)"
                      value={newProxyData.provider || ''}
                      onChange={(e) => setNewProxyData(prev => ({ ...prev, provider: e.target.value }))}
                      className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                    />
                    <input
                      type="text"
                      placeholder="Region (optional)"
                      value={newProxyData.region || ''}
                      onChange={(e) => setNewProxyData(prev => ({ ...prev, region: e.target.value }))}
                      className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Ready indicator */}
                  {bulkProxiesText.trim() && (
                    <div className="space-y-2">
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <div className="flex items-center gap-2 text-blue-800">
                          <CheckCircle2 className="w-4 h-4" />
                          <span className="text-sm font-medium">{bulkProxiesText.split('\n').filter(line => line.trim()).length} lines ready for import</span>
                        </div>
                        <div className="text-xs text-blue-700 mt-1">
                          Server will validate and format proxies during import
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Step 2: Preview */}
              {bulkImportStep === 'preview' && (
                <div className="space-y-4">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <h3 className="font-medium text-blue-900 text-sm">Ready to import {bulkProxiesText.split('\n').filter(line => line.trim()).length} lines</h3>
                    {replaceExisting && <p className="text-orange-700 text-xs mt-1">⚠️ Will replace all existing proxies</p>}
                    <p className="text-blue-700 text-xs mt-1">Server will validate and format during import</p>
                  </div>

                  <div className="border border-slate-200 rounded-lg max-h-60 overflow-y-auto">
                    <div className="bg-slate-50 px-3 py-2 border-b border-slate-200">
                      <h4 className="font-medium text-slate-900 text-sm">Raw Proxy Lines ({bulkProxiesText.split('\n').filter(line => line.trim()).length})</h4>
                    </div>
                    <div className="p-3 space-y-2">
                      {bulkProxiesText.split('\n').filter(line => line.trim()).map((line, i) => (
                        <div key={i} className="flex items-center gap-2 p-2 bg-slate-50 rounded text-xs font-mono">
                          <span className="w-5 h-5 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">
                            {i + 1}
                          </span>
                          <span className="flex-1 truncate">{line}</span>
                          <CheckCircle2 className="w-3 h-3 text-blue-500" />
                        </div>
                      )).slice(0, 50)}
                      {bulkProxiesText.split('\n').filter(line => line.trim()).length > 50 && (
                        <div className="text-xs text-slate-500 text-center py-2">
                          ... and {bulkProxiesText.split('\n').filter(line => line.trim()).length - 50} more lines
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Progress */}
              {bulkImportStep === 'progress' && (
                <div className="space-y-4">
                  <div className="text-center py-4">
                    <h3 className="font-semibold text-slate-900 text-lg mb-2">
                      {replaceExisting ? 'Replacing Proxies' : 'Importing Proxies'}
                    </h3>
                    <p className="text-slate-600 text-sm mb-6">
                      Processing {importProgress.processed} of {importProgress.total} proxies...
                    </p>
                    
                    {/* Progress Bar */}
                    <div className="w-full bg-gray-200 rounded-full h-3 mb-4">
                      <div 
                        className="bg-blue-500 h-3 rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${(importProgress.processed / importProgress.total) * 100}%` }}
                      ></div>
                    </div>
                    
                    <div className="flex justify-between text-sm text-slate-600">
                      <span>{Math.round((importProgress.processed / importProgress.total) * 100)}% complete</span>
                      <span>
                        {importProgress.processed > 0 && (() => {
                          const elapsed = Date.now() - importProgress.startTime;
                          const rate = importProgress.processed / elapsed * 1000; // per second
                          const remaining = importProgress.total - importProgress.processed;
                          const estimatedSeconds = Math.ceil(remaining / rate);
                          return `~${estimatedSeconds}s remaining`;
                        })()}
                      </span>
                    </div>
                  </div>

                  {/* Real-time stats */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                      <p className="text-blue-600 text-sm font-medium">Processing</p>
                      <p className="text-blue-900 text-lg font-bold">{importProgress.processed}</p>
                    </div>
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-center">
                      <p className="text-gray-600 text-sm font-medium">Remaining</p>
                      <p className="text-gray-900 text-lg font-bold">{importProgress.total - importProgress.processed}</p>
                    </div>
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                      <p className="text-green-600 text-sm font-medium">Rate</p>
                      <p className="text-green-900 text-lg font-bold">
                        {importProgress.processed > 0 ? 
                          Math.round(importProgress.processed / ((Date.now() - importProgress.startTime) / 1000)) : 0}/s
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 4: Results */}
              {bulkImportStep === 'results' && (
                <div className="space-y-4">
                  {bulkImportLoading ? (
                    <div className="text-center py-8">
                      <div className="relative mx-auto w-12 h-12 mb-4">
                        <div className="animate-spin h-12 w-12 border-3 border-blue-500 border-t-transparent rounded-full"></div>
                        <Upload className="absolute inset-0 w-5 h-5 m-auto text-blue-600" />
                      </div>
                      <h3 className="font-semibold text-slate-900">{replaceExisting ? 'Replacing' : 'Importing'} Proxies</h3>
                      <p className="text-slate-600 text-sm">Please wait...</p>
                    </div>
                  ) : bulkImportResult && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                          </div>
                          <div>
                            <h3 className="text-xl font-bold text-emerald-900">{bulkImportResult.success}</h3>
                            <p className="text-emerald-700 text-xs font-medium">Imported</p>
                          </div>
                        </div>
                      </div>

                      <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
                            <XCircle className="w-5 h-5 text-red-600" />
                          </div>
                          <div>
                            <h3 className="text-xl font-bold text-red-900">{bulkImportResult.failed}</h3>
                            <p className="text-red-700 text-xs font-medium">Failed</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-slate-200 px-4 py-3 bg-slate-50">
              <div className="flex items-center justify-between">
                {/* Progress */}
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4].map((step) => (
                    <div key={step} className="flex items-center">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        (step === 1 && bulkImportStep === 'input') || 
                        (step === 2 && bulkImportStep === 'preview') || 
                        (step === 3 && bulkImportStep === 'progress') ||
                        (step === 4 && bulkImportStep === 'results')
                          ? 'bg-blue-600 text-white' 
                          : step < (['input', 'preview', 'progress', 'results'].indexOf(bulkImportStep) + 1)
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-300 text-slate-600'
                      }`}>
                        {step}
                      </div>
                      {step < 4 && (
                        <div className={`w-4 h-0.5 ${
                          step < (['input', 'preview', 'progress', 'results'].indexOf(bulkImportStep) + 1) ? 'bg-emerald-600' : 'bg-slate-300'
                        }`} />
                      )}
                    </div>
                  ))}
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  {bulkImportStep === 'input' && (
                    <>
                      <button onClick={closeBulkModal} className="px-3 py-2 text-slate-600 hover:text-slate-800 text-sm font-medium">
                        Cancel
                      </button>
                      <button
                        onClick={handleBulkImportPreview}
                        disabled={!bulkProxiesText.trim()}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
                      >
                        Preview ({bulkProxiesText.split('\n').filter(line => line.trim()).length} lines)
                      </button>
                    </>
                  )}

                  {bulkImportStep === 'preview' && (
                    <>
                      <button
                        onClick={() => setBulkImportStep('input')}
                        className="px-3 py-2 text-slate-600 hover:text-slate-800 text-sm font-medium"
                      >
                        Back
                      </button>
                      <button
                        onClick={handleBulkImport}
                        className={`px-4 py-2 ${
                          replaceExisting ? 'bg-orange-600 hover:bg-orange-700' : 'bg-emerald-600 hover:bg-emerald-700'
                        } text-white text-sm font-medium rounded-lg flex items-center gap-2`}
                      >
                        <Upload className="w-3 h-3" />
                        {replaceExisting ? 'Replace' : 'Import'} {bulkProxiesText.split('\n').filter(line => line.trim()).length} lines
                      </button>
                    </>
                  )}

                  {bulkImportStep === 'progress' && (
                    <div className="flex gap-2">
                      <button
                        disabled
                        className="px-4 py-2 bg-gray-400 text-white text-sm font-medium rounded-lg cursor-not-allowed opacity-50"
                      >
                        Processing...
                      </button>
                    </div>
                  )}

                  {bulkImportStep === 'results' && !bulkImportLoading && (
                    <>
                      <button
                        onClick={resetBulkImport}
                        className="px-3 py-2 text-slate-600 hover:text-slate-800 text-sm font-medium"
                      >
                        Import More
                      </button>
                      <button
                        onClick={closeBulkModal}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg"
                      >
                        Done
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function ProxyTable({
  proxies,
  onRefresh
}: {
  proxies: Proxy[],
  onRefresh: () => void
}) {
  const [selectedProxies, setSelectedProxies] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 100;

  // Calculate pagination
  const totalPages = Math.ceil(proxies.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentProxies = proxies.slice(startIndex, endIndex);

  // Reset to first page when proxies change
  React.useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(1);
    }
  }, [proxies.length, currentPage, totalPages]);

  const handleSelectProxy = (proxyId: string) => {
    setSelectedProxies(prev =>
      prev.includes(proxyId)
        ? prev.filter(id => id !== proxyId)
        : [...prev, proxyId]
    );
  };

  const handleSelectAll = () => {
    setSelectedProxies(prev =>
      prev.length === currentProxies.length ? [] : currentProxies.map(p => p.proxy_id)
    );
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    setSelectedProxies([]); // Clear selection when changing pages
  };

  // Return only the table rows since parent handles table structure
  if (currentProxies.length === 0) {
    return (
      <tr>
        <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
          <div className="flex flex-col items-center gap-3">
            <Globe className="w-12 h-12 text-slate-300" />
            <div>
              <p className="text-sm font-medium">No proxies found</p>
              <p className="text-xs">Add some proxies to get started</p>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <>
      {currentProxies.map((proxy) => (
        <ProxyRow
          key={proxy.proxy_id}
          proxy={proxy}
          isSelected={selectedProxies.includes(proxy.proxy_id)}
          onSelect={handleSelectProxy}
          onRefresh={onRefresh}
        />
      ))}
    </>
  );
}

export function ProxyTableWithControls({
  proxies,
  onRefresh
}: {
  proxies: Proxy[],
  onRefresh: () => void
}) {
  const [selectedProxies, setSelectedProxies] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 100;

  // Calculate pagination
  const totalPages = Math.ceil(proxies.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentProxies = proxies.slice(startIndex, endIndex);

  // Reset to first page when proxies change
  React.useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(1);
    }
  }, [proxies.length, currentPage, totalPages]);

  const handleSelectProxy = (proxyId: string) => {
    setSelectedProxies(prev =>
      prev.includes(proxyId)
        ? prev.filter(id => id !== proxyId)
        : [...prev, proxyId]
    );
  };

  const handleSelectAll = () => {
    setSelectedProxies(prev =>
      prev.length === currentProxies.length ? [] : currentProxies.map(p => p.proxy_id)
    );
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    setSelectedProxies([]); // Clear selection when changing pages
  };

  return (
    <div className="space-y-4">
      {/* Selection and Pagination Info */}
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={currentProxies.length > 0 && selectedProxies.length === currentProxies.length}
            onChange={handleSelectAll}
            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          {currentProxies.length === 0 ? 'No items to select' : 
           selectedProxies.length === 0 ? `Select All (${currentProxies.length} items)` :
           selectedProxies.length === currentProxies.length ? `All Selected (${selectedProxies.length})` :
           `Select All (${selectedProxies.length} of ${currentProxies.length} selected)`}
        </label>
        {selectedProxies.length > 0 && (
          <button
            onClick={async () => {
              if (confirm(`Are you sure you want to delete ${selectedProxies.length} proxies?`)) {
                await bulkDeleteProxies(selectedProxies);
                setSelectedProxies([]);
                onRefresh();
              }
            }}
            className="text-sm text-red-600 hover:text-red-700 font-medium"
          >
            Delete Selected
          </button>
        )}
        
        {/* Pagination Info */}
        <div className="ml-auto text-sm text-slate-600">
          Showing {startIndex + 1}-{Math.min(endIndex, proxies.length)} of {proxies.length} proxies
        </div>
      </div>
      
      {/* Table */}
      <div className="w-full bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full table-auto">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3 text-left w-16">
                  <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Select</span>
                </th>
                <th className="px-6 py-3 text-left min-w-[300px]">
                  <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Proxy Details</span>
                </th>
                <th className="px-6 py-3 text-left w-32">
                  <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Status</span>
                </th>
                <th className="px-6 py-3 text-left w-40">
                  <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Performance</span>
                </th>
                <th className="px-6 py-3 text-left w-24">
                  <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {currentProxies.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                    <div className="flex flex-col items-center gap-3">
                      <Globe className="w-12 h-12 text-slate-300" />
                      <div>
                        <p className="text-sm font-medium">No proxies found</p>
                        <p className="text-xs">Add some proxies to get started</p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                currentProxies.map((proxy) => (
                  <ProxyRow
                    key={proxy.proxy_id}
                    proxy={proxy}
                    isSelected={selectedProxies.includes(proxy.proxy_id)}
                    onSelect={handleSelectProxy}
                    onRefresh={onRefresh}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-200 pt-4">
          <div className="text-sm text-slate-600">
            Page {currentPage} of {totalPages}
          </div>
          
          <div className="flex items-center gap-2">
            {/* Previous Button */}
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>

            {/* Page Numbers */}
            <div className="flex gap-1">
              {/* First Page */}
              {currentPage > 3 && (
                <>
                  <button
                    onClick={() => handlePageChange(1)}
                    className="w-10 h-10 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                  >
                    1
                  </button>
                  {currentPage > 4 && <span className="px-2 py-2 text-slate-400">...</span>}
                </>
              )}

              {/* Current Page and Neighbors */}
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }

                if (pageNum < 1 || pageNum > totalPages) return null;

                return (
                  <button
                    key={pageNum}
                    onClick={() => handlePageChange(pageNum)}
                    className={`w-10 h-10 text-sm font-medium rounded-lg transition-colors ${
                      pageNum === currentPage
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-600 bg-white border border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}

              {/* Last Page */}
              {currentPage < totalPages - 2 && (
                <>
                  {currentPage < totalPages - 3 && <span className="px-2 py-2 text-slate-400">...</span>}
                  <button
                    onClick={() => handlePageChange(totalPages)}
                    className="w-10 h-10 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                  >
                    {totalPages}
                  </button>
                </>
              )}
            </div>

            {/* Next Button */}
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ProxyRow({
  proxy,
  isSelected,
  onSelect,
  onRefresh
}: {
  proxy: Proxy,
  isSelected: boolean,
  onSelect: (id: string) => void,
  onRefresh: () => void
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this proxy?')) return;

    try {
      const result = await deleteProxy(proxy.proxy_id);

      if ('error' in result) {
        setMessage(result.error || 'Failed to delete proxy');
      } else {
        startTransition(() => {
          onRefresh();
        });
      }
    } catch (err) {
      setMessage('Failed to delete proxy');
      console.error(err);
    }
  };

  const handleTest = async () => {
    try {
      const result = await testProxy(proxy.proxy_id);

      if ('error' in result) {
        setMessage(`Test failed: ${result.error}`);
      } else {
        setMessage(`Test ${result.success ? 'passed' : 'failed'}: ${result.message}`);
        startTransition(() => {
          onRefresh();
        });
      }
    } catch (err) {
      setMessage('Failed to test proxy');
      console.error(err);
    }
  };

  return (
    <tr className={`transition-colors ${
      proxy.total_requests !== undefined && proxy.total_requests !== null 
        ? proxy.total_requests > 0 
          ? ((proxy.total_requests - (proxy.failed_requests || 0)) / proxy.total_requests) === 0
            ? 'bg-red-50 hover:bg-red-100 border-l-4 border-l-red-500' // 0% success - red
            : 'bg-green-50 hover:bg-green-100 border-l-4 border-l-green-400' // Has success - green
          : 'hover:bg-slate-50' // No requests - default
        : 'hover:bg-slate-50' // No data - default
    }`}>
      <td className="px-4 py-2">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onSelect(proxy.proxy_id)}
          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
        />
      </td>
      <td className="px-4 py-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <code className="text-xs font-mono text-slate-900 bg-slate-100 px-2 py-1 rounded">
              {proxy.ip}:{proxy.port}
            </code>
            <div className={`w-2 h-2 rounded-full ${proxy.is_working ? 'bg-green-500' : 'bg-red-500'
              }`} title={proxy.is_working ? 'Online' : 'Offline'}></div>
          </div>
          {(proxy.provider || proxy.region) && (
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <Globe className="h-3 w-3" />
              <span>{proxy.provider || 'Unknown Provider'}</span>
              {proxy.region && (
                <>
                  <span className="text-slate-400">•</span>
                  <span>{proxy.region}</span>
                </>
              )}
            </div>
          )}
        </div>
      </td>
      <td className="px-4 py-2">
        <div className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${proxy.status === 'active'
          ? 'bg-green-100 text-green-800 border border-green-200'
          : proxy.status === 'inactive'
            ? 'bg-red-100 text-red-800 border border-red-200'
            : 'bg-yellow-100 text-yellow-800 border border-yellow-200'
          }`}>
          <div className={`w-1.5 h-1.5 rounded-full mr-1.5 ${proxy.status === 'active' ? 'bg-green-500' :
            proxy.status === 'inactive' ? 'bg-red-500' : 'bg-yellow-500'
            }`}></div>
          {proxy.status}
        </div>
      </td>
      <td className="px-4 py-2">
        <div className="space-y-1">
          {proxy.total_requests !== undefined && proxy.total_requests !== null ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-900">
                  {proxy.total_requests > 0 ? 
                    (((proxy.total_requests - (proxy.failed_requests || 0)) / proxy.total_requests) * 100).toFixed(1)
                    : '0.0'
                  }% Success
                </span>
              </div>
              <div className="text-xs text-slate-500">
                <span>{proxy.total_requests.toLocaleString()} total requests</span>
                {proxy.failed_requests !== undefined && proxy.failed_requests > 0 && (
                  <span className="text-red-600 ml-2">
                    ({proxy.failed_requests.toLocaleString()} failed)
                  </span>
                )}
              </div>
            </>
          ) : (
            <span className="text-sm text-slate-400">No data</span>
          )}
        </div>
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-2 relative">
          <button
            onClick={handleTest}
            disabled={isPending}
            className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50"
            title="Test proxy"
          >
            <Activity className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleDelete}
            disabled={isPending}
            className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
            title="Delete proxy"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          {message && (
            <div className="absolute z-10 bg-white border border-slate-200 rounded-lg shadow-lg p-2 mt-1 text-xs top-full left-0 min-w-48">
              {message}
              <button onClick={() => setMessage(null)} className="ml-2 text-slate-400 hover:text-slate-600">×</button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}