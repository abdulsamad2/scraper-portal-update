'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Tag, ExternalLink, Loader2, BellRing } from 'lucide-react';

/** A listing priced far below the seats behind it — a buying opportunity. */
interface Bargain {
  key: string;
  eventId: string;
  eventName: string;
  venue: string;
  eventDate: string | null;
  url: string;
  section: string;
  row: string;
  seatRange: string;
  price: number;
  comparableAvg: number;
  comparableCount: number;
  pctBelow: number;
  foundAt: string;
}

/**
 * The buy-list, polled from the inventory watcher.
 *
 * Lives beside seat drops because it answers the same question — what should I
 * go and buy right now — and because a drop is one of the things that creates a
 * bargain: seats landing behind a listing lift the average it is measured
 * against.
 *
 * Reads from /api/underpriced, which derives the list from the database rather
 * than from the watcher's in-memory state, so the answer does not depend on
 * which instance served the request or on whether a watch cycle has run.
 */
export default function UnderpricedView() {
  const [rows, setRows] = useState<Bargain[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seenKeys = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/underpriced', { cache: 'no-store' });
      const data = await res.json();
      const list: Bargain[] = Array.isArray(data.underpriced) ? data.underpriced : [];

      // Anything not present on the previous poll is new since you last looked.
      // The first poll seeds the baseline rather than flagging the whole list.
      if (seenKeys.current === null) {
        seenKeys.current = new Set(list.map(b => b.key));
      } else {
        const added = list.filter(b => !seenKeys.current!.has(b.key)).map(b => b.key);
        if (added.length) setFresh(prev => new Set([...prev, ...added]));
        seenKeys.current = new Set(list.map(b => b.key));
      }

      setRows(list);
      setError(null);
    } catch {
      setError('Could not reach the inventory watcher.');
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  if (rows === null) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 px-5 py-12 flex items-center justify-center gap-2 text-sm text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading underpriced listings…
      </div>
    );
  }

  const freshCount = rows.filter(r => fresh.has(r.key)).length;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {error}
        </div>
      )}

      {freshCount > 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-2">
          <BellRing className="w-4 h-4 text-emerald-600" />
          <p className="text-sm font-semibold text-emerald-900">
            {freshCount} new underpriced listing{freshCount === 1 ? '' : 's'} since you opened this tab
          </p>
          <button
            onClick={() => setFresh(new Set())}
            className="ml-auto text-xs font-semibold text-emerald-700 hover:text-emerald-900 underline"
          >
            Clear
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-emerald-50 flex items-center justify-center">
              <Tag size={12} className="text-emerald-600" />
            </span>
            <h2 className="text-sm font-semibold text-slate-700">
              Underpriced listings{rows.length ? ` (${rows.length})` : ''}
            </h2>
          </div>
          <span className="text-xs text-slate-400">
            Priced well below the average of the rows behind them · refreshes every 5s
          </span>
        </div>

        {rows.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-slate-400">
            Nothing is priced far enough below its neighbours right now.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100">
                  <th className="text-left px-5 py-2">Event</th>
                  <th className="text-left px-3 py-2">Section / Row</th>
                  <th className="text-left px-3 py-2">Seats</th>
                  <th className="text-right px-3 py-2">Price</th>
                  <th className="text-right px-3 py-2">Rows behind</th>
                  <th className="text-right px-3 py-2">Below</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(b => (
                  <tr key={b.key} className={fresh.has(b.key) ? 'bg-emerald-50/60' : 'hover:bg-slate-50'}>
                    <td className="px-5 py-2.5">
                      <div className="font-semibold text-slate-700 flex items-center gap-2">
                        {b.eventName || b.eventId}
                        {fresh.has(b.key) && (
                          <span className="px-1.5 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-bold">NEW</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400">
                        {[b.venue, b.eventDate ? new Date(b.eventDate).toLocaleDateString() : '']
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-medium text-slate-700">{b.section} · Row {b.row}</td>
                    <td className="px-3 py-2.5 text-slate-500 tabular-nums">{b.seatRange || '—'}</td>
                    <td className="px-3 py-2.5 text-right font-bold tabular-nums text-emerald-700">
                      ${b.price.toFixed(2)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                      ${b.comparableAvg.toFixed(2)}
                      <span className="text-slate-400"> ({b.comparableCount})</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold tabular-nums">
                        {b.pctBelow.toFixed(0)}%
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {b.url && (
                        <a
                          href={b.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors"
                        >
                          Buy <ExternalLink size={10} />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
