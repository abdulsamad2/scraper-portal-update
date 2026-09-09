/**
 * ── Which product a listing is ───────────────────────────────────────────────
 *
 * The scraper tags every listing with what it is: our own standard inventory,
 * or resale — and resale split again into fan (a seat one buyer is passing on)
 * and broker (a professional reseller). The three carry different markups, sell
 * to different buyers and are priced against each other by nobody, so anything
 * that decides one listing beats another has to keep them apart.
 *
 * Read from the fields the scraper writes:
 *
 *   standard   splitType NEVERLEAVEONE, tagged STANDARD (or GA_STANDARD)
 *   fan        tagged "resale fan ..."
 *   broker     tagged "resale broker"
 *   resale     resale the classifier could not place — its own product, and
 *              never merged with fan or broker on a guess
 *
 * Substring matching rather than an exact list: the tag is built by the scraper
 * as "resale " + whatever the classifier returned ("fan inventory", "broker"),
 * uppercased again on the way into the CSV, and both spellings must land in the
 * same product.
 */

/**
 * @typedef {'standard' | 'fan' | 'broker' | 'resale'} TicketType
 */

/**
 * The product a listing belongs to.
 *
 * @param {{ tags?: unknown, splitType?: unknown }} listing
 * @returns {TicketType}
 */
export function ticketTypeOf(listing) {
  const tags = typeof listing?.tags === 'string' ? listing.tags.toUpperCase() : '';
  if (tags.includes('BROKER')) return 'broker';
  if (tags.includes('FAN')) return 'fan';
  if (listing?.splitType === 'NEVERLEAVEONE' || tags.includes('STANDARD')) return 'standard';
  return 'resale';
}
