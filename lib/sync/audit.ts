/**
 * Drift audit — read-only by construction.
 *
 * The worker's diff is local: it compares a freshly mapped payload against the
 * hash of what StubHub last accepted. That is fast, cheap and correct as long as
 * our record of what StubHub holds is accurate. This is the job that checks
 * whether it still is.
 *
 * It has to be a separate, slow loop rather than part of the drain, because the
 * read limits make it impossible to do per cycle:
 *
 *     GET /inventory/export/all   1 per 2 minutes
 *     GET /inventory/search       10 per minute
 *     GET /inventory/seek         700 per minute
 *
 * On a two-minute scrape cycle the export alone would consume its entire budget,
 * which is precisely why the diff is local in the first place. Run this hourly or
 * nightly; use seek when you want to check something specific right now.
 *
 * Two kinds of drift, and they mean different things:
 *
 *   orphan   StubHub holds a listing we have no record of. Usually a create that
 *            half-succeeded — the listing landed but the response was lost, so we
 *            never stored the id. Left alone it is inventory we are selling and
 *            not tracking, which is the worse of the two.
 *
 *   ghost    We believe a listing is live and StubHub does not. Usually a delete
 *            that succeeded on their side after we recorded a failure. Harmless
 *            to sell but it means our local state is lying.
 *
 * Nothing here fixes anything. An audit that heals destructively is a
 * mass-deletion waiting for its first bad query — the whole point of the tombstone
 * design is that removals originate from a deliberate record, and an auto-healing
 * sweep would quietly reintroduce exactly the path that design excludes.
 */

import dbConnect from '@/lib/dbConnect';
import { ConsecutiveGroup } from '@/models/seatModel.js';
import { StubHubClient } from '@/lib/stubhub/client.ts';
import { RECONCILIATION } from '@/lib/stubhub/limits.ts';
import type { InventoryExportResource, ListingResource } from '@/lib/stubhub/types.ts';

export interface DriftReport {
  scanned: number;
  tracked: number;
  orphans: Array<{ listingId: number; externalId: string | null }>;
  ghosts: Array<{ inventoryId: number; listingId: string }>;
  priceMismatches: Array<{ externalId: string; ours: number; theirs: number }>;
  pages: number;
  truncated: boolean;
}

/**
 * Pull everything StubHub holds and compare it with what we think we sent.
 *
 * Paged at the documented maximum. `updatedDateSince` narrows an incremental
 * sweep; omit it for a full picture.
 */
export async function auditDrift(opts: {
  client?: StubHubClient;
  updatedDateSince?: Date;
  maxPages?: number;
} = {}): Promise<DriftReport> {
  await dbConnect();

  const client = opts.client ?? new StubHubClient();
  const maxPages = opts.maxPages ?? 20;

  const report: DriftReport = {
    scanned: 0, tracked: 0, orphans: [], ghosts: [], priceMismatches: [], pages: 0, truncated: false,
  };

  // What we believe is live, keyed by the id StubHub knows it by.
  const ours = new Map<string, { inventoryId: number; listPrice: number }>();
  const cursor = ConsecutiveGroup.find(
    { 'inventory.stubhubListingId': { $exists: true } },
    { 'inventory.stubhubListingId': 1, 'inventory.inventoryId': 1, 'inventory.listPrice': 1 }
  ).lean().cursor();

  interface LeanTrackedDoc {
    inventory?: { stubhubListingId?: string; inventoryId?: number; listPrice?: number };
  }

  for await (const doc of cursor) {
    const inv = (doc as LeanTrackedDoc).inventory;
    if (inv?.stubhubListingId) {
      ours.set(String(inv.stubhubListingId), {
        inventoryId: inv.inventoryId ?? 0,
        listPrice: inv.listPrice ?? 0,
      });
    }
  }
  report.tracked = ours.size;

  const seen = new Set<string>();
  let paginationToken: number | null = null;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      pageSize: String(RECONCILIATION.exportPageSize),
      includePastEvents: 'false',
    });
    if (opts.updatedDateSince) {
      params.set('updatedDateSince', opts.updatedDateSince.toISOString().slice(0, 19));
    }
    if (paginationToken != null) params.set('paginationToken', String(paginationToken));

    const res = await client.request<InventoryExportResource>({
      method: 'GET',
      path: `/inventory/export?${params}`,
      endpoint: 'GET /inventory/export/all',
      idempotent: true,
    });

    const body = res.data;
    const listings: ListingResource[] = body?.inventory ?? [];
    report.pages++;
    report.scanned += listings.length;

    for (const listing of listings) {
      const id = String(listing.id);
      seen.add(id);

      const mine = ours.get(id);
      if (!mine) {
        report.orphans.push({ listingId: listing.id, externalId: listing.externalId ?? null });
        continue;
      }

      const theirPrice = (listing.listingPricesByMarketplace ?? [])
        .find(p => p.marketplaceName === 'StubHub')?.listPrice;

      if (theirPrice != null && Math.abs(theirPrice - mine.listPrice) > 0.01) {
        report.priceMismatches.push({
          externalId: listing.externalId ?? id,
          ours: mine.listPrice,
          theirs: theirPrice,
        });
      }
    }

    if (listings.length < RECONCILIATION.exportPageSize || body?.paginationToken == null) break;
    paginationToken = body.paginationToken;

    if (page === maxPages - 1) report.truncated = true;
  }

  // Only meaningful on a full sweep: an incremental one legitimately omits
  // listings that simply have not changed since the watermark.
  if (!opts.updatedDateSince) {
    for (const [listingId, mine] of ours) {
      if (!seen.has(listingId)) {
        report.ghosts.push({ inventoryId: mine.inventoryId, listingId });
      }
    }
  }

  return report;
}

/**
 * Check a specific set of listings without a full sweep.
 *
 * seek takes an arbitrary id list at 700/min, so this is cheap enough to run on
 * demand — after a suspicious batch, or when someone asks whether a particular
 * event is really listed.
 */
export async function verifyListings(
  listingIds: number[],
  client = new StubHubClient()
): Promise<ListingResource[]> {
  if (listingIds.length === 0) return [];

  const params = new URLSearchParams();
  for (const id of listingIds) params.append('inventoryIds', String(id));

  const res = await client.request<Array<{ data?: ListingResource[] }>>({
    method: 'GET',
    path: `/inventory/seek?${params}`,
    endpoint: 'GET /inventory/seek',
    idempotent: true,
  });

  return (res.data ?? []).flatMap(r => r.data ?? []);
}

/** One line for logs and the dashboard. */
export function summariseDrift(report: DriftReport): string {
  const parts = [
    `${report.scanned} scanned`,
    `${report.tracked} tracked`,
    `${report.orphans.length} orphan${report.orphans.length === 1 ? '' : 's'}`,
    `${report.ghosts.length} ghost${report.ghosts.length === 1 ? '' : 's'}`,
    `${report.priceMismatches.length} price mismatch${report.priceMismatches.length === 1 ? '' : 'es'}`,
  ];
  if (report.truncated) parts.push('TRUNCATED — raise maxPages');
  return parts.join(', ');
}
