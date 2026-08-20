import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/dbConnect';
import { requireApiKey } from '@/lib/apiKey';

/**
 * POST /api/seed-jars
 *
 * Ingest a freshly minted tmpt cookie jar from the cookie-farm into the shared
 * `seed_jars` collection. This is the HTTP replacement for the farm writing to
 * Mongo directly (store.js#writeJar), so the farm can run anywhere and only
 * needs the portal URL + API key instead of a direct database connection.
 *
 * The GET /api/ticketmaster-state endpoint reads healthy jars from this same
 * collection, so a jar posted here is immediately servable to the extension.
 *
 * Auth: x-api-key header / Authorization: Bearer / ?apiKey= (see lib/apiKey).
 *
 * Body — mint a healthy jar:
 *   {
 *     "id": "machine-a::slot-0",          // OR provide machineId + slot below
 *     "machineId": "machine-a",
 *     "slot": 0,
 *     "cookies": [ { name, value, domain, path, expires, httpOnly, secure, sameSite }, ... ],
 *     "ttlMs": 3000000,                    // jar lifetime; expiresAt = now + ttlMs
 *     "seedEvent": "0E00634DCBC16E8B"      // optional
 *   }
 *
 * Body — mark a jar dead (farm slot sweep, mirrors store.js#markDead):
 *   { "id": "machine-a::slot-0", "status": "dead" }
 *
 * GET /api/seed-jars — read side for the farm (replaces its direct reads):
 *   ?id=machine-a::slot-0   → { ok, jar }        single jar or null (getSlot)
 *   ?machineId=machine-a    → { ok, jars: [...] } all jars for a machine
 *   ?stats=1                → { ok, pool }        pool-wide stats (poolStats)
 */

export const dynamic = 'force-dynamic';

type CookieIn = {
  name?: string;
  value?: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
};

type Body = {
  id?: string;
  machineId?: string;
  slot?: number;
  cookies?: CookieIn[];
  ttlMs?: number;
  expiresAt?: string | number;
  seedEvent?: string;
  status?: 'healthy' | 'dead';
};

export async function POST(req: NextRequest) {
  try {
    const denied = requireApiKey(req);
    if (denied) return denied;

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
    }

    // Resolve the namespaced jar id: explicit id, or machineId + slot.
    const id =
      (body.id && String(body.id).trim()) ||
      (body.machineId != null && body.slot != null
        ? `${body.machineId}::slot-${body.slot}`
        : '');
    if (!id) {
      return NextResponse.json(
        { ok: false, error: 'missing_id_or_machineId_slot' },
        { status: 400 }
      );
    }

    await dbConnect();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no_db_connection');
    // seed_jars uses a string _id ("<machineId>::slot-<n>"), not an ObjectId.
    const coll = db.collection<{ _id: string }>('seed_jars');

    // Mark-dead path (farm sweeps a removed/expired slot).
    if (body.status === 'dead') {
      const r = await coll.updateOne(
        { _id: id },
        { $set: { status: 'dead', updatedAt: new Date() } }
      );
      return NextResponse.json({ ok: true, id, marked: 'dead', matched: r.matchedCount });
    }

    // Mint path — must carry cookies.
    if (!Array.isArray(body.cookies) || body.cookies.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'missing_cookies' },
        { status: 400 }
      );
    }

    const now = Date.now();
    // expiresAt: prefer explicit, else now + ttlMs. Require one of them.
    let expiresAt: Date;
    if (body.expiresAt != null) {
      expiresAt = new Date(body.expiresAt);
    } else if (typeof body.ttlMs === 'number' && body.ttlMs > 0) {
      expiresAt = new Date(now + body.ttlMs);
    } else {
      return NextResponse.json(
        { ok: false, error: 'missing_ttlMs_or_expiresAt' },
        { status: 400 }
      );
    }
    if (isNaN(expiresAt.getTime())) {
      return NextResponse.json({ ok: false, error: 'invalid_expiresAt' }, { status: 400 });
    }

    // Derive machineId/slot from the id when not given, so pool stats keep working.
    const derivedMachineId =
      body.machineId ?? (id.includes('::') ? id.split('::')[0] : undefined);
    const derivedSlot =
      body.slot ??
      (() => {
        const m = id.match(/slot-(\d+)/);
        return m ? Number(m[1]) : undefined;
      })();

    const set: Record<string, unknown> = {
      cookies: body.cookies,
      count: body.cookies.length,
      status: 'healthy',
      useCount: 0, // reset per-token call budget on every fresh mint (mirrors writeJar)
      mintedAt: new Date(now),
      expiresAt,
      updatedAt: new Date(now),
    };
    if (derivedMachineId !== undefined) set.machineId = derivedMachineId;
    if (derivedSlot !== undefined) set.slot = derivedSlot;
    if (body.seedEvent !== undefined) set.seedEvent = body.seedEvent;

    await coll.updateOne({ _id: id }, { $set: set }, { upsert: true });

    return NextResponse.json({
      ok: true,
      id,
      count: body.cookies.length,
      status: 'healthy',
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error('[POST /api/seed-jars]', err);
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const denied = requireApiKey(req);
    if (denied) return denied;

    const sp = req.nextUrl.searchParams;
    await dbConnect();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no_db_connection');
    const coll = db.collection<{ _id: string }>('seed_jars');

    // Pool-wide stats (mirrors store.js#poolStats).
    if (sp.get('stats') != null) {
      const now = new Date();
      const docs = await coll
        .find({})
        .project({ status: 1, expiresAt: 1, machineId: 1, mintedAt: 1, useCount: 1 })
        .toArray();
      const healthy = docs.filter(
        (d) => d.status === 'healthy' && d.expiresAt && new Date(d.expiresAt) > now
      );
      const machines = new Set(healthy.map((d) => d.machineId).filter(Boolean));

      // Per-machine roll-up so a farm can tell a machine that is STALLED from one that is
      // merely quiet. Counting machines with a healthy jar is not enough: a jar outlives
      // its minter by up to its TTL (~50m), so a dead machine keeps being counted as
      // present for that whole window and the fleet under-provisions without noticing.
      // newestMintedAt is the liveness signal — a healthy farm mints every ~12 minutes.
      const byMachine = new Map<string, { machineId: string; jars: number; healthy: number; newestMintedAt: string | null }>();
      for (const d of docs) {
        const id = String(d.machineId || '').trim();
        if (!id) continue;
        const row = byMachine.get(id) || { machineId: id, jars: 0, healthy: 0, newestMintedAt: null };
        row.jars++;
        if (healthy.includes(d)) row.healthy++;
        if (d.mintedAt) {
          const t = new Date(d.mintedAt as Date);
          if (!row.newestMintedAt || t > new Date(row.newestMintedAt)) row.newestMintedAt = t.toISOString();
        }
        byMachine.set(id, row);
      }

      return NextResponse.json({
        ok: true,
        pool: {
          totalHealthy: healthy.length,
          machines: machines.size,          // kept as a COUNT — existing callers rely on it
          totalDocs: docs.length,
          machineList: [...byMachine.values()].sort((a, b) => a.machineId.localeCompare(b.machineId)),
        },
      });
    }

    // Single jar by id (mirrors store.js#getSlot).
    const id = sp.get('id');
    if (id) {
      const jar = await coll.findOne({ _id: id });
      return NextResponse.json({ ok: true, jar: jar ?? null });
    }

    // All jars for one machine (lets the farm read its slots in one round-trip).
    const machineId = sp.get('machineId');
    if (machineId) {
      const jars = await coll.find({ machineId }).toArray();
      return NextResponse.json({ ok: true, jars });
    }

    return NextResponse.json(
      { ok: false, error: 'specify id, machineId, or stats' },
      { status: 400 }
    );
  } catch (err) {
    console.error('[GET /api/seed-jars]', err);
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 });
  }
}
