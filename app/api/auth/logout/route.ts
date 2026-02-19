import { NextResponse } from 'next/server';
import { getExpiredCookieConfig } from '@/lib/auth';

export async function POST() {
  const response = NextResponse.json({ success: true });
  const cookieConfig = getExpiredCookieConfig();
  response.cookies.set(cookieConfig);
  return response;
}
