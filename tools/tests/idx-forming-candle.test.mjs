// QQQ 1m forming candle on the polled (non-hub) path (Discord 24 Nov, Mac app: "a full candle behind and just appear").
// The bars endpoint's newest row is one price (o = h = l = c, volume 0). IdxProvider.subscribe must fold it into the candle the chart
// already has (open kept, high / low widened), not redraw the forming candle as a flat dash every poll. Run: node tools/tests/idx-forming-candle.test.mjs
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
const { IdxProvider } = await import('../../assets/chart-futures-provider.js?v=1303');

const T = 1795550760;   // a minute
const p = new IdxProvider();
let feed = null;
p.getBars = async () => [{ time: T - 60, open: 100, high: 101, low: 99, close: 100.5, volume: 500 }, { time: T, open: 100.5, high: 100.8, low: 100.2, close: 100.6, volume: 40 }];
p.subscribeOld = (ticker, tf, onBar) => { feed = onBar; return () => {}; };   // stand in for the poll: we drive it
const got = [];
const stop = p.subscribe('QQQ', '1', (b) => got.push(b));
await new Promise((r) => setTimeout(r, 10));
assert.ok(feed, 'subscribed');

feed({ time: T, open: 100.5, high: 100.8, low: 100.2, close: 100.6, volume: 40 });   // a real bar: taken as is
feed({ time: T - 60, open: 100, high: 101, low: 99, close: 100.5, volume: 500 });   // each poll also re-sends the closed minute
feed({ time: T, open: 100.9, high: 100.9, low: 100.9, close: 100.9, volume: 0 });   // flat newest point, price up
let b = got[got.length - 1];
assert.deepEqual([b.open, b.high, b.low, b.close], [100.5, 100.9, 100.2, 100.9], 'flat point folded: open kept, high raised, low kept');
feed({ time: T - 60, open: 100, high: 101, low: 99, close: 100.5, volume: 500 });
feed({ time: T, open: 99.9, high: 99.9, low: 99.9, close: 99.9, volume: 0 });
b = got[got.length - 1];
assert.deepEqual([b.open, b.high, b.low, b.close], [100.5, 100.9, 99.9, 99.9], 'flat point folded: low widened');
assert.equal(b.volume, 40, 'volume kept');
// a new minute that starts with a flat point is shown as is (nothing to fold onto)
feed({ time: T + 60, open: 100, high: 100, low: 100, close: 100, volume: 0 });
b = got[got.length - 1];
assert.deepEqual([b.time, b.open, b.high, b.low, b.close], [T + 60, 100, 100, 100, 100], 'new minute starts at its first price');
feed({ time: T + 60, open: 100.3, high: 100.3, low: 100.3, close: 100.3, volume: 0 });
b = got[got.length - 1];
assert.deepEqual([b.open, b.high, b.low, b.close], [100, 100.3, 100, 100.3], 'and grows from there');
// a real bar for the minute (the server's closed row) replaces the folded one
feed({ time: T + 60, open: 100.1, high: 100.4, low: 99.95, close: 100.2, volume: 900 });
b = got[got.length - 1];
assert.deepEqual([b.open, b.high, b.low, b.close, b.volume], [100.1, 100.4, 99.95, 100.2, 900], 'real bar wins');
stop();
console.log('idx-forming-candle: all passed');
process.exit(0);   // the provider module keeps timers open
