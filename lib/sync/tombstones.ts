/**
 * Recording removals from the portal's own delete paths.
 *
 * The scrapers already do this: they write a tombstone in the same transaction
 * that deletes the row, so a listing can still be un-listed after the document
 * that named it is gone. The portal has its own delete paths — stopping an event,
 * the auto-delete cron, the low-seat auto-stop, a manual removal — and until now
 * they only told the old CSV service.
 *
 * That gap is not theoretical. Stopping one event deleted 1,226 rows and recorded
 * nothing; had those rows carried StubHub listings, every one would have been
 * orphaned — live on the marketplace, with nothing left locally pointing at it,
 * and no way to find them again except a full export sweep.
 *
 * A tombstone is only written when there is something to remove. A row that was
 * never listed has no stubhubListingId, so deleting it needs no marketplace call
 * and leaves no record — which is also what keeps this collection from growing
 * without bound while the sync worker is switched off.
 */

import dbConnect from '@/lib/dbConnect';
import { InventoryTombstone } from '@/models/inventoryTombstoneModel.js';

export type RemovalReason =
  | 'scraper-removed'
  | 'seats-changed'
  | 'quantity-changed'
  | 'event-deleted'
  | 'event-expired'
  | 'low-seat-auto-stop'
  | 'manual';

/** The shape the delete paths already hold when they collect inventory ids. */
export interface RemovableGroup {
  mapping_id?: string;
  section?: string;
  row?: string;
  inventory?: {
    inventoryId?: number;
    stubhubListingId?: string | null;
  };
}

/**
 * Record that these listings need removing from StubHub.
 *
 * Call it BEFORE the delete, while the documents are still readable — the
 * stubhubListingId only exists on the row, and once the row is gone the listing
 * cannot be addressed at all.
 *
 * @returns how many tombstones were written
 */
export async function recordRemovals(
  groups: RemovableGroup[],
  opts: { reason: RemovalReason; source?: 'portal' | 'ticketmaster' | 'ticketscom' | 'evenue' }
): Promise<number> {
  if (!Array.isArray(groups) || groups.length === 0) return 0;

  const docs = groups
    // Only rows that actually reached StubHub. Everything else is a local delete
    // with no marketplace consequence.
    .filter(g => g?.inventory?.stubhubListingId && g.inventory?.inventoryId)
    .map(g => ({
      inventoryId: g.inventory!.inventoryId,
      stubhubListingId: g.inventory!.stubhubListingId,
      mapping_id: g.mapping_id ?? null,
      section: g.section ?? null,
      row: g.row ?? null,
      reason: opts.reason,
      source: opts.source ?? 'portal',
      syncState: 'pending',
      syncAttempts: 0,
    }));

  if (docs.length === 0) return 0;

  await dbConnect();
  await InventoryTombstone.insertMany(docs, { ordered: false });
  return docs.length;
}
