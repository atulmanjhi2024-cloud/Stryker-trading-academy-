// TradeZoro — Charts "Import levels": the pure part (ES module, no DOM, node-testable).
// Owner order 2026-11-22 (member asked to bring the horizontal levels from another chart in one go):
// a member drops a screenshot of a chart, or pastes a list / a Pine script, and gets the levels back as
// normal horizontal-line drawings. The UI, OCR and the chart side live in assets/chart-levels-import.js;
// this file only does the maths so it can be tested on its own (tools/tests/levels-import.test.mjs).
//
//   parseLevelsText(text)            prices from "21450, 21500.25", "21450 PDH", hline(...) / line.new(...)
//   detectLines(img, area)           horizontal lines in an RGBA image: long runs of one colour across the plot
//   detectBoxes(img, strip)          coloured price boxes on the price axis
//   findAxisColumn(words, imgW)      the column of OCR'd price-axis numbers
//   fitAxis(points)                  y -> price from 2+ labels (robust; linear, or log when that fits better)
//   buildLevels(...)                 lines + boxes + labels -> priced levels, rounded to the tick, merged
// Images: { width, height, data } with data = RGBA bytes (ImageData). Nothing is uploaded anywhere.
// Education only. Not financial advice.

// ------------------------------------------------------------------ numbers + text
export function decimalsOf(t){ const s = String(t); if (/e-/.test(s)) return Number(s.split('e-')[1]); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; }
export function roundTick(p, tick){
  if (!(tick > 0)) return p;
  return Number((Math.round(p / tick) * tick).toFixed(decimalsOf(tick)));
}
// One OCR'd / typed number: "21,450.25" "21450.25" "−12.5" "4.512K" is NOT accepted (no unit guessing).
export function parseNum(s){
  if (s == null) return NaN;
  let t = String(s).trim().replace(/[\u2212\u2012\u2013]/g, '-').replace(/\s+/g, '');
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
  return Number(t);
}

// A number read by OCR from a price label: separators are often misread (',' as '.'), so the last
// separator followed by 1, 2 or 4+ digits is the decimal point and the rest are thousands. A single
// separator + exactly 3 digits ("97.800") is ambiguous; findAxisColumn settles that one.
export function parseOcrNum(s){
  let t = String(s == null ? '' : s).replace(/[\u2212\u2012\u2013]/g, '-').replace(/[^\d.,\-]/g, '');
  const neg = /^-/.test(t); t = t.replace(/-/g, '');
  if (!/\d/.test(t) || /[.,]{2}/.test(t) || /^[.,]|[.,]$/.test(t)) return NaN;
  const parts = t.split(/[.,]/);
  if (parts.length === 1) return (neg ? -1 : 1) * Number(t);
  const last = parts[parts.length - 1], head = parts.slice(0, -1);
  if (head.slice(1).some((p) => p.length !== 3) || head[0].length > 3 && head.length > 1) return NaN;
  const v = last.length === 3 && head.length >= 1 && head[0].length <= 3 && parts.length > 2 ? Number(parts.join(''))   // 1,234,567
    : last.length === 3 && parts.length === 2 && head[0].length <= 3 ? Number(head[0] + last)                           // ambiguous: thousands
    : Number(head.join('') + '.' + last);
  return neg ? -v : v;
}
const NUM_RE = /[-+\u2212]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g;
const MAX_LEVELS = 200;

// Pine script: hline(...), line.new(...), plot(<constant>), with simple variables and input.*() defaults.
function splitArgs(s){
  const out = []; let depth = 0, cur = '', q = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function callArgs(src, at){
  // src[at] === '(' ; returns the text between the matching parentheses
  let depth = 0, q = null;
  for (let i = at; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) return src.slice(at + 1, i); }
  }
  return null;
}
const unq = (s) => { const m = /^\s*(["'])(.*)\1\s*$/.exec(s || ''); return m ? m[2] : null; };
function pineVars(src){
  const vars = {};
  const re = /^[ \t]*(?:var\s+|varip\s+)?(?:(?:const|simple|series|input)\s+)?(?:float\s+|int\s+)?([A-Za-z_]\w*)\s*(?::=|=)(?!=)\s*(.+)$/gm;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1], rhs = m[2].replace(/\/\/.*$/, '').trim();
    const n = parseNum(rhs);
    if (Number.isFinite(n)) { vars[name] = { v: n }; continue; }
    const im = /^input(?:\.(?:float|int|price))?\s*\(/.exec(rhs);
    if (im) {
      const inner = callArgs(rhs, rhs.indexOf('(', im.index));
      if (inner == null) continue;
      const args = splitArgs(inner);
      let v = NaN, title = null;
      args.forEach((a, i) => {
        const kv = /^(\w+)\s*=(?!=)\s*(.+)$/.exec(a);
        if (kv) { if (kv[1] === 'defval') v = parseNum(kv[2]); if (kv[1] === 'title') title = unq(kv[2]); }
        else if (i === 0) v = parseNum(a);
        else if (i === 1 && unq(a) != null) title = unq(a);
      });
      if (Number.isFinite(v)) vars[name] = { v, title };
    }
  }
  return vars;
}
function pineValue(expr, vars){
  const n = parseNum(expr);
  if (Number.isFinite(n)) return { v: n };
  const id = /^\s*([A-Za-z_]\w*)\s*$/.exec(expr || '');
  return id && vars[id[1]] ? vars[id[1]] : null;
}
function parsePine(src){
  const code = src.replace(/\/\/[^\n]*/g, '');
  const vars = pineVars(code);
  const out = [];
  const re = /\b(hline|line\.new|plot)\s*\(/g;
  let m;
  while ((m = re.exec(code))) {
    const inner = callArgs(code, m.index + m[0].length - 1);
    if (inner == null) continue;
    const args = splitArgs(inner);
    const named = {}, pos = [];
    for (const a of args) { const kv = /^(\w+)\s*=(?!=)\s*([\s\S]+)$/.exec(a); if (kv) named[kv[1]] = kv[2]; else pos.push(a); }
    const kind = m[1];
    if (kind === 'hline' || kind === 'plot') {
      const pv = pineValue(named.price != null ? named.price : named.series != null ? named.series : pos[0], vars);
      if (!pv) continue;
      const title = unq(named.title != null ? named.title : pos[1]) || pv.title || '';
      out.push({ price: pv.v, label: title });
    } else {
      const y1 = pineValue(named.y1 != null ? named.y1 : pos[1], vars);
      const y2 = pineValue(named.y2 != null ? named.y2 : pos[3], vars);
      if (!y1 || (y2 && y2.v !== y1.v)) continue;    // only horizontal lines
      out.push({ price: y1.v, label: y1.title || '' });
    }
  }
  return out;
}
function parseList(text){
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    // thousands commas ("21,450.25") become plain numbers; other commas/semicolons/pipes/tabs split items
    const line = raw.replace(/(\d),(\d{3})(?![\d])/g, '$1$2').replace(/(\d),(\d{3})(?![\d])/g, '$1$2');
    for (const chunk of line.split(/[,;|\t]+/)) {
      const c = chunk.trim();
      if (!c) continue;
      if (/\d{1,2}:\d{2}/.test(c) || /\d{4}-\d{2}-\d{2}/.test(c)) continue;    // times / dates are not prices
      const nums = c.match(NUM_RE) || [];
      if (!nums.length) continue;
      const label = c.replace(NUM_RE, ' ').replace(/^[\s:=@\-–—]+|[\s:=@\-–—]+$/g, '').replace(/\s+/g, ' ').trim();
      // "21450 21500 21550" on one line: each number a level; "21450 PDH" / "PDH: 21450": one labelled level
      if (nums.length > 1 && !label) nums.forEach((n) => out.push({ price: parseNum(n), label: '' }));
      else out.push({ price: parseNum(nums[0]), label: label.slice(0, 60) });
    }
  }
  return out;
}
export function parseLevelsText(text){
  const src = String(text || '').slice(0, 200000);
  const pine = /\b(hline|line\.new)\s*\(|\/\/@version|\bindicator\s*\(|\bstudy\s*\(/.test(src);
  const raw = pine ? parsePine(src) : parseList(src);
  const levels = [], seen = new Set();
  for (const l of raw) {
    if (!Number.isFinite(l.price) || l.price <= 0) continue;
    const k = l.price + '|' + l.label;
    if (seen.has(k)) continue;
    seen.add(k); levels.push({ price: l.price, label: l.label || '' });
    if (levels.length >= MAX_LEVELS) break;
  }
  return { kind: pine ? 'pine' : 'list', levels };
}

// ------------------------------------------------------------------ colour helpers
const px = (img, x, y) => { const i = (y * img.width + x) * 4, d = img.data; return [d[i], d[i + 1], d[i + 2]]; };
export const cdist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const sat = (c) => { const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]); return mx === 0 ? 0 : (mx - mn) / mx; };
export const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const bucket = (c) => ((c[0] >> 4) << 8) | ((c[1] >> 4) << 4) | (c[2] >> 4);

// The plot background: the most common colour of the image (sampled on a grid).
export function backgroundOf(img, area){
  const a = area || { x0: 0, x1: img.width - 1, y0: 0, y1: img.height - 1 };
  const counts = new Map(), sums = new Map();
  const sx = Math.max(1, Math.floor((a.x1 - a.x0) / 160)), sy = Math.max(1, Math.floor((a.y1 - a.y0) / 160));
  for (let y = a.y0; y <= a.y1; y += sy) for (let x = a.x0; x <= a.x1; x += sx) {
    const c = px(img, x, y), b = bucket(c);
    counts.set(b, (counts.get(b) || 0) + 1);
    const s = sums.get(b) || [0, 0, 0]; s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; sums.set(b, s);
  }
  let best = -1, bn = 0;
  for (const [b, n] of counts) if (n > bn) { bn = n; best = b; }
  const s = sums.get(best);
  return s ? s.map((v) => v / bn) : [0, 0, 0];
}

// ------------------------------------------------------------------ horizontal lines
const BG_T = 26;     // a pixel this far (max channel) from the background is "ink"
const SAME_T = 52;   // a pixel this close to a row's dominant colour belongs to it

// The colours of one row (background left out), most common first: [{ col, n }]
function rowColours(img, y, x0, x1, bg){
  const counts = new Map(), sums = new Map();
  for (let x = x0; x <= x1; x++) {
    const c = px(img, x, y);
    if (cdist(c, bg) <= BG_T) continue;
    const b = bucket(c);
    counts.set(b, (counts.get(b) || 0) + 1);
    const s = sums.get(b) || [0, 0, 0]; s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; sums.set(b, s);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([b, n]) => ({ col: sums.get(b).map((v) => v / n), n }));
}
// Segments of one colour along a row (1-2 px holes bridged: anti-aliasing, a thin crossing wick).
// Pixels of other ink (candles drawn over the line) are "covered": they neither break nor count.
function rowSegs(img, y, x0, x1, col, bg){
  const segs = [];
  let start = -1, last = -1, cov = 0, covered = 0;
  for (let x = x0; x <= x1; x++) {
    const c = px(img, x, y);
    const hit = cdist(c, col) <= SAME_T;
    if (hit) { cov++; if (start < 0) start = x; else if (x - last > 2) { segs.push([start, last]); start = x; } last = x; }
    else if (cdist(c, bg) > BG_T) covered++;
  }
  if (start >= 0) segs.push([start, last]);
  return segs.length ? { y, col, cov, covered, W: x1 - x0 + 1, segs, first: segs[0][0], lastX: segs[segs.length - 1][1] } : null;
}
// Up to 3 candidate colours per row; the best one that reads as a line wins.
function rowScan(img, y, x0, x1, bg, opt){
  const W = x1 - x0 + 1;
  let best = null;
  for (const c of rowColours(img, y, x0, x1, bg).slice(0, 3)) {
    if (c.n < W * 0.12) break;
    const r = rowSegs(img, y, x0, x1, c.col, bg);
    if (!r) continue;
    if (!opt) return r;
    const k = classifyRow(r, opt);
    if (k && (!best || r.cov > best.cov)) best = Object.assign(r, k);
  }
  return best;
}
function median(a){ if (!a.length) return 0; const s = [...a].sort((p, q) => p - q), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

// A row that is (part of) a horizontal line: one colour across most of the plot, solid or dashed.
function classifyRow(r, opt){
  const span = r.lastX - r.first + 1;
  if (span < r.W * opt.minSpan) return null;
  const fill = r.cov / span;
  const lens = r.segs.map((s) => s[1] - s[0] + 1);
  const gaps = []; for (let i = 1; i < r.segs.length; i++) gaps.push(r.segs[i][0] - r.segs[i - 1][1] - 1);
  if (fill >= 0.72 || (fill >= 0.5 && (r.cov + r.covered) / span >= 0.9 && lens.filter((l) => l >= 30).length >= 3)) return { style: 'solid', fill, span };
  // dashed / dotted: many short pieces at a regular pitch (a row through candles is irregular)
  if (r.segs.length < 8 || fill < 0.2) return null;
  const ml = median(lens), mg = median(gaps);
  if (ml > 40 || mg > 40 || mg < 1) return null;
  const okL = lens.filter((l) => Math.abs(l - ml) <= Math.max(1.5, ml * 0.5)).length / lens.length;
  const okG = gaps.filter((g) => Math.abs(g - mg) <= Math.max(1.5, mg * 0.5)).length / gaps.length;
  if (okL < 0.6 || okG < 0.55) return null;
  return { style: ml <= 2.5 ? 'dotted' : 'dashed', fill, span, dash: ml, gap: mg };
}

// area: { x0, x1, y0, y1 } = the plot (price axis excluded). Returns lines sorted top -> bottom:
// { y (sub-pixel centre), color '#rrggbb', rgb, style, width, x0, x1, fill }
export function detectLines(img, area, bgIn){
  const a = Object.assign({ x0: 0, x1: img.width - 1, y0: 0, y1: img.height - 1 }, area || {});
  const bg = bgIn || backgroundOf(img, a);
  const opt = { minSpan: 0.55 };
  const rows = [];
  for (let y = a.y0; y <= a.y1; y++) {
    const r = rowScan(img, y, a.x0, a.x1, bg, opt);
    if (r) rows.push(r);
  }
  // consecutive rows of one colour = one line (thickness / anti-aliasing)
  const groups = [];
  for (const r of rows) {
    const g = groups[groups.length - 1];
    if (g && r.y - g.rows[g.rows.length - 1].y <= 1 && (cdist(r.col, g.rows[0].col) <= 90 || cdist(r.col, g.rows[g.rows.length - 1].col) <= 90)) g.rows.push(r);
    else groups.push({ rows: [r] });
  }
  const lines = [];
  for (const g of groups) {
    if (g.rows.length > 6) continue;                              // a band / panel edge, not a line
    let wsum = 0, ysum = 0, best = g.rows[0];
    for (const r of g.rows) {
      const w = r.cov * cdist(r.col, bg);
      wsum += w; ysum += w * r.y;
      if (cdist(r.col, bg) * r.cov > cdist(best.col, bg) * best.cov) best = r;
    }
    const contrast = cdist(best.col, bg);
    const strong = g.rows.filter((r) => cdist(r.col, bg) >= contrast * 0.7).length;
    lines.push({ y: ysum / wsum, rgb: best.col.map(Math.round), color: hex(best.col), style: best.style, width: Math.max(1, Math.min(4, strong)),
      x0: best.first, x1: best.lastX, fill: best.fill, contrast, sat: sat(best.col) });
  }
  return dropGrid(lines, bg);
}
// Grid lines: faint (close to the background), or a run of 4+ grey lines at an even spacing.
function dropGrid(lines, bg){
  let keep = lines.filter((l) => !(l.contrast < 44 || (l.sat < 0.18 && l.contrast < 70)));
  const grey = keep.filter((l) => l.sat < 0.15);
  const byCol = [];
  for (const l of grey) { const g = byCol.find((x) => cdist(x[0].rgb, l.rgb) <= 18 && x[0].style === l.style); if (g) g.push(l); else byCol.push([l]); }
  const drop = new Set();
  for (const g of byCol) {
    if (g.length < 4) continue;
    const ys = g.map((l) => l.y).sort((p, q) => p - q), d = []; for (let i = 1; i < ys.length; i++) d.push(ys[i] - ys[i - 1]);
    const md = median(d);
    if (md > 0 && d.filter((v) => Math.abs(v - md) <= Math.max(2, md * 0.06) || Math.abs(v - 2 * md) <= Math.max(3, md * 0.08)).length / d.length >= 0.8) g.forEach((l) => drop.add(l));
  }
  keep = keep.filter((l) => !drop.has(l));
  void bg;
  return keep;
}

// ------------------------------------------------------------------ price-axis boxes
// strip: { x0, x1, y0, y1 } = the price axis. A box = rows where one saturated colour fills most of the strip.
export function detectBoxes(img, strip, bgIn){
  const s = Object.assign({ y0: 0, y1: img.height - 1 }, strip);
  const bg = bgIn || backgroundOf(img, s);
  const rows = [];
  for (let y = s.y0; y <= s.y1; y++) {
    // a box fills the strip up to the right edge: its colour is the edge pixel (skipping a 1-2 px
    // border); walk left through that colour, its text allowed
    let x = s.x1, col = null;
    for (; x >= s.x1 - 2; x--) { const c = px(img, x, y); if (cdist(c, bg) >= 50) { col = c; break; } }
    if (!col) { rows.push(null); continue; }
    let xl = -1, miss = 0, n = 0;
    for (; x >= s.x0; x--) {
      if (cdist(px(img, x, y), col) <= SAME_T) { xl = x; miss = 0; n++; } else if (++miss > 40) break;
    }
    rows.push(xl >= 0 && s.x1 - xl >= 30 && n >= (s.x1 - xl) * 0.3 ? { y, col } : null);
  }
  const boxes = [];
  let run = [];
  const flush = () => {
    if (run.length >= 9 && run.length <= 44) {
      const c = run[Math.floor(run.length / 2)].col, y0 = run[0].y, y1 = run[run.length - 1].y;
      // the box's left edge: where its top and bottom rows stop (a level line runs on through the middle)
      const at = (x, yy) => cdist(px(img, x, yy), c) <= SAME_T;
      let x0 = s.x1, gap = 0;
      for (let x = s.x1; x >= s.x0; x--) { if (at(x, y0 + 1) && at(x, y1 - 1)) { x0 = x; gap = 0; } else if (++gap > 2) break; }
      if (s.x1 - x0 >= 24) boxes.push({ y0, y1, y: (y0 + y1) / 2, x0, x1: s.x1, rgb: c.map(Math.round), color: hex(c) });
    }
    run = [];
  };
  for (const r of rows) {
    if (r && (!run.length || cdist(r.col, run[0].col) <= 70)) run.push(r);
    else { flush(); if (r) run.push(r); }
  }
  flush();
  return boxes;
}

// ------------------------------------------------------------------ the price axis from OCR words
// words: [{ text, x0, y0, x1, y1 }] from the right part of the image. Returns the column of numbers
// that line up (right- or left-aligned) or null: { x0, x1, points: [{ y, v }] }. ref: the open chart's
// price, used only to read labels like "151.250" (thousands or decimals) when nothing else settles it.
export function findAxisColumn(words, imgW, ref){
  // one label read as two words ("97," + "400", "68." + "40"): join neighbours on the same row
  const ws = (words || []).filter((w) => w && w.text).map((w) => Object.assign({}, w)).sort((a, b) => a.x0 - b.x0);
  const joined = [];
  for (const w of ws) {
    const hh = Math.max(4, w.y1 - w.y0);
    const p = joined.find((q) => Math.abs((q.y0 + q.y1) / 2 - (w.y0 + w.y1) / 2) <= hh * 0.4 && w.x0 - q.x1 >= -2 && w.x0 - q.x1 <= hh * 1.2 && /[\d.,]$/.test(q.text) && /^[\d.,]/.test(w.text));
    if (p) { p.text += w.text; p.x1 = Math.max(p.x1, w.x1); p.y0 = Math.min(p.y0, w.y0); p.y1 = Math.max(p.y1, w.y1); continue; }
    joined.push(w);
  }
  const nums = [];
  for (const w of joined) {
    const t = String(w.text || '').replace(/[^\d.,\-\u2212]/g, '');
    const v = parseOcrNum(t);
    if (!Number.isFinite(v) || !/\d/.test(t) || t.replace(/\D/g, '').length < 1) continue;
    // "97.800" / "98,200": a thousands separator or 3 decimals; settled below by the other labels
    const amb = /^\d{1,3}[.,]\d{3}$/.test(t) ? [Number(t.replace(/[.,]/, '')), Number(t.replace(',', '.'))] : null;
    nums.push({ v, amb, y: (w.y0 + w.y1) / 2, x0: w.x0, x1: w.x1, h: w.y1 - w.y0 });
  }
  const sure = nums.filter((n) => !n.amb).map((n) => n.v);
  for (const n of nums) {
    if (!n.amb) continue;
    if (sure.length) { const m = median(sure); n.v = Math.abs(Math.log(n.amb[0] / m)) < Math.abs(Math.log(n.amb[1] / m)) ? n.amb[0] : n.amb[1]; }
    else if (ref > 0) n.v = Math.abs(Math.log(n.amb[0] / ref)) < Math.abs(Math.log(n.amb[1] / ref)) ? n.amb[0] : n.amb[1];   // nearer the open chart
    else n.v = n.amb[0];        // no other clue: thousands
  }

  if (nums.length < 2) return null;
  let best = null;
  for (const key of ['x1', 'x0']) {
    for (const seed of nums) {
      const col = nums.filter((n) => Math.abs(n[key] - seed[key]) <= 8);
      const ys = new Set(col.map((n) => Math.round(n.y / 4)));
      const score = ys.size + (key === 'x1' ? 0.1 : 0) + seed[key] / (imgW || 1e9) * 0.01;
      if (!best || score > best.score) best = { score, col };
    }
  }
  if (!best || best.col.length < 2) return null;
  const col = best.col;
  return { x0: Math.min(...col.map((n) => n.x0)), x1: Math.max(...col.map((n) => n.x1)), h: median(col.map((n) => n.h)), points: col.map((n) => ({ y: n.y, v: n.v })) };
}

// ------------------------------------------------------------------ y -> price
function lsq(pts, f){
  const n = pts.length; let sy = 0, sv = 0, syy = 0, syv = 0;
  for (const p of pts) { const v = f(p.v); sy += p.y; sv += v; syy += p.y * p.y; syv += p.y * v; }
  const d = n * syy - sy * sy; if (Math.abs(d) < 1e-9) return null;
  const a = (n * syv - sy * sv) / d; return { a, b: (sv - a * sy) / n };
}
function fitModel(pts, log){
  const f = log ? Math.log : (v) => v;
  const usable = log ? pts.filter((p) => p.v > 0) : pts;
  let best = null;
  for (let i = 0; i < usable.length; i++) for (let j = i + 1; j < usable.length; j++) {
    const p = usable[i], q = usable[j];
    if (Math.abs(p.y - q.y) < 6 || p.v === q.v) continue;
    const a = (f(q.v) - f(p.v)) / (q.y - p.y); if (!(a < 0)) continue;   // prices rise upwards
    const b = f(p.v) - a * p.y;
    const inl = usable.filter((r) => Math.abs((f(r.v) - b) / a - r.y) <= 2.5);
    if (!best || inl.length > best.inl.length) best = { inl };
  }
  if (!best || best.inl.length < 2) return null;
  const m = lsq(best.inl, f); if (!m || !(m.a < 0)) return null;
  const res = best.inl.map((r) => Math.abs((f(r.v) - m.b) / m.a - r.y));
  return { log, a: m.a, b: m.b, n: best.inl.length, rms: Math.sqrt(res.reduce((s, v) => s + v * v, 0) / res.length), inliers: best.inl };
}
// points: [{ y, v }] -> { priceAt(y), yAt(price), log, n, rms, perPx } or null
export function fitAxis(points){
  const pts = (points || []).filter((p) => Number.isFinite(p.y) && Number.isFinite(p.v));
  const lin = fitModel(pts, false), lg = fitModel(pts, true);
  let m = lin;
  // a log scale: clearly more labels agree in log space, or the same labels sit much tighter there
  if (lg && (!lin || lg.n > lin.n || (lg.n === lin.n && lg.n >= 4 && lg.rms < lin.rms * 0.35 && lin.rms > 0.8))) m = lg;
  if (!m) return null;
  const priceAt = (y) => (m.log ? Math.exp(m.a * y + m.b) : m.a * y + m.b);
  const yAt = (v) => ((m.log ? Math.log(v) : v) - m.b) / m.a;
  return { log: m.log, a: m.a, b: m.b, n: m.n, rms: m.rms, priceAt, yAt,
    perPx: (y) => Math.abs(priceAt(y) - priceAt(y + 1)), labels: m.inliers };
}

// ------------------------------------------------------------------ assemble
// lines/boxes from above; fit from fitAxis; boxText: Map(box -> price read from it); words: OCR words of the plot
// Returns [{ price, exact, source: 'box'|'label'|'line', color, style, width, label, y, checked, approx }]
export function buildLevels({ lines, boxes, fit, boxText, words, tick }){
  const out = [];
  const usedBox = new Set();
  const perPx = (y) => (fit ? fit.perPx(y) : 0);
  for (const l of lines || []) {
    if (!fit) break;
    const est = fit.priceAt(l.y);
    const lv = { y: l.y, price: est, exact: false, source: 'line', color: l.color, style: l.style, width: l.width, label: '', checked: true, approx: perPx(l.y) };
    // a coloured price box on the axis at the same height: its text is the exact price
    let bestB = null, bd = 1e9;
    for (const b of boxes || []) {
      const d = Math.abs(b.y - l.y);
      if (d <= 6 && d < bd && (cdist(b.rgb, l.rgb) <= 110 || (boxes.length === 1))) { bd = d; bestB = b; }
    }
    if (bestB && boxText && Number.isFinite(boxText.get(bestB))) {
      const v = boxText.get(bestB);
      if (Math.abs(v - est) <= Math.max(perPx(l.y) * 8, Math.abs(est) * 0.002)) { lv.price = v; lv.exact = true; lv.source = 'box'; usedBox.add(bestB); }
    }
    // a text label next to the line ("PDH", "Weekly high 21450.25")
    const near = (words || []).filter((w) => w.text && w.y1 >= l.y - 22 && w.y0 <= l.y + 18 && !(w.y0 < l.y - 1 && w.y1 > l.y + 1 && w.x1 - w.x0 > 300));
    if (near.length) {
      near.sort((p, q) => p.x0 - q.x0);
      const above = near.filter((w) => w.y1 <= l.y + 2), below = near.filter((w) => w.y0 >= l.y - 2);
      const side = above.length >= below.length ? above : below;
      // one row of words: the row closest to the line
      const rowY = side.length ? side.reduce((s, w) => s + (w.y0 + w.y1) / 2, 0) / side.length : 0;
      const row = side.filter((w) => Math.abs((w.y0 + w.y1) / 2 - rowY) <= 6);
      const text = row.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim();
      if (text && /[A-Za-z]|\d/.test(text)) {
        const nums = (text.match(NUM_RE) || []).map(parseNum).filter(Number.isFinite);
        const hit = nums.find((v) => Math.abs(v - est) <= Math.max(perPx(l.y) * 6, Math.abs(est) * 0.0015));
        if (hit != null && !lv.exact) { lv.price = hit; lv.exact = true; lv.source = 'label'; }
        const words2 = text.replace(NUM_RE, ' ').replace(/[^\w\s%./&+()-]/g, ' ').replace(/\s+/g, ' ').trim();
        if (/[A-Za-z]/.test(words2) && words2.replace(/\s/g, '').length >= 2) lv.label = words2.slice(0, 40);
      }
    }
    out.push(lv);
  }
  // boxes with no line: an axis label only (could be the live price or an indicator value): offered, not ticked
  for (const b of boxes || []) {
    if (usedBox.has(b) || !boxText || !Number.isFinite(boxText.get(b))) continue;
    if (out.some((l) => Math.abs(l.y - b.y) <= 6)) continue;
    out.push({ y: b.y, price: boxText.get(b), exact: true, source: 'box', color: b.color, style: 'solid', width: 1, label: '', checked: false, boxOnly: true, approx: 0 });
  }
  return mergeLevels(out, tick);
}
// Round to the tick and drop duplicates (same price after rounding, or within one tick: keep the exact one).
export function mergeLevels(levels, tick){
  const t = tick > 0 ? tick : 0;
  const rounded = levels.map((l) => Object.assign({}, l, { price: t ? roundTick(l.price, t) : l.price }));
  rounded.sort((a, b) => b.price - a.price);
  const out = [];
  for (const l of rounded) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.price - l.price) <= (t ? t * 1.0001 : 0)) {
      const keepNew = (l.exact && !prev.exact) || (l.checked && !prev.checked);
      if (keepNew) out[out.length - 1] = Object.assign({}, l, { label: l.label || prev.label });
      else if (!prev.label && l.label) prev.label = l.label;
      continue;
    }
    out.push(l);
  }
  return out;
}

// Does the screenshot look like another market? levels: prices; ref: the open chart's last price.
export function rangeMismatch(prices, ref){
  const p = (prices || []).filter((v) => Number.isFinite(v) && v > 0);
  if (!p.length || !(ref > 0)) return false;
  const m = median(p);
  return m > ref * 1.25 || m < ref / 1.25;
}
