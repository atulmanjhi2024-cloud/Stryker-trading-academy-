// cTrader ORDER LINES on the chart (Owner bug 25 Nov: "its not showing order on chart when i place it"). Admin, mocked cTrader socket
// only (tools/tests/ctrader-mock.mjs: the real relay rules talk to a fake cTrader inside the page). No real order can be sent; every
// other host is aborted. Sample data only.
//   node tools/tests/chart-dev-server.mjs 8031 &   CHART_BASE=http://127.0.0.1:8031 node tools/tests/ctrader-ordlines-browser.js <shotsDir>
// Checks on the broker's own NAS100 chart (byo:CT:NAS100, "NAS100 · cTrader"):
//   limit buy -> a dashed SENDING line at once, then the working-order line (cTrader execution event) and the dock's Open orders row;
//   SL / TP on the order -> SL + TP lines; a fill of that order -> position line (entry + P&L) + SL / TP lines, the dock's Positions row;
//   stop sell -> line; cancel -> line gone + dock row gone; a refused order -> the sending line is removed.
// And on NQ1! (a futures chart, not the broker's prices) with the NAS100 order still working: no line (other prices), but a note
// "Your NAS100 order is on cTrader prices. Open NAS100 chart" whose button opens the NAS100 chart.
// Alignment: chip row centres, note padding even, no horizontal scroll at 390.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp/ordlines';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 700) : '')); };
const EXTRA = [{ symbolId: 13, symbolName: 'NAS100', digits: 2, desc: 'Nasdaq 100 Index' }];
const US = '0aaa1111-2222-3333-4444-555566667777';

async function open(b, { w, h, mobile, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(({ t, US, EX }) => {
    window.__stkLiveTest = { isAdmin: () => true, isBeta: () => false, last: () => 28750, fastRetry: true,
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
  await p.evaluate(async () => { const m = await import('/tools/tests/ctrader-mock.mjs'); const M = m.mockState({ extra: window.__EXTRA }); window.__ctM = M; window.__stkLiveTest.ctDeps.WS = m.makeWS(M); });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkPaper, null, { timeout: 60000 });
  await p.waitForFunction(() => window.__stkLive && window.__stkLive.state.accounts.some((a) => a.ct), null, { timeout: 20000 });
  return { ctx, p, errors };
}
const opWait = (p, fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms || 10000 }).then(() => true, () => false);
const setSym = (p, s) => p.evaluate(async (s) => { const ws = window.STRYKER_VELA; ws.active.setSymbol(s); for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 250)); try { const R = window.__stkAxisTags.rendererOf(window.__stkAxisTags.cellsOf()[0]); if (ws.active.symbol === s && R.scene.bars.length > 20) break; } catch (e) {} } return ws.active.symbol; }, s);
// chips on the chart overlay: [{ id, kind, a, b, cy, live }]
const chips = (p) => p.evaluate(() => [...document.querySelectorAll('.stkpt-chip')].filter((c) => c.offsetWidth > 0 && c.style.visibility !== 'hidden').map((c) => { const r = c.getBoundingClientRect(); return { id: c.dataset.id, kind: c.dataset.kind, a: (c.querySelector('.stkpt-chip-a') || {}).textContent || '', b: (c.querySelector('.stkpt-chip-b') || {}).textContent || '', cy: r.top + r.height / 2, live: !!c.dataset.live }; }));
const linesNow = (p, s) => p.evaluate((s) => (window.__stkPaper.live ? window.__stkPaper.live.lines(s) : []).map((l) => ({ id: l.id, kind: l.kind, price: l.price, role: l.role || '', pending: !!l.pending })), s);
const dockRows = (p, tab) => p.evaluate((tab) => { if (!window.__stkPosOrders.open) window.__stkPosOrders.toggle(true); const b = document.querySelector('#stkpo-dock [role=tab][data-t=' + tab + ']'); if (b && !b.classList.contains('on')) b.click(); return [...document.querySelectorAll('#stkpo-dock .stkpo-t tbody tr')].map((r) => [...r.cells].map((c) => c.textContent)); }, tab);
const sent = (p, ty) => p.evaluate((ty) => window.__ctM.sent.filter((m) => m.payloadType === ty).length, ty);

async function run(b, w, h, mobile, theme) {
  const tag = w + '-' + theme;
  const { ctx, p, errors } = await open(b, { w, h, mobile, theme });
  await p.evaluate(() => window.__stkLive.pick('ct-77'));
  const hidePanel = () => p.evaluate(() => { for (let i = 0; i < 3; i++) { const x = document.querySelector('#stkop:not([hidden]) [data-a=close]'); if (x) x.click(); } });
  const s = await setSym(p, 'byo:CT:NAS100');
  check(await opWait(p, () => window.__stkLive.state.lastOkStart > 0 && window.__stkLive.blockReason === '', null, 15000), tag + ': cTrader account picked and read', await p.evaluate(() => window.__stkLive.blockReason));
  check(/^byo:CT:NAS100$/i.test(s), tag + ': chart is NAS100 · cTrader', s);
  await opWait(p, () => { const i = window.__stkLive.info(window.STRYKER_VELA.active.symbol); return i && i.code === 'NAS100' && i.lots && i.lots.fromSchema && Number.isFinite(i.last); }, null, 10000);
  const inf = await p.evaluate(() => { const i = window.__stkLive.info(window.STRYKER_VELA.active.symbol); return i && { code: i.code, same: i.map.same, last: i.last }; });
  check(inf && inf.code === 'NAS100' && inf.same && inf.last > 0, tag + ': NAS100 chart trades NAS100 on broker prices', inf);
  const last = inf ? inf.last : 0.9;
  const r2 = (x) => Math.round(x * 100) / 100, lim = r2(last * 0.995), sl = r2(last * 0.985), tp = r2(last * 1.01);
  const S0 = await sent(p, 2106);
  // slow cTrader so the "sending" line can be seen
  await p.evaluate(() => { const pr = Object.getPrototypeOf(window.__ctM.socket); if (!pr.__ct0) { pr.__ct0 = pr._ct; pr._ct = function (m) { if (window.__slow && m.payloadType === 2106) return setTimeout(() => pr.__ct0.call(this, m), window.__slow); return pr.__ct0.call(this, m); }; } window.__slow = 600; });
  const pr = p.evaluate(({ lim, sl, tp }) => window.__stkPaper.live.placeTicket(window.STRYKER_VELA.active.symbol, { side: 'buy', type: 'limit', qty: 0.01, price: lim, sl, tp }, 'panel'), { lim, sl, tp });
  const pend = await opWait(p, () => [...document.querySelectorAll('.stkpt-chip[data-live]')].some((c) => /^P/.test(c.dataset.id) && c.offsetWidth > 0), null, 3000);
  check(pend, tag + ': limit buy -> SENDING line on the chart at once', await chips(p));
  if (pend) await hidePanel(); await sleep(250); await p.screenshot({ path: OUT + '/sending-' + tag + '.png' });
  await pr.catch(() => {});
  if (process.env.DBG) console.log('TOASTS', await p.evaluate(() => window.__toasts));
  await p.evaluate(() => { window.__slow = 0; });
  check((await sent(p, 2106)) === S0 + 1, tag + ': one NewOrder reached the mock');
  const ok1 = await opWait(p, () => window.__stkPaper.live.lines(window.STRYKER_VELA.active.symbol).some((l) => l.kind === 'ord' && !l.pending && !l.role), null, 8000);
  let L1 = await linesNow(p, s);
  check(ok1, tag + ': working limit line after the cTrader execution event', L1);
  check(L1.some((l) => l.role === 'sl') && L1.some((l) => l.role === 'tp'), tag + ': SL and TP lines with the working order', L1);
  await sleep(700);
  let C = await chips(p);
  check(C.some((c) => /LMT/.test(c.a)) && C.some((c) => /SL/.test(c.a)) && C.some((c) => /TP/.test(c.a)), tag + ': chips LMT / SL / TP drawn', C);
  let D = await dockRows(p, 'ord');
  check(D.length === 1 && D[0][0] === 'NAS100' && /Limit/.test(D[0][2]), tag + ': dock Open orders shows the NAS100 limit', D);
  await sleep(300);
  await hidePanel(); await sleep(250); await p.screenshot({ path: OUT + '/working-' + tag + '.png' });
  // mock fill of that order -> position line (+ SL / TP from the order)
  await p.evaluate(() => { const M = window.__ctM, o = M.orders[0]; M.orders = []; const pos = { positionId: o.orderId + 1000, positionStatus: 1, price: o.limitPrice, stopLoss: o.stopLoss, takeProfit: o.takeProfit, tradeData: o.tradeData }; M.positions.push(pos);
    M.socket.relay.onUp(JSON.stringify({ payloadType: 2126, payload: { ctidTraderAccountId: 77, executionType: 3, order: { ...o, orderStatus: 2 }, position: pos, deal: { dealId: 900, orderId: o.orderId, positionId: pos.positionId, executionPrice: o.limitPrice, filledVolume: o.tradeData.volume, tradeSide: 1, symbolId: 13 } } })); });
  const ok2 = await opWait(p, () => { const l = window.__stkPaper.live.lines(window.STRYKER_VELA.active.symbol); return l.some((x) => x.kind === 'pos') && !l.some((x) => x.kind === 'ord' && !x.role); }, null, 8000);
  L1 = await linesNow(p, s);
  check(ok2, tag + ': mock fill -> position line, limit line gone', L1);
  check(L1.some((l) => l.role === 'sl') && L1.some((l) => l.role === 'tp'), tag + ': SL / TP lines on the position', L1);
  await sleep(700);
  C = await chips(p);
  const pc = C.find((c) => c.kind === 'pos');
  check(pc && /LONG/.test(pc.a) && (mobile || /NAS100/.test(pc.a)) && /\$/.test(pc.b), tag + ': position chip: LIVE LONG 0.01 lot NAS100 @ price + P&L', C);
  D = await dockRows(p, 'pos');
  check(D.length === 1 && D[0][0] === 'NAS100' && D[0][1] === 'Long' && /\$/.test(D[0][D[0].length - 2]) && D[0][4] !== '—', tag + ': dock Positions shows NAS100 Long with Last + Open P&L (same as the chip)', D);
  check(D[0] && pc && D[0][D[0].length - 2] === pc.b, tag + ': dock P&L = chip P&L', [D[0] && D[0][5], pc && pc.b]);
  await sleep(300);
  await hidePanel(); await sleep(250); await p.screenshot({ path: OUT + '/position-' + tag + '.png' });
  // stop sell -> line; cancel -> gone (chart + dock)
  await opWait(p, () => window.__stkLive.blockReason === '', null, 10000); await sleep(400);
  const stp = r2(last * 0.99);
  await p.evaluate((stp) => window.__stkPaper.live.placeTicket(window.STRYKER_VELA.active.symbol, { side: 'sell', type: 'stop', qty: 0.01, price: stp }, 'panel'), stp);
  const ok3 = await opWait(p, () => window.__stkPaper.live.lines(window.STRYKER_VELA.active.symbol).some((l) => l.kind === 'ord' && !l.pending && !l.role && /stop/.test(l.type)), null, 8000);
  check(ok3, tag + ': stop sell -> STP line', await linesNow(p, s));
  const oid = await p.evaluate(() => (window.__stkPaper.live.lines(window.STRYKER_VELA.active.symbol).find((l) => l.kind === 'ord' && !l.role && !l.pending) || {}).oid);
  await opWait(p, () => window.__stkLive.blockReason === '', null, 10000); await sleep(400);
  await p.evaluate((oid) => window.__stkPaper.live.cancel(oid), oid);
  const ok4 = await opWait(p, () => !window.__stkPaper.live.lines(window.STRYKER_VELA.active.symbol).some((l) => l.kind === 'ord' && !l.role), null, 8000);
  check(ok4 && (await sent(p, 2108)) === 1, tag + ': cancel -> one CancelOrder, the STP line is gone', await linesNow(p, s));
  await sleep(600);
  check(!(await chips(p)).some((c) => /STP/.test(c.a)), tag + ': STP chip removed from the chart');
  D = await dockRows(p, 'ord');
  check(!D.some((r) => r[2] === 'Stop'), tag + ': dock Open orders: stop row gone', D);
  // refused order -> sending line removed
  await opWait(p, () => window.__stkLive.blockReason === '', null, 10000); await sleep(400);
  await p.evaluate(() => { window.__ctM.reject = 'NOT_ENOUGH_MONEY'; });
  await p.evaluate((lim) => window.__stkPaper.live.placeTicket(window.STRYKER_VELA.active.symbol, { side: 'buy', type: 'limit', qty: 0.01, price: lim }, 'panel'), r2(last * 0.992));
  await sleep(800);
  check(!(await linesNow(p, s)).some((l) => l.pending || (l.kind === 'ord' && !l.role)), tag + ': refused order -> no line left', await linesNow(p, s));
  await p.evaluate(() => { window.__ctM.reject = ''; });
  await p.evaluate(() => { if (window.__stkPosOrders.open) window.__stkPosOrders.toggle(false); });
  // a working NAS100 order + the NQ1! chart: no line (other prices) but a note with a button to the NAS100 chart
  await opWait(p, () => window.__stkLive.blockReason === '', null, 10000); await sleep(400);
  await p.evaluate((lim) => window.__stkPaper.live.placeTicket(window.STRYKER_VELA.active.symbol, { side: 'buy', type: 'limit', qty: 0.01, price: lim }, 'panel'), lim);
  await opWait(p, () => window.__stkLive.state.data.orders.length === 1, null, 8000);
  await setSym(p, 'futures:NQ1!');
  const nq = await linesNow(p, 'futures:NQ1!');
  check(!nq.length, tag + ': NQ1! chart draws no NAS100 lines (different prices)', nq);
  const nt = await opWait(p, () => { const n = document.querySelector('.stklv-onote'); return n && n.offsetWidth > 0; }, null, 6000);
  const note = await p.evaluate(() => { const n = document.querySelector('.stklv-onote'); if (!n) return null; const R = n.getBoundingClientRect(), t = n.querySelector('span').getBoundingClientRect(), bt = n.querySelector('button').getBoundingClientRect(); return { text: n.textContent, padL: t.left - R.left, padR: R.right - bt.right, padT: bt.top - R.top, padB: R.bottom - bt.bottom, dc: Math.abs((t.top + t.bottom) / 2 - (bt.top + bt.bottom) / 2), inView: R.left >= 0 && R.right <= innerWidth, clip: [...n.querySelectorAll('*')].some((e) => e.scrollWidth > e.clientWidth + 1) }; });
  check(nt && note && /Your NAS100 (order|orders|position|position and orders?) (is|are) on cTrader prices/.test(note.text) && /Open NAS100 chart/.test(note.text), tag + ': NQ1! chart shows the note "Your NAS100 … on cTrader prices · Open NAS100 chart"', note);
  check(note && Math.abs(note.padL - 12) <= 1 && (mobile || Math.abs(note.padR - note.padT) <= 1) && Math.abs(note.padT - note.padB) <= 1 && note.dc <= 1 && note.inView && !note.clip, tag + ': note aligned (even padding, one centre, in view, nothing clipped)', note);
  await sleep(300);
  await hidePanel(); await sleep(250); await p.screenshot({ path: OUT + '/note-nq-' + tag + '.png' });
  await p.evaluate(() => document.querySelector('.stklv-onote button').click());
  const back = await opWait(p, () => /^byo:CT:NAS100$/i.test(window.STRYKER_VELA.active.symbol), null, 6000);
  check(back, tag + ': the note button opens the NAS100 · cTrader chart');
  await opWait(p, () => window.__stkPaper.live.lines(window.STRYKER_VELA.active.symbol).some((l) => l.kind === 'ord' && !l.role), null, 8000);
  check((await linesNow(p, 'byo:CT:NAS100')).some((l) => l.kind === 'ord' && !l.role), tag + ': back on NAS100 the limit line is there again');
  check(await opWait(p, () => !document.querySelector('.stklv-onote') || document.querySelector('.stklv-onote').offsetWidth === 0, null, 4000), tag + ': no note on the NAS100 chart itself');
  check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), tag + ': no horizontal scroll');
  check(await p.evaluate(() => !window.__ctM.sent.some((m) => m.payloadType === 2106 && m.payload.orderType === 1)), tag + ': no market order was ever sent by this test');
  check(!errors.length, tag + ': no page errors', errors);
  await ctx.close();
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile, theme] of [[1440, 900, false, 'dark'], [1440, 900, false, 'light'], [390, 844, true, 'dark'], [412, 915, true, 'light']]) {
      if (process.env.ONE && process.env.ONE !== w + '-' + theme) continue;
      await run(b, w, h, mobile, theme);
    }
  } catch (e) { fail++; console.log('FAIL crashed ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
