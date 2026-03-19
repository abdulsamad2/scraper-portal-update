import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import dbConnect from '@/lib/dbConnect';
import { Purchase } from '@/models/purchaseModel';

const SYNC_API_BASE = 'https://app.sync.automatiq.com/sync/api';

export const revalidate = 0;
export const maxDuration = 120;

function normalizeName(s: string): string {
  return s.toLowerCase().trim()
    .replace(/\s+/g, ' ')
    .replace(/[''`]/g, "'")
    .replace(/\s*[-–—:]\s*/g, ' ')
    .replace(/\b(at|vs\.?|versus)\b/g, 'vs');
}

/**
 * GET /api/accounts/sync — Sync purchases from Sync API to local MongoDB.
 * Incremental: only fetches purchases newer than the latest in DB.
 */
export async function GET(request: NextRequest) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  const apiToken = process.env.SYNC_API_TOKEN;
  const companyId = process.env.SYNC_COMPANY_ID;
  if (!apiToken || !companyId) {
    return NextResponse.json({ error: 'Sync API credentials not configured' }, { status: 500 });
  }

  const headers = { 'X-Company-Id': companyId, 'X-Api-Token': apiToken, 'Accept': 'application/json' };
  const full = request.nextUrl.searchParams.get('full') === '1';

  try {
    await dbConnect();

    // Get latest purchase date in our DB for incremental sync
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const latestDoc: any = full ? null : await Purchase.findOne().sort({ purchaseDate: -1 }).select('purchaseDate').lean();
    const sinceDate = latestDoc?.purchaseDate ? new Date(latestDoc.purchaseDate) : null;

    // Get total count
    const countRes = await fetch(`${SYNC_API_BASE}/purchases?limit=1&page=1`, { headers, cache: 'no-store' });
    if (!countRes.ok) return NextResponse.json({ error: `API ${countRes.status}` }, { status: 502 });
    const { count: totalCount } = await countRes.json();

    const limit = 200;
    const totalPages = Math.ceil(totalCount / limit);
    let synced = 0;
    let skipped = 0;
    let pages = 0;

    // Fetch from newest page backward (purchases are oldest-first in API)
    for (let page = totalPages; page >= 1; page--) {
      const res = await fetch(`${SYNC_API_BASE}/purchases?limit=${limit}&page=${page}`, { headers, cache: 'no-store' });
      if (!res.ok) continue;
      const data = await res.json();
      const purchases = data.data || [];
      if (!purchases.length) continue;
      pages++;

      // Check if we've gone past our latest — stop early for incremental
      let allOlder = true;

      type Ticket = { section: string; row: string; quantity: number };
      const ops = [];
      for (const p of purchases) {
        const pDate = p.purchase_date ? new Date(p.purchase_date) : null;
        if (sinceDate && pDate && pDate <= sinceDate) {
          skipped++;
          continue;
        }
        allOlder = false;

        const eventDate = p.event_date ? new Date(p.event_date) : null;
        const eventDay = eventDate ? eventDate.toISOString().slice(0, 10) : null;

        ops.push({
          updateOne: {
            filter: { purchaseId: p.id },
            update: {
              $set: {
                purchaseId: p.id,
                accountUser: p.account_user || '',
                accountId: p.account_id,
                eventName: p.event_name || '',
                eventDate,
                eventDay,
                eventId: p.event_id,
                venue: p.venue_name || '',
                purchaseDate: pDate,
                section: (p.ticket_details as Ticket[])?.[0]?.section ?? null,
                row: (p.ticket_details as Ticket[])?.[0]?.row ?? null,
                quantity: (p.ticket_details as Ticket[])?.[0]?.quantity ?? 0,
                amount: parseFloat(String(p.payment_amount || 0)),
                site: p.site_description || '',
                siteType: p.site_type || '',
                eventNameNorm: normalizeName(p.event_name || ''),
              },
            },
            upsert: true,
          },
        });
      }

      if (ops.length > 0) {
        const result = await Purchase.bulkWrite(ops, { ordered: false });
        synced += result.upsertedCount + result.modifiedCount;
      }

      // If all purchases on this page are older than our latest, stop
      if (sinceDate && allOlder) break;
    }

    const totalInDb = await Purchase.countDocuments();

    return NextResponse.json({
      success: true,
      synced,
      skipped,
      pagesChecked: pages,
      totalInDb,
      totalInApi: totalCount,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
