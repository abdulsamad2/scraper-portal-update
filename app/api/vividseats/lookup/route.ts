import { NextRequest, NextResponse } from 'next/server';
import { findPerformerId } from '@/lib/vividseats';

/**
 * Server-side performer/production ID lookup via VS search redirect.
 * This is the only part that MUST be server-side (HTML redirect + CORS).
 * The client handles production fetching and date/venue matching.
 */
export async function GET(req: NextRequest) {
  try {
    const searchTerm = req.nextUrl.searchParams.get('searchTerm');
    if (!searchTerm) {
      return NextResponse.json({ error: 'searchTerm required' }, { status: 400 });
    }

    const { performerId, directProductionId } = await findPerformerId(searchTerm);

    return NextResponse.json({
      performerId,
      directProductionId,
    });
  } catch (error) {
    console.error('Vivid Seats lookup error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Lookup failed' },
      { status: 500 }
    );
  }
}
