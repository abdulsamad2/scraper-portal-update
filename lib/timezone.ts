/**
 * Timezone Utilities for Event Location-Based Time Handling
 * 
 * Uses the `city-timezones` open-source library (7,300+ cities worldwide)
 * for automatic timezone detection from venue text.
 * 
 * The auto-delete system needs to know the CURRENT time at the event's location
 * to decide if it's close enough to event time to stop/delete.
 * 
 * Event_DateTime is stored as the local event time (e.g., 7pm) treated as UTC in MongoDB.
 * So we need to get the current time in the event's timezone, then compare it as-if-UTC.
 * 
 * TIMEZONE IS AUTO-DETECTED from the Venue field — no manual input needed.
 */

import cityTimezones from 'city-timezones';
import { getAccurateNow } from './timeSync';

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
// TIMEZONE NAME NORMALIZATION
// The library returns city-specific IANA names (e.g., America/Detroit).
// We normalize to standard US timezone names for consistency.
// ══════════════════════════════════════════════════════════════════════════════

const TIMEZONE_NORMALIZE_MAP: Record<string, string> = {
  // Eastern Time variants
  'America/Detroit': 'America/New_York',
  'America/Toronto': 'America/New_York',
  'America/Montreal': 'America/New_York',
  'America/Nassau': 'America/New_York',
  'America/Iqaluit': 'America/New_York',
  'America/Nipigon': 'America/New_York',
  'America/Thunder_Bay': 'America/New_York',
  'America/Pangnirtung': 'America/New_York',
  'America/Indiana/Indianapolis': 'America/New_York',
  'America/Indiana/Marengo': 'America/New_York',
  'America/Indiana/Vevay': 'America/New_York',
  'America/Kentucky/Louisville': 'America/New_York',
  'America/Kentucky/Monticello': 'America/New_York',

  // Central Time variants
  'America/Winnipeg': 'America/Chicago',
  'America/Regina': 'America/Chicago',
  'America/Rainy_River': 'America/Chicago',
  'America/Rankin_Inlet': 'America/Chicago',
  'America/Resolute': 'America/Chicago',
  'America/Menominee': 'America/Chicago',
  'America/Indiana/Knox': 'America/Chicago',
  'America/Indiana/Tell_City': 'America/Chicago',
  'America/North_Dakota/Center': 'America/Chicago',
  'America/North_Dakota/New_Salem': 'America/Chicago',
  'America/North_Dakota/Beulah': 'America/Chicago',
  'America/Matamoros': 'America/Chicago',

  // Mountain Time variants
  'America/Phoenix': 'America/Denver',
  'America/Edmonton': 'America/Denver',
  'America/Boise': 'America/Denver',
  'America/Cambridge_Bay': 'America/Denver',
  'America/Yellowknife': 'America/Denver',
  'America/Inuvik': 'America/Denver',
  'America/Ojinaga': 'America/Denver',

  // Pacific Time variants
  'America/Vancouver': 'America/Los_Angeles',
  'America/Dawson_Creek': 'America/Los_Angeles',
  'America/Tijuana': 'America/Los_Angeles',
  'America/Whitehorse': 'America/Los_Angeles',

  // Alaska
  'America/Juneau': 'America/Anchorage',
  'America/Sitka': 'America/Anchorage',
  'America/Yakutat': 'America/Anchorage',
  'America/Nome': 'America/Anchorage',
  'America/Metlakatla': 'America/Anchorage',

  // Hawaii
  'Pacific/Johnston': 'Pacific/Honolulu',
};

function normalizeTimezone(tz: string): string {
  return TIMEZONE_NORMALIZE_MAP[tz] || tz;
}

// ══════════════════════════════════════════════════════════════════════════════
// CITY-TIMEZONES LIBRARY INDEX
// Build a normalized, accent-stripped, population-sorted lookup from 7,300+ cities
// ══════════════════════════════════════════════════════════════════════════════

interface CityEntry {
  city: string;
  province: string;
  iso2: string;
  pop: number;
  timezone: string;
}

/** Strip accents and lowercase for matching */
function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** Pre-built city lookup index: normalized name → sorted city entries (US first, CA second, then all others by population) */
const CITY_INDEX = buildCityIndex();

function buildCityIndex(): Map<string, CityEntry[]> {
  const index = new Map<string, CityEntry[]>();

  for (const c of cityTimezones.cityMapping) {
    const entry: CityEntry = {
      city: c.city,
      province: c.province || '',
      iso2: c.iso2,
      pop: c.pop || 0,
      timezone: c.timezone,
    };

    // Index by normalized full city name
    const fullName = normalizeText(c.city);
    if (!index.has(fullName)) index.set(fullName, []);
    index.get(fullName)!.push(entry);

    // Also index by the main part before comma/period (e.g., "Washington, D.C." → "washington")
    const mainPart = normalizeText(c.city.split(/[,.]/)[0]);
    if (mainPart !== fullName && mainPart.length > 2) {
      if (!index.has(mainPart)) index.set(mainPart, []);
      index.get(mainPart)!.push(entry);
    }

    // Also index by ascii name if available and different
    if (c.city_ascii) {
      const asciiName = normalizeText(c.city_ascii);
      if (asciiName !== fullName && asciiName.length > 2) {
        if (!index.has(asciiName)) index.set(asciiName, []);
        index.get(asciiName)!.push(entry);
      }
    }
  }

  // Sort each entry list: US first, CA second, then by population descending
  for (const [, entries] of index) {
    entries.sort((a, b) => {
      const countryRank = (iso: string) => iso === 'US' ? 0 : iso === 'CA' ? 1 : 2;
      const rankDiff = countryRank(a.iso2) - countryRank(b.iso2);
      if (rankDiff !== 0) return rankDiff;
      return b.pop - a.pop;
    });
  }

  return index;
}

/** Look up a city name in the library index, returns normalized timezone or null */
function lookupCityTimezone(cityName: string): string | null {
  const normalized = normalizeText(cityName);
  const entries = CITY_INDEX.get(normalized);
  if (entries && entries.length > 0) {
    return normalizeTimezone(entries[0].timezone);
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// STATE / PROVINCE ABBREVIATION MAP (library doesn't support 2-letter codes)
// ══════════════════════════════════════════════════════════════════════════════

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

  // Canadian Provinces
  'on': 'America/New_York', 'ontario': 'America/New_York',
  'qc': 'America/New_York', 'quebec': 'America/New_York',
  'ns': 'America/New_York', 'nova scotia': 'America/New_York',
  'nb': 'America/New_York', 'new brunswick': 'America/New_York',
  'pe': 'America/New_York', 'prince edward island': 'America/New_York',
  'nl': 'America/New_York', 'newfoundland': 'America/New_York',
  'mb': 'America/Chicago', 'manitoba': 'America/Chicago',
  'sk': 'America/Chicago', 'saskatchewan': 'America/Chicago',
  'ab': 'America/Denver', 'alberta': 'America/Denver',
  'bc': 'America/Los_Angeles', 'british columbia': 'America/Los_Angeles',
};

// ══════════════════════════════════════════════════════════════════════════════
// VENUE NAME MAP (specific venue names → timezone)
// The library has cities, but can't map "Madison Square Garden" → timezone.
// ══════════════════════════════════════════════════════════════════════════════

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

  // Canadian venues
  'centre bell': 'America/New_York', 'bell centre': 'America/New_York',
  'canadian tire centre': 'America/New_York',
  'scotiabank arena': 'America/New_York', 'rogers centre': 'America/New_York',
  'bmo field': 'America/New_York',
  'bell center': 'America/New_York',
  'place bell': 'America/New_York',
  'videotron centre': 'America/New_York',
  'td place': 'America/New_York',
  'scotiabank centre': 'America/New_York',
  'canada life centre': 'America/Chicago',
  'saddledome': 'America/Denver', 'scotiabank saddledome': 'America/Denver',
  'rogers place': 'America/Denver',
  'rogers arena': 'America/Los_Angeles',
  'bc place': 'America/Los_Angeles',
};

// ══════════════════════════════════════════════════════════════════════════════
// FRAGMENT / KEYWORD MAP
// Some venue fields contain only partial location words (e.g., "Carolina",
// "Columbia", "Jersey"). These won't match in the city-timezones library.
// ══════════════════════════════════════════════════════════════════════════════

const FRAGMENT_TIMEZONE_MAP: Record<string, string> = {
  'carolina': 'America/New_York',      // North/South Carolina → ET
  'columbia': 'America/New_York',      // District of Columbia → ET
  'jersey': 'America/New_York',        // New Jersey → ET
  'york': 'America/New_York',          // New York / York, PA → ET
  'hampshire': 'America/New_York',     // New Hampshire → ET
  'england': 'America/New_York',       // New England → ET
  'virginia': 'America/New_York',      // Virginia / West Virginia → ET
  'dakota': 'America/Chicago',         // North/South Dakota → CT
  'mexico': 'America/Denver',          // New Mexico → MT
};

// ══════════════════════════════════════════════════════════════════════════════
// MAIN DETECTION FUNCTION
// ══════════════════════════════════════════════════════════════════════════════

// Cache for live API results: venue → IANA timezone (or 'NONE' if API returned nothing)
const _liveApiCache = new Map<string, string>();

/**
 * Auto-detect timezone from venue text (synchronous — static data only).
 * 
 * Detection order:
 *   1. Known venue names (MSG, TD Garden, etc.)
 *   2. City lookup via city-timezones library (7,300+ cities, population-sorted)
 *   3. Individual words from venue tried as city names
 *   4. Multi-word combinations (e.g., "San Francisco", "New York")
 *   5. State/province abbreviations and full names
 *   6. Fragment keywords (carolina, columbia, jersey, etc.)
 * 
 * Returns null if no timezone can be determined — callers must handle this.
 */
export function detectTimezoneFromVenue(venue: string): string | null {
  if (!venue || venue.trim().length === 0) {
    return null;
  }

  // Check live API cache first
  const cacheKey = venue.trim().toLowerCase();
  const cached = _liveApiCache.get(cacheKey);
  if (cached) return cached === 'NONE' ? null : cached;

  const venueNorm = normalizeText(venue);

  // Helper: short terms (<=3 chars) require word boundaries to avoid false matches
  const matchesTerm = (text: string, term: string): boolean => {
    if (term.length <= 3) {
      const regex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      return regex.test(text);
    }
    return text.includes(term);
  };

  // ── Step 1: Check known venue names (most specific match) ──
  for (const [venueName, tz] of Object.entries(VENUE_NAME_TIMEZONE_MAP)) {
    if (venueNorm.includes(venueName)) {
      return tz;
    }
  }

  // ── Step 2: City lookup via library (full text, then segments) ──
  const fullLookup = lookupCityTimezone(venueNorm);
  if (fullLookup) return fullLookup;

  const segments = venueNorm.split(/[,|–\-]+/).map(s => s.trim()).filter(Boolean);
  for (const segment of segments) {
    const segLookup = lookupCityTimezone(segment);
    if (segLookup) return segLookup;
  }

  // ── Step 2b: Try individual words as city names (≥3 chars to avoid noise) ──
  const allWords = venueNorm.split(/\s+/).filter(w => w.length >= 3);
  for (const word of allWords) {
    const clean = word.replace(/[^a-z]/g, '');
    if (clean.length >= 3) {
      const wordLookup = lookupCityTimezone(clean);
      if (wordLookup) return wordLookup;
    }
  }

  // ── Step 2c: Try consecutive 2-word and 3-word combinations ──
  // Catches "San Francisco", "Los Angeles", "New York", "Salt Lake City", etc.
  const rawWords = venueNorm.split(/\s+/);
  for (let i = 0; i < rawWords.length - 1; i++) {
    const twoWord = rawWords[i] + ' ' + rawWords[i + 1];
    const twoLookup = lookupCityTimezone(twoWord);
    if (twoLookup) return twoLookup;

    if (i < rawWords.length - 2) {
      const threeWord = twoWord + ' ' + rawWords[i + 2];
      const threeLookup = lookupCityTimezone(threeWord);
      if (threeLookup) return threeLookup;
    }
  }

  // ── Step 3: State/province abbreviation and full name check ──
  for (const segment of segments) {
    const words = segment.split(/\s+/);
    for (const word of words) {
      const clean = word.replace(/[^a-z]/g, '');
      if (clean.length === 2 && STATE_TIMEZONE_MAP[clean]) {
        return STATE_TIMEZONE_MAP[clean];
      }
    }
    for (const [state, tz] of Object.entries(STATE_TIMEZONE_MAP)) {
      if (state.length > 2 && segment.includes(state)) {
        return tz;
      }
    }
  }

  // Full text fallback for state abbreviations
  for (const word of allWords) {
    const clean = word.replace(/[^a-z]/g, '');
    if (clean.length === 2 && STATE_TIMEZONE_MAP[clean]) {
      return STATE_TIMEZONE_MAP[clean];
    }
  }
  for (const [state, tz] of Object.entries(STATE_TIMEZONE_MAP)) {
    if (state.length > 2 && venueNorm.includes(state)) {
      return tz;
    }
  }

  // ── Step 4: Fragment/keyword fallback ──
  for (const [fragment, tz] of Object.entries(FRAGMENT_TIMEZONE_MAP)) {
    if (matchesTerm(venueNorm, fragment)) {
      return tz;
    }
  }

  console.warn(`Timezone auto-detect: Could not determine timezone from venue "${venue}" (static lookup failed)`);
  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// ASYNC DETECTION WITH LIVE API FALLBACK
// Uses free TimeAPI.io to geocode city/state → timezone when static lookup fails
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Async version of detectTimezoneFromVenue that falls back to a live API
 * (TimeAPI.io — free, no API key required) when the static lookup can't find a match.
 * 
 * Results are cached so repeated calls for the same venue won't hit the API again.
 */
export async function detectTimezoneFromVenueAsync(venue: string): Promise<string | null> {
  // Try static detection first
  const staticResult = detectTimezoneFromVenue(venue);
  if (staticResult) return staticResult;

  if (!venue || venue.trim().length === 0) return null;

  const cacheKey = venue.trim().toLowerCase();

  // Check cache for prior API result
  const cached = _liveApiCache.get(cacheKey);
  if (cached) return cached === 'NONE' ? null : cached;

  // Extract potential city/location words from venue text
  const venueNorm = normalizeText(venue);
  const searchTerms: string[] = [];

  // Add full venue, each comma/dash segment, and multi-word combos
  searchTerms.push(venueNorm);
  const segments = venueNorm.split(/[,|–\-]+/).map(s => s.trim()).filter(Boolean);
  searchTerms.push(...segments);

  const rawWords = venueNorm.split(/\s+/);
  // Add 2-word and 3-word combinations
  for (let i = 0; i < rawWords.length - 1; i++) {
    searchTerms.push(rawWords[i] + ' ' + rawWords[i + 1]);
    if (i < rawWords.length - 2) {
      searchTerms.push(rawWords[i] + ' ' + rawWords[i + 1] + ' ' + rawWords[i + 2]);
    }
  }
  // Add individual words ≥ 4 chars
  searchTerms.push(...rawWords.filter(w => w.replace(/[^a-z]/g, '').length >= 4));

  // Try each search term against the live API
  for (const term of searchTerms) {
    const tz = await fetchTimezoneFromLiveAPI(term);
    if (tz) {
      const normalized = normalizeTimezone(tz);
      _liveApiCache.set(cacheKey, normalized);
      console.log(`Timezone live-API: "${venue}" → ${normalized} (matched on "${term}")`);
      return normalized;
    }
  }

  // All attempts failed
  _liveApiCache.set(cacheKey, 'NONE');
  console.warn(`Timezone auto-detect: Could not determine timezone from venue "${venue}" (static + API both failed)`);
  return null;
}

/**
 * Call TimeAPI.io's free timezone-by-zone endpoint to resolve a location string.
 * Tries to find US IANA timezones by searching city names against known US zones.
 * Falls back to WorldTimeAPI search if needed.
 */
async function fetchTimezoneFromLiveAPI(searchTerm: string): Promise<string | null> {
  try {
    // Use TimeAPI.io search endpoint (free, no key required)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    const encoded = encodeURIComponent(searchTerm);
    const res = await fetch(
      `https://timeapi.io/api/timezone/zone?timeZone=${encoded}`,
      { signal: controller.signal, cache: 'no-store' }
    );
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      // If the API recognizes this as a valid IANA timezone, return it
      if (data?.timeZone && typeof data.timeZone === 'string') {
        return data.timeZone;
      }
    }
  } catch {
    // Timeout or network error — silently fail
  }

  // Fallback: try WorldTimeAPI search
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(
      `http://worldtimeapi.org/api/timezone`,
      { signal: controller.signal, cache: 'no-store' }
    );
    clearTimeout(timer);

    if (res.ok) {
      const zones: string[] = await res.json();
      // Search for a zone that contains the search term
      const termLower = searchTerm.toLowerCase().replace(/\s+/g, '_');
      const match = zones.find(z => z.toLowerCase().includes(termLower));
      if (match) return match;
    }
  } catch {
    // Timeout or network error — silently fail
  }

  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// ASYNC shouldStopEvent — uses live API fallback for better coverage
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Async version of shouldStopEvent that uses detectTimezoneFromVenueAsync
 * for better timezone detection coverage (live API fallback).
 */
export async function shouldStopEventAsync(
  eventDateTime: Date,
  venue: string,
  stopBeforeHours: number
): Promise<{ shouldStop: boolean; timezone: string; localNow: Date; cutoff: Date } | null> {
  const timezone = await detectTimezoneFromVenueAsync(venue);
  if (!timezone) return null;

  const nowInEventTz = getCurrentTimeInTimezone(timezone);
  const cutoffTime = new Date(nowInEventTz.getTime() + stopBeforeHours * 60 * 60 * 1000);

  return {
    shouldStop: eventDateTime.getTime() <= cutoffTime.getTime(),
    timezone,
    localNow: nowInEventTz,
    cutoff: cutoffTime,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// TIME UTILITIES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Get the current date/time in a specific timezone, returned as a "fake UTC" Date object.
 * 
 * Since Event_DateTime is stored as-if-UTC (e.g., 7pm event stored as 7pm UTC),
 * we need to get "what time is it NOW at the venue?" and express that as a UTC Date
 * so we can directly compare with Event_DateTime.
 */
export function getCurrentTimeInTimezone(timezone: string): Date {
  const now = getAccurateNow();
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
  const month = parseInt(get('month')) - 1;
  const day = parseInt(get('day'));
  const hour = parseInt(get('hour')) === 24 ? 0 : parseInt(get('hour'));
  const minute = parseInt(get('minute'));
  const second = parseInt(get('second'));

  return new Date(Date.UTC(year, month, day, hour, minute, second));
}

/**
 * Check if an event should be stopped/deleted based on its timezone-aware local time.
 * Auto-detects timezone from venue text.
 * Returns null if timezone cannot be detected — the event should be SKIPPED.
 */
export function shouldStopEvent(
  eventDateTime: Date,
  venue: string,
  stopBeforeHours: number
): { shouldStop: boolean; timezone: string; localNow: Date; cutoff: Date } | null {
  const timezone = detectTimezoneFromVenue(venue);
  if (!timezone) return null;

  const nowInEventTz = getCurrentTimeInTimezone(timezone);
  const cutoffTime = new Date(nowInEventTz.getTime() + stopBeforeHours * 60 * 60 * 1000);

  return {
    shouldStop: eventDateTime.getTime() <= cutoffTime.getTime(),
    timezone,
    localNow: nowInEventTz,
    cutoff: cutoffTime,
  };
}

/**
 * Get the timezone abbreviation for display.
 * Returns standard US abbreviation if known, otherwise derives from IANA name.
 */
export function getTimezoneAbbr(timezone: string): string {
  const tz = US_TIMEZONES.find(t => t.value === timezone);
  if (tz) return tz.abbr;
  // For international timezones, derive a short abbreviation
  try {
    const now = getAccurateNow();
    const short = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' })
      .formatToParts(now)
      .find(p => p.type === 'timeZoneName')?.value;
    return short || timezone.split('/').pop()?.replace(/_/g, ' ') || timezone;
  } catch {
    return timezone.split('/').pop()?.replace(/_/g, ' ') || timezone;
  }
}

/**
 * Get the timezone label for display.
 * Returns standard US label if known, otherwise a formatted IANA name.
 */
export function getTimezoneLabel(timezone: string): string {
  const tz = US_TIMEZONES.find(t => t.value === timezone);
  if (tz) return tz.label;
  // For international timezones, format the IANA name
  try {
    const now = getAccurateNow();
    const long = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'long' })
      .formatToParts(now)
      .find(p => p.type === 'timeZoneName')?.value;
    return long || timezone.replace(/_/g, ' ');
  } catch {
    return timezone.replace(/_/g, ' ');
  }
}

/**
 * Format a time showing what the current local time is in a timezone
 */
export function formatCurrentTimeInTimezone(timezone: string): string {
  const now = getAccurateNow();
  return now.toLocaleString('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    month: 'short',
    day: 'numeric',
  });
}
