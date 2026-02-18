import Link from "next/link";
import React from "react";

export interface InventoryRow {
  _id: string;
  section?: string;
  row?: string;
  seatCount?: number;
  seatRange?: string;
  inventory?: {
    event_name?: string;
    eventId?: string;
    inventoryId?: string;
    venue_name?: string;
    event_date?: string;
    section?: string;
    row?: string;
    hideSeatNumbers?: boolean;
    cost?: number;
    listPrice?: number;
    stockType?: string;
    splitType?: string;
    publicNotes?: string;
    instant_transfer?: boolean;
    files_available?: boolean;
    [key: string]: unknown; // Allow additional properties
  };
  status?: 'active' | 'deleted'; // Explicit variant instead of boolean
  deletedAt?: Date;
}

interface OptimizedInventoryTableProps {
  data: InventoryRow[];
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  onSort?: (field: string) => void;
}

// Compound component for table headers
const TableHeader = {
  Root: ({ children }: { children: React.ReactNode }) => (
    <div className="flex items-center">
      {children}
    </div>
  ),
  
  Title: ({ children }: { children: React.ReactNode }) => (
    <span className="font-semibold">{children}</span>
  ),
  
  Tooltip: ({ text, children }: { text: string; children: React.ReactNode }) => (
    <div className="group relative flex cursor-pointer items-center">
      {children}
      <div className="absolute bottom-full left-1/2 z-10 mb-2 w-48 -translate-x-1/2 transform rounded-lg bg-gray-700 p-2 text-center text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none">
        {text}
      </div>
    </div>
  ),
  
  Icon: () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="ml-1.5 h-4 w-4 text-gray-400">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
    </svg>
  )
};

// Row status variants instead of boolean conditions
const RowStatus = {
  Active: ({ children }: { children: React.ReactNode }) => (
    <div className="opacity-100">{children}</div>
  ),
  
  Deleted: ({ children, deletedAt }: { children: React.ReactNode; deletedAt?: Date }) => (
    <div className="opacity-50 bg-red-50 border-l-4 border-red-400 px-2">
      <div className="flex items-center justify-between">
        <div>{children}</div>
        <div className="text-xs text-red-600 font-medium">
          Deleted {deletedAt ? new Date(deletedAt).toLocaleTimeString() : ''}
        </div>
      </div>
    </div>
  )
};

// Sort icon component
const SortIcon = ({ field, sortField, sortDirection }: { field: string; sortField?: string; sortDirection?: 'asc' | 'desc' }) => {
  if (sortField !== field) {
    return (
      <svg className="w-4 h-4 ml-1 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    );
  }
  
  return sortDirection === 'asc' ? (
    <svg className="w-4 h-4 ml-1 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
    </svg>
  ) : (
    <svg className="w-4 h-4 ml-1 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
};

// Custom header with tooltip and sorting using compound components
const CustomHeader = ({ 
  title, 
  description, 
  field, 
  sortable = false, 
  sortField, 
  sortDirection, 
  onSort 
}: { 
  title: string; 
  description: string; 
  field?: string;
  sortable?: boolean;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  onSort?: (field: string) => void;
}) => (
  <TableHeader.Tooltip text={description}>
    <div 
      className={`flex items-center justify-between group transition-all duration-200 whitespace-nowrap ${
        sortable ? 'cursor-pointer hover:text-blue-600 hover:bg-blue-50 -mx-2 px-2 py-1 rounded-md' : ''
      }`}
      onClick={sortable && field && onSort ? () => onSort(field) : undefined}
    >
      <div className="flex items-center">
        <span className="font-bold text-xs uppercase tracking-wider text-gray-700 group-hover:text-blue-700">{title}</span>
        <TableHeader.Icon />
      </div>
      {sortable && field && (
        <div className="opacity-60 group-hover:opacity-100 transition-opacity">
          <SortIcon field={field} sortField={sortField} sortDirection={sortDirection} />
        </div>
      )}
    </div>
  </TableHeader.Tooltip>
);

const OptimizedInventoryTable: React.FC<OptimizedInventoryTableProps> = ({ 
  data, 
  sortField, 
  sortDirection, 
  onSort 
}) => {
  const formatCurrency = (value: number | undefined) => {
    return value ? value.toFixed(2) : '0.00';
  };

  const formatDate = (dateString: string | undefined) => {
    return dateString ? new Date(dateString).toLocaleDateString() : '-';
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200/60 shadow-lg">
      <div className="max-h-[800px] overflow-auto">
        <table className="min-w-full">
          <thead className="bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-300/50 sticky top-0 z-10">
          <tr>
            <th className="px-6 py-4 text-left bg-white/50 backdrop-blur-sm border-r border-gray-200/40 last:border-r-0" style={{ minWidth: '200px' }}>
              <CustomHeader 
                title="Event Name" 
                description="The name of the event. Click to view event details." 
                field="event_name"
                sortable
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={onSort}
              />
            </th>
            <th className="px-6 py-4 text-left bg-white/50 backdrop-blur-sm border-r border-gray-200/40 last:border-r-0" style={{ minWidth: '120px' }}>
              <CustomHeader 
                title="Inventory ID" 
                description="The unique identifier for this inventory lot from the source." 
                field="inventoryId"
                sortable
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={onSort}
              />
            </th>
            <th className="px-6 py-4 text-left bg-white/50 backdrop-blur-sm border-r border-gray-200/40 last:border-r-0" style={{ minWidth: '180px' }}>
              <CustomHeader 
                title="Venue" 
                description="The location where the event is held." 
              />
            </th>
            <th className="px-6 py-4 text-left bg-white/50 backdrop-blur-sm border-r border-gray-200/40 last:border-r-0" style={{ minWidth: '120px' }}>
              <CustomHeader 
                title="Event Date" 
                description="The date of the event." 
                field="event_date"
                sortable
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={onSort}
              />
            </th>
            <th className="px-6 py-4 text-left bg-white/50 backdrop-blur-sm border-r border-gray-200/40 last:border-r-0" style={{ minWidth: '100px' }}>
              <CustomHeader 
                title="Section" 
                description="The section of the seating." 
                field="section"
                sortable
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={onSort}
              />
            </th>
            <th className="px-6 py-4 text-left bg-white/50 backdrop-blur-sm border-r border-gray-200/40 last:border-r-0" style={{ minWidth: '80px' }}>
              <CustomHeader 
                title="Row" 
                description="The row of the seating." 
                field="row"
                sortable
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={onSort}
              />
            </th>
            <th className="px-6 py-4 text-right bg-white/50 backdrop-blur-sm border-r border-gray-200/40 last:border-r-0" style={{ minWidth: '100px' }}>
              <CustomHeader 
                title="Seat Count" 
                description="The number of seats in this group." 
                field="seatCount"
                sortable
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={onSort}
              />
            </th>
            <th className="px-6 py-4 text-left bg-white/50 backdrop-blur-sm border-r border-gray-200/40 last:border-r-0" style={{ minWidth: '120px' }}>
              <CustomHeader 
                title="Seat Range" 
                description="The range of seat numbers." 
              />
            </th>
            <th className="px-6 py-4 text-left bg-white/50 backdrop-blur-sm border-r border-gray-200/40 last:border-r-0" style={{ minWidth: '100px' }}>
              <CustomHeader 
                title="Hide Seats" 
                description="Whether the seat numbers are hidden from buyers." 
                field="hideSeatNumbers"
                sortable
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={onSort}
              />
            </th>
            <th className="px-6 py-4 text-right bg-white/50 backdrop-blur-sm border-r border-gray-200/40 last:border-r-0" style={{ minWidth: '80px' }}>
              <CustomHeader 
                title="Cost" 
                description="The cost of the tickets." 
                field="cost"
                sortable
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={onSort}
              />
            </th>
            <th className="px-6 py-4 text-right bg-white/50 backdrop-blur-sm border-r border-gray-200/40 last:border-r-0" style={{ minWidth: '100px' }}>
              <CustomHeader 
                title="List Price" 
                description="The price at which the tickets are listed for sale." 
                field="listPrice"
                sortable
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={onSort}
              />
            </th>
            <th className="px-6 py-4 text-left bg-white/50 backdrop-blur-sm border-r border-gray-200/40 last:border-r-0" style={{ minWidth: '120px' }}>
              <CustomHeader 
                title="Stock Type" 
                description="The type of ticket stock (e.g., Mobile, Hard)." 
                field="stockType"
                sortable
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={onSort}
              />
            </th>
            <th className="px-6 py-4 text-left bg-white/50 backdrop-blur-sm border-r border-gray-200/40 last:border-r-0" style={{ minWidth: '120px' }}>
              <CustomHeader 
                title="Split Type" 
                description="How the group of tickets can be split (e.g., Any, Even)." 
              />
            </th>
            <th className="px-6 py-4 text-left bg-white/50 backdrop-blur-sm border-r border-gray-200/40 last:border-r-0" style={{ minWidth: '200px' }}>
              <CustomHeader 
                title="Public Notes" 
                description="Notes visible to the public." 
              />
            </th>
            <th className="px-6 py-4 text-left bg-white/50 backdrop-blur-sm border-r border-gray-200/40 last:border-r-0" style={{ minWidth: '120px' }}>
              <CustomHeader 
                title="Instant Transfer" 
                description="Whether the tickets are available for instant transfer." 
                field="instant_transfer"
                sortable
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={onSort}
              />
            </th>
            <th className="px-6 py-4 text-left bg-white/50 backdrop-blur-sm border-r border-gray-200/40 last:border-r-0" style={{ minWidth: '120px' }}>
              <CustomHeader 
                title="Files Available" 
                description="Whether ticket files are available." 
                field="files_available"
                sortable
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={onSort}
              />
            </th>
          </tr>
        </thead>
        <tbody className="bg-white">
          {data.map((row, index) => (
            <tr 
              key={row._id} 
              className={`
                ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'} 
                ${row.status === 'deleted' ? 'bg-red-50 text-red-900 opacity-80' : ''} 
                hover:bg-blue-50/50 hover:shadow-sm transition-all duration-200 border-l-4 border-l-transparent hover:border-l-blue-400
                border-b border-gray-200/40 last:border-b-0
              `}
            >
              <td className="px-6 py-3 text-sm font-medium border-r border-gray-100/60 last:border-r-0">
                {row.inventory?.event_name && row.inventory?.eventId ? (
                  <Link 
                    href={`/dashboard/events/${row.inventory.eventId}`} 
                    className="text-blue-600 hover:text-blue-800 hover:underline font-semibold transition-colors"
                  >
                    {row.inventory.event_name}
                  </Link>
                ) : (
                  <span className="text-gray-700">{row.inventory?.event_name || '—'}</span>
                )}
              </td>
              <td className="px-6 py-3 text-sm text-gray-600 font-mono border-r border-gray-100/60 last:border-r-0">
                {row.inventory?.inventoryId || '-'}
              </td>
              <td className="px-6 py-3 text-sm text-gray-700 border-r border-gray-100/60 last:border-r-0">
                {row.inventory?.venue_name || '-'}
              </td>
              <td className="px-6 py-3 text-sm text-gray-600 border-r border-gray-100/60 last:border-r-0">
                {formatDate(row.inventory?.event_date)}
              </td>
              <td className="px-6 py-3 text-sm text-gray-700 font-medium border-r border-gray-100/60 last:border-r-0">
                {row.inventory?.section || row.section || ''}
              </td>
              <td className="px-6 py-3 text-sm text-gray-700 font-medium border-r border-gray-100/60 last:border-r-0">
                {row.inventory?.row || row.row || ''}
              </td>
              <td className="px-6 py-3 text-sm text-right font-semibold text-gray-800 border-r border-gray-100/60 last:border-r-0">
                {row.seatCount || 0}
              </td>
              <td className="px-6 py-3 text-sm text-gray-600 border-r border-gray-100/60 last:border-r-0">
                {row.seatRange || '-'}
              </td>
              <td className="px-6 py-3 text-sm border-r border-gray-100/60 last:border-r-0">
                <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                  row.inventory?.hideSeatNumbers 
                    ? 'bg-yellow-100 text-yellow-800' 
                    : 'bg-green-100 text-green-800'
                }`}>
                  {row.inventory?.hideSeatNumbers ? 'Yes' : 'No'}
                </span>
              </td>
              <td className="px-6 py-3 text-sm text-right font-semibold text-green-700 border-r border-gray-100/60 last:border-r-0">
                ${formatCurrency(row.inventory?.cost)}
              </td>
              <td className="px-6 py-3 text-sm text-right font-semibold text-blue-700 border-r border-gray-100/60 last:border-r-0">
                ${formatCurrency(row.inventory?.listPrice)}
              </td>
              <td className="px-6 py-3 text-sm border-r border-gray-100/60 last:border-r-0">
                <span className="inline-flex px-2 py-1 text-xs font-medium rounded-md bg-gray-100 text-gray-800">
                  {row.inventory?.stockType || '-'}
                </span>
              </td>
              <td className="px-6 py-3 text-sm text-gray-600 border-r border-gray-100/60 last:border-r-0">
                {row.inventory?.splitType || '-'}
              </td>
              <td className="px-6 py-3 text-sm max-w-xs border-r border-gray-100/60 last:border-r-0">
                <div className="truncate text-gray-600" title={row.inventory?.publicNotes || '-'}>
                  {row.inventory?.publicNotes || '-'}
                </div>
              </td>
              <td className="px-6 py-3 text-sm border-r border-gray-100/60 last:border-r-0">
                <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                  row.inventory?.instant_transfer 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-gray-100 text-gray-800'
                }`}>
                  {row.inventory?.instant_transfer ? 'Yes' : 'No'}
                </span>
              </td>
              <td className="px-6 py-3 text-sm border-r border-gray-100/60 last:border-r-0">
                <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                  row.inventory?.files_available 
                    ? 'bg-blue-100 text-blue-800' 
                    : 'bg-gray-100 text-gray-800'
                }`}>
                  {row.inventory?.files_available ? 'Yes' : 'No'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
      
      {data.length === 0 && (
        <div className="text-center py-16 bg-gradient-to-br from-gray-50 to-gray-100">
          <div className="mx-auto max-w-md">
            <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h3 className="text-lg font-semibold text-gray-700 mb-2">No records found</h3>
            <p className="text-sm text-gray-500">Try adjusting your search criteria or filters to find what you&apos;re looking for.</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default OptimizedInventoryTable;