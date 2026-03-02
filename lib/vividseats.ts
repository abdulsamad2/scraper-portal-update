/**
 * Vivid Seats Hermes API Client
 *
 * Uses the unauthenticated consumer-facing API to resolve
 * Vivid Seats production IDs (mapping IDs) for events.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const VS_BASE = 'https://www.vividseats.com/hermes/api/v1';

export interface VSProduction {
  id: number;
  name: string;
  localDate: string;
  utcDate: string;
  venue: { id: number; name: string; city: string; state: string };
  webPath: string;
  minPrice: number | null;
  maxPrice: number | null;
  listingCount: number;
  ticketCount: number;
}

/**
 * Search Vivid Seats for a performer and return their performer ID.
 * Uses the search page redirect — Vivid Seats redirects
 * /search?searchTerm=X to the matching performer or production page,
 * so we extract the ID from the final redirect URL.
 */
export async function findPerformerId(searchTerm: string): Promise<{ performerId: number | null; directProductionId: number | null }> {
  try {
    const url = `https://www.vividseats.com/search?searchTerm=${encodeURIComponent(searchTerm)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    const finalUrl = res.url || '';

    // Check if redirected to a performer page: /performer/{id}
    const performerMatch = finalUrl.match(/\/performer\/(\d+)/);
    if (performerMatch) {
      return { performerId: parseInt(performerMatch[1], 10), directProductionId: null };
    }

    // Check if redirected to a production page: /production/{id}
    const productionMatch = finalUrl.match(/\/production\/(\d+)/);
    if (productionMatch) {
      return { performerId: null, directProductionId: parseInt(productionMatch[1], 10) };
    }

    // No redirect (stayed on search page) — no match found
    return { performerId: null, directProductionId: null };
  } catch (error) {
    console.error('Error finding VS performer:', error);
    return { performerId: null, directProductionId: null };
  }
}

/**
 * Get a single production by ID.
 */
async function getProductionById(productionId: number): Promise<any | null> {
  try {
    const res = await fetch(`${VS_BASE}/productions/${productionId}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Get all productions for a performer.
 */
export async function getProductionsByPerformer(performerId: number): Promise<VSProduction[]> {
  try {
    const res = await fetch(`${VS_BASE}/productions?performerId=${performerId}`, {
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return [];

    const data = await res.json();
    const items = data.items || data || [];

    return items.map((p: any) => ({
      id: p.id,
      name: p.name || '',
      localDate: p.localDate || '',
      utcDate: p.utcDate || '',
      venue: {
        id: p.venue?.id || 0,
        name: p.venue?.name || '',
        city: p.venue?.city || '',
        state: p.venue?.state || '',
      },
      webPath: p.webPath || '',
      minPrice: p.minPrice ?? null,
      maxPrice: p.maxPrice ?? null,
      listingCount: p.listingCount ?? 0,
      ticketCount: p.ticketCount ?? 0,
    }));
  } catch (error) {
    console.error('Error fetching VS productions:', error);
    return [];
  }
}

/**
 * Match a Ticketmaster event to a Vivid Seats production.
 * Uses event name keywords, date, and venue to find the best match.
 *
 * @param eventName - TM event name (e.g. "Sacramento Kings vs Phoenix Suns")
 * @param eventDate - ISO date string from TM
 * @param venueName - Venue name from TM
 * @returns The matching production ID or null
 */
export interface VividSeatsLookupResult {
  productionId: number;
  productionName: string;
  venueName: string;
}

export interface VividSeatsLookupResponse {
  result: VividSeatsLookupResult | null;
  /** Specific reason for failure — shown to user */
  failReason?: string;
  /** Search term that was tried */
  searchTermUsed?: string;
}

export async function findVividSeatsMappingId(
  eventName: string,
  eventDate: string,
  venueName: string
): Promise<VividSeatsLookupResponse> {
  // Extract search terms — try primary then fallbacks
  const searchTerms = extractSearchTerms(eventName);
  if (searchTerms.length === 0) {
    return { result: null, failReason: 'Could not extract a search term from event name' };
  }

  // Try each search term until we find a performer or direct production
  let performerId: number | null = null;
  let directProductionId: number | null = null;
  let usedTerm = '';
  for (const term of searchTerms) {
    const found = await findPerformerId(term);
    if (found.performerId) { performerId = found.performerId; usedTerm = term; break; }
    if (found.directProductionId) { directProductionId = found.directProductionId; usedTerm = term; break; }
  }

  // If search redirected directly to a production, return it immediately
  if (directProductionId) {
    const prod = await getProductionById(directProductionId);
    if (prod) {
      return {
        result: {
          productionId: prod.id,
          productionName: prod.name || '',
          venueName: prod.venue?.name || '',
        },
        searchTermUsed: usedTerm,
      };
    }
  }

  if (!performerId) {
    return {
      result: null,
      failReason: `No performer found on Vivid Seats for "${searchTerms[0]}"`,
      searchTermUsed: searchTerms[0],
    };
  }

  // Step 2: Get all productions for this performer
  const productions = await getProductionsByPerformer(performerId);
  if (productions.length === 0) {
    return {
      result: null,
      failReason: `Performer found but no upcoming events listed on Vivid Seats`,
      searchTermUsed: usedTerm,
    };
  }

  // Step 3: Match by date — compare using local date strings to avoid timezone issues
  const targetDateStr = eventDate.slice(0, 10); // YYYY-MM-DD from the input

  // Find productions on the same date (compare local dates)
  const dateMatches = productions.filter(p => {
    const pLocalDate = p.localDate?.slice(0, 10) || '';
    if (pLocalDate === targetDateStr) return true;
    // Also check UTC date as fallback
    if (p.utcDate) {
      const pUtcDate = new Date(p.utcDate).toISOString().slice(0, 10);
      if (pUtcDate === targetDateStr) return true;
    }
    return false;
  });

  if (dateMatches.length === 1) {
    return {
      result: {
        productionId: dateMatches[0].id,
        productionName: dateMatches[0].name,
        venueName: dateMatches[0].venue.name,
      },
      searchTermUsed: usedTerm,
    };
  }

  if (dateMatches.length > 1) {
    // Multiple on same date — try to match venue
    const venueMatch = dateMatches.find(p =>
      normalizeStr(p.venue.name).includes(normalizeStr(venueName)) ||
      normalizeStr(venueName).includes(normalizeStr(p.venue.name))
    );
    if (venueMatch) {
      return {
        result: {
          productionId: venueMatch.id,
          productionName: venueMatch.name,
          venueName: venueMatch.venue.name,
        },
        searchTermUsed: usedTerm,
      };
    }
    // Return first date match
    return {
      result: {
        productionId: dateMatches[0].id,
        productionName: dateMatches[0].name,
        venueName: dateMatches[0].venue.name,
      },
      searchTermUsed: usedTerm,
    };
  }

  // No exact date match — try within 1 day (timezone differences)
  const targetTime = new Date(eventDate).getTime();
  const closeMatch = productions.find(p => {
    const pDate = new Date(p.utcDate || p.localDate);
    return Math.abs(pDate.getTime() - targetTime) < 36 * 60 * 60 * 1000;
  });

  if (closeMatch) {
    return {
      result: {
        productionId: closeMatch.id,
        productionName: closeMatch.name,
        venueName: closeMatch.venue.name,
      },
      searchTermUsed: usedTerm,
    };
  }

  return {
    result: null,
    failReason: `Found ${productions.length} events for "${usedTerm}" but none match the date ${targetDateStr}`,
    searchTermUsed: usedTerm,
  };
}

function normalizeStr(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Extract useful search terms from a TM event name.
 * Returns multiple candidates to try in order.
 * e.g. "Phoenix Suns at Sacramento Kings" -> ["Sacramento Kings", "Phoenix Suns"]
 * e.g. "Taylor Swift | The Eras Tour" -> ["Taylor Swift"]
 * e.g. "Ringling Bros. and Barnum & Bailey Circus" -> ["Ringling Bros. and Barnum & Bailey Circus", "Ringling Bros"]
 */
function extractSearchTerms(eventName: string): string[] {
  const terms: string[] = [];
  const name = eventName;

  // For "X at Y" or "X vs Y" patterns, try both sides
  const atMatch = name.match(/(.+?)\s+at\s+(.+)/i);
  if (atMatch) {
    terms.push(atMatch[2].trim()); // home team first
    terms.push(atMatch[1].trim()); // away team as fallback
  }

  const vsMatch = name.match(/(.+?)\s+vs\.?\s+(.+)/i);
  if (vsMatch) {
    terms.push(vsMatch[1].trim());
    terms.push(vsMatch[2].trim());
  }

  if (terms.length === 0) {
    // Remove pipe/dash suffixes like "Artist | Tour Name"
    const parts = name.split(/[|–—]/);
    const primary = parts[0]?.trim();
    if (primary) {
      // Clean up parenthetical info and common suffixes
      const cleaned = primary.replace(/\(.*?\)/g, '').replace(/\s*tickets?\s*$/i, '').trim();
      if (cleaned) terms.push(cleaned);
    }

    // Also try the full name if it's different
    const fullCleaned = name.replace(/\(.*?\)/g, '').replace(/\s*tickets?\s*$/i, '').trim();
    if (fullCleaned && !terms.includes(fullCleaned)) {
      terms.push(fullCleaned);
    }
  }

  // Deduplicate
  return [...new Set(terms)].filter(Boolean);
}

