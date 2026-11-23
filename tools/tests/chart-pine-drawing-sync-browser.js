// Browser check: a short label/array script adds to a deep chart (20000 bars) and draws labels, well inside the run cap.
//   CHART_BASE=http://127.0.0.1:8097 OUT=/tmp/x TAG=after flock /tmp/stryker-chrome.lock node tools/tests/chart-pine-drawing-sync-browser.js
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8097';
const OUT = process.env.OUT || '/tmp';
const SRC = `//@version=5
indicator("Swing labels", overlay=true, max_labels_count=500)
var curr = array.new_float(2, 0.0)
var lbls = array.new_label(0)
array.set(curr, 0, bar_index)
array.set(curr, 1, high)
lb = label.new(bar_index, high, "H")
array.push(lbls, lb)
label.set_xy(lb, array.get(curr, 0), array.get(curr, 1))
plot(array.get(curr, 1), "H")
`;
(async () => {
  const b = await launch(); let fails = 0;
  for (const [w, h, theme] of [[1440, 900, 'dark'], [1440, 900, 'light'], [390, 844, 'dark']]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500 });
    await ctx.addInitScript(stub);
    await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t); localStorage.setItem('theme', t); } catch (e) {} document.documentElement.setAttribute('data-theme', t); }, theme);
    await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net|api\.binance|data-api\.binance|fapi\.binance|stream\.binance|data-stream\.binance)/, (r) => r.abort());
    const p = await ctx.newPage();
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_PINE, null, { timeout: 60000 });
    await p.evaluate(() => { const c = window.STRYKER_VELA.cell(window.STRYKER_VELA.context().cells[0].id); c.setSymbol('futures:NQ1!'); c.setTimeframe('1'); });
    await p.waitForTimeout(8000); console.log('loaded', w, theme);
    const r = await p.evaluate(async (src) => {
      const chart = window.STRYKER_VELA.context().cells[0].chart;
      try { await chart.setMarket({ bars: 20000 }); await chart.historyComplete(); } catch (e) {}
      const t = Date.now();
      const res = await window.STRYKER_PINE.runOnChart(chart, src, {}, false, { engine: 'next', inline: true });
      return { ok: res && res.ok, heavy: res && res.heavy, msg: res && res.msg, ms: Date.now() - t, bars: chart.orchestrator.rawBars.length };
    }, SRC);
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `${OUT}/pine20s-${process.env.TAG || 'after'}-${w}-${theme}.png` });
    console.log('run', w, theme, JSON.stringify(r));
    if (!r.ok) fails++;
    await ctx.close();
  }
  await b.close(); process.exit(fails ? 1 : 0);
})();
