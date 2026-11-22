// TradeZoro Desktop 2.0 smoke test (Playwright + Electron, sample data, no network writes, no orders).
//   xvfb-run -a -s '-screen 0 2560x1440x24' node test/app-smoke.js [out-dir]          (dev run: electron from node_modules, TZ_DESKTOP_STUB=1)
// Proves: the app opens to Home fast; the sign-in screen renders; a stubbed sign-in lands on Home; every screen renders
// with no errors; the chart tab lays the real ZoroCharts view over the chart area; the palette, add-symbol, new-alert
// dialogs open; tray gets watchlist prices; theme switch works; no website header/footer in the app UI.
// Also takes the 1440x900 + 1920x1080 dark + light screenshots and runs the alignment checks (getBoundingClientRect).
// Desktop 3 (Owner 22 Nov): no sidebar, no "ZoroCharts" header row, ONE top bar (also over the chart), avatar menu
// with every screen, "..." overflow, window drag regions.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require(process.env.PW_CORE || '/root/projects/stryker-trading-academy/node_modules/playwright-core');

const OUT = process.argv[2] || path.join(__dirname, '..', 'dist', 'shots2');
const CHART = process.env.TZ_SMOKE_CHART !== '0';     // set 0 to skip loading the live chart page
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (name, pass, info) => { results.push({ name, pass: !!pass, info }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); };
const SCREENS = ['home', 'charts', 'watchlist', 'alerts', 'gex', 'stats', 'journal', 'learn', 'settings'];

// Alignment gate: items in a row share a vertical centre, icons centred in buttons, nothing clipped / overflowing.
const ALIGN = `(() => {
  const bad = [];
  const r = (e) => e.getBoundingClientRect();
  const vis = (e) => { const b = r(e); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const name = (e) => e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : '') + (e.textContent ? ' "' + e.textContent.trim().slice(0, 24) + '"' : '');
  // icons centred in their buttons
  document.querySelectorAll('.ib, .av').forEach((b) => {
    if (!vis(b)) return; const s = b.querySelector('svg, img'); if (!s || !vis(s)) return;
    const a = r(b), c = r(s);
    const dx = Math.abs((a.left + a.width / 2) - (c.left + c.width / 2)), dy = Math.abs((a.top + a.height / 2) - (c.top + c.height / 2));
    if (dx > 1 || dy > 1) bad.push('icon off-centre ' + name(b) + ' dx=' + dx.toFixed(1) + ' dy=' + dy.toFixed(1));
  });
  // one vertical centre per row (flex rows that are single line)
  document.querySelectorAll('.tb, .phead .act, .card-h, .row, .set-r, .qc-t, .lv, .pal-i, .tool, .dlg-a, .ms-bar').forEach((row) => {
    if (!vis(row)) return;
    const st = getComputedStyle(row); if (st.display.indexOf('flex') < 0 && st.display.indexOf('grid') < 0) return;
    if (st.alignItems !== 'center') return;
    const kids = [...row.children].filter((k) => vis(k) && getComputedStyle(k).position !== 'absolute');
    if (kids.length < 2) return;
    const tops = kids.map((k) => r(k).top); if (Math.max(...tops) - Math.min(...tops) > r(row).height * 0.6) return;   // wrapped
    const ys = kids.map((k) => r(k).top + r(k).height / 2), y0 = r(row).top + r(row).height / 2;
    const off = Math.max(...ys.map((y) => Math.abs(y - (st.display.indexOf('grid') >= 0 ? ys[0] : y0))));
    if (off > 1) bad.push('row centre ' + name(row) + ' off ' + off.toFixed(1));
  });
  // pills / buttons: even left/right padding, no clipped text
  document.querySelectorAll('.btn, .chip, .pill, .tab, .seg button, kbd').forEach((b) => {
    if (!vis(b)) return;
    const st = getComputedStyle(b);
    if (Math.abs(parseFloat(st.paddingLeft) - parseFloat(st.paddingRight)) > 1) bad.push('uneven padding ' + name(b));
    if (b.scrollWidth > b.clientWidth + 1) bad.push('text overflows ' + name(b));
  });
  // headings / labels never clipped unless deliberately ellipsised
  document.querySelectorAll('h1, h2, .h3, .lbl, .stat b, .qc-p b, td').forEach((e) => {
    if (!vis(e)) return; const st = getComputedStyle(e);
    if (st.textOverflow === 'ellipsis') return;
    if (e.scrollWidth > e.clientWidth + 1 && st.overflow !== 'visible') bad.push('clipped ' + name(e));
  });
  // numbers: tabular + right aligned in table columns
  document.querySelectorAll('.tbl td.r').forEach((td) => { const st = getComputedStyle(td); if (st.textAlign !== 'right' || !/tabular/.test(st.fontVariantNumeric)) bad.push('number cell ' + name(td)); });
  if (document.documentElement.scrollWidth > window.innerWidth) bad.push('horizontal scroll on page');
  return bad;
})()`;

// The top bar (main document: header.tb; chart page: .mobile-topnav), measured through the shadow roots of bar.js.
// Returns { items, bad, drag }: every visible control's box, the problems, and the effective app-region at test points.
const BAR = `((sel) => {
  const bar = document.querySelector(sel); if (!bar) return { bad: ['no bar ' + sel], items: [] };
  const R = (e) => e.getBoundingClientRect(), br = R(bar), cy = br.top + 24;
  const vis = (e) => { const b = R(e); return b.width > 0 && b.height > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden'; };
  const sh = (id, q) => { const h = document.getElementById(id); return h && h.shadowRoot ? [...h.shadowRoot.querySelectorAll(q)] : []; };
  const hostIds = sel === '.tb' ? ['tb-logo', 'tb-search', 'tb-end'] : ['tzd-logo', 'tzd-search', 'tzd-end'];
  const ctl = [];
  const add = (name, e) => { if (e && vis(e)) { const b = R(e); ctl.push({ name, x: Math.round(b.left * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10, cy: Math.round((b.top + b.height / 2) * 10) / 10, el: e }); } };
  add('logo', sh(hostIds[0], '.logo')[0]);
  if (sel === '.tb') { add('title', document.getElementById('tb-title')); add('sample', document.getElementById('tb-sample')); }
  else {
    add('layout', document.getElementById('stkws-btn'));
    document.querySelectorAll('.mobile-topnav .stkws-tab').forEach((t, i) => add('tab' + i, t));
    add('plus', document.querySelector('.mobile-topnav .stkws-plus'));
    add('trade', document.getElementById('stkc-paper-btn'));
    document.querySelectorAll('.mobile-topnav .stkas-b').forEach((t) => add('balance', t));
    add('market', document.querySelector('.mobile-topnav .mclock-pill'));
  }
  add('search', sh(hostIds[1], '.s')[0]);
  add('more', sh(hostIds[2], '#more')[0]);
  add('avatar', sh(hostIds[2], '#av')[0]);
  sh(hostIds[2], '.wc button').forEach((b, i) => add('wc' + i, b));
  const bad = [];
  if (Math.abs(br.height - 48) > 1.5) bad.push('bar height ' + br.height);
  ctl.forEach((c) => { if (Math.abs(c.cy - cy) > 1) bad.push(c.name + ' centre off ' + (c.cy - cy).toFixed(1)); });
  ['more', 'avatar', 'search', 'layout', 'plus'].forEach((n) => { const c = ctl.find((x) => x.name === n); if (c && Math.abs(c.h - 32) > 0.5) bad.push(n + ' height ' + c.h); });
  // icons centred in the round / square buttons
  ctl.filter((c) => /more|avatar|wc/.test(c.name)).forEach((c) => { const i = c.el.querySelector('svg,img'); if (!i) return; const a = R(c.el), b = R(i);
    const dx = Math.abs(a.left + a.width / 2 - b.left - b.width / 2), dy = Math.abs(a.top + a.height / 2 - b.top - b.height / 2); if (dx > 1 || dy > 1) bad.push(c.name + ' icon off-centre ' + dx.toFixed(1) + '/' + dy.toFixed(1)); });
  if (bar.scrollWidth > bar.clientWidth + 1) bad.push('bar overflows ' + bar.scrollWidth + ' > ' + bar.clientWidth);
  const last = ctl.filter((c) => !/^wc/.test(c.name)).slice(-1)[0]; if (last && last.x + last.w > innerWidth + 0.5) bad.push('cut off ' + last.name);
  // effective app-region (nearest ancestor across shadow roots with drag / no-drag)
  const region = (x, y) => { let e = document.elementFromPoint(x, y); while (e && e.shadowRoot) { const d = e.shadowRoot.elementFromPoint(x, y); if (!d || d === e) break; e = d; }
    for (let n = e; n; n = n.parentElement || (n.getRootNode && n.getRootNode().host)) { const v = getComputedStyle(n).getPropertyValue('-webkit-app-region') || getComputedStyle(n).getPropertyValue('app-region'); if (v && v !== 'none') return v; } return 'none'; };
  const drag = {};
  ctl.forEach((c) => { if (c.name !== 'logo' && c.name !== 'title' && c.name !== 'sample') drag[c.name] = region(c.x + c.w / 2, cy); });
  // an empty stretch of the bar: the widest gap between neighbouring controls
  const xs = ctl.map((c) => [c.x, c.x + c.w]).sort((a, b) => a[0] - b[0]); let gx = 0, gw = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i][0] - xs[i - 1][1] > gw) { gw = xs[i][0] - xs[i - 1][1]; gx = xs[i - 1][1] + gw / 2; }
  drag.empty = gw > 4 ? region(gx, cy) : 'n/a'; drag.emptyX = Math.round(gx);
  Object.entries(drag).forEach(([k, v]) => { if (k === 'emptyX') return; if (k === 'empty' ? v !== 'drag' : v !== 'no-drag') bad.push('drag region ' + k + '=' + v); });
  // gaps between neighbours (8 px unless the item is a window control)
  const gaps = []; const row = ctl.filter((c) => c.name !== 'title' || true).sort((a, b) => a.x - b.x);
  for (let i = 1; i < row.length; i++) gaps.push(row[i - 1].name + '>' + row[i].name + ' ' + Math.round((row[i].x - row[i - 1].x - row[i - 1].w) * 10) / 10);
  return { bad, gaps, drag, items: ctl.map((c) => c.name + ' x=' + c.x + ' w=' + c.w + ' h=' + c.h + ' cy=' + c.cy) };
})`;

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-d2-'));
  const t0 = Date.now();
  const app = await electron.launch({
    executablePath: require(path.join(__dirname, '..', 'node_modules', 'electron')),
    args: [...((process.getuid && process.getuid() === 0) || process.env.CI ? ['--no-sandbox'] : []), path.join(__dirname, '..'), '--user-data-dir=' + userData],
    env: Object.assign({}, process.env, { TZ_DESKTOP_STUB: '1', ELECTRON_ENABLE_LOGGING: '0' }), timeout: 60000
  });
  const errors = [];
  try {
    const win = await app.firstWindow({ timeout: 60000 });
    win.on('pageerror', (e) => errors.push(String(e)));
    win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1440, 900); w.center(); });
    await win.waitForSelector('[data-screen="signin"]', { timeout: 20000 });
    ok('app opens to a native screen (sign-in when signed out)', true, (Date.now() - t0) + ' ms incl. launch');
    const origin = await win.evaluate(() => location.origin + ' | tzApp=' + typeof window.tzApp + ' require=' + typeof window.require + ' process=' + typeof window.process);
    ok('app document runs in the tradezoro.com origin with only the tzApp bridge', /^https:\/\/tradezoro\.com \| tzApp=object require=undefined process=undefined/.test(origin), origin);
    const prefs = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => { const p = w.webContents.getLastWebPreferences(); return { ci: p.contextIsolation, ni: p.nodeIntegration, sb: p.sandbox }; }));
    ok('window sandboxed, contextIsolation on, nodeIntegration off', prefs.every((p) => p.ci && !p.ni && p.sb), JSON.stringify(prefs));
    const site = await win.evaluate(() => !!document.querySelector('.mobile-topnav, .site-footer, footer, #dash-sidebar'));
    ok('no website header / footer in the app UI', !site);
    ok('no side menu (sidebar removed)', await win.evaluate(() => !document.querySelector('nav.sb, .sb, .nv')));
    for (const th of ['dark', 'light']) {
      await win.evaluate((t) => { localStorage.setItem('tz_desktop_theme', t === 'dark' ? 'night' : 'day'); document.documentElement.setAttribute('data-theme', t === 'dark' ? 'night' : 'light'); }, th);
      await win.waitForTimeout(150);
      await win.screenshot({ path: path.join(OUT, '00-signin-' + th + '.png') });
    }
    await win.evaluate(() => { localStorage.setItem('tz_desktop_theme', 'night'); document.documentElement.setAttribute('data-theme', 'night'); });

    // stubbed sign-in -> Home
    const t1 = Date.now();
    await win.evaluate(() => window.TZData.Auth.stubSignIn());
    await win.waitForSelector('[data-screen="home"] .qc', { timeout: 10000 });
    ok('sign-in (stub) lands on Home with watchlist cards', true, (Date.now() - t1) + ' ms');
    const sample = await win.isVisible('#tb-sample');
    ok('"Sample data" chip shows in stub mode', sample);
    ok('one top bar: one header, title = screen name', await win.evaluate(() => document.querySelectorAll('header').length === 1 && document.getElementById('tb-title').textContent === 'Home'));
    // avatar menu: account header + every screen + Settings, Check for updates, Sign out
    await win.click('#tb-end >> #av');
    await win.waitForTimeout(250);
    const am = await win.evaluate(() => { const r = document.querySelector('tz-bar-menu').shadowRoot; return { hd: r.querySelector('.hd') && r.querySelector('.hd').innerText, items: [...r.querySelectorAll('.it span:not(.k)')].map((x) => x.textContent), imgs: r.querySelectorAll('.it img').length }; });
    ok('avatar menu opens with account, all screens, Settings, updates, sign out',
      /Sample member/.test(am.hd) && /sample@example.com/.test(am.hd) && /Free/.test(am.hd) && ['Home', 'Charts', 'Watchlist', 'Alerts', 'GEX', 'Market Stats', 'Journal', 'Learn', 'Settings', 'Check for updates', 'Sign out'].every((t) => am.items.includes(t)) && am.imgs === 5, JSON.stringify(am));
    const mAlign = await win.evaluate(() => { const r = document.querySelector('tz-bar-menu').shadowRoot, m = r.querySelector('.m').getBoundingClientRect(), bad = [];
      r.querySelectorAll('.it').forEach((b) => { const a = b.getBoundingClientRect(), i = b.querySelector('svg,img').getBoundingClientRect(); if (Math.abs(a.top + a.height / 2 - i.top - i.height / 2) > 1) bad.push('icon ' + b.textContent); if (Math.abs((a.left - m.left) - (m.right - a.right)) > 1) bad.push('side padding ' + b.textContent); if (b.scrollWidth > b.clientWidth + 1) bad.push('overflow ' + b.textContent); });
      const av = document.getElementById('tb-end').shadowRoot.getElementById('av').getBoundingClientRect(); if (Math.abs(m.right - av.right) > 1) bad.push('menu not right-aligned to avatar ' + (m.right - av.right));
      return bad; });
    ok('avatar menu: rows even, icons centred, right edge on the avatar', !mAlign.length, mAlign.join(', '));
    for (const th of ['dark', 'light']) {
      await win.evaluate((t) => document.documentElement.setAttribute('data-theme', t === 'dark' ? 'night' : 'light'), th);
      await win.waitForTimeout(200);
      await win.screenshot({ path: path.join(OUT, '20-avatar-menu-' + th + '.png') });
    }
    await win.evaluate(() => document.documentElement.setAttribute('data-theme', 'night'));
    await win.keyboard.press('ArrowDown'); await win.keyboard.press('Enter');
    await win.waitForSelector('[data-screen="charts"]', { timeout: 3000 }).then(() => ok('avatar menu: keyboard opens a screen (Down, Enter -> Charts)', true), () => ok('avatar menu: keyboard opens a screen', false));
    await win.evaluate(() => window.__tzUi.go('home'));
    await win.keyboard.press(process.platform === 'darwin' ? 'Meta+3' : 'Control+3');
    ok('Ctrl/Cmd+3 still opens Watchlist', await win.waitForSelector('[data-screen="watchlist"]', { timeout: 2000 }).then(() => true, () => false));
    await win.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,');
    ok('Ctrl/Cmd+, still opens Settings', await win.waitForSelector('[data-screen="settings"]', { timeout: 2000 }).then(() => true, () => false));
    await win.evaluate(() => window.__tzUi.go('home'));
    await win.click('#tb-end >> #more');
    await win.waitForTimeout(250);
    const om = await win.evaluate(() => [...document.querySelector('tz-bar-menu').shadowRoot.querySelectorAll('.it span:not(.k)')].map((x) => x.textContent));
    ok('"..." menu opens (New chart window off the chart)', om.includes('New chart window'), om.join(', '));
    await win.keyboard.press('Escape');
    const barHome = await win.evaluate(BAR + "('.tb')");
    fs.writeFileSync(path.join(OUT, 'bar-home.json'), JSON.stringify(barHome, null, 1));
    ok('top bar (Home): 48px, one centre line, 32px controls, drag only on empty parts', !barHome.bad.length, barHome.bad.join(', ') + ' | ' + barHome.gaps.join(', '));

    const shot = async (id, th) => {
      await win.evaluate((t) => { localStorage.setItem('tz_desktop_theme', t === 'dark' ? 'night' : 'day'); document.documentElement.setAttribute('data-theme', t === 'dark' ? 'night' : 'light'); window.tzApp.theme(t === 'dark' ? 'night' : 'day'); }, th);
      await win.waitForTimeout(250);
      await win.screenshot({ path: path.join(OUT, String(SCREENS.indexOf(id) + 1).padStart(2, '0') + '-' + id + '-' + th + '.png') });
    };
    const bads = {};
    for (const id of SCREENS) {
      await win.evaluate((s) => window.__tzUi.go(s), id);
      await win.waitForSelector('[data-screen="' + id + '"]', { timeout: 5000 });
      await win.waitForTimeout(id === 'charts' ? 400 : 600);
      if (id === 'charts' && CHART) {
        const loaded = await win.waitForSelector('.chart-load', { state: 'detached', timeout: 45000 }).then(() => true, () => false);
        const info = await app.evaluate(() => ({ b: global.__tzTest.chartBounds(), v: global.__tzTest.chartVisible(), url: global.__tzTest.chart() && global.__tzTest.chart().getURL() }));
        ok('chart tab: the real ZoroCharts page fills the whole window', loaded && info.v && /tradezoro\.com\/charts/.test(info.url) && info.b.x === 0 && info.b.y === 0 && info.b.width === 1440 && info.b.height === 900, JSON.stringify(info));
        await win.waitForTimeout(4000);
        ok('no "ZoroCharts" header row, no Reload / New window / Pop out buttons in the app', await win.evaluate(() => !document.querySelector('.chart-bar') && !/Every chart tool/.test(document.body.innerText) && !document.querySelector('[data-act="chart-reload"]:not(.empty *)')));
        ok('our own bar steps aside on Charts (no second bar)', await win.evaluate(() => getComputedStyle(document.querySelector('.tb')).display === 'none'));
        const cb = await app.evaluate(({}, js) => global.__tzTest.chart().executeJavaScript(js + "('.mobile-topnav')"), BAR);
        fs.writeFileSync(path.join(OUT, 'bar-chart.json'), JSON.stringify(cb, null, 1));
        ok('chart: ONE top bar with logo, tabs, +, search, Trade, market status, ..., avatar, window controls', ['logo', 'layout', 'tab0', 'plus', 'search', 'trade', 'market', 'more', 'avatar'].every((n) => cb.items.some((i) => i.startsWith(n + ' '))) && (process.platform === 'darwin' || cb.items.some((i) => i.startsWith('wc2 '))), cb.items.join(' | '));
        ok('chart bar: 48px, one centre line, 32px controls, drag only on empty parts', !cb.bad.length, cb.bad.join(', ') + ' | ' + cb.gaps.join(', ') + ' | ' + JSON.stringify(cb.drag));
        const ham = await app.evaluate(() => global.__tzTest.chart().executeJavaScript('(() => { const v = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).display : "none"; }; return { hamburger: v("#dash-menu-toggle"), compactMenu: v("#stkcmp-menu"), siteIcons: v(".mobile-topnav .topnav-right") }; })()'));
        ok('no hamburger in the app (site menu button hidden)', Object.values(ham).every((d) => d === 'none'), JSON.stringify(ham));
        const om2 = await app.evaluate(() => global.__tzTest.chart().executeJavaScript('(async () => { document.getElementById("tzd-end").shadowRoot.getElementById("more").click(); await new Promise((r) => setTimeout(r, 250)); const r = document.querySelector("tz-bar-menu").shadowRoot; return [...r.querySelectorAll(".it span:not(.k)")].map((x) => x.textContent); })()'));
        ok('chart "..." menu holds Reload, New window, Pop out', ['Reload chart', 'New chart window', 'Pop out chart'].every((t) => om2.includes(t)), om2.join(', '));
        for (const th of ['dark', 'light']) {
          await win.evaluate((t) => window.tzApp.theme(t === 'dark' ? 'night' : 'day'), th);
          await win.waitForTimeout(900);
          const png = await app.evaluate(async () => (await global.__tzTest.chart().capturePage()).toPNG().toString('base64'));
          fs.writeFileSync(path.join(OUT, '21-overflow-menu-' + th + '.png'), Buffer.from(png, 'base64'));
        }
        await win.evaluate(() => window.tzApp.theme('night'));
        await app.evaluate(() => global.__tzTest.chart().executeJavaScript('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); document.querySelector("tz-bar-menu") && document.querySelector("tz-bar-menu").remove(); document.getElementById("tzd-end").shadowRoot.getElementById("more").setAttribute("aria-expanded", "false")'));
        const am2 = await app.evaluate(() => global.__tzTest.chart().executeJavaScript('(async () => { document.getElementById("tzd-end").shadowRoot.getElementById("av").click(); await new Promise((r) => setTimeout(r, 250)); const r = document.querySelector("tz-bar-menu").shadowRoot; const b = [...r.querySelectorAll(".it")].find((x) => /Watchlist/.test(x.textContent)); b.click(); return true; })()'));
        ok('chart avatar menu opens and its screens work (Watchlist from the chart)', am2 && await win.waitForSelector('[data-screen="watchlist"]', { timeout: 3000 }).then(() => true, () => false));
        await win.evaluate(() => window.__tzUi.go('charts')); await win.waitForTimeout(800);
        await app.evaluate(() => { const wc = global.__tzTest.chart(); wc.focus(); return wc.executeJavaScript('(() => { const i = document.getElementById("tzd-search").shadowRoot.querySelector("input"); i.focus(); return true; })()'); });
        await app.evaluate(() => global.__tzTest.chart().sendInputEvent({ type: 'char', keyCode: 'g' }));
        const pq = await win.waitForSelector('#pal-q', { timeout: 3000 }).then(() => win.inputValue('#pal-q'), () => null);
        ok('typing in the chart bar search opens the palette with the text', pq === 'g', String(pq));
        await win.keyboard.press('Escape');
        await win.evaluate(() => window.__tzUi.go('watchlist'));
        const off = await app.evaluate(() => global.__tzTest.chart().executeJavaScript('document.documentElement.classList.contains("tzd-off")'));
        ok('hidden chart leaves no drag region behind', off === true);
        await win.evaluate(() => window.__tzUi.go('charts'));
        await win.waitForTimeout(800);
        const dressed = await app.evaluate(() => global.__tzTest.chart().executeJavaScript('(() => { const v = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).display : "none"; }; return { sidebar: v(".sidebar"), brand: v(".mobile-topnav .brand"), dock: v(".appnav-dock") }; })()'));
        ok('chart view hides the website side menu / brand / dock', Object.values(dressed).every((d) => d === 'none'), JSON.stringify(dressed));
      }
      const txt = await win.evaluate(() => document.querySelector('.scr').innerText.length);
      if (id !== 'charts') ok('screen renders: ' + id, txt > 20, txt + ' chars');   // Charts is the chart view itself (checked above)
      bads[id] = await win.evaluate(ALIGN);
      for (const th of ['dark', 'light']) {
        if (id === 'charts') {   // the chart is a separate view: capture the whole window
          await win.evaluate((t) => { localStorage.setItem('tz_desktop_theme', t === 'dark' ? 'night' : 'day'); document.documentElement.setAttribute('data-theme', t === 'dark' ? 'night' : 'light'); window.tzApp.theme(t === 'dark' ? 'night' : 'day'); }, th);
          await win.waitForTimeout(1200);
          // the chart view covers the whole window now, so its capture is the window
          const png = await app.evaluate(async () => (await global.__tzTest.chart().capturePage()).toPNG().toString('base64'));
          fs.writeFileSync(path.join(OUT, '02-charts-' + th + '.png'), Buffer.from(png, 'base64'));
        } else await shot(id, th);
      }
      await win.evaluate(() => { localStorage.setItem('tz_desktop_theme', 'night'); document.documentElement.setAttribute('data-theme', 'night'); window.tzApp.theme('night'); });
    }
    // 1920x1080: Home, Charts, Watchlist, dark + light; bar checked again at that width
    const size = async (w, h) => {
      await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('data:')).setContentSize(w, h), [w, h]);
      await win.setViewportSize({ width: w, height: h }).catch(() => {});
      await win.waitForTimeout(600);
    };
    await size(1920, 1080);
    for (const id of CHART ? ['home', 'charts', 'watchlist'] : ['home', 'watchlist']) {
      await win.evaluate((s) => window.__tzUi.go(s), id);
      await win.waitForTimeout(id === 'charts' ? 2500 : 700);
      for (const th of ['dark', 'light']) {
        await win.evaluate((t) => { localStorage.setItem('tz_desktop_theme', t === 'dark' ? 'night' : 'day'); document.documentElement.setAttribute('data-theme', t === 'dark' ? 'night' : 'light'); window.tzApp.theme(t === 'dark' ? 'night' : 'day'); }, th);
        await win.waitForTimeout(id === 'charts' ? 1200 : 300);
        const png = id === 'charts' ? await app.evaluate(async () => (await global.__tzTest.chart().capturePage()).toPNG().toString('base64')) : (await win.screenshot()).toString('base64');
        fs.writeFileSync(path.join(OUT, '30-' + id + '-1920-' + th + '.png'), Buffer.from(png, 'base64'));
      }
      const b = id === 'charts' ? await app.evaluate(({}, js) => global.__tzTest.chart().executeJavaScript(js + "('.mobile-topnav')"), BAR) : await win.evaluate(BAR + "('.tb')");
      ok('top bar at 1920 (' + id + ')', !b.bad.length, b.bad.join(', '));
    }
    // 1280 and 1024: the chart bar stays one row, nothing cut off
    for (const w of CHART ? [1280, 1024] : []) {
      await size(w, 800);
      await win.evaluate(() => { localStorage.setItem('tz_desktop_theme', 'night'); document.documentElement.setAttribute('data-theme', 'night'); window.tzApp.theme('night'); window.__tzUi.go('charts'); });
      await win.waitForTimeout(2500);
      const b = await app.evaluate(({}, js) => global.__tzTest.chart().executeJavaScript(js + "('.mobile-topnav')"), BAR);
      ok('chart bar one row at ' + w + ' (no overflow, avatar + window controls visible)', !b.bad.length && b.items.some((i) => i.startsWith('avatar ')), b.bad.join(', '));
      if (w === 1024) { const png = await app.evaluate(async () => (await global.__tzTest.chart().capturePage()).toPNG().toString('base64')); fs.writeFileSync(path.join(OUT, '31-charts-1024-dark.png'), Buffer.from(png, 'base64')); }
    }
    await win.evaluate(() => { localStorage.setItem('tz_desktop_theme', 'night'); document.documentElement.setAttribute('data-theme', 'night'); window.tzApp.theme('night'); });
    await size(1440, 900);
    const allBad = Object.entries(bads).filter(([, b]) => b.length);
    ok('alignment gate on every screen (centres, padding, clipping, tabular numbers, no h-scroll)', !allBad.length, JSON.stringify(allBad).slice(0, 1500));

    // overlays
    await win.evaluate(() => window.__tzUi.go('home'));
    await win.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
    await win.waitForSelector('.pal #pal-q', { timeout: 3000 });
    await win.fill('#pal-q', 'nq');
    const first = await win.textContent('.pal-i[aria-selected="true"] b');
    ok('command palette (Ctrl/Cmd+K) finds symbols', /NQ/.test(first), first);
    fs.writeFileSync(path.join(OUT, 'align-palette.json'), JSON.stringify(await win.evaluate(ALIGN)));
    await win.screenshot({ path: path.join(OUT, '10-palette-dark.png') });
    await win.keyboard.press('Escape');
    await win.evaluate(() => window.__tzUi.go('alerts'));
    await win.click('[data-act="al-new"]');
    await win.waitForSelector('#al-price', { timeout: 3000 });
    await win.fill('#al-price', '1234.5');
    await win.screenshot({ path: path.join(OUT, '11-new-alert-dark.png') });
    await win.click('#al-save');
    await win.waitForSelector('.toast', { timeout: 3000 });
    ok('create alert dialog validates and saves (stub, no network)', /created/.test(await win.textContent('.toast')));
    await win.evaluate(() => window.__tzUi.go('watchlist'));
    await win.click('[data-act="wl-add"]');
    await win.waitForSelector('#as-q');
    await win.fill('#as-q', 'sol');
    await win.screenshot({ path: path.join(OUT, '12-add-symbol-dark.png') });
    await win.keyboard.press('Escape');
    const tray = await app.evaluate(() => global.__tzTest.tray());
    ok('tray / menu bar gets live watchlist prices', tray.length > 0 && tray[0].last, JSON.stringify(tray[0]));
    const hk = await app.evaluate(() => global.__tzTest.hotkey());
    ok('global show/hide hotkey registered', !!hk || process.env.CI === 'true', String(hk));
    // drag reorder
    const order0 = await win.$$eval('tr[data-sym]', (r) => r.map((x) => x.getAttribute('data-sym')));
    await win.dragAndDrop('tr[data-sym="' + order0[1] + '"]', 'tr[data-sym="' + order0[0] + '"]');
    await win.waitForTimeout(200);
    const order1 = await win.$$eval('tr[data-sym]', (r) => r.map((x) => x.getAttribute('data-sym')));
    ok('watchlist drag reorder', order1[0] === order0[1], order0.slice(0, 2) + ' -> ' + order1.slice(0, 2));
    // pop-out window
        await win.evaluate(() => window.tzApp.newChartWindow());
    await win.waitForTimeout(1500);
    const n = await app.evaluate(() => global.__tzTest.charts().length);
    ok('multi-window: a chart opens in its own window', n === 1, n + ' chart windows');
    // window bounds remembered
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('data:')).setBounds({ x: 40, y: 40, width: 1300, height: 820 }));
    await win.waitForTimeout(900);
    const saved = JSON.parse(fs.readFileSync(path.join(userData, 'window-state.json'), 'utf8'));
    ok('window size / position remembered', saved.windows.main && saved.windows.main.bounds.width === 1300, JSON.stringify(saved.windows.main));
    // sign out -> sign-in screen
    await win.evaluate(() => window.TZData.Auth.signOut());
    await win.waitForSelector('[data-screen="signin"]', { timeout: 3000 });
    ok('sign out returns to the sign-in screen', true);
    const real = errors.filter((e) => !/Autofill|favicon|ERR_|net::/.test(e));
    ok('no page errors', !real.length, real.slice(0, 5).join(' | '));
  } catch (e) {
    ok('smoke run', false, e && e.stack);
  } finally {
    await app.evaluate(({ app: a }) => { a.exit(0); }).catch(() => {});
    await app.close().catch(() => {});
  }
  const failed = results.filter((r) => !r.pass);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  process.exit(failed.length ? 1 : 0);
})();
