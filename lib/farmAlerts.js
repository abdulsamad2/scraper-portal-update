/**
 * Outbound alarms for cookie-farm capacity.
 *
 * Transports are additive — WhatsApp and/or Discord, whichever is configured. WhatsApp is
 * the one asked for; Discord is kept because the portal already speaks it and an infra
 * alarm is worth mirroring where the team already looks.
 *
 * WhatsApp has three provider shapes, tried in this order:
 *
 *   whatsapp-web.js  (default — free, no Meta account, QR-linked session)
 *     WHATSAPP_WEB_ENABLED=true
 *     WHATSAPP_WEB_TO           E.164 without '+', e.g. 923001234567
 *     See lib/whatsappClient.js for the session/Chromium caveats. Unofficial: WhatsApp
 *     may block the number, so use one you can afford to lose.
 *
 * …and the two paid/official fallbacks, selected by which env vars are present:
 *
 *   Meta WhatsApp Cloud API  (recommended — official, no dependency)
 *     WHATSAPP_PHONE_NUMBER_ID   from the Meta app dashboard
 *     WHATSAPP_ACCESS_TOKEN      permanent system-user token
 *     WHATSAPP_TO                recipient in E.164 without '+', e.g. 923001234567
 *
 *   Twilio WhatsApp  (fallback — easier to trial via their sandbox)
 *     TWILIO_ACCOUNT_SID
 *     TWILIO_AUTH_TOKEN
 *     TWILIO_WHATSAPP_FROM       e.g. whatsapp:+14155238886
 *     TWILIO_WHATSAPP_TO         e.g. whatsapp:+923001234567
 *
 * Both are plain HTTPS calls via global fetch, so neither pulls in an SDK.
 *
 * IMPORTANT — the 24-hour window. Meta only allows free-form text to a number that has
 * messaged you within 24h. An alarm at 4am fires into a cold window and the API rejects it,
 * which is precisely when you need it most. For reliable delivery, set WHATSAPP_TEMPLATE_NAME
 * to an approved template; this module then sends a template message instead of free-form.
 * Without one, expect delivery only inside an open session — the send result says which.
 *
 * Never throws to the caller: an alarm path that can crash the thing it monitors is worse
 * than no alarm.
 */

import { whatsAppEnabled, whatsAppStatus, sendWhatsAppWeb, whatsAppTarget } from './whatsappClient.js';

const WHATSAPP_PHONE_NUMBER_ID = (process.env.WHATSAPP_PHONE_NUMBER_ID ?? '').trim();
const WHATSAPP_ACCESS_TOKEN = (process.env.WHATSAPP_ACCESS_TOKEN ?? '').trim();
const WHATSAPP_TO = (process.env.WHATSAPP_TO ?? '').trim();
const WHATSAPP_TEMPLATE_NAME = (process.env.WHATSAPP_TEMPLATE_NAME ?? '').trim();
const WHATSAPP_TEMPLATE_LANG = (process.env.WHATSAPP_TEMPLATE_LANG ?? 'en_US').trim();
const WHATSAPP_API_VERSION = (process.env.WHATSAPP_API_VERSION ?? 'v21.0').trim();

const TWILIO_ACCOUNT_SID = (process.env.TWILIO_ACCOUNT_SID ?? '').trim();
const TWILIO_AUTH_TOKEN = (process.env.TWILIO_AUTH_TOKEN ?? '').trim();
const TWILIO_WHATSAPP_FROM = (process.env.TWILIO_WHATSAPP_FROM ?? '').trim();
const TWILIO_WHATSAPP_TO = (process.env.TWILIO_WHATSAPP_TO ?? '').trim();

// Own webhook so infra alarms don't land in the inventory buy-signal channel, which fires
// constantly and would bury them. Falls back to the existing one when unset.
const DISCORD_WEBHOOK =
  (process.env.FARM_ALERT_WEBHOOK_URL ?? process.env.DISCORD_WEBHOOK_URL ?? '').trim();

// Env is only the fallback — the live value is edited from the portal and read per alert.
const ENV_REPEAT_MS = Math.max(60_000, Number(process.env.FARM_ALERT_REPEAT_MIN ?? 30) * 60_000);

const GLOBAL_KEY = '__farmAlertState_v1__';

function state() {
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = {
      sentAt: new Map(),   // key -> last send time
      lastState: null,     // for recovery detection
      suppressed: 0,
      history: [],         // recent sends, newest first, for the dashboard
    };
  }
  return globalThis[GLOBAL_KEY];
}

export function alertConfig() {
  const web = whatsAppEnabled();
  const cloud = !!(WHATSAPP_PHONE_NUMBER_ID && WHATSAPP_ACCESS_TOKEN && WHATSAPP_TO);
  const twilio = !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_WHATSAPP_FROM && TWILIO_WHATSAPP_TO);
  const web_status = web ? whatsAppStatus() : null;
  return {
    whatsapp: web ? 'whatsapp-web' : cloud ? 'cloud-api' : twilio ? 'twilio' : null,
    whatsappReady: web || cloud || twilio,
    // whatsapp-web.js can be "configured" yet unable to send because the session is not
    // linked. Surface the live session state so the dashboard distinguishes "no transport"
    // from "transport waiting for a QR scan" — very different fixes.
    whatsappSession: web_status ? web_status.state : null,
    whatsappLinked: web ? web_status.state === 'ready' : cloud || twilio,
    // Free-form text only lands inside an open 24h session; a template is what makes an
    // unprompted 4am alarm actually arrive. Only applies to the official Cloud API.
    whatsappTemplate: !web && cloud ? (WHATSAPP_TEMPLATE_NAME || null) : null,
    discordReady: !!DISCORD_WEBHOOK,
    repeatMinutes: whatsAppStatus().repeatMinutes ?? Math.round(ENV_REPEAT_MS / 60_000),
    // Recipients are shown truncated — enough to confirm the right number is wired up
    // without printing it in full to every dashboard viewer.
    whatsappTo: web ? web_status.configuredTo : cloud ? maskNumber(WHATSAPP_TO) : twilio ? maskNumber(TWILIO_WHATSAPP_TO) : null,
  };
}

function maskNumber(n) {
  const s = String(n).replace(/^whatsapp:/, '');
  return s.length <= 4 ? '****' : `${s.slice(0, 3)}…${s.slice(-3)}`;
}

async function sendWhatsAppCloud(text) {
  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const payload = WHATSAPP_TEMPLATE_NAME
    ? {
        messaging_product: 'whatsapp',
        to: WHATSAPP_TO,
        type: 'template',
        template: {
          name: WHATSAPP_TEMPLATE_NAME,
          language: { code: WHATSAPP_TEMPLATE_LANG },
          // One body parameter carrying the whole alarm line. The approved template must
          // therefore declare exactly one {{1}} in its body.
          components: [{ type: 'body', parameters: [{ type: 'text', text }] }],
        },
      }
    : {
        messaging_product: 'whatsapp',
        to: WHATSAPP_TO,
        type: 'text',
        text: { preview_url: false, body: text },
      };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (res.ok) return { ok: true, via: 'cloud-api' };

  // Surface Meta's reason rather than a bare false — "outside the 24h window" and "bad
  // token" need completely different fixes and are indistinguishable from a boolean.
  let detail = `HTTP ${res.status}`;
  try {
    const body = await res.json();
    if (body?.error?.message) detail = body.error.message;
  } catch { /* keep the status line */ }
  return { ok: false, via: 'cloud-api', error: detail };
}

async function sendWhatsAppTwilio(text) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const form = new URLSearchParams({
    From: TWILIO_WHATSAPP_FROM,
    To: TWILIO_WHATSAPP_TO,
    Body: text,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });

  if (res.ok) return { ok: true, via: 'twilio' };
  let detail = `HTTP ${res.status}`;
  try {
    const body = await res.json();
    if (body?.message) detail = body.message;
  } catch { /* keep the status line */ }
  return { ok: false, via: 'twilio', error: detail };
}

async function sendWhatsApp(text, opts = {}) {
  try {
    // whatsapp-web.js first: it is the free path and the one explicitly chosen. The official
    // providers stay as fallbacks so a blocked or unlinked session can be switched over by
    // env alone, without a code change.
    //
    // Routing looks at whether RECIPIENTS exist, not at whether alerts are switched on.
    // Gating on the master switch sent a test down to the unconfigured Cloud/Twilio
    // branches, which then reported "not configured" — hiding the fact that a number was
    // saved and alerts were merely turned off.
    const target = await whatsAppTarget();
    if (whatsAppEnabled() || target?.recipients?.length) {
      return await sendWhatsAppWeb(text, opts);
    }
    if (WHATSAPP_PHONE_NUMBER_ID && WHATSAPP_ACCESS_TOKEN && WHATSAPP_TO) {
      return await sendWhatsAppCloud(text);
    }
    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_WHATSAPP_FROM && TWILIO_WHATSAPP_TO) {
      return await sendWhatsAppTwilio(text);
    }
    return { ok: false, via: 'whatsapp', error: 'no phone number is set — add one above and save' };
  } catch (e) {
    return { ok: false, via: 'whatsapp', error: e?.message ?? String(e) };
  }
}

async function sendDiscord(title, text, color) {
  if (!DISCORD_WEBHOOK) return { ok: false, via: null, error: 'discord not configured' };
  try {
    const res = await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'Service Monitor',
        embeds: [{ title, description: text, color, timestamp: new Date().toISOString() }],
      }),
    });
    return res.ok ? { ok: true, via: 'discord' } : { ok: false, via: 'discord', error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, via: 'discord', error: e?.message ?? String(e) };
  }
}

/** Human-readable alarm body, shared by every transport. */
export function formatCapacityMessage(cap, pool) {
  const icon = cap.state === 'short' ? '\u{1F534}' : cap.state === 'exact' ? '\u{1F7E0}' : '\u{1F7E1}';
  const lines = [
    `${icon} Capacity ${cap.state.toUpperCase()}`,
    `Units ${cap.jarsAvailable} of ${cap.jarsNeeded} needed (${cap.surplus >= 0 ? '+' : ''}${cap.surplus} spare)`,
    `Events ${cap.activeEvents} · can cover ${cap.eventsSupported}`,
    `In use ${cap.jarsInUse} · idle ${cap.jarsFree}`,
    `Workers online ${cap.machinesMinting} of ${cap.machinesTotal}`,
  ];
  const stalled = (pool?.machines ?? []).filter((m) => !m.minting);
  if (stalled.length) {
    const names = stalled.slice(0, 5).map((m) => `${m.machineId} (${m.idleMinutes ?? '?'}m)`);
    lines.push(`Offline: ${names.join(', ')}${stalled.length > 5 ? ` +${stalled.length - 5} more` : ''}`);
  }
  return lines.join('\n');
}

/** Message for the stale-events alarm, used when capacity itself is fine. */
export function formatStaleMessage(stale, limit) {
  const lines = [
    `\u{1F534} ${stale.staleCount} event(s) not updating`,
    `Not refreshed in the last ${stale.afterMinutes} minutes (alerting at ${limit}+).`,
  ];
  for (const e of (stale.oldest ?? []).slice(0, 3)) {
    lines.push(`· ${e.name}${e.minutesAgo != null ? ` — ${e.minutesAgo}m ago` : ''}`);
  }
  return lines.join('\n');
}

function record(entry) {
  const s = state();
  s.history.unshift({ at: new Date().toISOString(), ...entry });
  if (s.history.length > 50) s.history.length = 50;
}

/**
 * Fire the alarm if the pool is not in surplus.
 *
 * De-duped PER KEY on the verdict state, so a pool that stays short re-raises every
 * REPEAT_MS instead of once (a problem that goes quiet is a problem that gets forgotten)
 * but does not fire on every scheduler tick. A transition back to `ok` sends one recovery
 * message and re-arms, so the next dip alerts immediately rather than waiting out a window.
 */
export async function maybeAlert(health, { force = false } = {}) {
  const s = state();
  const cap = health?.capacity;
  if (!cap) return { sent: false, reason: 'no capacity verdict' };

  // Re-alert window is editable from the portal, so read it per alert rather than freezing
  // it at import time.
  const settings = await whatsAppTarget();
  const repeatMs = Math.max(
    60_000,
    (Number(settings?.repeatMinutes) || Math.round(ENV_REPEAT_MS / 60_000)) * 60_000
  );

  // Stale events are their own alarm. Capacity can read fine while events stop updating —
  // a worker wedged mid-cycle, a scraper crash-looping — so this is judged on the measured
  // outcome, not inferred from the pool, and can fire when capacity says "ok".
  const staleCount = Number(health?.stale?.staleCount) || 0;
  const staleLimit = Number(settings?.staleEventCount) || 5;
  const staleMins = Number(health?.stale?.afterMinutes) || 5;
  const staleProblem = staleCount >= staleLimit;

  const healthyStates = new Set(['ok']);
  const isProblem = !healthyStates.has(cap.state) || staleProblem;

  if (!isProblem) {
    // Recovery: only speak if we had actually complained.
    const wasProblem = s.lastState && !healthyStates.has(s.lastState);
    s.lastState = cap.state;
    if (!wasProblem && !force) return { sent: false, reason: 'pool ok' };
    s.sentAt.clear(); // re-arm so the next dip is not swallowed by a stale window
    const text =
      `✅ Capacity recovered\n` +
      `Units ${cap.jarsAvailable} of ${cap.jarsNeeded} needed (+${cap.surplus} spare)\n` +
      `Events ${cap.activeEvents} · workers online ${cap.machinesMinting}/${cap.machinesTotal}`;
    const results = await Promise.all([
      sendWhatsApp(text),
      sendDiscord('✅ Capacity recovered', text, 0x22c55e),
    ]);
    record({ kind: 'recovered', state: cap.state, results });
    return { sent: true, kind: 'recovered', results };
  }

  s.lastState = cap.state;

  const key = staleProblem && healthyStates.has(cap.state) ? 'stale-events' : `capacity:${cap.state}`;
  const last = s.sentAt.get(key) ?? 0;
  if (!force && Date.now() - last < repeatMs) {
    s.suppressed++;
    return { sent: false, reason: 'within repeat window', suppressed: s.suppressed };
  }
  s.sentAt.set(key, Date.now());

  const suppressed = s.suppressed;
  s.suppressed = 0;

  let text = staleProblem && healthyStates.has(cap.state)
    ? formatStaleMessage(health.stale, staleLimit)
    : formatCapacityMessage(cap, health.pool) +
      (staleProblem ? `\n${staleCount} event(s) not updated in ${staleMins}m` : '');
  if (suppressed) text += `\n_${suppressed} check(s) suppressed since the last alert_`;

  const color = cap.state === 'short' ? 0xef4444 : 0xf5a623;
  const results = await Promise.all([
    sendWhatsApp(text),
    sendDiscord(`⚠️ Capacity ${cap.state}`, text, color),
  ]);
  record({ kind: 'capacity', state: cap.state, results });
  return { sent: true, kind: 'capacity', state: cap.state, results };
}

/** One-off test message, ignoring rate limits and not touching alarm state. */
export async function sendTestAlert() {
  const text =
    '\u{1F514} Service alerts are wired up.\n' +
    'You will get a message here whenever capacity drops below what the live event count needs.';
  const results = await Promise.all([
    sendWhatsApp(text, { ignoreEnabled: true }),
    sendDiscord('\u{1F514} Service monitor test alert', text, 0x6d5efc),
  ]);
  record({ kind: 'test', results });
  return { results };
}

export function alertHistory() {
  return state().history;
}
