'use server';

import dbConnect from '@/lib/dbConnect';
import { Event } from '@/models/eventModel';
import { ConsecutiveGroup } from '@/models/seatModel';
import { StubHubListing } from '@/models/stubhubListingModel';
import { StubHubSale } from '@/models/stubhubSaleModel';

/**
 * Get ALL events for the StubHub page (matched and unmatched).
 */
export async function getStubHubEvents() {
  await dbConnect();
  try {
    const events = await Event.find(
      {},
      'Event_ID Event_Name Event_DateTime Venue stubhubUrl stubhubLastScraped stubhubEventId Skip_Scraping useStubHubPricing'
    )
      .sort({ Event_DateTime: 1 })
      .lean();
    return { success: true, events: JSON.parse(JSON.stringify(events)) };
  } catch (error: unknown) {
    console.error('Error fetching StubHub events:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to fetch events' };
  }
}

export interface StubHubEventItem {
  _id: string;
  Event_ID: string;
  Event_Name: string;
  Event_DateTime: string;
  Venue?: string;
  stubhubUrl?: string;
  stubhubEventId?: string;
  stubhubLastScraped?: string;
  useStubHubPricing?: boolean;
  stubhubEnabled?: boolean;
  Skip_Scraping?: boolean;
  updatedAt?: string;
  Last_Updated?: string;
}

export type StubHubSortBy = 'eventDate' | 'lastScraped' | 'status' | 'name' | 'updatedAt';
export type SortOrder = 'asc' | 'desc';

/**
 * Paginated + filtered events for the StubHub page (server-side).
 */
export async function getStubHubEventsPaginated(opts: {
  search?: string;
  filter?: 'ALL' | 'WITH_URL' | 'NO_URL' | 'ACTIVE' | 'AUTO_PRICE';
  page?: number;
  perPage?: number;
  sortBy?: StubHubSortBy;
  sortOrder?: SortOrder;
}) {
  await dbConnect();
  try {
    const { search = '', filter = 'ACTIVE', page = 1, perPage = 20, sortBy = 'eventDate', sortOrder = 'asc' } = opts;
    const query: Record<string, unknown> = {};

    if (filter === 'WITH_URL') query.stubhubUrl = { $ne: null, $exists: true };
    else if (filter === 'NO_URL') query.$or = [{ stubhubUrl: null }, { stubhubUrl: { $exists: false } }];
    else if (filter === 'ACTIVE') query.Skip_Scraping = false;
    else if (filter === 'AUTO_PRICE') query.useStubHubPricing = true;

    if (search) {
      const regex = { $regex: search, $options: 'i' };
      const searchConditions = [{ Event_Name: regex }, { Venue: regex }];
      if (query.$or) {
        query.$and = [{ $or: query.$or as unknown[] }, { $or: searchConditions }];
        delete query.$or;
      } else {
        query.$or = searchConditions;
      }
    }

    // Build sort
    const dir = sortOrder === 'desc' ? -1 : 1;
    const sortMap: Record<StubHubSortBy, Record<string, 1 | -1>> = {
      eventDate:   { Event_DateTime: dir },
      lastScraped: { stubhubLastScraped: dir },
      status:      { Skip_Scraping: dir, stubhubLastScraped: dir },
      name:        { Event_Name: dir },
      updatedAt:   { updatedAt: dir },
    };
    const mongoSort = sortMap[sortBy];

    const projection = 'Event_ID Event_Name Event_DateTime Venue stubhubUrl stubhubLastScraped stubhubEventId Skip_Scraping useStubHubPricing stubhubEnabled updatedAt Last_Updated';

    const [events, total, totalWithUrl, totalScraped, totalAutoPrice, totalAll] = await Promise.all([
      Event.find(query, projection)
        .sort(mongoSort)
        .skip((page - 1) * perPage)
        .limit(perPage)
        .lean(),
      Event.countDocuments(query),
      Event.countDocuments({ stubhubUrl: { $ne: null, $exists: true } }),
      Event.countDocuments({ stubhubLastScraped: { $ne: null, $exists: true } }),
      Event.countDocuments({ useStubHubPricing: true }),
      Event.countDocuments({}),
    ]);

    return {
      success: true,
      events: JSON.parse(JSON.stringify(events)) as StubHubEventItem[],
      pagination: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
      counts: { all: totalAll, withUrl: totalWithUrl, scraped: totalScraped, autoPrice: totalAutoPrice },
    };
  } catch (error: unknown) {
    console.error('Error fetching paginated StubHub events:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to fetch events' };
  }
}

/**
 * Save (or clear) the StubHub URL for an event.
 * Auto-extracts stubhubEventId and resets lastScraped so scraper picks it up next cycle.
 */
export async function saveStubHubUrl(eventId: string, url: string) {
  await dbConnect();
  try {
    const trimmed = url.trim();
    const match = trimmed.match(/\/event\/(\d+)/);
    const stubhubEventId = match ? match[1] : null;

    await Event.findOneAndUpdate(
      { Event_ID: eventId },
      {
        stubhubUrl: trimmed || null,
        stubhubLastScraped: null,
        ...(stubhubEventId && { stubhubEventId }),
      }
    );
    return { success: true };
  } catch (error: unknown) {
    console.error('Error saving StubHub URL:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to save URL' };
  }
}

/**
 * Toggle StubHub auto-pricing for a single event.
 * When enabled, CSV export uses the scraper's suggestedPrice instead of the markup formula.
 */
export async function toggleStubHubPricing(eventId: string, enabled: boolean) {
  await dbConnect();
  try {
    await Event.findOneAndUpdate(
      { Event_ID: eventId },
      { useStubHubPricing: enabled }
    );
    return { success: true, enabled };
  } catch (error: unknown) {
    console.error('Error toggling StubHub pricing:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to toggle pricing' };
  }
}

/**
 * Enable or disable StubHub scraping for a single event.
 * Independent of Skip_Scraping — lets you pause StubHub without affecting the main scraper.
 */
export async function toggleStubHubEnabled(eventId: string, enabled: boolean) {
  await dbConnect();
  try {
    await Event.findOneAndUpdate(
      { Event_ID: eventId },
      { stubhubEnabled: enabled }
    );
    return { success: true, enabled };
  } catch (error: unknown) {
    console.error('Error toggling StubHub enabled:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to toggle' };
  }
}

export interface ComparisonRow {
  _id: string;
  section: string;
  row: string;
  seatCount: number;
  seatRange: string;
  inventoryId: number;
  ourPrice: number;
  ourCost: number;
  margin: number | null;
  // Section-level SH data (pre-computed by scraper)
  sectionLowest: number | null;
  sectionAvg: number | null;
  sectionHigh: number | null;
  sectionCount: number;
  ticketClassName: string;
  dealZonePrice: number | null;
  badgeAchievable: boolean;
  badgeName: string | null;
  atFloor: boolean;
  currentRank: number | null;
  suggestedRank: number | null;
  pricingStatus: 'OVERPRICED' | 'AT_FLOOR' | 'COMPETITIVE' | 'BELOW_MARKET' | 'NO_COMPETITION' | 'NO_OUR_INVENTORY';
  ourFloorPrice: number | null;
  suggestedPrice: number | null;
  // Derived
  priceDiff: number | null;
  pricePosition: number | null;
}

export interface EventSummary {
  totalRows: number;
  overpriced: number;
  atFloor: number;
  competitive: number;
  belowMarket: number;
  noCompetition: number;
  totalOurTickets: number;
  totalShListings: number;
  potentialRevenueLoss: number;
  lastScraped: string | null;
}

/**
 * Per-row comparison using pre-computed scraper fields from stubhublistings.
 */
export async function getEventComparison(eventId: string) {
  await dbConnect();
  try {
    const [ourInventory, stubhubListings, eventDoc] = await Promise.all([
      ConsecutiveGroup.find({ eventId }).sort({ section: 1, row: 1 }).lean(),
      StubHubListing.find({ eventId }).sort({ section: 1, pricePerTicket: 1 }).lean(),
      Event.findOne(
        { Event_ID: eventId },
        'Event_ID Event_Name Event_DateTime Venue stubhubUrl stubhubLastScraped stubhubEventId useStubHubPricing'
      ).lean(),
    ]);

    if (!eventDoc) return { success: false, error: 'Event not found' };

    // Build section-level summary from pre-computed scraper fields.
    // All listings in the same section share the same section-level values —
    // we take the last listing per section (scraper overwrites on each run).
    interface ShSection {
      sectionLowest: number | null;
      sectionAvg: number | null;
      sectionHigh: number;
      sectionCount: number;
      ticketClassName: string;
      dealZonePrice: number | null;
      badgeAchievable: boolean;
      atFloor: boolean;
      currentRank: number | null;
      suggestedRank: number | null;
      pricingStatus: ComparisonRow['pricingStatus'];
      ourFloorPrice: number | null;
      suggestedPrice: number | null;
      badgeName: string | null;
      lastScraped: string | null;
    }

    const shBySection = new Map<string, ShSection>();
    const normalizeSection = (s: string): string => {
      if (!s) return '';
      let n = s.toUpperCase().trim();
      n = n.replace(/^(SEC(?:TION|T)?)\s+/i, '');
      n = n.replace(/^FLR\s+L$/i, 'LEFT')
           .replace(/^FLR\s+R$/i, 'RIGHT')
           .replace(/^FLR\s+C$/i, 'CENTER')
           .replace(/^FLOOR$/i, 'CENTER');
      return n;
    };

    for (const l of stubhubListings) {
      const key = normalizeSection(l.section);
      const existing = shBySection.get(key);
      const entry: ShSection = {
        sectionLowest:   l.sectionLowest   ?? existing?.sectionLowest   ?? null,
        sectionAvg:      l.sectionAvg      ?? existing?.sectionAvg      ?? null,
        sectionHigh:     Math.max(l.pricePerTicket, existing?.sectionHigh ?? 0),
        sectionCount:    l.sectionCount    ?? existing?.sectionCount    ?? 0,
        ticketClassName: l.ticketClassName ?? existing?.ticketClassName ?? '',
        dealZonePrice:   l.dealZonePrice   ?? existing?.dealZonePrice   ?? null,
        badgeAchievable: l.badgeAchievable ?? existing?.badgeAchievable ?? false,
        badgeName:       l.badgeName       ?? existing?.badgeName       ?? null,
        atFloor:         l.atFloor         ?? existing?.atFloor         ?? false,
        currentRank:     l.ourCurrentRank  ?? existing?.currentRank     ?? null,
        suggestedRank:   l.suggestedRank   ?? existing?.suggestedRank   ?? null,
        pricingStatus:   (l.pricingStatus  ?? existing?.pricingStatus   ?? 'NO_COMPETITION') as ComparisonRow['pricingStatus'],
        ourFloorPrice:   l.ourFloorPrice   ?? existing?.ourFloorPrice   ?? null,
        suggestedPrice:  l.suggestedPrice  ?? existing?.suggestedPrice  ?? null,
        lastScraped:     l.lastScraped ? new Date(l.lastScraped).toISOString() : existing?.lastScraped ?? null,
      };
      shBySection.set(key, entry);
    }

    // Build one row per consecutive group — derive per-row status from actual row price/cost
    const rows: ComparisonRow[] = ourInventory.map(inv => {
      const sh = shBySection.get(normalizeSection(inv.section)) ?? null;
      const ourPrice = inv.inventory.listPrice;
      const ourCost  = inv.inventory.cost;
      const margin   = ourCost > 0 ? +((ourPrice - ourCost) / ourCost * 100).toFixed(1) : null;

      const sectionLowest = sh?.sectionLowest ?? null;
      const sectionHigh   = sh ? sh.sectionHigh : null;
      const priceDiff     = sectionLowest !== null ? +(ourPrice - sectionLowest).toFixed(2) : null;

      // Use scraper's pre-computed values directly
      const ourFloorPrice = sh?.ourFloorPrice ?? null;
      const atFloor = sh?.atFloor ?? false;
      const pricingStatus = sh?.pricingStatus ?? 'NO_COMPETITION';

      let pricePosition: number | null = null;
      if (sectionLowest !== null && sectionHigh !== null && sectionHigh > sectionLowest) {
        pricePosition = Math.round((ourPrice - sectionLowest) / (sectionHigh - sectionLowest) * 100);
      } else if (sectionLowest !== null && ourPrice <= sectionLowest) {
        pricePosition = 0;
      }

      return {
        _id:             String((inv as Record<string, unknown>)._id),
        section:         inv.section,
        row:             inv.row,
        seatCount:       inv.seatCount,
        seatRange:       inv.seatRange,
        inventoryId:     inv.inventory.inventoryId,
        ourPrice,
        ourCost,
        margin,
        sectionLowest,
        sectionAvg:      sh?.sectionAvg      ?? null,
        sectionHigh,
        sectionCount:    sh?.sectionCount    ?? 0,
        ticketClassName: sh?.ticketClassName ?? '',
        dealZonePrice:   sh?.dealZonePrice   ?? null,
        badgeAchievable: (sh?.badgeAchievable ?? false) &&
          (sh?.suggestedPrice == null || ourFloorPrice == null || sh.suggestedPrice >= ourFloorPrice * 0.97),
        badgeName:       sh?.badgeName       ?? null,
        atFloor,
        currentRank:     sh?.currentRank     ?? null,
        suggestedRank:   sh?.suggestedRank   ?? null,
        pricingStatus,
        ourFloorPrice,
        suggestedPrice:  sh?.suggestedPrice  ?? null,
        priceDiff,
        pricePosition,
      };
    });

    // Summary
    const lastScrapedVals = [...shBySection.values()]
      .map(s => s.lastScraped).filter(Boolean) as string[];
    const latestScrape = lastScrapedVals.length ? lastScrapedVals.sort().at(-1)! : null;

    const potentialLoss = rows
      .filter(r => r.pricingStatus === 'OVERPRICED' && r.priceDiff !== null)
      .reduce((s, r) => s + r.priceDiff! * r.seatCount, 0);

    const summary: EventSummary = {
      totalRows:           rows.length,
      overpriced:          rows.filter(r => r.pricingStatus === 'OVERPRICED').length,
      atFloor:             rows.filter(r => r.pricingStatus === 'AT_FLOOR').length,
      competitive:         rows.filter(r => r.pricingStatus === 'COMPETITIVE').length,
      belowMarket:         rows.filter(r => r.pricingStatus === 'BELOW_MARKET').length,
      noCompetition:       rows.filter(r => r.pricingStatus === 'NO_COMPETITION').length,
      totalOurTickets:     rows.reduce((s, r) => s + r.seatCount, 0),
      totalShListings:     stubhubListings.length,
      potentialRevenueLoss: Math.round(potentialLoss * 100) / 100,
      lastScraped:         latestScrape,
    };

    // Fetch sales analytics in parallel
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SaleModel = StubHubSale as any;
    const [salesSummary, salesVelocity] = await Promise.all([
      SaleModel.getEventSalesSummary(eventId).catch(() => null),
      SaleModel.getSalesVelocity(eventId, 24).catch(() => []),
    ]);

    return {
      success: true,
      event:   JSON.parse(JSON.stringify(eventDoc)),
      rows:    JSON.parse(JSON.stringify(rows)),
      summary: JSON.parse(JSON.stringify(summary)),
      sales:   JSON.parse(JSON.stringify({ summary: salesSummary, velocity: salesVelocity })),
    };
  } catch (error: unknown) {
    console.error('Error fetching comparison:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to fetch comparison' };
  }
}
