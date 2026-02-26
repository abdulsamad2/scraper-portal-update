'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  RefreshCw, Search, ChevronLeft, ChevronRight,
  Loader2, X, Bell, ExternalLink, MapPin,
  AlertTriangle, Filter, ShoppingCart,
  ChevronDown, AlertCircle, Smartphone, Mail,
  Truck, Send, CheckCircle, RotateCw,
  FileText, Clock, XCircle, Package, Ticket,
  Flag, FlagOff, MessageSquareWarning,
} from 'lucide-react';
import { getPaginatedOrders, getOrderTabCounts } from '@/actions/orderActions';
import { useOrderAlert } from './useOrderAlert';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface OrderData {
  _id: string; sync_id?: number; order_id: string; external_id?: string;
  event_name: string; venue: string; city: string; state: string; country: string;
  occurs_at: string; section: string; row: string;
  low_seat: number | null; high_seat: number | null; quantity: number;
  status: string; delivery: string; marketplace: string;
  total: number; unit_price: number; order_date: string;
  transfer_count: number; pos_event_id: string; pos_inventory_id: string;
  acknowledged: boolean; acknowledgedAt: string | null;
  portalEventId: string | null; ticketmasterUrl: string | null;
  hasIssue?: boolean; issueNote?: string; issueFlaggedAt?: string | null;
}

interface SyncResult {
  synced?: number; newOrderIds?: string[];
  newOrders?: { order_id: string; ticketmasterUrl: string; event_name: string }[];
  unacknowledgedCount?: number; error?: string;
}

interface TabCounts {
  invoiced: number; confirmed: number; rejected: number;
  deliveryIssue: number; delivered: number; all: number; flagged: number;
}

interface OrdersClientProps {
  initialOrders: OrderData[];
  initialTabCounts: TabCounts;
  initialUnackCount: number;
}

const ST: Record<string, { bg: string; text: string; dot: string; label: string; icon: typeof FileText }> = {
  invoiced:         { bg: 'bg-blue-50',   text: 'text-blue-700',   dot: 'bg-blue-500',   label: 'Invoiced',          icon: FileText },
  pending:          { bg: 'bg-blue-50',   text: 'text-blue-700',   dot: 'bg-blue-500',   label: 'Pending',           icon: Clock },
  problem:          { bg: 'bg-blue-50',   text: 'text-blue-700',   dot: 'bg-blue-500',   label: 'Problem',           icon: AlertTriangle },
  rejected:         { bg: 'bg-red-50',    text: 'text-red-700',    dot: 'bg-red-500',    label: 'Rejected',          icon: XCircle },
  confirmed:        { bg: 'bg-amber-50',  text: 'text-amber-700',  dot: 'bg-amber-500',  label: 'Confirmed',         icon: CheckCircle },
  confirmed_delay:  { bg: 'bg-amber-50',  text: 'text-amber-700',  dot: 'bg-amber-500',  label: 'Confirmed (Delay)', icon: Clock },
  delivered:        { bg: 'bg-green-50',  text: 'text-green-700',  dot: 'bg-green-500',  label: 'Delivered',         icon: Package },
  delivery_problem: { bg: 'bg-red-50',    text: 'text-red-700',    dot: 'bg-red-500',    label: 'Delivery Issue',    icon: AlertTriangle },
};

const MP: Record<string, { label: string; abbr: string; bg: string; text: string }> = {
  stubhub:          { label: 'StubHub',           abbr: 'SH', bg: 'bg-[#3B1F8E]', text: 'text-white' },
  gotickets:        { label: 'GoTickets',      abbr: 'GO',  bg: 'bg-[#16A34A]', text: 'text-white' },
  vividseats:       { label: 'Vivid Seats',    abbr: 'VS',  bg: 'bg-[#E91E63]', text: 'text-white' },
  gametime:         { label: 'Gametime',       abbr: 'GT',  bg: 'bg-[#6B46C1]', text: 'text-white' },
  automatiq_b2b:    { label: 'Automatiq B2B',  abbr: 'AQ',  bg: 'bg-[#1E40AF]', text: 'text-white' },
  seatgeek:         { label: 'SeatGeek',       abbr: 'SG',  bg: 'bg-[#F56E28]', text: 'text-white' },
  ticketmaster:     { label: 'Ticketmaster',   abbr: 'TM',  bg: 'bg-[#026CDF]', text: 'text-white' },
  tickpick:         { label: 'TickPick',       abbr: 'TP',  bg: 'bg-[#0D9488]', text: 'text-white' },
  ticket_network_mp:{ label: 'Ticket Network', abbr: 'TN',  bg: 'bg-[#D97706]', text: 'text-white' },
  ticket_evo:       { label: 'Ticket Evo',     abbr: 'TE',  bg: 'bg-[#E11D48]', text: 'text-white' },
  axs:              { label: 'AXS',            abbr: 'AXS', bg: 'bg-[#4338CA]', text: 'text-white' },
  fanxchange:       { label: 'FanXchange',     abbr: 'FX',  bg: 'bg-[#0891B2]', text: 'text-white' },
};

const TAB_STATUSES: Record<string, string[]> = {
  invoiced:       ['invoiced', 'pending', 'problem'],
  confirmed:      ['confirmed', 'confirmed_delay'],
  rejected:       ['rejected'],
  delivery_issue: ['delivery_problem'],
  delivered:      ['delivered'],
  all:            [],
};

type TabKey = 'invoiced' | 'confirmed' | 'rejected' | 'delivery_issue' | 'delivered' | 'all';

function fmtDate(dt: string) {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtTime(dt: string) {
  if (!dt) return '';
  return new Date(dt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function DeliveryBadge({ delivery }: { delivery: string }) {
  const d = delivery?.toLowerCase() || '';
  let Icon = Truck;
  let bg = 'bg-gray-100 text-gray-600';
  let label = delivery || '—';
  if (d.includes('mobile') || d.includes('electronic') || d.includes('eticket')) {
    Icon = Smartphone; bg = 'bg-purple-50 text-purple-700'; label = 'Mobile';
  } else if (d.includes('mail') || d.includes('ship') || d.includes('fedex') || d.includes('ups')) {
    Icon = Mail; bg = 'bg-orange-50 text-orange-700'; label = 'Mail/Ship';
  } else if (d.includes('transfer')) {
    Icon = Send; bg = 'bg-cyan-50 text-cyan-700'; label = 'Transfer';
  } else if (d.includes('instant')) {
    Icon = Send; bg = 'bg-green-50 text-green-700'; label = 'Instant';
  }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${bg}`}>
      <Icon className="w-6 h-6 shrink-0" />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
export default function OrdersClient({ initialOrders, initialTabCounts, initialUnackCount }: OrdersClientProps) {
  const [orders, setOrders] = useState<OrderData[]>(initialOrders);
  const [page, setPage] = useState(1);
  const [syncing, setSyncing] = useState(false);
  const [unackCount, setUnackCount] = useState(initialUnackCount);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState('');

  const [activeTab, setActiveTab] = useState<TabKey>('invoiced');
  const [tabCounts, setTabCounts] = useState(initialTabCounts);

  const [search, setSearch] = useState('');
  const [mpFilter, setMpFilter] = useState('all');
  const [ackFilter, setAckFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);

  const newIdsRef = useRef<Set<string>>(new Set());
  const { startAlert, stopAlert } = useOrderAlert();
  const [countdown, setCountdown] = useState(30);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [localSearch, setLocalSearch] = useState('');

  // Confirm/Reject modal state
  const [modalOrder, setModalOrder] = useState<OrderData | null>(null);
  const [modalAction, setModalAction] = useState<'confirm' | 'reject' | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState('');
  const [recheckingId, setRecheckingId] = useState<string | null>(null);

  // Flag issue modal state
  const [flagOrder, setFlagOrder] = useState<OrderData | null>(null);
  const [flagNote, setFlagNote] = useState('');
  const [flagLoading, setFlagLoading] = useState(false);

  const perPage = 20;

  const fetchOrders = useCallback(async () => {
    try {
      const f: Record<string, unknown> = { marketplace: mpFilter, acknowledged: ackFilter, search: search.trim() };
      const statuses = TAB_STATUSES[activeTab];
      if (statuses && statuses.length > 0) f.statusIn = statuses;
      const [result, counts] = await Promise.all([
        getPaginatedOrders(1, 10000, f as any, 'order_date', 'desc'),
        getOrderTabCounts(),
      ]);
      setOrders(result.orders);
      setUnackCount(result.unacknowledgedCount);
      setTabCounts(counts);
    } catch (err) {
      console.error('Fetch error:', err);
    }
  }, [activeTab, mpFilter, ackFilter, search]);

  const syncOnly = useCallback(async () => {
    setSyncing(true);
    setSyncError('');
    try {
      const res = await fetch(`/api/orders/sync?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) { setSyncError(`HTTP ${res.status}`); return; }
      const data: SyncResult = await res.json();
      if (data.error) { setSyncError(data.error); return; }

      if (data.newOrderIds && data.newOrderIds.length > 0) {
        data.newOrderIds.forEach(id => newIdsRef.current.add(id));
        if (data.newOrders) {
          for (const o of data.newOrders) {
            if (o.ticketmasterUrl) window.open(o.ticketmasterUrl, '_blank');
          }
        }
        startAlert();
      }
      setLastSync(new Date());
    } catch { setSyncError('Network error'); }
    finally { setSyncing(false); }
    await fetchOrders();
  }, [fetchOrders, startAlert]);

  // Initial sync after mount (data already loaded server-side, just kick off first sync)
  useEffect(() => {
    const t = setTimeout(() => syncOnly(), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ring when there are unacknowledged orders, stop when all acknowledged
  useEffect(() => {
    if (unackCount > 0) startAlert();
    else { stopAlert(); newIdsRef.current.clear(); }
    return () => stopAlert();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unackCount]);

  // Polling
  useEffect(() => { const iv = setInterval(syncOnly, 30000); return () => clearInterval(iv); }, [syncOnly]);
  useEffect(() => { setCountdown(30); const iv = setInterval(() => setCountdown(c => c <= 1 ? 30 : c - 1), 1000); return () => clearInterval(iv); }, [lastSync]);
  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const handleSearchChange = (value: string) => {
    setLocalSearch(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => { setSearch(value); setPage(1); }, 350);
  };

  const handleAck = async (id: string) => {
    await fetch('/api/orders/acknowledge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: id }) });
    newIdsRef.current.delete(orders.find(o => o._id === id)?.order_id || '');
    await fetchOrders();
  };

  const handleUnack = async (id: string) => {
    await fetch('/api/orders/acknowledge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: id, undo: true }) });
    await fetchOrders();
  };

  const handleFlag = async () => {
    if (!flagOrder || !flagNote.trim()) return;
    setFlagLoading(true);
    try {
      await fetch('/api/orders/flag-issue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: flagOrder._id, note: flagNote.trim() }) });
      setFlagOrder(null);
      setFlagNote('');
      await fetchOrders();
    } finally { setFlagLoading(false); }
  };

  const handleUnflag = async (id: string) => {
    await fetch('/api/orders/flag-issue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: id, unflag: true }) });
    await fetchOrders();
  };

  const openModal = (order: OrderData, action: 'confirm' | 'reject') => {
    setModalOrder(order);
    setModalAction(action);
    setModalError('');
  };

  const closeModal = () => {
    setModalOrder(null);
    setModalAction(null);
    setModalError('');
  };

  const handleConfirmReject = async () => {
    if (!modalOrder || !modalAction) return;
    setModalLoading(true);
    setModalError('');
    try {
      const res = await fetch('/api/orders/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: modalOrder.order_id, syncId: modalOrder.sync_id, action: modalAction }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setModalError(data.error || `Failed to ${modalAction}`);
        return;
      }
      closeModal();
      newIdsRef.current.delete(modalOrder.order_id);
      await fetchOrders();
    } catch {
      setModalError('Network error');
    } finally {
      setModalLoading(false);
    }
  };

  const handleRecheck = async (order: OrderData) => {
    if (!order.sync_id) return;
    setRecheckingId(order._id);
    try {
      const res = await fetch('/api/orders/recheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncId: order.sync_id }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        console.error('Recheck failed:', data.error);
        return;
      }
      await syncOnly();
    } catch (err) {
      console.error('Recheck error:', err);
    } finally {
      setRecheckingId(null);
    }
  };

  const totalPages = Math.ceil(orders.length / perPage);
  const startIndex = orders.length > 0 ? (page - 1) * perPage + 1 : 0;
  const endIndex = Math.min(page * perPage, orders.length);
  const displayedOrders = orders.slice((page - 1) * perPage, page * perPage);

  const pageNums: number[] = [];
  if (totalPages > 1) {
    const s = Math.max(1, Math.min(page - 2, totalPages - 4));
    for (let i = s; i <= Math.min(totalPages, s + 4); i++) pageNums.push(i);
  }

  return (
    <div className="space-y-3">
      {/* ── Controls Card ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-gray-100">
          <div className="flex items-baseline gap-3">
            <h1 className="text-lg font-bold text-slate-800">Orders</h1>
            <span className="text-sm text-slate-500">
              {unackCount > 0 && (
                <>
                  <span className="font-semibold text-red-600 tabular-nums">{unackCount}</span>
                  <span className="text-slate-400"> new</span>
                  <span className="text-slate-300 mx-1.5">/</span>
                </>
              )}
              <span className="font-semibold text-blue-600 tabular-nums">{tabCounts.invoiced}</span>
              <span className="text-slate-400"> invoiced</span>
              {tabCounts.flagged > 0 && (
                <>
                  <span className="text-slate-300 mx-1.5">/</span>
                  <span className="font-semibold text-orange-600 tabular-nums">{tabCounts.flagged}</span>
                  <span className="text-slate-400"> flagged</span>
                </>
              )}
              <span className="text-slate-300 mx-1.5">/</span>
              <span className="font-semibold text-slate-700 tabular-nums">{tabCounts.all.toLocaleString()}</span>
              <span className="text-slate-400"> total</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-full border border-green-200 bg-green-50 text-green-700 text-[11px] font-semibold flex items-center gap-1">
              <Bell className="h-3 w-3" /> Alerts Active
            </span>
            <button onClick={() => syncOnly()} disabled={syncing}
              className="px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-[background-color,opacity] flex items-center gap-1.5 text-sm">
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Sync</span>
              {!syncing && (
                <span className={`text-[11px] font-mono tabular-nums leading-none px-1.5 py-0.5 rounded ${
                  countdown <= 5 ? 'bg-blue-400 text-white' : 'bg-blue-500/60 text-blue-100'
                }`}>{countdown}s</span>
              )}
            </button>
          </div>
        </div>

        {/* Search + Tabs + Filter */}
        <div className="flex flex-col lg:flex-row gap-2">
          <div className="flex-1 relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-gray-400" />
            </div>
            <input type="text"
              className="block w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-[border-color,box-shadow]"
              placeholder="Search events, venues, order IDs…"
              value={localSearch}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
          </div>
          <div className="flex gap-1.5 shrink-0 flex-wrap">
            {([
              { key: 'invoiced' as TabKey, label: 'Invoiced', count: tabCounts.invoiced, accent: tabCounts.invoiced > 0 ? 'bg-blue-100 text-blue-700' : '' },
              { key: 'confirmed' as TabKey, label: 'Confirmed', count: tabCounts.confirmed, accent: tabCounts.confirmed > 0 ? 'bg-amber-100 text-amber-700' : '' },
              { key: 'rejected' as TabKey, label: 'Rejected', count: tabCounts.rejected, accent: tabCounts.rejected > 0 ? 'bg-red-100 text-red-700' : '' },
              { key: 'delivery_issue' as TabKey, label: 'Delivery Issues', count: tabCounts.deliveryIssue, accent: tabCounts.deliveryIssue > 0 ? 'bg-red-100 text-red-700' : '' },
              { key: 'delivered' as TabKey, label: 'Delivered', count: tabCounts.delivered, accent: tabCounts.delivered > 0 ? 'bg-green-100 text-green-700' : '' },
              { key: 'all' as TabKey, label: 'All', count: tabCounts.all, accent: '' },
            ]).map(t => (
              <button key={t.key} onClick={() => { setActiveTab(t.key); setPage(1); }}
                className={`px-3 py-2 rounded-lg border text-sm transition-[background-color,color,border-color] flex items-center gap-1.5 ${
                  activeTab === t.key
                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}>
                {t.label}
                <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded tabular-nums ${
                  activeTab === t.key ? 'bg-blue-100 text-blue-700' : t.accent || 'bg-gray-100 text-gray-500'
                }`}>{t.count}</span>
              </button>
            ))}
            <button onClick={() => setShowFilters(!showFilters)}
              className={`px-3 py-2 rounded-lg border text-sm transition-[background-color,color,border-color] flex items-center gap-1.5 ${
                showFilters ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}>
              <Filter className="h-3.5 w-3.5" />
              <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${showFilters ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>

        {/* Expandable Filters */}
        {showFilters && (
          <div className="border-t border-gray-200 pt-3">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
                  <ShoppingCart className="inline h-3.5 w-3.5 mr-1" /> Marketplace
                </label>
                <select value={mpFilter} onChange={e => { setMpFilter(e.target.value); setPage(1); }}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white">
                  <option value="all">All Marketplaces</option>
                  {Object.entries(MP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Acknowledgement</label>
                <select value={ackFilter} onChange={e => { setAckFilter(e.target.value); setPage(1); }}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white">
                  <option value="all">All Orders</option>
                  <option value="false">New (Unacknowledged)</option>
                  <option value="true">Acknowledged</option>
                </select>
              </div>
              <div className="flex items-end">
                <button onClick={() => { setMpFilter('all'); setAckFilter('all'); setLocalSearch(''); setSearch(''); setPage(1); }}
                  className="w-full px-3 py-1.5 text-sm text-gray-600 bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200 transition-[background-color]">
                  Clear All Filters
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Results Summary */}
        <div className="border-t border-gray-200 pt-2.5 flex justify-between items-center">
          <div className="text-xs text-gray-500 uppercase tracking-wide font-semibold">
            {orders.length > 0 ? (
              <>Showing {startIndex}–{endIndex} of {orders.length}</>
            ) : (
              <span>No orders found</span>
            )}
            {syncing && (
              <span className="ml-2 inline-flex items-center gap-1 text-blue-600 normal-case tracking-normal font-normal">
                <RefreshCw size={11} className="animate-spin" /> Syncing…
              </span>
            )}
          </div>
          {lastSync && (
            <span className="text-[11px] text-gray-400">Last sync {lastSync.toLocaleTimeString()}</span>
          )}
        </div>
      </div>

      {/* Sync Error */}
      {syncError && (
        <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-xl">
          <div className="flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Sync error: {syncError}</span>
          </div>
        </div>
      )}

      {/* Unack Banner */}
      {unackCount > 0 && (
        <div className="flex items-center bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <span className="text-sm font-medium text-amber-800 flex items-center gap-2">
            <Bell className="w-4 h-4 animate-pulse" />
            <span><span className="font-bold">{unackCount}</span> unacknowledged order{unackCount > 1 ? 's' : ''} — alert ringing</span>
          </span>
        </div>
      )}

      {/* ── Orders Table ── */}
      {orders.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-16 text-center">
          <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-10 h-10 text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-700 mb-2">
            {activeTab === 'invoiced' ? 'No invoiced orders' :
             activeTab === 'confirmed' ? 'No confirmed orders' :
             activeTab === 'rejected' ? 'No rejected orders' :
             activeTab === 'delivery_issue' ? 'No delivery issues' :
             activeTab === 'delivered' ? 'No delivered orders' : 'No orders found'}
          </h3>
          <p className="text-gray-500 max-w-md mx-auto">
            {activeTab === 'invoiced' ? 'New orders needing fulfillment will appear here.' :
             activeTab === 'confirmed' ? 'Confirmed orders will appear here.' :
             activeTab === 'rejected' ? 'Rejected orders will appear here.' :
             activeTab === 'delivery_issue' ? 'Orders with delivery problems will appear here.' :
             activeTab === 'delivered' ? 'Delivered orders will appear here once tickets have been transferred.' :
             'No orders match your current filters.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full divide-y divide-gray-200 table-fixed">
              <colgroup><col className="w-[130px]" /><col /><col className="w-[140px]" /><col className="w-[110px]" /><col className="w-[110px]" /><col className="w-[90px]" /><col className="w-[120px]" /></colgroup>
              <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Status</th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Event Details</th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Event Date</th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Tickets</th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Delivery</th>
                  <th className="px-3 py-2.5 text-right text-xs font-bold text-gray-600 uppercase tracking-wider">Price</th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Ordered</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {displayedOrders.map(o => {
                  const sc = ST[o.status] || ST.pending;
                  const mp = MP[o.marketplace];
                  const isNew = !o.acknowledged;
                  const isHi = newIdsRef.current.has(o.order_id);
                  const isInvoiced = ['invoiced', 'pending', 'problem'].includes(o.status);
                  const isConfirmed = ['confirmed', 'confirmed_delay'].includes(o.status);

                  return (
                    <React.Fragment key={o._id}>
                      <tr className={`hover:bg-gray-50 transition-[background-color] duration-150 ${
                        isHi ? 'bg-red-50 animate-pulse'
                          : isNew ? 'bg-blue-50/50'
                          : ''
                      }`}>
                        {/* Status + Marketplace */}
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex items-center gap-1.5 mb-2">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${sc.bg} ${sc.text}`}>
                              <sc.icon className="w-3.5 h-3.5" />
                              {sc.label}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`${mp?.bg || 'bg-gray-500'} ${mp?.text || 'text-white'} text-[11px] font-bold px-1.5 py-0.5 h-6 rounded flex items-center justify-center shrink-0`}>
                              {mp?.abbr || o.marketplace?.slice(0, 2).toUpperCase() || '??'}
                            </span>
                            <span className="text-xs font-medium text-gray-600 truncate">
                              {mp?.label || o.marketplace || '—'}
                            </span>
                          </div>
                        </td>

                        {/* Event Details */}
                        <td className="px-3 py-2">
                          <div className="min-w-0">
                            {o.ticketmasterUrl ? (
                              <a href={o.ticketmasterUrl} target="_blank" rel="noopener noreferrer"
                                className="text-gray-900 hover:text-blue-600 font-semibold text-sm transition-[color] duration-150 block truncate">
                                {o.event_name || '—'}
                              </a>
                            ) : (
                              <span className="font-semibold text-sm text-gray-900 block truncate">{o.event_name || '—'}</span>
                            )}
                            <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5 min-w-0">
                              {o.venue && (
                                <div className="flex items-center gap-0.5 min-w-0">
                                  <MapPin size={11} className="shrink-0" />
                                  <span className="truncate max-w-[160px]">{o.venue}</span>
                                </div>
                              )}
                              <span className="font-mono shrink-0 text-gray-400">{o.order_id}</span>
                            </div>
                          </div>
                        </td>

                        {/* Event Date */}
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="font-medium text-gray-900 text-xs tabular-nums">{fmtDate(o.occurs_at)}</div>
                          <div className="text-[11px] text-gray-500 tabular-nums">{fmtTime(o.occurs_at)}</div>
                        </td>

                        {/* Tickets */}
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-100 text-indigo-700 text-sm font-bold">
                              <Ticket className="w- h-4" /> {o.quantity}x
                            </span>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <div className="text-xs text-gray-500">
                              Sec <span className="font-bold text-gray-800">{o.section || '—'}</span>
                            </div>
                            <div className="text-xs text-gray-500">
                              Row <span className="font-bold text-gray-800">{o.row || '—'}</span>
                            </div>
                          </div>
                        </td>

                        {/* Delivery */}
                        <td className="px-3 py-2 whitespace-nowrap">
                          <DeliveryBadge delivery={o.delivery} />
                        </td>

                        {/* Price */}
                        <td className="px-3 py-2 whitespace-nowrap text-right">
                          <div className="font-bold text-gray-900 text-sm tabular-nums">${o.total.toFixed(2)}</div>
                          <div className="text-[11px] text-gray-500 tabular-nums">{o.quantity} &times; ${o.unit_price.toFixed(2)}</div>
                        </td>

                        {/* Order Date */}
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="font-medium text-gray-900 text-xs tabular-nums">{fmtDate(o.order_date)}</div>
                          <div className="text-[11px] text-gray-500 tabular-nums">{fmtTime(o.order_date)}</div>
                        </td>

                      </tr>

                      {/* Action bar for invoiced orders */}
                      {isInvoiced && (
                        <tr>
                          <td colSpan={7} className={`px-4 py-2 border-l-4 ${o.hasIssue ? 'border-orange-400 bg-gradient-to-r from-orange-50 to-amber-50/40' : 'border-blue-400 bg-gradient-to-r from-blue-50 to-emerald-50/40'}`}>
                            {/* Issue banner */}
                            {o.hasIssue && (
                              <div className="flex items-center justify-between gap-3 mb-2 px-3 py-2 rounded-lg bg-orange-100 border border-orange-200">
                                <div className="flex items-center gap-2 min-w-0">
                                  <MessageSquareWarning className="w-4 h-4 text-orange-600 shrink-0" />
                                  <span className="text-sm font-semibold text-orange-800 truncate">{o.issueNote}</span>
                                </div>
                                <button onClick={() => handleUnflag(o._id)}
                                  className="px-2.5 py-1 rounded-lg border border-orange-300 bg-white text-orange-600 hover:bg-orange-50 transition-all text-xs font-medium flex items-center gap-1 shrink-0">
                                  <FlagOff className="w-3 h-3" /> Resolve
                                </button>
                              </div>
                            )}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {o.hasIssue ? (
                                  <span className="px-4 py-1.5 rounded-lg bg-gray-200 text-gray-400 text-sm font-bold flex items-center gap-1.5 cursor-not-allowed">
                                    <CheckCircle className="w-4 h-4" /> Confirm
                                  </span>
                                ) : (
                                  <button onClick={() => openModal(o, 'confirm')}
                                    className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-green-600 to-emerald-600 text-white hover:from-green-700 hover:to-emerald-700 transition-all text-sm font-bold flex items-center gap-1.5 animate-pulse shadow-md shadow-green-200/50">
                                    <CheckCircle className="w-4 h-4" /> Confirm
                                  </button>
                                )}
                                <button onClick={() => openModal(o, 'reject')}
                                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 transition-all">
                                  Reject
                                </button>
                                {!o.hasIssue && (
                                  <button onClick={() => { setFlagOrder(o); setFlagNote(''); }}
                                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-orange-500 hover:text-orange-700 hover:bg-orange-50 border border-transparent hover:border-orange-200 transition-all flex items-center gap-1">
                                    <Flag className="w-3 h-3" /> Flag Issue
                                  </button>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                {o.ticketmasterUrl && (
                                  <a href={o.ticketmasterUrl} target="_blank" rel="noopener noreferrer"
                                    className="px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-[background-color] text-xs font-semibold flex items-center gap-1.5">
                                    <ExternalLink className="w-3.5 h-3.5" /> View Event
                                  </a>
                                )}
                                {!o.acknowledged ? (
                                  <button onClick={() => handleAck(o._id)}
                                    className="px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-[background-color] text-xs font-bold flex items-center gap-1.5 shadow-sm shadow-amber-200/50">
                                    <Bell className="w-3.5 h-3.5" /> Acknowledge
                                  </button>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <span className="text-[11px] text-gray-400">
                                      Ack&apos;d {o.acknowledgedAt ? (() => { const m = Math.round((Date.now() - new Date(o.acknowledgedAt).getTime()) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`; })() : ''}
                                    </span>
                                    <button onClick={() => handleUnack(o._id)}
                                      className="px-2.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-500 hover:text-amber-600 hover:border-amber-200 hover:bg-amber-50 transition-all text-[11px] font-medium flex items-center gap-1">
                                      <RotateCw className="w-3 h-3" /> Undo
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}

                      {/* Action bar for confirmed orders */}
                      {isConfirmed && (
                        <tr>
                          <td colSpan={7} className="px-4 py-2 border-l-4 border-amber-400 bg-gradient-to-r from-amber-50 to-blue-50/40">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <button onClick={() => handleRecheck(o)}
                                  disabled={recheckingId === o._id || !o.sync_id}
                                  className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 disabled:opacity-60 transition-all text-sm font-bold flex items-center gap-1.5 shadow-md shadow-blue-200/50">
                                  <RotateCw className={`w-4 h-4 ${recheckingId === o._id ? 'animate-spin' : ''}`} />
                                  {recheckingId === o._id ? 'Rechecking…' : 'Recheck Transfer'}
                                </button>
                              </div>
                              <div className="flex items-center gap-2">
                                {o.ticketmasterUrl && (
                                  <a href={o.ticketmasterUrl} target="_blank" rel="noopener noreferrer"
                                    className="px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-[background-color] text-xs font-semibold flex items-center gap-1.5">
                                    <ExternalLink className="w-3.5 h-3.5" /> View Event
                                  </a>
                                )}
                                {!o.acknowledged && (
                                  <button onClick={() => handleAck(o._id)}
                                    className="px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-[background-color] text-xs font-semibold flex items-center gap-1.5">
                                    <Bell className="w-3.5 h-3.5" /> Acknowledge
                                  </button>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}

                      {/* Action bar for rejected orders */}
                      {o.status === 'rejected' && (
                        <tr>
                          <td colSpan={7} className="px-4 py-2 border-l-4 border-red-300 bg-gradient-to-r from-red-50 to-gray-50/40">
                            <div className="flex items-center justify-end">
                              <div className="flex items-center gap-2">
                                {o.ticketmasterUrl && (
                                  <a href={o.ticketmasterUrl} target="_blank" rel="noopener noreferrer"
                                    className="px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-[background-color] text-xs font-semibold flex items-center gap-1.5">
                                    <ExternalLink className="w-3.5 h-3.5" /> View Event
                                  </a>
                                )}
                                {!o.acknowledged && (
                                  <button onClick={() => handleAck(o._id)}
                                    className="px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-[background-color] text-xs font-semibold flex items-center gap-1.5">
                                    <Bell className="w-3.5 h-3.5" /> Acknowledge
                                  </button>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}

                      {/* Action bar for delivery issue orders */}
                      {o.status === 'delivery_problem' && (
                        <tr>
                          <td colSpan={7} className="px-4 py-2 border-l-4 border-red-400 bg-gradient-to-r from-red-50 to-orange-50/40">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <button onClick={() => handleRecheck(o)}
                                  disabled={recheckingId === o._id || !o.sync_id}
                                  className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-orange-500 to-red-500 text-white hover:from-orange-600 hover:to-red-600 disabled:opacity-60 transition-all text-xs font-bold flex items-center gap-1.5 shadow-md shadow-orange-200/50">
                                  <RotateCw className={`w-3.5 h-3.5 ${recheckingId === o._id ? 'animate-spin' : ''}`} />
                                  {recheckingId === o._id ? 'Rechecking…' : 'Recheck'}
                                </button>
                              </div>
                              <div className="flex items-center gap-2">
                                {o.ticketmasterUrl && (
                                  <a href={o.ticketmasterUrl} target="_blank" rel="noopener noreferrer"
                                    className="px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-[background-color] text-xs font-semibold flex items-center gap-1.5">
                                    <ExternalLink className="w-3.5 h-3.5" /> View Event
                                  </a>
                                )}
                                {!o.acknowledged && (
                                  <button onClick={() => handleAck(o._id)}
                                    className="px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-[background-color] text-xs font-semibold flex items-center gap-1.5">
                                    <Bell className="w-3.5 h-3.5" /> Acknowledge
                                  </button>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}

                      {/* Action bar for delivered orders */}
                      {o.status === 'delivered' && (
                        <tr>
                          <td colSpan={7} className="px-4 py-2 border-l-4 border-green-400 bg-gradient-to-r from-green-50 to-emerald-50/40">
                            <div className="flex items-center justify-end">
                              <div className="flex items-center gap-2">
                                {o.ticketmasterUrl && (
                                  <a href={o.ticketmasterUrl} target="_blank" rel="noopener noreferrer"
                                    className="px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-[background-color] text-xs font-semibold flex items-center gap-1.5">
                                    <ExternalLink className="w-3.5 h-3.5" /> View Event
                                  </a>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-4 py-3">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-xs text-gray-500">
              Page <span className="font-semibold text-gray-700">{page}</span> of{' '}
              <span className="font-semibold text-gray-700">{totalPages}</span>
              {' '}&middot;{' '}
              <span className="font-semibold text-gray-700">{orders.length}</span> total orders
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                className="px-2.5 py-1.5 text-sm text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-[background-color]">
                <ChevronLeft className="w-4 h-4" />
              </button>
              {pageNums.map(p => (
                <button key={p} onClick={() => setPage(p)}
                  className={`w-8 h-8 text-xs font-semibold rounded-lg transition-[background-color,color] ${
                    p === page ? 'bg-blue-600 text-white' : 'text-gray-600 border border-gray-200 hover:bg-blue-50'
                  }`}>{p}</button>
              ))}
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className="px-2.5 py-1.5 text-sm text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-[background-color]">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm/Reject Modal ── */}
      {modalOrder && modalAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h3 className="text-lg font-bold text-gray-900">
                {modalAction === 'confirm' ? 'Confirm Order' : 'Reject Order'}
              </h3>
              <button onClick={closeModal} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-[background-color,color]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-gray-600">
                Are you sure you want to <span className={`font-bold ${modalAction === 'confirm' ? 'text-green-700' : 'text-red-700'}`}>{modalAction}</span> this order?
              </p>
              <div className="bg-gray-50 rounded-lg p-3 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Event</span>
                  <span className="font-semibold text-gray-900 text-right max-w-[250px] truncate">{modalOrder.event_name || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Seats</span>
                  <span className="font-semibold text-gray-900">Sec {modalOrder.section || '—'}, Row {modalOrder.row || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Quantity</span>
                  <span className="font-semibold text-gray-900">{modalOrder.quantity}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Total</span>
                  <span className="font-bold text-gray-900">${modalOrder.total.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Order ID</span>
                  <span className="font-mono text-gray-700 text-xs">{modalOrder.order_id}</span>
                </div>
              </div>
              {modalError && (
                <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {modalError}
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-gray-200 space-y-3">
              <div className="flex items-center justify-end gap-2">
                <button onClick={closeModal} disabled={modalLoading}
                  className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-[background-color]">
                  Cancel
                </button>
                <button onClick={handleConfirmReject} disabled={modalLoading}
                  className={`px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-60 transition-[background-color] flex items-center gap-1.5 ${
                    modalAction === 'confirm'
                      ? 'bg-green-600 hover:bg-green-700'
                      : 'bg-red-600 hover:bg-red-700'
                  }`}>
                  {modalLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {modalAction === 'confirm' ? 'Confirm Order' : 'Yes, Reject Order'}
                </button>
              </div>
              {modalAction === 'confirm' && (
                <div className="text-center">
                  <button onClick={() => setModalAction('reject')} disabled={modalLoading}
                    className="text-xs text-gray-400 hover:text-red-600 transition-[color] disabled:opacity-50">
                    Need to reject this order instead?
                  </button>
                </div>
              )}
              {modalAction === 'reject' && (
                <div className="text-center">
                  <button onClick={() => setModalAction('confirm')} disabled={modalLoading}
                    className="text-xs text-gray-400 hover:text-green-600 transition-[color] disabled:opacity-50">
                    Go back to confirm
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Flag Issue Modal ── */}
      {flagOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Flag className="w-5 h-5 text-orange-500" /> Flag Issue
              </h3>
              <button onClick={() => setFlagOrder(null)} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-[background-color,color]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-gray-600">
                Flag <span className="font-semibold">{flagOrder.event_name}</span> with a note.
              </p>
              <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-500">Order</span>
                  <span className="font-mono text-gray-700 text-xs">{flagOrder.order_id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Total</span>
                  <span className="font-bold text-gray-900">${flagOrder.total.toFixed(2)}</span>
                </div>
              </div>
              <textarea
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 resize-none"
                rows={3}
                placeholder="Describe the issue (e.g., pricing mismatch, wrong section…)"
                value={flagNote}
                onChange={e => setFlagNote(e.target.value)}
                autoFocus
              />
            </div>
            <div className="px-5 py-4 border-t border-gray-200 flex items-center justify-end gap-2">
              <button onClick={() => setFlagOrder(null)} disabled={flagLoading}
                className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-[background-color]">
                Cancel
              </button>
              <button onClick={handleFlag} disabled={flagLoading || !flagNote.trim()}
                className="px-4 py-2 text-sm font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-lg disabled:opacity-60 transition-[background-color] flex items-center gap-1.5">
                {flagLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <Flag className="w-3.5 h-3.5" /> Flag Order
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
