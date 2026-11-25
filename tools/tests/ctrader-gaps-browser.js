// CFDGAPS browser test (Owner bug 25 Nov: "candles are breaking in cfd charts like ctrader"). Real chart page, MOCKED cTrader
// socket (tools/tests/ctrader-mock.mjs: real relay rules + fake server; all bars Sample data). Opens byo:CT:NAS100 1m with the
// server's bars ending 7 minutes ago, then (1) the relay drops and comes back with the server at "now" and a live tick: every minute
// must be on the chart, no gap; (2) tab hidden, the server moves on, tab visible: healed; legend tag reads "cTrader".
// Read-only: checks that no order frame is sent.
//   node tools/tests/chart-dev-server.mjs 8031 &   CHART_BASE=http://127.0.0.1:8031 node tools/tests/ctrader-gaps-browser.js <shotsDir> [tag]
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp/cfdgaps';
const TAG = process.argv[3] || 'after';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 600) : '')); };
const EXTRA = [{ symbolId: 13, symbolName: 'NAS100', digits: 2, desc: 'Nasdaq 100 Index' }];

async function run(b, theme, w) {
  const tag = TAG + '-' + w + '-' + theme;
  const ctx = await b.newContext({ viewport: { width: w, height: w < 600 ? 844 : 900 }, deviceScaleFactor: w < 600 ? 2 : 1, isMobile: w < 600, hasTouch: w < 600 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(({ t, EX }) => {
    window.__stkLiveTest = { isAdmin: () => true, isBeta: () => false, last: () => 25000, fastRetry: true,
      ctCreds: { access: 'ACCESSTOKENsample1', refresh: 'REFRESHsample1', exp: Date.now() + 30 * 864e5, accountId: 77, isLive: false, login: 5551234, kind: 'trade' },
      ctDeps: { idToken: async () => 'IDT', save: async () => {} } };
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {}
    window.__EXTRA = EX;
    // controllable visibility (the test hides / shows the tab)
    let hid = false; window.__setHidden = (h) => { hid = h; document.dispatchEvent(new Event('visibilitychange')); };
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hid });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hid ? 'hidden' : 'visible') });
  }, { t: theme, EX: EXTRA });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route('**/connect/ctrader/token*', (r) => r.fulfill({ json: { configured: true, client_id: 'CID_sample1' } }));
  await ctx.route('**/connect/finatic/**', (r) => r.fulfill({ status: 409, contentType: 'application/json', body: '{"needsConnect":true}' }));
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|Failed to load resource|Ping received|Unexpected response code|WebSocket/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  // server bars (Sample data) up to SERVER_TO; minutes after it do not exist yet
  await p.evaluate(async () => {
    const m = await import('/tools/tests/ctrader-mock.mjs'); const M = m.mockState({ extra: window.__EXTRA }); window.__ctM = M;
    const now0 = Math.floor(Date.now() / 60000); M.now0 = now0; M.to = now0 - 7;
    M.bar = (k) => (k <= M.to ? { low: 2500000000 + Math.round(3000000 * Math.sin(k / 6)) + (k % 3) * 400000, deltaOpen: 900000, deltaHigh: 2200000, deltaClose: (k % 2 ? 300000 : 1600000), volume: 5 } : null);
    window.__stkLiveTest.ctDeps.WS = m.makeWS(M);
  });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await p.waitForFunction(() => window.__stkLive && window.__stkLive.state && window.__stkLive.state.accounts.some((a) => a.ct), null, { timeout: 20000 }).catch(() => {});
  await sleep(1500);
  await p.evaluate(() => { window.STRYKER_VELA.active.setTimeframe ? window.STRYKER_VELA.active.setTimeframe('1') : 0; window.STRYKER_VELA.active.setSymbol('byo:CT:NAS100'); });
  const raw = () => p.evaluate(() => { try { const c = window.STRYKER_VELA.cell(window.STRYKER_VELA.active.id) || window.STRYKER_VELA.active; return c.chart.orchestrator.rawBars.map((b) => [Math.round(b.time / 60000) - window.__ctM.now0, b.close]); } catch (e) { return []; } });
  await p.waitForFunction(() => { try { const c = window.STRYKER_VELA.cell(window.STRYKER_VELA.active.id); return /CT:NAS100/i.test(window.STRYKER_VELA.active.symbol) && c.chart.orchestrator.rawBars.length > 50 && window.STRYKER_VELA.active.timeframe === '1'; } catch (e) { return false; } }, null, { timeout: 30000 }).catch(() => {});
  await sleep(1500);
  let r = await raw();
  check(r.length > 50 && r[r.length - 1][0] === -7, tag + ': history loaded to 7 min ago (Sample data)', r.slice(-3));
  // (1) relay drops; the server moves on to "now"; the socket comes back and the first live tick arrives for the current minute
  await p.evaluate(() => { const M = window.__ctM; M.to = M.now0; M.socket.relay.onUpClose(); });
  await p.waitForFunction(() => window.__ctM.sockets >= 2 && window.__ctM.socket.readyState === 1 && (window.__ctM.tbSubs || []).length >= 2, null, { timeout: 20000 }).catch(() => {});
  await sleep(800);
  const tick = () => p.evaluate(() => { const M = window.__ctM, s = M.socket, k = Math.floor(Date.now() / 60000); M.to = k; s.relay.onUp(JSON.stringify({ payloadType: 2131, payload: { ctidTraderAccountId: 77, symbolId: 13, bid: 2504321000, ask: 2504500000, timestamp: Date.now(), trendbar: [{ period: 'M1', utcTimestampInMinutes: k, low: 2503000000, deltaOpen: 900000, deltaHigh: 1800000 }] } })); return k - M.now0; });
  const k1 = await tick();
  await sleep(6000);
  r = await raw();
  const tail = r.filter((x) => x[0] >= -10), gaps = tail.slice(1).filter((x, i) => x[0] - tail[i][0] !== 1).map((x) => x[0]);
  check(!gaps.length && tail[tail.length - 1][0] === k1, tag + ': after the drop every minute -10..' + k1 + ' is on the chart (no gap)', tail.map((x) => x[0]));
  check(tail.length && tail[tail.length - 1][1] === 25043.21, tag + ': forming bar closes at the BID (25043.21), not the ask', tail.slice(-1));
  const legend = await p.evaluate(() => ((document.querySelector('.vela-statusline .stkc-dd-t') || {}).textContent || '').trim());
  check(legend === 'cTrader', tag + ': legend source tag says "cTrader" (live), not "Your feed"', legend);
  // price scale + legend use the symbol's digits (NAS100: 2): every axis label and OHLC value has at most 2 decimals
  const fmt = await p.evaluate(() => { const c = window.STRYKER_VELA.cell(window.STRYKER_VELA.active.id); const o = c.chart.orchestrator; let ps = null; try { ps = o.renderer.scene ? o.renderer.scene.priceMintick : null; } catch (e) {} const R = window.__stkAxisTags.rendererOf(window.__stkAxisTags.cellsOf()[0]); return { mintick: R && R.scene ? R.scene.priceMintick : ps, sl: (document.querySelector('.vela-statusline') || {}).innerText || '' }; });
  check(fmt.mintick === 0.01 && !/\d\.\d{3,}/.test(fmt.sl), tag + ': price scale / legend at the symbol digits (mintick 0.01, no 3+ decimals)', fmt);
  await p.screenshot({ path: OUT + '/' + tag + '-drop.png' });
  // (2) tab hidden for a while, server moves on, tab visible again
  await p.evaluate(() => window.__setHidden(true));
  await sleep(500);
  await p.evaluate(() => { const M = window.__ctM; const keep = M.bar, kk = M.kk = Math.floor(Date.now() / 60000) - 3; M.bar = (k) => (k === kk ? { low: 2490000000, deltaOpen: 100000, deltaHigh: 300000, deltaClose: 200000, volume: 9 } : keep(k)); });
  await p.evaluate(() => window.__setHidden(false));
  await sleep(6500);
  r = await raw();
  const want = await p.evaluate(() => window.__ctM.kk - window.__ctM.now0);
  const fixed = r.find((x) => x[0] === want);
  check(fixed && fixed[1] === 24902, tag + ': tab hidden -> visible re-reads the server bars (changed closed bar fixed)', { want, fixed, tail: r.slice(-4) });
  const tail2 = r.filter((x) => x[0] >= -10), gaps2 = tail2.slice(1).filter((x, i) => x[0] - tail2[i][0] !== 1).map((x) => x[0]);
  check(!gaps2.length, tag + ': still no gap after the tab returns', tail2.map((x) => x[0]));
  const hs = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!hs, tag + ': no horizontal scroll');
  const M = await p.evaluate(() => window.__ctM.sent.filter((m) => [2106, 2107, 2108, 2109, 2110, 2111].includes(m.payloadType)).length);
  check(M === 0, tag + ': no order frames', M);
  check(!errors.length, tag + ': no page errors', errors);
  await p.screenshot({ path: OUT + '/' + tag + '-visible.png' });
  await ctx.close();
}
(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=700'] });
  try {
    await run(b, 'dark', 1440);
    if (!process.env.QUICK) { await run(b, 'light', 1440); await run(b, 'dark', 390); }
  } catch (e) { fail++; console.log('FAIL crashed ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
