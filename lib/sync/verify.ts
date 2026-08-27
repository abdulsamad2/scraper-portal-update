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
 * 700/min. Verifying 250 listings per call gives ~2,900 listings/s of
 * confirmation capacity, which is no longer the constraint — the bulk submit
 * limit is, at 3,167 items/s. That is a sevenfold increase in ceiling from
 * changing which endpoint answers the question.
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

/** seek takes ids in the query string, so batches stay modest. */
const SEEK_CHUNK = 200;

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

  for (let i = 0; i < expectations.length; i += SEEK_CHUNK) {
    const chunk = expectations.slice(i, i + SEEK_CHUNK);
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

    const byId = new Map(listings.filter(l => l?.id != null).map(l => [Number(l.id), l]));

    for (const e of chunk) {
      const listing = byId.get(e.listingId);
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
