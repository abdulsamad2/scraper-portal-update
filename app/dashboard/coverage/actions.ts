'use server';

import { revalidatePath } from 'next/cache';
import { cleanupExpiredJars, currentHealth } from '@/lib/farmHealth.js';
import { maybeAlert, sendTestAlert } from '@/lib/farmAlerts.js';
import { initWhatsApp, stopWhatsApp, logoutWhatsApp, refreshWhatsAppSettings } from '@/lib/whatsappClient.js';
import { saveAlertSettings } from '@/lib/alertSettings.js';

const PAGE = '/dashboard/coverage';

export type ActionResult = { ok: boolean; message: string };

/** Re-read supply vs demand right now and send an alert if it is short. */
export async function checkNowAction(): Promise<ActionResult> {
  try {
    const health = await currentHealth();
    const alert = await maybeAlert(health);
    revalidatePath(PAGE);
    return {
      ok: true,
      message: alert?.sent
        ? 'Checked. An alert was sent.'
        : 'Checked. Everything is up to date.',
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Could not check right now.' };
  }
}

/** Preview how many old units would be cleared, without removing anything. */
export async function previewCleanupAction(): Promise<ActionResult> {
  try {
    const r = await cleanupExpiredJars({ dryRun: true });
    revalidatePath(PAGE);
    return {
      ok: true,
      message: r.matched
        ? `${r.matched} expired unit${r.matched === 1 ? '' : 's'} can be cleared out.`
        : 'Nothing to clear out — no expired units.',
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Could not check.' };
  }
}

/** Remove capacity units that have already expired. Units still in use are never touched. */
export async function cleanupAction(): Promise<ActionResult> {
  try {
    const r = await cleanupExpiredJars();
    revalidatePath(PAGE);
    return {
      ok: true,
      message: r.deleted
        ? `Cleared out ${r.deleted} expired unit${r.deleted === 1 ? '' : 's'}.`
        : 'Nothing needed clearing.',
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Could not clear units.' };
  }
}

/** Send a sample message so you can confirm alerts actually arrive. */
export async function testAlertAction(): Promise<ActionResult> {
  try {
    const { results } = await sendTestAlert();
    const sent = (results ?? []).filter((r: { ok: boolean }) => r.ok);
    // Do NOT filter on `via` here. A failure with via===null still carries the only
    // explanation there is, and dropping it produced a blank "nothing is set up" message
    // that hid the real cause.
    const failed = (results ?? []).filter((r: { ok: boolean }) => !r.ok);
    revalidatePath(PAGE);
    if (sent.length) {
      // A partial delivery must not read as a clean success — one unreachable number in a
      // list of three is exactly the thing that goes unnoticed until an alert is missed.
      // `via` is nullable on the "not configured" shape, so widen rather than narrow.
      const wa = (sent as { via?: string | null; sent?: number; total?: number; error?: string }[])
        .find((r) => r.via === 'whatsapp-web');
      if (wa?.total && wa.sent !== undefined && wa.sent < wa.total) {
        return { ok: false, message: `Sent to ${wa.sent} of ${wa.total}. ${wa.error ?? ''}`.trim() };
      }
      return {
        ok: true,
        message: wa?.total
          ? `Test message sent to ${wa.total} number${wa.total === 1 ? '' : 's'} — check the phone${wa.total === 1 ? '' : 's'}.`
          : 'Test message sent.',
      };
    }
    // Discord being unconfigured is normal and not worth reporting when WhatsApp is the
    // channel in use, so lead with the WhatsApp reason.
    const reasons = failed
      .map((r: { via?: string | null; error?: string }) => r.error)
      .filter((e: string | undefined): e is string => !!e && !/discord not configured/i.test(e));
    return {
      ok: false,
      message: reasons.length
        ? `Could not send — ${reasons.join(' · ')}`
        : 'No alert method is set up yet. Add a number above and save.',
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Could not send the test.' };
  }
}

/**
 * Begin connecting WhatsApp.
 *
 * Not awaited to completion on purpose: the connection only finishes once someone has
 * scanned the code with their phone, so waiting here would hold the page open indefinitely
 * and the code would never appear.
 */
export async function connectWhatsAppAction(): Promise<ActionResult> {
  initWhatsApp().catch(() => {});
  revalidatePath(PAGE);
  return { ok: true, message: 'Starting up — the QR code will appear in about half a minute.' };
}

/** Pause WhatsApp but keep the phone connected, so restarting needs no new scan. */
export async function pauseWhatsAppAction(): Promise<ActionResult> {
  await stopWhatsApp();
  revalidatePath(PAGE);
  return { ok: true, message: 'Paused. Your phone is still connected.' };
}

/** Disconnect the phone entirely. A new QR scan will be needed next time. */
export async function disconnectWhatsAppAction(): Promise<ActionResult> {
  await logoutWhatsApp();
  revalidatePath(PAGE);
  return { ok: true, message: 'Phone disconnected.' };
}

/**
 * Save the alert destination from the portal.
 *
 * Lives in the database rather than .env.local so the number can be changed without editing
 * a file and restarting the server — environment variables are read once at process start,
 * and someone redirecting an alarm mid-incident cannot wait for a redeploy.
 */
export async function saveAlertSettingsAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const enabled = formData.get('enabled') === 'on';
  // getAll: the recipient list renders one input per row, all named "recipients".
  const recipients = formData.getAll('recipients').map((v) => String(v).trim()).filter(Boolean);
  const senderNumber = String(formData.get('senderNumber') ?? '');
  const repeatMinutes = Number(formData.get('repeatMinutes') ?? 30);
  const minSpareUnits = Number(formData.get('minSpareUnits') ?? 3);
  const staleEventCount = Number(formData.get('staleEventCount') ?? 5);
  const staleEventMinutes = Number(formData.get('staleEventMinutes') ?? 5);

  const res = await saveAlertSettings({
    enabled, recipients, senderNumber, repeatMinutes,
    minSpareUnits, staleEventCount, staleEventMinutes,
  });
  if (!res.ok) return { ok: false, message: res.error ?? 'Could not save.' };

  // Pick the new settings up immediately rather than waiting out the cache.
  await refreshWhatsAppSettings();
  revalidatePath(PAGE);

  return {
    ok: true,
    message: enabled
      ? `Saved. Alerts will go to ${recipients.length} number${recipients.length === 1 ? '' : 's'}.` +
        ' Connect WhatsApp below if it is not connected yet.'
      : 'Saved. Alerts are switched off.',
  };
}

/**
 * Clear every alert setting: sending number, all recipients, and the on/off switch.
 *
 * Thresholds are deliberately left alone — they are tuning, not identity, and someone
 * clearing out a phone number almost never means to also lose their "warn me at 3 spare"
 * choice. Alerts are forced off in the same write so the account cannot be left switched
 * on with nowhere to send.
 */
export async function clearAlertSettingsAction(): Promise<ActionResult> {
  const res = await saveAlertSettings({
    enabled: false,
    recipients: [],
    senderNumber: '',
  });
  if (!res.ok) return { ok: false, message: res.error ?? 'Could not clear the settings.' };

  await refreshWhatsAppSettings();
  revalidatePath(PAGE);
  return { ok: true, message: 'Cleared. No numbers are stored and alerts are switched off.' };
}
