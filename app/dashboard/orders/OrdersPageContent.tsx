import React from 'react';
import { getPaginatedOrders, getOrderTabCounts } from '@/actions/orderActions';
import OrdersClient from './OrdersClient';

interface ResolvedSearchParams {
  page?: string;
  status?: string;
  search?: string;
  marketplace?: string;
  perPage?: string;
  sortBy?: string;
  sortOrder?: string;
}

interface PageProps {
  searchParams: Promise<ResolvedSearchParams>;
}

export default async function OrdersPageContent({ searchParams }: PageProps) {
  const sp = await searchParams;

  const page = parseInt(sp.page || '1');
  const search = sp.search || '';
  const marketplace = sp.marketplace || '';
  const sortBy = sp.sortBy || 'order_date';
  const sortOrder = (sp.sortOrder || 'desc') as 'asc' | 'desc';

  // Parse status filter from comma-separated URL param
  // SeatScouts uses: pending (= invoiced), problem, confirmed, confirmed_delay,
  // delivery_problem, delivered, rejected
  // Default: "pending" which maps to DB statuses ['invoiced', 'pending']
  const statusParam = sp.status ?? 'pending';

  // Default page: pending only, no search/marketplace → show 20
  // Any other filter combination → show 100
  const isDefaultView = statusParam === 'pending' && !search && !marketplace;
  const perPage = parseInt(sp.perPage || (isDefaultView ? '20' : '100'));
  const urlStatuses = statusParam ? statusParam.split(',').filter(Boolean) : [];

  // Map URL status values to DB status values
  // "pending" in SeatScouts API = "invoiced" + "pending" in our DB
  const STATUS_TO_DB: Record<string, string[]> = {
    pending: ['invoiced', 'pending'],
    problem: ['problem'],
    confirmed: ['confirmed'],
    confirmed_delay: ['confirmed_delay'],
    delivery_problem: ['delivery_problem'],
    delivered: ['delivered'],
    rejected: ['rejected'],
  };

  const dbStatuses = urlStatuses.flatMap(s => STATUS_TO_DB[s] || [s]);

  // Build filters
  const filters: Record<string, unknown> = {
    search: search.trim(),
  };
  if (dbStatuses.length > 0) {
    filters.statusIn = dbStatuses;
  }
  if (marketplace && marketplace !== 'all') {
    filters.marketplace = marketplace;
  }

  // Fetch data server-side
  const [result, tabCounts] = await Promise.all([
    getPaginatedOrders(page, perPage, filters as Parameters<typeof getPaginatedOrders>[2], sortBy, sortOrder),
    getOrderTabCounts(),
  ]);

  return (
    <OrdersClient
      orders={result.orders}
      total={result.total}
      totalPages={result.totalPages}
      unackCount={result.unacknowledgedCount}
      tabCounts={tabCounts}
      currentPage={page}
      perPage={perPage}
      search={search}
      marketplace={marketplace}
      statusFilter={urlStatuses}
      sortBy={sortBy}
      sortOrder={sortOrder}
    />
  );
}
