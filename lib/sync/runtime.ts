/**
 * The drain loop's process-level handle.
 *
 * Two callers need to start and stop the worker — the dashboard API route and
 * the server-boot hook in instrumentation.ts — and they must share one handle.
 * If each kept its own, a restart would restore a loop the API could not see or
 * stop, which is a worse failure than not restoring it at all.
 *
 * The handle lives on globalThis rather than in a module variable because PM2
 * reloads and Next's module re-evaluation both re-import modules. Without it the
 * old loop would keep running unreferenced while a second one started beside it
 * — the exact scenario the lease protects against, but there is no reason to
 * lean on the lease for something this avoidable.
 */

import { runWorker, type WorkerStart } from './worker.ts';
import dbConnect from '@/lib/dbConnect';
import { StubhubSyncSettings, getStubhubSyncSettings } from '@/models/stubhubSyncModel.js';

const KEY = '__stubhubSyncWorker__';

export interface WorkerHandle {
  controller: AbortController | null;
  startedAt: number | null;
  /** Lease id this instance holds, so the UI can tell ours from another's. */
  holder: string | null;
  /** Set once the boot hook has run, so it cannot restore twice. */
  bootstrapped: boolean;
}

export function workerHandle(): WorkerHandle {
  const g = globalThis as Record<string, unknown>;
  if (!g[KEY]) {
    g[KEY] = { controller: null, startedAt: null, holder: null, bootstrapped: false } satisfies WorkerHandle;
  }
  // A handle left by an older build of this module can be missing fields added
  // since — globalThis survives a hot reload, the object shape does not follow
  // it. Fill in what is absent rather than reading undefined as a real value.
  const h = g[KEY] as Partial<WorkerHandle>;
  h.controller ??= null;
  h.startedAt ??= null;
  h.holder ??= null;
  h.bootstrapped ??= false;
  return h as WorkerHandle;
}

export interface StartOutcome {
  success: boolean;
  message: string;
  heldBy?: string;
}

/**
 * Start the loop and wait long enough to know whether it actually became the
 * writer.
 *
 * The previous version returned "worker started" the instant it kicked the
 * promise off. If the lease was held elsewhere — by another PM2 instance, or by
 * a process that died in the last 30 seconds without releasing it — runWorker
 * stood down immediately, the finally block cleared the handle, and the next
 * poll showed "Stopped" again. The API had already reported success, so the UI
 * had nothing to display: the button simply bounced back, which reads as a
 * broken button rather than as the lease doing its job.
 *
 * The wait is bounded. Acquisition is one indexed updateOne, so it settles in
 * milliseconds; the timeout exists only so a database stall cannot hang the
 * request, and hitting it is reported as unknown rather than as either outcome.
 */
export async function startWorker(): Promise<StartOutcome> {
  const h = workerHandle();
  if (h.controller) return { success: true, message: 'Already running on this instance.' };

  const controller = new AbortController();
  h.controller = controller;
  h.startedAt = Date.now();

  let settle: (v: WorkerStart | null) => void = () => {};
  const ready = new Promise<WorkerStart | null>(resolve => { settle = resolve; });
  const timer = setTimeout(() => settle(null), 5_000);

  // Not awaited: the loop runs until stopped. Failures are logged and clear the
  // handle so a later start can succeed.
  void runWorker(controller.signal, info => { h.holder = info.holder; settle(info); })
    .catch(error => {
      console.error('[stubhub:worker] loop failed:', error);
    })
    .finally(() => {
      const cur = workerHandle();
      // Only clear if this is still our controller — a stop-then-start in quick
      // succession must not have the old loop's exit tear down the new one.
      if (cur.controller === controller) {
        cur.controller = null;
        cur.startedAt = null;
        cur.holder = null;
      }
    });

  const info = await ready;
  clearTimeout(timer);

  if (info?.started) {
    // Persisted so the boot hook can bring the loop back after a restart.
    // Without something reading it, this flag was decorative: it recorded the
    // intent to sync and nothing acted on it, so a deploy left isRunning true
    // with nothing draining and no indication anywhere that it had stopped.
    await dbConnect();
    await StubhubSyncSettings.updateOne({}, { $set: { isRunning: true } }, { upsert: true });
    return { success: true, message: 'Worker started.' };
  }

  // It stood down. Drop our handle so the UI does not show a loop that has
  // already exited.
  if (h.controller === controller) {
    h.controller = null;
    h.startedAt = null;
    h.holder = null;
  }

  if (info?.reason === 'lease-held-elsewhere') {
    return {
      success: false,
      message:
        'Another instance already holds the sync lease, so this one stood down. Inventory is '
        + 'still syncing — only one writer is allowed, because the POS API has no concurrency '
        + 'control and two writers would silently overwrite each other.',
      heldBy: info.heldBy,
    };
  }
  if (info?.reason === 'not-configured') {
    return { success: false, message: 'STUBHUB_BEARER_TOKEN / STUBHUB_ACCOUNT_ID are not set.' };
  }
  return { success: false, message: 'The worker exited immediately. Check the server logs.' };
}

export async function stopWorker(): Promise<void> {
  const h = workerHandle();
  h.controller?.abort();
  h.controller = null;
  h.startedAt = null;
  h.holder = null;
  await dbConnect();
  await StubhubSyncSettings.updateOne({}, { $set: { isRunning: false } }, { upsert: true });
}

/**
 * Bring the loop back on server start if it was running when the process ended.
 *
 * A deploy should not silently stop inventory syncing until somebody notices.
 * The CSV scheduler already restores itself this way; the sync worker recorded
 * the same flag and never read it, so every restart left the dashboard showing
 * a system that had quietly stopped writing to StubHub.
 *
 * Standing down is a normal outcome here and is logged, not raised: under PM2
 * every instance runs this, and all but one are supposed to lose.
 */
export async function restoreWorker(): Promise<void> {
  const h = workerHandle();
  if (h.bootstrapped) return;
  h.bootstrapped = true;

  try {
    const settings = await getStubhubSyncSettings();
    if (!settings.isRunning) return;

    console.log('[stubhub:worker] restoring the drain loop after a restart…');
    const outcome = await startWorker();
    console.log(`[stubhub:worker] ${outcome.message}`);
  } catch (error) {
    // A boot hook must never take the server down with it.
    h.bootstrapped = false;
    console.error('[stubhub:worker] could not restore the drain loop:', error);
  }
}
