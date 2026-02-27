import React, { Suspense } from 'react';
import OrdersPageContent from './OrdersPageContent';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    page?: string;
    status?: string;       // comma-separated: "invoiced,pending"
    search?: string;
    marketplace?: string;
    perPage?: string;
    sortBy?: string;
    sortOrder?: string;
  }>;
}

function TableSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      {/* Controls bar skeleton */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex gap-3">
          <div className="flex-1 h-10 bg-gray-200 rounded-lg" />
          <div className="w-32 h-10 bg-gray-200 rounded-lg" />
          <div className="w-28 h-10 bg-gray-200 rounded-lg" />
        </div>
        <div className="mt-3 flex gap-4">
          <div className="h-3 bg-gray-100 rounded w-36" />
          <div className="h-3 bg-gray-100 rounded w-24" />
        </div>
      </div>

      {/* Table skeleton */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="bg-gray-50 border-b border-gray-200 px-4 py-2.5 grid grid-cols-[1fr_260px_130px_140px] gap-4">
          {['w-12', 'w-16', 'w-10', 'w-14'].map((w, i) => (
            <div key={i} className={`h-3.5 bg-gray-200 rounded ${w}`} />
          ))}
        </div>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="border-b border-gray-100 px-4 py-3 grid grid-cols-[1fr_260px_130px_140px] gap-4 items-center">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-gray-200 rounded-lg shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="flex gap-2">
                  <div className="h-3 bg-gray-100 rounded w-20" />
                  <div className="h-3 bg-gray-200 rounded w-14" />
                </div>
                <div className="h-3.5 bg-gray-200 rounded w-3/4" />
                <div className="h-3 bg-gray-100 rounded w-1/2" />
              </div>
            </div>
            <div className="flex gap-4">
              {[1,2,3,4].map(j => (
                <div key={j} className="text-center space-y-1">
                  <div className="h-4 bg-gray-200 rounded w-8 mx-auto" />
                  <div className="h-2.5 bg-gray-100 rounded w-10 mx-auto" />
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <div className="h-3.5 bg-gray-200 rounded w-16" />
              <div className="h-3 bg-gray-100 rounded w-14" />
            </div>
            <div className="space-y-1.5">
              <div className="h-3.5 bg-gray-200 rounded w-20" />
              <div className="h-3 bg-gray-100 rounded w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function OrdersPage({ searchParams }: PageProps) {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <OrdersPageContent searchParams={searchParams} />
    </Suspense>
  );
}
