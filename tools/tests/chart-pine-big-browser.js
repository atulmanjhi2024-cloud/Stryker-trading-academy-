// Big Pine script (130 KB, 2,000+ lines) saves, reloads from My scripts and runs; 300 KB shows the clear message.
//   node tools/tests/chart-dev-server.mjs 8091 &  ;  CHART_BASE=http://localhost:8091 tools/chrome-slot.sh node tools/tests/chart-pine-big-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const gen = require('./pine-big-gen.js');
const BASE = process.env.CHART_BASE || 'http://localhost:8091';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x !== undefined && !ok ? ' ' + JSON.stringify(x) : '')); };
(async () => {
  const b = await launch();
  try {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500 });
      await ctx.addInitScript(stub);
      await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
      await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
      const p = await ctx.newPage(); const errs = [];
      p.on('pageerror', (e) => errs.push(String(e)));
      await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_PINE, null, { timeout: 60000 });
      await p.evaluate(() => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol('futures:NQ1!'); c.setTimeframe('5'); });
      await p.evaluate(async () => { for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 400)); try { if (window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 50) break; } catch (e) {} } });
      const big = gen(130); let huge = gen(300); huge += "//" + "x".repeat(300 * 1024 - huge.length - 3) + "\n";
      const r = await p.evaluate(async ([big, huge]) => {
        const P = window.STRYKER_PINE, S = window.StrykerPineScripts, out = {};
        P.open(); await new Promise((r) => setTimeout(r, 1500));
        P.load('EMA 9/21 cross', big, null, 'new');
        await new Promise((r) => setTimeout(r, 800));
        const t0 = performance.now();
        await P.addToChart();
        out.runMs = Math.round(performance.now() - t0);
        const chart = window.STRYKER_VELA.context().cells[0].chart;
        out.handles = P.pineHandles(chart).length;
        const el = document.querySelector('#stkc-pine .sed-prob-hd, .sed-prob-hd');
        out.prob = el ? el.textContent : '';
        const id = await S.save('Big test', big, null);
        const l = await S.list();
        const it = (l.items || []).find((x) => x.id === id);
        out.saved = !!it && it.source.length === big.length;
        try { await S.save('Huge', huge, null); out.hugeSave = 'accepted'; } catch (e) { out.hugeSave = e.userMessage; }
        P.load('Huge', huge, null, 'new');
        await new Promise((r) => setTimeout(r, 500));
        await P.addToChart();
        await new Promise((r) => setTimeout(r, 500));
        out.hugeRun = [...document.querySelectorAll('#stkc-pine .sed-prob-row, #stkc-pine .sed-status, #stkc-pine .sed-prob-hd')].map((x) => x.textContent).join(' | ');
        return out;
      }, [big, huge]);
      console.log(w, JSON.stringify(r));
      check(r.handles === 1, w + ': 130 KB script runs on chart (no time-out)', r);
      check(r.saved, w + ': 130 KB script saves and reloads from My scripts', r);
      check(/too long( to save)? \(300 KB, limit 256 KB\)/.test(r.hugeSave || ''), w + ': 300 KB save message', r.hugeSave);
      check(/too long( to save)? \(300 KB, limit 256 KB\)/.test(r.hugeRun || ''), w + ': 300 KB run message', r.hugeRun);
      await p.screenshot({ path: `${OUT}/pinebig-${w}.png` });
      check(errs.length === 0, w + ': no page errors', errs.slice(0, 3));
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
