/**
 * Confirm that a mapping_id names the event we think it does.
 *
 * eventResolver only checks the shape of the id. That is not enough, and
 * production proved it in both directions on the first live run:
 *
 *   454452424  nine digits, passes the shape check, and does not exist on
 *              StubHub at all. Every create in the batch came back
 *              "Event.Id must be a valid existing event" — 250 rejections for
 *              one bad id, because a bulk batch fails as a unit.
 *
 *   2546456    seven digits, fails the shape check, and IS a real StubHub event
 *              — just not ours. It resolves to Cleveland Indians at Arizona
 *              Diamondbacks in 2018, while our row is a Bruno Mars concert.
 *
 * The second case is the dangerous one. A rejected create is loud and costs
 * nothing; listing a Bruno Mars ticket against a 2018 baseball game would have
 * succeeded silently and sold real inventory into the wrong event. Digit count
 * simply does not carry the information we were asking it for.
 *
 * So the id is confirmed against the API before anything is listed, and the
 * event that comes back is checked against the event we hold. One extra read per
 * event per drain, cached — GET /events allows 320/min and a drain touches a
 * handful of events, so this is cheap insurance against the worst failure mode
 * this integration has.
 */

import type { StubHubClient } from './client.ts';
import { StubHubError } from './client.ts';

export type VerifyFailure =
  | 'not-numeric'      // cannot be an event id at all
  | 'not-found'        // the API does not know this id
  | 'wrong-event'      // the id resolves to a different event than ours
  | 'lookup-failed';   // transient — do not treat as a data problem

export type VerifiedEvent =
  | { ok: true; eventId: number; name: string; date: string | null }
  | { ok: false; reason: VerifyFailure; detail: string };

/**
 * How far apart two dates may be and still be the same event.
 *
 * Generous on purpose. Events are rescheduled and StubHub's date is then more
 * current than ours, so a strict comparison would reject listings that are
 * perfectly valid. What this needs to catch is a recycled or mistyped id
 * pointing at something entirely unrelated, and those are years out, not days.
 */
const MAX_DATE_DRIFT_DAYS = 30;

interface CacheEntry { result: VerifiedEvent; at: number }
const cache = new Map<string, CacheEntry>();

/** Verification is stable; re-checking every drain would waste the budget. */
const CACHE_TTL_MS = 30 * 60 * 1000;

export function clearEventCache(): void {
  cache.clear();
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

/**
 * @param mappingId  our stored marketplace id
 * @param expected   what we believe the event is, used to catch a wrong match
 */
export async function verifyEvent(
  client: StubHubClient,
  mappingId: string | undefined | null,
  expected: { name?: string; date?: string | Date } = {}
): Promise<VerifiedEvent> {
  const raw = (mappingId ?? '').trim();

  // Not a number at all — tickets.com "tc-…", eVenue venue codes. No lookup
  // needed and none possible.
  if (!/^\d+$/.test(raw)) {
    return {
      ok: false,
      reason: 'not-numeric',
      detail: raw ? `${raw} is not a numeric event id` : 'mapping_id is empty',
    };
  }

  const cached = cache.get(raw);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

  let result: VerifiedEvent;
  try {
    const res = await client.request<{ event?: { id: number; name?: string; date?: string; venue?: string } }>({
      method: 'GET',
      path: `/events?eventId=${encodeURIComponent(raw)}`,
      endpoint: 'GET /events',
      idempotent: true,
    });

    const event = res.data?.event;
    if (!event?.id) {
      result = { ok: false, reason: 'not-found', detail: `StubHub has no event ${raw}` };
    } else if (expected.date && event.date) {
      const drift = daysBetween(new Date(expected.date), new Date(event.date));
      if (drift > MAX_DATE_DRIFT_DAYS) {
        // The id is real but it is not ours. This is the case that would
        // otherwise list inventory against someone else's event.
        result = {
          ok: false,
          reason: 'wrong-event',
          detail:
            `${raw} is "${event.name ?? '?'}" on ${String(event.date).slice(0, 10)}, ` +
            `but our row is "${expected.name ?? '?'}" on ${new Date(expected.date).toISOString().slice(0, 10)} ` +
            `(${Math.round(drift)} days apart)`,
        };
      } else {
        result = { ok: true, eventId: event.id, name: event.name ?? '', date: event.date ?? null };
      }
    } else {
      result = { ok: true, eventId: event.id, name: event.name ?? '', date: event.date ?? null };
    }
  } catch (error) {
    const status = error instanceof StubHubError ? error.status : 0;
    if (status === 404) {
      result = { ok: false, reason: 'not-found', detail: `StubHub has no event ${raw}` };
    } else {
      // A transient lookup failure must not be recorded as a data problem, or a
      // brief outage would mark the whole book unlistable. Not cached.
      return {
        ok: false,
        reason: 'lookup-failed',
        detail: error instanceof StubHubError ? error.summary : String(error),
      };
    }
  }

  cache.set(raw, { result, at: Date.now() });
  return result;
}
