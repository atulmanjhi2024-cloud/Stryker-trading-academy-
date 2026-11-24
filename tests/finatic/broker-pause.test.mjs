// BROKER PAUSE (Owner 23 Nov 2026 + follow-up): while assets/broker-pause.js BROKERS_PAUSED is on, normal members are refused on every
// /connect/finatic/* route (403 brokers_paused); admins and beta testers (verified email on settings/betaTesters, checked through the
// real functions/api/beta/_lib.js isBetaToken with Firestore mocked) pass. The global kill switch settings/liveTrading stays separate:
// off = every order refused for everyone, admins and beta testers too. NO network, NO real order: the broker is the finFetch stub.
// Run: node tests/finatic/broker-pause.test.mjs
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import * as O from '../../functions/connect/finatic/order.js';
import * as D from '../../functions/connect/finatic/data.js';
import * as S from '../../functions/connect/finatic/session.js';
import * as C from '../../functions/connect/finatic/copy.js';
import * as P from '../../functions/connect/finatic/_pause.js';
import { BROKERS_PAUSED } from '../../assets/broker-pause.js';
import { memStore } from './_store.mjs';

assert.equal(BROKERS_PAUSED, true, 'the pause flag is on in this branch');
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (uid, email, verified = true) => { const now = Math.floor(Date.now() / 1000); const h = b64({ alg: 'RS256', kid: 'k1' }), p = b64({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: uid, email, email_verified: verified, iat: now - 5, exp: now + 3000 }); return h + '.' + p + '.' + createSign('RSA-SHA256').update(h + '.' + p).sign(privateKey).toString('base64url'); };
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const verifyFetch = async (url) => { if (String(url).includes('jwk/securetoken')) return new Response(JSON.stringify({ keys: [jwk] })); return /admins\/admin1$/.test(String(url)) ? new Response('{}') : new Response('{}', { status: 404 }); };
// Firestore for the beta check (service account token + settings/betaTesters + admins/{uid}). Sample data.
let listDown = false;
const betaFetch = async (url) => {
  const u = String(url);
  if (u.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'sa', expires_in: 3600 }));
  if (u.endsWith('/admins/admin1')) return new Response(JSON.stringify({ name: 'x/admins/admin1', fields: {} }));
  if (/\/admins\//.test(u)) return new Response('{}', { status: 404 });
  if (u.endsWith('/settings/betaTesters')) return listDown ? new Response('{}', { status: 503 }) : new Response(JSON.stringify({ name: 'x/settings/betaTesters', fields: { emails: { arrayValue: { values: [{ stringValue: 'tester@example.com' }] } } } }));
  return new Response('{}', { status: 404 });
};
const { privateKey: saKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = JSON.stringify({ client_email: 'sa@example.iam.gserviceaccount.com', private_key: saKey.export({ type: 'pkcs8', format: 'pem' }) });

const ACC = '11111111-e89b-12d3-a456-426614174000';
const B = { calls: [] };
const ok = (data) => new Response(JSON.stringify({ data, errors: [] }), { status: 200 });
const finFetch = async (url, init) => {
  const p = new URL(url).pathname; B.calls.push({ m: init.method, p });
  if (p === '/api/v1/session/init') return ok({ one_time_token: 'ott' });
  if (p === '/api/v1/session/start') return ok({ session_id: 'sess', company_id: 'c', status: 'pending', user_id: '' });
  if (p === '/api/v1/session/portal') return ok({ portal_url: 'https://portal.example/?t=x' });
  return ok([]);
};
let globalOn = true;
const deps = { store: memStore({ consent: ['admin1', 'tester1', 'member1'] }), verifyFetch, betaFetch, finFetch, audit: async () => ({ finish: async () => {} }), brackets: new Map(), liveSwitch: async () => globalOn, sleep: async () => {} };
const env = { FINATIC_API_KEY: 'fntc_live_FAKE', FINATIC_LIVE_ORDERS: '1', DEV: '0', FIREBASE_SA_KEY: SA };
const WHO = { admin: ['admin1', 'admin@example.com'], beta: ['tester1', 'Tester@Example.com'], member: ['member1', 'member@example.com'] };
let ip = 1;
const go = async (h, path, body, who, verified = true) => {
  const [uid, email] = WHO[who];
  const r = await h.handle(new Request('https://tradezoro.com/connect/finatic/' + path, { method: 'POST', headers: { 'cf-connecting-ip': '10.9.' + (ip++ % 250) + '.1', origin: 'https://tradezoro.com', 'content-type': 'application/json', authorization: 'Bearer ' + token(uid, email, verified) }, body: JSON.stringify(body) }), env, deps);
  return { status: r.status, j: await r.json() };
};
const place = (n) => ({ src: 'chart', op: 'place', accountId: ACC, symbol: 'MNQZ6', side: 'buy', qty: 1, type: 'market', idemKey: 'p' + String(n).padStart(20, '0') });
const ROUTES = [[S, 'session', { mode: 'dark' }], [D, 'data', { op: 'accounts' }], [O, 'order', { op: 'env', src: 'chart' }], [O, 'order', place(1)], [C, 'copy', { op: 'list' }]];

// 1. normal member: every broker route refused, nothing reaches the broker
for (const [h, path, body] of ROUTES) {
  const c0 = B.calls.length, r = await go(h, path, body, 'member');
  assert.equal(r.status, 403, 'member ' + path + ' ' + body.op); assert.equal(r.j.code, 'brokers_paused'); assert.equal(B.calls.length, c0, 'no broker call for a member');
}
// an unverified email that matches the list is NOT beta
P._resetPause(); { const r = await go(S, 'session', { mode: 'dark' }, 'beta', false); assert.equal(r.status, 403); assert.equal(r.j.code, 'brokers_paused'); }
// list unreadable = refused (fails closed)
P._resetPause(); listDown = true; { const r = await go(D, 'data', { op: 'accounts' }, 'beta'); assert.equal(r.j.code, 'brokers_paused'); } listDown = false; P._resetPause();

// 2. admin and beta tester: not paused (session starts, data reads, env answers, the order passes the pause and reaches the broker stub)
for (const who of ['admin', 'beta']) {
  let r = await go(S, 'session', { mode: 'dark' }, who); assert.equal(r.status, 200, who + ' session'); assert.ok(r.j.portalUrl);
  r = await go(D, 'data', { op: 'accounts' }, who); assert.notEqual(r.j.code, 'brokers_paused', who + ' data');
  r = await go(O, 'order', { op: 'env', src: 'chart' }, who); assert.equal(r.status, 200, who + ' env'); assert.equal(r.j.enabled !== false, true);
  r = await go(O, 'order', place(who === 'admin' ? 2 : 3), who); assert.notEqual(r.j.code, 'brokers_paused', who + ' order not paused'); assert.notEqual(r.j.code, 'switched_off');
}
// copy trading = admin OR beta tester: a beta tester gets past both the pause and the copy gate (not brokers_paused, not copy_admin_only)
{ const r = await go(C, 'copy', { op: 'list' }, 'beta'); assert.notEqual(r.j.code, 'brokers_paused'); assert.notEqual(r.j.code, 'copy_admin_only'); }

// 3. emergency stop settings/liveTrading off: every order refused for everyone, admin and beta tester too
globalOn = false;
for (const [who, n] of [['admin', 4], ['beta', 5]]) { const c0 = B.calls.filter((x) => x.m === 'POST' && x.p.endsWith('/orders')).length; const r = await go(O, 'order', place(n), who); assert.equal(r.status, 403, who + ' kill switch'); assert.equal(r.j.code, 'switched_off'); assert.equal(B.calls.filter((x) => x.m === 'POST' && x.p.endsWith('/orders')).length, c0); }
{ const r = await go(O, 'order', place(6), 'member'); assert.equal(r.status, 403); }
globalOn = true;

// 4. flag off = members pass the pause again (back to normal)
{ const d2 = { ...deps, brokersPaused: false }; const r = await S.handle(new Request('https://tradezoro.com/connect/finatic/session', { method: 'POST', headers: { 'cf-connecting-ip': '10.9.200.2', origin: 'https://tradezoro.com', 'content-type': 'application/json', authorization: 'Bearer ' + token('member1', 'member@example.com') }, body: '{"mode":"dark"}' }), env, d2); assert.equal(r.status, 200); }
console.log('broker-pause: member refused on every route, admin + beta allowed, kill switch stops everyone, flag off = normal: PASS');
