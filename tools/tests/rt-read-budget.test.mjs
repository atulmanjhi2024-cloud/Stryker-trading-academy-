// Firestore read budget for the live-data checks (24 Nov 2026 quota incident). Run: node tools/tests/rt-read-budget.test.mjs
// Throwaway RSA key, stubbed Google endpoints and a stub Cache API; no network.
import assert from 'node:assert/strict';
import * as M from '../../functions/api/chart/_rt.js';

const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64u = (b) => Buffer.from(b).toString('base64url');
async function mint(sub) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub, iat: now - 5, exp: now + 3600 }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(h + '.' + p));
  return h + '.' + p + '.' + b64u(sig);
}
const agreed = { marketDataAgreement: { mapValue: { fields: { version: { stringValue: M.MDA_VERSION }, nonProfessional: { booleanValue: true } } } } };
const students = { member: agreed, free: {}, pro: { plan: { stringValue: 'Pro' } } };
const admins = new Set(['boss']);
let reads = 0, down = false;
globalThis.fetch = async (url) => {
  url = String(url);
  if (url.includes('securetoken@system')) return new Response(JSON.stringify({ keys: [jwk] }));
  if (url.includes('/documents/plans')) return new Response(JSON.stringify({ documents: [{ name: 'x/plans/pro', fields: { rank: { integerValue: '1' }, name: { stringValue: 'Pro' } } }] }));
  reads++;
  if (down) return new Response('{"error":{"status":"RESOURCE_EXHAUSTED"}}', { status: 429 });
  const m = /documents\/(admins|students)\/([^?]+)/.exec(url); const uid = decodeURIComponent(m[2]);
  if (m[1] === 'admins') return admins.has(uid) ? new Response('{"fields":{}}') : new Response('{}', { status: 404 });
  return students[uid] ? new Response(JSON.stringify({ fields: students[uid] })) : new Response('{}', { status: 404 });
};
// stub Cache API (what Cloudflare gives a Pages function / worker on a custom domain), honours max-age
const store = new Map();
globalThis.caches = { default: {
  async match(k) { const e = store.get(String(k)); if (!e || Date.now() > e.exp) return undefined; return new Response(e.body); },
  async put(k, r) { const age = Number(/max-age=(\d+)/.exec(r.headers.get('cache-control') || '')[1]); store.set(String(k), { body: await r.text(), exp: Date.now() + age * 1000 }); },
} };
const settle = () => new Promise((r) => setTimeout(r, 5));
const tm = await mint('member'), tb = await mint('boss'), tf = await mint('free');

// 1. a member's bars request: admins/{uid} (404) + students/{uid} = 2 reads once
assert.equal(await M.isRealtimeToken(tm), true); await settle();
assert.equal(reads, 2, 'first check reads admin + student');
// 2. a NEW isolate (memo wiped, lastYes kept) answers from the shared cache: 0 reads
M._resetForTests(true); reads = 0;
assert.equal(await M.isRealtimeToken(tm), true);
assert.equal(reads, 0, 'second isolate: shared cache, no Firestore read');
// 3. "not admin" stays 10 min in the isolate: 20 calls over 9 min = 0 admin reads
{
  const real = Date.now, t0 = real(); reads = 0; let adminReads = 0;
  const f0 = globalThis.fetch; globalThis.fetch = async (u, i) => { if (String(u).includes('/admins/')) adminReads++; return f0(u, i); };
  try { for (let i = 0; i < 20; i++) { Date.now = () => t0 + i * 27000; await M.isAdminToken(tm); } } finally { Date.now = real; globalThis.fetch = f0; }
  assert.equal(adminReads, 0, 'no admin re-read inside 10 min');
}
// 4. admin stays admin across isolates; an outage is never written to the shared cache
assert.equal(await M.isAdminToken(tb), true); await settle();
M._resetForTests(true); reads = 0;
assert.equal(await M.isAdminToken(tb), true); assert.equal(reads, 0, 'admin from shared cache');
store.clear(); M._resetForTests(true); down = true;
const out = {}; assert.equal(await M.isAdminToken(tb, { out }), true, 'outage keeps a confirmed admin'); assert.equal(out.outage, true);
assert.equal([...store.keys()].length, 0, 'outage not stored');
down = false;
// 5. fresh (what /api/chart/rt sends): a cached "no" is re-read, so a member who just signed goes live at once
store.clear(); M._resetForTests();
assert.equal(await M.isRealtimeToken(tf), false); await settle();
students.free = agreed; reads = 0;
assert.equal(await M.isRealtimeToken(tf), false, 'non-fresh: cached no inside its 30-45 s');
assert.equal(await M.isRealtimeToken(tf, { fresh: true }), true, 'fresh: read again, now live');
assert.ok(reads >= 1);
// 6. switching a member off bites within ~5 min (shared yes), a "no" is short (45 s) and /api/chart/rt is always fresh
assert.ok(M._sharedForTests.TTL.rt1 <= 300 && M._sharedForTests.TTL.rt0 <= 60, "switch-off within 5 min, a no stays short");
// 7. no Cache API (tests, workers.dev): plain behaviour, no throw
delete globalThis.caches; M._resetForTests();
assert.equal(await M.isRealtimeToken(tm), true);
console.log('rt-read-budget: all ok');
