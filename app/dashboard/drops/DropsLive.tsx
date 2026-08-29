'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Bell, BellOff, Radio, RefreshCw, ArrowDown, X } from 'lucide-react';

/**
 * The only client-side JavaScript on the drops page.
 *
 * Everything else — filtering, sorting, the list, acknowledging — is rendered
 * or handled on the server. This island exists for the three things a server
 * cannot do: refresh itself on a timer, ring an alarm, and know the viewer's
 * calendar day.
 *
 * Refreshing calls router.refresh(), which re-runs the Server Component and
 * streams new HTML in. No data fetching lives here.
 */
const ARRIVAL_HIGHLIGHT_MS = 30_000;

export default function DropsLive({
  dropIds,
  unseenCount,
  resolvedDate,
  pollMs = 5000,
}: {
  /** Drop ids currently rendered, in display order. */
  dropIds: string[];
  unseenCount: number;
  resolvedDate: string;
  pollMs?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [live, setLive] = useState(true);
  const [muted, setMuted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  const known = useRef<Set<string> | null>(null);
  const [arrived, setArrived] = useState<string[]>([]);

  useEffect(() => {
    setMuted(localStorage.getItem('drops:muted') === '1');
  }, []);

  // Browsers block audio until the viewer has interacted with the page
  useEffect(() => {
    const unlock = () => {
      if (!ctxRef.current) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctor) ctxRef.current = new Ctor();
      }
      void ctxRef.current?.resume();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const alarm = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const beep = (freq: number, at: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.3);
    };
    beep(880, 0);
    beep(1320, 0.16);
  }, []);

  /**
   * The server resolved "today" from its own clock. If the viewer's calendar
   * day differs — a late-evening operator on a UTC server, say — pin the real
   * day in the URL once so the Today filter means the viewer's today.
   */
  useEffect(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const localDate = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    if (localDate !== resolvedDate && !searchParams.get('date')) {
      const next = new URLSearchParams(searchParams.toString());
      next.set('date', localDate);
      router.replace(`${pathname}?${next}`);
    }
  }, [resolvedDate, searchParams, pathname, router]);

  /**
   * Point at what actually arrived.
   *
   * A chime alone tells you something happened but not what or where, and the
   * red "new" flag marks everything unacknowledged, so it cannot distinguish a
   * drop that landed seconds ago from one sitting there for an hour. So each
   * refresh is diffed against the ids already on screen: whatever is genuinely
   * new gets marked in place and counted in a banner that scrolls you to it.
   *
   * The first render only establishes the baseline — opening the page never
   * fires the alarm or lights up the whole list.
   */
  useEffect(() => {
    if (known.current === null) {
      known.current = new Set(dropIds);
      return;
    }
    const fresh = dropIds.filter((id) => !known.current!.has(id));
    if (fresh.length === 0) return;

    fresh.forEach((id) => known.current!.add(id));
    setArrived((prev) => [...fresh, ...prev.filter((id) => !fresh.includes(id))]);
    if (!muted) alarm();
  }, [dropIds, muted, alarm]);

  // Mark the rows themselves. The server renders the markup; this only adds a
  // class to rows that were not there a moment ago, and takes it off again.
  useEffect(() => {
    if (arrived.length === 0) return;
    const marked = arrived
      .map((id) => document.getElementById(`drop-${id}`))
      .filter((el): el is HTMLElement => el !== null);
    marked.forEach((el) => el.classList.add('drop-arrived'));

    const timer = setTimeout(() => {
      marked.forEach((el) => el.classList.remove('drop-arrived'));
      setArrived((prev) => prev.filter((id) => !arrived.includes(id)));
    }, ARRIVAL_HIGHLIGHT_MS);

    return () => {
      clearTimeout(timer);
      marked.forEach((el) => el.classList.remove('drop-arrived'));
    };
  }, [arrived]);

  const jumpToNewest = () => {
    const el = document.getElementById(`drop-${arrived[0]}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const dismissArrivals = () => setArrived([]);

  useEffect(() => {
    document.title = unseenCount > 0 ? `(${unseenCount}) Drops — Scraper Portal` : 'Drops — Scraper Portal';
  }, [unseenCount]);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => router.refresh(), pollMs);
    return () => clearInterval(id);
  }, [live, pollMs, router]);

  const manualRefresh = () => {
    setRefreshing(true);
    router.refresh();
    setTimeout(() => setRefreshing(false), 600);
  };

  const toggleMute = () => {
    setMuted((m) => {
      localStorage.setItem('drops:muted', m ? '0' : '1');
      return !m;
    });
  };

  return (
    <>
      {/* Sits above everything so it is found whether you are at the top of the
          page or scrolled deep into a long list. */}
      {arrived.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 pl-4 pr-2 py-2.5 rounded-full bg-amber-500 text-white shadow-lg shadow-amber-500/30">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
          </span>
          <span className="text-sm font-semibold">
            {arrived.length} new drop{arrived.length === 1 ? '' : 's'} just landed
          </span>
          <button
            onClick={jumpToNewest}
            className="inline-flex items-center gap-1 px-3 py-1 text-sm font-semibold rounded-full bg-white text-amber-700 hover:bg-amber-50"
          >
            <ArrowDown className="w-3.5 h-3.5" /> Show me
          </button>
          <button
            onClick={dismissArrivals}
            aria-label="Dismiss"
            className="p-1 rounded-full hover:bg-amber-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => setLive((v) => !v)}
        className={`px-3 py-2 text-sm rounded-lg flex items-center gap-2 ${
          live ? 'bg-green-100 text-green-800 hover:bg-green-200' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
        }`}
      >
        <Radio className={`w-4 h-4 ${live ? 'animate-pulse' : ''}`} />
        {live ? `Live · ${pollMs / 1000}s` : 'Paused'}
      </button>
      <button
        onClick={toggleMute}
        title={muted ? 'Alarm muted' : 'Alarm on'}
        className={`px-3 py-2 text-sm rounded-lg flex items-center gap-2 ${
          muted ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
        }`}
      >
        {muted ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
        {muted ? 'Muted' : 'Alarm on'}
      </button>
      <button
        onClick={manualRefresh}
        className="px-3 py-2 text-sm rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 flex items-center gap-2"
      >
        <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
      </button>
    </div>
    </>
  );
}
