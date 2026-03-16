import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import dbConnect from '@/lib/dbConnect';
import { Order } from '@/models/orderModel';
import { Event } from '@/models/eventModel';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SYNC_API_BASE = 'https://app.sync.automatiq.com/sync/api';
const CONFIRMED_STATUSES = new Set(['confirmed', 'confirmed_delay', 'delivery_problem']);

// Concurrency lock — prevent overlapping syncs from flooding the external API
let _syncInProgress = false;

function escapeRegex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Fetch seat range from the /transfers endpoint for a single order.
 * @param retries - number of retry attempts (with exponential backoff)
 */
async function fetchSeatRange(
  syncId: number,
  companyId: string,
  apiToken: string,
  retries = 0
): Promise<{ low_seat: number; high_seat: number } | null> {
  const MAX_RETRIES = retries;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        // Exponential backoff: 1s, 2s, 4s
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
      }
      const res = await fetch(`${SYNC_API_BASE}/transfers?order_id=${syncId}`, {
        headers: { 'X-Company-Id': companyId, 'X-Api-Token': apiToken, 'Accept': 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        if (attempt < MAX_RETRIES) continue;
        return null;
      }
      const data = await res.json();
      const transfers = data.transfers || data.data || data || [];
      const transferArr = Array.isArray(transfers) ? transfers : [transfers];
      const seats: number[] = [];
      for (const transfer of transferArr) {
        for (const ticket of (transfer.tickets || [])) {
          if (ticket.seat != null && typeof ticket.seat === 'number') seats.push(ticket.seat);
        }
      }
      if (seats.length === 0) {
        // No seat data yet — retry if attempts remain (transfer may not be ready)
        if (attempt < MAX_RETRIES) continue;
        return null;
      }
      return { low_seat: Math.min(...seats), high_seat: Math.max(...seats) };
    } catch {
      if (attempt < MAX_RETRIES) continue;
      return null;
    }
  }
  return null;
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

export async function GET(request: NextRequest) {
  const t0 = Date.now();

  // Prevent overlapping syncs from flooding the external API
  if (_syncInProgress) {
    return NextResponse.json({ synced: 0, newOrderIds: [], newOrders: [], skipped: 'sync already in progress' });
  }
  _syncInProgress = true;

  try {
    const apiToken = process.env.SYNC_API_TOKEN;
    const companyId = process.env.SYNC_COMPANY_ID;
    if (!apiToken || !companyId) {
      return NextResponse.json({ error: 'SeatScouts API credentials not configured' }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') || 'fast';

    const headers = {
      'X-Company-Id': companyId,
      'X-Api-Token': apiToken,
    };

    // Resync mode: page through ALL orders from the API
    if (mode === 'resync') {
      await dbConnect();
      let page = 1;
      const perPage = 200;
      let totalSynced = 0;
      let totalPages = 1;

      while (page <= totalPages) {
        const apiUrl = `${SYNC_API_BASE}/orders?limit=${perPage}&page=${page}`;
        const res = await fetch(apiUrl, {
          headers, cache: 'no-store', signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          return NextResponse.json({ error: `API error ${res.status} on page ${page}: ${text}` }, { status: 502 });
        }
        const data = await res.json();
        const orders: any[] = data.data || [];
        if (orders.length === 0) break;

        // Calculate total pages from count
        if (page === 1 && data.count) {
          totalPages = Math.ceil(data.count / perPage);
          console.log(`[resync] Total orders: ${data.count}, pages: ${totalPages}`);
        }

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
                // Only update seat data if API provides non-null values
                ...(o.low_seat != null ? { low_seat: o.low_seat } : {}),
                ...(o.high_seat != null ? { high_seat: o.high_seat } : {}),
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
                public_notes: o.public_notes || '',
                reason: o.error_reason || o.reason || '',
                in_hand_date: o.in_hand_date ? new Date(o.in_hand_date) : null,
                inventory_tags: o.inventory_tags || '',
                customer_name: o.customer_name || '',
                customer_email: o.customer_email || '',
                customer_phone: o.customer_phone || '',
                transfer_to_email: o.transfer_to_email || '',
              },
              $setOnInsert: { acknowledged: false },
            },
            upsert: true,
          },
        }));

        await Order.bulkWrite(bulkOps);
        totalSynced += orders.length;
        console.log(`[resync] Page ${page}/${totalPages}: ${orders.length} orders synced (total: ${totalSynced})`);
        page++;

        // Small delay between pages to respect rate limits
        if (page <= totalPages) {
          await new Promise(r => setTimeout(r, 300));
        }
      }

      // Backfill seat data for orders missing seats (batch of 50)
      const RESYNC_SEAT_LIMIT = 50;
      const missingSeats = await Order.find(
        { sync_id: { $ne: null }, $or: [{ low_seat: null }, { low_seat: { $exists: false } }] },
        { sync_id: 1, order_id: 1 }
      ).sort({ order_date: -1 }).limit(RESYNC_SEAT_LIMIT).lean();

      if (missingSeats.length > 0) {
        let seatUpdated = 0;
        // Process in small parallel batches to respect rate limits
        const BATCH = 5;
        for (let i = 0; i < missingSeats.length; i += BATCH) {
          const batch = missingSeats.slice(i, i + BATCH);
          const results = await Promise.all(
            batch.map(async (o: any) => {
              const range = await fetchSeatRange(o.sync_id, companyId, apiToken);
              if (range) {
                await Order.updateOne({ _id: o._id }, { $set: { low_seat: range.low_seat, high_seat: range.high_seat } });
                return 1;
              }
              return 0;
            })
          );
          seatUpdated += (results as number[]).reduce((a, b) => a + b, 0);
          if (i + BATCH < missingSeats.length) await new Promise(r => setTimeout(r, 200));
        }
        console.log(`[resync] seat backfill: ${seatUpdated}/${missingSeats.length} orders updated`);
      }

      revalidatePath('/dashboard/orders');
      console.log(`[resync] Complete: ${totalSynced} orders in ${Date.now() - t0}ms`);
      return NextResponse.json({ success: true, synced: totalSynced, pages: totalPages, elapsed: Date.now() - t0 });
    }

    // Fast mode (default/pending tab): smaller limit for speed, no status filter so status changes are detected
    // Full mode (other tabs/filters): larger limit to cover all orders
    const isFast = mode === 'fast';
    const limit = isFast ? 50 : 200;
    const apiUrl = `${SYNC_API_BASE}/orders?limit=${limit}`;

    const res = await fetch(apiUrl, {
      headers, cache: 'no-store', signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json({ error: `API error ${res.status}: ${text}` }, { status: 502 });
    }

    const data = await res.json();
    const dedupedOrders: any[] = data.data || [];
    console.log(`[sync] API (${mode}): ${Date.now() - t0}ms, ${dedupedOrders.length} orders`);

    await dbConnect();

    if (dedupedOrders.length === 0) {
      // Still check DB for unacknowledged orders (may exist from previous syncs)
      const [unacknowledgedCount, unacknowledgedProblemCount] = await Promise.all([
        Order.countDocuments({ acknowledged: false, status: { $in: ['invoiced', 'pending'] } }),
        Order.countDocuments({ acknowledged: false, status: 'problem' }),
      ]);
      return NextResponse.json({ synced: 0, newOrderIds: [], newOrders: [], unacknowledgedCount, unacknowledgedProblemCount });
    }

    // Get existing order_ids to detect new orders
    const incomingOrderIds = dedupedOrders.map((o: any) => o.order_id);
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
    const bulkOps = dedupedOrders.map((o: any) => {
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
        // Only update seat data if API provides non-null values;
        // otherwise we'd overwrite seats fetched from /transfers
        ...(o.low_seat != null ? { low_seat: o.low_seat } : {}),
        ...(o.high_seat != null ? { high_seat: o.high_seat } : {}),
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
        reason: o.error_reason || o.reason || '',
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

      // Auto-acknowledge: if an order's status moved out of invoiced/pending/problem
      // (i.e. someone handled it via the remote API), mark it acknowledged so the bell stops
      const NEEDS_ACTION_STATUSES = new Set(['invoiced', 'pending', 'problem']);
      const isHandled = !NEEDS_ACTION_STATUSES.has(incomingStatus);

      if (isHandled) {
        // Order was handled remotely — auto-acknowledge
        $set.acknowledged = true;
        if (!existing) {
          // New order arriving already handled — also set acknowledgedAt
          $set.acknowledgedAt = new Date();
        }
      }

      return {
        updateOne: {
          filter: { order_id: o.order_id },
          update: {
            $set,
            ...(!isHandled ? { $setOnInsert: { acknowledged: false } } : {}),
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

    // Fetch seat data from /transfers for NEW orders + backfill existing orders
    // Uses batched approach (3 concurrent) to avoid flooding external API
    {
      const SEAT_BATCH_SIZE = 3; // Max concurrent API calls for seats

      // New orders: retry up to 2 times with backoff
      const newOrdersForSeats = newOrderIds.length > 0
        ? await Order.find(
            { order_id: { $in: newOrderIds }, sync_id: { $ne: null } },
            { sync_id: 1, order_id: 1 }
          ).lean()
        : [];

      if (newOrdersForSeats.length > 0) {
        let seatUpdated = 0;
        for (let i = 0; i < newOrdersForSeats.length; i += SEAT_BATCH_SIZE) {
          const batch = newOrdersForSeats.slice(i, i + SEAT_BATCH_SIZE);
          const results = await Promise.all(
            batch.map(async (o: any) => {
              const range = await fetchSeatRange(o.sync_id, companyId, apiToken, 2);
              if (range) {
                await Order.updateOne({ _id: o._id }, { $set: { low_seat: range.low_seat, high_seat: range.high_seat } });
                return 1;
              }
              return 0;
            })
          );
          seatUpdated += (results as number[]).reduce((a, b) => a + b, 0);
          // Throttle between batches
          if (i + SEAT_BATCH_SIZE < newOrdersForSeats.length) {
            await new Promise(r => setTimeout(r, 300));
          }
        }
        console.log(`[sync] new order seats: ${seatUpdated}/${newOrdersForSeats.length} fetched`);
      }

      // Existing orders missing seat data: backfill a small batch each sync cycle (no retries)
      const SEAT_BACKFILL_LIMIT = 5;
      const missingSeatsOrders = await Order.find(
        {
          sync_id: { $ne: null },
          $or: [{ low_seat: null }, { low_seat: { $exists: false } }],
          ...(newOrderIds.length > 0 ? { order_id: { $nin: newOrderIds } } : {}),
        },
        { sync_id: 1, order_id: 1 }
      ).sort({ order_date: -1 }).limit(SEAT_BACKFILL_LIMIT).lean();

      if (missingSeatsOrders.length > 0) {
        let backfilled = 0;
        for (let i = 0; i < missingSeatsOrders.length; i += SEAT_BATCH_SIZE) {
          const batch = missingSeatsOrders.slice(i, i + SEAT_BATCH_SIZE);
          const results = await Promise.all(
            batch.map(async (o: any) => {
              const range = await fetchSeatRange(o.sync_id, companyId, apiToken);
              if (range) {
                await Order.updateOne({ _id: o._id }, { $set: { low_seat: range.low_seat, high_seat: range.high_seat } });
                return 1;
              }
              return 0;
            })
          );
          backfilled += (results as number[]).reduce((a, b) => a + b, 0);
          if (i + SEAT_BATCH_SIZE < missingSeatsOrders.length) {
            await new Promise(r => setTimeout(r, 200));
          }
        }
        if (backfilled > 0) console.log(`[sync] seat backfill: ${backfilled}/${missingSeatsOrders.length} orders updated`);
      }
    }

    // Get new orders with their TM URLs for auto-open
    let newOrdersWithUrls: any[] = [];
    if (newOrderIds.length > 0) {
      newOrdersWithUrls = await Order.find(
        { order_id: { $in: newOrderIds } },
        { order_id: 1, ticketmasterUrl: 1, event_name: 1, section: 1, row: 1, low_seat: 1, high_seat: 1, quantity: 1, total: 1, unit_price: 1 }
      ).lean();
    }

    // Get unack counts (split invoiced vs problem) + tab counts
    const [unacknowledgedCount, unacknowledgedProblemCount, tabPipeline] = await Promise.all([
      Order.countDocuments({ acknowledged: false, status: { $in: ['invoiced', 'pending'] } }),
      Order.countDocuments({ acknowledged: false, status: 'problem' }),
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

    console.log(`[sync] done: ${Date.now() - t0}ms total, ${dedupedOrders.length} synced, ${newOrderIds.length} new`);

    // Invalidate cached page data so router.refresh() gets fresh results
    revalidatePath('/dashboard/orders');

    return NextResponse.json({
      synced: dedupedOrders.length,
      newOrderIds,
      newOrders: JSON.parse(JSON.stringify(newOrdersWithUrls)),
      unacknowledgedCount,
      unacknowledgedProblemCount,
      tabCounts,
    });
  } catch (error) {
    console.error('Order sync error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Sync failed' },
      { status: 500 }
    );
  } finally {
    _syncInProgress = false;
  }
}
