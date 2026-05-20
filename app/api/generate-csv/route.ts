import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { generateInventoryCsvStream } from '../../../actions/csvActions';
import { requireFeatureFlag } from '@/lib/featureFlags';
import { EXPORT_DIR } from '@/lib/csvExportPaths';

// POST returns immediately; generation runs in the background and writes the
// CSV to a file on disk. The client then polls /api/csv-status and downloads
// the finished file from /api/download-csv. This avoids holding a long
// streaming connection open through nginx (which buffers the response and
// drops the download mid-stream on large exports).
export const maxDuration = 300;

// Delete export files (and sidecars) older than 1 hour.
async function pruneOld() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  try {
    await fs.promises.mkdir(EXPORT_DIR, { recursive: true });
    for (const f of await fs.promises.readdir(EXPORT_DIR)) {
      const fp = path.join(EXPORT_DIR, f);
      const st = await fs.promises.stat(fp).catch(() => null);
      if (st && st.mtimeMs < cutoff) await fs.promises.unlink(fp).catch(() => {});
    }
  } catch { /* ignore */ }
}

async function generateToFile(fileName: string, minutes: number) {
  const finalPath = path.join(EXPORT_DIR, fileName);
  const partPath = `${finalPath}.partial`;
  const errPath = `${finalPath}.error`;
  const ws = fs.createWriteStream(partPath);
  let recordCount = 0;
  let errorMsg: string | null = null;
  try {
    for await (const chunk of generateInventoryCsvStream(minutes)) {
      if ((chunk.type === 'header' || chunk.type === 'data') && chunk.text) {
        if (!ws.write(chunk.text)) {
          await new Promise<void>(res => ws.once('drain', () => res()));
        }
      } else if (chunk.type === 'done') {
        recordCount = chunk.recordCount ?? 0;
        if (chunk.error) errorMsg = chunk.error;
      }
    }
    await new Promise<void>((res, rej) => ws.end((e?: Error | null) => (e ? rej(e) : res())));
    if (errorMsg && recordCount === 0) {
      await fs.promises.unlink(partPath).catch(() => {});
      await fs.promises.writeFile(errPath, errorMsg);
    } else {
      await fs.promises.rename(partPath, finalPath);
      await fs.promises.writeFile(`${finalPath}.meta`, JSON.stringify({ recordCount })).catch(() => {});
    }
  } catch (error) {
    try { ws.destroy(); } catch { /* ignore */ }
    await fs.promises.unlink(partPath).catch(() => {});
    await fs.promises.writeFile(
      errPath,
      error instanceof Error ? error.message : 'CSV generation failed',
    ).catch(() => {});
  }
}

export async function POST(req: NextRequest) {
  const blocked = await requireFeatureFlag('csvDownload');
  if (blocked) return blocked;

  try {
    // Accept JSON or form-encoded body.
    const contentType = req.headers.get('content-type') || '';
    let eventUpdateFilterMinutes = 0;
    if (contentType.includes('application/json')) {
      const body = await req.json().catch(() => ({}));
      eventUpdateFilterMinutes = Number(body.eventUpdateFilterMinutes ?? 0) || 0;
    } else if (contentType.includes('form-urlencoded') || contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      eventUpdateFilterMinutes = Number(form.get('eventUpdateFilterMinutes') ?? 0) || 0;
    }

    await fs.promises.mkdir(EXPORT_DIR, { recursive: true });
    await pruneOld();

    const fileName = `inventory-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.csv`;

    // Fire-and-forget. The PM2 Node process stays alive, so this background
    // promise runs to completion after the response is sent.
    generateToFile(fileName, eventUpdateFilterMinutes).catch(err => {
      console.error('[generate-csv] background generation failed:', err);
    });

    return Response.json({ success: true, fileName });
  } catch (error) {
    console.error('[generate-csv] failed to start generation:', error);
    return Response.json(
      { success: false, message: 'Failed to start CSV generation' },
      { status: 500 },
    );
  }
}
