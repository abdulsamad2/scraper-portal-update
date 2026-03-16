import { NextRequest, NextResponse } from 'next/server';
import { flagOrderIssue, unflagOrderIssue } from '@/actions/orderActions';
import { requireAuth } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const body = await req.json();

    if (!body.orderId) {
      return NextResponse.json({ error: 'orderId required' }, { status: 400 });
    }

    if (body.unflag) {
      const result = await unflagOrderIssue(body.orderId);
      return NextResponse.json(result);
    }

    if (!body.note || !body.note.trim()) {
      return NextResponse.json({ error: 'note required when flagging' }, { status: 400 });
    }

    const result = await flagOrderIssue(body.orderId, body.note.trim());
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || 'Failed' },
      { status: 500 }
    );
  }
}
