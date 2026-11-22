// TradeZoro Desktop 2.0.1: the window resizes, the chart follows (Owner 22 Nov: "it cut off the screen instead of
// adjusting it"). Playwright + Electron, sample data, live chart page, no writes.
//   xvfb-run -a -s '-screen 0 2560x1440x24' node test/resize.js [out-dir]
// Drives the real window through 1920x1080 -> 1280x800 -> 900x600 (clamps to the 960x600 minimum) -> 1440x900, maximize / restore, full screen and a
// below-minimum request, and on the chart checks: the chart view fills the content area, the chart page's viewport and
// chart canvas are the content width (±2 px), the price scale and time axis are inside the window, and the bar's
// avatar + window controls are inside the window. Every other screen: no horizontal overflow at 960x600 (the minimum), 1280x800, 1920x1080.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require(process.env.PW_CORE || '/root/projects/stryker-trading-academy/node_modules/playwright-core');

const OUT = process.argv[2] || path.join(__dirname, '..', 'dist', 'shots-resize');
const TAG = process.env.TZ_SHOT_TAG || 'after';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (name, pass, info) => { results.push({ name, pass: !!pass, info }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); };
const SCREENS = ['home', 'watchlist', 'alerts', 'gex', 'stats', 'journal', 'learn', 'settings'];

// Inside the chart page: viewport, chart canvas box, price scale + time axis + bar end items.
const PROBE = `(() => {
  const R = (e) => e && e.getBoundingClientRect();
  const host = document.getElementById('vela-chart');
  const cv = host ? [...host.querySelectorAll('canvas')].filter((c) => R(c).width > 0).sort((a, b) => R(b).width * R(b).height - R(a).width * R(a).height) : [];
  const box = (e) => { const b = R(e); return b ? { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) } : null; };
  const end = document.getElementById('tzd-end'), sh = end && end.shadowRoot;
  const wc = sh ? [...sh.querySelectorAll('.wc button')].map(box) : [];
  // the chart's right tool rail: the chart column (canvas incl. price scale) + rail must span the whole width
  const c0 = cv[0] && R(cv[0]); let rail = null;
  for (let e = c0 && document.elementFromPoint(innerWidth - 8, innerHeight / 2); e && e !== document.body; e = e.parentElement) { const b = R(e); if (b.left >= c0.right - 2 && b.width < 120) rail = e; }
  return { iw: innerWidth, ih: innerHeight, host: box(host), canvas: box(cv[0]), rail: box(rail), avatar: sh && box(sh.getElementById('av')), more: sh && box(sh.getElementById('more')), wc,
    bar: box(document.querySelector('.mobile-topnav')), barOverflow: (() => { const b = document.querySelector('.mobile-topnav'); return b ? b.scrollWidth - b.clientWidth : -1; })(),
    hscroll: document.documentElement.scrollWidth - innerWidth };
})()`;
// The chart's own engine draws the price scale on the right and the time axis at the bottom of its canvas. Read the
// pixels there: a scale/axis that is inside the window has labels (non-background pixels) in those strips.
const AXES = `(() => {
  const host = document.getElementById('vela-chart'); if (!host) return null;
  const R = (e) => e.getBoundingClientRect();
  const cv = [...host.querySelectorAll('canvas')].filter((c) => R(c).width > 0);
  return cv.map((c) => ({ l: Math.round(R(c).left), t: Math.round(R(c).top), w: Math.round(R(c).width), h: Math.round(R(c).height) }));
})()`;

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-rs-'));
  const app = await electron.launch({
    executablePath: require(path.join(__dirname, '..', 'node_modules', 'electron')),
    args: [...((process.getuid && process.getuid() === 0) || process.env.CI ? ['--no-sandbox'] : []), path.join(__dirname, '..'), '--user-data-dir=' + userData],
    env: Object.assign({}, process.env, { TZ_DESKTOP_STUB: '1', ELECTRON_ENABLE_LOGGING: '0' }), timeout: 60000
  });
  const errors = [];
  const main = ({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('data:'));
  try {
    const win = await app.firstWindow({ timeout: 60000 });
    win.on('pageerror', (e) => errors.push(String(e)));
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1920, 1080); w.center(); });
    await win.waitForSelector('[data-screen="signin"]', { timeout: 20000 });
    await win.evaluate(() => window.TZData.Auth.stubSignIn());
    await win.waitForSelector('[data-screen="home"] .qc', { timeout: 10000 });
    const minSize = await app.evaluate((e) => e.BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('data:')).getMinimumSize());
    ok('minimum window size is 960x600 (the chart page turns tablet-layout at 900)', minSize[0] === 960 && minSize[1] === 600, JSON.stringify(minSize));

    const content = () => app.evaluate((e) => { const w = e.BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('data:')); const [cw, ch] = w.getContentSize(); return { cw, ch, view: global.__tzTest.chartBounds() }; });
    const size = async (w, h) => { await app.evaluate((e, [w, h]) => { const x = e.BrowserWindow.getAllWindows().find((y) => y.webContents.getURL().startsWith('data:')); if (x.isFullScreen()) x.setFullScreen(false); if (x.isMaximized()) x.unmaximize(); x.setContentSize(w, h); }, [w, h]); await win.waitForTimeout(1200); };
    const chartShot = async (file) => { const png = await app.evaluate(async () => (await global.__tzTest.chart().capturePage()).toPNG().toString('base64')); fs.writeFileSync(path.join(OUT, file), Buffer.from(png, 'base64')); };
    // what the user sees on the chart screen: the chart view clipped to the window's content area
    const winShot = async (file) => {
      const png = await app.evaluate(async (e) => { const w = e.BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('data:')); const [cw, ch] = w.getContentSize();
        const img = await global.__tzTest.chart().capturePage(), f = img.getSize().width / global.__tzTest.chartBounds().width;
        return img.crop({ x: 0, y: 0, width: Math.min(img.getSize().width, Math.round(cw * f)), height: Math.min(img.getSize().height, Math.round(ch * f)) }).toPNG().toString('base64'); });
      fs.writeFileSync(path.join(OUT, file), Buffer.from(png, 'base64'));
    };
    // full chart check at the current size
    const checkChart = async (label) => {
      const c = await content();
      const p = await app.evaluate(({}, js) => global.__tzTest.chart().executeJavaScript(js), PROBE);
      const viewOk = c.view && c.view.x === 0 && c.view.y === 0 && c.view.width === c.cw && c.view.height === c.ch;
      ok(label + ': chart view = content area', viewOk, JSON.stringify({ content: [c.cw, c.ch], view: c.view }));
      ok(label + ': chart page viewport = content (±2)', Math.abs(p.iw - c.cw) <= 2 && Math.abs(p.ih - c.ch) <= 2, p.iw + 'x' + p.ih);
      const railW = p.rail ? p.rail.w : 0;
      ok(label + ': chart canvas width = content width - right tool rail (±2), price scale inside', p.canvas && Math.abs(p.canvas.r + railW - c.cw) <= 2 && (!p.rail || Math.abs(p.rail.r - c.cw) <= 2), JSON.stringify({ canvas: p.canvas, rail: p.rail }));
      ok(label + ': time axis inside (canvas bottom within window)', p.canvas && p.canvas.b <= c.ch + 0.5 && p.canvas.b >= c.ch - 120, JSON.stringify(p.canvas));
      // pixels: the price-scale strip (right 56 px of the canvas) and the time-axis strip (bottom 20 px) carry labels
      const inkAt = (k) => app.evaluate(async ({}, k) => {
        const img = await global.__tzTest.chart().capturePage(), sz = img.getSize(), f = sz.width / k.iw;
        const count = (x, y, w, h) => { const b = img.crop({ x: Math.round(x * f), y: Math.round(y * f), width: Math.max(1, Math.round(w * f)), height: Math.max(1, Math.round(h * f)) }).toBitmap();
          const bg = [b[0], b[1], b[2]]; let n = 0; for (let i = 0; i < b.length; i += 4) if (Math.abs(b[i] - bg[0]) + Math.abs(b[i + 1] - bg[1]) + Math.abs(b[i + 2] - bg[2]) > 90) n++; return n; };
        return { price: count(k.r - 56, k.t + 40, 52, k.h - 80), time: count(k.l + 40, k.b - 20, k.w - 120, 18) };
      }, k);
      let ink;   // the first paint after a load / resize can be a frame late: try a few times
      for (let i = 0; i < 4; i++) { ink = await inkAt(Object.assign({ iw: p.iw }, p.canvas)); if (ink.price > 40 && ink.time > 40) break; await new Promise((r) => setTimeout(r, 1500)); }
      ok(label + ': price scale and time axis labels drawn on screen', ink.price > 40 && ink.time > 40, JSON.stringify(ink));
      const inside = (b) => b && b.l >= -0.5 && b.r <= c.cw + 0.5 && b.w > 0;
      ok(label + ': avatar + window controls inside the window', inside(p.avatar) && (process.platform === 'darwin' || (p.wc.length === 3 && p.wc.every(inside))), JSON.stringify({ av: p.avatar, wc: p.wc.map((b) => b && b.r) }));
      ok(label + ': top bar one row, no overflow, no page h-scroll', p.barOverflow <= 1 && p.hscroll <= 0 && p.bar && Math.abs(p.bar.h - 48) <= 1.5, JSON.stringify({ of: p.barOverflow, hs: p.hscroll, bar: p.bar }));
      return { c, p };
    };

    await win.evaluate(() => window.__tzUi.go('charts'));
    const loaded = await win.waitForSelector('.chart-load', { state: 'detached', timeout: 60000 }).then(() => true, () => false);
    await app.evaluate(() => global.__tzTest.chart().executeJavaScript('new Promise((r) => { const t0 = Date.now(); (function w() { const h = document.getElementById("vela-chart"); if ((h && h.querySelector("canvas")) || Date.now() - t0 > 30000) r(); else setTimeout(w, 250); })(); })'));
    await win.waitForTimeout(2500);
    ok('chart loaded', loaded);
    await checkChart('1920x1080');
    // Windows marks the app document occluded behind the chart and Chromium stops its rendering, so its ResizeObserver
    // never reports the new size (the 2.0.0 bug). Take that path away entirely: the chart must follow the window from
    // the main process alone. (2.0.0 fails this; 2.0.1 passes.)
    await app.evaluate(({ ipcMain }) => ipcMain.removeAllListeners('tz:chart-bounds'));
    for (const [w, h] of [[1280, 800], [900, 600]]) {
      await size(w, h);
      await checkChart(w + 'x' + h + ' requested (shrunk)');
      await winShot(TAG + '-charts-' + Math.max(w, 960) + 'x' + h + '.png');
    }
    // below the minimum: the window stops at 960x600
    await size(700, 400);
    const c0 = await content();
    ok('cannot shrink below 960x600', c0.cw === 960 && c0.ch === 600, c0.cw + 'x' + c0.ch);
    await size(1440, 900);
    await checkChart('1440x900 (grown back)');
    await app.evaluate((e) => e.BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('data:')).maximize());
    await win.waitForTimeout(1500);
    await checkChart('maximized');
    await app.evaluate((e) => e.BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('data:')).unmaximize());
    await win.waitForTimeout(1500);
    await checkChart('restored');
    await app.evaluate((e) => e.BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('data:')).setFullScreen(true));
    await win.waitForTimeout(2000);
    await checkChart('full screen');
    await app.evaluate((e) => e.BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('data:')).setFullScreen(false));
    await win.waitForTimeout(2000);
    await checkChart('left full screen');
    // a half-screen snap is just a setBounds from the OS: do the same
    await app.evaluate((e) => { const w = e.BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('data:')); const wa = e.screen.getPrimaryDisplay().workArea; w.setBounds({ x: wa.x, y: wa.y, width: Math.round(wa.width / 2), height: wa.height }); });
    await win.waitForTimeout(1500);
    await checkChart('snapped to half screen');
    // the chart's axes on screen at the two shot sizes, light theme too
    for (const [w, h] of [[960, 600], [1280, 800]]) {
      await size(w, h);
      for (const th of ['dark', 'light']) {
        await win.evaluate((t) => { document.documentElement.setAttribute('data-theme', t === 'dark' ? 'night' : 'light'); window.tzApp.theme(t === 'dark' ? 'night' : 'day'); }, th);
        await win.waitForTimeout(1200);
        await chartShot(TAG + '-charts-' + w + 'x' + h + '-' + th + '.png');
      }
    }
    await win.evaluate(() => { document.documentElement.setAttribute('data-theme', 'night'); window.tzApp.theme('night'); });
    // every other screen: fills the window and does not overflow, at 900x600, 1280x800, 1920x1080, and after shrinking
    for (const [w, h] of [[1920, 1080], [1280, 800], [960, 600]]) {
      await size(w, h);
      for (const id of SCREENS) {
        await win.evaluate((s) => window.__tzUi.go(s), id);
        await win.waitForTimeout(500);
        const m = await win.evaluate(() => { const R = (e) => e && e.getBoundingClientRect(); const tb = document.querySelector('.tb'), end = document.getElementById('tb-end'), sh = end && end.shadowRoot;
          const av = sh && R(sh.getElementById('av')), wc = sh ? [...sh.querySelectorAll('.wc button')].map((b) => R(b).right) : [], scr = R(document.querySelector('.scr'));
          return { iw: innerWidth, ih: innerHeight, hs: document.documentElement.scrollWidth - innerWidth, tbOf: tb ? tb.scrollWidth - tb.clientWidth : -1, av: av && av.right, wc, scrR: scr && Math.round(scr.right), scrB: scr && Math.round(scr.bottom) }; });
        const pass = m.hs <= 0 && m.tbOf <= 1 && m.av <= m.iw + 0.5 && m.wc.every((r) => r <= m.iw + 0.5) && Math.abs(m.scrR - m.iw) <= 1 && Math.abs(m.scrB - m.ih) <= 1 && Math.abs(m.iw - w) <= 2;
        ok(id + ' at ' + w + 'x' + h + ': fills the window, bar fits, avatar + window controls inside', pass, JSON.stringify(m));
        if (w === 960 || (w === 1280 && id === 'home')) await win.screenshot({ path: path.join(OUT, TAG + '-' + id + '-' + w + 'x' + h + '.png') });
      }
    }
    const real = errors.filter((e) => !/Autofill|favicon|ERR_|net::/.test(e));
    ok('no page errors', !real.length, real.slice(0, 5).join(' | '));
  } catch (e) {
    ok('resize run', false, e && e.stack);
  } finally {
    await app.evaluate(({ app: a }) => { a.exit(0); }).catch(() => {});
    await app.close().catch(() => {});
  }
  const failed = results.filter((r) => !r.pass);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
  fs.writeFileSync(path.join(OUT, 'resize-results-' + TAG + '.json'), JSON.stringify(results, null, 1));
  process.exit(failed.length ? 1 : 0);
})();
