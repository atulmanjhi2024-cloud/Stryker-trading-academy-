// TradeZoro MQL5 runner (page side): owns one sandboxed worker per indicator, enforces the wall-clock kill
// and turns the message protocol into promises. Calls are queued, so a timer tick never overlaps a calc.
//   const r = new MqRunner();
//   await r.start({ source, inputs, env, customs })  -> { ok, meta } | { ok:false, error }
//   await r.calc(bars, mode)  r.timer()  r.event([id, lparam, dparam, sparam], state)  r.chart({...})  r.dispose()
// The worker's engine stops itself at 20 s (calc) / 2 s (events); this kill is the outer guard for anything it misses.
const WORKER_URL = new URL('./worker.js?v=1264', import.meta.url);
export const KILL_MS = { calc: 25000, event: 6000, compile: 10000 };
export const START_MS = 30000;   // a fresh worker still has to download the engine

const killed = (ms) => ({ ok: false, killed: true, error: { code: 'E401', severity: 'error', line: 1, col: 1, message: 'The script took longer than ' + Math.round(ms / 1000) + ' seconds and was stopped.', hint: 'Look for a loop that runs too many times.' } });

export class MqRunner {
  constructor(opts) { this.opts = opts || {}; this.w = null; this.seq = 0; this.pending = new Map(); this.ready = false; this.q = Promise.resolve(); this.dead = false; }
  spawn() {
    if (this.w) return this.w;
    const w = new Worker(this.opts.workerUrl || WORKER_URL, { type: 'module', name: 'mql5' });
    w.onmessage = (ev) => {
      const m = ev.data;
      if (m && m.type === 'ready') { this.ready = true; return; }
      if (!m || !Number.isInteger(m.id)) return;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id); clearTimeout(p.timer);
      if (m.type === 'result') p.resolve(m.out); else p.reject(new Error(typeof m.message === 'string' ? m.message : 'MQL5 worker error'));
    };
    w.onerror = (ev) => { if (ev && ev.preventDefault) ev.preventDefault(); this.reset(new Error('The MQL5 worker stopped' + (this.ready ? '' : ' before it started') + (ev && ev.message ? ': ' + ev.message : '.'))); };
    this.w = w;
    return w;
  }
  reset(err) {
    if (this.w) { this.w.terminate(); this.w = null; }
    this.ready = false;
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
  }
  raw(type, msg, ms, transfer) {
    const w = this.spawn(), id = ++this.seq;
    return new Promise((resolve, reject) => {
      const started = this.ready;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        if (!this.ready) { this.reset(new Error('stopped')); reject(new Error('The MQL5 worker did not start in time.')); return; }
        this.reset(new Error('stopped')); this.dead = true;   // a runaway script: the worker is gone; start() again to retry
        resolve(type === 'compile' ? { ok: false, diagnostics: [killed(ms).error] } : killed(ms));
      }, started ? ms : ms + START_MS);
      this.pending.set(id, { resolve, reject, timer });
      w.postMessage(Object.assign({ type, id }, msg), transfer || []);
    });
  }
  // one message at a time, in order
  send(type, msg, ms, transfer) { const p = this.q.then(() => (this.dead && type !== 'start' && type !== 'compile' ? killed(ms) : this.raw(type, msg, ms, transfer))); this.q = p.catch(() => {}); return p; }
  compile(source) { return this.send('compile', { source }, KILL_MS.compile); }
  start(o) { this.dead = false; return this.send('start', { source: o.source, inputs: o.inputs || {}, env: o.env || {}, customs: o.customs || {} }, KILL_MS.compile); }
  calc(bars, mode) { return this.send('calc', { bars, mode: mode || 'full' }, KILL_MS.calc); }
  timer() { return this.send('timer', {}, KILL_MS.event); }
  event(ev, state) { return this.send('event', { ev, state: state || null }, KILL_MS.event); }
  chart(c) { return this.send('chart', { chart: c }, KILL_MS.event); }
  busy() { return this.pending.size > 0; }
  async dispose() { try { if (this.w && this.ready) await Promise.race([this.raw('dispose', {}, 1000), new Promise((r) => setTimeout(r, 1000))]); } catch (e) { /* closing */ } this.reset(new Error('disposed')); }
}
