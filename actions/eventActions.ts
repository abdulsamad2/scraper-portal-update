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

/**
 * Stage-2 markup fields: applied by the exporter, not by the scraper.
 *
 * Editing one changes the price StubHub should hold without changing any
 * inventory row, so nothing marks the rows dirty by itself. Kept as one list so
 * the requeue and the eVenue writer cannot drift apart.
 */
const MARKUP_ADJUSTMENT_FIELDS = [
  'standardMarkupAdjustment',
  'resaleMarkupAdjustment',
  'brokerMarkupAdjustment',
] as const;

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
  if (tmEvent) return { doc: tmEvent, isEvenue: false, isTc: false };

  const tcEvent = await TcEvent.findById(eventId).maxTimeMS(5000);
  if (tcEvent) return { doc: tcEvent, isEvenue: false, isTc: true };

  const evEvent = await EvenueEvent.findById(eventId).maxTimeMS(5000);
  if (evEvent) return { doc: evEvent, isEvenue: true, isTc: false };

  return { doc: null, isEvenue: false, isTc: false };
}

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
    // All three rosters, same format.
    const events = await Event.aggregate([
      { $unionWith: { coll: 'tc_events' } },
      { $unionWith: { coll: EVENUE_EVENTS_COLLECTION } }
    ]);
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

    // Ticketmaster, tickets.com, and eVenue events live in separate collections,
    // one per scraper. The dashboard is the one place they come back together:
    // union all three rosters, then apply the search, filters, sort and paging
    // to the combined set so paging stays correct across all.
    const tcUnionStage = { $unionWith: { coll: 'tc_events' } };
    const evUnionStage = { $unionWith: { coll: EVENUE_EVENTS_COLLECTION } };
    const matchStages = allConditions.length > 0 ? [{ $match: query }] : [];

    const countResult = await Event.aggregate([tcUnionStage, evUnionStage, ...matchStages, { $count: 'total' }]);
    const total = countResult[0]?.total || 0;

    const events = await Event.aggregate([
      tcUnionStage,
      evUnionStage,
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
    const tcUnion = { $unionWith: { coll: 'tc_events' } };
    const evUnion = { $unionWith: { coll: EVENUE_EVENTS_COLLECTION } };

    // Counts cover all three rosters so the dashboard totals match the list.
    const [totalResult, activeResult] = await Promise.all([
      Event.aggregate([tcUnion, evUnion, { $count: 'n' }]),
      Event.aggregate([tcUnion, evUnion, { $match: activeMatch }, { $count: 'n' }]),
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

    // Stage-2 markup edits, which change the exported price without changing any
    // row. See requeueEventForMarkup for why these need an explicit push into
    // the sync queue and priceIncreasePercentage does not.
    const changedAdjustments = MARKUP_ADJUSTMENT_FIELDS.filter(f => {
      const next = (updateData as Record<string, unknown>)[f];
      if (next === undefined) return false;
      return Number(next ?? 0) !== Number((currentEvent as Record<string, unknown>)[f] ?? 0);
    });
    
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

    // Requeue AFTER the event document is written, so the exporter recomputes
    // against the new adjustment rather than racing the update it was told about.
    // Skipped when the rows were just deleted — the scraper will recreate them.
    if (changedAdjustments.length > 0 && !shouldDeleteSeats) {
      try {
        const { requeueEventForMarkup } = await import('@/lib/sync/queue.ts');
        const requeued = await requeueEventForMarkup(currentEvent.Event_ID);
        result.requeuedForMarkup = requeued;
        console.log(
          `[markup] ${changedAdjustments.join(', ')} changed on ${currentEvent.Event_ID} — ` +
          `requeued ${requeued} row(s) for repricing`
        );
      } catch (error) {
        // The event edit itself succeeded and must not be reported as failed.
        // Surfaced rather than swallowed: the prices are now stale on StubHub
        // until something else queues these rows.
        console.error('[markup] requeue failed — StubHub prices will be stale:', error);
        result.requeueError = (error as Error).message;
      }
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

    const model = found.isEvenue ? EvenueEvent : Event;
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