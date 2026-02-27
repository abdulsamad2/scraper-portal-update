import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/dbConnect';
import { Order } from '@/models/orderModel';

export const dynamic = 'force-dynamic';

const SYNC_API_BASE = 'https://app.sync.automatiq.com/sync/api';

export async function GET(req: NextRequest) {
  try {
    const syncId = req.nextUrl.searchParams.get('syncId');
    if (!syncId) {
      return NextResponse.json({ error: 'syncId required' }, { status: 400 });
    }

    const apiToken = process.env.SYNC_API_TOKEN;
    const companyId = process.env.SYNC_COMPANY_ID;
    if (!apiToken || !companyId) {
      return NextResponse.json({ error: 'API credentials not configured' }, { status: 500 });
    }

    // Fetch single order detail — this endpoint returns customer data
    const res = await fetch(`${SYNC_API_BASE}/orders/${syncId}`, {
      headers: {
        'X-Company-Id': companyId,
        'X-Api-Token': apiToken,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json({ error: `API error ${res.status}: ${text}` }, { status: 502 });
    }

    const order = await res.json();

    if (!order || !order.order_id) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // Customer is a nested object: { first_name, last_name, email, phone }
    const customer = order.customer || {};
    const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(' ');
    const customerEmail = customer.email || '';
    const customerPhone = customer.phone || '';
    const transferEmail = order.transfer_to_email || '';
    const publicNotes = order.public_notes || '';
    const reason = order.error_reason || order.reason || '';
    const inHandDate = order.in_hand || order.in_hand_date || null;
    const inventoryTags = Array.isArray(order.last_seen_inventory_tags)
      ? order.last_seen_inventory_tags.join(', ')
      : (order.inventory_tags || '');
    const internalNotes = order.last_seen_internal_notes || '';

    // Update local DB with fetched fields
    await dbConnect();
    const updateFields: Record<string, unknown> = {};
    if (customerName) updateFields.customer_name = customerName;
    if (customerEmail) updateFields.customer_email = customerEmail;
    if (customerPhone) updateFields.customer_phone = customerPhone;
    if (transferEmail) updateFields.transfer_to_email = transferEmail;
    if (publicNotes) updateFields.public_notes = publicNotes;
    if (reason) updateFields.reason = reason;
    if (inHandDate) updateFields.in_hand_date = new Date(inHandDate);
    if (inventoryTags) updateFields.inventory_tags = inventoryTags;
    if (internalNotes) updateFields.last_seen_internal_notes = internalNotes;

    if (Object.keys(updateFields).length > 0) {
      await Order.updateOne(
        { order_id: order.order_id },
        { $set: updateFields }
      );
    }

    return NextResponse.json({
      success: true,
      detail: {
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        transfer_to_email: transferEmail,
        public_notes: publicNotes,
        reason,
        in_hand_date: inHandDate,
        inventory_tags: inventoryTags,
        last_seen_internal_notes: internalNotes,
        low_seat: order.low_seat ?? null,
        high_seat: order.high_seat ?? null,
      },
    });
  } catch (error) {
    console.error('Order detail error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Detail fetch failed' },
      { status: 500 }
    );
  }
}
