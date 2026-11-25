// Symbol search source filter: broker symbol -> our chart (assets/chart-search-sources.js mapCode). Run: node tests/chart-search-sources.test.mjs
import assert from 'node:assert/strict';
import { mapCode, specRows, marketState, acctLabel } from '../assets/chart-search-sources.js';
const c = (s, f) => { const m = mapCode(s, f); return m && [m.key, m.cls, m.charts[0].join(':')]; };
for (const s of ['USTEC', 'US100', 'NAS100', 'NDX100', 'US100.cash']) assert.deepEqual(c(s), ['NDX', 'Indices', 'futures:NQ1!'], s);
assert.deepEqual(c('US500'), ['SPX', 'Indices', 'futures:ES1!']);
assert.deepEqual(c('US30'), ['DJI', 'Indices', 'futures:YM1!']);
assert.deepEqual(c('XAUUSD'), ['XAU', 'Metals', 'fx:XAUUSD']);
assert.deepEqual(c('GOLD'), ['XAU', 'Metals', 'fx:XAUUSD']);
assert.deepEqual(c('USOIL'), ['WTI', 'Energy', 'futures:CL1!']);
assert.deepEqual(c('EURUSD'), ['EURUSD', 'Forex', 'fx:EURUSD']);
assert.deepEqual(c('EURUSDm'), ['EURUSD', 'Forex', 'fx:EURUSD']);
assert.deepEqual(c('GBPJPY.pro'), ['GBPJPY', 'Forex', 'fx:GBPJPY']);
assert.deepEqual(c('BTCUSD'), ['BTCUSD', 'Crypto', 'binance:BTCUSDT']);
assert.equal(mapCode('AAPL.US'), null);
assert.equal(mapCode(''), null);
assert.deepEqual(c('NQZ6', true), ['', 'Futures', 'futures:NQ1!']);
assert.deepEqual(c('MES', true), ['', 'Futures', 'futures:MES1!']);
assert.equal(mapCode('FOO', true), null);
// spec rows (cTrader ProtoOASymbol, sample numbers): lot size and volumes are in cents of units
const d = { lotSize: 10000000, minVolume: 100000, stepVolume: 100000, swapLong: -0.79, swapShort: 0.13, commissionType: 1, preciseTradingCommissionRate: 3000000000 };
const rows = Object.fromEntries(specRows({ d, base: 'EUR' }).map(([k, v]) => [k.replace(/\s/g, ''), v]));
assert.match(rows['1lot'], /^100,?000 EUR$/);
assert.match(rows.Smallesttrade, /^0\.01 lots$/);
assert.equal(rows['Swap(pips)'], 'Long −0.79 · Short +0.13');
assert.equal(rows.Commissionperside, '30 USD / 1M USD');
assert.equal(specRows({ d: { lotSize: 100 } }).length, 1, 'rows we lack are left out');
assert.deepEqual(specRows(null), []);
// schedule: Mon-Fri 00:00-23:59 UTC; Wednesday noon UTC = open; Saturday = closed
const S = [1, 2, 3, 4, 5].map((x) => ({ startSecond: x * 86400, endSecond: x * 86400 + 86340 }));
assert.match(marketState(S, 'UTC', Date.UTC(2026, 10, 25, 12)), /^Open, closes /);
assert.match(marketState(S, 'UTC', Date.UTC(2026, 10, 28, 12)), /^Closed, opens /);
assert.equal(marketState([], 'UTC'), '');
assert.equal(acctLabel({ number: '5551234', demo: true }), 'Demo …234');
assert.equal(acctLabel({ number: '70001495' }), 'Live …495');
console.log('chart-search-sources: ok');
