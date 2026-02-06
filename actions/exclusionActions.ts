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

export interface ExclusionRulesData {
  eventId: string;
  eventName: string;
  sectionRowExclusions: SectionRowExclusion[];
  isActive: boolean;
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

