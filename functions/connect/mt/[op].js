// MetaTrader hosted accounts (Owner order 22 Nov 2026, "connect with login, password and server"). This Pages Function is the ONLY door
// to the MT host on our server (tools/mthost): it checks the member's Firebase ID token, the origin, a rate limit, then forwards to the
// host with a shared secret (env MT_HOST_URL + MT_HOST_SECRET; both are server-side only). The host checks the ID token AGAIN and takes
// the uid from it, never from the body. The password goes through here once (link) and is never stored, logged or returned.
// Routes (POST unless noted): /connect/mt/servers?q= (GET) · accounts (GET) · link · unlink · op
//   op bodies: {accountId, op: account|positions|orders|history|symbols|symbol|tick} reads (any signed-in member, own accounts only)
//              {accountId, op: place|modify|cancel|close, idemKey, args} orders: same gates as the other brokers (live switch, member
//              block, "Enable live trading" acceptance, audit row BEFORE the order); investor (read-only) accounts are refused by the host.
import { verifyIdToken, bearerOf } from '../../api/chart/_rt.js';
import { okOrigin, rateLimited, json } from '../_token.js';
import { openAudit, liveSwitchOn } from '../finatic/_audit.js';
import { hasConsent, memberBlocked } from '../finatic/_owner.js';
import { IDEM } from '../../../assets/chart-live-core.js';
import { accessFor, authClaims } from '../../api/beta/_lib.js';

const fail = (status, error, code) => json({ error, code }, status === 502 || status === 504 ? 503 : status);
const RESTARTING = 'MetaTrader connection is restarting. Try again in a minute.';

// ---- where the host is (Owner 24 Nov: temporary Cloudflare quick tunnel, its https://*.trycloudflare.com address changes when the
// tunnel restarts). Order: env MT_HOST_URL (the named tunnel, later) else the address the server's watcher last posted to KV
// (PASSKEYS key mt:hosturl; written ONLY through POST /connect/mt/hosturl below, HMAC-signed with MT_PUBLISH_KEY, a key separate
// from the host bearer MT_HOST_SECRET). Members never read it: KV is server-side, and no route returns it. Cached 60 s per isolate;
// a failed host call drops the cache so a new address is picked up at once. An address not re-confirmed for 15 min is not used
// (the watcher re-posts every 5 min), and the KV entry expires after 30 min: a released trycloudflare name is never trusted.
const MAX_AGE = 900000, KV_TTL = 1800;
export const HOST_KV = 'mt:hosturl';
const QUICK = /^https:\/\/[a-z0-9-]{3,80}\.trycloudflare\.com$/;
let hostMemo = null;
export const _resetHost = () => { hostMemo = null; statusMemo = null; };
async function hostUrl(env, deps) {
  if (env.MT_HOST_URL) return String(env.MT_HOST_URL).replace(/\/$/, '');
  if (hostMemo && Date.now() - hostMemo.at < 60000) return hostMemo.url;
  let url = '';
  try { const raw = env.PASSKEYS ? await env.PASSKEYS.get(HOST_KV) : (deps.hostKv ? await deps.hostKv.get(HOST_KV) : null); const o = raw ? JSON.parse(raw) : null; if (o && QUICK.test(o.url || '') && Date.now() - Number(o.at) < MAX_AGE) url = o.url; } catch (e) { url = ''; }
  hostMemo = { url, at: Date.now() };
  return url;
}
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array((String(s).match(/../g) || []).map((x) => parseInt(x, 16)));
// signed by the watcher on our server: x-mt-sig = hex(HMAC-SHA256(MT_PUBLISH_KEY, "<ts>.<body>")), x-mt-ts = unix seconds (+-120 s,
// and newer than the last accepted post: no replay, no rollback to an older address). crypto.subtle.verify is constant time.
// The key itself never travels.
export async function signHost(secret, ts, body) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(ts + '.' + body)));
}
async function sigOk(secret, ts, body, sig) {
  if (!secret || String(secret).length < 32 || !/^\d{9,11}$/.test(ts || '') || !/^[a-f0-9]{64}$/.test(sig || '')) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 120) return false;
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', k, unhex(sig), new TextEncoder().encode(ts + '.' + body));
}
// POST /connect/mt/hosturl {url, at, status} (server watcher only) -> stores the address + a small status blob.
// GET  /connect/mt/status (public, for the CoS to curl) -> tunnel/host health summary: never the address, no account data.
let statusMemo = null;
async function hostStatus(env, deps) {
  if (statusMemo && Date.now() - statusMemo.at < 30000) return json(statusMemo.body);
  const store = env.PASSKEYS || deps.hostKv;
  let o = null; try { const raw = store ? await store.get(HOST_KV) : null; o = raw ? JSON.parse(raw) : null; } catch (e) {}
  const now = Date.now(), s = (o && o.status) || {};
  const body = { ok: !!(env.MT_HOST_URL || (o && s.tunnel && s.hostOk && now - o.at < MAX_AGE)), mode: env.MT_HOST_URL ? 'named' : 'quick', configured: !!env.MT_HOST_SECRET, reportAgeS: o ? Math.round((now - o.at) / 1000) : null, urlAgeS: s.urlSince ? Math.round(now / 1000 - s.urlSince) : null, tunnel: !!s.tunnel, hostOk: !!s.hostOk, terminalsLive: s.live || 0, terminalsMax: s.max || 0, tunnelRestarts: s.restarts || 0 };
  statusMemo = { body, at: now }; return json(body);
}
async function hostAdmin(request, env, deps, route) {
  if (route === 'status') return hostStatus(env, deps);
  const ts = request.headers.get('x-mt-ts') || '', sig = request.headers.get('x-mt-sig') || '';
  if (!(Number(request.headers.get('content-length')) <= 4096)) return fail(413, 'Too big', 'bad_request');
  const body = await request.text();
  if (body.length > 4096 || !(await sigOk(env.MT_PUBLISH_KEY, ts, body, sig))) return fail(403, 'Forbidden', 'forbidden');
  const store = env.PASSKEYS || deps.hostKv; if (!store) return fail(503, 'No store', 'no_store');
  {
    let prev = null; try { const raw = await store.get(HOST_KV); prev = raw ? JSON.parse(raw) : null; } catch (e) {}
    if (prev && Number(ts) <= Number(prev.ts || 0)) return fail(409, 'Stale', 'stale');
    let b = null; try { b = JSON.parse(body); } catch (e) {}
    if (!b || !QUICK.test(String(b.url || ''))) return fail(400, 'Bad url', 'bad_request');
    const st = b.status && typeof b.status === 'object' ? b.status : {};
    const keep = { url: b.url, at: Date.now(), ts: Number(ts), status: { tunnel: !!st.tunnel, urlSince: Number(st.urlSince) || 0, live: Number(st.live) || 0, max: Number(st.max) || 0, restarts: Number(st.restarts) || 0, hostOk: !!st.hostOk } };
    await store.put(HOST_KV, JSON.stringify(keep), { expirationTtl: KV_TTL });
    hostMemo = null; statusMemo = null;
    return json({ ok: true });
  }
}
const ORDER_OPS = ['place', 'modify', 'cancel', 'close'], READ_OPS = ['account', 'live', 'positions', 'orders', 'history', 'symbols', 'symbol', 'tick'];
const num = (v) => (v === undefined || v === null || v === '' ? undefined : Number(v));

// -> {args} | {error}: only whitelisted fields go to the host
export function cleanArgs(op, a = {}) {
  const o = {};
  const sym = (v) => typeof v === 'string' && /^[A-Za-z0-9._#\-+]{1,32}$/.test(v);
  const px = (v) => { const n = num(v); return n === undefined ? undefined : n > 0 && n < 1e9 ? n : NaN; };
  if (op === 'place') {
    if (!sym(a.symbol)) return { error: 'symbol invalid' }; o.symbol = a.symbol;
    if (a.side !== 'buy' && a.side !== 'sell') return { error: 'side must be buy or sell' }; o.side = a.side;
    o.type = a.type === undefined ? 'market' : a.type; if (!['market', 'limit', 'stop'].includes(o.type)) return { error: 'type must be market, limit or stop' };
    const v = num(a.volume); if (!(v > 0 && v <= 1000) || Math.abs(Math.round(v * 100) - v * 100) > 1e-6) return { error: 'volume must be lots in steps of 0.01' }; o.volume = Number(v.toFixed(2));
    if (o.type !== 'market') { const p = px(a.price); if (!(p > 0)) return { error: 'price invalid' }; o.price = p; }
    for (const k of ['sl', 'tp']) { const p = px(a[k]); if (p !== undefined) { if (!(p > 0)) return { error: k + ' invalid' }; o[k] = p; } }
  } else if (op === 'modify') {
    if (!/^\d{1,15}$/.test(String(a.ticket))) return { error: 'ticket invalid' }; o.ticket = String(a.ticket);
    for (const k of ['price', 'sl', 'tp']) { const p = k === 'price' ? px(a[k]) : num(a[k]); if (p !== undefined && !(p >= 0 && p < 1e9)) return { error: k + ' invalid' }; if (p !== undefined) o[k] = p; }
    if (Object.keys(o).length < 2) return { error: 'nothing to change' };
  } else if (op === 'cancel' || op === 'close') {
    if (!/^\d{1,15}$/.test(String(a.ticket))) return { error: 'ticket invalid' }; o.ticket = String(a.ticket);
    if (op === 'close' && a.volume !== undefined) { const v = num(a.volume); if (!(v > 0 && v <= 1000)) return { error: 'volume invalid' }; o.volume = v; }
  } else if (op === 'symbols') { o.q = String(a.q || '').slice(0, 32); o.limit = Math.min(Math.max(Number(a.limit) || 50, 1), 5000); if (a.names) o.names = true; }
  else if (op === 'symbol' || op === 'tick') { if (!sym(a.symbol)) return { error: 'symbol invalid' }; o.symbol = a.symbol; }
  else if (op === 'history') { for (const k of ['from', 'to', 'limit']) if (a[k] !== undefined) { const n = Number(a[k]); if (!(n >= 0 && n < 4e9)) return { error: k + ' invalid' }; o[k] = n; } }
  return { args: o };
}

const memo = new Map();   // uid -> { v, at }: a "yes" 60 s, a "no" 5 s
export const _resetGate = () => memo.clear();
// -> true | false | null (could not read)
async function mayUse(request, env, deps, uid) {
  if (deps.isAllowed) { try { return !!(await deps.isAllowed(uid)); } catch (e) { return null; } }   // tests
  const hit = memo.get(uid); if (hit && Date.now() - hit.at < (hit.v ? 60000 : 5000)) return hit.v;
  try {
    const c = await authClaims(request, { verifyFetch: deps.verifyFetch });
    if (!c || c.uid !== uid) return false;
    const b = await accessFor(env, c, { fetchImpl: deps.betaFetch });
    const v = !!(b.admin || b.beta); memo.set(uid, { v, at: Date.now() }); return v;
  } catch (e) { return null; }
}

async function toHost(env, deps, method, path, token, body) {
  const f = deps.hostFetch || fetch;
  const base = await hostUrl(env, deps);
  if (!base) return { status: -1 };   // no address yet: nothing was sent
  let r;
  try { r = await f(base + path, { method, headers: { 'x-mt-secret': env.MT_HOST_SECRET, authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(deps.hostTimeout || 100000) }); }
  catch (e) { hostMemo = null; return { status: 0 }; }
  let j = null; try { j = await r.json(); } catch (e) {}
  // a quick tunnel that went away answers 530/502/1033 HTML (not our JSON): treat as "restarting", re-read the address next call.
  // Nothing reached the host in that case (Cloudflare refused at the edge).
  // A 502 means cloudflared reached for the host and failed, possibly mid-request: callers treat an ORDER as unknown, never as not sent.
  if (!j && (r.status >= 500 || r.status === 404)) { hostMemo = null; return { status: r.status === 502 ? 0 : -1 }; }
  return { status: r.status, j };
}

export async function handle(request, env, deps = {}) {
  const url = new URL(request.url), route = url.pathname.replace(/^\/connect\/mt\//, '').replace(/\/$/, '');
  const GET = request.method === 'GET', POST = request.method === 'POST';
  if (GET && route === 'probe') return json({ configured: !!env.MT_HOST_SECRET });
  if ((POST && route === 'hosturl') || (GET && route === 'status')) return hostAdmin(request, env, deps, route);   // before the member checks: own auth
  if (!env.MT_HOST_SECRET) return fail(503, 'MetaTrader sign-in is coming soon', 'not_set_up');
  if (!['servers', 'accounts', 'link', 'unlink', 'op'].includes(route)) return fail(404, 'Not found', 'not_found');
  if (!GET && !POST) return fail(405, 'Method not allowed', 'method');
  if ((route === 'servers' || route === 'accounts') !== GET) return fail(405, 'Method not allowed', 'method');
  if (!okOrigin(request, env)) return fail(403, 'Forbidden', 'forbidden');
  if (POST && !/^application\/json\b/i.test(request.headers.get('content-type') || '')) return fail(415, 'JSON only', 'json_only');
  if (await rateLimited(env, request, 'mt-' + route, deps.defer)) return fail(429, 'Too many tries. Wait a minute.', 'rate_limited');
  const token = bearerOf(request);
  const uid = await verifyIdToken(token, { fetchImpl: deps.verifyFetch });
  if (!uid) return fail(401, 'Sign in first', 'signed_out');
  // GATE (Owner 23-24 Nov): hosted MetaTrader is open to admins + beta testers only, the same strict check as the broker pause
  // (functions/connect/finatic/_pause.js: admins/{uid} or verified email on settings/betaTesters). Members keep the EA path.
  // Fails closed: a list that cannot be read = 503, nothing forwarded.
  const gate = await mayUse(request, env, deps, uid);
  if (gate === null) return fail(503, 'Couldn’t confirm your access just now. Nothing was sent. Try again.', 'gate_unreadable');
  if (!gate) return fail(403, 'MetaTrader sign-in is coming soon.', 'not_open');
  if (GET) { const r = await toHost(env, deps, 'GET', '/v1/' + route + (route === 'servers' ? '?q=' + encodeURIComponent((url.searchParams.get('q') || '').slice(0, 40)) : ''), token); return r.j ? json(r.j, r.status) : fail(503, RESTARTING, 'restarting'); }
  let b = null; try { const t = await request.text(); if (t.length <= 4096) b = JSON.parse(t); } catch (e) { b = null; }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return fail(400, 'Bad request', 'bad_request');
  let out;
  if (route === 'link') {
    // whitelist: nothing else is forwarded; the password is not touched here
    out = { login: b.login, server: b.server, password: b.password, mode: b.mode === 'investor' ? 'investor' : 'trading', platform: b.platform === 'mt4' ? 'mt4' : 'mt5' };
  } else if (route === 'unlink') out = { accountId: b.accountId };
  else {
    const op = b.op;
    if (!READ_OPS.includes(op) && !ORDER_OPS.includes(op)) return fail(400, 'Not allowed', 'bad_request');
    if (typeof b.accountId !== 'string' || !/^[a-f0-9]{16}$/.test(b.accountId)) return fail(400, 'accountId missing', 'bad_request');
    const c = cleanArgs(op, b.args || {}); if (c.error) return fail(400, c.error, 'bad_request');
    out = { accountId: b.accountId, op, args: c.args };
    if (ORDER_OPS.includes(op)) {
      if (!(typeof b.idemKey === 'string' && IDEM.test(b.idemKey))) return fail(400, 'idemKey missing', 'bad_request');
      const [sw, mc, mb] = await Promise.all([
        liveSwitchOn(env, deps).then((v) => ({ v }), () => ({ err: true })),
        hasConsent(env, deps, uid).then((v) => ({ v }), () => ({ err: true })),
        memberBlocked(env, deps, uid).then((v) => ({ v }), () => ({ err: true })),
      ]);
      if (sw.err) return fail(503, 'Live trading switch could not be read, order not sent', 'switch_unreadable');
      if (!sw.v) return fail(403, 'Live trading is switched off', 'switched_off');
      if (mb.err) return fail(503, 'Your live trading status could not be read, order not sent', 'switch_unreadable');
      if (mb.v) return fail(403, 'Live trading is switched off for your account. Contact support.', 'member_blocked');
      if (mc.err) return fail(503, 'Your live trading acceptance could not be read, order not sent', 'consent_unreadable');
      if (!mc.v) return fail(403, 'Enable live trading first: read and accept the notice in the Trade menu.', 'consent_needed');
      // audit row first: no audit, no order. The idempotency key is the row id, so a repeat never reaches the broker twice.
      const entry = { uid, env: 'mt-host', op, src: 'chart', account: b.accountId, symbol: String(c.args.symbol || '').slice(0, 20), side: String(c.args.side || '').slice(0, 4), qty: c.args.volume === undefined ? null : c.args.volume, type: String(c.args.type || '').slice(0, 10) };
      let audit;
      try { audit = await openAudit(env, deps, entry, b.idemKey); }
      catch (e) { return e && e.duplicate ? fail(409, 'That order was already sent.', 'duplicate') : fail(503, 'Could not write the order log, order not sent', 'audit_unwritable'); }
      out.args.idem = b.idemKey;
      const r = await toHost(env, deps, 'POST', '/v1/op', token, out);
      const ok = r.status === 200 && r.j && r.j.ok;
      const res = { result: ok ? 'ok' : r.status === 0 ? 'unknown' : 'rejected', message: String((r.j && (r.j.comment || r.j.error)) || '').slice(0, 160), orderId: String((r.j && r.j.order) || '') };
      (deps.defer || ((p) => p.catch(() => {})))(Promise.resolve(audit.finish(res)).catch(() => {}));
      if (r.status === 0) return fail(503, 'No clear answer. The order may or may not have gone through. Checking positions.', 'unknown');
      return r.j ? json(r.j, r.status) : fail(503, RESTARTING + ' The order was not sent.', 'restarting');
    }
  }
  const r = await toHost(env, deps, 'POST', '/v1/' + route, token, out);
  return r.j ? json(r.j, r.status) : fail(503, RESTARTING, 'restarting');
}
export const onRequest = async ({ request, env, waitUntil }) => {
  try { return await handle(request, env, { defer: (p) => { try { waitUntil(Promise.resolve(p).catch(() => {})); } catch (e) {} } }); }
  catch (e) { try { console.error('mt: exception ' + ((e && e.name) || 'Error')); } catch (e2) {} return fail(500, 'Server error. Try again.', 'server_error'); }
};
