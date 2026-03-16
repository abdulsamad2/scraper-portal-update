import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/dbConnect';
import { Order } from '@/models/orderModel';
import { requireAuth } from '@/lib/auth';

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
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const syncId = req.nextUrl.searchParams.get('syncId');
    if (!syncId || !/^\d+$/.test(syncId)) {
      return NextResponse.json({ error: 'Valid numeric syncId required' }, { status: 400 });
    }

    await dbConnect();

    // Single DB query upfront — fetch all detail fields so we can skip external API when possible
    const existingOrder = await Order.findOne(
      { sync_id: Number(syncId) },
      {
        order_id: 1, low_seat: 1, high_seat: 1,
        customer_name: 1, customer_email: 1, customer_phone: 1,
        transfer_to_email: 1, public_notes: 1, reason: 1,
        in_hand_date: 1, inventory_tags: 1, last_seen_internal_notes: 1,
      }
    ).lean() as any;

    const hasSeatsInDb = existingOrder?.low_seat != null && existingOrder?.high_seat != null;
    // If we already have customer detail data in DB, serve directly — no external API needed
    const hasDetailInDb = existingOrder && (existingOrder.customer_name || existingOrder.customer_email);

    const apiToken = process.env.SYNC_API_TOKEN;
    const companyId = process.env.SYNC_COMPANY_ID;

    // Fast path: if DB already has detail + seats, serve immediately
    if (hasDetailInDb && hasSeatsInDb) {
      const detail = buildDetail(existingOrder, 'db');
      return NextResponse.json({ success: true, detail, source: 'db' });
    }

    // Slow path: fetch from external API for missing data
    if (apiToken && companyId) {
      try {
        // Build parallel requests — only fetch what's missing
        const promises: [Promise<Response | null>, Promise<{ low_seat: number; high_seat: number } | null>] = [
          // Skip order API if we already have detail data
          hasDetailInDb
            ? Promise.resolve(null)
            : fetch(`${SYNC_API_BASE}/orders/${syncId}`, {
                headers: {
                  'X-Company-Id': companyId,
                  'X-Api-Token': apiToken,
                  'Accept': 'application/json',
                },
                cache: 'no-store',
                signal: AbortSignal.timeout(15000),
              }),
          // Skip seat API if we already have seats
          hasSeatsInDb
            ? Promise.resolve({ low_seat: existingOrder.low_seat, high_seat: existingOrder.high_seat })
            : fetchSeatRange(syncId, companyId, apiToken),
        ];

        const [orderRes, seatRange] = await Promise.all(promises);

        // Build detail from API response or DB fallback
        let detail;
        let orderId: string | null = null;

        if (orderRes && orderRes.ok) {
          const order = await orderRes.json();
          if (order && order.order_id) {
            detail = buildDetail(order, 'api');
            orderId = order.order_id;
          }
        }

        // Fall back to DB if API didn't return usable data
        if (!detail && existingOrder) {
          detail = buildDetail(existingOrder, 'db');
          orderId = existingOrder.order_id;
        }

        if (detail) {
          // Override seat data from transfers endpoint (more reliable)
          if (seatRange) {
            detail.low_seat = seatRange.low_seat;
            detail.high_seat = seatRange.high_seat;
          }

          // Persist any newly fetched data back to DB
          if (orderId) {
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
              Order.updateOne({ order_id: orderId }, { $set: updateFields }).catch(() => {});
            }
          }

          return NextResponse.json({ success: true, detail });
        }
      } catch {
        // API timeout or network error — fall through to DB
      }
    }

    // Fallback: serve from existing DB data (already fetched above)
    if (existingOrder) {
      const detail = buildDetail(existingOrder, 'db');
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
