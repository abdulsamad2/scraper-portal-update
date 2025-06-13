"use client";

import DataTable, { TableColumn } from "react-data-table-component";
import Link from "next/link";
import React from "react";

export interface InventoryRow {
  _id: string;
  eventId?: string;
  mapping_id?: string;
  venue_name?: string;
  event_date?: string;
  section?: string;
  row?: string;
  seatCount?: number;
  seatRange?: string;
  inventory?: any;
}

interface InventoryTableProps {
  data: InventoryRow[];
  eventsMap: Record<string, any>;
}

const InventoryTable: React.FC<InventoryTableProps> = ({ data, eventsMap }) => {
  const columns: TableColumn<InventoryRow>[] = [
    {
      name: "Event Name",
      grow: 2,
      wrap: true,
      sortable: true,
      cell: (row) => {
        const ev = eventsMap[row.eventId ?? ""] || {};
        return ev.Event_Name ? (
          <Link href={`/dashboard/events/${ev._id}`} className="text-blue-600 font-medium">
            {ev.Event_Name}
          </Link>
        ) : (
          "—"
        );
      },
    },
    { name: "Inventory ID", selector: (r) => r.inventory?.inventoryId ?? "-" },

    {
      name: "Mapping ID",
      selector: (row) => eventsMap[row.eventId ?? ""]?.mapping_id || row.mapping_id || "—",
      sortable: true,
      wrap: true,
    },
    {
      name: "Venue",
      selector: (row) => row.venue_name || eventsMap[row.eventId ?? ""]?.Venue || "-",
      grow: 2,
      wrap: true,
    },
    {
      name: "Event Date",
      selector: (row) => row.event_date || eventsMap[row.eventId ?? ""]?.Event_DateTime,
      format: (r) =>
        r.event_date || eventsMap[r.eventId ?? ""]?.Event_DateTime
          ? new Date(r.event_date || eventsMap[r.eventId ?? ""]?.Event_DateTime).toLocaleString()
          : "-",
      sortable: true,
      wrap: true,
    },
    {
      name: "In Hand Date",
      selector: (r) => r.inventory?.inHandDate,
      format: (r) => (r.inventory?.inHandDate ? new Date(r.inventory.inHandDate).toLocaleString() : "-"),
      wrap: true,
    },
    { name: "Section", selector: (r) => r.section ?? "", wrap: true },
    { name: "Row", selector: (r) => r.row ?? "", wrap: true },
    { name: "Seat Count", selector: (r) => r.seatCount ?? 0, sortable: true, right: true },
    { name: "Seat Range", selector: (r) => r.seatRange || "-", wrap: true },
    {
      name: "Hide Seat Numbers",
      selector: (r) => (r.inventory?.hideSeatNumbers ? "Yes" : "No"),
    },
    { name: "Cost", selector: (r) => r.inventory?.cost ?? 0, right: true },
    { name: "Taxed Cost", selector: (r) => r.inventory?.taxed_cost ?? "-", right: true },
    { name: "List Price", selector: (r) => r.inventory?.listPrice ?? "-", right: true },
    { name: "Stock Type", selector: (r) => r.inventory?.stockType ?? "-" },
    { name: "Line Type", selector: (r) => r.inventory?.lineType ?? "-" },
    { name: "Seat Type", selector: (r) => r.inventory?.seatType ?? "-" },
    { name: "Notes", selector: (r) => r.inventory?.notes ?? "-", grow: 2, wrap: true },
    { name: "Split Type", selector: (r) => r.inventory?.splitType ?? "-" },
    { name: "Public Notes", selector: (r) => r.inventory?.publicNotes ?? "-", grow: 2, wrap: true },
    { name: "Instant Transfer", selector: (r) => (r.inventory?.instant_transfer ? "Yes" : "No") },
    { name: "Files Available", selector: (r) => (r.inventory?.files_available ? "Yes" : "No") },
  ];

  return (
    <div className="overflow-x-auto">
      <DataTable
        columns={columns}
        data={data}
        highlightOnHover
        persistTableHead
        pagination
        paginationPerPage={50}
        paginationRowsPerPageOptions={[50]}
        keyField="_id"
        customStyles={{
          table: {
            style: {
              minWidth: "1600px", // ensure horizontal scroll appears on small screens
            },
          },
        }}
      />
    </div>
  );
};

export default InventoryTable;
