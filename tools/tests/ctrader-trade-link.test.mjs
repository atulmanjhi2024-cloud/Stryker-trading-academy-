// cTrader trading BROWSER LINK tests (assets/ctrader-trade.js) end to end against the REAL relay rules and a mocked cTrader
// (tools/tests/ctrader-mock.mjs). Sign-in scope, mapping, every write type, errors, disconnect mid-order, reconnect, duplicates.
// No network. Run: node tools/tests/ctrader-trade-link.test.mjs
import assert from 'node:assert/strict';
import { webcrypto as C } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = C;
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
globalThis.sessionStorage = mem();
const T = await import('../../assets/ctrader-trade.js?v=1233');
const ct = await import('../../assets/byo-ctrader.js?v=1233');
const { makeWS, mockState, ACC } = await import('./ctrader-mock.mjs');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CREDS = () => ({ access: 'ACCESSTOKENsample1', refresh: 'REFRESHsample1', exp: Date.now() + 30 * 864e5, accountId: ACC, isLive: false, kind: 'trade' });
const mkLink = (M, over = {}) => { const L = new T.TradeLink(CREDS(), { WS: makeWS(M), location: { protocol: 'https:', host: 'tradezoro.com' }, idToken: async () => 'IDT', save: async () => {}, ...over }); return { L, ops: T.ctOps(L, { lastPrice: () => 18000 }) }; };
const KEY = (i) => 'k-test-0000000000' + String(i).padStart(4, '0');

await t('"Allow trading" sign-in asks scope=trading with its own single-use state; the data sign-in record is untouched', () => {
  const st = mem();
  const dataUrl = new URL(ct.ctraderAuthUrl('CID', 'u1', st)); assert.equal(dataUrl.searchParams.get('scope'), 'accounts', 'data sign-in unchanged');
  const u = new URL(T.tradeAuthUrl('CID', 'u1', st)); assert.equal(u.searchParams.get('scope'), 'trading'); assert.equal(u.searchParams.get('redirect_uri'), 'https://tradezoro.com/connect/ctrader/callback');
  const dataState = dataUrl.searchParams.get('state'), s = u.searchParams.get('state');
  assert.equal(T.takeTradeState(dataState, 'u1', st), null, 'a data sign-in state is not a trading one'); assert.ok(st.getItem(T.TT.STATE_KEY), 'and it does not consume the trading record');
  assert.equal(T.takeTradeState(s, 'u2', st), null, 'other user'); T.tradeAuthUrl('CID', 'u1', st); const s2 = JSON.parse(st.getItem(T.TT.STATE_KEY)).state;
  assert.ok(T.takeTradeState(s2, 'u1', st)); assert.equal(T.takeTradeState(s2, 'u1', st), null, 'single use');
  assert.ok(ct.takeCtraderState(dataState, 'u1', st), 'the data sign-in still finishes on its own record');
  assert.equal(T.TT.VAULT, 'ctrader-trade'); assert.notEqual(T.TT.VAULT, 'ctrader');
});
await t('mapping: reconcile, trader balance, new-order build (market relative SL/TP, limit absolute, size rules)', () => {
  const names = new Map([[1, 'EURUSD']]), det = new Map([[1, { lotSize: 10000000, minVolume: 100000, stepVolume: 100000, maxVolume: 1e10, digits: 5 }]]);
  const r = T.mapReconcile({ position: [{ positionId: 9, price: 1.1, tradeData: { symbolId: 1, volume: 3000000, tradeSide: 2 } }], order: [{ orderId: 5, orderType: 2, limitPrice: 1.09, tradeData: { symbolId: 1, volume: 100000, tradeSide: 1 } }, { orderId: 6, closingOrder: true, tradeData: { symbolId: 1, volume: 1 } }] }, names, det);
  assert.deepEqual(r.positions[0].quantity, -0.3); assert.equal(r.positions[0].symbol, 'EURUSD'); assert.equal(r.orders.length, 1); assert.equal(r.orders[0].legs[0].quantity, 0.01); assert.equal(r.orders[0].orderType, 'limit');
  assert.deepEqual(T.mapTrader({ balance: 1234567, moneyDigits: 2, depositAssetId: 1 }, [{ assetId: 1, name: 'USD' }], 0), [{ balance: 12345.67, currency: 'USD', updatedAt: new Date(0).toISOString() }]);
  const ctx = { details: det, symbolId: 1, account: ACC, last: 1.1, capLots: 10 };
  assert.deepEqual(T.buildNewOrder({ side: 'buy', type: 'market', qty: 0.05, sl: 1.099, tp: 1.102 }, ctx), [2106, { ctidTraderAccountId: ACC, symbolId: 1, orderType: 1, tradeSide: 1, volume: 500000, relativeStopLoss: 100, relativeTakeProfit: 200 }]);
  assert.match(T.buildNewOrder({ side: 'buy', type: 'market', qty: 0.05, sl: 1.2 }, ctx).error, /below/);
  assert.deepEqual(T.buildNewOrder({ side: 'sell', type: 'limit', qty: 1, limitPrice: 1.123456, sl: 1.13 }, ctx), [2106, { ctidTraderAccountId: ACC, symbolId: 1, orderType: 2, tradeSide: 2, volume: 10000000, limitPrice: 1.12346, timeInForce: 2, stopLoss: 1.13 }]);
  assert.match(T.buildNewOrder({ side: 'buy', type: 'market', qty: 11 }, ctx).error, /Size is 0.01 to 10 lots/);
  assert.match(T.buildNewOrder({ side: 'buy', type: 'market', qty: 1 }, { ...ctx, symbolId: 4 }).error, /loading/);
});
await t('link: connects (account list, trading scope, account auth, symbols) and reads positions + balance', async () => {
  const M = mockState({ positions: [{ positionId: 1201, positionStatus: 1, price: 18000, tradeData: { symbolId: 2, volume: 2000000, tradeSide: 1 } }] });
  const { L, ops } = mkLink(M);
  const env = await ops.order({ op: 'env' }); assert.equal(env.env, 'sandbox'); assert.equal(env.enabled, true); assert.equal(env.consent, true); assert.equal(env.blocked, false);
  const live = (await ops.data('live')).data; assert.equal(live.positions[0].symbol, 'US100'); assert.equal(live.positions[0].quantity, 0.2);
  const bal = (await ops.data('balances')).data; assert.equal(bal[0].balance, 10000); assert.equal(bal[0].currency, 'USD');
  assert.ok(!M.sent.some((m) => m.payloadType === 2100 && JSON.stringify(m).includes('IDT')), 'nothing of ours rides along');
  L.shut();
});
await t('link: a view-only token is told to Allow trading (nothing authorised)', async () => {
  const M = mockState({ scope: 0 }); const { ops } = mkLink(M);
  await assert.rejects(ops.order({ op: 'env' }), /view-only/); assert.ok(!M.sent.some((m) => m.payloadType === 2102));
});
await t('place market -> filled; the relay sends label TradeZoro + clientOrderId = key; audit accepted with ids', async () => {
  const M = mockState(); const { L, ops } = mkLink(M);
  const r = await ops.order({ op: 'place', symbol: 'US100', side: 'buy', qty: 0.1, type: 'market', idemKey: KEY(1) });
  assert.equal(r.ok, true); assert.equal(r.status, 'FILLED');
  const sent = M.sent.find((m) => m.payloadType === 2106); assert.equal(sent.payload.label, 'TradeZoro'); assert.equal(sent.payload.clientOrderId, KEY(1)); assert.equal(sent.payload.volume, 1000000);
  await sleep(20); assert.equal(M.audits['ct-' + KEY(1)].result, 'accepted'); assert.equal(M.audits['ct-' + KEY(1)].brokerOrderId, String(r.orderId)); assert.equal(M.lock, null);
  L.shut();
});
await t('place limit, modify, cancel, flatten (cancel working + close positions), each audited', async () => {
  const M = mockState(); const { L, ops } = mkLink(M);
  const lim = await ops.order({ op: 'place', symbol: 'EURUSD', side: 'buy', qty: 0.01, type: 'limit', limitPrice: 1.05, idemKey: KEY(2) }); assert.equal(lim.status, 'ACCEPTED');
  const oid = M.orders[0].orderId;
  assert.equal((await ops.order({ op: 'live' }).catch(() => null)), null, 'unknown op refused');
  await ops.data('live');   // the relay learns the order from the reconcile (also learned from the execution)
  const mod = await ops.order({ op: 'modify', orderId: String(oid), limitPrice: 1.04, idemKey: KEY(3) }); assert.equal(mod.status, 'REPLACED'); assert.equal(M.orders[0].limitPrice, 1.04);
  const can = await ops.order({ op: 'cancel', orderId: String(oid), idemKey: KEY(4) }); assert.equal(can.status, 'CANCELLED'); assert.equal(M.orders.length, 0);
  await ops.order({ op: 'place', symbol: 'EURUSD', side: 'sell', qty: 0.02, type: 'market', idemKey: KEY(5) });
  await ops.order({ op: 'place', symbol: 'EURUSD', side: 'buy', qty: 0.01, type: 'limit', limitPrice: 1.01, idemKey: KEY(6) });
  const fl = await ops.order({ op: 'flatten', symbol: 'EURUSD', idemKey: 'fl-0123456789abcdef-eurusd' }); assert.equal(fl.closed, 1); assert.equal(fl.cancelled, 1);
  assert.equal(M.positions.length, 0); assert.equal(M.orders.length, 0);
  await sleep(20); for (const k of [2, 3, 4, 5, 6]) assert.equal(M.audits['ct-' + KEY(k)].result, 'accepted', 'audit ' + k);
  assert.ok(M.audits['ct-fl-0123456789abcdef-eurusd-o1'] && M.audits['ct-fl-0123456789abcdef-eurusd-p2'], 'flatten legs audited with derived keys');
  L.shut();
});
await t('duplicate protection: the same key twice = one order; a double flatten = one flatten', async () => {
  const M = mockState(); const { L, ops } = mkLink(M);
  await ops.order({ op: 'place', symbol: 'US100', side: 'buy', qty: 0.1, type: 'market', idemKey: KEY(7) });
  await assert.rejects(ops.order({ op: 'place', symbol: 'US100', side: 'buy', qty: 0.1, type: 'market', idemKey: KEY(7) }), /already sent once/);
  assert.equal(M.sent.filter((m) => m.payloadType === 2106).length, 1);
  await ops.order({ op: 'flatten', symbol: 'US100', idemKey: 'fl-aaaaaaaaaaaaaaaa-us100' });
  M.positions.push({ positionId: 5555, positionStatus: 1, tradeData: { symbolId: 2, volume: 1000000, tradeSide: 1 } });
  await assert.rejects(ops.order({ op: 'flatten', symbol: 'US100', idemKey: 'fl-aaaaaaaaaaaaaaaa-us100' }), /already sent once/);
  assert.equal(M.sent.filter((m) => m.payloadType === 2111).length, 1);
  // two at once from this tab: the second is refused here before it reaches the relay
  const a = ops.order({ op: 'place', symbol: 'US100', side: 'buy', qty: 0.1, type: 'market', idemKey: KEY(8) }); const b = ops.order({ op: 'place', symbol: 'US100', side: 'buy', qty: 0.1, type: 'market', idemKey: KEY(9) });
  const rs = await Promise.allSettled([a, b]); assert.equal(rs.filter((x) => x.status === 'fulfilled').length, 1); assert.match(rs.find((x) => x.status === 'rejected').reason.message, /still on its way/);
  L.shut();
});
await t('errors in plain words: broker refusal, kill switch, consent, member block, size cap', async () => {
  let M = mockState({ reject: 'NOT_ENOUGH_MONEY' }); let k = mkLink(M);
  await assert.rejects(k.ops.order({ op: 'place', symbol: 'US100', side: 'buy', qty: 0.1, type: 'market', idemKey: KEY(10) }), /Not enough money/); await sleep(20); assert.equal(M.audits['ct-' + KEY(10)].result, 'rejected'); k.L.shut();
  for (const [gate, re] of [[{ switchOn: false }, /switched off/], [{ consent: false }, /Enable live trading first/], [{ blocked: true }, /switched off for your account/], [{ admin: false }, /admins and beta testers only/]]) {
    M = mockState({ gate }); k = mkLink(M);
    await assert.rejects(k.ops.order({ op: 'place', symbol: 'US100', side: 'buy', qty: 0.1, type: 'market', idemKey: KEY(11) }), re); assert.ok(!M.sent.some((m) => m.payloadType === 2106)); k.L.shut();
  }
  M = mockState(); k = mkLink(M); await assert.rejects(k.ops.order({ op: 'place', symbol: 'US100', side: 'buy', qty: 12, type: 'market', idemKey: KEY(12) }), /Size is/); k.L.shut();
  M = mockState(); k = mkLink(M); await assert.rejects(k.ops.order({ op: 'place', symbol: 'NOPE', side: 'buy', qty: 1, type: 'market', idemKey: KEY(13) }), /does not list NOPE/); k.L.shut();
});
await t('disconnect mid-order = unknown (never re-sent); the reconnect is held until the order list settles it', async () => {
  const M = mockState({ dropOnWrite: true }); let k = mkLink(M);
  await assert.rejects(k.ops.order({ op: 'place', symbol: 'US100', side: 'buy', qty: 0.1, type: 'market', idemKey: KEY(14) }), (e) => e.code === 'unknown' && /may or may not/.test(e.message));
  assert.equal(M.lock.key, KEY(14), 'account lock held'); await sleep(20); assert.equal(M.audits['ct-' + KEY(14)].result, 'unknown');
  // reconnect: a new socket; a new order is refused while the old one is unresolved
  k = mkLink(M); let ev = null; k.L.onEvent = (kind, m) => { if (kind === 'resolved') ev = m; };
  await assert.rejects(k.ops.order({ op: 'place', symbol: 'US100', side: 'buy', qty: 0.1, type: 'market', idemKey: KEY(15) }), (e) => e.code === 'unresolved');
  assert.equal(M.sent.filter((m) => m.payloadType === 2106).length, 1, 'only the first order ever reached cTrader');
  assert.ok(M.sent.some((m) => m.payloadType === 2175), 'the relay asked cTrader for the order list');
  k.L.shut();
});
await t('silent cTrader = unknown after the wait, then found in the order list = settled accepted, lock free', async () => {
  const M = mockState({ silent: true }); let clock = Date.now(); const k = new T.TradeLink(CREDS(), { WS: makeWS(M, { now: () => clock }), location: { protocol: 'https:', host: 'tradezoro.com' }, idToken: async () => 'IDT' });
  const ops = T.ctOps(k); let ev = null; k.onEvent = (kind, m) => { if (kind === 'resolved') ev = m; };
  const p = ops.order({ op: 'place', symbol: 'US100', side: 'buy', qty: 0.1, type: 'market', idemKey: KEY(16) });
  for (let i = 0; i < 100 && !M.sent.some((m) => m.payloadType === 2106); i++) await sleep(10);   // advance the relay clock only after the send
  await sleep(20); M.history = [{ orderId: 4242, clientOrderId: KEY(16), positionId: 1 }]; clock += 16000;
  await assert.rejects(p, (e) => e.code === 'unknown');
  clock += 6000; for (let i = 0; i < 30 && !ev; i++) await sleep(20);
  assert.ok(ev, 'resolved event'); assert.equal(ev.result, 'accepted'); assert.equal(M.lock, null); assert.equal(M.audits['ct-' + KEY(16)].brokerOrderId, '4242');
  k.shut();
});
await t('the browser link refuses a write on a closed socket without sending; a reconnect works', async () => {
  const M = mockState(); const k = mkLink(M); await k.ops.order({ op: 'env' }); k.L.shut('test');
  const r = await k.ops.order({ op: 'place', symbol: 'US100', side: 'buy', qty: 0.1, type: 'market', idemKey: KEY(17) });   // open() reconnects first
  assert.equal(r.status, 'FILLED'); k.L.shut();
});

console.log(n + ' cTrader trading link tests passed');
process.exit(0);
