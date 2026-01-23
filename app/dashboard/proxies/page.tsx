import React from 'react';
import {
  getAllProxies,
  getProxyStats,
} from '@/actions/proxyActions';
import {
  Search,
  Database,
  CheckCircle2,
  Activity,
  TrendingUp,
  Globe,
  RefreshCw
} from 'lucide-react';
import { BulkActions, ProxyRow, ProxyTable } from './ProxyClientComponents';
import { revalidatePath } from 'next/cache';

// Force dynamic rendering to ensure fresh data
export const dynamic = 'force-dynamic';

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

interface ProxyStats {
  total: number;
  active: number;
  working: number;
  avgSuccessRate: number;
  totalRequests: number;
  totalFailures: number;
  statusBreakdown: Record<string, number>;
}

async function refreshProxies() {
  'use server';
  revalidatePath('/dashboard/proxies');
}

export default async function ProxyManagement({
  searchParams
}: {
  searchParams: Promise<{ search?: string; status?: string; provider?: string }>
}) {
  // Await searchParams to resolve the Promise
  const params = await searchParams;

  // Load data on server
  const [proxiesResult, statsResult] = await Promise.all([
    getAllProxies(50, 0, {}),
    getProxyStats()
  ]);

  let proxies: Proxy[] = [];
  let stats: ProxyStats | null = null;
  let error: string | null = null;

  if ('error' in proxiesResult) {
    error = proxiesResult.error || 'Failed to load proxies';
  } else {
    proxies = proxiesResult.proxies as Proxy[];
  }

  if (!('error' in statsResult)) {
    // Handle both old and new stat structures
    const statsData = statsResult.general ? {
      total: statsResult.general.total,
      active: statsResult.general.active,
      working: statsResult.general.working,
      avgSuccessRate: statsResult.general.avgSuccessRate,
      totalRequests: statsResult.general.totalRequests,
      totalFailures: statsResult.general.totalFailures,
      statusBreakdown: statsResult.statusBreakdown
    } : statsResult;
    stats = statsData as ProxyStats;
  }

  // Apply filters on server-side
  let filteredProxies = proxies;
  if (params.search) {
    const searchTerm = params.search.toLowerCase();
    filteredProxies = filteredProxies.filter(proxy =>
      proxy.ip.toLowerCase().includes(searchTerm) ||
      proxy.server.toLowerCase().includes(searchTerm) ||
      (proxy.provider && proxy.provider.toLowerCase().includes(searchTerm)) ||
      (proxy.region && proxy.region.toLowerCase().includes(searchTerm))
    );
  }

  if (params.status) {
    filteredProxies = filteredProxies.filter(proxy => proxy.status === params.status);
  }

  if (params.provider) {
    filteredProxies = filteredProxies.filter(proxy => proxy.provider === params.provider);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-900 to-slate-600 bg-clip-text text-transparent">
              Proxy Management
            </h1>
            <p className="text-slate-600 mt-1">Manage and monitor your proxy infrastructure</p>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
            <div className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0">⚠️</div>
            <div className="flex-1">
              <h4 className="text-red-800 font-medium">Error</h4>
              <p className="text-red-700 text-sm mt-1">{error}</p>
            </div>
          </div>
        )}

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">Total Proxies</p>
                  <p className="text-2xl font-bold text-slate-900">{stats.total || 0}</p>
                </div>
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Database className="w-6 h-6 text-blue-600" />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">Active</p>
                  <p className="text-2xl font-bold text-emerald-600">{stats.active || 0}</p>
                </div>
                <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">Working</p>
                  <p className="text-2xl font-bold text-blue-600">{stats.working || 0}</p>
                </div>
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Activity className="w-6 h-6 text-blue-600" />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600">Success Rate</p>
                  <p className="text-2xl font-bold text-purple-600">{(stats.avgSuccessRate || 0).toFixed(1)}%</p>
                </div>
                <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                  <TrendingUp className="w-6 h-6 text-purple-600" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Actions Bar */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex flex-col lg:flex-row gap-4 justify-between">
            <BulkActions onRefresh={refreshProxies} />

            {/* Search */}
            <form className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input
                type="text"
                name="search"
                placeholder="Search proxies..."
                defaultValue={params.search || ''}
                className="pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm min-w-[250px] bg-white"
              />
            </form>
          </div>
        </div>

        {/* Proxies Table */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <h3 className="text-lg font-semibold text-slate-900">
              Proxies ({filteredProxies.length})
            </h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="w-12 px-6 py-3 text-left">
                    <input
                      type="checkbox"
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    // TODO: Add select all functionality
                    />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Proxy Details
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Performance
                  </th>
                  <th className="w-32 px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredProxies.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-16 text-center">
                      <div className="flex flex-col items-center gap-4">
                        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center">
                          <Database className="h-8 w-8 text-slate-400" />
                        </div>
                        <div className="space-y-2">
                          <h3 className="text-lg font-semibold text-slate-900">No proxies found</h3>
                          <p className="text-slate-500">
                            {params.search || params.status || params.provider
                              ? 'Try adjusting your filters or search terms'
                              : 'Add your first proxy to get started'
                            }
                          </p>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <ProxyTable proxies={filteredProxies} onRefresh={refreshProxies} />
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

