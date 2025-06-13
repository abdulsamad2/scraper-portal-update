'use server';

import dbConnect from '@/lib/dbConnect';
import { Event } from '@/models/eventModel'; // Assuming models are aliased to @/models
import { revalidatePath } from 'next/cache';

/**
 * Creates a new event.
 * @param {object} eventData - The data for the new event.
 * @returns {Promise<object>} The created event object or an error object.
 */
export async function createEvent(eventData) {
  await dbConnect();
  try {
    const newEvent = new Event(eventData);
    const savedEvent = await newEvent.save();
    revalidatePath('/events'); // Adjust path if your events page is different
    revalidatePath(`/events/${savedEvent._id}`); // Revalidate specific event page if exists
    return JSON.parse(JSON.stringify(savedEvent));
  } catch (error) {
    console.error('Error creating event:', error);
    return { error: error.message || 'Failed to create event' };
  }
}

/**
 * Retrieves a single event by its ID.
 * @param {string} eventId - The ID of the event to retrieve.
 * @returns {Promise<object|null>} The event object or null if not found, or an error object.
 */
export async function getEventById(eventId) {
  await dbConnect();
  try {
    const event = await Event.findById(eventId);
    if (!event) {
      return null;
    }
    return JSON.parse(JSON.stringify(event));
  } catch (error) {
    console.error('Error fetching event by ID:', error);
    return { error: error.message || 'Failed to fetch event' };
  }
}

/**
 * Retrieves all events.
 * @returns {Promise<Array<object>>} An array of event objects or an error object.
 */
export async function getAllEvents() {
  await dbConnect();
  try {
    const events = await Event.find({});
    return JSON.parse(JSON.stringify(events));
  } catch (error) {
    console.error('Error fetching all events:', error);
    return { error: error.message || 'Failed to fetch events' };
  }
}

/**
 * Updates an existing event.
 * @param {string} eventId - The ID of the event to update.
 * @param {object} updateData - An object containing the fields to update.
 * @returns {Promise<object|null>} The updated event object or null if not found, or an error object.
 */
export async function updateEvent(eventId, updateData) {
  await dbConnect();
  try {
    const updatedEvent = await Event.findByIdAndUpdate(eventId, updateData, {
      new: true, // Return the modified document rather than the original
      runValidators: true, // Ensure schema validations are run
    });
    if (!updatedEvent) {
      return null;
    }
    revalidatePath('/events'); // Adjust path if your events page is different
    revalidatePath(`/events/${eventId}`); // Revalidate specific event page
    return JSON.parse(JSON.stringify(updatedEvent));
  } catch (error) {
    console.error('Error updating event:', error);
    return { error: error.message || 'Failed to update event' };
  }
}

// Example of how to get an event by a different unique field, e.g., Event_ID
/**
 * Retrieves a single event by its Event_ID.
 * @param {string} eventSpecificId - The Event_ID of the event to retrieve.
 * @returns {Promise<object|null>} The event object or null if not found, or an error object.
 */
export async function getEventByEventIdString(eventSpecificId) {
  await dbConnect();
  try {
    const event = await Event.findOne({ Event_ID: eventSpecificId });
    if (!event) {
      return null;
    }
    return JSON.parse(JSON.stringify(event));
  } catch (error) {
    console.error('Error fetching event by Event_ID:', error);
    return { error: error.message || 'Failed to fetch event by Event_ID' };
  }
}

// You might also want a delete action:
/**
 * Deletes an event by its ID.
 * @param {string} eventId - The ID of the event to delete.
 * @returns {Promise<object>} A success message or an error object.
 */
export async function deleteEvent(eventId) {
  await dbConnect();
  try {
    const deletedEvent = await Event.findByIdAndDelete(eventId);
    if (!deletedEvent) {
      return { message: 'Event not found', success: false };
    }
    revalidatePath('/events');
    return { message: 'Event deleted successfully', success: true, deletedEvent: JSON.parse(JSON.stringify(deletedEvent)) };
  } catch (error) {
    console.error('Error deleting event:', error);
    return { error: error.message || 'Failed to delete event', success: false };
  }
}

