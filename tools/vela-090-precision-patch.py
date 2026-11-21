#!/usr/bin/env python3
"""s14: the OHLC readout and Fibonacci price labels use the symbol's price precision (EURUSD shows 5 decimals).

  cp -r assets/vendor/vela-0.9.0-s13 assets/vendor/vela-0.9.0-s14; python3 tools/vela-090-precision-patch.py assets/vendor/vela-0.9.0-s14

Port of upstream commit 660bacc (0.10.14, PR #418 "Use symbol precision for chart price labels"):
https://github.com/LuxAlgo/Vela/commit/660bacc505940c1f21e5013b55af1fb0f243c8c1
Our 0.9.0 build already hands the symbol's tick size to the renderer (scene.priceMintick, used by the price axis and
the crosshair chip). The legend's OHLC readout used a price-size guess instead (>= 1 -> 2 decimals: EURUSD 1.05),
and Fib retracement / extension labels were fixed at 2 decimals. Both now read the tick size: decimals of the tick
(0.00001 -> 5, 0.25 -> 2, 0.01 -> 2), falling back to the old rule when the tick is unknown or a whole number.
"""
import sys, os
D = sys.argv[1]


def patch(fname, pairs):
    p = os.path.join(D, fname)
    s = open(p, encoding='utf-8').read()
    for old, new in pairs:
        n = s.count(old)
        if n != 1: sys.exit(f'{fname}: anchor found {n}x: {old[:80]!r}')
        s = s.replace(old, new)
    open(p, 'w', encoding='utf-8').write(s)


TICK_DEC = '''function stkTickDecimals(tick) {
  if (!(tick > 0) || !Number.isFinite(tick)) return void 0;
  for (let d = 0; d <= 8; d += 1) if (Math.abs(Number(tick.toFixed(d)) - tick) <= tick * 1e-6) return d || void 0;
  return 8;
}
'''

# Statusline (legend OHLC readout): the bound chart's tick size, read live (it lands after the first bars).
patch('chunk-4WAHYL7Y.js', [
    ('function decimalsFor(ref) {\n',
     '// TradeZoro patch (s14, upstream 660bacc): decimals of a tick size (0.25 -> 2, 0.00001 -> 5); undefined = unknown / whole.\n'
     + TICK_DEC + 'function decimalsFor(ref) {\n'),
    ('''    this.lastBar = null;
    this.hoverBar = null;
    this.unsubs.push(
      chart.on("bar", (b) => {''', '''    this.lastBar = null;
    this.hoverBar = null;
    this.stkChart = chart;
    this.unsubs.push(
      chart.on("bar", (b) => {'''),
    ('''    if (!bar) return this.readout;
    const dp = decimalsFor(bar.close);''', '''    if (!bar) return this.readout;
    const dp = this.stkDecimals() ?? decimalsFor(bar.close);'''),
    ('''    const dp = decimalsFor(bar.close);
    const doc = this.el.ownerDocument;''', '''    const dp = this.stkDecimals() ?? decimalsFor(bar.close);
    const doc = this.el.ownerDocument;'''),
    ('''  /** Write the value readout for the current bar at the current ladder level. */
  renderValues() {''', '''  /** The bound chart's price decimals from its symbol's tick size (TradeZoro patch s14). */
  stkDecimals() {
    try {
      return stkTickDecimals(this.stkChart?.renderer?.renderer?.scene?.priceMintick);
    } catch {
      return void 0;
    }
  }
  /** Write the value readout for the current bar at the current ladder level. */
  renderValues() {'''),
])

# Projector: the price pane's decimals for drawings.
patch('chunk-XIRSR3D6.js', [
    ('function createProjector(coords, paneOf, paneIdAtY, barsInRange, seriesInRange) {',
     'function createProjector(coords, paneOf, paneIdAtY, barsInRange, seriesInRange, priceDecimals) {'),
    ('''    seriesInRange,
    width: coords.width,
    height: coords.height
  };
}''', '''    seriesInRange,
    priceDecimals,
    width: coords.width,
    height: coords.height
  };
}'''),
    ('''      this.userDrawings?.seriesGateway ? (tf, from, to) => this.userDrawings.seriesGateway.seriesInRange(tf, from, to) : void 0
    );''', '''      this.userDrawings?.seriesGateway ? (tf, from, to) => this.userDrawings.seriesGateway.seriesInRange(tf, from, to) : void 0,
      // TradeZoro patch (s14, upstream 660bacc): price labels of drawings on the price pane follow the tick size.
      (paneId) => paneId === PRICE_PANE_ID && this.scene.priceMintick ? tickDecimals(this.scene.priceMintick) || 2 : void 0
    );'''),
])

# Fib retracement / extension labels.
patch('chunk-YRCL3WMD.js', [
    ('''    const lines = this.levelLines(proj);
    if (!lines) return null;
    const right = this.labelSide === "right";''', '''    const lines = this.levelLines(proj);
    if (!lines) return null;
    const right = this.labelSide === "right";
    const decimals = proj.priceDecimals?.(this.paneId) ?? 2;'''),
    ('numberText: this.levelText(l.ratio, l.price),', 'numberText: this.levelText(l.ratio, l.price, decimals),'),
    ('''  levelText(ratio, price) {
    const p = price.toFixed(2);''', '''  levelText(ratio, price, decimals = 2) {
    const p = price.toFixed(decimals);'''),
    ('''    const x2 = Math.max(...xs);
    const out = [];
    for (const lv of this.levels) {''', '''    const x2 = Math.max(...xs);
    const decimals = proj.priceDecimals?.(this.paneId) ?? 2;
    const out = [];
    for (const lv of this.levels) {'''),
    ('numberText: `${lv.ratio} (${price.toFixed(2)})`,', 'numberText: `${lv.ratio} (${price.toFixed(decimals)})`,'),
])

open(os.path.join(D, 'CHANGES.md'), 'a').write(
    '\nThen tools/vela-090-precision-patch.py (s14: the legend OHLC readout and Fib retracement / extension price labels use '
    "the symbol's tick size (EURUSD 5 decimals); port of upstream 0.10.14 "
    'https://github.com/LuxAlgo/Vela/commit/660bacc505940c1f21e5013b55af1fb0f243c8c1, PR #418).\n')
print('ok')
