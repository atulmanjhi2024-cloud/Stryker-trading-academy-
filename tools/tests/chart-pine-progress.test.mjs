// Unit test for patchProgress in assets/chart-pine-next-patches.js (member report 22 Nov 2026,
// custom scripts "time out and won't load"): the chunked bar loop must give the SAME plots as pinets'
// own single loop, report progress while it runs, and leave strategy scripts unsplit.
// Needs a local pinets 0.11.0 (not a repo dependency):
//   PINETS=/path/to/node_modules/pinets node tools/tests/chart-pine-progress.test.mjs
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PINETS = process.env.PINETS;
if (!PINETS) { console.log('SKIP: set PINETS=<path to node_modules/pinets>'); process.exit(0); }
const url = pathToFileURL(path.join(PINETS, 'dist', 'pinets.min.es.js')).href;
const patches = await import(pathToFileURL(path.join(here, '..', '..', 'assets', 'chart-pine-next-patches.js')).href);

let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };
function bars(n){
  let x = 11, p = 100;
  const rnd = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
  return Array.from({ length: n }, (_, i) => { const o = p; p += (rnd() - 0.5) * 2; const c = Math.round(p * 4) / 4;
    return { openTime: 1.7e12 + i * 3e5, closeTime: 1.7e12 + (i + 1) * 3e5, open: o, high: Math.max(o, c) + rnd(), low: Math.min(o, c) - rnd(), close: c, volume: 100 + i % 7 }; });
}
const IND = `//@version=5
indicator("p")
var float acc = 0.0
acc += close - open
float s = 0.0
for i = 0 to 49
    s += nz(close[i])
plot(acc, "acc")
plot(s / 50, "avg")
plot(ta.rsi(close, 14), "rsi")
`;
const STRAT = `//@version=5
strategy("s", overlay=true)
if ta.crossover(ta.ema(close, 5), ta.ema(close, 20))
    strategy.entry("L", strategy.long)
if ta.crossunder(ta.ema(close, 5), ta.ema(close, 20))
    strategy.close("L")
plot(strategy.netprofit, "np")
`;
const plotsOf = (r) => { const o = {}; for (const k of Object.keys(r.plots || {})) if (!k.startsWith('__')) o[k] = r.plots[k].data.map((d) => d.value); return o; };
const same = (a, b) => JSON.stringify(a, (k, v) => (typeof v === 'number' && Number.isNaN(v) ? 'NaN' : v)) === JSON.stringify(b, (k, v) => (typeof v === 'number' && Number.isNaN(v) ? 'NaN' : v));

const B = bars(3000);
// unpatched reference (fresh module instance: query string)
const ref = await import(url + '?ref');
const r1 = plotsOf(await new ref.PineTS(B, 'X', '5').run(IND));
const s1 = plotsOf(await new ref.PineTS(B, 'X', '5').run(STRAT));

const pt = await import(url);
const seen = [];
check(patches.patchProgress(pt.PineTS, (p) => seen.push(p)) === true, 'patchProgress installs');
check(patches.patchProgress(pt.PineTS, () => {}) === false, 'second install is a no-op');
const t0 = Date.now();
const r2 = plotsOf(await new pt.PineTS(B, 'X', '5').run(IND));
check(same(r1, r2), 'indicator: identical plots with the chunked loop (' + Object.keys(r2).length + ' plots, ' + B.length + ' bars)');
check(Date.now() - t0 < 250 || seen.length > 0, 'progress reported during a run longer than 250 ms (' + seen.length + ' reports)');
check(seen.every((p) => p.done > 0 && p.done <= p.total && p.total === B.length), 'reports carry done <= total');
const n0 = seen.length;
const s2 = plotsOf(await new pt.PineTS(B, 'X', '5').run(STRAT));
check(same(s1, s2), 'strategy: identical plots (not split)');
check(seen.length === n0, 'strategy runs are never split');
console.log(fails ? 'FAILED ' + fails : 'ALL PASS');
process.exit(fails ? 1 : 0);
