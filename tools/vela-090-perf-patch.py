#!/usr/bin/env python3
"""s12: line joints, caps and circle-plot dots read their rim from a cached unit circle (faster pan/zoom with many lines).

  cp -r assets/vendor/vela-0.9.0-s11 assets/vendor/vela-0.9.0-s12; python3 tools/vela-090-perf-patch.py assets/vendor/vela-0.9.0-s12

Port of upstream commit 6b70e0e (0.10.9, "perf(renderer): look up the unit circle for joint fans"):
https://github.com/LuxAlgo/Vela/commit/6b70e0edd71c129ae29448d5d8725cd1cdf64b95
The WebGL batch drew every line joint as a triangle fan and called Math.cos/Math.sin for each rim point of
each fan. The rim is now computed once per segment count (Float64, so every vertex is the same number as
before: the picture is pixel-identical).
"""
import sys, os
D = sys.argv[1]
C = 'chunk-XIRSR3D6.js'
p = os.path.join(D, C)
s = open(p, encoding='utf-8').read()


def edit(old, new):
    global s
    n = s.count(old)
    if n != 1: sys.exit(f'{C}: anchor found {n}x: {old[:80]!r}')
    s = s.replace(old, new)


edit('var AA_PAD = 1;\n', '''var AA_PAD = 1;
// TradeZoro patch (s12, upstream 6b70e0e): [cos, sin] of rim step i of `segments` at (i - 1) * 2, per fan size.
var UNIT_RIMS = /* @__PURE__ */ new Map();
function unitRim(segments) {
  let rim = UNIT_RIMS.get(segments);
  if (!rim) {
    const steps = Math.max(0, Math.floor(segments));
    rim = new Float64Array(steps * 2);
    for (let i = 1; i <= steps; i += 1) {
      const a = i / segments * Math.PI * 2;
      rim[(i - 1) * 2] = Math.cos(a);
      rim[(i - 1) * 2 + 1] = Math.sin(a);
    }
    UNIT_RIMS.set(segments, rim);
  }
  return rim;
}
''')
edit('''    const ext = r + AA_PAD;
    let px = cx + ext;
    let py = cy;
    this.ensure(segments * 3);
    for (let i = 1; i <= segments; i += 1) {
      const a = i / segments * Math.PI * 2;
      const nx = cx + Math.cos(a) * ext;
      const ny = cy + Math.sin(a) * ext;
''', '''    const ext = r + AA_PAD;
    const rim = unitRim(segments);
    let px = cx + ext;
    let py = cy;
    this.ensure(segments * 3);
    for (let i = 0; i < rim.length; i += 2) {
      const nx = cx + rim[i] * ext;
      const ny = cy + rim[i + 1] * ext;
''')
open(p, 'w', encoding='utf-8').write(s)
open(os.path.join(D, 'CHANGES.md'), 'a').write(
    '\nThen tools/vela-090-perf-patch.py (s12: line joints / caps / circle dots use a cached unit circle; port of upstream 0.10.9 '
    'https://github.com/LuxAlgo/Vela/commit/6b70e0edd71c129ae29448d5d8725cd1cdf64b95, pixel-identical, faster pan/zoom with many line plots).\n')
print('ok')
