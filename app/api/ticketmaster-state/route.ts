import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/dbConnect';
import { requireApiKey } from '@/lib/apiKey';

/**
 * GET /api/ticketmaster-state?storeId=default&cookieLimit=300&mintLimit=50
 *
 * Serves the browser extension the current Ticketmaster session state. The data
 * is owned by the scrapers and lives in three collections that the portal does
 * NOT model with Mongoose (their schema is external), so we read them with the
 * native driver, read-only:
 *
 *   seed_jars       pre-minted cookie jars. _id looks like
 *                   "AbdulsMacBoo-8f5c7d::slot-3" (machineId::slot). Has
 *                   cookies[], status (healthy|dead), slot, useCount,
 *                   mintedAt, expiresAt, seedEvent.
 *   cookiesnapshots live per-store cookies captured by the extension
 *                   (storeId e.g. "firefox-default").
 *   mintdatas       reCAPTCHA/mint tokens captured per store.
 *
 * Primary cookie source is the freshest USABLE seed jar (source:"seed_jars") —
 * status:"healthy" AND unexpired AND under its per-token call budget (useCount),
 * matching what the scrapers themselves will accept. If none qualifies we fall back
 * to the latest per-name cookie snapshots (source:"snapshots"). `tmpt` is always
 * resolved from the returned cookie set, pulling the newest snapshot value if the
 * jar itself lacks one.
 *
 * The extension sends storeId=default, but snapshots/mint are stored under a
 * concrete id like "firefox-default"; when the requested id has no data we
 * resolve to the most recently active store so the extension keeps working.
 */

export const dynamic = 'force-dynamic';

type RawCookie = {
  name?: string;
  value?: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
};

// Normalize Chrome/Firefox sameSite variants to the extension's expected set.
function normSameSite(s: string | undefined): 'Lax' | 'None' | 'Strict' {
  switch ((s || '').toLowerCase()) {
    case 'none':
    case 'no_restriction':
      return 'None';
    case 'strict':
      return 'Strict';
    default:
      return 'Lax';
  }
}

function shapeCookie(c: RawCookie) {
  return {
    name: c.name ?? '',
    value: c.value ?? '',
    domain: c.domain ?? '',
    path: c.path ?? '/',
    secure: c.secure !== false,
    httpOnly: !!c.httpOnly,
    sameSite: normSameSite(c.sameSite),
  };
}

function iso(d: unknown): string | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d as string);
  return isNaN(date.getTime()) ? null : date.toISOString();
}

export async function GET(req: NextRequest) {
  try {
    const denied = requireApiKey(req);
    if (denied) return denied;

    const sp = req.nextUrl.searchParams;
    const requestedStoreId = (sp.get('storeId') || 'default').trim();
    const cookieLimit = Math.min(2000, Math.max(1, Number(sp.get('cookieLimit')) || 300));
    const mintLimit = Math.min(500, Math.max(1, Number(sp.get('mintLimit')) || 50));

    await dbConnect();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no_db_connection');

    const snapshots = db.collection('cookiesnapshots');
    const seedJars = db.collection('seed_jars');
    const mintDatas = db.collection('mintdatas');

    // Resolve storeId: prefer the requested one; if it has no cookies, fall back
    // to the store with the most recent snapshot activity.
    let storeId = requestedStoreId;
    const hasRequested = await snapshots.findOne({ storeId: requestedStoreId }, { projection: { _id: 1 } });
    if (!hasRequested) {
      const latest = await snapshots.findOne({}, { sort: { updatedAt: -1 }, projection: { storeId: 1 } });
      if (latest?.storeId) storeId = latest.storeId;
    }

    // Primary source: freshest USABLE seed jar. `status:"healthy"` alone is not enough —
    // nothing ever flips status on expiry, and the scrapers retire a token by call budget
    // (useCount) without always winning the race to mark it dead. Both conditions are
    // enforced here exactly as the scrapers enforce them in their own read query, so the
    // extension can never be handed an expired or budget-spent jar.
    const jarBudget = parseInt(process.env.JAR_CALL_BUDGET || '', 10) || 400;
    const jar = await seedJars.findOne(
      {
        status: 'healthy',
        expiresAt: { $gt: new Date() },
        $or: [{ useCount: { $exists: false } }, { useCount: { $lt: jarBudget } }],
      },
      { sort: { mintedAt: -1 } }
    );

    let cookies: ReturnType<typeof shapeCookie>[];
    let source: string;
    let seedJar: Record<string, unknown> | null = null;

    if (jar && Array.isArray(jar.cookies) && jar.cookies.length) {
      cookies = (jar.cookies as RawCookie[]).map(shapeCookie);
      source = 'seed_jars';
      const id = String(jar._id ?? '');
      seedJar = {
        id,
        status: jar.status ?? 'unknown',
        machineId: id.includes('::') ? id.split('::')[0] : null,
        slot: jar.slot ?? null,
        useCount: jar.useCount ?? 0,
        mintedAt: iso(jar.mintedAt),
        expiresAt: iso(jar.expiresAt),
      };
    } else {
      // Fallback: latest snapshot per cookie name for the resolved store.
      const snaps = (await snapshots
        .find({ storeId })
        .sort({ updatedAt: -1 })
        .toArray()) as RawCookie[];
      const byName = new Map<string, RawCookie>();
      for (const s of snaps) {
        if (s.name && !byName.has(s.name)) byName.set(s.name, s);
      }
      cookies = [...byName.values()].map(shapeCookie);
      source = 'snapshots';
    }

    // Ensure a tmpt cookie is present — pull the newest snapshot value if the
    // primary source lacks one (the extension relies on tmpt directly).
    let tmpt = cookies.find((c) => c.name === 'tmpt')?.value || '';
    if (!tmpt) {
      const tmptSnap = (await snapshots.findOne(
        { storeId, name: 'tmpt' },
        { sort: { updatedAt: -1 } }
      )) as RawCookie | null;
      if (tmptSnap?.value) {
        tmpt = tmptSnap.value;
        cookies.push(shapeCookie(tmptSnap));
      }
    }

    if (cookies.length > cookieLimit) cookies = cookies.slice(0, cookieLimit);

    // Mint tokens for the resolved store.
    const mintDocs = await mintDatas
      .find({ storeId })
      .sort({ updatedAt: -1 })
      .limit(mintLimit)
      .toArray();
    const mint = mintDocs.map((m) => ({
      storeId: m.storeId ?? storeId,
      key: m.key ?? '',
      value: m.value ?? '',
      source: m.source ?? '',
      url: m.url ?? '',
      method: m.method ?? '',
      createdAt: iso(m.createdAt),
    }));

    return NextResponse.json({
      ok: true,
      storeId: requestedStoreId,
      resolvedStoreId: storeId,
      tmpt,
      cookieCount: cookies.length,
      cookies,
      mint,
      source,
      seedJar,
    });
  } catch (err) {
    console.error('[GET /api/ticketmaster-state]', err);
    return NextResponse.json(
      { ok: false, error: 'internal_error' },
      { status: 500 }
    );
  }
}
