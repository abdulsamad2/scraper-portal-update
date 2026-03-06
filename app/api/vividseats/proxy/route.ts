import { NextRequest, NextResponse } from 'next/server';

const VS_HERMES = 'https://www.vividseats.com/hermes/api/v1';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
];

/**
 * Thin proxy for Vivid Seats Hermes API.
 * Client calls: /api/vividseats/proxy?path=productions&performerId=123
 * We forward to: https://www.vividseats.com/hermes/api/v1/productions?performerId=123
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const path = sp.get('path');
    if (!path) {
      return NextResponse.json({ error: 'path parameter required' }, { status: 400 });
    }

    // Only allow known safe paths
    if (!/^(productions|performers|search)(\/\d+)?$/.test(path)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Build target URL — forward all query params except 'path'
    const params = new URLSearchParams();
    sp.forEach((value, key) => {
      if (key !== 'path') params.set(key, value);
    });
    const qs = params.toString();
    const targetUrl = `${VS_HERMES}/${path}${qs ? '?' + qs : ''}`;

    const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': ua,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.vividseats.com/',
        'Origin': 'https://www.vividseats.com',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `VS API returned ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('VS proxy error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Proxy request failed' },
      { status: 500 }
    );
  }
}
