'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { SignalHigh, Plus, Trash2, RefreshCw, Power, PowerOff, AlertTriangle, Check } from 'lucide-react';
import {
  listProxies,
  listClientIds,
  bulkAddProxies,
  toggleProxy,
  deleteProxy,
  deleteProxiesBulk,
  setProxiesEnabledBulk,
  type ProxyRecord,
} from '@/actions/proxyActions';

type Msg = { text: string; type: 'success' | 'error' } | null;

function formatDate(value: string | null) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function ProxiesPage() {
  const [proxies, setProxies] = useState<ProxyRecord[]>([]);
  const [clientIds, setClientIds] = useState<string[]>([]);
  const [filterClient, setFilterClient] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  const [rawText, setRawText] = useState('');
  const [addClientId, setAddClientId] = useState('default');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<Msg>(null);

  const flash = (m: Msg) => {
    setMessage(m);
    if (m) setTimeout(() => setMessage(null), 3500);
  };

  async function refresh() {
    setLoading(true);
    try {
      const [list, ids] = await Promise.all([
        listProxies(filterClient || undefined),
        listClientIds(),
      ]);
      setProxies(list);
      setClientIds(ids);
      setSelected(new Set());
    } catch (err) {
      flash({ text: `Failed to load proxies: ${(err as Error).message}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterClient]);

  const visible = proxies;
  const allSelected = visible.length > 0 && visible.every(p => selected.has(p._id));

  const stats = useMemo(() => {
    const enabled = proxies.filter(p => p.enabled).length;
    return { total: proxies.length, enabled, disabled: proxies.length - enabled };
  }, [proxies]);

  function toggleSelectAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visible.map(p => p._id)));
    }
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
        await refresh();
      } catch (err) {
        flash({ text: `Bulk add failed: ${(err as Error).message}`, type: 'error' });
      }
    });
  }

  function handleToggle(id: string, enabled: boolean) {
    startTransition(async () => {
      await toggleProxy(id, enabled);
      setProxies(prev => prev.map(p => (p._id === id ? { ...p, enabled } : p)));
    });
  }

  function handleDelete(id: string) {
    if (!confirm('Delete this proxy?')) return;
    startTransition(async () => {
      await deleteProxy(id);
      setProxies(prev => prev.filter(p => p._id !== id));
      setSelected(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
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

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-md shadow-cyan-200">
            <SignalHigh className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Proxies</h1>
            <p className="text-sm text-slate-500">
              <span className="text-slate-700 font-medium">{stats.total}</span> total ·{' '}
              <span className="text-green-600">{stats.enabled} enabled</span> ·{' '}
              <span className="text-red-500">{stats.disabled} disabled</span>
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading || pending}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading || pending ? 'animate-spin' : ''}`} />
          Refresh
        </button>
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

      {/* Bulk add */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Bulk Add</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            One proxy per line in the format <code className="px-1 py-0.5 bg-slate-100 rounded">IP:PORT:USER:PASS</code>. Duplicates (same IP+port) are upserted.
          </p>
        </div>
        <form onSubmit={handleBulkAdd} className="p-6 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Client ID</label>
            <input
              type="text"
              value={addClientId}
              onChange={e => setAddClientId(e.target.value)}
              placeholder="default"
              list="proxy-client-options"
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <datalist id="proxy-client-options">
              {clientIds.map(c => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <textarea
            value={rawText}
            onChange={e => setRawText(e.target.value)}
            rows={6}
            placeholder={`192.168.1.1:8000:user:pass\n10.0.0.1:8080:user:pass`}
            className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!rawText.trim() || pending}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium shadow-md text-white bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              Add Proxies
            </button>
          </div>
        </form>
      </div>

      {/* Filter + bulk actions */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3 flex-wrap">
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide mr-auto">Proxies</h2>

          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Filter</label>
          <select
            value={filterClient}
            onChange={e => setFilterClient(e.target.value)}
            className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All clients</option>
            {clientIds.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          {selected.size > 0 && (
            <div className="flex items-center gap-2 ml-2">
              <span className="text-xs text-slate-500">{selected.size} selected</span>
              <button
                onClick={() => handleBulkEnable(true)}
                disabled={pending}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-green-200 bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50"
              >
                <Power className="w-3.5 h-3.5" />
                Enable
              </button>
              <button
                onClick={() => handleBulkEnable(false)}
                disabled={pending}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50"
              >
                <PowerOff className="w-3.5 h-3.5" />
                Disable
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={pending}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60 text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-4 py-2 text-left">IP</th>
                <th className="px-4 py-2 text-left">Port</th>
                <th className="px-4 py-2 text-left">User</th>
                <th className="px-4 py-2 text-left">Client</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Last Used</th>
                <th className="px-4 py-2 text-left">Failures</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                    No proxies yet. Paste some above to get started.
                  </td>
                </tr>
              )}
              {!loading &&
                visible.map(p => (
                  <tr key={p._id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(p._id)}
                        onChange={() => toggleOne(p._id)}
                        aria-label={`Select ${p.ip}`}
                      />
                    </td>
                    <td className="px-4 py-2 font-mono text-slate-700">{p.ip}</td>
                    <td className="px-4 py-2 font-mono text-slate-600">{p.port}</td>
                    <td className="px-4 py-2 font-mono text-slate-500">{p.username}</td>
                    <td className="px-4 py-2 text-slate-600">{p.clientId}</td>
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        onClick={() => handleToggle(p._id, !p.enabled)}
                        disabled={pending}
                        className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border transition-colors ${
                          p.enabled
                            ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                            : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                        }`}
                      >
                        {p.enabled ? <Power className="w-3 h-3" /> : <PowerOff className="w-3 h-3" />}
                        {p.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">{formatDate(p.lastUsedAt)}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`px-1.5 py-0.5 text-xs rounded ${
                          p.failureCount > 0
                            ? 'bg-red-50 text-red-600 border border-red-200'
                            : 'text-slate-400'
                        }`}
                      >
                        {p.failureCount}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(p._id)}
                        disabled={pending}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50"
                      >
                        <Trash2 className="w-3 h-3" />
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-400 text-center">
        Scraper machines refresh from MongoDB every 5 minutes. Toggle changes will propagate within that window.
      </p>
    </div>
  );
}
