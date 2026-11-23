// Pine "no time limit" (Owner 22 Nov 2026: "remove the limit altogether").
// A never-ending member script (fixtures/pine/loop-forever.pine, its loop never hits pinets' loop guard in practice)
// must: show "Calculating… NN%" + Cancel in the editor and a chip on its legend row after 3 s, never be cut off by
// a timer, and stop within 1 s of Cancel while 3 other indicators on the chart keep updating. A real error still
// shows its message at once.
//   node tools/tests/chart-dev-server.mjs 8077 &
//   CHART_BASE=http://127.0.0.1:8077 PW_BROWSER=webkit|firefox|chromium node tools/tests/chart-pine-nolimit-browser.js
// Env: HOLD_MS (how long the endless script runs before Cancel, default 12000), SHOTS=<dir> (editor + chip shots,
// 1440 and 390, dark + light), THEME=light.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const fs = require('fs');
const path = require('path');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8077';
const HOLD = Number(process.env.HOLD_MS || 12000);
const SHOTS = process.env.SHOTS || '';
const BR = process.env.PW_BROWSER || 'chromium';
const FOREVER = fs.readFileSync(path.join(__dirname, 'fixtures', 'pine', 'loop-forever.pine'), 'utf8');
const BAD = fs.readFileSync(path.join(__dirname, 'fixtures', 'pine', 'broken-undef.pine'), 'utf8');
// 3 other indicators: one built-in on the shared worker, two member scripts in their own lanes
const OTHERS = [
  '//@version=5\nindicator("Other A", overlay=true)\nplot(ta.sma(close, input.int(10, "Len")))',
  '//@version=5\nindicator("Other B", overlay=true)\nplot(ta.ema(close, input.int(30, "Len")))',
  '//@version=5\nindicator("Other C")\nplot(ta.rsi(close, input.int(14, "Len")))',
];
let fails = 0;
const check = (ok, m) => { console.log((ok ? 'PASS ' : 'FAIL ') + BR + ' ' + m); if (!ok) fails++; };

async function open(b, w, h, theme){
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (t) localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme || '');
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR ' + String(e).slice(0, 200)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_PINE, null, { timeout: 90000 });
  if (theme) await p.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
  await p.evaluate(() => { const c = window.STRYKER_VELA.cell(window.STRYKER_VELA.context().cells[0].id); c.setSymbol('futures:NQ1!'); c.setTimeframe('1'); });
  await p.evaluate(async () => { for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 500)); try { if (window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 300 && i > 6) return; } catch (e) {} } });
  return { ctx, p };
}

// script:run count per indicator title (a re-run after a live tick / settings change from the stub feed)
const snap = (p) => p.evaluate(() => {
  const ch = window.STRYKER_VELA.context().cells[0].chart;
  if (!window.__runs) { window.__runs = {}; ch.on('script:run', (r) => { window.__runs[r.id] = (window.__runs[r.id] || 0) + 1; }); }
  return window.STRYKER_PINE.pineHandles(ch).map((h) => { const i = ch.inspect().indicators.find((x) => x.id === h.id) || {}; return { t: window.STRYKER_PINE.titleOf(h), n: Object.keys(i.series || {}).length, last: window.__runs[h.id] || 0 }; });
});

(async () => {
  const b = await launch();
  try {
    const { ctx, p } = await open(b, 1440, 900, process.env.THEME);
    await snap(p);
    // three other indicators first
    for (const [i, src] of OTHERS.entries()) {
      const r = await p.evaluate(async ([src, i]) => { const ch = window.STRYKER_VELA.context().cells[0].chart; const r = await window.STRYKER_PINE.runOnChart(ch, src, undefined, false, i === 0 ? { engine: 'next', inline: true } : { inline: true }); return { ok: r.ok, msg: r.msg }; }, [src, i]);
      check(r.ok, 'other indicator ' + (i + 1) + ' added ' + JSON.stringify(r));
    }
    // a real error is instant and real
    const bad = await p.evaluate(async (src) => { const ch = window.STRYKER_VELA.context().cells[0].chart; const t0 = performance.now(); const r = await window.STRYKER_PINE.runOnChart(ch, src, undefined, false, { inline: true }); return { ok: r.ok, msg: r.msg, ms: Math.round(performance.now() - t0) }; }, BAD);
    check(!bad.ok && bad.ms < 5000 && !/heavy|did not finish|took too long|stopped making progress|Calculating/i.test(bad.msg), `real error shows at once (${bad.ms} ms): ${bad.msg}`);

    // the endless script through the editor's Add to chart
    await p.evaluate((src) => { window.STRYKER_PINE.open(); window.STRYKER_PINE.load('Forever', src); }, FOREVER);
    await p.waitForTimeout(800);
    await p.evaluate(() => { const b = [...document.querySelectorAll('.stkc-zs-run')].find((x) => x.offsetParent); b.click(); });
    const s0 = await snap(p);
    await p.waitForTimeout(4500);
    const head1 = await p.evaluate(() => { const e = [...document.querySelectorAll('.sed-prob-hd')].find((x) => x.offsetParent); return e ? { s: e.dataset.s, t: e.textContent, cancel: !!e.querySelector('.stk-calc-cancel') } : null; });
    check(head1 && head1.s === 'busy' && /^Calculating…/.test(head1.t) && head1.cancel, 'editor shows Calculating… + Cancel after 3 s: ' + JSON.stringify(head1));
    // open the legend if it is folded ("Indicators (N)") so the rows show
    await p.evaluate(() => { const f = document.querySelector('.vela-ind-fold'); const row = document.querySelector('.stk-calc'); if (f && row && !row.getBoundingClientRect().width) f.click(); });
    await p.waitForTimeout(400);
    const chip = await p.evaluate(() => { const c = document.querySelector('.stk-calc'); if (!c) return null; const row = c.parentElement; const t = row.textContent; return { text: c.textContent, row: t.slice(0, 60), x: !!c.querySelector('.stk-calc-x') }; });
    check(chip && /^Calculating…/.test(chip.text) && /Forever/.test(chip.row) && chip.x, 'legend chip on the script\'s own row: ' + JSON.stringify(chip));
    // alignment of the chip (row centre, even padding, × centred)
    const al = await p.evaluate(() => {
      const c = document.querySelector('.stk-calc'); if (!c) return null;
      const r = c.getBoundingClientRect(), row = c.parentElement.getBoundingClientRect(), t = c.querySelector('.stk-calc-t').getBoundingClientRect(), x = c.querySelector('.stk-calc-x').getBoundingClientRect(), sv = c.querySelector('svg').getBoundingClientRect();
      const title = c.parentElement.querySelector('span').getBoundingClientRect();
      const mid = (q) => q.top + q.height / 2;
      if (!r.width || !r.height) return { hidden: true };
      return { h: r.height, dRow: Math.abs(mid(r) - mid(row)), dTitle: Math.abs(mid(r) - mid(title)), dText: Math.abs(mid(t) - mid(r)), dX: Math.abs(mid(x) - mid(r)), dIcon: Math.abs(mid(sv) - mid(x)) + Math.abs((sv.left + sv.width / 2) - (x.left + x.width / 2)), padL: Math.round(t.left - r.left), padR: Math.round(r.right - sv.right), gap: Math.round(x.left - t.right), clip: c.scrollWidth > c.clientWidth + 1, tnum: getComputedStyle(c).fontVariantNumeric };
    });
    check(al && al.dRow <= 1 && al.dTitle <= 1 && al.dText <= 1 && al.dX <= 1 && al.dIcon <= 1 && Math.abs(al.padL - al.padR) <= 1 && !al.clip && /tabular/.test(al.tnum), 'chip aligned: ' + JSON.stringify(al));
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, `nolimit-${BR}-1440${process.env.THEME ? '-' + process.env.THEME : ''}.png`) }); }

    // keep it running; other indicators must keep updating (live ticks) meanwhile, and no timer may cut it off
    await p.waitForTimeout(Math.max(0, HOLD - 4500));
    const s1 = await snap(p);
    const still = await p.evaluate(() => { const e = [...document.querySelectorAll('.sed-prob-hd')].find((x) => x.offsetParent); return { s: e && e.dataset.s, t: e && e.textContent, chip: !!document.querySelector('.stk-calc'), toasts: [...document.querySelectorAll('.stk-toast,.toast')].map((x) => x.textContent).join('|').slice(0, 200) }; });
    check(still.s === 'busy' && still.chip && !/heavy|did not finish|stopped making progress/i.test(still.toasts), `still calculating after ${HOLD / 1000} s (no time limit): ` + JSON.stringify(still));
    const others = s1.filter((x) => /^Other/.test(x.t));
    check(others.length === 3 && others.every((x) => x.n > 0), 'the 3 other indicators are drawn: ' + JSON.stringify(others.map((x) => x.t + ':' + x.n)));
    const moved = others.filter((x) => { const o = s0.find((y) => y.t === x.t); return o && o.last !== x.last; }).length;
    // the stub feed ticks: every other indicator re-ran while the endless one computed
    check(moved === 3, `other indicators kept updating while it ran (${moved}/3 changed)`);
    // Settings change on another indicator still applies while the endless one runs
    const upd = await p.evaluate(async () => {
      const ch = window.STRYKER_VELA.context().cells[0].chart;
      const h = window.STRYKER_PINE.pineHandles(ch).find((x) => /Other B/.test(window.STRYKER_PINE.titleOf(x)));
      const k = (h.inputs || [])[0]; if (!k) return 'no input';
      const before = window.__runs[h.id] || 0;
      const t0 = performance.now(); h.setInput(k.key, 5);
      for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 100)); if ((window.__runs[h.id] || 0) > before) return Math.round(performance.now() - t0); }
      return 'no change';
    });
    check(typeof upd === 'number' && upd < 4000, 'a settings change on another indicator applies while it runs (' + upd + ' ms)');

    // Cancel: stops within 1 s, the 3 others stay and keep updating
    const c = await p.evaluate(async () => {
      const ch = window.STRYKER_VELA.context().cells[0].chart;
      const btn = document.querySelector('.stk-calc-cancel'); const t0 = performance.now(); btn.click();
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 50));
        const e = [...document.querySelectorAll('.sed-prob-hd')].find((x) => x.offsetParent);
        const gone = !window.STRYKER_PINE.pineHandles(ch).some((h) => /Forever/.test(window.STRYKER_PINE.titleOf(h)));
        if (gone && e && e.dataset.s !== 'busy' && !document.querySelector('.stk-calc')) {
          const st = (await import('/assets/chart-pine-next.js?v=' + document.querySelector('meta[name="stryker-build"]').content)).sharedWorkerState();
          return { ms: Math.round(performance.now() - t0), head: e.textContent, st };
        }
      }
      return { ms: -1 };
    });
    check(c.ms >= 0 && c.ms <= 1000, `Cancel stops it within 1 s (${c.ms} ms, "${c.head}") lanes=${c.st && c.st.lanes}`);
    const s2 = await snap(p);
    await p.waitForTimeout(5000);
    const s3 = await snap(p);
    const o3 = s3.filter((x) => /^Other/.test(x.t));
    check(o3.length === 3 && o3.every((x) => x.n > 0) && !s3.some((x) => /Forever/.test(x.t)), 'after Cancel: the 3 others are still on the chart, Forever is gone');
    const moved2 = o3.filter((x) => { const o = s2.find((y) => y.t === x.t); return o && o.last !== x.last; }).length;
    check(moved2 === 3, `the others keep updating after Cancel (${moved2}/3)`);

    // the × on the legend chip (Indicators-window path: no editor): stops within 1 s too
    const r2 = await p.evaluate(async (src) => {
      const ch = window.STRYKER_VELA.context().cells[0].chart;
      const pr = window.STRYKER_PINE.addSource('Forever 2', src);
      for (let i = 0; i < 100 && !document.querySelector('.stk-calc'); i++) await new Promise((r) => setTimeout(r, 100));
      const x = document.querySelector('.stk-calc-x'); if (!x) return { ms: -2 };
      const t0 = performance.now(); x.click();
      const res = await pr; const ms = Math.round(performance.now() - t0);
      await new Promise((r) => setTimeout(r, 300));
      return { ms, res, chip: !!document.querySelector('.stk-calc'), left: window.STRYKER_PINE.pineHandles(ch).length };
    }, FOREVER);
    check(r2.ms >= 0 && r2.ms <= 1000 && !r2.chip && r2.res && r2.res.cancelled && r2.left === 3, 'legend × stops it within 1 s: ' + JSON.stringify(r2));
    await ctx.close();

    if (SHOTS) {
      // phone shot with the chip (editor closed; the Indicators-window path)
      const { ctx: c2, p: p2 } = await open(b, 390, 844, process.env.THEME);
      await p2.evaluate(async (src) => { window.STRYKER_PINE.addSource('Forever', src); }, FOREVER);
      await p2.waitForTimeout(5000);
      await p2.evaluate(() => { const f = document.querySelector('.vela-ind-fold'); const c = document.querySelector('.stk-calc'); if (f && c && !c.getBoundingClientRect().width) f.click(); });
      await p2.waitForTimeout(400);
      const ph = await p2.evaluate(() => { const c = document.querySelector('.stk-calc'), r = c && c.getBoundingClientRect(); return { chip: !!(r && r.width), inView: !!(r && r.right <= window.innerWidth), sx: document.documentElement.scrollWidth > window.innerWidth }; });
      check(ph.chip && ph.inView && !ph.sx, '390: chip shows, no horizontal scroll ' + JSON.stringify(ph));
      await p2.screenshot({ path: path.join(SHOTS, `nolimit-${BR}-390${process.env.THEME ? '-' + process.env.THEME : ''}.png`) });
      await c2.close();
    }
  } catch (e) { check(false, 'run: ' + (e && e.stack || e)); }
  finally { await b.close(); }
  console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
