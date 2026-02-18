// Test: CSV price adjustment logic
// Formula: adjustedPrice = listPrice * (1 + (defaultPct + adj) / 100) / (1 + defaultPct / 100)

function applyAdj(listPrice, defaultPct, adj) {
  if (defaultPct === 0 && adj === 0) return listPrice;
  return listPrice * (1 + (defaultPct + adj) / 100) / (1 + defaultPct / 100);
}

function fmt(n) { return Number(n.toFixed(2)); }

const cases = [
  // [description, originalCost, defaultPct, adj, expectedEffectivePct]
  { desc: 'Default 10%, Standard -5%  → effective +5%',   cost: 100, defaultPct: 10, adj: -5 },
  { desc: 'Default 10%, Resale +20%   → effective +30%',  cost: 100, defaultPct: 10, adj: 20 },
  { desc: 'Default 25%, adj 0         → no change',       cost: 100, defaultPct: 25, adj:  0 },
  { desc: 'Default 25%, Standard -25% → effective 0%',    cost: 100, defaultPct: 25, adj: -25 },
  { desc: 'Default 0%,  adj 15%       → effective +15%',  cost: 100, defaultPct:  0, adj: 15 },
  { desc: 'Default 10%, adj 0 (non-round cost)',           cost:  87.50, defaultPct: 10, adj: 0 },
  { desc: 'Default 10%, Standard -5% (non-round cost)',    cost:  87.50, defaultPct: 10, adj: -5 },
];

console.log('\n─── CSV Price Adjustment Logic Test ───\n');

let pass = 0, fail = 0;

for (const c of cases) {
  // listPrice = originalCost * (1 + defaultPct/100)  ← scraper already applied default
  const listPrice = c.cost * (1 + c.defaultPct / 100);
  const adjusted  = applyAdj(listPrice, c.defaultPct, c.adj);
  const effectivePct = ((adjusted / c.cost) - 1) * 100;

  // Expected: cost * (1 + (defaultPct + adj) / 100)
  const expected = c.cost * (1 + (c.defaultPct + c.adj) / 100);
  const ok = Math.abs(adjusted - expected) < 0.0001;

  const status = ok ? '✅ PASS' : '❌ FAIL';
  if (ok) pass++; else fail++;

  console.log(`${status}  ${c.desc}`);
  console.log(`        cost=${c.cost}  scraper listPrice=${fmt(listPrice)}  adj=${c.adj >= 0 ? '+' : ''}${c.adj}%`);
  console.log(`        CSV list_price=${fmt(adjusted)}  effective markup=${fmt(effectivePct)}%  expected=${fmt(expected)}\n`);
}

console.log(`─── Results: ${pass} passed, ${fail} failed ───\n`);
