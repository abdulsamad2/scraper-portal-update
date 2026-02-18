'use client';
import React, { useState, useTransition, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, Filter, Calendar, MapPin, Users, RefreshCw, ChevronDown } from 'lucide-react';

const AUTO_REFRESH_INTERVAL = 30; // seconds

// Module-level: survives component remounts caused by Suspense re-renders on filter/search navigation.
let _lastRefreshAt = Date.now();
function getRemaining() {
  return Math.max(0, AUTO_REFRESH_INTERVAL - Math.floor((Date.now() - _lastRefreshAt) / 1000));
}

interface EventsTableControlsProps {
  currentPage: number;
  totalPages: number;
  totalEvents: number;
  eventsPerPage: number;
  searchTerm: string;
  activeCount: number;
  grandTotal: number;
  filters: {
    dateFrom?: string;
    dateTo?: string;
    venue?: string;
    scrapingStatus?: string;
    sortBy?: string;
    seatRange?: {
      min?: string;
      max?: string;
    };
  };
}

export default function EventsTableControls({
  currentPage,
  totalPages,
  totalEvents,
  eventsPerPage,
  searchTerm,
  filters,
  activeCount,
  grandTotal,
}: EventsTableControlsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  // Initialise from module-level timestamp so remounts pick up correct remaining time
  const [countdown, setCountdown] = useState(getRemaining);

  // Local state for form inputs
  const [localSearchTerm, setLocalSearchTerm] = useState(searchTerm);
  const [localFilters, setLocalFilters] = useState(filters);

  // Manual refresh handler
  const handleRefresh = useCallback(() => {
    _lastRefreshAt = Date.now();
    setCountdown(AUTO_REFRESH_INTERVAL);
    startTransition(() => router.refresh());
  }, [router]);

  // Auto-refresh tick — recalculates from module-level timestamp so it survives remounts
  useEffect(() => {
    const tick = setInterval(() => {
      const remaining = getRemaining();
      setCountdown(remaining);
      if (remaining <= 0) {
        _lastRefreshAt = Date.now();
        setCountdown(AUTO_REFRESH_INTERVAL);
        startTransition(() => router.refresh());
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [router]);

  // Apply filters to URL
  const applyFilters = (newFilters: Record<string, string>) => {
    startTransition(() => {
      const params = new URLSearchParams(searchParams);
      
      // Remove page when filtering
      params.delete('page');
      
      // Apply new filters
      Object.entries(newFilters).forEach(([key, value]) => {
        if (value && value !== '') {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      });
      
      router.push(`/dashboard/events?${params.toString()}`);
    });
  };

  // Handle search with debounce
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = (value: string) => {
    setLocalSearchTerm(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      applyFilters({ search: value });
    }, 350);
  };

  // Handle filter changes
  const handleFilterChange = (filterName: string, value: string) => {
    const updatedFilters = { ...localFilters, [filterName]: value };
    setLocalFilters(updatedFilters);
    applyFilters({ [filterName]: value });
  };

  // Handle seat range changes
  const handleSeatRangeChange = (type: 'min' | 'max', value: string) => {
    const updatedFilters = {
      ...localFilters,
      seatRange: {
        ...localFilters.seatRange,
        [type]: value
      }
    };
    setLocalFilters(updatedFilters);
    applyFilters({ [`seat${type.charAt(0).toUpperCase() + type.slice(1)}`]: value });
  };

  // Clear all filters
  const clearFilters = () => {
    setLocalSearchTerm('');
    setLocalFilters({});
    startTransition(() => {
      router.push('/dashboard/events');
    });
  };

  // Statistics display
  const startIndex = (currentPage - 1) * eventsPerPage + 1;
  const endIndex = Math.min(currentPage * eventsPerPage, totalEvents);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 space-y-3">
      {/* Header summary */}
      <div className="flex items-center justify-between gap-3 pb-2.5 border-b border-gray-100">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-bold text-slate-800">Events</h1>
          <span className="text-sm text-slate-500">
            <span className="font-semibold text-green-600" style={{ fontVariantNumeric: 'tabular-nums' }}>{activeCount.toLocaleString()}</span>
            <span className="text-slate-400"> active</span>
            <span className="text-slate-300 mx-1">/</span>
            <span className="font-semibold text-slate-700" style={{ fontVariantNumeric: 'tabular-nums' }}>{grandTotal.toLocaleString()}</span>
            <span className="text-slate-400"> total</span>
          </span>
        </div>
        {/* Refresh button with countdown */}
        <button
          onClick={handleRefresh}
          disabled={isPending}
          aria-label={isPending ? 'Refreshing…' : `Refresh (auto in ${countdown}s)`}
          className="px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-[background-color,opacity] flex items-center gap-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
          style={{ touchAction: 'manipulation' }}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isPending ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span className="hidden sm:inline">Refresh</span>
          {!isPending && (
            <span
              className={`text-[11px] font-mono tabular-nums leading-none px-1.5 py-0.5 rounded ${
                countdown <= 5 ? 'bg-blue-400 text-white' : 'bg-blue-500/60 text-blue-100'
              }`}
              aria-hidden="true"
            >
              {countdown}s
            </span>
          )}
        </button>
      </div>

      {/* Main Search and Quick Actions */}
      <div className="flex flex-col lg:flex-row gap-2">
        {/* Search Bar */}
        <div className="flex-1 relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-gray-400" />
          </div>
          <input
            type="text"
            className="block w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-[border-color,box-shadow]"
            placeholder="Search events by name…"
            value={localSearchTerm}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>

        {/* Quick Actions */}
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
            className={`px-3 py-2 rounded-lg border text-sm transition-[background-color,color,border-color] flex items-center gap-1.5 ${
              isAdvancedOpen
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Filter className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Filters</span>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${isAdvancedOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Advanced Filters */}
      {isAdvancedOpen && (
        <div className="border-t border-gray-200 pt-3">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Date Range */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
                <Calendar className="inline h-3.5 w-3.5 mr-1" aria-hidden="true" />
                Date Range
              </label>
              <div className="space-y-1.5">
                <input
                  type="date"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={localFilters.dateFrom || ''}
                  onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
                />
                <input
                  type="date"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={localFilters.dateTo || ''}
                  onChange={(e) => handleFilterChange('dateTo', e.target.value)}
                />
              </div>
            </div>

            {/* Venue */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
                <MapPin className="inline h-3.5 w-3.5 mr-1" aria-hidden="true" />
                Venue
              </label>
              <input
                type="text"
                className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Filter by venue…"
                value={localFilters.venue || ''}
                onChange={(e) => handleFilterChange('venue', e.target.value)}
              />
            </div>

            {/* Scraping Status */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Status
              </label>
              <select
                className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                value={localFilters.scrapingStatus || ''}
                onChange={(e) => handleFilterChange('scrapingStatus', e.target.value)}
              >
                <option value="">All Status</option>
                <option value="active">Active (scraping on)</option>
                <option value="inactive">Inactive (scraping off)</option>
              </select>
            </div>

            {/* Sort Order */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Sort By
              </label>
              <select
                className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                value={localFilters.sortBy || 'updated'}
                onChange={(e) => handleFilterChange('sortBy', e.target.value)}
              >
                <option value="updated">Last Updated</option>
                <option value="date">Event Date</option>
                <option value="name">Event Name</option>
                <option value="seats">Seat Count</option>
                <option value="newest">Newest Created</option>
                <option value="oldest">Oldest Created</option>
              </select>
            </div>
          </div>

          {/* Seat Range */}
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
                <Users className="inline h-3.5 w-3.5 mr-1" aria-hidden="true" />
                Seat Range
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  className="px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Min seats"
                  value={localFilters.seatRange?.min || ''}
                  onChange={(e) => handleSeatRangeChange('min', e.target.value)}
                />
                <input
                  type="number"
                  className="px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Max seats"
                  value={localFilters.seatRange?.max || ''}
                  onChange={(e) => handleSeatRangeChange('max', e.target.value)}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-end">
              <button
                onClick={clearFilters}
                className="w-full px-3 py-1.5 text-sm text-gray-600 bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200 transition-[background-color]"
              >
                Clear All Filters
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Results Summary */}
      <div className="border-t border-gray-200 pt-2.5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
        <div className="text-xs text-gray-500">
          Showing <span className="font-semibold text-gray-700">{startIndex}</span>–<span className="font-semibold text-gray-700">{endIndex}</span> of{' '}
          <span className="font-semibold text-gray-700">{totalEvents}</span> events
          {isPending && (
            <span className="ml-2 inline-flex items-center gap-1 text-blue-600">
              <RefreshCw size={11} className="animate-spin" aria-hidden="true" />
              Refreshing…
            </span>
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-sm bg-blue-200 border-l-2 border-blue-400"></span>Active &amp; fresh</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-sm bg-amber-100 border-l-2 border-amber-400"></span>Active &amp; stale</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-sm bg-gray-100 border-l-2 border-gray-300"></span>Inactive</span>
        </div>
      </div>
    </div>
  );
}