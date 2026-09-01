import { Suspense } from 'react';
import Link from 'next/link';
import { Zap, Tag } from 'lucide-react';
import DropsView from './DropsView';
import UnderpricedView from './UnderpricedView';
import type { DropsSearchParams } from './DropsView';

/**
 * Seat Drops — server-rendered. Filter state lives in the URL, so the server
 * resolves every view; the only client JavaScript is the live/alarm island
 * inside DropsView.
 */

export const dynamic = 'force-dynamic'; // drop data is live; never cache the shell

function DropsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
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

/**
 * Two views of the same question — what needs attention right now.
 *
 * Seat drops are inventory that just appeared; underpriced listings are
 * inventory that is mispriced against its neighbours. They belong together
 * because a drop is one of the things that creates a bargain: seats landing
 * behind a listing lift the average it is measured against.
 *
 * The tab lives in the URL so it survives a refresh and can be linked to.
 */
const TABS = [
  { value: 'drops', label: 'Seat Drops', icon: Zap },
  { value: 'underpriced', label: 'Underpriced', icon: Tag },
] as const;

export default async function DropsPage({
  searchParams,
}: {
  searchParams: Promise<DropsSearchParams & { tab?: string }>;
}) {
  const params = await searchParams;
  const tab = params.tab === 'underpriced' ? 'underpriced' : 'drops';

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <nav className="flex items-center gap-1 border-b border-slate-200">
        {TABS.map(({ value, label, icon: Icon }) => {
          const active = tab === value;
          return (
            <Link
              key={value}
              href={value === 'drops' ? '/dashboard/drops' : `/dashboard/drops?tab=${value}`}
              className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                active
                  ? 'border-purple-600 text-purple-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      {tab === 'underpriced' ? (
        <UnderpricedView />
      ) : (
        <Suspense fallback={<DropsSkeleton />}>
          <DropsView searchParams={searchParams} />
        </Suspense>
      )}
    </div>
  );
}
