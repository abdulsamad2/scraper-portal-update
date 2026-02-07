'use server';

import dbConnect from '@/lib/dbConnect';
import { ConsecutiveGroup } from '@/models/seatModel'; // Assuming models are aliased to @/models
import { Event } from '@/models/eventModel'; // Assuming models are aliased to @/models
import { UpdateQuery } from 'mongoose';
import { revalidatePath } from 'next/cache';
import { clearInventoryFromSync } from './csvActions';

/**
 * Creates a new consecutive seat group.
 * @param {object} groupData - The data for the new group.
 * @returns {Promise<object>} The created group object or an error object.
 */
export async function createConsecutiveGroup(groupData: {
  section: string;
  row: string;
  mapping_id: string;
  event_name: string;
  venue_name: string;
  eventId: string;
  inventory: {
    quantity: number;
    seats: string[];
  };
}) {
  await dbConnect();
  try {
    const newGroup = new ConsecutiveGroup(groupData);
    const savedGroup = await newGroup.save();
    revalidatePath('/seat-groups'); // Adjust path as needed
    revalidatePath(`/seat-groups/${savedGroup._id}`);
    return JSON.parse(JSON.stringify(savedGroup));
  } catch (error: unknown) {
    console.error('Error creating consecutive group:', error);
    return { error: error instanceof Error ? error.message : 'Failed to create consecutive group' };
  }
}

/**
 * Retrieves all consecutive groups with pagination and optimization.
 * @param {number} limit - Optional limit for number of results
 * @param {number} skip - Optional number of results to skip
 * @returns {Promise<Array<object>>} An array of group objects or an error object.
 */
export async function getAllConsecutiveGroups(limit?: number, skip?: number) {
  await dbConnect();
  try {
    let query = ConsecutiveGroup.find({});
    
    // Add lean() for better performance - returns plain JS objects instead of Mongoose documents
    query = query.lean();
    
    // Add pagination if provided
    if (skip !== undefined) {
      query = query.skip(skip);
    }
    // Set default limit to 100 if not provided
    const resultLimit = limit !== undefined ? limit : 100;
    query = query.limit(resultLimit);
    
    const groups = await query;
    return JSON.parse(JSON.stringify(groups));
  } catch (error: unknown) {
    console.error('Error fetching all consecutive groups:', error);
    return { error: error instanceof Error ? error.message : 'Failed to fetch consecutive groups' };
  }
}

/**
 * Retrieves a single consecutive group by its ID.
 * @param {string} groupId - The ID of the group to retrieve.
 * @returns {Promise<object|null>} The group object or null if not found, or an error object.
 */
export async function getConsecutiveGroupById(groupId: string) {
  await dbConnect();
  try {
    const group = await ConsecutiveGroup.findById(groupId);
    if (!group) {
      return null;
    }
    return JSON.parse(JSON.stringify(group));
  } catch (error: Error | unknown) {
    console.error('Error fetching consecutive group by ID:', error);
    return { error:'Failed to fetch consecutive group' };
  }
}

/**
 * Updates an existing consecutive group.
 * @param {string} groupId - The ID of the group to update.
 * @param {object} updateData - An object containing the fields to update.
 * @returns {Promise<object|null>} The updated group object or null if not found, or an error object.
 */
export async function updateConsecutiveGroup(groupId: string, updateData: UpdateQuery<typeof ConsecutiveGroup> | undefined) {
  await dbConnect();
  try {
    const updatedGroup = await ConsecutiveGroup.findByIdAndUpdate(groupId, updateData, {
      new: true,
      runValidators: true,
    });
    if (!updatedGroup) {
      return null;
    }
    revalidatePath('/seat-groups');
    revalidatePath(`/seat-groups/${groupId}`);
    return JSON.parse(JSON.stringify(updatedGroup));
  } catch (error: unknown) {
    console.error('Error updating consecutive group:', error);
    return { error: error instanceof Error ? error.message : 'Failed to update consecutive group' };
  }
}

/**
 * Deletes a consecutive group by its ID.
 * @param {string} groupId - The ID of the group to delete.
 * @returns {Promise<object>} A success message or an error object.
 */
export async function deleteConsecutiveGroup(groupId: string) {
  await dbConnect();
  try {
    const deletedGroup = await ConsecutiveGroup.findByIdAndDelete(groupId);
    if (!deletedGroup) {
      return { message: 'Consecutive group not found', success: false };
    }
    revalidatePath('/seat-groups');
    return { message: 'Consecutive group deleted successfully', success: true, deletedGroup: JSON.parse(JSON.stringify(deletedGroup)) };
  } catch (error: unknown) {
    console.error('Error deleting consecutive group:', error);
    return { error: error instanceof Error ? error.message : 'Failed to delete consecutive group', success: false };
  }
}

/**
 * Retrieves consecutive groups by eventId.
 * @param {string} eventId - The eventId to filter groups by.
 * @returns {Promise<Array<object>>} An array of group objects or an error object.
 */
export async function getConsecutiveGroupsByEventId(eventId: string) {
  await dbConnect();
  try {
    const groups = await ConsecutiveGroup.find({ eventId: eventId });
    return JSON.parse(JSON.stringify(groups));
  } catch (error: unknown) {
    console.error('Error fetching consecutive groups by eventId:', error);
    return { error: error instanceof Error ? error.message : 'Failed to fetch groups for event' };
  }
}

/**
 * Retrieves consecutive groups with pagination and optional search.
 */
interface FilterOptions {
  event?: string;
  mapping?: string;
  section?: string;
  row?: string;
}

export async function getConsecutiveGroupsPaginated(
  limit: number = 50, 
  page: number = 1, 
  searchTerm: string = '',
  filters?: FilterOptions
) {
  await dbConnect();
  try {
    const query: Record<string, unknown> = {};
    const conditions: Record<string, unknown>[] = [];
    
    // Handle general search term
    if (searchTerm) {
      const regex = new RegExp(searchTerm, 'i');
      const orConditions: Record<string, unknown>[] = [
        { section: regex },
        { row: regex },
        { mapping_id: regex },
        { event_name: regex },
        { venue_name: regex },
      ];

      // Handle inventory ID search - check if searchTerm is numeric
      const numericSearchTerm = parseInt(searchTerm, 10);
      if (!isNaN(numericSearchTerm)) {
        // Exact match for numeric inventory ID
        orConditions.push({ 'inventory.inventoryId': numericSearchTerm });
      } else if (searchTerm.match(/^\d+/)) {
        // Partial numeric match - convert inventory ID to string for regex
        orConditions.push({
          $expr: {
            $regexMatch: {
              input: { $toString: "$inventory.inventoryId" },
              regex: searchTerm,
              options: "i"
            }
          }
        });
      }

      conditions.push({ $or: orConditions });
    }
    
    // Handle specific filters
    if (filters) {
      if (filters.event) {
        const regex = new RegExp(filters.event, 'i');
        conditions.push({ event_name: regex });
      }
      if (filters.mapping) {
        const regex = new RegExp(filters.mapping, 'i');
        conditions.push({ mapping_id: regex });
      }
      if (filters.section) {
        const regex = new RegExp(filters.section, 'i');
        conditions.push({ section: regex });
      }
      if (filters.row) {
        const regex = new RegExp(filters.row, 'i');
        conditions.push({ row: regex });
      }
    }
    
    // Combine all conditions
    if (conditions.length > 0) {
      query.$and = conditions;
    }
    const total = await ConsecutiveGroup.countDocuments(query);
    const qtyAgg = await ConsecutiveGroup.aggregate([
      { $match: query },
      { $group: { _id: null, seats: { $sum: "$inventory.quantity" } } },
    ]);
    const totalQuantity = qtyAgg[0]?.seats || 0;

    // Fetch groups for this page
    const groups = await ConsecutiveGroup.find(query)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // Serialize the data to ensure it's a plain object for client components.
    // This converts ObjectIds, Dates, etc., to strings.
    const plainGroups = JSON.parse(JSON.stringify(groups));

    return { groups: plainGroups, total, totalQuantity };
  } catch (error: Error | unknown) {
    console.error('Error fetching paginated consecutive groups:', error);
    return { error: error instanceof Error ? error.message : 'Failed to fetch paginated groups' };
  }
}

/**
 * Deletes all consecutive groups by eventId.
 * @param {string} eventId - The eventId to delete groups for.
 * @returns {Promise<object>} A success message with count of deleted groups or an error object.
 */
export async function deleteConsecutiveGroupsByEventId(eventId: string) {
  await dbConnect();
  try {
    console.log('Attempting to delete consecutive groups for eventId:', eventId);
    
    // First, check how many groups exist for this event
    const existingCount = await ConsecutiveGroup.countDocuments({ eventId: eventId });
    console.log(`Found ${existingCount} consecutive groups for eventId: ${eventId}`);
    
    const deleteResult = await ConsecutiveGroup.deleteMany({ eventId: eventId });
    console.log('Delete result:', deleteResult);
    
    // Also clear inventory from sync service
    if (deleteResult.deletedCount > 0) {
      console.log('Clearing inventory from sync service...');
      try {
        const syncResult = await clearInventoryFromSync();
        console.log('Sync clear result:', syncResult);
        if (!syncResult.success) {
          console.warn('Failed to clear sync inventory:', syncResult.message);
        }
      } catch (syncError) {
        console.error('Error clearing sync inventory:', syncError);
        // Don't fail the entire operation if sync clearing fails
      }
    }
    
    revalidatePath('/seat-groups');
    return { 
      message: `Successfully deleted ${deleteResult.deletedCount} consecutive seat groups for event and cleared sync inventory`, 
      success: true, 
      deletedCount: deleteResult.deletedCount 
    };
  } catch (error: unknown) {
    console.error('Error deleting consecutive groups by eventId:', error);
    return { error: error instanceof Error ? error.message : 'Failed to delete consecutive groups for event', success: false };
  }
}

/**
 * Deletes all consecutive groups for multiple events by their eventIds.
 * @param {string[]} eventIds - Array of eventIds to delete groups for.
 * @returns {Promise<object>} A success message with count of deleted groups or an error object.
 */
export async function deleteConsecutiveGroupsByEventIds(eventIds: string[]) {
  await dbConnect();
  try {
    const deleteResult = await ConsecutiveGroup.deleteMany({ eventId: { $in: eventIds } });
    
    // Also clear inventory from sync service if any groups were deleted
    if (deleteResult.deletedCount > 0) {
      console.log('Clearing inventory from sync service after bulk deletion...');
      try {
        const syncResult = await clearInventoryFromSync();
        console.log('Sync clear result:', syncResult);
        if (!syncResult.success) {
          console.warn('Failed to clear sync inventory:', syncResult.message);
        }
      } catch (syncError) {
        console.error('Error clearing sync inventory:', syncError);
        // Don't fail the entire operation if sync clearing fails
      }
    }
    
    revalidatePath('/seat-groups');
    revalidatePath('/dashboard/inventory');
    return { 
      message: `Successfully deleted ${deleteResult.deletedCount} consecutive seat groups for ${eventIds.length} events and cleared sync inventory`, 
      success: true, 
      deletedCount: deleteResult.deletedCount 
    };
  } catch (error: unknown) {
    console.error('Error deleting consecutive groups by eventIds:', error);
    return { error: error instanceof Error ? error.message : 'Failed to delete consecutive groups for events', success: false };
  }
}


export async function deleteStaleInventory() {
  await dbConnect();
  // This function handles two types of stale inventory:
  // 1. Events with Skip_Scraping = true (inactive events)
  // 2. Orphaned inventory where the event no longer exists in the database
  // This is a cleanup operation to remove stale inventory
  // This should be run periodically or manually by an admin
  try {
    console.log('Starting stale inventory cleanup...');
    
    let totalDeletedCount = 0;
    const cleanupResults = [];
    
    // PART 1: Find events with Skip_Scraping = true (inactive events)
    const inactiveEvents = await Event.find({ Skip_Scraping: true }, 'Event_ID');
    console.log(`Found ${inactiveEvents.length} events with Skip_Scraping = true`);
    
    if (inactiveEvents.length > 0) {
      const inactiveEventIds = inactiveEvents.map(event => event.Event_ID);
      console.log('Inactive Event IDs to clean up:', inactiveEventIds);
      
      // Delete all consecutive groups for inactive events
      const inactiveDeleteResult = await deleteConsecutiveGroupsByEventIds(inactiveEventIds);
      totalDeletedCount += inactiveDeleteResult.deletedCount || 0;
      cleanupResults.push(`Deleted ${inactiveDeleteResult.deletedCount} groups for ${inactiveEventIds.length} inactive events`);
    }
    
    // PART 2: Find orphaned inventory (events that no longer exist)
    console.log('Checking for orphaned inventory...');
    
    // Get all unique eventIds from consecutive groups
    const distinctEventIds = await ConsecutiveGroup.distinct('eventId');
    console.log(`Found ${distinctEventIds.length} unique eventIds in consecutive groups`);
    
    if (distinctEventIds.length > 0) {
      // Find which of these eventIds don't exist in the Event collection
      // Note: eventId in ConsecutiveGroup corresponds to Event_ID in Event collection
      const existingEventIds = await Event.find({ Event_ID: { $in: distinctEventIds } }, 'Event_ID');
      const existingEventIdStrings = existingEventIds.map(event => event.Event_ID);
      
      // Find orphaned eventIds (exist in consecutive groups but not in events)
      const orphanedEventIds = distinctEventIds.filter(eventId => 
        !existingEventIdStrings.includes(eventId)
      );
      
      console.log(`Found ${orphanedEventIds.length} orphaned eventIds:`, orphanedEventIds);
      
      if (orphanedEventIds.length > 0) {
        // Delete consecutive groups for orphaned events
        const orphanedDeleteResult = await deleteConsecutiveGroupsByEventIds(orphanedEventIds);
        totalDeletedCount += orphanedDeleteResult.deletedCount || 0;
        cleanupResults.push(`Deleted ${orphanedDeleteResult.deletedCount} groups for ${orphanedEventIds.length} orphaned events`);
      }
    }
    
    // SUMMARY
    if (totalDeletedCount === 0) {
      console.log('No stale inventory found');
      return { message: 'No stale inventory found', success: true, deletedCount: 0 };
    }
    
    const summaryMessage = `Successfully cleaned up stale inventory: ${cleanupResults.join(', ')}`;
    console.log('Cleanup completed:', summaryMessage);
    
    return { 
      message: summaryMessage, 
      success: true, 
      deletedCount: totalDeletedCount,
      details: cleanupResults
    };
  } catch (error: unknown) {
    console.error('Error deleting stale inventory:', error);
    return { error: error instanceof Error ? error.message : 'Failed to delete stale inventory', success: false };
  }
}
