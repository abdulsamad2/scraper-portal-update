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

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Protect API routes (except auth endpoints)
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth/')) {
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