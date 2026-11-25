// node tools/tests/dxy.test.mjs — calculated US Dollar Index: formula fixture, bar alignment, search, symbol mapping.
import assert from 'node:assert/strict';
import { dxy, combine, PAIRS } from '../../assets/chart-dxy-core.js';
import { search } from '../../assets/chart-search-core.js';
import { normalizeSymbol } from '../../assets/chart-watchlist.js';

// FIXTURE: daily closes of the six pairs and the official index close on the same dates (checked 25 Nov 2026).
// Tolerance 0.05 % (the pairs' daily closes are cut at slightly different times than the index's).
const FIX = [
  { d: '2026-10-30', official: 101.88, r: { EURUSD: 1.1182805299758911, USDJPY: 157.8040008544922, GBPUSD: 1.3378641605377197, USDCAD: 1.3986400365829468, USDSEK: 9.844149589538574, USDCHF: 0.8236100077629089 } },
  { d: '2026-09-10', official: 99.09, r: { EURUSD: 1.1609952449798584, USDJPY: 154.48199462890625, GBPUSD: 1.3509314060211182, USDCAD: 1.3835300207138062, USDSEK: 9.685759544372559, USDCHF: 0.8132200241088867 } },
  { d: '2025-03-31', official: 104.21, r: { EURUSD: 1.0818880796432495, USDJPY: 149.91299438476562, GBPUSD: 1.292089819908142, USDCAD: 1.4390699863433838, USDSEK: 10.039979934692383, USDCHF: 0.8838199973106384 } }
];
for (const f of FIX) {
  const err = Math.abs(dxy(f.r) / f.official - 1) * 100;
  assert.ok(err < 0.05, f.d + ' off by ' + err.toFixed(4) + ' %');
}
// all six pairs at 1 -> the constant; a missing / zero pair -> NaN (never a guess)
assert.equal(dxy(Object.fromEntries(PAIRS.map((p) => [p, 1]))), 50.14348112);
assert.ok(Number.isNaN(dxy({ EURUSD: 1.1, USDJPY: 150, GBPUSD: 1.3, USDCAD: 1.4, USDSEK: 10 })));
// a stronger euro lowers the index, a stronger yen-per-dollar lifts it
const base = FIX[0].r;
assert.ok(dxy({ ...base, EURUSD: base.EURUSD * 1.01 }) < dxy(base));
assert.ok(dxy({ ...base, USDJPY: base.USDJPY * 1.01 }) > dxy(base));

// bar alignment: USDSEK has no bar at t=120 -> that timestamp is skipped, the others stay
const bar = (t, v) => ({ time: t, open: v, high: v * 1.001, low: v * 0.999, close: v, volume: 0 });
const mk = (skip) => { const s = {}; for (const p of PAIRS) s[p] = [0, 60, 120, 180].filter((t) => !(p === 'USDSEK' && t === skip)).map((t) => bar(t, base[p])); return s; };
assert.deepEqual(combine(mk(120)).map((b) => b.time), [0, 60, 180]);
assert.deepEqual(combine(mk(-1)).map((b) => b.time), [0, 60, 120, 180]);
const b0 = combine(mk(-1))[0];
assert.ok(Math.abs(b0.close - dxy(base)) < 1e-9 && b0.high >= Math.max(b0.open, b0.close) && b0.low <= Math.min(b0.open, b0.close) && b0.volume === 0);
assert.deepEqual(combine({}), []);

// search: DXY, USDX, DX, "dollar index" all find the row, and it ranks first
const P = [
  { ticker: 'DXY', description: 'US Dollar Index (calculated from 6 FX rates)', type: 'index', provider: 'dxy', prefix: 'DXY', aliases: ['USDX', 'DX', 'DOLLAR INDEX'] },
  { ticker: 'EURUSD', description: 'Euro / U.S. Dollar', type: 'forex', provider: 'fx', prefix: 'FX' },
  { ticker: 'USDJPY', description: 'U.S. Dollar / Japanese Yen', type: 'forex', provider: 'fx', prefix: 'FX' },
  { ticker: 'DIA', description: 'SPDR Dow Jones ETF', type: 'etf', provider: 'idx', prefix: 'IDX' },
  { ticker: 'DX', description: 'DX decoy', type: 'stock', provider: 'stocks' }
];
for (const q of ['DXY', 'dxy', 'USDX', 'dollar index']) assert.equal(search(P, q)[0].d.ticker, 'DXY', q);
assert.ok(search(P, 'DX').some((x) => x.d.ticker === 'DXY'));
assert.ok(search(P, 'US DOLLAR INDEX').some((x) => x.d.ticker === 'DXY'));

// symbol mapping (watchlist, deep link ?symbol=)
for (const s of ['DXY', 'dxy:DXY', 'TVC:DXY', 'USDX', 'DX']) assert.equal(normalizeSymbol(s, null), 'dxy:DXY', s);
assert.equal(normalizeSymbol('EURUSD', null), 'fx:EURUSD');
console.log('dxy.test: ok');
