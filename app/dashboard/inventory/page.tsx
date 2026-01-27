'use client';

import { useEffect, useState } from 'react';
import { getConsecutiveGroupsPaginated } from '@/actions/seatActions';

// Force dynamic rendering to ensure fresh data
export const dynamic = 'force-dynamic';

// Define FilterOptions interface to match server action
interface FilterOptions {
  event?: string;
  mapping?: string;
  section?: string;
  row?: string;
}
import { Package } from 'lucide-react';

import OptimizedInventoryTable, { InventoryRow } from './OptimizedInventoryTable';

interface InventoryGroup {
  _id: string;
  section?: string;
  row?: string;
  seatCount?: number;
  seatRange?: string;
  inventory?: {
    event_name?: string;
    venue_name?: string;
    mapping_id?: string;
    section?: string;
    row?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface FilterState {
  event: string;
  mapping: string;
  section: string;
  row: string;
}

interface FilterField {
  label: string;
  key: keyof FilterState;
}

export default function InventoryPage() {
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [totalGroups, setTotalGroups] = useState(0);
  const [totalQty, setTotalQty] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<FilterState>({ event: '', mapping: '', section: '', row: '' });
  
  // Pending states for search and filters (not applied until user clicks Apply)
  const [pendingSearch, setPendingSearch] = useState<string>('');
  const [pendingFilters, setPendingFilters] = useState<{
    event: string;
    mapping: string;
    section: string;
    row: string;
  }>({ event: '', mapping: '', section: '', row: '' });
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(100);
  const [paginatedData, setPaginatedData] = useState<InventoryGroup[]>([]);
  
  // Sorting state
  const [sortField, setSortField] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Fetch paginated data from server
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const filterOptions: FilterOptions = {
          event: filters.event || undefined,
          mapping: filters.mapping || undefined,
          section: filters.section || undefined,
          row: filters.row || undefined
        };
        const resp = await getConsecutiveGroupsPaginated(itemsPerPage, currentPage, search || '', filterOptions);
        
        if ('error' in resp) {
          console.error('Error fetching inventory:', resp.error);
          return;
        }
        
        const { groups, total, totalQuantity } = resp;
        setPaginatedData(groups as InventoryGroup[]);
        setTotalGroups(total);
        setTotalQty(totalQuantity);
      } catch (error) {
        console.error('Error fetching inventory:', error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [currentPage, itemsPerPage, search, filters]);

  // Function to apply pending search and filters
  const applyFilters = () => {
    setSearch(pendingSearch);
    setFilters(pendingFilters);
    setCurrentPage(1); // Reset to first page when applying new filters
    setShowFilters(false);
  };

  // Function to clear all filters
  const clearFilters = () => {
    setPendingSearch('');
    setPendingFilters({ event: '', mapping: '', section: '', row: '' });
    setSearch('');
    setFilters({ event: '', mapping: '', section: '', row: '' });
    setCurrentPage(1);
    setShowFilters(false);
  };

  // Handle Enter key press in search input
  const handleSearchKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      setSearch(pendingSearch);
      setCurrentPage(1);
    }
  };

  const totalPages = Math.ceil(totalGroups / itemsPerPage);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleItemsPerPageChange = (items: number) => {
    setItemsPerPage(items);
    setCurrentPage(1);
  };

  // Initialize pending states with current values on component mount
  useEffect(() => {
    setPendingSearch(search);
    setPendingFilters(filters);
  }, [search, filters]);

  // Sorting function
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Note: Sorting is currently handled client-side by OptimizedInventoryTable
  // TODO: Implement server-side sorting in getConsecutiveGroupsPaginated


  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-gray-200 rounded animate-pulse"></div>
          <div className="w-24 h-8 bg-gray-200 rounded animate-pulse"></div>
        </div>
        
        {/* Summary cards skeleton */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white shadow-sm rounded-lg p-4 flex flex-col items-center">
              <div className="w-16 h-3 bg-gray-200 rounded animate-pulse mb-2"></div>
              <div className="w-12 h-8 bg-gray-200 rounded animate-pulse"></div>
            </div>
          ))}
        </div>

        {/* Search and filters skeleton */}
        <div className="flex flex-col md:flex-row md:justify-between items-start md:items-center gap-3">
          <div className="flex gap-2 items-center">
            <div className="w-64 h-10 bg-gray-200 rounded-md animate-pulse"></div>
            <div className="w-20 h-10 bg-gray-200 rounded-md animate-pulse"></div>
          </div>
        </div>

        {/* Table skeleton */}
        <div className="bg-white shadow-md rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gradient-to-r from-gray-50 to-gray-100 border-b-2 border-gray-200">
                <tr>
                  {[...Array(16)].map((_, i) => (
                    <th key={i} className="px-6 py-4 text-left">
                      <div className="w-20 h-4 bg-gray-200 rounded animate-pulse"></div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {[...Array(10)].map((_, rowIndex) => (
                  <tr key={rowIndex} className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                    {[...Array(16)].map((_, colIndex) => (
                      <td key={colIndex} className="px-6 py-4">
                        <div className={`h-4 bg-gray-200 rounded animate-pulse ${
                          colIndex === 0 ? 'w-32' : 
                          colIndex === 1 ? 'w-24' :
                          colIndex === 2 ? 'w-28' :
                          colIndex === 6 || colIndex === 9 || colIndex === 10 ? 'w-16' :
                          'w-20'
                        }`}></div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Pagination skeleton */}
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="flex items-center gap-4">
                <div className="w-48 h-4 bg-gray-200 rounded animate-pulse"></div>
                <div className="flex items-center gap-2">
                  <div className="w-12 h-4 bg-gray-200 rounded animate-pulse"></div>
                  <div className="w-16 h-8 bg-gray-200 rounded animate-pulse"></div>
                  <div className="w-16 h-4 bg-gray-200 rounded animate-pulse"></div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {[...Array(7)].map((_, i) => (
                  <div key={i} className="w-12 h-8 bg-gray-200 rounded animate-pulse"></div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold flex items-center gap-2 text-wrap: balance">
          <Package className="w-6 h-6" aria-hidden="true" /> 
          Inventory Management
        </h1>
        <p className="text-slate-600 mt-2">Track and manage ticket inventory across all events</p>
      </header>
      {/* Summary cards */}
      <section aria-labelledby="inventory-summary">
        <h2 id="inventory-summary" className="sr-only">Inventory Summary</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white shadow-sm rounded-lg p-4 flex flex-col items-center hover:shadow-md transition-shadow">
            <span className="text-xs text-gray-500 font-medium">Total Rows</span>
            <span className="text-2xl font-bold text-blue-600 font-variant-numeric: tabular-nums" aria-label={`${totalGroups.toLocaleString()} total rows`}>
              {new Intl.NumberFormat('en-US').format(totalGroups)}
            </span>
          </div>
          <div className="bg-white shadow-sm rounded-lg p-4 flex flex-col items-center hover:shadow-md transition-shadow">
            <span className="text-xs text-gray-500 font-medium">Total Seats</span>
            <span className="text-2xl font-bold text-green-600 font-variant-numeric: tabular-nums" aria-label={`${totalQty.toLocaleString()} total seats`}>
              {new Intl.NumberFormat('en-US').format(totalQty)}
            </span>
          </div>
        </div>
      </section>

      <section className="flex flex-col md:flex-row md:justify-between items-start md:items-center gap-3">
        <div className="relative flex gap-2 items-center">
          <div className="relative">
            <label htmlFor="inventory-search" className="sr-only">Search inventory</label>
            <input
              id="inventory-search"
              type="search"
              placeholder="Quick search… (Press Enter to search)"
              value={pendingSearch}
              onChange={(e) => setPendingSearch(e.target.value)}
              onKeyPress={handleSearchKeyPress}
              autoComplete="off"
              className="border rounded-md px-3 py-2 w-64 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:border-blue-500"
              aria-describedby="search-help"
            />
            <div id="search-help" className="sr-only">Press Enter to search or use filters for advanced search</div>
          </div>
          <button
            onClick={() => setShowFilters((f) => !f)}
            className="border px-3 py-2 rounded-md text-sm hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-expanded={showFilters}
            aria-controls="filter-panel"
            aria-label={showFilters ? "Hide filters" : "Show filters"}
          >
            {showFilters ? "Hide Filters" : "Filters"}
          </button>
          {showFilters && (
            <div 
              id="filter-panel"
              className="absolute right-0 top-full mt-2 w-80 bg-white shadow-lg rounded-lg border p-4 text-sm z-10"
              role="region"
              aria-labelledby="filter-panel-title"
            >
              <h3 id="filter-panel-title" className="font-semibold mb-3">Filter Options</h3>
              {([
                { label: "Event Name", key: "event" },
                { label: "Mapping ID", key: "mapping" },
                { label: "Section", key: "section" },
                { label: "Row", key: "row" },
              ] as FilterField[]).map((f) => (
                <div key={f.key} className="mb-3">
                  <label htmlFor={`filter-${f.key}`} className="block text-gray-700 mb-1 font-medium">{f.label}</label>
                  <input
                    id={`filter-${f.key}`}
                    type="text"
                    value={pendingFilters[f.key]}
                    onChange={(e) =>
                      setPendingFilters({ ...pendingFilters, [f.key]: e.target.value })
                    }
                    autoComplete="off"
                    className="border rounded-md px-2 py-1 w-full focus-visible:ring-2 focus-visible:ring-blue-500"
                  />
                </div>
              ))}
              <div className="flex gap-2 justify-end pt-2 border-t">
                <button
                  onClick={applyFilters}
                  className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                >
                  Apply Filters
                </button>
                <button
                  onClick={clearFilters}
                  className="border px-4 py-2 rounded-md text-sm hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  Clear All
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="bg-white shadow-md rounded-lg overflow-hidden">
        {totalGroups === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
              <Package className="w-8 h-8 text-gray-400" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-gray-700 mb-2">No Inventory Found</h3>
            <p className="text-gray-500 max-w-md mx-auto">
              {search || Object.values(filters).some(f => f) 
                ? "No inventory matches your current search criteria. Try adjusting your filters or search terms." 
                : "No inventory data available. Check back once events are scraped and inventory is populated."}
            </p>
            {(search || Object.values(filters).some(f => f)) && (
              <button 
                onClick={clearFilters}
                className="mt-4 text-blue-600 hover:text-blue-700 text-sm font-medium"
              >
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          <>
            <OptimizedInventoryTable 
              data={paginatedData as InventoryRow[]} 
              sortField={sortField}
              sortDirection={sortDirection}
              onSort={handleSort}
            />
            
            {/* Pagination Controls */}
            <nav aria-label="Inventory pagination" className="px-6 py-4 border-t border-gray-200 bg-gray-50">
              <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-4">
                  <span className="text-sm text-gray-700">
                    Showing {new Intl.NumberFormat('en-US').format(((currentPage - 1) * itemsPerPage) + 1)} to {new Intl.NumberFormat('en-US').format(Math.min(currentPage * itemsPerPage, totalGroups))} of {new Intl.NumberFormat('en-US').format(totalGroups)} entries
                  </span>
                  <div className="flex items-center gap-2">
                    <label htmlFor="items-per-page" className="text-sm text-gray-700">Show:</label>
                    <select 
                      id="items-per-page"
                      value={itemsPerPage} 
                      onChange={(e) => handleItemsPerPageChange(Number(e.target.value))}
                      className="border rounded px-2 py-1 text-sm focus-visible:ring-2 focus-visible:ring-blue-500"
                      aria-label="Items per page"
                    >
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={200}>200</option>
                      <option value={500}>500</option>
                    </select>
                    <span className="text-sm text-gray-700">per page</span>
                  </div>
                </div>
                
                <div className="flex items-center gap-2" role="group" aria-label="Pagination controls">
                  <button
                    onClick={() => handlePageChange(1)}
                    disabled={currentPage === 1}
                    className="px-3 py-2 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-blue-500 touch-action: manipulation"
                    aria-label="Go to first page"
                  >
                    First
                  </button>
                  <button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="px-3 py-2 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-blue-500 touch-action: manipulation"
                    aria-label="Go to previous page"
                  >
                    Previous
                  </button>
                  
                  {/* Page numbers */}
                  <div className="flex gap-1">
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
                          onClick={() => handlePageChange(pageNum)}
                          className={`px-3 py-2 text-sm border rounded touch-action: manipulation focus-visible:ring-2 focus-visible:ring-blue-500 ${
                            currentPage === pageNum
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'hover:bg-gray-100'
                          }`}
                          aria-label={`Go to page ${pageNum}`}
                          aria-current={currentPage === pageNum ? 'page' : undefined}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>
                  
                  <button
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-2 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-blue-500 touch-action: manipulation"
                    aria-label="Go to next page"
                  >
                    Next
                  </button>
                  <button
                    onClick={() => handlePageChange(totalPages)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-2 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-blue-500 touch-action: manipulation"
                    aria-label="Go to last page"
                  >
                    Last
                  </button>
                </div>
              </div>
            </nav>
          </>
        )}
      </div>
    </div>
  );
}
