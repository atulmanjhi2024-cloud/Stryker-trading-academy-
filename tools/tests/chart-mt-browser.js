// MetaTrader 5 account (AUTO-MTHELP, Owner 21 Nov) in ZoroCharts: Trade menu row, order panel symbol picker (chart NQ -> broker
// NDX100), lots stepper (min / step from the account), market-only from a futures chart, payload, remembered mapping, alignment.
// EVERY /connect/finatic/* call is answered by the local mock below (Sample data): nothing leaves 127.0.0.1, no real order is sent.
//   node tools/tests/chart-dev-server.mjs 8031 &   CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-mt-browser.js <shotsDir>
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp/chartmt';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 700) : '')); };
const ACC = '123e4567-e89b-12d3-a456-426614174000', US = '0aaa1111-2222-3333-4444-555566667777';

async function run(b, w, h, mobile, theme) {
  const tag = w + '-' + theme;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(({ t, US }) => {
    window.__stkLiveTest = { isAdmin: () => true, last: () => 28750, fastRetry: true };
    window.__stkOpTest = { q: { bid: 28749.75, ask: 28750 }, quote() { return this.q; } };
    window.__toasts = []; const keep = () => (t, m) => { window.__toasts.push(String(m)); return Promise.resolve(); };
    Object.defineProperty(window, 'showToast', { configurable: true, get: () => keep(), set: () => {} });
    try {
      localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1');
      localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); localStorage.setItem('stryker_broker_sync_user_u1', US);
    } catch (e) {}
  }, { t: theme, US });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route('**/api/chart/bars/**', (r) => {
    const u = new URL(r.request().url()), tf = Number(u.searchParams.get('tf') || 1), P = 8 * 3600, now = Math.floor(Date.now() / 1000);
    const page = u.searchParams.has('page') ? Number(u.searchParams.get('page')) : Math.floor(now / P);
    if (!/NQ/.test(u.pathname) || tf !== 1 || page < Math.floor(now / P) - 12) return r.fulfill({ json: { bars: [] } });
    const bars = []; for (let t = page * P; t < (page + 1) * P && t <= now; t += 60) bars.push([t, 28749.5, 28751.5, 28748.5, 28750, 100]);
    return r.fulfill({ json: { s: 'NQ', tf: '1', page, bars, rt: true } });
  });
  // Sample data: one MT5 prop account; the place schema has no symbol list (so the member picks) and a 0.01 lot step
  const M = { calls: [], positions: [], orders: [], n: 0 };
  const j = (o, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(o) });
  await ctx.route('**/connect/finatic/**', async (r) => {
    const u = new URL(r.request().url()); let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    M.calls.push({ path: u.pathname, body });
    if (u.pathname.endsWith('/session')) return r.fulfill(j({ configured: true }));
    if (u.pathname.endsWith('/data')) {
      if (body.op === 'accounts') return r.fulfill(j({ userId: US, data: [{ accountId: ACC, accountName: 'SAMPLE 5551234', accountNumber: '5551234', brokerName: 'MetaTrader 5', brokerId: 'metatrader_5', currency: 'USD' }] }));
      if (body.op === 'live') return r.fulfill(j({ data: { positions: M.positions, orders: M.orders } }));
      if (body.op === 'balances') return r.fulfill(j({ data: [{ currencyCode: 'USD', netLiquidationValue: '5000.00', lastUpdated: new Date().toISOString() }] }));
      return r.fulfill(j({ data: [] }));
    }
    if (u.pathname.endsWith('/order')) {
      if (body.op === 'env') return r.fulfill(j({ env: 'live', enabled: true }));
      if (body.op === 'schema') return r.fulfill(j({ data: { fields: { symbol: {}, orderQty: {} }, supportedOrderTypesByAssetClass: { cfd: ['market', 'limit', 'stop'], forex: ['market', 'limit', 'stop'] }, volume_min: 0.01, volume_step: 0.01 }, env: 'live' }));
      if (body.op === 'bracket') return r.fulfill(j({ ok: true, group: null, did: 'none' }));
      M.n++;
      if (body.op === 'place') { M.positions = [{ symbol: body.symbol, quantity: (body.side === 'buy' ? 1 : -1) * body.qty, averageBuyPrice: 20500.5, unrealizedPnl: 0, status: 'OPEN' }]; return r.fulfill(j({ ok: true, accepted: true, orderId: 'mt' + M.n, status: 'FILLED' })); }
      return r.fulfill(j({ error: 'Not allowed in this test' }, 400));
    }
    return r.fulfill(j({ error: 'Not allowed' }, 400));
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|Failed to load resource|Ping received|Unexpected response code|WebSocket/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('dialog', (d) => d.accept('US100.cash'));   // "Other…" prompt
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkPaper, null, { timeout: 60000 });
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1'); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.market.symbol === 'futures:NQ1!') break; } });
  await p.waitForFunction(() => window.__stkLive && window.__stkLive.pick && window.__stkLive.state.accounts.length, null, { timeout: 20000 });
  const wait = (fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms || 10000 }).then(() => true, () => false);
  const writes = () => M.calls.filter((c) => c.path.endsWith('/order') && ['place', 'cancel', 'modify', 'flatten'].includes(c.body.op)).map((c) => c.body);

  // ---- Trade menu: the MT5 account row (initial tile, no logo image)
  await p.evaluate(() => window.__stkPaper.openTradeMenu());
  await p.waitForSelector('#stkc-trade-pop:not([hidden]) .stktm-pick', { timeout: 5000 });
  const row = await p.evaluate((id) => { const r = document.querySelector('#stkc-trade-pop [data-a=live][data-id="' + id + '"]'); const c = r && (r.closest('.stktm-row') || r); return c ? { t: c.innerText.replace(/\s+/g, ' '), img: !!c.querySelector('img') } : null; }, ACC);
  check(row && /MetaTrader 5/.test(row.t) && !row.img, tag + ': Trade menu lists the MT5 account, broker "MetaTrader 5", no logo image', row);
  await p.screenshot({ path: OUT + '/mt-' + tag + '-1-menu.png' });
  await p.evaluate((id) => document.querySelector('#stkc-trade-pop [data-a=live][data-id="' + id + '"]').click(), ACC);
  await wait(() => window.__stkLive.state.acct && window.__stkLive.state.acct.mt === 'MT5' && window.__stkLive.state.lastOkStart > 0 && window.__stkLive.state.placeSchema);
  check(await p.evaluate(() => window.__stkLive.state.acct.mt) === 'MT5', tag + ': picked account is recognised as MT5');
  await p.evaluate(() => { const m = document.getElementById('stkc-trade-pop'); if (m) m.hidden = true; });
  await p.evaluate(() => window.__stkPaper.orderPanel && window.__stkPaper.orderPanel());
  await wait(() => { const o = document.getElementById('stkop'); return o && !o.hidden && o.getBoundingClientRect().height > 100; });
  await p.evaluate(() => { const t = document.querySelector('#stkop .stkop-tabs [data-tab=scalp]'); if (t) t.click(); });
  // ---- symbol picker: shown, nothing picked yet (no symbol list) -> orders blocked with the reason
  check(await wait(() => { const m = document.querySelector('#stkop [data-k=mtsym]'); return m && !m.hidden && m.querySelector('select'); }), tag + ': order panel shows the MT5 symbol picker on the NQ chart');
  const pk = await p.evaluate(() => { const s = document.querySelector('#stkop [data-k=mtsym] select'); return { opts: [...s.options].map((o) => o.value), v: s.value, block: window.__stkLive.blockReason, mx: document.querySelector('#stkop [data-k=mtsym]').hidden, inst: (document.querySelector('#stkop [data-k=inst]') || {}).hidden }; });
  check(pk.v === '' && pk.opts.slice(1, 5).join() === 'NDX100,US100,NAS100,USTEC' && pk.opts.at(-1) === '__other', tag + ': picker offers NDX100 / US100 / NAS100 / USTEC / Other…, nothing chosen', pk);
  check(/Pick the MT5 symbol for Nasdaq 100/.test(pk.block), tag + ': orders blocked until a symbol is picked', pk.block);
  check(pk.inst !== false, tag + ': the mini / micro switch is not shown for MT', pk);
  await p.screenshot({ path: OUT + '/mt-' + tag + '-2-pick.png' });
  // pick NDX100
  await p.selectOption('#stkop [data-k=mtsym] select', 'NDX100');
  check(await wait(() => window.__stkLive.mtFor('futures:NQ1!').sym === 'NDX100'), tag + ': NDX100 picked for the Nasdaq 100');
  const saved = await p.evaluate(() => Object.entries(localStorage).filter(([k]) => /^stryker_mt_map_/.test(k)).map(([, v]) => v).join());
  check(/"NDX":"NDX100"/.test(saved), tag + ': mapping remembered per account (localStorage)', saved);
  check(await p.evaluate(() => window.__stkLive.mtFor('MNQ1!').sym === 'NDX100'), tag + ': MNQ chart shares the Nasdaq 100 mapping');
  // ---- lots stepper: 0.01 min, 0.01 step, 2 max
  await wait(() => window.__stkLive.blockReason === '' && !window.__stkLive.state.busy);
  const q0 = await p.evaluate(() => ({ v: document.querySelector('#stkop .stkop-scalp [data-f=qty]').value, unit: document.querySelector('#stkop .stkop-scalp .stkop-unit').textContent }));
  check(q0.unit === 'lots' && q0.v === '0.01', tag + ': size box is in lots and starts at the smallest lot (0.01)', q0);
  await p.fill('#stkop .stkop-scalp [data-f=qty]', '0.237'); await p.press('#stkop .stkop-scalp [data-f=qty]', 'Tab');
  let qv = await p.evaluate(() => document.querySelector('#stkop .stkop-scalp [data-f=qty]').value);
  check(qv === '0.23', tag + ': 0.237 lots rounds down to the 0.01 step: 0.23', qv);
  await p.click('#stkop .stkop-scalp [data-q="1"]');
  qv = await p.evaluate(() => document.querySelector('#stkop .stkop-scalp [data-f=qty]').value);
  check(qv === '0.24', tag + ': + steps by 0.01 lot', qv);
  await p.fill('#stkop .stkop-scalp [data-f=qty]', '9'); await p.press('#stkop .stkop-scalp [data-f=qty]', 'Tab');
  qv = await p.evaluate(() => ({ v: document.querySelector('#stkop .stkop-scalp [data-f=qty]').value, plus: document.querySelector('#stkop .stkop-scalp [data-q="1"]').disabled }));
  check(!qv.plus && qv.v === '9', tag + ': no TradeZoro lot cap (+ stays enabled)', qv);
  await p.fill('#stkop .stkop-scalp [data-f=qty]', '0.1'); await p.press('#stkop .stkop-scalp [data-f=qty]', 'Tab');
  // Join Bid / Ask = limits at futures prices: disabled on a futures chart
  const jn = await p.evaluate(() => [...document.querySelectorAll('#stkop .stkop-join')].map((b) => ({ d: b.disabled, t: b.title })));
  check(jn.length === 2 && jn.every((x) => x.d && /only market orders/.test(x.t)), tag + ': Join Bid / Ask disabled (futures prices are not the CFD price)', jn);
  // alignment of the header row with the picker
  const al = await p.evaluate(() => {
    const row = document.querySelector('#stkop [data-k=mtsym]').closest('.stkop-il'), r = (e) => e.getBoundingClientRect();
    const items = [...row.children].filter((e) => !e.hidden && r(e).width > 0).map((e) => ({ c: e.className.split(' ')[0], cy: Math.round((r(e).top + r(e).height / 2) * 10) / 10, l: Math.round(r(e).left), rt: Math.round(r(e).right) }));
    const sel = document.querySelector('#stkop [data-k=mtsym] select'), cs = getComputedStyle(sel), svg = document.querySelector('#stkop [data-k=mtsym] svg');
    const box = r(document.querySelector('#stkop [data-k=mtsym]')), sv = r(svg);
    const panel = r(document.getElementById('stkop'));
    return { items, spread: Math.max(...items.map((i) => i.cy)) - Math.min(...items.map((i) => i.cy)), clip: sel.scrollWidth > sel.clientWidth + 1, inPanel: box.right <= panel.right + 0.5, chevCy: Math.round((sv.top + sv.height / 2) - (box.top + box.height / 2)), padL: cs.paddingLeft, h: Math.round(box.height), tab: cs.fontVariantNumeric, hscroll: document.documentElement.scrollWidth > innerWidth };
  });
  check(al.spread <= 1 && !al.clip && al.inPanel && Math.abs(al.chevCy) <= 1 && !al.hscroll, tag + ': header row: one vertical centre (<=1 px), picker inside the panel, chevron centred, nothing clipped, no horizontal scroll', al);
  console.log('ALIGN ' + tag + ' ' + JSON.stringify(al));
  await p.screenshot({ path: OUT + '/mt-' + tag + '-3-picked.png' });
  { const op = await p.$('#stkop'); if (op) await op.screenshot({ path: OUT + '/crop-mt-' + tag + '-panel.png' }); }
  // ---- Buy 0.1 lot market -> payload
  await p.click('#stkop .stkop-scalp [data-a=buy]');
  await wait(() => true); for (let i = 0; i < 60 && !writes().length; i++) await sleep(100);
  const W = writes();
  check(W.length === 1 && W[0].op === 'place' && W[0].venue === 'mt' && W[0].symbol === 'NDX100' && W[0].qty === 0.1 && W[0].type === 'market' && W[0].side === 'buy' && W[0].assetType === 'cfd' && !W[0].bracket && /^[A-Za-z0-9-]{16,64}$/.test(W[0].idemKey || ''), tag + ': Buy = market BUY 0.1 lot NDX100 (venue mt, cfd, idemKey, no bracket)', W);
  check(await wait(() => window.__stkLive.info('futures:NQ1!').pos.qty === 0.1, null, 6000), tag + ': position read back on NDX100: 0.1 lot');
  check(await p.evaluate(() => document.querySelectorAll('.stkpt-chip[data-live]').length) === 0, tag + ': no order / position lines on the futures chart (prices differ)');
  // ---- Other…: typed symbol (prompt answered with US100.cash)
  await p.selectOption('#stkop [data-k=mtsym] select', '__other');
  check(await wait(() => window.__stkLive.mtFor('futures:NQ1!').sym === 'US100.cash'), tag + ': Other… takes the typed broker symbol (case kept): US100.cash');
  // ---- a chart with no MT symbol (AAPL): panel says so
  const no = await p.evaluate(() => window.__stkLive.mtFor('NASDAQ:AAPL'));
  check(no === null, tag + ': a stock chart has no MetaTrader mapping', no);
  check(!(await p.evaluate(() => /finatic/i.test(document.body.innerText))), tag + ': no vendor name on screen');
  check(errors.length === 0, tag + ': no console errors ' + errors.slice(0, 2).join(' | '));
  await ctx.close();
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    const only = process.env.ONLY || '';
    for (const [w, h, mobile, theme] of [[1440, 900, false, 'dark'], [1440, 900, false, 'light'], [412, 915, true, 'dark'], [390, 844, true, 'dark'], [390, 844, true, 'light']]) if (!only || only === w + '-' + theme) await run(b, w, h, mobile, theme);
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
