'use client';

import React, { memo, useMemo } from 'react';
import DataTable from 'react-data-table-component';
import Link from 'next/link';
import { Eye, Edit, Trash2, Play, Square, Info, AlertCircle } from 'lucide-react';

// Small tooltip header component
const Header = ({ title, description }) => (
  <div className="flex items-center gap-1">
    <span>{title}</span>
    {description && (
      <div className="group relative">
        <Info size={14} className="text-gray-400 cursor-help" />
        <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 w-max -translate-x-1/2 scale-0 transform rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-all group-hover:scale-100 group-hover:opacity-100">
          {description}
        </div>
      </div>
    )}
  </div>
);

const StatusBadge = ({ active }) => (
  <span className={`rounded-full px-2 py-1 text-xs font-medium ${active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{
    active ? 'Active' : 'Inactive'
  }</span>
);

const EventsTableModern = memo(function EventsTableModern({ data, toggleScraping, seatCounts = {}, loadingSeatCounts = false, onDeleteEvent }) {
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

  const isFresh = useMemo(() => (d) => Date.now() - new Date(d).getTime() < 3 * 60 * 1000, []);

  // Memoize sorted data to prevent unnecessary sorting
  const sortedData = useMemo(() => 
    [...data].sort((a, b) => new Date(b.Last_Updated || b.updatedAt) - new Date(a.Last_Updated || a.updatedAt)),
    [data]
  );

  // Memoize columns to prevent recreation on every render
  const columns = useMemo(() => [
    {
      name: <Header title="Status" description="Scraping status" />, selector: r => !r.Skip_Scraping, width: '120px',
      cell: r => <StatusBadge active={!r.Skip_Scraping} />,
      sortable: true,
    },
    {
      name: <Header title="Event" description="Event name" />, selector: r => r.Event_Name, grow: 2, sortable: true,
      cell: r => (
        <div className="flex flex-col">
          <Link href={`/dashboard/events/${r._id}`} className="text-blue-600 hover:underline font-medium">{r.Event_Name}</Link>
          <span className="text-xs text-gray-500">Mapping: {r.mapping_id || '—'}</span>
        </div>
      ),
    },
    { name: <Header title="Event Date" description="Date" />, selector: r => r.Event_DateTime, sortable: true, format: r=>formatDate(r.Event_DateTime), width:'170px' },
    { name: <Header title="In Hand" description="In hand date" />, selector: r => r.inHandDate, sortable: true, format: r=>formatDate(r.inHandDate), width:'170px' },
    { name: <Header title="Seats" description="Total available seats" />, selector: r => seatCounts[r._id] || r.Available_Seats || 0, sortable: true, right:true, width:'120px',
      cell: r => {
        const seatCount = seatCounts[r._id];
        const availableSeats = r.Available_Seats || 0;
        
        if (loadingSeatCounts && seatCount === undefined) {
          return <span className="text-gray-400">Loading...</span>;
        }
        
        return (
          <div className="flex flex-col text-right">
            <span className="font-medium">{seatCount ?? availableSeats}</span>
            {seatCount !== undefined && seatCount !== availableSeats && (
              <span className="text-xs text-gray-500">DB: {availableSeats}</span>
            )}
          </div>
        );
      }
    },
    { name: <Header title="% Inc" description="Price increase" />, selector: r => r.priceIncreasePercentage, right:true, sortable:true, width:'100px',
      cell: r=> <span className="font-medium">{r.priceIncreasePercentage ?? 0}%</span>
    },
    { name: <Header title="Updated" description="Last update" />, selector:r=>r.Last_Updated || r.updatedAt, sortable:true, width:'160px',
      cell: r => (
        <div className="flex flex-col">
          <span className="text-xs font-medium">{timeAgo(r.Last_Updated || r.updatedAt)}</span>
          <span className="text-xs text-gray-500">{formatDate(r.Last_Updated || r.updatedAt)}</span>
          {!isFresh(r.Last_Updated || r.updatedAt) && (
            <span className="text-[10px] text-amber-600">Not updated in last 3 min</span>
          )}
          <span className="text-[10px] text-gray-400">{formatTime(r.Last_Updated || r.updatedAt)}</span>
        </div>
      )
    },
    {
      name: <Header title="Actions" />, button:true, width:'140px',
      cell: r => (
        <div className="flex gap-1 justify-end">
          
          <Link href={`/dashboard/events/${r._id}/edit`} className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-full" title="Edit"><Edit size={16}/></Link>
          <button
             className="p-1.5 text-red-600 hover:bg-red-100 rounded-full"
             title="Delete"
             onClick={() => onDeleteEvent && onDeleteEvent(r._id, r.Event_Name)}
           >
             <Trash2 size={16} />
           </button>
          <button
             onClick={() => toggleScraping(r._id, r.Skip_Scraping)}
             className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-colors
               ${r.Skip_Scraping ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-red-600 text-white hover:bg-red-700'}`}
             title={r.Skip_Scraping ? 'Start Scraping' : 'Stop Scraping'}
           >
            {r.Skip_Scraping ? <><Play size={12}/> Start</> : <><Square size={12}/> Stop</>}
          </button>
        </div>
      ),
      ignoreRowClick:true,
      allowOverflow:true,
    }
  ], [seatCounts, loadingSeatCounts, toggleScraping, onDeleteEvent, formatDate, formatTime, timeAgo, isFresh]);

  // Memoize styles to prevent object recreation
  const styles = useMemo(() => ({
    headRow:{style:{background:'#f8f9fa',fontSize:'13px',fontWeight:600,textTransform:'uppercase',borderBottom:'2px solid #dee2e6',paddingLeft:'24px',paddingRight:'24px'}},
    rows:{style:{minHeight:'52px','&:hover':{background:'#f1f5f9'}}},
    cells:{style:{fontSize:'15px',paddingLeft:'24px',paddingRight:'24px',paddingTop:'12px',paddingBottom:'12px'}},
  }), []);

  // Memoize conditional row styles
  const conditionalRowStyles = useMemo(() => [
    {
      when: row => !row.Skip_Scraping && isFresh(row.Last_Updated || row.updatedAt),
      style: { backgroundColor: '#d1fae5' } // light green
    },
    {
      when: row => !row.Skip_Scraping && !isFresh(row.Last_Updated || row.updatedAt),
      style: { backgroundColor: '#fef3c7' } // light yellow
    }
  ], [isFresh]);

  return (
    <div className="overflow-x-auto">
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
          <div className="flex flex-col items-center p-10">
            <AlertCircle className="h-10 w-10 text-gray-400" />
            <p className="mt-2 text-gray-500">No events</p>
          </div>
        }
      />
    </div>
  );
});

export default EventsTableModern;
