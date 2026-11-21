#!/usr/bin/env python3
"""s15: Free pan (drag time and price together), off by default, under chart settings > Scales and lines > Price scale.

  cp -r assets/vendor/vela-0.9.0-s14 assets/vendor/vela-0.9.0-s15; python3 tools/vela-090-freepan-patch.py assets/vendor/vela-0.9.0-s15

Port of upstream 0.10.6 https://github.com/LuxAlgo/Vela/commit/b03694c41efa7cd927c7ec667b79acb02b47552c (PR #381),
trimmed to the plain-drag trigger: with the switch on, a mouse/pen left-drag on an auto-scaled pane freezes its visible
price window into manual mode once the drag passes the slop, then moves time and price together. Clicks, touch,
modifier drags (Shift = ruler, Ctrl = marquee), middle and right clicks are unchanged. Saved in the chart config as
priceScale.freePan; a config without it (every chart saved before) reads as off.
"""
import sys, os
D = sys.argv[1]
p = os.path.join(D, 'chunk-XIRSR3D6.js')
s = open(p, encoding='utf-8').read()
PAIRS = [
    # config merge: absent = off
    ('''      scalePriceOnly: isBool(ps.scalePriceOnly) ? ps.scalePriceOnly : base.priceScale.scalePriceOnly === true,
''', '''      scalePriceOnly: isBool(ps.scalePriceOnly) ? ps.scalePriceOnly : base.priceScale.scalePriceOnly === true,
      freePan: isBool(ps.freePan) ? ps.freePan : base.priceScale.freePan === true,   // TradeZoro s15
'''),
    # input controller: field
    ('''    this.paneResize = true;
''', '''    this.paneResize = true;
    /** TradeZoro s15 (upstream b03694c): a plain mouse/pen drag on the plot unlocks manual price-pan past the slop. */
    this.freePan = false;
    this.freePending = false;
'''),
    # onDown: decide the free pan for this press
    ('''      else if (this.region === "data") this.verticalPan = this.deps.beginPricePan(y);
''', '''      else if (this.region === "data") {
        this.verticalPan = this.deps.beginPricePan(y);
        this.freePending = !this.verticalPan && this.freePan === true && e.pointerType !== "touch" && !e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey;
      }
'''),
    ('''      this.region = this.regionAt(x, y);
      this.verticalPan = false;
''', '''      this.region = this.regionAt(x, y);
      this.verticalPan = false;
      this.freePending = false;
'''),
    # onMove: unlock once past the slop
    ('''          if (Math.abs(dx) > slop) this.moved = true;
          this.deps.apply({ barSpacing: vp.barSpacing, rightOffset: this.startRightOffset - dx / coords.pxPerBar() });
''', '''          if (Math.abs(dx) > slop) this.moved = true;
          if (this.freePending && (this.moved || Math.abs(y - this.startY) > slop)) {
            this.freePending = false;
            this.moved = true;
            this.verticalPan = this.deps.beginPricePan(this.startY, true);
          }
          this.deps.apply({ barSpacing: vp.barSpacing, rightOffset: this.startRightOffset - dx / coords.pxPerBar() });
'''),
    ('''  endGesture(e) {
    this.dragging = false;
''', '''  endGesture(e) {
    this.dragging = false;
    this.freePending = false;
'''),
    # renderer: dep, beginPricePan(unlock)
    ('beginPricePan: (y) => this.beginPricePan(y),', 'beginPricePan: (y, unlock) => this.beginPricePan(y, unlock),'),
    ('''  beginPricePan(y) {
    const pane = this.paneNodeAtY(y);
    if (!pane || !pane.manualScale) return false;
''', '''  beginPricePan(y, unlock = false) {
    const pane = this.paneNodeAtY(y);
    if (!pane) return false;
    if (!pane.manualScale) {
      if (!unlock) return false;
      pane.manualScale = { ...pane.scale };   // TradeZoro s15: free pan freezes the visible window
      this.axisScaleButtons?.reposition();
      this.scheduler?.invalidate(4 /* Full */);
    }
'''),
    ('''    this.paneResizeEnabled = true;
    this.resizeAbove = null;''', '''    this.paneResizeEnabled = true;
    this.freePanOn = false;   // TradeZoro s15
    this.resizeAbove = null;'''),
    # renderer: config read / write / mount
    ('''        scalePriceOnly: this.scene.scalePriceOnly === true,
''', '''        scalePriceOnly: this.scene.scalePriceOnly === true,
        freePan: this.freePanOn === true,
'''),
    ('''    this.scene.scalePriceOnly = next.priceScale.scalePriceOnly === true;
''', '''    this.scene.scalePriceOnly = next.priceScale.scalePriceOnly === true;
    this.freePanOn = next.priceScale.freePan === true;
    if (this.input) this.input.freePan = this.freePanOn;
'''),
    ('''    this.input.paneResize = this.paneResizeEnabled;
    this.input.drawings''', '''    this.input.paneResize = this.paneResizeEnabled;
    this.input.freePan = this.freePanOn === true;
    this.input.drawings'''),
    # settings dialog row + its id
    ('''  scalePriceOnly: msg("chart.settings.scalePriceOnly", "Scale price chart only"),
''', '''  scalePriceOnly: msg("chart.settings.scalePriceOnly", "Scale price chart only"),
  freePan: msg("chart.settings.freePan", "Free pan"),
'''),
    ('''"scales.price-scale.scale-price-only"));
''', '''"scales.price-scale.scale-price-only"));
    body.append(sid(this.boolRow(TEXT6.freePan, config.priceScale.freePan === true, (v) => this.emit({ priceScale: { freePan: v } })), "scales.price-scale.free-pan"));
'''),
    ('''  "scales.price-scale.scale-price-only",
''', '''  "scales.price-scale.scale-price-only",
  "scales.price-scale.free-pan",
'''),
]
for old, new in PAIRS:
    n = s.count(old)
    if n != 1: sys.exit(f'anchor found {n}x: {old[:90]!r}')
    s = s.replace(old, new)
open(p, 'w', encoding='utf-8').write(s)
open(os.path.join(D, 'CHANGES.md'), 'a').write(
    '\nThen tools/vela-090-freepan-patch.py (s15: "Free pan" switch under Scales and lines > Price scale, off by default; '
    'a plain mouse drag moves time and price together; saved as priceScale.freePan; port of upstream 0.10.6 '
    'https://github.com/LuxAlgo/Vela/commit/b03694c41efa7cd927c7ec667b79acb02b47552c, PR #381, plain-drag trigger only).\n')
print('ok')
