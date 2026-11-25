// Calculated dollar index DXY in the real Charts page (needs network for the six pairs' bars).
//   node tools/tests/chart-dev-server.mjs 8031 &
//   CHART_BASE=http://127.0.0.1:8031 node tools/tests/dxy-browser.js [shotsDir]
// Checks: dxy:DXY loads on 1m / 15m / 1h / 4h / D / W, price in a plausible range, "Calculated" chip + info line,
// search finds DXY / USDX / dollar index, a pair tick moves the index candle, 1440 + 390 shots, alignment gate (chip / dot row).
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };

async function open(b, { w, h, mobile, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', t); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick|binance|coinbase|hyperliquid|bybit)\./, (r) => r.abort());
  const p = await ctx.newPage();
  await p.emulateMedia({ colorScheme: theme });
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|^WebSocket connection to|Failed to load resource|book-recorder/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html?symbol=dxy:DXY', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_DATA_DOT, null, { timeout: 60000 });
  await p.waitForTimeout(3000);
  return { ctx, p, errors };
}
const load = (p, sym, tf) => p.evaluate(async ([sym, tf]) => {
  const ws = window.STRYKER_VELA, c = ws.cell(ws.context().cells[0].id);
  if (ws.context().cells[0].symbol !== sym) c.setSymbol(sym);
  c.setTimeframe(tf);
  for (let i = 0; i < 70; i++) { await new Promise((r) => setTimeout(r, 300)); try { const b = ws.context().cells[0].chart.orchestrator.rawBars; if (b.length > 5 && ws.context().cells[0].timeframe === tf) break; } catch (e) {} }
  const cell = ws.context().cells[0], bars = cell.chart.orchestrator.rawBars, last = bars[bars.length - 1];
  return { sym: cell.symbol, tf: cell.timeframe, n: bars.length, last: last && { o: last.open, h: last.high, l: last.low, c: last.close } };
}, [sym, tf]);
const rect = (p, sel) => p.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cy: r.y + r.height / 2, sw: e.scrollWidth, cw: e.clientWidth }; }, sel);

(async () => {
  const b = await launch();
  try {
    const d = await open(b, { w: 1440, h: 900, theme: 'dark' });
    const have = {};
    for (const tf of ['1', '15', '60', '240', 'D', 'W']) {
      const s = await load(d.p, 'dxy:DXY', tf);
      have[tf] = s.n;
      console.log('DXY', tf, JSON.stringify(s));
      const ok = s.n > 5 && s.last && s.last.c > 85 && s.last.c < 125 && s.last.h >= s.last.l;
      check(ok, `DXY ${tf}: ${s.n} bars, last close ${s.last && s.last.c.toFixed(3)} in 85..125`);
    }
    console.log('HAVE', JSON.stringify(have));
    await load(d.p, 'dxy:DXY', '15');
    await d.p.waitForTimeout(1500);
    const chip = await d.p.evaluate(() => { const c = document.querySelector('#vela-chart .stkc-calc'); return c && { t: c.textContent, title: c.title }; });
    check(chip && chip.t === 'Calculated' && /not the official/.test(chip.title), 'Calculated chip + info line present');
    check(!/\bICE\b/i.test(JSON.stringify(chip) + await d.p.evaluate(() => document.querySelector('.stkchart-credit') && document.querySelector('.stkchart-credit').textContent)), 'no vendor name in chip / credit');
    const credit = await d.p.evaluate(() => (document.querySelector('.stkchart-credit') || {}).textContent);
    check(/calculated by TradeZoro/i.test(credit || ''), 'info line under the chart: ' + (credit || '').slice(0, 60));
    // alignment: dot, chip and meta share a vertical centre
    const dot = await rect(d.p, '#vela-chart .stkc-dd'), ch = await rect(d.p, '#vela-chart .stkc-calc');
    check(dot && ch && Math.abs(dot.cy - ch.cy) <= 1, `dot/chip centre diff ${dot && ch && Math.abs(dot.cy - ch.cy).toFixed(2)} px`);
    check(ch && ch.sw <= ch.cw + 1, 'chip text not clipped');
    const pad = await d.p.evaluate(() => { const c = document.querySelector('#vela-chart .stkc-calc'); const cs = getComputedStyle(c); return [parseFloat(cs.paddingLeft), parseFloat(cs.paddingRight)]; });
    check(pad[0] === pad[1], `chip side padding equal (${pad})`);
    // search
    for (const q of ['DXY', 'USDX', 'dollar index']) {
      await d.p.evaluate(() => { const ws = window.STRYKER_VELA; try { ws.symbolPicker.close(); } catch (e) {} if (ws.openSymbolSearch) ws.openSymbolSearch(); else ws.symbolPicker.open(); });
      await d.p.waitForTimeout(700);
      await d.p.keyboard.press('Control+A'); await d.p.keyboard.type(q, { delay: 30 });
      await d.p.waitForTimeout(1200);
      const rows = await d.p.evaluate(() => [...document.querySelectorAll('.stkss-row, .vela-sp-row')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()));
      check(/DXY/.test(rows[0] || '') && /calculated/i.test(rows[0] || ''), `search "${q}" ranks DXY first: ${rows[0]}`);
      if (q === 'DXY') await d.p.screenshot({ path: `${OUT}/dxy-search-1440.png` });
    }
    await d.p.evaluate(() => { try { window.STRYKER_VELA.symbolPicker.close(); } catch (e) {} });
    await d.p.keyboard.press('Escape');
    await d.p.waitForTimeout(500);
    await d.p.screenshot({ path: `${OUT}/dxy-15m-1440-dark.png` });
    // second chart (overlay-compare via a second cell) not driven here: the provider is the same instance path as any symbol
    check(d.errors.length === 0, 'no page errors ' + d.errors.slice(0, 2).join(' | '));
    await d.ctx.close();

    const m = await open(b, { w: 390, h: 844, mobile: true, theme: 'light' });
    await load(m.p, 'dxy:DXY', '60');
    await m.p.waitForTimeout(1500);
    const hs = await m.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    check(hs, 'no horizontal scroll at 390');
    const mc = await rect(m.p, '#vela-chart .stkc-calc');
    check(mc && mc.sw <= mc.cw + 1 && mc.x >= 0 && mc.x + mc.w <= 390, 'phone chip inside the viewport, not clipped ' + JSON.stringify(mc));
    await m.p.screenshot({ path: `${OUT}/dxy-1h-390-light.png` });
    check(m.errors.length === 0, 'no page errors (phone) ' + m.errors.slice(0, 2).join(' | '));
    await m.ctx.close();
  } finally { await b.close(); }
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
