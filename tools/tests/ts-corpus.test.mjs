// thinkScript study corpus: 24 studies on fixed Sample data, checked bar by bar against plain reference formulas
// written separately below (simple loops, no shared code with the engine), to 1e-6.
//   node tools/tests/ts-corpus.test.mjs
import { execute } from '../../assets/ts/compiler.js';
import { t, done, makeBars, near, assert } from './ts-helpers.mjs';

const B = makeBars(1500, 11);
const N = B.time.length, TOL = 1e-6;
const nan = () => new Array(N).fill(NaN);
const run = (src, opts) => {
  const o = execute(src, Object.assign({ bars: B, tfMs: 3e5, symbol: 'SAMPLE' }, opts || {}));
  assert.ok(o.ok, 'did not run: ' + JSON.stringify(o.error));
  return o;
};
const plot = (src, i, opts) => Array.from(run(src, opts).plots[i || 0].values);

// ---------- reference formulas ----------
const C = B.close, H = B.high, L = B.low, V = B.volume;
function sma(x, n) { const o = nan(); for (let i = n - 1; i < N; i++) { let s = 0; for (let k = i - n + 1; k <= i; k++) s += x[k]; o[i] = s / n; } return o; }
function ema(x, n) { const o = nan(), a = 2 / (n + 1); let p = NaN; for (let i = 0; i < N; i++) { if (!Number.isFinite(x[i])) { o[i] = NaN; continue; } p = Number.isFinite(p) ? p + a * (x[i] - p) : x[i]; o[i] = p; } return o; }
function wilders(x, n) {
  const o = nan(); let p = NaN;
  for (let i = 0; i < N; i++) {
    if (!Number.isFinite(x[i])) { p = NaN; continue; }
    if (Number.isFinite(p)) p = p + (x[i] - p) / n;
    else { if (i < n - 1) continue; let s = 0, ok = true; for (let k = i - n + 1; k <= i; k++) { if (!Number.isFinite(x[k])) ok = false; s += x[k]; } p = ok ? s / n : NaN; }
    o[i] = p;
  }
  return o;
}
function wma(x, n) { const o = nan(); for (let i = n - 1; i < N; i++) { let s = 0, w = 0; for (let k = 0; k < n; k++) { s += x[i - k] * (n - k); w += n - k; } o[i] = s / w; } return o; }
function highest(x, n) { const o = nan(); for (let i = n - 1; i < N; i++) { let m = -Infinity; for (let k = i - n + 1; k <= i; k++) m = Math.max(m, x[k]); o[i] = m; } return o; }
function lowest(x, n) { const o = nan(); for (let i = n - 1; i < N; i++) { let m = Infinity; for (let k = i - n + 1; k <= i; k++) m = Math.min(m, x[k]); o[i] = m; } return o; }
function sum(x, n) { const o = nan(); for (let i = n - 1; i < N; i++) { let s = 0; for (let k = i - n + 1; k <= i; k++) s += x[k]; o[i] = s; } return o; }
function stdev(x, n) { const m = sma(x, n), o = nan(); for (let i = n - 1; i < N; i++) { let s = 0; for (let k = i - n + 1; k <= i; k++) s += (x[k] - m[i]) ** 2; o[i] = Math.sqrt(s / n); } return o; }
const tr = () => C.map((_, i) => (i ? Math.max(H[i], C[i - 1]) - Math.min(L[i], C[i - 1]) : H[i] - L[i]));
const lag = (x, k) => x.map((_, i) => (i - k >= 0 && i - k < N ? x[i - k] : NaN));
const zip = (a, b, f) => a.map((v, i) => f(v, b[i], i));

function rsiRef(n) {
  const ch = C.map((c, i) => (i ? c - C[i - 1] : NaN));
  const up = wilders(ch.map((d) => (Number.isFinite(d) ? Math.max(d, 0) : NaN)), n), dn = wilders(ch.map((d) => (Number.isFinite(d) ? Math.max(-d, 0) : NaN)), n);
  return zip(up, dn, (u, d) => (!Number.isFinite(u) ? NaN : u + d === 0 ? 50 : 100 * u / (u + d)));
}
function dmiRef(n) {
  const pdm = C.map((_, i) => { if (!i) return 0; const u = H[i] - H[i - 1], d = L[i - 1] - L[i]; return u > d && u > 0 ? u : 0; });
  const mdm = C.map((_, i) => { if (!i) return 0; const u = H[i] - H[i - 1], d = L[i - 1] - L[i]; return d > u && d > 0 ? d : 0; });
  const atr = wilders(tr(), n), ps = wilders(pdm, n), ms = wilders(mdm, n);
  const dip = atr.map((a, i) => (!Number.isFinite(a) ? NaN : a === 0 ? 0 : 100 * ps[i] / a)), dim = atr.map((a, i) => (!Number.isFinite(a) ? NaN : a === 0 ? 0 : 100 * ms[i] / a));
  const dx = dip.map((p, i) => (!Number.isFinite(p) ? NaN : p + dim[i] > 0 ? 100 * Math.abs(p - dim[i]) / (p + dim[i]) : 0));
  return { dip, dim, adx: wilders(dx, n) };
}
function vwapRef() {
  // sessions = New York calendar days (the sample data is continuous 5-minute bars)
  const day = (ms) => new Date(ms - 5 * 36e5).toISOString().slice(0, 10);   // January: New York = UTC-5
  const o = nan(); let pv = 0, vv = 0, d = null;
  for (let i = 0; i < N; i++) { const k = day(B.time[i]), tp = (H[i] + L[i] + C[i]) / 3; if (k !== d) { d = k; pv = 0; vv = 0; } pv += tp * V[i]; vv += V[i]; o[i] = pv / vv; }
  return o;
}

// ---------- the corpus ----------
t('01 Average', () => near(plot('plot a = Average(close, 20);'), sma(C, 20), TOL, 'Average'));
t('02 SimpleMovingAvg study', () => near(plot('plot a = SimpleMovingAvg(close, 15);'), sma(C, 15), TOL, 'SimpleMovingAvg'));
t('03 ExpAverage', () => near(plot('plot a = ExpAverage(close, 12);'), ema(C, 12), TOL, 'ExpAverage'));
t('04 WMA', () => near(plot('plot a = WMA(close, 10);'), wma(C, 10), TOL, 'WMA'));
t('05 WildersAverage', () => near(plot('plot a = WildersAverage(close, 14);'), wilders(C, 14), TOL, 'Wilders'));
t('06 MovingAverage(AverageType.EXPONENTIAL, hl2)', () => near(plot('plot a = MovingAverage(AverageType.EXPONENTIAL, hl2, 9);'), ema(zip(H, L, (h, l) => (h + l) / 2), 9), TOL, 'MA EXP'));
t('07 RSI', () => near(plot('declare lower; plot r = RSI(14);'), rsiRef(14), TOL, 'RSI'));
t('08 RSI length input', () => near(plot('input n = 7; plot r = RSI(length = n);'), rsiRef(7), TOL, 'RSI 7'));
t('09 MACD Value / Avg / Diff', () => {
  const v = zip(ema(C, 12), ema(C, 26), (a, b) => a - b), s = ema(v, 9);
  near(plot('plot a = MACD().Value;'), v, TOL, 'MACD value');
  near(plot('plot a = MACD().Avg;'), s, TOL, 'MACD avg');
  near(plot('plot a = MACD(12, 26, 9).Diff;'), zip(v, s, (a, b) => a - b), TOL, 'MACD diff');
});
t('10 BollingerBands', () => {
  const m = sma(C, 20), d = stdev(C, 20);
  near(plot('plot u = BollingerBands().UpperBand;'), zip(m, d, (a, b) => a + 2 * b), TOL, 'BB upper');
  near(plot('plot u = BollingerBands().LowerBand;'), zip(m, d, (a, b) => a - 2 * b), TOL, 'BB lower');
  near(plot('plot u = BollingerBands(length = 10, Num_Dev_up = 1.5).UpperBand;'), zip(sma(C, 10), stdev(C, 10), (a, b) => a + 1.5 * b), TOL, 'BB inputs');
});
t('11 StDev', () => near(plot('plot s = StDev(close, 30);'), stdev(C, 30), TOL, 'StDev'));
t('12 TrueRange + ATR', () => {
  near(plot('plot a = TrueRange(high, close, low);'), tr(), TOL, 'TR');
  near(plot('plot a = ATR(14);'), wilders(tr(), 14), TOL, 'ATR');
});
t('13 StochasticFull', () => {
  const lo = lowest(L, 10), hi = highest(H, 10);
  const fk = C.map((c, i) => (!Number.isFinite(lo[i]) ? NaN : hi[i] - lo[i] === 0 ? 0 : (c - lo[i]) / (hi[i] - lo[i]) * 100));
  const k = sma(fk, 3), d = sma(k, 10);
  near(plot('plot k = StochasticFull().FullK;'), k, TOL, 'FullK');
  near(plot('plot d = StochasticFull().FullD;'), d, TOL, 'FullD');
});
t('14 ADX / DMI', () => {
  const r = dmiRef(14);
  near(plot('plot a = ADX(14);'), r.adx, TOL, 'ADX');
  near(plot('plot a = DMI(14)."DI+";'), r.dip, TOL, 'DI+');
  near(plot('plot a = DMI(14)."DI-";'), r.dim, TOL, 'DI-');
});
t('15 VWAP', () => near(plot('plot v = VWAP();'), vwapRef(), TOL, 'VWAP'));
t('16 Highest / Lowest', () => { near(plot('plot h = Highest(high, 25);'), highest(H, 25), TOL, 'Highest'); near(plot('plot l = Lowest(low, 25);'), lowest(L, 25), TOL, 'Lowest'); });
t('17 Sum', () => near(plot('plot s = Sum(volume, 10);'), sum(V, 10), TOL, 'Sum'));
t('18 Momentum + RateOfChange', () => {
  near(plot('plot m = Momentum(length = 10);'), zip(C, lag(C, 10), (a, b) => a - b), TOL, 'Momentum');
  near(plot('plot r = RateOfChange(length = 14);'), zip(C, lag(C, 14), (a, b) => (a / b - 1) * 100), TOL, 'ROC');
});
t('19 CCI', () => {
  const tp = C.map((c, i) => (H[i] + L[i] + c) / 3), m = sma(tp, 14), o = nan();
  for (let i = 13; i < N; i++) { let s = 0; for (let k = i - 13; k <= i; k++) s += Math.abs(tp[k] - m[i]); const d = s / 14; o[i] = d === 0 ? 0 : (tp[i] - m[i]) / d / 0.015; }
  near(plot('plot c = CCI(14);'), o, TOL, 'CCI');
});
t('20 Ichimoku Tenkan / Kijun', () => {
  const mid = (n) => zip(highest(H, n), lowest(L, n), (a, b) => (a + b) / 2);
  near(plot('plot t = Ichimoku().Tenkan;'), mid(9), TOL, 'Tenkan');
  near(plot('plot k = Ichimoku().Kijun;'), mid(26), TOL, 'Kijun');
});
t('21 recursion: running count with rec and [1]', () => {
  const up = C.map((c, i) => (i && c > C[i - 1] ? 1 : 0)), o = []; let s = 0; for (let i = 0; i < N; i++) { s += up[i]; o.push(s); }
  near(plot('rec n = n[1] + (if close > close[1] then 1 else 0);\nplot p = n;'), o, TOL, 'rec count');
});
t('22 CompoundValue seeded EMA by hand', () => {
  const o = []; let p = NaN; for (let i = 0; i < N; i++) { p = i < 1 ? C[i] : p + 0.2 * (C[i] - p); o.push(p); }
  near(plot('def e = CompoundValue(1, e[1] + 0.2 * (close - e[1]), close);\nplot p = e;'), o, TOL, 'CompoundValue');
});
t('23 fold: 5-bar sum', () => near(plot('plot s = fold i = 0 to 5 with acc do acc + GetValue(close, i);'), sum(C, 5), TOL, 'fold'));
t('24 crosses above/below vs reference', () => {
  const f = ema(C, 9), s = ema(C, 21);
  const want = f.map((v, i) => (i && f[i - 1] <= s[i - 1] && v > s[i] ? 1 : 0));
  const got = plot('def f = ExpAverage(close, 9); def s = ExpAverage(close, 21);\nplot x = f crosses above s;');
  near(got, want, TOL, 'crosses');
  assert.ok(want.some((x) => x === 1), 'the sample has crosses');
});
t('25 switch / enum input', () => {
  const src = 'input mode = {default fast, slow};\ndef len;\nswitch (mode) {\ncase fast:\n  len = 5;\ncase slow:\n  len = 50;\n}\nplot a = Average(close, len);';
  near(plot(src), sma(C, 5), TOL, 'switch fast');
  near(plot(src, 0, { inputs: { 0: 'slow' } }), sma(C, 50), TOL, 'switch slow (input changed)');
});
t('26 user script{} with two plots', () => {
  const src = 'script Band { input len = 10; plot Up = Average(high, len); plot Dn = Average(low, len); }\nplot u = Band(12).Up;\nplot d = Band(len = 12).Dn;';
  const o = run(src);
  near(Array.from(o.plots[0].values), sma(H, 12), TOL, 'script Up');
  near(Array.from(o.plots[1].values), sma(L, 12), TOL, 'script Dn');
});
t('27 if/then/else block', () => {
  const src = 'def x;\nif close > open {\n  x = high;\n} else {\n  x = low;\n}\nplot p = x;';
  near(plot(src), C.map((c, i) => (c > B.open[i] ? H[i] : L[i])), TOL, 'if block');
});
done('ts-corpus');
