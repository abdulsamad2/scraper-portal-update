'use server';

import dbConnect from '@/lib/dbConnect';
import { ErrorLog } from '@/models/errorModel'; // Assuming models are aliased to @/models

/**
 * Creates a new error log.
 * @param {object} logData - The data for the new error log.
 * @returns {Promise<object>} The created log object or an error object.
 */
export async function createErrorLog(logData: Record<string, unknown>) {
  await dbConnect();
  try {
    const newLog = new ErrorLog(logData);
    const savedLog = await newLog.save();
    // No individual log page revalidation typically needed unless you have one
    return JSON.parse(JSON.stringify(savedLog));
  } catch (error) {
    console.error('Error creating error log:', error);
    return { error: error instanceof Error ? error.message : 'Failed to create error log' };
  }
}

/**
 * Retrieves a single error log by its ID.
 * @param {string} logId - The ID of the log to retrieve.
 * @returns {Promise<object|null>} The log object or null if not found, or an error object.
 */
export async function getErrorLogById(logId: string) {
  await dbConnect();
  try {
    const log = await ErrorLog.findById(logId);
    if (!log) {
      return null;
    }
    return JSON.parse(JSON.stringify(log));
  } catch (error) {
    console.error('Error fetching error log by ID:', error);
    return { error: error instanceof Error ? error.message : 'Failed to fetch error log' };
  }
}

/**
 * Retrieves all error logs.
 * @param {object} query - Optional query object to filter error logs.
 * @param {object} sort - Optional sort object (e.g., { createdAt: -1 } to get latest first).
 * @param {number} limit - Optional limit for pagination.
 * @param {number} skip - Optional skip for pagination.
 * @returns {Promise<Array<object>>} An array of log objects or an error object.
 */
export async function getAllErrorLogs(query = {}, sort = { createdAt: -1 }, limit = 50, skip = 0) {
  await dbConnect();
  try {
    const logs = await ErrorLog.find(query).sort(sort as { [key: string]: 1 | -1 }).skip(skip).limit(limit);
    const totalLogs = await ErrorLog.countDocuments(query);
    return {
      logs: JSON.parse(JSON.stringify(logs)),
      totalLogs,
      page: Math.floor(skip / limit) + 1,
      totalPages: Math.ceil(totalLogs / limit),
    };
  } catch (error:unknown) {
    console.error('Error fetching all error logs:', error);
    return { error: error instanceof Error ? error.message : 'Failed to fetch error logs' };
  }
}

/**
 * Updates an existing error log.
 * @param {string} logId - The ID of the log to update.
 * @param {object} updateData - An object containing the fields to update.
 * @returns {Promise<object|null>} The updated log object or null if not found, or an error object.
 */
export async function updateErrorLog(logId: string, updateData: object) {
  await dbConnect();
  try {
    const updatedLog = await ErrorLog.findByIdAndUpdate(logId, updateData, {
      new: true,
      runValidators: true,
    });
    if (!updatedLog) {
      return null;
    }
    return JSON.parse(JSON.stringify(updatedLog));
  } catch (error) {
    console.error('Error updating error log:', error);
    return { error: (error as Error).message || 'Failed to update error log' };
  }
}

/**
 * Deletes an error log by its ID.
 * @param {string} logId - The ID of the log to delete.
 * @returns {Promise<object>} A success message or an error object.
 */
export async function deleteErrorLog(logId: string) {
  await dbConnect();
  try {
    const deletedLog = await ErrorLog.findByIdAndDelete(logId);
    if (!deletedLog) {
      return { message: 'Error log not found', success: false };
    }
    return { message: 'Error log deleted successfully', success: true, deletedLog: JSON.parse(JSON.stringify(deletedLog)) };
  } catch (error) {
    console.error('Error deleting error log:', error);
    return { error: (error as Error).message || 'Failed to delete error log', success: false };
  }
}

/**
 * Retrieves error logs by eventUrl.
 * @param {string} eventUrl - The eventUrl to filter logs by.
 * @returns {Promise<Array<object>>} An array of log objects or an error object.
 */
export async function getErrorLogsByEventUrl(eventUrl: string, sort = { createdAt: -1 }, limit = 50, skip = 0) {
  await dbConnect();
  try {
    const query = { eventUrl };
    const logs = await ErrorLog.find(query).sort(sort as { [key: string]: 1 | -1 }).skip(skip).limit(limit);
    const totalLogs = await ErrorLog.countDocuments(query);
    return {
      logs: JSON.parse(JSON.stringify(logs)),
      totalLogs,
      page: Math.floor(skip / limit) + 1,
      totalPages: Math.ceil(totalLogs / limit),
    };
  } catch (error) {
    console.error('Error fetching error logs by eventUrl:', error);
    return { error: (error as Error).message || 'Failed to fetch error logs for eventUrl' };
  }
}
