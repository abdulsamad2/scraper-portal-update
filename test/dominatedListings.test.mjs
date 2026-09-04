// Tests for the dominated-listings rule in lib/dominatedListings.
//
// These drive the real partitionDominated export rather than a copy of the
// walk, so a change to the rule is actually caught. The module is pure — no DB,
// no network — so it imports directly.
//
// Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  partitionDominated,
  dominatedBucketKey,
  dominatedUniverseKey,
  rowRankKind,
} from '../lib/dominatedListings.ts';
import { rowRankFromLabel } from '../lib/rowRank.js';

const BUCKET = dominatedBucketKey('evt-1', '423', 2, '2');

/** One listing, ranked exactly as the scraper ranks it. */
function listing(row, price, bucketKey = BUCKET) {
  return { row, price, bucketKey, rowRank: rowRankFromLabel(row) };
}

function run(items) {
  const { kept, dropped } = partitionDominated(items, (l) => ({
    bucketKey: l.bucketKey,
    rowRank: l.rowRank,
    rowLabel: l.row,
    perSeatPrice: l.price,
  }));
  return { kept: kept.map(l => l.row).sort(), dropped: dropped.map(l => l.row).sort() };
}

test('a lettered row cannot dominate a numbered one', () => {
  // Arizona Cardinals v Philadelphia Eagles, section 423, qty 2, split "2".
  // Row B is rank 2 on the letter scale and row 2 is rank 2 on the number
  // scale; judged together, B at $212.03 deleted the front of the numbers.
  const { kept, dropped } = run([
    listing('2', 242.32),
    listing('4', 248.38),
    listing('B', 212.03),
  ]);
  assert.deepEqual(kept, ['2', 'B']);
  assert.deepEqual(dropped, ['4']);
});

test('a numbered row cannot dominate a lettered one', () => {
  const { kept, dropped } = run([listing('1', 100), listing('Z', 150)]);
  assert.deepEqual(kept, ['1', 'Z']);
  assert.deepEqual(dropped, []);
});

test('letters are judged against letters', () => {
  const { kept, dropped } = run([listing('A', 200), listing('C', 250), listing('D', 150)]);
  assert.deepEqual(kept, ['A', 'D']);
  assert.deepEqual(dropped, ['C']);
});

test('numbers are judged against numbers', () => {
  const { kept, dropped } = run([listing('1', 700), listing('3', 650), listing('3', 780)]);
  assert.deepEqual(kept, ['1', '3']);
  assert.deepEqual(dropped, ['3']);
});

test('a label on no scale is never judged', () => {
  // A stale rank riding along on a label the ranker will not read — here one
  // that would otherwise lose to every other listing in the bucket.
  const items = [
    { row: 'AAAA', price: 900, bucketKey: BUCKET, rowRank: 1 },
    { row: '12A', price: 900, bucketKey: BUCKET, rowRank: 1 },
    { row: 'WC', price: 900, bucketKey: BUCKET, rowRank: 1 },
    { row: '', price: 900, bucketKey: BUCKET, rowRank: 1 },
    listing('1', 100),
  ];
  const { kept, dropped } = run(items);
  assert.deepEqual(kept, ['', '1', '12A', 'AAAA', 'WC']);
  assert.deepEqual(dropped, []);
});

test('listings with no rowRank pass through', () => {
  const { kept, dropped } = run([
    { row: 'GA', price: 900, bucketKey: BUCKET, rowRank: null },
    listing('1', 100),
  ]);
  assert.deepEqual(kept, ['1', 'GA']);
  assert.deepEqual(dropped, []);
});

test('different buckets never meet, same scale or not', () => {
  const other = dominatedBucketKey('evt-1', '423', 4, '2');
  const { kept, dropped } = run([listing('1', 100), listing('5', 200, other)]);
  assert.deepEqual(kept, ['1', '5']);
  assert.deepEqual(dropped, []);
});

test('doubled letters are judged against doubled letters', () => {
  const { kept, dropped } = run([listing('AA', 190), listing('BB', 220), listing('CC', 150)]);
  assert.deepEqual(kept, ['AA', 'CC']);
  assert.deepEqual(dropped, ['BB']);
});

test('three-letter rows are their own universe too', () => {
  const { kept, dropped } = run([listing('AAA', 210), listing('BBB', 260)]);
  assert.deepEqual(kept, ['AAA']);
  assert.deepEqual(dropped, ['BBB']);
});

test('a seat-type code is never judged against a row', () => {
  // Atlanta Hawks v Lakers, section FLOOR8, as it shipped. Ranking CRT
  // (courtside) as a row put it 1,813 places behind AAA, so the walk reached it
  // last and deleted it as "dominated" by a $2,042 listing. Off the scale it is
  // kept untouched, and the two real rows are left as they were: price already
  // falls as the rows get worse, so neither dominates the other.
  const { kept, dropped } = run([
    listing('AAA', 2264), listing('BBB', 2042), listing('CRT', 2532),
  ]);
  assert.deepEqual(kept, ['AAA', 'BBB', 'CRT']);
  assert.deepEqual(dropped, []);
});

test('all four shapes in one section keep the front of each', () => {
  // Section 218, qty 2, split "2": row A is the cheapest listing in the bucket
  // and still cannot touch row 3, row AA or row AAA.
  const { kept, dropped } = run([
    listing('3', 220),
    listing('A', 180),
    listing('B', 250),
    listing('AA', 190),
    listing('BB', 220),
    listing('AAA', 210),
  ]);
  assert.deepEqual(kept, ['3', 'A', 'AA', 'AAA']);
  assert.deepEqual(dropped, ['B', 'BB']);
});

test('rowRankKind reads the four scales the scraper ranks', () => {
  assert.equal(rowRankKind('1'), 'numeric');
  assert.equal(rowRankKind('10000'), 'numeric');
  assert.equal(rowRankKind(' 7 '), 'numeric');
  assert.equal(rowRankKind('0'), null);
  assert.equal(rowRankKind('10001'), null);
  assert.equal(rowRankKind('A'), 'letter');
  assert.equal(rowRankKind('z'), 'letter');
  assert.equal(rowRankKind('AA'), 'letter2');
  assert.equal(rowRankKind('zz'), 'letter2');
  assert.equal(rowRankKind('AAA'), 'letter3');
  assert.equal(rowRankKind('AAAA'), null);
  assert.equal(rowRankKind('12A'), null);
  assert.equal(rowRankKind(''), null);
  assert.equal(rowRankKind(null), null);
  assert.equal(rowRankKind(undefined), null);
});

test('codes shaped like rows but not rows are on no scale', () => {
  // The first nine were named on the old denylist; the rest are the codes it
  // missed, read off 1,090,781 production listings. A mixed pair or triple is
  // always a code — access, standing, table, railing, bar, courtside — because
  // these venues label multi-letter rows by repeating one letter.
  const codes = [
    'GA', 'WC', 'WCA', 'ADA', 'SRO', 'BOX', 'PIT', 'VIP', 'TBL', 'ga', 'wc',
    'MW', 'VW', 'LR', 'RL', 'RW', 'BX',
    'JJW', 'RAL', 'BAR', 'CRT', 'EDG', 'ONE', 'TWO', 'crt',
  ];
  for (const code of codes) {
    assert.equal(rowRankKind(code), null, `${code} is not a row`);
    assert.equal(rowRankFromLabel(code), null, `${code} carries no rank`);
  }
});

test('repeated letters are rows, in either case', () => {
  for (const row of ['AA', 'BB', 'UU', 'ZZ', 'aa', 'zz']) {
    assert.equal(rowRankKind(row), 'letter2', `${row} is a two-letter row`);
  }
  for (const row of ['AAA', 'BBB', 'YYY', 'ZZZ', 'aaa']) {
    assert.equal(rowRankKind(row), 'letter3', `${row} is a three-letter row`);
  }
});

test('the portal reads the same ranks the scraper writes', () => {
  const expected = [
    ['1', 1], ['10000', 10000], ['A', 1], ['Z', 26],
    ['AA', 1], ['BB', 28], ['ZZ', 676],
    ['AAA', 1], ['BBB', 704], ['ZZZ', 17576],
    // Ranks stay base 26 so freshly scraped rows sit on the same scale as
    // everything already stored; only which labels rank at all has changed.
    ['AB', null], ['BA', null], ['ABA', null], ['AAB', null],
    ['AAAA', null], ['12A', null], ['', null],
  ];
  for (const [label, rank] of expected) {
    assert.equal(rowRankFromLabel(label), rank, `rank of ${JSON.stringify(label)}`);
  }
});

test('the universe key separates the scales and keeps the bucket', () => {
  const keys = ['2', 'B', 'BB', 'BBB'].map(r => dominatedUniverseKey(BUCKET, r));
  assert.equal(new Set(keys).size, 4, 'all four are rank 2 and none may share a universe');
  assert.equal(dominatedUniverseKey(BUCKET, '2'), dominatedUniverseKey(BUCKET, '9'));
  assert.equal(dominatedUniverseKey(BUCKET, 'AAAA'), null);
  assert.equal(dominatedUniverseKey(BUCKET, 'GA'), null);
});
