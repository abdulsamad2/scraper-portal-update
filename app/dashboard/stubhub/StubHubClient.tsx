'use client';

import { useState, useTransition, useCallback, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Search, CheckCircle, RefreshCw,
  Pencil, Save, X, ExternalLink,
  Link as LinkIcon, Calendar, MapPin,
  ChevronUp, ChevronDown, ChevronsUpDown,
  Play, Square,
} from 'lucide-react';
import { saveStubHubUrl, toggleStubHubPricing, toggleStubHubEnabled } from '@/actions/stubhubActions';
import type { StubHubEventItem } from '@/actions/stubhubActions';

type StubHubSortBy = 'eventDate' | 'lastScraped' | 'status' | 'name' | 'updatedAt';
type SortOrder = 'asc' | 'desc';
type Filter = 'ALL' | 'WITH_URL' | 'NO_URL' | 'ACTIVE' | 'AUTO_PRICE';

interface Props {
  events: StubHubEventItem[];
  pagination: { page: number; perPage: number; total: number; totalPages: number };
  counts: { all: number; withUrl: number; scraped: number; autoPrice: number };
  currentSearch: string;
  currentFilter: Filter;
  currentSortBy: StubHubSortBy;
  currentSortOrder: SortOrder;
}

/* ═══════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════ */
function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '-';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1)   return 'Just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30)  return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function formatDate(dateString?: string) {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatTime(dateString?: string) {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

/* ═══════════════════════════════════════════════════════
   URL EDITOR (inline per row)
   ═══════════════════════════════════════════════════════ */
function UrlEditor({ eventId, currentUrl, onSaved }: {
  eventId: string; currentUrl: string; onSaved: (url: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const open   = () => { setDraft(currentUrl); setError(''); setEditing(true); };
  const cancel = () => setEditing(false);
  const save   = () => {
    startTransition(async () => {
      const res = await saveStubHubUrl(eventId, draft);
      if (res.success) { setEditing(false); onSaved(draft.trim()); }
      else setError(res.error ?? 'Failed');
    });
  };

  if (editing) return (
    <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
      <input autoFocus type="url" value={draft} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
        placeholder="https://www.stubhub.com/.../event/..."
        className="border border-blue-300 rounded-lg px-2 py-1 text-xs w-64 focus:outline-none focus:ring-2 focus:ring-blue-400" />
      <button onClick={save} disabled={isPending}
        className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-2 py-1 rounded-lg disabled:opacity-60 flex items-center gap-1">
        <Save className="w-3 h-3" />{isPending ? '...' : 'Save'}
      </button>
      <button onClick={cancel} className="border text-xs px-2 py-1 rounded-lg hover:bg-gray-50">
        <X className="w-3 h-3" />
      </button>
      {error && <span className="text-red-500 text-xs">{error}</span>}
    </div>
  );

  if (currentUrl) return (
    <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
        <CheckCircle className="w-3 h-3" /> Set
      </span>
      <a href={currentUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-600">
        <ExternalLink className="w-3.5 h-3.5" />
      </a>
      <button onClick={open} className="text-gray-400 hover:text-gray-700 p-0.5 rounded" title="Edit URL">
        <Pencil className="w-3 h-3" />
      </button>
    </div>
  );

  return (
    <div onClick={e => e.stopPropagation()}>
      <button onClick={open} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 hover:bg-amber-200 border border-amber-200">
        <LinkIcon className="w-3 h-3" /> Set URL
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   AUTO-PRICE TOGGLE (inline)
   ═══════════════════════════════════════════════════════ */
function AutoPriceToggle({ eventId, initial }: { eventId: string; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [, startTransition] = useTransition();

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !on;
    setOn(next);
    startTransition(async () => {
      const res = await toggleStubHubPricing(eventId, next);
      if (!res.success) setOn(!next);
    });
  };

  return (
    <button onClick={toggle} title={on ? 'Auto-price ON' : 'Auto-price OFF'}
      className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${on ? 'bg-emerald-500' : 'bg-gray-300'}`}>
      <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow transition duration-200 ${on ? 'translate-x-3' : 'translate-x-0'}`} />
    </button>
  );
}

/* ═══════════════════════════════════════════════════════
   SCRAPING ENABLED TOGGLE
   ═══════════════════════════════════════════════════════ */
function StubHubEnabledToggle({ eventId, initial }: { eventId: string; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [, startTransition] = useTransition();

  useEffect(() => { setOn(initial); }, [initial]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !on;
    setOn(next);
    startTransition(async () => {
      const res = await toggleStubHubEnabled(eventId, next);
      if (!res.success) setOn(!next);
    });
  };

  return (
    <button onClick={toggle}
      aria-label={on ? 'Stop StubHub scraping' : 'Start StubHub scraping'}
      className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
        on
          ? 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500'
          : 'bg-gradient-to-r from-blue-500 to-purple-600 text-white hover:from-blue-600 hover:to-purple-700 focus-visible:ring-blue-500'
      }`}>
      {on ? <><Square size={11} /><span>Stop</span></> : <><Play size={11} /><span>Start</span></>}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════
   SORTABLE HEADER (server-link style, matching events page)
   ═══════════════════════════════════════════════════════ */
function SortableHeader({ children, sortKey, currentSortBy, currentSortOrder, buildUrl, className }: {
  children: React.ReactNode;
  sortKey: StubHubSortBy;
  currentSortBy: StubHubSortBy;
  currentSortOrder: SortOrder;
  buildUrl: (overrides: Record<string, string | undefined>) => string;
  className?: string;
}) {
  const isActive = currentSortBy === sortKey;
  const nextOrder: SortOrder = isActive && currentSortOrder === 'asc' ? 'desc' : 'asc';
  const href = buildUrl({ sortBy: sortKey, sortOrder: nextOrder, page: '1' });

  return (
    <a href={href}
      className={`inline-flex items-center gap-1 group hover:text-blue-600 transition-colors cursor-pointer ${className ?? ''}`}>
      {children}
      {isActive && currentSortOrder === 'asc'
        ? <ChevronUp size={12} className="text-blue-500 shrink-0" />
        : isActive && currentSortOrder === 'desc'
          ? <ChevronDown size={12} className="text-blue-500 shrink-0" />
          : <ChevronsUpDown size={12} className="text-gray-300 group-hover:text-gray-400 shrink-0" />}
    </a>
  );
}

/* ═══════════════════════════════════════════════════════
   STATUS BADGE (matching events page)
   ═══════════════════════════════════════════════════════ */
function StatusBadge({ hasUrl, scraped }: { hasUrl: boolean; scraped: boolean }) {
  if (hasUrl && scraped) {
    return (
      <div className="flex items-center">
        <div className="w-2 h-2 rounded-full mr-2 bg-blue-500" />
        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">Active</span>
      </div>
    );
  }
  if (hasUrl) {
    return (
      <div className="flex items-center">
        <div className="w-2 h-2 rounded-full mr-2 bg-amber-500" />
        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">Pending</span>
      </div>
    );
  }
  return (
    <div className="flex items-center">
      <div className="w-2 h-2 rounded-full mr-2 bg-slate-400" />
      <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-50 text-slate-700 border border-slate-200">No URL</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   PAGINATION (matching events page style)
   ═══════════════════════════════════════════════════════ */
function PaginationControls({ page, totalPages, total, navigate }: {
  page: number; totalPages: number; total: number;
  navigate: (overrides: Record<string, string | undefined>) => void;
}) {
  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    navigate({ page: String(newPage) });
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-4 py-3">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="text-xs text-gray-500">
          Page <span className="font-semibold text-gray-700">{page}</span> of{' '}
          <span className="font-semibold text-gray-700">{totalPages}</span>
          {' '}&middot;{' '}
          <span className="font-semibold text-gray-700">{total}</span> total events
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => handlePageChange(page - 1)} disabled={page === 1}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
            Previous
          </button>
          <div className="flex items-center gap-1">
            {page > 3 && (
              <>
                <button onClick={() => handlePageChange(1)} className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">1</button>
                {page > 4 && <span className="px-1 text-gray-500">...</span>}
              </>
            )}
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum;
              if (totalPages <= 5) pageNum = i + 1;
              else if (page <= 3) pageNum = i + 1;
              else if (page >= totalPages - 2) pageNum = totalPages - 4 + i;
              else pageNum = page - 2 + i;
              if (pageNum < 1 || pageNum > totalPages) return null;
              return (
                <button key={pageNum} onClick={() => handlePageChange(pageNum)}
                  className={`px-3 py-2 text-sm border rounded-lg ${pageNum === page ? 'bg-blue-600 text-white border-blue-600 font-medium' : 'border-gray-300 hover:bg-gray-50'}`}>
                  {pageNum}
                </button>
              );
            })}
            {page < totalPages - 2 && (
              <>
                {page < totalPages - 3 && <span className="px-1 text-gray-500">...</span>}
                <button onClick={() => handlePageChange(totalPages)} className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">{totalPages}</button>
              </>
            )}
          </div>
          <button onClick={() => handlePageChange(page + 1)} disabled={page === totalPages}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   MAIN EVENTS VIEW
   ═══════════════════════════════════════════════════════ */
export default function StubHubEventsView({ events, pagination, counts, currentSearch, currentFilter, currentSortBy, currentSortOrder }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [localEvents, setLocalEvents] = useState(events);
  const [localSearch, setLocalSearch] = useState(currentSearch);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync events when server data changes
  useEffect(() => { setLocalEvents(events); }, [events]);

  const buildUrl = useCallback((overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(overrides).forEach(([key, value]) => {
      if (value !== undefined && value !== '' && value !== 'ACTIVE' && !(key === 'page' && value === '1')) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    return `/dashboard/stubhub?${params.toString()}`;
  }, [searchParams]);

  const navigate = useCallback((overrides: Record<string, string | undefined>) => {
    startTransition(() => {
      router.push(buildUrl(overrides));
    });
  }, [buildUrl, router, startTransition]);

  const handleSearchChange = (value: string) => {
    setLocalSearch(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      navigate({ search: value, page: '1' });
    }, 350);
  };

  const handleRefresh = () => {
    startTransition(() => router.refresh());
  };

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: 'ACTIVE',     label: 'Active',     count: counts.scraped },
    { key: 'ALL',        label: 'All',         count: counts.all },
    { key: 'WITH_URL',   label: 'Has URL',     count: counts.withUrl },
    { key: 'NO_URL',     label: 'No URL',      count: counts.all - counts.withUrl },
    { key: 'AUTO_PRICE', label: 'Auto-Price',  count: counts.autoPrice },
  ];

  const from = (pagination.page - 1) * pagination.perPage + 1;
  const to = Math.min(pagination.page * pagination.perPage, pagination.total);

  return (
    <div className={`space-y-3 ${isPending ? 'opacity-70 pointer-events-none' : ''} transition-opacity`}>
      {/* Controls Card (matching events page) */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 space-y-3">
        {/* Header summary */}
        <div className="flex items-center justify-between gap-3 pb-2.5 border-b border-gray-100">
          <div className="flex items-baseline gap-2">
            <h1 className="text-lg font-bold text-slate-800">Market Intelligence</h1>
            <span className="text-sm text-slate-500">
              <span className="font-semibold text-green-600" style={{ fontVariantNumeric: 'tabular-nums' }}>{counts.scraped.toLocaleString()}</span>
              <span className="text-slate-400"> scraped</span>
              <span className="text-slate-300 mx-1">/</span>
              <span className="font-semibold text-slate-700" style={{ fontVariantNumeric: 'tabular-nums' }}>{counts.withUrl.toLocaleString()}</span>
              <span className="text-slate-400"> linked</span>
              <span className="text-slate-300 mx-1">/</span>
              <span className="font-semibold text-slate-700" style={{ fontVariantNumeric: 'tabular-nums' }}>{counts.all.toLocaleString()}</span>
              <span className="text-slate-400"> total</span>
            </span>
          </div>
          <button onClick={handleRefresh} disabled={isPending}
            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-[background-color,opacity] flex items-center gap-1.5 text-sm">
            <RefreshCw className={`h-3.5 w-3.5 ${isPending ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {/* Search + Filters */}
        <div className="flex flex-col lg:flex-row gap-2">
          <div className="flex-1 relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-gray-400" />
            </div>
            <input type="text"
              className="block w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-[border-color,box-shadow]"
              placeholder="Search events by name or venue..."
              value={localSearch}
              onChange={e => handleSearchChange(e.target.value)}
            />
          </div>
          <div className="flex gap-1.5 flex-wrap shrink-0">
            {filters.map(f => (
              <button key={f.key} onClick={() => navigate({ filter: f.key, page: '1' })}
                className={`px-3 py-2 rounded-lg text-xs font-medium border transition-[background-color,color,border-color] ${
                  currentFilter === f.key
                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}>
                {f.label} ({f.count})
              </button>
            ))}
          </div>
        </div>

        {/* Results Summary + Legend */}
        <div className="border-t border-gray-200 pt-2.5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <div className="text-xs text-gray-500">
            Showing <span className="font-semibold text-gray-700">{from}</span>-<span className="font-semibold text-gray-700">{to}</span> of{' '}
            <span className="font-semibold text-gray-700">{pagination.total}</span> events
            {isPending && (
              <span className="ml-2 inline-flex items-center gap-1 text-blue-600">
                <RefreshCw size={11} className="animate-spin" />
                Refreshing...
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-sm bg-blue-200 border-l-2 border-blue-400" />Active &amp; scraped</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-sm bg-amber-100 border-l-2 border-amber-400" />URL set, pending</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-sm bg-gray-100 border-l-2 border-gray-300" />No URL</span>
          </div>
        </div>
      </div>

      {/* Table */}
      {localEvents.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-16 text-center">
          <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Search className="w-10 h-10 text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-700 mb-2">No events found</h3>
          <p className="text-gray-500 max-w-md mx-auto">
            No events match your current filters. Try adjusting your search or filter criteria.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full divide-y divide-gray-200 table-fixed">
              <colgroup>
                <col className="w-[90px]" />
                <col />
                <col className="w-[130px]" />
                <col className="w-[150px]" />
                <col className="w-[120px]" />
                <col className="w-[80px]" />
                <col className="w-[150px]" />
              </colgroup>
              <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                    <SortableHeader sortKey="status" currentSortBy={currentSortBy} currentSortOrder={currentSortOrder} buildUrl={buildUrl}>Status</SortableHeader>
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                    <SortableHeader sortKey="name" currentSortBy={currentSortBy} currentSortOrder={currentSortOrder} buildUrl={buildUrl}>Event Details</SortableHeader>
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                    <SortableHeader sortKey="eventDate" currentSortBy={currentSortBy} currentSortOrder={currentSortOrder} buildUrl={buildUrl}>Date</SortableHeader>
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">StubHub URL</th>
                  <th className="px-3 py-2.5 text-center text-xs font-bold text-gray-600 uppercase tracking-wider">
                    <SortableHeader sortKey="updatedAt" currentSortBy={currentSortBy} currentSortOrder={currentSortOrder} buildUrl={buildUrl}>Last Updated</SortableHeader>
                  </th>
                  <th className="px-3 py-2.5 text-center text-xs font-bold text-gray-600 uppercase tracking-wider">Auto $</th>
                  <th className="px-3 py-2.5 text-right text-xs font-bold text-gray-600 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {localEvents.map(ev => {
                  const hasUrl = !!ev.stubhubUrl;
                  const scraped = !!ev.stubhubLastScraped;
                  const rowClass = hasUrl && scraped
                    ? 'bg-blue-50 border-l-2 border-blue-400'
                    : hasUrl && !scraped
                      ? 'bg-amber-50 border-l-2 border-amber-400'
                      : 'bg-gray-50/60 border-l-2 border-gray-300 opacity-75';

                  return (
                    <tr key={ev.Event_ID}
                      className={`hover:bg-gray-50 transition-[background-color] duration-150 ${rowClass}`}
                    >
                      <td className="px-3 py-2 whitespace-nowrap">
                        <StatusBadge hasUrl={hasUrl} scraped={scraped} />
                      </td>
                      <td className="px-3 py-2">
                        <div className="min-w-0">
                          <span className="text-gray-900 hover:text-blue-600 font-semibold text-sm transition-[color] duration-150 block truncate">
                            {ev.Event_Name}
                          </span>
                          <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5 min-w-0">
                            {ev.Venue && (
                              <div className="flex items-center gap-0.5 min-w-0">
                                <MapPin size={11} />
                                <span className="truncate max-w-[140px]">{ev.Venue}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="font-medium text-gray-900 text-xs tabular-nums flex items-center gap-1">
                          <Calendar size={11} className="text-gray-400" />
                          {formatDate(ev.Event_DateTime)}
                        </div>
                        <div className="text-[11px] text-gray-500 tabular-nums ml-[15px]">
                          {formatTime(ev.Event_DateTime)}
                        </div>
                      </td>
                      <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                        <UrlEditor eventId={ev.Event_ID} currentUrl={ev.stubhubUrl ?? ''}
                          onSaved={url => setLocalEvents(prev => prev.map(e => e.Event_ID === ev.Event_ID ? { ...e, stubhubUrl: url } : e))} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-center">
                        <span className="text-xs text-gray-600">{timeAgo(ev.stubhubLastScraped)}</span>
                      </td>
                      <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
                        <AutoPriceToggle eventId={ev.Event_ID} initial={ev.useStubHubPricing ?? false} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right" onClick={e => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-2">
                          <StubHubEnabledToggle eventId={ev.Event_ID} initial={ev.stubhubEnabled ?? true} />
                          {hasUrl && (
                            <button onClick={() => router.push(`/dashboard/stubhub?event=${ev.Event_ID}`)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg border border-blue-200 transition-colors">
                              Analyze
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination (separate card, matching events page) */}
      {pagination.totalPages > 1 && (
        <PaginationControls
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          navigate={navigate}
        />
      )}
    </div>
  );
}
