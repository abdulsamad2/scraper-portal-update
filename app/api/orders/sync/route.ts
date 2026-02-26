import { NextResponse } from 'next/server';
import dbConnect from '@/lib/dbConnect';
import { Order } from '@/models/orderModel';
import { Event } from '@/models/eventModel';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SYNC_API_BASE = 'https://app.seatscouts.com/sync/api';

function escapeRegex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function findEventUrl(o: Record<string, any>): Promise<{ eventId: any; url: string } | null> {
  try {
    // Strategy 1 (deterministic): pos_event_id IS the mapping_id on Event
    if (o.pos_event_id) {
      const ev = await Event.findOne({
        mapping_id: o.pos_event_id,
      }, { _id: 1, URL: 1 }).lean() as Record<string, any> | null;
      if (ev?.URL) return { eventId: ev._id, url: ev.URL };
    }

    // Strategy 2: Exact event name + same day date (both must match)
    if (o.event_name && o.occurs_at) {
      const eventDate = new Date(o.occurs_at);
      const dayStart = new Date(eventDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(eventDate);
      dayEnd.setHours(23, 59, 59, 999);
      const ev = await Event.findOne({
        Event_Name: { $regex: `^${escapeRegex(o.event_name)}$`, $options: 'i' },
        Event_DateTime: { $gte: dayStart, $lte: dayEnd },
      }, { _id: 1, URL: 1 }).lean() as Record<string, any> | null;
      if (ev?.URL) return { eventId: ev._id, url: ev.URL };
    }

    // Strategy 3: Venue + same day date (both must match)
    if (o.venue && o.occurs_at) {
      const eventDate = new Date(o.occurs_at);
      const dayStart = new Date(eventDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(eventDate);
      dayEnd.setHours(23, 59, 59, 999);
      const ev = await Event.findOne({
        Venue: { $regex: `^${escapeRegex(o.venue)}$`, $options: 'i' },
        Event_DateTime: { $gte: dayStart, $lte: dayEnd },
      }, { _id: 1, URL: 1 }).lean() as Record<string, any> | null;
      if (ev?.URL) return { eventId: ev._id, url: ev.URL };
    }
  } catch (err) {
    console.error('URL matching error for order:', o.order_id, err);
  }

  return null;
}

export async function GET() {
  try {
    const apiToken = process.env.SYNC_API_TOKEN;
    const companyId = process.env.SYNC_COMPANY_ID;
    if (!apiToken || !companyId) {
      return NextResponse.json({ error: 'SeatScouts API credentials not configured' }, { status: 500 });
    }

    // Fetch orders from SeatScouts
    const res = await fetch(`${SYNC_API_BASE}/orders?limit=200`, {
      headers: {
        'X-Company-Id': companyId,
        'X-Api-Token': apiToken,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json({ error: `SeatScouts API error ${res.status}: ${text}` }, { status: 502 });
    }

    const data = await res.json();
    const orders = data.data || [];

    if (orders.length === 0) {
      return NextResponse.json({ synced: 0, newOrderIds: [], newOrders: [], unacknowledgedCount: 0 });
    }

    await dbConnect();

    // Get existing order_ids to detect new orders
    const incomingOrderIds = orders.map((o: any) => o.order_id);
    const existingOrders = await Order.find(
      { order_id: { $in: incomingOrderIds } },
      { order_id: 1 }
    ).lean();
    const existingSet = new Set(existingOrders.map((e: any) => e.order_id));

    // Upsert all orders
    const bulkOps = orders.map((o: any) => ({
      updateOne: {
        filter: { order_id: o.order_id },
        update: {
          $set: {
            sync_id: o.id || null,
            external_id: o.external_id || '',
            event_name: o.event_name || '',
            venue: o.venue || o.venue_name || '',
            city: o.city || '',
            state: o.state || '',
            country: o.country || '',
            occurs_at: o.occurs_at ? new Date(o.occurs_at) : null,
            section: o.section || '',
            row: o.row || '',
            low_seat: o.low_seat ?? null,
            high_seat: o.high_seat ?? null,
            quantity: o.quantity ?? 0,
            status: o.status || 'pending',
            delivery: o.delivery || '',
            marketplace: o.marketplace || '',
            total: parseFloat(o.total) || 0,
            unit_price: parseFloat(o.unit_price) || 0,
            order_date: o.order_date ? new Date(o.order_date) : null,
            transfer_count: o.transfer_count ?? 0,
            pos_event_id: o.pos_event_id || '',
            pos_inventory_id: o.pos_inventory_id || '',
            pos_invoice_id: o.pos_invoice_id || '',
            from_csv: o.from_csv ?? false,
            last_seen_internal_notes: o.last_seen_internal_notes || '',
          },
          $setOnInsert: {
            acknowledged: false,
          },
        },
        upsert: true,
      },
    }));

    await Order.bulkWrite(bulkOps);

    // Detect new order IDs
    const newOrderIds = incomingOrderIds.filter((id: string) => !existingSet.has(id));

    // Cross-reference unmatched orders with portal Events
    // Only check orders from this sync batch that still lack a URL (not the entire DB)
    const unmatchedOrders = await Order.find({
      order_id: { $in: incomingOrderIds },
      $or: [
        { ticketmasterUrl: { $in: [null, ''] } },
        { ticketmasterUrl: { $exists: false } },
      ],
    }).lean();

    if (unmatchedOrders.length > 0) {
      const crossRefOps: any[] = [];
      for (const order of unmatchedOrders) {
        const o = order as Record<string, any>;
        const match = await findEventUrl(o);
        if (match) {
          crossRefOps.push({
            updateOne: {
              filter: { _id: o._id },
              update: {
                $set: {
                  portalEventId: match.eventId,
                  ticketmasterUrl: match.url,
                },
              },
            },
          });
        }
      }
      if (crossRefOps.length > 0) {
        await Order.bulkWrite(crossRefOps);
      }
    }

    // Get new orders with their TM URLs for auto-open
    let newOrdersWithUrls: any[] = [];
    if (newOrderIds.length > 0) {
      newOrdersWithUrls = await Order.find(
        { order_id: { $in: newOrderIds } },
        { order_id: 1, ticketmasterUrl: 1, event_name: 1 }
      ).lean();
    }

    const unacknowledgedCount = await Order.countDocuments({ acknowledged: false });

    return NextResponse.json({
      synced: orders.length,
      newOrderIds,
      newOrders: JSON.parse(JSON.stringify(newOrdersWithUrls)),
      unacknowledgedCount,
    });
  } catch (error) {
    console.error('Order sync error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Sync failed' },
      { status: 500 }
    );
  }
}
