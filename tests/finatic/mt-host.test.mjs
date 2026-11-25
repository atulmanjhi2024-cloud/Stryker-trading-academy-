// MetaTrader host proxy (functions/connect/mt/[op].js). Host is a STUB: no network, no real account. Run: node tests/finatic/mt-host.test.mjs
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { _resetOwner } from '../../functions/connect/finatic/_owner.js';
import { memStore } from './_store.mjs';
import { handle, cleanArgs, signHost, _resetHost, HOST_KV } from '../../functions/connect/mt/[op].js';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (uid) => { const t = Math.floor(Date.now() / 1000); const h = b64({ alg: 'RS256', kid: 'k1' }), p = b64({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: uid, iat: t - 5, exp: t + 600 }); const s = createSign('RSA-SHA256'); s.update(h + '.' + p); return h + '.' + p + '.' + s.sign(privateKey).toString('base64url'); };
const verifyFetch = async (u) => (String(u).includes('jwk/securetoken') ? new Response(JSON.stringify({ keys: [jwk] })) : new Response('{}', { status: 404 }));
const env = { MT_HOST_URL: 'http://127.0.0.1:1', MT_HOST_SECRET: 'sek' };
const sent = []; let hostReply = { status: 200, j: { ok: true, order: 5 } };
const hostFetch = async (u, init) => { sent.push({ u, init }); if (hostReply === 'down') throw new Error('x'); return new Response(JSON.stringify(hostReply.j), { status: hostReply.status }); };
const audits = new Map(); const audit = async (e, id) => { if (audits.has(id)) { const er = new Error('dup'); er.duplicate = true; throw er; } audits.set(id, e); return { finish: async (x) => Object.assign(audits.get(id), x) }; };
let sw = true, store = memStore({ consent: ['u1'] });
let allowed = new Set(['u1', 'u2']), gateDown = false;   // admin OR beta tester (stub of the settings/betaTesters + admins check)
const D = () => ({ verifyFetch, hostFetch, audit, store, liveSwitch: async () => sw, isAllowed: async (u) => { if (gateDown) throw new Error('fs'); return allowed.has(u); } });
let ip = 1;
const call = async (route, body, tok = token('u1'), method = body === undefined ? 'GET' : 'POST', extra = {}) => {
  const h = { origin: 'https://tradezoro.com', 'cf-connecting-ip': '10.1.' + (ip++ % 250) + '.1', ...(tok ? { authorization: 'Bearer ' + tok } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extra };
  const r = await handle(new Request('https://tradezoro.com/connect/mt/' + route, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, D());
  return { status: r.status, j: await r.json() };
};
const ACC = 'a'.repeat(16), K = (n) => 'mt' + String(n).padStart(20, '0');

// auth + origin + not set up
assert.equal((await call('accounts', undefined, null)).status, 401);
assert.equal((await call('accounts', undefined, 'junk')).status, 401);
assert.equal((await call('accounts', undefined, token('u1'), 'GET', { origin: 'https://evil.example' })).status, 403);
assert.equal((await handle(new Request('https://tradezoro.com/connect/mt/accounts'), {}, D())).status, 503);
assert.equal(sent.length, 0, 'nothing reached the host without auth');
// gate: members (not admin, not beta) never reach the host; an unreadable list fails closed
{ const n = sent.length;
  let g = await call('accounts', undefined, token('member1')); assert.equal(g.status, 403); assert.equal(g.j.code, 'not_open');
  g = await call('link', { login: '1', server: 'S', password: 'p' }, token('member1')); assert.equal(g.status, 403);
  gateDown = true; g = await call('accounts'); assert.equal(g.status, 503); assert.equal(g.j.code, 'gate_unreadable'); gateDown = false;
  assert.equal(sent.length, n, 'gate: nothing forwarded'); }
// token forwarded + secret header, uid never from the body
await call('accounts'); assert.equal(sent.at(-1).init.headers['x-mt-secret'], 'sek'); assert.match(sent.at(-1).init.headers.authorization, /^Bearer /);
// link: only whitelisted fields leave; password forwarded to host only
hostReply = { status: 200, j: { account: { id: ACC } } };
await call('link', { login: '55', server: 'X-Live', password: 'pw', mode: 'investor', uid: 'victim', slot: 9 });
const lb = JSON.parse(sent.at(-1).init.body); assert.deepEqual(Object.keys(lb).sort(), ['login', 'mode', 'password', 'platform', 'server']); assert.equal(lb.mode, 'investor');
// order gates
hostReply = { status: 200, j: { ok: true, order: 5 } };
const place = (o = {}, n = 1) => call('op', { accountId: ACC, op: 'place', idemKey: K(n), args: { symbol: 'EURUSD', side: 'buy', volume: 0.01, type: 'market' }, ...o });
let x = await place(); assert.equal(x.status, 200); assert.equal(audits.get(K(1)).uid, 'u1'); assert.equal(audits.get(K(1)).result, 'ok');
x = await place({}, 1); assert.equal(x.status, 409); assert.equal(x.j.code, 'duplicate');                    // same key never reaches the host twice
const n0 = sent.length;
sw = false; assert.equal((await place({}, 2)).j.code, 'switched_off'); sw = true;
assert.equal((await call('op', { accountId: ACC, op: 'place', idemKey: K(3), args: { symbol: 'EURUSD', side: 'buy', volume: 0.01 } }, token('u2'))).j.code, 'consent_needed');   // u2 never accepted
_resetOwner(); store = memStore({ consent: ['u1'] }); await store.set('settings/liveBlocked', { u1: true }); assert.equal((await place({}, 4)).j.code, 'member_blocked'); _resetOwner(); store = memStore({ consent: ['u1'] });
assert.equal((await place({ idemKey: 'x' }, 5)).status, 400);
assert.equal((await place({ args: { symbol: 'EURUSD', side: 'buy', volume: 0.015 } }, 6)).status, 400);
assert.equal((await place({ args: { symbol: 'EUR USD;rm', side: 'buy', volume: 0.01 } }, 7)).status, 400);
assert.equal((await place({ op: 'drop', args: {} }, 8)).status, 400);
assert.equal(sent.length, n0, 'no refused order reached the host');
// reads need no consent and no audit row
const na = audits.size; x = await call('op', { accountId: ACC, op: 'positions' }, token('u2')); assert.equal(x.status, 200); assert.equal(audits.size, na);
// host says read-only -> passed through, audit says rejected
hostReply = { status: 403, j: { error: 'read-only', code: 'read_only' } }; x = await place({}, 9); assert.equal(x.status, 403); assert.equal(audits.get(K(9)).result, 'rejected');
// host down on an order = "unknown", never a success
hostReply = 'down'; x = await place({}, 10); assert.equal(x.j.code, 'unknown'); assert.equal(audits.get(K(10)).result, 'unknown');
hostReply = { status: 200, j: {} };
// audit unwritable = no order
const bad = async () => { throw new Error('fs'); };
{ const n1 = sent.length; const r = await handle(new Request('https://tradezoro.com/connect/mt/op', { method: 'POST', headers: { origin: 'https://tradezoro.com', 'content-type': 'application/json', authorization: 'Bearer ' + token('u1'), 'cf-connecting-ip': '10.7.7.7' }, body: JSON.stringify({ accountId: ACC, op: 'place', idemKey: K(11), args: { symbol: 'EURUSD', side: 'buy', volume: 0.01 } }) }), env, { ...D(), audit: bad }); assert.equal((await r.json()).code, 'audit_unwritable'); assert.equal(sent.length, n1); }
// cleanArgs
assert.deepEqual(cleanArgs('modify', { ticket: '5', sl: 1.1, junk: 1 }).args, { ticket: '5', sl: 1.1 });
assert.ok(cleanArgs('modify', { ticket: '5' }).error); assert.ok(cleanArgs('cancel', { ticket: 'x' }).error); assert.ok(cleanArgs('place', { symbol: 'A', side: 'buy', volume: 1, type: 'limit' }).error);
// ---- quick tunnel: address from KV (written only by the signed watcher), friendly "restarting", status endpoint
{
  _resetHost();
  const SEC = 's'.repeat(48), kvm = new Map(), kv = { get: async (k) => kvm.get(k) ?? null, put: async (k, v) => { kvm.set(k, v); } };
  const PUB = 'p'.repeat(48), qenv = { MT_HOST_SECRET: SEC, MT_PUBLISH_KEY: PUB };
  let tsN = Math.floor(Date.now() / 1000) - 100;
  const D2 = (extra = {}) => ({ ...D(), hostKv: kv, ...extra });
  const post = async (body, { secret = PUB, ts = String(++tsN), sig } = {}) => {
    const b = JSON.stringify(body); const s = sig || await signHost(secret, ts, b);
    const r = await handle(new Request('https://tradezoro.com/connect/mt/hosturl', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(b.length), 'x-mt-ts': ts, 'x-mt-sig': s }, body: b }), qenv, D2());
    return { status: r.status, j: await r.json(), ts, sig: s, b };
  };
  const qcall = async (route, body, deps = {}) => { const r = await handle(new Request('https://tradezoro.com/connect/mt/' + route, { method: body ? 'POST' : 'GET', headers: { origin: 'https://tradezoro.com', 'cf-connecting-ip': '10.9.' + (ip++ % 250) + '.1', authorization: 'Bearer ' + token('u1'), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }), qenv, D2(deps)); return { status: r.status, j: await r.json() }; };
  // no address yet: friendly restarting, nothing sent
  let n = sent.length, x = await qcall('accounts'); assert.equal(x.status, 503); assert.equal(x.j.code, 'restarting'); assert.match(x.j.error, /restarting, try again in a minute|restarting\. Try again in a minute/i); assert.equal(sent.length, n);
  // the watcher's post: bad signature / wrong secret / stale time / non-quick url are all refused, nothing stored
  assert.equal((await post({ url: 'https://abc-def.trycloudflare.com' }, { sig: 'f'.repeat(64) })).status, 403);
  assert.equal((await post({ url: 'https://abc-def.trycloudflare.com' }, { secret: 'x'.repeat(48) })).status, 403);
  assert.equal((await post({ url: 'https://abc-def.trycloudflare.com' }, { secret: SEC })).status, 403, 'the host bearer cannot sign: separate key');
  assert.equal((await post({ url: 'https://abc-def.trycloudflare.com' }, { ts: String(Math.floor(Date.now() / 1000) - 600) })).status, 403);
  assert.equal((await post({ url: 'https://evil.example.com' })).status, 400);
  assert.equal((await post({ url: 'https://abc-def.trycloudflare.com/x' })).status, 400);
  assert.equal(kvm.size, 0, 'nothing stored by a refused post');
  // a member's token on hosturl does nothing
  assert.equal((await qcall('hosturl', { url: 'https://abc-def.trycloudflare.com' })).status, 403);
  // good post -> stored -> next member call goes to that address with the secret header
  x = await post({ url: 'https://abc-def.trycloudflare.com', status: { tunnel: true, hostOk: true, live: 2, max: 30, urlSince: Math.floor(Date.now() / 1000) - 50, restarts: 1, secret: 'nope' } });
  assert.equal(x.status, 200); assert.ok(!/nope/.test(kvm.get(HOST_KV)), 'only whitelisted status fields kept');
  // replay of an accepted post (or an older one) is refused: no rollback to an old address
  { const r = await handle(new Request('https://tradezoro.com/connect/mt/hosturl', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(x.b.length), 'x-mt-ts': x.ts, 'x-mt-sig': x.sig }, body: x.b }), qenv, D2()); assert.equal(r.status, 409); }
  hostReply = { status: 200, j: { accounts: [] } };
  x = await qcall('accounts'); assert.equal(x.status, 200); assert.equal(sent.at(-1).u, 'https://abc-def.trycloudflare.com/v1/accounts'); assert.equal(sent.at(-1).init.headers['x-mt-secret'], SEC);
  // the tunnel went away (Cloudflare edge HTML 530): friendly restarting, cache dropped, the NEW address is used on the next call
  const edge = async (u, init) => { sent.push({ u, init }); return new Response('<html>error 1033</html>', { status: 530 }); };
  x = await qcall('accounts', undefined, { hostFetch: edge }); assert.equal(x.j.code, 'restarting'); assert.ok(!/1033|html/i.test(JSON.stringify(x.j)), 'no raw error shown');
  await post({ url: 'https://new-one.trycloudflare.com', status: { tunnel: true, hostOk: true } });
  x = await qcall('accounts'); assert.equal(sent.at(-1).u, 'https://new-one.trycloudflare.com/v1/accounts');
  // an ORDER that hits a 502 at the edge is "unknown" (may have gone through), never "not sent"
  const e502 = async (u, init) => { sent.push({ u, init }); return new Response('bad gateway', { status: 502 }); };
  x = await qcall('op', { accountId: ACC, op: 'place', idemKey: K(40), args: { symbol: 'EURUSD', side: 'buy', volume: 0.01 } }, { hostFetch: e502 }); assert.equal(x.j.code, 'unknown');
  // a dead edge (530) on an order: nothing reached the host -> restarting, order not sent
  x = await qcall('op', { accountId: ACC, op: 'place', idemKey: K(41), args: { symbol: 'EURUSD', side: 'buy', volume: 0.01 } }, { hostFetch: edge }); assert.equal(x.j.code, 'restarting'); assert.match(x.j.error, /not sent/);
  // status: public summary, never the address or the secret
  _resetHost();
  const st = await handle(new Request('https://tradezoro.com/connect/mt/status'), qenv, D2()); const sj = await st.json();
  assert.equal(st.status, 200); assert.equal(sj.ok, true); assert.equal(sj.mode, 'quick'); assert.equal(sj.tunnel, true); assert.ok(!/trycloudflare|s{20}/.test(JSON.stringify(sj)));
  // the named tunnel (env MT_HOST_URL) wins over the quick address
  _resetHost(); n = sent.length;
  await handle(new Request('https://tradezoro.com/connect/mt/accounts', { headers: { origin: 'https://tradezoro.com', 'cf-connecting-ip': '10.8.8.8', authorization: 'Bearer ' + token('u1') } }), { MT_HOST_SECRET: SEC, MT_HOST_URL: 'https://mt-host.tradezoro.com' }, D2());
  assert.equal(sent.at(-1).u, 'https://mt-host.tradezoro.com/v1/accounts');
  // an address not re-confirmed for 15 min is not used (watcher dead): restarting, nothing sent
  { const o = JSON.parse(kvm.get(HOST_KV)); o.at = Date.now() - 16 * 60000; kvm.set(HOST_KV, JSON.stringify(o)); _resetHost(); n = sent.length;
    x = await qcall('accounts'); assert.equal(x.j.code, 'restarting'); assert.equal(sent.length, n); }
  // members still refused before any lookup
  n = sent.length; x = await handle(new Request('https://tradezoro.com/connect/mt/accounts', { headers: { origin: 'https://tradezoro.com', 'cf-connecting-ip': '10.8.8.9', authorization: 'Bearer ' + token('member9') } }), qenv, D2()); assert.equal(x.status, 403); assert.equal(sent.length, n);
}
console.log('mt-host: ok');
