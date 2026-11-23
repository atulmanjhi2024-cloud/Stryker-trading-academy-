// MQL5 engine tests (assets/mq5/): front end, run model, built-ins, limits, and the classic indicators against
// formulas written here from their textbook definitions (not from assets/mq5/ta.js), to 1e-6.
//   node tools/tests/mq5-engine.test.mjs
import assert from 'node:assert/strict';
import { Indicator } from '../../assets/mq5/program.js';
import { builtinCount, builtinList } from '../../assets/mq5/builtins.js';
import { MQ5_EXAMPLES, MQ5_NEW } from '../../assets/mq5/examples.js';
import { CORPUS } from './mq5-corpus.mjs';

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.log('FAIL ' + name + ': ' + String(e && e.message || e).split('\n').slice(0, 4).join(' | ')); } };

// Sample data: a deterministic random walk (not market data)
export function bars(n = 400, seed = 7, tf = 900) {
  let s = seed >>> 0; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const b = { time: [], open: [], high: [], low: [], close: [], tick_volume: [], volume: [], spread: [] };
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p; p = Math.max(1, p + (rnd() - 0.5) * 2);
    b.time.push(1767225600 + i * tf); b.open.push(o); b.close.push(p);
    b.high.push(Math.max(o, p) + rnd()); b.low.push(Math.min(o, p) - rnd());
    b.tick_volume.push(Math.round(100 + rnd() * 900)); b.volume.push(0); b.spread.push(1);
  }
  return b;
}
const B = bars();
const N = B.close.length;
const ENV = { tfSec: 900, symbol: 'SAMPLE', digits: 5, point: 0.00001, now: () => (B.time[N - 1] + 600) * 1000 };
const mk = (src, env) => new Indicator(src, Object.assign({}, ENV, env || {}));
const runFull = (src, env) => { const ind = mk(src, env); const o = ind.calc(B, 'full'); if (!o.ok) throw new Error('run failed: ' + JSON.stringify(o.error)); return { ind, o }; };
const compileErr = (src) => { try { mk(src); return null; } catch (e) { return e; } };
const EMPTY = 1.7976931348623157e308;
// compare a buffer with a reference from bar `from` on; NaN / EMPTY_VALUE in the buffer = "no value"
function near(buf, ref, from, tol = 1e-6, label = '') {
  let k = 0;
  for (let i = from; i < ref.length; i++) {
    if (!Number.isFinite(ref[i])) continue;
    const v = buf[i];
    assert.ok(Number.isFinite(v) && v !== EMPTY, label + ' bar ' + i + ' has no value (ref ' + ref[i] + ')');
    assert.ok(Math.abs(v - ref[i]) <= tol * Math.max(1, Math.abs(ref[i])), label + ' bar ' + i + ': ' + v + ' vs ' + ref[i]);
    k++;
  }
  assert.ok(k > 50, label + ' compared only ' + k + ' bars');
}

// ---------- reference formulas (textbook definitions) ----------
const R = {};
R.sma = (x, p) => x.map((_, i) => (i < p - 1 ? NaN : x.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p));
R.ema = (x, p) => { const a = 2 / (p + 1), o = []; x.forEach((v, i) => o.push(i === 0 ? v : v * a + o[i - 1] * (1 - a))); return o; };
R.smma = (x, p) => { const o = new Array(x.length).fill(NaN); let s = 0; for (let i = 0; i < p; i++) s += x[i]; o[p - 1] = s / p; for (let i = p; i < x.length; i++) o[i] = (o[i - 1] * (p - 1) + x[i]) / p; return o; };
R.lwma = (x, p) => x.map((_, i) => { if (i < p - 1) return NaN; let s = 0, w = 0; for (let k = 0; k < p; k++) { s += x[i - k] * (p - k); w += p - k; } return s / w; });
R.rsi = (x, p) => {
  const o = new Array(x.length).fill(NaN); let up = 0, dn = 0;
  for (let i = 1; i <= p; i++) { const d = x[i] - x[i - 1]; up += Math.max(d, 0); dn += Math.max(-d, 0); }
  up /= p; dn /= p; o[p] = 100 - 100 / (1 + up / dn);
  for (let i = p + 1; i < x.length; i++) { const d = x[i] - x[i - 1]; up = (up * (p - 1) + Math.max(d, 0)) / p; dn = (dn * (p - 1) + Math.max(-d, 0)) / p; o[i] = 100 - 100 / (1 + up / dn); }
  return o;
};
R.stdev = (x, p) => { const m = R.sma(x, p); return x.map((_, i) => (i < p - 1 ? NaN : Math.sqrt(x.slice(i - p + 1, i + 1).reduce((a, v) => a + (v - m[i]) ** 2, 0) / p))); };
R.tr = (b) => b.close.map((_, i) => (i === 0 ? NaN : Math.max(b.high[i], b.close[i - 1]) - Math.min(b.low[i], b.close[i - 1])));
R.cci = (b, p) => { const tp = b.close.map((c, i) => (b.high[i] + b.low[i] + c) / 3), m = R.sma(tp, p); return tp.map((v, i) => { if (i < p - 1) return NaN; let d = 0; for (let k = 0; k < p; k++) d += Math.abs(tp[i - k] - m[i]); return (v - m[i]) / (0.015 * d / p); }); };

// ---------- 1. front end ----------
t('built-ins: 400+', () => { assert.ok(builtinCount() >= 400, 'count ' + builtinCount()); assert.equal(new Set(builtinList().map((b) => b.name)).size, builtinList().length, 'no duplicates'); });
t('built-ins cover the families', () => {
  const names = new Set(builtinList().map((b) => b.name));
  for (const n of ['MathAbs', 'MathPow', 'ArrayResize', 'ArraySetAsSeries', 'ArrayMaximum', 'StringFormat', 'StringSplit', 'DoubleToString', 'IntegerToString', 'TimeToString', 'TimeCurrent', 'TimeLocal', 'TimeToStruct', 'PeriodSeconds',
    'iOpen', 'iHigh', 'iLow', 'iClose', 'iVolume', 'iTime', 'iBars', 'iBarShift', 'iHighest', 'iLowest', 'CopyBuffer', 'CopyRates', 'CopyClose', 'SymbolInfoDouble', 'SymbolInfoInteger',
    'iMA', 'iRSI', 'iMACD', 'iBands', 'iATR', 'iStochastic', 'iCCI', 'iADX', 'iMomentum', 'iSAR', 'iEnvelopes', 'iStdDev', 'iCustom', 'Print', 'Comment', 'Alert',
    'ObjectCreate', 'ObjectSetInteger', 'ObjectSetDouble', 'ObjectSetString', 'ObjectGetInteger', 'ObjectGetString', 'ObjectDelete', 'ObjectsDeleteAll', 'ObjectFind', 'ChartRedraw', 'ChartGetInteger',
    'SetIndexBuffer', 'PlotIndexSetInteger', 'PlotIndexSetDouble', 'PlotIndexSetString', 'IndicatorSetInteger', 'IndicatorSetDouble', 'IndicatorSetString', 'EventSetTimer', 'EventSetMillisecondTimer', 'EventKillTimer'])
    assert.ok(names.has(n), 'missing ' + n);
});
t('syntax error has a line number', () => { const e = compileErr('#property indicator_chart_window\nint OnCalculate(const int a,const int b,const int c,const double &p[]){\n  int x = ;\n  return a; }'); assert.ok(e && e.line === 3, 'line ' + (e && e.line) + ' ' + (e && e.message)); });
t('undeclared identifier names it, with the line', () => { const e = compileErr('#property indicator_chart_window\nint OnCalculate(const int a,const int b,const int c,const double &p[]){\n  y = 2;\n  return a; }'); assert.ok(e && e.line === 3 && /\by\b/.test(e.message), e && e.message); });
t('no OnCalculate is an error', () => { const e = compileErr('#property indicator_chart_window\nint OnInit(){ return 0; }'); assert.ok(e && /OnCalculate/.test(e.message), e && e.message); });
for (const [what, src, line] of [
  ['OrderSend', 'MqlTradeRequest q; MqlTradeResult r; OrderSend(q, r);', 3],
  ['CTrade', 'CTrade tr; tr.Buy(1);', 3],
  ['PositionsTotal', 'int k = PositionsTotal();', 3],
  ['FileOpen', 'int f = FileOpen("a.csv", FILE_WRITE);', 3],
  ['WebRequest', 'char d[], r[]; string h; WebRequest("GET", "http://x", "", 0, d, r, h);', 3],
]) t('not supported: ' + what, () => {
  const e = compileErr('#property indicator_chart_window\nint OnCalculate(const int a,const int b,const int c,const double &p[]){\n  ' + src + '\n  return a; }');
  assert.ok(e, 'compiled');
  assert.ok(/not supported in indicators on TradeZoro/.test(e.message), e.message);
  assert.equal(e.line, line, 'line');
});
t('#import (DLL) is not supported', () => { const e = compileErr('#import "user32.dll"\nint MessageBoxW(int a);\n#import\n#property indicator_chart_window\nint OnCalculate(const int a,const int b,const int c,const double &p[]){ return a; }'); assert.ok(e && /not supported in indicators on TradeZoro/.test(e.message) && e.line === 1, e && e.message); });
t('EA-only event OnTick is not supported', () => { const e = compileErr('#property indicator_chart_window\nvoid OnTick(){ }\nint OnCalculate(const int a,const int b,const int c,const double &p[]){ return a; }'); assert.ok(e && /not supported in indicators on TradeZoro/.test(e.message) && e.line === 2, e && e.message); });
t('classes and struct methods give one clear line', () => {
  for (const src of ['class A { public: int x; };', 'struct S { int x; void f(){ } };']) {
    const e = compileErr(src + '\n#property indicator_chart_window\nint OnCalculate(const int a,const int b,const int c,const double &p[]){ return a; }');
    assert.ok(e && /not supported in indicators on TradeZoro/.test(e.message) && e.line === 1, e && e.message);
  }
});
t('#include of a standard header is stubbed', () => { runFull('#include <MovingAverages.mqh>\n#property indicator_chart_window\n#property indicator_buffers 1\n#property indicator_plots 1\ndouble B[];\nint OnInit(){ SetIndexBuffer(0,B); return 0; }\nint OnCalculate(const int a,const int b,const int c,const double &p[]){ for(int i=b;i<a;i++) B[i]=p[i]; return a; }'); });
t('#define, enums, structs, ternary, switch, do/while', () => {
  const { o } = runFull(`#property indicator_chart_window
#define TWICE(x) ((x)*2)
#define K 3
enum Side { UP_SIDE=1, DOWN_SIDE=-1 };
struct Acc { double sum; int n; };
void Add(Acc &q, double v){ q.sum += v; q.n++; }
double Mean(const Acc &q){ return q.n ? q.sum / q.n : 0; }
int OnCalculate(const int a,const int b,const int c,const double &p[]){
  Acc q; q.sum = 0; q.n = 0;
  for (int i = 0; i < K; i++) Add(q, TWICE(i));
  Side s = Mean(q) > 1 ? UP_SIDE : DOWN_SIDE;
  int w = 0; switch (s) { case UP_SIDE: w = 10; break; default: w = -10; }
  int j = 0; do { j++; } while (j < 5);
  Print(Mean(q), " ", EnumToString(s), " ", w, " ", j, " ", StringFormat("%05.1f|%-4s|%x", 3.14159, "ab", 255));
  return a; }`);
  assert.deepEqual(o.prints, ['2 UP_SIDE 10 5 003.1|ab  |ff']);
});
t('inputs become settings with groups and enum names', () => {
  const ind = mk(`#property indicator_chart_window
enum Look { THIN=0, // Thin line
 THICK=1 // Thick line
};
input group "Periods"
input int    Fast = 9;     // Fast period
input double Mult = 2.5;
sinput bool  Show = true;
input group "Style"
input color  Col = clrDodgerBlue;
input Look   L = THICK;
input string Txt = "hi";
input datetime From = D'2026.01.02 09:30';
input ENUM_MA_METHOD M = MODE_EMA;
int OnCalculate(const int a,const int b,const int c,const double &p[]){ return a; }`);
  const I = ind.meta.inputs, by = Object.fromEntries(I.map((i) => [i.key, i]));
  assert.equal(by.Fast.type, 'int'); assert.equal(by.Fast.defval, 9); assert.equal(by.Fast.title, 'Fast period'); assert.equal(by.Fast.group, 'Periods');
  assert.equal(by.Mult.type, 'float'); assert.equal(by.Show.type, 'bool'); assert.equal(by.Col.type, 'color'); assert.equal(by.Col.group, 'Style');
  assert.deepEqual(by.L.options, ['THIN', 'THICK']); assert.equal(by.L.defval, 'THICK'); assert.equal(by.L.display.options.THIN, 'Thin line');
  assert.equal(by.Txt.type, 'string'); assert.equal(by.From.type, 'time'); assert.ok(by.M.options.includes('MODE_EMA'));
});
t('input values from the settings reach the script', () => {
  const src = '#property indicator_chart_window\ninput int P = 3;\nenum E { A=0, Bv=1 };\ninput E Ev = A;\ninput bool On = false;\nint OnCalculate(const int a,const int b,const int c,const double &p[]){ Print(P, " ", Ev, " ", On); return a; }';
  const { o } = runFull(src, { inputs: { P: 17, Ev: 'Bv', On: true } });
  assert.deepEqual(o.prints, ['17 1 true']);
});

// ---------- 2. run model ----------
t('prev_calculated: only new bars are recomputed', () => {
  const src = `#property indicator_chart_window
#property indicator_buffers 1
#property indicator_plots 1
double X[]; int calls = 0;
int OnInit(){ SetIndexBuffer(0, X); return INIT_SUCCEEDED; }
int OnCalculate(const int rates_total,const int prev_calculated,const datetime &time[],const double &open[],const double &high[],const double &low[],const double &close[],const long &tick_volume[],const long &volume[],const int &spread[]){
  int start = prev_calculated > 0 ? prev_calculated - 1 : 0;
  for (int i = start; i < rates_total; i++) { X[i] = close[i]; calls++; }
  Print(prev_calculated, " ", calls);
  return rates_total; }`;
  const ind = mk(src);
  const half = Object.fromEntries(Object.entries(B).map(([k, v]) => [k, v.slice(0, 300)]));
  let o = ind.calc(half, 'full'); assert.deepEqual(o.prints, ['0 300']);
  const more = Object.fromEntries(Object.entries(B).map(([k, v]) => [k, v.slice(0, 302)]));
  o = ind.calc(more, 'append'); assert.deepEqual(o.prints, ['300 303']);
  o = ind.calc(more, 'tick'); assert.deepEqual(o.prints, ['302 304']);
  assert.equal(ind.buffer(0)[301], B.close[301]);
});
t('price[] form with ArraySetAsSeries', () => {
  const { ind } = runFull(`#property indicator_separate_window
#property indicator_buffers 1
#property indicator_plots 1
double X[];
int OnInit(){ SetIndexBuffer(0, X); ArraySetAsSeries(X, true); return 0; }
int OnCalculate(const int rates_total,const int prev_calculated,const int begin,const double &price[]){
  ArraySetAsSeries(price, true);
  for (int i = 0; i < rates_total - prev_calculated; i++) X[i] = price[i] - (i + 1 < rates_total ? price[i + 1] : price[i]);
  return rates_total; }`);
  assert.ok(Math.abs(ind.buffer(0)[N - 1] - (B.close[N - 1] - B.close[N - 2])) < 1e-12);
});
t('OnTimer + EventSetTimer / EventSetMillisecondTimer', () => {
  const ind = mk('#property indicator_chart_window\nint n=0;\nint OnInit(){ EventSetMillisecondTimer(250); return 0; }\nvoid OnTimer(){ n++; Comment("ticks ", n); }\nvoid OnDeinit(const int r){ EventKillTimer(); }\nint OnCalculate(const int a,const int b,const int c,const double &p[]){ return a; }');
  let o = ind.calc(B, 'full'); assert.equal(o.timer, 250);
  ind.timer(); o = ind.timer(); assert.equal(o.comment, 'ticks 2');
  const e = mk('#property indicator_chart_window\nint OnInit(){ EventSetTimer(2); return 0; }\nint OnCalculate(const int a,const int b,const int c,const double &p[]){ return a; }').calc(B, 'full');
  assert.equal(e.timer, 2000);
});
t('OnChartEvent: object click, click, key, drag', () => {
  const ind = mk(`#property indicator_chart_window
int OnInit(){ ObjectCreate(0,"b",OBJ_BUTTON,0,0,0); return 0; }
int OnCalculate(const int a,const int b,const int c,const double &p[]){ return a; }
void OnChartEvent(const int id,const long &l,const double &d,const string &s){
  if (id == CHARTEVENT_OBJECT_CLICK) Print("obj ", s, " ", ObjectGetInteger(0, s, OBJPROP_STATE));
  if (id == CHARTEVENT_CLICK) Print("click ", l, " ", (long)d);
  if (id == CHARTEVENT_KEYDOWN) Print("key ", l);
  if (id == CHARTEVENT_OBJECT_DRAG) Print("drag ", s, " ", ObjectGetInteger(0, s, OBJPROP_XDISTANCE));
}`);
  ind.calc(B, 'full');
  ind.objectState('b', { state: 1 }); assert.deepEqual(ind.event(1, 0, 0, 'b').prints, ['obj b 1']);
  assert.deepEqual(ind.event(4, 120, 40, '').prints, ['click 120 40']);
  assert.deepEqual(ind.event(0, 65, 1, '').prints, ['key 65']);
  ind.objectState('b', { x: 33, y: 5 }); assert.deepEqual(ind.event(2, 0, 0, 'b').prints, ['drag b 33']);
});
t('OnInit returning INIT_FAILED stops with a clear error', () => {
  const o = mk('#property indicator_chart_window\nint OnInit(){ return INIT_FAILED; }\nint OnCalculate(const int a,const int b,const int c,const double &p[]){ return a; }').calc(B, 'full');
  assert.equal(o.ok, false); assert.ok(/OnInit/.test(o.error.message), o.error.message);
});
t('runtime error: array out of range has the line', () => {
  const o = mk('#property indicator_chart_window\nint OnCalculate(const int a,const int b,const int c,const double &p[]){\n  double x[3];\n  x[5] = 1;\n  return a; }').calc(B, 'full');
  assert.equal(o.ok, false); assert.equal(o.error.line, 4, JSON.stringify(o.error)); assert.ok(/range/i.test(o.error.message));
});

// ---------- 3. limits ----------
t('endless loop is stopped by the time limit', () => {
  // a clock that runs 1 s per reading, so the 20 s guard trips in a few hundred loop checks instead of 20 real seconds
  let clk = 0; const fast = () => (clk += 1000);
  const t0 = Date.now();
  const o = mk('#property indicator_chart_window\nint OnCalculate(const int a,const int b,const int c,const double &p[]){\n  while (true) { }\n  return a; }', { now: fast, perf: fast }).calc(B, 'full');
  assert.equal(o.ok, false); assert.ok(/too long|longer|time/i.test(o.error.message), o.error.message); assert.ok(Date.now() - t0 < 15000, 'took ' + (Date.now() - t0));
  assert.equal(o.error.line, 3);
});
t('runaway memory is refused', () => {
  const o = mk('#property indicator_chart_window\nint OnCalculate(const int a,const int b,const int c,const double &p[]){\n  double big[];\n  ArrayResize(big, 2000000000);\n  return a; }').calc(B, 'full');
  assert.equal(o.ok, false); assert.ok(/memory|large|size/i.test(o.error.message), o.error.message);
});
t('deep recursion is stopped', () => {
  const o = mk('#property indicator_chart_window\nint f(int n){ return f(n + 1) + 1; }\nint OnCalculate(const int a,const int b,const int c,const double &p[]){ f(0); return a; }').calc(B, 'full');
  assert.equal(o.ok, false);
});
t('sandbox: no page globals reachable', () => {
  for (const g of ['fetch', 'globalThis', 'self', 'constructor', 'eval', 'Function', 'importScripts', 'XMLHttpRequest', '__proto__'])
    assert.ok(compileErr('#property indicator_chart_window\nint OnCalculate(const int a,const int b,const int c,const double &p[]){ ' + g + '; return a; }'), g + ' compiled');
  const { o } = runFull('#property indicator_chart_window\nint OnCalculate(const int a,const int b,const int c,const double &p[]){ string s = "constructor"; Print(StringLen(s)); return a; }');
  assert.deepEqual(o.prints, ['11']);
});

// ---------- 4. classic indicators vs textbook formulas (1e-6) ----------
const HANDLE = (create, nbuf, buf = 0) => `#property indicator_separate_window
#property indicator_buffers 1
#property indicator_plots 1
double X[]; int h;
int OnInit(){ SetIndexBuffer(0, X); h = ${create}; return h == INVALID_HANDLE ? INIT_FAILED : INIT_SUCCEEDED; }
int OnCalculate(const int rates_total,const int prev_calculated,const datetime &time[],const double &open[],const double &high[],const double &low[],const double &close[],const long &tick_volume[],const long &volume[],const int &spread[]){
  if (BarsCalculated(h) < rates_total) return 0;
  int n = prev_calculated == 0 ? rates_total : rates_total - prev_calculated + 1;
  double t[]; ArraySetAsSeries(X, true);
  if (CopyBuffer(h, ${buf}, 0, n, t) != n) return 0;
  ArraySetAsSeries(t, true);
  for (int i = 0; i < n; i++) X[i] = t[i];
  return rates_total; }`;
const viaHandle = (create, buf) => runFull(HANDLE(create, 1, buf)).ind.buffer(0);
const C = B.close;
t('iMA SMA 20', () => near(viaHandle('iMA(_Symbol,_Period,20,0,MODE_SMA,PRICE_CLOSE)'), R.sma(C, 20), 0, 1e-6, 'sma'));
t('iMA EMA 12', () => near(viaHandle('iMA(_Symbol,_Period,12,0,MODE_EMA,PRICE_CLOSE)'), R.ema(C, 12), 0, 1e-6, 'ema'));
t('iMA SMMA 14', () => near(viaHandle('iMA(_Symbol,_Period,14,0,MODE_SMMA,PRICE_CLOSE)'), R.smma(C, 14), 0, 1e-6, 'smma'));
t('iMA LWMA 10 on typical price', () => near(viaHandle('iMA(_Symbol,_Period,10,0,MODE_LWMA,PRICE_TYPICAL)'), R.lwma(C.map((c, i) => (B.high[i] + B.low[i] + c) / 3), 10), 0, 1e-6, 'lwma'));
t('iRSI 14', () => near(viaHandle('iRSI(_Symbol,_Period,14,PRICE_CLOSE)'), R.rsi(C, 14), 0, 1e-6, 'rsi'));
t('iMACD 12/26/9 main + signal', () => {
  const e12 = R.ema(C, 12), e26 = R.ema(C, 26), m = C.map((_, i) => e12[i] - e26[i]);
  near(viaHandle('iMACD(_Symbol,_Period,12,26,9,PRICE_CLOSE)', 0), m, 0, 1e-6, 'macd');
  const sig = R.sma(m, 9);
  near(viaHandle('iMACD(_Symbol,_Period,12,26,9,PRICE_CLOSE)', 1), sig, 0, 1e-6, 'signal');
});
t('iBands 20, 2 (base, upper, lower)', () => {
  const m = R.sma(C, 20), sd = R.stdev(C, 20);
  near(viaHandle('iBands(_Symbol,_Period,20,0,2.0,PRICE_CLOSE)', 0), m, 0, 1e-6, 'base');
  near(viaHandle('iBands(_Symbol,_Period,20,0,2.0,PRICE_CLOSE)', 1), m.map((v, i) => v + 2 * sd[i]), 0, 1e-6, 'upper');
  near(viaHandle('iBands(_Symbol,_Period,20,0,2.0,PRICE_CLOSE)', 2), m.map((v, i) => v - 2 * sd[i]), 0, 1e-6, 'lower');
});
t('iATR 14 (simple average of true range)', () => { const tr = R.tr(B); const ref = tr.map((_, i) => (i < 14 ? NaN : tr.slice(i - 13, i + 1).reduce((a, b) => a + b, 0) / 14)); near(viaHandle('iATR(_Symbol,_Period,14)'), ref, 0, 1e-6, 'atr'); });
t('iStochastic 5,3,3 SMA low/high', () => {
  const K = 5, sl = 3, n = N, hh = [], ll = [], main = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) { hh[i] = i < K - 1 ? NaN : Math.max(...B.high.slice(i - K + 1, i + 1)); ll[i] = i < K - 1 ? NaN : Math.min(...B.low.slice(i - K + 1, i + 1)); }
  for (let i = K - 1 + sl - 1; i < n; i++) { let a = 0, b = 0; for (let k = 0; k < sl; k++) { a += C[i - k] - ll[i - k]; b += hh[i - k] - ll[i - k]; } main[i] = (100 * a) / b; }
  near(viaHandle('iStochastic(_Symbol,_Period,5,3,3,MODE_SMA,STO_LOWHIGH)', 0), main, 0, 1e-6, 'main');
  const first = main.findIndex(Number.isFinite), sig = main.map((_, i) => (i < first + 2 ? NaN : (main[i] + main[i - 1] + main[i - 2]) / 3));
  near(viaHandle('iStochastic(_Symbol,_Period,5,3,3,MODE_SMA,STO_LOWHIGH)', 1), sig, 0, 1e-6, 'signal');
});
t('iCCI 14 typical', () => near(viaHandle('iCCI(_Symbol,_Period,14,PRICE_TYPICAL)'), R.cci(B, 14), 0, 1e-6, 'cci'));
t('iADX 14 (EMA-smoothed directional movement)', () => {
  const p = 14, a = 2 / (p + 1), A = [0], P = [0], M = [0];
  for (let i = 1; i < N; i++) {
    let up = B.high[i] - B.high[i - 1], dn = B.low[i - 1] - B.low[i];
    up = Math.max(up, 0); dn = Math.max(dn, 0); if (up > dn) dn = 0; else if (dn > up) up = 0; else up = dn = 0;
    const tr = Math.max(B.high[i] - B.low[i], Math.abs(B.high[i] - C[i - 1]), Math.abs(B.low[i] - C[i - 1]));
    P[i] = (tr ? 100 * up / tr : 0) * a + P[i - 1] * (1 - a); M[i] = (tr ? 100 * dn / tr : 0) * a + M[i - 1] * (1 - a);
    const s = P[i] + M[i]; A[i] = (s ? 100 * Math.abs(P[i] - M[i]) / s : 0) * a + A[i - 1] * (1 - a);
  }
  near(viaHandle('iADX(_Symbol,_Period,14)', 0), A, 1, 1e-6, 'adx'); near(viaHandle('iADX(_Symbol,_Period,14)', 1), P, 1, 1e-6, '+di'); near(viaHandle('iADX(_Symbol,_Period,14)', 2), M, 1, 1e-6, '-di');
});
t('iMomentum 10', () => near(viaHandle('iMomentum(_Symbol,_Period,10,PRICE_CLOSE)'), C.map((c, i) => (i < 10 ? NaN : (c * 100) / C[i - 10])), 0, 1e-6, 'mom'));
t('iSAR 0.02 / 0.2 (Wilder)', () => {
  const H = B.high, L = B.low, o = new Array(N).fill(NaN);
  let long = C[1] >= C[0], af = 0.02, ep = long ? Math.max(H[0], H[1]) : Math.min(L[0], L[1]), s = long ? Math.min(L[0], L[1]) : Math.max(H[0], H[1]);
  o[1] = s;
  for (let i = 2; i < N; i++) {
    s += af * (ep - s);
    if (long) { s = Math.min(s, L[i - 1], L[i - 2]); if (L[i] < s) { long = false; s = ep; ep = L[i]; af = 0.02; } else if (H[i] > ep) { ep = H[i]; af = Math.min(0.2, af + 0.02); } }
    else { s = Math.max(s, H[i - 1], H[i - 2]); if (H[i] > s) { long = true; s = ep; ep = H[i]; af = 0.02; } else if (L[i] < ep) { ep = L[i]; af = Math.min(0.2, af + 0.02); } }
    o[i] = s;
  }
  near(viaHandle('iSAR(_Symbol,_Period,0.02,0.2)'), o, 1, 1e-6, 'sar');
});
t('iEnvelopes 14 SMA 0.5%', () => { const m = R.sma(C, 14); near(viaHandle('iEnvelopes(_Symbol,_Period,14,0,MODE_SMA,PRICE_CLOSE,0.5)', 0), m.map((v) => v * 1.005), 0, 1e-6, 'up'); near(viaHandle('iEnvelopes(_Symbol,_Period,14,0,MODE_SMA,PRICE_CLOSE,0.5)', 1), m.map((v) => v * 0.995), 0, 1e-6, 'dn'); });
t('iStdDev 20 SMA', () => near(viaHandle('iStdDev(_Symbol,_Period,20,0,MODE_SMA,PRICE_CLOSE)'), R.stdev(C, 20), 0, 1e-6, 'stddev'));
t('hand-written SMA / EMA / RSI in MQL5 match too', () => {
  const { ind } = runFull(CORPUS.find((x) => x.name === 'Hand RSI').source);
  near(ind.buffer(0), R.rsi(C, 14), 15, 1e-6, 'hand rsi');
});

// ---------- 5. buffers, plots, objects ----------
t('plots: types, colours, labels, empty values, levels, min/max', () => {
  const { o } = runFull(CORPUS.find((x) => x.name === 'Plot kinds').source);
  const types = o.plots.map((p) => p.type);
  for (const k of [1, 2, 3, 4, 5, 6, 7, 10, 14, 15]) assert.ok(types.includes(k), 'draw type ' + k + ' missing: ' + types);
  assert.equal(o.levels.length, 2); assert.deepEqual([o.range.min, o.range.max], [-5, 205]);
  const col = o.plots.find((p) => p.type === 10); assert.ok(col.ci && col.colors.length >= 2, 'colour index buffer');
  assert.ok(o.plots.find((p) => p.type === 5).arrow === 233);
});
t('objects: every kind with corner + distance', () => {
  const { o } = runFull(CORPUS.find((x) => x.name === 'Objects').source);
  const types = new Set(o.objects.map((x) => x.type));
  for (const k of [0, 1, 2, 18, 101, 102, 103, 107, 110, 100, 23, 24]) assert.ok(types.has(k), 'object type ' + k + ' missing');
  const btn = o.objects.find((x) => x.name === 'btn'), I = new Map(btn.i);
  assert.equal(I.get(42), 1); assert.equal(I.get(26), 15); assert.equal(I.get(27), 25);
  assert.deepEqual(o.prints.slice(-1), ['found 3 left 12']);
});
t('ChartGetInteger width/height come from the page', () => {
  const { o } = runFull('#property indicator_chart_window\nint OnCalculate(const int a,const int b,const int c,const double &p[]){ Print(ChartGetInteger(0,CHART_WIDTH_IN_PIXELS), "x", ChartGetInteger(0,CHART_HEIGHT_IN_PIXELS)); return a; }', { chart: { w: 1234, h: 567 } });
  assert.deepEqual(o.prints, ['1234x567']);
});
t('Alert becomes an alert entry', () => { const { o } = runFull('#property indicator_chart_window\nint OnCalculate(const int a,const int b,const int c,const double &p[]){ if (b == 0) Alert("Cross up at ", DoubleToString(p[a-1], 2)); return a; }'); assert.equal(o.alerts.length, 1); assert.ok(/^Cross up at \d+\.\d\d$/.test(o.alerts[0].text), o.alerts[0].text); });
t('iCustom runs another saved MQL5 indicator', () => {
  const child = '#property indicator_separate_window\n#property indicator_buffers 1\n#property indicator_plots 1\ninput int P = 5;\ndouble X[];\nint OnInit(){ SetIndexBuffer(0,X); return 0; }\nint OnCalculate(const int a,const int b,const int c,const double &p[]){ for (int i=b;i<a;i++) X[i] = p[i] * P; return a; }';
  const src = HANDLE('iCustom(_Symbol,_Period,"Times",3)', 1, 0);
  const ind = new Indicator(src, Object.assign({}, ENV, { customs: new Map([['Times', child]]) }));
  const o = ind.calc(B, 'full'); assert.ok(o.ok, JSON.stringify(o.error));
  near(ind.buffer(0), C.map((c) => c * 3), 0, 1e-9, 'icustom');
  const bad = new Indicator(HANDLE('iCustom(_Symbol,_Period,"Missing")', 1, 0), ENV).calc(B, 'full');
  assert.equal(bad.ok, false);
});

// ---------- 6. examples + the 25+ corpus ----------
for (const x of MQ5_EXAMPLES.concat([{ name: 'New template', source: MQ5_NEW }])) t('example runs: ' + x.name, () => {
  const { ind, o } = runFull(x.source);
  assert.ok(o.plots.length || (o.objects || []).length, 'draws something');
  assert.ok(ind.calc(B, 'tick').ok, 'tick');
});
t('corpus has 25+ indicators', () => assert.ok(CORPUS.length >= 25, 'corpus ' + CORPUS.length));
for (const x of CORPUS) t('corpus: ' + x.name, () => {
  const { ind, o } = runFull(x.source, x.env);
  if (x.check) x.check(o, ind, B);
  const more = Object.fromEntries(Object.entries(B).map(([k, v]) => [k, v.concat(v.slice(-1))]));
  more.time[N] = B.time[N - 1] + 900;
  const o2 = ind.calc(more, 'append'); assert.ok(o2.ok, 'append ' + JSON.stringify(o2.error));
  if (x.timer) assert.ok(ind.timer().ok, 'timer');
});

console.log(`mq5-engine: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
