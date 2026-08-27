/**
 * Stable content hash — the entire diff, in one field.
 *
 * The worker never asks StubHub what it holds in order to decide what to send.
 * It hashes the payload it *would* send and compares that to `syncHash`, the hash
 * of the payload StubHub last accepted. Equal means no-op, and no-op costs nothing:
 * no request, no rate budget, no risk. In steady state that's the overwhelming
 * majority of rows, which is what makes a per-row API affordable at book scale.
 *
 * Two properties this has to have, or the whole scheme quietly breaks:
 *
 *   Deterministic across processes and restarts. JSON.stringify follows insertion
 *   order, so two structurally identical payloads built by different code paths can
 *   serialise differently and look like a change forever. Keys are sorted here.
 *
 *   Computed on the MAPPED PAYLOAD, never the Mongo document. The document carries
 *   fields StubHub never sees (_id, updatedAt, tickets[], scraper bookkeeping) and
 *   those churn constantly. Hashing the document would mark half the book dirty on
 *   every scrape cycle for changes the marketplace cannot observe.
 */

import { createHash } from 'node:crypto';

/**
 * Canonical JSON: object keys sorted, arrays left in order (array order is
 * meaningful in these payloads — prices[] and broadcastStatuses[] are per
 * marketplace and we build them in a fixed order), undefined dropped so that an
 * absent field and an explicitly-undefined field agree.
 */
function canonicalise(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalise);

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const v = (value as Record<string, unknown>)[key];
    if (v === undefined) continue;
    out[key] = canonicalise(v);
  }
  return out;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

/** SHA-256 of the canonical form, hex. Stored as inventory.syncHash. */
export function payloadHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

/**
 * Deterministic UUIDv5-style batch id derived from a batch's contents.
 *
 * `bulkProcessingId` is the only idempotency handle the API offers — there is no
 * Idempotency-Key header on any of the 160 operations. Deriving it from content
 * rather than randomising means a retry of the same batch is provably the same
 * submission rather than a hopeful second one, and a worker that crashed after
 * submitting can recompute the id and go read the result instead of resending.
 *
 * Implemented as RFC 4122 §4.3 name-based v5 over a fixed namespace so it needs no
 * dependency and is reproducible from the batch alone.
 */
const NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8'; // RFC 4122 URL namespace

export function deriveBatchId(operation: string, memberKeys: string[]): string {
  const name = `${operation}:${[...memberKeys].sort().join(',')}`;
  const ns = Buffer.from(NAMESPACE.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(Buffer.concat([ns, Buffer.from(name, 'utf8')])).digest();

  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // RFC 4122 variant

  const hex = hash.subarray(0, 16).toString('hex');
  return [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
    hex.slice(16, 20), hex.slice(20, 32),
  ].join('-');
}
