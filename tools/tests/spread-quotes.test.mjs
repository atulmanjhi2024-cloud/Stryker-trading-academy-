// Spread store (assets/byo-core.js QUOTES): keys, pip units, the "wider than usual" rule. Sample data. Run: node tools/tests/spread-quotes.test.mjs
import assert from 'node:assert/strict';
import { QUOTES } from '../../assets/byo-core.js?v=1300';

// cTrader chart + account key are the same instrument
QUOTES.setPip('CT:NAS100', 0.1);   // a 0.1 pip size fixture (pipPosition 1)
QUOTES.put('CT:NAS100', 100.00, 100.12);
let q = QUOTES.get('byo:CT:NAS100', 0.01);
assert.equal(q.bid, 100); assert.equal(q.ask, 100.12);
assert.equal(Math.round(q.spread * 10) / 10, 1.2, 'spread 0.12 / 0.1 pip = 1.2');
// forex: the pair's pip without symbol details; OANDA EUR_USD == fx:EURUSD
QUOTES.put('EUR_USD', 1.08000, 1.08012);
q = QUOTES.get('fx:EURUSD', 0.00001); assert.equal(Math.round(q.spread * 10) / 10, 1.2);
QUOTES.put('USDJPY', 150.000, 150.015);
assert.equal(Math.round(QUOTES.get('USDJPY').spread * 10) / 10, 1.5);
// no quote = null (futures / stock charts draw nothing)
assert.equal(QUOTES.get('futures:NQ1!', 0.25), null);
// bad quotes are ignored
QUOTES.put('BAD', 0, 1); QUOTES.put('BAD2', 2, 1);
assert.equal(QUOTES.get('BAD'), null); assert.equal(QUOTES.get('BAD2'), null);
// wide: > 3x the 5-min median, only once 20 samples exist (one per second)
const realNow = Date.now; let t = realNow();
Date.now = () => t;
for (let i = 0; i < 30; i++) { t += 1000; QUOTES.put('XAUUSD', 2000.00, 2000.30); }
QUOTES.setPip('XAUUSD', 0.01);
assert.equal(QUOTES.get('XAUUSD').wide, false);
t += 1000; QUOTES.put('XAUUSD', 2000.00, 2001.20);   // 120 pts vs a 30 pt median
assert.equal(QUOTES.get('XAUUSD').wide, true);
t += 1000; QUOTES.put('XAUUSD', 2000.00, 2000.50);   // 50 < 90: normal again
assert.equal(QUOTES.get('XAUUSD').wide, false);
Date.now = realNow;
console.log('ALL PASS spread-quotes');
