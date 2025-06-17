'use client';

import { useEffect, useState } from 'react';
import { getAllConsecutiveGroups } from '@/actions/seatActions';
import { Loader, Package } from 'lucide-react';

import InventoryTable, { InventoryRow } from './InventoryTable';

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

  // Filter data based on search and filters
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
    
    setFilteredGroups(filtered);
    setTotalGroups(filtered.length);
    setTotalQty(filtered.reduce((sum: number, group: InventoryGroup) => sum + (group.seatCount || 0), 0));
    setCurrentPage(1); // Reset to first page when filters change
  }, [search, filters, groups]);

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


  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader className="w-8 h-8 animate-spin text-blue-600" />
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
            <InventoryTable data={paginatedData as InventoryRow[]} />
            
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
