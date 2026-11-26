// TradeZoro — Charts: Indian markets, NSE / BSE (ES module). Provider name "india", symbols "india:NIFTY", "india:RELIANCE", "india:NIFTY1!".
// History + the forming candle come from /api/chart/india/:sym (same paging as futures / forex: see PAGE_SECS in chart-futures-provider.js);
// the delay and the holiday-aware session come from /api/chart/india-info/:sym, read at load (nothing is hard-coded here): delay 0 = live,
// > 0 = the "N min delayed" tag. Live: the newest page is re-read every POLL_MS (the server shares one provider call between viewers).
// GATE: INDIA_AUDIENCE in assets/india-core.js (admins + beta testers while 'beta'; the server enforces it too). A member outside the audience
// sees no Indian symbol in search and the provider answers with no bars. Education only. Not financial advice.
import { FuturesProvider } from './chart-futures-provider.js?v=1302';
import { INDIA, entryOf, INDIA_AUDIENCE, audienceOk, calendar, isOpen, nextOpen } from './india-core.js?v=1302';

const POLL_MS = 6000;
const INFO = new Map();      // ticker -> { delay, tick, pv, session } (answers only)
const WAIT = new Map();
globalThis.__tzIndia = INFO;

// who may see Indian markets: ready() answers { beta, admin }; admins count as beta (assets/beta.js, same rule as the server)
let okP = null, okNow = INDIA_AUDIENCE === 'all';
export function indiaAllowed() {
  if (INDIA_AUDIENCE === 'all') return Promise.resolve(true);
  if (INDIA_AUDIENCE !== 'beta') return Promise.resolve(false);
  return okP || (okP = new Promise((resolve) => {
    let n = 0;
    const go = () => {
      if (window.strykerBeta) window.strykerBeta.ready().then((s) => { okNow = audienceOk(INDIA_AUDIENCE, !!(s && (s.beta || s.admin))); globalThis.__tzIndiaOk = okNow; try { window.dispatchEvent(new CustomEvent('stryker:india')); } catch (e) {} resolve(okNow); }, () => resolve(false));
      else if (n++ > 60) resolve(false); else setTimeout(go, 250);
    };
    go();
  }));
}
globalThis.__tzIndiaOk = okNow;
if (INDIA_AUDIENCE === 'beta') indiaAllowed();

async function authHeaders() {
  try { const u = window.firebase && firebase.auth && firebase.auth().currentUser; if (u) return { authorization: 'Bearer ' + (await u.getIdToken()) }; } catch (e) {}
  return {};
}
export function loadInfo(e) {
  if (INFO.has(e.ticker)) return Promise.resolve(INFO.get(e.ticker));
  if (!WAIT.has(e.ticker)) {
    WAIT.set(e.ticker, authHeaders().then((h) => fetch('/api/chart/india-info/' + encodeURIComponent(e.ticker), { headers: h })).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (j && j.delay != null) { INFO.set(e.ticker, j); try { window.dispatchEvent(new CustomEvent('stryker:india')); } catch (x) {} return j; }
      WAIT.delete(e.ticker); return null;   // not answered: asked again next time, never guessed
    }).catch(() => { WAIT.delete(e.ticker); return null; }));
  }
  return WAIT.get(e.ticker);
}
const sessionOf = (e) => { const i = INFO.get(e.ticker); return i && i.session || null; };

// the status the chart's data dot shows (assets/chart-data-dot.js): live, N min delayed, closed, or checking
export function indiaStatus(sym, now = Date.now()) {
  const e = entryOf(String(sym || '').replace(/^india:/i, 'india:'));
  if (!e) return null;
  const i = INFO.get(e.ticker);
  if (!i) { loadInfo(e); return { s: 'wait', text: 'Checking market data', tag: 'Checking' }; }
  if (!isOpen(now, i.session)) {
    const n = nextOpen(now, i.session);
    return { s: 'closed', text: 'Market closed' + (n ? ' · opens ' + istLabel(n) + ' IST' : ''), tag: 'Closed' };
  }
  const min = Math.round(i.delay / 60);
  if (i.delay > 0) return { s: 'delayed', text: 'Exchange data ' + min + ' min delayed', tag: min + ' min delayed' };
  return { s: 'rt', text: 'Live data', tag: 'Live' };
}
let fmt = null;
function istLabel(ms) {
  fmt = fmt || [new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }), new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })];
  const p = {}; fmt[0].formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
  return (fmt[1].format(new Date(ms)) === fmt[1].format(new Date()) ? 'today' : p.weekday) + ' ' + p.hour + ':' + p.minute;
}

export class IndiaProvider extends FuturesProvider {
  constructor(opts = {}) { super(Object.assign({}, opts, { base: '/api/chart/india/' })); }
  info() { return { name: 'india', displayName: 'Indian markets', requiresApiKey: false, supportedTimeframes: ['1', '5', '15', '30', '60', '120', '240', 'D', 'W', 'M'], capabilities: { enumerate: true, stream: false, symbolInfo: true } }; }
  keyOf(ticker) { const e = entryOf(String(ticker || ''), true) || entryOf('india:' + String(ticker || ''), true); return e && okNow ? e.ticker : null; }
  async listSymbols() {
    await indiaAllowed();
    if (!okNow) return [];
    return INDIA.map((e) => ({ ticker: e.ticker, description: e.description, type: e.type, prefix: 'india', market: e.type === 'stock' ? 'equity' : 'index', exchange: e.exchange, mintick: e.tick, pointvalue: e.pv, aliases: [e.name].concat(e.aliases), currency: 'INR' }));
  }
  async getSymbolInfo(ticker) {
    await indiaAllowed();
    const e = okNow && (entryOf(String(ticker || ''), true) || entryOf('india:' + String(ticker || ''), true));
    if (!e) return undefined;
    const i = await loadInfo(e), tick = (i && i.tick) || e.tick, dec = tick < 1 ? Math.min(4, String(tick).split('.')[1].length) : 0;
    return { ticker: e.ticker, tickerid: 'india:' + e.ticker, prefix: 'india', description: e.description, type: e.type, market: e.type === 'stock' ? 'equity' : 'index', exchange: e.exchange, currency: 'INR', mintick: tick, pricescale: Math.pow(10, dec), minmove: 1, pointvalue: (i && i.pv) || e.pv, timezone: 'Asia/Kolkata', session: '0915-1530', session_extended: '0915-1530' };
  }
  async getCalendar(ticker, range) {
    const e = entryOf(String(ticker || ''), true) || entryOf('india:' + String(ticker || ''), true);
    if (!e || !okNow) return [];
    await loadInfo(e);
    return calendar(range.from, range.to, sessionOf(e));
  }
  async getBars(ticker, timeframe, range = {}) {
    await indiaAllowed();
    const e = okNow && (entryOf(String(ticker || ''), true) || entryOf('india:' + String(ticker || ''), true));
    if (e) loadInfo(e);
    return super.getBars(ticker, timeframe, range);
  }
  subscribe(ticker, timeframe, onBar) { return this.keyOf(ticker) ? this.pollSubscribe(ticker, timeframe, onBar, POLL_MS) : () => {}; }
}
