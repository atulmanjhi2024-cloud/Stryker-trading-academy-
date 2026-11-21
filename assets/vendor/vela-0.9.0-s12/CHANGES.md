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
