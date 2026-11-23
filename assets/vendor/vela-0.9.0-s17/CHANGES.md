# vela-0.9.0-s4

Upstream @luxalgo/vela 0.9.0 dist (ESM), patched by tools/vela-090-patch.py then tools/vela-090-dsp-patch.py.
The folder suffix changes whenever patched files change: /assets/* is cached for a year.
Then tools/vela-090-handles-patch.py (8 box handles, TradingView handle look, resize/move cursors, blue box default).
Then tools/vela-090-position-patch.py (TradingView Long/Short Position tool).

Then tools/vela-090-ctypes-patch.py (s5: a chart type transform with derive:true rebuilds the view on every bar and gets its settings).

Then tools/vela-090-scale-patch.py (s6: "Scale price chart only" - candles-only price auto-scale, saved as priceScale.scalePriceOnly).

Then tools/vela-090-mem-patch.py (s7: renderer-layer canvases hold pixels only while the layer has an owner or data; legend status dots update in place; phone memory).

Then tools/vela-090-lock-patch.py (s9: locked drawings stay selectable, no handles, padlock).

Then tools/vela-090-hit-patch.py (s10: Anchored VWAP / profile / regression channel hit only their lines and bars, not the whole range; right-click a drawing: Lock / Unlock).

Then tools/vela-090-anchor-patch.py (s11: a drawings-only Pine script keeps its bar_index drawings on their bars when the chart head is trimmed).

Then tools/vela-090-perf-patch.py (s12: line joints / caps / circle dots use a cached unit circle; port of upstream 0.10.9 https://github.com/LuxAlgo/Vela/commit/6b70e0edd71c129ae29448d5d8725cd1cdf64b95, pixel-identical, faster pan/zoom with many line plots).

Then tools/vela-090-maxmem-patch.py (s13: maximizing one chart of a split layout takes the others out of the layout instead of drawing them full size underneath; iPhone tab crash; port of upstream 0.10.14 https://github.com/LuxAlgo/Vela/commit/91590d05c37a330879b5edb1d81753e98d5b2e52).

Then tools/vela-090-precision-patch.py (s14: the legend OHLC readout and Fib retracement / extension price labels use the symbol's tick size (EURUSD 5 decimals); port of upstream 0.10.14 https://github.com/LuxAlgo/Vela/commit/660bacc505940c1f21e5013b55af1fb0f243c8c1, PR #418).

Then tools/vela-090-freepan-patch.py (s15: "Free pan" switch under Scales and lines > Price scale, off by default; a plain mouse drag moves time and price together; saved as priceScale.freePan; port of upstream 0.10.6 https://github.com/LuxAlgo/Vela/commit/b03694c41efa7cd927c7ec667b79acb02b47552c, PR #381, plain-drag trigger only).

Then tools/vela-090-drawlink-patch.py (s16: synced drawings stay linked after a reload, relinked from content, port of upstream 0.10.6 https://github.com/LuxAlgo/Vela/commit/3deb7fc1492dd12fbda0ffaf30127fda70b79895 (PR #374); chart.drawings.fromJSON emits drawing:replaced, which saves the workspace and refreshes the object tree, from upstream 0.10.9 https://github.com/LuxAlgo/Vela/commit/9c81806 and https://github.com/LuxAlgo/Vela/commit/60010a1).

Then tools/vela-090-textalign-patch.py (s17: Text alignment on Horizontal Ray and Vertical Line; old drawings keep their label spot).

Then tools/vela-090-clipboard-patch.py (s17: drawing Copy / Paste shared across charts, Paste at the clicked spot, Copy price, Copy text in the right-click menus).
