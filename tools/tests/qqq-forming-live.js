// Live freshness probe for the QQQ 1m forming candle on the polled path (Discord 24 Nov, Mac app). Real charts.html from the local
// server, the Mac desktop app's user agent, signed-in stub (richstub.js; the live-lane check is answered "unknown" like during the
// 24 Nov Firestore outage, so the chart polls), /api/chart/bars proxied to the LIVE site. Samples the chart's last bar every 4 s for
// ~75 s and the server's own newest row, so the forming candle's shape and lag can be compared. Needs US market hours to mean anything.
//   CHART_BASE=http://127.0.0.1:8813 node tools/tests/qqq-forming-live.js [outdir] [label]
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp'; const LABEL = process.argv[3] || 'run';
const MAC_APP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
(async () => {
  const b = await launch();
  try {
    const ctx = await b.newContext({ userAgent: MAC_APP_UA, viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(stub);
    await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
    await ctx.route(/\/api\/chart\/rt/, (r) => r.fulfill({ status: 503, body: '{}' }));
    await ctx.route(/\/api\/chart\/bars\//, async (r) => {
      const u = new URL(r.request().url());
      try { const res = await fetch('https://tradezoro.com' + u.pathname + u.search, { headers: { accept: 'application/json' } }); r.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() }); }
      catch (e) { r.fulfill({ status: 502, body: '{}' }); }
    });
    await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick|binance|coinbase|hyperliquid|bybit|workers\.dev)\./, (r) => r.abort());
    const p = await ctx.newPage();
    await p.goto(BASE + '/charts.html?search=classic', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 60000 });
    await p.evaluate(async () => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol('idx:QQQ'); c.setTimeframe('1');
      for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); try { if (ws.context().cells[0].chart.orchestrator.rawBars.length > 20) break; } catch (e) {} } });
    const rows = [];
    for (let i = 0; i < (+process.env.N || 19); i++) {
      const s = await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0], bs = c.chart.orchestrator.rawBars, l = bs[bs.length - 1]; return { sym: c.symbol, tf: c.timeframe, t: l.time, o: l.open, h: l.high, l: l.low, c: l.close }; });
      const now = Date.now(); const pg = Math.floor(now / 1000 / 28800);
      let srv = null; try { const j = await (await fetch('https://tradezoro.com/api/chart/bars/QQQ?tf=1&page=' + pg)).json(); srv = j.bars[j.bars.length - 1]; } catch (e) {}
      const tSec = s.t > 1e11 ? s.t / 1000 : s.t;
      rows.push({ at: new Date(now).toISOString().slice(11, 19), chartBar: new Date(tSec * 1000).toISOString().slice(11, 16), range: +(s.h - s.l).toFixed(2), o: s.o, h: s.h, l: s.l, c: s.c, srvBar: srv && new Date(srv[0] * 1000).toISOString().slice(11, 16), srvC: srv && srv[4], minuteAgeS: Math.round(now / 1000 - tSec) });
      if (i === 18) await p.screenshot({ path: path.join(OUT, 'qqq-1m-' + LABEL + '-1440.png') });
      await new Promise((r) => setTimeout(r, 4000));
    }
    console.log(LABEL, rows[0] && rows[0].sym);
    for (const r of rows) console.log(JSON.stringify(r));
    const behind = rows.filter((r) => r.srvBar && r.chartBar < r.srvBar).length, flat = rows.filter((r) => r.range === 0 && r.minuteAgeS > 15).length;
    console.log(`${LABEL}: samples ${rows.length}, chart minute behind the server's newest minute: ${behind}, forming candle flat after 15 s into its minute: ${flat}`);
    await ctx.close();
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
