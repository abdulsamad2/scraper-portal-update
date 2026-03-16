'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  BarChart3, TrendingUp, RefreshCw, Search,
  AlertTriangle, CheckCircle, XCircle, DollarSign, Clock,
  Target, Pencil, Save, X, ExternalLink,
  Link as LinkIcon, ChevronLeft, Calendar, MapPin,
  Zap, Award, ShieldAlert,
} from 'lucide-react';
import { saveStubHubUrl, toggleStubHubPricing, toggleStubHubEnabled } from '@/actions/stubhubActions';
import type { ComparisonRow, EventSummary } from '@/actions/stubhubActions';

/* ═══════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════ */
const $c = (n: number) => '$' + n.toFixed(2);

function scrapeFreshness(iso: string | null | undefined): { label: string; color: string } {
  if (!iso) return { label: 'Never', color: 'text-gray-400' };
  const mins = (Date.now() - new Date(iso).getTime()) / 60000;
  if (mins < 5)  return { label: 'Live',                    color: 'text-emerald-600' };
  if (mins < 30) return { label: `${Math.floor(mins)}m ago`, color: 'text-amber-600' };
  const h = Math.floor(mins / 60);
  if (h < 24)    return { label: `${h}h ago`,               color: 'text-orange-500' };
  return           { label: `${Math.floor(h / 24)}d ago`,   color: 'text-red-500' };
}

/* ─── Pricing status config ─── */
type PricingStatus = ComparisonRow['pricingStatus'];
type SortField = 'section' | 'row' | 'seatCount' | 'ourPrice' | 'ourCost' | 'sectionLowest' | 'sectionAvg' | 'priceDiff' | 'margin' | 'pricingStatus' | 'pricePosition' | 'sectionCount';

const statusCfg: Record<PricingStatus, {
  label: string; bg: string; text: string; border: string; icon: React.ElementType;
}> = {
  OVERPRICED:       { label: 'Overpriced',     bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-l-red-500',    icon: TrendingUp },
  AT_FLOOR:         { label: 'At Floor',       bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-l-amber-500',  icon: ShieldAlert },
  COMPETITIVE:      { label: 'Competitive',    bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-l-emerald-500', icon: CheckCircle },
  BELOW_MARKET:     { label: 'Below Market',   bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-l-blue-500',   icon: TrendingUp },
  NO_COMPETITION:   { label: 'No Competition', bg: 'bg-gray-50',   text: 'text-gray-500',   border: 'border-l-gray-300',   icon: XCircle },
  NO_OUR_INVENTORY: { label: 'No Inventory',   bg: 'bg-blue-50',   text: 'text-blue-600',   border: 'border-l-blue-400',   icon: Target },
};

/* ═══════════════════════════════════════════════════════
   TABLE HEADER
   ═══════════════════════════════════════════════════════ */
function TH({ title, tip, field, sortBy, sortDir, onSort, className = '' }: {
  title: string; tip: string;
  field?: SortField; sortBy?: SortField; sortDir?: 'asc' | 'desc';
  onSort?: (f: SortField) => void; className?: string;
}) {
  const sortable = !!field && !!onSort;
  const active = sortBy === field;
  return (
    <th className={`px-4 py-3 bg-white/50 backdrop-blur-sm border-r border-gray-200/40 last:border-r-0 ${className}`}>
      <div className="group relative flex items-center">
        <div className={`flex items-center whitespace-nowrap ${sortable ? 'cursor-pointer' : ''}`}
          onClick={sortable ? () => onSort!(field!) : undefined}>
          <span className={`font-bold text-[11px] uppercase tracking-wider ${active ? 'text-blue-600' : 'text-gray-600'} group-hover:text-blue-700`}>{title}</span>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="ml-1 h-3 w-3 text-gray-400">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
          </svg>
          {sortable && (
            active ? (
              sortDir === 'asc'
                ? <svg className="w-3 h-3 ml-0.5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7"/></svg>
                : <svg className="w-3 h-3 ml-0.5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
            ) : (
              <svg className="w-3 h-3 ml-0.5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/></svg>
            )
          )}
        </div>
        <div className="absolute bottom-full left-1/2 z-20 mb-2 w-56 -translate-x-1/2 rounded-lg bg-gray-800 p-2.5 text-center text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-xl">
          {tip}
        </div>
      </div>
    </th>
  );
}

/* ─── Price position bar ─── */
function PriceBar({ position }: { position: number }) {
  const c = Math.max(0, Math.min(100, position));
  const col = c <= 30 ? 'bg-emerald-500' : c <= 65 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-14 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${col}`} style={{ width: `${c}%` }} />
      </div>
      <span className={`text-[11px] font-medium ${c <= 30 ? 'text-emerald-700' : c <= 65 ? 'text-amber-700' : 'text-red-700'}`}>{c}%</span>
    </div>
  );
}

/* ─── Badge pill ─── */
function BadgePill({ achievable, name }: { achievable: boolean; name?: string | null }) {
  if (!achievable) return <span className="text-[10px] text-gray-400">No</span>;
  if (name) return <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-yellow-100 text-yellow-700 border border-yellow-200"><Award className="w-2.5 h-2.5" /> {name}</span>;
  return <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-600 border border-emerald-200">Achievable</span>;
}

/* ═══════════════════════════════════════════════════════
   KEY INSIGHTS
   ═══════════════════════════════════════════════════════ */
function KeyInsights({ rows, summary }: { rows: ComparisonRow[]; summary: EventSummary }) {
  const topOverpriced = rows.filter(r => r.pricingStatus === 'OVERPRICED').sort((a, b) => (b.priceDiff ?? 0) - (a.priceDiff ?? 0)).slice(0, 3);
  const floorRows = rows.filter(r => r.pricingStatus === 'AT_FLOOR');
  const badgeRows = rows.filter(r => r.badgeAchievable);

  const items: Array<{ icon: React.ReactNode; title: string; body: string; color: string }> = [];

  if (summary.potentialRevenueLoss > 0) {
    items.push({
      icon: <AlertTriangle className="w-4 h-4 text-red-500" />,
      title: `${summary.overpriced} overpriced group${summary.overpriced > 1 ? 's' : ''} - ${$c(summary.potentialRevenueLoss)} revenue at risk`,
      body: topOverpriced.map(r =>
        `Sec ${r.section} Row ${r.row}: +${$c(r.priceDiff!)} above SH lowest${r.suggestedPrice ? ` -> suggest ${$c(r.suggestedPrice)}` : ''}`
      ).join(' | '),
      color: 'border-red-200 bg-red-50',
    });
  }
  if (floorRows.length > 0) {
    items.push({
      icon: <ShieldAlert className="w-4 h-4 text-amber-500" />,
      title: `${floorRows.length} group${floorRows.length > 1 ? 's' : ''} protected by floor`,
      body: 'Market price is below your floor (cost x 1.22). These are listed at the minimum profitable price.',
      color: 'border-amber-200 bg-amber-50',
    });
  }
  if (badgeRows.length > 0) {
    items.push({
      icon: <Award className="w-4 h-4 text-yellow-600" />,
      title: `${badgeRows.length} Best Deal badge${badgeRows.length > 1 ? 's' : ''} achievable`,
      body: badgeRows.slice(0, 3).map(r => `Sec ${r.section} Row ${r.row}${r.suggestedPrice ? ` at ${$c(r.suggestedPrice)}` : ''}`).join(' | '),
      color: 'border-yellow-200 bg-yellow-50',
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {items.map((item, i) => (
        <div key={i} className={`rounded-lg border p-3.5 ${item.color}`}>
          <div className="flex items-center gap-2 mb-1">
            {item.icon}
            <span className="text-sm font-semibold text-gray-800">{item.title}</span>
          </div>
          <p className="text-xs text-gray-600 leading-relaxed">{item.body}</p>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   COMPARISON TABLE
   ═══════════════════════════════════════════════════════ */
function ComparisonTable({ rows }: { rows: ComparisonRow[] }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState<SortField>('section');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const handleSort = (f: SortField) => {
    if (sortBy === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(f); setSortDir('asc'); }
  };

  const filtered = rows
    .filter(r => {
      if (statusFilter !== 'ALL' && r.pricingStatus !== statusFilter) return false;
      if (search) {
        const t = search.toLowerCase();
        return r.section.toLowerCase().includes(t) || r.row.toLowerCase().includes(t) || r.seatRange.toLowerCase().includes(t);
      }
      return true;
    })
    .sort((a, b) => {
      const d = sortDir === 'asc' ? 1 : -1;
      switch (sortBy) {
        case 'ourPrice':      return (a.ourPrice - b.ourPrice) * d;
        case 'ourCost':       return (a.ourCost  - b.ourCost)  * d;
        case 'sectionLowest': return ((a.sectionLowest ?? 0) - (b.sectionLowest ?? 0)) * d;
        case 'sectionAvg':    return ((a.sectionAvg    ?? 0) - (b.sectionAvg    ?? 0)) * d;
        case 'priceDiff':     return ((a.priceDiff     ?? 0) - (b.priceDiff     ?? 0)) * d;
        case 'margin':        return ((a.margin        ?? 0) - (b.margin        ?? 0)) * d;
        case 'seatCount':     return (a.seatCount - b.seatCount) * d;
        case 'row':           return a.row.localeCompare(b.row, undefined, { numeric: true }) * d;
        case 'pricingStatus': return a.pricingStatus.localeCompare(b.pricingStatus) * d;
        case 'pricePosition': return ((a.pricePosition ?? -1) - (b.pricePosition ?? -1)) * d;
        case 'sectionCount':  return (a.sectionCount - b.sectionCount) * d;
        default: {
          const s = a.section.localeCompare(b.section, undefined, { numeric: true });
          return s !== 0 ? s * d : a.row.localeCompare(b.row, undefined, { numeric: true }) * d;
        }
      }
    });

  const statusOrder: PricingStatus[] = ['OVERPRICED', 'AT_FLOOR', 'COMPETITIVE', 'BELOW_MARKET', 'NO_COMPETITION', 'NO_OUR_INVENTORY'];

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Section, row, seats..." value={search} onChange={e => setSearch(e.target.value)}
            className="border rounded-lg pl-9 pr-3 py-2 w-52 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white shadow-sm" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => setStatusFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${statusFilter === 'ALL' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}>
            All ({rows.length})
          </button>
          {statusOrder.map(st => {
            const count = rows.filter(r => r.pricingStatus === st).length;
            if (count === 0) return null;
            const cfg = statusCfg[st];
            return (
              <button key={st} onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${statusFilter === st ? 'bg-blue-600 text-white border-blue-600' : `bg-white ${cfg.text} border-gray-200 hover:border-blue-300`}`}>
                {cfg.label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200/60 shadow-lg">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">No rows match your filter.</div>
        ) : (
          <>
            <div className="max-h-[680px] overflow-auto">
              <table className="min-w-full">
                <thead className="bg-gradient-to-r from-gray-50 to-gray-100/80 border-b border-gray-200 sticky top-0 z-10">
                  <tr>
                    <TH title="Sec"     tip="Venue section."                                         field="section"       sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="text-left" />
                    <TH title="Row"     tip="Row within the section."                               field="row"           sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="text-left" />
                    <TH title="Qty"     tip="Consecutive seats in this group."                      field="seatCount"     sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="text-right" />
                    <TH title="Seats"   tip="Seat numbers range."                                                                                                               className="text-left" />
                    <TH title="Cost"    tip="Your cost per ticket."                                 field="ourCost"       sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="text-right" />
                    <TH title="Our $"   tip="Your current list price per ticket."                   field="ourPrice"      sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="text-right" />
                    <TH title="SH Low"  tip="Lowest price on StubHub in this section."              field="sectionLowest" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="text-right bg-orange-50/60" />
                    <TH title="SH Avg"  tip="Average StubHub price in section."                     field="sectionAvg"    sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="text-right bg-orange-50/60" />
                    <TH title="SH High" tip="Highest StubHub price."                                                                                                            className="text-right bg-orange-50/60" />
                    <TH title="# Lists" tip="Total competing listings."                             field="sectionCount"  sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="text-right bg-orange-50/60" />
                    <TH title="Level"   tip="Ticket class (Field, Lower, Upper, GA, etc.)."                                                                                     className="text-left bg-orange-50/60" />
                    <TH title="Floor"   tip="Minimum allowed price (cost x 1.22)."                                                                                              className="text-right" />
                    <TH title="Deal $"  tip="Price for StubHub Best Deal badge."                                                                                                className="text-right" />
                    <TH title="Suggest" tip="Scraper-recommended price."                                                                                                        className="text-right" />
                    <TH title="Badge"   tip="Can you earn Best Deal badge?"                                                                                                     className="text-center" />
                    <TH title="Rank"    tip="Current rank → target rank after repricing (out of total listings in section)."                                                      className="text-center" />
                    <TH title="Diff"    tip="Your price - SH lowest."                               field="priceDiff"     sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="text-right" />
                    <TH title="Pos"     tip="Position in SH range (0%=cheapest, 100%=most expensive)." field="pricePosition" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="text-center" />
                    <TH title="Margin"  tip="(Price - Cost) / Cost x 100."                          field="margin"        sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="text-right" />
                    <TH title="Status"  tip="Pricing status."                                       field="pricingStatus" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} className="text-left" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100/60">
                  {filtered.map((r, i) => {
                    const cfg = statusCfg[r.pricingStatus];
                    const CfgIcon = cfg.icon;
                    return (
                      <tr key={r._id} className={`
                        ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}
                        ${r.pricingStatus === 'OVERPRICED' ? '!bg-red-50/30' : r.pricingStatus === 'AT_FLOOR' ? '!bg-amber-50/20' : ''}
                        hover:bg-blue-50/40 transition-all duration-150
                        border-l-[3px] ${cfg.border}
                      `}>
                        <td className="px-4 py-2.5 text-sm font-semibold text-gray-800 border-r border-gray-100/60">{r.section}</td>
                        <td className="px-4 py-2.5 text-sm font-medium text-gray-700 border-r border-gray-100/60">{r.row}</td>
                        <td className="px-4 py-2.5 text-sm text-right font-semibold border-r border-gray-100/60">{r.seatCount}</td>
                        <td className="px-4 py-2.5 text-sm text-gray-500 border-r border-gray-100/60">{r.seatRange || '-'}</td>
                        <td className="px-4 py-2.5 text-sm text-right font-semibold text-emerald-700 border-r border-gray-100/60">{$c(r.ourCost)}</td>
                        <td className="px-4 py-2.5 text-sm text-right font-bold text-blue-700 border-r border-gray-100/60">{$c(r.ourPrice)}</td>
                        <td className="px-4 py-2.5 text-sm text-right border-r border-gray-100/60 bg-orange-50/20">
                          {r.sectionLowest !== null ? <span className="font-bold text-orange-600">{$c(r.sectionLowest)}</span> : <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-right text-gray-600 border-r border-gray-100/60 bg-orange-50/20">
                          {r.sectionAvg !== null ? $c(r.sectionAvg) : <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-right text-gray-500 border-r border-gray-100/60 bg-orange-50/20">
                          {r.sectionHigh !== null ? $c(r.sectionHigh) : <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-right border-r border-gray-100/60 bg-orange-50/20">
                          {r.sectionCount > 0 ? <span className="font-medium text-gray-700">{r.sectionCount}</span> : <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-4 py-2.5 text-[11px] text-gray-500 border-r border-gray-100/60 bg-orange-50/20 max-w-[90px] truncate" title={r.ticketClassName}>
                          {r.ticketClassName || <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-right text-gray-600 border-r border-gray-100/60">
                          {r.ourFloorPrice !== null
                            ? <span className={r.atFloor ? 'font-semibold text-amber-600' : 'text-gray-500'}>{$c(r.ourFloorPrice)}</span>
                            : <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-right text-gray-600 border-r border-gray-100/60">
                          {r.dealZonePrice !== null ? $c(r.dealZonePrice) : <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-right font-semibold text-gray-800 border-r border-gray-100/60">
                          {r.suggestedPrice !== null ? $c(r.suggestedPrice) : <span className="text-gray-300 font-normal">-</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center border-r border-gray-100/60">
                          <BadgePill achievable={r.badgeAchievable} name={r.badgeName} />
                        </td>
                        <td className="px-4 py-2.5 text-center border-r border-gray-100/60">
                          {(r.currentRank !== null || r.suggestedRank !== null)
                            ? <div className="flex items-center justify-center gap-1 text-[10px] font-bold">
                                <span className="text-gray-500">#{r.currentRank ?? '?'}</span>
                                <span className="text-gray-300">→</span>
                                <span className={r.suggestedRank === 1 ? 'text-emerald-600' : r.suggestedRank != null && r.suggestedRank <= 3 ? 'text-blue-600' : 'text-gray-600'}>
                                  #{r.suggestedRank ?? '?'}
                                </span>
                                <span className="font-normal text-[9px] text-gray-400">/{r.sectionCount}</span>
                              </div>
                            : <span className="text-gray-300 text-[10px]">-</span>}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-right font-bold border-r border-gray-100/60">
                          {r.priceDiff !== null
                            ? <span className={r.priceDiff > 5 ? 'text-red-600' : r.priceDiff < -5 ? 'text-blue-600' : 'text-emerald-600'}>
                                {r.priceDiff > 0 ? '+' : ''}{$c(r.priceDiff)}
                              </span>
                            : <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-4 py-2.5 border-r border-gray-100/60">
                          {r.pricePosition !== null ? <PriceBar position={r.pricePosition} /> : <span className="text-gray-300 text-sm">-</span>}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-right border-r border-gray-100/60">
                          {r.margin !== null
                            ? <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${r.margin >= 30 ? 'bg-emerald-100 text-emerald-800' : r.margin >= 10 ? 'bg-yellow-100 text-yellow-800' : r.margin >= 0 ? 'bg-orange-100 text-orange-800' : 'bg-red-100 text-red-800'}`}>
                                {r.margin > 0 ? '+' : ''}{r.margin}%
                              </span>
                            : <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-4 py-2.5 text-sm">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full ${cfg.bg} ${cfg.text}`}>
                            <CfgIcon className="w-3 h-3" />{cfg.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-2.5 border-t border-gray-200 bg-gray-50/80 text-xs text-gray-500">
              {filtered.length} of {rows.length} rows
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   SUMMARY CARDS
   ═══════════════════════════════════════════════════════ */
function SummaryCard({ label, value, sub, icon, color }: {
  label: string; value: number | string; sub?: string; icon?: React.ReactNode; color: string;
}) {
  return (
    <div className="bg-white shadow-sm rounded-lg border border-gray-100 p-4 hover:shadow-md transition-shadow">
      <div className="text-[11px] text-gray-500 font-medium flex items-center gap-1.5 mb-1.5">{icon}{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   EVENT DETAIL VIEW
   ═══════════════════════════════════════════════════════ */
interface DetailProps {
  event: {
    _id?: string;
    Event_ID: string;
    Event_Name: string;
    Event_DateTime?: string;
    Venue?: string;
    stubhubUrl?: string;
    stubhubEventId?: string;
    stubhubLastScraped?: string;
    useStubHubPricing?: boolean;
    stubhubEnabled?: boolean;
  };
  rows: ComparisonRow[];
  summary: EventSummary;
  sales?: {
    summary: {
      totalTickets: number;
      totalRevenue: number;
      avgPrice: number;
      totalOrders: number;
      firstOrder: string;
      lastOrder: string;
      marketplaces: string[];
    } | null;
    bySection: Array<{
      section: string;
      ticketsSold: number;
      orders: number;
      revenue: number;
      avgPrice: number;
      lowestSold: number;
      highestSold: number;
      lastSale: string;
      marketplaces: string[];
    }>;
    recent: Array<{
      section: string;
      row: string;
      low_seat: number | null;
      high_seat: number | null;
      quantity: number;
      unit_price: number;
      total: number;
      marketplace: string;
      order_date: string;
      status: string;
    }>;
  };
}

export default function EventDetailView({ event, rows, summary, sales }: DetailProps) {
  const router = useRouter();
  const [urlEditing, setUrlEditing] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [urlError, setUrlError] = useState('');
  const [currentUrl, setCurrentUrl] = useState(event.stubhubUrl ?? '');
  const [isPending, startTransition] = useTransition();
  const [autoPricing, setAutoPricing] = useState(event.useStubHubPricing ?? false);
  const [pricingPending, startPricingTransition] = useTransition();
  const [scrapingEnabled, setScrapingEnabled] = useState(event.stubhubEnabled ?? true);
  const [scrapingPending, startScrapingTransition] = useTransition();

  const fresh = scrapeFreshness(summary?.lastScraped);

  const openEdit   = () => { setUrlDraft(currentUrl); setUrlError(''); setUrlEditing(true); };
  const cancelEdit = () => setUrlEditing(false);
  const saveEdit   = () => {
    startTransition(async () => {
      const res = await saveStubHubUrl(event.Event_ID, urlDraft);
      if (res.success) { setCurrentUrl(urlDraft.trim()); setUrlEditing(false); }
      else setUrlError(res.error ?? 'Failed');
    });
  };

  const handleTogglePricing = () => {
    const next = !autoPricing;
    setAutoPricing(next);
    startPricingTransition(async () => {
      const res = await toggleStubHubPricing(event.Event_ID, next);
      if (!res.success) setAutoPricing(!next);
    });
  };

  return (
    <div className="space-y-5">
      {/* Back + title */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/dashboard/stubhub')} className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 bg-white border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors shadow-sm">
            <ChevronLeft className="w-4 h-4" /> Events
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{event.Event_Name}</h1>
            <p className="text-sm text-gray-500 flex items-center gap-3 mt-0.5">
              <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{event.Venue ?? '-'}</span>
              <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />
                {event.Event_DateTime ? new Date(event.Event_DateTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '-'}
              </span>
            </p>
          </div>
        </div>
        <button onClick={() => router.refresh()} className="border px-3 py-2 rounded-lg text-sm hover:bg-gray-50 flex items-center gap-1.5 text-gray-600 shadow-sm">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* URL bar + auto-pricing toggle */}
      <div className="bg-white rounded-xl border border-gray-200/60 shadow-sm px-5 py-3 flex flex-wrap items-center gap-3">
        <LinkIcon className="w-4 h-4 text-gray-400 shrink-0" />
        {urlEditing ? (
          <div className="flex flex-1 items-center gap-2 min-w-0">
            <input autoFocus type="url" value={urlDraft} onChange={e => setUrlDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
              placeholder="https://www.stubhub.com/.../event/159456666/..."
              className="flex-1 min-w-0 border border-blue-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <button onClick={saveEdit} disabled={isPending} className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 disabled:opacity-60">
              <Save className="w-3.5 h-3.5" />{isPending ? 'Saving...' : 'Save'}
            </button>
            <button onClick={cancelEdit} className="border text-xs px-2 py-1.5 rounded-lg hover:bg-gray-50 flex items-center gap-1"><X className="w-3.5 h-3.5" /> Cancel</button>
            {urlError && <span className="text-red-500 text-xs">{urlError}</span>}
          </div>
        ) : currentUrl ? (
          <div className="flex flex-1 items-center gap-2 min-w-0">
            <span className="text-xs text-gray-500 truncate max-w-lg">{currentUrl}</span>
            <a href={currentUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-blue-400 hover:text-blue-600"><ExternalLink className="w-3.5 h-3.5" /></a>
            <button onClick={openEdit} className="shrink-0 flex items-center gap-1 text-gray-400 hover:text-gray-700 text-xs px-2 py-1 rounded-lg border border-gray-200 hover:bg-gray-50">
              <Pencil className="w-3 h-3" /> Edit
            </button>
          </div>
        ) : (
          <div className="flex flex-1 items-center gap-3">
            <span className="text-amber-600 text-sm font-medium">No StubHub URL set</span>
            <button onClick={openEdit} className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg">
              <LinkIcon className="w-3.5 h-3.5" /> Add URL
            </button>
          </div>
        )}

        {/* Scraping enabled toggle */}
        <button
          onClick={() => {
            const next = !scrapingEnabled;
            setScrapingEnabled(next);
            startScrapingTransition(async () => {
              const res = await toggleStubHubEnabled(event.Event_ID, next);
              if (!res.success) setScrapingEnabled(!next);
            });
          }}
          disabled={scrapingPending}
          title={scrapingEnabled ? 'Scraping enabled — click to stop' : 'Scraping disabled — click to start'}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium border transition-colors disabled:opacity-50 ${
            scrapingEnabled
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
              : 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
          }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${scrapingEnabled ? 'bg-emerald-500' : 'bg-red-400'}`} />
          {scrapingEnabled ? 'Scraping On' : 'Scraping Off'}
        </button>

        {/* Auto-pricing toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleTogglePricing}
            disabled={pricingPending}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1 disabled:opacity-50 ${autoPricing ? 'bg-emerald-500' : 'bg-gray-300'}`}
          >
            <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${autoPricing ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
          <span className={`text-xs font-medium ${autoPricing ? 'text-emerald-700' : 'text-gray-500'}`}>
            <Zap className="w-3 h-3 inline -mt-0.5 mr-0.5" />
            Auto-Price {autoPricing ? 'ON' : 'OFF'}
          </span>
        </div>

        {/* Scrape freshness */}
        {summary?.lastScraped && (
          <span className={`text-xs flex items-center gap-1 font-medium ${fresh.color}`}>
            <Clock className="w-3.5 h-3.5" /> {fresh.label}
            {fresh.label === 'Live' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
          </span>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <SummaryCard label="Inv. Groups"  value={summary.totalRows}      sub={`${summary.totalOurTickets} tickets`} color="text-blue-600" />
        <SummaryCard label="Competitive"  value={summary.competitive}    icon={<CheckCircle className="w-3.5 h-3.5 text-emerald-500" />} color="text-emerald-600" />
        <SummaryCard label="Below Market" value={summary.belowMarket}    icon={<TrendingUp className="w-3.5 h-3.5 text-blue-500" />} color="text-blue-600" />
        <SummaryCard label="Overpriced"   value={summary.overpriced}     icon={<TrendingUp className="w-3.5 h-3.5 text-red-500" />} color="text-red-600" />
        <SummaryCard label="At Floor"     value={summary.atFloor}        icon={<ShieldAlert className="w-3.5 h-3.5 text-amber-500" />} color="text-amber-600" />
        <SummaryCard label="SH Listings"  value={summary.totalShListings} color="text-orange-600" />
        <div className="bg-white shadow-sm rounded-lg border border-gray-100 p-4 hover:shadow-md transition-shadow">
          <div className="text-[11px] text-gray-500 font-medium flex items-center gap-1.5 mb-1.5"><DollarSign className="w-3.5 h-3.5 text-rose-400" />Revenue Risk</div>
          <div className={`text-2xl font-bold ${summary.potentialRevenueLoss > 0 ? 'text-red-600' : 'text-gray-300'}`}>
            {summary.potentialRevenueLoss > 0 ? $c(summary.potentialRevenueLoss) : '$0'}
          </div>
          <div className="text-[11px] text-gray-400 mt-0.5">overpriced groups</div>
        </div>
      </div>

      {/* Key insights */}
      {rows.length > 0 && <KeyInsights rows={rows} summary={summary} />}

      {/* Sales Analytics — real order data */}
      {sales?.summary && (
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Order History</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard label="Tickets Sold" value={sales.summary.totalTickets} sub={`${sales.summary.totalOrders} orders`} color="text-purple-600" />
            <SummaryCard label="Avg Price" value={$c(sales.summary.avgPrice)} color="text-blue-600" />
            <SummaryCard label="Total Revenue" value={$c(sales.summary.totalRevenue)} color="text-emerald-600" />
            <SummaryCard label="Marketplaces" value={sales.summary.marketplaces.length} sub={sales.summary.marketplaces.join(', ')} color="text-orange-600" />
          </div>

          {/* Sales by section */}
          {sales.bySection && sales.bySection.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200/60 shadow-sm overflow-hidden">
              <div className="px-4 py-2.5 bg-gradient-to-r from-purple-50 to-blue-50 border-b border-gray-200">
                <h3 className="text-xs font-bold text-gray-600 uppercase tracking-wider">Sales by Section</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase">
                      <th className="px-4 py-2 text-left font-semibold">Section</th>
                      <th className="px-4 py-2 text-right font-semibold">Tickets</th>
                      <th className="px-4 py-2 text-right font-semibold">Orders</th>
                      <th className="px-4 py-2 text-right font-semibold">Avg Price</th>
                      <th className="px-4 py-2 text-right font-semibold">Low</th>
                      <th className="px-4 py-2 text-right font-semibold">High</th>
                      <th className="px-4 py-2 text-right font-semibold">Revenue</th>
                      <th className="px-4 py-2 text-left font-semibold">Via</th>
                      <th className="px-4 py-2 text-right font-semibold">Last Sale</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {sales.bySection.map((s, i) => (
                      <tr key={s.section} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}>
                        <td className="px-4 py-2 font-semibold text-gray-800">{s.section}</td>
                        <td className="px-4 py-2 text-right font-bold text-purple-600">{s.ticketsSold}</td>
                        <td className="px-4 py-2 text-right text-gray-600">{s.orders}</td>
                        <td className="px-4 py-2 text-right text-blue-600 font-medium">{$c(s.avgPrice)}</td>
                        <td className="px-4 py-2 text-right text-gray-500">{$c(s.lowestSold)}</td>
                        <td className="px-4 py-2 text-right text-gray-500">{$c(s.highestSold)}</td>
                        <td className="px-4 py-2 text-right text-emerald-600 font-medium">{$c(s.revenue)}</td>
                        <td className="px-4 py-2 text-xs text-gray-500">{s.marketplaces.join(', ')}</td>
                        <td className="px-4 py-2 text-right text-gray-500 text-xs whitespace-nowrap">
                          {new Date(s.lastSale).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recent individual orders */}
          {sales.recent && sales.recent.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200/60 shadow-sm overflow-hidden">
              <div className="px-4 py-2.5 bg-gradient-to-r from-purple-50 to-blue-50 border-b border-gray-200">
                <h3 className="text-xs font-bold text-gray-600 uppercase tracking-wider">Recent Orders</h3>
              </div>
              <div className="max-h-[400px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                    <tr className="text-xs text-gray-500 uppercase">
                      <th className="px-4 py-2 text-left font-semibold">Section</th>
                      <th className="px-4 py-2 text-left font-semibold">Row</th>
                      <th className="px-4 py-2 text-left font-semibold">Seats</th>
                      <th className="px-4 py-2 text-right font-semibold">Qty</th>
                      <th className="px-4 py-2 text-right font-semibold">Price</th>
                      <th className="px-4 py-2 text-right font-semibold">Total</th>
                      <th className="px-4 py-2 text-left font-semibold">Marketplace</th>
                      <th className="px-4 py-2 text-center font-semibold">Status</th>
                      <th className="px-4 py-2 text-right font-semibold">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {sales.recent.map((o, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}>
                        <td className="px-4 py-2 font-semibold text-gray-800">{o.section || '-'}</td>
                        <td className="px-4 py-2 text-gray-700">{o.row || '-'}</td>
                        <td className="px-4 py-2 text-gray-500 text-xs">
                          {o.low_seat && o.high_seat ? `${o.low_seat}-${o.high_seat}` : '-'}
                        </td>
                        <td className="px-4 py-2 text-right font-medium">{o.quantity}</td>
                        <td className="px-4 py-2 text-right font-bold text-blue-700">{$c(o.unit_price)}</td>
                        <td className="px-4 py-2 text-right text-emerald-600 font-medium">{$c(o.total)}</td>
                        <td className="px-4 py-2 text-xs text-gray-600">{o.marketplace || '-'}</td>
                        <td className="px-4 py-2 text-center">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            o.status === 'confirmed' || o.status === 'delivered' ? 'bg-emerald-50 text-emerald-700' :
                            o.status === 'invoiced' || o.status === 'pending' ? 'bg-blue-50 text-blue-700' :
                            o.status === 'problem' ? 'bg-red-50 text-red-700' :
                            'bg-gray-50 text-gray-600'
                          }`}>{o.status}</span>
                        </td>
                        <td className="px-4 py-2 text-right text-xs text-gray-500 whitespace-nowrap">
                          {new Date(o.order_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{' '}
                          {new Date(o.order_date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* No data */}
      {rows.length === 0 && (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200 shadow-sm">
          <BarChart3 className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <h3 className="font-semibold text-gray-600 mb-1">No comparison data yet</h3>
          <p className="text-sm text-gray-400">Set a StubHub URL and wait for the scraper to run, or check if there is inventory for this event.</p>
        </div>
      )}

      {/* Comparison table */}
      {rows.length > 0 && <ComparisonTable rows={rows} />}
    </div>
  );
}
