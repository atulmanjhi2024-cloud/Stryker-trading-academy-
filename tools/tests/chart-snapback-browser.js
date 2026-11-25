// Scroll-back stays put (member GK 25 Nov 2026, Discord 1575028504800788550): "when I scroll the chart backwards the chart jumps back to the
// latest price". Rule: scrolled away from the live edge = every update keeps the view; only a chart already AT the live edge follows.
// Cause found: the keep-the-view hook in chart-settings.js (keepViewOnSwitch) restored the view only for rightOffset >= 0, so ANY reload of the
// SAME series that goes through setBars without preserveView (lane change, replay end, setMarket({data:[]}), history refresh) re-anchored at the
// newest bar; and chart-pine.js ensureRoom() (timers after every such reload) set rightOffset back to the indicator room.
// FIXTURES only (futures bars via a route stub, crypto via binance-mock.js). Labelled "Sample data" in the shots (no real prices claimed).
//   node tools/tests/chart-dev-server.mjs 8123 &
//   CHART_BASE=http://127.0.0.1:8123 flock /tmp/stryker-chrome.lock node tools/tests/chart-snapback-browser.js <shotsDir> [tag]
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const bm = require('./binance-mock.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8123', OUT = process.argv[2] || '/tmp/snapback', TAG = process.argv[3] || 'after';
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };

async function open(b, { w, h, theme, mobile }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)(?!(api\.binance\.com|data-api\.binance\.vision|fapi\.binance\.com|stream\.binance))/, (r) => r.abort());
  await bm.install(ctx);
  await ctx.route('**/api/chart/bars/**', (r) => {   // Sample data: a sine path, 1 bar per tf
    const u = new URL(r.request().url()), tf = Number(u.searchParams.get('tf') || 1), P = { 1: 8 * 3600, 5: 2 * 86400, 15: 5 * 86400 }[tf] || 8 * 3600, now = Math.floor(Date.now() / 1000);
    const page = u.searchParams.has('page') ? Number(u.searchParams.get('page')) : Math.floor(now / P);
    if (page < Math.floor(now / P) - 40) return r.fulfill({ json: { bars: [] } });
    const bars = []; for (let t = page * P; t < (page + 1) * P && t <= now; t += 60 * tf) { const c = Math.round((100 + 12 * Math.sin(t / 1800)) * 4) / 4; bars.push([t, c - 1, c + 2, c - 2, c, 100]); }
    return r.fulfill({ json: { s: 'NQ', tf: String(tf), page, bars, rt: true } });
  });
  const p = await ctx.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  return { ctx, p, errors };
}
const info = (p) => p.evaluate(() => {
  const c = window.STRYKER_VELA.chart, o = c.orchestrator, R = c.renderer.renderer, v = R.coords.getViewport(), r = R.wrapper.getBoundingClientRect();
  return { ro: +v.rightOffset.toFixed(2), n: o.rawBars.length, to: c.getVisibleRange().to, last: o.rawBars[o.rawBars.length - 1].time, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
});
async function load(p, sym) {
  await p.evaluate((s) => { const w = window.STRYKER_VELA; w.active.setSymbol(s); w.active.setTimeframe('1'); }, sym);
  await p.waitForFunction((s) => { const o = window.STRYKER_VELA.chart.orchestrator; return o.config.market.symbol === s && String(o.config.market.timeframe) === '1' && o.rawBars.length > 200 && o.historyCompleted && !o.switchingMarket; }, sym, { timeout: 60000 });
  await p.waitForTimeout(2000);
}
async function drag(p, frac, touch, ctx) {
  const s = await info(p), y = s.rect.y + s.rect.h * 0.4, x0 = s.rect.x + s.rect.w * (touch ? 0.1 : 0.2);
  if (touch) {
    const cdp = await ctx.newCDPSession(p), pt = (x) => [{ x, y }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x0) });
    for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x0 + s.rect.w * frac * k / 8) }); await p.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await p.mouse.move(x0, y); await p.mouse.down();
    for (let k = 1; k <= 10; k++) { await p.mouse.move(x0 + s.rect.w * frac * k / 10, y); await p.waitForTimeout(16); }
    await p.mouse.up();
  }
  await p.waitForTimeout(900);
}
const tick = (p, newBar) => p.evaluate((nb) => { const o = window.STRYKER_VELA.chart.orchestrator, l = o.rawBars[o.rawBars.length - 1];
  o.applyBar(nb ? { time: l.time + 60000, open: l.close, high: l.close + 1, low: l.close - 1, close: l.close, volume: 1 } : { ...l, close: l.close + 0.25, high: Math.max(l.high, l.close + 0.25) }); }, newBar);

async function scenario(b, tag, sym, vp) {
  const { ctx, p, errors } = await open(b, vp);
  await load(p, sym);
  const t = `${tag} ${sym} ${vp.w}${vp.theme === 'light' ? ' light' : ' dark'}`;
  // 1) AT the live edge: a new bar keeps following (ro stays at its margin)
  const e0 = await info(p); await tick(p, true); await p.waitForTimeout(400); const e1 = await info(p);
  check(e1.ro >= 0 && Math.abs(e1.ro - e0.ro) < 1.5, `${t}: at the live edge a new bar keeps following`, [e0.ro, e1.ro]);
  // 2) scroll back
  await drag(p, 0.7, vp.mobile, ctx); await drag(p, 0.7, vp.mobile, ctx);
  const s0 = await info(p);
  check(s0.ro < -10, `${t}: scrolled back (rightOffset ${s0.ro})`);
  const view0 = s0.to;
  const still = async (name) => { await p.waitForTimeout(700); const q = await info(p); check(Math.abs(view0 - q.to) <= 61000 && q.ro < -5, `${t}: ${name} keeps the historical view`, { ro0: s0.ro, ro: q.ro, to0: view0, to: q.to }); return q; };
  await tick(p, false); await still('live tick');
  await tick(p, true); await still('new bar');
  await p.evaluate(() => { const o = window.STRYKER_VELA.chart.orchestrator; o.setBarSeries([...o.rawBars], { preserveView: true }); }); await still('history top-up (preserveView)');
  await p.evaluate(() => { const o = window.STRYKER_VELA.chart.orchestrator; o.setBarSeries([...o.rawBars]); }); await still('series reload without preserveView');
  await p.evaluate(async () => { const c = window.STRYKER_VELA.chart; await c.setMarket({ data: [] }); try { delete c.orchestrator.config.market.data; } catch (e) {} }); await p.waitForTimeout(2500);
  await still('same-market reload (lane change / replay end)');
  // Tab resume + reconnect: visibility/pageshow/focus/online all fire the resync + gap heal paths
  await p.evaluate(() => { for (const [t, tgt] of [['visibilitychange', document], ['pageshow', window], ['focus', window], ['online', window]]) tgt.dispatchEvent(new Event(t)); }); await p.waitForTimeout(3500); await still('tab resume / reconnect events');
  // Session change reload: same symbol + timeframe, the series is re-read
  await p.evaluate(async () => { const c = window.STRYKER_VELA.chart; const m = c.orchestrator.config.market; await c.setMarket({ symbol: m.symbol, timeframe: m.timeframe, session: m.session === 'eth' ? 'rth' : 'eth', data: [] }); try { delete c.orchestrator.config.market.data; } catch (e) {} }); await p.waitForTimeout(2500);
  await still('session reload (same symbol + timeframe)');
  // Layers' first-paint fits (heatmap / liquidity / footprint / chart types) must not re-anchor a scrolled-back chart
  const ap = await p.evaluate(() => { const R = window.STRYKER_VELA.chart.renderer.renderer, v = R.coords.getViewport(); return { ro: v.rightOffset }; });
  check(ap.ro < -5, `${t}: still scrolled back before ensureRoom check`, ap);
  await p.evaluate(() => { try { window.STRYKER_PINE && window.STRYKER_PINE.ensureRoom(window.STRYKER_VELA.chart); } catch (e) {} }); await still('indicator room timer (ensureRoom)');
  await p.screenshot({ path: `${OUT}/${TAG}-${sym.replace(/\W/g, '')}-${vp.w}-${vp.theme}.png` });
  // 3) Latest button / symbol switch still return to the live edge
  await p.evaluate(() => { const s = window.STRYKER_VELA; s.active.setTimeframe('5'); });
  await p.waitForFunction(() => { const o = window.STRYKER_VELA.chart.orchestrator; return String(o.config.market.timeframe) === '5' && o.rawBars.length > 20 && !o.switchingMarket && window.STRYKER_VELA.chart.getVisibleRange(); }, null, { timeout: 60000 }); await p.waitForTimeout(1500);
  const sw = await info(p); check(sw.ro >= 0, `${t}: a timeframe switch still lands on the latest bar`, sw.ro);
  check(errors.length === 0, `${t}: no page errors`, errors.slice(0, 2));
  await ctx.close();
}
(async () => {
  const b = await launch();
  try {
    for (const sym of ['futures:NQ1!', 'binance:BTCUSDT']) {
      await scenario(b, TAG, sym, { w: 1440, h: 900, theme: 'dark' });
      if (sym.startsWith('futures')) { await scenario(b, TAG, sym, { w: 1440, h: 900, theme: 'light' }); await scenario(b, TAG, sym, { w: 390, h: 844, theme: 'dark', mobile: true }); }
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
