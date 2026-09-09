import { CheckCircle2, AlertTriangle, XCircle, AlertCircle } from 'lucide-react';

import { currentHealth } from '@/lib/farmHealth.js';
import { alertConfig } from '@/lib/farmAlerts.js';
import { whatsAppStatus, refreshWhatsAppSettings } from '@/lib/whatsappClient.js';

import { ActionRow } from './Controls';
import { AutoRefresh } from './AutoRefresh';
import { AlertSettingsForm } from './AlertSettingsForm';
import {
  checkNowAction, previewCleanupAction, cleanupAction, testAlertAction,
  connectWhatsAppAction, pauseWhatsAppAction, disconnectWhatsAppAction,
  clearAlertSettingsAction,
} from './actions';

// Read on every request — a capacity dashboard showing cached numbers is worse than none.
export const dynamic = 'force-dynamic';

/**
 * Read straight from MongoDB rather than from whichever worker happens to be reporting, so
 * it still answers when the machine that would have reported is the one that died.
 *
 * The page is built as an instrument panel: one reading carries the answer and everything
 * else stays quiet. The reading is HEADROOM — demand plotted against capacity on a single
 * track — because "how much room is left" is the actual question, and two separate stat
 * numbers cannot express a relationship. A coverage percentage was worse than useless here:
 * it sits pinned at 100% until the instant it isn't.
 *
 * Vocabulary is deliberately generic — capacity units, workers, coverage. Anyone opening
 * this page should learn how much headroom the service has and nothing about how it is
 * obtained. Internal names (jars, machines, leases, minting) stay in lib/ where they match
 * the database, and are translated only at this boundary.
 */

// Status roles always ship with an icon AND a word, so state never rests on colour alone.
const STATUS = {
  good:     { fg: '#0b7a0b', bar: '#0ca30c', tint: '#eef7ee', line: '#c9e5c9', Icon: CheckCircle2 },
  warning:  { fg: '#8a6100', bar: '#fab219', tint: '#fdf6e6', line: '#f0dfae', Icon: AlertCircle },
  serious:  { fg: '#a1481f', bar: '#ec835a', tint: '#fdf1eb', line: '#f2cdba', Icon: AlertTriangle },
  critical: { fg: '#a82c2c', bar: '#d03b3b', tint: '#fdefef', line: '#f0c4c4', Icon: XCircle },
} as const;

type StatusKey = keyof typeof STATUS;

const INK = '#101418';
const MUTED = '#5e6a78';
const HAIRLINE = '#e3e7ed';

interface Machine {
  machineId: string; jars: number; healthy: number; free: number;
  newestMintedAt: string | null; idleMinutes: number | null; minting: boolean;
}

export default async function CoveragePage() {
  const health = await currentHealth();
  // Warm the settings cache BEFORE reading status/config — both are synchronous and would
  // otherwise report the environment defaults on the first render after an edit.
  const settings = await refreshWhatsAppSettings();
  const alerts = alertConfig();
  const wa = whatsAppStatus();
  const cap = health.capacity;
  const pool = health.pool;

  const activeEvents: number = cap.activeEvents;
  const canCover: number = cap.eventsSupported;
  const have: number = cap.jarsAvailable;
  const needed: number = cap.jarsNeeded;
  const surplus: number = cap.surplus;
  const inUse: number = cap.jarsInUse;
  const free: number = cap.jarsFree;

  const status: StatusKey =
    cap.state === 'short' ? 'critical'
    : cap.state === 'exact' ? 'serious'
    : cap.state === 'thin' ? 'warning'
    : 'good';

  const pillLabel =
    cap.state === 'short' ? 'Action needed'
    : cap.state === 'exact' ? 'At the limit'
    : cap.state === 'thin' ? 'Low margin'
    : 'Healthy';

  const alertMessage =
    cap.state === 'short'
      ? `Capacity is below what is needed — some events will stop updating. There ${have === 1 ? 'is' : 'are'} ${have} usable capacity unit${have === 1 ? '' : 's'} but the ${activeEvents.toLocaleString()} live events need ${needed}. Check that every worker is online.`
      : cap.state === 'exact' || cap.state === 'thin'
        ? `Running close to the limit. ${have} capacity unit${have === 1 ? '' : 's'} for ${activeEvents.toLocaleString()} events, and ${needed} are needed. If one worker stops, events will start falling behind.`
        : null;

  const machines: Machine[] = pool.machines ?? [];
  const offline = machines.filter((m) => !m.minting);
  const connecting = wa.enabled && ['starting', 'qr', 'authenticated'].includes(wa.state);
  const staleAlarm = health.stale.staleCount >= settings.staleEventCount;

  return (
    <div className="min-h-full" style={{ background: '#f7f8fa' }}>
      <div className="mx-auto max-w-4xl px-6 py-8 space-y-7">
        <AutoRefresh fast={!!connecting} />

        <Header pillLabel={pillLabel} status={status} at={health.at} />

        <Headroom
          status={status}
          demand={activeEvents}
          capacity={canCover}
          message={alertMessage}
        />

        <Figures
          items={[
            { label: 'Capacity units', value: have.toLocaleString() },
            { label: 'Units needed', value: needed.toLocaleString() },
            { label: 'Spare', value: `${surplus > 0 ? '+' : ''}${surplus}`, tone: STATUS[status].fg },
            { label: 'In use now', value: inUse.toLocaleString() },
            { label: 'Idle', value: free.toLocaleString() },
            {
              label: 'Not updating',
              value: health.stale.staleCount.toLocaleString(),
              tone: staleAlarm ? STATUS.critical.fg : undefined,
            },
          ]}
        />

        {health.stale.staleCount > 0 && (
          <Note status={staleAlarm ? 'critical' : 'warning'}>
            {health.stale.staleCount.toLocaleString()} event
            {health.stale.staleCount === 1 ? ' has' : 's have'} not updated in the last{' '}
            {health.stale.afterMinutes} minutes
            {health.stale.oldest.length > 0 && (
              <> — longest waiting is {health.stale.oldest[0].name}
                {health.stale.oldest[0].minutesAgo != null && ` at ${health.stale.oldest[0].minutesAgo} minutes`}</>
            )}.
          </Note>
        )}

        <Workers machines={machines} offlineCount={offline.length} staleMinutes={cap.config.machineStaleMinutes} />

        <Panel
          title="Alerts"
          subtitle={
            alerts.whatsappReady
              ? `A WhatsApp message when something needs attention, and once more when it clears. Never more often than every ${alerts.repeatMinutes} minutes.`
              : 'A WhatsApp message when something needs attention, and once more when it clears.'
          }
        >
          <AlertSettingsForm
            enabled={settings.enabled}
            recipients={settings.recipients ?? []}
            senderNumber={settings.senderNumber ?? ''}
            repeatMinutes={settings.repeatMinutes}
            minSpareUnits={settings.minSpareUnits}
            staleEventCount={settings.staleEventCount}
            staleEventMinutes={settings.staleEventMinutes}
            source={settings.source}
          />

          <hr className="my-6" style={{ borderColor: HAIRLINE }} />

          <Connection wa={wa} />

          <SendingLimits safety={wa.safety} />

          <ActionRow
            buttons={[
              ...(wa.state !== 'ready'
                ? [{
                    key: 'connect',
                    label: wa.needsReconnect && wa.state !== 'stopped'
                      ? 'Reconnect WhatsApp'
                      : 'Connect WhatsApp',
                    tone: 'primary' as const,
                    run: connectWhatsAppAction,
                  }]
                : []),
              { key: 'test', label: 'Send test message', tone: 'quiet' as const, run: testAlertAction },
              ...(wa.state === 'ready'
                ? [
                    { key: 'pause', label: 'Pause sending', tone: 'quiet' as const, run: pauseWhatsAppAction },
                    {
                      key: 'disconnect', label: 'Disconnect WhatsApp', tone: 'caution' as const,
                      run: disconnectWhatsAppAction,
                      confirm: 'Disconnect this phone? You will need to scan a new QR code to reconnect.',
                    },
                  ]
                : []),
              ...((settings.recipients?.length || settings.senderNumber)
                ? [{
                    key: 'clear',
                    label: 'Remove all numbers',
                    tone: 'caution' as const,
                    run: clearAlertSettingsAction,
                    confirm:
                      'Remove the sending number and every recipient, and switch alerts off? '
                      + 'Your warning levels are kept.',
                  }]
                : []),
            ]}
          />
        </Panel>

        <Panel title="Maintenance" subtitle="Re-check now, or clear out capacity units that have already expired. Units still in use are never removed.">
          <ActionRow
            buttons={[
              { key: 'check', label: 'Check now', tone: 'primary', run: checkNowAction },
              { key: 'preview', label: 'Preview clear-out', tone: 'quiet', run: previewCleanupAction },
              {
                key: 'cleanup', label: 'Clear out expired units', tone: 'caution',
                run: cleanupAction,
                confirm: 'Permanently remove capacity units that have already expired? Units still in use are not affected.',
              },
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}

/* ------------------------------ header ------------------------------ */

function Header({ pillLabel, status, at }: { pillLabel: string; status: StatusKey; at: string }) {
  const { Icon, fg, tint, line } = STATUS[status];
  return (
    <header className="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight" style={{ color: INK }}>
          Service coverage
        </h1>
        <p className="text-sm mt-1" style={{ color: MUTED }}>
          Last checked {new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
          Refreshes every minute.
        </p>
      </div>
      <span
        className="inline-flex items-center gap-2 pl-2.5 pr-3.5 py-1.5 rounded-full text-sm font-semibold"
        style={{ color: fg, background: tint, boxShadow: `inset 0 0 0 1px ${line}` }}
      >
        <Icon className="w-4 h-4" aria-hidden />
        {pillLabel}
      </span>
    </header>
  );
}

/* ------------------------------ the reading ------------------------------ */

/**
 * Demand against capacity on one track.
 *
 * Filled portion is how much of what we can handle is actually being asked of us, so the
 * empty remainder IS the headroom — the thing an operator wants to see at a glance. When
 * demand exceeds capacity the track saturates and the shortfall is called out in words,
 * because a bar that is merely "full" cannot show by how much it overflowed.
 */
function Headroom({
  status, demand, capacity, message,
}: {
  status: StatusKey; demand: number; capacity: number; message: string | null;
}) {
  const { bar, fg, tint, line, Icon } = STATUS[status];
  const used = capacity > 0 ? Math.min(100, (demand / capacity) * 100) : 100;
  const over = demand > capacity;

  return (
    <section
      className="rounded-2xl bg-white p-7"
      style={{ boxShadow: `0 1px 2px rgba(16,20,24,.04), inset 0 0 0 1px ${HAIRLINE}` }}
      aria-label="Capacity headroom"
    >
      <div className="flex items-baseline gap-3 flex-wrap">
        <span
          className="text-[54px] leading-none font-semibold tabular-nums"
          style={{ color: INK, letterSpacing: '-0.03em' }}
        >
          {demand.toLocaleString()}
        </span>
        <span className="text-base" style={{ color: MUTED }}>
          events live, out of {capacity.toLocaleString()} we can handle
        </span>
      </div>

      <div className="mt-6">
        <div
          className="h-3 rounded-full overflow-hidden"
          style={{ background: '#eef0f4' }}
          role="img"
          aria-label={`${demand.toLocaleString()} events against capacity for ${capacity.toLocaleString()}`}
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.max(used, 1.5)}%`, background: bar }}
          />
        </div>

        <div className="flex justify-between gap-4 mt-2.5 text-[13px]" style={{ color: MUTED }}>
          <span>
            {over
              ? `${(demand - capacity).toLocaleString()} events beyond what we can handle`
              : `${Math.round(100 - used)}% headroom`}
          </span>
          {!over && (
            <span className="text-right">
              room for {(capacity - demand).toLocaleString()} more
            </span>
          )}
        </div>
      </div>

      {message && (
        <div
          className="mt-6 flex items-start gap-2.5 rounded-xl p-4"
          style={{ background: tint, boxShadow: `inset 0 0 0 1px ${line}` }}
        >
          <Icon className="w-[18px] h-[18px] shrink-0 mt-px" style={{ color: fg }} aria-hidden />
          <p className="text-sm leading-relaxed" style={{ color: '#2b3138' }}>{message}</p>
        </div>
      )}
    </section>
  );
}

/* ------------------------------ figures ------------------------------ */

/**
 * Supporting figures as one hairline-divided strip rather than six cards.
 *
 * These are readings off the same instrument, not six independent objects, and giving each
 * its own card with its own border and shadow would claim a hierarchy that does not exist.
 */
function Figures({
  items,
}: {
  items: { label: string; value: string; tone?: string }[];
}) {
  return (
    <section
      className="rounded-2xl bg-white grid grid-cols-3 lg:grid-cols-6"
      style={{ boxShadow: `0 1px 2px rgba(16,20,24,.04), inset 0 0 0 1px ${HAIRLINE}` }}
      aria-label="Capacity detail"
    >
      {items.map((it, i) => (
        <div
          key={it.label}
          className="px-4 py-4"
          style={{
            borderLeft: i % 3 === 0 ? undefined : `1px solid ${HAIRLINE}`,
            borderTop: i >= 3 ? `1px solid ${HAIRLINE}` : undefined,
          }}
        >
          <div className="text-[13px] leading-snug" style={{ color: MUTED }}>{it.label}</div>
          <div
            className="text-[22px] font-semibold mt-1 tabular-nums"
            style={{ color: it.tone ?? INK, letterSpacing: '-0.02em' }}
          >
            {it.value}
          </div>
        </div>
      ))}
    </section>
  );
}

/* ------------------------------ workers ------------------------------ */

function Workers({
  machines, offlineCount, staleMinutes,
}: {
  machines: Machine[]; offlineCount: number; staleMinutes: number;
}) {
  return (
    <section
      className="rounded-2xl bg-white overflow-hidden"
      style={{ boxShadow: `0 1px 2px rgba(16,20,24,.04), inset 0 0 0 1px ${HAIRLINE}` }}
    >
      <div className="px-6 pt-5 pb-4 flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-[15px] font-semibold" style={{ color: INK }}>Workers</h2>
        <p className="text-[13px]" style={{ color: MUTED }}>
          {offlineCount === 0
            ? `All ${machines.length} responding`
            : `${offlineCount} of ${machines.length} not responding`}
          {' '}— quiet for {staleMinutes} minutes counts as offline
        </p>
      </div>

      <table className="w-full text-sm">
        <caption className="sr-only">Workers providing capacity, and whether each is online</caption>
        <thead>
          <tr style={{ color: MUTED, borderTop: `1px solid ${HAIRLINE}`, borderBottom: `1px solid ${HAIRLINE}` }}>
            <th scope="col" className="text-left font-medium px-6 py-2.5 text-[13px]">Worker</th>
            <th scope="col" className="text-right font-medium px-3 py-2.5 text-[13px]">Units</th>
            <th scope="col" className="text-right font-medium px-3 py-2.5 text-[13px]">Idle</th>
            <th scope="col" className="text-right font-medium px-3 py-2.5 text-[13px]">Last active</th>
            <th scope="col" className="text-right font-medium px-6 py-2.5 text-[13px]">Status</th>
          </tr>
        </thead>
        <tbody>
          {machines.map((m, i) => {
            const st: StatusKey = m.minting ? 'good' : 'critical';
            const { Icon, fg } = STATUS[st];
            return (
              <tr key={m.machineId} style={{ borderTop: i === 0 ? undefined : `1px solid ${HAIRLINE}` }}>
                <th scope="row" className="text-left font-medium px-6 py-3.5" style={{ color: INK }}>
                  {friendlyName(m.machineId)}
                </th>
                <td className="px-3 py-3.5 text-right tabular-nums font-semibold" style={{ color: INK }}>{m.healthy}</td>
                <td className="px-3 py-3.5 text-right tabular-nums" style={{ color: MUTED }}>{m.free}</td>
                <td className="px-3 py-3.5 text-right tabular-nums" style={{ color: MUTED }}>
                  {m.idleMinutes == null ? 'Never' : friendlyAgo(m.idleMinutes)}
                </td>
                <td className="px-6 py-3.5">
                  <span className="flex items-center justify-end gap-1.5 font-medium" style={{ color: fg }}>
                    <Icon className="w-4 h-4 shrink-0" aria-hidden />
                    {m.minting ? 'Online' : 'Offline'}
                  </span>
                </td>
              </tr>
            );
          })}
          {!machines.length && (
            <tr>
              <td colSpan={5} className="px-6 py-12 text-center" style={{ color: MUTED }}>
                No workers have reported in yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

/* ------------------------------ shells ------------------------------ */

function Panel({
  title, subtitle, icon, children,
}: {
  title: string; subtitle?: string; icon?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-2xl bg-white p-6"
      style={{ boxShadow: `0 1px 2px rgba(16,20,24,.04), inset 0 0 0 1px ${HAIRLINE}` }}
    >
      <div className="mb-5">
        <h2 className="text-[15px] font-semibold flex items-center gap-2" style={{ color: INK }}>
          {icon}{title}
        </h2>
        {subtitle && (
          <p className="text-[13px] mt-1 max-w-prose leading-relaxed" style={{ color: MUTED }}>
            {subtitle}
          </p>
        )}
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function Note({ status, children }: { status: StatusKey; children: React.ReactNode }) {
  const { Icon, fg, tint, line } = STATUS[status];
  return (
    <div
      className="rounded-xl p-4 flex items-start gap-2.5"
      style={{ background: tint, boxShadow: `inset 0 0 0 1px ${line}` }}
    >
      <Icon className="w-[18px] h-[18px] shrink-0 mt-px" style={{ color: fg }} aria-hidden />
      <p className="text-sm leading-relaxed" style={{ color: '#2b3138' }}>{children}</p>
    </div>
  );
}

function Callout({
  status, title, children,
}: {
  status: StatusKey; title: string; children: React.ReactNode;
}) {
  const { Icon, fg, tint, line } = STATUS[status];
  return (
    <div
      className="rounded-xl p-4 flex items-start gap-3"
      style={{ background: tint, boxShadow: `inset 0 0 0 1px ${line}` }}
    >
      <Icon className="w-[18px] h-[18px] shrink-0 mt-0.5" style={{ color: fg }} aria-hidden />
      <div className="min-w-0">
        <div className="text-sm font-semibold" style={{ color: fg }}>{title}</div>
        <p className="text-sm mt-0.5 leading-relaxed" style={{ color: '#2b3138' }}>{children}</p>
      </div>
    </div>
  );
}

/* ------------------------------ connection ------------------------------ */

type WaStatus = ReturnType<typeof whatsAppStatus>;

function Connection({ wa }: { wa: WaStatus }) {
  if (wa.state === 'ready' && wa.senderMismatch) {
    return (
      <Callout status="warning" title="Connected to a different phone">
        Messages will be sent from {wa.linkedNumberMasked}, but the sending number is set to{' '}
        {wa.expectedSenderMasked}. Either update the sending number above, or disconnect and
        scan again with the right phone.
      </Callout>
    );
  }
  if (wa.state === 'ready') {
    return (
      <Callout status="good" title={`Connected${wa.me ? ` as ${wa.me}` : ''}`}>
        {wa.recipientCount > 0
          ? `Alerts go to ${wa.recipientCount} number${wa.recipientCount === 1 ? '' : 's'}: ${wa.configuredTo}.`
          : 'No recipients yet — add at least one number above.'}{' '}
        Send a test message to make sure it arrives.
      </Callout>
    );
  }
  if (wa.state === 'qr' && wa.qrDataUrl) {
    return (
      <div className="rounded-xl p-5" style={{ background: '#eff5ff', boxShadow: 'inset 0 0 0 1px #c7dcfb' }}>
        <h3 className="text-sm font-semibold" style={{ color: '#1c3f70' }}>Scan to connect</h3>
        <div className="mt-4 flex flex-wrap items-start gap-6">
          {/* eslint-disable-next-line @next/next/no-img-element -- inline data image, nothing to optimise */}
          <img
            src={wa.qrDataUrl}
            alt="QR code for connecting WhatsApp"
            width={182}
            height={182}
            className="rounded-lg bg-white p-2.5"
            style={{ boxShadow: 'inset 0 0 0 1px #c7dcfb' }}
          />
          <ol className="text-sm space-y-2 list-decimal ml-4 max-w-xs leading-relaxed" style={{ color: '#2b3138' }}>
            <li>Open WhatsApp on the sending phone.</li>
            <li>Go to Settings, then Linked devices.</li>
            <li>Tap Link a device and point the camera here.</li>
            <li>This page updates itself once connected.</li>
          </ol>
        </div>
      </div>
    );
  }
  if (wa.state === 'starting') {
    return (
      <Callout status="warning" title="Starting up">
        This takes about half a minute. The code appears here on its own.
      </Callout>
    );
  }
  if (wa.state === 'disconnected') {
    return (
      <Callout status="critical" title="Disconnected — nothing is being sent">
        The link to the sending phone dropped, so nobody will be told if something goes wrong.
        Reconnect below and scan the code again.{wa.lastError ? ` ${wa.lastError}` : ''}
      </Callout>
    );
  }
  if (wa.state === 'auth_failure') {
    return (
      <Callout status="critical" title="Login rejected — nothing is being sent">
        The saved connection was refused, usually because it was unlinked from the phone.
        Reconnect below to scan a fresh code.
      </Callout>
    );
  }
  if (wa.state === 'unavailable') {
    return (
      <Callout status="critical" title="WhatsApp could not start">
        Alerts cannot be sent until this is fixed.{wa.lastError ? ` ${wa.lastError}` : ''}
      </Callout>
    );
  }
  if (!wa.enabled) {
    return (
      <Callout status="warning" title="Alerts are switched off">
        Nobody will be told if something goes wrong. Add a number above, tick Send me alerts,
        and save.
      </Callout>
    );
  }
  return (
    <Callout status="warning" title="Not connected">
      Alerts cannot be delivered yet. Connect below to get a code to scan.
    </Callout>
  );
}

function SendingLimits({ safety }: { safety: WaStatus['safety'] }) {
  return (
    <div className="rounded-xl px-4 py-3.5" style={{ background: '#f7f8fa', boxShadow: `inset 0 0 0 1px ${HAIRLINE}` }}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <span className="text-[13px] font-medium" style={{ color: INK }}>Sending limits</span>
        <span className="text-[13px] tabular-nums" style={{ color: MUTED }}>
          {safety.lastHour} of {safety.maxPerHour} this hour, {safety.lastDay} of {safety.maxPerDay} today
        </span>
      </div>
      <p className="text-[13px] mt-1.5 leading-relaxed" style={{ color: MUTED }}>
        Messages are spaced a few seconds apart and capped, so a fault that keeps re-triggering
        cannot flood the number and get it blocked.
      </p>
      {safety.blocked && (
        <p className="text-[13px] mt-2 font-medium" style={{ color: STATUS.warning.fg }}>
          Holding off — {safety.blocked}
        </p>
      )}
    </div>
  );
}

/* ------------------------------ wording helpers ------------------------------ */

/** Worker ids look like "DESKTOP7RLCC-42ba02" — show the readable half, drop the hash. */
function friendlyName(id: string) {
  const base = id.split('-')[0] || id;
  return base.replace(/^DESKTOP/i, 'Desktop ').trim();
}

function friendlyAgo(minutes: number) {
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}
