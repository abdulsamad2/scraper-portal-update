/**
 * Accurate Time Sync via Free Public APIs
 * 
 * The server's system clock can drift or be misconfigured.
 * This module fetches accurate UTC time from free public APIs,
 * calculates the offset (drift) between the server clock and real time,
 * and provides a corrected `getAccurateNow()` for use in the auto-delete system.
 * 
 * APIs used (in fallback order, all free, no API key needed):
 *   1. WorldTimeAPI  — worldtimeapi.org
 *   2. TimeAPI.io    — timeapi.io
 * 
 * The offset is cached and re-synced every 30 minutes to avoid
 * hammering the API on every event check.
 */

// Offset in milliseconds: (accurate UTC) - (system UTC)
// If positive → system clock is behind real time
// If negative → system clock is ahead of real time
let _clockOffsetMs: number = 0;
let _lastSyncAt: number = 0; // system timestamp of last successful sync
let _syncInProgress: Promise<void> | null = null;

const SYNC_INTERVAL_MS = 30 * 60 * 1000; // Re-sync every 30 minutes
const FETCH_TIMEOUT_MS = 8000; // 8 second timeout per API call

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Returns an accurate `Date` object corrected by the offset from a time API.
 * Falls back to `new Date()` if no sync has completed yet.
 */
export function getAccurateNow(): Date {
  return new Date(Date.now() + _clockOffsetMs);
}

/**
 * Get the current clock offset in milliseconds.
 * Positive = system is behind, Negative = system is ahead.
 */
export function getClockOffset(): number {
  return _clockOffsetMs;
}

/**
 * Returns diagnostic info about the time sync state.
 */
export function getTimeSyncStatus() {
  return {
    offsetMs: _clockOffsetMs,
    offsetSeconds: Math.round(_clockOffsetMs / 1000),
    lastSyncAt: _lastSyncAt ? new Date(_lastSyncAt).toISOString() : null,
    isSynced: _lastSyncAt > 0,
    nextSyncIn: _lastSyncAt
      ? Math.max(0, SYNC_INTERVAL_MS - (Date.now() - _lastSyncAt))
      : 0,
  };
}

/**
 * Ensure the clock is synced. Call this before auto-delete runs.
 * If already synced recently, returns immediately.
 * Multiple concurrent callers share the same in-flight sync promise.
 */
export async function ensureTimeSynced(): Promise<void> {
  const elapsed = Date.now() - _lastSyncAt;
  if (_lastSyncAt > 0 && elapsed < SYNC_INTERVAL_MS) {
    return; // Still fresh
  }

  // Deduplicate concurrent sync requests
  if (_syncInProgress) {
    return _syncInProgress;
  }

  _syncInProgress = syncClock();
  try {
    await _syncInProgress;
  } finally {
    _syncInProgress = null;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// INTERNAL — API FETCHERS
// ══════════════════════════════════════════════════════════════════════════════

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * WorldTimeAPI — returns { utc_datetime: "2026-02-24T14:30:00.123456+00:00", ... }
 */
async function fetchFromWorldTimeAPI(): Promise<number | null> {
  try {
    const beforeMs = Date.now();
    const res = await fetchWithTimeout('http://worldtimeapi.org/api/timezone/Etc/UTC', FETCH_TIMEOUT_MS);
    const afterMs = Date.now();
    if (!res.ok) return null;

    const data = await res.json();
    const utcDatetime: string = data.utc_datetime; // e.g. "2026-02-24T14:30:00.123456+00:00"
    if (!utcDatetime) return null;

    const apiTimeMs = new Date(utcDatetime).getTime();
    // Account for network round-trip: assume the API timestamp is midway through the request
    const midpointMs = (beforeMs + afterMs) / 2;
    return apiTimeMs - midpointMs;
  } catch {
    return null;
  }
}

/**
 * TimeAPI.io — returns { dateTime: "2026-02-24T14:30:00.123", timeZone: "UTC", ... }
 */
async function fetchFromTimeAPI(): Promise<number | null> {
  try {
    const beforeMs = Date.now();
    const res = await fetchWithTimeout(
      'https://timeapi.io/api/time/current/zone?timeZone=UTC',
      FETCH_TIMEOUT_MS
    );
    const afterMs = Date.now();
    if (!res.ok) return null;

    const data = await res.json();
    const dateTime: string = data.dateTime; // e.g. "2026-02-24T14:30:00.123"
    if (!dateTime) return null;

    // TimeAPI.io returns local time in the requested zone without offset suffix, append Z for UTC
    const apiTimeMs = new Date(dateTime + 'Z').getTime();
    const midpointMs = (beforeMs + afterMs) / 2;
    return apiTimeMs - midpointMs;
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SYNC LOGIC
// ══════════════════════════════════════════════════════════════════════════════

async function syncClock(): Promise<void> {
  console.log('[TimeSync] Syncing clock with external time API...');

  // Try APIs in order; stop at first success
  const fetchers = [
    { name: 'WorldTimeAPI', fn: fetchFromWorldTimeAPI },
    { name: 'TimeAPI.io', fn: fetchFromTimeAPI },
  ];

  for (const { name, fn } of fetchers) {
    const offset = await fn();
    if (offset !== null) {
      _clockOffsetMs = offset;
      _lastSyncAt = Date.now();
      const sign = offset >= 0 ? '+' : '';
      console.log(
        `[TimeSync] ✓ Synced via ${name} — offset: ${sign}${Math.round(offset)}ms (${sign}${(offset / 1000).toFixed(1)}s)`
      );
      return;
    }
    console.warn(`[TimeSync] ✗ ${name} failed, trying next...`);
  }

  // All APIs failed
  if (_lastSyncAt > 0) {
    console.warn('[TimeSync] All APIs failed. Keeping previous offset:', _clockOffsetMs, 'ms');
  } else {
    console.warn('[TimeSync] All APIs failed. Using system clock (offset = 0).');
  }
}
