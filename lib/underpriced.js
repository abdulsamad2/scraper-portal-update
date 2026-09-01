/**
 * ── Underpriced listings ─────────────────────────────────────────────────────
 *
 * A buying signal, not a housekeeping one: a listing priced far below what the
 * seats around it are going for is one you may want to buy before someone else
 * does.
 *
 * "Around it" means seats no better than it: the same section, at the same row
 * or further from the field. Comparing against the whole section would flag
 * every back row for the crime of being cheap, which is exactly what a back row
 * should be. Rows are ordered by the rowRank the scraper reads off the map
 * geometry, so this needs no row-label parsing.
 *
 * Distinct from the watcher's undercut alert, which fires only for resale, only
 * on a listing's first appearance, and only against the section MINIMUM.
 *
 * Kept free of any database or watcher state so the same rule can be applied to
 * whatever set of listings the caller has: the inventory watcher's in-memory
 * snapshot, or a set read straight from MongoDB.
 */

/** The bucket a listing competes in: one section of one event. */
export const sectionKey = (eventId, section) =>
  `${eventId}|${String(section ?? '').trim().toUpperCase()}`;

export const UNDERPRICED_PCT = Number(process.env.UNDERPRICED_PCT ?? 0.35);

// Below this many comparable listings an "average" is just noise.
export const UNDERPRICED_MIN_COMPARABLES = Number(process.env.UNDERPRICED_MIN_COMPARABLES ?? 3);

// Keeps a buy-list bounded; highest % below average wins.
export const MAX_UNDERPRICED = 60;

/**
 * One absurdly priced listing distorts everything in front of it: lift a
 * section's average with a single $9,000 row and every ordinary listing behind
 * it starts looking like a bargain. Comparables above this multiple of the
 * section's MEDIAN price are left out of the averages.
 *
 * The median is the reference rather than the mean precisely because the mean
 * is what the outlier is corrupting. Only the high side is trimmed: a genuinely
 * cheap listing pulls averages down, which suppresses alerts rather than
 * inventing them, and it is the bargain being looked for in the first place.
 *
 * An excluded listing is still evaluated on its own account -- it just stops
 * setting the baseline for its neighbours.
 */
export const UNDERPRICED_OUTLIER_MULTIPLE = Number(process.env.UNDERPRICED_OUTLIER_MULTIPLE ?? 3);

/** Middle value of a list of prices. Left untouched by however wild the extremes are. */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Every live listing in the given sections that is priced far below the seats
 * it competes with.
 *
 * Whole sections are re-examined rather than only the rows that changed: a
 * listing turns into a bargain the moment its neighbours reprice, and its own
 * document never moved, so a diff of changed rows would never surface it. Only
 * sections touched this cycle are scanned, which keeps that affordable.
 *
 * Comparables for a row are every row at the same rank or further from the
 * field — seats a buyer would consider no better. A row with too few of those
 * is skipped rather than judged against an average of one or two listings.
 *
 * Exported so it can be run directly against a snapshot built from live
 * inventory, without starting a watch cycle.
 */
export function findUnderpricedRows(state, dirtySectionKeys) {
  const bySection = new Map();
  for (const [key, v] of state.snapshot) {
    if (v.rowRank == null || !(v.price > 0)) continue;
    const k = sectionKey(v.eventId, v.section);
    if (!dirtySectionKeys.has(k)) continue;
    const entry = { ...v, key };
    const rows = bySection.get(k);
    if (rows) rows.push(entry);
    else bySection.set(k, [entry]);
  }

  const found = [];
  for (const rows of bySection.values()) {
    if (rows.length <= UNDERPRICED_MIN_COMPARABLES) continue;
    rows.sort((a, b) => a.rowRank - b.rowRank);
    const n = rows.length;

    // Anything far above the section's median is a distortion, not a
    // comparable, and is kept out of every average below.
    const outlierCap = median(rows.map(r => r.price)) * UNDERPRICED_OUTLIER_MULTIPLE;
    const counts = rows.map(r => (r.price > outlierCap ? 0 : 1));

    // Suffix sums over rank order: the comparables for row i are everything
    // from the first row sharing its rank through the back of the section.
    const sumFrom = new Array(n + 1).fill(0);
    const countFrom = new Array(n + 1).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      sumFrom[i] = sumFrom[i + 1] + (counts[i] ? rows[i].price : 0);
      countFrom[i] = countFrom[i + 1] + counts[i];
    }

    for (let i = 0; i < n; i++) {
      let start = i;
      while (start > 0 && rows[start - 1].rowRank === rows[i].rowRank) start--;
      // The row being judged is never its own comparable.
      const comparables = countFrom[start] - counts[i];
      if (comparables < UNDERPRICED_MIN_COMPARABLES) continue;
      const avg = (sumFrom[start] - (counts[i] ? rows[i].price : 0)) / comparables;
      if (!(avg > 0)) continue;
      if (rows[i].price > avg * (1 - UNDERPRICED_PCT)) continue;
      found.push({
        ...rows[i],
        comparableAvg: avg,
        comparableCount: comparables,
        pctBelow: ((avg - rows[i].price) / avg) * 100,
      });
    }
  }

  // Best bargains first, and bounded — this is a buy-list, not an audit log.
  found.sort((a, b) => b.pctBelow - a.pctBelow);
  return found.slice(0, MAX_UNDERPRICED);
}

