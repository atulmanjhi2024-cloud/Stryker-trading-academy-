// Zoom to selection: tap/Cancel/idle cancel on a phone, desktop drag still works. Needs chart-dev-server on 8097.
const { launch } = require('./lib.js'); const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8097'; let fail = 0;
const ok = (c, m, x) => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + m, x === undefined ? '' : JSON.stringify(x)); };
(async () => {
  const b = await launch();
  try {
    for (const phone of [true, false]) {
      const ctx = await b.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 }, hasTouch: phone, isMobile: phone });
      await ctx.addInitScript(stub);
      await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
      await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
      const p = await ctx.newPage();
      await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.__stkSelZoom, null, { timeout: 45000 });
      await p.waitForTimeout(3000);
      const n = () => p.locator('.stkz-ov').count();
      console.log('--- ' + (phone ? '390 touch' : '1440'));
      const start = async () => { if (phone) { await p.waitForSelector('.stkz-pb:not([hidden])', { timeout: 5000 }); await p.locator('.stkz-pb').tap(); } else await p.evaluate(() => window.__stkSelZoom.start()); await p.waitForSelector('.stkz-ov'); };
      const ovc = () => p.evaluate(() => { const o = document.querySelector('.stkz-ov').getBoundingClientRect(); return [o.left + o.width / 2, o.top + o.height / 2, o.width, o.height]; });
      const vr = () => p.evaluate(() => { const W = window.STRYKER_VELA; return JSON.stringify(W.cell(W.context().cells[0].id).chart.getVisibleRange()); });
      if (phone) { const r = await p.evaluate(() => { const b = document.querySelector('.stkz-pb'); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left, r.top, r.width]; }); console.log('pb', r); }
      await start();
      const hx = await p.evaluate(() => { const r = document.querySelector('.stkz-hx').getBoundingClientRect(); return [r.width, r.height, document.querySelector('.stkz-ht').textContent]; });
      ok(hx[0] >= 44 && hx[1] >= 44, 'cancel target >= 44', hx);
      if (phone) { ok(!/Esc/.test(hx[2]), 'no Esc text on phone'); await p.screenshot({ path: '/tmp/zf-hint-390.png' }); }
      const [cx, cy] = await ovc();
      if (phone) await p.touchscreen.tap(cx, cy); else await p.mouse.click(cx, cy);
      await p.waitForTimeout(200); ok(await n() === 0, 'tap cancels');
      await start(); await p.locator('.stkz-hx').click(); await p.waitForTimeout(200); ok(await n() === 0, 'Cancel button cancels');
      await start();
      await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      await p.waitForTimeout(200); ok(await n() === 0, 'background cancels');
      await p.evaluate(() => { delete document.hidden; });
      await start();
      await p.evaluate(() => { const W = window.STRYKER_VELA; const c = W.cell(W.context().cells[0].id); c.setTimeframe(String(c.timeframe) === '5' ? '15' : '5'); });
      await p.waitForTimeout(900); ok(await n() === 0, 'timeframe change cancels');
      await start(); await p.waitForTimeout(20600); ok(await n() === 0, '20s idle cancels');
      const v0 = await vr();
      const cv = await p.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
      await p.mouse.move(cv[0], cv[1]); await p.mouse.down(); await p.mouse.move(cv[0] + 120, cv[1], { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(300);
      ok(v0 !== await vr(), 'pan works after cancel');
      ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll');
      if (!phone) {
        await start(); const [x, y, w, h] = await ovc();
        await p.mouse.move(x - w * 0.1, y - h * 0.2); await p.mouse.down(); await p.mouse.move(x + w * 0.2, y + h * 0.2, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(300);
        ok(await p.locator('.stkz-choose').count() === 1, 'drag shows chooser');
        await p.locator('.stkz-opt-same').click(); await p.waitForTimeout(800);
        ok(await p.evaluate(() => window.__stkSelZoom.stackSize) === 1, 'zoom applied (Back stack 1)');
      }
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAIL' : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
