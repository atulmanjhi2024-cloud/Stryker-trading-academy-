// Regression (bug 22 Nov, member Yuvan: "Admin only" on MetaTrader 5): the hand-deployed edge Worker can be OLDER than the Pages
// build and still answer 403 "Admin only" (old gate) or 404 not_found (route missing). Pages must then run its own, current handler.
// A normal member (non-admin) with a stubbed token must reach the member path. NO network, NO real order (broker is a stub).
// Run: node tests/finatic/stale-edge.test.mjs
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import * as F from '../../functions/connect/finatic/_fin.js';
import * as S from '../../functions/connect/finatic/session.js';
import * as O from '../../functions/connect/finatic/order.js';
import * as D from '../../functions/connect/finatic/data.js';
import { memStore } from './_store.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (uid) => { const now = Math.floor(Date.now() / 1000); const h = b64({ alg: 'RS256', kid: 'k1' }), p = b64({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: uid, user_id: uid, iat: now - 5, exp: now + 3600 }); const sg = createSign('RSA-SHA256').update(h + '.' + p).sign(privateKey, 'base64url'); return h + '.' + p + '.' + sg; };
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const verifyFetch = async (url) => String(url).includes('jwk/securetoken') ? new Response(JSON.stringify({ keys: [jwk] })) : new Response('{}', { status: 404 });   // nobody is an admin
const calls = [];
const ok = (data) => new Response(JSON.stringify({ data, errors: [] }), { status: 200 });
const finFetch = async (url, init) => { const u = new URL(url); calls.push(init.method + ' ' + u.pathname);
  if (u.pathname === '/api/v1/session/init') return ok({ one_time_token: 'ott' });
  if (u.pathname === '/api/v1/session/start') return ok({ session_id: 's1', company_id: 'c', status: 'pending', user_id: '' });
  if (u.pathname === '/api/v1/session/portal') return ok({ portal_url: 'https://portal.finatic.dev/?t=x' });
  return ok([]); };
const deps = { store: memStore(), verifyFetch, finFetch, audit: async () => ({ finish: async () => {} }), liveSwitch: async () => true, sleep: async () => {} };
const env = { FINATIC_API_KEY: 'fntc_live_FAKE', FINATIC_LIVE_ORDERS: '1', DEV: '0' };
let ip = 1;
const mk = (path, body) => new Request('https://tradezoro.com/connect/finatic/' + path, { method: 'POST', headers: { 'cf-connecting-ip': '10.9.0.' + (ip++), origin: 'https://tradezoro.com', 'content-type': 'application/json', authorization: 'Bearer ' + token('memberMT') }, body: JSON.stringify(body) });
const staleAdmin = { fetch: async () => F.json({ error: 'Admin only', code: 'forbidden' }, 403) };   // what the 19 Nov Worker said
const staleNoRoute = { fetch: async () => F.json({ error: 'Not found', code: 'not_found' }, 404) };
const fresh = { fetch: async (rq) => (new URL(rq.url).pathname.endsWith('/ver') ? F.json({ ver: 'v-test' }) : F.json({ error: 'Not connected yet', code: 'needs_connect' }, 409)) };
F._setVer('v-test');   // a deployed build
const entry = (h, opts) => F.pagesEntry((rq, e, d) => h(rq, e, { ...deps, ...d }), opts);   // pagesEntry hands the handler only {defer}: add the stubs

// the member taps MetaTrader 5: session start, edge Worker is stale -> runs here and succeeds
let r = await entry(S.handle)({ request: mk('session', { mode: 'dark', broker: 'metatrader-5' }), env: { ...env, FINATIC_EDGE: staleAdmin } });
assert.equal(r.status, 200, 'non-admin member can start the MT5 connect'); assert.match((await r.json()).portalUrl, /^https:/);
// same for MT4 and every other tile (the body only names the broker; the handler is the same)
for (const b of ['metatrader-4', 'interactive-brokers', 'ninjatrader', 'rithmic', 'tastytrade', 'tradovate', 'webull']) {
  r = await entry(S.handle)({ request: mk('session', { mode: 'dark', broker: b }), env: { ...env, FINATIC_EDGE: staleAdmin } }); assert.equal(r.status, 200, b + ' tile works for a member'); }
// linked accounts list (data) on a stale Worker with no such route
r = await entry(D.handle)({ request: mk('data', { op: 'accounts' }), env: { ...env, FINATIC_EDGE: staleNoRoute } });
assert.notEqual(r.status, 404, 'data route runs here when the Worker lacks it'); assert.equal(r.status, 409, 'needs connect, not an admin error'); 
// an order call from the chart with a stale Worker: refused before any write on the Worker, so it runs once here (env op: no write)
r = await entry(O.handle, { retryHere: false })({ request: mk('order', { src: 'chart', op: 'env' }), env: { ...env, FINATIC_EDGE: staleAdmin } });
assert.equal(r.status, 200); assert.equal((await r.json()).env, 'live');
// journal raw order (no src chart) still admin only for a member, also through the stale path
const before = calls.filter((c) => c.startsWith('POST') && c.endsWith('/orders')).length;
r = await entry(O.handle, { retryHere: false })({ request: mk('order', { op: 'place', accountId: '11111111-e89b-12d3-a456-426614174000', symbol: 'MNQZ6', side: 'buy', qty: 1, type: 'market' }), env: { ...env, FINATIC_EDGE: staleAdmin } });
assert.equal(r.status, 403); assert.equal(calls.filter((c) => c.startsWith('POST') && c.endsWith('/orders')).length, before, 'no order reached the broker');
// a fresh Worker's own answers pass through untouched (no double run)
F._resetEdge();   // the memo above remembered the stale Workers
let ran = 0; r = await entry(async () => { ran++; return F.json({ ok: 1 }); })({ request: mk('data', {}), env: { ...env, FINATIC_EDGE: fresh } });
assert.equal(r.status, 409); assert.equal(ran, 0, 'fresh Worker answer is final');
console.log('stale-edge: ok');
