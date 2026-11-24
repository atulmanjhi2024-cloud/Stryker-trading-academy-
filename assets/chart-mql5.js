// TradeZoro — Charts: MQL5 indicators pasted into the script editor (charts.html) — ES module
// Depends on: assets/chart-script-editor.js (editor panel layout); assets/chart-zscript.js (window.STRYKER_ZS.addLang: the
// language switch in the editor header); assets/zs-editor/editor.js (code editor, lang 'mql5') and store.js (makeStore);
// the MQL5 engine assets/mq5/ (runner.js -> worker.js), loaded on first use. vela-chart.js calls installMql5(Core, wsGetter)
// before the workspace is built and mountMql5(ws, opts) after mountZscript.
//
// WHAT IT IS: members paste an MQL5 indicator (the language of a popular desktop trading terminal) and it runs on the chart:
//   * a Vela engine for language id 'mql5' (MqEngine), registered for every chart cell;
//   * an "MQL5" tab in the script editor (Examples, My scripts, On chart, Docs);
//   * rows in the indicator window (assets/chart-indicator-window.js reads window.STRYKER_MQ5).
// Plots (DRAW_*) become chart series, levels become price lines, chart objects (lines, boxes, text, arrows) become
// chart drawings, and the on-screen objects (buttons, labels, edit boxes, rectangle labels) are DOM elements in a
// per-indicator layer over the chart pane, so they can be clicked; clicks, keys and drags go back to OnChartEvent.
// OnTimer runs at the interval the script set (EventSetTimer / EventSetMillisecondTimer), paused while the tab is hidden.
//
// SAFETY: the member's code never runs on the page. It is compiled to closures and run in assets/mq5/worker.js (module
// worker, no network, no storage, its own CSP; hard time and memory limits; runner.js kills a runaway worker). This file
// only turns the engine's plain-data output into Vela's model and DOM, re-validating every colour, number and string:
// text goes in with textContent, colours are rebuilt from numbers, fonts come from a short list, sizes are clamped and
// the layer is clipped to the chart pane. Trading, files, DLLs and web requests are compile errors in the engine.
//
// PERSISTENCE: cell-scope handler 'stryker.mql5' stores [{ name, source, inputs, hidden }] in the workspace state.

import { MQ5_EXAMPLES, MQ5_NEW } from './mq5/examples.js?v=1254';
import { makeStore } from './zs-editor/store.js?v=1254';
import { createShell, el, ib, ICONS, libRow, emptyState, renderDocs, descOf, ago, download, pickFile, fileName } from './chart-script-editor.js?v=1254';

const LANG = 'mql5';
const EXT_KEY = 'stryker.mql5';
const MAX_PER_CELL = 8;
const SRC_MAX = 65536;
const MAX_INPUTS = 200;
const Store = makeStore('mql5', false);

// An MQL5 indicator always has OnCalculate; Pine and Zscript sources never do (chart-pine.js pineHandles uses the same test).
export const isMql5 = (src) => typeof src === 'string' && !/^\s*\/\/@zscript\b/.test(src) && /\bOnCalculate\s*\(/.test(src);
export function titleOf(src){
  src = String(src || '');
  const sn = /INDICATOR_SHORTNAME\s*,\s*"([^"\n]{1,80})"/.exec(src);
  if (sn) return sn[1].trim();
  const box = /^\s*\/\/\|\s*([^|\n]{2,70}?)\s*\|\s*$/m.exec(src);
  if (box && !/^[-+=\s]+$/.test(box[1]) && !/copyright|https?:/i.test(box[1])) return box[1].trim();
  const d = /^\s*#property\s+description\s+"([^"\n]{1,60})/m.exec(src);
  return d ? d[1].trim() : 'MQL5 indicator';
}

// ---------- the engine (assets/mq5/runner.js), loaded on first use ----------
let engineP = null;
const RUNNER_URL = './mq5/runner.js?v=1254';
function engine(){
  if (!engineP) engineP = import(RUNNER_URL).catch(() => import(RUNNER_URL + '&retry=' + Date.now())).catch((e) => { engineP = null; throw e; });
  return engineP;
}
const engineDiag = (e) => ({ code: 'E000', line: 1, col: 1, severity: 'error', message: 'The MQL5 engine did not load.', hint: 'Press Retry or reload the page. Details: ' + String((e && e.message) || e || 'unknown error').slice(0, 200) });
let compiler = null;
async function compileIn(source){
  try { const { MqRunner } = await engine(); if (!compiler) compiler = new MqRunner(); return await compiler.compile(source); }
  catch (e) { if (compiler) { compiler.dispose(); compiler = null; } return { ok: false, diagnostics: [engineDiag(e)] }; }
}
let builtinsP = null;
export function loadBuiltins(){
  if (!builtinsP) builtinsP = import('./mq5/builtins.js?v=1254').then((m) => m.builtinList().map((b) => ({ name: b.name, kind: 'function', sig: b.sig, doc: (b.cat ? b.cat + '. ' : '') + (b.doc || '') }))).catch(() => []);
  return builtinsP;
}

const diagText = (d) => (d ? 'Line ' + (d.line || 1) + ':' + (d.col || 1) + ' ' + d.message + (d.hint ? ' ' + d.hint : '') : '');
function mqError(d){ const e = new Error(diagText(d)); e.diag = d; return e; }
const firstError = (list) => (list || []).find((d) => d && d.severity !== 'warning');

// ---------- small validated helpers ----------
const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (s, n) => (s == null ? '' : String(s).slice(0, n || 500));
const clampI = (v, lo, hi, d) => { const n = Math.round(+v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const okHex = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(c) ? c.toLowerCase() : null);
const withAlpha = (c, a) => (okHex(c) ? okHex(c).slice(0, 7) + a : null);
// MQL colour 0x00BBGGRR -> '#rrggbb'; clrNONE (0xFFFFFFFF) -> null
function bgr(v){
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const c = v >>> 0; if (c === 0xFFFFFFFF) return null;
  const h = (x) => (x < 16 ? '0' : '') + x.toString(16);
  return '#' + h(c & 255) + h((c >> 8) & 255) + h((c >> 16) & 255);
}
const LSTYLE = ['solid', 'dashed', 'dotted', 'dashed', 'dotted'];
const lineStyle = (s) => LSTYLE[clampI(s, 0, 4, 0)];
const width = (w) => clampI(w, 1, 10, 1);
const sizeOf = (pt) => { const n = +pt || 10; return n <= 7 ? 'tiny' : n <= 9 ? 'small' : n <= 12 ? 'normal' : n <= 16 ? 'large' : 'huge'; };
// Wingdings codes scripts use for arrows -> chart label shapes
const UP = new Set([233, 225, 221, 217, 241, 200, 199, 236, 228, 223, 246]), DOWN = new Set([234, 226, 222, 218, 242, 202, 238, 230, 224, 248]);
const shapeOf = (code) => (UP.has(code) ? 'arrowup' : DOWN.has(code) ? 'arrowdown' : code === 251 || code === 253 || code === 120 ? 'xcross' : code === 110 || code === 167 || code === 168 ? 'square' : code === 116 || code === 117 ? 'diamond' : code === 252 || code === 254 ? 'flag' : 'circle');

// ---------- engine output -> Vela indicator model ----------
const DRAW = { NONE: 0, LINE: 1, SECTION: 2, HIST: 3, HIST2: 4, ARROW: 5, ZIGZAG: 6, FILLING: 7, C_LINE: 8, C_SECTION: 9, C_HIST: 10, C_HIST2: 11, C_ARROW: 12, C_ZIGZAG: 13, BARS: 14, CANDLES: 15, C_BARS: 16, C_CANDLES: 17 };
const BASE = { 8: 1, 9: 2, 10: 3, 11: 4, 12: 5, 13: 6, 16: 14, 17: 15 };
const MAX_MARKS = 5000;

// values of one buffer with empties, draw-begin and NaN turned into null
function cleanVals(buf, p, n){
  const o = new Array(n), em = fin(p.empty), begin = clampI(p.begin, 0, 1e7, 0);
  for (let i = 0; i < n; i++) {
    const v = buf ? buf[i] : NaN;
    o[i] = i < begin || !Number.isFinite(v) || v === em || Math.abs(v) >= 1.7e308 ? null : v;
  }
  return o;
}
// DRAW_SECTION / ZIGZAG: straight segments between the bars that have a value (gaps bridged)
function bridge(vals){
  const o = vals.slice(); let last = -1;
  for (let i = 0; i < o.length; i++) {
    if (vals[i] == null) continue;
    if (last >= 0 && i - last > 1) for (let k = last + 1; k < i; k++) o[k] = vals[last] + (vals[i] - vals[last]) * (k - last) / (i - last);
    last = i;
  }
  return o;
}

export function toModel(out, bars, id, prepared, inputValues, objects, separate){
  out = out || {};
  const n = bars.time.length, T = (i) => bars.time[i];
  const step = n > 1 ? bars.time[n - 1] - bars.time[n - 2] : 60000;
  const series = [], fills = [], priceLines = [], lines = [], boxes = [], labels = [];
  let marks = 0;
  (Array.isArray(out.plots) ? out.plots.slice(0, 64) : []).forEach((p, pi) => {
    const type = BASE[p.type] || p.type, isColor = !!BASE[p.type];
    const colors = (Array.isArray(p.colors) ? p.colors : []).map(okHex);
    const c0 = colors[0] || '#2196f3';
    const ci = isColor && p.ci ? p.ci : null;
    const colorAt = (i) => (ci ? colors[clampI(ci[i], 0, 63, 0)] || c0 : c0);
    const off = clampI(p.shift, -5000, 5000, 0) * step;
    const title = str(p.label, 80).split(';')[0] || 'Plot ' + (pi + 1);
    const sid = id + ':p' + pi;
    const data = Array.isArray(p.data) ? p.data : [];
    const st = { color: c0, width: width(p.width), lineStyle: lineStyle(p.style) };
    const lineSeries = (vals, kind, sidX, ttl, hide) => {
      const points = new Array(n);
      for (let i = 0; i < n; i++) { const pt = { time: T(i) + off, value: vals[i] }; if (ci && vals[i] != null) pt.color = colorAt(i); points[i] = pt; }
      const s = { id: sidX, title: ttl, paneId: 'unrouted', kind, points, style: Object.assign({}, st), visible: !hide };
      if (kind === 'histogram') s.style.base = 0;
      series.push(s); return s;
    };
    if (type === DRAW.NONE) return;
    if (type === DRAW.LINE || type === DRAW.SECTION || type === DRAW.HIST) {
      let v = cleanVals(data[0], p, n);
      if (type === DRAW.SECTION) v = bridge(v);
      lineSeries(v, type === DRAW.HIST ? 'histogram' : 'line', sid, title);
    } else if (type === DRAW.ZIGZAG) {
      const a = cleanVals(data[0], p, n), b = cleanVals(data[1], p, n), z = new Array(n);
      let up = true;   // when both buffers hold a value, alternate so the line zigzags
      for (let i = 0; i < n; i++) { if (a[i] != null && b[i] != null) { z[i] = up ? a[i] : b[i]; up = !up; } else z[i] = a[i] != null ? a[i] : b[i]; }
      lineSeries(bridge(z), 'line', sid, title);
    } else if (type === DRAW.ARROW) {
      const v = cleanVals(data[0], p, n), shape = shapeOf(clampI(p.arrow, 0, 255, 159));
      const dy = clampI(p.arrowShift, -200, 200, 0);
      lineSeries(v, 'line', sid, title, true);   // hidden carrier: legend + data window value
      for (let i = 0; i < n && marks < MAX_MARKS; i++) {
        if (v[i] == null) continue;
        marks++;
        labels.push({ id: sid + ':a' + i, paneId: 'unrouted', xloc: 'bar_time', x: T(i) + off, y: v[i], yloc: 'price', text: '', style: shape, color: colorAt(i), textColor: colorAt(i), size: dy ? 'small' : 'small', textAlign: 'center', fontFamily: 'default' });
      }
    } else if (type === DRAW.FILLING) {
      const a = cleanVals(data[0], p, n), b = cleanVals(data[1], p, n);
      const sa = lineSeries(a, 'line', sid + 'a', title, false), sb = lineSeries(b, 'line', sid + 'b', title + ' 2', false);
      sa.style.color = sb.style.color = 'rgba(0,0,0,0)';
      const up = withAlpha(colors[0] || c0, '40'), dn = withAlpha(colors[1] || colors[0] || c0, '40');
      const fc = new Array(Math.max(0, n - 1));
      for (let k = 0; k < n - 1; k++) fc[k] = a[k + 1] == null || b[k + 1] == null ? null : a[k + 1] >= b[k + 1] ? up : dn;
      fills.push({ id: sid + ':f', paneId: 'unrouted', fromSeriesId: sa.id, toSeriesId: sb.id, colors: fc });
    } else if (type === DRAW.HIST2 || type === DRAW.BARS || type === DRAW.CANDLES) {
      const four = type !== DRAW.HIST2;
      const v = (four ? [0, 1, 2, 3] : [0, 1]).map((k) => cleanVals(data[k], p, n));
      const out2 = new Array(n), bc = new Array(n);
      const upC = type === DRAW.CANDLES && colors.length >= 3 ? colors[1] : c0, dnC = type === DRAW.CANDLES && colors.length >= 3 ? colors[2] : type === DRAW.CANDLES && colors.length === 2 ? colors[1] : c0;
      for (let i = 0; i < n; i++) {
        if (v.some((x) => x[i] == null)) { out2[i] = null; continue; }
        out2[i] = four ? { time: T(i) + off, open: v[0][i], high: v[1][i], low: v[2][i], close: v[3][i] }
          : { time: T(i) + off, open: v[0][i], close: v[1][i], high: Math.max(v[0][i], v[1][i]), low: Math.min(v[0][i], v[1][i]) };
        if (ci) bc[i] = { color: colorAt(i) };
      }
      const s = { id: sid, title, paneId: 'unrouted', kind: type === DRAW.BARS ? 'bar' : 'candle', bars: out2, style: { up: upC, down: dnC }, visible: true };
      if (ci) s.barColors = bc;
      series.push(s);
    }
  });
  // levels
  (Array.isArray(out.levels) ? out.levels.slice(0, 32) : []).forEach((l, k) => {
    const v = fin(l.v); if (v == null) return;
    priceLines.push({ id: id + ':lv' + k, paneId: 'unrouted', price: v, color: okHex(l.color) || '#787b86', lineStyle: lineStyle(l.style), width: width(l.width), title: str(l.text, 60) });
  });
  // indicator_minimum / indicator_maximum: hidden constant series so the scale always includes them
  if (out.range && n) ['min', 'max'].forEach((k) => {
    const v = fin(out.range[k]); if (v == null) return;
    series.push({ id: id + ':rg' + k, title: '', paneId: 'unrouted', kind: 'line', points: bars.time.map((t) => ({ time: t, value: v })), style: { color: 'rgba(0,0,0,0)', width: 1, lineStyle: 'solid' }, visible: true });
  });
  chartObjects(objects || [], bars, id, separate, { lines, boxes, labels });
  const meta = prepared.meta;
  const model = { id, title: str(out.title, 80) || meta.title, overlay: meta.overlay, paneHint: meta.overlay ? 'price' : 'new', series, fills, backgrounds: [], priceLines, lines, boxes, labels, polylines: [], linefills: [], tables: [],
    inputs: prepared.inputs, inputValues: Object.assign({}, defaultsOf(prepared.inputs), inputValues || {}) };
  if (n) model.anchorTime = bars.time[0];
  return model;
}

// ---------- chart objects ----------
const SCREEN = new Set([102, 103, 107, 110]);   // OBJ_LABEL, OBJ_BUTTON, OBJ_EDIT, OBJ_RECTANGLE_LABEL: the DOM layer
const propsOf = (o) => ({ i: new Map(Array.isArray(o.i) ? o.i : []), d: new Map(Array.isArray(o.d) ? o.d : []), s: new Map(Array.isArray(o.s) ? o.s : []) });
const ARROW_OBJ = { 21: 'triangleup', 22: 'triangledown', 23: 'arrowup', 24: 'arrowdown', 25: 'xcross', 26: 'flag', 29: 'arrowup', 30: 'arrowdown' };
function chartObjects(list, bars, id, separate, o){
  const n = bars.time.length; if (!n) return;
  const t0 = bars.time[0], t1 = bars.time[n - 1];
  list.slice(0, 2000).forEach((ob, k) => {
    if (!ob || SCREEN.has(ob.type)) return;
    const P = propsOf(ob);
    if (P.i.get(24) === -1) return;   // OBJPROP_TIMEFRAMES = OBJ_NO_PERIODS
    const ov = separate && !(ob.sub > 0) ? { overlay: true } : {};   // sub-window 0 = the price pane
    const col = bgr(P.i.get(0)) || '#ff0000';
    const t = (j) => { const v = fin((ob.times || [])[j]); return v == null || v <= 0 ? null : v * 1000; };
    const pr = (j) => fin((ob.prices || [])[j]);
    const oid = id + ':o' + k;
    const base = Object.assign({ id: oid, paneId: 'unrouted', xloc: 'bar_time' }, ov);
    switch (ob.type) {
      case 1: { const p = pr(0); if (p == null) return; o.lines.push(Object.assign({}, base, { x1: t0, y1: p, x2: t1, y2: p, extend: 'both', color: col, width: width(P.i.get(2)), style: lineStyle(P.i.get(1)), invisible: false })); return; }
      case 0: { const x = t(0); if (x == null) return; const p = fin(bars.close[n - 1]) || 0; o.lines.push(Object.assign({}, base, { x1: x, y1: p, x2: x, y2: p + 1, extend: 'both', color: col, width: width(P.i.get(2)), style: lineStyle(P.i.get(1)), invisible: false })); return; }
      case 2: case 108: {
        const x1 = t(0), x2 = t(1), y1 = pr(0), y2 = pr(1); if (x1 == null || x2 == null || y1 == null || y2 == null) return;
        const L = P.i.get(19) ? 1 : 0, R = P.i.get(20) ? 1 : 0;
        o.lines.push(Object.assign({}, base, { x1, y1, x2, y2, extend: L && R ? 'both' : L ? 'left' : R ? 'right' : 'none', color: col, width: width(P.i.get(2)), style: lineStyle(P.i.get(1)), invisible: false, arrowRight: ob.type === 108 }));
        return;
      }
      case 18: {
        const x1 = t(0), x2 = t(1), y1 = pr(0), y2 = pr(1); if (x1 == null || x2 == null || y1 == null || y2 == null) return;
        o.boxes.push(Object.assign({}, base, { left: Math.min(x1, x2), right: Math.max(x1, x2), top: Math.max(y1, y2), bottom: Math.min(y1, y2), extend: 'none',
          bgColor: P.i.get(5) ? withAlpha(col, '33') : undefined, borderColor: col, borderWidth: width(P.i.get(2)), borderStyle: lineStyle(P.i.get(1)),
          text: '', textSize: 'auto', hAlign: 'center', vAlign: 'center', wrap: false, fontFamily: 'default', bold: false, italic: false }));
        return;
      }
      case 101: {
        const x = t(0), y = pr(0); if (x == null || y == null) return;
        o.labels.push(Object.assign({}, base, { x, y, yloc: 'price', text: str(P.s.get(201), 300), style: 'none', color: col, textColor: col, size: sizeOf(P.i.get(18)), textAlign: 'left', tooltip: str(P.s.get(202), 300) || undefined, fontFamily: 'default' }));
        return;
      }
      default: {
        const shape = ob.type === 100 ? shapeOf(clampI(P.i.get(23), 0, 255, 159)) : ARROW_OBJ[ob.type];
        if (!shape) return;   // other object types (Fibonacci, channels, Gann ...) are kept by the engine but not drawn
        const x = t(0), y = pr(0); if (x == null || y == null) return;
        o.labels.push(Object.assign({}, base, { x, y, yloc: 'price', text: '', style: shape, color: col, textColor: col, size: sizeOf(Math.max(8, (P.i.get(2) || 1) * 5)), textAlign: 'center', fontFamily: 'default' }));
      }
    }
  });
}

const defaultsOf = (inputs) => { const o = {}; (inputs || []).forEach((i) => { o[i.key] = i.defval; }); return o; };
const INPUT_TYPES = { int: 'int', float: 'float', bool: 'bool', string: 'string', color: 'color', time: 'time' };
function cleanInputs(list){
  return (Array.isArray(list) ? list.slice(0, MAX_INPUTS) : []).filter((i) => i && typeof i.key === 'string' && INPUT_TYPES[i.type]).map((i) => {
    const o = { key: i.key.slice(0, 64), title: str(i.title, 80) || i.key, type: INPUT_TYPES[i.type], defval: i.defval };
    if (o.type === 'color') o.defval = okHex(i.defval) ? i.defval.slice(0, 7) : '#2196f3';
    if (fin(i.min) != null) o.min = i.min;
    if (fin(i.max) != null) o.max = i.max;
    if (fin(i.step) != null) o.step = i.step;
    if (Array.isArray(i.options) && i.options.length) {
      o.options = i.options.slice(0, 100).map(String);
      if (i.display && i.display.options) { const lab = {}; o.options.forEach((k) => { if (typeof i.display.options[k] === 'string') lab[k] = i.display.options[k].slice(0, 60); }); o.display = { options: lab }; }
    }
    if (i.group) o.group = str(i.group, 80);
    return o;
  });
}

// ---------- chart geometry (renderer internals, read defensively) ----------
const R_of = (cell) => { try { return cell.chart.renderer.renderer; } catch (e) { return null; } };
function paneBox(R, paneId){
  try {
    const p = R.scene.panes.get(paneId) || R.scene.panes.get('price');
    if (!p || !p.bounds || p.collapsed) return null;
    return { left: 0, top: p.bounds.top, width: Math.max(0, R.coords.width), height: p.bounds.height };
  } catch (e) { return null; }
}
const tfSecOf = (tf, bars) => {
  const s = String(tf || '');
  let m = /^(\d+)$/.exec(s); if (m) return +m[1] * 60;
  m = /^(\d+)\s*([smhDWM])$/i.exec(s);
  if (m) { const k = m[2]; return +m[1] * (k === 's' || k === 'S' ? 1 : k === 'm' ? 60 : k === 'h' || k === 'H' ? 3600 : k === 'D' || k === 'd' ? 86400 : k === 'W' || k === 'w' ? 604800 : 2592000); }
  if (/^[DWM]$/i.test(s)) return { D: 86400, W: 604800, M: 2592000 }[s.toUpperCase()];
  const n = bars.time.length; return n > 1 ? Math.max(1, Math.round((bars.time[n - 1] - bars.time[n - 2]) / 1000)) : 60;
};
function digitsOf(close){
  let d = 0;
  for (let i = Math.max(0, close.length - 60); i < close.length; i++) { const s = String(close[i]); const k = s.indexOf('.'); if (k >= 0) d = Math.max(d, Math.min(8, s.length - k - 1)); }
  return d;
}

// ---------- the on-screen object layer (buttons, labels, edits, rectangle labels, Comment) ----------
const FONTS = { arial: 'Arial, Helvetica, sans-serif', tahoma: 'Tahoma, Verdana, sans-serif', verdana: 'Verdana, sans-serif', calibri: 'Calibri, Arial, sans-serif', consolas: 'Consolas, ui-monospace, monospace', 'courier new': '"Courier New", ui-monospace, monospace', 'segoe ui': '"Segoe UI", system-ui, sans-serif', 'trebuchet ms': '"Trebuchet MS", sans-serif', 'lucida console': '"Lucida Console", ui-monospace, monospace', 'times new roman': '"Times New Roman", serif' };
const fontOf = (name) => FONTS[String(name || '').toLowerCase()] || 'inherit';
const ANCH = [[0, 0], [0, 0.5], [0, 1], [0.5, 1], [1, 1], [1, 0.5], [1, 0], [0.5, 0], [0.5, 0.5]];

class Layer {
  constructor(o){ this.o = o; this.els = new Map(); this.objs = []; this.comment = ''; this.root = null; this.sub = null; this.drag = null; }
  mount(){
    const R = this.o.R(); if (!R || !R.plot) return false;
    if (this.root && this.root.parentElement === R.plot) return true;
    this.root = el('div', { class: 'mq5-layer', 'data-ind': this.o.title() });
    this.sub = el('div', { class: 'mq5-layer' });
    this.cmt = el('div', { class: 'mq5-comment', hidden: true });
    this.root.appendChild(this.cmt);
    R.plot.appendChild(this.root); R.plot.appendChild(this.sub);
    const pa = R.positionAttribution;   // Vela re-lays panes out through positionAttribution(); ride the same call
    if (typeof pa === 'function' && !R.__mq5Pa) { R.__mq5Pa = new Set(); R.positionAttribution = function(){ const r = pa.apply(this, arguments); R.__mq5Pa.forEach((f) => { try { f(); } catch (e) {} }); return r; }; }
    this.relayout = () => this.place();
    if (R.__mq5Pa) R.__mq5Pa.add(this.relayout);
    return true;
  }
  place(){
    const R = this.o.R(); if (!R || !this.root) return;
    const main = paneBox(R, 'price'), sub = this.o.separate ? paneBox(R, 'pane-' + this.o.id) : null;
    const put = (n, b) => { if (!b) { n.hidden = true; return; } n.hidden = false; Object.assign(n.style, { left: '0px', top: b.top + 'px', width: b.width + 'px', height: b.height + 'px' }); };
    put(this.root, main); put(this.sub, sub || (this.o.separate ? null : main));
    if (!this.o.separate) this.sub.hidden = true;
    this.box = { main, sub };
    this.draw();
  }
  set(objs, comment){ if (objs) this.objs = objs.filter((x) => x && SCREEN.has(x.type)).slice(0, 300); if (comment != null) this.comment = String(comment); if (this.mount()) this.place(); }
  draw(){
    if (!this.root) return;
    const live = new Set();
    // Comment(): top-left of the window the indicator draws in
    const cHost = this.o.separate && this.box && this.box.sub ? this.sub : this.root;
    if (this.cmt.parentElement !== cHost) cHost.appendChild(this.cmt);
    this.cmt.hidden = !this.comment; this.cmt.textContent = this.comment.slice(0, 4000);
    this.objs.forEach((ob) => {
      const P = propsOf(ob), key = String(ob.name).slice(0, 200);
      if (P.i.get(24) === -1) return;
      const host = ob.sub > 0 && this.o.separate ? this.sub : this.root;
      const B = ob.sub > 0 && this.o.separate ? this.box && this.box.sub : this.box && this.box.main;
      if (!B) return;
      live.add(key);
      let e = this.els.get(key);
      const tag = ob.type === 107 ? 'input' : ob.type === 103 ? 'button' : 'div';
      if (!e || e.tagName.toLowerCase() !== tag) { if (e) e.remove(); e = this.make(ob.type, key); this.els.set(key, e); }
      if (e.parentElement !== host) host.appendChild(e);
      this.paint(e, ob, P, B);
    });
    for (const [k, e] of this.els) if (!live.has(k)) { e.remove(); this.els.delete(k); }
  }
  make(type, name){
    const self = this, tag = type === 107 ? 'input' : type === 103 ? 'button' : 'div';
    const e = el(tag, { class: 'mq5-obj ' + (type === 103 ? 'mq5-button' : type === 107 ? 'mq5-edit' : type === 110 ? 'mq5-rect' : 'mq5-label'), 'data-name': name, title: 'From ' + this.o.title() });
    if (type === 107) { e.type = 'text'; e.autocomplete = 'off'; e.spellcheck = false; e.maxLength = 500; }
    if (type === 103) e.type = 'button';
    e.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      if (type === 107) return;
      const sel = e.dataset.sel === '1';
      if (sel) { this.drag = { e, name, x: ev.clientX, y: ev.clientY, ox: +e.dataset.x || 0, oy: +e.dataset.y || 0, sx: +e.dataset.sx || 1, sy: +e.dataset.sy || 1, moved: false }; try { e.setPointerCapture(ev.pointerId); } catch (er) {} }
    });
    e.addEventListener('pointermove', (ev) => {
      const d = this.drag; if (!d || d.e !== e) return;
      const dx = ev.clientX - d.x, dy = ev.clientY - d.y;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      d.moved = true; e.style.translate = dx + 'px ' + dy + 'px';
    });
    e.addEventListener('pointerup', (ev) => {
      const d = this.drag; this.drag = null;
      if (d && d.moved) {
        e.style.translate = '';
        const nx = Math.round(d.ox + (ev.clientX - d.x) * d.sx), ny = Math.round(d.oy + (ev.clientY - d.y) * d.sy);
        self.o.onEvent([2, 0, 0, name], { name, props: { x: nx, y: ny } });
        return;
      }
      if (type === 107) return;
      const st = type === 103 ? (e.dataset.state === '1' ? 0 : 1) : undefined;
      if (type === 103) { e.dataset.state = String(st); e.classList.toggle('is-on', !!st); }
      const r = e.getBoundingClientRect();
      self.o.onEvent([1, Math.round(r.left), Math.round(r.top), name], type === 103 ? { name, props: { state: st } } : null);
    });
    if (type === 107) {
      const done = () => { if (e.value !== e.dataset.text) { e.dataset.text = e.value; self.o.onEvent([3, 0, 0, name], { name, props: { text: e.value } }); } };
      e.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') { e.blur(); } });
      e.addEventListener('change', done); e.addEventListener('blur', done);
    }
    return e;
  }
  paint(e, ob, P, B){
    const I = (k, d) => (P.i.has(k) ? P.i.get(k) : d);
    const corner = clampI(I(42, 0), 0, 3, 0), x = clampI(I(26, 0), -5000, 5000, 0), y = clampI(I(27, 0), -5000, 5000, 0);
    const right = corner === 2 || corner === 3, lower = corner === 1 || corner === 2;
    const ax = right ? B.width - x : x, ay = lower ? B.height - y : y;
    const fs = clampI(I(18, 10), 6, 48, 10) * 4 / 3;
    const color = bgr(I(0, 0)), bg = bgr(I(41, 0xFFFFFFFF)), bd = bgr(I(44, 0xFFFFFFFF));
    const text = str(P.s.get(201), 500);
    e.dataset.x = x; e.dataset.y = y; e.dataset.sx = right ? -1 : 1; e.dataset.sy = lower ? -1 : 1;
    e.dataset.sel = I(11, 0) ? '1' : '0';
    e.style.zIndex = String(clampI(I(4, 0), 0, 50, 0) + 1);
    e.style.fontFamily = fontOf(P.s.get(204));
    e.style.fontSize = fs.toFixed(1) + 'px';
    e.style.color = color || '';
    const tip = str(P.s.get(202), 300); if (tip && tip !== '\n') e.title = tip;
    if (ob.type === 102) {
      const a = ANCH[clampI(I(25, 0), 0, 8, 0)];
      Object.assign(e.style, { left: ax + 'px', top: ay + 'px', transform: 'translate(' + (-a[0] * 100) + '%,' + (-a[1] * 100) + '%)' + (I(103, 0) ? '' : '') });
      const ang = fin(P.d.get(103)); if (ang) e.style.rotate = (-ang) + 'deg'; else e.style.rotate = '';
      if (e.textContent !== text) e.textContent = text;
      return;
    }
    // button, edit, rectangle label: x/y place the object's top-left point
    const w = clampI(I(33, 60), 0, 2000, 60), h = clampI(I(34, 20), 0, 1000, 20);
    Object.assign(e.style, { left: ax + 'px', top: (lower ? ay : ay) + 'px', width: w + 'px', height: h + 'px', background: bg || 'transparent', borderColor: bd || (ob.type === 110 ? 'transparent' : 'rgba(128,128,128,.5)') });
    if (ob.type === 110) { e.style.borderWidth = clampI(I(2, 1), 0, 10, 1) + 'px'; e.style.borderStyle = clampI(I(43, 0), 0, 2, 0) === 0 ? 'solid' : 'outset'; return; }
    if (ob.type === 103) {
      const on = !!I(31, 0); e.dataset.state = on ? '1' : '0'; e.classList.toggle('is-on', on);
      e.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (e.textContent !== text) e.textContent = text;
      return;
    }
    // OBJ_EDIT
    const align = clampI(I(17, 0), 0, 2, 0);
    e.style.textAlign = align === 2 ? 'center' : align === 1 ? 'right' : 'left';
    e.readOnly = !!I(8, 0);
    if (document.activeElement !== e && e.value !== text) { e.value = text; e.dataset.text = text; }
  }
  clear(){ this.objs = []; this.comment = ''; this.draw(); }
  destroy(){
    const R = this.o.R(); if (R && R.__mq5Pa && this.relayout) R.__mq5Pa.delete(this.relayout);
    if (this.root) this.root.remove(); if (this.sub) this.sub.remove();
    this.els.clear(); this.root = this.sub = null;
  }
}

// ---------- the Vela engine: one per chart cell, one sandboxed worker per indicator ----------
let getWs = () => null;
function cellOfRecord(engineObj, id){
  let cells = []; try { cells = getWs().context().cells || []; } catch (e) { return null; }
  for (const c of cells) { try { const r = c.chart.orchestrator.registry.get(id); if (r && r.engine === engineObj) return c; } catch (e) {} }
  return null;
}
function playAlert(){ try { const S = window.StrykerChartSounds; if (S && S.play) S.play('indicator', {}); } catch (e) {} }
const notified = new Set();
function notice(text){
  if (!text || notified.has(text)) return; notified.add(text);
  try { window.showToast && window.showToast('info', String(text).slice(0, 300), { duration: 6000 }); } catch (e) {}
}
function columns(all){
  const n = all.length, z = () => new Array(n);
  const b = { time: z(), open: z(), high: z(), low: z(), close: z(), tick_volume: z(), volume: z(), spread: new Array(n).fill(0) }, ms = new Array(n);
  for (let i = 0; i < n; i++) { const x = all[i]; ms[i] = x.time; b.time[i] = Math.floor(x.time / 1000); b.open[i] = x.open; b.high[i] = x.high; b.low[i] = x.low; b.close[i] = x.close; b.tick_volume[i] = x.volume || 0; b.volume[i] = x.volume || 0; }
  return { eng: b, ms: { time: ms, close: b.close } };
}

export class MqEngine {
  constructor(){ this.language = LANG; this.capabilities = { streaming: false, visibleRange: false, inputs: true, props: false }; }
  async prepare(source, instanceId){
    if (String(source).length > SRC_MAX) throw mqError({ line: 1, col: 1, message: 'This script is longer than 64 KB.' });
    const r = await compileIn(source);
    if (!r.ok || firstError(r.diagnostics)) throw mqError(firstError(r.diagnostics) || { line: 1, col: 1, message: 'The script did not compile.' });
    const m = r.meta || {};
    return { language: LANG, inputs: cleanInputs(m.inputs), meta: { title: titleOf(source), overlay: !m.separate }, reactsToViewport: false,
      token: { source, instanceId, separate: !!m.separate, timer: !!m.timer, events: !!m.events } };
  }
  execute(req, handlers){
    const self = this, tok = req.prepared.token, id = tok.instanceId;
    let runner = null, stopped = false, busy = false, dirty = false, last = null, started = false, lastOut = null, objects = [], timerMs = 0, timerH = 0, inputs = Object.assign({}, req.inputs || {});
    let pend = [], listening = false;
    const cell = () => cellOfRecord(self, id);
    const R = () => { const c = cell(); return c ? R_of(c) : null; };
    const layer = new Layer({ id, separate: tok.separate, R, title: () => (lastOut && lastOut.title) || req.prepared.meta.title, onEvent: (ev, state) => queueEvent(ev, state) });
    const fail = (d) => { if (stopped) return; stopped = true; stopTimer(); layer.destroy(); unlisten(); if (runner) runner.dispose(); try { handlers.onError && handlers.onError(mqError(d)); } catch (e) {} };
    const getBars = () => (req.getBars ? req.getBars() : req.bars) || [];
    let curBars = null;
    const emit = () => {
      if (!lastOut || !curBars) return;
      let model;
      try { model = toModel(lastOut, curBars.ms, id, req.prepared, inputs, objects, tok.separate); }
      catch (e) { console.warn('TradeZoro: MQL5 model', e); fail({ line: 1, col: 1, message: 'The script produced output the chart cannot draw.' }); return; }
      try { handlers.onModel(model); } catch (e) { console.warn('TradeZoro: MQL5 model', e); }
    };
    // side effects every engine call can have: prints, alerts, notices, objects, comment, timer interval
    const take = (out) => {
      if (!out) return;
      (out.prints || []).slice(0, 50).forEach((p) => { try { console.info('[MQL5] ' + (lastOut && lastOut.title || req.prepared.meta.title) + ': ' + p); } catch (e) {} });
      (out.alerts || []).slice(0, 3).forEach((a) => { playAlert(); try { window.showToast && window.showToast('info', ((lastOut && lastOut.title) || req.prepared.meta.title) + ': ' + str(a.text, 300), { duration: 8000 }); } catch (e) {} });
      (out.notices || []).slice(0, 5).forEach(notice);
      if (Array.isArray(out.objects)) objects = out.objects;
      if (Array.isArray(out.objects) || out.comment != null) layer.set(Array.isArray(out.objects) ? objects : null, out.comment != null ? out.comment : null);
      if (out.timer !== undefined && (out.timer | 0) !== timerMs) { timerMs = out.timer | 0; startTimer(); }
    };
    const startTimer = () => { stopTimer(); if (timerMs > 0 && !stopped) timerH = setInterval(tick, Math.max(100, timerMs)); };
    function stopTimer(){ if (timerH) clearInterval(timerH); timerH = 0; }
    let missed = false;
    async function tick(){
      if (stopped || !runner || !started) return;
      if (document.hidden) { missed = true; return; }   // paused while the tab is hidden, one catch-up on return
      if (busy) return;
      busy = true;
      try { const out = await runner.timer(); after(out, true); } catch (e) { /* the next tick retries */ }
      busy = false; flush();
    }
    const onVis = () => { if (!document.hidden && missed) { missed = false; tick(); } };
    document.addEventListener('visibilitychange', onVis);
    // the result of OnTimer / OnChartEvent
    function after(out, fromTimer){
      if (stopped || !out) return;
      if (out.ok === false) { fail(out.error || { line: 1, col: 1, message: 'The script stopped with an error.' }); return; }
      take(out);
      if (out.recalc) { last = null; run(); return; }
      if (Array.isArray(out.objects) || (!fromTimer && out.plots)) { if (out.plots) lastOut = Object.assign({}, lastOut, { plots: out.plots, levels: out.levels, range: out.range, title: out.title || (lastOut && lastOut.title) }); emit(); }
    }
    function queueEvent(ev, state){
      if (stopped || !tok.events) return;
      if (pend.length >= 32) pend.shift();
      pend.push([ev, state]); flush();
    }
    async function flush(){
      if (busy || stopped || !runner || !started || !pend.length) return;
      busy = true;
      const [ev, state] = pend.shift();
      try { const out = await runner.event(ev, state); after(out, false); } catch (e) {}
      busy = false;
      if (dirty) { dirty = false; run(); } else if (pend.length) flush();
    }
    // chart click + keys, only for scripts with OnChartEvent; keys only while the chart has focus
    let onClick = null, onKey = null, hostEl = null;
    function listen(){
      if (listening || !tok.events) return;
      const c = cell(), r = R(); if (!c || !r || !r.plot) return;
      listening = true; hostEl = c.host || r.plot;
      onClick = (e) => {
        if (e.target && e.target.closest && e.target.closest('.mq5-obj, button, input, a, [role="menu"]')) return;
        const b = r.plot.getBoundingClientRect(); const x = Math.round(e.clientX - b.left), y = Math.round(e.clientY - b.top);
        if (x < 0 || y < 0 || x > r.coords.width) return;
        queueEvent([4, x, y, ''], null);
      };
      onKey = (e) => {
        const t = e.target; if (!t || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return;
        if (!hostEl.contains(t) && !(t === document.body && hostEl.matches(':hover'))) return;
        queueEvent([0, e.keyCode | 0, 1, ''], null);
      };
      r.plot.addEventListener('click', onClick);
      document.addEventListener('keydown', onKey);
    }
    function unlisten(){ const r = R(); try { if (r && r.plot && onClick) r.plot.removeEventListener('click', onClick); } catch (e) {} if (onKey) document.removeEventListener('keydown', onKey); listening = false; document.removeEventListener('visibilitychange', onVis); }
    function geometry(){
      const r = R(); if (!r || !r.coords) return null;
      const m = paneBox(r, 'price'), s = tok.separate ? paneBox(r, 'pane-' + id) : null;
      let dark = true; try { dark = document.documentElement.getAttribute('data-theme') !== 'light'; } catch (e) {}
      return { w: Math.round(r.coords.width || 0), h: Math.round(m ? m.height : 0), subH: Math.round(s ? s.height : 0), dark };
    }
    async function customs(){
      const o = {};
      try { (await Store.list()).items.slice(0, 50).forEach((t) => { if (isMql5(t.source)) o[t.name] = t.source; }); } catch (e) {}
      return o;
    }
    const run = async () => {
      if (stopped) return;
      if (busy) { dirty = true; return; }
      busy = true; dirty = false;
      try {
        const all = getBars();
        const cols = columns(all), b = cols.eng, n = b.time.length;
        if (!runner) { const { MqRunner } = await engine(); runner = new MqRunner(); }
        if (!started) {
          const mk = req.market || {}, sym = String(mk.symbol || ''), dg = digitsOf(b.close);
          const env = { symbol: sym.replace(/^[a-z_]+:/i, '') || 'SYMBOL', tfSec: tfSecOf(mk.timeframe, cols.ms), digits: dg, point: Math.pow(10, -dg), chart: geometry() || undefined };
          const r = await runner.start({ source: tok.source, inputs, env, customs: await customs() });
          if (stopped) return;
          if (!r || r.ok === false) { fail((r && (r.error || (r.diagnostics || [])[0])) || { line: 1, col: 1, message: 'The script did not start.' }); return; }
          started = true; last = null;
          layer.mount(); layer.place(); listen();
        }
        if (!n) { busy = false; return; }
        let mode = 'full';
        if (last && b.time[0] === last.first && n >= last.n && n <= last.n + 5) mode = n === last.n && b.time[n - 1] === last.lastT ? 'tick' : 'append';
        const out = await runner.calc(b, mode);
        if (stopped) return;
        if (!out || out.ok === false) { fail((out && out.error) || { line: 1, col: 1, message: 'The script stopped with an error.' }); return; }
        last = { first: b.time[0], n, lastT: b.time[n - 1] };
        curBars = cols; lastOut = out;
        take(out);
        emit();
        if (out.recalc) { last = null; dirty = true; }
      } catch (e) {
        if (!stopped) { if (runner) { runner.dispose(); runner = null; } started = false; fail(e && e.message === 'disposed' ? null : { line: 1, col: 1, message: 'The MQL5 engine stopped. Remove the indicator and add it again.' }); }
      } finally {
        busy = false;
        if (!stopped) { if (dirty) setTimeout(run, 0); else if (pend.length) flush(); }
      }
    };
    // geometry for ChartGetInteger, and CHARTEVENT_CHART_CHANGE on a resize
    let geoT = 0;
    const onResize = () => { clearTimeout(geoT); geoT = setTimeout(() => { if (!runner || !started || stopped) return; const g = geometry(); if (g) runner.chart(g).catch(() => {}); layer.place(); if (tok.events) queueEvent([9, 0, 0, ''], null); }, 250); };
    window.addEventListener('resize', onResize);
    run();
    return {
      getContext: () => Promise.resolve(null),
      stop: () => {
        stopped = true; stopTimer(); unlisten(); window.removeEventListener('resize', onResize); layer.destroy();
        const r = runner; runner = null;
        if (r) { if (started) r.send('deinit', { reason: 1 }, 1000).catch(() => {}).finally(() => r.dispose()); else r.dispose(); }
      },
      // new inputs: OnDeinit(REASON_PARAMETERS), then a fresh instance with the new values (globals and statics reset)
      update: (vals) => {
        inputs = Object.assign({}, vals || {});
        if (runner && started) runner.send('deinit', { reason: 5 }, 1000).catch(() => {});
        started = false; last = null; stopTimer(); timerMs = 0; objects = []; layer.clear(); run();
      },
      setVisibleRange: () => {},
      notifyBars: (reason) => { if (reason === 'backfill') last = null; run(); }
    };
  }
  terminate(){ if (compiler) { compiler.dispose(); compiler = null; } }
}

// ---------- chart side ----------
const mqHandles = (chart) => { try { return chart.indicators().filter((h) => isMql5(h.source) && !h.nativeType); } catch (e) { return []; } };
function changed(){ try { const ws = getWs(); if (ws) ws.context().stateChanged(); } catch (e) {} }
function snapshot(h){ let inputs = {}; try { inputs = h.inputValues() || {}; } catch (e) {} const o = { name: titleOf(h.source), source: h.source, inputs }; if (h.visible === false) o.hidden = true; return o; }
function cleanEntry(x){
  if (!x || typeof x !== 'object' || !isMql5(x.source) || x.source.length > SRC_MAX) return null;
  const inputs = {};
  if (x.inputs && typeof x.inputs === 'object') Object.keys(x.inputs).slice(0, MAX_INPUTS).forEach((k) => {
    const v = x.inputs[k];
    if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 4096)) inputs[k] = v;
  });
  const o = { name: typeof x.name === 'string' ? x.name.slice(0, 80) : 'MQL5', source: x.source, inputs };
  if (x.hidden === true) o.hidden = true;
  return o;
}

export function installMql5(core, wsGetter){
  getWs = wsGetter;
  try { core.registerDefaultEngine(LANG, () => new MqEngine()); } catch (e) { console.warn('TradeZoro: MQL5 engine', e); }
  try {
    core.registerStatePersistence({
      key: EXT_KEY, scope: 'cell',
      serialize(ctx){ const l = mqHandles(ctx.chart).map(snapshot); return l.length ? l : undefined; },
      restore(payload, ctx){
        const chart = ctx.chart;
        mqHandles(chart).forEach((h) => { try { h.remove(); } catch (e) {} });
        if (!Array.isArray(payload)) return;
        payload.map(cleanEntry).filter(Boolean).slice(0, MAX_PER_CELL).forEach((x) => {
          try { const h = chart.addIndicator(x.source, { language: LANG, inputs: x.inputs }); if (h && x.hidden) h.setVisible(false); } catch (e) { console.warn('TradeZoro: MQL5 restore', e); }
        });
      }
    });
  } catch (e) { console.warn('TradeZoro: MQL5 persistence', e); }
}

export async function runOnChart(chart, source){
  if (!isMql5(source)) return { ok: false, msg: 'An MQL5 indicator needs an OnCalculate function.', diag: { line: 1, col: 1, message: 'An MQL5 indicator needs an OnCalculate function.', hint: 'Paste the whole .mq5 file.' } };
  if (source.length > SRC_MAX) return { ok: false, msg: 'This script is longer than 64 KB.' };
  if (mqHandles(chart).length >= MAX_PER_CELL) return { ok: false, msg: 'This chart already has ' + MAX_PER_CELL + ' MQL5 indicators. Remove one first.' };
  const kill = () => document.querySelectorAll('.vela-toast[data-type="error"][data-open]').forEach((t) => { delete t.dataset.open; });
  const res = await chart.runIndicator(source, { language: LANG });
  if (!res.ok) {
    kill(); setTimeout(kill, 60); setTimeout(kill, 400);
    const d = res.error && res.error.diag;
    return { ok: false, msg: d ? diagText(d) : String((res.error && res.error.message) || 'The indicator did not run.'), diag: d };
  }
  changed();
  return { ok: true, handle: res.handle };
}

// ---------- editor panel ----------
const LANG_PREF = 'stryker_script_lang';
function docsList(builtins){ return builtins.map((b) => ({ name: b.name, sig: b.sig, doc: b.doc, insert: b.name + '()', back: 1 })); }

export function mountMql5(ws, opts){
  const toast = (opts && opts.toast) || (() => {});
  const tfLabel = (opts && opts.tfLabel) || ((t) => t);
  const host = document.querySelector('.stkchart-panel') || document.body;
  const pineBtn = document.getElementById('stkc-pine-btn');
  const Z = () => window.STRYKER_ZS;

  const S = createShell({
    id: 'stkc-mq5', cls: 'stkc-zs stkc-mq5', label: 'MQL5 editor', closeLabel: 'Close the MQL5 editor',
    note: 'Paste an MQL5 indicator (.mq5) and add it to the chart. It runs in your browser in a sandbox with no access to your account, and it never places orders. Education only. Not financial advice.',
    moreItems: [['dup', 'Duplicate'], ['export', 'Export .mq5'], ['import', 'Import file…'], ['help', 'What is supported'], ['delete', 'Delete', true]],
    onClose: () => { setOpen(false); if (pineBtn) pineBtn.focus(); },
    onWrap: (on) => { if (ed) ed.setWrap(on); },
    onFind: () => { ensureEditor().then((e) => e.find()).catch(() => {}); },
    onMore: (k) => more(k),
    onMenu: (menu) => { menu.querySelector('[data-k="delete"]').disabled = !editingId; },
    onTab: (k) => { if (k === 'docs') renderDocsTab(); },
    onView: (v) => { if (v === 'code' && ed) ed.focus(); }
  });
  const { panel, nameIn, target, edHost, addBtn, saveBtn, newBtn, panes } = S;
  const renderSwitch = () => { S.segSlot.innerHTML = ''; if (Z() && Z().langSwitch) S.segSlot.appendChild(Z().langSwitch('mql5')); else S.segSlot.appendChild(el('span', { class: 'sed-chip', text: 'MQL5' })); };
  edHost.classList.add('stkc-zs-ed');
  edHost.appendChild(el('div', { class: 'stkc-zs-loading', text: 'Loading editor…' }));
  const lists = {}; ['chart', 'mine', 'examples'].forEach((k) => { lists[k] = el('ul', { class: 'stkc-tlist' }); panes[k].appendChild(lists[k]); });
  host.appendChild(panel);

  let ed = null, edP = null, editingId = null, busy = false, draft = null, builtinsAll = [];
  let base = { name: '', src: '' }, kind = 'new', compileErr = false, handle = null;
  const isPhone = () => window.innerWidth <= 700;
  function activeCell(){
    const cells = (() => { try { return ws.context().cells; } catch (e) { return []; } })();
    let id = null; try { id = ws.active.id; } catch (e) {}
    const i = Math.max(0, cells.findIndex((c) => c.id === id));
    return { cell: cells[i], index: i, count: cells.length };
  }
  function renderTarget(){
    const a = activeCell();
    if (!a.cell) { target.textContent = ''; target.hidden = true; return; }
    const sym = String(a.cell.symbol || '').replace(/^[a-z]+:/i, '').replace(/1!$/, '');
    target.hidden = false;
    target.textContent = (a.count > 1 ? 'Chart ' + (a.index + 1) + ' · ' : '') + sym + ' · ' + tfLabel(a.cell.timeframe);
    target.title = 'Add to chart puts the indicator on ' + target.textContent;
  }
  const onChartNow = () => { const a = activeCell(); return !!(handle && a.cell && mqHandles(a.cell.chart).includes(handle)); };
  function renderPrimary(){ if (!busy) S.setPrimary(onChartNow() ? 'Update on chart' : 'Add to chart'); }
  function renderStatus(){
    if (busy) return;
    const cur = ed ? ed.get() : base.src, dirtyNow = cur !== base.src || nameIn.value.trim() !== base.name;
    S.setStatus(compileErr ? 'error' : !dirtyNow && kind === 'mine' ? 'saved' : !dirtyNow && kind === 'example' ? 'example' : !dirtyNow && kind === 'chart' ? 'idle' : 'unsaved');
    renderPrimary();
  }
  function showCompile(r){
    const diags = (r && r.diagnostics) || [];
    const errs = diags.filter((d) => d && d.severity !== 'warning');
    compileErr = !r || !r.ok || errs.length > 0;
    if (compileErr) S.problems.head('err', errs.length === 1 ? '1 problem' : (errs.length || 1) + ' problems');
    else { const m = r.meta || {}, np = (m.plots || []).length, ni = (m.inputs || []).length; S.problems.head('ok', 'Compiled OK · ' + np + (np === 1 ? ' plot' : ' plots') + ' · ' + ni + (ni === 1 ? ' input' : ' inputs') + (m.separate ? ' · own pane' : '')); }
    S.problems.list(errs.slice(0, 20).map((d) => ({ text: diagText(d), line: d.line, col: d.col })), (l, c) => { if (ed) { S.setView('code'); ed.goto(l, c); ed.focus(); } });
    renderStatus();
  }
  async function lint(src){ if (!src.trim()) return []; const r = await compileIn(src); if (ed && ed.get() === src) showCompile(r); return r.diagnostics || []; }
  function stopLint(){ if (compiler) { compiler.dispose(); compiler = null; } }
  function ensureEditor(){
    if (!edP) {
      edP = Promise.all([import('./zs-editor/editor.js?v=1254'), loadBuiltins()]).then(([m, builtins]) => {
        builtinsAll = builtins;
        edHost.innerHTML = '';
        const first = MQ5_EXAMPLES[0];
        ed = m.createZsEditor(edHost, { lang: 'mql5', doc: draft != null ? draft : first.source, builtins, lint, wrap: S.wrap(), onRun: () => addToChart(), onSave: () => save(), onChange: () => renderStatus() });
        if (draft == null) { nameIn.value = first.name; base = { name: first.name, src: first.source }; kind = 'example'; }
        renderStatus();
        if (S.tab() === 'docs') renderDocsTab();
        return ed;
      }).catch((e) => { edP = null; edHost.innerHTML = ''; edHost.appendChild(el('div', { class: 'stkc-zs-loading', text: 'The editor did not load. Check your connection and reopen it.' })); throw e; });
    }
    return edP;
  }
  function showErr(d, text){
    if (!d && !text) { S.problems.list([]); if (ed) ed.showDiagnostics([]); return; }
    S.problems.head(d ? 'err' : 'info', d ? '1 problem' : 'Note');
    S.problems.list([{ text: d ? diagText(d) : text, line: d && d.line, col: d && d.col }], (l, c) => { if (ed) { S.setView('code'); ed.goto(l, c); ed.focus(); } });
    if (d) { compileErr = true; renderStatus(); }
    if (d && ed) { ed.showDiagnostics([d]); ed.goto(d.line, d.col); }
  }
  async function load(name, source, id, k, h){
    nameIn.value = name || ''; editingId = id || null; draft = source || '';
    kind = k || (id ? 'mine' : 'new'); handle = h || null; compileErr = false;
    base = { name: (name || '').trim(), src: source || '' };
    const e = await ensureEditor(); e.set(source || ''); showErr(null);
    S.problems.head('busy', 'Checking…');
    if (isPhone() || !S.isWide()) S.setView('code');
    renderStatus();
  }
  async function addToChart(){
    if (busy) return;
    const e = await ensureEditor();
    const src = e.get();
    if (!src.trim()) { showErr(null, 'Paste an MQL5 indicator first.'); return; }
    const a = activeCell(); if (!a.cell) return;
    const old = onChartNow() ? handle : null;
    busy = true; addBtn.disabled = true; S.setPrimary('Running…'); S.setStatus('running'); showErr(null);
    try {
      if (old) { try { old.remove(); } catch (er) {} }
      const r = await runOnChart(a.cell.chart, src);
      if (r.ok) { handle = r.handle; toast((old ? 'Updated ' : 'Added ') + titleOf(src) + (old ? ' on the chart' : ' to the chart')); if (isPhone()) setOpen(false); }
      else {
        if (old) { try { handle = (await runOnChart(a.cell.chart, old.source)).handle || null; } catch (er) { handle = null; } }
        showErr(r.diag, r.diag ? null : r.msg);
      }
    } catch (err) { console.warn('TradeZoro: MQL5 run', err); showErr(null, 'The MQL5 engine did not start. Reload the page and try again.'); }
    busy = false; addBtn.disabled = false; renderStatus();
    renderLists();
  }
  async function save(){
    const e = await ensureEditor();
    let name = nameIn.value.trim();
    if (!name) { name = titleOf(e.get()); if (name === 'MQL5 indicator') name = ''; nameIn.value = name; }
    if (!name) { nameIn.focus(); showErr(null, 'Give the indicator a name first.'); return; }
    saveBtn.disabled = true;
    try { editingId = await Store.save(name, e.get(), editingId); kind = 'mine'; base = { name, src: e.get() }; toast('Indicator saved'); renderStatus(); }
    catch (err) { showErr(null, (err && err.userMessage) || 'Could not save the indicator.'); }
    saveBtn.disabled = false;
    renderLists();
  }
  const copyName = (n) => (String(n || 'Indicator').slice(0, 54) + ' copy');
  async function more(k){
    const e = await ensureEditor().catch(() => null); if (!e) return;
    if (k === 'dup') { await load(copyName(nameIn.value.trim() || titleOf(e.get())), e.get(), null, 'new'); nameIn.focus(); nameIn.select(); }
    else if (k === 'export') download(fileName(nameIn.value.trim() || titleOf(e.get()), '.mq5'), e.get());
    else if (k === 'import') {
      const f = await pickFile('.mq5,.mqh,.txt,text/plain');
      if (!f) return;
      if (f.error) { showErr(null, f.error); return; }
      await load(f.name, f.text, null, 'new');
    }
    else if (k === 'help') window.open('/help/mql5-on-tradezoro', '_blank', 'noopener');
    else if (k === 'delete' && editingId) {
      const name = nameIn.value.trim() || 'this indicator';
      if (!window.confirm('Delete "' + name + '"? It stays on any chart it is already on.')) return;
      try { await Store.remove(editingId); editingId = null; kind = 'new'; toast('Indicator deleted'); renderStatus(); } catch (er) { showErr(null, 'Could not delete.'); }
      renderLists();
    }
  }
  addBtn.addEventListener('click', addToChart);
  saveBtn.addEventListener('click', save);
  newBtn.addEventListener('click', () => { load('', MQ5_NEW, null, 'new').then(() => nameIn.focus()); });
  nameIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); if (ed) ed.focus(); } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } });
  nameIn.addEventListener('input', renderStatus);
  function renderDocsTab(){
    const list = docsList(builtinsAll);
    renderDocs(panes.docs, list, S.docsSearch.value, (txt) => { ensureEditor().then((e) => { S.setView('code'); e.insert(txt, 1); }); });
    S.setCount('docs', 0);
  }
  S.docsSearch.addEventListener('input', renderDocsTab);
  S.docsSearch.addEventListener('keydown', (e) => e.stopPropagation());
  const newRow = () => load('', MQ5_NEW, null, 'new').then(() => nameIn.focus());
  async function renderLists(){
    renderTarget(); renderPrimary();
    const a = activeCell();
    const hs = a.cell ? mqHandles(a.cell.chart) : [];
    lists.chart.innerHTML = '';
    if (!hs.length) lists.chart.appendChild(emptyState('No MQL5 indicators on this chart yet. Paste one or open an example, then Add to chart.', 'New indicator', newRow));
    hs.forEach((h) => {
      const nm = titleOf(h.source);
      lists.chart.appendChild(libRow({ name: nm, badge: h === handle ? 'Open' : null, desc: descOf(h.source), onOpen: () => load(nm, h.source, null, 'chart', h),
        actions: [ib('Open ' + nm + ' in the editor', ICONS.open, () => load(nm, h.source, null, 'chart', h)), ib('Remove ' + nm + ' from the chart', ICONS.del, () => { try { h.remove(); } catch (e) {} if (h === handle) handle = null; changed(); renderLists(); }, 'stkc-del')] }));
    });
    S.setCount('chart', hs.length);
    lists.examples.innerHTML = '';
    MQ5_EXAMPLES.forEach((x) => lists.examples.appendChild(libRow({ name: x.name, badge: 'Example', desc: exDesc(x.source), onOpen: () => load(x.name, x.source, null, 'example'),
      actions: [ib('Open ' + x.name, ICONS.open, () => load(x.name, x.source, null, 'example')), ib('Add ' + x.name + ' to the chart', ICONS.add, () => { load(x.name, x.source, null, 'example').then(addToChart); }), ib('Duplicate ' + x.name + ' as a new indicator', ICONS.copy, () => load(copyName(x.name), x.source, null, 'new'))] })));
    S.setCount('examples', MQ5_EXAMPLES.length);
    let r = { items: [] };
    try { r = await Store.list(); } catch (e) { r = { items: [], note: 'Could not load your indicators.' }; }
    lists.mine.innerHTML = '';
    if (!r.items.length) lists.mine.appendChild(emptyState('No saved MQL5 indicators yet. Paste one, give it a name, then Save (' + (/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+') + 'S).', 'New indicator', newRow));
    r.items.forEach((t) => lists.mine.appendChild(libRow({ name: t.name, badge: t.id === editingId ? 'Open' : null, desc: ago(t.updatedAt) + (exDesc(t.source) ? ' · ' + exDesc(t.source) : ''), onOpen: () => load(t.name, t.source, t.id, 'mine'),
      actions: [
        ib('Add ' + t.name + ' to the chart', ICONS.add, () => { load(t.name, t.source, t.id, 'mine').then(addToChart); }),
        ib('Duplicate ' + t.name, ICONS.copy, () => load(copyName(t.name), t.source, null, 'new')),
        ib('Rename ' + t.name, ICONS.ren, async () => { const v = window.prompt('Rename the indicator', t.name); if (!v || !v.trim()) return; try { await Store.rename(t.id, v); if (editingId === t.id) { nameIn.value = v.trim(); base.name = v.trim(); } } catch (e) { showErr(null, 'Could not rename.'); } renderLists(); renderStatus(); }),
        ib('Delete ' + t.name, ICONS.del, async () => { if (!window.confirm('Delete "' + t.name + '"? It stays on any chart it is already on.')) return; try { await Store.remove(t.id); if (editingId === t.id) { editingId = null; kind = 'new'; renderStatus(); } } catch (e) { showErr(null, 'Could not delete.'); } renderLists(); }, 'stkc-del')
      ] })));
    S.setCount('mine', r.items.length);
  }
  function setOpen(open){
    panel.hidden = !open;
    S.setOpenState(open);
    const pine = document.getElementById('stkc-pine'), zs = document.getElementById('stkc-zs');
    const any = open || (pine && !pine.hidden) || (zs && !zs.hidden);
    document.body.classList.toggle('stkc-pine-open', !!any);
    if (pineBtn) pineBtn.setAttribute('aria-expanded', any ? 'true' : 'false');
    if (open) {
      try { localStorage.setItem(LANG_PREF, 'mql5'); } catch (e) {}
      renderSwitch(); renderLists();
      ensureEditor().then((e) => { if (!isPhone()) e.focus(); }).catch(() => {});
      const b = panel.querySelector('.stkc-langseg-b.on'); if (b) b.focus();
    } else stopLint();
  }
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      if (panel.querySelector('.cm-panel.cm-search') && panel.querySelector('.cm-panel.cm-search').contains(e.target)) return;
      e.stopPropagation();
      if (panel.classList.contains('is-max')) { S.setMax(false); return; }
      setOpen(false); if (pineBtn) pineBtn.focus();
    }
  });
  try { ws.on('cell:active', () => { if (!panel.hidden) setTimeout(renderLists, 0); }); } catch (e) {}
  try { ws.on('state:changed', () => { if (!panel.hidden) { renderTarget(); renderPrimary(); } }); } catch (e) {}
  const closeOthers = () => { try { if (Z()) Z().close(); } catch (e) {} try { if (window.STRYKER_PINE) window.STRYKER_PINE.close(); } catch (e) {} };
  if (Z() && Z().addLang) Z().addLang('mql5', 'MQL5', { open: () => { closeOthers(); setOpen(true); }, close: () => setOpen(false), isOpen: () => !panel.hidden });
  async function addSource(name, source){
    const a = activeCell();
    if (!a.cell) return { ok: false, msg: 'No chart to add it to.' };
    const r = await runOnChart(a.cell.chart, source);
    if (r.ok) { toast('Added ' + (name || titleOf(source)) + ' to the chart'); if (!panel.hidden) renderLists(); }
    return r;
  }
  window.STRYKER_MQ5 = {
    open: (src, name) => { closeOthers(); setOpen(true); if (src != null) load(name || '', src, null); },
    openNew: () => { closeOthers(); setOpen(true); load('', MQ5_NEW, null); },
    close: () => setOpen(false), isOpen: () => !panel.hidden, load, addToChart, addSource, runOnChart, handles: mqHandles, titleOf, isMql5, examples: MQ5_EXAMPLES, store: Store, toModel
  };
  return { setOpen };
}
// The example's one-line description: its #property description
function exDesc(src){ const m = /^\s*#property\s+description\s+"([^"\n]{3,140})"/m.exec(String(src || '')); return m ? m[1] : descOf(src); }
