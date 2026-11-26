// TradeZoro — direct trading with tastytrade, TradeStation and OANDA (BROKERS 3, Owner 24 Nov 2026). ADMINS AND BETA TESTERS only for
// now; loaded by assets/chart-live.js after its admin / beta check (the server re-checks every call: functions/connect/brokers/trade.js).
// One shape for the three brokers, the same one cTrader uses (assets/ctrader-trade.js ctOps): ops.data(op, b) / ops.order(b) answer
// chart-live.js in the broker-link route shapes, so the order panel, ladder, Trade menu, Enable step, kill switch and order log are
// shared: no second order UI.
// Sign-in, kept apart from the view-only data sign-ins ("Connect your own data"): its own vault entry per broker ('<broker>-trade',
// kind 'trade', same encrypted, user-bound device vault as every BYO key):
//   tastytrade, TradeStation: OAuth "Allow trading with …" (scopes read + trade / openid offline_access MarketData ReadAccount Trade);
//     the code swap + refresh run on our server (functions/connect/brokers/token.js), where the app secret stays.
//   OANDA: the member pastes a personal access token once (Practice; Live hidden until switched on). Only our server calls OANDA with it.
// Demo / practice first: every sign-in is the broker's TEST environment (tastytrade sandbox, TradeStation SIM, OANDA practice) unless
// the server's probe says that broker's live flag is on. Education only. Not financial advice.
import { saveKeys, loadKeys, forgetKeys } from './byo-core.js?v=1300';

export const B3 = { TRADE: '/connect/brokers/trade', TOKEN: '/connect/brokers/token', STATE_KEY: 'tz-b3-trade-state', REFRESH_BEFORE: 3 * 60000 };
export const BROKERS = {
  tastytrade: { label: 'tastytrade', oauth: true, help: '/help/trade-with-tastytrade', stream: { sandbox: 'wss://streamer.cert.tastyworks.com', live: 'wss://streamer.tastyworks.com' } },
  tradestation: { label: 'TradeStation', oauth: true, help: '/help/trade-with-tradestation' },
  oanda: { label: 'OANDA', oauth: false, help: '/help/trade-with-oanda', fx: true }
};
const MIN = 60000;
const fail = (msg, o) => Object.assign(new Error(msg), o);
const b64url = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const vaultOf = (broker) => broker + '-trade';
const idToken = (d) => (d && d.idToken ? d.idToken() : globalThis.firebase.auth().currentUser.getIdToken());
const doFetch = (d) => (d && d.fetch) || ((...a) => globalThis.fetch(...a));

// ---------- probes (public): is the broker set up on TradeZoro, and is its live side switched on? ----------
const probeMemo = new Map();
export async function probe(broker, d) {
  if (probeMemo.has(broker)) return probeMemo.get(broker);
  const p = (async () => {
    try { const r = await doFetch(d)(B3.TRADE + '?broker=' + encodeURIComponent(broker), { cache: 'no-store' }); const j = await r.json().catch(() => null); return { configured: !!(j && j.configured), live: !!(j && j.live), clientId: j && j.client_id }; }
    catch (e) { return { configured: false, live: false }; }
  })();
  probeMemo.set(broker, p); return p;
}
export const _resetProbe = () => probeMemo.clear();

// ---------- OAuth "Allow trading with …" (tastytrade, TradeStation) ----------
export function authUrl(broker, cfg, userId, envName = 'sandbox', store = globalThis.sessionStorage) {
  if (!userId) throw new Error('Sign in first');
  const rec = { state: b64url(globalThis.crypto.getRandomValues(new Uint8Array(16))), uid: userId, broker, env: envName, exp: Date.now() + 10 * MIN, kind: 'trade' };
  store.setItem(B3.STATE_KEY, JSON.stringify(rec));
  const q = { response_type: 'code', client_id: cfg.client_id, redirect_uri: cfg.redirect, scope: cfg.scope, state: rec.state };
  if (cfg.audience) q.audience = cfg.audience;
  return cfg.authorize + '?' + new URLSearchParams(q);
}
// the callback page: a trading sign-in this tab started? (single use, same user, under 10 min, same broker)
export function takeState(state, userId, broker, store = globalThis.sessionStorage) {
  let rec = null; try { rec = JSON.parse(store.getItem(B3.STATE_KEY) || 'null'); } catch (e) { /* none */ }
  if (!rec || rec.state !== state) return null;
  store.removeItem(B3.STATE_KEY);
  return rec.uid === userId && rec.exp > Date.now() && rec.kind === 'trade' && rec.broker === broker ? rec : null;
}
export async function startSignIn(broker, userId, d) {
  const B = BROKERS[broker]; if (!B || !B.oauth) throw new Error('Unknown broker');
  const envName = d && d.env === 'live' ? 'live' : 'sandbox';
  let cfg = null;
  try { const r = await doFetch(d)(B3.TOKEN + '?broker=' + broker + '&env=' + envName, { cache: 'no-store' }); cfg = await r.json().catch(() => null); } catch (e) { cfg = null; }
  if (!cfg || !cfg.configured) throw new Error(B.label + ' trading is coming soon.');
  (d && d.assign ? d.assign : (u) => location.assign(u))(authUrl(broker, cfg, userId, envName, d && d.store));
}
export async function tokenCall(broker, body, idt, d) {
  let r; try { r = await doFetch(d)(B3.TOKEN, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + idt }, body: JSON.stringify({ broker, ...body }) }); }
  catch (e) { throw fail('TradeZoro could not be reached.', { status: 0 }); }
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || !j.access_token) throw fail((j && j.error) || 'Sign-in failed.', { status: r.status, code: j && j.code });
  return j;
}
export const credsOf = (j, prev) => ({ access: j.access_token, refresh: j.refresh_token || (prev && prev.refresh) || '', exp: Date.now() + (Number(j.expires_in) || 900) * 1000, env: j.env || (prev && prev.env) || 'sandbox', kind: 'trade' });
export async function swapCode(broker, code, envName, idt, d) { return credsOf(await tokenCall(broker, { grant: 'code', code, env: envName }, idt, d)); }
export const loadCreds = (broker) => loadKeys(vaultOf(broker)).catch(() => null);
export const saveCreds = (broker, c) => saveKeys(vaultOf(broker), { ...c, kind: 'trade' });
export const forgetCreds = (broker) => forgetKeys(vaultOf(broker));
// a fresh access token (OAuth brokers: refreshed shortly before expiry, one tab at a time, saved back to the TRADING entry only)
export async function fresh(broker, c, d) {
  if (!BROKERS[broker].oauth) return c.token;
  if (c.exp - Date.now() > B3.REFRESH_BEFORE) return c.access;
  const run = async () => {
    if (c.exp - Date.now() > B3.REFRESH_BEFORE) return c.access;
    if (!c.refresh) throw fail('Your ' + BROKERS[broker].label + ' trading sign-in expired. Tap Allow trading again.', { reconnect: true });
    let idt; try { idt = await idToken(d); } catch (e) { throw fail('Sign in again.', { status: 401 }); }
    let j; try { j = await tokenCall(broker, { grant: 'refresh', refresh_token: c.refresh, env: c.env }, idt, d); }
    catch (e) { if (e.status === 400 || e.status === 401) throw fail('Your ' + BROKERS[broker].label + ' trading sign-in expired. Tap Allow trading again.', { reconnect: true }); throw e; }
    Object.assign(c, credsOf(j, c));
    try { await (d && d.save ? d.save(c) : saveCreds(broker, c)); } catch (e) { /* kept in memory */ }
    return c.access;
  };
  const L = globalThis.navigator && navigator.locks;
  return L ? L.request('tz-b3-refresh-' + broker, run) : run();
}

// ---------- the trade route ----------
export async function route(broker, c, body, d) {
  const token = await fresh(broker, c, d);
  let idt; try { idt = await idToken(d); } catch (e) { throw fail('Sign in again.', { status: 401 }); }
  let r;
  try { r = await doFetch(d)(B3.TRADE, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + idt }, body: JSON.stringify({ broker, env: c.env === 'live' ? 'live' : 'sandbox', token, ...body }), cache: 'no-store' }); }
  catch (e) { throw fail('No answer from TradeZoro.', { status: 0, network: true }); }
  let j = null; try { j = await r.json(); } catch (e) { /* not json */ }
  if (!r.ok) throw fail((j && j.error) || 'Request failed (code ' + r.status + ').', { status: r.status, code: j && j.code, reconnect: !!(j && j.reconnect), needsConnect: !!(j && j.needsConnect) });
  return j || {};
}

// ---------- the ops chart-live.js calls (same answers as the broker-link routes; same shape as ctOps) ----------
// acct = the broker's account id. tick(code) -> the chart's tick for a code (rounded prices).
export function brokerOps(broker, c, acct, d) {
  const go = (b) => route(broker, c, { accountId: acct, ...b }, d);
  return {
    data(op, b) { if (!['live', 'balances', 'fills'].includes(op)) return Promise.reject(fail('Not available for ' + BROKERS[broker].label + '.', { status: 400 })); return go({ op, ...(b && b.orderIds ? {} : {}) }); },
    async order(b) {
      if (b.op === 'env' || b.op === 'schema') return go({ op: b.op, action: b.action });
      if (b.op === 'bracket') return { group: null };   // stop loss / take profit are held at the broker (native bracket), nothing to sync
      const body = { op: b.op, idemKey: b.idemKey };
      for (const k of ['symbol', 'side', 'qty', 'type', 'limitPrice', 'stopPrice', 'timeInForce', 'assetType', 'orderId', 'tick', 'sl', 'tp', 'ref']) if (b[k] !== undefined) body[k] = b[k];
      if (b.bracket) body.bracket = b.bracket;
      if (b.op === 'place' && broker === 'oanda') body.assetType = 'forex';
      const r = await go(body);
      if (r && r.bracket && r.bracket.native) { r.nativeBracket = true; r.bracket = null; }
      return r;
    }
  };
}

// ---------- order status feed ----------
// tastytrade: the account streamer (websocket; connect -> heartbeat; every Order notification = a status change). Others: the chart's
// fast reads after a write; OANDA also polls its transactions since the last id (fills, stop loss / take profit hits) through our server.
export class StatusFeed {
  constructor(broker, c, accts, onEvent, d) { this.broker = broker; this.c = c; this.accts = accts; this.on = onEvent; this.d = d || {}; this.ws = null; this.hb = null; this.tries = 0; this.stopped = false; this.since = ''; this.poll = null; }
  async start() {
    this.stopped = false;
    if (this.broker === 'oanda') { this.poll = setInterval(() => this.tick().catch(() => {}), this.d.pollMs || 5000); return this.tick().catch(() => {}); }
    if (this.broker !== 'tastytrade') return;
    const url = BROKERS.tastytrade.stream[this.c.env === 'live' ? 'live' : 'sandbox'];
    let tok; try { tok = await fresh('tastytrade', this.c, this.d); } catch (e) { return; }
    const WS = this.d.WebSocket || globalThis.WebSocket; const ws = new WS(url); this.ws = ws;
    ws.addEventListener('open', () => { this.tries = 0; ws.send(JSON.stringify({ action: 'connect', value: this.accts, 'auth-token': tok, 'request-id': 1 })); });
    ws.addEventListener('message', (e) => {
      let m = null; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m && m.action === 'connect' && m.status === 'ok' && !this.hb) this.hb = setInterval(() => { fresh('tastytrade', this.c, this.d).then((t) => { try { ws.send(JSON.stringify({ action: 'heartbeat', 'auth-token': t, 'request-id': 2 })); } catch (x) { /* closed */ } }, () => {}); }, this.d.hbMs || 20000);
      if (m && m.type === 'Order' && m.data) this.on({ type: 'order', id: String(m.data.id || ''), status: String(m.data.status || ''), account: String(m.data['account-number'] || '') });
    });
    ws.addEventListener('close', () => { clearInterval(this.hb); this.hb = null; if (!this.stopped && this.tries < 6) setTimeout(() => this.start(), Math.min(30000, 1000 * Math.pow(2, this.tries++))); });
  }
  async tick() {
    const r = await route('oanda', this.c, { op: 'events', accountId: this.accts[0], since: this.since }, this.d);
    if (r.last) this.since = r.last;
    for (const ev of r.events || []) this.on({ type: /FILL/.test(ev.type) ? 'fill' : 'order', id: ev.orderId, status: ev.type });
  }
  stop() { this.stopped = true; clearInterval(this.hb); clearInterval(this.poll); this.hb = this.poll = null; try { this.ws && this.ws.close(); } catch (e) { /* closed */ } this.ws = null; }
}

// ---------- OANDA personal access token (pasted once) ----------
export const OANDA_TOKEN = /^[A-Za-z0-9-]{20,200}$/;
export async function connectOanda(token, envName, d) {
  const t = String(token || '').trim();
  if (!OANDA_TOKEN.test(t)) throw fail('That does not look like an OANDA token. Copy the whole token from OANDA (Manage API Access).');
  const c = { token: t, env: envName === 'live' ? 'live' : 'sandbox', kind: 'trade' };
  const r = await route('oanda', c, { op: 'accounts' }, d);   // checks the token before anything is kept
  if (!r.data || !r.data.length) throw fail('OANDA said: no account on this token.');
  await (d && d.save ? d.save(c) : saveCreds('oanda', c));
  return c;
}
// the accounts on a sign-in -> chart-live account records (ids 'b3-<broker>-<account>')
export async function accountsFor(broker, c, d) {
  const r = await route(broker, c, { op: 'accounts' }, d);
  return (r.data || []).map((a) => ({ id: 'b3-' + broker + '-' + a.accountId, accountId: a.accountId, number: a.accountNumber, name: a.accountName, kind: a.kind }));
}
