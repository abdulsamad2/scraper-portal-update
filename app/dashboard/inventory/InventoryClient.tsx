'use client';

import React, { useState, useRef, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Package } from 'lucide-react';
import OptimizedInventoryTable, { InventoryRow } from './OptimizedInventoryTable';

interface FilterState {
  event: string;
  mapping: string;
  section: string;
  row: string;
}

interface Props {
  data: InventoryRow[];
  totalGroups: number;
  totalQty: number;
  currentPage: number;
  perPage: number;
  currentSearch: string;
  currentFilters: FilterState;
  sortField: string;
  sortDir: 'asc' | 'desc';
}

export default function InventoryClient({
  data, totalGroups, totalQty, currentPage, perPage,
  currentSearch, currentFilters, sortField, sortDir,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [pendingSearch, setPendingSearch] = useState(currentSearch);
  const [pendingFilters, setPendingFilters] = useState(currentFilters);
  const [showFilters, setShowFilters] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const buildUrl = (overrides: Record<string, string>) => {
    const p = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(overrides)) {
      if (!v || (k === 'page' && v === '1') || (k === 'perPage' && v === '100')) {
        p.delete(k);
      } else {
        p.set(k, v);
      }
    }
    const qs = p.toString();
    return `/dashboard/inventory${qs ? `?${qs}` : ''}`;
  };

  const navigate = (overrides: Record<string, string>) => {
    startTransition(() => router.push(buildUrl(overrides)));
  };

  const applySearch = () => {
    navigate({ search: pendingSearch, page: '1' });
  };

  const clearSearch = () => {
    setPendingSearch('');
    navigate({ search: '', page: '1' });
  };

  const applyFilters = () => {
    navigate({
      event: pendingFilters.event,
      mapping: pendingFilters.mapping,
      section: pendingFilters.section,
      row: pendingFilters.row,
      page: '1',
    });
    setShowFilters(false);
  };

  const clearFilters = () => {
    const empty = { event: '', mapping: '', section: '', row: '' };
    setPendingFilters(empty);
    setPendingSearch('');
    navigate({ search: '', event: '', mapping: '', section: '', row: '', page: '1' });
    setShowFilters(false);
  };

  const handleSort = (field: string) => {
    const nextDir = sortField === field && sortDir === 'asc' ? 'desc' : 'asc';
    navigate({ sortField: field, sortDir: nextDir, page: '1' });
  };

  const handlePageChange = (page: number) => navigate({ page: String(page) });
  const handlePerPageChange = (pp: number) => navigate({ perPage: String(pp), page: '1' });

  const totalPages = Math.ceil(totalGroups / perPage);
  const hasActiveFilters = currentFilters.event || currentFilters.mapping || currentFilters.section || currentFilters.row;

  const filterFields = [
    { label: 'Event Name', key: 'event' as keyof FilterState },
    { label: 'Mapping ID', key: 'mapping' as keyof FilterState },
    { label: 'Section', key: 'section' as keyof FilterState },
    { label: 'Row', key: 'row' as keyof FilterState },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Package className="w-6 h-6" /> Inventory
      </h1>

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

      {/* Search + Filters */}
      <div className="flex flex-col md:flex-row md:justify-between items-start md:items-center gap-3">
        <div className="relative flex gap-2 items-center">
          <input
            ref={searchRef}
            type="text"
            placeholder="Quick search... (Press Enter)"
            value={pendingSearch}
            onChange={e => setPendingSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applySearch(); } }}
            className="border rounded-md px-3 py-2 w-64 text-sm"
          />
          <button onClick={applySearch}
            className="bg-blue-600 text-white px-3 py-2 rounded-md text-sm hover:bg-blue-700 transition-colors">
            Search
          </button>
          {(currentSearch || pendingSearch) ? (
            <button onClick={clearSearch}
              className="bg-gray-500 text-white px-3 py-2 rounded-md text-sm hover:bg-gray-600 transition-colors">
              Clear
            </button>
          ) : null}
          <button onClick={() => setShowFilters(f => !f)}
            className={`border px-3 py-2 rounded-md text-sm ${hasActiveFilters ? 'border-blue-400 text-blue-600' : ''}`}>
            {showFilters ? 'Hide Filters' : 'Filters'}
            {hasActiveFilters ? ' (active)' : ''}
          </button>
          {showFilters ? (
            <div className="absolute right-0 top-full mt-2 w-80 bg-white shadow-lg rounded-lg border p-4 text-sm z-10">
              {filterFields.map(f => (
                <div key={f.key} className="mb-3">
                  <label className="block text-gray-500 mb-1">{f.label}</label>
                  <input
                    type="text"
                    value={pendingFilters[f.key]}
                    onChange={e => setPendingFilters({ ...pendingFilters, [f.key]: e.target.value })}
                    className="border rounded-md px-2 py-1 w-full"
                  />
                </div>
              ))}
              <div className="flex gap-2 justify-end">
                <button onClick={applyFilters}
                  className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm">Apply</button>
                <button onClick={clearFilters}
                  className="border px-4 py-2 rounded-md text-sm">Clear</button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white shadow-md rounded-lg overflow-hidden">
        {totalGroups === 0 ? (
          <div className="p-8 text-center text-gray-500">No records found.</div>
        ) : (
          <>
            <OptimizedInventoryTable
              data={data}
              sortField={sortField}
              sortDirection={sortDir}
              onSort={handleSort}
            />

            {/* Pagination */}
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
              <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-4">
                  <span className="text-sm text-gray-700">
                    Showing {((currentPage - 1) * perPage) + 1} to {Math.min(currentPage * perPage, totalGroups)} of {totalGroups.toLocaleString()}
                  </span>
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-gray-700">Show:</label>
                    <select
                      value={perPage}
                      onChange={e => handlePerPageChange(Number(e.target.value))}
                      className="border rounded px-2 py-1 text-sm"
                    >
                      {[25, 50, 100, 200, 500].map(n => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                    <span className="text-sm text-gray-700">per page</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button onClick={() => handlePageChange(1)} disabled={currentPage === 1}
                    className="px-3 py-1 text-sm border rounded disabled:opacity-50 hover:bg-gray-100">First</button>
                  <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1}
                    className="px-3 py-1 text-sm border rounded disabled:opacity-50 hover:bg-gray-100">Previous</button>
                  <div className="flex gap-1">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum: number;
                      if (totalPages <= 5) pageNum = i + 1;
                      else if (currentPage <= 3) pageNum = i + 1;
                      else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                      else pageNum = currentPage - 2 + i;
                      return (
                        <button key={pageNum} onClick={() => handlePageChange(pageNum)}
                          className={`px-3 py-1 text-sm border rounded ${
                            currentPage === pageNum ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-gray-100'
                          }`}>{pageNum}</button>
                      );
                    })}
                  </div>
                  <button onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages}
                    className="px-3 py-1 text-sm border rounded disabled:opacity-50 hover:bg-gray-100">Next</button>
                  <button onClick={() => handlePageChange(totalPages)} disabled={currentPage === totalPages}
                    className="px-3 py-1 text-sm border rounded disabled:opacity-50 hover:bg-gray-100">Last</button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
