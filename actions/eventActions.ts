'use server';

/**
 * Event Actions with Automatic Seat Deletion
 * 
 * This module handles event CRUD operations and automatically deletes associated
 * seat model data (ConsecutiveGroups) in the following scenarios:
 * 
 * 1. When an event is deleted (deleteEvent)
 * 2. When scraping is stopped for an event (updateEvent with Skip_Scraping: true)
 * 3. When price percentage is updated for an event (updateEvent with priceIncreasePercentage)
 * 4. When scraping is stopped for all events (updateAllEvents with status: true)
 * 
 * This ensures that seat inventory data is automatically cleaned up when events
 * are stopped, modified, or deleted, preventing stale data accumulation.
 */

import dbConnect from '@/lib/dbConnect';
import { Event } from '@/models/eventModel'; // Assuming models are aliased to @/models
import { TcEvent } from '@/models/tcEventModel';
import { ConsecutiveGroup } from '@/models/seatModel';
import { EvenueEvent } from '@/models/evenueEventModel';
import { deleteConsecutiveGroupsByEventId, deleteConsecutiveGroupsByEventIds } from './seatActions';
import { isValidEventType, EVENT_TYPES } from '@/lib/venueToSport';
import { EVENUE_EVENTS_COLLECTION, EVENUE_GROUPS_COLLECTION, EVENUE_SOURCE, isEvenueUrl } from '@/lib/evenue';
import { TelechargeEvent } from '@/models/telechargeEventModel';
import {
  TELECHARGE_EVENTS_COLLECTION,
  TELECHARGE_GROUPS_COLLECTION,
  TELECHARGE_SOURCE,
  canonicalTelechargeUrl,
  formatPerformance,
  isTelechargeUrl,
  type TelechargeLookupResult,
} from '@/lib/telecharge';
import { lookupTelechargeShow, performanceMinute } from '@/lib/telechargeLookup';

// Escape special regex characters to prevent ReDoS and injection
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Detect if URL is from tickets.com
function isTicketsComUrl(url: string): boolean {
  if (!url) return false;
  return /tickets\.com\/events\//i.test(url) || /tickets\.com\/tickets\//i.test(url);
}

/**
 * The fields the form submits that an eVenue registration cares about.
 * Declared rather than cast so this path does not add to the file's `any` debt.
 */
interface EvenueEventInput {
  URL?: string;
  priceIncreasePercentage?: number | string | null;
  Skip_Scraping?: boolean;
  Zone?: string;
  eventType?: string | null;
  standardMarkupAdjustment?: number | string;
  resaleMarkupAdjustment?: number | string;
  brokerMarkupAdjustment?: number | string;
  includeStandardSeats?: boolean;
  includeResaleSeats?: boolean;
}

/** Numeric fields the portal owns on an eVenue event; all default to 0. */
const EVENUE_ADJUSTMENT_FIELDS = [
  'standardMarkupAdjustment',
  'resaleMarkupAdjustment',
  'brokerMarkupAdjustment',
] as const;

/**
 * Find an event by _id across all rosters.
 *
 * Ticketmaster events live in `events`, tickets.com in `tc_events`, and eVenue
 * in `ev_events` — one scraper per collection. The portal spans all three:
 * every action that takes an _id has to look in all places and then act on
 * whichever collection the event actually came from.
 */
async function findEventAnywhere(eventId: string) {
  const tmEvent = await Event.findById(eventId).maxTimeMS(5000);
  if (tmEvent) return { doc: tmEvent, isEvenue: false, isTc: false, isTelecharge: false };

  const tcEvent = await TcEvent.findById(eventId).maxTimeMS(5000);
  if (tcEvent) return { doc: tcEvent, isEvenue: false, isTc: true, isTelecharge: false };

  const evEvent = await EvenueEvent.findById(eventId).maxTimeMS(5000);
  if (evEvent) return { doc: evEvent, isEvenue: true, isTc: false, isTelecharge: false };

  const teleEvent = await TelechargeEvent.findById(eventId).maxTimeMS(5000);
  if (teleEvent) return { doc: teleEvent, isEvenue: false, isTc: false, isTelecharge: true };

  return { doc: null, isEvenue: false, isTc: false, isTelecharge: false };
}

/** The non-Ticketmaster event rosters, one per scraper, unioned onto `events`. */
const OTHER_EVENT_ROSTERS = () => [
  { $unionWith: { coll: 'tc_events' } },
  { $unionWith: { coll: EVENUE_EVENTS_COLLECTION } },
  { $unionWith: { coll: TELECHARGE_EVENTS_COLLECTION } },
];

/**
 * Creates a new event.
 * @param {object} eventData - The data for the new event.
 * @returns {Promise<object>} The created event object or an error object.
 */
export async function createEvent(eventData: Partial<Event>) {
  const input = eventData as EvenueEventInput;
  const url = (input.URL || '').trim();

  // eVenue events are registered by URL alone — see registerEvenueEvent.
  if (isEvenueUrl(url)) {
    return registerEvenueEvent(input);
  }

  // tickets.com events are registered separately
  if (isTicketsComUrl(url)) {
    return registerTicketsComEvent(input);
  }

  // Telecharge performances have their own page and action.
  if (isTelechargeUrl(url)) {
    const result = await registerTelechargePerformances({ ...(input as TelechargeEventInput), performances: [input as TelechargePerformanceInput] });
    return 'error' in result ? result : result.created[0];
  }

  const venue = ((eventData as any).Venue || '').trim().toLowerCase();
  const blockedStates = ['ri', 'me', 'rhode island', 'maine'];
  if (blockedStates.some(s => venue === s || venue.endsWith(', ' + s) || venue.endsWith(',' + s))) {
    return { error: 'Rhode Island and Maine events are not allowed.' };
  }

  const incomingType = (eventData as any).eventType;
  if (incomingType != null && !isValidEventType(incomingType)) {
    return { error: `Invalid eventType. Must be one of: ${EVENT_TYPES.join(', ')}.` };
  }
  if ((eventData as any).Skip_Scraping === false && !isValidEventType(incomingType)) {
    return { error: 'Select an event type (NFL, MLB, NHL, NBA, or Other) before starting scraping.' };
  }

  await dbConnect();
  try {
    const newEvent = new Event({
      ...eventData,
      source: 'ticketmaster',
    });
    const savedEvent = await newEvent.save();
    return JSON.parse(JSON.stringify(savedEvent));
  } catch (error:unknown) {
    console.error('Error creating event:', error);
    return { error: (error as Error).message || 'Failed to create event' };
  }
}

/**
 * Register an eVenue event into `ev_events`, where the eVenue scraper will pick
 * it up on its next pass (within MAX_UPDATE_INTERVAL, 2 min by default).
 *
 * Only the URL and the markup are written. Event_ID, name, date, venue and the
 * platform context are resolved from the live site by the scraper and written
 * back into this same row, so the form does not need — and must not invent —
 * any of them: the URL-parsing the form does for Ticketmaster links produces
 * nonsense for an eVenue URL.
 *
 * eventType is not required. It exists to drive Ticketmaster-side markup
 * adjustments and CSV filtering; eVenue is primary box-office inventory sold at
 * a price level, with one markup and no resale/broker split.
 */
async function registerEvenueEvent(input: EvenueEventInput) {
  await dbConnect();

  const url = (input.URL || '').trim();
  const rawMarkup = input.priceIncreasePercentage;
  const markup = rawMarkup === undefined || rawMarkup === null || rawMarkup === '' ? 35 : Number(rawMarkup);

  if (isNaN(markup) || markup < 0) {
    return { error: 'Markup percentage must be a number, 0 or greater.' };
  }

  try {
    const existing = await EvenueEvent.findOne({ URL: url }).lean();
    if (existing) {
      return { error: 'That eVenue event is already registered.' };
    }

    const created = await EvenueEvent.create({
      URL: url,
      priceIncreasePercentage: markup,
      Source: EVENUE_SOURCE,
      Skip_Scraping: input.Skip_Scraping ?? false,
      Zone: input.Zone || 'none',
      // Carried through when the form sends them; the schema supplies the same
      // defaults as the Ticketmaster model otherwise.
      ...(input.eventType ? { eventType: input.eventType } : {}),
      ...Object.fromEntries(
        EVENUE_ADJUSTMENT_FIELDS.filter((f) => input[f] !== undefined && !isNaN(Number(input[f]))).map(
          (f) => [f, Number(input[f])]
        )
      ),
      ...(input.includeStandardSeats !== undefined
        ? { includeStandardSeats: Boolean(input.includeStandardSeats) }
        : {}),
      ...(input.includeResaleSeats !== undefined
        ? { includeResaleSeats: Boolean(input.includeResaleSeats) }
        : {}),
    });

    return JSON.parse(JSON.stringify(created));
  } catch (error: unknown) {
    console.error('Error registering eVenue event:', error);
    return { error: (error as Error).message || 'Failed to register eVenue event' };
  }
}

/**
 * Register a tickets.com event into `events` with source='ticketscom', where the
 * tickets.com scraper will pick it up on its next pass (within ~2 minutes).
 *
 * Only the URL and markup are written by the portal. Event metadata (Event_ID,
 * Event_Name, Venue, Event_DateTime) will be resolved by the scraper from the
 * live site and written back into this same row.
 */
async function registerTicketsComEvent(input: EvenueEventInput) {
  await dbConnect();

  const url = (input.URL || '').trim();
  const rawMarkup = input.priceIncreasePercentage;
  const markup = rawMarkup === undefined || rawMarkup === null || rawMarkup === '' ? 35 : Number(rawMarkup);

  if (isNaN(markup) || markup < 0) {
    return { error: 'Markup percentage must be a number, 0 or greater.' };
  }

  try {
    // Check if already registered
    const existing = await Event.findOne({ URL: url }).lean().maxTimeMS(5000);
    if (existing) {
      return { error: 'That tickets.com event is already registered.' };
    }

    // Create with required fields in tc_events collection
    const created = await TcEvent.create({
      URL: url,
      priceIncreasePercentage: markup,
      Skip_Scraping: input.Skip_Scraping ?? false,
      // User provides these; if missing, scraper will resolve from live data
      Event_ID: `tc-${Date.now()}`,
      Event_Name: (input as any).Event_Name || `Event ${Date.now()}`,
      Event_DateTime: (input as any).Event_DateTime || new Date(),
      Venue: (input as any).Venue || 'TBD',
      mapping_id: `tc-${Date.now()}`,
    });

    return JSON.parse(JSON.stringify(created));
  } catch (error: unknown) {
    console.error('Error registering tickets.com event:', error);
    return { error: (error as Error).message || 'Failed to register tickets.com event' };
  }
}

/** One performance on the Add Telecharge Event page. */
export interface TelechargePerformanceInput {
  Event_DateTime?: string | Date;
  inHandDate?: string | Date | null;
  mapping_id?: string | null;
}

/** The show-level fields shared by every performance submitted together. */
export interface TelechargeEventInput extends EvenueEventInput {
  Event_Name?: string | null;
  performances?: TelechargePerformanceInput[];
}

/**
 * A form date as the portal stores dates: venue wall-clock time labelled UTC.
 * A datetime-local value ("2026-09-19T20:00") carries no zone, and handing it to
 * `new Date()` would read it in the server's zone — so the zone is added here.
 */
function wallClockDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const s = String(value).trim();
  const d = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(s)
    ? new Date(s.length === 10 ? `${s}T00:00:00Z` : `${s}${s.length === 16 ? ':00' : ''}Z`)
    : new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Every performance a Telecharge show has on sale, for the Add Event picker.
 *
 * Fetched by the running Telecharge scraper (see lib/telechargeLookup.ts), so an
 * answer also proves the URL is a real show. Performances this show already has
 * in the portal come back with `tracked: true`.
 */
export async function getTelechargePerformances(url: string): Promise<TelechargeLookupResult> {
  try {
    const result = await lookupTelechargeShow(url);
    if ('error' in result) return result;
    const existing = await TelechargeEvent.find(
      { URL: result.show.url, Event_DateTime: { $in: result.performances.map((p) => new Date(p.Event_DateTime)) } },
      { Event_DateTime: 1 }
    ).lean().maxTimeMS(5000);
    const tracked = new Set(existing.map((e) => performanceMinute(e.Event_DateTime as Date)));
    return {
      show: result.show,
      performances: result.performances.map((p) => ({ ...p, tracked: tracked.has(performanceMinute(p.Event_DateTime)) })),
    };
  } catch (error) {
    console.error('Error loading Telecharge performances:', error);
    return { error: (error as Error).message || 'Failed to load Telecharge performances' };
  }
}

/**
 * Register one or more performances of a Telecharge show into `tele_events`.
 *
 * Each performance becomes its own row, identified by show URL + date/time. Every
 * date/time is checked against the show's live calendar (fetched by the scraper)
 * before anything is written, so a wrong URL or a time that is not on sale is
 * rejected here rather than showing up later as a failing row. Name and venue
 * default to the show's own; the scraper fills in Event_ID on its first pass.
 *
 * All rows are validated before any is written, so a bad date never leaves half
 * a show registered.
 */
export async function registerTelechargePerformances(input: TelechargeEventInput) {
  const url = canonicalTelechargeUrl(input.URL || '');
  if (!url) {
    return { error: 'Enter a Telecharge show URL, e.g. https://www.telecharge.com/<Show-Name>-Tickets' };
  }

  const rawMarkup = input.priceIncreasePercentage;
  const markup = rawMarkup === undefined || rawMarkup === null || rawMarkup === '' ? 35 : Number(rawMarkup);
  if (isNaN(markup) || markup < 0) {
    return { error: 'Markup percentage must be a number, 0 or greater.' };
  }
  if (input.eventType != null && input.eventType !== '' && !isValidEventType(input.eventType)) {
    return { error: `Invalid eventType. Must be one of: ${EVENT_TYPES.join(', ')}.` };
  }

  const performances = input.performances || [];
  if (!performances.length) return { error: 'Add at least one performance date and time.' };

  // The show's live calendar: proves the URL is a real show and that every
  // date/time below is actually on sale.
  let lookup: TelechargeLookupResult;
  try {
    lookup = await lookupTelechargeShow(url, { maxAgeMs: 15 * 60_000 });
  } catch (error) {
    console.error('Error looking up Telecharge show:', error);
    return { error: (error as Error).message || 'Could not check the show on Telecharge' };
  }
  if ('error' in lookup) return { error: lookup.error };
  const onSale = new Set(lookup.performances.map((p) => performanceMinute(p.Event_DateTime)));
  const showName = lookup.show.title || undefined;
  const theatre = lookup.show.theatre || undefined;

  const rows: Record<string, unknown>[] = [];
  const seenTimes = new Set<number>();
  const seenMappings = new Set<string>();
  for (const [i, perf] of performances.entries()) {
    const when = wallClockDate(perf.Event_DateTime);
    if (!when) return { error: `Performance ${i + 1}: pick a date and time.` };
    const label = formatPerformance(when);
    if (seenTimes.has(when.getTime())) return { error: `${label}: that date and time is listed twice.` };
    seenTimes.add(when.getTime());
    if (!onSale.has(performanceMinute(when))) {
      return { error: `${label}: ${showName || 'this show'} has no performance on sale at that date and time on Telecharge.` };
    }

    // Same default as the Ticketmaster form: the day before the performance.
    const inHand = wallClockDate(perf.inHandDate) || new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate() - 1));

    const mappingId = String(perf.mapping_id || '').trim();
    if (mappingId) {
      if (seenMappings.has(mappingId)) return { error: `${label}: mapping ID ${mappingId} is used twice.` };
      seenMappings.add(mappingId);
    }

    rows.push({
      URL: url,
      Event_DateTime: when,
      inHandDate: inHand,
      ...(mappingId ? { mapping_id: mappingId } : {}),
      ...(String(input.Event_Name || '').trim() || showName ? { Event_Name: String(input.Event_Name || '').trim() || showName } : {}),
      ...(theatre ? { Venue: theatre } : {}),
      priceIncreasePercentage: markup,
      Source: TELECHARGE_SOURCE,
      Skip_Scraping: input.Skip_Scraping ?? false,
      Zone: input.Zone || 'none',
      telecharge: { status: 'pending' },
      ...(input.eventType ? { eventType: input.eventType } : {}),
      ...Object.fromEntries(
        EVENUE_ADJUSTMENT_FIELDS.filter((f) => input[f] !== undefined && !isNaN(Number(input[f]))).map((f) => [f, Number(input[f])])
      ),
      ...(input.includeStandardSeats !== undefined ? { includeStandardSeats: Boolean(input.includeStandardSeats) } : {}),
      ...(input.includeResaleSeats !== undefined ? { includeResaleSeats: Boolean(input.includeResaleSeats) } : {}),
    });
  }

  await dbConnect();
  try {
    const clashes = await TelechargeEvent.find(
      { URL: url, Event_DateTime: { $in: rows.map((r) => r.Event_DateTime) } },
      { Event_DateTime: 1 }
    ).lean().maxTimeMS(5000);
    if (clashes.length) {
      const times = clashes.map((c) => formatPerformance(c.Event_DateTime as Date));
      return { error: `Already registered for this show: ${times.join(', ')}` };
    }
    if (seenMappings.size) {
      const taken = await TelechargeEvent.findOne({ mapping_id: { $in: [...seenMappings] } }, { mapping_id: 1 }).lean().maxTimeMS(5000);
      if (taken) return { error: `Mapping ID ${(taken as { mapping_id?: string }).mapping_id} is already used by another Telecharge performance.` };
    }

    const created = await TelechargeEvent.insertMany(rows, { ordered: true });
    return { created: JSON.parse(JSON.stringify(created)) as Record<string, unknown>[] };
  } catch (error: unknown) {
    console.error('Error registering Telecharge performances:', error);
    return { error: (error as Error).message || 'Failed to register Telecharge performances' };
  }
}

/**
 * Retrieves a single event by its ID.
 * @param {string} eventId - The ID of the event to retrieve.
 * @returns {Promise<object|null>} The event object or null if not found, or an error object.
 */
export async function getEventById(eventId: string): Promise<object | null> {
  await dbConnect();
  try {
    // Looks in both rosters — the dashboard lists Ticketmaster and eVenue
    // events together, so an _id from the table can belong to either.
    const found = await findEventAnywhere(eventId);
    if (!found.doc) {
      console.error('Event not found with ID:', eventId);
      return null;
    }
    return JSON.parse(JSON.stringify(found.doc));
  } catch (error) {
    console.error('Error fetching event by ID:', eventId, error);
    return { error: (error as Error).message || 'Failed to fetch event' };
  }
}

/**
 * Retrieves all events.
 * @returns {Promise<Array<object>>} An array of event objects or an error object.
 */
export async function getAllEvents(): Promise<Array<object>> {
  await dbConnect();
  try {
    // Every roster, same format.
    const events = await Event.aggregate(OTHER_EVENT_ROSTERS());
    return JSON.parse(JSON.stringify(events));
  } catch (error) {
    console.error('Error fetching all events:', error);
    return [{ error: (error as Error).message || 'Failed to fetch events' }];
  }
}

/**
 * Retrieves paginated events with optional search and filters.
 * @param {number} page - The page number (1-based)
 * @param {number} limit - The number of events per page
 * @param {string} search - Optional search term to filter events
 * @param {object} filters - Optional filters for date, venue, status, etc.
 * @returns {Promise<{events: Array<object>, total: number, page: number, totalPages: number}>} Paginated events data
 */
export async function getPaginatedEventsAdvanced(page: number = 1, limit: number = 100, search: string = '', filters: any = {}) {
  await dbConnect();
  try {
    const skip = (page - 1) * limit;
    
    // Build search query
    const searchConditions = [];
    if (search.trim()) {
      const term = search.trim();
      const searchRegex = { $regex: escapeRegex(term), $options: 'i' };
      const or: any[] = [
        { Event_Name: searchRegex },
        { Venue: searchRegex },
        { mapping_id: searchRegex },
        { Event_ID: searchRegex },
      ];
      // Typing a league code in the search also filters by eventType
      const upper = term.toUpperCase();
      if (isValidEventType(upper)) {
        or.push({ eventType: upper });
      }
      searchConditions.push({ $or: or });
    }

    // Build filter conditions
    const filterConditions = [];
    
    // Date range filter
    if (filters.dateFrom || filters.dateTo) {
      const dateFilter: any = {};
      if (filters.dateFrom) dateFilter.$gte = new Date(filters.dateFrom);
      if (filters.dateTo) {
        // include the full end day
        const end = new Date(filters.dateTo);
        end.setHours(23, 59, 59, 999);
        dateFilter.$lte = end;
      }
      filterConditions.push({ Event_DateTime: dateFilter });
    }

    // Venue filter (only when not already covered by search)
    if (filters.venue) {
      filterConditions.push({ Venue: { $regex: escapeRegex(filters.venue.trim()), $options: 'i' } });
    }

    // Scraping status filter
    if (filters.scrapingStatus === 'active') {
      filterConditions.push({ $or: [{ Skip_Scraping: false }, { Skip_Scraping: { $exists: false } }] });
    } else if (filters.scrapingStatus === 'inactive') {
      filterConditions.push({ Skip_Scraping: true });
    }

    // Event type filter (supports "unset" to find legacy events without a type)
    if (filters.eventType) {
      if (filters.eventType === 'unset') {
        filterConditions.push({ $or: [{ eventType: null }, { eventType: { $exists: false } }] });
      } else if (isValidEventType(filters.eventType)) {
        filterConditions.push({ eventType: filters.eventType });
      }
    }

    // Available seats filter
    if (filters.hasAvailableSeats === 'yes') {
      filterConditions.push({ Available_Seats: { $gt: 0 } });
    } else if (filters.hasAvailableSeats === 'no') {
      filterConditions.push({ $or: [{ Available_Seats: 0 }, { Available_Seats: { $exists: false } }] });
    }

    // Seat range filter
    if (filters.seatRange?.min || filters.seatRange?.max) {
      const seatFilter: any = {};
      if (filters.seatRange.min) seatFilter.$gte = parseInt(filters.seatRange.min);
      if (filters.seatRange.max) seatFilter.$lte = parseInt(filters.seatRange.max);
      filterConditions.push({ Available_Seats: seatFilter });
    }

    // Combine all conditions
    let query = {};
    const allConditions = [...searchConditions, ...filterConditions];
    if (allConditions.length > 0) {
      query = { $and: allConditions };
    }

    // Build sort criteria - Default to last updated (most recent first)
    const orderMul = filters.sortOrder === 'asc' ? 1 : -1;
    let sortCriteria: any = { Last_Updated: -1, updatedAt: -1 }; // Default sort by last updated
    switch (filters.sortBy) {
      case 'newest':
        sortCriteria = { createdAt: -1 };
        break;
      case 'oldest':
        sortCriteria = { createdAt: 1 };
        break;
      case 'name':
        sortCriteria = { Event_Name: orderMul };
        break;
      case 'seats':
        sortCriteria = { Available_Seats: -orderMul };
        break;
      case 'date':
        sortCriteria = { Event_DateTime: -orderMul };
        break;
      case 'markup':
        sortCriteria = { priceIncreasePercentage: -orderMul };
        break;
      case 'updated':
      default:
        sortCriteria = { Last_Updated: -orderMul, updatedAt: -orderMul };
    }

    // Ticketmaster, tickets.com, eVenue and Telecharge events live in separate
    // collections, one per scraper. The dashboard is the one place they come back
    // together: union every roster, then apply the search, filters, sort and
    // paging to the combined set so paging stays correct across all.
    const matchStages = allConditions.length > 0 ? [{ $match: query }] : [];

    const countResult = await Event.aggregate([...OTHER_EVENT_ROSTERS(), ...matchStages, { $count: 'total' }]);
    const total = countResult[0]?.total || 0;

    const events = await Event.aggregate([
      ...OTHER_EVENT_ROSTERS(),
      ...matchStages,
      { $sort: sortCriteria },
      { $skip: skip },
      { $limit: limit },
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      events: JSON.parse(JSON.stringify(events)),
      total,
      page,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1
    };
  } catch (error) {
    console.error('Error fetching paginated events:', error);
    return {
      events: [],
      total: 0,
      page: 1,
      totalPages: 0,
      hasNextPage: false,
      hasPrevPage: false,
      error: (error as Error).message || 'Failed to fetch events'
    };
  }
}

/**
 * Returns total event count and active (scraping on) event count.
 */
export async function getEventCounts(): Promise<{ total: number; active: number }> {
  await dbConnect();
  try {
    const activeMatch = { $or: [{ Skip_Scraping: false }, { Skip_Scraping: { $exists: false } }] };
    // Counts cover every roster so the dashboard totals match the list.
    const [totalResult, activeResult] = await Promise.all([
      Event.aggregate([...OTHER_EVENT_ROSTERS(), { $count: 'n' }]),
      Event.aggregate([...OTHER_EVENT_ROSTERS(), { $match: activeMatch }, { $count: 'n' }]),
    ]);
    return { total: totalResult[0]?.n || 0, active: activeResult[0]?.n || 0 };
  } catch {
    return { total: 0, active: 0 };
  }
}

/**
 * Returns per-event standard and resale inventory quantities for a set of mapping_ids.
 * Standard = splitType 'NEVERLEAVEONE', Resale = everything else.
 */
export type InventoryCounts = {
  standard: number; resale: number; broker: number;
  standardRows: number; resaleRows: number; brokerRows: number;
  standardAvgCost: number | null; resaleAvgCost: number | null; brokerAvgCost: number | null;
};

export async function getInventoryCountsByType(
  mappingIds: string[]
): Promise<Record<string, InventoryCounts>> {
  if (!mappingIds.length) return {};
  await dbConnect();
  try {
    // isBroker = resale AND tag contains "broker" (case-insensitive). Mirrors the
    // pricing branch in actions/csvActions.tsx so badge counts match what the CSV
    // export treats as broker.
    const isResale = { $ne: ['$inventory.splitType', 'NEVERLEAVEONE'] };
    const isBroker = {
      $and: [
        isResale,
        {
          $regexMatch: {
            input: { $ifNull: ['$inventory.tags', ''] },
            regex: 'broker',
            options: 'i',
          },
        },
      ],
    };
    // eVenue inventory lands in its own collection, the same way its events do.
    // Union it in before matching so an eVenue row's Qty/Rows badges count its
    // seats instead of always reading zero. The two collections hold disjoint
    // mapping_ids, so nothing can be double-counted by the $group below.
    const result = await ConsecutiveGroup.aggregate([
      { $unionWith: { coll: EVENUE_GROUPS_COLLECTION } },
      { $unionWith: { coll: TELECHARGE_GROUPS_COLLECTION } },
      { $match: { mapping_id: { $in: mappingIds } } },
      {
        $group: {
          _id: '$mapping_id',
          standard: { $sum: { $cond: [{ $eq: ['$inventory.splitType', 'NEVERLEAVEONE'] }, '$inventory.quantity', 0] } },
          resale: { $sum: { $cond: [isResale, '$inventory.quantity', 0] } },
          broker: { $sum: { $cond: [isBroker, '$inventory.quantity', 0] } },
          standardRows: { $sum: { $cond: [{ $eq: ['$inventory.splitType', 'NEVERLEAVEONE'] }, 1, 0] } },
          resaleRows: { $sum: { $cond: [isResale, 1, 0] } },
          brokerRows: { $sum: { $cond: [isBroker, 1, 0] } },
          // $avg ignores nulls, so non-matching rows become null and are excluded
          standardAvgCost: { $avg: { $cond: [{ $eq: ['$inventory.splitType', 'NEVERLEAVEONE'] }, '$inventory.cost', null] } },
          resaleAvgCost: { $avg: { $cond: [isResale, '$inventory.cost', null] } },
          brokerAvgCost: { $avg: { $cond: [isBroker, '$inventory.cost', null] } },
        },
      },
    ]);
    const round2 = (v: number | null | undefined) => (v != null ? Math.round(v * 100) / 100 : null);
    const map: Record<string, InventoryCounts> = {};
    for (const row of result) {
      map[row._id] = {
        standard: row.standard,
        resale: row.resale,
        broker: row.broker,
        standardRows: row.standardRows,
        resaleRows: row.resaleRows,
        brokerRows: row.brokerRows,
        standardAvgCost: round2(row.standardAvgCost),
        resaleAvgCost: round2(row.resaleAvgCost),
        brokerAvgCost: round2(row.brokerAvgCost),
      };
    }
    return map;
  } catch (error) {
    console.error('Error fetching inventory counts by type:', error);
    return {};
  }
}

/**
 * Updates an existing event.
 * @param {string} eventId - The ID of the event to update.
 * @param {object} updateData - An object containing the fields to update.
 * @param {boolean} deleteSeatGroups - Whether to delete associated seat groups on certain updates.
 * @returns {Promise<object|null>} The updated event object or null if not found, or an error object.
 */
export async function updateEvent(eventId: string, updateData: Partial<Event> & { Skip_Scraping?: boolean; priceIncreasePercentage?: number }, deleteSeatGroups: boolean = false) {
  // Input validation
  if (!eventId || typeof eventId !== 'string') {
    return { error: 'Invalid event ID provided' };
  }
  
  if (!updateData || typeof updateData !== 'object') {
    return { error: 'Invalid update data provided' };
  }

  await dbConnect();
  try {
    // Get current event state to check if we're actually stopping scraping
    const found = await findEventAnywhere(eventId);
    if (!found.doc) {
      return { error: 'Event not found' };
    }
    if (found.isEvenue) {
      return updateEvenueEvent(found.doc, updateData);
    }
    if (found.isTc) {
      return updateTcEvent(found.doc, updateData);
    }
    if (found.isTelecharge) {
      return updateTelechargeEvent(found.doc, updateData);
    }
    const currentEvent = found.doc;

    const incomingType = (updateData as any).eventType;
    if (incomingType !== undefined && incomingType !== null && !isValidEventType(incomingType)) {
      return { error: `Invalid eventType. Must be one of: ${EVENT_TYPES.join(', ')}.` };
    }

    // Gate: starting scraping (Skip_Scraping true→false) requires a valid eventType
    // on the stored doc OR one being set in this same update. Existing events whose
    // scraping is already on are untouched.
    // NOTE: tickets.com events (source='ticketscom') don't require eventType since
    // they are resale listings, not primary ticketing events.
    const startingScraping = updateData.Skip_Scraping === false && currentEvent.Skip_Scraping !== false;
    const isTicketsComEvent = currentEvent.source === 'ticketscom';
    if (startingScraping && !isTicketsComEvent) {
      const effectiveType = incomingType !== undefined ? incomingType : currentEvent.eventType;
      if (!isValidEventType(effectiveType)) {
        return { error: 'Select an event type (NFL, MLB, NHL, NBA, or Other) before starting scraping.' };
      }
    }

    // Debug logging
    console.log('UpdateEvent Debug Info:', {
      eventId,
      currentSkipScraping: currentEvent.Skip_Scraping,
      newSkipScraping: updateData.Skip_Scraping,
      currentPercentage: currentEvent.priceIncreasePercentage,
      newPercentage: updateData.priceIncreasePercentage,
      deleteSeatGroups
    });

    // Check if we're stopping scraping (going from false/undefined to true) or updating price percentage
    const isStoppingScraping = updateData.Skip_Scraping === true && !currentEvent.Skip_Scraping;
    const isUpdatingPercentage = updateData.priceIncreasePercentage !== undefined && 
                                updateData.priceIncreasePercentage !== currentEvent.priceIncreasePercentage;
    
    const shouldDeleteSeats = deleteSeatGroups || isStoppingScraping || isUpdatingPercentage;

    console.log('Seat Deletion Logic:', {
      isStoppingScraping,
      isUpdatingPercentage,
      shouldDeleteSeats
    });

    // Delete seat groups if needed
    let seatDeletionResult = null;
    if (shouldDeleteSeats) {
      console.log('Deleting seat groups for event:', eventId);
      // Use Event_ID (not MongoDB _id) to match the ConsecutiveGroup eventId field
      seatDeletionResult = await deleteConsecutiveGroupsByEventId(currentEvent.Event_ID);
      console.log('Seat deletion result:', seatDeletionResult);
    }

    const updatedEvent = await Event.findByIdAndUpdate(eventId, updateData, {
      new: true, // Return the modified document rather than the original
      runValidators: true, // Ensure schema validations are run
    }).maxTimeMS(10000); // 10 second timeout
    
    if (!updatedEvent) {
      return { error: 'Failed to update event - event may have been deleted' };
    }
    
    const result = JSON.parse(JSON.stringify(updatedEvent));
    if (seatDeletionResult) {
      result.deletedSeatGroups = seatDeletionResult.deletedCount || 0;
    }
    
    return result;
  } catch (error) {
    console.error('Error updating event:', error);
    return { error: (error as Error).message || 'Failed to update event' };
  }
}

/**
 * Update an eVenue event.
 *
 * Only the three fields the portal owns are writable — markup, pause and zone.
 * Everything else on the row (Event_ID, name, date, venue, the `evenue`
 * context) is the scraper's, resolved from the live site, and overwriting it
 * from here would just be undone on the next pass.
 *
 * Unlike the Ticketmaster path this never deletes inventory itself. SeatScouts
 * has no update endpoint, so a listing is only retired when the scraper deletes
 * the row AND sends the matching delete by inventoryId; deleting rows here
 * would leave those listings live with nothing to reconcile them against.
 * Both cases are already handled by the scraper:
 *
 *   - markup changed -> the next pass re-prices, and the sync layer deletes and
 *     re-inserts each changed row on both sides
 *   - paused         -> its sweep delists the event, the same way stopping a
 *     Ticketmaster event drops its seat groups
 */
async function updateEvenueEvent(
  currentEvent: { _id: unknown },
  updateData: Partial<Event> & { Skip_Scraping?: boolean; priceIncreasePercentage?: number }
) {
  const input = updateData as EvenueEventInput;
  const $set: Record<string, unknown> = {};

  if (input.priceIncreasePercentage !== undefined) {
    const markup = Number(input.priceIncreasePercentage);
    if (isNaN(markup) || markup < 0) {
      return { error: 'Markup percentage must be a number, 0 or greater.' };
    }
    $set.priceIncreasePercentage = markup;
  }
  if (input.Skip_Scraping !== undefined) $set.Skip_Scraping = Boolean(input.Skip_Scraping);
  if (input.Zone !== undefined) $set.Zone = input.Zone;

  // The CSV markup adjustments and include toggles work the same on both
  // rosters — eVenue rows carry splitType NEVERLEAVEONE, so the export treats
  // them as standard inventory and applies these identically.
  for (const field of EVENUE_ADJUSTMENT_FIELDS) {
    if (input[field] === undefined) continue;
    const n = Number(input[field]);
    if (isNaN(n)) return { error: `${field} must be a number.` };
    $set[field] = n;
  }
  if (input.includeStandardSeats !== undefined)
    $set.includeStandardSeats = Boolean(input.includeStandardSeats);
  if (input.includeResaleSeats !== undefined)
    $set.includeResaleSeats = Boolean(input.includeResaleSeats);

  if (input.eventType !== undefined) {
    // Optional for eVenue — unlike Ticketmaster it does not gate scraping — but
    // accepted so the dashboard's type filter and badges work across both.
    if (input.eventType !== null && !isValidEventType(input.eventType)) {
      return { error: `Invalid eventType. Must be one of: ${EVENT_TYPES.join(', ')}.` };
    }
    $set.eventType = input.eventType;
  }

  if (!Object.keys($set).length) {
    return JSON.parse(JSON.stringify(currentEvent));
  }

  const updated = await EvenueEvent.findByIdAndUpdate(currentEvent._id, { $set }, {
    new: true,
    runValidators: true,
  }).maxTimeMS(10000);

  if (!updated) {
    return { error: 'Failed to update event - event may have been deleted' };
  }

  return JSON.parse(JSON.stringify(updated));
}

/**
 * Update a tickets.com event.
 *
 * Tickets.com events are stored in tc_events collection.
 * Portal can update: Skip_Scraping, priceIncreasePercentage, eventType, Zone, and markup adjustments.
 */
async function updateTcEvent(
  currentEvent: { _id: unknown },
  updateData: Partial<Event> & { Skip_Scraping?: boolean; priceIncreasePercentage?: number }
) {
  const input = updateData as EvenueEventInput;
  const $set: Record<string, unknown> = {};

  if (input.Skip_Scraping !== undefined)
    $set.Skip_Scraping = Boolean(input.Skip_Scraping);

  if (input.priceIncreasePercentage !== undefined) {
    const markup = Number(input.priceIncreasePercentage);
    if (isNaN(markup) || markup < 0) {
      return { error: 'Markup percentage must be a number, 0 or greater.' };
    }
    $set.priceIncreasePercentage = markup;
  }

  if (input.Zone !== undefined)
    $set.Zone = String(input.Zone);

  for (const field of EVENUE_ADJUSTMENT_FIELDS) {
    if (input[field] === undefined) continue;
    const n = Number(input[field]);
    if (isNaN(n)) return { error: `${field} must be a number.` };
    $set[field] = n;
  }
  if (input.includeStandardSeats !== undefined)
    $set.includeStandardSeats = Boolean(input.includeStandardSeats);
  if (input.includeResaleSeats !== undefined)
    $set.includeResaleSeats = Boolean(input.includeResaleSeats);

  if (input.eventType !== undefined) {
    if (input.eventType !== null && !isValidEventType(input.eventType)) {
      return { error: `Invalid eventType. Must be one of: ${EVENT_TYPES.join(', ')}.` };
    }
    $set.eventType = input.eventType;
  }

  if (!Object.keys($set).length) {
    return JSON.parse(JSON.stringify(currentEvent));
  }

  const updated = await TcEvent.findByIdAndUpdate(currentEvent._id, { $set }, {
    new: true,
    runValidators: true,
  }).maxTimeMS(10000);

  if (!updated) {
    return { error: 'Failed to update event - event may have been deleted' };
  }

  return JSON.parse(JSON.stringify(updated));
}

/**
 * Update a Telecharge performance.
 *
 * Writable: pause, markup, zone, CSV adjustments and toggles, event type, and the
 * timing fields — performance date/time, in-hand date — plus name and mapping ID.
 *
 * Like eVenue, this never deletes inventory. The scraper retires listings itself
 * (Mongo row + SeatScouts delete together):
 *   - paused             -> delisted on its next sweep
 *   - markup changed     -> re-priced on its next pass
 *   - date/time changed  -> re-resolved to the new performance; the old
 *                           performance's inventory is delisted
 */
async function updateTelechargeEvent(
  currentEvent: { _id: unknown; URL?: string; Event_DateTime?: Date | string },
  updateData: Partial<Event> & { Skip_Scraping?: boolean; priceIncreasePercentage?: number }
) {
  const input = updateData as TelechargeEventInput & { Event_DateTime?: string | Date; inHandDate?: string | Date; mapping_id?: string };
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, ''> = {};

  if (input.priceIncreasePercentage !== undefined) {
    const markup = Number(input.priceIncreasePercentage);
    if (isNaN(markup) || markup < 0) return { error: 'Markup percentage must be a number, 0 or greater.' };
    $set.priceIncreasePercentage = markup;
  }
  if (input.Skip_Scraping !== undefined) $set.Skip_Scraping = Boolean(input.Skip_Scraping);
  if (input.Zone !== undefined) $set.Zone = String(input.Zone);
  for (const field of EVENUE_ADJUSTMENT_FIELDS) {
    if (input[field] === undefined) continue;
    const n = Number(input[field]);
    if (isNaN(n)) return { error: `${field} must be a number.` };
    $set[field] = n;
  }
  if (input.includeStandardSeats !== undefined) $set.includeStandardSeats = Boolean(input.includeStandardSeats);
  if (input.includeResaleSeats !== undefined) $set.includeResaleSeats = Boolean(input.includeResaleSeats);
  if (input.eventType !== undefined) {
    if (input.eventType !== null && input.eventType !== '' && !isValidEventType(input.eventType)) {
      return { error: `Invalid eventType. Must be one of: ${EVENT_TYPES.join(', ')}.` };
    }
    $set.eventType = input.eventType || null;
  }

  const currentWhen = currentEvent.Event_DateTime ? new Date(currentEvent.Event_DateTime) : null;
  const newWhen = input.Event_DateTime !== undefined ? wallClockDate(input.Event_DateTime) : undefined;
  if (input.Event_DateTime !== undefined && !newWhen) return { error: 'Pick a performance date and time.' };
  if (newWhen && (!currentWhen || performanceMinute(newWhen) !== performanceMinute(currentWhen))) {
    const when = newWhen;
    // Moving to another performance: it must be one the show has on sale.
    const lookup = await lookupTelechargeShow(currentEvent.URL || '', { maxAgeMs: 15 * 60_000 });
    if ('error' in lookup) return { error: lookup.error };
    if (!lookup.performances.some((p) => performanceMinute(p.Event_DateTime) === performanceMinute(when))) {
      return { error: `${formatPerformance(when)}: ${lookup.show.title || 'this show'} has no performance on sale at that date and time on Telecharge.` };
    }
    const clash = await TelechargeEvent.findOne(
      { _id: { $ne: currentEvent._id }, URL: currentEvent.URL, Event_DateTime: when },
      { _id: 1 }
    ).lean().maxTimeMS(5000);
    if (clash) return { error: 'That performance of this show is already registered.' };
    $set.Event_DateTime = when;
    // Resolve again against the new time: the scraper re-derives Event_ID and
    // delists the old performance's inventory.
    $set['telecharge.status'] = 'pending';
    $set['telecharge.lastError'] = null;
  }
  if (input.inHandDate !== undefined) {
    const inHand = wallClockDate(input.inHandDate);
    if (!inHand) return { error: 'Pick an in-hand date.' };
    $set.inHandDate = inHand;
  }
  if (input.Event_Name !== undefined && String(input.Event_Name).trim()) $set.Event_Name = String(input.Event_Name).trim();
  if (input.mapping_id !== undefined) {
    const mappingId = String(input.mapping_id || '').trim();
    // Blank hands the mapping back to the scraper, which uses the Event_ID.
    if (mappingId) $set.mapping_id = mappingId;
    else $unset.mapping_id = '';
  }

  if (!Object.keys($set).length && !Object.keys($unset).length) {
    return JSON.parse(JSON.stringify(currentEvent));
  }

  try {
    const updated = await TelechargeEvent.findByIdAndUpdate(
      currentEvent._id,
      { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) },
      { new: true, runValidators: true }
    ).maxTimeMS(10000);
    if (!updated) return { error: 'Failed to update event - event may have been deleted' };
    return JSON.parse(JSON.stringify(updated));
  } catch (error) {
    const message = (error as Error).message || 'Failed to update event';
    return { error: /duplicate key/i.test(message) ? 'That mapping ID is already used by another Telecharge performance.' : message };
  }
}

// Example of how to get an event by a different unique field, e.g., Event_ID
/**
 * Retrieves a single event by its Event_ID.
 * @param {string} eventSpecificId - The Event_ID of the event to retrieve.
 * @returns {Promise<object|null>} The event object or null if not found, or an error object.
 */
export async function getEventByEventIdString(eventSpecificId: string) {
  await dbConnect();
  try {
    const event = await Event.findOne({ Event_ID: eventSpecificId });
    if (!event) {
      return null;
    }
    return JSON.parse(JSON.stringify(event));
  } catch (error: unknown) {
    console.error('Error fetching event by Event_ID:', error);
    return { error: (error as Error).message || 'Failed to fetch event by Event_ID' };
  }
}

// You might also want a delete action:
/**
 * Deletes an event by its ID and all associated consecutive seat groups.
 * @param {string} eventId - The ID of the event to delete.
 * @returns {Promise<object>} A success message or an error object.
 */
export async function deleteEvent(eventId: string) {
  await dbConnect();
  try {
    // First, find the event to get its details before deletion
    const found = await findEventAnywhere(eventId);
    if (!found.doc) {
      return { message: 'Event not found', success: false };
    }

    // eVenue: delete the row and stop. Its inventory is delisted by the
    // scraper's sweep, which deletes the Mongo rows and sends the matching
    // SeatScouts deletes together — doing the Mongo half here would leave the
    // listings live with nothing left to reconcile them against.
    if (found.isEvenue) {
      const deleted = await EvenueEvent.findByIdAndDelete(eventId);
      return {
        message: 'Event deleted. Its inventory is delisted by the eVenue scraper on its next sweep.',
        success: true,
        deletedEvent: JSON.parse(JSON.stringify(deleted)),
        deletedSeatGroups: 0,
      };
    }

    // Telecharge: same contract as eVenue — the scraper's sweep delists.
    if (found.isTelecharge) {
      const deleted = await TelechargeEvent.findByIdAndDelete(eventId);
      return {
        message: 'Event deleted. Its inventory is delisted by the Telecharge scraper on its next sweep.',
        success: true,
        deletedEvent: JSON.parse(JSON.stringify(deleted)),
        deletedSeatGroups: 0,
      };
    }

    const eventToDelete = found.doc;

    // Delete all associated consecutive seat groups first using Event_ID (not MongoDB _id)
    const seatDeletionResult = await deleteConsecutiveGroupsByEventId(eventToDelete.Event_ID);
    
    // Delete the event
    const deletedEvent = await Event.findByIdAndDelete(eventId);
    
    return { 
      message: `Event deleted successfully. Also deleted ${seatDeletionResult.deletedCount || 0} associated seat groups.`, 
      success: true, 
      deletedEvent: JSON.parse(JSON.stringify(deletedEvent)),
      deletedSeatGroups: seatDeletionResult.deletedCount || 0
    };
  } catch (error) {
    console.error('Error deleting event:', error);
    return { error: (error as Error).message || 'Failed to delete event', success: false };
  }
}

/**
 * Toggle CSV export setting (includeStandardSeats or includeResaleSeats) for an event.
 */
export async function toggleCsvExportSetting(
  eventId: string,
  field: 'includeStandardSeats' | 'includeResaleSeats',
  value: boolean
) {
  if (!eventId || typeof eventId !== 'string') {
    return { error: 'Invalid event ID provided' };
  }
  if (field !== 'includeStandardSeats' && field !== 'includeResaleSeats') {
    return { error: 'Invalid field' };
  }

  await dbConnect();
  try {
    // Both rosters carry these toggles, so the switch works the same on an
    // eVenue row as on a Ticketmaster one — it just lives in ev_events.
    const found = await findEventAnywhere(eventId);
    if (!found.doc) {
      return { error: 'Event not found' };
    }

    const model = found.isEvenue ? EvenueEvent : found.isTelecharge ? TelechargeEvent : Event;
    const updatedEvent = await model
      .findByIdAndUpdate(eventId, { [field]: value }, { new: true, runValidators: true })
      .maxTimeMS(5000);

    if (!updatedEvent) {
      return { error: 'Event not found' };
    }

    return JSON.parse(JSON.stringify(updatedEvent));
  } catch (error) {
    console.error('Error toggling CSV export setting:', error);
    return { error: (error as Error).message || 'Failed to toggle setting' };
  }
}

export async function updateAllEvents(status: boolean){
  await dbConnect()
  try{
    // If we're stopping scraping (status = true), we need to delete all seat groups
    if (status === true) {
      // Get all Event_ID fields (not MongoDB _id) to match ConsecutiveGroup eventId field
      const events = await Event.find({}, 'Event_ID');
      const eventIds = events.map(event => event.Event_ID);
      
      // Delete all seat groups for all events efficiently
      const seatDeletionResult = await deleteConsecutiveGroupsByEventIds(eventIds);
      
      const updateEventsStatus = await Event.updateMany(
        {}, // Update all events
        { Skip_Scraping: status } // Set Skip_Scraping to the provided status
      );

      return {
        success: true,
        message: `Successfully updated ${updateEventsStatus.modifiedCount} events and deleted ${seatDeletionResult.deletedCount || 0} seat groups`,
        modifiedCount: updateEventsStatus.modifiedCount,
        deletedSeatGroups: seatDeletionResult.deletedCount || 0,
        status: status
      };
    } else {
      // Just update the events without deleting seats
      const updateEventsStatus = await Event.updateMany(
        {}, // Update all events
        { Skip_Scraping: status } // Set Skip_Scraping to the provided status
      );

      return {
        success: true,
        message: `Successfully updated ${updateEventsStatus.modifiedCount} events`,
        modifiedCount: updateEventsStatus.modifiedCount,
        status: status
      };
    }
  }catch(error){
    console.error('Error updating all events:', error);
    return {
      success: false,
      error: (error as Error).message || 'Failed to update events'
    }
  }
}