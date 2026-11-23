#!/usr/bin/env python3
"""s17 part 2: drawing Copy / Paste / Copy price / Copy text (beta request 22 Nov).

  run after tools/vela-090-textalign-patch.py on the same folder:
  python3 tools/vela-090-clipboard-patch.py assets/vendor/vela-0.9.0-s17

- The drawings clipboard is shared by every chart on the page (it was one per chart), so a drawing copied on
  one chart pastes on another chart or timeframe of the symbol at the same price and time.
- Ctrl/Cmd+C / Ctrl/Cmd+V keep working as before (built in); paste keeps the same price/time.
- Right-click a drawing: Copy, Paste, Copy price (the anchor price nearest the click, at the symbol's
  tick decimals), Copy text (drawings with words). Right-click the chart: Paste, at the clicked spot.
"""
import sys, os
D = sys.argv[1]
C, W = 'chunk-XIRSR3D6.js', 'chunk-4WAHYL7Y.js'


def apply(f, pairs):
    p = os.path.join(D, f)
    s = open(p, encoding='utf-8').read()
    for old, new in pairs:
        n = s.count(old)
        if n != 1: sys.exit(f'{f}: anchor found {n}x: {old[:90]!r}')
        s = s.replace(old, new)
    open(p, 'w', encoding='utf-8').write(s)


apply(C, [
    ('''  copy(ids) {
    const docs = this.resolve(ids).map((d) => clonePlain(d.serialize()));
    if (docs.length) this.clipboard = docs;
  }
  paste() {
    if (!this.enabled || this.clipboard.length === 0) return [];
    return this.insertClones(this.clipboard);
  }''', '''  copy(ids) {
    const docs = this.resolve(ids).map((d) => clonePlain(d.serialize()));
    if (docs.length) this.clipboard = globalThis.__stkDrawClip = docs;   // TradeZoro patch (clipboard): shared by every chart on the page
  }
  /** TradeZoro patch (clipboard): `at` = { time, price, paneId? } moves the copy so its first point lands there. */
  paste(at) {
    const clip = globalThis.__stkDrawClip || this.clipboard;
    if (!this.enabled || clip.length === 0) return [];
    const a0 = at && Number.isFinite(at.time) && Number.isFinite(at.price) ? clip[0].anchors?.[0] : null;
    const dt = a0 ? at.time - a0.time : 0, dp = a0 ? at.price - a0.price : 0;
    return this.insertClones(clip.map((doc) => {
      const c = clonePlain(doc);
      if (a0) {
        c.anchors = (c.anchors || []).map((p) => ({ time: p.time + dt, price: p.price + dp }));
        if (at.paneId) c.paneId = at.paneId;
      }
      return c;
    }));
  }'''),
    ('''  paste() {
    if (this.ok("paste")) this.ctrl.paste();
    return this;
  }''', '''  paste(at) {
    if (this.ok("paste")) this.ctrl.paste(at);
    return this;
  }
  /** TradeZoro patch (clipboard): whether a Paste has something to paste. */
  canPaste() {
    return (globalThis.__stkDrawClip || this.ctrl.clipboard || []).length > 0;
  }'''),
])

apply(W, [
    ('''        if (hit) {
          this.stkDrawingId = hit.id;
          items = [{ id: "stk-drawing-lock", label: hit.locked ? "Unlock drawing" : "Lock drawing", icon: hit.locked ? "unlock" : "lock" }, ...items.map((it, i) => i === 0 ? { ...it, separatorBefore: true } : it)];
        }''', '''        const canPaste = this.chart.drawings.supported && this.chart.drawings.canPaste?.();
        if (hit) {
          this.stkDrawingId = hit.id;
          // TradeZoro patch (clipboard): Copy / Paste / Copy price / Copy text on a drawing
          this.stkPriceAt = e.clientY - r.top;
          const words = hit.text && hit.text.value && hit.schema?.().fields.some((f) => f.path === "text.value");
          const clip = [
            { id: "stk-drawing-copy", label: "Copy", icon: "clone", hint: navigator.platform?.startsWith("Mac") ? "\\u2318C" : "Ctrl+C", separatorBefore: true },
            { id: "stk-drawing-paste", label: "Paste", hint: navigator.platform?.startsWith("Mac") ? "\\u2318V" : "Ctrl+V", disabled: !canPaste },
            ...hit.anchors?.length ? [{ id: "stk-drawing-copy-price", label: "Copy price" }] : [],
            ...words ? [{ id: "stk-drawing-copy-text", label: "Copy text" }] : []
          ];
          items = [{ id: "stk-drawing-lock", label: hit.locked ? "Unlock drawing" : "Lock drawing", icon: hit.locked ? "unlock" : "lock" }, ...clip, ...items.map((it, i) => i === 0 ? { ...it, separatorBefore: true } : it)];
        } else if (this.lastZone === "body" && this.chart.drawings.supported) {
          // TradeZoro patch (clipboard): Paste on the chart, at the clicked spot
          items = [{ id: "stk-drawing-paste-here", label: "Paste", icon: "clone", hint: navigator.platform?.startsWith("Mac") ? "\\u2318V" : "Ctrl+V", disabled: !canPaste }, ...items.map((it, i) => i === 0 ? { ...it, separatorBefore: true } : it)];
        }'''),
    ('''    if (id === "stk-drawing-lock") {''', '''    if (id.startsWith("stk-drawing-") && id !== "stk-drawing-lock") {
      // TradeZoro patch (clipboard)
      const did = this.stkDrawingId, d = did && chart.drawings.all().find((x) => x.id === did);
      const put = (s) => stkCopyText(s, this.host);
      if (id === "stk-drawing-copy" && d) chart.drawings.copyToClipboard([did]);
      else if (id === "stk-drawing-paste") chart.drawings.paste();
      else if (id === "stk-drawing-paste-here") {
        const pt = this.pointer;
        chart.drawings.paste(pt && Number.isFinite(pt.time) && Number.isFinite(pt.price) ? { time: pt.time, price: pt.price, paneId: pt.paneId || void 0 } : void 0);
      } else if (id === "stk-drawing-copy-text" && d && d.text?.value) put(d.text.value);
      else if (id === "stk-drawing-copy-price" && d && d.anchors?.length) {
        const rr = chart.renderer.renderer, proj = rr.userDrawings?.deps.projector();
        let a = d.anchors[0];
        if (proj && this.stkPriceAt != null) {
          let best = Infinity;
          for (const p of d.anchors) { const y = proj.yOf(p.price, d.paneId); const dy = y == null ? Infinity : Math.abs(y - this.stkPriceAt); if (dy < best) { best = dy; a = p; } }
        }
        put(stkPriceText(a.price, rr.scene?.priceMintick));
      }
      return;
    }
    if (id === "stk-drawing-lock") {'''),
    ('''var ChartContextMenu = class {''', '''// TradeZoro patch (clipboard): price at the symbol's tick decimals (0.25 -> 2, 0.00001 -> 5; unknown -> 2).
function stkPriceText(price, tick) {
  let d = 2;
  if (tick > 0 && Number.isFinite(tick)) for (d = 0; d < 8 && Math.abs(Number(tick.toFixed(d)) - tick) > tick * 1e-6; d += 1) ;
  return Number(price).toFixed(d);
}
function stkCopyText(s, host) {
  const done = () => { try { window.showToast?.("success", "Copied " + (s.length > 40 ? s.slice(0, 40) + "\\u2026" : s)); } catch (e) {} };
  const old = () => {
    const ta = document.createElement("textarea");
    ta.value = s; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    (host?.ownerDocument?.body || document.body).appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch (e) {}
    ta.remove();
  };
  try { navigator.clipboard?.writeText ? navigator.clipboard.writeText(s).then(done, old) : old(); } catch (e) { old(); }
}
globalThis.__stkPriceText = stkPriceText;
var ChartContextMenu = class {'''),
])
print('clipboard patch: ok')
