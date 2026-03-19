'use client';

import React, { useState, useEffect, useRef, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Search, ChevronUp, ChevronDown, ChevronsUpDown,
  ChevronLeft, ChevronRight, AlertTriangle,
  Calendar, MapPin, ArrowLeft, Users, Shield,
  AlertOctagon, Clock, Filter, X,
} from 'lucide-react';

/* ─── Types ─── */
interface EventAccount { email: string; tickets: number; orders: number; lastDate: string }
interface EventGroup {
  event: string; eventDate: string; venue: string;
  totalTickets: number; totalOrders: number; lastPurchaseDate: string;
  accounts: EventAccount[];
}
interface AccountSummary {
  email: string; totalPurchases: number; totalTickets: number;
  lastDate: string; lastEvent: string; eventCount: number;
}
interface Props {
  tab: 'events' | 'accounts';
  events: EventGroup[];
  accounts: AccountSummary[];
  stats: { total: number; tickets: number; accountCount: number; eventCount: number };
  pagination: { page: number; totalPages: number; total: number };
  currentSearch: string;
  currentSortBy: string;
  currentSortOrder: string;
  currentDateFrom: string;
  currentDateTo: string;
}

const TICKET_LIMIT = 8;

/* ─── Helpers ─── */
const fmtDate = (iso: string) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-';
const fmtShort = (iso: string) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};
function timeAgo(iso: string): string {
  if (!iso) return '-';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function ticketBadge(tickets: number) {
  const left = TICKET_LIMIT - tickets;
  if (left <= 0) return { label: `MAXED ${tickets}/${TICKET_LIMIT}`, cls: 'bg-red-100 text-red-700 border-red-200', Icon: AlertOctagon };
  if (left <= 2) return { label: `${left} left`, cls: 'bg-amber-100 text-amber-700 border-amber-200', Icon: AlertTriangle };
  return { label: `${left} left`, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: Shield };
}

/* ─── Sortable Header (matches events table) ─── */
function SortHeader({ children, sortKey, current, order, onClick, className = '' }: {
  children: React.ReactNode; sortKey: string; current: string; order: string;
  onClick: (key: string) => void; className?: string;
}) {
  const active = current === sortKey;
  return (
    <button onClick={() => onClick(sortKey)}
      className={`inline-flex items-center gap-1 group hover:text-gray-900 ${className}`}>
      {children}
      {active ? (order === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
              : <ChevronsUpDown className="w-3 h-3 opacity-0 group-hover:opacity-40" />}
    </button>
  );
}

/* ─── Main ─── */
export default function AccountsClient({
  tab, events, accounts, stats, pagination,
  currentSearch, currentSortBy, currentSortOrder, currentDateFrom, currentDateTo,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState(currentSearch);
  const [showDateFilter, setShowDateFilter] = useState(!!(currentDateFrom || currentDateTo));
  const [dateFrom, setDateFrom] = useState(currentDateFrom);
  const [dateTo, setDateTo] = useState(currentDateTo);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const buildUrl = (overrides: Record<string, string>) => {
    const p = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(overrides)) {
      if (!v || (k === 'page' && v === '1') || (k === 'tab' && v === 'events') ||
          (k === 'sortBy' && v === 'lastPurchase') || (k === 'sortOrder' && v === 'desc')) {
        p.delete(k);
      } else { p.set(k, v); }
    }
    const qs = p.toString();
    return `/dashboard/orders/accounts${qs ? `?${qs}` : ''}`;
  };
  const nav = (o: Record<string, string>) => startTransition(() => router.push(buildUrl(o)));

  // Debounced search → URL
  useEffect(() => {
    if (search === currentSearch) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => nav({ search, page: '1' }), 350);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleSort = (key: string) => {
    nav({ sortBy: key, sortOrder: currentSortBy === key && currentSortOrder === 'desc' ? 'asc' : 'desc', page: '1' });
  };

  return (
    <div className="space-y-3">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/dashboard/orders')} className="p-1.5 rounded-lg hover:bg-gray-100">
            <ArrowLeft className="w-4 h-4 text-gray-600" />
          </button>
          <h1 className="text-lg font-bold text-gray-900">Purchase Accounts</h1>
        </div>
        <div className="text-xs text-gray-500">
          {stats.total.toLocaleString()} purchases · {stats.accountCount} accounts · {stats.eventCount} events · {stats.tickets.toLocaleString()} tickets
        </div>
      </div>

      {/* ── Controls Card (matches events page) ── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 space-y-3">
        {/* Search + Filter row */}
        <div className="flex flex-col lg:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search events, accounts, venues..."
              className="block w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowDateFilter(f => !f)}
              className={`px-3 py-2 rounded-lg border text-sm flex items-center gap-1.5 ${
                currentDateFrom || currentDateTo ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}>
              <Filter className="w-3.5 h-3.5" /> Event Date
            </button>
            {/* Tab buttons */}
            <button onClick={() => nav({ tab: 'events', page: '1' })}
              className={`px-3 py-2 rounded-lg text-sm font-medium ${
                tab === 'events' ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white' : 'border border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}>
              By Event
            </button>
            <button onClick={() => nav({ tab: 'accounts', page: '1' })}
              className={`px-3 py-2 rounded-lg text-sm font-medium ${
                tab === 'accounts' ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white' : 'border border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}>
              By Account
            </button>
          </div>
        </div>

        {/* Date filter */}
        {showDateFilter ? (
          <div className="flex items-center gap-2 flex-wrap border-t border-gray-100 pt-2">
            <span className="text-xs text-gray-500 font-medium">Event Date:</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-blue-500" />
            <span className="text-xs text-gray-400">to</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-blue-500" />
            <button onClick={() => nav({ dateFrom, dateTo, page: '1' })}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700">Apply</button>
            {(currentDateFrom || currentDateTo) ? (
              <button onClick={() => { setDateFrom(''); setDateTo(''); setShowDateFilter(false); nav({ dateFrom: '', dateTo: '', page: '1' }); }}
                className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50">
                <X className="w-3.5 h-3.5" />
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Results summary */}
        <div className="border-t border-gray-100 pt-2 flex items-center justify-between text-xs text-gray-500">
          <span>
            Showing {pagination.total} {tab === 'events' ? 'events' : 'accounts'}
            {currentSearch ? ` matching "${currentSearch}"` : ''}
            {currentDateFrom || currentDateTo ? ` · events ${currentDateFrom || '...'} to ${currentDateTo || '...'}` : ''}
          </span>
          <span>Limit: {TICKET_LIMIT} tickets per account</span>
        </div>
      </div>

      {/* ═══ EVENTS TABLE ═══ */}
      {tab === 'events' ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Gradient header (matches events table) */}
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gradient-to-r from-gray-50 to-gray-100 border-b-2 border-gray-200">
                <th className="px-3 py-2.5 text-left text-xs font-bold text-gray-600 uppercase tracking-wider w-8"></th>
                <th className="px-3 py-2.5 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                  <SortHeader sortKey="eventDate" current={currentSortBy} order={currentSortOrder} onClick={handleSort}>Event</SortHeader>
                </th>
                <th className="px-3 py-2.5 text-center text-xs font-bold text-gray-600 uppercase tracking-wider">
                  <SortHeader sortKey="accounts" current={currentSortBy} order={currentSortOrder} onClick={handleSort} className="justify-center">Accounts</SortHeader>
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-bold text-gray-600 uppercase tracking-wider">
                  <SortHeader sortKey="tickets" current={currentSortBy} order={currentSortOrder} onClick={handleSort} className="justify-end">Tickets</SortHeader>
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-bold text-gray-600 uppercase tracking-wider">POs</th>
                <th className="px-3 py-2.5 text-right text-xs font-bold text-gray-600 uppercase tracking-wider">
                  <SortHeader sortKey="lastPurchase" current={currentSortBy} order={currentSortOrder} onClick={handleSort} className="justify-end">Purchased</SortHeader>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {events.map((ev, idx) => {
                const isExpanded = expandedIdx === idx;
                const hasMaxed = ev.accounts.some(a => a.tickets >= TICKET_LIMIT);
                const hasWarning = ev.accounts.some(a => a.tickets >= TICKET_LIMIT - 2);
                return (
                  <React.Fragment key={idx}>
                    <tr onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                      className={`cursor-pointer transition-[background-color] duration-150 ${
                        hasMaxed ? 'bg-red-50/40 border-l-2 border-l-red-400 hover:bg-red-50/60' :
                        hasWarning ? 'bg-amber-50/30 border-l-2 border-l-amber-400 hover:bg-amber-50/50' :
                        idx % 2 === 0 ? 'hover:bg-gray-50' : 'bg-slate-50/40 hover:bg-gray-50'
                      }`}>
                      <td className="px-3 py-2.5 text-center">
                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="text-gray-900 font-semibold text-sm truncate max-w-[350px]">{ev.event}</p>
                        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-gray-500">
                          <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{fmtDate(ev.eventDate)}</span>
                          {ev.venue ? <span className="flex items-center gap-1 truncate"><MapPin className="w-3 h-3 shrink-0" />{ev.venue}</span> : null}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          ev.accounts.length > 1 ? 'bg-purple-50 text-purple-700 border border-purple-200' : 'bg-blue-50 text-blue-700 border border-blue-200'
                        }`}>
                          {ev.accounts.length}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold text-blue-700 tabular-nums">{ev.totalTickets}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600 tabular-nums">{ev.totalOrders}</td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="text-xs text-gray-600 font-medium">{timeAgo(ev.lastPurchaseDate)}</span>
                        <p className="text-[10px] text-gray-400">{fmtShort(ev.lastPurchaseDate)}</p>
                      </td>
                    </tr>

                    {/* Expanded: accounts for this event */}
                    {isExpanded ? (
                      <tr>
                        <td colSpan={6} className="bg-slate-50/60 border-b border-gray-200 px-4 py-3">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">
                              Accounts used on this event ({ev.accounts.length})
                            </p>
                            <p className="text-[10px] text-gray-400">Limit: {TICKET_LIMIT} tickets/account</p>
                          </div>
                          <div className="space-y-1.5">
                            {ev.accounts.map(acc => {
                              const badge = ticketBadge(acc.tickets);
                              const BadgeIcon = badge.Icon;
                              return (
                                <div key={acc.email} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${badge.cls}`}>
                                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                                    acc.tickets >= TICKET_LIMIT ? 'bg-red-200 text-red-800' :
                                    acc.tickets >= TICKET_LIMIT - 2 ? 'bg-amber-200 text-amber-800' : 'bg-blue-100 text-blue-600'
                                  }`}>
                                    {(acc.email || '?')[0].toUpperCase()}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-gray-900 truncate">{acc.email}</p>
                                    <div className="flex items-center gap-1 mt-0.5 text-[10px] text-gray-500">
                                      <span className="font-medium">{acc.tickets} tickets</span>
                                      <span>·</span>
                                      <span>{acc.orders} POs</span>
                                      <span>·</span>
                                      <Clock className="w-2.5 h-2.5" />
                                      <span>{fmtShort(acc.lastDate)}</span>
                                    </div>
                                  </div>
                                  <span className={`flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-semibold shrink-0 ${badge.cls}`}>
                                    <BadgeIcon className="w-3 h-3" /> {badge.label}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
              {events.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-16 text-gray-400">
                    <Calendar className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p className="font-medium">No events found</p>
                    <p className="text-xs mt-1">Try adjusting your search or date filter</p>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* ═══ ACCOUNTS TABLE ═══ */}
      {tab === 'accounts' ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gradient-to-r from-gray-50 to-gray-100 border-b-2 border-gray-200">
                <th className="px-3 py-2.5 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Account</th>
                <th className="px-3 py-2.5 text-right text-xs font-bold text-gray-600 uppercase tracking-wider">
                  <SortHeader sortKey="tickets" current={currentSortBy} order={currentSortOrder} onClick={handleSort} className="justify-end">Tickets</SortHeader>
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-bold text-gray-600 uppercase tracking-wider">POs</th>
                <th className="px-3 py-2.5 text-center text-xs font-bold text-gray-600 uppercase tracking-wider">
                  <SortHeader sortKey="accounts" current={currentSortBy} order={currentSortOrder} onClick={handleSort} className="justify-center">Events</SortHeader>
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">Last Event</th>
                <th className="px-3 py-2.5 text-right text-xs font-bold text-gray-600 uppercase tracking-wider">
                  <SortHeader sortKey="lastPurchase" current={currentSortBy} order={currentSortOrder} onClick={handleSort} className="justify-end">Last Purchase</SortHeader>
                </th>
                <th className="px-3 py-2.5 text-center text-xs font-bold text-gray-600 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {accounts.map((acc, idx) => {
                const badge = ticketBadge(acc.totalTickets);
                const BadgeIcon = badge.Icon;
                return (
                  <tr key={`${acc.email}-${idx}`} className={`transition-[background-color] duration-150 ${
                    acc.totalTickets >= TICKET_LIMIT ? 'bg-red-50/40 border-l-2 border-l-red-400' :
                    acc.totalTickets >= TICKET_LIMIT - 2 ? 'bg-amber-50/30 border-l-2 border-l-amber-400' :
                    idx % 2 === 0 ? 'hover:bg-gray-50' : 'bg-slate-50/40 hover:bg-gray-50'
                  }`}>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                          acc.totalTickets >= TICKET_LIMIT ? 'bg-red-100 text-red-700' :
                          acc.totalTickets >= TICKET_LIMIT - 2 ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-600'
                        }`}>
                          {(acc.email || '?')[0].toUpperCase()}
                        </div>
                        <span className="font-semibold text-gray-900 text-sm truncate max-w-[250px]">{acc.email}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold text-blue-700 tabular-nums">{acc.totalTickets}</td>
                    <td className="px-3 py-2.5 text-right text-gray-600 tabular-nums">{acc.totalPurchases}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                        {acc.eventCount}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-700 text-xs truncate max-w-[180px]">{acc.lastEvent || '-'}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-xs text-gray-600 font-medium">{timeAgo(acc.lastDate)}</span>
                      <p className="text-[10px] text-gray-400">{fmtShort(acc.lastDate)}</p>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${badge.cls}`}>
                        <BadgeIcon className="w-3 h-3" /> {badge.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {accounts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-16 text-gray-400">
                    <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p className="font-medium">No accounts found</p>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* ── Pagination Card (matches events table) ── */}
      {pagination.totalPages > 1 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-4 py-3 flex items-center justify-between">
          <span className="text-xs text-gray-500">
            Page {pagination.page} of {pagination.totalPages} ({pagination.total} {tab === 'events' ? 'events' : 'accounts'})
          </span>
          <div className="flex items-center gap-2">
            <button disabled={pagination.page <= 1}
              onClick={() => nav({ page: String(pagination.page - 1) })}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-3 py-2 text-sm border rounded-lg bg-blue-600 text-white border-blue-600 font-medium tabular-nums">
              {pagination.page}
            </span>
            <button disabled={pagination.page >= pagination.totalPages}
              onClick={() => nav({ page: String(pagination.page + 1) })}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
