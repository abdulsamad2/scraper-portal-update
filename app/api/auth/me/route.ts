import { NextRequest, NextResponse } from 'next/server';
import { getSessionRole } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const role = await getSessionRole(request);
  if (!role) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  return NextResponse.json({ role });
}
