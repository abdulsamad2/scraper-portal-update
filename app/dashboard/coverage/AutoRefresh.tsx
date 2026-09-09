'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Keeps a server-rendered page live without turning it into a client-fetched one.
 *
 * router.refresh() re-runs the server component and streams down new markup, so the data
 * still comes from the server on every tick — there is no duplicate client-side copy of the
 * numbers, and no API route in the middle.
 *
 * `fast` is used while a phone is being connected: the QR code regenerates every few
 * seconds, so a slow cadence would show an expired code to someone standing there trying
 * to scan it.
 */
export function AutoRefresh({ fast = false }: { fast?: boolean }) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    // Refreshing a background tab burns database reads nobody is looking at.
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    onVisibility();
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => router.refresh(), fast ? 3_000 : 30_000);
    return () => clearInterval(id);
  }, [router, fast, paused]);

  return null;
}
