/**
 * Drain policy: make updates land immediately without spamming the API.
 *
 * These two goals sound opposed — "instant" suggests firing on every change,
 * "don't pollute" suggests batching and waiting — but they are only opposed if
 * the loop runs on a timer. A fixed interval is the worst of both: it adds
 * latency when the queue is empty and still sends redundant work when it is full.
 *
 * Four properties get both at once. None of them requires a delay.
 *
 * ── 1. Never wait to fill a batch ──────────────────────────────────────────────
 *
 * Take whatever is pending right now, up to the 250-item cap, and send it. If one
 * row is dirty, one row goes immediately. If five hundred are, they go as two
 * batches back to back.
 *
 * Batching then happens *because* of load rather than in anticipation of it: rows
 * that change while a batch is in flight are simply waiting when it returns, so
 * the next batch is naturally fuller. Throughput rises with pressure and latency
 * stays at one round trip when quiet. This is the Nagle trade-off made in the
 * right direction — the flight time of the previous request is the only "delay",
 * and it is work rather than waiting.
 *
 * ── 2. Coalescing is free if you read late ─────────────────────────────────────
 *
 * The worker builds the payload from the row's *current* state at send time, not
 * from a snapshot captured when it was marked dirty. A price that moved three
 * times before the drain produces one call carrying the final value, never three
 * carrying two stale ones. Nothing has to detect or suppress the duplicates —
 * they never come into existence.
 *
 * ── 3. The hash gate makes no-ops free ─────────────────────────────────────────
 *
 * A row whose mapped payload hashes to what StubHub already accepted costs zero
 * requests. In steady state that is the overwhelming majority, which is what makes
 * an aggressive drain affordable in the first place.
 *
 * ── 4. Delist first, delete later ──────────────────────────────────────────────
 *
 * Sections sell out and come back minutes later. Treating every disappearance as a
 * delete means a full two-call recreate each time the row returns, new listing ids,
 * lost listing age — expensive for us and noisy for StubHub.
 *
 * So removal is two-phase: delist immediately, which is what actually matters
 * (an unavailable listing must stop selling *now*), then delete only if the row
 * has stayed gone past a grace window. A row that reappears inside the window is
 * re-broadcast on its existing listing id: one call, no churn, nothing lost.
 *
 * The safety ordering is the right way round — protection against overselling is
 * instant, and only the irreversible half waits.
 */

import { MAX_BATCH_ITEMS, SINGLE_CALL_THRESHOLD, type WriteOperation } from './limits.ts';

/**
 * How long a removed row must stay gone before its listing is actually deleted.
 *
 * Long enough to absorb ordinary scrape flapping — the scrapers revisit each event
 * roughly every two minutes, so this spans several cycles — and short enough that
 * genuinely dead inventory doesn't linger delisted for hours.
 */
export const REAPPEARANCE_GRACE_MS = 15 * 60 * 1000;

/**
 * Idle sleep when the queue is empty. Not a drain interval — when rows are
 * pending the loop drains continuously and never sleeps, so this is only the
 * delay before an idle worker notices new work.
 *
 * That makes it the floor on end-to-end latency, so it is set low. The check it
 * gates is a single indexed find against the partial outbox index, which costs
 * essentially nothing against a collection where almost no rows are pending; four
 * of them a second is not a load anyone will measure.
 *
 * A MongoDB change stream would remove the floor entirely by pushing rather than
 * polling, and Atlas supports it. That is the right upgrade if 250ms ever proves
 * too slow, but it adds a connection to supervise and a resume-token to persist,
 * and polling an indexed query is hard to beat for the money.
 */
export const IDLE_POLL_MS = Number(process.env.STUBHUB_IDLE_POLL_MS ?? 250);

/** Backoff between polls of a submitted bulk batch, in ms, capped. */
export const BULK_POLL_BACKOFF_MS = [250, 500, 1_000, 2_000, 4_000, 8_000] as const;

export interface BatchPlan {
  /** Items to send in this pass. */
  size: number;
  path: 'single' | 'bulk';
  /** True when more work remains after this pass — drain again without sleeping. */
  more: boolean;
  reason: string;
}

/**
 * Decide what to send right now, given what is pending.
 *
 * Deliberately has no notion of time. There is no "wait for more", no minimum
 * batch size, no debounce window. Whatever is ready goes, immediately, and the
 * only question is which transport carries it.
 */
export function planBatch(pendingCount: number, operation: WriteOperation): BatchPlan {
  if (pendingCount <= 0) {
    return { size: 0, path: 'single', more: false, reason: 'nothing pending' };
  }

  const size = Math.min(pendingCount, MAX_BATCH_ITEMS);
  const more = pendingCount > size;

  // Creates are never safe to retry outside bulk (bulkProcessingId is the only
  // idempotency handle in the API), so they batch regardless of how few there are.
  if (operation === 'create') {
    return { size, path: 'bulk', more, reason: 'creates require the bulk idempotency key' };
  }

  // Below the threshold a batch costs more round trips than it saves requests:
  // bulk is submit-then-poll, a single PATCH is one call and done. Updates and
  // deletes are idempotent, so the single path is safe to retry.
  if (size <= SINGLE_CALL_THRESHOLD) {
    return { size, path: 'single', more, reason: 'small change set — one round trip beats submit-and-poll' };
  }

  return { size, path: 'bulk', more, reason: `batched to the ${MAX_BATCH_ITEMS}-item cap` };
}

export type RemovalAction = 'delist' | 'delete' | 'cancel' | 'wait';

export interface RemovalDecision {
  action: RemovalAction;
  reason: string;
}

/**
 * What to do about a row that has gone away.
 *
 * @param opts.stubhubListingId  null when the listing was never created
 * @param opts.delistedAt        when we stopped it selling, null if not yet
 * @param opts.reappeared        the row is back in the current scrape
 * @param opts.reason            why it was removed — some reasons are final
 * @param opts.now               current time
 */
export function resolveRemoval(opts: {
  stubhubListingId: string | null;
  delistedAt: Date | null;
  reappeared: boolean;
  reason: string;
  now: Date;
}): RemovalDecision {
  const { stubhubListingId, delistedAt, reappeared, reason, now } = opts;

  // Never created, so there is nothing on StubHub to act on. Resolve locally.
  if (!stubhubListingId) {
    return { action: 'cancel', reason: 'no listing was ever created' };
  }

  // It came back. Re-broadcast the existing listing rather than recreating it:
  // one call, and the listing keeps its id, its age and its history.
  if (reappeared) {
    return { action: 'cancel', reason: 'row reappeared — re-broadcast the existing listing' };
  }

  // Some removals are not flapping and should not wait out a grace window.
  const FINAL = new Set(['event-deleted', 'event-expired', 'manual', 'seats-changed']);
  if (FINAL.has(reason)) {
    return delistedAt
      ? { action: 'delete', reason: `${reason} is final` }
      : { action: 'delist', reason: `${reason} — stop selling first, delete next pass` };
  }

  // Stop it selling immediately. This is the half that actually protects us.
  if (!delistedAt) {
    return { action: 'delist', reason: 'stop selling now; hold the listing in case it returns' };
  }

  if (now.getTime() - delistedAt.getTime() < REAPPEARANCE_GRACE_MS) {
    return { action: 'wait', reason: 'inside the reappearance window — no churn yet' };
  }

  return { action: 'delete', reason: 'stayed gone past the grace window' };
}

/**
 * Poll delay for a submitted bulk batch. Starts tight so a fast batch is noticed
 * fast, backs off so a slow one doesn't burn the budget — bulk status shares the
 * general 100/min allowance, unlike the bulk submit itself.
 */
export function bulkPollDelay(attempt: number): number {
  const i = Math.min(attempt, BULK_POLL_BACKOFF_MS.length - 1);
  return BULK_POLL_BACKOFF_MS[i];
}
