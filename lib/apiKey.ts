import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

/**
 * Shared API-key guard for the browser-extension endpoints
 * (/api/proxies, /api/ticketmaster-state).
 *
 * Keys are read from EXTENSION_API_KEY (comma-separated to allow rotation).
 * Callers may present the key as an `x-api-key` header, an
 * `Authorization: Bearer <key>` header, or an `?apiKey=` query param — the
 * query param is convenient for a GET-only extension.
 *
 * If EXTENSION_API_KEY is unset the guard is disabled (open access) so local
 * development and the current extension keep working until the key is rolled
 * out. Set the env var to enforce it.
 */

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA); // spend constant time, then fail
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function presentedKey(req: NextRequest): string | null {
  const header = req.headers.get('x-api-key');
  if (header) return header.trim();
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const q = req.nextUrl.searchParams.get('apiKey');
  return q ? q.trim() : null;
}

/**
 * Returns a 401 NextResponse if the request is not authorized, otherwise null.
 * Usage:  const denied = requireApiKey(req); if (denied) return denied;
 */
export function requireApiKey(req: NextRequest): NextResponse | null {
  const configured = (process.env.EXTENSION_API_KEY || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);

  // No keys configured → guard disabled.
  if (configured.length === 0) return null;

  const key = presentedKey(req);
  if (key && configured.some((valid) => safeEqual(key, valid))) {
    return null;
  }

  return NextResponse.json(
    { ok: false, error: 'unauthorized' },
    { status: 401 }
  );
}
