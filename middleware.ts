import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Temporarily disable authentication for testing
  // return NextResponse.next();
  
  // Check if the request is for a dashboard route
  if (request.nextUrl.pathname.startsWith('/dashboard')) {
    // Check for authentication cookie or session
    const isAuthenticated = request.cookies.get('authenticated')?.value === 'true';
    
    if (!isAuthenticated) {
      // Redirect to login if not authenticated
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  // Add no-cache headers to all responses to ensure fresh data
  const response = NextResponse.next();
  
  // Disable all caching
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Expires', '0');
  response.headers.set('Surrogate-Control', 'no-store');
  
  return response;
}

export const config = {
  matcher: '/dashboard/:path*'
};