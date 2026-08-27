/**
 * Exported inventory row → StubHub create/update payloads.
 *
 * Pure and total: no I/O, no database, no clock, no throwing. That is deliberate —
 * it means the mapper can be run across the entire live book offline
 * (scripts/stubhub-dry-map.mjs) and told exactly what it cannot represent, before
 * anything is ever sent.
 *
 * ── Where the price comes from, and why it isn't inventory.listPrice ────────────
 *
 * Markup is applied twice, in two processes:
 *
 *   stage 1  scraper, persisted:  listPrice = cost < 35 ? cost + 15
 *                                                       : cost × (1 + pct/100)
 *   stage 2  portal, at export:   list_price = listPrice × (1 + (pct+adj)/100)
 *                                                        / (1 + pct/100)
 *
 * Stage 2 divides stage 1 back out and re-applies pct + adj, where adj is the
 * event's standard / resale / broker adjustment. It is computed during CSV
 * generation and never stored.
 *
 * Those adjustments are live: 201 of 363 active events carry a non-zero broker
 * adjustment, 6 carry a standard one, and priceIncreasePercentage takes six
 * different values across the book. A mapper reading `inventory.listPrice` straight
 * from the document would therefore mis-price the broker rows on more than half the
 * active events — silently, and from the first push. This module takes the
 * already-marked-up row that generateInventoryCsv produces, so there is exactly one
 * implementation of the markup chain and the two paths cannot drift.
 */

import type {
  ApiMarketplace,
  InventoryCreateRequest,
  InventoryUpdateRequest,
  ListingNoteRequest,
  TagRequest,
} from './types.ts';
import { resolveEventId, type SkipReason } from './eventResolver.ts';
import { resolveSplitType } from './splitType.ts';
import { resolveDeliveryType } from './deliveryType.ts';
import { ASK_PRICE_FIELD } from './price.ts';

/**
 * Structurally identical to CsvRow in actions/csvActions.tsx. Declared here rather
 * than imported so this module stays free of the server-action module graph and can
 * be exercised by plain Node in tests and scripts.
 */
export interface InventoryRowInput {
  inventory_id: number;
  event_id: string;
  event_name?: string;
  venue_name?: string;
  event_date?: string;
  quantity: number;
  section: string;
  row: string;
  seats?: string;
  public_notes?: string;
  internal_notes?: string;
  tags?: string;
  list_price: number;
  face_price?: number;
  taxed_cost?: number;
  cost: number;
  hide_seats?: 'Y' | 'N';
  in_hand_date?: string;
  split_type?: string;
  custom_split?: string;
  stock_type?: string;
  zone?: 'Y' | 'N';
  shown_quantity?: number;
}

export interface MapOptions {
  /**
   * Which channels to price and broadcast to. ReachPro is a value in this list,
   * not a separate integration — the spec mentions it exactly once, as a member of
   * ApiMarketplace. Add it here once StubHub confirms entitlement (question R2).
   */
  marketplaces?: ApiMarketplace[];
  /**
   * Which field carries our marked-up ask. Defaults to listPrice; see price.ts
   * for the evidence that this is correct and for comparePriceEcho, which proves
   * it against a real listing on the first sandbox write rather than leaving it
   * as an assumption.
   */
  priceField?: 'listPrice' | 'allInPrice';
  currencyCode?: string;
  /**
   * Whether this account may set hideSeats at CREATE time.
   *
   * The create-time field is gated behind ExtApiInvCreateFeatures, and sending it
   * without that feature fails the whole create with "hideSeats is not enabled
   * for this account" — which through the bulk endpoint surfaces only as "An
   * internal error occurred while processing this item".
   *
   * This only affects the create. The update carries hideSeats unconditionally,
   * because PATCH is not gated: verified on the sandbox, PATCH hideSeats:true
   * moves hideSeatsFromMarketplace to true on an account where the identical
   * field is refused at create. Since every create is followed by a price PATCH
   * anyway, seats end up hidden either way and this flag only decides whether
   * they are hidden a few seconds earlier.
   *
   * Enable with STUBHUB_HIDE_SEATS=true once StubHub turns the feature on.
   */
  hideSeatsSupported?: boolean;
}

const DEFAULTS: Required<MapOptions> = {
  marketplaces: ['StubHub'],
  priceField: ASK_PRICE_FIELD,
  currencyCode: 'USD',
  hideSeatsSupported: process.env.STUBHUB_HIDE_SEATS === 'true',
};

export interface MappedRow {
  ok: true;
  externalId: string;
  eventId: number;
  create: InventoryCreateRequest;
  /** Also the create's follow-up: create carries no price, so this always runs. */
  update: InventoryUpdateRequest;
  /** Non-fatal representation losses, for the coverage report. */
  warnings: string[];
}

export interface SkippedRow {
  ok: false;
  externalId: string;
  reason: SkipReason;
  detail: string;
}

/** Synthetic row labels the scrapers mint for general admission — never a real row. */
const SYNTHETIC_GA_ROW = /^GA\d+$/i;

/**
 * Tag key under which the exporter's categories (STANDARD, RESALE, RESALE BROKER,
 * GA_*) are stored. Stable because it is a search key, not a display label.
 */
export const TAG_KEY = 'ptsCategory';

export function mapRow(row: InventoryRowInput, options: MapOptions = {}): MappedRow | SkippedRow {
  const opts = { ...DEFAULTS, ...options };
  const externalId = String(row.inventory_id);

  const event = resolveEventId(row.event_id);
  if (!event.ok) {
    return { ok: false, externalId, reason: event.reason, detail: event.detail };
  }

  const warnings: string[] = [];

  const split = resolveSplitType(row.quantity, row.split_type, row.custom_split);
  if (!split.exact && split.lost) warnings.push(`split: ${split.lost}`);

  const delivery = resolveDeliveryType(row.stock_type);
  if (!delivery.exact && delivery.lost) warnings.push(`delivery: ${delivery.lost}`);

  // GA and lawn inventory carries a synthetic row label (GA1, GA2…) that must not
  // reach a buyer. The exporter already blanks the seat numbers for these; we blank
  // the row and let zoneFill describe the listing instead.
  const isZone = row.zone === 'Y' || SYNTHETIC_GA_ROW.test(row.row || '');
  const seatingRow = isZone ? null : (row.row || null);

  // taxed_cost has no home in the API. unitCost/faceValueCost/taxPaid all exist but
  // none is the same quantity, and guessing would corrupt reporting. Kept local.
  if (row.taxed_cost != null && row.taxed_cost !== row.cost) {
    warnings.push(`taxed_cost ${row.taxed_cost} has no API field (cost ${row.cost})`);
  }

  // Seat numbers cannot be set on create — seating takes section and row only.
  if (row.seats && !isZone) {
    warnings.push('seat numbers not settable at create (seating takes section + row)');
  }

  const listingNotes: ListingNoteRequest[] = row.public_notes?.trim()
    ? [{ note: row.public_notes.trim() }]
    : [];

  // One tag key carrying the row's categories as values, rather than one tag per
  // label. Two reasons: the API rejects a tag with no `values` (the spec marks
  // nothing required, but the server returns
  // "Tags[0].Values: The Values field is required"), and a single stable key is
  // what makes the rows findable — GET /inventory/search filters on tagKey plus
  // tagValue, so `ptsCategory=RESALE BROKER` is a query while a bare tag name is
  // only a label.
  const tagValues = (row.tags || '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);
  // valueDataType is likewise required in practice — the server answers
  // "Tags[0].ValueDataType: Please provide a valid data type" without it. Our
  // categories are plain labels, so String.
  const tags: TagRequest[] = tagValues.length
    ? [{ name: TAG_KEY, values: tagValues, valueDataType: 'String' }]
    : [];

  const inHandAt = normaliseInHandDate(row.in_hand_date);
  if (row.in_hand_date && !inHandAt) {
    warnings.push(`unparseable in_hand_date ${JSON.stringify(row.in_hand_date)} — omitted`);
  }

  const create: InventoryCreateRequest = {
    currencyCode: opts.currencyCode,
    externalId,
    event: { id: event.eventId },
    ticketCount: row.quantity,
    unitCost: round2(row.cost),
    faceValueCost: row.face_price != null ? round2(row.face_price) : null,
    deliveryType: delivery.deliveryType,
    splitType: split.splitType,
    seating: { section: row.section || null, row: seatingRow },
    // Omitted unless the account has the create-time feature. The update below
    // sets it regardless, so nothing is lost by leaving it out here.
    ...(opts.hideSeatsSupported ? { hideSeats: row.hide_seats === 'Y' } : {}),
    zoneFill: isZone,
    inHandAt,
    listingNotes: listingNotes.length ? listingNotes : null,
    tags: tags.length ? tags : null,
    maxDisplayQuantity: row.shown_quantity && row.shown_quantity > 0 ? row.shown_quantity : null,
    // Never live before it has a price. The price arrives in `update`, below.
    autoBroadcast: false,
    // internal_notes is deliberately NOT forwarded: "-tnow -tmplus -geek" are
    // Automatiq channel-routing tokens, not notes. Their function is replaced by
    // broadcastStatuses, and passing them through would leak vendor syntax into
    // StubHub's internal notes field.
  };

  const price = round2(row.list_price);
  const update: InventoryUpdateRequest = {
    prices: opts.marketplaces.map(marketplace => ({
      marketplace,
      [opts.priceField]: price,
    })),
    broadcastStatuses: opts.marketplaces.map(marketplace => ({
      marketplace,
      posBroadcastState: 'List' as const,
    })),
    splitType: split.splitType,
    deliveryType: delivery.deliveryType,
    inHandAt,
    // Always sent here, gated nowhere. This is the path that actually hides seats
    // on an account without ExtApiInvCreateFeatures — and hide_seats is Y on
    // effectively every row we export, so it matters.
    hideSeats: row.hide_seats === 'Y',
    maxDisplayQuantity: create.maxDisplayQuantity,
    listingNotes: create.listingNotes,
    tags: create.tags,
    // Cost travels with the update, not only the create. Omitting it meant a
    // cost change produced a different hash, sent an update, and changed
    // nothing on StubHub — invisible, because verification compares price.
    //
    // ticketCount is deliberately absent: the update schema's `quantity` is for
    // placeholder listings only and needs a feature we do not have, so a
    // quantity change has to be a delete and recreate. See InventoryUpdateRequest.
    unitCost: create.unitCost,
    faceValueCost: create.faceValueCost,
  };

  return { ok: true, externalId, eventId: event.eventId, create, update, warnings };
}

/**
 * The exporter emits in_hand_date as YYYY-MM-DD, already clamped to the event date
 * in the venue's timezone when the event is today or past. The API wants a
 * date-time, so widen to midnight UTC rather than re-deriving anything — the
 * timezone work has already happened upstream and must not be repeated here.
 */
function normaliseInHandDate(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T00:00:00`;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 19);
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}
