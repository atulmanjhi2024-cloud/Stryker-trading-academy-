// Unit tests for the 'openTime' indicator-error fix (Owner bug 22 Nov):
//   1. assets/chart-pine-next-patches.js patchEmptyLive: a live Pine stream on an empty bar list must not throw
//      "Cannot read properties of undefined (reading 'openTime')". Runs against a stand-in PineTS always, and
//      against the real pinets 0.11.0 when PINETS=<path to node_modules/pinets> is set (reproduces the bug first).
//   2. assets/chart-ind-errors.js: raw-toast filter, per-indicator fail tracker (one friendly toast, no stacking).
//   node tools/tests/chart-ind-errors.test.mjs
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const patches = await import(pathToFileURL(path.join(here, '..', '..', 'assets', 'chart-pine-next-patches.js')).href);
const IE = await import(pathToFileURL(path.join(here, '..', '..', 'assets', 'chart-ind-errors.js')).href);
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

// --- 1a. stand-in PineTS with pinets' exact unguarded read ---
class Fake {
  constructor(data, source){ this.data = data; this.source = source; }
  async _updateMarketData(){ if (Array.isArray(this.source)) return { newCandles: 0, updatedLastCandle: false }; const n = this.data[this.data.length - 1].openTime; return { newCandles: 0, updatedLastCandle: false, n }; }
}
const live = { getMarketData: async () => [] };
let threw = false; try { await new Fake([], live)._updateMarketData(); } catch (e) { threw = /openTime/.test(e.message); }
check(threw, 'stand-in reproduces the openTime TypeError on empty bars before the patch');
check(patches.patchEmptyLive(Fake) === true && patches.patchEmptyLive(Fake) === false, 'patchEmptyLive installs once');
const r0 = await new Fake([], live)._updateMarketData();
check(r0.newCandles === 0 && r0.updatedLastCandle === false, 'empty bars: no change, no throw');
const r1 = await new Fake([{ openTime: 5 }], live)._updateMarketData();
check(r1.n === 5, 'non-empty bars: original method still runs');
const r2 = await new Fake([undefined], live)._updateMarketData();
check(r2.newCandles === 0, 'hole at the last index: no throw');
check(patches.patchEmptyLive(null) === false && patches.patchEmptyLive({}) === false, 'bad input ignored');

// --- 1b. real pinets 0.11.0 (optional) ---
const PINETS = process.env.PINETS;
if (!PINETS) console.log('SKIP real pinets: set PINETS=<path to node_modules/pinets>');
else {
  const pt = await import(pathToFileURL(path.join(PINETS, 'dist', 'pinets.min.es.js')).href);
  const SRC = '//@version=6\nindicator("x", overlay=true)\nplot(ta.sma(close, 5))';
  const run = async () => {
    let cur = [];
    const prov = { getMarketData: async (t, tf, lim, s) => (s == null ? cur : cur.filter((k) => k.openTime >= s)), getSymbolInfo: async () => ({ ticker: 'X', timezone: 'UTC', mintick: 0.25 }) };
    const p = new pt.PineTS(prov, 'X', '1', 1);
    const errs = []; let data = 0;
    const ev = p.stream(new pt.Indicator(SRC), { live: true, interval: 30, pageSize: 1 });
    ev.on('error', (e) => errs.push(String(e && e.message || e))); ev.on('data', () => data++);
    await new Promise((r) => setTimeout(r, 250));
    ev.stop();
    return { errs, data };
  };
  const before = await run();
  check(before.errs.some((m) => /openTime/.test(m)), 'real pinets: empty live stream throws the openTime error unpatched');
  check(patches.patchEmptyLive(pt.PineTS) === true, 'real pinets: patch installs');
  const after = await run();
  check(after.errs.length === 0, 'real pinets: empty live stream raises no error after the patch ' + JSON.stringify(after.errs));
}

// --- 2. chart-ind-errors.js ---
check(IE.isRawIndicatorToast("[A] Cannot read properties of undefined (reading 'openTime')", 'error'), 'raw "[A] ..." error toast is caught');
check(IE.isRawIndicatorToast('[ind-12] boom', 'error'), 'raw "[cell] ..." with longer id is caught');
check(!IE.isRawIndicatorToast('[A] something', 'info'), 'info toasts pass');
check(!IE.isRawIndicatorToast('No registered provider serves "X"', 'error'), 'other error toasts pass');
check(!IE.isRawIndicatorToast('Alert: [A] NQ 1m', 'error'), 'prefix must be at the start');
const tell = IE.createFailTracker(3, 60000);
const seq = [0, 1000, 2000, 3000, 4000].map((t) => tell('vwap|VWAP', t));
check(JSON.stringify(seq) === '[false,false,true,false,false]', 'one toast on the 3rd failure, never again ' + JSON.stringify(seq));
const tell2 = IE.createFailTracker(3, 60000);
const spread = [0, 70000, 140000].map((t) => tell2('k', t));
check(spread.every((x) => !x), 'failures spread beyond the window never toast');
check(!tell('other|X', 0) && !tell('other|X', 1) && tell('other|X', 2), 'each indicator has its own count');
check(IE.friendlyText('VWAP') === "VWAP couldn't load on this chart. We've been notified.", 'friendly text');
check(IE.friendlyText('') === "This indicator couldn't load on this chart. We've been notified.", 'friendly text without a name');

console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
process.exit(fails ? 1 : 0);
