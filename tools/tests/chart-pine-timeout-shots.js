// Screenshots + alignment checks for the Pine editor states touched by the timeout fix (member report 22 Nov 2026):
// "Running on the chart… n% of bars" while a heavy script computes, and the clear-reason error (v4 script).
//   CHART_BASE=http://127.0.0.1:8077 flock /tmp/stryker-chrome.lock node tools/tests/chart-pine-timeout-shots.js <outDir>
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const fs = require('fs');
const path = require('path');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8077';
const OUT = process.argv[2] || '/tmp/pinetimeout-shots';
const FX = path.join(__dirname, 'fixtures', 'pine', 'timeout');
fs.mkdirSync(OUT, { recursive: true });
// deliberately slow (Sample data): ~1,000 inner steps a bar so the progress state is visible for a few seconds
const SLOW = '//@version=5\nindicator("Progress demo (sample)")\nfloat s = 0.0\nfor i = 0 to 1500\n    s += math.sin(i * close)\nplot(s, "s")\n';
const V4 = fs.readFileSync(path.join(FX, '13-v4-classic.pine'), 'utf8');
let fails = 0;
(async () => {
  const b = await launch();
  try {
    for (const [w, h] of [[1440, 900], [412, 915], [390, 844]]) for (const theme of ['dark', 'light']) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      await ctx.addInitScript(stub);
      await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', t); localStorage.setItem('theme', t); } catch (e) {} }, theme);
      await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
      const p = await ctx.newPage();
      await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_PINE, null, { timeout: 60000 });
      await p.evaluate((t) => { document.documentElement.dataset.theme = t; document.documentElement.classList.toggle('light', t === 'light'); document.documentElement.classList.toggle('dark', t === 'dark'); }, theme);
      await p.evaluate(() => { const c = window.STRYKER_VELA.cell(window.STRYKER_VELA.context().cells[0].id); c.setSymbol('futures:NQ1!'); c.setTimeframe('5'); });
      await p.waitForFunction(() => { try { return window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 300; } catch (e) { return false; } }, null, { timeout: 60000 });
      await p.evaluate(async (DEEP) => { const ch = window.STRYKER_VELA.context().cells[0].chart; await ch.setMarket({ bars: DEEP }); await ch.historyComplete(); }, 5000);
      for (const [tag, src] of [['progress', SLOW], ['v4-reason', V4]]) {
        await p.evaluate((src) => { window.STRYKER_PINE.open(); window.STRYKER_PINE.load('Sample', src); }, src);
        await p.waitForTimeout(1500);
        const vis = async () => p.evaluate(() => { const e = [...document.querySelectorAll('.sed-prob-hd')].find((x) => x.offsetParent); return e ? e.textContent : null; });
        await p.evaluate(() => { const btn = [...document.querySelectorAll('.stkc-zs-run')].find((x) => x.offsetParent); btn && btn.click(); });
        if (tag === 'progress') { for (let i = 0; i < 60; i++) { await p.waitForTimeout(150); if (/% of bars/.test(await vis() || '')) break; } }
        else { for (let i = 0; i < 80; i++) { await p.waitForTimeout(150); if (/isn't supported/.test(await vis() || '') || /Line 1/.test(await p.evaluate(() => document.querySelector('.sed-prob') && document.querySelector('.sed-prob').textContent))) break; } }
        if (tag !== 'progress') await p.waitForTimeout(1600);   // past hideVelaErrorToast's last sweep
        const m = await p.evaluate(() => {
          const hd = [...document.querySelectorAll('.sed-prob-hd')].find((x) => x.offsetParent); if (!hd) return null;
          const r = hd.getBoundingClientRect(), kids = [...hd.children].map((k) => k.getBoundingClientRect());
          const cy = kids.map((k) => k.top + k.height / 2);
          const txt = hd.lastElementChild;
          return { text: hd.textContent, centreSpread: cy.length > 1 ? Math.max(...cy) - Math.min(...cy) : 0, clipped: txt ? txt.scrollWidth > txt.clientWidth + 1 : false, inBox: kids.every((k) => k.left >= r.left - 0.5 && k.right <= r.right + 0.5), hscroll: document.documentElement.scrollWidth > innerWidth + 1, rawToast: document.querySelectorAll('.vela-toast[data-type="error"][data-open]').length, row: [...document.querySelectorAll('.sed-prob-row')].filter((x) => x.offsetParent).map((x) => x.textContent).join(' | ') };
        });
        const f = path.join(OUT, `pinetimeout-${tag}-${w}-${theme}.png`);
        await p.screenshot({ path: f });
        const ok = m && m.centreSpread <= 1 && !m.hscroll && m.inBox && !m.rawToast && (tag === 'progress' ? /% of bars|Running on the chart/.test(m.text) : /isn't supported/.test(m.row));
        if (!ok) fails++;
        console.log(`${ok ? 'PASS' : 'FAIL'} ${tag} ${w} ${theme} ${JSON.stringify(m)} -> ${f}`);
        await p.waitForTimeout(tag === 'progress' ? 8000 : 300);
      }
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
