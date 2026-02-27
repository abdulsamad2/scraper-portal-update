'use server';

import dbConnect from '@/lib/dbConnect';
import { Order } from '@/models/orderModel';
import { Event } from '@/models/eventModel';
import { revalidatePath } from 'next/cache';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface OrderFilters {
  status?: string;
  statusIn?: string[];       // match any of these statuses
  excludeStatus?: string[];  // exclude these statuses
  marketplace?: string;
  acknowledged?: string; // 'true' | 'false' | 'all'
  search?: string;
  orderDateFrom?: string;
  orderDateTo?: string;
  eventDateFrom?: string;
  eventDateTo?: string;
}

export async function getPaginatedOrders(
  page = 1,
  limit = 50,
  filters: OrderFilters = {},
  sortBy = 'order_date',
  sortOrder: 'asc' | 'desc' = 'desc'
) {
  await dbConnect();

  const query: Record<string, any> = {};

  if (filters.statusIn && filters.statusIn.length > 0) {
    query.status = { $in: filters.statusIn };
  } else if (filters.excludeStatus && filters.excludeStatus.length > 0) {
    query.status = { $nin: filters.excludeStatus };
  } else if (filters.status && filters.status !== 'all') {
    query.status = filters.status;
  }
  if (filters.marketplace && filters.marketplace !== 'all') {
    query.marketplace = filters.marketplace;
  }
  if (filters.acknowledged === 'true') {
    query.acknowledged = true;
  } else if (filters.acknowledged === 'false') {
    query.acknowledged = false;
  }
  if (filters.search) {
    const escaped = filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.$or = [
      { event_name: { $regex: escaped, $options: 'i' } },
      { venue: { $regex: escaped, $options: 'i' } },
      { section: { $regex: escaped, $options: 'i' } },
      { order_id: { $regex: escaped, $options: 'i' } },
    ];
  }
  if (filters.orderDateFrom || filters.orderDateTo) {
    query.order_date = {};
    if (filters.orderDateFrom) query.order_date.$gte = new Date(filters.orderDateFrom);
    if (filters.orderDateTo) query.order_date.$lte = new Date(filters.orderDateTo);
  }
  if (filters.eventDateFrom || filters.eventDateTo) {
    query.occurs_at = {};
    if (filters.eventDateFrom) query.occurs_at.$gte = new Date(filters.eventDateFrom);
    if (filters.eventDateTo) query.occurs_at.$lte = new Date(filters.eventDateTo);
  }

  const skip = (page - 1) * limit;
  const sort: Record<string, 1 | -1> = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

  const [orders, total, unacknowledgedCount] = await Promise.all([
    Order.find(query).sort(sort).skip(skip).limit(limit).lean(),
    Order.countDocuments(query),
    // Only count unacknowledged orders in invoiced/pending/problem (alert-worthy statuses)
    Order.countDocuments({ acknowledged: false, status: { $in: ['invoiced', 'pending', 'problem'] } }),
  ]);

  // Enrich orders with correct Event_DateTime from linked portal events
  const portalIds = orders.map((o: any) => o.portalEventId).filter(Boolean);
  let eventDateMap: Record<string, string> = {};
  if (portalIds.length > 0) {
    const events = await Event.find({ _id: { $in: portalIds } }, { Event_DateTime: 1 }).lean();
    for (const ev of events) {
      eventDateMap[String(ev._id)] = (ev as any).Event_DateTime;
    }
  }
  const enriched = orders.map((o: any) => {
    if (o.portalEventId && eventDateMap[String(o.portalEventId)]) {
      o.occurs_at = eventDateMap[String(o.portalEventId)];
    }
    return o;
  });

  return JSON.parse(JSON.stringify({
    orders: enriched,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    unacknowledgedCount,
  }));
}

export async function getOrderCounts() {
  await dbConnect();

  const [total, unacknowledged, byStatus] = await Promise.all([
    Order.countDocuments(),
    Order.countDocuments({ acknowledged: false }),
    Order.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const s of byStatus) {
    statusCounts[s._id] = s.count;
  }

  return JSON.parse(JSON.stringify({ total, unacknowledged, byStatus: statusCounts }));
}

export async function acknowledgeOrder(orderId: string) {
  await dbConnect();
  await Order.updateOne(
    { _id: orderId },
    { $set: { acknowledged: true, acknowledgedAt: new Date() } }
  );
  return { success: true };
}

export async function unacknowledgeOrder(orderId: string) {
  await dbConnect();
  await Order.updateOne(
    { _id: orderId },
    { $set: { acknowledged: false, acknowledgedAt: null } }
  );
  return { success: true };
}

export async function acknowledgeAllPending() {
  await dbConnect();
  const result = await Order.updateMany(
    { acknowledged: false },
    { $set: { acknowledged: true, acknowledgedAt: new Date() } }
  );
  return { success: true, modified: result.modifiedCount };
}

export async function getOrderTabCounts() {
  await dbConnect();
  const pipeline = await Order.aggregate([
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
  ]);
  const { byStatus, total, flagged } = pipeline[0];
  const sc: Record<string, number> = {};
  for (const s of byStatus) sc[s._id] = s.count;
  return {
    invoiced: (sc.invoiced || 0) + (sc.pending || 0),
    problem: sc.problem || 0,
    confirmed: (sc.confirmed || 0) + (sc.confirmed_delay || 0),
    rejected: sc.rejected || 0,
    deliveryIssue: sc.delivery_problem || 0,
    delivered: sc.delivered || 0,
    all: total[0]?.count || 0,
    flagged: flagged[0]?.count || 0,
  };
}

export async function getMonthlyStats() {
  const apiToken = process.env.SYNC_API_TOKEN;
  const companyId = process.env.SYNC_COMPANY_ID;
  if (!apiToken || !companyId) {
    return { totalOrders: 0, totalTickets: 0, delivered: 0, rejected: 0, deliveryIssue: 0, pending: 0, fulfillRate: 0 };
  }

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const monthStart = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const monthEnd = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const API_BASE = 'https://app.seatscouts.com/sync/api';
  const headers = { 'X-Company-Id': companyId, 'X-Api-Token': apiToken };
  const dateQ = `order_date_from=${monthStart}&order_date_to=${monthEnd}`;

  // API returns { count, data, page } — use count for totals, limit=1 since we only need counts
  const statusQueries = [
    { key: 'all',           q: '' },
    { key: 'pending',       q: '&status=pending,problem' },
    { key: 'confirmed',     q: '&status=confirmed,confirmed_delay' },
    { key: 'delivered',     q: '&status=delivered' },
    { key: 'rejected',      q: '&status=rejected' },
    { key: 'deliveryIssue', q: '&status=delivery_problem' },
  ];

  try {
    const results = await Promise.all(
      statusQueries.map(async (sq) => {
        const res = await fetch(`${API_BASE}/orders?${dateQ}${sq.q}&limit=1`, {
          headers, cache: 'no-store', signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return { key: sq.key, count: 0 };
        const data = await res.json();
        return { key: sq.key, count: data.count || 0 };
      })
    );

    const c: Record<string, number> = {};
    for (const r of results) c[r.key] = r.count;

    const totalOrders = c.all || 0;
    const delivered = c.delivered || 0;
    // delivery_problem orders will be delivered later — count them towards fulfillment
    const fulfilled = delivered + (c.confirmed || 0) + (c.deliveryIssue || 0);

    return {
      totalOrders,
      totalTickets: 0,
      delivered,
      rejected: c.rejected || 0,
      deliveryIssue: c.deliveryIssue || 0,
      pending: c.pending || 0,
      fulfillRate: totalOrders > 0 ? Math.round((fulfilled / totalOrders) * 100) : 0,
    };
  } catch (error) {
    console.error('Monthly stats fetch error:', error);
    return { totalOrders: 0, totalTickets: 0, delivered: 0, rejected: 0, deliveryIssue: 0, pending: 0, fulfillRate: 0 };
  }
}

export async function getUnacknowledgedCount() {
  await dbConnect();
  const count = await Order.countDocuments({ acknowledged: false });
  return count;
}

export async function flagOrderIssue(orderId: string, note: string) {
  await dbConnect();
  const result = await Order.updateOne(
    { _id: orderId },
    { $set: { hasIssue: true, issueNote: note, issueFlaggedAt: new Date() } }
  );
  revalidatePath('/dashboard/orders');
  return { success: true, matched: result.matchedCount, modified: result.modifiedCount };
}

export async function unflagOrderIssue(orderId: string) {
  await dbConnect();
  const result = await Order.updateOne(
    { _id: orderId },
    { $set: { hasIssue: false, issueNote: '', issueFlaggedAt: null } }
  );
  revalidatePath('/dashboard/orders');
  return { success: true, matched: result.matchedCount, modified: result.modifiedCount };
}
