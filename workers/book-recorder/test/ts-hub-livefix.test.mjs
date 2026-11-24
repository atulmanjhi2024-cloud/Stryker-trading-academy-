// LIVEFIX (Owner bug 24 Nov 2026): the Owner (admin) saw "10 min delayed" + the paid-feed popup on MNQ1! while the hub was live and had
// revoked 71 sockets. Two causes, both reproduced here with the REAL gate (src/rt-auth.js + src/ts-access.js) and a fake Google / Firestore:
//   1. the hub's 60 s re-check re-used the ID token captured at connect; Firebase expires it after 1 h -> null -> 4003 'access ended'
//   2. Firestore answered 429 RESOURCE_EXHAUSTED (daily quota) to every read -> admin / Pro read as "no" -> 4003, and the page fell to delayed
// Rules proven: only a VALID token with a DEFINITE "no" revokes; an expired token asks the page for a fresh one ({event:'auth_needed'} ->
// {op:'auth', token}); an outage keeps the tier; a free member is still refused / revoked; /ts-health counts each case.
// node workers/book-recorder/test/ts-hub-livefix.test.mjs
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { TSHub } from '../src/ts-hub.js';
import * as TA from '../src/ts-access.js';
import * as RT from '../src/rt-auth.js';

let n = 0; const ok = (m) => { n++; console.log('PASS', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class FakeWS { constructor() { this.l = {}; } addEventListener(e, f) { (this.l[e] = this.l[e] || []).push(f); } send() {} close() {} }
const memStore = () => ({ putMin() {}, prune() {}, range() { return []; } });
const client = () => { const c = { got: [], closed: null, send(s) { c.got.push(JSON.parse(s)); }, close(code) { c.closed = code; } }; return c; };

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'k1', alg: 'RS256', use: 'sig' });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// exp relative to now (s): 3000 = a fresh token, -5 = expired 5 s ago (Firebase ID tokens live 1 h)
const tok = (uid, exp = 3000) => { const now = Math.floor(Date.now() / 1000); const h = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' }), p = b64({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: uid, iat: now - 3600 + Math.max(0, exp), exp: now + exp }); return h + '.' + p + '.' + createSign('RSA-SHA256').update(h + '.' + p).sign(privateKey).toString('base64url'); };
const docs = { pro1: { plan: { stringValue: 'pro' } }, free1: { plan: { stringValue: 'free' } } };
let fs = 'up';   // 'up' | 'quota' (429 like 24 Nov) | 'billing' (403 without PERMISSION_DENIED)
let reads = 0;
const fetchImpl = async (url) => {
  url = String(url);
  if (/jwk/.test(url)) return Response.json({ keys: [jwk] });
  reads++;
  if (fs === 'quota') return new Response(JSON.stringify({ error: { code: 429, message: 'Quota exceeded.', status: 'RESOURCE_EXHAUSTED' } }), { status: 429 });
  if (fs === 'billing') return new Response(JSON.stringify({ error: { code: 403, status: 'FAILED_PRECONDITION' } }), { status: 403 });
  if (/admins\/adm1/.test(url)) return Response.json({ name: 'x' });
  if (/admins\//.test(url)) return new Response('{}', { status: 404 });
  if (/plans/.test(url)) return Response.json({ documents: [{ name: 'p/pro', fields: { rank: { integerValue: '1' } } }] });
  const m = /students\/(\w+)/.exec(url); if (m) return docs[m[1]] ? Response.json({ fields: docs[m[1]] }) : new Response('{}', { status: 404 });
  return new Response('{}', { status: 404 });
};
const P = { TS_ACCESS: 'pro' };
// the hub's gate exactly as production wires it (tsHubFetch: tierOf = tsTierWhy; before the fix: tsTier), with the fake Google behind it
const gate = TA.tsTierWhy || TA.tsTier;
const mk = (o = {}) => new TSHub(memStore(), 'SECRETKEY', Object.assign({ WebSocket: FakeWS, now: () => Date.now(), RECORD: false, RECHECK_MS: 40, FLUSH_MS: 10, MIN_GAP_MS: 20, IDLE_MS: 60000, tierOf: (env, t) => gate(env, t, { fetchImpl }) }, o));
const who = (uid, t) => ({ tok: t, env: P, exp: JSON.parse(Buffer.from(t.split('.')[1], 'base64url')).exp, uid });
const reset = (keepYes) => { RT._resetForTests(keepYes); fs = 'up'; };

// ---- 1. admin socket, token expires mid-session -> must stay live, page asked for a fresh token (before: closed 4401 at exp and reconnected)
if (!process.env.ONLY_OUTAGE) {
  reset(); const hub = mk(); const a = client();
  const t = tok('adm1', -5);   // the token captured at connect has since expired
  hub.attach(a, 'MNQ', 60, 'book', who('adm1', t)); hub.startTimer(); await sleep(250);
  assert.equal(a.closed, null, 'admin with an expired token is NOT closed (was 4003 access ended)');
  assert.equal([...hub.clients].find((c) => c.sock === a).book, true, 'still the book tier');
  assert.ok(a.got.some((m) => m.event === 'auth_needed'), 'page told to send a fresh token');
  assert.equal(hub.stats().revoked || 0, 0); assert.ok(hub.stats().keptExpired >= 1, 'counted as keptExpired');
  // the page answers with a refreshed token: accepted, tier re-confirmed
  const h = [...hub.clients].find((c) => c.sock === a);
  const fresh = tok('adm1', 3000);
  hub.reauth(h, fresh); await sleep(60);
  assert.equal(h.who.tok, fresh, 'fresh token swapped in'); assert.equal(hub.stats().authOk, 1);
  await sleep(150); assert.equal(a.closed, null); assert.equal(h.book, true);
  hub.shutdown(); ok('admin: expired token mid-session keeps the book, auth_needed sent, {op:auth} with a fresh token accepted');
}
// ---- 2. Firestore quota outage (24 Nov: 429 on every read): confirmed admin / Pro stay live; nobody is revoked on an outage
{
  reset(); const hub = mk(); const a = client(), p = client();
  for (const u of ['adm1', 'pro1']) { const g = await gate(P, tok(u), { fetchImpl }); assert.equal(g && g.tier !== undefined ? g.tier : g, 'book', u + ' confirmed once (Firestore up)'); }
  RT._resetForTests(true);
  hub.attach(a, 'NQ', 60, 'book', who('adm1', tok('adm1'))); hub.attach(p, 'NQ', 60, 'book', who('pro1', tok('pro1')));
  fs = 'quota'; hub.startTimer(); await sleep(300);
  assert.equal(a.closed, null, 'admin NOT revoked by a 429 quota outage'); assert.equal(p.closed, null, 'Pro member NOT revoked by a 429 quota outage');
  assert.equal(hub.stats().revoked || 0, 0); assert.ok(hub.stats().keptOutage >= 1, 'counted as keptOutage');
  fs = 'billing'; await sleep(200); assert.equal(a.closed, null, 'a 403 that is not PERMISSION_DENIED is an outage too');
  hub.shutdown(); ok('Firestore 429 / odd 403: open admin + Pro sockets kept (keptOutage), none revoked');
}
// ---- 3. the gate itself: a confirmed yes survives an outage, a never-confirmed user still fails closed, an outage is never a cached "no"
if (TA.tsTierWhy) {
  reset();
  assert.deepEqual(await TA.tsTierWhy(P, tok('adm1'), { fetchImpl }), { tier: 'book', why: 'ok' });
  assert.deepEqual(await TA.tsTierWhy(P, tok('pro1'), { fetchImpl }), { tier: 'book', why: 'ok' });
  assert.deepEqual(await TA.tsTierWhy(P, tok('free1'), { fetchImpl }), { tier: null, why: 'no' }, 'free member: a definite no');
  RT._resetForTests(true); fs = 'quota';
  assert.deepEqual(await TA.tsTierWhy(P, tok('adm1'), { fetchImpl }), { tier: 'book', why: 'outage' }, 'admin kept through the quota outage');
  assert.deepEqual(await TA.tsTierWhy(P, tok('pro1'), { fetchImpl }), { tier: 'book', why: 'outage' }, 'Pro kept through the quota outage');
  assert.deepEqual(await TA.tsTierWhy(P, tok('free1'), { fetchImpl }), { tier: null, why: 'outage' }, 'free member: unknown, still no tier (fails closed)');
  assert.deepEqual(await TA.tsTierWhy(P, tok('stranger'), { fetchImpl }), { tier: null, why: 'outage' }, 'never-confirmed uid: no tier during an outage');
  assert.equal(await RT.isAdminToken(tok('stranger'), { fetchImpl }), false);
  fs = 'up'; assert.equal(await RT.isAdminToken(tok('adm1'), { fetchImpl }), true, 'outage answer was not memoised as a no');
  assert.deepEqual(await TA.tsTierWhy(P, tok('adm1', -5), { fetchImpl }), { tier: null, why: 'expired' });
  assert.deepEqual(await TA.tsTierWhy(P, 'a.b.c', { fetchImpl }), { tier: null, why: 'invalid' });
  // 403 PERMISSION_DENIED from the rules is a definite no
  const denied = async (u) => (/jwk/.test(String(u)) ? Response.json({ keys: [jwk] }) : new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED' } }), { status: 403 }));
  RT._resetForTests(); assert.equal(await RT.isAdminToken(tok('adm1'), { fetchImpl: denied }), false);
  ok('gate: last confirmed yes kept through an outage, unknown users fail closed, outage never cached as no, expired / invalid told apart');
}
// ---- 4. a FREE member is still refused / revoked (definite no from a valid token); counters split no vs expired
{
  reset(); const hub = mk(); const f = client();
  hub.attach(f, 'NQ', 60, 'book', who('free1', tok('free1'))); hub.startTimer(); await sleep(200);
  assert.equal(f.closed, 4003, 'free member on a valid token + definite no: closed 4003');
  const s = hub.stats(); assert.equal(s.revoked, 1); if (TA.tsTierWhy) assert.equal(s.revokedNo, 1);
  hub.shutdown(); ok('free member: revoked on a definite no (revokedNo)');
}
if (TA.tsTierWhy) {
  // ---- 5. {op:'auth'} hardening: another uid's token closes the socket; an older / same token does nothing; past exp + grace = 4401
  reset(); let hub = mk(); const a = client();
  const h = hub.attach(a, 'NQ', 60, 'book', who('adm1', tok('adm1', 1000)));
  h.onMessage(JSON.stringify({ op: 'auth', token: tok('adm1', 500) })); await sleep(40); assert.equal(hub.stats().authOk, 0, 'older token ignored');
  h.onMessage(JSON.stringify({ op: 'auth', token: tok('pro1', 3000) })); await sleep(40);
  assert.equal(a.closed, 4401, 'token of another uid: closed, identity never switched'); hub.shutdown();
  reset(); hub = mk({ AUTH_GRACE_MS: 100 }); const e = client();
  hub.attach(e, 'NQ', 60, 'book', who('adm1', tok('adm1', -1))); hub.startTimer(); await sleep(300);
  assert.equal(e.closed, 4401, 'expired and never refreshed past the grace: 4401 (page reconnects with a fresh token)');
  assert.ok(hub.stats().closedToken >= 1); hub.shutdown();
  // ---- 6. vouch: a socket that connects during an outage gets only the tier this uid had (hub memory), else refused
  reset(); hub = mk(); const v = client();
  hub.attach(v, 'NQ', 60, 'book', who('adm1', tok('adm1')));
  assert.equal(hub.vouched('adm1'), 'book'); assert.equal(hub.vouched('free1'), null); assert.equal(hub.vouched(''), null);
  const st = hub.stats(); for (const k of ['revokedNo', 'keptExpired', 'keptOutage', 'authOk', 'authBad', 'closedToken', 'vouched', 'vouchRefused']) assert.equal(typeof st[k], 'number', '/ts-health has ' + k);
  hub.shutdown();
  // the last definite tier is in the Durable Object's storage too: a restart (deploy) during an outage still vouches; a definite no forgets it
  const yes = new Map(), st2 = Object.assign(memStore(), { putYes: (u, t, at) => yes.set(u, { tier: t, at }), getYes: (u) => yes.get(u) || null, dropYes: (u) => yes.delete(u) });
  reset(); let h1 = new TSHub(st2, 'K', { WebSocket: FakeWS, RECORD: false, RECHECK_MS: 40, FLUSH_MS: 10, tierOf: (env, t) => gate(env, t, { fetchImpl }) });
  h1.attach(client(), 'NQ', 60, 'book', who('pro1', tok('pro1'))); h1.shutdown();
  const h2 = new TSHub(st2, 'K', { WebSocket: FakeWS, RECORD: false });
  assert.equal(h2.vouched('pro1'), 'book', 'vouch survives a restart'); assert.equal(h2.vouched('free1'), null);
  h2.forgetYes('pro1'); assert.equal(yes.has('pro1'), false, 'a definite no drops the stored yes'); h2.shutdown();
  hub.shutdown(); ok('op:auth: uid swap closes, replay ignored, expiry + grace closes 4401; vouch = last known tier only; /ts-health counters present');
}
console.log(n + ' checks passed');
