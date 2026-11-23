import { memStore } from './_store.mjs';
// Beta bug 23 Nov (Tradovate prop account, "Trading is not enabled for this account yet"): the broker link answered 403 with
// details.original_exception "Account grant does not allow trading" (the account was connected read-only). The chart must say
// that in plain words; any other 403 shows the broker link's own reason. Every broker call is a STUB. Sample data only.
import assert from 'node:assert/strict';
import * as O from '../../functions/connect/finatic/order.js';
import * as F from '../../functions/connect/finatic/_fin.js';
import { generateKeyPairSync, createSign } from 'node:crypto';

// the broker link's real reply (probe 23 Nov, ids replaced)
const GRANT403 = { trace_id: 't', success: { id: 'x' }, error: { type: 'AUTH', code: 'ACCESS_DENIED', message: 'Account not found or access denied', status: 403, details: { account_id: '123e4567-e89b-12d3-a456-426614174000', original_exception: 'Account grant does not allow trading' } } };
const OTHER403 = { error: { type: 'AUTH', code: 'ACCESS_DENIED', message: 'Account not found or access denied', status: 403 } };

// errInfo keeps the real cause, never the account id
let r = await F.fin({ FINATIC_API_KEY: 'fntc_live_FAKE' }, { finFetch: async () => new Response(JSON.stringify(GRANT403), { status: 403 }) }, 'GET', '/x');
assert.equal(r.status, 403); assert.equal(r.errCode, 'ACCESS_DENIED');
assert.equal(r.errMsg, 'Account not found or access denied: Account grant does not allow trading');
r = await F.fin({ FINATIC_API_KEY: 'k' }, { finFetch: async () => new Response(JSON.stringify(OTHER403), { status: 403 }) }, 'GET', '/x');
assert.equal(r.errMsg, 'Account not found or access denied', 'no details: message unchanged');

// end to end through the order route (schema + place), signed-in member who owns the account and accepted the notice
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const token = (uid) => { const now = Math.floor(Date.now() / 1000), h = b64({ alg: 'RS256', kid: 'k1' }), p = b64({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: uid, iat: now - 5, exp: now + 3000 }); return h + '.' + p + '.' + createSign('RSA-SHA256').update(h + '.' + p).sign(privateKey).toString('base64url'); };
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const verifyFetch = async (url) => String(url).includes('jwk/securetoken') ? new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }) : /admins\/admin1$/.test(String(url)) ? new Response('{}', { status: 200 }) : new Response('{}', { status: 404 });
const ACC = '123e4567-e89b-12d3-a456-426614174000', USER = '0bbb1111-2222-3333-4444-555566667777';
const env = { FINATIC_API_KEY: 'fntc_live_TESTSECRETKEY', FINATIC_LIVE_ORDERS: '1', DEV: '0' };
const ok = (data) => new Response(JSON.stringify({ data, errors: [] }), { status: 200 });
let body403 = GRANT403;
const finFetch = async (url, init) => {
  const u = new URL(url);
  if (u.pathname === '/api/v1/session/init') return ok({ one_time_token: 'ott' });
  if (u.pathname === '/api/v1/session/start') return ok({ session_id: 's1', status: 'active', user_id: USER });
  if (u.pathname === '/api/v1/accounts') return ok([{ accountId: ACC }]);
  if (/order-schemas$/.test(u.pathname) || (init.method === 'POST' && /\/orders$/.test(u.pathname))) return new Response(JSON.stringify(body403), { status: 403 });
  return ok([]);
};
let ipn = 1;
const call = (b) => O.handle(new Request('https://tradezoro.com/connect/finatic/order', { method: 'POST', headers: { 'cf-connecting-ip': '10.7.' + (ipn++ % 250) + '.1', origin: 'https://tradezoro.com', 'content-type': 'application/json', authorization: 'Bearer ' + token('admin1') }, body: JSON.stringify({ accountId: ACC, userId: USER, ...b }) }), env,
  { store: memStore({ consent: ['admin1'] }), verifyFetch, finFetch, audit: async () => ({ id: 'a1', finish: async () => {} }), liveSwitch: async () => true });
const out = async (p) => { const x = await p; return { status: x.status, j: JSON.parse(await x.text()) }; };

let x = await out(call({ op: 'schema', action: 'place' }));
assert.equal(x.status, 403); assert.equal(x.j.code, 'trade_not_granted');
assert.match(x.j.error, /connected as read-only/); assert.match(x.j.error, /allow trading/);
assert.ok(!/not enabled for this account yet/.test(x.j.error), 'old vague text gone');
assert.ok(!/\.$/.test(x.j.error), 'no full stop: the chart adds ". New orders are blocked."');
x = await out(call({ op: 'place', symbol: 'MNQZ6', side: 'buy', qty: 1, type: 'market', idemKey: 'k-0001-aaaa-bbbb' }));
assert.equal(x.status, 403, JSON.stringify(x.j)); assert.equal(x.j.code, 'trade_not_granted');
body403 = OTHER403;
x = await out(call({ op: 'schema', action: 'place' }));
assert.equal(x.status, 403); assert.equal(x.j.code, 'broker_refused');
assert.equal(x.j.error, 'The broker refused orders for this account (Account not found or access denied)');
assert.ok(!/123e4567|fntc_/.test(JSON.stringify(x.j)), 'no id or key in a reply');
console.log('ok trade-grant');
