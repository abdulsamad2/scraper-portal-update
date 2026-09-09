'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

/**
 * Sending-number field with a clear button.
 *
 * Controlled rather than a plain defaultValue input, purely so the clear button has
 * something to empty. Clearing only blanks the field — nothing is written until Save, which
 * keeps every change on this form committed by the same explicit action instead of some
 * edits applying instantly and others not.
 */
export function SenderNumberField({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);

  return (
    <div>
      <label htmlFor="senderNumber" className="block text-[13px] font-medium text-slate-800 mb-2">
        Sending number
      </label>

      <div className="flex items-center gap-2">
        <input
          id="senderNumber"
          name="senderNumber"
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="923001234567"
          className="flex-1 min-w-0 px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white
            focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-400
            placeholder:text-slate-400 tabular-nums"
        />
        <button
          type="button"
          onClick={() => setValue('')}
          disabled={!value}
          aria-label="Clear sending number"
          title="Clear sending number"
          className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50
            disabled:opacity-30 disabled:hover:text-slate-400 disabled:hover:bg-transparent
            transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <p className="text-[13px] text-slate-500 mt-2 leading-relaxed">
        The WhatsApp account messages are sent <em>from</em> — the phone you scan the code with.
        Recording it here means you are warned if a different phone gets connected by mistake.
        Leave it empty to skip that check.
      </p>
    </div>
  );
}
