/* eslint-disable @typescript-eslint/no-explicit-any */
'use server';
import dbConnect from '../lib/dbConnect';
import { ConsecutiveGroup } from '../models/seatModel';
import { Event } from '../models/eventModel';
import { SchedulerSettings } from '../models/schedulerModel';
import SyncService from '../lib/syncService';
import { createErrorLog } from './errorLogActions';
import { PipelineStage } from 'mongoose';

interface CsvRow {
  inventory_id: number;
  event_name: string;
  venue_name: string;
  event_date: string;
  event_id: string;
  quantity: number;
  section: string;
  row: string;
  seats: string;
  barcodes?: string;
  internal_notes?: string;
  public_notes?: string;
  tags?: string;
  list_price: number;
  face_price: number;
  taxed_cost: number;
  cost: number;
  hide_seats: 'Y' | 'N';
  in_hand: 'N';
  in_hand_date: string;
  instant_transfer?: 'Y' | 'N';
  files_available: 'Y' | 'N';
  split_type: 'CUSTOM' | 'DEFAULT' | 'NEVERLEAVEONE' | 'ANY';
  custom_split?: string;
  stock_type: 'ELECTRONIC' | 'HARD' | 'MOBILE_TRANSFER' | 'MOBILE_SCREENCAP' | 'PAPERLESS' | 'PAPERLESS_CARD' | 'FLASH';
  zone: 'Y' | 'N';
  shown_quantity?: number;
  passthrough?: string;
}

const csvColumns = [
  { id: 'inventory_id', title: 'inventory_id' },
  { id: 'event_name', title: 'event_name' },
  { id: 'venue_name', title: 'venue_name' },
  { id: 'event_date', title: 'event_date' },
  { id: 'event_id', title: 'event_id' },
  { id: 'quantity', title: 'quantity' },
  { id: 'section', title: 'section' },
  { id: 'row', title: 'row' },
  { id: 'seats', title: 'seats' },
  { id: 'barcodes', title: 'barcodes' },
  { id: 'internal_notes', title: 'internal_notes' },
  { id: 'public_notes', title: 'public_notes' },
  { id: 'tags', title: 'tags' },
  { id: 'list_price', title: 'list_price' },
  { id: 'face_price', title: 'face_price' },
  { id: 'taxed_cost', title: 'taxed_cost' },
  { id: 'cost', title: 'cost' },
  { id: 'hide_seats', title: 'hide_seats' },
  { id: 'in_hand', title: 'in_hand' },
  { id: 'in_hand_date', title: 'in_hand_date' },
  { id: 'instant_transfer', title: 'instant_transfer' },
  { id: 'files_available', title: 'files_available' },
  { id: 'split_type', title: 'split_type' },
  { id: 'custom_split', title: 'custom_split' },
  { id: 'stock_type', title: 'stock_type' },
  { id: 'zone', title: 'zone' },
  { id: 'shown_quantity', title: 'shown_quantity' },
  { id: 'passthrough', title: 'passthrough' },
];

// Retry configuration
interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 10000  // 10 seconds
};

// Exponential backoff with jitter
function calculateDelay(attempt: number, config: RetryConfig): number {
  const exponentialDelay = Math.min(config.baseDelay * Math.pow(2, attempt), config.maxDelay);
  const jitter = Math.random() * 0.1 * exponentialDelay;
  return exponentialDelay + jitter;
}

// Generic retry wrapper
async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === config.maxRetries) {
        await createErrorLog({
          eventUrl: 'CSV_RETRY_OPERATION',
          errorType: 'DATABASE_ERROR',
          message: lastError.message,
          stack: lastError.stack,
          metadata: {
            operation: operationName,
            attempt: attempt + 1,
            timestamp: new Date()
          }
        });
        throw lastError;
      }
      
      const delay = calculateDelay(attempt, config);
      console.warn(`${operationName} failed (attempt ${attempt + 1}/${config.maxRetries + 1}): ${lastError.message}. Retrying in ${delay}ms...`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}

export async function generateInventoryCsv(eventUpdateFilterMinutes: number = 0) {
  return withRetry(async () => {
    await dbConnect();
    const startTime = Date.now();

    try {
      let eventFilter = {};
      
      // If eventUpdateFilterMinutes is provided, filter by recently updated events
      if (eventUpdateFilterMinutes > 0) {
        const cutoffTime = new Date(Date.now() - eventUpdateFilterMinutes * 60 * 1000);
        
        // Get recently updated events with optimized query
        // Temporarily using updatedAt instead of Last_Updated to avoid MongoDB cache issues
        const recentlyUpdatedEvents = await Event.find(
          { updatedAt: { $gte: cutoffTime } },
          { mapping_id: 1 }
        ).lean(); // Using updatedAt field instead of Last_Updated to bypass cache issues
        
        console.log(`Filter: Events updated within last ${eventUpdateFilterMinutes} minutes since ${cutoffTime.toISOString()}`);
        console.log(`Found ${recentlyUpdatedEvents.length} events matching filter criteria`);
        
        if (recentlyUpdatedEvents.length === 0) {
          return { success: false, message: `No events updated within the last ${eventUpdateFilterMinutes} minutes. Try setting filter to 0 to include all events.` };
        }
        
        // Create filter for ConsecutiveGroup query
        const eventMappingIds = recentlyUpdatedEvents.map(event => event.mapping_id);
        eventFilter = { mapping_id: { $in: eventMappingIds } };
        
        console.log(`Using event filter for ${recentlyUpdatedEvents.length} events`);
      } else {
        console.log('No event filter applied - including all events');
      }

    // Optimized query with projection to fetch only required fields
    const projection = {
      'inventory.inventoryId': 1,
      'event_name': 1,
      'venue_name': 1,
      'event_date': 1,
      'eventId': 1,
      'mapping_id': 1,
      'inventory.quantity': 1,
      'inventory.section': 1,
      'inventory.row': 1,
      'seats.number': 1,
      'inventory.barcodes': 1,
      'inventory.tags': 1,
      'inventory.notes': 1,
      'inventory.publicNotes': 1,
      'inventory.listPrice': 1,
      'inventory.face_price': 1,
      'inventory.taxed_cost': 1,
      'inventory.cost': 1,
      'inventory.hideSeatNumbers': 1,
      'inventory.in_hand': 1,
      'inventory.inHandDate': 1,
      'inventory.instant_transfer': 1,
      'inventory.files_available': 1,
      'inventory.splitType': 1,
      'inventory.custom_split': 1,
      'inventory.stockType': 1,
      'inventory.zone': 1,
      'inventory.shown_quantity': 1,
      'inventory.passthrough': 1,
    };

      // Enhanced cursor with better memory management and parallel processing
      const BATCH_SIZE = 500; // Reduced batch size for better memory usage
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const PARALLEL_BATCHES = 3; // Process multiple batches in parallel
      
      // Use aggregation pipeline for better performance
      const pipeline = [
        { $match: eventFilter },
        { $project: projection },
        { $sort: { _id: 1 } } // Ensure consistent ordering
      ];
      
      const cursor = ConsecutiveGroup.aggregate(pipeline as PipelineStage[]).cursor({ batchSize: BATCH_SIZE });
      const records: CsvRow[] = [];
      let processedCount = 0;
      let batch: ConsecutiveGroupDocument[] = [];
      
      // Process documents in optimized batches
      for await (const doc of cursor) {
        batch.push(doc);
        
        if (batch.length >= BATCH_SIZE) {
          const processedBatch = await processBatch(batch);
          records.push(...processedBatch);
          processedCount += batch.length;
          
          console.log(`Processed ${processedCount} records... (Memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB)`);
          
          batch = []; // Clear batch to free memory
          
          // Yield control to event loop to prevent blocking
          await new Promise(resolve => setImmediate(resolve));
        }
      }
      
      // Process remaining documents
      if (batch.length > 0) {
        const processedBatch = await processBatch(batch);
        records.push(...processedBatch);
        processedCount += batch.length;
      }

      console.log(`Total records found: ${records.length}`);
      
      if (records.length === 0) {
        return { success: false, message: 'No inventory data found. Check if events exist and have inventory data.' };
      }

      // Optimized CSV generation using streaming approach
      const csvString = await generateCsvString(records);
    
      const endTime = Date.now();
      const duration = endTime - startTime;
      const memoryUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      
      console.log(`CSV generation completed in ${duration}ms for ${records.length} records (Peak memory: ${memoryUsage}MB)`);

      return { 
        success: true, 
        csv: csvString,
        recordCount: records.length,
        generationTime: duration,
        memoryUsage
      };
    } catch (error) {
      console.error('Error generating CSV:', error);
      await createErrorLog({
        eventUrl: 'CSV_GENERATION',
        errorType: 'DATABASE_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        metadata: {
          operation: 'generateInventoryCsv',
          timestamp: new Date()
        }
      });
      return { success: false, message: 'Failed to generate CSV.' };
    }
  }, 'CSV Generation');
}

// Interface for the document structure from MongoDB aggregation
interface ConsecutiveGroupDocument {
  _id?: string;
  inventory?: {
    inventoryId?: number;
    quantity?: number;
    section?: string;
    row?: string;
    barcodes?: string;
    tags?: string;
    notes?: string;
    publicNotes?: string;
    listPrice?: number;
    face_price?: number;
    taxed_cost?: number;
    cost?: number;
    hideSeatNumbers?: boolean;
    in_hand?: boolean;
    inHandDate?: Date | string;
    instant_transfer?: boolean;
    files_available?: boolean;
    splitType?: string;
    custom_split?: string;
    stockType?: string;
    zone?: boolean;
    shown_quantity?: number;
    passthrough?: string;
  };
  event_name?: string;
  venue_name?: string;
  event_date?: Date | string;
  eventId?: string;
  mapping_id?: string;
  seats?: Array<{ number: string | number }>;
}

// Function to determine split configuration based on ticket type and quantity
function calculateSplitConfiguration(quantity: number, splitType?: string, originalCustomSplit?: string): { 
  finalSplitType: CsvRow['split_type']; 
  customSplit: string; 
} {
  // If splitType is "DEFAULT", it's a resale ticket
  const isResale = splitType === 'DEFAULT';
  
  if (isResale) {
    // RESALE logic
    
    // For quantities over thresholds, use NEVERLEAVEONE
    // Even quantities over 10 = NEVERLEAVEONE
    // Odd quantities over 11 = NEVERLEAVEONE
    if ((quantity % 2 === 0 && quantity >= 10) || (quantity % 2 === 1 && quantity >= 11)) {
      return { finalSplitType: 'NEVERLEAVEONE', customSplit: '' };
    }
    
    // For quantities at or below thresholds, use CUSTOM with appropriate splits
    // Even quantities 10 and below, Odd quantities 11 and below use CUSTOM
    if (quantity === 2) {
      return { finalSplitType: 'CUSTOM', customSplit: '2' };
    } else if (quantity === 3) {
      return { finalSplitType: 'CUSTOM', customSplit: '3' };
    } else if (quantity === 4) {
      return { finalSplitType: 'CUSTOM', customSplit: '2,4' };
    } else if (quantity === 5) {
      return { finalSplitType: 'CUSTOM', customSplit: '3,5' };
    } else if (quantity === 6) {
      return { finalSplitType: 'CUSTOM', customSplit: '2,4,6' };
    } else if (quantity === 7) {
      return { finalSplitType: 'CUSTOM', customSplit: '2,3,4,5,7' };
    } else if (quantity === 8) {
      return { finalSplitType: 'CUSTOM', customSplit: '2,4,6,8' };
    } else if (quantity === 9) {
      return { finalSplitType: 'CUSTOM', customSplit: '2,3,4,5,6,7,9' };
    } else if (quantity === 10) {
      return { finalSplitType: 'CUSTOM', customSplit: '2,4,6,8,10' };
    } else if (quantity === 11) {
      return { finalSplitType: 'CUSTOM', customSplit: '2,3,4,5,6,7,8,9,11' };
    } else {
      // For any other quantities (edge cases or quantities > thresholds), use NEVERLEAVEONE
      return { finalSplitType: 'NEVERLEAVEONE', customSplit: '' };
    }
  } else {
    // STANDARD ticket logic - all standard tickets use NEVERLEAVEONE
    return { finalSplitType: 'NEVERLEAVEONE', customSplit: '' };
  }
}

// Helper function to process batches in parallel
async function processBatch(batch: ConsecutiveGroupDocument[]): Promise<CsvRow[]> {
  return batch.map(doc => {
    const inventory = doc.inventory;
    
    // Pre-compute expensive operations with null safety
    const seatsString = doc.seats && doc.seats.length > 0 ?
      doc.seats.map((seat: { number: string | number }) => seat.number).join(',') : '';
    const eventDateString = doc.event_date ? 
      new Date(doc.event_date).toISOString() : '';
    const inHandDateString = inventory?.inHandDate ? 
      new Date(inventory.inHandDate).toISOString().slice(0, 10) : '';

    // Calculate split configuration based on quantity and split type
    const { finalSplitType, customSplit } = calculateSplitConfiguration(
      inventory?.quantity || 0, 
      inventory?.splitType, 
      inventory?.custom_split
    );
    
    return {
      inventory_id: inventory?.inventoryId || 0,
      event_name: doc.event_name || '',
      venue_name: doc.venue_name || '',
      event_date: eventDateString,
      event_id: doc.mapping_id || '',
      quantity: inventory?.quantity || 0,
      section: inventory?.section || '',
      row: inventory?.row || '',
      seats: seatsString,
      barcodes: inventory?.barcodes || '',
      internal_notes: "-tnow -tmplus",
      public_notes: inventory?.publicNotes || '',
      tags: inventory?.tags || '',
      list_price: Number(inventory?.listPrice || 0),
      face_price: Number(inventory?.cost || 0),
      taxed_cost: Number(inventory?.cost || 0),
      cost: Number(inventory?.cost || 0),
      hide_seats: inventory?.hideSeatNumbers ? "Y" : "N",
      in_hand: "N", // Always set to "N" as per original code
      in_hand_date: inHandDateString,
      instant_transfer: inventory?.instant_transfer ? "Y" : "N",
      files_available: "N",
      split_type: finalSplitType,
      custom_split: customSplit,
      stock_type: (inventory?.stockType as CsvRow['stock_type']) || "ELECTRONIC",
      zone: "N",
      shown_quantity: inventory?.shown_quantity || undefined,
      passthrough: inventory?.passthrough || ''
    } as CsvRow;
  });
}

// Optimized CSV string generation
async function generateCsvString(records: CsvRow[]): Promise<string> {
  const chunks: string[] = [];
  
  // Add headers
  chunks.push(csvColumns.map(col => col.title).join(','));
  
  // Process records in chunks to avoid string concatenation performance issues
  const CHUNK_SIZE = 1000;
  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE);
    const csvChunk = chunk.map(record => {
      return csvColumns.map(col => {
        const value = record[col.id as keyof CsvRow];
        // Proper CSV escaping
        if (value === null || value === undefined) {
          return '';
        }
        const stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n') || stringValue.includes('\r')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      }).join(',');
    }).join('\n');
    
    chunks.push(csvChunk);
    
    // Yield control periodically
    if (i % (CHUNK_SIZE * 5) === 0) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  
  return chunks.join('\n');
}

export async function uploadCsvToSyncService(csvContent: string): Promise<{ success: boolean; message: string; uploadId?: string }> {
  return withRetry(async () => {
    try {
      // Get sync service credentials from environment variables
      const companyId = process.env.SYNC_COMPANY_ID;
      const apiToken = process.env.SYNC_API_TOKEN;
      
      if (!companyId || !apiToken) {
        throw new Error('Sync service credentials not configured. Please set SYNC_COMPANY_ID and SYNC_API_TOKEN environment variables.');
      }
      
      // Validate CSV content
      if (!csvContent || csvContent.trim().length === 0) {
        throw new Error('CSV content is empty or invalid');
      }
      
      // Initialize sync service
      const syncService = new SyncService(companyId, apiToken);
      
      // Upload CSV content to sync service with timeout
      const uploadPromise = syncService.uploadCsvContentToSync(csvContent);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Upload timeout after 30 seconds')), 30000);
      });
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      const result = await Promise.race([uploadPromise, timeoutPromise]) as any;
      
      // Log detailed server response for debugging
      console.log('=== SERVER UPLOAD RESPONSE ===');
      console.log('Full server response:', JSON.stringify(result, null, 2));
      console.log('Response type:', typeof result);
      console.log('Response keys:', Object.keys(result || {}));
      console.log('==============================');
      
      if ('success' in result && result.success) {
        // Update database with upload status
        await updateSchedulerSettings({
          lastUploadAt: new Date(),
          lastUploadStatus: 'success',
          lastUploadId: (result as { uploadId?: string })?.uploadId
        });
        
        console.log('✅ CSV content uploaded to sync service successfully');
        console.log('Upload ID:', (result as { uploadId?: string })?.uploadId);
        
        return {
          success: true,
          message: 'CSV uploaded to sync service successfully',
          uploadId: (result as { uploadId?: string }).uploadId
        };
      } else {
        console.log('❌ Upload failed - Server response indicates failure');
        console.log('Error message from server:', (result as { message?: string })?.message);
        throw new Error((result as { message?: string }).message || 'Upload failed');
      }
    } catch (error) {
      console.error('Error uploading to sync service:', error);
      
      // Update database with error status
      try {
        await updateSchedulerSettings({
          lastUploadAt: new Date(),
          lastUploadStatus: 'failed',
          lastUploadError: error instanceof Error ? error.message : 'Unknown error occurred'
        });
      } catch (dbError) {
        console.error('Error updating database with upload status:', dbError);
      }
      
      throw error; // Re-throw for retry mechanism
    }
  }, 'CSV Upload', {
    maxRetries: 5, // More retries for upload
    baseDelay: 2000, // Longer delay for network operations
    maxDelay: 30000
  }).catch(error => {
    return {
      success: false,
      message: `Failed to upload CSV to sync service after retries: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  });
}

export async function clearInventoryFromSync(): Promise<{ success: boolean; message: string; uploadId?: string }> {
  try {
    // Get sync service credentials from environment variables
    const companyId = process.env.SYNC_COMPANY_ID;
    const apiToken = process.env.SYNC_API_TOKEN;
    
    if (!companyId || !apiToken) {
      throw new Error('Sync service credentials not configured. Please set SYNC_COMPANY_ID and SYNC_API_TOKEN environment variables.');
    }
    
    // Initialize sync service
    const syncService = new SyncService(companyId, apiToken);
    
    // Clear all inventory
    const result = await syncService.clearAllInventory();
    
    if ('success' in result && result.success) {
      // Update database with clear inventory status
      await updateSchedulerSettings({
        lastUploadAt: new Date(),
        lastUploadStatus: 'cleared',
        lastUploadId: (result as { uploadId?: string })?.uploadId,
        lastClearAt: new Date()
      });
      
      console.log('Inventory cleared from sync service successfully');
      
      return {
        success: true,
        message: 'Inventory cleared from sync service successfully',
        uploadId: (result as { uploadId?: string })?.uploadId
      };
    } else {
      throw new Error((result as { message?: string })?.message || 'Clear inventory failed');
    }
  } catch (error) {
    console.error('Error clearing inventory from sync service:', error);
    
    // Update database with error status
    try {
      await updateSchedulerSettings({
        lastUploadAt: new Date(),
        lastUploadStatus: 'clear_failed',
        lastUploadError: error instanceof Error ? error.message : 'Unknown error occurred'
      });
    } catch (dbError) {
      console.error('Error updating database with clear inventory status:', dbError);
    }
    
    return {
      success: false,
      message: `Failed to clear inventory from sync service: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Database settings functions
export async function getSchedulerSettings() {
  await dbConnect();
  try {
    return await SchedulerSettings.findOne({}) || await SchedulerSettings.create({});
  } catch (error) {
    console.error('Error getting scheduler settings:', error);
    throw error;
  }
}

export async function updateSchedulerSettings(updates: {
  lastUploadAt?: Date;
  lastUploadStatus?: 'success' | 'failed' | 'cleared' | 'clear_failed';
  lastUploadId?: string;
  lastUploadError?: string;
  lastClearAt?: Date;
  scheduleRateMinutes?: number;
  uploadToSync?: boolean;
  isScheduled?: boolean;
  eventUpdateFilterMinutes?: number;
  nextRunAt?: Date;
  totalRuns?: number;
}) {
  await dbConnect();
  try {
    return await SchedulerSettings.findOneAndUpdate({}, updates, { new: true, upsert: true });
  } catch (error) {
    console.error('Error updating scheduler settings:', error);
    throw error;
  }
}
