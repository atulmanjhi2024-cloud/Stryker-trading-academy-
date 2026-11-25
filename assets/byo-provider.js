// TradeZoro — "Connect your own data": chart providers (ES module). DATA ONLY.
// Depends on: assets/byo-core.js (route, adapters). Plugs into the same provider port as the other feeds
// (info, listSymbols, getSymbolInfo, getCalendar, getBars, subscribe) and goes through the same wrappers in
// assets/vela-chart.js (Iv.wrapFactory -> chart-live-resume.js: reconnect on return, back-fill, stall watchdog).
//  - withByo(Base, kind): wraps the delayed forex ("fx") / index+ETF ("idx") provider. While a connected source covers
//    the symbol, history and the live candle come from the member's own account; otherwise the base provider answers.
//  - ByoProvider: provider "byo" for stocks the member's own account serves (prefix "byo:", e.g. byo:AAPL).
import { route, onByoChange, statusRec } from './byo-core.js?v=1296';

export const POPULAR = [['AAPL', 'Apple'], ['MSFT', 'Microsoft'], ['NVDA', 'NVIDIA'], ['TSLA', 'Tesla'], ['AMZN', 'Amazon'], ['GOOGL', 'Alphabet'], ['META', 'Meta Platforms'], ['AMD', 'Advanced Micro Devices'],
  ['NFLX', 'Netflix'], ['SPY', 'SPDR S&P 500 ETF'], ['QQQ', 'Invesco QQQ'], ['IWM', 'iShares Russell 2000 ETF'], ['DIA', 'SPDR Dow Jones ETF']];
const SUPPORTED = ['1', '5', '15', '30', '60', '120', '240', 'D', 'W', 'M'];

// ---------- gap heal (Owner bug 25 Nov, CFDGAPS: "candles are breaking in cfd charts like ctrader") ----------
// Live bars are built from the ticks that arrived while connected, so minutes the socket missed (tab hidden, sleep, a relay drop,
// a reconnect) left a hole the chart never filled. For every live own-feed chart this re-reads the server's bars and merges them
// into the chart (by time: missing bars inserted, a differing closed bar replaced, the forming bar left to the live feed):
//   - when the feed comes back live after a drop, when the tab becomes visible again, when a new bar opens more than one period
//     after the last one, and every 60 s (the last 3 bars, plus any hole in the newest 400 bars not yet confirmed empty by the server).
const TFMS = { '1': 6e4, '5': 3e5, '15': 9e5, '30': 18e5, '60': 36e5, '120': 72e5, '240': 144e5, D: 864e5, W: 6048e5, M: 2592e6 };
const tfMs = (tf) => TFMS[String(tf).replace(/^1([DWM])$/, '$1')] || (/^\d+$/.test(String(tf)) ? +tf * 6e4 : 0);
export const HEAL = { everyMs: 60000, maxBars: 4000, look: 400, watchers: new Set(), ws: () => (typeof window !== 'undefined' ? window.STRYKER_VELA : null) };
const symKey = (s) => String(s || '').toUpperCase();
function cellsFor(w) {
  const ws = HEAL.ws(); let list = [];
  try { list = ws.context().cells || []; } catch (e) { return []; }
  const want = symKey(w.kind + ':' + w.ticker);
  return list.filter((c) => symKey(c.symbol) === want && String(c.timeframe) === String(w.tf)).map((c) => { try { return ws.cell(c.id).chart.orchestrator; } catch (e) { return null; } }).filter((o) => o && Array.isArray(o.rawBars) && o.setBarSeries && !(o.config && o.config.market && o.config.market.data && o.config.market.data.length) && !(typeof window !== 'undefined' && window.__stkReplay && window.__stkReplay.on));   // never during bar replay
}
const sameBar = (a, b) => a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close;
// Merge server bars into the chart's raw series. Returns the new array, or null when nothing changed. The chart's newest bar
// (the forming one) keeps its live values; server bars newer than it are added (the chart was behind).
export function mergeBars(raw, got) {
  if (!raw.length || !got.length) return null;
  const last = raw[raw.length - 1].time, by = new Map(raw.map((b, i) => [b.time, i]));
  let out = null;
  for (const b of got) {
    if (!b || !Number.isFinite(b.time) || b.time === last) continue;
    const i = by.get(b.time);
    if (i != null) { const cur = (out || raw)[i]; if (!sameBar(cur, b)) { out = out || raw.slice(); out[i] = { ...cur, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume != null ? b.volume : cur.volume }; } }
    else { out = out || raw.slice(); by.set(b.time, out.length); out.push({ ...b }); }
  }
  return out && out.sort((a, b) => a.time - b.time);
}
async function healOne(w, why) {
  if (w.busy || w.stopped) return; const step = tfMs(w.tf); if (!step) return;
  const os = cellsFor(w); if (!os.length) return;
  w.busy = true;
  try {
    const raw = os[0].rawBars; if (raw.length < 2) return;
    const now = Date.now(), tail = raw.slice(-HEAL.look);
    // timer: the last 3 bars; a return / reconnect / jump: also everything since the page went away (or the last 30 bars)
    let from = raw[Math.max(0, raw.length - (why === 'timer' ? 3 : 30))].time, hole = null;
    if (why !== 'timer' && HEAL.awayAt) from = Math.min(from, HEAL.awayAt - step);
    for (let i = 0; i < tail.length - 1; i++) if (tail[i + 1].time - tail[i].time > step && !w.empty.has(tail[i].time)) { hole = [tail[i].time, tail[i + 1].time]; from = tail[i].time; break; }
    from = Math.max(from, now - HEAL.maxBars * step);
    const got = await w.r.ad.getBars(w.r.rec.creds, w.ticker, w.tf, { from, to: now, limit: Math.min(5000, Math.ceil((now - from) / step) + 3) });
    if (w.stopped || !Array.isArray(got)) return;
    if (hole && !got.some((b) => b.time > hole[0] && b.time < hole[1])) w.empty.add(hole[0]);   // a real market break (weekend, daily close)
    for (const o of cellsFor(w)) {
      const m = mergeBars(o.rawBars, got.filter((b) => b.time >= from));
      if (!m) continue;
      o.setBarSeries(m, { preserveView: true });
      try { if (o.reexecuteIndicators) o.reexecuteIndicators(); } catch (e) { /* indicators re-run on the next bar */ }
      w.fixed = (w.fixed || 0) + 1; w.lastFix = why;
    }
  } catch (e) { /* the next trigger tries again */ } finally { w.busy = false; }
}
export const healAll = (why) => Promise.all([...HEAL.watchers].map((w) => healOne(w, why)));
let healInstalled = false, healTimer = null;
function installHeal() {
  if (healInstalled) return; healInstalled = true;
  const was = new Map();   // source id -> last status: back to live after a drop = reconnect
  onByoChange(() => { for (const w of HEAL.watchers) { const rec = statusRec(w.r.id), st = rec && rec.status, prev = was.get(w.r.id); was.set(w.r.id, st); if (st === 'live' && prev && prev !== 'live') setTimeout(() => healOne(w, 'reconnect'), 500); } });
  if (typeof document === 'undefined') return;
  const tick = () => { healTimer = setTimeout(tick, HEAL.everyMs); if (!document.hidden && HEAL.watchers.size) healAll('timer'); };
  healTimer = setTimeout(tick, HEAL.everyMs);
  // after chart-live-resume.js has re-opened the feed (it waits up to 2.5 s for its own back-fill)
  document.addEventListener('visibilitychange', () => { if (document.hidden) { HEAL.awayAt = HEAL.awayAt || Date.now(); return; } setTimeout(() => { healAll('visible').then(() => { HEAL.awayAt = 0; }); }, 3000); });
  window.addEventListener('online', () => setTimeout(() => healAll('online'), 3000));
}

function liveSub(r, ticker, timeframe, onBar, kind) {
  let stopped = false, off = null, lastT = null;
  const step = tfMs(timeframe), w = { r, ticker, tf: String(timeframe), kind, empty: new Set(), stopped: false };
  // a new bar more than one period after the last one: heal soon (after Vela's own gap fill has had its try)
  const bar = (b) => { if (b && step && lastT != null && b.time > lastT + step) setTimeout(() => healOne(w, 'gap'), 1500); if (b && (lastT == null || b.time > lastT)) lastT = b.time; onBar(b); };
  if (kind) { installHeal(); HEAL.watchers.add(w); }
  r.ad.getBars(r.rec.creds, ticker, timeframe, { limit: 1 }).catch(() => []).then((bs) => {
    if (stopped) return;
    off = r.ad.subscribe(r.rec.hub, ticker, timeframe, bs[bs.length - 1] || null, bar);
  });
  return () => { stopped = w.stopped = true; HEAL.watchers.delete(w); if (off) off(); };
}

export function withByo(Base, kind) {
  return class extends Base {
    async getBars(ticker, timeframe, range = {}) {
      const r = route(kind, ticker);
      if (r) { try { const b = await r.ad.getBars(r.rec.creds, ticker, timeframe, range); if (b.length) return b; } catch (e) { /* falls back to the standard feed */ } }
      return super.getBars(ticker, timeframe, range);
    }
    subscribe(ticker, timeframe, onBar) {
      const r = route(kind, ticker);
      return r ? liveSub(r, ticker, timeframe, onBar, kind) : super.subscribe(ticker, timeframe, onBar);
    }
  };
}

export class ByoProvider {
  info() {
    return { name: 'byo', displayName: 'Your data', requiresApiKey: false, supportedTimeframes: SUPPORTED, capabilities: { enumerate: true, stream: true, symbolInfo: true } };
  }
  async listSymbols() {
    if (!route('byo', 'AAPL')) return [];
    return POPULAR.map(([t, d]) => ({ ticker: t, description: d, type: 'stock', prefix: 'BYO', market: 'equity', exchange: 'US', mintick: 0.01, pointvalue: 1 }));
  }
  async getSymbolInfo(ticker) {
    const r = route('byo', ticker);
    if (!r) return undefined;
    const t = r.ad.symbolOf(ticker);
    if (r.ad.info) return r.ad.info(t, r.rec.creds);
    if (r.id === 'ironbeam') return { ticker: t, tickerid: 'BYO:' + t, prefix: 'BYO', description: t.split(':')[1], type: 'futures', market: 'futures', currency: 'USD', mintick: 0.01, pricescale: 100, minmove: 1, pointvalue: 1, timezone: 'America/Chicago', session: '1700-1600' };
    const known = POPULAR.find((p) => p[0] === t);
    return { ticker: t, tickerid: 'BYO:' + t, prefix: 'BYO', description: known ? known[1] : t, type: 'stock', market: 'equity', currency: 'USD', mintick: 0.01, pricescale: 100, minmove: 1, pointvalue: 1,
      timezone: 'America/New_York', session: '0930-1600', session_extended: '0400-2000' };
  }
  async getCalendar() { return []; }
  resolveSymbolIcon() { return undefined; }
  async getBars(ticker, timeframe, range = {}) {
    const r = route('byo', ticker);
    return r ? r.ad.getBars(r.rec.creds, ticker, timeframe, range) : [];
  }
  subscribe(ticker, timeframe, onBar) {
    const r = route('byo', ticker);
    return r ? liveSub(r, ticker, timeframe, onBar, 'byo') : () => {};
  }
}
