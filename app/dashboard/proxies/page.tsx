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
import { BulkActions, ProxyRow, ProxyTableWithControls } from './ProxyClientComponents';
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

  // Load data on server - fetch all proxies instead of limiting to 50
  const [proxiesResult, statsResult] = await Promise.all([
    getAllProxies(10000, 0, {}), // Fetch up to 10k proxies to show all data
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
    <div className="space-y-6">
      {/* Header */}
      <header>
        <h1 className="text-2xl font-bold flex items-center gap-2" style={{ textWrap: 'balance' }}>
          <Globe className="w-6 h-6" aria-hidden="true" />
          Proxy Management
        </h1>
        <p className="text-slate-600 mt-2">Manage and monitor your proxy infrastructure</p>
      </header>

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
        <section aria-labelledby="proxy-stats">
          <h2 id="proxy-stats" className="sr-only">Proxy Statistics</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-white shadow-sm rounded-lg p-4 flex items-center gap-4 hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Database className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium">Total Proxies</p>
                <p className="text-2xl font-bold text-blue-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {new Intl.NumberFormat('en-US').format(stats.total || 0)}
                </p>
              </div>
            </div>

            <div className="bg-white shadow-sm rounded-lg p-4 flex items-center gap-4 hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium">Active</p>
                <p className="text-2xl font-bold text-emerald-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {new Intl.NumberFormat('en-US').format(stats.active || 0)}
                </p>
              </div>
            </div>

            <div className="bg-white shadow-sm rounded-lg p-4 flex items-center gap-4 hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Activity className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium">Working</p>
                <p className="text-2xl font-bold text-blue-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {new Intl.NumberFormat('en-US').format(stats.working || 0)}
                </p>
              </div>
            </div>

            <div className="bg-white shadow-sm rounded-lg p-4 flex items-center gap-4 hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <RefreshCw className="w-6 h-6 text-orange-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium">Total Requests</p>
                <p className="text-2xl font-bold text-orange-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {new Intl.NumberFormat('en-US').format(stats.totalRequests || 0)}
                </p>
              </div>
            </div>

            <div className="bg-white shadow-sm rounded-lg p-4 flex items-center gap-4 hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <TrendingUp className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium">Success Rate</p>
                <p className="text-2xl font-bold text-purple-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {stats.totalRequests && stats.totalRequests > 0 ? 
                    (((stats.totalRequests - (stats.totalFailures || 0)) / stats.totalRequests) * 100).toFixed(1) 
                    : '0.0'}%
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Actions and Search */}
      <section className="flex flex-col lg:flex-row lg:justify-between items-start lg:items-center gap-4">
        <div>
          <BulkActions onRefresh={refreshProxies} />
        </div>
        
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input
            type="text"
            name="search"
            placeholder="Search proxies..."
            defaultValue={params.search || ''}
            className="pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm min-w-[250px] bg-white"
          />
        </div>
      </section>

      {/* Proxy Table */}
      <ProxyTableWithControls proxies={filteredProxies} onRefresh={refreshProxies} />
    </div>
  );
}

