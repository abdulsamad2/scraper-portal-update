/**
 * Split resolution for the inventory CSV.
 *
 * Lifted out of actions/csvActions so the exporter and the portal's
 * dominated-listings preview bucket listings by the exact same split — two
 * listings only compete when a buyer could actually choose between them, and
 * that depends on the split the file will carry, not the raw scraper value.
 */

export type CsvSplitType = 'CUSTOM' | 'DEFAULT' | 'NEVERLEAVEONE' | 'ANY';

// Function to determine split configuration based on ticket type and quantity.
// For resale, prefers the DB `customSplit` value (written by the scraper from TM's
// sellableQuantities, clipped to the actual seat-group size). Falls back to the
// legacy hardcoded table only when the DB value is missing. Standard tickets use
// the DB `customSplit` when present, otherwise NEVERLEAVEONE — no legacy fallback.
export function calculateSplitConfiguration(
  quantity: number,
  splitType?: string,
  dbCustomSplit?: string,
): {
  finalSplitType: CsvSplitType;
  customSplit: string;
} {
  const isResale = splitType !== 'NEVERLEAVEONE';

  if (isResale) {
    if (dbCustomSplit && dbCustomSplit.trim().length > 0) {
      return { finalSplitType: 'CUSTOM', customSplit: dbCustomSplit.trim() };
    }

    // Legacy resale fallback — used only when the scraper didn't provide a split.
    if ((quantity % 2 === 0 && quantity >= 10) || (quantity % 2 === 1 && quantity >= 11)) {
      return { finalSplitType: 'NEVERLEAVEONE', customSplit: '' };
    }
    if (quantity === 2) return { finalSplitType: 'CUSTOM', customSplit: '2' };
    if (quantity === 3) return { finalSplitType: 'CUSTOM', customSplit: '3' };
    if (quantity === 4) return { finalSplitType: 'CUSTOM', customSplit: '4' };
    if (quantity === 5) return { finalSplitType: 'CUSTOM', customSplit: '3,5' };
    if (quantity === 6) return { finalSplitType: 'CUSTOM', customSplit: '2,4,6' };
    if (quantity === 7) return { finalSplitType: 'CUSTOM', customSplit: '2,3,4,5,7' };
    if (quantity === 8) return { finalSplitType: 'CUSTOM', customSplit: '2,4,6,8' };
    if (quantity === 9) return { finalSplitType: 'CUSTOM', customSplit: '2,3,4,5,6,7,9' };
    if (quantity === 10) return { finalSplitType: 'CUSTOM', customSplit: '2,4,6,8,10' };
    if (quantity === 11) return { finalSplitType: 'CUSTOM', customSplit: '2,3,4,5,6,7,8,9,11' };
    return { finalSplitType: 'NEVERLEAVEONE', customSplit: '' };
  }

  // Standard (primary) — only apply TM's customSplit when the minimum sellable
  // quantity is >= 4 (i.e. TM is forcing 4-packs or larger). Anything smaller
  // falls through to NEVERLEAVEONE. No synthetic splits are generated.
  if (dbCustomSplit && dbCustomSplit.trim().length > 0) {
    const parsed = dbCustomSplit
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isFinite(n) && n > 0);
    if (parsed.length > 0 && Math.min(...parsed) >= 4) {
      return { finalSplitType: 'CUSTOM', customSplit: dbCustomSplit.trim() };
    }
  }
  return { finalSplitType: 'NEVERLEAVEONE', customSplit: '' };
}
