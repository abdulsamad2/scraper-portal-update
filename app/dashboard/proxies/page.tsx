'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import {
  SignalHigh,
  Plus,
  Trash2,
  RefreshCw,
  Power,
  PowerOff,
  AlertTriangle,
  Check,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  X,
  Server,
  ShieldCheck,
  ShieldOff,
  Users,
  ChevronDown,
  Copy,
  Edit3,
  UploadCloud,
  Activity,
  Clock,
  XCircle,
} from 'lucide-react';
import {
  listProxiesPaged,
  listClientIds,
  bulkAddProxies,
  toggleProxy,
  deleteProxy,
  deleteProxiesBulk,
  setProxiesEnabledBulk,
  updateProxyClient,
  type ProxyRecord,
  type ProxyListQuery,
} from '@/actions/proxyActions';

type Msg = { text: string; type: 'success' | 'error' } | null;
type SortKey = NonNullable<ProxyListQuery['sortBy']>;
type EnabledFilter = NonNullable<ProxyListQuery['enabled']>;
type Health = 'healthy' | 'warning' | 'failing' | 'disabled' | 'idle';

const PAGE_SIZES = [25, 50, 100, 200];

function formatDate(value: string | null) {
  if (!value) return '—';
  try {
    const d = new Date(value);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
    return d.toLocaleDateString();
  } catch {
    return value;
  }
}

function deriveHealth(p: ProxyRecord): Health {
  if (!p.enabled) return 'disabled';
  if (p.failureCount >= 5) return 'failing';
  if (p.failureCount > 0) return 'warning';
  if (!p.lastUsedAt) return 'idle';
  return 'healthy';
}

const HEALTH_STYLE: Record<Health, { dot: string; chip: string; label: string }> = {
  healthy:  { dot: 'bg-emerald-500',  chip: 'bg-emerald-50 text-emerald-700 border-emerald-200',  label: 'Healthy' },
  warning:  { dot: 'bg-amber-500',    chip: 'bg-amber-50 text-amber-700 border-amber-200',         label: 'Warning' },
  failing:  { dot: 'bg-rose-500',     chip: 'bg-rose-50 text-rose-700 border-rose-200',            label: 'Failing' },
  disabled: { dot: 'bg-slate-400',    chip: 'bg-slate-100 text-slate-500 border-slate-200',        label: 'Disabled' },
  idle:     { dot: 'bg-sky-400',      chip: 'bg-sky-50 text-sky-700 border-sky-200',               label: 'Idle' },
};

function StatTile({
  label,
  value,
  icon: Icon,
  accent,
  hint,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  accent: 'blue' | 'green' | 'red' | 'purple';
  hint?: string;
}) {
  const accents = {
    blue:   { grad: 'from-cyan-500 to-blue-600',    glow: 'shadow-cyan-200' },
    green:  { grad: 'from-emerald-500 to-green-600', glow: 'shadow-emerald-200' },
    red:    { grad: 'from-rose-500 to-red-600',      glow: 'shadow-rose-200' },
    purple: { grad: 'from-violet-500 to-purple-600', glow: 'shadow-violet-200' },
  } as const;
  const a = accents[accent];
  return (
    <div className="group bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3 hover:shadow-md transition-shadow">
      <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${a.grad} shadow-md ${a.glow} flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">{label}</div>
        <div className="text-2xl font-bold text-slate-800 leading-tight tabular-nums">{value}</div>
        {hint && <div className="text-[10px] text-slate-400 mt-0.5">{hint}</div>}
      </div>
    </div>
  );
}

function SortHeader({
  label,
  field,
  current,
  dir,
  onChange,
}: {
  label: string;
  field: SortKey;
  current: SortKey;
  dir: 'asc' | 'desc';
  onChange: (f: SortKey) => void;
}) {
  const isActive = current === field;
  const Icon = !isActive ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onChange(field)}
      className={`inline-flex items-center gap-1.5 group hover:text-slate-700 ${
        isActive ? 'text-slate-700' : 'text-slate-500'
      }`}
    >
      {label}
      <Icon className={`w-3 h-3 ${isActive ? 'opacity-100' : 'opacity-40 group-hover:opacity-80'}`} />
    </button>
  );
}

function buildPageList(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | 'ellipsis')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push('ellipsis');
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push('ellipsis');
  out.push(total);
  return out;
}

export default function ProxiesPage() {
  const [rows, setRows] = useState<ProxyRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({ total: 0, enabled: 0, disabled: 0, clients: 0 });
  const [clientIds, setClientIds] = useState<string[]>([]);

  // query state
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterClient, setFilterClient] = useState<string>('');
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilter>('all');
  const [sortBy, setSortBy] = useState<SortKey>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<Msg>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<{ id: string; value: string } | null>(null);

  const [rawText, setRawText] = useState('');
  const [addClientId, setAddClientId] = useState('default');
  const [dragOver, setDragOver] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);

  const flash = useCallback((m: Msg) => {
    setMessage(m);
    if (m) setTimeout(() => setMessage(null), 3500);
  }, []);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filterClient, enabledFilter, limit]);

  // Keyboard: "/" focus search, Esc close modal/edit
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (e.key === '/' && !inField) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'Escape') {
        if (bulkOpen) setBulkOpen(false);
        if (editingClient) setEditingClient(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bulkOpen, editingClient]);

  const reqIdRef = useRef(0);
  const refresh = useCallback(async () => {
    const myReq = ++reqIdRef.current;
    setLoading(true);
    try {
      const [res, ids] = await Promise.all([
        listProxiesPaged({
          page,
          limit,
          search: debouncedSearch || undefined,
          clientId: filterClient || undefined,
          enabled: enabledFilter,
          sortBy,
          sortDir,
        }),
        listClientIds(),
      ]);
      if (myReq !== reqIdRef.current) return;
      setRows(res.rows);
      setTotal(res.total);
      setStats(res.stats);
      setClientIds(ids);
      setSelected(new Set());
    } catch (err) {
      flash({ text: `Failed to load proxies: ${(err as Error).message}`, type: 'error' });
    } finally {
      if (myReq === reqIdRef.current) setLoading(false);
    }
  }, [page, limit, debouncedSearch, filterClient, enabledFilter, sortBy, sortDir, flash]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const pageCount = Math.max(1, Math.ceil(total / limit));
  const startIdx = total === 0 ? 0 : (page - 1) * limit + 1;
  const endIdx = Math.min(total, page * limit);
  const allSelected = rows.length > 0 && rows.every(r => selected.has(r._id));

  const activeFilterCount = useMemo(
    () => (debouncedSearch ? 1 : 0) + (filterClient ? 1 : 0) + (enabledFilter !== 'all' ? 1 : 0),
    [debouncedSearch, filterClient, enabledFilter]
  );

  const enabledPct = stats.total ? Math.round((stats.enabled / stats.total) * 100) : 0;

  function changeSort(field: SortKey) {
    if (sortBy === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir('desc');
    }
  }

  function toggleSelectAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(rows.map(r => r._id)));
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearFilters() {
    setSearch('');
    setDebouncedSearch('');
    setFilterClient('');
    setEnabledFilter('all');
  }

  async function handleCopyRow(p: ProxyRecord) {
    const line = `${p.ip}:${p.port}:${p.username}:${p.password}`;
    try {
      await navigator.clipboard.writeText(line);
      flash({ text: 'Proxy copied to clipboard', type: 'success' });
    } catch {
      flash({ text: 'Copy failed', type: 'error' });
    }
  }

  function handleBulkAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!rawText.trim()) return;
    startTransition(async () => {
      try {
        const res = await bulkAddProxies(rawText, addClientId.trim() || 'default');
        flash({
          text: `Added ${res.added}, updated ${res.updated}, skipped ${res.skipped} malformed line(s).`,
          type: 'success',
        });
        setRawText('');
        setBulkOpen(false);
        await refresh();
      } catch (err) {
        flash({ text: `Bulk add failed: ${(err as Error).message}`, type: 'error' });
      }
    });
  }

  function handleToggle(id: string, enabled: boolean) {
    startTransition(async () => {
      await toggleProxy(id, enabled);
      setRows(prev => prev.map(p => (p._id === id ? { ...p, enabled } : p)));
      setStats(s => ({
        ...s,
        enabled: s.enabled + (enabled ? 1 : -1),
        disabled: s.disabled + (enabled ? -1 : 1),
      }));
    });
  }

  function handleDelete(id: string) {
    if (!confirm('Delete this proxy?')) return;
    startTransition(async () => {
      await deleteProxy(id);
      await refresh();
    });
  }

  function handleBulkDelete() {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} selected proxies?`)) return;
    const ids = Array.from(selected);
    startTransition(async () => {
      const res = await deleteProxiesBulk(ids);
      flash({ text: `Deleted ${res.deleted} proxies.`, type: 'success' });
      await refresh();
    });
  }

  function handleBulkEnable(enabled: boolean) {
    if (!selected.size) return;
    const ids = Array.from(selected);
    startTransition(async () => {
      const res = await setProxiesEnabledBulk(ids, enabled);
      flash({ text: `${enabled ? 'Enabled' : 'Disabled'} ${res.updated} proxies.`, type: 'success' });
      await refresh();
    });
  }

  function commitClientEdit() {
    if (!editingClient) return;
    const { id, value } = editingClient;
    const target = value.trim() || 'default';
    const original = rows.find(r => r._id === id)?.clientId;
    setEditingClient(null);
    if (target === original) return;
    startTransition(async () => {
      await updateProxyClient(id, target);
      setRows(prev => prev.map(p => (p._id === id ? { ...p, clientId: target } : p)));
      flash({ text: `Moved proxy to "${target}"`, type: 'success' });
    });
  }

  // Bulk-add preview
  const bulkPreview = useMemo(() => {
    if (!rawText.trim()) return { valid: 0, invalid: 0 };
    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let valid = 0;
    let invalid = 0;
    for (const l of lines) {
      const parts = l.split(':');
      if (parts.length === 4 && parts.every(Boolean)) valid++;
      else invalid++;
    }
    return { valid, invalid };
  }, [rawText]);

  async function handleFileDrop(file: File) {
    try {
      const text = await file.text();
      setRawText(prev => (prev ? prev.replace(/\s*$/, '\n') + text : text));
    } catch {
      flash({ text: 'Could not read file', type: 'error' });
    }
  }

  const pageList = buildPageList(page, pageCount);

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-24">
      {/* Hero header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 text-white p-6 shadow-xl shadow-slate-900/10">
        <div className="absolute inset-0 opacity-30 pointer-events-none">
          <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-cyan-500 blur-3xl" />
          <div className="absolute -bottom-16 -left-16 w-64 h-64 rounded-full bg-purple-500 blur-3xl" />
        </div>
        <div className="relative flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-white/10 backdrop-blur ring-1 ring-white/20 flex items-center justify-center shrink-0">
              <SignalHigh className="w-6 h-6 text-cyan-300" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Proxy Pool</h1>
              <p className="text-sm text-slate-300 mt-0.5 max-w-md">
                Rotating proxies consumed by scraper workers. Edits propagate within ~5 minutes.
              </p>
              <div className="flex items-center gap-3 mt-3 text-xs">
                <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/10 backdrop-blur">
                  <Activity className="w-3 h-3 text-emerald-300" />
                  <span className="text-slate-200">
                    <span className="font-semibold text-white tabular-nums">{enabledPct}%</span> healthy
                  </span>
                </div>
                <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/10 backdrop-blur">
                  <Clock className="w-3 h-3 text-cyan-300" />
                  <span className="text-slate-200">5-min refresh window</span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refresh}
              disabled={loading || pending}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-xl bg-white/10 backdrop-blur ring-1 ring-white/20 text-white hover:bg-white/20 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading || pending ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setBulkOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 text-white font-semibold shadow-md hover:from-cyan-300 hover:to-blue-400 transition-all"
            >
              <Plus className="w-4 h-4" />
              Add Proxies
            </button>
          </div>
        </div>

        {/* Healthy bar */}
        <div className="relative mt-5 h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-all duration-500"
            style={{ width: `${enabledPct}%` }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Total Proxies"   value={stats.total}    icon={Server}        accent="blue"   hint="across all clients" />
        <StatTile label="Enabled"         value={stats.enabled}  icon={ShieldCheck}   accent="green"  hint={`${enabledPct}% of pool`} />
        <StatTile label="Disabled"        value={stats.disabled} icon={ShieldOff}     accent="red"    hint="excluded from rotation" />
        <StatTile label="Client Groups"   value={stats.clients}  icon={Users}         accent="purple" hint="distinct tenants" />
      </div>

      {/* Message */}
      {message && (
        <div
          className={`px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2 ${
            message.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {message.type === 'success' ? <Check className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {message.text}
        </div>
      )}

      {/* Client quick-filter chips */}
      {clientIds.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs uppercase tracking-wider font-semibold text-slate-400 mr-1">Clients</span>
          <button
            type="button"
            onClick={() => setFilterClient('')}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              filterClient === ''
                ? 'bg-slate-800 text-white border-slate-800'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}
          >
            All
          </button>
          {clientIds.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => setFilterClient(c)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                filterClient === c
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300 hover:text-violet-700'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Table card */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Filter bar */}
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/40 flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search IP, port, user, client, notes…"
              className="w-full pl-9 pr-16 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-500 pointer-events-none select-none">
              /
            </kbd>
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-9 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="inline-flex rounded-xl border border-slate-200 bg-white overflow-hidden text-xs">
            {(['all', 'enabled', 'disabled'] as EnabledFilter[]).map(v => (
              <button
                key={v}
                type="button"
                onClick={() => setEnabledFilter(v)}
                className={`px-3 py-1.5 capitalize transition-colors font-medium ${
                  enabledFilter === v
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded-md hover:bg-slate-100"
            >
              <XCircle className="w-3 h-3" />
              Clear ({activeFilterCount})
            </button>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2.5 text-left w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    aria-label="Select all"
                    className="rounded border-slate-300"
                  />
                </th>
                <th className="px-4 py-2.5 text-left">
                  <SortHeader label="IP" field="ip" current={sortBy} dir={sortDir} onChange={changeSort} />
                </th>
                <th className="px-4 py-2.5 text-left">Port</th>
                <th className="px-4 py-2.5 text-left">User</th>
                <th className="px-4 py-2.5 text-left">
                  <SortHeader label="Client" field="clientId" current={sortBy} dir={sortDir} onChange={changeSort} />
                </th>
                <th className="px-4 py-2.5 text-left">Health</th>
                <th className="px-4 py-2.5 text-left">
                  <SortHeader label="Last Used" field="lastUsedAt" current={sortBy} dir={sortDir} onChange={changeSort} />
                </th>
                <th className="px-4 py-2.5 text-left">
                  <SortHeader label="Fails" field="failureCount" current={sortBy} dir={sortDir} onChange={changeSort} />
                </th>
                <th className="px-4 py-2.5 text-left">
                  <SortHeader label="Added" field="createdAt" current={sortBy} dir={sortDir} onChange={changeSort} />
                </th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`skel-${i}`} className="animate-pulse">
                    <td className="px-4 py-3"><div className="w-4 h-4 bg-slate-100 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-3 bg-slate-100 rounded w-24" /></td>
                    <td className="px-4 py-3"><div className="h-3 bg-slate-100 rounded w-12" /></td>
                    <td className="px-4 py-3"><div className="h-3 bg-slate-100 rounded w-16" /></td>
                    <td className="px-4 py-3"><div className="h-5 bg-slate-100 rounded-full w-16" /></td>
                    <td className="px-4 py-3"><div className="h-5 bg-slate-100 rounded-full w-20" /></td>
                    <td className="px-4 py-3"><div className="h-3 bg-slate-100 rounded w-14" /></td>
                    <td className="px-4 py-3"><div className="h-3 bg-slate-100 rounded w-6" /></td>
                    <td className="px-4 py-3"><div className="h-3 bg-slate-100 rounded w-14" /></td>
                    <td className="px-4 py-3"><div className="h-5 bg-slate-100 rounded w-16 ml-auto" /></td>
                  </tr>
                ))}

              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-3 text-slate-400">
                      <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center">
                        <Server className="w-8 h-8 text-slate-300" />
                      </div>
                      <p className="text-sm font-medium text-slate-500">
                        {activeFilterCount > 0
                          ? 'No proxies match the current filters.'
                          : 'No proxies in the pool yet.'}
                      </p>
                      {activeFilterCount > 0 ? (
                        <button onClick={clearFilters} className="text-xs text-blue-600 hover:underline">
                          Clear filters
                        </button>
                      ) : (
                        <button
                          onClick={() => setBulkOpen(true)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                        >
                          <Plus className="w-3 h-3" />
                          Add your first proxies
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}

              {!loading &&
                rows.map(p => {
                  const health = deriveHealth(p);
                  const hs = HEALTH_STYLE[health];
                  return (
                    <tr
                      key={p._id}
                      className={`group transition-colors ${
                        selected.has(p._id) ? 'bg-blue-50/60' : 'hover:bg-slate-50/70'
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          checked={selected.has(p._id)}
                          onChange={() => toggleOne(p._id)}
                          aria-label={`Select ${p.ip}`}
                          className="rounded border-slate-300"
                        />
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-700">{p.ip}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-600">{p.port}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-500">{p.username}</td>
                      <td className="px-4 py-2.5">
                        {editingClient?.id === p._id ? (
                          <input
                            autoFocus
                            value={editingClient.value}
                            onChange={e => setEditingClient({ id: p._id, value: e.target.value })}
                            onBlur={commitClientEdit}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitClientEdit();
                              }
                              if (e.key === 'Escape') setEditingClient(null);
                            }}
                            list="proxy-client-options"
                            className="px-2 py-0.5 text-xs font-medium border border-violet-300 rounded-md focus:ring-2 focus:ring-violet-500 focus:border-transparent w-28"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditingClient({ id: p._id, value: p.clientId })}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-violet-50 text-violet-700 border border-violet-100 font-medium hover:bg-violet-100 hover:border-violet-200 transition-colors"
                            title="Click to change client"
                          >
                            {p.clientId}
                            <Edit3 className="w-2.5 h-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs rounded-full border font-medium ${hs.chip}`}
                          title={`failures: ${p.failureCount}${p.lastUsedAt ? ` · last used ${formatDate(p.lastUsedAt)}` : ' · never used'}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${hs.dot}`} />
                          {hs.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">{formatDate(p.lastUsedAt)}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 text-xs rounded font-medium tabular-nums ${
                            p.failureCount === 0
                              ? 'text-slate-400'
                              : p.failureCount < 5
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-red-50 text-red-700 border border-red-200'
                          }`}
                        >
                          {p.failureCount}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">{formatDate(p.createdAt)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => handleCopyRow(p)}
                            className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Copy IP:PORT:USER:PASS"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggle(p._id, !p.enabled)}
                            disabled={pending}
                            className={`p-1.5 rounded-md transition-colors disabled:opacity-50 ${
                              p.enabled
                                ? 'text-emerald-500 hover:bg-emerald-50'
                                : 'text-slate-400 hover:bg-slate-100'
                            }`}
                            title={p.enabled ? 'Disable' : 'Enable'}
                          >
                            {p.enabled ? <Power className="w-3.5 h-3.5" /> : <PowerOff className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(p._id)}
                            disabled={pending}
                            className="p-1.5 rounded-md text-rose-500 hover:bg-rose-50 disabled:opacity-50"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/40 flex items-center gap-3 flex-wrap text-xs text-slate-500">
          <div>
            Showing <span className="font-semibold text-slate-700 tabular-nums">{startIdx}</span>–
            <span className="font-semibold text-slate-700 tabular-nums">{endIdx}</span> of{' '}
            <span className="font-semibold text-slate-700 tabular-nums">{total}</span>
          </div>

          <div className="flex items-center gap-1.5 ml-auto">
            <label className="text-slate-500">Rows</label>
            <div className="relative">
              <select
                value={limit}
                onChange={e => setLimit(parseInt(e.target.value, 10))}
                className="appearance-none pl-2 pr-6 py-1 border border-slate-200 rounded-md bg-white focus:ring-2 focus:ring-blue-500 text-slate-700"
              >
                {PAGE_SIZES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(1)}
              disabled={page === 1 || loading}
              className="p-1.5 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              aria-label="First page"
            >
              <ChevronsLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1 || loading}
              className="p-1.5 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            {pageList.map((pn, i) =>
              pn === 'ellipsis' ? (
                <span key={`e-${i}`} className="px-1.5 text-slate-400">…</span>
              ) : (
                <button
                  key={pn}
                  type="button"
                  onClick={() => setPage(pn)}
                  disabled={loading}
                  className={`min-w-[28px] px-2 py-1 rounded-md text-xs font-medium tabular-nums transition-colors ${
                    pn === page
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100 border border-transparent'
                  }`}
                >
                  {pn}
                </button>
              )
            )}

            <button
              type="button"
              onClick={() => setPage(p => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount || loading}
              className="p-1.5 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setPage(pageCount)}
              disabled={page >= pageCount || loading}
              className="p-1.5 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              aria-label="Last page"
            >
              <ChevronsRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-400 text-center">
        Scraper machines refresh from MongoDB every 5 minutes. Toggle changes propagate within that window.
      </p>

      {/* Shared datalist for client autocomplete */}
      <datalist id="proxy-client-options">
        {clientIds.map(c => (
          <option key={c} value={c} />
        ))}
      </datalist>

      {/* Sticky floating action bar */}
      {selected.size > 0 && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-40">
          <div className="flex items-center gap-2 bg-slate-900 text-white rounded-2xl shadow-2xl shadow-slate-900/30 ring-1 ring-white/10 px-3 py-2">
            <span className="text-xs font-medium px-2">
              <span className="text-cyan-300 tabular-nums">{selected.size}</span> selected
            </span>
            <div className="w-px h-5 bg-white/10" />
            <button
              onClick={() => handleBulkEnable(true)}
              disabled={pending}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md text-emerald-300 hover:bg-white/10 disabled:opacity-50"
            >
              <Power className="w-3.5 h-3.5" />
              Enable
            </button>
            <button
              onClick={() => handleBulkEnable(false)}
              disabled={pending}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md text-amber-300 hover:bg-white/10 disabled:opacity-50"
            >
              <PowerOff className="w-3.5 h-3.5" />
              Disable
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={pending}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md text-rose-300 hover:bg-white/10 disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
            <div className="w-px h-5 bg-white/10" />
            <button
              onClick={() => setSelected(new Set())}
              className="p-1 rounded-md text-slate-400 hover:bg-white/10 hover:text-white"
              aria-label="Clear selection"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Bulk add modal */}
      {bulkOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
          onClick={() => setBulkOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl border border-slate-200 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-cyan-50 to-blue-50 flex items-start justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                  <Plus className="w-4 h-4 text-blue-600" />
                  Add Proxies
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  One per line, format{' '}
                  <code className="px-1 py-0.5 bg-white border border-slate-200 rounded text-slate-700">IP:PORT:USER:PASS</code>.
                  Duplicates upsert.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBulkOpen(false)}
                className="p-1.5 rounded-md text-slate-400 hover:bg-white hover:text-slate-600"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleBulkAdd} className="p-6 space-y-4">
              <div className="flex items-end gap-3 flex-wrap">
                <div className="flex-1 min-w-[180px]">
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Client ID
                  </label>
                  <input
                    type="text"
                    value={addClientId}
                    onChange={e => setAddClientId(e.target.value)}
                    placeholder="default"
                    list="proxy-client-options"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                {rawText.trim() && (
                  <div className="text-xs text-slate-500 pb-2">
                    <span className="text-emerald-600 font-semibold tabular-nums">{bulkPreview.valid}</span> valid
                    {bulkPreview.invalid > 0 && (
                      <>
                        {' · '}
                        <span className="text-rose-600 font-semibold tabular-nums">{bulkPreview.invalid}</span> malformed
                      </>
                    )}
                  </div>
                )}
              </div>

              <div
                onDragOver={e => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleFileDrop(file);
                }}
                className={`relative rounded-lg border-2 border-dashed transition-colors ${
                  dragOver ? 'border-blue-400 bg-blue-50/50' : 'border-slate-200 bg-slate-50/30'
                }`}
              >
                <textarea
                  value={rawText}
                  onChange={e => setRawText(e.target.value)}
                  rows={8}
                  placeholder={`192.168.1.1:8000:user:pass\n10.0.0.1:8080:user:pass\n\nor drop a .txt file here`}
                  className="w-full px-3 py-2 text-sm font-mono bg-transparent rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
                />
                {!rawText && (
                  <div className="absolute right-3 bottom-3 inline-flex items-center gap-1 text-[10px] text-slate-400 pointer-events-none">
                    <UploadCloud className="w-3 h-3" />
                    Drop file
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setBulkOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!rawText.trim() || pending}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold shadow-md text-white bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 disabled:opacity-50"
                >
                  {pending ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  Add {bulkPreview.valid > 0 ? `(${bulkPreview.valid})` : ''}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
