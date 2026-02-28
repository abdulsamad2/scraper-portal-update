import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { acknowledgeOrder, unacknowledgeOrder, acknowledgeAllPending } from '@/actions/orderActions';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.all) {
      const result = await acknowledgeAllPending();
      revalidatePath('/dashboard/orders');
      return NextResponse.json(result);
    }

    if (body.orderId && body.undo) {
      const result = await unacknowledgeOrder(body.orderId);
      revalidatePath('/dashboard/orders');
      return NextResponse.json(result);
    }

    if (body.orderId) {
      const result = await acknowledgeOrder(body.orderId);
      revalidatePath('/dashboard/orders');
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'orderId or all required' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || 'Failed' },
      { status: 500 }
    );
  }
}
