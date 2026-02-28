import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import dbConnect from '@/lib/dbConnect';
import { Order } from '@/models/orderModel';

export const dynamic = 'force-dynamic';

const SYNC_API_BASE = 'https://app.sync.automatiq.com/sync/api';

export async function POST(req: NextRequest) {
  try {
    const apiToken = process.env.SYNC_API_TOKEN;
    const companyId = process.env.SYNC_COMPANY_ID;
    if (!apiToken || !companyId) {
      return NextResponse.json({ error: 'API credentials not configured' }, { status: 500 });
    }

    const body = await req.json();
    const { orderId, syncId, action, seatNumbers } = body as {
      orderId: string;
      syncId?: number;
      action: 'confirm' | 'reject';
      seatNumbers?: string;
    };

    if (!orderId || !action) {
      return NextResponse.json({ error: 'orderId and action required' }, { status: 400 });
    }

    if (!syncId) {
      return NextResponse.json({ error: 'syncId missing — re-sync orders first' }, { status: 400 });
    }

    // Build URL — SeatScouts API uses the sync_id (internal ID), not order_id
    let url = `${SYNC_API_BASE}/orders/${syncId}/${action}`;
    if (action === 'confirm' && seatNumbers) {
      url += `?seat_numbers=${encodeURIComponent(seatNumbers)}`;
    }

    console.log(`SeatScouts ${action} order: ${url}`);
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'X-Company-Id': companyId,
        'X-Api-Token': apiToken,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`SeatScouts ${action} failed for order ${orderId}: ${res.status} - ${text}`);
      console.error(`Request URL: ${url}`);
      return NextResponse.json(
        { error: `SeatScouts API error ${res.status}: ${text}` },
        { status: 502 }
      );
    }

    const data = await res.json().catch(() => ({}));

    // Update local DB status
    await dbConnect();
    const newStatus = action === 'confirm' ? 'confirmed' : 'rejected';
    await Order.updateOne(
      { order_id: orderId },
      { $set: { status: newStatus, acknowledged: true, acknowledgedAt: new Date() } }
    );

    revalidatePath('/dashboard/orders');
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Order status update error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Update failed' },
      { status: 500 }
    );
  }
}
