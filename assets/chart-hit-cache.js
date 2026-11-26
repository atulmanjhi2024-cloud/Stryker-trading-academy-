// TradeZoro — Charts: one shared canvas lookup for the mouse-move hit-tests of news / events / wallet / off-exchange markers
// (AUTO-SCRIPTLAG2). Each used to run document.querySelectorAll('canvas[data-stk-...]') on every mouse move; now the list per
// attribute is cached for 400 ms (a canvas added later is hit-testable within 400 ms) and dropped when a canvas leaves the page.
// rectOf() also shares one getBoundingClientRect per canvas per mouse event between the handlers.
const lists = new Map(), rects = new WeakMap();
export function canvasesOf(attr) {
  const now = performance.now(), c = lists.get(attr);
  if (c && now - c.t < 400 && c.list.every((cv) => cv.isConnected)) return c.list;
  const list = Array.from(document.querySelectorAll('canvas[' + attr + ']'));
  lists.set(attr, { t: now, list });
  return list;
}
export function rectOf(cv, e) {
  const c = rects.get(cv), ts = e && e.timeStamp;
  if (c && ts !== undefined && c.ts === ts) return c.r;
  const r = cv.getBoundingClientRect(); rects.set(cv, { ts, r });
  return r;
}
