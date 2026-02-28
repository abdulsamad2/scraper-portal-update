/* eslint-disable @typescript-eslint/no-explicit-any */
'use server';
import dbConnect from '../lib/dbConnect';
import { ConsecutiveGroup } from '../models/seatModel';
import { Event } from '../models/eventModel';
import { SchedulerSettings } from '../models/schedulerModel';
import { AutoDeleteSettings } from '../models/autoDeleteModel';
import { ExclusionRules } from '../models/exclusionRulesModel';
import SyncService from '../lib/syncService';
import { createErrorLog } from './errorLogActions';
import { deleteExpiredEvents, getExpiredEventsStats } from './autoDeleteActions';
import { detectTimezoneFromVenueAsync, getCurrentTimeInTimezone } from '../lib/timezone';
import { PipelineStage } from 'mongoose';

interface CsvRow {
  inventory_id: number;
  event_name: string;
  venue_name: string;
  event_date: string;
  event_id: string;
  quantity: number;
  section: string;
  row: string;
  seats: string;
  barcodes?: string;
  internal_notes?: string;
  public_notes?: string;
  tags?: string;
  list_price: number;
  face_price: number;
  taxed_cost: number;
  cost: number;
  hide_seats: 'Y' | 'N';
  in_hand: 'N';
  in_hand_date: string;
  instant_transfer?: 'Y' | 'N';
  files_available: 'Y' | 'N';
  split_type: 'CUSTOM' | 'DEFAULT' | 'NEVERLEAVEONE' | 'ANY';
  custom_split?: string;
  stock_type: 'ELECTRONIC' | 'HARD' | 'MOBILE_TRANSFER' | 'MOBILE_SCREENCAP' | 'PAPERLESS' | 'PAPERLESS_CARD' | 'FLASH';
  zone: 'Y' | 'N';
  shown_quantity?: number;
  passthrough?: string;
}

const csvColumns = [
  { id: 'inventory_id', title: 'inventory_id' },
  { id: 'event_name', title: 'event_name' },
  { id: 'venue_name', title: 'venue_name' },
  { id: 'event_date', title: 'event_date' },
  { id: 'event_id', title: 'event_id' },
  { id: 'quantity', title: 'quantity' },
  { id: 'section', title: 'section' },
  { id: 'row', title: 'row' },
  { id: 'seats', title: 'seats' },
  { id: 'barcodes', title: 'barcodes' },
  { id: 'internal_notes', title: 'internal_notes' },
  { id: 'public_notes', title: 'public_notes' },
  { id: 'tags', title: 'tags' },
  { id: 'list_price', title: 'list_price' },
  { id: 'face_price', title: 'face_price' },
  { id: 'taxed_cost', title: 'taxed_cost' },
  { id: 'cost', title: 'cost' },
  { id: 'hide_seats', title: 'hide_seats' },
  { id: 'in_hand', title: 'in_hand' },
  { id: 'in_hand_date', title: 'in_hand_date' },
  { id: 'instant_transfer', title: 'instant_transfer' },
  { id: 'files_available', title: 'files_available' },
  { id: 'split_type', title: 'split_type' },
  { id: 'custom_split', title: 'custom_split' },
  { id: 'stock_type', title: 'stock_type' },
  { id: 'zone', title: 'zone' },
  { id: 'shown_quantity', title: 'shown_quantity' },
  { id: 'passthrough', title: 'passthrough' },
];

// Retry configuration
interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 10000  // 10 seconds
};

// Exponential backoff with jitter
function calculateDelay(attempt: number, config: RetryConfig): number {
  const exponentialDelay = Math.min(config.baseDelay * Math.pow(2, attempt), config.maxDelay);
  const jitter = Math.random() * 0.1 * exponentialDelay;
  return exponentialDelay + jitter;
}

// Get price adjustment percentage from environment variables
function getPriceAdjustmentPercentage(): number {
  const priceAdjustmentEnv = process.env.PRICE_INCREASE_PERCENTAGE;
  if (!priceAdjustmentEnv) {
    return 0; // Default: no price adjustment
  }
  const percentage = parseFloat(priceAdjustmentEnv);
  return isNaN(percentage) ? 0 : percentage;
}

// Apply exclusion rules to filter out unwanted records
async function applyExclusionRules(records: CsvRow[]): Promise<CsvRow[]> {
  if (records.length === 0) return records;
  
  try {
    // Group records by event_id (mapping_id) to batch exclusion rule lookups
    const mappingIds = [...new Set(records.map(record => record.event_id))];
    
    // First, get events to create mapping between _id and mapping_id
    const events = await Event.find({
      mapping_id: { $in: mappingIds }
    }, { _id: 1, mapping_id: 1 }).lean();
    
    if (events.length === 0) {
      return records;
    }
    
    // Create mapping from mapping_id to _id
    const mappingToIdMap = new Map();
    const eventIds: string[] = [];
    events.forEach(event => {
      mappingToIdMap.set(event.mapping_id, String(event._id));
      eventIds.push(String(event._id));
    });
    
    // Get all exclusion rules for these events (using _id)
    const exclusionRules = await ExclusionRules.find({
      eventId: { $in: eventIds },
      isActive: true
    }).lean();
    
    if (exclusionRules.length === 0) {
      return records;
    }
    
    // Create a map for quick lookup (eventId -> exclusion rules)
    const rulesMap = new Map();
    exclusionRules.forEach(rule => {
      rulesMap.set(rule.eventId, rule);
    });
    
    // Apply exclusions
    const filteredRecords = records.filter(record => {
      // Get the _id for this mapping_id
      const eventObjectId = mappingToIdMap.get(record.event_id);
      if (!eventObjectId) return true;
      
      const rules = rulesMap.get(eventObjectId);
      if (!rules) return true;
      
      // Apply section/row exclusions
      if (rules.sectionRowExclusions && rules.sectionRowExclusions.length > 0) {
        for (const exclusion of rules.sectionRowExclusions) {
          if (exclusion.section === record.section) {
            if (exclusion.excludeEntireSection) {
              return false; // Exclude entire section
            }
            if (exclusion.excludedRows && exclusion.excludedRows.includes(record.row)) {
              return false; // Exclude specific row
            }
          }
        }
      }
      
      return true;
    });
    
    const finalRecords = filteredRecords;
    
    const excludedCount = records.length - finalRecords.length;
    if (excludedCount > 0) {
      console.log(`Exclusion rules applied: ${excludedCount} records excluded from ${records.length} total records`);
    }
    
    return finalRecords;
  } catch (error) {
    console.error('Error applying exclusion rules:', error);
    // Return original records if exclusion fails to avoid breaking CSV generation
    return records;
  }
}

// Apply price adjustment (increase or decrease) to a price value
function applyPriceAdjustment(originalPrice: number): number {
  const adjustmentPercentage = getPriceAdjustmentPercentage();
  if (adjustmentPercentage === 0) {
    return originalPrice;
  }
  // Positive percentage = increase, Negative percentage = decrease
  return originalPrice * (1 + adjustmentPercentage / 100);
}

// Generic retry wrapper
async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === config.maxRetries) {
        await createErrorLog({
          eventUrl: `RETRY_${operationName.toUpperCase().replace(/\s+/g, '_')}`,
          errorType: 'DATABASE_ERROR',
          message: lastError.message,
          stack: lastError.stack,
          metadata: {
            operation: operationName,
            attempt: attempt + 1,
            timestamp: new Date()
          }
        });
        throw lastError;
      }
      
      const delay = calculateDelay(attempt, config);
      console.warn(`[CSV] ${operationName} failed (attempt ${attempt + 1}/${config.maxRetries + 1}): ${lastError.message}. Retrying in ${Math.round(delay)}ms...`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}

// Cache for resolved venue timezones within a CSV generation run
const _venueTzCache = new Map<string, string | null>();

export async function generateInventoryCsv(eventUpdateFilterMinutes: number = 0) {
  return withRetry(async () => {
    await dbConnect();

    const mongoose = await import('mongoose');

    const startTime = Date.now();

    // Clear venue timezone cache at the start of each CSV generation run
    _venueTzCache.clear();

    try {
      let eventFilter = {};
      
      // Only include active events (Skip_Scraping: false)
      const activeEventQuery: Record<string, any> = { Skip_Scraping: false };

      // If eventUpdateFilterMinutes is provided, also filter by recently updated events
      if (eventUpdateFilterMinutes > 0) {
        const cutoffTime = new Date(Date.now() - eventUpdateFilterMinutes * 60 * 1000);
        activeEventQuery.updatedAt = { $gte: cutoffTime };
        console.log(`Filter: Active events updated within last ${eventUpdateFilterMinutes} minutes since ${cutoffTime.toISOString()}`);
      } else {
        console.log('Including all active events (Skip_Scraping: false)');
      }

      const activeEvents = await Event.find(
        activeEventQuery,
        { mapping_id: 1 }
      )
      .read('primary')
      .maxTimeMS(30000);

      console.log(`Found ${activeEvents.length} active events matching filter criteria`);

      if (activeEvents.length === 0) {
        return { success: false, message: eventUpdateFilterMinutes > 0
          ? `No active events updated within the last ${eventUpdateFilterMinutes} minutes.`
          : 'No active events found (all events have Skip_Scraping enabled).' };
      }

      const eventMappingIds = activeEvents.map(event => event.mapping_id);
      eventFilter = { mapping_id: { $in: eventMappingIds } };

      // Pre-fetch ALL event details once (small — only active events) instead of
      // running $lookup per chunk. This is the single biggest speed-up.
      const eventDetailsMap = new Map<string, {
        url: string; stdAdj: number; resaleAdj: number; defaultPct: number;
        includeStandard: boolean; includeResale: boolean;
      }>();
      const eventDocs = await Event.find(
        { mapping_id: { $in: eventMappingIds } },
        { mapping_id: 1, URL: 1, standardMarkupAdjustment: 1, resaleMarkupAdjustment: 1,
          priceIncreasePercentage: 1, includeStandardSeats: 1, includeResaleSeats: 1 }
      ).lean();
      for (const ev of eventDocs) {
        eventDetailsMap.set(ev.mapping_id, {
          url: ev.URL || '',
          stdAdj: ev.standardMarkupAdjustment ?? 0,
          resaleAdj: ev.resaleMarkupAdjustment ?? 0,
          defaultPct: ev.priceIncreasePercentage ?? 0,
          includeStandard: ev.includeStandardSeats !== false,
          includeResale: ev.includeResaleSeats !== false,
        });
      }
      console.log(`[CSV] Pre-fetched details for ${eventDetailsMap.size} events`);

    // Projection — no longer need event_std_adj etc from $lookup
    const projection = {
      'inventory.inventoryId': 1,
      'event_name': 1,
      'venue_name': 1,
      'event_date': 1,
      'eventId': 1,
      'mapping_id': 1,
      'inventory.quantity': 1,
      'inventory.section': 1,
      'inventory.row': 1,
      'seats.number': 1,
      'inventory.barcodes': 1,
      'inventory.tags': 1,
      'inventory.notes': 1,
      'inventory.publicNotes': 1,
      'inventory.listPrice': 1,
      'inventory.face_price': 1,
      'inventory.taxed_cost': 1,
      'inventory.cost': 1,
      'inventory.hideSeatNumbers': 1,
      'inventory.in_hand': 1,
      'inventory.inHandDate': 1,
      'inventory.instant_transfer': 1,
      'inventory.files_available': 1,
      'inventory.splitType': 1,
      'inventory.custom_split': 1,
      'inventory.stockType': 1,
      'inventory.zone': 1,
      'inventory.shown_quantity': 1,
      'inventory.passthrough': 1,
    };

      // Chunked processing: first get all _ids (fast, no $lookup), then process
      // in batches. Event data is joined in JS from the pre-fetched map.
      const CHUNK_SIZE = 10000;

      // Step 1: Get all matching _ids quickly (no $lookup, very fast)
      const idPipeline: PipelineStage[] = [
        { $match: eventFilter },
        { $sort: { _id: 1 as const } },
        { $project: { _id: 1 } },
      ];
      const allIds = await ConsecutiveGroup.aggregate(idPipeline, {
        allowDiskUse: true,
        maxTimeMS: 60000,
      });
      const totalDocs = allIds.length;
      console.log(`[CSV] Total documents to process: ${totalDocs} (chunk size: ${CHUNK_SIZE})`);

      if (totalDocs === 0) {
        console.log('[CSV] No matching ConsecutiveGroup documents found');
        return { success: false, message: 'No inventory data found. Check if events exist and have inventory data.' };
      }

      const records: CsvRow[] = [];
      let processedCount = 0;
      let chunkNum = 0;

      // Step 2: Process in chunks — simple find by _ids, no $lookup needed
      for (let i = 0; i < totalDocs; i += CHUNK_SIZE) {
        chunkNum++;
        const chunkStart = Date.now();
        const chunkIds = allIds.slice(i, i + CHUNK_SIZE).map((d: { _id: string }) => d._id);

        const chunkDocs: ConsecutiveGroupDocument[] = await ConsecutiveGroup.aggregate(
          [
            { $match: { _id: { $in: chunkIds } } },
            { $project: projection },
          ] as PipelineStage[],
          { allowDiskUse: true, maxTimeMS: 120000 }
        );

        if (chunkDocs.length > 0) {
          // Enrich docs with event data from the pre-fetched map + apply include/exclude filter
          const enrichedDocs: ConsecutiveGroupDocument[] = [];
          for (const doc of chunkDocs) {
            const evData = doc.mapping_id ? eventDetailsMap.get(doc.mapping_id) : undefined;
            const isStandard = doc.inventory?.splitType === 'NEVERLEAVEONE';
            // Apply per-event standard/resale inclusion toggles
            if (isStandard && evData && !evData.includeStandard) continue;
            if (!isStandard && evData && !evData.includeResale) continue;

            doc.event_url = evData?.url || '';
            doc.event_std_adj = evData?.stdAdj ?? 0;
            doc.event_resale_adj = evData?.resaleAdj ?? 0;
            doc.event_default_pct = evData?.defaultPct ?? 0;
            enrichedDocs.push(doc);
          }
          if (enrichedDocs.length > 0) {
            const processedBatch = await processBatch(enrichedDocs);
            records.push(...processedBatch);
          }
        }
        processedCount += chunkIds.length;

        const chunkMs = Date.now() - chunkStart;
        console.log(`[CSV] Chunk ${chunkNum}: ${chunkDocs.length} docs -> ${records.length} rows in ${chunkMs}ms (${processedCount}/${totalDocs}, ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB heap)`);

        // Yield control between chunks
        await new Promise(resolve => (typeof setImmediate !== 'undefined' ? setImmediate : setTimeout)(resolve, 0));
      }

      console.log(`[CSV] Total records found: ${records.length} (processed ${processedCount} docs in ${Date.now() - startTime}ms)`);
      
      if (records.length === 0) {
        console.log('[CSV] No inventory data found — aborting');
        return { success: false, message: 'No inventory data found. Check if events exist and have inventory data.' };
      }

      // Apply exclusion rules
      const exclStart = Date.now();
      const filteredRecords = await applyExclusionRules(records);
      console.log(`[CSV] Exclusion rules applied in ${Date.now() - exclStart}ms`);

      if (filteredRecords.length === 0) {
        return { success: false, message: 'No inventory data found after applying exclusion rules. All records were filtered out.' };
      }

      console.log(`[CSV] Records after exclusion filtering: ${filteredRecords.length} (${records.length - filteredRecords.length} excluded)`);

      // Optimized CSV generation using streaming approach
      const csvString = await generateCsvString(filteredRecords);
    
      const endTime = Date.now();
      const duration = endTime - startTime;
      const memoryUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      
      console.log(`[CSV] ✅ Generation completed in ${duration}ms for ${filteredRecords.length} records (Peak memory: ${memoryUsage}MB)`);

      return { 
        success: true, 
        csv: csvString,
        recordCount: filteredRecords.length,
        excludedCount: records.length - filteredRecords.length,
        generationTime: duration,
        memoryUsage
      };
    } catch (error) {
      console.error('Error generating CSV:', error);
      await createErrorLog({
        eventUrl: 'CSV_GENERATION',
        errorType: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        metadata: {
          operation: 'generateInventoryCsv',
          timestamp: new Date()
        }
      });
      return { success: false, message: 'Failed to generate CSV.' };
    }
  }, 'CSV Generation');
}

// Interface for the document structure from MongoDB aggregation
interface ConsecutiveGroupDocument {
  _id?: string;
  inventory?: {
    inventoryId?: number;
    quantity?: number;
    section?: string;
    row?: string;
    barcodes?: string;
    tags?: string;
    notes?: string;
    publicNotes?: string;
    listPrice?: number;
    face_price?: number;
    taxed_cost?: number;
    cost?: number;
    hideSeatNumbers?: boolean;
    in_hand?: boolean;
    inHandDate?: Date | string;
    instant_transfer?: boolean;
    files_available?: boolean;
    splitType?: string;
    custom_split?: string;
    stockType?: string;
    zone?: boolean;
    shown_quantity?: number;
    passthrough?: string;
  };
  event_name?: string;
  venue_name?: string;
  event_date?: Date | string;
  eventId?: string;
  mapping_id?: string;
  event_url?: string;
  event_std_adj?: number;
  event_resale_adj?: number;
  event_default_pct?: number;
  seats?: Array<{ number: string | number }>;
}

// Function to determine split configuration based on ticket type and quantity
function calculateSplitConfiguration(quantity: number, splitType?: string): {
  finalSplitType: CsvRow['split_type']; 
  customSplit: string; 
} {
  // If splitType is "DEFAULT", it's a resale ticket
  const isResale = splitType === 'DEFAULT';
  
  if (isResale) {
    // RESALE logic
    
    // For quantities over thresholds, use NEVERLEAVEONE
    // Even quantities over 10 = NEVERLEAVEONE
    // Odd quantities over 11 = NEVERLEAVEONE
    if ((quantity % 2 === 0 && quantity >= 10) || (quantity % 2 === 1 && quantity >= 11)) {
      return { finalSplitType: 'NEVERLEAVEONE', customSplit: '' };
    }
    
    // For quantities at or below thresholds, use CUSTOM with appropriate splits
    // Even quantities 10 and below, Odd quantities 11 and below use CUSTOM
    if (quantity === 2) {
      return { finalSplitType: 'CUSTOM', customSplit: '2' };
    } else if (quantity === 3) {
      return { finalSplitType: 'CUSTOM', customSplit: '3' };
    } else if (quantity === 4) {
      return { finalSplitType: 'CUSTOM', customSplit: '4' };
    } else if (quantity === 5) {
      return { finalSplitType: 'CUSTOM', customSplit: '3,5' };
    } else if (quantity === 6) {
      return { finalSplitType: 'CUSTOM', customSplit: '2,4,6' };
    } else if (quantity === 7) {
      return { finalSplitType: 'CUSTOM', customSplit: '2,3,4,5,7' };
    } else if (quantity === 8) {
      return { finalSplitType: 'CUSTOM', customSplit: '2,4,6,8' };
    } else if (quantity === 9) {
      return { finalSplitType: 'CUSTOM', customSplit: '2,3,4,5,6,7,9' };
    } else if (quantity === 10) {
      return { finalSplitType: 'CUSTOM', customSplit: '2,4,6,8,10' };
    } else if (quantity === 11) {
      return { finalSplitType: 'CUSTOM', customSplit: '2,3,4,5,6,7,8,9,11' };
    } else {
      // For any other quantities (edge cases or quantities > thresholds), use NEVERLEAVEONE
      return { finalSplitType: 'NEVERLEAVEONE', customSplit: '' };
    }
  } else {
    // STANDARD ticket logic - all standard tickets use NEVERLEAVEONE
    return { finalSplitType: 'NEVERLEAVEONE', customSplit: '' };
  }
}

// Helper function to process batches
async function processBatch(batch: ConsecutiveGroupDocument[]): Promise<CsvRow[]> {
  // Resolve timezones for all unique venues in this batch (async, with API fallback)
  const uniqueVenues = [...new Set(batch.map(d => d.venue_name).filter(Boolean))] as string[];
  await Promise.all(uniqueVenues.map(async (venue) => {
    if (!_venueTzCache.has(venue)) {
      const tz = await detectTimezoneFromVenueAsync(venue);
      _venueTzCache.set(venue, tz);
    }
  }));

  return batch.map(doc => {
    const inventory = doc.inventory;
    const isResale = inventory?.splitType !== 'NEVERLEAVEONE';

    // Detect GA/Lawn rows — scraper stores synthetic row names like "GA1", "GA2", etc.
    const row = inventory?.row || '';
    const isGALawn = /^GA\d+$/i.test(row);

    // Apply per-ticket-type markup adjustment on top of already-marked-up listPrice.
    // Formula: adjustedPrice = listPrice * (1 + (defaultPct + adj) / 100) / (1 + defaultPct / 100)
    const rawListPrice = inventory?.listPrice || 0;
    const defaultPct = doc.event_default_pct ?? 0;
    const adj = isResale ? (doc.event_resale_adj ?? 0) : (doc.event_std_adj ?? 0);
    const adjustedListPrice = defaultPct !== 0 || adj !== 0
      ? rawListPrice * (1 + (defaultPct + adj) / 100) / (1 + defaultPct / 100)
      : rawListPrice;

    // Pre-compute expensive operations with null safety
    // GA/Lawn seats have synthetic seat numbers — clear them so Sync doesn't see fake numbers
    const seatsString = isGALawn ? '' :
      (doc.seats && doc.seats.length > 0 ?
        doc.seats.map((seat: { number: string | number }) => String(seat.number)).join(',') : '');
    const eventDateString = doc.event_date ?
      new Date(doc.event_date).toISOString() : '';

    // In-hand date logic: if event is today or in the past (in venue's timezone),
    // use the event date as in-hand date so Sync doesn't reject it.
    // Otherwise use the stored inHandDate (typically event date - 1 day).
    let inHandDateString = inventory?.inHandDate
      ? new Date(inventory.inHandDate).toISOString().slice(0, 10) : '';
    if (doc.event_date) {
      const eventDateOnly = new Date(doc.event_date).toISOString().slice(0, 10);
      const venueTz = doc.venue_name ? _venueTzCache.get(doc.venue_name) ?? null : null;
      if (venueTz) {
        const nowInVenueTz = getCurrentTimeInTimezone(venueTz);
        const todayInVenueTz = nowInVenueTz.toISOString().slice(0, 10);
        if (eventDateOnly <= todayInVenueTz) {
          inHandDateString = eventDateOnly;
        }
      }
      // No fallback — if timezone can't be detected even with live API, keep the stored inHandDate
    }

    // Calculate split configuration based on quantity and split type
    // If the scraper stored a custom_split on the inventory, prefer that over computed values
    let finalSplitType: CsvRow['split_type'];
    let customSplit: string;
    if (inventory?.custom_split) {
      finalSplitType = 'CUSTOM';
      customSplit = inventory.custom_split;
    } else {
      const splitConfig = calculateSplitConfiguration(
        inventory?.quantity || 0,
        inventory?.splitType
      );
      finalSplitType = splitConfig.finalSplitType;
      customSplit = splitConfig.customSplit;
    }

    // Check if row is SRO and handle public notes accordingly
    const isSRO = row.toUpperCase() === 'SRO';
    const existingPublicNotes = inventory?.publicNotes || '';
    const publicNotes = isSRO
      ? (existingPublicNotes ? `${existingPublicNotes} - STANDING ROOM ONLY` : 'STANDING ROOM ONLY')
      : existingPublicNotes;

    // Tags: GA tickets get GA_STANDARD / GA_RESALE, regular tickets get STANDARD / RESALE
    const isStandard = inventory?.splitType === 'NEVERLEAVEONE';
    let tags: string;
    if (isGALawn) {
      tags = isStandard ? 'GA_STANDARD' : 'GA_RESALE';
    } else {
      tags = isStandard ? 'STANDARD' : 'RESALE';
    }

    return {
      inventory_id: inventory?.inventoryId || 0,
      event_name: doc.event_name || "",
      venue_name: doc.venue_name || "",
      event_date: eventDateString,
      event_id: doc.mapping_id || "",
      quantity: inventory?.quantity || 0,
      section: inventory?.section || "",
      row: inventory?.row || "",
      seats: seatsString,
      barcodes: inventory?.barcodes || "",
      internal_notes: "-tnow -tmplus",
      public_notes: publicNotes,
      tags,
      list_price: Number(adjustedListPrice.toFixed(2)),
      face_price: Number((inventory?.cost || 0).toFixed(2)),
      taxed_cost: Number((inventory?.cost || 0).toFixed(2)),
      cost: Number((inventory?.cost || 0).toFixed(2)),
      hide_seats: inventory?.hideSeatNumbers ? "Y" : "N",
      in_hand: "N", // Always set to "N" as per original code
      in_hand_date: inHandDateString,
      instant_transfer: inventory?.instant_transfer ? "Y" : "N",
      files_available: "N",
      split_type: finalSplitType,
      custom_split: customSplit,
      stock_type:
        (inventory?.stockType as CsvRow["stock_type"]) || "ELECTRONIC",
      zone: isGALawn ? "Y" : "N",
      shown_quantity: inventory?.shown_quantity || undefined,
      passthrough: inventory?.passthrough || "",
    } as CsvRow;
  });
}

// Optimized CSV string generation
async function generateCsvString(records: CsvRow[]): Promise<string> {
  const chunks: string[] = [];
  
  // Add headers
  chunks.push(csvColumns.map(col => col.title).join(','));
  
  // Process records in chunks to avoid string concatenation performance issues
  const CHUNK_SIZE = 1000;
  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE);
    const csvChunk = chunk.map(record => {
      return csvColumns.map(col => {
        const value = record[col.id as keyof CsvRow];
        // Proper CSV escaping
        if (value === null || value === undefined) {
          return '';
        }
        const stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n') || stringValue.includes('\r')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      }).join(',');
    }).join('\n');
    
    chunks.push(csvChunk);
    
    // Yield control periodically
    if (i % (CHUNK_SIZE * 5) === 0) {
      await new Promise(resolve => (typeof setImmediate !== 'undefined' ? setImmediate : setTimeout)(resolve, 0));
    }
  }
  
  return chunks.join('\n');
}

export async function uploadCsvToSyncService(csvContent: string): Promise<{ success: boolean; message: string; uploadId?: string }> {
  return withRetry(async () => {
    try {
      // Get sync service credentials from environment variables
      const companyId = process.env.SYNC_COMPANY_ID;
      const apiToken = process.env.SYNC_API_TOKEN;
      
      if (!companyId || !apiToken) {
        throw new Error('Sync service credentials not configured. Please set SYNC_COMPANY_ID and SYNC_API_TOKEN environment variables.');
      }
      
      // Validate CSV content
      if (!csvContent || csvContent.trim().length === 0) {
        throw new Error('CSV content is empty or invalid');
      }
      
      // Initialize sync service
      const syncService = new SyncService(companyId, apiToken);
      
      // Upload CSV content to sync service with timeout
      const uploadPromise = syncService.uploadCsvContentToSync(csvContent);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Upload timeout after 180 seconds')), 180000);
      });
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      const result = await Promise.race([uploadPromise, timeoutPromise]) as any;
      
      // Log detailed server response for debugging
      console.log('=== SERVER UPLOAD RESPONSE ===');
      console.log('Full server response:', JSON.stringify(result, null, 2));
      console.log('Response type:', typeof result);
      console.log('Response keys:', Object.keys(result || {}));
      console.log('==============================');
      
      if ('success' in result && result.success) {
        // Update database with upload status
        await updateSchedulerSettings({
          lastUploadAt: new Date(),
          lastUploadStatus: 'success',
          lastUploadId: (result as { uploadId?: string })?.uploadId
        });
        
        console.log('✅ CSV content uploaded to sync service successfully');
        console.log('Upload ID:', (result as { uploadId?: string })?.uploadId);
        
        return {
          success: true,
          message: 'CSV uploaded to sync service successfully',
          uploadId: (result as { uploadId?: string }).uploadId
        };
      } else {
        console.log('❌ Upload failed - Server response indicates failure');
        console.log('Error message from server:', (result as { message?: string })?.message);
        throw new Error((result as { message?: string }).message || 'Upload failed');
      }
    } catch (error) {
      console.error('Error uploading to sync service:', error);
      
      // Update database with error status
      try {
        await updateSchedulerSettings({
          lastUploadAt: new Date(),
          lastUploadStatus: 'failed',
          lastUploadError: error instanceof Error ? error.message : 'Unknown error occurred'
        });
      } catch (dbError) {
        console.error('Error updating database with upload status:', dbError);
      }
      
      throw error; // Re-throw for retry mechanism
    }
  }, 'CSV Upload', {
    maxRetries: 5, // More retries for upload
    baseDelay: 2000, // Longer delay for network operations
    maxDelay: 30000
  }).catch(error => {
    return {
      success: false,
      message: `Failed to upload CSV to sync service after retries: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  });
}

export async function clearInventoryFromSync(): Promise<{ success: boolean; message: string; uploadId?: string }> {
  try {
    // Get sync service credentials from environment variables
    const companyId = process.env.SYNC_COMPANY_ID;
    const apiToken = process.env.SYNC_API_TOKEN;
    
    if (!companyId || !apiToken) {
      throw new Error('Sync service credentials not configured. Please set SYNC_COMPANY_ID and SYNC_API_TOKEN environment variables.');
    }
    
    // Initialize sync service
    const syncService = new SyncService(companyId, apiToken);
    
    // Clear all inventory
    const result = await syncService.clearAllInventory();
    
    if ('success' in result && result.success) {
      // Update database with clear inventory status
      await updateSchedulerSettings({
        lastUploadAt: new Date(),
        lastUploadStatus: 'cleared',
        lastUploadId: (result as { uploadId?: string })?.uploadId,
        lastClearAt: new Date()
      });
      
      console.log('Inventory cleared from sync service successfully');
      
      return {
        success: true,
        message: 'Inventory cleared from sync service successfully',
        uploadId: (result as { uploadId?: string })?.uploadId
      };
    } else {
      throw new Error((result as { message?: string })?.message || 'Clear inventory failed');
    }
  } catch (error) {
    console.error('Error clearing inventory from sync service:', error);
    
    // Update database with error status
    try {
      await updateSchedulerSettings({
        lastUploadAt: new Date(),
        lastUploadStatus: 'clear_failed',
        lastUploadError: error instanceof Error ? error.message : 'Unknown error occurred'
      });
    } catch (dbError) {
      console.error('Error updating database with clear inventory status:', dbError);
    }
    
    return {
      success: false,
      message: `Failed to clear inventory from sync service: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

export async function deleteInventoryBatchFromSync(inventoryIds: string[]): Promise<{ success: boolean; message: string; successful: string[]; failed: string[] }> {
  try {
    // Get sync service credentials from environment variables
    const companyId = process.env.SYNC_COMPANY_ID;
    const apiToken = process.env.SYNC_API_TOKEN;
    
    if (!companyId || !apiToken) {
      throw new Error('Sync service credentials not configured. Please set SYNC_COMPANY_ID and SYNC_API_TOKEN environment variables.');
    }
    
    if (!inventoryIds || inventoryIds.length === 0) {
      return {
        success: true,
        message: 'No inventory IDs provided for deletion',
        successful: [],
        failed: []
      };
    }
    
    // Initialize sync service
    const syncService = new SyncService(companyId, apiToken);
    
    // Delete specific inventory items
    const result = await syncService.deleteInventoryBatch(inventoryIds);
    
    console.log('Raw sync service response:', JSON.stringify(result, null, 2));
    
    // Check the actual deletion count from the response
    const deletedCount = (result as { deleted?: number })?.deleted ?? 0;
    const totalRequested = inventoryIds.length;
    
    console.log(`Sync service deletion summary: ${deletedCount}/${totalRequested} items deleted`);
    
    if (deletedCount === 0) {
      console.warn('⚠️  No items were deleted from sync service. This could mean:');
      console.warn('   - Inventory IDs do not exist in sync service');
      console.warn('   - Items were already deleted');
      console.warn('   - API endpoint format issue');
    }
    
    // If we get here without an error, sync service reported success
    // Check common success indicators or assume success if no error was thrown
    const isSuccess = ('success' in result && result.success) || 
                      ('status' in result && result.status === 'success') ||
                      ('error' in result && !result.error) ||
                      !('error' in result); // If no explicit error field, assume success
    
    if (isSuccess) {
      const actuallyDeleted = (result as { deleted?: number })?.deleted ?? 0;
      console.log(`Successfully processed deletion request: ${actuallyDeleted}/${inventoryIds.length} inventory items deleted from sync service`);
      
      return {
        success: true,
        message: `Successfully processed deletion request: ${actuallyDeleted}/${inventoryIds.length} inventory items deleted from sync service`,
        successful: actuallyDeleted > 0 ? inventoryIds.slice(0, actuallyDeleted) : [],
        failed: actuallyDeleted < inventoryIds.length ? inventoryIds.slice(actuallyDeleted) : []
      };
    } else {
      throw new Error((result as { message?: string })?.message || 'Batch inventory deletion failed');
    }
  } catch (error) {
    console.error('Error deleting inventory batch from sync service:', error);
    
    return {
      success: false,
      message: `Failed to delete inventory batch from sync service: ${error instanceof Error ? error.message : 'Unknown error'}`,
      successful: [],
      failed: inventoryIds
    };
  }
}

// Database settings functions
export async function getSchedulerSettings() {
  await dbConnect();
  try {
    return await SchedulerSettings.findOne({}) || await SchedulerSettings.create({});
  } catch (error) {
    console.error('Error getting scheduler settings:', error);
    throw error;
  }
}

export async function updateSchedulerSettings(updates: {
  lastUploadAt?: Date;
  lastUploadStatus?: 'success' | 'failed' | 'cleared' | 'clear_failed';
  lastUploadId?: string;
  lastUploadError?: string;
  lastClearAt?: Date;
  scheduleRateMinutes?: number;
  uploadToSync?: boolean;
  isScheduled?: boolean;
  eventUpdateFilterMinutes?: number;
  nextRunAt?: Date;
  totalRuns?: number;
}) {
  await dbConnect();
  try {
    return await SchedulerSettings.findOneAndUpdate({}, updates, { new: true, upsert: true });
  } catch (error) {
    console.error('Error updating scheduler settings:', error);
    throw error;
  }
}

// Auto-Delete Settings functions
export async function getAutoDeleteSettings() {
  await dbConnect();
  try {
    const settings = await AutoDeleteSettings.findOne().lean();
    if (!settings) {
      const created = await AutoDeleteSettings.create({
        isEnabled: false,
        stopBeforeHours: 2,
        scheduleIntervalMinutes: 15
      });
      return JSON.parse(JSON.stringify(created));
    }
    return JSON.parse(JSON.stringify(settings));
  } catch (error) {
    console.error('Error getting auto-delete settings:', error);
    throw error;
  }
}

export async function updateAutoDeleteSettings(updates: {
  isEnabled?: boolean;
  stopBeforeHours?: number;
  scheduleIntervalMinutes?: number;
  lastRunAt?: Date;
  nextRunAt?: Date;
  totalRuns?: number;
  totalEventsDeleted?: number;
  lastRunStats?: {
    eventsChecked: number;
    eventsDeleted: number;
    eventsStopped: number;
    deletedEventIds: string[];
    errors: string[];
  };
}) {
  await dbConnect();
  try {
    const result = await AutoDeleteSettings.findOneAndUpdate(
      {},
      { ...updates, updatedAt: new Date() },
      { new: true, upsert: true }
    ).lean();
    return JSON.parse(JSON.stringify(result));
  } catch (error) {
    console.error('Error updating auto-delete settings:', error);
    throw error;
  }
}

// Auto-Delete Functions
export async function runAutoDelete() {
  try {
    const settings = await getAutoDeleteSettings();
    if (!settings.isEnabled) {
      return {
        success: false,
        message: 'Auto-delete is disabled'
      };
    }

    const stats = await deleteExpiredEvents(settings.stopBeforeHours);
    
    // Update settings with run statistics
    const intervalMinutes = settings.scheduleIntervalMinutes || 15;
    const nextRunDate = new Date(Date.now() + intervalMinutes * 60 * 1000);
    await updateAutoDeleteSettings({
      lastRunAt: new Date(),
      ...(isNaN(nextRunDate.getTime()) ? {} : { nextRunAt: nextRunDate }),
      totalRuns: (settings.totalRuns || 0) + 1,
      totalEventsDeleted: settings.totalEventsDeleted + stats.eventsDeleted,
      lastRunStats: {
        eventsChecked: stats.totalEventsChecked,
        eventsDeleted: stats.eventsDeleted,
        eventsStopped: stats.eventsStopped,
        deletedEventIds: stats.deletedEventIds,
        errors: stats.errors
      }
    });

    return {
      success: true,
      message: `Auto-delete completed. Stopped ${stats.eventsStopped} events and cleared inventory for ${stats.eventsDeleted} events.`,
      stats
    };
  } catch (error) {
    console.error('Error running auto-delete:', error);
    return {
      success: false,
      message: `Auto-delete failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export async function getAutoDeletePreview(stopBeforeHours?: number) {
  try {
    const settings = await getAutoDeleteSettings();
    const hours = stopBeforeHours ?? settings.stopBeforeHours;
    const preview = await getExpiredEventsStats(hours);
    
    return {
      ...preview,
      stopBeforeHours: hours
    };
  } catch (error) {
    console.error('Error getting auto-delete preview:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      count: 0,
      events: []
    };
  }
}
