import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { EXPORT_DIR, CSV_FILE_RE } from '@/lib/csvExportPaths';
import { requireFeatureFlag } from '@/lib/featureFlags';

// Serves a finished CSV file from disk as an attachment. The file is complete
// before this is hit, so the response has a fixed Content-Length and streams
// without gaps — a reverse proxy (nginx) handles it like any static download.
export async function GET(req: NextRequest) {
  const blocked = await requireFeatureFlag('csvDownload');
  if (blocked) return blocked;

  const file = new URL(req.url).searchParams.get('file') || '';
  if (!CSV_FILE_RE.test(file)) {
    return new Response('Invalid file name', { status: 400 });
  }

  // Resolve and confirm the path stays inside the export directory.
  const filePath = path.join(EXPORT_DIR, file);
  if (path.dirname(filePath) !== EXPORT_DIR || !fs.existsSync(filePath)) {
    return new Response('File not found or expired', { status: 404 });
  }

  const stat = await fs.promises.stat(filePath);
  const webStream = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream<Uint8Array>;

  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file}"`,
      'Content-Length': String(stat.size),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}
