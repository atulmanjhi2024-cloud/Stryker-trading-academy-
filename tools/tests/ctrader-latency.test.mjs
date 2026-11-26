// cTrader ORDER LATENCY tests (FASTORDER, Owner 25 Nov: "after I click buy it takes ~2 s to confirm"). The REAL browser link
// (assets/ctrader-trade.js) + the REAL relay rules (_relay.js + _trade.js) against the mocked cTrader (ctrader-mock.mjs) with set
// delays: every Firestore call fsMs, cTrader's answer ctMs. Asserts OUR overhead (click -> answer, minus the mock's own delays) is
// at most 100 ms, including the first order after 2 minutes idle (the relay's 60 s idle close), back-to-back orders (no fixed
// 550 ms gap) and that the order log row is still written BEFORE the order goes to cTrader. No network. All numbers are Sample data.
// Run: node tools/tests/ctrader-latency.test.mjs            (prints a table; BENCH_JSON=1 prints JSON)
import assert from 'node:assert/strict';
import { webcrypto as C } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = C;
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
globalThis.sessionStorage = mem();
const T = await import('../../assets/ctrader-trade.js?v=1304');
const { makeWS, mockState, ACC } = await import('./ctrader-mock.mjs');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CREDS = () => ({ access: 'ACCESSTOKENsample1', refresh: 'REFRESHsample1', exp: Date.now() + 30 * 864e5, accountId: ACC, isLive: false, kind: 'trade' });
let skew = 0; const clock = () => Date.now() + skew;   // the relay's clock: skew += 120000 = two idle minutes
const mk = (M) => { const L = new T.TradeLink(CREDS(), { WS: makeWS(M, { now: clock }), location: { protocol: 'https:', host: 'tradezoro.com' }, idToken: async () => 'IDT', save: async () => {} }); L.keep = () => true; return { L, ops: T.ctOps(L, { lastPrice: () => 18000 }) }; };
let k = 0; const KEY = () => 'k-lat-000000000000' + String(++k).padStart(4, '0');
const rows = [];
const timeOrder = async (ops, extra = {}) => {
  const lat = { t0: performance.now() };
  const r = await ops.order({ op: 'place', symbol: 'US100', side: 'buy', qty: 0.1, type: 'market', idemKey: KEY(), lat, ...extra });
  return { r, lat, ms: lat.ack - lat.t0 };
};
const FS = 60, CTMS = 100, OVER = 100;

await t('warm link: click -> cTrader answer is the mock delays + at most 100 ms (gates, lock and log row run in parallel)', async () => {
  const M = mockState({ fsMs: FS, ctMs: CTMS }); const { L, ops } = mk(M);
  await L.warm('US100'); await sleep(50);
  const a = await timeOrder(ops);
  assert.equal(a.r.status, 'FILLED');
  rows.push(['warm, first order', Math.round(a.ms), FS + CTMS]);
  assert.ok(a.ms <= FS + CTMS + OVER, 'overhead ' + Math.round(a.ms - FS - CTMS) + ' ms');
  // the log row exists before the frame reached cTrader (never "log after send")
  const id = 'ct-' + Object.keys(M.upAt)[0]; assert.ok(M.auditAt[id] <= M.upAt[id.slice(3)], 'audit row before send');
  L.shut();
});
await t('first order after 2 minutes idle: the relay closed the idle socket, the link reopened itself; the click pays no reconnect', async () => {
  const M = mockState({ fsMs: FS, ctMs: CTMS }); const { L, ops } = mk(M);
  await L.warm('US100'); const s0 = M.sockets;
  skew += 120000; await sleep(400);   // relay tick (200 ms) sees 2 min idle -> close 1001
  assert.equal(L.ready, null, 'idle socket was closed by the relay');
  await sleep(900);                   // TT.REOPEN_MS[0] = 300 ms + connect + auth + symbols + the symbol rules again
  assert.ok(M.sockets > s0 && L.ready, 'reopened in the background');
  const a = await timeOrder(ops);
  rows.push(['after 2 min idle', Math.round(a.ms), FS + CTMS]);
  assert.equal(a.r.status, 'FILLED'); assert.ok(a.ms <= FS + CTMS + OVER, 'overhead ' + Math.round(a.ms - FS - CTMS) + ' ms');
  L.shut();
});
await t('back-to-back orders: the second goes straight out (no fixed 550 ms gap); a third in the same second waits for the relay limit', async () => {
  const M = mockState({ fsMs: FS, ctMs: CTMS }); const { L, ops } = mk(M);
  await L.warm('US100'); await sleep(30);
  await timeOrder(ops); const b = await timeOrder(ops);
  rows.push(['2nd order right after', Math.round(b.ms), FS + CTMS]);
  assert.ok(b.ms <= FS + CTMS + OVER, 'second order overhead ' + Math.round(b.ms - FS - CTMS) + ' ms');
  const c = await timeOrder(ops); assert.equal(c.r.status, 'FILLED', 'third is not refused too_fast (the link waits for the window instead)');
  L.shut();
});
await t('market order answered ORDER_ACCEPTED first: r.fill gives the fill price when the fill event comes', async () => {
  const M = mockState({ fsMs: 0, ctMs: CTMS, twoStep: true, fillMs: 40 }); const { L, ops } = mk(M);
  await L.warm('US100');
  const a = await timeOrder(ops);
  assert.equal(a.r.status, 'ACCEPTED'); assert.ok(a.r.fill && typeof a.r.fill.then === 'function');
  const px = await a.r.fill; assert.equal(px, 18000.75);
  L.shut();
});
await t('timing marks: the relay sends its split back and stores the browser marks on THIS order\'s log row only', async () => {
  const M = mockState({ fsMs: FS, ctMs: CTMS }); const { L, ops } = mk(M);
  await L.warm('US100');
  const a = await timeOrder(ops); await sleep(30);
  const key = Object.keys(M.upAt)[0], w = a.lat.watch;
  assert.ok(w.server && w.server.s_pre >= FS && w.server.s_ct >= CTMS, JSON.stringify(w.server));
  L.marks(key, { c_open: 1, c_send: 2, c_ack: Math.round(a.ms), c_toast: Math.round(a.ms) + 1 }); await sleep(40);
  const row = M.audits['ct-' + key]; assert.equal(row.c_ack, Math.round(a.ms)); assert.equal(row.result, 'accepted'); assert.ok(row.s_pre >= FS);
  // marks for a key this socket never sent are dropped; a bad value closes nothing but is refused by the schema (socket closed)
  L.marks('k-never-sent-000000000000', { c_ack: 5 }); await sleep(30); assert.equal(M.audits['ct-k-never-sent-000000000000'], undefined);
  L.marks(key, { c_ack: 7 }); await sleep(30); assert.equal(M.audits['ct-' + key].c_ack, Math.round(a.ms), 'only once per order');
  L.shut();
});
await t('still safe: switched off -> refused, nothing sent, the log row is finished "rejected", the lock is released', async () => {
  const M = mockState({ fsMs: FS, ctMs: CTMS }); const { L, ops } = mk(M);
  await L.warm('US100'); M.gate.switchOn = false; await sleep(5100);   // the per-socket switch cache is 5 s
  const before = M.sent.filter((x) => x.payloadType === 2106).length;
  await assert.rejects(timeOrder(ops), (e) => e.code === 'switched_off');
  await sleep(FS * 2 + 20);
  assert.equal(M.sent.filter((x) => x.payloadType === 2106).length, before, 'nothing reached cTrader');
  assert.equal(M.lock, null, 'lock released');
  const row = Object.values(M.audits).pop(); assert.equal(row.result, 'rejected'); assert.equal(row.message, 'switched_off');
  L.shut();
});
await t('parallel checks, still one decision: a lock held by another order -> nothing sent, OUR log row is "rejected", the other lock untouched', async () => {
  const M = mockState({ fsMs: 20 }); const { L, ops } = mk(M);
  await L.warm('US100'); const before = M.sent.filter((x) => x.payloadType === 2106).length;
  M.lock = { key: 'k-someone-else-00000000001', at: clock() };   // the relay's clock (a 30 s old lock would be resolved from the order list)
  await assert.rejects(timeOrder(ops)); await sleep(80);
  assert.equal(M.sent.filter((x) => x.payloadType === 2106).length, before, 'nothing reached cTrader');
  assert.equal(M.lock.key, 'k-someone-else-00000000001', 'the other order\'s lock is not released');
  const row = Object.values(M.audits).pop(); assert.equal(row.result, 'rejected');
  L.shut();
});
await t('parallel checks: a duplicate key -> nothing sent, the lock this write took is released, the earlier row untouched', async () => {
  const M = mockState({ fsMs: 20 }); const { L, ops } = mk(M);
  await L.warm('US100');
  const dup = 'k-dup-0000000000000001'; M.audits['ct-' + dup] = { result: 'accepted', sample: true };
  const before = M.sent.filter((x) => x.payloadType === 2106).length;
  await assert.rejects(ops.order({ op: 'place', symbol: 'US100', side: 'buy', qty: 0.1, type: 'market', idemKey: dup }), (e) => e.code === 'duplicate');
  await sleep(80);
  assert.equal(M.sent.filter((x) => x.payloadType === 2106).length, before); assert.equal(M.lock, null, 'lock released');
  assert.deepEqual(M.audits['ct-' + dup], { result: 'accepted', sample: true });
  L.shut();
});
await t('SLIPPAGE: the expected price + the fill + the slippage go to THIS order\'s log row (marks, after the order), bad values refused', async () => {
  const LC = await import('../../assets/chart-live-core.js?v=1304');
  const M = mockState({ fsMs: 0, ctMs: 20, twoStep: true, fillMs: 30, fillPx: 99.8 }); const { L, ops } = mk(M);
  await L.warm('US100');
  const a = await timeOrder(ops, { side: 'sell' }); const fill = await a.r.fill; assert.equal(fill, 99.8);
  const key = Object.keys(M.upAt)[0], row0 = { ...M.audits['ct-' + key] };
  assert.equal(row0.exp_px, undefined, 'nothing about slippage on the row before the order (attempt row)');
  const sl = LC.slippage('sell', 100, fill, 1, 0.01); assert.deepEqual(sl, { exp: 100, fill: 99.8, pts: 0.2, money: 0.2 });
  L.marks(key, { c_ack: 5, exp_px: sl.exp, fill_px: sl.fill, slip_pts: sl.pts, slip_money: sl.money }); await sleep(40);
  const row = M.audits['ct-' + key]; assert.equal(row.exp_px, 100); assert.equal(row.fill_px, 99.8); assert.equal(row.slip_pts, 0.2); assert.equal(row.slip_money, 0.2); assert.equal(row.result, 'accepted');
  L.shut();
});
console.table(rows.map(([what, ms, mock]) => ({ case: what, 'click->answer ms': ms, 'mock delays ms': mock, 'our overhead ms': ms - mock })));
if (process.env.BENCH_JSON) console.log(JSON.stringify(rows));
console.log(n + ' cTrader latency tests passed');
process.exit(0);
