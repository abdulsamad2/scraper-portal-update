'use server';

/**
 * Event Actions with Automatic Seat Deletion
 * 
 * This module handles event CRUD operations and automatically deletes associated
 * seat model data (ConsecutiveGroups) in the following scenarios:
 * 
 * 1. When an event is deleted (deleteEvent)
 * 2. When scraping is stopped for an event (updateEvent with Skip_Scraping: true)
 * 3. When price percentage is updated for an event (updateEvent with priceIncreasePercentage)
 * 4. When scraping is stopped for all events (updateAllEvents with status: true)
 * 
 * This ensures that seat inventory data is automatically cleaned up when events
 * are stopped, modified, or deleted, preventing stale data accumulation.
 */

import dbConnect from '@/lib/dbConnect';
import { Event } from '@/models/eventModel'; // Assuming models are aliased to @/models
import { ConsecutiveGroup } from '@/models/seatModel';
import { deleteConsecutiveGroupsByEventId, deleteConsecutiveGroupsByEventIds } from './seatActions';

/**
 * Creates a new event.
 * @param {object} eventData - The data for the new event.
 * @returns {Promise<object>} The created event object or an error object.
 */
export async function createEvent(eventData: Partial<Event>) {
  await dbConnect();
  try {
    const newEvent = new Event(eventData);
    const savedEvent = await newEvent.save();
    return JSON.parse(JSON.stringify(savedEvent));
  } catch (error:unknown) {
    console.error('Error creating event:', error);
    return { error: (error as Error).message || 'Failed to create event' };
  }
}

/**
 * Retrieves a single event by its ID.
 * @param {string} eventId - The ID of the event to retrieve.
 * @returns {Promise<object|null>} The event object or null if not found, or an error object.
 */
export async function getEventById(eventId: string): Promise<object | null> {
  await dbConnect();
  try {
    const event = await Event.findOne({
      _id: eventId,
    });
    if (!event) {
      console.error('Event not found with ID:', eventId);
      return null;
    }
    return JSON.parse(JSON.stringify(event));
  } catch (error) {
    console.error('Error fetching event by ID:', eventId, error);
    return { error: (error as Error).message || 'Failed to fetch event' };
  }
}

/**
 * Retrieves all events.
 * @returns {Promise<Array<object>>} An array of event objects or an error object.
 */
export async function getAllEvents(): Promise<Array<object>> {
  await dbConnect();
  try {
    const events = await Event.find({});
    return JSON.parse(JSON.stringify(events));
  } catch (error) {
    console.error('Error fetching all events:', error);
    return [{ error: (error as Error).message || 'Failed to fetch events' }];
  }
}

/**
 * Retrieves paginated events with optional search and filters.
 * @param {number} page - The page number (1-based)
 * @param {number} limit - The number of events per page
 * @param {string} search - Optional search term to filter events
 * @param {object} filters - Optional filters for date, venue, status, etc.
 * @returns {Promise<{events: Array<object>, total: number, page: number, totalPages: number}>} Paginated events data
 */
export async function getPaginatedEventsAdvanced(page: number = 1, limit: number = 100, search: string = '', filters: any = {}) {
  await dbConnect();
  try {
    const skip = (page - 1) * limit;
    
    // Build search query
    const searchConditions = [];
    if (search.trim()) {
      const searchRegex = { $regex: search.trim(), $options: 'i' };
      searchConditions.push({
        $or: [
          { Event_Name: searchRegex },
          { Venue: searchRegex },
          { mapping_id: searchRegex },
          { Event_ID: searchRegex },
        ]
      });
    }

    // Build filter conditions
    const filterConditions = [];
    
    // Date range filter
    if (filters.dateFrom || filters.dateTo) {
      const dateFilter: any = {};
      if (filters.dateFrom) dateFilter.$gte = new Date(filters.dateFrom);
      if (filters.dateTo) {
        // include the full end day
        const end = new Date(filters.dateTo);
        end.setHours(23, 59, 59, 999);
        dateFilter.$lte = end;
      }
      filterConditions.push({ Event_DateTime: dateFilter });
    }

    // Venue filter (only when not already covered by search)
    if (filters.venue && !search.trim()) {
      filterConditions.push({ Venue: { $regex: filters.venue.trim(), $options: 'i' } });
    } else if (filters.venue && search.trim()) {
      // venue filter is separate from free-text search
      filterConditions.push({ Venue: { $regex: filters.venue.trim(), $options: 'i' } });
    }

    // Scraping status filter
    if (filters.scrapingStatus === 'active') {
      filterConditions.push({ $or: [{ Skip_Scraping: false }, { Skip_Scraping: { $exists: false } }] });
    } else if (filters.scrapingStatus === 'inactive') {
      filterConditions.push({ Skip_Scraping: true });
    }

    // Available seats filter
    if (filters.hasAvailableSeats === 'yes') {
      filterConditions.push({ Available_Seats: { $gt: 0 } });
    } else if (filters.hasAvailableSeats === 'no') {
      filterConditions.push({ $or: [{ Available_Seats: 0 }, { Available_Seats: { $exists: false } }] });
    }

    // Seat range filter
    if (filters.seatRange?.min || filters.seatRange?.max) {
      const seatFilter: any = {};
      if (filters.seatRange.min) seatFilter.$gte = parseInt(filters.seatRange.min);
      if (filters.seatRange.max) seatFilter.$lte = parseInt(filters.seatRange.max);
      filterConditions.push({ Available_Seats: seatFilter });
    }

    // Combine all conditions
    let query = {};
    const allConditions = [...searchConditions, ...filterConditions];
    if (allConditions.length > 0) {
      query = { $and: allConditions };
    }

    // Build sort criteria - Default to last updated (most recent first)
    let sortCriteria: any = { Last_Updated: -1, updatedAt: -1 }; // Default sort by last updated
    switch (filters.sortBy) {
      case 'newest':
        sortCriteria = { createdAt: -1 };
        break;
      case 'oldest':
        sortCriteria = { createdAt: 1 };
        break;
      case 'name':
        sortCriteria = { Event_Name: 1 };
        break;
      case 'seats':
        sortCriteria = { Available_Seats: -1 };
        break;
      case 'date':
        sortCriteria = { Event_DateTime: -1 };
        break;
      case 'updated':
      default:
        sortCriteria = { Last_Updated: -1, updatedAt: -1 };
    }

    // Get total count for pagination
    const total = await Event.countDocuments(query);
    
    // Get paginated events
    const events = await Event.find(query)
      .sort(sortCriteria)
      .skip(skip)
      .limit(limit)
      .lean(); // Use lean() for better performance

    const totalPages = Math.ceil(total / limit);

    return {
      events: JSON.parse(JSON.stringify(events)),
      total,
      page,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1
    };
  } catch (error) {
    console.error('Error fetching paginated events:', error);
    return {
      events: [],
      total: 0,
      page: 1,
      totalPages: 0,
      hasNextPage: false,
      hasPrevPage: false,
      error: (error as Error).message || 'Failed to fetch events'
    };
  }
}

/**
 * Returns total event count and active (scraping on) event count.
 */
export async function getEventCounts(): Promise<{ total: number; active: number }> {
  await dbConnect();
  try {
    const [total, active] = await Promise.all([
      Event.countDocuments({}),
      Event.countDocuments({ $or: [{ Skip_Scraping: false }, { Skip_Scraping: { $exists: false } }] }),
    ]);
    return { total, active };
  } catch {
    return { total: 0, active: 0 };
  }
}

/**
 * Returns per-event standard and resale inventory quantities for a set of mapping_ids.
 * Standard = splitType 'NEVERLEAVEONE', Resale = everything else.
 */
export async function getInventoryCountsByType(
  mappingIds: string[]
): Promise<Record<string, { standard: number; resale: number; standardRows: number; resaleRows: number }>> {
  if (!mappingIds.length) return {};
  await dbConnect();
  try {
    const result = await ConsecutiveGroup.aggregate([
      { $match: { mapping_id: { $in: mappingIds } } },
      {
        $group: {
          _id: '$mapping_id',
          standard: {
            $sum: {
              $cond: [
                { $eq: ['$inventory.splitType', 'NEVERLEAVEONE'] },
                '$inventory.quantity',
                0,
              ],
            },
          },
          resale: {
            $sum: {
              $cond: [
                { $ne: ['$inventory.splitType', 'NEVERLEAVEONE'] },
                '$inventory.quantity',
                0,
              ],
            },
          },
          standardRows: {
            $sum: {
              $cond: [
                { $eq: ['$inventory.splitType', 'NEVERLEAVEONE'] },
                1,
                0,
              ],
            },
          },
          resaleRows: {
            $sum: {
              $cond: [
                { $ne: ['$inventory.splitType', 'NEVERLEAVEONE'] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);
    const map: Record<string, { standard: number; resale: number; standardRows: number; resaleRows: number }> = {};
    for (const row of result) {
      map[row._id] = { standard: row.standard, resale: row.resale, standardRows: row.standardRows, resaleRows: row.resaleRows };
    }
    return map;
  } catch (error) {
    console.error('Error fetching inventory counts by type:', error);
    return {};
  }
}

/**
 * Updates an existing event.
 * @param {string} eventId - The ID of the event to update.
 * @param {object} updateData - An object containing the fields to update.
 * @param {boolean} deleteSeatGroups - Whether to delete associated seat groups on certain updates.
 * @returns {Promise<object|null>} The updated event object or null if not found, or an error object.
 */
export async function updateEvent(eventId: string, updateData: Partial<Event> & { Skip_Scraping?: boolean; priceIncreasePercentage?: number }, deleteSeatGroups: boolean = false) {
  // Input validation
  if (!eventId || typeof eventId !== 'string') {
    return { error: 'Invalid event ID provided' };
  }
  
  if (!updateData || typeof updateData !== 'object') {
    return { error: 'Invalid update data provided' };
  }

  await dbConnect();
  try {
    // Get current event state to check if we're actually stopping scraping
    const currentEvent = await Event.findById(eventId).maxTimeMS(5000); // 5 second timeout
    if (!currentEvent) {
      return { error: 'Event not found' };
    }

    // Debug logging
    console.log('UpdateEvent Debug Info:', {
      eventId,
      currentSkipScraping: currentEvent.Skip_Scraping,
      newSkipScraping: updateData.Skip_Scraping,
      currentPercentage: currentEvent.priceIncreasePercentage,
      newPercentage: updateData.priceIncreasePercentage,
      deleteSeatGroups
    });

    // Check if we're stopping scraping (going from false/undefined to true) or updating price percentage
    const isStoppingScraping = updateData.Skip_Scraping === true && !currentEvent.Skip_Scraping;
    const isUpdatingPercentage = updateData.priceIncreasePercentage !== undefined && 
                                updateData.priceIncreasePercentage !== currentEvent.priceIncreasePercentage;
    
    const shouldDeleteSeats = deleteSeatGroups || isStoppingScraping || isUpdatingPercentage;

    console.log('Seat Deletion Logic:', {
      isStoppingScraping,
      isUpdatingPercentage,
      shouldDeleteSeats
    });

    // Delete seat groups if needed
    let seatDeletionResult = null;
    if (shouldDeleteSeats) {
      console.log('Deleting seat groups for event:', eventId);
      // Use Event_ID (not MongoDB _id) to match the ConsecutiveGroup eventId field
      seatDeletionResult = await deleteConsecutiveGroupsByEventId(currentEvent.Event_ID);
      console.log('Seat deletion result:', seatDeletionResult);
    }

    const updatedEvent = await Event.findByIdAndUpdate(eventId, updateData, {
      new: true, // Return the modified document rather than the original
      runValidators: true, // Ensure schema validations are run
    }).maxTimeMS(10000); // 10 second timeout
    
    if (!updatedEvent) {
      return { error: 'Failed to update event - event may have been deleted' };
    }
    
    const result = JSON.parse(JSON.stringify(updatedEvent));
    if (seatDeletionResult) {
      result.deletedSeatGroups = seatDeletionResult.deletedCount || 0;
    }
    
    return result;
  } catch (error) {
    console.error('Error updating event:', error);
    return { error: (error as Error).message || 'Failed to update event' };
  }
}

// Example of how to get an event by a different unique field, e.g., Event_ID
/**
 * Retrieves a single event by its Event_ID.
 * @param {string} eventSpecificId - The Event_ID of the event to retrieve.
 * @returns {Promise<object|null>} The event object or null if not found, or an error object.
 */
export async function getEventByEventIdString(eventSpecificId: string) {
  await dbConnect();
  try {
    const event = await Event.findOne({ Event_ID: eventSpecificId });
    if (!event) {
      return null;
    }
    return JSON.parse(JSON.stringify(event));
  } catch (error: unknown) {
    console.error('Error fetching event by Event_ID:', error);
    return { error: (error as Error).message || 'Failed to fetch event by Event_ID' };
  }
}

// You might also want a delete action:
/**
 * Deletes an event by its ID and all associated consecutive seat groups.
 * @param {string} eventId - The ID of the event to delete.
 * @returns {Promise<object>} A success message or an error object.
 */
export async function deleteEvent(eventId: string) {
  await dbConnect();
  try {
    // First, find the event to get its details before deletion
    const eventToDelete = await Event.findById(eventId);
    if (!eventToDelete) {
      return { message: 'Event not found', success: false };
    }

    // Delete all associated consecutive seat groups first using Event_ID (not MongoDB _id)
    const seatDeletionResult = await deleteConsecutiveGroupsByEventId(eventToDelete.Event_ID);
    
    // Delete the event
    const deletedEvent = await Event.findByIdAndDelete(eventId);
    
    return { 
      message: `Event deleted successfully. Also deleted ${seatDeletionResult.deletedCount || 0} associated seat groups.`, 
      success: true, 
      deletedEvent: JSON.parse(JSON.stringify(deletedEvent)),
      deletedSeatGroups: seatDeletionResult.deletedCount || 0
    };
  } catch (error) {
    console.error('Error deleting event:', error);
    return { error: (error as Error).message || 'Failed to delete event', success: false };
  }
}

export async function updateAllEvents(status: boolean){
  await dbConnect()
  try{
    // If we're stopping scraping (status = true), we need to delete all seat groups
    if (status === true) {
      // Get all Event_ID fields (not MongoDB _id) to match ConsecutiveGroup eventId field
      const events = await Event.find({}, 'Event_ID');
      const eventIds = events.map(event => event.Event_ID);
      
      // Delete all seat groups for all events efficiently
      const seatDeletionResult = await deleteConsecutiveGroupsByEventIds(eventIds);
      
      const updateEventsStatus = await Event.updateMany(
        {}, // Update all events
        { Skip_Scraping: status } // Set Skip_Scraping to the provided status
      );

      return {
        success: true,
        message: `Successfully updated ${updateEventsStatus.modifiedCount} events and deleted ${seatDeletionResult.deletedCount || 0} seat groups`,
        modifiedCount: updateEventsStatus.modifiedCount,
        deletedSeatGroups: seatDeletionResult.deletedCount || 0,
        status: status
      };
    } else {
      // Just update the events without deleting seats
      const updateEventsStatus = await Event.updateMany(
        {}, // Update all events
        { Skip_Scraping: status } // Set Skip_Scraping to the provided status
      );

      return {
        success: true,
        message: `Successfully updated ${updateEventsStatus.modifiedCount} events`,
        modifiedCount: updateEventsStatus.modifiedCount,
        status: status
      };
    }
  }catch(error){
    console.error('Error updating all events:', error);
    return {
      success: false,
      error: (error as Error).message || 'Failed to update events'
    }
  }
}