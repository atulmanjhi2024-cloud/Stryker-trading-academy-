// TradeZoro MQL5 sandboxed runner (module Web Worker). Started by runner.js; never loaded by a page.
//
// Pasted MQL5 runs in here. The engine never turns member text into JavaScript source (closures only, see
// compiler.js), and this file removes every network / storage / messaging door before the first message.
// It is served with its own enforced CSP (_headers: connect-src 'none'), the second lock.
// The worker has no timers of its own (setTimeout is removed): the page sends {type:'timer'} at the
// interval the script asked for, and OnTimer runs here.
//
// PROTOCOL (structured clone):
//   page -> worker  {type:'compile', id, source}                         -> {ok, meta} | {ok:false, diagnostics:[d]}
//                   {type:'start', id, source, inputs, env, customs}     compile + hold one indicator; -> {ok, meta}
//                   {type:'calc', id, bars, mode}                        mode 'full' | 'tick' | 'append'; -> output
//                   {type:'timer', id}  {type:'event', id, ev:[id,l,d,s], state?:{name, props}}  {type:'chart', id, chart}
//                   {type:'deinit', id, reason}  {type:'dispose', id}
//   worker -> page  {type:'ready'} | {type:'result', id, out} | {type:'error', id, message}
import { Indicator, diagOf } from './program.js?v=1274';

const post = self.postMessage.bind(self);
const MAX_SOURCE = 256 * 1024;
const MAX_BARS = 200000;
const FnCtor = Function, AsyncFnCtor = (async () => {}).constructor, GenFnCtor = (function* () {}).constructor;
const hasOwn = Object.prototype.hasOwnProperty;
const perf = performance.now.bind(performance), now = Date.now;
const DOORS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource', 'importScripts', 'indexedDB',
  'caches', 'BroadcastChannel', 'Worker', 'SharedWorker', 'WebTransport', 'RTCPeerConnection', 'navigator', 'Request',
  'Notification', 'FileReader', 'FileReaderSync', 'open', 'close', 'storage', 'cookieStore', 'Atomics', 'SharedArrayBuffer',
  'MessageChannel', 'postMessage', 'eval', 'Function', 'WebAssembly', 'setTimeout', 'setInterval', 'queueMicrotask',
  'requestAnimationFrame', 'location', 'origin'];
for (let o = self; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
  for (const k of DOORS) {
    if (o !== self && !hasOwn.call(o, k)) continue;
    try { Object.defineProperty(o, k, { value: undefined, configurable: false, writable: false }); } catch (e) {
      try { delete o[k]; } catch (e2) { /* not deletable: covered by the CSP */ }
    }
  }
}
try { for (const F of [FnCtor, AsyncFnCtor, GenFnCtor]) Object.defineProperty(F.prototype, 'constructor', { value: undefined, writable: false, configurable: false }); } catch (e) { /* best effort */ }
for (const o of [Object.prototype, Array.prototype, FnCtor.prototype, Map.prototype, String.prototype, Number.prototype, Boolean.prototype]) Object.freeze(o);

let ind = null;
const FIELDS = ['time', 'open', 'high', 'low', 'close', 'tick_volume', 'volume', 'spread'];
// bars arrive as typed or plain arrays; the engine wants plain number arrays of one length
function cleanBars(b) {
  if (!b || typeof b !== 'object' || !b.time) throw Object.assign(new Error('bars missing'), { code: 1 });
  const n = Math.min(MAX_BARS, b.time.length | 0), o = {};
  for (const f of FIELDS) {
    const src = b[f], a = new Array(n);
    for (let i = 0; i < n; i++) { const v = src ? +src[i] : 0; a[i] = Number.isFinite(v) ? v : 0; }
    o[f] = a;
  }
  return o;
}
function transfers(out) {
  const t = [];
  for (const p of (out && out.plots) || []) { for (const d of p.data || []) if (d && d.buffer) t.push(d.buffer); if (p.ci && p.ci.buffer) t.push(p.ci.buffer); }
  return t;
}
const reply = (id, out) => post({ type: 'result', id, out }, transfers(out));
function compileOnly(source) {
  try { const x = new Indicator(source, { now, perf }); return { ok: true, meta: x.meta }; }
  catch (e) { return { ok: false, diagnostics: [diagOf(e)] }; }
}

function handle(m, id) {
  switch (m.type) {
    case 'compile':
      if (typeof m.source !== 'string' || m.source.length > MAX_SOURCE) { post({ type: 'error', id, message: 'source must be text under 256 KB' }); return; }
      reply(id, compileOnly(m.source)); return;
    case 'start': {
      if (typeof m.source !== 'string' || m.source.length > MAX_SOURCE) { post({ type: 'error', id, message: 'source must be text under 256 KB' }); return; }
      const customs = new Map();
      if (m.customs && typeof m.customs === 'object') for (const k of Object.keys(m.customs).slice(0, 50)) if (typeof m.customs[k] === 'string' && m.customs[k].length <= MAX_SOURCE) customs.set(k, m.customs[k]);
      const env = Object.assign({}, m.env && typeof m.env === 'object' ? m.env : {}, { inputs: m.inputs && typeof m.inputs === 'object' ? m.inputs : {}, customs, now, perf });
      try { ind = new Indicator(m.source, env); reply(id, { ok: true, meta: ind.meta }); }
      catch (e) { ind = null; reply(id, { ok: false, error: diagOf(e), diagnostics: [diagOf(e)] }); }
      return;
    }
    case 'calc': if (!ind) break; reply(id, ind.calc(cleanBars(m.bars), m.mode === 'tick' || m.mode === 'append' ? m.mode : 'full')); return;
    case 'timer': if (!ind) break; reply(id, ind.timer()); return;
    case 'event': {
      if (!ind) break;
      if (m.state && typeof m.state.name === 'string') ind.objectState(m.state.name, m.state.props);
      const e = Array.isArray(m.ev) ? m.ev : [];
      reply(id, ind.event(e[0] | 0, +e[1] || 0, +e[2] || 0, typeof e[3] === 'string' ? e[3] : ''));
      return;
    }
    case 'chart': if (ind && m.chart && typeof m.chart === 'object') ind.setChart(m.chart); reply(id, { ok: true }); return;
    case 'deinit': if (ind) ind.deinit(m.reason | 0); reply(id, { ok: true }); return;
    case 'dispose': if (ind) ind.deinit(1); ind = null; reply(id, { ok: true }); return;
    default: post({ type: 'error', id, message: 'unknown message' }); return;
  }
  post({ type: 'error', id, message: 'start the indicator first' });
}

self.onmessage = (ev) => {
  const m = ev.data;
  if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
  const id = Number.isInteger(m.id) ? m.id : 0;
  try { handle(m, id); } catch (e) { post({ type: 'error', id, message: e && e.code ? String(e.message) : 'The script could not run.' }); }
};
post({ type: 'ready' });
