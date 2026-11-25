// TradeZoro — Charts: coloured price TAGS on the right price scale (Owner bug 22 Nov 2026: "label on price not showing up for orders,
// lines and other stuff, make it show up like TradingView").
// One shared painter, one canvas per chart cell (inside the Vela plot, under the crosshair canvas, over the chrome that paints the
// last-price tag), so every cell of a multi-chart layout gets its own tags.
//   1. Trading lines (paper + live broker + order previews): chart-paper.js pushLines() calls setTags(R, 'trade', [{ price, color }]).
//      Anything else (the advanced order window's preview lines, the "Show on chart" popover) can call setTags(R, 'yourKey', list).
//   2. Drawings (read from cell.chart.drawings): horizontal line / ray always (default), every other price-carrying drawing while it is
//      selected or hovered. Per drawing switch: style.axisTag === false (settings > "Price label on scale"; saved with the drawing).
//   3. Indicators that paint their own axis tags (GEX, Camarilla ...) are not touched: only these two sources are tagged here.
//   4. Overlap: tags are sorted by y and pushed apart (never over the last-price tag, which keeps its place), inside the pane.
// No data, no network. Test: tools/tests/chart-axistags-browser.js.
const H = 16, GAP = 1, MAXTAGS = 80;
const FONT = '600 11px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif';
const NO_PRICE = new Set(['vline', 'text', 'note', 'callout', 'comment', 'pricenote', 'pricelabel', 'signpost', 'fibtimezones', 'trendfibtime', 'iconstamp', 'flagmark', 'arrowmarkup', 'arrowmarkdown', 'magnifier', 'anchoredvwap', 'fixedrangevp']);
const LINES = new Set(['hline', 'hray']);
const TRADE_KEY = 'stk_axtags_trade';
let WS = null, started = false, tradeOn = true;
try { tradeOn = localStorage.getItem(TRADE_KEY) !== '0'; } catch (e) {}
const states = new WeakMap();   // renderer -> { canvas, tags: Map(key -> list), sig, boxes }
const cv = document.createElement('canvas'), cx = cv.getContext('2d');

// '#rrggbb' from any CSS colour (alpha dropped: a tag is always solid); null when unparsable
function solid(c, fb) {
  try {
    cx.fillStyle = '#000'; cx.fillStyle = String(c || ''); const v = cx.fillStyle;
    if (v[0] === '#') return v.length === 7 ? v : fb;
    const m = /rgba?\(([^)]+)\)/.exec(v); if (!m) return fb;
    const n = m[1].split(',').map((x) => Math.round(parseFloat(x)));
    return '#' + n.slice(0, 3).map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('');
  } catch (e) { return fb; }
}
const ink = (hex) => { const n = parseInt(hex.slice(1), 16), l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; return l > 0.62 ? '#0b0b0d' : '#ffffff'; };

function rendererOf(cell) { try { return cell.chart.renderer.renderer; } catch (e) { return null; } }
function cellsOf() { try { return (WS.context().cells || []).map((c) => WS.cell(c.id)).filter(Boolean); } catch (e) { return []; } }
function stateOf(R) {
  let s = states.get(R);
  if (s && s.canvas.isConnected) return s;
  if (!R.plot) return null;
  const canvas = document.createElement('canvas'); canvas.className = 'stk-axtags'; canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
  R.plot.insertBefore(canvas, R.cursorCanvas && R.cursorCanvas.parentNode === R.plot ? R.cursorCanvas : null);
  s = { canvas, tags: s ? s.tags : new Map(), sig: '', boxes: [] }; states.set(R, s);
  return s;
}

// ---- public API ---------------------------------------------------------------------------------------------------------------
// list: [{ price, color, text? }]; text defaults to the price in the symbol's decimals (the same formatter as the axis).
export function setTags(R, key, list) {
  const s = R && stateOf(R); if (!s) return;
  if (list && list.length) s.tags.set(key, list); else s.tags.delete(key);
}
export function setTradeTags(on) { tradeOn = !!on; try { localStorage.setItem(TRADE_KEY, on ? '1' : '0'); } catch (e) {} }
export const tradeTagsOn = () => tradeOn;
export function drawingTagOn(d) { return !d.style || d.style.axisTag !== false; }

// ---- drawings -> tags ---------------------------------------------------------------------------------------------------------
function drawingTags(cell, R) {
  const out = []; let all = [];
  try { all = cell.chart.drawings.all(); } catch (e) { return out; }
  const ud = R.userDrawings;
  let sel = []; try { sel = ud && ud.selectedIds ? [...ud.selectedIds] : []; } catch (e) {}
  const hov = ud ? ud.hoveredId : null;
  for (const d of all) {
    if (!d || d.visible === false || (d.paneId && d.paneId !== 'price') || NO_PRICE.has(d.type) || !drawingTagOn(d)) continue;
    // OWNER ADDITION 2 (25 Nov): the Position tool's entry / target / stop are tagged like a horizontal line (always, while in view)
    const line = LINES.has(d.type) || d.type === 'position', on = line || sel.includes(d.id) || d.id === hov;
    if (!on) continue;
    const col = solid(d.style && (d.style.lineColor || d.style.borderColor || d.style.color), '#2962ff');
    if (d.type === 'position' && typeof d.prices === 'function') {
      const p = d.prices(); if (!p) continue;
      out.push({ price: p.entry, color: '#5d6b85', kind: 'entry' }, { price: p.stop, color: solid(d.lossColor, '#f23645'), kind: 'sl' }, { price: p.target, color: solid(d.profitColor, '#089981'), kind: 'tp' });
    } else if (Array.isArray(d.levels) && typeof d.levelPrice === 'function' && d.anchors.length >= 2) {
      if (d.showPrices === false) continue;
      for (const lv of d.levels) if (lv.enabled) out.push({ price: d.levelPrice(lv.ratio, d.anchors[0].price, d.anchors[1].price), color: solid(lv.color, col) });
    } else {
      const seen = new Set();
      for (const a of d.anchors || []) if (Number.isFinite(a.price) && !seen.has(a.price)) { seen.add(a.price); out.push({ price: a.price, color: col }); }
    }
  }
  return out;
}

// ---- layout: push apart, keep inside the pane, stay clear of the last-price tag ------------------------------------------------
export function layout(items, top, bot, reserved) {
  const bs = items.map((it) => ({ it, y: it.y, t: it.y - H / 2 })).sort((a, b) => a.y - b.y);
  const hit = (t, list) => list.find((r) => t < r.b + (r.gap || 0) && t + H > r.t - (r.gap || 0));
  const placed = [];
  for (const b of bs) {
    let t = Math.max(top, Math.min(b.t, bot - H));
    for (let k = 0; k < 40; k++) {
      const r = hit(t, reserved), p = hit(t, placed);
      if (r) t = (b.y < (r.t + r.b) / 2 && r.t - H - GAP >= top) ? r.t - H - GAP : r.b + GAP;
      else if (p) t = p.b + GAP;
      else break;
    }
    b.t = t; placed.push({ t, b: t + H, gap: 0, ref: b });
  }
  // overflow at the bottom: walk back up, packing against the pane edge (and the reserved last-price box)
  let limit = bot;
  for (let i = bs.length - 1; i >= 0; i--) {
    const b = bs[i];
    if (b.t + H > limit) b.t = limit - H;
    const r = hit(b.t, reserved); if (r && r.t - H - GAP >= top) b.t = r.t - H - GAP;
    limit = b.t - GAP;
  }
  return bs.map((b) => ({ it: b.it, t: b.t }));
}

function paint(cell, R) {
  const s = stateOf(R); if (!s) return;
  const sc = R.scene, pane = sc && sc.panes && sc.panes.get('price'), co = R.coords;
  const c = s.canvas, g = c.getContext('2d');
  if (!pane || !co || pane.collapsed || !R.plot.clientWidth) { if (s.sig) { g.clearRect(0, 0, c.width, c.height); s.sig = ''; s.boxes = []; } return; }
  const dpr = co.dpr || 1, pw = R.plot.clientWidth, ph = R.plot.clientHeight, W = co.width, axW = pw - W;
  const top = pane.bounds.top, bot = top + pane.bounds.height;
  const dec = (() => { try { const mt = sc.priceMintick || 0.01; return mt >= 0.01 ? 2 : Math.min(8, Math.ceil(-Math.log10(mt) - 1e-9)); } catch (e) { return 2; } })();   // the axis shows 2 decimals down to a 0.01 tick
  const fmt = (p) => p.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const src = [];
  if (tradeOn) for (const l of s.tags.get('trade') || []) src.push(l);
  for (const [k, list] of s.tags) if (k !== 'trade') for (const l of list) src.push(l);
  for (const l of drawingTags(cell, R)) src.push(l);
  const items = [];
  for (const l of src) {
    if (!Number.isFinite(l.price)) continue;
    const y = co.priceToY(l.price, pane.scale, pane.bounds);
    if (!(y >= top && y <= bot)) continue;
    const color = solid(l.color, '#787b86');
    items.push({ y, color, text: l.text || fmt(l.price), fade: l.fade > 0 && l.fade < 1 ? l.fade : 0, kind: l.kind || '' });
    if (items.length >= MAXTAGS) break;
  }
  // the last-price tag (and its countdown under it) keeps its place: nothing is painted over it
  const reserved = [];
  const n = sc.bars ? sc.bars.length : 0;
  if (n && !sc.candlesHidden && (sc.showPriceLabel || sc.showCountdown)) {
    const ly = co.priceToY(sc.bars[n - 1].close, pane.scale, pane.bounds);
    if (ly >= top && ly <= bot) reserved.push({ t: ly - 8, b: ly - 8 + (sc.showPriceLabel && sc.showCountdown ? 32 : 16), gap: GAP });
  }
  const sig = [pw, ph, dpr, axW, top, bot, reserved.map((r) => r.t).join()].join('|') + '#' + items.map((i) => Math.round(i.y * 2) + i.color + i.text + (i.fade || '')).join(',');
  if (sig === s.sig) return;
  s.sig = sig;
  const bw = Math.round(pw * dpr), bh = Math.round(ph * dpr);
  if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }
  c.style.width = pw + 'px'; c.style.height = ph + 'px';
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  s.boxes = [];
  if (axW < 20 || !items.length) return;
  g.font = FONT; g.textBaseline = 'middle'; g.textAlign = 'center';
  // the scale widens when a tag needs it: Vela's gutter is fixed, so a long price is squeezed to fit (never clipped, never over the plot)
  for (const { it, t } of layout(items, top, bot, reserved)) {
    let fs = 11; g.font = FONT;
    const room = axW - 8, w = g.measureText(it.text).width;
    if (w > room) { fs = Math.max(8, Math.floor(11 * room / w)); g.font = FONT.replace('11px', fs + 'px'); }
    // a filled, slightly rounded tag (like a horizontal line's); a working order's tag is its side colour at lower opacity
    g.globalAlpha = it.fade || 1; g.fillStyle = it.color; g.beginPath(); if (g.roundRect) g.roundRect(W + 1, t, axW - 2, H, 2); else g.rect(W + 1, t, axW - 2, H); g.fill(); g.globalAlpha = 1;
    g.fillStyle = ink(it.color); g.fillText(it.text, W + axW / 2, t + H / 2 + 0.5);
    s.boxes.push({ y: it.y, top: t, color: it.color, text: it.text, x: W + 1, w: axW - 2, h: H, fade: it.fade, kind: it.kind });
  }
}

// test + popover hook: what the cell paints now
export function boxes(R) { const s = states.get(R); return s ? s.boxes.slice() : []; }

// ---- settings: "Price label on scale" row in a drawing's settings window --------------------------------------------------------
function addRow(dlg) {
  const pane = dlg.querySelector('.stk-dsp-pane[data-pane="style"]') || dlg.querySelector('.stk-dsp-pane');
  if (!pane || pane.querySelector('.stk-axt-row')) return;
  let cell = null, d = null;
  for (const c of cellsOf()) { const R = rendererOf(c), ud = R && R.userDrawings; const id = ud && ud.selectedIds && [...ud.selectedIds][0]; if (id) { try { d = c.chart.drawings.all().find((x) => x.id === id); } catch (e) {} if (d) { cell = c; break; } } }
  if (!d || NO_PRICE.has(d.type)) return;
  // same look as the other Vela settings checkboxes (.stk-dsp-cb), 16 px side padding like the fold bodies
  const row = document.createElement('label'); row.className = 'stk-axt-row stk-dsp-cb';
  row.style.cssText = 'flex:none;min-height:32px;padding:8px 16px;box-sizing:border-box;width:100%';
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = drawingTagOn(d);
  cb.setAttribute('aria-label', 'Price label on scale');
  cb.onchange = () => { try { cell.chart.drawings.update(d.id, { style: Object.assign({}, d.style, { axisTag: cb.checked }) }); } catch (e) { console.warn('TradeZoro axis tags: setting', e); } };
  row.append(cb, document.createTextNode('Price label on scale'));
  pane.append(row);
}
function watchDialogs() {
  let q = 0;
  new MutationObserver(() => { if (q) return; q = requestAnimationFrame(() => { q = 0; for (const dlg of document.querySelectorAll('.vela-dsp')) { try { addRow(dlg); } catch (e) {} } }); })
    .observe(document.body, { childList: true, subtree: true });
}

export function mountAxisTags(ws) {
  WS = ws; if (started) return; started = true;
  window.__stkAxisTags = { setTags, setTradeTags, get tradeTagsOn() { return tradeOn; }, boxes, layout, rendererOf, cellsOf };
  const tick = () => {
    if (!document.hidden) for (const cell of cellsOf()) { const R = rendererOf(cell); if (R) { try { paint(cell, R); } catch (e) { console.warn('TradeZoro axis tags', e); } } }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  watchDialogs();
}
