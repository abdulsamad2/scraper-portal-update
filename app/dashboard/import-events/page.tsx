import { Suspense } from 'react';
import ImportEventsServer from './ImportEventsServer';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    keyword?: string;
    city?: string;
    stateCode?: string;
    startDate?: string;
    endDate?: string;
    segment?: string;
    page?: string;
  }>;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Import Events</h1>
        <p className="text-sm text-slate-500 mt-1">Search Ticketmaster &amp; import US events with Vivid Seats mapping</p>
      </div>

      {/* Search bar skeleton */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="flex items-center gap-2 p-3">
          <div className="flex-1 h-[42px] bg-slate-100 rounded-lg animate-pulse" />
          <div className="w-[100px] h-[42px] bg-purple-100 rounded-lg animate-pulse" />
        </div>
        <div className="border-t border-slate-100 bg-slate-50/50 px-3 pb-3 pt-2.5">
          <div className="flex items-end gap-3">
            <div className="flex-1 min-w-[140px] space-y-1">
              <div className="h-3 w-16 bg-slate-200 rounded animate-pulse" />
              <div className="h-[38px] bg-slate-100 rounded-lg animate-pulse" />
            </div>
            <div className="flex-1 min-w-[140px] space-y-1">
              <div className="h-3 w-14 bg-slate-200 rounded animate-pulse" />
              <div className="h-[38px] bg-slate-100 rounded-lg animate-pulse" />
            </div>
            <div className="flex-1 min-w-[120px] space-y-1">
              <div className="h-3 w-16 bg-slate-200 rounded animate-pulse" />
              <div className="h-[38px] bg-slate-100 rounded-lg animate-pulse" />
            </div>
            <div className="w-[60px] h-[38px] bg-slate-100 rounded-lg animate-pulse" />
          </div>
        </div>
      </div>

      {/* Results header skeleton */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-28 bg-orange-100 rounded-lg animate-pulse" />
          <div className="flex gap-1.5">
            {[1,2,3,4].map(i => (
              <div key={i} className="h-7 w-16 bg-slate-100 rounded-full animate-pulse" />
            ))}
          </div>
        </div>
        <div className="h-7 w-20 bg-slate-100 rounded-lg animate-pulse" />
      </div>

      {/* Card grid skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="h-40 bg-gradient-to-br from-slate-100 to-slate-200 animate-pulse" />
            <div className="p-4 space-y-3">
              <div className="space-y-1.5">
                <div className="h-4 w-[85%] bg-slate-200 rounded animate-pulse" />
                <div className="h-4 w-[60%] bg-slate-200 rounded animate-pulse" />
              </div>
              <div className="space-y-1.5">
                <div className="h-3 w-[70%] bg-slate-100 rounded animate-pulse" />
                <div className="h-3 w-[55%] bg-slate-100 rounded animate-pulse" />
              </div>
              <div className="h-3 w-[40%] bg-slate-100 rounded animate-pulse" />
              <div className="flex gap-1.5">
                <div className="h-5 w-14 bg-slate-100 rounded animate-pulse" />
                <div className="h-5 w-16 bg-slate-100 rounded animate-pulse" />
              </div>
              <div className="pt-2 space-y-2">
                <div className="h-9 bg-slate-100 rounded-lg animate-pulse" />
                <div className="h-9 bg-slate-100 rounded-lg animate-pulse" />
                <div className="h-9 bg-purple-100 rounded-lg animate-pulse" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ImportEventsPage({ searchParams }: PageProps) {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <ImportEventsServer searchParams={searchParams} />
    </Suspense>
  );
}
