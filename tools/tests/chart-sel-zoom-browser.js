// "Zoom to selection": drag a box, pick a timeframe, chart shows that range on it; Back returns; Esc cancels.
// Real pointer input; also checks alignment. Run:
//   node tools/tests/chart-dev-server.mjs 8097 &   flock /tmp/stryker-chrome.lock node tools/tests/chart-sel-zoom-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8097';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
const st = (p) => p.evaluate(() => { const W = window.STRYKER_VELA; const c = W.cell(W.context().cells[0].id); return { tf: String(c.timeframe), vr: c.chart.getVisibleRange(), sym: c.symbol, n: window.__stkSelZoom.stackSize }; });
async function ready(p) { await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.__stkSelZoom, null, { timeout: 45000 }); await p.waitForTimeout(3000); }
const rect = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, sw: e.scrollWidth, cw: e.clientWidth }; }, sel);
async function drag(p, fx0, fy0, fx1, fy1, touch) {
  const r = await p.evaluate(() => { const o = document.querySelector('.stkz-ov').getBoundingClientRect(); return { l: o.left, t: o.top, w: o.width, h: o.height }; });
  const a = [r.l + r.w * fx0, r.t + r.h * fy0], b = [r.l + r.w * fx1, r.t + r.h * fy1];
  if (touch) { await p.evaluate(([a, b]) => { const o = document.querySelector('.stkz-ov'); const ev = (t, x, y) => o.dispatchEvent(new PointerEvent(t, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, button: 0 })); ev('pointerdown', a[0], a[1]); for (let i = 1; i <= 8; i++) ev('pointermove', a[0] + (b[0] - a[0]) * i / 8, a[1] + (b[1] - a[1]) * i / 8); ev('pointerup', b[0], b[1]); }, [a, b]); }
  else { await p.mouse.move(...a); await p.mouse.down(); await p.mouse.move(...b, { steps: 8 }); await p.mouse.up(); }
  await p.waitForTimeout(300);
}
(async () => {
  const b = await launch();
  try {
    for (const [name, vp, theme, shots] of [['1440d', { width: 1440, height: 900 }, 'dark'], ['1440l', { width: 1440, height: 900 }, 'light'], ['390d', { width: 390, height: 844 }, 'dark']]) {
      const ctx = await b.newContext({ viewport: vp, hasTouch: vp.width < 500 });
      await ctx.addInitScript(stub);
      await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
      await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
      const p = await ctx.newPage(); p.errors = []; p.on('pageerror', (e) => p.errors.push(String(e)));
      await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
      await ready(p);
      await p.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); window.STRYKER_VELA.setTheme(t); }, theme);
      await p.waitForTimeout(600);
      const phone = vp.width < 500;
      console.log('--- ' + name);
      await p.screenshot({ path: `${OUT}/selzoom-before-${name}.png` });
      const s0 = await st(p);
      // start: toolbar menu on desktop, on-chart button on phone
      if (!phone) {
        await p.click('.stkt-zoom .vela-dtb-arrow'); await p.waitForTimeout(300);
        const item = p.locator('.stkt-fly-i', { hasText: 'Zoom to selection' });
        check(await item.count() === 1, 'zoom menu has "Zoom to selection"');
        await item.click();
      } else {
        await p.waitForSelector('.stkz-pb:not([hidden])', { timeout: 5000 });
        const pb = await rect(p, '.stkz-pb'); check(pb.w >= 40 && pb.h >= 40, 'phone button >= 40px', pb);
        await p.click('.stkz-pb');
      }
      await p.waitForSelector('.stkz-ov');
      // Esc cancels
      await p.keyboard.press('Escape'); await p.waitForTimeout(150);
      check(await p.locator('.stkz-ov').count() === 0, 'Esc cancels (overlay gone)');
      check(JSON.stringify((await st(p)).vr) === JSON.stringify(s0.vr), 'Esc leaves range unchanged');
      await p.keyboard.press('Alt+z'); await p.waitForSelector('.stkz-ov', { timeout: 3000 }).catch(() => {});
      if (!(await p.locator('.stkz-ov').count())) { if (phone) await p.click('.stkz-pb'); else { await p.click('.stkt-zoom .vela-dtb-arrow'); await p.locator('.stkt-fly-i', { hasText: 'Zoom to selection' }).click(); } await p.waitForSelector('.stkz-ov'); }
      else check(true, 'Alt+Z starts the tool');
      await drag(p, 0.55, 0.25, 0.8, 0.6, phone);
      await p.waitForSelector('.stkz-choose');
      const ch = await rect(p, '.stkz-choose');
      check(ch.l >= 0 && ch.r <= vp.width && ch.t >= 0 && ch.b <= vp.height, 'chooser inside viewport', ch);
      const opts = await p.evaluate(() => [...document.querySelectorAll('.stkz-opt')].map((o) => { const r = o.getBoundingClientRect(); return { txt: o.textContent, t: r.top, h: r.height, c: r.top + r.height / 2, over: o.scrollWidth > o.clientWidth + 1 }; }));
      check(opts.every((o) => !o.over), 'chooser text not clipped');
      const rows = {}; opts.forEach((o) => { const k = Math.round(o.t / 4); (rows[k] = rows[k] || []).push(o.c); });
      check(Object.values(rows).every((cs) => Math.max(...cs) - Math.min(...cs) <= 1), 'chooser items share a row centre (<=1px)');
      check(opts[0].txt.startsWith('Same'), 'first option is Same timeframe', opts[0].txt);
      await p.screenshot({ path: `${OUT}/selzoom-chooser-${name}.png` });
      // choose 5m
      const sel = await p.evaluate(() => { const b = document.querySelector('.stkz-box').getBoundingClientRect(); return { w: b.width }; });
      await p.locator('.stkz-opt[data-tf="5"]').click();
      await p.waitForFunction(() => { const W = window.STRYKER_VELA; return String(W.cell(W.context().cells[0].id).timeframe) === '5'; }, null, { timeout: 15000 }).catch(() => {});
      await p.waitForTimeout(2500);
      const s1 = await st(p);
      check(s1.tf === '5', 'timeframe switched to 5m', s1.tf);
      const span0 = s0.vr.to - s0.vr.from, span1 = s1.vr.to - s1.vr.from;
      check(span1 < span0 * 0.5, 'visible time span shrank to the selection', { before: span0 / 6e4 | 0, after: span1 / 6e4 | 0 });
      const mid0 = s0.vr.from + span0 * 0.675;
      check(s1.vr.from <= mid0 + 3e5 && s1.vr.to >= mid0 - 3e5, 'zoomed range contains the selected area');
      const bk = await rect(p, '.stkz-back');
      check(!!bk && bk.cw >= bk.sw - 1 && bk.h >= 32 && bk.l >= 0 && bk.r <= vp.width, 'Back pill visible, fits', bk);
      if (bk) { const ic = await p.evaluate(() => { const b = document.querySelector('.stkz-back'), s = b.querySelector('svg'), t = b.querySelector('span'); const br = b.getBoundingClientRect(), sr = s.getBoundingClientRect(), tr = t.getBoundingClientRect(); return { dv: Math.abs((sr.top + sr.height / 2) - (br.top + br.height / 2)), dt: Math.abs((tr.top + tr.height / 2) - (br.top + br.height / 2)), padL: sr.left - br.left, padR: br.right - tr.right }; }); check(ic.dv <= 1 && ic.dt <= 1, 'Back icon + text vertically centred', ic); }
      await p.screenshot({ path: `${OUT}/selzoom-after-${name}.png` });
      // Back
      await p.click('.stkz-back'); 
      await p.waitForFunction(() => { const W = window.STRYKER_VELA; return String(W.cell(W.context().cells[0].id).timeframe) !== '5'; }, null, { timeout: 15000 }).catch(() => {});
      await p.waitForTimeout(2500);
      const s2 = await st(p);
      check(s2.tf === s0.tf, 'Back restores timeframe', s2.tf);
      check(Math.abs((s2.vr.to - s2.vr.from) - span0) < span0 * 0.15, 'Back restores visible span', { want: span0 / 6e4 | 0, got: (s2.vr.to - s2.vr.from) / 6e4 | 0 });
      check(await p.locator('.stkz-back').count() === 0, 'Back pill gone after returning');
      // Same timeframe
      await p.evaluate(() => window.__stkSelZoom.start()); await p.waitForSelector('.stkz-ov');
      await drag(p, 0.4, 0.2, 0.6, 0.7, phone);
      await p.locator('.stkz-opt-same').click(); await p.waitForTimeout(1200);
      const s3 = await st(p);
      check(s3.tf === s0.tf && (s3.vr.to - s3.vr.from) < span0 * 0.6, 'Same timeframe: zoomed, tf kept', { tf: s3.tf, span: (s3.vr.to - s3.vr.from) / 6e4 | 0 });
      await p.click('.stkz-back'); await p.waitForTimeout(1200);
      check(Math.abs(((await st(p)).vr.to - (await st(p)).vr.from) - span0) < span0 * 0.15, 'Back after Same restores span');
      if (phone) check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll at 390');
      check(p.errors.length === 0, 'no page errors', p.errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
