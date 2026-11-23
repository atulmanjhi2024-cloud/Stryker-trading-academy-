#!/usr/bin/env python3
"""s17 part 1: Text alignment (vertical + horizontal) on Horizontal Ray and Vertical Line (beta report 22 Nov).

  cp -r assets/vendor/vela-0.9.0-s16 assets/vendor/vela-0.9.0-s17; python3 tools/vela-090-textalign-patch.py assets/vendor/vela-0.9.0-s17

Horizontal Line already had it (dsp patch); Trend Line, Ray, Extended Line, Info Line and Trend Angle
already have it (above/middle/below x start/middle/end). A drawing saved before this keeps its exact
old label position: the new layout only applies once text.stkV or text.stkH is set.
"""
import sys, os
D = sys.argv[1]
C = 'chunk-XIRSR3D6.js'


def apply(f, pairs):
    p = os.path.join(D, f)
    s = open(p, encoding='utf-8').read()
    for old, new in pairs:
        n = s.count(old)
        if n != 1: sys.exit(f'{f}: anchor found {n}x: {old[:90]!r}')
        s = s.replace(old, new)
    open(p, 'w', encoding='utf-8').write(s)


apply(C, [
    # label position
    ('''    // above the line
    case "trendline":''', '''    case "hray": {
      // TradeZoro patch (textalign): Horizontal Ray text alignment; unset = the old spot (at the anchor, under the line).
      if (!pts[0]) return null;
      if (!text.stkV && !text.stkH) return { x: pts[0][0], top: pts[0][1], align: "left" };
      const v = text.stkV || "bottom", hz = text.stkH || "left";
      const W = proj.width ?? pts[0][0] * 2;
      const top = v === "bottom" ? pts[0][1] + 4 : v === "middle" ? pts[0][1] - lh * lines / 2 : pts[0][1] - 4 - lh * lines;
      return hz === "right" ? { x: W - 8, top, align: "right" } : hz === "center" ? { x: (pts[0][0] + W) / 2, top, align: "center" } : { x: pts[0][0] + 8, top, align: "left" };
    }
    case "vline": {
      // TradeZoro patch (textalign): Vertical Line text alignment; unset = the old spot (at the anchor).
      if (!pts[0]) return null;
      if (!text.stkV && !text.stkH) return { x: pts[0][0], top: pts[0][1], align: "left" };
      const v = text.stkV || "top", hz = text.stkH || "right";
      const rect = proj.paneRect?.(d.paneId) ?? { top: 0, height: proj.height ?? pts[0][1] * 2 };
      const top = v === "top" ? rect.top + 6 : v === "bottom" ? rect.top + rect.height - 6 - lh * lines : rect.top + rect.height / 2 - lh * lines / 2;
      return hz === "left" ? { x: pts[0][0] - 6, top, align: "right" } : hz === "center" ? { x: pts[0][0], top, align: "center" } : { x: pts[0][0] + 6, top, align: "left" };
    }
    // above the line
    case "trendline":'''),
    # Text tab: the two selects
    ('''    } else if (LINE_LABEL_TYPES.has(type)) {''', '''    } else if (type === "hray") {
      // TradeZoro patch (textalign): unset shows as Bottom / Left, which is where the old label sits.
      v = stkSelect(V, () => tx().stkV || "bottom", (x) => b.edit({ "text.stkV": x }), "Vertical");
      h = stkSelect(H, () => tx().stkH || "left", (x) => b.edit({ "text.stkH": x }), "Horizontal");
    } else if (type === "vline") {
      v = stkSelect(V, () => tx().stkV || "top", (x) => b.edit({ "text.stkV": x }), "Vertical");
      h = stkSelect(H, () => tx().stkH || "right", (x) => b.edit({ "text.stkH": x }), "Horizontal");
    } else if (LINE_LABEL_TYPES.has(type)) {'''),
])
print('textalign patch: ok')
