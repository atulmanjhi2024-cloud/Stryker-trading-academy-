// Phone maximize memory (upstream 0.10.14 fix "Maximizing one chart of a split layout no longer crashes the page on iPhone").
//   CHART_BASE=http://127.0.0.1:PORT tools/chrome-slot.sh node tools/tests/chart-maximize-mem-browser.js [shotsDir]
// WebKit, iPhone 13 emulation (390x844 @3). A 4-chart layout, then one chart maximized (the phone strip does this on a
// short phone; the ⋯ menu's Maximize does it on any): the other charts must leave the layout (display:none) and keep the
// canvas size they had, not grow to the full grid under the maximized one (4 full-screen charts = 4x canvas memory, the
// iOS tab kill). Then restore: all 4 charts are back in the grid with a real size, at once (no reload of their data).
// Also a desktop Chromium pass (1440): maximize / restore still works the same way.
const { webkit, devices } = require('playwright-core');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '.';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };

// Per cell: is it laid out, its host size, and its canvases' backing-store pixels (what costs memory).
const CELLS = () => {
  const ws = window.STRYKER_VELA;
  return ws.cells().map((c) => {
    const r = c.host.getBoundingClientRect(), cs = getComputedStyle(c.host);
    const px = [...c.host.querySelectorAll('canvas')].reduce((s, k) => s + k.width * k.height, 0);
    return { id: c.id, display: cs.display, vis: cs.visibility, w: Math.round(r.width), h: Math.round(r.height), mpx: +(px / 1e6).toFixed(2), bars: c.chart.renderer.renderer.coords.barCount };
  });
};

async function run(browserType, label, ctxOpts) {
  const b = browserType === 'webkit' ? await webkit.launch() : await launch();
  const ctx = await b.newContext(ctxOpts);
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { for (const k of ['stryker_install_prompt_shown_u1', 'stryker_push_prompt_shown_u1', 'stryker_community_disclaimer_ack_v1']) localStorage.setItem(k, '1'); } catch (e) {} });
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => { if (!/docChanges|access control checks|Load failed/.test(String(e))) errors.push(String(e).slice(0, 200)); });
  let crashed = false; p.on('crash', () => { crashed = true; });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => { try { const ws = window.STRYKER_VELA; return ws && ws.cell(ws.active.id).chart.renderer.renderer.coords.barCount > 20; } catch (e) { return false; } }, null, { timeout: 90000 });
  await p.evaluate(() => window.STRYKER_CHART_UI.setLayout('4')); await p.waitForTimeout(5000);
  const before = await p.evaluate(CELLS);
  check(before.length === 4 && before.every((c) => c.display !== 'none' && c.w > 0 && c.h > 0), `${label}: 4 charts laid out`, before);
  const active = await p.evaluate(() => window.STRYKER_VELA.active.id);
  await p.evaluate((id) => { const ws = window.STRYKER_VELA; if (ws.maximizedCell !== id) ws.maximizeCell(id); }, active);
  await p.waitForTimeout(2000);
  const max = await p.evaluate(CELLS);
  const me = max.find((c) => c.id === active), others = max.filter((c) => c.id !== active);
  const grid = await p.evaluate(() => { const g = document.querySelector('.vela-ws-grid').getBoundingClientRect(); return { w: Math.round(g.width), h: Math.round(g.height) }; });
  check(Math.abs(me.w - grid.w) <= 2 && Math.abs(me.h - grid.h) <= 2, `${label}: the maximized chart fills the grid`, { me, grid });
  check(others.every((c) => c.display === 'none'), `${label}: the other charts leave the layout while one is maximized`, others);
  const beforeOthers = before.filter((c) => c.id !== active);
  check(others.every((c, i) => c.mpx <= beforeOthers.find((x) => x.id === c.id).mpx + 0.01), `${label}: the other charts keep their own canvas size (no full-grid canvases)`, { before: beforeOthers.map((c) => c.mpx), after: others.map((c) => c.mpx), maxed: me.mpx });
  await p.screenshot({ path: `${OUT}/maximize-${label}-max.png` });
  await p.evaluate(() => window.STRYKER_VELA.maximizeCell(null)); await p.waitForTimeout(2000);
  const back = await p.evaluate(CELLS);
  check(back.every((c) => c.display !== 'none' && c.w > 0 && c.h > 0 && c.bars > 20), `${label}: restore brings all 4 charts back, with their bars`, back);
  check(back.every((c) => { const o = before.find((x) => x.id === c.id); return Math.abs(o.w - c.w) <= 2 && Math.abs(o.h - c.h) <= 2; }), `${label}: restored charts have their old size`, back.map((c) => [c.w, c.h]));
  await p.screenshot({ path: `${OUT}/maximize-${label}-restored.png` });
  check(!crashed && !errors.length, `${label}: no crash, no page errors`, errors);
  await p.evaluate(() => window.STRYKER_CHART_UI.setLayout('1')); await p.waitForTimeout(800);
  await b.close();
}

(async () => {
  await run('webkit', 'iphone', Object.assign({}, devices['iPhone 13']));
  await run('chromium', 'desktop', { viewport: { width: 1440, height: 900 } });
  console.log(fail ? `FAILED ${fail}` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
