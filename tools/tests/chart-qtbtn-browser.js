// Quick Buy/Sell stays after the right order panel closes; one bottom panel only (no 'Paper trading' tab). Paper only.
//   node tools/tests/chart-dev-server.mjs 8041 &
//   CHART_BASE=http://127.0.0.1:8041 flock /tmp/stryker-chrome.lock node tools/tests/chart-qtbtn-browser.js <shotsDir> [tag]
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8041', OUT = process.argv[2] || '/tmp/qtbtn', TAG = process.argv[3] || 'after';
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };
const vis = (p, sel) => p.evaluate((s) => [...document.querySelectorAll(s)].some((e) => e.offsetWidth > 0 && e.offsetHeight > 0 && getComputedStyle(e).visibility !== 'hidden'), sel);
const wait = (p, fn, arg, ms = 8000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
(async () => {
  const b = await launch();
  try {
    for (const [w, theme] of [[1440, 'night'], [1440, 'day'], [390, 'night']]) {
      const L = w + ' ' + theme + ': ', mobile = w < 500;
      const ctx = await b.newContext({ viewport: { width: w, height: 900 }, isMobile: mobile, hasTouch: mobile });
      await ctx.addInitScript(stub);
      await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', t); } catch (e) {} }, theme);
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net|[a-z0-9.-]*hyperliquid\.xyz)/, (r) => r.abort());
      const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e.message || e)));
      await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
      await p.waitForTimeout(2500);
      await p.evaluate(() => window.__stkPaper.setEnabled(true));
      await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('hyperliquid:BTC'); ws.active.setTimeframe('1'); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.orchestrator.rawBars.length > 50) break; } });
      await p.waitForTimeout(2500);
      // 1) quick Buy/Sell: open the right panel, close it, buttons must stay
      await p.evaluate(() => window.__stkPaper.orderPanel()); await wait(p, () => window.__stkOrderPanel && window.__stkOrderPanel.isOpen);
      check(await wait(p, () => { const e = document.querySelector('.stkpt-1c'); return e && e.offsetWidth > 0; }), L + 'quick Buy/Sell shown with the order panel open');
      await p.screenshot({ path: OUT + '/' + TAG + '-' + w + '-' + theme + '-panel-open.png' });
      await p.evaluate(() => window.__stkOrderPanel.close()); await p.waitForTimeout(2500);
      const q = await vis(p, '.stkpt-1c');
      check(q, L + 'quick Buy/Sell STILL visible after the order panel closes');
      if (q) {
        const m = await p.evaluate(() => { const o = document.querySelector('.stkpt-1c').getBoundingClientRect(), r = [...document.querySelectorAll('.stkpt-1c > *')].map((e) => e.getBoundingClientRect()), cy = r.map((x) => x.y + x.height / 2); return { spread: Math.max(...cy) - Math.min(...cy), left: o.left, right: o.right, vw: innerWidth, hs: document.documentElement.scrollWidth - innerWidth }; });
        check(m.spread <= 1 && m.right <= m.vw && m.hs <= 0, L + 'quick box one centre line, inside the screen, no horizontal scroll', m);
      }
      await p.screenshot({ path: OUT + '/' + TAG + '-' + w + '-' + theme + '-panel-closed.png' });
      // still a one-click paper order works (paper only)
      if (q && w === 1440 && theme === 'night') {
        await p.click('.stkpt-1c-b');
        check(await wait(p, () => Object.keys(window.__stkPaper.account.state.positions).length === 1), L + 'one-click Buy opens a paper position with the panel closed');
      }
      // user can hide it with the setting
      await p.evaluate(() => { window.__stkPaper.account.settings.oneClick = false; window.__stkPaper.renderAll(); });
      check(await wait(p, () => !document.querySelector('.stkpt-1c'), null, 5000), L + 'quick Buy/Sell hides when the user turns the setting off');
      await p.evaluate(() => { window.__stkPaper.account.settings.oneClick = true; window.__stkPaper.renderAll(); });
      // 2) one bottom panel: no visible 'Paper trading' tab in the bottom bar, Positions & Orders present
      if (!mobile) {
        check(!(await vis(p, '.vela-widget-bottombar .stkpt-toggle')), L + "no second 'Paper trading' tab in the bottom bar (panel closed)");
        await p.evaluate(() => window.__stkOrderPanel.open()); await p.waitForTimeout(1500);
        check(!(await vis(p, '.vela-widget-bottombar .stkpt-toggle')), L + "no 'Paper trading' tab with the right panel open");
        check(await vis(p, '#stkpo-btn'), L + 'Positions & Orders tab present');
        await p.evaluate(() => window.__stkPaper.openPanel('positions')); await p.waitForTimeout(500);
        check(await vis(p, '#stkpo-dock') && !(await vis(p, '.stkpt.in-bar.open')), L + 'opening the paper panel opens Positions & Orders, not a second panel');
        await p.screenshot({ path: OUT + '/' + TAG + '-' + w + '-' + theme + '-bottom.png' });
      }
      check(errs.length === 0, L + 'no console errors', errs);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED'); process.exit(fail ? 1 : 0);
})();
