/**
 * custom_split → ApiSplitType, by set expansion.
 *
 * Our exporter emits `split_type: CUSTOM` plus an explicit list of sellable
 * quantities — "2", "2,4", "1,2,3,4,5,6,8". StubHub has a closed five-value enum
 * and no field that carries an integer list, which looks fatal until you notice
 * that our lists aren't arbitrary: the scrapers *generate* them from rules, and
 * they're the same five rules.
 *
 *   "1,2,3,4,5,6,8" on a quantity of 8 means "every quantity except 7", and 7 is
 *   the only one that would leave a single ticket behind. That is AvoidOne.
 *
 * So the conversion is not string matching — it's expanding each ApiSplitType into
 * the set of quantities it permits at this listing's quantity, and finding the one
 * that equals our list. Measured against a 1,537-row production export, 98.4% of
 * rows match a mode exactly, with no loss of meaning:
 *
 *     None                913   59.4%     Pairs             145    9.4%
 *     AvoidOne            339   22.1%     AvoidOneAndThree   13    0.8%
 *     Any                 103    6.7%     ── lossless      1513   98.4%
 *
 * The 1.6% residue is a single shape — "any quantity except a single" (qty 5 →
 * "2,3,4,5") — which no mode expresses. Those fall back to AvoidOne and are
 * reported, so the exposure is measurable: a buyer could take one ticket out of a
 * group of five.
 *
 * CAVEAT: the four predicates below are our reading of the enum's semantics, not
 * something the spec states — it gives the five names and no definitions. They are
 * consistent with every row we've checked, but StubHub should confirm them
 * (question P1). If a definition turns out to differ, this is the one file to fix
 * and the tests will tell you what moved.
 */

import type { ApiSplitType } from './types.ts';

/**
 * Quantities a buyer may purchase from a group of `quantity` under each mode.
 *
 * "Leaves N behind" means quantity - purchased === N, i.e. the remainder that
 * would be stranded and hard to sell. That is what the Avoid* modes protect.
 */
function permittedQuantities(mode: ApiSplitType, quantity: number): Set<number> {
  const all = Array.from({ length: quantity }, (_, i) => i + 1);
  switch (mode) {
    case 'Any':
      return new Set(all);
    case 'None':
      // All or nothing — the whole group must go together.
      return new Set([quantity]);
    case 'AvoidOne':
      return new Set(all.filter(n => quantity - n !== 1));
    case 'AvoidOneAndThree':
      return new Set(all.filter(n => quantity - n !== 1 && quantity - n !== 3));
    case 'Pairs':
      return new Set(all.filter(n => n % 2 === 0));
  }
}

/**
 * Tie-break order. Several modes collapse to the same permitted set at small
 * quantities — at quantity 2 both None and Pairs permit {2}; at quantity 3 both
 * AvoidOne and AvoidOneAndThree permit {1,3}. Behaviour today is identical
 * whichever we pick, so the tie-break has to be decided on something else.
 *
 * The rule is: prefer the mode that names the SIMPLEST rule matching exactly.
 * A tie means the stricter mode's extra clause is inert at this quantity, and
 * sending the stricter mode anyway would misstate the seller's intent — and would
 * genuinely over-restrict if the listing's quantity later changed. "Don't leave
 * one" is the rule our scrapers actually apply; "don't leave one or three" is a
 * different, stronger rule that merely coincides at quantity 3.
 *
 * All-or-nothing goes first because it is unmistakable and never a coincidence.
 */
const PREFERENCE: readonly ApiSplitType[] = ['None', 'AvoidOne', 'Pairs', 'AvoidOneAndThree', 'Any'];

/** Fallback when nothing matches. Permits a single, which the source list didn't. */
const RESIDUE_FALLBACK: ApiSplitType = 'AvoidOne';

export interface SplitResolution {
  splitType: ApiSplitType;
  /** True when the chosen mode permits exactly the quantities we asked for. */
  exact: boolean;
  /** Present only when inexact — for the skip/loss report. */
  lost?: string;
}

function parseList(customSplit: string | undefined | null, quantity: number): Set<number> | null {
  if (!customSplit) return null;
  const parsed = customSplit
    .split(',')
    .map(s => Number.parseInt(s.trim(), 10))
    .filter(n => Number.isInteger(n) && n > 0 && n <= quantity);
  return parsed.length > 0 ? new Set(parsed) : null;
}

/**
 * Resolve a row's split configuration to a single ApiSplitType.
 *
 * @param quantity    inventory.quantity / CsvRow.quantity
 * @param splitType   CsvRow.split_type — CUSTOM | NEVERLEAVEONE | DEFAULT | ANY
 * @param customSplit CsvRow.custom_split — the explicit quantity list, when present
 */
export function resolveSplitType(
  quantity: number,
  splitType: string | undefined | null,
  customSplit?: string | null,
): SplitResolution {
  // Degenerate group: every mode permits the same single purchase.
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { splitType: 'Any', exact: false, lost: `invalid quantity ${quantity}` };
  }
  if (quantity === 1) return { splitType: 'Any', exact: true };

  const wanted = parseList(customSplit, quantity);

  // No explicit list — fall back to the declared mode. NEVERLEAVEONE is the only
  // one of ours that names a rule rather than a list, and it maps cleanly.
  if (!wanted) {
    const declared = (splitType || '').toUpperCase();
    if (declared === 'NEVERLEAVEONE') return { splitType: 'AvoidOne', exact: true };
    return { splitType: 'Any', exact: true };
  }

  for (const mode of PREFERENCE) {
    if (setsEqual(permittedQuantities(mode, quantity), wanted)) {
      return { splitType: mode, exact: true };
    }
  }

  const asked = [...wanted].sort((a, b) => a - b).join(',');
  const granted = [...permittedQuantities(RESIDUE_FALLBACK, quantity)].sort((a, b) => a - b).join(',');
  return {
    splitType: RESIDUE_FALLBACK,
    exact: false,
    lost: `qty ${quantity}: wanted [${asked}], nearest mode ${RESIDUE_FALLBACK} permits [${granted}]`,
  };
}

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/** Exposed for tests and for the offline coverage report. */
export const __internal = { permittedQuantities, PREFERENCE };
