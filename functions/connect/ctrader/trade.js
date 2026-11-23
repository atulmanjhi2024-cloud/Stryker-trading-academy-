// GET /connect/ctrader/trade?account=<ctidTraderAccountId>&env=demo|live — the cTrader TRADING relay for ADMINS AND BETA TESTERS only (WebSocket).
// Same door as the data relay (ws.js: origin https://tradezoro.com, the Firebase ID token as the "tz-auth" subprotocol, never in the
// URL, KV rate limit) plus: the caller must be an admin (admins/{uid}) or a beta tester (settings/betaTesters, verified email), the ONE cTrader account is pinned in the URL (the relay only
// authorises that account, and only with a trading-scope token), one trade socket per admin, and the LIVE cTrader server is used only
// when the Pages env CTRADER_TRADE_LIVE is "1" (unset = demo accounts only; switching it on is the Owner's call).
// Every write goes through _trade.js (schema + rebuild, size / symbol / id checks, admin, settings/liveTrading, liveConsent, liveBlocked,
// the account lock and the audit row before anything is sent). Secrets: CTRADER_CLIENT_ID / CTRADER_CLIENT_SECRET (added here, never
// sent to the browser), FIREBASE_SA_KEY (audit, lock, switches). Logs nothing but fixed words.
import { verifyIdToken, wsTokenOf } from '../../api/chart/_rt.js';
import { betaFor } from '../../api/beta/_lib.js';
import { normEmail } from '../../../assets/beta-config.mjs';
import { createRelay, LIMITS } from './_relay.js';
import { tradeHooks, TLIMITS } from './_trade.js';
import { openAudit, liveSwitchOn, DOCS, fields, fsCall } from '../finatic/_audit.js';
import { hasConsent, memberBlocked, store } from '../finatic/_owner.js';

const ORIGIN = 'https://tradezoro.com', HOSTS = { live: 'https://live.ctraderapi.com:5036', demo: 'https://demo.ctraderapi.com:5036' };
const RATE_MAX = 12;
const err = (status, error, code) => new Response(JSON.stringify({ error, code }), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const open = new Map(), mem = new Map();   // shortcut: per-isolate socket count; the account lock in Firestore is what stops a second write
const devOk = (request, env) => env.DEV === '1' && new URL(request.url).hostname !== 'tradezoro.com' && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(request.headers.get('origin') || '');
async function rateLimited(env, request) {
  const key = 'rl:cttr:' + (request.headers.get('cf-connecting-ip') || 'unknown') + ':' + Math.floor(Date.now() / 60000);
  try {
    if (env.PASSKEYS) { const n = Number(await env.PASSKEYS.get(key)) || 0; if (n >= RATE_MAX) return true; await env.PASSKEYS.put(key, String(n + 1), { expirationTtl: 120 }); return false; }
    for (const k of mem.keys()) if (k !== key) mem.delete(k);
    const n = (mem.get(key) || 0) + 1; mem.set(key, n); return n > RATE_MAX;
  } catch (e) { return true; }
}

// the shared account lock: brokerLocks/ct_<account> { key, uid, at }. Server-written only (no client rule: the catch-all denies).
export function accountLock(env, deps, uid, account) {
  if (deps.lock) return deps.lock;
  const path = 'brokerLocks/ct_' + account, S = store(env, deps);
  return {
    async take(key) {
      try { await S.create(path, { key, uid, at: Date.now() }); return true; }
      catch (e) { if (!e.duplicate) throw e; const h = await S.get(path); return h && h.key ? { key: String(h.key), at: Number(h.at) || 0 } : { key: '', at: 0 }; }
    },
    async peek() { const h = await S.get(path); return h && h.key ? { key: String(h.key), at: Number(h.at) || 0 } : null; },
    async release(key) {   // only the holder's key releases it
      const h = await S.get(path); if (!h || h.key !== key) return;
      const r = await fsCall(env, deps, 'DELETE', DOCS + path); if (!r.ok && r.status !== 404) throw new Error('lock delete');
    }
  };
}
async function patchAudit(env, deps, id, res) {
  if (deps.patchAudit) return deps.patchAudit(id, res);
  const mask = Object.keys(res).map((k) => 'updateMask.fieldPaths=' + k).join('&');
  await fsCall(env, deps, 'PATCH', DOCS + 'brokerOrderAudit/' + encodeURIComponent(id) + '?' + mask, { fields: fields(res) });
}

// Who may trade (Owner 23 Nov): an admin (admins/{uid}) OR a beta tester (VERIFIED sign-in email on settings/betaTesters), the
// same decision as /api/beta/status (functions/api/beta/_lib.js betaFor). Uses the signature-checked token's own claims; fails CLOSED.
const claimsOf = (tok) => { try { return JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { return {}; } };
export async function mayTrade(env, tok, uid, deps = {}) {
  const p = claimsOf(tok);
  const b = await betaFor(env, { uid, email: normEmail(p.email), verified: p.email_verified === true }, { fetchImpl: deps.betaFetch });
  return !!(b.admin || b.beta);
}

// deps (tests): connect(envName), verify(token) / verifyFetch, pair(), isAdmin(), liveSwitch(), store, lock, audit, patchAudit, defer
export async function handle(request, env, deps = {}, ctx = null) {
  const configured = !!(env.CTRADER_CLIENT_ID && env.CTRADER_CLIENT_SECRET);
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } });
  if (!configured) return err(503, 'cTrader is coming soon');
  if (request.headers.get('upgrade') !== 'websocket') return err(426, 'websocket required');
  if (!(request.headers.get('origin') === ORIGIN || devOk(request, env))) return err(403, 'Forbidden');
  const u = new URL(request.url), envName = u.searchParams.get('env') === 'live' ? 'live' : 'demo', account = Number(u.searchParams.get('account'));
  if (!Number.isSafeInteger(account) || account <= 0) return err(400, 'Pick the cTrader account first', 'account');
  if (envName === 'live' && env.CTRADER_TRADE_LIVE !== '1') return err(403, 'Live cTrader trading is not switched on yet. Demo accounts only for now.', 'live_off');
  if (await rateLimited(env, request)) return err(429, 'Too many tries. Wait a minute.');
  const tok = wsTokenOf(request);
  const uid = deps.verify ? await deps.verify(tok) : await verifyIdToken(tok, { fetchImpl: deps.verifyFetch });
  if (!uid) return err(401, 'Sign in first');
  // isAdmin = "admin or beta tester" (name kept: _trade.js re-asks it before every write)
  const isAdmin = () => (deps.isAdmin ? deps.isAdmin() : mayTrade(env, tok, uid, deps));
  if (!(await isAdmin().catch(() => false))) return err(403, 'Live cTrader trading is for admins and beta testers only right now.', 'not_admin');
  if ((open.get(uid) || 0) >= TLIMITS.perUid) return err(429, 'cTrader trading is already open in another tab. Use that tab, or close it first.', 'other_tab');
  let expMs = Date.now() + LIMITS.session;
  try { expMs = Math.min(expMs, JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000); } catch (e) { /* default */ }

  let upstream;
  try {
    if (deps.connect) upstream = await deps.connect(envName);
    else { const r = await fetch(HOSTS[envName], { headers: { Upgrade: 'websocket' } }); upstream = r.webSocket; if (!upstream) return err(502, 'cTrader did not answer'); }
  } catch (e) { return err(502, 'cTrader did not answer'); }

  const defer = deps.defer || ((p) => { if (ctx && ctx.waitUntil) ctx.waitUntil(p); else p.catch(() => {}); });
  const g = {
    isAdmin,
    switchOn: () => liveSwitchOn(env, deps),
    consent: () => hasConsent(env, deps, uid),
    blocked: () => memberBlocked(env, deps, uid),
    audit: (entry, id) => openAudit(env, deps, entry, id),
    patchAudit: (id, res) => patchAudit(env, deps, id, res),
    lock: accountLock(env, deps, uid, account),
    defer
  };
  const hooks = tradeHooks({ uid, account, envName, g });
  const pair = deps.pair ? deps.pair() : new WebSocketPair();
  const client = pair[0], server = pair[1];
  server.accept(); if (upstream.accept) upstream.accept();
  open.set(uid, (open.get(uid) || 0) + 1);
  let timer = null;
  const relay = createRelay({ client: server, up: upstream, clientId: env.CTRADER_CLIENT_ID, clientSecret: env.CTRADER_CLIENT_SECRET, hooks });
  hooks.bind(relay);
  const done = () => { clearInterval(timer); if (!done.d) { done.d = true; const n = (open.get(uid) || 1) - 1; if (n <= 0) open.delete(uid); else open.set(uid, n); } };
  server.addEventListener('message', (e) => { relay.onClient(e.data); if (relay.closed) done(); });
  upstream.addEventListener('message', (e) => { relay.onUp(typeof e.data === 'string' ? e.data : ''); if (relay.closed) done(); });
  server.addEventListener('close', () => { relay.onClientClose(); done(); });
  server.addEventListener('error', () => { relay.onClientClose(); done(); });
  upstream.addEventListener('close', () => { relay.onUpClose(); done(); });
  upstream.addEventListener('error', () => { relay.onUpClose(); done(); });
  // every minute: still an admin / beta tester? (a removed admin's socket closes); the token's own expiry ends the socket too
  let lastAdmin = Date.now();
  timer = setInterval(() => {
    relay.tick();
    if (Date.now() > expMs) { try { server.close(1001, 'session'); } catch (e) { /* closed */ } relay.onClientClose(); }
    if (Date.now() - lastAdmin > 60000) { lastAdmin = Date.now(); isAdmin().then((a) => { if (!a) relay.end(1008, 'not allowed'); }, () => relay.end(1008, 'not allowed')); }
    if (relay.closed) done();
  }, deps.tickMs || 5000);
  relay.start();
  const res = { status: 101, webSocket: client, headers: { 'sec-websocket-protocol': 'tz-auth' } };
  return deps.pair ? Object.assign(res, { relay, hooks }) : new Response(null, res);   // tests: Node's Response can't carry a 101
}
export const onRequest = (ctx) => handle(ctx.request, ctx.env, {}, ctx);
