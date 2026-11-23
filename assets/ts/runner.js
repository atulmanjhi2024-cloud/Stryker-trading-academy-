// TradeZoro thinkScript runner (page side): owns the sandboxed worker (worker.js), kills a run that takes too long,
// and turns the message protocol into promises.
//   const r = new TsRunner();
//   const meta = await r.analyze(source);          // { ok, diagnostics, meta }
//   const out = await r.run({ source, bars, inputs, symbol, tfMs, futuresDay, tick, securities });
//   r.dispose();
const WORKER_URL = new URL('./worker.js?v=1227', import.meta.url);
export const KILL_MS = { run: 25000, analyze: 10000 };
const START_MS = 30000;   // a fresh worker still has to download the engine: a slow line is not a runaway script

const killed = (ms) => ({ ok: false, error: { code: 'TS8', severity: 'error', line: 1, col: 1, message: 'The script took longer than ' + Math.round(ms / 1000) + ' seconds and was stopped.', hint: 'Look for a fold that runs too many times.' }, plots: [] });

export class TsRunner {
  constructor(opts) { this.opts = opts || {}; this.w = null; this.seq = 0; this.pending = new Map(); this.ready = false; }
  spawn() {
    if (this.w) return this.w;
    const w = new Worker(this.opts.workerUrl || WORKER_URL, { type: 'module', name: 'thinkscript' });
    w.onmessage = (ev) => {
      const m = ev.data;
      if (m && m.type === 'ready') { this.ready = true; return; }
      if (!m || !Number.isInteger(m.id)) return;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id); clearTimeout(p.timer);
      if (m.type === 'result') p.resolve(m.out);
      else p.reject(Object.assign(new Error(typeof m.message === 'string' ? m.message : 'The thinkScript worker stopped.'), { user: true }));
    };
    w.onerror = (ev) => { if (ev && ev.preventDefault) ev.preventDefault(); this.reset(new Error('The thinkScript worker stopped' + (this.ready ? '' : ' before it started') + (ev && ev.message ? ': ' + ev.message : '.'))); };
    this.w = w;
    return w;
  }
  reset(err) {
    if (this.w) { this.w.terminate(); this.w = null; }
    this.ready = false;
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
  }
  send(type, msg, ms) {
    const w = this.spawn(), id = ++this.seq;
    return new Promise((resolve, reject) => {
      const started = this.ready;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        if (!this.ready) { this.reset(new Error('stopped')); reject(new Error('The thinkScript worker did not start in time.')); return; }
        this.reset(new Error('stopped'));   // a runaway script: the worker is killed outright (the engine also stops itself at 20 s)
        resolve(type === 'analyze' ? { ok: false, diagnostics: [killed(ms).error], meta: null } : killed(ms));
      }, started ? ms : ms + START_MS);
      this.pending.set(id, { resolve, reject, timer });
      w.postMessage(Object.assign({ type, id }, msg));
    });
  }
  analyze(source) { return this.send('analyze', { source }, KILL_MS.analyze); }
  run(o) {
    return this.send('run', { source: o.source, bars: o.bars, inputs: o.inputs || {}, symbol: o.symbol || '', tfMs: o.tfMs || 6e4, futuresDay: !!o.futuresDay, utcDay: !!o.utcDay, tick: o.tick || 0, securities: o.securities || {} }, KILL_MS.run);
  }
  dispose() { this.reset(new Error('disposed')); }
}
