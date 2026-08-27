/**
 * StubHub POS rate limits — supplied by StubHub, 4 June 2026.
 *
 * These are not in the OpenAPI spec. The spec declares no 429 response on any of
 * its 160 operations and returns no X-RateLimit-* or Retry-After headers, so
 * without this table there is no way to know the budget or to be told when you
 * have spent it. Recording the numbers here, with their provenance, is the only
 * thing standing between the worker and throttling blind.
 *
 * Two caveats worth carrying:
 *
 *   - Some limits are quoted per *client application* ("DELETE ticketgroups
 *     (client app 8 only)", "POST purchases 670/min general, 2,500/min client app
 *     8"). We do not know which client app id we are issued, so treat the general
 *     figure as ours until confirmed.
 *   - The window shape is unstated — fixed minute, sliding window, or burst
 *     bucket. The limiter below assumes the pessimistic reading (a sustained rate
 *     with no burst credit) and keeps the adaptive backoff regardless, because a
 *     table that turns out to be stale should degrade into caution rather than
 *     into a wall of failed writes.
 */

/** Requests per minute, per endpoint. Undocumented in the spec; sourced above. */
export const RATE_LIMITS = {
  // High throughput — the endpoints integrators lean on.
  'PATCH /inventory/{id}': 12_880,
  'PATCH /inventory/{id}/prices': 12_880,
  'PATCH /inventory/{id}/pricingSettings': 12_880,
  'GET /inventory/{id}': 10_000,
  'GET /ticketgroups/{id}': 10_000,
  'DELETE /inventory/{id}': 2_730,

  // Medium.
  'POST /inventory': 1_800,
  'GET /events/{id}/inventory': 1_360,
  'GET /inventory/external/{externalId}': 1_180,
  'GET /inventory/externals/{externalId}': 1_180,
  'POST /inventory/bulk': 760,
  'GET /inventory/seek': 700,

  // Low — most of the remaining surface sits at 100/min.
  'GET /accounts': 310,
  'GET /events': 320,
  'POST /webhooks': 100,
  DEFAULT: 100,

  // Heavily restricted. These three shape the reconciliation design more than
  // any of the write limits do.
  'GET /inventory/search': 10,
  'GET /inventory/export/all': 0.5, // one per two minutes
} as const;

/**
 * StubHub's stated maximum items per batch. It is not in the spec — the bulk
 * request schema documents no array limit at all.
 *
 * Unresolved: whether 250 counts the whole request or each array separately.
 * BulkInventoryRequest can carry createRequests, updateRequests and
 * deleteRequests together, so the two readings differ by 3x. We assume the
 * stricter one — 250 items across the entire request — because overshooting an
 * undocumented cap risks a rejection we cannot distinguish from a malformed
 * batch.
 */
export const MAX_BATCH_ITEMS = 250;

/**
 * Reserve headroom rather than aiming at the ceiling. The window shape is
 * unknown, the limits may be shared with anything else on the account, and being
 * throttled costs far more than going slightly slower.
 */
export const RATE_UTILISATION = 0.5;

export type WriteOperation = 'create' | 'update' | 'delete';

/**
 * Which transport a write should take.
 *
 * The naive reading of the limits says "bulk everything": 760 batches/min at 250
 * items is ~190,000 items/min, against 12,880/min for single PATCH. Bulk wins on
 * throughput by more than an order of magnitude and that is the right default for
 * anything scraper-driven.
 *
 * But throughput is not the only axis, and the idempotency argument is narrower
 * than it first appears:
 *
 *   create   NOT idempotent. A POST /inventory that times out may have succeeded;
 *            retrying can duplicate the listing, and externalId is not documented
 *            as unique. bulkProcessingId is the only idempotency handle in the
 *            entire API, so creates must go through bulk. This is a correctness
 *            constraint, not a performance one.
 *
 *   update   Naturally idempotent — setting a price to X twice leaves it at X. A
 *            retried PATCH is safe, so single-call updates are permitted when
 *            latency matters more than efficiency.
 *
 *   delete   Naturally idempotent — the second delete is a no-op or a 404.
 *            Same reasoning as update.
 *
 * So: bulk for volume, single-call for the handful of changes where waiting for a
 * batch to drain would be worse than spending the extra requests. A price edit
 * made by a human in the dashboard should land now, not on the next drain.
 */
export function chooseWritePath(
  operation: WriteOperation,
  itemCount: number,
  opts: { urgent?: boolean } = {},
): 'bulk' | 'single' {
  // Creates are never safe to retry outside bulk, regardless of urgency or size.
  if (operation === 'create') return 'bulk';
  if (opts.urgent && itemCount <= SINGLE_CALL_THRESHOLD) return 'single';
  return itemCount <= SINGLE_CALL_THRESHOLD ? 'single' : 'bulk';
}

/**
 * Below this, a batch costs more in round-trips (submit, then poll until
 * finished) than it saves in requests.
 */
export const SINGLE_CALL_THRESHOLD = 5;

/** Sustainable requests per second for an endpoint, with headroom applied. */
export function budgetPerSecond(endpoint: keyof typeof RATE_LIMITS): number {
  const perMinute = RATE_LIMITS[endpoint] ?? RATE_LIMITS.DEFAULT;
  return (perMinute * RATE_UTILISATION) / 60;
}

/**
 * How many items per minute a given write path can sustain — the number that
 * actually matters when sizing a drain interval against a measured change rate.
 */
export function itemsPerMinute(path: 'bulk' | 'single', operation: WriteOperation): number {
  if (path === 'bulk') {
    return RATE_LIMITS['POST /inventory/bulk'] * MAX_BATCH_ITEMS * RATE_UTILISATION;
  }
  const endpoint =
    operation === 'create' ? 'POST /inventory'
    : operation === 'delete' ? 'DELETE /inventory/{id}'
    : 'PATCH /inventory/{id}';
  return RATE_LIMITS[endpoint] * RATE_UTILISATION;
}

/**
 * Reconciliation cadence is now the binding constraint, not the write path.
 *
 * The full export is capped at one call per two minutes and the old
 * GET /inventory/search at ten per minute — both far too slow to diff against per
 * cycle even if we wanted to. This is what forces the local-hash design: the diff
 * has to be a comparison against what we recorded sending, with the export
 * demoted to a slow audit sweep. GET /inventory/seek at 700/min is the exception,
 * and is the right tool for verifying a specific set of listings on demand.
 */
export const RECONCILIATION = {
  /** Minimum seconds between full export calls. */
  minExportIntervalSeconds: 120,
  /** Read pages are documented at max 5000 in the spec; unrelated to rate. */
  exportPageSize: 5_000,
  /** Targeted verification path — cheap enough to use freely. */
  seekPerMinute: RATE_LIMITS['GET /inventory/seek'],
} as const;
