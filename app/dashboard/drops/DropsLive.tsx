'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Bell, BellOff, Radio, RefreshCw } from 'lucide-react';

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
  latestDropId,
  unseenCount,
  resolvedDate,
  pollMs = 5000,
}: {
  latestDropId: string | null;
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
  const knownLatest = useRef<string | null>(null);

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

  // Ring when a drop id we have not seen before arrives. The first render only
  // establishes the baseline, so opening the page never fires the alarm.
  useEffect(() => {
    if (knownLatest.current === null) {
      knownLatest.current = latestDropId;
      return;
    }
    if (latestDropId && latestDropId !== knownLatest.current) {
      knownLatest.current = latestDropId;
      if (!muted) alarm();
    }
  }, [latestDropId, muted, alarm]);

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
  );
}
