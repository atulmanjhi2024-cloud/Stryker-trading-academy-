// Hide drawings / Hide indicators / Hide both + show again (left column eye button + its ▸ menu). Indicators are
// hidden, never removed; state kept per chart and restored. One-tap eye still hides drawings. Run:
//   node tools/tests/chart-dev-server.mjs 8097 &  CHART_BASE=http://127.0.0.1:8097 node tools/tests/chart-hide-all-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8097';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
const state = (p) => p.evaluate(() => {
  const c = window.STRYKER_VELA.active.chart;
  return { d: c.drawings.all().map((d) => d.visible !== false), i: c.indicators().map((h) => h.visible !== false), n: c.indicators().length };
});
async function menu(p, label) {
  await p.click('.stkt-hide .vela-dtb-arrow'); await p.waitForTimeout(300);
  const items = await p.evaluate(() => [...document.querySelectorAll('.stkt-fly .stkt-fly-i')].map((i) => i.textContent.trim()));
  if (label) { await p.locator('.stkt-fly .stkt-fly-i', { hasText: label }).first().click(); await p.waitForTimeout(400); }
  return items;
}
(async () => {
  const b = await launch();
  try {
    for (const [name, W, H, light, touch] of [['1440-dark', 1440, 900, false, false], ['1440-light', 1440, 900, true, false], ['1000-touch-dark', 1000, 800, false, true]]) {
      const ctx = await b.newContext({ viewport: { width: W, height: H }, hasTouch: false });
      await ctx.addInitScript(stub);
      await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
      await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
      const p = await ctx.newPage(); p.errors = []; p.on('pageerror', (e) => p.errors.push(String(e)));
      await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.__stkTvBars, null, { timeout: 45000 });
      await p.waitForFunction(() => { try { return !!window.STRYKER_VELA.active.chart.getVisibleRange(); } catch (e) { return false; } }, null, { timeout: 30000 });
      await p.waitForTimeout(3500);
      if (light) { await p.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light'); window.STRYKER_VELA.setTheme('light'); }); await p.waitForTimeout(500); }
      await p.evaluate(() => {
        const c = window.STRYKER_VELA.active.chart; const r = c.getVisibleRange(); const mid = (r.from + r.to) / 2;
        c.drawings.add('hline', { anchors: [{ time: mid, price: 30000 }] });
        c.addNativeIndicator('ema'); c.addNativeIndicator('rsi');
      });
      await p.waitForTimeout(1500);
      const cdp = await ctx.newCDPSession(p);
      const touchAt = async (sel) => { const r = await p.locator(sel).first().boundingBox(); const x = r.x + r.width / 2, y = r.y + r.height / 2; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
      const tap = async (sel) => { if (touch) await touchAt(sel); else await p.click(sel); await p.waitForTimeout(400); };
      let s = await state(p); const n = s.n;
      check(n >= 2 && s.d.length >= 1 && s.i.every(Boolean) && s.d.every(Boolean), name + ': start all visible', s);
      await p.screenshot({ path: `${OUT}/hideall-before-${name}.png` });
      // one tap = drawings only
      await tap('.stkt-hide .vela-dtb-icon'); s = await state(p);
      check(s.d.every((v) => !v) && s.i.every(Boolean), name + ': one tap hides drawings only', s);
      await tap('.stkt-hide .vela-dtb-icon'); s = await state(p);
      check(s.d.every(Boolean), name + ': one tap again shows drawings', s);
      // menu
      await tap('.stkt-hide .vela-dtb-arrow');
      let items = await p.evaluate(() => [...document.querySelectorAll('.stkt-fly .stkt-fly-i')].map((i) => i.textContent.trim()));
      check(items.join('|') === 'Hide drawings|Hide indicators|Hide both', name + ': menu has three choices', items);
      if (name === '1440-dark') {
        const g = await p.evaluate(() => { const f = document.querySelector('.stkt-fly').getBoundingClientRect(); return [...document.querySelectorAll('.stkt-fly .stkt-fly-i')].map((i) => { const r = i.getBoundingClientRect(), t = i.querySelector('.stkt-fly-l').getBoundingClientRect(), ic = i.querySelector('.stkt-fly-ic').getBoundingClientRect(); return { dc: Math.abs((r.top + r.bottom) / 2 - (t.top + t.bottom) / 2), di: Math.abs((r.top + r.bottom) / 2 - (ic.top + ic.bottom) / 2), clip: t.right > f.right }; }); });
        check(g.every((x) => x.dc <= 1 && x.di <= 1 && !x.clip), 'menu rows centred, text not clipped', g);
      }
      await p.screenshot({ path: `${OUT}/hideall-menu-${name}.png` });
      const pick = async (label) => { const l = p.locator('.stkt-fly .stkt-fly-i', { hasText: label }).first(); if (touch) { const r = await l.boundingBox(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x + r.width / 2, y: r.y + r.height / 2 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); } else await l.click(); await p.waitForTimeout(500); };
      const open = async () => { await tap('.stkt-hide .vela-dtb-arrow'); };
      await pick('Hide indicators'); s = await state(p);
      check(s.i.length === n && s.i.every((v) => !v) && s.d.every(Boolean), name + ': indicators hidden, kept (' + n + '), drawings visible', s);
      await p.screenshot({ path: `${OUT}/hideall-after-${name}.png` });
      await open(); items = await p.evaluate(() => [...document.querySelectorAll('.stkt-fly .stkt-fly-i')].map((i) => i.textContent.trim()));
      check(items.includes('Show everything again'), name + ': menu offers show again', items);
      await pick('Show everything again'); s = await state(p);
      check(s.i.length === n && s.i.every(Boolean), name + ': indicators back', s);
      await open(); await pick('Hide both'); s = await state(p);
      check(s.i.every((v) => !v) && s.d.every((v) => !v) && s.i.length === n, name + ': both hidden', s);
      await open(); await pick('Show everything again'); s = await state(p);
      check(s.i.every(Boolean) && s.d.every(Boolean) && s.i.length === n, name + ': both back', s);
      // a user-hidden indicator stays hidden after hide + show
      await p.evaluate(() => window.STRYKER_VELA.active.chart.indicators()[0].setVisible(false)); await p.waitForTimeout(300);
      await open(); await pick('Hide indicators'); await open(); await pick('Show everything again'); s = await state(p);
      check(s.i[0] === false && s.i.slice(1).every(Boolean), name + ': indicator hidden by the member stays hidden', s);
      check(p.errors.length === 0, name + ': no page errors', p.errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
