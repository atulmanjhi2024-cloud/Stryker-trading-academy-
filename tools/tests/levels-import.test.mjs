// node tools/tests/levels-import.test.mjs — the pure part of "Import levels" (assets/chart-levels-core.js):
// the text / Pine parser, tick rounding + merging, the axis fit (linear + log) and the line / box
// detector on small synthetic images. The screenshot accuracy run (real OCR) is the browser suite
// tools/tests/levels-import-browser.js. Sample data only.
import assert from 'node:assert/strict';
import * as C from '../../assets/chart-levels-core.js';

let n = 0;
const t = (name, fn) => { fn(); n++; };
const prices = (r) => r.levels.map((l) => l.price);

// ---------------------------------------------------------------- text lists
t('comma list', () => assert.deepEqual(prices(C.parseLevelsText('21450, 21500.25, 21388')), [21450, 21500.25, 21388]));
t('one per line + labels', () => {
  const r = C.parseLevelsText('21450 PDH\n21500.25\nPDL: 21388.5\n  \nVWAP - 21412.75');
  assert.equal(r.kind, 'list');
  assert.deepEqual(r.levels, [{ price: 21450, label: 'PDH' }, { price: 21500.25, label: '' }, { price: 21388.5, label: 'PDL' }, { price: 21412.75, label: 'VWAP' }]);
});
t('thousands separators', () => assert.deepEqual(prices(C.parseLevelsText('21,450.25\n1,234,567\n98,250')), [21450.25, 1234567, 98250]));
t('space separated on one line', () => assert.deepEqual(prices(C.parseLevelsText('6010 6020.5 6031.25')), [6010, 6020.5, 6031.25]));
t('semicolons, tabs, pipes', () => assert.deepEqual(prices(C.parseLevelsText('1.0850; 1.0875\t1.0900 | 1.0925')), [1.085, 1.0875, 1.09, 1.0925]));
t('times and dates are skipped', () => assert.deepEqual(prices(C.parseLevelsText('09:30 open\n2026-11-20\n21450')), [21450]));
t('zero / negative / junk dropped', () => assert.deepEqual(prices(C.parseLevelsText('0\n-5\nabc\n21450')), [21450]));
t('duplicates once', () => assert.deepEqual(prices(C.parseLevelsText('21450\n21450\n21450 PDH')), [21450, 21450]));
t('unicode minus + spaces', () => assert.deepEqual(prices(C.parseLevelsText('  4512.5  ')), [4512.5]));
t('cap 200', () => assert.equal(C.parseLevelsText(Array.from({ length: 300 }, (_, i) => 100 + i).join('\n')).levels.length, 200));

// ---------------------------------------------------------------- Pine
t('pine hline + line.new + inputs', () => {
  const src = `//@version=5
indicator("My levels", overlay=true)
pdh = 21525.25
lvl = input.float(21480.5, "Weekly open")
var float s1 = input.float(defval = 21401, title = "S1")
hline(pdh, "PDH", color=color.red)
hline(21442.75, title="Mid", linestyle=hline.style_dashed)
hline(price=21390)
hline(lvl)
line.new(bar_index - 10, 21600, bar_index, 21600, color=color.blue)
line.new(x1=bar_index, y1=s1, x2=bar_index + 5, y2=s1)
line.new(bar_index, 21000, bar_index + 5, 21100)   // a sloped line: skipped
// hline(99999) commented out
plot(close)
plot(21300, "Floor")`;
  const r = C.parseLevelsText(src);
  assert.equal(r.kind, 'pine');
  assert.deepEqual(r.levels, [
    { price: 21525.25, label: 'PDH' }, { price: 21442.75, label: 'Mid' }, { price: 21390, label: '' }, { price: 21480.5, label: 'Weekly open' },
    { price: 21600, label: '' }, { price: 21401, label: 'S1' }, { price: 21300, label: 'Floor' }]);
});
t('pine v4 study', () => assert.deepEqual(prices(C.parseLevelsText('study("x", overlay=true)\nhline(4500.5)\nhline(4520)')), [4500.5, 4520]));

// ---------------------------------------------------------------- rounding + merge
t('roundTick', () => {
  assert.equal(C.roundTick(21450.13, 0.25), 21450.25);
  assert.equal(C.roundTick(21450.12, 0.25), 21450);
  assert.equal(C.roundTick(68.314999, 0.01), 68.31);
  assert.equal(C.roundTick(1.08503, 0.0001), 1.085);
  assert.equal(C.roundTick(97810.4, 1), 97810);
});
t('merge within one tick keeps the exact one', () => {
  const m = C.mergeLevels([{ price: 21450.1, exact: false, checked: true, label: '' }, { price: 21450.25, exact: true, checked: true, label: '' }, { price: 21500, checked: true, label: 'R' }], 0.25);
  assert.deepEqual(m.map((l) => [l.price, l.exact]), [[21500, undefined], [21450.25, true]]);
});
t('parseNum', () => {
  assert.equal(C.parseNum('21,450.25'), 21450.25); assert.equal(C.parseNum('\u221212.5'), -12.5);
  assert.ok(Number.isNaN(C.parseNum('4.5K'))); assert.ok(Number.isNaN(C.parseNum('')));
});
t('parseOcrNum', () => {
  assert.equal(C.parseOcrNum('21.525.25'), 21525.25); assert.equal(C.parseOcrNum('21,487.50'), 21487.5);
  assert.equal(C.parseOcrNum('6.051.50'), 6051.5); assert.equal(C.parseOcrNum('69.00'), 69); assert.equal(C.parseOcrNum('1.08500'), 1.085);
  assert.equal(C.parseOcrNum('98,200'), 98200); assert.equal(C.parseOcrNum('1,234,567'), 1234567); assert.equal(C.parseOcrNum('21450'), 21450);
  assert.ok(Number.isNaN(C.parseOcrNum('21..5'))); assert.ok(Number.isNaN(C.parseOcrNum('.'))); assert.ok(Number.isNaN(C.parseOcrNum('')));
});
t('rangeMismatch', () => {
  assert.equal(C.rangeMismatch([21450, 21500], 6020), true);      // NQ levels on an ES chart
  assert.equal(C.rangeMismatch([6010, 6031], 6020), false);
  assert.equal(C.rangeMismatch([], 6020), false);
});

// ---------------------------------------------------------------- axis fit
t('linear fit + outlier', () => {
  const f = C.fitAxis([{ y: 100, v: 21500 }, { y: 200, v: 21450 }, { y: 300, v: 21400 }, { y: 400, v: 21350 }, { y: 250, v: 99999 }]);
  assert.equal(f.log, false); assert.equal(f.n, 4);
  assert.ok(Math.abs(f.priceAt(150) - 21475) < 1e-6); assert.ok(Math.abs(f.yAt(21425) - 250) < 1e-6);
});
t('log scale detected', () => {
  const pts = [10, 20, 50, 100, 200, 500].map((v) => ({ v, y: 600 - 120 * Math.log10(v) }));
  const f = C.fitAxis(pts);
  assert.equal(f.log, true);
  assert.ok(Math.abs(f.priceAt(600 - 120 * Math.log10(300)) - 300) < 0.01);
});
t('two labels are enough', () => assert.ok(C.fitAxis([{ y: 50, v: 6050 }, { y: 450, v: 5990 }])));
t('no fit from one label or upside-down', () => {
  assert.equal(C.fitAxis([{ y: 50, v: 6050 }]), null);
  assert.equal(C.fitAxis([{ y: 50, v: 5990 }, { y: 450, v: 6050 }]), null);
});

// ---------------------------------------------------------------- pixels
function canvas(w, h, bg){ const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { d.set(bg, i * 4); d[i * 4 + 3] = 255; } return { width: w, height: h, data: d }; }
function hline(img, y, x0, x1, col, dash, gap){ for (let x = x0; x <= x1; x++) { if (dash && ((x - x0) % (dash + gap)) >= dash) continue; img.data.set(col, (y * img.width + x) * 4); } }
function rect(img, x0, y0, x1, y1, col){ for (let y = y0; y <= y1; y++) hline(img, y, x0, x1, col); }
t('lines: solid, dashed, dotted, 2 px; grid + candles ignored', () => {
  const img = canvas(600, 300, [19, 23, 34]);
  for (let y = 20; y < 300; y += 40) hline(img, y, 0, 499, [42, 46, 57]);                    // faint grid
  hline(img, 50, 0, 499, [41, 98, 255]);                                                         // solid
  hline(img, 120, 0, 499, [242, 54, 69], 6, 4);                                                  // dashed
  hline(img, 200, 0, 499, [255, 152, 0], 2, 2);                                                  // dotted
  hline(img, 250, 0, 499, [156, 39, 176]); hline(img, 251, 0, 499, [156, 39, 176]);              // 2 px
  for (let x = 10; x < 490; x += 24) rect(img, x, 90 + (x % 50), x + 6, 160 + (x % 30), x % 28 ? [38, 166, 154] : [239, 83, 80]);   // candles cross the dashed line
  const ls = C.detectLines(img, { x0: 0, x1: 499, y0: 0, y1: 299 });
  assert.deepEqual(ls.map((l) => [Math.round(l.y * 2) / 2, l.style]), [[50, 'solid'], [120, 'dashed'], [200, 'dotted'], [250.5, 'solid']]);
  assert.equal(ls[0].color, '#2962ff'); assert.equal(ls[3].width, 2);
});
t('light theme lines', () => {
  const img = canvas(500, 200, [255, 255, 255]);
  for (let y = 10; y < 200; y += 30) hline(img, y, 0, 449, [240, 243, 250]);
  hline(img, 77, 0, 449, [8, 153, 129], 5, 3);
  const ls = C.detectLines(img, { x0: 0, x1: 449, y0: 0, y1: 199 });
  assert.equal(ls.length, 1); assert.equal(ls[0].y, 77); assert.equal(ls[0].style, 'dashed');
});
t('axis boxes', () => {
  const img = canvas(600, 300, [19, 23, 34]);
  rect(img, 501, 40, 599, 58, [41, 98, 255]);
  rect(img, 501, 150, 599, 168, [255, 152, 0]);
  for (let x = 520; x < 580; x += 6) rect(img, x, 45, x + 3, 53, [255, 255, 255]);              // the box text
  const b = C.detectBoxes(img, { x0: 480, x1: 599 });
  assert.deepEqual(b.map((x) => [x.y, x.color]), [[49, '#2962ff'], [159, '#ff9800']]);
});
t('axis column from OCR words', () => {
  const words = [{ text: '21,500.00', x0: 1210, x1: 1270, y0: 90, y1: 102 }, { text: '21,450.00', x0: 1210, x1: 1270, y0: 190, y1: 202 },
    { text: '21,400.00', x0: 1210, x1: 1270, y0: 290, y1: 302 }, { text: '09:30', x0: 300, x1: 340, y0: 700, y1: 712 }, { text: '5', x0: 40, x1: 46, y0: 10, y1: 20 }];
  const c = C.findAxisColumn(words, 1280);
  assert.equal(c.points.length, 3);
  const f = C.fitAxis(c.points); assert.ok(Math.abs(f.priceAt(146) - 21475) < 0.01);
});
t('axis: 97.800 misread comma settled as thousands', () => {
  const words = ['98,200', '98,000', '97.800', '97.600'].map((text, i) => ({ text, x0: 1230, x1: 1270, y0: 140 + i * 110, y1: 150 + i * 110 }));
  assert.deepEqual(C.findAxisColumn(words, 1280).points.map((p) => p.v), [98200, 98000, 97800, 97600]);
  const fx = ['1.0850', '151.250', '151.000'].map((text, i) => ({ text, x0: 1230, x1: 1270, y0: 140 + i * 110, y1: 150 + i * 110 }));
  assert.deepEqual(C.findAxisColumn(fx.slice(1), 1280).points.map((p) => p.v), [151250, 151000]);   // all ambiguous, no clue: thousands
  assert.deepEqual(C.findAxisColumn(fx.slice(1), 1280, 151.1).points.map((p) => p.v), [151.25, 151]);   // the open chart settles it
});
t('axis: a label split in two words is joined', () => {
  const words = [{ text: '97,', x0: 1233, x1: 1248, y0: 578, y1: 588 }, { text: '400', x0: 1251, x1: 1270, y0: 577, y1: 587 }, { text: '97,600', x0: 1233, x1: 1270, y0: 469, y1: 479 }, { text: '98,000', x0: 1233, x1: 1270, y0: 249, y1: 259 }];
  assert.deepEqual(C.findAxisColumn(words, 1280).points.map((p) => p.v).sort(), [97400, 97600, 98000]);
});
t('buildLevels: box price wins, labels kept, live box unticked', () => {
  const fit = C.fitAxis([{ y: 100, v: 21500 }, { y: 300, v: 21400 }]);
  const lines = [{ y: 150.4, rgb: [41, 98, 255], color: '#2962ff', style: 'solid', width: 1 }, { y: 260, rgb: [255, 152, 0], color: '#ff9800', style: 'dashed', width: 1 }];
  const boxes = [{ y: 150, rgb: [41, 98, 255], color: '#2962ff' }, { y: 200, rgb: [38, 166, 154], color: '#26a69a' }];
  const boxText = new Map([[boxes[0], 21474.75], [boxes[1], 21450.5]]);
  const words = [{ text: 'PDH', x0: 8, x1: 40, y0: 240, y1: 254 }];
  const L = C.buildLevels({ lines, boxes, fit, boxText, words, tick: 0.25 });
  assert.deepEqual(L.map((l) => [l.price, l.source, l.label, l.checked]), [[21474.75, 'box', '', true], [21450.5, 'box', '', false], [21420, 'line', 'PDH', true]]);
});

console.log('levels-import: ' + n + ' tests passed');
