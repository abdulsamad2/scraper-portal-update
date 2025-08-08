'use client';

import React, { memo, useMemo } from 'react';
import DataTable from 'react-data-table-component';
import Link from 'next/link';
import { Eye, Edit, Trash2, Play, Square, Info, AlertCircle, Calendar, MapPin, Users } from 'lucide-react';

// Modern tooltip header component
const Header = ({ title, description, icon }) => (
  <div className="flex items-center gap-2">
    {icon && <span className="text-slate-500">{icon}</span>}
    <span className="font-semibold text-slate-700">{title}</span>
    {description && (
      <div className="group relative">
        <Info size={14} className="text-slate-400 cursor-help hover:text-slate-600 transition-colors" />
        <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-max max-w-xs -translate-x-1/2 scale-0 transform rounded-lg bg-slate-900 px-3 py-2 text-xs text-white opacity-0 shadow-xl transition-all duration-200 group-hover:scale-100 group-hover:opacity-100">
          {description}
          <div className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-slate-900"></div>
        </div>
      </div>
    )}
  </div>
);

const StatusBadge = ({ active }) => (
  <div className="flex items-center">
    <div className={`w-2 h-2 rounded-full mr-2 ${active ? 'bg-blue-500' : 'bg-slate-400'}`}></div>
    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
      active 
        ? 'bg-blue-50 text-blue-700 border border-blue-200' 
        : 'bg-slate-50 text-slate-700 border border-slate-200'
    }`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  </div>
);

const EventsTableModern = memo(function EventsTableModern({ data, toggleScraping, seatCounts = {}, loadingSeatCounts = false, onDeleteEvent, togglingEvents = new Set() }) {
  // Memoize utility functions to prevent unnecessary re-renders
  const formatDate = useMemo(() => (d) => (d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'), []);
  const formatTime = useMemo(() => (d) => (d ? new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—'), []);
  const timeAgo = useMemo(() => (d) => {
    if (!d) return 'Never';
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }, []);

  const isFresh = useMemo(() => (d) => Date.now() - new Date(d).getTime() < 4 * 60 * 1000, []);

  // Memoize sorted data to prevent unnecessary sorting
  const sortedData = useMemo(() => 
    [...data].sort((a, b) => new Date(b.Last_Updated || b.updatedAt) - new Date(a.Last_Updated || a.updatedAt)),
    [data]
  );

  // Memoize columns to prevent recreation on every render
  const columns = useMemo(() => [
    {
      name: <Header title="Status" description="Current scraping status" />, 
      selector: r => !r.Skip_Scraping, 
      width: '120px',
      cell: r => <StatusBadge active={!r.Skip_Scraping} />,
      sortable: true,
    },
    {
      name: <Header title="Event Details" description="Event name and information" icon={<Calendar size={16} />} />, 
      selector: r => r.Event_Name, 
      grow: 2, 
      sortable: true,
      cell: r => (
        <div className="py-1">
          <Link 
            href={`/dashboard/events/${r._id}`} 
            className="text-slate-900 hover:text-blue-600 font-semibold text-sm transition-colors duration-200 block mb-1"
          >
            {r.Event_Name}
          </Link>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            {r.Venue && (
              <div className="flex items-center gap-1">
                <MapPin size={12} />
                <span>{r.Venue}</span>
              </div>
            )}
            <div className="flex items-center gap-1">
              <span className="text-slate-400">ID:</span>
              <span className="font-mono">{r.mapping_id || '—'}</span>
            </div>
          </div>
        </div>
      ),
    },
    { 
      name: <Header title="Event Date" description="Scheduled event date" icon={<Calendar size={14} />} />, 
      selector: r => r.Event_DateTime, 
      sortable: true, 
      width: '150px',
      cell: r => (
        <div className="text-center">
          <div className="font-semibold text-slate-900 text-sm">
            {formatDate(r.Event_DateTime)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {formatTime(r.Event_DateTime)}
          </div>
        </div>
      )
    },
    { 
      name: <Header title="Rows" description="Available seat count" icon={<Users size={14} />} />, 
      selector: r => seatCounts[r._id] || r.Available_Seats || 0, 
      sortable: true, 
      right: true, 
      width: '100px',
      cell: r => {
        const seatCount = seatCounts[r._id];
        const availableSeats = r.Available_Seats || 0;
        
        if (loadingSeatCounts && seatCount === undefined) {
          return (
            <div className="flex items-center justify-end">
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          );
        }
        
        return (
          <div className="text-right">
            <div className="font-bold text-slate-900 text-lg">
              {(seatCount ?? availableSeats).toLocaleString()}
            </div>
            {seatCount !== undefined && seatCount !== availableSeats && (
              <div className="text-xs text-slate-500">
                DB: {availableSeats.toLocaleString()}
              </div>
            )}
          </div>
        );
      }
    },
    { 
      name: <Header title="Price %" description="Price increase percentage" />, 
      selector: r => r.priceIncreasePercentage, 
      right: true, 
      sortable: true, 
      width: '90px',
      cell: r => {
        const percentage = r.priceIncreasePercentage ?? 0;
        return (
          <div className="text-right">
            <span className={`font-bold text-sm px-2 py-1 rounded-full ${
              percentage > 0 
                ? 'bg-red-50 text-red-700' 
                : percentage < 0 
                  ? 'bg-blue-50 text-blue-700' 
                  : 'bg-slate-50 text-slate-700'
            }`}>
              {percentage > 0 ? '+' : ''}{percentage}%
            </span>
          </div>
        );
      }
    },
    { 
      name: <Header title="Last Updated" description="When data was last refreshed" />, 
      selector: r => r.Last_Updated || r.updatedAt, 
      sortable: true, 
      width: '140px',
      cell: r => {
        const lastUpdated = r.Last_Updated || r.updatedAt;
        const fresh = isFresh(lastUpdated);
        
        return (
          <div className="text-center">
            <div className={`font-semibold text-sm ${fresh ? 'text-blue-700' : 'text-amber-700'}`}>
              {timeAgo(lastUpdated)}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {formatDate(lastUpdated)}
            </div>
            {!fresh && (
              <div className="flex items-center justify-center mt-1">
                <div className="w-1 h-1 bg-amber-500 rounded-full mr-1"></div>
                <span className="text-[10px] text-amber-600 font-medium">Stale</span>
              </div>
            )}
          </div>
        );
      }
    },
    {
      name: <Header title="Actions" />, 
      button: true, 
      width: '160px',
      cell: r => (
        <div className="flex gap-1 justify-end pr-4">
          <Link 
            href={`/dashboard/events/${r._id}/edit`} 
            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors duration-200 hover:shadow-sm" 
            title="Edit Event"
          >
            <Edit size={16} />
          </Link>
          <button
            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors duration-200 hover:shadow-sm"
            title="Delete Event"
            onClick={() => onDeleteEvent && onDeleteEvent(r._id, r.Event_Name)}
          >
            <Trash2 size={16} />
          </button>
          <button
            onClick={() => toggleScraping(r._id, r.Skip_Scraping)}
            disabled={togglingEvents.has(r._id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${
              togglingEvents.has(r._id)
                ? 'bg-gray-400 text-white'
                : r.Skip_Scraping 
                ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white hover:from-blue-600 hover:to-purple-700 shadow-blue-200' 
                : 'bg-red-600 text-white hover:bg-red-700 shadow-red-200'
            }`}
            title={togglingEvents.has(r._id) ? 'Processing...' : (r.Skip_Scraping ? 'Start Scraping' : 'Stop Scraping')}
          >
            {togglingEvents.has(r._id) ? (
              <>
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>...</span>
              </>
            ) : r.Skip_Scraping ? (
              <>
                <Play size={12} />
                <span>Start</span>
              </>
            ) : (
              <>
                <Square size={12} />
                <span>Stop</span>
              </>
            )}
          </button>
        </div>
      ),
      ignoreRowClick: true,
      allowOverflow: true,
    }
  ], [seatCounts, loadingSeatCounts, toggleScraping, onDeleteEvent, formatDate, formatTime, timeAgo, isFresh]);

  // Memoize styles to prevent object recreation
  const styles = useMemo(() => ({
    headRow: {
      style: {
        background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
        fontSize: '12px',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        borderBottom: '3px solid #e2e8f0',
        paddingLeft: '12px',
        paddingRight: '12px',
        minHeight: '48px',
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
      }
    },
    rows: {
      style: {
        minHeight: '56px',
        borderBottom: '1px solid #f1f5f9',
        '&:hover': {
          background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
          transform: 'translateY(-1px)',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
          transition: 'all 0.2s ease-in-out',
        }
      }
    },
    cells: {
      style: {
        fontSize: '14px',
        paddingLeft: '12px',
        paddingRight: '12px',
        paddingTop: '8px',
        paddingBottom: '8px',
        color: '#334155',
      }
    },
  }), []);

  // Memoize conditional row styles
  const conditionalRowStyles = useMemo(() => [
    {
      when: row => !row.Skip_Scraping && isFresh(row.Last_Updated || row.updatedAt),
      style: { 
        backgroundColor: '#dbeafe',
        borderLeft: '4px solid #3b82f6',
        '&:hover': {
          backgroundColor: '#bfdbfe',
        }
      }
    },
    {
      when: row => !row.Skip_Scraping && !isFresh(row.Last_Updated || row.updatedAt),
      style: { 
        backgroundColor: '#fffbeb',
        borderLeft: '4px solid #f59e0b',
        '&:hover': {
          backgroundColor: '#fef3c7',
        }
      }
    },
    {
      when: row => row.Skip_Scraping,
      style: { 
        backgroundColor: '#fafafa',
        borderLeft: '4px solid #64748b',
        opacity: 0.7,
        '&:hover': {
          backgroundColor: '#f5f5f5',
          opacity: 0.9,
        }
      }
    }
  ], [isFresh]);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <DataTable
        columns={columns}
        data={sortedData}
        highlightOnHover
        responsive
        persistTableHead
        customStyles={styles}
        conditionalRowStyles={conditionalRowStyles}
        pagination={false}
        noDataComponent={
          <div className="flex flex-col items-center justify-center p-16">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
              <AlertCircle className="h-8 w-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-700 mb-2">No events found</h3>
            <p className="text-slate-500 text-center max-w-sm">
              There are no events matching your current filters. Try adjusting your search criteria or create a new event.
            </p>
          </div>
        }
      />
    </div>
  );
});

export default EventsTableModern;
