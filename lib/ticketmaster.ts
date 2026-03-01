/**
 * Ticketmaster Discovery API Client
 *
 * Searches events via the Discovery v2 API and returns normalised results
 * that can be directly mapped to the portal's Event model.
 *
 * Docs: https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
 */

const TM_BASE = 'https://app.ticketmaster.com/discovery/v2';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface TMPresale {
  name: string;
  startDateTime: string;
  endDateTime: string;
}

export interface TMAttraction {
  name: string;
  upcomingEvents: number;
  twitter?: string;
  instagram?: string;
  facebook?: string;
  spotify?: string;
  youtube?: string;
}

export interface TMEvent {
  /** Ticketmaster event ID (used as Event_ID) */
  id: string;
  name: string;
  url: string;
  dateTime: string;          // ISO 8601
  localDate: string;         // YYYY-MM-DD
  localTime: string;         // HH:mm:ss
  venue: string;
  venueCity: string;
  venueState: string;
  imageUrl: string;
  classification: string;    // e.g. "Music > Rock"
  segment: string;           // e.g. "Sports", "Music"
  priceMin: number | null;
  priceMax: number | null;
  status: string;            // onsale, offsale, canceled, postponed, rescheduled
  saleStart: string;
  saleEnd: string;
  pleaseNote: string;
  // Enhanced fields
  presaleCount: number;
  presales: TMPresale[];
  ticketLimit: string;
  safeTix: boolean;
  seatmapUrl: string;
  promoter: string;
  attractions: TMAttraction[];
  venueCapacity: number | null;
  accessibility: string;
}

export interface TMSearchParams {
  keyword?: string;
  venueId?: string;
  city?: string;
  stateCode?: string;
  localStartDateTime?: string;  // Date or datetime, no Z (e.g. 2026-03-07)
  localEndDateTime?: string;    // Date or datetime, no Z (e.g. 2026-03-07)
  classificationName?: string;
  size?: number;
  page?: number;
  sort?: string;
}

export interface TMSearchResult {
  events: TMEvent[];
  total: number;
  page: number;
  totalPages: number;
}

/**
 * Search events using the Ticketmaster Discovery API.
 */
export async function searchEvents(params: TMSearchParams): Promise<TMSearchResult> {
  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) {
    throw new Error('TICKETMASTER_API_KEY is not configured');
  }

  const qs = new URLSearchParams();
  qs.set('apikey', apiKey);
  qs.set('locale', '*');
  qs.set('size', String(params.size ?? 20));
  qs.set('page', String(params.page ?? 0));
  qs.set('sort', params.sort ?? 'date,asc');
  qs.set('countryCode', 'US');
  qs.set('source', 'ticketmaster');

  if (params.keyword) qs.set('keyword', params.keyword);
  if (params.venueId) qs.set('venueId', params.venueId);
  if (params.city) qs.set('city', params.city);
  if (params.stateCode) qs.set('stateCode', params.stateCode);
  if (params.localStartDateTime) {
    // Append T00:00:00 if only a date was provided
    const start = params.localStartDateTime.includes('T') ? params.localStartDateTime : `${params.localStartDateTime}T00:00:00`;
    qs.set('localStartDateTime', start);
  }
  if (params.localEndDateTime) {
    // Append T23:59:59 if only a date was provided
    const end = params.localEndDateTime.includes('T') ? params.localEndDateTime : `${params.localEndDateTime}T23:59:59`;
    qs.set('localStartEndDateTime', end);
  }
  if (params.classificationName) qs.set('classificationName', params.classificationName);

  const url = `${TM_BASE}/events.json?${qs.toString()}`;

  const res = await fetch(url, {
    next: { revalidate: 0 },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ticketmaster API error ${res.status}: ${text}`);
  }

  const data = await res.json();

  // Handle empty results
  if (!data._embedded?.events) {
    return { events: [], total: 0, page: 0, totalPages: 0 };
  }

  const events: TMEvent[] = data._embedded.events.map((ev: any) => {
    const venue = ev._embedded?.venues?.[0];
    const classification = ev.classifications?.[0];
    const prices = ev.priceRanges?.[0];
    const images = ev.images ?? [];
    // Pick the best image (prefer 16_9 ratio, decent size)
    const image = images.find((i: any) => i.ratio === '16_9' && i.width >= 500)
      || images.find((i: any) => i.ratio === '16_9')
      || images[0];

    const classLabel = [
      classification?.segment?.name,
      classification?.genre?.name,
    ].filter(Boolean).join(' > ');

    const sales = ev.sales?.public;
    const presales: TMPresale[] = (ev.sales?.presales || []).map((p: any) => ({
      name: p.name || '',
      startDateTime: p.startDateTime || '',
      endDateTime: p.endDateTime || '',
    }));

    const attractions: TMAttraction[] = (ev._embedded?.attractions || []).map((a: any) => {
      const ext = a.externalLinks || {};
      return {
        name: a.name || '',
        upcomingEvents: a.upcomingEvents?._total ?? 0,
        twitter: ext.twitter?.[0]?.url,
        instagram: ext.instagram?.[0]?.url,
        facebook: ext.facebook?.[0]?.url,
        spotify: ext.spotify?.[0]?.url,
        youtube: ext.youtube?.[0]?.url,
      };
    });

    return {
      id: ev.id,
      name: ev.name,
      url: ev.url,
      dateTime: ev.dates?.start?.dateTime || '',
      localDate: ev.dates?.start?.localDate || '',
      localTime: ev.dates?.start?.localTime || '',
      venue: venue?.name || '',
      venueCity: venue?.city?.name || '',
      venueState: venue?.state?.stateCode || '',
      imageUrl: image?.url || '',
      classification: classLabel || '',
      segment: classification?.segment?.name || '',
      priceMin: prices?.min ?? null,
      priceMax: prices?.max ?? null,
      status: ev.dates?.status?.code || '',
      saleStart: sales?.startDateTime || '',
      saleEnd: sales?.endDateTime || '',
      pleaseNote: ev.pleaseNote || '',
      presaleCount: presales.length,
      presales,
      ticketLimit: ev.ticketLimit?.info || '',
      safeTix: ev.ticketing?.safeTix?.enabled ?? false,
      seatmapUrl: ev.seatmap?.staticUrl || '',
      promoter: ev.promoter?.name || '',
      attractions,
      venueCapacity: venue?.upcomingEvents?._total ?? null,
      accessibility: ev.accessibility?.info || '',
    };
  });

  const pageInfo = data.page || {};

  return {
    events,
    total: pageInfo.totalElements ?? events.length,
    page: pageInfo.number ?? 0,
    totalPages: pageInfo.totalPages ?? 1,
  };
}

/**
 * Get a single event by Ticketmaster ID.
 */
export async function getEventById(tmEventId: string): Promise<TMEvent | null> {
  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) throw new Error('TICKETMASTER_API_KEY is not configured');

  const url = `${TM_BASE}/events/${encodeURIComponent(tmEventId)}.json?apikey=${apiKey}&locale=*`;

  const res = await fetch(url, {
    next: { revalidate: 0 },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Ticketmaster API error ${res.status}`);
  }

  const ev = await res.json();
  const venue = ev._embedded?.venues?.[0];
  const classification = ev.classifications?.[0];
  const prices = ev.priceRanges?.[0];
  const images = ev.images ?? [];
  const image = images.find((i: any) => i.ratio === '16_9' && i.width >= 500)
    || images.find((i: any) => i.ratio === '16_9')
    || images[0];

  const classLabel = [
    classification?.segment?.name,
    classification?.genre?.name,
  ].filter(Boolean).join(' > ');

  const sales = ev.sales?.public;
  const presales: TMPresale[] = (ev.sales?.presales || []).map((p: any) => ({
    name: p.name || '',
    startDateTime: p.startDateTime || '',
    endDateTime: p.endDateTime || '',
  }));

  const attractions: TMAttraction[] = (ev._embedded?.attractions || []).map((a: any) => {
    const ext = a.externalLinks || {};
    return {
      name: a.name || '',
      upcomingEvents: a.upcomingEvents?._total ?? 0,
      twitter: ext.twitter?.[0]?.url,
      instagram: ext.instagram?.[0]?.url,
      facebook: ext.facebook?.[0]?.url,
      spotify: ext.spotify?.[0]?.url,
      youtube: ext.youtube?.[0]?.url,
    };
  });

  return {
    id: ev.id,
    name: ev.name,
    url: ev.url,
    dateTime: ev.dates?.start?.dateTime || '',
    localDate: ev.dates?.start?.localDate || '',
    localTime: ev.dates?.start?.localTime || '',
    venue: venue?.name || '',
    venueCity: venue?.city?.name || '',
    venueState: venue?.state?.stateCode || '',
    imageUrl: image?.url || '',
    classification: classLabel || '',
    segment: classification?.segment?.name || '',
    priceMin: prices?.min ?? null,
    priceMax: prices?.max ?? null,
    status: ev.dates?.status?.code || '',
    saleStart: sales?.startDateTime || '',
    saleEnd: sales?.endDateTime || '',
    pleaseNote: ev.pleaseNote || '',
    presaleCount: presales.length,
    presales,
    ticketLimit: ev.ticketLimit?.info || '',
    safeTix: ev.ticketing?.safeTix?.enabled ?? false,
    seatmapUrl: ev.seatmap?.staticUrl || '',
    promoter: ev.promoter?.name || '',
    attractions,
    venueCapacity: null,
    accessibility: ev.accessibility?.info || '',
  };
}
