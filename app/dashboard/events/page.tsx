import React, { Suspense } from 'react';
import EventsTableServerSide from './EventsTableServerSide';

interface PageProps {
  searchParams: Promise<{
    page?: string;
    search?: string;
    limit?: string;
    dateFrom?: string;
    dateTo?: string;
    venue?: string;
    scrapingStatus?: string;
    sortBy?: string;
    seatMin?: string;
    seatMax?: string;
  }>;
}

function TableSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      {/* Controls bar skeleton */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex gap-3">
          <div className="flex-1 h-10 bg-gray-200 rounded-lg" />
          <div className="w-28 h-10 bg-gray-200 rounded-lg" />
          <div className="w-28 h-10 bg-gray-200 rounded-lg" />
        </div>
        <div className="mt-3 flex gap-4">
          <div className="h-3 bg-gray-100 rounded w-36" />
          <div className="h-3 bg-gray-100 rounded w-24" />
        </div>
      </div>

      {/* Table skeleton */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="bg-gray-50 border-b border-gray-200 px-3 py-2.5 grid grid-cols-[80px_1fr_120px_70px_70px_120px_150px] gap-3">
          {['w-12','w-20','w-16','w-8','w-8','w-16','w-14'].map((w, i) => (
            <div key={i} className={`h-3.5 bg-gray-200 rounded ${w}`} />
          ))}
        </div>
        {/* Rows */}
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="border-b border-gray-100 px-3 py-2 grid grid-cols-[80px_1fr_120px_70px_70px_120px_150px] gap-3 items-center"
          >
            {/* Status */}
            <div className="h-5 bg-gray-100 rounded-full w-16" />
            {/* Event details */}
            <div className="space-y-1.5 min-w-0">
              <div className="h-3.5 bg-gray-200 rounded w-3/4" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
            </div>
            {/* Date */}
            <div className="space-y-1.5">
              <div className="h-3.5 bg-gray-100 rounded w-20" />
              <div className="h-3 bg-gray-100 rounded w-12" />
            </div>
            {/* Seats */}
            <div className="h-5 bg-gray-100 rounded w-10 ml-auto" />
            {/* Price % */}
            <div className="h-5 bg-gray-100 rounded-full w-10 ml-auto" />
            {/* Last updated */}
            <div className="space-y-1.5">
              <div className="h-3.5 bg-gray-100 rounded w-14 mx-auto" />
              <div className="h-3 bg-gray-100 rounded w-16 mx-auto" />
            </div>
            {/* Actions */}
            <div className="flex gap-1.5 justify-end">
              <div className="h-7 w-7 bg-gray-100 rounded-lg" />
              <div className="h-7 w-7 bg-gray-100 rounded-lg" />
              <div className="h-7 w-16 bg-gray-100 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function EventsPage({ searchParams }: PageProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-indigo-100 p-4">
      <div className="max-w-screen-2xl mx-auto">
        <Suspense fallback={<TableSkeleton />}>
          <EventsTableServerSide searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}