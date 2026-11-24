// GET /connect/ctrader/trade?account=<ctidTraderAccountId>&env=demo|live — the cTrader TRADING relay for ADMINS AND BETA TESTERS only (WebSocket).
// Same door as the data relay (ws.js: origin https://tradezoro.com, the Firebase ID token as the "tz-auth" subprotocol, never in the
// URL, KV rate limit) plus: the caller must be an admin (admins/{uid}) or a beta tester (settings/betaTesters, verified email), the ONE cTrader account is pinned in the URL (the relay only
// authorises that account, and only with a trading-scope token), one trade socket per admin, and the LIVE cTrader server is used only
// when the Pages env CTRADER_TRADE_LIVE is "1" (unset = demo accounts only; switching it on is the Owner's call).
// Every write goes through _trade.js (schema + rebuild, size / symbol / id checks, admin, settings/liveTrading, liveConsent, liveBlocked,
// the account lock and the audit row before anything is sent). Secrets: CTRADER_CLIENT_ID / CTRADER_CLIENT_SECRET (added here, never
// sent to the browser), FIREBASE_SA_KEY (audit, lock, switches). Logs nothing but fixed words.
import { verifyIdToken, wsTokenOf } from '../../api/chart/_rt.js';
import { accessFor } from '../../api/beta/_lib.js';
import { normEmail } from '../../../assets/beta-config.mjs';
import { createRelay, LIMITS } from './_relay.js';
import { tradeHooks, TLIMITS, gateCache, WRITE_COST } from './_trade.js';
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
// same decision as /api/beta/status (functions/api/beta/_lib.js betaFor). Uses the signature-checked token's own claims (email +
// email_verified only: the token's expiry plays no part here, the service account reads Firestore). STRICT (accessFor): true / false only
// from real Firestore answers; a failed read THROWS, so the caller says "couldn't confirm" and never "not an admin" (owner bug 24 Nov).
const claimsOf = (tok) => { try { return JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { return {}; } };
export async function mayTrade(env, tok, uid, deps = {}) {
  const p = claimsOf(tok);
  const b = await accessFor(env, { uid, email: normEmail(p.email), verified: p.email_verified === true }, { fetchImpl: deps.betaFetch });
  return !!(b.admin || b.beta);
}

// Subrequest budget per socket (owner bug 24 Nov). A WebSocket is ONE Cloudflare request for its whole life, and every fetch it makes
// (Firestore, Google token, cTrader connect, KV) counts against that request's subrequest cap (Workers Free 50, Paid 10,000 by
// default). Past the cap every fetch throws. We count our own fetches and renew the socket (close 4001) well before the cap; the
// browser reopens it = a fresh request with a fresh budget. CTRADER_SUBREQ_BUDGET (Pages env) raises it on a paid plan; default 40.
export const SUBREQ_BUDGET = 40, CONNECT_COST = 4;   // connect: rate-limit KV get + put, the cTrader upstream, the Google certs
export function counter(base, max) {
  let used = CONNECT_COST, cap = false;
  const f = (url, init) => { used++; return Promise.resolve().then(() => base(url, init)).catch((e) => { if (/too many subrequests/i.test(String(e && e.message))) cap = true; throw e; }); };
  return { f, left: () => max - used, capHit: () => cap || used >= max, used: () => used };
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
  // every Firestore / Google read of this socket goes through one counting fetch (betaFetch + auditFetch = the same counter)
  const budget = counter(deps.auditFetch || deps.betaFetch || ((u, i) => fetch(u, i)), Math.min(9000, Math.max(WRITE_COST + 8, Number(env.CTRADER_SUBREQ_BUDGET) || SUBREQ_BUDGET)));
  deps = { ...deps, betaFetch: budget.f, auditFetch: budget.f };
  // isAdmin = "admin or beta tester" (name kept: _trade.js re-asks it before every write, through the per-socket cache)
  const isAdmin = () => (deps.isAdmin ? deps.isAdmin() : mayTrade(env, tok, uid, deps));
  let first; try { first = await isAdmin(); } catch (e) { return err(503, 'Couldn’t confirm your trading access just now. Nothing was sent. Try again.', 'gate_unreadable'); }
  if (!first) return err(403, 'Live cTrader trading is for admins and beta testers only right now.', 'not_admin');
  if ((open.get(uid) || 0) >= TLIMITS.perUid) return err(429, 'cTrader trading is already open in another tab. Use that tab, or close it first.', 'other_tab');
  let expMs = Date.now() + LIMITS.session;
  try { expMs = Math.min(expMs, JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000); } catch (e) { /* default */ }

  let upstream;
  try {
    if (deps.connect) upstream = await deps.connect(envName);
    else { const r = await fetch(HOSTS[envName], { headers: { Upgrade: 'websocket' } }); upstream = r.webSocket; if (!upstream) return err(502, 'cTrader did not answer'); }
  } catch (e) { return err(502, 'cTrader did not answer'); }

  const defer = deps.defer || ((p) => { if (ctx && ctx.waitUntil) ctx.waitUntil(p); else p.catch(() => {}); });
  // gate answers cached per socket (admin/beta 5 min, switch / consent / block 30 s; a "no" or an error is never kept)
  // the switch reader flags liveSwitchOn's last-good fallback (Firestore failed twice) so that value is used once, never kept
  const switchRead = () => { let stale = false; return liveSwitchOn(env, { ...deps, onStale: () => { stale = true; } }).then((v) => (stale ? { v, keep: false } : v)); };
  const cache = gateCache({ isAdmin, switchOn: switchRead, consent: () => hasConsent(env, deps, uid), blocked: () => memberBlocked(env, deps, uid) });
  cache.seed('isAdmin', true);
  const g = {
    isAdmin: () => cache.get('isAdmin'),
    switchOn: () => cache.get('switchOn'),
    consent: () => cache.get('consent'),
    blocked: () => cache.get('blocked'),
    warm: () => { defer(cache.warm()); },
    budget,
    ended: () => done(),   // a relay-side close (renew, not allowed) frees this uid's socket slot at once, so the reopen isn't 'other_tab'
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
  function done() { clearInterval(timer); if (!done.d) { done.d = true; const n = (open.get(uid) || 1) - 1; if (n <= 0) open.delete(uid); else open.set(uid, n); } }
  server.addEventListener('message', (e) => { relay.onClient(e.data); if (relay.closed) done(); });
  upstream.addEventListener('message', (e) => { relay.onUp(typeof e.data === 'string' ? e.data : ''); if (relay.closed) done(); });
  server.addEventListener('close', () => { relay.onClientClose(); done(); });
  server.addEventListener('error', () => { relay.onClientClose(); done(); });
  upstream.addEventListener('close', () => { relay.onUpClose(); done(); });
  upstream.addEventListener('error', () => { relay.onUpClose(); done(); });
  // every minute: still an admin / beta tester? A REAL read while the budget has room (a removed admin's socket closes within a
  // minute, as before), else the cached yes (at most 5 min old).
  // A failed read does NOT close the socket (the next write re-checks and fails closed with gate_unreadable). The token's own
  // expiry ends the socket too.
  let lastAdmin = Date.now();
  timer = setInterval(() => {
    relay.tick();
    if (Date.now() > expMs) { try { server.close(1001, 'session'); } catch (e) { /* closed */ } relay.onClientClose(); }
    if (Date.now() - lastAdmin > 60000) { lastAdmin = Date.now(); (budget.left() >= 2 * WRITE_COST ? cache.refresh('isAdmin') : cache.get('isAdmin')).then((a) => { if (!a) relay.end(1008, 'not allowed'); }, () => {}); }
    if (relay.closed) done();
  }, deps.tickMs || 5000);
  relay.start();
  const res = { status: 101, webSocket: client, headers: { 'sec-websocket-protocol': 'tz-auth' } };
  return deps.pair ? Object.assign(res, { relay, hooks, budget, cache }) : new Response(null, res);   // tests: Node's Response can't carry a 101
}
export const onRequest = (ctx) => handle(ctx.request, ctx.env, {}, ctx);
