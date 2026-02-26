import { NextRequest, NextResponse } from 'next/server';

/**
 * Resolve a Ticketmaster URL to its canonical form.
 *
 * The TM Discovery API sometimes returns short URLs like
 *   https://www.ticketmaster.com/event/Z7r9jZ1A7_VZF
 * which use the API ID.  Ticketmaster 301-redirects these to the
 * canonical URL that contains the hex Event_ID our DB expects:
 *   https://www.ticketmaster.com/event-name/event/0C006244B3E01A1A
 *
 * We follow the redirect server-side so the frontend can store the
 * correct URL + Event_ID.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'url parameter required' }, { status: 400 });
  }

  try {
    // Follow redirects (default behaviour) and grab the final URL
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    const finalUrl = res.url; // URL after all redirects

    // Extract hex Event_ID from the canonical URL
    let eventId = '';
    try {
      const parts = new URL(finalUrl).pathname.split('/');
      const idx = parts.findIndex(p => p === 'event');
      if (idx >= 0 && idx + 1 < parts.length) {
        eventId = parts[idx + 1];
      }
    } catch { /* ignore */ }

    return NextResponse.json({ url: finalUrl, eventId });
  } catch (error) {
    console.error('URL resolve error:', error);
    return NextResponse.json(
      { error: 'Failed to resolve URL', url, eventId: '' },
      { status: 500 }
    );
  }
}
