// cTrader OAuth token swap for Cloudflare Pages. DATA ONLY site feature ("connect your own data"), view-only (scope=accounts).
//   GET  /connect/ctrader/token?probe=1  -> {configured, client_id?}  (public: the client id is in every sign-in URL anyway)
//   POST /connect/ctrader/token          {grant:'code', code} | {grant:'refresh', refresh_token}
//        Headers: Origin https://tradezoro.com, Authorization: Bearer <Firebase ID token>.
// It ONLY swaps a code / refreshes a token at https://openapi.ctrader.com/apps/token (cTrader wants a GET with the secret in the
// query), returns the tokens to the browser and stores nothing. Env (Pages secrets): CTRADER_CLIENT_ID, CTRADER_CLIENT_SECRET.
// redirect_uri is fixed here, never taken from the client. Missing env -> 503. Rate limit: KV counter (binding PASSKEYS, same as the passkey functions), in-memory fallback.
// Never logs bodies or tokens: only the step, our status and cTrader's error CODE (e.g. ACCESS_DENIED). Tested by tools/tests/ctrader.test.mjs.
// Every error reply is JSON { error, code } so the callback page can say WHY in plain words. code: not_set_up | origin | auth | rate |
// bad_request | rejected (cTrader refused the code/token; upstream = cTrader's errorCode) | upstream (cTrader did not answer).
// 24 Nov fix: the upstream fetch used redirect:'error', which the Cloudflare Workers runtime THROWS on (Node accepts it), so every
// live swap failed before reaching cTrader ("Trading was not allowed"). It is redirect:'manual' now and a 3xx is refused.
// Upstream failures are 503, never 502/504: Cloudflare's edge swaps a 502/504 body for its own HTML page.
import { verifyIdToken, bearerOf } from '../../api/chart/_rt.js';

const ORIGIN = 'https://tradezoro.com', REDIRECT = ORIGIN + '/connect/ctrader/callback', UPSTREAM = 'https://openapi.ctrader.com/apps/token';
const RATE_MAX = 20, TIMEOUT_MS = 8000;
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
const fail = (status, error, code, extra) => json({ error, code, ...(extra || {}) }, status);
const log = (o) => { try { console.log(JSON.stringify({ fn: 'ctrader-token', ...o })); } catch (e) { /* never break on logging */ } };
const mem = new Map();

async function rateLimited(env, request) {
  const key = 'rl:ctrader:' + (request.headers.get('cf-connecting-ip') || 'unknown') + ':' + Math.floor(Date.now() / 60000);
  try {
    if (env.PASSKEYS) {   // shortcut: KV counter is not atomic; the hard limit is a Cloudflare WAF rule
      const n = Number(await env.PASSKEYS.get(key)) || 0;
      if (n >= RATE_MAX) return true;
      await env.PASSKEYS.put(key, String(n + 1), { expirationTtl: 120 });
      return false;
    }
    for (const k of mem.keys()) if (k !== key) mem.delete(k);
    const n = (mem.get(key) || 0) + 1; mem.set(key, n); return n > RATE_MAX;
  } catch (e) { return true; }
}

const okOrigin = (request, env) => {
  const o = request.headers.get('origin');
  const dev = env.DEV === '1' && new URL(request.url).hostname !== 'tradezoro.com' && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(o || '');
  const sfs = request.headers.get('sec-fetch-site');
  return (o === ORIGIN || dev) && (!sfs || sfs === 'same-origin');
};

export async function handle(request, env, deps = {}) {
  const configured = !!(env.CTRADER_CLIENT_ID && env.CTRADER_CLIENT_SECRET);
  const url = new URL(request.url);
  if (request.method === 'GET') {
    if (url.searchParams.get('probe') !== '1') return fail(404, 'Not found');
    return configured ? json({ configured: true, client_id: env.CTRADER_CLIENT_ID }) : json({ configured: false, code: 'not_set_up' }, 503);
  }
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'GET, POST' } });
  if (!configured) return fail(503, 'cTrader is coming soon', 'not_set_up');
  if (!okOrigin(request, env)) return fail(403, 'Forbidden', 'origin');
  if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) return fail(415, 'JSON only', 'bad_request');
  if (await rateLimited(env, request)) return fail(429, 'Too many tries. Wait a minute.', 'rate');
  const uid = await verifyIdToken(bearerOf(request), { fetchImpl: deps.verifyFetch });
  if (!uid) return fail(401, 'Sign in first', 'auth');
  let b = null;
  try { const t = await request.text(); if (t.length <= 4096) b = JSON.parse(t); } catch (e) { b = null; }
  const tok = (v) => typeof v === 'string' && /^[A-Za-z0-9._~+\/=\-]{8,2048}$/.test(v);
  let q;
  if (b && b.grant === 'code' && tok(b.code)) q = { grant_type: 'authorization_code', code: b.code, redirect_uri: REDIRECT };
  else if (b && b.grant === 'refresh' && tok(b.refresh_token)) q = { grant_type: 'refresh_token', refresh_token: b.refresh_token };
  else return fail(400, 'Bad request', 'bad_request');
  q.client_id = env.CTRADER_CLIENT_ID; q.client_secret = env.CTRADER_CLIENT_SECRET;
  const step = q.grant_type === 'authorization_code' ? 'code' : 'refresh';
  let r;
  try {
    // redirect 'manual', NEVER 'error': the Workers runtime throws on 'error' ("won't be implemented ... at the edge").
    r = await (deps.fetchImpl || fetch)(UPSTREAM + '?' + new URLSearchParams(q), { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } });
  } catch (e) { log({ step, error: (e && e.name) || 'fetch' }); return fail(503, 'cTrader did not answer', 'upstream'); }
  if (r.status >= 300 && r.status < 400) { log({ step, upstreamStatus: r.status }); return fail(503, 'cTrader did not answer', 'upstream'); }
  let j = null; try { j = await r.json(); } catch (e) { /* not json */ }
  const at = j && (j.accessToken || j.access_token), rt = j && (j.refreshToken || j.refresh_token), ex = j && (j.expiresIn || j.expires_in);
  const ec = j && typeof j.errorCode === 'string' && j.errorCode !== 'null' ? (/^[A-Za-z0-9_]{1,40}$/.test(j.errorCode) ? j.errorCode : 'OTHER') : '';
  if (r.status >= 500) { log({ step, upstreamStatus: r.status }); return fail(503, 'cTrader did not answer', 'upstream'); }
  if (!r.ok || typeof at !== 'string' || ec) { log({ step, upstreamStatus: r.status, upstream: ec || 'no_token' }); return fail(400, 'cTrader did not accept this sign-in', 'rejected', { upstream: ec || 'no_token' }); }
  // Only these fields go back.
  return json({ access_token: at, refresh_token: typeof rt === 'string' ? rt : undefined, expires_in: Number(ex) || 2628000, token_type: 'Bearer' });
}
export const onRequest = ({ request, env }) => handle(request, env);
