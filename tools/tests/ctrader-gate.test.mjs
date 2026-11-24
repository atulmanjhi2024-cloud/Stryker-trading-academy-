// Owner bug 24 Nov: "BUY 0.01 lots GBPCHF MARKET (Scalp) refused: Live cTrader trading is for admins and beta testers only right now."
// on the Owner's (admin) LIVE cTrader account, on a socket that had opened fine. Tests for the cause and the fix, all MOCKED (Google
// token, Firestore, cTrader sockets): no network, nothing ever reaches cTrader. Run: node tools/tests/ctrader-gate.test.mjs
//   cause 1: every write re-read admin/beta + switch + consent + block (+ lock, audit) from Firestore inside ONE long-lived WebSocket
//            request; each fetch is a Cloudflare subrequest (Workers Free: 50 per request). Past the cap every fetch throws.
//   cause 2: the per-write check turned ANY error in that admin/beta read into 'not_admin' (the "admins and beta testers" message).
//   (the 1 h Firebase ID token is NOT a cause: the reads use the service account; only the token's email claims are used)
import assert from 'node:assert/strict';
import { webcrypto as C } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = C;
const { scenario } = await import('./ctrader-gate-repro.mjs');
const { gateCache, GATE_TTL, WRITE_COST, MSG, tradeHooks } = await import('../../functions/connect/ctrader/_trade.js');
const { mayTrade, counter, SUBREQ_BUDGET } = await import('../../functions/connect/ctrader/trade.js');
const { accessFor, _resetTok } = await import('../../functions/api/beta/_lib.js');
const { createRelay } = await import('../../functions/connect/ctrader/_relay.js');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const ADMIN_MSG = /admins and beta testers/;

// ---- the reproduction: the real endpoint, a socket that lives on, orders over time ----
await t('repro (Workers Free cap 50, an order every 30 s): no write is ever refused as not_admin; the socket renews before the cap', async () => {
  const r = await scenario({ limit: 50, minutes: 10, orderEverySec: 30, reopen: true });
  try {
    assert.equal(r.connect, 101);
    assert.equal(r.events.length, 20); assert.ok(r.events.every((e) => e.sent === 1), JSON.stringify(r.summary()));
    assert.ok(r.maxUsed < 50, 'never reaches the platform cap (max ' + r.maxUsed + ')');
    assert.ok(r.sockets.length > 1 && r.sockets.slice(0, -1).every((s) => /^4001 renew/.test(s.end)), 'old sockets end with the clean renew close');
  } finally { r.done(); }
});
await t('repro (chart open 1 h, an order every 15 min, cap 50): every order goes; old code was refused at min 30', async () => {
  const r = await scenario({ limit: 50, minutes: 59, orderEverySec: 900, reopen: true });
  try { assert.deepEqual(r.summary(), { sent: 3 }); assert.ok(r.maxUsed < 50); } finally { r.done(); }
});
await t('without the browser reopening, the socket still never hits the cap: it ends cleanly (4001) instead of failing orders', async () => {
  const r = await scenario({ limit: 50, minutes: 30, orderEverySec: 30, reopen: false });
  try {
    assert.ok(r.maxUsed < 50, 'max ' + r.maxUsed); assert.match(r.closed, /^4001 renew/);
    assert.ok(r.events.every((e) => e.sent === 1 || e.refused === 'renew'), JSON.stringify(r.summary()));
    assert.ok(!r.events.some((e) => e.refused === 'not_admin'));
  } finally { r.done(); }
});
await t('a paid plan can raise the budget (CTRADER_SUBREQ_BUDGET): fewer renewals, never past it', async () => {
  const r = await scenario({ limit: 1000, minutes: 20, orderEverySec: 30, reopen: true, env: { CTRADER_SUBREQ_BUDGET: '400' } });
  try { assert.equal(r.sockets.length, 1, 'one socket for 20 min'); assert.deepEqual(r.summary(), { sent: 40 }); } finally { r.done(); }
});
await t('ONE Firestore 503 on the admin read at order time: the admin is not refused (retried; cached yes for 5 min)', async () => {
  const r = await scenario({ limit: 1e9, minutes: 3, orderEverySec: 60, adminFailAt: 2, reopen: true });
  try { assert.deepEqual(r.summary(), { sent: 3 }); } finally { r.done(); }
});
await t('Firestore down for the admin read at connect: 503 gate_unreadable "couldn’t confirm", not "admins and beta testers only"', async () => {
  const r = await scenario({ limit: 1e9, minutes: 1, adminDown: true });
  try { assert.equal(r.connect, 503); assert.equal(r.connectBody.code, 'gate_unreadable'); assert.equal(r.connectBody.error, 'Couldn’t confirm your trading access just now. Nothing was sent. Try again.'); assert.doesNotMatch(r.connectBody.error, ADMIN_MSG); } finally { r.done(); }
});
await t('a REAL "not admin, not beta" answer still says the admin/beta message (403 not_admin)', async () => {
  const r = await scenario({ limit: 1e9, minutes: 1, notAdmin: true });
  try { assert.equal(r.connect, 403); assert.equal(r.connectBody.code, 'not_admin'); assert.match(r.connectBody.error, ADMIN_MSG); } finally { r.done(); }
});

// ---- the strict access check (was: betaFor -> isAdminUid swallowed a read error as "not admin") ----
const FSB = 'https://firestore.googleapis.com/v1/projects/strykertrades-e0cd8/databases/(default)/documents/';
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
const SAENV = { FIREBASE_SA_KEY: JSON.stringify({ client_email: 'sa@test', private_key: '-----BEGIN PRIVATE KEY-----\n' + der + '\n-----END PRIVATE KEY-----' }) };
const fsMock = (docs, fail = {}) => { const calls = []; const f = async (url) => { url = String(url); calls.push(url); const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
  if (url.startsWith('https://oauth2.googleapis.com/token')) return J({ access_token: 'x', expires_in: 3000 });
  const path = url.slice(FSB.length).split('?')[0]; if (fail[path] > 0) { fail[path]--; return J({}, 503); }
  return docs[path] ? J({ name: 'x/' + path, fields: docs[path] }) : J({}, 404); }; f.calls = calls; return f; };
const tokOf = (o) => 'h.' + Buffer.from(JSON.stringify(o)).toString('base64url') + '.s';
await t('accessFor: admin from admins/{uid}; beta from a verified listed email; a failed read is retried once, then THROWS (never "no")', async () => {
  const list = { 'settings/betaTesters': { emails: { arrayValue: { values: [{ stringValue: 'tester@example.com' }] } } } };
  _resetTok(); assert.deepEqual(await accessFor(SAENV, { uid: 'a', email: 'x@example.com', verified: true }, { fetchImpl: fsMock({ 'admins/a': {} }) }), { admin: true, beta: true });
  assert.deepEqual(await accessFor(SAENV, { uid: 'b', email: 'tester@example.com', verified: true }, { fetchImpl: fsMock(list) }), { admin: false, beta: true });
  assert.deepEqual(await accessFor(SAENV, { uid: 'b', email: 'tester@example.com', verified: false }, { fetchImpl: fsMock(list) }), { admin: false, beta: false });
  assert.deepEqual(await accessFor(SAENV, { uid: 'a', email: '', verified: true }, { fetchImpl: fsMock({ 'admins/a': {} }, { 'admins/a': 1 }) }), { admin: true, beta: true }, 'one blip: retried');
  await assert.rejects(accessFor(SAENV, { uid: 'a', email: '', verified: true }, { fetchImpl: fsMock({ 'admins/a': {} }, { 'admins/a': 2 }) }), 'two failures: throws');
  await assert.rejects(mayTrade(SAENV, tokOf({ email: 'x@example.com', email_verified: true }), 'a', { betaFetch: fsMock({ 'admins/a': {} }, { 'admins/a': 9 }) }));
});
await t('mayTrade does not depend on the ID token being fresh (a token past its 1 h exp still gives the same answer: SA reads)', async () => {
  _resetTok(); const old = tokOf({ email: 'x@example.com', email_verified: true, exp: 1 });
  assert.equal(await mayTrade(SAENV, old, 'a', { betaFetch: fsMock({ 'admins/a': {} }) }), true);
});

// ---- the per-socket gate cache ----
await t('gate cache: a yes is kept (admin 5 min, switch / consent / block 30 s); a no and an error are never kept', async () => {
  let clock = 0, reads = { isAdmin: 0, switchOn: 0, consent: 0, blocked: 0 }; const val = { isAdmin: true, switchOn: true, consent: true, blocked: false }, err = {};
  const read = Object.fromEntries(Object.keys(reads).map((k) => [k, async () => { reads[k]++; if (err[k]) throw new Error('503'); return val[k]; }]));
  const c = gateCache(read, { now: () => clock });
  assert.deepEqual(GATE_TTL, { isAdmin: 300000, switchOn: 30000, consent: 30000, blocked: 30000 });
  for (const k of Object.keys(reads)) await c.get(k);
  clock = 29000; for (const k of Object.keys(reads)) await c.get(k);
  assert.deepEqual(reads, { isAdmin: 1, switchOn: 1, consent: 1, blocked: 1 }, 'all from the cache');
  clock = 31000; await c.get('switchOn'); await c.get('isAdmin'); assert.equal(reads.switchOn, 2); assert.equal(reads.isAdmin, 1);
  clock = 301000; await c.get('isAdmin'); assert.equal(reads.isAdmin, 2);
  val.switchOn = false; clock = 400000; assert.equal(await c.get('switchOn'), false); assert.equal(await c.get('switchOn'), false); assert.equal(reads.switchOn, 4, 'a NO (switched off) is re-read every time');
  val.blocked = true; clock = 500000; assert.equal(await c.get('blocked'), true); await c.get('blocked'); assert.equal(reads.blocked, 3, 'blocked is re-read every time');
  err.consent = true; clock = 600000; await assert.rejects(c.get('consent')); await assert.rejects(c.get('consent')); assert.equal(reads.consent, 3, 'an error is never cached');
  err.consent = false; assert.equal(await c.get('consent'), true);
  // warm(): re-reads only entries past 60 % of their life, in the background, swallowing errors
  const before = reads.consent; clock += 10000; await c.warm(['consent']); assert.equal(reads.consent, before, 'still fresh');
  clock += 10000; await c.warm(['consent']); assert.equal(reads.consent, before + 1, 'refreshed at 20 s of 30');
  err.consent = true; clock += 20000; await c.warm(['consent']); err.consent = false;
  // an admin removed from admins/{uid}: the cached yes lasts at most 5 min, then the next read says no
  val.isAdmin = false; clock += GATE_TTL.isAdmin + 1; assert.equal(await c.get('isAdmin'), false);
});

// ---- the write path with a subrequest budget (pure hooks) ----
const f = (o) => JSON.stringify(o); const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };
function hooked({ left = 100, cap = false, isAdmin = async () => true } = {}) {
  const c = [], u = [], st = { cc: null }, B = { left: () => left, capHit: () => cap };
  const lockDoc = { v: null };
  const g = { isAdmin, switchOn: async () => true, consent: async () => true, blocked: async () => false, budget: B,
    audit: async (e, id) => ({ id, finish: async () => {} }), patchAudit: async () => {},
    lock: { take: async (k) => { if (lockDoc.v) return lockDoc.v; lockDoc.v = { key: k, at: 1 }; return true; }, peek: async () => lockDoc.v, release: async (k) => { if (lockDoc.v && lockDoc.v.key === k) lockDoc.v = null; } }, defer: (p) => p.catch(() => {}) };
  const hooks = tradeHooks({ uid: 'u', account: 77, envName: 'live', g });
  const r = createRelay({ client: { send: (x) => c.push(JSON.parse(x)), close: (code, why) => { st.cc = st.cc || code + ' ' + why; } }, up: { send: (x) => u.push(JSON.parse(x)), close: () => {} }, clientId: 'C', clientSecret: 'SECRET-xyz-123', hooks });
  hooks.bind(r);
  r.start(); r.onUp(f({ payloadType: 2101 })); r.onClient(f({ clientMsgId: 'a1', payloadType: 2149, payload: { accessToken: 'ACCESSTOKEN1' } }));
  r.onUp(f({ clientMsgId: 'a1', payloadType: 2150, payload: { permissionScope: 1, ctidTraderAccount: [{ ctidTraderAccountId: 77, isLive: true }] } }));
  r.onClient(f({ clientMsgId: 'a2', payloadType: 2102, payload: { ctidTraderAccountId: 77, accessToken: 'ACCESSTOKEN1' } }));
  r.onUp(f({ clientMsgId: 'a2', payloadType: 2103, payload: { ctidTraderAccountId: 77 } }));
  r.onUp(f({ payloadType: 2117, payload: { ctidTraderAccountId: 77, symbol: [{ symbolId: 1, minVolume: 100000, maxVolume: 1e10, stepVolume: 100000, lotSize: 10000000 }] } }));
  const set = (o) => { if ('left' in o) left = o.left; if ('cap' in o) cap = o.cap; };
  return { r, c, u, st, hooks, set, lockDoc, order: (key) => r.onClient(f({ clientMsgId: key, payloadType: 2106, payload: { ctidTraderAccountId: 77, symbolId: 1, orderType: 1, tradeSide: 1, volume: 100000 } })) };
}
const KEY = 'k-0123456789abcdef';
await t('budget too low for one whole write: refused "renew" (nothing sent, no lock, no audit) and the socket ends cleanly with 4001', async () => {
  const m = hooked({ left: WRITE_COST - 1 }); m.order(KEY); await flush();
  assert.equal(m.u.filter((x) => x.payloadType === 2106).length, 0); const rf = m.c.find((x) => x.relay === 'refused');
  assert.equal(rf.code, 'renew'); assert.equal(rf.error, MSG.renew); assert.match(rf.error, /Nothing was sent/); assert.equal(m.lockDoc.v, null);
  assert.match(m.st.cc, /^4001 renew/);
});
await t('an ERROR in the admin/beta check = gate_unreadable with the honest message; the platform cap hit = the socket renews', async () => {
  const m = hooked({ isAdmin: async () => { throw new Error('Too many subrequests.'); } }); m.set({ cap: false });
  m.order(KEY); await flush();
  const rf = m.c.find((x) => x.relay === 'refused'); assert.equal(rf.code, 'gate_unreadable');
  assert.equal(rf.error, 'Couldn’t confirm your trading access just now. Nothing was sent. Try again.'); assert.doesNotMatch(rf.error, ADMIN_MSG);
  assert.equal(m.u.filter((x) => x.payloadType === 2106).length, 0); assert.equal(m.st.cc, null, 'a plain blip keeps the socket');
  const m2 = hooked({ isAdmin: async () => { throw new Error('Too many subrequests.'); } }); m2.order(KEY); m2.set({ cap: true }); await flush();
  assert.equal(m2.c.find((x) => x.relay === 'refused').code, 'gate_unreadable'); assert.match(m2.st.cc, /^4001 renew/, 'cap hit: renew');
});
await t('the renew never cuts a write in flight or an unresolved one; it waits until cTrader answered', async () => {
  const m = hooked(); m.order(KEY); await flush();
  assert.equal(m.u.filter((x) => x.payloadType === 2106).length, 1);
  m.set({ left: 1 }); m.hooks.tick(Date.now()); assert.equal(m.st.cc, null, 'in flight: the socket stays');
  m.r.onUp(f({ clientMsgId: KEY, payloadType: 2126, payload: { ctidTraderAccountId: 77, executionType: 3, order: { orderId: 9 } } })); await flush();
  m.hooks.tick(Date.now()); assert.match(m.st.cc, /^4001 renew/, 'answered: now it renews');
});
await t('counter(): counts every fetch, flags the platform cap error, starts with the connect cost; default budget 40', async () => {
  assert.equal(SUBREQ_BUDGET, 40); assert.ok(WRITE_COST * 2 <= SUBREQ_BUDGET);
  const b = counter(async () => { throw new Error('Too many subrequests.'); }, 40); const l0 = b.left();
  await assert.rejects(b.f('x')); assert.equal(b.left(), l0 - 1); assert.equal(b.capHit(), true);
  const b2 = counter(async () => new Response('{}'), 10); for (let i = 0; i < 6; i++) await b2.f('x'); assert.equal(b2.capHit(), true, 'own budget used up');
});
await t('kill switch turned OFF while "on" is cached: writes are refused within the 30 s TTL (and every write after re-reads)', async () => {
  let clock = 0, on = true, reads = 0; const c = gateCache({ isAdmin: async () => true, switchOn: async () => { reads++; return on; }, consent: async () => true, blocked: async () => false }, { now: () => clock });
  assert.equal(await c.get('switchOn'), true); on = false;
  clock = GATE_TTL.switchOn - 1; assert.equal(await c.get('switchOn'), true, 'inside the TTL the cached on is used');
  clock = GATE_TTL.switchOn + 1; assert.equal(await c.get('switchOn'), false, 'refused after at most 30 s'); assert.equal(await c.get('switchOn'), false); assert.equal(reads, 3);
});
await t('a last-good FALLBACK value of the switch (Firestore failed twice) is used once but never kept', async () => {
  let clock = 0, reads = 0; const c = gateCache({ isAdmin: async () => true, switchOn: async () => { reads++; return { v: true, keep: false }; }, consent: async () => true, blocked: async () => false }, { now: () => clock });
  assert.equal(await c.get('switchOn'), true); assert.equal(await c.get('switchOn'), true); assert.equal(reads, 2, 're-read every time');
  // and the real reader flags it: liveSwitchOn calls deps.onStale on its fallback path
  const { liveSwitchOn, _resetKill, _resetToken } = await import('../../functions/connect/finatic/_audit.js');
  _resetKill(); _resetToken(); let up = true, stale = 0;
  const ff = async (url) => { url = String(url); if (url.startsWith('https://oauth2')) return new Response(JSON.stringify({ access_token: 'x' })); return up ? new Response('{}', { status: 404 }) : new Response('{}', { status: 503 }); };
  const realNow = Date.now; let tt = 1e12; Date.now = () => tt;
  try {
    assert.equal(await liveSwitchOn(SAENV, { auditFetch: ff, onStale: () => stale++ }), true); assert.equal(stale, 0);
    up = false; tt += 10000; assert.equal(await liveSwitchOn(SAENV, { auditFetch: ff, onStale: () => stale++, now: () => tt }), true); assert.equal(stale, 1, 'fallback flagged');
  } finally { Date.now = realNow; _resetKill(); _resetToken(); }
});
await t('the renew close waits while an order is UNKNOWN (held lock): refused "renew", socket kept until it is settled', async () => {
  const m = hooked(); m.order(KEY); await flush();
  m.hooks.tick(Date.now() + 16000); await flush();   // no answer in 15 s -> unknown, lock held
  assert.ok(m.c.some((x) => x.relay === 'unknown')); assert.ok(m.hooks._state().held);
  m.set({ left: 1 }); m.hooks.tick(Date.now() + 17000); assert.equal(m.st.cc, null, 'held: no close');
  m.order('k-fedcba9876543210'); await flush(); assert.equal(m.c.filter((x) => x.relay === 'refused').at(-1).code, 'unresolved', 'a new write is refused, nothing sent');
  assert.equal(m.st.cc, null); assert.equal(m.u.filter((x) => x.payloadType === 2106).length, 1, 'still only the one order');
});
await t('the minute re-check is a REAL read when the budget allows (a removed admin is cut within a minute, not 5)', async () => {
  const r = await scenario({ limit: 1e9, minutes: 3, orderEverySec: 9999 });
  try { const s = r.sockets[0]; assert.ok(s.used > 4 + 2, 'admin re-read each minute (used ' + s.used + ')'); } finally { r.done(); }
});

console.log(n + ' cTrader gate tests passed');
process.exit(0);
