'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, CalendarDays, Globe, Loader, MapPin, RefreshCw, Save, Tag, Ticket } from 'lucide-react';
import { getTelechargePerformances, registerTelechargePerformances, updateEvent } from '@/actions/eventActions';
import { EventFormFields, FormField } from '@/components/ui/FormFields';
import { FormStatusMessages } from '@/components/ui/FormModes';
import { useNotifications } from '@/components/providers/NotificationProvider';
import { EVENT_TYPES } from '@/lib/venueToSport';
import {
  canonicalTelechargeUrl,
  formatPerformance,
  isTelechargeUrl,
  perfTypeLabel,
  TELECHARGE_STATUS_LABELS,
  type TelechargePerformanceOption,
  type TelechargeShowInfo,
} from '@/lib/telecharge';

/**
 * Add / edit Telecharge performances.
 *
 * Paste a show URL and the form loads every performance Telecharge has on sale
 * (asked of the Telecharge scraper, which also proves the URL is a real show).
 * Tick the dates and times to track — or Select all — and each one is saved as
 * its own event, with its own in-hand date and required mapping ID. Times can
 * only be picked from the show's calendar, and the server checks them again.
 *
 * Editing moves a performance to another on-sale date/time of the same show.
 */

type FormState = 'idle' | 'submitting' | 'success' | 'error';

type Lookup =
  | { status: 'idle' }
  | { status: 'loading'; url: string }
  | { status: 'loaded'; url: string; show: TelechargeShowInfo; performances: TelechargePerformanceOption[] }
  | { status: 'error'; url: string; error: string };

interface Selection {
  inHandDate: string; // YYYY-MM-DD
  mapping_id: string;
}

interface TelechargeRow {
  _id: string;
  URL?: string;
  Event_Name?: string;
  Event_ID?: string;
  Venue?: string;
  Event_DateTime?: string;
  inHandDate?: string;
  mapping_id?: string;
  Zone?: string;
  Skip_Scraping?: boolean;
  priceIncreasePercentage?: number;
  standardMarkupAdjustment?: number;
  eventType?: string | null;
  telecharge?: { status?: string; lastError?: string | null; perfKey?: number; productId?: number; theatre?: string };
}

const toIso = (value?: string) => (value ? new Date(value).toISOString() : '');
const toDateInput = (iso?: string) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');

/** The Ticketmaster form's default: the day before the performance. */
function dayBefore(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const inputClass =
  'w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white disabled:bg-gray-50';

export default function TelechargeEventForm({
  mode,
  initialData,
  initialUrl,
  onLeaveTelecharge,
  onCancel,
  onSuccess,
}: {
  mode: 'create' | 'edit';
  initialData?: TelechargeRow | null;
  /** Prefill the show URL (e.g. pasted on the general Add Event page). */
  initialUrl?: string;
  /** Called when the URL is changed to something that is not Telecharge. */
  onLeaveTelecharge?: (url: string) => void;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const notifications = useNotifications();
  const isEdit = mode === 'edit' && !!initialData?._id;

  const [url, setUrl] = useState(initialData?.URL || initialUrl || '');
  const [urlTouched, setUrlTouched] = useState(false);
  const [eventName, setEventName] = useState(initialData?.Event_Name || '');
  const [zone, setZone] = useState(initialData?.Zone || 'none');
  const [eventType, setEventType] = useState(initialData?.eventType || '');
  const [markup, setMarkup] = useState<number>(initialData?.priceIncreasePercentage ?? 35);
  const [stdAdj, setStdAdj] = useState<number>(initialData?.standardMarkupAdjustment ?? 0);
  const [paused, setPaused] = useState<boolean>(initialData?.Skip_Scraping ?? true);
  const [state, setState] = useState<FormState>('idle');
  const [error, setError] = useState('');

  const [lookup, setLookup] = useState<Lookup>({ status: 'idle' });
  // Create: every ticked performance, keyed by its ISO date/time.
  const [selected, setSelected] = useState<Map<string, Selection>>(new Map());
  // Edit: the one performance this row tracks.
  const [editWhen, setEditWhen] = useState(toIso(initialData?.Event_DateTime));
  const [editInHand, setEditInHand] = useState(toDateInput(initialData?.inHandDate));
  const [editMapping, setEditMapping] = useState(initialData?.mapping_id || '');

  const submitting = state === 'submitting';
  const urlValid = isTelechargeUrl(url);
  const canonicalUrl = canonicalTelechargeUrl(url);

  const requestId = useRef(0);
  const loadPerformances = useCallback(async (target: string) => {
    const id = ++requestId.current;
    setLookup({ status: 'loading', url: target });
    try {
      const result = await getTelechargePerformances(target);
      if (id !== requestId.current) return;
      if ('error' in result) setLookup({ status: 'error', url: target, error: result.error });
      else setLookup({ status: 'loaded', url: target, show: result.show, performances: result.performances });
    } catch (e) {
      if (id !== requestId.current) return;
      setLookup({ status: 'error', url: target, error: (e as Error).message || 'Could not load performances' });
    }
  }, []);

  // Load the calendar as soon as the URL is a Telecharge show URL: straight away
  // for a URL the form opened with, after a pause in typing otherwise.
  const firstLoad = useRef(true);
  useEffect(() => {
    const immediate = firstLoad.current;
    firstLoad.current = false;
    if (!canonicalUrl) {
      requestId.current++;
      setLookup({ status: 'idle' });
      return;
    }
    if (lookup.status !== 'idle' && 'url' in lookup && lookup.url === canonicalUrl) return;
    const t = setTimeout(() => loadPerformances(canonicalUrl), immediate ? 0 : 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonicalUrl]);

  // A different show invalidates what was ticked.
  useEffect(() => {
    if (!isEdit) setSelected(new Map());
  }, [canonicalUrl, isEdit]);

  const show = lookup.status === 'loaded' ? lookup.show : null;
  const performances = useMemo(() => (lookup.status === 'loaded' ? lookup.performances : []), [lookup]);
  const selectable = useMemo(() => performances.filter((p) => !p.tracked), [performances]);

  /** Performances grouped by calendar day, each time a separate row. */
  const days = useMemo(() => {
    const byDay = new Map<string, TelechargePerformanceOption[]>();
    for (const p of performances) {
      const day = p.Event_DateTime.slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(p);
    }
    return [...byDay.entries()];
  }, [performances]);

  const toggle = (perfs: TelechargePerformanceOption[], on: boolean) =>
    setSelected((prev) => {
      const next = new Map(prev);
      for (const p of perfs) {
        if (p.tracked) continue;
        if (on && !next.has(p.Event_DateTime)) next.set(p.Event_DateTime, { inHandDate: dayBefore(p.Event_DateTime), mapping_id: '' });
        if (!on) next.delete(p.Event_DateTime);
      }
      return next;
    });

  const patchSelection = (iso: string, patch: Partial<Selection>) =>
    setSelected((prev) => {
      const cur = prev.get(iso);
      if (!cur) return prev;
      return new Map(prev).set(iso, { ...cur, ...patch });
    });

  const handleUrlChange = (value: string) => {
    setUrl(value);
    if (onLeaveTelecharge && !/telecharge/i.test(value)) onLeaveTelecharge(value);
  };

  // --- Validation ------------------------------------------------------------
  const selectionErrors = useMemo(() => {
    const errors: string[] = [];
    const seen = new Set<string>();
    for (const [iso, s] of selected) {
      if (!s.inHandDate) errors.push(`${formatPerformance(iso)}: pick an in-hand date`);
      const m = s.mapping_id.trim();
      if (!m) {
        errors.push(`${formatPerformance(iso)}: enter a mapping ID`);
        continue;
      }
      if (seen.has(m)) errors.push(`Mapping ID ${m} is used twice`);
      seen.add(m);
    }
    return errors;
  }, [selected]);

  const editOnSale = performances.some((p) => p.Event_DateTime === editWhen);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUrlTouched(true);

    if (!urlValid) return setError('Enter a Telecharge show URL, e.g. https://www.telecharge.com/Show-Name-Tickets');
    if (!(markup >= 0)) return setError('Markup percentage must be 0 or greater');
    if (isEdit) {
      if (!editWhen) return setError('Pick a performance');
      if (!editInHand) return setError('Pick an in-hand date');
      if (!editMapping.trim()) return setError('Enter a mapping ID');
    } else {
      if (lookup.status === 'loading') return setError('Still loading performances from Telecharge…');
      if (lookup.status !== 'loaded') return setError(lookup.status === 'error' ? lookup.error : 'Load the show’s performances first');
      if (!selected.size) return setError('Tick at least one performance to track');
      if (selectionErrors.length) return setError(selectionErrors[0]);
    }

    setState('submitting');
    setError('');

    const shared = {
      URL: show?.url || canonicalUrl || url.trim(),
      Event_Name: eventName.trim() || undefined,
      Zone: zone || 'none',
      eventType: eventType || null,
      priceIncreasePercentage: markup,
      standardMarkupAdjustment: stdAdj,
      Skip_Scraping: paused,
    };

    try {
      let message: string;
      if (isEdit) {
        const result = await updateEvent(initialData!._id, {
          ...shared,
          URL: initialData?.URL,
          Event_DateTime: editWhen,
          inHandDate: editInHand,
          mapping_id: editMapping.trim(),
        } as never);
        if ((result as { error?: string })?.error) throw new Error((result as { error: string }).error);
        message = 'Telecharge event updated!';
      } else {
        const result = await registerTelechargePerformances({
          ...shared,
          performances: [...selected.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([Event_DateTime, s]) => ({ Event_DateTime, inHandDate: s.inHandDate, mapping_id: s.mapping_id.trim() })),
        });
        if ('error' in result) throw new Error(result.error);
        const n = result.created.length;
        message = `${n} performance${n === 1 ? '' : 's'} added as separate events${paused ? ' (paused)' : ' — scraping starts within a couple of minutes'}`;
      }
      setState('success');
      notifications.actions.showNotification('success', message);
      setTimeout(() => onSuccess(), 1500);
    } catch (err) {
      setError((err as Error).message || 'An unexpected error occurred');
      setState('error');
    }
  };

  const status = initialData?.telecharge?.status;
  const selectedCount = selected.size;
  const allSelected = selectable.length > 0 && selectable.every((p) => selected.has(p.Event_DateTime));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-white p-4 rounded-lg shadow">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 p-2 rounded-lg hover:bg-gray-100 transition-colors"
            title="Back to events"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-800 flex items-center gap-2">
              <Ticket className="w-6 h-6 text-rose-600" aria-hidden="true" />
              {isEdit ? 'Edit Telecharge Event' : 'Add Telecharge Event'}
            </h1>
            <p className="text-sm text-gray-500">
              {isEdit ? 'Update this performance' : 'Pick the Broadway performances to track — each date & time becomes its own event'}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-lg p-6">
        {error && <FormStatusMessages.Error message={error} />}
        {state === 'success' && <FormStatusMessages.Success message={isEdit ? 'Telecharge event updated!' : 'Performances added!'} />}

        {isEdit && (
          <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
            <div>
              <div className="text-xs text-gray-500">Scraper status</div>
              <div className={`font-semibold ${status === 'active' ? 'text-green-700' : status === 'pending' || !status ? 'text-gray-700' : 'text-amber-700'}`}>
                {TELECHARGE_STATUS_LABELS[status || 'pending'] || status}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Event ID</div>
              <div className="font-mono text-gray-800">{initialData?.Event_ID || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Theatre</div>
              <div className="text-gray-800">{initialData?.Venue || initialData?.telecharge?.theatre || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Telecharge perfKey</div>
              <div className="font-mono text-gray-800">{initialData?.telecharge?.perfKey ?? '—'}</div>
            </div>
            {initialData?.telecharge?.lastError && (
              <div className="col-span-2 md:col-span-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                {initialData.telecharge.lastError}
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6" noValidate>
          {/* Show URL + what Telecharge says about it */}
          <div>
            <FormField.Root>
              <FormField.Label htmlFor="tele-url" required>Show URL</FormField.Label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <FormField.Input
                    id="tele-url"
                    name="URL"
                    type="url"
                    value={url}
                    // Status only changes on blur or when a lookup finishes: the
                    // input remounts on a status change and would drop focus mid-typing.
                    status={lookup.status === 'loaded' ? 'valid' : lookup.status === 'error' || (urlTouched && !urlValid) ? 'invalid' : 'untouched'}
                    error={!urlValid ? 'Enter a Telecharge show page, e.g. https://www.telecharge.com/Show-Name-Tickets' : undefined}
                    onChange={(e) => handleUrlChange(e.target.value)}
                    onBlur={() => setUrlTouched(true)}
                    // Arriving from the general Add Event page mid-typing: keep the caret in the field.
                    autoFocus={Boolean(initialUrl)}
                    onFocus={(e) => {
                      const end = e.target.value.length;
                      try {
                        e.target.setSelectionRange(end, end);
                      } catch {
                        // type="url" inputs do not support selection in every browser.
                      }
                    }}
                    disabled={submitting || isEdit}
                    placeholder="https://www.telecharge.com/The-Outsiders-Tickets"
                    icon={<Globe className="h-5 w-5 text-gray-400" />}
                  />
                </div>
                {!isEdit && (
                  <button
                    type="button"
                    onClick={() => canonicalUrl && loadPerformances(canonicalUrl)}
                    disabled={!canonicalUrl || lookup.status === 'loading' || submitting}
                    className="inline-flex items-center gap-2 self-start px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50"
                    title="Load the show's performances from Telecharge"
                  >
                    <RefreshCw className={`w-4 h-4 ${lookup.status === 'loading' ? 'animate-spin' : ''}`} />
                    {lookup.status === 'loaded' ? 'Reload' : 'Load'}
                  </button>
                )}
              </div>
              <FormField.Help>
                {isEdit
                  ? 'The show cannot be changed — add a new event for a different show.'
                  : 'Open the show on telecharge.com and copy its URL. Its performances load automatically.'}
              </FormField.Help>
            </FormField.Root>

            {lookup.status === 'loading' && (
              <div className="mt-3 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                <Loader className="w-4 h-4 animate-spin" /> Checking the show on Telecharge… this usually takes a few seconds.
              </div>
            )}
            {lookup.status === 'error' && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {lookup.error}
              </div>
            )}
            {show && (
              <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
                <span className="font-semibold">{show.title || show.slug}</span>
                {show.theatre && (
                  <span className="inline-flex items-center gap-1"><MapPin className="w-4 h-4" /> {show.theatre}</span>
                )}
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="w-4 h-4" /> {performances.length} performance{performances.length === 1 ? '' : 's'} on sale
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FormField.Root>
              <FormField.Label htmlFor="tele-name">Event Name</FormField.Label>
              <FormField.Input
                id="tele-name"
                name="Event_Name"
                type="text"
                value={eventName}
                status="untouched"
                onChange={(e) => setEventName(e.target.value)}
                disabled={submitting}
                placeholder={show?.title || 'Filled in from Telecharge if left blank'}
                icon={<Tag className="h-5 w-5 text-gray-400" />}
              />
            </FormField.Root>

            <FormField.Root>
              <FormField.Label htmlFor="tele-type">Event Type</FormField.Label>
              <select
                id="tele-type"
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
                disabled={submitting}
                className="w-full px-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white disabled:bg-gray-50"
              >
                <option value="">None</option>
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <FormField.Help>Optional — only used for filtering</FormField.Help>
            </FormField.Root>
          </div>

          {/* Performances */}
          {isEdit ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <FormField.Root>
                <FormField.Label htmlFor="edit-perf" required>Performance</FormField.Label>
                <select
                  id="edit-perf"
                  value={editWhen}
                  onChange={(e) => {
                    setEditWhen(e.target.value);
                    setEditInHand(dayBefore(e.target.value));
                  }}
                  disabled={submitting || lookup.status !== 'loaded'}
                  className="w-full px-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white disabled:bg-gray-100"
                >
                  {editWhen && !editOnSale && (
                    <option value={editWhen}>{formatPerformance(editWhen)} (current — not on sale)</option>
                  )}
                  {performances.map((p) => (
                    <option key={p.Event_DateTime} value={p.Event_DateTime} disabled={p.tracked && p.Event_DateTime !== toIso(initialData?.Event_DateTime)}>
                      {formatPerformance(p.Event_DateTime)}
                      {p.perfType ? ` · ${perfTypeLabel(p.perfType)}` : ''}
                      {p.soldOut ? ' · Sold out' : ''}
                      {p.tracked && p.Event_DateTime !== toIso(initialData?.Event_DateTime) ? ' · already added' : ''}
                    </option>
                  ))}
                </select>
                <FormField.Help>
                  {lookup.status === 'loading' ? 'Loading the show’s performances…' : 'Only dates & times Telecharge has on sale'}
                </FormField.Help>
              </FormField.Root>
              <FormField.Root>
                <FormField.Label htmlFor="edit-inhand" required>In-Hand Date</FormField.Label>
                <input id="edit-inhand" type="date" value={editInHand} onChange={(e) => setEditInHand(e.target.value)} disabled={submitting} className={inputClass} />
                <FormField.Help>Defaults to the day before</FormField.Help>
              </FormField.Root>
              <FormField.Root>
                <FormField.Label htmlFor="edit-mapping" required>Event Mapping ID</FormField.Label>
                <input id="edit-mapping" type="text" value={editMapping} onChange={(e) => setEditMapping(e.target.value)} disabled={submitting} placeholder="Mapping ID" className={`${inputClass} ${editMapping.trim() ? '' : 'border-red-400'}`} />
                <FormField.Help>Used to join this event into the CSV</FormField.Help>
              </FormField.Root>
            </div>
          ) : (
            lookup.status === 'loaded' && (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="text-sm font-medium text-gray-700">
                    Performances<span className="text-red-500 ml-1">*</span>
                    <span className="ml-2 font-normal text-gray-500">
                      {selectedCount} selected · each becomes a separate event
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <button
                      type="button"
                      onClick={() => toggle(selectable.filter((p) => !p.soldOut), true)}
                      disabled={submitting || allSelected || !selectable.length}
                      className="font-medium text-blue-600 hover:text-blue-800 disabled:opacity-40"
                    >
                      Select all times ({selectable.filter((p) => !p.soldOut).length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelected(new Map())}
                      disabled={submitting || !selectedCount}
                      className="font-medium text-gray-600 hover:text-gray-900 disabled:opacity-40"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {performances.length === 0 ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Telecharge has no performances on sale for this show right now.
                  </div>
                ) : (
                  <div className="max-h-[32rem] overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-200">
                    {days.map(([day, perfs]) => {
                      const open = perfs.filter((p) => !p.tracked);
                      const dayAll = open.length > 0 && open.every((p) => selected.has(p.Event_DateTime));
                      return (
                        <div key={day}>
                          <label className="sticky top-0 z-10 flex items-center gap-3 bg-gray-100 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-gray-300 text-blue-600"
                              checked={dayAll}
                              disabled={submitting || !open.length}
                              onChange={(e) => toggle(open, e.target.checked)}
                            />
                            {formatPerformance(perfs[0].Event_DateTime, 'date')}
                          </label>
                          {perfs.map((p) => {
                            const sel = selected.get(p.Event_DateTime);
                            return (
                              <div
                                key={p.Event_DateTime}
                                className={`grid grid-cols-1 md:grid-cols-[minmax(12rem,1fr)_10rem_12rem] items-center gap-2 px-3 py-2 ${sel ? 'bg-blue-50/60' : p.tracked ? 'bg-gray-50' : 'bg-white'}`}
                              >
                                <label className={`flex items-center gap-3 text-sm ${p.tracked ? 'text-gray-400' : 'text-gray-800 cursor-pointer'}`}>
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                                    checked={Boolean(sel)}
                                    disabled={submitting || p.tracked}
                                    onChange={(e) => toggle([p], e.target.checked)}
                                  />
                                  <span className="font-medium w-16">{formatPerformance(p.Event_DateTime, 'time')}</span>
                                  {p.perfType && <span className="text-xs text-gray-500">{perfTypeLabel(p.perfType)}</span>}
                                  {p.soldOut && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">Sold out</span>}
                                  {p.tracked && <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600">Already added</span>}
                                </label>
                                {sel && (
                                  <>
                                    <input
                                      type="date"
                                      aria-label={`In-hand date for ${formatPerformance(p.Event_DateTime)}`}
                                      title="In-hand date"
                                      value={sel.inHandDate}
                                      onChange={(e) => patchSelection(p.Event_DateTime, { inHandDate: e.target.value })}
                                      disabled={submitting}
                                      className={`${inputClass} ${sel.inHandDate ? '' : 'border-red-400'}`}
                                    />
                                    <input
                                      type="text"
                                      aria-label={`Mapping ID for ${formatPerformance(p.Event_DateTime)}`}
                                      value={sel.mapping_id}
                                      onChange={(e) => patchSelection(p.Event_DateTime, { mapping_id: e.target.value })}
                                      disabled={submitting}
                                      placeholder="Mapping ID"
                                      className={`${inputClass} ${sel.mapping_id.trim() ? '' : 'border-red-400'}`}
                                    />
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  In-hand date defaults to the day before. Every performance needs its own mapping ID. “Select all times” skips sold-out performances.
                </p>
              </div>
            )
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <EventFormFields.Zone
              name="Zone"
              value={zone}
              status="untouched"
              onChange={(e) => setZone(e.target.value)}
              onBlur={() => {}}
              disabled={submitting}
            />
            <EventFormFields.PriceIncrease
              name="priceIncreasePercentage"
              value={markup as never}
              status={markup >= 0 ? 'untouched' : 'invalid'}
              error="Please enter a valid percentage (0 or greater)"
              onChange={(e) => setMarkup(Number(e.target.value))}
              onBlur={() => {}}
              disabled={submitting}
            />
            <EventFormFields.MarkupAdjustments
              standardAdj={stdAdj}
              defaultPct={markup}
              onStandardChange={setStdAdj}
              disabled={submitting}
              standardOnly
            />
            <EventFormFields.SkipScraping
              name="Skip_Scraping"
              checked={paused}
              onChange={(e) => setPaused(e.target.checked)}
              disabled={submitting}
            />
          </div>

          <div className="flex items-center justify-end space-x-4 pt-4 border-t mt-6">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || (!isEdit && (lookup.status !== 'loaded' || !selectedCount))}
              className={`flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:opacity-60 ${submitting ? 'cursor-not-allowed' : ''}`}
            >
              {submitting ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  {isEdit ? 'Updating...' : 'Adding...'}
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  {isEdit
                    ? 'Update Event'
                    : selectedCount
                      ? `Start Tracking ${selectedCount} Performance${selectedCount === 1 ? '' : 's'}`
                      : 'Start Tracking'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
