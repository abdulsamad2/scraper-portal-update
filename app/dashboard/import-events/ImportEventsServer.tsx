import { unstable_noStore as noStore } from 'next/cache';
import { searchEvents, TMSearchParams } from '@/lib/ticketmaster';
import dbConnect from '@/lib/dbConnect';
import { Event } from '@/models/eventModel';
import { ConsecutiveGroup } from '@/models/seatModel';
import ImportEventsClient from './ImportEventsClient';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ResolvedSearchParams {
  keyword?: string;
  city?: string;
  stateCode?: string;
  startDate?: string;
  endDate?: string;
  segment?: string;
  page?: string;
}

interface Props {
  searchParams: Promise<ResolvedSearchParams>;
}

function extractUrlEventId(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/');
    const idx = parts.findIndex(p => p === 'event');
    if (idx >= 0 && idx + 1 < parts.length) return parts[idx + 1];
  } catch { /* ignore */ }
  return '';
}

export default async function ImportEventsServer({ searchParams }: Props) {
  noStore();

  const sp = await searchParams;
  const page = parseInt(sp.page || '0');
  const keyword = sp.keyword || '';
  const city = sp.city || '';
  const stateCode = sp.stateCode || '';
  const startDate = sp.startDate || '';
  const endDate = sp.endDate || '';
  const segment = sp.segment || '';

  // Determine if this is a search or trending view
  const isSearch = !!(keyword || city || startDate || endDate);

  const params: TMSearchParams = {
    keyword: keyword || undefined,
    city: city || undefined,
    stateCode: stateCode || undefined,
    localStartDateTime: startDate || undefined,
    localEndDateTime: endDate || undefined,
    classificationName: segment || undefined,
    size: 20,
    page,
    sort: isSearch ? 'date,asc' : 'relevance,desc',
  };

  let result;
  let error = '';
  try {
    result = await searchEvents(params);
  } catch (err: any) {
    error = err.message || 'Search failed';
    result = { events: [], total: 0, page: 0, totalPages: 0 };
  }

  // Cross-reference with existing events in DB
  const listedEvents: Record<string, {
    portalId: string;
    mappingId: string;
    availableSeats: number;
    inventoryCount: number;
    scrapingActive: boolean;
  }> = {};

  if (result.events.length > 0) {
    try {
      await dbConnect();

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

      const existingEvents = await Event.find(
        {
          $or: [
            { Event_ID: { $in: allUrlIds } },
            { URL: { $in: allUrls } },
          ],
        },
        { Event_ID: 1, mapping_id: 1, Available_Seats: 1, Skip_Scraping: 1, URL: 1, _id: 1 }
      ).lean();

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

      const urlToApiId: Record<string, string> = {};
      for (const ev of result.events) {
        if (ev.url) urlToApiId[ev.url] = ev.id;
      }

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

        if (dbEventId && urlIdToApiId[dbEventId]) {
          listedEvents[urlIdToApiId[dbEventId]] = info;
        } else if (dbUrl && urlToApiId[dbUrl]) {
          listedEvents[urlToApiId[dbUrl]] = info;
        }
      }
    } catch (dbErr: any) {
      console.error('DB cross-reference error:', dbErr);
    }
  }

  return (
    <ImportEventsClient
      events={result.events}
      listedEvents={listedEvents}
      total={result.total}
      totalPages={result.totalPages}
      currentPage={page}
      isSearch={isSearch}
      searchError={error}
      filters={{
        keyword,
        city,
        stateCode,
        startDate,
        endDate,
        segment,
      }}
    />
  );
}
