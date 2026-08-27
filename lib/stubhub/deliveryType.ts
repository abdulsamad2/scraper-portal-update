/**
 * stock_type → ApiDeliveryType.
 *
 * Seven values of ours onto six of theirs. Unlike the split conversion this one
 * has no derivable structure — it's a judgement table, and the mappings below are
 * proposals pending StubHub confirmation (questions F1–F3), not documented truth.
 *
 * What the live book actually contains today (1,965 rows across both inventory
 * collections): MOBILE_TRANSFER 1,955 and MOBILE_SCREENCAP 10. The other five
 * values are declared in the exporter's type but unused right now, so only the
 * first two rows of this table are load-bearing at cutover — and both of those
 * are the ones we're most confident about.
 *
 * Two related fields exist in the CSV and deliberately do NOT feed this:
 *   - `instant_transfer` is currently derived from a scraper field that is false
 *     on every row.
 *   - `files_available` is hardcoded "N" by the exporter.
 * If either becomes meaningful they belong here, not in a second code path.
 */

import type { ApiDeliveryType } from './types.ts';

const TABLE: Record<string, ApiDeliveryType> = {
  // Ticket is transferred through the primary's app. The dominant case.
  MOBILE_TRANSFER: 'InApp',
  // A screenshot of a mobile ticket — not a real transfer, no clean equivalent.
  MOBILE_SCREENCAP: 'Custom',
  // Broker shorthand for a delivered e-ticket file.
  ELECTRONIC: 'PDF',
  // Physical stock.
  HARD: 'Paper',
  // Flash/AXS-style entry, closest to a wallet credential.
  FLASH: 'Wallet',
  // Entry bound to a card or membership rather than a ticket.
  PAPERLESS: 'MemberCard',
  PAPERLESS_CARD: 'MemberCard',
};

/**
 * Chosen because it matches the scrapers' own default: every writer falls back to
 * MOBILE_TRANSFER when the source doesn't say, so an unknown value is far more
 * likely to be a transfer than anything else.
 */
const FALLBACK: ApiDeliveryType = 'InApp';

export interface DeliveryResolution {
  deliveryType: ApiDeliveryType;
  /** False when we fell through to the default rather than matching the table. */
  exact: boolean;
  lost?: string;
}

export function resolveDeliveryType(stockType: string | undefined | null): DeliveryResolution {
  const key = (stockType || '').trim().toUpperCase();
  if (key && key in TABLE) return { deliveryType: TABLE[key], exact: true };
  return {
    deliveryType: FALLBACK,
    exact: false,
    lost: `unmapped stock_type ${JSON.stringify(stockType ?? null)} → ${FALLBACK}`,
  };
}

export const __internal = { TABLE, FALLBACK };
