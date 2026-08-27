/**
 * Which price field carries our ask, and how the system proves it on first contact.
 *
 * ── The question ───────────────────────────────────────────────────────────────
 *
 * Our exporter's `list_price` column is the final marked-up ask, after both stages
 * of the markup chain. StubHub's price object happens to contain a field with
 * nearly the same name, and the two are not obviously the same thing. Sending a
 * net-proceeds figure where an ask is expected (or the reverse) would mis-price
 * the entire book on day one, silently and uniformly, so it is worth being sure.
 *
 * ── The evidence ───────────────────────────────────────────────────────────────
 *
 * 1. The spec defines the pair as base and derived, not as ask and net:
 *      listPrice   "ListPrice is unit price"
 *      allInPrice  "AllInPrice is the broadcasted price with taxes / fees"
 *
 * 2. `marketplaceMarkup` sits alongside them and is documented as the thing that
 *    derives one from the other: "If not set or False, price update will use
 *    AllInPrice, or ListPrice, or derived prices from MarketplaceMarkup."
 *
 * 3. Net proceeds exists in the API, but only in the sales domain — TotalNetProceeds
 *    on an invoice, PATCH /invoices/{id}/netproceeds. It is never a listing input.
 *    Searching all 311 schemas, no listing-side field refers to proceeds at all.
 *
 * 4. Live sandbox listing 1146693166 echoes allInPrice 120.0, listPrice 120.0,
 *    marketplaceMarkup null — equal precisely because no markup is configured,
 *    which is what "derived" predicts.
 *
 * Conclusion: listPrice is the seller-set unit price and allInPrice is what the
 * buyer is shown once fees are added. Our marked-up ask goes in listPrice.
 *
 * (Related: the June design note recorded a "sandbox inflates prices ~10%" risk.
 * That does not reproduce — the sandbox echoes back exactly what was set.)
 *
 * ── The workaround for the residue of doubt ─────────────────────────────────────
 *
 * The reasoning above is strong but it is still inference from documentation, and
 * the cost of being wrong is the whole book. So rather than carry it as an open
 * question, the system checks itself the first time it writes anything:
 * `comparePriceEcho` reads a listing back after a write and asserts StubHub kept
 * the number we sent. Wire it into the sandbox lifecycle test and a wrong
 * assumption fails loudly on listing one, instead of quietly on all of them.
 *
 * It also records the allInPrice delta, which is the buyer-fee percentage measured
 * rather than assumed — useful on its own for pricing decisions.
 */

import type { ApiMarketplace, ListingResource } from './types.ts';

/**
 * Where our marked-up ask goes. Evidence above; still a named constant rather than
 * a literal so that if StubHub ever contradicts it, this is the one line to change
 * and `comparePriceEcho` is the thing that tells you to change it.
 */
export const ASK_PRICE_FIELD: 'listPrice' | 'allInPrice' = 'listPrice';

/** Cent-level tolerance. Prices are rounded to 2dp before sending. */
const EPSILON = 0.005;

export interface PriceEcho {
  marketplace: ApiMarketplace;
  /** What we sent in prices[].listPrice. */
  sent: number;
  /** What StubHub reports back for that marketplace, or null if absent. */
  echoedListPrice: number | null;
  /** The broadcast price including fees, when reported. */
  echoedAllInPrice: number | null;
  /** True when the echo matches what we sent, to the cent. */
  match: boolean;
  /**
   * (allInPrice - listPrice) / listPrice, when both are present. The buyer-fee
   * load, measured. Null when it can't be computed.
   */
  feeRatio: number | null;
  /** Human-readable summary for logs and the lifecycle test. */
  detail: string;
}

/**
 * Compare a price we sent against the listing StubHub echoes back.
 *
 * Deliberately returns a result rather than throwing: the caller decides whether a
 * mismatch is fatal (sandbox lifecycle test — yes) or a warning to record and move
 * on (steady-state audit — yes, because a marketplace-side markup could legitimately
 * change allInPrice without touching our listPrice).
 */
export function comparePriceEcho(
  sent: number,
  listing: ListingResource,
  marketplace: ApiMarketplace = 'StubHub',
): PriceEcho {
  const entry = (listing.listingPricesByMarketplace ?? [])
    .find(p => p.marketplaceName === marketplace);

  const echoedListPrice = entry?.listPrice ?? null;
  const echoedAllInPrice = entry?.allInPrice ?? null;

  const match = echoedListPrice != null && Math.abs(echoedListPrice - sent) < EPSILON;

  const feeRatio =
    echoedListPrice != null && echoedAllInPrice != null && echoedListPrice !== 0
      ? (echoedAllInPrice - echoedListPrice) / echoedListPrice
      : null;

  let detail: string;
  if (entry == null) {
    detail = `no ${marketplace} price echoed back for listing ${listing.id}`;
  } else if (!match) {
    detail =
      `listing ${listing.id}: sent ${ASK_PRICE_FIELD} ${sent}, ` +
      `StubHub reports listPrice ${echoedListPrice} / allInPrice ${echoedAllInPrice}. ` +
      `If the echo is consistently our ask plus a markup, our number is being read ` +
      `as a base rather than the ask — revisit ASK_PRICE_FIELD before going wider.`;
  } else {
    const fee = feeRatio == null ? 'unknown' : `${(feeRatio * 100).toFixed(2)}%`;
    detail = `listing ${listing.id}: price held at ${sent}; buyer-fee load ${fee}`;
  }

  return { marketplace, sent, echoedListPrice, echoedAllInPrice, match, feeRatio, detail };
}
