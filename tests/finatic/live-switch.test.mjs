// Owner bug 19 Nov "Live trading switch could not be read, order not sent": liveSwitchOn retries once with a fresh token, keeps the
// last good value for 60 s, never caches a failure, still fails CLOSED when nothing was ever read, and carries the real reason
// (status code, no secret) into the order's error message. No network: Google + Firestore are stubbed.
import assert from 'node:assert/strict';
import * as AU from '../../functions/connect/finatic/_audit.js';
import * as O from '../../functions/connect/finatic/order.js';
import { generateKeyPairSync } from 'node:crypto';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY = JSON.stringify({ client_email: 'sa@test.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
const env = { FIREBASE_SA_KEY: KEY };
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
const DOC = (enabled) => J({ fields: { enabled: { booleanValue: enabled } } });
// script: a list of answers for the doc read ('net' = throw, number = status, true/false = the switch, 404 = no doc)
function stub(script, opts = {}) {
  const log = { mints: 0, reads: 0, tokens: [] };
  let n = 0;
  const f = async (url, init = {}) => {
    if (String(url).includes('oauth2')) { log.mints++; if (opts.mint) return new Response('', { status: opts.mint }); return J({ access_token: 'tok' + log.mints }); }
    log.reads++; log.tokens.push((init.headers || {}).authorization);
    const a = script[Math.min(n++, script.length - 1)];
    if (a === 'net') throw new TypeError('fetch failed');
    if (a === true || a === false) return DOC(a);
    return new Response('{"error":{"status":"PERMISSION_DENIED"}}', { status: a });
  };
  return { f, log };
}
const reset = () => { AU._resetKill(); AU._resetToken(); };
let t = 1_000_000;
const deps = (f) => ({ auditFetch: f, now: () => t });

// 1. plain read: on / off / no doc
reset(); assert.equal(await AU.liveSwitchOn(env, deps(stub([true]).f)), true);
reset(); assert.equal(await AU.liveSwitchOn(env, deps(stub([false]).f)), false, 'switched off stays off');
reset(); assert.equal(await AU.liveSwitchOn(env, deps(stub([404]).f)), true, 'no doc = never switched off');

// 2. one failure (403 / 500 / network / 401) -> retried once with a FRESH token -> ok
for (const bad of [403, 500, 503, 'net', 401, 429]) {
  reset(); const s = stub([bad, true]);
  assert.equal(await AU.liveSwitchOn(env, deps(s.f)), true, 'retry after ' + bad);
  assert.equal(s.log.reads, 2); assert.equal(s.log.mints, 2, 'the retry mints a new token (' + bad + ')'); assert.notEqual(s.log.tokens[0], s.log.tokens[1]);
}

// 3. two failures, nothing read before -> throws with the real reason (fails closed); nothing cached
reset(); { const s = stub([403]);
  await assert.rejects(AU.liveSwitchOn(env, deps(s.f)), (e) => /403/.test(e.reason) && /permission/i.test(e.reason) && !/tok|BEGIN|sa@/.test(e.reason));
  assert.equal(s.log.reads, 2, 'exactly one retry');
  const s2 = stub([true]); assert.equal(await AU.liveSwitchOn(env, deps(s2.f)), true, 'a failure is never cached'); }
reset(); await assert.rejects(AU.liveSwitchOn(env, deps(stub([500]).f)), (e) => /500/.test(e.reason));
reset(); await assert.rejects(AU.liveSwitchOn(env, deps(stub(['net']).f)), (e) => /unreachable/.test(e.reason));
reset(); await assert.rejects(AU.liveSwitchOn(env, deps(stub([true], { mint: 400 }).f)), (e) => /sign-in refused.*400/.test(e.reason), 'token mint failure named');
reset(); await assert.rejects(AU.liveSwitchOn({}, deps(stub([true]).f)), (e) => e.reason === 'service account key missing');
reset(); await assert.rejects(AU.liveSwitchOn({ FIREBASE_SA_KEY: '{not json' }, deps(stub([true]).f)), (e) => e.reason === 'service account key unreadable');

// 4. 5 s memo of a GOOD value; last good kept up to 60 s when later reads fail; older than 60 s -> refused
reset(); t = 1_000_000;
{ const s = stub([true]); assert.equal(await AU.liveSwitchOn(env, deps(s.f)), true);
  t += 3000; assert.equal(await AU.liveSwitchOn(env, deps(stub([403]).f)), true, 'within 5 s: memo, no read');
  t += 30000; const s2 = stub([403]); assert.equal(await AU.liveSwitchOn(env, deps(s2.f)), true, '33 s old good value used when both reads fail'); assert.equal(s2.log.reads, 2);
  t += 30000; await assert.rejects(AU.liveSwitchOn(env, deps(stub([403]).f)), '63 s old: refused'); }
// last good = OFF stays off when reads fail
reset(); t = 2_000_000;
{ assert.equal(await AU.liveSwitchOn(env, deps(stub([false]).f)), false); t += 20000; assert.equal(await AU.liveSwitchOn(env, deps(stub([500]).f)), false, 'off is never turned on by a failure'); }
// a good read refreshes the memo time
reset(); t = 3_000_000;
{ await AU.liveSwitchOn(env, deps(stub([true]).f)); t += 50000; await AU.liveSwitchOn(env, deps(stub([true]).f)); t += 50000;
  assert.equal(await AU.liveSwitchOn(env, deps(stub([403]).f)), true, '50 s after the latest good read'); }

// 5. the order route (real gate with a signed test ID token): unreadable switch -> 503 switch_unreadable, the reason in the message,
// an audit row with the reason, and NOTHING sent to the broker (broker stub counts calls)
{ reset();
  const { privateKey: pk, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const { createSign } = await import('node:crypto');
  const now = Math.floor(Date.now() / 1000), h = b64({ alg: 'RS256', kid: 'k1' }), pl = b64({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: 'admin1', iat: now - 5, exp: now + 3000 });
  const sig = createSign('RSA-SHA256').update(h + '.' + pl).sign(pk).toString('base64url'), idTok = h + '.' + pl + '.' + sig;
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const verifyFetch = async (url) => String(url).includes('jwk/securetoken') ? J({ keys: [jwk] }) : /admins\/admin1$/.test(String(url)) ? J({}) : J({}, 404);
  let brokerWrites = 0; const rows = [];
  const finFetch = async (url, init) => { const u = new URL(url); if (u.pathname === '/api/v1/session/init') return J({ data: { one_time_token: 'o' } }); if (u.pathname === '/api/v1/session/start') return J({ data: { session_id: 's1', user_id: '0aaa1111-2222-3333-4444-555566667777', status: 'active' } }); if (init.method !== 'GET') brokerWrites++; return J({ data: [] }); };
  const audit = async (e) => { const row = { ...e }; rows.push(row); return { id: 'a', finish: async (r) => Object.assign(row, r) }; };
  const pend = []; const sw = async () => { const e = new Error('x'); e.reason = 'Firestore permission denied (403): the service account may not read settings/liveTrading'; throw e; };
  const d = { verifyFetch, finFetch, audit, liveSwitch: sw, sleep: async () => {}, defer: (p) => { pend.push(p); return p; } };
  const req = new Request('https://tradezoro.com/connect/finatic/order', { method: 'POST', headers: { 'cf-connecting-ip': '10.9.9.9', origin: 'https://tradezoro.com', 'content-type': 'application/json', authorization: 'Bearer ' + idTok }, body: JSON.stringify({ op: 'place', userId: '0aaa1111-2222-3333-4444-555566667777', accountId: '123e4567-e89b-12d3-a456-426614174000', symbol: 'MNQZ6', side: 'sell', qty: 1, type: 'market', idemKey: 'livesw0000000000001', src: 'chart' }) });
  const r = await O.handle(req, { FINATIC_API_KEY: 'fntc_live_FAKE', FINATIC_LIVE_ORDERS: '1', DEV: '0' }, d);
  const b = await r.json(); await Promise.all(pend);
  assert.equal(r.status, 503, JSON.stringify(b)); assert.equal(b.code, 'switch_unreadable');
  assert.match(b.error, /\(Firestore permission denied \(403\)/); assert.match(b.error, /order not sent$/);
  assert.equal(brokerWrites, 0, 'nothing sent to the broker');
  assert.ok(rows.some((x) => x.result === 'rejected' && /live switch unreadable: .*403/.test(x.message)), 'reason written to the audit row');
}
console.log('live switch: ok');
