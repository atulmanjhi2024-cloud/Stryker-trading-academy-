// TradeZoro — Charts: indicator errors are never shown to members as raw developer text (ES module, no deps).
// Owner bug 22 Nov: red toasts "[A] Cannot read properties of undefined (reading 'openTime')" kept stacking
// on the apps. Vela's workspace toasts every indicator:error as "[<cell>] <error.message>" (vendor
// chunk-4WAHYL7Y.js wireCell). That toast is dropped here (filter on the toast host, no vendor change) and
// each error is:
//   1. logged to the console with the indicator, cell, symbol and timeframe (no error-report endpoint exists);
//   2. counted per indicator; only an indicator that KEEPS failing (FAIL_LIMIT errors within FAIL_WINDOW_MS)
//      gets ONE friendly toast per session: "<name> couldn't load on this chart. We've been notified."
// A one-off error during a symbol/timeframe switch or a reconnect stays silent (the engine retries itself).
// window.__stkIndErrors exposes the log for tests (tools/tests/chart-indicator-errors-browser.js).

export const FAIL_LIMIT = 3;
export const FAIL_WINDOW_MS = 60000;
const CELL_TOAST = /^\[[A-Za-z0-9_-]{1,12}\] /;   // Vela's "[<cell id>] <message>" indicator:error toast

// True for the raw indicator:error toast Vela shows (kind 'error', cell-id prefix).
export function isRawIndicatorToast(message, kind){ return kind === 'error' && CELL_TOAST.test(String(message || '')); }

// Pure counter: returns true exactly once per key, when it has failed FAIL_LIMIT times inside FAIL_WINDOW_MS.
export function createFailTracker(limit = FAIL_LIMIT, windowMs = FAIL_WINDOW_MS){
  const hits = new Map(), told = new Set();
  return (key, now = Date.now()) => {
    if (told.has(key)) return false;
    const xs = (hits.get(key) || []).filter((t) => now - t < windowMs);
    xs.push(now); hits.set(key, xs);
    if (xs.length < limit) return false;
    told.add(key); hits.delete(key);
    return true;
  };
}

export const friendlyText = (name) => `${name || 'This indicator'} couldn't load on this chart. We've been notified.`;

// ws: the Vela workspace. toast(kind, text): the site toast. nameOf(handle): display name (Pine title etc).
export function installIndicatorErrors(ws, toast, nameOf){
  const log = [];
  const shouldTell = createFailTracker();
  const wired = new WeakSet();
  const st = (window.__stkIndErrors = { log, count: () => log.length, toasts: [] });
  const onErr = (cell, chart) => ({ id, error }) => {
    let h = null, name = '';
    try { h = chart.indicators().find((x) => x.id === id) || null; } catch (e) {}
    try { name = (nameOf && h && nameOf(h)) || (h && h.title) || ''; } catch (e) {}
    const msg = String((error && error.message) || error || '');
    const rec = { t: Date.now(), cell: cell.id, id, type: (h && h.nativeType) || 'script', name, message: msg,
      symbol: String(cell.symbol || ''), timeframe: String(cell.timeframe || ''), stack: String((error && error.stack) || '').split('\n').slice(0, 6).join('\n') };
    log.push(rec); if (log.length > 200) log.shift();
    console.warn('[TradeZoro] indicator error', rec);
    // Key by what the member added (type + name), not the instance id: a switch re-creates the session.
    if (shouldTell(rec.type + '|' + (name || id))) { const text = friendlyText(name); st.toasts.push(text); try { toast('warning', text); } catch (e) {} }
  };
  const wire = (cell) => {
    const chart = cell && cell.chart;
    if (!chart || wired.has(chart)) return;
    wired.add(chart);
    try { chart.on('indicator:error', onErr(cell, chart)); } catch (e) {}
  };
  try { ws.cells().forEach(wire); } catch (e) {}
  try { ws.on('cell:created', ({ id }) => wire(ws.cell(id))); } catch (e) {}
  return st;
}
