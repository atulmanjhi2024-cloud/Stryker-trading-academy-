// TradeZoro MQL5 engine: one running indicator (the "R" every compiled closure and built-in sees).
// Pure apart from the clock functions passed in. Used by the sandboxed worker (assets/mq5/worker.js) and the node tests.
//
// const ind = new Indicator(source, { inputs, symbol, ticker, period, tfSec, point, digits, now, perf, customs, chart });
// ind.meta                      -> { title, separate, inputs, plots, buffers, levels, form }   (compile-time facts)
// ind.calc(bars, mode)          -> output    bars = { time[], open[], high[], low[], close[], tick_volume[], volume[], spread[] } (time in seconds)
//                                             mode 'full' (history changed), 'tick' (same bars, last one changed), 'append' (new bars at the end)
// ind.timer()  ind.event(id, lparam, dparam, sparam)  ind.objectState(name, props)  ind.deinit(reason)
// output = { ok, plots: [...], levels, props, objects?, comment, prints[], alerts[], notices[], ms } or { ok:false, error }.
import { compileProgram, Ref } from './compiler.js?v=1250';
import { MArr, rtErr, LIMITS, MqRuntimeError, hexOf } from './runtime.js?v=1250';
import { MqError } from './lexer.js?v=1250';
import { EMPTY_VALUE, ENUMS } from './consts.js?v=1250';
import { tfEnumOf, handleData } from './builtins.js?v=1250';

const DRAW_BUFS = { 0: 1, 1: 1, 2: 1, 3: 1, 4: 2, 5: 1, 6: 2, 7: 2, 8: 2, 9: 2, 10: 2, 11: 3, 12: 2, 13: 3, 14: 4, 15: 4, 16: 5, 17: 5 };
const COLOR_TYPES = new Set([8, 9, 10, 11, 12, 13, 16, 17]);
const DRAW_NAMES = Object.fromEntries(ENUMS.ENUM_DRAW_TYPE.map(([n, v]) => [v, n]));
const FIELDS = ['time', 'open', 'high', 'low', 'close', 'tick_volume', 'volume', 'spread'];
const TIMER_MIN = 100;

export function diagOf(e) {
  if (e instanceof MqError) return { code: e.code, line: e.line, col: e.col, severity: 'error', message: e.message, hint: e.hint || '' };
  if (e instanceof MqRuntimeError) return { code: e.code, line: e.line || 1, col: 1, severity: 'error', message: e.message + ' The indicator stopped.', hint: '' };
  if (e instanceof RangeError) return { code: 'E405', line: 1, col: 1, severity: 'error', message: 'The script ran out of stack (a function calls itself too deeply). The indicator stopped.', hint: '' };
  return { code: 'E499', line: 1, col: 1, severity: 'error', message: 'Internal engine error: ' + String((e && e.message) || e).slice(0, 200), hint: '' };
}

export class Indicator {
  constructor(source, env) {
    env = env || {};
    this.env = env;
    this.G = [];
    this.ops = LIMITS.opsPerSlice; this.depth = 0; this.mem = 0; this.seed = 1; this.lastError = 0; this.uninitReason = 0;
    this.symbol = env.symbol || 'SYMBOL'; this.ticker = env.ticker || this.symbol; this.tfSec = env.tfSec || 60;
    this.period = env.period || tfEnumOf(this.tfSec); this.point = env.point || 0.01; this.digits = env.digits == null ? 2 : env.digits;
    this.now = env.now || (() => Date.now()); this.perf = env.perf || (() => this.now());
    this.bars = emptyBars(); this.barsVer = 0; this.aggs = new Map(); this.warned = new Set();
    this.handles = []; this.objects = new Map(); this.objDirty = false; this.redraw = false; this.comment = '';
    this.chart = Object.assign({ w: 800, h: 400, subH: 160, visible: 100, first: 99, x0: 780, barW: 8, pmin: 0, pmax: 1, dark: true }, env.chart || {});
    this.chartI = new Map(); this.mouseMove = false; this.gv = new Map(); this.font = null;
    this.timerMs = 0; this.custQ = []; this.childCount = 0;
    this.prints = []; this.alerts = []; this.notices = []; this.lastAlert = -1e12;
    this.buffers = []; this.plots = []; this.ind = { shortname: '', digits: null, levels: [], min: null, max: null, levelColor: null, levelStyle: 2, levelWidth: 1 };
    this.prev = 0; this.calcArrs = null; this.priceArr = null; this.deadline = Infinity; this.dead = null;
    this.C = compileProgram(source, this);
    this.applyProps();
    this.meta = this.buildMeta();
  }
  // ---------- budget ----------
  slice(line) {
    this.ops = LIMITS.opsPerSlice;
    if (this.perf() > this.deadline) throw rtErr('The script took longer than ' + Math.round(this.budgetMs / 1000) + ' seconds and was stopped.', line, 'E401');
  }
  guard(ms, fn) {
    this.budgetMs = ms; this.deadline = this.perf() + ms; this.ops = LIMITS.opsPerSlice; this.depth = 0;
    try { return fn(); } finally { this.deadline = Infinity; }
  }
  // ---------- #property ----------
  applyProps() {
    const P = this.C.properties();
    const at = (re) => P.filter((p) => re.test(p.name));
    this.separate = P.some((p) => p.name === 'indicator_separate_window');
    this.nBuffers = +((P.find((p) => p.name === 'indicator_buffers') || {}).value || 0);
    this.nPlots = +((P.find((p) => p.name === 'indicator_plots') || {}).value || 0);
    if (this.nBuffers > 512 || this.nPlots > 512) throw new MqError('E350', 'An indicator can have at most 512 buffers and plots.', 1, 1);
    const pp = (k, i) => { const x = P.find((p) => p.name === k + i); return x ? x.value : undefined; };
    for (let i = 0; i < this.nPlots; i++) {
      const n = i + 1, type = pp('indicator_type', n), col = pp('indicator_color', n);
      this.plots.push({
        type: type == null ? 1 : type,
        colors: col == null ? [[0x2196F3, 0xF39621, 0x50AF4C, 0x3643F4, 0xB0279C][i % 5]] : Array.isArray(col) ? col : [col],
        style: pp('indicator_style', n) || 0, width: pp('indicator_width', n) || 1, label: pp('indicator_label', n) == null ? '' : String(pp('indicator_label', n)),
        empty: EMPTY_VALUE, begin: 0, shift: 0, arrow: 159, arrowShift: 0, show: true, nColors: null,
      });
    }
    for (const p of at(/^indicator_level\d+$/)) this.ind.levels[+p.name.slice(15) - 1] = { v: +p.value, text: '' };
    const lc = P.find((p) => p.name === 'indicator_levelcolor'); if (lc) this.ind.levelColor = lc.value;
    const ls = P.find((p) => p.name === 'indicator_levelstyle'); if (ls) this.ind.levelStyle = ls.value;
    const lw = P.find((p) => p.name === 'indicator_levelwidth'); if (lw) this.ind.levelWidth = lw.value;
    const mn = P.find((p) => p.name === 'indicator_minimum'); if (mn) this.ind.min = +mn.value;
    const mx = P.find((p) => p.name === 'indicator_maximum'); if (mx) this.ind.max = +mx.value;
    const dg = P.find((p) => p.name === 'indicator_digits'); if (dg) this.ind.digits = dg.value;
    const sn = P.find((p) => p.name === 'indicator_shortname'); if (sn) this.ind.shortname = String(sn.value);
    this.props = P;
  }
  buildMeta() {
    const C = this.C, P = this.props;
    const desc = (P.find((p) => p.name === 'description') || {}).value;
    const inputs = C.inputs.map((i) => Object.assign({}, i));
    if (C.calcForm === 'price') inputs.push({ key: '__applied', title: 'Apply to', group: 'Data', type: 'string', options: ENUMS.ENUM_APPLIED_PRICE.map((m) => m[0]), display: { options: Object.fromEntries(ENUMS.ENUM_APPLIED_PRICE.map((m) => [m[0], m[2]])) }, defval: 'PRICE_CLOSE' });
    return {
      title: '', separate: this.separate, form: C.calcForm, inputs, description: desc ? String(desc).slice(0, 300) : '',
      plots: this.plots.map((p) => ({ type: DRAW_NAMES[p.type] || 'DRAW_LINE', label: p.label })), buffers: this.nBuffers,
      timer: !!C.onTimer, events: !!C.onEvent, uses: [...C.uses],
    };
  }
  // ---------- built-in hooks ----------
  bindBuffer(i, a, type, line) {
    if (!(i >= 0 && i < Math.max(this.nBuffers, 1) && i < 512)) throw rtErr('SetIndexBuffer: buffer ' + i + ' is outside #property indicator_buffers ' + this.nBuffers + '.', line, 'E407');
    if (a.inner.length) throw rtErr('SetIndexBuffer needs a one-dimensional double array.', line, 'E407');
    if (!a.dyn) throw rtErr('SetIndexBuffer needs a dynamic array (declare it as double name[];).', line, 'E407');
    const old = this.buffers[i];
    if (old && old.arr !== a) old.arr.buf = null;
    a.buf = { i, type: type | 0 };
    this.buffers[i] = { arr: a, type: type | 0 };
    if (this.bars.time.length) this.sizeBuffer(this.buffers[i], this.bars.time.length);
    return true;
  }
  sizeBuffer(b, n) {
    const a = b.arr, have = a.d.length;
    if (have === n) return;
    const fill = b.type === 0 ? EMPTY_VALUE : 0;
    a.buf = null;
    if (n < have) a.resize(n); else { const sv = a.def; a.def = fill; a.resize(n); a.def = sv; }
    a.buf = { i: b.arr === a ? this.buffers.indexOf(b) : 0, type: b.type };
  }
  indSet(kind, p, m, v) {
    const I = this.ind;
    if (kind === 's') { if (p === 0) I.shortname = String(v).slice(0, 80); else if (p === 1) { I.levels[m] = I.levels[m] || { v: 0, text: '' }; I.levels[m].text = String(v).slice(0, 60); } return true; }
    if (kind === 'd') { if (p === 0) I.min = v; else if (p === 1) I.max = v; else if (p === 2) { I.levels[m] = I.levels[m] || { v: 0, text: '' }; I.levels[m].v = v; } return true; }
    switch (p) {
      case 0: I.digits = v; break;
      case 2: I.levels.length = Math.max(0, Math.min(32, v | 0)); for (let k = 0; k < I.levels.length; k++) if (!I.levels[k]) I.levels[k] = { v: 0, text: '' }; break;
      case 3: if (m) { I.levels[m] = I.levels[m] || { v: 0, text: '' }; I.levels[m].color = v; } else I.levelColor = v; break;
      case 4: I.levelStyle = v; break;
      case 5: I.levelWidth = v; break;
      default: break;
    }
    return true;
  }
  plotSet(i, kind, p, m, v, line) {
    const P = this.plots[i];
    if (!P) { if (i >= 0 && i < 512 && i >= this.plots.length) { this.lastError = 4003; return false; } return false; }
    if (kind === 's') { P.label = String(v).slice(0, 200); return true; }
    if (kind === 'd') { P.empty = v; return true; }
    switch (p) {
      case 0: P.arrow = v; break; case 1: P.arrowShift = v; break; case 2: P.begin = Math.max(0, v | 0); break;
      case 3: if (DRAW_BUFS[v] === undefined) return false; P.type = v; break; case 4: P.show = !!v; break; case 5: P.shift = v | 0; break;
      case 6: P.style = v; break; case 7: P.width = Math.max(1, Math.min(10, v | 0)); break; case 8: P.nColors = Math.max(1, Math.min(64, v | 0)); break;
      case 9: if (m >= 0 && m < 64) P.colors[m] = v >>> 0; break;
      default: break;
    }
    return true;
  }
  plotGet(i, p, m) { const P = this.plots[i]; if (!P) return 0; return { 0: P.arrow, 1: P.arrowShift, 2: P.begin, 3: P.type, 4: +P.show, 5: P.shift, 6: P.style, 7: P.width, 8: P.nColors || P.colors.length, 9: P.colors[m] || 0 }[p] || 0; }
  print(s) { if (this.prints.length < LIMITS.maxPrints) this.prints.push(String(s).slice(0, 2000)); else if (this.prints.length === LIMITS.maxPrints) this.prints.push('(more lines were left out)'); }
  alert(text) {
    const t = this.now();
    if (t - this.lastAlert < 2000) return;   // shortcut: one alert every 2 s per indicator, so a loop cannot flood the page
    this.lastAlert = t;
    this.alerts.push({ text: text == null ? '' : text, time: Math.floor(t / 1000) });
  }
  notice(t) { if (this.notices.length < 5) this.notices.push(String(t).slice(0, 300)); }
  setTimer(ms) { ms = ms | 0; this.timerMs = ms <= 0 ? 0 : Math.max(TIMER_MIN, ms); return true; }
  custEvent(id, lp, dp, sp) { if (this.custQ.length < 64) this.custQ.push([id, lp, dp, String(sp)]); return true; }
  custom(line, sym, tf, name, params, types) {
    const src = this.env.customs && this.env.customs.get ? this.env.customs.get(String(name)) : undefined;
    if (src === undefined) { if (!this.warned.has('ic' + name)) { this.warned.add('ic' + name); this.notice('iCustom: "' + name + '" is not in My scripts (MQL5). Save that indicator under this exact name first.'); } this.lastError = 4802; return -1; }
    if ((this.env.depth || 0) >= 3) throw rtErr('iCustom indicators call each other too deeply (limit 3 levels).', line, 'E408');
    if (++this.childCount > 8) throw rtErr('Too many iCustom indicators (limit 8 per indicator).', line, 'E408');
    let child;
    try {
      child = new Indicator(src, Object.assign({}, this.env, { depth: (this.env.depth || 0) + 1, inputs: {}, chart: this.chart }));
      const keys = child.C.inputs.filter((x) => !x.sinput);
      const inp = {};
      params.forEach((v, k) => { const d = keys[k]; if (!d) return; inp[d.key] = d.type === 'color' ? hexOf(v) : d.enumType ? (child.C.types.get(d.enumType).members.get(v) || d.defval) : d.type === 'time' ? v * 1000 : v; });
      child = new Indicator(src, Object.assign({}, this.env, { depth: (this.env.depth || 0) + 1, inputs: inp, chart: this.chart }));
    } catch (e) { if (e instanceof MqError) throw rtErr('iCustom "' + name + '" did not compile: line ' + e.line + ': ' + e.message, line, 'E408'); throw e; }
    const self = this;
    this.handles.push({ name: 'iCustom', sym, tf, nbuf: Math.max(1, child.nBuffers), compute: (b) => {
      const sv = [self.deadline, self.budgetMs];
      child.deadline = self.deadline; child.budgetMs = self.budgetMs;
      const out = child.runCalc(b, 'full', true);
      self.deadline = sv[0];
      if (!out.ok) throw rtErr('iCustom "' + name + '" stopped: ' + out.error.message, line, 'E408');
      return child.buffers.map((x) => (x ? Float64Array.from(x.arr.d, (v) => (v === EMPTY_VALUE ? NaN : v)) : new Float64Array(b.time.length).fill(NaN)));
    } });
    return this.handles.length - 1 + 10;
  }
  // ---------- lifecycle ----------
  init() {
    const C = this.C;
    this.G.length = 0;
    for (const f of C.inits) f();
    if (C.onInit) {
      const r = C.invoker(C.onInit)([]);
      if (C.onInit.ret.n !== 'void' && r !== 0 && r !== undefined) {
        const why = r === 32767 ? 'The inputs are not valid (OnInit returned INIT_PARAMETERS_INCORRECT).' : 'OnInit returned ' + r + ', so the indicator did not start.';
        throw Object.assign(rtErr(why, C.onInit.line, 'E409'), { initFail: true });
      }
    }
    this.inited = true;
  }
  // bars: plain arrays (oldest first); full = history replaced
  setBars(b, mode) {
    const n = b.time.length;
    if (mode === 'full' || !this.calcArrs) this.prev = 0;
    this.bars = b; this.barsVer++;
    if (!this.calcArrs) {
      this.calcArrs = FIELDS.map(() => { const a = new MArr(null, 0, false, [], 0); a.ro = true; a.series = true; return a; });
      this.priceArr = new MArr(null, 0, false, [], 0); this.priceArr.ro = true; this.priceArr.series = true;
    }
    FIELDS.forEach((f, k) => { this.calcArrs[k].d = b[f]; });
    if (this.C.calcForm === 'price') {
      const code = ENUMS.ENUM_APPLIED_PRICE.find((m) => m[0] === (this.env.inputs && this.env.inputs.__applied)) || ENUMS.ENUM_APPLIED_PRICE[0];
      const ap = code[1], o = new Array(n);
      for (let i = 0; i < n; i++) { const H = b.high[i], L = b.low[i], C = b.close[i]; o[i] = ap === 2 ? b.open[i] : ap === 3 ? H : ap === 4 ? L : ap === 5 ? (H + L) / 2 : ap === 6 ? (H + L + C) / 3 : ap === 7 ? (H + L + 2 * C) / 4 : C; }
      this.priceArr.d = o;
    }
    if (mode === 'full') for (const x of this.buffers) if (x) { x.arr.buf = null; x.arr.resize(0); }
    for (const x of this.buffers) if (x) this.sizeBuffer(x, n);
  }
  runCalc(bars, mode, quiet) {
    const t0 = this.perf();
    try {
      if (this.dead) return { ok: false, error: this.dead };
      this.guard(LIMITS.calcMs, () => {
        if (!this.inited) this.init();
        this.setBars(bars, mode);
        const C = this.C, n = bars.time.length;
        const args = C.calcForm === 'full'
          ? [n, this.prev].concat(this.calcArrs)
          : [n, this.prev, 0, this.priceArr];
        const r = C.invoker(C.calc)(args);
        this.prev = Math.max(0, Math.min(n, r | 0));
        this.drainCustom();
      });
      return quiet ? { ok: true } : this.output(t0, mode === 'full');
    } catch (e) { return this.die(e); }
  }
  calc(bars, mode) { return this.runCalc(bars, mode || 'full'); }
  die(e) {
    if (!(e instanceof MqError || e instanceof MqRuntimeError || e instanceof RangeError)) console.warn('mq5 engine', e);
    const d = diagOf(e);
    if (!(e && e.initFail)) this.dead = d;
    this.timerMs = 0;
    return { ok: false, error: d, prints: this.flushPrints(), timer: 0 };
  }
  timer() {
    if (this.dead || !this.C.onTimer || !this.inited) return null;
    const t0 = this.perf();
    try { this.guard(LIMITS.eventMs, () => { this.C.invoker(this.C.onTimer)([]); this.drainCustom(); }); return this.output(t0, false); }
    catch (e) { return this.die(e); }
  }
  event(id, lp, dp, sp) {
    if (this.dead || !this.C.onEvent || !this.inited) return null;
    if (id === 10 && !this.mouseMove) return null;
    const t0 = this.perf();
    try {
      this.guard(LIMITS.eventMs, () => {
        const ref = (v) => { const c = [v]; return new Ref(() => c[0], () => { throw rtErr('An OnChartEvent parameter is read-only.', this.C.onEvent.line); }); };
        this.C.invoker(this.C.onEvent)([id | 0, ref(Math.trunc(+lp || 0)), ref(+dp || 0), ref(String(sp || '').slice(0, 512))]);
        this.drainCustom();
      });
      return this.output(t0, false);
    } catch (e) { return this.die(e); }
  }
  drainCustom() {
    let k = 0;
    while (this.custQ.length && k++ < 64 && this.C.onEvent) { const [id, lp, dp, sp] = this.custQ.shift(); const ref = (v) => { const c = [v]; return new Ref(() => c[0], () => {}); }; this.C.invoker(this.C.onEvent)([id, ref(lp), ref(dp), ref(sp)]); }
    this.custQ.length = 0;
  }
  // the page changed an object (button pressed, edit typed in, label dragged): write it before the event runs
  objectState(name, props) {
    const o = this.objects.get(String(name));
    if (!o || !props) return;
    if (props.state !== undefined) o.i.set(31, props.state ? 1 : 0);
    if (props.text !== undefined) o.s.set(201, String(props.text).slice(0, 2000));
    if (props.x !== undefined) o.i.set(26, props.x | 0);
    if (props.y !== undefined) o.i.set(27, props.y | 0);
    if (props.price !== undefined) o.prices[0] = +props.price;
    if (props.time !== undefined) o.times[0] = Math.trunc(+props.time);
    this.objDirty = true;
  }
  setChart(c) { Object.assign(this.chart, c || {}); }
  deinit(reason) {
    if (this.dead || !this.inited || !this.C.onDeinit) return;
    this.uninitReason = reason | 0;
    try { this.guard(LIMITS.eventMs, () => this.C.invoker(this.C.onDeinit)(this.C.onDeinit.params.length ? [reason | 0] : [])); } catch (e) { /* the indicator is going away */ }
  }
  flushPrints() { const p = this.prints; this.prints = []; return p; }
  // ---------- output ----------
  output(t0, full) {
    const out = { ok: true, full: !!full, title: this.ind.shortname, plots: this.plotOut(), levels: this.levelsOut(), range: this.ind.min != null || this.ind.max != null ? { min: this.ind.min, max: this.ind.max } : null,
      digits: this.ind.digits, comment: this.comment, prints: this.flushPrints(), alerts: this.alerts.splice(0), notices: this.notices.splice(0), timer: this.timerMs, ms: Math.round(this.perf() - t0) };
    if (this.objDirty || full) { out.objects = this.objectsOut(); this.objDirty = false; }
    if (this.recalc) { out.recalc = true; this.recalc = false; }
    return out;
  }
  plotOut() {
    const bufs = this.buffers.filter((b) => b && b.type !== 2);
    let k = 0;
    const out = [];
    for (let i = 0; i < this.plots.length; i++) {
      const P = this.plots[i], need = DRAW_BUFS[P.type] || 1;
      const mine = bufs.slice(k, k + need); k += need;
      if (mine.length < need) break;
      const isColor = COLOR_TYPES.has(P.type);
      const data = (isColor ? mine.slice(0, need - 1) : mine).map((b) => Float64Array.from(b.arr.d));
      const ci = isColor ? Float64Array.from(mine[need - 1].arr.d) : null;
      out.push({ i, type: P.type, label: P.label, colors: P.colors.slice(0, P.nColors || 64).map((c) => hexOf(c)), width: P.width, style: P.style, empty: P.empty, begin: P.begin, shift: P.shift, arrow: P.arrow, arrowShift: P.arrowShift, show: P.show, data, ci });
    }
    return out;
  }
  levelsOut() {
    const I = this.ind;
    return I.levels.filter(Boolean).map((l) => ({ v: l.v, text: l.text || '', color: hexOf(l.color != null ? l.color : I.levelColor != null ? I.levelColor : 0xC0C0C0), style: I.levelStyle, width: I.levelWidth }));
  }
  objectsOut() {
    const out = [];
    for (const o of this.objects.values()) {
      out.push({ name: o.name, type: o.type, sub: o.sub, times: o.times.slice(0, 30), prices: o.prices.slice(0, 30), i: [...o.i], d: [...o.d], s: [...o.s] });
      if (out.length >= LIMITS.maxObjects) break;
    }
    return out;
  }
  // test helper: buffer i as plain numbers (EMPTY_VALUE kept)
  buffer(i) { const b = this.buffers[i]; return b ? b.arr.d.slice() : null; }
}
function emptyBars() { const o = {}; for (const f of FIELDS) o[f] = []; return o; }
export { handleData };
