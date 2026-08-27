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
import { bulkPollDelay } from '@/lib/stubhub/policy.ts';
import type {
  BulkInventoryRequest,
  BulkProcessingResultSummaryResponse,
  InventoryCreateRequest,
  InventoryUpdateRequest,
  ListingResource,
} from '@/lib/stubhub/types.ts';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

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

export interface ItemOutcome {
  externalId: string;
  ok: boolean;
  entityId?: number;
  error?: string;
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
  const submit = await client.request<BulkProcessingResultSummaryResponse>({
    method: 'POST',
    path: '/inventory/bulk',
    endpoint: 'POST /inventory/bulk',
    body: request,
    // Safe to repeat: the id names this exact submission.
    idempotent: true,
    isWrite: true,
  });

  if (submit.skipped) return null;

  // Bounded so a batch that never reports finished cannot hold the drain open.
  // Giving up here is safe: the batch id is derived from content, so the next
  // pass recomputes it and re-reads the result rather than resubmitting.
  const MAX_POLLS = 18;

  let summary = submit.data;
  for (let attempt = 0; attempt < MAX_POLLS && !summary?.finished; attempt++) {
    await sleep(bulkPollDelay(attempt));
    const poll = await client.request<BulkProcessingResultSummaryResponse>({
      method: 'GET',
      path: `/inventory/bulk/${request.bulkProcessingId}`,
      endpoint: 'DEFAULT',
      idempotent: true,
    });
    summary = poll.data ?? summary;
    if (summary?.finished) break;
  }

  if (!summary?.finished) {
    console.warn(
      `[stubhub:${operation}] batch ${request.bulkProcessingId} did not finish while polling; ` +
      `it will be re-read next drain rather than resubmitted`
    );
  }
  return summary ?? null;
}

/**
 * Flatten a bulk summary into per-item outcomes.
 *
 * Per-item rather than per-batch on purpose: one malformed row must never abandon
 * the other 249. The error object carries a per-field `errors` map, which is the
 * single most useful thing for fixing a mapper, so it is preserved rather than
 * flattened to a status code.
 */
function outcomes(summary: BulkProcessingResultSummaryResponse | null): Map<string, ItemOutcome> {
  const map = new Map<string, ItemOutcome>();
  if (!summary) return map;

  for (const r of summary.completed ?? []) {
    if (r.externalId) map.set(r.externalId, { externalId: r.externalId, ok: true, entityId: r.entityId ?? undefined });
  }
  for (const bucket of [summary.failed ?? [], summary.skipped ?? []]) {
    for (const r of bucket) {
      if (!r.externalId) continue;
      const fields = r.error?.errors
        ? ' ' + Object.entries(r.error.errors).map(([k, v]) => `${k}=${v.join('/')}`).join(' ')
        : '';
      map.set(r.externalId, {
        externalId: r.externalId,
        ok: false,
        error: `${r.error?.code ?? 'error'}: ${r.error?.message ?? 'unknown'}${fields}`,
      });
    }
  }
  return map;
}

export async function submitCreates(
  client: StubHubClient,
  items: CreateItem[]
): Promise<Map<string, ItemOutcome>> {
  if (items.length === 0) return new Map();

  const chunk = items.slice(0, MAX_BATCH_ITEMS);
  const request: BulkInventoryRequest = {
    bulkProcessingId: deriveBatchId('create', chunk.map(i => `${i.externalId}:${i.hash}`)),
    createRequests: chunk.map(i => i.payload),
  };

  return outcomes(await runBulk(client, request, 'create'));
}

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
