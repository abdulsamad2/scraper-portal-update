import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SYNC_API_BASE = 'https://app.sync.automatiq.com/sync/api';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const syncId = formData.get('syncId') as string;
    const image = formData.get('image') as File | null;

    if (!syncId) {
      return NextResponse.json({ error: 'syncId required' }, { status: 400 });
    }
    if (!image) {
      return NextResponse.json({ error: 'image file required' }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
    if (!allowedTypes.includes(image.type)) {
      return NextResponse.json({ error: 'Only jpg, jpeg, png, gif files are supported' }, { status: 400 });
    }

    const apiToken = process.env.SYNC_API_TOKEN;
    const companyId = process.env.SYNC_COMPANY_ID;
    if (!apiToken || !companyId) {
      return NextResponse.json({ error: 'API credentials not configured' }, { status: 500 });
    }

    // Forward the image to the Sync API as multipart form data
    const proofForm = new FormData();
    proofForm.append('image', image, image.name);

    const res = await fetch(`${SYNC_API_BASE}/orders/${syncId}/proofs`, {
      method: 'POST',
      headers: {
        'X-Company-Id': companyId,
        'X-Api-Token': apiToken,
      },
      body: proofForm,
      signal: AbortSignal.timeout(30000),
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!res.ok) {
      return NextResponse.json({ error: data.error || `API error ${res.status}` }, { status: 502 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Proof upload error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Upload failed' },
      { status: 500 }
    );
  }
}
