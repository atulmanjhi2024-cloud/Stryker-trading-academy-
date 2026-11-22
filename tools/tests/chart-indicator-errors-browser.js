// INDICATOR ERRORS UNDER CHURN (Owner bug 22 Nov: red toasts "[A] Cannot read properties of undefined (reading
// 'openTime')" stacking on the desktop/phone apps). 12+ indicators (Vela natives, TradeZoro natives, Pine on both
// the next worker and the classic worker) on NQ1! 1m, then: fast symbol/timeframe switches, a symbol with NO bars
// (closed market / empty feed), back to bars (reconnect), a 2-chart layout (new empty cell), and resizes.
// Asserts: zero indicator:error events on every cell, no raw "[A] ..." toast on screen. Fixture bars, no network
// except cdn.jsdelivr.net (Pine engine). Screenshots after the churn at 1440 and 390.
//   node tools/tests/chart-dev-server.mjs 8031 &
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/chart-indicator-errors-browser.js <shotsDir>
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x !== undefined ? ' ' + JSON.stringify(x).slice(0, 1500) : '')); };

const MIN = Math.floor(Date.now() / 60000), N = 600;
const price = (m) => 21650 + Math.sin((m - MIN) / 17) * 40 + Math.sin((m - MIN) / 5) * 9;
const rows = []; for (let m = MIN - N; m < MIN; m++) { const o = price(m), c = price(m + 1); rows.push([m * 60, o, Math.max(o, c) + 3, Math.min(o, c) - 3, c, 500]); }
const EMPTY = /CL|GC/;   // these symbols answer with no bars (closed market / empty feed)

const NATIVES = ['vwap', 'volume', 'vpvr', 'ema', 'sma', 'rsi', 'macd', 'bb', 'stk_gex', 'stk_msess', 'stk_camarilla', 'stk_barstats', 'stk_news', 'stk_fp', 'stk_em', 'stk_zvol'];
const PINE_LIGHT = '//@version=6\nindicator("Test SMA cross", overlay=true)\nf = ta.sma(close, 9)\ns = ta.sma(close, 21)\nplot(f)\nplot(s)\nplotshape(ta.crossover(f, s), style=shape.triangleup, location=location.belowbar)\nbgcolor(time == time_close ? na : na)';
const PINE_BUILTIN = 'zeiierman-trend-average';

async function open(b, w, h, mobile) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, (r) => {
    const sym = decodeURIComponent(r.request().url().split('/api/chart/bars/')[1] || '');
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: '1', page: 0, bars: EMPTY.test(sym) ? [] : rows }) });
  });
  const p = await ctx.newPage(), pageErrors = [];
  p.on('pageerror', (e) => pageErrors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_PINE, null, { timeout: 90000 });
  // Our own listener on every chart (works with or without assets/chart-ind-errors.js), plus raw toasts seen.
  await p.evaluate(() => {
    const ws = window.STRYKER_VELA; const seen = new WeakSet();
    window.__tErr = []; window.__tToasts = [];
    const wire = (c) => { if (!c || seen.has(c.chart)) return; seen.add(c.chart); c.chart.on('indicator:error', ({ id, error }) => {
      let h = null; try { h = c.chart.indicators().find((x) => x.id === id); } catch (e) {}
      window.__tErr.push({ cell: c.id, id, type: h && (h.nativeType || 'pine'), title: h && h.title, sym: c.symbol, tf: c.timeframe, msg: String(error && error.message), stack: String(error && error.stack || '').split('\n').slice(0, 5).join(' | ') }); }); };
    ws.cells().forEach(wire); ws.on('cell:created', ({ id }) => wire(ws.cell(id)));
    new MutationObserver(() => document.querySelectorAll('.toast, .vela-toast, [class*="toast"]').forEach((t) => { const s = (t.textContent || '').trim(); if (s && !window.__tToasts.includes(s)) window.__tToasts.push(s); })).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1'); for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.orchestrator.rawBars.length > 100) break; } });
  return { ctx, p, pageErrors };
}

async function addAll(p) {
  return p.evaluate(async ({ natives, light, builtin }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const c = window.STRYKER_VELA.context().cells[0].chart, added = [], skipped = [];
    for (const t of natives) { try { const h = c.addNativeIndicator(t, { inputs: {} }); (h ? added : skipped).push(t); } catch (e) { skipped.push(t + ': ' + e.message); } }
    window.STRYKER_VELA.context().stateChanged();
    const ack = setInterval(() => { const b = document.querySelector('.stkcd-ok'); if (b) b.click(); }, 200);
    try { const r = await window.STRYKER_PINE.runOnChart(c, light, {}, false, { engine: 'next' }); (r && r.ok !== false ? added : skipped).push('pine-next'); } catch (e) { skipped.push('pine-next: ' + e.message); }
    try { const r = await window.STRYKER_PINE.runOnChart(c, light.replace('Test SMA cross', 'Test SMA classic'), {}, false, {}); (r && r.ok !== false ? added : skipped).push('pine-classic'); } catch (e) { skipped.push('pine-classic: ' + e.message); }
    try {
      const B = await import('/assets/chart-pine-builtins.js?v=' + (document.querySelector('meta[name="build"]') || {}).content);
      const it = B.PICKER_SCRIPTS.find((x) => x.id === builtin);
      const r = await window.STRYKER_PINE.addSource(it.name, await B.builtinSource(it.id), { engine: 'next', builtin: true, rightOffset: it.rightOffset });
      (r && r.ok ? added : skipped).push('pine-builtin');
    } catch (e) { skipped.push('pine-builtin: ' + e.message); }
    clearInterval(ack);
    await sleep(3000);
    return { added, skipped, total: c.indicators().length };
  }, { natives: NATIVES, light: PINE_LIGHT, builtin: PINE_BUILTIN });
}

async function churn(p, w) {
  const sw = (sym, tf, ms) => p.evaluate(([s, t]) => { const a = window.STRYKER_VELA.active; if (s) a.setSymbol(s); if (t) a.setTimeframe(t); }, [sym, tf]).then(() => sleep(ms));
  // fast switches (faster than a load)
  for (const [s, t] of [['futures:ES1!', '5'], ['futures:NQ1!', '1'], [null, '15'], [null, '1'], ['futures:YM1!', '3'], ['futures:NQ1!', '1']]) await sw(s, t, 120);
  await sleep(4000);
  // closed market / empty feed, then back (reconnect with bars)
  await sw('futures:CL1!', '1', 6000);
  await sw('futures:GC1!', '5', 300);
  await sw('futures:NQ1!', '1', 6000);
  // resize
  for (const [x, y] of [[w - 300, 700], [w, 900], [390, 844], [w, 900]]) { await p.setViewportSize({ width: x, height: y }); await sleep(400); }
  // 2-chart layout: a new cell (no indicators, bars loading), then back to one
  await p.evaluate(() => { try { window.STRYKER_VELA.setLayout && window.STRYKER_VELA.setLayout('2h'); } catch (e) {} });
  await sleep(3000);
  await p.evaluate(() => { try { window.STRYKER_VELA.setLayout && window.STRYKER_VELA.setLayout('1'); } catch (e) {} });
  await sleep(5000);
}

(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    for (const [w, h, mobile, tag] of [[1440, 900, false, '1440'], [390, 844, true, '390']]) {
      const { ctx, p, pageErrors } = await open(b, w, h, mobile);
      const a = await addAll(p);
      check(a.total >= 10, `${tag}: 10+ indicators on the chart (${a.total})`, a);
      await churn(p, w);
      const errs = await p.evaluate(() => window.__tErr);
      const toasts = await p.evaluate(() => window.__tToasts);
      const opentime = errs.filter((e) => /openTime|closeTime|reading 'time'/.test(e.msg));
      check(opentime.length === 0, `${tag}: no openTime/closeTime/time indicator errors`, opentime.slice(0, 5));
      check(errs.length === 0, `${tag}: zero indicator:error events after the churn`, errs.slice(0, 8));
      check(!toasts.some((t) => /^\s*\[[A-Za-z0-9_-]{1,12}\]\s/.test(t) || /Cannot read properties/.test(t)), `${tag}: no raw developer error toast`, toasts.filter((t) => /\[|Cannot/.test(t)).slice(0, 5));
      check(pageErrors.filter((e) => /openTime/.test(e)).length === 0, `${tag}: no openTime page errors`, pageErrors.slice(0, 3));
      await p.setViewportSize({ width: w, height: h });
      await sleep(1500);
      await p.screenshot({ path: `${OUT}/ind-errors-${tag}.png` });
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? `FAILED ${fail}` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
