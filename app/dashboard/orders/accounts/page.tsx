import React, { Suspense } from 'react';
import { RefreshCw } from 'lucide-react';
import dbConnect from '@/lib/dbConnect';
import { Purchase } from '@/models/purchaseModel';
import AccountsClient from './AccountsClient';

export const dynamic = 'force-dynamic';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PAGE_SIZE = 25;

type SortBy = 'lastPurchase' | 'eventDate' | 'tickets' | 'accounts';
type Tab = 'events' | 'accounts';

interface PageProps {
  searchParams: Promise<{
    search?: string;
    tab?: string;
    page?: string;
    sortBy?: string;
    sortOrder?: string;
    dateFrom?: string;
    dateTo?: string;
  }>;
}

/* ─── Server-side data fetching with search params ─── */
async function fetchData(params: {
  search: string; tab: Tab; page: number;
  sortBy: SortBy; sortOrder: 'asc' | 'desc';
  dateFrom: string | null; dateTo: string | null;
}) {
  await dbConnect();

  const { search, tab, page, sortBy, sortOrder, dateFrom, dateTo } = params;
  const dir = sortOrder === 'asc' ? 1 : -1;

  // Build base match for date range filter
  const dateMatch: Record<string, unknown> = {};
  if (dateFrom) dateMatch.$gte = new Date(dateFrom);
  if (dateTo) {
    const to = new Date(dateTo);
    to.setDate(to.getDate() + 1); // include the full day
    dateMatch.$lte = to;
  }

  const basePurchaseMatch: Record<string, unknown> = {};
  if (dateFrom || dateTo) basePurchaseMatch.eventDate = dateMatch;
  if (search) {
    basePurchaseMatch.$or = [
      { eventNameNorm: { $regex: search.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      { accountUser: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      { venue: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
    ];
  }

  // Stats (always from full dataset, unfiltered for context)
  const [statsRaw] = await Purchase.aggregate([
    { $group: {
      _id: null,
      total: { $sum: 1 },
      tickets: { $sum: '$quantity' },
      accounts: { $addToSet: { $toLower: '$accountUser' } },
      events: { $addToSet: { $concat: ['$eventNameNorm', '|', { $ifNull: ['$eventDay', ''] }] } },
    }},
    { $project: {
      total: 1, tickets: 1,
      accountCount: { $size: '$accounts' },
      eventCount: { $size: '$events' },
    }},
  ]);
  const stats = statsRaw || { total: 0, tickets: 0, accountCount: 0, eventCount: 0 };

  if (tab === 'events') {
    // Server-side sort map for events
    const eventSortMap: Record<SortBy, Record<string, 1 | -1>> = {
      lastPurchase: { lastPurchaseDate: dir as 1 | -1 },
      eventDate:    { eventDate: dir as 1 | -1 },
      tickets:      { totalTickets: dir as 1 | -1 },
      accounts:     { accountCount: dir as 1 | -1 },
    };

    const pipeline: any[] = [
      { $match: basePurchaseMatch },
      { $group: {
        _id: { name: '$eventNameNorm', day: '$eventDay' },
        event: { $first: '$eventName' },
        eventDate: { $first: '$eventDate' },
        venue: { $first: '$venue' },
        totalTickets: { $sum: '$quantity' },
        totalOrders: { $sum: 1 },
        lastPurchaseDate: { $max: '$purchaseDate' },
        accountEmails: { $addToSet: { $toLower: '$accountUser' } },
        accountDetails: { $push: { email: '$accountUser', qty: '$quantity', date: '$purchaseDate' } },
      }},
      { $addFields: { accountCount: { $size: '$accountEmails' } } },
      { $sort: eventSortMap[sortBy] || eventSortMap.lastPurchase },
    ];

    // Get total count for pagination
    const countPipeline = [...pipeline, { $count: 'total' }];
    const [countResult] = await Purchase.aggregate(countPipeline);
    const totalEvents = countResult?.total ?? 0;

    // Get paginated results
    pipeline.push({ $skip: (page - 1) * PAGE_SIZE }, { $limit: PAGE_SIZE });
    const eventsRaw = await Purchase.aggregate(pipeline);

    const events = eventsRaw.map((ev: any) => {
      const accMap = new Map<string, { email: string; tickets: number; orders: number; lastDate: string }>();
      for (const d of ev.accountDetails || []) {
        if (!d.email) continue;
        const key = d.email.toLowerCase();
        if (!accMap.has(key)) accMap.set(key, { email: d.email, tickets: 0, orders: 0, lastDate: '' });
        const a = accMap.get(key)!;
        a.tickets += d.qty || 0;
        a.orders++;
        const ds = d.date ? new Date(d.date).toISOString() : '';
        if (ds > a.lastDate) a.lastDate = ds;
      }
      return {
        event: ev.event || '',
        eventDate: ev.eventDate ? new Date(ev.eventDate).toISOString() : '',
        venue: ev.venue || '',
        totalTickets: ev.totalTickets,
        totalOrders: ev.totalOrders,
        lastPurchaseDate: ev.lastPurchaseDate ? new Date(ev.lastPurchaseDate).toISOString() : '',
        accounts: [...accMap.values()].sort((a, b) => b.tickets - a.tickets),
      };
    });

    return {
      tab: 'events' as Tab,
      events,
      accounts: [],
      stats: { total: stats.total, tickets: stats.tickets, accountCount: stats.accountCount, eventCount: stats.eventCount },
      pagination: { page, totalPages: Math.ceil(totalEvents / PAGE_SIZE), total: totalEvents },
    };

  } else {
    // By Account tab
    const accountSortMap: Record<SortBy, Record<string, 1 | -1>> = {
      lastPurchase: { lastDate: dir as 1 | -1 },
      eventDate:    { lastDate: dir as 1 | -1 },
      tickets:      { totalTickets: dir as 1 | -1 },
      accounts:     { eventCount: dir as 1 | -1 },
    };

    const pipeline: any[] = [
      { $match: basePurchaseMatch },
      { $group: {
        _id: { $toLower: '$accountUser' },
        email: { $first: '$accountUser' },
        totalPurchases: { $sum: 1 },
        totalTickets: { $sum: '$quantity' },
        lastDate: { $max: '$purchaseDate' },
        lastEvent: { $last: '$eventName' },
        events: { $addToSet: { $concat: ['$eventNameNorm', '|', { $ifNull: ['$eventDay', ''] }] } },
      }},
      { $addFields: { eventCount: { $size: '$events' } } },
      { $sort: accountSortMap[sortBy] || accountSortMap.lastPurchase },
    ];

    const countPipeline = [...pipeline, { $count: 'total' }];
    const [countResult] = await Purchase.aggregate(countPipeline);
    const totalAccounts = countResult?.total ?? 0;

    pipeline.push({ $skip: (page - 1) * PAGE_SIZE }, { $limit: PAGE_SIZE });
    const accountsRaw = await Purchase.aggregate(pipeline);

    const accounts = accountsRaw.map((a: any) => ({
      email: a.email || '',
      totalPurchases: a.totalPurchases,
      totalTickets: a.totalTickets,
      lastDate: a.lastDate ? new Date(a.lastDate).toISOString() : '',
      lastEvent: a.lastEvent || '',
      eventCount: a.eventCount,
    }));

    return {
      tab: 'accounts' as Tab,
      events: [],
      accounts,
      stats: { total: stats.total, tickets: stats.tickets, accountCount: stats.accountCount, eventCount: stats.eventCount },
      pagination: { page, totalPages: Math.ceil(totalAccounts / PAGE_SIZE), total: totalAccounts },
    };
  }
}

/* async-suspense-boundaries */
function Skeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="flex items-center gap-3"><div className="h-6 bg-gray-200 rounded w-48" /></div>
      <div className="grid grid-cols-4 gap-2">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
            <div className="h-3 bg-gray-200 rounded w-16 mb-1" />
            <div className="h-6 bg-gray-300 rounded w-12" />
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
        <div className="h-10 bg-gray-200 rounded-lg w-full" />
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-center py-16 gap-2 text-gray-400">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading...</span>
        </div>
      </div>
    </div>
  );
}

async function Content({ searchParams }: PageProps) {
  const params = await searchParams;

  const validSorts: SortBy[] = ['lastPurchase', 'eventDate', 'tickets', 'accounts'];
  const sortBy = validSorts.includes(params.sortBy as SortBy) ? params.sortBy as SortBy : 'lastPurchase';
  const sortOrder = params.sortOrder === 'asc' ? 'asc' : 'desc';
  const tab = params.tab === 'accounts' ? 'accounts' as Tab : 'events' as Tab;

  const data = await fetchData({
    search: params.search || '',
    tab,
    page: parseInt(params.page || '1'),
    sortBy,
    sortOrder,
    dateFrom: params.dateFrom || null,
    dateTo: params.dateTo || null,
  });

  return (
    <AccountsClient
      {...data}
      currentSearch={params.search || ''}
      currentSortBy={sortBy}
      currentSortOrder={sortOrder}
      currentDateFrom={params.dateFrom || ''}
      currentDateTo={params.dateTo || ''}
    />
  );
}

export default async function AccountsPage({ searchParams }: PageProps) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}
