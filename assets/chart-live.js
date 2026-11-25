// TradeZoro — LIVE broker orders from ZoroCharts (ES module). EVERY SIGNED-IN MEMBER since 21 Nov 2026 (Owner decision: members may
// connect their own broker and place live trades; was admin only, Owner order 2026-11-15). Loaded by assets/chart-paper.js for any
// non-anonymous member. The server (functions/connect/finatic/*, _owner.js) scopes every call to the member's OWN broker connection
// and accounts, and refuses every write until the member has accepted the one-time "Enable live trading" notice (enableSheet below).
// Until then a live account can be picked and viewed (position, orders, balance) but not traded. Paper stays the default account.
// The global kill switch buttons ("Turn off live trading") are admin only (settings/liveTrading is admin-writable).
//
// What it adds to the Paper trading panel: an account picker (Paper = default, every reload starts on Paper; plus the admin's connected
// broker accounts, "Tradovate …1234"; plus "Connect a broker…", which opens the SAME connect flow as Nemesis: finatic-journal-ui.js).
// With a live account picked: a big red LIVE badge in the panel and on every chart; the panel shows an order form (Buy/Sell, Market/
// Limit, quantity), the live position (P&L from the chart's last price x the contract's point value) and working orders (Cancel);
// the chart draws the position and working-order lines (drag a working order = modify, or cancel + new when the broker can't modify);
// DOM ladder clicks (assets/chart-book-panel.js) send LIMIT orders at the clicked price (a click at/through the touch is a marketable
// limit, never a market order). Every paper surface that could be mistaken for live is switched off meanwhile (chart-paper.js).
//
// SAFETY (advisor-reviewed design, 2026-11-15):
// - Symbols (NO LIMITS, Owner decision 21 Nov 2026): any futures chart maps to its front-month contract (assets/chart-live-core.js; the
//   held contract wins), a stock chart to its ticker. TradeZoro no longer limits symbols, size, exposure or orders a minute: the broker
//   accepts or rejects, and its message is shown. A double-click guard drops the same order again within 500 ms (L.DUP_MS).
// - Orders send on the click, like paper (Owner order 19 Nov: "REMOVE this first trade confirmation"; the typed-contract step and the
//   per-order tap are gone). The red LIVE badge, the server guards (kill switch, member block, Enable live trading,
//   idempotency key, audit row before the order, 'unknown' handling) all stay. Flatten and dragging a working order still ask one tap.
// - Reads: positions + orders every POLL_MS while live is picked and the tab is visible, and right after every write. New orders are
//   blocked unless a read STARTED after the last write and is younger than STALE_MS; an unknown write result blocks until a read lands.
// - One write in flight at a time. Every write carries a fresh idempotency key (= the server's audit doc id: a repeat is refused).
//   Flatten runs on the server with a key derived from the read it was based on, so a double tap is one flatten.
// - One live tab per account (Web Locks). Idle 15 min or hidden 2 min -> back to Paper. Kill switch: "Turn off live trading" writes
//   settings/liveTrading {enabled:false}; the server refuses live writes while it is off.
// - Order panel (assets/chart-order-panel.js, 2026-11-16) replaces the bottom strip while live; it calls placeTicket() -> place() only.
// - cTrader (ADMINS AND BETA TESTERS only, Owner 23 Nov 2026): our own cTrader Open API link (assets/ctrader-trade.js -> /connect/ctrader/trade), no
//   middle company. An admin or beta tester who taps "Allow trading with cTrader" in the Trade menu gets the cTrader account in the Live accounts list;
//   it runs on the MetaTrader-style path below (lots, the broker's own symbol names) with these differences: stop loss / take profit
//   ride on the order, Flatten works from the chart, and every call goes over the trade socket instead of the broker-link routes.
//   The relay re-checks everything (admin, kill switch, member block, Enable live trading, size, the account lock, audit before send).
// Tests: tests/finatic/chart-live.test.mjs (core + server, mocked broker), tools/tests/chart-live-browser.js (mocked endpoints only),
// tools/tests/ctrader-trade.test.mjs + tools/tests/ctrader-trade-browser.js (mocked cTrader frames).
// Education only. Not financial advice.
import * as L from './chart-live-core.js?v=1290';

const POLL_MS = 10000, STALE_MS = 25000, IDLE_MS = 15 * 60000, HIDDEN_MS = 2 * 60000;
const DISCLAIMER = 'Education only. Not financial advice.';
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n, sign) => { if (n == null || !Number.isFinite(n)) return '—'; const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return (n < 0 ? '−' : sign && n > 0 ? '+' : '') + '$' + s; };
const px = (n) => (n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
// AUTO-TPSL (Owner bug 25 Nov: "@ 1.10" on a EURUSD position): a broker symbol's prices use ITS digits (cTrader SymbolById 'digits',
// else the tick): EURUSD 1.09526, NAS100 25,328.81. decOf(tick) -> digits; pxd(v, tick) -> text
// OWNER STYLE (25 Nov): broker chips say money as "+7.82 USD" / "−0.12 USD" (the cTrader P&L here is in USD, USD-quoted symbols only)
const moneyU = (n) => (n == null || !Number.isFinite(n) ? '' : (n < 0 ? '−' : n > 0 ? '+' : '') + Math.abs(n).toFixed(2) + ' USD');
const decOf = (tick) => (tick > 0 ? Math.max(0, Math.min(8, Math.round(-Math.log10(tick)))) : 2);
const pxd = (n, tick) => (n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: decOf(tick), maximumFractionDigits: decOf(tick) }));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 14));
const TEST = /^(127\.0\.0\.1|localhost)$/.test(location.hostname) ? window.__stkLiveTest : null;   // test hooks: localhost only
const now = () => (TEST && TEST.now ? TEST.now() : Date.now());

let P = null, uid = '', toastFn = null, isAdmin = false;
export const TERMS_VERSION = '2026-11-21';   // = functions/connect/finatic/_owner.js LIVE_TERMS_VERSION
const S = {
  accounts: [], acct: null, userId: '', env: null, loaded: false, loadErr: '',
  data: { positions: [], orders: [] }, lastOkStart: 0, lastWriteAt: 0, unknown: false, readErr: '', reading: false,
  busy: false, form: { side: 'buy', type: 'market', qty: 1, price: '' }, modifyOk: null,
  placeSchema: null, placeErr: '', killed: null, lastAct: Date.now(), hiddenAt: 0, lock: null, msg: '', lastSend: null, fronts: null, rtt: null, pending: null,
  // env check (Owner bug 2026-11-17): S.env stays null until the server ANSWERS; envErr = why it could not be reached (never "off")
  envAt: 0, envErr: '', envBusy: null,
  // stop loss / take profit group of the chart's contract (the server's record, functions/connect/finatic/order.js op 'bracket')
  group: null, syncing: false, alarmSeen: ''
};
window.__stkLive = { get state() { return S; } };

function toast(m, type) { try { if (toastFn) toastFn(m, type || 'info'); else if (window.showToast) window.showToast(type === 'error' ? 'error' : type === 'success' ? 'success' : 'info', m); } catch (e) {} }
const lsUserKey = () => 'stryker_broker_sync_user_' + uid;
const lsUser = () => { try { return localStorage.getItem(lsUserKey()) || ''; } catch (e) { return ''; } };

// SPEED (Owner order 2026-11-16): the ID token is cached by the Firebase SDK (no network unless it is near expiry); every write is timed
// from the confirm tap to the answer (S.rtt, shown in the panel footer) with the server's Server-Timing split (L.parseTiming).
// A 401 (expired sign-in token) is retried ONCE with a freshly minted token: the server refused it at the door, nothing was sent.
async function call(url, body, timing, fresh) {
  let t; try { t = await firebase.auth().currentUser.getIdToken(!!fresh); } catch (e) { const er = new Error('Sign in again.'); er.status = 401; throw er; }
  let r;
  try { r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: JSON.stringify(body), cache: 'no-store', keepalive: !!timing }); }
  catch (e) { const er = new Error('No answer from TradeZoro.'); er.status = 0; er.network = true; throw er; }
  if (r.status === 401 && !fresh) return call(url, body, timing, true);
  if (timing) timing.server = L.parseTiming(r.headers.get('server-timing'));
  let j = null; try { j = await r.json(); } catch (e) {}
  if (!r.ok) { const e = new Error((j && j.error) || 'Request failed (code ' + r.status + ').'); e.status = r.status; e.code = j && j.code; e.needsConnect = !!(j && j.needsConnect); throw e; }
  return j || {};
}
// MetaTrader accounts (AUTO-MTHELP 21 Nov) send venue 'mt': the server then checks the account record is MT4 / MT5 and uses lots
// cTrader accounts (ids 'ct-…', admins and beta testers only) answer the same ops over their own trade socket (ctOps in assets/ctrader-trade.js)
const CT = { mod: null, link: null, ops: null, creds: null, acct: null };
// BROKERS 3 (Owner 24 Nov 2026, admins + beta testers): tastytrade, TradeStation, OANDA accounts (ids 'b3-<broker>-<account>') answer
// the same ops through assets/broker-trade.js -> /connect/brokers/trade. Same order panel, Enable step, kill switch and order log.
const B3S = { mod: null, list: [], ops: new Map(), creds: {}, feed: null, cfg: {} };
const isOwn = (a) => !!(a && (a.ct || a.b3));   // our own broker link (cTrader or BROKERS 3), not the broker-link company
const ownOps = (id) => (CT.acct && id === CT.acct.id ? CT.ops : B3S.ops.get(id) || null);
const data = (op, extra) => { const o = ownOps(extra && extra.accountId); return o ? o.data(op, extra) : call('/connect/finatic/data', Object.assign({ op, userId: S.userId }, extra || {})); };
// COPY TRADING (assets/chart-copy.js sets window.__stkCopy): while this account is the member's copy leader, a write goes to the
// copy route, which runs the leader order first and, only once it is accepted, one order per follower account (functions/connect/
// finatic/copy.js). The reply is the leader's own reply plus copy.results.
const COPY_OPS = ['place', 'modify', 'cancel', 'flatten'];
const order = (b, timing) => {
  // our own links get the click's latency record (b.lat, never sent anywhere but the browser's own trade socket's 9001 marks)
  if (isOwn(S.acct)) return ownOps(S.acct.id).order(timing && timing.lat && S.acct.ct ? Object.assign({}, b, { lat: timing.lat }) : b);   // never copy-traded: copy trading stays on the broker-link accounts
  const lead = Object.assign({ src: 'chart', userId: S.userId, accountId: S.acct.id }, S.acct.mt && b.op !== 'env' && b.op !== 'schema' ? { venue: 'mt' } : {}, b), cp = window.__stkCopy;
  if (cp && COPY_OPS.includes(b.op) && cp.active(S.acct.id)) return call('/connect/finatic/copy', { op: 'fan', lead }, timing).then((r) => { try { cp.after(lead, r); } catch (e) {} return r; });
  return call('/connect/finatic/order', lead, timing);
};

// ---- MetaTrader symbol map: chart instrument -> the account's broker symbol (NQ chart -> NDX100 / US100 / NAS100 ...). Auto when the
// account's symbol list has exactly one match; else the member picks once per chart instrument and it is remembered per account
// (localStorage, this device). L.mtChartKey gives the key (NQ, MNQ and NDX charts share 'NDX').
const lsMapKey = () => 'stryker_mt_map_' + uid;
function mtMap() { try { const j = JSON.parse(localStorage.getItem(lsMapKey()) || '{}'); return j && typeof j === 'object' ? j : {}; } catch (e) { return {}; } }
function mtSaved(acct, key) { const m = mtMap()[acct]; const v = m && m[key]; return typeof v === 'string' && L.MT_SYM.test(v) ? v : ''; }
export function mtSetSymbol(key, sym) {
  if (!S.acct || !S.acct.mt || !key) return false;
  if (!mtRemember(S.acct.id, key, sym)) return false;
  render(); return true;
}
// the same map for any of the member's MetaTrader / cTrader accounts (symbol search: picking a broker symbol remembers it)
export function mtRemember(acctId, key, sym) {
  const a = S.accounts.find((x) => x.id === acctId); if (!a || !a.mt || !key) return false;
  const v = String(sym || '').trim(); if (v && !L.MT_SYM.test(v)) return false;
  const m = mtMap(); m[acctId] = Object.assign({}, m[acctId]); if (v) m[acctId][key] = v; else delete m[acctId][key];
  try { localStorage.setItem(lsMapKey(), JSON.stringify(m)); } catch (e) {}
  return true;
}
// symbol search source filter (assets/chart-search-sources.js): [{ code, desc }] one account offers. cTrader = the link's symbol list
// (opens the read-only link if needed: sign-in + symbol list, no orders); MetaTrader = the schema enum + positions / orders of the
// picked account; [] = not known (another MetaTrader account, or the link failed).
export async function srcSymbols(acctId) {
  const ct = !!(CT.acct && acctId === CT.acct.id && CT.link);
  if (ct) { try { await CT.link.open(); } catch (e) { return []; } }
  else if (!S.acct || S.acct.id !== acctId || !S.acct.mt) return [];
  return brokerSymbols(ct);
}
// symbol search details pane: the broker's spec for one symbol -> { d: ProtoOASymbol, base: asset name } | null. cTrader only (read-only
// SymbolById + AssetList on the open link); MetaTrader and the others share no spec here.
export async function srcSpec(acctId, code) {
  if (!(CT.acct && acctId === CT.acct.id && CT.link)) return null;
  const l = CT.link, up = String(code || '').toUpperCase(), id = l.byName.get(up); if (!id) return null;
  const d = await l.detail(id);
  if (!l.assets) l.assets = await l.call(2112, {}).then((x) => (x.payload && x.payload.asset) || [], () => null);
  const a = (l.assets || []).find((x) => x && Number(x.assetId) === l.base.get(up));
  return d ? { d, base: a ? String(a.name || a.displayName || '') : '' } : null;
}
// -> { key, label, sym, cands, list, auto } for the chart, or null when the chart can't trade on MetaTrader
export function mtFor(chartSym) {
  if (!S.acct || !S.acct.mt) return null;
  // the cTrader account's own instrument chart (symbol search broker view, byo:CT:<name>): the chart IS that broker symbol, so orders
  // go to it (NAS100 chart -> NAS100), never a mapped name; prices on it are the broker's own (same = true)
  const own = /^byo:CT:(.+)$/i.exec(String(chartSym || ''));
  if (own) {
    if (!S.acct.ct || !CT.link) return null;
    const want = own[1].replace(/[^A-Za-z0-9]/g, '').toUpperCase(), list = [...CT.link.names.values()], sym = list.find((n) => String(n).replace(/[^A-Za-z0-9]/g, '').toUpperCase() === want) || '';
    return { key: (L.mtChartKey(sym || want) || {}).key || want, label: sym || own[1], same: true, sym, auto: false, own: true, cands: sym ? [sym] : [], list, known: !!sym };
  }
  const k = L.mtChartKey(chartSym); if (!k) return null;
  const list = S.acct.ct && CT.link && CT.link.byName.size ? [...CT.link.byName.values()].map((id) => CT.link.names.get(id)) : L.mtSymbolList(S.placeSchema, S.data.positions, S.data.orders), hits = L.mtMatches(k.key, list);   // cTrader: the live symbol list
  const saved = mtSaved(S.acct.id, k.key);
  const plain = hits.length > 1 ? L.mtPlain(k.key, hits) : null;   // US100 beats US100.cash / US100.r
  const sym = saved || (hits.length === 1 ? hits[0] : plain || '');
  if (sym && !saved && P && P.activeSymbol && L.mtChartKey(P.activeSymbol()) && L.mtChartKey(P.activeSymbol()).key === k.key) announceAuto(k, sym);
  return { key: k.key, label: k.label, same: k.same, sym, auto: !saved && !!sym, cands: hits.length ? hits : k.cands, list, known: !!hits.length };
}

// ------------------------------------------------------------------------------------------ accounts
const ACCT_MS = 120000;
async function loadAccounts() {
  S.userId = lsUser(); S.loadErr = ''; S.acctAt = now();
  // the server knows this member's connection (functions/connect/finatic/_owner.js); a stored id is only an admin's legacy hint.
  // Never connected = 409 needs_connect = an empty list, no broker call.
  try {
    const r = await data('accounts');
    if (r.userId && r.userId !== S.userId) { S.userId = r.userId; try { localStorage.setItem(lsUserKey(), r.userId); } catch (e) {} }
    // L.acctInfo: the broker's account NAME as the broker shows it (Owner 19 Nov; never Finatic's UUID, never the internal broker id).
    // label / short are live getters (L.acctShow): the Owner's own label from Edit details wins as soon as it is saved.
    S.accounts = (Array.isArray(r.data) ? r.data : []).map((x) => { const a = L.acctInfo(x); a.name = a.number; return withShow(a); }).filter((a) => a.id);
  } catch (e) { S.accounts = []; if (!e.needsConnect) S.loadErr = e.message; }
  if (CT.acct) S.accounts.push(CT.acct);
  for (const a of B3S.list) S.accounts.push(a);
  if (S.acct) { const still = S.accounts.find((a) => a.id === S.acct.id); if (still) S.acct = still; else leave(true); }
  S.loaded = true; render(); menuEvent('accounts');
}
function withShow(a) {
  Object.defineProperty(a, 'label', { configurable: true, enumerable: true, get: () => L.acctShow(a, metaOf(a.id)).badge });
  Object.defineProperty(a, 'short', { configurable: true, enumerable: true, get: () => L.acctShow(a, metaOf(a.id)).short });
  return a;
}
const menuEvent = (what, id) => { try { window.dispatchEvent(new CustomEvent('stklive:menu', { detail: { what, id } })); } catch (e) {} };

// ---- balances (Owner order 2026-11-16 "add total money"; Owner bug 2026-11-19 "the balance is not updated")
// ROOT CAUSE of the 19 Nov bug: the broker link's balances answer is a list of dated balance SNAPSHOTS that it refreshes on its own
// schedule (there is no refresh call in its API). We read it only when the Trade menu opened, took the first row with a value (not the
// newest), never looked at its date, and never added the trades made since. So the figure stayed at the old snapshot all day.
// Now (L.balanceOf / L.liveBalance, chart-live-core.js): the newest snapshot of the account's currency, net liquidation first; plus
// the realised P&L of the broker's own fills AFTER that snapshot; re-read every 30 s while the Trade menu or the header strip is on
// screen, and at once after every fill / position change. The snapshot's age shows as "updated X min ago" once it is over 2 min old.
const BAL_MS = 30000, FILL_BATCH = 25, FILL_MAX = 100;
S.bal = {};
S.day = { at: 0, busy: false, key: '', fills: [], truncated: false, sig: '' };   // the active account's fills for today (and since the snapshot)
const dayStart = () => { const d = new Date(now()); d.setHours(0, 0, 0, 0); return d.getTime(); };   // local midnight, like paper's day P&L
const ordTime = (o) => L.stampOf({ updatedAt: o.orderTerminalAt || o.orderUpdatedAt || o.updatedAt || o.filledAt || o.orderCreatedAt || o.createdAt });
// -> { state: 'loading' | 'ok' | 'none', amount, currency, upl, at, age, adjusted, kind, snap } ; starts a read when missing / older than 30 s
function balance(id, force) {
  const a = S.accounts.find((x) => x.id === id); if (!a) return { state: 'none' };
  const c = S.bal[id];
  if (c && (c.busy || (!force && now() - c.at < BAL_MS))) return view(id);
  S.bal[id] = { at: now(), busy: true, snap: c && c.snap, none: c && c.none };
  data('balances', { accountId: id }).then((r) => {   // the server reads every page now (21 Nov); the newest snapshot wins in L.balanceOf
    const b = L.balanceOf(r.data, a.currency);
    S.bal[id] = { at: now(), busy: false, snap: b || null, none: !b, rows: Array.isArray(r.data) ? r.data.length : 0, truncated: !!r.truncated };
  }).catch(() => { S.bal[id] = { at: now(), busy: false, snap: c && c.snap, none: !(c && c.snap) }; })
    .then(() => { if (S.acct && S.acct.id === id) dayFills(); menuEvent('balance', id); });
  return view(id);
}
// what the menu / strip / dock show for one account (no network)
function view(id) {
  const c = S.bal[id]; if (!c) return { state: 'loading' };
  if (!c.snap) return c.busy && !c.none ? { state: 'loading' } : { state: 'none' };
  const b = c.snap, act = S.acct && S.acct.id === id;
  const lb = act && S.day.key === id + '|' + b.at ? L.liveBalance(b, S.day.truncated ? [] : S.day.fills, S.data.positions) : { amount: b.amount, at: b.at, adjusted: false };
  const a = S.accounts.find((x) => x.id === id);
  // 21 Nov: the broker link's own sync state rides along, so a failed sync says so instead of only an old age
  return { state: 'ok', amount: lb.amount, currency: b.currency, upl: b.upl, at: b.at, kind: b.kind, adjusted: !!lb.adjusted, fillsAfter: lb.fillsAfter || 0,
    age: lb.adjusted ? '' : L.balanceNote(b.at, a && a.sync, now()), sync: a && a.sync, snap: b };
}
// today's fills of the active account (orders filled since local midnight, or since the snapshot when that is older). A filled order's
// fills never change, so they are cached per order and only NEW filled orders are read (25 ids per call): the data route allows 20
// calls a minute per visitor and the 10 s positions poll already uses 6.
const fillCache = new Map();   // accountId|orderId -> fills[]
function dayFills(force) {
  if (!S.acct) return;
  const id = S.acct.id, c = S.bal[id], snapAt = c && c.snap && c.snap.at, from = Math.min(dayStart(), snapAt > 0 ? snapAt : Infinity);
  const filled = S.data.orders.filter((o) => /FILL/i.test(o.status || '') && !(ordTime(o) < from))
    .map((o) => String(o.orderId || o.id || '')).filter((x) => /^[A-Za-z0-9._:-]{1,80}$/.test(x));
  const key = id + '|' + (snapAt || ''), use = filled.slice(0, FILL_MAX), sig = key + '|' + use.join(',');
  const done = () => { const fills = []; use.forEach((o) => (fillCache.get(id + '|' + o) || []).forEach((f) => fills.push(f))); S.day = Object.assign(S.day, { at: now(), busy: false, key, fills, truncated: filled.length > FILL_MAX, sig }); };
  if (S.day.busy) return;
  // force (a fill / position change): partially filled orders may have new fills, so their cache is dropped
  if (force) S.data.orders.forEach((o) => { if (/PARTIAL/i.test(o.status || '')) fillCache.delete(id + '|' + String(o.orderId || o.id || '')); });
  const need = use.filter((o) => !fillCache.has(id + '|' + o));
  if (!need.length) { const ch = S.day.sig !== sig; done(); if (ch) { render(); menuEvent('balance', id); } return; }
  S.day.busy = true;
  (async () => {
    for (let i = 0; i < need.length; i += FILL_BATCH) {
      const part = need.slice(i, i + FILL_BATCH), r = await data('fills', { accountId: id, orderIds: part });
      const rows = Array.isArray(r.data) ? r.data : [];
      part.forEach((o) => fillCache.set(id + '|' + o, rows.filter((f) => String(f.orderId || '') === o)));
    }
  })().then(() => { if (S.acct && S.acct.id === id) done(); else S.day.busy = false; })
    .catch(() => { S.day.busy = false; S.day.at = now(); })
    .then(() => { render(); menuEvent('balance', id); });
}
// header strip / dock figures for the active live account: { bal, cur, age, rp, rpTip, up, upTip }
export function summary() {
  if (!S.acct) return null;
  const id = S.acct.id, b = balance(id), ds = dayStart();
  const lastOf = (root) => { let v = P && P.lastPrice ? P.lastPrice(root + '1!') : undefined; if (!Number.isFinite(v) && TEST && TEST.last) v = TEST.last(root + '1!'); return v; };
  const ot = L.openTotal(S.data.positions, lastOf);
  const up = ot.open ? (ot.value != null ? ot.value : (b.state === 'ok' && b.upl != null ? b.upl : null)) : null;
  let rp = null, rpTip = 'Realized P&L today';
  const today = S.day.key.startsWith(id + '|') ? S.day.fills : null;
  const dr = today && !S.day.truncated ? L.dayRealized(today, S.data.positions, ds) : null;
  if (dr && dr.complete) { rp = dr.value; rpTip = 'Realized P&L today, from ' + dr.fills + ' fill' + (dr.fills === 1 ? '' : 's') + ' (after commission)'; }
  else {
    const pr = L.positionsRealized(S.data.positions, ds);
    if (pr != null) { rp = pr; rpTip = 'Realized P&L today, as your broker reports it'; }
    else if (b.state === 'ok' && b.snap && b.snap.realized != null) { rp = b.snap.realized; rpTip = 'Realized P&L today, as your broker reports it'; }
    else if (dr) { rp = dr.value; rpTip = 'Realized P&L today from today’s fills. ' + dr.why; }
    else rpTip = S.day.busy ? 'Reading today’s fills…' : 'Not available yet';
  }
  const balTip = b.state !== 'ok' ? 'Balance' : (b.adjusted ? 'Balance: your broker’s figure plus ' + b.fillsAfter + ' fill' + (b.fillsAfter === 1 ? '' : 's') + ' since it' : 'Balance' + (b.age ? ' (' + b.age + ')' : ''));
  return { bal: b.state === 'ok' ? b.amount : null, cur: b.currency, age: b.state === 'ok' ? b.age : '', balTip, rp, rpTip, up };
}
// a fill or a position change -> balance + fills read now (not when the 30 s cache runs out)
function posSig() {
  const p = S.data.positions.map((x) => L.contractOf(x) + ':' + (x.quantity != null ? x.quantity : x.units) + ':' + (x.averageBuyPrice || x.averageSellPrice || x.averagePrice || '')).sort().join(',');
  const f = S.data.orders.filter((o) => /FILL/i.test(o.status || '')).map((o) => String(o.orderId || o.id) + ':' + (((o.legs || [])[0] || {}).filledQuantity || o.filledQuantity || '')).sort().join(',');
  return p + '|' + f;
}
function afterRead() {
  if (!S.acct) return;
  const sig = posSig();
  if (S.day.posSig !== undefined && sig !== S.day.posSig) { S.day.posSig = sig; balance(S.acct.id, true); dayFills(true); return; }
  S.day.posSig = sig;
  dayFills();
}
// every 30 s while the Trade menu or the header strip is on screen (and the tab is visible): balances of what is shown
const shown = (sel) => { const e = document.querySelector(sel); return !!(e && !e.hidden && e.offsetParent !== null); };
setInterval(() => {
  if (document.hidden || !S.accounts.length) return;
  const menu = shown('#stkc-trade-pop') || shown('.stkpt-tmenu') || !!document.getElementById('stktm-mg'), strip = shown('#stkas');
  if (menu) S.accounts.forEach((a) => balance(a.id));
  if ((menu || strip) && now() - (S.acctAt || 0) > ACCT_MS && !S.acctBusy) { S.acctBusy = true; loadAccounts().finally(() => { S.acctBusy = false; }); }   // the broker link's sync state (21 Nov)
  else if (strip && S.acct) balance(S.acct.id);
  if ((menu || strip) && S.acct) { dayFills(); menuEvent('balance', S.acct.id); }   // also re-draws the "updated X min ago" age
}, TEST && TEST.balMs ? TEST.balMs : BAL_MS);

// ---- per-account notes (pencil): label, prop firm, account type. students/{uid}/brokerAccounts/{accountId} (owner only, see
// functions-src/firestore.rules), mirrored in localStorage so the menu paints at once and still works if Firestore is unreachable.
S.meta = {};
const lsMetaKey = () => 'stryker_broker_meta_' + uid;
function metaCol() { try { return firebase.firestore().collection('students').doc(uid).collection('brokerAccounts'); } catch (e) { return null; } }
function loadMeta() {
  try { const j = JSON.parse(localStorage.getItem(lsMetaKey()) || '{}'); if (j && typeof j === 'object') Object.keys(j).forEach((k) => { S.meta[k] = L.cleanMeta(j[k]); }); } catch (e) {}
  const col = metaCol(); if (!col) return;
  col.get().then((snap) => {
    (snap.docs || []).forEach((d) => { S.meta[d.id] = L.cleanMeta(d.data()); });
    try { localStorage.setItem(lsMetaKey(), JSON.stringify(S.meta)); } catch (e) {}
    render(); menuEvent('meta');
  }).catch(() => {});
}
const metaOf = (id) => S.meta[id] || { label: '', firm: '', type: '' };
async function saveMeta(id, m) {
  const v = L.cleanMeta(m); S.meta[id] = v;
  try { localStorage.setItem(lsMetaKey(), JSON.stringify(S.meta)); } catch (e) {}
  render(); menuEvent('meta', id);
  const col = metaCol(); if (!col) return { ok: true, local: true };
  try {
    const ref = col.doc(id);
    if (!v.label && !v.firm && !v.type) await ref.delete();
    else await ref.set({ label: v.label, firm: v.firm, type: v.type, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    return { ok: true };
  } catch (e) { return { ok: true, local: true }; }   // kept on this device; Firestore copy retried on the next save
}

// ---- Disconnect one account: revoke ITS grant (functions/connect/finatic/data.js op 'revoke'), back to Paper if it was active.
async function disconnect(id) {
  const a = S.accounts.find((x) => x.id === id); if (!a) return { ok: false, error: 'Account not found.' };
  if (a.b3) {   // BROKERS 3: forget this broker's trading sign-in on this device (any view-only data sign-in is not touched)
    if (S.acct && S.acct.id === id) await leave(true);
    try { await B3S.mod.forgetCreds(a.b3); } catch (e) { return { ok: false, error: 'Could not forget the ' + a.broker + ' sign-in.' }; }
    delete B3S.creds[a.b3]; B3S.list = B3S.list.filter((x) => x.b3 !== a.b3); [...B3S.ops.keys()].forEach((k) => { if (k.startsWith('b3-' + a.b3 + '-')) B3S.ops.delete(k); });
    delete S.bal[id]; await loadAccounts();
    toast(a.broker + ' trading disconnected on this device.' + (a.b3 === 'oanda' ? ' To stop the token fully, revoke it in OANDA (Manage API Access).' : ' To remove TradeZoro’s access fully, revoke it in your ' + a.broker + ' account settings.'), 'success');
    return { ok: true, wasActive: false };
  }
  if (a.ct) {   // cTrader: forget the trading sign-in on this device (the view-only data sign-in is not touched)
    if (S.acct && S.acct.id === id) await leave(true);
    try { if (CT.link) CT.link.shut(); await CT.mod.forgetTradeCreds(); } catch (e) { return { ok: false, error: 'Could not forget the cTrader sign-in.' }; }
    CT.acct = CT.link = CT.ops = CT.creds = null; delete S.bal[id]; import('./byo-core.js?v=1290').then((c) => { if (c.statusRec('ctacct')) c.forget('ctacct'); }).catch(() => {}); await loadAccounts();
    toast('cTrader trading disconnected on this device. To remove TradeZoro’s access fully, revoke it in your cTrader ID settings.', 'success');
    return { ok: true, wasActive: false };
  }
  let gid = '';
  try { const g = await data('grants'); gid = L.grantFor(a, g.data); } catch (e) { return { ok: false, error: e.message || 'Could not read the connection.' }; }
  if (!gid) return { ok: false, error: 'Could not tell which connection this account belongs to. Use Manage to disconnect.' };
  try { await data('revoke', { grantId: gid }); } catch (e) { return { ok: false, error: e.message || 'Could not disconnect.' }; }
  const was = !!(S.acct && S.acct.id === id);
  if (was) await leave(true);
  delete S.bal[id];
  await loadAccounts();
  toast(a.label + ' disconnected.', 'success');
  return { ok: true, wasActive: was };
}
// connect(): "Connect a broker" ALWAYS shows the connect step whose button opens the broker portal, even with a saved connection
// (Owner 19 Nov: a new broker could not be added because the saved session auto-reconnected and closed). reconnect(): the quiet path
// for an expired connection, reloads the saved one without the portal (the portal is one tap away if that fails).
function openSync(portal) {
  import('./finatic-journal-ui.js?v=1290').then((m) => m.openBrokerSync({ uid, mode: 'chart', portal, onConnected: () => { loadAccounts().then(() => toast('Broker connected. Pick the account in the panel.', 'success')); } }))
    .catch(() => toast('Could not open the broker connection.', 'error'));
}
const connect = () => openSync(true), reconnect = () => openSync(false);

// ------------------------------------------------------------------------------------------ pick / leave live
export const active = () => !!S.acct;
// why a chart has no live symbol (crypto / forex, or a futures root whose contract month is not known yet)
export function noLiveWhy(sym) {
  const ins = L.instrumentOf(sym);
  if (ins && ins.asset === 'future') return S.fronts && !Object.keys(S.fronts).length ? 'Finding the contract month for ' + ins.root + '…' : 'The contract month for ' + ins.root + ' isn’t known. Trade it at your broker.';
  return 'This chart can’t trade live. Live orders work on futures and stock charts.';
}
async function pick(id) {
  if (!id) return leave();
  const a = S.accounts.find((x) => x.id === id); if (!a) return;
  if (S.acct && S.acct.id === id) return;
  await leave(true);
  // one live tab per account
  if (navigator.locks && navigator.locks.request) {
    const got = await new Promise((res) => { navigator.locks.request('stryker-live-' + id, { ifAvailable: true }, (lk) => { if (!lk) { res(false); return; } res(true); return new Promise((rel) => { S.lock = rel; }); }).catch(() => res(true)); });
    if (!got) { toast('This live account is open in another ZoroCharts tab. Use that tab, or close it first.', 'error'); render(); return; }
  }
  S.acct = a; S.data = { positions: [], orders: [] }; S.lastOkStart = 0; S.lastWriteAt = 0; S.unknown = false; S.readErr = ''; S.modifyOk = null; S.placeSchema = null; S.placeErr = ''; S.lastAct = Date.now();
  S.env = null; S.envAt = 0; S.envErr = ''; S.group = null; S.groupCode = ''; S.alarmSeen = '';
  S.day = { at: 0, busy: false, key: '', fills: [], truncated: false, sig: '' }; balance(id, true);
  // 'env' also pre-warms the server (Finatic session + kill switch cached) and the browser's connection; reads start in parallel
  read(); readKill(); loadFronts(); b3Feed(a);
  if (a.ct && CT.link) ctWarm();   // FASTORDER: the link and this chart's symbol rules load now, not on the first click
  await envCheck();
  schemaCheck();
  render();
  if (S.acct && S.acct.id === id && S.env && S.env.consent === false && S.env.blocked !== true) enableLive();
}
// Owner bug 2026-11-17: any failure of this check (expired token, 429, network blip, cold start) used to read as "Live orders are off
// on the server". Now: S.env is only set from a real answer; failures are retried 3 times with backoff (call() renews the token on a
// 401), and if it still fails the panel says it could not reach the broker link, with a Retry button. One check in flight at a time.
const ENV_MAX_AGE = 60000, ENV_BACKOFF = [600, 1500, 3500];
function envCheck() {
  if (S.envBusy) return S.envBusy;
  const id = S.acct && S.acct.id; if (!id) return Promise.resolve(null);
  S.envErr = ''; render();
  S.envBusy = (async () => {
    let last = null;
    for (let i = 0; i <= ENV_BACKOFF.length; i++) {
      if (!S.acct || S.acct.id !== id) return null;
      try {
        const r = await order({ op: 'env' });
        if (!S.acct || S.acct.id !== id) return null;
        if (r && typeof r.enabled === 'boolean') { S.env = r; S.envAt = now(); S.envErr = ''; return r; }
        last = new Error('Unexpected answer');
      } catch (e) { last = e; if ((e.status === 403 && !e.code) || e.reconnect) break; }   // 403 'Admins only' / 'Live orders are off' is an answer, not a blip
      if (i < ENV_BACKOFF.length) await new Promise((res) => setTimeout(res, TEST && TEST.fastRetry ? 20 : ENV_BACKOFF[i]));
    }
    if (S.acct && S.acct.id === id) {
      if (last && last.status === 403 && /live orders are off/i.test(last.message || '')) { S.env = { env: S.env ? S.env.env : '', enabled: false }; S.envAt = now(); S.envErr = ''; }
      else S.envErr = isOwn(S.acct) && last && last.message ? last.message : last && last.status === 401 ? 'Your sign-in expired. Reload the page to sign in again.' : 'Couldn’t reach the broker link.';
    }
    return null;
  })().finally(() => { S.envBusy = null; render(); });
  return S.envBusy;
}
export function retryEnv() { if (!S.acct) return; S.envErr = ''; envCheck().then(() => { if (!S.placeSchema) schemaCheck(); }); }
async function leave(quiet) {
  const had = !!S.acct;
  S.acct = null; S.data = { positions: [], orders: [] }; S.lastOkStart = 0; S.env = null; S.envErr = ''; S.group = null;
  if (B3S.feed) { B3S.feed.stop(); B3S.feed = null; }
  if (S.lock) { try { S.lock(); } catch (e) {} S.lock = null; }
  closeConfirm();
  if (had && !quiet) toast('Back on Paper. No live orders from this tab.', 'info');
  render();
}
async function schemaCheck() {
  const id = S.acct && S.acct.id;
  // place schema: the broker's required fields for a new order; if it can't be read (trading not enabled) new orders stay blocked
  try { const r = await order({ op: 'schema', action: 'place' }); if (S.acct && S.acct.id === id) { S.placeSchema = (r && r.data) || {}; S.placeErr = ''; } }
  catch (e) { if (S.acct && S.acct.id === id) { S.placeSchema = null; S.placeErr = e.message || 'Order fields could not be read'; } }
  render();
  try { const r = await order({ op: 'schema', action: 'modify' }); if (S.acct && S.acct.id === id) S.modifyOk = !!(r && r.data && Object.keys(r.data).length); }
  catch (e) { if (S.acct && S.acct.id === id) S.modifyOk = false; }
}
async function readKill() {
  try { const d = await firebase.firestore().collection('settings').doc('liveTrading').get(); S.killed = d.exists && d.data().enabled === false; } catch (e) { S.killed = null; }
  render();
}
async function setKill(off) {
  if (!isAdmin) return;
  try { await firebase.firestore().collection('settings').doc('liveTrading').set({ enabled: !off, by: uid, at: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }); S.killed = off; toast(off ? 'Live trading is switched off. The server refuses every live order until it is switched back on.' : 'Live trading switched back on.', off ? 'info' : 'success'); }
  catch (e) { toast('Could not change the live trading switch: ' + (e && e.message || e), 'error'); }
  render();
}

// ------------------------------------------------------------------------------------------ reads
async function read() {
  if (!S.acct || S.reading) return;
  S.reading = true; const start = now(), id = S.acct.id;
  try {
    const r = await data('live', { accountId: id });
    if (!S.acct || S.acct.id !== id) return;
    S.data = { positions: (r.data && r.data.positions) || [], orders: (r.data && r.data.orders) || [] };
    S.lastOkStart = start; S.readErr = '';
    if (S.pending && S.pending.sent && (start > S.lastWriteAt || now() - S.pending.at > 6000)) S.pending = null;   // the read shows the real order now
    if (S.unknown && start > S.lastWriteAt) S.unknown = false;
    syncSoon(); afterRead();
  } catch (e) { if (S.acct && S.acct.id === id) S.readErr = e.message || 'Read failed.'; if (e.needsConnect) S.readErr = 'The broker connection needs to be renewed. Tap Reconnect in the Trade menu.'; }
  finally { S.reading = false; }
  render();
}
setInterval(() => {
  if (!S.acct) return;
  // while a stop loss / take profit is open this tab keeps watching it (it cancels the other one when one fills): no auto-leave
  const watching = groupOpen();
  if (document.hidden) { if (!S.hiddenAt) S.hiddenAt = Date.now(); else if (!watching && Date.now() - S.hiddenAt > HIDDEN_MS) { leave(); return; } if (!watching) return; }
  else S.hiddenAt = 0;
  if (!watching && Date.now() - S.lastAct > IDLE_MS) { leave(); toast('Live account left after 15 minutes without use.', 'info'); return; }
  read();
}, POLL_MS);
window.addEventListener('beforeunload', (e) => { if (groupOpen()) { e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.acct) { S.hiddenAt = 0; read(); if (S.acct.ct) ctWarm(); } });
// FASTORDER: open the cTrader link (if a close let it rest) and load the chart symbol's size rules, in the background
function ctWarm() { try { const i = P && P.activeSymbol ? infoMt(P.activeSymbol()) : null; CT.link.warm(i && i.code); } catch (e) {} }
['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, () => { S.lastAct = Date.now(); }, { passive: true, capture: true }));

function gate() { return L.readsOk({ lastOkStart: S.lastOkStart, lastWriteAt: S.lastWriteAt, unknown: S.unknown, now: now(), maxAge: STALE_MS }); }
function blockReason() {
  if (!S.acct) return 'No live account picked.';
  if (S.env && S.env.enabled === false) return 'Live orders are off on the server.';   // only when the server SAID so
  if (!S.env) return S.envErr || 'Checking the broker link…';
  if (S.env.blocked === true) return 'Live trading is switched off for your account. Contact support.';
  if (S.env.consent === false) return 'Enable live trading first. This account is view-only until then.';
  if (S.killed) return 'Live trading is switched off.';
  if (S.placeErr) return S.placeErr + '. New orders are blocked.';
  if (!S.placeSchema) return 'Loading the broker’s order fields…';
  if (S.busy) return 'Sending…';
  if (S.acct.mt && P && P.activeSymbol) { const i = infoMt(P.activeSymbol()); if (i && !i.code) return 'Pick the ' + S.acct.mt + ' symbol for ' + i.map.label + ' first.'; }
  const g = gate(); if (!g.ok) return S.readErr ? 'Positions and orders could not be read (' + S.readErr + '). New orders are blocked.' : g.why;
  return '';
}

// ------------------------------------------------------------------------------------------ per chart
// front contracts of the non-index futures roots (CL, GC, ZN ...), from the symbol-info feed the chart already loads (memoised 1 h)
function loadFronts() {
  if (S.fronts) return;
  S.fronts = {};
  import('./chart-symbol-info.js?v=1290').then((m) => m.getInfo()).then((d) => { S.fronts = L.frontsOf(d && d.syms); render(); }).catch(() => { S.fronts = null; });
}
function info(sym) {
  if (S.acct && S.acct.mt) return infoMt(sym);
  const c = L.contractFor(sym, S.data.positions, now(), S.fronts); if (!c) return null;
  const pos = L.netPosition(S.data.positions, c.code), working = L.workingOrders(S.data.orders, c.code);
  let last = P && P.lastPrice ? P.lastPrice(sym) : undefined;
  if (!Number.isFinite(last) && TEST && TEST.last) last = TEST.last(sym);   // browser test fixture only (localhost)
  const pnl = L.openPnl(pos.qty, pos.avg, Number.isFinite(last) ? last : null, c.pv, pos.upl);
  return { ...c, pos, working, last, pnl };
}
function infoMt(sym) {
  const m = mtFor(sym); if (!m) return null;
  const code = m.sym, pos = code ? L.netPosition(S.data.positions, code) : { qty: 0, avg: null, upl: null }, working = code ? L.workingOrders(S.data.orders, code) : [];
  let last = P && P.lastPrice ? P.lastPrice(sym) : undefined;
  if (!Number.isFinite(last) && TEST && TEST.last) last = TEST.last(sym);
  // the chart's last price is only the broker's price when the chart IS the instrument (forex / spot pairs); a futures chart is not the CFD
  const lp = m.same && Number.isFinite(last) ? last : undefined;
  const lots = S.acct.ct ? ctLots(code) : S.acct.b3 ? b3Lots(code) : L.mtLots(S.placeSchema);
  let pnl = pos.qty ? pos.upl : null;
  if (pnl == null && pos.qty && S.acct.ct && m.same) pnl = ctPnl(code, pos, lp);   // the broker's own chart: P&L from its price (USD-quoted symbols only)
  return { mt: S.acct.mt, ct: isOwn(S.acct), map: m, code, root: m.key, front: code, held: false, tick: S.acct.ct ? ctTick(code, m.key) : S.acct.b3 ? b3Tick(code, m.key) : L.mtTick(m.key), pv: null, pos, working, last: lp, chartLast: last, pnl, lots };
}
export function badgeFor(sym) {
  if (!S.acct) return '';
  const i = info(sym);
  return envWord() + ' ' + S.acct.label + (i ? (i.code ? ' · ' + i.code : '') : ' · this chart can’t trade live');
}
// the badge's button (MetaTrader / cTrader only): opens the symbol picker
export function badgeAct(sym) { const i = S.acct && S.acct.mt ? infoMt(sym) : null; return i && !i.map.own ? (i.code ? 'Change' : 'Choose symbol ▾') : ''; }   // own instrument chart: nothing to pick

// ---- symbol picker (Owner 24 Nov: "how do I know which symbol it provides?"). The broker's own list and descriptions.
const announced = new Set();
function announceAuto(k, sym) {
  const id = S.acct.id + '|' + k.key + '|' + sym; if (announced.has(id)) return; announced.add(id);
  setTimeout(() => toastAct('Using ' + sym + ' for ' + k.label + ' on ' + S.acct.mt + '.', 'Change', () => openSymPicker(P.activeSymbol && P.activeSymbol()), 'info'), 0);
}
function toastAct(msg, label, fn, type) {
  try { if (window.showToast) { window.showToast(type || 'info', msg, { action: { label, onClick: fn } }); return; } } catch (e) {}
  toast(msg, type);
}
// [{ code, desc }] the account offers: cTrader = the symbol list the link loaded; MetaTrader = the schema enum + symbols seen in positions / orders
function brokerSymbols(ct) {
  if (ct || (S.acct && S.acct.ct)) {
    const l = CT.link; if (!l || !l.byName) return [];
    return [...l.byName.values()].map((id) => l.names.get(id)).filter(Boolean).map((code) => ({ code, desc: (l.descs && l.descs.get(code.toUpperCase())) || '' })).sort((a, b) => a.code.localeCompare(b.code));
  }
  return L.mtSymbolList(S.placeSchema, S.data.positions, S.data.orders).sort().map((code) => ({ code, desc: '' }));
}
let sp = null;
export function closeSymPicker() { if (sp) { document.removeEventListener('keydown', sp.key, true); document.removeEventListener('pointerdown', sp.out, true); sp.el.remove(); sp = null; } }
export function openSymPicker(chartSym, anchor) {
  closeSymPicker();
  const m = S.acct && S.acct.mt ? mtFor(chartSym || (P.activeSymbol && P.activeSymbol())) : null; if (!m) return false;
  const all = brokerSymbols(), best = L.mtMatches(m.key, all.map((x) => x.code)), bestSet = new Set(best), byCode = new Map(all.map((x) => [x.code, x]));
  const row = (code, desc) => '<button type="button" class="stklv-sp-row" data-code="' + esc(code) + '"' + (code === m.sym ? ' aria-current="true"' : '') + '><b>' + esc(code) + '</b><span>' + esc(desc || '') + '</span></button>';
  const el = document.createElement('div'); el.id = 'stklv-sp';
  el.innerHTML = '<div class="stklv-sp-box" role="dialog" aria-modal="true" aria-labelledby="stklv-sp-h">' +
    '<div class="stklv-grab" aria-hidden="true"></div>' +
    '<div class="stklv-sp-head"><h2 id="stklv-sp-h">Which ' + esc(S.acct.mt) + ' symbol is ' + esc(m.label) + '?</h2><button type="button" class="stklv-x" data-k="no" aria-label="Close">×</button></div>' +
    (all.length ? '<input type="search" class="stklv-sp-q" placeholder="Search your account’s symbols" aria-label="Search symbols" autocomplete="off" spellcheck="false">' : '') +
    '<div class="stklv-sp-list"></div>' +
    '<form class="stklv-sp-type" ' + (all.length ? 'hidden' : '') + '><label>Type it exactly as your Market Watch shows it<input type="text" data-k="typed" autocomplete="off" spellcheck="false" placeholder="e.g. ' + esc(m.cands[0] || 'US100') + '"></label><button type="submit" class="stklv-btn sm">Use</button></form></div>';
  document.body.appendChild(el);
  const list = el.querySelector('.stklv-sp-list'), q = el.querySelector('.stklv-sp-q');
  const paint = () => {
    const t = (q ? q.value : '').trim().toUpperCase(), hit = (x) => !t || x.code.toUpperCase().includes(t) || x.desc.toUpperCase().includes(t);
    let h = '';
    if (!all.length) h = '<h3 class="stklv-h3">Usual names</h3>' + m.cands.map((c) => row(c, '')).join('');
    else {
      const b = best.map((c) => byCode.get(c)).filter(hit); const rest = all.filter((x) => !bestSet.has(x.code) && hit(x));
      if (b.length) h += '<h3 class="stklv-h3">Best matches</h3>' + b.map((x) => row(x.code, x.desc)).join('');
      h += '<h3 class="stklv-h3">All symbols in your account (' + (rest.length + b.length) + ')</h3>' + rest.slice(0, 150).map((x) => row(x.code, x.desc)).join('') + (rest.length > 150 ? '<p class="stklv-empty">Showing 150. Type to narrow the list.</p>' : '') + (!rest.length && !b.length ? '<p class="stklv-empty">No symbol matches “' + esc(q.value.trim()) + '”.</p>' : '');
    }
    list.innerHTML = h;
  };
  const choose = (code) => { if (mtSetSymbol(m.key, code)) { closeSymPicker(); toast(m.label + ' trades as ' + code + ' on this ' + S.acct.mt + ' account.', 'success'); } else toast('That is not a valid symbol name.', 'error'); };
  paint(); if (q) q.addEventListener('input', paint);
  list.addEventListener('click', (e) => { const b = e.target.closest('.stklv-sp-row'); if (b) choose(b.dataset.code); });
  el.querySelector('.stklv-sp-type').addEventListener('submit', (e) => { e.preventDefault(); choose(el.querySelector('[data-k=typed]').value.trim()); });
  el.querySelector('[data-k=no]').addEventListener('click', closeSymPicker);
  for (const ev of ['keydown', 'pointerdown']) el.addEventListener(ev, (e) => e.stopPropagation());
  const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeSymPicker(); } };
  const out = (e) => { if (!el.querySelector('.stklv-sp-box').contains(e.target) && !(anchor && anchor.contains(e.target))) closeSymPicker(); };
  document.addEventListener('keydown', key, true); setTimeout(() => document.addEventListener('pointerdown', out, true), 0);
  sp = { el, key, out };
  // desktop: a popover under the badge; phone: the CSS makes it a bottom sheet
  const box = el.querySelector('.stklv-sp-box');
  if (anchor && window.innerWidth > 700) { const r = anchor.getBoundingClientRect(); box.style.top = Math.min(r.bottom + 8, window.innerHeight - 420) + 'px'; box.style.left = Math.max(8, Math.min(r.right - 400, window.innerWidth - 408)) + 'px'; el.classList.add('pop'); }
  setTimeout(() => (q || el.querySelector('[data-k=typed]') || box).focus(), 30);
  return true;
}
const envWord = () => (S.env && S.env.env === 'sandbox' ? 'SANDBOX' : 'LIVE');
export function lines(sym) {
  const i = info(sym); if (!i || (i.mt && (!i.code || !i.map.same))) return [];   // a CFD's prices are not this chart's prices: no lines
  const out = [];
  if (i.pos.qty && i.pos.avg) { const one = i.ct && S.acct.ct ? ctPosOf(i.code) : null; out.push({ id: 'pos', kind: 'pos', live: true, price: i.pos.avg, side: i.pos.qty > 0 ? 'buy' : 'sell', qty: Math.abs(i.pos.qty), pnl: i.pnl, sltp: one ? { posId: String(one.positionId), sl: Number(one.stopLoss) > 0, tp: Number(one.takeProfit) > 0 } : null }); }
  const g = S.group && S.group.code === i.code ? S.group : null;
  for (const o of i.working) if (o.price) out.push({ id: 'L' + o.id, oid: o.id, kind: 'ord', live: true, price: o.price, side: o.side, type: o.type, qty: o.qty, role: g && g.slId === o.id ? 'sl' : g && g.tpId === o.id ? 'tp' : '' });
  if (i.ct) out.push(...ctSlTp(i));
  if (S.pending && S.pending.code === i.code && !(S.pending.oid && i.working.some((o) => o.id === S.pending.oid))) {
    const q = S.pending; out.push(q);
    if (q.sl) out.push({ id: q.id + 'sl', kind: 'osl', role: 'sl', live: true, pending: true, sent: q.sent, price: q.sl, side: q.side, ref: q.price, qty: q.qty });
    if (q.tp) out.push({ id: q.id + 'tp', kind: 'otp', role: 'tp', live: true, pending: true, sent: q.sent, price: q.tp, side: q.side, ref: q.price, qty: q.qty });
  }
  return out;
}
// cTrader: stop loss / take profit ride on the order or the position (ProtoOAOrder / ProtoOAPosition stopLoss, takeProfit), not as
// separate orders, so each becomes its own line (kind sl / tp, role sl / tp). Read-only on the chart: change them in cTrader for now.
function ctSlTp(i) {
  const out = [], same = (r) => L.matches(r, i.code) || L.matches((r.legs || [])[0] || {}, i.code);
  for (const p of S.data.positions) {
    if (!p || !same(p) || !Number(p.quantity)) continue;
    const side = Number(p.quantity) > 0 ? 'buy' : 'sell', qty = Math.abs(Number(p.quantity)), id = String(p.positionId || '');
    if (Number(p.stopLoss) > 0) out.push({ id: 'SP' + id, kind: 'sl', role: 'sl', live: true, posId: id, price: Number(p.stopLoss), side, ref: p.averagePrice, qty });
    if (Number(p.takeProfit) > 0) out.push({ id: 'TP' + id, kind: 'tp', role: 'tp', live: true, posId: id, price: Number(p.takeProfit), side, ref: p.averagePrice, qty });
  }
  for (const o of i.working) {
    const r = S.data.orders.find((x) => String(x.orderId || x.id || '') === o.id); if (!r) continue;
    if (Number(r.stopLoss) > 0) out.push({ id: 'SO' + o.id, kind: 'osl', role: 'sl', live: true, price: Number(r.stopLoss), side: o.side, ref: o.price, qty: o.qty });
    if (Number(r.takeProfit) > 0) out.push({ id: 'TO' + o.id, kind: 'otp', role: 'tp', live: true, price: Number(r.takeProfit), side: o.side, ref: o.price, qty: o.qty });
  }
  return out;
}
// open P&L of a cTrader position from the broker's own chart price: (last - avg) x units (volume is in cents of units). Only when the
// symbol is quoted in the account currency's USD (the dollars the chip shows); otherwise null (shown as —, never a guess)
function ctPnl(code, pos, last) {
  if (!CT.link || !Number.isFinite(last) || !(pos.avg > 0)) return null;
  const K = String(code).toUpperCase(), qa = CT.link.quote && CT.link.quote.get(K), as = CT.link.assets && qa ? CT.link.assets.find((a) => a && Number(a.assetId) === qa) : null;
  const usd = as ? String(as.name || as.displayName || '').toUpperCase() === 'USD' : /USD$/.test(K);
  if (!usd) return null;
  let units = 0; for (const p of S.data.positions) if (p && L.matches(p, code) && Number(p.volume) > 0) units += (Number(p.quantity) < 0 ? -1 : 1) * Number(p.volume) / 100;
  if (!units) return null;
  return Math.round((last - pos.avg) * units * 100) / 100;
}
// a mapped chart (NQ1!) can't draw the broker's NAS100 lines (other prices): say so, with a button to the broker's own chart.
// -> { text, sym } | null. cTrader only (its own instrument charts exist); none on a byo:CT chart itself.
export function otherNote(sym) {
  if (!S.acct || !S.acct.ct || !CT.link || /^byo:CT:/i.test(String(sym || ''))) return null;
  const k = L.mtChartKey(sym); if (!k) return null;
  const i = infoMt(sym); if (i && i.code && i.map.same) return null;   // same prices: the lines are drawn
  const what = new Map(), add = (c, w) => { if (!c) return; const kc = L.mtChartKey(c); if (!kc || kc.key !== k.key) return; const e = what.get(c) || { pos: 0, ord: 0 }; e[w]++; what.set(c, e); };
  for (const p of S.data.positions) if (p && Number(p.quantity)) add(String(p.symbol || ''), 'pos');
  for (const o of S.data.orders) add(String(((o.legs || [])[0] || {}).symbol || o.symbol || ''), 'ord');
  if (!what.size) return null;
  const [code, e] = [...what.entries()][0];
  const noun = e.pos && e.ord ? 'position and order' + (e.ord > 1 ? 's' : '') + ' are' : e.pos ? 'position is' : e.ord > 1 ? 'orders are' : 'order is';
  return { text: 'Your ' + code + ' ' + noun + ' on cTrader prices', btn: 'Open ' + code + ' chart', sym: 'byo:CT:' + code };
}
export function openOther(sym) { try { window.STRYKER_VELA.active.setSymbol(sym); } catch (e) { toast('Could not open ' + String(sym).replace(/^byo:CT:/, '') + '.', 'error'); }
}
export function chipText(sym, l) {
  const i = info(sym), pf = (v) => (i && i.mt && i.code ? pxd(v, i.tick) : px(v));
  // OWNER STYLE (25 Nov): TP / SL chips = [TP pill] price | P&L at that level; the position chip = [Buy 0.02 lots] | P&L | x. The entry
  // price is on the price scale tag (chart-axis-tags.js) in the symbol's digits, and in the chip's tooltip.
  if (l.id === 'new' && l.slRole) { const v = sltpPreview(sym, l); return [pf(l.price), v.err || v.pnl]; }   // AUTO-TPSL: dragging a new TP / SL
  if (l.kind === 'pos' && i && i.mt) return [(l.side === 'buy' ? 'Buy ' : 'Sell ') + lotTxt(l.qty), i.pnl == null ? '' : moneyU(i.pnl)];
  if (l.kind === 'pos') return ['LIVE ' + (l.side === 'buy' ? 'LONG ' : 'SHORT ') + l.qty + ' ' + (i ? i.code : '') + ' @ ' + px(l.price), money(i ? i.pnl : null, true)];
  if (l.pending && l.role) return [(l.sent ? 'LIVE ' : 'SENDING ') + (l.role === 'sl' ? 'SL ' : 'TP ') + l.qty, pf(l.price)];
  if (l.pending) return [(l.sent ? 'LIVE ' : 'SENDING ') + (l.side === 'buy' ? 'BUY ' : 'SELL ') + l.qty + (l.type === 'market' ? ' MKT' : /stop/.test(l.type) ? ' STP' : ' LMT'), pf(l.price)];
  if (l.role && l.posId) { const v = sltpPreview(sym, l); return [pf(l.price), v.err || v.pnl]; }   // a position's SL / TP: level + projected P&L
  if (l.role) return ['LIVE ' + (l.role === 'sl' ? 'SL ' : 'TP ') + l.qty, pf(l.price)];
  return ['LIVE ' + (l.side === 'buy' ? 'BUY ' : 'SELL ') + (/stop/.test(l.type) ? 'STP ' : 'LMT ') + l.qty, pf(l.price)];
}
// label parts for the Trade display toggles (all on = chipText above, word for word)
export function chipParts(sym, l) {
  const i = info(sym), t = chipText(sym, l), pf = (v) => (i && i.mt && i.code ? pxd(v, i.tick) : px(v));
  if (l.id === 'new' && l.slRole) return { name: '', size: '', price: pf(l.price), pnl: t[1], pa: 'a' };
  if (l.kind === 'pos' && i && i.mt) return { name: l.side === 'buy' ? 'Buy' : 'Sell', size: lotTxt(l.qty), price: '', pnl: t[1], pa: 'a' };
  if (l.kind === 'pos') return { name: 'LIVE ' + (l.side === 'buy' ? 'LONG' : 'SHORT'), size: String(l.qty), price: '@ ' + px(l.price), pnl: t[1], pa: 'a' };
  if (l.pending && l.role) return { name: (l.sent ? 'LIVE ' : 'SENDING ') + (l.role === 'sl' ? 'SL' : 'TP'), size: String(l.qty), price: pf(l.price), pnl: '', pa: 'a' };
  if (l.pending) return { name: (l.sent ? 'LIVE ' : 'SENDING ') + (l.side === 'buy' ? 'BUY' : 'SELL') + (l.sent ? (/stop/.test(l.type) ? ' STP' : ' LMT') : ''), size: String(l.qty), price: pf(l.price), pnl: '', pa: 'b' };
  if (l.role && l.posId) return { name: '', size: '', price: pf(l.price), pnl: t[1], pa: 'a' };
  if (l.role) return { name: 'LIVE ' + (l.role === 'sl' ? 'SL' : 'TP'), size: String(l.qty), price: pf(l.price), pnl: '', pa: 'a' };
  return { name: 'LIVE ' + (l.side === 'buy' ? 'BUY' : 'SELL') + (/stop/.test(l.type) ? ' STP' : ' LMT'), size: String(l.qty), price: pf(l.price), pnl: '', pa: 'b' };
}
// the active account's fills on this chart's instrument, for Trade display > Executions: today's fills, plus the Trade history tab's when loaded
export function execs(sym) {
  const i = info(sym); if (!i || !S.acct) return [];
  dockTrades(false, 'th');   // throttled to one read per 30 s
  const out = [], seen = new Set();
  if (S.acct.ct) {   // cTrader: its own deal list (symbol = the broker's name, the chart's mapped code)
    for (const d of (S.hist.id === S.acct.id && S.hist.th.rows) || []) if (d.sym === i.code && d.t > 0 && d.price > 0) out.push({ t: d.t, price: d.price, side: d.side, qty: Number.isFinite(d.lots) ? d.lots.toFixed(2) : '' });
    return out.sort((x, y) => x.t - y.t);
  }
  for (const f of [].concat(S.day.fills || [], S.fills.rows || [])) {
    if (L.contractOf(f) !== i.code) continue;
    const t = Date.parse(first(f, ['filledAt', 'timestamp', 'createdAt', 'executedAt', 'time'])), p = Number(first(f, ['price', 'fillPrice', 'executionPrice'])), s = String(first(f, ['side', 'action'])).toLowerCase();
    if (!Number.isFinite(t) || !(p > 0) || (s !== 'buy' && s !== 'sell')) continue;
    const k = t + '|' + p + '|' + s; if (seen.has(k)) continue; seen.add(k);
    out.push({ t, price: p, side: s, qty: first(f, ['quantity', 'qty', 'units']) || '' });
  }
  return out.sort((x, y) => x.t - y.t);
}
const lotTxt = (q) => Number(q).toFixed(2) + ' lot' + (Number(q) === 1 ? '' : 's');
export const tickOf = (sym) => { if (S.acct && S.acct.mt) { const m = infoMt(sym); if (m && m.code && m.tick > 0) return m.tick; } const i = L.instrumentOf(sym); return i && i.asset === 'future' ? (L.ROOTS[i.root] || {}).tick || 0.01 : 0.01; };   // AUTO-TPSL: a broker symbol drags on its own tick (EURUSD 0.00001)

// ------------------------------------------------------------------------------------------ confirm sheet
let cf = null;
function closeConfirm(v) { if (cf) { const r = cf.resolve; cf.el.remove(); document.removeEventListener('keydown', cf.key, true); cf = null; r(v === true); } }
// one tap, used only by flatten and drag moves (new orders send on the click). d: { title, lines:[...], code, go, side }
// OWNER STYLE (25 Nov): a neat, simple card. d.sub = one grey line under the title ("EURUSD · Buy · 0.02 lots"); d.rows = [[label, value
// html]] hairline-separated, label left / value right; the Account row is added for every card. d.dontShow: a "Don't show this again"
// box that turns the Trade display "confirm" setting off (only on confirms that setting opened). d.lines (older callers) still work.
function confirmSheet(d) {
  closeConfirm(false);
  return new Promise((resolve) => {
    const el = document.createElement('div'); el.id = 'stklv-cf'; el.className = 'stklv-card';
    const acctTxt = esc(S.acct.broker || S.acct.mt || '') + ' <span class="stklv-env' + (S.acct.demo || envWord() === 'SANDBOX' ? ' demo' : '') + '">' + (S.acct.demo || envWord() === 'SANDBOX' ? 'Demo' : 'Live') + '</span> <span class="n">' + esc(S.acct.number || S.acct.label || '') + '</span>';
    const rows = (d.rows || []).concat([['Account', acctTxt]]);
    el.innerHTML = '<div class="stklv-cf-box" role="alertdialog" aria-modal="true" aria-labelledby="stklv-cf-h" aria-describedby="stklv-cf-d">' +
      '<div class="stklv-grab" aria-hidden="true"></div>' +
      '<div class="stklv-cf-head"><h2 id="stklv-cf-h">' + esc(d.title) + '</h2><button type="button" class="stklv-x" data-k="no" aria-label="Cancel">×</button></div>' +
      (d.sub ? '<p class="stklv-cf-sub">' + esc(d.sub) + '</p>' : '') +
      '<div id="stklv-cf-d">' + (d.lines && d.lines.length ? '<div class="stklv-cf-lines">' + d.lines.map((x) => '<p>' + x + '</p>').join('') + '</div>' : '') +
      '<dl class="stklv-cf-rows">' + rows.map((r) => '<div><dt>' + esc(r[0]) + '</dt><dd>' + r[1] + '</dd></div>').join('') + '</dl></div>' +
      (d.dontShow ? '<label class="stklv-cf-ds"><input type="checkbox" data-k="ds"> Don’t show this again</label>' : '') +
      '<p class="stklv-fine">Real order at your broker. Every attempt is logged. ' + DISCLAIMER + '</p>' +
      '<div class="stklv-cf-btns"><button type="button" class="stklv-btn" data-k="no">Cancel</button><button type="button" class="stklv-btn stklv-go ' + (d.side === 'sell' ? 'sell' : 'buy') + '" data-k="yes">' + esc(d.go) + '</button></div></div>';
    document.body.appendChild(el);
    const yes = el.querySelector('[data-k=yes]');
    setTimeout(() => el.querySelector('.stklv-cf-btns [data-k=no]').focus(), 30);
    const k = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeConfirm(false); } else if (e.key === 'Enter' && !yes.disabled && !document.activeElement.matches('[data-k=no],[data-k=ds]')) { e.preventDefault(); e.stopPropagation(); yes.click(); } else e.stopPropagation(); };
    document.addEventListener('keydown', k, true);
    el.addEventListener('mousedown', (e) => { if (e.target === el) closeConfirm(false); });
    el.querySelectorAll('[data-k=no]').forEach((b) => b.addEventListener('click', () => closeConfirm(false)));
    yes.addEventListener('click', () => {
      if (yes.disabled) return;
      const ds = el.querySelector('[data-k=ds]');
      if (ds && ds.checked) { try { window.__stkTradeView.set('confirm', false); } catch (e) {} }   // the existing Trade display setting
      closeConfirm(true);
    });
    cf = { el, resolve, key: k };
  });
}

// ---- "Enable live trading" (Owner decision 21 Nov 2026): one time per member, before the first live order. Plain risk notice,
// a checkbox, then Enable. The server stores the acceptance (liveConsent/{uid}: uid, time, version; order.js op 'consent') and
// refuses every live write until it is there. Cancel = the account stays view-only. Same sheet styles as the confirm (#stklv-cf).
let enOpen = false;
export function enableLive() {
  if (enOpen || !S.acct) return Promise.resolve(false);
  enOpen = true; closeConfirm(false);
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const el = document.createElement('div'); el.id = 'stklv-cf'; el.className = 'stklv-en';
    el.innerHTML = '<div class="stklv-cf-box" role="dialog" aria-modal="true" aria-labelledby="stklv-en-h" aria-describedby="stklv-en-d">' +
      '<div class="stklv-grab" aria-hidden="true"></div>' +
      '<div class="stklv-cf-head"><span class="stklv-badge">' + esc(envWord() + ' ' + S.acct.label) + '</span><button type="button" class="stklv-x" data-k="no" aria-label="Close">×</button></div>' +
      '<h2 id="stklv-en-h">Enable live trading</h2>' +
      '<div id="stklv-en-d" class="stklv-cf-lines stklv-en-list"><p>Before your first live order, please read this.</p><ul>' +
        '<li><b>This is real money.</b> Live orders use your own broker account, and you can lose money.</li>' +
        '<li><b>Orders go straight to your broker.</b> A click on Buy, Sell, Flatten or the order book sends a real order. There is no extra confirm step.</li>' +
        '<li><b>TradeZoro is not a broker and gives no advice.</b> We pass your orders to your broker. We don’t hold your money or tell you what to trade.</li>' +
        '<li><b>You are responsible for your orders</b> and your positions, including when a connection or a page fails. Check your broker if anything looks wrong.</li>' +
        '<li><b>TradeZoro is not liable for trading issues.</b> We are not responsible for any loss or damage from failed, delayed, rejected or duplicate orders, wrong or old data, outages, bugs or anything else that goes wrong while trading through TradeZoro. You trade at your own risk.</li>' +
      '</ul><p>TradeZoro sets no limits of its own on what or how much you trade: your broker decides what it accepts. We log every order and may switch live trading off for everyone or for one account at any time. ' + DISCLAIMER + '</p></div>' +
      '<label class="stklv-en-ck"><input type="checkbox" data-k="ck"><span>I have read this and the <a href="/terms#broker-live" target="_blank" rel="noopener">Terms</a>, and I accept the risk of live trading.</span></label>' +
      '<p class="stklv-en-err" role="alert" hidden></p>' +
      '<div class="stklv-cf-btns"><button type="button" class="stklv-btn" data-k="no">Not now</button><button type="button" class="stklv-btn stklv-go buy" data-k="yes" disabled>Enable live trading</button></div>' +
      '<p class="stklv-fine">Until you enable it, this account is view-only. Paper trading is not affected.</p></div>';
    document.body.appendChild(el);
    const ck = el.querySelector('[data-k=ck]'), yes = el.querySelector('[data-k=yes]'), er = el.querySelector('.stklv-en-err');
    const done = (v) => { el.remove(); document.removeEventListener('keydown', k, true); enOpen = false; try { prev && prev.focus && prev.focus(); } catch (e) {} render(); resolve(v); };
    const k = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } else e.stopPropagation(); };
    document.addEventListener('keydown', k, true);
    el.addEventListener('mousedown', (e) => { if (e.target === el) done(false); });
    el.querySelectorAll('[data-k=no]').forEach((b) => b.addEventListener('click', () => done(false)));
    ck.addEventListener('change', () => { yes.disabled = !ck.checked; });
    yes.addEventListener('click', async () => {
      if (!ck.checked || yes.disabled) return;
      yes.disabled = true; yes.textContent = 'Saving…'; er.hidden = true;
      try {
        await call('/connect/finatic/order', { op: 'consent', accept: true, version: TERMS_VERSION });
        if (S.env) S.env = Object.assign({}, S.env, { consent: true });
        toast('Live trading enabled for your account.', 'success');
        done(true);
      } catch (e) { er.textContent = e.message || 'Could not save. Try again.'; er.hidden = false; yes.disabled = !ck.checked; yes.textContent = 'Enable live trading'; }
    });
    setTimeout(() => ck.focus(), 30);
  });
}

// ------------------------------------------------------------------------------------------ writes
// pending: optional "sending" line drawn on the chart right away (L.pendingLine), removed when the answer arrives
// FASTORDER (25 Nov): a cTrader write is timed hop by hop from the click (lat.t0, set in place / placeMt): link ready (c_open), sent on
// the socket (c_send), cTrader's answer back (c_ack), toast shown (c_toast), the fill of a market order (c_fill). The marks go to
// that order's log row (brokerOrderAudit, admin-read) through the relay, so the Owner's next live orders give real numbers.
// The toast says "sending…" at once, then what cTrader answered: "filled @ price" (market) or "accepted" (limit / stop).
async function write(body, what, pending, lat, okText) {
  S.busy = true; S.lastWriteAt = now(); S.pending = pending || null; render();
  const tm = { op: body.op, t0: lat && lat.t0 ? lat.t0 : performance.now(), lat: lat || null };
  let okW = null;
  const ct = !!(lat && S.acct && S.acct.ct);
  if (ct && body.op === 'place') toast(what + ' sending…', 'info');
  try {
    const r = await order(body, tm); tm.ok = true; okW = r || {};
    if (okText) { toast(okText, 'success'); return r; }   // AUTO-TPSL: "Take profit set at 1.09800"
    if (ct) { ctToast(what, r, lat); return r; }
    toast(r.settled ? L.settledText(what, r) : what + ' sent. ' + (r.status ? 'Broker status: ' + r.status + '.' : ''), 'success'); return r;
  }
  catch (e) {
    // the server's message says what the broker answered and whether a read already looked for the order (21 Nov)
    if (e.code === 'unknown' || e.network) { S.unknown = true; toast(e.code === 'unknown' && e.message ? e.message : 'No answer from TradeZoro (your connection dropped). The order may or may not have gone through. Check your positions and working orders before you send it again.', 'error'); }
    else toast(what + ' refused: ' + e.message, 'error');
    return null;
  } finally {
    tm.ms = performance.now() - tm.t0; S.rtt = tm; S.busy = false; S.lastWriteAt = now();
    // accepted: the sending line stays (solid, confirmed) until a read that started after this write shows the order; refused: gone now
    if (S.pending && okW && S.pending.type !== 'market') { S.pending = Object.assign({}, S.pending, { sent: true, oid: okW.orderId ? String(okW.orderId) : '', at: now() }); } else S.pending = null;
    render();
    fastReads();
    if (ct && !lat.wait) ctMarks(body, lat);
  }
}
const ms0 = (lat, k) => (lat && lat[k] ? Math.max(0, Math.round(lat[k] - lat.t0)) : undefined);
function ctMarks(body, lat) {
  if (!lat || lat.sentMarks || !CT.link || !body.idemKey) return; lat.sentMarks = true;
  const m = { c_cf: ms0(lat, 'cf'), c_open: ms0(lat, 'open'), c_send: ms0(lat, 'send'), c_ack: ms0(lat, 'ack'), c_toast: ms0(lat, 'toast'), c_fill: ms0(lat, 'fillAt') };
  S.lat = Object.assign({ at: Date.now(), op: body.op }, m, lat.watch && lat.watch.server ? lat.watch.server : {}); window.__stkLat = S.lat;
  CT.link.marks(body.idemKey, m);
}
const pxTxt = (v, tick) => { const d = tick > 0 ? Math.max(0, Math.min(8, Math.round(-Math.log10(tick)))) : 2; return Number(v).toFixed(d); };
function ctToast(what, r, lat) {
  const st = String(r.status || ''), tick = lat.tick || 0;
  const done = (msg) => { toast(msg, 'success'); lat.toast = performance.now(); };
  if (/FILL/.test(st)) { lat.fillAt = lat.ack; done(what + ' filled' + (r.price ? ' @ ' + pxTxt(r.price, tick) : '') + '.'); return; }
  if (r.fill && typeof r.fill.then === 'function') {   // a market order cTrader accepted first: the fill event follows
    lat.wait = true;
    r.fill.then((p) => { lat.wait = false; if (p) { lat.fillAt = performance.now(); done(what + ' filled @ ' + pxTxt(p, tick) + '.'); } else done(what + ': cTrader accepted it. The fill shows in your positions.'); ctMarks(lat.body, lat); });
    return;
  }
  done(what + (/ACCEPTED|PENDING/.test(st) || !st ? ': order accepted by cTrader.' : ' sent. cTrader status: ' + st.toLowerCase().replace(/_/g, ' ') + '.'));
}
// read soon after a write (fill / working order shows within ~¼ s), then a few more, then the normal poll
let fastT = [];
function fastReads() { fastT.forEach(clearTimeout); fastT = L.FAST_READS_MS.map((ms) => setTimeout(() => { if (S.acct) read(); }, ms)); }
const sideWord = (s) => (s === 'buy' ? 'BUY' : 'SELL');
function contractLine(i) { return 'Contract <b>' + esc(i.code) + '</b>' + (i.held ? ' (your open position’s month; front month is ' + esc(i.front) + ')' : ' (front month of ' + esc(i.root) + ')'); }
async function place(sym, o, src) {
  if (S.acct && S.acct.mt) return placeMt(sym, o, src);
  if (S.acct && !S.envBusy && (!S.env || now() - S.envAt > ENV_MAX_AGE)) await envCheck();   // re-check right before a confirm if older than 60 s
  if (S.env && S.env.consent === false && S.env.blocked !== true) { enableLive(); return null; }   // one-time step; the order is not sent
  const why = blockReason(); if (why) { toast(why, 'error'); return null; }
  const i = info(sym); if (!i) { toast(noLiveWhy(sym), 'error'); return null; }
  const qty = Math.round(Number(o.qty));
  if (!(qty >= 1)) { toast('Enter a quantity of 1 or more.', 'error'); return null; }
  if (o.type !== 'market') { const band = L.priceBandError(Number(o.price), i.last); if (band) { toast(band, 'error'); return null; } }
  if (o.type === 'stop' && i.last > 0 && (o.side === 'buy' ? Number(o.price) <= i.last : Number(o.price) >= i.last)) { toast('A buy stop goes above the price, a sell stop below it.', 'error'); return null; }
  const br = o.sl != null || o.tp != null;
  if (br && !caps().bracket) { toast(caps().why, 'error'); return null; }
  if (br && groupOpen(i.code)) { toast('A stop loss / take profit is already open on ' + i.code + '. Flatten or wait for it to finish first.', 'error'); return null; }
  const b = L.buildPlace({ code: i.code, side: o.side, qty, type: o.type, price: o.price, sl: o.sl, tp: o.tp, last: i.last, asset: i.asset, tick: i.tick }, now()); if (b.error) { toast(b.error, 'error'); return null; }
  const desc = sideWord(o.side) + ' ' + qty + ' ' + i.code + ' ' + (o.type === 'market' ? 'MARKET' : o.type === 'stop' ? 'STOP @ ' + px(b.body.stopPrice) : 'LIMIT @ ' + px(b.body.limitPrice));
  // no confirm (Owner order 19 Nov): the order goes out on the click, like paper; every guard above and on the server still applies
  // double-click guard: the identical order again within 500 ms is dropped (not an order limit: a different order goes straight out)
  { const sig = JSON.stringify(b.body), t = now(); if (S.lastSend && S.lastSend.sig === sig && t - S.lastSend.at < L.DUP_MS) return null; S.lastSend = { sig, at: t }; }
  const body = Object.assign(b.body, { idemKey: uuid() }, S.acct.b3 ? { tick: i.tick, ref: i.last } : {});
  const r = await write(body, desc + (src ? ' (' + src + ')' : ''), L.pendingLine(body, i.last));
  if (r && br && r.nativeBracket) { toast('Stop loss and take profit are held at ' + S.acct.broker + ' and go live when the entry fills.', 'info'); return r; }
  if (r && br) { setGroup(r.bracket || null, i.code); if (r.bracket && r.bracket.state === 'unrecorded') toast(r.bracket.why, 'error'); else toast('Stop loss and take profit go to your broker after the entry fills. Keep this tab open until they are placed.', 'info'); }
  return r;
}
// MetaTrader: lots, the broker symbol, market / limit / stop (limit / stop only when the chart is the broker's own instrument), no TradeZoro size limit
// every server guard of the futures path applies (kill switch, audit, read gate)
async function placeMt(sym, o, src) {
  const lat = S.acct && S.acct.ct ? { t0: performance.now() } : null;
  if (!S.envBusy && (!S.env || now() - S.envAt > ENV_MAX_AGE)) await envCheck();
  if (isOwn(S.acct) && S.env && S.env.consent === false && S.env.blocked !== true) { enableLive(); return null; }   // one-time step; nothing sent
  const why = blockReason(); if (why) { if (/^Pick the .* symbol/.test(why)) toastAct(why, 'Choose', () => openSymPicker(sym), 'error'); else toast(why, 'error'); return null; }
  const i = infoMt(sym); if (!i) { toast('This chart has no ' + S.acct.mt + ' symbol. Open an index, gold, oil or forex chart.', 'error'); return null; }
  if (!i.code) { toastAct('Pick the ' + S.acct.mt + ' symbol for ' + i.map.label + ' first.', 'Choose', () => openSymPicker(sym), 'error'); return null; }
  if ((o.sl != null || o.tp != null) && !(i.ct && i.map.same)) { toast(i.ct ? CT_NO_SLTP : MT_NO_SLTP, 'error'); return null; }
  if (i.ct && !i.lots.fromSchema) { toast('The size rules for ' + i.code + ' are still loading. Try again in a moment.', 'error'); return null; }
  const qty = L.roundLots(o.qty, i.lots);
  if (!qty) { toast('Size is ' + i.lots.min + ' to ' + i.lots.max + ' lots.', 'error'); return null; }
  if (o.type !== 'market') { const band = L.priceBandError(Number(o.price), i.last); if (band) { toast(band, 'error'); return null; } }
  const b = L.buildPlaceMt({ sym: i.code, side: o.side, qty, type: o.type, price: o.price, lots: i.lots, same: i.map.same, asset: L.mtAsset(S.placeSchema) }); if (b.error) { toast(b.error, 'error'); return null; }
  const body = Object.assign(b.body, { idemKey: uuid() }, i.ct && o.sl != null ? { sl: o.sl } : {}, i.ct && o.tp != null ? { tp: o.tp } : {});
  if (i.ct) { const sig = JSON.stringify(Object.assign({}, body, { idemKey: '' })), t = now(); if (S.lastSend && S.lastSend.sig === sig && t - S.lastSend.at < L.DUP_MS) return null; S.lastSend = { sig, at: t }; }   // double-click guard
  const desc = sideWord(o.side) + ' ' + lotTxt(qty) + ' ' + i.code + ' ' + (o.type === 'market' ? 'MARKET' : o.type.toUpperCase() + ' @ ' + pxd(Number(body.limitPrice || body.stopPrice), i.tick));
  const pl = i.map.same ? L.pendingLine(body, i.last) : null; if (pl && i.ct) Object.assign(pl, { sl: Number(body.sl) > 0 ? Number(body.sl) : null, tp: Number(body.tp) > 0 ? Number(body.tp) : null });   // cTrader: SL / TP lines from the click too
  if (lat) { lat.tick = i.tick; lat.body = body; lat.cf = performance.now(); }   // c_cf: the chart's own checks done, the order leaves
  return write(body, desc + (src ? ' (' + src + ')' : ''), pl, lat);
}

// ------------------------------------------------------------------------------------------ AUTO-TPSL: stop loss / take profit of an open cTrader position
// (Owner bug 25 Nov \"cant set tp and sl\"). Set from the chart (hover / tap the position line -> TP and SL handles; drag one to its level),
// moved by dragging the TP / SL line, removed with its x, or typed in the Positions & Orders dock. Every path ends in setSlTp(): the read
// gate, the kill switch, Enable live trading, a side check against the latest bid / ask and the symbol's minimum distance (clear text,
// nothing sent when wrong), the Trade display confirm setting, then ONE AmendPositionSLTPReq (2110) through the trade relay, which
// re-checks the position id, every gate, the account lock and writes the audit row before anything reaches cTrader. Never retried.
let balT = 0;
function balSoon() { clearTimeout(balT); balT = setTimeout(() => { if (S.acct) { balance(S.acct.id, true); dayFills(true); } }, 700); }
const ctPosRecs = (code) => S.data.positions.filter((p) => p && L.matches(p, code) && Number(p.quantity) && p.positionId != null);
// the one cTrader position on this symbol (the chart's handles need exactly one; several = set them per row in the dock)
function ctPosOf(code) { const r = ctPosRecs(code); return r.length === 1 ? r[0] : null; }
const ctPosById = (id) => S.data.positions.find((p) => p && String(p.positionId) === String(id) && Number(p.quantity)) || null;
// the money of ONE position at a price (USD-quoted symbols only, else null): (price - entry) x units
function ctPnlOne(code, p, price) {
  if (!Number.isFinite(price) || !(Number(p.averagePrice) > 0) || !(Number(p.volume) > 0)) return null;
  const K = String(code).toUpperCase(), qa = CT.link && CT.link.quote && CT.link.quote.get(K), as = CT.link && CT.link.assets && qa ? CT.link.assets.find((a) => a && Number(a.assetId) === qa) : null;
  if (!(as ? String(as.name || as.displayName || '').toUpperCase() === 'USD' : /USD$/.test(K))) return null;
  return Math.round((price - Number(p.averagePrice)) * (Number(p.quantity) < 0 ? -1 : 1) * Number(p.volume) / 100 * 100) / 100;
}
// the latest bid / ask of a cTrader symbol: the trading account's own price stream, else the broker chart's last price (= its bid)
let QUO = null;
function quoteFor(code) {
  if (!QUO) import('./byo-ctrader.js?v=1290').then((m) => { QUO = m.quoteOf; }).catch(() => {});
  const q = QUO ? QUO(code) : null; if (q && q.bid > 0) return q;
  let b = P && P.lastPrice ? P.lastPrice('byo:CT:' + code) : undefined;
  if (!(b > 0) && TEST && TEST.quote) { const t = TEST.quote(code); if (t) return t; }
  if (!(b > 0) && TEST && TEST.last) b = TEST.last('byo:CT:' + code);
  return b > 0 ? { bid: b, ask: null } : null;
}
const symDetail = (code) => { const id = CT.link && CT.link.byName.get(String(code || '').toUpperCase()); return id ? CT.link.details.get(id) || null : null; };
// a TP / SL line at a price: { pnl: '+$12.40' | '', err: 'A buy’s …' | '' } for the chip while it is dragged or shown
function sltpPreview(sym, l) {
  const role = l.slRole || l.role, p = l.posId ? ctPosById(l.posId) : null, i = infoMt(sym); if (!p || !i || !CT.mod) return { pnl: '', err: '' };
  const side = Number(p.quantity) > 0 ? 'buy' : 'sell', want = { sl: null, tp: null }; want[role] = l.price;
  const c = CT.mod.sltpCheck({ side }, want, quoteFor(i.code), symDetail(i.code));
  const v = ctPnlOne(i.code, p, l.price);
  return { pnl: v == null ? '' : moneyU(v), err: c.error ? 'Wrong side' : '' };
}
// k 'sl' | 'tp', v = the new level (null = remove it). src 'chart' | 'dock'. -> Promise<{ ok } | { error }>
export async function setSlTp(posId, k, v, src) {
  if (!S.acct || !S.acct.ct || !CT.ops) return { error: 'Stop loss and take profit can be set here for cTrader positions.' };
  const what = k === 'sl' ? 'Stop loss' : 'Take profit', fail2 = (m) => { toast(m, 'error'); return { error: m }; };
  if (S.busy) return fail2('Another order is still on its way. Wait for its answer.');
  if (!S.envBusy && (!S.env || now() - S.envAt > ENV_MAX_AGE)) await envCheck();
  if (S.env && S.env.consent === false && S.env.blocked !== true) { enableLive(); return { error: 'Enable live trading first.' }; }
  const why = blockReason(); if (why && !/^Pick the .* symbol/.test(why)) return fail2(why);
  const p = ctPosById(posId); if (!p) return fail2('That position is not open any more.');
  const code = String(p.symbol || ''), tick = codeTick(code), side = Number(p.quantity) > 0 ? 'buy' : 'sell';
  const cur = { sl: Number(p.stopLoss) > 0 ? Number(p.stopLoss) : null, tp: Number(p.takeProfit) > 0 ? Number(p.takeProfit) : null };
  const want = Object.assign({}, cur, { [k]: v == null || v === '' ? null : Number(Number(v).toFixed(decOf(tick))) });
  if (want[k] != null && cur[k] != null && Math.abs(want[k] - cur[k]) < tick / 2) return { ok: true, same: true };
  const q = quoteFor(code), d = symDetail(code);
  // only the level that changes is checked against the market (the other one is cTrader's own, already accepted)
  if (want[k] != null) { const c = CT.mod.sltpCheck({ side }, { [k]: want[k] }, q, d); if (c.error) return fail2(c.error); }
  const lvl = want[k] == null ? '' : pxd(want[k], tick);
  const tv = window.__stkTradeView && window.__stkTradeView.get ? window.__stkTradeView.get() : null;
  if (tv && tv.confirm && tv.master) {
    const pnl = want[k] == null ? null : ctPnlOne(code, p, want[k]);
    const lv0 = (v) => (v == null ? 'None' : pxd(v, tick)), chg = (kk) => (kk === k ? (cur[kk] == null && want[kk] == null ? 'None' : lv0(cur[kk]) + ' → ' + lv0(want[kk])) : lv0(cur[kk]));
    const ok = await confirmSheet({ title: 'Change stop loss and take profit', sub: code + ' · ' + (side === 'buy' ? 'Buy' : 'Sell') + ' · ' + lotTxt(Math.abs(Number(p.quantity))), code, side: 'buy', go: 'Confirm change', dontShow: true,
      rows: [['Entry price', pxd(p.averagePrice, tick)], ['Stop loss', esc(chg('sl'))], ['Take profit', esc(chg('tp'))]] });
    if (!ok) return { error: 'Cancelled.' };
  }
  const body = { op: 'sltp', positionId: String(p.positionId), symbolId: Number(p.symbolId) || 0, side, sl: want.sl, tp: want.tp, check: k, bid: q && q.bid, ask: q && q.ask, idemKey: uuid() };
  const done = want[k] == null ? what + ' removed.' : what + ' set at ' + lvl + '.';
  const r = await write(body, what + ' ' + code, null, null, done);   // refused: "Take profit EURUSD refused: <cTrader's reason>"
  if (!r) return { error: what + ' was not changed.' };
  // the next read confirms it; draw the new level now
  const rec = ctPosById(posId); if (rec) { rec.stopLoss = want.sl == null ? undefined : want.sl; rec.takeProfit = want.tp == null ? undefined : want.tp; render(); }
  return { ok: true };
}
export const removeSlTp = (posId, k) => setSlTp(posId, k, null, 'chart');
// a drag on the chart ended: d.slRole (a new level from the position's handle) or d.id 'SP<pos>' / 'TP<pos>' (an existing one moved)
function dragSlTp(sym, d) {
  const m = /^([ST])P(.+)$/.exec(String(d.id || '')), k = d.slRole || (m && m[1] === 'S' ? 'sl' : 'tp'), pid = d.posId || (m && m[2]);
  if (!pid) return null;
  return setSlTp(pid, k, d.price, 'chart');
}
// OWNER STYLE: the ask as a small dark tag on the price scale of the broker's own cTrader chart (the last-price tag is the bid)
export function quoteTags(sym) { const i = S.acct && S.acct.ct ? infoMt(sym) : null; if (!i || !i.code || !i.map.same) return []; const q = quoteFor(i.code); return q && q.ask > 0 ? [{ price: q.ask, color: '#2a2e39', text: pxd(q.ask, i.tick), kind: 'ask' }] : []; }
// the chart's position chip asks which handles to show: { posId, sl: has one, tp: has one } | null
export function posHandles(sym) { const i = S.acct && S.acct.ct ? infoMt(sym) : null; if (!i || !i.code || !i.map.same) return null; const p = ctPosOf(i.code); return p ? { posId: String(p.positionId), sl: Number(p.stopLoss) > 0, tp: Number(p.takeProfit) > 0, side: Number(p.quantity) > 0 ? 'buy' : 'sell', avg: Number(p.averagePrice), qty: Math.abs(Number(p.quantity)) } : null; }
const MT_NO_SLTP = 'Stop loss and take profit for MetaTrader: set them in MetaTrader for now.';
const CT_NO_SLTP = 'This chart’s prices are not your broker’s prices for this symbol, so stop loss and take profit can’t be set from here.';
// ---- stop loss / take profit: after every positions read, ask the server to move the group on (place the children after the fill,
// one-cancels-other when one fills). The server decides and acts from its own record and a fresh read; this only triggers it.
const groupOpen = (code) => !!(S.group && S.group.state !== 'closed' && (!code || S.group.code === code));
function setGroup(g, code) {
  S.group = g && g.state !== 'closed' && g.state !== 'unrecorded' ? g : null; S.groupCode = code || (g && g.code) || S.groupCode;
  if (g && g.state === 'closed' && g.why) toast(g.why + ' Stop loss / take profit finished.', 'info');
  if (S.group && S.group.state === 'unprotected' && S.group.why && S.alarmSeen !== S.group.why) { S.alarmSeen = S.group.why; toast(S.group.why, 'error'); }
  render();
}
let syncT = 0;
function syncSoon() { clearTimeout(syncT); syncT = setTimeout(syncGroup, 50); }
async function syncGroup() {
  if (!S.acct || S.acct.mt || S.syncing || !S.env || S.env.enabled === false) return;   // no server SL / TP group on MetaTrader
  const i = P && P.activeSymbol ? info(P.activeSymbol()) : null;
  const code = S.group ? S.group.code : i ? i.code : ''; if (!code) return;
  if (!S.group && S.groupCode === code) return;   // already checked this contract since the account was picked: nothing open
  S.syncing = true; const id = S.acct.id;
  try { const r = await order({ op: 'bracket', symbol: code }); if (S.acct && S.acct.id === id) { S.groupCode = code; setGroup(r.group, code); if (r.did && /closed|placed|oco/.test(r.did)) fastReads(); } const cp = window.__stkCopy; if (cp && cp.active(id)) cp.sync(code); }
  catch (e) { /* the next read retries */ }
  finally { S.syncing = false; }
}
const posText = (i) => (i.pos.qty ? (i.pos.qty > 0 ? 'long ' : 'short ') + Math.abs(i.pos.qty) + (i.pos.avg ? ' @ ' + px(i.pos.avg) : '') : 'flat') + (i.working.length ? ', ' + i.working.length + ' working order' + (i.working.length === 1 ? '' : 's') : '');
export async function cancel(oid) {
  if (!S.acct || S.busy) return null;
  const o = S.data.orders.find((x) => String(x.orderId) === String(oid));
  return write({ op: 'cancel', orderId: String(oid), idemKey: uuid() }, 'Cancel' + (o ? '' : ''));
}
export async function flatten(sym) {
  if (!S.acct || S.busy) return null;
  if (isOwn(S.acct) && S.acct.mt) return flattenCt(sym);
  if (S.acct.mt) { toast('Close ' + S.acct.mt + ' positions in MetaTrader for now. Working orders can be cancelled here.', 'info'); return null; }
  if (S.env && S.env.enabled === false) { toast('Live orders are off on the server.', 'error'); return null; }
  if (!S.lastOkStart) { toast('Positions are still loading.', 'error'); return null; }
  const i = info(sym); if (!i) { toast('Open the chart of the position to flatten it.', 'error'); return null; }
  if (!i.pos.qty && !i.working.length) { toast('Nothing to flatten on ' + i.code + '.', 'info'); return null; }
  const ok = await confirmSheet({ title: 'Flatten ' + i.code, code: i.code, side: i.pos.qty > 0 ? 'sell' : 'buy', go: 'Flatten ' + i.code,
    lines: [contractLine(i), 'Cancels ' + i.working.length + ' working order' + (i.working.length === 1 ? '' : 's') + (groupOpen(i.code) ? ' (including the stop loss and take profit)' : '') + ', then closes the position at market (' + posText(i) + ').', 'The server re-reads the position first and closes what it finds there.'] });
  if (!ok) return null;
  if (groupOpen(i.code)) { S.group = null; S.groupCode = ''; }   // the server cancels the children and drops the record; re-read after
  return write({ op: 'flatten', symbol: i.code, idemKey: L.flattenKey(S.acct.id, i.code, i.pos.qty, String(S.lastOkStart)) }, 'Flatten ' + i.code);
}

// cTrader: flatten one broker symbol (the chart's mapped symbol, or a code straight from the positions list). One tap to confirm;
// ctOps cancels the symbol's working orders, then closes each position, one write at a time, each with its own key.
async function flattenCt(symOrCode) {
  if (S.env && S.env.enabled === false) { toast('Live orders are off on the server.', 'error'); return null; }
  if (!S.lastOkStart) { toast('Positions are still loading.', 'error'); return null; }
  const i = symOrCode && P && P.activeSymbol && symOrCode === P.activeSymbol() ? infoMt(symOrCode) : null;
  const code = i ? i.code : String(symOrCode || ''); if (!code) { toastAct('Pick the ' + S.acct.mt + ' symbol for this chart first.', 'Choose', () => openSymPicker(P.activeSymbol && P.activeSymbol()), 'error'); return null; }
  const pos = L.netPosition(S.data.positions, code), working = L.workingOrders(S.data.orders, code);
  if (!pos.qty && !working.length) { toast('Nothing to flatten on ' + code + '.', 'info'); return null; }
  const ok = await confirmSheet({ title: 'Close position', sub: code + (pos.qty ? ' · ' + (pos.qty > 0 ? 'Buy' : 'Sell') + ' · ' + lotTxt(Math.abs(pos.qty)) : ''), code, side: pos.qty > 0 ? 'sell' : 'buy', go: 'Close ' + code,
    rows: [['Symbol', esc(code)], ['Position', pos.qty ? (pos.qty > 0 ? 'Long ' : 'Short ') + lotTxt(Math.abs(pos.qty)) : 'None'], ['Working orders', working.length ? working.length + ' (cancelled first)' : 'None'], ['Closes at', 'Market']] });
  if (!ok) return null;
  return write({ op: 'flatten', symbol: code, idemKey: L.flattenKey(S.acct.id, code, pos.qty, String(S.lastOkStart)) }, 'Flatten ' + code);
}

// ---- read-only copy of the poll data for the Positions & Orders dock (assets/chart-posorders.js). No new routes: positions/orders come from
// the 10 s poll, balances from balance(). Trade history: broker-link accounts read the existing data op "fills"; cTrader reads its own deal
// list (DealListReq) and order list (OrderListReq) for the last 7 days on the open trade link (read-only). Re-read every 30 s while the tab
// is open and at once on an execution event (Owner bug 25 Nov 2026: "No trades yet" on a cTrader account that had traded).
S.fills = { at: 0, busy: false, rows: null };
S.hist = { id: '', th: { at: 0, busy: false, rows: null, err: '' }, oh: { at: 0, busy: false, rows: null, err: '' } };
const HIST_MS = 30000;
const first = (o, ks) => { for (const k of ks) if (o && o[k] != null && o[k] !== '') return o[k]; return ''; };
function histReset(id) { S.hist = { id, th: { at: 0, busy: false, rows: null, err: '' }, oh: { at: 0, busy: false, rows: null, err: '' } }; S.fills = { at: 0, busy: false, rows: null }; }
// one history read for the active account; kind 'th' (trades) | 'oh' (orders, cTrader only: the others derive it from the poll)
function histLoad(kind, force) {
  if (!S.acct) return;
  const id = S.acct.id; if (S.hist.id !== id) histReset(id);
  const h = S.hist[kind]; if (h.busy || (!force && now() - h.at < HIST_MS)) return;
  if (S.acct.ct) {
    h.busy = true; h.at = now();
    data(kind === 'th' ? 'deals' : 'orders', { accountId: id }).then((r) => { if (S.hist.id === id) Object.assign(S.hist[kind], { at: now(), busy: false, rows: Array.isArray(r.data) ? r.data : [], err: '' }); },
      (e) => { if (S.hist.id === id) Object.assign(S.hist[kind], { at: now(), busy: false, err: 'Couldn’t load ' + (kind === 'th' ? 'trade' : 'order') + ' history from cTrader.' + (e && e.message && !/did not answer|closed/i.test(e.message) ? ' ' + e.message : '') }); });
    return;
  }
  if (kind !== 'th') return;
  if (S.acct.b3) { Object.assign(h, { at: now(), rows: [], err: '' }); return; }   // BROKERS 3: no fill history route yet (dock says so)
  const ids = S.data.orders.filter((o) => /FILLED/i.test(o.status || '')).map((o) => String(o.orderId || o.id || '')).filter((x) => /^[A-Za-z0-9._:-]{1,80}$/.test(x)).slice(0, 25);
  if (!ids.length) { Object.assign(h, { at: now(), rows: [], err: '' }); S.fills = { at: now(), busy: false, rows: [] }; return; }
  h.busy = true; h.at = now(); S.fills.busy = true;
  data('fills', { accountId: id, orderIds: ids }).then((r) => { if (S.hist.id !== id) return; const rows = Array.isArray(r.data) ? r.data : []; S.fills = { at: now(), busy: false, rows }; Object.assign(h, { at: now(), busy: false, rows, err: '' }); },
    () => { if (S.hist.id !== id) return; S.fills.busy = false; S.fills.at = now(); Object.assign(h, { at: now(), busy: false, err: 'Couldn’t load trade history from ' + (S.acct.broker || 'your broker') + '.' }); });
}
// tab: 'th' | 'oh' | undefined (both); force = read now (Retry button, an execution event)
export function dockTrades(force, tab) {
  if (!S.acct) return;
  if (!tab || tab === 'th') histLoad('th', force);
  if (S.acct.ct && (!tab || tab === 'oh')) histLoad('oh', force);
}
// an execution event on the picked account: history re-read now (and once more shortly after: a deal can land a moment after its event)
let histT = [];
function histSoon() { histT.forEach(clearTimeout); histT = [600, 3000].map((ms) => setTimeout(() => { if (S.acct && (S.hist.th.rows || S.hist.oh.rows)) dockTrades(true); }, ms)); }
export function dock(tab) {
  if (!S.acct) return null;
  if (S.hist.id !== S.acct.id) histReset(S.acct.id);
  if (tab === 'th' || tab === 'oh') dockTrades(false, tab);   // throttled: one read per 30 s while that tab is open
  const codes = new Set(), add = (c) => { if (c) codes.add(c); };
  const symOf = S.acct.mt ? (r) => String((r && (r.symbol || r.brokerProvidedSymbol || (r.instrument && r.instrument.providerSymbol))) || '') : L.contractOf;
  S.data.positions.forEach((p) => add(symOf(p))); S.data.orders.forEach((o) => add(symOf((o.legs || [])[0] || {}) || symOf(o)));
  const pos = [], ord = [];
  for (const code of codes) {
    const n = L.netPosition(S.data.positions, code), root = L.rootOfCode(code), pv = L.pvOfCode(code);
    if (n.qty && S.acct.mt) { const ownLast = S.acct.ct && P.lastPrice ? P.lastPrice('byo:CT:' + code) : undefined, ok = Number.isFinite(ownLast) && ownLast > 0, tk = codeTick(code);   // cTrader: the broker's own chart price when that chart is open
      // AUTO-TPSL: cTrader positions one row each (each has its own stop loss / take profit, editable in the row)
      const recs = S.acct.ct ? S.data.positions.filter((p) => p && L.matches(p, code) && Number(p.quantity)) : [];
      if (recs.length) for (const p of recs) { const q = Number(p.quantity), one = { qty: q, avg: Number(p.averagePrice) || null };
        pos.push({ sym: code, side: q > 0 ? 'Long' : 'Short', buy: q > 0, qty: Math.abs(q).toFixed(2), avg: pxd(one.avg, tk), last: ok ? pxd(ownLast, tk) : '—', pnl: ok ? ctPnlOne(code, p, ownLast) : null,
          sl: Number(p.stopLoss) > 0 ? pxd(Number(p.stopLoss), tk) : '', tp: Number(p.takeProfit) > 0 ? pxd(Number(p.takeProfit), tk) : '', posId: String(p.positionId), slRaw: Number(p.stopLoss) > 0 ? Number(p.stopLoss) : null, tpRaw: Number(p.takeProfit) > 0 ? Number(p.takeProfit) : null, dec: decOf(tk),
          setLevel: (k, v) => setSlTp(String(p.positionId), k, v, 'dock'), close: () => flattenCt(code) }); }
      else pos.push({ sym: code, side: n.qty > 0 ? 'Long' : 'Short', buy: n.qty > 0, qty: Math.abs(n.qty).toFixed(2), avg: pxd(n.avg, tk), last: ok ? pxd(ownLast, tk) : '—', pnl: n.upl != null ? n.upl : ok ? ctPnl(code, n, ownLast) : null, close: () => (isOwn(S.acct) ? flattenCt(code) : flatten()) }); }
    else if (n.qty) { const last = P.lastPrice && root ? P.lastPrice(root + '1!') : undefined; pos.push({ sym: code, side: n.qty > 0 ? 'Long' : 'Short', buy: n.qty > 0, qty: Math.abs(n.qty), avg: px(n.avg), last: px(last), pnl: pv ? L.openPnl(n.qty, n.avg, Number.isFinite(last) ? last : null, pv, n.upl) : n.upl, close: () => flatten(L.chartSymOf(code)) }); }
    const tk = S.acct.mt ? codeTick(code) : 0.01, pf = (v) => (S.acct.mt ? pxd(v, tk) : px(v));
    for (const o of L.workingOrders(S.data.orders, code)) { const r = S.data.orders.find((x) => String(x.orderId || x.id || '') === o.id) || {};
      ord.push({ sym: code, side: o.side === 'buy' ? 'Buy' : 'Sell', buy: o.side === 'buy', type: (o.type || '').replace(/^./, (c) => c.toUpperCase()), qty: S.acct.mt ? Number(o.qty).toFixed(2) : o.qty, price: o.price ? pf(o.price) : '—',
        sl: Number(r.stopLoss) > 0 ? pf(Number(r.stopLoss)) : '—', tp: Number(r.takeProfit) > 0 ? pf(Number(r.takeProfit)) : '—', t: r.placedAt || 0,
        status: o.cancelling ? 'Cancelling' : 'Working', cancel: o.cancelling ? null : () => cancel(o.id) }); }
    // AUTO-TPSL (Owner bug 25 Nov "Open orders says No open orders"): a cTrader position's stop loss / take profit are working orders at
    // cTrader, so they are listed here too (closing side, the position's size); x removes that level (AmendPositionSLTP without it)
    if (S.acct.ct) for (const p of S.data.positions) {
      if (!p || !L.matches(p, code) || !Number(p.quantity)) continue;
      const q = Number(p.quantity), cs = q > 0 ? 'sell' : 'buy', pid = String(p.positionId || '');
      for (const [k, v] of [['sl', Number(p.stopLoss)], ['tp', Number(p.takeProfit)]]) if (v > 0) ord.push({ sym: code, side: cs === 'buy' ? 'Buy' : 'Sell', buy: cs === 'buy', type: k === 'sl' ? 'Stop loss' : 'Take profit', qty: Math.abs(q).toFixed(2), price: pf(v), sl: '—', tp: '—', t: p.openedAt || 0, status: 'Protects position ' + pid, prot: k, cancel: () => removeSlTp(pid, k) });
    }
  }
  const done = S.data.orders.filter((o) => !L.workingOrders([o], L.contractOf((o.legs || [])[0] || {}) || L.contractOf(o)).length);
  const oh = done.map((o) => { const leg = (o.legs || [])[0] || {}, s = String(leg.side || o.side || o.action || '').toLowerCase(); return { t: first(o, ['updatedAt', 'filledAt', 'createdAt', 'submittedAt', 'timestamp']), sym: L.contractOf(leg) || L.contractOf(o) || '—', side: s === 'buy' ? 'Buy' : s === 'sell' ? 'Sell' : '—', buy: s === 'buy', qty: first(leg, ['quantity']) || first(o, ['orderQty', 'quantity']) || '—', price: px(Number(first(o, ['averageFillPrice', 'avgFillPrice', 'limitPrice', 'price']) || first(leg, ['limitPrice', 'price'])) || null), note: String(o.status || '').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()) }; })
    .sort((a, b) => String(b.t).localeCompare(String(a.t))).slice(0, 100);
  const sm = summary(), cur = sm && sm.cur, fm = (v, sign) => (v == null ? '—' : L.fmtMoney(v, cur, sign));
  let th, oh2 = oh, thErr = S.hist.th.err, ohErr = '', thNote = '', thExt = null;
  if (S.acct.ct) {
    const lot = (q) => (Number.isFinite(q) ? q.toFixed(2) : '—');
    thExt = ['Commission', 'Swap'];
    th = S.hist.th.rows == null ? null : S.hist.th.rows.map((d) => ({ t: d.t, sym: d.sym, side: (d.side === 'buy' ? 'Buy' : 'Sell') + (d.closing ? ' · close' : ''), buy: d.side === 'buy', qty: lot(d.lots), price: d.price != null ? pxd(d.price, codeTick(d.sym)) : '—', pnl: d.closing ? d.gross : null, pnlTxt: d.closing ? fm(d.gross, true) : '—', ext: [fm(d.commission, true), d.closing ? fm(d.swap, true) : '—'], extN: [d.commission, d.closing ? d.swap : null] }));
    oh2 = S.hist.oh.rows == null ? null : S.hist.oh.rows.slice(0, 200).map((o) => ({ t: o.t, sym: o.sym, side: o.side === 'buy' ? 'Buy' : 'Sell', buy: o.side === 'buy', qty: lot(o.lots), price: o.price != null ? pxd(o.price, codeTick(o.sym)) : '—', note: o.status + (o.type ? ' · ' + o.type : '') }));
    ohErr = S.hist.oh.err;
  } else {
    th = S.hist.th.rows == null ? null : S.hist.th.rows.map((f) => { const s = String(first(f, ['side', 'action'])).toLowerCase(); return { t: first(f, ['filledAt', 'timestamp', 'createdAt', 'executedAt', 'time']), sym: L.contractOf(f) || '—', side: s === 'buy' ? 'Buy' : s === 'sell' ? 'Sell' : '—', buy: s === 'buy', qty: first(f, ['quantity', 'qty', 'units']) || '—', price: px(Number(first(f, ['price', 'fillPrice', 'executionPrice'])) || null), pnl: null }; }).sort((a, b) => String(b.t).localeCompare(String(a.t)));
    if (S.acct.b3) thNote = 'Trade history from ' + (S.acct.broker || 'this broker') + ' isn’t available here yet. Your filled orders are under Order history.';
  }
  const bal = [];
  if (sm && sm.bal != null) { bal.push(['Balance' + (sm.age ? ' (' + sm.age + ')' : ''), L.fmtMoney(sm.bal, sm.cur)]); if (sm.rp != null) bal.push(['Realized P&L today', L.fmtMoney(sm.rp, sm.cur, true), sm.rp]); if (sm.up != null) bal.push(['Open P&L', L.fmtMoney(sm.up, sm.cur, true), sm.up]); }
  if (tab === 'bal' && S.acct) balance(S.acct.id);   // AUTO-TPSL: the Balances tab re-reads every 30 s while it is open (cached in between)
  return { live: true, pos, ord, oh: oh2, th, thErr, ohErr, thNote, thExt, thDays: S.acct.ct ? 7 : 0, bal, cancelAll: null, nPos: pos.length, nOrd: ord.length, sltp: !!S.acct.ct };
}
// drag a working order line to a new price
export async function drag(sym, d) {
  if (d && (d.slRole || /^[ST]P/.test(String(d.id || '')))) return dragSlTp(sym, d);   // AUTO-TPSL: a position's stop loss / take profit
  const oid = String(d.id).replace(/^L/, ''); const i = info(sym); if (!i) return;
  const o = i.working.find((x) => x.id === oid); if (!o) { toast('That order is no longer working.', 'info'); return; }
  const why = blockReason(); if (why) { toast(why, 'error'); return; }
  const kind = /stop/.test(o.type || '') ? 'stop' : 'limit';
  if (i.mt) {   // lines only exist when the chart is the broker's own instrument; move in place, never cancel + new
    if (S.modifyOk === false) { toast('This broker can’t move an order in place. Change it in MetaTrader.', 'error'); return; }
    const band = L.priceBandError(d.price, i.last); if (band) { toast(band, 'error'); return; }
    const np = Number((Math.round(d.price / i.tick) * i.tick).toFixed(decOf(i.tick)));
    const ok = await confirmSheet({ title: 'Move order', sub: i.code + ' · ' + (o.side === 'buy' ? 'Buy' : 'Sell') + ' · ' + lotTxt(o.qty) + ' · ' + (kind === 'stop' ? 'Stop' : 'Limit'), code: i.code, side: o.side, go: 'Confirm change',
      rows: [['Price', pxd(o.price, i.tick) + ' → ' + pxd(np, i.tick)]] });
    if (!ok) return;
    await write(Object.assign({ op: 'modify', orderId: oid, type: kind, symbol: i.code }, kind === 'stop' ? { stopPrice: np } : { limitPrice: np }, { idemKey: uuid() }), 'Move');
    return;
  }
  if (o.type && o.type !== 'limit' && o.type !== 'stop') { toast('Only limit and stop orders can be moved here.', 'info'); return; }
  const band = L.priceBandError(d.price, i.last); if (band) { toast(band, 'error'); return; }
  const m = L.buildModify({ id: oid, price: d.price, code: i.code, type: kind }); if (m.error) { toast(m.error, 'error'); return; }
  const np = kind === 'stop' ? m.body.stopPrice : m.body.limitPrice;
  const g = S.group && S.group.code === i.code ? S.group : null, role = g && g.slId === oid ? 'sl' : g && g.tpId === oid ? 'tp' : '';
  const native = S.modifyOk !== false;
  if (role) {   // a stop loss / take profit: moved in place only (cancel + new would break the one-cancels-other record)
    if (!native) { toast('This broker can’t move an order in place. Flatten, or change it at your broker.', 'error'); return; }
    const c = L.bracketCheck({ side: g.side, ref: i.last, sl: role === 'sl' ? np : g.sl, tp: role === 'tp' ? np : g.tp, code: i.code, pct: 0.05 }); if (c.error) { toast(c.error, 'error'); return; }
  }
  const what = role === 'sl' ? 'stop loss' : role === 'tp' ? 'take profit' : sideWord(o.side) + ' ' + o.qty + ' ' + i.code;
  const ok = await confirmSheet({ title: 'Move ' + what + ' to ' + px(np), code: i.code, side: o.side, go: native ? 'Move order' : 'Cancel and send new',
    lines: [contractLine(i), 'From ' + px(o.price) + ' to <b>' + px(np) + '</b>', native ? '' : '<span class="stklv-warn">This broker can’t change an order in place. The order is cancelled first; the new one is sent only after the cancel is confirmed.</span>'].filter(Boolean) });
  if (!ok) return;
  if (role) { const r = await write(Object.assign(m.body, { idemKey: uuid() }), 'Move ' + what); if (r && r.bracket) setGroup(r.bracket, i.code); return; }
  if (native) {
    const r = await write(Object.assign(m.body, { idemKey: uuid() }), 'Move');
    if (r) return;
    if (S.unknown) return;
  }
  // cancel + new: cancel, wait for a read showing it gone, then the new order (the server re-reads first)
  const c = await write({ op: 'cancel', orderId: oid, idemKey: uuid() }, 'Cancel');
  if (!c) return;
  for (let t = 0; t < 5; t++) { await new Promise((r) => setTimeout(r, 1200)); S.reading = false; await read(); const still = L.workingOrders(S.data.orders, i.code).some((x) => x.id === oid); if (!still && S.lastOkStart > S.lastWriteAt) break; if (t === 4) { toast('The cancel is not confirmed yet. No new order was sent.', 'error'); return; } }
  const filled = (S.data.orders.find((x) => String(x.orderId) === oid) || {}).status;
  if (/FILL/i.test(filled || '')) { toast('The order filled before the cancel. No new order was sent.', 'error'); return; }
  const b = L.buildPlace({ code: i.code, side: o.side, qty: o.qty, type: kind, price: np, asset: i.asset, tick: i.tick }, now());
  if (b.error || blockReason()) { toast(b.error || blockReason(), 'error'); return; }
  await write(Object.assign(b.body, { idemKey: uuid() }), 'New ' + sideWord(o.side) + ' ' + kind);
}
// DOM ladder click (assets/chart-book-panel.js): always a limit at the clicked price
export function ladder(sym, cell, price, bid, ask, qty) {
  const o = L.ladderOrder(cell, price, bid, ask); if (!o) return null;
  if (S.acct && S.acct.mt) { const i = infoMt(sym); if (i) qty = i.lots.min; }   // the ladder sends whole contracts; MT starts at the minimum lot
  return place(sym, Object.assign(o, { qty }), 'DOM');
}
export function domState(sym) {
  const i = info(sym); if (!i || (i.mt && (!i.code || !i.map.same))) return null;   // ladder prices are this chart's prices
  if (i.mt) return { live: true, code: i.code, orders: i.working.filter((o) => o.price).map((o) => ({ id: o.id, side: o.side, qty: o.qty, price: o.price })), pos: i.pos.qty ? { side: i.pos.qty > 0 ? 'buy' : 'sell', qty: Math.abs(i.pos.qty), avg: i.pos.avg || 0 } : null, pnl: i.pnl, sp: { ok: true, kind: 'forex', minQty: i.lots.min, symbol: i.code }, block: blockReason(), label: envWord() + ' ' + S.acct.label };
  return { live: true, code: i.code, orders: i.working.filter((o) => o.price).map((o) => ({ id: o.id, side: o.side, qty: o.qty, price: o.price })), pos: i.pos.qty ? { side: i.pos.qty > 0 ? 'buy' : 'sell', qty: Math.abs(i.pos.qty), avg: i.pos.avg || 0 } : null, pnl: i.pnl, sp: { ok: true, kind: i.asset === 'equity' ? 'equity' : 'futures', minQty: 1, symbol: i.code }, block: blockReason(), label: envWord() + ' ' + S.acct.label };
}
export function chipX(sym, id) { if (id === 'pos') return flatten(sym); if (/^[ST]P/.test(id) && S.acct && S.acct.ct) return removeSlTp(id.slice(2), id[0] === 'S' ? 'sl' : 'tp'); if (/^[ST][PO]/.test(id)) { toast('Change or remove the stop loss / take profit of a working order in cTrader for now.', 'info'); return null; } if (/^P/.test(id)) { toast('This order is still being sent. Cancel it once it shows as working.', 'info'); return null; } return cancel(String(id).replace(/^L/, '')); }
export function flattenActive() { return flatten(P.activeSymbol()); }
export function openTicket(pre) {
  pre = pre || {};
  if (pre.side) S.form.side = pre.side;
  if (pre.price != null) { S.form.type = 'limit'; S.form.price = String(pre.price); }
  // the floating order panel (assets/chart-order-panel.js) is the live ticket now; the old bottom view is the fallback
  if (P.orderPanel) { P.orderPanel(Object.assign({ tab: 'order', focus: true }, pre.side ? { side: pre.side } : {}, pre.price != null ? { price: pre.price, type: 'limit' } : {})); return; }
  P.openPanel();
  setTimeout(() => { const f = document.querySelector('.stklv-form [data-f=price], .stklv-form .stklv-send'); if (f) f.focus(); }, 30);
}
// ---- order panel (assets/chart-order-panel.js): read-only view of the chart's contract + the same guarded write paths
// What the chart's live order route can send (2026-11-17): market, limit, and, when the account's place schema lists STOP for futures
// (supportedOrderTypesByAssetClass), stop entries and a stop loss + take profit on market entries. Trail stays paper only.
const NO_STOPS = 'Stops and targets aren’t supported by this broker link yet. Set them at your broker.';
export function caps() {
  if (S.acct && S.acct.mt) {
    const i = P && P.activeSymbol ? infoMt(P.activeSymbol()) : null, same = !!(i && i.map.same);
    const st = !!S.placeSchema && same && L.stopsSupported(S.placeSchema);
    if (isOwn(S.acct)) return { stop: same, bracket: same, limit: same, mt: true, why: same ? '' : CT_NO_SLTP, marketOnly: '' };
    return { stop: st, bracket: false, limit: same, mt: true, why: !same ? 'This chart’s prices are not your broker’s prices for this symbol, so only market orders go from here.' : MT_NO_SLTP, marketOnly: MT_NO_SLTP };
  }
  if (!S.placeSchema) return { stop: false, bracket: false, why: S.placeErr ? 'The broker’s order types could not be read.' : 'Loading the broker’s order types…' };
  const ok = L.stopsSupported(S.placeSchema);
  return { stop: ok, bracket: ok, why: ok ? '' : NO_STOPS, marketOnly: 'Live stop loss and take profit go with market orders only.' };
}
export function opInfo(sym) {
  if (!S.acct) return null;
  const i = info(sym); if (!i) return null;
  const g = S.group && S.group.code === i.code ? S.group : null;
  if (i.mt) return { mt: i.mt, map: i.map, lots: i.lots, code: i.code, root: i.root, tick: i.tick, pv: null, last: i.last, chartLast: i.chartLast, pos: i.pos, working: i.working, pnl: i.pnl, held: false, env: envWord(), killed: !!S.killed, block: blockReason(), busy: S.busy, rtt: L.rttText(S.rtt), retry: !S.env && !!S.envErr && !S.envBusy, group: null, alarm: '', admin: isAdmin, needsEnable: !!(isOwn(S.acct) && S.env && S.env.consent === false && S.env.blocked !== true) };
  return { code: i.code, root: i.root, tick: i.tick || 0.01, pv: i.pv, asset: i.asset, last: i.last, pos: i.pos, working: i.working, pnl: i.pnl, held: i.held, env: envWord(), killed: !!S.killed, block: blockReason(), busy: S.busy, rtt: L.rttText(S.rtt),
    retry: !S.env && !!S.envErr && !S.envBusy, admin: isAdmin, needsEnable: !!(S.env && S.env.consent === false && S.env.blocked !== true), group: g, alarm: g && g.state === 'unprotected' ? g.why : '' };
}
// one entry point for the panel's Buy / Sell / Join / Confirm: place() keeps every guard (price band, read gate, double-click guard); no confirm sheet
export function placeTicket(sym, o, src) {
  if (S.acct && S.acct.mt && o.type === 'limit' && !caps().limit) { toast(caps().why, 'error'); return Promise.resolve(null); }
  if (o.type !== 'market' && o.type !== 'limit' && !(o.type === 'stop' && caps().stop)) { toast(o.type === 'stop' ? caps().why : 'Market, limit or stop only from the chart.', 'error'); return Promise.resolve(null); }
  return place(sym, { side: o.side, type: o.type, qty: o.qty, price: o.type !== 'market' ? Number(o.price) : undefined, marketable: !!o.marketable, sl: o.sl, tp: o.tp }, src || 'panel');
}
export function kill() { if (!isAdmin) return; if (window.confirm('Turn off live trading? The server will refuse every live order (all tabs, all devices) until it is switched back on.')) setKill(true); }
export function killOn() { if (!isAdmin) return; const t = window.prompt('Type LIVE to switch live trading back on.'); if (t && t.trim().toUpperCase() === 'LIVE') setKill(false); }

// ------------------------------------------------------------------------------------------ panel rendering (called by chart-paper.js)
export function renderHead(slot) {
  if (!slot) return;
  const sig = [S.loaded, S.acct && S.acct.id, S.accounts.map((a) => a.id + a.label).join(','), envWord(), S.userId].join('|');
  if (slot.dataset.sig !== sig) {
    slot.dataset.sig = sig;
    const opts = '<option value="">Paper</option>' + S.accounts.map((a) => '<option value="' + esc(a.id) + '"' + (S.acct && S.acct.id === a.id ? ' selected' : '') + '>' + esc(a.label) + '</option>').join('') + '<option value="__connect">' + (S.accounts.length ? 'Connect another broker…' : 'Connect a broker…') + '</option>';
    slot.innerHTML = '<label class="stklv-pick"><span class="stklv-vh">Trading account</span><select aria-label="Trading account">' + opts + '</select><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></label>' +
      (S.acct ? '<span class="stklv-badge" role="status" aria-label="' + esc(envWord() + ' ' + S.acct.label) + '"><span class="stklv-full">' + esc(envWord() + ' ' + S.acct.label) + '</span><span class="stklv-short" aria-hidden="true">' + esc(envWord() + ' ' + S.acct.short) + '</span></span>' : '');
    const sel = slot.querySelector('select');
    sel.addEventListener('change', () => { const v = sel.value; if (v === '__connect') { sel.value = S.acct ? S.acct.id : ''; connect(); return; } pick(v); });
    for (const ev of ['pointerdown', 'keydown']) slot.addEventListener(ev, (e) => e.stopPropagation());
  }
}
export function renderSummary(el) {
  if (!el || !S.acct) return;
  const i = info(P.activeSymbol());
  const t = i ? i.code + ' · ' + (i.pos.qty ? (i.pos.qty > 0 ? 'Long ' : 'Short ') + Math.abs(i.pos.qty) : 'Flat') + ' · Open P&L ' + money(i.pnl, true) : noLiveWhy(P.activeSymbol());
  if (el.textContent !== t) { el.textContent = ''; const s = document.createElement('span'); s.className = i && i.pnl > 0 ? 'up' : i && i.pnl < 0 ? 'down' : ''; s.textContent = t; el.appendChild(s); }
}
export const foot = () => (S.acct ? (S.busy && S.pending ? 'Sending… ' : L.rttText(S.rtt) ? L.rttText(S.rtt) + ' ' : '') + envWord() + ' account ' + S.acct.label + ': real orders at your broker, every attempt logged. Positions refresh every ' + POLL_MS / 1000 + ' s. ' + DISCLAIMER : '');
let viewSig = '';
export function renderView(v) {
  if (!v || !S.acct) return;
  const sym = P.activeSymbol(), i = info(sym), why = blockReason(), F = S.form;
  const sig = JSON.stringify([sym, i && [i.code, i.pos, i.working, i.held], Math.round((i && i.pnl) || 0), why, F, S.busy, S.killed, S.env, S.modifyOk]);
  const existing = v.querySelector('.stklv-view');
  if (existing && viewSig === sig) return;
  if (existing && existing.contains(document.activeElement) && document.activeElement.matches('input')) { const st = existing.querySelector('.stklv-status'); if (st) st.textContent = why || 'Ready. Positions and orders read ' + Math.max(0, Math.round((now() - S.lastOkStart) / 1000)) + ' s ago.'; return; }
  viewSig = sig;
  const seg = (k, val, opts) => '<div class="stklv-seg" role="radiogroup" aria-label="' + k + '">' + opts.map(([v2, t, cls]) => '<button type="button" role="radio" data-' + k + '="' + v2 + '" aria-checked="' + (String(val) === String(v2)) + '" class="' + (cls || '') + '">' + t + '</button>').join('') + '</div>';
  const blocked = !!why || !i;
  const posRows = i ? (i.pos.qty ? '<div class="stklv-row"><span class="stklv-sym">' + esc(i.code) + '</span><span class="' + (i.pos.qty > 0 ? 'up' : 'down') + '">' + (i.pos.qty > 0 ? 'Long ' : 'Short ') + Math.abs(i.pos.qty) + '</span><span class="m">@ ' + px(i.pos.avg) + '</span><span class="m ' + (i.pnl > 0 ? 'up' : i.pnl < 0 ? 'down' : '') + '">' + money(i.pnl, true) + '</span><button type="button" class="stklv-btn sm warn" data-a="flat">Flatten</button></div>' : '<p class="stklv-empty">No position in ' + esc(i.code) + '.</p>') : '';
  const ordRows = i ? (i.working.length ? i.working.map((o) => '<div class="stklv-row"><span class="stklv-sym">' + esc(i.code) + '</span><span class="' + (o.side === 'buy' ? 'up' : 'down') + '">' + sideWord(o.side) + ' ' + o.qty + '</span><span class="m">' + (o.type || '').toUpperCase() + (o.price ? ' @ ' + px(o.price) : '') + '</span><span class="m">' + esc(o.status.replace(/_/g, ' ').toLowerCase()) + '</span><button type="button" class="stklv-btn sm" data-cancel="' + esc(o.id) + '">Cancel</button></div>').join('') : '<p class="stklv-empty">No working orders.</p>') : '';
  v.innerHTML = '<div class="stklv-view">' +
    '<form class="stklv-form" novalidate>' +
      (i ? '<p class="stklv-ctr">' + esc(i.asset === 'equity' ? i.code : L.chartRoot(sym) + '1!') + ' → <b>' + esc(i.code) + '</b>' + (i.held ? ' <span class="stklv-warn">(open position’s month)</span>' : '') + '</p>' : '<p class="stklv-ctr stklv-warn">' + esc(noLiveWhy(sym)) + '</p>') +
      seg('side', F.side, [['buy', 'Buy', 'buy'], ['sell', 'Sell', 'sell']]) +
      '<div class="stklv-two">' + seg('type', F.type, [['market', 'Market'], ['limit', 'Limit']]) + '<label class="stklv-f"><input data-f="qty" type="number" min="1" step="1" inputmode="numeric" aria-label="Quantity" value="' + esc(F.qty) + '"></label>' + '</div>' +
      (F.type === 'limit' ? '<label class="stklv-f"><span>Limit price</span><input data-f="price" type="text" inputmode="decimal" autocomplete="off" value="' + esc(F.price || (i && Number.isFinite(i.last) ? i.last.toFixed(2) : '')) + '"></label>' : '') +
      '<button type="submit" class="stklv-btn stklv-send ' + F.side + '"' + (blocked ? ' disabled' : '') + '>Review ' + sideWord(F.side) + ' ' + F.qty + (i ? ' ' + esc(i.code) : '') + '</button>' +
      '<p class="stklv-status' + (why ? ' bad' : '') + '" role="status">' + esc(why || 'Ready. Positions and orders read ' + Math.max(0, Math.round((now() - S.lastOkStart) / 1000)) + ' s ago.') + '</p>' +
    '</form>' +
    '<div class="stklv-lists"><h3 class="stklv-h3">Position</h3>' + posRows + '<h3 class="stklv-h3">Working orders</h3>' + ordRows +
      '<div class="stklv-tools"><button type="button" class="stklv-btn sm" data-a="refresh">Refresh</button>' + (!isAdmin ? '' : S.killed ? '<button type="button" class="stklv-btn sm" data-a="killon">Switch live trading back on</button>' : '<button type="button" class="stklv-btn sm warn" data-a="kill">Turn off live trading</button>') + '<button type="button" class="stklv-btn sm" data-a="paper">Back to Paper</button></div></div>' +
  '</div>';
  const root = v.querySelector('.stklv-view');
  for (const ev of ['keydown', 'pointerdown']) root.addEventListener(ev, (e) => e.stopPropagation());
  root.querySelectorAll('[data-side]').forEach((b) => b.addEventListener('click', () => { F.side = b.dataset.side; render(); }));
  root.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => { F.type = b.dataset.type; render(); }));
  const qin = root.querySelector('[data-f=qty]'); if (qin) qin.addEventListener('change', () => { const q = Math.round(Number(qin.value)); F.qty = q >= 1 ? q : 1; render(); });
  const pin = root.querySelector('[data-f=price]'); if (pin) pin.addEventListener('input', () => { F.price = pin.value; });
  root.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); if (pin) F.price = pin.value; place(sym, { side: F.side, type: F.type, qty: F.qty, price: F.type === 'limit' ? Number(String(F.price).replace(/[, ]/g, '')) : undefined }, 'panel'); });
  root.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => cancel(b.dataset.cancel)));
  const act = (a, fn) => { const b = root.querySelector('[data-a=' + a + ']'); if (b) b.addEventListener('click', fn); };
  act('flat', () => flatten(sym)); act('refresh', () => read()); act('paper', () => leave());
  act('kill', () => { if (isAdmin && window.confirm('Turn off live trading? The server will refuse every live order (all tabs, all devices) until it is switched back on.')) setKill(true); });
  act('killon', () => { if (!isAdmin) return; const t = window.prompt('Type LIVE to switch live trading back on.'); if (t && t.trim().toUpperCase() === 'LIVE') setKill(false); });
}
function render() { try { P.renderAll(); } catch (e) {} }

// ------------------------------------------------------------------------------------------ CSS (TradeZoro tokens; 4-pt grid; dark + light)
const CSS = `
.stkpt-acctslot{ display:inline-flex; align-items:center; gap:8px; min-width:0; }
.stkpt.is-live .stkpt-head{ gap:8px; }
.stkpt-acctslot:empty{ display:none; }
.stkpt.is-live .stkpt-badge{ display:none; }
.stkpt.is-live .stkpt-trade,.stkpt-trade[hidden]{ display:none !important; }
.stklv-short{ display:none; } .stklv-full{ overflow:hidden; text-overflow:ellipsis; }
.stklv-vh{ position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); }
.stklv-pick{ position:relative; display:inline-flex; align-items:center; height:28px; }
.stklv-pick select{ appearance:none; -webkit-appearance:none; height:28px; padding:0 28px 0 12px; border:1px solid var(--line); border-radius:8px; background:var(--bg-1); color:var(--ink-0); font:600 12px/16px var(--font-body, sans-serif); cursor:pointer; max-width:220px; text-overflow:ellipsis; }
.stklv-pick select:focus-visible{ outline:2px solid #03c988; outline-offset:2px; }
.stklv-pick svg{ position:absolute; right:10px; pointer-events:none; color:var(--ink-2); }
.stklv-badge{ display:inline-flex; align-items:center; min-width:0; max-width:100%; overflow:hidden; height:28px; padding:0 12px; border-radius:999px; background:#d92d20; color:#fff; font:700 12px/16px var(--font-body, sans-serif); letter-spacing:.04em; white-space:nowrap; box-shadow:0 0 0 2px rgba(217,45,32,.28); }
#stklv-sp{ position:fixed; inset:0; z-index:9100; background:rgba(0,0,0,.6); display:flex; align-items:center; justify-content:center; padding:16px; }
#stklv-sp.pop{ background:transparent; display:block; padding:0; }
.stklv-sp-box{ width:min(400px,100%); max-height:min(520px,80dvh); display:flex; flex-direction:column; gap:12px; padding:16px; box-sizing:border-box; border:1px solid var(--line); border-radius:16px; background:var(--bg-1); color:var(--ink-1); box-shadow:0 12px 40px rgba(0,0,0,.45); }
#stklv-sp.pop .stklv-sp-box{ position:fixed; }
.stklv-sp-box .stklv-grab{ display:none; }
.stklv-sp-head{ display:flex; align-items:center; justify-content:space-between; gap:12px; }
.stklv-sp-head h2{ margin:0; font:700 16px/22px var(--font-body, sans-serif); color:var(--ink-0); }
.stklv-sp-q,.stklv-sp-type input{ width:100%; box-sizing:border-box; height:40px; padding:0 12px; border:1px solid var(--line); border-radius:8px; background:var(--bg-2); color:var(--ink-0); font:500 14px/20px var(--font-body, sans-serif); }
.stklv-sp-q:focus-visible,.stklv-sp-type input:focus-visible,.stklv-sp-row:focus-visible{ outline:2px solid #03c988; outline-offset:2px; }
.stklv-sp-list .stklv-h3{ padding:0 12px; }
.stklv-sp-list{ flex:1; min-height:0; overflow-y:auto; scrollbar-width:thin; scrollbar-color:var(--ink-3) transparent; }
.stklv-sp-row{ display:grid; grid-template-columns:minmax(0,auto) minmax(0,1fr); align-items:center; gap:12px; width:100%; min-height:44px; padding:0 12px; border:0; border-radius:8px; background:transparent; color:var(--ink-1); font:500 13px/18px var(--font-body, sans-serif); text-align:left; cursor:pointer; }
.stklv-sp-row b{ color:var(--ink-0); font-weight:600; white-space:nowrap; }
.stklv-sp-row span{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--ink-2); }
.stklv-sp-row:hover,.stklv-sp-row[aria-current]{ background:var(--bg-2); }
.stklv-sp-row[aria-current] b::after{ content:' ✓'; color:#03c988; }
.stklv-sp-type{ display:flex; align-items:flex-end; gap:8px; } .stklv-sp-type[hidden]{ display:none; }
.stklv-sp-type label{ flex:1; display:flex; flex-direction:column; gap:4px; font:500 12px/16px var(--font-body, sans-serif); color:var(--ink-2); }
.stklv-sp-type .stklv-btn{ height:40px; }
.stklv-cbtn{ pointer-events:auto; margin:0 -8px 0 8px; height:20px; padding:0 8px; border:0; border-radius:999px; background:rgba(255,255,255,.22); color:#fff; font:700 12px/16px inherit; font-family:inherit; cursor:pointer; }
.stklv-cbtn:hover{ background:rgba(255,255,255,.34); } .stklv-cbtn:focus-visible{ outline:2px solid #fff; outline-offset:1px; }
.stklv-cbadge{ position:absolute; right:80px; top:8px; z-index:6; height:28px; padding:0 16px; display:flex; align-items:center; border-radius:999px; background:#d92d20; color:#fff; font:700 12px/16px -apple-system,BlinkMacSystemFont,Roboto,sans-serif; letter-spacing:.04em; white-space:nowrap; pointer-events:none; box-shadow:0 2px 8px rgba(0,0,0,.35); max-width:calc(100% - 96px); overflow:hidden; text-overflow:ellipsis; }
.stklv-onote{ position:absolute; left:50%; top:8px; z-index:6; transform:translateX(-50%); display:flex; align-items:center; gap:8px; max-width:calc(100% - 32px); box-sizing:border-box; padding:4px 4px 4px 12px; border:1px solid var(--line); border-radius:999px; background:var(--bg-1); color:var(--ink-1); font:500 12px/16px var(--font-body, -apple-system, BlinkMacSystemFont, Roboto, sans-serif); box-shadow:0 2px 8px rgba(0,0,0,.28); pointer-events:auto; }
.stklv-onote span{ min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.stklv-onote-b{ flex:none; height:24px; padding:0 12px; border:0; border-radius:999px; background:var(--gold, #03c988); color:#0b0b0d; font:600 12px/16px inherit; font-family:inherit; cursor:pointer; white-space:nowrap; }
.stklv-onote-b:hover{ filter:brightness(1.08); } .stklv-onote-b:focus-visible{ outline:2px solid var(--ink-0); outline-offset:2px; }
.stkpt-chip[data-live]{ border-width:2px; }
.stkpt-chip[data-live] .stkpt-chip-a{ font-weight:700; }
.stkpt-chip[data-live][data-id^="P"]{ opacity:.88; border-style:dashed; }
.stklv-view{ display:grid; grid-template-columns:minmax(260px,320px) minmax(0,1fr); gap:16px; padding:8px 4px; align-items:start; }
.stklv-form{ display:flex; flex-direction:column; gap:8px; }
.stklv-ctr{ margin:0; font:500 13px/18px var(--font-body, sans-serif); color:var(--ink-2); }
.stklv-ctr b{ color:var(--ink-0); }
.stklv-warn{ color:#f5a524; }
:root[data-theme="light"] .stklv-warn{ color:#8a5a00; }
.stklv-seg{ display:grid; grid-auto-flow:column; grid-auto-columns:1fr; gap:4px; padding:4px; border-radius:12px; background:var(--bg-2); }
.stklv-seg button{ height:32px; border:0; border-radius:8px; background:transparent; color:var(--ink-2); font:600 13px/18px var(--font-body, sans-serif); cursor:pointer; }
.stklv-seg button[aria-checked="true"]{ background:var(--bg-0); color:var(--ink-0); box-shadow:0 1px 3px rgba(0,0,0,.3); }
.stklv-seg button.buy[aria-checked="true"]{ background:#2962ff; color:#fff; } .stklv-seg button.sell[aria-checked="true"]{ background:#f23645; color:#fff; }
.stklv-seg button:focus-visible,.stklv-btn:focus-visible,.stklv-f input:focus-visible{ outline:2px solid #03c988; outline-offset:2px; }
.stklv-two{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.stklv-f{ display:flex; flex-direction:column; gap:4px; font:500 12px/16px var(--font-body, sans-serif); color:var(--ink-2); }
.stklv-f input{ height:40px; padding:0 12px; border:1px solid var(--line); border-radius:8px; background:var(--bg-1); color:var(--ink-0); font:500 15px/20px var(--font-mono); font-variant-numeric:tabular-nums; }
.stklv-btn{ display:inline-flex; align-items:center; justify-content:center; height:40px; padding:0 16px; border:1px solid var(--line); border-radius:12px; background:transparent; color:var(--ink-0); font:600 13px/18px var(--font-body, sans-serif); cursor:pointer; white-space:nowrap; }
.stklv-btn.sm{ height:32px; padding:0 12px; border-radius:8px; font-size:12px; }
.stklv-btn.warn{ border-color:rgba(242,54,69,.55); color:#f23645; }
.stklv-btn:disabled{ opacity:.4; cursor:not-allowed; }
.stklv-send.buy,.stklv-go.buy{ background:#2962ff; border-color:#2962ff; color:#fff; } .stklv-send.sell,.stklv-go.sell{ background:#f23645; border-color:#f23645; color:#fff; }
.stklv-status{ margin:0; font:400 12px/16px var(--font-body, sans-serif); color:var(--ink-3); }
.stklv-status.bad{ color:#f23645; font-weight:600; }
.stklv-lists{ min-width:0; display:flex; flex-direction:column; }
.stklv-h3{ margin:8px 0 4px; font:600 11px/16px var(--font-body, sans-serif); letter-spacing:.06em; text-transform:uppercase; color:var(--ink-3); }
.stklv-h3:first-child{ margin-top:0; }
.stklv-row{ display:grid; grid-template-columns:72px 72px minmax(0,1fr) minmax(0,1fr) auto; align-items:center; gap:8px; min-height:44px; border-bottom:1px solid var(--line-soft); font:500 13px/18px var(--font-body, sans-serif); }
.stklv-row .m{ font-family:var(--font-mono); font-variant-numeric:tabular-nums; color:var(--ink-1); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.stklv-sym{ font-weight:600; color:var(--ink-0); }
.stklv-row .up,.stklv-view .up{ color:#089981; } .stklv-row .down,.stklv-view .down{ color:#f23645; }
.stklv-empty{ margin:4px 0 8px; font:400 13px/18px var(--font-body, sans-serif); color:var(--ink-3); }
.stklv-tools{ display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
#stklv-cf{ position:fixed; inset:0; z-index:9100; background:rgba(0,0,0,.6); display:flex; align-items:center; justify-content:center; padding:16px; }
.stklv-cf-box{ width:min(420px,100%); max-height:calc(100dvh - 32px); overflow:auto; background:var(--bg-1, #0b0b0d); color:var(--ink-1); border:2px solid #d92d20; border-radius:16px; padding:16px; display:flex; flex-direction:column; gap:12px; font:400 14px/20px var(--font-body, sans-serif); box-shadow:0 24px 80px rgba(0,0,0,.6); }
.stklv-grab{ display:none; }
.stklv-cf-head{ display:flex; align-items:center; justify-content:space-between; gap:8px; }
.stklv-x{ width:32px; height:32px; border:0; border-radius:999px; background:var(--bg-2); color:var(--ink-1); font-size:18px; line-height:32px; cursor:pointer; }
.stklv-cf-box h2{ margin:0; font:700 17px/22px var(--font-body, sans-serif); color:var(--ink-0); font-variant-numeric:tabular-nums; }
.stklv-cf-lines{ display:flex; flex-direction:column; gap:4px; }
.stklv-cf-lines p{ margin:0; font-size:14px; line-height:20px; } .stklv-cf-lines b{ color:var(--ink-0); }
.stklv-cf-btns{ display:grid; grid-template-columns:1fr 1.4fr; gap:8px; } .stklv-cf-btns .stklv-btn{ height:48px; font-size:15px; }
.stklv-fine{ margin:0; font-size:12px; line-height:16px; color:var(--ink-3); }
/* OWNER STYLE (25 Nov): neat, simple confirm card. Neutral border, title + x, one grey sub line, hairline rows label-left / value-right,
   "Don't show this again", Cancel (quiet) + primary (light on dark, dark on light). TradeZoro tokens + font. */
#stklv-cf.stklv-card .stklv-cf-box{ width:min(400px,100%); border:1px solid var(--line); border-radius:14px; padding:20px 24px; gap:0; background:var(--bg-1, #16171b); box-shadow:0 16px 48px rgba(0,0,0,.45); }
.stklv-card .stklv-cf-head{ align-items:center; gap:12px; margin-bottom:8px; }
.stklv-card .stklv-cf-head h2{ flex:1; min-width:0; font:600 17px/24px var(--font-body, sans-serif); }
.stklv-card .stklv-x{ flex:none; width:32px; height:32px; margin-right:-8px; background:transparent; color:var(--ink-3); display:inline-flex; align-items:center; justify-content:center; line-height:1; }
.stklv-card .stklv-x:hover{ background:var(--bg-2); color:var(--ink-0); }
.stklv-cf-sub{ margin:0 0 8px; font:400 13px/20px var(--font-body, sans-serif); color:var(--ink-3); font-variant-numeric:tabular-nums; }
.stklv-card .stklv-cf-lines{ padding:8px 0; border-top:1px solid var(--line-soft, var(--line)); }
.stklv-cf-rows{ margin:0; }
.stklv-cf-rows > div{ display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:40px; border-top:1px solid var(--line-soft, var(--line)); }
.stklv-cf-rows > div:last-child{ border-bottom:1px solid var(--line-soft, var(--line)); }
.stklv-cf-rows dt{ font:400 14px/20px var(--font-body, sans-serif); color:var(--ink-3); white-space:nowrap; }
.stklv-cf-rows dd{ margin:0; min-width:0; text-align:right; font:500 14px/20px var(--font-body, sans-serif); color:var(--ink-0); font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
.stklv-env{ display:inline-flex; align-items:center; height:20px; padding:0 6px; border-radius:4px; vertical-align:1px; background:rgba(242,54,69,.16); color:#f23645; font:600 11px/1 var(--font-body, sans-serif); }
.stklv-env.demo{ background:var(--bg-2); color:var(--ink-2); }
.stklv-cf-rows .n{ font-variant-numeric:tabular-nums; }
.stklv-cf-ds{ display:flex; align-items:center; gap:8px; min-height:40px; margin-top:4px; font:400 13px/20px var(--font-body, sans-serif); color:var(--ink-2); cursor:pointer; }
.stklv-cf-ds input{ width:16px; height:16px; margin:0; accent-color:var(--ink-0); }
.stklv-card .stklv-fine{ margin:8px 0 0; }
.stklv-card .stklv-cf-btns{ display:flex; justify-content:flex-end; gap:8px; margin:16px -24px -20px; padding:16px 24px 20px; border-top:1px solid var(--line-soft, var(--line)); }
.stklv-card .stklv-cf-btns .stklv-btn{ height:40px; padding:0 16px; border-radius:10px; font:600 14px/20px var(--font-body, sans-serif); }
.stklv-card .stklv-cf-btns [data-k=no]{ background:var(--bg-2); border-color:transparent; color:var(--ink-0); }
.stklv-card .stklv-cf-btns .stklv-go,.stklv-card .stklv-cf-btns .stklv-go.buy,.stklv-card .stklv-cf-btns .stklv-go.sell{ background:var(--ink-0); border-color:var(--ink-0); color:var(--bg-0, #0b0b0d); }
@media (max-width:700px){
  #stklv-cf.stklv-card .stklv-cf-box{ width:100%; border-radius:20px 20px 0 0; border-width:1px 0 0; padding:8px 16px 0; max-height:92dvh; }
  .stklv-card .stklv-x{ width:44px; height:44px; margin-right:-12px; }
  .stklv-card .stklv-cf-btns{ margin:16px -16px 0; padding:12px 16px calc(12px + env(safe-area-inset-bottom)); }
  .stklv-card .stklv-cf-btns .stklv-btn{ flex:1; height:48px; font-size:15px; }
  .stklv-cf-rows > div{ min-height:44px; }
  .stklv-cf-ds{ min-height:44px; }
}
.stklv-en .stklv-cf-box{ width:min(480px,100%); gap:16px; padding:24px; }
.stklv-en-list{ gap:8px; }
.stklv-en-list ul{ margin:0; padding:0 0 0 20px; display:flex; flex-direction:column; gap:8px; list-style:disc; }
.stklv-en-list li::marker{ color:var(--ink-3); }
.stklv-en-list li{ font-size:14px; line-height:20px; } .stklv-en-list li b{ color:var(--ink-0); }
.stklv-en-ck{ display:flex; align-items:flex-start; gap:12px; padding:12px 16px; border:1px solid var(--line); border-radius:12px; background:var(--bg-2); font:500 14px/20px var(--font-body, sans-serif); color:var(--ink-1); cursor:pointer; -webkit-tap-highlight-color:transparent; }
.stklv-en-ck:has(input:checked){ border-color:#03c988; }
.stklv-en-ck input{ flex:none; width:20px; height:20px; margin:0; accent-color:#03c988; cursor:pointer; }
.stklv-en-ck a{ color:var(--gold, #03c988); text-decoration:underline; text-underline-offset:2px; }
.stklv-en-ck:has(input:focus-visible){ outline:2px solid #03c988; outline-offset:2px; }
.stklv-en-err{ margin:0; font:600 13px/18px var(--font-body, sans-serif); color:#f23645; }
.stklv-en-err[hidden]{ display:none; }
@media (max-width:980px){ .stklv-view{ grid-template-columns:1fr; } }
@media (max-width:700px){
  .stklv-pick select{ max-width:132px; height:32px; } .stklv-pick{ height:32px; }
  .stkpt.is-live .stkpt-hsum{ display:none; }
  .stkpt-head .stklv-badge{ height:32px; padding:0 12px; }
  .stkpt-head .stklv-full{ display:none; } .stkpt-head .stklv-short{ display:block; max-width:144px; overflow:hidden; text-overflow:ellipsis; }
  .stklv-pick select{ max-width:128px; }
  .stklv-view{ padding:8px 0; gap:12px; }
  .stklv-seg button{ height:40px; } .stklv-btn{ height:44px; } .stklv-btn.sm{ height:36px; }
  .stklv-f input{ height:48px; font-size:16px; }
  .stklv-row{ grid-template-columns:56px 64px minmax(0,1fr) auto; } .stklv-row .m:nth-of-type(4){ display:none; }
  #stklv-cf,#stklv-sp,#stklv-sp.pop{ align-items:flex-end; padding:0; }
  #stklv-sp.pop{ display:flex; background:rgba(0,0,0,.6); }
  .stklv-sp-box,#stklv-sp.pop .stklv-sp-box{ position:static; width:100%; max-height:85dvh; border-radius:20px 20px 0 0; border-width:2px 0 0; padding:8px 16px calc(16px + env(safe-area-inset-bottom)); top:auto !important; left:auto !important; }
  .stklv-sp-box .stklv-grab{ display:block; }
  .stklv-sp-q,.stklv-sp-type input{ height:48px; font-size:16px; }
  .stklv-sp-row{ min-height:48px; }
  .stklv-cf-box{ width:100%; border-radius:20px 20px 0 0; border-width:2px 0 0; max-height:92dvh; padding:8px 16px calc(16px + env(safe-area-inset-bottom)); }
  .stklv-en .stklv-cf-box{ padding:8px 16px calc(16px + env(safe-area-inset-bottom)); }
  .stklv-grab{ display:block; width:36px; height:4px; margin:0 auto 4px; border-radius:2px; background:var(--line); }
  .stklv-onote{ top:72px; width:calc(100% - 32px); padding:8px 8px 8px 12px; border-radius:12px; } .stklv-onote span{ white-space:normal; overflow:visible; flex:1 1 auto; } .stklv-onote-b{ height:32px; }
  .stklv-cbadge{ top:120px; right:auto; left:50%; transform:translateX(-50%); height:32px; max-width:calc(100% - 32px); }
}
`;

// ---- cTrader (admins and beta testers): the saved trading sign-in becomes one more live account; "Allow trading with cTrader" starts the sign-in
function ctLots(code) { const l = CT.link && CT.mod ? CT.mod.lotsForName(CT.link, code) : null; if (!l && CT.link && !ctLots.wait) { ctLots.wait = true; setTimeout(() => { ctLots.wait = false; render(); }, 800); } return l || { min: 0.01, step: 0.01, max: 10, fromSchema: false }; }
// the tick of a broker symbol code on the picked MetaTrader-style account (cTrader digits, BROKERS 3 rules, else the usual tick)
function codeTick(code) { if (!S.acct || !S.acct.mt || !code) return 0.01; const k = (L.mtChartKey(code) || {}).key || String(code).toUpperCase(); return S.acct.ct ? ctTick(code, k) : S.acct.b3 ? b3Tick(code, k) : L.mtTick(k); }
// a price for a chart symbol, in that symbol's digits (the live account's broker symbol when it is one; else 2 decimals as before)
export function fmtPx(sym, v) { const i = S.acct && S.acct.mt ? infoMt(sym) : null; return i && i.code ? pxd(v, i.tick) : px(v); }
function ctTick(code, key) { const id = CT.link && CT.link.byName.get(String(code || '').toUpperCase()), d = id && CT.link.details.get(id); return d && Number.isInteger(d.digits) ? Math.pow(10, -d.digits) : L.mtTick(key); }
// admin, or a beta tester (POST /api/beta/status: verified email on settings/betaTesters). This only shows the option; the trade
// relay decides again on the server (functions/connect/ctrader/trade.js mayTrade) before anything is sent.
async function ctAllowed() {
  if (isAdmin) return true;
  if (TEST && TEST.isBeta) return !!TEST.isBeta();
  try {
    const t = await firebase.auth().currentUser.getIdToken();
    const r = await fetch('/api/beta/status', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: '{}' });
    const j = r.ok ? await r.json() : null; return !!(j && j.beta === true);
  } catch (e) { return false; }
}
async function loadCt() {
  try {
    CT.mod = CT.mod || await import('./ctrader-trade.js?v=1290');
    if (!QUO) import('./byo-ctrader.js?v=1290').then((m) => { QUO = m.quoteOf; }).catch(() => {});   // the bid / ask for the SL / TP checks and the ask tag
    window.__stkCt = { open: () => CT.mod.startTradeSignIn(uid).catch((e) => toast(e.message || 'Could not open cTrader.', 'error')), get connected() { return !!CT.acct; }, get link() { return TEST ? CT.link : null; } };
    const c = TEST && TEST.ctCreds ? TEST.ctCreds : await CT.mod.loadTradeCreds();   // test: localhost fixture creds + a mocked socket
    if (!c || !c.access || !c.accountId) { CT.acct = null; return; }
    CT.creds = c; CT.link = new CT.mod.TradeLink(c, TEST && TEST.ctDeps ? TEST.ctDeps : undefined);
    CT.link.keep = () => !!(S.acct && S.acct.ct);   // heartbeats only while the account is picked; else the relay's idle close ends it
    CT.link.onEvent = (k, m) => { if (k === 'exec' && S.acct && S.acct.ct) { fastReads(); histSoon(); balSoon(); } if (k === 'resolved') { toast('Your last cTrader order was checked: ' + (m.result === 'accepted' ? 'it reached cTrader.' : 'it did not reach cTrader. Nothing was sent twice.'), 'info'); if (S.acct && S.acct.ct) read(); } };
    CT.ops = CT.mod.ctOps(CT.link, { lastPrice: () => { const i = P && P.activeSymbol ? infoMt(P.activeSymbol()) : null; return i && Number.isFinite(i.last) ? i.last : null; } });
    const a = L.acctInfo({ accountId: 'ct-' + c.accountId, accountNumber: String(c.login || c.accountId) });
    a.broker = 'cTrader'; a.text = 'cTrader ' + a.number + (c.isLive === false ? ' demo' : ''); a.name = a.number; a.mt = 'cTrader'; a.ct = true; a.demo = c.isLive === false;
    CT.acct = withShow(a);
    ctFeed();
  } catch (e) { CT.acct = null; }
}
// the cTrader account as a chart feed for broker symbols TradeZoro has no chart for (symbol search -> byo:CT:<name>; assets/byo-ctrader.js
// useTradeAccount: trendbars + spots over the view-only data relay). Re-registered after a sign-in change clears the own-data feeds.
function ctFeed() {
  if (!CT.creds || !CT.mod) return Promise.resolve(false);
  return Promise.all([import('./byo-ctrader.js?v=1290'), import('./byo-core.js?v=1290')]).then(([b, c]) => { if (CT.creds) b.useTradeAccount(CT.creds, CT.mod.freshTrade, TEST && TEST.ctDeps ? TEST.ctDeps : undefined, c); return true; }, () => false);
}
window.addEventListener('tz:byo', (e) => { if (e.detail && e.detail.id === '*' && CT.acct) ctFeed(); });
// ---- BROKERS 3 (admins and beta testers): tastytrade / TradeStation / OANDA trading sign-ins become live accounts
function b3Lots(code) { const r = S.placeSchema && S.placeSchema.rules && S.placeSchema.rules[String(code || '').toUpperCase()]; return r ? { min: r.min, step: r.step, max: r.max, fromSchema: true } : { min: 0.01, step: 0.01, max: 10, fromSchema: false }; }
function b3Tick(code, key) { const r = S.placeSchema && S.placeSchema.rules && S.placeSchema.rules[String(code || '').toUpperCase()]; return r && Number.isInteger(r.priceDp) ? Math.pow(10, -r.priceDp) : L.mtTick(key); }
function b3Feed(a) {
  if (B3S.feed) { B3S.feed.stop(); B3S.feed = null; }
  if (!a || !a.b3 || !B3S.mod || !B3S.creds[a.b3]) return;
  B3S.feed = new B3S.mod.StatusFeed(a.b3, B3S.creds[a.b3], [a.acctNo], (ev) => { if (S.acct && S.acct.id === a.id) { fastReads(); histSoon(); balSoon(); if (ev.type === 'fill') toast(a.broker + ': order ' + ev.id + ' filled.', 'info'); } }, TEST && TEST.b3Deps ? TEST.b3Deps : undefined);
  B3S.feed.start().catch(() => {});
}
async function loadB3() {
  try {
    B3S.mod = B3S.mod || await import('./broker-trade.js?v=1290');
    const d = TEST && TEST.b3Deps ? TEST.b3Deps : undefined, list = [];
    await Promise.all(Object.keys(B3S.mod.BROKERS).map(async (k) => {
      B3S.cfg[k] = await B3S.mod.probe(k, d);
      const c = TEST && TEST.b3Creds ? TEST.b3Creds[k] : await B3S.mod.loadCreds(k);   // test: localhost fixture creds + mocked routes
      if (!c || !(c.access || c.token)) { delete B3S.creds[k]; return; }
      B3S.creds[k] = c;
      try {
        for (const x of await B3S.mod.accountsFor(k, c, d)) {
          const a = L.acctInfo({ accountId: x.id, accountNumber: x.number });
          const B = B3S.mod.BROKERS[k], demo = c.env !== 'live';
          a.broker = B.label + (demo ? (k === 'oanda' ? ' practice' : k === 'tradestation' ? ' SIM' : ' sandbox') : ''); a.b3 = k; a.acctNo = x.accountId; a.name = a.number; a.demo = demo; a.text = B.label + ' ' + a.number;   // the badge adds SANDBOX; the menu row's broker line says which test env
          if (B.fx) a.mt = 'OANDA';   // OANDA: lots and its own instrument names, like the MetaTrader accounts
          B3S.ops.set(a.id, B3S.mod.brokerOps(k, c, x.accountId, d)); list.push(withShow(a));
        }
      } catch (e) { if (e && (e.reconnect || e.status === 401)) toast(e.message, 'error'); }
    }));
    B3S.list = list;
    window.__stkB3 = {
      brokers: () => Object.keys(B3S.mod.BROKERS).map((k) => ({ id: k, label: B3S.mod.BROKERS[k].label, configured: !!(B3S.cfg[k] && B3S.cfg[k].configured), connected: !!B3S.creds[k], help: B3S.mod.BROKERS[k].help })),
      open: (k) => { const cf = B3S.cfg[k]; if (!cf || !cf.configured) { toast(B3S.mod.BROKERS[k].label + ' trading is coming soon.', 'info'); return; } if (k === 'oanda') b3OandaSheet(); else B3S.mod.startSignIn(k, uid, TEST && TEST.b3Deps ? TEST.b3Deps : undefined).catch((e) => toast(e.message || 'Could not open ' + B3S.mod.BROKERS[k].label + '.', 'error')); }
    };
  } catch (e) { B3S.list = []; }
}
// OANDA: paste the personal access token once (practice; live only when the server says OANDA live is on). Checked by our server
// against OANDA before it is kept; kept only in this device's encrypted vault.
function b3OandaSheet() {
  if (document.getElementById('stklv-cf')) return;
  const liveOk = !!(B3S.cfg.oanda && B3S.cfg.oanda.live), prev = document.activeElement;
  const el = document.createElement('div'); el.id = 'stklv-cf'; el.className = 'stklv-en stklv-b3';
  el.innerHTML = '<div class="stklv-cf-box" role="dialog" aria-modal="true" aria-labelledby="stklv-b3-h">' +
    '<div class="stklv-grab" aria-hidden="true"></div>' +
    '<div class="stklv-cf-head"><span class="stklv-badge">' + (liveOk ? 'OANDA' : 'OANDA PRACTICE') + '</span><button type="button" class="stklv-x" data-k="no" aria-label="Close">×</button></div>' +
    '<h2 id="stklv-b3-h">Connect OANDA</h2>' +
    '<div class="stklv-cf-lines"><p>In OANDA, open <b>Manage API Access</b>, generate a personal access token and paste it here once. TradeZoro keeps it encrypted on this device and only our server uses it to talk to OANDA. <a href="/help/trade-with-oanda" target="_blank" rel="noopener">Step by step</a></p></div>' +
    (liveOk ? '<div class="stklv-seg" role="radiogroup" aria-label="Account type"><button type="button" role="radio" aria-checked="true" data-env="sandbox" class="on">Practice</button><button type="button" role="radio" aria-checked="false" data-env="live">Live</button></div>' : '') +
    '<label class="stklv-f"><span>Personal access token</span><input type="password" data-k="tok" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="text" aria-describedby="stklv-b3-e"></label>' +
    '<p class="stklv-en-err" id="stklv-b3-e" role="alert" hidden></p>' +
    '<div class="stklv-cf-btns"><button type="button" class="stklv-btn" data-k="no">Cancel</button><button type="button" class="stklv-btn stklv-go buy" data-k="yes" disabled>Connect</button></div>' +
    '<p class="stklv-fine">' + (liveOk ? '' : 'Practice accounts only for now. ') + DISCLAIMER + '</p></div>';
  document.body.appendChild(el);
  let envName = 'sandbox';
  const tok = el.querySelector('[data-k=tok]'), yes = el.querySelector('[data-k=yes]'), er = el.querySelector('.stklv-en-err');
  const done = () => { el.remove(); document.removeEventListener('keydown', k, true); try { prev && prev.focus && prev.focus(); } catch (e) {} render(); };
  const k = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(); } else e.stopPropagation(); };
  document.addEventListener('keydown', k, true);
  el.addEventListener('mousedown', (e) => { if (e.target === el) done(); });
  el.querySelectorAll('[data-k=no]').forEach((b) => b.addEventListener('click', done));
  el.querySelectorAll('[data-env]').forEach((b) => b.addEventListener('click', () => { envName = b.dataset.env; el.querySelectorAll('[data-env]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); }); }));
  tok.addEventListener('input', () => { yes.disabled = tok.value.trim().length < 20; });
  yes.addEventListener('click', async () => {
    yes.disabled = true; yes.textContent = 'Checking…'; er.hidden = true;
    try { await B3S.mod.connectOanda(tok.value, envName, TEST && TEST.b3Deps ? TEST.b3Deps : undefined); tok.value = ''; done(); toast('OANDA connected. Pick the account in the Trade menu.', 'success'); await loadB3(); await loadAccounts(); }
    catch (e) { er.textContent = e.message || 'Could not connect.'; er.hidden = false; yes.disabled = false; yes.textContent = 'Connect'; }
  });
  setTimeout(() => tok.focus(), 30);
}
function mountCopyTrading() {
  import('./chart-copy.js?v=1290').then((m) => m.mountCopy({ live: window.__stkLive, paper: P, toast })).catch((e) => console.warn('TradeZoro: copy trading', e));   // Trade menu > Copy trading
}
// beta tester? (assets/beta.js, loaded async by auth.js / app-nav.js; waits up to 10 s for it). Local test hook: __stkLiveTest.isBeta.
function betaReady() {
  const T = window.__stkLiveTest; if (T && T.isBeta && /^(127\.0\.0\.1|localhost)$/.test(location.hostname)) return Promise.resolve(!!T.isBeta());
  return new Promise((res) => { let n = 0; const t = () => { if (window.strykerBeta) window.strykerBeta.ready().then((s) => res(!!(s && s.beta)), () => res(false)); else if (n++ > 40) res(false); else setTimeout(t, 250); }; t(); });
}
export function mountLive(paperApi, opts) {
  P = paperApi; uid = opts.uid; toastFn = opts.toast || null; isAdmin = !!opts.admin;
  if (!document.getElementById('stklv-css')) { const st = document.createElement('style'); st.id = 'stklv-css'; st.textContent = CSS; document.head.appendChild(st); }
  P.setLiveHook({ quoteTags, setSlTp, posHandles, fmtPx, mtFor, mtSetSymbol, active, noLiveWhy, lines, chipText, badgeFor, badgeAct, openSymPicker, tickOf, chipX, drag, flattenActive, openTicket, renderHead, renderSummary, renderView, foot, dock, dockTrades, ladder, domState, cancel, flatten, caps, otherNote, openOther, opInfo, placeTicket, kill, killOn, retryEnv, enableLive });
  loadMeta(); loadAccounts();
  ctAllowed().then((ok) => { if (ok) Promise.all([loadCt(), loadB3()]).then(loadAccounts); });   // cTrader + BROKERS 3 trading: admins and beta testers (the servers re-check)
  // Copy trading: admins + beta testers (Owner 23 Nov). The server (functions/connect/finatic/copy.js) re-checks every call.
  if (isAdmin) mountCopyTrading(); else betaReady().then((b) => { if (b) mountCopyTrading(); });
  window.addEventListener('storage', (e) => { if (e.key === lsUserKey()) loadAccounts(); });
  Object.assign(window.__stkLive, { setSlTp, posHandles, quoteFor, dockTrades, openSymPicker, closeSymPicker, mtFor, mtSetSymbol, mtRemember, srcSymbols, srcSpec, ctFeed, connect, reconnect, pick, leave, read, loadAccounts, info, confirmSheet, balance, summary, metaOf, saveMeta, disconnect, L, envCheck, retryEnv, syncGroup, enableLive, get admin() { return isAdmin; }, get blockReason() { return blockReason(); } });
  Object.defineProperty(window.__stkLive, 'blockReason', { configurable: true, get: () => blockReason() });   // a getter (Object.assign would copy one frozen value)
}
