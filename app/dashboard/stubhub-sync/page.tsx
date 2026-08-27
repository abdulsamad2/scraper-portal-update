import { Suspense } from 'react';
import StubhubSyncServer from './StubhubSyncServer';

// The whole page is live operational state — queue depth, sync lag, lease
// ownership. Caching any of it would show an operator a number that was true a
// minute ago while they decide whether to go live.
export const dynamic = 'force-dynamic';

function Skeleton() {
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 animate-pulse">
      <div className="h-8 w-64 bg-slate-200 rounded" />
      <div className="h-24 bg-slate-200 rounded-xl" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map(i => <div key={i} className="h-24 bg-slate-200 rounded-xl" />)}
      </div>
      <div className="h-40 bg-slate-200 rounded-xl" />
    </div>
  );
}

export default function StubhubSyncPage() {
  return (
    <Suspense fallback={<Skeleton />}>
      <StubhubSyncServer />
    </Suspense>
  );
}
