// Removed indicators must leave NOTHING on the chart (member UnoMas 25 Nov: "I removed all indicators, they are still on
// the chart", Mac app). One of each overlay kind is added, then removed one by one, and by "Remove all" (the context-menu
// path); the overlay canvases are compared with a fresh chart (per-canvas pixel hash) and the dev invariant
// window.__stkLeakCheck() must be empty. Also: symbol change, layout change, and after a reload. Fixture bars only.
//   node tools/tests/chart-dev-server.mjs 8041 &
//   CHART_BASE=http://127.0.0.1:8041 flock /tmp/stryker-chrome.lock node tools/tests/chart-indicator-teardown-browser.js <shotsDir> [prefix]
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8041';
const OUT = process.argv[2] || '/tmp/teardown'; const PH = process.argv[3] || 'run';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (ok || x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 500))); };
const MIN = Math.floor(Date.now() / 60000), N = 600;
const price = (m) => 28650 + Math.sin((m - MIN) / 17) * 40 + Math.sin((m - MIN) / 5) * 9;
const rows = []; for (let m = MIN - N; m < MIN; m++) { const o = price(m), c = price(m + 1); rows.push([m * 60, o, Math.max(o, c) + 3, Math.min(o, c) - 3, c, 500 + (m % 50) * 20]); }
// one of each kind that draws outside the main series
const KINDS = ['ema', 'vwap', 'stk_vbubble', 'vpvr', 'stk_of_big', 'stk_svp', 'stk_gex', 'stk_gexheat', 'stk_em', 'stk_camarilla', 'stk_of_vp', 'stk_barstats'];

const state = () => window.__probe();
async function setup(p) {
  await p.evaluate(() => {
    const cc = () => window.STRYKER_VELA.context().cells[0].chart;
    window.__probe = () => {
      const c = cc(), R = c.renderer && c.renderer.extLayers ? c.renderer : c.renderer.renderer;
      const hashes = {};
      R.extLayers.forEach((l, i) => {
        const cv = l.canvas, g = cv.getContext('2d');
        if (!cv.width || !cv.height || !g) { hashes[l.def.id + i] = 0; return; }
        const d = g.getImageData(0, 0, cv.width, cv.height).data; let h = 0, nz = 0;
        for (let k = 3; k < d.length; k += 4) if (d[k]) { nz++; h = (h * 31 + k + d[k]) | 0; }
        hashes[l.def.id + i] = nz ? h : 0;
      });
      return { hashes, painted: Object.entries(hashes).filter(([, v]) => v).map(([k]) => k), ind: c.indicators().length, left: c.indicators().map((h) => h.nativeType), leaks: window.__stkLeakCheck ? window.__stkLeakCheck(c) : ['no-invariant'], canv: R.plot.querySelectorAll('canvas').length };
    };
    window.__addAll = (kinds) => { const c = cc(), ok = []; for (const t of kinds) { try { c.addNativeIndicator(t, { inputs: {} }); ok.push(t); } catch (e) {} } window.STRYKER_VELA.context().stateChanged(); return ok; };
    window.__removeAll = () => { for (const h of cc().indicators()) h.remove(); window.STRYKER_VELA.context().stateChanged(); };   // = context menu "Remove indicators"
  });
}
async function boot(p) {
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 90000 });
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.orchestrator.rawBars.length > 100) break; } });
  await sleep(1500); await setup(p);
}
const crypto = require('crypto');
// the plot area as the member sees it, minus the right-hand price axis strip and the header legend (they legitimately change)
const plotShot = async (p) => { const r = await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart, R = c.renderer.extLayers ? c.renderer : c.renderer.renderer, b = R.plot.getBoundingClientRect(); return { x: b.x + 10, y: b.y + 130, width: Math.max(50, b.width - 120), height: Math.max(50, b.height - 200) }; }); const buf = await p.screenshot({ clip: r }); return crypto.createHash('md5').update(buf).digest('hex'); };
const clearInd = (p) => p.evaluate(() => window.__removeAll());
(async () => {
  const b = await launch();
  for (const cfg of [{ n: '1440-dark', w: 1440, h: 800, theme: 'night' }, { n: '1440-light', w: 1440, h: 800, theme: 'day' }, { n: '390-dark', w: 390, h: 800, theme: 'night', mobile: true }]) {
    console.log('== ' + cfg.n);
    const ctx = await b.newContext({ viewport: { width: cfg.w, height: cfg.h }, deviceScaleFactor: 1, isMobile: !!cfg.mobile, hasTouch: !!cfg.mobile });
    await ctx.addInitScript(stub);
    await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', t); } catch (e) {} }, cfg.theme);
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
    await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: '1', page: 0, bars: rows }) }));
    const p = await ctx.newPage(), errors = []; p.on('pageerror', (e) => errors.push(String(e)));
    await boot(p);
    await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1'); for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.orchestrator.rawBars.length > 100) break; } });
    await clearInd(p); await sleep(1200);
    const fresh = await p.evaluate(state); const freshShot = await plotShot(p), freshShot2 = await plotShot(p);
    if (freshShot !== freshShot2) console.log('NOTE fresh chart screenshot is not stable (live feed), pixel diff skipped'); const shotOk = freshShot === freshShot2;
    await p.screenshot({ path: `${OUT}/${PH}-${cfg.n}-0fresh.png` });
    const same = (a, b2) => JSON.stringify(a.hashes) === JSON.stringify(b2.hashes);
    const added = await p.evaluate((k) => window.__addAll(k), KINDS); await sleep(3500);
    const full = await p.evaluate(state);
    await p.screenshot({ path: `${OUT}/${PH}-${cfg.n}-1added.png` });
    check(added.length >= 8 && full.painted.length > fresh.painted.length, 'added ' + added.length + ' kinds, overlays painting', { added, fresh: fresh.painted, full: full.painted });
    // 1) remove one by one
    for (let i = 0; i < added.length; i++) {
      await p.evaluate((t) => { const h = window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === t); h && h.remove(); }, added[i]);
      await sleep(250);
      const s = await p.evaluate(state);
      if (s.leaks.length) check(false, 'invariant after removing ' + added[i], s.leaks);
    }
    // companions a tool adds by itself (e.g. Big Trades brings its L2 twins) are removed one by one too
    for (let g = 0; g < 10; g++) { const t = await p.evaluate(() => { const h = window.STRYKER_VELA.context().cells[0].chart.indicators()[0]; if (!h) return null; const t = h.nativeType; h.remove(); return t || 'pine'; }); if (!t) break; await sleep(250); const s0 = await p.evaluate(state); if (s0.leaks.length) check(false, 'invariant after removing companion ' + t, s0.leaks); }
    await sleep(1200);
    let s = await p.evaluate(state);
    check(s.ind === 0 && s.leaks.length === 0, 'one-by-one: invariant empty', { left: s.left, leaks: s.leaks });
    check(same(fresh, s), 'one-by-one: overlay canvases match a fresh chart', { fresh: fresh.hashes, now: s.hashes });
    if (shotOk) check(await plotShot(p) === freshShot, 'one-by-one: plot pixels equal a fresh chart');
    await p.screenshot({ path: `${OUT}/${PH}-${cfg.n}-2removed-one.png` });
    // 2) remove all (context menu path)
    await p.evaluate((k) => window.__addAll(k), KINDS); await sleep(3000);
    await clearInd(p); await sleep(1200);
    s = await p.evaluate(state);
    check(s.ind === 0 && s.leaks.length === 0, 'remove-all: invariant empty', s.leaks);
    check(same(fresh, s), 'remove-all: overlay canvases match a fresh chart', { fresh: fresh.hashes, now: s.hashes });
    if (shotOk) check(await plotShot(p) === freshShot, 'remove-all: plot pixels equal a fresh chart');
    await p.screenshot({ path: `${OUT}/${PH}-${cfg.n}-3removed-all.png` });
    // 3) symbol change with indicators, then remove all
    await p.evaluate((k) => window.__addAll(k), KINDS); await sleep(2500);
    await p.evaluate(() => window.STRYKER_VELA.active.setSymbol('futures:ES1!')); await sleep(2500);
    await clearInd(p); await sleep(1200);
    s = await p.evaluate(state);
    check(s.leaks.length === 0, 'symbol change then remove-all: invariant empty', s.leaks);
    check(s.painted.length <= fresh.painted.length, 'symbol change then remove-all: no overlay pixels left', { fresh: fresh.hashes, now: s.hashes });
    // 4) layout change
    await p.evaluate((k) => window.__addAll(k), KINDS); await sleep(2000);
    await p.evaluate(() => { try { window.STRYKER_VELA.setLayout('2h'); } catch (e) {} }); await sleep(2000);
    await p.evaluate(() => { try { window.STRYKER_VELA.setLayout('1'); } catch (e) {} }); await sleep(2000);
    await setup(p); await clearInd(p); await sleep(1200);
    s = await p.evaluate(state);
    check(s.ind === 0 && s.leaks.length === 0, 'layout change then remove-all: invariant empty', s.leaks);
    // 5) reload after remove-all (saved workspace must come back empty)
    await sleep(1500);
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 90000 });
    await sleep(4000); await setup(p);
    s = await p.evaluate(state);
    check(s.ind === 0 && s.painted.length <= fresh.painted.length && s.leaks.length === 0, 'after reload: no indicators, no overlay pixels, invariant empty', { ind: s.ind, painted: s.painted, leaks: s.leaks });
    check(errors.length === 0, 'no page errors', errors.slice(0, 3));
    await ctx.close();
  }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
