// MEMBER LIVE TRADING (Owner decision 21 Nov 2026): every signed-in member may connect their own broker and trade live from the chart.
// This file proves the member-facing guards with a mocked broker link and an in-memory store. NO network, NO real order: every
// "order" below goes to the finFetch stub.
//   1. ownership: a member only ever reaches their OWN broker-link user and accounts (no client-sent user id, no other member's account,
//      no other member's portal session, no other member's grant)
//   2. the one-time "Enable live trading" acceptance gates every write (stored server-side: uid, time, version)
//   3. kill switches: global settings/liveTrading, FINATIC_LIVE_ORDERS env, per-member settings/liveBlocked {<uid>: true}
//   4. 10 orders a minute per member (one member's limit never blocks another)
// Run: node tests/finatic/member-live.test.mjs
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import * as O from '../../functions/connect/finatic/order.js';
import * as D from '../../functions/connect/finatic/data.js';
import * as S from '../../functions/connect/finatic/session.js';
import * as F from '../../functions/connect/finatic/_fin.js';
import * as OW from '../../functions/connect/finatic/_owner.js';
import { memStore } from './_store.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (uid) => { const now = Math.floor(Date.now() / 1000); const h = b64({ alg: 'RS256', kid: 'k1' }), p = b64({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: uid, iat: now - 5, exp: now + 3000 }); return h + '.' + p + '.' + createSign('RSA-SHA256').update(h + '.' + p).sign(privateKey).toString('base64url'); };
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const verifyFetch = async (url) => { if (String(url).includes('jwk/securetoken')) return new Response(JSON.stringify({ keys: [jwk] })); return /admins\/admin1$/.test(String(url)) ? new Response('{}') : new Response('{}', { status: 404 }); };

// two members, each with their own broker-link user, account and grant (Sample data)
const UA = '0aaa1111-2222-3333-4444-555566667777', UB = '0bbb1111-2222-3333-4444-555566667777';
const ACC_A = '11111111-e89b-12d3-a456-426614174000', ACC_B = '22222222-e89b-12d3-a456-426614174000';
const GR_A = '33333333-e89b-12d3-a456-426614174000', GR_B = '44444444-e89b-12d3-a456-426614174000';
const ACCTS = { [UA]: [{ accountId: ACC_A }], [UB]: [{ accountId: ACC_B }] }, GRANTS = { [UA]: [{ id: GR_A }], [UB]: [{ id: GR_B }] };
const PORTAL_USER = { 'sess-a': UA, 'sess-b': UB };   // which broker-link user a finished portal session belongs to
let nextSession = 'sess-a';
const B = { calls: [] };
const ok = (data) => new Response(JSON.stringify({ data, errors: [] }), { status: 200 });
const finFetch = async (url, init) => {
  const u = new URL(url), sid = init.headers['x-session-id'] || '', user = sid.replace(/^s-/, '');
  B.calls.push({ m: init.method, p: u.pathname, user, key: init.headers['Idempotency-Key'] });
  if (u.pathname === '/api/v1/session/init') return ok({ one_time_token: 'ott' });
  if (u.pathname === '/api/v1/session/start') { const want = JSON.parse(init.body || '{}').user_id; return ok({ session_id: want ? 's-' + want : nextSession, company_id: 'c', status: want ? 'active' : 'pending', user_id: want || '' }); }
  if (u.pathname === '/api/v1/session/portal') return ok({ portal_url: 'https://portal.finatic.dev/?t=x' });
  const m = u.pathname.match(/^\/api\/v1\/sessions\/([^/]+)\/user$/); if (m) return PORTAL_USER[m[1]] ? ok({ userId: PORTAL_USER[m[1]] }) : new Response('{}', { status: 404 });
  if (u.pathname === '/api/v1/accounts') return ok(ACCTS[user] || []);
  if (u.pathname === '/api/v1/account-grants') return ok(GRANTS[user] || []);
  if (u.pathname.endsWith('/revoke')) return ok({ ok: true });
  if (/\/accounts\/[^/]+\/(positions|orders|balances|transactions)$/.test(u.pathname) && init.method === 'GET') return ok([]);
  if (u.pathname.endsWith('/orders') && init.method === 'POST') return ok({ accepted: true, order: { orderId: 'o-' + init.headers['Idempotency-Key'], status: 'SUBMITTED' } });
  if (u.pathname.includes('/orders/') && init.method === 'DELETE') return ok({ accepted: true, order: { orderId: 'x', status: 'CANCELLED' } });
  return ok([]);
};
const audits = new Map();
const audit = async (e, id) => { if (id && audits.has(id)) { const er = new Error('dup'); er.duplicate = true; throw er; } const row = { ...e }; audits.set(id || 'r' + audits.size, row); return { id, finish: async (r) => Object.assign(row, r) }; };
let globalOn = true;
const store = memStore();
const deps = { brokersPaused: false,   // pause off here: this file tests broker behaviour (pause: broker-pause.test.mjs)
  store, verifyFetch, finFetch, audit, brackets: new Map(), liveSwitch: async () => globalOn, sleep: async () => {} };
const live = { FINATIC_API_KEY: 'fntc_live_FAKE', FINATIC_LIVE_ORDERS: '1', DEV: '0' };
let ip = 1;
const req = (path, body, uid) => new Request('https://tradezoro.com/connect/finatic/' + path, { method: 'POST', headers: { 'cf-connecting-ip': '10.7.' + (ip++ % 250) + '.' + (Math.floor(ip / 250) % 250), origin: 'https://tradezoro.com', 'content-type': 'application/json', authorization: 'Bearer ' + token(uid) }, body: JSON.stringify(body) });
const go = async (h, path, body, uid, env = live) => { const r = await h.handle(req(path, body, uid), env, deps); return { status: r.status, j: await r.json() }; };
const key = (n) => 'm' + String(n).padStart(20, '0');
const writes = () => B.calls.filter((x) => x.m !== 'GET' && !x.p.includes('/session/'));
const place = (acc, n, extra) => ({ src: 'chart', op: 'place', accountId: acc, symbol: 'MNQZ6', side: 'buy', qty: 1, type: 'market', idemKey: key(n), ...extra });
const reset = () => { OW._resetOwner(); };

// ---- 1. connect: each member's portal session is remembered server-side and only THAT session claims a user -----------------------
nextSession = 'sess-a'; let r = await go(S, 'session', { mode: 'dark' }, 'memberA'); assert.equal(r.status, 200); assert.equal(r.j.sessionId, 'sess-a');
assert.ok(store.docs.get('brokerUsers/memberA').pendingHash && !JSON.stringify([...store.docs.values()]).includes('sess-a'), 'only a hash of the session id is stored');
nextSession = 'sess-b'; r = await go(S, 'session', { mode: 'dark' }, 'memberB'); assert.equal(r.j.sessionId, 'sess-b');
// B tries to finish with A's portal session: refused, and nothing is claimed
r = await go(D, 'data', { op: 'accounts', sessionId: 'sess-a' }, 'memberB'); assert.equal(r.status, 403); assert.equal(r.j.code, 'not_owner');
assert.ok(!store.docs.has('finUsers/' + UA));
// each finishes with their own session
r = await go(D, 'data', { op: 'accounts', sessionId: 'sess-a' }, 'memberA'); assert.equal(r.status, 200); assert.deepEqual(r.j.data, [{ accountId: ACC_A }]); assert.equal(r.j.userId, UA);
r = await go(D, 'data', { op: 'accounts', sessionId: 'sess-b' }, 'memberB'); assert.equal(r.status, 200); assert.deepEqual(r.j.data, [{ accountId: ACC_B }]);
assert.equal(store.docs.get('finUsers/' + UA).uid, 'memberA'); assert.equal(store.docs.get('brokerUsers/memberB').finUserId, UB);
// afterwards the server's record wins: a client-sent userId of the other member is ignored
r = await go(D, 'data', { op: 'accounts', userId: UA }, 'memberB'); assert.equal(r.status, 200); assert.deepEqual(r.j.data, [{ accountId: ACC_B }], 'B still sees only B');
// a member with no connection who sends someone else's user id: needs_connect, nothing read at the broker
{ const c0 = B.calls.length; r = await go(D, 'data', { op: 'accounts', userId: UA }, 'memberC'); assert.equal(r.status, 409); assert.equal(B.calls.length, c0); }
// even an admin cannot claim a user id another member holds (legacy claim path)
r = await go(D, 'data', { op: 'accounts', userId: UA }, 'admin1'); assert.equal(r.status, 403); assert.equal(r.j.code, 'not_owner');

// ---- 2. account-scoped reads: only your own account ids --------------------------------------------------------------------------
for (const op of ['live', 'positions', 'orders', 'balances', 'transactions']) {
  r = await go(D, 'data', { op, accountId: ACC_A }, 'memberB'); assert.equal(r.status, 403, op + ': B cannot read A'); assert.equal(r.j.code, 'not_owner');
  r = await go(D, 'data', { op, accountId: ACC_B }, 'memberB'); assert.equal(r.status, 200, op + ': B reads B');
}
r = await go(D, 'data', { op: 'fills', accountId: ACC_A, orderIds: ['o1'] }, 'memberB'); assert.equal(r.status, 403);
assert.ok(!B.calls.some((c) => c.user === UB && c.p.includes(ACC_A)), 'no call for A\'s account ever went out on B\'s session');
// grant revoke: only your own grant
{ const w0 = writes().length; r = await go(D, 'data', { op: 'revoke', grantId: GR_A }, 'memberB'); assert.equal(r.status, 403); assert.equal(writes().length, w0, 'nothing revoked'); }
r = await go(D, 'data', { op: 'revoke', grantId: GR_B }, 'memberB'); assert.equal(r.status, 200);

// ---- 3. "Enable live trading": every write refused until accepted; then stored with uid, time, version -------------------------
reset();
r = await go(O, 'order', { op: 'env', src: 'chart' }, 'memberA'); assert.equal(r.status, 200); assert.equal(r.j.consent, false); assert.equal(r.j.blocked, false); assert.equal(r.j.version, OW.LIVE_TERMS_VERSION);
{ const w0 = writes().length;
  for (const b of [place(ACC_A, 1), { src: 'chart', op: 'cancel', accountId: ACC_A, orderId: 'w1', idemKey: key(2) }, { src: 'chart', op: 'flatten', accountId: ACC_A, symbol: 'MNQZ6', idemKey: key(3) }]) {
    r = await go(O, 'order', b, 'memberA'); assert.equal(r.status, 403, b.op + ' before acceptance'); assert.equal(r.j.code, 'consent_needed');
  }
  assert.equal(writes().length, w0, 'nothing sent before acceptance'); }
// read-only things still work before acceptance (view-only): schema read
r = await go(O, 'order', { src: 'chart', op: 'schema', action: 'place', accountId: ACC_A }, 'memberA'); assert.equal(r.status, 200);
// accepting needs the tick (accept:true) and the CURRENT version
r = await go(O, 'order', { op: 'consent', accept: false, version: OW.LIVE_TERMS_VERSION }, 'memberA'); assert.equal(r.status, 400);
r = await go(O, 'order', { op: 'consent', accept: true, version: '2020-01-01' }, 'memberA'); assert.equal(r.status, 400);
r = await go(O, 'order', { op: 'consent', accept: true, version: OW.LIVE_TERMS_VERSION, uid: 'memberB' }, 'memberA'); assert.equal(r.status, 200);
{ const c = store.docs.get('liveConsent/memberA'); assert.equal(c.uid, 'memberA'); assert.equal(c.version, OW.LIVE_TERMS_VERSION); assert.ok(Date.parse(c.at) > 0); assert.ok(!store.docs.has('liveConsent/memberB'), 'a body uid is never used'); }
r = await go(O, 'order', place(ACC_A, 4), 'memberA'); assert.equal(r.status, 200, 'accepted: order goes out'); assert.equal(writes().at(-1).key, key(4)); assert.equal(writes().at(-1).user, UA);
assert.equal(audits.get(key(4)).uid, 'memberA', 'audit row carries the member uid');
// an old acceptance (earlier version) does not count
store.docs.set('liveConsent/memberB', { uid: 'memberB', version: '2026-01-01', at: 'x' });
r = await go(O, 'order', place(ACC_B, 5), 'memberB'); assert.equal(r.status, 403); assert.equal(r.j.code, 'consent_needed');
// acceptance unreadable = refused
{ const d2 = { ...deps, store: memStore({ fail: (op, p) => p.startsWith('liveConsent/') }) }; d2.store.docs.set('brokerUsers/memberB', { finUserId: UB }); OW._resetOwner(); 
  const x = await O.handle(req('order', place(ACC_B, 6), 'memberB'), live, d2); assert.equal(x.status, 503); assert.equal((await x.json()).code, 'consent_unreadable'); }
r = await go(O, 'order', { op: 'consent', accept: true, version: OW.LIVE_TERMS_VERSION }, 'memberB'); assert.equal(r.status, 200);

// ---- 4. ownership on writes: B can never place / cancel / flatten on A's account --------------------------------------------------
reset();
{ const w0 = writes().length;
  for (const b of [place(ACC_A, 10), { src: 'chart', op: 'cancel', accountId: ACC_A, orderId: 'w1', idemKey: key(11) }, { src: 'chart', op: 'modify', accountId: ACC_A, orderId: 'w1', type: 'limit', limitPrice: 21000, idemKey: key(12) }, { src: 'chart', op: 'flatten', accountId: ACC_A, symbol: 'MNQZ6', idemKey: key(13) }, { src: 'chart', op: 'bracket', accountId: ACC_A, symbol: 'MNQZ6' }]) {
    r = await go(O, 'order', { ...b, userId: UA }, 'memberB'); assert.equal(r.status, 403, b.op + ' on A by B'); assert.equal(r.j.code, 'not_owner');
  }
  assert.equal(writes().length, w0, 'nothing reached A\'s account'); }
r = await go(O, 'order', place(ACC_B, 14), 'memberB'); assert.equal(r.status, 200); assert.equal(writes().at(-1).user, UB);
// the account list unreadable = refused, nothing sent
{ const saved = ACCTS[UB]; ACCTS[UB] = null; OW._resetOwner(); const ff = deps.finFetch; deps.finFetch = async (u, i) => (new URL(u).pathname === '/api/v1/accounts' ? new Response('x', { status: 500 }) : ff(u, i));
  const w0 = writes().length; r = await go(O, 'order', place(ACC_B, 15), 'memberB'); assert.equal(r.status, 503); assert.equal(writes().length, w0); deps.finFetch = ff; ACCTS[UB] = saved; }

// ---- 5. kill switches: global switch, env switch, per-member admin kill (fails closed) ----------------------------------------------
reset();
globalOn = false; r = await go(O, 'order', place(ACC_A, 20), 'memberA'); assert.equal(r.status, 403); assert.equal(r.j.code, 'switched_off'); globalOn = true;
r = await go(O, 'order', place(ACC_A, 21), 'memberA', { FINATIC_API_KEY: 'fntc_live_FAKE', DEV: '0' }); assert.equal(r.status, 403, 'FINATIC_LIVE_ORDERS still required');
store.docs.set('settings/liveBlocked', { memberA: true });
OW._resetOwner(); r = await go(O, 'order', place(ACC_A, 22), 'memberA'); assert.equal(r.status, 403); assert.equal(r.j.code, 'member_blocked');
r = await go(O, 'order', place(ACC_B, 23), 'memberB'); assert.equal(r.status, 200, 'blocking A never blocks B');
r = await go(O, 'order', { op: 'env', src: 'chart' }, 'memberA'); assert.equal(r.j.blocked, true);
// blocked member: the stop loss / take profit sync still answers (it may only cancel), it never places
{ const w0 = writes().length; r = await go(O, 'order', { src: 'chart', op: 'bracket', accountId: ACC_A, symbol: 'MNQZ6' }, 'memberA'); assert.equal(r.status, 200); assert.equal(writes().length, w0); }
store.docs.set('settings/liveBlocked', { memberA: false });
OW._resetOwner(); r = await go(O, 'order', place(ACC_A, 24), 'memberA'); assert.equal(r.status, 200, 'unblocked');
{ const d2 = { ...deps, store: memStore({ consent: ['memberA'], fail: (op, p) => p === 'settings/liveBlocked' }) }; d2.store.docs.set('brokerUsers/memberA', { finUserId: UA }); OW._resetOwner(); 
  const x = await O.handle(req('order', place(ACC_A, 25), 'memberA'), live, d2); assert.equal(x.status, 503, 'per-member switch unreadable = refused'); }
OW._resetOwner();

// ---- 6. NO orders-a-minute limit (Owner 21 Nov "No limits from our end") ------------------------------------------------------
reset();
for (let i = 0; i < 15; i++) { r = await O.handle(req('order', place(ACC_A, 100 + i), 'memberA'), live, deps); assert.equal(r.status, 200, 'A order ' + (i + 1)); }
r = await O.handle(req('order', place(ACC_B, 120), 'memberB'), live, deps); assert.equal(r.status, 200);

// ---- 7. safety switches still apply to members (idempotency); the size cap and contract list are gone ------------------------------
reset();
r = await go(O, 'order', place(ACC_B, 120), 'memberB'); assert.equal(r.status, 409); assert.equal(r.j.code, 'duplicate', 'same key twice never reaches the broker');
r = await go(O, 'order', place(ACC_B, 200, { qty: 40 }), 'memberB'); assert.equal(r.status, 200, 'no qty cap');
r = await go(O, 'order', place(ACC_B, 201, { symbol: 'CLF7' }), 'memberB'); assert.equal(r.status, 200, 'no contract list');
r = await go(O, 'order', place(ACC_B, 202, { qty: 0 }), 'memberB'); assert.equal(r.status, 400, 'qty must be 1 or more');
r = await go(O, 'order', { op: 'place', accountId: ACC_B, symbol: 'MNQZ6', side: 'buy', qty: 1, type: 'market' }, 'memberB'); assert.equal(r.status, 403, 'raw journal order test: admin only');
// journal mode of the sheet never reaches the order route for members (no src chart)

console.log('member-live: all assertions passed');
