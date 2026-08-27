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
 * Rows are built for ONLY the documents a drain claimed — not the whole book, and
 * not even the whole event.
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

import { generateInventoryCsv, generateInventoryRowsForIds } from '@/actions/csvActions';
import { StubHubClient, StubHubError, loadConfig } from '@/lib/stubhub/client.ts';
import { mapRow, type InventoryRowInput } from '@/lib/stubhub/mapRow.ts';
import { verifyEvent } from '@/lib/stubhub/eventVerifier.ts';
import { payloadHash, deriveBatchId } from '@/lib/stubhub/hash.ts';
import { resolveRemoval, IDLE_POLL_MS } from '@/lib/stubhub/policy.ts';
import { MAX_BATCH_ITEMS } from '@/lib/stubhub/limits.ts';
import {
  claimRows, claimTombstones, markSynced, markCreated, markFailed, markSkipped,
  markUpdating, markCreating, markDelisted, markTombstoneDone, markTombstoneFailed,
  markTombstoneSubmitted, cancelTombstone,
  queueDepth, MAX_ATTEMPTS,
} from './queue.ts';
import {
  submitCreates, submitUpdates, submitDeletes, submitDelists, readBatchOutcomes,
  patchOne, delistOne, deleteOne,
  type CreateItem, type UpdateItem, type ItemOutcome,
} from './batcher.ts';
import { verifyPrices, verifyGone } from './verify.ts';
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
 * Abort a cycle when this share of claimed rows fails for reasons we cannot
 * explain.
 *
 * The distinction matters more than the number. Rows skipped because their event
 * was checked and found unusable — it does not exist, or it resolves to a
 * different event — are not evidence that anything is wrong with the system. They
 * are a known data problem, they are deterministic, and they are self-limiting:
 * each one is marked skipped and leaves the queue for good.
 *
 * Counting those toward the breaker was actively harmful. Claims are ordered by
 * event date, so an event with hundreds of bad rows fills every slice, trips the
 * breaker at 100%, and aborts the cycle — starving every good row queued behind
 * it. One misconfigured event could stop the entire sync indefinitely.
 *
 * What the breaker is actually for is the systemic case: the token expired, the
 * API is refusing everything, a deploy broke event resolution. Those show up as
 * lookup failures and unexplained skips, and those are what it counts.
 */
const SKIP_ABORT_RATIO = Number(process.env.STUBHUB_SKIP_ABORT_RATIO ?? 0.9);

/**
 * Rows claimed per pass.
 *
 * Smaller than it looks like it should be, deliberately. The loop drains
 * continuously — a pass that finds more work immediately runs again without
 * sleeping — so claim size does not limit throughput, only how long one pass
 * takes. And pass duration is the latency a single price change experiences when
 * it arrives mid-backfill.
 *
 * Measured against the live collection: fetching claimed documents costs ~150ms
 * for a handful, 630ms for 100, and 2.4s for 500. A hundred keeps the worst case
 * under a second while a thousand-row backfill still drains in the same total
 * time, just across more passes.
 */
const CLAIM_SIZE = Number(process.env.STUBHUB_CLAIM_SIZE ?? 100);

/**
 * How many claim-build-push pipelines run at once.
 *
 * This is what decides whether the system keeps up, and it took measuring to see
 * why. The API is not the constraint: seek-verified bulk sustains ~2,333 items/s,
 * or 280,000 changes per two-minute cycle. Building the rows to send is —
 * fetching and mapping costs roughly 5-6ms per row, so a single sequential
 * pipeline tops out near 19,000 changes per cycle.
 *
 * At 363 events that is about 3% of the book per cycle and comfortable. At 1,500
 * events the same absolute number is 0.7% of a far larger book, and even a 1%
 * change rate needs more throughput than one pipeline can give. The work is
 * embarrassingly parallel — separate rows, separate listings — so the answer is
 * to run several.
 *
 * Concurrency multiplies build capacity almost linearly until the database or the
 * API limits bite, whichever comes first. Four is a conservative default; the
 * arithmetic for a given book size is in the capacity tests.
 */
const PIPELINE_CONCURRENCY = Number(process.env.STUBHUB_PIPELINES ?? 4);

/**
 * Removals claimed per pass — far more than rows, because they cost far less.
 *
 * A row has to be fetched, joined to its event config, marked up and mapped
 * before it can be sent, which is why rows are claimed in small slices. A removal
 * carries a listing id and nothing else: no build, no export, no mapping. The
 * only work is putting 250 ids in a request.
 *
 * Sharing the row claim size meant 400 removals a pass, so stopping an event with
 * 30,000 listings would have taken 75 passes to submit what the API could accept
 * in 120 requests. The drain was the bottleneck, not the API.
 */
const TOMBSTONE_CLAIM_SIZE = Number(process.env.STUBHUB_TOMBSTONE_CLAIM ?? 2_000);

/** Events already reported as unusable, so the warning is logged once, not per slice. */
const loggedEventProblems = new Set<string>();

/**
 * How many listings may be updated concurrently on the single-call fast path.
 *
 * PATCH /inventory/{id} allows 12,880/min, so latency rather than budget is the
 * binding constraint here — one round trip is ~300ms, and doing them one after
 * another would make a 30-row event take ten seconds for no reason.
 */
const PATCH_CONCURRENCY = Number(process.env.STUBHUB_PATCH_CONCURRENCY ?? 16);

/**
 * Build the exporter's rows for exactly the documents this pass claimed.
 *
 * This is the latency budget. Going through generateInventoryCsv — even scoped to
 * the events involved — aggregates every row of those events and discards almost
 * all of it: ~4.7 seconds to price a handful of listings. Fetching the claimed
 * ids directly is an _id index lookup.
 *
 * Falls back to the scoped export when the targeted path cannot answer
 * correctly, which today means only section-mode min-seat: whether a row
 * qualifies depends on the total across its whole section, which a subset cannot
 * see. Correctness first, speed when it is free.
 */
async function rowsForClaimed(
  docIds: unknown[],
  mappingIds: string[]
): Promise<{ rows: InventoryRowInput[] | null; error?: string }> {
  const targeted = await generateInventoryRowsForIds(docIds);
  if (targeted.rows) return { rows: targeted.rows as InventoryRowInput[] };

  console.log(`[stubhub:worker] targeted build unavailable (${targeted.reason}) — using the scoped export`);
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

  // Claim enough to keep every pipeline busy. Claiming per-pipeline instead would
  // mean a round trip each, and the claim query is the cheap part.
  const rows = await claimRows(CLAIM_SIZE * PIPELINE_CONCURRENCY);
  const tombstones = await claimTombstones(CLAIM_SIZE);
  result.claimed = rows.length + tombstones.length;
  if (result.claimed === 0) return result;

  // Removals first. An unavailable listing must stop selling before anything else
  // is attempted — if the cycle later aborts, we want to have already protected
  // against overselling rather than to have queued it behind price updates.
  Object.assign(result, await processTombstones(client, tombstones, result));

  if (rows.length > 0) {
    // Split the claim across pipelines and run them concurrently. Each builds and
    // pushes its own slice; they share nothing but the client's rate limiter,
    // which is where contention belongs.
    const slices: (typeof rows)[] = [];
    for (let i = 0; i < rows.length; i += CLAIM_SIZE) slices.push(rows.slice(i, i + CLAIM_SIZE));

    const results = await pooled(slices, PIPELINE_CONCURRENCY,
      slice => processRows(client!, slice, marketplaces!));

    for (const r of results) {
      result.created += r.created;
      result.updated += r.updated;
      result.noop += r.noop;
      result.skipped += r.skipped;
      result.failed += r.failed;
      // One slice aborting is enough to stop the cycle: the circuit breaker fires
      // on a book we cannot describe, and that is not a per-slice condition.
      if (r.aborted && !result.aborted) result.aborted = r.aborted;
    }
  }

  result.more = !result.aborted && (
    rows.length >= CLAIM_SIZE * PIPELINE_CONCURRENCY ||
    tombstones.length >= TOMBSTONE_CLAIM_SIZE
  );
  return result;
}

async function processTombstones(
  client: StubHubClient,
  tombstones: Awaited<ReturnType<typeof claimTombstones>>,
  acc: DrainResult
): Promise<Partial<DrainResult>> {
  let delisted = 0, deleted = 0, cancelled = 0, failed = acc.failed;
  const now = new Date();

  // Decide everything first, then act in batches. Deciding and acting in the same
  // loop is what made removals the slowest thing here: one API call at a time
  // meant 766 queued removals took four minutes, and because removals run before
  // rows, every drain pass waited behind them.
  const toDelete: typeof tombstones = [];
  const toDelist: typeof tombstones = [];
  const toCancel: typeof tombstones = [];
  const inFlight: typeof tombstones = [];

  for (const t of tombstones) {
    // Already submitted in a batch — confirm rather than send again.
    if (t.syncState === 'deleting' && t.syncBatchId && t.stubhubListingId) {
      inFlight.push(t);
      continue;
    }
    const decision = resolveRemoval({
      stubhubListingId: t.stubhubListingId,
      delistedAt: t.delistedAt,
      // The scraper deletes the row and writes the tombstone atomically, so a row
      // that came back has a fresh document and a stale tombstone. Reappearance is
      // detected by the row existing again, which the next claim surfaces as a
      // pending create.
      reappeared: false,
      reason: t.reason,
      now,
    });
    if (decision.action === 'cancel') toCancel.push(t);
    else if (decision.action === 'delete' && t.stubhubListingId) toDelete.push(t);
    else if (decision.action === 'delist' && t.stubhubListingId) toDelist.push(t);
    // 'wait' is left untouched; its lease expires and a later pass reconsiders it
    // once the grace window has passed.
  }

  // Nothing on StubHub to act on — resolve locally, no requests at all.
  await pooled(toCancel, PATCH_CONCURRENCY, async (t) => {
    await cancelTombstone(t._id);
    cancelled++;
  });

  // Confirm anything a previous pass submitted. Absence is the confirmation: a
  // removed listing simply stops being returned by seek.
  if (inFlight.length > 0) {
    const gone = await verifyGone(client, inFlight.map(t => Number(t.stubhubListingId)));
    await pooled(inFlight, PATCH_CONCURRENCY, async (t) => {
      if (gone.has(Number(t.stubhubListingId))) {
        await markTombstoneDone(t._id);
        deleted++;
      } else {
        // Still there. Back to pending so the next pass re-issues; deletes are
        // idempotent so a duplicate costs nothing.
        await markTombstoneFailed(t._id, 'still present after batch delete', t.syncAttempts);
        failed++;
      }
    });
  }

  // Batch the removals. A bulk request carries 250 against a 760/min allowance,
  // where single DELETE allows only 2,730/min — about 45/s, the slowest write the
  // API offers and the easiest to saturate.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature is shared with the delist path
  await submitRemovals(client, toDelete, 'delete', async (_t) => { deleted++; }, () => { failed++; });
  await submitRemovals(client, toDelist, 'delist', async (t) => {
    await markDelisted(t._id, now);
    delisted++;
  }, () => { failed++; });

  return { delisted, deleted, cancelled, failed };
}

/**
 * Send removals in bulk batches, or singly when there are only a few.
 *
 * Submitted and not waited on, like every other bulk write here. Deletes are
 * marked in-flight and confirmed on the next pass by absence from seek; delists
 * are confirmed by their own state transition, since a delisted listing is still
 * there and only its broadcast state changed.
 */
async function submitRemovals(
  client: StubHubClient,
  items: Awaited<ReturnType<typeof claimTombstones>>,
  kind: 'delete' | 'delist',
  onOk: (t: Awaited<ReturnType<typeof claimTombstones>>[number]) => Promise<void>,
  onFail: () => void
): Promise<void> {
  if (items.length === 0) return;

  const chunks: (typeof items)[] = [];
  for (let i = 0; i < items.length; i += MAX_BATCH_ITEMS) chunks.push(items.slice(i, i + MAX_BATCH_ITEMS));

  // Submitting batches one after another wastes the allowance: bulk permits 760
  // requests a minute and a submit is a single round trip, so eight batches
  // sequentially is eight round trips of dead time for no reason.
  await pooled(chunks, BATCH_CONCURRENCY, async (chunk) => {
    const ids = chunk.map(t => Number(t.stubhubListingId));

    if (chunk.length < BULK_UPDATE_THRESHOLD) {
      // Few enough that a direct call confirms itself in the response, which is
      // worth more than the saved requests.
      await pooled(chunk, PATCH_CONCURRENCY, async (t) => {
        const id = Number(t.stubhubListingId);
        const outcome = kind === 'delete' ? await deleteOne(client, id) : await delistOne(client, id);
        if (!outcome.ok) { await markTombstoneFailed(t._id, outcome.error!, t.syncAttempts); onFail(); return; }
        if (kind === 'delete') await markTombstoneDone(t._id);
        await onOk(t);
      });
      return;
    }

    try {
      const batchId = kind === 'delete'
        ? await submitDeletes(client, ids)
        : await submitDelists(client, ids);

      await pooled(chunk, PATCH_CONCURRENCY, async (t) => {
        if (kind === 'delete') await markTombstoneSubmitted(t._id, batchId);
        await onOk(t);
      });
    } catch (error) {
      const reason = error instanceof StubHubError ? error.summary : String(error);
      console.error(`[stubhub:worker] ${kind} batch rejected: ${reason}`);
      await pooled(chunk, PATCH_CONCURRENCY, async (t) => {
        await markTombstoneFailed(t._id, reason, t.syncAttempts);
        onFail();
      });
    }
  });
}

/** Bulk submissions in flight at once. Each is one round trip; the limiter paces them. */
const BATCH_CONCURRENCY = Number(process.env.STUBHUB_BATCH_CONCURRENCY ?? 8);

async function processRows(
  client: StubHubClient,
  rows: Awaited<ReturnType<typeof claimRows>>,
  marketplaces: ApiMarketplace[]
): Promise<{ created: number; updated: number; noop: number; skipped: number; failed: number; aborted: string | null }> {
  const out = { created: 0, updated: 0, noop: 0, skipped: 0, failed: 0, aborted: null as string | null };

  // Skips we cannot account for. A row skipped because its event was checked and
  // found unusable is explained; one that vanished from the export, or whose
  // event could not be looked up at all, is not.
  let unexplained = 0;

  // The exporter is the single source of the final price. Build only the events
  // this pass claimed — typically a handful, since a scrape cycle marks one
  // event's rows dirty at a time.
  const mappingIds = [...new Set(rows.map(r => r.mapping_id).filter(Boolean))];
  const { rows: allRows, error } = await rowsForClaimed(rows.map(r => r._id), mappingIds);
  if (!allRows) {
    out.aborted = `could not build rows: ${error}`;
    return out;
  }

  const byInventoryId = new Map<number, InventoryRowInput>();
  for (const r of allRows) byInventoryId.set(Number(r.inventory_id), r);

  // Confirm each event exists AND is ours before building a single payload.
  //
  // Without this a bad id fails the entire 250-item batch as a unit — one event
  // took down every create in the first live run — and, far worse, an id that is
  // real but belongs to someone else's event would succeed, listing our
  // inventory against the wrong game. Verified once per event per drain, cached.
  const verified = new Map<string, number>();
  const eventSkips = new Map<string, string>();
  for (const mappingId of mappingIds) {
    const sample = allRows.find(r => r.event_id === mappingId);
    const check = await verifyEvent(client, mappingId, {
      name: sample?.event_name,
      date: sample?.event_date,
    });
    if (check.ok) verified.set(mappingId, check.eventId);
    else eventSkips.set(mappingId, `${check.reason}: ${check.detail}`);
  }

  // Once per event, not once per pipeline slice per pass. The verdict is cached,
  // so without this the same line repeats several times a second for as long as
  // the bad event has rows queued.
  for (const [mappingId, reason] of eventSkips) {
    if (loggedEventProblems.has(mappingId)) continue;
    loggedEventProblems.add(mappingId);
    console.warn(`[stubhub:worker] event ${mappingId} unusable — ${reason}`);
  }

  const creates: CreateItem[] = [];
  const updates: UpdateItem[] = [];
  const pendingVerify: Array<{
    rowId: unknown; listingId: number; expectedPrice: number; hash: string; attempts: number;
  }> = [];
  const awaitingCreate = new Map<string, Array<{ rowId: unknown; externalId: string; attempts: number }>>();
  const byExternalId = new Map<string, { rowId: unknown; hash: string; attempts: number }>();

  for (const row of rows) {
    const source = byInventoryId.get(Number(row.inventoryId));
    if (!source) {
      // Claimed but absent from the export — excluded by a rule, a stopped event,
      // or already gone. Not an error; it simply has nothing to say right now.
      await markSkipped(row._id, 'row not present in current export');
      out.skipped++;
      unexplained++;
      continue;
    }

    // An event that failed verification takes all of its rows with it.
    const eventProblem = eventSkips.get(row.mapping_id);
    if (eventProblem) {
      // A transient lookup failure is not the row's fault: leave it queued so the
      // next drain retries, rather than marking the book unlistable over a blip.
      // This one DOES count toward the breaker — it is the systemic shape.
      if (eventProblem.startsWith('lookup-failed')) { out.skipped++; unexplained++; continue; }
      await markSkipped(row._id, eventProblem);
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
    //
    // Requires syncState 'synced' as well as a matching hash: a row still in
    // flight from a previous batch has no confirmed hash yet, and treating it as
    // settled would close the loop on a write nobody has checked.
    if (row.syncState === 'synced' && row.syncHash === hash && row.stubhubListingId) {
      out.noop++;
      continue;
    }

    // Submitted in a create batch by an earlier pass — read that batch's result
    // rather than creating the listing a second time.
    if (row.syncState === 'creating' && row.syncBatchId && !row.stubhubListingId) {
      const list = awaitingCreate.get(row.syncBatchId) ?? [];
      list.push({ rowId: row._id, externalId: mapped.externalId, attempts: row.syncAttempts });
      awaitingCreate.set(row.syncBatchId, list);
      continue;
    }

    // Already submitted in a batch — read it back rather than sending again.
    if (row.syncState === 'updating' && row.stubhubListingId) {
      pendingVerify.push({
        rowId: row._id,
        listingId: Number(row.stubhubListingId),
        expectedPrice: round2(source.list_price),
        hash,
        attempts: row.syncAttempts,
      });
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

  // Settle create batches submitted by an earlier pass. One status read each, no
  // looping — the read is what used to make a pass take ninety seconds.
  for (const [batchId, waiting] of awaitingCreate) {
    let outcomes: Map<string, ItemOutcome>;
    try {
      ({ outcomes } = await readBatchOutcomes(client, batchId));
    } catch {
      continue; // still queued or unreadable; try again next pass
    }
    for (const w of waiting) {
      const outcome = outcomes.get(w.externalId);
      if (outcome?.ok && outcome.entityId) {
        await markCreated(w.rowId, String(outcome.entityId));
        out.created++;
      } else if (outcome && !outcome.ok) {
        await markFailed(w.rowId, outcome.error ?? 'create failed', w.attempts);
        out.failed++;
      }
      // No entry yet: the batch has not settled. Left as-is for the next pass.
    }
  }

  // Settle anything submitted by an earlier pass, before sending anything new.
  //
  // One seek call covers 200 listings, so confirming a batch costs a fraction of
  // what sending it did. Doing it first also means a row that already landed is
  // never re-sent, which is what keeps a backlog from feeding on itself.
  if (pendingVerify.length > 0) {
    const verdicts = await verifyPrices(client, pendingVerify.map(v => ({
      listingId: v.listingId, expectedPrice: v.expectedPrice,
    })));

    for (const v of pendingVerify) {
      const verdict = verdicts.get(v.listingId);
      if (verdict?.ok) {
        await markSynced(v.rowId, v.hash);
        out.noop++;   // settled without a write this pass
      } else {
        // Not confirmed: put it back as dirty so the next pass re-sends. Safe
        // because every write here is idempotent, and far better than assuming a
        // batch landed because it was accepted.
        await markFailed(v.rowId, verdict?.detail ?? 'unverified after batch', v.attempts);
        out.failed++;
      }
    }
  }

  // Circuit breaker. Evaluated before anything is sent, not as a handler after
  // something has gone wrong.
  const actionable = creates.length + updates.length + pendingVerify.length;
  if (rows.length > 0 && unexplained / rows.length > SKIP_ABORT_RATIO && actionable === 0) {
    out.aborted =
      `${unexplained}/${rows.length} rows failed for unexplained reasons — aborting rather than ` +
      `acting on a book we cannot describe`;
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
    let batchId = '';
    try {
      const submitted = await submitCreates(client, chunk);
      results = submitted.outcomes;
      batchId = submitted.batchId;
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
      } else {
        // Still draining. Record the batch so the next pass reads its result once
        // rather than waiting here or re-sending — the id names this exact
        // submission, so re-reading is always safe.
        await markCreating(meta.rowId, batchId);
      }
    }
  }

  if (updates.length > 0) {
    // Transport is chosen by depth, because the two options fail in opposite
    // directions and the crossover is real.
    //
    //   PATCH one-by-one   applies immediately, no polling, but caps at
    //                      12,880/min = 215 items/s. Below that it is strictly
    //                      better: lower latency and a direct answer.
    //
    //   bulk               3,167 items/s of submit capacity, but confirming it
    //                      through GET /inventory/bulk/{id} caps the system at
    //                      100 polls/min = 417 items/s, which is *worse* than
    //                      PATCH unless the confirmation moves elsewhere. It
    //                      does: seek allows 700/min over arbitrary id lists,
    //                      so verification stops being the constraint and the
    //                      bulk submit limit becomes the ceiling.
    //
    // So: small change sets take PATCH and land in one round trip. Large ones
    // take bulk and are confirmed by reading the listings back, which is also a
    // stronger check than a status code — it proves the price actually applied,
    // which this integration has twice found is not implied by acceptance.
    if (updates.length >= BULK_UPDATE_THRESHOLD) {
      await pushUpdatesInBulk(client, updates, byExternalId, out);
    } else {
    // Updates go one at a time, concurrently, rather than through bulk.
    //
    // Bulk update works — a batch settles in about six seconds. What did not work
    // was matching its results back: a bulk result identifies an item by whichever
    // id the request supplied, and an update supplies inventoryId, so results
    // return as { entityId } with no externalId. Keying outcomes on externalId
    // alone silently discarded every one of them, which is why 967 listings were
    // correctly priced on StubHub while the worker reported zero updates and
    // re-sent the same work on every pass. That is fixed in batcher.outcomes.
    //
    // PATCH is still the better choice here: it applies immediately instead of
    // after a submit-and-poll round trip, allows 12,880/min against bulk's 760,
    // and returns its outcome directly rather than in a summary to be matched by
    // id. For a system whose point is that a price change lands now, spending more
    // requests to remove a polling delay is the right trade. At the limiter's
    // ~100/s a thousand listings price in about ten seconds.
    const outcomes = await pooled(updates, PATCH_CONCURRENCY, item => patchOne(client, item));
    for (let i = 0; i < updates.length; i++) {
      const meta = byExternalId.get(updates[i].externalId)!;
      const outcome = outcomes[i];
      if (outcome.ok) { await markSynced(meta.rowId, meta.hash); out.updated++; }
      else { await markFailed(meta.rowId, outcome.error!, meta.attempts); out.failed++; }
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

/**
 * At or above this many pending updates, use bulk.
 *
 * Low on purpose. Now that a batch is submitted without waiting for it to settle,
 * bulk costs no more latency than a single PATCH — one request either way — while
 * carrying up to 250 changes instead of one. The only reason to send individually
 * at all is that a handful of PATCHes confirm themselves in the response, saving
 * the verification pass entirely.
 */
const BULK_UPDATE_THRESHOLD = Number(process.env.STUBHUB_BULK_THRESHOLD ?? 10);

/**
 * Submit updates as bulk batches and move on. Confirmation happens later.
 *
 * A bulk batch takes several seconds to settle. Waiting for it would make every
 * pass pay that cost, so the batch is submitted, its rows are marked in-flight,
 * and the pass ends. The next pass finds those rows in `updating`, reads them
 * back through seek in one call per 200 listings, and settles them.
 *
 * That is what makes bulk both efficient and immediate: one request carries 250
 * changes, the change is on its way the moment it is detected, and nothing
 * blocks waiting for an acknowledgement that arrives on its own schedule.
 *
 * Confirmation deliberately avoids GET /inventory/bulk/{id}: it shares the
 * general 100/min allowance and would cap the whole system at 417 items/s, below
 * what single PATCH manages. seek allows 700/min over arbitrary id lists, and
 * answers a stronger question anyway — not "did the batch finish" but "does the
 * listing hold the price we sent".
 */
async function pushUpdatesInBulk(
  client: StubHubClient,
  updates: UpdateItem[],
  meta: Map<string, { rowId: unknown; hash: string; attempts: number }>,
  out: { updated: number; failed: number }
): Promise<void> {
  for (let i = 0; i < updates.length; i += MAX_BATCH_ITEMS) {
    const chunk = updates.slice(i, i + MAX_BATCH_ITEMS);
    const batchId = deriveBatchId('update', chunk.map(c => `${c.externalId}:${c.hash}`));

    try {
      await submitUpdates(client, chunk);
    } catch (error) {
      const reason = error instanceof StubHubError ? error.summary : String(error);
      console.error(`[stubhub:worker] update batch rejected: ${reason}`);
      for (const item of chunk) {
        const m = meta.get(item.externalId)!;
        await markFailed(m.rowId, reason, m.attempts);
        out.failed++;
      }
      continue;
    }

    // In flight, not done. Counted as updated because the write has been accepted
    // and is on its way; the next pass proves it or re-sends.
    for (const item of chunk) {
      const m = meta.get(item.externalId)!;
      await markUpdating(m.rowId, batchId);
      out.updated++;
    }
  }
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

/** Match the rounding the mapper applies, so verification compares like with like. */
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
