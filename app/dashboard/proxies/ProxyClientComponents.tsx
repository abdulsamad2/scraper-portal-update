'use client';

import React, { useState, useTransition } from 'react';
import {
  createProxy,
  updateProxy,
  deleteProxy,
  bulkDeleteProxies,
  bulkImportProxies,
  testProxy,
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
  const [bulkImportStep, setBulkImportStep] = useState<'input' | 'preview' | 'results'>('input');
  const [replaceExisting, setReplaceExisting] = useState(false);

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

  const handleBulkImportTextChange = (text: string) => {
    setBulkProxiesText(text);
    if (text.trim()) {
      validateBulkProxies(text);
    } else {
      setBulkValidationErrors([]);
      setValidProxies([]);
    }
  };

  const handleBulkImportPreview = () => {
    const { errors, valid } = validateBulkProxies(bulkProxiesText);

    if (errors.length === 0 && valid.length > 0) {
      setBulkImportStep('preview');
    } else if (valid.length === 0) {
      setMessage({ type: 'error', text: 'No valid proxies found. Please check your input format.' });
    }
  };

  const handleBulkImport = async () => {
    try {
      setBulkImportLoading(true);
      setBulkImportStep('results');

      const result = await bulkImportProxies(bulkProxiesText, {
        provider: newProxyData.provider,
        region: newProxyData.region,
        status: 'active'
      }, replaceExisting);

      setBulkImportResult(result);

      if (result.success > 0) {
        setMessage({
          type: 'success',
          text: `Successfully imported ${result.success} proxies${result.failed > 0 ? `, ${result.failed} failed` : ''}`
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

  const resetBulkImport = () => {
    setBulkProxiesText('');
    setBulkImportResult(null);
    setBulkValidationErrors([]);
    setValidProxies([]);
    setBulkImportStep('input');
    setBulkImportLoading(false);
    setReplaceExisting(false);
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
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Bulk Import Proxies</h2>
                <p className="text-slate-600 text-sm mt-1">
                  Import multiple proxies in format: ip:port:username:password (one per line)
                </p>
              </div>
              <button
                onClick={closeBulkModal}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                disabled={bulkImportLoading}
              >
                <XCircle className="w-6 h-6 text-slate-400" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
              {/* Step 1: Input */}
              {bulkImportStep === 'input' && (
                <div className="space-y-6">
                  {/* Replace Existing Option */}
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <input
                        type="checkbox"
                        id="replace-existing"
                        checked={replaceExisting}
                        onChange={(e) => setReplaceExisting(e.target.checked)}
                        className="w-4 h-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500"
                      />
                      <label htmlFor="replace-existing" className="font-semibold text-orange-900">
                        Replace All Existing Proxies
                      </label>
                    </div>
                    <p className="text-orange-800 text-sm">
                      {replaceExisting
                        ? "⚠️ This will delete all current proxies and replace them with the imported ones."
                        : "New proxies will be added alongside existing ones. Duplicates will be skipped."
                      }
                    </p>
                  </div>

                  {/* Instructions */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h3 className="font-semibold text-blue-900 mb-2">Import Instructions</h3>
                    <ul className="text-blue-800 text-sm space-y-1">
                      <li>• One proxy per line</li>
                      <li>• Format: ip:port:username:password</li>
                      <li>• Example: 139.171.128.91:5091:V6t6WYtx0m:pDdstBA9NM</li>
                      <li>• Duplicate proxies will be skipped</li>
                    </ul>
                  </div>

                  {/* Input Area */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Proxy List
                    </label>
                    <textarea
                      value={bulkProxiesText}
                      onChange={(e) => handleBulkImportTextChange(e.target.value)}
                      placeholder="139.171.128.91:5091:V6t6WYtx0m:pDdstBA9NM&#10;192.168.1.1:8080:user:pass&#10;203.0.113.1:3128:admin:secret"
                      className="w-full h-64 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                      style={{ lineHeight: '1.5' }}
                      autoFocus
                    />
                    <div className="flex justify-between items-center mt-2 text-sm text-slate-600">
                      <span>
                        {bulkProxiesText.split('\n').filter(line => line.trim()).length} lines entered
                      </span>
                      <span>
                        {validProxies.length} valid proxies detected
                      </span>
                    </div>
                  </div>

                  {/* Default Values */}
                  <div className="bg-slate-50 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-slate-900 mb-3">Default Values (Optional)</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Provider</label>
                        <input
                          type="text"
                          placeholder="e.g., ProxyProvider"
                          value={newProxyData.provider || ''}
                          onChange={(e) => setNewProxyData(prev => ({ ...prev, provider: e.target.value }))}
                          className="block w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          disabled={bulkImportLoading}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Region</label>
                        <input
                          type="text"
                          placeholder="e.g., US-East"
                          value={newProxyData.region || ''}
                          onChange={(e) => setNewProxyData(prev => ({ ...prev, region: e.target.value }))}
                          className="block w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          disabled={bulkImportLoading}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Validation Results */}
                  {bulkProxiesText.trim() && (
                    <div className="space-y-3">
                      {validProxies.length > 0 && (
                        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                            <span className="font-semibold text-emerald-900">
                              {validProxies.length} Valid Proxies
                            </span>
                          </div>
                          <div className="max-h-32 overflow-y-auto">
                            <div className="grid gap-1 text-sm text-emerald-800 font-mono">
                              {validProxies.slice(0, 5).map((proxy, index) => (
                                <div key={index} className="truncate">
                                  {proxy}
                                </div>
                              ))}
                              {validProxies.length > 5 && (
                                <div className="text-emerald-600 font-normal">
                                  ... and {validProxies.length - 5} more
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {bulkValidationErrors.length > 0 && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <AlertTriangle className="w-5 h-5 text-red-600" />
                            <span className="font-semibold text-red-900">
                              {bulkValidationErrors.length} Validation Errors
                            </span>
                          </div>
                          <div className="max-h-32 overflow-y-auto">
                            <div className="space-y-1 text-sm text-red-800">
                              {bulkValidationErrors.slice(0, 5).map((error, index) => (
                                <div key={index}>{error}</div>
                              ))}
                              {bulkValidationErrors.length > 5 && (
                                <div className="text-red-600 font-medium">
                                  ... and {bulkValidationErrors.length - 5} more errors
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Other steps remain the same as original implementation */}
              {bulkImportStep === 'preview' && (
                <div className="space-y-6">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h3 className="font-semibold text-blue-900 mb-2">Import Preview</h3>
                    <p className="text-blue-800 text-sm">
                      Ready to import {validProxies.length} proxies.
                      {replaceExisting && <span className="text-orange-800 font-medium"> This will replace ALL existing proxies.</span>}
                    </p>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-lg">
                    <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
                      <h4 className="font-semibold text-slate-900">
                        Proxies to Import ({validProxies.length})
                      </h4>
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                      <div className="p-4 space-y-2">
                        {validProxies.map((proxy, index) => (
                          <div
                            key={index}
                            className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg text-sm font-mono"
                          >
                            <div className="w-6 h-6 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-xs font-semibold">
                              {index + 1}
                            </div>
                            <span className="flex-1">{proxy}</span>
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Results step similar to original */}
              {bulkImportStep === 'results' && (
                <div className="space-y-6">
                  {bulkImportLoading ? (
                    <div className="text-center py-12">
                      <div className="relative">
                        <div className="animate-spin h-16 w-16 border-4 border-blue-500 border-t-transparent rounded-full mx-auto"></div>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Upload className="w-6 h-6 text-blue-600" />
                        </div>
                      </div>
                      <h3 className="text-lg font-semibold text-slate-900 mt-4">
                        {replaceExisting ? 'Replacing All Proxies' : 'Importing Proxies'}
                      </h3>
                      <p className="text-slate-600">Please wait while we process your proxies...</p>
                    </div>
                  ) : bulkImportResult && (
                    <div className="space-y-4">
                      {/* Summary Cards */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center">
                              <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                            </div>
                            <div>
                              <h3 className="text-2xl font-bold text-emerald-900">
                                {bulkImportResult.success}
                              </h3>
                              <p className="text-emerald-700 font-medium">Successfully Imported</p>
                            </div>
                          </div>
                        </div>

                        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                              <XCircle className="w-6 h-6 text-red-600" />
                            </div>
                            <div>
                              <h3 className="text-2xl font-bold text-red-900">
                                {bulkImportResult.failed}
                              </h3>
                              <p className="text-red-700 font-medium">Failed to Import</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="border-t border-slate-200 px-6 py-4 bg-slate-50">
              <div className="flex items-center justify-between">
                {/* Step Indicator */}
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${bulkImportStep === 'input' ? 'bg-blue-600 text-white' :
                    bulkImportStep === 'preview' || bulkImportStep === 'results' ? 'bg-emerald-600 text-white' : 'bg-slate-300 text-slate-600'
                    }`}>
                    1
                  </div>
                  <div className={`w-6 h-0.5 ${bulkImportStep === 'preview' || bulkImportStep === 'results' ? 'bg-emerald-600' : 'bg-slate-300'}`} />
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${bulkImportStep === 'preview' ? 'bg-blue-600 text-white' :
                    bulkImportStep === 'results' ? 'bg-emerald-600 text-white' : 'bg-slate-300 text-slate-600'
                    }`}>
                    2
                  </div>
                  <div className={`w-6 h-0.5 ${bulkImportStep === 'results' ? 'bg-emerald-600' : 'bg-slate-300'}`} />
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${bulkImportStep === 'results' ? 'bg-blue-600 text-white' : 'bg-slate-300 text-slate-600'
                    }`}>
                    3
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3">
                  {bulkImportStep === 'input' && (
                    <>
                      <button
                        onClick={closeBulkModal}
                        className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleBulkImportPreview}
                        disabled={validProxies.length === 0}
                        className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Preview Import ({validProxies.length})
                      </button>
                    </>
                  )}

                  {bulkImportStep === 'preview' && (
                    <>
                      <button
                        onClick={() => setBulkImportStep('input')}
                        className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium transition-colors"
                      >
                        Back to Edit
                      </button>
                      <button
                        onClick={handleBulkImport}
                        className={`px-6 py-2 ${replaceExisting
                          ? 'bg-orange-600 hover:bg-orange-700'
                          : 'bg-emerald-600 hover:bg-emerald-700'
                          } text-white font-medium rounded-lg transition-colors flex items-center gap-2`}
                      >
                        <Upload className="w-4 h-4" />
                        {replaceExisting ? 'Replace All' : 'Import'} {validProxies.length} Proxies
                      </button>
                    </>
                  )}

                  {bulkImportStep === 'results' && !bulkImportLoading && (
                    <>
                      <button
                        onClick={resetBulkImport}
                        className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium transition-colors"
                      >
                        Import More
                      </button>
                      <button
                        onClick={closeBulkModal}
                        className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
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

  const handleSelectProxy = (proxyId: string) => {
    setSelectedProxies(prev =>
      prev.includes(proxyId)
        ? prev.filter(id => id !== proxyId)
        : [...prev, proxyId]
    );
  };

  const handleSelectAll = () => {
    setSelectedProxies(prev =>
      prev.length === proxies.length ? [] : proxies.map(p => p.proxy_id)
    );
  };

  return (
    <>
      <div className="mb-4 flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={proxies.length > 0 && selectedProxies.length === proxies.length}
            onChange={handleSelectAll}
            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          Select All ({selectedProxies.length} selected)
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
      </div>
      {proxies.map((proxy) => (
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
    <tr className="hover:bg-slate-50 transition-colors">
      <td className="px-6 py-4">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onSelect(proxy.proxy_id)}
          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
        />
      </td>
      <td className="px-6 py-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <code className="text-sm font-mono text-slate-900 bg-slate-100 px-3 py-1 rounded-md">
              {proxy.ip}:{proxy.port}
            </code>
            <div className={`w-2 h-2 rounded-full ${proxy.is_working ? 'bg-green-500' : 'bg-red-500'
              }`} title={proxy.is_working ? 'Online' : 'Offline'}></div>
          </div>
          {(proxy.provider || proxy.region) && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
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
      <td className="px-6 py-4">
        <div className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${proxy.status === 'active'
          ? 'bg-green-100 text-green-800 border border-green-200'
          : proxy.status === 'inactive'
            ? 'bg-red-100 text-red-800 border border-red-200'
            : 'bg-yellow-100 text-yellow-800 border border-yellow-200'
          }`}>
          <div className={`w-1.5 h-1.5 rounded-full mr-2 ${proxy.status === 'active' ? 'bg-green-500' :
            proxy.status === 'inactive' ? 'bg-red-500' : 'bg-yellow-500'
            }`}></div>
          {proxy.status}
        </div>
      </td>
      <td className="px-6 py-4">
        <div className="space-y-2">
          {proxy.success_rate !== undefined ? (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-900">
                {proxy.success_rate.toFixed(1)}% Success
              </span>
            </div>
          ) : (
            <span className="text-sm text-slate-400">No data</span>
          )}
          {proxy.total_requests !== undefined && (
            <div className="text-xs text-slate-500">
              {proxy.total_requests.toLocaleString()} total requests
            </div>
          )}
        </div>
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center gap-2">
          <button
            onClick={handleTest}
            disabled={isPending}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50"
            title="Test proxy"
          >
            <Activity className="h-4 w-4" />
          </button>
          <button
            onClick={handleDelete}
            disabled={isPending}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
            title="Delete proxy"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        {message && (
          <div className="absolute z-10 bg-white border border-slate-200 rounded-lg shadow-lg p-2 mt-1 text-xs">
            {message}
            <button onClick={() => setMessage(null)} className="ml-2 text-slate-400 hover:text-slate-600">×</button>
          </div>
        )}
      </td>
    </tr>
  );
}