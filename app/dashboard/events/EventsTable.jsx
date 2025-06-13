'use client';

import DataTable from 'react-data-table-component';
import Link from 'next/link';
import { Eye, Edit, Trash2, Play, Square } from 'lucide-react';

export default function EventsTable({ data, toggleScraping }) {
  const columns = [
    {
      name: 'Event Name',
      selector: row => row.Event_Name,
      sortable: true,
      grow: 2,
      cell: row => (
        <div className="flex flex-col">
          <Link href={`/dashboard/events/${row._id}`} className="text-blue-600 font-medium">
            {row.Event_Name}
          </Link>
          <span className="text-xs text-gray-500">Mapping: {row.mapping_id || '—'}</span>
        </div>
      ),
      wrap: true,
    },
    {
      name: 'Venue',
      selector: row => row.Venue || 'N/A',
      sortable: true,
      wrap: true,
    },
    {
      name: 'Date',
      selector: row => row.Event_DateTime,
      sortable: true,
      format: row => (row.Event_DateTime ? new Date(row.Event_DateTime).toLocaleString() : 'N/A'),
      wrap: true,
    },
    {
      name: 'Seats',
      selector: row => row.Available_Seats || 0,
      sortable: true,
      right: true,
    },
    {
      name: '% Inc',
      selector: row => row.priceIncreasePercentage || 0,
      sortable: true,
      right: true,
      format: row => `${row.priceIncreasePercentage || 0}%`,
    },
    {
      name: 'Actions',
      button: true,
      width: '160px',
      cell: row => (
        <div className="flex justify-end space-x-2 w-full">
          <Link href={`/dashboard/events/${row._id}`} className="text-blue-600 hover:text-blue-800">
            <Eye size={18} />
          </Link>
          <Link href={`/dashboard/events/${row._id}/edit`} className="text-amber-600 hover:text-amber-800">
            <Edit size={18} />
          </Link>
          <button className="text-red-600 hover:text-red-800">
            <Trash2 size={18} />
          </button>
          <button
            onClick={() => toggleScraping(row._id, row.Skip_Scraping)}
            className={row.Skip_Scraping ? 'text-green-600 hover:text-green-800' : 'text-red-600 hover:text-red-800'}
            title={row.Skip_Scraping ? 'Start Scraping' : 'Stop Scraping'}
          >
            {row.Skip_Scraping ? <Play size={18} /> : <Square size={18} />}
          </button>
        </div>
      ),
      ignoreRowClick: true,
      allowOverflow: true,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={data}
      pagination
      highlightOnHover
      responsive
      dense
      persistTableHead
      selectableRows={false}
      keyField="_id"
    />
  );
}
