import fs from 'fs';
import path from 'path';

/**
 * Service for interacting with the Sync API for CSV inventory management
 * Enhanced with retry mechanisms, connection pooling, and better error handling
 */
class SyncService {
  constructor(companyId, apiToken) {
    this.companyId = companyId;
    this.apiToken = apiToken;
    this.baseUrl = 'https://app.sync.automatiq.com/sync/api';
    this.requestTimeout = 30000; // 30 seconds
    this.maxRetries = 3;
  }

  /**
   * Enhanced fetch with timeout and retry logic
   */
  async fetchWithTimeout(url, options = {}, timeout = this.requestTimeout) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'User-Agent': 'SyncService/1.0',
          'Accept': 'application/json',
          ...options.headers
        }
      });
      
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Request upload credentials from Sync API with enhanced error handling
   * @param {boolean} zipped - Whether the file is zipped or not
   * @returns {Promise<Object>} - The upload credentials
   */
  async requestUploadCredentials(zipped = false) {
    let lastError;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        console.log(`Requesting upload credentials (attempt ${attempt + 1}/${this.maxRetries})...`);
        
        const response = await this.fetchWithTimeout(
          `${this.baseUrl}/inventories/csv_upload_request?zipped=${zipped}`,
          {
            method: 'POST',
            headers: {
              'X-Company-Id': this.companyId,
              'X-Api-Token': this.apiToken,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
          }
        );
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
        }
        
        const result = await response.json();
        console.log('✅ Upload credentials received successfully');
        return result;
        
      } catch (error) {
        lastError = error;
        console.error(`❌ Attempt ${attempt + 1} failed:`, error.message);
        
        if (attempt < this.maxRetries - 1) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          console.log(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    console.error('All attempts to request upload credentials failed');
    throw lastError;
  }

  /**
   * Upload a CSV file to S3 using the credentials provided by Sync API
   * @param {string} filePath - Path to the CSV file
   * @param {Object} credentials - The upload credentials from requestUploadCredentials
   * @returns {Promise<boolean>} - True if upload was successful
   */
  async uploadCsvToS3(filePath, credentials) {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      
      const { url, fields } = credentials.upload;
      const formData = new FormData();
      
      // Add all the fields to the form data
      Object.entries(fields).forEach(([key, value]) => {
        formData.append(key, value);
      });
      
      // Read file and create blob
      const fileContent = fs.readFileSync(filePath);
      const blob = new Blob([fileContent], { type: 'text/csv' });
      formData.append('file', blob, path.basename(filePath));
      
      // Upload to S3
      const response = await fetch(url, {
        method: 'POST',
        body: formData
      });
      
      return response.status === 204; // S3 returns 204 No Content on successful upload
    } catch (error) {
      console.error('Error uploading CSV to S3:', error.message);
      throw error;
    }
  }
  
  /**
   * Create a blank CSV file with headers to clear inventory
   * @param {string} outputPath - Path where the blank CSV will be saved
   * @param {Array<string>} headers - CSV headers (columns)
   * @returns {Promise<string>} - Path to the created blank CSV file
   */
  async createBlankCsv(outputPath, headers = ['sku', 'quantity', 'price']) {
    try {
      // Create CSV content with just headers
      const csvContent = headers.join(',') + '\n';
      
      // Write to file
      fs.writeFileSync(outputPath, csvContent);
      
      return outputPath;
    } catch (error) {
      console.error('Error creating blank CSV:', error.message);
      throw error;
    }
  }
  
  /**
   * Upload a CSV file to Sync
   * @param {string} filePath - Path to the CSV file
   * @param {boolean} zipped - Whether the file is zipped
   * @returns {Promise<Object>} - Response from Sync API
   */
  async uploadCsvToSync(filePath, zipped = false) {
    try {
      // Request upload credentials
      const credentials = await this.requestUploadCredentials(zipped);
      
      // Upload to S3
      const uploadSuccessful = await this.uploadCsvToS3(filePath, credentials);
      
      if (!uploadSuccessful) {
        throw new Error('Upload to S3 failed');
      }
      
      return {
        success: true,
        uploadId: credentials.id,
        message: 'CSV uploaded successfully'
      };
    } catch (error) {
      console.error('Error uploading CSV to Sync:', error.message);
      throw error;
    }
  }
  
  /**
   * Upload CSV content directly to S3 using credentials with enhanced error handling
   * @param {string} csvContent - CSV content as string
   * @param {Object} credentials - The upload credentials from requestUploadCredentials
   * @returns {Promise<boolean>} - True if upload was successful
   */
  async uploadCsvContentToS3(csvContent, credentials) {
    let lastError;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        console.log(`Uploading CSV to S3 (attempt ${attempt + 1}/${this.maxRetries})...`);
        
        const { url, fields } = credentials.upload;
        
        if (!url || !fields) {
          throw new Error('Invalid upload credentials: missing URL or fields');
        }
        
        const formData = new FormData();
        
        // Add all the fields to the form data
        Object.entries(fields).forEach(([key, value]) => {
          formData.append(key, value);
        });
        
        // Validate CSV content
        if (!csvContent || typeof csvContent !== 'string') {
          throw new Error('Invalid CSV content');
        }
        
        // Create a blob from the CSV content with proper size tracking
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const fileSizeMB = (blob.size / 1024 / 1024).toFixed(2);
        console.log(`📄 CSV file size: ${fileSizeMB}MB`);
        
        formData.append('file', blob, 'inventory.csv');
        
        // Upload to S3 with extended timeout for large files
        const uploadTimeout = Math.max(60000, blob.size / 1024); // 1 second per KB, minimum 60s
        const response = await this.fetchWithTimeout(url, {
          method: 'POST',
          body: formData
        }, uploadTimeout);
        
        if (response.status === 204) {
          console.log('✅ CSV uploaded to S3 successfully');
          return true;
        } else {
          const errorText = await response.text();
          throw new Error(`S3 upload failed with status ${response.status}: ${errorText}`);
        }
        
      } catch (error) {
        lastError = error;
        console.error(`❌ S3 upload attempt ${attempt + 1} failed:`, error.message);
        
        if (attempt < this.maxRetries - 1) {
          const delay = Math.min(2000 * Math.pow(2, attempt), 15000);
          console.log(`Retrying S3 upload in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    console.error('All S3 upload attempts failed');
    throw lastError;
  }
  
  /**
   * Upload CSV content directly to Sync (without file path)
   * @param {string} csvContent - CSV content as string
   * @param {boolean} zipped - Whether the file is zipped
   * @returns {Promise<Object>} - Response from Sync API
   */
  async uploadCsvContentToSync(csvContent, zipped = false) {
    try {
      // Request upload credentials
      const credentials = await this.requestUploadCredentials(zipped);
      
      // Upload content directly to S3
      const uploadSuccessful = await this.uploadCsvContentToS3(csvContent, credentials);
      
      if (!uploadSuccessful) {
        throw new Error('Upload to S3 failed');
      }
      
      return {
        success: true,
        uploadId: credentials.id,
        message: 'CSV content uploaded successfully'
      };
    } catch (error) {
      console.error('Error uploading CSV content to Sync:', error.message);
      throw error;
    }
  }
  
  /**
   * Clear all inventory by uploading a blank CSV
   * @returns {Promise<Object>} - Response from Sync API
   */
  async clearAllInventory() {
    try {
      // Create a blank CSV file
      const tempDir = path.join(process.cwd(), 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      const blankCsvPath = path.join(tempDir, 'blank_inventory.csv');
      await this.createBlankCsv(blankCsvPath);
      
      // Upload the blank CSV
      const result = await this.uploadCsvToSync(blankCsvPath);
      
      // Clean up the temporary file
      fs.unlinkSync(blankCsvPath);
      
      return {
        success: true,
        message: 'All inventory cleared successfully',
        ...result
      };
    } catch (error) {
      console.error('Error clearing inventory:', error.message);
      throw error;
    }
  }

  /**
   * Delete specific inventory items by their IDs
   * @param {Array<string>} inventoryIds - Array of inventory IDs to delete
   * @returns {Promise<Object>} - Response from Sync API
   */
  async deleteInventoryBatch(inventoryIds) {
    let lastError;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        console.log(`Deleting inventory batch (attempt ${attempt + 1}/${this.maxRetries})...`);
        console.log(`Deleting ${inventoryIds.length} inventory items:`, inventoryIds);
        
        const response = await this.fetchWithTimeout(
          `${this.baseUrl}/inventories/delete`,
          {
            method: 'POST',
            headers: {
              'X-Company-Id': this.companyId,
              'X-Api-Token': this.apiToken,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              inventory_ids: inventoryIds
            })
          }
        );
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
        }
        
        const result = await response.json();
        console.log('✅ Inventory batch deleted successfully');
        return result;
        
      } catch (error) {
        lastError = error;
        console.error(`❌ Attempt ${attempt + 1} failed:`, error.message);
        
        if (attempt < this.maxRetries - 1) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          console.log(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    console.error('All attempts to delete inventory batch failed');
    throw lastError;
  }

  /**
   * Notify Sync API that upload is complete
   * @param {string} uploadId - The upload ID from credentials
   * @returns {Promise<Object>} - Response from Sync API
   */
  async notifyUploadComplete(uploadId) {
    try {
      const response = await fetch(
        `${this.baseUrl}/inventories/csv_upload_complete`,
        {
          method: 'POST',
          headers: {
            'X-Company-Id': this.companyId,
            'X-Api-Token': this.apiToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ upload_id: uploadId })
        }
      );
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error notifying upload complete:', error.message);
      throw error;
    }
  }
}

export default SyncService;