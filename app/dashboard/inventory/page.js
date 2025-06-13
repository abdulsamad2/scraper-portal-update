'use client';

import { useEffect, useState, useRef } from 'react';
import { getConsecutiveGroupsPaginated } from '@/actions/seatActions';
import { getAllEvents } from '@/actions/eventActions';
import { Loader, Package } from 'lucide-react';
import Link from 'next/link';

import InventoryTable from './InventoryTable';

export default function InventoryPage() {
  const [groups, setGroups] = useState([]);
  const [eventsMap, setEventsMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const groupsPerPage = 20;
  const [search, setSearch] = useState('');
  const [totalGroups, setTotalGroups] = useState(0);
  const [totalQty, setTotalQty] = useState(0);
  const loadMoreRef = useRef(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ event: '', mapping: '', section: '', row: '' });

  // Fetch events once
  useEffect(() => {
    getAllEvents().then(evts => {
      const map = {};
      if (Array.isArray(evts)) {
        evts.forEach(ev => { map[ev._id] = ev; });
      }
      setEventsMap(map);
    });
  }, []);

  // Reset when search changes
  useEffect(() => {
    setGroups([]);
    setPage(1);
    setHasMore(true);
  }, [search]);

  // Fetch page data
  useEffect(() => {
    const load = async () => {
      if (!hasMore) return;
      const combined = `${search} ${filters.event} ${filters.mapping} ${filters.section} ${filters.row}`.trim();
      const resp = await getConsecutiveGroupsPaginated(groupsPerPage, page, combined);
      if (!resp.error) {
        setGroups(prev => [...prev, ...(resp.groups || [])]);
        setTotalGroups(resp.total || 0);
        setTotalQty(resp.totalQuantity || 0);
        setHasMore((page * groupsPerPage) < (resp.total || 0));
      }
      setLoading(false);
      setLoadingMore(false);
    };
    setLoadingMore(true);
    load();
  }, [page, search, filters]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && !loadingMore) {
        setPage(prev => prev + 1);
      }
    }, { rootMargin: '200px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore]);

  const paginated = groups; // data already contains loaded pages

  const formatDate = (d) => new Date(d).toLocaleString();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white shadow-sm rounded-lg p-4 flex flex-col items-center">
          <span className="text-xs text-gray-500">Total Rows</span>
          <span className="text-2xl font-bold text-blue-600">{totalGroups.toLocaleString()}</span>
        </div>
        <div className="bg-white shadow-sm rounded-lg p-4 flex flex-col items-center">
          <span className="text-xs text-gray-500">Total Seats</span>
          <span className="text-2xl font-bold text-green-600">{totalQty.toLocaleString()}</span>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:justify-between items-start md:items-center gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Package className="w-6 h-6" /> Inventory
        </h1>
        <div className="relative flex gap-2 items-center">
          <input
            type="text"
            placeholder="Quick search..."
            onChange={e => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="border rounded-md px-3 py-2 w-64"
          />
          <button
            onClick={() => setShowFilters(f => !f)}
            className="border px-3 py-2 rounded-md text-sm"
          >
            {showFilters ? 'Hide Filters' : 'Filters'}
          </button>
          {showFilters && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-white shadow-lg rounded-lg border p-4 text-sm z-10">
              {[
                { label: 'Event Name', key: 'event' },
                { label: 'Mapping ID', key: 'mapping' },
                { label: 'Section', key: 'section' },
                { label: 'Row', key: 'row' },
              ].map(f => (
                <div key={f.key} className="mb-3">
                  <label className="block text-gray-500 mb-1">{f.label}</label>
                  <input
                    type="text"
                    value={filters[f.key]}
                    onChange={e => setFilters({ ...filters, [f.key]: e.target.value })}
                    className="border rounded-md px-2 py-1 w-full"
                  />
                </div>
              ))}
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    const combined = Object.values(filters).join(' ');
                    setSearch(combined);
                    setPage(1);
                    setShowFilters(false);
                  }}
                  className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm">
                  Apply
                </button>
                <button
                  onClick={() => {
                    setFilters({ event: '', mapping: '', section: '', row: '' });
                    setSearch('');
                    setPage(1);
                    setShowFilters(false);
                  }}
                  className="border px-4 py-2 rounded-md text-sm">
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white shadow-md rounded-lg overflow-hidden">
        {paginated.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No records found.</div>
        ) : (
          <InventoryTable data={paginated} eventsMap={eventsMap} />
        )}
      </div>

      {loadingMore && (
        <div className="flex items-center justify-center py-4"><Loader className="w-5 h-5 animate-spin text-blue-600" /></div>
      )}
      <div ref={loadMoreRef} className="h-2" />
    </div>
  );
}
