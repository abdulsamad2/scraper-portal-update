import dbConnect from '@/lib/dbConnect';
import { TelechargeLookup } from '@/models/telechargeEventModel';
import { canonicalTelechargeUrl, type TelechargeLookupResult, type TelechargePerformanceOption } from '@/lib/telecharge';

/**
 * Ask the Telecharge scraper which performances a show has on sale.
 *
 * Server-only. The portal cannot reach Telecharge itself (it is behind Akamai and
 * DataDome), so it drops a request into `tele_lookups` and waits for the running
 * scraper to answer on the same row — usually within a few seconds. This is
 * also how the portal knows a URL is a real show.
 *
 * An answer for the same show from the last `maxAgeMs` is reused, so loading the
 * list and then saving does not ask Telecharge twice.
 */
export async function lookupTelechargeShow(
  rawUrl: string,
  { maxAgeMs = 60_000, waitMs = 30_000 }: { maxAgeMs?: number; waitMs?: number } = {}
): Promise<TelechargeLookupResult> {
  const url = canonicalTelechargeUrl(rawUrl);
  if (!url) return { error: 'Enter a Telecharge show URL, e.g. https://www.telecharge.com/Show-Name-Tickets' };

  await dbConnect();

  const recent = await TelechargeLookup.findOne(
    { URL: url, status: 'done', answeredAt: { $gte: new Date(Date.now() - maxAgeMs) } },
    null,
    { sort: { answeredAt: -1 } }
  ).lean().maxTimeMS(5000);
  if (recent) return toResult(recent);

  const request = await TelechargeLookup.create({ URL: url, status: 'pending' });
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 700));
    const row = await TelechargeLookup.findById(request._id).lean().maxTimeMS(5000);
    if (!row) break;
    const status = (row as { status?: string }).status;
    if (status === 'done' || status === 'error') return toResult(row);
  }

  return {
    error:
      'The Telecharge scraper did not answer. Check that it is running (pm2 status telecharge-scraper) ' +
      'and connected to the same database as the portal, then try again.',
  };
}

function toResult(row: unknown): TelechargeLookupResult {
  const r = row as {
    status?: string;
    error?: string;
    show?: { slug: string; url: string; productId: number; title?: string | null; theatre?: string | null };
    performances?: { Event_DateTime: Date | string; perfKey: number; perfType?: string; soldOut?: boolean }[];
  };
  if (r.status !== 'done' || !r.show) return { error: r.error || 'Telecharge lookup failed' };
  return {
    show: {
      slug: r.show.slug,
      url: r.show.url,
      productId: r.show.productId,
      title: r.show.title ?? null,
      theatre: r.show.theatre ?? null,
    },
    performances: (r.performances || []).map(
      (p): TelechargePerformanceOption => ({
        Event_DateTime: new Date(p.Event_DateTime).toISOString(),
        perfKey: p.perfKey,
        perfType: p.perfType,
        soldOut: Boolean(p.soldOut),
      })
    ),
  };
}

/** The minute a stored wall-clock date falls on — how performances are matched. */
export const performanceMinute = (d: Date | string) => Math.floor(new Date(d).getTime() / 60_000);
