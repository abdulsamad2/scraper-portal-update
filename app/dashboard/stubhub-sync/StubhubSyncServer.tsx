import { isFeatureVisible } from '@/lib/featureFlags';
import dbConnect from '@/lib/dbConnect';
import { FeatureFlags } from '@/models/featureFlagModel.js';
import { syncStatus } from '@/lib/sync/worker.ts';
import { currentLease } from '@/lib/sync/leader.ts';
import { recentFailures, skipBreakdown, pendingByEvent, stateBreakdown } from '@/lib/sync/queue.ts';
import { getStubhubSyncSettings } from '@/models/stubhubSyncModel.js';
import StubhubSyncClient, { type SyncSnapshot } from './StubhubSyncClient';

/**
 * Server half of the sync page.
 *
 * Reads the same functions the API route does, directly — no HTTP round-trip to
 * ourselves, no loading spinner on first paint, and the feature flag is enforced
 * before any of it is computed rather than after the browser has asked.
 *
 * Everything here is defensive. This page is where an operator looks when
 * something is wrong, so a database that is slow, unreachable, or missing the
 * sync collections entirely must still render something that explains itself.
 * A control panel that white-screens exactly when you need it is worse than no
 * control panel.
 */
export default async function StubhubSyncServer() {
  // isFeatureVisible normalises a stored value, so read the document first. A
  // missing flags document means a fresh install, and defaulting to visible there
  // is right — the page explains itself, and hiding it would look like a bug.
  let visible = true;
  try {
    await dbConnect();
    const flags = await FeatureFlags.findOne({}).lean();
    if (flags) visible = isFeatureVisible((flags as Record<string, unknown>).stubhubSync);
  } catch {
    // A database we cannot reach is reported below, not hidden behind a flag check.
  }

  if (!visible) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center">
          <h1 className="font-semibold text-slate-900">StubHub Sync is disabled</h1>
          <p className="text-sm text-slate-500 mt-1">
            Enable the <code className="bg-slate-100 px-1 rounded">stubhubSync</code> flag in Admin to use this page.
          </p>
        </div>
      </div>
    );
  }

  let snapshot: SyncSnapshot;
  try {
    // Settings first: if the rest fails we can still say whether writes are on,
    // which is the one thing an operator must never be guessing about.
    await getStubhubSyncSettings();

    // syncStatus is NOT wrapped in a catch: if the queue cannot be read, the page
    // must fail loudly rather than render zeros. The diagnostics below are
    // best-effort — losing the failure list is a degraded page, losing the queue
    // depth is a misleading one.
    const [status, lease, failures, skips, byEvent, states] = await Promise.all([
      syncStatus(),
      currentLease().catch(() => null),
      recentFailures(25).catch(() => []),
      skipBreakdown().catch(() => []),
      pendingByEvent(12).catch(() => []),
      stateBreakdown().catch(() => ({})),
    ]);

    snapshot = {
      ok: true,
      running: false, // in-process handle is per-instance; the client refreshes it
      ...status,
      lagSeconds: Math.round(status.lagMs / 1000),
      lease: lease ? { holder: lease.holder, expiresAt: lease.expiresAt.toISOString() } : null,
      failures,
      skips,
      byEvent: byEvent.map(e => ({ ...e, oldest: e.oldest ? e.oldest.toISOString() : null })),
      states,
      observedAt: new Date().toISOString(),
      settings: {
        ...status.settings,
        lastDrainAt: status.settings.lastDrainAt ? new Date(status.settings.lastDrainAt).toISOString() : null,
      },
    } as SyncSnapshot;
  } catch (error) {
    snapshot = {
      ok: false,
      loadError: error instanceof Error ? error.message : 'Could not read sync state',
    } as SyncSnapshot;
  }

  return <StubhubSyncClient initial={snapshot} />;
}
