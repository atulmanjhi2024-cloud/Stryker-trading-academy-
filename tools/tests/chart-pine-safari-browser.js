// Safari bug (UnoMas, beta, 22 Nov 2026): every Pine script, even a 10-line SMA, failed in the Script Editor with
// "This indicator is heavy for this device. It did not finish within 20 seconds". Root cause: vela-pinets'
// PineWorkerEngine revokes its worker's blob URL right after new Worker(); WebKit loads the script later, finds the
// URL gone, and the worker never starts (fixed in assets/chart-pine.js classicEngine).
// This drives the real editor (open, paste, Add to chart) on WebKit, Chromium and Firefox, plus WebKit with an
// iPhone profile (charts.html branches on the UA), and checks a worker that cannot start gives the real reason.
//   node tools/tests/chart-dev-server.mjs 8077 &
//   CHART_BASE=http://127.0.0.1:8077 node tools/tests/chart-pine-safari-browser.js [outDir]
const pw = require('playwright-core');
const { executablePath } = require('./lib.js');
const stub = require('./richstub.js');
const fs = require('fs');
const path = require('path');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8077';
const OUT = process.argv[2] || '';
const FAST_MS = Number(process.env.FAST_MS || 3000);
const SRC = fs.readFileSync(path.join(__dirname, 'fixtures', 'pine', 'timeout', '00-v5-simple-sma.pine'), 'utf8');
const IPHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' };
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

async function page(b, ctxOpts, extraInit){
  const ctx = await b.newContext(Object.assign({ viewport: { width: 1440, height: 900 } }, ctxOpts || {}));
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
  if (extraInit) await ctx.addInitScript(extraInit);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_PINE, null, { timeout: 60000 });
  await p.evaluate(() => { const c = window.STRYKER_VELA.cell(window.STRYKER_VELA.context().cells[0].id); c.setSymbol('futures:NQ1!'); c.setTimeframe('5'); });
  await p.waitForFunction(() => { try { return window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 300; } catch (e) { return false; } }, null, { timeout: 60000 });
  await p.waitForTimeout(1500);
  return { ctx, p };
}

// Script Editor: paste the script, press Add to chart, wait for the problems header to settle.
async function editorAdd(p){
  await p.evaluate((src) => { window.STRYKER_PINE.open(); window.STRYKER_PINE.load('Simple SMA', src); }, SRC);
  await p.waitForTimeout(800);
  const t0 = Date.now();
  const clicked = await p.evaluate(() => { const b = [...document.querySelectorAll('.stkc-zs-run')].find((x) => x.offsetParent); if (b) b.click(); return !!b; });
  let head = '';
  for (let i = 0; i < 160; i++) {
    await p.waitForTimeout(150);
    head = await p.evaluate(() => { const e = [...document.querySelectorAll('.sed-prob-hd')].find((x) => x.offsetParent); return e ? e.dataset.s + ' ' + e.textContent : ''; });
    if (head && !/^busy/.test(head)) break;
    // phone layout: the editor sheet closes itself after a successful Add, so the plot on the chart is the signal
    if (!head && await p.evaluate(() => { try { return window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.context().cells[0].chart).length > 0; } catch (e) { return false; } })) { head = 'ok (editor closed)'; break; }
  }
  const ms = Date.now() - t0;
  const plots = await p.evaluate(() => { try { const ch = window.STRYKER_VELA.context().cells[0].chart; return window.STRYKER_PINE.pineHandles(ch).map((h) => { const i = ch.inspect().indicators.find((x) => x.id === h.id) || {}; return Object.keys(i.series || {}).length; }); } catch (e) { return ['ERR ' + e.message]; } });
  const prob = await p.evaluate(() => [...document.querySelectorAll('.sed-prob')].filter((x) => x.offsetParent).map((x) => x.textContent).join(' | ').slice(0, 300));
  return { clicked, ms, head, plots, prob };
}

(async () => {
  const runs = [['webkit'], ['chromium'], ['firefox'], ['webkit', IPHONE, 'iphone']];
  for (const [name, opts, tag] of runs) {
    const b = await pw[name].launch(name === 'chromium' && executablePath() ? { executablePath: executablePath() } : {});
    const label = name + (tag ? '-' + tag : '');
    try {
      const { ctx, p } = await page(b, opts);
      const r = await editorAdd(p);
      check(r.clicked && /^ok/.test(r.head) && r.plots.length === 1 && r.plots[0] > 0 && r.ms < FAST_MS,
        `${label} editor Add: ${r.ms}ms head="${r.head}" plots=${JSON.stringify(r.plots)}${/^ok/.test(r.head) ? '' : ' prob=' + r.prob}`);
      if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await p.screenshot({ path: path.join(OUT, `pinesafari-${label}.png`) }); }
      await ctx.close();
      if (!tag) {
        // A worker that can't start must say so (never "heavy for this device") and reach the error log (window 'error').
        const { ctx: c2, p: p2 } = await page(b, null, () => {
          const B = window.Blob;
          window.Blob = function (parts, o) { if (parts && typeof parts[0] === 'string' && parts[0].length > 500000) parts = ['throw new Error("simulated engine load failure")']; return new B(parts, o); };
          window.Blob.prototype = B.prototype;
          window.__errs = []; window.addEventListener('error', (e) => window.__errs.push(String(e.message)));
        });
        const r2 = await p2.evaluate(async (src) => { const ch = window.STRYKER_VELA.context().cells[0].chart; const t0 = performance.now(); const res = await window.STRYKER_PINE.runOnChart(ch, src, undefined, true, { inline: true }); return { ok: res.ok, msg: res.msg, ms: Math.round(performance.now() - t0), logged: window.__errs.some((m) => /Pine couldn't start/.test(m)) }; }, SRC);
        check(!r2.ok && /Pine couldn't start in this browser/.test(r2.msg) && !/heavy/.test(r2.msg) && r2.logged && r2.ms < 5000,
          `${label} start failure: ${r2.ms}ms logged=${r2.logged} msg="${r2.msg}"`);
        await c2.close();
      }
    } finally { await b.close(); }
  }
  console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
