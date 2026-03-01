import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/dbConnect';
import { Order } from '@/models/orderModel';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = 'force-dynamic';

const SYNC_API_BASE = 'https://app.sync.automatiq.com/sync/api';

/**
 * Fetch seat range from the /transfers endpoint.
 * Each transfer has a tickets[] array with individual seat numbers.
 */
async function fetchSeatRange(
  syncId: string,
  companyId: string,
  apiToken: string
): Promise<{ low_seat: number; high_seat: number } | null> {
  try {
    const res = await fetch(`${SYNC_API_BASE}/transfers?order_id=${syncId}`, {
      headers: {
        'X-Company-Id': companyId,
        'X-Api-Token': apiToken,
        'Accept': 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const transfers = data.transfers || data.data || data || [];
    const transferArr = Array.isArray(transfers) ? transfers : [transfers];

    // Collect all seat numbers from all transfers' tickets
    const seats: number[] = [];
    for (const transfer of transferArr) {
      const tickets = transfer.tickets || [];
      for (const ticket of tickets) {
        if (ticket.seat != null && typeof ticket.seat === 'number') {
          seats.push(ticket.seat);
        }
      }
    }

    if (seats.length === 0) return null;

    return {
      low_seat: Math.min(...seats),
      high_seat: Math.max(...seats),
    };
  } catch {
    return null;
  }
}

function buildDetail(order: any, source: 'api' | 'db') {
  if (source === 'api') {
    const customer = order.customer || {};
    return {
      customer_name: [customer.first_name, customer.last_name].filter(Boolean).join(' '),
      customer_email: customer.email || '',
      customer_phone: customer.phone || '',
      transfer_to_email: order.transfer_to_email || '',
      public_notes: order.public_notes || '',
      reason: order.error_reason || order.reason || '',
      in_hand_date: order.in_hand || order.in_hand_date || null,
      inventory_tags: Array.isArray(order.last_seen_inventory_tags)
        ? order.last_seen_inventory_tags.join(', ')
        : (order.inventory_tags || ''),
      last_seen_internal_notes: order.last_seen_internal_notes || '',
      low_seat: order.low_seat ?? null,
      high_seat: order.high_seat ?? null,
    };
  }
  // From DB document
  return {
    customer_name: order.customer_name || '',
    customer_email: order.customer_email || '',
    customer_phone: order.customer_phone || '',
    transfer_to_email: order.transfer_to_email || '',
    public_notes: order.public_notes || '',
    reason: order.reason || '',
    in_hand_date: order.in_hand_date || null,
    inventory_tags: order.inventory_tags || '',
    last_seen_internal_notes: order.last_seen_internal_notes || '',
    low_seat: order.low_seat ?? null,
    high_seat: order.high_seat ?? null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const syncId = req.nextUrl.searchParams.get('syncId');
    if (!syncId) {
      return NextResponse.json({ error: 'syncId required' }, { status: 400 });
    }

    await dbConnect();

    const apiToken = process.env.SYNC_API_TOKEN;
    const companyId = process.env.SYNC_COMPANY_ID;

    // Try fetching from SeatScouts API first
    if (apiToken && companyId) {
      try {
        // Fetch order detail and transfer seat data in parallel
        const [orderRes, seatRange] = await Promise.all([
          fetch(`${SYNC_API_BASE}/orders/${syncId}`, {
            headers: {
              'X-Company-Id': companyId,
              'X-Api-Token': apiToken,
              'Accept': 'application/json',
            },
            cache: 'no-store',
            signal: AbortSignal.timeout(15000),
          }),
          fetchSeatRange(syncId, companyId, apiToken),
        ]);

        if (orderRes.ok) {
          const order = await orderRes.json();
          if (order && order.order_id) {
            const detail = buildDetail(order, 'api');

            // Override seat data from transfers endpoint (more reliable)
            if (seatRange) {
              detail.low_seat = seatRange.low_seat;
              detail.high_seat = seatRange.high_seat;
            }

            // Update local DB with fetched fields
            const updateFields: Record<string, unknown> = {};
            if (detail.customer_name) updateFields.customer_name = detail.customer_name;
            if (detail.customer_email) updateFields.customer_email = detail.customer_email;
            if (detail.customer_phone) updateFields.customer_phone = detail.customer_phone;
            if (detail.transfer_to_email) updateFields.transfer_to_email = detail.transfer_to_email;
            if (detail.public_notes) updateFields.public_notes = detail.public_notes;
            if (detail.reason) updateFields.reason = detail.reason;
            if (detail.in_hand_date) updateFields.in_hand_date = new Date(detail.in_hand_date);
            if (detail.inventory_tags) updateFields.inventory_tags = detail.inventory_tags;
            if (detail.last_seen_internal_notes) updateFields.last_seen_internal_notes = detail.last_seen_internal_notes;
            if (detail.low_seat != null) updateFields.low_seat = detail.low_seat;
            if (detail.high_seat != null) updateFields.high_seat = detail.high_seat;

            if (Object.keys(updateFields).length > 0) {
              await Order.updateOne({ order_id: order.order_id }, { $set: updateFields });
            }

            return NextResponse.json({ success: true, detail });
          }
        }

        // Order API failed (404 etc.) — still try to use seat data from transfers + DB fallback
        const dbOrder = await Order.findOne({ sync_id: Number(syncId) }).lean() as any;
        if (dbOrder) {
          const detail = buildDetail(dbOrder, 'db');
          if (seatRange) {
            detail.low_seat = seatRange.low_seat;
            detail.high_seat = seatRange.high_seat;
            // Save seat data to DB
            await Order.updateOne(
              { sync_id: Number(syncId) },
              { $set: { low_seat: seatRange.low_seat, high_seat: seatRange.high_seat } }
            );
          }
          return NextResponse.json({ success: true, detail, source: 'db' });
        }
      } catch {
        // API timeout or network error — fall through to DB
      }
    }

    // Fallback: serve from local DB only
    const dbOrder = await Order.findOne({ sync_id: Number(syncId) }).lean() as any;
    if (dbOrder) {
      const detail = buildDetail(dbOrder, 'db');
      return NextResponse.json({ success: true, detail, source: 'db' });
    }

    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  } catch (error) {
    console.error('Order detail error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Detail fetch failed' },
      { status: 500 }
    );
  }
}
