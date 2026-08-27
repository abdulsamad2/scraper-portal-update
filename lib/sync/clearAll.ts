/**
 * Remove every listing this account holds on StubHub.
 *
 * ── Why this is enumerated from StubHub, not from our own rows ─────────────────
 *
 * The obvious implementation is "delete every stubhubListingId we have recorded",
 * and it is wrong for the one case where this button is worth having. Orphans —
 * listings live on the marketplace with nothing local pointing at them — are
 * invisible to that query by definition, and they are exactly what cannot be
 * cleaned up any other way: the row that named the listing is gone, so no amount
 * of draining will ever reach it. A run of this integration has already produced
 * 751 of them.
 *
 * So the source of truth for "what is out there" is the full export, and this
 * deletes what StubHub says it has rather than what we think it has.
 *
 * ── Why it stops the worker ───────────────────────────────────────────────────
 *
 * The drain loop and this operation write the same listings. Left running, it
 * would re-create rows from the queue while this deletes them, and update
 * listings this has already removed — a race whose outcome depends on timing and
 * which would leave the book in a state neither side intended. Stopping is not a
 * precaution, it is a correctness requirement, so it happens automatically rather
 * than being left as an instruction the operator might skip.
 *
 * ── Why local state is reset ──────────────────────────────────────────────────
 *
 * Deleting from the marketplace and leaving rows marked synced would produce
 * total, permanent drift: every row claiming a listing that no longer exists,
 * and the worker skipping them all because nothing looks pending. Clearing the
 * recorded listing ids puts our record back in agreement with an empty
 * marketplace — and means starting the worker afterwards rebuilds the book from
 * scratch, which is the useful behaviour whether you are wiping to re-test or
 * wiping to stop.
 */

import dbConnect from '@/lib/dbConnect';
import { ConsecutiveGroup } from '@/models/seatModel.js';
import { InventoryTombstone } from '@/models/inventoryTombstoneModel.js';
import { configuredClient } from './worker.ts';
import { MAX_BATCH_ITEMS, RECONCILIATION } from '@/lib/stubhub/limits.ts';
import type { InventoryExportResource, ListingResource } from '@/lib/stubhub/types.ts';
import { submitDeletes } from './batcher.ts';
import { verifyGone } from './verify.ts';

/** Batches in flight at once. Matches the drain loop's removal path. */
const BATCH_CONCURRENCY = 32;

/** Seek calls in flight while confirming the deletes landed. */
const VERIFY_CONCURRENCY = 16;

/** Safety valve on export paging: 40 x 5,000 is 200,000 listings. */
const MAX_PAGES = 40;

/**
 * How long to let bulk deletes settle before believing a read-back, and how many
 * times to look again.
 *
 * Widening rather than fixed: most of the book clears in the first second or two,
 * and a long flat delay would make a fast wipe feel broken. Total patience is
 * just over a minute, which is far longer than any observed bulk turnaround and
 * still short enough that a genuine failure is reported promptly.
 */
const SETTLE_DELAYS_MS = [2_000, 3_000, 5_000, 10_000, 20_000, 30_000];

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export type ClearPhase =
  | 'idle' | 'stopping' | 'scanning' | 'deleting' | 'verifying' | 'resetting'
  | 'done' | 'failed';

export interface ClearProgress {
  phase: ClearPhase;
  /** Listings found on StubHub so far. */
  scanned: number;
  /** Export pages read. */
  pages: number;
  /** Delete requests accepted. */
  submitted: number;
  /** Confirmed absent by a read-back. */
  confirmed: number;
  /** Still present after the delete, or rejected outright. */
  failed: number;
  /** Local rows whose recorded listing id was cleared. */
  rowsReset: number;
  /** Read-back rounds spent waiting for the deletes to land. */
  verifyAttempts: number;
  dryRun: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  truncated: boolean;
}

const KEY = '__stubhubClearAll__';

function slot(): { progress: ClearProgress | null; running: boolean } {
  const g = globalThis as Record<string, unknown>;
  if (!g[KEY]) g[KEY] = { progress: null, running: false };
  return g[KEY] as { progress: ClearProgress | null; running: boolean };
}

export function clearProgress(): ClearProgress | null {
  return slot().progress;
}

export function clearRunning(): boolean {
  return slot().running;
}

/** Run tasks with a bounded number in flight. */
async function pooled<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        await fn(items[i]);
      }
    })
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Start the wipe. Returns immediately; watch clearProgress() for the outcome.
 *
 * It runs in the background because it cannot fit in a request. The export is
 * the slow part — StubHub caps /inventory/export/all at one call per two minutes
 * and a page holds 5,000 listings, so simply enumerating a large book takes
 * longer than any sensible HTTP timeout. Deleting is comparatively quick: bulk
 * accepts 250 ids per request at 760 requests/min.
 */
export async function startClearAll(opts: { stop: () => Promise<void> }): Promise<ClearProgress> {
  const s = slot();
  if (s.running && s.progress) return s.progress;

  // Built from the stored settings, NOT as a bare new StubHubClient().
  //
  // loadConfig resolves dryRun as `env ?? override ?? true`, so a client
  // constructed with no override defaults to dry run — a good default, and a
  // silent one. This wipe did exactly that: it reported "dry-run wipe finished,
  // nothing was deleted" against an account whose dashboard said LIVE, because
  // the dashboard's setting lives in the database and nothing had handed it to
  // the client. The worker gets this right through configuredClient; anything
  // that writes must go through the same door.
  const { client } = await configuredClient();

  const progress: ClearProgress = {
    phase: 'stopping',
    scanned: 0, pages: 0, submitted: 0, confirmed: 0, failed: 0, rowsReset: 0,
    verifyAttempts: 0,
    dryRun: client.config.dryRun,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    truncated: false,
  };
  s.progress = progress;
  s.running = true;

  void (async () => {
    try {
      // 1. Stop the drain loop. See the header: this is a correctness
      //    requirement, not a courtesy.
      await opts.stop();

      // 2. Enumerate what StubHub actually holds.
      progress.phase = 'scanning';
      const ids: number[] = [];
      let paginationToken: number | null = null;

      for (let page = 0; page < MAX_PAGES; page++) {
        const params = new URLSearchParams({
          pageSize: String(RECONCILIATION.exportPageSize),
          includePastEvents: 'true', // a past event's listing is still a listing
        });
        if (paginationToken != null) params.set('paginationToken', String(paginationToken));

        const res = await client.request<InventoryExportResource>({
          method: 'GET',
          path: `/inventory/export?${params}`,
          endpoint: 'GET /inventory/export/all',
          idempotent: true,
        });

        const body = res.data;
        const listings: ListingResource[] = body?.inventory ?? [];
        progress.pages++;
        progress.scanned += listings.length;
        for (const l of listings) if (l?.id != null) ids.push(Number(l.id));

        if (listings.length < RECONCILIATION.exportPageSize || body?.paginationToken == null) break;
        paginationToken = body.paginationToken;
        if (page === MAX_PAGES - 1) progress.truncated = true;
      }

      // 3. Delete, in parallel batches.
      //
      // Dry run stops here deliberately. Enumerating is a read and is safe, and
      // seeing the true count before wiping is the whole point of having a dry
      // run on an operation like this one.
      if (!progress.dryRun && ids.length > 0) {
        progress.phase = 'deleting';
        const batches = chunk(ids, MAX_BATCH_ITEMS);
        await pooled(batches, BATCH_CONCURRENCY, async batch => {
          try {
            await submitDeletes(client, batch);
            progress.submitted += batch.length;
          } catch (error) {
            progress.failed += batch.length;
            console.error('[stubhub:clear] batch rejected:', error);
          }
        });

        // 4. Confirm by absence rather than by status code, and give the
        //    deletes time to actually happen first.
        //
        // Bulk submits are accepted and processed asynchronously: POST returns a
        // processing id, not a result. Reading back the instant the last submit
        // returns therefore measures how fast StubHub queues work, not whether
        // the work was done — and it reports every listing as still present,
        // which is indistinguishable from a total failure.
        //
        // That is exactly what the first live run of this did: 2,745 submitted,
        // 0 confirmed, 2,745 reported failed, against an account that in fact
        // held nothing at all a moment later. The same mistake has now been made
        // three times in this integration, each time by trusting a read issued
        // too early, so this retries on a widening delay and only calls a
        // listing failed once it has survived all of them.
        progress.phase = 'verifying';
        let outstanding = ids.slice();

        for (const delay of SETTLE_DELAYS_MS) {
          if (outstanding.length === 0) break;
          await sleep(delay);
          progress.verifyAttempts++;

          const stillPresent: number[] = [];
          await pooled(chunk(outstanding, 500), VERIFY_CONCURRENCY, async probe => {
            const gone = await verifyGone(client, probe);
            for (const id of probe) if (!gone.has(id)) stillPresent.push(id);
          });

          progress.confirmed = ids.length - stillPresent.length;
          outstanding = stillPresent;
        }

        progress.failed = outstanding.length;
      }

      // 5. Put our record back in agreement with an empty marketplace.
      if (!progress.dryRun) {
        progress.phase = 'resetting';
        await dbConnect();

        const reset = await ConsecutiveGroup.updateMany(
          { 'inventory.stubhubListingId': { $exists: true } },
          {
            $unset: {
              'inventory.stubhubListingId': '',
              'inventory.syncHash': '',
              'inventory.syncError': '',
              'inventory.syncBatchId': '',
              'inventory.syncLeaseUntil': '',
            },
            $set: {
              // Not 'pending': that is the state for a row nobody has claimed
              // yet. These have been through the pipeline and are being sent
              // back to the start of it, which is what dirty means.
              'inventory.syncState': 'dirty',
              'inventory.syncPendingSince': new Date(),
              'inventory.syncAttempts': 0,
            },
          }
        );
        progress.rowsReset = reset.modifiedCount;

        // Queued removals now refer to listings that no longer exist. Leaving
        // them would have the worker issue deletes for ids already gone and
        // record the resulting nothing as failures.
        await InventoryTombstone.updateMany(
          { syncState: { $in: ['pending', 'deleting', 'failed'] } },
          { $set: { syncState: 'done', completedAt: new Date() } }
        );
      }

      progress.phase = 'done';
      progress.finishedAt = new Date().toISOString();
    } catch (error) {
      progress.phase = 'failed';
      progress.error = error instanceof Error ? error.message : String(error);
      progress.finishedAt = new Date().toISOString();
      console.error('[stubhub:clear] failed:', error);
    } finally {
      slot().running = false;
    }
  })();

  return progress;
}

/**
 * How many listings this account holds, without deleting anything.
 *
 * Used to put a real number in front of the operator before they confirm. "This
 * will delete 1,994 listings" is a decision; "this will delete everything" is a
 * leap of faith.
 */
export async function countRemoteListings(): Promise<{ count: number; truncated: boolean }> {
  const { client } = await configuredClient();
  let count = 0;
  let paginationToken: number | null = null;
  let truncated = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      pageSize: String(RECONCILIATION.exportPageSize),
      includePastEvents: 'true',
    });
    if (paginationToken != null) params.set('paginationToken', String(paginationToken));

    const res = await client.request<InventoryExportResource>({
      method: 'GET',
      path: `/inventory/export?${params}`,
      endpoint: 'GET /inventory/export/all',
      idempotent: true,
    });
    const body = res.data;
    const listings = body?.inventory ?? [];
    count += listings.length;
    if (listings.length < RECONCILIATION.exportPageSize || body?.paginationToken == null) break;
    paginationToken = body.paginationToken;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  return { count, truncated };
}
