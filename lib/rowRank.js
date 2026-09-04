/**
 * ── Reading a row's position off its label ───────────────────────────────────
 *
 * The scraper ranks a row from its label alone (helpers/seatBatch.js in the
 * scraper repo) and stores the rank on the listing. A rank is only meaningful
 * next to the label shape it was read from, because the shapes are separate
 * scales that all start at 1:
 *
 *   numeric   "1".."10000"     rank is the number.  Row 1 is the best seat.
 *   letter    "A".."Z"         A is 1, Z is 26.
 *   letter2   "AA".."ZZ"       AA is 1, AB is 2, BA is 27, ZZ is 676.
 *   letter3   "AAA".."ZZZ"     AAA is 1, ABA is 27, ZZZ is 17,576.
 *
 * Row 1, row A, row AA and row AAA are all rank 1 and none of them is the same
 * seat, so anything ordering rows has to keep the shapes apart. That is what
 * this module is for: the kind travels with the rank everywhere rows are
 * compared, in the dominated-listings filter and in the underpriced buy-list.
 *
 * Which shape sits in front of which is a venue's own business — some run
 * A..Z then AA..ZZ behind it, others put AA in front of A — so the shapes are
 * never merged into one order, only kept apart.
 *
 * Plain JavaScript rather than TypeScript so the .mjs tests and the JS watcher
 * can import it as directly as the TS filter does.
 */

/**
 * A multi-letter row is a REPEATED letter — AA, BB, ZZ, AAA, YYY — and nothing
 * else. This replaced a denylist of codes (GA, WC, ADA, ...) which only caught
 * the ones somebody had already seen: read off 1,090,781 production listings,
 * every two- and three-letter row is a doubled or tripled letter, and every
 * mixed-letter label of that width is a seat-type code — WC, MW, VW, LR, RL,
 * RW, ADA, SRO, TBL, WCA, JJW, RAL, BAR, CRT, EDG, ONE, TWO. Not one AB or BA
 * appears in either export.
 *
 * Twelve of those codes were not on the list and so were ranked as positions,
 * which is how CRT (courtside, ranked row 1,814) came to be dropped as
 * "dominated" by row AAA in Atlanta Hawks v Lakers section FLOOR8.
 *
 * Mirrors rowSortKey in the scraper's helpers/seatBatch.js — a label ranked
 * there and refused here (or the reverse) would put a listing in a universe of
 * its own, so the two move together.
 */
const MULTI_LETTER_ROW = /^([A-Z])\1{0,2}$/;

/**
 * Which scale a row label is on, or null when it is on none.
 *
 * Null covers 12A, C35, AAAA and longer, blank labels, lawn and parking, and
 * every mixed-letter two- or three-letter label (WC, ADA, CRT, ONE).
 * The scraper leaves those unranked, and a listing carrying one is kept without
 * being judged rather than placed by guesswork.
 *
 * @param {unknown} label
 * @returns {'numeric' | 'letter' | 'letter2' | 'letter3' | null}
 */
export function rowRankKind(label) {
  if (typeof label !== 'string') return null;
  const name = label.trim();

  if (/^\d+$/.test(name)) {
    const value = Number(name);
    return value >= 1 && value <= 10000 ? 'numeric' : null;
  }

  const upper = name.toUpperCase();
  if (!MULTI_LETTER_ROW.test(upper)) return null;

  return upper.length === 1 ? 'letter' : upper.length === 2 ? 'letter2' : 'letter3';
}

/**
 * The rank the scraper would read off this label, or null when it reads none.
 *
 * Kept next to the kind so a caller holding only a label — a test, a backfill,
 * a listing whose stored rank predates the current rule — can recover both from
 * the same source rather than a second copy of the arithmetic.
 *
 * @param {unknown} label
 * @returns {number | null}
 */
export function rowRankFromLabel(label) {
  const kind = rowRankKind(label);
  if (kind === null) return null;

  const name = String(label).trim();
  if (kind === 'numeric') return Number(name);

  // Base 26 over the letters, then +1 so every width counts from 1.
  let rank = 0;
  for (const ch of name.toUpperCase()) rank = rank * 26 + (ch.charCodeAt(0) - 65);
  return rank + 1;
}
