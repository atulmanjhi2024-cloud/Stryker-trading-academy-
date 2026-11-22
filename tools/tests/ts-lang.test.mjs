// thinkScript language + compiler units: parsing, every statement form, inputs -> settings, display output, errors with
// line numbers, unsupported features, limits.      node tools/tests/ts-lang.test.mjs
import { lex as tokenize } from '../../assets/ts/lexer.js';
import { parse } from '../../assets/ts/parser.js';
import { analyze, execute, LIMITS } from '../../assets/ts/compiler.js';
import { NATIVES } from '../../assets/ts/natives.js';
import { LIBRARY } from '../../assets/ts/library.js';
import { catalog } from '../../assets/ts/catalog.js';
import { TS_EXAMPLES } from '../../assets/ts/examples.js';
import { t, done, makeBars, assert } from './ts-helpers.mjs';

const B = makeBars(400, 5);
const N = B.time.length;
const run = (src, o) => execute(src, Object.assign({ bars: B, tfMs: 3e5, symbol: 'NASDAQ:SAMPLE' }, o || {}));
const ok = (src, o) => { const r = run(src, o); assert.ok(r.ok, JSON.stringify(r.error)); return r; };
const last = (r, i) => r.plots[i || 0].values[N - 1];
const err = (src, o) => { const r = run(src, o); assert.equal(r.ok, false, 'expected an error'); return r.error; };
const aerr = (src) => { const r = analyze(src); assert.equal(r.ok, false, 'expected an error'); return r.diagnostics[0]; };

// ---------- lexer / parser ----------
t('lexer: comments, strings, numbers, case-insensitive ids', () => {
  const k = tokenize('# note\nDEF x = 1.5e2; "a b"').filter((x) => x.t !== 'eof');
  assert.deepEqual(k.map((x) => x.t), ['id', 'id', 'op', 'num', 'op', 'str']);
  assert.equal(k[0].k, 'def'); assert.equal(k[0].line, 2); assert.equal(k[3].v, 150);
});
t('parser: statements carry line numbers', () => {
  const p = parse('input a = 1;\n\ndef b = a + 1;\nplot c = b;');
  assert.deepEqual(p.map((s) => [s.s, s.line]), [['input', 1], ['def', 3], ['plot', 4]]);
});
t('parser: missing semicolon is reported on the right line', () => { const d = aerr('def a = 1\nplot b = a;'); assert.equal(d.line, 1); assert.match(d.message, /;/); });
t('parser: unclosed brace', () => { const d = aerr('script S {\n plot x = 1;\n'); assert.ok(d.line >= 1); });

// ---------- statements ----------
t('def / plot / arithmetic precedence', () => assert.equal(last(ok('def a = 2 + 3 * Power(4, 2) - 10 / 5 % 3;\nplot p = a;')), 2 + 48 - (2 % 3)));
t('declare lower / upper', () => { assert.equal(analyze('declare lower; plot x = 1;').meta.lower, true); assert.equal(analyze('declare upper; plot x = 1;').meta.lower, false); });
t('declare once_per_bar and hide_on_intraday', () => {
  ok('declare once_per_bar; plot x = close;');
  const r = ok('declare hide_on_intraday; plot x = close;');
  assert.equal(r.plots[0].display, 'none');
  assert.equal(ok('declare hide_on_intraday; plot x = close;', { tfMs: 864e5 }).plots[0].display, 'all');
});
t('if/then/else expression and the If() function', () => {
  const r = ok('plot a = if close > open then 1 else if close < open then -1 else 0;\nplot b = If(close > open, 1, 0);');
  const want = B.close[N - 1] > B.open[N - 1] ? 1 : B.close[N - 1] < B.open[N - 1] ? -1 : 0;
  assert.equal(last(r, 0), want); assert.equal(last(r, 1), want > 0 ? 1 : 0);
});
t('if/else if/else blocks assign a def', () => {
  const r = ok('def x;\nif close > open { x = 1; } else if close < open { x = -1; } else { x = 0; }\nplot p = x;');
  assert.ok([1, -1, 0].includes(last(r)));
});
t('rec keyword and self-reference recursion', () => {
  assert.equal(last(ok('rec c = c[1] + 1;\nplot p = c;')), N);
  assert.equal(last(ok('def c = c[1] + 1;\nplot p = c;')), N);
});
t('[n] offsets, negative offsets read the future', () => {
  const r = ok('plot a = close[3];\nplot b = close[-1];');
  assert.equal(last(r, 0), B.close[N - 4]);
  assert.equal(r.plots[1].values[N - 2], B.close[N - 1]);
  assert.ok(Number.isNaN(last(r, 1)));
});
t('GetValue with a moving offset', () => assert.equal(last(ok('plot a = GetValue(close, 2);')), B.close[N - 3]));
t('Double.NaN and IsNaN', () => { const r = ok('def x = Double.NaN;\nplot a = IsNaN(x);\nplot b = if IsNaN(close[1000]) then 7 else 0;'); assert.equal(last(r, 0), 1); assert.equal(last(r, 1), 7); });
t('fold with while', () => assert.equal(last(ok('plot a = fold i = 0 to 100 with s = 0 while s < 10 do s + 1;')), 10));
t('switch with default', () => assert.equal(last(ok('input m = {a, default b, c};\ndef v;\nswitch (m) { case a: v = 1; default: v = 9; }\nplot p = v;')), 9));
t('enum input compare with ==', () => assert.equal(last(ok('input m = {default up, down};\nplot p = if m == m.up then 1 else 2;')), 1));
t('crosses above / below / crosses()', () => {
  const r = ok('def f = Average(close, 5); def s = Average(close, 20);\nplot a = Sum(f crosses above s, 400);\nplot b = Sum(f crosses below s, 400);\nplot c = Sum(Crosses(f, s, CrossingDirection.ANY), 400);');
  assert.ok(last(r, 0) > 0 && last(r, 1) > 0);
  assert.equal(last(r, 2), last(r, 0) + last(r, 1));
});
t('between, and/or, not, !=, <>', () => {
  const r = ok('plot a = between(5, 1, 10) and !(1 == 2) and 1 <> 2 and (no or yes);');
  assert.equal(last(r), 1);
});
t('script{} user function: default plot and named args', () => {
  const r = ok('script Twice { input v = 1; plot out = v * 2; }\nplot a = Twice(4);\nplot b = Twice(v = 5);');
  assert.equal(last(r, 0), 8); assert.equal(last(r, 1), 10);
});
t('built-in study reference with named plot and named input', () => { const r = ok('plot a = RSI(length = 5).RSI;\nplot b = reference RSI(5);'); assert.equal(last(r, 0), last(r, 1)); });
t('CompoundValue seeds the first bars', () => { const r = ok('def x = CompoundValue(5, x[1] + 1, 100);\nplot p = x;'); assert.equal(r.plots[0].values[4], 100); assert.equal(r.plots[0].values[5], 101); });
t('bar data: hl2 hlc3 ohlc4 barNumber', () => {
  const r = ok('plot a = hl2; plot b = hlc3; plot c = ohlc4; plot d = BarNumber(); plot e = barNumber;');
  const i = N - 1, h = B.high[i], l = B.low[i], c = B.close[i], o = B.open[i];
  assert.ok(Math.abs(last(r, 0) - (h + l) / 2) < 1e-9); assert.ok(Math.abs(last(r, 1) - (h + l + c) / 3) < 1e-9);
  assert.ok(Math.abs(last(r, 2) - (o + h + l + c) / 4) < 1e-9); assert.equal(last(r, 3), N); assert.equal(last(r, 4), N);
});
t('time: GetTime, GetDay, SecondsFromTime, SecondsTillTime, RegularTradingStart/End', () => {
  const r = ok('plot a = GetTime(); plot b = SecondsFromTime(0930); plot c = SecondsTillTime(1600); plot d = GetYYYYMMDD();\nplot e = RegularTradingStart(20260105); plot f = RegularTradingEnd(20260105); plot g = GetDayOfWeek(GetYYYYMMDD());');
  assert.equal(r.plots[0].values[0], B.time[0]);
  assert.equal(r.plots[1].values[0], 0); assert.equal(r.plots[1].values[1], 300);
  assert.equal(r.plots[2].values[0], 6.5 * 3600);
  assert.equal(r.plots[3].values[0], 20260105);
  assert.equal(r.plots[4].values[0], Date.UTC(2026, 0, 5, 14, 30)); assert.equal(r.plots[5].values[0], Date.UTC(2026, 0, 5, 21, 0));
  assert.equal(r.plots[6].values[0], 1);
});
t('GetSymbol and AddLabel text', () => { const r = ok('AddLabel(yes, "Sym " + GetSymbol(), Color.WHITE);\nplot x = 1;'); assert.equal(r.tables[0].cells[0].text, 'Sym NASDAQ:SAMPLE'); });
t('higher timeframe: close(period = AggregationPeriod.DAY) asks for bars, then maps them', () => {
  const src = 'plot d = close(period = AggregationPeriod.DAY);';
  const r1 = ok(src);
  assert.equal(r1.need.length, 1); assert.equal(r1.need[0].ms, 864e5);
  const D = makeBars(3, 9, 864e5); D.time = [Date.UTC(2026, 0, 5, 5), Date.UTC(2026, 0, 6, 5), Date.UTC(2026, 0, 7, 5)];
  const r2 = ok(src, { securities: { [r1.need[0].key]: D } });
  assert.ok(!r2.need || !r2.need.length);
  assert.equal(r2.plots[0].values[0], D.close[0]);
  assert.equal(last(r2), D.close[1]);   // 400 bars of 5 minutes reach into the second day
  assert.match(err('plot d = close(period = AggregationPeriod.MIN);').message, /shorter/);
});
t('150+ functions and studies', () => { const n = Object.keys(NATIVES).length + Object.keys(LIBRARY).length; assert.ok(n >= 150, 'only ' + n); });
t('every built-in study runs on Sample data', () => {
  for (const k of Object.keys(LIBRARY)) {
    const name = parse(LIBRARY[k])[0].name;
    const r = run('plot x = ' + name + '();'); assert.ok(r.ok, name + ': ' + JSON.stringify(r.error));
    assert.ok(Number.isFinite(last(r)), name + ' last value');
  }
});
t('every catalog function is callable by its documented name', () => {
  const c = catalog(); assert.ok(c.length > 250);
  for (const f of c.filter((x) => x.kind === 'study')) assert.ok(analyze('plot x = ' + f.name + '();').ok, f.name);
});
t('the five examples check and run', () => {
  assert.equal(TS_EXAMPLES.length, 5);
  for (const x of TS_EXAMPLES) {
    assert.ok(analyze(x.source).ok, x.id);
    let r = run(x.source);
    if (r.need && r.need.length) r = run(x.source, { securities: Object.fromEntries(r.need.map((q) => [q.key, makeBars(10, 3, q.ms)])) });
    assert.ok(r.ok, x.id + ' ' + JSON.stringify(r.error)); assert.ok(r.plots.length > 0, x.id);
  }
});

// ---------- inputs -> settings ----------
t('inputs: int, double, string, boolean, price, enum, AverageType', () => {
  const m = analyze('input a = 5;\ninput b = 1.5;\ninput c = "hi";\ninput d = yes;\ninput e = close;\ninput f = {x, default y};\ninput g = AverageType.WILDERS;\nplot p = 1;').meta;
  assert.deepEqual(m.inputs.map((i) => [i.title, i.type, i.defval]), [['a', 'int', 5], ['b', 'float', 1.5], ['c', 'string', 'hi'], ['d', 'bool', true], ['e', 'source', 'close'], ['f', 'string', 'y'], ['g', 'string', 'WILDERS']]);
  assert.deepEqual(m.inputs[5].options, ['x', 'y']);
  assert.ok(m.inputs[6].options.includes('EXPONENTIAL'));
  assert.ok(m.inputs[4].options.includes('hl2'));
});
t('changed inputs recompute', () => {
  const src = 'input n = 5;\ninput src = close;\ninput on = yes;\nplot p = if on then Average(src, n) else 0;';
  const a = last(ok(src)), b = last(ok(src, { inputs: { 0: 50 } })), c = last(ok(src, { inputs: { 1: 'high' } })), d = last(ok(src, { inputs: { 2: false } }));
  assert.notEqual(a, b); assert.notEqual(a, c); assert.equal(d, 0);
});
t('bad input values fall back to the default', () => assert.equal(last(ok('input n = 5;\nplot p = n;', { inputs: { 0: 'x' } })), 5));

// ---------- display ----------
t('SetPaintingStrategy kinds', () => {
  const kinds = { LINE: 'line', HISTOGRAM: 'histogram', POINTS: 'circles', SQUARED_HISTOGRAM: 'columns', HORIZONTAL: 'stepline', DASHES: 'line', ARROW_UP: 'shape', ARROW_DOWN: 'shape', BOOLEAN_ARROW_UP: 'shape', BOOLEAN_ARROW_DOWN: 'shape', BOOLEAN_POINTS: 'shape' };
  for (const [k, want] of Object.entries(kinds)) {
    const r = ok('plot p = close > open;\np.SetPaintingStrategy(PaintingStrategy.' + k + ');');
    assert.equal(r.plots[0].kind, want, k);
  }
  assert.equal(ok('plot p = close;\np.SetPaintingStrategy(PaintingStrategy.DASHES);').plots[0].lineStyle, 'dashed');
});
t('colours: SetDefaultColor, AssignValueColor, GetColor, CreateColor, SetLineWeight, SetStyle, Hide', () => {
  const r = ok('plot p = close;\np.SetDefaultColor(CreateColor(255, 0, 0));\np.SetLineWeight(3);\np.SetStyle(Curve.SHORT_DASH);\nplot q = open;\nq.AssignValueColor(if close > open then Color.GREEN else GetColor(1));\nplot h = 1;\nh.Hide();');
  assert.equal(r.plots[0].color, '#ff0000ff'); assert.equal(r.plots[0].linewidth, 3); assert.equal(r.plots[0].lineStyle, 'dashed');
  assert.equal(r.plots[1].colors.length, N); assert.equal(r.plots[2].display, 'none');
});
t('HideBubble / HideTitle are accepted', () => ok('plot p = close;\np.HideBubble();\np.HideTitle();'));
t('AddCloud, AddLabel, AddChartBubble, AddVerticalLine, AssignPriceColor', () => {
  const r = ok('plot a = high; plot b = low;\nAddCloud(a, b, Color.GREEN, Color.RED);\nAddLabel(yes, "L", Color.YELLOW);\nAddChartBubble(BarNumber() == 10, high, "B", Color.CYAN);\nAddVerticalLine(BarNumber() == 20, "V", Color.GRAY);\nAssignPriceColor(if close > open then Color.GREEN else Color.RED);');
  assert.equal(r.fills.length, 1); assert.equal(r.tables[0].cells[0].text, 'L');
  assert.ok(r.labels.some((l) => l.text === 'B')); assert.equal(r.lines.length, 1);
  assert.ok(r.plots.some((p) => p.kind === 'barcolor'));
});
t('Alert on the last bar', () => {
  const r = ok('Alert(yes, "now", Alert.BAR, Sound.Ding);\nAlert(no, "never", Alert.ONCE, Sound.Bell);\nplot x = 1;');
  assert.deepEqual(r.tsAlerts.map((a) => [a.text, a.type]), [['now', 'BAR']]);
});

// ---------- errors ----------
t('unknown name: line, column and a suggestion', () => { const e = err('plot a = 1;\nplot b = Averag(close, 3);'); assert.equal(e.line, 2); assert.equal(e.col, 10); assert.match(e.hint + e.message, /Average/); });
t('type error: text plotted as a number', () => assert.equal(err('def x = 1;\nplot a = "text";').line, 2));
t('plot without a value; redefined name', () => { assert.match(err('plot a = 1;\nplot a = 2;').message, /already defined/); });
t('method on a def is rejected clearly', () => assert.match(err('def x = close;\nx.SetDefaultColor(Color.RED);').message, /plot/i));
t('unsupported: one clear line for strategies and scan-only functions', () => {
  for (const s of ['AddOrder(OrderType.BUY_TO_OPEN, close > open);', 'declare strategy;', 'plot x = GetQuantity();', 'plot x = EntryPrice();']) {
    const e = err(s + '\nplot y = 1;');
    assert.match(e.message, /not supported/i, s); assert.equal(e.line, 1, s);
  }
});

// ---------- limits ----------
t('limits: fold iterations, too-large source', () => {
  assert.match(err('plot a = fold i = 0 to 100000000 with s do s + 1;').message, /fold|too many|limit/i);
  assert.equal(run('#'.repeat(LIMITS.source + 10) + '\nplot x = 1;').ok, false);
});
t('limits: deep nesting gives an error, not a crash', () => { const r = run('plot a = ' + '('.repeat(5000) + '1' + ')'.repeat(5000) + ';'); assert.equal(r.ok, false); });
t('limits: a runaway script stops itself (time limit)', () => {
  const r = run('plot a = fold i = 0 to 20000 with s do s + fold j = 0 to 20000 with q do q + 1;', { bars: makeBars(50000, 2) });
  assert.equal(r.ok, false); assert.match(r.error.message, /long|stopped|too much|limit/i);
});
done('ts-lang');
