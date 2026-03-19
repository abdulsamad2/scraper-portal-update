import React, { Suspense } from 'react';
import { getConsecutiveGroupsPaginated } from '@/actions/seatActions';
import InventoryClient from './InventoryClient';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    search?: string;
    page?: string;
    perPage?: string;
    event?: string;
    mapping?: string;
    section?: string;
    row?: string;
    sortField?: string;
    sortDir?: string;
  }>;
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 bg-gray-200 rounded" />
        <div className="w-24 h-8 bg-gray-200 rounded" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="bg-white shadow-sm rounded-lg p-4 flex flex-col items-center">
            <div className="w-16 h-3 bg-gray-200 rounded mb-2" />
            <div className="w-12 h-8 bg-gray-200 rounded" />
          </div>
        ))}
      </div>
      <div className="bg-white shadow-md rounded-lg overflow-hidden">
        <div className="bg-gradient-to-r from-gray-50 to-gray-100 border-b-2 border-gray-200 px-6 py-4">
          <div className="flex gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="w-20 h-4 bg-gray-200 rounded" />
            ))}
          </div>
        </div>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="border-b border-gray-100 px-6 py-4 flex gap-4">
            {Array.from({ length: 8 }).map((_, j) => (
              <div key={j} className="w-20 h-4 bg-gray-200 rounded" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* async-parallel + server-serialization: fetch on server, pass minimal data */
async function Content({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = parseInt(params.page || '1');
  const perPage = parseInt(params.perPage || '100');
  const search = params.search || '';
  const filters = {
    event: params.event || undefined,
    mapping: params.mapping || undefined,
    section: params.section || undefined,
    row: params.row || undefined,
  };

  const resp = await getConsecutiveGroupsPaginated(perPage, page, search, filters);

  if ('error' in resp) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <p className="text-sm font-medium text-red-700">{resp.error}</p>
      </div>
    );
  }

  return (
    <InventoryClient
      data={resp.groups}
      totalGroups={resp.total}
      totalQty={resp.totalQuantity}
      currentPage={page}
      perPage={perPage}
      currentSearch={search}
      currentFilters={{
        event: params.event || '',
        mapping: params.mapping || '',
        section: params.section || '',
        row: params.row || '',
      }}
      sortField={params.sortField || ''}
      sortDir={(params.sortDir as 'asc' | 'desc') || 'asc'}
    />
  );
}

export default async function InventoryPage({ searchParams }: PageProps) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}
