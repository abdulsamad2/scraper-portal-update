"use client";

import DataTable, { TableColumn, TableStyles } from "react-data-table-component";
import Link from "next/link";
import React, { useState, useEffect, useRef } from "react";

export interface InventoryRow {
  _id: string;
  section?: string;
  row?: string;
  seatCount?: number;
  seatRange?: string;
  //@ts-nocheck
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inventory?: any; // Contains all inventory and event details now
  status?: 'active' | 'deleted'; // Explicit variant instead of boolean
  deletedAt?: Date;
}

interface InventoryTableProps {
  data: InventoryRow[];
}

interface DeletedItem {
  id: string;
  deletedAt: Date;
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
      <div className="absolute bottom-full left-1/2 z-10 mb-2 w-48 -translate-x-1/2 transform rounded-lg bg-gray-700 p-2 text-center text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
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


const InventoryTable: React.FC<InventoryTableProps> = ({ data }) => {
  const [deletedItems, setDeletedItems] = useState<DeletedItem[]>([]);
  const [previousData, setPreviousData] = useState<InventoryRow[]>([]);

  // Track deleted items
  useEffect(() => {
    if (previousData.length > 0) {
      const currentIds = new Set(data.map(item => item._id));
      const newlyDeleted = previousData
        .filter(item => !currentIds.has(item._id))
        .map(item => ({ id: item._id, deletedAt: new Date() }));
      
      if (newlyDeleted.length > 0) {
        setDeletedItems(prev => [...prev, ...newlyDeleted]);
      }
    }
    setPreviousData(data);
  }, [data, previousData]);

  // Clean up deleted items after 1 minute
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      setDeletedItems(prev => 
        prev.filter(item => now.getTime() - item.deletedAt.getTime() < 60000)
      );
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Combine current data with recently deleted items using explicit status
  const displayData = [
    ...data.map(item => ({ ...item, status: 'active' as const })),
    ...deletedItems.map(deletedItem => {
      const originalItem = previousData.find(item => item._id === deletedItem.id);
      return originalItem ? {
        ...originalItem,
        status: 'deleted' as const,
        deletedAt: deletedItem.deletedAt
      } : null;
    }).filter(Boolean) as InventoryRow[]
  ];
  const columns: TableColumn<InventoryRow>[] = [
    {
      name: (
        <TableHeader.Tooltip text="The name of the event. Click to view event details.">
          <TableHeader.Root>
            <TableHeader.Title>Event Name</TableHeader.Title>
            <TableHeader.Icon />
          </TableHeader.Root>
        </TableHeader.Tooltip>
      ),
      width: "200px",
      sortable: true,
      
      cell: (row) => {
        const eventName = row.inventory?.event_name;
        const eventId = row.inventory?.eventId;
        const content = eventName && eventId ? (
          <Link href={`/dashboard/events/${eventId}`} className="text-blue-600 hover:underline font-medium">
            {eventName}
          </Link>
        ) : (
          eventName || '—'
        );
        
        // Use explicit status variants
        return row.status === 'deleted' 
          ? <RowStatus.Deleted deletedAt={row.deletedAt}>{content}</RowStatus.Deleted>
          : <RowStatus.Active>{content}</RowStatus.Active>;
      },
    },
    { 
      name: (
        <TableHeader.Tooltip text="The unique identifier for this inventory lot from the source.">
          <TableHeader.Root>
            <TableHeader.Title>Inventory ID</TableHeader.Title>
            <TableHeader.Icon />
          </TableHeader.Root>
        </TableHeader.Tooltip>
      ),
      selector: (r) => r.inventory?.inventoryId ?? "-", 
      sortable: true, 
      width: "120px",
      cell: (row) => {
        const content = row.inventory?.inventoryId ?? "-";
        return row.status === 'deleted'
          ? <RowStatus.Deleted deletedAt={row.deletedAt}>{content}</RowStatus.Deleted>
          : <RowStatus.Active>{content}</RowStatus.Active>;
      }
    },
    {
      name: (
        <TableHeader.Tooltip text="The location where the event is held.">
          <TableHeader.Root>
            <TableHeader.Title>Venue</TableHeader.Title>
            <TableHeader.Icon />
          </TableHeader.Root>
        </TableHeader.Tooltip>
      ),
      selector: (row) => row.inventory?.venue_name || "-",
      width: "180px",
      cell: (row) => {
        const content = row.inventory?.venue_name || "-";
        return row.status === 'deleted'
          ? <RowStatus.Deleted deletedAt={row.deletedAt}>{content}</RowStatus.Deleted>
          : <RowStatus.Active>{content}</RowStatus.Active>;
      }
    },
    {
      name: (
        <TableHeader.Tooltip text="The date of the event.">
          <TableHeader.Root>
            <TableHeader.Title>Event Date</TableHeader.Title>
            <TableHeader.Icon />
          </TableHeader.Root>
        </TableHeader.Tooltip>
      ),
      selector: (row) => row.inventory?.event_date,
      format: (r) =>
        r.inventory?.event_date
          ? new Date(r.inventory.event_date).toLocaleDateString()
          : "-",
      sortable: true,
      width: "120px",
      cell: (row) => {
        const content = row.inventory?.event_date
          ? new Date(row.inventory.event_date).toLocaleDateString()
          : "-";
        return row.status === 'deleted'
          ? <RowStatus.Deleted deletedAt={row.deletedAt}>{content}</RowStatus.Deleted>
          : <RowStatus.Active>{content}</RowStatus.Active>;
      }
    },
    { 
      name: (
        <TableHeader.Tooltip text="The section of the seating.">
          <TableHeader.Root>
            <TableHeader.Title>Section</TableHeader.Title>
            <TableHeader.Icon />
          </TableHeader.Root>
        </TableHeader.Tooltip>
      ),
      selector: (r) => r.inventory?.section || r.section || "", 
      sortable: true, 
      width: "100px",
      cell: (row) => {
        const content = row.inventory?.section || row.section || "";
        return row.status === 'deleted'
          ? <RowStatus.Deleted deletedAt={row.deletedAt}>{content}</RowStatus.Deleted>
          : <RowStatus.Active>{content}</RowStatus.Active>;
      }
    },
    { 
      name: (
        <TableHeader.Tooltip text="The row of the seating.">
          <TableHeader.Root>
            <TableHeader.Title>Row</TableHeader.Title>
            <TableHeader.Icon />
          </TableHeader.Root>
        </TableHeader.Tooltip>
      ),
      selector: (r) => r.inventory?.row || r.row || "", 
      sortable: true, 
      width: "80px",
      cell: (row) => {
        const content = row.inventory?.row || row.row || "";
        return row.status === 'deleted'
          ? <RowStatus.Deleted deletedAt={row.deletedAt}>{content}</RowStatus.Deleted>
          : <RowStatus.Active>{content}</RowStatus.Active>;
      }
    },
    { 
      name: (
        <TableHeader.Tooltip text="The number of seats in this group.">
          <TableHeader.Root>
            <TableHeader.Title>Seat Count</TableHeader.Title>
            <TableHeader.Icon />
          </TableHeader.Root>
        </TableHeader.Tooltip>
      ),
      selector: (r) => r.seatCount ?? 0, 
      sortable: true, 
      right: true, 
      width: "100px",
      cell: (row) => {
        const content = (row.seatCount ?? 0).toString();
        return row.status === 'deleted'
          ? <RowStatus.Deleted deletedAt={row.deletedAt}>{content}</RowStatus.Deleted>
          : <RowStatus.Active>{content}</RowStatus.Active>;
      }
    },
    { 
      name: (
        <TableHeader.Tooltip text="The range of seat numbers.">
          <TableHeader.Root>
            <TableHeader.Title>Seat Range</TableHeader.Title>
            <TableHeader.Icon />
          </TableHeader.Root>
        </TableHeader.Tooltip>
      ),
      selector: (r) => r.seatRange || "-", 
      width: "120px",
      cell: (row) => {
        const content = row.seatRange || "-";
        return row.status === 'deleted'
          ? <RowStatus.Deleted deletedAt={row.deletedAt}>{content}</RowStatus.Deleted>
          : <RowStatus.Active>{content}</RowStatus.Active>;
      }
    },
    {
      name: (
        <TableHeader.Tooltip text="Whether the seat numbers are hidden from buyers.">
          <TableHeader.Root>
            <TableHeader.Title>Hide Seats</TableHeader.Title>
            <TableHeader.Icon />
          </TableHeader.Root>
        </TableHeader.Tooltip>
      ),
      selector: (r) => (r.inventory?.hideSeatNumbers ? "Yes" : "No"),
      sortable: true,
      width: "100px",
      cell: (row) => {
        const content = row.inventory?.hideSeatNumbers ? "Yes" : "No";
        return row.status === 'deleted'
          ? <RowStatus.Deleted deletedAt={row.deletedAt}>{content}</RowStatus.Deleted>
          : <RowStatus.Active>{content}</RowStatus.Active>;
      }
    },
    { 
      name: (
        <TableHeader.Tooltip text="The cost of the tickets.">
          <TableHeader.Root>
            <TableHeader.Title>Cost</TableHeader.Title>
            <TableHeader.Icon />
          </TableHeader.Root>
        </TableHeader.Tooltip>
      ),
      selector: (r) => r.inventory?.cost?.toFixed(2) ?? "0", 
      sortable: true, 
      right: true, 
      width: "80px",
      cell: (row) => {
        const content = row.inventory?.cost?.toFixed(2) ?? "0";
        return row.status === 'deleted'
          ? <RowStatus.Deleted deletedAt={row.deletedAt}>{content}</RowStatus.Deleted>
          : <RowStatus.Active>{content}</RowStatus.Active>;
      }
    },
    { 
      name: (
        <TableHeader.Tooltip text="The price at which the tickets are listed for sale.">
          <TableHeader.Root>
            <TableHeader.Title>List Price</TableHeader.Title>
            <TableHeader.Icon />
          </TableHeader.Root>
        </TableHeader.Tooltip>
      ),
      selector: (r) => r.inventory?.listPrice?.toFixed(2) ?? "-", 
      sortable: true, 
      right: true, 
      width: "100px",
      cell: (row) => {
        const content = row.inventory?.listPrice?.toFixed(2) ?? "-";
        return row.status === 'deleted'
          ? <RowStatus.Deleted deletedAt={row.deletedAt}>{content}</RowStatus.Deleted>
          : <RowStatus.Active>{content}</RowStatus.Active>;
      }
    },
    { 
      name: (
        <TableHeader.Tooltip text="The type of ticket stock (e.g., Mobile, Hard).">
          <TableHeader.Root>
            <TableHeader.Title>Stock Type</TableHeader.Title>
            <TableHeader.Icon />
          </TableHeader.Root>
        </TableHeader.Tooltip>
      ),
      selector: (r) => r.inventory?.stockType ?? "-", 
      sortable: true, 
      width: "120px",
      cell: (row) => {
        const content = row.inventory?.stockType ?? "-";
        return row.status === 'deleted'
          ? <RowStatus.Deleted deletedAt={row.deletedAt}>{content}</RowStatus.Deleted>
          : <RowStatus.Active>{content}</RowStatus.Active>;
      }
    },
    { 
      name: (
        <TableHeader.Tooltip text="How the group of tickets can be split (e.g., Any, Even).">
          <TableHeader.Root>
            <TableHeader.Title>Split Type</TableHeader.Title>
            <TableHeader.Icon />
          </TableHeader.Root>
        </TableHeader.Tooltip>
      ),
      selector: (r) => r.inventory?.splitType ?? "-", 
      width: "120px",
      cell: (row) => {
        const content = row.inventory?.splitType ?? "-";
        return row.status === 'deleted'
          ? <RowStatus.Deleted deletedAt={row.deletedAt}>{content}</RowStatus.Deleted>
          : <RowStatus.Active>{content}</RowStatus.Active>;
      }
    },
    { 
      name: (
        <TableHeader.Tooltip text="Notes visible to the public.">
          <TableHeader.Root>
            <TableHeader.Title>Public Notes</TableHeader.Title>
            <TableHeader.Icon />
          </TableHeader.Root>
        </TableHeader.Tooltip>
      ),
      selector: (r) => r.inventory?.publicNotes ?? "-", 
      width: "200px",
      cell: (row) => {
        const content = row.inventory?.publicNotes ?? "-";
        return row.status === 'deleted'
          ? <RowStatus.Deleted deletedAt={row.deletedAt}>{content}</RowStatus.Deleted>
          : <RowStatus.Active>{content}</RowStatus.Active>;
      }
    },
    { 
      name: (
        <TableHeader.Tooltip text="Whether the tickets are available for instant transfer.">
          <TableHeader.Root>
            <TableHeader.Title>Instant Transfer</TableHeader.Title>
            <TableHeader.Icon />
          </TableHeader.Root>
        </TableHeader.Tooltip>
      ),
      selector: (r) => (r.inventory?.instant_transfer ? "Yes" : "No"), 
      sortable: true, 
      width: "120px",
      cell: (row) => {
        const content = row.inventory?.instant_transfer ? "Yes" : "No";
        return row.status === 'deleted'
          ? <RowStatus.Deleted deletedAt={row.deletedAt}>{content}</RowStatus.Deleted>
          : <RowStatus.Active>{content}</RowStatus.Active>;
      }
    },
    { 
      name: (
        <TableHeader.Tooltip text="Whether ticket files are available.">
          <TableHeader.Root>
            <TableHeader.Title>Files Available</TableHeader.Title>
            <TableHeader.Icon />
          </TableHeader.Root>
        </TableHeader.Tooltip>
      ),
      selector: (r) => (r.inventory?.files_available ? "Yes" : "No"), 
      sortable: true, 
      width: "120px",
      cell: (row) => {
        const content = row.inventory?.files_available ? "Yes" : "No";
        return row.status === 'deleted'
          ? <RowStatus.Deleted deletedAt={row.deletedAt}>{content}</RowStatus.Deleted>
          : <RowStatus.Active>{content}</RowStatus.Active>;
      }
    },
  ];

  const tableRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!tableRef.current) return;
    setIsDragging(true);
    setStartX(e.pageX - tableRef.current.offsetLeft);
    setScrollLeft(tableRef.current.scrollLeft);
    tableRef.current.style.cursor = 'grabbing';
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
    if (tableRef.current) {
      tableRef.current.style.cursor = 'grab';
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    if (tableRef.current) {
      tableRef.current.style.cursor = 'grab';
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !tableRef.current) return;
    e.preventDefault();
    const x = e.pageX - tableRef.current.offsetLeft;
    const walk = (x - startX) * 2;
    tableRef.current.scrollLeft = scrollLeft - walk;
  };

  const modernStyles: TableStyles = {
    table: {
      style: {
        minWidth: "2200px",
      },
    },
    headRow: {
      style: {
        backgroundColor: '#f8f9fa',
        borderBottomWidth: '2px',
        borderBottomColor: '#dee2e6',
        borderBottomStyle: 'solid' as const,
        fontSize: '13px',
        fontWeight: '600',
        color: '#495057',
        textTransform: 'uppercase' as const,
        minHeight: '60px',
        whiteSpace: 'nowrap' as const,
      },
    },
    headCells: {
      style: {
        paddingLeft: '16px',
        paddingRight: '16px',
        whiteSpace: 'nowrap' as const,
        overflow: 'visible' as const,
        textOverflow: 'clip' as const,
        minWidth: 'fit-content',
      },
    },
    rows: {
      style: {
        fontSize: '14px',
        '&:not(:last-of-type)': {
          borderBottomStyle: 'solid' as const,
          borderBottomWidth: '1px',
          borderBottomColor: '#e9ecef',
        },
      },
      highlightOnHoverStyle: {
        backgroundColor: '#e9ecef',
        transitionDuration: '0.15s',
        transitionProperty: 'background-color',
      },
      stripedStyle: {
        backgroundColor: '#f8f9fa',
      },
    },
    cells: {
      style: {
        padding: '14px 18px',
        whiteSpace: 'nowrap' as const,
        overflow: 'hidden' as const,
        textOverflow: 'ellipsis' as const,
      },
    },
    pagination: {
      style: {
        border: 'none',
      },
    },
  };

  // Custom row styling for deleted items
  const conditionalRowStyles = [
    {
      when: (row: InventoryRow) => row.status === 'deleted',
      style: {
        backgroundColor: '#fee2e2',
        color: '#991b1b',
        opacity: 0.8,
        '&:hover': {
          backgroundColor: '#fecaca !important',
        },
      },
    },
  ];

  return (
    <div 
      ref={tableRef}
      className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-x-auto cursor-grab select-none"
      onMouseDown={handleMouseDown}
      onMouseLeave={handleMouseLeave}
      onMouseUp={handleMouseUp}
      onMouseMove={handleMouseMove}
      style={{ userSelect: 'none' }}
    >
      <DataTable
        columns={columns}
        data={displayData}
        highlightOnHover
        persistTableHead
        pagination={false}
        keyField="_id"
        customStyles={modernStyles}
        conditionalRowStyles={conditionalRowStyles}
        striped
      />
    </div>
  );
};

export default InventoryTable;
