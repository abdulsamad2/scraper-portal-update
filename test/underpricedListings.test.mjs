// Tests for the underpriced-listing detector in lib/inventoryWatcher.
//
// These drive the real findUnderpricedRows export rather than a copy of the
// arithmetic, so a change to the rule is actually caught. The module imports
// dbConnect, which throws when MONGODB_URI is unset but never connects on
// import, so the npm script supplies a placeholder and no network is touched.
//
// Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

import { findUnderpricedRows } from '../lib/underpriced.js';

/** Build the snapshot shape the watcher keeps: one entry per (event, section, row). */
function stateWith(rows) {
  const snapshot = new Map();
  for (const r of rows) {
    const eventId = r.eventId ?? 'evt-1';
    snapshot.set(`${eventId}|${r.section}|${r.row}`, {
      price: r.price,
      tag: r.tag ?? 'resale',
      section: r.section,
      row: r.row,
      rowRank: r.rowRank,
      seatRange: r.seatRange ?? '1-2',
      eventId,
    });
  }
  return { snapshot };
}

const dirty = (...keys) => new Set(keys.map(k => (k.includes('|') ? k : `evt-1|${k}`)));

// A section priced normally: the front row costs the most, each row back is
// cheaper. Nothing here should ever fire.
const NATURAL = [
  { section: '107', row: '1', rowRank: 0, price: 900 },
  { section: '107', row: '2', rowRank: 1, price: 800 },
  { section: '107', row: '3', rowRank: 2, price: 700 },
  { section: '107', row: '4', rowRank: 3, price: 600 },
  { section: '107', row: '5', rowRank: 4, price: 500 },
];

test('a listing far below the rows behind it is flagged', () => {
  const found = findUnderpricedRows(
    stateWith([
      { section: '107', row: '1', rowRank: 0, price: 900 },
      { section: '107', row: '2', rowRank: 1, price: 300, seatRange: '5-6' }, // the bargain
      { section: '107', row: '3', rowRank: 2, price: 800 },
      { section: '107', row: '4', rowRank: 3, price: 850 },
      { section: '107', row: '5', rowRank: 4, price: 820 },
    ]),
    dirty('107'),
  );

  assert.equal(found.length, 1);
  assert.equal(found[0].row, '2');
  assert.equal(found[0].seatRange, '5-6');
  // Compared against rows 3, 4 and 5 only — never the pricier row in front.
  assert.equal(found[0].comparableCount, 3);
  assert.equal(found[0].comparableAvg.toFixed(2), ((800 + 850 + 820) / 3).toFixed(2));
  assert.ok(found[0].pctBelow > 60, `expected a deep discount, got ${found[0].pctBelow}`);
});

test('a cheap back row is not flagged for being behind the expensive ones', () => {
  // This is the whole reason the rule is row-aware: against a flat section
  // average every one of these would look underpriced.
  assert.deepEqual(findUnderpricedRows(stateWith(NATURAL), dirty('107')), []);
});

test('a row with too few comparables is skipped, not judged', () => {
  const tooFew = [
    { section: '107', row: '1', rowRank: 0, price: 900 },
    { section: '107', row: '2', rowRank: 1, price: 100 }, // only 2 rows behind it
    { section: '107', row: '3', rowRank: 2, price: 900 },
    { section: '107', row: '4', rowRank: 3, price: 900 },
  ];
  assert.deepEqual(findUnderpricedRows(stateWith(tooFew), dirty('107')), []);

  // One more row behind it and the same listing now has enough to judge against.
  const enough = [...tooFew, { section: '107', row: '5', rowRank: 4, price: 900 }];
  const found = findUnderpricedRows(stateWith(enough), dirty('107'));
  assert.equal(found.length, 1);
  assert.equal(found[0].row, '2');
  assert.equal(found[0].comparableCount, 3);
});

test('a listing with no row rank is ignored', () => {
  const found = findUnderpricedRows(
    stateWith([
      { section: '107', row: 'GA', rowRank: null, price: 10 }, // no ordering to judge it by
      { section: '107', row: '1', rowRank: 0, price: 900 },
      { section: '107', row: '3', rowRank: 2, price: 800 },
      { section: '107', row: '4', rowRank: 3, price: 850 },
      { section: '107', row: '5', rowRank: 4, price: 820 },
    ]),
    dirty('107'),
  );
  assert.deepEqual(found, []);
});

test('only sections touched this cycle are examined', () => {
  const bargainIn = (section) => ([
    { section, row: '1', rowRank: 0, price: 900 },
    { section, row: '2', rowRank: 1, price: 200 },
    { section, row: '3', rowRank: 2, price: 800 },
    { section, row: '4', rowRank: 3, price: 850 },
    { section, row: '5', rowRank: 4, price: 820 },
  ]);
  const state = stateWith([...bargainIn('107'), ...bargainIn('108')]);

  const found = findUnderpricedRows(state, dirty('107'));
  assert.equal(found.length, 1, 'the untouched section must not be re-scanned');
  assert.equal(found[0].section, '107');

  assert.equal(findUnderpricedRows(state, dirty('107', '108')).length, 2);
});

test('listings sharing a row rank are compared against each other', () => {
  const found = findUnderpricedRows(
    stateWith([
      { section: '107', row: '1', rowRank: 0, price: 900 },
      { section: '107', row: '3a', rowRank: 2, price: 800 },
      { section: '107', row: '3b', rowRank: 2, price: 200 }, // same rank, far cheaper
      { section: '107', row: '4', rowRank: 3, price: 800 },
      { section: '107', row: '5', rowRank: 4, price: 800 },
    ]),
    dirty('107'),
  );

  assert.equal(found.length, 1);
  assert.equal(found[0].row, '3b');
  // Its own rank-mate counts as a comparable, so 3a is in the average.
  assert.equal(found[0].comparableCount, 3);
  assert.equal(found[0].comparableAvg, 800);
});

test('the deepest discount is reported first', () => {
  const found = findUnderpricedRows(
    stateWith([
      { section: '107', row: '1', rowRank: 0, price: 200 },  // 68% below the rows behind
      { section: '107', row: '2', rowRank: 1, price: 100 },  // 87% below
      { section: '107', row: '3', rowRank: 2, price: 800 },
      { section: '107', row: '4', rowRank: 3, price: 800 },
      { section: '107', row: '5', rowRank: 4, price: 800 },
    ]),
    dirty('107'),
  );

  assert.deepEqual(found.map(f => f.row), ['2', '1']);
  assert.ok(found[0].pctBelow > found[1].pctBelow);
});

test('a listing with no usable price is left out of the comparison', () => {
  const found = findUnderpricedRows(
    stateWith([
      { section: '107', row: '1', rowRank: 0, price: 0 },    // must not be reported
      { section: '107', row: '2', rowRank: 1, price: 300 },
      { section: '107', row: '3', rowRank: 2, price: 800 },
      { section: '107', row: '4', rowRank: 3, price: 850 },
      { section: '107', row: '5', rowRank: 4, price: 820 },
    ]),
    dirty('107'),
  );

  assert.equal(found.length, 1);
  assert.equal(found[0].row, '2', 'the $0 row must not be flagged as a bargain');
});

// ── Drops ───────────────────────────────────────────────────────────────────
// Every row the watcher processes marks its section dirty, so a drop always
// causes its section to be re-examined. These cover both directions of that:
// the dropped listing being the bargain, and the drop turning an existing
// listing into one.

test('a listing that arrives underpriced is flagged on the cycle it lands', () => {
  const before = [
    { section: '107', row: '1', rowRank: 0, price: 900 },
    { section: '107', row: '3', rowRank: 2, price: 800 },
    { section: '107', row: '4', rowRank: 3, price: 850 },
    { section: '107', row: '5', rowRank: 4, price: 820 },
  ];
  assert.deepEqual(findUnderpricedRows(stateWith(before), dirty('107')), []);

  // A drop lands in row 2, priced far under the rows behind it.
  const after = [...before, { section: '107', row: '2', rowRank: 1, price: 250, seatRange: '7-8' }];
  const found = findUnderpricedRows(stateWith(after), dirty('107'));

  assert.equal(found.length, 1);
  assert.equal(found[0].row, '2');
  assert.equal(found[0].seatRange, '7-8');
});

test('a drop can turn an existing listing into a bargain', () => {
  // Row 2 at $320 is unremarkable against rows averaging $450.
  const before = [
    { section: '107', row: '1', rowRank: 0, price: 900 },
    { section: '107', row: '2', rowRank: 1, price: 320 },
    { section: '107', row: '3', rowRank: 2, price: 450 },
    { section: '107', row: '4', rowRank: 3, price: 450 },
    { section: '107', row: '5', rowRank: 4, price: 450 },
  ];
  assert.deepEqual(findUnderpricedRows(stateWith(before), dirty('107')), []);

  // Seats drop into rows behind it at a much higher price, lifting the average
  // that row 2 is measured against. Row 2's own document never changed, which
  // is why a diff of changed rows alone would miss this.
  const after = [
    ...before,
    { section: '107', row: '6', rowRank: 5, price: 900 },
    { section: '107', row: '7', rowRank: 6, price: 900 },
  ];
  const found = findUnderpricedRows(stateWith(after), dirty('107'));

  const row2 = found.find(f => f.row === '2');
  assert.ok(row2, 'the untouched listing became a bargain once rows landed behind it');
  // Averaged over every row behind it, the two new ones included.
  assert.equal(row2.comparableCount, 5);
  assert.equal(row2.comparableAvg, (450 + 450 + 450 + 900 + 900) / 5);
});

// ── Outliers ────────────────────────────────────────────────────────────────
// One listing priced into orbit must not become everyone else's baseline.

test('an absurdly priced listing is left out of the averages', () => {
  const rows = [
    { section: '107', row: '1', rowRank: 0, price: 500 },
    { section: '107', row: '2', rowRank: 1, price: 450 },
    { section: '107', row: '3', rowRank: 2, price: 450 },
    { section: '107', row: '4', rowRank: 3, price: 450 },
    { section: '107', row: '5', rowRank: 4, price: 450 },
    { section: '107', row: '6', rowRank: 5, price: 9000 }, // far above the median
  ];

  // Counted in, the average behind row 1 would be $2,160 and every ordinary
  // listing in this section would read as a bargain. Trimmed, nothing fires.
  assert.deepEqual(findUnderpricedRows(stateWith(rows), dirty('107')), []);
});

test('a real bargain is still found, and priced against the trimmed average', () => {
  const found = findUnderpricedRows(
    stateWith([
      { section: '107', row: '1', rowRank: 0, price: 150 },  // the genuine bargain
      { section: '107', row: '2', rowRank: 1, price: 450 },
      { section: '107', row: '3', rowRank: 2, price: 450 },
      { section: '107', row: '4', rowRank: 3, price: 450 },
      { section: '107', row: '5', rowRank: 4, price: 450 },
      { section: '107', row: '6', rowRank: 5, price: 9000 },
    ]),
    dirty('107'),
  );

  assert.equal(found.length, 1);
  assert.equal(found[0].row, '1');
  // $450, not $2,160 — the outlier is excluded from the comparison entirely.
  assert.equal(found[0].comparableAvg, 450);
  assert.equal(found[0].comparableCount, 4);
});

test('an empty dirty set does no work', () => {
  assert.deepEqual(findUnderpricedRows(stateWith(NATURAL), new Set()), []);
});
