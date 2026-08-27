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
 * Consequence: anything that isn't nine digits is skipped and reported. It is never
 * guessed at, and — this is the part that matters — a skip must never reach the
 * delete path. A row we can't resolve is a row we can't talk about, not a row that
 * should be removed from the marketplace.
 */

const STUBHUB_EVENT_ID = /^[0-9]{9}$/;
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
    // int32 in the spec (EventRequest.id); 9 digits is comfortably inside range.
    return { ok: true, eventId: Number.parseInt(raw, 10) };
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
    detail: `${raw} is not a 9-digit StubHub event id`,
  };
}

/** True when this row can be sent at all. Convenience for filters and reports. */
export function isResolvable(mappingId: string | undefined | null): boolean {
  return resolveEventId(mappingId).ok;
}
