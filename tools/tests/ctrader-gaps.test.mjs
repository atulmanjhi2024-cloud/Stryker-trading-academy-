// CFDGAPS (Owner bug 25 Nov: "candles are breaking in cfd charts like ctrader"): no missing minutes on broker-price charts.
// Mocked cTrader socket only (tools/tests/ctrader-mock.mjs: the real relay rules + a fake server). All bars are Sample data.
// No order message is ever sent (checked). Run: node tools/tests/ctrader-gaps.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// Import with the same ?v= the assets use for each other (build bumps change it), else Node loads a second byo-core and the
// provider never sees this test's cTrader session. Paths resolve from this file, so any cwd works.
const A = new URL('../../assets/', import.meta.url), V = (readFileSync(new URL('byo-provider.js', A), 'utf8').match(/byo-core\.js\?v=(\d+)/) || [])[1];
const at = (f) => new URL(f + (V ? '?v=' + V : ''), A).href;
const core = await import(at('byo-core.js')), ct = await import(at('byo-ctrader.js'));
const { ByoProvider, HEAL, mergeBars, healAll } = await import(at('byo-provider.js'));
import { mockState, makeWS } from './ctrader-mock.mjs';
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIN = 60000;

await t('mergeBars: inserts missing minutes, fixes a differing closed bar, keeps the live forming bar, no duplicates', () => {
  const B = (m, c) => ({ time: m * MIN, open: c, high: c + 1, low: c - 1, close: c, volume: 1 });
  const raw = [B(0, 10), B(1, 11), B(5, 15)];
  const out = mergeBars(raw, [B(1, 99), B(2, 12), B(3, 13), B(4, 14), B(5, 50), B(2, 12)]);
  assert.deepEqual(out.map((b) => b.time / MIN), [0, 1, 2, 3, 4, 5]);
  assert.equal(out[1].close, 99, 'closed bar replaced by the server copy');
  assert.equal(out[5].close, 15, 'forming bar keeps its live value');
  assert.equal(mergeBars(out, [B(2, 12), B(3, 13)]), null, 'nothing to change -> null');
});

await t('live trendbar: OHLC from cTrader, close at the latest bid; spots plot the BID, never the ask', async () => {
  const b = ct.liveTbBar({ utcTimestampInMinutes: 100, low: 2500000, deltaOpen: 500, deltaHigh: 900, period: 1 }, 25.007);
  assert.deepEqual(b, { time: 100 * MIN, open: 25.005, high: 25.009, low: 25, close: 25.007, volume: 0 });
  const b2 = ct.liveTbBar({ utcTimestampInMinutes: 100, low: 2500000, deltaOpen: 500, deltaHigh: 900, period: 'M1' }, 25.02);
  assert.equal(b2.high, 25.02, 'a bid above the trendbar high lifts the high');
});

// ---- the chart: a fake Vela workspace with one cell (byo:CT:NAS100, 1m) whose orchestrator holds the raw bars ----
const M = mockState({ extra: [{ symbolId: 13, symbolName: 'NAS100', digits: 2, desc: 'Nasdaq 100 Index' }] });
const now0 = Math.floor(Date.now() / MIN);
const T = (k) => now0 - 27 + k;               // T(0) = "10:00", T(27) = "10:27" = the current minute
let serverTo = T(20);                          // the server has bars up to this minute (Sample data)
M.bar = (m) => (m <= serverTo ? { low: 2500000 + (m % 50) * 100, deltaOpen: 30, deltaHigh: 80, deltaClose: 50, volume: 5 } : null);
const orch = { rawBars: [], sets: 0, setBarSeries(raw) { this.rawBars = raw; this.sets++; }, reexecuteIndicators() {} };
HEAL.ws = () => ({ context: () => ({ cells: [{ id: 'c1', symbol: 'byo:CT:NAS100', timeframe: '1' }] }), cell: () => ({ chart: { orchestrator: orch } }) });
const creds = { access: 'ACCESSTOKENsample1', refresh: 'R', exp: Date.now() + 30 * 864e5, accountId: 77, isLive: false };
const deps = { WS: makeWS(M), idToken: async () => 'IDT', location: { protocol: 'http:', host: 'test' } };
ct.useTradeAccount(creds, async (c) => c.access, deps, core);
const P = new ByoProvider();

await t('history: bars 10:00-10:20 from trendbars (2137, bid bars)', async () => {
  const bars = await P.getBars('CT:NAS100', '1', { from: T(0) * MIN, to: T(20) * MIN + 1 });
  assert.equal(bars.length, 21); assert.equal(bars[0].time, T(0) * MIN); assert.equal(bars[20].time, T(20) * MIN);
  orch.rawBars = bars;
});

let unsub;
await t('live: subscribes the 1m live trendbar (2135) and spots (2127)', async () => {
  unsub = P.subscribe('CT:NAS100', '1', (b) => {   const r = orch.rawBars, l = r[r.length - 1]; if (b.time === l.time) r[r.length - 1] = b; else if (b.time > l.time) r.push(b); });
  for (let i = 0; i < 40 && !(M.tbSubs || []).length; i++) await sleep(100);
  assert.ok((M.tbSubs || []).some((p) => p.period === 1 && p.symbolId === 13), 'live trendbar subscribed for period M1');
  assert.ok(M.spots >= 1);
});

await t('socket drop, resume at 10:27: chart refetches and shows every minute 10:21-10:27, no gap, no duplicate', async () => {
  const sockets = M.sockets;
  serverTo = T(27);
  M.socket.relay.onUpClose();                         // the relay drops
  for (let i = 0; i < 80 && M.sockets === sockets; i++) await sleep(100);
  assert.ok(M.sockets > sockets, 'reconnected');
  for (let i = 0; i < 80 && M.tbSubs.length < 2; i++) await sleep(100);
  assert.equal(M.tbSubs.length, 2, 'live trendbar re-subscribed after the reconnect');
  assert.equal(core.statusRec('ctacct').hub.status, 'live', 'the live feed itself reconnected (it used to retry on a closed socket forever)');
  // first tick after the resume, with cTrader's forming trendbar for 10:27
  const s = M.socket;
  s.relay.onUp(JSON.stringify({ payloadType: 2131, payload: { ctidTraderAccountId: 77, symbolId: 13, bid: 2510000, ask: 2510150, timestamp: T(27) * MIN + 5000, trendbar: [{ period: 'M1', utcTimestampInMinutes: T(27), low: 2509000, deltaOpen: 400, deltaHigh: 1500 }] } }));
  for (let i = 0; i < 60; i++) { if (orch.rawBars.length === 28 && orch.rawBars[27].close === 25.1) break; await sleep(100); }
  const mins = orch.rawBars.map((b) => b.time / MIN - T(0));
  assert.deepEqual(mins, Array.from({ length: 28 }, (_, i) => i), 'every minute 10:00-10:27');
  const last = orch.rawBars[27];
  assert.equal(last.close, 25.1, 'forming bar closes at the bid (not the ask 25.1015)');
  assert.equal(last.open, 25.094); assert.equal(last.high, 25.105);
});

await t('60 s check: a closed bar that differs from the server is fixed; a missing middle minute is refilled', async () => {
  const r = orch.rawBars.slice(); r[25] = { ...r[25], close: 1 }; r.splice(23, 1); orch.rawBars = r;
  await healAll('timer');
  assert.deepEqual(orch.rawBars.map((b) => b.time / MIN - T(0)), Array.from({ length: 28 }, (_, i) => i));
  assert.notEqual(orch.rawBars[25].close, 1);
});

await t('a real market break (server has no bars there) is left alone and not re-asked every minute', async () => {
  const keep = M.bar; M.bar = (m) => (m === T(10) || m === T(11) ? null : keep(m));
  const r = orch.rawBars.filter((b) => b.time !== T(10) * MIN && b.time !== T(11) * MIN); orch.rawBars = r;
  await healAll('timer'); const calls = M.barCalls.length;
  assert.equal(orch.rawBars.length, 26);
  await healAll('timer');
  assert.ok(M.barCalls[calls].from >= T(24) * MIN, 'next check asks only for the last 3 bars');
  M.bar = keep;
});

await t('history calls are paced under the relay limit (4 a second), so a burst never drops the socket', async () => {
  const sockets = M.sockets, t0 = Date.now();
  await Promise.all(Array.from({ length: 8 }, () => P.getBars('CT:NAS100', '1', { limit: 5 })));
  assert.equal(M.sockets, sockets, 'same socket'); assert.ok(Date.now() - t0 >= 1000, 'paced');
});

await t('read-only: no order / trading frame was ever sent', () => {
  assert.equal(M.sent.filter((m) => [2106, 2107, 2108, 2109, 2110, 2111].includes(m.payloadType)).length, 0);
});
unsub(); await sleep(50);
console.log('ALL PASS', n);
process.exit(0);
