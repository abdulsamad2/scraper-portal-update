// TypeScript type definitions for CSV operations

export interface CsvGenerationResult {
  success: boolean;
  csv?: string;
  recordCount?: number;
  generationTime?: number;
  message?: string;
  error?: string;
}

export interface CsvUploadResult {
  success: boolean;
  uploadId?: string;
  message?: string;
  error?: string;
}

export interface CsvRow {
  eventId: string;
  eventName: string;
  eventDate: string;
  venue: string;
  section: string;
  row: string;
  seats: string;
  ticketCost: number;
  listPrice: number;
  inHandDate: string;
  notes: string;
}

export interface SchedulerSettings {
  isRunning: boolean;
  scheduleRateMinutes: number;
  uploadToSync: boolean;
  eventUpdateFilterMinutes: number;
  lastRunAt?: Date;
  nextRunAt?: Date;
  totalRuns?: number;
  lastCsvGenerated?: string;
}

export interface SchedulerMetrics {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  averageGenerationTime: number;
  averageUploadTime: number;
  startTime: number;
  lastError?: string;
  uptime?: number;
  uptimeFormatted?: string;
  successRate?: string;
  averageGenerationTimeFormatted?: string;
  averageUploadTimeFormatted?: string;
}

export interface ErrorLogEntry {
  operation: string;
  error: string;
  stack?: string;
  timestamp: Date;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  metadata?: Record<string, never>;
}

export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  operation: string;
}

export interface SyncServiceCredentials {
  uploadUrl: string;
  fields: Record<string, string>;
}

export interface SyncServiceConfig {
  apiUrl: string;
  apiKey: string;
  requestTimeout: number;
  maxRetries: number;
}