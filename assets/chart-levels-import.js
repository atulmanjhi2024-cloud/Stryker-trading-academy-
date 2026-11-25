// TradeZoro — Charts "Import levels" (ES module, charts.html; loaded only when a member opens it)
// Owner order 2026-11-22: a member asked how to bring the horizontal levels he keeps on another chart
// into ZoroCharts in one go. "you will be able to screenshot your chart and add those levels".
//
// WHAT IT DOES
//   1. From a screenshot: drop / paste (Ctrl+V) / pick an image of a chart. Everything runs on the
//      device: the price axis is read with OCR (self-hosted tesseract, assets/vendor/tesseract-7.0.0,
//      loaded only here), y -> price is fitted from the labels (linear; a log scale is detected and
//      flagged), horizontal lines are found by pixel analysis and coloured price boxes on the axis are
//      read directly (exact). Lines are rounded to the open chart's tick, merged, and keep their colour,
//      style and any text label beside them. The image is never uploaded.
//   2. From text: a list ("21450, 21500.25", one per line, "21450 PDH") or a Pine script with
//      hline(...) / line.new(...) -> the same review sheet.
//   3. Review sheet: the screenshot with the detected lines drawn over it, a list (tick box, colour,
//      price, label), edit / delete / add, then "Add N levels to chart". Nothing touches the chart
//      until that button. The levels become ordinary horizontal-line drawings (editable, saved with the
//      layout), one undo step, grouped in the object tree as "Imported levels <date>".
// Entry points: right-click on the chart, the left drawing column and the phone
// drawings sheet (all through window.__stkImportLevels, set up in assets/vela-chart.js).
// The maths lives in assets/chart-levels-core.js (node tests: tools/tests/levels-import.test.mjs).
// Education only. Not financial advice.

import * as Core from './chart-levels-core.js?v=1298';

const VENDOR = new URL('./vendor/tesseract-7.0.0/', import.meta.url).href;
const MAX_W = 2600;           // larger screenshots are scaled down first (speed; lines stay > 1 px)
const GROUP_KEY = 'stryker.levelgroups';

// ------------------------------------------------------------------ OCR (lazy)
let tessP = null, workerP = null;
function tess(){
  if (!tessP) tessP = import('./vendor/tesseract-7.0.0/tesseract.esm.min.js?v=1298').then((m) => m.default || m);
  return tessP;
}
function ocrWorker(onProgress){
  if (!workerP) {
    workerP = tess().then((T) => T.createWorker('eng', 1, {
      workerPath: VENDOR + 'worker.min.js',
      corePath: VENDOR + 'core',
      langPath: VENDOR + 'lang',
      workerBlobURL: false,
      logger: (m) => { try { if (onProgress && m && m.status && /load|initiali/.test(m.status)) onProgress('Getting the reader ready', m.progress || 0); } catch (e) {} }
    }));
    workerP.catch(() => { workerP = null; });
  }
  return workerP;
}
export async function closeOcr(){
  const p = workerP; workerP = null;
  if (p) try { (await p).terminate(); } catch (e) {}
}
// Text blobs in a region: ink pixels joined across small gaps, kept when text-sized.
// -> [{ x0, y0, x1, y1 }] in image coordinates
function textBlobs(img, r, inkOf, mask, gapX){
  const w = r.x1 - r.x0 + 1, hgt = r.y1 - r.y0 + 1, gx = gapX || 4;
  const ink = new Uint8Array(w * hgt);
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
    const sx = r.x0 + x, sy = r.y0 + y, i = (sy * img.width + sx) * 4;
    if (mask && mask(sx, sy)) continue;
    if (inkOf([img.data[i], img.data[i + 1], img.data[i + 2]])) ink[y * w + x] = 1;
  }
  // drop long straight strokes (level lines, grid, the axis border, tick marks joined to them): not text
  const runCut = (len, at, step, n) => { for (let k = 0, st = -1; k <= n; k++) { const on = k < n && ink[at + k * step]; if (on && st < 0) st = k; if (!on && st >= 0) { if (k - st >= len) for (let q = st; q < k; q++) ink[at + q * step] = 2; st = -1; } } };
  for (let y = 0; y < hgt; y++) runCut(48, y * w, 1, w);
  for (let x = 0; x < w; x++) runCut(40, x, w, hgt);
  for (let p = 0; p < ink.length; p++) if (ink[p] === 2) ink[p] = 0;
  // horizontal closing: fill gaps up to gx between ink pixels in a row
  const m = new Uint8Array(ink);
  for (let y = 0; y < hgt; y++) { let last = -99; for (let x = 0; x < w; x++) if (ink[y * w + x]) { if (x - last > 1 && x - last <= gx) for (let k = last + 1; k < x; k++) m[y * w + k] = 1; last = x; } }
  const lab = new Int32Array(w * hgt), out = [], stack = [];
  let id = 0;
  for (let p0 = 0; p0 < m.length; p0++) {
    if (!m[p0] || lab[p0]) continue;
    id++; lab[p0] = id; stack.push(p0);
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p / w) | 0; n += ink[p];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && m[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack.push(p - 1); }
      if (x < w - 1 && m[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack.push(p + 1); }
      if (y > 0 && m[p - w] && !lab[p - w]) { lab[p - w] = id; stack.push(p - w); }
      if (y < hgt - 1 && m[p + w] && !lab[p + w]) { lab[p + w] = id; stack.push(p + w); }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    // text: not a solid block (candle bodies, boxes), not a thin stroke
    if (bh >= 6 && bh <= 36 && bw >= 5 && bw <= 420 && n / (bw * bh) <= 0.72) out.push({ x0: r.x0 + x0, y0: r.y0 + y0, x1: r.x0 + x1, y1: r.y0 + y1 });
  }
  return out;
}
// OCR small text pieces one by one (PSM 7, one line each), each scaled to ~40 px tall and
// binarised with its own ink test. -> the pieces' boxes with { text, conf }
async function ocrBlobsEach(img, pieces, whitelist){
  if (!pieces.length) return [];
  const w = await ocrWorker();
  await w.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: whitelist || '', preserve_interword_spaces: '1' });
  const out = [];
  for (const p of pieces) {
    const b = p.blob, bh = b.y1 - b.y0 + 1, sc = Math.max(2, Math.min(6, 40 / bh));
    // binary at source size, then scaled up smoothly (blocky pixels read worse)
    const piece = binCrop(img, b.x0 - 1, b.y0 - 1, b.x1 - b.x0 + 3, bh + 2, 1, p.ink, p.mask);
    const pw = Math.round(piece.width * sc), ph = Math.round(piece.height * sc);
    const pad = 16, c = toCanvas(pw + pad * 2, ph + pad * 2), g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(piece, pad, pad, pw, ph);
    const r = await w.recognize(c, {}, { blocks: true, text: true });
    const ws = [];
    for (const bk of (r.data && r.data.blocks) || []) for (const pa of bk.paragraphs || []) for (const l of pa.lines || []) for (const wd of l.words || []) ws.push(wd);
    ws.sort((a, q) => a.bbox.x0 - q.bbox.x0);
    out.push(Object.assign({}, b, { text: ws.map((x) => x.text).join(' ').trim(), conf: ws.length ? Math.min(...ws.map((x) => x.confidence)) : 0 }));
  }
  return out;
}

// ------------------------------------------------------------------ image helpers
function toCanvas(w, h){ const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
export async function loadImage(src){
  let bmp;
  if (src instanceof ImageData) { const c = toCanvas(src.width, src.height); c.getContext('2d').putImageData(src, 0, 0); return c; }
  if (typeof src === 'string') { const r = await fetch(src); src = await r.blob(); }
  bmp = await createImageBitmap(src);
  const s = bmp.width > MAX_W ? MAX_W / bmp.width : 1;
  const c = toCanvas(bmp.width * s, bmp.height * s);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = s < 1;
  g.drawImage(bmp, 0, 0, c.width, c.height);
  try { bmp.close(); } catch (e) {}
  return c;
}
// A crop of the image turned into black text on white, scaled up for the reader.
//   inkOf(rgb) -> true where the pixel is text; mask(x, y) -> true to blank a pixel out
function binCrop(img, x0, y0, w, h, scale, inkOf, mask){
  const c = toCanvas(Math.round(w * scale), Math.round(h * scale)), g = c.getContext('2d');
  const out = g.createImageData(c.width, c.height), d = out.data, s = img.data;
  for (let y = 0; y < c.height; y++) {
    const sy = Math.max(0, Math.min(img.height - 1, y0 + Math.floor(y / scale)));
    for (let x = 0; x < c.width; x++) {
      const sx = Math.max(0, Math.min(img.width - 1, x0 + Math.floor(x / scale)));
      const i = (sy * img.width + sx) * 4;
      const ink = !(mask && mask(sx, sy)) && inkOf([s[i], s[i + 1], s[i + 2]]);
      const o = (y * c.width + x) * 4, v = ink ? 0 : 255;
      d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  return c;
}

// Colours that cover most of the plot after the background: the candles.
function candleColours(img, area, bg){
  const counts = new Map(), sums = new Map();
  const step = Math.max(1, Math.floor((area.x1 - area.x0) / 300));
  for (let y = area.y0; y <= area.y1; y += 2) for (let x = area.x0; x <= area.x1; x += step) {
    const i = (y * img.width + x) * 4, c = [img.data[i], img.data[i + 1], img.data[i + 2]];
    if (Core.cdist(c, bg) <= 40) continue;
    const b = ((c[0] >> 5) << 6) | ((c[1] >> 5) << 3) | (c[2] >> 5);
    counts.set(b, (counts.get(b) || 0) + 1);
    const t = sums.get(b) || [0, 0, 0]; t[0] += c[0]; t[1] += c[1]; t[2] += c[2]; sums.set(b, t);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([b, n]) => sums.get(b).map((v) => v / n));
}

// ------------------------------------------------------------------ the screenshot pipeline
// src: Blob / File / ImageData / URL. opts: { tick, ref (open chart's last price), onProgress(text, 0..1) }
// -> { canvas, levels, fit, lines, boxes, warnings[], axisFound }
export async function analyzeImage(src, opts){
  const o = opts || {};
  const prog = (t, p) => { try { o.onProgress && o.onProgress(t, p); } catch (e) {} };
  prog('Opening the picture', 0.02);
  const canvas = await loadImage(src);
  const W = canvas.width, H = canvas.height;
  const img = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H);
  const bg = Core.backgroundOf(img);
  const warnings = [];

  // 1. coloured price boxes in the right part of the picture
  const sx0 = Math.max(0, W - Math.max(120, Math.min(Math.round(W * 0.3), 300)));
  const boxes = Core.detectBoxes(img, { x0: sx0, x1: W - 1 }, bg);
  const inBox = (x, y) => boxes.some((b) => x >= b.x0 - 1 && x <= b.x1 + 1 && y >= b.y0 - 1 && y <= b.y1 + 1);

  // 2. the price-axis numbers (boxes blanked out), read with OCR
  prog('Getting the reader ready', 0.08);
  await ocrWorker(prog);
  prog('Reading the price axis', 0.35);
  const ink = (c) => Core.cdist(c, bg) > 60;
  const axisBlobs = textBlobs(img, { x0: sx0, x1: W - 1, y0: 0, y1: H - 1 }, ink, inBox, 5);
  const axisWords = await ocrBlobsEach(img, axisBlobs.map((b) => ({ blob: b, ink, mask: inBox })), '0123456789.,-');
  const col = Core.findAxisColumn(axisWords.filter((w) => w.conf >= 40), W, o.ref);

  // 3. each box's own text (exact prices)
  prog('Reading the price labels', 0.55);
  const boxText = new Map();
  let boxRaw = [];
  if (boxes.length) {
    const read = [];
    for (const b of boxes) {
      const notBox = (p) => Core.cdist(p, b.rgb) > 70;
      const inner = { x0: b.x0 + 1, x1: b.x1 - 1, y0: b.y0, y1: b.y1 };
      const bl = textBlobs(img, inner, notBox, null, 5).filter((x) => x.y1 - x.y0 >= 6);
      if (!bl.length) continue;
      const u = { x0: Math.min(...bl.map((x) => x.x0)), x1: Math.max(...bl.map((x) => x.x1)), y0: Math.min(...bl.map((x) => x.y0)), y1: Math.max(...bl.map((x) => x.y1)) };
      read.push({ b, u, ink: notBox });
    }
    // each box has its own text colour: one sheet, each piece binarised against its own box
    const words = await ocrBlobsEach(img, read.map((r) => ({ blob: r.u, ink: r.ink })), '0123456789.,-');
    boxRaw = words.map((w) => [w.text, Math.round(w.conf), w.x0, w.x1, w.y0, w.y1]);
    words.forEach((w, k) => { const v = Core.parseOcrNum(String(w.text).replace(/\s+/g, '')); if (Number.isFinite(v) && w.conf >= 30) boxText.set(read[k].b, v); });
  }

  // 4. y -> price
  const pts = (col ? col.points : []).concat([...boxText.entries()].map(([b, v]) => ({ y: b.y, v })));
  const fit = Core.fitAxis(pts);
  if (!fit) warnings.push({ id: 'noaxis', text: 'We could not read the price axis. Keep the prices on the right edge in the picture, or type the prices below.' });
  else if (fit.log) warnings.push({ id: 'log', text: 'This chart looks like it uses a log price scale. The prices were read on that scale; check them before adding.' });

  // 5. horizontal lines in the plot (left of the axis)
  prog('Finding the lines', 0.7);
  const axisLeft = Math.min(col ? col.x0 : W, boxes.length ? Math.min(...boxes.map((b) => b.x0)) : W);
  const plotRight = Math.max(Math.round(W * 0.4), Math.round((axisLeft < W ? axisLeft : W * 0.9) - 4));
  const area = { x0: 0, x1: plotRight, y0: 0, y1: H - 1 };
  let lines = Core.detectLines(img, area, bg);
  // lines outside the price range the axis covers (title bars, panel edges) are dropped
  if (fit && fit.labels.length >= 2) {
    const ys = fit.labels.map((p) => p.y), lo = Math.min(...ys), hi = Math.max(...ys), pad = Math.max(60, (hi - lo) * 0.6);
    lines = lines.filter((l) => l.y >= lo - pad && l.y <= hi + pad);
  }
  const candles = candleColours(img, area, bg);

  // 6. text beside each line (one small band per line)
  prog('Reading the line labels', 0.8);
  const words = [];
  if (lines.length) {
    const pieces = [];
    for (const l of lines.slice(0, 40)) {
      // text in the line's colour, anti-aliased edges included (nearer the line colour than the background)
      const near = (c) => Core.cdist(c, l.rgb) < Core.cdist(c, bg) * 0.8;
      const onLine = (x, y) => Math.abs(y - l.y) <= l.width / 2 + 1;
      const r = { x0: 0, x1: plotRight, y0: Math.max(0, Math.round(l.y - 24)), y1: Math.min(H - 1, Math.round(l.y + 22)) };
      for (const b of textBlobs(img, r, near, onLine, 6)) if (b.y1 - b.y0 <= 26 && (b.y1 < l.y - 1 || b.y0 > l.y + 1)) pieces.push({ blob: b, ink: near, mask: onLine });
    }
    // a high bar: candles near a line in its colour read as junk words; a missed label is typed in the sheet
    for (const w of await ocrBlobsEach(img, pieces.slice(0, 80), '')) if (w.conf >= 72 && w.text && w.text.replace(/[^\w.]/g, '').length >= 2) words.push(w);
  }

  // 7. levels
  const levels = Core.buildLevels({ lines, boxes, fit, boxText, words, tick: o.tick });
  for (const lv of levels) {
    // the live-price line usually takes the candles' colour: offered, not ticked
    if (lv.boxOnly) continue;
    const l = lines.find((x) => Math.abs(x.y - lv.y) < 1);
    if (l && l.style === 'dotted' && candles.some((k) => Core.cdist(k, l.rgb) <= 30)) { lv.checked = false; lv.hint = 'May be the live price line'; }
  }
  if (!fit) for (const l of lines) levels.push({ y: l.y, price: NaN, exact: false, source: 'line', color: l.color, style: l.style, width: l.width, label: '', checked: false, approx: 0 });
  levels.sort((a, b) => a.y - b.y);
  if (fit && Number.isFinite(o.ref) && Core.rangeMismatch(levels.filter((l) => l.checked).map((l) => l.price), o.ref)) {
    warnings.push({ id: 'range', text: 'These prices are far from ' + (o.symbol || 'this chart') + ' (' + fmtPrice(o.ref, o.tick) + '). The screenshot may be of another market.' });
  }
  if (fit && !lines.length) warnings.push({ id: 'nolines', text: 'No horizontal lines found. Crop to the chart and keep the lines visible, or type the prices below.' });
  prog('Done', 1);
  return { canvas, width: W, height: H, levels, fit, lines, boxes, warnings, axisFound: !!fit, axisWords: col ? col.points.length : 0,
    debug: { axis: axisWords.map((w) => [w.text, Math.round(w.conf), w.x0, Math.round((w.y0 + w.y1) / 2)]), boxes: boxes.map((b) => [b.y, boxText.get(b)]), boxRaw, words: words.map((w) => [w.text, Math.round(w.conf)]) } };
}

// ------------------------------------------------------------------ formatting
function fmtPrice(p, tick){
  if (!Number.isFinite(p)) return '';
  const d = tick > 0 ? Core.decimalsOf(tick) : (Math.abs(p) >= 100 ? 2 : 4);
  return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false });
}
const today = () => { const d = new Date(); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };

// ------------------------------------------------------------------ the chart side
function chartCtx(ws){
  try {
    const cell = ws.cell(ws.active.id) || ws.active, ch = cell.chart, R = ch.renderer.renderer;
    const bars = R.bars || [];
    const last = bars.length ? bars[bars.length - 1] : null;
    const m = R.scene && R.scene.priceMintick;
    const ref = last ? last.close : NaN;
    const tick = typeof m === 'number' && m > 0 ? m : (Math.abs(ref) >= 1 ? 0.01 : 0.0001);
    return { cell, ch, tick, ref, time: last ? last.time : Date.now(), symbol: String(cell.symbol || '').replace(/^[a-z0-9_-]+:/i, '') };
  } catch (e) { return null; }
}
// Adds the levels as horizontal-line drawings: one undo step, the member's own line defaults kept,
// grouped as "Imported levels <date>" in the object tree.
export function addLevels(ws, levels){
  const c = chartCtx(ws); if (!c) return 0;
  const d = c.ch.drawings; if (!d || d.supported === false) return 0;
  const ctl = d.ctrl, hist = ctl && ctl.history;
  let defaults = null; try { defaults = d.toolDefaults(); } catch (e) {}
  const ids = [];
  // the cell's undo stack records one step per drawing:created; mute it and push ONE step, or the
  // 2nd..Nth Ctrl+Z would each undo an older drawing of the member's (the core groups the batch itself)
  const wh = c.cell && c.cell.history && typeof c.cell.history.silently === 'function' ? c.cell.history : null;
  try { if (hist) hist.begin(ctl.store.serialize()); } catch (e) {}
  const run = () => {
    for (const l of levels) {
      const style = { lineColor: l.color || '#2962ff', lineWidth: Math.max(1, Math.min(4, l.width || 1)), lineStyle: l.style === 'dotted' ? 'dotted' : l.style === 'dashed' ? 'dashed' : 'solid' };
      const init = { anchors: [{ time: c.time, price: Core.roundTick(l.price, c.tick) }], style };
      if (l.label) init.text = { value: l.label, size: 'normal', hAlign: 'left', vAlign: 'top', color: style.lineColor };
      const x = d.add('hline', init);
      if (x && x.id) ids.push(x.id);
    }
  };
  try { if (wh) wh.silently(run); else run(); } finally {
    try { if (hist) hist.commit(); } catch (e) {}
    try { if (defaults) d.setToolDefaults(defaults); } catch (e) {}
  }
  if (ids.length && wh) try { wh.pushDrawingStep(); } catch (e) {}
  if (ids.length) addGroup(ws, c.ch, { id: 'imp-' + Date.now().toString(36), name: 'Imported levels ' + today(), ids });
  try { ws.markStateDirty(); } catch (e) {}
  return ids.length;
}
// Object-tree groups belong to Vela's panel (kept per chart, not saved). Ours are saved with the
// layout through a cell state handler and put back into the panel on load.
const saved = new WeakMap();      // chart -> [{ id, name, ids }]
function tree(ws){ try { return ws.objectTree && ws.objectTree.groupsPerChart ? ws.objectTree : null; } catch (e) { return null; } }
function addGroup(ws, chart, g){
  saved.set(chart, (saved.get(chart) || []).concat([g]));
  const t = tree(ws); if (!t) return;
  const cur = t.groupsPerChart.get(chart) || [];
  const taken = new Set(cur.flatMap((x) => x.ids));
  const ids = g.ids.filter((id) => !taken.has(id));
  if (ids.length) t.groupsPerChart.set(chart, cur.concat([{ id: g.id, name: g.name, ids }]));
  try { t.refresh(); } catch (e) {}
}
function liveGroups(ws, chart){
  const t = tree(ws), mine = saved.get(chart) || [];
  const inTree = t && t.groupsPerChart.has(chart) ? t.groupsPerChart.get(chart).filter((g) => /^imp-/.test(g.id)) : null;
  if (!inTree) return mine;
  // the panel is the truth for groups it knows (renamed, emptied, dissolved); groups whose drawings
  // are put away (another symbol, "Keep drawings on their own symbol") are kept as saved
  let live = new Set(); try { live = new Set(chart.drawings.all().map((x) => x.id)); } catch (e) {}
  const away = mine.filter((g) => !g.ids.some((id) => live.has(id)) && !inTree.some((x) => x.id === g.id));
  return inTree.map((g) => ({ id: g.id, name: g.name, ids: [...g.ids] })).concat(away).slice(-50);
}
export function installLevelsImport(CoreSdk, getWs){
  try {
    CoreSdk.registerWidgetAction && CoreSdk.registerWidgetAction({ id: 'stryker.import-levels', target: 'context:body', order: 850, label: 'Import levels\u2026',
      run: () => { const ws = getWs(); if (ws) openImport(ws); } });
  } catch (e) { console.warn('TradeZoro: import levels action', e); }
  try {
    CoreSdk.registerStatePersistence({
      key: GROUP_KEY, scope: 'cell',
      serialize(ctx){ const ws = getWs(); const g = ws && ctx.chart ? liveGroups(ws, ctx.chart) : []; return g.length ? g : undefined; },
      restore(payload, ctx){
        if (!Array.isArray(payload) || !ctx.chart) return;
        const clean = payload.slice(-50).filter((g) => g && typeof g.id === 'string' && /^imp-[\w-]{1,24}$/.test(g.id) && Array.isArray(g.ids))
          .map((g) => ({ id: g.id, name: String(g.name || 'Imported levels').slice(0, 60), ids: g.ids.filter((x) => typeof x === 'string' && x.length < 40).slice(0, 400) }));
        saved.set(ctx.chart, clean);
        const ws = getWs(), t = ws && tree(ws);
        if (!t) return;
        let live = new Set(); try { live = new Set(ctx.chart.drawings.all().map((x) => x.id)); } catch (e) {}
        const other = (t.groupsPerChart.get(ctx.chart) || []).filter((g) => !/^imp-/.test(g.id));
        const mine = clean.map((g) => ({ id: g.id, name: g.name, ids: g.ids.filter((id) => live.has(id)) })).filter((g) => g.ids.length);
        t.groupsPerChart.set(ctx.chart, other.concat(mine));
        try { t.refresh(); } catch (e) {}
      }
    });
  } catch (e) { console.warn('TradeZoro: import levels state', e); }
}

// ------------------------------------------------------------------ the sheet
const CSS = `
.stkli-scrim{ position:fixed; inset:0; z-index:2147483000; background:rgba(0,0,0,.56); display:flex; align-items:center; justify-content:center; padding:24px; }
.stkli{ --li-bg:#131316; --li-raised:#1e1e22; --li-line:rgba(255,255,255,.08); --li-line2:rgba(255,255,255,.16); --li-ink:rgba(255,255,255,.92); --li-ink2:rgba(255,255,255,.64); --li-ink3:rgba(255,255,255,.44); --li-mint:#03c988; --li-on:#04140d; --li-warn:#f5a524;
  position:relative; display:flex; flex-direction:column; width:min(1040px, 100%); max-height:min(760px, calc(100vh - 48px)); background:var(--li-bg); color:var(--li-ink); border:1px solid var(--li-line); border-radius:16px; box-shadow:0 24px 64px rgba(0,0,0,.5);
  font:400 14px/20px var(--font-body, Archivo, system-ui, sans-serif); overflow:hidden; }
:root[data-theme="light"] .stkli{ --li-bg:#ffffff; --li-raised:#f5f5f7; --li-line:rgba(0,0,0,.08); --li-line2:rgba(0,0,0,.16); --li-ink:#1d1d1f; --li-ink2:rgba(29,29,31,.68); --li-ink3:rgba(29,29,31,.5); --li-mint:#07996a; --li-on:#ffffff; --li-warn:#8a5a00; }
:root[data-theme="light"] .stkli-scrim{ background:rgba(20,24,32,.32); }
.stkli *{ box-sizing:border-box; }
.stkli-head{ display:flex; align-items:center; gap:12px; height:64px; padding:0 16px 0 24px; border-bottom:1px solid var(--li-line); flex:none; }
.stkli-grab{ display:none; }
.stkli-title{ margin:0; flex:1; min-width:0; font:600 17px/22px var(--font-body, Archivo, system-ui, sans-serif); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.stkli-seg{ display:inline-flex; padding:2px; border-radius:10px; background:var(--li-raised); border:1px solid var(--li-line); flex:none; }
.stkli-seg button{ height:32px; min-width:104px; padding:0 12px; border:0; border-radius:8px; background:none; color:var(--li-ink2); font:500 13px/18px var(--font-body, Archivo, system-ui, sans-serif); cursor:pointer; display:inline-flex; align-items:center; justify-content:center; }
.stkli-seg button[aria-selected="true"]{ background:var(--li-bg); color:var(--li-ink); box-shadow:0 1px 2px rgba(0,0,0,.24); }
.stkli-x{ width:40px; height:40px; flex:none; border:0; border-radius:20px; background:none; color:var(--li-ink2); cursor:pointer; display:inline-flex; align-items:center; justify-content:center; }
.stkli-x:hover{ background:var(--li-raised); color:var(--li-ink); }
.stkli-body{ flex:1; min-height:0; display:flex; overflow:hidden; }
.stkli-pane{ flex:1; min-width:0; min-height:0; overflow:auto; padding:24px; }
.stkli-drop{ display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; min-height:300px; height:100%; padding:32px 24px; border:1.5px dashed var(--li-line2); border-radius:16px; text-align:center; cursor:pointer; transition:border-color .15s cubic-bezier(.2,0,0,1), background .15s cubic-bezier(.2,0,0,1); }
.stkli-drop:hover,.stkli-drop.over{ border-color:var(--li-mint); background:color-mix(in srgb, var(--li-mint) 6%, transparent); }
.stkli-drop-ic{ width:48px; height:48px; border-radius:12px; background:var(--li-raised); color:var(--li-mint); display:flex; align-items:center; justify-content:center; }
.stkli-drop h3{ margin:4px 0 0; font:600 17px/22px var(--font-body, Archivo, system-ui, sans-serif); }
.stkli-drop p{ margin:0; max-width:440px; color:var(--li-ink2); }
.stkli-tips{ margin:8px 0 0; padding:0; list-style:none; display:flex; flex-wrap:wrap; justify-content:center; gap:8px; }
.stkli-tips li{ height:28px; padding:0 12px; border-radius:14px; background:var(--li-raised); color:var(--li-ink2); font:400 12px/28px var(--font-body, Archivo, system-ui, sans-serif); white-space:nowrap; }
.stkli-btn{ height:40px; padding:0 16px; border-radius:12px; border:1px solid var(--li-line2); background:none; color:var(--li-ink); font:500 14px/20px var(--font-body, Archivo, system-ui, sans-serif); cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:8px; white-space:nowrap; }
.stkli-btn:hover{ background:var(--li-raised); }
.stkli-btn.pri{ height:48px; padding:0 24px; border-color:var(--li-mint); background:var(--li-mint); color:var(--li-on); font-weight:600; }
.stkli-btn.pri:hover{ filter:brightness(1.08); }
.stkli-btn[disabled]{ opacity:.44; cursor:default; filter:none; }
.stkli-btn:focus-visible,.stkli-x:focus-visible,.stkli-seg button:focus-visible,.stkli-drop:focus-visible,.stkli-row input:focus-visible,.stkli-del:focus-visible,.stkli-ck:focus-visible{ outline:2px solid var(--li-mint); outline-offset:2px; }
.stkli-ta{ display:block; width:100%; min-height:240px; height:calc(100% - 64px); padding:12px 16px; border-radius:12px; border:1px solid var(--li-line2); background:var(--li-raised); color:var(--li-ink); font:400 14px/20px var(--font-code, ui-monospace, SFMono-Regular, Menlo, monospace); resize:none; }
.stkli-ta:focus{ outline:2px solid var(--li-mint); outline-offset:1px; }
.stkli-ta-row{ display:flex; align-items:center; gap:12px; margin-top:16px; }
.stkli-hint{ flex:1; min-width:0; margin:0; color:var(--li-ink2); font:400 12px/16px var(--font-body, Archivo, system-ui, sans-serif); }
.stkli-work{ display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; min-height:300px; height:100%; }
.stkli-bar{ width:min(320px, 80%); height:4px; border-radius:2px; background:var(--li-raised); overflow:hidden; }
.stkli-bar i{ display:block; height:100%; width:0; background:var(--li-mint); transition:width .2s cubic-bezier(.2,0,0,1); }
.stkli-work p{ margin:0; color:var(--li-ink2); }
.stkli-rev{ display:grid; grid-template-columns:minmax(0, 1fr) 380px; gap:24px; height:100%; min-height:0; }
.stkli-prev{ position:relative; align-self:start; border-radius:12px; overflow:hidden; border:1px solid var(--li-line); background:var(--li-raised); }
.stkli-prev img{ display:block; width:100%; height:auto; }
.stkli-prev svg{ position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
.stkli-side{ display:flex; flex-direction:column; min-height:0; }
.stkli-warn{ display:flex; gap:8px; align-items:flex-start; margin:0 0 12px; color:var(--li-warn); font:400 12px/16px var(--font-body, Archivo, system-ui, sans-serif); }
.stkli-warn svg{ flex:none; margin-top:0; }
.stkli-lh{ display:grid; grid-template-columns:24px 12px minmax(0,1fr) minmax(0,1fr) 32px; align-items:center; gap:8px; height:32px; padding:0 4px 0 8px; color:var(--li-ink3); font:500 11px/13px var(--font-body, Archivo, system-ui, sans-serif); text-transform:none; }
.stkli-lh .r{ text-align:right; padding-right:12px; }
.stkli-list{ flex:1; min-height:0; overflow:auto; margin:0; padding:0; list-style:none; border-top:1px solid var(--li-line); }
.stkli-row{ display:grid; grid-template-columns:24px 12px minmax(0,1fr) minmax(0,1fr) 32px; align-items:center; gap:8px; min-height:52px; padding:0 4px 0 8px; border-bottom:1px solid var(--li-line); }
.stkli-row.off .stkli-p,.stkli-row.off .stkli-l{ color:var(--li-ink3); }
.stkli-row.hl{ background:color-mix(in srgb, var(--li-mint) 8%, transparent); }
.stkli-ck{ width:20px; height:20px; margin:0; accent-color:var(--li-mint); cursor:pointer; }
.stkli-sw{ width:12px; height:12px; border-radius:3px; }
.stkli-row input[type="text"]{ width:100%; height:36px; padding:0 12px; border-radius:8px; border:1px solid transparent; background:var(--li-raised); color:var(--li-ink); font:400 14px/20px var(--font-body, Archivo, system-ui, sans-serif); }
.stkli-row input[type="text"]:hover{ border-color:var(--li-line2); }
.stkli-row input.stkli-p{ text-align:right; font-variant-numeric:tabular-nums; font-family:var(--font-mono, var(--font-body, Archivo, system-ui, sans-serif)); }
.stkli-p.bad{ border-color:#e5484d !important; }
.stkli-del{ width:32px; height:32px; border:0; border-radius:8px; background:none; color:var(--li-ink3); cursor:pointer; display:inline-flex; align-items:center; justify-content:center; }
.stkli-del:hover{ color:var(--li-ink); background:var(--li-raised); }
.stkli-src{ grid-column:3 / 5; margin:-8px 0 8px; color:var(--li-ink3); font:400 11px/13px var(--font-body, Archivo, system-ui, sans-serif); }
.stkli-addrow{ align-self:flex-start; margin-top:12px; }
.stkli-foot{ display:flex; align-items:center; gap:12px; padding:16px 24px; border-top:1px solid var(--li-line); flex:none; }
.stkli-foot .stkli-hint{ font-size:12px; }
.stkli-foot[hidden]{ display:none; }
.stkli-list::-webkit-scrollbar,.stkli-pane::-webkit-scrollbar,.stkli-ta::-webkit-scrollbar{ width:8px; height:8px; }
.stkli-list::-webkit-scrollbar-thumb,.stkli-pane::-webkit-scrollbar-thumb,.stkli-ta::-webkit-scrollbar-thumb{ background:var(--li-line2); border-radius:4px; }
.stkli-list::-webkit-scrollbar-track,.stkli-pane::-webkit-scrollbar-track,.stkli-ta::-webkit-scrollbar-track{ background:transparent; }
@media (max-width:760px){
  .stkli-scrim{ align-items:flex-end; padding:0; }
  .stkli{ width:100%; max-height:calc(100% - 24px); height:calc(100% - 24px); border-radius:24px 24px 0 0; border-bottom:0; }
  .stkli-grab{ display:block; position:absolute; top:6px; left:50%; width:36px; height:5px; margin-left:-18px; border-radius:3px; background:var(--li-line2); }
  .stkli-head{ height:auto; flex-wrap:wrap; gap:12px; padding:20px 16px 12px; }
  .stkli-title{ flex:1; }
  .stkli-seg{ order:3; width:100%; }
  .stkli-seg button{ flex:1; min-width:0; height:36px; }
  .stkli-x{ background:var(--li-raised); width:32px; height:32px; border-radius:16px; }
  .stkli-pane{ padding:16px; }
  .stkli-drop{ min-height:220px; padding:24px 16px; }
  .stkli-rev{ display:flex; flex-direction:column; gap:16px; height:auto; }
  .stkli-prev{ max-height:32vh; overflow:auto; align-self:stretch; }
  .stkli-list{ overflow:visible; }
  .stkli-ta{ height:calc(100% - 72px); font-size:16px; line-height:22px; }
  .stkli-row input[type="text"]{ font-size:16px; height:40px; }
  .stkli-ta-row{ flex-direction:column; align-items:stretch; }
  .stkli-ta-row .stkli-btn{ height:44px; }
  .stkli-foot{ padding:12px 16px calc(12px + env(safe-area-inset-bottom)); }
  .stkli-foot .stkli-hint{ display:none; }
  .stkli-foot .stkli-btn{ height:48px; }
  .stkli-foot .stkli-btn.pri{ flex:1; padding:0 16px; }
}
@media (prefers-reduced-motion:reduce){ .stkli-drop,.stkli-bar i{ transition:none; } }
`;
const IC = {
  x: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  del: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>',
  img: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 14h10M7 17h6"/></svg>',
  warn: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18h.01"/></svg>',
  plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
};
const h = (tag, attrs, html) => { const e = document.createElement(tag); if (attrs) for (const k of Object.keys(attrs)) { if (k === 'class') e.className = attrs[k]; else if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); } if (html != null) e.innerHTML = html; return e; };

let open = null;     // the one open sheet

export function openImport(ws, opts){
  if (open) { open.focus(); return open; }
  const o = opts || {};
  if (!document.getElementById('stkli-css')) { const st = document.createElement('style'); st.id = 'stkli-css'; st.textContent = CSS; document.head.appendChild(st); }
  const toast = o.toast || ((m, t) => { try { window.showToast && window.showToast(t || 'success', m); } catch (e) {} });
  const cx = chartCtx(ws) || { tick: 0.01, ref: NaN, symbol: '' };
  const st = { tab: o.tab || 'image', phase: 'start', levels: [], warnings: [], img: null, size: null, hl: -1, runId: 0 };

  const scrim = h('div', { class: 'stkli-scrim' });
  const box = h('div', { class: 'stkli', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'stkli-title' });
  box.innerHTML = `<span class="stkli-grab" aria-hidden="true"></span>
    <div class="stkli-head"><h2 class="stkli-title" id="stkli-title">Import levels</h2>
      <div class="stkli-seg" role="tablist" aria-label="Import from"><button type="button" role="tab" data-tab="image">Screenshot</button><button type="button" role="tab" data-tab="text">Text or Pine</button></div>
      <button type="button" class="stkli-x" aria-label="Close">${IC.x}</button></div>
    <div class="stkli-body"><div class="stkli-pane"></div></div>
    <div class="stkli-foot" hidden><p class="stkli-hint"></p><button type="button" class="stkli-btn stkli-again">Start over</button><button type="button" class="stkli-btn pri stkli-add">Add levels</button></div>`;
  scrim.appendChild(box);
  const pane = box.querySelector('.stkli-pane'), foot = box.querySelector('.stkli-foot'), addBtn = box.querySelector('.stkli-add'), footHint = foot.querySelector('.stkli-hint');
  const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: '' });
  box.appendChild(fileIn);

  function close(){
    if (!open) return;
    open = null; st.runId++;
    scrim.remove();
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('paste', onPaste, true);
    if (st.img) try { URL.revokeObjectURL(st.img); } catch (e) {}
    closeOcr();
    try { if (o.returnFocus && o.returnFocus.focus) o.returnFocus.focus(); } catch (e) {}
  }
  function onKey(e){
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') {   // keep focus inside the dialog
      const f = [...box.querySelectorAll('button:not([disabled]),input:not([type=file]),textarea,[tabindex="0"]')].filter((x) => x.offsetParent);
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
    e.stopPropagation();    // chart hotkeys stay off while the sheet is open
  }
  function onPaste(e){
    const items = [...((e.clipboardData && e.clipboardData.items) || [])];
    const img = items.find((i) => i.kind === 'file' && /^image\//.test(i.type));
    if (img) { e.preventDefault(); setTab('image'); runImage(img.getAsFile()); return; }
    if (st.tab === 'image' && st.phase === 'start') {
      const t = e.clipboardData && e.clipboardData.getData('text');
      if (t && /\d/.test(t)) { e.preventDefault(); setTab('text'); const ta = pane.querySelector('.stkli-ta'); if (ta) { ta.value = t; ta.focus(); } }
    }
  }
  scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) close(); });
  box.querySelector('.stkli-x').addEventListener('click', close);
  box.querySelectorAll('.stkli-seg button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  box.querySelector('.stkli-seg').addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); setTab(st.tab === 'image' ? 'text' : 'image'); box.querySelector('.stkli-seg [aria-selected="true"]').focus(); } });
  box.querySelector('.stkli-again').addEventListener('click', () => { st.phase = 'start'; st.levels = []; st.warnings = []; render(); });
  addBtn.addEventListener('click', () => {
    const pick = st.levels.filter((l) => l.checked && Number.isFinite(l.price) && l.price > 0);
    if (!pick.length) return;
    const n = addLevels(ws, pick);
    if (n) { toast(n + ' level' + (n === 1 ? '' : 's') + ' added to ' + (cx.symbol || 'the chart') + '. Ctrl+Z removes them.', 'success'); close(); }
    else toast('The levels could not be added to this chart.', 'error');
  });
  fileIn.addEventListener('change', () => { const f = fileIn.files && fileIn.files[0]; fileIn.value = ''; if (f) runImage(f); });

  function setTab(t){ if (st.tab === t && st.phase !== 'review') { paintTabs(); return; } st.tab = t; st.phase = 'start'; st.levels = []; st.warnings = []; st.runId++; render(); }
  function paintTabs(){ box.querySelectorAll('.stkli-seg button').forEach((b) => { const on = b.dataset.tab === st.tab; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; }); }

  function render(){
    paintTabs();
    pane.replaceChildren();
    foot.hidden = st.phase !== 'review';
    if (st.phase === 'work') return renderWork();
    if (st.phase === 'review') return renderReview();
    if (st.tab === 'text') return renderText();
    const drop = h('div', { class: 'stkli-drop', tabindex: '0', role: 'button', 'aria-label': 'Choose a screenshot of your chart' });
    drop.innerHTML = `<span class="stkli-drop-ic">${IC.img}</span><h3>Drop a screenshot of your chart</h3>
      <p>Paste it with Ctrl+V, drop it here, or choose a file. We find the horizontal lines and read their prices on this device. The picture is not uploaded.</p>
      <button type="button" class="stkli-btn">Choose image</button>
      <ul class="stkli-tips"><li>Crop to the chart</li><li>Keep the price axis in the picture</li><li>Light or dark both work</li></ul>`;
    drop.addEventListener('click', () => fileIn.click());
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = [...(e.dataTransfer.files || [])].find((x) => /^image\//.test(x.type)); if (f) runImage(f); });
    pane.appendChild(drop);
  }
  function renderText(){
    const ta = h('textarea', { class: 'stkli-ta', 'aria-label': 'Levels to import', spellcheck: 'false',
      placeholder: 'One level per line, or a list:\n21450 PDH\n21500.25\n21388, 21412.5\n\nOr paste a Pine script with hline(...) or line.new(...)' });
    const row = h('div', { class: 'stkli-ta-row' });
    const hint = h('p', { class: 'stkli-hint', text: 'Prices are rounded to ' + (cx.symbol || 'this chart') + '\u2019s tick (' + fmtPrice(cx.tick, cx.tick) + ').' });
    const go = h('button', { type: 'button', class: 'stkli-btn' }, 'Read levels');
    go.addEventListener('click', () => runText(ta.value));
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runText(ta.value); } });
    row.append(hint, go);
    pane.append(ta, row);
    setTimeout(() => { try { ta.focus({ preventScroll: true }); } catch (e) {} }, 0);
  }
  function renderWork(){
    const w = h('div', { class: 'stkli-work', role: 'status', 'aria-live': 'polite' });
    w.innerHTML = '<div class="stkli-bar"><i></i></div><p>Opening the picture</p>';
    pane.appendChild(w);
  }
  function progress(text, p){
    if (st.phase !== 'work') return;
    const w = pane.querySelector('.stkli-work'); if (!w) return;
    w.querySelector('p').textContent = text;
    w.querySelector('i').style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%';
  }

  async function runImage(file){
    const id = ++st.runId;
    st.tab = 'image'; st.phase = 'work'; render();
    try {
      const r = await analyzeImage(file, { tick: cx.tick, ref: cx.ref, symbol: cx.symbol, onProgress: (t, p) => { if (id === st.runId) progress(t, p); } });
      if (id !== st.runId || !open) return;
      if (st.img) try { URL.revokeObjectURL(st.img); } catch (e) {}
      st.img = URL.createObjectURL(await new Promise((res) => r.canvas.toBlob(res, 'image/png')));
      st.size = { w: r.width, h: r.height };
      st.levels = r.levels.map((l) => Object.assign({}, l));
      st.warnings = r.warnings;
      st.phase = 'review'; render();
    } catch (e) {
      if (id !== st.runId || !open) return;
      console.warn('TradeZoro: import levels', e);
      st.phase = 'start'; render();
      toast('That picture could not be read. Try a PNG or JPG screenshot.', 'error');
    }
  }
  function runText(text){
    const r = Core.parseLevelsText(text);
    if (!r.levels.length) { toast('No prices found in that text.', 'error'); return; }
    st.img = null; st.size = null;
    st.levels = Core.mergeLevels(r.levels.map((l) => ({ price: l.price, label: l.label, color: '#2962ff', style: 'solid', width: 1, checked: true, exact: true, source: r.kind })), cx.tick);
    st.warnings = [];
    if (Core.rangeMismatch(st.levels.map((l) => l.price), cx.ref)) st.warnings.push({ id: 'range', text: 'These prices are far from ' + (cx.symbol || 'this chart') + ' (' + fmtPrice(cx.ref, cx.tick) + '). They may be for another market.' });
    st.phase = 'review'; render();
  }

  function renderReview(){
    const rev = h('div', { class: 'stkli-rev' + (st.img ? '' : ' noimg') });
    if (!st.img) rev.style.gridTemplateColumns = 'minmax(0, 1fr)';
    let svg = null;
    if (st.img) {
      const prev = h('div', { class: 'stkli-prev' });
      const im = h('img', { src: st.img, alt: 'Your screenshot with the lines we found' });
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 ' + st.size.w + ' ' + st.size.h); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
      prev.append(im, svg);
      rev.appendChild(prev);
    }
    const side = h('div', { class: 'stkli-side' });
    for (const w of st.warnings) { const p = h('p', { class: 'stkli-warn', role: 'note' }, IC.warn + '<span></span>'); p.querySelector('span').textContent = w.text; side.appendChild(p); }
    const head = h('div', { class: 'stkli-lh', 'aria-hidden': 'true' }, '<span></span><span></span><span class="r">Price</span><span>Label</span><span></span>');
    const list = h('ul', { class: 'stkli-list', 'aria-label': 'Levels found' });
    side.append(head, list);
    const add = h('button', { type: 'button', class: 'stkli-btn stkli-addrow' }, IC.plus + '<span>Add a level</span>');
    add.addEventListener('click', () => {
      st.levels.push({ price: NaN, label: '', color: '#2962ff', style: 'solid', width: 1, checked: true, source: 'manual' });
      paintList(); const ins = list.querySelectorAll('.stkli-p'); if (ins.length) ins[ins.length - 1].focus();
    });
    side.appendChild(add);
    rev.appendChild(side);
    pane.appendChild(rev);

    function paintOverlay(){
      if (!svg) return;
      svg.replaceChildren();
      st.levels.forEach((l, i) => {
        if (!Number.isFinite(l.y)) return;
        const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        const hl = i === st.hl;
        ln.setAttribute('x1', '0'); ln.setAttribute('x2', String(st.size.w)); ln.setAttribute('y1', String(l.y)); ln.setAttribute('y2', String(l.y));
        ln.setAttribute('stroke', hl ? '#03c988' : l.color || '#2962ff');
        ln.setAttribute('stroke-width', String(hl ? 6 : 3)); ln.setAttribute('vector-effect', 'non-scaling-stroke');
        ln.setAttribute('stroke-opacity', l.checked ? (hl ? '0.9' : '0.75') : '0.25');
        if (!l.checked) ln.setAttribute('stroke-dasharray', '6 6');
        svg.appendChild(ln);
      });
    }
    function paintCount(){
      const n = st.levels.filter((l) => l.checked && Number.isFinite(l.price) && l.price > 0).length;
      addBtn.textContent = n ? 'Add ' + n + ' level' + (n === 1 ? '' : 's') + ' to chart' : 'Add levels';
      addBtn.disabled = !n;
      footHint.textContent = 'Adds horizontal lines to ' + (cx.symbol || 'this chart') + '. Ctrl+Z removes them.';
    }
    function paintList(){
      list.replaceChildren();
      if (!st.levels.length) { const li = h('li', { class: 'stkli-row' }); li.appendChild(h('span', { class: 'stkli-src', text: 'No levels found.' })).style.margin = '0'; list.appendChild(li); }
      st.levels.forEach((l, i) => {
        const li = h('li', { class: 'stkli-row' + (l.checked ? '' : ' off') + (i === st.hl ? ' hl' : '') });
        const ck = h('input', { type: 'checkbox', class: 'stkli-ck', 'aria-label': 'Add this level' }); ck.checked = !!l.checked;
        const sw = h('span', { class: 'stkli-sw', title: (l.style || 'solid') + ' line' }); sw.style.background = l.color || '#2962ff';
        if (l.style && l.style !== 'solid') sw.style.background = 'repeating-linear-gradient(90deg, ' + l.color + ' 0 3px, transparent 3px 5px)';
        const pr = h('input', { type: 'text', class: 'stkli-p', inputmode: 'decimal', 'aria-label': 'Price', autocomplete: 'off' }); pr.value = fmtPrice(l.price, cx.tick);
        const lb = h('input', { type: 'text', class: 'stkli-l', 'aria-label': 'Label', placeholder: 'Label', maxlength: '60', autocomplete: 'off' }); lb.value = l.label || '';
        const del = h('button', { type: 'button', class: 'stkli-del', 'aria-label': 'Remove this level' }, IC.del);
        ck.addEventListener('change', () => { l.checked = ck.checked; li.classList.toggle('off', !l.checked); paintOverlay(); paintCount(); });
        pr.addEventListener('change', () => {
          const v = Core.parseNum(pr.value);
          pr.classList.toggle('bad', !(v > 0));
          if (v > 0) { l.price = Core.roundTick(v, cx.tick); pr.value = fmtPrice(l.price, cx.tick); l.checked = true; ck.checked = true; li.classList.remove('off'); }
          else l.price = NaN;
          paintOverlay(); paintCount();
        });
        lb.addEventListener('input', () => { l.label = lb.value.slice(0, 60); });
        del.addEventListener('click', () => { st.levels.splice(i, 1); if (st.hl === i) st.hl = -1; paintList(); });
        const focusRow = () => { st.hl = i; list.querySelectorAll('.stkli-row').forEach((r, k) => r.classList.toggle('hl', k === i)); paintOverlay(); };
        li.addEventListener('mouseenter', focusRow); li.addEventListener('focusin', focusRow);
        li.append(ck, sw, pr, lb, del);
        if (l.hint || (l.source === 'line' && !l.exact && l.approx > cx.tick && Number.isFinite(l.price))) {
          li.appendChild(h('span', { class: 'stkli-src', text: l.hint || ('Read from the line position, about \u00b1' + fmtPrice(Core.roundTick(Math.max(cx.tick, l.approx), cx.tick), cx.tick) + '. Check it.') }));
        }
        list.appendChild(li);
      });
      paintOverlay(); paintCount();
    }
    paintList();
    setTimeout(() => { try { addBtn.focus({ preventScroll: true }); } catch (e) {} }, 0);
  }

  document.body.appendChild(scrim);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('paste', onPaste, true);
  render();
  setTimeout(() => { const f = box.querySelector(st.tab === 'image' ? '.stkli-drop' : '.stkli-ta'); try { f && f.focus({ preventScroll: true }); } catch (e) {} }, 0);
  open = { close, focus: () => { try { box.focus(); } catch (e) {} }, el: box, runImage, runText, get state(){ return st; } };
  if (o.file) runImage(o.file);
  return open;
}
