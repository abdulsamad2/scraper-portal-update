import mongoose from 'mongoose';
import dbConnect from './dbConnect.js';
import { getAlertSettings } from './alertSettings.js';

/**
 * Cookie-farm capacity model, evaluated portal-side.
 *
 * The farm already computes this verdict for ITSELF (cookie-farm/farm.js#assessCapacity),
 * but only the machine running the farm can see it, and a machine that has stopped is
 * exactly the machine that stops reporting. The portal reads the same two numbers straight
 * from Mongo — the workable event count and the shared `seed_jars` pool — so the verdict
 * survives any single farm machine dying, which is the failure this is meant to catch.
 *
 * The arithmetic is kept identical to the farm's on purpose. Diverging here would produce
 * two different answers to "are we short?" with no way to tell which one is lying:
 *
 *   facetsPerMin    = workableEvents / (FARM_EVENT_REFRESH_MS / 60000)
 *   jarsNeeded      = ceil(facetsPerMin / JAR_RATE_CAP)
 *   eventsSupported = jarsFree * JAR_RATE_CAP * refreshMinutes
 *
 * With the shipped farm .env (JAR_RATE_CAP=20, FARM_EVENT_REFRESH_MS=120000) that reduces
 * to one free jar per 40 events.
 */

// These MUST track the farm's .env. A portal that assumes 20 facets/min while the farm is
// configured for 10 will report a comfortable surplus over a pool that is actually half
// the size it needs to be.
const JAR_RATE_CAP = Math.max(1, Number(process.env.JAR_RATE_CAP) || 20);
const EVENT_REFRESH_MS = Math.max(10_000, Number(process.env.FARM_EVENT_REFRESH_MS) || 120_000);

// A jar is retired by call budget as well as by clock. 0 disables the budget entirely,
// which is what the farm's own .env currently sets (JAR_CALL_BUDGET=0), so treat any
// non-positive value as "no budget" rather than as "budget of zero" — the latter would
// mark every jar in the pool spent.
const JAR_CALL_BUDGET = Math.max(0, Number(process.env.JAR_CALL_BUDGET) || 0);

// A jar outlives the machine that minted it by up to its TTL (~50 min), so "has a healthy
// jar" cannot distinguish a live machine from one that died 40 minutes ago. Freshness of
// the newest mint is the only honest liveness signal. A healthy farm mints every ~12 min.
const MACHINE_STALE_MS = Math.max(60_000, Number(process.env.FARM_MACHINE_STALE_MIN ?? 45) * 60_000);

// Cleanup grace period. An expired jar on a running machine may still be mid-cycle, so
// deleting the instant it expires races the farm's own re-mint bookkeeping.
const CLEANUP_MIN_AGE_MS = Math.max(0, Number(process.env.FARM_CLEANUP_MIN_AGE_HOURS ?? 24) * 3_600_000);

// Spare units at or below this count is treated as a problem worth alerting on, not a
// comfortable margin. Default 3: at 40 events per unit, three spare is roughly one worker
// going offline away from dropping events.
const SURPLUS_THIN_AT = Math.max(0, Number(process.env.FARM_SURPLUS_THIN_AT ?? 3));

// An event that has not been refreshed in this long is stale. The scrapers cycle every
// couple of minutes, so five is comfortably outside normal jitter.
const STALE_AFTER_MIN = Math.max(1, Number(process.env.EVENT_STALE_AFTER_MIN ?? 5));

function db() {
  const conn = mongoose.connection.db;
  if (!conn) throw new Error('no_db_connection');
  return conn;
}

/**
 * Count the events the farm can actually work on.
 *
 * Deliberately NOT `countDocuments({ Skip_Scraping: { $ne: true } })`. The farm drops rows
 * the portal happily lists — already finished, listed twice, or carrying no usable
 * Ticketmaster link — and sizes itself against what is left. Counting the portal's larger
 * number here would understate demand relative to the farm's own view and the two would
 * disagree about whether the pool is short. Mirrors cookie-farm seed.js#eventPoolStats.
 */
export async function workableEventCount() {
  const rows = await db()
    .collection('events')
    .find({}, { projection: { Event_ID: 1, URL: 1, Event_DateTime: 1, Skip_Scraping: 1 } })
    .toArray();

  const now = Date.now();
  const seen = new Set();
  let skipped = 0;
  let past = 0;
  let duplicate = 0;
  let noId = 0;
  let counted = 0;

  for (const r of rows) {
    if (r.Skip_Scraping === true) { skipped++; continue; }

    const when = r.Event_DateTime ? new Date(r.Event_DateTime) : null;
    if (when && !isNaN(when.getTime()) && when.getTime() <= now) { past++; continue; }

    const id = String(r.Event_ID ?? '').trim();
    const url = String(r.URL ?? '').trim();
    if (!id && !url) { noId++; continue; }

    const key = id || url;
    if (seen.has(key)) { duplicate++; continue; }
    seen.add(key);
    counted++;
  }

  return { rows: rows.length, skipped, past, duplicate, noId, workable: counted };
}

/**
 * How many live events have not been refreshed recently.
 *
 * This is the outcome the capacity numbers are a proxy for. Capacity can look adequate while
 * events still go stale — a worker wedged mid-cycle, a scraper crash-looping — so this is
 * measured directly rather than inferred, and alerts on its own.
 *
 * Counts only events we would expect to be updated: skip-flagged and finished events are
 * excluded, exactly as workableEventCount does.
 */
export async function staleEventStats(afterMinutes = STALE_AFTER_MIN) {
  const cutoff = new Date(Date.now() - afterMinutes * 60_000);
  const now = new Date();

  const base = {
    Skip_Scraping: { $ne: true },
    $or: [{ Event_DateTime: { $gt: now } }, { Event_DateTime: { $exists: false } }],
  };

  const [stale, sample] = await Promise.all([
    db().collection('events').countDocuments({ ...base, Last_Updated: { $lt: cutoff } }),
    db()
      .collection('events')
      .find({ ...base, Last_Updated: { $lt: cutoff } })
      .project({ Event_Name: 1, Event_ID: 1, Last_Updated: 1 })
      .sort({ Last_Updated: 1 })
      .limit(5)
      .toArray(),
  ]);

  return {
    staleCount: stale,
    afterMinutes,
    oldest: sample.map((e) => ({
      name: e.Event_Name ?? e.Event_ID ?? 'unknown',
      minutesAgo: e.Last_Updated
        ? Math.round((Date.now() - new Date(e.Last_Updated).getTime()) / 60_000)
        : null,
    })),
  };
}

/**
 * Pool stats over the shared `seed_jars` collection.
 *
 * `totalFree` is the number that matters and `totalHealthy` is the one that misleads. The
 * scrapers lease a jar one-to-one to a single page (browser-cookies.js#leaseFarmJar) and
 * skip anything already held, so a fully-leased pool of 13 healthy jars serves no new work
 * at all while every instance logs "no farm jar available".
 */
export async function poolStats() {
  const now = new Date();
  const docs = await db()
    .collection('seed_jars')
    .find({}, {
      projection: {
        status: 1, expiresAt: 1, machineId: 1, slot: 1,
        mintedAt: 1, useCount: 1, leaseUntil: 1,
      },
    })
    .toArray();

  const isLive = (d) =>
    d.status === 'healthy' && d.expiresAt && new Date(d.expiresAt) > now;
  const withinBudget = (d) =>
    !JAR_CALL_BUDGET || (d.useCount ?? 0) < JAR_CALL_BUDGET;
  const isFree = (d) => !d.leaseUntil || new Date(d.leaseUntil) <= now;

  const healthy = docs.filter(isLive);
  const servable = healthy.filter(withinBudget);
  const free = servable.filter(isFree);

  // Per-machine roll-up. `healthy` alone cannot tell a stalled machine from a quiet one,
  // so carry the newest mint per machine and let the caller judge liveness by age.
  const byMachine = new Map();
  for (const d of docs) {
    const id = String(d.machineId ?? '').trim();
    if (!id) continue;
    const row = byMachine.get(id) ?? {
      machineId: id, jars: 0, healthy: 0, free: 0, newestMintedAt: null,
    };
    row.jars++;
    if (healthy.includes(d)) row.healthy++;
    if (free.includes(d)) row.free++;
    if (d.mintedAt) {
      const t = new Date(d.mintedAt);
      if (!isNaN(t.getTime()) && (!row.newestMintedAt || t > row.newestMintedAt)) {
        row.newestMintedAt = t;
      }
    }
    byMachine.set(id, row);
  }

  const machines = [...byMachine.values()]
    .map((m) => {
      const ageMs = m.newestMintedAt ? now - m.newestMintedAt : null;
      return {
        ...m,
        newestMintedAt: m.newestMintedAt ? m.newestMintedAt.toISOString() : null,
        idleMinutes: ageMs == null ? null : Math.round(ageMs / 60_000),
        // "Minting" is judged by recent mint activity, never by holding a healthy jar.
        minting: ageMs != null && ageMs <= MACHINE_STALE_MS,
      };
    })
    .sort((a, b) => a.machineId.localeCompare(b.machineId));

  const staleRecords = docs.filter(
    (d) => d.status === 'healthy' && d.expiresAt && new Date(d.expiresAt) <= now
  ).length;

  return {
    totalDocs: docs.length,
    totalHealthy: healthy.length,
    totalServable: servable.length,
    totalFree: free.length,
    // Nothing flips status on expiry, so "healthy" records outlive their jars. Surfaced
    // so the dashboard can show the gap rather than quietly counting them as real.
    staleHealthyRecords: staleRecords,
    deadRecords: docs.filter((d) => d.status === 'dead').length,
    machinesTotal: machines.length,
    machinesMinting: machines.filter((m) => m.minting).length,
    machines,
  };
}

/**
 * The verdict. Returns `state` of ok | thin | exact | short, matching the farm's vocabulary.
 */
export function assessCapacity(events, pool, { thinAt = SURPLUS_THIN_AT } = {}) {
  const refreshMin = EVENT_REFRESH_MS / 60_000;
  const workable = Number(events?.workable) || 0;
  const perMin = workable / refreshMin;
  const needed = Math.ceil(perMin / JAR_RATE_CAP);

  /**
   * Capacity is measured in HEALTHY sets, and utilisation is reported separately.
   *
   * The farm sizes itself on `totalFree` because it is deciding whether to mint one more
   * jar this instant. That is the wrong lens for a dashboard. A lease lasts ~4 minutes and
   * is handed straight back, so `totalFree` is a sample of who happens to be mid-request at
   * the moment of the read: it swung 0 -> 2 -> 0 across consecutive reads on a pool of 16
   * healthy sets. Reporting that as "0 cookie sets we have" tells an operator the pool has
   * collapsed when it is simply busy, and an alarm on it would fire more or less forever.
   *
   * Sustained capacity is what a set can serve over its life — JAR_RATE_CAP per minute,
   * whether or not it is leased at the instant we look. So `have` counts every healthy,
   * in-budget set, and `free` rides alongside as the contention signal: free === 0 with
   * plenty healthy means fully utilised, which is worth showing but is not a shortage.
   */
  const have = Number(pool?.totalServable ?? pool?.totalHealthy) || 0;
  const free = Number(pool?.totalFree) || 0;
  const surplus = have - needed;

  const state =
    surplus < 0 ? 'short'
    : surplus === 0 ? 'exact'
    : surplus <= thinAt ? 'thin'
    : 'ok';

  return {
    activeEvents: workable,
    facetsPerMin: Math.round(perMin),
    jarsNeeded: needed,
    jarsAvailable: have,
    jarsHealthy: Number(pool?.totalHealthy) || 0,
    // Utilisation, not capacity: how many sets are idle vs held by a scraper right now.
    jarsFree: free,
    jarsInUse: Math.max(0, have - free),
    fullyUtilised: have > 0 && free === 0,
    surplus,
    eventsSupported: have * JAR_RATE_CAP * refreshMin,
    eventsPerJar: JAR_RATE_CAP * refreshMin,
    machinesTotal: Number(pool?.machinesTotal) || 0,
    machinesMinting: Number(pool?.machinesMinting) || 0,
    state,
    config: {
      jarRateCap: JAR_RATE_CAP,
      eventRefreshMs: EVENT_REFRESH_MS,
      jarCallBudget: JAR_CALL_BUDGET,
      machineStaleMinutes: Math.round(MACHINE_STALE_MS / 60_000),
      surplusThinAt: thinAt,
    },
  };
}

/** Full snapshot: events + pool + verdict, in one round trip's worth of reads. */
export async function farmHealth({ staleAfterMinutes, thinAt } = {}) {
  await dbConnect();
  const [events, pool, stale] = await Promise.all([
    workableEventCount(),
    poolStats(),
    staleEventStats(staleAfterMinutes ?? STALE_AFTER_MIN),
  ]);
  return {
    at: new Date().toISOString(),
    events,
    pool,
    stale,
    capacity: assessCapacity(events, pool, { thinAt: thinAt ?? SURPLUS_THIN_AT }),
  };
}

/**
 * Delete jars whose life is definitively over.
 *
 * Scope is expired AND older than the grace period, which covers both the `dead` records
 * and the `healthy`-but-expired ones that nothing ever flipped. The grace period exists
 * because a slot that expired seconds ago on a running machine is about to be re-minted
 * into the SAME _id; removing the document under the farm mid-cycle buys nothing and
 * races its bookkeeping. A jar older than the grace period is not coming back.
 *
 * Live jars are never touched: the filter requires expiresAt in the past, so a healthy
 * unexpired jar cannot match regardless of its other fields.
 */
export async function cleanupExpiredJars({ dryRun = false } = {}) {
  await dbConnect();
  const cutoff = new Date(Date.now() - CLEANUP_MIN_AGE_MS);
  const filter = { expiresAt: { $lte: cutoff } };
  const coll = db().collection('seed_jars');

  const matched = await coll.countDocuments(filter);
  if (dryRun) {
    return { dryRun: true, matched, deleted: 0, cutoff: cutoff.toISOString() };
  }

  const res = await coll.deleteMany(filter);
  return {
    dryRun: false,
    matched,
    deleted: res.deletedCount ?? 0,
    cutoff: cutoff.toISOString(),
    graceHours: Math.round(CLEANUP_MIN_AGE_MS / 3_600_000),
  };
}

/**
 * The snapshot every caller should use.
 *
 * Applies the operator's saved thresholds, so the page, the scheduled check and the alert
 * all judge "is this a problem?" by the same rule. Reading settings separately in each
 * caller is how a dashboard ends up showing green while an alarm is firing.
 */
export async function currentHealth() {
  let settings;
  try {
    settings = await getAlertSettings();
  } catch {
    settings = {};
  }
  return farmHealth({
    thinAt: settings.minSpareUnits,
    staleAfterMinutes: settings.staleEventMinutes,
  });
}
