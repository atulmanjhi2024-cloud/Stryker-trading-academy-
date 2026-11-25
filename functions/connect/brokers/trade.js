// POST /connect/brokers/trade — direct trading with tastytrade, TradeStation and OANDA (BROKERS 3, Owner 24 Nov 2026).
// ADMINS AND BETA TESTERS only (same decision as /api/beta/status: admins/{uid}, or a VERIFIED sign-in email on settings/betaTesters).
// Body: { broker, env:'sandbox'|'live', op, accountId?, token, ... }. token = the member's own broker access token (tastytrade /
// TradeStation OAuth) or OANDA personal access token. It lives encrypted in the member's device vault and is only ever forwarded to
// the broker from here; it is never stored, logged or echoed.
// Guards, in order (every one fails CLOSED):
//   method / origin / JSON / size · broker configured (else 503 {configured:false} "coming soon") · env 'live' only when that broker's
//   live flag is "1" (TASTY_TRADE_LIVE / TS_TRADE_LIVE / OANDA_TRADE_LIVE; unset = sandbox / SIM / practice only) · IP rate limit ·
//   Firebase ID token · admin or beta tester · the account must be one this token lists (sandbox: TradeStation SIM accounts only)
//   and for every WRITE (place / cancel / modify / flatten): a well-formed idempotency key · the master switch settings/liveTrading
//   (enabled:false = refused, for sandbox too) · the one-time "Enable live trading" acceptance · the per-member block
//   settings/liveBlocked · the audit row brokerOrderAudit/<b3-broker-key> created BEFORE the order (Firestore create-only: a repeated
//   key = 409 duplicate, never sent twice; no audit, no order) · only then the broker call, through _hosts.js guardFetch (a live host
//   is unreachable while the flag is off).
// An unclear write (timeout, network, 5xx) is never retried: we look for the order by its key once (tastytrade external-identifier,
// OANDA client id) and otherwise answer code 'unknown' (the chart blocks new orders until a fresh read).
// Errors say who said it: "tastytrade said: …" (the broker) or "TradeZoro: …" (our side). Education only. Not financial advice.
import { verifyIdToken, bearerOf } from '../../api/chart/_rt.js';
import { okOrigin, rateLimited, json } from '../_token.js';
import { mayTrade } from '../ctrader/trade.js';
import { openAudit, liveSwitchOn } from '../finatic/_audit.js';
import { hasConsent, memberBlocked } from '../finatic/_owner.js';
import { BROKERS, guardFetch, apiBase, envOf, liveOn, UA } from './_hosts.js';
import { ADAPTERS, ours, kindOf } from './_adapters.js';
import { roundPx, wholeQty } from '../../../assets/broker-trade-map.js';

export const configured = (env, broker) => {
  const b = BROKERS[broker]; if (!b) return false;
  if (b.enableVar) return env[b.enableVar] === '1';   // OANDA: personal tokens, no app secret; switched on by the CoS
  const [i, s] = b.creds.sandbox; return !!(env[i] && env[s]);
};
const KEY = /^[A-Za-z0-9-]{16,64}$/, ACCT = /^[A-Za-z0-9._\-]{1,40}$/, TOK = /^[A-Za-z0-9._~+\/=\-]{16,4096}$/;
const SYM = /^[A-Za-z0-9 ._\/!:\-]{1,32}$/;
const WRITES = new Set(['place', 'cancel', 'modify', 'flatten']);
const READS = new Set(['accounts', 'live', 'balances', 'fills', 'env', 'schema', 'events']);
const TIMEOUT = 10000, WRITE_TIMEOUT = 15000;
export const MSG = {
  switched_off: 'TradeZoro: live trading is switched off.', switch_unreadable: 'TradeZoro: the live trading switch could not be read, order not sent.',
  consent_needed: 'Enable live trading first: read and accept the notice in the Trade menu.', consent_unreadable: 'TradeZoro: your live trading acceptance could not be read, order not sent.',
  member_blocked: 'TradeZoro: live trading is switched off for your account. Contact support.', audit: 'TradeZoro: the order log is unavailable, so nothing was sent. Try again in a moment.',
  duplicate: 'TradeZoro: this order was already sent once. It was not sent again.', key: 'TradeZoro: this order has no valid key, nothing sent.',
  not_allowed: 'TradeZoro: direct broker trading is for admins and beta testers only right now.', account: 'TradeZoro: that account is not on this broker sign-in.'
};
const err = (status, error, code, extra) => json({ error, code, ...(extra || {}) }, status);

// the order the browser may send -> the checked order the adapters get (unknown fields dropped; prices rounded to the tick)
export function clean(b, broker) {
  const o = { symbol: String(b.symbol || '').trim(), side: b.side, qty: Number(b.qty), type: b.type, tif: b.timeInForce === 'gtc' ? 'gtc' : 'day', kind: ['future', 'equity', 'option'].includes(b.assetType) ? b.assetType : kindOf(b.symbol) };
  if (!SYM.test(o.symbol)) return { error: 'pick a symbol first.' };
  if (o.side !== 'buy' && o.side !== 'sell') return { error: 'pick Buy or Sell.' };
  if (!['market', 'limit', 'stop', 'stop_limit'].includes(o.type) || (broker === 'oanda' && o.type === 'stop_limit')) return { error: 'that order type is not available for this broker.' };
  if (broker === 'oanda') { if (!(o.qty > 0) || o.qty > 1e6) return { error: 'enter a size above 0.' }; o.kind = 'forex'; }
  else if (!wholeQty(o.qty)) return { error: 'quantity must be a whole number of 1 or more.' };
  const tick = Number(b.tick) > 0 && Number(b.tick) < 1000 ? Number(b.tick) : 0.01, r = (v) => (broker === 'oanda' ? Number(v) : roundPx(v, tick));
  if (o.type === 'limit' || o.type === 'stop_limit') { if (!(Number(b.limitPrice) > 0)) return { error: 'enter a limit price.' }; o.limitPrice = r(b.limitPrice); }
  if (o.type === 'stop' || o.type === 'stop_limit') { if (!(Number(b.stopPrice) > 0)) return { error: 'enter a stop price.' }; o.stopPrice = r(b.stopPrice); }
  const br = b.bracket && typeof b.bracket === 'object' ? b.bracket : b.sl != null || b.tp != null ? { sl: b.sl, tp: b.tp } : null;
  if (br) {
    const sl = br.sl != null && br.sl !== '' ? r(br.sl) : null, tp = br.tp != null && br.tp !== '' ? r(br.tp) : null;
    if (sl == null && tp == null) return { error: 'enter a stop loss or a take profit.' };
    if ((sl != null && !(sl > 0)) || (tp != null && !(tp > 0))) return { error: 'stop loss / take profit price invalid.' };
    const ref = o.limitPrice || o.stopPrice || Number(b.ref) || null, buy = o.side === 'buy';
    if (ref > 0 && sl != null && (buy ? sl >= ref : sl <= ref)) return { error: 'the stop loss must be ' + (buy ? 'below' : 'above') + ' the entry price.' };
    if (ref > 0 && tp != null && (buy ? tp <= ref : tp >= ref)) return { error: 'the take profit must be ' + (buy ? 'above' : 'below') + ' the entry price.' };
    o.bracket = { sl, tp };
  }
  return { order: o };
}

// one broker call: guarded host, our headers, the member's token, timeout, plain errors with their origin
export function caller(env, broker, envName, token, deps = {}) {
  const base = apiBase(broker, envName), label = BROKERS[broker].label;
  return {
    async call(method, path, body, opts = {}) {
      const headers = { Accept: 'application/json', Authorization: 'Bearer ' + token, 'User-Agent': UA };
      if (body) headers['Content-Type'] = 'application/json';
      let r;
      try { r = await guardFetch(env, broker, base + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(opts.write ? WRITE_TIMEOUT : TIMEOUT) }, deps.fetchImpl); }
      catch (e) {
        if (e && e.code === 'live_off') throw Object.assign(e, { origin: 'ours' });
        throw Object.assign(new Error(label + ' did not answer.'), { origin: 'broker', code: opts.write ? 'unknown' : 'upstream', status: 502 });
      }
      let j = null; const t = await r.text().catch(() => ''); try { j = t ? JSON.parse(t) : {}; } catch (e) { j = null; }
      if (r.ok) return j || {};
      if (r.status === 401) throw Object.assign(new Error('Your ' + label + ' sign-in expired. Connect ' + label + ' again.'), { origin: 'broker', code: 'reconnect', status: 401, reconnect: true });
      if (opts.write && r.status >= 500) throw Object.assign(new Error(label + ' did not give a clear answer.'), { origin: 'broker', code: 'unknown', status: 502 });
      const said = String(ADAPTERS[broker].errorText(j) || '').replace(/[\r\n]+/g, ' ').slice(0, 220);
      throw Object.assign(new Error(label + ' said: ' + (said || ('request refused (' + r.status + ').'))), { origin: 'broker', code: r.status === 404 ? 'not_found' : r.status === 429 ? 'rate_limited' : 'rejected', status: r.status === 404 ? 404 : r.status === 429 ? 429 : 400 });
    }
  };
}

// the accounts this token lists (memo 60 s per isolate, keyed by a hash of the token: the token itself is never kept)
const acctMemo = new Map();
async function tokHash(t) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join(''); }
export const _resetBrokers = () => acctMemo.clear();
async function accountsOf(x, broker, envName, token) {
  const k = broker + '|' + envName + '|' + await tokHash(token), hit = acctMemo.get(k);
  if (hit && Date.now() - hit.at < 60000) return hit.v;
  const v = await ADAPTERS[broker].accounts(x, envName);
  if (acctMemo.size > 500) acctMemo.clear(); acctMemo.set(k, { v, at: Date.now() });
  return v;
}

// deps (tests): verify(tok) / verifyFetch, allowed(), fetchImpl (the brokers), liveSwitch, store / audit / consent / blocked mocks, defer
export async function handle(request, env, deps = {}, ctx = null) {
  if (request.method === 'GET') {   // probe: which brokers are set up (public: nothing secret in it)
    const u = new URL(request.url), b = u.searchParams.get('broker');
    if (!BROKERS[b]) return err(404, 'Not found', 'not_found');
    const c = configured(env, b), id = BROKERS[b].creds ? env[BROKERS[b].creds.sandbox[0]] : undefined;
    return json({ configured: c, broker: b, ...(c && id ? { client_id: id } : {}), live: c && liveOn(env, b) }, c ? 200 : 503);
  }
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'GET, POST' } });
  if (!okOrigin(request, env)) return err(403, 'Forbidden', 'forbidden');
  if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) return err(415, 'JSON only', 'json_only');
  let b = null; try { const t = await request.text(); if (t.length <= 8192) b = JSON.parse(t); } catch (e) { b = null; }
  if (!b || typeof b !== 'object' || !BROKERS[b.broker]) return err(400, 'Bad request', 'bad_request');
  const broker = b.broker, label = BROKERS[broker].label, op = String(b.op || '');
  if (!configured(env, broker)) return err(503, label + ' is coming soon.', 'not_set_up', { configured: false });
  const envName = envOf(b.env);
  if (envName === 'live' && !liveOn(env, broker)) return err(403, 'TradeZoro: live ' + label + ' trading is not switched on yet. Demo / practice accounts only for now.', 'live_off');
  if (!READS.has(op) && !WRITES.has(op)) return err(400, 'Bad request', 'bad_request');
  if (await rateLimited(env, request, 'b3' + (WRITES.has(op) ? 'w' : 'r'))) return err(429, 'TradeZoro: too many requests. Wait a minute.', 'rate_limited');
  const idt = bearerOf(request);
  const uid = deps.verify ? await deps.verify(idt) : await verifyIdToken(idt, { fetchImpl: deps.verifyFetch });
  if (!uid) return err(401, 'Sign in again.', 'signed_out');
  let allowed = false; try { allowed = deps.allowed ? await deps.allowed(uid) : await mayTrade(env, idt, uid, deps); } catch (e) { allowed = false; }
  if (!allowed) return err(403, MSG.not_allowed, 'not_admin');
  if (!TOK.test(String(b.token || ''))) return err(409, 'Connect ' + label + ' first.', 'needs_connect', { needsConnect: true });
  const x = caller(env, broker, envName, b.token, deps), ad = ADAPTERS[broker];
  const fail = (e) => {
    const code = e.code || 'error', st = e.status && e.status >= 400 && e.status < 600 ? (e.status === 502 ? 503 : e.status) : 400;
    return err(st, e.message && (e.origin === 'broker' || e.origin === 'ours' || /^TradeZoro:/.test(e.message)) ? e.message : 'TradeZoro: something went wrong. Nothing was sent.', code, e.reconnect ? { reconnect: true } : undefined);
  };
  try {
    if (op === 'accounts') return json({ data: await accountsOf(x, broker, envName, b.token) });
    if (!ACCT.test(String(b.accountId || ''))) return err(400, 'TradeZoro: pick the account first.', 'account');
    const acct = String(b.accountId);
    const list = await accountsOf(x, broker, envName, b.token);
    if (!list.some((a) => a.accountId === acct)) return err(403, MSG.account, 'not_owner');
    if (op === 'live') return json({ data: await ad.live(x, acct) });
    if (op === 'balances') return json({ data: await ad.balances(x, acct) });
    if (op === 'fills') return json({ data: [] });
    if (op === 'schema') return json({ data: b.action === 'modify' ? { modify: true } : await ad.schema(x, acct) });
    if (op === 'events') return json(ad.events ? await ad.events(x, acct, /^\d{1,20}$/.test(String(b.since || '')) ? String(b.since) : '') : { events: [] });
    if (op === 'env') {   // for the badge: SANDBOX for every test env; the gates as they stand (null = unreadable)
      const [sw, cs, bl] = await Promise.all([liveSwitchOn(env, deps).catch(() => null), hasConsent(env, deps, uid).catch(() => null), memberBlocked(env, deps, uid).catch(() => null)]);
      return json({ env: envName === 'live' ? 'live' : 'sandbox', enabled: sw !== false, consent: cs, blocked: bl, broker });
    }
    // ---- writes
    const key = String(b.idemKey || ''); if (!KEY.test(key)) return err(400, MSG.key, 'key');
    let o = null;
    if (op === 'place') { const c = clean(b, broker); if (c.error) return err(400, 'TradeZoro: ' + c.error, 'shape'); o = c.order; }
    if ((op === 'cancel' || op === 'modify') && !/^[A-Za-z0-9._:@\-]{1,64}$/.test(String(b.orderId || ''))) return err(400, 'TradeZoro: that order id is not valid.', 'shape');
    let mod = null;
    if (op === 'modify') {
      const tick = Number(b.tick) > 0 ? Number(b.tick) : 0.01, r = (v) => (broker === 'oanda' ? Number(v) : roundPx(v, tick));
      if (Number(b.limitPrice) > 0) mod = { limitPrice: r(b.limitPrice) }; else if (Number(b.stopPrice) > 0) mod = { stopPrice: r(b.stopPrice) }; else return err(400, 'TradeZoro: enter the new price.', 'shape');
    }
    if (op === 'flatten' && !SYM.test(String(b.symbol || ''))) return err(400, 'TradeZoro: pick a symbol first.', 'shape');
    // the gates and the order log row (FASTORDER 25 Nov: all in parallel, was gates THEN log row = 2 Firestore round trips; every gate
    // fails closed). The order goes to the broker only when every gate said yes AND the log row exists. A refusal finishes OUR row
    // 'rejected' (a duplicate key's earlier row is never touched).
    const defer = deps.defer || ((p) => { const q = Promise.resolve(p).catch(() => {}); if (ctx && ctx.waitUntil) ctx.waitUntil(q); return q; });
    const entry = { uid, src: 'chart', venue: broker, env: envName, account: acct, op, symbol: o ? o.symbol : String(b.symbol || ''), side: o ? o.side : '', qty: o ? o.qty : 0, type: o ? o.type : op, orderId: String(b.orderId || '') };
    const [sw, cs, bl, au] = await Promise.all([liveSwitchOn(env, deps).then((v) => v, () => 'x'), hasConsent(env, deps, uid).then((v) => v, () => 'x'), memberBlocked(env, deps, uid).then((v) => v, () => 'x'),
      openAudit(env, deps, entry, 'b3-' + broker.slice(0, 2) + '-' + key).then((a) => ({ a }), (e) => ({ e: e || true }))]);
    const no = (st, msg, code) => { if (au.a) defer(au.a.finish({ result: 'rejected', reason: code, origin: 'ours' })); return err(st, msg, code); };
    if (sw === 'x') return no(503, MSG.switch_unreadable, 'switch_unreadable');
    if (sw === false) return no(403, MSG.switched_off, 'switched_off');
    if (cs === 'x') return no(503, MSG.consent_unreadable, 'consent_unreadable');
    if (cs !== true) return no(403, MSG.consent_needed, 'consent_needed');
    if (bl === 'x' || bl === true) return no(bl === true ? 403 : 503, bl === true ? MSG.member_blocked : MSG.switch_unreadable, bl === true ? 'member_blocked' : 'switch_unreadable');
    if (au.e) return au.e.duplicate ? err(409, MSG.duplicate, 'duplicate') : err(503, MSG.audit, 'audit');
    const audit = au.a;
    let res;
    try {
      if (op === 'place') res = await ad.place(x, acct, o, key);
      else if (op === 'cancel') res = await ad.cancel(x, acct, String(b.orderId));
      else if (op === 'modify') res = await ad.modify(x, acct, String(b.orderId), mod);
      else res = await ad.flatten(x, acct, String(b.symbol), key);
    } catch (e) {
      if (e.code === 'unknown' && op === 'place') {   // never re-sent: look for it once by its key
        let found = null; try { found = await ad.find(x, acct, key); } catch (e2) { found = null; }
        if (found) { defer(audit.finish({ result: 'accepted', status: found.status, brokerOrderId: found.orderId })); return json({ ok: true, op, status: found.status, orderId: found.orderId, settled: true }); }
      }
      defer(audit.finish({ result: e.code === 'unknown' ? 'unknown' : 'rejected', reason: String(e.message || '').slice(0, 200), origin: e.origin || 'ours' }));
      if (e.code === 'unknown') return err(503, label + ' did not give a clear answer for this order. It may or may not have gone through. Check your ' + label + ' orders before you send it again; nothing will be sent twice.', 'unknown');
      return fail(e);
    }
    defer(audit.finish({ result: 'accepted', status: String(res.status || ''), brokerOrderId: String(res.orderId || '') }));
    return json({ op, ...res });
  } catch (e) { return fail(e); }
}
export const onRequest = (ctx) => handle(ctx.request, ctx.env, {}, ctx);
