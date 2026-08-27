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

  test('rejects empty and legacy 7-digit ids', () => {
    assert.equal((resolveEventId('') as { reason: string }).reason, 'no-mapping');
    assert.equal((resolveEventId('5964629') as { reason: string }).reason, 'not-stubhub-shaped');
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
    assert.equal(r.create.hideSeats, true);
    assert.deepEqual(r.create.seating, { section: 'Courtside 103', row: 'D' });
    assert.equal(r.create.inHandAt, '2026-08-24T00:00:00');
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
