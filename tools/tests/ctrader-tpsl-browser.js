// AUTO-TPSL (Owner bugs 25 Nov, cTrader EURUSD 0.02 lots long): "Open orders says No open orders" + "cant set tp and sl".
// Admin, mocked cTrader socket only (tools/tests/ctrader-mock.mjs: the real relay rules talk to a fake cTrader inside the page).
// No real order or amendment can be sent; every other host is aborted. Sample data only.
//   node tools/tests/chart-dev-server.mjs 8031 &   CHART_BASE=http://127.0.0.1:8031 node tools/tests/ctrader-tpsl-browser.js <shotsDir>
// Checks on the broker's own EURUSD chart (byo:CT:EURUSD):
//   reconcile (2124) with 1 EURUSD long + its stop loss + 1 limit -> Open orders lists the limit (SL / TP / time) and the protection order;
//   an execution event adds a row live and removes it live; the position label shows 5 digits (no "@ 0.91");
//   TP handle on the position chip -> drag -> one 2110 frame with the dragged price and the stop loss kept; a TP on the wrong side ->
//   nothing sent + clear text; dock TP / SL cells with the inline editor (wrong side -> inline error, nothing sent); x on the TP line ->
//   2110 without takeProfit. Alignment: chip + handles share one centre, handles padded evenly, no horizontal scroll at 390.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp/tpsl';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 900) : '')); };
const US = '0aaa1111-2222-3333-4444-555566667777';

async function open(b, { w, h, mobile, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(({ t, US }) => {
    window.__stkLiveTest = { isAdmin: () => true, isBeta: () => false, last: () => 28750, fastRetry: true,
      ctCreds: { access: 'ACCESSTOKENsample1', refresh: 'REFRESHsample1', exp: Date.now() + 30 * 864e5, accountId: 77, isLive: false, login: 5551234, kind: 'trade' },
      ctDeps: { idToken: async () => 'IDT', save: async () => {} } };
    window.__toasts = []; const keep = () => (t, m) => { window.__toasts.push(String(m)); return Promise.resolve(); };
    Object.defineProperty(window, 'showToast', { configurable: true, get: () => keep(), set: () => {} });
    try {
      localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1');
      localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); localStorage.setItem('stryker_broker_sync_user_u1', US);
    } catch (e) {}
  }, { t: theme, US });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route('**/api/chart/bars/**', (r) => r.fulfill({ json: { bars: [] } }));
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
  // Sample data: 1 EURUSD long 0.02 lots (volume 200000, lotSize 10000000) with a stop loss, its SL protection order (type 4), 1 buy limit
  await p.evaluate(async () => {
    const m = await import('/tools/tests/ctrader-mock.mjs'); const M = m.mockState(); window.__ctM = M; window.__stkLiveTest.ctDeps.WS = m.makeWS(M);
    const t0 = Date.now() - 3600e3;
    M.positions.push({ positionId: 5001, positionStatus: 1, price: 0.90526, stopLoss: 0.89, tradeData: { symbolId: 1, volume: 200000, tradeSide: 1, openTimestamp: t0 } });
    M.orders.push({ orderId: 7001, orderStatus: 1, orderType: 4, stopPrice: 0.89, positionId: 5001, tradeData: { symbolId: 1, volume: 200000, tradeSide: 2, openTimestamp: t0 } });
    M.orders.push({ orderId: 7002, orderStatus: 1, orderType: 2, limitPrice: 0.885, stopLoss: 0.875, takeProfit: 0.905, tradeData: { symbolId: 1, volume: 100000, tradeSide: 1, openTimestamp: t0 + 60e3 } });
  });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkPaper, null, { timeout: 60000 });
  await p.waitForFunction(() => window.__stkLive && window.__stkLive.state.accounts.some((a) => a.ct), null, { timeout: 20000 });
  return { ctx, p, errors };
}
const opWait = (p, fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms || 10000 }).then(() => true, () => false);
const setSym = (p, s) => p.evaluate(async (s) => { const ws = window.STRYKER_VELA; ws.active.setSymbol(s); for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 250)); try { const R = window.__stkAxisTags.rendererOf(window.__stkAxisTags.cellsOf()[0]); if (ws.active.symbol === s && R.scene.bars.length > 20) break; } catch (e) {} } return ws.active.symbol; }, s);
const chips = (p) => p.evaluate(() => [...document.querySelectorAll('.stkpt-chip')].filter((c) => c.offsetWidth > 0 && c.style.visibility !== 'hidden').map((c) => { const r = c.getBoundingClientRect(); return { id: c.dataset.id, kind: c.dataset.kind, a: (c.querySelector('.stkpt-chip-a') || {}).textContent || '', b: (c.querySelector('.stkpt-chip-b') || {}).textContent || '', cy: r.top + r.height / 2 }; }));
const dockRows = (p, tab) => p.evaluate((tab) => { for (let i = 0; i < 3; i++) { const x = document.querySelector('#stkop:not([hidden]) [data-a=close]'); if (x) x.click(); } if (!window.__stkPosOrders.open) window.__stkPosOrders.toggle(true); const b = document.querySelector('#stkpo-dock [role=tab][data-t=' + tab + ']'); if (b && !b.classList.contains('on')) b.click(); return [...document.querySelectorAll('#stkpo-dock .stkpo-t tbody tr')].map((r) => [...r.cells].map((c) => c.textContent.trim())); }, tab);
const sentOf = (p, ty) => p.evaluate((ty) => window.__ctM.sent.filter((m) => m.payloadType === ty).map((m) => m.payload), ty);
const ready = (p) => opWait(p, () => window.__stkLive.blockReason === '', null, 10000);
const hidePanel = (p) => p.evaluate(() => { for (let i = 0; i < 3; i++) { const x = document.querySelector('#stkop:not([hidden]) [data-a=close]'); if (x) x.click(); } });

// drag the TP / SL handle of the position chip (or a line chip) to price px. Returns the screen points used.
async function dragTo(p, sel, px, { touch } = {}) {
  const pt = await p.evaluate(({ sel, px }) => {
    const el = document.querySelector(sel); if (!el) return null;
    const chip = el.closest('.stkpt-chip'); chip.classList.add('show-h');
    const r = el.getBoundingClientRect();
    const cell = window.__stkAxisTags.cellsOf()[0], R = window.__stkAxisTags.rendererOf(cell), cv = cell.querySelector('canvas').getBoundingClientRect();
    const y = R.priceToY ? R.priceToY(px) : null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, ty: y != null ? cv.top + y : null };
  }, { sel, px });
  return pt;
}

async function run(b, w, h, mobile, theme) {
  const tag = w + '-' + theme;
  const { ctx, p, errors } = await open(b, { w, h, mobile, theme });
  await p.evaluate(() => window.__stkLive.pick('ct-77'));
  const s = await setSym(p, 'byo:CT:EURUSD');
  check(await opWait(p, () => window.__stkLive.state.lastOkStart > 0 && window.__stkLive.blockReason === '', null, 15000), tag + ': cTrader account picked and read', await p.evaluate(() => window.__stkLive.blockReason));
  check(/^byo:CT:EURUSD$/i.test(s), tag + ': chart is EURUSD · cTrader', s);
  check((await sentOf(p, 2124)).length >= 1, tag + ': ReconcileReq (2124) sent on connect');
  await opWait(p, () => { const i = window.__stkLive.info(window.STRYKER_VELA.active.symbol); return i && i.code === 'EURUSD' && Number.isFinite(i.last) && i.tick === 0.00001; }, null, 10000);
  const inf = await p.evaluate(() => { const i = window.__stkLive.info(window.STRYKER_VELA.active.symbol); return i && { code: i.code, same: i.map.same, last: i.last, tick: i.tick }; });
  check(inf && inf.code === 'EURUSD' && inf.same && inf.tick === 0.00001, tag + ': EURUSD on broker prices, tick 0.00001 (digits 5)', inf);
  const bid = inf ? inf.last : 0.9;

  // ---- BUG 1: Open orders = the limit + the position's stop loss protection
  await sleep(600);
  let D = await dockRows(p, 'ord');
  const lim = D.find((r) => /Limit/.test(r[2])), slr = D.find((r) => /Stop loss/.test(r[2]));
  check(D.length === 2 && lim && slr, tag + ': Open orders lists the limit and the position’s stop loss (not "No open orders")', D);
  check(lim && lim[0] === 'EURUSD' && lim[1] === 'Buy' && lim[3] === '0.01' && lim[4] === '0.88500' && lim[5] === '0.87500' && lim[6] === '0.90500' && lim[7] !== '—', tag + ': limit row: symbol, side, lots, price, SL, TP, time in 5 digits', lim);
  check(slr && slr[1] === 'Sell' && slr[3] === '0.02' && slr[4] === '0.89000' && /Protects position 5001/.test(slr[8]), tag + ': stop loss row: closing side, position size, 0.89000', slr);
  const ordHead = await p.evaluate(() => [...document.querySelectorAll('#stkpo-dock .stkpo-t thead th')].map((t) => t.textContent));
  check(['Symbol', 'Side', 'Type', 'Qty', 'Price', 'SL', 'TP', 'Time', 'Status'].every((x) => ordHead.includes(x)), tag + ': Open orders columns', ordHead);
  // the numbers right-aligned + tabular
  const al = await p.evaluate(() => { const c = document.querySelector('#stkpo-dock .stkpo-t tbody tr td.n'); const cs = c && getComputedStyle(c); return cs && { ta: cs.textAlign, fv: cs.fontVariantNumeric }; });
  check(al && /right|end/.test(al.ta) && /tabular/.test(al.fv), tag + ': numbers right-aligned, tabular digits', al);
  // exec event adds a row live (a new stop order accepted at cTrader), then removes it (cancelled)
  await p.evaluate(() => { const M = window.__ctM, o = { orderId: 7003, orderStatus: 1, orderType: 3, stopPrice: 0.92, tradeData: { symbolId: 1, volume: 100000, tradeSide: 1, openTimestamp: Date.now() } }; M.orders.push(o);
    (M.trade || M.socket).relay.onUp(JSON.stringify({ payloadType: 2126, payload: { ctidTraderAccountId: 77, executionType: 2, order: o } })); });
  check(await opWait(p, () => [...document.querySelectorAll('#stkpo-dock .stkpo-t tbody tr')].some((r) => /0\.92000/.test(r.textContent) && /Stop/.test(r.textContent)), null, 6000), tag + ': ORDER_ACCEPTED event -> new stop row appears live');
  await p.evaluate(() => { window.__evs = []; const L0 = window.__stkCt && window.__stkCt.link; if (L0) { const f = L0.onEvent; L0.onEvent = (k, m) => { window.__evs.push(k); return f(k, m); }; } });
  await p.evaluate(() => { const M = window.__ctM, o = M.orders.find((x) => x.orderId === 7003); M.orders = M.orders.filter((x) => x !== o);
    (M.trade || M.socket).relay.onUp(JSON.stringify({ payloadType: 2126, payload: { ctidTraderAccountId: 77, executionType: 5, order: { ...o, orderStatus: 5 } } })); });
  check(await opWait(p, () => ![...document.querySelectorAll('#stkpo-dock .stkpo-t tbody tr')].some((r) => /0\.92000/.test(r.textContent)), null, 8000), tag + ': ORDER_CANCELLED event -> that row disappears live', await p.evaluate(() => ({ rows: [...document.querySelectorAll('#stkpo-dock .stkpo-t tbody tr')].map((r) => r.textContent), ords: window.__stkLive.state.data.orders.map((o) => o.orderId), m: window.__ctM.orders.map((o) => o.orderId), rec: window.__ctM.sent.filter((x) => x.payloadType === 2124).length, reading: window.__stkLive.state.reading, ev: window.__evs })));
  await sleep(300); await p.screenshot({ path: OUT + '/dock-orders-' + tag + '.png' });

  // ---- BUG 2a: 5 digits on the position label and the dock
  await p.evaluate(() => { if (window.__stkPosOrders.open) window.__stkPosOrders.toggle(false); });
  await hidePanel(p);
  await opWait(p, () => [...document.querySelectorAll('.stkpt-chip[data-kind=pos]')].some((c) => c.offsetWidth > 0), null, 8000);
  let C = await chips(p);
  const pc = C.find((c) => c.kind === 'pos');
  check(pc && /^Buy 0\.02 lots$/.test(pc.a) && /^[+−]\d+\.\d{2} USD$/.test(pc.b), tag + ': position chip "Buy 0.02 lots | ±x.xx USD"', C);
  check(await p.evaluate(() => /Entry 0\.90526/.test([...document.querySelectorAll('.stkpt-chip[data-kind=pos]')].find((x) => x.offsetWidth > 0).title)), tag + ': chip tooltip names the entry in 5 digits');
  const slc = C.find((c) => c.id === 'SP5001');
  check(slc && slc.a === '0.89000' && /USD$/.test(slc.b) && await p.evaluate(() => document.querySelector('.stkpt-chip[data-id=SP5001] .stkpt-chip-a').dataset.tag === 'SL'), tag + ': SL chip [SL] 0.89000 | −x.xx USD', C);
  // OWNER ADDITION 2: price-scale tags for the entry (side colour), SL (loss colour) and the working limit (side colour, faded); the
  // ask tag; none over the last-price tag
  // Sample data: the ask (the mock sends no spot events); the bid is the chart's last price
  await p.evaluate(async (b) => { const m = await import('/assets/byo-ctrader.js?v=1293'); m.CTQ.set('CT:EURUSD', { bid: b, ask: Math.round((b + 0.00012) * 1e5) / 1e5, at: Date.now() }); }, bid);
  await opWait(p, () => { const R = window.__stkAxisTags.rendererOf(window.__stkAxisTags.cellsOf()[0]); return window.__stkAxisTags.boxes(R).some((b) => b.kind === 'ask'); }, null, 5000);
  const AX = await p.evaluate(() => { const cell = window.__stkAxisTags.cellsOf()[0], R = window.__stkAxisTags.rendererOf(cell), sc = R.scene, pane = sc.panes.get('price'), co = R.coords;
    const n = sc.bars.length, ly = co.priceToY(sc.bars[n - 1].close, pane.scale, pane.bounds); const tv = window.__stkTradeView.get().col;
    const inV = (px) => { const y = co.priceToY(px, pane.scale, pane.bounds); return y >= pane.bounds.top && y <= pane.bounds.top + pane.bounds.height; };
    return { inSl: inV(0.89), inLim: inV(0.885), boxes: window.__stkAxisTags.boxes(R), last: { t: ly - 8, b: ly - 8 + (sc.showPriceLabel && sc.showCountdown ? 32 : 16), on: !!(sc.showPriceLabel || sc.showCountdown) }, col: tv }; });
  const tagOf = (txt) => AX.boxes.find((b) => b.text === txt);
  const hx = (c) => String(c).toLowerCase();
  const eT = tagOf('0.90526'), sT = tagOf('0.89000'), lT = tagOf('0.88500');
  check(eT && hx(eT.color) === hx(AX.col.buy), tag + ': entry tag 0.90526 on the scale in the buy colour', AX.boxes);
  check(AX.inSl ? sT && hx(sT.color) === hx(AX.col.sl) : !sT, tag + ': SL tag 0.89000 in the SL colour while in view (none when off-screen)', AX);
  check(AX.inLim ? lT && lT.fade > 0 && lT.fade < 1 : !lT, tag + ': working limit tag 0.88500 faded while in view (none when off-screen)', AX);
  check(AX.boxes.some((b) => b.kind === 'ask'), tag + ': ask tag on the scale', AX.boxes);
  check(!AX.last.on || AX.boxes.every((b) => b.kind === 'bid' || /^Ask /.test(b.text) || b.top + b.h <= AX.last.t + 0.5 || b.top >= AX.last.b - 0.5), tag + ': no tag covers the last-price tag (Bid / Ask lines sit on their exact price by design, as in MT5)', AX);

  // ---- BUG 2b: TP handle -> drag -> confirm off -> one 2110 with the dragged price, stop loss kept
  await ready(p);
  const hs = await p.evaluate(() => { const c = [...document.querySelectorAll('.stkpt-chip[data-kind=pos]')].find((x) => x.offsetWidth > 0); c.classList.add('show-h'); const hb = [...c.querySelectorAll('.stkpt-h')].filter((x) => !x.hidden && x.offsetWidth > 0);
    const cr = c.getBoundingClientRect(), a = c.querySelector('.stkpt-chip-a').getBoundingClientRect(), box = c.querySelector('.stkpt-hs').getBoundingClientRect(), g = hb.length > 1 ? hb[1].getBoundingClientRect().left - hb[0].getBoundingClientRect().right : null;
    return { n: hb.map((x) => x.dataset.h), cyChip: cr.top + cr.height / 2, cyA: a.top + a.height / 2, cys: hb.map((x) => { const r = x.getBoundingClientRect(); return r.top + r.height / 2; }), cl: cr.left, pads: hb.map((x) => { const r = x.getBoundingClientRect(), rng = document.createRange(); rng.selectNodeContents(x); const t = rng.getBoundingClientRect(); return { l: t.left - r.left, r: r.right - t.right, t: t.top - r.top, b: r.bottom - t.bottom }; }), boxR: box.right, chipR: cr.right, gapToChip: a.left - box.right, inView: cr.right <= innerWidth && box.left >= 0, h: hb.map((x) => x.getBoundingClientRect().height), ch: cr.height }; });
  check(hs.n.length === 1 && hs.n[0] === 'tp', tag + ': hover / tap shows the TP handle (SL already set: drag its line instead)', hs);
  check(hs.cys.every((y) => Math.abs(y - hs.cyChip) <= 1) && Math.abs(hs.cyA - hs.cyChip) <= 1, tag + ': handles and label share one vertical centre', hs);
  check(hs.pads.every((q) => Math.abs(q.l - q.r) <= 1 && Math.abs(q.t - q.b) <= 1.5 && q.t >= 0), tag + ': handle text centred (even padding)', hs.pads);
  check(hs.inView, tag + ': position chip with handles fits in view', hs);
  check(Math.abs(hs.gapToChip - 4) <= 1 && hs.h.every((x) => Math.abs(x - hs.ch) <= 1), tag + ': TP chip sits 4 px left of the position pill, same height', hs);
  await sleep(200); await p.screenshot({ path: OUT + '/handles-' + tag + '.png' });
  const tpPx = Math.round((bid + 0.0025) * 1e5) / 1e5;
  // screen y of a price = the position chip's centre + the pane's price-to-y distance from the entry
  const yOf = (px) => p.evaluate((px) => { const R = window.STRYKER_VELA.chart.renderer.renderer, pane = R.scene.panes.get('price'), co = R.coords;
    const c = [...document.querySelectorAll('.stkpt-chip[data-kind=pos]')].find((x) => x.offsetWidth > 0).getBoundingClientRect();
    const avg = window.__stkLive.state.data.positions[0].averagePrice;
    return c.top + c.height / 2 + co.priceToY(px, pane.scale, pane.bounds) - co.priceToY(avg, pane.scale, pane.bounds); }, px);
  const ty = await yOf(tpPx);
  const hb = await p.evaluate(() => { const b = [...document.querySelectorAll('.stkpt-chip[data-kind=pos] .stkpt-h[data-h=tp]')].find((x) => x.offsetWidth > 0); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const S0 = (await sentOf(p, 2110)).length;
  await p.mouse.move(hb.x, hb.y); await p.mouse.down();
  for (let i = 1; i <= 8; i++) { await p.mouse.move(hb.x, hb.y + (ty - hb.y) * i / 8); await sleep(30); }
  await sleep(250);
  const mid = await chips(p);
  const nc = mid.find((c) => c.id === 'new');
  check(nc && /^\d\.\d{5}$/.test(nc.a.trim()) && /USD$/.test(nc.b), tag + ': dragging shows a TP chip with its 5-digit price and the P&L there', mid);
  const dragPx = await p.evaluate(() => { const l = (window.__stkPaper.live.lines(window.STRYKER_VELA.active.symbol) || []).find((x) => x.id === 'new'); return l && l.price; });
  await p.screenshot({ path: OUT + '/drag-tp-' + tag + '.png' });
  await p.mouse.up();
  await p.mouse.move(200, 500); await p.keyboard.press('Escape').catch(() => {});
  const got = await opWait(p, (n) => window.__ctM.sent.filter((m) => m.payloadType === 2110).length > n, S0, 8000);
  let A = await sentOf(p, 2110);
  const f = A[A.length - 1] || {};
  check(got && A.length === S0 + 1 && f.positionId === 5001, tag + ': release -> one AmendPositionSLTP (2110) frame for position 5001', A);
  const dragged = await p.evaluate(() => window.__stkLive.state.data.positions.find((x) => String(x.positionId) === '5001'));
  check(f.takeProfit > bid && Math.abs(f.takeProfit - Math.round(f.takeProfit * 1e5) / 1e5) < 1e-9 && f.stopLoss === 0.89, tag + ': 2110 carries the dragged TP (5 digits, above the price) and keeps the stop loss 0.89000', { f, dragPx, bid });
  check(await opWait(p, () => window.__toasts.some((t) => /^Take profit set at \d\.\d{5}\.$/.test(t)), null, 4000), tag + ': toast "Take profit set at 0.9xxxx."', await p.evaluate(() => window.__toasts.slice(-3)));
  check(await opWait(p, () => window.__stkPaper.live.lines(window.STRYKER_VELA.active.symbol).some((l) => l.id === 'TP5001'), null, 6000), tag + ': green TP line drawn after cTrader’s answer', dragged);
  await sleep(700);
  C = await chips(p);
  const tpc = C.find((c) => c.id === 'TP5001');
  check(tpc && /^\d\.\d{5}$/.test(tpc.a) && /^\+\d+\.\d{2} USD$/.test(tpc.b), tag + ': TP chip shows [TP] price | +x.xx USD', C);
  const AX2 = await p.evaluate((px) => { const R = window.__stkAxisTags.rendererOf(window.__stkAxisTags.cellsOf()[0]), pane = R.scene.panes.get('price'), y = R.coords.priceToY(px, pane.scale, pane.bounds); return { inV: y >= pane.bounds.top && y <= pane.bounds.top + pane.bounds.height, b: window.__stkAxisTags.boxes(R), col: window.__stkTradeView.get().col }; }, Number(tpc && tpc.a));
  check(AX2.inV ? AX2.b.some((b) => b.text === tpc.a && b.color.toLowerCase() === AX2.col.tp.toLowerCase()) : !AX2.b.some((b) => b.text === tpc.a), tag + ': TP tag on the scale in the TP colour while in view (pinned chip only when off-screen)', AX2);
  await p.screenshot({ path: OUT + '/tp-set-' + tag + '.png' });

  // ---- OWNER STYLE: the confirm card (Trade display "confirm" on): title, sub line, rows, Don't show again, Cancel + Confirm change
  await ready(p);
  await p.evaluate(() => window.__stkTradeView.set('confirm', true));
  const Sx = (await sentOf(p, 2110)).length, tp2 = Math.round((bid + 0.006) * 1e5) / 1e5;
  const prc = p.evaluate((px) => window.__stkLive.setSlTp('5001', 'tp', px, 'test'), tp2);
  const cfOk = await opWait(p, () => !!document.querySelector('#stklv-cf.stklv-card'), null, 4000);
  const cfI = cfOk && await p.evaluate(() => { const el = document.querySelector('#stklv-cf .stklv-cf-box'), B = el.getBoundingClientRect(), cs = getComputedStyle(el), c = (r) => r.top + r.height / 2;
    const h2 = el.querySelector('h2').getBoundingClientRect(), x = el.querySelector('.stklv-x').getBoundingClientRect(), bt = [...el.querySelectorAll('.stklv-cf-btns .stklv-btn')].map((b) => b.getBoundingClientRect());
    const rows = [...el.querySelectorAll('.stklv-cf-rows > div')].map((r) => ({ t: r.querySelector('dt').textContent, v: r.querySelector('dd').textContent, d: Math.abs(c(r.querySelector('dt').getBoundingClientRect()) - c(r.querySelector('dd').getBoundingClientRect())), r: B.right - parseFloat(cs.paddingRight) - r.querySelector('dd').getBoundingClientRect().right }));
    return { title: el.querySelector('h2').textContent, sub: (el.querySelector('.stklv-cf-sub') || {}).textContent, rows, ds: !!el.querySelector('[data-k=ds]'), go: el.querySelector('[data-k=yes]').textContent, headD: Math.abs(c(h2) - c(x)), btnD: Math.abs(c(bt[0]) - c(bt[1])), padL: parseFloat(cs.paddingLeft), padR: parseFloat(cs.paddingRight), clip: el.scrollWidth > el.clientWidth + 1, rad: cs.borderTopLeftRadius }; });
  check(cfOk && cfI.title === 'Change stop loss and take profit' && cfI.sub === 'EURUSD · Buy · 0.02 lots' && cfI.go === 'Confirm change' && cfI.ds, tag + ': confirm card: title, sub line, Confirm change, Don’t show this again', cfI);
  const rv = (t) => (cfI.rows.find((r) => r.t === t) || {}).v || '';
  check(cfI && rv('Entry price') === '0.90526' && rv('Stop loss') === '0.89000' && new RegExp('^\\d\\.\\d{5} → ' + tp2.toFixed(5).replace('.', '\\.') + '$').test(rv('Take profit')) && /Demo/.test(rv('Account')), tag + ': rows Entry / Stop loss / Take profit (old → new) / Account', cfI && cfI.rows);
  check(cfI && cfI.rows.every((r) => r.d <= 1 && Math.abs(r.r) <= 1) && cfI.headD <= 1 && cfI.btnD <= 1 && Math.abs(cfI.padL - cfI.padR) <= 1 && !cfI.clip, tag + ': card aligned (rows label/value one centre, values flush right, even padding)', cfI);
  await sleep(250); await p.screenshot({ path: OUT + '/confirm-card-' + tag + '.png' });
  await p.evaluate(() => { document.querySelector('#stklv-cf [data-k=ds]').click(); document.querySelector('#stklv-cf [data-k=yes]').click(); });
  await prc;
  check(await opWait(p, (n) => window.__ctM.sent.filter((m) => m.payloadType === 2110).length > n, Sx, 6000), tag + ': Confirm change -> one 2110');
  check(await p.evaluate(() => window.__stkTradeView.get().confirm === false), tag + ': Don’t show this again turns the confirm setting off');
  await opWait(p, (v) => { const x = window.__stkLive.state.data.positions.find((q) => String(q.positionId) === '5001'); return x && Math.abs(x.takeProfit - v) < 1e-9; }, tp2, 6000);

  // ---- BUG 2c: wrong side -> nothing sent, clear text (API path = what the drag and the editor call)
  await ready(p);
  const S1 = (await sentOf(p, 2110)).length;
  const bad = await p.evaluate((px) => window.__stkLive.setSlTp('5001', 'tp', px, 'test'), Math.round((bid - 0.003) * 1e5) / 1e5);
  check(bad && /take profit must be above/.test(bad.error || '') && (await sentOf(p, 2110)).length === S1, tag + ': TP below the price on a buy -> refused before sending, clear text', bad);
  const bad2 = await p.evaluate((px) => window.__stkLive.setSlTp('5001', 'sl', px, 'test'), Math.round((bid + 0.003) * 1e5) / 1e5);
  check(bad2 && /stop loss must be below the bid/.test(bad2.error || '') && (await sentOf(p, 2110)).length === S1, tag + ': SL above the bid on a buy -> refused before sending', bad2);
  // the drag on the wrong side: the TP line dragged below the price
  await ready(p);
  const tpChip = await p.evaluate(() => { const c = [...document.querySelectorAll('.stkpt-chip[data-id=TP5001]')].find((x) => x.offsetWidth > 0); if (!c) return null; const r = c.querySelector('.stkpt-chip-a').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const posY = await p.evaluate(() => { const c = [...document.querySelectorAll('.stkpt-chip[data-kind=pos]')].find((x) => x.offsetWidth > 0).getBoundingClientRect(); return c.top + c.height / 2; });
  if (tpChip) {
    await p.mouse.move(tpChip.x, tpChip.y); await p.mouse.down();
    const to = (await yOf(Math.round((bid - 0.004) * 1e5) / 1e5)); for (let i = 1; i <= 8; i++) { await p.mouse.move(tpChip.x, tpChip.y + (to - tpChip.y) * i / 8); await sleep(30); }
    await sleep(200); await p.mouse.up(); await sleep(900);
    check((await sentOf(p, 2110)).length === S1 && await p.evaluate(() => window.__toasts.some((t) => /take profit must be above/.test(t))), tag + ': TP line dragged below the price -> nothing sent, error toast', await p.evaluate(() => window.__toasts.slice(-2)));
  } else check(false, tag + ': TP chip found for the wrong-side drag');

  // ---- dock Positions: TP / SL cells + inline editor (wrong side -> inline error; right -> 2110)
  await ready(p);
  D = await dockRows(p, 'pos');
  const head = await p.evaluate(() => [...document.querySelectorAll('#stkpo-dock .stkpo-t thead th')].map((t) => t.textContent));
  check(head.includes('TP') && head.includes('SL') && D.length === 1 && D[0][3] === '0.90526', tag + ': Positions row has TP and SL cells, Avg price 0.90526', { head, D });
  const rowA = await p.evaluate(() => { const tr = document.querySelector('#stkpo-dock .stkpo-t tbody tr'), c = (r) => r.top + r.height / 2; const sym = tr.cells[0], rng = document.createRange(); rng.selectNodeContents(sym); const base = c(rng.getBoundingClientRect());
    return [...tr.querySelectorAll('[data-lv]')].map((b) => { const rr = document.createRange(); rr.selectNodeContents(b); return Math.abs(c(rr.getBoundingClientRect()) - base); }); });
  check(rowA.length === 2 && rowA.every((d) => d <= 1), tag + ': TP / SL cells share the row’s text centre', rowA);
  await sleep(200); await p.screenshot({ path: OUT + '/dock-positions-before-' + tag + '.png' });
  await p.evaluate(() => document.querySelector('#stkpo-dock [data-lv=sl]').click());
  await opWait(p, () => !!document.querySelector('#stkpo-dock .stkpo-ed input'), null, 3000);
  const edv = await p.evaluate(() => document.querySelector('#stkpo-dock .stkpo-ed input').value);
  check(edv === '0.89000', tag + ': SL editor opens with 0.89000', edv);
  await p.fill('#stkpo-dock .stkpo-ed input', String(Math.round((bid + 0.002) * 1e5) / 1e5));
  await p.keyboard.press('Enter');
  check(await opWait(p, () => { const e = document.querySelector('#stkpo-dock .stkpo-ed-err'); return e && !e.hidden && /stop loss must be below/.test(e.textContent); }, null, 4000) && (await sentOf(p, 2110)).length === S1, tag + ': editor wrong side -> inline error, nothing sent');
  await sleep(200); await p.screenshot({ path: OUT + '/dock-editor-err-' + tag + '.png' });
  const edA = await p.evaluate(() => { const ed = document.querySelector('#stkpo-dock .stkpo-ed'), i = ed.querySelector('input').getBoundingClientRect(), bs = [...ed.querySelectorAll('button')].map((x) => x.getBoundingClientRect()); const c = (r) => r.top + r.height / 2; return { d: Math.max(...bs.map((r) => Math.abs(c(r) - c(i)))), clip: ed.scrollWidth > ed.clientWidth + 1 }; });
  check(edA.d <= 1 && !edA.clip, tag + ': editor input + buttons share one centre', edA);
  const goodSl = Math.round((bid - 0.0015) * 1e5) / 1e5;
  await ready(p);
  await p.fill('#stkpo-dock .stkpo-ed input', String(goodSl));
  await p.keyboard.press('Enter');
  check(await opWait(p, (n) => window.__ctM.sent.filter((m) => m.payloadType === 2110).length > n, S1, 6000), tag + ': editor right side -> one 2110');
  A = await sentOf(p, 2110);
  check(A[A.length - 1].stopLoss === goodSl && A[A.length - 1].takeProfit > 0, tag + ': 2110 carries the new SL and keeps the TP', A[A.length - 1]);
  check(await opWait(p, (v) => [...document.querySelectorAll('#stkpo-dock [data-lv=sl]')].some((b) => b.textContent === v.toFixed(5)), goodSl, 6000), tag + ': dock SL cell shows the new level');
  const AX3 = await p.evaluate((px) => { const R = window.__stkAxisTags.rendererOf(window.__stkAxisTags.cellsOf()[0]), pane = R.scene.panes.get('price'), y = R.coords.priceToY(px, pane.scale, pane.bounds); return { inV: y >= pane.bounds.top && y <= pane.bounds.top + pane.bounds.height, b: window.__stkAxisTags.boxes(R), sl: window.__stkTradeView.get().col.sl }; }, goodSl);
  check(AX3.inV && AX3.b.some((b) => b.text === goodSl.toFixed(5) && b.color.toLowerCase() === AX3.sl.toLowerCase()), tag + ': new SL tag on the scale in the SL colour', AX3);
  await sleep(300); await p.screenshot({ path: OUT + '/dock-positions-' + tag + '.png' });
  // the Open orders tab now lists the SL + TP protection
  D = await dockRows(p, 'ord');
  check(D.some((r) => r[2] === 'Take profit') && D.some((r) => r[2] === 'Stop loss'), tag + ': Open orders lists the position’s TP and SL', D);
  await p.evaluate(() => { if (window.__stkPosOrders.open) window.__stkPosOrders.toggle(false); });

  // ---- x on the TP line -> 2110 without takeProfit (stop loss kept)
  await ready(p); await sleep(300);
  const S2 = (await sentOf(p, 2110)).length;
  await p.evaluate(() => { const x = [...document.querySelectorAll('.stkpt-chip[data-id=TP5001] .stkpt-chip-x')].find((e) => e.offsetWidth > 0); x.click(); });
  check(await opWait(p, (n) => window.__ctM.sent.filter((m) => m.payloadType === 2110).length > n, S2, 6000), tag + ': x on the TP line -> one 2110');
  A = await sentOf(p, 2110);
  check(!('takeProfit' in A[A.length - 1]) && A[A.length - 1].stopLoss === goodSl, tag + ': that 2110 has no takeProfit (removed) and keeps the SL', A[A.length - 1]);
  check(await opWait(p, () => window.__toasts.some((t) => t === 'Take profit removed.'), null, 4000), tag + ': toast "Take profit removed."');
  check(await opWait(p, () => !window.__stkPaper.live.lines(window.STRYKER_VELA.active.symbol).some((l) => l.id === 'TP5001'), null, 6000), tag + ': TP line gone');

  // ---- cTrader refusal -> its reason in the toast
  await ready(p); await sleep(300);
  await p.evaluate(() => { window.__ctM.reject = 'TRADING_BAD_PRICES'; });
  await p.evaluate((px) => window.__stkLive.setSlTp('5001', 'tp', px, 'test'), Math.round((bid + 0.005) * 1e5) / 1e5);
  check(await opWait(p, () => window.__toasts.some((t) => /refused: cTrader refused that price/.test(t)), null, 5000), tag + ': cTrader error code -> clear toast text', await p.evaluate(() => window.__toasts.slice(-2)));
  await p.evaluate(() => { window.__ctM.reject = ''; });

  check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), tag + ': no horizontal scroll');
  check(await p.evaluate(() => !window.__ctM.sent.some((m) => m.payloadType === 2106 || m.payloadType === 2111)), tag + ': no order / close was sent by this test');
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
