// TradeZoro — calculated US Dollar Index (pure maths, no DOM). Used by assets/chart-dxy.js and tools/tests/dxy.test.mjs.
// Formula (the published trade-weighted basket):
//   50.14348112 x EURUSD^-0.576 x USDJPY^0.136 x GBPUSD^-0.119 x USDCAD^0.091 x USDSEK^0.042 x USDCHF^0.036
// Bars: the six pairs' bars are aligned on timestamp. A timestamp where ANY pair has no bar is skipped (never filled, never
// re-weighted). Open and close are exact (the formula on each pair's open / close). High and low are APPROXIMATIONS: the
// formula on the pairs' extremes that push the index highest (EUR and GBP at their low, the other four at their high) or
// lowest, which is a bound the true index extreme cannot pass; the pairs do not all peak in the same second.
// Volume is 0. Education only. Not financial advice.

export const CONST = 50.14348112;
// pair -> exponent. A negative exponent = the pair is quoted "foreign per USD inverted" (EURUSD, GBPUSD): a rising pair lowers the index.
export const WEIGHTS = { EURUSD: -0.576, USDJPY: 0.136, GBPUSD: -0.119, USDCAD: 0.091, USDSEK: 0.042, USDCHF: 0.036 };
export const PAIRS = Object.keys(WEIGHTS);

export function dxy(r) {
  let v = CONST;
  for (const p of PAIRS) { const x = r[p]; if (!(x > 0) || !Number.isFinite(x)) return NaN; v *= Math.pow(x, WEIGHTS[p]); }
  return v;
}

// series: { EURUSD: [{time, open, high, low, close}], ... } sorted by time. Returns DXY bars sorted by time.
export function combine(series) {
  const maps = PAIRS.map((p) => { const m = new Map(); for (const b of series[p] || []) m.set(b.time, b); return m; });
  const first = maps.reduce((a, m) => (m.size < a.size ? m : a), maps[0]);
  const times = []; for (const t of first.keys()) if (maps.every((m) => m.has(t))) times.push(t);
  times.sort((a, b) => a - b);
  const out = [];
  for (const t of times) {
    const at = (f) => { const r = {}; PAIRS.forEach((p, i) => { r[p] = f(maps[i].get(t), WEIGHTS[p]); }); return dxy(r); };
    const o = at((b) => b.open), c = at((b) => b.close);
    const h = at((b, w) => (w < 0 ? b.low : b.high)), l = at((b, w) => (w < 0 ? b.high : b.low));
    if (![o, h, l, c].every(Number.isFinite)) continue;
    out.push({ time: t, open: o, high: Math.max(o, c, h), low: Math.min(o, c, l), close: c, volume: 0 });
  }
  return out;
}

// Search aliases: what a member may type for the symbol.
export const ALIASES = ['DXY', 'USDX', 'DX', 'DX1!', 'DOLLAR INDEX', 'US DOLLAR INDEX', 'DOLLAR'];
export const DESCRIPTION = 'US Dollar Index (calculated from 6 FX rates)';
export const INFO_LINE = 'US Dollar Index, calculated by TradeZoro from six FX rates (EUR, JPY, GBP, CAD, SEK, CHF) with the published weights. It tracks the dollar index closely but is not the official figure; highs and lows are approximate.';
