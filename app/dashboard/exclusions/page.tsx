'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Filter, Search, Calendar,
  MapPin, Eye, Activity, Ticket, ExternalLink,
  TrendingUp, Package
} from 'lucide-react';
import { getInventoryCountsByType } from '@/actions/eventActions';

interface EventData {
  _id: string;
  mapping_id: string;
  Event_Name: string;
  Event_DateTime: string;
  Venue?: string;
  URL?: string;
  Available_Seats?: number;
  Skip_Scraping?: boolean;
  Last_Updated?: string;
  priceIncreasePercentage?: number;
  standardMarkupAdjustment?: number;
  resaleMarkupAdjustment?: number;
  includeStandardSeats?: boolean;
  includeResaleSeats?: boolean;
  // enriched
  standardQty?: number;
  resaleQty?: number;
  standardRows?: number;
  resaleRows?: number;
}

interface ExclusionRule {
  _id: string;
  eventId: string;
  sectionRowExclusions: Array<{
    section: string;
    excludeEntireSection: boolean;
    excludedRows: string[];
  }>;
  outlierExclusion?: {
    enabled: boolean;
  };
  isActive: boolean;
  lastUpdated: string;
}

function fmt(date: string, opts: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(date));
  } catch {
    return '—';
  }
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ExclusionRulesPage() {
  const router = useRouter();
  const [events, setEvents] = useState<EventData[]>([]);
  const [exclusionRules, setExclusionRules] = useState<ExclusionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalEvents, setTotalEvents] = useState(0);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const eventsPerPage = 100;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const loadData = useCallback(async (page = 1, search = '') => {
    setLoading(true);
    try {
      const [eventsRes, rulesRes] = await Promise.all([
        fetch(`/api/events?page=${page}&limit=${eventsPerPage}&search=${encodeURIComponent(search)}`),
        fetch('/api/exclusion-rules'),
      ]);

      let rawEvents: EventData[] = [];
      if (eventsRes.ok) {
        const d = await eventsRes.json();
        rawEvents = d.events || d;
        setTotalEvents(d.total || (d.events ? d.events.length : d.length));
      }

      if (rulesRes.ok) setExclusionRules(await rulesRes.json());

      // Fetch inventory counts using existing server action
      const mappingIds = rawEvents.map(e => e.mapping_id).filter(Boolean) as string[];
      const counts = mappingIds.length ? await getInventoryCountsByType(mappingIds) : {};

      const enriched = rawEvents.map(e => ({
        ...e,
        standardQty: e.mapping_id ? (counts[e.mapping_id]?.standard ?? 0) : 0,
        resaleQty: e.mapping_id ? (counts[e.mapping_id]?.resale ?? 0) : 0,
        standardRows: e.mapping_id ? (counts[e.mapping_id]?.standardRows ?? 0) : 0,
        resaleRows: e.mapping_id ? (counts[e.mapping_id]?.resaleRows ?? 0) : 0,
      }));

      // Sort: active first, then by date ascending (upcoming soonest)
      enriched.sort((a, b) => {
        const aActive = a.Skip_Scraping ? 1 : 0;
        const bActive = b.Skip_Scraping ? 1 : 0;
        if (aActive !== bActive) return aActive - bActive;
        return new Date(a.Event_DateTime).getTime() - new Date(b.Event_DateTime).getTime();
      });

      setEvents(enriched);
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  }, [eventsPerPage]);

  useEffect(() => {
    loadData(currentPage, debouncedSearch);
  }, [loadData, currentPage, debouncedSearch]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  }, []);

  const totalPages = Math.ceil(totalEvents / eventsPerPage);
  const startIndex = (currentPage - 1) * eventsPerPage + 1;
  const endIndex = Math.min(currentPage * eventsPerPage, totalEvents);

  const getRule = (eventId: string) =>
    exclusionRules.find(r => r.eventId === eventId && r.isActive);

  const getExclusionSummary = (rule: ExclusionRule | undefined) => {
    if (!rule) return { text: 'No exclusions', color: 'text-slate-400', hasRule: false, details: [] };

    const details: string[] = [];
    let totalRows = 0;
    let fullSections = 0;

    for (const excl of rule.sectionRowExclusions || []) {
      if (excl.excludeEntireSection) {
        fullSections++;
        details.push(`${excl.section}: entire`);
      } else if (excl.excludedRows?.length > 0) {
        totalRows += excl.excludedRows.length;
        details.push(`${excl.section}: rows ${excl.excludedRows.join(', ')}`);
      }
    }

    const outlier = rule.outlierExclusion?.enabled;
    const parts: string[] = [];
    if (fullSections > 0) parts.push(`${fullSections} section${fullSections > 1 ? 's' : ''}`);
    if (totalRows > 0) parts.push(`${totalRows} row${totalRows > 1 ? 's' : ''}`);
    if (outlier) parts.push('outlier');

    if (parts.length === 0 && (rule.sectionRowExclusions?.length ?? 0) > 0) {
      return { text: `${rule.sectionRowExclusions.length} rule(s), no active exclusions`, color: 'text-slate-400', hasRule: true, details };
    }
    if (parts.length === 0) return { text: 'No exclusions', color: 'text-slate-400', hasRule: false, details };

    return {
      text: parts.join(' + ') + ' excluded',
      color: outlier ? 'text-orange-600' : 'text-purple-600',
      hasRule: true,
      details,
    };
  };

  // Stats
  const activeRules = exclusionRules.filter(r => r.isActive).length;
  const sectionRules = exclusionRules.reduce((s, r) => s + (r.sectionRowExclusions?.length || 0), 0);
  const outlierCount = exclusionRules.filter(r => r.outlierExclusion?.enabled).length;

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-pulse">
          <div className="bg-gradient-to-r from-purple-600 to-indigo-600 h-24" />
          <div className="grid grid-cols-4 divide-x divide-slate-100 border-t border-slate-100">
            {[1, 2, 3, 4].map(i => <div key={i} className="px-4 py-3 h-14" />)}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="px-5 py-4 border-b border-slate-100 animate-pulse flex gap-3">
              <div className="h-4 bg-slate-100 rounded w-16 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 bg-slate-100 rounded w-1/2" />
                <div className="h-3 bg-slate-100 rounded w-1/3" />
              </div>
              <div className="h-8 bg-slate-100 rounded w-32 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* ── Header Card ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-5 relative overflow-hidden">
          <div className="absolute inset-0 bg-black/10" />
          <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-white/10 text-purple-100 border border-white/20">
                  <Filter size={10} />
                  Exclusion Rules
                </span>
              </div>
              <h1 className="text-xl font-bold text-white">Exclusion Rules Management</h1>
              <p className="text-sm text-purple-100 mt-0.5">Configure seat exclusions for all events</p>
            </div>
            <div className="sm:w-80">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/60" size={14} />
                <input
                  type="text"
                  placeholder="Search events by name or venue…"
                  value={searchTerm}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm bg-white/10 border border-white/20 rounded-lg placeholder-white/50 text-white focus:ring-2 focus:ring-white/40 focus:border-white/40 transition-all font-medium"
                />
              </div>
              {totalEvents > 0 && (
                <p className="text-[11px] text-purple-200 mt-1 text-right">
                  Showing {startIndex}–{endIndex} of {totalEvents} events
                  {totalPages > 1 && <span className="ml-1">(Page {currentPage} of {totalPages})</span>}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 bg-slate-50/80 border-t border-slate-100 divide-x divide-slate-100">
          <div className="px-4 py-3">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Events</p>
            <p className="text-xl font-bold tabular-nums text-slate-700">{events.length}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">With Exclusions</p>
            <p className="text-xl font-bold tabular-nums text-purple-600">{activeRules}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Section Rules</p>
            <p className="text-xl font-bold tabular-nums text-orange-600">{sectionRules}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Outlier Detection</p>
            <p className="text-xl font-bold tabular-nums text-green-600">{outlierCount}</p>
          </div>
        </div>
      </div>

      {/* ── Events Table ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

        {/* Table header */}
        <div className="hidden lg:grid grid-cols-[1fr_110px_110px_80px_200px_130px] gap-3 px-5 py-2.5 bg-slate-50 border-b border-slate-200">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Event</p>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Standard</p>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Resale</p>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Markup</p>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Exclusions</p>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Actions</p>
        </div>

        {events.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center mx-auto mb-3">
              <Filter size={18} className="text-slate-400" />
            </div>
            <p className="text-sm font-semibold text-slate-600 mb-1">No Events Found</p>
            <p className="text-xs text-slate-400">Try adjusting your search terms.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {events.map((event) => {
              const rule = getRule(event._id);
              const excl = getExclusionSummary(rule);
              const isActive = !event.Skip_Scraping;
              const pct = event.priceIncreasePercentage ?? 25;
              const stdAdj = event.standardMarkupAdjustment ?? 0;
              const resAdj = event.resaleMarkupAdjustment ?? 0;
              const includeStd = event.includeStandardSeats !== false;
              const includeRes = event.includeResaleSeats !== false;
              const stdQty = event.standardQty ?? 0;
              const resQty = event.resaleQty ?? 0;
              const stdRows = event.standardRows ?? 0;
              const resRows = event.resaleRows ?? 0;

              return (
                <div
                  key={event._id}
                  onClick={() => router.push(`/dashboard/events/${event._id}/exclusions`)}
                  className="px-5 py-3.5 hover:bg-purple-50/40 transition-colors group cursor-pointer"
                >
                  {/* Desktop: grid layout */}
                  <div className="hidden lg:grid grid-cols-[1fr_110px_110px_80px_200px_130px] gap-3 items-center">

                    {/* Event info */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${
                          isActive ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-100 text-slate-400 border-slate-200'
                        }`}>
                          <Activity size={8} />
                          {isActive ? 'Active' : 'Paused'}
                        </span>
                        <p className="text-sm font-semibold text-slate-800 truncate group-hover:text-purple-700 transition-colors">
                          {event.Event_Name}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-slate-500">
                        {event.Venue && (
                          <span className="flex items-center gap-1">
                            <MapPin size={10} className="text-slate-400" />
                            {event.Venue}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar size={10} className="text-slate-400" />
                          {fmt(event.Event_DateTime, { month: 'short', day: 'numeric', year: 'numeric' })}
                          <span className="text-slate-300">·</span>
                          {fmt(event.Event_DateTime, { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {event.URL && (
                          <a href={event.URL} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-0.5 text-blue-500 hover:text-blue-700 transition-colors"
                            onClick={e => { e.stopPropagation(); }}>
                            <Ticket size={9} />
                            TM
                            <ExternalLink size={8} />
                          </a>
                        )}
                        {event.Last_Updated && (
                          <span className="text-slate-400">updated {timeAgo(event.Last_Updated)}</span>
                        )}
                      </div>
                    </div>

                    {/* Standard */}
                    <div className={`text-right ${!includeStd ? 'opacity-40' : ''}`}>
                      <div className="flex items-center justify-end gap-1 mb-0.5">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          includeStd ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-400'
                        }`}>S</span>
                      </div>
                      <p className={`text-sm font-bold tabular-nums ${includeStd ? 'text-blue-700' : 'text-slate-400'}`}>
                        {stdQty.toLocaleString()}
                      </p>
                      <p className="text-[10px] text-slate-400">{stdRows} rows</p>
                    </div>

                    {/* Resale */}
                    <div className={`text-right ${!includeRes ? 'opacity-40' : ''}`}>
                      <div className="flex items-center justify-end gap-1 mb-0.5">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          includeRes ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-400'
                        }`}>R</span>
                      </div>
                      <p className={`text-sm font-bold tabular-nums ${includeRes ? 'text-red-700' : 'text-slate-400'}`}>
                        {resQty.toLocaleString()}
                      </p>
                      <p className="text-[10px] text-slate-400">{resRows} rows</p>
                    </div>

                    {/* Markup */}
                    <div className="text-right">
                      <div className="flex items-center justify-end gap-1 mb-0.5">
                        <TrendingUp size={10} className="text-slate-400" />
                      </div>
                      <p className={`text-sm font-bold tabular-nums ${
                        pct > 0 ? 'text-rose-600' : pct < 0 ? 'text-sky-600' : 'text-slate-600'
                      }`}>
                        {pct > 0 ? '+' : ''}{pct}%
                      </p>
                      <div className="flex justify-end gap-1 mt-0.5">
                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded tabular-nums ${
                          stdAdj !== 0 ? 'bg-orange-50 text-orange-600' : 'bg-slate-100 text-slate-400'
                        }`}>S {pct + stdAdj}%</span>
                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded tabular-nums ${
                          resAdj !== 0 ? 'bg-orange-50 text-orange-600' : 'bg-slate-100 text-slate-400'
                        }`}>R {pct + resAdj}%</span>
                      </div>
                    </div>

                    {/* Exclusion summary */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 mb-1">
                        {excl.hasRule ? (
                          <Filter size={10} className="text-purple-500 shrink-0" />
                        ) : (
                          <span className="w-2.5 h-2.5 rounded-full bg-slate-200 shrink-0" />
                        )}
                        <span className={`text-xs font-semibold truncate ${excl.color}`}>{excl.text}</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {excl.details.slice(0, 2).map((d, i) => (
                          <span key={i} className="text-[10px] font-medium bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded truncate max-w-[90px]">
                            {d}
                          </span>
                        ))}
                        {excl.details.length > 2 && (
                          <span className="text-[10px] text-slate-400">+{excl.details.length - 2}</span>
                        )}
                        {rule && (
                          <span className="text-[10px] text-slate-400 mt-0.5 block w-full">
                            updated {timeAgo(rule.lastUpdated)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-2" onClick={e => e.stopPropagation()}>
                      {event.URL && (
                        <a
                          href={event.URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          title="Open on Ticketmaster"
                        >
                          <Ticket size={14} />
                        </a>
                      )}
                      <Link
                        href={`/dashboard/events/${event._id}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                      >
                        <Eye size={12} />
                        View
                      </Link>
                      <Link
                        href={`/dashboard/events/${event._id}/exclusions`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700 transition-colors shadow-sm"
                      >
                        <Filter size={12} />
                        Configure
                      </Link>
                    </div>
                  </div>

                  {/* Mobile: stacked layout */}
                  <div className="lg:hidden space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${
                            isActive ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-100 text-slate-400 border-slate-200'
                          }`}>
                            <Activity size={8} />
                            {isActive ? 'Active' : 'Paused'}
                          </span>
                          <p className="text-sm font-semibold text-slate-800 truncate">{event.Event_Name}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-slate-500 mt-0.5">
                          {event.Venue && <span className="flex items-center gap-1"><MapPin size={10} />{event.Venue}</span>}
                          <span className="flex items-center gap-1">
                            <Calendar size={10} />
                            {fmt(event.Event_DateTime, { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                        <Link href={`/dashboard/events/${event._id}`}
                          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">
                          <Eye size={11} />View
                        </Link>
                        <Link href={`/dashboard/events/${event._id}/exclusions`}
                          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-purple-600 to-indigo-600 text-white">
                          <Filter size={11} />Configure
                        </Link>
                      </div>
                    </div>

                    {/* Mobile data row */}
                    <div className="flex items-center gap-4 text-[11px]">
                      <span className={`flex items-center gap-1 font-semibold ${includeStd ? 'text-blue-600' : 'text-slate-400'}`}>
                        <Package size={10} />S: {stdQty.toLocaleString()} ({stdRows}r)
                      </span>
                      <span className={`flex items-center gap-1 font-semibold ${includeRes ? 'text-red-600' : 'text-slate-400'}`}>
                        <Package size={10} />R: {resQty.toLocaleString()} ({resRows}r)
                      </span>
                      <span className={`flex items-center gap-1 font-semibold ${pct > 0 ? 'text-rose-600' : 'text-slate-600'}`}>
                        <TrendingUp size={10} />{pct > 0 ? '+' : ''}{pct}%
                      </span>
                    </div>

                    <div className={`flex items-center gap-1 text-xs font-semibold ${excl.color}`}>
                      {excl.hasRule ? <Filter size={10} /> : null}
                      {excl.text}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
            <p className="text-[11px] text-slate-400 font-medium">
              {startIndex}–{endIndex} of {totalEvents} events
            </p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="text-xs font-medium text-slate-500 px-2">{currentPage} / {totalPages}</span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
