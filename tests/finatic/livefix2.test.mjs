import { memStore } from './_store.mjs';
// Owner bugs 21 Nov (AUTO-LIVEFIX2): (1) live balance "updated 4 days ago", (2) "No clear answer from the broker" on a place.
// Every broker call is a STUB: nothing here reaches a real broker. Sample data only. Run: node tests/finatic/livefix2.test.mjs
import assert from 'node:assert/strict';
import * as L from '../../assets/chart-live-core.js';
import * as O from '../../functions/connect/finatic/order.js';
import * as D from '../../functions/connect/finatic/data.js';
import * as F from '../../functions/connect/finatic/_fin.js';
import { generateKeyPairSync, createSign } from 'node:crypto';

const T = (s) => Date.parse(s);
const N = T('2026-11-15T15:00:00Z');

// ---- _fin.fin keeps the broker link's error code + message (no key / token / id) -------------------------------------
let r = await F.fin({ FINATIC_API_KEY: 'fntc_live_FAKE' }, { finFetch: async () => new Response(JSON.stringify({ success: null, error: { code: 'GATEWAY_TIMEOUT', message: 'Broker did not answer for account 123e4567-e89b-12d3-a456-426614174000 key fntc_live_abc', status: 504 } }), { status: 504 }) }, 'POST', '/api/v1/accounts/x/orders');
assert.equal(r.ok, false); assert.equal(r.status, 504); assert.equal(r.errCode, 'GATEWAY_TIMEOUT');
assert.ok(!/fntc_|123e4567/.test(r.errMsg), 'no key or id in the message: ' + r.errMsg);
r = await F.fin({ FINATIC_API_KEY: 'k' }, { finFetch: async () => new Response(JSON.stringify({ data: [1] }), { status: 200 }) }, 'GET', '/x');
assert.deepEqual(r, { ok: true, status: 200, data: [1] }, 'success shape unchanged');

// ---- listAll: every page, stops on a short page, caps the page count --------------------------------------------------
const rows = Array.from({ length: 1234 }, (_, i) => i);
const pages = [];
const pc = async (m, p, o) => { pages.push(o.query.offset); return { ok: true, data: rows.slice(o.query.offset, o.query.offset + o.query.limit) }; };
let l = await F.listAll(pc, '/p', { limit: 500, maxPages: 4 });
assert.equal(l.data.length, 1234); assert.deepEqual(pages, [0, 500, 1000]); assert.equal(l.truncated, false);
l = await F.listAll(pc, '/p', { limit: 100, maxPages: 2 }); assert.equal(l.data.length, 200); assert.equal(l.truncated, true);
l = await F.listAll(async () => ({ ok: false, status: 500 }), '/p'); assert.equal(l.ok, false);

// ---- balance: the account's sync state from the accounts list, and the note under the figure --------------------------
assert.deepEqual(L.syncInfo({ accountId: 'a', status: 'ACTIVE', syncStatus: 'SYNCED', lastSyncedAt: '2026-11-21T10:00:00Z' }), { status: 'ok', at: T('2026-11-21T10:00:00Z'), error: '' });
assert.equal(L.syncInfo({ syncStatus: { syncStatus: 'failed', syncError: 'token expired' } }).status, 'failed');
assert.equal(L.syncInfo({ syncStatus: 'SYNCING' }).status, 'syncing');
assert.equal(L.syncInfo({ status: 'ACTIVE' }).status, '', 'the account status is not a sync state');
assert.equal(L.syncInfo(null).status, '');
assert.equal(L.acctInfo({ accountId: 'a', syncStatus: 'FAILED' }).sync.status, 'failed', 'acctInfo carries it');
const day = 86400000, now = T('2026-11-21T12:00:00Z');
assert.equal(L.balanceNote(now - 4 * day, { status: 'ok' }, now), 'updated 4 days ago', 'the real age stays visible');
assert.equal(L.balanceNote(now - 4 * day, { status: 'failed' }, now), 'sync failed');
assert.equal(L.balanceNote(now - 30000, { status: 'failed' }, now), '', 'fresh figure: no note');

// ---- server stubs (no network) -------------------------------------------------------------------------------------
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (uid) => { const t = Math.floor(Date.now() / 1000); const h = b64({ alg: 'RS256', kid: 'k1' }), p = b64({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: uid, iat: t - 5, exp: t + 3000 }); return h + '.' + p + '.' + createSign('RSA-SHA256').update(h + '.' + p).sign(privateKey, 'base64url'); };
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const verifyFetch = async (url) => { if (String(url).includes('jwk/securetoken')) return new Response(JSON.stringify({ keys: [jwk] })); return /admins\/admin1$/.test(String(url)) ? new Response('{}') : new Response('{}', { status: 404 }); };
const US = '0aaa1111-2222-3333-4444-555566667777', ACC = '123e4567-e89b-12d3-a456-426614174000';
const ok = (data) => new Response(JSON.stringify({ data, errors: [] }), { status: 200 });
const B = { orders: [], calls: [], post: 'ok', appear: 0, bal: [] };
const finFetch = async (url, init) => {
  const u = new URL(url);
  B.calls.push({ m: init.method, p: u.pathname, q: Object.fromEntries(u.searchParams), key: init.headers['Idempotency-Key'] });
  if (u.pathname === '/api/v1/session/init') return ok({ one_time_token: 'ott' });
  if (u.pathname === '/api/v1/session/start') return ok({ session_id: 's', company_id: 'c', status: 'active', user_id: US });
  const page = (list) => { const off = +u.searchParams.get('offset') || 0, lim = +u.searchParams.get('limit') || 100; return ok(list.slice(off, off + lim)); };
  if (u.pathname === '/api/v1/accounts') return ok([{ accountId: ACC }]);   // member live (21 Nov): ownership check reads the account list
  if (u.pathname.endsWith('/balances')) return page(B.bal);
  if (u.pathname.endsWith('/positions')) return ok([]);
  if (u.pathname.endsWith('/orders') && init.method === 'GET') {
    if (B.appear && B.calls.filter((c) => c.m === 'GET' && c.p.endsWith('/orders')).length > B.appear) return page(B.orders.concat(B.late || []));
    return page(B.orders);
  }
  if (u.pathname.endsWith('/orders') && init.method === 'POST') {
    if (B.post === '504') return new Response(JSON.stringify({ success: null, error: { code: 'GATEWAY_TIMEOUT', message: 'upstream timed out', status: 504 } }), { status: 504 });
    return ok({ accepted: true, order: { orderId: 'o-new', status: 'SUBMITTED' } });
  }
  return ok([]);
};
const audits = new Map();
const audit = async (e, id) => { if (id && audits.has(id)) { const er = new Error('dup'); er.duplicate = true; throw er; } const row = { ...e }; audits.set(id || 'r' + audits.size, row); return { finish: async (x) => Object.assign(row, x) }; };
const deps = { store: memStore({ consent: ['admin1'] }), verifyFetch, finFetch, audit, brackets: new Map(), liveSwitch: async () => true, now: () => N, sleep: async () => {} };
const live = { FINATIC_API_KEY: 'fntc_live_FAKE', FINATIC_LIVE_ORDERS: '1', DEV: '0' };
let ip = 1;
const req = (body, url) => new Request(url, { method: 'POST', headers: { 'cf-connecting-ip': '10.8.' + (ip++ % 250) + '.1', origin: 'https://tradezoro.com', 'content-type': 'application/json', authorization: 'Bearer ' + token('admin1') }, body: JSON.stringify(body) });
const send = async (b) => { const x = await O.handle(req({ src: 'chart', accountId: ACC, userId: US, ...b }, 'https://tradezoro.com/connect/finatic/order'), live, deps); return { status: x.status, j: await x.json() }; };
const dataOp = async (b) => { const x = await D.handle(req({ userId: US, ...b }, 'https://tradezoro.com/connect/finatic/data'), live, deps); return { status: x.status, j: await x.json() }; };
const posts = () => B.calls.filter((c) => c.m === 'POST' && c.p.endsWith('/orders'));
const key = (n) => 'lf2' + String(n).padStart(20, '0');

// ---- balances: every page is read; the newest snapshot wins even when it sits on a later page ---------------------------
// Sample data: 1,180 dated snapshots, oldest first (the page-1 trap the chart fell into with limit 50)
const t0 = T('2026-11-10T00:00:00Z');
B.bal = Array.from({ length: 1180 }, (_, i) => ({ currencyCode: 'USD', netLiquidationValue: 50000 + i, lastUpdated: new Date(t0 + i * 600000).toISOString() }));
let d = await dataOp({ op: 'balances', accountId: ACC });
assert.equal(d.status, 200); assert.equal(d.j.data.length, 1180, 'all pages');
assert.equal(L.balanceOf(d.j.data, 'USD').amount, 51179, 'newest snapshot, from the last page');
assert.equal(L.balanceOf(B.bal.slice(0, 50), 'USD').amount, 50049, 'the old first-50 read: a days-old figure');
const balPages = B.calls.filter((c) => c.p.endsWith('/balances')).map((c) => c.q.offset);
assert.deepEqual(balPages, ['0', '1000']);

// ---- live read: every page of orders -----------------------------------------------------------------------------------
B.orders = Array.from({ length: 620 }, (_, i) => ({ orderId: 'h' + i, status: 'FILLED', legs: [{ securityId: 'MNQZ6', side: 'BUY', quantity: 1 }] }));
d = await dataOp({ op: 'live', accountId: ACC });
assert.equal(d.status, 200); assert.equal(d.j.data.orders.length, 620);

// ---- the order route: accepted answer unchanged ------------------------------------------------------------------------
B.orders = []; B.calls = [];
let x = await send({ op: 'place', symbol: 'MNQZ6', side: 'buy', qty: 1, type: 'market', idemKey: key(1) });
assert.equal(x.status, 200); assert.equal(x.j.orderId, 'o-new'); assert.equal(x.j.settled, undefined);
assert.equal(audits.get(key(1)).result, 'accepted');

// ---- 504 from the broker link, the order DID reach the broker: found by the settle read, never sent twice -------------
B.post = '504'; B.calls = []; B.appear = 1;   // the first GET /orders is the pre-send read; the order shows from the next read on
B.late = [{ orderId: 'o-504', status: 'FILLED', orderCreatedAt: new Date().toISOString(), legs: [{ securityId: 'MNQZ6', side: 'BUY', quantity: 1 }] }];
x = await send({ op: 'place', symbol: 'MNQZ6', side: 'buy', qty: 1, type: 'market', idemKey: key(2) });
assert.equal(x.status, 200, JSON.stringify(x.j)); assert.equal(x.j.settled, true); assert.equal(x.j.orderId, 'o-504'); assert.equal(x.j.status, 'FILLED');
assert.equal(posts().length, 1, 'ONE send, never a retry');
let a = audits.get(key(2)); assert.equal(a.result, 'accepted'); assert.equal(a.httpStatus, 504); assert.equal(a.brokerOrderId, 'o-504');
assert.match(a.message, /HTTP 504 GATEWAY_TIMEOUT: upstream timed out/); assert.match(a.message, /found by read/);

// ---- 504, the order is NOT there: still 'unknown' (chart stays blocked), the message says what was checked -------------
B.calls = []; B.appear = 0; B.late = null;
x = await send({ op: 'place', symbol: 'MNQZ6', side: 'buy', qty: 1, type: 'market', idemKey: key(3) });
assert.equal(x.status, 503, 'edge-safe 503'); assert.equal(x.j.code, 'unknown');
assert.match(x.j.error, /code 504/); assert.match(x.j.error, /blocked/);
assert.equal(posts().length, 1, 'never re-sent');
assert.equal(B.calls.filter((c) => c.m === 'GET' && c.p.endsWith('/orders')).length, 1 + O.SETTLE_MS.length, 'pre-send read + settle reads');
a = audits.get(key(3)); assert.equal(a.result, 'unknown'); assert.match(a.message, /HTTP 504 GATEWAY_TIMEOUT/); assert.match(a.message, /not found in 3 read/);

// ---- an older order of the same shape is NOT taken for ours ------------------------------------------------------------
B.calls = []; B.orders = [{ orderId: 'old1', status: 'FILLED', legs: [{ securityId: 'MNQZ6', side: 'BUY', quantity: 1 }] }];
x = await send({ op: 'place', symbol: 'MNQZ6', side: 'buy', qty: 1, type: 'market', idemKey: key(4) });
assert.equal(x.j.code, 'unknown', 'an order that was already there does not settle it');
// findNew: other contract / side / qty / created long before do not match
const ord = { symbol: 'MNQZ6', action: 'buy', orderQty: 1 }, sent = Date.now();
const mk = (o) => ({ orderId: 'n', status: 'SUBMITTED', legs: [{ securityId: 'MNQZ6', side: 'BUY', quantity: 1 }], ...o });
assert.ok(O.findNew([], [mk({})], ord, sent));
assert.equal(O.findNew([], [mk({ legs: [{ securityId: 'ESZ6', side: 'BUY', quantity: 1 }] })], ord, sent), null);
assert.equal(O.findNew([], [mk({ legs: [{ securityId: 'MNQZ6', side: 'SELL', quantity: 1 }] })], ord, sent), null);
assert.equal(O.findNew([], [mk({ legs: [{ securityId: 'MNQZ6', side: 'BUY', quantity: 2 }] })], ord, sent), null);
assert.equal(O.findNew([], [mk({ orderCreatedAt: new Date(sent - 5 * 60000).toISOString() })], ord, sent), null);

// ---- a network timeout (status 0) is settled the same way --------------------------------------------------------------
B.post = 'ok';
const realFetch = deps.finFetch;
deps.finFetch = async (url, init) => { if (new URL(url).pathname.endsWith('/orders') && init.method === 'POST') { B.calls.push({ m: 'POST', p: '/orders' }); throw new Error('timeout'); } return realFetch(url, init); };
B.calls = []; B.orders = [];
x = await send({ op: 'place', symbol: 'MNQZ6', side: 'sell', qty: 1, type: 'market', idemKey: key(5) });
assert.equal(x.j.code, 'unknown'); assert.match(audits.get(key(5)).message, /no answer \(timeout or network\)/);
deps.finFetch = realFetch;

console.log('livefix2: all pass');
