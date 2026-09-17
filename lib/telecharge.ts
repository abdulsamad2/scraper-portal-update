/**
 * Telecharge (Broadway) support.
 *
 * Scraped by a separate service (~/telecharge-scraper) that reads its roster
 * straight out of Mongo. There is no API between the two: the portal registers a
 * performance by inserting a row into `tele_events`, and pausing, markup and
 * deletion are all just writes to that row. The scraper delists inventory itself.
 *
 * The portal cannot reach Telecharge, so to list a show's performances it drops a
 * request into `tele_lookups` and the running scraper answers it
 * (lib/telechargeLookup.ts).
 *
 * Unlike every other source, one event row is ONE PERFORMANCE of a show, and all
 * performances share the show URL. A row is identified by URL + Event_DateTime
 * (venue wall-clock time, stored as UTC like every date in the portal). The
 * scraper matches that to Telecharge's own performance list.
 *
 * Keep parseTelechargeUrl identical to the scraper's (lib/telechargeApi.js) —
 * both sides must store the same canonical URL for the same show.
 */

export const TELECHARGE_SOURCE = 'telecharge';

export const TELECHARGE_EVENTS_COLLECTION = process.env.TELE_EVENTS_COLLECTION || 'tele_events';
export const TELECHARGE_GROUPS_COLLECTION = process.env.TELE_GROUPS_COLLECTION || 'tele_consecutivegroups';
/** "Which performances are on sale?" requests the scraper answers (telecharge-scraper/lib/lookups.js). */
export const TELECHARGE_LOOKUPS_COLLECTION = process.env.TELE_LOOKUPS_COLLECTION || 'tele_lookups';

/** One on-sale performance, as the scraper reports it. */
export interface TelechargePerformanceOption {
  /** Venue wall-clock time labelled UTC — store on the row as-is. */
  Event_DateTime: string;
  perfKey: number;
  perfType?: string;
  soldOut?: boolean;
  /** Already registered in the portal for this show. */
  tracked?: boolean;
}

export interface TelechargeShowInfo {
  slug: string;
  url: string;
  productId: number;
  title: string | null;
  theatre: string | null;
}

export type TelechargeLookupResult =
  | { show: TelechargeShowInfo; performances: TelechargePerformanceOption[] }
  | { error: string };

/** A stored wall-clock date, formatted without shifting it into the browser's zone. */
export function formatPerformance(iso: string | Date, part: 'date' | 'time' | 'both' = 'both'): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const opts: Intl.DateTimeFormatOptions =
    part === 'date'
      ? { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }
      : part === 'time'
        ? { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }
        : { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' };
  return d.toLocaleString('en-US', opts);
}

/** Telecharge's performance type codes. */
export function perfTypeLabel(code?: string): string {
  if (code === 'D') return 'Matinee';
  if (code === 'E') return 'Evening';
  return code || '';
}

/**
 * A Telecharge show page, e.g.
 * https://www.telecharge.com/Two-Strangers-carry-A-Cake-Across-New-York-Tickets
 * The "-Results" (seat map) page of the same show is accepted too.
 */
export function parseTelechargeUrl(url: string): { slug: string } | null {
  try {
    const u = new URL(String(url || '').trim());
    if (!/(^|\.)telecharge\.com$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/([^/?#]+?)(?:-(?:Tickets|Results))?\/?$/i);
    if (!m || !m[1]) return null;
    return { slug: m[1] };
  } catch {
    return null;
  }
}

export function isTelechargeUrl(url: string): boolean {
  return parseTelechargeUrl(url) !== null;
}

/** The one spelling a show's URL is stored under. */
export function canonicalTelechargeUrl(url: string): string | null {
  const parsed = parseTelechargeUrl(url);
  return parsed ? `https://www.telecharge.com/${parsed.slug}-Tickets` : null;
}

/** True for an event document owned by the Telecharge scraper. */
export function isTelechargeEvent(event: { Source?: string; URL?: string } | null): boolean {
  if (!event) return false;
  if (event.Source === TELECHARGE_SOURCE) return true;
  return Boolean(event.URL && isTelechargeUrl(event.URL));
}

/** Why a row is not scraping, in words for the dashboard. */
export const TELECHARGE_STATUS_LABELS: Record<string, string> = {
  pending: 'Waiting for first scrape',
  active: 'Scraping',
  unresolved: 'Needs attention',
  not_on_sale: 'Not on sale',
  error: 'Failing',
};
