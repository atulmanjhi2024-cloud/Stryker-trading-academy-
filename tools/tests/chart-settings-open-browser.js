// Owner bug 25 Nov (build 1289): right-click the chart -> "Settings…" did nothing. This suite opens the chart
// settings window from every entry point (right-click menu, top-bar gear #stkc-settings-btn, the engine's own
// gears), with REAL mouse input, signed in (Firebase stub), dark + light, 1440 + 1100, and checks that a candle
// colour change applies and survives a reload. Fixture bars only (no live data).
//   python3 -m http.server 8047 --bind 127.0.0.1 &   CHART_BASE=http://127.0.0.1:8047 node tools/tests/chart-settings-open-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8047';
const OUT = process.argv[2] || '';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
const shot = async (p, n) => { if (!OUT) return; await p.screenshot({ path: OUT + '/' + n + '.png' }); console.log('shot', OUT + '/' + n + '.png'); };

const rnd = (s) => { const x = Math.sin(s) * 10000; return x - Math.floor(x); };
function bars(tf, page) {
  const step = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '1d': 86400 }[tf] || 300;
  const n = 400, end = Math.floor(Date.now() / 1000 / step) * step - (page || 0) * n * step;
  const out = []; let c = 5000;
  for (let i = n; i > 0; i--) { const t = end - i * step, o = c; c = o + (rnd(t) - 0.5) * 8; out.push([t, o, Math.max(o, c) + rnd(t + 1) * 3, Math.min(o, c) - rnd(t + 2) * 3, c, Math.round(100 + rnd(t + 3) * 900)]); }
  return out;
}

const DLG = '.vela-dialog--settings';
const isOpen = (p) => p.evaluate((s) => { const d = document.querySelector(s); return !!d && d.getBoundingClientRect().width > 0; }, DLG);
async function waitOpen(p) { for (let i = 0; i < 20; i++) { if (await isOpen(p)) { await p.waitForTimeout(400); return await isOpen(p); } await p.waitForTimeout(100); } return false; }
async function closeDlg(p) { await p.keyboard.press('Escape'); await p.waitForTimeout(300); if (await isOpen(p)) await p.evaluate(() => { try { window.STRYKER_VELA.cell(window.STRYKER_VELA.active.id).chart.renderer.closeDialogs(); } catch (e) {} }); await p.waitForTimeout(200); }
async function clickEl(p, fn, button) {
  const b = await p.evaluate((f) => { const el = (0, eval)('(' + f + ')')(); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; }, fn.toString());
  if (!b) return false;
  await p.mouse.click(b.x, b.y, { button: button || 'left' }); await p.waitForTimeout(300); return true;
}
async function rightClickSettings(p, at) {
  const r = at || await p.evaluate(() => { const c = [...document.querySelectorAll('.vela-cell canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]; const b = c.getBoundingClientRect(); return { x: b.left + b.width * 0.45, y: b.top + b.height * 0.5 }; });
  await p.mouse.click(r.x, r.y, { button: 'right' }); await p.waitForTimeout(400);
  const item = await p.evaluate(() => { const it = [...document.querySelectorAll('[role=menuitem], .vela-menu-item, .vela-ctx-item')].filter((e) => e.getBoundingClientRect().width > 0).find((e) => /^Settings/.test(e.textContent.trim())); if (!it) return null; const b = it.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, t: it.textContent.trim() }; });
  if (!item) return { menu: false };
  await p.mouse.click(item.x, item.y);
  return { menu: true, open: await waitOpen(p) };
}

(async () => {
  const b = await launch();
  try {
    for (const theme of (process.env.ONLY_THEME ? [process.env.ONLY_THEME] : ['dark', 'light'])) {
      for (const vp of [{ w: 1440, h: 900 }, { w: 1100, h: 760 }].filter((v) => !process.env.ONLY_W || String(v.w) === process.env.ONLY_W)) {
        const tag = theme + ' ' + vp.w;
        const ctx = await b.newContext({ viewport: { width: vp.w, height: vp.h } });
        await ctx.addInitScript(stub);
        await ctx.addInitScript((th) => { try { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.clear(); } ['stryker_install_prompt_shown_u1', 'stryker_push_prompt_shown_u1', 'stryker_community_disclaimer_ack_v1'].forEach((k) => localStorage.setItem(k, '1')); localStorage.setItem('stryker_theme', th === 'light' ? 'day' : 'night'); localStorage.setItem('stryker_chart_theme', th); } catch (e) {} }, theme);
        await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
        await ctx.route(/\/api\//, (r) => { const u = new URL(r.request().url()); if (u.pathname.startsWith('/api/chart/bars/')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ bars: bars(u.searchParams.get('tf'), +u.searchParams.get('page') || 0), rt: false }) }); return r.fulfill({ status: 404, body: '{}' }); });
        const p = await ctx.newPage();
        const errs = []; p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
        await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
        await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && document.querySelector('.vela-cell canvas') && document.getElementById('stkc-settings-btn'), null, { timeout: 60000 });
        await p.waitForTimeout(2500);
        // 1. right-click -> Settings…
        const rc = await rightClickSettings(p);
        check(rc.menu && rc.open, tag + ': right-click -> Settings… opens the settings window', rc);
        if (rc.open) await shot(p, 'set-' + theme + '-' + vp.w + '-rclick');
        // every tab renders a pane
        if (rc.open) {
          const tabs = await p.evaluate((s) => [...document.querySelectorAll(s + ' .vela-sd-tab')].map((t) => t.textContent.trim()), DLG);
          let bad = [];
          for (const t of tabs) {
            await clickEl(p, new Function('return [...document.querySelectorAll(".vela-dialog--settings .vela-sd-tab")].find((x) => x.textContent.trim() === ' + JSON.stringify(t) + ')'));
            const ok = await p.evaluate((s) => { const d = document.querySelector(s); const pane = d && d.querySelector('.vela-sd-pane'); return !!pane && pane.children.length > 0 && pane.getBoundingClientRect().height > 40; }, DLG);
            if (!ok || !(await isOpen(p))) bad.push(t);
          }
          check(tabs.length >= 3 && !bad.length, tag + ': every tab opens a pane, dialog stays open', { tabs, bad });
        }
        await closeDlg(p);
        check(!(await isOpen(p)), tag + ': Escape closes it');
        // 2. top-bar gear
        const g = await clickEl(p, () => document.getElementById('stkc-settings-btn'));
        check(g && await waitOpen(p), tag + ': top-bar gear opens it');
        await closeDlg(p);
        // 3. engine gears (bottom bar / in-chart), whichever are on screen
        const gears = await p.evaluate(() => [...document.querySelectorAll('button[aria-label*="ettings" i], button[title*="ettings" i]')].filter((e) => e.id !== 'stkc-settings-btn' && e.closest('.vela-cell, .vela-ws, .vela-bottom-bar, .vela-root') && e.getBoundingClientRect().width > 0).map((e) => (e.getAttribute('aria-label') || e.title)));
        for (let i = 0; i < gears.length; i++) {
          await clickEl(p, new Function('return [...document.querySelectorAll(\'button[aria-label*="ettings" i], button[title*="ettings" i]\')].filter((e) => e.id !== "stkc-settings-btn" && e.closest(".vela-cell, .vela-ws, .vela-bottom-bar, .vela-root") && e.getBoundingClientRect().width > 0)[' + i + ']'));
          check(await waitOpen(p), tag + ': engine gear "' + gears[i] + '" opens it');
          await closeDlg(p);
        }
        // 4. other charts: futures, DXY, and the second chart of a 2-chart layout
        for (const sym of ['futures:NQ1!', 'DXY']) {
          await p.evaluate((sy) => { const ws = window.STRYKER_VELA; try { ws.cell(ws.active.id).setSymbol(sy); } catch (e) {} }, sym);
          await p.waitForTimeout(1500);
          const r = await rightClickSettings(p);
          check(r.menu && r.open, tag + ': ' + sym + ' chart: right-click -> Settings… opens', r);
          await closeDlg(p);
        }
        await p.evaluate(() => window.STRYKER_CHART_UI.setLayout('2h')); await p.waitForTimeout(2500);
        const cells = await p.evaluate(() => [...document.querySelectorAll('.vela-cell')].filter((c) => c.getBoundingClientRect().width > 0).length);
        const r2 = await p.evaluate(() => { const cs = [...document.querySelectorAll('.vela-cell')].filter((c) => c.getBoundingClientRect().width > 0); const cv = [...cs[cs.length - 1].querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]; const b = cv.getBoundingClientRect(); return { x: b.left + b.width * 0.45, y: b.top + b.height * 0.5 }; });
        await p.mouse.click(r2.x, r2.y); await p.waitForTimeout(300);
        const rc2 = await rightClickSettings(p, r2);
        check(cells >= 2 && rc2.menu && rc2.open, tag + ': 2-chart layout, second chart: right-click -> Settings… opens', { cells, rc2 });
        await closeDlg(p);
        await p.evaluate(() => window.STRYKER_CHART_UI.setLayout('1')); await p.waitForTimeout(1500);
        // 5. candle colour: change Up candle body colour with real clicks, Ok, then reload -> still that colour (1440 only)
        if (vp.w === 1440) {
          const upSw = () => [...document.querySelectorAll('.vela-dialog--settings .vela-sd-pane .vela-color-field')].find((e) => e.getBoundingClientRect().width > 0);   // Candles > Body, up colour
          const swCol = () => p.evaluate((f) => { const e = (0, eval)('(' + f + ')')(); const s = e && e.querySelector('.vela-color-field-swatch'); return s ? s.style.background.split(')')[0] + ')' : null; }, upSw.toString());
          const symTab = () => [...document.querySelectorAll('.vela-dialog--settings .vela-sd-tab')].find((x) => x.textContent.trim() === 'Symbol');
          await rightClickSettings(p); await clickEl(p, symTab);
          const before = await swCol();
          const opened = await clickEl(p, upSw);
          const pick = await clickEl(p, () => [...document.querySelectorAll('.vela-color-field-pop button')].find((x) => x.style.background && /51, 100, 235/.test(x.style.background)));
          const mid = await swCol();
          await clickEl(p, () => [...document.querySelectorAll('.vela-dialog--settings .vela-sd-btn')].find((x) => x.textContent.trim() === 'Ok'));
          await p.waitForTimeout(400);
          const applied = await p.evaluate(() => { const R = window.STRYKER_VELA.cell(window.STRYKER_VELA.active.id).chart.renderer; const g = R.getConfig ? R : R.renderer; const j = JSON.stringify(g && g.getConfig ? g.getConfig() : {}).toLowerCase(); return j.includes('3364eb') || j.includes('51, 100, 235') || j.includes('51,100,235'); });
          check(pick && mid && /51, 100, 235/.test(mid) && mid !== before, tag + ': Up candle body colour changed in the window', { before, mid });
          check(applied, tag + ': Up candle body colour applied to the chart');
          await p.waitForTimeout(2500);   // session save is debounced
          await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });   // a reload (the page rewrites its URL to /charts/<id>, a server route)
          await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && document.querySelector('.vela-cell canvas') && document.getElementById('stkc-settings-btn'), null, { timeout: 60000 });
          await p.waitForTimeout(2500);
          await rightClickSettings(p); await clickEl(p, symTab);
          const after = await swCol();
          check(after && /51, 100, 235/.test(after), tag + ': Up candle body colour kept after reload', after);
          await shot(p, 'set-' + theme + '-' + vp.w + '-after-reload');
          await closeDlg(p);
        }
        const realErrs = errs.filter((e) => !/docChanges|Failed to load resource|net::ERR|WebSocket|binance/i.test(e));
        check(!realErrs.length, tag + ': no page/console errors', realErrs.slice(0, 5));
        await ctx.close();
      }
    }
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
