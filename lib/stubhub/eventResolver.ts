/**
 * mapping_id → StubHub (Viagogo) event id.
 *
 * All three scrapers agree on one marketplace identity field, `mapping_id`, but
 * they don't agree on what goes in it:
 *
 *   Ticketmaster   9-digit StubHub event id, after scripts/replaceStubhubMappingIds.js
 *   tickets.com    "tc-1787216947276" — a local synthetic id, useless to StubHub
 *   eVenue         "SE26_JAB3" — the venue's own code, likewise
 *
 * Verified live: GET /events?eventId=159262123 returns "Washington Nationals at
 * Atlanta Braves" at Truist Park, so the remapped Ticketmaster ids are real. There
 * is no event *search* endpoint in the API, so an id we don't already hold cannot
 * be looked up by name and date — the only alternative is the fuzzy `eventMapping`
 * object on create, which we deliberately don't use (it can silently mis-map).
 *
 * This module only answers "could this be an event id at all". It used to require
 * exactly nine digits, and production showed that heuristic to be wrong in both
 * directions: 454452424 is nine digits and does not exist on StubHub, while
 * 2546456 is seven digits and does. Digit count carries no information here.
 *
 * The real check is eventVerifier.ts, which asks the API and compares the answer
 * against the event we hold. This stays as the cheap pre-filter that rejects
 * things that are obviously not ids — tickets.com "tc-…", eVenue venue codes —
 * without spending a request on them.
 *
 * A skip must never reach the delete path. A row we cannot resolve is a row we
 * cannot talk about, not a row that should be removed from the marketplace.
 */

const STUBHUB_EVENT_ID = /^[0-9]+$/;
const TICKETSCOM_SYNTHETIC = /^tc-/i;

export type SkipReason =
  | 'no-mapping'
  | 'ticketscom-synthetic'
  | 'not-stubhub-shaped';

export type EventResolution =
  | { ok: true; eventId: number }
  | { ok: false; reason: SkipReason; detail: string };

export function resolveEventId(mappingId: string | undefined | null): EventResolution {
  const raw = (mappingId ?? '').trim();

  if (!raw) {
    return { ok: false, reason: 'no-mapping', detail: 'mapping_id is empty' };
  }

  if (STUBHUB_EVENT_ID.test(raw)) {
    const parsed = Number.parseInt(raw, 10);
    // EventRequest.id is int32 in the spec, so anything larger cannot be one.
    if (parsed > 2_147_483_647) {
      return { ok: false, reason: 'not-stubhub-shaped', detail: `${raw} exceeds int32` };
    }
    return { ok: true, eventId: parsed };
  }

  if (TICKETSCOM_SYNTHETIC.test(raw)) {
    return {
      ok: false,
      reason: 'ticketscom-synthetic',
      detail: `${raw} is a local tickets.com id, not a StubHub event`,
    };
  }

  return {
    ok: false,
    reason: 'not-stubhub-shaped',
    detail: `${raw} is not numeric, so it cannot be a StubHub event id`,
  };
}

/** True when this row can be sent at all. Convenience for filters and reports. */
export function isResolvable(mappingId: string | undefined | null): boolean {
  return resolveEventId(mappingId).ok;
}
