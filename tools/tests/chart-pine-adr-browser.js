// Browser check: a Pine "ADR dashboard" (14 daily bars via request.security on other futures symbols + table.cell)
// must fill its table on the real charts page. Bars are recorded fixtures (fixtures/pine/adr-bars.json), no network.
//   python3 -m http.server 8195 (repo root) &
//   NODE_PATH=<repo>/node_modules tools/chrome-slot.sh node tools/tests/chart-pine-adr-browser.js [shotsDir]
// Env: BASE (default http://127.0.0.1:8195), SRC_FILE (Pine source; default tools/tests/fixtures/pine/adr-dashboard.pine), TF (default 5)
const fs = require('fs'), path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || process.env.BASE || 'http://127.0.0.1:8195';
const OUT = process.argv[2] || '/tmp';
const SRC = fs.readFileSync(process.env.SRC_FILE || path.join(__dirname, 'fixtures', 'pine', 'adr-dashboard.pine'), 'utf8');
let fails = 0; const check = (ok, m) => { console.log((ok ? 'PASS ' : 'FAIL ') + m); if (!ok) fails++; };
// Recorded "Sample data" bars (no network): pages are served newest-first by their offset from the first page the chart asks for.
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pine', 'adr-bars.json'), 'utf8')).bars;
const TOP = { D: 28, 5: 10390 };   // page numbers the fixture was recorded at (newest first); older pages are index TOP - page
const fixtureBars = (pathname, search) => {
  const root = decodeURIComponent(pathname.split('/').pop()), q = new URLSearchParams(search), tf = q.get('tf'), pg = +q.get('page');
  const pages = FIX[root + '|' + tf];
  return JSON.stringify({ s: root, tf, page: pg, bars: (pages && pages[TOP[tf] - pg]) || [] });
};
(async () => {
  const b = await launch();
  try {
    for (const v of [{ tag: 'd1440', w: 1440, h: 900, theme: 'dark' }, { tag: 'l1440', w: 1440, h: 900, theme: 'day' }, { tag: 'd390', w: 390, h: 844, theme: 'dark', mobile: true }]) {
      const ctx = await b.newContext({ viewport: { width: v.w, height: v.h }, isMobile: !!v.mobile, hasTouch: !!v.mobile });
      await ctx.addInitScript(stub);
      await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_script_lang', 'pine'); localStorage.setItem('stryker_theme', t); } catch (e) {} }, v.theme);
      // the table is painted on a canvas: read it from the models the Pine worker posts
      await ctx.addInitScript(() => { const W = window.Worker; window.__adrModels = []; window.Worker = function (...a) { const w = new W(...a); w.addEventListener('message', (e) => { const m = e.data; if (m && m.kind === 'model' && m.model && m.model.tables && m.model.tables.length) window.__adrModels.push(m.model.tables[0].cells.map((r) => r.map((c) => (c ? c.text : '')).join(' | '))); }); return w; }; window.Worker.prototype = W.prototype; });
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
      await ctx.route(/\/api\/chart\/bars\//, async (r) => { const u = new URL(r.request().url()); r.fulfill({ status: 200, contentType: 'application/json', body: fixtureBars(u.pathname, u.search) }); });
      const p = await ctx.newPage(); const errs = []; const reqs = []; p.on('request', (q) => { if (/api\/chart\/bars/.test(q.url())) reqs.push(q.url().replace(/^.*bars\//, '')); }); p.on('pageerror', (e) => errs.push(String(e)));
      await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_PINE, null, { timeout: 60000 });
      const TF = process.env.TF || '5';
      await p.evaluate(async (tf) => {
        const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:MNQ1!'); ws.active.setTimeframe(tf);
        const c = ws.chart;
        for (let i = 0; i < 160; i++) { await new Promise((r) => setTimeout(r, 250)); if (c.market.symbol === 'futures:MNQ1!' && c.market.timeframe === tf && c.orchestrator.rawBars.length > 50) break; }
      }, TF);
      await p.waitForTimeout(1500);
      const r = await p.evaluate(async (src) => {
        const P = window.STRYKER_PINE; P.open(); P.load('adr', src, null);
        await P.addToChart();
        const e = document.querySelector('.stkc-pine-err');
        return { err: e && !e.hidden ? e.textContent : '' };
      }, SRC);
      await p.evaluate(() => { try { window.STRYKER_PINE.close(); } catch (e) {} });
      let rows = [];
      for (let i = 0; i < 120; i++) { await p.waitForTimeout(500); rows = await p.evaluate(() => window.__adrModels[window.__adrModels.length - 1] || []); if (rows.length && /\d/.test((rows[1] || '').split(' | ')[1] || '')) break; }
      if (process.env.DEBUG) console.log(JSON.stringify(reqs));
      console.log(v.tag, JSON.stringify(rows));
      await p.waitForTimeout(5500);   // let the "Added" toast go before the shot
      await p.screenshot({ path: `${OUT}/adr-${v.tag}.png` });
      check(!r.err, v.tag + ': script added without error ' + r.err);
      const body = rows.slice(1, 4);
      check(body.length === 3 && body.every((x) => /^\w+1! \| [\d,.]+ \| [\d,.]+ +\(\d+%\)/.test(x)), v.tag + ': 3 symbol rows hold ADR and range values (not "-")');
      check(!errs.length, v.tag + ': no page errors ' + errs.slice(0, 1));
      await ctx.close();
    }
  } catch (e) { check(false, 'run: ' + (e && e.stack || e)); }
  finally { await b.close(); }
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
