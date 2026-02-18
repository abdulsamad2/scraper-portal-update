'use client';

interface LocalDateProps {
  iso: string;
  opts?: Intl.DateTimeFormatOptions;
}

/**
 * Renders a date/time string in the browser's local timezone.
 * Always runs client-side so the output matches the user's locale/timezone.
 */
export default function LocalDate({ iso, opts }: LocalDateProps) {
  if (!iso) return <span className="text-slate-400">—</span>;

  const date = new Date(iso);
  if (isNaN(date.getTime())) return <span className="text-slate-400">—</span>;

  const formatted = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(date);
  return <time dateTime={iso}>{formatted}</time>;
}
