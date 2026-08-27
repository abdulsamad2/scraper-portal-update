/**
 * Server-boot hook.
 *
 * Next calls register() once per server process, before it handles any request.
 * That is the only place a background loop can be brought back after a restart
 * without waiting for somebody to happen to open the page that owns it.
 *
 * The StubHub sync worker persists isRunning when it is started, but nothing
 * ever read it back, so every deploy and every PM2 restart left that flag true
 * with no loop draining the queue. Inventory simply stopped reaching StubHub,
 * and the dashboard — which reported the persisted flag — went on saying it was
 * running. This closes that gap.
 */

export async function register() {
  // register() also runs for the edge runtime, where mongoose and timers are
  // unavailable. Node only.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { restoreWorker } = await import('@/lib/sync/runtime.ts');
  // Not awaited: a slow or unreachable database must delay the boot hook, not
  // block the server from serving requests. restoreWorker swallows its own
  // errors for the same reason.
  void restoreWorker();
}
