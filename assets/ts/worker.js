// TradeZoro thinkScript sandboxed runner (module Web Worker). Started by runner.js; never loaded by a page.
//
// Member scripts (pasted, shared, or from an example) run in here, off the page thread. The engine never evaluates member
// text as JavaScript (compiler.js builds closures from the parsed tree), and this file removes every network / storage /
// messaging door the worker has before it answers a single message. It is also served with its own strict CSP
// (_headers: connect-src 'none'), so even a bug in the engine cannot reach the network.
//
// PROTOCOL (structured clone):
//   page -> worker  {type:'analyze', id, source}                          -> out { ok, diagnostics, meta }
//                   {type:'run', id, source, bars, inputs, symbol, tfMs, futuresDay, tick, securities}
//                                                                         -> out (compiler.js execute; out.need = more bars wanted)
//   worker -> page  {type:'ready'} | {type:'result', id, out} | {type:'error', id, message}
import { analyze, execute, LIMITS } from './compiler.js?v=1216';

const post = self.postMessage.bind(self);
const MAX_OUT = 32 * 1024 * 1024;

// ---- lock the worker down (before the first message is handled) ----
const FnCtor = Function, AsyncFnCtor = (async () => {}).constructor, GenFnCtor = (function* () {}).constructor;
const hasOwn = Object.prototype.hasOwnProperty;
const DOORS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource', 'importScripts', 'indexedDB',
  'caches', 'BroadcastChannel', 'Worker', 'SharedWorker', 'WebTransport', 'RTCPeerConnection', 'navigator', 'Request',
  'Notification', 'FileReader', 'FileReaderSync', 'open', 'close', 'storage', 'cookieStore', 'Atomics', 'SharedArrayBuffer',
  'MessageChannel', 'postMessage', 'eval', 'Function', 'WebAssembly', 'setTimeout', 'setInterval', 'queueMicrotask',
  'requestAnimationFrame', 'location', 'origin', 'crypto'];
for (let o = self; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
  for (const k of DOORS) {
    if (o !== self && !hasOwn.call(o, k)) continue;
    try { Object.defineProperty(o, k, { value: undefined, configurable: false, writable: false }); } catch (e) {
      try { delete o[k]; } catch (e2) { /* not deletable: covered by the CSP */ }
    }
  }
}
try {
  for (const F of [FnCtor, AsyncFnCtor, GenFnCtor]) Object.defineProperty(F.prototype, 'constructor', { value: undefined, writable: false, configurable: false });
} catch (e) { /* best effort */ }
for (const o of [Object.prototype, Array.prototype, FnCtor.prototype, Map.prototype, Set.prototype, String.prototype, Number.prototype, Boolean.prototype]) Object.freeze(o);

// ---- inputs from the page: plain arrays of finite numbers only ----
const KEYS = ['time', 'open', 'high', 'low', 'close', 'volume'];
function cleanBars(b) {
  if (!b || typeof b !== 'object' || !b.time || typeof b.time.length !== 'number') throw Object.assign(new Error('bad bars'), { user: 'No bars to run on.' });
  const n = Math.min(b.time.length, LIMITS.bars), out = {};
  for (const k of KEYS) {
    const src = b[k], a = new Float64Array(n);
    for (let i = 0; i < n; i++) { const v = src ? +src[i] : NaN; a[i] = Number.isFinite(v) ? v : (k === 'volume' ? 0 : NaN); }
    out[k] = a;
  }
  return out;
}
function cleanInputs(o) {
  const out = {};
  if (o && typeof o === 'object') for (const k of Object.keys(o).slice(0, 200)) {
    if (!/^\d{1,3}$/.test(k)) continue;
    const v = o[k];
    if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 4096)) out[k] = v;
  }
  return out;
}
function size(out) {
  let n = 0;
  for (const p of out.plots || []) n += (p.values ? p.values.length * 8 : 0) + (p.colors ? p.colors.length * 12 : 0);
  for (const f of out.fills || []) n += f.colors ? f.colors.length * 12 : 0;
  n += JSON.stringify([out.labels, out.lines, out.tables, out.tsAlerts]).length * 2;
  return n;
}
const transfers = (out) => (out.plots || []).map((p) => p.values && p.values.buffer).filter(Boolean);

function handle(m, id) {
  switch (m.type) {
    case 'analyze': {
      if (typeof m.source !== 'string' || m.source.length > LIMITS.source) { post({ type: 'error', id, message: 'The script must be text under 256 KB.' }); return; }
      post({ type: 'result', id, out: analyze(m.source) });
      return;
    }
    case 'run': {
      if (typeof m.source !== 'string' || m.source.length > LIMITS.source) { post({ type: 'error', id, message: 'The script must be text under 256 KB.' }); return; }
      const securities = {};
      if (m.securities && typeof m.securities === 'object') for (const k of Object.keys(m.securities).slice(0, 16)) securities[String(k).slice(0, 80)] = cleanBars(m.securities[k]);
      const out = execute(m.source, {
        bars: cleanBars(m.bars), inputs: cleanInputs(m.inputs), symbol: String(m.symbol || '').slice(0, 80), tfMs: +m.tfMs || 6e4,
        futuresDay: !!m.futuresDay, utcDay: !!m.utcDay, tick: +m.tick || 0.01, securities
      });
      if (out.plots && size(out) > MAX_OUT) {
        post({ type: 'result', id, out: { ok: false, error: { code: 'TS9', severity: 'error', line: 1, col: 1, message: 'The script output is too large (limit 32 MB).', hint: 'Plot fewer values.' }, plots: [] } });
        return;
      }
      post({ type: 'result', id, out }, transfers(out));
      return;
    }
    case 'dispose': post({ type: 'result', id, out: { ok: true } }); return;
    default: post({ type: 'error', id, message: 'unknown message' });
  }
}

self.onmessage = (ev) => {
  const m = ev.data;
  if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
  const id = Number.isInteger(m.id) ? m.id : 0;
  try { handle(m, id); } catch (e) {
    // a plain message, never the stack
    post({ type: 'error', id, message: e && e.user ? e.user : e && e.ts ? String(e.message) : 'The script could not run.' });
  }
};
post({ type: 'ready' });
