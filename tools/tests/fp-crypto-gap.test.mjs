// Crypto footprint feed (assets/chart-footprint-crypto.js): no trade is lost between the REST backfill and the live socket.
//   node tools/tests/fp-crypto-gap.test.mjs
// Mocked fetch + WebSocket, no network. Trades 1..N exist; the newest REST page ends at HEAD, the socket's first message is
// HEAD + GAP + 1. Before the fix ids HEAD+1..HEAD+GAP were never seen (the live bar came out a few trades short).
import assert from 'node:assert/strict';

const NOW = Date.UTC(2026, 10, 22, 18, 13, 30);
const N = 3000, HEAD = 2990, GAP = 6;
const T = (a) => NOW - 3600e3 + a * 1000;          // one trade a second, ids 1..N
const trade = (a) => ({ a, p: String(60000 + (a % 7)), q: '0.0' + (1 + (a % 9)), T: T(a), m: a % 3 === 0 });
const calls = [];
globalThis.fetch = async (url) => {
  calls.push(url);
  const u = new URL(url), from = u.searchParams.get('fromId'), lim = +u.searchParams.get('limit') || 500;
  let ids;
  if (from == null) ids = Array.from({ length: Math.min(lim, HEAD) }, (_, i) => HEAD - Math.min(lim, HEAD) + 1 + i);   // newest page
  else { const f = Math.max(1, +from); ids = []; for (let a = f; a < f + lim && a <= N; a++) ids.push(a); }
  return { ok: true, json: async () => ids.map(trade) };
};
const sockets = [];
globalThis.WebSocket = class { constructor(u) { this.u = u; sockets.push(this); setTimeout(() => this.onopen && this.onopen(), 0); } close() {} };
globalThis.window = undefined;

const { cryptoFeed, cryptoFeeds } = await import('../../assets/chart-footprint-crypto.js');
const realNow = Date.now; Date.now = () => NOW;
const f = cryptoFeed('binance:BTCUSDT', () => {});
const ws = sockets[0];
// the socket delivers from HEAD+GAP+1 while the backfill is still running
for (let a = HEAD + GAP + 1; a <= N - 5; a++) ws.onmessage({ data: JSON.stringify(trade(a)) });
for (let i = 0; i < 200 && !(f.backfilled && f.ids.has(HEAD + 1)); i++) await new Promise((r) => setTimeout(r, 5));
await new Promise((r) => setTimeout(r, 30));
for (let a = N - 4; a <= N; a++) ws.onmessage({ data: JSON.stringify(trade(a)) });

for (let a = HEAD - 999; a <= N; a++) assert.ok(f.ids.has(a), 'trade id ' + a + ' missing');
// every minute in the window equals the source exactly (count, volume, delta)
const bars = f.bars();
for (const b of bars) {
  if (b.t < T(HEAD - 999)) continue;
  const src = []; for (let a = 1; a <= N; a++) if (Math.floor(T(a) / 60000) * 60000 === b.t) src.push(trade(a));
  if (src[0].a < HEAD - 999) continue;   // partial first minute of the backfill page
  const vol = src.reduce((s, t) => s + +t.q, 0), d = src.reduce((s, t) => s + (t.m ? -1 : 1) * t.q, 0);
  assert.equal(b.trades, src.length, 'minute ' + new Date(b.t).toISOString() + ' trades');
  assert.ok(Math.abs(b.vol - vol) < 1e-9 && Math.abs(b.delta - d) < 1e-9, 'minute volume / delta');
}
// the gap fill asked only for the hole, not the whole tail again
assert.ok(calls.some((u) => u.includes('fromId=' + (HEAD + 1))), 'gap fetched from HEAD+1');
f.stop(); cryptoFeeds().clear(); Date.now = realNow;
console.log('PASS fp-crypto-gap: no trade lost between backfill and socket (' + (N - HEAD + 1000) + ' ids checked)');
process.exit(0);
