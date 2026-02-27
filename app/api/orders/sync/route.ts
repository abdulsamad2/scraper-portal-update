import { NextResponse } from 'next/server';
import dbConnect from '@/lib/dbConnect';
import { Order } from '@/models/orderModel';
import { Event } from '@/models/eventModel';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SYNC_API_BASE = 'https://app.sync.automatiq.com/sync/api';
const CONFIRMED_STATUSES = new Set(['confirmed', 'confirmed_delay', 'delivery_problem']);

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
  const t0 = Date.now();
  try {
    const apiToken = process.env.SYNC_API_TOKEN;
    const companyId = process.env.SYNC_COMPANY_ID;
    if (!apiToken || !companyId) {
      return NextResponse.json({ error: 'SeatScouts API credentials not configured' }, { status: 500 });
    }

    // Fetch ALL orders from SeatScouts by paginating through the API
    const PAGE_SIZE = 100;
    const MAX_PAGES = 20; // safety limit
    const headers = {
      'X-Company-Id': companyId,
      'X-Api-Token': apiToken,
    };

    let orders: any[] = [];
    let currentPage = 1;
    let totalCount = 0;

    while (currentPage <= MAX_PAGES) {
      const res = await fetch(
        `${SYNC_API_BASE}/orders?limit=${PAGE_SIZE}&page=${currentPage}`,
        { headers, cache: 'no-store', signal: AbortSignal.timeout(20000) }
      );

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        // If first page fails, return error. If later page fails, use what we have.
        if (currentPage === 1) {
          return NextResponse.json({ error: `SeatScouts API error ${res.status}: ${text}` }, { status: 502 });
        }
        console.warn(`[sync] Page ${currentPage} failed (${res.status}), using ${orders.length} orders fetched so far`);
        break;
      }

      const data = await res.json();
      const pageOrders = data.data || [];
      totalCount = data.count || totalCount;

      orders = orders.concat(pageOrders);

      // Stop if we got fewer than PAGE_SIZE (last page) or fetched all
      if (pageOrders.length < PAGE_SIZE || orders.length >= totalCount) {
        break;
      }
      currentPage++;
    }
    console.log(`[sync] SeatScouts API: ${Date.now() - t0}ms, ${orders.length} orders across ${currentPage} page(s) (total: ${totalCount})`);

    if (orders.length === 0) {
      return NextResponse.json({ synced: 0, newOrderIds: [], newOrders: [], unacknowledgedCount: 0 });
    }

    await dbConnect();

    // Get existing order_ids to detect new orders
    const incomingOrderIds = orders.map((o: any) => o.order_id);
    const existingOrders = await Order.find(
      { order_id: { $in: incomingOrderIds } },
      { order_id: 1, status: 1, confirmedAt: 1 }
    ).lean();
    const existingMap = new Map<string, { status: string; confirmedAt?: Date }>();
    for (const e of existingOrders) {
      const doc = e as any;
      existingMap.set(doc.order_id, { status: doc.status, confirmedAt: doc.confirmedAt });
    }
    const existingSet = new Set(existingOrders.map((e: any) => e.order_id));

    // Upsert all orders
    const bulkOps = orders.map((o: any) => {
      const incomingStatus = o.status || 'pending';
      const existing = existingMap.get(o.order_id);

      // Set confirmedAt only once: when status first transitions to a confirmed state
      const shouldSetConfirmedAt =
        CONFIRMED_STATUSES.has(incomingStatus) &&
        (!existing || (!existing.confirmedAt && !CONFIRMED_STATUSES.has(existing.status)));

      const $set: Record<string, any> = {
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
        status: incomingStatus,
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
        public_notes: o.public_notes || '',
        reason: o.reason || '',
        in_hand_date: o.in_hand_date ? new Date(o.in_hand_date) : null,
        inventory_tags: o.inventory_tags || '',
        customer_name: o.customer_name || '',
        customer_email: o.customer_email || '',
        customer_phone: o.customer_phone || '',
        transfer_to_email: o.transfer_to_email || '',
      };

      if (shouldSetConfirmedAt) {
        $set.confirmedAt = new Date();
      }

      return {
        updateOne: {
          filter: { order_id: o.order_id },
          update: {
            $set,
            $setOnInsert: {
              acknowledged: false,
            },
          },
          upsert: true,
        },
      };
    });

    await Order.bulkWrite(bulkOps);
    console.log(`[sync] bulkWrite: ${Date.now() - t0}ms`);

    // Detect new order IDs
    const newOrderIds = incomingOrderIds.filter((id: string) => !existingSet.has(id));

    // Cross-reference only NEW orders that lack a URL (skip already-matched ones)
    const unmatchedQuery: Record<string, any> = {
      order_id: { $in: newOrderIds.length > 0 ? newOrderIds : incomingOrderIds },
      $or: [
        { ticketmasterUrl: { $in: [null, ''] } },
        { ticketmasterUrl: { $exists: false } },
      ],
    };
    // For existing orders, only re-check a small batch to avoid slowness
    if (newOrderIds.length === 0) {
      unmatchedQuery.order_id = { $in: incomingOrderIds };
    }
    const unmatchedOrders = await Order.find(unmatchedQuery).limit(20).lean();

    if (unmatchedOrders.length > 0) {
      const crossRefOps: any[] = [];
      // Run URL lookups in parallel for speed
      const matches = await Promise.all(
        unmatchedOrders.map(async (order) => {
          const o = order as Record<string, any>;
          const match = await findEventUrl(o);
          return match ? { _id: o._id, ...match } : null;
        })
      );
      for (const m of matches) {
        if (m) {
          crossRefOps.push({
            updateOne: {
              filter: { _id: m._id },
              update: { $set: { portalEventId: m.eventId, ticketmasterUrl: m.url } },
            },
          });
        }
      }
      if (crossRefOps.length > 0) {
        await Order.bulkWrite(crossRefOps);
      }
    }
    console.log(`[sync] cross-ref (${unmatchedOrders.length} checked): ${Date.now() - t0}ms`);

    // Get new orders with their TM URLs for auto-open
    let newOrdersWithUrls: any[] = [];
    if (newOrderIds.length > 0) {
      newOrdersWithUrls = await Order.find(
        { order_id: { $in: newOrderIds } },
        { order_id: 1, ticketmasterUrl: 1, event_name: 1, section: 1, row: 1, low_seat: 1, high_seat: 1, quantity: 1, total: 1, unit_price: 1 }
      ).lean();
    }

    // Get unack count + tab counts in a single aggregation to reduce DB calls
    const [unacknowledgedCount, tabPipeline] = await Promise.all([
      Order.countDocuments({ acknowledged: false, status: { $in: ['invoiced', 'pending', 'problem'] } }),
      Order.aggregate([
        {
          $facet: {
            byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
            total: [{ $count: 'count' }],
            flagged: [
              { $match: { hasIssue: true, status: { $in: ['invoiced', 'pending', 'problem'] } } },
              { $count: 'count' },
            ],
          },
        },
      ]),
    ]);
    const { byStatus, total: totalArr, flagged } = tabPipeline[0];
    const sc: Record<string, number> = {};
    for (const s of byStatus) sc[s._id] = s.count;
    const tabCounts = {
      invoiced: (sc.invoiced || 0) + (sc.pending || 0),
      problem: sc.problem || 0,
      confirmed: (sc.confirmed || 0) + (sc.confirmed_delay || 0),
      rejected: sc.rejected || 0,
      deliveryIssue: sc.delivery_problem || 0,
      delivered: sc.delivered || 0,
      all: totalArr[0]?.count || 0,
      flagged: flagged[0]?.count || 0,
    };

    console.log(`[sync] done: ${Date.now() - t0}ms total, ${orders.length} synced, ${newOrderIds.length} new`);

    return NextResponse.json({
      synced: orders.length,
      newOrderIds,
      newOrders: JSON.parse(JSON.stringify(newOrdersWithUrls)),
      unacknowledgedCount,
      tabCounts,
    });
  } catch (error) {
    console.error('Order sync error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Sync failed' },
      { status: 500 }
    );
  }
}
