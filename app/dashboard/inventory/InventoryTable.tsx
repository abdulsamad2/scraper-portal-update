"use client";

import DataTable, { TableColumn, TableStyles } from "react-data-table-component";
import Link from "next/link";
import React from "react";

export interface InventoryRow {
  _id: string;
  section?: string;
  row?: string;
  seatCount?: number;
  seatRange?: string;
  inventory?: any; // Contains all inventory and event details now
}

interface InventoryTableProps {
  data: InventoryRow[];
}

// Helper component for tooltips
const Tooltip = ({ text, children }: { text: string; children: React.ReactNode }) => (
  <div className="group relative flex cursor-pointer items-center">
    {children}
    <div className="absolute bottom-full left-1/2 z-10 mb-2 w-48 -translate-x-1/2 transform rounded-lg bg-gray-700 p-2 text-center text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
      {text}
    </div>
  </div>
);

// Info icon for tooltips
const InfoIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="ml-1.5 h-4 w-4 text-gray-400">
    <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
  </svg>
);

// Custom header with tooltip
const CustomHeader = ({ title, description }: { title: string; description: string }) => (
  <Tooltip text={description}>
    <div className="flex items-center">
      <span className="font-semibold">{title}</span>
      <InfoIcon />
    </div>
  </Tooltip>
);


const InventoryTable: React.FC<InventoryTableProps> = ({ data }) => {
  const columns: TableColumn<InventoryRow>[] = [
    {
      name: <CustomHeader title="Event Name" description="The name of the event. Click to view event details." />,
      grow: 2,
      wrap: true,
      sortable: true,
      
      cell: (row) => {
        const eventName = row.inventory?.event_name;
        const eventId = row.inventory?.eventId;
        return eventName && eventId ? (
          <Link href={`/dashboard/events/${eventId}`} className="text-blue-600 hover:underline font-medium">
            {eventName}
          </Link>
        ) : (
          eventName || '—'
        );
      },
    },
    { name: <CustomHeader title="Inventory ID" description="The unique identifier for this inventory lot from the source." />, selector: (r) => r.inventory?.inventoryId ?? "-", sortable: true },
    {
      name: <CustomHeader title="Venue" description="The location where the event is held." />,
      selector: (row) => row.inventory?.venue_name || "-",
      grow: 2,
      wrap: true,
    },
    {
      name: <CustomHeader title="Event Date" description="The date and time of the event." />,
      selector: (row) => row.inventory?.event_date,
      format: (r) =>
        r.inventory?.event_date
          ? new Date(r.inventory.event_date).toLocaleString()
          : "-",
      sortable: true,
      wrap: true,
    },
    {
      name: <CustomHeader title="In Hand Date" description="The date when the tickets are expected to be available." />,
      selector: (r) => r.inventory?.inHandDate,
      format: (r) => (r.inventory?.inHandDate ? new Date(r.inventory.inHandDate).toLocaleString() : "-"),
      wrap: true,
      sortable: true,
    },
    { name: <CustomHeader title="Section" description="The section of the seating." />, selector: (r) => r.inventory?.section || r.section || "", wrap: true, sortable: true },
    { name: <CustomHeader title="Row" description="The row of the seating." />, selector: (r) => r.inventory?.row || r.row || "", wrap: true, sortable: true },
    { name: <CustomHeader title="Seat Count" description="The number of seats in this group." />, selector: (r) => r.seatCount ?? 0, sortable: true, right: true },
    { name: <CustomHeader title="Seat Range" description="The range of seat numbers." />, selector: (r) => r.seatRange || "-", wrap: true },
    {
      name: <CustomHeader title="Hide Seats" description="Whether the seat numbers are hidden from buyers." />,
      selector: (r) => (r.inventory?.hideSeatNumbers ? "Yes" : "No"),
      sortable: true,
    },
    { name: <CustomHeader title="Cost" description="The cost of the tickets." />, selector: (r) => r.inventory?.cost ?? 0, sortable: true, right: true },
    { name: <CustomHeader title="List Price" description="The price at which the tickets are listed for sale." />, selector: (r) => r.inventory?.listPrice ?? "-", sortable: true, right: true },
    { name: <CustomHeader title="Stock Type" description="The type of ticket stock (e.g., Mobile, Hard)." />, selector: (r) => r.inventory?.stockType ?? "-", sortable: true },
    { name: <CustomHeader title="Notes" description="Internal notes about the inventory." />, selector: (r) => r.inventory?.notes ?? "-", grow: 2, wrap: true },
    { name: <CustomHeader title="Split Type" description="How the group of tickets can be split (e.g., Any, Even)." />, selector: (r) => r.inventory?.splitType ?? "-" },
    { name: <CustomHeader title="Public Notes" description="Notes visible to the public." />, selector: (r) => r.inventory?.publicNotes ?? "-", grow: 2, wrap: true },
    { name: <CustomHeader title="Instant Transfer" description="Whether the tickets are available for instant transfer." />, selector: (r) => (r.inventory?.instant_transfer ? "Yes" : "No"), sortable: true },
    { name: <CustomHeader title="Files Available" description="Whether ticket files are available." />, selector: (r) => (r.inventory?.files_available ? "Yes" : "No"), sortable: true },
  ];

  const modernStyles: TableStyles = {
    table: {
      style: {
        minWidth: "1800px",
      },
    },
    headRow: {
      style: {
        backgroundColor: '#f8f9fa',
        borderBottomWidth: '2px',
        borderBottomColor: '#dee2e6',
        borderBottomStyle: 'solid' as const,
        fontSize: '12px',
        fontWeight: '600',
        color: '#495057',
        textTransform: 'uppercase' as const,
      },
    },
    headCells: {
      style: {
        paddingLeft: '16px',
        paddingRight: '16px',
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
      },
    },
    pagination: {
      style: {
        border: 'none',
      },
    },
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-x-auto">
      <DataTable
        columns={columns}
        data={data}
        highlightOnHover
        persistTableHead
        pagination
        paginationPerPage={50}
        paginationRowsPerPageOptions={[50, 100, 200]}
        keyField="_id"
        customStyles={modernStyles}
        striped
      />
    </div>
  );
};

export default InventoryTable;
