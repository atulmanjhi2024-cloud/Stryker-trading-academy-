// Regression (member UnoMas, 23 Nov: "heavy for this device, did not finish within 20 seconds" on a short label/array script).
// pinets re-synced every drawing after every bar (bars x drawings); patchDrawingSync syncs once per run.
//   PINETS=/path/to/node_modules/pinets node tools/tests/chart-pine-drawing-sync.test.mjs
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
if (!process.env.PINETS) { console.log('SKIP: set PINETS=<path to node_modules/pinets>'); process.exit(0); }
const pt = await import(pathToFileURL(path.join(process.env.PINETS, 'dist', 'pinets.min.es.js')).href);
const patches = await import(pathToFileURL(path.join(here, '..', '..', 'assets', 'chart-pine-next-patches.js')).href);
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };
const mk = (n) => Array.from({ length: n }, (_, i) => { const c = 100 + Math.sin(i / 17) * 5 + Math.sin(i / 3.1); return { openTime: 1.7e12 + i * 6e4, closeTime: 1.7e12 + (i + 1) * 6e4, open: c - 0.3, high: c + 1, low: c - 1, close: c, volume: 100 + (i % 7) }; });
// short script: a label per bar, array.set / array.get feeding label.set_xy, old labels deleted by the 500 cap
const SRC = `//@version=5
indicator("Swing labels", overlay=true, max_labels_count=500)
var curr = array.new_float(2, 0.0)
var lbls = array.new_label(0)
array.set(curr, 0, bar_index)
array.set(curr, 1, high)
lb = label.new(bar_index, high, "H")
array.push(lbls, lb)
label.set_xy(lb, array.get(curr, 0), array.get(curr, 1))
plot(array.get(curr, 1))
`;
const run = async (bars) => { const t = Date.now(); const r = await new pt.PineTS(bars, 'X', '1').run(SRC); return { ms: Date.now() - t, labels: r.plots.__labels__.data[0].value.map((l) => [l.x, l.y, l.text]), plot: r.plots[Object.keys(r.plots).find((k) => !k.startsWith('__'))].data.length }; };

const small = mk(1500);
const before = await run(small);
patches.install(pt.Context, pt);
const after = await run(small);
check(before.labels.length === 500 && JSON.stringify(before.labels) === JSON.stringify(after.labels), 'same 500 labels with and without the patch');
check(before.plot === after.plot && before.plot === 1500, 'plot unchanged');
const big = await run(mk(20000));
console.log('20000 bars: ' + big.ms + ' ms');
check(big.ms < 2000, 'label/array script on 20000 bars finishes in under 2 s');
check(big.labels.length === 500 && big.labels[499][0] === 19999, 'newest 500 labels kept');
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
process.exit(fails ? 1 : 0);
