import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/dbConnect';
import { requireApiKey } from '@/lib/apiKey';

/**
 * GET /api/seed-event
 *
 * Picks a live event id for the cookie-farm to seed against. tmpt is
 * event-agnostic, so any active event works; we return the most recently
 * updated event that isn't flagged Skip_Scraping. Replaces the farm's direct
 * read of the `events` collection (farm.js#pickEvent / measure.js#pickEvent).
 *
 * Auth: x-api-key header / Authorization: Bearer / ?apiKey= (see lib/apiKey).
 * Response: { ok: true, eventId: string | null }
 */

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const denied = requireApiKey(req);
    if (denied) return denied;

    await dbConnect();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no_db_connection');

    const doc = await db
      .collection('events')
      .findOne(
        { Skip_Scraping: { $ne: true } },
        { sort: { Last_Updated: -1 }, projection: { Event_ID: 1, eventId: 1 } }
      );

    const eventId =
      (doc && (doc.Event_ID || doc.eventId)) ? (doc.Event_ID || doc.eventId) : null;

    return NextResponse.json({ ok: true, eventId });
  } catch (err) {
    console.error('[GET /api/seed-event]', err);
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 });
  }
}
