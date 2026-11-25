// TradeZoro — Charts: Pine Script glue (charts.html) — ES module
// Depends on: assets/chart-script-editor.js (editor panel layout) + assets/zs-editor/editor.js (code editor, lazy); assets/vela-chart.js (calls installPine before the workspace is built and
// mountPine after); assets/chart-pine-scripts.js (window.StrykerPineScripts: saved scripts
// + the three example scripts); the import map in charts.html ("pinets",
// "@luxalgo/vela/plugin").
//
// WHAT THIS FILE IS: the only TradeZoro code that touches the Pine Script engine. It wires
// the engine into the Vela chart cells and draws the editor panel. Nothing else.
//
// LICENCE (AGPL-3.0): Pine Script support comes from two LuxAlgo packages that are
// AGPL-3.0-only: @luxalgo/vela-pinets (the Vela engine adapter) and pinets (the PineTS
// runtime). They are loaded UNMODIFIED from jsDelivr at exact pinned versions, lazily
// (only when a member opens the Pine editor or a chart/template carries a Pine
// indicator), and never copied into this repo. Source links are in the (i) Credits
// popover (charts.html #stkc-credits), together with a link to this file's source.
// Never vendor, patch or minify-in their code; if a fix is needed, pin another version.
//
// VERSIONS: Vela is 0.6.17. vela-pinets 0.2.11 is the newest release whose peer range
// accepts it (^0.6.11 || ^0.7.0); 0.2.12+ need Vela 0.7.x/0.8.x. pinets (import map, used by the in-process fallback engine) is pinned in charts.html; 0.9.33 was the
// newest runtime published before vela-pinets 0.2.11 (it was built against ^0.9.32).
// The worker engine inlines its own PineTS copy, so the main-thread pinets is only used
// for module resolution.
//
// FALLBACK (build 404): the worker inlines its own PineTS from vela-pinets' build (0.9.3x),
// which lacks newer built-ins such as `scale.*`. A script the worker rejects with
// "X is not defined" is retried once on the in-process PineEngine, which runs the newer
// pinets pinned in charts.html' import map; such scripts are recorded as engine:'main'.
// The in-process engine runs on the page thread and can't be interrupted mid-run;
// PineTS' own loop guard still applies.
//
// NEXT ENGINE (build 456): assets/chart-pine-next.js + chart-pine-next-worker.js run the
// newer pinets (0.11.0, same as the import map) inside a module Web Worker, language id
// 'pine-next'. A script the old worker rejects is retried there first (off the page thread);
// the in-process engine is now only the last resort when module workers are unavailable.
// The built-in TradeZoro Pine indicators (chart-pine-builtins.js) run on it directly.
//
// HOW IT RUNS: off the page thread, in Web Workers. NO TIME LIMIT (Owner 22 Nov: "remove the limit
// altogether"): a script runs as long as it needs. After 3 s the editor shows "Calculating… NN%" with
// Cancel and the legend row a small chip with ×; only Cancel, removing the indicator or closing the
// chart stops it. Every member / community script runs in its OWN worker (chart-pine-next.js lanes,
// classicLanes below), so a long one never holds up the others and stopping it terminates just that
// worker. Built-in TradeZoro indicators share one worker as before. PineTS itself still aborts runaway
// loops ("Loop exceeded maximum iterations"), and real errors show at once.
//
// PERSISTENCE: Vela's shell does not persist script indicators added through the
// public API, so a cell-scope persistence handler ('stryker.pine') writes each cell's
// Pine indicators (name, source, inputs) into the workspace document. That puts them in
// the persist:true session AND in saved templates, and restores them on load.

import { pineFetchSym } from './chart-sym.js?v=1270';
import { builtinSource, builtinIdOf, builtinOfText, builtinIdByName } from './chart-pine-builtins.js?v=1270';
import { current as verCurrent, baseOf as verBase, verOf as verPinned } from './indicator-versions.js?v=1270';
import { createShell, el, ib, ICONS, libRow, emptyState, renderDocs, descOf, ago, download, pickFile, fileName } from './chart-script-editor.js?v=1270';

const PINE_PKG = '/assets/vendor/vela-pinets-0.2.11/index.js';
const CALC_AFTER_MS = 3000;   // a run longer than this shows "Calculating… NN%" (editor) and the legend chip
const MAX_PER_CELL = 8;
const SRC_MAX = 262144;
const BUILTIN_SRC_MAX = 131072;
const EXT_KEY = 'stryker.pine';

let enginePromise = null;   // resolves to the vela-pinets module
let Core = null;
let getWs = () => null;
const engines = new WeakMap(); // chart -> PineWorkerEngine
const mainEngines = new WeakMap(); // chart -> in-process PineEngine (fallback)
const onMain = new WeakSet();      // handles running on the in-process engine
// Community scripts on a chart: handle -> { id, version, openSource, ownerUid, name }.
// They always run on the Web Worker engine (never the in-page fallback) and are checked by
// StrykerPineGuard first; see assets/chart-pine-guard.js for why.
const libOf = new WeakMap();
// Community indicators from the Creator Hub (sealed): handle -> { cid, iid, name, version, logo }. Their text never
// reaches this page; the chart state stores only a stub with a reference, and every load asks /api/creator/ind again
// (access is re-checked by the server each time; an ended membership simply stops loading).
const sealOf = new WeakMap();
const guardOk = (src) => { try { return !!(window.StrykerPineGuard && window.StrykerPineGuard.check(src).ok); } catch (e) { return false; } };
// Language ids. LANG_MAIN is our own registry key for the in-process engine.
const LANG = 'pine';
const LANG_MAIN = 'pine-main';
const LANG_NEXT = 'pine-next';
const nextEngines = new WeakMap(); // chart -> PineNextEngine (newer pinets in a module worker)
const onNext = new WeakSet();      // handles running on the next engine
let NextMod = null;
function loadNext(){
  if (!NextMod) NextMod = import('./chart-pine-next.js?v=1270').catch((e) => { NextMod = null; throw e; });
  return NextMod;
}
// TradingView-style painting of Pine drawings (assets/chart-pine-tv-style.js); once per chart.
let TvStyle = null;
async function tvStyle(chart){
  try {
    if (!TvStyle) TvStyle = import('./chart-pine-tv-style.js?v=1270');
    (await TvStyle).installTvStyle(chart);
  } catch (e) { TvStyle = null; }
}
// An indicator left the chart: drop its worker lane at once (an idle lane otherwise lingers a few seconds).
const dropHooked = new WeakSet();
function hookDrop(chart){
  if (dropHooked.has(chart)) return; dropHooked.add(chart);
  calcCss();
  try { chart.on('indicator:removed', ({ id }) => { [nextEngines.get(chart), engines.get(chart)].forEach((e) => { try { if (e && e.dropInstance) e.dropInstance(id); } catch (x) {} }); setTimeout(calcTick, 0); }); } catch (e) {}
}
async function ensureNext(chart){
  tvStyle(chart); hookDrop(chart);
  const m = await loadNext();
  if (!nextEngines.has(chart)) {
    const e = wrapAlerts(new m.PineNextEngine({ props: 'strategy', isolate: (src) => !builtinIdOf(src), onRun: calcKick }));
    chart.registerEngine(LANG_NEXT, e);
    nextEngines.set(chart, e);
    try { e.w(); } catch (x) {}   // LAYOUT-PERF: start the worker (it downloads the engine) now, not at the first run
  }
  return nextEngines.get(chart);
}


// INDICATOR ALERTS ARE SILENT BY DEFAULT (Owner 2026-10-22: "why getting alerts for indicators, add alert
// setting to indicators like tradingview"). Every engine we hand to Vela is wrapped so a script's
// alertcondition()/alert() calls never reach Vela's own toast/bell, and never toast on their own. Each
// call is passed to assets/chart-alerts.js (window.__stkIndAlerts.event), which fires ONLY the alerts
// the member created for that indicator condition in the Create alert dialog (TradingView behaviour).
// The first model of a session marks it "primed": calls made while history loads are ignored.
function routeAlert(req, alert, sess, kind){
  try { const R = window.__stkIndAlerts; if (R && R.event) R.event({ req, alert, sess, kind }); } catch (e) {}
}
// EXCHANGE-FORM SYMBOLS IN request.security (member UnoMas 23 Nov: an ADR dashboard reading daily bars of
// "CME_MINI:MNQ1!", "CME_MINI:MES1!", "CBOT_MINI:MYM1!" showed "-" in every cell on TradeZoro, fine on TradingView).
// Those are the names TradingView's symbol input gives; our feed registry only knows "futures:MNQ1!", so the fetch
// found no provider and returned no bars. Every futures form is folded to our provider form here (pineFetchSym in
// chart-sym.js); other symbols, and a chart-type suffix (";heikinashi"), pass through.
function wrapAlerts(eng){
  if (!eng || eng.__stkAlertWrap || typeof eng.execute !== 'function') return eng;
  const run = eng.execute.bind(eng);
  eng.execute = (req, h) => {
    h = h || {};
    const rawFetch = req && req.fetchSeries;
    const runReq = rawFetch ? Object.assign({}, req, { fetchSeries: (sym, tf, range) => rawFetch(pineFetchSym(sym), tf, range) }) : req;
    const sess = { primed: false, seen: new Set() };
    const hh = Object.assign({}, h, {
      onAlert: (a) => routeAlert(req, a, sess, 'alert'),
      onModel: (m) => { const r = h.onModel ? h.onModel(m) : undefined; routeAlert(req, null, sess, 'model'); return r; }
    });
    return run(runReq, hh);
  };
  eng.__stkAlertWrap = true;
  return eng;
}

// SAFARI (UnoMas bug 22 Nov: every Pine script, even a 10-line SMA, failed with "heavy for this device").
// vela-pinets' PineWorkerEngine starts its worker with new Worker(blobUrl) and revokes the blob URL on the
// very next line. Chromium/Firefox have read the URL by then; WebKit (Safari, every iOS browser) loads the
// worker script later, finds the URL gone, fires a bare 'error' Event the engine never listens to, and the
// run waits for an answer that never comes. Fix: keep the blob URL alive until the worker has answered
// (or 60 s), and turn a worker that fails to start into a real error (pineStartFailed) instead of a timeout.
let classicFail = null;   // why the classic worker could not start (last failure), or null
function pineStartFailed(why){
  const msg = "Pine couldn't start in this browser: " + (why || 'the script engine did not load') + '.';
  try { console.error('TradeZoro: ' + msg); } catch (e) {}
  // beta-report.js (bug-report button) collects window 'error' events: send it to the error log too
  try { window.dispatchEvent(new ErrorEvent('error', { message: msg, filename: 'chart-pine.js' })); } catch (e) {}
  return msg;
}
function classicEngine(m){
  const eng = new m.PineWorkerEngine({ props: 'strategy' });
  const spawn = eng.spawn;
  eng.spawn = () => {
    const rv = URL.revokeObjectURL, held = [];
    URL.revokeObjectURL = (u) => { held.push(u); };
    let w;
    try { w = spawn(); } finally { URL.revokeObjectURL = rv; }
    let answered = false;
    const free = () => { held.splice(0).forEach((u) => { try { rv.call(URL, u); } catch (e) {} }); };
    const t = setTimeout(free, 60000);
    w.addEventListener('message', () => { if (!answered) { answered = true; classicFail = null; clearTimeout(t); free(); } });
    w.addEventListener('error', (e) => {
      if (answered) return;   // a script error inside a running worker is reported by the engine itself
      classicFail = (e && e.message) || 'the script engine file did not load';
      pineStartFailed(classicFail);
    });
    return w;
  };
  return eng;
}

// CLASSIC LANES (no time limit, Owner 22 Nov): the classic engine is only used for scripts the next engine rejects
// and for community scripts. Each indicator gets its own PineWorkerEngine (own worker, see classicEngine), so a long
// run can be stopped on its own: stop() while it computes terminates that worker; the engine respawns one on the
// next run. A static run is "computing" from execute/update/notifyBars until its done/error/model; a live one until
// its first model after a (re)start.
function classicLanes(m){
  const lanes = new Map();   // instanceId -> { eng, runs: Map(sid -> { since }) }
  let sq = 0;
  const laneOf = (id) => { let L = lanes.get(id); if (!L) { L = { eng: classicEngine(m), runs: new Map() }; lanes.set(id, L); } return L; };
  return {
    language: 'pine',
    capabilities: { streaming: true, visibleRange: true, inputs: true, props: true },
    prepare(source, instanceId){ return laneOf(instanceId).eng.prepare(source, instanceId); },
    calcOf(id){ const L = lanes.get(id); if (!L) return null; let t = 0; L.runs.forEach((r) => { if (r.since && (!t || r.since < t)) t = r.since; }); return t ? { since: t, pct: null } : null; },
    execute(req, h){
      const id = req.prepared && req.prepared.token && req.prepared.token.instanceId, L = laneOf(id), sid = ++sq, r = { since: 0 };
      L.runs.set(sid, r);
      const on = () => { if (!r.since) { r.since = Date.now(); calcKick(); } }, off = () => { if (r.since) { r.since = 0; calcKick(); } };
      on();
      const sess = L.eng.execute(req, Object.assign({}, h, {
        onModel: (x) => { off(); if (h.onModel) h.onModel(x); },
        onDone: () => { off(); if (h.onDone) h.onDone(); },
        onError: (e) => { off(); if (h.onError) h.onError(e); }
      }));
      const busy = (f) => function () { if (req.mode !== 'live' || f === 'update') on(); return sess[f].apply(sess, arguments); };
      return {
        getContext: (sel) => sess.getContext(sel),
        stop: () => {
          const was = !!r.since; off(); L.runs.delete(sid);
          try { sess.stop(); } catch (e) {}
          if (was) { try { L.eng.terminate(); } catch (e) {} }   // its run can't be interrupted: end that worker (respawned on the next run)
          // no session left (removed, or the chart closed: no 'indicator:removed' then): drop the worker after a while
          if (!L.runs.size) setTimeout(() => { if (!L.runs.size && lanes.get(id) === L) { lanes.delete(id); try { L.eng.terminate(); } catch (e) {} } }, 8000);
        },
        update: busy('update'),
        setVisibleRange: (range) => sess.setVisibleRange(range),
        notifyBars: (reason) => { if (reason !== 'backfill' && req.mode !== 'live') on(); return sess.notifyBars(reason); }
      };
    },
    dropInstance(id){ const L = lanes.get(id); if (L && !L.runs.size) { lanes.delete(id); try { L.eng.terminate(); } catch (e) {} } },
    terminate(){ lanes.forEach((L) => { try { L.eng.terminate(); } catch (e) {} }); lanes.clear(); }
  };
}

function loadPine(){
  if (!enginePromise) {
    // The in-process engine (LANG_MAIN) runs the page's pinets (import map): give it the same empty-live-stream guard as the worker (Owner bug 22 Nov, 'openTime' toasts).
    import('pinets').then((pt) => import('./chart-pine-next-patches.js?v=1270').then((p) => p.patchEmptyLive(pt.PineTS))).catch(() => {});
    enginePromise = import(PINE_PKG).then((m) => {
      if (!m || !m.PineWorkerEngine) throw new Error('Pine engine did not load');
      // Cells created from now on (layout widened) get an engine automatically.
      try { Core.registerDefaultEngine(LANG, () => wrapAlerts(classicLanes(m))); } catch (e) {}
      try { Core.registerDefaultEngine(LANG_MAIN, () => wrapAlerts(new m.PineEngine({ props: 'strategy' }))); } catch (e) {}
      return m;
    }).catch((e) => { enginePromise = null; throw e; });
  }
  return enginePromise;
}

async function ensureEngine(chart){
  tvStyle(chart); hookDrop(chart);
  const m = await loadPine();
  if (!engines.has(chart)) {
    const eng = wrapAlerts(classicLanes(m));
    chart.registerEngine(LANG, eng);
    engines.set(chart, eng);
  }
  if (!mainEngines.has(chart)) {
    const e2 = wrapAlerts(new m.PineEngine({ props: 'strategy' }));
    chart.registerEngine(LANG_MAIN, e2);
    mainEngines.set(chart, e2);
  }
  return engines.get(chart);
}

// Add a restored/kept script on the engine it ran on before.
function addOn(chart, x){
  if (x.sealed) { addSealedOn(chart, x.sealed, x.inputs || {}, true).then((r) => { if (!r.ok) toast2(r.msg); else if (x.hidden) hide(r.handle); }); return null; }
  if (x.lib && !guardOk(x.source)) { console.warn('TradeZoro: shared Pine script failed the safety check, not restored'); return null; }
  const main = x.engine === 'main' && !x.lib;
  const next = x.engine === 'next' && !x.lib && nextEngines.has(chart);
  const h = chart.addIndicator(x.source, { language: next ? LANG_NEXT : main ? LANG_MAIN : LANG, inputs: x.inputs || {} });
  if (main && h) onMain.add(h);
  if (next && h) onNext.add(h);
  if (x.lib && h) libOf.set(h, x.lib);
  if (h && x.rightOffset) trackRightOffset(chart, h, x.rightOffset); // saved layouts keep the HTF space
  if (h && x.hidden) hide(h);
  return h;
}
// HIDDEN STAYS HIDDEN (member report 2026-11-08): a script hidden with the legend eye is saved with hidden: true
// and comes back hidden (reload, saved layout, template). Older states have no flag and load visible.
function hide(h){ try { h.setVisible(false); } catch (e) {} }

// Pine indicators on a chart = script handles (natives carry nativeType, no source).
function pineHandles(chart){
  // Zscript (//@zscript 1, assets/chart-zscript.js) and thinkScript (#@thinkscript 1, assets/chart-thinkscript.js) handles and MQL5 ones (OnCalculate, assets/chart-mql5.js) are not Pine.
  try { return chart.indicators().filter((h) => typeof h.source === 'string' && !h.nativeType && !/^\s*(?:\/\/@zscript|#@thinkscript)\s+1\b/.test(h.source) && !/\bOnCalculate\s*\(/.test(h.source)); } catch (e) { return []; }
}
// Vela 0.6.17 leaves a script handle's title at "Indicator"; read the declared one.
function titleOf(h){
  const m = /^\s*(?:indicator|strategy)\s*\(\s*(?:title\s*=\s*)?(["'])((?:\\.|(?!\1).)*)\1/m.exec(String((h && h.source) || ''));
  return (m && m[2].trim().slice(0, 80)) || (h && h.title) || 'Pine script';
}
function snapshot(h){
  let inputs = {};
  try { inputs = h.inputValues() || {}; } catch (e) {}
  const o = { name: titleOf(h), source: h.source, inputs };
  if (onMain.has(h)) o.engine = 'main';
  if (onNext.has(h)) o.engine = 'next';
  if (libOf.has(h)) o.lib = libOf.get(h);
  if (offsetHandles.has(h)) o.rightOffset = offsetHandles.get(h);
  if (sealOf.has(h)) { const z = sealOf.get(h); o.sealed = { cid: z.cid, iid: z.iid, name: z.name, logo: z.logo || '' }; delete o.engine; }
  if (h.visible === false) o.hidden = true;
  return o;
}
// SAVED SETTINGS MUST COME BACK IN FULL (Owner 2026-10-26: "in Liquidity Master, watermark and equal
// high are showing up again even when de-selected"). This used to keep only the FIRST 100 inputs of a
// saved script. Liquidity Master has 190 (Watermark is #188, Relative equal highs / lows #164, the
// draw-on-liquidity tables #140), so every reload, saved layout or template brought those back at their
// defaults while the first 100 (sessions, FVGs) stuck. Other built-ins with more than 100 inputs:
// Manipulation Model (148), Forever Pro (139), iFVG Ultimate+ (123), Unicorn Model (115).
// The same filter also dropped built-ins whose source is over 64 KB (CISD Model+, Forever Pro, Unicorn
// Model, Trinity ATR Levels) from a reload altogether, although they are added with the 128 KB
// built-in limit. Limits now: MAX_INPUTS keys, BUILTIN_SRC_MAX source characters.
// LAYOUT-PERF (2026-11-08): an UNCHANGED built-in (byte-identical to assets/pine/<id>.pine) is saved as
// { builtin: id } without its source: 3 ICT built-ins were ~150 KB of a member's saved layout. Edited copies,
// Community and sealed scripts keep their source as before. Older states with inline source still load.
const BUILTIN_ID_RE = /^[a-z0-9-]{2,80}$/;
// INDICATOR VERSIONS (Owner 15 Nov 2026): the ref also stores the built-in's version (bv), so after a new version ships the chart
// keeps the source it was saved with (assets/pine-versions/<id>/<v>.pine). A ref with no bv (saved before versions) = the base.
function byRef(o){
  if (o.lib || o.sealed) return o;
  const b = builtinOfText(o.source);
  if (!b) return o;
  const r = Object.assign({}, o, { builtin: b.id, bv: b.v || verCurrent('x:' + b.id) });
  delete r.source;
  return r;
}
// The file to load for a saved ref: null = the latest (assets/pine/<id>.pine), else a kept older version.
export function builtinFileVer(id, bv){
  const key = 'x:' + id, cur = verCurrent(key);
  const v = verPinned(key, { ver: bv != null ? String(bv) : verBase(key) });   // null when only one version exists
  return v && v !== cur ? v : null;
}
// chart -> built-in refs whose file could not be loaded (offline). serialize keeps them, so the next autosave
// does not drop the member's indicator from the saved layout.
const unresolved = new WeakMap();
function withSource(x, chart){
  if (x && typeof x.source !== 'string' && typeof x.builtin === 'string' && BUILTIN_ID_RE.test(x.builtin)) {
    return builtinSource(x.builtin, builtinFileVer(x.builtin, x.bv)).then((source) => Object.assign({}, x, { source })).catch(() => {
      if (!unresolved.has(chart)) unresolved.set(chart, []);
      unresolved.get(chart).push(x);
      return null;
    });
  }
  // an older state with a built-in's source inline: load the file once so the next save stores a ref
  const id = x && typeof x.source === 'string' && builtinIdByName(x.name);
  if (id) builtinSource(id).catch(() => {});
  return Promise.resolve(x);
}
const MAX_INPUTS = 400;
const INPUT_STR_MAX = 4096;
function cleanEntry(x){
  if (!x || typeof x !== 'object' || typeof x.source !== 'string' || !x.source.trim() || x.source.length > BUILTIN_SRC_MAX) return null;
  const inputs = {};
  if (x.inputs && typeof x.inputs === 'object') {
    Object.keys(x.inputs).slice(0, MAX_INPUTS).forEach((k) => {
      const v = x.inputs[k];
      if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= INPUT_STR_MAX)) inputs[k] = v;
    });
  }
  const o = { name: typeof x.name === 'string' ? x.name.slice(0, 80) : 'Pine script', source: x.source, inputs };
  const L = x.lib;
  if (L && typeof L === 'object' && /^[A-Za-z0-9]{20,40}$/.test(String(L.id || ''))) {
    o.lib = { id: L.id, version: +L.version || 1, openSource: L.openSource !== false, ownerUid: String(L.ownerUid || '').slice(0, 128), name: String(L.name || '').slice(0, 60) };
  } else if (x.engine === 'main' || x.engine === 'next') o.engine = x.engine;
  const ro = requestedRightOffset(x);
  if (ro) o.rightOffset = ro;
  if (x.hidden === true) o.hidden = true;
  const Z = x.sealed;
  if (Z && typeof Z === 'object' && /^[a-z0-9-]{3,30}$/.test(String(Z.cid || '')) && /^[A-Za-z0-9]{12,24}$/.test(String(Z.iid || ''))) {
    o.sealed = { cid: Z.cid, iid: Z.iid, name: String(Z.name || '').slice(0, 60), logo: /^https:\/\//.test(Z.logo || '') ? String(Z.logo).slice(0, 600) : '' };
    o.source = sealStub(o.sealed.name, 'x');
  }
  return o;
}

// ---------------- sealed community indicators (Creator Hub) ----------------
let toast2 = () => {};
function sealStub(name, ref){
  // Only a reference. The real script is swapped in INSIDE the worker (chart-pine-next-worker.js, SEALED block).
  return '//@version=5\n//@tz-sealed=' + ref + '\nindicator("' + String(name || 'Community indicator').replace(/["\\\n]/g, ' ').slice(0, 60) + '")\n';
}
function randRef(){ const a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join(''); }
async function idToken(){ try { const u = firebase.auth().currentUser; return u ? await u.getIdToken() : null; } catch (e) { return null; } }
function markUsage(z){
  try {
    const u = firebase.auth().currentUser; if (!u) return;
    firebase.firestore().collection('communities').doc(z.cid).collection('indicators').doc(z.iid).collection('usage').doc(u.uid)
      .set({ day: Math.floor(Date.now() / 86400000), at: firebase.firestore.FieldValue.serverTimestamp() }).catch(() => {});
  } catch (e) {}
}
// z = { cid, iid, name, logo }. restoring = from a saved layout (no usage count, quieter errors).
async function addSealedOn(chart, z, inputs, restoring){
  let eng;
  try { await ensureEngine(chart); eng = await ensureNext(chart); } catch (e) { return { ok: false, msg: "The Pine engine didn't load. Check your connection." }; }
  if (!restoring && pineHandles(chart).length >= MAX_PER_CELL) return { ok: false, msg: 'This chart already has ' + MAX_PER_CELL + ' Pine scripts. Remove one first.' };
  const tok = await idToken();
  if (!tok) return { ok: false, msg: 'Sign in to use ' + (z.name || 'community indicators') + '.' };
  let res;
  const ref = randRef();   // the indicator's own worker lane is keyed by it (chart-pine-next.js)
  try {
    const pub = await eng.sealKey(ref);
    const r = await fetch('/api/creator/ind', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify({ cid: z.cid, iid: z.iid, pub }) });
    res = await r.json().catch(() => ({}));
    if (!r.ok || !res.ok) return { ok: false, msg: (res && res.message) || 'Could not load ' + (z.name || 'the indicator') + '.', code: res && res.error };
  } catch (e) { return { ok: false, msg: 'Could not reach TradeZoro. Check your connection.' }; }
  try { await eng.unseal(ref, res.sealed); } catch (e) { return { ok: false, msg: String(e && e.message || 'Could not open the indicator.') }; }
  const stub = sealStub(res.name || z.name, ref);
  const out = restoring
    ? (() => { const h = chart.addIndicator(stub, { language: LANG_NEXT, inputs: inputs || {} }); return { ok: !!h, handle: h }; })()
    : await runOnChart(chart, stub, inputs || {}, false, { sealed: true });
  if (!out.ok) return { ok: false, heavy: out.heavy, cancelled: out.cancelled, msg: (out.msg || 'Could not run the indicator.').replace(/^Line \d+: /, '') };
  onNext.add(out.handle);
  sealOf.set(out.handle, { cid: z.cid, iid: z.iid, name: res.name || z.name, version: res.version, logo: z.logo || '' });
  changed();
  if (!restoring) markUsage(z);
  return { ok: true, handle: out.handle, version: res.version };
}

function changed(){ try { const ws = getWs(); if (ws) ws.context().stateChanged(); } catch (e) {} }

const offsetHandles = new WeakMap(); // handle -> requested chart right offset
const offsetCharts = new WeakSet();  // charts whose right offset was raised by an indicator
function requestedRightOffset(opts){
  const n = Number(opts && opts.rightOffset);
  return Number.isFinite(n) && n > 6 ? Math.min(200, n) : null;
}
// Right room an indicator needs, in bars, read from its own inputs. HTF PO3 Lens draws its HTF
// candle stacks from bar_index + "Distance from last bar", each stack = candles x step + gap, so
// the room is a layout width, not a fixed number. (Bars of the chart TF: the stacks are placed in
// bar coordinates, so the pixel width stays the same across timeframes at the same zoom.)
function roomFromInputs(h){
  try {
    if (!/HTF PO3 Lens/.test(titleOf(h))) return 0;
    const v = h.inputValues() || {};
    const step = (+v.cdlW || 2) * 2 + (+v.cdlGap || 0) + 1;
    let x = +v.offsetB || 15;
    [1, 2, 3, 4, 5].forEach((i) => { if (v['on' + i] !== false && v['tf' + i]) x += (+v.nCdl || 2) * step + (+v.tfGap || 3); });
    return Math.min(200, Math.ceil(x + 6));
  } catch (e) { return 0; }
}
function wantedRightOffset(chart){
  let ro = 6;
  pineHandles(chart).forEach((h) => { ro = Math.max(ro, offsetHandles.get(h) || 0, roomFromInputs(h)); });
  return ro;
}
function applyRightOffset(chart){
  const ro = wantedRightOffset(chart);
  // Only touch the viewport on charts where an indicator asked for an offset: a chart that never
  // had one keeps the user's scroll position exactly as on main (clear / template / reset).
  if (ro === 6) { if (!offsetCharts.has(chart)) return; offsetCharts.delete(chart); } else offsetCharts.add(chart);
  try { if (chart.renderer && chart.renderer.supports && chart.renderer.supports('rightOffset')) chart.renderer.set('rightOffset', ro); } catch (e) {}
}
// After a timeframe / symbol switch: make sure the indicators' room is still there (never shrinks).
function ensureRoom(chart){
  const ro = wantedRightOffset(chart);
  if (ro <= 6) return;
  // Only at the live edge: a chart the member scrolled back (rightOffset < 0) keeps its place (member GK 25 Nov: it snapped to the latest price).
  try { const cur = +chart.renderer.get('rightOffset'); if (cur >= 0 && cur < ro - 0.01) { offsetCharts.add(chart); chart.renderer.set('rightOffset', ro); } } catch (e) {}
}
function trackRightOffset(chart, handle, ro){
  if (!chart || !handle || !ro) return;
  offsetHandles.set(handle, ro);
  const rm = handle.remove;
  if (typeof rm === 'function' && !handle.__stkOffsetRemove) {
    handle.__stkOffsetRemove = true;
    handle.remove = function(){
      try { return rm.apply(this, arguments); }
      finally { offsetHandles.delete(handle); setTimeout(() => applyRightOffset(chart), 0); }
    };
  }
  applyRightOffset(chart);
}

// Real Pine built-in namespaces and functions (TradingView reference). A name on this
// list that the runtime doesn't know is a GAP in our engine, not a typo by the member.
const PINE_BUILTINS = new Set(('ta math str array matrix map color input request strategy label line box table polyline '
  + 'linefill chart syminfo timeframe barstate session ticker plot shape location size position hline display format '
  + 'scale xloc yloc extend text font order currency dayofweek alert alertcondition runtime log adjustment backadjustment '
  + 'dividends earnings splits settlement_as_close barmerge footprint volume_row '
  + 'plotshape plotchar plotarrow plotbar plotcandle bgcolor barcolor fill indicator library max_bars_back '
  + 'fixnan nz na time time_close timestamp year month weekofyear dayofmonth hour minute second '
  + 'last_bar_index last_bar_time bar_index').split(' '));
function isPineBuiltin(name){ return PINE_BUILTINS.has(String(name).split('.')[0]); }

// Turn engine errors into something a member can act on.
function explain(err, source){
  let msg = String((err && err.message) || err || 'Unknown error');
  msg = msg.replace(/^Error:\s*/, '');
  let line = null;
  let m = /\bat (?:line )?(\d+):(\d+)/.exec(msg) || /line (\d+)(?:, col(?:umn)? (\d+))?/i.exec(msg);
  if (m) line = +m[1];
  if (!line) {
    const nd = /^([A-Za-z_][\w.]*) is not defined/.exec(msg) || /^(?:\w+\.)?((?:ta|math|str|array|matrix|map|request|strategy|label|line|box|table|polyline|chart|ticker|input|color|timeframe|syminfo|log|runtime)\.[A-Za-z_]\w*) is not a function/.exec(msg);
    if (nd) {
      const name = nd[1];
      const lines = String(source).split('\n');
      const re = new RegExp('(^|[^\\w.])' + name.replace(/\./g, '\\.') + '\\b');
      const i = lines.findIndex((l) => !/^\s*\/\//.test(l) && re.test(l));
      if (i >= 0) line = i + 1;
      msg = isPineBuiltin(name)
        ? '"' + name + '" isn\'t supported on our charts yet.'
        : '"' + name + '" is not a known variable or function.';
    }
  }
  // Clear reasons instead of a parser message for the two things pinets can't run at all (member report 22 Nov).
  const imp = /\bimport\b/.test(msg) && /^\s*import\s+[\w-]+\/[\w-]+\/\d+/m.test(String(source || ''));
  if (imp) {
    const i = String(source).split('\n').findIndex((l) => /^\s*import\s+[\w-]+\/[\w-]+\/\d+/.test(l));
    const lib = (/^\s*import\s+([\w-]+\/[\w-]+\/\d+)/.exec(String(source).split('\n')[i]) || [])[1] || '';
    return { msg: 'Pine libraries (import ' + lib + ') aren\'t supported on our charts yet. Copy the library functions the script uses into the script itself, then add it again.', line: i + 1 };
  }
  const ver = /^Unsupported Pine Script version (\d+)/.exec(msg);
  if (ver) {
    const i = String(source || '').split('\n').findIndex((l) => /^\s*\/\/\s*@version\s*=/.test(l));
    return { msg: 'Pine Script v' + ver[1] + ' isn\'t supported yet: our charts run v5 and v6. In TradingView\'s Pine Editor, open the script\'s menu, choose "Convert code to v5", then paste the new version here.', line: i >= 0 ? i + 1 : 1 };
  }
  msg = msg.replace(/^Failed to transpile Pine Script version \d+:\s*/, 'Syntax error: ');
  if (/request\.security|getMarketData|fetchSeries/i.test(msg)) msg += ' (request.security works only for symbols this chart can load, e.g. futures:ES1! or a crypto pair.)';
  if (/Loop exceeded maximum iterations/i.test(msg)) msg = 'Script stopped: a loop ran too many times.';
  return { msg, line };
}

// Vela also flashes its own "[cell] message" error toast on the chart for a failed run.
// The editor shows the error (with its line), so close that pill: the failed instance
// itself is already removed by runIndicator.
function hideVelaErrorToast(){
  const kill = () => document.querySelectorAll('.vela-toast[data-type="error"][data-open]').forEach((t) => { delete t.dataset.open; });
  kill(); setTimeout(kill, 60); setTimeout(kill, 400); setTimeout(kill, 1200);   // 1200: the next engine's toast can land late (22 Nov sweep)
}

// opts.engine === 'next': run straight on the next engine (built-in TradeZoro indicators).

// While a Pine run computes, pause the page's looping decorative CSS animations (the header
// plan badge's glow/sheen/shine, live dots). They animate box-shadow / background-position /
// left, which repaint every frame on the page's main thread and compositor; on a 2-core
// machine with software rendering that took most of the CPU the Pine worker needed (a heavy
// script ran ~4x slower on the desktop layout than on the phone layout, which has no badge).
// Nothing is removed or restyled: animation-play-state is paused for the run, then resumed.
// Exported for tests.
let busyRuns = 0;
export function pageBusy(on){
  const root = document.documentElement;
  if (!document.getElementById('stk-pine-busy-css')) {
    const st = document.createElement('style');
    st.id = 'stk-pine-busy-css';
    st.textContent = 'html.pine-busy *,html.pine-busy *::before,html.pine-busy *::after{animation-play-state:paused!important}';
    document.head.appendChild(st);
  }
  busyRuns = Math.max(0, busyRuns + (on ? 1 : -1));
  root.classList.toggle('pine-busy', busyRuns > 0);
}

// One shared console.error hold for every run in flight (runs can overlap: two cells, a quick
// double add). Each run collects only into its own list; the native console.error comes back
// when the last run in flight releases, whatever order they finish in.
const velaHolds = new Set();
let velaOrig = null, velaHook = null;
function holdVelaErrors(list){
  if (!velaHolds.size) {
    velaOrig = console.error;
    velaHook = function (...a) {
      if (typeof a[0] === 'string' && /^\[vela\] indicator ".*" failed:/.test(a[0]) && velaHolds.size) { velaHolds.forEach((l) => l.push(a)); return; }
      return velaOrig.apply(this, a);
    };
    console.error = velaHook;
  }
  velaHolds.add(list);
  let done = false;
  return () => {
    if (done) return; done = true;
    velaHolds.delete(list);
    if (!velaHolds.size) { if (console.error === velaHook) console.error = velaOrig; velaHook = null; velaOrig = null; }
  };
}

async function runOnChart(chart, source, inputs, shared, opts){
  pageBusy(true);
  try {
    const r = await runOnChartInner(chart, source, inputs, shared, opts);
    // Load history behind the view for the script's sessions / previous-day levels, like TV
    // (assets/chart-history-pager.js, pineDepthBars). Saved layouts get it from load:end.
    if (r && r.ok) { try { chart.__stkPager && chart.__stkPager.kick(); } catch (e) {} }
    return r;
  }
  finally { pageBusy(false); }
}
async function runOnChartInner(chart, source, inputs, shared, opts){
  // LAYOUT-PERF (2026-11-08): the next engine (and its worker) loads alongside the classic one, not after it.
  // A next-engine add no longer waits for the classic engine (parsed on the main thread); that loads only for the fallback.
  // A member's own script (editor, My scripts, examples) runs on the next engine first, like the built-ins (newer pinets,
  // O(n) pivots, a first window of the last 5,000 bars, progress reports); the classic worker is the fallback when the
  // next engine rejects it. Community (shared) scripts run on the classic worker first.
  // NO TIME LIMIT (Owner 22 Nov): a run ends only when it draws, fails with a real error, or is cancelled (Cancel in the
  // editor, the × on the legend chip, removing the indicator, closing the chart) -> { ok:false, cancelled:true }.
  const nextFirst = !!(opts && opts.sealed) || !shared;
  if (nextFirst) ensureNext(chart).catch(() => {}); else await ensureEngine(chart);
  if (pineHandles(chart).length >= MAX_PER_CELL) return { ok: false, msg: 'This chart already has ' + MAX_PER_CELL + ' Pine scripts. Remove one first.' };
  // NO BARS YET (found in the 22 Nov sweep): on a chart that is still loading, or whose data feed is down, wait up to
  // 15 s for bars, then say what is really wrong.
  const barCount = () => { try { return chart.orchestrator.rawBars.length; } catch (e) { return -1; } };   // -1 = can't tell: run as before
  for (let i = 0; i < 60 && barCount() === 0; i++) await new Promise((r) => setTimeout(r, 250));
  if (barCount() === 0) return { ok: false, msg: 'This chart has no price data yet, so the script has nothing to run on. Wait for the candles to load (or pick another symbol), then add it again.' };
  const run = (language) => runTracked(chart, source, { language, inputs: inputs || {} }, opts, language === LANG);
  const runNext = async () => {
    try { await ensureNext(chart); } catch (e) { console.warn('TradeZoro: Pine next engine', e); return null; }
    return run(LANG_NEXT);
  };
  const stopped = (r) => r && (r.cancelled || r.startFailed);
  let res = null, engine = 'worker';
  // Sealed community indicators run ONLY on the next worker (the stub means nothing anywhere else).
  if (opts && opts.sealed) { res = (await runNext()) || { ok: false, error: new Error("The Pine engine didn't start.") }; engine = 'next'; }
  else if (!shared) {
    res = await runNext(); engine = 'next';
    // Rejected by the next engine (not a syntax error, not cancelled, not a built-in): give the classic worker one try.
    if (res && !res.ok && !stopped(res) && !(opts && opts.engine === 'next') && !/^Failed to transpile|^Unsupported Pine Script version/.test(String(res.error && res.error.message))) {
      hideVelaErrorToast();
      const first = res;
      res = null;
      await ensureEngine(chart);
      const held0 = [], rel0 = holdVelaErrors(held0);
      try { res = await run(LANG); engine = 'worker'; }
      finally { rel0(); }
      if (!res || (!res.ok && !stopped(res))) { res = first; engine = 'next'; }   // the next engine's message is the one to show
    }
  }
  // vela logs `[vela] indicator "ind-N" failed: ...` (console.error) when the worker's older PineTS rejects a script; the
  // retry below then runs it fine on the next engine, so that line is noise. Hold it; print it only on a real failure.
  const held = [];
  let release = () => {};
  if (!res) {
    if (nextFirst) await ensureEngine(chart);
    release = holdVelaErrors(held);
    try { res = await run(LANG); engine = 'worker'; }
    finally { release(); }
  }
  const flushHeld = () => { held.splice(0).forEach((a) => console.error(...a)); };
  // The worker's built-in PineTS is older than the page's: retry once on the next engine (newer pinets, still off the
  // page thread); only if module workers can't start, on the in-process engine.
  if (!shared && engine === 'worker' && res && !stopped(res) && !res.ok && !/^Failed to transpile/.test(String(res.error && res.error.message))) {
    hideVelaErrorToast();
    const r2 = await runNext();
    if (r2) { res = r2; engine = 'next'; }
    else if (/is not defined/.test(String(res.error && res.error.message))) { res = await run(LANG_MAIN); engine = 'main'; }
  }
  if (engine === 'worker' || !res || !res.ok) flushHeld(); // a real failure keeps vela's line
  if (res && res.cancelled) return { ok: false, cancelled: true, heavy: true, msg: 'Stopped. The script was not added.' };   // heavy: callers show no extra toast
  if (res && res.startFailed) {
    const why = "Pine couldn't start in this browser: " + res.startFailed + '.';
    if (!(opts && opts.inline)) { try { window.showToast && window.showToast('error', why + ' Reload the page and try again.', { title: 'Pine script', duration: 15000 }); } catch (e) {} }
    return { ok: false, startFailed: true, msg: why + ' Reload the page and try again.' };
  }
  if (!res || !res.ok) {
    hideVelaErrorToast();
    const ex = explain(res && res.error, source);
    if (opts && opts.sealed) return { ok: false, msg: ex.msg };   // line numbers of a hidden script mean nothing to a member
    return { ok: false, msg: ex.msg, line: ex.line };
  }
  if (engine === 'main' && res.handle) onMain.add(res.handle);
  if (engine === 'next' && res.handle) onNext.add(res.handle);
  trackRightOffset(chart, res.handle, requestedRightOffset(opts));
  applyRightOffset(chart);
  changed();
  return { ok: true, handle: res.handle, engine };
}

// chart.runIndicator, but it also ends when the new indicator leaves the chart (Cancel / × / removed / chart closed)
// -> { cancelled: true }, or when the classic worker could not start -> { startFailed }. opts.run(handle) hands the
// caller the handle while it computes (the editor's Cancel removes it); opts.onProgress(pct|null) after CALC_AFTER_MS.
function runTracked(chart, source, ro, opts, classic){
  const before = new Set(pineHandles(chart));
  const p = chart.runIndicator(source, ro);
  const h = pineHandles(chart).find((x) => !before.has(x)) || null;   // addIndicator ran synchronously inside runIndicator
  if (!h) return p;
  if (opts && typeof opts.run === 'function') { try { opts.run(h); } catch (e) {} }
  const failAt = classic ? classicFail : undefined;
  return new Promise((resolve) => {
    let done = false;
    const end = (r) => { if (done) return; done = true; tracked.delete(t); resolve(r); };
    const t = { chart, h, onProgress: opts && opts.onProgress, tick: () => {
      if (!onChart(chart, h)) end({ ok: false, handle: null, cancelled: true });
      else if (classic && classicFail && classicFail !== failAt) { try { h.remove(); } catch (e) {} end({ ok: false, handle: null, startFailed: classicFail }); }
    } };
    tracked.add(t); calcKick();
    p.then(end, (e) => end({ ok: false, handle: null, error: e }));
  });
}
function onChart(chart, h){ try { return chart.indicators().includes(h); } catch (e) { return false; } }

// ---- "Calculating… NN%" (Owner 22 Nov) ----
// One ticker while anything computes or an add is in flight: every 250 ms it ends adds whose indicator left the chart,
// feeds the editor's percentage, and keeps a chip on each long-running indicator's legend row (non-blocking:
// the chart, crosshair and other indicators work as normal). × on the chip removes that indicator.
const tracked = new Set();
let calcTimer = 0;
function calcKick(){ if (!calcTimer) calcTimer = setInterval(calcTick, 250); }
function calcOf(chart, h){
  const nx = nextEngines.get(chart), cl = engines.get(chart);
  const r = nx && nx.runs ? nx.runs().find((x) => x.id === h.id) : null;
  if (r) return { since: r.since, pct: r.pct };
  return cl && cl.calcOf ? cl.calcOf(h.id) : null;
}
function cellsNow(){ try { const ws = getWs(); return ws ? ws.context().cells.map((c) => c.chart).filter(Boolean) : []; } catch (e) { return []; } }
function calcTick(){
  tracked.forEach((t) => { try { t.tick(); } catch (e) {} });
  const now = Date.now();
  let any = tracked.size > 0;
  tracked.forEach((t) => {
    const c = calcOf(t.chart, t.h);
    if (c) any = true;
    if (t.onProgress && c && now - c.since >= CALC_AFTER_MS) { try { t.onProgress(c.pct); } catch (e) {} }
  });
  const live = new Set();
  cellsNow().forEach((chart) => {
    let ui = null; try { ui = chart.orchestrator.renderer.inputsUI; } catch (e) {}
    pineHandles(chart).forEach((h) => {
      const c = calcOf(chart, h);
      if (!c) return;
      any = true;
      if (now - c.since < CALC_AFTER_MS || h.visible === false) return;
      const row = ui && ui.rows && ui.rows.get(h.id);
      if (!row || !row.el) return;
      live.add(row.el);
      let chip = row.el.querySelector(':scope > .stk-calc');
      if (!chip) {
        chip = document.createElement('span');
        chip.className = 'stk-calc';
        chip.setAttribute('role', 'status');
        chip.innerHTML = '<span class="stk-calc-t"></span><button type="button" class="stk-calc-x" aria-label="Stop calculating and remove this indicator" title="Stop and remove"><svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M3 3l6 6M9 3L3 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>';
        chip.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); try { h.remove(); } catch (x) {} changed(); setTimeout(calcTick, 0); });
        chip.addEventListener('dblclick', (e) => e.stopPropagation());
        const at = row.controlsEl && row.controlsEl.parentNode === row.el ? row.controlsEl : null;
        row.el.insertBefore(chip, row.valuesEl && row.valuesEl.parentNode === row.el ? row.valuesEl : at);
      }
      const txt = 'Calculating…' + (c.pct > 0 ? ' ' + c.pct + '%' : '');
      const tEl = chip.firstChild; if (tEl.textContent !== txt) tEl.textContent = txt;
    });
  });
  document.querySelectorAll('.stk-calc').forEach((c) => { if (!live.has(c.parentNode)) c.remove(); });
  if (!any) { clearInterval(calcTimer); calcTimer = 0; }
}
function calcCss(){
  if (document.getElementById('stk-calc-css')) return;
  const st = document.createElement('style');
  st.id = 'stk-calc-css';
  // Legend row chip: 20 px pill; text and the × glyph both sit 8 px from the pill's edges (5 px pad + 3 px inside the
  // 16 px round × target); tabular digits. Day + dark.
  // The chip replaces Vela's own 3-dot loading mark on that row (the span right before it), so it isn't said twice.
  st.textContent = 'span:has(+ .stk-calc){display:none!important}.stk-calc{display:inline-flex;align-items:center;gap:4px;flex:none;height:20px;box-sizing:border-box;margin-left:8px;padding:0 5px 0 8px;border-radius:10px;'
    + 'background:rgba(3,201,136,.14);color:#03c988;font:600 11px/1 inherit;font-variant-numeric:tabular-nums;white-space:nowrap;pointer-events:auto}'
    + '.stk-calc-t{display:block;line-height:20px}'
    + '.stk-calc-x{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;padding:0;margin:0;border:0;border-radius:50%;background:transparent;color:inherit;cursor:pointer}'
    + '.stk-calc-x:hover,.stk-calc-x:focus-visible{background:rgba(3,201,136,.22);outline:none}'
    + ':root[data-theme="light"] .stk-calc{background:rgba(7,153,106,.12);color:#07996a}'
    + ':root[data-theme="light"] .stk-calc-x:hover,:root[data-theme="light"] .stk-calc-x:focus-visible{background:rgba(7,153,106,.2)}';
  document.head.appendChild(st);
}

// Called by vela-chart.js BEFORE the workspace is constructed.
// LAYOUT-PERF (2026-11-08): once the chart has painted and the page is idle, the Pine engine files are fetched into
// the HTTP cache (no parsing, no worker), so the first built-in a member adds doesn't wait ~2 s for ~370 KB of engine
// downloads in a chain. Skipped with Data Saver on. Same URLs (and CORS mode) the worker/imports use.
function prefetchEngine(){
  try { if (navigator.connection && navigator.connection.saveData) return; } catch (e) {}
  const pinets = '/assets/vendor/pinets-0.11.0/pinets.min.browser.es.js';   // = PINETS in chart-pine-next-worker.js
  [PINE_PKG, pinets].forEach((href) => { const l = document.createElement('link'); l.rel = 'prefetch'; l.as = 'script'; l.crossOrigin = 'anonymous'; l.href = href; document.head.appendChild(l); });
  ['./chart-pine-next.js?v=1270', './chart-pine-series-cache.js?v=1270', './chart-pine-tv-style.js?v=1270'].forEach((u) => {
    const l = document.createElement('link'); l.rel = 'modulepreload'; l.href = new URL(u, import.meta.url).href; document.head.appendChild(l);
  });
}
function prefetchWhenIdle(){
  const go = () => setTimeout(() => (window.requestIdleCallback ? requestIdleCallback(prefetchEngine, { timeout: 4000 }) : prefetchEngine()), 1500);
  if (window.__stkFirstCandles) go(); else window.addEventListener('stk:first-candles', go, { once: true });
}

export function installPine(core, wsGetter){
  Core = core;
  getWs = wsGetter;
  try { prefetchWhenIdle(); } catch (e) {}
  try {
    core.registerStatePersistence({
      key: EXT_KEY,
      scope: 'cell',
      serialize(ctx){
        const list = pineHandles(ctx.chart).map(snapshot).map(byRef).concat(unresolved.get(ctx.chart) || []);
        return list.length ? list : undefined;
      },
      restore(payload, ctx){
        if (!Array.isArray(payload)) return;
        const chart = ctx.chart;
        // A template applied over a cell that already runs Pine: replace, never stack.
        pineHandles(chart).forEach((h) => { try { h.remove(); } catch (e) {} }); applyRightOffset(chart);
        unresolved.delete(chart);
        const raw = payload.slice(0, MAX_PER_CELL);
        if (!raw.length) return;
        // Built-in refs ({ builtin: id }) fetch their source (cached; in parallel); the engine loads meanwhile.
        // LAYOUT-PERF (2026-11-08): only the engines the saved scripts use load, both at once, in parallel with
        // the source fetches (the classic engine used to load first even for a layout of next-engine scripts).
        const isNext = (x) => x && x.engine === 'next' && !x.lib && !x.sealed;
        const nextP = raw.some(isNext) ? ensureNext(chart).catch(() => {}) : null;
        const eng = raw.every(isNext) ? Promise.resolve() : ensureEngine(chart);
        Promise.all(raw.map((x) => withSource(x, chart))).then((xs) => {
          const list = xs.map(cleanEntry).filter(Boolean);
          if (!list.length) return null;
          return Promise.all([eng, nextP]).then(() => {
            list.forEach((x) => { try { addOn(chart, x); } catch (e) { console.warn('TradeZoro: Pine restore', e); } });
          });
        }).catch((e) => { console.warn('TradeZoro: Pine engine failed to load', e); });
      }
    });
  } catch (e) { console.warn('TradeZoro: Pine persistence', e); }
}

// Remove Pine indicators from every cell (before a template without Pine is applied).
export function clearAllPine(){
  const ws = getWs();
  if (!ws) return;
  try { ws.context().cells.forEach((c) => { pineHandles(c.chart).forEach((h) => { try { h.remove(); } catch (e) {} }); applyRightOffset(c.chart); }); } catch (e) {}
}

// Published state of a Community script on a chart: 'gone' (unpublished / hidden),
// the current version number, or null when unknown. Cached per page load.
const libCache = new Map();
function libStatus(L){
  if (!libCache.has(L.id)) {
    const p = window.StrykerPineLibrary ? window.StrykerPineLibrary.get(L.id).then((x) => (x && x.status === 'ok' ? x.version : 'gone')).catch(() => null) : Promise.resolve(null);
    libCache.set(L.id, p);
  }
  return libCache.get(L.id);
}

// ---------------- editor UI ----------------
const NEW_SRC = '//@version=5\nindicator("My script", overlay=true)\nplot(ta.sma(close, 20), "SMA 20", color=color.teal)\n';

// "Community scripts" row at the top of Vela's Indicators picker. Called by vela-chart.js
// AFTER mountOrderflow, so it wraps the order-flow grouping: our row is index 0 and every
// other index moves down by one.
export function mountCommunityPicker(ws){
  let cell;
  try { cell = ws.active; } catch (e) { return; }
  const proto = cell && Object.getPrototypeOf(cell);
  if (!proto || proto.__stkCommunity || typeof proto.libraryRows !== 'function') return;
  proto.__stkCommunity = true;
  const rows = proto.libraryRows, add = proto.addFromLibrary;
  proto.libraryRows = function () {
    return [{ name: 'Community scripts: browse, add, publish', category: 'Community', language: 'pine' }].concat(rows.call(this));
  };
  proto.addFromLibrary = function (index) {
    if (index === 0) {
      try { if (ws.indicatorPicker) ws.indicatorPicker.close(); } catch (e) {}
      if (window.StrykerPineLibrary) window.StrykerPineLibrary.openCommunity();
      return;
    }
    return add.call(this, index - 1);
  };
}

// Called by vela-chart.js after the workspace exists. barL = our toolbar's left group.
// Panel layout: assets/chart-script-editor.js (shared with the Zscript panel). Code: the vendored CodeMirror editor
// (assets/zs-editor/editor.js, lang 'pine': highlighting only, no live lint; errors come from the engine on Add to chart).
export function mountPine(ws, barL, opts){
  const S = window.StrykerPineScripts;
  const toast = (opts && opts.toast) || (() => {});
  const tfLabel = (opts && opts.tfLabel) || ((t) => t);

  // Icon only (Owner order 2026-10-06): pine-tree outline, same build as the Alerts icon button.
  // Opens the script editor (Zscript first; assets/chart-zscript.js takes the click when Zscript is the last language used).
  const btn = el('button', { type: 'button', class: 'stkc-btn stkc-icon', id: 'stkc-pine-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'stkc-pine', title: 'Script editor', 'aria-label': 'Script editor',
    html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5 7.5 8.5h2.5L6 13.5h3L5 18.5h14l-4-5h3l-4-5h2.5z"/><path d="M12 18.5v3"/></svg>' });
  barL.appendChild(btn);

  const Sh = createShell({
    id: 'stkc-pine', label: 'Pine import editor', closeLabel: 'Close the Pine editor',
    note: 'Imported Pine scripts run in your browser on the chart\'s bars. Support is partial: some built-ins may not work yet. Education only. Not financial advice.',
    moreItems: [['dup', 'Duplicate'], ['export', 'Export .pine'], ['import', 'Import file…'], ['publish', 'Publish or share'], ['community', 'Browse community scripts'], ['delete', 'Delete', true]],
    onClose: () => { setOpen(false); btn.focus(); },
    onWrap: (on) => { if (ed) ed.setWrap(on); },
    onFind: () => { ensureEditor().then((e) => e.find()).catch(() => {}); },
    onMore: (k) => more(k),
    onMenu: (menu) => { menu.querySelector('[data-k="delete"]').disabled = !editingId; menu.querySelector('[data-k="publish"]').disabled = !editingId; },
    onTab: (k) => { if (k === 'docs') renderDocsTab(); },
    onView: (v) => { if (v === 'code' && ed) ed.focus(); }
  });
  const { panel, nameIn, target, edHost, addBtn, saveBtn, newBtn, panes } = Sh;
  // the Zscript glue swaps this title for the language switch; it stays as the label when Zscript is off
  Sh.segSlot.appendChild(el('h2', { class: 'sed-title', text: 'Pine (import)' }));
  edHost.appendChild(el('div', { class: 'stkc-zs-loading', text: 'Loading editor…' }));
  const lists = {}; ['chart', 'mine', 'examples'].forEach((k) => { lists[k] = el('ul', { class: 'stkc-tlist' }); panes[k].appendChild(lists[k]); });
  lists.examples.after(el('div', { class: 'sed-comm' }, [el('button', { type: 'button', class: 'sed-btn is-tonal stkc-comm-btn', text: 'Browse community scripts', onclick: () => { if (window.StrykerPineLibrary) window.StrykerPineLibrary.openCommunity(); } })]));
  const host = document.querySelector('.stkchart-panel') || document.body;
  host.appendChild(panel);

  let editingId = null;   // saved script id the editor holds (null = new / example)
  let busy = false, ed = null, edP = null, pending = null;   // pending = source set before the editor finished loading
  let base = { name: '', src: '' }, kind = 'new', hasErr = false, handle = null;
  const cur = () => (ed ? ed.get() : (pending || ''));

  function ensureEditor(){
    if (!edP) {
      edP = import('./zs-editor/editor.js?v=1270').then((m) => {
        edHost.innerHTML = '';
        ed = m.createZsEditor(edHost, { doc: pending || '', lang: 'pine', builtins: [], wrap: Sh.wrap(), onRun: () => addToChart(), onSave: () => save(), onChange: () => { if (hasErr) { hasErr = false; showErr(''); } renderStatus(); } });
        pending = null;
        return ed;
      }).catch((e) => { edP = null; edHost.innerHTML = ''; edHost.appendChild(el('div', { class: 'stkc-zs-loading', text: 'The editor did not load. Check your connection and reopen it.' })); throw e; });
    }
    return edP;
  }
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
    target.title = 'Add to chart puts the script on ' + target.textContent;
  }
  const onChartNow = () => { const a = activeCell(); return !!(handle && a.cell && pineHandles(a.cell.chart).includes(handle)); };
  function renderStatus(){
    if (busy) return;
    const dirty = cur() !== base.src || nameIn.value.trim() !== base.name;
    Sh.setStatus(hasErr ? 'error' : !dirty && kind === 'mine' ? 'saved' : !dirty && kind === 'example' ? 'example' : !dirty && kind === 'chart' ? 'idle' : 'unsaved');
    Sh.setPrimary(onChartNow() ? 'Update on chart' : 'Add to chart');
  }
  // problems strip; line = the engine's line for the error (gutter dot + squiggle + click jumps)
  function showErr(msg, line){
    hasErr = !!(msg && line);
    if (!msg) { Sh.problems.head('info', 'Pine errors show here when you add the script to the chart.'); Sh.problems.list([]); if (ed) ed.showDiagnostics([]); renderStatus(); return; }
    Sh.problems.head(line ? 'err' : 'info', line ? '1 problem' : 'Note');
    Sh.problems.list([{ text: (line ? 'Line ' + line + ': ' : '') + msg, line }], (l) => { if (ed) { Sh.setView('code'); ed.goto(l, 1); ed.focus(); } });
    if (line) ensureEditor().then((e) => { e.showDiagnostics([{ line, col: 1, severity: 'error', message: msg, endLine: line, endCol: 10000 }]); e.goto(line, 1); }).catch(() => {});
    renderStatus();
  }
  function load(name, source, id, k, h){
    nameIn.value = name || '';
    editingId = id || null; kind = k || (id ? 'mine' : 'new'); handle = h || null; hasErr = false;
    base = { name: (name || '').trim(), src: source || '' };
    if (ed) ed.set(source || ''); else { pending = source || ''; ensureEditor().then((e) => { if (e.get() !== base.src) e.set(base.src); }).catch(() => {}); }
    showErr('');
    if (!Sh.isWide()) Sh.setView('code');
  }

  nameIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); if (ed) ed.focus(); } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } });
  nameIn.addEventListener('input', renderStatus);

  async function addToChart(){
    if (busy) return;
    const src = cur();
    if (!src.trim()) { showErr('The script is empty.'); return; }
    if (src.length > SRC_MAX) { showErr('This script is too long (' + Math.round(src.length / 1024) + ' KB, limit 256 KB).'); return; }
    const a = activeCell();
    if (!a.cell) return;
    const old = onChartNow() ? handle : null;
    busy = true; addBtn.disabled = true; Sh.setPrimary(enginePromise ? 'Running…' : 'Loading engine…'); Sh.setStatus('running');
    Sh.problems.head('busy', 'Running on the chart…'); Sh.problems.list([]);
    try {
      if (old) { try { old.remove(); } catch (er) {} }   // Update: the new version replaces the one this editor added
      // A run past 3 s: "Calculating… NN%" + Cancel (no time limit, Owner 22 Nov). Cancel removes the indicator, which stops its worker.
      let running = null;
      const onProgress = (pct) => {
        if (!busy) return;
        Sh.problems.head('busy', 'Calculating…' + (pct > 0 ? ' ' + pct + '%' : ''));
        const hd = Sh.errBox.previousElementSibling;
        if (hd && !hd.querySelector('.sed-retry')) hd.appendChild(el('button', { type: 'button', class: 'sed-tool sed-retry stk-calc-cancel', text: 'Cancel', onclick: () => { try { if (running) running.remove(); } catch (er) {} } }));
      };
      const r = await runOnChart(a.cell.chart, src, undefined, false, { inline: true, run: (h) => { running = h; }, onProgress });
      busy = false;
      if (r.cancelled) { Sh.problems.head('info', 'Stopped. The script was not added.'); Sh.problems.list([]); }
      if (r.ok) {
        handle = r.handle; hasErr = false;
        let n = 0; try { n = Object.keys((a.cell.chart.inspect().indicators.find((x) => x.id === r.handle.id) || {}).series || {}).length; } catch (er) {}
        Sh.problems.head('ok', 'Running on the chart' + (n ? ' · ' + n + (n === 1 ? ' plot' : ' plots') : ''));
        toast((old ? 'Updated ' : 'Added ') + titleOf(r.handle) + (old ? ' on the chart' : ' to the chart')); if (isPhone()) setOpen(false);
      } else {
        if (old) { try { handle = (await runOnChart(a.cell.chart, old.source, undefined, false, { inline: true })).handle || null; } catch (er) { handle = null; } }
        if (!r.cancelled) showErr(r.msg, r.line);
      }
    } catch (e) {
      busy = false;
      console.warn('TradeZoro: Pine run', e);
      showErr("The Pine engine didn't load. Check your connection; an ad-blocker or network filter may be blocking it.");
    }
    busy = false; addBtn.disabled = false; renderStatus();
    renderLists();
  }
  async function save(){
    if (!S) return;
    let name = nameIn.value.trim();
    if (!name) { const m = /indicator\s*\(\s*(?:title\s*=\s*)?["']([^"']{1,60})/.exec(cur()); name = m ? m[1] : ''; nameIn.value = name; }
    if (!name) { nameIn.focus(); showErr('Give the script a name first.'); return; }
    saveBtn.disabled = true;
    try { editingId = await S.save(name, cur(), editingId); kind = 'mine'; base = { name, src: cur() }; toast('Script saved'); showErr(''); }
    catch (e) { showErr((e && e.userMessage) || 'Could not save the script.'); console.warn('TradeZoro: Pine save', e); }
    saveBtn.disabled = false;
    renderLists();
  }
  const copyName = (n) => (String(n || 'Script').slice(0, 54) + ' copy');
  async function more(k){
    if (k === 'dup') { load(copyName(nameIn.value.trim() || 'Script'), cur(), null, 'new'); nameIn.focus(); nameIn.select(); }
    else if (k === 'export') download(fileName(nameIn.value.trim() || 'script', '.pine'), cur());
    else if (k === 'import') { const f = await pickFile('.pine,.txt,text/plain', SRC_MAX); if (!f) return; if (f.error) { showErr(f.error); return; } load(f.name, f.text, null, 'new'); }
    else if (k === 'publish') { if (window.StrykerPineLibrary) window.StrykerPineLibrary.openPublish({ name: nameIn.value.trim(), source: cur() }); else showErr('Publishing is unavailable.'); }
    else if (k === 'community') { if (window.StrykerPineLibrary) window.StrykerPineLibrary.openCommunity(); }
    else if (k === 'delete' && editingId && S) {
      if (!window.confirm('Delete the script "' + (nameIn.value.trim() || 'this script') + '"? It stays on any chart it is already on.')) return;
      try { await S.remove(editingId); editingId = null; kind = 'new'; toast('Script deleted'); renderStatus(); } catch (e) { showErr('Could not delete.'); }
      renderLists();
    }
  }
  addBtn.addEventListener('click', addToChart);
  newBtn.addEventListener('click', () => { load('', NEW_SRC, null, 'new'); nameIn.focus(); });
  saveBtn.addEventListener('click', save);

  const A = (label, svgInner, fn, cls) => ib(label, svgInner, fn, cls);
  // Docs: the Pine namespaces/functions the engine knows; click inserts at the cursor
  const PINE_DOCS = ['indicator("Title", overlay=true)', 'plot(series, "Title", color=color.teal)', 'plotshape(cond, "Title", style=shape.triangleup, location=location.belowbar)', 'hline(price, "Title")', 'fill(plot1, plot2, color=color.new(color.teal, 80))', 'bgcolor(color)', 'input.int(14, "Length", minval=1)', 'input.float(1.0, "Mult")', 'input.source(close, "Source")', 'input.bool(true, "Show")', 'ta.sma(source, length)', 'ta.ema(source, length)', 'ta.rsi(source, length)', 'ta.atr(length)', 'ta.vwap(source)', 'ta.crossover(a, b)', 'ta.crossunder(a, b)', 'ta.highest(source, length)', 'ta.lowest(source, length)', 'ta.stdev(source, length)', 'math.abs(x)', 'math.max(a, b)', 'math.min(a, b)', 'request.security(syminfo.tickerid, "D", close)', 'color.new(color, transp)', 'nz(x, 0)', 'na(x)']
    .map((sig) => ({ name: sig.replace(/\(.*$/, ''), sig, insert: sig, back: 0 }));
  function renderDocsTab(){ renderDocs(panes.docs, PINE_DOCS, Sh.docsSearch.value, (txt) => ensureEditor().then((e) => { Sh.setView('code'); e.insert(txt, 0); })); }
  Sh.docsSearch.addEventListener('input', renderDocsTab);
  Sh.docsSearch.addEventListener('keydown', (e) => e.stopPropagation());
  const newRow = () => { load('', NEW_SRC, null, 'new'); nameIn.focus(); };

  async function renderLists(){
    renderTarget();
    if (Sh.tab() === 'docs') renderDocsTab();
    // On this chart (active cell)
    lists.chart.innerHTML = '';
    const a = activeCell();
    const hs = a.cell ? pineHandles(a.cell.chart) : [];
    if (!hs.length) lists.chart.appendChild(emptyState('No Pine scripts on this chart yet. Open an example or paste your script, then Add to chart.', 'New script', newRow));
    const me = (() => { try { return firebase.auth().currentUser.uid; } catch (e) { return null; } })();
    hs.forEach((h) => {
      const L = libOf.get(h), Z = sealOf.get(h);
      const hidden = (L && !L.openSource && L.ownerUid !== me) || !!Z;
      const nm = L ? L.name || titleOf(h) : titleOf(h);
      const open = () => { if (Z) showErr('Protected community indicator: its code stays with the creator.'); else if (hidden) showErr('Code hidden in the editor: the author shares this script without its source.'); else load(L ? L.name : titleOf(h), h.source, null, 'chart', h); };
      const li = libRow({ name: nm, desc: hidden ? 'Code hidden in the editor' : descOf(h.source), title: hidden ? 'Code hidden in the editor' : 'Open its code in the editor', onOpen: open,
        actions: [hidden ? null : A('Open ' + nm + ' in the editor', ICONS.open, open), A('Remove ' + titleOf(h) + ' from the chart', ICONS.del, () => { try { h.remove(); } catch (e) {} if (h === handle) handle = null; changed(); renderLists(); }, 'stkc-del')] });
      const l1 = li.querySelector('.sed-row-l1');
      if (Z) l1.appendChild(el('span', { class: 'stkc-badge', text: 'From your communities v' + Z.version + ' \u00b7 protected' }));
      if (L) {
        const tag = el('span', { class: 'stkc-badge', text: 'Community v' + L.version + (hidden ? ' \u00b7 code hidden' : '') });
        l1.appendChild(tag);
        libStatus(L).then((st) => { if (st === 'gone') { tag.textContent = 'No longer published'; tag.classList.add('is-warn'); } else if (st > L.version) tag.textContent += ' \u00b7 v' + st + ' available'; });
      }
      lists.chart.appendChild(li);
    });
    Sh.setCount('chart', hs.length);
    // Examples
    lists.examples.innerHTML = '';
    const ex = S ? S.EXAMPLES : [];
    ex.forEach((x) => lists.examples.appendChild(libRow({ name: x.name, badge: 'Example', desc: descOf(x.source), onOpen: () => load(x.name, x.source, null, 'example'),
      actions: [A('Open ' + x.name, ICONS.open, () => load(x.name, x.source, null, 'example')), A('Add ' + x.name + ' to the chart', ICONS.add, () => { load(x.name, x.source, null, 'example'); addToChart(); }), A('Duplicate ' + x.name + ' as a new script', ICONS.copy, () => load(copyName(x.name), x.source, null, 'new'))] })));
    Sh.setCount('examples', ex.length);
    // My scripts
    lists.mine.innerHTML = '';
    if (!S) { lists.mine.appendChild(el('li', { class: 'stkc-empty sed-empty' }, [el('p', { text: 'Saving is unavailable.' })])); return; }
    let r = { items: [] };
    try { r = await S.list(); } catch (e) { r = { items: [], note: 'Could not load your scripts.' }; }
    lists.mine.innerHTML = '';
    if (r.note) lists.mine.appendChild(el('li', { class: 'stkc-empty sed-empty' }, [el('p', { text: r.note })]));
    if (!r.items.length) lists.mine.appendChild(emptyState(S.signedIn() ? 'No saved scripts yet. Paste or write one, name it, then Save.' : 'No saved scripts yet. Sign in to keep them on your account.', 'New script', newRow));
    r.items.forEach((t) => lists.mine.appendChild(libRow({ name: t.name, badge: t.id === editingId ? 'Open' : null, desc: ago(t.updatedAt) + (descOf(t.source) ? ' · ' + descOf(t.source) : ''), onOpen: () => load(t.name, t.source, t.id, 'mine'),
      actions: [
        A('Add ' + t.name + ' to the chart', ICONS.add, () => { load(t.name, t.source, t.id, 'mine'); addToChart(); }),
        A('Duplicate ' + t.name, ICONS.copy, () => load(copyName(t.name), t.source, null, 'new')),
        A('Rename ' + t.name, ICONS.ren, async () => {
          const v = window.prompt('Rename the script', t.name);
          if (!v || !v.trim()) return;
          try { await S.rename(t.id, v); if (editingId === t.id) { nameIn.value = v.trim(); base.name = v.trim(); } } catch (e) { showErr('Could not rename.'); }
          renderLists(); renderStatus();
        }),
        A('Publish or share ' + t.name, ICONS.share, () => {
          if (window.StrykerPineLibrary) window.StrykerPineLibrary.openPublish({ name: t.name, source: t.source });
          else showErr('Publishing is unavailable.');
        }),
        A('Delete ' + t.name, ICONS.del, async () => {
          if (!window.confirm('Delete the script "' + t.name + '"? It stays on any chart it is already on.')) return;
          try { await S.remove(t.id); if (editingId === t.id) { editingId = null; kind = 'new'; } } catch (e) { showErr('Could not delete.'); }
          renderLists(); renderStatus();
        }, 'stkc-del')
      ] })));
    Sh.setCount('mine', r.items.length);
  }

  const isPhone = () => window.innerWidth <= 700;
  function setOpen(open){
    panel.hidden = !open;
    Sh.setOpenState(open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.classList.toggle('stkc-pine-open', open);
    if (open) {
      if (!cur() && !base.src) load(S && S.EXAMPLES[0] ? S.EXAMPLES[0].name : '', S && S.EXAMPLES[0] ? S.EXAMPLES[0].source : NEW_SRC, null, S && S.EXAMPLES[0] ? 'example' : 'new');
      renderLists(); renderStatus();
      loadPine().catch(() => {});   // warm the engine while the member reads
      ensureEditor().then((e) => { if (!isPhone()) e.focus(); }).catch(() => {});
    }
  }
  btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(panel.hidden); });
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const sp = panel.querySelector('.cm-panel.cm-search'); if (sp && sp.contains(e.target)) return;   // Escape closes the find bar first
    e.stopPropagation();
    if (panel.classList.contains('is-max')) { Sh.setMax(false); return; }
    setOpen(false); btn.focus();
  });
  try { ws.on('cell:active', () => { if (!panel.hidden) setTimeout(renderLists, 0); }); } catch (e) {}
  try { ws.on('state:changed', () => { if (!panel.hidden) { renderTarget(); renderStatus(); } }); } catch (e) {}
  // Add a Community script (s = pineLibrary item) to the active chart: safety
  // check, Web Worker engine only, and its library id rides the chart state.
  async function addShared(s){
    if (!guardOk(s.source)) return { ok: false, msg: 'This script failed the safety check, so it won\'t run.' };
    const a = activeCell();
    if (!a.cell) return { ok: false, msg: 'No chart to add it to.' };
    try {
      const r = await runOnChart(a.cell.chart, s.source, {}, true);
      if (!r.ok) return { ok: false, heavy: r.heavy, cancelled: r.cancelled, msg: r.msg };
      libOf.set(r.handle, { id: s.id, version: s.version, openSource: s.openSource, ownerUid: s.ownerUid, name: s.name });
      changed();
      toast('Added ' + s.name + ' to the chart');
      if (!panel.hidden) renderLists();
      return { ok: true };
    } catch (e) {
      console.warn('TradeZoro: shared Pine run', e);
      return { ok: false, msg: "The Pine engine didn't load. Check your connection." };
    }
  }

  // Run a Pine source (TradeZoro example or one of My scripts) on the active chart, the same
  // engine path as the editor's Add to chart, without opening the editor. Used by the
  // Indicators window (assets/chart-indicator-window.js).
  async function addSource(name, source, opts){
    const a = activeCell();
    if (!a.cell) return { ok: false, msg: 'No chart to add it to.' };
    if (!source || !String(source).trim()) return { ok: false, msg: 'The script is empty.' };
    const max = opts && opts.builtin ? BUILTIN_SRC_MAX : SRC_MAX;
    if (source.length > max) return { ok: false, msg: 'This script is too long (' + Math.round(source.length / 1024) + ' KB, limit ' + Math.round(max / 1024) + ' KB).' };
    try {
      const r = await runOnChart(a.cell.chart, source, undefined, false, opts);
      if (!r.ok) return { ok: false, heavy: r.heavy, cancelled: r.cancelled, msg: (r.line ? 'Line ' + r.line + ': ' : '') + r.msg };
      toast('Added ' + ((typeof name === 'string' && name) || (name && typeof name.name === 'string' && name.name) || titleOf(r.handle)) + ' to the chart');
      if (!panel.hidden) renderLists();
      return { ok: true };
    } catch (e) {
      console.warn('TradeZoro: Pine run', e);
      return { ok: false, msg: "The Pine engine didn't load. Check your connection." };
    }
  }

  toast2 = (m, t) => { if (m) toast(m, t || 'error'); };
  async function addSealed(z){
    const a = activeCell();
    if (!a.cell) return { ok: false, msg: 'No chart to add it to.' };
    pageBusy(true);
    try {
      const r = await addSealedOn(a.cell.chart, z, {}, false);
      if (r.ok) { toast('Added ' + (z.name || 'the indicator') + ' to the chart'); if (!panel.hidden) renderLists(); }
      return r;
    } finally { pageBusy(false); }
  }
  // LAYOUT-PERF (2026-11-08): warm both engines (modules + worker download) when the Indicators window opens,
  // so the first built-in added draws without waiting for ~350 KB of engine in a chain.
  const warm = () => { const a = activeCell(); if (a.cell) ensureEngine(a.cell.chart).then(() => ensureNext(a.cell.chart)).catch(() => {}); };
  window.STRYKER_PINE = { warm, addSealed, sealOf, ensureRoom, open: () => setOpen(true), close: () => setOpen(false), load, addToChart, addShared, addSource, runOnChart, pineHandles, titleOf, explain, renderLists, toast, libOf };
  return { setOpen };
}
