import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

const SYNC_API_BASE = 'https://app.sync.automatiq.com/sync/api';

export const revalidate = 0;

export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  const apiToken = process.env.SYNC_API_TOKEN;
  const companyId = process.env.SYNC_COMPANY_ID;
  if (!apiToken || !companyId) {
    return NextResponse.json({ error: 'Sync API credentials not configured' }, { status: 500 });
  }

  const headers = {
    'X-Company-Id': companyId,
    'X-Api-Token': apiToken,
    'Accept': 'application/json',
  };

  try {
    // Get total count first
    const countRes = await fetch(`${SYNC_API_BASE}/purchases?limit=1&page=1`, { headers, cache: 'no-store' });
    if (!countRes.ok) {
      const text = await countRes.text().catch(() => '');
      return NextResponse.json({ error: `API error ${countRes.status}: ${text}` }, { status: 502 });
    }
    const countData = await countRes.json();
    const totalCount = countData.count || 0;
    if (totalCount === 0) {
      return NextResponse.json({ purchases: [], byEvent: [], byAccount: [], totalCount: 0 });
    }

    // Fetch ALL purchases in parallel batches
    const limit = 200;
    const totalPages = Math.ceil(totalCount / limit);
    const BATCH_SIZE = 10; // concurrent requests
    const allPurchases: Record<string, unknown>[] = [];

    for (let batchStart = 1; batchStart <= totalPages; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, totalPages);
      const pages = Array.from({ length: batchEnd - batchStart + 1 }, (_, i) => batchStart + i);
      const results = await Promise.all(
        pages.map(async (page) => {
          const res = await fetch(`${SYNC_API_BASE}/purchases?limit=${limit}&page=${page}`, { headers, cache: 'no-store' });
          if (!res.ok) return [];
          const data = await res.json();
          return data.data || data.purchases || [];
        })
      );
      for (const batch of results) {
        if (Array.isArray(batch)) allPurchases.push(...batch);
      }
    }

    // Flatten individual purchases (most recent first)
    const purchases = allPurchases
      .map(p => ({
        id: p.id,
        account_user: p.account_user as string,
        account_id: p.account_id as number,
        event_name: (p.event_name as string) || '',
        event_date: p.event_date as string,
        venue: (p.venue_name as string) || '',
        purchase_date: (p.purchase_date as string) || '',
        section: (p.ticket_details as { section: string }[])?.[0]?.section ?? null,
        row: (p.ticket_details as { row: string }[])?.[0]?.row ?? null,
        quantity: (p.ticket_details as { quantity: number }[])?.[0]?.quantity ?? 0,
        amount: parseFloat(String(p.payment_amount || 0)),
        site: (p.site_description as string) || '',
        site_type: (p.site_type as string) || '',
        payment_brand: (p.payment_instrument_brand as string) || null,
        payment_last_four: (p.payment_instrument_last_four as string) || null,
      }))
      .sort((a, b) => b.purchase_date.localeCompare(a.purchase_date));

    // Group by event
    const eventMap = new Map<string, {
      event_name: string; event_date: string; venue: string;
      accounts: Map<string, { email: string; tickets: number; orders: number; spent: number; lastDate: string }>;
      totalTickets: number; totalSpent: number; totalOrders: number;
    }>();

    for (const p of purchases) {
      const key = p.event_name.toLowerCase();
      if (!eventMap.has(key)) {
        eventMap.set(key, {
          event_name: p.event_name, event_date: p.event_date, venue: p.venue,
          accounts: new Map(), totalTickets: 0, totalSpent: 0, totalOrders: 0,
        });
      }
      const ev = eventMap.get(key)!;
      ev.totalTickets += p.quantity;
      ev.totalSpent += p.amount;
      ev.totalOrders++;
      const accKey = p.account_user.toLowerCase();
      if (!ev.accounts.has(accKey)) {
        ev.accounts.set(accKey, { email: p.account_user, tickets: 0, orders: 0, spent: 0, lastDate: '' });
      }
      const acc = ev.accounts.get(accKey)!;
      acc.tickets += p.quantity;
      acc.orders++;
      acc.spent += p.amount;
      if (p.purchase_date > acc.lastDate) acc.lastDate = p.purchase_date;
    }

    const byEvent = [...eventMap.values()]
      .map(ev => ({
        event_name: ev.event_name,
        event_date: ev.event_date,
        venue: ev.venue,
        totalTickets: ev.totalTickets,
        totalSpent: +ev.totalSpent.toFixed(2),
        totalOrders: ev.totalOrders,
        accounts: [...ev.accounts.values()].map(a => ({ ...a, spent: +a.spent.toFixed(2) })),
      }))
      .sort((a, b) => (b.event_date || '').localeCompare(a.event_date || ''));

    // Group by account
    const accMap = new Map<string, {
      email: string; totalPurchases: number; totalTickets: number; totalSpent: number;
      lastPurchaseDate: string; lastEvent: string;
    }>();
    for (const p of purchases) {
      const key = p.account_user.toLowerCase();
      if (!accMap.has(key)) {
        accMap.set(key, { email: p.account_user, totalPurchases: 0, totalTickets: 0, totalSpent: 0, lastPurchaseDate: '', lastEvent: '' });
      }
      const a = accMap.get(key)!;
      a.totalPurchases++;
      a.totalTickets += p.quantity;
      a.totalSpent += p.amount;
      if (p.purchase_date > a.lastPurchaseDate) { a.lastPurchaseDate = p.purchase_date; a.lastEvent = p.event_name; }
    }

    const byAccount = [...accMap.values()]
      .map(a => ({ ...a, totalSpent: +a.totalSpent.toFixed(2) }))
      .sort((a, b) => b.lastPurchaseDate.localeCompare(a.lastPurchaseDate));

    return NextResponse.json({
      purchases: purchases.slice(0, 500), // 500 most recent individual purchases
      byEvent,
      byAccount,
      totalCount,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'Failed to fetch purchases' },
      { status: 500 }
    );
  }
}
