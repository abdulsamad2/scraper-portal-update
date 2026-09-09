import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { NextRequest, NextResponse } from 'next/server';

/**
 * This module is imported by middleware.ts, which runs on the Edge runtime, so
 * everything here must be Edge-safe: jose, the Web Crypto it uses internally,
 * request cookies and process.env — no node: builtins.
 *
 * Password checking used to live here and pulled in node:crypto for
 * timingSafeEqual, which Next warned about on every request. It now lives in
 * lib/authCredentials.ts, which only the login route imports.
 */

const COOKIE_NAME = 'session_token';

/**
 * Get the JWT secret from environment variable.
 */
function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('AUTH_SECRET environment variable is not set');
  }
  return new TextEncoder().encode(secret);
}

/**
 * Create a signed JWT token with role embedded.
 */
export async function createSessionToken(username: string, role: 'superadmin' | 'admin' = 'admin'): Promise<string> {
  const token = await new SignJWT({ username, role } as JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(getSecret());

  return token;
}

/**
 * Extract role from a NextRequest's session cookie.
 * Returns 'superadmin', 'admin', or null if not authenticated.
 */
export async function getSessionRole(request: NextRequest): Promise<'superadmin' | 'admin' | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  return (payload.role as string) === 'superadmin' ? 'superadmin' : 'admin';
}

/**
 * Verify a JWT token and return its payload.
 * Returns null if the token is invalid or expired.
 */
export async function verifySessionToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload;
  } catch {
    return null;
  }
}

/**
 * Verify the session from a NextRequest (for use in middleware).
 * Reads the session cookie and verifies the JWT.
 */
export async function verifySession(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return false;
  const payload = await verifySessionToken(token);
  return payload !== null;
}

/**
 * Whether the session cookie is marked Secure.
 *
 * A browser will not store a Secure cookie delivered over plain HTTP. The login
 * request succeeds, the cookie is silently dropped, and the next request bounces
 * straight back to /login — which reads as "login is broken" with nothing in the
 * logs to show for it.
 *
 * Set AUTH_COOKIE_SECURE=false when the portal really is served over HTTP, such
 * as an internal host with no certificate. That is a stopgap, not a fix: the
 * session token then travels in clear text and anyone on the network path can
 * lift it. Put TLS in front of the portal and remove the flag.
 */
function sessionCookieIsSecure(): boolean {
  const flag = process.env.AUTH_COOKIE_SECURE;
  if (flag === 'false' || flag === '0') return false;
  if (flag === 'true' || flag === '1') return true;
  return process.env.NODE_ENV === 'production';
}

/**
 * Get session cookie configuration.
 */
export function getSessionCookieConfig(token: string) {
  return {
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,       // Not accessible from JavaScript
    secure: sessionCookieIsSecure(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 60 * 24, // 24 hours
  };
}

/**
 * Get an expired cookie config (for logout).
 */
export function getExpiredCookieConfig() {
  return {
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    // Must match the cookie being cleared or the browser keeps the original.
    secure: sessionCookieIsSecure(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 0,
  };
}

/**
 * Require authentication on an API route.
 * Returns a 401 NextResponse if not authenticated, or null if OK.
 */
export async function requireAuth(request: NextRequest): Promise<NextResponse | null> {
  const role = await getSessionRole(request);
  if (!role) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

export { COOKIE_NAME };
