// Chart toasts at the bottom-left of the chart pane on desktop/tablet (Owner 19 Nov); phones keep the top.
//   node tools/tests/chart-fixture-server.mjs 8241 tools/tests/fixtures/monitor-live.json &
//   CHART_BASE=http://127.0.0.1:8241 flock /tmp/stryker-chrome.lock node tools/tests/toast-pos-browser.js <outDir>
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8241', OUT = process.argv[2] || '.';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
(async () => {
  const b = await launch();
  const cases = [[1440, 900], [1024, 768], [390, 844]];
  for (const [w, h] of cases) for (const theme of ['dark', 'light']) for (const mode of w < 700 ? ['plain'] : ['plain', 'panel', 'dock']) {
    const tag = w + '-' + theme + '-' + mode;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 700, hasTouch: w < 700 });
    await ctx.addInitScript(stub);
    await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1'); } catch (e) {} window.__stkOfTestTier = { free: false, plan: 'Pro', admin: true }; window.__stkChartTestFree = false; }, theme);
    await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => { try { return !!window.STRYKER_VELA.chart.renderer.renderer.userDrawings; } catch (e) { return false; } }, null, { timeout: 60000 });
    await sleep(2500);
    await p.evaluate(() => window.__stkPaper && window.__stkPaper.setEnabled(true));
    if (mode === 'panel') { await p.evaluate(() => { const bt = document.querySelector('.stkbp-railbtn'); if (bt) bt.click(); }); await sleep(1200); }
    if (mode === 'dock') { await p.evaluate(() => { const bt = document.querySelector('.stkw-railbtn:not(.stkbp-railbtn)'); if (bt) bt.click(); }); await sleep(1200); }
    await p.evaluate(() => {
      const P = window.__stkPaper; try { P.placeOrder({ symbol: P.activeSymbol(), side: 'buy', type: 'limit', qty: 1, price: (P.lastPrice(P.activeSymbol()) || 100) * 0.9 }); } catch (e) {}
      window.showToast('info', 'Alert: BTCUSDT', { description: 'Price 64,000 · test', hold: true });
      window.showToast('error', 'Order refused: sample error');
    });
    await sleep(900);
    const m = await p.evaluate(() => {
      const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
      const cell = document.querySelector('.vela-cell'), cr = R(cell);
      const ts = [...document.querySelectorAll('#stryker-toast-host .toast, .stkpt-toast')].filter((e) => e.offsetWidth).map(R);
      const bb = document.querySelector('.vela-widget-bottombar'), ax = bb ? R(bb) : null;
      const brand = document.querySelector('.tz-brand'), br = brand ? R(brand) : null;
      const hint = window.__stkBarStatsDebug && window.__stkBarStatsDebug.msg;
      return { cell: cr, ts, axisTop: ax && ax.t > 0 ? ax.t : null, brand: br, hint, host: (() => { const h = document.getElementById('stryker-toast-host'); return h && h.className; })() };
    });
    await p.screenshot({ path: OUT + '/' + tag + '.png' });
    const T = m.ts;
    if (w >= 768) {
      const minL = Math.min(...T.map((x) => x.l)), maxB = Math.max(...T.map((x) => x.b)), maxR = Math.max(...T.map((x) => x.r)), maxW = Math.max(...T.map((x) => x.r - x.l));
      check(T.length >= 3 && T.length <= 6, tag + ' toasts shown', T.length);
      check(m.axisTop == null || maxB <= m.axisTop - 12 + 0.5, tag + ' >=12px above the time axis', [maxB, m.axisTop]);
      check(minL >= m.cell.l + 12 - 0.5 && maxR <= m.cell.r, tag + ' inside the chart pane, 12px from its left', [minL, m.cell.l, maxR, m.cell.r]);
      check(Math.min(...T.map((x) => x.t)) > m.cell.t + (m.cell.b - m.cell.t) / 2 - 150, tag + ' in the lower part of the pane', Math.min(...T.map((x) => x.t)));
      check(maxW <= 361, tag + ' width <= 360', maxW);
      check(!m.brand || m.brand.r <= minL + 0.5 || m.brand.t >= Math.max(...T.map((x) => x.b)) || T.every((x) => x.t >= m.brand.b || x.l >= m.brand.r), tag + ' clear of the TZ mark', m.brand);
      const sorted = T.slice().sort((a, b) => a.t - b.t); let gapOk = true;
      for (let i = 1; i < sorted.length; i++) if (sorted[i].t - sorted[i - 1].b < 4 - 0.5) gapOk = false;
      check(gapOk, tag + ' stacked without overlap');
    } else {
      check(T.length >= 1 && T.every((x) => x.t < h / 2), tag + ' phone: toasts still on top', T.map((x) => x.t));
    }
    check(!errs.length, tag + ' no page errors', errs);
    await ctx.close();
  }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
