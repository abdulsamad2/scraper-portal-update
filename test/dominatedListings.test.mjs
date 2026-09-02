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

const BUCKET = dominatedBucketKey('evt-1', '423', 2, '2');

/** One listing, ranked the way the scraper ranks it: the number, or A=1..Z=26. */
function listing(row, price, bucketKey = BUCKET) {
  const kind = rowRankKind(row);
  const rank = kind === 'numeric'
    ? Number(row.trim())
    : kind === 'letter'
      ? row.trim().toUpperCase().charCodeAt(0) - 64
      : null;
  return { row, price, bucketKey, rowRank: rank };
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

test('a label on neither scale is never judged', () => {
  // AA sits ahead of A in some venues and behind Z in others, so it is kept
  // whatever rank rides along with it — here a rank that would otherwise lose
  // to every other listing in the bucket.
  const items = [
    { row: 'AA', price: 900, bucketKey: BUCKET, rowRank: 1 },
    { row: '12A', price: 900, bucketKey: BUCKET, rowRank: 1 },
    { row: '', price: 900, bucketKey: BUCKET, rowRank: 1 },
    listing('1', 100),
  ];
  const { kept, dropped } = run(items);
  assert.deepEqual(kept, ['', '1', '12A', 'AA']);
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

test('rowRankKind reads the two scales the scraper ranks', () => {
  assert.equal(rowRankKind('1'), 'numeric');
  assert.equal(rowRankKind('10000'), 'numeric');
  assert.equal(rowRankKind(' 7 '), 'numeric');
  assert.equal(rowRankKind('0'), null);
  assert.equal(rowRankKind('10001'), null);
  assert.equal(rowRankKind('A'), 'letter');
  assert.equal(rowRankKind('z'), 'letter');
  assert.equal(rowRankKind('AA'), null);
  assert.equal(rowRankKind('12A'), null);
  assert.equal(rowRankKind(''), null);
  assert.equal(rowRankKind(null), null);
  assert.equal(rowRankKind(undefined), null);
});

test('the universe key separates the scales and keeps the bucket', () => {
  assert.notEqual(dominatedUniverseKey(BUCKET, '2'), dominatedUniverseKey(BUCKET, 'B'));
  assert.equal(dominatedUniverseKey(BUCKET, '2'), dominatedUniverseKey(BUCKET, '9'));
  assert.equal(dominatedUniverseKey(BUCKET, 'AA'), null);
});
