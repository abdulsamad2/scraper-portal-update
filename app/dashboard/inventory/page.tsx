'use client';

import { useEffect, useState } from 'react';
import { getAllConsecutiveGroups } from '@/actions/seatActions';
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
  const [groups, setGroups] = useState<InventoryGroup[]>([]);
  const [filteredGroups, setFilteredGroups] = useState<InventoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [totalGroups, setTotalGroups] = useState(0);
  const [totalQty, setTotalQty] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<FilterState>({ event: '', mapping: '', section: '', row: '' });
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [paginatedData, setPaginatedData] = useState<InventoryGroup[]>([]);
  
  // Sorting state
  const [sortField, setSortField] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Fetch all data once
  useEffect(() => {
    const load = async () => {
      try {
        const resp = await getAllConsecutiveGroups();
        if (Array.isArray(resp)) {
          const typedResp = resp as InventoryGroup[];
          setGroups(typedResp);
          setFilteredGroups(typedResp);
          setTotalGroups(typedResp.length);
          setTotalQty(typedResp.reduce((sum: number, group: InventoryGroup) => sum + (group.seatCount || 0), 0));
        }
      } catch (error) {
        console.error('Error fetching inventory:', error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // Filter and sort data based on search, filters, and sorting
  useEffect(() => {
    let filtered = groups;
    
    if (search || Object.values(filters).some(f => f)) {
      filtered = groups.filter((group: InventoryGroup) => {
        const searchLower = search.toLowerCase();
        const eventMatch = !filters.event || group.inventory?.event_name?.toLowerCase().includes(filters.event.toLowerCase());
        const mappingMatch = !filters.mapping || group.inventory?.mapping_id?.toLowerCase().includes(filters.mapping.toLowerCase());
        const sectionMatch = !filters.section || group.section?.toLowerCase().includes(filters.section.toLowerCase()) || group.inventory?.section?.toLowerCase().includes(filters.section.toLowerCase());
        const rowMatch = !filters.row || group.row?.toLowerCase().includes(filters.row.toLowerCase()) || group.inventory?.row?.toLowerCase().includes(filters.row.toLowerCase());
        
        const generalSearch = !search || 
          group.inventory?.event_name?.toLowerCase().includes(searchLower) ||
          group.inventory?.venue_name?.toLowerCase().includes(searchLower) ||
          group.section?.toLowerCase().includes(searchLower) ||
          group.row?.toLowerCase().includes(searchLower) ||
          group.inventory?.section?.toLowerCase().includes(searchLower) ||
          group.inventory?.row?.toLowerCase().includes(searchLower);
        
        return eventMatch && mappingMatch && sectionMatch && rowMatch && generalSearch;
      });
    }
    
    // Apply sorting
    const sorted = sortData(filtered);
    
    setFilteredGroups(sorted);
    setTotalGroups(sorted.length);
    setTotalQty(sorted.reduce((sum: number, group: InventoryGroup) => sum + (group.seatCount || 0), 0));
    setCurrentPage(1); // Reset to first page when filters change
    
  }, [search, filters, groups, sortField, sortDirection]);

  // Paginate filtered data
  useEffect(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    setPaginatedData(filteredGroups.slice(startIndex, endIndex));
  }, [filteredGroups, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredGroups.length / itemsPerPage);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleItemsPerPageChange = (items: number) => {
    setItemsPerPage(items);
    setCurrentPage(1);
  };

  // Sorting function
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Sort data function
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sortData = (data: InventoryGroup[]) => {
    if (!sortField) return data;
    
    return [...data].sort((a, b) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let aValue: any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let bValue: any;
      
      // Handle nested inventory fields
      if (sortField.includes('_') || ['event_name', 'venue_name', 'event_date', 'inventoryId', 'stockType', 'cost', 'listPrice', 'hideSeatNumbers', 'instant_transfer', 'files_available'].includes(sortField)) {
        aValue = a.inventory?.[sortField];
        bValue = b.inventory?.[sortField];
      } else {
        aValue = a[sortField as keyof InventoryGroup];
        bValue = b[sortField as keyof InventoryGroup];
      }
      
      // Handle undefined/null values
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return sortDirection === 'asc' ? 1 : -1;
      if (bValue == null) return sortDirection === 'asc' ? -1 : 1;
      
      // Handle different data types
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        const comparison = aValue.toLowerCase().localeCompare(bValue.toLowerCase());
        return sortDirection === 'asc' ? comparison : -comparison;
      }
      
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
      }
      
      // Handle dates
      if (sortField === 'event_date') {
        const dateA = new Date(aValue).getTime();
        const dateB = new Date(bValue).getTime();
        return sortDirection === 'asc' ? dateA - dateB : dateB - dateA;
      }
      
      // Handle boolean values
      if (typeof aValue === 'boolean' && typeof bValue === 'boolean') {
        if (aValue === bValue) return 0;
        return sortDirection === 'asc' ? (aValue ? 1 : -1) : (aValue ? -1 : 1);
      }
      
      // Default string comparison
      const comparison = String(aValue).localeCompare(String(bValue));
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  };


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
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Package className="w-6 h-6" /> Inventory
      </h1>
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white shadow-sm rounded-lg p-4 flex flex-col items-center">
          <span className="text-xs text-gray-500">Total Rows</span>
          <span className="text-2xl font-bold text-blue-600">
            {totalGroups.toLocaleString()}
          </span>
        </div>
        <div className="bg-white shadow-sm rounded-lg p-4 flex flex-col items-center">
          <span className="text-xs text-gray-500">Total Seats</span>
          <span className="text-2xl font-bold text-green-600">
            {totalQty.toLocaleString()}
          </span>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:justify-between items-start md:items-center gap-3">
        <div className="relative flex gap-2 items-center">
          <input
            type="text"
            placeholder="Quick search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border rounded-md px-3 py-2 w-64"
          />
          <button
            onClick={() => setShowFilters((f) => !f)}
            className="border px-3 py-2 rounded-md text-sm"
          >
            {showFilters ? "Hide Filters" : "Filters"}
          </button>
          {showFilters && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-white shadow-lg rounded-lg border p-4 text-sm z-10">
              {([
                { label: "Event Name", key: "event" },
                { label: "Mapping ID", key: "mapping" },
                { label: "Section", key: "section" },
                { label: "Row", key: "row" },
              ] as FilterField[]).map((f) => (
                <div key={f.key} className="mb-3">
                  <label className="block text-gray-500 mb-1">{f.label}</label>
                  <input
                    type="text"
                    value={filters[f.key]}
                    onChange={(e) =>
                      setFilters({ ...filters, [f.key]: e.target.value })
                    }
                    className="border rounded-md px-2 py-1 w-full"
                  />
                </div>
              ))}
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowFilters(false)}
                  className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm"
                >
                  Apply
                </button>
                <button
                  onClick={() => {
                    setFilters({
                      event: "",
                      mapping: "",
                      section: "",
                      row: "",
                    });
                    setSearch("");
                    setShowFilters(false);
                  }}
                  className="border px-4 py-2 rounded-md text-sm"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white shadow-md rounded-lg overflow-hidden">
        {filteredGroups.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No records found.</div>
        ) : (
          <>
            <OptimizedInventoryTable 
              data={paginatedData as InventoryRow[]} 
              sortField={sortField}
              sortDirection={sortDirection}
              onSort={handleSort}
            />
            
            {/* Pagination Controls */}
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
              <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-4">
                  <span className="text-sm text-gray-700">
                    Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, filteredGroups.length)} of {filteredGroups.length} entries
                  </span>
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-gray-700">Show:</label>
                    <select 
                      value={itemsPerPage} 
                      onChange={(e) => handleItemsPerPageChange(Number(e.target.value))}
                      className="border rounded px-2 py-1 text-sm"
                    >
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={200}>200</option>
                    </select>
                    <span className="text-sm text-gray-700">per page</span>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handlePageChange(1)}
                    disabled={currentPage === 1}
                    className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                  >
                    First
                  </button>
                  <button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
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
                          className={`px-3 py-1 text-sm border rounded ${
                            currentPage === pageNum
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'hover:bg-gray-100'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>
                  
                  <button
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                  >
                    Next
                  </button>
                  <button
                    onClick={() => handlePageChange(totalPages)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                  >
                    Last
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
