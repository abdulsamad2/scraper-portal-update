/**
 * WhatsApp transport via whatsapp-web.js (github.com/wwebjs/whatsapp-web.js).
 *
 * This drives a real WhatsApp Web session in a headless Chromium, so there is no per-message
 * cost and no Meta business account — you scan a QR once and the session persists. The
 * trade-offs are real and worth stating plainly:
 *
 *   - It is NOT an official API. WhatsApp does not endorse it and the project says outright
 *     that it cannot guarantee you won't be blocked. Use a number you can afford to lose,
 *     not the business's main line.
 *   - It needs Chromium in the container (see Dockerfile.prod) and roughly 300-400MB of RSS
 *     while connected.
 *   - The session lives on disk under WHATSAPP_SESSION_PATH. If that directory is not a
 *     persistent volume, every deploy wipes it and you are back to scanning a QR — which is
 *     exactly when nobody is watching the dashboard to notice the alarms went silent.
 *
 * The module is deliberately lazy and failure-tolerant. `whatsapp-web.js` is imported at
 * first use inside a try/catch, so a portal whose node_modules lack the package (or whose
 * Chromium is missing) still boots, still serves the status page, and reports the transport
 * as unavailable instead of crashing the process it is supposed to be monitoring.
 */

import path from 'node:path';
import { getAlertSettings } from './alertSettings.js';
import {
  checkSendAllowed, recordSend, nextGapMs, sleep, vary,
  checkReconnectAllowed, recordReconnect, recordReconnectSuccess, safetyStatus,
} from './whatsappSafety.js';

const SESSION_PATH =
  (process.env.WHATSAPP_SESSION_PATH ?? '').trim() ||
  path.join(process.cwd(), '.wwebjs_auth');

const CLIENT_ID = (process.env.WHATSAPP_CLIENT_ID ?? 'farm-alerts').trim();

// Recipient and on/off now live in the database so they can be changed from the portal
// without a restart (lib/alertSettings.js). These env values are only the seed for a fresh
// install, kept here so a first boot with no saved settings still works.
const ENV_TO = (process.env.WHATSAPP_WEB_TO ?? process.env.WHATSAPP_TO ?? '').trim();

// Alpine/Debian containers ship their own Chromium; puppeteer's bundled download is skipped
// in the image to keep it small, so point at the system binary there.
const EXECUTABLE_PATH =
  (process.env.PUPPETEER_EXECUTABLE_PATH ?? '').trim() || undefined;

const AUTOSTART = /^(1|true|yes)$/i.test(process.env.WHATSAPP_WEB_AUTOSTART ?? '');

const GLOBAL_KEY = '__whatsappWebClient_v1__';

/**
 * State lives on globalThis so Next's dev-mode module reloading cannot leave a second
 * headless Chromium running behind a stale module instance.
 */
function store() {
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = {
      client: null,
      linkedNumber: null, // the account that scanned the QR, once known
      settings: null,  // cached alert settings, refreshed by whatsAppTarget()
      state: 'stopped', // stopped | starting | qr | authenticated | ready | auth_failure | disconnected | unavailable
      qr: null,         // raw QR string from the library
      qrDataUrl: null,  // rendered PNG data URL for the dashboard
      qrAt: null,
      me: null,         // the logged-in number, once ready
      lastError: null,
      lastReadyAt: null,
      startedAt: null,
      initPromise: null,
    };
  }
  return globalThis[GLOBAL_KEY];
}

/**
 * Synchronous "is this switched on" for callers that cannot await — the page and alertConfig
 * read the cached copy that whatsAppStatus() keeps warm. Falls back to env before the first
 * settings read completes.
 */
export function whatsAppEnabled() {
  const s = store().settings;
  if (s) return !!(s.enabled && s.recipients?.length);
  return /^(1|true|yes)$/i.test(process.env.WHATSAPP_WEB_ENABLED ?? '') && !!ENV_TO;
}

/** Authoritative async read — always current, used on the send path. */
export async function whatsAppTarget() {
  try {
    const s = await getAlertSettings();
    store().settings = s;
    return s;
  } catch {
    return {
      enabled: /^(1|true|yes)$/i.test(process.env.WHATSAPP_WEB_ENABLED ?? ''),
      recipients: ENV_TO ? ENV_TO.split(',').map((x) => x.trim()).filter(Boolean) : [],
      senderNumber: '',
      repeatMinutes: 30,
      source: 'environment',
    };
  }
}

/** Refresh the cached copy so the synchronous helpers stay close to the truth. */
export async function refreshWhatsAppSettings() {
  return whatsAppTarget();
}

export function whatsAppStatus() {
  const s = store();
  const recipients = s.settings?.recipients ?? [];
  const expectedSender = s.settings?.senderNumber ?? '';
  // The account that actually scanned the QR. If it is not the one recorded in settings,
  // alerts will arrive from an unexpected number — worth surfacing, not discovering later.
  const linked = s.linkedNumber ?? null;
  return {
    enabled: whatsAppEnabled(),
    recipientCount: recipients.length,
    configuredTo: recipients.length ? recipients.map(maskNumber).join(', ') : null,
    recipientsMasked: recipients.map(maskNumber),
    expectedSenderMasked: expectedSender ? maskNumber(expectedSender) : null,
    linkedNumberMasked: linked ? maskNumber(linked) : null,
    senderMismatch: !!(expectedSender && linked && normalizeDigits(expectedSender) !== normalizeDigits(linked)),
    // True whenever a human needs to scan again before alerts can flow.
    needsReconnect: ['disconnected', 'auth_failure', 'unavailable', 'stopped'].includes(s.state),
    safety: safetyStatus(),
    state: s.state,
    // The QR is a live credential: anyone who scans it links THEIR device to this session.
    // It is only exposed while genuinely waiting to be scanned, and goes away on ready.
    qrDataUrl: s.state === 'qr' ? s.qrDataUrl : null,
    qrAt: s.qrAt,
    me: s.me,
    lastError: s.lastError,
    lastReadyAt: s.lastReadyAt,
    sessionPath: SESSION_PATH,
    repeatMinutes: s.settings?.repeatMinutes ?? null,
    settingsSource: s.settings?.source ?? 'environment',
    // Unmasked, for the settings form to prefill. Only ever rendered into an input the
    // operator is already editing — the read-only displays use configuredTo.
    rawTo: s.settings?.whatsappTo ?? ENV_TO,
  };
}

function normalizeDigits(n) {
  return String(n ?? '').replace(/[^0-9]/g, '');
}

function maskNumber(n) {
  const s = normalizeDigits(n);
  return s.length <= 4 ? '****' : `${s.slice(0, 3)}…${s.slice(-3)}`;
}

async function renderQr(qr) {
  try {
    const { toDataURL } = await import('qrcode');
    return await toDataURL(qr, { margin: 1, width: 320 });
  } catch {
    // Rendering is a convenience — the raw string is still enough to scan via any QR tool.
    return null;
  }
}

/**
 * Boot the client. Safe to call repeatedly: concurrent callers share one init promise, and
 * an already-ready client is returned as-is rather than spawning a second browser.
 */
export async function initWhatsApp() {
  const s = store();
  if (s.client && (s.state === 'ready' || s.state === 'authenticated')) return s.client;
  if (s.initPromise) return s.initPromise;

  // Refuse to hammer login. Repeated fast reconnects look like credential abuse and are a
  // good way to get the account flagged, quite apart from the wasted Chromium launches.
  const backoff = checkReconnectAllowed();
  if (backoff) {
    s.lastError = backoff;
    return null;
  }
  recordReconnect();

  s.initPromise = (async () => {
    let Client, LocalAuth;
    try {
      // whatsapp-web.js is CommonJS. Node's cjs-module-lexer only detects `Client` as a
      // named export, so `import { LocalAuth }` yields undefined and blows up as
      // "LocalAuth is not a constructor" at link time. Go through `default`, which carries
      // the real module.exports object.
      const mod = await import('whatsapp-web.js');
      ({ Client, LocalAuth } = mod.default ?? mod);
      if (typeof Client !== 'function' || typeof LocalAuth !== 'function') {
        throw new Error('unexpected module shape — Client/LocalAuth missing');
      }
    } catch (e) {
      s.state = 'unavailable';
      s.lastError =
        `whatsapp-web.js is not installed (${e?.message ?? e}). ` +
        `Run: npm install whatsapp-web.js qrcode`;
      s.initPromise = null;
      return null;
    }

    s.state = 'starting';
    s.lastError = null;
    s.startedAt = new Date().toISOString();

    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: SESSION_PATH, clientId: CLIENT_ID }),
      puppeteer: {
        headless: true,
        executablePath: EXECUTABLE_PATH,
        // --no-sandbox is required to run Chromium as a non-root user in a container;
        // --disable-dev-shm-usage avoids the 64MB /dev/shm default that crashes Chromium
        // under Docker mid-render.
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      },
    });

    client.on('qr', async (qr) => {
      s.qr = qr;
      s.qrAt = new Date().toISOString();
      s.qrDataUrl = await renderQr(qr);
      s.state = 'qr';
    });

    client.on('authenticated', () => {
      s.state = 'authenticated';
      s.qr = null;
      s.qrDataUrl = null;
      s.lastError = null;
    });

    client.on('auth_failure', (msg) => {
      s.state = 'auth_failure';
      s.lastError = String(msg ?? 'authentication failed');
    });

    client.on('ready', () => {
      s.state = 'ready';
      s.qr = null;
      s.qrDataUrl = null;
      s.lastReadyAt = new Date().toISOString();
      recordReconnectSuccess();
      s.linkedNumber = client.info?.wid?.user ?? null;
      s.me = s.linkedNumber ? maskNumber(s.linkedNumber) : null;
    });

    client.on('disconnected', (reason) => {
      s.state = 'disconnected';
      s.lastError = `disconnected: ${reason}`;
      s.me = null;
      s.linkedNumber = null;
      // Drop the handle so the next send re-initializes rather than calling into a dead
      // browser. WhatsApp Web drops sessions routinely (phone offline, session replaced).
      s.client = null;
      s.initPromise = null;
    });

    s.client = client;

    try {
      await client.initialize();
    } catch (e) {
      const raw = e?.message ?? String(e);
      s.state = 'unavailable';
      // Translate the failures that actually happen into something actionable. The raw
      // Chromium/puppeteer text names internal paths and flags that mean nothing to the
      // person looking at the dashboard.
      s.lastError =
        /already running for/i.test(raw)
          ? 'Another copy of the app is already using the WhatsApp session. Stop the other one (or restart this app) and reconnect.'
        : /Could not find (Chrome|Chromium)|Failed to launch|ENOENT/i.test(raw)
          ? 'The browser needed to run WhatsApp is missing or could not start. Check PUPPETEER_EXECUTABLE_PATH.'
        : /Navigation timeout|net::ERR|timeout/i.test(raw)
          ? 'Timed out reaching WhatsApp — check the internet connection, then reconnect.'
        : raw;
      s.client = null;
      s.initPromise = null;
      return null;
    }

    s.initPromise = null;
    return client;
  })();

  return s.initPromise;
}

/** Tear the session down and forget the credentials, forcing a fresh QR next start. */
export async function logoutWhatsApp() {
  const s = store();
  if (!s.client) { s.state = 'stopped'; return { ok: true, note: 'not running' }; }
  try {
    await s.client.logout();
  } catch { /* fall through to destroy — logout fails if already disconnected */ }
  try {
    await s.client.destroy();
  } catch { /* nothing useful to do */ }
  s.client = null;
  s.initPromise = null;
  s.state = 'stopped';
  s.me = null;
  s.qr = null;
  s.qrDataUrl = null;
  return { ok: true };
}

/** Stop the browser but KEEP the session, so restarting needs no new QR scan. */
export async function stopWhatsApp() {
  const s = store();
  if (!s.client) { s.state = 'stopped'; return { ok: true, note: 'not running' }; }
  try { await s.client.destroy(); } catch { /* already gone */ }
  s.client = null;
  s.initPromise = null;
  s.state = 'stopped';
  return { ok: true };
}

/**
 * Send one text message to the configured recipient.
 *
 * Resolves through getNumberId rather than string-concatenating "@c.us": that call also
 * validates the number is on WhatsApp and normalizes country-specific quirks (Brazilian
 * numbers gain or lose a 9), so a silently-wrong chatId fails loudly here instead of
 * appearing to send into the void.
 */
/**
 * Send one message to every configured recipient.
 *
 * Each number is attempted independently: one bad or unregistered number must not stop the
 * others from being told the service is in trouble. The result reports per-recipient
 * outcomes and counts as a success if at least one message landed, so the caller can say
 * "sent to 2 of 3" rather than a bare true/false that hides a silent partial failure.
 */
export async function sendWhatsAppWeb(text, { ignoreEnabled = false } = {}) {
  // Read recipients now, not at import time — they are edited from the portal, and a
  // module-level copy would keep messaging the previous list until the next restart.
  const settings = await whatsAppTarget();
  const recipients = (settings.recipients ?? []).filter(Boolean);

  // A test deliberately ignores the master switch: the whole point is to prove delivery
  // works before committing to switching alerts on.
  if (!settings.enabled && !ignoreEnabled) {
    return { ok: false, via: 'whatsapp-web', error: 'alerts are switched off — tick "Send me alerts" and save' };
  }
  if (!recipients.length) {
    return { ok: false, via: 'whatsapp-web', error: 'no recipient numbers are set' };
  }

  const s = store();
  let client;
  try {
    client = s.client && s.state === 'ready' ? s.client : await initWhatsApp();
  } catch (e) {
    return { ok: false, via: 'whatsapp-web', error: e?.message ?? 'could not start WhatsApp' };
  }

  if (!client) {
    return { ok: false, via: 'whatsapp-web', error: s.lastError ?? 'WhatsApp is not connected' };
  }
  if (s.state !== 'ready') {
    // Mid-QR is the common case after a redeploy and needs a person, not a retry.
    return {
      ok: false,
      via: 'whatsapp-web',
      error: s.state === 'qr'
        ? 'waiting for a QR scan — open Coverage and reconnect WhatsApp'
        : `WhatsApp is not connected (${s.state})`,
    };
  }

  const deliveries = [];
  let first = true;
  for (const to of recipients) {
    // Volume ceiling is checked per message, not once per batch — a large recipient list
    // must not be able to blow through the cap in a single call.
    const blocked = checkSendAllowed();
    if (blocked) {
      deliveries.push({ to: maskNumber(to), ok: false, error: blocked });
      continue;
    }

    // Space the messages out. Skipped before the first one so a single-recipient alert is
    // still immediate; only the gaps BETWEEN messages need to look human.
    if (!first) await sleep(nextGapMs());
    first = false;

    try {
      // getNumberId validates the number is on WhatsApp and normalises country quirks
      // (Brazilian numbers gain or lose a 9), so a wrong id fails loudly here rather than
      // appearing to send into the void.
      const wid = await client.getNumberId(to);
      if (!wid) {
        deliveries.push({ to: maskNumber(to), ok: false, error: 'not on WhatsApp' });
        continue;
      }
      // vary() breaks the exact-duplicate signature of a repeating alert body.
      await client.sendMessage(wid._serialized, vary(text));
      recordSend();
      deliveries.push({ to: maskNumber(to), ok: true });
    } catch (e) {
      // Keep going: the next recipient may well be reachable.
      deliveries.push({ to: maskNumber(to), ok: false, error: e?.message ?? 'send failed' });
    }
  }

  const sent = deliveries.filter((d) => d.ok);
  const failed = deliveries.filter((d) => !d.ok);
  if (!sent.length) s.lastError = failed.map((f) => `${f.to}: ${f.error}`).join('; ');

  return {
    ok: sent.length > 0,
    via: 'whatsapp-web',
    sent: sent.length,
    total: deliveries.length,
    deliveries,
    error: failed.length
      ? `${failed.length} of ${deliveries.length} failed — ${failed.map((f) => `${f.to}: ${f.error}`).join('; ')}`
      : undefined,
  };
}

// Opt-in autostart. Off by default: booting Chromium as a side effect of importing a module
// is a nasty surprise during a build or a one-off script run.
if (AUTOSTART) {
  whatsAppTarget()
    .then((s) => { if (s.enabled && s.whatsappTo) return initWhatsApp(); })
    .catch(() => {});
}
