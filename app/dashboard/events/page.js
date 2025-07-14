"use client"
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { getAllEvents, updateEvent, updateAllEvents, deleteEvent } from '@/actions/eventActions';
import { Calendar, Plus, ChevronLeft, ChevronRight, RefreshCw, Search, X, SlidersHorizontal } from 'lucide-react';
import EventsTableModern from './EventsTableModern.jsx';

export default function EventsPage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [loadingSeatCounts] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [showFilters, setShowFilters] = useState(false);
  
  // Advanced filter states
  const [filters, setFilters] = useState({
    dateFrom: '',
    dateTo: '',
    venue: '',
    seatRange: {
      min: '',
      max: ''
    },
    scrapingStatus: 'all', // 'all', 'active', 'inactive'
    createdDateFrom: '',
    createdDateTo: '',
    hasAvailableSeats: 'all', // 'all', 'yes', 'no'
    sortBy: 'newest', // 'newest', 'oldest', 'name', 'date', 'seats'
  });
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [eventsPerPage, setEventsPerPage] = useState(25);

  // Function to fetch events
  const fetchEvents = async (isRefresh = false) => {
    try {
      if (!isRefresh) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      const data = await getAllEvents();
      if (Array.isArray(data)) {
        setEvents(data);
        if (isRefresh) {
          setLastRefresh(new Date());
        }
      } else {
        console.error('Error fetching events:', data.error);
      }
    } catch (err) {
      console.error('Failed to fetch events:', err);
    } finally {
      if (!isRefresh) {
        setLoading(false);
      } else {
        setRefreshing(false);
      }
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchEvents();
  }, []);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchEvents(true);
    }, 15000); // 15 seconds

    return () => clearInterval(interval);
  }, []);

  // Advanced filter function
  const getFilteredAndSortedEvents = () => {
    let filtered = events.filter(event => {
      // Text search
      const matchesSearch = !searchTerm || 
        event.Event_Name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
        event.Venue?.toLowerCase().includes(searchTerm.toLowerCase());
      
      // Date range filter (event date)
      const eventDate = new Date(event.Event_DateTime);
      const matchesDateRange = (!filters.dateFrom || eventDate >= new Date(filters.dateFrom)) &&
                              (!filters.dateTo || eventDate <= new Date(filters.dateTo + 'T23:59:59'));
      
      // Venue filter
      const matchesVenue = !filters.venue || 
        event.Venue?.toLowerCase().includes(filters.venue.toLowerCase());
      
      // Seat range filter
      const eventSeats = event.Available_Seats || 0;
      const matchesSeatRange = (!filters.seatRange.min || eventSeats >= parseInt(filters.seatRange.min)) &&
                              (!filters.seatRange.max || eventSeats <= parseInt(filters.seatRange.max));
      
      // Scraping status filter
      const matchesScrapingStatus = filters.scrapingStatus === 'all' ||
        (filters.scrapingStatus === 'active' && !event.Skip_Scraping) ||
        (filters.scrapingStatus === 'inactive' && event.Skip_Scraping);
      
      // Created date range filter
      const createdDate = new Date(event.createdAt);
      const matchesCreatedRange = (!filters.createdDateFrom || createdDate >= new Date(filters.createdDateFrom)) &&
                                 (!filters.createdDateTo || createdDate <= new Date(filters.createdDateTo + 'T23:59:59'));
      
      // Available seats filter
      const matchesAvailableSeats = filters.hasAvailableSeats === 'all' ||
        (filters.hasAvailableSeats === 'yes' && eventSeats > 0) ||
        (filters.hasAvailableSeats === 'no' && eventSeats === 0);
      
      return matchesSearch && matchesDateRange && matchesVenue && 
             matchesSeatRange && matchesScrapingStatus && matchesCreatedRange && 
             matchesAvailableSeats;
    });

    // Sort the filtered results
    filtered.sort((a, b) => {
      switch (filters.sortBy) {
        case 'oldest':
          return new Date(a.createdAt) - new Date(b.createdAt);
        case 'newest':
          return new Date(b.createdAt) - new Date(a.createdAt);
        case 'name':
          return (a.Event_Name || '').localeCompare(b.Event_Name || '');
        case 'date':
          return new Date(a.Event_DateTime) - new Date(b.Event_DateTime);
        case 'seats':
          return (b.Available_Seats || 0) - (a.Available_Seats || 0);
        default:
          return new Date(b.createdAt) - new Date(a.createdAt);
      }
    });

    return filtered;
  };

  const filteredEvents = getFilteredAndSortedEvents();

  // Pagination calculations
  const totalPages = Math.ceil(filteredEvents.length / eventsPerPage);
  const paginatedEvents = filteredEvents.slice((currentPage - 1) * eventsPerPage, currentPage * eventsPerPage);

  // Toggle Skip_Scraping for an event
  const toggleScraping = async (id, skip) => {
    try {
      const result = await updateEvent(id, { Skip_Scraping: !skip });
      if (result.error) {
        console.error('Failed to toggle scraping:', result.error);
        return;
      }
      
      setEvents(prev => prev.map(e => e._id === id ? { ...e, Skip_Scraping: !skip } : e));
      
      // Log seat deletion if it occurred
      if (result.deletedSeatGroups > 0) {
        console.log(`Scraping stopped for event. Deleted ${result.deletedSeatGroups} seat groups.`);
      }
    } catch (err) {
      console.error('Failed to toggle scraping:', err);
    }
  };

  // Determine if all filtered events are active
  const activeCount = filteredEvents.filter(e => !e.Skip_Scraping).length;
  const totalCount = filteredEvents.length;
  
  const allActive = filteredEvents.length > 0 && filteredEvents.every(e => !e.Skip_Scraping);

  // Toggle scraping state for ALL filtered events
  const toggleScrapingAll = async () => {
    try {
      // If all events are active (not skipping), then stop all (set to true)
      // If not all events are active, then start all (set to false)
      const newStatus = allActive;
      
      const result = await updateAllEvents(newStatus);
      
      if (result.success) {
        // Refresh events to reflect the changes
        await fetchEvents(true);
        
        // Show more detailed message including seat deletion info
        let message = `Successfully ${newStatus ? 'stopped' : 'started'} scraping for all events`;
        if (result.deletedSeatGroups > 0) {
          message += `. Deleted ${result.deletedSeatGroups} seat groups.`;
        }
        console.log(message);
      } else {
        console.error('Failed to update events:', result.error);
      }
    } catch (error) {
      console.error('Error toggling scraping for all events:', error);
    }
  };

  // Pagination helpers
  const goToPage = (page) => {
    setCurrentPage(page);
  };

  const goToPrevPage = () => {
    setCurrentPage(prev => Math.max(1, prev - 1));
  };

  const goToNextPage = () => {
    setCurrentPage(prev => Math.min(totalPages, prev + 1));
  };

  // Delete event with confirmation
  const handleDeleteEvent = async (eventId, eventName) => {
    const isConfirmed = window.confirm(
      `Are you sure you want to delete the event "${eventName}"?\n\nThis action will also delete all associated inventory seats and consecutive seat groups.\n\nThis action cannot be undone.`
    );
    
    if (isConfirmed) {
      try {
        const result = await deleteEvent(eventId);
        
        if (result.success) {
          // Remove the deleted event from the state
          setEvents(prev => prev.filter(event => event._id !== eventId));
          
          // Adjust current page if necessary
          const newTotalPages = Math.ceil((events.length - 1) / eventsPerPage);
          if (currentPage > newTotalPages && newTotalPages > 0) {
            setCurrentPage(newTotalPages);
          }
          
          // Show success message with seat group deletion info
          console.log(`Event "${eventName}" deleted successfully. Also deleted ${result.deletedSeatGroups || 0} associated seat groups.`);
        } else {
          console.error('Failed to delete event:', result.error || result.message);
        }
      } catch (error) {
        console.error('Error deleting event:', error);
      }
    }
  };

  // Reset to first page when search or filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filters]);

  // Filter helper functions
  const updateFilter = (key, value) => {
    setFilters(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const updateNestedFilter = (parentKey, childKey, value) => {
    setFilters(prev => ({
      ...prev,
      [parentKey]: {
        ...prev[parentKey],
        [childKey]: value
      }
    }));
  };

  const clearAllFilters = () => {
    setSearchTerm('');
    setFilters({
      dateFrom: '',
      dateTo: '',
      venue: '',
      seatRange: { min: '', max: '' },
      scrapingStatus: 'all',
      createdDateFrom: '',
      createdDateTo: '',
      hasAvailableSeats: 'all',
      sortBy: 'newest',
    });
  };

  const hasActiveFilters = () => {
    return searchTerm || 
           filters.dateFrom || filters.dateTo || filters.venue ||
           filters.seatRange.min || filters.seatRange.max ||
           filters.scrapingStatus !== 'all' ||
           filters.createdDateFrom || filters.createdDateTo ||
           filters.hasAvailableSeats !== 'all' ||
           filters.sortBy !== 'newest';
  };

 
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-bold">Events</h1>
            <span className="text-sm text-gray-600">{activeCount} active / {totalCount} total</span>
            <span className="text-xs text-gray-500 flex items-center gap-1">
              Last updated: {lastRefresh.toLocaleTimeString()}
              {refreshing && (
                <>
                  <span className="text-blue-500">•</span>
                  <span className="text-blue-500">Refreshing...</span>
                </>
              )}
            </span>
          </div>
        <div className="flex gap-2">
          <button
            onClick={() => fetchEvents(true)}
            disabled={refreshing}
            className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <Link 
            href="/dashboard/list-event"
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <Plus className="w-4 h-4 mr-1" />
            Add Event
          </Link>
          <button
            onClick={toggleScrapingAll}
            className={`inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white ${allActive ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500' : 'bg-green-600 hover:bg-green-700 focus:ring-green-500'}`}
          >
            {allActive ? 'Stop Scraping All' : 'Start Scraping All'}
          </button>
        </div>
       
      </div>

      {/* Modern Search and Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        {/* Search Bar */}
        <div className="flex flex-col lg:flex-row gap-4 items-center">
          <div className="flex-1 relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              placeholder="Search events by name or venue..."
              className="block w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          <div className="flex items-center gap-3">
            {/* Sort Dropdown */}
            <select
              value={filters.sortBy}
              onChange={(e) => updateFilter('sortBy', e.target.value)}
              className="border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="name">Name A-Z</option>
              <option value="date">Event Date</option>
              <option value="seats">Most Seats</option>
            </select>
            
            {/* Filter Toggle Button */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`inline-flex items-center px-4 py-3 rounded-lg border transition-colors ${
                showFilters || hasActiveFilters()
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <SlidersHorizontal className="w-5 h-5 mr-2" />
              Filters
              {hasActiveFilters() && (
                <span className="ml-2 bg-blue-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  !
                </span>
              )}
            </button>
            
            {/* Clear Filters */}
            {hasActiveFilters() && (
              <button
                onClick={clearAllFilters}
                className="inline-flex items-center px-3 py-3 text-gray-500 hover:text-gray-700 transition-colors"
                title="Clear all filters"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Advanced Filters Panel */}
        {showFilters && (
          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {/* Event Date Range */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Event Date Range</label>
                <div className="space-y-2">
                  <input
                    type="date"
                    placeholder="From date"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                    value={filters.dateFrom}
                    onChange={(e) => updateFilter('dateFrom', e.target.value)}
                  />
                  <input
                    type="date"
                    placeholder="To date"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                    value={filters.dateTo}
                    onChange={(e) => updateFilter('dateTo', e.target.value)}
                  />
                </div>
              </div>

              {/* Created Date Range */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Created Date Range</label>
                <div className="space-y-2">
                  <input
                    type="date"
                    placeholder="From date"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                    value={filters.createdDateFrom}
                    onChange={(e) => updateFilter('createdDateFrom', e.target.value)}
                  />
                  <input
                    type="date"
                    placeholder="To date"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                    value={filters.createdDateTo}
                    onChange={(e) => updateFilter('createdDateTo', e.target.value)}
                  />
                </div>
              </div>

              {/* Venue Filter */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Venue</label>
                <input
                  type="text"
                  placeholder="Filter by venue"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  value={filters.venue}
                  onChange={(e) => updateFilter('venue', e.target.value)}
                />
              </div>

              {/* Seat Range */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Seat Range</label>
                <div className="space-y-2">
                  <input
                    type="number"
                    placeholder="Min seats"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                    value={filters.seatRange.min}
                    onChange={(e) => updateNestedFilter('seatRange', 'min', e.target.value)}
                  />
                  <input
                    type="number"
                    placeholder="Max seats"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                    value={filters.seatRange.max}
                    onChange={(e) => updateNestedFilter('seatRange', 'max', e.target.value)}
                  />
                </div>
              </div>

              {/* Scraping Status */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Scraping Status</label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  value={filters.scrapingStatus}
                  onChange={(e) => updateFilter('scrapingStatus', e.target.value)}
                >
                  <option value="all">All Events</option>
                  <option value="active">Active Scraping</option>
                  <option value="inactive">Inactive Scraping</option>
                </select>
              </div>

              {/* Available Seats Status */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Available Seats</label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  value={filters.hasAvailableSeats}
                  onChange={(e) => updateFilter('hasAvailableSeats', e.target.value)}
                >
                  <option value="all">All Events</option>
                  <option value="yes">Has Seats (&gt;0)</option>
                  <option value="no">No Seats (0)</option>
                </select>
              </div>
            </div>

            {/* Filter Summary */}
            {hasActiveFilters() && (
              <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-blue-700">
                    {filteredEvents.length} events match your current filters
                  </span>
                  <button
                    onClick={clearAllFilters}
                    className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Clear all filters
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Events Table */}
      <div className="bg-white shadow-md rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : paginatedEvents.length === 0 ? (
          <div className="text-center p-10">
            <Calendar className="h-12 w-12 mx-auto text-gray-400" />
            <h3 className="mt-2 text-sm font-semibold text-gray-900">No events found</h3>
            <p className="mt-1 text-sm text-gray-500">
              {searchTerm ? 'Try adjusting your search criteria.' : 'Get started by creating a new event.'}
            </p>
            <div className="mt-6">
              <Link 
                href="/dashboard/list-event"
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <Plus className="w-4 h-4 mr-1" />
                New Event
              </Link>
            </div>
          </div>
        ) : (
          <>
            <EventsTableModern 
              data={paginatedEvents} 
              toggleScraping={toggleScraping}
              loadingSeatCounts={loadingSeatCounts}
              onDeleteEvent={handleDeleteEvent}
            />
            
            {/* Enhanced Pagination */}
            {totalPages > 1 && (
              <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
                <div className="flex-1 flex justify-between sm:hidden">
                  <button
                    onClick={goToPrevPage}
                    disabled={currentPage === 1}
                    className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={goToNextPage}
                    disabled={currentPage === totalPages}
                    className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
                <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                  <div className="flex items-center space-x-4">
                    <p className="text-sm text-gray-700">
                      Showing <span className="font-medium">{(currentPage - 1) * eventsPerPage + 1}</span> to{' '}
                      <span className="font-medium">
                        {Math.min(currentPage * eventsPerPage, filteredEvents.length)}
                      </span>{' '}
                      of <span className="font-medium">{filteredEvents.length}</span> results
                    </p>
                    <div className="flex items-center space-x-2">
                      <label htmlFor="perPage" className="text-sm text-gray-700">Per page:</label>
                      <select
                        id="perPage"
                        value={eventsPerPage}
                        onChange={(e) => {
                          setEventsPerPage(Number(e.target.value));
                          setCurrentPage(1);
                        }}
                        className="border border-gray-300 rounded-md text-sm px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value={10}>10</option>
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                      <button
                        onClick={goToPrevPage}
                        disabled={currentPage === 1}
                        className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      
                      {/* Page numbers */}
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let pageNum;
                        if (totalPages <= 5) {
                          pageNum = i + 1;
                        } else if (currentPage <= 3) {
                          pageNum = i + 1;
                        } else if (currentPage >= totalPages - 2) {
                          pageNum = totalPages - 4 + i;
                        } else {
                          pageNum = currentPage - 2 + i;
                        }
                        
                        return (
                          <button
                            key={pageNum}
                            onClick={() => goToPage(pageNum)}
                            className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                              currentPage === pageNum
                                ? 'z-10 bg-blue-50 border-blue-500 text-blue-600'
                                : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                            }`}
                          >
                            {pageNum}
                          </button>
                        );
                      })}
                      
                      <button
                        onClick={goToNextPage}
                        disabled={currentPage === totalPages}
                        className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                    </nav>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
