// TradeZoro thinkScript engine: compiler + runtime. Pure (no DOM, no network, no eval).
// The AST (parser.js) is turned into plain JavaScript closures; a member's text is never evaluated as code.
//
//   analyze(source, opts?) -> { ok, diagnostics, meta: { lower, inputs, plots, declares, uses } }   (settings dialog, Docs)
//   execute(source, opts)  -> out                                                              (see "output" at the bottom)
//     opts = { bars: {time, open, high, low, close, volume} arrays, inputs: { [key]: value }, symbol, tfMs, futuresDay,
//              securities: { 'SYM|ms': {time, open, high, low, close, volume} }, deadline (ms epoch), tick }
//   A script that reads another timeframe or symbol (close(period = AggregationPeriod.DAY)) and is given no bars for it returns
//   out.need = [{ key, symbol, ms }]: the page loads those bars through the chart and runs it again.
//
// Model: every bar runs the statements top to bottom (bar 0 .. n-1). Each def keeps its value per bar, so x[1] reads the
// bar before. A def that reads its own past (def count = count[1] + 1) is recursive: before the first bar that past is 0.
// Reading the future (close[-1]) or whole-chart values (HighestAll) needs a second pass; the first pass fills the histories.
import { parse } from './parser.js?v=1213';
import { TsError } from './lexer.js?v=1213';
import { NATIVES, NS_LC, NS_NAMES, CONSTS, BAR_FIELDS, UNSUPPORTED, AGG, AVG_TYPES, COLOR, PALETTE, num, truth, text, isColor, colorOf, allOf, crossAt } from './natives.js?v=1213';
import { LIBRARY } from './library.js?v=1213';

export const LIMITS = { source: 256 * 1024, bars: 50000, ops: 4e8, foldIter: 20000, vars: 4000, instances: 400, depth: 12, labels: 40, bubbles: 2000, vlines: 500, plots: 64, ms: 20000, cells: 2.5e7, text: 10000 };
const SOURCES = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4', 'volume'];
const PLOT_METHODS = ['setpaintingstrategy', 'setdefaultcolor', 'assignvaluecolor', 'setlineweight', 'setstyle', 'hide', 'sethiding', 'hidebubble', 'hidetitle', 'showbubble', 'definecolor', 'assignnormgradientcolor', 'assigngradientcolor', 'takevaluecolor', 'color'];
const DECLARES = ['lower', 'upper', 'on_volume', 'once_per_bar', 'hide_on_intraday', 'hide_on_daily', 'real_size', 'zerobase', 'weak_volume_graph', 'fullrange', 'all_for_one', 'scan'];
const AGG_NAMES = Object.keys(AGG);

// ---------- history (one per def, plot and buffered expression) ----------
class Hist {
  constructor(rec) { this.h = []; this.prev = null; this.rec = !!rec; }
  read(c, i) {
    if (i < 0) return this.rec ? 0 : NaN;
    if (i > c.I && this.prev) { const v = this.prev[i]; return v === undefined ? NaN : v; }
    const v = this.h[i]; return v === undefined ? NaN : v;
  }
  readPrev(i) { const v = this.prev ? this.prev[i] : undefined; return v === undefined ? NaN : v; }
}

// ---------- did you mean ----------
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function suggest(k, pool) {
  let best = null, bd = 3;
  for (const p of pool) { const d = lev(k, p.toLowerCase()); if (d < bd) { bd = d; best = p; } }
  return best && k.length > 2 ? 'Did you mean "' + best + '"?' : '';
}
// proper names for messages and the Docs tab
export const DISPLAY = {};
('AbsValue ACos ASin ATan Ceil Cos Exp Floor Lg Log Sign Sin Sqr Sqrt Tan IsNaN IsInfinite Max Min Power Round RoundDown RoundUp Random Between ' +
 'Average SimpleMovingAverage ExpAverage WMA WildersAverage HullAverage MovingAverage Highest Lowest Sum StDev LinDev Median Inertia ' +
 'LinearRegressionSlope Correlation Covariance IsAscending IsDescending GetMaxValueOffset GetMinValueOffset TrueRange GetValue CompoundValue Crosses ' +
 'HighestAll LowestAll TotalSum StDevAll InertiaAll BarsSince ValueWhen SarValue BarNumber GetTime GetDay GetYYYYMMDD GetYear GetMonth GetWeek GetLastDay ' +
 'GetLastYYYYMMDD GetLastMonth GetLastYear GetDayOfWeek GetDayOfMonth DaysFromDate DaysTillDate CountTradingDays SecondsFromTime SecondsTillTime ' +
 'RegularTradingStart RegularTradingEnd GetAggregationPeriod GetSymbol GetSymbolPart TickSize TickValue IsRealtime Concat AsText AsPrice AsDollars AsPercent ' +
 'CreateColor GetColor GlobalColor AddLabel AddChartBubble AddVerticalLine AddCloud AssignPriceColor Alert DefineGlobalColor If ' +
 'open high low close volume hl2 hlc3 ohlc4').split(' ').forEach((n) => { DISPLAY[n.toLowerCase()] = n; });

// ---------- compile ----------
// mode 'analyze': inputs read for the settings dialog only; mode 'run': inputs bound to the member's values, closures built.
function build(source, opts, mode) {
  if (typeof source !== 'string') throw new TsError('The script must be text.', 1, 1);
  if (source.length > LIMITS.source) throw new TsError('This script is longer than 256 KB.', 1, 1);
  const ast = parse(source);
  const bars = opts.bars || { time: [], open: [], high: [], low: [], close: [], volume: [] };
  const n = bars.time.length;
  const c = {
    I: 0, n, bars, pass: 0, sites: [], hists: [], symbol: String(opts.symbol || ''), tfMs: +opts.tfMs || 6e4, futuresDay: !!opts.futuresDay, utcDay: !!opts.utcDay,
    tick: +opts.tick || 0.01, dp: undefined, globalColors: {}, L: LIMITS, ops: 0, deadline: opts.deadline || Date.now() + LIMITS.ms,
    out: null, notes: new Set(), seed: 1, needPasses: 1, secs: new Map(), need: []
  };
  c.note = (t) => { if (c.notes.size < 10) c.notes.add(t); };
  c.rand = () => { c.seed = (c.seed * 1664525 + 1013904223) >>> 0; return c.seed / 4294967296; };
  const tick = () => { if ((++c.ops & 1023) === 0) { if (Date.now() > c.deadline) throw new TsError('The script took longer than ' + Math.round(LIMITS.ms / 1000) + ' seconds and was stopped.', 1, 1, 'Look for a fold that runs too many times.'); if (c.ops > LIMITS.ops) throw new TsError('The script did too much work and was stopped.', 1, 1); } };
  // memory: every history holds one number per bar, so the budget is histories x bars (about 200 MB at most)
  const newHist = (rec) => { const h = new Hist(rec); c.hists.push(h); if (c.hists.length > LIMITS.vars * 4 || c.hists.length * Math.max(n, 1) > LIMITS.cells) throw new TsError('The script uses too much memory for this many bars.', 1, 1, 'Use fewer studies or a shorter history.'); return h; };
  const site = () => { const k = c.sites.length; c.sites.push(null); return () => c.sites[k] || (c.sites[k] = {}); };
  const meta = { lower: false, inputs: [], plots: [], declares: [], uses: { htf: [] }, hideIntraday: false, hideDaily: false };
  const userScripts = new Map();
  for (const st of ast) if (st.s === 'script') {
    if (userScripts.has(st.k)) throw new TsError('A script called "' + st.name + '" is already defined.', st.line, st.col);
    userScripts.set(st.k, st);
  }
  const libAst = new Map();
  const libOf = (k) => {
    if (!LIBRARY[k]) return null;
    if (!libAst.has(k)) libAst.set(k, parse(LIBRARY[k])[0]);
    return libAst.get(k);
  };
  let instances = 0;

  // ---------- nodes ----------
  // node = { ev() value now, ser?(i) value at bar i, cst? constant, htf? { key, get(j), map }, en? enum options, kind? }
  const K = (v) => ({ ev: () => v, cst: v });
  const field = (f) => {
    const g = fieldGetter(bars, f, n);
    return { ev: () => g(c.I), ser: g, field: f };
  };
  // value + series getter for any node (a buffer fills on every evaluation of the owner)
  // rec(): evaluate now AND record the value (one evaluation per bar, so nesting never doubles the work)
  function series(node) {
    if (node.ser) return { fill: null, rec: node.ev, get: node.ser, prev: node.hist ? (i) => node.hist.readPrev(i) : node.ser };
    const h = newHist(false);
    return { fill: () => { h.h[c.I] = node.ev(); }, rec: () => (h.h[c.I] = node.ev()), get: (i) => h.read(c, i), prev: (i) => h.readPrev(i) };
  }

  function scope(parent) { return { vars: new Map(), parent }; }
  function lookup(sc, k) { for (let s = sc; s; s = s.parent) if (s.vars.has(k)) return s.vars.get(k); return null; }
  function namePool(sc) {
    const p = Object.values(DISPLAY).concat(Object.keys(LIBRARY).map((k) => /script\s+(\w+)/.exec(LIBRARY[k])[1]), Object.values(NS_NAMES), [...userScripts.values()].map((s) => s.name));
    for (let s = sc; s; s = s.parent) for (const v of s.vars.values()) if (v.name) p.push(v.name);
    return p;
  }

  // ---------- expressions ----------
  function expr(e, sc, inst) {
    switch (e.n) {
      case 'num': return Object.assign(K(e.v), { int: e.int });
      case 'str': return K(e.v);
      case 'enum': throw new TsError('A list of options in { } can only be an input default.', e.line, e.col);
      case 'id': return ident(e, sc, inst);
      case 'mem': return member(e, sc, inst);
      case 'call': return call(e, sc, inst, null);
      case 'idx': return index(e, sc, inst);
      case 'un': {
        const a = expr(e.a, sc, inst);
        if (e.op === '-') return a.cst !== undefined && typeof a.cst === 'number' ? K(-a.cst) : { ev: () => -num(a.ev()) };
        return { ev: () => (truth(a.ev()) ? 0 : 1) };
      }
      case 'bin': return binary(e, sc, inst);
      case 'if': {
        const q = expr(e.c, sc, inst), a = expr(e.a, sc, inst), b = expr(e.b, sc, inst);
        // both branches run on every bar (series semantics), so averages inside either branch keep a full history
        return { ev: () => { const x = q.ev(), y = a.ev(), z = b.ev(); return truth(x) ? y : z; }, en: a.en || b.en };
      }
      case 'cross': {
        const a = series(expr(e.a, sc, inst)), b = series(expr(e.b, sc, inst));
        return { ev: () => { if (a.fill) a.fill(); if (b.fill) b.fill(); return crossAt(a.get, b.get, c.I, e.dir); } };
      }
      case 'fold': return fold(e, sc, inst);
    }
    throw new TsError('This value is not supported.', e.line, e.col);
  }
  function binary(e, sc, inst) {
    const a = expr(e.a, sc, inst), b = expr(e.b, sc, inst), op = e.op;
    const lc = (v) => String(v).toLowerCase();
    switch (op) {
      case '+': return { ev: () => {
        const x = a.ev(), y = b.ev();
        if (typeof x !== 'string' && typeof y !== 'string') return num(x) + num(y);
        const r = text(x) + text(y);
        if (r.length > LIMITS.text) throw new TsError('This text is longer than ' + LIMITS.text + ' characters.', e.line, e.col);
        return r;
      } };
      case '-': return { ev: () => num(a.ev()) - num(b.ev()) };
      case '*': return { ev: () => num(a.ev()) * num(b.ev()) };
      case '/': return { ev: () => { const y = num(b.ev()); return y === 0 ? NaN : num(a.ev()) / y; } };
      case '%': return { ev: () => { const y = num(b.ev()); return y === 0 ? NaN : num(a.ev()) % y; } };
      case 'and': return { ev: () => { const x = truth(a.ev()), y = truth(b.ev()); return x && y ? 1 : 0; } };
      case 'or': return { ev: () => { const x = truth(a.ev()), y = truth(b.ev()); return x || y ? 1 : 0; } };
      case '==': case '!=': return { ev: () => {
        const x = a.ev(), y = b.ev();
        let eq;
        if (typeof x === 'string' || typeof y === 'string') eq = lc(x) === lc(y);
        else if (isColor(x) || isColor(y)) eq = isColor(x) && isColor(y) && x.rgb === y.rgb;
        else { const p = num(x), q = num(y); if (p !== p || q !== q) return 0; eq = p === q; }
        return (op === '==') === eq ? 1 : 0;
      } };
      default: return { ev: () => {
        const p = num(a.ev()), q = num(b.ev());
        if (p !== p || q !== q) return 0;
        return (op === '<' ? p < q : op === '>' ? p > q : op === '<=' ? p <= q : p >= q) ? 1 : 0;
      } };
    }
  }
  function ident(e, sc, inst) {
    const k = e.k;
    const b = lookup(sc, k);
    if (b) {
      if (b.t === 'var') {
        const h = b.hist;
        if (b.building) h.rec = true;   // the def reads its own past: recursive (0 before the first bar)
        return { ev: () => h.read(c, c.I), ser: (i) => h.read(c, i), hist: h, en: b.en };
      }
      if (b.t === 'node') return b.node;
      if (b.t === 'loop') return { ev: () => b.v };
    }
    if (BAR_FIELDS.includes(k)) return field(k);
    if (k in CONSTS) return K(CONSTS[k]);
    if (NATIVES[k] && !NATIVES[k].p.length) return call({ n: 'call', fn: e, args: [], line: e.line, col: e.col }, sc, inst, null);
    if (NS_LC[k]) throw new TsError('"' + e.name + '" needs a member after it, for example ' + NS_NAMES[k] + '.' + Object.keys(NS_LC[k])[0].toUpperCase() + '.', e.line, e.col);
    if (UNSUPPORTED[k]) throw new TsError(UNSUPPORTED[k], e.line, e.col);
    if (userScripts.has(k) || LIBRARY[k]) return call({ n: 'call', fn: e, args: [], line: e.line, col: e.col }, sc, inst, null);
    throw new TsError('Unknown name "' + e.name + '".', e.line, e.col, suggest(k, namePool(sc)) || 'Define it first with def ' + e.name + ' = ...;');
  }
  function member(e, sc, inst) {
    const o = e.obj;
    if (o.n === 'call') return call(o, sc, inst, e);
    if (o.n === 'id') {
      const ns = NS_LC[o.k];
      if (ns && !lookup(sc, o.k)) {
        if (!(e.k in ns)) throw new TsError(NS_NAMES[o.k] + ' has no member "' + e.name + '".', e.line, e.col, suggest(e.k, Object.keys(ns)) || 'Members: ' + Object.keys(ns).slice(0, 12).join(', ').toUpperCase());
        return K(ns[e.k]);
      }
      const b = lookup(sc, o.k);
      const en = b && (b.en || (b.t === 'node' && b.node.en));
      if (en) {
        const hit = en.find((x) => x.toLowerCase() === e.k);
        if (hit === undefined) throw new TsError('"' + o.name + '" has no option "' + e.name + '".', e.line, e.col, 'Options: ' + en.join(', '));
        return K(hit);
      }
      if (b && b.plot) {
        if (e.k === 'color' || e.k === 'takevaluecolor') throw new TsError('Write it with brackets: ' + o.name + '.' + e.name + '().', e.line, e.col);
      }
    }
    // a study's plot without brackets: RSI.RSI is RSI().RSI
    if (o.n === 'id' && (userScripts.has(o.k) || LIBRARY[o.k])) return call({ n: 'call', fn: o, args: [], line: o.line, col: o.col }, sc, inst, e);
    throw new TsError('"' + (o.name || 'This value') + '" has no member "' + e.name + '".', e.line, e.col);
  }
  function index(e, sc, inst) {
    const base = expr(e.e, sc, inst), off = expr(e.off, sc, inst);
    const k = off.cst;
    if (k !== undefined && typeof k !== 'number') throw new TsError('The value inside [ ] must be a number of bars.', e.off.line, e.off.col);
    if (k === undefined || k < 0) c.needPasses = 2;   // the future (or a moving offset): needs the first pass's values
    if (base.htf) {
      const H = base.htf, o = k !== undefined ? () => Math.trunc(k) : () => Math.trunc(num(off.ev()));
      const get = (j) => H.get(j - o());
      return { ev: () => get(H.map()[c.I]), ser: (i) => get(H.map()[i]), htf: { key: H.key, get, map: H.map } };
    }
    const s = series(base);
    if (k !== undefined) { const kk = Math.trunc(k); return { ev: () => { if (s.fill) s.fill(); return s.get(c.I - kk); }, ser: s.fill ? null : (i) => s.get(i - kk), hist: null }; }
    return { ev: () => { if (s.fill) s.fill(); const o = Math.trunc(num(off.ev())); return o === o ? s.get(c.I - o) : NaN; } };
  }
  function fold(e, sc, inst) {
    const from = expr(e.from, sc, inst), to = expr(e.to, sc, inst);
    const init = e.init ? expr(e.init, sc, inst) : K(0);
    const inner = scope(sc);
    const iv = { t: 'loop', v: 0, name: e.v }, av = { t: 'loop', v: 0, name: e.acc };
    inner.vars.set(e.v, iv);
    if (e.acc) inner.vars.set(e.acc, av);
    const body = expr(e.body, inner, inst), wh = e.wh ? expr(e.wh, inner, inst) : null;
    return { ev: () => {
      let a = Math.trunc(num(from.ev())), b = Math.trunc(num(to.ev()));
      av.v = init.ev();
      if (a !== a || b !== b) return NaN;
      const step = b >= a ? 1 : -1;
      if (Math.abs(b - a) > LIMITS.foldIter) throw new TsError('This fold runs ' + Math.abs(b - a) + ' times on one bar (limit ' + LIMITS.foldIter + ').', e.line, e.col);
      for (let i = a; i !== b; i += step) {
        tick();
        iv.v = i;
        if (wh && !truth(wh.ev())) break;
        av.v = body.ev();
      }
      return av.v;
    } };
  }

  // ---------- calls ----------
  function bindArgs(e, params, what) {
    const P = params.map((x) => x.toLowerCase()), out = new Array(P.length).fill(undefined);
    let pos = 0;
    for (const a of e.args) {
      if (a.name) {
        const j = P.indexOf(a.name);
        if (j < 0) throw new TsError(what + ' has no input called "' + a.name + '".', a.line, a.col, P.length ? 'Its inputs: ' + params.join(', ') + '.' : '');
        out[j] = a.e;
      } else {
        if (pos >= P.length) throw new TsError(what + ' takes ' + P.length + ' value' + (P.length === 1 ? '' : 's') + ' but was given more.', a.line, a.col, P.length ? 'Its inputs: ' + params.join(', ') + '.' : '');
        out[pos++] = a.e;
      }
    }
    return out;
  }
  function call(e, sc, inst, pick) {
    const fn = e.fn;
    if (fn.n === 'mem') return methodValue(e, sc, inst, pick);
    const k = fn.k, name = fn.name;
    if (pick && !(userScripts.has(k) || LIBRARY[k])) throw new TsError('"' + name + '" gives one value; it has no plot called "' + pick.name + '".', pick.line, pick.col);
    if (BAR_FIELDS.includes(k)) return otherSeries(e, sc, inst);
    if (userScripts.has(k)) return instance(userScripts.get(k), e, sc, inst, pick, name);
    if (NATIVES[k]) return native(NATIVES[k], k, e, sc, inst);
    if (LIBRARY[k]) return instance(libOf(k), e, sc, inst, pick, name);
    if (k === 'if') {
      if (e.args.length !== 3) throw new TsError('If(condition, a, b) takes three values.', e.line, e.col);
      return expr({ n: 'if', c: e.args[0].e, a: e.args[1].e, b: e.args[2].e, line: e.line, col: e.col }, sc, inst);
    }
    if (UNSUPPORTED[k]) throw new TsError(UNSUPPORTED[k], e.line, e.col);
    throw new TsError('Unknown function "' + name + '".', fn.line, fn.col, suggest(k, namePool(sc)));
  }
  function native(N, k, e, sc, inst) {
    const what = DISPLAY[k] || k;
    if (N.stmt) throw new TsError(what + ' draws on the chart; write it on its own line: ' + what + '(...);', e.line, e.col);
    const raw = bindArgs(e, N.p, what);
    const args = raw.map((a, j) => {
      if (a) return expr(a, sc, inst);
      const dk = N.p[j].toLowerCase();
      if (dk in N.d) return K(N.d[dk]);
      throw new TsError(what + ' needs a value for "' + N.p[j] + '".', e.line, e.col, 'Write it as ' + what + '(' + N.p.join(', ') + ').');
    });
    const S = N.s.map((j) => series(args[j]));
    const st = site();
    const vals = new Array(args.length);
    const isS = new Set(N.s);
    // all series inputs on one other timeframe: the function runs on that timeframe's bars (20 days, not 20 chart bars)
    const htfKey = N.s.length && N.s.every((j) => args[j].htf) && N.s.every((j) => args[j].htf.key === args[N.s[0]].htf.key) && !N.all ? args[N.s[0]].htf : null;
    if (htfKey) {
      const H = htfKey;
      const calc = () => {
        const s = st();
        if (s.arr) return s.arr;
        const sec = c.secs.get(H.key), m = sec && sec.bars ? sec.bars.time.length : 0;
        const arr = new Float64Array(m).fill(NaN);
        const sub = Object.assign({}, c, { bars: sec ? sec.bars : c.bars, n: m });
        const subSt = {};
        const G = N.s.map((j) => args[j].htf.get);
        for (let j = 0; j < args.length; j++) vals[j] = isS.has(j) ? NaN : args[j].ev();
        for (let jj = 0; jj < m; jj++) {
          tick();
          sub.I = jj;
          N.s.forEach((j, q) => { vals[j] = G[q](jj); });
          arr[jj] = num(N.f(sub, vals, G, subSt));
        }
        s.arr = arr;
        return arr;
      };
      const get = (j) => { const a = calc(); return j >= 0 && j < a.length ? a[j] : NaN; };
      return { ev: () => get(H.map()[c.I]), ser: (i) => get(H.map()[i]), htf: { key: H.key, get, map: H.map } };
    }
    if (N.all) {
      c.needPasses = 2;
      const s0 = S[0];
      return { ev: () => {
        if (s0.fill) s0.fill();
        if (c.pass === 0) return NaN;
        const s = st();
        if (s.v === undefined) s.v = allOf(N.all, s0.prev, c.n);
        return s.v;
      } };
    }
    const G = S.map((s) => s.get);
    const evs = args.map((x, j) => (isS.has(j) ? S[N.s.indexOf(j)].rec : x.ev));
    return { ev: () => {
      for (let j = 0; j < evs.length; j++) vals[j] = evs[j]();
      return N.f(c, vals, G, st());
    }, en: k === 'compoundvalue' ? (args[1].en || args[2].en) : undefined };
  }
  // close(period = AggregationPeriod.DAY), high("SPY"), volume(period = "WEEK")
  function otherSeries(e, sc, inst) {
    const f = e.fn.k;
    const raw = bindArgs(e, ['symbol', 'period', 'priceType'], DISPLAY[f] || f);
    const val = (a, d) => { if (!a) return d; const x = expr(a, sc, inst); if (x.cst === undefined) throw new TsError('The symbol and period must be fixed values or inputs.', a.line, a.col); return x.cst; };
    let sym = val(raw[0], ''), ms = val(raw[1], 0);
    if (raw[2]) { const pt = val(raw[2], 'LAST'); if (String(pt).toUpperCase() !== 'LAST') c.note('Only the last traded price is available; priceType is ignored.'); }
    if (typeof ms === 'string') { const m = AGG[ms.toUpperCase()]; if (!m) throw new TsError('Unknown period "' + ms + '".', raw[1].line, raw[1].col, 'Use AggregationPeriod.DAY, AggregationPeriod.HOUR ...'); ms = m; }
    sym = String(sym || '').trim();
    if (!ms) ms = c.tfMs;
    const chartSym = !sym || sym.toLowerCase() === c.symbol.toLowerCase() || sym.toLowerCase() === tickerOf(c.symbol).toLowerCase();
    if (chartSym && ms === c.tfMs) return field(f);
    if (ms < c.tfMs && mode === 'run') throw new TsError('The period is shorter than the chart\'s timeframe. Use the chart\'s timeframe or a longer one.', e.line, e.col);
    const key = (chartSym ? '' : sym.toUpperCase()) + '|' + ms;
    meta.uses.htf.push({ key, symbol: chartSym ? '' : sym.toUpperCase(), ms });
    if (!c.secs.has(key)) {
      const given = opts.securities && opts.securities[key];
      const sb = given && Array.isArray(given.time) ? given : null;
      if (!sb && mode === 'run') c.need.push({ key, symbol: chartSym ? '' : sym.toUpperCase(), ms });
      c.secs.set(key, { bars: sb, map: null });
    }
    const S = c.secs.get(key);
    const map = () => {
      if (S.map) return S.map;
      const m = new Int32Array(n).fill(-1), T = S.bars ? S.bars.time : [];
      let j = -1;
      for (let i = 0; i < n; i++) { while (j + 1 < T.length && T[j + 1] <= bars.time[i]) j++; m[i] = j; }
      return (S.map = m);
    };
    const g = S.bars ? fieldGetter(S.bars, f, S.bars.time.length) : () => NaN;
    return { ev: () => g(map()[c.I]), ser: (i) => g(map()[i]), htf: { key, get: g, map } };
  }
  // x.Color("Up"), x.TakeValueColor()
  function methodValue(e, sc, inst) {
    const o = e.fn.obj, m = e.fn.k;
    const b = o.n === 'id' ? lookup(sc, o.k) : null;
    if (!b || !b.plot) throw new TsError('"' + (o.name || 'This') + '.' + e.fn.name + '()" is not a value. Only plots have colours.', e.line, e.col);
    const P = b.plot;
    if (m === 'color') {
      const a = e.args[0] ? expr(e.args[0].e, sc, inst) : K('default');
      return { ev: () => P.named[String(a.ev()).toLowerCase()] || COLOR.GRAY };
    }
    if (m === 'takevaluecolor') return { ev: () => { const v = P.colors && P.colors[c.I]; return v ? { rgb: v } : P.color; } };
    throw new TsError('"' + e.fn.name + '" is a plot setting; write it on its own line: ' + o.name + '.' + e.fn.name + '(...);', e.line, e.col);
  }
  // a script{} or built-in study used as a function: a fresh copy that runs once per bar
  function instance(def, e, sc, inst, pick, name) {
    if (++instances > LIMITS.instances) throw new TsError('The script calls studies too many times.', e.line, e.col);
    const depth = (inst ? inst.depth : 0) + 1;
    if (depth > LIMITS.depth) throw new TsError('"' + name + '" calls itself (or other studies) too deeply.', e.line, e.col);
    const inputs = def.body.filter((s) => s.s === 'input');
    const raw = bindArgs(e, inputs.map((s) => s.name), name);
    const isc = scope(null);
    const me = { depth, steps: [], last: -1, pass: -1, plots: [], name };
    inputs.forEach((s, j) => {
      const a = raw[j];
      const en = s.e.n === 'enum' ? s.e.vals : enumOfDefault(s.e);
      if (a) {
        const node = expr(a, sc, inst);
        if (en && node.cst !== undefined && typeof node.cst === 'string' && !en.some((x) => x.toLowerCase() === node.cst.toLowerCase()))
          throw new TsError('"' + node.cst + '" is not an option of ' + s.name + '.', a.line, a.col, 'Options: ' + en.join(', '));
        isc.vars.set(s.k, { t: 'node', node: en ? Object.assign({}, node, { en }) : node, name: s.name, en });
      } else isc.vars.set(s.k, { t: 'node', node: defaultNode(s.e, isc), name: s.name, en });
    });
    block(def.body.filter((s) => s.s !== 'input'), isc, me, me.steps, false);
    if (!me.plots.length) throw new TsError('"' + name + '" has no plot to give back.', e.line, e.col);
    let P = me.plots[0];
    if (pick) {
      P = me.plots.find((p) => p.k === pick.k);
      if (!P) throw new TsError('"' + name + '" has no plot called "' + pick.name + '".', pick.line, pick.col, 'Its plots: ' + me.plots.map((p) => p.name).join(', ') + '.');
    }
    const runTo = () => {
      if (me.pass !== c.pass) { me.pass = c.pass; me.last = -1; }
      if (me.last === c.I) return;
      me.last = c.I;
      for (const s of me.steps) s();
    };
    const h = P.hist;
    return { ev: () => { runTo(); return h.read(c, c.I); }, ser: (i) => { if (i >= c.I) runTo(); return h.read(c, i); }, hist: h };
  }
  function enumOfDefault(e) {
    if (e.n === 'mem' && e.obj.n === 'id' && e.obj.k === 'averagetype') return AVG_TYPES.slice();
    if (e.n === 'mem' && e.obj.n === 'id' && e.obj.k === 'aggregationperiod') return null;
    return null;
  }
  function defaultNode(e, sc) {
    if (e.n === 'enum') return Object.assign(K(e.def), { en: e.vals });
    const node = expr(e, sc, null);
    const en = enumOfDefault(e);
    return en ? Object.assign({}, node, { en }) : node;
  }

  // ---------- statements ----------
  // top: true for the study itself (drawing functions, inputs and plots go to the chart)
  function block(list, sc, inst, steps, top) {
    for (const s of list) stmt(s, sc, inst, steps, top);
  }
  function declareVar(s, sc) {
    if (sc.vars.has(s.k) && sc.vars.get(s.k).t !== 'loop') throw new TsError('"' + s.name + '" is already defined.', s.line, s.col, 'Give it another name, or assign it without def.');
    if (BAR_FIELDS.includes(s.k) || NS_LC[s.k] || s.k in CONSTS) throw new TsError('"' + s.name + '" is a built-in name.', s.line, s.col, 'Give it another name.');
    if (c.hists.length > LIMITS.vars) throw new TsError('The script defines too many values.', s.line, s.col);
    const b = { t: 'var', name: s.name, hist: newHist(false), building: true, line: s.line };
    sc.vars.set(s.k, b);
    return b;
  }
  function stmt(s, sc, inst, steps, top) {
    switch (s.s) {
      case 'empty': case 'script': return;
      case 'declare': {
        if (s.v === 'strategy') throw new TsError('Strategies (declare strategy, AddOrder) are not supported on TradeZoro. Use plots, labels and alerts instead.', s.line, s.col);
        if (!inst) {
          meta.declares.push(s.v);
          if (s.v === 'lower' || s.v === 'on_volume') meta.lower = true;
          if (s.v === 'upper') meta.lower = false;
          if (s.v === 'hide_on_intraday') meta.hideIntraday = true;
          if (s.v === 'hide_on_daily') meta.hideDaily = true;
          if (!DECLARES.includes(s.v)) c.note('"declare ' + s.v + '" has no effect on TradeZoro.');
        }
        return;
      }
      case 'input': {
        if (!top) throw new TsError('Inputs belong at the top level of the study.', s.line, s.col);
        if (sc.vars.has(s.k)) throw new TsError('"' + s.name + '" is already defined.', s.line, s.col);
        const d = inputMeta(s, sc);
        const id = meta.inputs.length;
        meta.inputs.push(d);
        const given = opts.inputs ? opts.inputs[String(id)] : undefined;
        const v = resolveInput(d, given);
        let node;
        if (d.type === 'source') node = field(v);
        else if (d.agg) node = K(AGG[v] || AGG[d.defval]);
        else node = K(v);
        if (d.options && d.type === 'string') node = Object.assign({}, node, { en: d.options });
        sc.vars.set(s.k, { t: 'node', node, name: s.name, en: d.options && d.type === 'string' ? d.options : null });
        return;
      }
      case 'def': case 'plot': {
        const b = declareVar(s, sc);
        let P = null;
        if (s.s === 'plot') {
          P = plotOf(s, inst, top);
          b.plot = P; P.hist = b.hist;
        }
        if (!s.e) { b.open = true; b.building = false; steps.push(() => { b.hist.h[c.I] = NaN; }); return; }
        if (s.e.n === 'enum') throw new TsError('A list of options in { } can only be an input default.', s.e.line, s.e.col);
        const node = expr(s.e, sc, inst);
        b.building = false;
        if (s.s === 'plot' && typeof node.cst === 'string' && !node.en) throw new TsError('A plot needs a number, not text.', s.e.line, s.e.col, 'Show text with AddLabel or AddChartBubble.');
        if (node.en) b.en = node.en;
        const h = b.hist;
        steps.push(() => { tick(); h.h[c.I] = node.ev(); });
        return;
      }
      case 'assign': {
        const b = lookup(sc, s.k);
        if (!b) throw new TsError('Unknown name "' + s.name + '".', s.line, s.col, 'Declare it first: def ' + s.name + ';');
        if (b.t !== 'var') throw new TsError('"' + s.name + '" cannot be changed.', s.line, s.col);
        if (!b.open) throw new TsError('"' + s.name + '" already has a value from its def.', s.line, s.col, 'Declare it without a value (def ' + s.name + ';) to assign it in if/else or switch.');
        b.building = true;
        const node = expr(s.e, sc, inst);
        b.building = false;
        const h = b.hist;
        steps.push(() => { tick(); h.h[c.I] = node.ev(); });
        return;
      }
      case 'if': {
        const q = expr(s.c, sc, inst), A = [], B = [];
        block(s.then, sc, inst, A, top);
        if (s.els) block(s.els, sc, inst, B, top);
        steps.push(() => { if (truth(q.ev())) { for (const f of A) f(); } else { for (const f of B) f(); } });
        return;
      }
      case 'switch': {
        const q = expr(s.subj, sc, inst);
        const cases = s.cases.map((cs) => { const L = []; block(cs.body, sc, inst, L, top); return { label: cs.label, L }; });
        if (q.en) for (const cs of s.cases) if (cs.label != null && !q.en.some((x) => x.toLowerCase() === cs.label)) throw new TsError('"' + cs.label + '" is not one of the options (' + q.en.join(', ') + ').', cs.line, cs.col);
        steps.push(() => {
          const v = String(q.ev()).toLowerCase();
          const hit = cases.find((x) => x.label === v) || cases.find((x) => x.label == null);
          if (hit) for (const f of hit.L) f();
        });
        return;
      }
      case 'method': return method(s, sc, inst, steps, top);
      case 'call': {
        const k = s.fn;
        if (UNSUPPORTED[k]) throw new TsError(UNSUPPORTED[k], s.line, s.col);
        const N = NATIVES[k];
        if (!N) {
          if (userScripts.has(k) || LIBRARY[k]) throw new TsError('"' + s.fnName + '(...)" gives a value; use it in a def or plot.', s.line, s.col, 'For example: plot r = ' + s.fnName + '(...);');
          throw new TsError('Unknown function "' + s.fnName + '".', s.line, s.col, suggest(k, namePool(sc)));
        }
        if (!N.stmt) throw new TsError('"' + (DISPLAY[k] || s.fnName) + '(...)" gives a value; use it in a def or plot.', s.line, s.col);
        if (!top && k !== 'defineglobalcolor') throw new TsError((DISPLAY[k] || s.fnName) + ' works only in the study itself, not inside a script { }.', s.line, s.col);
        const raw = bindArgs({ args: s.args }, N.p, DISPLAY[k]);
        const args = raw.map((a, j) => { if (a) return expr(a, sc, inst); const dk = N.p[j].toLowerCase(); if (dk in N.d) return K(N.d[dk]); throw new TsError((DISPLAY[k] || k) + ' needs a value for "' + N.p[j] + '".', s.line, s.col, 'Write it as ' + DISPLAY[k] + '(' + N.p.join(', ') + ').'); });
        const st = site(), vals = new Array(args.length);
        steps.push(() => { tick(); for (let j = 0; j < args.length; j++) vals[j] = args[j].ev(); if (c.out) N.f(c, vals, null, st()); });
        return;
      }
    }
    throw new TsError('This statement is not supported.', s.line, s.col);
  }
  function plotOf(s, inst, top) {
    const list = inst ? inst.plots : outPlots;
    if (list.some((p) => p.k === s.k)) throw new TsError('A plot called "' + s.name + '" already exists.', s.line, s.col);
    if (top && list.length >= LIMITS.plots) throw new TsError('A study can have at most ' + LIMITS.plots + ' plots.', s.line, s.col);
    const P = { name: s.name, k: s.k, color: PALETTE[list.length % 10], strategy: 'LINE', weight: 1, style: 'FIRM', hidden: false, colors: null, named: {}, values: null };
    list.push(P);
    if (top) meta.plots.push(s.name);
    return P;
  }
  function method(s, sc, inst, steps, top) {
    const b = lookup(sc, s.obj);
    if (!b) throw new TsError('Unknown name "' + s.objName + '".', s.line, s.col, suggest(s.obj, namePool(sc)));
    if (!b.plot) throw new TsError('"' + s.objName + '" is not a plot. Display settings such as ' + s.mName + ' work on plots.', s.line, s.col, 'Declare it with plot instead of def.');
    const P = b.plot, m = s.m;
    if (!PLOT_METHODS.includes(m)) throw new TsError('Plots have no setting "' + s.mName + '".', s.line, s.col, suggest(m, ['SetPaintingStrategy', 'SetDefaultColor', 'AssignValueColor', 'SetLineWeight', 'SetStyle', 'Hide', 'SetHiding', 'HideBubble', 'HideTitle', 'DefineColor']));
    if (m === 'assignnormgradientcolor' || m === 'assigngradientcolor') throw new TsError(UNSUPPORTED[m], s.line, s.col);
    if (m === 'color' || m === 'takevaluecolor') throw new TsError('"' + s.mName + '()" gives a colour; use it inside AssignValueColor or SetDefaultColor.', s.line, s.col);
    const args = s.args.map((a) => expr(a.e, sc, inst));
    const need = { setpaintingstrategy: 1, setdefaultcolor: 1, assignvaluecolor: 1, setlineweight: 1, setstyle: 1, sethiding: 1, definecolor: 2 }[m] || 0;
    if (args.length < need) throw new TsError(s.mName + ' needs ' + need + ' value' + (need > 1 ? 's' : '') + '.', s.line, s.col);
    const a0 = args[0], a1 = args[1];
    const colorIn = (v) => { const k = colorOf(v); if (!k) throw new TsError(s.mName + ' needs a colour, for example Color.GREEN.', s.line, s.col); return k; };
    if (m === 'setpaintingstrategy') {
      const v = a0.cst;
      if (typeof v !== 'string' || !NS_LC.paintingstrategy[v.toLowerCase()]) throw new TsError('SetPaintingStrategy needs a PaintingStrategy, for example PaintingStrategy.HISTOGRAM.', s.line, s.col);
    }
    if (m === 'setstyle' && (typeof a0.cst !== 'string' || !NS_LC.curve[a0.cst.toLowerCase()])) throw new TsError('SetStyle needs a Curve, for example Curve.SHORT_DASH.', s.line, s.col);
    const fns = {
      setpaintingstrategy: () => { P.strategy = String(a0.cst).toUpperCase(); },
      setdefaultcolor: () => { const k = colorIn(a0.ev()); if (k.rgb) P.color = k; },
      assignvaluecolor: () => { const k = colorIn(a0.ev()); if (!P.colors) P.colors = []; P.colors[c.I] = k.rgb || P.color.rgb; },
      setlineweight: () => { const w = Math.round(num(a0.ev())); P.weight = w >= 1 && w <= 5 ? w : 1; },
      setstyle: () => { P.style = String(a0.cst).toUpperCase(); },
      hide: () => { P.hidden = true; }, sethiding: () => { if (c.I === c.n - 1) P.hidden = truth(a0.ev()); },
      hidebubble: () => {}, hidetitle: () => {}, showbubble: () => {},
      definecolor: () => { P.named[String(a0.ev()).toLowerCase()] = colorIn(a1.ev()); }
    };
    const f = fns[m];
    if (m === 'definecolor') { f(); steps.push(f); return; }   // usable right away by SetDefaultColor(x.color("Up"))
    steps.push(f);
  }

  // ---------- inputs ----------
  function inputMeta(s) {
    const e = s.e, title = s.name;
    const key = String(meta.inputs.length);
    const lit = (x) => (x.n === 'un' && x.op === '-' && x.a.n === 'num' ? { n: 'num', v: -x.a.v, int: x.a.int } : x);
    const v = lit(e);
    if (v.n === 'num') return { key, title, type: v.int ? 'int' : 'float', defval: v.v, step: v.int ? 1 : 0.1 };
    if (v.n === 'str') return { key, title, type: 'string', defval: v.v };
    if (v.n === 'enum') return { key, title, type: 'string', defval: v.def, options: v.vals.slice(0, 100) };
    if (v.n === 'id' && (v.k === 'yes' || v.k === 'no' || v.k === 'true' || v.k === 'false')) return { key, title, type: 'bool', defval: v.k === 'yes' || v.k === 'true' };
    if (v.n === 'id' && BAR_FIELDS.includes(v.k)) return { key, title, type: 'source', defval: v.k, options: SOURCES };
    if (v.n === 'mem' && v.obj.n === 'id' && v.obj.k === 'averagetype' && NS_LC.averagetype[v.k]) return { key, title, type: 'string', defval: NS_LC.averagetype[v.k], options: AVG_TYPES.slice() };
    if (v.n === 'mem' && v.obj.n === 'id' && v.obj.k === 'aggregationperiod' && NS_LC.aggregationperiod[v.k]) return { key, title, type: 'string', defval: AGG_NAMES.find((x) => x.toLowerCase() === v.k), options: AGG_NAMES.slice(), agg: true };
    if (v.n === 'mem' && v.obj.n === 'id' && NS_LC[v.obj.k] && v.k in NS_LC[v.obj.k] && typeof NS_LC[v.obj.k][v.k] === 'string') {
      const all = Object.values(NS_LC[v.obj.k]).filter((x) => typeof x === 'string');
      return { key, title, type: 'string', defval: NS_LC[v.obj.k][v.k], options: all };
    }
    throw new TsError('An input default must be a number, yes/no, "text", a price such as close, or a list such as {default A, B}.', e.line, e.col);
  }

  const outPlots = [];
  const steps = [];
  const top = scope(null);
  block(ast, top, null, steps, true);
  return { c, meta, steps, outPlots, hists: c.hists };
}
function fieldGetter(b, f, n) {
  const O = b.open, H = b.high, L = b.low, C = b.close, V = b.volume;
  const ok = (i) => i >= 0 && i < n;
  switch (f) {
    case 'open': return (i) => (ok(i) ? O[i] : NaN);
    case 'high': return (i) => (ok(i) ? H[i] : NaN);
    case 'low': return (i) => (ok(i) ? L[i] : NaN);
    case 'close': return (i) => (ok(i) ? C[i] : NaN);
    case 'volume': return (i) => (ok(i) ? V[i] : NaN);
    case 'hl2': return (i) => (ok(i) ? (H[i] + L[i]) / 2 : NaN);
    case 'hlc3': return (i) => (ok(i) ? (H[i] + L[i] + C[i]) / 3 : NaN);
    case 'ohlc4': return (i) => (ok(i) ? (O[i] + H[i] + L[i] + C[i]) / 4 : NaN);
  }
  return () => NaN;
}
const tickerOf = (s) => String(s || '').replace(/^[a-z_]+:/i, '');
export function resolveInput(d, v) {
  switch (d.type) {
    case 'int': case 'float': { let x = typeof v === 'number' && Number.isFinite(v) ? v : d.defval; if (d.type === 'int') x = Math.trunc(x); return x; }
    case 'bool': return typeof v === 'boolean' ? (v ? 1 : 0) : (d.defval ? 1 : 0);
    case 'source': return typeof v === 'string' && SOURCES.includes(v) ? v : d.defval;
    default: {
      if (typeof v !== 'string' || v.length > 4096) return d.defval;
      if (d.options) { const hit = d.options.find((x) => x.toLowerCase() === v.toLowerCase()); return hit === undefined ? d.defval : hit; }
      return v;
    }
  }
}

const diag = (e) => ({ code: 'TS1', severity: 'error', line: e.line || 1, col: e.col || 1, message: String(e.message), hint: e.hint || '' });

export function analyze(source, opts) {
  try {
    const r = build(source, Object.assign({ bars: null }, opts || {}), 'analyze');
    const meta = r.meta;
    return { ok: true, diagnostics: [...r.c.notes].map((t) => ({ code: 'TS2', severity: 'warning', line: 1, col: 1, message: t, hint: '' })),
      meta: { lower: meta.lower, inputs: meta.inputs.map((d) => { const o = Object.assign({}, d); delete o.agg; return o; }), plots: meta.plots, declares: meta.declares, htf: meta.uses.htf, hideIntraday: meta.hideIntraday, hideDaily: meta.hideDaily } };
  } catch (e) {
    if (e && e.ts) return { ok: false, diagnostics: [diag(e)], meta: null };
    if (e instanceof RangeError) return { ok: false, diagnostics: [{ code: 'TS1', severity: 'error', line: 1, col: 1, message: 'The script is nested too deeply.', hint: '' }], meta: null };
    throw e;
  }
}

// ---------- run ----------
const ARROW = { ARROW_UP: ['shape', 'absolute', 'arrowup'], ARROW_DOWN: ['shape', 'absolute', 'arrowdown'], BOOLEAN_ARROW_UP: ['shape', 'belowbar', 'arrowup', true],
  BOOLEAN_ARROW_DOWN: ['shape', 'abovebar', 'arrowdown', true], BOOLEAN_POINTS: ['shape', 'abovebar', 'circle', true], BOOLEAN_WEDGE_UP: ['shape', 'belowbar', 'triangleup', true],
  BOOLEAN_WEDGE_DOWN: ['shape', 'abovebar', 'triangledown', true], TRIANGLES: ['shape', 'absolute', 'triangleup'], SQUARES: ['shape', 'absolute', 'square'] };
const KIND = { LINE: 'line', DASHES: 'line', HISTOGRAM: 'histogram', SQUARED_HISTOGRAM: 'columns', POINTS: 'circles', HORIZONTAL: 'stepline',
  LINE_VS_POINTS: 'line', LINE_VS_TRIANGLES: 'line', LINE_VS_SQUARES: 'line', VALUES_ABOVE: 'line', VALUES_BELOW: 'line' };
const STYLE = { FIRM: 'solid', LONG_DASH: 'dashed', MEDIUM_DASH: 'dashed', SHORT_DASH: 'dashed', POINTS: 'dotted' };
const hex8 = (rgb, a) => (typeof rgb === 'string' && /^#[0-9a-f]{6}$/i.test(rgb) ? rgb.toLowerCase() + (a || 'ff') : null);
const lum = (rgb) => { const x = parseInt(rgb.slice(1, 7), 16); return (0.299 * (x >> 16) + 0.587 * ((x >> 8) & 255) + 0.114 * (x & 255)) / 255; };

export function execute(source, opts) {
  const t0 = Date.now();
  const fail = (e) => ({ ok: false, error: diag(e), plots: [], hlines: [], fills: [], labels: [], lines: [], boxes: [], tables: [], alerts: [], tsAlerts: [], notices: [], bars: 0, ms: Date.now() - t0 });
  let r;
  try {
    const b = opts && opts.bars;
    if (!b || !b.time || typeof b.time.length !== 'number') throw new TsError('No bars to run on.', 1, 1);
    if (b.time.length > LIMITS.bars) throw new TsError('Too many bars (limit ' + LIMITS.bars + ').', 1, 1);
    r = build(source, opts, 'run');
    const { c, steps, outPlots } = r;
    if (c.need.length) return { ok: true, need: c.need, plots: [], hlines: [], fills: [], labels: [], lines: [], boxes: [], tables: [], alerts: [], tsAlerts: [], notices: [], bars: 0, ms: Date.now() - t0 };
    for (c.pass = 0; c.pass < c.needPasses; c.pass++) {
      if (c.pass > 0) { for (const h of c.hists) { h.prev = h.h; h.h = []; } c.sites = c.sites.map(() => null); outPlots.forEach((p) => { p.colors = null; }); c.globalColors = {}; c.seed = 1; }
      c.out = c.pass === c.needPasses - 1 ? { labels: [], bubbles: [], vlines: [], clouds: [], barColors: [], alerts: [] } : null;
      for (c.I = 0; c.I < c.n; c.I++) for (const f of steps) f();
    }
    return output(r, opts, Date.now() - t0);
  } catch (e) {
    if (e && e.ts) return fail(e);
    if (e instanceof RangeError) return fail(new TsError('The script is nested too deeply or uses too much memory.', 1, 1));
    throw e;
  }
}

// Output in the shape the chart's indicator model reader already takes (assets/chart-zscript.js toModel), plus tsAlerts.
function output(r, opts, ms) {
  const { c, outPlots, meta } = r, n = c.n, o = c.out;
  const plots = [], fills = [], tables = [], labels = [], lines = [];
  const hide = (meta.hideIntraday && c.tfMs < 864e5) || (meta.hideDaily && c.tfMs >= 864e5);
  let id = 0;
  outPlots.forEach((P) => {
    const vals = new Float64Array(n);
    for (let i = 0; i < n; i++) { const v = P.hist.h[i]; vals[i] = typeof v === 'number' && Number.isFinite(v) ? v : NaN; }
    const base = hex8(P.color.rgb) || '#00b8d9ff';
    const colors = P.colors ? Array.from({ length: n }, (_, i) => hex8(P.colors[i]) || base) : null;
    const A = ARROW[P.strategy];
    const display = P.hidden || hide ? 'none' : 'all';
    if (A) {
      const v2 = new Float64Array(n);
      for (let i = 0; i < n; i++) v2[i] = A[3] ? (vals[i] === vals[i] && vals[i] !== 0 ? 1 : NaN) : vals[i];
      plots.push({ id: id++, kind: A[0], location: A[1], style: A[2], title: P.name, values: v2, color: base, colors, size: 'small', display });
      return;
    }
    const kind = KIND[P.strategy] || 'line';
    const p = { id: id++, kind, title: P.name, values: vals, color: base, colors, linewidth: P.weight, display, lineStyle: P.strategy === 'DASHES' ? 'dashed' : STYLE[P.style] || 'solid' };
    if (kind === 'histogram' || kind === 'columns') p.histbase = 0;
    plots.push(p);
  });
  o.clouds.forEach((cl, k) => {
    const a = id++, b = id++;
    plots.push({ id: a, kind: 'line', title: 'Cloud ' + (k + 1) + ' A', values: Float64Array.from(cl.a, (x) => (Number.isFinite(x) ? x : NaN)), color: '#00000000', display: 'none' });
    plots.push({ id: b, kind: 'line', title: 'Cloud ' + (k + 1) + ' B', values: Float64Array.from(cl.b, (x) => (Number.isFinite(x) ? x : NaN)), color: '#00000000', display: 'none' });
    const up = hex8(cl.up, '40') || '#f5d90a40', dn = hex8(cl.dn, '40') || '#e5484d40';
    fills.push({ id: k, a, b, between: 'plot', colors: Array.from({ length: n }, (_, i) => (cl.a[i] >= cl.b[i] ? up : dn)) });
  });
  if (o.barColors.length && !hide) {
    const vals = new Float64Array(n).fill(NaN), colors = new Array(n);
    for (let i = 0; i < n; i++) if (o.barColors[i]) { vals[i] = 1; colors[i] = hex8(o.barColors[i]); }
    plots.push({ id: id++, kind: 'barcolor', title: 'Price colour', values: vals, colors, color: '#8b8d98ff', display: 'all' });
  }
  if (o.labels.length && !hide) {
    tables.push({ id: 0, position: 'top_left', columns: o.labels.length, rows: 1, cells: o.labels.map((l, k) => ({ r: 0, c: k, text: l.text, bgcolor: hex8(l.color), text_color: lum(l.color) > 0.6 ? '#111114ff' : '#ffffffff', text_size: 'small' })) });
  }
  o.bubbles.forEach((bb, k) => labels.push({ id: k, xloc: 'bar_time', x: c.bars.time[bb.i], y: bb.y, yloc: 'price', text: bb.text, style: bb.up ? 'label_down' : 'label_up', color: hex8(bb.color), textcolor: lum(bb.color) > 0.6 ? '#111114ff' : '#ffffffff', size: 'small' }));
  o.vlines.forEach((v, k) => {
    const t = c.bars.time[v.i], y = c.bars.close[v.i];
    lines.push({ id: k, xloc: 'bar_time', x1: t, y1: y, x2: t, y2: y + Math.max(1e-9, Math.abs(y) * 1e-3), extend: 'both', color: hex8(v.color, 'b3'), width: 1, style: v.stroke === 'FIRM' ? 'solid' : v.stroke === 'POINTS' ? 'dotted' : 'dashed' });
    if (v.text) labels.push({ id: 100000 + k, xloc: 'bar_time', x: t, y: c.bars.high[v.i], yloc: 'abovebar', text: v.text, style: 'none', color: '#00000000', textcolor: hex8(v.color), size: 'small', textalign: 'left' });
  });
  return { ok: true, plots, hlines: [], fills, labels, lines, boxes: [], tables, alerts: [], alertconditions: [], tsAlerts: o.alerts, lower: meta.lower,
    notices: [...c.notes], bars: n, ms, time: n ? c.bars.time[n - 1] : null };
}
