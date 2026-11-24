// TradeZoro — Charts: Pine "next" engine, page side (ES module)
// Imported by assets/chart-pine.js. The worker half is assets/chart-pine-next-worker.js;
// read its header for why this exists (newer pinets OFF the page thread).
//
// PineNextEngine implements the same engine interface Vela calls on vela-pinets'
// PineWorkerEngine (language, capabilities, prepare, execute -> handle with getContext,
// stop, update, setVisibleRange, notifyBars). It is registered per chart under the
// language id 'pine-next'. One module worker for the whole page (see ONE WORKER below).
//
// Bars: Vela hands execute() a getBars() function; a worker can't call it, so every
// non-backfill bar notification ships a fresh snapshot (same as vela-pinets' own worker).
// Bursts are coalesced on the worker side (one re-run after the in-flight one lands).

import { SeriesCache } from './chart-pine-series-cache.js?v=1255';

const WORKER_URL = new URL('./chart-pine-next-worker.js?v=1255' + (typeof window !== 'undefined' && window.__stkVela090 === true ? '&vela=090' + (window.__stkVelaDir === 'vela-0.9.0-s17' ? '&vd=s17' : '') : ''), import.meta.url);

// request.security ranges: the engine asks for a long warm-up before the chart's first bar
// (seen: 33 days of 1m bars, 48k bars / 15 s of downloads, for a 3.5-day 1m chart). Keep a
// warm-up of 300 bars of the requested timeframe (at least a quarter of the chart's span)
// before the chart's first bar. Exported for tests.
export function clampRange(range, timeframe, bars){
  if (!range || !(range.from > 0) || !bars || bars.length < 2) return range;
  const first = Number(bars[0].openTime != null ? bars[0].openTime : bars[0].time);
  const last = Number(bars[bars.length - 1].openTime != null ? bars[bars.length - 1].openTime : bars[bars.length - 1].time);
  if (!(first > 0) || !(last > first)) return range;
  const tfMs = tfToMs(timeframe);
  const warm = Math.max((last - first) / 4, tfMs ? tfMs * 300 : 0);
  let minFrom = first - warm;
  // A request for a timeframe LOWER than the chart's (e.g. a script's default "60" structure
  // timeframe on a daily chart) would download that small timeframe across the whole chart span
  // (seen: 39 x 1h pages on NQ 1D, 22 on BTCUSDT 1D, pushing a run past the 20 s cap). Fetch at
  // most LOWER_TF_MAX_BARS of it, ending at the chart's last bar. The script is not changed; older
  // chart bars just see na from that request.
  const chartMs = (last - first) / (bars.length - 1);
  if (tfMs && chartMs && tfMs < chartMs * 0.99) minFrom = Math.max(minFrom, last - tfMs * LOWER_TF_MAX_BARS);
  return range.from < minFrom ? Object.assign({}, range, { from: minFrom }) : range;
}
export const LOWER_TF_MAX_BARS = 3000;
export const FIRST_WINDOW = 5000;
function tfToMs(tf){
  const m = /^(\d*)([SDWM]?)$/i.exec(String(tf || '').trim());
  if (!m) return 0;
  const n = Number(m[1] || 1), u = (m[2] || '').toUpperCase();
  return n * (u === 'S' ? 1e3 : u === 'D' ? 864e5 : u === 'W' ? 6048e5 : u === 'M' ? 2592e6 : 6e4);
}

// While a Pine script computes in the worker, html gets .stk-pine-busy and style.css pauses the
// endless decorative animations (plan badge / role tags). Those made the page paint every frame,
// which on small machines (2 cores) took the CPU from the worker: Liquidity Master on a 1m chart
// went from ~40 s to under 15 s with them paused. Safety: the class never stays on > 90 s.
const busyEngines = new Set();
let busyGuard = 0;
function setBusy(eng, on){
  if (on) busyEngines.add(eng); else busyEngines.delete(eng);
  if (typeof document === 'undefined') return;
  const any = busyEngines.size > 0;
  document.documentElement.classList.toggle('stk-pine-busy', any);
  clearTimeout(busyGuard);
  if (any) busyGuard = setTimeout(() => { busyEngines.clear(); document.documentElement.classList.remove('stk-pine-busy'); }, 90000);
}

// The bars the worker already has (s.sent) plus at most 2 new or changed bars at the end -> { from, tail }; anything else -> null (send all).
export function tailOf(s, b, reason){
  const k = s && s.sent;
  if (!k || reason || !b || b.length < k.n || b.length - k.n > 2 || !b.length || b[0].time !== k.first) return null;
  const i = k.n - 1;
  if (!b[i] || b[i].time !== k.last) return null;
  return { from: i, tail: b.slice(i) };
}

// ONE WORKER FOR ALL CHART CELLS (RAM round 2, member GK 11 Nov: "one chart tab ~4 GB"). Each worker holds
// its own copy of pinets + vela-pinets (~57 MB of JS heap before any script runs), and a 2-chart layout had
// two. Now every cell's engine talks to one shared worker for the BUILT-IN TradeZoro indicators. Routing is by
// id: request and session ids are unique across the page (one counter here) and every reply goes to the engine
// that owns that id. The shared worker is dropped once no engine has a script left.
//
// LANES (Owner 22 Nov, "remove the limit altogether"): there is no time limit any more, so a member's or a
// community script that computes for a long time (or never ends) must not hold up anything else. Every
// member / community script runs in its OWN worker ("lane", one per indicator on the chart; a sealed community
// indicator's lane also holds its decrypted source). Stopping a session whose lane is computing terminates that
// worker at once (a running pinets loop can't be interrupted from outside); the other indicators never notice.
// An idle lane is kept LANE_IDLE_MS after its session stops (a symbol / timeframe switch re-runs the same
// indicator) and is dropped when the indicator is removed (dropInstance).
const LANE_IDLE_MS = 8000;
const hub = { worker: null, engines: new Set(), owner: new Map(), seq: 0, lanes: new Map(), eseq: 0 };
function spawnWorker(key, onFail){
  const w = new Worker(WORKER_URL, { type: 'module', name: key ? 'stryker-pine-lane' : 'stryker-pine-next' });
  w.addEventListener('message', (e) => hubMessage(e.data || {}, key));
  w.addEventListener('error', (e) => onFail("Pine couldn't start in this browser: " + ((e && e.message) || 'the script engine file did not load')));
  return w;
}
function hubWorker(){
  if (!hub.worker) hub.worker = spawnWorker('', (msg) => hub.engines.forEach((eng) => eng.workerFailed(msg)));
  return hub.worker;
}
// key '' = the shared worker
function workerOf(key){
  if (!key) return hubWorker();
  let L = hub.lanes.get(key);
  if (!L) {
    L = { key, eng: null, inst: null, idle: 0, w: null };
    L.w = spawnWorker(key, (msg) => { if (L.eng) L.eng.workerFailed(msg, key); });
    hub.lanes.set(key, L);
  }
  clearTimeout(L.idle); L.idle = 0;
  return L.w;
}
function killLane(key){
  const L = hub.lanes.get(key); if (!L) return;
  hub.lanes.delete(key); clearTimeout(L.idle); setBusy(key, false);
  try { L.w.terminate(); } catch (e) {}
  if (L.eng) L.eng.prepares.forEach((p, id) => { if (p.lane === key) { L.eng.prepares.delete(id); hub.owner.delete('r' + id); p.reject(new Error('stopped')); } });
}
function hubMessage(m, key){
  switch (m.kind) {
    case 'busy': setBusy(key || hub, !!m.on); return;
    case 'progress': {
      if (m.secondary || !(m.total > 0)) return;
      (m.ids || []).forEach((id) => { const e = hub.owner.get('s' + id), s = e && e.sessions.get(id); if (s) { s.pct = Math.min(99, Math.round(m.done / m.total * 100)); } });
      return;
    }
    case 'started': case 'own': return;
    case 'loadError': m.lane = key || ''; hub.engines.forEach((eng) => eng.onMessage(m)); return;
    case 'fetchSeries': m.lane = key || ''; break;
  }
  const eng = (m.sessionId != null && hub.owner.get('s' + m.sessionId)) || (m.reqId != null && hub.owner.get('r' + m.reqId));
  if (eng) eng.onMessage(m);
  else if (m.kind === 'fetchSeries') { try { workerOf(key).postMessage({ kind: 'fetchSeriesResult', reqId: m.reqId, bars: [] }); } catch (e) {} }
}
function hubKill(){
  const w = hub.worker; if (!w) return;
  hub.worker = null; setBusy(hub, false);
  for (const [k, e] of hub.owner) if (!e.sessions.size && !e.prepares.size) hub.owner.delete(k);
  try { w.terminate(); } catch (e) {}
}
export function sharedWorkerState(){ return { worker: !!hub.worker, engines: hub.engines.size, lanes: hub.lanes.size, sessions: [...hub.engines].reduce((n, e) => n + e.sessions.size, 0) }; }   // tests

const SEAL_REF = /^\/\/@tz-sealed=([A-Za-z0-9]{8,40})\s*$/m;   // = the worker's stub format

export class PineNextEngine {
  // opts.isolate(source) -> true: the script runs in its own lane (member / community scripts). opts.onRun(): a
  // session started or stopped computing (chart-pine.js shows the Calculating chip).
  constructor(opts = {}){
    this.language = 'pine-next';
    this.capabilities = { streaming: true, visibleRange: true, inputs: true, props: true };
    this.opts = opts;
    this.n = ++hub.eseq;
    this.prepares = new Map();
    this.sessions = new Map();
    this.ctxWaits = new Map();
    // one request.security cache per chart, shared by all its scripts (dedupe, parallel cap, HTF from base, tail only)
    const phone = typeof window !== 'undefined' && (window.innerWidth < 700 || (window.matchMedia && window.matchMedia('(pointer:coarse)').matches));
    this.seriesCache = new SeriesCache({ maxBars: phone ? 150000 : 500000, maxInflight: phone ? 4 : 6 });
  }
  get worker(){ return hub.engines.has(this) ? hub.worker : null; }
  get reqId(){ return hub.seq; }
  nextId(kind){ const id = ++hub.seq; hub.owner.set(kind + id, this); return id; }
  w(){ hub.engines.add(this); return hubWorker(); }
  // Which worker runs this source: '' = shared (built-ins), else this indicator's lane.
  laneFor(source, instanceId){
    const z = SEAL_REF.exec(String(source || ''));
    if (z) return 'z' + z[1];
    try { if (this.opts.isolate && this.opts.isolate(source)) return 'e' + this.n + ':' + (instanceId || 'x' + hub.seq); } catch (e) {}
    return '';
  }
  postTo(key, m){
    hub.engines.add(this);
    const w = workerOf(key);
    if (key) { const L = hub.lanes.get(key); L.eng = this; }
    w.postMessage(m);
  }
  post(m){ this.postTo('', m); }
  workerFailed(msg, key){
    const k = key || '';
    this.prepares.forEach((p, id) => { if ((p.lane || '') === k) { p.reject(new Error(msg)); this.prepares.delete(id); } });
    this.sessions.forEach((s) => { if ((s.lane || '') === k) { try { s.handlers.onError && s.handlers.onError(new Error(msg)); } catch (x) {} } });
  }
  forget(){
    for (const [k, e] of hub.owner) if (e === this) hub.owner.delete(k);
    this.ctxWaits.forEach((r) => r(null)); this.ctxWaits.clear();
    for (const [k, L] of hub.lanes) if (L.eng === this) killLane(k);
    hub.engines.delete(this);
  }
  retire(){
    if (!hub.engines.has(this)) return;
    if (this.sessions.size || this.prepares.size) return;
    if (![...hub.lanes.values()].some((L) => L.eng === this)) hub.engines.delete(this);
    if (![...hub.engines].some((e) => e.sessions.size || e.prepares.size)) hubKill();
  }
  // The indicator left the chart: drop its lane now (chart-pine.js calls this on 'indicator:removed').
  dropInstance(instanceId){
    for (const [k, L] of hub.lanes) if (L.eng === this && L.inst === instanceId && ![...this.sessions.values()].some((s) => s.lane === k)) killLane(k);
  }
  // Member / community sessions computing right now: [{ id (indicator id), since (ms), pct }].
  runs(){ const out = []; this.sessions.forEach((s) => { if (s.lane && s.runAt) out.push({ id: s.instanceId, since: s.runAt, pct: s.pct || 0 }); }); return out; }
  idleLater(key){
    const L = hub.lanes.get(key); if (!L || key[0] === 'z') return;   // a sealed lane holds the decrypted script: kept until the indicator is removed
    clearTimeout(L.idle);
    L.idle = setTimeout(() => { if (![...this.sessions.values()].some((s) => s.lane === key) && ![...this.prepares.values()].some((p) => p.lane === key)) killLane(key); }, LANE_IDLE_MS);
  }
  prepare(source, instanceId){
    const reqId = this.nextId('r'), lane = this.laneFor(source, instanceId);
    return new Promise((resolve, reject) => {
      this.prepares.set(reqId, { resolve, reject, lane });
      this.postTo(lane, { kind: 'prepare', reqId, source, instanceId, defaultProps: this.opts.defaultProps, propsVisibility: this.opts.props || 'strategy' });
    });
  }
  // Sealed community indicators (see the worker's SEALED block): the page only ever sees ciphertext. Key exchange,
  // unsealing and every run of that indicator happen in its own lane ('z' + ref).
  ask(kind, extra, lane){
    const reqId = this.nextId('r');
    return new Promise((resolve, reject) => {
      this.prepares.set(reqId, { resolve, reject, lane: lane || '' });
      this.postTo(lane || '', Object.assign({ kind, reqId }, extra || {}));
    });
  }
  sealKey(ref){ return this.ask('sealKey', null, 'z' + ref); }
  unseal(ref, sealedMsg){ return this.ask('unseal', { ref, sealed: sealedMsg }, 'z' + ref); }
  execute(req, handlers){
    const sessionId = this.nextId('s');
    const barsOf = () => (req.getBars ? req.getBars() : req.bars) || [];
    const tk = (req.prepared && req.prepared.token) || {};
    const lane = this.laneFor(tk.source, tk.instanceId);
    const s = { req, handlers, barsOf, live: req.mode === 'live', lastTime: 0, lane, instanceId: tk.instanceId, runAt: 0, pct: 0 };
    if (lane) { workerOf(lane); hub.lanes.get(lane).inst = tk.instanceId; }
    this.sessions.set(sessionId, s);
    const post = (m) => this.postTo(lane, m);
    const all = barsOf();
    // FIRST WINDOW: on a deep chart (scrolled back / Days to load) the first run computes the last FIRST_WINDOW bars only,
    // so the script draws in seconds; the whole history follows as one 'complete' re-run right after that first draw.
    const bars = all.length > FIRST_WINDOW ? all.slice(-FIRST_WINDOW) : all;
    s.windowed = bars !== all;
    s.lastTime = bars.length ? bars[bars.length - 1].time : 0;
    s.sent = bars.length && !s.windowed ? { n: bars.length, first: bars[0].time, last: bars[bars.length - 1].time } : null;
    const plain = {
      prepared: req.prepared, market: req.market, bars, inputs: Object.assign({}, req.inputs || {}),
      props: req.props ? Object.assign({}, req.props) : undefined, visibleRange: req.visibleRange,
      mode: s.live ? 'live' : 'static', historyState: req.historyState
    };
    post({ kind: 'execute', sessionId, req: plain, sentAt: Date.now() });
    s.post = post;
    return {
      getContext: (select) => new Promise((resolve) => {
        const reqId = this.nextId('r');
        this.ctxWaits.set(reqId, resolve);
        post({ kind: 'getContext', sessionId, reqId, select });
      }),
      stop: () => {
        const busy = !!s.runAt;
        this.sessions.delete(sessionId); hub.owner.delete('s' + sessionId);
        // A run in progress can't be interrupted inside a worker. In its own lane it is: terminate that worker
        // (Cancel, remove, symbol switch). A sealed lane keeps its worker (it holds the decrypted script).
        if (lane && busy && lane[0] !== 'z') killLane(lane);
        else { try { post({ kind: 'stop', sessionId }); } catch (e) {} if (lane) this.idleLater(lane); }
        if (busy && this.opts.onRun) { try { this.opts.onRun(); } catch (e) {} }
        // With no scripts left, drop the shared worker; the next add starts a fresh one (pinets comes from the HTTP cache).
        if (!this.sessions.size && !this.prepares.size) this.retire();
      },
      update: (inputs, props) => post({ kind: 'update', sessionId, inputs: Object.assign({}, inputs || {}), props: props ? Object.assign({}, props) : undefined }),
      setVisibleRange: (range) => post({ kind: 'setVisibleRange', sessionId, range }),
      notifyBars: (reason) => {
        if (reason === 'backfill') return;
        const b = barsOf(), t = tailOf(s, b, reason);
        // A live tick only changes the last bar or adds one: send just those, not a copy of the whole history
        // (a 1m chart sent ~6k bar objects a second to the worker; at 17k bars after a scroll-back it ran out of memory on phones).
        if (t) post({ kind: 'notifyBars', sessionId, reason, tail: t.tail, from: t.from });
        else post({ kind: 'notifyBars', sessionId, reason, bars: b });
        s.sent = b.length ? { n: b.length, first: b[0].time, last: b[b.length - 1].time } : null;
      }
    };
  }
  onMessage(m){
    switch (m.kind) {
      case 'prepared': {
        const p = this.prepares.get(m.reqId); if (!p) return;
        this.prepares.delete(m.reqId); hub.owner.delete('r' + m.reqId);
        if (m.error) p.reject(new Error(m.error)); else p.resolve(m.prepared);
        return;
      }
      case 'sealKey':
      case 'unsealed': {
        const p = this.prepares.get(m.reqId); if (!p) return;
        this.prepares.delete(m.reqId);
        if (m.error) p.reject(new Error(m.error)); else p.resolve(m.kind === 'sealKey' ? m.pub : m.version);
        return;
      }
      case 'run': {
        const s = this.sessions.get(m.sessionId); if (!s) return;
        s.runAt = m.on ? (s.runAt || Date.now()) : 0; if (!m.on) s.pct = 0;
        if (this.opts.onRun) { try { this.opts.onRun(); } catch (e) {} }
        return;
      }
      case 'loadError': {
        const err = new Error("Pine couldn't start in this browser: " + (m.message || 'the script engine did not load'));
        try { console.error('TradeZoro: ' + err.message); window.dispatchEvent(new ErrorEvent('error', { message: err.message, filename: 'chart-pine-next.js' })); } catch (e) {}
        this.prepares.forEach((p, id) => { if ((p.lane || '') === (m.lane || '')) { p.reject(err); this.prepares.delete(id); } });
        return;
      }
      case 'model': {
        const s = this.sessions.get(m.sessionId); if (!s) return;
        s.handlers.onModel(m.model);
        if (s.windowed) {   // first draw on the window is up: now run the whole history
          s.windowed = false;
          const b = s.barsOf();
          s.post({ kind: 'notifyBars', sessionId: m.sessionId, reason: 'complete', bars: b });
          s.sent = b.length ? { n: b.length, first: b[0].time, last: b[b.length - 1].time } : null;
        }
        return;
      }
      case 'alert': { const s = this.sessions.get(m.sessionId); if (s && s.handlers.onAlert) s.handlers.onAlert(m.alert); try { if (this.opts.onAlert) this.opts.onAlert(m.alert, s); } catch (e) {} return; }
      case 'warning': { const s = this.sessions.get(m.sessionId); if (s && s.handlers.onWarning) s.handlers.onWarning(m.warning); return; }
      case 'error': { const s = this.sessions.get(m.sessionId); if (s && s.handlers.onError) s.handlers.onError(new Error(m.message)); return; }
      // own-compute clock for the page's time limit (chart-pine.js runOnChartInner): 'started' = the worker
      // picked the run up (queue wait ends), 'own' = ms other scripts' runs overlapped it.
      case 'done': { const s = this.sessions.get(m.sessionId); if (s && s.handlers.onDone) s.handlers.onDone(); return; }
      case 'contextResult': { const w = this.ctxWaits.get(m.reqId); this.ctxWaits.delete(m.reqId); hub.owner.delete('r' + m.reqId); if (w) w(m.snapshot); return; }
      case 'fetchSeries': this.serveFetch(m); return;
    }
  }
  cachedFetch(s, m){
    const range = clampRange(m.range, m.timeframe, s.barsOf());
    const mk = s.req.market || {};
    const all = s.req.getBars ? s.req.getBars() : s.req.bars;
    const base = mk.symbol && mk.timeframe && all && all.length ? { symbol: mk.symbol, timeframe: mk.timeframe, bars: all } : null;
    return this.seriesCache.get(m.symbol, m.timeframe, range, (sy, tf, r) => s.req.fetchSeries(sy, tf, r), base);
  }
  async serveFetch(m){
    const own = this.sessions.get(m.sessionId), s = own && own.req.fetchSeries ? own : [...this.sessions.values()].find((x) => x.req.fetchSeries);
    const reply = (r) => { try { if (!m.lane || hub.lanes.has(m.lane)) this.postTo(m.lane || '', Object.assign({ kind: 'fetchSeriesResult', reqId: m.reqId }, r)); } catch (e) {} };
    if (!s) { reply({ bars: [] }); return; }
    try { reply({ bars: await this.cachedFetch(s, m) }); }
    catch (e) { reply({ error: String((e && e.message) || e) }); }
  }
}
