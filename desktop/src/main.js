// TradeZoro Desktop 2.0: main process.
//
// The app is our OWN UI (src/app: Home, Watchlist, Alerts, GEX, Market Stats, Journal, Learn, Settings, sign-in) in a
// frameless window with our own title bar. Only the chart is the website's: the real ZoroCharts page runs in a
// WebContentsView laid over the Charts screen, with the site's header, side menu, dock and cookie notice hidden, so
// trading tools and indicators keep working unchanged.
//
// Sign-in is shared without any token hand-over: the app document is a data: URL whose base is
// https://tradezoro.com/desktop-app/, so it runs in the tradezoro.com origin of the app's own session. The Firebase
// session it signs in (IndexedDB) is the one the chart page reads; a sign-in or sign-out in either shows in the other.
//
// Security: every web contents is sandboxed, contextIsolation on, nodeIntegration off. The app document gets
// src/shell-preload.js (window.tzApp) and its IPC is accepted only from that exact webContents. The chart view and
// pop-out chart windows get the site preload (src/preload.js) and the URL allowlist in src/policy.js. The app
// document never navigates; links go to the system browser.
const { app, BrowserWindow, WebContentsView, Menu, Tray, Notification, shell, ipcMain, screen, session, dialog, nativeImage, net, protocol, globalShortcut, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { pathToFileURL } = require('url');
const policy = require('./policy');
const handoff = require('./handoff');
const State = require('./state');
const Updates = require('./updates');
const reportShown = require('./shown');
const Assets = require('./assets');

const ORIGIN = 'https://tradezoro.com';
const CHART = ORIGIN + '/charts.html';
const SHELL_BASE = ORIGIN + '/desktop-app/';
const ICON = path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const IS_MAC = process.platform === 'darwin';
// Tests only (test/app-smoke.js): sample data instead of the network for the native screens. Never in a packaged app.
const STUB = process.env.TZ_DESKTOP_STUB === '1' && !app.isPackaged;

protocol.registerSchemesAsPrivileged([{ scheme: 'tzapp', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.setAppUserModelId('com.tradezoro.desktop');   // Windows toasts show "TradeZoro" and the TZ icon
// Google refuses sign-in from user agents that say "Electron"; present as the Chromium it is.
app.userAgentFallback = app.userAgentFallback.replace(/\s(TradeZoro|tradezoro-desktop|Electron)\/\S+/gi, '');

// `TradeZoro --version` prints the app version and exits (CI smoke test on every OS).
if (process.argv.includes('--version')) { process.stdout.write(app.getVersion() + '\n'); app.exit(0); }
// AppImage on Ubuntu 24.04+ cannot start Chromium's sandbox (AppArmor), so run without it there. The .deb keeps it.
if (process.platform === 'linux' && process.env.APPIMAGE) app.commandLine.appendSwitch('no-sandbox');
if (!app.requestSingleInstanceLock()) { app.quit(); }

// tradezoro://auth?code=... brings a Google sign-in back from the browser when the loopback port could not be used.
// '--' before the URL: Chromium stops reading switches there, so a crafted link cannot inject command-line flags.
if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient(handoff.PROTOCOL, process.execPath, [path.resolve(process.argv[1]), '--']);
else app.setAsDefaultProtocolClient(handoff.PROTOCOL, process.execPath, ['--']);

let state, tray = null, mainWin = null, chartView = null, quitting = false, updateReady = false, trayHintShown = false;
let updManifest = null, updReadyVer = null, updDismissed = null, updAvailVer = null;   // update banner (src/updates.js)
let chartBounds = null, chartVisible = false, trayQuotes = [], hotkey = null, chartTheme = 'night';
const charts = new Map();            // key -> BrowserWindow (pop-out chart windows)
const seenNotes = new Set();

// ---------- the site chart, without the site around it ----------
// The chart page's own toolbar stays; the website header pieces, side menu, phone dock, cookie notice and skip link go.
const CHART_CSS = [
  '.mobile-topnav .menu-toggle-btn,.mobile-topnav .brand,.mobile-topnav .topnav-right,.sidebar,.sidebar-backdrop,',
  '.tzc,.appnav-dock,.appnav-pills,.skip-link{display:none!important}',
  'body{padding-bottom:0!important}'
].join('');
// The embedded chart (Owner 22 Nov): the site's top row IS the window's one bar. Its hamburger, logo and right-hand icons
// go; the app's bar pieces (src/app/bar.js: logo, search, "...", profile picture, window controls) are added to it; the
// empty parts drag the window. Order: logo, workspace tabs, search, Trade/account, balance, market status, ..., avatar.
const EMBED_CSS = CHART_CSS + [
  'html.tzd body.charts-page .mobile-topnav{display:flex!important;position:relative;height:48px!important;padding:0 0 0 8px!important;gap:8px;-webkit-app-region:drag;flex-wrap:nowrap}',
  'html.tzd-darwin body.charts-page .mobile-topnav{padding-left:80px!important}',
  'html.tzd #dash-menu-toggle,html.tzd .mobile-topnav .brand,html.tzd .mobile-topnav .topnav-right,html.tzd #stkcmp-menu{display:none!important}',
  'html.tzd .mobile-topnav *{-webkit-app-region:no-drag}',
  'html.tzd .mobile-topnav .topnav-left{order:-2;flex:1 1 auto;min-width:0;margin:0!important;padding:0!important;gap:8px;-webkit-app-region:drag}',
  'html.tzd .mobile-topnav .stkws-strip,html.tzd .mobile-topnav .stkws-tabs,html.tzd .mobile-topnav .stkws-tabrow{-webkit-app-region:drag}',
  'html.tzd .mobile-topnav .stkws-tabs{margin-left:0}',
  'html.tzd #tzd-logo{order:-3;width:32px;justify-content:center;-webkit-app-region:drag}',
  'html.tzd #tzd-search{order:-1}',
  'html.tzd .mobile-topnav > .stkc-menu.stktm-hdr{margin:0!important}',
  'html.tzd .mobile-topnav > .mclock{margin:0!important;min-width:0!important}',
  // one height for every control in the bar (32px), the site's pills are 34
  'html.tzd .stktm-hdr > #stkc-paper-btn.stktm-btn,html.tzd .mobile-topnav .mclock-pill{height:32px!important}',
  'html.tzd .mobile-topnav > .stkas{margin:0!important}html.tzd .mobile-topnav .stkas-b{height:32px!important}',
  'html.tzd #tzd-end{order:9}',
  // hidden behind another screen: no drag region left over the app's own bar
  'html.tzd-off body.charts-page .mobile-topnav,html.tzd-off .mobile-topnav *{-webkit-app-region:no-drag!important}'
].join('');
const BAR_JS = fs.readFileSync(path.join(__dirname, 'app', 'bar.js'), 'utf8');
const ICONS = ['zorocharts', 'omega', 'market-stats', 'nemesis', 'mentis'];
function dataUrl(f) { return 'data:image/webp;base64,' + fs.readFileSync(path.join(__dirname, 'app', 'img', f)).toString('base64'); }
let barInit = null;   // built once: images go in as data: URLs (the site page cannot load tzapp://)
function barInitJson() {
  if (!barInit) barInit = { platform: process.platform, logo: dataUrl('tzmark.webp'), icons: Object.fromEntries(ICONS.map((n) => [n, dataUrl(n + '-64.webp')])) };
  return JSON.stringify(Object.assign({}, barInit, { state: barStateFull() }));
}
let barState = {};
function barStateFull() { return Object.assign({}, barState, { maximized: !!mainWin && !mainWin.isDestroyed() && mainWin.isMaximized() }); }
function pushBarState() { if (chartView) chartView.webContents.send('tz:bar-state', barStateFull()); }
function themeJs(t) { return `try{localStorage.setItem('stryker_theme',${JSON.stringify(t)});window.setStrykerTheme&&window.setStrykerTheme(${JSON.stringify(t)})}catch(e){}`; }

function webPrefs(withPreload, extra) {
  return Object.assign({
    contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
    allowRunningInsecureContent: false, webviewTag: false, spellcheck: false,
    backgroundThrottling: false,     // charts keep streaming while the window is behind another one
    preload: withPreload ? path.join(__dirname, 'preload.js') : undefined
  }, extra || {});
}
function dressChart(wc, embedded) {
  wc.on('dom-ready', () => {
    wc.insertCSS(embedded ? EMBED_CSS : CHART_CSS).catch(() => {});
    wc.executeJavaScript(themeJs(chartTheme), true).catch(() => {});
    // 999 = the preload's isolated world: the bar runs there next to its bridge (src/preload.js), out of the page's reach
    if (embedded) wc.executeJavaScriptInIsolatedWorld(999, [{ code: BAR_JS + '\n;TZBar.mountChart(globalThis.__tzdBar, ' + barInitJson() + ');' }]).catch(() => {});
  });
}

// ---------- window bounds ----------
function restoreBounds(key, def) {
  const s = state.get(key);
  if (s && State.visibleOn(s.bounds, screen.getAllDisplays())) return s;
  return Object.assign({}, s || {}, { bounds: def });
}
function remember(win, key) {
  const save = () => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    state.set(key, { maximized: win.isMaximized(), bounds: win.isMaximized() ? (state.get(key) || {}).bounds || win.getNormalBounds() : win.getBounds() });
  };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) win.on(ev, save);
}

// ---------- main window (our own UI) ----------
function shellHtml() {
  const html = fs.readFileSync(path.join(Assets.ROOT, 'index.html'), 'utf8')
    .replace(/%PLATFORM%/g, process.platform).replace(/%VERSION%/g, app.getVersion()).replace(/%STUB%/g, STUB ? '1' : '0');
  return 'data:text/html;charset=utf-8;base64,' + Buffer.from(html).toString('base64');
}
function createMain() {
  const wa = screen.getPrimaryDisplay().workArea;
  const s = restoreBounds('main', { width: Math.min(1440, wa.width), height: Math.min(900, wa.height) });
  mainWin = new BrowserWindow(Object.assign({}, s.bounds, {
    minWidth: 960, minHeight: 600, backgroundColor: '#000000', icon: ICON, show: false, title: 'TradeZoro',
    frame: false, titleBarStyle: IS_MAC ? 'hiddenInset' : 'hidden', trafficLightPosition: IS_MAC ? { x: 16, y: 18 } : undefined,
    webPreferences: webPrefs(false, { preload: path.join(__dirname, 'shell-preload.js'), backgroundThrottling: true })
  }));
  if (s.maximized) mainWin.maximize();
  mainWin.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) mainWin.show(); });
  remember(mainWin, 'main');
  const wc = mainWin.webContents;
  wc.on('will-navigate', (e, url) => { e.preventDefault(); openExternal(url); });
  wc.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  wc.on('will-attach-webview', (e) => e.preventDefault());
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'focus', 'blur']) mainWin.on(ev, () => { send('tz:win', winState()); pushBarState(); });
  for (const ev of ['show', 'hide', 'minimize', 'restore']) mainWin.on(ev, () => { send('tz:shown', mainWin.isVisible() && !mainWin.isMinimized()); syncChartShown(); });
  mainWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault(); mainWin.hide();
    if (!trayHintShown && Notification.isSupported()) {
      trayHintShown = true;
      new Notification({ title: 'TradeZoro is still running', body: 'Alerts keep coming. Open or quit it from the ' + (IS_MAC ? 'menu bar' : 'tray') + ' icon.', icon: ICON, silent: true }).show();
    }
  });
  mainWin.loadURL(shellHtml(), { baseURLForDataURL: SHELL_BASE });
}
function winState() { return { maximized: !!mainWin && mainWin.isMaximized(), fullscreen: !!mainWin && mainWin.isFullScreen(), focused: !!mainWin && mainWin.isFocused() }; }
function send(ch, v) { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(ch, v); }
function fromShell(e) { return !!mainWin && !mainWin.isDestroyed() && e.sender === mainWin.webContents && e.senderFrame === mainWin.webContents.mainFrame; }
function fromSite(e) { return !!e.senderFrame && e.senderFrame === e.sender.mainFrame && policy.isAppUrl(e.senderFrame.url); }

function showMain() {
  if (!mainWin || mainWin.isDestroyed()) createMain();
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show(); mainWin.focus();
}
function toggleMain() {
  if (mainWin && !mainWin.isDestroyed() && mainWin.isVisible() && mainWin.isFocused() && !mainWin.isMinimized()) mainWin.hide();
  else showMain();
}

// ---------- the embedded chart (WebContentsView inside the main window) ----------
function ensureChart(url) {
  if (chartView) return chartView;
  chartView = new WebContentsView({ webPreferences: webPrefs(true, { additionalArguments: ['--tz-embedded-chart'] }) });
  chartView.setBackgroundColor(chartTheme === 'day' ? '#ffffff' : '#000000');
  mainWin.contentView.addChildView(chartView);
  chartView.setVisible(false);
  const wc = chartView.webContents;
  guard(wc, false);
  dressChart(wc, true);
  wc.on('did-finish-load', () => send('tz:chart', { loaded: true }));
  wc.on('did-fail-load', (e, code, desc, u, isMain) => { if (isMain && code !== -3) send('tz:chart', { loaded: false, error: desc }); });
  wc.loadURL(url || CHART);
  return chartView;
}
function layoutChart() {
  if (!chartView) return;
  const on = chartVisible && !!chartBounds && chartBounds.width > 0 && chartBounds.height > 0;
  if (on) chartView.setBounds(chartBounds);
  chartView.setVisible(on);
  chartView.webContents.executeJavaScript(`document.documentElement.classList.toggle('tzd-off', ${!on})`, true).catch(() => {});
  syncChartShown();
}
function syncChartShown() {
  if (!chartView) return;
  chartView.webContents.send('tz:shown', chartVisible && !!mainWin && mainWin.isVisible() && !mainWin.isMinimized());
}
const SYM_RE = /^[A-Za-z_]+:[A-Za-z0-9!._\-/]+$/;
function chartUrl(id) { return CHART + (id && SYM_RE.test(id) ? '?symbol=' + encodeURIComponent(id) : ''); }
function chartSymbol(id) {
  const s = String(id || '').slice(0, 60);
  if (!SYM_RE.test(s)) return;
  if (!chartView) { ensureChart(chartUrl(s)); return; }
  chartView.webContents.loadURL(chartUrl(s));
}

// ---------- pop-out chart windows (multi-window) ----------
function nextChartKey() { for (let i = 1; ; i++) if (!charts.has('chart-' + i)) return 'chart-' + i; }
function openChartWindow(url, key) {
  url = policy.isAppUrl(url) && isChartPath(url) ? url : CHART;
  key = key || nextChartKey();
  const wa = screen.getPrimaryDisplay().workArea, n = charts.size;
  const s = restoreBounds(key, { width: Math.min(1280, wa.width), height: Math.min(800, wa.height), x: wa.x + 60 + n * 32, y: wa.y + 60 + n * 32 });
  const win = new BrowserWindow(Object.assign({}, s.bounds, { minWidth: 480, minHeight: 360, backgroundColor: '#000000', icon: ICON, show: false,
    autoHideMenuBar: true, title: 'ZoroCharts · TradeZoro', webPreferences: webPrefs(true) }));
  win.tzKey = key;
  if (s.maximized) win.maximize();
  if (s.onTop) win.setAlwaysOnTop(true, 'floating');
  win.once('ready-to-show', () => win.show());
  remember(win, key);
  win.on('page-title-updated', (e) => { e.preventDefault(); win.setTitle('ZoroCharts · TradeZoro' + (win.isAlwaysOnTop() ? '  (on top)' : '')); });
  guard(win.webContents, false);
  dressChart(win.webContents);
  reportShown(win);
  charts.set(key, win);
  const saveOpen = () => state.setOpenCharts([...charts].map(([k, w]) => ({ key: k, url: w.isDestroyed() ? CHART : w.webContents.getURL() })));
  win.webContents.on('did-navigate', saveOpen); win.webContents.on('did-navigate-in-page', saveOpen);
  win.on('closed', () => { charts.delete(key); if (!quitting) saveOpen(); });
  win.loadURL(url);
  saveOpen();
  return win;
}
function popOutChart() {
  const u = chartView ? chartView.webContents.getURL() : CHART;
  return openChartWindow(u);
}
function toggleOnTop(win) {
  if (!win || win.isDestroyed() || win === mainWin) return;
  const on = !win.isAlwaysOnTop();
  win.setAlwaysOnTop(on, 'floating');
  win.setTitle('ZoroCharts · TradeZoro' + (on ? '  (on top)' : ''));
  state.set(win.tzKey, { onTop: on });
  buildMenu();
}

// ---------- navigation guard (chart view + chart windows) ----------
function openExternal(url) {
  const c = policy.classify(url);
  if (c === 'external' || c === 'app') shell.openExternal(url).catch(() => {});
}
function isChartPath(url) { try { return /^\/charts(\.html)?$/.test(new URL(url).pathname); } catch (e) { return false; } }
function guard(wc, isPopup) {
  const allowed = isPopup ? policy.mayNavigatePopup : policy.mayNavigateAppWindow;
  // No website pages inside the app: a chart surface stays on the chart; other site pages open in the browser.
  const onNav = (e, url) => {
    if (allowed(url) && (isPopup || policy.classify(url) !== 'app' || isChartPath(url))) return;
    e.preventDefault(); openExternal(url);
  };
  wc.on('will-navigate', onNav);
  wc.on('will-redirect', (e, url, inPlace, isMainFrame) => { if (isMainFrame !== false) onNav(e, url); });
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.on('did-create-window', (child) => { child.setMenuBarVisibility(false); guard(child.webContents, true); });
  wc.setWindowOpenHandler(({ url }) => {
    const kind = policy.classify(url);
    if (kind === 'app' && !isPopup) { if (isChartPath(url)) openChartWindow(url); else openExternal(url); return { action: 'deny' }; }
    if (kind === 'popup' || kind === 'oauth' || (kind === 'app' && isPopup)) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 680, backgroundColor: '#ffffff', icon: ICON, autoHideMenuBar: true, webPreferences: webPrefs(false) } };
    }
    openExternal(url);
    return { action: 'deny' };
  });
}

// ---------- IPC from the app document ----------
const on = (ch, fn) => ipcMain.on(ch, (e, ...a) => { if (fromShell(e)) fn(...a); });
const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => { if (!fromShell(e)) throw new Error('not allowed'); return fn(e, ...a); });

on('tz:win-action', (a) => {
  if (!mainWin) return;
  if (a === 'min') mainWin.minimize();
  else if (a === 'max') { if (mainWin.isMaximized()) mainWin.unmaximize(); else mainWin.maximize(); }
  else if (a === 'close') mainWin.close();
});
handle('tz:info', () => ({ platform: process.platform, version: app.getVersion(), stub: STUB, win: winState(), prefs: prefs(),
  login: loginSupported() ? app.getLoginItemSettings().openAtLogin : null, hotkeyOk: !!hotkey, dark: nativeTheme.shouldUseDarkColors }));
on('tz:chart-bounds', (b) => {
  if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) return;
  chartBounds = { x: Math.round(b.x), y: Math.round(b.y), width: Math.max(0, Math.round(b.width)), height: Math.max(0, Math.round(b.height)) };
  layoutChart();
});
on('tz:chart-show', (v) => { chartVisible = !!v; if (chartVisible) ensureChart(); layoutChart(); if (chartVisible && chartView) chartView.webContents.focus(); });
on('tz:chart-symbol', (id) => chartSymbol(id));
on('tz:chart-reload', () => { if (chartView) chartView.webContents.reload(); });
on('tz:new-chart-window', () => openChartWindow(CHART));
on('tz:theme', (t) => {
  chartTheme = t === 'day' ? 'day' : 'night';
  if (mainWin) mainWin.setBackgroundColor(chartTheme === 'day' ? '#f5f5f7' : '#000000');
  const js = themeJs(chartTheme);
  if (chartView) { chartView.setBackgroundColor(chartTheme === 'day' ? '#ffffff' : '#000000'); chartView.webContents.executeJavaScript(js, true).catch(() => {}); }
  for (const w of charts.values()) if (!w.isDestroyed()) w.webContents.executeJavaScript(js, true).catch(() => {});
});
on('tz:open', (url) => { try { const u = new URL(String(url), ORIGIN); if (u.protocol === 'https:') openExternal(u.href); } catch (e) { /* ignore */ } });
on('tz:tray', (list) => {
  trayQuotes = Array.isArray(list) ? list.slice(0, 6).map((q) => ({ t: String(q && q.t || '').slice(0, 12), last: String(q && q.last || '').slice(0, 20), pct: String(q && q.pct || '').slice(0, 10) })) : [];
  buildTray();
});
on('tz:prefs', (p) => {
  if (!p || typeof p !== 'object') return;
  const cur = prefs();
  if (typeof p.trayPrices === 'boolean') cur.trayPrices = p.trayPrices;
  if (typeof p.notify === 'boolean') cur.notify = p.notify;
  if (typeof p.hotkey === 'string' && HOTKEYS.includes(p.hotkey)) cur.hotkey = p.hotkey;
  state.set('prefs', cur);
  registerHotkey(); buildTray();
});
on('tz:login', (v) => { if (loginSupported()) app.setLoginItemSettings({ openAtLogin: !!v, args: ['--hidden'] }); });
on('tz:check-updates', () => checkUpdates(true));
// the bar's state (signed-in user, current screen) for the copy of the bar inside the chart
on('tz:bar-state', (s) => {
  if (!s || typeof s !== 'object') return;
  const u = s.user && typeof s.user === 'object' ? { name: String(s.user.name || '').slice(0, 80), email: String(s.user.email || '').slice(0, 120),
    photo: /^https:\/\//.test(String(s.user.photo || '')) ? String(s.user.photo).slice(0, 500) : '', plan: String(s.user.plan || '').slice(0, 24) } : null;
  barState = { user: u, screen: String(s.screen || '').slice(0, 20), signin: !!s.signin };
  pushBarState();
});
// a click in the chart's copy of the bar: the app document does the work (same handler as its own bar)
const BAR_ACTS = new Set(['go', 'palette', 'signin', 'signout', 'check-updates', 'new-window', 'popout', 'reload', 'win']);
ipcMain.on('tz:bar', (e, a, arg) => {
  if (!chartView || e.sender !== chartView.webContents || !fromSite(e) || !BAR_ACTS.has(a)) return;
  if (a === 'palette') mainWin.webContents.focus();
  send('tz:bar-act', { a, arg: String(arg == null ? '' : arg).slice(0, 80) });
});
on('tz:quit', () => quit());

// From the app document AND site pages (chart view, pop-out windows: src/preload.js)
ipcMain.on('tz:notify', (e, n) => {
  if (!(fromShell(e) || fromSite(e)) || !Notification.isSupported() || !n || !n.id || seenNotes.has(n.id) || prefs().notify === false) return;
  seenNotes.add(String(n.id).slice(0, 200));
  const note = new Notification({ title: String(n.title || 'TradeZoro').slice(0, 120), body: String(n.body || '').slice(0, 400), icon: ICON });
  note.on('click', () => { showMain(); send('tz:goto', n.screen === 'home' ? 'home' : 'alerts'); });
  note.show();
});
ipcMain.on('tz:popout', (e) => { if (fromShell(e) || fromSite(e)) popOutChart(); });
ipcMain.on('tz:ontop', (e) => { if (fromSite(e)) toggleOnTop(BrowserWindow.fromWebContents(e.sender)); });
ipcMain.handle('tz:update-state', (e) => (fromShell(e) || fromSite(e) ? updateState() : null));
ipcMain.on('tz:update-action', (e, a) => { if (fromShell(e) || fromSite(e)) updateAction(a); });

function loginSupported() { return process.platform === 'win32' || IS_MAC; }
const HOTKEYS = ['CommandOrControl+Shift+Space', 'CommandOrControl+Alt+T', 'Alt+Shift+Z', 'off'];
function prefs() { return Object.assign({ trayPrices: true, notify: true, hotkey: HOTKEYS[0] }, (state && state.get('prefs')) || {}); }
function registerHotkey() {
  if (hotkey) { globalShortcut.unregister(hotkey); hotkey = null; }
  const k = prefs().hotkey;
  try { if (k && k !== 'off' && globalShortcut.register(k, toggleMain)) hotkey = k; } catch (e) { /* taken by another app */ }
}

// ---------- Google sign-in in the system browser (src/handoff.js explains the flow) ----------
// Google blocks OAuth in embedded browsers, so the app never shows Google's sign-in itself. One flow at a time;
// starting a new one cancels the old. The custom token goes back only to the document that asked for it.
let gFlow = null;
function endFlow(flow, err, token) {
  if (!flow || flow.done) return;
  flow.done = true;
  clearTimeout(flow.timer);
  if (flow.server) {   // stop listening now; give the in-flight reply (the browser's redirect) a moment, then drop the rest
    const srv = flow.server;
    try { srv.close(); } catch (e) { /* already closed */ }
    setTimeout(() => { try { srv.closeAllConnections(); } catch (e) { /* gone */ } }, 2000).unref();
  }
  if (gFlow === flow) gFlow = null;
  if (err) flow.reject(new Error(err)); else flow.resolve({ token });
}
async function redeemCode(flow, code) {
  if (!flow || flow.done || flow.busy) return false;
  flow.busy = true;
  try {
    const r = await net.fetch(handoff.ORIGIN + '/api/desktop/handoff/redeem', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, verifier: flow.verifier }),
      credentials: 'omit', cache: 'no-store', redirect: 'error'
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && typeof j.token === 'string' && j.token.length > 20 && j.token.length < 8192) {
      endFlow(flow, null, j.token);
      const w = flow.win;
      if (w && !w.isDestroyed()) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); }
      return true;
    }
    // A code that is not ours or already spent: keep waiting for the real one, but give up after a few.
    if (++flow.bad >= handoff.MAX_BAD_CODES) endFlow(flow, 'failed');
    return false;
  } catch (e) {
    if (++flow.bad >= handoff.MAX_BAD_CODES) endFlow(flow, 'failed');
    return false;
  } finally { flow.busy = false; }
}
function startLoopback(flow) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const code = flow.port && !flow.done ? handoff.codeFromLoopback(req.method, req.url, req.headers.host, flow.port) : null;
      if (!code) { res.writeHead(404, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); return res.end('Not found'); }
      redeemCode(flow, code).then((ok) => {
        res.writeHead(302, { location: handoff.afterUrl(ok), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', connection: 'close' });
        res.end();
      });
    });
    srv.on('error', () => resolve(null));
    srv.listen(0, '127.0.0.1', () => { flow.server = srv; flow.port = srv.address().port; resolve(flow.port); });
  });
}
ipcMain.handle('tz:google', async (e) => {
  if (!(fromShell(e) || fromSite(e))) throw new Error('not allowed');
  if (gFlow) endFlow(gFlow, 'cancelled');
  const pair = handoff.makePair();
  const flow = { verifier: pair.verifier, challenge: pair.challenge, bad: 0, done: false, busy: false, win: BrowserWindow.fromWebContents(e.sender) || mainWin, sender: e.sender };
  const p = new Promise((resolve, reject) => { flow.resolve = resolve; flow.reject = reject; });
  gFlow = flow;
  flow.timer = setTimeout(() => endFlow(flow, 'timeout'), handoff.FLOW_TTL_MS);
  e.sender.once('destroyed', () => endFlow(flow, 'cancelled'));
  const port = await startLoopback(flow);   // null -> the code comes back through tradezoro://auth instead
  try { await shell.openExternal(handoff.loginUrl(flow.challenge, port)); } catch (err) { endFlow(flow, 'no-browser'); }
  return p.catch((err) => { throw new Error(err.message); });
});
ipcMain.on('tz:google-cancel', (e) => { if (gFlow && gFlow.sender === e.sender) endFlow(gFlow, 'cancelled'); });
function handleProtocolUrl(url) {
  const code = handoff.codeFromProtocolUrl(url);
  if (code && gFlow) redeemCode(gFlow, code);
}

// ---------- native menus, tray ----------
function focused() { return BrowserWindow.getFocusedWindow() || mainWin; }
function go(id) { showMain(); send('tz:goto', id); }
const SCREENS = [['home', 'Home'], ['charts', 'Charts'], ['watchlist', 'Watchlist'], ['alerts', 'Alerts'], ['gex', 'GEX'], ['stats', 'Market Stats'], ['journal', 'Journal'], ['learn', 'Learn'], ['settings', 'Settings']];

function buildMenu() {
  const w = focused();
  const isChartWin = !!(w && w !== mainWin && !w.isDestroyed());
  const template = [
    ...(IS_MAC ? [{ label: 'TradeZoro', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'Cmd+,', click: () => go('settings') },
      { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { label: 'Quit TradeZoro', accelerator: 'Cmd+Q', click: quit }] }] : []),
    { label: 'File', submenu: [
      { label: 'New chart window', accelerator: 'CmdOrCtrl+Shift+N', click: () => openChartWindow(CHART) },
      { label: 'Pop out chart', accelerator: 'CmdOrCtrl+Shift+P', click: popOutChart },
      { type: 'separator' },
      ...(IS_MAC ? [{ role: 'close' }] : [{ label: 'Settings', accelerator: 'Ctrl+,', click: () => go('settings') }, { type: 'separator' }, { label: 'Quit TradeZoro', accelerator: 'Ctrl+Q', click: quit }])
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [
      { label: 'Command palette', accelerator: 'CmdOrCtrl+K', click: () => { showMain(); send('tz:palette'); } },
      { type: 'separator' },
      ...SCREENS.map(([id, label], i) => ({ label, accelerator: 'CmdOrCtrl+' + (i + 1), click: () => go(id) })),
      { type: 'separator' },
      { label: 'Reload chart', accelerator: 'CmdOrCtrl+R', click: () => { if (isChartWin) w.webContents.reload(); else if (chartView) chartView.webContents.reload(); } },
      { label: 'Always on top (chart window)', type: 'checkbox', accelerator: 'CmdOrCtrl+Shift+T', enabled: isChartWin, checked: isChartWin && w.isAlwaysOnTop(), click: () => toggleOnTop(focused()) },
      { role: 'togglefullscreen' },
      { type: 'separator' },
      { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }
    ] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { label: 'Show TradeZoro', click: showMain }, ...(IS_MAC ? [{ role: 'front' }] : [])] },
    { label: 'Help', submenu: [
      { label: 'Help Center', click: () => shell.openExternal(ORIGIN + '/help') },
      { label: 'Check for updates', click: () => checkUpdates(true) },
      ...(IS_MAC ? [] : [{ label: 'About TradeZoro', click: () => dialog.showMessageBox({ type: 'info', title: 'TradeZoro', icon: ICON,
        message: 'TradeZoro ' + app.getVersion(), detail: 'Education only. Not financial advice.' }) }])
    ] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function buildTray() {
  if (!tray) return;
  const qs = prefs().trayPrices ? trayQuotes : [];
  tray.setToolTip(['TradeZoro'].concat(qs.slice(0, 4).map((q) => q.t + '  ' + q.last + '  ' + q.pct)).join('\n'));
  if (IS_MAC) tray.setTitle(qs.length ? ' ' + qs[0].t + ' ' + qs[0].last : '', { fontType: 'monospacedDigit' });
  tray.setContextMenu(Menu.buildFromTemplate([
    ...(qs.length ? [{ label: 'Watchlist', enabled: false }, ...qs.map((q) => ({ label: q.t + '    ' + q.last + '    ' + q.pct, click: () => go('watchlist') })), { type: 'separator' }] : []),
    { label: 'Open TradeZoro', click: showMain },
    { label: 'Alerts', click: () => go('alerts') },
    { label: 'New chart window', click: () => openChartWindow(CHART) },
    ...(updateReady ? [{ label: 'Restart to update', click: installUpdate }] : []),
    { type: 'separator' },
    { label: 'Quit TradeZoro', click: quit }
  ]));
}
function createTray() {
  const img = nativeImage.createFromPath(ICON);
  tray = new Tray(process.platform === 'win32' ? img : img.resize({ width: IS_MAC ? 18 : 22, height: IS_MAC ? 18 : 22 }));
  tray.on('click', () => { if (!IS_MAC) toggleMain(); });
  tray.on('double-click', showMain);
  buildTray();
}
function quit() { quitting = true; app.quit(); }

// ---------- auto-update (GitHub Releases, tag desktop-v*) ----------
// electron-updater downloads silently; the app's own banner (src/app) offers "Restart to update". /app-version.json on
// the site adds notes and minVersion (below it: a blocking "Please update" screen). Checks at start and every 4 hours.
let autoUpdater = null;
// Cannot install by itself: macOS (ad-hoc signed) and the Linux .deb (needs root). Both get a "Download" banner.
const NO_INSTALL = IS_MAC || (process.platform === 'linux' && !process.env.APPIMAGE);
function setupUpdates() {
  checkUpdates(false);
  setInterval(() => checkUpdates(false), 4 * 60 * 60 * 1000);
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return;
  try { autoUpdater = require('electron-updater').autoUpdater; } catch (e) { return; }
  autoUpdater.autoDownload = !NO_INSTALL;
  autoUpdater.autoInstallOnAppQuit = !NO_INSTALL;
  // A beta build (2.0.0-beta) follows pre-releases; release builds only ever see normal releases.
  autoUpdater.allowPrerelease = app.getVersion().includes('-');
  if (NO_INSTALL) autoUpdater.on('update-available', (info) => { updAvailVer = info && info.version || null; pushUpdateState(); });
  autoUpdater.on('error', (err) => console.warn('update check failed:', err && err.message));
  autoUpdater.on('update-downloaded', (info) => onUpdateDownloaded(info && info.version));
  autoUpdater.checkForUpdates().catch(() => {});
}
function onUpdateDownloaded(version) {
  updateReady = true; updReadyVer = version || null; buildTray(); pushUpdateState();
  if ((!mainWin || mainWin.isDestroyed() || !mainWin.isVisible()) && Notification.isSupported())
    new Notification({ title: 'TradeZoro update ready', body: 'Version ' + version + ' installs when you quit, or open TradeZoro and choose Restart to update.', icon: ICON, silent: true }).show();
}
function fetchManifest() {
  if (STUB) return Promise.resolve();
  return net.fetch(ORIGIN + '/app-version.json?t=' + Date.now(), { cache: 'no-store' })
    .then((r) => (r.ok ? r.text() : null)).then((t) => { const m = t && Updates.parseManifest(t); if (m) { updManifest = m; pushUpdateState(); } })
    .catch(() => {});
}
function updateState() {
  return Updates.bannerState({ installed: app.getVersion(), manifest: updManifest, ready: updReadyVer, dismissed: updDismissed, canInstall: !!autoUpdater && !NO_INSTALL, available: NO_INSTALL ? updAvailVer : null });
}
function pushUpdateState() {
  const st = updateState();
  send('tz:update', st);
  for (const w of charts.values()) if (!w.isDestroyed()) w.webContents.send('tz:update', st);
}
function updateAction(a) {
  if (a === 'install' && updReadyVer) installUpdate();
  else if (a === 'dismiss') { updDismissed = updReadyVer || updAvailVer; pushUpdateState(); }   // in memory: shows again next launch
  else if (a === 'download') shell.openExternal(new URL((!NO_INSTALL && updManifest && updManifest.url) || '/download', ORIGIN).href);
}
function checkUpdates(manual) {
  fetchManifest();
  if (!autoUpdater) { if (manual) send('tz:update-check', { ok: false, why: process.env.PORTABLE_EXECUTABLE_DIR ? 'portable' : 'dev' }); return; }
  if (manual) updDismissed = null;
  autoUpdater.checkForUpdates().then((r) => {
    if (manual) send('tz:update-check', { ok: true, available: !!(r && r.isUpdateAvailable), version: r && r.updateInfo && r.updateInfo.version });
    if (manual && NO_INSTALL && r && r.isUpdateAvailable) pushUpdateState();
  }).catch(() => { if (manual) send('tz:update-check', { ok: false, why: 'error' }); });
}
function installUpdate() { quitting = true; autoUpdater && autoUpdater.quitAndInstall(false, true); }

// Test hooks: test/update-banner.js (fake update events) and test/app-smoke.js (STUB). Never set in a release.
if (process.env.TZ_UPDATE_TEST === '1') global.__tzUpdateTest = {
  ready: (v) => onUpdateDownloaded(v),
  manifest: (m) => { updManifest = Updates.parseManifest(m); pushUpdateState(); },
  state: () => updateState()
};
if (STUB) global.__tzTest = { chart: () => chartView && chartView.webContents, chartBounds: () => chartView && chartView.getBounds(), chartVisible: () => chartVisible,
  tray: () => trayQuotes, charts: () => [...charts.values()], hotkey: () => hotkey, prefs: () => prefs() };

// ---------- start ----------
app.on('second-instance', (e, argv) => {
  const u = handoff.protocolArg(argv);
  if (u) handleProtocolUrl(u);
  showMain();
});
app.on('open-url', (e, url) => { e.preventDefault(); handleProtocolUrl(url); });   // macOS form of the same
app.on('activate', () => { if (state) showMain(); });
app.on('before-quit', () => { quitting = true; state && state.flush(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (!IS_MAC && quitting) app.quit(); });
app.on('browser-window-focus', () => buildMenu());

app.whenReady().then(() => {
  state = State.create(app.getPath('userData'));
  protocol.handle('tzapp', (req) => {
    const f = Assets.fileFor(req.url);
    if (!f) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(f).toString()).then((r) => new Response(r.body, { status: r.status, headers: { 'content-type': Assets.typeOf(f), 'cache-control': 'no-cache' } }));
  });
  // Permissions: TradeZoro pages (and the app document, same origin) may show notifications, go full screen, write
  // the clipboard and reach the Data Bridge on 127.0.0.1. Nothing else, and nothing for any other site.
  const OK = new Set(['notifications', 'fullscreen', 'clipboard-sanitized-write', 'local-network-access', 'loopback-network', 'local-network']);
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, perm, cb, details) => cb(OK.has(perm) && policy.isAppUrl(details.requestingUrl || wc.getURL())));
  ses.setPermissionCheckHandler((wc, perm, origin) => OK.has(perm) && policy.isAppUrl(origin));
  createMain();
  createTray();
  buildMenu();
  registerHotkey();
  for (const c of state.openCharts()) if (c && c.key) openChartWindow(c.url, c.key);
  setupUpdates();
});
