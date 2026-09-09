import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySession } from '@/lib/auth';

/**
 * Auth and security headers for every dashboard and API request.
 *
 * The file MUST be named `middleware.ts` on Next 15. Next 16 renames the
 * convention to `proxy.ts` and this file was named that way, which meant Next
 * never loaded it: /dashboard answered 200 to anyone, and /api/* was wide open.
 * On upgrading to 16, rename it back with
 * `npx @next/codemod@canary middleware-to-proxy .` -- and check that an
 * unauthenticated request still redirects afterwards.
 */

/**
 * Routes that authenticate with EXTENSION_API_KEY instead of a browser session.
 *
 * The cookie-farm and the browser extension are headless callers: they present
 * an `x-api-key` header and hold no session cookie, so the session check below
 * would 401 them before their handler ever ran. Each of these routes calls
 * requireApiKey() as its first statement — they are guarded, just by a
 * different credential.
 *
 * This only started mattering when this file began being loaded at all. It was
 * previously named proxy.ts, which Next 15 ignores, so /api/* was unguarded and
 * these four worked by accident. Renaming it to middleware.ts turned the session
 * check on for the first time and took the farm and the extension down with it —
 * as a 401 that reads exactly like a rejected API key, because the real key
 * check never got to run.
 *
 * NOTE: requireApiKey() disables itself when EXTENSION_API_KEY is unset (see
 * lib/apiKey.ts), so these four are only actually protected when that variable
 * is set in the portal's environment. It must be set in production.
 */
const API_KEY_ROUTES = [
  '/api/seed-jars',
  '/api/seed-event',
  '/api/ticketmaster-state',
  '/api/proxies',
];

function usesApiKeyAuth(pathname: string): boolean {
  return API_KEY_ROUTES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Protect API routes (except auth endpoints and the API-key-guarded ones)
  if (
    pathname.startsWith('/api/') &&
    !pathname.startsWith('/api/auth/') &&
    !usesApiKeyAuth(pathname)
  ) {
    const isAuthenticated = await verifySession(request);
    if (!isAuthenticated) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // Protect dashboard routes
  if (pathname.startsWith('/dashboard')) {
    const isAuthenticated = await verifySession(request);

    if (!isAuthenticated) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  // If authenticated user visits login page, redirect to dashboard
  if (pathname === '/login') {
    const isAuthenticated = await verifySession(request);
    if (isAuthenticated) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  // Add security headers
  const response = NextResponse.next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return response;
}

export const config = {
  matcher: ['/dashboard/:path*', '/login', '/api/:path*'],
};