// cTrader SLIPPAGE (Owner 25 Nov: "was my NAS100 fill price slippage?"). Admin, mocked cTrader socket only (tools/tests/ctrader-mock.mjs:
// the real relay rules talk to a fake cTrader inside the page). Every other host is aborted; no real order can be sent. Sample data.
//   node tools/tests/chart-dev-server.mjs 8031 &   CHART_BASE=http://127.0.0.1:8031 node tools/tests/ctrader-slippage-browser.js <shotsDir>
// On the broker's own NAS100 chart (byo:CT:NAS100):
//   market SELL with the broker bid at 100.00 that fills at 99.80 -> toast "… filled @ 99.80 (expected 100.00, 0.2 pts slippage)",
//   the order's log row gets exp_px / fill_px / slip_pts (after the order), Trade history shows Expected 100.00 + Slippage 0.2 pts;
//   a fill at the same price -> plain "filled @ 100.00." (no slippage text); a deal not sent from TradeZoro -> Expected / Slippage blank.
// Alignment: toast padding / one row, history row centres, numbers right-aligned tabular, nothing clipped, no horizontal scroll.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp/slippage';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 700) : '')); };
const EXTRA = [{ symbolId: 13, symbolName: 'NAS100', digits: 2, desc: 'Nasdaq 100 Index', lotSize: 100, minVolume: 1, stepVolume: 1 }];   // index CFD: 1 lot = 1 unit (Sample data)
const US = '0aaa1111-2222-3333-4444-555566667777';
const WRITES = [2106, 2108, 2109, 2110, 2111];

async function open(b, { w, h, mobile, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(({ t, US, EX }) => {
    window.__stkLiveTest = { isAdmin: () => true, isBeta: () => false, last: () => 28750, fastRetry: true,
      ctCreds: { access: 'ACCESSTOKENsample1', refresh: 'REFRESHsample1', exp: Date.now() + 30 * 864e5, accountId: 77, isLive: false, login: 5551234, kind: 'trade' },
      ctDeps: { idToken: async () => 'IDT', save: async () => {} } };
    window.__toasts = []; let real = null; const wrap = (t, m) => { window.__toasts.push(String(m)); return real ? real(t, m) : Promise.resolve(); };
    Object.defineProperty(window, 'showToast', { configurable: true, get: () => wrap, set: (f) => { real = f; } });
    window.__stkLiveTest.ctQuote = () => window.__q || null;
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
const hidePanel = (p) => p.evaluate(() => { for (let i = 0; i < 3; i++) { const x = document.querySelector('#stkop:not([hidden]) [data-a=close]'); if (x) x.click(); } });
const lastToast = (p, re) => p.evaluate((re) => window.__toasts.filter((t) => new RegExp(re).test(t)).pop() || '', re);
// the toast on screen: one row, even padding, text inside its box
const toastBox = (p, re) => p.evaluate((re) => {
  const el = [...document.querySelectorAll('body *')].filter((e) => e.children.length <= 3 && new RegExp(re).test(e.textContent || '') && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height < 200)
    .sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)[0];
  if (!el) return null;
  let box = el; while (box.parentElement && getComputedStyle(box).paddingLeft === '0px' && box.parentElement !== document.body) box = box.parentElement;
  const R = box.getBoundingClientRect(), cs = getComputedStyle(box);
  return { text: el.textContent, padL: parseFloat(cs.paddingLeft), padR: parseFloat(cs.paddingRight), padT: parseFloat(cs.paddingTop), padB: parseFloat(cs.paddingBottom), inView: R.left >= 0 && R.right <= innerWidth + 0.5, clip: el.scrollWidth > el.clientWidth + 1, cls: box.className };
}, re);

async function sell(p, tag, bid, fill) {
  await opWait(p, () => window.__stkLive.blockReason === '', null, 10000); await sleep(400);
  await p.evaluate(({ bid, fill }) => { window.__q = { bid, ask: Math.round((bid + 0.05) * 100) / 100, at: Date.now() }; window.__ctM.fillPx = fill; window.__toasts.length = 0; }, { bid, fill });
  await p.evaluate(() => window.__stkPaper.live.placeTicket(window.STRYKER_VELA.active.symbol, { side: 'sell', type: 'market', qty: 1 }, 'panel'));
  await opWait(p, () => window.__toasts.some((t) => / filled/.test(t)), null, 8000);
  return p.evaluate(() => { const M = window.__ctM, h = M.history[M.history.length - 1]; return { oid: h.orderId, n: M.sent.filter((m) => m.payloadType === 2106).length }; });
}

async function run(b, w, h, mobile, theme) {
  const tag = w + '-' + theme;
  const { ctx, p, errors } = await open(b, { w, h, mobile, theme });
  await p.evaluate(() => window.__stkLive.pick('ct-77'));
  const s = await setSym(p, 'byo:CT:NAS100');
  check(/^byo:CT:NAS100$/i.test(s) && await opWait(p, () => window.__stkLive.state.lastOkStart > 0 && window.__stkLive.blockReason === '', null, 15000), tag + ': NAS100 · cTrader chart, account picked');
  await opWait(p, () => { const i = window.__stkLive.info(window.STRYKER_VELA.active.symbol); return i && i.code === 'NAS100' && i.lots && i.lots.fromSchema; }, null, 10000);
  // 1) market sell: bid 100.00 on screen, fills at 99.80
  const a = await sell(p, tag, 100, 99.8);
  const t1 = await lastToast(p, ' filled');
  check(/^SELL 1\.00 lot NAS100 MARKET.* filled @ 99\.80 \(expected 100\.00, 0\.2 pts slippage\)\.$/.test(t1), tag + ': toast "Sell … filled @ 99.80 (expected 100.00, 0.2 pts slippage)"', t1);
  await hidePanel(p); await sleep(150);
  const tb = await toastBox(p, 'expected 100\\.00');
  check(tb && tb.inView && !tb.clip && Math.abs(tb.padL - tb.padR) <= 1 && Math.abs(tb.padT - tb.padB) <= 1, tag + ': toast on screen: even padding, in view, text not clipped', tb);
  await p.screenshot({ path: OUT + '/toast-' + tag + '.png' });
  await opWait(p, (oid) => { const r = window.__ctM.audits['ct-' + Object.keys(window.__ctM.audits).map((k) => k.slice(3)).find((k) => window.__ctM.audits['ct-' + k].exp_px != null)]; return !!r; }, a.oid, 6000);
  const row = await p.evaluate(() => { const A = window.__ctM.audits; const k = Object.keys(A).find((x) => A[x].exp_px != null); return k ? A[k] : null; });
  check(row && row.exp_px === 100 && row.fill_px === 99.8 && row.slip_pts === 0.2 && row.slip_money === 0.2 && row.result === 'accepted', tag + ': order log row: exp_px 100, fill_px 99.8, slip_pts 0.2 (after the order)', row);
  // 2) same price -> no slippage text
  await sleep(700);
  const b2 = await sell(p, tag, 100, 100);
  const t2 = await lastToast(p, ' filled');
  check(/ filled @ 100\.00\.$/.test(t2) && !/expected|slippage/.test(t2), tag + ': fill at the same price -> plain "filled @ 100.00." (no slippage text)', t2);
  // 3) Trade history: the two TradeZoro sells + one deal placed elsewhere (Sample data)
  await p.evaluate(({ o1, o2 }) => { const M = window.__ctM, now = Date.now();
    const d = (id, oid, px, ago) => ({ dealId: id, orderId: oid, positionId: oid + 1000, symbolId: 13, tradeSide: 2, volume: 100, filledVolume: 100, executionPrice: px, dealStatus: 2, createTimestamp: now - ago, executionTimestamp: now - ago, commission: -1, moneyDigits: 2 });
    M.deals = [d(31, o2, 100, 1000), d(30, o1, 99.8, 60000), d(29, 4242, 101.25, 3600000)];
    const L = window.__stkLive; L.state.hist.th.rows = null; L.state.hist.th.at = 0; }, { o1: a.oid, o2: b2.oid });
  if (mobile) for (let i = 0; i < 6; i++) { await hidePanel(p); await sleep(200); }
  await p.evaluate(() => { if (!window.__stkPosOrders.open) window.__stkPosOrders.toggle(true); document.querySelector('#stkpo-dock [role=tab][data-t=th]').click(); });
  const got = await opWait(p, () => document.querySelectorAll('#stkpo-dock .stkpo-t tbody tr').length === 3, null, 10000);
  if (!got) console.log('DOCK', await p.evaluate(() => { const d = document.querySelector('#stkpo-dock'); return d ? d.textContent.slice(0, 400) : 'no dock'; }), await p.evaluate(() => JSON.stringify(window.__stkLive.state.hist.th).slice(0, 300)));
  const head = await p.evaluate(() => [...document.querySelectorAll('#stkpo-dock .stkpo-t thead th')].map((c) => c.textContent));
  const rows = await p.evaluate(() => [...document.querySelectorAll('#stkpo-dock .stkpo-t tbody tr')].map((r) => [...r.cells].map((c) => c.textContent)));
  check(got && head.slice(-2).join('|') === 'Expected|Slippage', tag + ': Trade history has Expected + Slippage columns', head);
  const ix = head.indexOf('Expected');
  check(rows[1] && rows[1][ix] === '100.00' && rows[1][ix + 1] === '0.2 pts · -$0.20', tag + ': the 99.80 fill: Expected 100.00, Slippage 0.2 pts · -$0.20 (1 lot, USD-quoted)', rows[1]);
  check(rows[0] && rows[0][ix] === '100.00' && rows[0][ix + 1] === '0', tag + ': the same-price fill: Expected 100.00, Slippage 0', rows[0]);
  check(rows[2] && rows[2][ix] === '' && rows[2][ix + 1] === '', tag + ': a deal not sent from TradeZoro: Expected / Slippage blank', rows[2]);
  await sleep(300);
  const al = await p.evaluate(() => {
    const t = document.querySelector('#stkpo-dock .stkpo-t'), tr = t.querySelectorAll('tbody tr')[1], cs = [...tr.cells].map((c) => c.getBoundingClientRect());
    const cy = cs.map((c) => c.top + c.height / 2), num = [...tr.cells].filter((c) => c.classList.contains('n')).every((c) => getComputedStyle(c).textAlign === 'right');
    const hd = [...t.querySelectorAll('thead th')].slice(-2).every((c) => getComputedStyle(c).textAlign === 'right');
    const clip = [...t.querySelectorAll('td,th')].some((c) => c.scrollWidth > c.clientWidth + 1);
    const wrap = t.closest('.stkpo-view') || t.parentElement, sb = getComputedStyle(wrap).scrollbarWidth;
    return { spread: Math.max(...cy) - Math.min(...cy), num, hd, tab: getComputedStyle(t).fontVariantNumeric, clip, hs: document.documentElement.scrollWidth > window.innerWidth + 1, sb };
  });
  check(al.spread <= 1 && al.num && al.hd && /tabular/.test(al.tab) && !al.clip && !al.hs, tag + ': history rows share one centre, numbers + Expected / Slippage headers right-aligned, tabular, nothing clipped, no page h-scroll', al);
  // scroll the table to its right edge so the new columns are in the shot
  await p.evaluate(() => { const t = document.querySelector('#stkpo-dock .stkpo-t'); let e = t.parentElement; while (e && e.scrollWidth <= e.clientWidth + 1 && e !== document.body) e = e.parentElement; if (e && e !== document.body) e.scrollLeft = e.scrollWidth; });
  await sleep(250);
  await p.screenshot({ path: OUT + '/history-' + tag + '.png' });
  check(await p.evaluate((W) => window.__ctM.sent.filter((m) => W.includes(m.payloadType)).length, WRITES) === 2, tag + ': only the two mocked market sells were sent (mock socket), nothing modified or cancelled');
  check(!errors.length, tag + ': no page errors', errors);
  await ctx.close();
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile, theme] of [[1440, 900, false, 'dark'], [390, 844, true, 'dark'], [1440, 900, false, 'light']]) {
      if (process.env.ONE && process.env.ONE !== w + '-' + theme) continue;
      await run(b, w, h, mobile, theme);
    }
  } catch (e) { fail++; console.log('FAIL crashed ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
