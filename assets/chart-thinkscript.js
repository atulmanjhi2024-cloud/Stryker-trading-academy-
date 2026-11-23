// TradeZoro — Charts: thinkScript glue (charts.html) — ES module
// Depends on: assets/chart-zscript.js (toModel: engine output -> chart model; window.STRYKER_ZS.addLang / langSwitch for the
// language switch in the editor header), assets/chart-script-editor.js (editor panel layout), assets/zs-editor/editor.js
// (code editor), the thinkScript engine assets/ts/ (runner.js -> sandboxed worker.js), loaded on first use.
// assets/vela-chart.js calls installThinkscript(Core, wsGetter) before the workspace is built and mountThinkscript(ws, opts)
// after mountZscript.
//
// WHAT IT IS: thinkScript studies pasted into the chart's Script Editor. A Vela scripting engine for language id 'thinkscript'
// (TsEngine below), a "thinkScript" entry in the editor's language switch, its own panel (Examples, My scripts, On chart, Docs).
// SAFETY: member scripts never run on the page: every check and run happens in the sandboxed module worker (no network,
// no storage, time and memory limits; the runner kills a worker that runs too long).
// PERSISTENCE: cell-scope handler 'stryker.thinkscript' stores [{ name, source, inputs, hidden }] in the workspace state.
// A thinkScript source on the chart starts with the comment line "#@thinkscript 1 <name>" (added when it goes on the chart);
// Pine's handle list skips those (chart-pine.js pineHandles).

import { TS_EXAMPLES } from './ts/examples.js?v=1220';
import { toModel } from './chart-zscript.js?v=1220';
import { createShell, el, ib, ICONS, libRow, emptyState, renderDocs, ago, download, pickFile, fileName } from './chart-script-editor.js?v=1220';
import { isFutures } from './chart-sym.js?v=1220';

const LANG = 'thinkscript';
const EXT_KEY = 'stryker.thinkscript';
const MAX_PER_CELL = 8, SRC_MAX = 262144, MAX_INPUTS = 200;
const HEADER = /^\s*#@thinkscript 1\b[^\n]*\n?/;
const NEW_SRC = '# My study\ninput length = 20;\nplot Avg = Average(close, length);\nAvg.SetDefaultColor(Color.CYAN);\nAvg.SetLineWeight(2);\n';

export const isThinkscript = (src) => typeof src === 'string' && HEADER.test(src);
const clean = (s) => String(s || '').replace(/[\r\n"\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
export const withHeader = (src, name) => '#@thinkscript 1 ' + (clean(name) || 'thinkScript') + '\n' + String(src || '').replace(HEADER, '');
const body = (src) => String(src || '').replace(HEADER, '');
export function titleOf(src){
  const m = /^\s*#@thinkscript 1[ \t]+([^\n]+)/.exec(String(src || ''));
  if (m && m[1].trim()) return m[1].trim().slice(0, 60);
  const c = /^\s*#\s*(?!@)([^\n]{3,})/m.exec(body(src));   // first comment line
  return c ? c[1].trim().replace(/[.:]$/, '').slice(0, 60) : 'thinkScript';
}
const descOf = (src) => { const c = /^\s*#\s*(?!@)([^\n]{3,})/m.exec(body(src)); return c ? c[1].trim().slice(0, 120) : ''; };

// ---------- the engine (assets/ts/runner.js), loaded on first use ----------
let engineP = null;
const RUNNER_URL = './ts/runner.js?v=1220';
function engine(){
  if (!engineP) engineP = import(RUNNER_URL).catch(() => import(RUNNER_URL + '&retry=' + Date.now())).catch((e) => { engineP = null; throw e; });
  return engineP;
}
const engineDiag = (e) => ({ code: 'TS0', line: 1, col: 1, severity: 'error', message: 'The thinkScript engine did not load.', hint: 'Reload the page. Details: ' + String((e && e.message) || e || 'unknown').slice(0, 200) });
let checker = null;
async function analyzeIn(source){
  try { const { TsRunner } = await engine(); if (!checker) checker = new TsRunner(); return await checker.analyze(body(source)); }
  catch (e) { if (checker) { checker.dispose(); checker = null; } return { ok: false, diagnostics: [engineDiag(e)] }; }
}
const diagText = (d) => (d ? 'Line ' + (d.line || 1) + ':' + (d.col || 1) + ' ' + d.message + (d.hint ? ' ' + d.hint : '') : '');
// the header line is not in what the engine sees, so its line numbers are one lower than the chart source
const shift = (d, k) => (d ? Object.assign({}, d, { line: (d.line || 1) + k }) : d);
function tsError(d){ const e = new Error(diagText(d)); e.diag = d; return e; }
const firstError = (list) => (list || []).find((d) => d && d.severity !== 'warning');

const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const cap = (a, n) => (Array.isArray(a) ? a.slice(0, n) : []);
const str = (s, n) => (s == null ? undefined : String(s).slice(0, n || 500));
const INPUT_TYPES = { int: 'int', float: 'float', bool: 'bool', string: 'string', source: 'source' };
function cleanInputs(list){
  return cap(list, MAX_INPUTS).filter((i) => i && /^\d{1,3}$/.test(String(i.key)) && INPUT_TYPES[i.type]).map((i) => {
    const o = { key: String(i.key), title: str(i.title, 80) || 'Input', type: INPUT_TYPES[i.type], defval: i.defval };
    if (fin(i.step) != null) o.step = i.step;
    if (Array.isArray(i.options) && i.options.length) o.options = i.options.slice(0, 100).map(String);
    return o;
  });
}
const runInputs = (vals) => { const o = {}; Object.keys(vals || {}).forEach((k) => { if (/^\d+$/.test(k)) o[k] = vals[k]; }); return o; };
function columns(all){
  const n = all.length, b = { time: new Array(n), open: new Array(n), high: new Array(n), low: new Array(n), close: new Array(n), volume: new Array(n) };
  for (let i = 0; i < n; i++) { const x = all[i]; b.time[i] = Number(x.openTime != null ? x.openTime : x.time); b.open[i] = x.open; b.high[i] = x.high; b.low[i] = x.low; b.close[i] = x.close; b.volume[i] = x.volume || 0; }
  return b;
}
// chart timeframe string -> ms, and AggregationPeriod ms -> the timeframe string the chart's data feed takes
export function tfToMs(tf){
  const m = /^(\d*)([SDWM]?)$/i.exec(String(tf == null ? '' : tf).trim().replace(/^(\d+)m$/, '$1'));
  if (!m) return 6e4;
  const n = Number(m[1] || 1), u = (m[2] || '').toUpperCase();
  return n * (u === 'S' ? 1e3 : u === 'D' ? 864e5 : u === 'W' ? 6048e5 : u === 'M' ? 2592e6 : 6e4);
}
export function msToTf(ms){
  if (ms >= 2592e6) return Math.round(ms / 2592e6) + 'M';
  if (ms >= 6048e5 && ms % 6048e5 === 0) return (ms / 6048e5 === 1 ? '' : ms / 6048e5) + 'W';
  if (ms >= 864e5) return (ms / 864e5 === 1 ? '' : ms / 864e5) + 'D';
  return String(Math.max(1, Math.round(ms / 6e4)));
}
const typeOf = (sym) => (/^(binance|bybit|okx|kraken|bitget|hyperliquid|coinbase|vest|crypto):/i.test(sym) ? 'crypto' : isFutures(sym) ? 'futures' : 'stock');

// higher timeframe / other symbol bars: through the chart's own fetchSeries
async function loadNeeds(req, need, bars){
  const out = {}, mk = req.market || {}, chartSym = mk.symbol || '', n = bars.time.length;
  if (!n || !req.fetchSeries) return out;
  const prefix = (/^([a-z_]+):/i.exec(chartSym) || [])[1];
  await Promise.all(cap(need, 16).map(async (q) => {
    let sym = q.symbol ? String(q.symbol) : chartSym;
    if (q.symbol && prefix && !/^[a-z_]+:/i.test(sym)) sym = prefix + ':' + sym;
    try {
      const pad = Math.max(q.ms * 60, 864e5 * 3);   // enough earlier bars for the first higher-timeframe values
      const got = await req.fetchSeries(sym, msToTf(q.ms), { from: Math.max(1, bars.time[0] - pad), to: bars.time[n - 1] + q.ms, limit: 5000 });
      if (Array.isArray(got) && got.length) out[q.key] = columns(got);
    } catch (e) { notice('Could not load ' + (q.symbol || 'the chart symbol') + ' at ' + msToTf(q.ms) + '. The study shows no values for it.'); }
    if (!out[q.key]) out[q.key] = { time: [], open: [], high: [], low: [], close: [], volume: [] };
  }));
  return out;
}

const notified = new Set();
function notice(text){
  if (!text || notified.has(text)) return;
  notified.add(text);
  try { window.showToast && window.showToast('info', String(text).slice(0, 300), { duration: 6000 }); } catch (e) {}
}
// Alert(condition, text, Alert.BAR | ONCE | TRIGGER, Sound.X) on the last bar -> a chart toast and a sound
function fireAlerts(sess, list, t, title){
  for (const a of cap(list, 20)) {
    const key = a.type === 'ONCE' ? 'once:' + a.text : a.type === 'TRIGGER' ? null : 'bar:' + t + ':' + a.text;
    if (key && sess.has(key)) continue;
    if (key) sess.add(key);
    if (!sess.primed) continue;   // the first run after adding only remembers what is already true
    try { window.showToast && window.showToast('info', (title ? title + ': ' : '') + (a.text || 'Alert'), { duration: 6000 }); } catch (e) {}
    if (a.sound && !/^nosound$/i.test(a.sound)) { try { window.__stkAlerts && window.__stkAlerts.sound('indicator'); } catch (e) {} }
  }
  sess.primed = true;
}

// engine output -> chart model (the Zscript reader does the drawing), plus line styles it does not carry
function model(out, bars, id, prepared, inputs){
  const m = toModel(out, bars, id, prepared, inputs);
  const byId = new Map((out.plots || []).map((p) => [id + ':p:' + p.id, p]));
  for (const s of m.series) { const p = byId.get(s.id); if (p && (p.lineStyle === 'dashed' || p.lineStyle === 'dotted')) s.style.lineStyle = p.lineStyle; }
  return m;
}

export class TsEngine {
  constructor(){ this.language = LANG; this.capabilities = { streaming: false, visibleRange: false, inputs: true, props: false }; }
  async prepare(source, instanceId){
    if (String(source).length > SRC_MAX) throw tsError({ line: 1, col: 1, message: 'This study is longer than 256 KB.' });
    const r = await analyzeIn(source), k = isThinkscript(source) ? 1 : 0;
    if (!r.ok || firstError(r.diagnostics)) throw tsError(shift(firstError(r.diagnostics) || { line: 1, col: 1, message: 'The study did not compile.' }, k));
    const m = r.meta || {};
    return { language: LANG, inputs: cleanInputs(m.inputs), meta: { title: titleOf(source), overlay: !m.lower }, reactsToViewport: false,
      token: { source: body(source), instanceId, k, title: titleOf(source) } };
  }
  execute(req, handlers){
    let runner = null, stopped = false, busy = false, dirty = false;
    let inputs = Object.assign({}, req.inputs || {});
    const tok = req.prepared.token, alerts = new Set();
    const fail = (d) => { if (stopped) return; stopped = true; if (runner) runner.dispose(); try { handlers.onError && handlers.onError(tsError(d ? shift(d, tok.k) : { line: 1, col: 1, message: 'The thinkScript engine stopped.' })); } catch (e) {} };
    const run = async () => {
      if (stopped) return;
      if (busy) { dirty = true; return; }
      busy = true; dirty = false;
      try {
        if (!runner) { const { TsRunner } = await engine(); runner = new TsRunner(); }
        const bars = columns((req.getBars ? req.getBars() : req.bars) || []);
        const mk = req.market || {}, sym = mk.symbol || '';
        const q = { source: tok.source, bars, inputs: runInputs(inputs), symbol: sym, tfMs: tfToMs(mk.timeframe), futuresDay: isFutures(sym), utcDay: typeOf(sym) === 'crypto' };
        let out = await runner.run(q);
        if (!stopped && out && out.ok && out.need && out.need.length) out = await runner.run(Object.assign(q, { bars: columns((req.getBars ? req.getBars() : req.bars) || []), securities: await loadNeeds(req, out.need, bars) }));
        if (stopped) return;
        if (!out || out.ok === false) { fail((out && out.error) || null); return; }
        let mdl;
        try { mdl = model(out, bars, tok.instanceId, req.prepared, inputs); } catch (e) { console.warn('TradeZoro: thinkScript model', e); fail({ line: 1, col: 1, message: 'The study produced output the chart cannot draw.' }); return; }
        try { handlers.onModel(mdl); } catch (e) { console.warn('TradeZoro: thinkScript model', e); }
        cap(out.notices, 5).forEach(notice);
        fireAlerts(alerts, out.tsAlerts, out.time, tok.title);
      } catch (e) {
        if (!stopped) { if (runner) { runner.dispose(); runner = null; } fail(e && e.message === 'disposed' ? null : { line: 1, col: 1, message: e && e.user ? e.message : 'The thinkScript engine stopped. Remove the study and add it again.' }); }
      } finally {
        busy = false;
        if (dirty && !stopped) setTimeout(run, 0);
      }
    };
    run();
    return {
      getContext: () => Promise.resolve(null),
      stop: () => { stopped = true; if (runner) runner.dispose(); runner = null; },
      update: (vals) => { inputs = Object.assign({}, vals || {}); run(); },
      setVisibleRange: () => {},
      notifyBars: () => { run(); }
    };
  }
  terminate(){ if (checker) { checker.dispose(); checker = null; } }
}

// ---------- chart side ----------
let getWs = () => null;
const tsHandles = (chart) => { try { return chart.indicators().filter((h) => isThinkscript(h.source) && !h.nativeType); } catch (e) { return []; } };
function changed(){ try { const ws = getWs(); if (ws) ws.context().stateChanged(); } catch (e) {} }
function snapshot(h){ let inputs = {}; try { inputs = h.inputValues() || {}; } catch (e) {} const o = { name: titleOf(h.source), source: h.source, inputs }; if (h.visible === false) o.hidden = true; return o; }
function cleanEntry(x){
  if (!x || typeof x !== 'object' || !isThinkscript(x.source) || x.source.length > SRC_MAX) return null;
  const inputs = {};
  if (x.inputs && typeof x.inputs === 'object') Object.keys(x.inputs).slice(0, MAX_INPUTS).forEach((k) => {
    const v = x.inputs[k];
    if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 4096)) inputs[k] = v;
  });
  const o = { source: x.source, inputs };
  if (x.hidden === true) o.hidden = true;
  return o;
}
export function installThinkscript(core, wsGetter){
  getWs = wsGetter;
  try { core.registerDefaultEngine(LANG, () => new TsEngine()); } catch (e) { console.warn('TradeZoro: thinkScript engine', e); }
  try {
    core.registerStatePersistence({
      key: EXT_KEY, scope: 'cell',
      serialize(ctx){ const l = tsHandles(ctx.chart).map(snapshot); return l.length ? l : undefined; },
      restore(payload, ctx){
        const chart = ctx.chart;
        tsHandles(chart).forEach((h) => { try { h.remove(); } catch (e) {} });
        if (!Array.isArray(payload)) return;
        payload.map(cleanEntry).filter(Boolean).slice(0, MAX_PER_CELL).forEach((x) => {
          try { const h = chart.addIndicator(x.source, { language: LANG, inputs: x.inputs }); if (h && x.hidden) h.setVisible(false); } catch (e) { console.warn('TradeZoro: thinkScript restore', e); }
        });
      }
    });
  } catch (e) { console.warn('TradeZoro: thinkScript persistence', e); }
}
// Run a study on a chart. Resolves { ok, handle } or { ok:false, msg, diag } (diag lines are the editor's, without the header).
export async function runOnChart(chart, source, name){
  const src = withHeader(source, name || titleOf(source));
  if (src.length > SRC_MAX) return { ok: false, msg: 'This study is longer than 256 KB.' };
  if (tsHandles(chart).length >= MAX_PER_CELL) return { ok: false, msg: 'This chart already has ' + MAX_PER_CELL + ' thinkScript studies. Remove one first.' };
  const kill = () => document.querySelectorAll('.vela-toast[data-type="error"][data-open]').forEach((t) => { delete t.dataset.open; });
  const res = await chart.runIndicator(src, { language: LANG });
  if (!res.ok) {
    kill(); setTimeout(kill, 60); setTimeout(kill, 400);
    const d = res.error && res.error.diag;
    const dd = d ? shift(d, -1) : null;
    return { ok: false, msg: dd ? diagText(dd) : String((res.error && res.error.message) || 'The study did not run.'), diag: dd };
  }
  changed();
  return { ok: true, handle: res.handle };
}

// ---------- My scripts: this browser only (localStorage), like the Zscript store before cloud saving ----------
const STORE_KEY = 'stryker_thinkscripts_v1', STORE_MAX = 50;
const Store = {
  all(){ try { const a = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); return Array.isArray(a) ? a.filter((x) => x && typeof x.id === 'string' && typeof x.source === 'string') : []; } catch (e) { return []; } },
  put(a){ try { localStorage.setItem(STORE_KEY, JSON.stringify(a)); } catch (e) { throw Object.assign(new Error('x'), { userMessage: 'This browser did not let us save. Free some space and try again.' }); } },
  save(name, source, id){
    name = clean(name); source = body(source);
    if (!name) throw Object.assign(new Error('x'), { userMessage: 'Give the study a name.' });
    if (!source.trim()) throw Object.assign(new Error('x'), { userMessage: 'The study is empty.' });
    if (source.length > SRC_MAX) throw Object.assign(new Error('x'), { userMessage: 'This study is too long to save (limit 256 KB).' });
    const a = Store.all(), now = Date.now(), x = id && a.find((t) => t.id === id);
    if (x) { x.name = name; x.source = source; x.updatedAt = now; }
    else { if (a.length >= STORE_MAX) throw Object.assign(new Error('x'), { userMessage: 'You have ' + STORE_MAX + ' saved studies. Delete one first.' }); id = 't' + now.toString(36) + Math.random().toString(36).slice(2, 6); a.unshift({ id, name, source, updatedAt: now }); }
    Store.put(a);
    return id;
  },
  remove(id){ Store.put(Store.all().filter((t) => t.id !== id)); },
  rename(id, name){ const a = Store.all(), x = a.find((t) => t.id === id); if (x && clean(name)) { x.name = clean(name); Store.put(a); } }
};

// ---------- editor highlighting: thinkScript tokens (# comments, case-insensitive keywords) ----------
let langP = null;
function tsLanguage(){
  if (!langP) langP = import('./zs-editor/cm6.js?v=1220').then(({ StreamLanguage, tags }) => {
    const KW = new Set(['def', 'rec', 'plot', 'input', 'declare', 'script', 'if', 'then', 'else', 'switch', 'case', 'default', 'fold', 'to', 'with', 'while', 'do', 'and', 'or', 'crosses', 'above', 'below', 'reference', 'not']);
    const ATOMS = new Set(['yes', 'no', 'true', 'false']);
    const NS = new Set(['color', 'paintingstrategy', 'curve', 'averagetype', 'aggregationperiod', 'alert', 'sound', 'double', 'crossingdirection', 'fundamentaltype', 'pricetype']);
    return StreamLanguage.define({
      name: 'thinkscript',
      startState: () => ({ ind: 0, open: false }),
      copyState: (s) => ({ ind: s.ind, open: s.open }),
      token(stream, state){
        if (stream.sol() && /\S/.test(stream.string)) { state.ind = stream.indentation(); state.open = /\{\s*(?:#.*)?$/.test(stream.string); }
        if (stream.eatSpace()) return null;
        if (stream.match(/^#@thinkscript\b.*/)) return 'meta';
        if (stream.match('#')) { stream.skipToEnd(); return 'comment'; }
        if (stream.peek() === '"') { stream.next(); let c; while ((c = stream.next()) != null) if (c === '"') break; return 'string'; }
        if (stream.match(/^(?:\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+)/)) return 'number';
        if (stream.match(/^[A-Za-z_][\w]*/)) {
          const w = stream.current().toLowerCase();
          if (KW.has(w)) return 'keyword';
          if (ATOMS.has(w)) return 'atom';
          if (stream.peek() === '.' && NS.has(w)) return 'namespace';
          if (/^\s*\(/.test(stream.string.slice(stream.pos))) return 'function';
          return 'variableName';
        }
        if (stream.match(/^(?:==|!=|<>|<=|>=|&&|\|\||[-+*/%<>=!^])/)) return 'operator';
        stream.next();
        return null;
      },
      indent: (state, after) => Math.max(0, state.ind + (state.open ? 2 : 0) - (/^\s*\}/.test(after) ? 2 : 0)),
      languageData: { commentTokens: { line: '#' }, indentOnInput: /^\s*\}$/ },
      tokenTable: { meta: tags.meta, namespace: tags.namespace, function: tags.function(tags.variableName) }
    });
  });
  return langP;
}
let builtinsP = null;
function loadBuiltins(){
  if (!builtinsP) builtinsP = import('./ts/catalog.js?v=1220').then((m) => m.catalog()).catch(() => []);
  return builtinsP;
}

// ---------- editor panel ----------
export function mountThinkscript(ws, opts){
  const toast = (opts && opts.toast) || (() => {});
  const tfLabel = (opts && opts.tfLabel) || ((t) => t);
  const host = document.querySelector('.stkchart-panel') || document.body;
  const pineBtn = document.getElementById('stkc-pine-btn');
  const Z = () => window.STRYKER_ZS;

  const S = createShell({
    id: 'stkc-ts', cls: 'stkc-zs stkc-ts', label: 'thinkScript editor', closeLabel: 'Close the thinkScript editor',
    note: 'Paste a thinkScript study and add it to the chart. It runs in your browser on the chart\'s bars, in a sandbox with no access to your account. Education only. Not financial advice.',
    moreItems: [['dup', 'Duplicate'], ['export', 'Export .ts'], ['import', 'Import file…'], ['help', 'What is supported'], ['delete', 'Delete', true]],
    onClose: () => { setOpen(false); if (pineBtn) pineBtn.focus(); },
    onWrap: (on) => { if (ed) ed.setWrap(on); },
    onFind: () => { ensureEditor().then((e) => e.find()).catch(() => {}); },
    onMore: (k) => more(k),
    onMenu: (menu) => { menu.querySelector('[data-k="delete"]').disabled = !editingId; },
    onTab: (k) => { if (k === 'docs') renderDocsTab(); },
    onView: (v) => { if (v === 'code' && ed) ed.focus(); }
  });
  const { panel, nameIn, target, edHost, addBtn, saveBtn, newBtn, panes } = S;
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
    target.title = 'Add to chart puts the study on ' + target.textContent;
  }
  const onChartNow = () => { const a = activeCell(); return !!(handle && a.cell && tsHandles(a.cell.chart).includes(handle)); };
  function renderPrimary(){ if (!busy) S.setPrimary(onChartNow() ? 'Update on chart' : 'Add to chart'); }
  function renderStatus(){
    if (busy) return;
    const cur = ed ? ed.get() : base.src, dirty = cur !== base.src || nameIn.value.trim() !== base.name;
    S.setStatus(compileErr ? 'error' : !dirty && kind === 'mine' ? 'saved' : !dirty && kind === 'example' ? 'example' : !dirty && kind === 'chart' ? 'idle' : 'unsaved');
    renderPrimary();
  }
  const jump = (l, c) => { if (ed) { S.setView('code'); ed.goto(l, c); ed.focus(); } };
  function showCompile(r){
    const diags = (r && r.diagnostics) || [];
    const errs = diags.filter((d) => d && d.severity !== 'warning'), warns = diags.filter((d) => d && d.severity === 'warning');
    compileErr = !r || !r.ok || errs.length > 0;
    if (compileErr) S.problems.head('err', errs.length === 1 ? '1 problem' : (errs.length || 1) + ' problems');
    else { const n = (r.meta && r.meta.plots) ? r.meta.plots.length : 0; S.problems.head('ok', 'Checked OK · ' + n + (n === 1 ? ' plot' : ' plots') + (warns.length ? ' · ' + warns.length + (warns.length === 1 ? ' note' : ' notes') : '')); }
    S.problems.list(errs.concat(warns).slice(0, 20).map((d) => ({ text: diagText(d), line: d.line, col: d.col })), jump);
    renderStatus();
  }
  async function lint(src){ const r = await analyzeIn(src); if (ed && ed.get() === src) showCompile(r); return (r.diagnostics || []).filter((d) => d.severity !== 'warning'); }
  function stopLint(){ if (checker) { checker.dispose(); checker = null; } }

  function ensureEditor(){
    if (!edP) {
      edP = Promise.all([import('./zs-editor/editor.js?v=1220'), loadBuiltins(), tsLanguage()]).then(([m, builtins, language]) => {
        builtinsAll = builtins;
        edHost.innerHTML = '';
        const first = TS_EXAMPLES[0];
        ed = m.createZsEditor(edHost, { doc: draft != null ? draft : first.source, builtins, lint, language, ariaLabel: 'thinkScript source', wrap: S.wrap(), onRun: () => addToChart(), onSave: () => save(), onChange: () => { renderStatus(); } });
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
    S.problems.list([{ text: d ? diagText(d) : text, line: d && d.line, col: d && d.col }], jump);
    if (d) { compileErr = true; renderStatus(); }
    if (d && ed) { ed.showDiagnostics([d]); ed.goto(d.line, d.col); }
  }
  async function load(name, source, id, k, h){
    nameIn.value = name || ''; editingId = id || null; draft = body(source);
    kind = k || (id ? 'mine' : 'new'); handle = h || null; compileErr = false;
    base = { name: (name || '').trim(), src: draft };
    const e = await ensureEditor(); e.set(draft); showErr(null);
    S.problems.head('busy', 'Checking…');
    if (isPhone() || !S.isWide()) S.setView('code');
    renderStatus();
  }
  async function addToChart(){
    if (busy) return;
    const e = await ensureEditor();
    const src = e.get();
    if (!src.trim()) { showErr(null, 'The study is empty.'); return; }
    const a = activeCell(); if (!a.cell) return;
    const old = onChartNow() ? handle : null;
    const name = nameIn.value.trim() || titleOf(src);
    busy = true; addBtn.disabled = true; S.setPrimary('Running…'); S.setStatus('running'); showErr(null);
    try {
      if (old) { try { old.remove(); } catch (er) {} }
      const r = await runOnChart(a.cell.chart, src, name);
      if (r.ok) { handle = r.handle; toast((old ? 'Updated ' : 'Added ') + clean(name) + (old ? ' on the chart' : ' to the chart')); if (isPhone()) setOpen(false); }
      else {
        if (old) { try { handle = (await runOnChart(a.cell.chart, old.source, titleOf(old.source))).handle || null; } catch (er) { handle = null; } }
        showErr(r.diag, r.diag ? null : r.msg);
      }
    } catch (err) { console.warn('TradeZoro: thinkScript run', err); showErr(null, 'The thinkScript engine did not start. Reload the page and try again.'); }
    busy = false; addBtn.disabled = false; renderStatus();
    renderLists();
  }
  async function save(){
    const e = await ensureEditor();
    let name = nameIn.value.trim();
    if (!name) { name = titleOf(e.get()); if (name === 'thinkScript') name = ''; nameIn.value = name; }
    if (!name) { nameIn.focus(); showErr(null, 'Give the study a name first.'); return; }
    try { editingId = Store.save(name, e.get(), editingId); kind = 'mine'; base = { name: clean(name), src: e.get() }; nameIn.value = clean(name); toast('Study saved in this browser'); renderStatus(); }
    catch (err) { showErr(null, (err && err.userMessage) || 'Could not save the study.'); }
    renderLists();
  }
  const copyName = (n) => (String(n || 'Study').slice(0, 54) + ' copy');
  async function more(k){
    const e = await ensureEditor().catch(() => null); if (!e) return;
    if (k === 'dup') { await load(copyName(nameIn.value.trim() || titleOf(e.get())), e.get(), null, 'new'); nameIn.focus(); nameIn.select(); }
    else if (k === 'export') download(fileName(nameIn.value.trim() || titleOf(e.get()), '.ts'), e.get());
    else if (k === 'import') { const f = await pickFile('.ts,.txt,text/plain'); if (!f) return; if (f.error) { showErr(null, f.error); return; } await load(f.name, f.text, null, 'new'); }
    else if (k === 'help') window.open('/help/thinkscript-on-tradezoro', '_blank', 'noopener');
    else if (k === 'delete' && editingId) {
      if (!window.confirm('Delete the study "' + (nameIn.value.trim() || 'this study') + '"? It stays on any chart it is already on.')) return;
      Store.remove(editingId); editingId = null; kind = 'new'; toast('Study deleted'); renderStatus(); renderLists();
    }
  }
  addBtn.addEventListener('click', addToChart);
  saveBtn.addEventListener('click', save);
  const newOne = () => load('', NEW_SRC, null, 'new').then(() => nameIn.focus());
  newBtn.addEventListener('click', newOne);
  nameIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); if (ed) ed.focus(); } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } });
  nameIn.addEventListener('input', renderStatus);

  const A = (label, icon, fn, cls) => ib(label, icon, fn, cls);
  function docsList(){
    return builtinsAll.filter((b) => b.kind === 'function' || b.kind === 'study' || (b.kind === 'variable' && b.doc))
      .map((b) => ({ name: b.name, sig: b.sig, doc: b.doc, insert: b.kind === 'variable' ? b.name : b.name + '()', back: b.kind === 'variable' ? 0 : 1 }));
  }
  function renderDocsTab(){
    const list = docsList();
    renderDocs(panes.docs, list, S.docsSearch.value, (txt) => { const b = list.find((x) => x.insert === txt); ensureEditor().then((e) => { S.setView('code'); e.insert(txt, b ? b.back : 0); }); });
    S.setCount('docs', 0);
  }
  S.docsSearch.addEventListener('input', renderDocsTab);
  S.docsSearch.addEventListener('keydown', (e) => e.stopPropagation());
  function renderLists(){
    renderTarget(); renderPrimary();
    const a = activeCell(), hs = a.cell ? tsHandles(a.cell.chart) : [];
    lists.chart.innerHTML = '';
    if (!hs.length) lists.chart.appendChild(emptyState('No thinkScript studies on this chart yet. Open an example or paste your own, then Add to chart.', 'New study', newOne));
    hs.forEach((h) => {
      const nm = titleOf(h.source);
      lists.chart.appendChild(libRow({ name: nm, badge: h === handle ? 'Open' : null, desc: descOf(h.source), onOpen: () => load(nm, h.source, null, 'chart', h),
        actions: [A('Open ' + nm + ' in the editor', ICONS.open, () => load(nm, h.source, null, 'chart', h)), A('Remove ' + nm + ' from the chart', ICONS.del, () => { try { h.remove(); } catch (e) {} if (h === handle) handle = null; changed(); renderLists(); }, 'stkc-del')] }));
    });
    S.setCount('chart', hs.length);
    lists.examples.innerHTML = '';
    TS_EXAMPLES.forEach((x) => lists.examples.appendChild(libRow({ name: x.name, badge: 'Example', desc: descOf(x.source), onOpen: () => load(x.name, x.source, null, 'example'),
      actions: [A('Open ' + x.name, ICONS.open, () => load(x.name, x.source, null, 'example')), A('Add ' + x.name + ' to the chart', ICONS.add, () => { load(x.name, x.source, null, 'example').then(addToChart); }), A('Duplicate ' + x.name + ' as a new study', ICONS.copy, () => load(copyName(x.name), x.source, null, 'new'))] })));
    S.setCount('examples', TS_EXAMPLES.length);
    const mine = Store.all();
    lists.mine.innerHTML = '';
    if (!mine.length) lists.mine.appendChild(emptyState('No saved studies yet. Paste one, give it a name, then Save (' + (/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+') + 'S). Studies save in this browser.', 'New study', newOne));
    mine.forEach((t) => lists.mine.appendChild(libRow({ name: t.name, badge: t.id === editingId ? 'Open' : null, desc: ago(t.updatedAt) + (descOf(t.source) ? ' · ' + descOf(t.source) : ''), onOpen: () => load(t.name, t.source, t.id, 'mine'),
      actions: [
        A('Add ' + t.name + ' to the chart', ICONS.add, () => { load(t.name, t.source, t.id, 'mine').then(addToChart); }),
        A('Duplicate ' + t.name, ICONS.copy, () => load(copyName(t.name), t.source, null, 'new')),
        A('Rename ' + t.name, ICONS.ren, () => { const v = window.prompt('Rename the study', t.name); if (!v || !v.trim()) return; Store.rename(t.id, v); if (editingId === t.id) { nameIn.value = clean(v); base.name = clean(v); } renderLists(); renderStatus(); }),
        A('Delete ' + t.name, ICONS.del, () => { if (!window.confirm('Delete the study "' + t.name + '"? It stays on any chart it is already on.')) return; Store.remove(t.id); if (editingId === t.id) { editingId = null; kind = 'new'; renderStatus(); } renderLists(); }, 'stkc-del')
      ] })));
    S.setCount('mine', mine.length);
  }

  const otherOpen = () => [...document.querySelectorAll('.stkc-pine.sed')].some((p) => p !== panel && !p.hidden);
  function setOpen(open){
    panel.hidden = !open;
    S.setOpenState(open);
    document.body.classList.toggle('stkc-pine-open', open || otherOpen());
    if (pineBtn) pineBtn.setAttribute('aria-expanded', open || otherOpen() ? 'true' : 'false');
    if (open) { renderLists(); ensureEditor().then((e) => { if (!isPhone()) e.focus(); }).catch(() => {}); }
    else stopLint();
  }
  // the language switch lives in chart-zscript.js; this panel registers itself as one more language
  if (Z() && Z().addLang) {
    Z().addLang('ts', 'thinkScript', { open: () => setOpen(true), close: () => setOpen(false), isOpen: () => !panel.hidden });
    S.segSlot.appendChild(Z().langSwitch('ts'));
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
  async function addSource(name, source){
    const a = activeCell();
    if (!a.cell) return { ok: false, msg: 'No chart to add it to.' };
    const r = await runOnChart(a.cell.chart, source, name);
    if (r.ok) { toast('Added ' + clean(name || titleOf(source)) + ' to the chart'); if (!panel.hidden) renderLists(); }
    return r;
  }
  window.STRYKER_TS = {
    open: (src, name) => { if (Z() && Z().switchLang) Z().switchLang('ts'); else setOpen(true); if (src != null) load(name || '', src, null); },
    close: () => setOpen(false), load, addToChart, addSource, runOnChart, handles: tsHandles, titleOf, isThinkscript, examples: TS_EXAMPLES, store: Store
  };
  return { setOpen };
}
