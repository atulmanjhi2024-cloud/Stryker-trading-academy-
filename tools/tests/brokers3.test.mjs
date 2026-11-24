// BROKERS 3 unit tests (tastytrade, TradeStation, OANDA direct trading). MOCKED broker answers only: every upstream call goes to an
// in-memory fake keyed by host + path; any other host throws. Nothing ever reaches a broker. Run: node tools/tests/brokers3.test.mjs
// Covers: host guard (no live host while a live flag is off, for every broker and every op), symbol / size mapping, the route's gates
// (method, origin, configured / coming soon, live_off, sign-in, admin-or-beta, token, account ownership, key, master switch, consent,
// block, audit-before-order, duplicate key), each adapter's calls + answers + error paths with the origin of the words, unclear answers
// (never re-sent; found by key / 'unknown'), token swap / refresh (secret stays server side), and the browser module's ops + feed.
import assert from 'node:assert/strict';
import { webcrypto as C } from 'node:crypto';
import { BROKERS, allowedHost, guardFetch, LIVE_HOSTS, liveOn } from '../../functions/connect/brokers/_hosts.js';
import { handle, clean, configured, _resetBrokers, MSG } from '../../functions/connect/brokers/trade.js';
import { handle as tokHandle } from '../../functions/connect/brokers/token.js';
import { toBroker, fromBroker, oandaInstrument, oandaRules, unitsOf, roundPx, fullYear, oandaDisplay } from '../../assets/broker-trade-map.js';
if (!globalThis.crypto) globalThis.crypto = C;
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const ORIGIN = 'https://tradezoro.com';
const NOW = Date.UTC(2026, 10, 24);
const ENV = { TASTY_SANDBOX_CLIENT_ID: 'tcid', TASTY_SANDBOX_CLIENT_SECRET: 'tsec-SAMPLE', TS_CLIENT_ID: 'scid', TS_CLIENT_SECRET: 'ssec-SAMPLE', OANDA_TRADE_ENABLED: '1' };
const TOKEN = 'tok_SAMPLE_0123456789abcdef';
const KEY = 'k-0123456789abcdef01';

// ---------------------------------------------------------------- fake brokers
function fake(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    const u = new URL(url), k = (init.method || 'GET') + ' ' + u.host + u.pathname + (u.search || '');
    calls.push({ k, url, init, body: init.body ? (/^\{/.test(init.body) ? JSON.parse(init.body) : init.body) : null, headers: init.headers || {} });
    const hit = Object.keys(routes).find((p) => (p.endsWith('*') ? k.startsWith(p.slice(0, -1)) : k === p));
    if (!hit) throw new Error('UNMOCKED ' + k);
    let r = routes[hit]; if (typeof r === 'function') r = await r(calls[calls.length - 1]);
    if (r === 'NETWORK') throw new TypeError('fetch failed');
    const st = r.status || 200, body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body || {});
    return new Response(body, { status: st, headers: { 'content-type': 'application/json' } });
  };
  return { f, calls };
}
const TT = 'api.cert.tastyworks.com', TS = 'sim-api.tradestation.com', OA = 'api-fxpractice.oanda.com';
const ttRoutes = (over = {}) => ({
  ['GET ' + TT + '/customers/me/accounts']: { body: { data: { items: [{ account: { 'account-number': '5WT00001', nickname: 'Sample', 'margin-or-cash': 'Margin' } }] } } },
  ['GET ' + TT + '/accounts/5WT00001/positions']: { body: { data: { items: [{ symbol: '/NQZ6', 'instrument-type': 'Future', quantity: '2', 'quantity-direction': 'Long', 'average-open-price': '21000.25' }] } } },
  ['GET ' + TT + '/accounts/5WT00001/orders/live']: { body: { data: { items: [{ id: 11, status: 'Live', 'order-type': 'Limit', price: '20900.0', 'external-identifier': 'x-other', legs: [{ symbol: '/NQZ6', action: 'Buy to Open', quantity: '1', 'remaining-quantity': '1', 'instrument-type': 'Future' }] }] } } },
  ['GET ' + TT + '/accounts/5WT00001/balances']: { body: { data: { 'net-liquidating-value': '100000.5', 'cash-balance': '99000', currency: 'USD' } } },
  ['POST ' + TT + '/accounts/5WT00001/orders']: { status: 201, body: { data: { order: { id: 77, status: 'Received' } } } },
  ['POST ' + TT + '/accounts/5WT00001/complex-orders']: { status: 201, body: { data: { 'complex-order': { id: 5, 'trigger-order': { id: 78 } } } } },
  ['DELETE ' + TT + '/accounts/5WT00001/orders/11']: { body: { data: { id: 11, status: 'Cancel Requested' } } },
  ['GET ' + TT + '/accounts/5WT00001/orders/11']: { body: { data: { id: 11, 'order-type': 'Limit', 'time-in-force': 'Day', price: '20900.0', 'price-effect': 'Debit', legs: [{ 'instrument-type': 'Future', symbol: '/NQZ6', quantity: 1, action: 'Buy to Open' }] } } },
  ['PUT ' + TT + '/accounts/5WT00001/orders/11']: { body: { data: { id: 12 } } },
  ...over
});
const gatesOk = (o = {}) => {
  const audits = new Map(), log = [];
  return { audits, log, deps: {
    verify: async () => 'uid1', allowed: async () => true, liveSwitch: async () => true, defer: (p) => p,
    store: { get: async (p) => (p.startsWith('liveConsent/') ? { uid: 'uid1', version: '2026-11-21' } : p === 'settings/liveBlocked' ? {} : null) },
    audit: async (entry, id) => { if (audits.has(id)) { const e = new Error('dup'); e.duplicate = true; throw e; } audits.set(id, { ...entry, result: 'attempt' }); log.push('audit'); return { id, finish: async (r) => Object.assign(audits.get(id), r) }; },
    ...o } };
};
let ip = 0;
const req = (body, { origin = ORIGIN, method = 'POST', ct = 'application/json' } = {}) => new Request('https://tradezoro.com/connect/brokers/trade', { method, headers: { origin, 'content-type': ct, authorization: 'Bearer IDT', 'cf-connecting-ip': '10.0.0.' + (ip++ % 250) }, body: method === 'POST' ? JSON.stringify(body) : undefined });
const J = async (r) => ({ status: r.status, j: await r.json() });
const resetOwner = async () => { const m = await import('../../functions/connect/finatic/_owner.js'); m._resetOwner(); };

// ================================================================ host guard
await t('live hosts are unreachable while every live flag is off (every broker, REST + stream)', async () => {
  for (const b of Object.keys(BROKERS)) {
    assert.equal(liveOn({}, b), false);
    for (const h of [BROKERS[b].api.live, BROKERS[b].stream && BROKERS[b].stream.live].filter(Boolean)) {
      assert.equal(allowedHost({}, b, h + '/anything'), false, b + ' ' + h);
      await assert.rejects(guardFetch({}, b, h + '/x', {}, async () => { throw new Error('REACHED ' + h); }), (e) => e.code === 'live_off');
    }
    assert.equal(allowedHost({}, b, BROKERS[b].api.sandbox + '/x'), true);
  }
  assert.ok(LIVE_HOSTS.has('api.tastyworks.com') && LIVE_HOSTS.has('api.tradestation.com') && LIVE_HOSTS.has('api-fxtrade.oanda.com'));
});
await t('one live flag opens only its own broker; unknown hosts never pass; http is refused', async () => {
  const env = { TASTY_TRADE_LIVE: '1' };
  assert.equal(allowedHost(env, 'tastytrade', 'https://api.tastyworks.com/x'), true);
  assert.equal(allowedHost(env, 'tradestation', 'https://api.tradestation.com/x'), false);
  assert.equal(allowedHost(env, 'oanda', 'https://api-fxtrade.oanda.com/x'), false);
  assert.equal(allowedHost(env, 'tastytrade', 'https://api.tradestation.com/x'), false);   // another broker's host
  assert.equal(allowedHost({}, 'tastytrade', 'https://evil.example/x'), false);
  assert.equal(allowedHost({}, 'tastytrade', 'http://api.cert.tastyworks.com/x'), false);
  assert.equal(allowedHost({ TASTY_TRADE_LIVE: 'true' }, 'tastytrade', 'https://api.tastyworks.com/x'), false);   // only "1"
});
await t('the ROUTE never reaches a live host with flags off: env=live refused before any call, for every op', async () => {
  for (const b of ['tastytrade', 'tradestation', 'oanda']) for (const op of ['accounts', 'live', 'place', 'cancel', 'flatten', 'modify', 'env']) {
    const F = fake({}); const G = gatesOk({ fetchImpl: F.f });
    const r = await J(await handle(req({ broker: b, env: 'live', op, token: TOKEN, accountId: 'A1', idemKey: KEY, symbol: 'NQZ6', side: 'buy', qty: 1, type: 'market' }), ENV, G.deps));
    assert.equal(r.status, 403); assert.equal(r.j.code, 'live_off'); assert.equal(F.calls.length, 0); assert.equal(G.audits.size, 0);
  }
});
await t('the token route refuses live too, and never posts to a live token host', async () => {
  for (const b of ['tastytrade', 'tradestation']) {
    const F = fake({});
    const r = await tokHandle(new Request('https://tradezoro.com/connect/brokers/token', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', authorization: 'Bearer IDT' }, body: JSON.stringify({ broker: b, env: 'live', grant: 'code', code: 'CODE12345678' }) }), ENV, { verify: async () => 'u', allowed: async () => true, fetchImpl: F.f });
    assert.equal(r.status, 403); assert.equal(F.calls.length, 0);
    const g = await tokHandle(new Request('https://tradezoro.com/connect/brokers/token?broker=' + b + '&env=live'), ENV);
    assert.equal(g.status, 503);
  }
});

// ================================================================ mapping
await t('futures map to each broker format incl. the year digit', () => {
  assert.equal(toBroker('tastytrade', 'NQZ6', 'future', NOW), '/NQZ6');
  assert.equal(toBroker('tastytrade', 'MNQH7', 'future', NOW), '/MNQH7');
  assert.equal(toBroker('tradestation', 'ESZ6', 'future', NOW), 'ESZ26');
  assert.equal(toBroker('tradestation', 'MESH7', 'future', NOW), 'MESH27');
  assert.equal(fullYear('6', NOW), 2026); assert.equal(fullYear('5', NOW), 2025); assert.equal(fullYear('0', NOW), 2030);
  assert.equal(fromBroker('tastytrade', '/NQZ6'), 'NQZ6'); assert.equal(fromBroker('tradestation', 'NQZ26'), 'NQZ6'); assert.equal(fromBroker('tradestation', 'AAPL'), 'AAPL');
  assert.equal(toBroker('tastytrade', 'AAPL', 'equity'), 'AAPL'); assert.equal(toBroker('tastytrade', 'AAPL  261218C00200000', 'option'), 'AAPL  261218C00200000');
  assert.equal(toBroker('tradestation', 'AAPL 261218C200', 'option'), 'AAPL 261218C200'); assert.equal(toBroker('tastytrade', 'bad sym', 'option'), '');
});
await t('OANDA instruments: forex, metals, CFDs; lots <-> units; rounding', () => {
  assert.equal(oandaInstrument('EURUSD'), 'EUR_USD'); assert.equal(oandaInstrument('fx:USDJPY'), 'USD_JPY'); assert.equal(oandaInstrument('XAUUSD'), 'XAU_USD');
  assert.equal(oandaInstrument('NQ1!'), 'NAS100_USD'); assert.equal(oandaInstrument('MESZ6'), 'SPX500_USD'); assert.equal(oandaInstrument('CL1!'), 'WTICO_USD'); assert.equal(oandaInstrument('GC1!'), 'XAU_USD');
  assert.equal(oandaInstrument('NAS100'), 'NAS100_USD'); assert.equal(oandaInstrument('EUR_USD'), 'EUR_USD'); assert.equal(oandaInstrument('DOGE'), '');
  assert.equal(oandaDisplay('NAS100_USD'), 'NAS100'); assert.equal(oandaDisplay('EUR_USD'), 'EURUSD');
  const r = oandaRules({ name: 'EUR_USD', tradeUnitsPrecision: 0, minimumTradeSize: '1', maximumOrderUnits: '100000000', displayPrecision: 5 });
  assert.equal(r.lotSize, 100000); assert.equal(r.step, 0.01); assert.equal(r.min, 0.01); assert.equal(r.max, 10); assert.equal(unitsOf(0.25, r), 25000);
  const g = oandaRules({ name: 'XAU_USD', tradeUnitsPrecision: 0, minimumTradeSize: '1', displayPrecision: 3 }); assert.equal(g.lotSize, 100); assert.equal(unitsOf(0.05, g), 5);
  assert.equal(roundPx(21000.13, 0.25), 21000.25); assert.equal(roundPx(1.234567, 0.00001), 1.23457);
});
await t('clean(): whole contracts, prices rounded to the tick, bracket sides checked', () => {
  assert.ok(clean({ symbol: 'NQZ6', side: 'buy', qty: 1.5, type: 'market' }, 'tastytrade').error);
  assert.ok(clean({ symbol: 'NQZ6', side: 'hold', qty: 1, type: 'market' }, 'tastytrade').error);
  assert.ok(clean({ symbol: 'EURUSD', side: 'buy', qty: 1, type: 'stop_limit', limitPrice: 1, stopPrice: 1 }, 'oanda').error);
  const c = clean({ symbol: 'NQZ6', side: 'buy', qty: 2, type: 'limit', limitPrice: 21000.13, tick: 0.25, evil: 1 }, 'tastytrade').order;
  assert.equal(c.limitPrice, 21000.25); assert.equal(c.evil, undefined); assert.equal(c.kind, 'future');
  assert.ok(clean({ symbol: 'NQZ6', side: 'buy', qty: 1, type: 'limit', limitPrice: 100, sl: 101 }, 'tastytrade').error);   // stop above a buy
  assert.ok(clean({ symbol: 'NQZ6', side: 'sell', qty: 1, type: 'limit', limitPrice: 100, tp: 101 }, 'tastytrade').error);
  assert.deepEqual(clean({ symbol: 'NQZ6', side: 'buy', qty: 1, type: 'limit', limitPrice: 100, sl: 99, tp: 102, tick: 0.25 }, 'tastytrade').order.bracket, { sl: 99, tp: 102 });
  assert.equal(clean({ symbol: 'EURUSD', side: 'buy', qty: 0.05, type: 'market' }, 'oanda').order.qty, 0.05);
});

// ================================================================ route gates
await t('GET probe: configured / coming soon per broker, never a secret', async () => {
  const r = await J(await handle(new Request('https://tradezoro.com/connect/brokers/trade?broker=tastytrade'), ENV));
  assert.equal(r.j.configured, true); assert.equal(r.j.client_id, 'tcid'); assert.ok(!JSON.stringify(r.j).includes('SAMPLE'));
  const r2 = await J(await handle(new Request('https://tradezoro.com/connect/brokers/trade?broker=tradestation'), {}));
  assert.equal(r2.status, 503); assert.deepEqual(r2.j, { configured: false, broker: 'tradestation', live: false });
  const r3 = await J(await handle(req({ broker: 'oanda', op: 'accounts', token: TOKEN }), {}, gatesOk().deps));
  assert.equal(r3.status, 503); assert.equal(r3.j.configured, false); assert.match(r3.j.error, /coming soon/);
});
await t('door: method, origin, JSON, broker, sign-in, admin-or-beta, token', async () => {
  const G = gatesOk();
  assert.equal((await handle(new Request('https://tradezoro.com/x', { method: 'PUT' }), ENV, G.deps)).status, 405);
  assert.equal((await handle(req({ broker: 'tastytrade', op: 'accounts', token: TOKEN }, { origin: 'https://evil.example' }), ENV, G.deps)).status, 403);
  assert.equal((await handle(req({ broker: 'tastytrade', op: 'accounts' }, { ct: 'text/plain' }), ENV, G.deps)).status, 415);
  assert.equal((await handle(req({ broker: 'robinhood', op: 'accounts', token: TOKEN }), ENV, G.deps)).status, 400);
  assert.equal((await J(await handle(req({ broker: 'tastytrade', op: 'accounts', token: TOKEN }), ENV, gatesOk({ verify: async () => null }).deps))).status, 401);
  const na = await J(await handle(req({ broker: 'tastytrade', op: 'accounts', token: TOKEN }), ENV, gatesOk({ allowed: async () => false }).deps));
  assert.equal(na.status, 403); assert.equal(na.j.code, 'not_admin');
  const thr = await J(await handle(req({ broker: 'tastytrade', op: 'accounts', token: TOKEN }), ENV, gatesOk({ allowed: async () => { throw new Error('x'); } }).deps));
  assert.equal(thr.status, 403);   // fails closed
  const nt = await J(await handle(req({ broker: 'tastytrade', op: 'accounts', token: 'short' }), ENV, G.deps));
  assert.equal(nt.status, 409); assert.equal(nt.j.needsConnect, true);
});
await t('account must be on this sign-in; tastytrade sends User-Agent + bearer', async () => {
  _resetBrokers(); const F = fake(ttRoutes()); const G = gatesOk({ fetchImpl: F.f });
  const r = await J(await handle(req({ broker: 'tastytrade', op: 'live', token: TOKEN, accountId: '5WT99999' }), ENV, G.deps));
  assert.equal(r.status, 403); assert.equal(r.j.code, 'not_owner');
  const c = F.calls[0]; assert.equal(c.headers['User-Agent'], 'tradezoro/1.0'); assert.equal(c.headers.Authorization, 'Bearer ' + TOKEN);
  assert.ok(F.calls.every((x) => new URL(x.url).host === TT));
});
await t('tastytrade reads: accounts, positions + live orders mapped, balance', async () => {
  _resetBrokers(); const F = fake(ttRoutes()); const G = gatesOk({ fetchImpl: F.f });
  const a = await J(await handle(req({ broker: 'tastytrade', op: 'accounts', token: TOKEN }), ENV, G.deps));
  assert.deepEqual(a.j.data, [{ accountId: '5WT00001', accountNumber: '5WT00001', accountName: 'Sample', kind: 'Margin' }]);
  const l = await J(await handle(req({ broker: 'tastytrade', op: 'live', token: TOKEN, accountId: '5WT00001' }), ENV, G.deps));
  assert.equal(l.j.data.positions[0].symbol, 'NQZ6'); assert.equal(l.j.data.positions[0].quantity, 2);
  assert.equal(l.j.data.orders[0].status, 'WORKING'); assert.equal(l.j.data.orders[0].legs[0].symbol, 'NQZ6'); assert.equal(l.j.data.orders[0].legs[0].limitPrice, 20900);
  const b = await J(await handle(req({ broker: 'tastytrade', op: 'balances', token: TOKEN, accountId: '5WT00001' }), ENV, G.deps));
  assert.equal(b.j.data[0].netLiquidationValue, 100000.5);
  const e = await J(await handle(req({ broker: 'tastytrade', op: 'env', token: TOKEN, accountId: '5WT00001' }), ENV, G.deps));
  assert.deepEqual(e.j, { env: 'sandbox', enabled: true, consent: true, blocked: false, broker: 'tastytrade' });
});
const place = (b, extra = {}, o = {}) => req({ broker: b, op: 'place', token: TOKEN, idemKey: KEY, side: 'buy', qty: 1, type: 'market', ...extra }, o);
await t('writes: key, master switch, consent, block, audit - each refuses with nothing sent', async () => {
  await resetOwner();
  const cases = [
    [{ idemKey: 'short' }, {}, 'key'],
    [{}, { liveSwitch: async () => false }, 'switched_off'],
    [{}, { liveSwitch: async () => { throw new Error('x'); } }, 'switch_unreadable'],
    [{}, { store: { get: async (p) => (p === 'settings/liveBlocked' ? {} : null) } }, 'consent_needed'],
    [{}, { store: { get: async (p) => { if (p.startsWith('liveConsent')) throw new Error('down'); return {}; } } }, 'consent_unreadable'],
    [{}, { store: { get: async (p) => (p.startsWith('liveConsent/') ? { uid: 'uid1', version: '2026-11-21' } : { uid1: true }) } }, 'member_blocked'],
    [{}, { audit: async () => { throw new Error('fs down'); } }, 'audit']
  ];
  for (const [extra, over, code] of cases) {
    await resetOwner(); _resetBrokers();
    const F = fake(ttRoutes()); const G = gatesOk({ fetchImpl: F.f, ...over });
    const r = await J(await handle(place('tastytrade', { accountId: '5WT00001', symbol: 'NQZ6', ...extra }), ENV, G.deps));
    assert.equal(r.j.code, code, code); assert.ok(!F.calls.some((c) => c.init.method === 'POST'), code + ': no order posted');
  }
});
await t('tastytrade place: market future, Buy to Open, external id = key, audit BEFORE the order; duplicate key never sent twice', async () => {
  await resetOwner(); _resetBrokers();
  const order = []; const F = fake(ttRoutes({ ['POST ' + TT + '/accounts/5WT00001/orders']: () => { order.push('order'); return { status: 201, body: { data: { order: { id: 77, status: 'Received' } } } }; } }));
  const G = gatesOk({ fetchImpl: F.f, audit: async (e, id) => { order.push('audit:' + id + ':' + e.venue + ':' + e.env); return { id, finish: async () => {} }; } });
  const r = await J(await handle(place('tastytrade', { accountId: '5WT00001', symbol: 'MESZ6', qty: 1 }), ENV, G.deps));
  assert.equal(r.status, 200); assert.equal(r.j.orderId, '77'); assert.equal(r.j.status, 'RECEIVED');
  assert.deepEqual(order, ['audit:b3-ta-' + KEY + ':tastytrade:sandbox', 'order']);
  const b = F.calls.find((c) => c.init.method === 'POST').body;
  assert.equal(b['order-type'], 'Market'); assert.equal(b['time-in-force'], 'Day'); assert.equal(b['external-identifier'], KEY);
  assert.deepEqual(b.legs, [{ 'instrument-type': 'Future', symbol: '/MESZ6', quantity: 1, action: 'Buy to Open' }]);
  // duplicate
  const G2 = gatesOk({ fetchImpl: F.f }); await handle(place('tastytrade', { accountId: '5WT00001', symbol: 'MESZ6' }), ENV, G2.deps);
  const before = F.calls.filter((c) => c.init.method === 'POST').length;
  const d = await J(await handle(place('tastytrade', { accountId: '5WT00001', symbol: 'MESZ6' }), ENV, G2.deps));
  assert.equal(d.j.code, 'duplicate'); assert.equal(F.calls.filter((c) => c.init.method === 'POST').length, before);
});
await t('tastytrade: selling a held long = Sell to Close; crossing through zero refused; limit price-effect; equities + options', async () => {
  await resetOwner(); _resetBrokers(); const F = fake(ttRoutes()); const G = gatesOk({ fetchImpl: F.f });
  await handle(place('tastytrade', { accountId: '5WT00001', symbol: 'NQZ6', side: 'sell', qty: 2, type: 'limit', limitPrice: 21100, tick: 0.25, idemKey: KEY + 'a' }), ENV, G.deps);
  let b = F.calls.filter((c) => c.init.method === 'POST').pop().body;
  assert.equal(b.legs[0].action, 'Sell to Close'); assert.equal(b['price-effect'], 'Credit'); assert.equal(b.price, '21100'); assert.equal(b['time-in-force'], 'Day');
  const x = await J(await handle(place('tastytrade', { accountId: '5WT00001', symbol: 'NQZ6', side: 'sell', qty: 3, idemKey: KEY + 'b' }), ENV, G.deps));
  assert.equal(x.j.code, 'cross'); assert.match(x.j.error, /^TradeZoro: /);
  await handle(place('tastytrade', { accountId: '5WT00001', symbol: 'AAPL', assetType: 'equity', type: 'stop', stopPrice: 150, idemKey: KEY + 'c' }), ENV, G.deps);
  b = F.calls.filter((c) => c.init.method === 'POST').pop().body; assert.equal(b.legs[0]['instrument-type'], 'Equity'); assert.equal(b['stop-trigger'], '150'); assert.equal(b['order-type'], 'Stop');
  await handle(place('tastytrade', { accountId: '5WT00001', symbol: 'AAPL  261218C00200000', assetType: 'option', type: 'limit', limitPrice: 1.05, idemKey: KEY + 'd' }), ENV, G.deps);
  b = F.calls.filter((c) => c.init.method === 'POST').pop().body; assert.equal(b.legs[0]['instrument-type'], 'Equity Option'); assert.equal(b.legs[0].symbol, 'AAPL  261218C00200000');
});
await t('tastytrade bracket = one OTOCO (profit Limit + Stop, GTC, to Close)', async () => {
  await resetOwner(); _resetBrokers(); const F = fake(ttRoutes()); const G = gatesOk({ fetchImpl: F.f });
  const r = await J(await handle(place('tastytrade', { accountId: '5WT00001', symbol: 'ESZ6', type: 'limit', limitPrice: 6000, sl: 5990, tp: 6020, tick: 0.25 }), ENV, G.deps));
  assert.equal(r.status, 200); assert.equal(r.j.complexOrderId, '5'); assert.deepEqual(r.j.bracket, { native: true });
  const b = F.calls.find((c) => c.url.includes('complex-orders')).body;
  assert.equal(b.type, 'OTOCO'); assert.equal(b['trigger-order']['external-identifier'], KEY);
  assert.deepEqual(b.orders.map((o) => [o['order-type'], o.price || o['stop-trigger'], o.legs[0].action]), [['Limit', '6020', 'Sell to Close'], ['Stop', '5990', 'Sell to Close']]);
});
await t('tastytrade errors keep their origin: preflight 422, expired token 401, unclear 5xx found by key / unknown', async () => {
  await resetOwner(); _resetBrokers();
  let F = fake(ttRoutes({ ['POST ' + TT + '/accounts/5WT00001/orders']: { status: 422, body: { error: { code: 'preflight_check_failure', message: 'One or more preflight checks failed', errors: [{ code: 'margin_check_failed', message: 'Insufficient buying power.' }] } } } }));
  let r = await J(await handle(place('tastytrade', { accountId: '5WT00001', symbol: 'NQZ6' }), ENV, gatesOk({ fetchImpl: F.f }).deps));
  assert.equal(r.status, 400); assert.equal(r.j.error, 'tastytrade said: Insufficient buying power.');
  _resetBrokers(); F = fake({ ['GET ' + TT + '/customers/me/accounts']: { status: 401, body: { error: { code: 'invalid_credentials' } } } });
  r = await J(await handle(req({ broker: 'tastytrade', op: 'accounts', token: TOKEN }), ENV, gatesOk({ fetchImpl: F.f }).deps));
  assert.equal(r.status, 401); assert.equal(r.j.reconnect, true); assert.match(r.j.error, /sign-in expired/);
  // unclear: 502 on POST, then the order IS in live orders with our key -> settled, accepted, posted ONCE
  _resetBrokers(); let posts = 0;
  F = fake(ttRoutes({ ['POST ' + TT + '/accounts/5WT00001/orders']: () => { posts++; return { status: 502, body: 'bad gateway' }; },
    ['GET ' + TT + '/accounts/5WT00001/orders/live']: () => ({ body: { data: { items: posts ? [{ id: 90, status: 'Routed', 'external-identifier': KEY, legs: [] }] : [] } } }) }));
  const G = gatesOk({ fetchImpl: F.f });
  r = await J(await handle(place('tastytrade', { accountId: '5WT00001', symbol: 'NQZ6' }), ENV, G.deps));
  assert.equal(r.status, 200); assert.equal(r.j.orderId, '90'); assert.equal(r.j.settled, true); assert.equal(posts, 1); assert.equal(G.audits.get('b3-ta-' + KEY).result, 'accepted');
  // unclear and not found -> 'unknown', never re-sent
  _resetBrokers(); posts = 0;
  F = fake(ttRoutes({ ['POST ' + TT + '/accounts/5WT00001/orders']: () => { posts++; return 'NETWORK'; } }));
  const G2 = gatesOk({ fetchImpl: F.f });
  r = await J(await handle(place('tastytrade', { accountId: '5WT00001', symbol: 'NQZ6' }), ENV, G2.deps));
  assert.equal(r.j.code, 'unknown'); assert.match(r.j.error, /may or may not/); assert.equal(posts, 1); assert.equal(G2.audits.get('b3-ta-' + KEY).result, 'unknown');
});
await t('tastytrade cancel / modify / flatten', async () => {
  await resetOwner(); _resetBrokers(); const F = fake(ttRoutes()); const G = gatesOk({ fetchImpl: F.f });
  let r = await J(await handle(req({ broker: 'tastytrade', op: 'cancel', token: TOKEN, accountId: '5WT00001', orderId: '11', idemKey: KEY + 'c1' }), ENV, G.deps));
  assert.equal(r.j.status, 'PENDING_CANCEL'); assert.ok(F.calls.some((c) => c.k === 'DELETE ' + TT + '/accounts/5WT00001/orders/11'));
  r = await J(await handle(req({ broker: 'tastytrade', op: 'cancel', token: TOKEN, accountId: '5WT00001', orderId: '999', idemKey: KEY + 'c2' }), ENV, G.deps));
  assert.equal(r.j.code, 'unknown_order');
  r = await J(await handle(req({ broker: 'tastytrade', op: 'modify', token: TOKEN, accountId: '5WT00001', orderId: '11', limitPrice: 20950.1, tick: 0.25, idemKey: KEY + 'm1' }), ENV, G.deps));
  assert.equal(r.status, 200); assert.equal(F.calls.find((c) => c.init.method === 'PUT').body.price, '20950');
  r = await J(await handle(req({ broker: 'tastytrade', op: 'modify', token: TOKEN, accountId: '5WT00001', orderId: '11', stopPrice: 1, idemKey: KEY + 'm2' }), ENV, G.deps));
  assert.equal(r.j.code, 'shape');
  const n0 = F.calls.length;
  r = await J(await handle(req({ broker: 'tastytrade', op: 'flatten', token: TOKEN, accountId: '5WT00001', symbol: 'NQZ6', idemKey: KEY + 'f1' }), ENV, G.deps));
  assert.equal(r.j.closed, 1); assert.equal(r.j.cancelled, 1);
  const post = F.calls.slice(n0).find((c) => c.init.method === 'POST').body; assert.equal(post.legs[0].action, 'Sell to Close'); assert.equal(post.legs[0].quantity, 2); assert.equal(post['order-type'], 'Market');
});

// ================================================================ TradeStation
const tsRoutes = (over = {}) => ({
  ['GET ' + TS + '/v3/brokerage/accounts']: { body: { Accounts: [{ AccountID: 'SIM1234567F', AccountType: 'Futures', Status: 'Active' }, { AccountID: '11111111', AccountType: 'Cash', Status: 'Active' }, { AccountID: 'SIM9', Status: 'Closed' }] } },
  ['GET ' + TS + '/v3/brokerage/accounts/SIM1234567F/positions']: { body: { Positions: [{ Symbol: 'ESZ26', AssetType: 'FUTURE', Quantity: '1', LongShort: 'Short', AveragePrice: '6000.25', UnrealizedProfitLoss: '-12.5' }] } },
  ['GET ' + TS + '/v3/brokerage/accounts/SIM1234567F/orders']: { body: { Orders: [{ OrderID: '901', Status: 'OPN', OrderType: 'StopMarket', StopPrice: '6050', Legs: [{ Symbol: 'ESZ26', BuyOrSell: 'Buy', QuantityOrdered: '1', QuantityRemaining: '1' }] }] } },
  ['GET ' + TS + '/v3/brokerage/accounts/SIM1234567F/balances']: { body: { Balances: [{ Equity: '50000', CashBalance: '49000', BalanceDetail: { UnrealizedProfitLoss: '-12.5' } }] } },
  ['POST ' + TS + '/v3/orderexecution/orders']: { body: { Orders: [{ OrderID: '902', Message: 'Sent order' }] } },
  ['DELETE ' + TS + '/v3/orderexecution/orders/901']: { body: { OrderID: '901', Message: 'Cancel request sent' } },
  ['PUT ' + TS + '/v3/orderexecution/orders/901']: { body: { OrderID: '901', Message: 'Replace request sent' } },
  ...over
});
await t('TradeStation: SIM accounts only on sandbox; positions / orders / balance mapped; all calls on sim-api', async () => {
  await resetOwner(); _resetBrokers(); const F = fake(tsRoutes()); const G = gatesOk({ fetchImpl: F.f });
  const a = await J(await handle(req({ broker: 'tradestation', op: 'accounts', token: TOKEN }), ENV, G.deps));
  assert.deepEqual(a.j.data.map((x) => x.accountId), ['SIM1234567F']);
  const r = await J(await handle(req({ broker: 'tradestation', op: 'live', token: TOKEN, accountId: '11111111' }), ENV, G.deps));
  assert.equal(r.j.code, 'not_owner');   // a live account id never passes on SIM
  const l = await J(await handle(req({ broker: 'tradestation', op: 'live', token: TOKEN, accountId: 'SIM1234567F' }), ENV, G.deps));
  assert.equal(l.j.data.positions[0].symbol, 'ESZ6'); assert.equal(l.j.data.positions[0].quantity, -1); assert.equal(l.j.data.orders[0].orderType, 'stop'); assert.equal(l.j.data.orders[0].status, 'WORKING'); assert.equal(l.j.data.orders[0].legs[0].stopPrice, 6050);
  const b = await J(await handle(req({ broker: 'tradestation', op: 'balances', token: TOKEN, accountId: 'SIM1234567F' }), ENV, G.deps));
  assert.equal(b.j.data[0].netLiquidationValue, 50000);
  assert.ok(F.calls.every((c) => new URL(c.url).host === TS));
});
await t('TradeStation place: futures BUY/SELL with 2-digit year, stop-limit, bracket via OSO BRK; equities BUYTOCOVER', async () => {
  await resetOwner(); _resetBrokers(); const F = fake(tsRoutes({ ['GET ' + TS + '/v3/brokerage/accounts/SIM1234567F/positions']: { body: { Positions: [{ Symbol: 'MSFT', AssetType: 'STOCK', Quantity: '10', LongShort: 'Short' }] } } })); const G = gatesOk({ fetchImpl: F.f });
  let r = await J(await handle(place('tradestation', { accountId: 'SIM1234567F', symbol: 'MESH7', type: 'stop_limit', stopPrice: 6010, limitPrice: 6011, tick: 0.25 }), ENV, G.deps));
  assert.equal(r.j.orderId, '902');
  let b = F.calls.filter((c) => c.init.method === 'POST').pop().body;
  assert.deepEqual([b.Symbol, b.TradeAction, b.OrderType, b.StopPrice, b.LimitPrice, b.Quantity, b.TimeInForce.Duration, b.AccountID], ['MESH27', 'BUY', 'StopLimit', '6010', '6011', '1', 'DAY', 'SIM1234567F']);
  r = await J(await handle(place('tradestation', { accountId: 'SIM1234567F', symbol: 'ESZ6', side: 'sell', type: 'limit', limitPrice: 6000, sl: 6010, tp: 5980, tick: 0.25, idemKey: KEY + 'b' }), ENV, G.deps));
  b = F.calls.filter((c) => c.init.method === 'POST').pop().body;
  assert.equal(b.OSOs[0].Type, 'BRK'); assert.deepEqual(b.OSOs[0].Orders.map((o) => [o.OrderType, o.TradeAction, o.LimitPrice || o.StopPrice, o.TimeInForce.Duration]), [['Limit', 'BUY', '5980', 'GTC'], ['StopMarket', 'BUY', '6010', 'GTC']]);
  await handle(place('tradestation', { accountId: 'SIM1234567F', symbol: 'MSFT', assetType: 'equity', qty: 10, idemKey: KEY + 'c' }), ENV, G.deps);
  b = F.calls.filter((c) => c.init.method === 'POST').pop().body; assert.equal(b.TradeAction, 'BUYTOCOVER');
});
await t('TradeStation errors: 200 with Errors[] = rejected with its words; 400 Message; cancel / modify / flatten', async () => {
  await resetOwner(); _resetBrokers();
  let F = fake(tsRoutes({ ['POST ' + TS + '/v3/orderexecution/orders']: { body: { Errors: [{ Error: 'FAILED', Message: 'Order failed. Reason: Insufficient buying power.' }] } } }));
  let r = await J(await handle(place('tradestation', { accountId: 'SIM1234567F', symbol: 'ESZ6' }), ENV, gatesOk({ fetchImpl: F.f }).deps));
  assert.equal(r.status, 400); assert.equal(r.j.error, 'TradeStation said: Order failed. Reason: Insufficient buying power.');
  _resetBrokers(); F = fake(tsRoutes({ ['POST ' + TS + '/v3/orderexecution/orders']: { status: 400, body: { Error: 'BadRequest', Message: 'Invalid symbol.' } } }));
  r = await J(await handle(place('tradestation', { accountId: 'SIM1234567F', symbol: 'ESZ6', idemKey: KEY + 'x' }), ENV, gatesOk({ fetchImpl: F.f }).deps));
  assert.equal(r.j.error, 'TradeStation said: Invalid symbol.');
  _resetBrokers(); F = fake(tsRoutes()); const G = gatesOk({ fetchImpl: F.f });
  r = await J(await handle(req({ broker: 'tradestation', op: 'cancel', token: TOKEN, accountId: 'SIM1234567F', orderId: '901', idemKey: KEY + 'c' }), ENV, G.deps)); assert.equal(r.j.status, 'PENDING_CANCEL');
  r = await J(await handle(req({ broker: 'tradestation', op: 'modify', token: TOKEN, accountId: 'SIM1234567F', orderId: '901', stopPrice: 6049.9, tick: 0.25, idemKey: KEY + 'm' }), ENV, G.deps));
  assert.equal(F.calls.find((c) => c.init.method === 'PUT').body.StopPrice, '6050');
  r = await J(await handle(req({ broker: 'tradestation', op: 'flatten', token: TOKEN, accountId: 'SIM1234567F', symbol: 'ESZ6', idemKey: KEY + 'f' }), ENV, G.deps));
  assert.equal(r.j.closed, 1); const fb = F.calls.filter((c) => c.init.method === 'POST').pop().body; assert.deepEqual([fb.Symbol, fb.TradeAction, fb.OrderType, fb.Quantity], ['ESZ26', 'BUY', 'Market', '1']);
});

// ================================================================ OANDA
const oaRoutes = (over = {}) => ({
  ['GET ' + OA + '/v3/accounts']: { body: { accounts: [{ id: '101-004-1234567-001', tags: [] }] } },
  ['GET ' + OA + '/v3/accounts/101-004-1234567-001/openPositions']: { body: { positions: [{ instrument: 'EUR_USD', long: { units: '25000', averagePrice: '1.08', unrealizedPL: '12.5' }, short: { units: '0' } }] } },
  ['GET ' + OA + '/v3/accounts/101-004-1234567-001/pendingOrders']: { body: { orders: [{ id: '55', type: 'LIMIT', instrument: 'XAU_USD', units: '-5', price: '2700.000', state: 'PENDING', clientExtensions: { id: 'x' } }, { id: '56', type: 'STOP_LOSS', tradeID: '9', price: '1.07', state: 'PENDING' }] } },
  ['GET ' + OA + '/v3/accounts/101-004-1234567-001/summary']: { body: { account: { NAV: '10012.5', balance: '10000', unrealizedPL: '12.5', currency: 'USD' }, lastTransactionID: '100' } },
  ['GET ' + OA + '/v3/accounts/101-004-1234567-001/instruments?instruments=EUR_USD']: { body: { instruments: [{ name: 'EUR_USD', type: 'CURRENCY', displayPrecision: 5, tradeUnitsPrecision: 0, minimumTradeSize: '1', maximumOrderUnits: '100000000' }] } },
  ['GET ' + OA + '/v3/accounts/101-004-1234567-001/instruments?instruments=NAS100_USD']: { body: { instruments: [{ name: 'NAS100_USD', type: 'CFD', displayPrecision: 1, tradeUnitsPrecision: 1, minimumTradeSize: '0.1', maximumOrderUnits: '2000' }] } },
  ['GET ' + OA + '/v3/accounts/101-004-1234567-001/instruments']: { body: { instruments: [{ name: 'EUR_USD', displayPrecision: 5, tradeUnitsPrecision: 0, minimumTradeSize: '1' }, { name: 'XAU_USD', displayPrecision: 3, tradeUnitsPrecision: 0, minimumTradeSize: '1' }] } },
  ['POST ' + OA + '/v3/accounts/101-004-1234567-001/orders']: { status: 201, body: { orderCreateTransaction: { id: '200' }, orderFillTransaction: { id: '201' }, lastTransactionID: '201' } },
  ['PUT ' + OA + '/v3/accounts/101-004-1234567-001/orders/55/cancel']: { body: { orderCancelTransaction: { id: '202' } } },
  ['PUT ' + OA + '/v3/accounts/101-004-1234567-001/positions/EUR_USD/close']: { body: { longOrderFillTransaction: { id: '203' } } },
  ['GET ' + OA + '/v3/accounts/101-004-1234567-001/transactions/sinceid?id=100']: { body: { transactions: [{ id: '101', type: 'ORDER_FILL', orderID: '200', instrument: 'EUR_USD', reason: 'MARKET_ORDER' }, { id: '102', type: 'DAILY_FINANCING' }], lastTransactionID: '102' } },
  ...over
});
const OAC = '101-004-1234567-001';
await t('OANDA reads: accounts, positions in lots, entry orders only (no trade SL rows), NAV, instrument rules in the schema', async () => {
  await resetOwner(); _resetBrokers(); const F = fake(oaRoutes()); const G = gatesOk({ fetchImpl: F.f });
  const a = await J(await handle(req({ broker: 'oanda', op: 'accounts', token: TOKEN }), ENV, G.deps)); assert.equal(a.j.data[0].accountId, OAC);
  const l = await J(await handle(req({ broker: 'oanda', op: 'live', token: TOKEN, accountId: OAC }), ENV, G.deps));
  assert.deepEqual([l.j.data.positions[0].symbol, l.j.data.positions[0].quantity], ['EURUSD', 0.25]);
  assert.equal(l.j.data.orders.length, 1); assert.deepEqual([l.j.data.orders[0].legs[0].symbol, l.j.data.orders[0].legs[0].side, l.j.data.orders[0].legs[0].quantity, l.j.data.orders[0].legs[0].limitPrice], ['XAUUSD', 'sell', 0.05, 2700]);
  const b = await J(await handle(req({ broker: 'oanda', op: 'balances', token: TOKEN, accountId: OAC }), ENV, G.deps)); assert.equal(b.j.data[0].netLiquidationValue, 10012.5);
  const s = await J(await handle(req({ broker: 'oanda', op: 'schema', action: 'place', token: TOKEN, accountId: OAC }), ENV, G.deps));
  assert.deepEqual(s.j.data.symbols.enum, ['EURUSD', 'XAUUSD']); assert.equal(s.j.data.rules.XAUUSD.lotSize, 100);
  assert.ok(F.calls.every((c) => new URL(c.url).host === OA));
});
await t('OANDA place: units from lots, FOK market, client id = key, TP/SL on fill; limit GTC; sell negative units; size limits', async () => {
  await resetOwner(); _resetBrokers(); const F = fake(oaRoutes()); const G = gatesOk({ fetchImpl: F.f });
  let r = await J(await handle(place('oanda', { accountId: OAC, symbol: 'EURUSD', qty: 0.25, sl: 1.07001234, tp: 1.09, ref: 1.08 }), ENV, G.deps));
  assert.equal(r.j.status, 'FILLED'); assert.equal(r.j.orderId, '200');
  let o = F.calls.filter((c) => c.init.method === 'POST').pop().body.order;
  assert.deepEqual([o.type, o.instrument, o.units, o.timeInForce, o.clientExtensions.id, o.clientExtensions.tag, o.stopLossOnFill.price, o.takeProfitOnFill.price], ['MARKET', 'EUR_USD', '25000', 'FOK', KEY, 'TradeZoro', '1.07001', '1.09000']);
  r = await J(await handle(place('oanda', { accountId: OAC, symbol: 'NQ1!', side: 'sell', qty: 1.5, type: 'limit', limitPrice: 21000.04, idemKey: KEY + 'n' }), ENV, G.deps));
  o = F.calls.filter((c) => c.init.method === 'POST').pop().body.order; assert.deepEqual([o.instrument, o.units, o.type, o.price, o.timeInForce], ['NAS100_USD', '-1.5', 'LIMIT', '21000.0', 'GTC']);
  r = await J(await handle(place('oanda', { accountId: OAC, symbol: 'EURUSD', qty: 50, idemKey: KEY + 'big' }), ENV, G.deps)); assert.equal(r.j.code, 'volume'); assert.match(r.j.error, /^TradeZoro: size is/);
});
await t('OANDA errors: reject reason in plain words, FOK cancel, 401 reconnect; cancel / flatten / modify; unclear found by client id', async () => {
  await resetOwner(); _resetBrokers();
  let F = fake(oaRoutes({ ['POST ' + OA + '/v3/accounts/' + OAC + '/orders']: { status: 400, body: { orderRejectTransaction: { rejectReason: 'INSUFFICIENT_MARGIN' }, errorMessage: 'Insufficient margin' } } }));
  let r = await J(await handle(place('oanda', { accountId: OAC, symbol: 'EURUSD', qty: 0.1 }), ENV, gatesOk({ fetchImpl: F.f }).deps));
  assert.equal(r.j.error, 'OANDA said: Insufficient margin');
  _resetBrokers(); F = fake(oaRoutes({ ['POST ' + OA + '/v3/accounts/' + OAC + '/orders']: { status: 201, body: { orderCreateTransaction: { id: '1' }, orderCancelTransaction: { reason: 'MARKET_HALTED' } } } }));
  r = await J(await handle(place('oanda', { accountId: OAC, symbol: 'EURUSD', qty: 0.1, idemKey: KEY + '2' }), ENV, gatesOk({ fetchImpl: F.f }).deps));
  assert.equal(r.j.error, 'OANDA said: market halted');
  _resetBrokers(); F = fake({ ['GET ' + OA + '/v3/accounts']: { status: 401, body: { errorMessage: 'Insufficient authorization to perform request.' } } });
  r = await J(await handle(req({ broker: 'oanda', op: 'accounts', token: TOKEN }), ENV, gatesOk({ fetchImpl: F.f }).deps)); assert.equal(r.j.code, 'reconnect');
  _resetBrokers(); F = fake(oaRoutes()); const G = gatesOk({ fetchImpl: F.f });
  r = await J(await handle(req({ broker: 'oanda', op: 'cancel', token: TOKEN, accountId: OAC, orderId: '55', idemKey: KEY + 'c' }), ENV, G.deps)); assert.equal(r.j.status, 'CANCELLED');
  r = await J(await handle(req({ broker: 'oanda', op: 'flatten', token: TOKEN, accountId: OAC, symbol: 'EURUSD', idemKey: KEY + 'f' }), ENV, G.deps));
  assert.equal(r.j.closed, 1); assert.deepEqual(F.calls.find((c) => c.url.endsWith('/positions/EUR_USD/close')).body, { longUnits: 'ALL' });
  // unclear: network error on the POST, then found by client id
  _resetBrokers(); let posts = 0;
  F = fake(oaRoutes({ ['POST ' + OA + '/v3/accounts/' + OAC + '/orders']: () => { posts++; return 'NETWORK'; }, ['GET ' + OA + '/v3/accounts/' + OAC + '/orders/@' + KEY + 'u']: { body: { order: { id: '300', type: 'MARKET', instrument: 'EUR_USD', units: '1000', state: 'FILLED' } } } }));
  r = await J(await handle(place('oanda', { accountId: OAC, symbol: 'EURUSD', qty: 0.01, idemKey: KEY + 'u' }), ENV, gatesOk({ fetchImpl: F.f }).deps));
  assert.equal(r.j.orderId, '300'); assert.equal(r.j.settled, true); assert.equal(posts, 1);
});
await t('OANDA events: fills since the last transaction id (the status feed)', async () => {
  await resetOwner(); _resetBrokers(); const F = fake(oaRoutes()); const G = gatesOk({ fetchImpl: F.f });
  let r = await J(await handle(req({ broker: 'oanda', op: 'events', token: TOKEN, accountId: OAC }), ENV, G.deps)); assert.deepEqual(r.j, { last: '100', events: [] });
  r = await J(await handle(req({ broker: 'oanda', op: 'events', token: TOKEN, accountId: OAC, since: '100' }), ENV, G.deps));
  assert.equal(r.j.last, '102'); assert.deepEqual(r.j.events.map((e) => e.type), ['ORDER_FILL']);
});

// ================================================================ token route (OAuth trading sign-ins)
const tokReq = (b) => new Request('https://tradezoro.com/connect/brokers/token', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', authorization: 'Bearer IDT', 'cf-connecting-ip': '10.1.0.' + (ip++ % 250) }, body: JSON.stringify(b) });
await t('token GET: sign-in settings per broker (scopes, redirect, audience), coming soon when unset; never the secret', async () => {
  const a = await J(await tokHandle(new Request('https://tradezoro.com/connect/brokers/token?broker=tastytrade&env=sandbox'), ENV));
  assert.deepEqual([a.j.authorize, a.j.redirect, a.j.scope], ['https://cert-my.staging-tasty.works/auth.html', 'https://tradezoro.com/connect/tastytrade/trade-callback', 'read trade']);
  const b = await J(await tokHandle(new Request('https://tradezoro.com/connect/brokers/token?broker=tradestation'), ENV));
  assert.deepEqual([b.j.authorize, b.j.audience, b.j.scope, b.j.redirect], ['https://signin.tradestation.com/authorize', 'https://api.tradestation.com', 'openid offline_access MarketData ReadAccount Trade', 'https://tradezoro.com/connect/tradestation/callback']);
  assert.ok(!JSON.stringify([a.j, b.j]).includes('SAMPLE'));
  const c = await J(await tokHandle(new Request('https://tradezoro.com/connect/brokers/token?broker=tastytrade'), {})); assert.equal(c.status, 503); assert.equal(c.j.configured, false);
});
await t('token POST: code swap at the SANDBOX token URL with the server secret + User-Agent; refresh; trimmed reply; gates', async () => {
  const F = fake({ ['POST ' + TT + '/oauth/token']: { body: { access_token: 'AT_sample_123456', refresh_token: 'RT_sample_123456', expires_in: 900, id_token: 'drop-me', extra: 1 } }, ['POST signin.tradestation.com/oauth/token']: { body: { access_token: 'AT2_sample_12345', refresh_token: 'RT2', expires_in: 1200 } } });
  const d = { verify: async () => 'u', allowed: async () => true, fetchImpl: F.f };
  let r = await J(await tokHandle(tokReq({ broker: 'tastytrade', grant: 'code', code: 'CODE12345678' }), ENV, d));
  assert.deepEqual(r.j, { access_token: 'AT_sample_123456', refresh_token: 'RT_sample_123456', expires_in: 900, token_type: 'Bearer', env: 'sandbox' });
  const c0 = F.calls[0]; assert.equal(c0.headers['User-Agent'], 'tradezoro/1.0'); assert.equal(c0.body.client_secret, 'tsec-SAMPLE'); assert.equal(c0.body.redirect_uri, 'https://tradezoro.com/connect/tastytrade/trade-callback');
  r = await J(await tokHandle(tokReq({ broker: 'tradestation', grant: 'refresh', refresh_token: 'RT2_sample_1234' }), ENV, d));
  assert.equal(r.j.access_token, 'AT2_sample_12345'); assert.match(F.calls[1].body, /grant_type=refresh_token/); assert.match(F.calls[1].body, /client_secret=ssec-SAMPLE/);
  assert.equal((await tokHandle(tokReq({ broker: 'tastytrade', grant: 'code', code: 'CODE12345678' }), ENV, { ...d, allowed: async () => false })).status, 403);
  assert.equal((await tokHandle(tokReq({ broker: 'tastytrade', grant: 'code', code: 'CODE12345678' }), ENV, { ...d, verify: async () => null })).status, 401);
  assert.equal((await tokHandle(tokReq({ broker: 'oanda', grant: 'code', code: 'CODE12345678' }), ENV, d)).status, 400);
  const bad = fake({ ['POST ' + TT + '/oauth/token']: { status: 400, body: { error: 'invalid_grant' } } });
  r = await J(await tokHandle(tokReq({ broker: 'tastytrade', grant: 'code', code: 'CODE12345678' }), ENV, { ...d, fetchImpl: bad.f })); assert.equal(r.status, 400); assert.match(r.j.error, /did not accept/);
});

// ================================================================ browser module (assets/broker-trade.js) with a mocked route
await t('browser: probe, auth URL + single-use state, brokerOps body shape, refresh before expiry, OANDA token check, status feed', async () => {
  const mem = new Map(); const store = { getItem: (k) => mem.get(k) || null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  globalThis.sessionStorage = store;
  const sent = [];
  const fetchMock = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null; sent.push({ url, body });
    if (url.startsWith('/connect/brokers/trade?')) return new Response(JSON.stringify({ configured: true, live: false, client_id: 'tcid' }));
    if (url.startsWith('/connect/brokers/token?')) return new Response(JSON.stringify({ configured: true, client_id: 'tcid', authorize: 'https://cert-my.staging-tasty.works/auth.html', redirect: 'https://tradezoro.com/connect/tastytrade/trade-callback', scope: 'read trade' }));
    if (url === '/connect/brokers/token') return new Response(JSON.stringify({ access_token: 'NEWACCESS_12345678', expires_in: 900, env: 'sandbox' }));
    if (body && body.op === 'accounts') return new Response(JSON.stringify({ data: body.token === 'bad' ? [] : [{ accountId: 'A1', accountNumber: 'A1', accountName: 'A1' }] }));
    if (body && body.op === 'events') return new Response(JSON.stringify({ last: '7', events: [{ type: 'ORDER_FILL', orderId: '200' }] }));
    if (body && body.op === 'place') return new Response(JSON.stringify({ op: 'place', ok: true, status: 'RECEIVED', orderId: '1', bracket: { native: true } }));
    return new Response(JSON.stringify({ error: 'tastytrade said: nope', code: 'rejected' }), { status: 400 });
  };
  const M = await import('../../assets/broker-trade.js');
  const d = { fetch: fetchMock, idToken: async () => 'IDT', store, save: async () => {} };
  assert.deepEqual(await M.probe('tastytrade', d), { configured: true, live: false, clientId: 'tcid' });
  let went = ''; await M.startSignIn('tastytrade', 'uid1', { ...d, assign: (u) => { went = u; } });
  const u = new URL(went); assert.equal(u.origin + u.pathname, 'https://cert-my.staging-tasty.works/auth.html'); assert.equal(u.searchParams.get('scope'), 'read trade'); assert.equal(u.searchParams.get('response_type'), 'code');
  const st = u.searchParams.get('state');
  assert.equal(M.takeState(st, 'uid1', 'tradestation', store), null);   // wrong broker: consumed, refused
  await M.startSignIn('tastytrade', 'uid1', { ...d, assign: (x) => { went = x; } }); const st2 = new URL(went).searchParams.get('state');
  assert.equal(M.takeState(st2, 'uid2', 'tastytrade', store), null);
  await M.startSignIn('tastytrade', 'uid1', { ...d, assign: (x) => { went = x; } }); const st3 = new URL(went).searchParams.get('state');
  assert.equal(M.takeState(st3, 'uid1', 'tastytrade', store).env, 'sandbox'); assert.equal(M.takeState(st3, 'uid1', 'tastytrade', store), null);   // single use
  // ops: an expiring token is refreshed first, then the route gets broker + env + fresh token + whitelisted fields only
  const c = { access: 'OLD_ACCESS_123456', refresh: 'R_123456789', exp: Date.now() + 1000, env: 'sandbox' };
  const ops = M.brokerOps('tastytrade', c, 'A1', d);
  const r = await ops.order({ op: 'place', idemKey: KEY, symbol: 'NQZ6', side: 'buy', qty: 1, type: 'market', bracket: { sl: 1, tp: 2 }, evil: 'x' });
  assert.equal(r.nativeBracket, true); assert.equal(r.bracket, null);
  const p = sent.filter((x) => x.body && x.body.op === 'place').pop().body;
  assert.equal(p.token, 'NEWACCESS_12345678'); assert.equal(p.broker, 'tastytrade'); assert.equal(p.env, 'sandbox'); assert.equal(p.accountId, 'A1'); assert.equal(p.evil, undefined);
  await assert.rejects(ops.order({ op: 'cancel', idemKey: KEY, orderId: '1' }), (e) => e.message === 'tastytrade said: nope' && e.status === 400);
  assert.deepEqual(await ops.order({ op: 'bracket' }), { group: null });
  // OANDA token: checked against the route before it is kept
  await assert.rejects(M.connectOanda('short', 'sandbox', d), /does not look like/);
  await assert.rejects(M.connectOanda('bad'.padEnd(30, 'x').replace(/^.*$/, 'bad'), 'sandbox', d));
  let kept = null; const c2 = await M.connectOanda('0123456789abcdef0123-abcdef', 'live', { ...d, save: async (x) => { kept = x; } });
  assert.equal(c2.env, 'live'); assert.equal(kept.token, '0123456789abcdef0123-abcdef');
  // feed (OANDA polls events)
  const evs = []; const f = new M.StatusFeed('oanda', c2, ['A1'], (e) => evs.push(e), { ...d, pollMs: 100000 }); await f.start(); f.stop();
  assert.deepEqual(evs, [{ type: 'fill', id: '200', status: 'ORDER_FILL' }]);
});
await t('browser: tastytrade account streamer connect + heartbeat + Order notifications; reconnect on drop', async () => {
  const M = await import('../../assets/broker-trade.js');
  const socks = [];
  class FakeWS { constructor(u) { this.u = u; this.sent = []; this.h = {}; socks.push(this); setTimeout(() => this.fire('open'), 0); } addEventListener(k, f) { (this.h[k] = this.h[k] || []).push(f); } fire(k, d) { (this.h[k] || []).forEach((f) => f(d)); } send(s) { this.sent.push(JSON.parse(s)); } close() { this.fire('close'); } }
  const c = { access: 'ACC_1234567890', exp: Date.now() + 3600e3, env: 'sandbox' }, evs = [];
  const f = new M.StatusFeed('tastytrade', c, ['5WT00001'], (e) => evs.push(e), { WebSocket: FakeWS, hbMs: 5, idToken: async () => 'x' });
  await f.start(); await new Promise((r) => setTimeout(r, 5));
  assert.equal(socks[0].u, 'wss://streamer.cert.tastyworks.com'); assert.deepEqual(socks[0].sent[0], { action: 'connect', value: ['5WT00001'], 'auth-token': 'ACC_1234567890', 'request-id': 1 });
  socks[0].fire('message', { data: JSON.stringify({ status: 'ok', action: 'connect' }) }); await new Promise((r) => setTimeout(r, 20));
  assert.ok(socks[0].sent.some((m) => m.action === 'heartbeat'));
  socks[0].fire('message', { data: JSON.stringify({ type: 'Order', data: { id: 77, status: 'Filled', 'account-number': '5WT00001' } }) });
  assert.deepEqual(evs, [{ type: 'order', id: '77', status: 'Filled', account: '5WT00001' }]);
  f.stop(); assert.equal(socks.length, 1);   // a deliberate stop does not reconnect
});
await t('no secret names or values in browser code; env names documented', async () => {
  const fs = await import('node:fs');
  for (const f of ['assets/broker-trade.js', 'assets/broker-trade-map.js', 'assets/broker-trade-callback.js']) {
    const s = fs.readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
    assert.ok(!/CLIENT_SECRET|client_secret/.test(s), f);
  }
  assert.equal(configured({ TASTY_SANDBOX_CLIENT_ID: 'a' }, 'tastytrade'), false);
  assert.equal(configured({}, 'oanda'), false); assert.equal(configured({ OANDA_TRADE_ENABLED: '1' }, 'oanda'), true);
  assert.ok(MSG.not_allowed.includes('admins and beta testers'));
});
console.log('\n' + n + ' tests passed (brokers3, mocked, no network)');
