'use server';
import dbConnect from '../lib/dbConnect';
import { ExclusionRules } from '../models/exclusionRulesModel';
import { ConsecutiveGroup } from '../models/seatModel';
import { createErrorLog } from './errorLogActions';

export interface SectionRowExclusion {
  section: string;
  excludeEntireSection: boolean;
  excludedRows: string[];
}

export interface OutlierExclusion {
  enabled: boolean;
  percentageBelowAverage?: number;
  baselineListingsCount?: number;
}

export interface ExclusionRulesData {
  eventId: string;
  eventName: string;
  sectionRowExclusions: SectionRowExclusion[];
  outlierExclusion: OutlierExclusion;
  isActive: boolean;
}

// Get exclusion rules for an event
export async function getExclusionRules(eventId: string) {
  try {
    await dbConnect();
    const rules = await ExclusionRules.findOne({ eventId, isActive: true }).lean();
    return { success: true, data: rules };
  } catch (error) {
    console.error('Error fetching exclusion rules:', error);
    await createErrorLog(
      'EXCLUSION_RULES_FETCH_ERROR',
      `Failed to fetch exclusion rules for event ${eventId}`,
      error instanceof Error ? error.message : 'Unknown error',
      { eventId }
    );
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
        runValidators: true 
      }
    );

    return { success: true, data: updatedRules };
  } catch (error) {
    console.error('Error saving exclusion rules:', error);
    await createErrorLog(
      'EXCLUSION_RULES_SAVE_ERROR',
      `Failed to save exclusion rules for event ${rulesData.eventId}`,
      error instanceof Error ? error.message : 'Unknown error',
      { eventId: rulesData.eventId, rulesData }
    );
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
    await createErrorLog(
      'EXCLUSION_RULES_DELETE_ERROR',
      `Failed to delete exclusion rules for event ${eventId}`,
      error instanceof Error ? error.message : 'Unknown error',
      { eventId }
    );
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
    return { success: true, data: result };
  } catch (error) {
    console.error('Error fetching sections and rows:', error);
    await createErrorLog(
      'SECTIONS_ROWS_FETCH_ERROR',
      `Failed to fetch sections and rows for event ${eventId}`,
      error instanceof Error ? error.message : 'Unknown error',
      { eventId }
    );
    return { success: false, error: 'Failed to fetch sections and rows' };
  }
}

// Get pricing statistics for outlier detection
export async function getPricingStatistics(eventId: string) {
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
          _id: null,
          prices: { $push: '$inventory.listPrice' },
          totalListings: { $sum: 1 },
          avgPrice: { $avg: '$inventory.listPrice' },
          minPrice: { $min: '$inventory.listPrice' },
          maxPrice: { $max: '$inventory.listPrice' }
        }
      },
      {
        $project: {
          totalListings: 1,
          avgPrice: { $round: ['$avgPrice', 2] },
          minPrice: 1,
          maxPrice: 1,
          sortedPrices: { $sortArray: { input: '$prices', sortBy: 1 } }
        }
      }
    ];

    const result = await ConsecutiveGroup.aggregate(pipeline);
    
    if (result.length === 0) {
      return { success: true, data: null };
    }

    const stats = result[0];
    const sortedPrices = stats.sortedPrices;
    
    // Get baseline from lowest 3 prices
    const baselinePrices = sortedPrices.slice(0, 3);
    const baselineAvg = baselinePrices.reduce((a: any, b: any) => a + b, 0) / baselinePrices.length;
    
    return {
      success: true,
      data: {
        ...stats,
        baselineAverage: Math.round(baselineAvg * 100) / 100,
        lowestPrices: baselinePrices
      }
    };
  } catch (error) {
    console.error('Error fetching pricing statistics:', error);
    await createErrorLog(
      'PRICING_STATS_FETCH_ERROR',
      `Failed to fetch pricing statistics for event ${eventId}`,
      error instanceof Error ? error.message : 'Unknown error',
      { eventId }
    );
    return { success: false, error: 'Failed to fetch pricing statistics' };
  }
}