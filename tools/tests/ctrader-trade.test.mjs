// cTrader LIVE TRADING tests (admin only): the trading allow-list, every write's checks, the gates, the audit row before the send,
// idempotency, the shared account lock and its resolution, timeouts / disconnects, the endpoint door, and the browser link.
// MOCKED cTrader frames only: no network, no real keys, nothing ever reaches cTrader. Run: node tools/tests/ctrader-trade.test.mjs
import assert from 'node:assert/strict';
import { webcrypto as C } from 'node:crypto';
import { checkClientFrame, createRelay, CLIENT_ALLOW } from '../../functions/connect/ctrader/_relay.js';
import { TRADE_ALLOW, TRADE_SERVER_ALLOW, tradeHooks, shapeOk, sidesOk, volumeErr, MSG, LABEL, TLIMITS, RESOLVE_AFTER_MS } from '../../functions/connect/ctrader/_trade.js';
import { handle as tradeHandle, accountLock, mayTrade } from '../../functions/connect/ctrader/trade.js';
import { _resetTok } from '../../functions/api/beta/_lib.js';
if (!globalThis.crypto) globalThis.crypto = C;
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const f = (o) => JSON.stringify(o);
const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async () => { for (let i = 0; i < 8; i++) await tick(); };
const ACC = 77, KEY = 'k-0123456789abcdef', KEY2 = 'k-fedcba9876543210';
const SYM = { symbolId: 1, minVolume: 100000, maxVolume: 10000000000, stepVolume: 100000, lotSize: 10000000 };   // 0.01 lot steps (cTrader volume = units x 100)

// ---- mocked gates + store ----
function gates(over = {}) {
  const audits = new Map(), lockDoc = { v: null }, log = [];
  const g = {
    isAdmin: async () => true, switchOn: async () => true, consent: async () => true, blocked: async () => false,
    audit: async (entry, id) => {
      if (audits.has(id)) { const e = new Error('duplicate'); e.duplicate = true; throw e; }
      const row = { ...entry, result: 'attempt' }; audits.set(id, row); log.push('audit:' + id);
      return { id, finish: async (res) => { Object.assign(row, res); } };
    },
    patchAudit: async (id, res) => { Object.assign(audits.get(id) || {}, res); },
    lock: {
      take: async (key) => { if (lockDoc.v) return { ...lockDoc.v }; lockDoc.v = { key, at: Date.now() }; log.push('lock:' + key); return true; },
      peek: async () => lockDoc.v,
      release: async (key) => { if (lockDoc.v && lockDoc.v.key === key) lockDoc.v = null; }
    },
    defer: (p) => { p.catch(() => {}); },
    ...over
  };
  return { g, audits, lockDoc, log };
}
function mk({ over, now, envName = 'demo', isLive = false, scope = 1, lockDoc } = {}) {
  const G = gates(over); if (lockDoc) G.lockDoc.v = lockDoc;
  const c = [], u = [], st = { cc: null };
  const clock = { t: 1e12 }; const nowF = now || (() => clock.t);
  const hooks = tradeHooks({ uid: 'admin1', account: ACC, envName, g: G.g, now: nowF });
  const r = createRelay({ client: { send: (x) => c.push(JSON.parse(x)), close: (code) => { st.cc = code; } }, up: { send: (x) => { G.log.push('send:' + JSON.parse(x).payloadType); u.push(JSON.parse(x)); }, close: () => {} }, clientId: 'CID', clientSecret: 'SECRET-xyz-123', now: nowF, hooks });
  hooks.bind(r);
  const login = () => {
    r.start(); r.onUp(f({ payloadType: 2101 }));
    r.onClient(f({ clientMsgId: 'a1', payloadType: 2149, payload: { accessToken: 'ACCESSTOKEN1' } }));
    r.onUp(f({ clientMsgId: 'a1', payloadType: 2150, payload: { permissionScope: scope, ctidTraderAccount: [{ ctidTraderAccountId: ACC, isLive }, { ctidTraderAccountId: 88, isLive }] } }));
    r.onClient(f({ clientMsgId: 'a2', payloadType: 2102, payload: { ctidTraderAccountId: ACC, accessToken: 'ACCESSTOKEN1' } }));
    if (st.cc) return;
    r.onUp(f({ clientMsgId: 'a2', payloadType: 2103, payload: { ctidTraderAccountId: ACC } }));
    r.onUp(f({ clientMsgId: 'a3', payloadType: 2117, payload: { ctidTraderAccountId: ACC, symbol: [SYM, { ...SYM, symbolId: 2 }] } }));
    r.onUp(f({ clientMsgId: 'a4', payloadType: 2115, payload: { ctidTraderAccountId: ACC, symbol: [{ symbolId: 1, symbolName: 'EURUSD' }] } }));
    r.onUp(f({ clientMsgId: 'a5', payloadType: 2125, payload: { ctidTraderAccountId: ACC, order: [{ orderId: 501, orderStatus: 1, tradeData: { symbolId: 1, volume: 100000 } }], position: [{ positionId: 901, positionStatus: 1, tradeData: { symbolId: 1, volume: 300000 } }] } }));
  };
  return { r, c, u, st, clock, hooks, ...G, login };
}
const order = (p = {}, key = KEY) => f({ clientMsgId: key, payloadType: 2106, payload: { ctidTraderAccountId: ACC, symbolId: 1, orderType: 1, tradeSide: 1, volume: 100000, ...p } });
const refusedOf = (c) => c.filter((x) => x.relay === 'refused');
const writesUp = (u) => u.filter((x) => [2106, 2108, 2109, 2110, 2111].includes(x.payloadType));

// ---- allow-list (schema + rebuild) ----
await t('trade allow-list: exactly the asked types; data relay untouched', () => {
  assert.deepEqual(Object.keys(TRADE_ALLOW).map(Number).sort((a, b) => a - b), [51, 2102, 2106, 2108, 2109, 2110, 2111, 2112, 2114, 2116, 2121, 2124, 2133, 2149, 2175]);
  for (const ty of [2106, 2108, 2109, 2110, 2111, 2112, 2121, 2124, 2133, 2175]) assert.ok(!(ty in CLIENT_ALLOW), 'data relay never takes ' + ty);
  for (const ty of [2126, 2132, 2122, 2125, 2134, 2176, 2142, 50]) assert.ok(TRADE_SERVER_ALLOW.has(ty), 'event ' + ty + ' passes back');
  for (const ty of [2100, 2137, 2145, 2127, 2156, 2143, 2173, 2104]) assert.equal(checkClientFrame(f({ payloadType: ty, payload: { ctidTraderAccountId: ACC, symbolId: 1 } }), TRADE_ALLOW).ok, false, 'type ' + ty + ' refused');
});
await t('trade allow-list: every write type passes a good frame, refuses unknown keys / wrong types / missing fields', () => {
  const good = { 2106: { symbolId: 1, orderType: 2, tradeSide: 1, volume: 100000, limitPrice: 1.1, stopLoss: 1.09, takeProfit: 1.12, timeInForce: 2 }, 2109: { orderId: 5, limitPrice: 1.2 }, 2108: { orderId: 5 }, 2110: { positionId: 9, stopLoss: 1.0 }, 2111: { positionId: 9, volume: 100000 }, 2121: {}, 2124: {}, 2175: { fromTimestamp: 1, toTimestamp: 2 }, 2133: { fromTimestamp: 1, toTimestamp: 2, maxRows: 50 } };
  for (const [ty, p] of Object.entries(good)) {
    const ok = checkClientFrame(f({ clientMsgId: KEY, payloadType: +ty, payload: { ctidTraderAccountId: ACC, ...p } }), TRADE_ALLOW); assert.ok(ok.ok, 'good ' + ty);
    assert.equal(checkClientFrame(f({ payloadType: +ty, payload: { ctidTraderAccountId: ACC, ...p, label: 'x' } }), TRADE_ALLOW).ok, false, 'label from the client ' + ty);
    assert.equal(checkClientFrame(f({ payloadType: +ty, payload: { ctidTraderAccountId: ACC, ...p, clientOrderId: 'x' } }), TRADE_ALLOW).ok, false, 'clientOrderId from the client ' + ty);
  }
  for (const bad of [{ orderType: 4 }, { tradeSide: 3 }, { volume: 1.5 }, { volume: -1 }, { limitPrice: 'x' }, { limitPrice: -1 }, { stopLoss: Infinity }, { timeInForce: 1 }, { relativeStopLoss: 0 }, { guaranteedStopLoss: true }, { trailingStopLoss: true }, { positionId: 5 }])
    assert.equal(checkClientFrame(order(bad), TRADE_ALLOW).ok, false, JSON.stringify(bad));
  assert.equal(checkClientFrame(f({ payloadType: 2106, payload: { ctidTraderAccountId: ACC, symbolId: 1, orderType: 1, tradeSide: 1 } }), TRADE_ALLOW).ok, false, 'volume required');
  assert.equal(checkClientFrame(f({ payloadType: 2111, payload: { ctidTraderAccountId: ACC, positionId: 9 } }), TRADE_ALLOW).ok, false, 'close volume required');
});
await t('order shape + side rules', () => {
  assert.ok(shapeOk(2106, { orderType: 1, relativeStopLoss: 50 })); assert.ok(!shapeOk(2106, { orderType: 1, stopLoss: 1.1 }), 'market: absolute SL refused');
  assert.ok(!shapeOk(2106, { orderType: 1, limitPrice: 1 })); assert.ok(!shapeOk(2106, { orderType: 2 }), 'limit needs a price'); assert.ok(!shapeOk(2106, { orderType: 3, limitPrice: 1 }));
  assert.ok(!shapeOk(2106, { orderType: 2, limitPrice: 1, relativeStopLoss: 5 })); assert.ok(!shapeOk(2109, {}), 'amend needs a change'); assert.ok(!shapeOk(2109, { limitPrice: 1, stopPrice: 1 }));
  assert.ok(sidesOk({ orderType: 2, tradeSide: 1, limitPrice: 1.1, stopLoss: 1.0, takeProfit: 1.2 }));
  assert.ok(!sidesOk({ orderType: 2, tradeSide: 1, limitPrice: 1.1, stopLoss: 1.2 })); assert.ok(!sidesOk({ orderType: 3, tradeSide: 2, stopPrice: 1.1, takeProfit: 1.2 }));
  assert.equal(volumeErr(100000, SYM, 10), ''); assert.equal(volumeErr(150000, SYM, 10), 'volume'); assert.equal(volumeErr(50000, SYM, 10), 'volume');
  assert.equal(volumeErr(SYM.lotSize * 11, SYM, 10), 'cap'); assert.equal(volumeErr(SYM.lotSize * 10, SYM, 10), ''); assert.equal(volumeErr(100000, null, 10), 'symbol');
});

// ---- the write path ----
await t('market order: gates, lock and audit BEFORE the send; label + clientOrderId forced; result + broker id recorded; lock released', async () => {
  const m = mk(); m.login();
  m.r.onClient(order({ relativeStopLoss: 500, relativeTakeProfit: 1000 }));
  await flush();
  const w = writesUp(m.u); assert.equal(w.length, 1);
  assert.deepEqual(w[0], { payloadType: 2106, clientMsgId: KEY, payload: { ctidTraderAccountId: ACC, symbolId: 1, orderType: 1, tradeSide: 1, volume: 100000, relativeStopLoss: 500, relativeTakeProfit: 1000, label: LABEL, clientOrderId: KEY } });
  const order3 = m.log.filter((x) => /^(lock|audit|send:2106)/.test(x)); assert.deepEqual(order3, ['lock:' + KEY, 'audit:ct-' + KEY, 'send:2106'], 'lock, then audit, then send');
  assert.equal(m.audits.get('ct-' + KEY).result, 'attempt');
  assert.equal(m.audits.get('ct-' + KEY).symbol, 'EURUSD'); assert.equal(m.audits.get('ct-' + KEY).side, 'buy'); assert.equal(m.audits.get('ct-' + KEY).src, 'ctrader');
  m.r.onUp(f({ clientMsgId: KEY, payloadType: 2126, payload: { ctidTraderAccountId: ACC, executionType: 3, order: { orderId: 7001, orderStatus: 2, tradeData: { symbolId: 1, volume: 100000 } }, position: { positionId: 9001, positionStatus: 1, tradeData: { symbolId: 1, volume: 100000 } } } }));
  await flush();
  const a = m.audits.get('ct-' + KEY); assert.equal(a.result, 'accepted'); assert.equal(a.brokerOrderId, '7001'); assert.equal(a.positionId, '9001');
  assert.equal(m.lockDoc.v, null, 'lock released after the answer');
  assert.ok(m.c.some((x) => x.payloadType === 2126 && x.clientMsgId === KEY), 'the execution goes back to the browser');
  assert.ok(m.hooks._state().positions.has(9001), 'the new position is learned');
});
await t('every gate refuses (fails closed) and nothing is sent', async () => {
  const cases = [['isAdmin', async () => false, 'not_admin'], ['isAdmin', async () => { throw new Error('x'); }, 'gate_unreadable'], ['switchOn', async () => false, 'switched_off'], ['switchOn', async () => { throw new Error('x'); }, 'switch_unreadable'],
    ['consent', async () => false, 'consent_needed'], ['consent', async () => { throw new Error('x'); }, 'consent_unreadable'], ['blocked', async () => true, 'member_blocked'], ['blocked', async () => { throw new Error('x'); }, 'switch_unreadable']];
  for (const [k, fn, code] of cases) {
    const m = mk({ over: { [k]: fn } }); m.login(); m.r.onClient(order()); await flush();
    assert.equal(writesUp(m.u).length, 0, k + ' -> nothing sent'); const rf = refusedOf(m.c); assert.equal(rf.length, 1); assert.equal(rf[0].code, code, k); assert.equal(rf[0].error, MSG[code]);
    assert.equal(m.lockDoc.v, null, 'no lock left'); assert.equal(m.st.cc, null, 'the socket stays open');
  }
});
await t('idempotency: the same key twice is sent ONCE; audit unavailable = nothing sent', async () => {
  const m = mk(); m.login(); m.r.onClient(order()); await flush();
  m.r.onUp(f({ clientMsgId: KEY, payloadType: 2126, payload: { ctidTraderAccountId: ACC, executionType: 2, order: { orderId: 1 } } })); await flush();
  m.r.onClient(order()); await flush();
  assert.equal(writesUp(m.u).length, 1, 'sent once'); assert.equal(refusedOf(m.c)[0].code, 'duplicate'); assert.equal(m.lockDoc.v, null, 'the duplicate released its lock');
  const m2 = mk({ over: { audit: async () => { throw new Error('503'); } } }); m2.login(); m2.r.onClient(order()); await flush();
  assert.equal(writesUp(m2.u).length, 0); assert.equal(refusedOf(m2.c)[0].code, 'audit'); assert.equal(m2.lockDoc.v, null);
});
await t('one write in flight; rate limits; bad key', async () => {
  const m = mk(); m.login(); m.r.onClient(order()); m.r.onClient(order({}, KEY2)); await flush();
  assert.equal(writesUp(m.u).length, 1); assert.equal(refusedOf(m.c)[0].code, 'busy');
  const m2 = mk(); m2.login(); m2.r.onClient(order({}, 'short')); m2.r.onClient(f({ payloadType: 2106, payload: { ctidTraderAccountId: ACC, symbolId: 1, orderType: 1, tradeSide: 1, volume: 100000 } })); await flush();
  assert.equal(writesUp(m2.u).length, 0); assert.deepEqual(refusedOf(m2.c).map((x) => x.code), ['key', 'key']);
  const m3 = mk(); m3.login(); let k = 0;
  for (let i = 0; i < 3; i++) { m3.r.onClient(order({}, 'k-rate-000000000' + (++k))); await flush(); m3.r.onUp(f({ clientMsgId: 'k-rate-000000000' + k, payloadType: 2126, payload: { executionType: 2, order: { orderId: k } } })); await flush(); }
  assert.equal(writesUp(m3.u).length, 2, 'two a second'); assert.equal(refusedOf(m3.c).at(-1).code, 'too_fast');
});
await t('server-side size and symbol checks: step, min, max, cap, unknown symbol', async () => {
  for (const [p, code] of [[{ volume: 150000 }, 'volume'], [{ volume: 0 }, 'volume'], [{ volume: SYM.lotSize * 11 }, 'cap'], [{ symbolId: 3 }, 'symbol'], [{ orderType: 2, limitPrice: 1.1, stopLoss: 1.2 }, 'shape'], [{ stopLoss: 1.1 }, 'shape']]) {
    const m = mk(); m.login(); m.r.onClient(order(p)); await flush();
    assert.equal(writesUp(m.u).length, 0, JSON.stringify(p)); assert.equal(refusedOf(m.c)[0].code, code, JSON.stringify(p));
  }
});
await t('amend / cancel / SL-TP / close: only ids this socket learned from cTrader; close volume <= the position', async () => {
  const run = async (fr) => { const m = mk(); m.login(); m.r.onClient(f(fr)); await flush(); return m; };
  let m = await run({ clientMsgId: KEY, payloadType: 2108, payload: { ctidTraderAccountId: ACC, orderId: 501 } }); assert.equal(writesUp(m.u)[0].payloadType, 2108); assert.equal(m.audits.get('ct-' + KEY).op, 'cancel');
  m = await run({ clientMsgId: KEY, payloadType: 2108, payload: { ctidTraderAccountId: ACC, orderId: 999 } }); assert.equal(refusedOf(m.c)[0].code, 'unknown_order');
  m = await run({ clientMsgId: KEY, payloadType: 2109, payload: { ctidTraderAccountId: ACC, orderId: 501, limitPrice: 1.2 } }); assert.equal(writesUp(m.u)[0].payloadType, 2109);
  m = await run({ clientMsgId: KEY, payloadType: 2109, payload: { ctidTraderAccountId: ACC, orderId: 501, volume: 150000 } }); assert.equal(refusedOf(m.c)[0].code, 'volume');
  m = await run({ clientMsgId: KEY, payloadType: 2110, payload: { ctidTraderAccountId: ACC, positionId: 901, stopLoss: 1.0 } }); assert.equal(writesUp(m.u)[0].payloadType, 2110);
  m = await run({ clientMsgId: KEY, payloadType: 2110, payload: { ctidTraderAccountId: ACC, positionId: 902, stopLoss: 1.0 } }); assert.equal(refusedOf(m.c)[0].code, 'unknown_position');
  m = await run({ clientMsgId: KEY, payloadType: 2111, payload: { ctidTraderAccountId: ACC, positionId: 901, volume: 300000 } }); assert.equal(writesUp(m.u)[0].payloadType, 2111);
  m = await run({ clientMsgId: KEY, payloadType: 2111, payload: { ctidTraderAccountId: ACC, positionId: 901, volume: 400000 } }); assert.equal(refusedOf(m.c)[0].code, 'close_volume');
  m = await run({ clientMsgId: KEY, payloadType: 2111, payload: { ctidTraderAccountId: 88, positionId: 901, volume: 100000 } }); assert.equal(m.st.cc, 1008, 'another account = socket closed'); assert.equal(writesUp(m.u).length, 0);
});
await t('the broker refuses: OrderErrorEvent / ErrorRes / rejected execution -> audit rejected + code, lock released', async () => {
  for (const ev of [{ payloadType: 2132, payload: { errorCode: 'NOT_ENOUGH_MONEY', orderId: 3 } }, { payloadType: 2142, payload: { errorCode: 'TRADING_BAD_VOLUME' } }, { payloadType: 2126, payload: { executionType: 7, errorCode: 'MARKET_CLOSED', order: { orderId: 4 } } }]) {
    const m = mk(); m.login(); m.r.onClient(order()); await flush();
    m.r.onUp(f({ clientMsgId: KEY, ...ev })); await flush();
    const a = m.audits.get('ct-' + KEY); assert.equal(a.result, 'rejected', String(ev.payloadType)); assert.ok(a.message.length > 3); assert.equal(m.lockDoc.v, null);
    assert.ok(m.c.some((x) => x.payloadType === ev.payloadType), 'the error goes back to the browser');
  }
});
await t('no answer in time = unknown: the lock STAYS (other tabs / sockets refused), then OrderList settles it (found -> accepted)', async () => {
  const m = mk(); m.login(); m.r.onClient(order()); await flush();
  m.clock.t += TLIMITS.answerMs + 1; m.r.tick(); await flush();
  assert.equal(m.audits.get('ct-' + KEY).result, 'unknown'); assert.ok(m.c.some((x) => x.relay === 'unknown' && x.clientMsgId === KEY));
  assert.equal(m.lockDoc.v.key, KEY, 'lock kept');
  m.r.onClient(order({}, KEY2)); await flush(); assert.equal(refusedOf(m.c).at(-1).code, 'unresolved'); assert.equal(writesUp(m.u).length, 1, 'nothing else sent');
  const ask = m.u.filter((x) => x.payloadType === 2175).at(-1); assert.ok(ask, 'the relay asks cTrader for the order list'); assert.equal(ask.payload.ctidTraderAccountId, ACC);
  m.r.onUp(f({ clientMsgId: ask.clientMsgId, payloadType: 2176, payload: { ctidTraderAccountId: ACC, order: [{ orderId: 7777, clientOrderId: KEY, positionId: 9 }] } })); await flush();
  assert.equal(m.lockDoc.v, null, 'released'); assert.equal(m.audits.get('ct-' + KEY).result, 'accepted'); assert.equal(m.audits.get('ct-' + KEY).brokerOrderId, '7777');
  assert.ok(m.c.some((x) => x.relay === 'resolved' && x.result === 'accepted'));
});
await t('unknown that never reached cTrader -> not_found only after the wait; a forged 2176 from the browser path cannot settle it', async () => {
  const m = mk(); m.login(); m.r.onClient(order()); await flush();
  m.clock.t += TLIMITS.answerMs + 1; m.r.tick(); await flush();
  let ask = m.u.filter((x) => x.payloadType === 2175).at(-1);
  m.r.onUp(f({ clientMsgId: 'other', payloadType: 2176, payload: { order: [] } })); await flush(); assert.equal(m.lockDoc.v.key, KEY, 'unrelated list ignored');
  m.r.onUp(f({ clientMsgId: ask.clientMsgId, payloadType: 2176, payload: { order: [] } })); await flush(); assert.equal(m.lockDoc.v.key, KEY, 'too early to say not found');
  m.clock.t += RESOLVE_AFTER_MS; m.r.tick(); await flush(); ask = m.u.filter((x) => x.payloadType === 2175).at(-1);
  m.r.onUp(f({ clientMsgId: ask.clientMsgId, payloadType: 2176, payload: { order: [] } })); await flush();
  assert.equal(m.lockDoc.v, null); assert.equal(m.audits.get('ct-' + KEY).result, 'not_found');
  m.r.onClient(f({ clientMsgId: 'tzlock9-x', payloadType: 2124, payload: { ctidTraderAccountId: ACC } })); assert.equal(m.st.cc, 1008, "the browser can't use the relay's own ids");
});
await t('socket closes mid-order = unknown (lock kept); a NEW socket finds the held lock and settles it first', async () => {
  const m = mk(); m.login(); m.r.onClient(order()); await flush();
  m.r.onUpClose(); await flush();
  assert.equal(m.audits.get('ct-' + KEY).result, 'unknown'); assert.equal(m.lockDoc.v.key, KEY);
  const m2 = mk({ lockDoc: { ...m.lockDoc.v } }); m2.login(); await flush();
  m2.r.onClient(order({}, KEY2)); await flush(); assert.equal(refusedOf(m2.c).at(-1).code, 'unresolved'); assert.equal(writesUp(m2.u).length, 0);
  const ask = m2.u.filter((x) => x.payloadType === 2175).at(-1); assert.ok(ask, 'the reconnect asks for the order list');
});
await t('close before the send (gates still running) = rejected, nothing sent, lock released', async () => {
  let open; const m = mk({ over: { switchOn: () => new Promise((r) => { open = r; }) } }); m.login(); m.r.onClient(order()); await tick();
  m.r.onClientClose(); open(true); await flush();
  assert.equal(writesUp(m.u).length, 0); assert.equal(m.lockDoc.v, null);
});
await t('account pin: only the URL account, only a trading-scope token, only the matching live/demo server', async () => {
  let m = mk({ scope: 0 }); m.login(); assert.equal(m.st.cc, 1008, 'view-only token refused');
  m = mk({ isLive: true }); m.login(); assert.equal(m.st.cc, 1008, 'a live account on the demo socket refused');
  m = mk({ envName: 'live', isLive: true }); m.login(); assert.equal(m.st.cc, null, 'live account on the live socket');
  m = mk(); m.r.start(); m.r.onUp(f({ payloadType: 2101 })); m.r.onClient(f({ payloadType: 2149, payload: { accessToken: 'ACCESSTOKEN1' } }));
  m.r.onUp(f({ payloadType: 2150, payload: { permissionScope: 1, ctidTraderAccount: [{ ctidTraderAccountId: 88, isLive: false }] } }));
  m.r.onClient(f({ payloadType: 2102, payload: { ctidTraderAccountId: 88, accessToken: 'ACCESSTOKEN1' } })); assert.equal(m.st.cc, 1008, 'another account than the URL one');
  m = mk(); m.r.start(); m.r.onUp(f({ payloadType: 2101 })); m.r.onClient(order()); await flush(); assert.equal(m.st.cc, 1008, 'a write before account auth closes the socket'); assert.equal(writesUp(m.u).length, 0);
});
await t('gates line for the panel after app auth; secret never reaches the browser', async () => {
  const m = mk({ over: { consent: async () => false } }); m.login(); await flush();
  const g = m.c.find((x) => x.relay === 'gates'); assert.deepEqual(g, { relay: 'gates', consent: false, blocked: false, switchOn: true });
  assert.ok(!JSON.stringify(m.c).includes('SECRET-xyz-123'));
});

// ---- the endpoint door ----
const WS_REQ = (url, h = {}) => new Request(url, { headers: { upgrade: 'websocket', origin: 'https://tradezoro.com', 'sec-websocket-protocol': 'tz-auth, ' + 'h.' + btoa(JSON.stringify({ exp: 9e9 })) + '.s', ...h } });
const ENV = { CTRADER_CLIENT_ID: 'CID', CTRADER_CLIENT_SECRET: 'SECRET-xyz-123' };
await t('endpoint: not configured 503, origin 403, sign-in 401, non-admin 403, live off 403, bad account 400', async () => {
  const u = 'https://tradezoro.com/connect/ctrader/trade?account=77&env=demo';
  assert.equal((await tradeHandle(WS_REQ(u), {})).status, 503);
  assert.equal((await tradeHandle(WS_REQ(u, { origin: 'https://evil.example' }), ENV)).status, 403);
  assert.equal((await tradeHandle(WS_REQ('https://tradezoro.com/connect/ctrader/trade?env=demo'), ENV)).status, 400);
  const live = await tradeHandle(WS_REQ('https://tradezoro.com/connect/ctrader/trade?account=77&env=live'), ENV); assert.equal(live.status, 403); assert.equal((await live.json()).code, 'live_off');
  assert.equal((await tradeHandle(WS_REQ(u + '&x=1'), ENV, { verifyFetch: async () => new Response('{}', { status: 500 }) })).status, 401);
});
await t('endpoint: an admin gets a socket; a non-admin 403; a second socket for the same admin 429; closing frees it', async () => {
  const sock = () => { const L = {}; return { L, accept() {}, send() {}, close() {}, addEventListener(k, fn) { L[k] = fn; } }; };
  const deps = (admin, uid = 'adm1') => ({ verify: async () => uid, isAdmin: async () => admin, connect: async () => sock(), pair: () => [sock(), sock()], tickMs: 1e9, defer: () => {}, lock: { take: async () => true, peek: async () => null, release: async () => {} } });
  const u = 'https://tradezoro.com/connect/ctrader/trade?account=77&env=demo';
  const no = await tradeHandle(WS_REQ(u), ENV, deps(false)); assert.equal(no.status, 403); assert.equal((await no.json()).code, 'not_admin');
  const d1 = deps(true), r1 = await tradeHandle(WS_REQ(u), ENV, d1); assert.equal(r1.status, 101); assert.ok(r1.relay && r1.hooks);
  const r2 = await tradeHandle(WS_REQ(u), ENV, deps(true)); assert.equal(r2.status, 429); assert.equal((await r2.json()).code, 'other_tab');
  const other = await tradeHandle(WS_REQ(u), ENV, deps(true, 'adm2')); assert.equal(other.status, 101, 'another admin is not blocked'); other.relay.onClientClose();
  r1.relay.onClientClose();
});
await t('account lock: create-only, held answer, holder-only release', async () => {
  const docs = new Map(); const st = { get: async (p) => docs.get(p) || null, create: async (p, o) => { if (docs.has(p)) { const e = new Error('dup'); e.duplicate = true; throw e; } docs.set(p, o); return true; } };
  let deleted = 0; const deps = { store: st, auditFetch: async () => { deleted++; docs.delete('brokerLocks/ct_77'); return new Response('{}'); } };
  const env = { FIREBASE_SA_KEY: '' };
  const lk = accountLock(env, deps, 'u1', 77);
  assert.equal(await lk.take(KEY), true); const h = await lk.take(KEY2); assert.equal(h.key, KEY);
  assert.equal((await lk.peek()).key, KEY);
  await lk.release(KEY2); assert.ok(docs.has('brokerLocks/ct_77'), 'another key cannot release');
  void deleted;
});

await t('who may trade: admin or beta tester (verified email on settings/betaTesters); unverified, unlisted or unreadable = no', async () => {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
  const env = { FIREBASE_SA_KEY: JSON.stringify({ client_email: 'sa@test', private_key: '-----BEGIN PRIVATE KEY-----\n' + der + '\n-----END PRIVATE KEY-----' }) };
  const tokOf = (o) => 'h.' + Buffer.from(JSON.stringify(o)).toString('base64url') + '.s';
  const FSB = 'https://firestore.googleapis.com/v1/projects/strykertrades-e0cd8/databases/(default)/documents/';
  const mk = (docs, down = false) => async (url) => {
    url = String(url); const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
    if (url.startsWith('https://oauth2.googleapis.com/token')) return J({ access_token: 'x', expires_in: 3000 });
    if (down) return J({}, 500);
    const path = url.slice(FSB.length).split('?')[0];
    return docs[path] ? J({ name: 'x/' + path, fields: docs[path] }) : J({}, 404);
  };
  const list = { 'settings/betaTesters': { emails: { arrayValue: { values: [{ stringValue: 'tester@example.com' }] } } } };
  _resetTok(); assert.equal(await mayTrade(env, tokOf({ email: 'Tester@Example.com', email_verified: true }), 'u1', { betaFetch: mk(list) }), true, 'listed + verified');
  assert.equal(await mayTrade(env, tokOf({ email: 'tester@example.com', email_verified: false }), 'u1', { betaFetch: mk(list) }), false, 'unverified email');
  assert.equal(await mayTrade(env, tokOf({ email: 'other@example.com', email_verified: true }), 'u1', { betaFetch: mk(list) }), false, 'not listed');
  assert.equal(await mayTrade(env, tokOf({ email: 'x@example.com', email_verified: true }), 'ad', { betaFetch: mk({ ...list, 'admins/ad': { on: { booleanValue: true } } }) }), true, 'admin');
  await assert.rejects(mayTrade(env, tokOf({ email: 'tester@example.com', email_verified: true }), 'u1', { betaFetch: mk(list, true) }), 'Firestore down = throws (caller refuses)');
  const sock = () => ({ accept() {}, send() {}, close() {}, addEventListener() {} });
  const r = await tradeHandle(WS_REQ('https://tradezoro.com/connect/ctrader/trade?account=77&env=demo'), ENV, { verify: async () => 'u9', isAdmin: async () => { throw new Error('down'); }, connect: async () => sock(), pair: () => [sock(), sock()] });
  assert.equal(r.status, 503, 'an unreadable check refuses the socket'); const rj = await r.json(); assert.equal(rj.code, 'gate_unreadable'); assert.doesNotMatch(rj.error, /admins and beta testers/);
});

console.log(n + ' cTrader trading tests passed');
process.exit(0);   // the endpoint's 1-minute admin re-check timers would keep Node alive
