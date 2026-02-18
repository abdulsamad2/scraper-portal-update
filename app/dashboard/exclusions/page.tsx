'use client';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { 
  Filter, Search, Calendar, 
  MapPin, Users, TrendingUp, AlertTriangle, 
  CheckCircle, X, Eye
} from 'lucide-react';

interface EventData {
  _id: string;
  mapping_id: string;
  Event_Name: string;
  Event_DateTime: string;
  Venue?: string;
  Available_Seats?: number;
  Skip_Scraping?: boolean;
}

interface ExclusionRule {
  _id: string;
  eventId: string;
  eventName: string;
  sectionRowExclusions: Array<{
    section: string;
    excludeEntireSection: boolean;
    excludedRows: string[];
  }>;
  outlierExclusion: {
    enabled: boolean;
    percentageBelowAverage?: number;
    baselineListingsCount?: number;
  };
  isActive: boolean;
  lastUpdated: string;
}

export default function ExclusionRulesPage() {
  const [events, setEvents] = useState<EventData[]>([]);
  const [exclusionRules, setExclusionRules] = useState<ExclusionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalEvents, setTotalEvents] = useState(0);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const eventsPerPage = 100;

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300); // 300ms debounce

    return () => clearTimeout(timer);
  }, [searchTerm]);

  const loadData = useCallback(async (page = 1, search = '') => {
    setLoading(true);
    try {
      // Load events and exclusion rules with pagination
      const [eventsResponse, rulesResponse] = await Promise.all([
        fetch(`/api/events?page=${page}&limit=${eventsPerPage}&search=${encodeURIComponent(search)}`),
        fetch('/api/exclusion-rules')
      ]);

      if (eventsResponse.ok) {
        const eventsData = await eventsResponse.json();
        setEvents(eventsData.events || eventsData); // Handle both paginated and non-paginated responses
        setTotalEvents(eventsData.total || (eventsData.events ? eventsData.events.length : eventsData.length));
      }

      if (rulesResponse.ok) {
        const rulesData = await rulesResponse.json();
        setExclusionRules(rulesData);
      }
    } catch (error) {
      console.error('Error loading data:', error);
      showNotification('error', 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [eventsPerPage]);

  useEffect(() => {
    loadData(currentPage, debouncedSearch);
  }, [loadData, currentPage, debouncedSearch]);

  const showNotification = (type: 'success' | 'error' | 'info', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  // Handle search with debouncing
  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
    setCurrentPage(1); // Reset to first page when searching
  }, []);

  // Calculate pagination values
  const totalPages = Math.ceil(totalEvents / eventsPerPage);
  const startIndex = (currentPage - 1) * eventsPerPage + 1;
  const endIndex = Math.min(currentPage * eventsPerPage, totalEvents);

  const getEventExclusionRule = (eventId: string) => {
    return exclusionRules.find(rule => rule.eventId === eventId && rule.isActive);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getExclusionSummary = (rule: ExclusionRule | undefined) => {
    if (!rule) return { text: 'No exclusions', color: 'text-slate-500', icon: null, details: [] };

    const sectionCount = rule.sectionRowExclusions?.length || 0;
    const outlierEnabled = rule.outlierExclusion?.enabled || false;
    
    // Calculate detailed exclusions
    const details = [];
    let totalRowsExcluded = 0;
    let sectionsFullyExcluded = 0;
    
    if (rule.sectionRowExclusions) {
      for (const exclusion of rule.sectionRowExclusions) {
        if (exclusion.excludeEntireSection) {
          sectionsFullyExcluded++;
          details.push(`${exclusion.section}: Entire section`);
        } else if (exclusion.excludedRows?.length > 0) {
          totalRowsExcluded += exclusion.excludedRows.length;
          details.push(`${exclusion.section}: Rows ${exclusion.excludedRows.join(', ')}`);
        }
      }
    }

    if (sectionCount > 0 && outlierEnabled) {
      const summary = [];
      if (sectionsFullyExcluded > 0) summary.push(`${sectionsFullyExcluded} full section${sectionsFullyExcluded > 1 ? 's' : ''}`);
      if (totalRowsExcluded > 0) summary.push(`${totalRowsExcluded} specific row${totalRowsExcluded > 1 ? 's' : ''}`);
      
      return { 
        text: `${summary.join(' + ')} + outlier detection`, 
        color: 'text-orange-600', 
        icon: <AlertTriangle size={14} />,
        details
      };
    } else if (sectionCount > 0) {
      if (sectionsFullyExcluded > 0 && totalRowsExcluded > 0) {
        return { 
          text: `${sectionsFullyExcluded} full section${sectionsFullyExcluded > 1 ? 's' : ''} + ${totalRowsExcluded} specific row${totalRowsExcluded > 1 ? 's' : ''}`, 
          color: 'text-blue-600', 
          icon: <Filter size={14} />,
          details
        };
      } else if (sectionsFullyExcluded > 0) {
        return { 
          text: `${sectionsFullyExcluded} full section${sectionsFullyExcluded > 1 ? 's' : ''} excluded`, 
          color: 'text-blue-600', 
          icon: <Filter size={14} />,
          details
        };
      } else if (totalRowsExcluded > 0) {
        return { 
          text: `${totalRowsExcluded} specific row${totalRowsExcluded > 1 ? 's' : ''} excluded`, 
          color: 'text-indigo-600', 
          icon: <Filter size={14} />,
          details
        };
      } else {
        return { 
          text: `${sectionCount} section rule${sectionCount > 1 ? 's' : ''} (no exclusions)`, 
          color: 'text-slate-500', 
          icon: <Filter size={14} />,
          details
        };
      }
    } else if (outlierEnabled) {
      return { 
        text: 'Outlier detection only', 
        color: 'text-purple-600', 
        icon: <TrendingUp size={14} />,
        details
      };
    }

    return { text: 'Rules configured but inactive', color: 'text-slate-400', icon: null, details };
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
        <div className="max-w-7xl mx-auto p-8">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-16 w-16 border-4 border-blue-200 border-t-blue-600 mx-auto shadow-lg"></div>
              <p className="mt-6 text-lg font-medium text-slate-700">Loading exclusion rules...</p>
              <p className="mt-2 text-sm text-slate-500">Please wait while we fetch your data</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
      <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
        {/* Fixed Header Section */}
        <div className="sticky top-4 z-10 mb-8">
          <div className="bg-white rounded-3xl shadow-xl border border-slate-200/50 overflow-hidden backdrop-blur-sm">
            <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-8 text-white relative overflow-hidden">
              <div className="absolute inset-0 bg-black/10"></div>
              <div className="relative">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                  <div>
                    <h1 className="text-4xl font-bold mb-3 text-white drop-shadow-sm">Exclusion Rules Management</h1>
                    <p className="text-purple-100 font-medium">Configure and manage seat and price exclusions for all events</p>
                  </div>
                  
                  {/* Integrated Search */}
                  <div className="lg:w-96">
                    <div className="relative">
                      <Search
                        className="absolute left-4 top-1/2 transform -translate-y-1/2 text-white/70"
                        size={20}
                      />
                      <input
                        type="text"
                        placeholder="Search events by name or venue..."
                        value={searchTerm}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 bg-white/10 border border-white/20 rounded-xl placeholder-white/70 text-white focus:ring-2 focus:ring-white/50 focus:border-white/50 transition-all duration-200 font-medium backdrop-blur-sm"
                      />
                    </div>
                    <div className="text-sm font-medium text-purple-100 mt-2 text-right">
                      {totalEvents > 0 ? (
                        <>
                          Showing {startIndex}-{endIndex} of {totalEvents} events
                          {totalPages > 1 && (
                            <span className="ml-2">
                              (Page {currentPage} of {totalPages})
                            </span>
                          )}
                        </>
                      ) : (
                        'No events found'
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200/50 p-6 hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-2">Total Events</p>
                <p className="text-3xl font-bold text-slate-800">
                  {events.length}
                </p>
              </div>
              <div className="bg-blue-100 rounded-2xl p-3">
                <Calendar className="w-8 h-8 text-blue-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-xl border border-slate-200/50 p-6 hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-2">
                  With Exclusions
                </p>
                <p className="text-3xl font-bold text-slate-800">
                  {exclusionRules.filter((rule) => rule.isActive).length}
                </p>
              </div>
              <div className="bg-purple-100 rounded-2xl p-3">
                <AlertTriangle className="w-8 h-8 text-purple-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-xl border border-slate-200/50 p-6 hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-2">
                  Section Rules
                </p>
                <p className="text-3xl font-bold text-slate-800">
                  {exclusionRules.reduce(
                    (sum, rule) => sum + (rule.sectionRowExclusions?.length || 0),
                    0
                  )}
                </p>
              </div>
              <div className="bg-orange-100 rounded-2xl p-3">
                <Users className="w-8 h-8 text-orange-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-xl border border-slate-200/50 p-6 hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-600 uppercase tracking-wider mb-2">
                  Outlier Detection
                </p>
                <p className="text-3xl font-bold text-slate-800">
                  {
                    exclusionRules.filter(
                      (rule) => rule.outlierExclusion?.enabled
                    ).length
                  }
                </p>
              </div>
              <div className="bg-green-100 rounded-2xl p-3">
                <TrendingUp className="w-8 h-8 text-green-600" />
              </div>
            </div>
          </div>
        </div>

        {/* Events List */}
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200/50 overflow-hidden">
          <div className="bg-gradient-to-r from-slate-50 to-slate-100 p-6 border-b border-slate-200">
            <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
              <AlertTriangle className="text-purple-600" size={24} />
              Events & Exclusion Rules
            </h2>
            <p className="text-slate-600 font-medium mt-1">
              Configure exclusion rules for your events
            </p>
          </div>

          {events.length === 0 ? (
            <div className="p-16 text-center">
              <div className="bg-gradient-to-br from-slate-100 to-slate-200 rounded-3xl w-20 h-20 mx-auto mb-6 flex items-center justify-center">
                <AlertTriangle className="w-10 h-10 text-slate-400" />
              </div>
              <h3 className="text-xl font-bold text-slate-600 mb-3">
                No Events Found
              </h3>
              <p className="text-slate-500 font-medium max-w-md mx-auto">
                Try adjusting your search terms or check if events exist in your system.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {events.map((event) => {
                const rule = getEventExclusionRule(event._id);
                const exclusionSummary = getExclusionSummary(rule);

                return (
                  <div
                    key={event._id}
                    className="p-6 hover:bg-gradient-to-r hover:from-slate-50 hover:to-blue-50 transition-all duration-300 group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-3">
                              <h3 className="text-xl font-bold text-slate-800 truncate group-hover:text-purple-700 transition-colors">
                                {event.Event_Name}
                              </h3>
                              <div
                                className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                                  event.Skip_Scraping
                                    ? "bg-red-100 text-red-700 border border-red-200"
                                    : "bg-green-100 text-green-700 border border-green-200"
                                }`}
                              >
                                {event.Skip_Scraping ? "Inactive" : "Active"}
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-6 text-sm text-slate-600 mb-4">
                              {event.Venue && (
                                <div className="flex items-center gap-2">
                                  <div className="bg-blue-100 rounded-lg p-1">
                                    <MapPin size={14} className="text-blue-600" />
                                  </div>
                                  <span className="font-medium">{event.Venue}</span>
                                </div>
                              )}
                              <div className="flex items-center gap-2">
                                <div className="bg-purple-100 rounded-lg p-1">
                                  <Calendar size={14} className="text-purple-600" />
                                </div>
                                <span className="font-medium">{formatDate(event.Event_DateTime)}</span>
                              </div>
                              {event.Available_Seats !== undefined && (
                                <div className="flex items-center gap-2">
                                  <div className="bg-orange-100 rounded-lg p-1">
                                    <Users size={14} className="text-orange-600" />
                                  </div>
                                  <span className="font-medium">{event.Available_Seats} seats</span>
                                </div>
                              )}
                            </div>

                            <div className="space-y-2">
                              <div className="flex items-center gap-3">
                                {exclusionSummary.icon}
                                <span
                                  className={`text-sm font-bold ${exclusionSummary.color}`}
                                >
                                  {exclusionSummary.text}
                                </span>
                              </div>
                              
                              {/* Detailed exclusions breakdown */}
                              {exclusionSummary.details && exclusionSummary.details.length > 0 && (
                                <div className="ml-5 space-y-1">
                                  {exclusionSummary.details.slice(0, 3).map((detail, index) => (
                                    <div key={index} className="text-xs text-slate-500 font-medium bg-slate-100 px-2 py-1 rounded-lg inline-block mr-2 mb-1">
                                      {detail}
                                    </div>
                                  ))}
                                  {exclusionSummary.details.length > 3 && (
                                    <div className="text-xs text-slate-400 font-medium">
                                      +{exclusionSummary.details.length - 3} more exclusion{exclusionSummary.details.length - 3 > 1 ? 's' : ''}
                                    </div>
                                  )}
                                </div>
                              )}
                              
                              {rule && (
                                <span className="text-xs text-slate-500 font-medium">
                                  • Updated {formatDate(rule.lastUpdated)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 ml-6">
                        <Link
                          href={`/dashboard/events/${event._id}`}
                          className="flex items-center gap-2 px-4 py-2 text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 hover:text-slate-800 transition-all duration-200 text-sm font-medium group-hover:shadow-md"
                        >
                          <Eye size={16} />
                          <span>View</span>
                        </Link>

                        <Link
                          href={`/dashboard/events/${event._id}/exclusions`}
                          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl hover:from-purple-700 hover:to-indigo-700 transition-all duration-200 text-sm font-medium shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                        >
                          <AlertTriangle size={16} />
                          <span>Configure</span>
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}