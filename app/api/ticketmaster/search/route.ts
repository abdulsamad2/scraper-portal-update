import { NextRequest, NextResponse } from 'next/server';
import { searchEvents, TMSearchParams } from '@/lib/ticketmaster';
import dbConnect from '@/lib/dbConnect';
import { Event } from '@/models/eventModel';
import { ConsecutiveGroup } from '@/models/seatModel';

/**
 * Extract the URL-path event ID from a Ticketmaster URL.
 * e.g. "https://www.ticketmaster.com/.../event/39006244E391557A" → "39006244E391557A"
 * This is DIFFERENT from the Discovery API id (e.g. "1AyZka7GkdN_gf-").
 * Our DB stores the URL-path ID as Event_ID.
 */
function extractUrlEventId(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/');
    const idx = parts.findIndex(p => p === 'event');
    if (idx >= 0 && idx + 1 < parts.length) return parts[idx + 1];
  } catch { /* ignore */ }
  return '';
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;

    const params: TMSearchParams = {
      keyword: sp.get('keyword') || undefined,
      city: sp.get('city') || undefined,
      stateCode: sp.get('stateCode') || undefined,
      localStartDateTime: sp.get('localStartDateTime') || undefined,
      localEndDateTime: sp.get('localEndDateTime') || undefined,
      classificationName: sp.get('classificationName') || undefined,
      size: sp.has('size') ? Number(sp.get('size')) : 20,
      page: sp.has('page') ? Number(sp.get('page')) : 0,
      sort: sp.get('sort') || 'date,asc',
    };

    const result = await searchEvents(params);

    // Cross-reference with existing events in our DB
    if (result.events.length > 0) {
      await dbConnect();

      // The TM Discovery API id (e.g. "1AyZka7GkdN_gf-") differs from the
      // URL-path id (e.g. "39006244E391557A") that our DB stores as Event_ID.
      // Build a map: urlPathId → tmApiId so we can match DB records back.
      const urlIdToApiId: Record<string, string> = {};
      const allUrlIds: string[] = [];
      const allUrls: string[] = [];

      for (const ev of result.events) {
        const urlId = extractUrlEventId(ev.url);
        if (urlId) {
          urlIdToApiId[urlId] = ev.id;
          allUrlIds.push(urlId);
        }
        if (ev.url) allUrls.push(ev.url);
      }

      // Query DB: match by URL-path Event_ID or by full URL
      const existingEvents = await Event.find(
        {
          $or: [
            { Event_ID: { $in: allUrlIds } },
            { URL: { $in: allUrls } },
          ],
        },
        { Event_ID: 1, mapping_id: 1, Available_Seats: 1, Skip_Scraping: 1, URL: 1, _id: 1 }
      ).lean();

      // Get inventory counts
      const mappingIds = existingEvents
        .map((e: Record<string, unknown>) => e.mapping_id as string)
        .filter(Boolean);

      const inventoryCounts: Record<string, number> = {};
      if (mappingIds.length > 0) {
        const counts = await ConsecutiveGroup.aggregate([
          { $match: { mapping_id: { $in: mappingIds } } },
          { $group: { _id: '$mapping_id', total: { $sum: '$inventory.quantity' } } },
        ]);
        for (const c of counts) {
          inventoryCounts[c._id] = c.total;
        }
      }

      // Build a URL → API id reverse map for URL-based matching
      const urlToApiId: Record<string, string> = {};
      for (const ev of result.events) {
        if (ev.url) urlToApiId[ev.url] = ev.id;
      }

      // Build lookup map keyed by TM API event id (what the frontend uses)
      const listedMap: Record<string, {
        portalId: string;
        mappingId: string;
        availableSeats: number;
        inventoryCount: number;
        scrapingActive: boolean;
      }> = {};

      for (const ev of existingEvents) {
        const e = ev as Record<string, unknown>;
        const dbEventId = (e.Event_ID as string) || '';
        const dbUrl = (e.URL as string) || '';
        const mid = (e.mapping_id as string) || '';

        const info = {
          portalId: String(e._id),
          mappingId: mid,
          availableSeats: (e.Available_Seats as number) || 0,
          inventoryCount: inventoryCounts[mid] || 0,
          scrapingActive: !(e.Skip_Scraping as boolean),
        };

        // Match via URL-path Event_ID → TM API id
        if (dbEventId && urlIdToApiId[dbEventId]) {
          listedMap[urlIdToApiId[dbEventId]] = info;
        }
        // Fallback: match via full URL
        else if (dbUrl && urlToApiId[dbUrl]) {
          listedMap[urlToApiId[dbUrl]] = info;
        }
      }

      return NextResponse.json({ ...result, listedEvents: listedMap });
    }

    return NextResponse.json({ ...result, listedEvents: {} });
  } catch (error) {
    console.error('Ticketmaster search error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Search failed' },
      { status: 500 }
    );
  }
}
