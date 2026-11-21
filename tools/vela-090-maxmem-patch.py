#!/usr/bin/env python3
"""s13: maximizing one chart of a split layout takes the other charts out of the layout (iPhone tab crash).

  cp -r assets/vendor/vela-0.9.0-s12 assets/vendor/vela-0.9.0-s13; python3 tools/vela-090-maxmem-patch.py assets/vendor/vela-0.9.0-s13

Port of upstream commit 91590d0 (0.10.14, "Workspace: maximizing one chart keeps the other charts at their own size"):
https://github.com/LuxAlgo/Vela/commit/91590d05c37a330879b5edb1d81753e98d5b2e52
Before: every cell spanned the whole grid and the siblings were hidden with visibility only, so each resized its
canvases to full size (a 2x2 phone layout = 4 full-screen charts, ~96 Mpx of canvas at 3x; iOS Safari kills the tab).
Now the maximized cell alone spans the grid and the siblings get display:none; the renderer skips a 0x0 resize, so
they keep the canvases they had and restoring is instant.
"""
import sys, os
D = sys.argv[1]
W = 'chunk-4WAHYL7Y.js'
p = os.path.join(D, W)
s = open(p, encoding='utf-8').read()


def edit(old, new):
    global s
    n = s.count(old)
    if n != 1: sys.exit(f'{W}: anchor found {n}x: {old[:80]!r}')
    s = s.replace(old, new)


edit('''    return this.cells().filter((c) => c.host.style.visibility !== "hidden");''',
     '''    return this.cells().filter((c) => !this.hiddenByMaximize(c.id));''')
edit('''      if (maxId) style.gridArea = "1 / 1 / -1 / -1";
      style.zIndex = maxId && id === maxId ? "5" : "";
      style.visibility = maxId && id !== maxId ? "hidden" : "";
    }
  }
''', '''      // TradeZoro patch (s13, upstream 91590d0): siblings leave the layout instead of spanning the grid hidden.
      if (maxId === id) style.gridArea = "1 / 1 / -1 / -1";
      style.zIndex = maxId === id ? "5" : "";
      style.display = this.hiddenByMaximize(id) ? "none" : "";
    }
  }
  /** Whether a maximize has taken this cell out of the layout. */
  hiddenByMaximize(id) {
    return this.maximizedId != null && id !== this.maximizedId;
  }
''')
edit('''      if (id === excludeId || cell.host.style.visibility === "hidden") continue;''',
     '''      if (id === excludeId || this.hiddenByMaximize(id)) continue;''')
open(p, 'w', encoding='utf-8').write(s)
open(os.path.join(D, 'CHANGES.md'), 'a').write(
    '\nThen tools/vela-090-maxmem-patch.py (s13: maximizing one chart of a split layout takes the others out of the layout '
    'instead of drawing them full size underneath; iPhone tab crash; port of upstream 0.10.14 '
    'https://github.com/LuxAlgo/Vela/commit/91590d05c37a330879b5edb1d81753e98d5b2e52).\n')
print('ok')
