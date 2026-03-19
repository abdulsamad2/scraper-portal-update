import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import dbConnect from '@/lib/dbConnect';
import { Purchase } from '@/models/purchaseModel';

export const revalidate = 0;

function normalizeName(s: string): string {
  return s.toLowerCase().trim()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\b(at|versus|vs)\b/g, 'vs')
    .replace(/\s+/g, ' ').trim();
}

function coreWords(s: string): string[] {
  const noise = new Set(['the', 'and', 'tour', 'presents', 'featuring', 'feat', 'live', 'in', 'on', 'of', 'a', 'an', 'vs']);
  return normalizeName(s).split(' ').filter(w => w.length > 1 && !noise.has(w));
}

/**
 * GET /api/accounts/event-accounts?event=<name>&date=<iso>
 * Instant lookup from local MongoDB — no external API calls.
 */
export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  const eventName = request.nextUrl.searchParams.get('event');
  const eventDate = request.nextUrl.searchParams.get('date');
  if (!eventName || eventName === '__warmup__') {
    return NextResponse.json({ accounts: [], eventName });
  }

  try {
    await dbConnect();

    const eventNorm = normalizeName(eventName);
    const eventDay = eventDate ? new Date(eventDate).toISOString().slice(0, 10) : null;
    const words = coreWords(eventName);

    // Build query: try exact normalized name first, then fall back to core-word regex
    // Always filter by event day when available (same event name can have many dates)
    const baseDay = eventDay ? { eventDay } : {};

    // Strategy 1: exact normalized name match
    let query: Record<string, unknown> = { eventNameNorm: eventNorm, ...baseDay };
    let count = await Purchase.countDocuments(query);

    // Strategy 2: contains match (order name is shorter than purchase name or vice versa)
    if (count === 0) {
      const escaped = eventNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query = {
        $or: [
          { eventNameNorm: { $regex: escaped } },
          { eventNameNorm: { $regex: words.slice(0, 3).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') } },
        ],
        ...baseDay,
      };
      count = await Purchase.countDocuments(query);
    }

    // Strategy 3: if still nothing and we have a day, try just core words on that day
    if (count === 0 && eventDay && words.length >= 2) {
      const pattern = words.slice(0, 2).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
      query = { eventNameNorm: { $regex: pattern }, eventDay };
      count = await Purchase.countDocuments(query);
    }

    // Fast aggregation: group by account
    const accounts = await Purchase.aggregate([
      { $match: query },
      {
        $group: {
          _id: { $toLower: '$accountUser' },
          email: { $first: '$accountUser' },
          tickets: { $sum: '$quantity' },
          orders: { $sum: 1 },
          lastDate: { $max: '$purchaseDate' },
          sections: { $addToSet: '$section' },
        },
      },
      { $sort: { tickets: -1 } },
      {
        $project: {
          _id: 0,
          email: 1,
          tickets: 1,
          orders: 1,
          lastDate: 1,
          sections: {
            $filter: { input: '$sections', cond: { $ne: ['$$this', null] } },
          },
        },
      },
    ]);

    return NextResponse.json({
      accounts,
      eventName,
      totalMatches: accounts.reduce((s: number, a: { tickets: number }) => s + a.tickets, 0),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
