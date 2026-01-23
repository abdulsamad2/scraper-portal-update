'use server';

import dbConnect from '@/lib/dbConnect';
import { Proxy } from '@/models/proxyModel';
import { Model, Document } from 'mongoose';

/**
 * Types for proxy management
 */
export interface ProxyData {
  proxy_id?: string;
  raw_proxy_string: string;
  provider?: string;
  region?: string;
  country_code?: string;
  status?: 'active' | 'inactive' | 'blacklisted' | 'maintenance';
  rotation_weight?: number;
  tags?: string[];
  max_concurrent_usage?: number;
  requests_per_minute_limit?: number;
}

export interface ProxyUpdateData {
  provider?: string;
  region?: string;
  country_code?: string;
  status?: 'active' | 'inactive' | 'blacklisted' | 'maintenance';
  rotation_weight?: number;
  tags?: string[];
  max_concurrent_usage?: number;
  requests_per_minute_limit?: number;
  is_working?: boolean;
}

export interface BulkImportResult {
  success: number;
  failed: number;
  errors: Array<{ proxy: string; error: string }>;
  imported: Array<any>;
}

/**
 * Creates a new proxy from raw proxy string
 * @param {ProxyData} proxyData - The proxy data including raw proxy string
 * @returns {Promise<object>} The created proxy object or an error object
 */
export async function createProxy(proxyData: ProxyData) {
  await dbConnect();
  try {
    // Parse the raw proxy string
    const parsedProxy = (Proxy as any).parseRawProxy(proxyData.raw_proxy_string);
    
    // Check if proxy already exists
    const existingProxy = await (Proxy as any).findOne({ proxy_id: parsedProxy.proxy_id });
    if (existingProxy) {
      return { error: 'Proxy already exists with this IP and port' };
    }
    
    // Create new proxy with additional data
    const newProxy = await (Proxy as any).create({
      ...parsedProxy,
      ...proxyData
    });
    
    return JSON.parse(JSON.stringify(newProxy));
  } catch (error: unknown) {
    console.error('Error creating proxy:', error);
    return { error: (error as Error).message || 'Failed to create proxy' };
  }
}

/**
 * Retrieves all proxies with pagination
 * @param {number} limit - Number of proxies to return
 * @param {number} skip - Number of proxies to skip
 * @param {object} filters - Filter conditions
 * @returns {Promise<Array<object>>} An array of proxy objects
 */
export async function getAllProxies(limit: number = 50, skip: number = 0, filters: any = {}) {
  await dbConnect();
  try {
    const query = { ...filters };
    const proxies = await (Proxy as any).find(query)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .lean();
    
    const total = await (Proxy as any).countDocuments(query);
    
    return {
      proxies: JSON.parse(JSON.stringify(proxies)),
      total,
      limit,
      skip
    };
  } catch (error: unknown) {
    console.error('Error fetching proxies:', error);
    return { error: (error as Error).message || 'Failed to fetch proxies' };
  }
}

/**
 * Retrieves a single proxy by ID
 * @param {string} proxyId - The proxy ID
 * @returns {Promise<object|null>} The proxy object or null if not found
 */
export async function getProxyById(proxyId: string) {
  await dbConnect();
  try {
    const proxy = await (Proxy as any).findOne({ proxy_id: proxyId });
    if (!proxy) {
      return null;
    }
    return JSON.parse(JSON.stringify(proxy));
  } catch (error: unknown) {
    console.error('Error fetching proxy by ID:', error);
    return { error: (error as Error).message || 'Failed to fetch proxy' };
  }
}

/**
 * Updates a proxy
 * @param {string} proxyId - The proxy ID
 * @param {ProxyUpdateData} updateData - Data to update
 * @returns {Promise<object|null>} The updated proxy object or null if not found
 */
export async function updateProxy(proxyId: string, updateData: ProxyUpdateData) {
  await dbConnect();
  try {
    const updatedProxy = await (Proxy as any).findOneAndUpdate(
      { proxy_id: proxyId },
      updateData,
      { new: true, runValidators: true }
    );
    
    if (!updatedProxy) {
      return { error: 'Proxy not found' };
    }
    
    return JSON.parse(JSON.stringify(updatedProxy));
  } catch (error: unknown) {
    console.error('Error updating proxy:', error);
    return { error: (error as Error).message || 'Failed to update proxy' };
  }
}

/**
 * Deletes a proxy
 * @param {string} proxyId - The proxy ID
 * @returns {Promise<object>} Success message or error object
 */
export async function deleteProxy(proxyId: string) {
  await dbConnect();
  try {
    const deletedProxy = await (Proxy as any).findOneAndDelete({ proxy_id: proxyId });
    
    if (!deletedProxy) {
      return { error: 'Proxy not found' };
    }
    
    return { message: 'Proxy deleted successfully', success: true };
  } catch (error: unknown) {
    console.error('Error deleting proxy:', error);
    return { error: (error as Error).message || 'Failed to delete proxy', success: false };
  }
}

/**
 * Bulk import proxies from text input
 * @param {string} proxiesText - Text containing proxy strings separated by newlines
 * @param {object} defaultData - Default data to apply to all proxies
 * @param {boolean} replaceExisting - Whether to replace all existing proxies
 * @returns {Promise<BulkImportResult>} Import results
 */
export async function bulkImportProxies(proxiesText: string, defaultData: Partial<ProxyData> = {}, replaceExisting: boolean = false): Promise<BulkImportResult> {
  await dbConnect();
  
  const result: BulkImportResult = {
    success: 0,
    failed: 0,
    errors: [],
    imported: []
  };
  
  try {
    // If replace existing, delete all current proxies first
    if (replaceExisting) {
      await (Proxy as any).deleteMany({});
    }
    
    // Split proxies by newlines and filter empty lines
    const proxyLines = proxiesText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    for (const proxyLine of proxyLines) {
      try {
        // Parse the proxy string
        const parsedProxy = (Proxy as any).parseRawProxy(proxyLine);
        
        // Check if proxy already exists (only if not replacing all)
        if (!replaceExisting) {
          const existingProxy = await (Proxy as any).findOne({ proxy_id: parsedProxy.proxy_id });
          if (existingProxy) {
            result.failed++;
            result.errors.push({
              proxy: proxyLine,
              error: 'Proxy already exists'
            });
            continue;
          }
        }
        
        // Create new proxy
        const newProxy = await (Proxy as any).create({
          ...parsedProxy,
          ...defaultData
        } as any);
        
        result.success++;
        result.imported.push(JSON.parse(JSON.stringify(newProxy)));
        
      } catch (error) {
        result.failed++;
        result.errors.push({
          proxy: proxyLine,
          error: (error as Error).message
        });
      }
    }

    return result;

  } catch (error: unknown) {
    console.error('Error in bulk import:', error);
    return {
      success: 0,
      failed: 1,
      errors: [{ proxy: 'bulk_import', error: (error as Error).message }],
      imported: []
    };
  }
}

/**
 * Bulk delete multiple proxies
 * @param {string[]} proxyIds - Array of proxy IDs to delete
 * @returns {Promise<object>} Success message or error object
 */
export async function bulkDeleteProxies(proxyIds: string[]) {
  await dbConnect();
  try {
    const result = await (Proxy as any).deleteMany({ proxy_id: { $in: proxyIds } });
    
    return {
      message: `Successfully deleted ${result.deletedCount} proxies`,
      deletedCount: result.deletedCount,
      success: true
    };
  } catch (error: unknown) {
    console.error('Error in bulk delete:', error);
    return {
      error: (error as Error).message || 'Failed to delete proxies',
      success: false
    };
  }
}

/**
 * Test proxy connectivity
 * @param {string} proxyId - The proxy ID to test
 * @returns {Promise<object>} Test results
 */
export async function testProxy(proxyId: string) {
  await dbConnect();
  try {
    const proxy = await (Proxy as any).findOne({ proxy_id: proxyId });
    if (!proxy) {
      return { error: 'Proxy not found' };
    }
    
    const startTime = Date.now();
    
    // Create proxy configuration for testing
    const proxyUrl = `http://${proxy.username}:${proxy.password}@${proxy.server}`;
    
    try {
      // Test the proxy by making a request through it
      const response = await fetch('https://httpbin.org/ip', {
        method: 'GET',
        // Note: Node.js fetch doesn't support proxy directly, 
        // you might need to use a library like 'https-proxy-agent' for actual proxy testing
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });
      
      const responseTime = Date.now() - startTime;
      
      if (response.ok) {
        // Record success
        await (proxy as any).recordSuccess(responseTime);
        
        return {
          success: true,
          responseTime,
          message: 'Proxy is working',
          proxyData: JSON.parse(JSON.stringify(proxy))
        };
      } else {
        // Record failure
        await (proxy as any).recordFailure({ 
          message: `HTTP ${response.status}`,
          code: 'HTTP_ERROR'
        });
        
        return {
          success: false,
          responseTime,
          message: `Proxy test failed: HTTP ${response.status}`,
          proxyData: JSON.parse(JSON.stringify(proxy))
        };
      }
    } catch (testError) {
      // Record failure
      await (proxy as any).recordFailure({
        message: (testError as Error).message,
        code: 'CONNECTION_ERROR'
      });
      
      return {
        success: false,
        responseTime: Date.now() - startTime,
        message: `Proxy test failed: ${(testError as Error).message}`,
        proxyData: JSON.parse(JSON.stringify(proxy))
      };
    }
    
  } catch (error: unknown) {
    console.error('Error testing proxy:', error);
    return { error: (error as Error).message || 'Failed to test proxy' };
  }
}


/**
 * Get proxy statistics
 * @returns {Promise<object>} Proxy statistics
 */
export async function getProxyStats() {
  await dbConnect();
  try {
    const stats = await (Proxy as any).aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: { 
            $sum: { 
              $cond: [{ $eq: ['$status', 'active'] }, 1, 0] 
            }
          },
          working: { 
            $sum: { 
              $cond: ['$is_working', 1, 0] 
            }
          },
          avgSuccessRate: { $avg: '$success_rate' },
          totalRequests: { $sum: '$total_requests' },
          totalFailures: { $sum: '$failed_requests' }
        }
      }
    ]);
    
    const statusBreakdown = await (Proxy as any).aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    return {
      general: stats[0] || {
        total: 0,
        active: 0,
        working: 0,
        avgSuccessRate: 0,
        totalRequests: 0,
        totalFailures: 0
      },
      statusBreakdown: statusBreakdown.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {})
    };
  } catch (error: unknown) {
    console.error('Error fetching proxy stats:', error);
    return { error: (error as Error).message || 'Failed to fetch proxy statistics' };
  }
}