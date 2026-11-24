// AUTO-TDVAPI (23 Nov): the Tradovate place body is checked against the account's OWN place schema (recorded reply, fixtures/
// tradovate-place-schema.json) and carries the exact-contract finaticInstrumentId when a position read has it.
// Every broker call is a STUB: nothing reaches a real broker. Sample data only. Run: node tests/finatic/tdvapi.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { memStore } from './_store.mjs';
import * as O from '../../functions/connect/finatic/order.js';

const FX = JSON.parse(fs.readFileSync(new URL('./fixtures/tradovate-place-schema.json', import.meta.url)));
const ourBody = { assetType: 'future', symbol: 'MNQZ6', action: 'sell', orderType: 'market', orderQty: 1, timeInForce: 'day' };

// ---- 1. our body vs the recorded Tradovate schema (pure) ---------------------------------------------------------------
{
  const os = FX.orderSchema;
  assert.deepEqual(os.required, ['assetType', 'orderType', 'symbol']);
  assert.equal(os.additionalProperties, false, 'the schema is closed: an unknown field would be a 422, not a 504');
  for (const k of Object.keys(ourBody)) assert.ok(os.properties[k], 'schema declares ' + k);
  assert.ok(os.properties.assetType.enum.includes('future'), "lower-case 'future' is the schema's own value");
  assert.ok(os.properties.finaticInstrumentId && os.properties.instrumentId);
  let n = 0; const call = async (m, p, o) => { n++; assert.equal(m, 'GET'); assert.match(p, /\/order-schemas$/); assert.equal(o.query.action, 'place'); return { ok: true, data: FX }; };
  O._resetSchemas();
  const s = await O.placeSchema(call, '/api/v1/accounts/A', 'A', { now: () => 1000 });
  assert.equal(s.closed, true); assert.deepEqual(s.types, {}, 'Tradovate lists no order types (empty map) = nothing checked by type');
  await O.placeSchema(call, '/api/v1/accounts/A', 'A', { now: () => 1000 + O.SCHEMA_MS - 1 }); assert.equal(n, 1, 'cached per account');
  await O.placeSchema(call, '/api/v1/accounts/A', 'A', { now: () => 1000 + O.SCHEMA_MS + 1 }); assert.equal(n, 2, 'read again after SCHEMA_MS');
  assert.deepEqual(O.fitSchema(s, ourBody).order, ourBody, 'our MNQZ6 market body passes the recorded schema unchanged');
  assert.deepEqual(O.fitSchema(s, { ...ourBody, finaticInstrumentId: 'x1' }).order.finaticInstrumentId, 'x1');
  assert.equal(O.fitSchema(s, { ...ourBody, junk: 1 }).order.junk, undefined, 'closed schema: an undeclared field is dropped');
  assert.match(O.fitSchema(s, { ...ourBody, assetType: 'FUTURE' }).error, /does not take assetType FUTURE/, 'enum checked');
  const { symbol, ...noSym } = ourBody; assert.match(O.fitSchema(s, noSym).error, /needs symbol/);
  // a broker that DOES list order types
  assert.match(O.fitSchema({ ...s, types: { future: ['market', 'limit'] } }, { ...ourBody, orderType: 'stop', stopPrice: 1 }).error, /only market, limit/);
  assert.ok(O.fitSchema({ ...s, types: { future: ['MARKET'] } }, ourBody).order);
  // schema unreadable / odd = null (the order goes out as before)
  O._resetSchemas(); assert.equal(await O.placeSchema(async () => ({ ok: false, status: 503 }), '/x', 'B'), null);
  O._resetSchemas(); assert.equal(await O.placeSchema(async () => { throw new Error('x'); }, '/x', 'B'), null);
  O._resetSchemas(); assert.equal(await O.placeSchema(async () => ({ ok: true, data: { orderSchema: {} } }), '/x', 'B'), null);
}
// ---- 2. finaticInstrumentId from an EXACT position descriptor only -----------------------------------------------------
{
  const pos = [{ securityId: 'MNQZ6', instrument: FX.positionInstrument }];
  assert.equal(O.instrumentIdFor(pos, 'MNQZ6'), 'sample-fininst-mnqz6');
  assert.equal(O.instrumentIdFor(pos, 'MNQH7'), '', 'another month never borrows the id');
  assert.equal(O.instrumentIdFor(pos, 'NQZ6'), '', 'NQ never takes MNQ');
  const root = { ...FX.positionInstrument, future: { ...FX.positionInstrument.future, identityQuality: 'ROOT_ONLY' } };
  assert.equal(O.instrumentIdFor([{ instrument: root }], 'MNQZ6'), '', 'ROOT_ONLY is never used');
  assert.equal(O.instrumentIdFor([{ instrument: { ...FX.positionInstrument, finaticInstrumentId: 'bad id/..' } }], 'MNQZ6'), '');
  assert.equal(O.instrumentIdFor(null, 'MNQZ6'), ''); assert.equal(O.instrumentIdFor([{}], 'MNQZ6'), '');
}
// ---- 3. the whole chart place, mocked broker: what actually goes on the wire -------------------------------------------
{
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = (uid) => { const now = Math.floor(Date.now() / 1000); const h = b64({ alg: 'RS256', kid: 'k1' }), p = b64({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: uid, iat: now - 5, exp: now + 3000 }); return h + '.' + p + '.' + createSign('RSA-SHA256').update(h + '.' + p).sign(privateKey).toString('base64url'); };
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const verifyFetch = async (url) => { if (String(url).includes('jwk/securetoken')) return new Response(JSON.stringify({ keys: [jwk] })); return /admins\/admin1$/.test(String(url)) ? new Response('{}') : new Response('{}', { status: 404 }); };
  const US = '0aaa1111-2222-3333-4444-555566667777', ACC = '123e4567-e89b-12d3-a456-426614174000';
  const B = { positions: [], calls: [], schema: FX };
  const ok = (data) => new Response(JSON.stringify({ data, errors: [] }), { status: 200 });
  const finFetch = async (url, init) => {
    const u = new URL(url); B.calls.push({ m: init.method, p: u.pathname, q: u.search, h: init.headers, body: init.body ? JSON.parse(init.body) : null });
    if (u.pathname === '/api/v1/accounts' && init.method === 'GET') return ok([{ accountId: ACC, brokerId: 'tradovate' }]);
    if (u.pathname === '/api/v1/session/init') return ok({ one_time_token: 'ott' });
    if (u.pathname === '/api/v1/session/start') return ok({ session_id: 's', company_id: 'c', status: 'active', user_id: US });
    if (u.pathname.endsWith('/order-schemas')) return B.schema ? ok(B.schema) : new Response('{}', { status: 503 });
    if (u.pathname.endsWith('/positions')) return ok(B.positions);
    if (u.pathname.endsWith('/orders') && init.method === 'GET') return ok([]);
    if (u.pathname.endsWith('/orders') && init.method === 'POST') return ok({ accepted: true, order: { orderId: 'o' + B.calls.length, status: 'FILLED' } });
    return ok([]);
  };
  const deps = { store: memStore({ consent: ['admin1'] }), verifyFetch, finFetch, audit: async (e) => ({ finish: async () => {} }), brackets: new Map(), liveSwitch: async () => true, now: () => Date.now(), sleep: async () => {} };
  const live = { FINATIC_API_KEY: 'fntc_live_FAKE', FINATIC_LIVE_ORDERS: '1', DEV: '0' };
  let ip = 1, k = 0;
  const send = async (b) => { const r = await O.handle(new Request('https://tradezoro.com/connect/finatic/order', { method: 'POST', headers: { 'cf-connecting-ip': '10.8.' + (ip++) + '.1', origin: 'https://tradezoro.com', 'content-type': 'application/json', authorization: 'Bearer ' + token('admin1') }, body: JSON.stringify({ src: 'chart', accountId: ACC, userId: US, idemKey: 'k' + String(++k).padStart(20, '0'), ...b }) }), live, deps); return { status: r.status, j: await r.json() }; };
  const posts = () => B.calls.filter((x) => x.m === 'POST' && x.p.endsWith('/orders'));
  const place = { op: 'place', symbol: 'MNQZ6', side: 'sell', qty: 1, type: 'market' };

  O._resetSchemas();
  let r = await send(place); assert.equal(r.status, 200, JSON.stringify(r.j));
  let p = posts().at(-1);
  assert.deepEqual(p.body, { order: ourBody, paperTradeConfirmed: false }, 'no position: the same body as before');
  assert.equal(p.h['Idempotency-Key'], 'k' + String(k).padStart(20, '0')); assert.equal(p.h['content-type'], 'application/json'); assert.equal(p.h['x-session-id'], 's');
  assert.equal(p.h['x-company-id'], 'c'); assert.equal(p.h['X-Finatic-Environment'], 'live', 'live key: explicit live header, as the SDK'); assert.equal(p.body.broker, undefined, 'no broker hint sent (optional)');
  assert.ok(B.calls.some((x) => x.p.endsWith('/order-schemas') && x.q === '?action=place'), 'the account schema was read');

  B.positions = [{ securityId: 'MNQZ6', securityIdType: 'SYMBOL', assetType: 'FUTURE', quantity: 1, side: 'LONG', status: 'OPEN', instrument: FX.positionInstrument }];
  r = await send(place); assert.equal(r.status, 200);
  assert.equal(posts().at(-1).body.order.finaticInstrumentId, 'sample-fininst-mnqz6', 'exact contract id from the position read');
  assert.equal(posts().at(-1).body.order.symbol, 'MNQZ6', 'symbol still sent next to it');
  r = await send({ ...place, symbol: 'MGCZ6' }); assert.equal(posts().at(-1).body.order.finaticInstrumentId, undefined, 'other contract: no id');

  // schema unreadable: the order still goes out (as before), unchanged
  O._resetSchemas(); B.schema = null; B.positions = [];
  const n0 = posts().length; r = await send(place); assert.equal(r.status, 200); assert.equal(posts().length, n0 + 1); assert.deepEqual(posts().at(-1).body.order, ourBody);
  // a schema that refuses the body: nothing sent, plain words
  O._resetSchemas(); B.schema = { ...FX, orderSchema: { ...FX.orderSchema, required: [...FX.orderSchema.required, 'accountSpec'], properties: { ...FX.orderSchema.properties, accountSpec: { type: 'string' } } } };
  const n1 = posts().length; r = await send(place); assert.equal(r.status, 400); assert.equal(r.j.code, 'schema'); assert.match(r.j.error, /needs accountSpec.*Nothing was sent/); assert.equal(posts().length, n1);
}
// ---- 4. a 504 says whose it was: their app (x-process-time) or a Cloudflare-made page ---------------------------------
{
  const F = await import('../../functions/connect/finatic/_fin.js');
  const env = { FINATIC_API_KEY: 'fntc_live_FAKE' };
  let r = await F.fin(env, { finFetch: async () => new Response('error code: 504', { status: 504, headers: { 'content-type': 'text/plain', server: 'cloudflare', 'cf-ray': 'a5f1-MRS' } }) }, 'POST', '/api/v1/accounts/a/orders', { body: {} });
  assert.match(r.errMsg, /text\/plain from cloudflare, 15 bytes, not their app, request id a5f1-MRS/);
  r = await F.fin(env, { finFetch: async () => new Response('<html>x</html>', { status: 504, headers: { 'content-type': 'text/html', server: 'uvicorn', 'x-process-time': '0.3' } }) }, 'POST', '/api/v1/accounts/a/orders', { body: {} });
  assert.match(r.errMsg, /their app answered/);
}
console.log('tdvapi: ok');
