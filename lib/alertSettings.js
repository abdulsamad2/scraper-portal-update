import dbConnect from './dbConnect.js';
import { AlertSettings } from '../models/alertSettingsModel.js';

/**
 * Alert settings, editable from the portal.
 *
 * Precedence is database first, environment second. Env is the seed for a fresh install;
 * the moment someone saves from the UI, that is the truth. The other way round would mean
 * the page shows one number while a leftover env var quietly sends to another.
 *
 * Everything here is fail-soft. If Mongo is unreachable we fall back to env rather than
 * throwing: an alerting path that can crash the service it monitors is worse than no alert.
 */

// Env seeds a fresh install only. Comma-separated so a first boot can name several people.
const ENV_TO = (process.env.WHATSAPP_WEB_TO ?? process.env.WHATSAPP_TO ?? '').trim();
const ENV_RECIPIENTS = ENV_TO.split(',').map((x) => x.trim()).filter(Boolean);
const ENV_ENABLED = /^(1|true|yes)$/i.test(process.env.WHATSAPP_WEB_ENABLED ?? '');
const ENV_REPEAT = Number(process.env.FARM_ALERT_REPEAT_MIN ?? 30);
const ENV_MIN_SPARE = Number(process.env.FARM_SURPLUS_THIN_AT ?? 3);
const ENV_STALE_MIN = Number(process.env.EVENT_STALE_AFTER_MIN ?? 5);
const ENV_STALE_COUNT = Number(process.env.EVENT_STALE_COUNT ?? 5);

// Cached briefly so a send and the page render in the same second don't each hit Mongo,
// while an edit still takes effect almost immediately.
const TTL_MS = 5_000;
const GLOBAL_KEY = '__alertSettingsCache_v1__';

function cache() {
  if (!globalThis[GLOBAL_KEY]) globalThis[GLOBAL_KEY] = { at: 0, value: null };
  return globalThis[GLOBAL_KEY];
}

/**
 * Reduce anything an operator might paste to bare E.164 digits.
 *
 * Accepts "+92 300 1234567", "0092-300-1234567", "923001234567". A LOCAL number with a
 * leading 0 and no country code cannot be resolved here — we do not know the country — so
 * it is returned as-is and rejected by validation, which tells the operator what is wrong
 * instead of silently messaging the wrong person.
 */
export function normalizeNumber(input) {
  let s = String(input ?? '').replace(/[^\d+]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  // 00 is the international prefix in much of the world; strip it to reach the country code.
  if (s.startsWith('00')) s = s.slice(2);
  return s;
}

/** Returns null when valid, otherwise a message written for the person typing it. */
export function validateNumber(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return 'Enter a phone number.';
  const n = normalizeNumber(raw);
  if (!/^\d+$/.test(n)) return 'Use digits only, with the country code.';
  if (n.startsWith('0')) {
    return 'Start with the country code, not 0 — for example 923001234567, not 03001234567.';
  }
  if (n.length < 8 || n.length > 15) {
    return 'That does not look like a full number. Include the country code, e.g. 923001234567.';
  }
  return null;
}

/** Current settings, database first and environment as the fallback. */
export async function getAlertSettings() {
  const c = cache();
  if (c.value && Date.now() - c.at < TTL_MS) return c.value;

  let doc = null;
  try {
    await dbConnect();
    doc = await AlertSettings.findOne({ key: 'singleton' }).lean();
  } catch {
    // Fall through to env — never let a database blip take the alarm config down.
  }

  const value = {
    enabled: doc ? !!doc.enabled : ENV_ENABLED,
    senderNumber: doc?.senderNumber ?? '',
    // recipients wins; the legacy single field is the fallback so an install that upgrades
    // mid-incident keeps alerting instead of going quiet.
    recipients:
      doc?.recipients?.length ? doc.recipients
      : doc?.whatsappTo ? [doc.whatsappTo]
      : ENV_RECIPIENTS,
    repeatMinutes: doc?.repeatMinutes ?? (Number.isFinite(ENV_REPEAT) ? ENV_REPEAT : 30),
    minSpareUnits: doc?.minSpareUnits ?? (Number.isFinite(ENV_MIN_SPARE) ? ENV_MIN_SPARE : 3),
    staleEventMinutes: doc?.staleEventMinutes ?? (Number.isFinite(ENV_STALE_MIN) ? ENV_STALE_MIN : 5),
    staleEventCount: doc?.staleEventCount ?? (Number.isFinite(ENV_STALE_COUNT) ? ENV_STALE_COUNT : 5),
    // Tells the UI whether it is showing a saved value or an inherited default.
    source: doc ? 'saved' : 'environment',
    updatedAt: doc?.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
  };

  c.at = Date.now();
  c.value = value;
  return value;
}

/** Save from the portal. Returns { ok, error?, settings? }. */
export async function saveAlertSettings(input = {}) {
  const { enabled, recipients, senderNumber, repeatMinutes, updatedBy } = input;
  const update = { key: 'singleton' };

  if (recipients !== undefined) {
    const list = (Array.isArray(recipients) ? recipients : [recipients])
      .map((r) => String(r ?? '').trim())
      .filter(Boolean);

    // Turning alerts on with nowhere to send is a setting that looks configured and does
    // nothing, so it is refused rather than saved.
    if (list.length === 0 && enabled) {
      return { ok: false, error: 'Add at least one number to alert, or switch alerts off.' };
    }

    const seen = new Set();
    const clean = [];
    for (const r of list) {
      const bad = validateNumber(r);
      if (bad) return { ok: false, error: `${r}: ${bad}` };
      const n = normalizeNumber(r);
      // Silently de-duplicate rather than messaging the same person twice per alert.
      if (seen.has(n)) continue;
      seen.add(n);
      clean.push(n);
    }
    update.recipients = clean;

    // Consume the legacy single-recipient field on the first save that writes a list.
    // Without this, `recipients: []` falls back to `whatsappTo` on the next read and a
    // number the operator just deleted comes straight back — the delete appears to work
    // and then silently undoes itself.
    update.whatsappTo = '';
  }

  if (senderNumber !== undefined) {
    const raw = String(senderNumber ?? '').trim();
    if (raw === '') {
      update.senderNumber = '';
    } else {
      const bad = validateNumber(raw);
      if (bad) return { ok: false, error: `Sending number — ${bad}` };
      update.senderNumber = normalizeNumber(raw);
    }
  }

  if (enabled !== undefined) update.enabled = !!enabled;

  if (repeatMinutes !== undefined) {
    const n = Number(repeatMinutes);
    if (!Number.isFinite(n) || n < 5 || n > 1440) {
      return { ok: false, error: 'Re-alert time must be between 5 and 1440 minutes.' };
    }
    update.repeatMinutes = Math.round(n);
  }

  for (const [field, label, lo, hi] of [
    ['minSpareUnits', 'Spare-unit warning level', 0, 500],
    ['staleEventMinutes', 'Stale-event minutes', 1, 1440],
    ['staleEventCount', 'Stale-event count', 1, 10000],
  ]) {
    const raw = input[field];
    if (raw === undefined) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < lo || n > hi) {
      return { ok: false, error: `${label} must be between ${lo} and ${hi}.` };
    }
    update[field] = Math.round(n);
  }

  if (updatedBy) update.updatedBy = updatedBy;

  try {
    await dbConnect();
    await AlertSettings.findOneAndUpdate({ key: 'singleton' }, update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
      runValidators: true,
    });
  } catch (e) {
    return { ok: false, error: e?.message ?? 'Could not save.' };
  }

  // Drop the cache so the next read — and the next alert — sees this immediately.
  const c = cache();
  c.at = 0;
  c.value = null;

  return { ok: true, settings: await getAlertSettings() };
}
