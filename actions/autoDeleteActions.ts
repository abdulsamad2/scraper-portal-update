'use server';

/**
 * Auto-Delete Service for Past Events
 * 
 * This service automatically deletes events that have already taken place.
 * Events are deleted with a grace period (default 15 hours after event end time).
 * 
 * Example: Event on September 11th at 9pm EST will be deleted on September 12th at 12pm EST (15 hours later)
 */

import dbConnect from '@/lib/dbConnect';
import { Event } from '@/models/eventModel';
import { deleteConsecutiveGroupsByEventIds } from './seatActions';
import { createErrorLog } from './errorLogActions';

export interface AutoDeleteStats {
  totalEventsChecked: number;
  eventsDeleted: number;
  deletedEventIds: string[];
  errors: string[];
  lastRunAt: Date;
}

/**
 * Deletes events that have passed their scheduled time plus grace period
 * @param graceHours - Hours to wait after event time before deletion (default: 15 hours)
 * @returns Promise<AutoDeleteStats> - Statistics about the deletion operation
 */
export async function deleteExpiredEvents(graceHours: number = 15): Promise<AutoDeleteStats> {
  await dbConnect();
  
  const stats: AutoDeleteStats = {
    totalEventsChecked: 0,
    eventsDeleted: 0,
    deletedEventIds: [],
    errors: [],
    lastRunAt: new Date()
  };

  try {
    // Calculate cutoff time (current time minus grace period)
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - graceHours);

    console.log(`Auto-delete: Looking for events before ${cutoffTime.toISOString()}`);

    // Find all events that have passed the cutoff time
    const expiredEvents = await Event.find({
      Event_DateTime: { $lt: cutoffTime }
    }).select('_id Event_ID Event_Name Event_DateTime');

    stats.totalEventsChecked = await Event.countDocuments();
    stats.eventsDeleted = expiredEvents.length;

    if (expiredEvents.length === 0) {
      console.log('Auto-delete: No expired events found');
      return stats;
    }

    // Extract event IDs for seat deletion
    const eventIds = expiredEvents.map(event => event._id.toString());
    const eventMappings = expiredEvents.map(event => event.Event_ID);
    stats.deletedEventIds = eventMappings;

    console.log(`Auto-delete: Found ${expiredEvents.length} expired events:`, eventMappings);

    // Delete associated seat data first
    try {
      await deleteConsecutiveGroupsByEventIds(eventIds);
      console.log(`Auto-delete: Deleted seat data for ${eventIds.length} events`);
    } catch (error) {
      const errorMsg = `Failed to delete seat data: ${(error as Error).message}`;
      stats.errors.push(errorMsg);
      console.error('Auto-delete seat deletion error:', error);
      
      // Log the error but continue with event deletion
      await createErrorLog({
        errorType: 'AUTO_DELETE_SEATS_ERROR',
        errorMessage: errorMsg,
        stackTrace: (error as Error).stack || '',
        metadata: { eventIds, eventMappings }
      });
    }

    // Delete the events
    const deleteResult = await Event.deleteMany({
      _id: { $in: eventIds }
    });

    console.log(`Auto-delete: Successfully deleted ${deleteResult.deletedCount} events`);

    // Log successful deletion
    await createErrorLog({
      errorType: 'AUTO_DELETE_SUCCESS',
      errorMessage: `Auto-deleted ${deleteResult.deletedCount} expired events`,
      stackTrace: '',
      metadata: { 
        deletedEvents: expiredEvents.map(e => ({
          id: e.Event_ID,
          name: e.Event_Name,
          dateTime: e.Event_DateTime
        })),
        graceHours,
        cutoffTime: cutoffTime.toISOString()
      }
    });

  } catch (error) {
    const errorMsg = `Auto-delete operation failed: ${(error as Error).message}`;
    stats.errors.push(errorMsg);
    console.error('Auto-delete error:', error);
    
    // Log the error
    await createErrorLog({
      errorType: 'AUTO_DELETE_ERROR',
      errorMessage: errorMsg,
      stackTrace: (error as Error).stack || '',
      metadata: { graceHours }
    });
  }

  return stats;
}

/**
 * Gets statistics about events that would be deleted (dry run)
 * @param graceHours - Hours to wait after event time before deletion
 * @returns Promise<{count: number, events: Array}>
 */
export async function getExpiredEventsStats(graceHours: number = 15) {
  await dbConnect();
  
  try {
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - graceHours);

    const expiredEvents = await Event.find({
      Event_DateTime: { $lt: cutoffTime }
    }).select('Event_ID Event_Name Event_DateTime Venue').lean();

    return {
      success: true,
      count: expiredEvents.length,
      cutoffTime: cutoffTime.toISOString(),
      events: expiredEvents.map(event => ({
        id: event.Event_ID,
        name: event.Event_Name,
        dateTime: event.Event_DateTime,
        venue: event.Venue
      }))
    };
  } catch (error) {
    console.error('Error getting expired events stats:', error);
    return {
      success: false,
      error: (error as Error).message,
      count: 0,
      events: []
    };
  }
}