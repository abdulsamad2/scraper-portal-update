import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import dbConnect from '@/lib/dbConnect';
import { Purchase } from '@/models/purchaseModel';

export const revalidate = 0;

function normalizeName(s: string): string {
  return s.toLowerCase().trim()
    .replace(/\s+/g, ' ')
    .replace(/[''`]/g, "'")
    .replace(/\s*[-–—:]\s*/g, ' ')
    .replace(/\b(at|vs\.?|versus)\b/g, 'vs');
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

    // Build query: normalized name + same day
    const query: Record<string, unknown> = {
      eventNameNorm: eventNorm,
    };
    if (eventDay) {
      query.eventDay = eventDay;
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
