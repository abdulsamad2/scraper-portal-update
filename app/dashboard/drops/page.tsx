import { Suspense } from 'react';
import DropsView from './DropsView';
import type { DropsSearchParams } from './DropsView';

/**
 * Seat Drops — server-rendered. Filter state lives in the URL, so the server
 * resolves every view; the only client JavaScript is the live/alarm island
 * inside DropsView.
 */

export const dynamic = 'force-dynamic'; // drop data is live; never cache the shell

function DropsSkeleton() {
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-pulse">
      <div className="h-8 w-48 bg-slate-200 rounded" />
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 bg-slate-100 rounded-xl border border-slate-200" />
        ))}
      </div>
      <div className="h-10 w-full max-w-3xl bg-slate-100 rounded-lg" />
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="h-16 bg-slate-50 border-b border-slate-100" />
          {Array.from({ length: 3 }).map((_, j) => (
            <div key={j} className="h-24 border-b border-slate-100" />
          ))}
        </div>
      ))}
    </div>
  );
}

export default async function DropsPage({
  searchParams,
}: {
  searchParams: Promise<DropsSearchParams>;
}) {
  return (
    <Suspense fallback={<DropsSkeleton />}>
      <DropsView searchParams={searchParams} />
    </Suspense>
  );
}
