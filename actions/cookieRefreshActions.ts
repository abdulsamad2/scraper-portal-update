'use server';

import dbConnect from '@/lib/dbConnect';
import { CookieRefresh } from '@/models/cookieRefreshModel'; // Assuming models are aliased to @/models
import { revalidatePath } from 'next/cache';

/**
 * Creates a new cookie refresh record.
 * @param {object} refreshData - The data for the new cookie refresh record.
 * @returns {Promise<object>} The created record object or an error object.
 */
export async function createCookieRefresh(refreshData) {
  await dbConnect();
  try {
    const newRefresh = new CookieRefresh(refreshData);
    const savedRefresh = await newRefresh.save();
    revalidatePath('/admin/cookie-refreshes'); // Adjust path as needed
    return JSON.parse(JSON.stringify(savedRefresh));
  } catch (error) {
    console.error('Error creating cookie refresh record:', error);
    return { error: error.message || 'Failed to create cookie refresh record' };
  }
}

/**
 * Retrieves a single cookie refresh record by its MongoDB ID.
 * @param {string} id - The MongoDB ID of the record to retrieve.
 * @returns {Promise<object|null>} The record object or null if not found, or an error object.
 */
export async function getCookieRefreshById(id) {
  await dbConnect();
  try {
    const refreshRecord = await CookieRefresh.findById(id);
    if (!refreshRecord) {
      return null;
    }
    return JSON.parse(JSON.stringify(refreshRecord));
  } catch (error) {
    console.error('Error fetching cookie refresh record by ID:', error);
    return { error: error.message || 'Failed to fetch cookie refresh record' };
  }
}

/**
 * Retrieves a single cookie refresh record by its unique refreshId.
 * @param {string} refreshId - The unique refreshId of the record to retrieve.
 * @returns {Promise<object|null>} The record object or null if not found, or an error object.
 */
export async function getCookieRefreshByRefreshId(refreshId) {
  await dbConnect();
  try {
    const refreshRecord = await CookieRefresh.findOne({ refreshId });
    if (!refreshRecord) {
      return null;
    }
    return JSON.parse(JSON.stringify(refreshRecord));
  } catch (error) {
    console.error('Error fetching cookie refresh record by refreshId:', error);
    return { error: error.message || 'Failed to fetch cookie refresh record by refreshId' };
  }
}

/**
 * Retrieves all cookie refresh records with pagination and sorting.
 * @param {object} query - Optional query object to filter records.
 * @param {object} sort - Optional sort object (e.g., { createdAt: -1 } for latest first).
 * @param {number} limit - Optional limit for pagination.
 * @param {number} skip - Optional skip for pagination.
 * @returns {Promise<object>} An object containing records, total count, and pagination info, or an error object.
 */
export async function getAllCookieRefreshes(query = {}, sort = { createdAt: -1 }, limit = 50, skip = 0) {
  await dbConnect();
  try {
    const records = await CookieRefresh.find(query).sort(sort).skip(skip).limit(limit);
    const totalRecords = await CookieRefresh.countDocuments(query);
    return {
      records: JSON.parse(JSON.stringify(records)),
      totalRecords,
      page: Math.floor(skip / limit) + 1,
      totalPages: Math.ceil(totalRecords / limit),
    };
  } catch (error) {
    console.error('Error fetching all cookie refresh records:', error);
    return { error: error.message || 'Failed to fetch cookie refresh records' };
  }
}

/**
 * Updates an existing cookie refresh record.
 * @param {string} id - The MongoDB ID of the record to update.
 * @param {object} updateData - An object containing the fields to update.
 * @returns {Promise<object|null>} The updated record object or null if not found, or an error object.
 */
export async function updateCookieRefresh(id, updateData) {
  await dbConnect();
  try {
    const updatedRecord = await CookieRefresh.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });
    if (!updatedRecord) {
      return null;
    }
    revalidatePath('/admin/cookie-refreshes'); // Adjust path as needed
    revalidatePath(`/admin/cookie-refreshes/${id}`); // If you have individual pages
    return JSON.parse(JSON.stringify(updatedRecord));
  } catch (error) {
    console.error('Error updating cookie refresh record:', error);
    return { error: error.message || 'Failed to update cookie refresh record' };
  }
}

/**
 * Deletes a cookie refresh record by its MongoDB ID.
 * @param {string} id - The MongoDB ID of the record to delete.
 * @returns {Promise<object>} A success message or an error object.
 */
export async function deleteCookieRefresh(id) {
  await dbConnect();
  try {
    const deletedRecord = await CookieRefresh.findByIdAndDelete(id);
    if (!deletedRecord) {
      return { message: 'Cookie refresh record not found', success: false };
    }
    revalidatePath('/admin/cookie-refreshes'); // Adjust path as needed
    return { message: 'Cookie refresh record deleted successfully', success: true, deletedRecord: JSON.parse(JSON.stringify(deletedRecord)) };
  } catch (error) {
    console.error('Error deleting cookie refresh record:', error);
    return { error: error.message || 'Failed to delete cookie refresh record', success: false };
  }
}

/**
 * Retrieves cookie refresh records by status.
 * @param {string} status - The status to filter records by.
 * @returns {Promise<Array<object>>} An array of record objects or an error object.
 */
export async function getCookieRefreshesByStatus(status, sort = { createdAt: -1 }, limit = 50, skip = 0) {
  await dbConnect();
  try {
    const query = { status };
    const records = await CookieRefresh.find(query).sort(sort).skip(skip).limit(limit);
    const totalRecords = await CookieRefresh.countDocuments(query);
     return {
      records: JSON.parse(JSON.stringify(records)),
      totalRecords,
      page: Math.floor(skip / limit) + 1,
      totalPages: Math.ceil(totalRecords / limit),
    };
  } catch (error) {
    console.error('Error fetching cookie refresh records by status:', error);
    return { error: error.message || 'Failed to fetch records by status' };
  }
}

/**
 * Retrieves cookie refresh records by eventId.
 * @param {string} eventId - The eventId to filter records by.
 * @returns {Promise<Array<object>>} An array of record objects or an error object.
 */
export async function getCookieRefreshesByEventId(eventId, sort = { createdAt: -1 }, limit = 50, skip = 0) {
  await dbConnect();
  try {
    const query = { eventId };
    const records = await CookieRefresh.find(query).sort(sort).skip(skip).limit(limit);
    const totalRecords = await CookieRefresh.countDocuments(query);
    return {
      records: JSON.parse(JSON.stringify(records)),
      totalRecords,
      page: Math.floor(skip / limit) + 1,
      totalPages: Math.ceil(totalRecords / limit),
    };
  } catch (error) {
    console.error('Error fetching cookie refresh records by eventId:', error);
    return { error: error.message || 'Failed to fetch records for eventId' };
  }
}
