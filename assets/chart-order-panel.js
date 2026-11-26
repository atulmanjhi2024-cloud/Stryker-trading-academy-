// TradeZoro — ZoroCharts ORDER PANEL (ES module, charts.html). Owner order 2026-11-16: "create better order panel".
// Lazy-loaded by assets/chart-paper.js (Trade button in the chart's top bar, openOrder(), the live module's openTicket).
//
// ONE floating panel for PAPER (every member) and LIVE broker orders (every signed-in member since 21 Nov, assets/chart-live.js). It replaces the old bottom
// "Live trading" strip; while a live account is picked only a small status chip stays on the chart (click = open the panel).
//   Header (Owner order 2026-11-17): row 1 = tabs Scalp | DOM | Order (segmented) left, window buttons right (Dock right, Float,
//           expand, minimise, close). Row 2 = symbol details bar: root + full name ("MNQ · Micro Nasdaq-100 E-mini", never cut),
//           the contract (MNQZ6), last price + change vs the previous daily close, best bid / ask.
//           FLOAT: drag by the header, resize from the bottom-right corner. DOCK RIGHT: a full-height side panel at the chart's right
//           edge (left of the icon rail and any open rail panel); the chart gives up that width (#vela-chart margin-right), width
//           dragged on the left edge (280-480). Mode, position, size, dock width, tab, open/minimised and the B/S hotkey switch are
//           remembered per user (localStorage 'stryker_op_<uid>').
//   Scalp:  Buy (market) · quantity stepper · Sell (market); Join Bid = buy LIMIT at the best bid, Join Ask = sell LIMIT at the best
//           ask. Bid/ask: futures from the live L2 book (chart-futures-l2.js; never the 10-min delayed book), crypto from the exchange's
//           public book (book-panel-sources.js). No live book = the Join buttons stay disabled with the reason.
//   Order:  Buy / Sell cards (live BID / ASK), Market | Limit | Stop, price (market = the live price; limit / stop editable, rounded to
//           the tick), quantity, Stop loss (price <-> ticks, Trail, presets 10/25/50/100 ticks), Take profit (price <-> ticks, presets),
//           Confirm in the side's colour + Cancel. Paper: SL/TP ride on the order as a bracket (paper-engine.js). LIVE: the chart's
//           live order route takes market + limit only (functions/connect/finatic/order.js: no stop, no bracket), so Stop, SL, TP and
//           Trail are shown disabled with that reason. Nothing is ever sent as a bracket the server would not check.
//   DOM:    the existing Book panel ladder (assets/chart-book-panel.js api.embed): bid cell = buy limit, ask cell = sell limit (live: always
//           a limit, through the live confirm), the same code path as the side panel.
//   Footer: the account picked in the Trade menu as a read-only label ("Paper · DEMO"; admins live: "LIVE · Tradovate …2029" in red)
//           + "Change" (opens the Trade menu; no account picker in the panel), position + open P&L, working orders, Flatten, and
//           (live, admins only) "Turn off live trading" (the global kill switch). Broker names as plain text are allowed since 21 Nov.
//   Phone (<= 700 px): a bottom sheet with Scalp + Order only.
// SAFETY: every live order goes through chart-live.js place(): admin-only module, sent on the click like paper (no confirm, 19 Nov),
// no TradeZoro limits on symbol, size, exposure or orders a minute (Owner 21 Nov: the broker decides), a 500 ms double-click guard,
// fresh-read gate, kill switch, back to Paper after 15 min idle, every attempt audited on the server. This file never calls the order endpoint itself.
// Hotkeys: B = Buy, S = Sell (market, Scalp quantity) — OFF by default, only while the panel is open and not typing in a field.
// TRADE INSTRUMENT (2026-11-18, roadmap card trade-instrument): the header's mini / micro switch (NQ | MNQ, ES | MES, YM | MYM,
//           RTY | M2K, GC | MGC, CL | MCL, SI | SIL) picks what the panel trades; it starts on the chart symbol and is kept per chart
//           root (chart-paper.js tradeSym). Orders, the footer position / P&L and the DOM tab all use it; the chart never changes.
// TWO TARGETS (Order tab): Stop loss, TP1 (close N contracts or N %), Take profit = TP2 (the rest), "Stop to break-even after TP1"
//           (+ offset ticks), "Size from risk" ($ or % of the balance + the stop distance -> contracts, rounded down, min 1, capped at
//           the max size). Paper: everything (paper-engine.js). LIVE: one stop loss + one take profit per contract is what the server's
//           guarded route keeps (functions/connect/finatic/order.js), so TP1 and break-even are hidden there with a plain note;
//           risk sizing still works (no TradeZoro size cap live; the broker applies its own).
// ADVANCED (member feature 2026-11-20, thread 1572249985058082896): the Order tab keeps the SIMPLE ticket by default (side, type,
//           price, quantity, stop loss, take profit). The "Advanced" switch (prefs.adv, per user, off by default) shows TP1 + break-even,
//           size from risk, and "Panel layout": where the panel sits (Float | Left | Right | Bottom of the chart; docked modes give the
//           chart that space, like Dock right) and which account numbers the footer shows (Balance, Equity, Today's P&L, Open P&L;
//           prefs.ai, none by default). Advanced off = the panel is exactly the simple one again (TP1 / risk are not sent).
// SPREAD (Owner 25 Nov 2026, "show spread on trading panel"): on a broker CFD / forex chart whose feed streams bid AND ask (cTrader spots,
//           OANDA pricing: byo-core.js QUOTES), MetaTrader style: Sell shows the bid, Buy shows the ask, and the details bar shows
//           "Spread 1.2" (pips / points from the symbol's pipPosition, else the pip of the pair, else the tick), amber
//           "Spread is wider than usual" when it is > 3x its 5-min median. DISPLAY ONLY: quote() above (Join Bid / Ask, order prices)
//           is not fed from it, so what an order sends is unchanged.
// Tests: tools/tests/chart-live-browser.js (live + member paper, mocked endpoints only), tools/tests/chart-paper-trading-browser.js.
// Education only. Not financial advice.
import * as L from './chart-live-core.js?v=1304';
import { acquire, rootState, l2Root, l2Delayed } from './chart-futures-l2.js?v=1304';
import { openSource, SOURCES } from './book-panel-sources.js?v=1304';
import { pairOf } from './book-panel-core.js?v=1304';
import { futRoot } from './chart-sym.js?v=1304';   // one futures test for every symbol form (CME_MINI:MNQ1!, MNQZ6 ...)

const PHONE_MAX = 700, W_MIN = 352, W_MAX = 640, DW_MIN = 280, DW_MAX = 480, DW_DEF = 340, DH_MIN = 220, DH_MAX = 560, DH_DEF = 300, H_MIN = 300, W_DEF = 360, H_DEF = 640, QUOTE_MAX_AGE = 15000, SW_MIN = 320, SW_MAX = 520, SW_DEF = 380;
const DISCLAIMER = 'Education only. Not financial advice.';
const EXCH = { YM: 'CBOT', MYM: 'CBOT', ZB: 'CBOT', ZN: 'CBOT', ZF: 'CBOT', ZT: 'CBOT', ZC: 'CBOT', ZS: 'CBOT', ZW: 'CBOT', CL: 'NYMEX', MCL: 'NYMEX', NG: 'NYMEX', GC: 'COMEX', MGC: 'COMEX', SI: 'COMEX', HG: 'COMEX' };
const isLocal = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
const TEST = () => (isLocal ? window.__stkOpTest || null : null);   // localhost test hooks only
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isPhone = () => window.innerWidth <= PHONE_MAX;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[, ]/g, '')); return Number.isFinite(n) ? n : NaN; };
const svg = (d) => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
const ICON = {
  max: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  restore: svg('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'),
  min: svg('<path d="M5 12h14"/>'),
  open: svg('<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 9h16"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  dock: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>'),
  float: svg('<rect x="3" y="4" width="18" height="16" rx="2" stroke-dasharray="3 2.4"/><rect x="9" y="9" width="9" height="7" rx="1.5"/>'),
  chev: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  info: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg>'
};
export const TRADE_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>';
const money = (n, sign) => { if (n == null || !Number.isFinite(n)) return '—'; const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return (n < 0 ? '−' : sign && n > 0 ? '+' : '') + '$' + s; };
const decOf = (tick) => { const s = String(tick); const i = s.indexOf('.'); return i < 0 ? 0 : Math.min(8, s.length - i - 1); };
const roundTick = (p, t) => Math.round(p / t) * t;

let scEl = null, scLatch = false, scSig = '';
let P = null, el = null, bodyEl = null, footEl = null, infoEl = null, chipEl = null, meta = { sym: '', desc: '', prev: null }, dockRO = null, prefs = null, prefKey = '', viewSig = '', footSig = '', open = false, lastQty = '';
const F = { side: 'buy', type: 'market', qty: '1', price: '', priceKey: '', trail: false,
  sl: { on: false, price: '', ticks: '20', pct: '', src: 'ticks' }, tp: { on: false, price: '', ticks: '40', pct: '', src: 'ticks' },
  tp1: { on: false, price: '', ticks: '20', src: 'ticks', size: '1', unit: 'qty' }, be: { on: false, ticks: '0' },
  risk: { on: false, mode: 'usd', v: '' } };
const MODES = ['float', 'left', 'dock', 'bottom'], MODE_NAME = { float: 'Float', left: 'Left', dock: 'Right', bottom: 'Bottom' };
const AI = [['bal', 'Balance'], ['eq', 'Equity'], ['day', 'Today’s P&L'], ['up', 'Open P&L']];
const STOPLIMIT_NO = 'Stop limit orders aren’t available from the chart yet.';
const LIVE_TWO = 'TP1 and break-even are paper only for now. Live orders carry one stop loss and one take profit.';

// ------------------------------------------------------------------------------------------------ prefs (per user)
function loadPrefs() {
  const uid = (P && P.uid) || 'guest'; prefKey = 'stryker_op_' + uid;
  let p = {}; try { p = JSON.parse(localStorage.getItem(prefKey)) || {}; } catch (e) {}
  prefs = { x: Number.isFinite(p.x) ? p.x : null, y: Number.isFinite(p.y) ? p.y : null, w: clamp(+p.w || W_DEF, W_MIN, W_MAX), h: +p.h > 0 ? Math.max(H_MIN, +p.h) : null,   // null = the chart's height (a full-height ticket on the right, Owner 25 Nov)

    tab: p.v === 2 && ['scalp', 'dom', 'order'].includes(p.tab) ? p.tab : 'order', v: 2,
    sx: Number.isFinite(p.sx) ? p.sx : null, sy: Number.isFinite(p.sy) ? p.sy : null, sw: clamp(+p.sw || SW_DEF, SW_MIN, SW_MAX), lu: ['price', 'dist', 'pct'].includes(p.lu) ? p.lu : 'dist', min: !!p.min, max: !!p.max, hk: p.hk === true, open: !!p.open,
    mode: MODES.includes(p.mode) ? p.mode : 'float', dw: clamp(+p.dw || DW_DEF, DW_MIN, DW_MAX), dh: clamp(+p.dh || DH_DEF, DH_MIN, DH_MAX),
    adv: p.adv === true, sc: p.sc === true, scMin: p.scMin === true, ai: Array.isArray(p.ai) ? AI.map((a) => a[0]).filter((k) => p.ai.includes(k)) : [] };
}
function savePrefs() { try { localStorage.setItem(prefKey, JSON.stringify(prefs)); } catch (e) {} }

// ------------------------------------------------------------------------------------------------ what is on the chart
function ctx() {
  const chartSym = P.activeSymbol() || '';
  const lv = P.live || null;
  const PE0 = window.PaperEngine;
  // the TRADE instrument (chart symbol or its mini / micro partner). Live: pairs whose contract specs are known (chart-live-core ROOTS).
  let fam = PE0 && PE0.familyOf ? PE0.familyOf(chartSym) : null;
  if (lv && fam && !(L.ROOTS[fam.mini] && L.ROOTS[fam.micro])) fam = null;
  if (lv && lv.mtFor && lv.mtFor(chartSym)) fam = null;   // MetaTrader account: the broker symbol picker replaces the mini / micro switch
  const sym = (fam && P.tradeSym ? P.tradeSym(chartSym) : chartSym) || '';
  const a = P.account;
  const PE = window.PaperEngine;
  const sp = a ? a.spec(sym) : PE ? PE.specOf(sym) : { ok: false, reason: 'Loading…' };
  const m = /^([^:]+):(.+)$/.exec(sym); const prov = m ? m[1].toLowerCase() : '', tk = (m ? m[2] : sym).toUpperCase();
  const croot = L.chartRoot(sym);
  const li = lv ? lv.opInfo(sym) : null;
  const fm = croot ? L.frontMonth(croot, Date.now()) : null;
  const fut = sp.ok ? sp.kind === 'futures' : /1!$/.test(tk);
  const rootName = fut ? String(sp.ok ? sp.root : tk).replace(/[12]!$/, '') : '';
  const label = fut ? (EXCH[rootName] || 'CME') + ':' + rootName : sym ? tk : '—';
  const exName = !fut && prov ? ((SOURCES.find((s) => s.id === prov) || {}).name || prov.toUpperCase()) : '';
  const code = li && li.code ? li.code : fm ? fm.code : exName;
  const tick = lv ? (li ? li.tick : lv.tickOf(sym)) : sp.ok ? sp.tick : 0.01;
  const last = lv ? (li && li.mt ? li.chartLast : li && Number.isFinite(li.last) ? li.last : P.lastPrice(sym)) : (a && Number.isFinite(a.last[sp.symbol]) ? a.last[sp.symbol] : P.lastPrice(sym));
  const chartRootName = fam ? String((PE.specOf(chartSym) || {}).root || '') : '';
  const mt = li && li.mt ? li.mt : '';
  return { sym, chartSym, fam, chartRootName, lv, li, a, sp, prov, tk, fut, rootName, label, code, mt, tick: tick || 0.01, dec: mt && !(li && li.map && li.map.same) ? Math.min(decOf(tick || 0.01), 2) : decOf(tick || 0.01),   /* AUTO-TPSL: on the broker's own chart (cTrader EURUSD) the symbol's digits */ last: Number.isFinite(last) && last > 0 ? last : null, live: !!lv };
}
const fmt = (c, p) => (p == null || !Number.isFinite(p) ? '—' : p.toLocaleString('en-US', { minimumFractionDigits: c.dec, maximumFractionDigits: c.dec }));
const fmtIn = (c, p) => (Number.isFinite(p) ? p.toFixed(c.dec) : '');

// ------------------------------------------------------------------------------------------------ best bid / ask
let qs = null;   // { key, kind:'f'|'c', root, h|stop, book }
function quoteKey(c) {
  if ((!open && !scVis()) || isTestQuote()) return '';
  if (c.fut) { const r = l2Root(futRoot(c.sym) || c.tk); return r ? 'f|' + r : ''; }
  if (c.sp.ok && c.sp.kind === 'crypto') return 'c|' + c.prov + '|' + c.tk;
  return '';
}
const isTestQuote = () => { const t = TEST(); return !!(t && t.quote); };
function stopQuote() { if (!qs) return; try { qs.h ? qs.h.release() : qs.stop && qs.stop(); } catch (e) {} qs = null; }
function wantQuote(c) {
  const key = quoteKey(c);
  if ((qs ? qs.key : '') === key) return;
  stopQuote(); if (!key) return;
  if (key[0] === 'f') { const root = key.slice(2); qs = { key, kind: 'f', root, h: acquire(root, () => {}, 10) }; return; }
  const id = SOURCES.some((s) => s.id === c.prov) ? c.prov : 'binance', q = qs = { key, kind: 'c', book: null, at: 0 };
  q.stop = openSource(id, pairOf(c.tk), { book: (b) => { q.book = b; q.at = Date.now(); }, trades: () => {}, status: () => {} });
}
function bestOf(bids, asks) {
  let bb = 0, ba = Infinity;
  if (bids instanceof Map) { bids.forEach((v, p) => { if (v > 0 && p > bb) bb = p; }); asks.forEach((v, p) => { if (v > 0 && p < ba) ba = p; }); }
  else { for (const x of bids || []) if (x[1] > 0 && x[0] > bb) bb = x[0]; for (const x of asks || []) if (x[1] > 0 && x[0] < ba) ba = x[0]; }
  return bb > 0 && ba < Infinity && ba > bb ? { bid: bb, ask: ba } : null;
}
function quote(c) {
  const t = TEST(); if (t && t.quote) { const r = t.quote(c.sym); return r && r.bid > 0 && r.ask > 0 ? { bid: r.bid, ask: r.ask, note: '' } : null; }
  if (!qs) return null;
  if (qs.kind === 'f') {
    const r = rootState(qs.root), s = r.snap;
    if (r.status !== 'live' || !s || s.delayed || l2Delayed() || !r.lastFrame || Date.now() - r.lastFrame > QUOTE_MAX_AGE) return null;
    const b = bestOf(s.bids, s.asks); if (!b) return null;
    return { bid: b.bid, ask: b.ask, note: qs.root !== c.rootName ? 'Bid / ask from the ' + qs.root + ' book' : '' };
  }
  if (!qs.book || Date.now() - qs.at > QUOTE_MAX_AGE) return null;
  const b = bestOf(qs.book.bids, qs.book.asks); return b ? { bid: b.bid, ask: b.ask, note: '' } : null;
}
// broker bid / ask for display (see SPREAD above); null on charts without a two-sided feed
const brokerQuote = (c) => { const Q = window.__stkQuotes; return Q && c.sym ? Q.get(c.sym, c.tick) : null; };
const spreadText = (q) => String(Math.round(q.spread * 10) / 10);
const noQuoteWhy = (c) => (c.fut && l2Delayed() ? 'Join Bid / Join Ask need the live order book (yours is 10 min delayed).' : 'Waiting for the live bid and ask…');

// ------------------------------------------------------------------------------------------------ quantities, brackets
function qtyRules(c) {
  if (c.mt && c.li.lots) return { min: c.li.lots.min, max: c.li.lots.max, step: c.li.lots.step, int: false, lots: c.li.lots };   // MetaTrader lots
  if (c.live) return { min: 1, max: Infinity, step: 1, int: true };   // whole numbers from 1; no TradeZoro cap (the broker applies its own)
  if (!c.sp.ok) return { min: 1, max: 1, step: 1, int: true };
  if (c.sp.kind === 'futures') return { min: 1, max: c.sp.maxQty || 500, step: 1, int: true };
  if (c.sp.qtyStep >= 0.01) return { min: c.sp.minQty, max: c.sp.maxQty, step: c.sp.qtyStep, int: c.sp.qtyStep === 1 };   // shares / contracts 1, lots 0.01
  return { min: c.sp.minQty || 0.0001, max: c.sp.maxQty || 1e6, step: 0, int: false };
}
function cleanQty(c, v) {
  const r = qtyRules(c); let q = num(v); if (!(q > 0)) q = r.min;
  if (r.lots) return L.roundLots(Math.min(q, r.max), r.lots) || r.min;
  if (r.int) q = Math.round(q);
  else if (r.step) q = Number((Math.round(q / r.step) * r.step).toFixed(6));
  return clamp(q, r.min, r.max);
}
function stepQty(c, dir) {
  const r = qtyRules(c), q = cleanQty(c, F.qty);
  if (r.lots) return L.roundLots(clamp(q + dir * r.step + 1e-9, r.min, r.max), r.lots) || r.min;
  if (r.step) return clamp(Number((q + dir * r.step).toFixed(6)), r.min, r.max);
  const st = Math.pow(10, Math.floor(Math.log10(Math.max(q, r.min))));
  return clamp(Math.round((q + dir * st) * 1e8) / 1e8, r.min, r.max);
}
// entry reference: market = the touch you would trade into (ask for a buy, bid for a sell) or the last price; limit / stop = the price field
function entryRef(c, qt) {
  if (F.type === 'market') return qt ? (F.side === 'buy' ? qt.ask : qt.bid) : c.last;
  const p = num(F.price); return p > 0 ? roundTick(p, c.tick) : null;
}
// keep each leg's price and ticks in step with the entry (the side the member typed in last is the source)
function legSync(c, ref, k) {
  const g = F[k], dir = (F.side === 'buy' ? 1 : -1) * (k === 'tp' || k === 'tp1' ? 1 : -1);
  if (!(ref > 0)) return null;
  if (g.src === 'price') { const p = num(g.price); if (!(p > 0)) return null; const t = Math.round(Math.abs(p - ref) / c.tick); g.ticks = String(t); g.pct = pctOf(ref, p); return roundTick(p, c.tick); }
  if (g.src === 'pct') { const v = Math.abs(num(g.pct)); if (!(v > 0)) return null; const p = roundTick(ref * (1 + dir * v / 100), c.tick); g.price = fmtIn(c, p); g.ticks = String(Math.round(Math.abs(p - ref) / c.tick)); return p; }
  const t = Math.abs(Math.round(num(g.ticks))); if (!(t > 0)) return null;
  const p = roundTick(ref + dir * t * c.tick, c.tick); g.price = fmtIn(c, p); g.pct = pctOf(ref, p); return p;
}
const pctOf = (ref, p) => String(Math.round(Math.abs(p - ref) / ref * 10000) / 100);
function caps(c) {
  if (!c.live) return { stop: true, stoplimit: false, slWhy: STOPLIMIT_NO, bracket: true, trail: F.type === 'market', two: !!prefs.adv, why: '' };
  const k = c.lv.caps();
  // live stop loss / take profit: market entries only (the server places them after the fill); never TP1 / break-even (one group)
  const mo = !!k.bracket && F.type !== 'market';
  return { stop: !!k.stop, stoplimit: false, slWhy: STOPLIMIT_NO, limit: k.limit !== false, mt: !!k.mt, bracket: !!k.bracket && !mo, trail: false, two: false, why: mo ? k.marketOnly : k.why, adv: !!prefs.adv };
}
// risk-based size -> { qty, risk, over, capped, amt } | { error } | null (off / not applicable)
function riskSize(c, k, ref, sl) {
  if (!prefs.adv || !F.risk.on || !k.bracket) return null;   // size from risk is an Advanced option
  if (!F.sl.on || !(sl > 0)) return { error: 'Turn on the stop loss: the size comes from its distance.' };
  const v = num(F.risk.v); if (!(v > 0)) return { error: F.risk.mode === 'pct' ? 'Enter the % of the balance to risk.' : 'Enter the $ amount to risk.' };
  let bal = null;
  if (F.risk.mode === 'pct') {
    if (c.live) { const L2 = window.__stkLive, a = L2 && L2.state && L2.state.acct, b = a && L2.balance ? L2.balance(a.id) : null; bal = b && b.state === 'ok' ? b.amount : null; }
    else bal = c.a ? c.a.state.balance : null;
    if (!(bal > 0)) return { error: 'The balance isn’t known yet. Use a $ amount.' };
    if (v > 100) return { error: 'Risk % is 100 or less.' };
  }
  const amt = F.risk.mode === 'pct' ? bal * v / 100 : v;
  const r = qtyRules(c);
  const spec = c.live ? { ok: true, kind: c.li && c.li.asset === 'equity' ? 'equity' : 'futures', pointValue: c.li ? c.li.pv : 0, qtyStep: 1, minQty: 1, maxQty: r.max } : c.sp;
  if (!(spec.pointValue > 0)) return { error: 'No contract value for this symbol.' };
  const s0 = window.PaperEngine.sizeForRisk(spec, amt, ref, sl, r.max);
  return s0.error ? s0 : Object.assign(s0, { amt });
}

// ------------------------------------------------------------------------------------------------ actions
const noLive = (c) => (c.lv && c.lv.noLiveWhy ? c.lv.noLiveWhy(c.sym) : 'This chart can’t trade live.');
function blockOf(c) {
  if (c.live) return !c.li ? noLive(c) : c.li.block || '';
  if (!P.enabled) return 'Paper trading is off.';
  if (!c.a) return 'Paper trading is still loading.';
  if (!c.sp.ok) return c.sp.reason;
  if (!c.last) return 'Waiting for a price for ' + c.label + '…';
  if (!(c.sp.pointValue > 0)) return c.sp.wait || 'Waiting for the price currency rate.';
  return '';
}
function send(c, o, src) {
  const qty = cleanQty(c, F.qty);
  if (c.live) {
    return c.lv.placeTicket(c.sym, { side: o.side, type: o.type, qty, price: o.price, marketable: o.marketable, sl: o.sl, tp: o.tp }, src);
  }
  const r = P.placeOrder(Object.assign({ symbol: c.sym, qty }, o));
  if (r && o.trail && o.type === 'market' && o.sl != null) P.setTrailing(c.sym);
  update(); return r;
}
function scalp(side) {
  const c = ctx(), why = blockOf(c); if (why) { P.toast(why, 'error'); return; }
  send(c, { side, type: 'market' }, 'Scalp');
}
function join(side) {
  const c = ctx(), why = blockOf(c); if (why) { P.toast(why, 'error'); return; }
  const qt = quote(c) || brokerQuote(c); if (!qt) { P.toast(noQuoteWhy(c), 'info'); return; }   // book touch, else the broker's own bid / ask
  send(c, { side, type: 'limit', price: side === 'buy' ? qt.bid : qt.ask }, side === 'buy' ? 'Join Bid' : 'Join Ask');
}
function confirmOrder() {
  const c = ctx(), why = blockOf(c); if (why) { P.toast(why, 'error'); return; }
  const k = caps(c), qt = quote(c);
  if ((F.type === 'stop' && !k.stop) || (F.type === 'limit' && k.limit === false)) { P.toast(k.why, 'error'); return; }
  if (F.type === 'stoplimit') { P.toast(STOPLIMIT_NO, 'error'); return; }
  let price;
  if (F.type !== 'market') { price = roundTick(num(F.price), c.tick); if (!(price > 0)) { P.toast('Enter the ' + F.type + ' price.', 'error'); return; } F.price = fmtIn(c, price); }
  const ref = entryRef(c, qt);
  const o = { side: F.side, type: F.type, price };
  if (k.bracket) {
    const legs = ['sl', 'tp'].concat(k.two && F.tp1.on ? ['tp1'] : []), nm = { sl: 'stop loss', tp: 'take profit', tp1: 'TP1' };
    for (const leg of legs) if (F[leg].on) { const p = legSync(c, ref, leg); if (!(p > 0)) { P.toast('Enter the ' + nm[leg] + ' price or ticks, or untick it.', 'error'); return; } o[leg] = p; }
    if (o.tp1 != null) {
      const n = num(F.tp1.size); if (!(n > 0)) { P.toast('Enter how much TP1 closes.', 'error'); return; }
      if (F.tp1.unit === 'pct') o.tp1Pct = n; else o.tp1Qty = n;
      if (F.be.on) { const b = Math.round(num(F.be.ticks)); o.be = b >= 0 ? b : 0; }
    }
    if (F.trail && F.sl.on && k.trail) o.trail = true;
    const rs = riskSize(c, k, ref, o.sl);
    if (rs && rs.error) { P.toast(rs.error, 'error'); return; }
    if (rs) F.qty = String(rs.qty);
  }
  if (c.live && F.type === 'limit' && qt) o.marketable = F.side === 'buy' ? price >= qt.ask : price <= qt.bid;
  send(c, o, 'Order');
}
function flatten() {
  const c = ctx();
  if (c.live) { if (!c.li) { P.toast(noLive(c), 'error'); return; } c.lv.flatten(c.sym); return; }
  if (!c.a || !c.sp.ok) return;
  const pos = c.a.position(c.sym), n = c.a.state.orders.filter((o) => o.symbol === c.sp.symbol).length;
  if (!pos && !n) { P.toast('Nothing to flatten on ' + c.label + '.', 'info'); return; }
  P.flattenSym(c.sym); update();
}

// ------------------------------------------------------------------------------------------------ build
function build() {
  el = document.createElement('div');
  el.id = 'stkop'; el.className = 'stkop'; el.hidden = true;
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'false'); el.setAttribute('aria-labelledby', 'stkop-sym');
  el.innerHTML =
    '<div class="stkop-grab" aria-hidden="true"></div>' +
    '<div class="stkop-hd">' +
      '<button type="button" class="stkop-acct" data-a="change" data-k="acct" aria-label="Trading account. Switch it in the Trade menu"></button>' +
      '<div class="stkop-hbtns">' +
        '<button type="button" class="stkop-sctg" data-a="sc" aria-pressed="false" title="Scalp card on the chart">Scalp</button>' +
        '<button type="button" class="stkop-ib" data-a="min"></button><button type="button" class="stkop-ib" data-a="close" aria-label="Close the order panel" title="Close">' + ICON.close + '</button></div>' +
    '</div>' +
    '<div class="stkop-hd2">' +
      '<div class="stkop-tabs" role="tablist" aria-label="Order panel view"><button type="button" role="tab" data-tab="order">Order</button><button type="button" role="tab" data-tab="dom">DOM</button></div>' +
      '<div class="stkop-hbtns">' +
        '<button type="button" class="stkop-ib stkop-mode" data-a="dock" aria-label="Dock the panel to the right of the chart" title="Dock right">' + ICON.dock + '</button>' +
        '<button type="button" class="stkop-ib stkop-mode" data-a="float" aria-label="Float the panel over the chart" title="Float">' + ICON.float + '</button>' +
        '<button type="button" class="stkop-ib" data-a="max"></button></div>' +
    '</div>' +
    '<div class="stkop-info">' +
      '<div class="stkop-il"><p class="stkop-sym" id="stkop-sym"><b data-k="root"></b><span class="stkop-code" data-k="code"></span></p>' +
        '<span class="stkop-inst" role="radiogroup" aria-label="Trade instrument (mini or micro)" data-k="inst" hidden></span><label class="stkop-mtsym" data-k="mtsym" hidden></label></div>' +
      '<p class="stkop-nm" data-k="name"></p>' +
    '</div>' +
    '<div class="stkop-alert" data-k="alert" role="status" hidden><p class="stkop-alt" data-k="alt"></p><button type="button" class="stkop-b" data-a="retry" hidden>Retry</button><button type="button" class="stkop-b" data-a="enable" hidden>Enable live trading</button></div>' +
    '<div class="stkop-body"></div><div class="stkop-ft"></div>' +
    '<i class="stkop-rs" aria-hidden="true" title="Resize"></i><i class="stkop-dl" aria-hidden="true" title="Drag to resize"></i>';
  document.body.appendChild(el);
  bodyEl = el.querySelector('.stkop-body'); footEl = el.querySelector('.stkop-ft'); infoEl = el.querySelector('.stkop-info');
  for (const ev of ['keydown', 'keyup', 'wheel']) el.addEventListener(ev, (e) => { e.stopPropagation(); if (ev === 'keydown' && e.key === 'Escape') { if (isPhone()) close(); else e.target.blur && e.target.blur(); } }, { passive: ev === 'wheel' });
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('click', onClick);
  el.addEventListener('input', onInput);
  el.addEventListener('focusout', onBlur);
  el.addEventListener('submit', (e) => { e.preventDefault(); confirmOrder(); });
  bindDrag(); bindResize(); bindDockResize();
  window.addEventListener('resize', () => { if (open) { layout(); update(); } if (scVis()) { scSig = ''; update(); } }, { passive: true });
  window.addEventListener('keydown', onHotkey, true);
  window.addEventListener('stkbp:unembedded', () => { if (open && prefs.tab === 'dom') { viewSig = ''; update(); } });
}
function onClick(e) {
  const t = e.target.closest('button, [data-pre]'); if (!t || t.disabled) return;
  const c = () => ctx();
  if (t.dataset.tab) { setTab(t.dataset.tab); return; }
  if (t.dataset.chip) { F.qty = t.dataset.chip; F.risk.on = false; update(); return; }
  if (t.dataset.lu) { prefs.lu = t.dataset.lu; savePrefs(); update(); return; }
  if (t.dataset.inst) { const x = c(); if (P.setTradeSym && x.fam) { P.setTradeSym(x.chartSym, 'futures:' + t.dataset.inst + '1!'); F.priceKey = ''; viewSig = ''; update(); } return; }
  if (t.dataset.unit) { F.tp1.unit = t.dataset.unit; update(); return; }
  if (t.dataset.rmode) { F.risk.mode = t.dataset.rmode; update(); return; }
  if (t.dataset.wmode) { setMode(t.dataset.wmode); return; }
  if (t.dataset.ai) { const k = t.dataset.ai, on = !prefs.ai.includes(k); prefs.ai = AI.map((a) => a[0]).filter((x) => (x === k ? on : prefs.ai.includes(x))); savePrefs(); footSig = ''; update(); return; }
  const a = t.dataset.a;
  if (a === 'close') { close(); return; }
  if (a === 'sc') { setScalp(!prefs.sc); return; }
  if (a === 'scx') { openPanel({ tab: 'order' }); return; }
  if (a === 'scmin') { prefs.scMin = !prefs.scMin; savePrefs(); scSig = ''; update(); return; }
  if (a === 'min') { prefs.min = !prefs.min; savePrefs(); viewSig = ''; layout(); update(); return; }
  if (a === 'max') { prefs.max = !prefs.max; prefs.min = false; savePrefs(); viewSig = ''; layout(); update(); return; }
  if (a === 'dock' || a === 'float') { setMode(a); return; }
  if (a === 'change') { if (P.openTradeMenu) P.openTradeMenu(); return; }
  if (a === 'buy' || a === 'sell') { scalp(a); return; }
  if (a === 'jbid') { join('buy'); return; }
  if (a === 'jask') { join('sell'); return; }
  if (a === 'cancel') { close(); return; }
  if (a === 'flat') { flatten(); return; }
  if (a === 'kill') { const x = c(); if (x.lv) x.lv.kill(); return; }
  if (a === 'retry') { const x = c(); if (x.lv && x.lv.retryEnv) x.lv.retryEnv(); return; }
  if (a === 'enable') { const x = c(); if (x.lv && x.lv.enableLive) x.lv.enableLive(); return; }
  if (a === 'killon') { const x = c(); if (x.lv) x.lv.killOn(); return; }
  if (a === 'paperon') { P.setEnabled(true); viewSig = ''; update(); return; }
  if (a === 'dom-here') { viewSig = ''; update(); return; }
  if (t.dataset.q) { F.qty = String(stepQty(c(), +t.dataset.q)); update(); return; }
  if (t.dataset.side) { F.side = t.dataset.side; F.priceKey = ''; update(); return; }
  if (t.dataset.type) { F.type = t.dataset.type; F.priceKey = ''; if (F.type !== 'market') F.trail = false; update(); return; }
  if (t.dataset.pre) { const g = F[t.dataset.leg]; g.on = true; g.ticks = t.dataset.pre; g.src = 'ticks'; update(); }
}
function onInput(e) {
  const f = e.target.dataset && e.target.dataset.f; if (!f) return;
  const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  if (f === 'qty') F.qty = v;
  else if (f === 'price') F.price = v;
  else if (f === 'trail') F.trail = v;
  else if (f === 'hk') { prefs.hk = v; savePrefs(); }
  else if (f === 'mtsym') {
    const c = ctx(); if (!c.mt || !c.li || !c.lv.mtSetSymbol) return;
    let sym = v;
    if (v === '__other') { sym = (window.prompt('Type the symbol exactly as MetaTrader’s Market Watch shows it (for example NDX100, US100.cash, NAS100).', c.li.map.sym || '') || '').trim(); e.target.dataset.sig = ''; e.target.closest('[data-k=mtsym]').dataset.sig = ''; if (!sym) { update(); return; } }
    if (!c.lv.mtSetSymbol(c.li.map.key, sym)) { P.toast('That is not a valid symbol name.', 'error'); el.querySelector('[data-k=mtsym]').dataset.sig = ''; update(); return; }
    F.priceKey = ''; viewSig = ''; P.toast(c.li.map.label + ' trades as ' + sym + ' on this ' + c.mt + ' account.', 'success');
  }
  else if (f === 'adv') { prefs.adv = !!v; savePrefs(); footSig = ''; }
  else if (f === 'tp1.size') F.tp1.size = v;
  else if (f === 'be.on') F.be.on = v;
  else if (f === 'be.ticks') F.be.ticks = v;
  else if (f === 'risk.on') F.risk.on = v;
  else if (f === 'risk.v') F.risk.v = v;
  else { const [leg, k] = f.split('.'); if (!(leg === 'sl' || leg === 'tp' || leg === 'tp1') || !k) return;   // the embedded DOM ladder's own fields
    if (k === 'on') F[leg].on = v; else { F[leg][k] = v; F[leg].src = k; } }
  if (f === 'qty') F.risk.on = F.risk.on && !!prefs.adv;
  update();
}
function onBlur(e) {
  const f = e.target.dataset && e.target.dataset.f; if (!f) return;
  const c = ctx();
  if (f === 'qty') { F.qty = String(cleanQty(c, F.qty)); e.target.value = F.qty; }
  if (f === 'price') { const p = num(F.price); if (p > 0) { F.price = fmtIn(c, roundTick(p, c.tick)); e.target.value = F.price; } }
  if (/\.price$/.test(f)) { const g = F[f.split('.')[0]], p = num(g.price); if (p > 0) { g.price = fmtIn(c, roundTick(p, c.tick)); e.target.value = g.price; } }
  update();
}
function onHotkey(e) {
  if (!(open || scVis()) || !prefs.hk || (open && prefs.min && !scVis()) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  const k = String(e.key || '').toLowerCase(); if (k !== 'b' && k !== 's') return;
  const t = e.target; if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName) || (t.closest && t.closest('[role=dialog]:not(#stkop), .vela-dialog, #stklv-cf')))) return;
  if (document.getElementById('stklv-cf')) return;
  e.preventDefault(); e.stopPropagation();
  scalp(k === 'b' ? 'buy' : 'sell');
}

// ------------------------------------------------------------------------------------------------ drag / resize / layout
function chartRect() { const n = document.querySelector('.stkchart-panel'); const r = n ? n.getBoundingClientRect() : null; return r && r.width > 0 ? r : { left: 0, top: 56, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight - 56 }; }
function bindDrag() { bindDragOn(el.querySelector('.stkop-hd')); bindDragOn(el.querySelector('.stkop-hd2')); bindDragOn(el.querySelector('.stkop-info')); }
function bindDragOn(hd) {
  hd.addEventListener('pointerdown', (e) => {
    if (isPhone() || prefs.max || docked() || e.button !== 0 || e.target.closest('button, select, input, a')) return;
    e.preventDefault(); const r = el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    hd.setPointerCapture(e.pointerId); el.classList.add('dragging');
    const mv = (ev) => { prefs.x = Math.round(ev.clientX - dx); prefs.y = Math.round(ev.clientY - dy); layout(); };
    const up = () => { hd.removeEventListener('pointermove', mv); hd.removeEventListener('pointerup', up); hd.removeEventListener('pointercancel', up); el.classList.remove('dragging'); savePrefs(); };
    hd.addEventListener('pointermove', mv); hd.addEventListener('pointerup', up); hd.addEventListener('pointercancel', up);
  });
}
function bindResize() {
  const g = el.querySelector('.stkop-rs');
  g.addEventListener('pointerdown', (e) => {
    if (isPhone() || prefs.max || docked()) return;
    e.preventDefault(); e.stopPropagation(); const r = el.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
    g.setPointerCapture(e.pointerId); el.classList.add('sizing');
    const mv = (ev) => { prefs.w = clamp(Math.round(r.width + ev.clientX - x0), W_MIN, W_MAX); prefs.h = Math.max(H_MIN, Math.round(r.height + ev.clientY - y0)); layout(); };
    const up = () => { g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); el.classList.remove('sizing'); savePrefs(); update(); };
    g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up);
  });
}
// docked: a full-height side panel; the chart (#vela-chart, absolute left/right) gives up the width through margin-right, so it
// works next to whatever rail panel (Watchlist, News, ...) is open. Desktop / tablet only (phones: the bottom sheet).
const docked = () => !!(prefs && prefs.mode !== 'float' && MODES.includes(prefs.mode) && !isPhone());
// which edge of the chart a docked panel sits on: 'r' (Dock right, the original), 'l' or 'b'
const dockSide = () => (prefs.mode === 'left' ? 'l' : prefs.mode === 'bottom' ? 'b' : 'r');
function hostEl() { return document.querySelector('.stkchart-panel'); }
function applyDock() {
  const h = hostEl(), on = open && docked() && !!h;
  if (h) {
    const was = h.classList.contains('stkop-docked'), w = h.style.getPropertyValue('--stkop-dw'), hh = h.style.getPropertyValue('--stkop-dh'), sd0 = h.dataset.stkopSide || '', sd = on ? dockSide() : '';
    h.classList.toggle('stkop-docked', on); h.style.setProperty('--stkop-dw', prefs.dw + 'px'); h.style.setProperty('--stkop-dh', prefs.dh + 'px');
    if (sd) h.dataset.stkopSide = sd; else delete h.dataset.stkopSide;
    if (was !== on || sd0 !== sd || (on && (w !== prefs.dw + 'px' || hh !== prefs.dh + 'px'))) requestAnimationFrame(() => { try { window.dispatchEvent(new Event('resize')); } catch (e) {} });
  }
  const vc = document.getElementById('vela-chart');
  if (on && vc && typeof ResizeObserver === 'function' && !dockRO) { dockRO = new ResizeObserver(() => { if (open && docked()) place(); }); dockRO.observe(vc); dockRO.observe(h); }
  if (!on && dockRO) { dockRO.disconnect(); dockRO = null; }
  return on;
}
function setMode(m) {
  if (prefs.mode === m) return;
  prefs.mode = m; prefs.min = false; prefs.max = false; savePrefs(); viewSig = ''; layout(); update(); layout();
}
function bindDockResize() {
  const g = el.querySelector('.stkop-dl');
  g.addEventListener('pointerdown', (e) => {
    if (!docked() || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation(); const w0 = prefs.dw, h0 = prefs.dh, x0 = e.clientX, y0 = e.clientY, sd = dockSide();
    g.setPointerCapture(e.pointerId); el.classList.add('sizing');
    const mv = (ev) => {
      if (sd === 'b') { const h = clamp(Math.round(h0 - (ev.clientY - y0)), DH_MIN, DH_MAX); if (h !== prefs.dh) { prefs.dh = h; layout(); } return; }
      const w = clamp(Math.round(w0 + (sd === 'l' ? 1 : -1) * (ev.clientX - x0)), DW_MIN, DW_MAX); if (w !== prefs.dw) { prefs.dw = w; layout(); }
    };
    const up = () => { g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up); el.classList.remove('sizing'); savePrefs(); update(); };
    g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
  });
}
// docked position: in the space the chart gave up (right / left: the chart's full height; bottom: the chart's full width)
function place() {
  const vc = document.getElementById('vela-chart'), r = vc ? vc.getBoundingClientRect() : null;
  if (!r || !(r.height > 0)) return;
  const sd = dockSide();
  const x = Math.round(sd === 'r' ? r.right : sd === 'l' ? r.left - prefs.dw : r.left), y = Math.round(sd === 'b' ? r.bottom : r.top);
  const w = sd === 'b' ? Math.round(r.width) : prefs.dw, h = sd === 'b' ? prefs.dh : Math.round(r.height);
  if (el.style.left !== x + 'px') el.style.left = x + 'px';
  if (el.style.top !== y + 'px') el.style.top = y + 'px';
  el.style.width = w + 'px'; el.style.height = h + 'px';
}
function layout() {
  if (!el) return;
  const ph = isPhone(), tab = shownTab(), dk = docked();
  el.classList.toggle('is-sheet', ph); el.classList.toggle('is-min', !ph && !dk && prefs.min); el.classList.toggle('is-max', !ph && !dk && prefs.max);
  el.classList.toggle('is-dock', dk); el.classList.toggle('is-dock-l', dk && dockSide() === 'l'); el.classList.toggle('is-dock-b', dk && dockSide() === 'b');
  el.dataset.tab = tab;
  document.documentElement.classList.toggle('stkop-sheet', open && ph);
  applyDock();
  if (ph) { for (const k of ['left', 'top', 'width', 'height']) el.style[k] = ''; return; }
  if (dk) { place(); return; }
  const R = chartRect(), vw = innerWidth, vh = innerHeight;
  let w = prefs.w, h = prefs.min ? null : prefs.h || Math.max(H_MIN, Math.min(H_DEF + 160, Math.round(Math.min(R.bottom, vh) - Math.max(R.top, 0) - 40))), x = prefs.x, y = prefs.y;
  if (prefs.max) { w = Math.min(W_MAX, Math.max(W_MIN, Math.round(R.width * 0.4))); h = Math.max(H_MIN, Math.round(Math.min(R.bottom, vh) - Math.max(R.top, 0) - 16)); x = Math.round(R.right - w - 8); y = Math.round(Math.max(R.top, 0) + 8); }
  if (x == null || y == null) { x = Math.round(R.right - w - 72); y = Math.round(Math.max(R.top, 0) + 12); }
  w = Math.min(w, vw - 16);
  if (h != null) h = Math.min(h, vh - 16);
  el.style.width = w + 'px'; el.style.height = h == null ? '' : h + 'px';
  const eh = h == null ? el.offsetHeight || 200 : h;
  x = clamp(x, 8, Math.max(8, vw - w - 8)); y = clamp(y, 8, Math.max(8, vh - Math.min(eh, vh - 16) - 8));
  el.style.left = x + 'px'; el.style.top = y + 'px';
  if (!prefs.max && prefs.x != null) { prefs.x = x; prefs.y = y; }
}
const shownTab = () => (prefs.tab === 'scalp' || (isPhone() && prefs.tab === 'dom') ? 'order' : prefs.tab);
function setTab(t) {
  if (t === 'scalp') { setScalp(true); return; }   // Scalp = the card on the chart (Owner 25 Nov)
  if (t === prefs.tab && !prefs.min) return;
  prefs.tab = t; prefs.min = false; savePrefs(); viewSig = ''; layout(); update(); layout();
}

// ------------------------------------------------------------------------------------------------ views
const pillBtn = (cls, a, text) => '<button type="button" class="stkop-pill ' + cls + '" data-a="' + a + '"><span>' + text + '</span><small data-k="' + a + 'px" hidden></small></button>';
const stepper = (unit) => '<div class="stkop-qty" role="group" aria-label="Quantity"><button type="button" data-q="-1" aria-label="One less">−</button><label><input data-f="qty" type="text" inputmode="decimal" autocomplete="off" aria-label="Quantity"><span class="stkop-unit">' + esc(unit) + '</span></label><button type="button" data-q="1" aria-label="One more">+</button></div>';
// SCALP card body (Owner 25 Nov: a compact card on the chart): Buy · stepper · Sell, then Join Bid / Join Ask (limits at the touch)
function viewScalp(c) {
  return '<div class="stkop-scalp">' +
    '<div class="stkop-trio">' + pillBtn('buy', 'buy', 'Buy') + stepper(c.fut || c.live ? 'lots' : 'qty') + pillBtn('sell', 'sell', 'Sell') + '</div>' +
    '<div class="stkop-joins"><button type="button" class="stkop-join bid" data-a="jbid"><span>Join Bid</span><b data-k="bid">—</b></button><button type="button" class="stkop-join ask" data-a="jask"><span>Join Ask</span><b data-k="ask">—</b></button></div>' +
    '<div class="stkop-srow"><p class="stkop-status" role="status" data-k="status"></p><label class="stkop-hk" title="B = Buy, S = Sell at market with this quantity, while the panel or this card is open"><input type="checkbox" data-f="hk"> B / S keys</label></div>' +
  '</div>';
}
// stop loss / take profit level: one field in the unit picked (Price · Ticks/Pips · %), the money at that level on the right
function leg(k, title, trail) {
  return '<fieldset class="stkop-br" data-leg="' + k + '" hidden><legend class="stkop-vh">' + title + '</legend>' +
    '<label class="stkop-field"><span class="stkop-fl" data-k="' + k + 'lbl">' + title + '</span><input class="stkop-fi" data-f="' + k + '.ticks" data-leg-in="' + k + '" type="text" inputmode="decimal" autocomplete="off" aria-label="' + title + '"><span class="stkop-fu" data-k="' + k + 'unit"></span></label>' +
    '<div class="stkop-lrow"><span class="stkop-proj" data-k="' + k + 'proj"></span>' + (trail ? '<label class="stkop-chk stkop-trail"><input type="checkbox" data-f="trail"> Trail</label>' : '') + '</div>' +
  '</fieldset>';
}
// TP1: close part at the first target (contracts or %), then optionally move the stop to break-even (+ offset ticks)
function legTp1() {
  return '<fieldset class="stkop-br" data-leg="tp1"><legend class="stkop-vh">Take profit 1</legend>' +
    '<div class="stkop-brh"><label class="stkop-chk"><input type="checkbox" data-f="tp1.on"> TP1 · close part</label></div>' +
    '<div class="stkop-pair"><label><input data-f="tp1.price" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" aria-label="TP1 price"><span>Price</span></label><label><input data-f="tp1.ticks" type="text" inputmode="numeric" autocomplete="off" aria-label="TP1 in ticks"><span>Ticks</span></label></div>' +
    '<div class="stkop-t1q"><span class="stkop-lbl">Close</span><label class="stkop-t1n"><input data-f="tp1.size" type="text" inputmode="decimal" autocomplete="off" aria-label="TP1 closes this much"></label>' +
      '<div class="stkop-seg" role="radiogroup" aria-label="TP1 size unit"><button type="button" role="radio" data-unit="qty" data-k="unitq">Lots</button><button type="button" role="radio" data-unit="pct">%</button></div></div>' +
    '<div class="stkop-t1q stkop-be"><label class="stkop-chk"><input type="checkbox" data-f="be.on"> Stop to break-even after TP1</label><label class="stkop-t1n"><input data-f="be.ticks" type="text" inputmode="numeric" autocomplete="off" aria-label="Break-even offset in ticks"><span>+ticks</span></label></div>' +
    '<p class="stkop-t1s" data-k="t1sum"></p>' +
  '</fieldset>';
}
function viewRisk() {
  return '<fieldset class="stkop-br stkop-risk" data-leg="risk"><legend class="stkop-vh">Size from risk</legend>' +
    '<div class="stkop-brh"><label class="stkop-chk"><input type="checkbox" data-f="risk.on"> Size from risk</label>' +
      '<div class="stkop-seg" role="radiogroup" aria-label="Risk unit"><button type="button" role="radio" data-rmode="usd">$</button><button type="button" role="radio" data-rmode="pct">% bal</button></div></div>' +
    '<div class="stkop-t1q"><label class="stkop-t1n stkop-rv"><input data-f="risk.v" type="text" inputmode="decimal" autocomplete="off" aria-label="Amount to risk" placeholder="0"><span data-k="runit">USD</span></label><p class="stkop-t1s" data-k="rsum"></p></div>' +
  '</fieldset>';
}
// Advanced: where the panel sits + which account numbers the footer shows (both kept per user)
function viewLayout() {
  return '<fieldset class="stkop-br stkop-lay" data-leg="lay"><legend class="stkop-vh">Panel layout</legend>' +
    '<div class="stkop-brh"><span class="stkop-chk">Panel layout</span></div>' +
    '<div class="stkop-t1q stkop-wpos"><span class="stkop-lbl">Position</span><div class="stkop-seg" role="radiogroup" aria-label="Panel position">' +
      MODES.map((m) => '<button type="button" role="radio" data-wmode="' + m + '" title="' + (m === 'float' ? 'Float over the chart' : 'Dock to the ' + MODE_NAME[m].toLowerCase() + ' of the chart') + '">' + MODE_NAME[m] + '</button>').join('') + '</div></div>' +
    '<div class="stkop-ais"><span class="stkop-lbl">Show</span><div class="stkop-aib" role="group" aria-label="Account numbers shown in the panel">' +
      AI.map((a) => '<button type="button" data-ai="' + a[0] + '" aria-pressed="false">' + esc(a[1]) + '</button>').join('') + '</div></div>' +
  '</fieldset>';
}
function viewOrder(c) {
  const row = (k, t, hid) => '<div data-r="' + k + '"' + (hid ? ' hidden' : '') + '><dt>' + t + '</dt><dd data-k="' + k + '">—</dd></div>';
  return '<form class="stkop-order" novalidate><div class="stkop-oscroll">' +
    '<div class="stkop-tiles" role="radiogroup" aria-label="Side">' +
      '<button type="button" role="radio" class="stkop-tile sell" data-side="sell"><span class="stkop-tl">Sell</span><b class="stkop-tpx" data-k="sellp">—</b></button>' +
      '<span class="stkop-sprc" data-k="spr" title="Spread" hidden>—</span>' +
      '<button type="button" role="radio" class="stkop-tile buy" data-side="buy"><span class="stkop-tl">Buy</span><b class="stkop-tpx" data-k="buyp">—</b></button>' +
    '</div>' +
    '<p class="stkop-wide" data-k="wide" role="status" hidden>Spread is wider than usual</p>' +
    '<div class="stkop-otabs" role="radiogroup" aria-label="Order type"><button type="button" role="radio" data-type="market">Market</button><button type="button" role="radio" data-type="limit">Limit</button><button type="button" role="radio" data-type="stop">Stop</button><button type="button" role="radio" data-type="stoplimit">Stop limit</button></div>' +
    '<label class="stkop-field" data-k="pfield"><span class="stkop-fl" data-k="plabel">Limit price</span><input class="stkop-fi" data-f="price" type="text" inputmode="decimal" autocomplete="off" aria-label="Order price"></label>' +
    '<div class="stkop-sz"><label class="stkop-field"><span class="stkop-fl" data-k="qlabel">Size</span><input class="stkop-fi" data-f="qty" type="text" inputmode="decimal" autocomplete="off" aria-label="Size"></label>' +
      '<div class="stkop-chips" role="group" aria-label="Quick sizes" data-k="chips"></div>' +
      '<p class="stkop-help" data-k="lothelp" hidden></p></div>' +
    '<div class="stkop-legs"><label class="stkop-chk"><input type="checkbox" data-f="sl.on"> <span>Stop loss</span></label><label class="stkop-chk"><input type="checkbox" data-f="tp.on"> <span>Take profit</span></label></div>' +
    '<div class="stkop-luw"><div class="stkop-seg stkop-lu" role="radiogroup" aria-label="Stop loss and take profit unit"><button type="button" role="radio" data-lu="price">Price</button><button type="button" role="radio" data-lu="dist" data-k="lud">Ticks</button><button type="button" role="radio" data-lu="pct">%</button></div></div>' +
    leg('sl', 'Stop loss', true) + leg('tp', 'Take profit', false) + '<p class="stkop-why" data-k="why" hidden></p>' +
    '<dl class="stkop-rows">' + row('oval', 'Order value') + row('omar', 'Margin required', true) + row('ospc', 'Spread cost', true) + '</dl>' +
    '<p class="stkop-sum" data-k="sum"></p>' +
    '<div class="stkop-sec dash"><div class="stkop-brh stkop-adv"><label class="stkop-chk"><input type="checkbox" data-f="adv"> Advanced</label><span class="stkop-hint">TP1 + TP2, risk size, layout</span></div>' +
      legTp1() + viewRisk() + viewLayout() + '</div>' +
  '</div>' +
  '<div class="stkop-go"><p class="stkop-status" role="status" data-k="status"></p><button type="submit" class="stkop-pill stkop-confirm buy" data-k="confirm">Buy</button></div>' +
  '</form>';
}
function viewDom() { return '<div class="stkop-dom"><p class="stkop-empty" data-k="domnote" hidden></p></div>'; }
function viewOff(c) {
  return '<div class="stkop-off"><p>' + (c.live ? '' : 'Paper trading is off. Turn it on to place simulated orders with demo money.') + '</p><button type="button" class="stkop-pill ghost" data-a="paperon">Turn on paper trading</button></div>';
}

// panel + scalp card: one form state, two views
function all(sel) { const a = [...el.querySelectorAll(sel)]; return scEl ? a.concat([...scEl.querySelectorAll(sel)]) : a; }
function setText(sel, t) { let first = null; for (const n of all('[data-k=' + sel + ']')) { if (n.textContent !== t) n.textContent = t; first = first || n; } return first; }
function setVal(f, v) { for (const n of all('[data-f="' + f + '"]')) if (document.activeElement !== n && n.value !== v) n.value = v; }

// row 2 of the header: root + full name, contract, last + change vs the previous daily close, best bid / ask (filled in update())
function wantMeta(c) {
  if (meta.sym === c.sym) return;
  meta = { sym: c.sym, desc: '', prev: null };
  const s = c.sym; if (!s || !P.symMeta) return;
  P.symMeta(s).then((m) => { if (meta.sym !== s || !m) return; meta.desc = m.desc || ''; meta.prev = Number.isFinite(m.prev) && m.prev > 0 ? m.prev : null; update(); }, () => {});
}
const cleanDesc = (d) => String(d || '').replace(/\s+futures?$/i, '').replace(/\s*\(\$\d+\)$/, '').trim();
function renderInfo(c) {
  wantMeta(c);
  const root = c.mt && c.li && c.li.code ? c.li.code : c.fut ? c.rootName : String(c.tk || '—').replace(/^CT:/, '');   // "NAS100", never the feed key "CT:NAS100"
  const name = cleanDesc(meta.desc) || (c.fut ? '' : c.code);
  setText('root', root);
  const nm = setText('name', name); if (nm) nm.hidden = !name;
  for (const n of all('[data-k=scsym]')) { const t = c.mt && c.li && c.li.code ? c.li.code : root; if (n.textContent !== t) n.textContent = t; }
  const code = c.mt ? '' : c.fut ? c.code || '' : '';   // MetaTrader: the symbol picker shows it
  const ce = setText('code', code); if (ce) ce.hidden = !code;
  const ie = el.querySelector('[data-k=inst]'), mp = el.querySelector('[data-k=mtsym]');
  if (mp) {   // MetaTrader: which broker symbol this chart trades (picked once per chart instrument, remembered)
    const m = c.mt && c.li ? c.li.map : null, sig = m ? [m.key, m.sym, m.cands.join(','), m.known].join('|') : '';
    if (mp.dataset.sig !== sig) {
      mp.dataset.sig = sig; mp.hidden = !m;
      mp.innerHTML = m ? '<span class="stkop-vh">' + esc(c.mt) + ' symbol for ' + esc(m.label) + '</span><select data-f="mtsym" aria-label="' + esc(c.mt + ' symbol for ' + m.label) + '" title="' + esc(m.known ? 'Symbols from your account' : 'Usual names at brokers. Use the exact name from MetaTrader’s Market Watch.') + '">' +
        (m.sym ? '' : '<option value="" selected>Pick symbol</option>') +
        [...new Set((m.sym ? [m.sym] : []).concat(m.cands))].map((v) => '<option value="' + esc(v) + '"' + (v === m.sym ? ' selected' : '') + '>' + esc(v) + '</option>').join('') +
        '<option value="__other">Other…</option></select><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' : '';
    }
  }
  if (ie) {
    const f = c.fam, sig = f ? f.mini + '|' + f.micro + '|' + c.rootName + '|' + c.chartRootName : '';
    if (ie.dataset.sig !== sig) {
      ie.dataset.sig = sig; ie.hidden = !f;
      ie.innerHTML = f ? [f.mini, f.micro].map((r) => '<button type="button" role="radio" data-inst="' + r + '" aria-checked="' + (r === c.rootName) + '" class="' + (r === c.rootName ? 'on' : '') + '" title="' + (r === c.chartRootName ? 'Trade ' + r + ' (the chart symbol)' : 'Trade ' + r + ' on this ' + c.chartRootName + ' chart (same prices)') + '">' + r + '</button>').join('') : '';
    }
  }
}
// the account comes from the Trade menu (top bar); the panel only shows it. Members: "Paper · DEMO", never a broker name.
function acctLabel(c) {
  if (!c.live) return { name: 'Paper', env: 'Demo', num: '', live: false, t: 'Paper · DEMO', full: 'Paper trading · demo money' };
  const L2 = window.__stkLive && window.__stkLive.state, a = L2 && L2.acct;
  const env = c.li && c.li.env ? c.li.env : 'LIVE', demo = !!(a && a.demo) || env === 'SANDBOX';
  const n = a ? String(a.number || a.last4 || '').replace(/\s+/g, '') : '';
  // the Owner's label, else the broker's account NAME (19 Nov); the full "Tradovate NAME" rides in the title
  return { name: a ? (a.short && a.short !== n ? a.short : a.broker || 'Broker') : 'Broker', env: demo ? 'Demo' : 'Live', num: n ? '…' + n.slice(-3) : '', live: true,
    t: env + (a ? ' · ' + (a.short || a.broker || 'Broker') : ''), full: a ? env + ' · ' + (a.label || a.broker) : '' };
}
function renderAcct(c) {
  const b = el.querySelector('[data-k=acct]'), al = acctLabel(c), sig = JSON.stringify(al) + !!P.openTradeMenu;
  if (b.dataset.sig === sig) return; b.dataset.sig = sig;
  b.className = 'stkop-acct' + (al.live ? ' live' : '');
  b.title = (al.full ? al.full + '. ' : '') + (P.openTradeMenu ? 'Switch the account in the Trade menu' : '');
  b.disabled = !P.openTradeMenu;
  b.innerHTML = '<span class="stkop-vh">Trading account: </span><span class="stkop-an">' + esc(al.name) + '</span><span class="stkop-env' + (al.env === 'Live' ? ' live' : '') + '">' + al.env + '</span>' +
    (al.num ? '<span class="stkop-anum">' + esc(al.num) + '</span>' : '') + (P.openTradeMenu ? ICON.chev : '') + '<span class="stkop-vh"> ' + esc(al.t) + '</span>';
}
function renderFoot(c) {
  const ai = prefs.adv ? prefs.ai : [];
  const sig = JSON.stringify([c.live, c.li && c.li.killed, c.li && c.li.admin, ai]);
  if (footSig === sig) return; footSig = sig;
  footEl.innerHTML =
    '<dl class="stkop-acr"><div><dt>Balance</dt><dd data-k="abal">—</dd></div><div><dt>Equity</dt><dd data-k="aeq">—</dd></div><div data-r="afm" hidden><dt>Free margin</dt><dd data-k="afm">—</dd></div></dl>' +
    '<div class="stkop-fr">' +
      '<span class="stkop-pos" data-k="pos">Flat</span><span class="stkop-pnl" data-k="pnl"></span><span class="stkop-wk" data-k="wk"></span><span class="stkop-sp"></span><button type="button" class="stkop-b warn" data-a="flat">Flatten</button>' +
      (c.live && c.li && c.li.admin ? (c.li.killed ? '<button type="button" class="stkop-b" data-a="killon" title="Switch live trading on">Live on</button>' : '<button type="button" class="stkop-b warn" data-a="kill" title="Turn off live trading (kill switch)">Live off</button>') : '') +
    '</div>' +
    (ai.length ? '<dl class="stkop-ai" data-n="' + ai.length + '">' + AI.filter((a) => ai.includes(a[0])).map((a) => '<div><dt>' + esc(a[1]) + '</dt><dd data-ai-v="' + a[0] + '">—</dd></div>').join('') + '</dl>' : '') +
    '<p class="stkop-fine" data-k="fine"></p>';
}
// footer account numbers (Advanced → Show): paper = the demo account, admins live = the broker summary (numbers only, no names)
function renderAi() {
  const d = P.acctSummary ? P.acctSummary() : null;
  setText('abal', money(d ? d.bal : null)); setText('aeq', money(d ? d.eq : null));   // free margin: only with a broker margin figure (none yet), never guessed
  const n = footEl.querySelectorAll('[data-ai-v]'); if (!n.length) return;
  for (const e of n) {
    const v = d ? d[e.dataset.aiV] : null, t = money(v, e.dataset.aiV === 'day' || e.dataset.aiV === 'up');
    if (e.textContent !== t) e.textContent = t;
    e.className = e.dataset.aiV === 'day' || e.dataset.aiV === 'up' ? (v > 0 ? 'up' : v < 0 ? 'down' : '') : '';
  }
}

// price text with the last digit small (Owner 25 Nov, like the reference): "25,337.4" + "7"
const bigPx = (t) => (t === '—' || t.length < 2 ? esc(t) : esc(t.slice(0, -1)) + '<sup>' + esc(t.slice(-1)) + '</sup>');
function putHtml(k, t) { for (const n of all('[data-k=' + k + ']')) if (n.dataset.t !== t) { n.dataset.t = t; n.innerHTML = bigPx(t); } }
// lot helper: "0.01 lots = 0.1 NAS100" from the broker's lot size (cTrader symbol details), else nothing
function lotHelp(c, qty) {
  if (!c.mt || !c.li || !c.li.code) return '';
  const L2 = window.__stkLive, u = L2 && L2.lotUnits ? L2.lotUnits(c.li.code, qty) : null;
  return u > 0 ? fmtQ(qty) + ' lots = ' + (+u.toPrecision(6)).toLocaleString('en-US') + ' ' + c.li.code : '';
}
const fmtQ = (q) => (Number.isInteger(q) ? String(q) : String(+q.toFixed(6)));
function chipSet(c) {   // quick sizes: lots for MetaTrader-style accounts, else contracts / units from the step
  const r = qtyRules(c);
  if (r.lots) return [0.01, 0.1, 0.5, 1].map((v) => L.roundLots(v, r.lots) || r.min).filter((v, i, a) => v >= r.min && v <= r.max && a.indexOf(v) === i);
  if (r.int) return [1, 2, 5, 10].filter((v) => v >= r.min && v <= r.max);
  const st = r.step || r.min || 1; return [1, 10, 50, 100].map((k) => Number((k * st).toFixed(6))).filter((v) => v >= r.min && v <= r.max);
}
// money of one leg at its level (paper point value / live contract value / cTrader units), null when not known
function legMoney(c, ref, p, qty) {
  if (!(ref > 0) || !(p > 0)) return null;
  const dir = F.side === 'buy' ? 1 : -1;
  if (c.live) {
    if (c.li && c.li.pv > 0) return (p - ref) * dir * qty * c.li.pv;
    const L2 = window.__stkLive, u = c.mt && c.li && L2 && L2.lotUnits ? L2.lotUnits(c.li.code, qty, true) : null;   // USD-quoted broker symbols only
    return u > 0 ? (p - ref) * dir * u : null;
  }
  return c.sp.ok && c.sp.pointValue > 0 ? (p - ref) * dir * qty * c.sp.pointValue : null;
}
function notional(c, ref, qty) {
  if (!(ref > 0)) return null;
  if (c.live) { if (c.li && c.li.pv > 0) return ref * qty * c.li.pv; const L2 = window.__stkLive, u = c.mt && c.li && L2 && L2.lotUnits ? L2.lotUnits(c.li.code, qty, true) : null; return u > 0 ? ref * u : null; }
  return c.sp.ok && c.sp.pointValue > 0 ? ref * qty * c.sp.pointValue : null;
}

// one pass: (re)build what changed, then fill every number / state
export function update() {
  if (!el) return;
  const c = ctx();
  renderChip(c);
  const sv = scVis();
  renderScalp(c, sv);
  if (!open && !sv) { stopQuote(); return; }
  if (P.setPreview && (!open || shownTab() !== 'order')) P.setPreview('panel', '', []);
  wantQuote(c);
  const ph = isPhone(), tab = shownTab(), paperOff = !c.live && !P.enabled;
  const dk = docked(), sig = [tab, c.live, ph, paperOff, c.fut, prefs.min && !dk, dk, tab === 'dom' ? c.sym : ''].join('|');
  el.classList.toggle('is-live', c.live);
  if (open && viewSig !== sig) {
    viewSig = sig;
    const b = window.__stkBookPanel;
    if (tab !== 'dom' && b && b.embedded) b.unembed();
    const mn0 = prefs.min && !ph && !dk;
    bodyEl.innerHTML = mn0 ? '' : paperOff ? viewOff(c) : tab === 'order' ? viewOrder(c) : viewDom();
    if (tab === 'dom' && !paperOff && !mn0) {
      const box = bodyEl.querySelector('.stkop-dom');
      if (b && b.embed) b.embed(box); else { const n = box.querySelector('[data-k=domnote]'); n.hidden = false; n.textContent = 'The DOM ladder is not available on this page.'; }
    }
    for (const t of el.querySelectorAll('[data-tab]')) { const on = t.dataset.tab === tab; t.setAttribute('aria-selected', String(on)); t.classList.toggle('on', on); t.tabIndex = on ? 0 : -1; }
    const mx = el.querySelector('[data-a=max]'), mn = el.querySelector('[data-a=min]');
    mx.innerHTML = prefs.max ? ICON.restore : ICON.max; mx.setAttribute('aria-label', prefs.max ? 'Restore the panel size' : 'Expand the panel'); mx.title = prefs.max ? 'Restore' : 'Expand';
    mn.innerHTML = prefs.min ? ICON.open : ICON.min; mn.setAttribute('aria-label', prefs.min ? 'Show the panel' : 'Minimise the panel'); mn.title = prefs.min ? 'Show' : 'Minimise';
    for (const b of el.querySelectorAll('.stkop-mode')) { const on = b.dataset.a === (dk ? prefs.mode : 'float'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    requestAnimationFrame(layout);
  }
  { const t = el.querySelector('[data-a=sc]'); t.classList.toggle('on', !!prefs.sc); t.setAttribute('aria-pressed', String(!!prefs.sc)); }
  if (open) { renderAcct(c); renderFoot(c); }
  const qt = quote(c), why = blockOf(c);
  renderInfo(c);
  el.setAttribute('aria-label', 'Order panel ' + c.label + (c.live ? ', LIVE account' : ', paper trading'));
  // quantity (cap + integer rules follow the mode)
  if (c.mt && F.mtAcct !== c.li.map.key + c.mt) { F.mtAcct = c.li.map.key + c.mt; F.qty = String(c.li.lots.min); }   // MetaTrader: start at the smallest lot, never a futures size
  const qn = cleanQty(c, F.qty); const af = document.activeElement; if (af && af.dataset && af.dataset.f === 'qty') {} else if (String(qn) !== F.qty) F.qty = String(qn);
  setVal('qty', F.qty);
  const r = qtyRules(c);
  for (const b of all('[data-q]')) b.disabled = +b.dataset.q < 0 ? qn <= r.min : qn >= r.max;
  // bid / ask: the order book's touch (futures L2 / crypto book), else the broker chart's own bid / ask (display + tiles)
  const bq = qt ? null : brokerQuote(c), dq = qt || bq;
  const put = (k, t, hide) => { for (const n of all('[data-k=' + k + ']')) { if (t != null && n.textContent !== t) n.textContent = t; if (hide != null && n.hidden !== hide) n.hidden = hide; } };
  for (const n of all('[data-k=bid]')) { const q = dq, t = q ? fmt(c, q.bid) : '—'; if (n.textContent !== t) n.textContent = t; }
  for (const n of all('[data-k=ask]')) { const q = dq, t = q ? fmt(c, q.ask) : '—'; if (n.textContent !== t) n.textContent = t; }
  // tiles: Sell = bid, Buy = ask (no quote: the last price on both)
  putHtml('sellp', dq ? fmt(c, dq.bid) : fmt(c, c.last)); putHtml('buyp', dq ? fmt(c, dq.ask) : fmt(c, c.last));
  put('buypx', bq ? fmt(c, bq.ask) : '', !bq); put('sellpx', bq ? fmt(c, bq.bid) : '', !bq);
  const sprT = bq ? spreadText(bq) : qt ? fmt(c, qt.ask - qt.bid) : '';
  put('spr', sprT || '—', !sprT); put('wide', 'Spread is wider than usual', !(bq && bq.wide));
  for (const n of all('[data-k=spr]')) n.classList.toggle('wide', !!(bq && bq.wide));
  // scalp card
  for (const b of all('.stkop-scalp [data-a=buy], .stkop-scalp [data-a=sell]')) b.disabled = !!why;
  const lim = caps(c).limit !== false;
  for (const b of all('.stkop-join')) { b.disabled = !!why || !dq || !lim; if (!lim) { b.title = caps(c).why; continue; } b.title = why || (!dq ? noQuoteWhy(c) : (b.dataset.a === 'jbid' ? 'Buy limit at the best bid' : 'Sell limit at the best ask')); }
  for (const hk of all('[data-f=hk]')) hk.checked = !!prefs.hk;
  // order form
  const form = open ? el.querySelector('.stkop-order') : null;
  if (form) {
    const k = caps(c);
    if ((F.type === 'stop' && !k.stop) || (F.type === 'stoplimit' && !k.stoplimit) || (F.type === 'limit' && k.limit === false)) F.type = 'market';
    for (const b of form.querySelectorAll('[data-side]')) { const on = b.dataset.side === F.side; b.setAttribute('aria-checked', String(on)); b.classList.toggle('on', on); }
    for (const b of form.querySelectorAll('[data-type]')) { const on = b.dataset.type === F.type, t = b.dataset.type; b.setAttribute('aria-checked', String(on)); b.classList.toggle('on', on); b.disabled = (t === 'stop' && !k.stop) || (t === 'stoplimit' && !k.stoplimit) || (t === 'limit' && k.limit === false); b.title = b.disabled ? (t === 'stoplimit' ? k.slWhy || k.why : k.why) : ''; }
    // price
    const pk = c.sym + '|' + F.type + '|' + F.side;
    if (F.type !== 'market' && F.priceKey !== pk) {
      F.priceKey = pk;
      const base = F.type === 'limit' && qt ? (F.side === 'buy' ? qt.bid : qt.ask) : c.last != null ? roundTick(c.last + (F.type === 'limit' ? -1 : 1) * (F.side === 'buy' ? 1 : -1) * 10 * c.tick, c.tick) : null;
      F.price = base != null ? fmtIn(c, base) : '';
    }
    setText('plabel', F.type === 'limit' ? 'Limit price' : 'Stop price');
    const pf = form.querySelector('[data-k=pfield]'); pf.hidden = F.type === 'market';
    setVal('price', F.price);
    // size + quick chips + lot helper
    const mtl = !!(c.mt && r.lots);
    setText('qlabel', mtl || c.fut || c.live ? 'Size (lots)' : 'Size' + (c.sp.ok && c.sp.unit && c.sp.unit !== 'unit' ? ' (' + window.PaperEngine.unitWord(c.sp, 2) + ')' : ''));
    const cs = chipSet(c), ch = form.querySelector('[data-k=chips]'), chs = cs.join('|');
    if (ch.dataset.sig !== chs) { ch.dataset.sig = chs; ch.innerHTML = cs.map((v) => '<button type="button" data-chip="' + v + '">' + (mtl ? v.toFixed(2) : fmtQ(v)) + '</button>').join(''); ch.hidden = !cs.length; }
    for (const b of ch.children) { const on = Math.abs(+b.dataset.chip - qn) < 1e-9; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    { const t = lotHelp(c, qn), h = form.querySelector('[data-k=lothelp]'); h.hidden = !t; if (h.dataset.t !== t) { h.dataset.t = t; h.innerHTML = esc(t) + ' <span class="stkop-ii" title="One lot is the broker’s contract size for this symbol">' + ICON.info + '</span>'; } }
    // stop loss / take profit
    const ref = entryRef(c, qt);
    const sl = k.bracket && F.sl.on ? legSync(c, ref, 'sl') : (legSync(c, ref, 'sl'), null), tp = k.bracket && F.tp.on ? legSync(c, ref, 'tp') : (legSync(c, ref, 'tp'), null);
    const two = k.bracket && k.two, tp1 = two && F.tp1.on ? legSync(c, ref, 'tp1') : (legSync(c, ref, 'tp1'), null);
    const lu = prefs.lu, luKey = lu === 'price' ? 'price' : lu === 'pct' ? 'pct' : 'ticks';
    const distWord = mtl && c.li && /(^|[^A-Z])[A-Z]{6}$/.test(c.li.code || '') ? 'Pips' : 'Ticks';
    setText('lud', distWord);
    for (const b of form.querySelectorAll('[data-lu]')) { const o2 = b.dataset.lu === lu; b.classList.toggle('on', o2); b.setAttribute('aria-checked', String(o2)); }
    form.querySelector('.stkop-luw').hidden = !(k.bracket && (F.sl.on || F.tp.on));
    const qty0 = cleanQty(c, F.qty);
    for (const lg of ['sl', 'tp']) {
      const fs = form.querySelector('[data-leg=' + lg + ']'), on = F[lg].on && k.bracket;
      fs.hidden = !on;
      const cb = form.querySelector('[data-f="' + lg + '.on"]'); cb.checked = on; cb.disabled = !k.bracket; cb.closest('label').classList.toggle('na', !k.bracket);
      const inp = fs.querySelector('[data-leg-in]'); if (inp.dataset.f !== lg + '.' + luKey) { inp.dataset.f = lg + '.' + luKey; inp.value = ''; }
      setVal(lg + '.' + luKey, F[lg][luKey]);
      setText(lg + 'unit', lu === 'price' ? '' : lu === 'pct' ? '%' : distWord.toLowerCase());
      const lvl = lg === 'sl' ? sl : tp, m = on ? legMoney(c, ref, lvl, qty0) : null;
      const pt = !on || !(lvl > 0) ? '' : (lu === 'price' ? '' : '@ ' + fmt(c, lvl) + '  ') + (m == null ? '' : money(m, true));
      const pe = setText(lg + 'proj', pt); if (pe) pe.className = 'stkop-proj' + (m > 0 ? ' up' : m < 0 ? ' down' : '');
      const bad = on && !(lvl > 0); inp.classList.toggle('bad', bad && document.activeElement !== inp && F[lg][luKey] !== '');
    }
    // preview lines (Trade display > Order preview: dashed lines of what the panel is about to send, never sent)
    { const pl = [], sd = F.side;
      if (open && ref > 0 && P.setPreview) {
        if (F.type !== 'market') pl.push({ id: 'pv-e', price: ref, side: sd, type: F.type === 'stoplimit' ? 'stop' : F.type, qty: qty0 });
        if (sl > 0) pl.push({ id: 'pv-sl', price: sl, side: sd, role: 'sl', ref, qty: qty0 });
        if (tp > 0) pl.push({ id: 'pv-tp', price: tp, side: sd, role: 'tp', ref, qty: qty0 });
        if (tp1 > 0) pl.push({ id: 'pv-tp1', price: tp1, side: sd, role: 'tp', ref, qty: '' });
      }
      if (P.setPreview) P.setPreview('panel', c.sym, pl); }
    const t1on = two && F.tp1.on;
    if (k.two) {
      const f1 = form.querySelector('[data-leg=tp1]');
      for (const i of f1.querySelectorAll('.stkop-t1q input')) i.disabled = !t1on;
      for (const i of f1.querySelectorAll('.stkop-pair input')) i.disabled = !t1on;
      { const cb = f1.querySelector('[data-f="tp1.on"]'); cb.checked = t1on; }
      for (const b of f1.querySelectorAll('[data-unit]')) { const o2 = b.dataset.unit === F.tp1.unit; b.classList.toggle('on', o2); b.setAttribute('aria-checked', String(o2)); b.disabled = !t1on; }
      const uq = f1.querySelector('[data-k=unitq]'); if (uq) uq.textContent = c.fut || c.live ? 'Lots' : 'Qty';
      const be = f1.querySelector('[data-f="be.on"]'); be.checked = F.be.on; be.disabled = !t1on;
      f1.querySelector('[data-f="be.ticks"]').disabled = !t1on || !F.be.on;
      setVal('tp1.price', F.tp1.price); setVal('tp1.ticks', F.tp1.ticks); setVal('tp1.size', F.tp1.size); setVal('be.ticks', F.be.ticks);
    }
    form.querySelector('[data-leg=tp1]').hidden = !k.two;
    // Advanced (TP1, risk size, layout)
    const adv = !!prefs.adv;
    { const ac = form.querySelector('[data-f=adv]'); if (ac) ac.checked = adv; }
    const lay = form.querySelector('[data-leg=lay]');
    lay.hidden = !adv;
    if (adv) {
      const wp = lay.querySelector('.stkop-wpos'); wp.hidden = isPhone();
      for (const b of lay.querySelectorAll('[data-wmode]')) { const o2 = b.dataset.wmode === prefs.mode; b.classList.toggle('on', o2); b.setAttribute('aria-checked', String(o2)); }
      for (const b of lay.querySelectorAll('[data-ai]')) { const o2 = prefs.ai.includes(b.dataset.ai); b.classList.toggle('on', o2); b.setAttribute('aria-pressed', String(o2)); }
    }
    const rs = riskSize(c, k, ref, sl);
    const rf = form.querySelector('[data-leg=risk]');
    rf.hidden = !adv;
    { const cb = rf.querySelector('[data-f="risk.on"]'); cb.checked = F.risk.on && k.bracket; cb.disabled = !k.bracket; rf.classList.toggle('na', !k.bracket); rf.classList.toggle('on', F.risk.on && k.bracket);
      for (const b of rf.querySelectorAll('[data-rmode]')) { const o2 = b.dataset.rmode === F.risk.mode; b.classList.toggle('on', o2); b.setAttribute('aria-checked', String(o2)); b.disabled = !(F.risk.on && k.bracket); }
      rf.querySelector('[data-f="risk.v"]').disabled = !(F.risk.on && k.bracket); setVal('risk.v', F.risk.v);
      setText('runit', F.risk.mode === 'pct' ? '%' : 'USD');
      const rt = !rs ? '' : rs.error ? rs.error : (rs.over ? 'Min size: ' + rs.qty + ' risks ' + money(rs.risk) + ', more than ' + money(rs.amt) : rs.qty + (c.fut || c.live ? (rs.qty === 1 ? ' lot' : ' lots') : c.sp.ok && c.sp.unit !== 'unit' ? ' ' + window.PaperEngine.unitWord(c.sp, rs.qty) : '') + ' · risk ' + money(rs.risk) + (rs.capped ? ' (max size)' : ''));
      const re = setText('rsum', rt); if (re) re.classList.toggle('bad', !!(rs && (rs.error || rs.over)));
    }
    if (rs && !rs.error && String(rs.qty) !== F.qty) { F.qty = String(rs.qty); setVal('qty', F.qty); }
    for (const b of ch.children) b.disabled = !!(rs && !rs.error);
    { const qi = form.querySelector('[data-f=qty]'); if (qi) qi.readOnly = !!(rs && !rs.error); }
    const tr = form.querySelector('[data-f=trail]'); if (tr) { tr.disabled = !(k.trail && F.sl.on); if (tr.disabled) F.trail = false; tr.checked = F.trail; tr.closest('label').title = k.trail ? 'Keeps the stop the same distance behind the best price (simulated)' : c.live ? k.why : 'Trail works on market orders'; tr.closest('label').hidden = !k.trail; }
    const wh = form.querySelector('[data-k=why]'); const w2 = !k.bracket ? k.why : c.live && adv ? LIVE_TWO : ''; wh.hidden = !w2; if (wh.textContent !== w2) wh.textContent = w2;
    // summary rows: order value, margin (only from the broker's own figure: never guessed), spread cost
    const qty = qty0;
    const nv = notional(c, ref, qty); setText('oval', nv == null ? '—' : money(nv).replace('$', '') + ' USD');
    const mg = c.live && c.lv && c.lv.marginFor ? c.lv.marginFor(c.sym, qty, ref) : null;
    { const rw = form.querySelector('[data-r=omar]'); rw.hidden = !(mg > 0); if (mg > 0) setText('omar', money(mg).replace('$', '') + ' USD'); }
    const sq = dq ? legMoney(c, dq.ask, dq.bid, qty) : null, spc = sq == null ? null : Math.abs(sq);
    { const rw = form.querySelector('[data-r=ospc]'); rw.hidden = spc == null; if (spc != null) setText('ospc', money(spc).replace('$', '') + ' USD'); }
    // TP1 size in lots (from % rounded down, like the engine)
    let q1 = null;
    if (tp1 != null) { const n = num(F.tp1.size), st = c.sp.ok ? c.sp.qtyStep : 1; q1 = F.tp1.unit === 'pct' ? Math.floor(qty * Math.min(100, Math.max(0, n)) / 100 / st + 1e-9) * st : n; q1 = Number.isFinite(q1) ? Number(q1.toFixed(6)) : null; }
    const q2 = q1 != null && q1 > 0 && q1 < qty ? Number((qty - q1).toFixed(6)) : qty;
    if (k.two) {
      const t1 = !t1on ? '' : !(q1 > 0) ? 'Enter how much TP1 closes.' : !(q1 < qty) ? 'TP1 must close less than ' + qty + '; TP2 takes the rest.' : 'TP1 closes ' + q1 + ', TP2 ' + (tp != null ? 'closes ' : 'leaves ') + q2 + (F.be.on ? '. Then the stop moves to entry' + (num(F.be.ticks) > 0 ? ' + ' + Math.round(num(F.be.ticks)) + ' ticks' : '') : '') + '.';
      const te = setText('t1sum', t1); if (te) te.classList.toggle('bad', !!t1on && !(q1 > 0 && q1 < qty));
    }
    const pv = c.live ? (c.li ? c.li.pv : 0) : c.sp.ok ? c.sp.pointValue : 0, parts = [];
    if (pv > 0 && sl != null && (tp != null || tp1 != null) && ref) {
      const rw = (tp1 != null && q1 > 0 && q1 < qty ? Math.abs(tp1 - ref) * q1 : 0) + (tp != null ? Math.abs(tp - ref) * (tp1 != null && q1 > 0 && q1 < qty ? q2 : qty) : 0);
      if (Math.abs(ref - sl) > 0 && rw > 0) parts.push('R:R 1:' + (rw / (Math.abs(ref - sl) * qty)).toFixed(2));
    }
    setText('sum', parts.join(' · '));
    // the one primary button: "Buy 0.01 NAS100", disabled until the ticket is valid
    const invalid = why || (F.type !== 'market' && !(num(F.price) > 0)) || (k.bracket && ((F.sl.on && !(sl > 0)) || (F.tp.on && !(tp > 0)))) || (rs && rs.error);
    const go = form.querySelector('[data-k=confirm]');
    go.className = 'stkop-pill stkop-confirm ' + F.side; go.disabled = !!invalid;
    const nm = c.mt && c.li && c.li.code ? c.li.code : c.fut ? c.rootName : c.tk;
    const gt = (F.side === 'buy' ? 'Buy ' : 'Sell ') + (mtl ? qty.toFixed(2) : fmtQ(qty)) + ' ' + nm + (F.type === 'market' ? '' : F.type === 'limit' ? ' limit' : F.type === 'stop' ? ' stop' : ' stop limit');
    if (go.textContent !== gt) go.textContent = gt;
    go.title = typeof invalid === 'string' ? invalid : invalid ? 'Fill in the fields above' : '';
  }
  // status
  const st = why || (qt && qt.note) || (c.live ? ((c.li && c.li.rtt ? c.li.rtt + ' ' : '') + 'Ready. Real orders at your broker, sent on the click.') : '');
  for (const n of all('[data-k=status]')) { if (n.textContent !== st) n.textContent = st; n.classList.toggle('bad', !!why); }
  if (!open) return;
  renderAlert(c);
  // footer numbers
  let posT = 'Flat', pnl = null, wk = 0;
  if (c.live && c.li) { const q = c.li.pos.qty; posT = q ? (q > 0 ? 'Long ' : 'Short ') + Math.abs(q) + ' ' + c.li.code + (c.li.pos.avg ? ' @ ' + fmt(c, c.li.pos.avg) : '') : 'Flat ' + c.li.code; pnl = q ? c.li.pnl : null; wk = c.li.working.length; }
  else if (!c.live && c.a && c.sp.ok) { const p = c.a.position(c.sym); if (p) { posT = (p.side === 'buy' ? 'Long ' : 'Short ') + p.qty + ' @ ' + fmt(c, p.avg); pnl = c.a.openPnl(p); } wk = c.a.state.orders.filter((o) => o.symbol === c.sp.symbol).length; }
  setText('pos', posT);
  const pe = setText('pnl', pnl == null ? '' : money(pnl, true)); if (pe) pe.className = 'stkop-pnl' + (pnl > 0 ? ' up' : pnl < 0 ? ' down' : '');
  setText('wk', wk + ' working');
  const fl = el.querySelector('[data-a=flat]'); if (fl) fl.disabled = c.live ? !c.li || (!c.li.pos.qty && !c.li.working.length) : !(c.a && c.sp.ok && (c.a.position(c.sym) || wk));
  renderAi();
  setText('fine', c.live ? 'Real orders at your broker. Every attempt is logged. ' + DISCLAIMER : (P.label || 'Paper trading · demo money · simulated fills') + '. ' + DISCLAIMER);
}

// live strip under the symbol row (2026-11-17): the broker link could not be reached (Retry), or the stop loss / take profit state
// (red when the position has no working stop). Hidden on paper and when there is nothing to say.
function renderAlert(c) {
  const box = el.querySelector('[data-k=alert]'); if (!box) return;
  const li = c.live ? c.li : null, g = li && li.group;
  let t = '', kind = '', retry = false, enable = false;
  if (li && li.retry) { t = li.block; kind = 'bad'; retry = true; }
  else if (li && li.needsEnable) { t = 'View only. Enable live trading to send orders from this account.'; kind = 'warn'; enable = true; }   // member live, 21 Nov
  else if (li && li.alarm) { t = li.alarm; kind = 'bad'; }
  else if (g) {
    const p = (v) => (v == null ? '' : fmt(c, v));
    const legs = [g.sl != null ? 'Stop loss ' + p(g.sl) : '', g.tp != null ? 'Take profit ' + p(g.tp) : ''].filter(Boolean).join(' · ');
    t = (g.state === 'pending' ? 'Waiting for the fill, then sending ' : 'Working at your broker: ') + legs + (g.why ? '. ' + g.why : '. Keep this tab open.');
    kind = g.why ? 'warn' : 'info';
  }
  box.hidden = !t; box.className = 'stkop-alert' + (kind ? ' ' + kind : '');
  setText('alt', t);
  const rb = box.querySelector('[data-a=retry]'); rb.hidden = !retry;
  const eb = box.querySelector('[data-a=enable]'); if (eb) eb.hidden = !enable;
}

// ------------------------------------------------------------------------------------------------ SCALP card on the chart
// Owner 25 Nov: "move the scalp panel like this to chart". A compact card INSIDE the chart (default bottom-centre, 12 px above the time
// axis), never over the price scale. Header: Scalp · symbol · expand (opens the order panel) · minimise (a small pill). Buy · size · Sell,
// then Join Bid / Join Ask (limits at the touch, the same send() as the panel). Drag by the header, resize from the corner; position +
// width per user (prefs.sx / sy / sw). Phones: docked full width just above the chart's bottom bar. Opt-in: the "Scalp" toggle in the
// order panel header (prefs.sc). Shown only after Trade was opened this session (all trading UI stays hidden until then).
const scVis = () => !!(prefs && prefs.sc && scLatch && P && (P.enabled || P.live));
function setScalp(on) { prefs.sc = !!on; prefs.scMin = false; if (on) scLatch = true; savePrefs(); scSig = ''; update(); }
function buildScalp() {
  scEl = document.createElement('div'); scEl.id = 'stkop-sc'; scEl.className = 'stkop stkop-sc'; scEl.hidden = true;
  scEl.setAttribute('role', 'group'); scEl.setAttribute('aria-label', 'Scalp');
  document.body.appendChild(scEl);
  for (const ev of ['keydown', 'keyup', 'wheel', 'dblclick']) scEl.addEventListener(ev, (e) => e.stopPropagation(), { passive: ev === 'wheel' });
  scEl.addEventListener('pointerdown', (e) => e.stopPropagation());
  scEl.addEventListener('click', onClick); scEl.addEventListener('input', onInput); scEl.addEventListener('focusout', onBlur);
}
// the active chart's plot area without the price scale and time axis (viewport px)
function plotBox() {
  try {
    const A = window.__stkAxisTags, cell = A.cellsOf().find((x) => { try { return x.id === window.STRYKER_VELA.active.id; } catch (e) { return false; } }) || A.cellsOf()[0], R = A.rendererOf(cell);
    const pr = R.plot.getBoundingClientRect(), W = R.coords.width, sc = R.scene, panes = sc && sc.panes ? [...sc.panes.values()] : [];
    const bot = panes.length ? Math.max(...panes.map((q) => q.bounds.top + q.bounds.height)) : pr.height - 28;
    if (pr.width > 0 && W > 0) return { left: pr.left, top: pr.top, right: pr.left + W, bottom: pr.top + bot, axisR: pr.right };
  } catch (e) {}
  const r = chartRect(); return { left: r.left, top: r.top, right: r.right - 64, bottom: r.bottom - 28, axisR: r.right };
}
function placeScalp() {
  if (!scEl || scEl.hidden) return;
  const B = plotBox();
  if (isPhone()) {   // full width above the chart's bottom bar
    scEl.style.width = 'auto'; scEl.style.left = '8px'; scEl.style.right = '8px';
    const bb = document.querySelector('.vela-widget-bottombar'), r = bb && bb.getBoundingClientRect(), y = r && r.height ? r.top : B.bottom;
    scEl.style.top = Math.round(y - scEl.offsetHeight - 8) + 'px'; return;
  }
  scEl.style.right = '';
  const w = Math.min(prefs.sw, Math.max(SW_MIN, B.right - B.left - 16)), h = scEl.offsetHeight || 112;
  scEl.style.width = w + 'px';
  let x = prefs.sx, y = prefs.sy;
  if (x == null || y == null) { x = Math.round((B.left + B.right - w) / 2); y = Math.round(B.bottom - h - 12); }
  x = clamp(Math.round(x), B.left + 8, Math.max(B.left + 8, B.right - w - 8)); y = clamp(Math.round(y), B.top + 8, Math.max(B.top + 8, B.bottom - h - 8));
  scEl.style.left = x + 'px'; scEl.style.top = y + 'px';
}
function bindScalp() {
  const hd = scEl.querySelector('.stkop-schd'), g = scEl.querySelector('.stkop-rs');
  hd.addEventListener('pointerdown', (e) => {
    if (isPhone() || e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault(); const r = scEl.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    hd.setPointerCapture(e.pointerId); scEl.classList.add('dragging');
    const mv = (ev) => { prefs.sx = ev.clientX - dx; prefs.sy = ev.clientY - dy; placeScalp(); prefs.sx = parseFloat(scEl.style.left); prefs.sy = parseFloat(scEl.style.top); };
    const up = () => { hd.removeEventListener('pointermove', mv); hd.removeEventListener('pointerup', up); hd.removeEventListener('pointercancel', up); scEl.classList.remove('dragging'); savePrefs(); };
    hd.addEventListener('pointermove', mv); hd.addEventListener('pointerup', up); hd.addEventListener('pointercancel', up);
  });
  if (g) g.addEventListener('pointerdown', (e) => {
    if (isPhone()) return;
    e.preventDefault(); e.stopPropagation(); const w0 = scEl.offsetWidth, x0 = e.clientX;
    g.setPointerCapture(e.pointerId); scEl.classList.add('sizing');
    const mv = (ev) => { prefs.sw = clamp(Math.round(w0 + ev.clientX - x0), SW_MIN, SW_MAX); if (prefs.sx == null) { const r = scEl.getBoundingClientRect(); prefs.sx = r.left; prefs.sy = r.top; } placeScalp(); };
    const up = () => { g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); scEl.classList.remove('sizing'); savePrefs(); };
    g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up);
  });
}
function renderScalp(c, vis) {
  if (!vis) { if (scEl && !scEl.hidden) { scEl.hidden = true; scSig = ''; } return; }
  if (!scEl) buildScalp();
  const mn = !!prefs.scMin, paperOff = !c.live && !P.enabled, sig = [mn, c.live, c.fut, paperOff, isPhone()].join('|');
  scEl.classList.toggle('is-live', c.live); scEl.classList.toggle('is-min', mn);
  if (scSig !== sig) {
    scSig = sig;
    scEl.innerHTML = '<div class="stkop-schd"><span class="stkop-sct">Scalp</span><b class="stkop-scs" data-k="scsym"></b>' +
      '<span class="stkop-hbtns"><button type="button" class="stkop-ib" data-a="scx" aria-label="Open the order panel" title="Order panel">' + ICON.max + '</button>' +
      '<button type="button" class="stkop-ib" data-a="scmin" aria-label="' + (mn ? 'Show the scalp card' : 'Minimise the scalp card') + '" title="' + (mn ? 'Show' : 'Minimise') + '">' + (mn ? ICON.open : ICON.min) + '</button></span></div>' +
      (mn ? '' : viewScalp(c)) + (mn || isPhone() ? '' : '<i class="stkop-rs" aria-hidden="true" title="Resize"></i>');
    bindScalp();
  }
  if (scEl.hidden) { scEl.hidden = false; requestAnimationFrame(placeScalp); }
  placeScalp();
}

// LIVE status chip on the chart (replaces the old bottom strip): click = open the panel
function renderChip(c) {
  const host = document.querySelector('.stkchart-panel');
  if (!c.live || !host || scVis()) { if (chipEl) { chipEl.remove(); chipEl = null; } return; }   // the Scalp card sits where the chip would
  if (!chipEl || chipEl.parentNode !== host) {
    if (chipEl) chipEl.remove();
    chipEl = document.createElement('button'); chipEl.type = 'button'; chipEl.className = 'stkop-lchip'; chipEl.innerHTML = '<i aria-hidden="true"></i><span></span>';
    chipEl.addEventListener('click', (e) => { e.stopPropagation(); openPanel(); });
    chipEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    host.appendChild(chipEl);
  }
  const L2 = window.__stkLive && window.__stkLive.state, nm = L2 && L2.acct ? (L2.acct.short || L2.acct.last4) : '';
  const t = (c.li ? c.li.env : 'LIVE') + ' ' + nm + (c.li ? ' · ' + c.li.code + ' · ' + (c.li.pos.qty ? (c.li.pos.qty > 0 ? 'Long ' : 'Short ') + Math.abs(c.li.pos.qty) + ' ' + money(c.li.pnl, true) : 'Flat') : ' · not tradable here');
  const s = chipEl.querySelector('span'); if (s.textContent !== t) s.textContent = t;
  chipEl.setAttribute('aria-label', t + '. Open the order panel');
  chipEl.dataset.pnl = c.li && c.li.pnl > 0 ? 'up' : c.li && c.li.pnl < 0 ? 'down' : '';   // white text on the red chip; no global .up/.down colour
}

// ------------------------------------------------------------------------------------------------ open / close
let tmr = 0;
function openPanel(pre) {
  pre = pre || {};
  if (!el) build();
  const was = open; open = true; prefs.open = true; scLatch = true;
  if (pre.tab || pre.side || pre.price != null || pre.type) { prefs.tab = pre.tab && pre.tab !== 'scalp' ? pre.tab : pre.price != null || pre.type ? 'order' : prefs.tab; prefs.min = false; }
  if (pre.side) F.side = pre.side === 'sell' ? 'sell' : 'buy';
  if (pre.type) F.type = pre.type;
  if (pre.price != null && Number.isFinite(+pre.price)) { F.type = pre.type || 'limit'; const c = ctx(); F.price = fmtIn(c, roundTick(+pre.price, c.tick)); F.priceKey = c.sym + '|' + F.type + '|' + F.side; }
  savePrefs();
  el.hidden = false; viewSig = ''; footSig = '';
  update(); layout(); requestAnimationFrame(() => { layout(); });
  if (!tmr) tmr = setInterval(() => { if ((open || scVis()) && !document.hidden) update(); }, 250);
  if (!was) { const t = el.querySelector('.stkop-tabs .on'); if (t && !isPhone()) try { t.focus({ preventScroll: true }); } catch (e) {} }
  if (pre.tab === 'scalp') setScalp(true);
  if (pre.focus && prefs.tab === 'order') setTimeout(() => { const f = el.querySelector('[data-f=price]:not([hidden]), [data-k=confirm]'); if (f) f.focus(); }, 30);
  updateTradeBtn();
}
function close() {
  if (!el) return;
  open = false; prefs.open = false; savePrefs();
  const b = window.__stkBookPanel; if (b && b.embedded) b.unembed();
  el.hidden = true; viewSig = ''; stopQuote(); if (P && P.setPreview) P.setPreview('panel', '', []);
  document.documentElement.classList.remove('stkop-sheet');
  applyDock();
  if (tmr && !scVis()) { clearInterval(tmr); tmr = 0; }
  update(); updateTradeBtn();
}
function updateTradeBtn() {
  if (P && P.tradeUi) P.tradeUi(open);   // trading UI (one-click box, paper strip) shows only while this panel is open
  const b = document.getElementById('stkc-paper-btn'); if (b && !b.hasAttribute('aria-haspopup')) b.setAttribute('aria-pressed', String(open));
  for (const r of document.querySelectorAll('.stkop-railbtn')) { r.classList.toggle('on', open); r.setAttribute('aria-pressed', String(open)); }
}
// chip refresh while the panel is closed (live only): once a second
setInterval(() => { if (!open && P && P.live && !document.hidden) update(); }, 1000);

export function mountOrderPanel(paperApi) {
  if (P) return api;
  P = paperApi; loadPrefs(); build();
  if (prefs.open) openPanel();
  window.__stkOrderPanel = api;
  return api;
}
const api = {
  get scalpEl() { return scEl; },
  open: openPanel, close, toggle: () => (open ? close() : openPanel()), update,
  get isOpen() { return open; }, get scalpOn() { return scVis(); }, setScalp, get prefs() { return prefs; }, get form() { return F; }, setTab: (t) => { if (!open) openPanel({ tab: t }); else setTab(t); }, setMode,
  reloadPrefs: () => { loadPrefs(); if (open) { viewSig = ''; layout(); update(); } }
};
