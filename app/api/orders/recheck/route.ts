import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SYNC_API_BASE = 'https://app.seatscouts.com/sync/api';

async function recheckOne(syncId: number, companyId: string, apiToken: string) {
  const url = `${SYNC_API_BASE}/orders/${syncId}/recheck`;
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
    return { syncId, success: false, error: `${res.status}: ${text}` };
  }

  const data = await res.json().catch(() => ({}));
  return { syncId, success: true, data };
}

export async function POST(req: NextRequest) {
  try {
    const apiToken = process.env.SYNC_API_TOKEN;
    const companyId = process.env.SYNC_COMPANY_ID;
    if (!apiToken || !companyId) {
      return NextResponse.json({ error: 'API credentials not configured' }, { status: 500 });
    }

    const body = await req.json();
    const { syncId, syncIds } = body as { syncId?: number; syncIds?: number[] };

    // Batch mode: recheck multiple orders sequentially with small delay
    if (syncIds && Array.isArray(syncIds) && syncIds.length > 0) {
      const results: { syncId: number; success: boolean; error?: string; data?: unknown }[] = [];

      for (const id of syncIds) {
        const result = await recheckOne(id, companyId, apiToken);
        results.push(result);
        // Small delay between calls to respect rate limit
        if (syncIds.indexOf(id) < syncIds.length - 1) {
          await new Promise(r => setTimeout(r, 200));
        }
      }

      const succeeded = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      console.log(`Batch recheck: ${succeeded} succeeded, ${failed} failed out of ${syncIds.length}`);

      return NextResponse.json({ success: true, results, succeeded, failed, total: syncIds.length });
    }

    // Single mode (original behavior)
    if (!syncId) {
      return NextResponse.json({ error: 'syncId or syncIds required' }, { status: 400 });
    }

    console.log(`SeatScouts recheck order: ${SYNC_API_BASE}/orders/${syncId}/recheck`);
    const result = await recheckOne(syncId, companyId, apiToken);

    if (!result.success) {
      console.error(`SeatScouts recheck failed for syncId ${syncId}: ${result.error}`);
      return NextResponse.json(
        { error: `SeatScouts API error ${result.error}` },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    console.error('Order recheck error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Recheck failed' },
      { status: 500 }
    );
  }
}
