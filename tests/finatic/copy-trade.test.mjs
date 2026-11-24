// COPY TRADING ACROSS A MEMBER'S OWN ACCOUNTS (Owner order 21 Nov 2026): server + core tests with a mocked broker link and an in-memory
// store. NO network, NO real order: every "order" goes to the finFetch stub below.
//   1. ownership: leader and followers must be the SAME member's own accounts (save refuses another member's account; a fan never
//      reaches another member's account; the config is keyed by the uid of the token only)
//   2. fan-out: the leader goes first; followers get their own orders (size rule, contract mapping, own idempotency key, own audit row)
//   3. partial failure: one follower refused never blocks the others; a refused / duplicate leader sends nothing to the followers
//   4. idempotency: the same leader key twice = the leader and every follower refused as duplicates, nothing new at the broker
//   5. kill switches: global switch off / member blocked = leader refused, nothing copied; consent gates turning copying on
// Run: node tests/finatic/copy-trade.test.mjs
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import * as CP from '../../functions/connect/finatic/copy.js';
import * as OW from '../../functions/connect/finatic/_owner.js';
import * as C from '../../assets/copy-trade-core.js';
import { memStore } from './_store.mjs';

// ---- core ---------------------------------------------------------------------------------------------------------------
assert.equal(C.mapCode('NQZ6', 'micro'), 'MNQZ6');
assert.equal(C.mapCode('MNQZ6', 'full'), 'NQZ6');
assert.equal(C.mapCode('ESH7', 'same'), 'ESH7');
assert.equal(C.mapCode('MESZ6', 'micro'), 'MESZ6');   // already micro
assert.equal(C.mapCode('AAPL', 'micro'), 'AAPL');      // not a futures code: unchanged
assert.equal(C.sizeFor({ mode: 'same' }, 3), 3);
assert.equal(C.sizeFor({ mode: 'mult', mult: 0.5 }, 3), 2);
assert.equal(C.sizeFor({ mode: 'mult', mult: 0.1 }, 2), 0);   // rounds to 0 = skipped
assert.equal(C.sizeFor({ mode: 'fixed', qty: 4 }, 1), 4);
assert.ok(C.cleanConfig({ leader: 'x' }).error);
assert.ok(C.cleanConfig({ leader: '11111111-0000-0000-0000-000000000001', followers: [{ id: '11111111-0000-0000-0000-000000000001' }] }).error, 'leader cannot follow itself');
assert.ok(C.cleanConfig({ followers: [{ id: 'paper', mode: 'mult', mult: 11 }] }).error, 'mult cap');
assert.ok(C.cleanConfig({ followers: Array.from({ length: 9 }, (_, i) => ({ id: '2222222' + i + '-0000-0000-0000-000000000000' })) }).error, 'follower cap');
{ const c = C.cleanConfig({ on: true, leader: '11111111-0000-0000-0000-000000000001', followers: [{ id: 'paper' }, { id: 'paper' }] }).cfg; assert.equal(c.followers.length, 1); assert.equal(c.followers[0].exits, true, 'copy exits on by default'); }
assert.equal(C.copyKey('k1', 'a'), C.copyKey('k1', 'a')); assert.notEqual(C.copyKey('k1', 'a'), C.copyKey('k1', 'b')); assert.match(C.copyKey('k1', 'a'), /^[A-Za-z0-9-]{16,64}$/);
{ const r = C.followerBody({ id: 'f', mode: 'same', map: 'same', exits: false }, { op: 'place', symbol: 'NQZ6', side: 'buy', qty: 1, type: 'market', idemKey: 'k'.repeat(20), bracket: { sl: 1, tp: 2 } }); assert.equal(r.body.bracket, undefined, 'copy exits off = no stop loss / take profit'); }
assert.ok(C.followerBody({ id: 'f', exits: false }, { op: 'flatten', symbol: 'NQZ6', idemKey: 'k'.repeat(20) }).skip);
assert.ok(C.followerBody({ id: 'f', exits: true }, { op: 'cancel', orderId: 'o1', idemKey: 'k'.repeat(20) }, { link: {} }).skip, 'cancel with no copied order = skipped');
assert.equal(C.resultOf(200, { ok: true, status: 'FILLED', orderId: 'x' }).state, 'filled');
assert.equal(C.resultOf(409, { code: 'duplicate' }).state, 'duplicate');
assert.equal(C.resultOf(503, { error: 'Insufficient margin' }).message, 'Insufficient margin');

// ---- server -------------------------------------------------------------------------------------------------------------
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (uid, email) => { const now = Math.floor(Date.now() / 1000); const h = b64({ alg: 'RS256', kid: 'k1' }), p = b64({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: uid, iat: now - 5, exp: now + 3000, ...(email ? { email, email_verified: !/unverified/.test(email) } : {}) }); return h + '.' + p + '.' + createSign('RSA-SHA256').update(h + '.' + p).sign(privateKey).toString('base64url'); };
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
// copy trading is ADMIN ONLY (Owner 21 Nov): memberA/memberB are admins here; 'outsider' is not
const ADMINS = new Set(['memberA', 'memberB']);
const verifyFetch = async (url) => { const u = String(url); if (u.includes('jwk/securetoken')) return new Response(JSON.stringify({ keys: [jwk] })); const m = u.match(/documents\/admins\/([^?]+)/); if (m && ADMINS.has(decodeURIComponent(m[1]))) return new Response(JSON.stringify({ name: 'x', fields: {} })); return new Response('{}', { status: 404 }); };

// member A: three accounts (leader + two followers); member B: one account (Sample data)
const UA = '0aaa1111-2222-3333-4444-555566667777', UB = '0bbb1111-2222-3333-4444-555566667777';
const A1 = '11111111-e89b-12d3-a456-426614174001', A2 = '11111111-e89b-12d3-a456-426614174002', A3 = '11111111-e89b-12d3-a456-426614174003';
const B1 = '22222222-e89b-12d3-a456-426614174001';
const ACCTS = { [UA]: [{ accountId: A1 }, { accountId: A2 }, { accountId: A3 }], [UB]: [{ accountId: B1 }] };
const B = { calls: [], reject: new Set(), seen: new Set() };
const ok = (data) => new Response(JSON.stringify({ data, errors: [] }), { status: 200 });
const finFetch = async (url, init) => {
  const u = new URL(url), sid = init.headers['x-session-id'] || '', user = sid.replace(/^s-/, ''), key = init.headers['Idempotency-Key'];
  B.calls.push({ m: init.method, p: u.pathname, user, key, body: init.body ? JSON.parse(init.body) : null });
  if (u.pathname === '/api/v1/session/init') return ok({ one_time_token: 'ott' });
  if (u.pathname === '/api/v1/session/start') { const want = JSON.parse(init.body || '{}').user_id; return ok({ session_id: 's-' + want, company_id: 'c', status: 'active', user_id: want }); }
  if (u.pathname === '/api/v1/accounts') return ok(ACCTS[user] || []);
  if (/\/accounts\/[^/]+\/(positions|orders)$/.test(u.pathname) && init.method === 'GET') return ok([]);
  const acct = (u.pathname.match(/\/accounts\/([^/]+)\//) || [])[1];
  if (u.pathname.endsWith('/orders') && init.method === 'POST') {
    if (B.reject.has(acct)) return new Response(JSON.stringify({ data: null, errors: [{ message: 'Insufficient margin' }] }), { status: 422 });
    return ok({ accepted: true, order: { orderId: 'o-' + key, status: 'SUBMITTED' } });
  }
  if (u.pathname.includes('/orders/') && init.method === 'DELETE') return ok({ accepted: true, order: { orderId: 'x', status: 'CANCELLED' } });
  if (u.pathname.includes('/orders/') && init.method === 'PATCH') return ok({ accepted: true, order: { orderId: u.pathname.split('/').pop(), status: 'SUBMITTED' } });
  return ok([]);
};
const audits = new Map();
const audit = async (e, id) => { if (id && audits.has(id)) { const er = new Error('dup'); er.duplicate = true; throw er; } const row = { ...e }; audits.set(id || 'r' + audits.size, row); return { id, finish: async (r) => Object.assign(row, r) }; };
let globalOn = true;
const store = memStore({ consent: [UA, UB] });
store.docs.set('brokerUsers/' + UA, { finUserId: UA }); store.docs.set('brokerUsers/' + UB, { finUserId: UB });
const deps = { brokersPaused: false,   // pause off here: this file tests broker behaviour (pause: broker-pause.test.mjs)
  store, verifyFetch, finFetch, audit, brackets: new Map(), liveSwitch: async () => globalOn, sleep: async () => {} };
const live = { FINATIC_API_KEY: 'fntc_live_FAKE', FINATIC_LIVE_ORDERS: '1', DEV: '0' };
let ip = 1;
const req = (body, uid) => new Request('https://tradezoro.com/connect/finatic/copy', { method: 'POST', headers: { 'cf-connecting-ip': '10.9.' + (ip++ % 250) + '.' + (Math.floor(ip / 250) % 250), origin: 'https://tradezoro.com', 'content-type': 'application/json', authorization: 'Bearer ' + token(uid) }, body: JSON.stringify(body) });
const go = async (body, uid = 'memberA') => { const r = await CP.handle(req(body, uid), live, deps); return { status: r.status, j: await r.json() }; };
const writes = () => B.calls.filter((x) => x.m !== 'GET' && !x.p.includes('/session/'));
let n = 0; const key = () => 'ct' + String(++n).padStart(20, '0');
const place = (extra) => ({ op: 'fan', lead: { op: 'place', accountId: A1, symbol: 'NQZ6', side: 'buy', qty: 2, type: 'market', idemKey: key(), ...extra } });
// uid -> broker-link user: memberA = UA, memberB = UB
store.docs.set('brokerUsers/memberA', { finUserId: UA }); store.docs.set('brokerUsers/memberB', { finUserId: UB });
store.docs.set('liveConsent/memberA', { uid: 'memberA', version: OW.LIVE_TERMS_VERSION }); store.docs.set('liveConsent/memberB', { uid: 'memberB', version: OW.LIVE_TERMS_VERSION });
const cfgA = { on: true, leader: A1, followers: [{ id: A2, mode: 'mult', mult: 0.5, map: 'micro' }, { id: A3, mode: 'fixed', qty: 2 }, { id: 'paper', mode: 'same' }] };

// 1. ownership + consent on save
let r = await go({ op: 'save', cfg: cfgA });
assert.equal(r.status, 403); assert.equal(r.j.code, 'copy_consent_needed', 'first turn-on needs the copy confirm');
r = await go({ op: 'save', cfg: { ...cfgA, followers: [...cfgA.followers, { id: B1 }] }, consent: true, version: C.COPY_TERMS_VERSION });
assert.equal(r.status, 403); assert.equal(r.j.code, 'not_owner', 'another member\'s account can never be a follower');
r = await go({ op: 'save', cfg: { ...cfgA, leader: B1, followers: [{ id: A2 }] }, consent: true, version: C.COPY_TERMS_VERSION });
assert.equal(r.j.code, 'not_owner', 'another member\'s account can never be the leader');
store.docs.delete('liveConsent/memberA'); OW._resetOwner();
r = await go({ op: 'save', cfg: cfgA, consent: true, version: C.COPY_TERMS_VERSION });
assert.equal(r.j.code, 'consent_needed', 'Enable live trading must be accepted first');
store.docs.set('liveConsent/memberA', { uid: 'memberA', version: OW.LIVE_TERMS_VERSION });
r = await go({ op: 'save', cfg: cfgA, consent: true, version: C.COPY_TERMS_VERSION });
assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.cfg.consented, true);
assert.ok(store.docs.get('copyConfig/memberA').consentAt, 'consent time stored server-side');
assert.equal(store.docs.get('copyConfig/memberB'), undefined, 'member B has no copy setup');
r = await go({ op: 'save', cfg: { ...cfgA, on: false } }); assert.equal(r.status, 200); r = await go({ op: 'save', cfg: cfgA }); assert.equal(r.status, 200, 'second turn-on: no new confirm');

// 2. fan-out
B.calls.length = 0;
r = await go(place());
assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.ok, true);
const posts = writes().filter((x) => x.m === 'POST');
assert.equal(posts.length, 3, 'leader + 2 live followers');
assert.equal(posts[0].p.includes(A1), true, 'leader first');
const byAcct = Object.fromEntries(posts.map((x) => [x.p.split('/')[4], x]));
assert.equal(byAcct[A2].body.order.symbol, 'MNQZ6'); assert.equal(byAcct[A2].body.order.orderQty, 1, 'x0.5 of 2 = 1, mapped to micro');
assert.equal(byAcct[A3].body.order.symbol, 'NQZ6'); assert.equal(byAcct[A3].body.order.orderQty, 2, 'fixed 2');
assert.ok(posts.every((x) => x.user === UA), 'every order on member A\'s own broker link');
assert.equal(new Set(posts.map((x) => x.key)).size, 3, 'each order its own idempotency key');
const res = Object.fromEntries(r.j.copy.results.map((x) => [x.id, x]));
assert.equal(res[A2].state, 'sent'); assert.equal(res[A3].state, 'sent');
assert.equal(res.paper.state, 'paper'); assert.equal(res.paper.paper.qty, 2, 'paper follower handed to the browser');
const rows = [...audits.values()].filter((x) => x.op === 'place');
assert.equal(rows.filter((x) => x.src === 'copy').length, 2, 'each follower order has its own audit row'); assert.equal(rows.filter((x) => x.src === 'chart').length, 1);
assert.ok(store.docs.get('copyLinks/memberA_' + A1 + '_' + r.j.orderId), 'leader order -> follower order links stored');

// modify + cancel reach the copies through the links
B.calls.length = 0;
const lid = r.j.orderId;
r = await go({ op: 'fan', lead: { op: 'cancel', accountId: A1, orderId: lid, idemKey: key() } });
assert.equal(r.status, 200); assert.equal(writes().filter((x) => x.m === 'DELETE').length, 3, 'cancel on the leader + both copies');

// 3. partial failure: A2 refused, A3 still gets its order
B.calls.length = 0; B.reject.add(A2);
r = await go(place());
assert.equal(r.status, 200);
{ const m = Object.fromEntries(r.j.copy.results.map((x) => [x.id, x])); assert.equal(m[A2].state, 'rejected'); assert.equal(m[A3].state, 'sent', 'one follower failing never blocks another'); }
B.reject.clear();
// leader refused = nothing copied
B.calls.length = 0; B.reject.add(A1);
r = await go(place());
assert.notEqual(r.status, 200); assert.equal(r.j.copy, undefined); assert.equal(writes().filter((x) => x.m === 'POST').length, 1, 'only the refused leader attempt');
B.reject.clear();

// 4. idempotency: the same leader key twice
const dupe = place();
r = await go(dupe); assert.equal(r.status, 200);
B.calls.length = 0;
r = await go(dupe); assert.equal(r.status, 409); assert.equal(r.j.code, 'duplicate'); assert.equal(writes().length, 0, 'a repeat reaches no broker');
// a follower key already used (e.g. the browser retried after a lost answer): that follower answers duplicate, nothing re-sent
{ const d2 = place(); const fk = C.copyKey(d2.lead.idemKey, A3); audits.set(fk, { pre: true }); B.calls.length = 0; r = await go(d2); const m = Object.fromEntries(r.j.copy.results.map((x) => [x.id, x])); assert.equal(m[A3].state, 'duplicate'); assert.ok(!writes().some((x) => x.p.includes(A3))); }

// 5. kill switches
globalOn = false; B.calls.length = 0;
r = await go(place()); assert.equal(r.status, 403); assert.equal(r.j.code, 'switched_off'); assert.equal(writes().length, 0, 'kill switch: nothing sent anywhere');
globalOn = true;
store.docs.set('settings/liveBlocked', { memberA: true }); OW._resetOwner(); B.calls.length = 0;
await new Promise((x) => setTimeout(x, 5100));   // the block doc is cached 5 s per isolate
r = await go(place()); assert.equal(r.status, 403); assert.equal(r.j.code, 'member_blocked'); assert.equal(writes().length, 0, 'member block: nothing sent');
store.docs.set('settings/liveBlocked', {}); await new Promise((x) => setTimeout(x, 5100));
// pause: the leader order still goes, nothing copied
r = await go({ op: 'pause' }); assert.equal(r.j.cfg.paused, true);
B.calls.length = 0; r = await go(place()); assert.equal(r.status, 200); assert.equal(r.j.copy.off, 'paused'); assert.equal(writes().filter((x) => x.m === 'POST').length, 1);
await go({ op: 'resume' });

// member B: fan with A's account as the leader -> refused (not theirs), nothing copied to anyone
B.calls.length = 0;
r = await go({ op: 'fan', lead: { op: 'place', accountId: A1, symbol: 'NQZ6', side: 'buy', qty: 1, type: 'market', idemKey: key() } }, 'memberB');
assert.equal(r.status, 403); assert.equal(r.j.code, 'not_owner'); assert.equal(writes().length, 0);
// member B with their own account as the leader: A's config is never used (B has none)
r = await go({ op: 'fan', lead: { op: 'place', accountId: B1, symbol: 'NQZ6', side: 'buy', qty: 1, type: 'market', idemKey: key() } }, 'memberB');
assert.equal(r.status, 200); assert.equal(writes().filter((x) => x.m === 'POST').length, 1, 'only B\'s own leader order'); assert.ok(writes().every((x) => x.user === UB));

// flatten all copied accounts
B.calls.length = 0;
r = await go({ op: 'flattenAll', symbol: 'NQZ6', idemKey: key() });
assert.equal(r.status, 200); assert.equal(r.j.copy.results.length, 3); assert.equal(r.j.copy.results.find((x) => x.id === 'paper').paper.op, 'flatten');
console.log('copy-trade tests: all passed');

// ADMIN ONLY gate: a signed-in non-admin member gets 403 copy_admin_only
{ const r = await go({ op: 'get' }, 'outsider'); assert.equal(r.status, 403); assert.equal(r.j.code || r.j.reason || r.j.error && 'x', r.j.code || r.j.reason || 'x'); assert.ok(JSON.stringify(r.j).includes('copy_admin_only'), 'non-admin refused'); console.log('ok admin-only gate'); }

// ADMIN OR BETA TESTER gate (Owner 23 Nov). Beta = verified email on settings/betaTesters, read with the same helper as /api/beta
// (functions/api/beta/_lib.js isBetaToken). Mocked service account + Firestore; nothing leaves this process.
{
  const sa = { client_email: 'sa@test', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const envB = { ...live, FIREBASE_SA_KEY: JSON.stringify(sa) };
  let listDown = false;
  const betaFetch = async (url) => {
    const u = String(url);
    if (u === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ access_token: 't', expires_in: 3000 }));
    if (u.includes('/documents/admins/')) return new Response('{}', { status: 404 });
    if (u.includes('/documents/settings/betaTesters')) return listDown ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ name: 'x/settings/betaTesters', fields: { emails: { arrayValue: { values: [{ stringValue: 'tester@example.com' }, { stringValue: 'unverified@example.com' }] } } } }));
    throw new Error('unmocked ' + u);
  };
  const dB = { ...deps, betaFetch };
  const reqE = (body, uid, email) => new Request('https://tradezoro.com/connect/finatic/copy', { method: 'POST', headers: { 'cf-connecting-ip': '10.8.' + (ip++ % 250) + '.1', origin: 'https://tradezoro.com', 'content-type': 'application/json', authorization: 'Bearer ' + token(uid, email) }, body: JSON.stringify(body) });
  const goE = async (uid, email) => { const r = await CP.handle(reqE({ op: 'get' }, uid, email), envB, dB); return { status: r.status, j: await r.json() }; };
  let r = await goE('memberA'); assert.equal(r.status, 200, 'admin ok'); console.log('ok gate: admin');
  r = await goE('betaC', 'Tester@Example.com'); assert.equal(r.status, 200, 'beta tester ok'); assert.equal(r.j.cfg.on, false); console.log('ok gate: beta tester');
  r = await goE('memberD', 'someone@example.com'); assert.equal(r.status, 403); assert.equal(r.j.code, 'copy_admin_only', 'normal member blocked'); console.log('ok gate: normal member blocked');
  r = await goE('memberE', 'unverified@example.com'); assert.equal(r.status, 403, 'listed but unverified email blocked'); console.log('ok gate: unverified email blocked');
  r = await goE('memberF'); assert.equal(r.status, 403, 'no email blocked');
  listDown = true; r = await goE('memberG', 'tester@example.com'); assert.equal(r.status, 403, 'list unreadable = blocked (fail closed)'); console.log('ok gate: fail closed');
}
