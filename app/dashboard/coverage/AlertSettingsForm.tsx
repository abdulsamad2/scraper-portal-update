'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { CheckCircle2, AlertTriangle, Loader2, Save } from 'lucide-react';
import { saveAlertSettingsAction } from './actions';
import { RecipientList } from './RecipientList';
import { SenderNumberField } from './SenderNumberField';
import type { ActionResult } from './actions';

/**
 * Alert settings, editable in place.
 *
 * A plain <form> bound to a server action, so it submits and re-renders through the server
 * like the rest of the page — no client-side fetch, and the saved values are read back from
 * the database rather than trusted from local state.
 *
 * The three timing rules sit together in one group and read as sentences. The reminder
 * interval used to be its own labelled field in a narrow column, which both wrapped its
 * help text awkwardly and separated a number from the thresholds that give it meaning.
 */
export function AlertSettingsForm({
  enabled, recipients, senderNumber, repeatMinutes, minSpareUnits,
  staleEventCount, staleEventMinutes, source,
}: {
  enabled: boolean;
  recipients: string[];
  senderNumber: string;
  repeatMinutes: number;
  minSpareUnits: number;
  staleEventCount: number;
  staleEventMinutes: number;
  source: 'saved' | 'environment';
}) {
  const [result, formAction] = useActionState<ActionResult | null, FormData>(
    saveAlertSettingsAction,
    null
  );

  return (
    <form action={formAction} className="space-y-6">
      <SenderNumberField initial={senderNumber} />

      <RecipientList initial={recipients} />

      <fieldset className="rounded-xl border border-slate-200 px-5 pt-4 pb-5">
        <legend className="text-[13px] font-medium text-slate-800 px-2">Tell me when</legend>

        <div className="space-y-3.5 text-sm text-slate-800">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span>spare capacity drops to</span>
            <Num name="minSpareUnits" defaultValue={minSpareUnits} min={0} max={500} label="Spare units threshold" />
            <span>units or fewer</span>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <Num name="staleEventCount" defaultValue={staleEventCount} min={1} max={10000} label="Stale event count" />
            <span>or more events have not updated in</span>
            <Num name="staleEventMinutes" defaultValue={staleEventMinutes} min={1} max={1440} label="Stale event minutes" />
            <span>minutes</span>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <span>and remind me every</span>
            <Num name="repeatMinutes" defaultValue={repeatMinutes} min={5} max={1440} label="Reminder interval" />
            <span>minutes while it continues</span>
          </div>
        </div>

        <p className="text-[13px] text-slate-500 mt-4 leading-relaxed">
          You are messaged as soon as either happens, and once more when it clears. Nothing is
          sent while everything is fine.
        </p>
      </fieldset>

      <label className="flex items-start gap-2.5 cursor-pointer select-none">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={enabled}
          className="mt-0.5 w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
        />
        <span className="text-sm text-slate-800">
          Send me alerts
          <span className="block text-[13px] text-slate-500 mt-0.5">
            Turn this off to stop messages without losing the numbers.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-3 flex-wrap">
        <SaveButton />
        {source === 'environment' && (
          <span className="text-[13px] text-slate-500">
            Using the server default. Saving stores these settings here instead.
          </span>
        )}
      </div>

      {result && (
        <div
          role="status"
          className={`flex items-start gap-2 text-sm rounded-xl px-3.5 py-3 ${
            result.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'
          }`}
          style={{ boxShadow: `inset 0 0 0 1px ${result.ok ? '#c9e5c9' : '#f0c4c4'}` }}
        >
          {result.ok
            ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
          <span>{result.message}</span>
        </div>
      )}
    </form>
  );
}

/** Inline number input sized to its content, so the rule sentences stay readable. */
function Num({
  name, defaultValue, min, max, label,
}: {
  name: string; defaultValue: number; min: number; max: number; label: string;
}) {
  return (
    <input
      name={name}
      type="number"
      min={min}
      max={max}
      defaultValue={defaultValue}
      aria-label={label}
      className="w-[74px] px-2.5 py-1.5 text-sm rounded-lg border border-slate-300 bg-white
        focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-400 tabular-nums"
    />
  );
}

function SaveButton() {
  // useFormStatus must be read from a child of the form to see the pending state.
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 text-sm font-medium rounded-lg bg-[#101418] text-white
        hover:bg-[#232a32] disabled:opacity-50 disabled:cursor-not-allowed
        flex items-center gap-2 transition-colors"
    >
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
      Save
    </button>
  );
}
