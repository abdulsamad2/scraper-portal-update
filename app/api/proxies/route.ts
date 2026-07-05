import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/dbConnect';
import { Proxy } from '@/models/proxyModel';
import { requireApiKey } from '@/lib/apiKey';

/**
 * GET /api/proxies?clientId=default&limit=2000[&enabled=enabled|disabled|all]
 *
 * Feeds the browser extension a flat proxy list. Shape is intentionally
 * scraper-friendly: required fields are `host` and `port`; `protocol` defaults
 * to "http"; `username`/`password` may be empty strings.
 *
 * The portal stores proxies with { ip, port, username, password, proxy_id }.
 * We map ip→host and expose proxy_id (falling back to _id) as `proxyId`.
 */

export const dynamic = 'force-dynamic';

type Lean = {
  _id: unknown;
  ip?: string;
  port?: string;
  username?: string;
  password?: string;
  proxy_id?: string;
  clientId?: string;
  enabled?: boolean;
};

export async function GET(req: NextRequest) {
  try {
    const denied = requireApiKey(req);
    if (denied) return denied;

    const sp = req.nextUrl.searchParams;
    const clientId = (sp.get('clientId') || 'default').trim();
    const limit = Math.min(5000, Math.max(1, Number(sp.get('limit')) || 2000));
    // Default to only usable proxies; callers can widen with enabled=all.
    const enabled = (sp.get('enabled') || 'enabled').toLowerCase();

    await dbConnect();

    const filter: Record<string, unknown> = { clientId };
    if (enabled === 'enabled') filter.enabled = true;
    else if (enabled === 'disabled') filter.enabled = false;
    // enabled=all → no enabled filter

    const rows = (await Proxy.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()) as unknown as Lean[];

    const proxies = rows.map((p) => {
      const portNum = Number(p.port);
      return {
        protocol: 'http' as const,
        host: p.ip ?? '',
        port: Number.isFinite(portNum) ? portNum : p.port,
        username: p.username ?? '',
        password: p.password ?? '',
        proxyId: p.proxy_id || String(p._id),
        clientId: p.clientId ?? clientId,
        enabled: p.enabled !== false,
      };
    });

    return NextResponse.json({
      ok: true,
      clientId,
      count: proxies.length,
      proxies,
    });
  } catch (err) {
    console.error('[GET /api/proxies]', err);
    return NextResponse.json(
      { ok: false, error: 'internal_error' },
      { status: 500 }
    );
  }
}
