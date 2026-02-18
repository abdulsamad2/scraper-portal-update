import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getEventById, getInventoryCountsByType } from '@/actions/eventActions';
import {
  Calendar, MapPin, ExternalLink,
  Activity, ChevronLeft, Globe, Ticket,
  Hash, Clock, Tag, Link2, TrendingUp
} from 'lucide-react';

import EventDetailActions from './EventDetailActions';
import PriceEditor from './PriceEditor';

interface EventDetailsProps {
  params: Promise<{ id: string }>;
}

interface EventType {
  _id: string;
  mapping_id: string;
  Event_ID: string;
  Event_Name: string;
  Event_DateTime: string;
  Venue?: string;
  URL: string;
  Zone?: string;
  Available_Seats?: number;
  Skip_Scraping?: boolean;
  inHandDate?: string;
  priceIncreasePercentage?: number;
  standardMarkupAdjustment?: number;
  resaleMarkupAdjustment?: number;
  Last_Updated?: string;
  createdAt?: string;
  updatedAt?: string;
  error?: string;
}

function fmt(date: string, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(date));
}

function InfoRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 py-3 border-b border-slate-100 last:border-0">
      <div className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0 text-slate-400">{icon}</div>
      <div className="w-28 shrink-0">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
      </div>
      <div className="flex-1 text-sm text-slate-800 font-medium">{children}</div>
    </div>
  );
}

export default async function EventDetailsPage({ params }: EventDetailsProps) {
  const { id } = await params;
  const event: EventType = await getEventById(id) as EventType;

  if (!event || event.error) {
    notFound();
  }

  const isActive = !event.Skip_Scraping;
  const lastUpdated = event.Last_Updated || event.updatedAt;
  const isStale = lastUpdated
    ? Date.now() - new Date(lastUpdated).getTime() > 4 * 60 * 1000
    : true;

  const pct = event.priceIncreasePercentage ?? 25;

  const stdAdj = event.standardMarkupAdjustment ?? 0;
  const resAdj = event.resaleMarkupAdjustment ?? 0;

  // Fetch standard/resale inventory counts
  const inventoryCounts = event.mapping_id
    ? await getInventoryCountsByType([event.mapping_id])
    : {};
  const standardQty = event.mapping_id ? (inventoryCounts[event.mapping_id]?.standard ?? 0) : 0;
  const resaleQty = event.mapping_id ? (inventoryCounts[event.mapping_id]?.resale ?? 0) : 0;

  return (
    <div className="space-y-6">

      {/* ── Nav bar ── */}
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/dashboard/events"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-blue-600 transition-colors rounded"
        >
          <ChevronLeft size={15} />
          Events
        </Link>
        <div className="flex items-center gap-2">
          {event.URL && (
            <a href={event.URL} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors shadow-sm">
              <Ticket size={13} />
              Ticketmaster
              <ExternalLink size={10} />
            </a>
          )}
          <EventDetailActions eventId={id} eventName={event.Event_Name} isScrapingActive={isActive} />
        </div>
      </div>

      {/* ── Event header card ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-6 relative overflow-hidden">
          <div className="absolute inset-0 bg-black/10" />
          <div className="relative">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                    isActive ? 'bg-green-500/20 text-green-100 border-green-400/30' : 'bg-white/10 text-white/60 border-white/20'
                  }`}>
                    <Activity size={10} />
                    {isActive ? 'Active' : 'Paused'}
                  </span>
                  {isStale && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-400/20 text-amber-200 border border-amber-300/30">
                      ⚠ Stale data
                    </span>
                  )}
                </div>
                <h1 className="text-2xl font-bold text-white drop-shadow-sm leading-tight">
                  {event.Event_Name}
                </h1>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm text-purple-100">
                  {event.Venue && (
                    <span className="flex items-center gap-1.5"><MapPin size={13} className="text-purple-200" />{event.Venue}</span>
                  )}
                  {event.Event_DateTime && (
                    <span className="flex items-center gap-1.5">
                      <Calendar size={13} className="text-purple-200" />
                      {fmt(event.Event_DateTime, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                      <span className="text-purple-300">·</span>
                      {fmt(event.Event_DateTime, { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

      {/* ── Stat strip ── */}
        <div className="grid grid-cols-2 sm:grid-cols-5 bg-slate-50 border-t border-slate-100 divide-x divide-slate-100">
          <div className="px-5 py-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Standard</p>
            <p className="text-2xl font-bold tabular-nums text-blue-700" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {standardQty.toLocaleString()}
            </p>
            <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-600 mt-1">S qty</span>
          </div>
          <div className="px-5 py-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Resale</p>
            <p className="text-2xl font-bold tabular-nums text-red-700" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {resaleQty.toLocaleString()}
            </p>
            <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded border border-red-200 bg-red-50 text-red-600 mt-1">R qty</span>
          </div>
          <div className="px-5 py-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Default Markup</p>
            <p className={`text-2xl font-bold tabular-nums ${
              pct > 0 ? 'text-rose-600' : pct < 0 ? 'text-blue-600' : 'text-slate-700'
            }`}>{pct > 0 ? '+' : ''}{pct}%</p>
          </div>
          <div className="px-5 py-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Standard Effective</p>
            <div className="flex items-baseline gap-1.5">
              <p className={`text-2xl font-bold tabular-nums ${
                (pct + stdAdj) > 0 ? 'text-orange-600' : 'text-slate-700'
              }`}>{(pct + stdAdj) > 0 ? '+' : ''}{pct + stdAdj}%</p>
              {stdAdj !== 0 && (
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                  stdAdj > 0 ? 'bg-orange-100 text-orange-600' : 'bg-sky-100 text-sky-600'
                }`}>{stdAdj > 0 ? '+' : ''}{stdAdj}</span>
              )}
            </div>
          </div>
          <div className="px-5 py-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Resale Effective</p>
            <div className="flex items-baseline gap-1.5">
              <p className={`text-2xl font-bold tabular-nums ${
                (pct + resAdj) > 0 ? 'text-orange-600' : 'text-slate-700'
              }`}>{(pct + resAdj) > 0 ? '+' : ''}{pct + resAdj}%</p>
              {resAdj !== 0 && (
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                  resAdj > 0 ? 'bg-orange-100 text-orange-600' : 'bg-sky-100 text-sky-600'
                }`}>{resAdj > 0 ? '+' : ''}{resAdj}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left: Details */}
        <section className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center">
              <Calendar size={14} className="text-purple-500" />
            </span>
            <h2 className="text-sm font-bold text-slate-700">Event Details</h2>
          </div>
          <dl className="px-5 py-2">
            <InfoRow icon={<Tag size={13} />} label="Event Name">
              {event.Event_Name}
            </InfoRow>
            <InfoRow icon={<MapPin size={13} />} label="Venue">
              {event.Venue || <span className="text-slate-400 font-normal">—</span>}
            </InfoRow>
            <InfoRow icon={<Calendar size={13} />} label="Date & Time">
              {event.Event_DateTime ? (
                <span>
                  {fmt(event.Event_DateTime, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                  <span className="text-slate-400 font-normal ml-2 text-xs">
                    {fmt(event.Event_DateTime, { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </span>
              ) : <span className="text-slate-400 font-normal">—</span>}
            </InfoRow>
            <InfoRow icon={<Clock size={13} />} label="In-Hand Date">
              {event.inHandDate
                ? fmt(event.inHandDate, { month: 'short', day: 'numeric', year: 'numeric' })
                : <span className="text-slate-400 font-normal">—</span>}
            </InfoRow>
            <InfoRow icon={<Tag size={13} />} label="Zone">
              <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                event.Zone && event.Zone !== 'none' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-500'
              }`}>{event.Zone || 'none'}</span>
            </InfoRow>
            <InfoRow icon={<Hash size={13} />} label="Event ID">
              <code className="text-xs bg-slate-100 px-2 py-0.5 rounded-md font-mono text-slate-600">{event.Event_ID || '—'}</code>
            </InfoRow>
            <InfoRow icon={<Hash size={13} />} label="Mapping ID">
              <code className="text-xs bg-slate-100 px-2 py-0.5 rounded-md font-mono text-slate-600">{event.mapping_id || '—'}</code>
            </InfoRow>
            <InfoRow icon={<Link2 size={13} />} label="Source URL">
              {event.URL ? (
                <a href={event.URL} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-purple-600 hover:text-purple-700 transition-colors">
                  <Globe size={11} />
                  View on Ticketmaster
                  <ExternalLink size={10} />
                </a>
              ) : <span className="text-slate-400 font-normal">—</span>}
            </InfoRow>
            <InfoRow icon={<Clock size={13} />} label="Listed">
              {event.createdAt
                ? fmt(event.createdAt, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                : <span className="text-slate-400 font-normal">—</span>}
            </InfoRow>
            <InfoRow icon={<TrendingUp size={13} />} label="Markup">
              <div className="flex flex-wrap gap-1.5">
                <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold border tabular-nums ${
                  pct > 0 ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-slate-50 border-slate-200 text-slate-500'
                }`}>Default {pct > 0 ? '+' : ''}{pct}%</span>
                <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold border tabular-nums ${
                  stdAdj > 0 ? 'bg-orange-50 border-orange-200 text-orange-700' : stdAdj < 0 ? 'bg-sky-50 border-sky-200 text-sky-700' : 'bg-slate-50 border-slate-200 text-slate-400'
                }`}>S {stdAdj > 0 ? '+' : ''}{stdAdj}% → {pct + stdAdj}%</span>
                <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold border tabular-nums ${
                  resAdj > 0 ? 'bg-orange-50 border-orange-200 text-orange-700' : resAdj < 0 ? 'bg-sky-50 border-sky-200 text-sky-700' : 'bg-slate-50 border-slate-200 text-slate-400'
                }`}>R {resAdj > 0 ? '+' : ''}{resAdj}% → {pct + resAdj}%</span>
              </div>
            </InfoRow>
          </dl>
        </section>

        {/* Right: Price editor */}
        <div className="lg:col-span-1">
          <PriceEditor
            eventId={id}
            initialPct={pct}
            initialStandardAdj={stdAdj}
            initialResaleAdj={resAdj}
          />
        </div>
      </div>
    </div>
  );
}
