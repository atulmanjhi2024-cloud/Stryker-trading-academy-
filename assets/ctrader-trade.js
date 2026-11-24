// TradeZoro — cTrader LIVE TRADING link (ES module). ADMINS AND BETA TESTERS only for now (Owner 23 Nov 2026). Loaded by assets/chart-live.js for them.
// Our own cTrader Open API connection, no middle company: the browser talks to OUR relay /connect/ctrader/trade (it adds the app
// secret and checks every order, functions/connect/ctrader/_trade.js), which talks to cTrader.
// Sign-in: a SEPARATE "Allow trading" sign-in (cTrader's trading permission). It never touches the view-only data sign-in
// (byo-ctrader.js, "Connect your own data"): its own state record (kind 'trade'), its own vault entry 'ctrader-trade' in the same
// encrypted, user-bound device vault. Nobody is ever upgraded silently: only an admin who taps "Allow trading" gets a trading token.
// chart-live.js treats a cTrader account like its MetaTrader accounts (lots, the broker's own symbol names); this file answers the
// same ops the broker-link routes answer (live / balances / env / schema / place / modify / cancel / flatten) in the same shapes.
// Rules here (the relay checks everything again): one write at a time, every write carries the chart's idempotency key as its
// clientMsgId, an unclear answer is 'unknown' (never re-sent), a socket that closes mid-order = 'unknown'.
// Tests: tools/tests/ctrader-trade.test.mjs (mocked frames), tools/tests/ctrader-trade-browser.js. Education only. Not financial advice.
import { CT, probeCtrader, ctraderTokenCall, ctraderCreds } from './byo-ctrader.js?v=1246';
import { saveKeys, loadKeys, forgetKeys } from './byo-core.js?v=1246';

export const TT = { WS: '/connect/ctrader/trade', STATE_KEY: 'tz-ctrader-trade-state', VAULT: 'ctrader-trade', SCOPE: 'trading', HB_MS: 20000, CALL_MS: 15000 };
const MIN = 60000;
const fail = (msg, o) => Object.assign(new Error(msg), o);
const b64url = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ---------- "Allow trading" sign-in (separate from the data sign-in) ----------
export function tradeAuthUrl(clientId, userId, store = globalThis.sessionStorage) {
  if (!userId) throw new Error('Sign in first');
  const rec = { state: b64url(globalThis.crypto.getRandomValues(new Uint8Array(16))), uid: userId, exp: Date.now() + 10 * MIN, kind: 'trade' };
  store.setItem(TT.STATE_KEY, JSON.stringify(rec));
  return CT.AUTH + '?' + new URLSearchParams({ client_id: clientId, redirect_uri: CT.REDIRECT, scope: TT.SCOPE, product: 'web', state: rec.state });
}
// the callback page asks this first: a trading sign-in it started? (single use, same user, under 10 min)
export function takeTradeState(state, userId, store = globalThis.sessionStorage) {
  let rec = null; try { rec = JSON.parse(store.getItem(TT.STATE_KEY) || 'null'); } catch (e) { /* none */ }
  if (!rec || rec.state !== state) return null;   // not ours: leave it (and the data sign-in's record) alone
  store.removeItem(TT.STATE_KEY);
  return rec.uid === userId && rec.exp > Date.now() && rec.kind === 'trade' ? rec : null;
}
export async function startTradeSignIn(userId, d) {
  const id = await probeCtrader(d); if (!id) throw new Error('cTrader is not set up yet.');
  (d && d.assign ? d.assign : (u) => location.assign(u))(tradeAuthUrl(id, userId, d && d.store));
}
export const loadTradeCreds = () => loadKeys(TT.VAULT).catch(() => null);
export const saveTradeCreds = (c) => saveKeys(TT.VAULT, { ...c, kind: 'trade' });
export const forgetTradeCreds = () => forgetKeys(TT.VAULT);
// callback page: code -> tokens (same token function as the data sign-in; the scope was set on cTrader's page)
export async function swapTradeCode(code, idToken, d) { return { ...ctraderCreds(await ctraderTokenCall({ grant: 'code', code }, idToken, d)), kind: 'trade' }; }

// Refresh before expiry, saved back to the TRADING vault entry only (byo-ctrader.js fresh() saves to the data entry: never used here,
// so a trading token can never land in the view-only data sign-in). One tab at a time.
export async function freshTrade(c, d) {
  if (c.exp - Date.now() > CT.REFRESH_BEFORE) return c.access;
  const run = async () => {
    if (c.exp - Date.now() > CT.REFRESH_BEFORE) return c.access;
    if (!c.refresh) throw fail('Your cTrader trading sign-in expired. Tap Allow trading again.', { reconnect: true });
    let idt; try { idt = await (d && d.idToken ? d.idToken() : globalThis.firebase.auth().currentUser.getIdToken()); } catch (e) { throw fail('Sign in again.', { status: 401 }); }
    let j; try { j = await ctraderTokenCall({ grant: 'refresh', refresh_token: c.refresh }, idt, d); }
    catch (e) { if (e.status === 400 || e.status === 401) throw fail('Your cTrader trading sign-in expired. Tap Allow trading again.', { reconnect: true }); throw e; }
    Object.assign(c, ctraderCreds(j, c), { kind: 'trade' });
    try { await (d && d.save ? d.save(c) : saveTradeCreds(c)); } catch (e) { /* kept in memory */ }
    return c.access;
  };
  const L = globalThis.navigator && navigator.locks;
  return L ? L.request('tz-ctrader-trade-refresh', run) : run();
}

// ---------- pure mapping (cTrader -> the shapes chart-live-core.js reads) ----------
const n = (v) => Number(v);
export const side = (v) => (String(v) === '2' || /SELL/i.test(String(v)) ? 'sell' : 'buy');
export const sym = (s) => ({ id: n(s.symbolId), name: String(s.symbolName || '').trim() });
// details from SymbolByIdRes: lots (min / step / max, our cap applied), digits, lot size
export function lotsOf(d, capLots = 10) {
  if (!d || !(d.lotSize > 0)) return null;
  const L = d.lotSize, step = (d.stepVolume > 0 ? d.stepVolume : L / 100) / L, min = (d.minVolume > 0 ? d.minVolume : d.stepVolume || L / 100) / L;
  const max = Math.min(d.maxVolume > 0 ? d.maxVolume / L : Infinity, capLots);
  return { min: +min.toFixed(8), step: +step.toFixed(8), max: +max.toFixed(8), fromSchema: true };
}
export const volOf = (lots, d) => Math.round(Number(lots) * d.lotSize);
export const tickOf = (d) => (d && Number.isInteger(d.digits) ? Math.pow(10, -d.digits) : 0.00001);
// ReconcileRes -> { positions, orders } in the broker-link shape (symbol = cTrader's name; quantity in lots; ids as strings)
export function mapReconcile(pl, names, details) {
  const nm = (id) => names.get(n(id)) || String(id);
  const lots = (v, id) => { const d = details.get(n(id)); return d && d.lotSize > 0 ? n(v) / d.lotSize : n(v) / 100 / 100000; };
  const positions = (pl.position || []).filter((p) => p && p.tradeData).map((p) => {
    const td = p.tradeData, s = side(td.tradeSide), q = lots(td.volume, td.symbolId);
    return { positionId: String(p.positionId), symbol: nm(td.symbolId), symbolId: n(td.symbolId), quantity: s === 'sell' ? -q : q, volume: n(td.volume), averagePrice: n(p.price) || null, status: 'OPEN', stopLoss: p.stopLoss, takeProfit: p.takeProfit, label: td.label || '' };
  });
  const orders = (pl.order || []).filter((o) => o && o.tradeData && !o.closingOrder).map((o) => {
    const td = o.tradeData, ty = String(o.orderType) === '3' || /STOP/i.test(String(o.orderType)) ? 'stop' : String(o.orderType) === '2' || /LIMIT/i.test(String(o.orderType)) ? 'limit' : 'market';
    return { orderId: String(o.orderId), status: 'WORKING', orderType: ty, symbolId: n(td.symbolId), legs: [{ symbol: nm(td.symbolId), side: side(td.tradeSide), quantity: lots(td.volume, td.symbolId), limitPrice: o.limitPrice, stopPrice: o.stopPrice }] };
  });
  return { positions, orders };
}
// TraderRes -> one balance snapshot (cTrader money is an integer with moneyDigits)
export function mapTrader(t, assets, now = Date.now()) {
  if (!t || t.balance == null) return [];
  const md = Number.isInteger(n(t.moneyDigits)) ? n(t.moneyDigits) : 2;
  const a = (assets || []).find((x) => x && n(x.assetId) === n(t.depositAssetId)), cur = a && /^[A-Z]{3}$/.test(String(a.name || a.displayName || '')) ? String(a.name || a.displayName) : '';
  return [{ balance: n(t.balance) / Math.pow(10, md), currency: cur, updatedAt: new Date(now).toISOString() }];
}
// chart-live write body (buildPlaceMt shape + sl / tp) -> [payloadType, payload] | { error }
export function buildNewOrder(b, ctx) {
  const d = ctx.details.get(ctx.symbolId); if (!d) return { error: 'This symbol’s size rules are still loading. Try again in a moment.' };
  const lots = lotsOf(d, ctx.capLots); const vol = volOf(b.qty, d);
  if (!(vol > 0) || Number(b.qty) < lots.min - 1e-9 || Number(b.qty) > lots.max + 1e-9) return { error: 'Size is ' + lots.min + ' to ' + lots.max + ' lots.' };
  const t = { market: 1, limit: 2, stop: 3 }[b.type]; if (!t) return { error: 'Market, limit or stop only.' };
  const dig = Number.isInteger(d.digits) ? d.digits : 5, r = (v) => Number(Number(v).toFixed(dig));
  const p = { ctidTraderAccountId: ctx.account, symbolId: ctx.symbolId, orderType: t, tradeSide: b.side === 'sell' ? 2 : 1, volume: vol };
  if (t === 2) p.limitPrice = r(b.limitPrice);
  if (t === 3) p.stopPrice = r(b.stopPrice);
  if (t !== 1) p.timeInForce = 2;   // GOOD_TILL_CANCEL
  const sl = b.sl != null && b.sl !== '' ? Number(b.sl) : null, tp = b.tp != null && b.tp !== '' ? Number(b.tp) : null;
  if (sl != null || tp != null) {
    if (t === 1) {   // market: relative to the fill, from the chart's last price
      if (!(ctx.last > 0)) return { error: 'No price yet for the stop loss / take profit. Try again in a moment.' };
      const unit = Math.pow(10, 5 - dig), rel = (x) => Math.round(Math.abs(x - ctx.last) * 1e5 / unit) * unit;
      const buy = p.tradeSide === 1;
      if (sl != null) { if (buy ? sl >= ctx.last : sl <= ctx.last) return { error: 'The stop loss must be ' + (buy ? 'below' : 'above') + ' the price.' }; p.relativeStopLoss = rel(sl); }
      if (tp != null) { if (buy ? tp <= ctx.last : tp >= ctx.last) return { error: 'The take profit must be ' + (buy ? 'above' : 'below') + ' the price.' }; p.relativeTakeProfit = rel(tp); }
      if (p.relativeStopLoss === 0 || p.relativeTakeProfit === 0) return { error: 'Stop loss / take profit too close to the price.' };
    } else { if (sl != null) p.stopLoss = r(sl); if (tp != null) p.takeProfit = r(tp); }
  }
  return [2106, p];
}
// relay / cTrader answer for one write -> { ok, status, orderId } | throws Error with .code ('unknown' | 'rejected' | relay code)
const EXEC = { 2: 'ACCEPTED', 3: 'FILLED', 4: 'REPLACED', 5: 'CANCELLED', 6: 'EXPIRED', 7: 'REJECTED', 8: 'CANCEL_REJECTED', 11: 'PARTIALLY_FILLED' };
const CT_ERR = { NOT_ENOUGH_MONEY: 'Not enough money in the account for this order.', MARKET_CLOSED: 'The market is closed for this symbol.', TRADING_DISABLED: 'Trading is disabled for this symbol or account.',
  POSITION_NOT_FOUND: 'That position is not open any more.', OID_NOT_FOUND: 'That order is not working any more.', TRADING_BAD_VOLUME: 'The broker does not accept that size.', TRADING_BAD_STOPS: 'The broker does not accept that stop loss / take profit.',
  ALREADY_SUBSCRIBED: 'Already subscribed.', CH_ACCESS_TOKEN_INVALID: 'Your cTrader sign-in expired. Tap Allow trading again.', ACCOUNT_NOT_AUTHORIZED: 'This cTrader account is not authorised. Tap Allow trading again.',
  NO_QUOTES: 'No price from the broker right now.', BAD_STOPS: 'The broker does not accept that stop loss / take profit.' };
export const errText = (code, desc) => CT_ERR[String(code || '')] || ('The broker refused it' + (code ? ' (' + String(code).replace(/[^A-Z0-9_]/gi, '').slice(0, 40) + ')' : '') + '.');
const RENEW = new Set(['gate_unreadable', 'renew']);
export function answerOf(m) {
  if (m.relay === 'refused') throw fail(m.error || 'Not sent.', { code: m.code === 'unresolved' ? 'unresolved' : m.code || 'refused', status: 409 });
  if (m.relay === 'unknown') throw fail('No clear answer from cTrader for this order. It may or may not have gone through. Checking your orders; nothing will be sent again.', { code: 'unknown' });
  const pl = m.payload || {};
  if (m.payloadType === 2126) {
    const et = EXEC[n(pl.executionType)] || String(pl.executionType || '').replace(/^ORDER_/, '');
    if (/REJECTED/.test(et)) throw fail(errText(pl.errorCode), { code: 'rejected', status: 409 });
    return { ok: true, status: et || 'ACCEPTED', orderId: String((pl.order && pl.order.orderId) || ''), positionId: String((pl.position && pl.position.positionId) || '') };
  }
  if (m.payloadType === 2132 || m.payloadType === 2142 || m.payloadType === 50) throw fail(errText(pl.errorCode, pl.description), { code: 'rejected', status: 409 });
  throw fail('Unexpected answer from cTrader.', { code: 'unknown' });
}

// ---------- the link: one trade socket for the picked account ----------
export class TradeLink {
  constructor(creds, d) {
    this.c = creds; this.d = d || {}; this.ws = null; this.ready = null; this.pend = new Map(); this.n = 0; this.ka = null; this.dead = false;
    this.names = new Map(); this.byName = new Map(); this.details = new Map(); this.gates = null; this.gatesP = new Promise((r) => { this.gatesR = r; }); this.writing = null; this.onEvent = null; this.capLots = 10;
  }
  url() { const loc = this.d.location || globalThis.location; return (loc.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + loc.host + TT.WS + '?account=' + encodeURIComponent(this.c.accountId) + '&env=' + (this.c.isLive ? 'live' : 'demo'); }
  open() {
    if (this.ready && !this.dead) return this.ready;
    this.dead = false;
    const WS = this.d.WS || globalThis.WebSocket;
    this.onSock = new Set();
    this.ready = (async () => {
      const at = await freshTrade(this.c, this.d);
      const idt = await (this.d.idToken ? this.d.idToken() : globalThis.firebase.auth().currentUser.getIdToken()).catch(() => { throw fail('Sign in again.', { status: 401 }); });
      await new Promise((res, rej) => {
        let ws; try { ws = new WS(this.url(), ['tz-auth', idt]); } catch (e) { return rej(fail('Couldn’t open the cTrader trading link.', { status: 0 })); }
        this.ws = ws;
        ws.onmessage = (ev) => this.onMsg(ev.data, res);
        ws.onclose = (ev) => { if (ev && ev.code === 4001) { this.shut(); return rej(fail('The trading link was refreshing. Nothing was sent. Try again.', { status: 0, code: 'renew' })); } const why = ev && ev.code === 1008 ? 'The cTrader trading link was refused.' : 'The cTrader trading link closed.'; this.shut(why); rej(fail(why + (ev && ev.code === 1006 ? ' It may be open in another tab, or your trading access could not be confirmed. Try again.' : ''), { status: 0 })); };
        ws.onerror = () => { try { ws.close(); } catch (e) { /* closed */ } };
      });
      // the relay renews a socket that used up its server budget (close 4001, nothing in flight): reopen it in the background so the
      // next order finds a ready link. At most once a minute (no reconnect loop); nothing is ever resent.
      const sock = this.ws; if (sock) sock.onclose = (ev) => { const code = ev && ev.code; this.shut(code === 1008 ? 'The cTrader trading link was refused.' : 'The cTrader trading link closed.'); if (code === 4001) this.reopenSoon(); };
      // heartbeats only while chart-live keeps the account picked; otherwise the relay's 60 s idle close frees the one trade socket
      this.ka = setInterval(() => { if (this.keep && !this.keep()) return; try { this.raw({ payloadType: 51, payload: {} }); } catch (e) { /* closed */ } }, TT.HB_MS);
      const list = await this.send(2149, { accessToken: at });
      const acct = ((list.payload && list.payload.ctidTraderAccount) || []).find((a) => n(a.ctidTraderAccountId) === n(this.c.accountId));
      if (!acct) throw fail('This cTrader account is not on your cTrader ID any more. Tap Allow trading again.', { status: 401, reconnect: true });
      const sc = list.payload && list.payload.permissionScope;   // on the response, not per account: 0 / SCOPE_VIEW, 1 / SCOPE_TRADE
      if (!(n(sc) === 1 || sc === 'SCOPE_TRADE')) throw fail('This cTrader sign-in is view-only. Tap Allow trading to give TradeZoro trading permission.', { status: 403, reconnect: true });
      const r = await this.send(2102, { ctidTraderAccountId: n(this.c.accountId), accessToken: at });
      if (r.payloadType !== 2103) throw fail('cTrader refused the sign-in. Tap Allow trading again.', { status: 401, reconnect: true });
      const s = await this.send(2114, { ctidTraderAccountId: n(this.c.accountId) });   // not call(): that awaits open() = this promise
      for (const x of (s.payload && s.payload.symbol) || []) { const y = sym(x); if (y.name && x.enabled !== false) { this.names.set(y.id, y.name); if (!this.byName.has(y.name.toUpperCase())) this.byName.set(y.name.toUpperCase(), y.id); } }
    })();
    this.ready.catch(() => this.shut());
    return this.ready;
  }
  onMsg(text, ready) {
    let m; try { m = JSON.parse(text); } catch (e) { return; }
    if (m.relay === 'ready') return ready();
    if (m.relay === 'gates') { this.gates = { consent: m.consent, blocked: m.blocked, switchOn: m.switchOn }; this.gatesR(this.gates); return; }
    if (m.relay === 'resolved') { if (this.onEvent) this.onEvent('resolved', m); return; }
    const id = m.clientMsgId, p = this.pend.get(id);
    if (p) { this.pend.delete(id); clearTimeout(p.t); p.res(m); return; }
    if (m.payloadType === 2126 || m.payloadType === 2123) { if (this.onEvent) this.onEvent('exec', m); }
    if (m.payloadType === 2147 || m.payloadType === 2148 || m.payloadType === 2164) this.shut('Your cTrader sign-in ended. Tap Allow trading again.');
  }
  raw(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); else throw fail('The cTrader trading link closed.', { status: 0 }); }
  send(type, payload, key, ms) {
    return new Promise((res, rej) => {
      const id = key || 'r' + (++this.n);
      const t = setTimeout(() => { this.pend.delete(id); rej(fail('cTrader did not answer.', { status: 0, code: key ? 'unknown' : '' })); }, ms || TT.CALL_MS + (key ? 5000 : 0));
      this.pend.set(id, { res, t, write: !!key });
      try { this.raw({ clientMsgId: id, payloadType: type, payload }); } catch (e) { clearTimeout(t); this.pend.delete(id); rej(e); }
    });
  }
  async call(type, payload) { await this.open(); const m = await this.send(type, { ctidTraderAccountId: n(this.c.accountId), ...payload }); if (m.payloadType === 2142 || m.payloadType === 50) throw fail(errText(m.payload && m.payload.errorCode), { status: 0 }); return m; }
  // the relay checks sizes against what ITS socket learned (SymbolByIdRes), so a reopened link asks again (the copy kept here is
  // only for the size picker); this.onSock = the symbol ids loaded on the current socket
  async detail(symbolId) {
    if (this.details.has(symbolId) && this.onSock && this.onSock.has(symbolId)) return this.details.get(symbolId);
    const m = await this.call(2116, { symbolId: [symbolId] });
    for (const s of (m.payload && m.payload.symbol) || []) this.onSock.add(n(s.symbolId));
    for (const s of (m.payload && m.payload.symbol) || []) this.details.set(n(s.symbolId), { lotSize: n(s.lotSize), minVolume: n(s.minVolume), maxVolume: n(s.maxVolume), stepVolume: n(s.stepVolume), digits: n(s.digits) });
    return this.details.get(symbolId);
  }
  // one write: the key is the chart's idempotency key; never retried here
  async write(type, payload, key) {
    if (this.writing) throw fail('Another order is still on its way. Wait for its answer.', { code: 'busy', status: 409 });
    if (!this.lastWrite) this.lastWrite = 0;
    this.writing = key;
    try {
      await this.open();
      const gap = this.lastWrite + 550 - Date.now(); if (gap > 0) await new Promise((r) => setTimeout(r, gap));   // the relay takes 2 a second
      this.lastWrite = Date.now();
      const m = await this.send(type, { ctidTraderAccountId: n(this.c.accountId), ...payload }, key);
      // the relay could not confirm the trading access ('gate_unreadable') or is renewing its link ('renew'): NOTHING was sent.
      // Reopen the link once in the background (a fresh server request) so the member's own retry finds it ready. Never resent here.
      if (m.relay === 'refused' && RENEW.has(m.code)) this.renew();
      else this.renewed = false;
      return answerOf(m); }
    finally { this.writing = null; }
  }
  renew() { if (this.renewed) return; this.renewed = true; this.shut(); this.reopenSoon(true); }
  reopenSoon(force) {
    const t = Date.now(); if (!force && t - (this.reopenAt || 0) < 60000) return; this.reopenAt = t;
    if (this.keep && !this.keep()) return;   // the account is no longer picked: let it rest
    setTimeout(() => { if (!this.ready) this.open().catch(() => {}); }, 0);
  }
  shut(why) {
    if (this.dead) return; this.dead = true; clearInterval(this.ka);
    for (const [id, p] of this.pend) { clearTimeout(p.t); p.res(p.write ? { relay: 'unknown', clientMsgId: id } : { payloadType: 2142, payload: { errorCode: 'CLOSED' } }); }
    this.pend.clear();
    const ws = this.ws; this.ws = null; if (ws) { ws.onclose = ws.onmessage = ws.onerror = null; try { ws.close(); } catch (e) { /* closed */ } }
    this.why = why || ''; this.ready = null;
    if (this.onEvent) this.onEvent('closed', { why: this.why });
  }
}

// lots for a cTrader symbol name, once its details are loaded (else null and a load starts)
export function lotsForName(link, name) {
  const id = link.byName.get(String(name || '').toUpperCase()); if (!id) return null;
  const d = link.details.get(id); if (d) return lotsOf(d, link.capLots);
  link.detail(id).catch(() => {}); return null;
}
// ---------- the ops chart-live.js calls for a cTrader account (same answers as the broker-link routes) ----------
// link: a TradeLink. Returns { data(op, b), order(b) } -> Promise of the route-shaped answer, or throws like call() in chart-live.js.
export function ctOps(link, { lastPrice } = {}) {
  const idOf = (name) => link.byName.get(String(name || '').toUpperCase());
  const ops = {
    async data(op) {
      if (op === 'live') { const m = await link.call(2124, {}); const pl = m.payload || {}; await Promise.all([...new Set((pl.position || []).concat(pl.order || []).map((x) => x && x.tradeData && n(x.tradeData.symbolId)).filter((x) => x > 0))].map((i) => link.detail(i).catch(() => null))); return { data: mapReconcile(pl, link.names, link.details) }; }
      if (op === 'balances') {
        const m = await link.call(2121, {});
        if (!link.assets) link.assets = await link.call(2112, {}).then((x) => (x.payload && x.payload.asset) || [], () => null);
        return { data: mapTrader(m.payload && m.payload.trader, link.assets) };
      }
      if (op === 'fills') return { data: [] };
      throw fail('Not available for cTrader.', { status: 400 });
    },
    async order(b) {
      // a cTrader DEMO account shows as SANDBOX on every badge (the word chart-live already uses for a practice account)
      if (b.op === 'env') { await link.open(); const g = link.gates || (await Promise.race([link.gatesP, new Promise((r) => setTimeout(() => r({}), 3000))])) || {}; return { env: link.c.isLive ? 'live' : 'sandbox', enabled: g.switchOn !== false, consent: g.consent == null ? null : !!g.consent, blocked: g.blocked == null ? null : !!g.blocked }; }
      if (b.op === 'schema') { await link.open(); return { data: b.action === 'modify' ? { modify: true } : { symbols: { enum: [...link.byName.keys()].map((k) => link.names.get(link.byName.get(k))) }, supportedOrderTypesByAssetClass: { forex: ['MARKET', 'LIMIT', 'STOP'] } } }; }
      const key = String(b.idemKey || '');
      if (b.op === 'place') {
        await link.open();   // the symbol names load with the link
        const sid = idOf(b.symbol); if (!sid) throw fail('cTrader does not list ' + b.symbol + ' on this account.', { status: 400 });
        await link.detail(sid);
        const last = lastPrice ? lastPrice() : null;
        const q = buildNewOrder(b, { details: link.details, symbolId: sid, account: n(link.c.accountId), last, capLots: link.capLots });
        if (q.error) throw fail(q.error, { status: 400 });
        return link.write(q[0], q[1], key);
      }
      if (b.op === 'cancel') return link.write(2108, { orderId: n(b.orderId) }, key);
      if (b.op === 'modify') { const d = b.stopPrice !== undefined ? { stopPrice: Number(b.stopPrice) } : { limitPrice: Number(b.limitPrice) }; return link.write(2109, { orderId: n(b.orderId), ...d }, key); }
      if (b.op === 'flatten') {   // close every position in the symbol, one at a time (the relay's account lock takes them in turn)
        const st = (await ops.data('live')).data, same = (x) => String(x).toUpperCase() === String(b.symbol).toUpperCase();
        const mine = st.positions.filter((p) => same(p.symbol)), work = st.orders.filter((o) => same((o.legs[0] || {}).symbol));
        if (!mine.length && !work.length) return { ok: true, op: 'flatten', closed: null };
        let i = 0, last = null;
        const base = key.replace(/[^A-Za-z0-9-]/g, '').slice(0, 44);   // the relay's key rule (no dots: US100.cash)
        for (const o of work) last = await link.write(2108, { orderId: n(o.orderId) }, base + '-o' + (++i));
        for (const p of mine) last = await link.write(2111, { positionId: n(p.positionId), volume: p.volume }, base + '-p' + (++i));
        return { ok: true, op: 'flatten', closed: mine.length, cancelled: work.length, status: last && last.status };
      }
      throw fail('Not allowed.', { status: 400 });
    }
  };
  return ops;
}
