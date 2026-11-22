// TradeZoro Desktop 2.0: preload for the app's own UI document (src/app/index.html). Sandboxed, isolated world.
// The UI gets window.tzApp only; main (src/main.js) accepts these messages only from that exact document.
const { contextBridge, ipcRenderer } = require('electron');

const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const listen = (ch) => (cb) => { if (typeof cb === 'function') ipcRenderer.on(ch, (e, v) => { try { cb(v); } catch (x) { console.warn(x); } }); };

contextBridge.exposeInMainWorld('tzApp', {
  info: () => ipcRenderer.invoke('tz:info'),
  win: (a) => ipcRenderer.send('tz:win-action', str(a, 8)),
  onWin: listen('tz:win'),
  onShown: listen('tz:shown'),
  onGoto: listen('tz:goto'),
  onPalette: listen('tz:palette'),
  // embedded ZoroCharts view: the UI reports where the chart area is; main lays the real chart page over it
  chartBounds: (b) => ipcRenderer.send('tz:chart-bounds', { x: +b.x, y: +b.y, width: +b.width, height: +b.height }),
  chartShow: (v) => ipcRenderer.send('tz:chart-show', !!v),
  chartSymbol: (id) => ipcRenderer.send('tz:chart-symbol', str(id, 60)),
  chartReload: () => ipcRenderer.send('tz:chart-reload'),
  onChart: listen('tz:chart'),
  popOut: () => ipcRenderer.send('tz:popout'),
  newChartWindow: () => ipcRenderer.send('tz:new-chart-window'),
  theme: (t) => ipcRenderer.send('tz:theme', t === 'day' ? 'day' : 'night'),
  open: (url) => ipcRenderer.send('tz:open', str(url, 500)),
  notify: (n) => ipcRenderer.send('tz:notify', { id: str(n && n.id, 200), title: str(n && n.title, 120), body: str(n && n.body, 400), screen: str(n && n.screen, 20) }),
  tray: (list) => ipcRenderer.send('tz:tray', Array.isArray(list) ? list.slice(0, 6) : []),
  prefs: (p) => ipcRenderer.send('tz:prefs', p && typeof p === 'object' ? { trayPrices: p.trayPrices, notify: p.notify, hotkey: p.hotkey } : {}),
  startAtLogin: (v) => ipcRenderer.send('tz:login', !!v),
  // Google sign-in in the system browser -> { token } (Firebase custom token) or Error('cancelled'|'timeout'|'failed'|'no-browser')
  googleSignIn: () => ipcRenderer.invoke('tz:google').then((r) => ({ token: String(r && r.token || '') }),
    (e) => { const m = /cancelled|timeout|no-browser/.exec(String(e && e.message)); throw new Error(m ? m[0] : 'failed'); }),
  cancelGoogleSignIn: () => ipcRenderer.send('tz:google-cancel'),
  updateState: () => ipcRenderer.invoke('tz:update-state'),
  updateAction: (a) => ipcRenderer.send('tz:update-action', str(a, 10)),
  checkUpdates: () => ipcRenderer.send('tz:check-updates'),
  barState: (st) => ipcRenderer.send('tz:bar-state', st && typeof st === 'object' ? { user: st.user || null, screen: str(st.screen, 20), signin: !!st.signin } : {}),
  onBarAct: listen('tz:bar-act'),
  onUpdate: listen('tz:update'),
  onUpdateCheck: listen('tz:update-check'),
  quit: () => ipcRenderer.send('tz:quit')
});
