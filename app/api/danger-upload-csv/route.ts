import { NextRequest, NextResponse } from 'next/server';
import { requireFeatureFlag } from '@/lib/featureFlags';

export const maxDuration = 300;

// The ONLY path in the app that is allowed to push a blank/empty CSV to Sync.
// All other paths (scheduler, manual export) refuse zero-record CSVs. This
// route requires an explicit file upload from the Danger Zone UI, so blank
// uploads are always intentional.
export async function POST(req: NextRequest) {
  const blocked = await requireFeatureFlag('csvManualExport');
  if (blocked) return blocked;

  try {
    const companyId = process.env.SYNC_COMPANY_ID;
    const apiToken = process.env.SYNC_API_TOKEN;
    if (!companyId || !apiToken) {
      return NextResponse.json(
        { success: false, message: 'Sync service credentials not configured.' },
        { status: 500 }
      );
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, message: 'No file provided (form field "file").' },
        { status: 400 }
      );
    }
    const confirmCode = String(form.get('confirm') || '').trim();
    if (confirmCode !== 'UPLOAD') {
      return NextResponse.json(
        { success: false, message: 'Missing confirmation. Type UPLOAD to proceed.' },
        { status: 400 }
      );
    }

    const csvContent = await file.text();
    const nonEmptyLines = csvContent.split('\n').filter(l => l.trim().length > 0).length;

    const SyncServiceMod = await import('@/lib/syncService');
    const SyncService = (SyncServiceMod as unknown as { default: new (cid: string, tok: string) => { uploadCsvContentToSync(c: string): Promise<{ uploadId?: string }> } }).default;
    const syncService = new SyncService(companyId, apiToken);

    console.log(`[danger-upload] Pushing user-supplied CSV to Sync (${file.size} bytes, ${nonEmptyLines} non-empty lines, name="${file.name}")`);
    const result = await syncService.uploadCsvContentToSync(csvContent);

    return NextResponse.json({
      success: true,
      message: `CSV uploaded via Danger Zone (${nonEmptyLines} non-empty lines, ${file.size} bytes).`,
      uploadId: result.uploadId,
      nonEmptyLines,
      bytes: file.size,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[danger-upload] Upload failed:', msg);
    return NextResponse.json(
      { success: false, message: `Danger upload failed: ${msg}` },
      { status: 500 }
    );
  }
}
