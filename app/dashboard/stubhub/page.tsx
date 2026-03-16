import { Suspense } from 'react';
import { getStubHubEventsPaginated, getEventComparison } from '@/actions/stubhubActions';
import type { StubHubSortBy, SortOrder } from '@/actions/stubhubActions';
import StubHubEventsView from './StubHubClient';
import EventDetailView from './EventDetailClient';
import { BarChart3 } from 'lucide-react';

export const dynamic = 'force-dynamic';

type Filter = 'ALL' | 'WITH_URL' | 'NO_URL' | 'ACTIVE' | 'AUTO_PRICE';

const VALID_SORT_BY: StubHubSortBy[] = ['eventDate', 'lastScraped', 'status', 'name', 'updatedAt'];
const VALID_SORT_ORDER: SortOrder[] = ['asc', 'desc'];

interface PageProps {
  searchParams: Promise<{
    search?: string;
    filter?: string;
    page?: string;
    perPage?: string;
    event?: string;
    sortBy?: string;
    sortOrder?: string;
  }>;
}

/* ─── Skeleton ─── */
function TableSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="w-52 h-8 bg-gray-200 rounded" />
          <div className="w-64 h-4 bg-gray-100 rounded" />
        </div>
        <div className="flex gap-2">
          <div className="w-52 h-9 bg-gray-200 rounded" />
          <div className="flex gap-1">
            {[1, 2, 3].map(i => <div key={i} className="w-20 h-9 bg-gray-200 rounded" />)}
          </div>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-gray-200/60 shadow-lg overflow-hidden">
        <div className="bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-300/50 px-6 py-4">
          <div className="grid grid-cols-7 gap-6">
            {[240, 160, 120, 160, 120, 110, 120].map((w, i) => (
              <div key={i} className="h-4 bg-gray-200 rounded" style={{ width: w }} />
            ))}
          </div>
        </div>
        {[...Array(8)].map((_, i) => (
          <div key={i} className={`px-6 py-4 border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}`}>
            <div className="grid grid-cols-7 gap-6 items-center">
              <div className="h-4 w-48 bg-gray-200 rounded" />
              <div className="h-4 w-32 bg-gray-100 rounded" />
              <div className="h-4 w-24 bg-gray-100 rounded" />
              <div className="h-6 w-20 bg-gray-200 rounded-full" />
              <div className="h-4 w-20 bg-gray-100 rounded" />
              <div className="h-6 w-16 bg-gray-200 rounded-full" />
              <div className="h-7 w-20 bg-gray-200 rounded ml-auto" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-24 h-9 bg-gray-200 rounded" />
        <div className="space-y-1.5">
          <div className="w-72 h-6 bg-gray-200 rounded" />
          <div className="w-48 h-4 bg-gray-100 rounded" />
        </div>
      </div>
      <div className="grid grid-cols-6 gap-4">
        {[...Array(6)].map((_, i) => <div key={i} className="h-20 bg-white border rounded-lg" />)}
      </div>
      <div className="h-64 bg-white border rounded-xl" />
    </div>
  );
}

/* ─── Page ─── */
export default async function StubHubPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const eventId = sp.event;

  if (eventId) {
    return (
      <Suspense fallback={<DetailSkeleton />}>
        <EventDetailContent eventId={eventId} />
      </Suspense>
    );
  }

  const sortBy = VALID_SORT_BY.includes(sp.sortBy as StubHubSortBy) ? (sp.sortBy as StubHubSortBy) : 'eventDate';
  const sortOrder = VALID_SORT_ORDER.includes(sp.sortOrder as SortOrder) ? (sp.sortOrder as SortOrder) : 'asc';

  return (
    <Suspense fallback={<TableSkeleton />}>
      <EventsListContent
        search={sp.search || ''}
        filter={(sp.filter as Filter) || 'ACTIVE'}
        page={parseInt(sp.page || '1', 10)}
        perPage={parseInt(sp.perPage || '20', 10)}
        sortBy={sortBy}
        sortOrder={sortOrder}
      />
    </Suspense>
  );
}

/* ─── Events List (server) ─── */
async function EventsListContent({
  search, filter, page, perPage, sortBy, sortOrder,
}: { search: string; filter: Filter; page: number; perPage: number; sortBy: StubHubSortBy; sortOrder: SortOrder }) {
  const res = await getStubHubEventsPaginated({ search, filter, page, perPage, sortBy, sortOrder });

  if (!res.success || !res.events) {
    return (
      <div className="text-center py-24">
        <BarChart3 className="w-16 h-16 text-slate-200 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-700 mb-2">No events yet</h2>
        <p className="text-slate-500 text-sm">
          Import events first, then add a StubHub URL to each event to start comparing prices.
        </p>
      </div>
    );
  }

  return (
    <StubHubEventsView
      events={res.events}
      pagination={res.pagination!}
      counts={res.counts!}
      currentSearch={search}
      currentFilter={filter}
      currentSortBy={sortBy}
      currentSortOrder={sortOrder}
    />
  );
}

/* ─── Event Detail (server) ─── */
async function EventDetailContent({ eventId }: { eventId: string }) {
  const res = await getEventComparison(eventId);

  if (!res.success || !res.event) {
    return (
      <div className="text-center py-24">
        <BarChart3 className="w-16 h-16 text-slate-200 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-700 mb-2">Event not found</h2>
        <p className="text-slate-500 text-sm">{res.error || 'Unable to load comparison data.'}</p>
      </div>
    );
  }

  return (
    <EventDetailView
      event={res.event}
      rows={res.rows ?? []}
      summary={res.summary!}
      sales={res.sales}
    />
  );
}
