
"use client"
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { getAllEvents, updateEvent, updateAllEvents, deleteEvent } from '@/actions/eventActions';
import { Calendar, Plus, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import EventsTableModern from './EventsTableModern.jsx';

export default function EventsPage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [loadingSeatCounts] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());
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
    }, 60000); // 60 seconds

    return () => clearInterval(interval);
  }, []);

  // Filter events based on search term
  const filteredEvents = events.filter(event => {
    const matchesSearch = event.Event_Name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         event.Venue?.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesSearch;
  });

  // Pagination calculations
  const totalPages = Math.ceil(filteredEvents.length / eventsPerPage);
  const paginatedEvents = filteredEvents.slice((currentPage - 1) * eventsPerPage, currentPage * eventsPerPage);

  // Toggle Skip_Scraping for an event
  const toggleScraping = async (id, skip) => {
    try {
      await updateEvent(id, { Skip_Scraping: !skip });
      setEvents(prev => prev.map(e => e._id === id ? { ...e, Skip_Scraping: !skip } : e));
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
        
        console.log(`Successfully ${newStatus ? 'stopped' : 'started'} scraping for all events`);
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
      `Are you sure you want to delete the event "${eventName}"?\n\nThis action cannot be undone.`
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
          
          console.log('Event deleted successfully');
        } else {
          console.error('Failed to delete event:', result.error || result.message);
          alert('Failed to delete event. Please try again.');
        }
      } catch (error) {
        console.error('Error deleting event:', error);
        alert('An error occurred while deleting the event. Please try again.');
      }
    }
  };

  // Reset to first page when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

 
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

      {/* Search */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1">
          <label htmlFor="search" className="sr-only">Search</label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              id="search"
              className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              placeholder="Search events..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
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
