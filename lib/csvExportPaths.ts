import path from 'path';

// Directory where background-generated CSV exports are written and served from.
// Pruned to a 1-hour retention window by /api/generate-csv.
export const EXPORT_DIR = path.join(process.cwd(), 'csv-exports');

// Filename shape: inventory-2026-05-20-14-30-00.csv — digits and dashes only.
// Used to validate the `file` query param on the status and download routes,
// which also blocks path traversal.
export const CSV_FILE_RE = /^inventory-[\d-]+\.csv$/;
