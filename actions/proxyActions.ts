'use server';
import dbConnect from '../lib/dbConnect';
import { Proxy } from '../models/proxyModel';
import { revalidatePath } from 'next/cache';

export interface ProxyRecord {
  _id: string;
  ip: string;
  port: string;
  username: string;
  password: string;
  clientId: string;
  enabled: boolean;
  notes: string;
  failureCount: number;
  lastUsedAt: string | null;
  lastFailureAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listProxies(clientId?: string): Promise<ProxyRecord[]> {
  await dbConnect();
  const filter = clientId ? { clientId } : {};
  const rows = await Proxy.find(filter).sort({ clientId: 1, createdAt: -1 }).lean();
  return JSON.parse(JSON.stringify(rows));
}

export type ProxyListQuery = {
  clientId?: string;
  search?: string;
  enabled?: 'all' | 'enabled' | 'disabled';
  sortBy?: 'createdAt' | 'lastUsedAt' | 'failureCount' | 'ip' | 'clientId';
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
};

export type ProxyListResult = {
  rows: ProxyRecord[];
  total: number;
  page: number;
  limit: number;
  stats: { total: number; enabled: number; disabled: number; clients: number };
};

export async function listProxiesPaged(q: ProxyListQuery = {}): Promise<ProxyListResult> {
  await dbConnect();
  const page = Math.max(1, q.page ?? 1);
  const limit = Math.min(500, Math.max(5, q.limit ?? 50));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (q.clientId) filter.clientId = q.clientId;
  if (q.enabled === 'enabled') filter.enabled = true;
  if (q.enabled === 'disabled') filter.enabled = false;
  if (q.search?.trim()) {
    const safe = q.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(safe, 'i');
    filter.$or = [
      { ip: rx },
      { port: rx },
      { username: rx },
      { clientId: rx },
      { notes: rx },
    ];
  }

  const sortBy = q.sortBy ?? 'createdAt';
  const sortDir = q.sortDir === 'asc' ? 1 : -1;

  const [rows, total, statsAgg] = await Promise.all([
    Proxy.find(filter).sort({ [sortBy]: sortDir }).skip(skip).limit(limit).lean(),
    Proxy.countDocuments(filter),
    Proxy.aggregate([
      { $match: q.clientId ? { clientId: q.clientId } : {} },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          enabled: { $sum: { $cond: ['$enabled', 1, 0] } },
          clients: { $addToSet: '$clientId' },
        },
      },
    ]),
  ]);

  const s = statsAgg[0];
  const stats = s
    ? { total: s.total, enabled: s.enabled, disabled: s.total - s.enabled, clients: s.clients.length }
    : { total: 0, enabled: 0, disabled: 0, clients: 0 };

  return {
    rows: JSON.parse(JSON.stringify(rows)),
    total,
    page,
    limit,
    stats,
  };
}

export async function listClientIds(): Promise<string[]> {
  await dbConnect();
  const ids = await Proxy.distinct('clientId');
  return (ids as string[]).filter(Boolean).sort();
}

export async function bulkAddProxies(rawText: string, clientId = 'default') {
  await dbConnect();
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const ops: Parameters<typeof Proxy.bulkWrite>[0] = [];
  let skipped = 0;
  // Collapse duplicate identities within a single paste. Two upserts with the
  // same {ip,port,username} filter in one unordered bulkWrite would race and
  // throw a duplicate-key error ("can't be added"); last line wins instead.
  const seen = new Map<string, number>();

  for (const line of lines) {
    const [ip, port, username, password] = line.split(':');
    if (!ip || !port || !username || !password) {
      skipped++;
      continue;
    }
    // Full identity INCLUDES the password — gateway providers share one
    // ip:port:username across many rotating sessions that differ only by a
    // token in the password, so password must be in the key or they collapse
    // onto a single row. Doubles as proxy_id so the shared collection's unique
    // proxy_id index gets a non-null, stable value instead of colliding on null.
    const key = `${ip}:${port}:${username}:${password}`;
    const op = {
      updateOne: {
        // Match on the full identity (incl. password) so each rotating session
        // is stored separately instead of overwriting one another / colliding
        // on the unique index.
        filter: { ip, port, username, password },
        update: { $set: { proxy_id: key, ip, port, username, password, clientId, enabled: true } },
        upsert: true,
      },
    };
    // Collapse duplicate identities within a single paste. Two upserts with the
    // same filter in one unordered bulkWrite would race into a duplicate-key
    // error ("can't be added"); last line wins instead.
    const existingIdx = seen.get(key);
    if (existingIdx !== undefined) {
      ops[existingIdx] = op;
      continue;
    }
    seen.set(key, ops.length);
    ops.push(op);
  }

  if (!ops.length) {
    return { success: true, added: 0, updated: 0, skipped };
  }

  const res = await Proxy.bulkWrite(ops, { ordered: false });
  revalidatePath('/dashboard/proxies');
  return {
    success: true,
    added: res.upsertedCount || 0,
    updated: res.modifiedCount || 0,
    skipped,
  };
}

export async function toggleProxy(id: string, enabled: boolean) {
  await dbConnect();
  await Proxy.updateOne({ _id: id }, { $set: { enabled } });
  revalidatePath('/dashboard/proxies');
  return { success: true };
}

export async function updateProxyClient(id: string, clientId: string) {
  await dbConnect();
  await Proxy.updateOne({ _id: id }, { $set: { clientId: clientId || 'default' } });
  revalidatePath('/dashboard/proxies');
  return { success: true };
}

export async function deleteProxy(id: string) {
  await dbConnect();
  await Proxy.deleteOne({ _id: id });
  revalidatePath('/dashboard/proxies');
  return { success: true };
}

export async function deleteProxiesBulk(ids: string[]) {
  if (!ids?.length) return { success: true, deleted: 0 };
  await dbConnect();
  const res = await Proxy.deleteMany({ _id: { $in: ids } });
  revalidatePath('/dashboard/proxies');
  return { success: true, deleted: res.deletedCount || 0 };
}

export async function setProxiesEnabledBulk(ids: string[], enabled: boolean) {
  if (!ids?.length) return { success: true, updated: 0 };
  await dbConnect();
  const res = await Proxy.updateMany({ _id: { $in: ids } }, { $set: { enabled } });
  revalidatePath('/dashboard/proxies');
  return { success: true, updated: res.modifiedCount || 0 };
}
