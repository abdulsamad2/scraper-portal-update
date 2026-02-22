'use server';

/**
 * Auto-Delete Service for Upcoming Events (Timezone-Aware)
 * 
 * This service automatically stops scraping and deletes events before they take place.
 * 
 * KEY: Timezone is AUTO-DETECTED from the Venue field. No manual timezone input needed.
 * 
 * For each event, the system:
 *   1. Reads the Venue field (e.g., "Hard Rock Stadium", "Miami", "Dallas TX")
 *   2. Auto-detects the timezone from venue/city/state
 *   3. Gets the CURRENT local time in that timezone
 *   4. Compares: if (local_now + stopBeforeHours) >= event_time → stop & delete
 * 
 * Example: Event in Miami at 7pm, stopBeforeHours=2
 *   - Current time in Miami (Eastern): 5:00pm
 *   - Cutoff = 5pm + 2h = 7pm
 *   - Event(7pm) <= Cutoff(7pm) → STOP & DELETE
 */

import dbConnect from '@/lib/dbConnect';
import { Event } from '@/models/eventModel';
import { deleteConsecutiveGroupsByEventIds } from './seatActions';
import { createErrorLog } from './errorLogActions';
import { shouldStopEvent, detectTimezoneFromVenue, getTimezoneAbbr, getCurrentTimeInTimezone } from '@/lib/timezone';

export interface AutoDeleteStats {
  totalEventsChecked: number;
  eventsDeleted: number;
  eventsStopped: number;
  deletedEventIds: string[];
  errors: string[];
  lastRunAt: Date;
}

/**
 * Stops scraping and deletes events based on timezone-aware time comparison.
 * Each event's timezone is auto-detected from its Venue field.
 * 
 * @param stopBeforeHours - Hours before event time to stop and delete (e.g., 2 = delete 2h before event)
 * @returns Promise<AutoDeleteStats>
 */
export async function deleteExpiredEvents(stopBeforeHours: number = 2): Promise<AutoDeleteStats> {
  await dbConnect();
  
  const stats: AutoDeleteStats = {
    totalEventsChecked: 0,
    eventsDeleted: 0,
    eventsStopped: 0,
    deletedEventIds: [],
    errors: [],
    lastRunAt: new Date()
  };

  try {
    // Fetch ALL events — we need to check each one against its own timezone
    const allEvents = await Event.find({})
      .select('_id Event_ID Event_Name Event_DateTime Venue Skip_Scraping');

    stats.totalEventsChecked = allEvents.length;

    if (allEvents.length === 0) {
      console.log('Auto-delete: No events in database');
      return stats;
    }

    // Check each event against its venue's timezone
    const eventsToDelete = [];
    const skippedEvents = [];
    for (const event of allEvents) {
      const venue = event.Venue || '';
      const result = shouldStopEvent(event.Event_DateTime, venue, stopBeforeHours);
      
      if (!result) {
        // Timezone could not be detected from venue — skip this event
        skippedEvents.push(event);
        continue;
      }
      
      if (result.shouldStop) {
        eventsToDelete.push({
          event,
          timezone: result.timezone,
          localNow: result.localNow,
          cutoff: result.cutoff,
        });
      }
    }

    if (skippedEvents.length > 0) {
      console.warn(`Auto-delete: Skipped ${skippedEvents.length} events — timezone could not be detected from venue:`);
      for (const e of skippedEvents) {
        console.warn(`  ⚠ ${e.Event_ID} | ${e.Event_Name} | Venue: "${e.Venue || '(empty)'}"`);
      }
    }

    stats.eventsDeleted = eventsToDelete.length;

    if (eventsToDelete.length === 0) {
      console.log('Auto-delete: No events found within the stop window (timezone-aware check)');
      return stats;
    }

    const eventIds = eventsToDelete.map(e => e.event._id.toString());
    const eventMappings = eventsToDelete.map(e => e.event.Event_ID);
    stats.deletedEventIds = eventMappings;

    // Count how many were not already stopped
    const notYetStopped = eventsToDelete.filter(e => !e.event.Skip_Scraping);
    stats.eventsStopped = notYetStopped.length;

    // Log what we're doing with timezone info
    console.log(`Auto-delete (timezone-aware): Found ${eventsToDelete.length} events to stop & delete:`);
    for (const e of eventsToDelete) {
      const tz = getTimezoneAbbr(e.timezone);
      console.log(`  → ${e.event.Event_ID} | ${e.event.Event_Name} | Event: ${e.event.Event_DateTime.toISOString()} | Venue: ${e.event.Venue} | TZ: ${tz} | Local now: ${e.localNow.toISOString()} | Cutoff: ${e.cutoff.toISOString()}`);
    }

    // Stop scraping first
    if (notYetStopped.length > 0) {
      try {
        await Event.updateMany(
          { _id: { $in: eventIds } },
          { $set: { Skip_Scraping: true } }
        );
        console.log(`Auto-delete: Stopped scraping for ${notYetStopped.length} events`);
      } catch (error) {
        const errorMsg = `Failed to stop scraping: ${(error as Error).message}`;
        stats.errors.push(errorMsg);
        console.error('Auto-delete stop scraping error:', error);
      }
    }

    // Delete associated seat data first
    try {
      await deleteConsecutiveGroupsByEventIds(eventIds);
      console.log(`Auto-delete: Deleted seat data for ${eventIds.length} events`);
    } catch (error) {
      const errorMsg = `Failed to delete seat data: ${(error as Error).message}`;
      stats.errors.push(errorMsg);
      console.error('Auto-delete seat deletion error:', error);
      
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

    console.log(`Auto-delete: Successfully stopped and deleted ${deleteResult.deletedCount} events`);

    // Log successful deletion with timezone details
    await createErrorLog({
      errorType: 'AUTO_DELETE_SUCCESS',
      errorMessage: `Auto-deleted ${deleteResult.deletedCount} events (${stopBeforeHours}h before event time, timezone-aware)`,
      stackTrace: '',
      metadata: { 
        deletedEvents: eventsToDelete.map(e => ({
          id: e.event.Event_ID,
          name: e.event.Event_Name,
          dateTime: e.event.Event_DateTime,
          venue: e.event.Venue,
          detectedTimezone: e.timezone,
          localTimeAtDeletion: e.localNow.toISOString(),
        })),
        stopBeforeHours,
      }
    });

  } catch (error) {
    const errorMsg = `Auto-delete operation failed: ${(error as Error).message}`;
    stats.errors.push(errorMsg);
    console.error('Auto-delete error:', error);
    
    await createErrorLog({
      errorType: 'AUTO_DELETE_ERROR',
      errorMessage: errorMsg,
      stackTrace: (error as Error).stack || '',
      metadata: { stopBeforeHours }
    });
  }

  return stats;
}

/**
 * Gets statistics about events that would be stopped and deleted (dry run / preview)
 * Uses timezone-aware comparison per event.
 * 
 * @param stopBeforeHours - Hours before event time to stop and delete
 * @returns Preview data with timezone info per event
 */
export async function getExpiredEventsStats(stopBeforeHours: number = 2) {
  await dbConnect();
  
  try {
    // Fetch all events and check each against its venue timezone
    const allEvents = await Event.find({})
      .select('Event_ID Event_Name Event_DateTime Venue Skip_Scraping').lean();

    const eventsToDelete = [];
    const eventsSafe = [];
    const eventsSkipped = [];

    for (const event of allEvents) {
      const venue = event.Venue || '';
      const result = shouldStopEvent(event.Event_DateTime, venue, stopBeforeHours);
      const tz = detectTimezoneFromVenue(venue);
      
      if (!result || !tz) {
        // Timezone undetectable — show in preview as skipped
        eventsSkipped.push({
          id: event.Event_ID,
          name: event.Event_Name,
          dateTime: event.Event_DateTime,
          venue: event.Venue,
          isStopped: event.Skip_Scraping,
          detectedTimezone: 'N/A',
          localTimeNow: null,
        });
        continue;
      }

      const localNow = getCurrentTimeInTimezone(tz);
      
      const eventInfo = {
        id: event.Event_ID,
        name: event.Event_Name,
        dateTime: event.Event_DateTime,
        venue: event.Venue,
        isStopped: event.Skip_Scraping,
        detectedTimezone: getTimezoneAbbr(tz),
        localTimeNow: localNow.toISOString(),
      };

      if (result.shouldStop) {
        eventsToDelete.push(eventInfo);
      } else {
        eventsSafe.push(eventInfo);
      }
    }

    return {
      success: true,
      count: eventsToDelete.length,
      totalEvents: allEvents.length,
      skippedCount: eventsSkipped.length,
      stopBeforeHours,
      events: eventsToDelete,
      safeEvents: eventsSafe,
      skippedEvents: eventsSkipped,
    };
  } catch (error) {
    console.error('Error getting events stats for auto-delete:', error);
    return {
      success: false,
      error: (error as Error).message,
      count: 0,
      events: []
    };
  }
}