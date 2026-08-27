/**
 * Confirming bulk writes with seek instead of polling bulk status.
 *
 * ── Why this exists ────────────────────────────────────────────────────────────
 *
 * The obvious way to learn whether a bulk batch applied is to poll
 * GET /inventory/bulk/{id} until it reports finished. That works, and at small
 * volumes it is the right thing. It also does not scale, and the reason is worth
 * stating precisely because it is not obvious from the write limits:
 *
 *     POST /inventory/bulk          760/min  x 250 items  =  3,167 items/s
 *     GET  /inventory/bulk/{id}     100/min                          <-- shares
 *                                                                     the general
 *                                                                     allowance
 *
 * Polling once per batch caps the whole system at 100 batches/min — about
 * 417 items/s — no matter how much write budget is left unused. At 3,000 events
 * that is roughly 1% of the book per two-minute cycle, and a scrape cycle that
 * changes more than that builds a backlog that never drains.
 *
 * GET /inventory/seek takes an arbitrary list of inventory ids and allows
 * 700/min. It does not, however, take as many ids per call as first assumed: the
 * query string is capped near 2KB, which works out at roughly 60 ids with margin.
 * That gives ~560 listings/s of confirmation capacity rather than the ~2,900
 * originally claimed here — still comfortably above the 417/s that polling bulk
 * status would cap us at, but close enough to the bulk submit ceiling that seek
 * quota is now the thing worth asking StubHub to raise.
 *
 * ── What "verified" means here ─────────────────────────────────────────────────
 *
 * Not "the API said OK" but "the listing now holds the price we sent". That is a
 * stronger guarantee than a status poll gives, and it costs the same call. It
 * also catches the failure mode that has already bitten this integration twice:
 * a write accepted and silently not applied.
 */

import type { StubHubClient } from '@/lib/stubhub/client.ts';
import type { ListingResource } from '@/lib/stubhub/types.ts';

/**
 * seek takes its ids in the query string, and something in front of the API —
 * CloudFront, most likely — rejects a long one with an HTML 404 rather than a
 * JSON error.
 *
 * Measured boundary: 85 ids (2,055 characters) succeeds, 100 ids (2,415) does
 * not. That is the familiar 2KB query-string limit. Chunks are therefore built by
 * URL length rather than by count, with real margin, so it stays correct if
 * listing ids get longer.
 *
 * This mattered more than it sounds. The chunk was 200 — every verification call
 * this system ever made was failing, silently, and being recorded as "unverified"
 * against rows that had in fact been written correctly. It produced over a
 * thousand spurious failures and a queue that could never drain.
 */
const MAX_QUERY_BYTES = 1_600;

/** Roughly how many ids fit, used for capacity arithmetic only. */
const SEEK_CHUNK = 60;

/** Split ids into groups whose query string stays under the limit. */
function chunkByUrlLength(ids: number[]): number[][] {
  const chunks: number[][] = [];
  let current: number[] = [];
  let bytes = 0;
  for (const id of ids) {
    const cost = String(id).length + 14; // "inventoryIds=" + "&"
    if (current.length > 0 && bytes + cost > MAX_QUERY_BYTES) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(id);
    bytes += cost;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export interface Expectation {
  listingId: number;
  /** What we sent. Verification is against this, not against a status code. */
  expectedPrice: number;
}

export interface VerifyOutcome {
  listingId: number;
  ok: boolean;
  actualPrice: number | null;
  detail: string;
}

/**
 * Read the listings back and check they hold what we sent.
 *
 * Anything not returned by seek is reported as unverified rather than failed —
 * a listing missing from a read is not evidence that a write was rejected, and
 * marking it failed would burn its retry budget for what may be a lagging read.
 */
export async function verifyPrices(
  client: StubHubClient,
  expectations: Expectation[],
  marketplace = 'StubHub'
): Promise<Map<number, VerifyOutcome>> {
  const out = new Map<number, VerifyOutcome>();
  if (expectations.length === 0) return out;

  const byId = new Map(expectations.map(e => [e.listingId, e]));
  for (const idChunk of chunkByUrlLength(expectations.map(e => e.listingId))) {
    const chunk = idChunk.map(id => byId.get(id)!);
    const params = new URLSearchParams();
    for (const e of chunk) params.append('inventoryIds', String(e.listingId));

    let listings: ListingResource[] = [];
    try {
      const res = await client.request<Array<{ data?: ListingResource[] }> | ListingResource[]>({
        method: 'GET',
        path: `/inventory/seek?${params}`,
        endpoint: 'GET /inventory/seek',
        idempotent: true,
      });
      const body = res.data;
      // seek has been observed returning both a bare array and the paged
      // {data:[...]} wrapper; accept either rather than depending on which.
      listings = Array.isArray(body)
        ? (body as unknown[]).flatMap(b =>
            Array.isArray((b as { data?: ListingResource[] }).data)
              ? (b as { data: ListingResource[] }).data
              : [b as ListingResource])
        : [];
    } catch (error) {
      for (const e of chunk) {
        out.set(e.listingId, {
          listingId: e.listingId, ok: false, actualPrice: null,
          detail: `seek failed: ${String(error).slice(0, 120)}`,
        });
      }
      continue;
    }

    const returned = new Map(listings.filter(l => l?.id != null).map(l => [Number(l.id), l]));

    for (const e of chunk) {
      const listing = returned.get(e.listingId);
      if (!listing) {
        out.set(e.listingId, {
          listingId: e.listingId, ok: false, actualPrice: null,
          detail: 'not returned by seek — unverified, will be retried',
        });
        continue;
      }
      const actual = (listing.listingPricesByMarketplace ?? [])
        .find(p => p.marketplaceName === marketplace)?.listPrice ?? null;

      const ok = actual != null && Math.abs(actual - e.expectedPrice) < 0.005;
      out.set(e.listingId, {
        listingId: e.listingId,
        ok,
        actualPrice: actual,
        detail: ok
          ? `holds ${actual}`
          : `expected ${e.expectedPrice}, listing holds ${actual ?? 'no price'}`,
      });
    }
  }

  return out;
}

/**
 * Throughput this verification path sustains, for the capacity model and the
 * dashboard. Kept next to the code it describes so it cannot drift from it.
 */
export const VERIFY_CAPACITY = {
  seekPerMinute: 700,
  idsPerCall: SEEK_CHUNK,
  get listingsPerSecond() {
    return (this.seekPerMinute * this.idsPerCall) / 60;
  },
} as const;

/**
 * Which of these listings no longer exist.
 *
 * Confirmation for a bulk delete is absence: seek simply stops returning a
 * listing that has been removed. One call covers 200 ids, so proving a whole
 * event's removal costs a handful of requests rather than one per listing.
 */
export async function verifyGone(
  client: StubHubClient,
  listingIds: number[]
): Promise<Set<number>> {
  const gone = new Set<number>(listingIds);
  if (listingIds.length === 0) return gone;

  for (const chunk of chunkByUrlLength(listingIds)) {
    const params = new URLSearchParams();
    for (const id of chunk) params.append('inventoryIds', String(id));

    try {
      const res = await client.request<Array<{ data?: ListingResource[] }> | ListingResource[]>({
        method: 'GET',
        path: `/inventory/seek?${params}`,
        endpoint: 'GET /inventory/seek',
        idempotent: true,
      });
      const body = res.data;
      const listings: ListingResource[] = Array.isArray(body)
        ? (body as unknown[]).flatMap(b =>
            Array.isArray((b as { data?: ListingResource[] }).data)
              ? (b as { data: ListingResource[] }).data
              : [b as ListingResource])
        : [];
      // Anything still returned has not been removed yet.
      for (const l of listings) if (l?.id != null) gone.delete(Number(l.id));
    } catch {
      // A failed read is not evidence of anything. Treat the whole chunk as
      // still present so it is re-checked rather than wrongly marked done.
      for (const id of chunk) gone.delete(id);
    }
  }

  return gone;
}
