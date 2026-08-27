/**
 * The outbox queue: claiming work, and recording what happened to it.
 *
 * This is the only module that mutates syncState. Everything else reads it or
 * asks this to change it, which keeps the state machine in one file rather than
 * scattered across whatever happened to be convenient.
 *
 * Rows and tombstones are two separate queues because they are two separate
 * lifecycles: a row is created then repeatedly updated, a tombstone is created
 * once and resolved once. Forcing them into one collection would mean either a
 * discriminator on every query or a soft-delete flag on every row, and both cost
 * more than the small duplication here.
 *
 * ── Claiming ───────────────────────────────────────────────────────────────────
 *
 * A leader lease already guarantees one drain loop, so claiming does not have to
 * defend against a stampede. It still takes a lease per row, for a different
 * reason: if the worker dies mid-batch, those rows must become claimable again
 * without anyone diagnosing the crash or running a cleanup job. The lease expires
 * and the next drain picks them up.
 *
 * Claims are ordered by event_date ascending. If the API cannot absorb everything
 * — or a backlog builds after an outage — what sells soonest goes first. Sorting
 * by when the row was marked dirty would be fairer and commercially wrong.
 */

import dbConnect from '@/lib/dbConnect';
import { ConsecutiveGroup } from '@/models/seatModel.js';
import { InventoryTombstone } from '@/models/inventoryTombstoneModel.js';

/**
 * How long a claimed row stays claimed before it can be picked up again.
 *
 * This is a crash guard — it exists so a worker that dies mid-pass cannot strand
 * rows — and it was set to five minutes, which is far longer than a pass takes.
 * That turned out to throttle the whole system: a pass claims up to
 * CLAIM_SIZE x PIPELINE_CONCURRENCY rows, and any it cannot settle immediately
 * (an unfinished batch, a write still landing) stays locked for the full lease.
 * The loop then had nothing claimable and idled, so the queue moved in a burst
 * every five minutes instead of continuously.
 *
 * A minute is still many times the length of a pass, so it does the crash-guard
 * job, without turning a deferral into a five-minute stall.
 */
export const CLAIM_TTL_MS = Number(process.env.STUBHUB_CLAIM_TTL_MS ?? 60_000);

/** Attempts before a row is parked as failed and stops consuming budget. */
export const MAX_ATTEMPTS = 5;

/** Shape of the lean documents the claim queries return. */
interface LeanRowDoc {
  _id: unknown;
  mapping_id?: string;
  event_date?: Date;
  inventory?: {
    inventoryId?: number;
    stubhubListingId?: string;
    syncState?: string;
    syncHash?: string;
    syncAttempts?: number;
    syncPendingSince?: Date;
    syncBatchId?: string;
  };
}

interface LeanTombstoneDoc {
  _id: unknown;
  inventoryId: number;
  stubhubListingId?: string | null;
  reason: string;
  createdAt: Date;
  delistedAt?: Date | null;
  syncAttempts?: number;
  syncState?: string;
  syncBatchId?: string | null;
}

export interface ClaimedRow {
  _id: unknown;
  mapping_id: string;
  event_date: Date;
  inventoryId: number;
  stubhubListingId: string | null;
  syncState: string;
  syncHash: string | null;
  syncAttempts: number;
  syncBatchId: string | null;
  /** When this row entered its current state — used to let writes settle. */
  syncPendingSince: Date | null;
}

export interface ClaimedTombstone {
  _id: unknown;
  inventoryId: number;
  stubhubListingId: string | null;
  reason: string;
  createdAt: Date;
  delistedAt: Date | null;
  syncAttempts: number;
  syncState: string;
  syncBatchId: string | null;
}

/**
 * Claim up to `limit` rows needing a push.
 *
 * Two steps rather than one findAndModify loop: select the ids, then stamp them
 * in a single updateMany. Mongo has no atomic "update the first N matching", and
 * a findOneAndUpdate loop would be one round trip per row — which is exactly the
 * per-row latency the batching design exists to avoid.
 *
 * The stamp re-checks the lease in its filter, so even without the leader lease
 * two claimers could not both take the same row.
 */
export async function claimRows(limit: number, now = new Date()): Promise<ClaimedRow[]> {
  await dbConnect();

  const candidates = await ConsecutiveGroup.find(
    {
      'inventory.syncPendingSince': { $exists: true },
      'inventory.syncAttempts': { $lt: MAX_ATTEMPTS },
      $or: [
        { 'inventory.syncLeaseUntil': { $exists: false } },
        { 'inventory.syncLeaseUntil': { $lt: now } },
      ],
    },
    {
      _id: 1,
      mapping_id: 1,
      event_date: 1,
      'inventory.inventoryId': 1,
      'inventory.stubhubListingId': 1,
      'inventory.syncState': 1,
      'inventory.syncHash': 1,
      'inventory.syncAttempts': 1,
      'inventory.syncBatchId': 1,
      'inventory.syncPendingSince': 1,
    }
  )
    .sort({ event_date: 1 })
    .limit(limit)
    .lean();

  if (candidates.length === 0) return [];

  const docs = candidates as unknown as LeanRowDoc[];
  const ids = docs.map(c => c._id);
  const leaseUntil = new Date(now.getTime() + CLAIM_TTL_MS);

  await ConsecutiveGroup.updateMany(
    {
      _id: { $in: ids },
      $or: [
        { 'inventory.syncLeaseUntil': { $exists: false } },
        { 'inventory.syncLeaseUntil': { $lt: now } },
      ],
    },
    { $set: { 'inventory.syncLeaseUntil': leaseUntil } }
  );

  return docs.map(c => ({
    _id: c._id,
    mapping_id: c.mapping_id ?? '',
    event_date: c.event_date ?? new Date(0),
    inventoryId: c.inventory?.inventoryId ?? 0,
    stubhubListingId: c.inventory?.stubhubListingId ?? null,
    syncState: c.inventory?.syncState ?? 'pending',
    syncHash: c.inventory?.syncHash ?? null,
    syncAttempts: c.inventory?.syncAttempts ?? 0,
    syncBatchId: c.inventory?.syncBatchId ?? null,
    syncPendingSince: c.inventory?.syncPendingSince ?? null,
  }));
}

/** Same, for removals. */
export async function claimTombstones(limit: number, now = new Date()): Promise<ClaimedTombstone[]> {
  await dbConnect();

  const candidates = await InventoryTombstone.find({
    syncState: { $in: ['pending', 'deleting'] },
    syncAttempts: { $lt: MAX_ATTEMPTS },
    $or: [{ syncLeaseUntil: { $exists: false } }, { syncLeaseUntil: { $lt: now } }],
  })
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();

  if (candidates.length === 0) return [];

  const docs = candidates as unknown as LeanTombstoneDoc[];
  const leaseUntil = new Date(now.getTime() + CLAIM_TTL_MS);
  await InventoryTombstone.updateMany(
    { _id: { $in: docs.map(c => c._id) } },
    { $set: { syncLeaseUntil: leaseUntil } }
  );

  return docs.map(c => ({
    _id: c._id,
    inventoryId: c.inventoryId,
    stubhubListingId: c.stubhubListingId ?? null,
    reason: c.reason,
    createdAt: c.createdAt,
    delistedAt: c.delistedAt ?? null,
    syncAttempts: c.syncAttempts ?? 0,
    syncState: c.syncState ?? 'pending',
    syncBatchId: c.syncBatchId ?? null,
  }));
}

/**
 * A row is now in sync.
 *
 * Unsetting syncPendingSince is what removes it from the queue: the outbox index
 * is partial on that field's presence, so a synced row leaves the index entirely
 * rather than sitting in it marked done.
 */
export async function markSynced(id: unknown, hash: string, listingId?: string): Promise<void> {
  // A synced row must name the listing it is synced to.
  //
  // 'synced' means "StubHub holds this and we have checked" — it is the state
  // that stops a row being retried, and the hash gate skips it thereafter. A row
  // that reaches it without a listing id is therefore permanently done and
  // permanently absent from the marketplace, which is the worst outcome this
  // system can produce: silent, self-concealing loss. 288 rows ended up here.
  //
  // The queue cannot tell how it happened, but it can refuse to record the
  // contradiction, and sending the row back to be created is both safe and
  // self-correcting.
  if (!listingId) {
    const existing = await ConsecutiveGroup.findOne(
      { _id: id },
      { 'inventory.stubhubListingId': 1 }
    ).lean() as { inventory?: { stubhubListingId?: string | null } } | null;

    if (!existing?.inventory?.stubhubListingId) {
      await ConsecutiveGroup.updateOne(
        { _id: id },
        {
          $set: {
            'inventory.syncState': 'dirty',
            'inventory.syncPendingSince': new Date(),
            'inventory.syncError': 'refused to mark synced with no listing id',
          },
          $unset: { 'inventory.syncLeaseUntil': '', 'inventory.syncHash': '' },
        }
      );
      return;
    }
  }
  await ConsecutiveGroup.updateOne(
    { _id: id },
    {
      $set: {
        'inventory.syncState': 'synced',
        'inventory.syncHash': hash,
        'inventory.syncedAt': new Date(),
        'inventory.syncAttempts': 0,
        ...(listingId ? { 'inventory.stubhubListingId': listingId } : {}),
      },
      $unset: {
        'inventory.syncPendingSince': '',
        'inventory.syncLeaseUntil': '',
        'inventory.syncError': '',
        'inventory.syncBatchId': '',
      },
    }
  );
}

/**
 * Submitted in a bulk batch, not yet confirmed.
 *
 * The row stays in the queue on purpose. The next pass finds it in this state and
 * reads the listing back rather than re-sending — which is what lets the drain
 * submit a batch and move on instead of blocking for the several seconds a bulk
 * batch takes to settle.
 */
export async function markUpdating(id: unknown, batchId: string): Promise<void> {
  await ConsecutiveGroup.updateOne(
    { _id: id },
    {
      $set: {
        'inventory.syncState': 'updating',
        'inventory.syncBatchId': batchId,
        'inventory.syncPendingSince': new Date(),
      },
      $unset: { 'inventory.syncLeaseUntil': '' },
    }
  );
}

/**
 * Submitted in a create batch, awaiting its listing id.
 *
 * Stays in the queue so the next pass reads the batch result once and settles it.
 * Recording the batch id is what makes that possible without re-sending: the id
 * is derived from the batch's contents, so it names this exact submission.
 */
export async function markCreating(id: unknown, batchId: string): Promise<void> {
  await ConsecutiveGroup.updateOne(
    { _id: id },
    {
      $set: {
        'inventory.syncState': 'creating',
        'inventory.syncBatchId': batchId,
        'inventory.syncPendingSince': new Date(),
      },
      $unset: { 'inventory.syncLeaseUntil': '' },
    }
  );
}

/**
 * A listing exists but has no price yet.
 *
 * Create carries no price field, so this state is real rather than an artefact —
 * and it stays in the queue deliberately. The next drain sees a row with a
 * listing id and no matching hash and issues the price update, which is also how
 * a crash between the two halves of a create recovers by itself.
 */
export async function markCreated(id: unknown, listingId: string): Promise<void> {
  await ConsecutiveGroup.updateOne(
    { _id: id },
    {
      $set: {
        'inventory.syncState': 'created',
        'inventory.stubhubListingId': listingId,
        'inventory.syncPendingSince': new Date(),
      },
      $unset: { 'inventory.syncLeaseUntil': '' },
    }
  );
}

/**
 * Record a failure and either return the row to the queue or park it.
 *
 * Parking matters: a row that can never succeed — a malformed value, an event
 * StubHub rejects — would otherwise be retried forever, consuming budget that
 * working rows need. It stays visible as `failed` with its reason rather than
 * being deleted or silently ignored.
 */
export async function markFailed(id: unknown, error: string, attempts: number): Promise<void> {
  const exhausted = attempts + 1 >= MAX_ATTEMPTS;
  await ConsecutiveGroup.updateOne(
    { _id: id },
    {
      $set: {
        'inventory.syncState': exhausted ? 'failed' : 'dirty',
        'inventory.syncError': error.slice(0, 1000),
        'inventory.syncAttempts': attempts + 1,
      },
      $unset: { 'inventory.syncLeaseUntil': '' },
    }
  );
}

/** A row we cannot represent at all — no usable StubHub event id, typically. */
export async function markSkipped(id: unknown, reason: string): Promise<void> {
  await ConsecutiveGroup.updateOne(
    { _id: id },
    {
      $set: { 'inventory.syncState': 'skipped', 'inventory.syncError': reason.slice(0, 1000) },
      $unset: { 'inventory.syncPendingSince': '', 'inventory.syncLeaseUntil': '' },
    }
  );
}

/** The listing has stopped selling but is being held in case the row returns. */
export async function markDelisted(id: unknown, now = new Date()): Promise<void> {
  await InventoryTombstone.updateOne(
    { _id: id },
    { $set: { syncState: 'deleting', delistedAt: now }, $unset: { syncLeaseUntil: '' } }
  );
}

/**
 * Submitted in a bulk delete, awaiting confirmation.
 *
 * Kept in the queue on purpose: the next pass reads these back and settles them
 * by absence, which is what lets a batch be submitted without waiting for it.
 */
export async function markTombstoneSubmitted(id: unknown, batchId: string): Promise<void> {
  await InventoryTombstone.updateOne(
    { _id: id },
    { $set: { syncState: 'deleting', syncBatchId: batchId }, $unset: { syncLeaseUntil: '' } }
  );
}

export async function markTombstoneDone(id: unknown): Promise<void> {
  await InventoryTombstone.updateOne(
    { _id: id },
    { $set: { syncState: 'done', processedAt: new Date() }, $unset: { syncLeaseUntil: '' } }
  );
}

export async function markTombstoneFailed(id: unknown, error: string, attempts: number): Promise<void> {
  const exhausted = attempts + 1 >= MAX_ATTEMPTS;
  await InventoryTombstone.updateOne(
    { _id: id },
    {
      $set: {
        syncState: exhausted ? 'failed' : 'pending',
        syncError: error.slice(0, 1000),
        syncAttempts: attempts + 1,
      },
      $unset: { syncLeaseUntil: '' },
    }
  );
}

/**
 * The row came back before its tombstone was acted on.
 *
 * Deleting the tombstone is the cancellation: the listing was only delisted, so
 * re-broadcasting it costs one call and it keeps its id, its age and its history.
 * This is the flap case, and it is the common one — sections sell out and return
 * within minutes.
 */
export async function cancelTombstone(id: unknown): Promise<void> {
  await InventoryTombstone.deleteOne({ _id: id });
}

/** Counts for the dashboard and the circuit breaker. */
export async function queueDepth(): Promise<{
  pendingRows: number;
  pendingTombstones: number;
  failedRows: number;
  oldestPendingAt: Date | null;
}> {
  await dbConnect();

  const [pendingRows, pendingTombstones, failedRows, oldest] = await Promise.all([
    ConsecutiveGroup.countDocuments({ 'inventory.syncPendingSince': { $exists: true } }),
    InventoryTombstone.countDocuments({ syncState: { $in: ['pending', 'deleting'] } }),
    ConsecutiveGroup.countDocuments({ 'inventory.syncState': 'failed' }),
    ConsecutiveGroup.findOne(
      { 'inventory.syncPendingSince': { $exists: true } },
      { 'inventory.syncPendingSince': 1 }
    )
      .sort({ 'inventory.syncPendingSince': 1 })
      .lean(),
  ]);

  return {
    pendingRows,
    pendingTombstones,
    failedRows,
    // Sync lag in one number: how long the oldest unpushed change has waited.
    oldestPendingAt: (oldest as LeanRowDoc | null)?.inventory?.syncPendingSince ?? null,
  };
}

/**
 * Rows that exhausted their retries, with the reason.
 *
 * The single most useful thing on the dashboard during a cutover. A count of
 * failures tells you something is wrong; the actual API message tells you which
 * field, which is usually enough to fix it without reading a log.
 */
export async function recentFailures(limit = 20): Promise<Array<{
  inventoryId: number; mappingId: string; section: string; row: string;
  error: string; attempts: number;
}>> {
  await dbConnect();
  const docs = await ConsecutiveGroup.find(
    { 'inventory.syncState': { $in: ['failed', 'skipped'] } },
    {
      mapping_id: 1, section: 1, row: 1,
      'inventory.inventoryId': 1, 'inventory.syncError': 1, 'inventory.syncAttempts': 1,
    }
  )
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  return (docs as unknown as Array<LeanRowDoc & {
    section?: string; row?: string;
    inventory?: { syncError?: string };
  }>).map(d => ({
    inventoryId: d.inventory?.inventoryId ?? 0,
    mappingId: d.mapping_id ?? '',
    section: d.section ?? '',
    row: d.row ?? '',
    error: (d.inventory as { syncError?: string } | undefined)?.syncError ?? '',
    attempts: d.inventory?.syncAttempts ?? 0,
  }));
}

/**
 * Why rows were skipped, grouped.
 *
 * Skips are not failures — a row with no StubHub event id is correctly ignored
 * rather than retried — but a rising count means a data problem upstream, and the
 * grouping says which one without anyone grepping.
 */
export async function skipBreakdown(): Promise<Array<{ reason: string; count: number }>> {
  await dbConnect();
  const rows = await ConsecutiveGroup.aggregate([
    { $match: { 'inventory.syncState': 'skipped' } },
    // The reason is stored as "<code>: <detail>"; the code is the useful half.
    { $project: { reason: { $arrayElemAt: [{ $split: ['$inventory.syncError', ':'] }, 0] } } },
    { $group: { _id: '$reason', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);
  return rows.map((r: { _id: string | null; count: number }) => ({
    reason: r._id || 'unknown',
    count: r.count,
  }));
}

/**
 * Pending work grouped by event.
 *
 * During a live test this answers the question you actually have — "is it keeping
 * up with the scraper, and on which events is it behind" — which a single queue
 * depth cannot.
 */
export async function pendingByEvent(limit = 10): Promise<Array<{
  mappingId: string; count: number; oldest: Date | null;
}>> {
  await dbConnect();
  const rows = await ConsecutiveGroup.aggregate([
    { $match: { 'inventory.syncPendingSince': { $exists: true } } },
    { $group: {
        _id: '$mapping_id',
        count: { $sum: 1 },
        oldest: { $min: '$inventory.syncPendingSince' },
    } },
    { $sort: { count: -1 } },
    { $limit: limit },
  ]);
  return rows.map((r: { _id: string; count: number; oldest: Date }) => ({
    mappingId: r._id ?? '',
    count: r.count,
    oldest: r.oldest ?? null,
  }));
}

/**
 * Return parked rows to the queue.
 *
 * A row is parked after MAX_ATTEMPTS so that something permanently broken stops
 * consuming budget the working rows need. That is right, but it needs an undo:
 * when the cause was a bug in this code rather than in the data — and so far it
 * has been, twice — every parked row is fine and simply needs another go. Without
 * this the only remedy is a hand-written database update, which is not something
 * an operator should be doing at speed.
 */
export async function retryParked(): Promise<number> {
  await dbConnect();
  const res = await ConsecutiveGroup.updateMany(
    { 'inventory.syncState': { $in: ['failed', 'skipped'] } },
    {
      $set: {
        'inventory.syncState': 'dirty',
        'inventory.syncPendingSince': new Date(),
        'inventory.syncAttempts': 0,
      },
      $unset: { 'inventory.syncLeaseUntil': '', 'inventory.syncError': '' },
    }
  );
  await InventoryTombstone.updateMany(
    { syncState: 'failed' },
    { $set: { syncState: 'pending', syncAttempts: 0 }, $unset: { syncLeaseUntil: '', syncError: '' } }
  );
  return res.modifiedCount;
}

/**
 * Rows in each sync state.
 *
 * The pipeline is pending -> creating -> created -> updating -> synced, and a
 * single "rows waiting" number collapses all of it. Seeing where rows actually
 * sit is what distinguishes "creating steadily" from "stuck mid-create", which
 * look identical from a queue depth.
 */
export async function stateBreakdown(): Promise<Record<string, number>> {
  await dbConnect();
  const rows = await ConsecutiveGroup.aggregate([
    { $match: { 'inventory.syncState': { $exists: true } } },
    { $group: { _id: '$inventory.syncState', n: { $sum: 1 } } },
  ]);
  return Object.fromEntries(
    (rows as Array<{ _id: string; n: number }>).map(r => [r._id ?? 'unknown', r.n])
  );
}

/**
 * Hand rows back early instead of sitting on the claim.
 *
 * claimRows takes a CLAIM_TTL_MS lease so a crashed worker cannot strand rows.
 * That is right for a row being worked on, and badly wrong for one the pass
 * looked at and deliberately deferred — a batch that has not finished yet, or a
 * write still inside its settle window. Those rows kept the full five-minute
 * lease, so the loop claimed a slice, declined to settle any of it, and then had
 * nothing claimable to do until the lease aged out. 1,222 creates that StubHub
 * had already completed sat untouched for five minutes at a time, and the
 * dashboard showed a worker running flat out doing nothing.
 *
 * A deferred row gets a short lease instead: long enough not to spin on it,
 * short enough that the next pass picks it up.
 */
export async function deferRows(ids: unknown[], ms: number): Promise<void> {
  if (ids.length === 0) return;
  await dbConnect();
  await ConsecutiveGroup.updateMany(
    { _id: { $in: ids as never[] } },
    { $set: { 'inventory.syncLeaseUntil': new Date(Date.now() + ms) } }
  );
}
