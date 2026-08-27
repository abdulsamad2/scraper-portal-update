/**
 * Transport-level tests.
 *
 * These matter more than they look. The client is the only place that decides
 * whether a failed write gets repeated, and against an API with exactly one
 * idempotency handle a wrong answer means duplicate listings rather than an error
 * anyone would notice.
 *
 * fetch is stubbed rather than mocked through a library so the assertions are
 * about real request shapes.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { StubHubClient, StubHubError, loadConfig } from '../lib/stubhub/client.ts';

const CONFIG = {
  baseUrl: 'https://example.invalid',
  bearerToken: 'token',
  accountId: 'acct',
  dryRun: false,
  timeoutMs: 1_000,
  maxRetries: 2,
};

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; init: RequestInit }> = [];

function stubFetch(responder: (n: number) => { status: number; body?: unknown; headers?: Record<string, string> }) {
  let n = 0;
  globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const r = responder(n++);
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json', ...(r.headers ?? {}) },
    });
  }) as typeof fetch;
}

beforeEach(() => { calls = []; });
afterEach(() => { globalThis.fetch = realFetch; });

describe('config', () => {
  test('dry run is the default — writes are opt-in, not opt-out', () => {
    assert.equal(loadConfig({} as unknown as NodeJS.ProcessEnv).dryRun, true);
    assert.equal(loadConfig({ STUBHUB_DRY_RUN: 'false' } as unknown as NodeJS.ProcessEnv).dryRun, false);
  });

  test('an unconfigured client refuses to send rather than failing obscurely', async () => {
    const client = new StubHubClient({ ...CONFIG, bearerToken: '' });
    await assert.rejects(
      () => client.request({ method: 'GET', path: '/accounts', endpoint: 'GET /accounts' }),
      /must be set/
    );
  });
});

describe('requests', () => {
  test('sends bearer and Account-Id on every call', async () => {
    stubFetch(() => ({ status: 200, body: [{ sellerAccountId: 'acct' }] }));
    const client = new StubHubClient(CONFIG);
    await client.request({ method: 'GET', path: '/accounts', endpoint: 'GET /accounts' });

    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer token');
    assert.equal(headers['Account-Id'], 'acct');
  });

  test('captures x-trace-id — the only handle StubHub support can act on', async () => {
    stubFetch(() => ({ status: 400, body: { code: 'bad_request', message: 'nope' }, headers: { 'x-trace-id': 'abc123' } }));
    const client = new StubHubClient(CONFIG);
    await assert.rejects(
      () => client.request({ method: 'GET', path: '/x', endpoint: 'DEFAULT' }),
      (err: StubHubError) => {
        assert.equal(err.traceId, 'abc123');
        assert.match(err.summary, /trace abc123/);
        return true;
      }
    );
  });

  test('preserves per-field validation errors, which is how mappers get fixed', async () => {
    stubFetch(() => ({
      status: 400,
      body: { code: 'validation', message: 'invalid', errors: { splitType: ['not allowed'] } },
    }));
    const client = new StubHubClient(CONFIG);
    await assert.rejects(
      () => client.request({ method: 'GET', path: '/x', endpoint: 'DEFAULT' }),
      (err: StubHubError) => {
        assert.deepEqual(err.fieldErrors, { splitType: ['not allowed'] });
        assert.match(err.summary, /splitType=not allowed/);
        return true;
      }
    );
  });
});

describe('retry policy', () => {
  test('a non-idempotent call is never retried, even on a transient failure', async () => {
    stubFetch(() => ({ status: 503, body: { message: 'unavailable' } }));
    const client = new StubHubClient(CONFIG);

    await assert.rejects(() =>
      client.request({
        method: 'POST', path: '/inventory', endpoint: 'POST /inventory',
        body: {}, isWrite: true, idempotent: false,
      })
    );

    assert.equal(
      calls.length, 1,
      'a timed-out create may have succeeded — repeating it would duplicate the listing'
    );
  });

  test('an idempotent call retries a 5xx and succeeds', async () => {
    stubFetch(n => (n < 2 ? { status: 503, body: {} } : { status: 200, body: { ok: true } }));
    const client = new StubHubClient(CONFIG);

    const res = await client.request({
      method: 'PATCH', path: '/inventory/1', endpoint: 'PATCH /inventory/{id}',
      body: {}, isWrite: true, idempotent: true,
    });

    assert.equal(res.status, 200);
    assert.equal(calls.length, 3);
  });

  test('a 4xx is not retried — repeating a wrong request will not make it right', async () => {
    stubFetch(() => ({ status: 400, body: { message: 'bad' } }));
    const client = new StubHubClient(CONFIG);

    await assert.rejects(() =>
      client.request({
        method: 'PATCH', path: '/inventory/1', endpoint: 'PATCH /inventory/{id}',
        body: {}, isWrite: true, idempotent: true,
      })
    );
    assert.equal(calls.length, 1);
  });

  test('429 is retryable and is treated as a throttle signal', async () => {
    stubFetch(n => (n === 0 ? { status: 429, body: {} } : { status: 200, body: {} }));
    const client = new StubHubClient(CONFIG);

    await client.request({
      method: 'PATCH', path: '/inventory/1', endpoint: 'PATCH /inventory/{id}',
      body: {}, isWrite: true, idempotent: true,
    });

    assert.equal(calls.length, 2);
    const state = client.limiterState().find(s => s.endpoint === 'PATCH /inventory/{id}');
    assert.equal(state!.intervalMs >= 1_000, true, 'a throttle must widen the interval');
  });
});

describe('dry run', () => {
  test('suppresses writes but still performs reads', async () => {
    stubFetch(() => ({ status: 200, body: { ok: true } }));
    const client = new StubHubClient({ ...CONFIG, dryRun: true });

    const write = await client.request({
      method: 'POST', path: '/inventory/bulk', endpoint: 'POST /inventory/bulk',
      body: { bulkProcessingId: 'x' }, isWrite: true, idempotent: true,
    });
    assert.equal(write.skipped, true);
    assert.equal(calls.length, 0, 'nothing may leave the process in dry run');

    await client.request({ method: 'GET', path: '/accounts', endpoint: 'GET /accounts' });
    assert.equal(calls.length, 1, 'reads are how shadow mode validates against reality');
  });
});
