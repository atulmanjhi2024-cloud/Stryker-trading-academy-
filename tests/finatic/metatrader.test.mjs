// MetaTrader 4 / 5 accounts (Owner 21 Nov, AUTO-MTHELP): symbol map, lots, gross exposure, the order route's MT path.
// Every broker call is a STUB: nothing here reaches a real broker. Sample data only. Run: node tests/finatic/metatrader.test.mjs
import assert from 'node:assert/strict';
import { memStore } from './_store.mjs';
import * as L from '../../assets/chart-live-core.js';
import * as O from '../../functions/connect/finatic/order.js';
import { generateKeyPairSync, createSign } from 'node:crypto';

// ---- account records ----------------------------------------------------------------------------------------------------
assert.equal(L.mtPlatform({ brokerId: 'metatrader_5' }), 'MT5');
assert.equal(L.mtPlatform({ brokerName: 'MetaTrader 4' }), 'MT4');
assert.equal(L.mtPlatform({ broker: 'mt5' }), 'MT5');
assert.equal(L.mtPlatform({ brokerId: 'tradovate' }), '');
assert.equal(L.mtPlatform({ brokerName: 'Rithmic', accountName: 'MT5 lookalike' }), '', 'account name is not a platform field');
const ai = L.acctInfo({ accountId: 'a1', brokerId: 'metatrader_5', accountNumber: '5551234' });
assert.equal(ai.mt, 'MT5'); assert.equal(ai.broker, 'MetaTrader 5');
assert.equal(L.acctInfo({ accountId: 'a2', brokerId: 'tradovate' }).mt, '');
assert.ok(L.FIRMS.includes('FundingPips'));

// ---- chart symbol -> MetaTrader key -----------------------------------------------------------------------------------
for (const s of ['NQ1!', 'CME_MINI:NQ1!', 'MNQ1!', 'NDX', 'NAS100']) assert.equal(L.mtChartKey(s).key, 'NDX', s);
assert.equal(L.mtChartKey('ES1!').key, 'SPX'); assert.equal(L.mtChartKey('GC1!').key, 'XAU');
assert.equal(L.mtChartKey('NQ1!').same, false, 'a futures chart is not the CFD price');
assert.deepEqual([L.mtChartKey('EURUSD').key, L.mtChartKey('EURUSD').same], ['EURUSD', true]);
assert.equal(L.mtChartKey('XAUUSD').same, true);
assert.equal(L.mtChartKey('BTCUSDT').key, 'BTCUSD');
assert.equal(L.mtChartKey('AAPL'), null);
// broker symbol list matches (exact + suffix forms), junk ignored
assert.deepEqual(L.mtMatches('NDX', ['EURUSD', 'NDX100', 'US100.cash', 'NAS100m', 'XAUUSD', 'bad sym', 'US500']), ['NDX100', 'US100.cash', 'NAS100m']);
assert.deepEqual(L.mtMatches('EURUSD', ['EURUSD.m', 'EURGBP']), ['EURUSD.m']);
assert.deepEqual(L.mtMatches('NDX', null), []);
// symbol list from the schema enum + the account's own records
const schema = { properties: { order: { properties: { symbol: { enum: ['NDX100', 'EURUSD'] }, volume_min: 0.1, volume_step: 0.1 } } }, supportedOrderTypesByAssetClass: { cfd: ['market'], forex: ['market'] } };
assert.deepEqual(L.mtSymbolList(schema, [{ symbol: 'XAUUSD' }], [{ legs: [{ symbol: 'US30' }] }]).sort(), ['EURUSD', 'NDX100', 'US30', 'XAUUSD']);
assert.deepEqual(L.mtSymbolList(null, [], []), []);
// lots
assert.deepEqual(L.mtLots({}), { min: 0.01, step: 0.01, max: Infinity, fromSchema: false });
assert.deepEqual(L.mtLots(schema), { min: 0.1, step: 0.1, max: Infinity, fromSchema: true });
assert.deepEqual(L.mtLots({ volume_max: 50 }).max, 50, 'broker max, no TradeZoro cap');
const r = L.mtLots({});
assert.equal(L.roundLots(0.257, r), 0.25); assert.equal(L.roundLots(0.005, r), 0); assert.equal(L.roundLots(9, r), 9); assert.equal(L.roundLots(0.1 + 0.2, r), 0.3);
assert.equal(L.roundLots(0.35, L.mtLots(schema)), 0.3);
assert.equal(L.mtAsset(schema), 'cfd'); assert.equal(L.mtAsset({}), 'forex');
// gross exposure: longs and shorts add up (hedging accounts)
const pos = [{ symbol: 'NDX100', quantity: 1.5 }, { symbol: 'NDX100', quantity: -0.4 }, { symbol: 'EURUSD', quantity: 1 }];
// net position on a broker symbol (exact, case-insensitive, not a prefix)
assert.equal(L.netPosition([{ symbol: 'NDX100', quantity: 0.3 }, { symbol: 'NDX1000', quantity: 9 }], 'NDX100').qty, 0.3);
assert.equal(L.matches({ symbol: 'us100.cash' }, 'US100.cash'), true);
assert.equal(L.matches({ securityId: 'NQZ6' }, 'NQZ6'), true, 'futures path unchanged');
// panel order body
let b = L.buildPlaceMt({ sym: 'NDX100', side: 'buy', qty: 0.1, type: 'market', asset: 'cfd' });
assert.deepEqual(b.body, { op: 'place', venue: 'mt', symbol: 'NDX100', side: 'buy', qty: 0.1, type: 'market', assetType: 'cfd', timeInForce: 'gtc' });
assert.match(L.buildPlaceMt({ sym: 'NDX100', side: 'buy', qty: 0.1, type: 'limit', price: 20000, same: false }).error, /only market/);
assert.equal(L.buildPlaceMt({ sym: 'EURUSD', side: 'sell', qty: 0.02, type: 'limit', price: 1.083456, same: true }).body.limitPrice, 1.08346);
assert.match(L.buildPlaceMt({ sym: 'NDX100', side: 'buy', qty: 0.015, type: 'market' }).error, /steps of 0.01/);
assert.match(L.buildPlaceMt({ sym: '', side: 'buy', qty: 0.1, type: 'market' }).error, /broker symbol/);

// ---- the order route, MT path (stubs) ---------------------------------------------------------------------------------
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (uid) => { const t = Math.floor(Date.now() / 1000); const h = b64({ alg: 'RS256', kid: 'k1' }), p = b64({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: uid, iat: t - 5, exp: t + 3000 }); return h + '.' + p + '.' + createSign('RSA-SHA256').update(h + '.' + p).sign(privateKey, 'base64url'); };
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const verifyFetch = async (url) => { if (String(url).includes('jwk/securetoken')) return new Response(JSON.stringify({ keys: [jwk] })); return /admins\/admin1$/.test(String(url)) ? new Response('{}') : new Response('{}', { status: 404 }); };
const US = '0aaa1111-2222-3333-4444-555566667777', ACC = '123e4567-e89b-12d3-a456-426614174000';
const ok = (data) => new Response(JSON.stringify({ data, errors: [] }), { status: 200 });
const B = { acct: { accountId: ACC, brokerId: 'metatrader_5', accountNumber: '5551234' }, positions: [], orders: [], calls: [], bodies: [] };
const finFetch = async (url, init) => {
  const u = new URL(url);
  B.calls.push({ m: init.method, p: u.pathname });
  if (u.pathname === '/api/v1/session/init') return ok({ one_time_token: 'ott' });
  if (u.pathname === '/api/v1/session/start') return ok({ session_id: 's', company_id: 'c', status: 'active', user_id: US });
  if (u.pathname === '/api/v1/accounts' && init.method === 'GET') return ok([{ accountId: ACC }]);   // member live: the ownership list
  if (u.pathname === '/api/v1/accounts/' + ACC && init.method === 'GET') return ok(B.acct);
  if (u.pathname.endsWith('/positions')) return ok(B.positions);
  if (u.pathname.endsWith('/orders') && init.method === 'GET') return ok(B.orders);
  if (/\/orders(\/[^/]+)?$/.test(u.pathname) && init.method !== 'GET') { B.bodies.push({ m: init.method, p: u.pathname, body: init.body ? JSON.parse(init.body) : null }); return ok({ accepted: true, order: { orderId: 'mt-1', status: 'SUBMITTED' } }); }
  return ok([]);
};
const audits = new Map();
const audit = async (e, id) => { if (id && audits.has(id)) { const er = new Error('dup'); er.duplicate = true; throw er; } const row = { ...e }; audits.set(id || 'r' + audits.size, row); return { finish: async (x) => Object.assign(row, x) }; };
const deps = { store: memStore({ consent: ['admin1'] }), verifyFetch, finFetch, audit, brackets: new Map(), liveSwitch: async () => true, now: () => Date.parse('2026-11-15T15:00:00Z'), sleep: async () => {} };
const live = { FINATIC_API_KEY: 'fntc_live_FAKE', FINATIC_LIVE_ORDERS: '1', DEV: '0' };
let ip = 1, n = 0;
const req = (body) => new Request('https://tradezoro.com/connect/finatic/order', { method: 'POST', headers: { 'cf-connecting-ip': '10.9.' + (ip++ % 250) + '.1', origin: 'https://tradezoro.com', 'content-type': 'application/json', authorization: 'Bearer ' + token('admin1') }, body: JSON.stringify(body) });
const send = async (x) => { const r = await O.handle(req({ src: 'chart', venue: 'mt', accountId: ACC, userId: US, idemKey: 'mt' + String(++n).padStart(20, '0'), ...x }), live, deps); return { status: r.status, j: await r.json() }; };

let x = await send({ op: 'place', symbol: 'NDX100', side: 'buy', qty: 0.1, type: 'market', assetType: 'cfd' });
assert.equal(x.status, 200, JSON.stringify(x.j)); assert.equal(x.j.orderId, 'mt-1');
let sent = B.bodies.at(-1).body.order;
assert.equal(sent.symbol, 'NDX100'); assert.equal(sent.orderQty, 0.1); assert.equal(sent.assetType, 'cfd'); assert.equal(sent.orderType, 'market'); assert.equal(sent.action, 'buy');
// symbol case kept (MT symbols are case sensitive)
x = await send({ op: 'place', symbol: 'US100.cash', side: 'sell', qty: 0.05, type: 'market' });
assert.equal(x.status, 200); assert.equal(B.bodies.at(-1).body.order.symbol, 'US100.cash'); assert.equal(B.bodies.at(-1).body.order.assetType, 'forex');
// lots rules
const before = B.bodies.length;
assert.equal((await send({ op: 'place', symbol: 'NDX100', side: 'buy', qty: 0.015, type: 'market' })).status, 400);
assert.equal((await send({ op: 'place', symbol: 'NDX100', side: 'buy', qty: 0.1, type: 'stop_limit', stopPrice: 1, limitPrice: 1 })).status, 400);
assert.equal((await send({ op: 'place', symbol: 'NDX100', side: 'buy', qty: 0.1, type: 'market', bracket: { sl: 1 } })).status, 400);
assert.equal((await send({ op: 'flatten', symbol: 'NDX100' })).j.code, 'mt_unsupported');
// no TradeZoro size / exposure limit (21 Nov): a big lot size is sent on, the broker decides
B.positions = [{ symbol: 'NDX100', quantity: 1.5 }];
x = await send({ op: 'place', symbol: 'NDX100', side: 'sell', qty: 5, type: 'market' });
assert.equal(x.status, 200, JSON.stringify(x.j)); B.positions = [];
// not a MetaTrader account: the MT path is refused (a futures account can't skip the contract rules)
B.acct = { accountId: ACC, brokerId: 'tradovate' };
x = await send({ op: 'place', symbol: 'NDX100', side: 'buy', qty: 0.1, type: 'market' });
assert.equal(x.status, 400); assert.equal(x.j.code, 'not_mt');
assert.equal(B.bodies.length, before + 1, 'only the big-lot order reached the broker stub');
// cancel on MT
B.acct = { accountId: ACC, brokerName: 'MetaTrader 4' };
x = await send({ op: 'cancel', orderId: 'mt-9' });
assert.equal(x.status, 200, JSON.stringify(x.j));
// the futures path without venue is unchanged: lots refused there
const fr = await O.handle(req({ src: 'chart', accountId: ACC, userId: US, idemKey: 'ft' + '0'.repeat(20), op: 'place', symbol: 'NDX100', side: 'buy', qty: 0.1, type: 'market' }), live, deps);
assert.equal(fr.status, 400);
console.log('metatrader: ok');
