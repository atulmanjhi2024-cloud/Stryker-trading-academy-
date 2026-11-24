// Bug 23 Nov (w-ordunknown): the Owner's chart orders answered "No clear answer from the broker. The order may or may not have gone
// through." Causes found: the edge Worker was running the 19 Nov order code (no settle read, old message), and the broker link answered
// HTTP 504 in ~0.35 s while its order list for the account came back empty, so even the current settle could not find a filled order.
// Every broker call here is a STUB: nothing reaches a real broker. Sample data only. Run: node tests/finatic/ordunknown.test.mjs
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { memStore } from './_store.mjs';
import * as L from '../../assets/chart-live-core.js';
import * as O from '../../functions/connect/finatic/order.js';
import * as F from '../../functions/connect/finatic/_fin.js';
import { route } from '../../workers/finatic-edge/src/index.js';
import { VER } from '../../functions/connect/finatic/_ver.js';

// ---- 1. Pages forwards to the edge Worker ONLY when it runs the same order code ------------------------------------------
{
  const rq = () => new Request('https://tradezoro.com/connect/finatic/order', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4' }, body: '{"op":"place"}' });
  const worker = (ver, answer) => { const w = { orders: 0, probes: 0, fetch: async (r) => {
    if (new URL(r.url).pathname === '/connect/finatic/ver') { w.probes++; return ver === 404 ? F.json({ error: 'Not found', code: 'not_found' }, 404) : F.json({ ver }); }
    w.orders++; w.sentVer = r.headers.get('x-tz-ver'); return answer ? answer(r) : F.json({ ok: true, where: 'edge' });
  } }; return w; };
  let here = 0; const entry = F.pagesEntry(async () => { here++; return F.json({ ok: true, where: 'pages' }); }, { retryHere: false });
  // a build without a generated hash (git, local) never forwards
  F._setVer('dev'); let w = worker('dev'); let r = await entry({ request: rq(), env: { FINATIC_EDGE: w } });
  assert.equal((await r.json()).where, 'pages'); assert.equal(w.orders + w.probes, 0, 'dev build: Worker not touched');
  // the 19 Nov Worker has no /ver route (404): the order runs here with the current code, never on the Worker
  F._setVer('v2'); here = 0; w = worker(404); r = await entry({ request: rq(), env: { FINATIC_EDGE: w } });
  assert.equal((await r.json()).where, 'pages'); assert.equal(w.orders, 0, 'old Worker never gets the order'); assert.equal(here, 1);
  r = await entry({ request: rq(), env: { FINATIC_EDGE: w } }); assert.equal(w.probes, 1, 'a "no" is remembered (no probe per order)'); assert.equal(here, 2);
  // a Worker with other code (different hash): runs here
  F._setVer('v2'); here = 0; w = worker('v1'); r = await entry({ request: rq(), env: { FINATIC_EDGE: w } });
  assert.equal((await r.json()).where, 'pages'); assert.equal(w.orders, 0);
  // the same code: forwarded exactly once, with the build's hash; not run here
  F._setVer('v2'); here = 0; w = worker('v2'); r = await entry({ request: rq(), env: { FINATIC_EDGE: w } });
  assert.equal((await r.json()).where, 'edge'); assert.equal(w.orders, 1); assert.equal(here, 0); assert.equal(w.sentVer, 'v2');
  // the Worker refuses a request with another hash (409 edge_stale, before any handler): runs here once, and the Worker is dropped
  F._setVer('v2'); here = 0; w = worker('v2', () => F.json({ error: 'Edge code is not this build', code: 'edge_stale' }, 409));
  r = await entry({ request: rq(), env: { FINATIC_EDGE: w } }); assert.equal((await r.json()).where, 'pages'); assert.equal(here, 1);
  r = await entry({ request: rq(), env: { FINATIC_EDGE: w } }); assert.equal(w.orders, 1, 'not forwarded again after edge_stale'); assert.equal(here, 2);
  // forwarded, then the binding throws mid-way: an order is NEVER run a second time here; plain words
  F._setVer('v2'); here = 0; w = worker('v2', () => { throw new Error('reset'); });
  r = await entry({ request: rq(), env: { FINATIC_EDGE: w } }); const j = await r.json();
  assert.equal(j.code, 'unknown'); assert.equal(here, 0, 'never run twice'); assert.match(j.error, /our order server/);
  // a probe that throws = run here
  F._setVer('v2'); here = 0; r = await entry({ request: rq(), env: { FINATIC_EDGE: { fetch: async () => { throw new Error('down'); } } } });
  assert.equal((await r.json()).where, 'pages'); assert.equal(here, 1);
  F._setVer('dev');
}
// the Worker side: /ver says its hash; a request stamped with another hash is refused before any handler
{
  let r = await route(new Request('https://tradezoro.com/connect/finatic/ver'), {}, null);
  assert.equal(r.status, 200); assert.equal((await r.json()).ver, VER);
  r = await route(new Request('https://tradezoro.com/connect/finatic/order', { method: 'POST', headers: { 'x-tz-ver': 'not-' + VER, 'content-type': 'application/json' }, body: '{}' }), { FINATIC_API_KEY: 'k' }, null);
  assert.equal(r.status, 409); assert.equal((await r.json()).code, 'edge_stale');
  r = await route(new Request('https://tradezoro.com/connect/finatic/order', { method: 'POST', headers: { 'x-tz-ver': VER, 'x-tz-ip': '5.6.7.8', origin: 'https://tradezoro.com', 'content-type': 'application/json' }, body: '{}' }), { FINATIC_API_KEY: 'k' }, null);
  assert.equal(r.status, 401, 'same hash: the normal handler runs');
}
// the version generator: 'dev' in git, a real hash over every bundled file
{
  const G = await import('../../tools/gen-edge-ver.mjs');
  const files = G.edgeFiles();
  for (const f of ['functions/connect/finatic/order.js', 'functions/connect/finatic/_fin.js', 'assets/chart-live-core.js', 'workers/finatic-edge/wrangler.jsonc']) assert.ok(files.includes(f), f);
  assert.ok(!files.includes('functions/connect/finatic/_ver.js'), 'the stamp itself is not hashed');
  assert.match(G.edgeHash(), /^[0-9a-f]{16}$/);
  assert.equal(VER, 'dev', '_ver.js must stay dev in git');
}

// ---- 2. fin(): reads asked once more on no answer / 5xx; writes never; timeouts; what an HTML 504 page was ----------------
{
  const env = { FINATIC_API_KEY: 'fntc_live_FAKE' };
  let n = 0; const seq = (...rs) => async (url, init) => { const x = rs[Math.min(n++, rs.length - 1)]; if (x instanceof Error) throw x; return x(); };
  const j200 = () => new Response(JSON.stringify({ data: [1] }), { status: 200 });
  const s503 = () => new Response(JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'try later' } }), { status: 503 });
  n = 0; let r = await F.fin(env, { finFetch: seq(s503, j200) }, 'GET', '/x'); assert.equal(r.ok, true); assert.equal(n, 2, 'GET retried once after 503');
  n = 0; r = await F.fin(env, { finFetch: seq(new TypeError('net'), j200) }, 'GET', '/x'); assert.equal(r.ok, true); assert.equal(n, 2, 'GET retried once after a network error');
  n = 0; r = await F.fin(env, { finFetch: seq(s503, s503, j200) }, 'GET', '/x'); assert.equal(r.status, 503); assert.equal(n, 2, 'only once');
  n = 0; r = await F.fin(env, { finFetch: seq(s503, j200) }, 'POST', '/api/v1/accounts/a/orders', { body: {} }); assert.equal(r.status, 503); assert.equal(n, 1, 'a write is NEVER re-sent');
  n = 0; r = await F.fin(env, { finFetch: seq(new TypeError('net'), j200) }, 'DELETE', '/api/v1/accounts/a/orders/1'); assert.equal(r.status, 0); assert.equal(n, 1);
  const te = Object.assign(new Error('t'), { name: 'TimeoutError' });
  n = 0; r = await F.fin(env, { finFetch: seq(te, j200) }, 'GET', '/x'); assert.equal(n, 1, 'a read that timed out is not asked again (it already took 10 s)'); assert.equal(r.errCode, 'our_timeout_10s');
  n = 0; r = await F.fin(env, { finFetch: seq(te) }, 'POST', '/o', { body: {} }); assert.equal(r.errCode, 'our_timeout_20s'); assert.equal(r.status, 0); assert.equal(r.bad, true);
  // a write gets the longer timeout (a slow place must not be cut into 'unknown' at 10 s)
  let sig; await F.fin(env, { finFetch: async (u, init) => { sig = init.signal; return j200(); } }, 'POST', '/o', { body: {} }); assert.ok(sig);
  assert.equal(F.WRITE_TIMEOUT_MS, 20000); assert.equal(F.TIMEOUT_MS, 10000);
  // garbage / HTML gateway page: never success; the audit gets the page kind and the broker link's request id, never the body
  const html = () => new Response('<html><head><title>504 Gateway Time-out</title></head><body>secret-ish body fntc_live_x</body></html>', { status: 504, headers: { 'content-type': 'text/html', server: 'awselb/2.0', 'x-amzn-requestid': 'abc-123' } });
  n = 0; r = await F.fin(env, { finFetch: seq(html) }, 'POST', '/o', { body: {} });
  assert.equal(r.ok, false); assert.equal(r.status, 504); assert.equal(r.errCode, 'non_json');
  assert.match(r.errMsg, /text\/html "504 Gateway Time-out" from awselb\/2.0, \d+ bytes, not their app, request id abc-123/); assert.ok(!/fntc_|body/.test(r.errMsg), r.errMsg);
  n = 0; r = await F.fin(env, { finFetch: seq(() => new Response('{not json', { status: 200 })) }, 'POST', '/o', { body: {} });
  assert.equal(r.ok, false); assert.equal(r.bad, true, 'a 200 with a broken body is unclear, not success');
  n = 0; r = await F.fin(env, { finFetch: seq(() => new Response('', { status: 504 })) }, 'POST', '/o', { body: {} });
  assert.match(r.errMsg, /empty/);
}

// ---- 3. the order route: 504 with an EMPTY order list, the position shows the fill = placed ------------------------------
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (uid) => { const t = Math.floor(Date.now() / 1000); const h = b64({ alg: 'RS256', kid: 'k1' }), p = b64({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: uid, iat: t - 5, exp: t + 3000 }); return h + '.' + p + '.' + createSign('RSA-SHA256').update(h + '.' + p).sign(privateKey, 'base64url'); };
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const verifyFetch = async (url) => { if (String(url).includes('jwk/securetoken')) return new Response(JSON.stringify({ keys: [jwk] })); return /admins\/admin1$/.test(String(url)) ? new Response('{}') : new Response('{}', { status: 404 }); };
const US = '0aaa1111-2222-3333-4444-555566667777', ACC = '123e4567-e89b-12d3-a456-426614174000';
const ok = (data) => new Response(JSON.stringify({ data, errors: [] }), { status: 200 });
// Sample data: positions per read (index = how many /positions reads happened before), orders always as B.orders
const B = { calls: [], post: '504', orders: [], pos: [], posAfter: 1 };
const posRead = () => B.calls.filter((c) => c.m === 'GET' && c.p.endsWith('/positions')).length;
const finFetch = async (url, init) => {
  const u = new URL(url);
  B.calls.push({ m: init.method, p: u.pathname });
  if (u.pathname === '/api/v1/session/init') return ok({ one_time_token: 'ott' });
  if (u.pathname === '/api/v1/session/start') return ok({ session_id: 's', company_id: 'c', status: 'active', user_id: US });
  if (u.pathname === '/api/v1/accounts') return ok([{ accountId: ACC }]);
  if (u.pathname.endsWith('/positions')) { const i = posRead() - 1; return ok(typeof B.pos === 'function' ? B.pos(i) : B.pos); }
  if (u.pathname.endsWith('/orders') && init.method === 'GET') return ok(B.orders);
  if (u.pathname.endsWith('/orders') && init.method === 'POST') {
    if (B.post === '504') return new Response('<html><title>504 Gateway Time-out</title></html>', { status: 504, headers: { 'content-type': 'text/html' } });
    if (B.post === 'garbage') return new Response('{"data": {"order"', { status: 200 });
    return ok({ accepted: true, order: { orderId: 'o-new', status: 'SUBMITTED' } });
  }
  return ok([]);
};
const audits = new Map();
const audit = async (e, id) => { if (id && audits.has(id)) { const er = new Error('dup'); er.duplicate = true; throw er; } const row = { ...e }; audits.set(id || 'r' + audits.size, row); return { finish: async (x) => Object.assign(row, x) }; };
const deps = { store: memStore({ consent: ['admin1'] }), verifyFetch, finFetch, audit, brackets: new Map(), liveSwitch: async () => true, sleep: async () => {} };
const live = { FINATIC_API_KEY: 'fntc_live_FAKE', FINATIC_LIVE_ORDERS: '1', DEV: '0' };
let ip = 1;
const send = async (b) => { const x = await O.handle(new Request('https://tradezoro.com/connect/finatic/order', { method: 'POST', headers: { 'cf-connecting-ip': '10.7.' + (ip++ % 250) + '.1', origin: 'https://tradezoro.com', 'content-type': 'application/json', authorization: 'Bearer ' + token('admin1') }, body: JSON.stringify({ src: 'chart', accountId: ACC, userId: US, ...b }) }), live, deps); return { status: x.status, j: await x.json() }; };
const posts = () => B.calls.filter((c) => c.m === 'POST' && c.p.endsWith('/orders')).length;
const key = (n) => 'ouk' + String(n).padStart(20, '0');
const P = (q) => (q ? [{ symbol: 'MNQZ6', securityId: 'MNQZ6', quantity: Math.abs(q), side: q > 0 ? 'LONG' : 'SHORT', status: 'OPEN' }] : []);
const sell1 = (n, extra) => send({ op: 'place', symbol: 'MNQZ6', side: 'sell', qty: 1, type: 'market', idemKey: key(n), ...extra });

// flat before, short 1 on every read after the send (the Owner's 23 Nov 13:55 sell 1 MNQZ6 case, order list empty)
B.calls = []; B.pos = (i) => P(i >= 1 ? -1 : 0);
let x = await sell1(1);
assert.equal(x.status, 200, JSON.stringify(x.j)); assert.equal(x.j.settled, 'position'); assert.equal(x.j.status, 'FILLED');
assert.equal(posts(), 1, 'ONE send, never re-sent');
let a = audits.get(key(1)); assert.equal(a.result, 'accepted'); assert.equal(a.httpStatus, 504);
assert.match(a.message, /HTTP 504 non_json: text\/html "504 Gateway Time-out"/); assert.match(a.message, /settled by position: net 0 -> -1 on 2 reads/);
assert.equal(L.settledText('SELL 1 MNQZ6 MARKET', x.j), 'SELL 1 MNQZ6 MARKET placed. The broker was slow to answer, so we checked: your position changed by exactly this order.');
// one read shows it, the next does not (a lagging / flickering read): NOT settled, stays unknown
B.calls = []; B.pos = (i) => P(i === 1 ? -1 : 0);
x = await sell1(2); assert.equal(x.j.code, 'unknown'); assert.equal(audits.get(key(2)).result, 'unknown');
assert.match(x.j.error, /answered with an error \(code 504\), and the order has not shown up/);
// a working order on the contract before the send could explain the move: NOT settled by position
B.calls = []; B.pos = (i) => P(i >= 1 ? -1 : 0); B.orders = [{ orderId: 'rest1', status: 'WORKING', legs: [{ securityId: 'MNQZ6', side: 'SELL', quantity: 1 }], orderType: 'limit' }];
x = await sell1(3); assert.equal(x.j.code, 'unknown', 'a resting order could have filled instead'); B.orders = [];
// moved by the wrong size or the wrong way: NOT ours
B.calls = []; B.pos = (i) => P(i >= 1 ? -2 : 0); x = await sell1(4); assert.equal(x.j.code, 'unknown');
B.calls = []; B.pos = (i) => P(i >= 1 ? 1 : 0); x = await sell1(5); assert.equal(x.j.code, 'unknown');
// closing a long works the same way (long 2 -> long 1)
B.calls = []; B.pos = (i) => P(i >= 1 ? 1 : 2); x = await sell1(6); assert.equal(x.j.settled, 'position');
// a limit order is never settled by position (it can rest; only a found order counts)
B.calls = []; B.pos = (i) => P(i >= 1 ? -1 : 0);
x = await send({ op: 'place', symbol: 'MNQZ6', side: 'sell', qty: 1, type: 'limit', limitPrice: 21000, idemKey: key(7) }); assert.equal(x.j.code, 'unknown');
// pure helper
const o1 = { symbol: 'MNQZ6', action: 'buy', orderQty: 2, orderType: 'market' };
assert.deepEqual(O.positionMoved({ positions: P(0), orders: [] }, { positions: P(2), orders: [] }, o1), { from: 0, to: 2 });
assert.equal(O.positionMoved({ positions: P(0), orders: [] }, { positions: P(1), orders: [] }, o1), null);
assert.equal(O.positionMoved(null, { positions: P(2), orders: [] }, o1), null);
// the order IS in the list: settled by order, as before (and the toast says placed, with the broker status)
B.calls = []; B.pos = []; B.orders = []; let reads = 0;
const realFetch = deps.finFetch;
deps.finFetch = async (url, init) => { const u = new URL(url); if (u.pathname.endsWith('/orders') && init.method === 'GET') { reads++; return ok(reads > 1 ? [{ orderId: 'o-late', status: 'FILLED', orderCreatedAt: new Date().toISOString(), legs: [{ securityId: 'MNQZ6', side: 'SELL', quantity: 1 }] }] : []); } return realFetch(url, init); };
x = await sell1(8); deps.finFetch = realFetch;
assert.equal(x.j.settled, 'order'); assert.equal(x.j.orderId, 'o-late');
assert.equal(L.settledText('SELL 1 MNQZ6 MARKET', x.j), 'SELL 1 MNQZ6 MARKET placed. The broker was slow to answer, so we checked: the order is there (filled).');
// a garbled 200 body: unclear, settled the same way, never re-sent
B.calls = []; B.post = 'garbage'; B.pos = (i) => P(i >= 1 ? -1 : 0);
x = await sell1(9); assert.equal(x.j.settled, 'position'); assert.equal(posts(), 1);
// a settle read that fails once is retried by fin() and still settles
B.calls = []; B.post = '504'; let failOnce = true;
deps.finFetch = async (url, init) => { const u = new URL(url); if (failOnce && u.pathname.endsWith('/positions') && posRead() >= 1) { failOnce = false; B.calls.push({ m: 'GET', p: '/x' }); return new Response('{"error":"busy"}', { status: 502 }); } return realFetch(url, init); };
B.pos = (i) => P(i >= 1 ? -1 : 0); x = await sell1(10); deps.finFetch = realFetch;
assert.equal(x.j.settled, 'position'); assert.equal(posts(), 1);
// no answer at all (our timeout / network): plain words
deps.finFetch = async (url, init) => { if (new URL(url).pathname.endsWith('/orders') && init.method === 'POST') { B.calls.push({ m: 'POST', p: '/orders' }); throw Object.assign(new Error('t'), { name: 'TimeoutError' }); } return realFetch(url, init); };
B.calls = []; B.pos = []; x = await sell1(11); deps.finFetch = realFetch;
assert.equal(x.j.code, 'unknown'); assert.match(x.j.error, /did not answer in time/); assert.match(audits.get(key(11)).message, /our_timeout_20s/);

console.log('ordunknown: all pass');
