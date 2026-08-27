/**
 * Unit tests for the pure StubHub mapping layer.
 *
 * Run with `npm test` (Node's built-in runner; no build step — these modules are
 * deliberately free of I/O and of the Next.js module graph so they execute under
 * plain Node type-stripping).
 *
 * The split cases below are taken from an actual production export rather than
 * invented, because the whole argument that our custom_split lists collapse onto
 * StubHub's five-value enum rests on the shape of real data.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { resolveSplitType } from '../lib/stubhub/splitType.ts';
import { resolveDeliveryType } from '../lib/stubhub/deliveryType.ts';
import { resolveEventId } from '../lib/stubhub/eventResolver.ts';
import { payloadHash, stableStringify, deriveBatchId } from '../lib/stubhub/hash.ts';
import { mapRow, type InventoryRowInput } from '../lib/stubhub/mapRow.ts';
import { comparePriceEcho, ASK_PRICE_FIELD } from '../lib/stubhub/price.ts';
import { chooseWritePath, itemsPerMinute, MAX_BATCH_ITEMS, RATE_LIMITS, RECONCILIATION } from '../lib/stubhub/limits.ts';
import { planBatch, resolveRemoval, REAPPEARANCE_GRACE_MS } from '../lib/stubhub/policy.ts';
import { verifyEvent, clearEventCache } from '../lib/stubhub/eventVerifier.ts';
import { outcomes as __testOutcomes } from '../lib/sync/bulkResults.ts';
import { VERIFY_CAPACITY } from '../lib/sync/verify.ts';

describe('resolveSplitType', () => {
  // Every case here appeared in the 1,537-row export, with its observed frequency.
  const realWorld: Array<[number, string, string, string]> = [
    [2, '2', 'None', '53.8% of the book — must sell both'],
    [4, '2,4', 'Pairs', '7.0% — even quantities only'],
    [8, '1,2,3,4,5,6,8', 'AvoidOne', '7.4% — everything except leaving one'],
    [3, '1,3', 'AvoidOne', '5.5%'],
    [4, '1,2,4', 'AvoidOne', '3.3%'],
    [4, '4', 'None', '2.5%'],
    [3, '3', 'None', '2.3%'],
    [6, '2,4,6', 'Pairs', '2.2%'],
    [6, '1,2,3,4,6', 'AvoidOne', '2.1%'],
    [5, '1,2,3,5', 'AvoidOne', '1.5%'],
    [8, '1,2,3,4,5,6,7,8', 'Any', '1.4% — unrestricted'],
    [8, '1,2,3,4,6,8', 'AvoidOneAndThree', '0.8% — the genuinely distinct case'],
    [10, '1,2,3,4,5,6,7,8,10', 'AvoidOne', '0.7%'],
  ];

  for (const [quantity, customSplit, expected, note] of realWorld) {
    test(`qty ${quantity} "${customSplit}" → ${expected}  (${note})`, () => {
      const r = resolveSplitType(quantity, 'CUSTOM', customSplit);
      assert.equal(r.splitType, expected);
      assert.equal(r.exact, true, 'should be a lossless match');
      assert.equal(r.lost, undefined);
    });
  }

  // The 1.6% residue: "any quantity except a single" has no mode.
  test('residue "no singles" falls back to AvoidOne and reports the loss', () => {
    const r = resolveSplitType(5, 'CUSTOM', '2,3,4,5');
    assert.equal(r.exact, false);
    assert.equal(r.splitType, 'AvoidOne');
    assert.match(r.lost!, /wanted \[2,3,4,5\]/);
  });

  test('NEVERLEAVEONE without a list maps to AvoidOne', () => {
    const r = resolveSplitType(6, 'NEVERLEAVEONE');
    assert.deepEqual({ splitType: r.splitType, exact: r.exact }, { splitType: 'AvoidOne', exact: true });
  });

  test('quantity 1 is unrestricted — every mode permits the same thing', () => {
    assert.equal(resolveSplitType(1, 'CUSTOM', '1').splitType, 'Any');
  });

  test('ties resolve to the simplest matching rule, not the strictest', () => {
    // qty 2: None and Pairs both permit exactly {2}. None is unmistakable.
    assert.equal(resolveSplitType(2, 'CUSTOM', '2').splitType, 'None');
    // qty 3: AvoidOne and AvoidOneAndThree both permit {1,3}. The extra "or
    // three" clause is inert here, and claiming it would misstate the intent.
    assert.equal(resolveSplitType(3, 'CUSTOM', '1,3').splitType, 'AvoidOne');
    // qty 8: the clause is NOT inert — 5 leaves three behind — so it is correct.
    assert.equal(resolveSplitType(8, 'CUSTOM', '1,2,3,4,6,8').splitType, 'AvoidOneAndThree');
  });

  test('garbage split lists degrade rather than throw', () => {
    assert.equal(resolveSplitType(4, 'CUSTOM', 'x,y').splitType, 'Any');
    assert.equal(resolveSplitType(0, 'CUSTOM', '2').exact, false);
  });
});

describe('resolveDeliveryType', () => {
  test('maps the two stock types actually present in the book', () => {
    assert.equal(resolveDeliveryType('MOBILE_TRANSFER').deliveryType, 'InApp');
    assert.equal(resolveDeliveryType('MOBILE_SCREENCAP').deliveryType, 'Custom');
  });

  test('is case- and whitespace-insensitive', () => {
    assert.equal(resolveDeliveryType('  mobile_transfer ').deliveryType, 'InApp');
  });

  test('unknown values fall back to InApp and say so', () => {
    const r = resolveDeliveryType('SOMETHING_NEW');
    assert.equal(r.deliveryType, 'InApp');
    assert.equal(r.exact, false);
    assert.match(r.lost!, /unmapped stock_type/);
  });
});

describe('resolveEventId', () => {
  test('accepts a 9-digit StubHub id (verified live against GET /events)', () => {
    assert.deepEqual(resolveEventId('159262123'), { ok: true, eventId: 159262123 });
  });

  test('rejects tickets.com synthetic ids with a distinct reason', () => {
    const r = resolveEventId('tc-1787216947276');
    assert.equal(r.ok, false);
    assert.equal((r as { reason: string }).reason, 'ticketscom-synthetic');
  });

  test('rejects eVenue venue codes', () => {
    assert.equal(resolveEventId('SE26_JAB3').ok, false);
  });

  test('accepts any numeric id — digit count carries no information', () => {
    // Learned the hard way in production: 454452424 is nine digits and does not
    // exist on StubHub, while 2546456 is seven digits and does. The shape check
    // is only a pre-filter now; eventVerifier asks the API.
    assert.equal(resolveEventId('2546456').ok, true);
    assert.equal(resolveEventId('454452424').ok, true);
  });

  test('rejects empty ids and anything too large to be an int32', () => {
    assert.equal((resolveEventId('') as { reason: string }).reason, 'no-mapping');
    assert.equal((resolveEventId('99999999999') as { reason: string }).reason, 'not-stubhub-shaped');
  });
});

describe('hash', () => {
  test('key order does not affect the hash', () => {
    assert.equal(payloadHash({ a: 1, b: 2 }), payloadHash({ b: 2, a: 1 }));
  });

  test('array order does affect the hash — prices[] is per-marketplace and ordered', () => {
    assert.notEqual(payloadHash({ p: [1, 2] }), payloadHash({ p: [2, 1] }));
  });

  test('undefined and absent agree', () => {
    assert.equal(stableStringify({ a: 1, b: undefined }), stableStringify({ a: 1 }));
  });

  test('a real value change is visible', () => {
    assert.notEqual(payloadHash({ listPrice: 130 }), payloadHash({ listPrice: 131 }));
  });

  test('deriveBatchId is deterministic and order-independent', () => {
    const a = deriveBatchId('create', ['3', '1', '2']);
    const b = deriveBatchId('create', ['1', '2', '3']);
    assert.equal(a, b, 'same members in any order → same batch id, so retries are provably identical');
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test('different operations and members produce different batch ids', () => {
    assert.notEqual(deriveBatchId('create', ['1']), deriveBatchId('delete', ['1']));
    assert.notEqual(deriveBatchId('create', ['1']), deriveBatchId('create', ['2']));
  });
});

describe('mapRow', () => {
  const base: InventoryRowInput = {
    inventory_id: 2540402267,
    event_id: '159262123',
    quantity: 4,
    section: 'Courtside 103',
    row: 'D',
    seats: '3,4,5,6',
    public_notes: 'xfer, Seated Together',
    internal_notes: '-tnow -tmplus -geek',
    tags: 'RESALE BROKER',
    list_price: 688.56,
    face_price: 393,
    taxed_cost: 529.66,
    cost: 529.66,
    hide_seats: 'Y',
    in_hand_date: '2026-08-24',
    split_type: 'CUSTOM',
    custom_split: '2,4',
    stock_type: 'MOBILE_TRANSFER',
    zone: 'N',
  };

  test('maps a real production row end to end', () => {
    const r = mapRow(base);
    assert.equal(r.ok, true);
    if (!r.ok) return;

    assert.equal(r.externalId, '2540402267', 'inventoryId becomes the join key');
    assert.equal(r.create.event!.id, 159262123);
    assert.equal(r.create.ticketCount, 4);
    assert.equal(r.create.splitType, 'Pairs');
    assert.equal(r.create.deliveryType, 'InApp');
    assert.equal(r.create.unitCost, 529.66);
    assert.equal(r.create.hideSeats, undefined, 'omitted unless the account has the feature');
    assert.deepEqual(r.create.seating, { section: 'Courtside 103', row: 'D' });
    assert.equal(r.create.inHandAt, '2026-08-24T00:00:00');
  });

  test('hideSeats is sent only when the account supports it', () => {
    // Without ExtApiInvCreateFeatures the API rejects the whole create with
    // "hideSeats is not enabled for this account", and through bulk that arrives
    // as an undebuggable "internal error occurred while processing this item".
    assert.equal(mapRow(base).ok && (mapRow(base) as { create: { hideSeats?: boolean } }).create.hideSeats, undefined);
    const enabled = mapRow(base, { hideSeatsSupported: true });
    assert.equal(enabled.ok && enabled.create.hideSeats, true);
  });

  test('the update always carries hideSeats — PATCH is not feature-gated', () => {
    const r = mapRow(base);
    assert.equal(r.ok && r.update.hideSeats, true,
      'this is what actually hides seats without ExtApiInvCreateFeatures');
    const shown = mapRow({ ...base, hide_seats: 'N' });
    assert.equal(shown.ok && shown.update.hideSeats, false);
  });

  test('never broadcasts at create — nothing goes live without a price', () => {
    const r = mapRow(base);
    assert.equal(r.ok && r.create.autoBroadcast, false);
  });

  test('create carries no price; the price is in the follow-up update', () => {
    const r = mapRow(base);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal('prices' in r.create, false, 'InventoryCreateRequest has no price field');
    assert.deepEqual(r.update.prices, [{ marketplace: 'StubHub', listPrice: 688.56 }]);
    assert.deepEqual(r.update.broadcastStatuses, [{ marketplace: 'StubHub', posBroadcastState: 'List' }]);
  });

  test('Automatiq routing tokens never reach StubHub internal notes', () => {
    const r = mapRow(base);
    assert.equal(r.ok && r.create.internalNotes, undefined);
  });

  test('adding ReachPro is two array entries, not a second integration', () => {
    const r = mapRow(base, { marketplaces: ['StubHub', 'ReachPro'] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.update.prices!.map(p => p.marketplace), ['StubHub', 'ReachPro']);
    assert.deepEqual(r.update.broadcastStatuses!.map(b => b.marketplace), ['StubHub', 'ReachPro']);
  });

  test('priceField switch moves the ask to allInPrice (StubHub question P4)', () => {
    const r = mapRow(base, { priceField: 'allInPrice' });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.update.prices, [{ marketplace: 'StubHub', allInPrice: 688.56 }]);
  });

  test('GA rows drop the synthetic row label and become zone fills', () => {
    const r = mapRow({ ...base, row: 'GA3', seats: '', zone: 'Y' });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.create.seating!.row, null, 'GA3 is scraper bookkeeping, not a real row');
    assert.equal(r.create.zoneFill, true);
  });

  test('unresolvable events are skipped, never guessed', () => {
    const r = mapRow({ ...base, event_id: 'tc-1787216947276' });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, 'ticketscom-synthetic');
    assert.equal(r.externalId, '2540402267', 'skips still identify the row for reporting');
  });

  test('representation losses surface as warnings rather than silence', () => {
    const r = mapRow({ ...base, quantity: 5, custom_split: '2,3,4,5', stock_type: 'WEIRD' });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.warnings.length >= 2, true);
    assert.match(r.warnings.join(' '), /split:/);
    assert.match(r.warnings.join(' '), /delivery:/);
  });

  test('identical rows hash identically; a price move does not', () => {
    const a = mapRow(base);
    const b = mapRow({ ...base });
    const c = mapRow({ ...base, list_price: 700 });
    assert.equal(a.ok && b.ok && c.ok, true);
    if (!a.ok || !b.ok || !c.ok) return;
    assert.equal(payloadHash([a.create, a.update]), payloadHash([b.create, b.update]));
    assert.notEqual(payloadHash([a.create, a.update]), payloadHash([c.create, c.update]));
  });

  test('is total — malformed input degrades instead of throwing', () => {
    assert.doesNotThrow(() => mapRow({ ...base, quantity: 0, in_hand_date: 'not-a-date' }));
  });
});

describe('price echo verification', () => {
  const listing = (listPrice: number | null, allInPrice: number | null) => ({
    id: 1146693166,
    listingPricesByMarketplace: [
      { marketplaceName: 'StubHub' as const, listPrice, allInPrice, marketplaceMarkup: null },
    ],
  });

  test('matching echo passes and measures the buyer-fee load', () => {
    // Shape taken from live sandbox listing 1146693166.
    const r = comparePriceEcho(120, listing(120, 120));
    assert.equal(r.match, true);
    assert.equal(r.feeRatio, 0);
    assert.match(r.detail, /price held at 120/);
  });

  test('a fee-bearing echo still matches — allInPrice is derived, not our input', () => {
    const r = comparePriceEcho(120, listing(120, 138));
    assert.equal(r.match, true);
    assert.equal(Math.round(r.feeRatio! * 100), 15);
  });

  test('an inflated listPrice fails loudly and names the likely cause', () => {
    const r = comparePriceEcho(120, listing(132, 132));
    assert.equal(r.match, false);
    assert.match(r.detail, /read\s+as a base rather than the ask|revisit ASK_PRICE_FIELD/);
  });

  test('a missing marketplace entry is a failure, not a silent pass', () => {
    const r = comparePriceEcho(120, { id: 1, listingPricesByMarketplace: [] });
    assert.equal(r.match, false);
    assert.match(r.detail, /no StubHub price echoed back/);
  });

  test('mapRow sends the ask in the field price.ts nominates', () => {
    const r = mapRow({
      inventory_id: 1, event_id: '159262123', quantity: 2, section: 'A', row: 'B',
      cost: 100, list_price: 130,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal((r.update.prices![0] as unknown as Record<string, unknown>)[ASK_PRICE_FIELD], 130);
  });
});

describe('rate limits and write-path selection', () => {
  test('creates always take the bulk path — they are the only non-idempotent write', () => {
    assert.equal(chooseWritePath('create', 1), 'bulk');
    assert.equal(chooseWritePath('create', 1, { urgent: true }), 'bulk');
  });

  test('small urgent updates go direct — PATCH is idempotent, so retry is safe', () => {
    assert.equal(chooseWritePath('update', 1, { urgent: true }), 'single');
    assert.equal(chooseWritePath('delete', 2), 'single');
  });

  test('volume goes to bulk', () => {
    assert.equal(chooseWritePath('update', 500), 'bulk');
    assert.equal(chooseWritePath('delete', 500), 'bulk');
  });

  test('bulk is roughly an order of magnitude more capable than single PATCH', () => {
    const bulk = itemsPerMinute('bulk', 'update');
    const single = itemsPerMinute('single', 'update');
    assert.equal(bulk, 760 * 250 * 0.5);
    assert.equal(single, 12_880 * 0.5);
    assert.equal(bulk > single * 10, true);
  });

  test('batch cap is StubHub-stated, not guessed', () => {
    assert.equal(MAX_BATCH_ITEMS, 250);
  });

  test('the export cap is what forces the local-hash diff', () => {
    // One call per two minutes cannot serve a per-cycle diff on a 2-minute scrape.
    assert.equal(RECONCILIATION.minExportIntervalSeconds, 120);
    assert.equal(RATE_LIMITS['GET /inventory/search'], 10);
  });
});

describe('drain policy — instant without spamming', () => {
  test('a single dirty row goes immediately, no waiting to fill a batch', () => {
    const p = planBatch(1, 'update');
    assert.deepEqual({ size: p.size, path: p.path, more: p.more }, { size: 1, path: 'single', more: false });
  });

  test('under load it batches to the cap and asks to drain again without sleeping', () => {
    const p = planBatch(600, 'update');
    assert.equal(p.size, 250);
    assert.equal(p.path, 'bulk');
    assert.equal(p.more, true, 'more work remains — loop again rather than idle');
  });

  test('one create still batches — idempotency, not efficiency', () => {
    assert.equal(planBatch(1, 'create').path, 'bulk');
  });

  test('nothing pending plans nothing', () => {
    assert.deepEqual(planBatch(0, 'update').size, 0);
  });
});

describe('removal policy — protect instantly, churn never', () => {
  const now = new Date('2026-08-27T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);

  test('a vanished row is delisted first, not deleted', () => {
    const d = resolveRemoval({ stubhubListingId: '1', delistedAt: null, reappeared: false, reason: 'scraper-removed', now });
    assert.equal(d.action, 'delist', 'stop it selling immediately — that is the half that matters');
  });

  test('inside the grace window it waits rather than deleting', () => {
    const d = resolveRemoval({ stubhubListingId: '1', delistedAt: ago(60_000), reappeared: false, reason: 'scraper-removed', now });
    assert.equal(d.action, 'wait');
  });

  test('a reappearing row is re-broadcast on its existing listing, not recreated', () => {
    const d = resolveRemoval({ stubhubListingId: '1', delistedAt: ago(60_000), reappeared: true, reason: 'scraper-removed', now });
    assert.equal(d.action, 'cancel');
    assert.match(d.reason, /re-broadcast/);
  });

  test('past the window it finally deletes', () => {
    const d = resolveRemoval({ stubhubListingId: '1', delistedAt: ago(REAPPEARANCE_GRACE_MS + 1000), reappeared: false, reason: 'scraper-removed', now });
    assert.equal(d.action, 'delete');
  });

  test('final reasons skip the grace window once delisted', () => {
    const d = resolveRemoval({ stubhubListingId: '1', delistedAt: ago(1000), reappeared: false, reason: 'event-expired', now });
    assert.equal(d.action, 'delete');
  });

  test('a listing that never existed resolves locally with no API call', () => {
    const d = resolveRemoval({ stubhubListingId: null, delistedAt: null, reappeared: false, reason: 'scraper-removed', now });
    assert.equal(d.action, 'cancel');
  });
});

describe('event verification', () => {
  const stub = (event: unknown) => ({
    request: async () => ({ data: event ? { event } : {}, status: 200, traceId: null, skipped: false }),
  }) as unknown as Parameters<typeof verifyEvent>[0];

  test('rejects non-numeric ids without spending a request', async () => {
    let called = false;
    const spy = { request: async () => { called = true; return { data: {}, status: 200, traceId: null, skipped: false }; } };
    const r = await verifyEvent(spy as unknown as Parameters<typeof verifyEvent>[0], 'tc-1787216947276');
    assert.equal(r.ok, false);
    assert.equal((r as { reason: string }).reason, 'not-numeric');
    assert.equal(called, false, 'a lookup for something that cannot be an id is wasted budget');
  });

  test('accepts an event whose date matches ours', async () => {
    clearEventCache();
    const r = await verifyEvent(stub({ id: 159262123, name: 'Braves', date: '2026-05-22T19:15:00' }),
      '159262123', { name: 'Braves', date: '2026-05-22T19:15:00' });
    assert.equal(r.ok, true);
  });

  test('rejects a real id that belongs to a different event', async () => {
    // The production case: 2546456 exists, but it is a 2018 baseball game while
    // our row is a Bruno Mars concert. Listing against it would have succeeded.
    clearEventCache();
    const r = await verifyEvent(
      stub({ id: 2546456, name: 'Cleveland Indians At Arizona Diamondbacks', date: '2018-03-26T18:40:00' }),
      '2546456',
      { name: 'Bruno Mars The Romantic Tour', date: '2026-11-01T20:00:00' }
    );
    assert.equal(r.ok, false);
    assert.equal((r as { reason: string }).reason, 'wrong-event');
    assert.match((r as { detail: string }).detail, /days apart/);
  });

  test('tolerates a rescheduled event rather than refusing to list it', async () => {
    clearEventCache();
    const r = await verifyEvent(stub({ id: 1, name: 'Show', date: '2026-05-25T19:00:00' }),
      '1', { name: 'Show', date: '2026-05-22T19:00:00' });
    assert.equal(r.ok, true, 'three days is a reschedule, not a different event');
  });

  test('an id StubHub does not know is not-found, not a wrong match', async () => {
    clearEventCache();
    const r = await verifyEvent(stub(null), '454452424', { date: '2026-01-01' });
    assert.equal((r as { reason: string }).reason, 'not-found');
  });
});

describe('bulk result matching', () => {
  test('an update result is matched by entityId when it carries no externalId', () => {
    // The shape StubHub actually returns for updates: identified by the id the
    // request supplied, which for an update is inventoryId, not externalId.
    // Keying only on externalId discarded every outcome silently — the writes
    // succeeded while the worker believed nothing had happened.
    const summary = { finished: true, completed: [{ entityId: 1818287155 }], failed: [], skipped: [] };
    const map = __testOutcomes(summary);
    assert.equal(map.get('1818287155')?.ok, true);
  });

  test('a create result is still matched by externalId', () => {
    const summary = { finished: true, completed: [{ entityId: 99, externalId: '2540402267' }], failed: [], skipped: [] };
    const map = __testOutcomes(summary);
    assert.equal(map.get('2540402267')?.ok, true);
    assert.equal(map.get('99')?.ok, true, 'reachable by either id');
  });

  test('a failure carries the per-field reason under both keys', () => {
    const summary = {
      finished: true, completed: [], skipped: [],
      failed: [{ entityId: 7, error: { code: 'bad_request', message: 'nope', errors: { splitType: ['not allowed'] } } }],
    };
    const map = __testOutcomes(summary);
    assert.equal(map.get('7')?.ok, false);
    assert.match(map.get('7')!.error!, /splitType=not allowed/);
  });
});

describe('capacity model — what 3,000 events actually needs', () => {
  // These are not aspirational numbers. They come from StubHub's stated limits
  // and the measured production shape (627,525 rows across 363 active events),
  // and they decide the transport rather than the other way round.
  const ROWS_PER_EVENT = 627525 / 363;
  const CYCLE_S = 120;

  const patchPerSecond = 12_880 / 60;
  const bulkSubmitPerSecond = (760 * 250) / 60;
  const bulkStatusPerSecond = (100 * 250) / 60;
  const seekPerSecond = (VERIFY_CAPACITY.seekPerMinute * VERIFY_CAPACITY.idsPerCall) / 60;

  test('PATCH alone cannot carry 3,000 events', () => {
    const book = ROWS_PER_EVENT * 3000;
    const onePercentPerCycle = (book * 0.01) / CYCLE_S;
    assert.equal(onePercentPerCycle > patchPerSecond, true,
      'even a 1% change rate exceeds 215 items/s, so single-call cannot be the only path');
  });

  test('polling bulk status would cap the system below PATCH-times-two', () => {
    assert.equal(Math.round(bulkStatusPerSecond), 417);
    assert.equal(bulkStatusPerSecond < bulkSubmitPerSecond / 7, true,
      'confirmation, not writing, is what the status endpoint limits');
  });

  test('verifying with seek lifts the ceiling roughly sixfold', () => {
    assert.equal(Math.round(seekPerSecond), 2333);
    assert.equal(Math.round(seekPerSecond / bulkStatusPerSecond), 6);
  });

  test('row building, not the API, is what limits a large book', () => {
    // ~6ms per row to fetch and map, measured against the live collection.
    const buildMsPerRow = 6.3;
    const perPipelinePerCycle = CYCLE_S / (buildMsPerRow / 1000);
    assert.equal(Math.round(perPipelinePerCycle), 19_048);

    const apiPerCycle = Math.min(bulkSubmitPerSecond, seekPerSecond) * CYCLE_S;
    assert.equal(perPipelinePerCycle < apiPerCycle / 10, true,
      'one sequential pipeline is more than an order of magnitude below the API ceiling');
  });

  test('1,500 events needs several pipelines even at a 1% change rate', () => {
    const book = ROWS_PER_EVENT * 1500;
    const perPipelinePerCycle = CYCLE_S / (6.3 / 1000);
    const needed = (pct: number) => (book * pct / 100) / perPipelinePerCycle;

    assert.equal(Math.ceil(needed(1)), 2, '1% needs 2 pipelines');
    assert.equal(Math.ceil(needed(5)), 7, '5% needs 7');
    assert.equal(needed(10) < 14, true, 'even 10% is reachable by parallelism, not a redesign');
  });

  test('the resulting ceiling is a real number we can quote', () => {
    // Verification is still marginally the binding constraint (2,333/s against
    // bulk submit's 3,167/s) — worth knowing, because it means a larger seek
    // chunk or a higher seek quota buys throughput, while more write budget
    // would not.
    const ceiling = Math.min(bulkSubmitPerSecond, seekPerSecond);
    assert.equal(Math.round(ceiling), 2333);
    assert.equal(Math.round(ceiling * CYCLE_S), 280_000,
      'about 280k changes per 2-minute cycle, or ~5.4% of a 5.2M-row book');
  });
});

describe('circuit breaker — what counts as "something is wrong"', () => {
  // The breaker exists for the systemic case: token expired, resolution broken,
  // the API refusing everything. It must NOT fire on a known-bad event, because
  // claims are ordered by event date — so one misconfigured event fills every
  // slice, trips the breaker at 100%, and starves every good row behind it.
  // That is not a hypothetical: it stopped a live run cold.
  const ratio = 0.9;
  const wouldAbort = (unexplained: number, claimed: number, actionable: number) =>
    claimed > 0 && unexplained / claimed > ratio && actionable === 0;

  test('a fully bad event does not trip it — those skips are explained', () => {
    assert.equal(wouldAbort(0, 100, 0), false,
      '100 rows skipped for a verified-unusable event is a data problem, not a system fault');
  });

  test('wholesale lookup failure does trip it', () => {
    assert.equal(wouldAbort(100, 100, 0), true,
      'events that could not be looked up at all is the shape the breaker is for');
  });

  test('it never fires while there is real work in the pass', () => {
    assert.equal(wouldAbort(100, 100, 5), false,
      'if anything is actionable the cycle proceeds — partial failure is not systemic failure');
  });
});
