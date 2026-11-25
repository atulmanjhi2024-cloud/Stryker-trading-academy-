// TradeZoro — Charts: calculated US Dollar Index "DXY" (ES module). Provider name "dxy", symbol "dxy:DXY".
// Candles come from our six FX pairs (the "fx" provider: same bars, same history, same polling) through assets/chart-dxy-core.js.
// LIVE: each leg is subscribed through the fx provider; when a leg's candle moves the index candle is rebuilt from the last
// few bars of all six and pushed, at most once per THROTTLE_MS. The pairs are polled (not tick-streamed) so the index
// refreshes at their rate. Education only. Not financial advice.
import { FxProvider } from './chart-futures-provider.js?v=1295';
import { PAIRS, combine, DESCRIPTION } from './chart-dxy-core.js?v=1295';

const TAIL = 4, THROTTLE_MS = 1000, TICK = 0.001;
const tickerOk = (t) => /^(DXY|USDX|DX1?!?)$/i.test(String(t || '').replace(/^[A-Za-z_]+:/, '').trim());

export class DxyProvider {
  constructor() { this.fx = new FxProvider(); }
  info() { return { name: 'dxy', displayName: 'Dollar index', requiresApiKey: false, supportedTimeframes: ['1', '5', '15', '30', '60', '120', '240', 'D', 'W', 'M'], capabilities: { enumerate: true, stream: true, symbolInfo: true } }; }
  async listSymbols() { return [{ ticker: 'DXY', description: DESCRIPTION, type: 'index', prefix: 'DXY', market: 'forex', exchange: 'CALC', mintick: TICK, pointvalue: 1, aliases: ['USDX', 'DX', 'DOLLAR INDEX'] }]; }
  async getSymbolInfo(ticker) {
    if (!tickerOk(ticker)) return undefined;
    return { ticker: 'DXY', tickerid: 'DXY:DXY', prefix: 'DXY', description: DESCRIPTION, type: 'index', market: 'forex', currency: 'USD', mintick: TICK, pricescale: 1000, minmove: 1, pointvalue: 1, timezone: 'America/New_York', session: '1700-1700', session_extended: '1700-1700' };
  }
  getCalendar(ticker, range) { return tickerOk(ticker) ? this.fx.getCalendar('EURUSD', range) : Promise.resolve([]); }
  resolveSymbolIcon() { return undefined; }

  async getBars(ticker, tf, range = {}) {
    if (!tickerOk(ticker)) return [];
    const r = Object.assign({}, range);
    if (r.limit != null) r.limit += TAIL;   // a pair missing one bar costs that bar: ask a little more
    const got = await Promise.all(PAIRS.map((p) => this.fx.getBars(p, tf, r)));
    const series = {}; PAIRS.forEach((p, i) => { series[p] = got[i] || []; });
    let bars = combine(series);
    if (range.limit != null && bars.length > range.limit) bars = bars.slice(-range.limit);
    return bars;
  }

  subscribe(ticker, tf, onBar) {
    if (!tickerOk(ticker)) return () => {};
    let dead = false, timer = 0, last = 0, dirty = false;
    const tail = {};
    const seed = Promise.all(PAIRS.map((p) => this.fx.getBars(p, tf, { limit: TAIL, fresh: true }).then((b) => { tail[p] = b.slice(-TAIL); }).catch(() => { tail[p] = []; })));
    const emit = () => {
      timer = 0; if (dead || !dirty) return; dirty = false; last = Date.now();
      const bars = combine(tail).slice(-2);
      for (const b of bars) { try { onBar(b); } catch (e) {} }
    };
    const kick = () => {
      dirty = true;
      if (timer) return;
      const wait = Math.max(0, THROTTLE_MS - (Date.now() - last));
      timer = setTimeout(emit, wait);
    };
    const offs = PAIRS.map((p) => this.fx.subscribe(p, tf, (b) => seed.then(() => {
      if (dead) return;
      const a = tail[p] || (tail[p] = []);
      const i = a.findIndex((x) => x.time === b.time);
      if (i >= 0) a[i] = b; else { a.push(b); a.sort((x, y) => x.time - y.time); if (a.length > TAIL) a.shift(); }
      kick();
    })));
    return () => { dead = true; if (timer) clearTimeout(timer); offs.forEach((f) => { try { f && f(); } catch (e) {} }); };
  }
}
