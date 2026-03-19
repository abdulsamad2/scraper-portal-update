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

  const { searchParams } = new URL(request.url);
  const page = searchParams.get('page') || '1';
  const perPage = searchParams.get('perPage') || '50';

  try {
    const apiUrl = `${SYNC_API_BASE}/accounts/paginated?page=${page}&limit=${perPage}&sort_by=last_crawled&sort_dir=desc`;
    const res = await fetch(apiUrl, {
      headers: {
        'X-Company-Id': companyId,
        'X-Api-Token': apiToken,
        'Accept': 'application/json',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json({ error: `API error ${res.status}: ${text}` }, { status: 502 });
    }

    const data = await res.json();
    const rawAccounts = data.accounts || data.data || data || [];
    const accounts = (Array.isArray(rawAccounts) ? rawAccounts : []).map((a: Record<string, unknown>) => ({
      id: a.id,
      username: a.username,
      active: a.active,
      bad_creds: a.bad_creds,
      bad_cred_type: a.bad_cred_type,
      total_orders: a.total_orders,
      last_crawled: a.last_crawled,
      site_name: (a.site as Record<string, unknown>)?.description ?? null,
      site_type: (a.site as Record<string, unknown>)?.type ?? null,
      site_url: (a.site as Record<string, unknown>)?.site ?? null,
      internal_tags: a.internal_tags,
      auto_po: a.auto_po,
      disable_auto_crawl: a.disable_auto_crawl,
    }));

    return NextResponse.json({
      accounts,
      pagination: {
        page: data.page ?? parseInt(page),
        perPage: data.per_page ?? parseInt(perPage),
        total: data.total ?? data.total_count ?? accounts.length,
        totalPages: data.total_pages ?? Math.ceil((data.total ?? accounts.length) / parseInt(perPage)),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'Failed to fetch accounts' },
      { status: 500 }
    );
  }
}
