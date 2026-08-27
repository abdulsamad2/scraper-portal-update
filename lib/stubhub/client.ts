/**
 * StubHub POS transport.
 *
 * Auth, timeouts, retries, rate control and dry-run — and nothing about listings.
 * Everything above this layer deals in payloads; this layer deals in requests.
 *
 * ── Rate control ───────────────────────────────────────────────────────────────
 *
 * StubHub gave us per-endpoint limits out of band (see limits.ts); the spec
 * itself declares no 429 on any of its 160 operations and returns no
 * X-RateLimit-* or Retry-After header, so there is no in-band signal at all. That
 * cuts both ways: we cannot read our remaining budget, and we would not be told
 * how long to wait if we exceeded it.
 *
 * So the limiter budgets from the table but does not trust it. Additive increase
 * on success, multiplicative decrease on 429 or 5xx. If the table is stale, or a
 * limit turns out to be shared with something else on the account, the loop
 * discovers that and backs off rather than hammering a closed door.
 *
 * ── Retries ────────────────────────────────────────────────────────────────────
 *
 * One retry layer, here. Callers must not wrap this in another — nested backoff
 * turns a 3x retry into 9x and a brief outage into a self-inflicted one.
 *
 * Retries are only ever applied to requests that are safe to repeat. That is a
 * property of the call, not of the failure: PATCH and DELETE are idempotent by
 * nature, bulk carries a caller-supplied idempotency key, and a bare
 * POST /inventory is none of those. The caller declares it; the default is no.
 *
 * ── Dry run ────────────────────────────────────────────────────────────────────
 *
 * The switch sits at the transport boundary rather than in a parallel "simulate"
 * path, so what shadow mode reports is byte-identical to what would be sent. A
 * separate simulation path drifts from the real one and then reassures you about
 * code that no longer exists.
 */

import { RATE_LIMITS, RATE_UTILISATION } from './limits.ts';

export interface StubHubConfig {
  baseUrl: string;
  bearerToken: string;
  accountId: string;
  /** When true, writes are logged and skipped. Reads still execute. */
  dryRun: boolean;
  timeoutMs: number;
  maxRetries: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): StubHubConfig {
  return {
    baseUrl: env.STUBHUB_BASE_URL || 'https://pointofsaleapi.stubhub.net',
    bearerToken: env.STUBHUB_BEARER_TOKEN || '',
    accountId: env.STUBHUB_ACCOUNT_ID || '',
    dryRun: env.STUBHUB_DRY_RUN !== 'false',
    timeoutMs: Number(env.STUBHUB_TIMEOUT_MS) || 30_000,
    maxRetries: Number(env.STUBHUB_MAX_RETRIES) || 4,
  };
}

export class StubHubError extends Error {
  readonly status: number;
  readonly code: string | null;
  /** Per-field validation messages — the most useful thing for fixing mappers. */
  readonly fieldErrors: Record<string, string[]> | null;
  /** CloudFront request id. The only handle StubHub support can act on. */
  readonly traceId: string | null;
  readonly retryable: boolean;

  constructor(opts: {
    message: string;
    status: number;
    code?: string | null;
    fieldErrors?: Record<string, string[]> | null;
    traceId?: string | null;
    retryable: boolean;
  }) {
    super(opts.message);
    this.name = 'StubHubError';
    this.status = opts.status;
    this.code = opts.code ?? null;
    this.fieldErrors = opts.fieldErrors ?? null;
    this.traceId = opts.traceId ?? null;
    this.retryable = opts.retryable;
  }

  /** One line carrying everything needed to diagnose or report this. */
  get summary(): string {
    const fields = this.fieldErrors
      ? ' ' + Object.entries(this.fieldErrors).map(([k, v]) => `${k}=${v.join('/')}`).join(' ')
      : '';
    return `${this.status}${this.code ? ` ${this.code}` : ''}: ${this.message}${fields}` +
      (this.traceId ? ` [trace ${this.traceId}]` : '');
  }
}

/**
 * Adaptive rate limiter.
 *
 * Deliberately simple: a delay between requests, widened on failure and narrowed
 * on sustained success. A token bucket would be more precise, but precision
 * against an unpublished, unobservable limit is false comfort — what matters is
 * that repeated throttling makes us slower and quiet success makes us faster.
 */
class AdaptiveLimiter {
  private intervalMs: number;
  private readonly floorMs: number;
  private readonly ceilingMs = 60_000;
  private nextAllowedAt = 0;
  private consecutiveOk = 0;

  constructor(requestsPerMinute: number) {
    this.floorMs = (60_000 / Math.max(requestsPerMinute * RATE_UTILISATION, 1));
    this.intervalMs = this.floorMs;
  }

  async wait(): Promise<void> {
    const now = Date.now();
    const delay = Math.max(0, this.nextAllowedAt - now);
    this.nextAllowedAt = Math.max(now, this.nextAllowedAt) + this.intervalMs;
    if (delay > 0) await sleep(delay);
  }

  /** Additive increase — 20 clean requests halve the interval back toward floor. */
  recordSuccess(): void {
    if (++this.consecutiveOk >= 20) {
      this.consecutiveOk = 0;
      this.intervalMs = Math.max(this.floorMs, this.intervalMs * 0.5);
    }
  }

  /** Multiplicative decrease. Throttling is expensive; overreact. */
  recordThrottle(): void {
    this.consecutiveOk = 0;
    this.intervalMs = Math.min(this.ceilingMs, Math.max(this.intervalMs * 4, 1_000));
  }

  get currentIntervalMs(): number {
    return this.intervalMs;
  }
}

const limiters = new Map<string, AdaptiveLimiter>();

function limiterFor(endpoint: keyof typeof RATE_LIMITS): AdaptiveLimiter {
  const key = String(endpoint);
  if (!limiters.has(key)) {
    limiters.set(key, new AdaptiveLimiter(RATE_LIMITS[endpoint] ?? RATE_LIMITS.DEFAULT));
  }
  return limiters.get(key)!;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  path: string;
  /** Which limit bucket this call draws from. */
  endpoint: keyof typeof RATE_LIMITS;
  body?: unknown;
  /**
   * Whether repeating this exact request is harmless. PATCH and DELETE are
   * idempotent by nature; bulk carries its own idempotency key. A bare create is
   * neither and must never be retried blind — a timeout that actually succeeded
   * would become two listings.
   */
  idempotent?: boolean;
  /** Writes are suppressed in dry-run; reads are not. */
  isWrite?: boolean;
}

export interface RequestResult<T> {
  data: T | null;
  status: number;
  traceId: string | null;
  /** True when dry-run suppressed the call. */
  skipped: boolean;
}

export class StubHubClient {
  readonly config: StubHubConfig;

  constructor(config: StubHubConfig = loadConfig()) {
    this.config = config;
  }

  /** Whether the client is configured well enough to talk to anything. */
  get configured(): boolean {
    return Boolean(this.config.bearerToken && this.config.accountId);
  }

  async request<T>(opts: RequestOptions): Promise<RequestResult<T>> {
    if (!this.configured) {
      throw new StubHubError({
        message: 'STUBHUB_BEARER_TOKEN and STUBHUB_ACCOUNT_ID must be set',
        status: 0,
        retryable: false,
      });
    }

    if (opts.isWrite && this.config.dryRun) {
      console.log(
        `[stubhub:dry-run] ${opts.method} ${opts.path} ` +
        `${opts.body ? JSON.stringify(opts.body).slice(0, 2000) : ''}`
      );
      return { data: null, status: 0, traceId: null, skipped: true };
    }

    const limiter = limiterFor(opts.endpoint);
    let lastError: StubHubError | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      await limiter.wait();

      try {
        const result = await this.send<T>(opts);
        limiter.recordSuccess();
        return result;
      } catch (error) {
        const shError = error instanceof StubHubError
          ? error
          : new StubHubError({ message: String(error), status: 0, retryable: true });

        if (shError.status === 429 || shError.status >= 500) limiter.recordThrottle();

        lastError = shError;

        // A non-idempotent call is not retried even when the failure looks
        // transient: a timed-out create may well have succeeded, and there is no
        // way to tell from here. The caller reconciles by externalId instead.
        const mayRetry = shError.retryable && (opts.idempotent ?? false);
        if (!mayRetry || attempt === this.config.maxRetries) break;

        const backoff = Math.min(30_000, 500 * 2 ** attempt) + Math.random() * 250;
        await sleep(backoff);
      }
    }

    throw lastError!;
  }

  private async send<T>(opts: RequestOptions): Promise<RequestResult<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.config.baseUrl}${opts.path}`, {
        method: opts.method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.config.bearerToken}`,
          'Account-Id': this.config.accountId,
          Accept: 'application/json',
          ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });

      const traceId = response.headers.get('x-trace-id');
      const text = await response.text();
      const parsed = text ? safeJson(text) : null;

      if (!response.ok) {
        // Two error shapes come back from this API. Documented failures use
        // ErrorResource (code/message/errors); ASP.NET model validation returns
        // RFC 9110 problem+json instead, with `title` in place of `message` and a
        // W3C traceparent in the body rather than the x-trace-id header. Read both
        // rather than falling back to a raw string slice, because the per-field
        // `errors` map is the only thing that says which field was wrong.
        const err = (parsed ?? {}) as {
          code?: string; message?: string; title?: string;
          errors?: Record<string, string[]>; traceId?: string;
        };
        throw new StubHubError({
          message: err.message || err.title || text.slice(0, 500) || response.statusText,
          status: response.status,
          code: err.code ?? null,
          fieldErrors: err.errors ?? null,
          traceId: traceId ?? err.traceId ?? null,
          // 4xx other than 429 means the request is wrong; repeating it will not
          // make it right.
          retryable: response.status === 429 || response.status >= 500,
        });
      }

      return { data: parsed as T, status: response.status, traceId, skipped: false };
    } catch (error) {
      if (error instanceof StubHubError) throw error;
      const aborted = (error as Error)?.name === 'AbortError';
      throw new StubHubError({
        message: aborted ? `timeout after ${this.config.timeoutMs}ms` : String(error),
        status: 0,
        retryable: true,
        traceId: null,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Current backoff state, for the dashboard. */
  limiterState(): Array<{ endpoint: string; intervalMs: number }> {
    return [...limiters.entries()].map(([endpoint, l]) => ({
      endpoint,
      intervalMs: Math.round(l.currentIntervalMs),
    }));
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
