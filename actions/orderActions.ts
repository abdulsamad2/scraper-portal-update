'use server';

import { unstable_noStore as noStore } from 'next/cache';
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
  noStore();
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
  noStore();
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

// Max processing time to consider (60 min). Orders taking longer are outliers.
const MAX_PROCESSING_MS = 60 * 60 * 1000;

export async function getProcessingTimeStats(
  year: number,
  month: number,
  view: 'daily' | 'weekly' | 'monthly'
): Promise<{
  data: Array<{ label: string; avgMinutes: number; medianMinutes: number; count: number; minMinutes: number; maxMinutes: number }>;
  orders?: Array<{ order_id: string; event_name: string; minutes: number; day: number; section: string; row: string; quantity: number }>;
  overallAvgMinutes: number;
  totalOrders: number;
  excludedCount: number;
}> {
  await dbConnect();

  // Common match: only invoiced->confirmed orders with processing time < 60 min
  const commonMatch = {
    confirmedAt: { $exists: true, $ne: null },
    createdAt: { $exists: true, $ne: null },
    status: { $nin: ['rejected', 'invoiced', 'pending'] },
  };

  const commonAddFields = {
    processingMs: { $subtract: ['$confirmedAt', '$createdAt'] },
  };

  // Filter out negative values and > 60 min
  const timeFilter = {
    processingMs: { $gt: 0, $lte: MAX_PROCESSING_MS },
  };

  if (view === 'daily') {
    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

    const [results, individualOrders, excludedCount] = await Promise.all([
      Order.aggregate([
        { $match: { ...commonMatch, order_date: { $gte: startOfMonth, $lte: endOfMonth } } },
        { $addFields: commonAddFields },
        { $match: timeFilter },
        {
          $group: {
            _id: { $dayOfMonth: '$order_date' },
            avgMs: { $avg: '$processingMs' },
            minMs: { $min: '$processingMs' },
            maxMs: { $max: '$processingMs' },
            allMs: { $push: '$processingMs' },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      // Individual orders for scatter plot
      Order.aggregate([
        { $match: { ...commonMatch, order_date: { $gte: startOfMonth, $lte: endOfMonth } } },
        { $addFields: commonAddFields },
        { $match: timeFilter },
        { $sort: { order_date: 1 } },
        { $limit: 500 },
        {
          $project: {
            order_id: 1,
            event_name: 1,
            section: 1,
            row: 1,
            quantity: 1,
            processingMs: 1,
            day: { $dayOfMonth: '$order_date' },
          },
        },
      ]),
      // Count excluded (took > 60 min)
      Order.countDocuments({
        ...commonMatch,
        order_date: { $gte: startOfMonth, $lte: endOfMonth },
        $expr: { $gt: [{ $subtract: ['$confirmedAt', '$createdAt'] }, MAX_PROCESSING_MS] },
      }),
    ]);

    const daysInMonth = new Date(year, month, 0).getDate();
    const dayMap = new Map(results.map((r: any) => [r._id, r]));
    const data = [];
    let totalMs = 0;
    let totalCount = 0;

    for (let d = 1; d <= daysInMonth; d++) {
      const entry = dayMap.get(d) as any;
      if (entry) {
        const sorted = (entry.allMs as number[]).sort((a: number, b: number) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const medianMs = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        data.push({
          label: String(d),
          avgMinutes: Math.round(entry.avgMs / (1000 * 60) * 10) / 10,
          medianMinutes: Math.round(medianMs / (1000 * 60) * 10) / 10,
          minMinutes: Math.round(entry.minMs / (1000 * 60) * 10) / 10,
          maxMinutes: Math.round(entry.maxMs / (1000 * 60) * 10) / 10,
          count: entry.count,
        });
        totalMs += entry.avgMs * entry.count;
        totalCount += entry.count;
      } else {
        data.push({ label: String(d), avgMinutes: 0, medianMinutes: 0, minMinutes: 0, maxMinutes: 0, count: 0 });
      }
    }

    // Map individual orders
    const orders = individualOrders.map((o: any) => ({
      order_id: o.order_id,
      event_name: o.event_name || '',
      minutes: Math.round(o.processingMs / (1000 * 60) * 10) / 10,
      day: o.day,
      section: o.section || '',
      row: o.row || '',
      quantity: o.quantity || 0,
    }));

    return JSON.parse(JSON.stringify({
      data,
      orders,
      overallAvgMinutes: totalCount > 0 ? Math.round(totalMs / totalCount / (1000 * 60) * 10) / 10 : 0,
      totalOrders: totalCount,
      excludedCount,
    }));

  } else if (view === 'weekly') {
    // Last 12 weeks
    const now = new Date(year, month - 1, new Date(year, month, 0).getDate());
    const weeksBack = 12;
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - (weeksBack * 7));
    weekStart.setHours(0, 0, 0, 0);

    const [results, excludedCount] = await Promise.all([
      Order.aggregate([
        { $match: { ...commonMatch, order_date: { $gte: weekStart, $lte: now } } },
        { $addFields: { ...commonAddFields, weekNum: { $isoWeek: '$order_date' }, weekYear: { $isoWeekYear: '$order_date' } } },
        { $match: timeFilter },
        {
          $group: {
            _id: { week: '$weekNum', year: '$weekYear' },
            avgMs: { $avg: '$processingMs' },
            minMs: { $min: '$processingMs' },
            maxMs: { $max: '$processingMs' },
            allMs: { $push: '$processingMs' },
            count: { $sum: 1 },
            firstDate: { $min: '$order_date' },
          },
        },
        { $sort: { '_id.year': 1, '_id.week': 1 } },
      ]),
      Order.countDocuments({
        ...commonMatch,
        order_date: { $gte: weekStart, $lte: now },
        $expr: { $gt: [{ $subtract: ['$confirmedAt', '$createdAt'] }, MAX_PROCESSING_MS] },
      }),
    ]);

    const data = results.map((entry: any) => {
      const sorted = (entry.allMs as number[]).sort((a: number, b: number) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const medianMs = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      const d = new Date(entry.firstDate);
      const label = `${d.getMonth() + 1}/${d.getDate()}`;
      return {
        label,
        avgMinutes: Math.round(entry.avgMs / (1000 * 60) * 10) / 10,
        medianMinutes: Math.round(medianMs / (1000 * 60) * 10) / 10,
        minMinutes: Math.round(entry.minMs / (1000 * 60) * 10) / 10,
        maxMinutes: Math.round(entry.maxMs / (1000 * 60) * 10) / 10,
        count: entry.count,
      };
    });

    let totalMs = 0;
    let totalCount = 0;
    for (const entry of results) {
      totalMs += (entry as any).avgMs * (entry as any).count;
      totalCount += (entry as any).count;
    }

    return JSON.parse(JSON.stringify({
      data,
      overallAvgMinutes: totalCount > 0 ? Math.round(totalMs / totalCount / (1000 * 60) * 10) / 10 : 0,
      totalOrders: totalCount,
      excludedCount,
    }));

  } else {
    // Monthly view
    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);

    const [results, excludedCount] = await Promise.all([
      Order.aggregate([
        { $match: { ...commonMatch, order_date: { $gte: startOfYear, $lte: endOfYear } } },
        { $addFields: commonAddFields },
        { $match: timeFilter },
        {
          $group: {
            _id: { $month: '$order_date' },
            avgMs: { $avg: '$processingMs' },
            minMs: { $min: '$processingMs' },
            maxMs: { $max: '$processingMs' },
            allMs: { $push: '$processingMs' },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Order.countDocuments({
        ...commonMatch,
        order_date: { $gte: startOfYear, $lte: endOfYear },
        $expr: { $gt: [{ $subtract: ['$confirmedAt', '$createdAt'] }, MAX_PROCESSING_MS] },
      }),
    ]);

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthMap = new Map(results.map((r: any) => [r._id, r]));
    const data = [];
    let totalMs = 0;
    let totalCount = 0;

    for (let m = 1; m <= 12; m++) {
      const entry = monthMap.get(m) as any;
      if (entry) {
        const sorted = (entry.allMs as number[]).sort((a: number, b: number) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const medianMs = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        data.push({
          label: monthNames[m - 1],
          avgMinutes: Math.round(entry.avgMs / (1000 * 60) * 10) / 10,
          medianMinutes: Math.round(medianMs / (1000 * 60) * 10) / 10,
          minMinutes: Math.round(entry.minMs / (1000 * 60) * 10) / 10,
          maxMinutes: Math.round(entry.maxMs / (1000 * 60) * 10) / 10,
          count: entry.count,
        });
        totalMs += entry.avgMs * entry.count;
        totalCount += entry.count;
      } else {
        data.push({ label: monthNames[m - 1], avgMinutes: 0, medianMinutes: 0, minMinutes: 0, maxMinutes: 0, count: 0 });
      }
    }

    return JSON.parse(JSON.stringify({
      data,
      overallAvgMinutes: totalCount > 0 ? Math.round(totalMs / totalCount / (1000 * 60) * 10) / 10 : 0,
      totalOrders: totalCount,
      excludedCount,
    }));
  }
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
