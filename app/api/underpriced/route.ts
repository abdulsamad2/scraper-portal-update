import { NextResponse } from 'next/server';
import dbConnect from '@/lib/dbConnect';
import { ConsecutiveGroup } from '@/models/seatModel';
import { Event } from '@/models/eventModel';
import {
  findUnderpricedRows,
  sectionKey,
  MAX_UNDERPRICED,
  UNDERPRICED_PCT,
  UNDERPRICED_MIN_COMPARABLES,
  UNDERPRICED_OUTLIER_MULTIPLE,
} from '@/lib/underpriced.js';

/**
 * ── The buy-list, computed from the database ─────────────────────────────────
 *
 * Deliberately not read from the inventory watcher's in-memory state. That
 * state belongs to whichever process happens to serve the request, so with more
 * than one instance the answer depends on which one you reach, it empties on a
 * restart, and it is only as current as the last watch cycle. The listings
 * themselves are in MongoDB, so the buy-list is derived from them on demand and
 * is the same for everyone.
 *
 * Recomputing costs one projected scan of live inventory, so the result is held
 * briefly: the page polls every few seconds and the underlying prices move on
 * the scraper's cadence, not the poll's.
 */

export const dynamic = 'force-dynamic';

const CACHE_MS = Number(process.env.UNDERPRICED_CACHE_MS ?? 20_000);

interface Bargain {
  key: string;
  eventId: string;
  eventName: string;
  venue: string;
  eventDate: string | null;
  url: string;
  section: string;
  row: string;
  seatRange: string;
  price: number;
  comparableAvg: number;
  comparableCount: number;
  pctBelow: number;
}

let cache: { at: number; payload: unknown } | null = null;

const norm = (v: unknown) => String(v ?? '').trim().toUpperCase();

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json(cache.payload);
  }

  try {
    await dbConnect();

    // One representative listing per (event, section, row) — the cheapest, which
    // is the one a buyer would take and so the one worth judging.
    const rows = await ConsecutiveGroup.find(
      { event_date: { $gte: new Date() } },
      {
        eventId: 1, event_name: 1, venue_name: 1, event_date: 1, seatRange: 1,
        'inventory.section': 1, 'inventory.row': 1, 'inventory.rowRank': 1,
        'inventory.listPrice': 1,
      },
    ).maxTimeMS(30_000).lean();

    const snapshot = new Map<string, {
      price: number; section: string; row: string; rowRank: number | null;
      seatRange: string; eventId: string; eventName: string; venue: string; eventDate: string | null;
    }>();

    interface GroupDoc {
      eventId: string;
      event_name?: string;
      venue_name?: string;
      event_date?: Date | string;
      seatRange?: string;
      inventory?: { section?: string; row?: string; rowRank?: number | null; listPrice?: number };
    }

    for (const r of rows as unknown as GroupDoc[]) {
      const price = r.inventory?.listPrice;
      if (typeof price !== 'number') continue;
      const section = norm(r.inventory?.section);
      const row = norm(r.inventory?.row);
      const key = `${r.eventId}|${section}|${row}`;
      const held = snapshot.get(key);
      if (held && held.price <= price) continue;
      snapshot.set(key, {
        price,
        section,
        row,
        rowRank: typeof r.inventory?.rowRank === 'number' ? r.inventory.rowRank : null,
        seatRange: r.seatRange || '',
        eventId: r.eventId,
        eventName: r.event_name || '',
        venue: r.venue_name || '',
        eventDate: r.event_date ? new Date(r.event_date).toISOString() : null,
      });
    }

    // Every section is in play: nothing here is diffing against a previous run.
    const sections = new Set<string>();
    for (const v of snapshot.values()) sections.add(sectionKey(v.eventId, v.section));

    const found = findUnderpricedRows({ snapshot }, sections);

    // Ticketmaster links live on the event, not the listing.
    const urls = new Map<string, string>();
    const eventIds = [...new Set(found.map((f: { eventId: string }) => f.eventId))];
    if (eventIds.length) {
      const events = await Event.find(
        { Event_ID: { $in: eventIds } },
        { Event_ID: 1, URL: 1 },
      ).lean();
      for (const e of events as unknown as Array<{ Event_ID: string; URL?: string }>) {
        urls.set(e.Event_ID, e.URL || '');
      }
    }

    interface FoundRow {
      key: string; eventId: string; eventName?: string; venue?: string; eventDate?: string | null;
      section: string; row: string; seatRange?: string;
      price: number; comparableAvg: number; comparableCount: number; pctBelow: number;
    }

    const underpriced: Bargain[] = (found as FoundRow[]).slice(0, MAX_UNDERPRICED).map(f => ({
      key: f.key,
      eventId: f.eventId,
      eventName: f.eventName || '',
      venue: f.venue || '',
      eventDate: f.eventDate ?? null,
      url: urls.get(f.eventId) || '',
      section: f.section,
      row: f.row,
      seatRange: f.seatRange || '',
      price: Math.round(f.price * 100) / 100,
      comparableAvg: Math.round(f.comparableAvg * 100) / 100,
      comparableCount: f.comparableCount,
      pctBelow: Math.round(f.pctBelow * 10) / 10,
    }));

    const payload = {
      success: true,
      generatedAt: new Date().toISOString(),
      listingsConsidered: snapshot.size,
      rankedListings: [...snapshot.values()].filter(v => v.rowRank != null).length,
      thresholds: {
        pct: UNDERPRICED_PCT,
        minComparables: UNDERPRICED_MIN_COMPARABLES,
        outlierMultiple: UNDERPRICED_OUTLIER_MULTIPLE,
      },
      underpriced,
    };

    cache = { at: Date.now(), payload };
    return NextResponse.json(payload);
  } catch (error) {
    console.error('[underpriced] failed:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to compute underpriced listings', underpriced: [] },
      { status: 500 },
    );
  }
}
