'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { ActionResult } from './actions';

/**
 * The only interactive island on an otherwise server-rendered page.
 *
 * Every button runs a server action, which revalidates the page — so the numbers on screen
 * come back from the server rather than being patched client-side, and there is no second
 * copy of the state to drift out of sync.
 */

type Btn = {
  key: string;
  label: string;
  run: () => Promise<ActionResult>;
  tone?: 'primary' | 'quiet' | 'caution';
  confirm?: string;
};

export function ActionRow({ buttons }: { buttons: Btn[] }) {
  const [pending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();

  function fire(b: Btn) {
    if (b.confirm && !window.confirm(b.confirm)) return;
    setBusyKey(b.key);
    setResult(null);
    startTransition(async () => {
      try {
        setResult(await b.run());
      } catch {
        setResult({ ok: false, message: 'Something went wrong. Please try again.' });
      } finally {
        setBusyKey(null);
        router.refresh();
      }
    });
  }

  const tones: Record<NonNullable<Btn['tone']>, string> = {
    primary: 'bg-[#101418] text-white hover:bg-[#232a32] border-[#101418]',
    quiet: 'bg-white text-slate-800 hover:bg-slate-50 border-slate-300',
    caution: 'bg-white text-amber-800 hover:bg-amber-50 border-amber-300',
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {buttons.map((b) => (
          <button
            key={b.key}
            onClick={() => fire(b)}
            disabled={pending}
            className={`px-3.5 py-2 text-sm font-medium rounded-lg border transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2
              ${tones[b.tone ?? 'quiet']}`}
          >
            {busyKey === b.key && <Loader2 className="w-4 h-4 animate-spin" />}
            {b.label}
          </button>
        ))}
      </div>

      {result && (
        <div
          role="status"
          className={`flex items-start gap-2 text-sm rounded-lg border px-3 py-2 ${
            result.ok
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          {result.ok
            ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
          <span>{result.message}</span>
        </div>
      )}
    </div>
  );
}
