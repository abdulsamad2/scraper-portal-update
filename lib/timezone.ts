/**
 * Timezone Utilities for Event Location-Based Time Handling
 * 
 * The auto-delete system needs to know the CURRENT time at the event's location
 * to decide if it's close enough to event time to stop/delete.
 * 
 * Event_DateTime is stored as the local event time (e.g., 7pm) treated as UTC in MongoDB.
 * So we need to get the current time in the event's timezone, then compare it as-if-UTC.
 * 
 * TIMEZONE IS AUTO-DETECTED from the Venue field — no manual input needed.
 */

export const US_TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (ET)', abbr: 'ET' },
  { value: 'America/Chicago', label: 'Central Time (CT)', abbr: 'CT' },
  { value: 'America/Denver', label: 'Mountain Time (MT)', abbr: 'MT' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)', abbr: 'PT' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)', abbr: 'AKT' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HT)', abbr: 'HT' },
] as const;

export type USTimezone = typeof US_TIMEZONES[number]['value'];

// ══════════════════════════════════════════════════════════════════════════════
// VENUE → TIMEZONE AUTO-DETECTION
// Comprehensive mapping of US states, cities, and venue names to timezones
// ══════════════════════════════════════════════════════════════════════════════

/** US State abbreviations and full names → timezone */
const STATE_TIMEZONE_MAP: Record<string, string> = {
  // Eastern Time
  'ct': 'America/New_York', 'connecticut': 'America/New_York',
  'de': 'America/New_York', 'delaware': 'America/New_York',
  'fl': 'America/New_York', 'florida': 'America/New_York',
  'ga': 'America/New_York', 'georgia': 'America/New_York',
  'in': 'America/New_York', 'indiana': 'America/New_York',
  'ky': 'America/New_York', 'kentucky': 'America/New_York',
  'me': 'America/New_York', 'maine': 'America/New_York',
  'md': 'America/New_York', 'maryland': 'America/New_York',
  'ma': 'America/New_York', 'massachusetts': 'America/New_York',
  'mi': 'America/New_York', 'michigan': 'America/New_York',
  'nh': 'America/New_York', 'new hampshire': 'America/New_York',
  'nj': 'America/New_York', 'new jersey': 'America/New_York',
  'ny': 'America/New_York', 'new york': 'America/New_York',
  'nc': 'America/New_York', 'north carolina': 'America/New_York',
  'oh': 'America/New_York', 'ohio': 'America/New_York',
  'pa': 'America/New_York', 'pennsylvania': 'America/New_York',
  'ri': 'America/New_York', 'rhode island': 'America/New_York',
  'sc': 'America/New_York', 'south carolina': 'America/New_York',
  'vt': 'America/New_York', 'vermont': 'America/New_York',
  'va': 'America/New_York', 'virginia': 'America/New_York',
  'wv': 'America/New_York', 'west virginia': 'America/New_York',
  'dc': 'America/New_York', 'washington dc': 'America/New_York', 'district of columbia': 'America/New_York',

  // Central Time
  'al': 'America/Chicago', 'alabama': 'America/Chicago',
  'ar': 'America/Chicago', 'arkansas': 'America/Chicago',
  'il': 'America/Chicago', 'illinois': 'America/Chicago',
  'ia': 'America/Chicago', 'iowa': 'America/Chicago',
  'ks': 'America/Chicago', 'kansas': 'America/Chicago',
  'la': 'America/Chicago', 'louisiana': 'America/Chicago',
  'mn': 'America/Chicago', 'minnesota': 'America/Chicago',
  'ms': 'America/Chicago', 'mississippi': 'America/Chicago',
  'mo': 'America/Chicago', 'missouri': 'America/Chicago',
  'ne': 'America/Chicago', 'nebraska': 'America/Chicago',
  'nd': 'America/Chicago', 'north dakota': 'America/Chicago',
  'ok': 'America/Chicago', 'oklahoma': 'America/Chicago',
  'sd': 'America/Chicago', 'south dakota': 'America/Chicago',
  'tn': 'America/Chicago', 'tennessee': 'America/Chicago',
  'tx': 'America/Chicago', 'texas': 'America/Chicago',
  'wi': 'America/Chicago', 'wisconsin': 'America/Chicago',

  // Mountain Time
  'az': 'America/Denver', 'arizona': 'America/Denver',
  'co': 'America/Denver', 'colorado': 'America/Denver',
  'id': 'America/Denver', 'idaho': 'America/Denver',
  'mt': 'America/Denver', 'montana': 'America/Denver',
  'nm': 'America/Denver', 'new mexico': 'America/Denver',
  'ut': 'America/Denver', 'utah': 'America/Denver',
  'wy': 'America/Denver', 'wyoming': 'America/Denver',

  // Pacific Time
  'ca': 'America/Los_Angeles', 'california': 'America/Los_Angeles',
  'nv': 'America/Los_Angeles', 'nevada': 'America/Los_Angeles',
  'or': 'America/Los_Angeles', 'oregon': 'America/Los_Angeles',
  'wa': 'America/Los_Angeles', 'washington': 'America/Los_Angeles',

  // Alaska & Hawaii
  'ak': 'America/Anchorage', 'alaska': 'America/Anchorage',
  'hi': 'Pacific/Honolulu', 'hawaii': 'Pacific/Honolulu',
};

/** Major US cities → timezone (covers most venue locations) */
const CITY_TIMEZONE_MAP: Record<string, string> = {
  // Eastern Time cities
  'miami': 'America/New_York', 'fort lauderdale': 'America/New_York', 'orlando': 'America/New_York',
  'tampa': 'America/New_York', 'jacksonville': 'America/New_York', 'west palm beach': 'America/New_York',
  'sunrise': 'America/New_York', 'hollywood': 'America/New_York',
  'new york': 'America/New_York', 'nyc': 'America/New_York', 'brooklyn': 'America/New_York',
  'bronx': 'America/New_York', 'queens': 'America/New_York', 'manhattan': 'America/New_York',
  'long island': 'America/New_York', 'elmont': 'America/New_York',
  'boston': 'America/New_York', 'cambridge': 'America/New_York', 'foxborough': 'America/New_York',
  'philadelphia': 'America/New_York', 'philly': 'America/New_York', 'pittsburgh': 'America/New_York',
  'atlanta': 'America/New_York', 'savannah': 'America/New_York',
  'charlotte': 'America/New_York', 'raleigh': 'America/New_York', 'durham': 'America/New_York',
  'washington': 'America/New_York', 'baltimore': 'America/New_York', 'arlington': 'America/New_York',
  'richmond': 'America/New_York', 'norfolk': 'America/New_York', 'virginia beach': 'America/New_York',
  'detroit': 'America/New_York', 'grand rapids': 'America/New_York',
  'cleveland': 'America/New_York', 'columbus': 'America/New_York', 'cincinnati': 'America/New_York',
  'indianapolis': 'America/New_York', 'indy': 'America/New_York',
  'newark': 'America/New_York', 'east rutherford': 'America/New_York', 'atlantic city': 'America/New_York',
  'hartford': 'America/New_York', 'uncasville': 'America/New_York',
  'charleston': 'America/New_York', 'greenville': 'America/New_York',
  'louisville': 'America/New_York', 'lexington': 'America/New_York',
  'buffalo': 'America/New_York', 'rochester': 'America/New_York', 'albany': 'America/New_York',
  'providence': 'America/New_York', 'portland me': 'America/New_York',

  // Central Time cities
  'chicago': 'America/Chicago', 'evanston': 'America/Chicago', 'rosemont': 'America/Chicago',
  'dallas': 'America/Chicago', 'fort worth': 'America/Chicago', 'arlington tx': 'America/Chicago',
  'houston': 'America/Chicago', 'san antonio': 'America/Chicago', 'austin': 'America/Chicago',
  'nashville': 'America/Chicago', 'memphis': 'America/Chicago', 'knoxville': 'America/Chicago',
  'new orleans': 'America/Chicago', 'baton rouge': 'America/Chicago',
  'milwaukee': 'America/Chicago', 'madison': 'America/Chicago', 'green bay': 'America/Chicago',
  'minneapolis': 'America/Chicago', 'st paul': 'America/Chicago', 'saint paul': 'America/Chicago',
  'st louis': 'America/Chicago', 'saint louis': 'America/Chicago', 'kansas city': 'America/Chicago',
  'oklahoma city': 'America/Chicago', 'tulsa': 'America/Chicago',
  'omaha': 'America/Chicago', 'lincoln': 'America/Chicago',
  'des moines': 'America/Chicago', 'cedar rapids': 'America/Chicago',
  'birmingham': 'America/Chicago', 'mobile': 'America/Chicago', 'huntsville': 'America/Chicago',
  'little rock': 'America/Chicago', 'jackson': 'America/Chicago',
  'wichita': 'America/Chicago', 'fargo': 'America/Chicago', 'sioux falls': 'America/Chicago',

  // Mountain Time cities
  'denver': 'America/Denver', 'colorado springs': 'America/Denver', 'boulder': 'America/Denver',
  'phoenix': 'America/Denver', 'scottsdale': 'America/Denver', 'tempe': 'America/Denver',
  'tucson': 'America/Denver', 'glendale az': 'America/Denver',
  'salt lake city': 'America/Denver', 'provo': 'America/Denver',
  'albuquerque': 'America/Denver', 'santa fe': 'America/Denver',
  'boise': 'America/Denver', 'billings': 'America/Denver',
  'cheyenne': 'America/Denver', 'missoula': 'America/Denver',
  'el paso': 'America/Denver', // El Paso is Mountain Time despite being in TX

  // Pacific Time cities
  'los angeles': 'America/Los_Angeles', 'la': 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles', 'sf': 'America/Los_Angeles',
  'san diego': 'America/Los_Angeles', 'san jose': 'America/Los_Angeles',
  'sacramento': 'America/Los_Angeles', 'oakland': 'America/Los_Angeles',
  'anaheim': 'America/Los_Angeles', 'inglewood': 'America/Los_Angeles',
  'long beach': 'America/Los_Angeles', 'fresno': 'America/Los_Angeles',
  'irvine': 'America/Los_Angeles', 'santa clara': 'America/Los_Angeles',
  'seattle': 'America/Los_Angeles', 'tacoma': 'America/Los_Angeles',
  'portland': 'America/Los_Angeles', 'portland or': 'America/Los_Angeles',
  'eugene': 'America/Los_Angeles', 'spokane': 'America/Los_Angeles',
  'las vegas': 'America/Los_Angeles', 'vegas': 'America/Los_Angeles', 'reno': 'America/Los_Angeles',
  'paradise': 'America/Los_Angeles', // Las Vegas venues often list Paradise, NV

  // Alaska & Hawaii cities
  'anchorage': 'America/Anchorage', 'fairbanks': 'America/Anchorage', 'juneau': 'America/Anchorage',
  'honolulu': 'Pacific/Honolulu', 'maui': 'Pacific/Honolulu', 'kailua': 'Pacific/Honolulu',

  // Standalone city names that may appear without state
  'york': 'America/New_York', // York, PA
  'stateline': 'America/Los_Angeles', // Stateline, NV (Lake Tahoe)
};

/** Well-known venue names → timezone */
const VENUE_NAME_TIMEZONE_MAP: Record<string, string> = {
  // Eastern
  'madison square garden': 'America/New_York', 'msg': 'America/New_York',
  'barclays center': 'America/New_York', 'metlife stadium': 'America/New_York',
  'yankee stadium': 'America/New_York', 'citi field': 'America/New_York',
  'ubs arena': 'America/New_York', 'prudential center': 'America/New_York',
  'td garden': 'America/New_York', 'fenway park': 'America/New_York', 'gillette stadium': 'America/New_York',
  'wells fargo center': 'America/New_York', 'lincoln financial field': 'America/New_York', 'citizens bank park': 'America/New_York',
  'capital one arena': 'America/New_York', 'nationals park': 'America/New_York', 'fedex field': 'America/New_York',
  'state farm arena': 'America/New_York', 'mercedes benz stadium': 'America/New_York', 'truist park': 'America/New_York',
  'hard rock stadium': 'America/New_York', 'kaseya center': 'America/New_York', 'amerant bank arena': 'America/New_York',
  'amalie arena': 'America/New_York', 'raymond james stadium': 'America/New_York',
  'amway center': 'America/New_York', 'camping world stadium': 'America/New_York',
  'ppg paints arena': 'America/New_York', 'acrisure stadium': 'America/New_York', 'pnc park': 'America/New_York',
  'rocket mortgage fieldhouse': 'America/New_York', 'progressive field': 'America/New_York',
  'little caesars arena': 'America/New_York', 'ford field': 'America/New_York', 'comerica park': 'America/New_York',
  'gainbridge fieldhouse': 'America/New_York', 'lucas oil stadium': 'America/New_York',
  'spectrum center': 'America/New_York', 'bank of america stadium': 'America/New_York',
  'mohegan sun arena': 'America/New_York', 'ubs arena at belmont park': 'America/New_York',

  // Central
  'united center': 'America/Chicago', 'wrigley field': 'America/Chicago', 'soldier field': 'America/Chicago', 'guaranteed rate field': 'America/Chicago',
  'at&t stadium': 'America/Chicago', 'globe life field': 'America/Chicago', 'american airlines center': 'America/Chicago',
  'minute maid park': 'America/Chicago', 'toyota center': 'America/Chicago', 'nrg stadium': 'America/Chicago',
  'bridgestone arena': 'America/Chicago', 'nissan stadium': 'America/Chicago', 'geodis park': 'America/Chicago',
  'caesars superdome': 'America/Chicago', 'smoothie king center': 'America/Chicago',
  'fiserv forum': 'America/Chicago', 'american family field': 'America/Chicago', 'lambeau field': 'America/Chicago',
  'target center': 'America/Chicago', 'us bank stadium': 'America/Chicago', 'target field': 'America/Chicago',
  'busch stadium': 'America/Chicago', 'enterprise center': 'America/Chicago',
  'arrowhead stadium': 'America/Chicago', 'kauffman stadium': 'America/Chicago', 't-mobile center': 'America/Chicago',
  'paycom center': 'America/Chicago', 'frost bank center': 'America/Chicago', 'alamodome': 'America/Chicago',
  'moody center': 'America/Chicago', 'q2 stadium': 'America/Chicago',

  // Mountain
  'ball arena': 'America/Denver', 'empower field': 'America/Denver', 'coors field': 'America/Denver',
  'footprint center': 'America/Denver', 'chase field': 'America/Denver', 'state farm stadium': 'America/Denver',
  'desert diamond arena': 'America/Denver',
  'delta center': 'America/Denver', 'rio tinto stadium': 'America/Denver', 'smith ballpark': 'America/Denver',
  'isotopes park': 'America/Denver', 'pit arena': 'America/Denver',

  // Pacific
  'sofi stadium': 'America/Los_Angeles', 'crypto.com arena': 'America/Los_Angeles', 'dodger stadium': 'America/Los_Angeles',
  'the forum': 'America/Los_Angeles', 'intuit dome': 'America/Los_Angeles', 'bmo stadium': 'America/Los_Angeles',
  'honda center': 'America/Los_Angeles', 'angel stadium': 'America/Los_Angeles',
  'petco park': 'America/Los_Angeles', 'snapdragon stadium': 'America/Los_Angeles', 'pechanga arena': 'America/Los_Angeles',
  'oracle park': 'America/Los_Angeles', 'chase center': 'America/Los_Angeles', 'oakland arena': 'America/Los_Angeles',
  'sap center': 'America/Los_Angeles', 'paypal park': 'America/Los_Angeles', 'levi stadium': 'America/Los_Angeles',
  'golden 1 center': 'America/Los_Angeles',
  'lumen field': 'America/Los_Angeles', 'climate pledge arena': 'America/Los_Angeles', 't-mobile park': 'America/Los_Angeles',
  'moda center': 'America/Los_Angeles', 'providence park': 'America/Los_Angeles',
  't-mobile arena': 'America/Los_Angeles', 'allegiant stadium': 'America/Los_Angeles',
  'mgm grand garden arena': 'America/Los_Angeles', 'sphere': 'America/Los_Angeles',
  'michelob ultra arena': 'America/Los_Angeles',
  'dolby live': 'America/Los_Angeles', 'dolby live at park mgm': 'America/Los_Angeles',
  'ph live at planet hollywood': 'America/Los_Angeles', 'ph live': 'America/Los_Angeles',
  'the colosseum at caesars palace': 'America/Los_Angeles', 'colosseum at caesars': 'America/Los_Angeles',
  'the venetian theatre': 'America/Los_Angeles', 'venetian theatre': 'America/Los_Angeles',
  'encore theater': 'America/Los_Angeles', 'encore theater at wynn': 'America/Los_Angeles',
  'palazzo theatre': 'America/Los_Angeles', 'palazzo theatre at the venetian': 'America/Los_Angeles',
  'the cosmopolitan': 'America/Los_Angeles', 'cosmopolitan of las vegas': 'America/Los_Angeles',
  'penn & teller theater': 'America/Los_Angeles', 'penn and teller theater': 'America/Los_Angeles',
  'westgate las vegas': 'America/Los_Angeles', 'fontainebleau las vegas': 'America/Los_Angeles',
  'tahoe blue event center': 'America/Los_Angeles',
  'nugget casino': 'America/Los_Angeles', 'nugget event center': 'America/Los_Angeles',
  'grand sierra resort': 'America/Los_Angeles', 'reno events center': 'America/Los_Angeles',
  'kia forum': 'America/Los_Angeles',
  'greek theatre': 'America/Los_Angeles', 'hollywood bowl': 'America/Los_Angeles',
  'the wiltern': 'America/Los_Angeles', 'rose bowl': 'America/Los_Angeles',
};

/**
 * Auto-detect timezone from venue text.
 * Checks venue name, then city, then state abbreviation/name from every segment.
 * Returns null if no timezone can be determined — callers must handle this.
 * 
 * @param venue - The venue string from the event (e.g., "Hard Rock Stadium, Miami, FL")
 * @returns IANA timezone string or null if undetectable
 */
export function detectTimezoneFromVenue(venue: string): string | null {
  if (!venue || venue.trim().length === 0) {
    return null;
  }

  const venueLC = venue.toLowerCase().trim();

  // Helper: match a term against text — short terms (<=3 chars) require word boundaries
  // to avoid false matches (e.g. "la" matching inside "maryland")
  const matchesTerm = (text: string, term: string): boolean => {
    if (term.length <= 3) {
      const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      return regex.test(text);
    }
    return text.includes(term);
  };

  // 1) Check known venue names first (most specific match)
  for (const [venueName, tz] of Object.entries(VENUE_NAME_TIMEZONE_MAP)) {
    if (venueLC.includes(venueName)) {
      return tz;
    }
  }

  // 2) Check city names against full venue text (word-boundary safe)
  for (const [city, tz] of Object.entries(CITY_TIMEZONE_MAP)) {
    if (matchesTerm(venueLC, city)) {
      return tz;
    }
  }

  // 3) Split by commas, hyphens, pipes and check each segment
  const segments = venueLC.split(/[,|–\-]+/).map(s => s.trim()).filter(Boolean);

  for (const segment of segments) {
    // Check each segment for a 2-letter state abbreviation (as a standalone word)
    const words = segment.split(/\s+/);
    for (const word of words) {
      const clean = word.replace(/[^a-z]/g, '');
      if (clean.length === 2 && STATE_TIMEZONE_MAP[clean]) {
        return STATE_TIMEZONE_MAP[clean];
      }
    }

    // Check each segment for a full state name
    for (const [state, tz] of Object.entries(STATE_TIMEZONE_MAP)) {
      if (state.length > 2 && segment.includes(state)) {
        return tz;
      }
    }

    // Check each segment as a potential city name (word-boundary safe)
    for (const [city, tz] of Object.entries(CITY_TIMEZONE_MAP)) {
      if (matchesTerm(segment, city)) {
        return tz;
      }
    }
  }

  // 4) Last resort: check the whole text for any 2-letter state abbreviation as a standalone word
  const allWords = venueLC.split(/\s+/);
  for (const word of allWords) {
    const clean = word.replace(/[^a-z]/g, '');
    if (clean.length === 2 && STATE_TIMEZONE_MAP[clean]) {
      return STATE_TIMEZONE_MAP[clean];
    }
  }

  // 5) Check for full state names anywhere in the full text
  for (const [state, tz] of Object.entries(STATE_TIMEZONE_MAP)) {
    if (state.length > 2 && venueLC.includes(state)) {
      return tz;
    }
  }

  // No match found — return null so callers can handle it (skip event, log warning)
  console.warn(`Timezone auto-detect: Could not determine timezone from venue "${venue}"`);
  return null;
}

/**
 * Get the current date/time in a specific timezone, returned as a "fake UTC" Date object.
 * 
 * Since Event_DateTime is stored as-if-UTC (e.g., 7pm event stored as 7pm UTC),
 * we need to get "what time is it NOW in Florida?" and express that as a UTC Date
 * so we can directly compare with Event_DateTime.
 * 
 * Example: 
 *   - It's 5:00pm in New York (which is 10:00pm UTC)
 *   - Event is at 7:00pm stored as 2025-06-15T19:00:00.000Z
 *   - getCurrentTimeInTimezone('America/New_York') returns Date for 2025-06-15T17:00:00.000Z
 *   - So we can compare: 17:00 + 2 hours = 19:00, event at 19:00 → should be stopped
 */
export function getCurrentTimeInTimezone(timezone: string): Date {
  // Get current time formatted in the target timezone
  const now = new Date();
  
  // Use Intl.DateTimeFormat to get the date/time components in the target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  
  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '0';
  
  const year = parseInt(get('year'));
  const month = parseInt(get('month')) - 1; // Date months are 0-indexed
  const day = parseInt(get('day'));
  const hour = parseInt(get('hour')) === 24 ? 0 : parseInt(get('hour'));
  const minute = parseInt(get('minute'));
  const second = parseInt(get('second'));
  
  // Create a UTC Date that represents the local time in that timezone
  // This makes it directly comparable with Event_DateTime (which is also stored as-if-UTC)
  return new Date(Date.UTC(year, month, day, hour, minute, second));
}

/**
 * Check if an event should be stopped/deleted based on its timezone-aware local time.
 * Auto-detects timezone from venue text.
 * Returns null if timezone cannot be detected — the event should be SKIPPED (not deleted).
 * 
 * @param eventDateTime - The event's datetime (stored as-if-UTC, representing local time)
 * @param venue - The venue text from the event (used to auto-detect timezone)
 * @param stopBeforeHours - Hours before event to trigger stop/delete
 * @returns result object or null if timezone undetectable
 */
export function shouldStopEvent(
  eventDateTime: Date,
  venue: string,
  stopBeforeHours: number
): { shouldStop: boolean; timezone: string; localNow: Date; cutoff: Date } | null {
  // Auto-detect timezone from venue
  const timezone = detectTimezoneFromVenue(venue);
  
  if (!timezone) {
    // Cannot determine timezone — skip this event
    return null;
  }
  
  // Get current time in the event's timezone (as fake-UTC for comparison)
  const nowInEventTz = getCurrentTimeInTimezone(timezone);
  
  // Add stopBeforeHours to current local time
  const cutoffTime = new Date(nowInEventTz.getTime() + stopBeforeHours * 60 * 60 * 1000);
  
  // If event time <= cutoff time, it should be stopped
  return {
    shouldStop: eventDateTime.getTime() <= cutoffTime.getTime(),
    timezone,
    localNow: nowInEventTz,
    cutoff: cutoffTime,
  };
}

/**
 * Get the timezone abbreviation for display
 */
export function getTimezoneAbbr(timezone: string): string {
  const tz = US_TIMEZONES.find(t => t.value === timezone);
  return tz?.abbr || 'ET';
}

/**
 * Get the timezone label for display
 */
export function getTimezoneLabel(timezone: string): string {
  const tz = US_TIMEZONES.find(t => t.value === timezone);
  return tz?.label || 'Eastern Time (ET)';
}

/**
 * Format a time showing what the current local time is in a timezone
 */
export function formatCurrentTimeInTimezone(timezone: string): string {
  const now = new Date();
  return now.toLocaleString('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    month: 'short',
    day: 'numeric',
  });
}
