// TradeZoro — "Zoom to selection" chart tool (member request: NinjaTrader-style selected zoom).
// Drag a box over the active chart; on release a chooser offers Same timeframe or a lower one;
// the chart then shows the selected time range edge to edge on that timeframe. A "Back" pill
// returns to the range and timeframe from before. Esc cancels. Mouse, pen and touch (pointer events).
// Started from the drawing column's zoom menu (chart-tv-toolbars.js), Alt+Z, or the phone button.
// Chart reads only: coords.xToLogical / logicalToTime on Vela's renderer, then setVisibleRange.

const TFS = [['1', '1m'], ['5', '5m'], ['15', '15m'], ['30', '30m'], ['60', '1h'], ['240', '4h'], ['D', '1D']];
const MIN_PX = 12;          // a drag shorter than this is a tap, not a selection
const tfLabel = (tf) => { const m = TFS.find((t) => t[0] === String(tf)); return m ? m[1] : String(tf); };

export function mountSelZoom(ws, opts){
  opts = opts || {};
  const toast = opts.toast || (() => {});
  const cellOf = () => { try { return ws.cell(ws.active.id); } catch (e) { return null; } };
  const coordsOf = (cell) => { try { return cell.chart.renderer.renderer.coords; } catch (e) { return null; } };
  const plotRect = (cell) => {
    const cv = cell.host && cell.host.querySelector('canvas');
    const co = coordsOf(cell);
    if (!cv || !co) return null;
    const r = cv.getBoundingClientRect();
    return { left: r.left, top: r.top, width: Math.min(r.width, co.width), height: Math.min(r.height, co.height) };
  };
  const el = (cls, tag) => { const n = document.createElement(tag || 'div'); n.className = cls; return n; };

  let ov = null, box = null, hint = null, chooser = null, backPill = null, watch = 0, idle = 0, guard = 0;
  const touch = () => window.matchMedia('(pointer:coarse)').matches || window.innerWidth <= 640;
  const stack = [];          // { id, symbol, tf, range }

  function clear(){
    [ov, chooser].forEach((n) => n && n.remove());
    ov = box = hint = chooser = null;
    clearTimeout(idle); clearInterval(guard); idle = guard = 0;
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('visibilitychange', onHide);
    placeBtn();
  }
  // any press outside the overlay/chooser (toolbar, another tool, menu) cancels
  function onOutside(e){ if (!(ov && ov.contains(e.target)) && !(chooser && chooser.contains(e.target))) clear(); }
  function onHide(){ if (document.hidden) clear(); }
  function onKey(e){
    if (e.key === 'Escape' && (ov || chooser)) { e.stopPropagation(); e.preventDefault(); clear(); }
  }

  function start(){
    const cell = cellOf();
    const pr = cell && plotRect(cell);
    if (!pr) { toast('Open a chart first.', 'info'); return; }
    clear();
    ov = el('stkz-ov');
    Object.assign(ov.style, { left: pr.left + 'px', top: pr.top + 'px', width: pr.width + 'px', height: pr.height + 'px' });
    hint = el('stkz-hint');
    const ht = el('stkz-ht', 'span');
    ht.textContent = touch() ? 'Drag over the area to zoom in' : 'Drag over the area to zoom into. Esc cancels.';
    const hx = el('stkz-hx', 'button');
    hx.type = 'button'; hx.textContent = '✕'; hx.setAttribute('aria-label', 'Cancel');
    hx.addEventListener('pointerdown', (e) => e.stopPropagation());
    hx.addEventListener('click', (e) => { e.stopPropagation(); clear(); });
    hint.append(ht, hx);
    ov.appendChild(hint);
    ov.setAttribute('role', 'application');
    ov.setAttribute('aria-label', 'Zoom to selection: drag over the chart');
    let x0 = 0, y0 = 0, down = false;
    const local = (e) => ({ x: Math.max(0, Math.min(pr.width, e.clientX - pr.left)), y: Math.max(0, Math.min(pr.height, e.clientY - pr.top)) });
    ov.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      if (e.target.closest && e.target.closest('.stkz-hint')) return;
      e.preventDefault();
      clearTimeout(idle);
      try { ov.setPointerCapture(e.pointerId); } catch (err) {}
      ({ x: x0, y: y0 } = local(e)); down = true;
      if (chooser) { chooser.remove(); chooser = null; }
      if (box) box.remove();
      box = el('stkz-box'); ov.appendChild(box); hint.hidden = true;
    });
    ov.addEventListener('pointermove', (e) => {
      if (!down || !box) return;
      const p = local(e);
      Object.assign(box.style, { left: Math.min(x0, p.x) + 'px', top: Math.min(y0, p.y) + 'px', width: Math.abs(p.x - x0) + 'px', height: Math.abs(p.y - y0) + 'px' });
    });
    const end = (e) => {
      if (!down) return;
      down = false;
      const p = local(e);
      const xa = Math.min(x0, p.x), xb = Math.max(x0, p.x);
      if (xb - xa < MIN_PX) { clear(); return; }
      choose(cell, pr, xa, xb);
    };
    ov.addEventListener('pointerup', end);
    ov.addEventListener('pointercancel', () => { down = false; });
    document.body.appendChild(ov);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('visibilitychange', onHide);
    const sym0 = cell.symbol, tf0 = String(cell.timeframe), lay0 = (ws.context && ws.context().cells || []).length;
    guard = setInterval(() => {
      const c = cellOf();
      if (!c || c.symbol !== sym0 || String(c.timeframe) !== tf0 || (ws.context && ws.context().cells || []).length !== lay0) clear();
    }, 300);
    idle = setTimeout(clear, 20000);
  }

  // selected plot-x span -> bar times (clamped to the loaded bars)
  function timeSpan(cell, xa, xb){
    const co = coordsOf(cell);
    const last = co.barCount - 1;
    const lg = (x) => Math.max(0, Math.min(last, Math.round(co.xToLogical(x))));
    const a = lg(xa), b = lg(xb);
    return { from: co.logicalToTime(a), to: co.logicalToTime(Math.max(a, b)) };
  }

  function choose(cell, pr, xa, xb){
    clearTimeout(idle); idle = 0;
    const span = timeSpan(cell, xa, xb);
    const cur = String(cell.timeframe);
    chooser = el('stkz-choose');
    chooser.setAttribute('role', 'group');
    chooser.setAttribute('aria-label', 'Zoom to selection: timeframe');
    const mk = (label, tf, same) => {
      const b = el('stkz-opt' + (same ? ' stkz-opt-same' : ''), 'button');
      b.type = 'button'; b.textContent = label; b.dataset.tf = tf;
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => { e.stopPropagation(); apply(cell, span, tf); });
      chooser.appendChild(b);
    };
    mk('Same (' + tfLabel(cur) + ')', cur, true);
    TFS.forEach(([tf, l]) => { if (tf !== cur) mk(l, tf, false); });
    const x = el('stkz-opt stkz-x', 'button');
    x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', 'Cancel');
    x.addEventListener('pointerdown', (e) => e.stopPropagation());
    x.addEventListener('click', (e) => { e.stopPropagation(); clear(); });
    chooser.appendChild(x);
    chooser.style.visibility = 'hidden';
    document.body.appendChild(chooser);
    // under the box, flipped above when no room, clamped inside the viewport
    const cw = chooser.offsetWidth, ch = chooser.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    const bx = pr.left + xa, bw = xb - xa;
    const by = box ? box.getBoundingClientRect() : { top: pr.top, bottom: pr.top + 40 };
    let left = Math.max(8, Math.min(vw - cw - 8, bx + bw / 2 - cw / 2));
    let top = by.bottom + 8;
    if (top + ch > vh - 8) top = Math.max(8, by.top - ch - 8);
    Object.assign(chooser.style, { left: left + 'px', top: top + 'px', visibility: '' });
    document.addEventListener('keydown', onKey, true);
  }

  // switch timeframe (if needed), wait for the new bars, then fit the range
  function goTo(cell, tf, range, done){
    const co = () => coordsOf(cell);
    const fit = () => { try { cell.chart.setVisibleRange(range); } catch (e) { console.warn('TradeZoro: selected zoom', e); } };
    if (String(cell.timeframe) === String(tf)) { fit(); setTimeout(fit, 350); done && done(); return; }
    try { if (cell === cellOf() && ws.setActiveTimeframe) ws.setActiveTimeframe(tf); else cell.setTimeframe(tf); } catch (e) { toast('Could not switch timeframe.', 'info'); return; }
    const t0 = Date.now();
    const iv = setInterval(() => {
      const c = co();
      const ready = String(cell.timeframe) === String(tf) && c && c.barCount > 1 && c.barInterval && Math.abs(c.times[0] - c.times[1]) < 864e5 * 8;
      if (ready && Date.now() - t0 > 250) { clearInterval(iv); fit(); setTimeout(fit, 400); done && done(); }
      else if (Date.now() - t0 > 12000) { clearInterval(iv); fit(); done && done(); }
    }, 120);
  }

  function apply(cell, span, tf){
    const prevRange = (() => { try { return cell.chart.getVisibleRange(); } catch (e) { return null; } })();
    stack.push({ id: cell.id, symbol: cell.symbol, tf: String(cell.timeframe), range: prevRange });
    clear();
    goTo(cell, tf, span, showBack);
  }

  // ---------------------------------------------------------------- Back pill
  function dropBack(){ if (backPill) { backPill.remove(); backPill = null; } clearInterval(watch); watch = 0; }
  function showBack(){
    const top = stack[stack.length - 1];
    if (!top) return dropBack();
    const cell = ws.cell(top.id);
    const pr = cell && plotRect(cell);
    if (!pr) return;
    if (!backPill) {
      backPill = el('stkz-back', 'button');
      backPill.type = 'button';
      backPill.addEventListener('click', back);
      document.body.appendChild(backPill);
    }
    backPill.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg><span>Back to ' + tfLabel(top.tf) + '</span>';
    backPill.setAttribute('aria-label', 'Back to previous zoom (' + tfLabel(top.tf) + ')');
    const w = backPill.offsetWidth;
    Object.assign(backPill.style, { left: Math.round(pr.left + pr.width / 2 - w / 2) + 'px', top: Math.round(pr.top + pr.height - backPill.offsetHeight - 36) + 'px' });
    clearInterval(watch);
    // a different symbol makes the saved range meaningless: drop it
    watch = setInterval(() => {
      const t = stack[stack.length - 1], c = t && ws.cell(t.id);
      if (!c || c.symbol !== t.symbol) { stack.length = 0; dropBack(); } else showBack();
    }, 1000);
  }
  function back(){
    const top = stack.pop();
    if (!top) return dropBack();
    const cell = ws.cell(top.id);
    if (!cell || cell.symbol !== top.symbol) { stack.length = 0; return dropBack(); }
    goTo(cell, top.tf, top.range || undefined, () => { if (stack.length) showBack(); else dropBack(); });
    if (!stack.length) dropBack();
  }

  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'z' || e.key === 'Z' || e.code === 'KeyZ')) {
      const t = e.target;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || (t && t.isContentEditable)) return;
      e.preventDefault(); start();
    }
  });
  window.addEventListener('resize', () => { if (backPill) showBack(); placeBtn(); });

  // Phone has no drawing column: a small button at the chart's top-right starts it (hidden above 640px).
  let pb = null;
  function placeBtn(){
    const phone = window.innerWidth <= 640;
    const cell = phone && cellOf(), pr = cell && plotRect(cell);
    if (!pr) { if (pb) pb.hidden = true; return; }
    if (!pb) {
      pb = el('stkz-pb', 'button');
      pb.type = 'button'; pb.title = pb.ariaLabel = 'Zoom to selection';
      pb.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3"/><path d="M10 14l4-4M11 10h3v3"/></svg>';
      pb.addEventListener('click', () => { if (ov) clear(); else { start(); placeBtn(); } });
      document.body.appendChild(pb);
    }
    pb.hidden = false;
    Object.assign(pb.style, { left: Math.round(pr.left + pr.width - 48) + 'px', top: Math.round(pr.top + 8) + 'px' });
    pb.classList.toggle('on', !!ov);
  }
  setInterval(placeBtn, 1500);

  return { start, cancel: clear, back, get stackSize(){ return stack.length; } };
}
