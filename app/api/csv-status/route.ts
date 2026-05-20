import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { EXPORT_DIR, CSV_FILE_RE } from '@/lib/csvExportPaths';

// Polled by the export-csv page while a background CSV generation is running.
// Reports running / done / error based purely on which files exist on disk,
// so it works regardless of which PM2 worker handled the original POST.
export async function GET(req: NextRequest) {
  const file = new URL(req.url).searchParams.get('file') || '';
  if (!CSV_FILE_RE.test(file)) {
    return Response.json({ status: 'error', message: 'Invalid file name' }, { status: 400 });
  }

  const finalPath = path.join(EXPORT_DIR, file);

  if (fs.existsSync(finalPath)) {
    let recordCount: number | undefined;
    let size = 0;
    try {
      size = (await fs.promises.stat(finalPath)).size;
      const meta = await fs.promises.readFile(`${finalPath}.meta`, 'utf8');
      recordCount = JSON.parse(meta).recordCount;
    } catch { /* meta optional */ }
    return Response.json({
      status: 'done',
      url: `/api/download-csv?file=${encodeURIComponent(file)}`,
      recordCount,
      size,
    });
  }

  if (fs.existsSync(`${finalPath}.error`)) {
    const message = await fs.promises.readFile(`${finalPath}.error`, 'utf8').catch(() => 'CSV generation failed');
    return Response.json({ status: 'error', message });
  }

  return Response.json({ status: 'running' });
}
