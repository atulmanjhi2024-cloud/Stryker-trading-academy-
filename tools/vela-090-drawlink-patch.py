#!/usr/bin/env python3
"""s16: synced drawings stay linked after a reload; a drawings document put in place is a state change.

  cp -r assets/vendor/vela-0.9.0-s15 assets/vendor/vela-0.9.0-s16; python3 tools/vela-090-drawlink-patch.py assets/vendor/vela-0.9.0-s16

Ports (hand-applied to the bundled JS):
 - upstream 0.10.6 https://github.com/LuxAlgo/Vela/commit/3deb7fc1492dd12fbda0ffaf30127fda70b79895 (PR #374):
   the drawings link is rebuilt from content at boot, after applyState and when the link is turned on;
   a cell back from the pool adopts identical copies instead of getting duplicates. Nothing new is stored.
 - upstream 0.10.9 https://github.com/LuxAlgo/Vela/commit/9c81806 + 60010a1 (the drawing:replaced part):
   chart.drawings.fromJSON emits drawing:replaced; the workspace saves on it and the object tree refreshes.
"""
import sys, os
D = sys.argv[1]
W, C = 'chunk-4WAHYL7Y.js', 'chunk-XIRSR3D6.js'
TAG = '// TradeZoro patch (s16, upstream 3deb7fc)'

def apply(f, pairs):
    p = os.path.join(D, f)
    s = open(p, encoding='utf-8').read()
    for old, new in pairs:
        n = s.count(old)
        if n != 1: sys.exit(f'{f}: anchor found {n}x: {old[:90]!r}')
        s = s.replace(old, new)
    open(p, 'w', encoding='utf-8').write(s)

apply(W, [
    # pure helpers next to syncTargets
    ('''function rangesWithin(a, b, epsMs) {''', TAG + '''
function syncGroups(setting, cellIds) {
  const groups = [];
  const seen = /* @__PURE__ */ new Set();
  for (const id of cellIds) {
    if (seen.has(id)) continue;
    const peers = syncTargets(id, setting, cellIds);
    if (peers.length === 0) continue;
    const group = [id, ...peers];
    for (const member of group) seen.add(member);
    groups.push(group);
  }
  return groups;
}
function stkCanonicalJson(v) {
  return JSON.stringify(v, (_key, value) => {
    if (value == null || typeof value !== "object" || Array.isArray(value)) return value;
    const sorted = {};
    for (const k of Object.keys(value).sort()) sorted[k] = value[k];
    return sorted;
  });
}
function drawingLinkContent(d) {
  return stkCanonicalJson({ type: d.type, paneId: d.paneId, anchors: d.anchors, style: d.style, text: d.text, props: d.props });
}
function pairIdenticalDrawings(cells) {
  const byContent = /* @__PURE__ */ new Map();
  for (const { cellId, drawings } of cells) {
    for (const d of drawings) {
      const content = drawingLinkContent(d);
      let perCell = byContent.get(content);
      if (!perCell) byContent.set(content, perCell = /* @__PURE__ */ new Map());
      let ids = perCell.get(cellId);
      if (!ids) perCell.set(cellId, ids = []);
      ids.push(d.id);
    }
  }
  const links = [];
  for (const perCell of byContent.values()) {
    if (perCell.size < 2) continue;
    const depth = Math.max(...[...perCell.values()].map((ids) => ids.length));
    for (let k = 0; k < depth; k++) {
      const link = /* @__PURE__ */ new Map();
      for (const [cellId, ids] of perCell) if (k < ids.length) link.set(cellId, ids[k]);
      if (link.size > 1) links.push(link);
    }
  }
  return links;
}
function rangesWithin(a, b, epsMs) {'''),
    # boot
    ('''    this.buildCells();
    this.syncCellPresentation();
    this.setActiveCell(bootActive''', '''    this.buildCells();
    this.relinkIdenticalDrawings();   ''' + TAG + '''
    this.syncCellPresentation();
    this.setActiveCell(bootActive'''),
    # applyState in place
    ('''          this.cellsById.get(id)?.rehydrate(cs);
        }
      } finally {
        this.styleSyncBusy = false;
      }
''', '''          this.cellsById.get(id)?.rehydrate(cs);
        }
      } finally {
        this.styleSyncBusy = false;
      }
      this.relinkIdenticalDrawings();   ''' + TAG + '''
'''),
    # applyState rebuilt
    ('''    this.buildCells();
    this.syncCellPresentation();
    this.topbar.setLayout(this.def.id);''', '''    this.buildCells();
    this.relinkIdenticalDrawings();   ''' + TAG + '''
    this.syncCellPresentation();
    this.topbar.setLayout(this.def.id);'''),
    # link turned on
    ('''      for (const cell of this.cellsById.values()) cell.chart.drawings.setExternalGhost(null);
      this.drawToolbar?.setDrawingsSyncMode(!!setting);''', '''      for (const cell of this.cellsById.values()) cell.chart.drawings.setExternalGhost(null);
      this.relinkIdenticalDrawings();   ''' + TAG + '''
      this.drawToolbar?.setDrawingsSyncMode(!!setting);'''),
    # a cell back from the pool adopts its identical unlinked copies
    ('''          const held = new Set(drawings.all().map((d) => d.id));
          for (const doc of source.chart.drawings.all()) {''', '''          const own = drawings.all();
          const held = new Set(own.map((d) => d.id));
          const unlinked = /* @__PURE__ */ new Map();   ''' + TAG + '''
          for (const d of own) {
            if (this.drawingLinks.has(`${id}\\0${d.id}`)) continue;
            const content = drawingLinkContent(d);
            const queue = unlinked.get(content);
            if (queue) queue.push(d.id);
            else unlinked.set(content, [d.id]);
          }
          for (const doc of source.chart.drawings.all()) {'''),
    ('''              drawings.update(peerId, { anchors: doc.anchors, style: doc.style, text: doc.text, props: doc.props });
              continue;
            }
            const copy = drawings.add(doc.type, {''', '''              drawings.update(peerId, { anchors: doc.anchors, style: doc.style, text: doc.text, props: doc.props });
              continue;
            }
            const match = unlinked.get(drawingLinkContent(doc))?.shift();
            if (match != null) {
              if (peerId != null) this.drawingLinks.delete(`${id}\\0${peerId}`);
              group.set(id, match);
              for (const [cellId, dId] of group) this.drawingLinks.set(`${cellId}\\0${dId}`, group);
              continue;
            }
            const copy = drawings.add(doc.type, {'''),
    # the method
    ('''  /**
   * Mirror an origin cell's presentation — the style-link slice of its renderer''', '''  /** ''' + TAG + ''': rebuild the drawings link from content (identical drawings on charts of one
   *  link group become one linked set again); drawings already linked keep their links. */
  relinkIdenticalDrawings() {
    const setting = this.syncOpts.drawings;
    if (!setting) return;
    for (const group of syncGroups(setting, this.cells().map((c) => c.id))) {
      const cells = group.map((cellId) => ({
        cellId,
        drawings: (this.cellsById.get(cellId)?.chart.drawings.all() ?? []).filter((d) => !this.drawingLinks.has(`${cellId}\\0${d.id}`))
      }));
      for (const link of pairIdenticalDrawings(cells)) {
        for (const [cellId, dId] of link) this.drawingLinks.set(`${cellId}\\0${dId}`, link);
      }
    }
  }
  /**
   * Mirror an origin cell's presentation — the style-link slice of its renderer'''),
    # a document put in place is a state change (upstream 60010a1 / 9c81806)
    ('''    chart.on("drawing:removed", ({ id }) => {
      this.propagateDrawingRemoval(cell.id, id);
      this.markStateDirty();
    });''', '''    chart.on("drawing:removed", ({ id }) => {
      this.propagateDrawingRemoval(cell.id, id);
      this.markStateDirty();
    });
    chart.on("drawing:replaced", () => this.markStateDirty());   // TradeZoro patch (s16, upstream 60010a1)'''),
    # object tree follows a replaced document
    ('''  "drawing:edited",
  "drawing:removed"
];''', '''  "drawing:edited",
  "drawing:removed",
  "drawing:replaced"   // TradeZoro patch (s16, upstream 9c81806)
];'''),
])
apply(C, [
    ('''  fromJSON(doc) {
    this.history.clear();
    this.selectedIds = [];
    this.store.load(doc);
  }''', '''  fromJSON(doc) {
    this.history.clear();
    this.selectedIds = [];
    this.store.load(doc);
    this.events.emit("drawing:replaced", { cause: "load" });   // TradeZoro patch (s16, upstream 9c81806)
  }'''),
])
open(os.path.join(D, 'CHANGES.md'), 'a').write(
    '\nThen tools/vela-090-drawlink-patch.py (s16: synced drawings stay linked after a reload, relinked from content, port of upstream 0.10.6 '
    'https://github.com/LuxAlgo/Vela/commit/3deb7fc1492dd12fbda0ffaf30127fda70b79895 (PR #374); chart.drawings.fromJSON emits drawing:replaced, '
    'which saves the workspace and refreshes the object tree, from upstream 0.10.9 https://github.com/LuxAlgo/Vela/commit/9c81806 and '
    'https://github.com/LuxAlgo/Vela/commit/60010a1).\n')
print('ok')
