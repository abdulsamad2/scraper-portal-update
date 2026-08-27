/**
 * Turning planned work into API calls.
 *
 * Two transports, chosen per batch by policy.chooseWritePath: a single call when
 * the change set is tiny and latency matters, bulk when there is volume. Creates
 * always take bulk regardless of size, because `bulkProcessingId` is the only
 * idempotency handle anywhere in the API and a bare POST /inventory that times
 * out may well have succeeded.
 *
 * ── The two-phase create ───────────────────────────────────────────────────────
 *
 * InventoryCreateRequest has costs but no price. A created listing therefore
 * exists without an ask until a second call lands, which is why creates go out
 * with autoBroadcast:false and are recorded as `created` rather than `synced`.
 * The next drain sees a row with a listing id and no matching hash and issues the
 * price update. A crash between the two halves resumes the same way, because the
 * state on disk is indistinguishable from an ordinary mid-flight create.
 *
 * ── Batch identity ─────────────────────────────────────────────────────────────
 *
 * bulkProcessingId is derived from the batch's contents rather than randomised.
 * A retry of the same batch is then provably the same submission, and a worker
 * that died after submitting can recompute the id and go read the result instead
 * of resending work that may already have been applied.
 */

import { StubHubClient, StubHubError } from '@/lib/stubhub/client.ts';
import { deriveBatchId, payloadHash } from '@/lib/stubhub/hash.ts';
import { MAX_BATCH_ITEMS } from '@/lib/stubhub/limits.ts';
import { outcomes, type ItemOutcome } from './bulkResults.ts';
import type {
  BulkInventoryRequest,
  BulkProcessingResultSummaryResponse,
  InventoryCreateRequest,
  InventoryUpdateRequest,
  ListingResource,
} from '@/lib/stubhub/types.ts';

export interface CreateItem {
  rowId: unknown;
  externalId: string;
  payload: InventoryCreateRequest;
  hash: string;
}

export interface UpdateItem {
  rowId: unknown;
  externalId: string;
  listingId: number;
  payload: InventoryUpdateRequest;
  hash: string;
}

export interface DeleteItem {
  tombstoneId: unknown;
  listingId: number;
}

/**
 * Submit a bulk batch and wait for it to drain.
 *
 * Polling backs off from 250ms: the status endpoint shares the general 100/min
 * allowance, unlike the bulk submit itself at 760/min, so a tight poll loop would
 * spend the wrong budget.
 */
async function runBulk(
  client: StubHubClient,
  request: BulkInventoryRequest,
  operation: string
): Promise<BulkProcessingResultSummaryResponse | null> {
  void operation;
  const submit = await client.request<BulkProcessingResultSummaryResponse>({
    method: 'POST',
    path: '/inventory/bulk',
    endpoint: 'POST /inventory/bulk',
    body: request,
    // Safe to repeat: the id names this exact submission.
    idempotent: true,
    isWrite: true,
  });

  return submit.data ?? null;
}

/**
 * Read a submitted batch's status. Exactly one request, never a loop.
 *
 * The loop this replaces was the reason a drain pass took ninety seconds. The
 * status endpoint shares the general 100/min allowance, so the limiter paces it
 * to one call every 1.2 seconds; polling a batch up to eighteen times therefore
 * cost up to twenty seconds per batch, and a pass with four batches spent well
 * over a minute doing nothing but asking whether the work had finished yet.
 *
 * A batch settles in about six seconds. Reading it once per pass — with passes a
 * few hundred milliseconds apart — resolves it just as quickly without any of
 * that waiting, and leaves the drain free to do real work in between.
 */
export async function readBatch(
  client: StubHubClient,
  batchId: string
): Promise<BulkProcessingResultSummaryResponse | null> {
  const res = await client.request<BulkProcessingResultSummaryResponse>({
    method: 'GET',
    path: `/inventory/bulk/${batchId}`,
    endpoint: 'DEFAULT',
    idempotent: true,
  });
  return res.data ?? null;
}

/** Per-item outcomes for a batch submitted on an earlier pass. */
export async function readBatchOutcomes(
  client: StubHubClient,
  batchId: string
): Promise<{ finished: boolean; outcomes: Map<string, ItemOutcome> }> {
  const summary = await readBatch(client, batchId);
  return { finished: Boolean(summary?.finished), outcomes: outcomes(summary) };
}

/**
 * Submit a create batch and return immediately.
 *
 * The batch id is returned so the caller can record it against the rows and read
 * the result on a later pass. Nothing here waits: a create batch settles in a few
 * seconds, and blocking a drain for that is how passes ended up ninety seconds
 * long.
 */
export async function submitCreates(
  client: StubHubClient,
  items: CreateItem[]
): Promise<{ batchId: string; outcomes: Map<string, ItemOutcome> }> {
  if (items.length === 0) return { batchId: '', outcomes: new Map() };

  const chunk = items.slice(0, MAX_BATCH_ITEMS);
  const batchId = deriveBatchId('create', chunk.map(i => `${i.externalId}:${i.hash}`));
  const summary = await runBulk(client, {
    bulkProcessingId: batchId,
    createRequests: chunk.map(i => i.payload),
  }, 'create');

  // A submit occasionally comes back already complete for a small batch; take
  // those outcomes rather than waiting a whole pass to ask again.
  return { batchId, outcomes: outcomes(summary) };
}

/**
 * Bulk update. Works — a batch settles in about six seconds — but the worker uses
 * patchOne instead.
 *
 * Not because bulk is broken: an earlier reading of this said so and was wrong.
 * PATCH is preferred because it applies immediately rather than after a
 * submit-and-poll round trip, allows 12,880/min against bulk's 760, and returns
 * its outcome directly instead of in a summary that has to be matched back by id.
 * For a system whose whole point is that a price change lands now, that is the
 * better trade even though it spends more requests.
 *
 * Kept because it is the right tool for a large backfill, where 250 listings per
 * request beats 250 requests and nobody is watching the clock.
 */
export async function submitUpdates(
  client: StubHubClient,
  items: UpdateItem[]
): Promise<Map<string, ItemOutcome>> {
  if (items.length === 0) return new Map();

  const chunk = items.slice(0, MAX_BATCH_ITEMS);
  const request: BulkInventoryRequest = {
    bulkProcessingId: deriveBatchId('update', chunk.map(i => `${i.externalId}:${i.hash}`)),
    updateRequests: chunk.map(i => ({ inventoryId: i.listingId, ...i.payload })),
  };

  return outcomes(await runBulk(client, request, 'update'));
}

/**
 * Update a single listing directly.
 *
 * PATCH is idempotent — setting a price to X twice leaves it at X — so this is
 * safe to retry and skips the submit-then-poll round trip entirely. Used when the
 * change set is small enough that a batch would cost more latency than it saves
 * requests, which is what keeps a hand-made dashboard edit feeling immediate.
 */
export async function patchOne(client: StubHubClient, item: UpdateItem): Promise<ItemOutcome> {
  try {
    const res = await client.request<ListingResource>({
      method: 'PATCH',
      path: `/inventory/${item.listingId}`,
      endpoint: 'PATCH /inventory/{id}',
      body: item.payload,
      idempotent: true,
      isWrite: true,
    });
    if (res.skipped) return { externalId: item.externalId, ok: true };
    return { externalId: item.externalId, ok: true, entityId: res.data?.id };
  } catch (error) {
    return {
      externalId: item.externalId,
      ok: false,
      error: error instanceof StubHubError ? error.summary : String(error),
    };
  }
}

/**
 * Stop a listing selling without destroying it.
 *
 * The reversible half of a removal. Sections sell out and come back minutes
 * later, and delisting keeps the listing id, its age and its history so the
 * return costs one call instead of a two-call recreate.
 */
export async function delistOne(client: StubHubClient, listingId: number): Promise<ItemOutcome> {
  const externalId = String(listingId);
  try {
    await client.request<ListingResource>({
      method: 'PATCH',
      path: `/inventory/${listingId}`,
      endpoint: 'PATCH /inventory/{id}',
      body: {
        broadcastStatuses: [{ marketplace: 'StubHub', posBroadcastState: 'Delist' }],
      } satisfies InventoryUpdateRequest,
      idempotent: true,
      isWrite: true,
    });
    return { externalId, ok: true };
  } catch (error) {
    return {
      externalId,
      ok: false,
      error: error instanceof StubHubError ? error.summary : String(error),
    };
  }
}

/**
 * Remove many listings in one request.
 *
 * DELETE one-by-one allows 2,730/min — about 45/s — which is the slowest write
 * path the API offers and by far the easiest to hit. A bulk delete carries 250
 * removals per request against a 760/min batch allowance, so stopping a large
 * event goes from a minute of rate-limited calls to a single submission.
 *
 * Like every bulk write here it is submitted and not waited on. Confirmation is
 * absence: a deleted listing stops being returned by seek, which the next pass
 * checks in one call per 200 ids.
 */
export async function submitDeletes(
  client: StubHubClient,
  listingIds: number[]
): Promise<string> {
  const batchId = deriveBatchId('delete', listingIds.map(String));
  await client.request<BulkProcessingResultSummaryResponse>({
    method: 'POST',
    path: '/inventory/bulk',
    endpoint: 'POST /inventory/bulk',
    body: {
      bulkProcessingId: batchId,
      deleteRequests: listingIds.map(inventoryId => ({ inventoryId })),
    } satisfies BulkInventoryRequest,
    idempotent: true,
    isWrite: true,
  });
  return batchId;
}

/**
 * Stop many listings selling in one request.
 *
 * The reversible half of a removal, batched for the same reason as the deletes.
 */
export async function submitDelists(
  client: StubHubClient,
  listingIds: number[]
): Promise<string> {
  const batchId = deriveBatchId('delist', listingIds.map(String));
  await client.request<BulkProcessingResultSummaryResponse>({
    method: 'POST',
    path: '/inventory/bulk',
    endpoint: 'POST /inventory/bulk',
    body: {
      bulkProcessingId: batchId,
      updateRequests: listingIds.map(inventoryId => ({
        inventoryId,
        broadcastStatuses: [{ marketplace: 'StubHub' as const, posBroadcastState: 'Delist' as const }],
      })),
    } satisfies BulkInventoryRequest,
    idempotent: true,
    isWrite: true,
  });
  return batchId;
}

/** DELETE is idempotent — a second call is a no-op or a 404 — so retry is safe. */
export async function deleteOne(client: StubHubClient, listingId: number): Promise<ItemOutcome> {
  const externalId = String(listingId);
  try {
    await client.request<unknown>({
      method: 'DELETE',
      path: `/inventory/${listingId}`,
      endpoint: 'DELETE /inventory/{id}',
      idempotent: true,
      isWrite: true,
    });
    return { externalId, ok: true };
  } catch (error) {
    // Already gone is the outcome we wanted.
    if (error instanceof StubHubError && error.status === 404) {
      return { externalId, ok: true };
    }
    return {
      externalId,
      ok: false,
      error: error instanceof StubHubError ? error.summary : String(error),
    };
  }
}

/** Re-exported so callers hash the payload the same way the batch id does. */
export { payloadHash };
export type { ItemOutcome };
