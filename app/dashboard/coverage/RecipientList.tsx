'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';

/**
 * Editable list of alert recipients.
 *
 * Every row renders an input named "recipients", so the server action reads them with
 * formData.getAll('recipients') and the list needs no JSON encoding or hidden mirror field.
 * An empty row is allowed while typing and filtered out on save — otherwise clicking "Add"
 * and then saving would fail validation on a field the person had not filled in yet.
 */
export function RecipientList({ initial }: { initial: string[] }) {
  // Always show at least one row, so a fresh install has somewhere to type.
  const [rows, setRows] = useState<{ id: number; value: string }[]>(
    initial.length
      ? initial.map((value, i) => ({ id: i, value }))
      : [{ id: 0, value: '' }]
  );
  const [nextId, setNextId] = useState(initial.length || 1);

  function update(id: number, value: string) {
    setRows((r) => r.map((row) => (row.id === id ? { ...row, value } : row)));
  }

  function add() {
    setRows((r) => [...r, { id: nextId, value: '' }]);
    setNextId((n) => n + 1);
  }

  function remove(id: number) {
    // Never drop the last row — removing it would leave nothing to type into.
    setRows((r) => (r.length === 1 ? [{ id, value: '' }] : r.filter((row) => row.id !== id)));
  }

  return (
    <div>
      <span className="block text-[13px] font-medium text-slate-800 mb-2">
        Who gets the alerts
      </span>

      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={row.id} className="flex items-center gap-2">
            <input
              name="recipients"
              type="tel"
              inputMode="numeric"
              autoComplete="off"
              value={row.value}
              onChange={(e) => update(row.id, e.target.value)}
              placeholder="923001234567"
              aria-label={`Recipient ${i + 1}`}
              className="flex-1 min-w-0 px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white
                focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-400
                placeholder:text-slate-400 tabular-nums"
            />
            <button
              type="button"
              onClick={() => remove(row.id)}
              aria-label={`Remove recipient ${i + 1}`}
              className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50
                transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={add}
        className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-slate-700
          hover:text-slate-900 transition-colors"
      >
        <Plus className="w-4 h-4" /> Add another number
      </button>

      <p className="text-[13px] text-slate-500 mt-2 leading-relaxed">
        Everyone listed gets the same message. Include the country code and leave out the{' '}
        <strong>+</strong> and any leading zero — for example{' '}
        <span className="font-mono">923001234567</span>, not{' '}
        <span className="font-mono">03001234567</span>.
      </p>
    </div>
  );
}
