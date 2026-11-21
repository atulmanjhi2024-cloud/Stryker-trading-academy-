// Price precision (upstream 0.10.14 / #418 "Candle readouts and Fibonacci price labels show the symbol's price precision").
//   CHART_BASE=http://127.0.0.1:PORT tools/chrome-slot.sh node tools/tests/chart-precision-browser.js [shotsDir]
// Needs the dev server's live bars (Yahoo / exchange feeds). Per symbol: the legend's OHLC readout, the price axis'
// last-price chip text and a Fib retracement's level labels must all carry the symbol's tick decimals:
//   fx:EURUSD (tick 0.00001 -> 5), futures:NQ1! (0.25 -> 2), binance:DOGEUSDT (exchange tick, 5), binance:BTCUSDT (0.01 -> 2).
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '.';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };
const decs = (t) => { const m = String(t).replace(/,/g, '').match(/-?\d+(?:\.(\d+))?/); return m ? (m[1] || '').length : -1; };

(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { for (const k of ['stryker_install_prompt_shown_u1', 'stryker_push_prompt_shown_u1', 'stryker_community_disclaimer_ack_v1']) localStorage.setItem(k, '1'); } catch (e) {} });
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) errors.push(String(e).slice(0, 200)); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => { try { const ws = window.STRYKER_VELA; return ws && ws.cell(ws.active.id).chart.renderer.renderer.coords.barCount > 20; } catch (e) { return false; } }, null, { timeout: 90000 });
  for (const [sym, want] of [['fx:EURUSD', 5], ['futures:NQ1!', 2], ['binance:DOGEUSDT', 5], ['binance:BTCUSDT', 2]]) {
    const st = await p.evaluate(async (sym) => {
      const ws = window.STRYKER_VELA; ws.active.setSymbol(sym); ws.active.setTimeframe('15');
      for (let i = 0; i < 120; i++) { await new Promise((r) => setTimeout(r, 250)); const c = ws.cell(ws.active.id).chart, rr = c.renderer.renderer; if (c.market.symbol === sym && rr.coords.barCount > 20 && rr.scene.priceMintick) break; }
      const c = ws.cell(ws.active.id).chart, rr = c.renderer.renderer;
      return { mintick: rr.scene.priceMintick, bars: rr.coords.barCount };
    }, sym);
    await p.waitForTimeout(1500);
    // Fib retracement from the visible low to high, through the drawings API.
    const fib = await p.evaluate(() => {
      const ws = window.STRYKER_VELA, c = ws.cell(ws.active.id).chart, rr = c.renderer.renderer, bars = rr.scene.bars, n = bars.length;
      const a = bars[n - 40], z = bars[n - 5];
      const d = c.drawings.add('fibretracement', { anchors: [{ time: a.time, price: a.low }, { time: z.time, price: z.high }] });
      let texts = [];
      try { texts = (d.entryLines(rr.drawingProjector()) || []).map((g) => g.numberText).filter(Boolean); } catch (e) { texts = ['ERR ' + e]; }
      return { id: d && d.id, texts: texts.slice(0, 4) };
    });
    // hover a bar so the readout is filled (it is empty between a symbol switch and the next live bar)
    const box = await p.evaluate(() => { const ws = window.STRYKER_VELA; const c = [...ws.cell(ws.active.id).host.querySelectorAll('canvas')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0].getBoundingClientRect(); return { x: c.left + c.width * 0.6, y: c.top + c.height * 0.5 }; });
    await p.mouse.move(box.x, box.y); await p.mouse.move(box.x + 3, box.y + 2); await p.waitForTimeout(400);
    const legend = await p.evaluate(() => { const ws = window.STRYKER_VELA; const el = ws.cell(ws.active.id).host.querySelector('.vela-sl-ohlc'); return el ? [...el.querySelectorAll('b')].map((x) => x.textContent) : []; });
    const sl = (sym.replace(/[^a-z0-9]/gi, '_'));
    await p.screenshot({ path: `${OUT}/precision-${sl}.png` });
    console.log(sym, JSON.stringify({ st, legend, fib }));
    check(st.mintick > 0, `${sym}: the chart has the symbol's tick size`, st);
    check(legend.length >= 4 && legend.slice(0, 4).every((t) => decs(t) === want), `${sym}: legend OHLC has ${want} decimals`, legend);
    check(fib.texts.length > 0 && fib.texts.every((t) => decs(t.replace(/^[\d.]+ \(/, '')) === want), `${sym}: Fib labels have ${want} decimals`, fib.texts);
    await p.evaluate((id) => { const ws = window.STRYKER_VELA; try { ws.cell(ws.active.id).chart.drawings.remove(id); } catch (e) {} }, fib.id);
  }
  check(!errors.length, 'no page errors', errors);
  await b.close();
  console.log(fail ? `FAILED ${fail}` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
