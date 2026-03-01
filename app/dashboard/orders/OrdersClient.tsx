'use client';

import React, { useState, useEffect, useCallback, useRef, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  RefreshCw, Search, ChevronLeft, ChevronRight,
  Loader2, X, Bell, ExternalLink, MapPin,
  AlertTriangle, Filter, ShoppingCart,
  ChevronDown, Smartphone, Mail,
  Truck, Send, CheckCircle, RotateCw,
  FileText, Clock, XCircle, Package, Ticket,
  Flag, FlagOff, MessageSquareWarning, Copy, ClipboardCheck,
  User, Phone, Hash, Calendar, DollarSign, Upload, ImageIcon,
} from 'lucide-react';
import { flagOrderIssue, unflagOrderIssue } from '@/actions/orderActions';
import { useOrderAlert } from './useOrderAlert';
import EmptyState from './EmptyState';


interface OrderData {
  _id: string; sync_id?: number; order_id: string; external_id?: string;
  event_name: string; venue: string; city: string; state: string; country: string;
  occurs_at: string; section: string; row: string;
  low_seat: number | null; high_seat: number | null; quantity: number;
  status: string; delivery: string; marketplace: string;
  total: number; unit_price: number; order_date: string;
  transfer_count: number; pos_event_id: string; pos_inventory_id: string;
  pos_invoice_id?: string;
  acknowledged: boolean; acknowledgedAt: string | null;
  portalEventId: string | null; ticketmasterUrl: string | null;
  hasIssue?: boolean; issueNote?: string; issueFlaggedAt?: string | null;
  confirmedAt?: string | null;
  customer_name?: string; customer_email?: string; customer_phone?: string;
  transfer_to_email?: string; public_notes?: string; reason?: string;
  in_hand_date?: string | null; inventory_tags?: string;
  last_seen_internal_notes?: string;
}

interface OrderDetail {
  customer_name: string; customer_email: string; customer_phone: string;
  transfer_to_email: string; public_notes: string; reason: string;
  in_hand_date: string | null; inventory_tags: string;
  last_seen_internal_notes: string;
  low_seat: number | null; high_seat: number | null;
}

interface SyncNewOrder {
  order_id: string; ticketmasterUrl: string; event_name: string;
  section?: string; row?: string; low_seat?: number | null; high_seat?: number | null;
  quantity?: number; total?: number; unit_price?: number;
}

interface SyncResult {
  synced?: number; newOrderIds?: string[];
  newOrders?: SyncNewOrder[];
  unacknowledgedCount?: number; unacknowledgedProblemCount?: number;
  error?: string;
  tabCounts?: TabCounts;
}

interface TabCounts {
  invoiced: number; problem: number; confirmed: number; rejected: number;
  deliveryIssue: number; delivered: number; all: number; flagged: number;
}

interface OrdersClientProps {
  orders: OrderData[];
  total: number;
  totalPages: number;
  unackCount: number;
  tabCounts: TabCounts;
  currentPage: number;
  perPage: number;
  search: string;
  marketplace: string;
  statusFilter: string[];
  sortBy: string;
  sortOrder: string;
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
  stubhub:          { label: 'Viagogo',            abbr: 'VG', bg: 'bg-[#3B1F8E]', text: 'text-white' },
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

// All available status options for the multi-select filter
// SeatScouts API statuses: pending (= invoiced), problem, confirmed, confirmed_delay,
// delivery_problem, delivered. "pending" and "invoiced" are the same thing.
const STATUS_OPTIONS: { value: string; label: string; color: string; dbStatuses: string[] }[] = [
  { value: 'pending', label: 'Pending', color: 'bg-blue-100 text-blue-700 border-blue-200', dbStatuses: ['invoiced', 'pending'] },
  { value: 'problem', label: 'Problem', color: 'bg-orange-100 text-orange-700 border-orange-200', dbStatuses: ['problem'] },
  { value: 'confirmed', label: 'Confirmed', color: 'bg-amber-100 text-amber-700 border-amber-200', dbStatuses: ['confirmed'] },
  { value: 'confirmed_delay', label: 'Confirmed Delay', color: 'bg-amber-100 text-amber-700 border-amber-200', dbStatuses: ['confirmed_delay'] },
  { value: 'delivery_problem', label: 'Delivery Problem', color: 'bg-red-100 text-red-700 border-red-200', dbStatuses: ['delivery_problem'] },
  { value: 'delivered', label: 'Delivered', color: 'bg-green-100 text-green-700 border-green-200', dbStatuses: ['delivered'] },
  { value: 'rejected', label: 'Rejected', color: 'bg-red-100 text-red-700 border-red-200', dbStatuses: ['rejected'] },
];

function fmtDate(dt: string) {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
function fmtTime(dt: string) {
  if (!dt) return '';
  return new Date(dt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
}
function fmtOrderDate(dt: string) {
  if (!dt) return '—';
  const d = new Date(dt);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: '2-digit', day: '2-digit', year: '2-digit' });
}
function fmtOrderTime(dt: string) {
  if (!dt) return '';
  const d = new Date(dt);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) + ' EST';
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
    <div className="flex flex-col items-center gap-0.5">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${bg}`}>
        <Icon className="w-4 h-4 shrink-0" />
      </div>
      <span className="text-[9px] text-gray-500 font-medium text-center leading-tight">{label}</span>
    </div>
  );
}

// Module-level sync timer (survives Suspense remounts)
let _lastSyncAt = Date.now();
const SYNC_INTERVAL = 5; // seconds — keep low for near-instant sync with remote API

function getSyncRemaining() {
  return Math.max(0, SYNC_INTERVAL - Math.floor((Date.now() - _lastSyncAt) / 1000));
}

/* ------------------------------------------------------------------ */
export default function OrdersClient({
  orders, total, totalPages, unackCount: serverUnackCount, tabCounts,
  currentPage, perPage, search, marketplace, statusFilter, sortBy, sortOrder: _sortOrder,
}: OrdersClientProps) {
  void _sortOrder; // passed from server for URL round-trip
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Local data state — allows instant optimistic updates without waiting for router.refresh()
  const [localOrders, setLocalOrders] = useState(orders);
  const [localTabCounts, setLocalTabCounts] = useState(tabCounts);
  const [localTotal, setLocalTotal] = useState(total);

  // Keep local state in sync when server props change (e.g. after router.refresh or navigation)
  useEffect(() => { setLocalOrders(orders); }, [orders]);
  useEffect(() => { setLocalTabCounts(tabCounts); }, [tabCounts]);
  useEffect(() => { setLocalTotal(total); }, [total]);

  // Local UI state
  const [syncing, setSyncing] = useState(false);
  const [unackCount, setUnackCount] = useState(serverUnackCount);
  const [problemCount, setProblemCount] = useState(0);
  const [syncError, setSyncError] = useState('');
  const [countdown, setCountdown] = useState(getSyncRemaining);
  const [hydrated, setHydrated] = useState(false);
  const [localSearch, setLocalSearch] = useState(search);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const newIdsRef = useRef<Set<string>>(new Set());
  const hasSyncedRef = useRef(false);
  const prevUnackRef = useRef(serverUnackCount);
  const { startAlert, stopAlert } = useOrderAlert();
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusDropdownRef = useRef<HTMLDivElement>(null);

  // Confirm/Reject modal state
  const [modalOrder, setModalOrder] = useState<OrderData | null>(null);
  const [modalAction, setModalAction] = useState<'confirm' | 'reject' | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState('');
  const [recheckingId, setRecheckingId] = useState<string | null>(null);
  const [recheckingAll, setRecheckingAll] = useState(false);
  const [recheckAllProgress, setRecheckAllProgress] = useState({ done: 0, total: 0 });
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // Flag issue modal state
  const [flagOrder, setFlagOrder] = useState<OrderData | null>(null);
  const [flagNote, setFlagNote] = useState('');
  const [flagLoading, setFlagLoading] = useState(false);

  // Order detail drawer state
  const [selectedOrder, setSelectedOrder] = useState<OrderData | null>(null);
  const [drawerDetail, setDrawerDetail] = useState<OrderDetail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Proof upload state
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofUploading, setProofUploading] = useState(false);
  const [proofResult, setProofResult] = useState<{ success: boolean; message: string } | null>(null);
  const proofInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setHydrated(true), []);

  // Sync unackCount from server
  useEffect(() => { setUnackCount(serverUnackCount); }, [serverUnackCount]);

  // --- URL navigation helpers ---
  const buildUrl = useCallback((overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams);
    Object.entries(overrides).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    return `/dashboard/orders?${params.toString()}`;
  }, [searchParams]);

  const navigate = useCallback((overrides: Record<string, string | undefined>) => {
    startTransition(() => {
      router.push(buildUrl(overrides));
    });
  }, [buildUrl, router, startTransition]);

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router, startTransition]);

  // --- Status filter ---
  const toggleStatus = useCallback((value: string) => {
    const current = new Set(statusFilter);
    if (current.has(value)) {
      current.delete(value);
    } else {
      current.add(value);
    }
    const newStatus = Array.from(current).join(',');
    navigate({ status: newStatus || undefined, page: '1' });
  }, [statusFilter, navigate]);

  const clearStatusFilter = useCallback(() => {
    navigate({ status: undefined, page: '1' });
  }, [navigate]);

  const setPresetFilter = useCallback((statuses: string[]) => {
    navigate({ status: statuses.join(','), page: '1' });
  }, [navigate]);

  // Close status dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(e.target as Node)) {
        setStatusDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // --- Copy URL ---
  const copyUrl = useCallback(async (url: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(ta);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 2000);
    }
  }, []);

  const openEvent = (url: string) => { window.open(url, '_blank'); };

  // --- Drawer ---
  const openDrawer = useCallback(async (order: OrderData) => {
    setSelectedOrder(order);
    setDrawerOpen(true);
    setDrawerDetail(null);
    setProofFile(null);
    setProofResult(null);
    if (order.sync_id) {
      setDrawerLoading(true);
      try {
        const res = await fetch(`/api/orders/detail?syncId=${order.sync_id}`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data.detail) setDrawerDetail(data.detail);
        }
      } catch { /* ignore */ }
      finally { setDrawerLoading(false); }
    }
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setTimeout(() => { setSelectedOrder(null); setDrawerDetail(null); }, 300);
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && drawerOpen) closeDrawer(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [drawerOpen, closeDrawer]);

  // --- Sync ---
  const syncOnly = useCallback(async () => {
    setSyncing(true);
    setSyncError('');
    try {
      // Default "pending" tab → fast sync (invoiced only). Other filters → full sync (all statuses)
      const isDefaultTab = statusFilter.length === 0 || (statusFilter.length === 1 && statusFilter[0] === 'pending');
      const mode = isDefaultTab ? 'fast' : 'full';
      const res = await fetch(`/api/orders/sync?t=${Date.now()}&mode=${mode}`, { cache: 'no-store' });
      if (!res.ok) { setSyncError(`HTTP ${res.status}`); return; }
      const data: SyncResult = await res.json();
      if (data.error) { setSyncError(data.error); return; }

      if (data.newOrderIds && data.newOrderIds.length > 0) {
        data.newOrderIds.forEach(id => newIdsRef.current.add(id));
      }
      if (data.unacknowledgedCount !== undefined) {
        setUnackCount(data.unacknowledgedCount);
        // After first sync: if there are unacked orders (invoiced OR problem), start alert
        const totalUnack = (data.unacknowledgedCount || 0) + (data.unacknowledgedProblemCount || 0);
        if (!hasSyncedRef.current && totalUnack > 0) {
          startAlert();
        }
      }
      if (data.unacknowledgedProblemCount !== undefined) {
        setProblemCount(data.unacknowledgedProblemCount);
      }
      // Update tab counts instantly from sync response (no need to wait for router.refresh)
      if (data.tabCounts) {
        setLocalTabCounts(data.tabCounts);
      }
      _lastSyncAt = Date.now();
      setCountdown(SYNC_INTERVAL);
      hasSyncedRef.current = true;
    } catch { setSyncError('Network error'); }
    finally { setSyncing(false); }
    // Refresh server component to get latest order list data
    refresh();
  }, [refresh, startAlert, statusFilter]);

  // Initial sync after mount
  useEffect(() => {
    const t = setTimeout(() => syncOnly(), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Alert logic — ring when any unacked orders exist (invoiced OR problem)
  const totalUnack = unackCount + problemCount;
  useEffect(() => {
    if (totalUnack === 0) {
      newIdsRef.current.clear();
      stopAlert();
    } else if (hasSyncedRef.current) {
      startAlert();
    }
    prevUnackRef.current = unackCount;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalUnack]);

  useEffect(() => {
    return () => stopAlert();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync polling
  useEffect(() => {
    const iv = setInterval(syncOnly, SYNC_INTERVAL * 1000);
    return () => clearInterval(iv);
  }, [syncOnly]);

  // Countdown tick
  useEffect(() => {
    const iv = setInterval(() => {
      setCountdown(getSyncRemaining());
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // --- Search ---
  const handleSearchChange = (value: string) => {
    setLocalSearch(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      navigate({ search: value || undefined, page: '1' });
    }, 350);
  };

  // --- Actions ---
  const handleAck = async (id: string) => {
    await fetch('/api/orders/acknowledge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: id }) });
    newIdsRef.current.delete(localOrders.find(o => o._id === id)?.order_id || '');
    refresh();
  };

  const handleUnack = async (id: string) => {
    await fetch('/api/orders/acknowledge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: id, undo: true }) });
    refresh();
  };

  const handleFlag = async () => {
    if (!flagOrder || !flagNote.trim()) return;
    setFlagLoading(true);
    const orderId = flagOrder._id;
    const note = flagNote.trim();
    try {
      setFlagOrder(null);
      setFlagNote('');
      await flagOrderIssue(orderId, note);
      refresh();
    } catch (err) {
      console.error('Flag error:', err);
    } finally { setFlagLoading(false); }
  };

  const handleUnflag = async (id: string) => {
    try {
      await unflagOrderIssue(id);
      refresh();
    } catch (err) {
      console.error('Unflag error:', err);
    }
  };

  const handleProofUpload = async (file: File) => {
    if (!selectedOrder?.sync_id) return;
    setProofUploading(true);
    setProofResult(null);
    try {
      const formData = new FormData();
      formData.append('syncId', String(selectedOrder.sync_id));
      formData.append('image', file);
      const res = await fetch('/api/orders/proof', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok && data.success) {
        setProofResult({ success: true, message: 'Proof uploaded successfully' });
        setProofFile(null);
      } else {
        setProofResult({ success: false, message: data.error || 'Upload failed' });
      }
    } catch {
      setProofResult({ success: false, message: 'Network error' });
    } finally {
      setProofUploading(false);
      if (proofInputRef.current) proofInputRef.current.value = '';
    }
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
      const newStatus = modalAction === 'confirm' ? 'confirmed' : 'rejected';
      const oldStatus = modalOrder.status;

      // Optimistic update — instantly reflect the status change in the UI
      setLocalOrders(prev => prev.map(o =>
        o.order_id === modalOrder.order_id
          ? { ...o, status: newStatus, acknowledged: true, acknowledgedAt: new Date().toISOString() }
          : o
      ));

      // Optimistic tab count update
      setLocalTabCounts(prev => {
        const updated = { ...prev };
        // Decrement old status count
        if (oldStatus === 'invoiced' || oldStatus === 'pending') updated.invoiced = Math.max(0, updated.invoiced - 1);
        else if (oldStatus === 'problem') updated.problem = Math.max(0, updated.problem - 1);
        else if (oldStatus === 'confirmed') updated.confirmed = Math.max(0, updated.confirmed - 1);
        else if (oldStatus === 'rejected') updated.rejected = Math.max(0, updated.rejected - 1);
        // Increment new status count
        if (newStatus === 'confirmed') updated.confirmed += 1;
        else if (newStatus === 'rejected') updated.rejected += 1;
        return updated;
      });

      closeModal();
      newIdsRef.current.delete(modalOrder.order_id);
      if (modalAction === 'confirm' && modalOrder.sync_id) {
        fetch('/api/orders/recheck', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ syncId: modalOrder.sync_id }),
        }).catch(() => {});
      }
      // Background refresh to sync with server (non-blocking)
      refresh();
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

  const handleRecheckAll = async () => {
    const confirmOrders = localOrders.filter(o =>
      ['confirmed', 'confirmed_delay', 'delivery_problem'].includes(o.status) && o.sync_id
    );
    if (confirmOrders.length === 0) return;
    setRecheckingAll(true);
    setRecheckAllProgress({ done: 0, total: confirmOrders.length });
    try {
      const syncIds = confirmOrders.map(o => o.sync_id as number);
      const res = await fetch('/api/orders/recheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncIds }),
      });
      const data = await res.json();
      setRecheckAllProgress({ done: data.total || syncIds.length, total: syncIds.length });
      await syncOnly();
    } catch (err) {
      console.error('Recheck all error:', err);
    } finally {
      setRecheckingAll(false);
    }
  };

  const startIndex = localTotal > 0 ? (currentPage - 1) * perPage + 1 : 0;
  const endIndex = Math.min(currentPage * perPage, localTotal);

  const pageNums: number[] = [];
  if (totalPages > 1) {
    const s = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
    for (let i = s; i <= Math.min(totalPages, s + 4); i++) pageNums.push(i);
  }

  const hasConfirmableOrders = localOrders.some(o =>
    ['confirmed', 'confirmed_delay', 'delivery_problem'].includes(o.status)
  );

  return (
    <>
    {/* Row animations */}
    <style jsx global>{`
      @keyframes row-glow {
        0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
        50% { box-shadow: 0 0 8px rgba(239,68,68,0.06); }
      }
      @keyframes row-flash {
        0%, 100% { background-color: rgba(254,226,226,0.3); }
        50% { background-color: rgba(254,226,226,0.5); }
      }
      @keyframes row-border-pulse {
        0%, 100% { border-left-color: rgb(239,68,68); opacity: 1; }
        50% { border-left-color: rgb(248,113,113); opacity: 0.85; }
      }
      @keyframes new-dot {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.6; }
      }
      @keyframes unack-subtle {
        0%, 100% { background-color: rgba(219,234,254,0.3); }
        50% { background-color: rgba(219,234,254,0.5); }
      }
    `}</style>
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
              <span className="font-semibold text-blue-600 tabular-nums">{localTabCounts.invoiced}</span>
              <span className="text-slate-400"> invoiced</span>
              {localTabCounts.problem > 0 && (
                <>
                  <span className="text-slate-300 mx-1.5">/</span>
                  <span className="font-semibold text-orange-600 tabular-nums">{localTabCounts.problem}</span>
                  <span className="text-slate-400"> problem</span>
                </>
              )}
              {localTabCounts.flagged > 0 && (
                <>
                  <span className="text-slate-300 mx-1.5">/</span>
                  <span className="font-semibold text-orange-600 tabular-nums">{localTabCounts.flagged}</span>
                  <span className="text-slate-400"> flagged</span>
                </>
              )}
              <span className="text-slate-300 mx-1.5">/</span>
              <span className="font-semibold text-slate-700 tabular-nums">{localTabCounts.all.toLocaleString()}</span>
              <span className="text-slate-400"> total</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-full border border-green-200 bg-green-50 text-green-700 text-[11px] font-semibold flex items-center gap-1">
              <Bell className="h-3 w-3" /> Alerts Active
            </span>
            {hasConfirmableOrders && (
              <button onClick={handleRecheckAll} disabled={recheckingAll || syncing}
                className="px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-60 transition-[background-color,opacity] flex items-center gap-1.5 text-sm font-semibold">
                <RotateCw className={`h-3.5 w-3.5 ${recheckingAll ? 'animate-spin' : ''}`} />
                {recheckingAll
                  ? `Rechecking ${recheckAllProgress.done}/${recheckAllProgress.total}…`
                  : `Recheck All`}
              </button>
            )}
            <button onClick={() => syncOnly()} disabled={syncing}
              className="px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-[background-color,opacity] flex items-center gap-1.5 text-sm">
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Sync</span>
              {!syncing && hydrated && (
                <span className={`text-[11px] font-mono tabular-nums leading-none px-1.5 py-0.5 rounded ${
                  countdown <= 3 ? 'bg-blue-400 text-white' : 'bg-blue-500/60 text-blue-100'
                }`}>{countdown}s</span>
              )}
            </button>
          </div>
        </div>

        {/* Search + Status Filter + More Filters */}
        <div className="flex flex-col lg:flex-row gap-2">
          {/* Search Bar */}
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

          {/* Status Multi-Select Dropdown */}
          <div className="relative shrink-0" ref={statusDropdownRef}>
            <button
              onClick={() => setStatusDropdownOpen(!statusDropdownOpen)}
              className={`px-3 py-2 rounded-lg border text-sm transition-all flex items-center gap-2 min-w-[200px] ${
                statusDropdownOpen
                  ? 'bg-blue-50 border-blue-300 text-blue-700 ring-2 ring-blue-200'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Filter className="h-3.5 w-3.5 shrink-0" />
              {statusFilter.length === 0 ? (
                <span className="text-gray-500">All Statuses</span>
              ) : (
                <div className="flex items-center gap-1 flex-wrap">
                  {statusFilter.slice(0, 3).map(s => {
                    const opt = STATUS_OPTIONS.find(o => o.value === s);
                    return (
                      <span key={s} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold border ${opt?.color || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                        {opt?.label || s}
                        <span
                          role="button"
                          onClick={(e) => { e.stopPropagation(); toggleStatus(s); }}
                          className="hover:opacity-70 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </span>
                      </span>
                    );
                  })}
                  {statusFilter.length > 3 && (
                    <span className="text-[11px] text-gray-500">+{statusFilter.length - 3}</span>
                  )}
                </div>
              )}
              <ChevronDown className={`h-3.5 w-3.5 ml-auto transition-transform ${statusDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown */}
            {statusDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 w-[240px] bg-white rounded-lg border border-gray-200 shadow-lg z-50 py-1">
                {/* Clear / Quick presets */}
                <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</span>
                  <div className="flex items-center gap-2">
                    {statusFilter.length > 0 && (
                      <button onClick={clearStatusFilter} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                {/* Quick presets */}
                <div className="px-3 py-2 border-b border-gray-100 flex flex-wrap gap-1">
                  <button onClick={() => setPresetFilter(['pending'])}
                    className="px-2 py-0.5 text-[11px] font-medium rounded bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200">
                    Pending
                  </button>
                  <button onClick={() => setPresetFilter(['confirmed', 'confirmed_delay'])}
                    className="px-2 py-0.5 text-[11px] font-medium rounded bg-amber-50 text-amber-600 hover:bg-amber-100 border border-amber-200">
                    Confirmed
                  </button>
                  <button onClick={() => setPresetFilter(['delivered'])}
                    className="px-2 py-0.5 text-[11px] font-medium rounded bg-green-50 text-green-600 hover:bg-green-100 border border-green-200">
                    Delivered
                  </button>
                  <button onClick={() => clearStatusFilter()}
                    className="px-2 py-0.5 text-[11px] font-medium rounded bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200">
                    All
                  </button>
                </div>

                {/* Status options */}
                {STATUS_OPTIONS.map(opt => {
                  const isSelected = statusFilter.includes(opt.value);
                  // Get count for this status
                  // pending = invoiced+pending in DB, confirmed includes confirmed_delay count separately
                  const countMap: Record<string, number> = {
                    pending: localTabCounts.invoiced, // invoiced count already includes pending
                    problem: localTabCounts.problem,
                    confirmed: localTabCounts.confirmed, // already includes confirmed_delay
                    confirmed_delay: 0,
                    delivery_problem: localTabCounts.deliveryIssue,
                    delivered: localTabCounts.delivered,
                    rejected: localTabCounts.rejected,
                  };
                  return (
                    <button
                      key={opt.value}
                      onClick={() => toggleStatus(opt.value)}
                      className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2.5 hover:bg-gray-50 transition-colors ${isSelected ? 'bg-blue-50/50' : ''}`}
                    >
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
                        isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
                      }`}>
                        {isSelected && <CheckCircle className="w-3 h-3 text-white" />}
                      </div>
                      <span className={`font-medium ${isSelected ? 'text-gray-900' : 'text-gray-700'}`}>{opt.label}</span>
                      {countMap[opt.value] > 0 && (
                        <span className="ml-auto text-[11px] font-semibold text-gray-400 tabular-nums">{countMap[opt.value]}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* More Filters */}
          <button onClick={() => setShowFilters(!showFilters)}
            className={`px-3 py-2 rounded-lg border text-sm transition-all flex items-center gap-1.5 shrink-0 ${
              showFilters ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}>
            <ShoppingCart className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">More</span>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${showFilters ? 'rotate-180' : ''}`} />
          </button>

          {/* Per Page */}
          <select
            value={perPage}
            onChange={(e) => navigate({ perPage: e.target.value, page: '1' })}
            className="px-2.5 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shrink-0"
          >
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>

        {/* Expandable Filters */}
        {showFilters && (
          <div className="border-t border-gray-200 pt-3">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
                  <ShoppingCart className="inline h-3.5 w-3.5 mr-1" /> Marketplace
                </label>
                <select
                  value={marketplace || 'all'}
                  onChange={e => navigate({ marketplace: e.target.value === 'all' ? undefined : e.target.value, page: '1' })}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                >
                  <option value="all">All Marketplaces</option>
                  {Object.entries(MP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Sort By</label>
                <select
                  value={sortBy}
                  onChange={e => navigate({ sortBy: e.target.value, page: '1' })}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                >
                  <option value="order_date">Order Date</option>
                  <option value="occurs_at">Event Date</option>
                  <option value="total">Total Price</option>
                  <option value="event_name">Event Name</option>
                </select>
              </div>
              <div className="flex items-end">
                <button onClick={() => {
                  startTransition(() => {
                    router.push('/dashboard/orders');
                  });
                  setLocalSearch('');
                }}
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
            {localTotal > 0 ? (
              <>Showing {startIndex}–{endIndex} of {localTotal}</>
            ) : (
              <span>No orders found</span>
            )}
            {(syncing || isPending) && (
              <span className="ml-2 inline-flex items-center gap-1 text-blue-600 normal-case tracking-normal font-normal">
                <RefreshCw size={11} className="animate-spin" /> {syncing ? 'Syncing…' : 'Loading…'}
              </span>
            )}
          </div>
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

      {/* Unack Banners */}
      {unackCount > 0 && (
        <div className="flex items-center bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <span className="text-sm font-medium text-amber-800 flex items-center gap-2">
            <Bell className="w-4 h-4 animate-pulse" />
            <span><span className="font-bold">{unackCount}</span> new invoiced order{unackCount > 1 ? 's' : ''} need{unackCount === 1 ? 's' : ''} action — alert ringing</span>
          </span>
        </div>
      )}
      {problemCount > 0 && (
        <div className="flex items-center bg-red-50 border border-red-200 rounded-xl px-4 py-3 justify-between">
          <span className="text-sm font-medium text-red-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            <span><span className="font-bold">{problemCount}</span> order{problemCount > 1 ? 's have' : ' has'} a problem — check the <span className="font-bold">Problem</span> tab</span>
          </span>
          <button
            onClick={() => setPresetFilter(['problem'])}
            className="ml-3 px-3 py-1 text-xs font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            View Problems
          </button>
        </div>
      )}

      {/* ── Orders Table ── */}
      {localOrders.length === 0 ? (
        <EmptyState search={search} hasStatusFilter={statusFilter.length > 0} onClearSearch={() => handleSearchChange('')} />
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50/80 border-b-2 border-gray-200">
                <tr>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Event</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider w-[220px]">Ticket</th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider w-[80px]">Delivery</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider w-[120px]">Price</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider w-[140px]">Order Date</th>
                </tr>
              </thead>
              <tbody>
                {localOrders.map((o, idx) => {
                  const sc = ST[o.status] || ST.pending;
                  const mp = MP[o.marketplace];
                  const isNew = !o.acknowledged;
                  const isHi = newIdsRef.current.has(o.order_id);
                  const isInvoiced = ['invoiced', 'pending', 'problem'].includes(o.status);

                  const statusRowStyles: Record<string, string> = {
                    invoiced: 'border-l-[3px] border-l-blue-500 bg-blue-50/30',
                    pending: 'border-l-[3px] border-l-blue-400 bg-blue-50/20',
                    problem: 'border-l-[3px] border-l-blue-400 bg-blue-50/20',
                    rejected: 'border-l-[3px] border-l-red-500 bg-red-50/40',
                    confirmed: 'border-l-[3px] border-l-amber-500 bg-amber-50/30',
                    confirmed_delay: 'border-l-[3px] border-l-amber-400 bg-amber-50/25',
                    delivered: 'border-l-[3px] border-l-green-500 bg-green-50/40',
                    delivery_problem: 'border-l-[3px] border-l-red-500 bg-red-50/30',
                  };
                  const rowBase = statusRowStyles[o.status] || 'border-l-[3px] border-l-gray-300';

                  return (
                    <React.Fragment key={o._id}>
                      <tr onClick={() => openDrawer(o)}
                        className={`transition-all duration-150 cursor-pointer ${rowBase} ${
                        selectedOrder?._id === o._id ? '!bg-blue-100/60 ring-2 ring-inset ring-blue-300' :
                        isHi ? '!bg-red-50 ring-2 ring-inset ring-red-300 !border-l-red-600 !border-l-[4px]'
                          : isNew ? '!bg-blue-50/60 ring-1 ring-inset ring-blue-200'
                          : 'hover:brightness-[0.97]'
                      } ${idx > 0 ? (isInvoiced ? 'border-t-2 border-t-gray-300' : 'border-t border-gray-200') : ''}`}
                        style={isHi ? { animation: 'row-flash 4s ease-in-out infinite, row-border-pulse 3s ease-in-out infinite, row-glow 4s ease-in-out infinite' }
                          : isNew ? { animation: 'unack-subtle 4s ease-in-out infinite' }
                          : undefined}>
                        {/* EVENT — marketplace icon + order ID + badges, event name, date + venue */}
                        <td className="px-4 py-3">
                          <div className="flex items-start gap-3 min-w-0">
                            {/* Marketplace avatar */}
                            <div className={`${mp?.bg || 'bg-gray-500'} ${mp?.text || 'text-white'} w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 shadow-sm`}>
                              {mp?.abbr || o.marketplace?.slice(0, 2).toUpperCase() || '??'}
                            </div>
                            <div className="min-w-0 flex-1">
                              {/* Line 1: Order ID + Status + Delivery badges */}
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-mono text-gray-500">{o.order_id}</span>
                                {o.ticketmasterUrl && (
                                  <button onClick={(e) => { e.stopPropagation(); openEvent(o.ticketmasterUrl!); }}
                                    className="text-gray-400 hover:text-blue-600 transition-colors" title="Open event">
                                    <ExternalLink className="w-3 h-3" />
                                  </button>
                                )}
                                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${{
                                  invoiced: 'bg-blue-100 text-blue-700',
                                  pending: 'bg-blue-100 text-blue-600',
                                  problem: 'bg-orange-100 text-orange-700',
                                  rejected: 'bg-red-100 text-red-700',
                                  confirmed: 'bg-amber-100 text-amber-700',
                                  confirmed_delay: 'bg-amber-100 text-amber-700',
                                  delivered: 'bg-green-100 text-green-700',
                                  delivery_problem: 'bg-red-100 text-red-700',
                                }[o.status] || 'bg-gray-100 text-gray-600'}`}>
                                  <sc.icon className="w-3 h-3" />
                                  {sc.label}
                                </span>
                                {isHi && (
                                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-red-500 text-white text-[9px] font-bold uppercase"
                                    style={{ animation: 'new-dot 2.5s ease-in-out infinite' }}>
                                    NEW
                                  </span>
                                )}
                              </div>
                              {/* Line 2: Event name */}
                              <div className="mt-1">
                                {o.ticketmasterUrl ? (
                                  <button onClick={(e) => { e.stopPropagation(); openEvent(o.ticketmasterUrl!); }}
                                    className="text-gray-900 hover:text-blue-600 font-semibold text-sm transition-colors truncate text-left block max-w-full">
                                    {o.event_name || '—'}
                                  </button>
                                ) : (
                                  <span className="font-semibold text-sm text-gray-900 truncate block">{o.event_name || '—'}</span>
                                )}
                              </div>
                              {/* Line 3: Event date + venue */}
                              <div className="flex items-center gap-1.5 text-xs text-gray-400 mt-0.5">
                                <Calendar className="w-3 h-3 shrink-0" />
                                <span>{fmtDate(o.occurs_at)}{fmtTime(o.occurs_at) ? ` at ${fmtTime(o.occurs_at)}` : ''}</span>
                                {o.venue && (
                                  <>
                                    <MapPin className="w-3 h-3 shrink-0 ml-1" />
                                    <span className="truncate">{o.venue}{o.city ? `, ${o.city}` : ''}{o.state ? `, ${o.state}` : ''}</span>
                                  </>
                                )}
                              </div>
                              {/* Delivery problem reason */}
                              {o.status === 'delivery_problem' && o.reason && (
                                <div className="flex items-center gap-1.5 mt-1 text-xs text-red-600">
                                  <AlertTriangle className="w-3 h-3 shrink-0" />
                                  <span className="truncate">{o.reason}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* TICKET — Qty / Section / Row / Seat grid */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-5">
                            <div className="text-center min-w-[28px]">
                              <div className="text-base font-bold text-gray-900 tabular-nums leading-tight">{o.quantity}</div>
                              <div className="text-[9px] text-gray-400 uppercase font-medium tracking-wide">Qty</div>
                            </div>
                            <div className="text-center min-w-[36px]">
                              <div className="text-base font-bold text-gray-900 leading-tight">{o.section || '—'}</div>
                              <div className="text-[9px] text-gray-400 uppercase font-medium tracking-wide">Section</div>
                            </div>
                            <div className="text-center min-w-[24px]">
                              <div className="text-base font-bold text-gray-900 leading-tight">{o.row || '—'}</div>
                              <div className="text-[9px] text-gray-400 uppercase font-medium tracking-wide">Row</div>
                            </div>
                          </div>
                        </td>

                        {/* DELIVERY — icon + label */}
                        <td className="px-2 py-3">
                          <DeliveryBadge delivery={o.delivery} />
                        </td>

                        {/* PRICE — total + unit breakdown */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="font-bold text-gray-900 text-sm tabular-nums">${o.total.toFixed(2)}</div>
                          <div className="text-xs text-gray-400 tabular-nums mt-0.5">{o.quantity}x ${o.unit_price.toFixed(2)}</div>
                        </td>

                        {/* ORDER DATE — date + time */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="text-sm text-gray-900 tabular-nums">{fmtOrderDate(o.order_date)}</div>
                          <div className="text-xs text-gray-400 tabular-nums mt-0.5">{fmtOrderTime(o.order_date)}</div>
                        </td>
                      </tr>

                      {/* ── Unified action bar ── */}
                      <tr>
                        <td colSpan={5} className={`px-4 py-2.5 border-l-[3px] border-t ${{
                          invoiced: 'border-l-blue-500 bg-blue-50/20 border-t-blue-200/50',
                          pending: 'border-l-blue-400 bg-blue-50/20 border-t-blue-200/50',
                          problem: 'border-l-orange-400 bg-orange-50/20 border-t-orange-200/50',
                          confirmed: 'border-l-amber-500 bg-amber-50/20 border-t-amber-200/50',
                          confirmed_delay: 'border-l-amber-400 bg-amber-50/20 border-t-amber-200/50',
                          delivered: 'border-l-green-500 bg-green-50/20 border-t-green-200/50',
                          rejected: 'border-l-red-500 bg-red-50/20 border-t-red-200/50',
                          delivery_problem: 'border-l-red-500 bg-red-50/20 border-t-red-200/50',
                        }[o.status] || 'border-l-gray-300 bg-gray-50/20 border-t-gray-200/50'}`}>
                          {/* Issue banner */}
                          {o.hasIssue && (
                            <div className="flex items-center justify-between gap-3 mb-2 px-3 py-1.5 rounded-md bg-orange-100/70 border border-orange-200/80">
                              <div className="flex items-center gap-2 min-w-0">
                                <MessageSquareWarning className="w-3.5 h-3.5 text-orange-600 shrink-0" />
                                <span className="text-xs font-semibold text-orange-800 truncate">{o.issueNote}</span>
                              </div>
                              <button onClick={(e) => { e.stopPropagation(); handleUnflag(o._id); }}
                                className="px-2 py-1 rounded-md border border-orange-200 bg-white text-orange-600 hover:bg-orange-50 transition-all text-[11px] font-medium flex items-center gap-1 shrink-0">
                                <FlagOff className="w-3 h-3" /> Resolve
                              </button>
                            </div>
                          )}
                          <div className="flex items-center justify-between">
                            {/* LEFT: Primary status actions */}
                            <div className="flex items-center gap-2">
                              {isInvoiced && (<>
                                {o.hasIssue ? (
                                  <span className="px-4 py-1.5 rounded-lg bg-gray-200 text-gray-400 text-sm font-bold flex items-center gap-1.5 cursor-not-allowed">
                                    <CheckCircle className="w-4 h-4" /> Confirm
                                  </span>
                                ) : (
                                  <button onClick={(e) => { e.stopPropagation(); openModal(o, 'confirm'); }}
                                    className="px-4 py-1.5 rounded-md bg-green-600 text-white hover:bg-green-700 transition-all text-sm font-bold flex items-center gap-1.5 shadow-sm">
                                    <CheckCircle className="w-4 h-4" /> Confirm
                                  </button>
                                )}
                                <button onClick={(e) => { e.stopPropagation(); openModal(o, 'reject'); }}
                                  className="px-3 py-1.5 rounded-md text-xs font-medium text-red-500 hover:text-red-700 hover:bg-red-50 border border-gray-200 hover:border-red-200 transition-all">
                                  Reject
                                </button>
                                {!o.hasIssue && (
                                  <button onClick={(e) => { e.stopPropagation(); setFlagOrder(o); setFlagNote(''); }}
                                    className="px-3 py-1.5 rounded-md text-xs font-medium text-orange-500 hover:text-orange-700 hover:bg-orange-50 border border-gray-200 hover:border-orange-200 transition-all flex items-center gap-1">
                                    <Flag className="w-3 h-3" /> Flag Issue
                                  </button>
                                )}
                              </>)}
                              {['confirmed', 'confirmed_delay', 'delivery_problem'].includes(o.status) && (
                                <button onClick={(e) => { e.stopPropagation(); handleRecheck(o); }}
                                  disabled={recheckingId === o._id || recheckingAll || !o.sync_id}
                                  className="px-4 py-1.5 rounded-md bg-amber-500 text-white hover:bg-amber-600 text-sm font-bold flex items-center gap-1.5 shadow-sm transition-all disabled:opacity-50">
                                  <RotateCw className={`w-4 h-4 ${recheckingId === o._id ? 'animate-spin' : ''}`} />
                                  {recheckingId === o._id ? 'Checking…' : 'Recheck Status'}
                                </button>
                              )}
                            </div>

                            {/* RIGHT: Ticketmaster + Copy URL + Acknowledge/Time info */}
                            <div className="flex items-center gap-2">
                              {o.ticketmasterUrl && (<>
                                <button onClick={(e) => { e.stopPropagation(); openEvent(o.ticketmasterUrl!); }}
                                  className="px-4 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-all text-sm font-bold flex items-center gap-1.5 shadow-sm">
                                  <ExternalLink className="w-4 h-4" /> Ticketmaster
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); copyUrl(o.ticketmasterUrl!); }}
                                  title="Copy event URL"
                                  className={`px-4 py-1.5 rounded-md text-sm font-bold flex items-center gap-1.5 shadow-sm transition-all ${copiedUrl === o.ticketmasterUrl ? 'bg-green-500 text-white' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
                                  {copiedUrl === o.ticketmasterUrl ? <><ClipboardCheck className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy URL</>}
                                </button>
                              </>)}
                              {isInvoiced && (<>
                                {!o.acknowledged ? (
                                  <button onClick={(e) => { e.stopPropagation(); handleAck(o._id); }}
                                    className="px-3 py-1.5 rounded-md bg-amber-500 text-white hover:bg-amber-600 transition-[background-color] text-xs font-semibold flex items-center gap-1.5">
                                    <Bell className="w-3 h-3" /> Acknowledge
                                  </button>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <span className="text-[11px] text-gray-400">
                                      Ack&apos;d {o.acknowledgedAt ? (() => { const m = Math.round((Date.now() - new Date(o.acknowledgedAt).getTime()) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`; })() : ''}
                                    </span>
                                    <button onClick={(e) => { e.stopPropagation(); handleUnack(o._id); }}
                                      className="px-2 py-1 rounded-md border border-gray-200 bg-white text-gray-400 hover:text-amber-600 hover:border-amber-200 hover:bg-amber-50 transition-all text-[11px] font-medium flex items-center gap-1">
                                      <RotateCw className="w-3 h-3" /> Undo
                                    </button>
                                  </div>
                                )}
                              </>)}
                              {!isInvoiced && (
                                <span className="text-[11px] text-gray-400 flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {(() => {
                                    const m = Math.round((Date.now() - new Date(o.order_date).getTime()) / 60000);
                                    if (m < 60) return `${m}m ago`;
                                    const h = Math.round(m / 60);
                                    if (h < 24) return `${h}h ago`;
                                    return `${Math.round(h / 24)}d ago`;
                                  })()}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
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
              Page <span className="font-semibold text-gray-700">{currentPage}</span> of{' '}
              <span className="font-semibold text-gray-700">{totalPages}</span>
              {' '}&middot;{' '}
              <span className="font-semibold text-gray-700">{localTotal}</span> total orders
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => navigate({ page: String(Math.max(1, currentPage - 1)) })} disabled={currentPage <= 1}
                className="px-2.5 py-1.5 text-sm text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-[background-color]">
                <ChevronLeft className="w-4 h-4" />
              </button>
              {pageNums.map(p => (
                <button key={p} onClick={() => navigate({ page: String(p) })}
                  className={`w-8 h-8 text-xs font-semibold rounded-lg transition-[background-color,color] ${
                    p === currentPage ? 'bg-blue-600 text-white' : 'text-gray-600 border border-gray-200 hover:bg-blue-50'
                  }`}>{p}</button>
              ))}
              <button onClick={() => navigate({ page: String(Math.min(totalPages, currentPage + 1)) })} disabled={currentPage >= totalPages}
                className="px-2.5 py-1.5 text-sm text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-[background-color]">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Order Detail Drawer ── */}
      {selectedOrder && (
        <>
          <div
            className={`fixed inset-0 z-[50] bg-black/30 backdrop-blur-[2px] transition-opacity duration-300 ${drawerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            onClick={closeDrawer}
          />
          <div className={`fixed top-0 right-0 z-[51] h-full w-full max-w-[520px] bg-white shadow-2xl border-l border-gray-200 transition-transform duration-300 ease-out ${drawerOpen ? 'translate-x-0' : 'translate-x-full'}`}>
            <div className="h-full flex flex-col overflow-hidden">
              {/* Drawer Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gray-50/80 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border ${{
                    invoiced: 'bg-blue-50 text-blue-700 border-blue-200',
                    pending: 'bg-blue-50 text-blue-600 border-blue-200',
                    problem: 'bg-orange-50 text-orange-700 border-orange-200',
                    rejected: 'bg-red-50 text-red-700 border-red-200',
                    confirmed: 'bg-amber-50 text-amber-700 border-amber-200',
                    confirmed_delay: 'bg-amber-50 text-amber-700 border-amber-200',
                    delivered: 'bg-green-50 text-green-700 border-green-200',
                    delivery_problem: 'bg-red-50 text-red-700 border-red-200',
                  }[selectedOrder.status] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                    {(() => { const Icon = (ST[selectedOrder.status] || ST.pending).icon; return <Icon className="w-3.5 h-3.5" />; })()}
                    {(ST[selectedOrder.status] || ST.pending).label}
                  </span>
                  {(() => { const mp = MP[selectedOrder.marketplace]; return mp ? (
                    <span className={`${mp.bg} ${mp.text} text-[10px] font-bold px-2 py-0.5 rounded`}>{mp.abbr}</span>
                  ) : null; })()}
                  <span className="font-mono text-xs text-gray-500 truncate">{selectedOrder.order_id}</span>
                </div>
                <button onClick={closeDrawer} className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-all">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Drawer Body */}
              <div className="flex-1 overflow-y-auto">
                <div className="px-5 py-4 space-y-5">
                  {/* Event Section */}
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-lg font-bold text-gray-900 leading-tight">{selectedOrder.event_name || 'Unknown Event'}</h3>
                        {selectedOrder.venue && (
                          <div className="flex items-center gap-1.5 text-sm text-gray-500 mt-1">
                            <MapPin className="w-3.5 h-3.5 shrink-0" />
                            <span>{selectedOrder.venue}</span>
                            {selectedOrder.city && <span className="text-gray-400">· {selectedOrder.city}{selectedOrder.state ? `, ${selectedOrder.state}` : ''}</span>}
                          </div>
                        )}
                      </div>
                      {selectedOrder.ticketmasterUrl && (
                        <button onClick={(e) => { e.stopPropagation(); openEvent(selectedOrder.ticketmasterUrl!); }}
                          className="shrink-0 p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-sm">
                          <ExternalLink className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-3 text-sm">
                      <div className="flex items-center gap-1.5 text-gray-600">
                        <Calendar className="w-4 h-4 text-gray-400" />
                        <span className="font-medium">{fmtDate(selectedOrder.occurs_at)}</span>
                        <span className="text-gray-400">{fmtTime(selectedOrder.occurs_at)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Ticket Details Card */}
                  <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <Ticket className="w-3.5 h-3.5" /> Ticket Details
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-white rounded-lg p-3 border border-gray-100">
                        <div className="text-[10px] text-gray-400 uppercase tracking-wide">Quantity</div>
                        <div className="text-lg font-bold text-indigo-600 mt-0.5">{selectedOrder.quantity}x</div>
                      </div>
                      <div className="bg-white rounded-lg p-3 border border-gray-100">
                        <div className="text-[10px] text-gray-400 uppercase tracking-wide">Delivery</div>
                        <div className="mt-1"><DeliveryBadge delivery={selectedOrder.delivery} /></div>
                      </div>
                      <div className="bg-white rounded-lg p-3 border border-gray-100">
                        <div className="text-[10px] text-gray-400 uppercase tracking-wide">Section</div>
                        <div className="text-lg font-bold text-gray-900 mt-0.5">{selectedOrder.section || '—'}</div>
                      </div>
                      <div className="bg-white rounded-lg p-3 border border-gray-100">
                        <div className="text-[10px] text-gray-400 uppercase tracking-wide">Row</div>
                        <div className="text-lg font-bold text-gray-900 mt-0.5">{selectedOrder.row || '—'}</div>
                      </div>
                      {(selectedOrder.low_seat || selectedOrder.high_seat || drawerDetail?.low_seat || drawerDetail?.high_seat) && (
                        <div className="col-span-2 bg-white rounded-lg p-3 border border-gray-100">
                          <div className="text-[10px] text-gray-400 uppercase tracking-wide">Seats</div>
                          <div className="text-sm font-bold text-gray-900 mt-0.5">
                            {(selectedOrder.low_seat || drawerDetail?.low_seat) && (selectedOrder.high_seat || drawerDetail?.high_seat)
                              ? `${selectedOrder.low_seat || drawerDetail?.low_seat} – ${selectedOrder.high_seat || drawerDetail?.high_seat}`
                              : selectedOrder.low_seat || drawerDetail?.low_seat || '—'}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Pricing Card */}
                  <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <DollarSign className="w-3.5 h-3.5" /> Pricing
                    </h4>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-500">Unit Price</span>
                        <span className="text-sm font-semibold text-gray-900 tabular-nums">${selectedOrder.unit_price.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-500">Quantity</span>
                        <span className="text-sm text-gray-700 tabular-nums">{selectedOrder.quantity}</span>
                      </div>
                      <div className="border-t border-gray-200 pt-2 flex items-center justify-between">
                        <span className="text-sm font-semibold text-gray-700">Total</span>
                        <span className="text-lg font-bold text-gray-900 tabular-nums">${selectedOrder.total.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  {/* POS Info Card */}
                  <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <Hash className="w-3.5 h-3.5" /> POS Info
                    </h4>
                    <div className="space-y-2 text-sm">
                      {selectedOrder.pos_invoice_id && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500">POS Invoice</span>
                          <span className="font-mono text-blue-600 font-semibold">{selectedOrder.pos_invoice_id}</span>
                        </div>
                      )}
                      {selectedOrder.pos_inventory_id && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500">POS Inventory ID</span>
                          <span className="font-mono text-gray-700">{selectedOrder.pos_inventory_id}</span>
                        </div>
                      )}
                      {selectedOrder.pos_event_id && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500">POS Event ID</span>
                          <span className="font-mono text-gray-700">{selectedOrder.pos_event_id}</span>
                        </div>
                      )}
                      {selectedOrder.external_id && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500">External ID</span>
                          <span className="font-mono text-gray-700">{selectedOrder.external_id}</span>
                        </div>
                      )}
                      {(selectedOrder.last_seen_internal_notes || drawerDetail?.last_seen_internal_notes) && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500">Internal Notes</span>
                          <span className="text-gray-700 text-right max-w-[200px] truncate">{selectedOrder.last_seen_internal_notes || drawerDetail?.last_seen_internal_notes}</span>
                        </div>
                      )}
                      {drawerDetail?.public_notes && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500">Public Notes</span>
                          <span className="text-gray-700 text-right max-w-[200px] truncate">{drawerDetail.public_notes}</span>
                        </div>
                      )}
                      {drawerDetail?.inventory_tags && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500">Inventory Tags</span>
                          <span className="px-2 py-0.5 bg-gray-200 text-gray-700 text-xs font-semibold rounded">{drawerDetail.inventory_tags}</span>
                        </div>
                      )}
                      {selectedOrder.transfer_count > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500">Transfer Count</span>
                          <span className="text-gray-700 font-semibold">{selectedOrder.transfer_count}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Transfer Info Card */}
                  {['confirmed', 'confirmed_delay', 'delivered', 'delivery_problem'].includes(selectedOrder.status) && (
                    <div className="bg-gradient-to-br from-cyan-50 to-blue-50 rounded-xl border border-cyan-200 p-4">
                      <h4 className="text-xs font-bold text-cyan-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                        <Send className="w-3.5 h-3.5" /> Transfer Info
                      </h4>
                      {drawerLoading ? (
                        <div className="flex items-center gap-2 py-3 text-sm text-gray-400">
                          <Loader2 className="w-4 h-4 animate-spin" /> Loading transfer details…
                        </div>
                      ) : (
                        <div className="space-y-2.5 text-sm">
                          {(drawerDetail?.customer_name || selectedOrder.customer_name ||
                            drawerDetail?.customer_email || selectedOrder.customer_email ||
                            drawerDetail?.transfer_to_email || selectedOrder.transfer_to_email) ? (
                            <>
                              {(drawerDetail?.customer_name || selectedOrder.customer_name) && (
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-500 flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Customer Name</span>
                                  <span className="font-semibold text-gray-900">{drawerDetail?.customer_name || selectedOrder.customer_name}</span>
                                </div>
                              )}
                              {(drawerDetail?.customer_email || selectedOrder.customer_email) && (
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-500 flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> Customer Email</span>
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono text-sm text-gray-700">{drawerDetail?.customer_email || selectedOrder.customer_email}</span>
                                    <button onClick={() => copyUrl(drawerDetail?.customer_email || selectedOrder.customer_email || '')}
                                      className="p-1 rounded hover:bg-cyan-100 text-gray-400 hover:text-cyan-600 transition-all">
                                      <Copy className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              )}
                              {(drawerDetail?.customer_phone || selectedOrder.customer_phone) && (
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-500 flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> Customer Phone</span>
                                  <span className="text-gray-700">{drawerDetail?.customer_phone || selectedOrder.customer_phone}</span>
                                </div>
                              )}
                              {(drawerDetail?.transfer_to_email || selectedOrder.transfer_to_email) && (
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-500 flex items-center gap-1.5"><Send className="w-3.5 h-3.5" /> Transfer To</span>
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono text-sm text-gray-700">{drawerDetail?.transfer_to_email || selectedOrder.transfer_to_email}</span>
                                    <button onClick={() => copyUrl(drawerDetail?.transfer_to_email || selectedOrder.transfer_to_email || '')}
                                      className="p-1 rounded hover:bg-cyan-100 text-gray-400 hover:text-cyan-600 transition-all">
                                      <Copy className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              )}
                              {selectedOrder.transfer_count > 0 && (
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-500 flex items-center gap-1.5"><RotateCw className="w-3.5 h-3.5" /> Transfer Count</span>
                                  <span className="font-semibold text-gray-700">{selectedOrder.transfer_count}</span>
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="text-gray-400 text-sm py-1">No transfer info available</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Delivery Problem Reason */}
                  {selectedOrder.status === 'delivery_problem' && (drawerDetail?.reason || selectedOrder.reason) && (
                    <div className="bg-red-50 rounded-xl border border-red-200 p-4">
                      <h4 className="text-xs font-bold text-red-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" /> Delivery Problem
                      </h4>
                      <p className="text-sm text-red-700 font-medium">{drawerDetail?.reason || selectedOrder.reason}</p>
                    </div>
                  )}

                  {/* Issue Flag */}
                  {selectedOrder.hasIssue && (
                    <div className="bg-orange-50 rounded-xl border border-orange-200 p-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-orange-600 uppercase tracking-wider flex items-center gap-1.5">
                          <Flag className="w-3.5 h-3.5" /> Flagged Issue
                        </h4>
                        <button onClick={() => handleUnflag(selectedOrder._id)}
                          className="px-2.5 py-1 rounded-md border border-orange-200 bg-white text-orange-600 hover:bg-orange-50 transition-all text-xs font-medium flex items-center gap-1">
                          <FlagOff className="w-3 h-3" /> Resolve
                        </button>
                      </div>
                      <p className="text-sm text-orange-800 font-medium mt-2">{selectedOrder.issueNote}</p>
                      {selectedOrder.issueFlaggedAt && (
                        <p className="text-[11px] text-orange-400 mt-1">Flagged {fmtDate(selectedOrder.issueFlaggedAt)}</p>
                      )}
                    </div>
                  )}

                  {/* Timeline */}
                  <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" /> Timeline
                    </h4>
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                        <div className="flex-1 flex items-center justify-between text-sm">
                          <span className="text-gray-600">Order Placed</span>
                          <span className="text-gray-900 font-medium tabular-nums">{fmtDate(selectedOrder.order_date)} {fmtTime(selectedOrder.order_date)}</span>
                        </div>
                      </div>
                      {selectedOrder.acknowledged && selectedOrder.acknowledgedAt && (
                        <div className="flex items-center gap-3">
                          <div className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                          <div className="flex-1 flex items-center justify-between text-sm">
                            <span className="text-gray-600">Acknowledged</span>
                            <span className="text-gray-900 font-medium tabular-nums">{fmtDate(selectedOrder.acknowledgedAt)} {fmtTime(selectedOrder.acknowledgedAt)}</span>
                          </div>
                        </div>
                      )}
                      {selectedOrder.confirmedAt && (
                        <div className="flex items-center gap-3">
                          <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                          <div className="flex-1 flex items-center justify-between text-sm">
                            <span className="text-gray-600">Confirmed</span>
                            <span className="text-gray-900 font-medium tabular-nums">{fmtDate(selectedOrder.confirmedAt)} {fmtTime(selectedOrder.confirmedAt)}</span>
                          </div>
                        </div>
                      )}
                      {(drawerDetail?.in_hand_date || selectedOrder.in_hand_date) && (
                        <div className="flex items-center gap-3">
                          <div className="w-2 h-2 rounded-full bg-purple-500 shrink-0" />
                          <div className="flex-1 flex items-center justify-between text-sm">
                            <span className="text-gray-600">In Hand Date</span>
                            <span className="text-gray-900 font-medium tabular-nums">{fmtDate(drawerDetail?.in_hand_date || selectedOrder.in_hand_date || '')}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Ticketmaster URL */}
                  {selectedOrder.ticketmasterUrl && (
                    <div className="flex items-center gap-2">
                      <button onClick={(e) => { e.stopPropagation(); openEvent(selectedOrder.ticketmasterUrl!); }}
                        className="flex-1 px-4 py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-all text-sm font-bold flex items-center justify-center gap-2 shadow-sm">
                        <ExternalLink className="w-4 h-4" /> Open Ticketmaster
                      </button>
                      <button onClick={() => copyUrl(selectedOrder.ticketmasterUrl!)}
                        className={`px-4 py-2.5 rounded-lg text-sm font-bold flex items-center gap-2 shadow-sm transition-all ${copiedUrl === selectedOrder.ticketmasterUrl ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200'}`}>
                        {copiedUrl === selectedOrder.ticketmasterUrl ? <><ClipboardCheck className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy URL</>}
                      </button>
                    </div>
                  )}

                  {/* Upload Proof — only for confirmed/delivered orders */}
                  {selectedOrder.sync_id && ['confirmed', 'confirmed_delay', 'delivered', 'delivery_problem'].includes(selectedOrder.status) && (
                    <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
                      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                        <ImageIcon className="w-3.5 h-3.5" /> Upload Proof
                      </h4>
                      <input
                        ref={proofInputRef}
                        type="file"
                        accept=".jpg,.jpeg,.png,.gif"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) { setProofFile(file); setProofResult(null); }
                        }}
                      />
                      {!proofFile ? (
                        <button
                          onClick={() => proofInputRef.current?.click()}
                          className="w-full px-4 py-3 rounded-lg border-2 border-dashed border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50/50 transition-all text-sm font-medium text-gray-500 hover:text-blue-600 flex items-center justify-center gap-2"
                        >
                          <Upload className="w-4 h-4" /> Choose Image
                        </button>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white border border-gray-200">
                            <ImageIcon className="w-5 h-5 text-blue-500 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{proofFile.name}</p>
                              <p className="text-[11px] text-gray-400">{(proofFile.size / 1024).toFixed(0)} KB</p>
                            </div>
                            <button onClick={() => { setProofFile(null); if (proofInputRef.current) proofInputRef.current.value = ''; }}
                              className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => proofInputRef.current?.click()}
                              className="px-3 py-1.5 rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-all text-xs font-medium"
                            >
                              Change
                            </button>
                            <button
                              onClick={() => handleProofUpload(proofFile)}
                              disabled={proofUploading}
                              className="flex-1 px-4 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-all text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"
                            >
                              {proofUploading ? (
                                <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</>
                              ) : (
                                <><Upload className="w-4 h-4" /> Submit Proof</>
                              )}
                            </button>
                          </div>
                        </div>
                      )}
                      {proofResult && (
                        <div className={`mt-2 px-3 py-1.5 rounded-md text-xs font-medium ${
                          proofResult.success
                            ? 'bg-green-100 text-green-700 border border-green-200'
                            : 'bg-red-100 text-red-700 border border-red-200'
                        }`}>
                          {proofResult.message}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Drawer Footer */}
              <div className="shrink-0 border-t border-gray-200 bg-gray-50/80 px-5 py-4">
                {['invoiced', 'pending', 'problem'].includes(selectedOrder.status) && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      {selectedOrder.hasIssue ? (
                        <span className="flex-1 px-4 py-2.5 rounded-lg bg-gray-200 text-gray-400 text-sm font-bold flex items-center justify-center gap-2 cursor-not-allowed">
                          <CheckCircle className="w-4 h-4" /> Confirm (Flagged)
                        </span>
                      ) : (
                        <button onClick={() => openModal(selectedOrder, 'confirm')}
                          className="flex-1 px-4 py-2.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-all text-sm font-bold flex items-center justify-center gap-2 shadow-sm">
                          <CheckCircle className="w-4 h-4" /> Confirm
                        </button>
                      )}
                      <button onClick={() => openModal(selectedOrder, 'reject')}
                        className="px-4 py-2.5 rounded-lg text-sm font-medium text-red-600 hover:text-red-700 border border-red-200 hover:bg-red-50 transition-all">
                        Reject
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      {!selectedOrder.hasIssue && (
                        <button onClick={() => { setFlagOrder(selectedOrder); setFlagNote(''); }}
                          className="px-3 py-2 rounded-lg text-xs font-medium text-orange-600 hover:bg-orange-50 border border-orange-200 transition-all flex items-center gap-1.5">
                          <Flag className="w-3.5 h-3.5" /> Flag Issue
                        </button>
                      )}
                      {!selectedOrder.acknowledged ? (
                        <button onClick={() => { handleAck(selectedOrder._id); }}
                          className="px-3 py-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-all text-xs font-semibold flex items-center gap-1.5 ml-auto">
                          <Bell className="w-3.5 h-3.5" /> Acknowledge
                        </button>
                      ) : (
                        <div className="flex items-center gap-2 ml-auto">
                          <span className="text-[11px] text-gray-400">
                            Ack&apos;d {selectedOrder.acknowledgedAt ? (() => { const m = Math.round((Date.now() - new Date(selectedOrder.acknowledgedAt).getTime()) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`; })() : ''}
                          </span>
                          <button onClick={() => handleUnack(selectedOrder._id)}
                            className="px-2 py-1.5 rounded-md border border-gray-200 bg-white text-gray-400 hover:text-amber-600 hover:border-amber-200 transition-all text-[11px] font-medium flex items-center gap-1">
                            <RotateCw className="w-3 h-3" /> Undo
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {['confirmed', 'confirmed_delay', 'delivery_problem'].includes(selectedOrder.status) && (
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleRecheck(selectedOrder)}
                      disabled={recheckingId === selectedOrder._id || recheckingAll || !selectedOrder.sync_id}
                      className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 shadow-sm transition-all disabled:opacity-50 ${
                        selectedOrder.status === 'delivery_problem'
                          ? 'bg-red-600 text-white hover:bg-red-700'
                          : 'bg-amber-500 text-white hover:bg-amber-600'
                      }`}>
                      <RotateCw className={`w-4 h-4 ${recheckingId === selectedOrder._id ? 'animate-spin' : ''}`} />
                      {recheckingId === selectedOrder._id ? 'Checking…' : 'Recheck Status'}
                    </button>
                  </div>
                )}
                {selectedOrder.status === 'delivered' && (
                  <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-4 py-2.5 border border-green-200">
                    <Package className="w-4 h-4" />
                    <span className="font-medium">This order has been delivered</span>
                  </div>
                )}
                {selectedOrder.status === 'rejected' && (
                  <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-4 py-2.5 border border-red-200">
                    <XCircle className="w-4 h-4" />
                    <span className="font-medium">This order has been rejected</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Confirm/Reject Modal ── */}
      {modalOrder && modalAction && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm">
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm">
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
    </>
  );
}
