import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SYNC_API_BASE = 'https://app.seatscouts.com/sync/api';

export async function POST(req: NextRequest) {
  try {
    const apiToken = process.env.SYNC_API_TOKEN;
    const companyId = process.env.SYNC_COMPANY_ID;
    if (!apiToken || !companyId) {
      return NextResponse.json({ error: 'API credentials not configured' }, { status: 500 });
    }

    const body = await req.json();
    const { syncId } = body as { syncId: number };

    if (!syncId) {
      return NextResponse.json({ error: 'syncId required' }, { status: 400 });
    }

    const url = `${SYNC_API_BASE}/orders/${syncId}/recheck`;
    console.log(`SeatScouts recheck order: ${url}`);

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Company-Id': companyId,
        'X-Api-Token': apiToken,
        'Accept': 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`SeatScouts recheck failed for syncId ${syncId}: ${res.status} - ${text}`);
      return NextResponse.json(
        { error: `SeatScouts API error ${res.status}: ${text}` },
        { status: 502 }
      );
    }

    const data = await res.json().catch(() => ({}));
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Order recheck error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Recheck failed' },
      { status: 500 }
    );
  }
}
