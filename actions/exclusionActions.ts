'use server';
import dbConnect from '../lib/dbConnect';
import { ExclusionRules } from '../models/exclusionRulesModel';
import { ConsecutiveGroup } from '../models/seatModel';
import { createErrorLog } from './errorLogActions';
import {
  partitionDominated,
  dominatedBucketKey,
  resolveDominatedEnabled,
  resolveDominatedMode,
  type DominatedMode,
} from '../lib/dominatedListings';
import { calculateSplitConfiguration } from '../lib/csvSplits';

export interface SectionRowExclusion {
  section: string;
  excludeEntireSection: boolean;
  excludedRows: string[];
}

export interface DominatedListingsRule {
  /**
   * How this event treats the global switch: 'inherit' follows it (the
   * default), 'on' applies the rule even while global is off, 'off' exempts
   * the event even while global is on.
   */
  mode: DominatedMode;
}

export interface ExclusionRulesData {
  eventId: string;
  eventName: string;
  sectionRowExclusions: SectionRowExclusion[];
  /** Optional so callers that only edit section/row rules leave the setting untouched. */
  dominatedListings?: DominatedListingsRule;
  isActive: boolean;
}

export interface OutlierListing {
  section: string;
  row: string;
  listPrice: number;
  quantity: number;
  sectionAvgPrice: number; // average price within this section
  deviationPct: number;    // % below section average (positive = below)
}

export interface OutlierAnalysis {
  standard: { avgPrice: number; totalListings: number; outliers: OutlierListing[] };
  resale:   { avgPrice: number; totalListings: number; outliers: OutlierListing[] };
}

// Get exclusion rules for an event
export async function getExclusionRules(eventId: string) {
  try {
    await dbConnect();
    const rules = await ExclusionRules.findOne({ eventId, isActive: true }).lean();
    
    // Convert MongoDB document to plain object
    const plainRules = rules ? JSON.parse(JSON.stringify(rules)) : null;
    
    return { success: true, data: plainRules };
  } catch (error) {
    console.error('Error fetching exclusion rules:', error);
    await createErrorLog({
      errorType: 'EXCLUSION_RULES_FETCH_ERROR',
      errorMessage: `Failed to fetch exclusion rules for event ${eventId}`,
      stackTrace: error instanceof Error ? error.message : 'Unknown error',
      metadata: { eventId }
    });
    return { success: false, error: 'Failed to fetch exclusion rules' };
  }
}

// Save or update exclusion rules for an event
export async function saveExclusionRules(rulesData: ExclusionRulesData) {
  try {
    await dbConnect();
    
    const updatedRules = await ExclusionRules.findOneAndUpdate(
      { eventId: rulesData.eventId },
      rulesData,
      { 
        upsert: true, 
        new: true,
        runValidators: true,
        lean: true
      }
    );

    // Convert MongoDB document to plain object
    const plainRules = updatedRules ? JSON.parse(JSON.stringify(updatedRules)) : null;

    return { success: true, data: plainRules };
  } catch (error) {
    console.error('Error saving exclusion rules:', error);
    await createErrorLog({
      errorType: 'EXCLUSION_RULES_SAVE_ERROR',
      errorMessage: `Failed to save exclusion rules for event ${rulesData.eventId}`,
      stackTrace: error instanceof Error ? error.message : 'Unknown error',
      metadata: { eventId: rulesData.eventId, rulesData }
    });
    return { success: false, error: 'Failed to save exclusion rules' };
  }
}

// Delete exclusion rules for an event
export async function deleteExclusionRules(eventId: string) {
  try {
    await dbConnect();
    await ExclusionRules.findOneAndUpdate(
      { eventId },
      { isActive: false },
      { new: true }
    );
    return { success: true };
  } catch (error) {
    console.error('Error deleting exclusion rules:', error);
    await createErrorLog({
      errorType: 'EXCLUSION_RULES_DELETE_ERROR',
      errorMessage: `Failed to delete exclusion rules for event ${eventId}`,
      stackTrace: error instanceof Error ? error.message : 'Unknown error',
      metadata: { eventId }
    });
    return { success: false, error: 'Failed to delete exclusion rules' };
  }
}

// Get available sections and rows for an event
export async function getEventSectionsAndRows(eventId: string) {
  try {
    await dbConnect();
    
    // First get the event to find its mapping_id
    const { Event } = await import('../models/eventModel');
    const event = await Event.findById(eventId).lean();
    if (!event || Array.isArray(event) || !('mapping_id' in event)) {
      return { success: false, error: 'Event not found' };
    }
    
    const pipeline = [
      { $match: { mapping_id: (event as any).mapping_id } },
      {
        $group: {
          _id: '$inventory.section',
          rows: { $addToSet: '$inventory.row' },
          totalListings: { $sum: 1 },
          avgPrice: { $avg: '$inventory.listPrice' }
        }
      },
      {
        $project: {
          section: '$_id',
          rows: { $sortArray: { input: '$rows', sortBy: 1 } },
          totalListings: 1,
          avgPrice: { $round: ['$avgPrice', 2] }
        }
      },
      { $sort: { section: 1 as const } }
    ];

    const result = await ConsecutiveGroup.aggregate(pipeline);
    
    // Convert MongoDB documents to plain objects
    const plainResult = result ? JSON.parse(JSON.stringify(result)) : [];
    
    return { success: true, data: plainResult };
  } catch (error) {
    console.error('Error fetching sections and rows:', error);
    await createErrorLog({
      errorType: 'SECTIONS_ROWS_FETCH_ERROR',
      errorMessage: `Failed to fetch sections and rows for event ${eventId}`,
      stackTrace: error instanceof Error ? error.message : 'Unknown error',
      metadata: { eventId }
    });
    return { success: false, error: 'Failed to fetch sections and rows' };
  }
}

// Get outlier listings (prices below average) for an event, split by standard vs resale
export async function getOutlierAnalysis(eventId: string): Promise<{ success: boolean; data?: OutlierAnalysis; error?: string }> {
  try {
    await dbConnect();
    const { Event } = await import('../models/eventModel');
    const event = await Event.findById(eventId).lean();
    if (!event || Array.isArray(event) || !('mapping_id' in event)) {
      return { success: false, error: 'Event not found' };
    }

    const mappingId = (event as any).mapping_id;

    // Aggregate all listings grouped by section+row+splitType with their listPrice
    const rows = await ConsecutiveGroup.aggregate([
      { $match: { mapping_id: mappingId } },
      {
        $project: {
          section: '$inventory.section',
          row: '$inventory.row',
          listPrice: '$inventory.listPrice',
          quantity: '$inventory.quantity',
          isStandard: { $eq: ['$inventory.splitType', 'NEVERLEAVEONE'] },
        }
      }
    ]);

    const plain: Array<{ section: string; row: string; listPrice: number; quantity: number; isStandard: boolean }> =
      JSON.parse(JSON.stringify(rows));

    const standard = plain.filter(r => r.isStandard);
    const resale   = plain.filter(r => !r.isStandard);

    function analyze(listings: typeof standard): OutlierAnalysis['standard'] {
      if (!listings.length) return { avgPrice: 0, totalListings: 0, outliers: [] };

      // Global avg (for display only)
      const globalAvg = Math.round((listings.reduce((s, r) => s + r.listPrice, 0) / listings.length) * 100) / 100;

      // Group by section and compute per-section average
      const bySection = new Map<string, typeof standard>();
      for (const r of listings) {
        if (!bySection.has(r.section)) bySection.set(r.section, []);
        bySection.get(r.section)!.push(r);
      }

      const outliers: OutlierListing[] = [];
      for (const sectionListings of bySection.values()) {
        const sectionAvg = Math.round(
          (sectionListings.reduce((s, r) => s + r.listPrice, 0) / sectionListings.length) * 100
        ) / 100;
        for (const r of sectionListings) {
          if (r.listPrice < sectionAvg) {
            outliers.push({
              section: r.section,
              row: r.row,
              listPrice: r.listPrice,
              quantity: r.quantity,
              sectionAvgPrice: sectionAvg,
              deviationPct: Math.round(((sectionAvg - r.listPrice) / sectionAvg) * 100),
            });
          }
        }
      }
      outliers.sort((a, b) => b.deviationPct - a.deviationPct);
      return { avgPrice: globalAvg, totalListings: listings.length, outliers };
    }

    return {
      success: true,
      data: { standard: analyze(standard), resale: analyze(resale) },
    };
  } catch (error) {
    console.error('Error computing outlier analysis:', error);
    return { success: false, error: 'Failed to compute outlier analysis' };
  }
}


// ── Dominated-listings preview ───────────────────────────────────────────────

export interface DominatedSample {
  section: string;
  row: string;
  rowRank: number;
  quantity: number;
  /** Per-seat price this listing is asking. */
  listPrice: number;
  /** The better seat that beat it: closer to the field and no more expensive. */
  beatenByRow: string;
  beatenByPrice: number;
}

export interface DominatedPreview {
  /** The global switch, so the page can say what "follow global" currently means. */
  globalEnabled: boolean;
  /** How this event treats the global switch. */
  mode: DominatedMode;
  /** Whether the rule actually applies to this event once both switches are resolved. */
  effectivelyEnabled: boolean;
  /** Listings on this event that the rule could judge (everything with a rowRank). */
  rankedListings: number;
  /** Listings with no row ordering — GA, parking, inventory scraped before rowRank shipped. */
  unrankedListings: number;
  kept: number;
  dropped: number;
  dropPct: number;
  /** A handful of the listings that would be dropped. */
  samples: DominatedSample[];
}

const DOMINATED_SAMPLE_LIMIT = 25;

interface PreviewListing {
  section: string;
  row: string;
  rowRank: number | null;
  quantity: number;
  price: number;
  bucketKey: string;
}

/**
 * What the dominated-listings rule would do to this event.
 *
 * Prices are put through the same per-ticket-type markup the CSV applies, and
 * listings are bucketed by the same resolved split, so the counts track what an
 * export would actually drop rather than a raw-price approximation.
 */
export async function getDominatedListingsPreview(
  eventId: string
): Promise<{ success: boolean; data?: DominatedPreview; error?: string }> {
  try {
    await dbConnect();
    const { Event } = await import('../models/eventModel');
    const event = await Event.findById(eventId).lean();
    if (!event || Array.isArray(event) || !('mapping_id' in event)) {
      return { success: false, error: 'Event not found' };
    }

    const ev = event as unknown as {
      mapping_id: string;
      standardMarkupAdjustment?: number;
      resaleMarkupAdjustment?: number;
      brokerMarkupAdjustment?: number;
      priceIncreasePercentage?: number;
    };

    // Both switches, resolved the same way the exporter resolves them, so the
    // preview reports what an export would really do rather than what the
    // event's own setting says in isolation.
    const { SchedulerSettings } = await import('../models/schedulerModel');
    const schedulerSettings = await SchedulerSettings.findOne(
      {},
      { dominatedListingsEnabled: 1 }
    ).lean() as { dominatedListingsEnabled?: boolean } | null;
    const globalEnabled = schedulerSettings?.dominatedListingsEnabled === true;

    const rules = await ExclusionRules.findOne({ eventId, isActive: true }).lean() as
      | { dominatedListings?: { mode?: DominatedMode; enabled?: boolean } }
      | null;
    const override = rules?.dominatedListings ?? null;
    const mode = resolveDominatedMode(override);
    // The counts are reported even when the rule is off, so the numbers are
    // there to decide with before switching it on.
    const effectivelyEnabled = resolveDominatedEnabled(globalEnabled, override);

    const rows = await ConsecutiveGroup.aggregate([
      { $match: { mapping_id: ev.mapping_id } },
      {
        $project: {
          _id: 0,
          section: '$inventory.section',
          row: '$inventory.row',
          rowRank: '$inventory.rowRank',
          quantity: '$inventory.quantity',
          listPrice: '$inventory.listPrice',
          customSplit: '$inventory.customSplit',
          splitType: '$inventory.splitType',
          tags: '$inventory.tags',
        },
      },
    ]);

    const defaultPct = ev.priceIncreasePercentage ?? 0;
    const stdAdj = ev.standardMarkupAdjustment ?? 0;
    const resaleAdj = ev.resaleMarkupAdjustment ?? 0;
    const brokerAdj = ev.brokerMarkupAdjustment ?? 0;

    const listings: PreviewListing[] = rows.map((r: Record<string, unknown>) => {
      const splitType = (r.splitType as string) ?? '';
      const isResale = splitType !== 'NEVERLEAVEONE';
      const isBroker = isResale && /broker/i.test((r.tags as string) || '');
      const adj = isBroker
        ? (brokerAdj !== 0 ? brokerAdj : resaleAdj)
        : isResale ? resaleAdj : stdAdj;
      const raw = Number(r.listPrice) || 0;
      const price = defaultPct !== 0 || adj !== 0
        ? raw * (1 + (defaultPct + adj) / 100) / (1 + defaultPct / 100)
        : raw;

      const quantity = Number(r.quantity) || 0;
      const { customSplit } = calculateSplitConfiguration(
        quantity,
        splitType,
        r.customSplit as string | undefined,
      );

      const section = (r.section as string) ?? '';
      const rank = r.rowRank;

      return {
        section,
        row: (r.row as string) ?? '',
        rowRank: typeof rank === 'number' ? rank : null,
        quantity,
        price: Number(price.toFixed(2)),
        bucketKey: dominatedBucketKey(ev.mapping_id, section, quantity, customSplit),
      };
    });

    const rankedListings = listings.filter(l => l.rowRank != null).length;
    const unrankedListings = listings.length - rankedListings;

    const { kept: keptListings, dropped: droppedListings } = partitionDominated(listings, (l) => ({
      bucketKey: l.bucketKey,
      rowRank: l.rowRank,
      perSeatPrice: l.price,
    }));

    // For each sample, name the listing that beat it: the cheapest survivor in
    // the same bucket sitting closer to the field. That is what makes the drop
    // legible — "Row 3 at $780 while Row 1 goes for $700".
    const survivorsByBucket = new Map<string, PreviewListing[]>();
    for (const l of keptListings) {
      if (l.rowRank == null) continue;
      const existing = survivorsByBucket.get(l.bucketKey);
      if (existing) existing.push(l);
      else survivorsByBucket.set(l.bucketKey, [l]);
    }

    const samples: DominatedSample[] = [];
    for (const l of droppedListings) {
      if (samples.length >= DOMINATED_SAMPLE_LIMIT) break;
      let best: PreviewListing | null = null;
      for (const s of survivorsByBucket.get(l.bucketKey) ?? []) {
        // Equal rank counts: a cheaper listing in the same row dominates too,
        // and reporting that as "no better seat found" left the sample blank.
        if (s.rowRank! > l.rowRank!) continue;
        if (s.price > l.price) continue;
        if (!best || s.price < best.price) best = s;
      }
      samples.push({
        section: l.section,
        row: l.row,
        rowRank: l.rowRank!,
        quantity: l.quantity,
        listPrice: l.price,
        beatenByRow: best?.row ?? '',
        beatenByPrice: best?.price ?? 0,
      });
    }

    return {
      success: true,
      data: {
        globalEnabled,
        mode,
        effectivelyEnabled,
        rankedListings,
        unrankedListings,
        kept: keptListings.length,
        dropped: droppedListings.length,
        dropPct: listings.length > 0
          ? Math.round((droppedListings.length / listings.length) * 1000) / 10
          : 0,
        samples,
      },
    };
  } catch (error) {
    console.error('Error computing dominated-listings preview:', error);
    return { success: false, error: 'Failed to compute dominated-listings preview' };
  }
}
