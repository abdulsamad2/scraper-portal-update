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
export default function DropsLive({
  newestDropId,
  freshCount,
  unseenCount,
  resolvedDate,
  pollMs = 5000,
}: {
  /** Top row's id — changes when something new arrives. */
  newestDropId: string | null;
  /** How many rows the server marked as just-landed. */
  freshCount: number;
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
  const lastNewest = useRef<string | null | undefined>(undefined);
  const [dismissed, setDismissed] = useState<string | null>(null);

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
   * Ring when the top of the list changes.
   *
   * Which rows are highlighted is the server's call — it marks anything
   * detected inside the fresh window, and re-renders that marking on every
   * refresh. A class the browser pokes onto a row does not survive: React
   * rewrites className on the next render and the highlight vanishes seconds
   * after it appears, which is exactly how the first version misbehaved.
   *
   * All this needs to know is whether the newest row changed — one string
   * rather than every id on the page.
   */
  useEffect(() => {
    if (lastNewest.current === undefined) {
      lastNewest.current = newestDropId; // baseline: opening the page is silent
      return;
    }
    if (newestDropId && newestDropId !== lastNewest.current) {
      lastNewest.current = newestDropId;
      setDismissed(null);
      if (!muted) alarm();
    }
  }, [newestDropId, muted, alarm]);

  const showBanner = freshCount > 0 && dismissed !== newestDropId;

  const jumpToNewest = () => {
    const el = document.querySelector('[data-fresh="1"]');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  useEffect(() => {
    document.title = unseenCount > 0 ? `(${unseenCount}) Drops — Scraper Portal` : 'Drops — Scraper Portal';
  }, [unseenCount]);

  /**
   * Poll only while someone is actually looking.
   *
   * Each refresh re-renders the page on the server and streams it back, so a
   * forgotten background tab was costing a full render every few seconds
   * indefinitely. Hidden tabs stop; showing one refreshes immediately, so it is
   * never stale when you return to it.
   */
  useEffect(() => {
    if (!live) return;

    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id === null) id = setInterval(() => router.refresh(), pollMs);
    };
    const stop = () => {
      if (id !== null) { clearInterval(id); id = null; }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        router.refresh(); // catch up on whatever landed while hidden
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
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
      {showBanner && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 pl-4 pr-2 py-2.5 rounded-full bg-amber-500 text-white shadow-lg shadow-amber-500/30">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
          </span>
          <span className="text-sm font-semibold">
            {freshCount} new drop{freshCount === 1 ? '' : 's'} just landed
          </span>
          <button
            onClick={jumpToNewest}
            className="inline-flex items-center gap-1 px-3 py-1 text-sm font-semibold rounded-full bg-white text-amber-700 hover:bg-amber-50"
          >
            <ArrowDown className="w-3.5 h-3.5" /> Show me
          </button>
          <button
            onClick={() => setDismissed(newestDropId)}
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
