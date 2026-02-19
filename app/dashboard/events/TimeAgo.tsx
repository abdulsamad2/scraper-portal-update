'use client';

import React, { useState, useEffect } from 'react';

function calcTimeAgo(iso: string): { label: string; fresh: boolean; seconds: number } {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);

  let label: string;
  if (secs < 60) label = `${secs}s ago`;
  else if (mins < 60) label = `${mins}m ${secs % 60}s ago`;
  else if (hrs < 24) label = `${hrs}h ${mins % 60}m ago`;
  else label = `${days}d ago`;

  return { label, fresh: diff < 4 * 60 * 1000, seconds: secs };
}

interface TimeAgoProps {
  iso: string;           // ISO date string from DB
  dateLabel: string;     // pre-formatted date string (server-rendered, stable)
}

export default function TimeAgo({ iso, dateLabel }: TimeAgoProps) {
  // Initialize with null to avoid hydration mismatch — Date.now() differs between server and client
  const [state, setState] = useState<{ label: string; fresh: boolean; seconds: number } | null>(null);

  useEffect(() => {
    // First paint on client
    setState(calcTimeAgo(iso));
  }, [iso]);

  useEffect(() => {
    if (!state) return;
    // Tick every second while < 2 min old, otherwise every 30s
    const interval = state.seconds < 120 ? 1000 : 30_000;
    const id = setInterval(() => setState(calcTimeAgo(iso)), interval);
    return () => clearInterval(id);
  // Re-schedule when the iso prop changes (new data from refresh)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso, state?.seconds !== undefined && state.seconds < 120]);

  return (
    <div className="text-center">
      {state ? (
        <>
          <div className={`font-semibold text-xs tabular-nums ${state.fresh ? 'text-blue-700' : 'text-amber-700'}`}>
            {state.label}
          </div>
          <div className="text-[11px] text-gray-500 tabular-nums">{dateLabel}</div>
          {!state.fresh && (
            <div className="flex items-center justify-center mt-0.5">
              <div className="w-1 h-1 bg-amber-500 rounded-full mr-0.5" aria-hidden="true" />
              <span className="text-[10px] text-amber-600 font-medium">Stale</span>
            </div>
          )}
        </>
      ) : (
        <div className="text-[11px] text-gray-500 tabular-nums">{dateLabel}</div>
      )}
    </div>
  );
}
