/**
 * The drain loop.
 *
 * Thin on purpose — planning, mapping, batching and state transitions all live
 * below it. What is left here is orchestration and the safety checks, which is
 * the part worth being able to read in one sitting.
 *
 * ── Where prices come from ─────────────────────────────────────────────────────
 *
 * The worker asks generateInventoryCsv for its rows rather than reading
 * inventory.listPrice out of Mongo. Markup runs in two stages and only the
 * second — the event's standard, resale and broker adjustments — produces the
 * number we actually list at.
 *
 * This is not hypothetical. In production 201 of 363 active events carry a
 * non-zero broker adjustment and 6 carry a standard one, and priceIncreasePercentage
 * varies across six values. A worker reading inventory.listPrice would mis-price
 * the broker rows on more than half the active book, silently and immediately.
 * Sharing the exporter's output keeps one implementation of the markup chain with
 * two consumers, and makes "worker price equals CSV price" true by construction
 * rather than by assertion.
 *
 * Rows are built for ONLY the events a drain claimed, not the whole book.
 *
 * An earlier version cached the whole book for 60s instead. That was wrong, and
 * not merely slow: the worker decides a row is already in sync by comparing the
 * hash of its mapped payload against syncHash. Feed it a stale row and it hashes
 * the OLD price, matches the OLD hash, and marks the row synced — silently
 * discarding the change that made it dirty in the first place. The price would
 * then stay wrong on StubHub until something else about that row happened to
 * change. Scoping by event removes the staleness rather than bounding it.
 *
 * ── Why it drains rather than ticks ────────────────────────────────────────────
 *
 * There is no fixed interval. The loop takes whatever is pending, sends it, and
 * immediately looks again; it sleeps only when the queue is empty. Batching then
 * happens because of load rather than in anticipation of it, so latency is one
 * round trip when quiet and throughput rises under pressure without anyone
 * tuning a window.
 */

import { generateInventoryCsv } from '@/actions/csvActions';
import { StubHubClient, StubHubError, loadConfig } from '@/lib/stubhub/client.ts';
import { mapRow, type InventoryRowInput } from '@/lib/stubhub/mapRow.ts';
import { payloadHash } from '@/lib/stubhub/hash.ts';
import { planBatch, resolveRemoval, IDLE_POLL_MS } from '@/lib/stubhub/policy.ts';
import { SINGLE_CALL_THRESHOLD } from '@/lib/stubhub/limits.ts';
import {
  claimRows, claimTombstones, markSynced, markCreated, markFailed, markSkipped,
  markDelisted, markTombstoneDone, markTombstoneFailed, cancelTombstone,
  queueDepth, MAX_ATTEMPTS,
} from './queue.ts';
import {
  submitCreates, submitUpdates, patchOne, delistOne, deleteOne,
  type CreateItem, type UpdateItem, type ItemOutcome,
} from './batcher.ts';
import { acquireLease, releaseLease, makeHolderId, RENEW_INTERVAL_MS } from './leader.ts';
import { getStubhubSyncSettings, StubhubSyncSettings } from '@/models/stubhubSyncModel.js';
import type { ApiMarketplace } from '@/lib/stubhub/types.ts';

/**
 * A client configured from the operator's stored settings.
 *
 * Built per call rather than once, because dryRun and the marketplace list are
 * meant to be changeable while the loop is running — flipping to live, or
 * stopping writes, should not need a restart.
 */
export async function configuredClient(): Promise<{ client: StubHubClient; marketplaces: ApiMarketplace[] }> {
  const settings = await getStubhubSyncSettings();
  return {
    client: new StubHubClient(loadConfig(process.env, { dryRun: settings.dryRun })),
    marketplaces: (settings.marketplaces?.length ? settings.marketplaces : ['StubHub']) as ApiMarketplace[],
  };
}

/**
 * Abort a cycle if this share of claimed rows cannot be resolved to a StubHub
 * event. A handful of unmappable rows is ordinary — tickets.com inventory has no
 * StubHub event id and never will until it is backfilled. Most of the book going
 * unresolvable at once is not ordinary; it means a bad deploy or a data problem,
 * and the correct response is to stop rather than to act on a book we suddenly
 * cannot describe.
 */
const SKIP_ABORT_RATIO = Number(process.env.STUBHUB_SKIP_ABORT_RATIO ?? 0.9);

/** Rows claimed per pass. Independent of batch size; a pass may send several batches. */
const CLAIM_SIZE = Number(process.env.STUBHUB_CLAIM_SIZE ?? 500);

/**
 * How many listings may be updated concurrently on the single-call fast path.
 *
 * PATCH /inventory/{id} allows 12,880/min, so latency rather than budget is the
 * binding constraint here — one round trip is ~300ms, and doing them one after
 * another would make a 30-row event take ten seconds for no reason.
 */
const PATCH_CONCURRENCY = Number(process.env.STUBHUB_PATCH_CONCURRENCY ?? 8);

/**
 * Build the exporter's rows for just these events.
 *
 * Scoped rather than whole-book, and never reused across drains: see the note at
 * the top of this file about why a cached book silently loses price changes.
 */
async function rowsForEvents(mappingIds: string[]): Promise<{ rows: InventoryRowInput[] | null; error?: string }> {
  const csv = await generateInventoryCsv(0, {
    mappingIds,
    // A drain runs many times a minute; it must not keep re-triggering a policy
    // step that disables events.
    skipLowSeatStop: true,
  });
  if (!csv.success || !csv.rows) return { rows: null, error: csv.message ?? 'unknown' };
  return { rows: csv.rows as InventoryRowInput[] };
}

/** Run tasks with bounded concurrency, preserving input order in the results. */
async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface DrainResult {
  claimed: number;
  created: number;
  updated: number;
  noop: number;
  skipped: number;
  failed: number;
  delisted: number;
  deleted: number;
  cancelled: number;
  aborted: string | null;
  more: boolean;
}

const EMPTY: DrainResult = {
  claimed: 0, created: 0, updated: 0, noop: 0, skipped: 0,
  failed: 0, delisted: 0, deleted: 0, cancelled: 0, aborted: null, more: false,
};

/**
 * One pass: claim, map, send, record.
 *
 * Returns `more: true` when work remains, so the caller loops again immediately
 * instead of sleeping.
 */
export async function drainOnce(client?: StubHubClient, marketplaces?: ApiMarketplace[]): Promise<DrainResult> {
  const result: DrainResult = { ...EMPTY };

  if (!client || !marketplaces) {
    const configured = await configuredClient();
    client = client ?? configured.client;
    marketplaces = marketplaces ?? configured.marketplaces;
  }

  const rows = await claimRows(CLAIM_SIZE);
  const tombstones = await claimTombstones(CLAIM_SIZE);
  result.claimed = rows.length + tombstones.length;
  if (result.claimed === 0) return result;

  // Removals first. An unavailable listing must stop selling before anything else
  // is attempted — if the cycle later aborts, we want to have already protected
  // against overselling rather than to have queued it behind price updates.
  Object.assign(result, await processTombstones(client, tombstones, result));

  if (rows.length > 0) {
    const rowResult = await processRows(client, rows, marketplaces);
    result.created += rowResult.created;
    result.updated += rowResult.updated;
    result.noop += rowResult.noop;
    result.skipped += rowResult.skipped;
    result.failed += rowResult.failed;
    result.aborted = rowResult.aborted;
  }

  result.more = result.claimed >= CLAIM_SIZE && !result.aborted;
  return result;
}

async function processTombstones(
  client: StubHubClient,
  tombstones: Awaited<ReturnType<typeof claimTombstones>>,
  acc: DrainResult
): Promise<Partial<DrainResult>> {
  let delisted = 0, deleted = 0, cancelled = 0, failed = acc.failed;
  const now = new Date();

  for (const t of tombstones) {
    const decision = resolveRemoval({
      stubhubListingId: t.stubhubListingId,
      delistedAt: t.delistedAt,
      // The scraper deletes the row and writes the tombstone atomically, so a row
      // that came back has a fresh document and a stale tombstone. Reappearance is
      // detected by the row existing again, which the next claim surfaces as a
      // pending create — so here we only need the tombstone's own state.
      reappeared: false,
      reason: t.reason,
      now,
    });

    try {
      if (decision.action === 'cancel') {
        await cancelTombstone(t._id);
        cancelled++;
      } else if (decision.action === 'delist' && t.stubhubListingId) {
        const outcome = await delistOne(client, Number(t.stubhubListingId));
        if (outcome.ok) { await markDelisted(t._id, now); delisted++; }
        else { await markTombstoneFailed(t._id, outcome.error!, t.syncAttempts); failed++; }
      } else if (decision.action === 'delete' && t.stubhubListingId) {
        const outcome = await deleteOne(client, Number(t.stubhubListingId));
        if (outcome.ok) { await markTombstoneDone(t._id); deleted++; }
        else { await markTombstoneFailed(t._id, outcome.error!, t.syncAttempts); failed++; }
      }
      // 'wait' leaves it claimed-but-untouched; the lease expires and the next
      // drain reconsiders it once the grace window has passed.
    } catch (error) {
      await markTombstoneFailed(t._id, String(error), t.syncAttempts);
      failed++;
    }
  }

  return { delisted, deleted, cancelled, failed };
}

async function processRows(
  client: StubHubClient,
  rows: Awaited<ReturnType<typeof claimRows>>,
  marketplaces: ApiMarketplace[]
): Promise<{ created: number; updated: number; noop: number; skipped: number; failed: number; aborted: string | null }> {
  const out = { created: 0, updated: 0, noop: 0, skipped: 0, failed: 0, aborted: null as string | null };

  // The exporter is the single source of the final price. Build only the events
  // this pass claimed — typically a handful, since a scrape cycle marks one
  // event's rows dirty at a time.
  const mappingIds = [...new Set(rows.map(r => r.mapping_id).filter(Boolean))];
  const { rows: allRows, error } = await rowsForEvents(mappingIds);
  if (!allRows) {
    out.aborted = `could not build rows: ${error}`;
    return out;
  }

  const byInventoryId = new Map<number, InventoryRowInput>();
  for (const r of allRows) byInventoryId.set(Number(r.inventory_id), r);

  const creates: CreateItem[] = [];
  const updates: UpdateItem[] = [];
  const byExternalId = new Map<string, { rowId: unknown; hash: string; attempts: number }>();

  for (const row of rows) {
    const source = byInventoryId.get(Number(row.inventoryId));
    if (!source) {
      // Claimed but absent from the export — excluded by a rule, a stopped event,
      // or already gone. Not an error; it simply has nothing to say right now.
      await markSkipped(row._id, 'row not present in current export');
      out.skipped++;
      continue;
    }

    const mapped = mapRow(source, { marketplaces });
    if (!mapped.ok) {
      await markSkipped(row._id, `${mapped.reason}: ${mapped.detail}`);
      out.skipped++;
      continue;
    }

    const hash = payloadHash([mapped.create, mapped.update]);

    // The hash gate. A row whose payload matches what StubHub already accepted
    // costs nothing — no request, no rate budget, no risk — and in steady state
    // this is the overwhelming majority.
    if (row.syncHash === hash && row.stubhubListingId) {
      await markSynced(row._id, hash);
      out.noop++;
      continue;
    }

    byExternalId.set(mapped.externalId, { rowId: row._id, hash, attempts: row.syncAttempts });

    if (row.stubhubListingId) {
      updates.push({
        rowId: row._id,
        externalId: mapped.externalId,
        listingId: Number(row.stubhubListingId),
        payload: mapped.update,
        hash,
      });
    } else {
      creates.push({ rowId: row._id, externalId: mapped.externalId, payload: mapped.create, hash });
    }
  }

  // Circuit breaker. Evaluated before anything is sent, not as a handler after
  // something has gone wrong.
  const actionable = creates.length + updates.length;
  if (rows.length > 0 && out.skipped / rows.length > SKIP_ABORT_RATIO && actionable === 0) {
    out.aborted =
      `${out.skipped}/${rows.length} rows unresolvable — aborting rather than acting on a book we cannot describe`;
    console.error(`[stubhub:worker] ${out.aborted}`);
    return out;
  }

  // Creates first: an update needs a listing id, and a row created this pass will
  // be picked up for pricing on the next one.
  for (let i = 0; i < creates.length; i += 250) {
    const chunk = creates.slice(i, i + 250);

    // A batch that throws — a validation rejection, a network failure — must not
    // leave its rows holding a lease until it expires. Five minutes of a stalled
    // queue for something that will still be broken next pass is worse than
    // recording the failure now, and the attempt counter is what eventually parks
    // a row that can never succeed.
    let results: Map<string, ItemOutcome>;
    try {
      results = await submitCreates(client, chunk);
    } catch (error) {
      const reason = error instanceof StubHubError ? error.summary : String(error);
      console.error(`[stubhub:worker] create batch failed: ${reason}`);
      for (const item of chunk) {
        const meta = byExternalId.get(item.externalId)!;
        await markFailed(meta.rowId, reason, meta.attempts);
        out.failed++;
      }
      continue;
    }

    for (const item of chunk) {
      const meta = byExternalId.get(item.externalId)!;
      const outcome = results.get(item.externalId);
      if (outcome?.ok && outcome.entityId) {
        // Deliberately `created`, not `synced`: it has no price yet.
        await markCreated(meta.rowId, String(outcome.entityId));
        out.created++;
      } else if (outcome) {
        await markFailed(meta.rowId, outcome.error ?? 'create failed', meta.attempts);
        out.failed++;
      }
      // No outcome at all means the batch is still draining. The lease expires and
      // the next pass re-reads it; nothing is resubmitted blind.
    }
  }

  if (updates.length > 0) {
    const plan = planBatch(updates.length, 'update');

    if (plan.path === 'single' && updates.length <= SINGLE_CALL_THRESHOLD) {
      // Concurrent, not sequential: these are independent listings and the point
      // of taking the single-call path at all is to land the change now.
      const outcomes = await pooled(updates, PATCH_CONCURRENCY, item => patchOne(client, item));
      for (let i = 0; i < updates.length; i++) {
        const meta = byExternalId.get(updates[i].externalId)!;
        const outcome = outcomes[i];
        if (outcome.ok) { await markSynced(meta.rowId, meta.hash); out.updated++; }
        else { await markFailed(meta.rowId, outcome.error!, meta.attempts); out.failed++; }
      }
    } else {
      for (let i = 0; i < updates.length; i += 250) {
        const chunk = updates.slice(i, i + 250);

        let results: Map<string, ItemOutcome>;
        try {
          results = await submitUpdates(client, chunk);
        } catch (error) {
          const reason = error instanceof StubHubError ? error.summary : String(error);
          console.error(`[stubhub:worker] update batch failed: ${reason}`);
          for (const item of chunk) {
            const meta = byExternalId.get(item.externalId)!;
            await markFailed(meta.rowId, reason, meta.attempts);
            out.failed++;
          }
          continue;
        }

        for (const item of chunk) {
          const meta = byExternalId.get(item.externalId)!;
          const outcome = results.get(item.externalId);
          if (outcome?.ok) { await markSynced(meta.rowId, meta.hash); out.updated++; }
          else if (outcome) { await markFailed(meta.rowId, outcome.error ?? 'update failed', meta.attempts); out.failed++; }
        }
      }
    }
  }

  return out;
}

/**
 * Run the drain loop until stopped.
 *
 * Holds a lease throughout and renews it on a timer. If the lease is ever lost —
 * a pause long enough for it to expire, another instance taking over — the loop
 * stops immediately rather than continuing as an uncoordinated second writer.
 * The API has no concurrency control to catch that mistake, so this is the only
 * place it can be caught.
 */
export async function runWorker(signal?: AbortSignal): Promise<void> {
  const holder = makeHolderId();

  if (!new StubHubClient().configured) {
    console.warn('[stubhub:worker] not configured — set STUBHUB_BEARER_TOKEN and STUBHUB_ACCOUNT_ID');
    return;
  }

  let renewTimer: NodeJS.Timeout | null = null;

  try {
    if (!(await acquireLease(holder))) {
      console.log('[stubhub:worker] another instance holds the lease; standing down');
      return;
    }
    renewTimer = setInterval(() => { void acquireLease(holder); }, RENEW_INTERVAL_MS);

    while (!signal?.aborted) {
      if (!(await acquireLease(holder))) {
        console.warn('[stubhub:worker] lost the lease — stopping to avoid a second writer');
        break;
      }

      // Re-read settings each pass so dryRun and the marketplace list can be
      // changed from the dashboard without restarting the loop.
      const { client, marketplaces } = await configuredClient();
      const result = await drainOnce(client, marketplaces);
      await recordDrain(result);

      if (result.aborted) {
        console.error(`[stubhub:worker] cycle aborted: ${result.aborted}`);
        await sleep(IDLE_POLL_MS * 5);
        continue;
      }

      if (result.claimed > 0) {
        console.log(
          `[stubhub:worker] ${result.created}C ${result.updated}U ${result.noop}= ` +
          `${result.delisted}L ${result.deleted}D ${result.cancelled}X ` +
          `${result.skipped}S ${result.failed}F`
        );
      }

      // Only sleep when there is genuinely nothing to do.
      if (!result.more && result.claimed === 0) await sleep(IDLE_POLL_MS);
    }
  } finally {
    if (renewTimer) clearInterval(renewTimer);
    await releaseLease(holder).catch(() => {});
  }
}

/** Persist counters and the last outcome, so the dashboard has history. */
export async function recordDrain(result: DrainResult): Promise<void> {
  if (result.claimed === 0 && !result.aborted) return;
  await StubhubSyncSettings.updateOne(
    {},
    {
      $set: {
        lastDrainAt: new Date(),
        lastDrainResult:
          `${result.created}C ${result.updated}U ${result.noop}= ${result.delisted}L ` +
          `${result.deleted}D ${result.skipped}S ${result.failed}F`,
        lastError: result.aborted ?? null,
      },
      $inc: {
        totalCreated: result.created,
        totalUpdated: result.updated,
        totalDelisted: result.delisted,
        totalDeleted: result.deleted,
        totalFailed: result.failed,
      },
    },
    { upsert: true }
  );
}

/** Snapshot for the dashboard. */
export async function syncStatus() {
  const depth = await queueDepth();
  const settings = await getStubhubSyncSettings();
  const client = new StubHubClient(loadConfig(process.env, { dryRun: settings.dryRun }));
  return {
    settings: {
      isRunning: settings.isRunning,
      dryRun: settings.dryRun,
      marketplaces: settings.marketplaces ?? ['StubHub'],
      lastDrainAt: settings.lastDrainAt,
      lastDrainResult: settings.lastDrainResult,
      lastError: settings.lastError,
      totals: {
        created: settings.totalCreated ?? 0,
        updated: settings.totalUpdated ?? 0,
        delisted: settings.totalDelisted ?? 0,
        deleted: settings.totalDeleted ?? 0,
        failed: settings.totalFailed ?? 0,
      },
    },
    /** True when the environment pins dryRun, so the UI toggle cannot change it. */
    dryRunPinnedByEnv: process.env.STUBHUB_DRY_RUN !== undefined,
    ...depth,
    lagMs: depth.oldestPendingAt ? Date.now() - depth.oldestPendingAt.getTime() : 0,
    configured: client.configured,
    dryRun: client.config.dryRun,
    maxAttempts: MAX_ATTEMPTS,
    limiters: client.limiterState(),
  };
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
