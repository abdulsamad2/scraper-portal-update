'use server';
import dbConnect from '../lib/dbConnect';
import { ConsecutiveGroup } from '../models/seatModel';
import { Event } from '../models/eventModel';
import { SchedulerSettings } from '../models/schedulerModel';
import SyncService from '../lib/syncService';

interface CsvRow {
  inventory_id: number;
  event_name: string;
  venue_name: string;
  event_date: string;
  mapping_id: string;
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
  in_hand: 'Y' | 'N';
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

export async function generateInventoryCsv(eventUpdateFilterMinutes: number = 0) {
  await dbConnect();
  const startTime = Date.now();

  try {
    let eventFilter = {};
    
    // If eventUpdateFilterMinutes is provided, filter by recently updated events
    if (eventUpdateFilterMinutes > 0) {
      const cutoffTime = new Date(Date.now() - eventUpdateFilterMinutes * 60 * 1000);
      
      // Get recently updated events
      const recentlyUpdatedEvents = await Event.find(
        { Last_Updated: { $gte: cutoffTime } },
        { mapping_id: 1 }
      ).lean();
      
      if (recentlyUpdatedEvents.length === 0) {
        return { success: false, message: `No events updated within the last ${eventUpdateFilterMinutes} minutes.` };
      }
      
      // Create filter for ConsecutiveGroup query
      const eventMappingIds = recentlyUpdatedEvents.map(event => event.mapping_id);
      eventFilter = { mapping_id: { $in: eventMappingIds } };
      
      console.log(`Found ${recentlyUpdatedEvents.length} events updated within last ${eventUpdateFilterMinutes} minutes`);
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

    // Use cursor for memory-efficient streaming
    const cursor = ConsecutiveGroup.find(eventFilter, projection).lean().cursor();
    const records: CsvRow[] = [];
    const BATCH_SIZE = 1000;
    let processedCount = 0;

    // Process documents in batches for better memory management
    for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
      const inventory = doc.inventory;
         
      
      // Pre-compute expensive operations
      const seatsString = doc.seats?.length > 0 ? 
        doc.seats.map((seat: { number: string | number }) => seat.number).join(',') : '';
      const eventDateString = doc.event_date ? 
        new Date(doc.event_date).toISOString() : '';
      const inHandDateString = inventory?.inHandDate ? 
        new Date(inventory.inHandDate).toISOString().slice(0, 10) : '';

      records.push({
        inventory_id: inventory?.inventoryId,
        event_name: doc.event_name,
        venue_name: doc.venue_name,
        event_date: eventDateString,
        event_id: doc.mapping_id,
        quantity: inventory?.quantity,
        section: inventory?.section,
        row: inventory?.row,
        seats: seatsString,
        internal_notes: "-tnow -tmplus",
        public_notes: inventory?.publicNotes,
        list_price: inventory?.listPrice.toFixed(2),
        face_price: inventory?.cost.toFixed(2),
        taxed_cost: inventory?.cost.toFixed(2),
        cost: inventory?.cost,
        hide_seats: inventory?.hideSeatNumbers ? "Y" : "N",
        in_hand: inventory?.in_hand ? "N" : "N",
        in_hand_date: inHandDateString,
        instant_transfer: inventory?.instant_transfer ? "Y" : "N",
        files_available: "N",
        split_type: inventory?.splitType || "ANY",
        custom_split: inventory?.custom_split || "",
        stock_type: inventory?.stockType || "ELECTRONIC",
        zone: "N",
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-expect-error
        shown_quantity: "",
      });

      processedCount++;
      
      // Process in batches to avoid memory issues
      if (processedCount % BATCH_SIZE === 0) {
        console.log(`Processed ${processedCount} records...`);
      }
    }

    if (records.length === 0) {
      return { success: false, message: 'No inventory data found.' };
    }

    // Use fast-csv for optimized CSV generation
     let csvString = '';
     
     // Add headers
     csvString += csvColumns.map(col => col.title).join(',') + '\n';
     
     // Add data rows
     records.forEach(record => {

       const row = csvColumns.map(col => {
         const value = record[col.id as keyof CsvRow];
         // Escape commas and quotes in CSV values
         if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
           return `"${value.replace(/"/g, '""')}"`;
         }
         return value;
       }).join(',');
       csvString += row + '\n';
     });
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    console.log(`CSV generation completed in ${duration}ms for ${records.length} records`);

    return { 
      success: true, 
      csv: csvString,
      recordCount: records.length,
      generationTime: duration
    };
  } catch (error) {
    console.error('Error generating CSV:', error);
    return { success: false, message: 'Failed to generate CSV.' };
  }
}

export async function uploadCsvToSyncService(csvContent: string): Promise<{ success: boolean; message: string; uploadId?: string }> {
  try {
    // Get sync service credentials from environment variables
    const companyId = process.env.SYNC_COMPANY_ID;
    const apiToken = process.env.SYNC_API_TOKEN;
    
    if (!companyId || !apiToken) {
      throw new Error('Sync service credentials not configured. Please set SYNC_COMPANY_ID and SYNC_API_TOKEN environment variables.');
    }
    
    // Initialize sync service
    const syncService = new SyncService(companyId, apiToken);
    
    // Upload CSV content to sync service
    const result = await syncService.uploadCsvContentToSync(csvContent);
    
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
    
    return {
      success: false,
      message: `Failed to upload CSV to sync service: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
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
