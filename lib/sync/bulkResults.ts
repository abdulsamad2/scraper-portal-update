/**
 * Matching bulk results back to the rows that produced them.
 *
 * Pure and dependency-free on purpose: this is the piece that was silently wrong
 * for a whole live run, so it needs to be testable without a transport, a
 * database, or the Next module graph.
 */

import type { BulkProcessingResultSummaryResponse } from '../stubhub/types.ts';

export interface ItemOutcome {
  externalId: string;
  ok: boolean;
  entityId?: number;
  error?: string;
}

/**
 * Flatten a bulk summary into per-item outcomes, keyed by every identifier the
 * result carries.
 *
 * This is keyed twice on purpose, and the reason cost real time to find. A bulk
 * result identifies an item by whichever id the request gave it. Creates send an
 * externalId, so results come back carrying it. Updates identify the listing by
 * inventoryId, so their results come back as `{ entityId: 1818287155 }` with no
 * externalId at all.
 *
 * Keying only on externalId therefore threw away every update outcome silently.
 * The updates themselves succeeded — prices were correct on StubHub — but the
 * worker could not match a single result back to a row, so it recorded nothing,
 * left the rows pending, and re-sent the same work on every pass while reporting
 * zero updates and a lag that only grew.
 *
 * Per-item rather than per-batch on purpose: one malformed row must never abandon
 * the other 249. The error object carries a per-field `errors` map, which is the
 * single most useful thing for fixing a mapper, so it is preserved rather than
 * flattened to a status code.
 */
export function outcomes(summary: BulkProcessingResultSummaryResponse | null): Map<string, ItemOutcome> {
  const map = new Map<string, ItemOutcome>();
  if (!summary) return map;

  const put = (r: { entityId?: number | null; externalId?: string | null }, outcome: ItemOutcome) => {
    if (r.externalId) map.set(r.externalId, outcome);
    if (r.entityId != null) map.set(String(r.entityId), outcome);
  };

  for (const r of summary.completed ?? []) {
    put(r, { externalId: r.externalId ?? String(r.entityId ?? ''), ok: true, entityId: r.entityId ?? undefined });
  }
  for (const bucket of [summary.failed ?? [], summary.skipped ?? []]) {
    for (const r of bucket) {
      const fields = r.error?.errors
        ? ' ' + Object.entries(r.error.errors).map(([k, v]) => `${k}=${v.join('/')}`).join(' ')
        : '';
      put(r, {
        externalId: r.externalId ?? String(r.entityId ?? ''),
        ok: false,
        error: `${r.error?.code ?? 'error'}: ${r.error?.message ?? 'unknown'}${fields}`,
      });
    }
  }
  return map;
}
