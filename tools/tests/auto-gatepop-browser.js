// Gate-timeout notice: has a close button, is a floating toast (not in the page flow over the chart),
// and disappears when auth / plan resolves later.
//   flock /tmp/stryker-chrome.lock node tools/tests/auto-gatepop-browser.js [shotsDir] [oldScript]
// Needs a static server at CHART_BASE (default http://127.0.0.1:8061) serving the repo root.
const { launch } = require('./lib.js');
const fs = require('fs');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8061';
const OUT = process.argv[2] || '.';
const OLD = process.argv[3]; // optional: serve this file as gate-timeout.js (before shots)
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x))); };
const PAGE = (th) => `<!doctype html><html${th === 'light' ? ' data-theme="light"' : ''}><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<link rel=stylesheet href="assets/style.css"></head><body class="charts-page">
<div class="dash-shell gate-pending"><main class="dash-main"><div id=fake style="height:70vh;background:#101a2a;border:1px solid #2a3a55;display:flex;align-items:center;justify-content:center;color:#7a8aa5">Sample data (chart area)</div></main></div>
<script>window.__cbs=[];window.auth={onAuthStateChanged:function(f){window.__cbs.push(f)}};</script>
<script src="assets/gate-timeout.js"></script></body></html>`;
async function run(b, w, h, theme, old) {
  const ctx = await b.newContext(w < 700 ? { viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: w, height: h } });
  await ctx.route('**/__gate.html', (r) => r.fulfill({ contentType: 'text/html', body: PAGE(theme) }));
  if (old) await ctx.route('**/assets/gate-timeout.js', (r) => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(old, 'utf8') }));
  const p = await ctx.newPage();
  await p.goto(BASE + '/__gate.html'); await p.waitForSelector('#gate-timeout-notice', { timeout: 15000 }); await p.waitForTimeout(300);
  return { ctx, p };
}
(async () => {
  const b = await launch();
  for (const [w, h, th] of [[390, 844, 'dark'], [1440, 900, 'dark'], [1440, 900, 'light']]) {
    const tag = `${w}-${th}`;
    if (OLD) { const { ctx, p } = await run(b, w, h, th, OLD); await p.screenshot({ path: `${OUT}/before-${tag}.png` }); await ctx.close(); continue; }
    const { ctx, p } = await run(b, w, h, th);
    await p.screenshot({ path: `${OUT}/after-${tag}.png` });
    const m = await p.evaluate(() => { const n = document.getElementById('gate-timeout-notice'), r = n.getBoundingClientRect(), c = n.querySelector('.gate-timeout-close').getBoundingClientRect(), f = document.getElementById('fake').getBoundingClientRect();
      return { pos: getComputedStyle(n).position, r: [r.left, r.top, r.right, r.bottom].map(Math.round), vw: innerWidth, sw: document.documentElement.scrollWidth, fakeTop: Math.round(f.top), close: [c.width, c.height], cx: c.left + c.width / 2, cy: c.top + c.height / 2, rr: r.right, rt: r.top }; });
    check(m.pos === 'fixed', `${tag}: toast is fixed, not in page flow`, m.pos);
    check(m.fakeTop < 60, `${tag}: chart area not pushed down`, m.fakeTop);
    check(m.close[0] >= 32 && m.close[1] >= 32, `${tag}: close button >= 32px`, m.close);
    check(Math.abs((m.rr - m.cx) - (m.cy - m.rt)) <= 1, `${tag}: close icon evenly inset from top/right`);
    check(m.sw <= m.vw, `${tag}: no horizontal scroll`, [m.sw, m.vw]);
    check(m.r[0] >= 0 && m.r[2] <= m.vw, `${tag}: inside viewport`, m.r);
    await p.click('.gate-timeout-close'); await p.waitForTimeout(100);
    check(!(await p.$('#gate-timeout-notice')), `${tag}: X removes the notice`);
    await ctx.close();
  }
  if (!OLD) {
    let { ctx, p } = await run(b, 1440, 900, 'dark');
    await p.evaluate(() => window.__cbs.forEach((f) => f({ uid: 'u1' }))); await p.waitForTimeout(200);
    check(!(await p.$('#gate-timeout-notice')), 'auth user arrives later: notice removed'); await ctx.close();
    ({ ctx, p } = await run(b, 1440, 900, 'dark'));
    await p.evaluate(() => window.dispatchEvent(new Event('tz:gate-resolved'))); await p.waitForTimeout(100);
    check(!(await p.$('#gate-timeout-notice')), 'gate resolved event: notice removed'); await ctx.close();
  }
  await b.close(); console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
