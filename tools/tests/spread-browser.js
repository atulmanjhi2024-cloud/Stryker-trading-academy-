// SPREAD on broker charts (Owner 25 Nov: "show spread lines like mt5 chart on our cfd charts and also show spread on trading panel").
// Admin, mocked cTrader socket only (tools/tests/ctrader-mock.mjs); every other host is aborted. Sample data only. READ-ONLY: this test
// never sends an order message (it asserts no NewOrder / Cancel / Amend reached the mock); the dock row comes from an injected position event.
//   node tools/tests/chart-dev-server.mjs 8031 &   CHART_BASE=http://127.0.0.1:8031 node tools/tests/spread-browser.js <shotsDir>
// Checks on NAS100 · cTrader (Sample fixture: pipPosition 1 = 0.1 pip size), spot bid 100.00 / ask 100.12:
//   two lines with right-scale tags "Bid 100.00" / "Ask 100.12"; panel Sell 100.00 / Buy 100.12 / "Spread 1.2"; a wide spot -> amber hint;
//   Positions dock: Spread column; chart settings toggle off -> no lines; NQ1! (futures) -> no lines; alignment; no horizontal scroll.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp/spread';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 700) : '')); };
const EXTRA = [{ symbolId: 13, symbolName: 'NAS100', digits: 2, pipPosition: 1, desc: 'Nasdaq 100 Index' }];
const US = '0aaa1111-2222-3333-4444-555566667777';

async function open(b, { w, h, mobile, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(({ t, US, EX }) => {
    window.__stkLiveTest = { isAdmin: () => true, isBeta: () => false, last: () => 100, fastRetry: true,
      ctCreds: { access: 'ACCESSTOKENsample1', refresh: 'REFRESHsample1', exp: Date.now() + 30 * 864e5, accountId: 77, isLive: false, login: 5551234, kind: 'trade' },
      ctDeps: { idToken: async () => 'IDT', save: async () => {} } };
    window.__toasts = []; const keep = () => (t, m) => { window.__toasts.push(String(m)); return Promise.resolve(); };
    Object.defineProperty(window, 'showToast', { configurable: true, get: () => keep(), set: () => {} });
    try {
      localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1');
      localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); localStorage.setItem('stryker_broker_sync_user_u1', US);
    } catch (e) {}
    window.__EXTRA = EX;
  }, { t: theme, US, EX: EXTRA });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route('**/api/chart/bars/**', (r) => {
    const u = new URL(r.request().url()), tf = Number(u.searchParams.get('tf') || 1), P = 8 * 3600, now = Math.floor(Date.now() / 1000);
    const page = u.searchParams.has('page') ? Number(u.searchParams.get('page')) : Math.floor(now / P);
    if (!/NQ/.test(u.pathname) || tf !== 1 || page < Math.floor(now / P) - 12) return r.fulfill({ json: { bars: [] } });
    const bars = []; for (let t = page * P; t < (page + 1) * P && t <= now; t += 60) { const c = Math.round((28750 + 6 * Math.sin(t / 540)) * 4) / 4; bars.push([t, c - 0.5, c + 1, c - 1, c, 100]); }
    return r.fulfill({ json: { s: 'NQ', tf: '1', page, bars, rt: true } });
  });
  await ctx.route('**/connect/ctrader/token*', (r) => r.fulfill({ json: { configured: true, client_id: 'CID_sample1' } }));
  const j = (o, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(o) });
  await ctx.route('**/connect/finatic/**', async (r) => {
    const u = new URL(r.request().url()); let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    if (u.searchParams.get('probe')) return r.fulfill(j({ configured: true }));
    if (u.pathname.endsWith('/data')) { if (body.op === 'accounts') return r.fulfill(j({ userId: US, data: [] })); return r.fulfill(j({ data: [] })); }
    return r.fulfill(j({ data: {} }));
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|Failed to load resource|Ping received|Unexpected response code|WebSocket/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('dialog', (d) => d.dismiss());
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  // Sample data bars around 100.00 (cTrader prices are 1/100000)
  await p.evaluate(async () => { (await import('/functions/connect/ctrader/_relay.js')).LIMITS.historyPerSec = 100;   /* test only: the mock answers history in 5 ms, so the chart's load burst trips the relay's 4/s cap (see report) */ const m = await import('/tools/tests/ctrader-mock.mjs'); const M = m.mockState({ extra: window.__EXTRA, barBase: [10005000, 20000, 0] }); window.__ctM = M; window.__stkLiveTest.ctDeps.WS = m.makeWS(M); });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkPaper, null, { timeout: 60000 });
  await p.waitForFunction(() => window.__stkLive && window.__stkLive.state.accounts.some((a) => a.ct), null, { timeout: 20000 });
  return { ctx, p, errors };
}
const opWait = (p, fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms || 10000 }).then(() => true, () => false);
const setSym = (p, s) => p.evaluate(async (s) => { const ws = window.STRYKER_VELA; ws.active.setSymbol(s); for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 250)); try { const R = window.__stkAxisTags.rendererOf(window.__stkAxisTags.cellsOf()[0]); if (ws.active.symbol === s && R.scene.bars.length > 20) break; } catch (e) {} } return ws.active.symbol; }, s);
// a cTrader spot on the view-only data socket (prices in 1/100000), like ProtoOASpotEvent
// (waits for an open data socket: the relay may drop one for history bursts while the chart loads, the hub then reconnects + resubscribes)
const spot = async (p, bid, ask) => { await opWait(p, () => { const s = window.__ctM.dataSocket; return s && s.readyState === 1 && window.__ctM.sent.lastIndexOf(window.__ctM.sent.filter((m) => m.payloadType === 2127).pop()) >= 0; }, null, 20000); return p.evaluate(({ bid, ask }) => { const s = window.__ctM.dataSocket; s.relay.onUp(JSON.stringify({ payloadType: 2131, payload: { ctidTraderAccountId: 77, symbolId: 13, bid: Math.round(bid * 1e5), ask: Math.round(ask * 1e5), timestamp: Date.now() } })); }, { bid, ask }); };
const baBoxes = (p) => p.evaluate(() => { const A = window.__stkAxisTags, R = A.rendererOf(A.cellsOf()[0]); const pr = R.plot.getBoundingClientRect(); return A.boxes(R).filter((b) => /^(Bid|Ask) /.test(b.text)).map((b) => ({ kind: b.kind, text: b.text, x: b.x, w: b.w, right: b.x + b.w, plotW: R.plot.clientWidth, coW: R.coords.width, top: b.top + pr.top, h: b.h, y: b.y })); });
const writes = (p) => p.evaluate(() => window.__ctM.sent.filter((m) => [2106, 2108, 2109, 2110, 2111].includes(m.payloadType)).length);

async function run(b, w, h, mobile, theme) {
  const tag = w + '-' + theme;
  const { ctx, p, errors } = await open(b, { w, h, mobile, theme });
  await p.evaluate(() => window.__stkLive.pick('ct-77'));
  const s = await setSym(p, 'byo:CT:NAS100');
  check(/^byo:CT:NAS100$/i.test(s), tag + ': chart is NAS100 · cTrader', s);
  const live = await opWait(p, () => !!(window.__ctM.dataSocket && window.__ctM.spots > 0), null, 15000);
  check(live, tag + ': spot subscription on the view-only data socket', await p.evaluate(() => ({ urls: window.__ctM.urls, sockets: window.__ctM.sockets, spots: window.__ctM.spots, ds: !!window.__ctM.dataSocket, sent: window.__ctM.sent.map((m) => m.payloadType).slice(-30), bars: window.__ctM.bars, n: (() => { try { return window.__stkAxisTags.rendererOf(window.__stkAxisTags.cellsOf()[0]).scene.bars.length; } catch (e) { return -1; } })() })));
  await sleep(1500);
  await spot(p, 100.00, 100.12);
  await opWait(p, () => { const A = window.__stkAxisTags; return A.boxes(A.rendererOf(A.cellsOf()[0])).some((b) => b.kind === 'ask'); }, null, 5000);
  let B = await baBoxes(p);
  const bid = B.find((x) => x.kind === 'bid'), ask = B.find((x) => x.kind === 'ask');
  check(bid && bid.text === 'Bid 100.00' && ask && ask.text === 'Ask 100.12', tag + ': two lines with right tags "Bid 100.00" / "Ask 100.12"', B);
  check(bid && ask && Math.abs(bid.right - bid.plotW + 1) <= 1 && Math.abs(ask.right - ask.plotW + 1) <= 1 && bid.x <= bid.coW + 1, tag + ': tags sit on the right scale, flush with its edge', B);
  check(bid && ask && ask.y < bid.y, tag + ': Ask line above the Bid line', B);
  check(await p.evaluate(() => window.__stkQuotes.get('byo:CT:NAS100').pip === 0.1), tag + ': pip size from the symbol details (pipPosition 1 -> 0.1)');
  // live tick moves the lines
  await spot(p, 100.05, 100.17);
  await opWait(p, () => { const A = window.__stkAxisTags; return A.boxes(A.rendererOf(A.cellsOf()[0])).some((b) => b.text === 'Ask 100.17'); }, null, 5000);
  B = await baBoxes(p);
  check(B.some((x) => x.text === 'Bid 100.05') && B.some((x) => x.text === 'Ask 100.17'), tag + ': next spot moves both lines', B);
  await spot(p, 100.00, 100.12); await sleep(150);
  // trading panel (Owner 25 Nov clean ticket): Sell tile = bid, Buy tile = ask, the spread chip between them
  await p.evaluate(() => window.__stkOrderPanel.open({ tab: 'order' }));
  await opWait(p, () => { const n = document.querySelector('#stkop [data-k=spr]'); return n && n.textContent === '1.2'; }, null, 5000);
  const panel = await p.evaluate(() => { const q = (s) => document.querySelector('#stkop ' + s); const r = (e) => e && e.getBoundingClientRect();
    const tile = (k) => { const e = q('.stkop-tile.' + k), R = r(e), px = e.querySelector('.stkop-tpx'); return { word: e.querySelector('.stkop-tl').textContent, px: px.textContent, clip: px.scrollWidth > px.clientWidth + 1, cy: R.top + R.height / 2 }; };
    const sp = q('[data-k=spr]'), sR = r(sp), sell = tile('sell'), buy = tile('buy');
    return { sell, buy, spread: sp.hidden ? null : sp.textContent, spDc: Math.abs(sR.top + sR.height / 2 - sell.cy), tilesDc: Math.abs(sell.cy - buy.cy), wide: q('[data-k=wide]').hidden, num: getComputedStyle(q('.stkop-tpx')).fontVariantNumeric }; });
  check(panel.sell.word === 'Sell' && panel.sell.px === '100.00' && panel.buy.word === 'Buy' && panel.buy.px === '100.12', tag + ': panel Sell 100.00 / Buy 100.12', panel);
  check(panel.spread === '1.2', tag + ': panel spread chip "1.2"', panel);
  check(panel.tilesDc <= 1 && panel.spDc <= 1 && !panel.sell.clip && !panel.buy.clip, tag + ': tiles + spread chip on one centre, prices not clipped', panel);
  check(/tabular-nums/.test(panel.num), tag + ': tile prices use tabular digits', panel);
  check(panel.wide === true, tag + ': no "wider than usual" hint at a normal spread', panel);
  await sleep(300); await p.screenshot({ path: OUT + '/chart-panel-' + tag + '.png' });
  // wider than usual: 25 normal samples (one a second), then a wide one -> amber hint
  await p.evaluate(() => { const Q = window.__stkQuotes, real = Date.now; let t = real(); Date.now = () => t; for (let i = 0; i < 25; i++) { t += 1000; Q.put('CT:NAS100', 100.00, 100.12); } t += 1000; Q.put('CT:NAS100', 100.00, 100.60); Date.now = real; });
  const wide = await opWait(p, () => !document.querySelector('#stkop [data-k=wide]').hidden && document.querySelector('#stkop [data-k=spr]').textContent === '6', null, 3000);
  const wc = await p.evaluate(() => { const w = document.querySelector('#stkop [data-k=wide]'); return { c: getComputedStyle(w).color, t: w.textContent, chip: document.querySelector('#stkop [data-k=spr]').classList.contains('wide'), clip: w.scrollWidth > w.clientWidth + 1 }; });
  check(wide && wc.t === 'Spread is wider than usual' && wc.chip && !wc.clip, tag + ': spread 6 (> 3x the 1.2 median) -> "Spread is wider than usual"', wc);
  await sleep(300); await p.screenshot({ path: OUT + '/panel-wide-' + tag + '.png' });
  await spot(p, 100.00, 100.12); await sleep(300);
  // dock: inject a position (server event, as cTrader would push it), check the Spread column
  await p.evaluate(() => { const M = window.__ctM; const pos = { positionId: 5001, positionStatus: 1, price: 100.05, tradeData: { symbolId: 13, volume: 100000, tradeSide: 1 } }; M.positions.push(pos);
    M.socket.relay.onUp(JSON.stringify({ payloadType: 2126, payload: { ctidTraderAccountId: 77, executionType: 3, position: pos, order: { orderId: 4001, orderStatus: 2, tradeData: pos.tradeData }, deal: { dealId: 901, orderId: 4001, positionId: 5001, executionPrice: 100.05, filledVolume: 100000, tradeSide: 1, symbolId: 13 } } })); });
  await opWait(p, () => window.__stkLive.state.data.positions.length === 1, null, 8000);
  await p.evaluate(() => window.__stkOrderPanel.close());
  const dock = await p.evaluate(async () => { if (!window.__stkPosOrders.open) window.__stkPosOrders.toggle(true); const b = document.querySelector('#stkpo-dock [role=tab][data-t=pos]'); if (b && !b.classList.contains('on')) b.click(); for (let k = 0; k < 20 && !document.querySelector('#stkpo-dock .stkpo-t thead th'); k++) await new Promise((r) => setTimeout(r, 250));
    const hd = [...document.querySelectorAll('#stkpo-dock .stkpo-t thead th')], i = hd.findIndex((x) => x.textContent === 'Spread'), row = document.querySelector('#stkpo-dock .stkpo-t tbody tr');
    const td = row && i >= 0 ? row.cells[i] : null; return { head: hd.map((x) => x.textContent), cell: td && td.textContent, align: td && getComputedStyle(td).textAlign, thAlign: i >= 0 && getComputedStyle(hd[i]).textAlign }; });
  check(dock.head.includes('Spread') && dock.cell === '1.2' && dock.align === 'right' && dock.thAlign === 'right', tag + ': Positions dock Spread column 1.2, right-aligned', dock);
  await sleep(300); await p.screenshot({ path: OUT + '/dock-' + tag + '.png' });
  await p.evaluate(() => { if (window.__stkPosOrders.open) window.__stkPosOrders.toggle(false); });
  // Chart settings > Scales and lines > "Show bid / ask lines": a real click turns them off
  if (!(await p.isVisible('#stkc-settings-btn'))) { await (mobile ? p.tap('#stkc-more-btn') : p.click('#stkc-more-btn')); await sleep(700); }
  await (mobile ? p.tap('#stkc-settings-btn') : p.click('#stkc-settings-btn'));
  await p.waitForSelector('.vela-dialog--settings .vela-sd-rail', { state: 'attached', timeout: 10000 }); await sleep(300);
  if (mobile && await p.isVisible('.vela-dialog--settings .vela-sd-burger')) { await p.click('.vela-dialog--settings .vela-sd-burger'); await sleep(300); }
  await p.locator('.vela-dialog--settings .vela-sd-tab', { hasText: /^\s*Scales and lines\s*$/ }).first().click(); await sleep(300);
  const rowSel = await p.evaluate(() => { const lab = [...document.querySelectorAll('.vela-dialog--settings .vela-field-label')].find((x) => x.textContent === 'Show bid / ask lines'); if (!lab) return null; const row = lab.closest('.vela-field-span') || lab.parentElement; row.scrollIntoView({ block: 'center' }); const sw = row.querySelector('button, input'); const a = lab.getBoundingClientRect(), b = sw.getBoundingClientRect(); return { on: sw.getAttribute('aria-checked') || String(sw.checked), dc: Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) }; });
  check(rowSel && /true/.test(rowSel.on) && rowSel.dc <= 1, tag + ': settings row "Show bid / ask lines", on by default, label + switch on one centre', rowSel);
  await sleep(200); await p.screenshot({ path: OUT + '/settings-' + tag + '.png' });
  await p.evaluate(() => { const lab = [...document.querySelectorAll('.vela-dialog--settings .vela-field-label')].find((x) => x.textContent === 'Show bid / ask lines'); (lab.closest('.vela-field-span') || lab.parentElement).querySelector('button, input').click(); });
  await sleep(200);
  const ok = p.locator('.vela-dialog--settings .vela-dialog-footer button', { hasText: /^\s*Ok\s*$/ }); if (await ok.count()) await ok.first().click(); else await p.keyboard.press('Escape');
  await sleep(500);
  check(!(await baBoxes(p)).length, tag + ': toggle off -> no Bid / Ask lines', await baBoxes(p));
  check(await p.evaluate(() => localStorage.getItem('stk_bidask_u1') === '0' && window.__stkAxisTags.bidAskOn() === false), tag + ': off is saved per user (stk_bidask_<uid>)', await p.evaluate(() => Object.keys(localStorage).filter((k) => /bidask/.test(k))));
  await sleep(200); await p.screenshot({ path: OUT + '/toggle-off-' + tag + '.png' });
  await p.evaluate(() => window.__stkAxisTags.setBidAsk(true)); await sleep(300);
  check((await baBoxes(p)).length === 2, tag + ': toggle on again -> lines back');
  // futures chart: no bid / ask lines (no two-sided broker feed)
  await setSym(p, 'futures:NQ1!'); await sleep(600);
  check(!(await baBoxes(p)).length, tag + ': NQ1! futures chart: no Bid / Ask lines');
  check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), tag + ': no horizontal scroll');
  check((await writes(p)) === 0, tag + ': read-only: no order message reached the mock');
  check(!errors.length, tag + ': no page errors', errors);
  await ctx.close();
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile, theme] of [[1440, 900, false, 'dark'], [1440, 900, false, 'light'], [390, 844, true, 'dark'], [390, 844, true, 'light']]) {
      if (process.env.ONE && process.env.ONE !== w + '-' + theme) continue;
      await run(b, w, h, mobile, theme);
    }
  } catch (e) { fail++; console.log('FAIL crashed ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
