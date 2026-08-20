/**
 * eVenue / Paciolan support.
 *
 * Events on eVenue box-office sites are scraped by a separate service
 * (~/evenue-scraper) that reads its roster straight out of Mongo. There is no
 * API between the two: the portal registers an event by inserting a row into
 * `ev_events`, and that is the entire contract.
 *
 * The portal only ever writes the two fields an operator actually knows — the
 * URL and the markup. Event_ID, name, date, venue and the platform context are
 * resolved from the live site by the scraper on its first pass and written back
 * into that same row.
 *
 * Keep `deriveEvenueEventId` identical to the scraper's `deriveEventId`
 * (evenue-scraper/lib/evenueApi.js): both sides must agree on an event's ID or
 * the scraper will not recognise the row the portal wrote.
 */

export const EVENUE_SOURCE = 'evenue';
export const TICKETMASTER_SOURCE = 'ticketmaster';

/** Collection the eVenue scraper reads its roster from. */
export const EVENUE_EVENTS_COLLECTION = process.env.EV_EVENTS_COLLECTION || 'ev_events';
export const EVENUE_GROUPS_COLLECTION = process.env.EV_GROUPS_COLLECTION || 'ev_consecutivegroups';

/**
 * Hosts served by eVenue. Every verified deployment is a subdomain of
 * evenue.net (e.g. pennathletics.evenue.net); EV_EXTRA_HOSTS is there for a
 * Paciolan site on its own domain, as a comma-separated list.
 */
const EXTRA_HOSTS = (process.env.EV_EXTRA_HOSTS || '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

function hostIsEvenue(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'evenue.net' || h.endsWith('.evenue.net')) return true;
  return EXTRA_HOSTS.some((extra) => h === extra || h.endsWith(`.${extra}`));
}

/**
 * True for an eVenue event URL, e.g.
 * https://pennathletics.evenue.net/event/SE26/JAB1
 *
 * Both the host and the /event/<seasonCd>/<itemCd> path have to match: an
 * eVenue URL that is not an event page cannot be scraped, so accepting it would
 * only register a row that never resolves.
 */
export function isEvenueUrl(url: string): boolean {
  return parseEvenueUrl(url) !== null;
}

export function parseEvenueUrl(
  url: string
): { host: string; seasonCd: string; itemCd: string } | null {
  try {
    const parsed = new URL(url);
    if (!hostIsEvenue(parsed.hostname)) return null;
    const m = parsed.pathname.match(/\/event\/([^/]+)\/([^/?#]+)/);
    if (!m) return null;
    return { host: parsed.origin, seasonCd: m[1], itemCd: m[2] };
  } catch {
    return null;
  }
}

/**
 * The event's stable ID, derived from its URL alone — the same
 * `seasonCd_itemCd` the scraper assigns, so the portal can show and search for
 * an event before it has ever been scraped.
 */
export function deriveEvenueEventId(url: string): string | null {
  const parsed = parseEvenueUrl(url);
  return parsed ? `${parsed.seasonCd}_${parsed.itemCd}` : null;
}

/** True for a Ticketmaster event URL — the portal's original rule, unchanged. */
export function isTicketmasterUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      /ticketmaster\.(com|ca|co\.uk)$/i.test(parsed.hostname) &&
      parsed.pathname.includes('/event/')
    );
  } catch {
    return false;
  }
}

/** True for a tickets.com event URL (resale marketplace). */
export function isTicketsComUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      /tickets\.com$/i.test(parsed.hostname) &&
      (parsed.pathname.includes('/events/') || parsed.pathname.includes('/tickets/'))
    );
  } catch {
    return false;
  }
}

/** Which scraper owns this URL, or null if neither does. */
export function sourceForUrl(url: string): 'evenue' | 'ticketmaster' | 'ticketscom' | null {
  if (isEvenueUrl(url)) return EVENUE_SOURCE;
  if (isTicketmasterUrl(url)) return TICKETMASTER_SOURCE;
  if (isTicketsComUrl(url)) return 'ticketscom';
  return null;
}

/** True for an event document owned by the eVenue scraper. */
export function isEvenueEvent(event: { Source?: string; URL?: string } | null): boolean {
  if (!event) return false;
  if (event.Source === EVENUE_SOURCE) return true;
  return Boolean(event.URL && isEvenueUrl(event.URL));
}
