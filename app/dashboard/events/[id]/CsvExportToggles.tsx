'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toggleCsvExportSetting } from '@/actions/eventActions';

interface Props {
  eventId: string;
  includeStandard: boolean;
  includeResale: boolean;
  standardQty: number;
  resaleQty: number;
  standardRows: number;
  resaleRows: number;
}

export default function CsvExportToggles({
  eventId,
  includeStandard,
  includeResale,
  standardQty,
  resaleQty,
  standardRows,
  resaleRows,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [stdOn, setStdOn] = useState(includeStandard);
  const [resOn, setResOn] = useState(includeResale);
  const [togglingField, setTogglingField] = useState<string | null>(null);

  const handleToggle = (field: 'includeStandardSeats' | 'includeResaleSeats') => {
    const isStd = field === 'includeStandardSeats';
    const current = isStd ? stdOn : resOn;
    const next = !current;

    // Optimistic update
    if (isStd) setStdOn(next); else setResOn(next);
    setTogglingField(field);

    startTransition(async () => {
      try {
        const result = await toggleCsvExportSetting(eventId, field, next);
        if (result?.error) {
          // Revert on error
          if (isStd) setStdOn(current); else setResOn(current);
        } else {
          router.refresh();
        }
      } catch {
        // Revert on error
        if (isStd) setStdOn(current); else setResOn(current);
      } finally {
        setTogglingField(null);
      }
    });
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        </span>
        <h2 className="text-sm font-bold text-slate-700">CSV Export</h2>
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* Standard toggle */}
        <ToggleRow
          label="Standard Seats"
          tag="S"
          isOn={stdOn}
          qty={standardQty}
          rows={standardRows}
          isPending={isPending && togglingField === 'includeStandardSeats'}
          onToggle={() => handleToggle('includeStandardSeats')}
          colorOn="blue"
        />

        {/* Resale toggle */}
        <ToggleRow
          label="Resale Seats"
          tag="R"
          isOn={resOn}
          qty={resaleQty}
          rows={resaleRows}
          isPending={isPending && togglingField === 'includeResaleSeats'}
          onToggle={() => handleToggle('includeResaleSeats')}
          colorOn="red"
        />
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  tag,
  isOn,
  qty,
  rows,
  isPending,
  onToggle,
  colorOn,
}: {
  label: string;
  tag: string;
  isOn: boolean;
  qty: number;
  rows: number;
  isPending: boolean;
  onToggle: () => void;
  colorOn: 'blue' | 'red';
}) {
  const colors = {
    blue: {
      badge: isOn ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-slate-100 text-slate-400 border-slate-200',
      stat: isOn ? 'text-blue-700' : 'text-slate-300',
      statLabel: isOn ? 'text-blue-500' : 'text-slate-300',
    },
    red: {
      badge: isOn ? 'bg-red-100 text-red-700 border-red-200' : 'bg-slate-100 text-slate-400 border-slate-200',
      stat: isOn ? 'text-red-700' : 'text-slate-300',
      statLabel: isOn ? 'text-red-500' : 'text-slate-300',
    },
  }[colorOn];

  return (
    <div className={`rounded-xl border p-4 transition-all duration-200 ${
      isOn ? 'border-slate-200 bg-white' : 'border-dashed border-slate-200 bg-slate-50/50'
    }`}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center justify-center w-6 h-6 rounded text-[11px] font-bold border ${colors.badge}`}>
            {tag}
          </span>
          <span className={`text-sm font-semibold transition-colors ${isOn ? 'text-slate-700' : 'text-slate-400'}`}>
            {label}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* ON/OFF badge */}
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
            isOn
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-600'
          }`}>
            {isOn ? 'ON' : 'OFF'}
          </span>

          {/* Toggle switch */}
          <button
            type="button"
            role="switch"
            aria-checked={isOn}
            aria-label={`${isOn ? 'Exclude' : 'Include'} ${label.toLowerCase()} in CSV export`}
            disabled={isPending}
            onClick={onToggle}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
              isOn
                ? 'bg-green-500 focus-visible:ring-green-500'
                : 'bg-slate-300 focus-visible:ring-slate-400'
            }`}
          >
            <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform duration-200 ease-in-out ${
              isOn ? 'translate-x-5' : 'translate-x-0'
            }`}>
              {isPending && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="w-3 h-3 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
                </span>
              )}
            </span>
          </button>
        </div>
      </div>

      {/* Stats - faded when excluded */}
      <div className="flex gap-4">
        <div className="group relative">
          <div className={`transition-opacity duration-200 ${isOn ? 'opacity-100' : 'opacity-40'}`}>
            <p className={`text-lg font-bold tabular-nums ${colors.stat}`}>
              {qty.toLocaleString()}
            </p>
            <p className={`text-[10px] font-semibold uppercase tracking-wider ${colors.statLabel}`}>
              seats
            </p>
          </div>
          {!isOn && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 bg-slate-800 text-white text-[11px] font-medium rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg">
              Excluded from CSV export
              <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-slate-800" />
            </div>
          )}
        </div>
        <div className="group relative">
          <div className={`transition-opacity duration-200 ${isOn ? 'opacity-100' : 'opacity-40'}`}>
            <p className={`text-lg font-bold tabular-nums ${colors.stat}`}>
              {rows.toLocaleString()}
            </p>
            <p className={`text-[10px] font-semibold uppercase tracking-wider ${colors.statLabel}`}>
              rows
            </p>
          </div>
          {!isOn && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 bg-slate-800 text-white text-[11px] font-medium rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg">
              Excluded from CSV export
              <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-slate-800" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
