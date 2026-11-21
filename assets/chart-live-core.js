// TradeZoro — LIVE broker orders from ZoroCharts: pure logic (ES module, no DOM, no network). Every signed-in member (21 Nov 2026).
// Used by the browser (assets/chart-live.js) AND the server (functions/connect/finatic/order.js), so the symbol mapping and the
// flatten plan are the same code on both sides. Unit tests: tests/finatic/chart-live.test.mjs.
//
// NO LIMITS (Owner decision 21 Nov 2026, "No limits from our end"): TradeZoro no longer restricts WHAT or HOW MUCH is traded. There is
// no contract whitelist, no size cap, no exposure cap and no orders-per-minute cap; the member's broker accepts or rejects (its message
// is shown). What stays are the safety switches (kill switch, per-member block, Enable live trading, audit, idempotency, 'unknown').
//
// Symbols: a futures chart (any root, any form: CME_MINI:NQ1!, futures:CL1!, rithmic:MNQ1!, GC1!) maps to a contract month, written
// root + month + one-digit year (NQZ6, CLF7), the form the broker test accepted (MESZ6). CME equity-index roots use the quarterly
// rule below (rolled 8 days before the third-Friday expiry); every other root uses the front contract from the symbol-info feed
// (`fronts`, see frontsOf). If the account already holds a position in that root, that contract is used instead (so a flatten / add
// never lands in a different month). A stock chart (stocks:NASDAQ:AAPL, idx:SPY) maps to the plain ticker as an equity order.
// Tick and point value: the exchange contract specs below when known; otherwise 0.01 / 1 (the broker rejects an off-tick price).
// Education only. Not financial advice.

// futures specs (tick, point value): the exchange contract specs, same table as assets/paper-engine.js FUTURES
export const ROOTS = {
  NQ: { pv: 20, tick: 0.25 }, MNQ: { pv: 2, tick: 0.25 }, ES: { pv: 50, tick: 0.25 }, MES: { pv: 5, tick: 0.25 }, YM: { pv: 5, tick: 1 }, MYM: { pv: 0.5, tick: 1 },
  RTY: { pv: 50, tick: 0.1 }, M2K: { pv: 5, tick: 0.1 }, GC: { pv: 100, tick: 0.1 }, MGC: { pv: 10, tick: 0.1 }, SI: { pv: 5000, tick: 0.005 }, SIL: { pv: 1000, tick: 0.005 },
  CL: { pv: 1000, tick: 0.01 }, MCL: { pv: 100, tick: 0.01 }, NG: { pv: 10000, tick: 0.001 }, HG: { pv: 25000, tick: 0.0005 }, MHG: { pv: 2500, tick: 0.0005 },
  ZN: { pv: 1000, tick: 0.015625 }, ZB: { pv: 1000, tick: 0.03125 }, '6E': { pv: 125000, tick: 0.00005 }
};
const QUARTERLY = new Set(['NQ', 'MNQ', 'ES', 'MES', 'YM', 'MYM', 'RTY', 'M2K']);   // CME equity-index: H M U Z, third Friday
const FRONT_KEY = { MNQ: 'NQ', MES: 'ES', MYM: 'YM', M2K: 'RTY', MGC: 'GC', SIL: 'SI', MCL: 'CL', MHG: 'HG' };   // micro -> its mini's calendar
const MONTHS = [[3, 'H'], [6, 'M'], [9, 'U'], [12, 'Z']];
const FUT_PREFIX = /^(futures|rithmic|cme|cme_mini|cbot|cbot_mini|comex|comex_mini|nymex|nymex_mini)$/i;
const EQ_PREFIX = /^(stocks|idx)$/i;
const FUT_CODE = /^([A-Z0-9]{1,4}?)([FGHJKMNQUVXZ])(\d{1,2})$/;     // NQZ6, CLF27, 6EZ6
const EQ_SYM = /^[A-Z][A-Z0-9.\-]{0,9}$/;                         // AAPL, BRK.B
const WORKING = /^(CREATED|SUBMITTED|RECEIVED|NEW|PARTIALLY_FILLED|PENDING_CANCEL|PENDING|OPEN|WORKING|ACCEPTED|PENDING_NEW|PENDING_REPLACE)$/;
export const ROLL_DAYS = 8;
export const DUP_MS = 500;   // double-click guard: the same order again within 500 ms is ignored (chart-live.js)

// what a chart symbol trades: { asset:'future', root } | { asset:'equity', code } | null (crypto, forex, unknown)
export function instrumentOf(sym) {
  const raw = String(sym || '').trim(), m = /^([a-z0-9_]+):(.+)$/i.exec(raw);
  const pre = m ? m[1] : '', rest = (m ? m[2] : raw).toUpperCase();
  if (EQ_PREFIX.test(pre)) { const t = rest.split(':').pop(); return EQ_SYM.test(t) ? { asset: 'equity', code: t } : null; }
  if (pre && !FUT_PREFIX.test(pre)) return null;
  let f = /^([A-Z0-9]{1,4}?)[12]!$/.exec(rest);
  if (f && (pre || ROOTS[f[1]])) return { asset: 'future', root: f[1] };
  f = /^([A-Z0-9]{1,4}?)[FGHJKMNQUVXZ](\d|\d\d|\d{4})$/.exec(rest);
  if (f && (pre || ROOTS[f[1]])) return { asset: 'future', root: f[1] };
  return null;
}
// "CME_MINI:NQ1!", "futures:CL1!", "NQ1!" -> "NQ" / "CL" ; not futures -> ''
export function chartRoot(sym) { const i = instrumentOf(sym); return i && i.asset === 'future' ? i.root : ''; }
// third Friday of month m (1-12) in year y, 00:00 UTC
export function thirdFriday(y, m) {
  const d = new Date(Date.UTC(y, m - 1, 1)); const dow = d.getUTCDay();
  return Date.UTC(y, m - 1, 1 + ((5 - dow + 7) % 7) + 14);
}
// quarterly contracts still trading at `now`, nearest first (equity-index roots only): [{ code, month, year, expiry, rollAt }]
export function liveContracts(root, now, n = 2) {
  if (!QUARTERLY.has(root)) return [];
  const out = []; const y0 = new Date(now).getUTCFullYear();
  for (let y = y0; y <= y0 + 2 && out.length < n; y++) for (const [m, L] of MONTHS) {
    const expiry = thirdFriday(y, m) + 14.5 * 3600000;    // CME equity-index last trade 09:30 ET on the third Friday (~13:30-14:30 UTC)
    if (expiry <= now) continue;
    out.push({ code: root + L + (y % 10), month: m, year: y, expiry, rollAt: thirdFriday(y, m) - ROLL_DAYS * 864e5 });
    if (out.length >= n) break;
  }
  return out;
}
// symbol-info feed (chart-symbol-info.js getInfo().syms) -> { NQ: 'NQZ6', CL: 'CLF7', ... } (its front contract, short form)
export function frontsOf(syms) {
  const out = {};
  for (const k of Object.keys(syms || {})) { const c = shortCode(syms[k] && syms[k].contract); if (c && c.startsWith(k)) out[k] = c; }
  return out;
}
// front month: equity-index roots by the quarterly rule (the nearest unless inside its roll window, then the next one); other roots
// from `fronts` (the micro uses its mini's month). -> { code } | null when no month is known
export function frontMonth(root, now, fronts) {
  if (QUARTERLY.has(root)) {
    const c = liveContracts(root, now, 2); if (!c.length) return null;
    return now >= c[0].rollAt && c[1] ? c[1] : c[0];
  }
  const f = fronts && fronts[FRONT_KEY[root] || root]; if (!f) return null;
  const m = FUT_CODE.exec(f); return m ? { code: root + m[2] + m[3] } : null;
}
// "NQZ2026" / "NQZ26" / "nqz6" -> "NQZ6" ; '' when not a contract code
function shortCode(s) {
  const m = /^([A-Z0-9]{1,4}?)([FGHJKMNQUVXZ])(\d{4}|\d{1,2})$/.exec(String(s || '').toUpperCase().trim());
  return m ? m[1] + m[2] + m[3].slice(-1) : '';
}
// what the server sends on: a well-formed contract code (future) or ticker (equity). The broker decides whether it trades it.
export function validContract(code, now, asset = 'future') {
  const s = String(code || '').toUpperCase();
  return asset === 'equity' ? EQ_SYM.test(s) : FUT_CODE.test(s);
}
// "MNQZ6" -> "MNQ" (a known root wins, so MNQZ6 is never "M" + ...); not a contract code -> ''
export const rootOfCode = (code) => { const m = FUT_CODE.exec(String(code || '').toUpperCase()); return m ? m[1] : ''; };
// tick / point value of a contract code or ticker (unknown -> 0.01 / 1)
export const tickOfCode = (code) => (ROOTS[rootOfCode(code)] || {}).tick || 0.01;
export const pvOfCode = (code) => (ROOTS[rootOfCode(code)] || {}).pv || (rootOfCode(code) ? 0 : 1);
const decOf = (t) => { const s = String(t); if (/e-/.test(s)) return Number(s.split('e-')[1]); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };
// a chart symbol for a contract / ticker (the dock's Close button): NQZ6 -> 'NQ1!', AAPL -> 'stocks:AAPL'
// asset class of a code the chart sends: a contract month = future, else equity.
// shortcut: decided from the code's shape; a stock ticker that looks like a contract month (root + month letter + digit) would be read as a future.
export const assetOf = (code) => (rootOfCode(code) ? 'future' : 'equity');
export const chartSymOf = (code) => (rootOfCode(code) ? rootOfCode(code) + '1!' : 'stocks:' + code);

// ---- reading the broker's (normalised) records ---------------------------------------------------------------------------
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
function symsOf(o) {
  const out = [], add = (v) => { if (v) out.push(String(v).toUpperCase()); };
  if (!o) return out;
  add(o.securityId); add(o.symbol); add(o.brokerProvidedSymbol); add(o.contractCode);
  const ins = o.instrument || {}; add(ins.displaySymbol); add(ins.providerSymbol); add(ins.future && ins.future.contractCode);
  return out;
}
// a record's contract in our short form (NQZ6 / NQZ26 / NQZ2026 / "NQZ6.CME" -> NQZ6; CLF27 -> CLF7), or an equity's ticker (AAPL), else ''
const isFutRec = (o) => /futur/i.test(String((o && (o.assetType || o.assetClass || o.securityType || (o.instrument && o.instrument.assetType))) || ''));
export function contractOf(rec) {
  const syms = symsOf(rec);
  for (const s of syms) {
    const m = /^([A-Z0-9]{1,4}?)([FGHJKMNQUVXZ])(\d{4}|\d{1,2})(?![A-Z0-9])/.exec(s.replace(/^[^:]+:/, ''));
    if (m) return m[1] + m[2] + m[3].slice(-1);
  }
  if (!isFutRec(rec)) for (const s of syms) { const t = s.replace(/^[^:]+:/, ''); if (EQ_SYM.test(t)) return t; }
  return '';
}
// does a broker record belong to `code`? A futures code (NQZ6) matches by contractOf; anything else is a MetaTrader broker symbol
// (NDX100, US100.cash, EURUSD.m) and matches one of the record's symbol fields exactly (case-insensitive).
export function matches(rec, code) {
  const c = String(code || '').toUpperCase(); if (!c) return false;
  if (FUT_CODE.test(c) && contractOf(rec) === c) return true;   // exact broker symbol too: DJ30 looks like a futures code but is not one
  return symsOf(rec).some((s) => s === c || s.replace(/^[^:]+:/, '') === c);
}
// signed net position (contracts) for one contract, from Finatic positions (quantity may be signed, or side=SHORT with a positive qty)
export function netPosition(positions, code) {
  let q = 0, avgN = 0, avgD = 0, upl = null, updated = '';
  for (const p of Array.isArray(positions) ? positions : []) {
    if (!p || String(p.status || 'OPEN').toUpperCase() === 'CLOSED') continue;
    if (!matches(p, code)) continue;
    let n = num(p.quantity != null ? p.quantity : p.units);
    if (String(p.side || '').toUpperCase() === 'SHORT' && n > 0) n = -n;
    if (!n) continue;
    q += n;
    const avg = num(n > 0 ? (p.averageBuyPrice || p.averagePrice || p.avgPrice) : (p.averageSellPrice || p.averagePrice || p.avgPrice)) || (num(p.costBasis) && Math.abs(num(p.costBasis) / n)) || 0;
    if (avg) { avgN += avg * Math.abs(n); avgD += Math.abs(n); }
    if (p.unrealizedProfitLoss != null && p.unrealizedProfitLoss !== '') upl = (upl || 0) + num(p.unrealizedProfitLoss);
    const u = p.positionUpdatedAt || p.snapshotDate || ''; if (u > updated) updated = u;
  }
  return { qty: q, avg: avgD ? avgN / avgD : null, upl, updated };
}
// the contract of an open position in this root (first non-zero), '' when flat
export function heldContract(positions, root) {
  const seen = new Set();
  for (const p of Array.isArray(positions) ? positions : []) { const c = contractOf(p); if (c && rootOfCode(c) === root) seen.add(c); }
  for (const c of seen) if (netPosition(positions, c).qty) return c;
  return '';
}
// what to trade for a chart: the held position's contract, else the front month (futures); the ticker (equities). null = can't map.
// -> { root, code, front, held, pv, tick, asset }
export function contractFor(sym, positions, now, fronts) {
  const ins = instrumentOf(sym); if (!ins) return null;
  if (ins.asset === 'equity') return { root: ins.code, code: ins.code, front: ins.code, held: false, pv: 1, tick: 0.01, asset: 'equity' };
  const root = ins.root, fm = frontMonth(root, now, fronts), held = heldContract(positions, root), sp = ROOTS[root] || {};
  if (!fm && !held) return null;   // an open position's contract is enough to manage / flatten it
  return { root, code: held || fm.code, front: fm ? fm.code : held, held: !!held && !!fm && held !== fm.code, pv: sp.pv || 0, tick: sp.tick || 0.01, asset: 'future' };
}
// working (not final) orders for a contract -> [{ id, side, qty, type, price, status }]
export function workingOrders(orders, code) {
  const out = [];
  for (const o of Array.isArray(orders) ? orders : []) {
    if (!o || !WORKING.test(String(o.status || '').toUpperCase())) continue;
    const leg = (o.legs || [])[0] || {};
    if (!matches(leg, code) && !matches(o, code)) continue;
    const qty = num(leg.remainingQuantity != null && leg.remainingQuantity !== '' ? leg.remainingQuantity : leg.quantity != null ? leg.quantity : o.orderQty);
    const type = String(o.orderType || leg.orderType || '').toLowerCase();
    const price = num(leg.limitPrice != null ? leg.limitPrice : o.limitPrice != null ? o.limitPrice : o.price) || num(leg.stopPrice != null ? leg.stopPrice : o.stopPrice) || null;
    out.push({ id: String(o.orderId || o.id || ''), side: String(leg.side || o.side || o.action || '').toLowerCase() === 'sell' ? 'sell' : 'buy', qty, type, price, status: String(o.status || '').toUpperCase(), cancelling: /PENDING_CANCEL/i.test(o.status || '') });
  }
  return out.filter((o) => o.id);
}
// ---- building commands ---------------------------------------------------------------------------------------------------
export const roundTick = (p, tick) => Math.round(p / tick) * tick;
// panel / ladder order -> body for POST /connect/finatic/order. -> { body } | { error }
// No size or symbol limits (Owner 21 Nov): qty = a positive whole number; the broker applies its own minimum, step and limits.
export function buildPlace({ code, side, qty, type, price, stopPrice, limitPrice, sl, tp, last, asset = 'future', tick: tk }, now) {
  if (!validContract(code, now, asset)) return { error: 'No live symbol for this chart.' };
  if (side !== 'buy' && side !== 'sell') return { error: 'Pick Buy or Sell.' };
  if (!Number.isInteger(qty) || qty < 1) return { error: 'Quantity must be a whole number of 1 or more.' };
  if (!['market', 'limit', 'stop', 'stop_limit'].includes(type)) return { error: 'Market, limit or stop only.' };
  const body = { op: 'place', symbol: code, side, qty, type, assetType: asset, timeInForce: 'day' };
  const tick = tk > 0 ? tk : tickOfCode(code), dec = Math.max(2, decOf(tick)), r = (v) => Number(roundTick(Number(v), tick).toFixed(dec));
  if (type === 'limit' || type === 'stop_limit') { const lp = type === 'limit' ? price : limitPrice; if (!(Number(lp) > 0)) return { error: 'Enter a limit price.' }; body.limitPrice = r(lp); }
  if (type === 'stop' || type === 'stop_limit') { const sp = type === 'stop' ? price : stopPrice; if (!(Number(sp) > 0)) return { error: 'Enter a stop price.' }; body.stopPrice = r(sp); }
  if (sl != null || tp != null) {   // stop loss / take profit: market entries only (placed by the server after the fill)
    if (type !== 'market') return { error: 'Stop loss and take profit go with market orders only.' };
    const bc = bracketCheck({ side, ref: last, sl, tp, code }); if (bc.error) return { error: bc.error };
    body.bracket = { sl: bc.sl, tp: bc.tp };
  }
  return { body };
}
// drag / edit one working order: a limit moves its limit price, a stop its stop price (code = the contract, sent so the server can
// match a stop loss / take profit of a bracket group)
export function buildModify({ id, price, code, type = 'limit' }) {
  if (!id) return { error: 'Order missing.' };
  const tick = tickOfCode(code);
  if (!(Number(price) > 0)) return { error: 'Price invalid.' };
  const p = Number(roundTick(Number(price), tick).toFixed(Math.max(2, decOf(tick))));
  if (type === 'stop') return { body: { op: 'modify', orderId: id, type: 'stop', stopPrice: p, symbol: code } };
  if (type !== 'limit') return { error: 'Only limit and stop orders can be moved.' };
  return { body: { op: 'modify', orderId: id, type: 'limit', limitPrice: p, symbol: code } };
}
// DOM ladder click: ALWAYS a limit at the clicked price (never a market order from a misclick). A click at / through the touch is
// a marketable limit; the confirm says so. -> { side, type:'limit', price, marketable } | null
export function ladderOrder(cell, price, bid, ask) {
  if ((cell !== 'bid' && cell !== 'ask') || !(price > 0)) return null;
  const side = cell === 'bid' ? 'buy' : 'sell';
  const marketable = side === 'buy' ? (ask > 0 && price >= ask) : (bid > 0 && price <= bid);
  return { side, type: 'limit', price, marketable };
}
// limits and stops must be near the market (fat-finger band): 2% of the last price
export function priceBandError(price, last, pct = 0.02) {
  if (!(last > 0) || !(price > 0)) return null;
  return Math.abs(price - last) / last > pct ? 'Price is more than ' + Math.round(pct * 100) + '% away from the market.' : null;
}
// flatten plan from a FRESH read: cancel every working order of the contract, then close the net position at market
// (no size cap since 21 Nov: any position is closed in one market order; the broker splits or rejects as it does)
export function flattenPlan(pos, working) {
  const cancel = (working || []).filter((o) => !o.cancelling).map((o) => o.id);
  if (!pos) return { cancel, close: null };
  return { cancel, close: { side: pos > 0 ? 'sell' : 'buy', qty: Math.abs(pos) } };
}
// deterministic key for one flatten of one position snapshot: a double tap / second tab maps to the same key (deduped server-side)
export function flattenKey(account, code, qty, stamp) {
  const s = 'flat|' + account + '|' + code + '|' + qty + '|' + (stamp || '');
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 ^ c, 2246822519) >>> 0; }
  return 'fl-' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + '-' + code.toLowerCase();
}
export const IDEM = /^[A-Za-z0-9-]{16,64}$/;
// Reads gate new orders: a read must have STARTED after the last write and be no older than maxAge; an unknown write result blocks.
export function readsOk({ lastOkStart, lastWriteAt, unknown, now, maxAge = 20000 }) {
  if (unknown) return { ok: false, why: 'The last order result is unknown. Checking the broker…' };
  if (!lastOkStart) return { ok: false, why: 'Reading positions and orders…' };
  if (lastWriteAt && lastOkStart <= lastWriteAt) return { ok: false, why: 'Waiting for the broker to confirm the last order…' };
  if (now - lastOkStart > maxAge) return { ok: false, why: 'Positions and orders could not be read. New orders are blocked.' };
  return { ok: true, why: '' };
}
// ---- speed (Owner order 2026-11-16) --------------------------------------------------------------------------------------
// Server-Timing header -> { name: ms }  ("fin;dur=58, total;dur=71, placement;desc=\"remote-IAD\"" -> { fin: 58, total: 71, placement: 'remote-IAD' })
export function parseTiming(h) {
  const out = {};
  for (const part of String(h || '').split(',')) {
    const m = /^\s*([A-Za-z0-9_-]+)\s*(?:;(.*))?$/.exec(part); if (!m) continue;
    const d = /dur=([\d.]+)/.exec(m[2] || ''), s = /desc="?([^";]*)"?/.exec(m[2] || '');
    out[m[1]] = d ? Math.round(Number(d[1])) : s ? s[1] : true;
  }
  return out;
}
// footer line for the last write: "Order sent in 182 ms (broker 61 ms)" ; '' when nothing measured
export function rttText(t) {
  if (!t || !(t.ms >= 0)) return '';
  const what = t.op === 'cancel' ? 'Cancel' : t.op === 'modify' ? 'Move' : t.op === 'flatten' ? 'Flatten' : 'Order';
  const fin = t.server && Number.isFinite(t.server.fin) ? ' (broker ' + t.server.fin + ' ms)' : '';
  return what + (t.ok ? ' sent in ' : ' answered in ') + Math.round(t.ms) + ' ms' + fin + '.';
}
// after a write: read again quickly so the fill / working order shows (then the normal 10 s poll)
export const FAST_READS_MS = [250, 900, 2000, 4000];
// a "sending" line drawn the moment the order is confirmed (limit price, or the last price for a market order); removed on the answer
export function pendingLine(body, last) {
  const price = body.type === 'limit' ? Number(body.limitPrice) : /stop/.test(body.type) ? Number(body.stopPrice) : Number(last);
  if (!(price > 0)) return null;
  return { id: 'P' + body.idemKey, kind: 'ord', live: true, pending: true, code: body.symbol, price, side: body.side, type: body.type, qty: body.qty };
}

// ---- account identity, balances, labels (Owner orders 2026-11-16 "account number is wrong", 2026-11-19 "show the account NAME") --
// Finatic's v1 account record (LegacyBrokerAccount in its OpenAPI) carries its own UUID (accountId / id) plus the broker's fields
// accountNumber and accountName. For Tradovate, accountNumber is the broker's internal numeric id ("71012029") and accountName is
// the name Tradovate shows the trader ("FNFTFAGAURAVSINGH27021"). So the NAME is shown (Owner 19 Nov), read in this order:
//   accountName / account_name / accountDisplayName / account_display_name / displayName / display_name / nickname / name
// and the number (accountNumber / account_number / brokerAccountNumber) only as a small second line when it differs.
// A generic name ("Individual", "Margin", ...) is not an identity: the number wins over it. No usable name -> the number, as before.
// brokerAccountId / broker_account_id is never shown on its own (the "…2029" bug); it only matches a grant.
const UUIDISH = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const NUM_KEYS = ['accountNumber', 'account_number', 'brokerAccountNumber', 'broker_account_number'];
const NAME_KEYS = ['accountName', 'account_name', 'accountDisplayName', 'account_display_name', 'displayName', 'display_name', 'nickname', 'name'];
const ID_KEYS = ['brokerAccountId', 'broker_account_id'];
const GENERIC = /^(individual|joint|ira|roth( ira)?|margin|cash|default|primary|main|account|trading|futures|brokerage|live|demo|sim|simulated|simulation|paper)$/i;
const str = (v) => (v == null || typeof v === 'object' ? '' : String(v).trim());
export function brokerNice(b) {
  const s = str(b) || 'Broker';
  const fix = { metatrader_4: 'MetaTrader 4', metatrader_5: 'MetaTrader 5', metatrader4: 'MetaTrader 4', metatrader5: 'MetaTrader 5', mt: 'MetaTrader', ibkr: 'IBKR', interactivebrokers: 'Interactive Brokers', tastytrade: 'tastytrade', ninjatrader: 'NinjaTrader', ninja_trader: 'NinjaTrader', tradestation: 'TradeStation', topstepx: 'TopstepX', projectx: 'ProjectX', tasty_trade: 'tastytrade' };
  if (/^mt[_ ]?([45])$/i.test(s)) return 'MetaTrader ' + s.slice(-1);
  const k = s.toLowerCase().replace(/[^a-z0-9_]/g, '');
  return fix[k] || fix[k.replace(/_/g, '')] || s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
const okVal = (ownId) => (v) => v && v.length <= 64 && !UUIDISH.test(v) && v !== ownId;
// -> { name, number }: the broker's account name ('' if none usable) and its account number ('' if none / same as the name)
export function acctNames(x, ownId) {
  if (!x) return { name: '', number: '' };
  const ok = okVal(ownId);
  const name = NAME_KEYS.map((k) => str(x[k])).find((v) => ok(v) && !GENERIC.test(v)) || '';
  const number = NUM_KEYS.map((k) => str(x[k])).find(ok) || '';
  return { name, number: number && number !== name ? number : '' };
}
// the account identity to show: the broker's account NAME, else its number ('' when Finatic gave neither); never a UUID or our id
export function acctNumber(x, ownId) {
  if (!x) return '';
  const n = acctNames(x, ownId);
  if (n.name) return n.name;
  const ok = okVal(ownId), internal = ID_KEYS.map((k) => str(x[k])).find(Boolean) || '';
  const cands = [...NUM_KEYS, ...NAME_KEYS].map((k) => str(x[k])).filter(ok);
  return cands.find((v) => v !== internal) || cands[0] || '';   // never the internal id alone (the "…2029" bug)
}
// one Finatic account record -> what the menu needs. number = the identity shown (the NAME); alt = the account number when it
// differs (small second line); text = "Tradovate FNFTFAGAURAVSINGH27021"
export function acctInfo(x) {
  const id = str(x && (x.accountId || x.id));
  const broker = brokerNice(x && (x.brokerName || x.broker_name || x.brokerDisplayName || x.brokerId || x.broker_id || x.institutionName || x.broker));
  const number = acctNumber(x, id);
  const nn = acctNames(x, id), alt = nn.name && nn.number && nn.number !== number ? nn.number : '';
  const alnum = number.replace(/[^A-Za-z0-9]/g, '');
  return { id, broker, number, alt, last4: alnum.slice(-4), text: number ? broker + ' ' + number : broker,
    brokerId: str(x && (x.brokerId || x.broker_id)).toLowerCase(), brokerAccountId: str(x && (x.brokerAccountId || x.broker_account_id)),
    mt: mtPlatform(x),
    grantId: str(x && (x.grantId || x.grant_id || x.accountGrantId || x.account_grant_id)), currency: str(x && (x.currencyCode || x.currency_code || x.currency)).toUpperCase(), sync: syncInfo(x) };
}
// what every live surface shows for an account: the Owner's own label (Edit details) wins, else the broker's account name.
// short = tight spots (phone badge, chip, order panel): "Apex eval 1" | "FNFTFAGAURAVSINGH27021"; badge = the LIVE badge, header
// and toasts: "Apex eval 1" | "Tradovate FNFTFAGAURAVSINGH27021"; full = titles / aria: "Apex eval 1 · Tradovate FNFT…"
export function acctShow(a, meta) {
  const m = cleanMeta(meta);
  return { short: m.label || a.number || a.broker, badge: m.label || a.text, full: m.label ? m.label + ' · ' + a.text : a.text };
}
// back-compat wrapper (old callers pass { broker, number|name, id })
export function acctLabel(a) {
  const i = acctInfo({ brokerName: a.broker || a.brokerName || a.brokerId, accountNumber: a.number || a.accountNumber, accountName: a.name || a.accountName, brokerAccountId: a.brokerAccountId, id: a.id });
  return { broker: i.broker, last4: i.last4, text: i.text, number: i.number };
}
// The grant that gave us this account (Disconnect revokes it). Exact link first, then the broker account id, then "the only active
// grant for this broker", then "the only active grant". '' when it can't be told apart (the UI then says so instead of guessing).
export function grantFor(acct, grants) {
  const live = (Array.isArray(grants) ? grants : []).filter((g) => g && g.id && !g.revokedAt && !/revoked/i.test(String(g.status || '')));
  if (acct.grantId && live.some((g) => g.id === acct.grantId)) return acct.grantId;
  const byAcct = live.filter((g) => acct.brokerAccountId && String(g.brokerAccountId || '') === acct.brokerAccountId);
  if (byAcct.length === 1) return byAcct[0].id;
  const bk = (acct.brokerId || acct.broker).toLowerCase().replace(/[^a-z]/g, '');
  const byBroker = live.filter((g) => String(g.brokerId || '').toLowerCase().replace(/[^a-z]/g, '') === bk);
  if (byBroker.length === 1) return byBroker[0].id;
  return live.length === 1 ? live[0].id : '';
}
// Balances (Owner bug 2026-11-19 "the balance is not updated"): the broker link's balances endpoint is a LIST of balance SNAPSHOTS
// (LegacyBrokerBalance: one row per sync and balance kind, each stamped balanceCreatedAt "as-of" + lastUpdated), not one live row.
// The old code took the first row that had a value, i.e. whichever snapshot the list happened to start with, and never looked at its
// date. Now: only rows of the account's currency, the NEWEST snapshot wins (by its own timestamp; undated rows lose to dated ones),
// and inside that snapshot the field order is:
//   1 net liquidation / account value / equity (includes realised and open P&L as of the snapshot)   kind 'netliq'
//   2 total cash / cash / current balance                                                              kind 'cash'
//   3 available balance (last resort)                                                                  kind 'available'
// A cumulative "total realised" field is never added on top (its period is not stated, it would double count). What moves the
// figure between snapshots is liveBalance() below: the snapshot plus the realised P&L of the broker's own fills AFTER the snapshot.
// Values may be numbers or numeric strings. Returns { amount, currency, upl, kind, key, at (ms | null), realized (day field | null) }.
const NETLIQ_KEYS = ['netLiquidationValue', 'net_liquidation_value', 'netLiquidation', 'netLiq', 'accountValue', 'account_value', 'totalValue', 'total_value', 'equity', 'totalEquity'];
const CASH_KEYS = ['totalCashValue', 'total_cash_value', 'cashBalance', 'cash_balance', 'currentBalance', 'current_balance', 'balance'];
const AVAIL_KEYS = ['availableBalance', 'available_balance', 'availableToWithdraw'];
const RPL_KEYS = ['realizedPnlToday', 'dayRealizedPnl', 'todayRealizedPnl', 'dailyRealizedPnl'];   // explicitly today's only
const UPL_KEYS = ['unrealizedPnl', 'unrealized_pnl', 'unrealizedProfitLoss', 'unrealized_profit_loss', 'openPnl', 'openPnL', 'open_pnl', 'totalUnrealizedPnl', 'openTradeEquity', 'open_trade_equity'];
const TS_KEYS = ['lastUpdated', 'last_updated', 'updatedAt', 'updated_at', 'balanceUpdatedAt', 'asOf', 'as_of', 'balanceCreatedAt', 'balance_created_at', 'snapshotDate', 'createdAt', 'timestamp'];
const numOf = (v) => { if (v == null || v === '' || typeof v === 'boolean') return null; if (typeof v === 'object') v = v.amount != null ? v.amount : v.value; const n = Number(String(v).replace(/[,$\s]/g, '')); return Number.isFinite(n) ? n : null; };
const firstNum = (r, ks) => { for (const k of ks) { const n = numOf(r[k]); if (n != null) return [n, k]; } return null; };
// a record's own time in ms (newest of its stamps), null when it has none. Date-only strings count as that day 00:00 UTC.
export function stampOf(r) {
  let best = null;
  for (const k of TS_KEYS) { const v = r && r[k]; if (v == null || v === '') continue; const t = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(String(v)); if (Number.isFinite(t) && (best == null || t > best)) best = t; }
  return best;
}
export function balanceOf(rows, cur) {
  let list = (Array.isArray(rows) ? rows : rows && typeof rows === 'object' ? [rows] : []).filter((r) => r && typeof r === 'object');
  if (!list.length) return null;
  const want = str(cur).toUpperCase() || 'USD';
  const curOf = (r) => str(r.currencyCode || r.currency_code || r.currency).toUpperCase();
  if (list.some((r) => curOf(r) === want)) list = list.filter((r) => curOf(r) === want || !curOf(r));
  // newest snapshot first; undated rows keep their order behind the dated ones
  list = list.map((r, i) => ({ r, i, t: stampOf(r) })).sort((a, b) => (b.t != null) - (a.t != null) || (b.t || 0) - (a.t || 0) || a.i - b.i).map((x) => x.r);
  const out = (r, amount, kind, key, realized) => { const u = firstNum(r, UPL_KEYS); return { amount, currency: curOf(r) || want, upl: u ? u[0] : null, kind, key, at: stampOf(r), realized: realized == null ? null : realized }; };
  // the newest snapshot that carries any balance figure decides; an older snapshot never beats it
  for (const r of list) {
    const rp = (firstNum(r, RPL_KEYS) || [null])[0];
    const nl = firstNum(r, NETLIQ_KEYS); if (nl) return out(r, nl[0], 'netliq', nl[1], rp);
    const c = firstNum(r, CASH_KEYS); if (c) return out(r, c[0], 'cash', c[1], rp);
    const av = firstNum(r, AVAIL_KEYS); if (av) return out(r, av[0], 'available', av[1], rp);
  }
  return null;
}
// The figure to show. snap = balanceOf(); fills = the broker's fills (any day); positions = current positions.
// When the snapshot is dated and the broker filled orders AFTER it, the realised P&L of those fills (FIFO, net of their commission)
// is added, provided the account was flat in those contracts at the snapshot (else the cost of the carried position is unknown and
// the snapshot is shown as is, with its age). -> { amount, at, adjusted, fillsAfter, why }
export function liveBalance(snap, fills, positions) {
  if (!snap) return null;
  const base = { amount: snap.amount, at: snap.at, adjusted: false, fillsAfter: 0, why: '' };
  if (!(snap.at > 0)) return base;
  const after = (Array.isArray(fills) ? fills : []).filter((f) => { const t = fillTime(f); return t != null && t > snap.at; });
  if (!after.length) return base;
  const r = dayRealized(after, positions, snap.at + 1);
  if (!r.complete) return Object.assign(base, { fillsAfter: r.fills, why: r.why });
  // netliq at a flat snapshot = cash then; now = that + realised since (open P&L is shown separately as UP&L)
  return { amount: Math.round((snap.amount + r.value) * 100) / 100, at: snap.at, adjusted: true, fillsAfter: r.fills, why: '' };
}
// The broker link's own sync state for one account (GET /accounts?include_sync_status=true, Owner bug 21 Nov "updated 4 days ago"):
// -> { status: 'ok' | 'syncing' | 'failed' | '', at (ms of its last sync) | null, error }. Field names per the provider's schema
// (syncStatus, lastSyncedAt, syncError) plus snake_case and a nested syncStatus object; anything unknown -> ''.
export function syncInfo(x) {
  if (!x || typeof x !== 'object') return { status: '', at: null, error: '' };
  const o = x.syncStatus && typeof x.syncStatus === 'object' ? x.syncStatus : x.sync && typeof x.sync === 'object' ? x.sync : x;
  const raw = str(o.syncStatus || o.sync_status || (o !== x ? o.status : '')).toLowerCase();   // the account's own 'status' is not a sync state
  const err = str(o.syncError || o.sync_error || o.error).slice(0, 120);
  const at = stampOf({ updatedAt: o.lastSyncedAt || o.last_synced_at || o.balancesSyncedAt || o.lastSyncAt || x.lastSyncedAt || x.last_synced_at });
  const status = /fail|error|reauth|expired|revoked|disconnect/.test(raw) || err ? 'failed' : /sync|pending|progress|queued|running|started/.test(raw) && !/synced|succeeded/.test(raw) ? 'syncing' : raw ? 'ok' : '';
  return { status, at, error: err };
}
// what the balance line says under the figure: the snapshot's age, and when the broker link itself reports a failed sync, that instead
// (it is the reason the figure is old, and Reconnect fixes it)
export function balanceNote(snapAt, sync, now) {
  const age = ageText(snapAt, now);
  if (!age) return '';
  if (sync && sync.status === 'failed') return 'sync failed';   // short: it sits under the figure in an 11 px line
  return age;
}
// "updated 3 min ago" when the snapshot is older than `after` ms (default 2 min), else ''. Never "delayed" / "real-time".
export function ageText(at, now, after = 120000) {
  if (!(at > 0) || !(now > 0)) return '';
  const d = now - at; if (d < after) return '';
  const m = Math.floor(d / 60000);
  if (m < 60) return 'updated ' + m + ' min ago';
  const h = Math.floor(m / 60); if (h < 48) return 'updated ' + h + ' h ago';
  return 'updated ' + Math.floor(h / 24) + ' days ago';
}

// ---- today's realised P&L from the broker's fills (header strip RP&L for live accounts, 2026-11-19) ------------------------
// fills: FDXBrokerOrderFill rows { fillId, orderId, securityId, side, quantity, price, executedAt, commission }. Matched FIFO per
// contract (point value from ROOTS); commissions of today's fills are subtracted (net, like paper's day P&L). The position held at the
// start of the day is netNow - (today's signed fills): when it is not flat its cost is unknown, so the result is marked incomplete and
// the caller falls back to the broker's own realised figure. -> { value, fills, complete, why }
const fillTime = (f) => { for (const k of ['executedAt', 'executed_at', 'filledAt', 'fillTime', 'timestamp', 'time', 'createdAt']) { const v = f && f[k]; if (v != null && v !== '') { const t = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(String(v)); if (Number.isFinite(t)) return t; } } return null; };
export function dayRealized(fills, positions, dayStartMs) {
  const seen = new Set(), by = new Map();
  let fees = 0, n = 0, unknown = 0;
  for (const f of Array.isArray(fills) ? fills : []) {
    if (!f || typeof f !== 'object') continue;
    const id = String(f.fillId || f.id || f.executionId || '') || (String(f.orderId) + '|' + fillTime(f) + '|' + f.price + '|' + f.quantity);
    if (seen.has(id)) continue; seen.add(id);
    const t = fillTime(f); if (t == null) { unknown++; continue; }
    if (t < dayStartMs) continue;
    const code = contractOf(f), pv = pvOfCode(code);
    const q = Math.abs(num(f.quantity != null ? f.quantity : f.qty)), px = num(f.price != null ? f.price : f.fillPrice);
    if (!code || !pv || !q || !(px > 0)) { unknown++; continue; }
    const side = String(f.side || f.action || '').toLowerCase().startsWith('s') ? -1 : 1;
    if (!by.has(code)) by.set(code, []);
    by.get(code).push({ t, q: side * q, px, pv });
    fees += Math.abs(num(f.commission)); n++;
  }
  let value = 0, complete = unknown === 0;
  for (const [code, list] of by) {
    list.sort((a, b) => a.t - b.t);
    const today = list.reduce((s, x) => s + x.q, 0), start = netPosition(positions, code).qty - today;
    if (start) complete = false;   // carried in from an earlier day: its cost basis is not in today's fills
    const lots = [];   // open lots { q (signed), px }
    for (const x of list) {
      let q = x.q;
      while (q && lots.length && Math.sign(lots[0].q) !== Math.sign(q)) {
        const m = Math.min(Math.abs(q), Math.abs(lots[0].q));
        value += (x.px - lots[0].px) * m * Math.sign(lots[0].q) * x.pv;
        lots[0].q -= Math.sign(lots[0].q) * m; q -= Math.sign(q) * m;
        if (!lots[0].q) lots.shift();
      }
      if (q) lots.push({ q, px: x.px });
    }
  }
  value = Math.round((value - fees) * 100) / 100;
  return { value, fills: n, complete, why: complete ? '' : unknown ? 'Some fills could not be read.' : 'A position was carried in from an earlier day.' };
}
// broker's own realised P&L of positions closed / updated today (fallback when fills can't give it) -> number | null
export function positionsRealized(positions, dayStartMs) {
  let s = null;
  for (const p of Array.isArray(positions) ? positions : []) {
    const r = numOf(p && (p.realizedProfitLossWithCommission != null ? p.realizedProfitLossWithCommission : p.realizedProfitLoss)); if (r == null) continue;
    const t = stampOf({ updatedAt: p.positionClosedAt || p.positionUpdatedAt || p.snapshotDate }); if (t == null || t < dayStartMs) continue;
    s = (s || 0) + r;
  }
  return s == null ? null : Math.round(s * 100) / 100;
}
// open P&L of every open position: (last - avg) x qty x point value per contract; lastOf(root) gives the chart's last price.
// Falls back to the broker's per-position figure; null when a position can't be priced either way. -> { value, open }
export function openTotal(positions, lastOf) {
  const codes = new Set(); for (const p of Array.isArray(positions) ? positions : []) { const c = contractOf(p); if (c) codes.add(c); }
  let v = 0, open = 0, missing = false;
  for (const code of codes) {
    const n = netPosition(positions, code); if (!n.qty) continue; open++;
    const root = rootOfCode(code), last = lastOf && root ? lastOf(root) : undefined;   // equities: the broker's own open P&L
    const x = openPnl(n.qty, n.avg, Number.isFinite(last) ? last : null, pvOfCode(code), n.upl);
    if (x == null || !Number.isFinite(x)) missing = true; else v += x;
  }
  // positions in symbols we can't map count as missing
  for (const p of Array.isArray(positions) ? positions : []) if (p && !contractOf(p) && num(p.quantity != null ? p.quantity : p.units) && String(p.status || 'OPEN').toUpperCase() !== 'CLOSED') { open++; missing = true; }
  return { value: missing ? null : Math.round(v * 100) / 100, open };
}
// "$50,312.40" / "€1,200.00" / "-$12.50"; '' for nothing; sign option for P&L ("+$120.00")
export function fmtMoney(n, cur, sign) {
  if (n == null || !Number.isFinite(Number(n))) return '';
  const c = /^[A-Z]{3}$/.test(str(cur).toUpperCase()) ? str(cur).toUpperCase() : 'USD';
  let t; try { t = new Intl.NumberFormat('en-US', { style: 'currency', currency: c, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n)); } catch (e) { t = c + ' ' + Math.abs(n).toFixed(2); }
  return (n < 0 ? '-' : sign && n > 0 ? '+' : '') + t;
}
// ---- per-account notes the admin adds (pencil): label, prop firm, account type -------------------------------------------
export const FIRMS = ['Apex', 'Topstep', 'Tradeify', 'Take Profit Trader', 'My Funded Futures', 'Lucid', 'Bulenox', 'Alpha Futures', 'Elite Trader Funding', 'Earn2Trade', 'The Trading Pit', 'FundingPips', 'FTMO', 'Own account'];
export const TYPES = [['eval', 'Evaluation'], ['funded', 'Funded'], ['live', 'Live'], ['sim', 'Sim']];
const clip = (v, n) => str(v).replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').slice(0, n).trim();
// -> { label, firm, type } with every field cleaned ('' when empty); the same limits are in firestore.rules
export function cleanMeta(m) {
  const o = m && typeof m === 'object' ? m : {};
  const type = TYPES.some(([k]) => k === o.type) ? o.type : '';
  return { label: clip(o.label, 40), firm: clip(o.firm, 40), type };
}
export const typeName = (k) => { const t = TYPES.find(([x]) => x === k); return t ? t[1] : ''; };
// row / button wording: name = label or broker; full = "Apex eval 1 · Apex · Tradovate APEX-123456-01"
export function acctTitle(a, meta) {
  const m = cleanMeta(meta);
  const name = m.label || a.number || a.broker;   // the Owner's label, else the broker's account NAME (19 Nov), else the broker
  const full = [m.label, m.firm, a.text].filter(Boolean).join(' · ');
  return { name, full, firm: m.firm, type: typeName(m.type) };
}
// open P&L estimate from the chart's last price (contract spec point value), or the broker's figure when no price
export function openPnl(pos, avg, last, pv, brokerUpl) {
  if (pos && avg > 0 && last > 0 && pv > 0) return (last - avg) * pos * pv;   // MetaTrader: pv unknown -> the broker's figure
  return brokerUpl == null ? null : brokerUpl;
}

// ---- stop loss / take profit on live market entries (Owner order 2026-11-17) ----------------------------------------------
// The broker link has no native bracket / OCO order (its OCO / BRACKET classes are read-only labels), but it takes STOP orders
// (order type enum MARKET | LIMIT | STOP | STOP_LIMIT | TRAILING_STOP; what an account really takes is in its place schema,
// supportedOrderTypesByAssetClass). So a bracket is: the market entry, then after it fills a protective STOP (stop loss) and a LIMIT
// (take profit), both GTC, and when one fills the server cancels the other. The group lives server-side (Firestore brokerBrackets,
// one per account + contract) so the server only ever touches ids it recorded itself.
// order types an account's place schema allows for an asset class -> ['market', 'limit', 'stop', ...] | null (schema doesn't say)
export function orderTypesFor(schema, asset = 'future') {
  const norm = (a) => (Array.isArray(a) ? a.map((x) => String(x).toLowerCase().replace(/[^a-z]/g, '_')) : null);
  const seen = new Set();
  const walk = (o, d) => {
    if (!o || typeof o !== 'object' || d > 6 || seen.has(o)) return null; seen.add(o);
    const s = o.supportedOrderTypesByAssetClass || o.supported_order_types_by_asset_class;
    if (s && typeof s === 'object') {
      for (const k of Object.keys(s)) if (new RegExp('^' + asset + 's?$', 'i').test(k)) return norm(s[k]);
      return [];
    }
    for (const k of Object.keys(o)) { const r = walk(o[k], d + 1); if (r) return r; }
    return null;
  };
  const byClass = walk(schema, 0); if (byClass) return byClass;
  // fallback: a JSON-schema enum for orderType
  const en = (o, d) => { if (!o || typeof o !== 'object' || d > 8) return null; for (const k of Object.keys(o)) { if (/^order_?type$/i.test(k) && o[k] && Array.isArray(o[k].enum)) return norm(o[k].enum); const r = en(o[k], d + 1); if (r) return r; } return null; };
  return en(schema, 0);
}
export const stopsSupported = (schema) => { const t = orderTypesFor(schema); return !!t && t.includes('stop'); };
// one bracket group per account + contract (Firestore doc id)
export const groupId = (account, code) => String(account) + '_' + String(code).toUpperCase();
// FDX order status families
export const FILLED = /^(FILLED)$/;
export const FINAL_NOT_FILLED = /^(CANCELLED|CANCELED|REJECTED|EXPIRED|FAILED|REPLACED)$/;
export const isWorking = (status) => WORKING.test(String(status || '').toUpperCase());
// the broker's record for one order id (any status) -> { id, status, type, price, qty } | null
export function orderById(orders, id) {
  if (!id) return null;
  for (const o of Array.isArray(orders) ? orders : []) {
    if (!o || String(o.orderId || o.id || '') !== String(id)) continue;
    const leg = (o.legs || [])[0] || {};
    return { id: String(id), status: String(o.status || '').toUpperCase(), type: String(o.orderType || leg.orderType || '').toLowerCase(), qty: num(leg.quantity != null ? leg.quantity : o.orderQty), filled: num(leg.filledQuantity != null ? leg.filledQuantity : o.filledQuantity) };
  }
  return null;
}
// SL / TP for an entry: side 'buy' = long (SL below the reference, TP above), 'sell' = short. ref = last price (browser) or the
// fill price (server). Rounded to the tick; each leg within `pct` of the reference. -> { sl, tp } | { error }
export function bracketCheck({ side, ref, sl, tp, code, pct = 0.03 }) {
  const tick = tickOfCode(code), dec = Math.max(2, decOf(tick));
  const out = {};
  const r = (v) => (v == null || v === '' ? null : Number(roundTick(Number(v), tick).toFixed(dec)));
  out.sl = r(sl); out.tp = r(tp);
  if (out.sl == null && out.tp == null) return { error: 'Set a stop loss or a take profit.' };
  for (const k of ['sl', 'tp']) if (out[k] != null && !(out[k] > 0 && out[k] < 1e7)) return { error: (k === 'sl' ? 'Stop loss' : 'Take profit') + ' price is not valid.' };
  const long = side === 'buy';
  if (out.sl != null && out.tp != null && (long ? out.sl >= out.tp : out.sl <= out.tp)) return { error: long ? 'For a buy, the stop loss must be below the take profit.' : 'For a sell, the stop loss must be above the take profit.' };
  if (ref > 0) {
    if (out.sl != null && (long ? out.sl >= ref : out.sl <= ref)) return { error: 'The stop loss must be ' + (long ? 'below' : 'above') + ' the price (' + ref.toFixed(2) + ').' };
    if (out.tp != null && (long ? out.tp <= ref : out.tp >= ref)) return { error: 'The take profit must be ' + (long ? 'above' : 'below') + ' the price (' + ref.toFixed(2) + ').' };
    for (const k of ['sl', 'tp']) if (out[k] != null && Math.abs(out[k] - ref) / ref > pct) return { error: (k === 'sl' ? 'Stop loss' : 'Take profit') + ' is more than ' + Math.round(pct * 100) + '% away from the price.' };
  }
  return out;
}
// What the server's bracket sync should do now, from a fresh read. g = the server's group record. -> { act, ... }
//   wait      entry still working (or part-filled)            place  entry filled: place the children (qty, exitSide, ref = avg)
//   oco       one child filled: cancel the other (cancel[])   flatcheck  flat but children still working: cancel them (2nd read first)
//   resize    a child part-filled: shrink the other (id, qty) alarm  position open and no working stop loss (why)
//   drop      nothing left to manage (why)                    ok     all good
export function bracketPlan(g, positions, orders) {
  const P = netPosition(positions, g.code), pos = P.qty, long = g.side === 'buy';
  const rem = (o) => Math.max(0, o.qty - o.filled);
  if (g.state === 'pending') {
    const e = orderById(orders, g.entryId);
    if (e && e.status === 'PARTIALLY_FILLED') return { act: 'wait' };
    if (e && isWorking(e.status)) return { act: 'wait' };
    const filled = e ? FILLED.test(e.status) : (long ? pos > 0 : pos < 0);
    if (!filled) return e && FINAL_NOT_FILLED.test(e.status) ? { act: 'drop', why: 'The entry order was not filled.' } : { act: 'wait' };
    if (long ? pos <= 0 : pos >= 0) return { act: 'drop', why: 'The position was already closed.' };
    return { act: 'place', qty: Math.min(g.qty, Math.abs(pos)), exitSide: long ? 'sell' : 'buy', ref: P.avg || 0 };
  }
  const s = orderById(orders, g.slId), t = orderById(orders, g.tpId);
  const sW = !!(s && isWorking(s.status)), tW = !!(t && isWorking(t.status));
  if (s && FILLED.test(s.status)) return { act: 'oco', cancel: tW ? [g.tpId] : [], why: 'Stop loss filled.' };
  if (t && FILLED.test(t.status)) return { act: 'oco', cancel: sW ? [g.slId] : [], why: 'Take profit filled.' };
  if (!pos) return sW || tW ? { act: 'flatcheck', cancel: [sW ? g.slId : '', tW ? g.tpId : ''].filter(Boolean), why: 'The position was closed.' } : { act: 'drop', why: 'The position was closed.' };
  if (long ? pos < 0 : pos > 0) return { act: 'alarm', why: 'The position is now the other way round. Check your broker.' };
  if (g.sl != null && !sW) return { act: 'alarm', why: g.slId ? 'The stop loss is no longer working at the broker. The position has no stop.' : 'No stop loss is working. The position has no stop.' };
  for (const [o, id] of [[s, g.slId], [t, g.tpId]]) if (o && isWorking(o.status) && rem(o) > Math.abs(pos)) return { act: 'resize', id, qty: Math.abs(pos) };
  return { act: 'ok' };
}

// ---- MetaTrader 4 / 5 accounts (Owner order 2026-11-21, AUTO-MTHELP) -------------------------------------------------------
// MT accounts reach the broker link through the connector EA running in the member's own MetaTrader terminal (push agent). They
// trade CFD / forex symbols in LOTS, named by each broker (the Nasdaq 100 is NDX100, US100, NAS100, USTEC ...), so a chart symbol is
// mapped to the account's broker symbol: from the account's symbol list when the broker link gives one, else the member picks it
// once per chart symbol and it is remembered (chart-live.js). No TradeZoro size, symbol or rate limits (21 Nov; the broker applies its own),
// market / limit / stop only, no server stop loss / take profit, no flatten
// (a hedging account closes by ticket, which this route does not do yet). Prices on a futures chart are futures prices, not the
// CFD's, so a chart that is not the broker's own instrument sends MARKET orders only.
export const MT_SYM = /^[A-Za-z0-9][A-Za-z0-9._#+\-]{0,23}$/;
// 'MT4' | 'MT5' | '' for one account record (broker id / name, or a platform field the broker link adds)
export function mtPlatform(x) {
  if (!x || typeof x !== 'object') return '';
  const f = [x.brokerId, x.broker_id, x.brokerName, x.broker_name, x.brokerDisplayName, x.institutionName, x.broker, x.platform, x.mtPlatform, x.mt_platform].map(str).join(' ').toLowerCase();
  const m = /(?:metatrader|\bmt)[ _-]?([45])\b/.exec(f);
  return m ? 'MT' + m[1] : /metatrader/.test(f) ? 'MT5' : '';
}
// chart symbol -> what it is for MetaTrader: { key, label, cands, same }. key = the mapping key (one per instrument, so NQ / MNQ /
// NDX charts share it); cands = the usual broker names, most common first; same = the chart prices the broker instrument itself
// (forex / spot metal / crypto pair), so limit and stop prices from the chart are valid. null = not tradable on MetaTrader.
const MT_INDEX = {
  NDX: ['Nasdaq 100', ['NDX100', 'US100', 'NAS100', 'USTEC', 'NQ100', 'US100.cash', 'NAS100.cash']],
  SPX: ['S&P 500', ['US500', 'SPX500', 'SP500', 'US500.cash', 'SPX500.cash']],
  DJI: ['Dow Jones 30', ['US30', 'DJ30', 'WS30', 'US30.cash']],
  RUT: ['Russell 2000', ['US2000', 'RUSS2000', 'US2000.cash']],
  XAU: ['Gold', ['XAUUSD', 'GOLD']], XAG: ['Silver', ['XAGUSD', 'SILVER']], WTI: ['WTI crude oil', ['USOIL', 'WTI', 'XTIUSD', 'USOUSD', 'USOIL.cash']],
};
const MT_ROOT = { NQ: 'NDX', MNQ: 'NDX', NDX: 'NDX', NAS100: 'NDX', US100: 'NDX', NDX100: 'NDX', ES: 'SPX', MES: 'SPX', SPX: 'SPX', SPX500: 'SPX', US500: 'SPX', YM: 'DJI', MYM: 'DJI', DJI: 'DJI', US30: 'DJI', RTY: 'RUT', M2K: 'RUT', RUT: 'RUT', GC: 'XAU', MGC: 'XAU', SI: 'XAG', SIL: 'XAG', CL: 'WTI', MCL: 'WTI' };
const FX = /^(USD|EUR|GBP|JPY|CHF|CAD|AUD|NZD|XAU|XAG|SEK|NOK|DKK|SGD|HKD|MXN|ZAR|TRY|PLN|CNH)(USD|EUR|GBP|JPY|CHF|CAD|AUD|NZD|SEK|NOK|DKK|SGD|HKD|MXN|ZAR|TRY|PLN|CNH)$/;
const CRYPTO = /^(BTC|ETH|SOL|XRP|LTC|BNB|ADA|DOGE)(USDT|USDC|USD)$/;
export function mtChartKey(sym) {
  const t = String(sym || '').replace(/^[^:]+:/, '').toUpperCase().replace(/[12]!$/, '').replace(/[^A-Z0-9]/g, '');
  if (!t) return null;
  if (MT_ROOT[t]) { const k = MT_ROOT[t], d = MT_INDEX[k]; return { key: k, label: d[0], cands: d[1], same: false }; }
  if (t === 'XAUUSD' || t === 'XAGUSD') { const k = t.slice(0, 3), d = MT_INDEX[k]; return { key: k, label: d[0], cands: d[1], same: true }; }
  if (FX.test(t)) return { key: t, label: t.slice(0, 3) + '/' + t.slice(3), cands: [t], same: true };
  const c = CRYPTO.exec(t); if (c) return { key: c[1] + 'USD', label: c[1] + '/USD', cands: [c[1] + 'USD', c[1] + 'USDT'], same: true };
  return null;
}
// broker symbols matching a chart key: exact names first, then broker suffix forms (NDX100.r, US100cash, EURUSDm, EURUSD.pro)
export function mtMatches(key, list) {
  const k = mtChartKey(key) || (MT_INDEX[key] ? { cands: MT_INDEX[key][1] } : FX.test(key) ? { cands: [key] } : null);
  if (!k || !Array.isArray(list)) return [];
  const base = (s) => String(s).toUpperCase().replace(/\.?(CASH|PRO|ECN|RAW|STD|M|R|I|X|C|Z|P|SB|MICRO|MINI)$/, '').replace(/[._#+-]/g, '');
  const want = new Set(k.cands.map((c) => c.toUpperCase().replace(/\.CASH$/, '').replace(/[._#+-]/g, '')));
  const out = [];
  for (const s of list) { const v = str(s); if (!MT_SYM.test(v) || out.includes(v)) continue; if (want.has(base(v)) || want.has(v.toUpperCase().replace(/[._#+-]/g, ''))) out.push(v); }
  return out;
}
// the broker's symbol list, from what the broker link exposes: a symbol enum in the place schema, plus every symbol already seen in
// the account's positions and orders. [] = unknown (the member picks).
export function mtSymbolList(schema, positions, orders) {
  const out = new Set(), add = (v) => { const s = str(v); if (MT_SYM.test(s)) out.add(s); };
  const seen = new Set();
  const walk = (o, d) => { if (!o || typeof o !== 'object' || d > 8 || seen.has(o)) return; seen.add(o); for (const k of Object.keys(o)) { if (/^symbols?$|^instruments?$/i.test(k) && o[k] && Array.isArray(o[k].enum)) o[k].enum.forEach(add); else if (/^(symbols|instruments|availableSymbols|symbolList)$/i.test(k) && Array.isArray(o[k])) o[k].forEach((x) => add(typeof x === 'object' && x ? x.symbol || x.name : x)); walk(o[k], d + 1); } };
  walk(schema, 0);
  for (const r of [...(positions || []), ...(orders || [])]) { if (!r) continue; const leg = (r.legs || [])[0] || {}; [r.symbol, r.brokerProvidedSymbol, leg.symbol, leg.brokerProvidedSymbol, r.instrument && r.instrument.providerSymbol].forEach(add); }
  return [...out];
}
// lot rules from the place schema when it says (volume min / step / max), else MetaTrader's usual 0.01 / 0.01; max = the schema's, else none
export function mtLots(schema) {
  const found = {}; const seen = new Set();
  const walk = (o, d) => { if (!o || typeof o !== 'object' || d > 8 || seen.has(o)) return; seen.add(o); for (const k of Object.keys(o)) { const v = Number(o[k]);
    if (/^(volume_?min|min_?volume|lot_?min|min_?lot|minQty|minimumQuantity)$/i.test(k) && v > 0) found.min = v;
    else if (/^(volume_?step|lot_?step|qtyStep|quantityStep|step)$/i.test(k) && v > 0) found.step = v;
    else if (/^(volume_?max|max_?volume|lot_?max|max_?lot|maxQty)$/i.test(k) && v > 0) found.max = v;
    else walk(o[k], d + 1); } };
  walk(schema, 0);
  const step = found.step > 0 && found.step <= 1 ? found.step : 0.01, min = found.min > 0 ? found.min : step;
  return { min, step, max: found.max > 0 ? found.max : Infinity, fromSchema: !!(found.min || found.step) };
}
// round a lot size to the step (never up past max), 0 when below the minimum
export function roundLots(q, r) {
  const n = Number(q); if (!(n > 0)) return 0;
  const dec = Math.min(6, Math.max(0, -Math.floor(Math.log10(r.step) + 1e-9)));
  const v = Number((Math.floor(n / r.step + 1e-9) * r.step).toFixed(dec));
  return v < r.min - 1e-9 ? 0 : Math.min(v, r.max);
}
// MetaTrader price tick for a broker symbol: JPY pairs 0.001, other pairs 0.00001, metals / indices / crypto 0.01
export const mtTick = (key) => (FX.test(key) && !/^XA[UG]/.test(key) ? (/JPY$/.test(key) ? 0.001 : 0.00001) : 0.01);
// panel / ladder order on a MetaTrader account -> body for POST /connect/finatic/order. -> { body } | { error }
export function buildPlaceMt({ sym, side, qty, type, price, lots, same, asset }) {
  if (!MT_SYM.test(String(sym || ''))) return { error: 'Pick the broker symbol first.' };
  if (side !== 'buy' && side !== 'sell') return { error: 'Pick Buy or Sell.' };
  const r = lots || { min: 0.01, step: 0.01, max: Infinity }, q = roundLots(qty, r);
  if (!q || Math.abs(q - Number(qty)) > 1e-9) return { error: 'Size is ' + r.min + ' to ' + r.max + ' lots, in steps of ' + r.step + '.' };
  if (!['market', 'limit', 'stop'].includes(type)) return { error: 'Market, limit or stop only.' };
  if (type !== 'market' && !same) return { error: 'This chart’s prices are not ' + sym + '’s prices at your broker, so only market orders go from here.' };
  const body = { op: 'place', venue: 'mt', symbol: sym, side, qty: q, type, assetType: asset === 'cfd' ? 'cfd' : 'forex', timeInForce: 'gtc' };
  if (type !== 'market') { if (!(Number(price) > 0)) return { error: 'Enter a price.' }; const t = mtTick(sym.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6)); const p = Number((Math.round(Number(price) / t) * t).toFixed(5)); if (type === 'limit') body.limitPrice = p; else body.stopPrice = p; }
  return { body };
}
// the asset class the account's place schema lists for MetaTrader ('cfd' when it names cfd, else 'forex')
// (FDX asset types have no CFD; a MetaTrader place schema keys its order types by asset class, so its own key is used when present)
export function mtAsset(schema) {
  const seen = new Set(); let keys = null;
  const walk = (o, d) => { if (keys || !o || typeof o !== 'object' || d > 6 || seen.has(o)) return; seen.add(o); const s = o.supportedOrderTypesByAssetClass || o.supported_order_types_by_asset_class; if (s && typeof s === 'object') { keys = Object.keys(s).map((k) => k.toLowerCase()); return; } for (const k of Object.keys(o)) walk(o[k], d + 1); };
  walk(schema, 0);
  if (keys && keys.some((k) => /^cfds?$/.test(k))) return 'cfd';
  return 'forex';
}
