/**
 * Ban-avoidance for the WhatsApp Web transport.
 *
 * WhatsApp does not publish its spam thresholds, so none of this is a guarantee. What it
 * does is remove the behaviours that most obviously separate a bot from a person, because
 * those are what automated abuse detection is built to catch:
 *
 *   1. Machine cadence.      A person does not send three messages in the same 40ms. Every
 *                            send is spaced by a randomised gap.
 *   2. Unbounded volume.     A stuck alarm loop firing hundreds of messages is the single
 *                            most likely way to lose the number. Hard hourly and daily caps
 *                            stop that even if the caller misbehaves.
 *   3. Byte-identical text.  Repeated identical payloads are trivially fingerprinted. A
 *                            varying suffix makes consecutive messages differ.
 *   4. Reconnect storms.     Hammering login after a disconnect looks like credential abuse.
 *                            Backoff is enforced between attempts.
 *
 * The caps are deliberately low. This is an alerting channel — if it ever needs to send
 * 60 messages in a day, the thing to fix is the alert logic, not the cap.
 */

const GLOBAL_KEY = '__whatsappSafety_v1__';

function state() {
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = {
      sends: [],          // timestamps of every send, trimmed to the last 24h
      lastSendAt: 0,
      reconnectAttempts: 0,
      lastReconnectAt: 0,
    };
  }
  return globalThis[GLOBAL_KEY];
}

export const SAFETY_DEFAULTS = {
  // Gap between two messages, randomised in this range. Never zero: a burst of instant
  // sends to several numbers is the clearest bot signature there is.
  minGapMs: 4_000,
  maxGapMs: 11_000,
  // Ceilings across ALL recipients combined.
  maxPerHour: 12,
  maxPerDay: 60,
  // A brand-new number sending at full rate is the classic ban pattern. Callers can lower
  // the caps during the first days by passing their own values.
  reconnectBackoffMs: 30_000,
  maxReconnectAttempts: 5,
};

function trim(s) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  if (s.sends.length && s.sends[0] < cutoff) {
    s.sends = s.sends.filter((t) => t >= cutoff);
  }
}

/** How many messages went out in the last hour / day. */
export function sendCounts() {
  const s = state();
  trim(s);
  const now = Date.now();
  return {
    lastHour: s.sends.filter((t) => t > now - 3_600_000).length,
    lastDay: s.sends.length,
    lastSendAt: s.lastSendAt || null,
  };
}

/**
 * May we send right now? Returns null to proceed, or a reason to refuse.
 *
 * Refusing is deliberate rather than queueing: an alert that arrives four hours late is
 * worse than useless, and silently banking hundreds of queued messages is exactly how the
 * number gets burned when the backlog finally drains.
 */
export function checkSendAllowed(opts = {}) {
  const cfg = { ...SAFETY_DEFAULTS, ...opts };
  const { lastHour, lastDay } = sendCounts();

  if (lastHour >= cfg.maxPerHour) {
    return `hourly limit reached (${lastHour}/${cfg.maxPerHour}) — holding off to protect the number`;
  }
  if (lastDay >= cfg.maxPerDay) {
    return `daily limit reached (${lastDay}/${cfg.maxPerDay}) — holding off to protect the number`;
  }
  return null;
}

export function recordSend() {
  const s = state();
  const now = Date.now();
  s.sends.push(now);
  s.lastSendAt = now;
  trim(s);
}

/** Randomised human-ish pause. Jittered, never a fixed interval — a metronome is a bot. */
export function nextGapMs(opts = {}) {
  const cfg = { ...SAFETY_DEFAULTS, ...opts };
  return cfg.minGapMs + Math.floor(Math.random() * Math.max(1, cfg.maxGapMs - cfg.minGapMs));
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Make consecutive messages differ.
 *
 * Alert bodies repeat verbatim when a condition persists — same counts, same wording. A
 * short local timestamp is enough to break the exact-duplicate signature while staying
 * useful to the person reading it.
 */
export function vary(text) {
  const t = new Date();
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  return `${text}\n${hh}:${mm}`;
}

/** Reconnect backoff — refuse to retry login faster than the configured gap. */
export function checkReconnectAllowed(opts = {}) {
  const cfg = { ...SAFETY_DEFAULTS, ...opts };
  const s = state();
  const since = Date.now() - s.lastReconnectAt;

  if (s.reconnectAttempts >= cfg.maxReconnectAttempts && since < 60 * 60 * 1000) {
    return `too many reconnect attempts (${s.reconnectAttempts}) — waiting before trying again`;
  }
  if (s.lastReconnectAt && since < cfg.reconnectBackoffMs) {
    return `reconnecting too quickly — wait ${Math.ceil((cfg.reconnectBackoffMs - since) / 1000)}s`;
  }
  return null;
}

export function recordReconnect() {
  const s = state();
  s.reconnectAttempts++;
  s.lastReconnectAt = Date.now();
}

/** A successful link clears the backoff counter. */
export function recordReconnectSuccess() {
  const s = state();
  s.reconnectAttempts = 0;
}

export function safetyStatus(opts = {}) {
  const cfg = { ...SAFETY_DEFAULTS, ...opts };
  const counts = sendCounts();
  return {
    ...counts,
    maxPerHour: cfg.maxPerHour,
    maxPerDay: cfg.maxPerDay,
    blocked: checkSendAllowed(cfg),
  };
}
