/**
 * StubHub Point of Sale API — request/response shapes.
 *
 * Transcribed from https://pointofsaleapi.stubhub.net/swagger/v1/swagger.json
 * (OpenAPI 3.0, 160 operations, 311 schemas). Only the slice we actually send or
 * read is modelled here; the full spec is far larger and most of it is sales,
 * purchase orders and accounting we don't touch.
 *
 * Two spec facts drive most of the design and are worth stating where they'll be
 * read rather than buried in a doc:
 *
 *   1. `InventoryCreateRequest` carries costs but NO list price. Price lives only
 *      in `InventoryUpdateRequest.prices[]`. Every create is therefore two calls,
 *      and a listing exists briefly without an ask — which is why we always create
 *      with autoBroadcast:false and broadcast in the same batch as the price.
 *
 *   2. `bulkProcessingId` is the only client-supplied idempotency handle anywhere
 *      in the API. There is no Idempotency-Key header, no If-Match, no ETag and no
 *      412 response on any of the 160 operations. That makes bulk the only write
 *      path that is safe to retry.
 *
 * Deliberately no TS `enum` anywhere in this module: Node's native type-stripping
 * (which is how the offline scripts and tests run these files) rejects enums.
 * Const objects + union types give the same safety and erase cleanly.
 */

/** ApiMarketplace — 22 values. ReachPro appears here and nowhere else in the spec. */
export const API_MARKETPLACES = [
  'StubHub', 'VividSeats', 'SeatGeek', 'TickPick', 'Ticketmaster', 'Offline',
  'AXS', 'FanXchange', 'Gametime', 'TicketEvolution', 'TicketNetwork', 'Automatiq',
  'Lyte', 'GoTickets', 'B2BSales', 'TicketNetworkMercury', 'Wastage', 'ReachPro',
  'Donation', 'Gigsberg', 'Retail', 'SellBack',
] as const;
export type ApiMarketplace = (typeof API_MARKETPLACES)[number];

/** ApiSplitType — a closed set. See splitType.ts for how our custom_split maps onto it. */
export const API_SPLIT_TYPES = ['Any', 'None', 'AvoidOne', 'AvoidOneAndThree', 'Pairs'] as const;
export type ApiSplitType = (typeof API_SPLIT_TYPES)[number];

/** ApiDeliveryType — six values against the seven stock types we emit. */
export const API_DELIVERY_TYPES = ['InApp', 'PDF', 'Paper', 'MemberCard', 'Wallet', 'Custom'] as const;
export type ApiDeliveryType = (typeof API_DELIVERY_TYPES)[number];

export type ApiPosBroadcastState = 'Delist' | 'List';

export interface EventRequest {
  /** Viagogo event id. int32 — our 9-digit mapping_id fits. */
  id: number;
}

export interface PurchaseSeatingRequest {
  section?: string | null;
  /** Create takes section + row only. Seat numbers are not settable here. */
  row?: string | null;
}

export interface ListingNoteRequest {
  note?: string | null;
  isDelete?: boolean | null;
}

export interface TagRequest {
  name?: string | null;
  /** Stringified JSON values. The serialised array must stay under 2000 chars. */
  values?: string[] | null;
  isDelete?: boolean | null;
}

export interface InventoryBroadcastUpdateRequest {
  marketplace: ApiMarketplace;
  posBroadcastState?: ApiPosBroadcastState;
}

export interface InventoryPriceUpdateRequest {
  /** The buyer-facing price including fees/taxes. */
  allInPrice?: number | null;
  /** Unit price. Which of the two carries our marked-up ask is StubHub question P4. */
  listPrice?: number | null;
  marketplace: ApiMarketplace;
  marketplaceMarkup?: number | null;
  priceByMarketplace?: boolean | null;
}

/** POST /inventory — note the absence of any price field. */
export interface InventoryCreateRequest {
  currencyCode?: string | null;
  unitCost: number;
  faceValueCost?: number | null;
  expectedValue?: number | null;
  taxPaid?: number | null;
  deliveryType?: ApiDeliveryType;
  event?: EventRequest;
  primaryEventId?: string | null;
  inHandAt?: string | null;
  splitType?: ApiSplitType;
  maxDisplayQuantity?: number | null;
  seating?: PurchaseSeatingRequest;
  ticketCount: number;
  listingNotes?: ListingNoteRequest[] | null;
  /** Always false on create — nothing goes live before its price does. */
  autoBroadcast?: boolean | null;
  broadcastStatuses?: InventoryBroadcastUpdateRequest[] | null;
  internalNotes?: string | null;
  /** Our inventory.inventoryId. The join key that survives everything. */
  externalId?: string | null;
  tags?: TagRequest[] | null;
  zoneFill?: boolean | null;
  /** Requires the ExtApiInvCreateFeatures flag; falls back to the account default. */
  hideSeats?: boolean | null;
}

/** PATCH /inventory/{id} — the only place a price can be set. */
export interface InventoryUpdateRequest {
  prices?: InventoryPriceUpdateRequest[] | null;
  broadcastStatuses?: InventoryBroadcastUpdateRequest[] | null;
  splitType?: ApiSplitType;
  deliveryType?: ApiDeliveryType;
  inHandAt?: string | null;
  maxDisplayQuantity?: number | null;
  listingNotes?: ListingNoteRequest[] | null;
  tags?: TagRequest[] | null;
  internalNotes?: string | null;
}

export interface BulkInventoryDeleteRequest {
  inventoryId: number;
}

/** POST /inventory/bulk — creates, updates and deletes under one idempotency key. */
export interface BulkInventoryRequest {
  bulkProcessingId: string;
  createRequests?: InventoryCreateRequest[] | null;
  updateRequests?: (InventoryUpdateRequest & { inventoryId: number })[] | null;
  deleteRequests?: BulkInventoryDeleteRequest[] | null;
}

export interface ErrorResource {
  code?: string | null;
  message?: string | null;
  /** Per-field validation messages. The most useful thing for fixing mappers. */
  errors?: Record<string, string[]> | null;
}

export interface BulkProcessingResult {
  entityId?: number | null;
  externalId?: string | null;
  error?: ErrorResource | null;
}

/** GET /inventory/bulk/{bulkProcessingId} */
export interface BulkProcessingResultSummaryResponse {
  totalCount?: number;
  finished?: boolean;
  successful?: boolean;
  queued?: BulkProcessingResult[] | null;
  completed?: BulkProcessingResult[] | null;
  failed?: BulkProcessingResult[] | null;
  skipped?: BulkProcessingResult[] | null;
}

/** The subset of ListingResource we read. */
export interface ListingResource {
  id: number;
  externalId?: string | null;
  availableQuantity?: number;
  currencyCode?: string | null;
  unitCost?: number | null;
  splitType?: number;
  splitTypeValue?: string | null;
  isBroadcast?: boolean;
  updatedDate?: string | null;
  deletedDate?: string | null;
  listingPricesByMarketplace?: Array<{
    allInPrice?: number | null;
    listPrice?: number | null;
    marketplaceName?: ApiMarketplace;
  }> | null;
  listingStatusByMarketplace?: Array<{
    listingStatus?: string | null;
    marketplaceName?: ApiMarketplace;
    marketplaceListingId?: string | null;
    broadcastErrors?: string[] | null;
  }> | null;
}

/** GET /inventory/export */
export interface InventoryExportResource {
  paginationToken?: number | null;
  numberOfItems?: number | null;
  inventory?: ListingResource[] | null;
  deletedInventoryIds?: number[] | null;
}
