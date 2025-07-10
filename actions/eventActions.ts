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
import { revalidatePath } from 'next/cache';
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
    revalidatePath('/dashboard/events'); // Revalidate events page
    revalidatePath(`/dashboard/events/${savedEvent._id}`); // Revalidate specific event page
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
 * Updates an existing event.
 * @param {string} eventId - The ID of the event to update.
 * @param {object} updateData - An object containing the fields to update.
 * @param {boolean} deleteSeatGroups - Whether to delete associated seat groups on certain updates.
 * @returns {Promise<object|null>} The updated event object or null if not found, or an error object.
 */
export async function updateEvent(eventId: string, updateData: Partial<Event> & { Skip_Scraping?: boolean; priceIncreasePercentage?: number }, deleteSeatGroups: boolean = false) {
  await dbConnect();
  try {
    // Get current event state to check if we're actually stopping scraping
    const currentEvent = await Event.findById(eventId);
    if (!currentEvent) {
      return null;
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
      seatDeletionResult = await deleteConsecutiveGroupsByEventId(eventId);
      console.log('Seat deletion result:', seatDeletionResult);
    }

    const updatedEvent = await Event.findByIdAndUpdate(eventId, updateData, {
      new: true, // Return the modified document rather than the original
      runValidators: true, // Ensure schema validations are run
    });
    if (!updatedEvent) {
      return null;
    }
    revalidatePath('/dashboard/events'); // Revalidate events page
    revalidatePath(`/dashboard/events/${eventId}`); // Revalidate specific event page
    revalidatePath('/dashboard/inventory'); // Revalidate inventory page
    
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

    // Delete all associated consecutive seat groups first
    const seatDeletionResult = await deleteConsecutiveGroupsByEventId(eventId);
    
    // Delete the event
    const deletedEvent = await Event.findByIdAndDelete(eventId);
    
    revalidatePath('/dashboard/events');
    revalidatePath('/dashboard/inventory');
    
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
      // Get all event IDs first
      const events = await Event.find({}, '_id');
      const eventIds = events.map(event => event._id.toString());
      
      // Delete all seat groups for all events efficiently
      const seatDeletionResult = await deleteConsecutiveGroupsByEventIds(eventIds);
      
      const updateEventsStatus = await Event.updateMany(
        {}, // Update all events
        { Skip_Scraping: status } // Set Skip_Scraping to the provided status
      );

      revalidatePath('/dashboard/events');
      revalidatePath('/dashboard/inventory');

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

      revalidatePath('/dashboard/events');

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