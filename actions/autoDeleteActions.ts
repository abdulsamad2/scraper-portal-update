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
import { shouldStopEvent, shouldStopEventAsync, detectTimezoneFromVenue, detectTimezoneFromVenueAsync, getTimezoneAbbr, getCurrentTimeInTimezone } from '@/lib/timezone';
import { ensureTimeSynced, getTimeSyncStatus, getAccurateNow } from '@/lib/timeSync';
import { AutoDeleteSettings } from '@/models/autoDeleteModel';

/**
 * Format a Date as Pakistan Standard Time string (PKT = UTC+5)
 */
function formatAsPKT(date: Date): string {
  return date.toLocaleString('en-US', {
    timeZone: 'Asia/Karachi',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }) + ' PKT';
}

/**
 * Format a Date in a specific timezone for display
 */
function formatInTimezone(date: Date, timezone: string, abbr: string): string {
  return date.toLocaleString('en-US', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }) + ` ${abbr}`;
}

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
  
  // Sync clock with external time API before checking events
  await ensureTimeSynced();
  const syncStatus = getTimeSyncStatus();
  console.log(`Auto-delete: Clock sync status — offset: ${syncStatus.offsetSeconds}s, synced: ${syncStatus.isSynced}`);
  
  const stats: AutoDeleteStats = {
    totalEventsChecked: 0,
    eventsDeleted: 0,
    eventsStopped: 0,
    deletedEventIds: [],
    errors: [],
    lastRunAt: new Date()
  };

  try {
    // Only fetch events that are still active (not already stopped)
    // Since we no longer delete events, stopped events would be re-processed every cycle
    const allEvents = await Event.find({ Skip_Scraping: { $ne: true } })
      .select('_id Event_ID Event_Name Event_DateTime Venue Skip_Scraping');

    stats.totalEventsChecked = allEvents.length;

    if (allEvents.length === 0) {
      console.log('Auto-delete: No events in database');
      return stats;
    }

    // Check each event against its venue's timezone (async — with live API fallback)
    const eventsToDelete = [];
    const skippedEvents = [];
    for (const event of allEvents) {
      const venue = event.Venue || '';
      // Use async version for live API fallback covering all US cities
      const result = await shouldStopEventAsync(event.Event_DateTime, venue, stopBeforeHours);
      
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

    // Log what we're doing with timezone info (including PKT)
    const pktNow = formatAsPKT(getAccurateNow());
    console.log(`Auto-delete (timezone-aware): Found ${eventsToDelete.length} events to stop & delete (Current PKT: ${pktNow}):`);
    for (const e of eventsToDelete) {
      const tz = getTimezoneAbbr(e.timezone);
      const localTimeStr = formatInTimezone(getAccurateNow(), e.timezone, tz);
      console.log(`  → ${e.event.Event_ID} | ${e.event.Event_Name} | Event: ${e.event.Event_DateTime.toISOString()} | Venue: ${e.event.Venue} | TZ: ${tz} | Local now: ${localTimeStr} | PKT now: ${pktNow} | Cutoff: ${e.cutoff.toISOString()}`);
    }

    // Stop scraping for all matching events
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

    // Clear inventory (seat data) from DB and Sync — but keep the events themselves
    try {
      await deleteConsecutiveGroupsByEventIds(eventIds);
      console.log(`Auto-delete: Cleared inventory for ${eventIds.length} events`);
    } catch (error) {
      const errorMsg = `Failed to clear inventory: ${(error as Error).message}`;
      stats.errors.push(errorMsg);
      console.error('Auto-delete inventory clear error:', error);

      await createErrorLog({
        errorType: 'AUTO_DELETE_SEATS_ERROR',
        errorMessage: errorMsg,
        stackTrace: (error as Error).stack || '',
        metadata: { eventIds, eventMappings }
      });
    }

    console.log(`Auto-delete: Successfully stopped ${stats.eventsStopped} events and cleared inventory for ${eventIds.length} events (events kept in DB)`);

    // Build last-stopped records with dual timezone info
    const nowAccurate = getAccurateNow();
    const stoppedRecords = eventsToDelete.map(e => {
      const tz = getTimezoneAbbr(e.timezone);
      return {
        eventId: e.event.Event_ID,
        eventName: e.event.Event_Name,
        venue: e.event.Venue || '',
        eventDateTime: e.event.Event_DateTime,
        deletedAt: nowAccurate,
        detectedTimezone: e.timezone,
        timezoneAbbr: tz,
        localTimeAtDeletion: formatInTimezone(nowAccurate, e.timezone, tz),
        pktTimeAtDeletion: formatAsPKT(nowAccurate),
      };
    });

    // Save all stopped events to settings (prepend new, keep all)
    try {
      const currentSettings = await AutoDeleteSettings.findOne();
      const existing = currentSettings?.lastDeletedEvents || [];
      const merged = [...stoppedRecords, ...existing];
      await AutoDeleteSettings.findOneAndUpdate(
        {},
        { $set: { lastDeletedEvents: merged } },
        { upsert: true }
      );
    } catch (saveErr) {
      console.error('Auto-delete: Failed to save lastDeletedEvents:', saveErr);
    }

    // Log successful stop & inventory clear with timezone details (including PKT)
    await createErrorLog({
      errorType: 'AUTO_DELETE_SUCCESS',
      errorMessage: `Auto-stopped ${eventIds.length} events and cleared inventory (${stopBeforeHours}h before event time, timezone-aware)`,
      stackTrace: '',
      metadata: { 
        deletedEvents: eventsToDelete.map(e => {
          const tz = getTimezoneAbbr(e.timezone);
          return {
            id: e.event.Event_ID,
            name: e.event.Event_Name,
            dateTime: e.event.Event_DateTime,
            venue: e.event.Venue,
            detectedTimezone: e.timezone,
            timezoneAbbr: tz,
            localTimeAtDeletion: formatInTimezone(nowAccurate, e.timezone, tz),
            pktTimeAtDeletion: formatAsPKT(nowAccurate),
          };
        }),
        stopBeforeHours,
        clockOffset: getTimeSyncStatus().offsetSeconds,
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
  
  // Sync clock for accurate preview
  await ensureTimeSynced();
  
  try {
    // Fetch all events and check each against its venue timezone
    const allEvents = await Event.find({})
      .select('Event_ID Event_Name Event_DateTime Venue Skip_Scraping').lean();

    const eventsToDelete = [];
    const eventsSafe = [];
    const eventsSkipped = [];

    for (const event of allEvents) {
      const venue = event.Venue || '';
      // Use async version for live API fallback covering all US cities
      const tz = await detectTimezoneFromVenueAsync(venue);
      const result = tz ? await shouldStopEventAsync(event.Event_DateTime, venue, stopBeforeHours) : null;
      
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
      const tzAbbr = getTimezoneAbbr(tz);
      const accurateNow = getAccurateNow();
      
      const eventInfo = {
        id: event.Event_ID,
        name: event.Event_Name,
        dateTime: event.Event_DateTime,
        venue: event.Venue,
        isStopped: event.Skip_Scraping,
        detectedTimezone: tzAbbr,
        detectedTimezoneIana: tz,
        localTimeNow: localNow.toISOString(),
        localTimeDisplay: formatInTimezone(accurateNow, tz, tzAbbr),
        pktTimeDisplay: formatAsPKT(accurateNow),
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

/**
 * Get the last 4 events deleted by the auto-delete timer.
 * Each record includes both PKT and event-local timezone info.
 */
export async function getLastDeletedEvents() {
  await dbConnect();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settings: any = await AutoDeleteSettings.findOne().lean();
    const lastDeleted = settings?.lastDeletedEvents || [];
    return JSON.parse(JSON.stringify(lastDeleted));
  } catch (error) {
    console.error('Error getting last deleted events:', error);
    return [];
  }
}