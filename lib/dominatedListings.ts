/**
 * ── The dominated-listings rule ───────────────────────────────────────────────
 *
 * Within one product — same event, section, quantity and split — a listing is
 * *dominated* when a seat closer to the field is already on sale at or below
 * its per-seat price. No buyer would ever pick it: they would be paying more
 * for a worse seat while the better one sits right there. It is dead weight in
 * the export, so it is dropped.
 *
 * Rows are ordered by `rowRank`, the position the scraper reads out of
 * Ticketmaster's own row ordering, so the rule never parses a row label and
 * behaves the same for 1/2/3, A/B/C and AA/A/B seating alike.
 *
 * Worked example — section 107, qty 2, split "2":
 *
 *     Row 1 (rank 0) · $700   keep — nothing above it
 *     Row 3 (rank 2) · $650   keep — the only seat above it costs $700, more
 *     Row 3 (rank 2) · $780   drop — Row 1 is better AND $80/seat cheaper
 *
 * The rule stays quiet whenever price follows the physical order, which is the
 * normal case: Row 1 $900 / Row 3 $650 / Row 15 $500 keeps all three. It fires
 * only where a worse row is asking more than a better one.
 *
 * Kept in lib/ rather than in the CSV action because both the exporter and the
 * portal's preview must apply the identical rule, and because a 'use server'
 * module may only export async functions.
 */

/**
 * ── Two switches, one answer ──────────────────────────────────────────────────
 *
 * The rule is controlled globally, for every event at once, and per event on
 * top of that. An event's `mode` says how it treats the global switch:
 *
 *   inherit  follow the global switch (the default — one toggle moves everything)
 *   on       always apply, even while the global switch is off (pilot one event)
 *   off      never apply, even while the global switch is on (exempt one event)
 */
export type DominatedMode = 'inherit' | 'on' | 'off';

export interface DominatedEventOverride {
  mode?: DominatedMode | null;
  /** Legacy shape, before `mode` existed: a plain per-event on switch. */
  enabled?: boolean | null;
}

/** How an event treats the global switch. Anything unrecognised follows global. */
export function resolveDominatedMode(override: DominatedEventOverride | null | undefined): DominatedMode {
  const mode = override?.mode;
  if (mode === 'on' || mode === 'off' || mode === 'inherit') return mode;
  // Rules written before `mode` existed carried a plain boolean. Honour a true
  // there rather than silently reverting that event to following the global.
  if (override?.enabled === true) return 'on';
  return 'inherit';
}

/**
 * Whether the rule applies to one event. This is the single place the two
 * switches are combined, so the exporter and the portal's preview can never
 * disagree about what an event will do.
 */
export function resolveDominatedEnabled(
  globalEnabled: boolean,
  override?: DominatedEventOverride | null,
): boolean {
  const mode = resolveDominatedMode(override);
  if (mode === 'off') return false;
  if (mode === 'on') return true;
  return globalEnabled === true;
}

/** How one listing enters the rule. Return null from `describe` to pass it through untouched. */
export interface DominatedCandidate {
  /** Listings only ever compete inside one bucket: same event, section, quantity and split. */
  bucketKey: string;
  /** 0 is the row closest to the field. Null (no row ordering — GA, parking) passes through. */
  rowRank: number | null | undefined;
  /** Per-seat price, the only price a buyer compares across two listings of the same size. */
  perSeatPrice: number;
}

interface Entry<T> {
  item: T;
  rank: number;
  price: number;
}

interface Bucket<T> {
  entries: Entry<T>[];
}

/**
 * Split listings into the ones worth exporting and the ones a better seat has
 * already beaten on price.
 *
 * Each bucket is sorted by rowRank ascending, then per-seat price ascending,
 * and walked front to back. A listing survives only when nothing already kept
 * matches or beats its price — so a bucket's survivors are exactly its strictly
 * falling prices as the seats get worse.
 *
 * Anything `describe` returns null for, and anything with no rowRank, is kept
 * without being judged: there is no row ordering to judge it against.
 */
export function partitionDominated<T>(
  items: T[],
  describe: (item: T) => DominatedCandidate | null,
): { kept: T[]; dropped: T[] } {
  const buckets = new Map<string, Bucket<T>>();
  const kept: T[] = [];
  const dropped: T[] = [];

  for (const item of items) {
    const candidate = describe(item);
    if (!candidate || candidate.rowRank == null) {
      kept.push(item);
      continue;
    }
    const entry: Entry<T> = {
      item,
      rank: candidate.rowRank,
      price: candidate.perSeatPrice,
    };
    const bucket = buckets.get(candidate.bucketKey);
    if (bucket) bucket.entries.push(entry);
    else buckets.set(candidate.bucketKey, { entries: [entry] });
  }

  for (const bucket of buckets.values()) {
    bucket.entries.sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.price - b.price));

    // The walk needs only the cheapest survivor, not the whole list: a listing
    // is dominated exactly when the cheapest kept so far is at or below it.
    let cheapestSurvivor = Infinity;

    for (const entry of bucket.entries) {
      if (cheapestSurvivor > entry.price) {
        kept.push(entry.item);
        cheapestSurvivor = entry.price;
        continue;
      }
      dropped.push(entry.item);
    }
  }

  return { kept, dropped };
}

/** The bucket a listing competes in: same event, section, quantity and split. */
export function dominatedBucketKey(
  eventId: string,
  section: string,
  quantity: number,
  split: string | undefined,
): string {
  return `${eventId}|${section}|${quantity}|${split || ''}`;
}

/**
 * ── Holding rows back while an event is still being read ──────────────────────
 *
 * The streaming export yields per chunk, but a listing cannot be judged until
 * every better seat in its section has been read, and those can sit in a later
 * chunk. Holding the whole export back until the last chunk would starve the
 * stream of bytes — the exact timeout the streamer exists to avoid, and with
 * the global switch on that would be every export.
 *
 * So rows are held per event, and the caller walks its ids ordered by event.
 * After each chunk, every held event except the one straddling the chunk's tail
 * has been read in full and can be released immediately, so output keeps
 * flowing one event at a time.
 *
 * The caller must supply the boundary from the id ordering it walked, not from
 * the fetched documents: Mongo does not promise to return a chunk in the order
 * its ids were listed.
 */
export class EventRowBuffer<T> {
  private held = new Map<string, T[]>();

  hold(eventId: string, row: T): void {
    const rows = this.held.get(eventId);
    if (rows) rows.push(row);
    else this.held.set(eventId, [row]);
  }

  get size(): number {
    return this.held.size;
  }

  /**
   * Release every event the walk has moved past. `boundaryEventId` is the event
   * of the last id in the chunk just read — the only one that may still have
   * rows coming — and is kept back. Pass undefined to release everything.
   */
  releaseCompleted(boundaryEventId: string | undefined): T[][] {
    const released: T[][] = [];
    for (const [eventId, rows] of this.held) {
      if (eventId === boundaryEventId) continue;
      this.held.delete(eventId);
      released.push(rows);
    }
    return released;
  }

  /** Release whatever is left, once every chunk has been read. */
  releaseAll(): T[][] {
    const released = [...this.held.values()];
    this.held.clear();
    return released;
  }
}
