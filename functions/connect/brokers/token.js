// POST /connect/brokers/token — OAuth code swap + refresh for the TRADING sign-ins of tastytrade and TradeStation (BROKERS 3).
// Separate from the view-only data sign-ins (functions/connect/tastytrade/token.js, scope "read"): a trading grant (scope read + trade)
// is only ever asked for by the "Allow trading with …" button (admins + beta testers) and is kept in its own vault entry.
//   GET  ?broker=tastytrade|tradestation&env=sandbox -> { configured, client_id?, authorize, redirect, scope, audience? } (public)
//   POST { broker, env, grant:'code', code } | { broker, env, grant:'refresh', refresh_token }, Origin https://tradezoro.com,
//        Authorization: Bearer <Firebase ID token>. Admin or beta tester only. Stores nothing, logs nothing, returns a trimmed reply.
// Secrets (Pages env, never in the browser or the repo): tastytrade sandbox app TASTY_SANDBOX_CLIENT_ID / TASTY_SANDBOX_CLIENT_SECRET,
// tastytrade production app TASTY_CLIENT_ID / TASTY_CLIENT_SECRET (live, only with TASTY_TRADE_LIVE=1), TradeStation TS_CLIENT_ID /
// TS_CLIENT_SECRET (one key for SIM and live). Unset = {"configured":false} and the button says "Coming soon".
import { verifyIdToken, bearerOf } from '../../api/chart/_rt.js';
import { okOrigin, rateLimited, json, fail } from '../_token.js';
import { mayTrade } from '../ctrader/trade.js';
import { BROKERS, guardFetch, apiBase, envOf, liveOn, UA } from './_hosts.js';

const OAUTH = ['tastytrade', 'tradestation'];
const credsOf = (env, broker, envName) => { const [i, s] = BROKERS[broker].creds[envName]; return env[i] && env[s] ? { id: env[i], secret: env[s] } : null; };
const tokenUrl = (broker, envName) => (broker === 'tradestation' ? BROKERS.tradestation.token : apiBase(broker, envName) + '/oauth/token');

export async function handle(request, env, deps = {}) {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    const broker = url.searchParams.get('broker'); if (!OAUTH.includes(broker)) return fail(404, 'Not found');
    const envName = envOf(url.searchParams.get('env'));
    if (envName === 'live' && !liveOn(env, broker)) return json({ configured: false, live: false }, 503);
    const c = credsOf(env, broker, envName), B = BROKERS[broker];
    return c ? json({ configured: true, client_id: c.id, authorize: B.authorize[envName], redirect: B.redirect, scope: B.scope, audience: B.audience }) : json({ configured: false }, 503);
  }
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'GET, POST' } });
  if (!okOrigin(request, env)) return fail(403, 'Forbidden');
  if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) return fail(415, 'JSON only');
  let b = null; try { const t = await request.text(); if (t.length <= 4096) b = JSON.parse(t); } catch (e) { b = null; }
  if (!b || !OAUTH.includes(b.broker)) return fail(400, 'Bad request');
  const broker = b.broker, label = BROKERS[broker].label, envName = envOf(b.env);
  if (envName === 'live' && !liveOn(env, broker)) return json({ error: 'Live ' + label + ' trading is not switched on yet.', code: 'live_off' }, 403);
  const c = credsOf(env, broker, envName); if (!c) return json({ error: label + ' is coming soon', configured: false }, 503);
  if (await rateLimited(env, request, 'b3tok')) return fail(429, 'Too many tries. Wait a minute.');
  const idt = bearerOf(request);
  const uid = deps.verify ? await deps.verify(idt) : await verifyIdToken(idt, { fetchImpl: deps.verifyFetch });
  if (!uid) return fail(401, 'Sign in first');
  let ok = false; try { ok = deps.allowed ? await deps.allowed(uid) : await mayTrade(env, idt, uid, deps); } catch (e) { ok = false; }
  if (!ok) return fail(403, 'Direct broker trading is for admins and beta testers only right now.');
  const tok = (v) => typeof v === 'string' && /^[A-Za-z0-9._~+\/=\-]{8,4096}$/.test(v);
  let q;
  if (b.grant === 'code' && tok(b.code)) q = { grant_type: 'authorization_code', code: b.code, redirect_uri: BROKERS[broker].redirect };
  else if (b.grant === 'refresh' && tok(b.refresh_token)) q = { grant_type: 'refresh_token', refresh_token: b.refresh_token };
  else return fail(400, 'Bad request');
  q.client_id = c.id; q.client_secret = c.secret;
  const form = broker === 'tradestation';
  let r;
  try {
    r = await guardFetch(env, broker, tokenUrl(broker, envName), { method: 'POST', signal: AbortSignal.timeout(8000),
      headers: { Accept: 'application/json', 'User-Agent': UA, 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: form ? new URLSearchParams(q).toString() : JSON.stringify(q) }, deps.fetchImpl);
  } catch (e) { return fail(e && e.code === 'live_off' ? 403 : 502, e && e.code === 'live_off' ? e.message : label + ' did not answer'); }
  let j = null; try { j = await r.json(); } catch (e) { /* not json */ }
  if (!r.ok || !j || typeof j.access_token !== 'string') return json({ error: r.status >= 500 ? label + ' did not answer' : label + ' did not accept this sign-in', code: r.status >= 500 ? 'upstream' : 'rejected' }, r.status >= 500 ? 502 : 400);
  const scope = typeof j.scope === 'string' ? j.scope.slice(0, 200) : undefined;
  return json({ access_token: j.access_token, refresh_token: typeof j.refresh_token === 'string' ? j.refresh_token : undefined, expires_in: Number(j.expires_in) || undefined, token_type: 'Bearer', scope, env: envName });
}
export const onRequest = ({ request, env }) => handle(request, env);
