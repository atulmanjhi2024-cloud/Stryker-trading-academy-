// BROKERS 3 browser test (tastytrade / TradeStation / OANDA direct trading; admins + beta testers). The chart's live module talks to
// /connect/brokers/{trade,token}; Playwright answers those with the REAL route code (functions/connect/brokers/*.js, imported here in
// node) on top of an in-memory fake broker. Every other non-local host is aborted, so no request can leave the machine, and the fake
// upstream refuses any host that is not the broker's test host. No real order can be sent. Sample data only.
//   node tools/tests/chart-dev-server.mjs 8031 &   CHART_BASE=http://127.0.0.1:8031 node tools/tests/brokers3-browser.js <shotsDir>
// Checks: members see no broker trading tiles; admins and beta testers see "Trade with <broker>" text tiles (no logos), "Coming soon"
// when the server is not set up; tastytrade opens its sandbox sign-in (read trade); OANDA's token sheet checks the token and lists the
// practice account; connected accounts show in Live accounts marked sandbox / SIM / practice; pick = Enable step first, then the same
// order panel; market buy = ONE order at the broker's TEST host; a broker refusal keeps its origin ("tastytrade said: ..."); the
// position shows; disconnect; no upstream call ever reached a live host; alignment numbers; no horizontal scroll at 390.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp/brokers3';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 600) : '')); };
const ENV = { TASTY_SANDBOX_CLIENT_ID: 'tcid_sample', TASTY_SANDBOX_CLIENT_SECRET: 'never-in-browser', TS_CLIENT_ID: 'scid_sample', TS_CLIENT_SECRET: 'never-in-browser', OANDA_TRADE_ENABLED: '1' };
const TEST_HOSTS = new Set(['api.cert.tastyworks.com', 'sim-api.tradestation.com', 'api-fxpractice.oanda.com']);
const LIVE = /api\.tastyworks\.com|(^|\/\/)api\.tradestation\.com|api-fxtrade\.oanda\.com|streamer\.tastyworks\.com/;

// ---- the fake brokers (state per test context)
function fakeBrokers() {
  const S = { upstream: [], reject: '', pos: { tastytrade: [], tradestation: [], oanda: [] }, oid: 100 };
  const J = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const f = async (url, init = {}) => {
    const u = new URL(url), m = init.method || 'GET', k = m + ' ' + u.pathname;
    S.upstream.push({ host: u.host, k, body: init.body || null });
    if (!TEST_HOSTS.has(u.host)) throw new Error('NOT A TEST HOST ' + u.host);
    if (u.host === 'api.cert.tastyworks.com') {
      if (k === 'GET /customers/me/accounts') return J({ data: { items: [{ account: { 'account-number': '5WT00001', nickname: 'Sample', 'margin-or-cash': 'Margin' } }] } });
      if (k === 'GET /accounts/5WT00001/positions') return J({ data: { items: S.pos.tastytrade } });
      if (k === 'GET /accounts/5WT00001/orders/live') return J({ data: { items: [] } });
      if (k === 'GET /accounts/5WT00001/balances') return J({ data: { 'net-liquidating-value': '100000', 'cash-balance': '100000', currency: 'USD' } });
      if (k === 'POST /accounts/5WT00001/orders') {
        if (S.reject) return J({ error: { code: 'preflight_check_failure', message: 'x', errors: [{ message: S.reject }] } }, 422);
        const b = JSON.parse(init.body), l = b.legs[0], q = Number(l.quantity) * (/^Sell/.test(l.action) ? -1 : 1);
        S.pos.tastytrade = [{ symbol: l.symbol, 'instrument-type': l['instrument-type'], quantity: String(Math.abs(q)), 'quantity-direction': q > 0 ? 'Long' : 'Short', 'average-open-price': '28750' }];
        return J({ data: { order: { id: ++S.oid, status: 'Filled' } } }, 201);
      }
    }
    if (u.host === 'sim-api.tradestation.com') {
      if (k === 'GET /v3/brokerage/accounts') return J({ Accounts: [{ AccountID: 'SIM1234567F', AccountType: 'Futures', Status: 'Active' }] });
      if (k === 'GET /v3/brokerage/accounts/SIM1234567F/positions') return J({ Positions: S.pos.tradestation });
      if (k === 'GET /v3/brokerage/accounts/SIM1234567F/orders') return J({ Orders: [] });
      if (k === 'GET /v3/brokerage/accounts/SIM1234567F/balances') return J({ Balances: [{ Equity: '50000', CashBalance: '50000' }] });
      if (k === 'POST /v3/orderexecution/orders') {
        if (S.reject) return J({ Errors: [{ Error: 'FAILED', Message: S.reject }] });
        const b = JSON.parse(init.body);
        S.pos.tradestation = [{ Symbol: b.Symbol, AssetType: 'FUTURE', Quantity: b.Quantity, LongShort: b.TradeAction === 'BUY' ? 'Long' : 'Short', AveragePrice: '28750' }];
        return J({ Orders: [{ OrderID: String(++S.oid), Message: 'Sent order' }] });
      }
    }
    if (u.host === 'api-fxpractice.oanda.com') {
      const A = '/v3/accounts/101-004-1234567-001';
      if (k === 'GET /v3/accounts') return J({ accounts: [{ id: '101-004-1234567-001', tags: [] }] });
      if (k === 'GET ' + A + '/openPositions') return J({ positions: S.pos.oanda });
      if (k === 'GET ' + A + '/pendingOrders') return J({ orders: [] });
      if (k === 'GET ' + A + '/summary') return J({ account: { NAV: '10000', balance: '10000', unrealizedPL: '0', currency: 'USD' }, lastTransactionID: '100' });
      if (k === 'GET ' + A + '/instruments') {
        const want = u.searchParams.get('instruments'), all = [{ name: 'NAS100_USD', type: 'CFD', displayPrecision: 1, tradeUnitsPrecision: 1, minimumTradeSize: '0.1', maximumOrderUnits: '2000' }, { name: 'EUR_USD', type: 'CURRENCY', displayPrecision: 5, tradeUnitsPrecision: 0, minimumTradeSize: '1', maximumOrderUnits: '100000000' }];
        return J({ instruments: want ? all.filter((x) => x.name === want) : all });
      }
      if (k === 'GET ' + A + '/transactions/sinceid') return J({ transactions: [], lastTransactionID: '100' });
      if (k === 'POST ' + A + '/orders') {
        if (S.reject) return J({ errorMessage: S.reject, orderRejectTransaction: { rejectReason: 'INSUFFICIENT_MARGIN' } }, 400);
        const o = JSON.parse(init.body).order, un = Number(o.units);
        S.pos.oanda = [{ instrument: o.instrument, long: { units: String(Math.max(un, 0)), averagePrice: '28750' }, short: { units: String(Math.min(un, 0)), averagePrice: '28750' } }];
        return J({ orderCreateTransaction: { id: String(++S.oid) }, orderFillTransaction: { id: String(++S.oid) } }, 201);
      }
    }
    return J({ error: 'unmocked ' + k }, 404);
  };
  return { S, f };
}

async function open(b, { w, h, mobile, theme, admin = true, beta = false, creds = {}, configured = true }) {
  const T = await import('../../functions/connect/brokers/trade.js');
  const K = await import('../../functions/connect/brokers/token.js');
  const env = configured ? ENV : {};
  const FB = fakeBrokers();
  const G = { consent: false, audits: new Map(), routeCalls: [] };
  const deps = {
    verify: async () => 'u1', allowed: async () => admin || beta, liveSwitch: async () => true, defer: (p) => p, fetchImpl: FB.f,
    store: { get: async (p) => (p.startsWith('liveConsent/') ? (G.consent ? { uid: 'u1', version: '2026-11-21' } : null) : p === 'settings/liveBlocked' ? {} : null) },
    audit: async (e, id) => { if (G.audits.has(id)) { const x = new Error('dup'); x.duplicate = true; throw x; } G.audits.set(id, { ...e, result: 'attempt' }); return { id, finish: async (r) => Object.assign(G.audits.get(id), r) }; }
  };
  T._resetBrokers(); (await import('../../functions/connect/finatic/_owner.js'))._resetOwner();   // the gates memo per uid; each context starts clean
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(({ t, admin, beta, creds }) => {
    class NoWS { constructor() { this.h = {}; } addEventListener() {} send() {} close() {} }   // the tastytrade streamer is unit-tested; never opened here
    window.__stkLiveTest = { isAdmin: () => admin, isBeta: () => beta, last: () => 28750, fastRetry: true, ctCreds: null, ctDeps: { idToken: async () => 'IDT', save: async () => {} },
      b3Creds: creds, b3Deps: { idToken: async () => 'IDT', WebSocket: NoWS, pollMs: 600000, save: async (c) => { window.__b3Saved = c; window.__stkLiveTest.b3Creds.oanda = c; } } };   // save: stands in for the encrypted vault (only the OANDA sheet saves through deps)
    window.__stkOpTest = { q: { bid: 28749.75, ask: 28750 }, quote() { return this.q; } };
    window.__toasts = []; const keep = () => (t, m) => { window.__toasts.push(String(m)); return Promise.resolve(); };
    Object.defineProperty(window, 'showToast', { configurable: true, get: () => keep(), set: () => {} });
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {}
  }, { t: theme, admin, beta, creds });
  const nav = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => { nav.push(r.request().url()); r.abort(); });
  await ctx.route('**/api/chart/bars/**', (r) => {
    const u = new URL(r.request().url()), tf = Number(u.searchParams.get('tf') || 1), P = 8 * 3600, now = Math.floor(Date.now() / 1000);
    const page = u.searchParams.has('page') ? Number(u.searchParams.get('page')) : Math.floor(now / P);
    if (!/NQ/.test(u.pathname) || tf !== 1 || page < Math.floor(now / P) - 12) return r.fulfill({ json: { bars: [] } });
    const bars = []; for (let t = page * P; t < (page + 1) * P && t <= now; t += 60) { const c = Math.round((28750 + 6 * Math.sin(t / 540)) * 4) / 4; bars.push([t, c - 0.5, c + 1, c - 1, c, 100]); }
    return r.fulfill({ json: { s: 'NQ', tf: '1', page, bars, rt: true } });
  });
  await ctx.route('**/api/beta/status*', (r) => r.fulfill({ json: { beta: !!beta } }));   // broker-pause + the beta gate ask the server
  await ctx.route('**/connect/ctrader/token*', (r) => r.fulfill({ status: 503, json: { configured: false } }));
  const pass = async (r, fn) => {   // hand the browser request to the REAL route code (node side)
    const q = r.request(), hd = { ...q.headers(), origin: 'https://tradezoro.com', 'cf-connecting-ip': '10.9.' + (G.routeCalls.length % 250) + '.1' };
    const url = q.url().replace(/^https?:\/\/[^/]+/, 'https://tradezoro.com');
    G.routeCalls.push({ url, body: q.postData() });
    const res = await fn(new Request(url, { method: q.method(), headers: hd, body: q.method() === 'POST' ? q.postData() : undefined }), env, deps);
    return r.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
  };
  await ctx.route('**/connect/brokers/trade*', (r) => pass(r, T.handle));
  await ctx.route('**/connect/brokers/token*', (r) => pass(r, K.handle));
  await ctx.route('**/connect/finatic/**', async (r) => {
    const u = new URL(r.request().url()); let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    const j = (o) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname.endsWith('/data')) return j(body.op === 'accounts' ? { userId: 'x', data: [] } : body.op === 'live' ? { data: { positions: [], orders: [] } } : { data: [] });
    if (u.pathname.endsWith('/order') && body.op === 'consent') { G.consent = true; return j({ ok: true, consent: true }); }
    if (u.pathname.endsWith('/order') && body.op === 'env') return j({ env: 'live', enabled: true, consent: true, blocked: false });
    return j({ data: {} });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|Failed to load resource|WebSocket/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('dialog', (d) => d.dismiss());
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkPaper, null, { timeout: 60000 });
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1'); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.market.symbol === 'futures:NQ1!') break; } });
  await sleep(800);
  return { ctx, p, errors, nav, FB, G };
}
const opWait = (p, fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms || 10000 }).then(() => true, () => false);
async function openMenu(p) { await p.evaluate(() => window.__stkPaper.openTradeMenu()); await p.waitForSelector('#stkc-trade-pop:not([hidden]) .stktm-pick', { timeout: 8000 }); await sleep(250); }
// the live module loads with the first menu open; the broker tiles arrive after its admin / beta check (the menu re-renders itself)
async function menuReady(p, sel) { await openMenu(p); await opWait(p, () => !!window.__stkB3 && window.__stkLive && window.__stkLive.state.loaded, null, 20000); if (sel) await opWait(p, (s) => !!document.querySelector(s), sel, 8000); await sleep(300); }
const noLive = (tag, FB, nav) => {
  check(FB.S.upstream.every((c) => TEST_HOSTS.has(c.host)), tag + ': every broker call went to a TEST host (sandbox / SIM / practice)', FB.S.upstream.map((c) => c.host));
  check(!nav.some((u) => LIVE.test(u)), tag + ': the browser never asked for a live broker host', nav.filter((u) => LIVE.test(u)));
};
const tileAlign = (p) => p.evaluate(() => [...document.querySelectorAll('#stkc-trade-pop .stktm-b3add')].map((e) => {
  const b = e.getBoundingClientRect(), s = getComputedStyle(e), kids = [...e.children].map((k) => { const r = k.getBoundingClientRect(); return { c: k.className, cy: r.top + r.height / 2, clip: k.scrollWidth > k.clientWidth + 1 }; });
  const cys = kids.map((k) => k.cy);
  return { t: e.innerText.replace(/\s+/g, ' '), h: Math.round(b.height), w: Math.round(b.width), spread: Math.round((Math.max(...cys) - Math.min(...cys)) * 10) / 10, mid: Math.round(Math.abs(b.top + b.height / 2 - (cys[0])) * 10) / 10, padL: s.paddingLeft, padR: s.paddingRight, clip: kids.some((k) => k.clip) || e.scrollWidth > e.clientWidth + 1, img: !!e.querySelector('img') };
}));

async function member(b) {
  const { ctx, p, errors, FB } = await open(b, { w: 1440, h: 900, theme: 'dark', admin: false, creds: { tastytrade: { access: 'ACCESS_sample_123456', exp: Date.now() + 3600e3, env: 'sandbox' } } });
  await openMenu(p); await p.waitForFunction(() => window.__stkLive && window.__stkLive.state.loaded, null, { timeout: 20000 }).catch(() => {}); await sleep(1500);
  const h = await p.evaluate(() => document.getElementById('stkc-trade-pop').innerText);
  check(!/tastytrade|TradeStation|OANDA/i.test(h), 'member: no broker trading tiles or accounts', h.slice(0, 200));
  check(!(await p.evaluate(() => !!window.__stkB3)), 'member: window.__stkB3 is not set');
  check(FB.S.upstream.length === 0, 'member: no broker call at all', FB.S.upstream.length);
  check(!errors.length, 'member: no page errors', errors);
  await ctx.close();
}
async function tiles(b, w, h, mobile, theme, configured) {
  const tag = 'tiles-' + w + '-' + theme + (configured ? '' : '-soon');
  const { ctx, p, errors, nav, FB } = await open(b, { w, h, mobile, theme, admin: false, beta: true, configured });
  await menuReady(p, '#stkc-trade-pop .stktm-b3add');
  const al = await tileAlign(p);
  check(al.length === 3 && al.every((x) => !x.img), tag + ': beta tester sees three broker text tiles, no logos', al.map((x) => x.t));
  check(al.every((x) => (configured ? /^[A-Z] Trade with / : /Coming soon/).test(x.t)), tag + ': tiles say ' + (configured ? '"Trade with <broker>"' : '"Coming soon"'), al.map((x) => x.t));
  check(al.every((x) => x.spread <= 1 && !x.clip && x.padL === x.padR) && new Set(al.map((x) => x.h)).size === 1 && new Set(al.map((x) => x.w)).size === 1, tag + ': one vertical centre per tile, even padding, same size, nothing clipped', al);
  console.log('ALIGN ' + tag + ' ' + JSON.stringify(al));
  await p.screenshot({ path: OUT + '/menu-' + tag + '.png' });
  if (!configured) {
    const t0 = await p.evaluate(() => window.__toasts.length);
    await p.evaluate(() => document.querySelector('#stkc-trade-pop [data-a=b3][data-b=oanda]').click());
    check(await opWait(p, (n) => window.__toasts.slice(n).some((t) => /coming soon/i.test(t)), t0, 4000), tag + ': a Coming soon tile only says so');
  }
  noLive(tag, FB, nav);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), tag + ': no horizontal scroll');
  check(!errors.filter((e) => !/Execution context|navigation/.test(e)).length, tag + ': no page errors', errors);
  if (configured && w === 1440) {
    await p.evaluate(() => document.querySelector('#stkc-trade-pop [data-a=b3][data-b=tastytrade]').click());
    for (let i = 0; i < 40 && !nav.some((u) => /staging-tasty\.works|tastyworks|tastytrade\.com/.test(u)); i++) await sleep(100);
    const u = nav.find((x) => /staging-tasty\.works|tastytrade\.com/.test(x));
    const q = u ? new URL(u) : null;
    check(q && q.host === 'cert-my.staging-tasty.works' && q.searchParams.get('scope') === 'read trade' && q.searchParams.get('client_id') === 'tcid_sample' && q.searchParams.get('redirect_uri') === 'https://tradezoro.com/connect/tastytrade/trade-callback', tag + ': Trade with tastytrade opens the SANDBOX sign-in with read + trade', u);
    check(!/never-in-browser/.test(JSON.stringify(nav)), tag + ': no secret in any browser request');
  }
  await ctx.close();
}
async function oandaConnect(b, w, h, mobile, theme) {
  const tag = 'oanda-sheet-' + w + '-' + theme;
  const { ctx, p, errors, nav, FB } = await open(b, { w, h, mobile, theme });
  await menuReady(p, '#stkc-trade-pop [data-a=b3][data-b=oanda]');
  await p.evaluate(() => document.querySelector('#stkc-trade-pop [data-a=b3][data-b=oanda]').click());
  check(await opWait(p, () => !!document.querySelector('.stklv-b3 input[data-k=tok]'), null, 5000), tag + ': the OANDA token sheet opens');
  const sh = await p.evaluate(() => { const box = document.querySelector('.stklv-b3 .stklv-cf-box'); return { live: !!document.querySelector('.stklv-b3 [data-env=live]'), text: box.innerText, type: document.querySelector('.stklv-b3 input').type, over: box.scrollWidth > box.clientWidth + 1 }; });
  check(!sh.live && /Practice accounts only/.test(sh.text) && sh.type === 'password' && !sh.over, tag + ': practice only (no Live option), token field masked, nothing overflows', sh);
  await p.fill('.stklv-b3 input[data-k=tok]', 'SAMPLEtoken-0123456789abcdef-0123456789');
  await p.screenshot({ path: OUT + '/' + tag + '.png' });
  await p.evaluate(() => document.querySelector('.stklv-b3 [data-k=yes]').click());
  check(await opWait(p, () => !document.querySelector('.stklv-b3') && window.__stkLive.state.accounts.some((a) => a.b3 === 'oanda'), null, 15000), tag + ': token checked with OANDA practice, the practice account shows in Live accounts');
  const saved = await p.evaluate(() => window.__b3Saved && { env: window.__b3Saved.env, has: !!window.__b3Saved.token });
  check(saved && saved.env === 'sandbox' && saved.has, tag + ': kept for this device as practice', saved);
  noLive(tag, FB, nav);
  check(!errors.length, tag + ': no page errors', errors);
  await ctx.close();
}
const CREDS = { access: 'ACCESS_sample_123456', refresh: 'REFRESH_sample_1', exp: Date.now() + 3600e3, env: 'sandbox', kind: 'trade' };
async function trade(b, broker, w, h, mobile, theme) {
  const tag = broker + '-' + w + '-' + theme, label = { tastytrade: 'tastytrade', tradestation: 'TradeStation', oanda: 'OANDA' }[broker];
  const creds = { [broker]: broker === 'oanda' ? { token: 'SAMPLEtoken-0123456789abcdef', access: 'SAMPLEtoken-0123456789abcdef', env: 'sandbox', exp: Date.now() + 365 * 864e5, kind: 'trade' } : CREDS };
  const { ctx, p, errors, nav, FB, G } = await open(b, { w, h, mobile, theme, creds });
  await openMenu(p);
  check(await opWait(p, (k) => window.__stkLive && window.__stkLive.state.accounts.some((a) => a.b3 === k), broker, 20000), tag + ': the ' + label + ' account is in Live accounts');
  await sleep(400); if (await p.evaluate(() => document.getElementById("stkc-trade-pop").hidden)) await openMenu(p);
  const row = await p.evaluate((k) => { const a = window.__stkLive.state.accounts.find((x) => x.b3 === k); const r = document.querySelector('#stkc-trade-pop [data-a=live][data-id="' + a.id + '"]'); return { id: a.id, text: a.text, row: r ? r.closest('.stktm-row, [data-row]') ? r.closest('.stktm-row, [data-row]').innerText.replace(/\s+/g, ' ') : r.innerText : '', img: !!(r && r.closest('.stktm-row') && r.closest('.stktm-row').querySelector('img')) }; }, broker);
  check(new RegExp(label + ' (sandbox|SIM|practice)').test(row.row) && !/ (sandbox|SIM|practice)$/.test(row.text) && !row.img, tag + ': row names the broker, marks the test account, no logo', row);
  check(!(await p.$('#stkc-trade-pop [data-a=b3][data-b=' + broker + ']')), tag + ': no "Trade with" tile once connected');
  await p.screenshot({ path: OUT + '/menu-' + tag + '.png' });
  await p.evaluate((id) => document.querySelector('#stkc-trade-pop [data-a=live][data-id="' + id + '"]').click(), row.id);   // (menu re-rendered above)
  const en = await opWait(p, () => !!document.querySelector('.stklv-en:not(.stklv-b3)'), null, 15000);
  check(en, tag + ': the Enable step appears before the first order', en ? undefined : await p.evaluate(() => ({ env: window.__stkLive.state.env, acct: window.__stkLive.state.acct && window.__stkLive.state.acct.id, toasts: window.__toasts.slice(-4) })));
  check(FB.S.upstream.every((c) => !/POST|PUT|DELETE/.test(c.k)), tag + ': nothing was sent to the broker before Enable');
  if (en) {
    await p.evaluate(() => { const c = document.querySelector('.stklv-en input[type=checkbox]'); if (c) c.click(); });
    await p.evaluate(() => document.querySelector('.stklv-en [data-k=yes]').click());
    await opWait(p, () => !document.querySelector('.stklv-en'), null, 5000);
  }
  await p.evaluate(() => window.__stkPaper.orderPanel && window.__stkPaper.orderPanel());
  const live = await opWait(p, () => document.querySelector('#stkop.is-live') && window.__stkLive.state.lastOkStart > 0, null, 15000);
  check(live, tag + ': the same order panel is live on the ' + label + ' account', live ? undefined : await p.evaluate(() => ({ op: !!document.querySelector('#stkop'), cls: (document.querySelector('#stkop') || {}).className, acct: window.__stkLive.state.acct && window.__stkLive.state.acct.id, ok: window.__stkLive.state.lastOkStart, why: window.__stkLive.blockReason, envErr: window.__stkLive.state.envErr, env: window.__stkLive.state.env, toasts: window.__toasts.slice(-4), en: !!document.querySelector('.stklv-en') })));
  if (!live) { await p.screenshot({ path: OUT + '/FAIL-panel-' + tag + '.png' }); await ctx.close(); return; }
  await opWait(p, () => window.__stkLive.blockReason === '', null, 10000);
  const st = await p.evaluate(() => ({ why: window.__stkLive.blockReason, info: window.__stkLive.info('futures:NQ1!'), foot: ((document.querySelector('#stkop [data-k=live]') || {}).textContent || '') + ((document.querySelector('.stklv-cbadge') || {}).textContent || '') }));
  check(st.why === '', tag + ': nothing blocks orders once enabled', st.why);
  check(!/\bLIVE\b/.test(st.foot) || /SANDBOX|DEMO|SIM|PRACTICE/i.test(st.foot), tag + ': a test account never shows as LIVE', st.foot);
  console.log('INFO ' + tag + ' ' + JSON.stringify(st.info && { code: st.info.code, ct: st.info.ct, tick: st.info.tick }));
  await p.screenshot({ path: OUT + '/panel-' + tag + '.png' });
  // market buy (double click = one order)
  const posts0 = FB.S.upstream.filter((c) => c.k.startsWith('POST')).length;
  await p.evaluate(() => { const sc = document.querySelector('#stkop .stkop-scalp [data-a=buy]'); sc.click(); sc.click(); });
  for (let i = 0; i < 60 && FB.S.upstream.filter((c) => c.k.startsWith('POST')).length === posts0; i++) await sleep(100);
  await sleep(800);
  const posts = FB.S.upstream.filter((c) => c.k.startsWith('POST')).slice(posts0);
  const sentSym = posts[0] ? (broker === 'tastytrade' ? JSON.parse(posts[0].body).legs[0].symbol : broker === 'tradestation' ? JSON.parse(posts[0].body).Symbol : JSON.parse(posts[0].body).order.instrument) : '';
  check(posts.length === 1 && TEST_HOSTS.has(posts[0].host), tag + ': Buy (double click) = ONE order at the ' + label + ' test host', posts.map((x) => x.host + ' ' + x.k));
  check(broker === 'tastytrade' ? /^\/NQ[FGHJKMNQUVXZ]\d$/.test(sentSym) : broker === 'tradestation' ? /^NQ[FGHJKMNQUVXZ]\d\d$/.test(sentSym) : sentSym === 'NAS100_USD', tag + ': NQ chart = ' + label + ' symbol ' + sentSym, sentSym);
  const aud = [...G.audits.values()];
  check(aud.length === 1 && aud[0].result === 'accepted' && aud[0].venue === broker && aud[0].env === 'sandbox', tag + ': order log row written first and finished as accepted (venue, sandbox)', aud);
  check(await opWait(p, () => (window.__stkLive.state.data.positions || []).length === 1, null, 10000), tag + ': the position shows (status read back from the broker)');
  await sleep(500); await p.screenshot({ path: OUT + '/position-' + tag + '.png' });
  // refusal keeps its origin
  await opWait(p, () => window.__stkLive.blockReason === '', null, 10000); await sleep(600);
  FB.S.reject = 'Not enough buying power (sample).';
  const t0 = await p.evaluate(() => window.__toasts.length);
  await p.evaluate(() => document.querySelector('#stkop .stkop-scalp [data-a=sell]').click());
  check(await opWait(p, ({ n, l }) => window.__toasts.slice(n).some((t) => t.includes(l + ' said: Not enough buying power')), { n: t0, l: label }, 8000), tag + ': a refusal shows "' + label + ' said: ..."', await p.evaluate((n) => window.__toasts.slice(n), t0));
  FB.S.reject = '';
  // disconnect forgets the trading sign-in on this device
  const d = await p.evaluate((id) => window.__stkLive.disconnect(id), row.id).catch((e) => ({ err: String(e) }));
  check(d.ok === true && await opWait(p, (k) => !window.__stkLive.state.accounts.some((a) => a.b3 === k), broker, 5000), tag + ': Disconnect removes the account', d);
  noLive(tag, FB, nav);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), tag + ': no horizontal scroll');
  check(!errors.length, tag + ': no page errors', errors);
  await ctx.close();
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    const only = process.env.ONLY || '';
    if (!only || only === 'member') await member(b);
    if (!only || only === 'tiles') for (const [w, hh, m, th, cf] of [[1440, 900, false, 'dark', true], [1440, 900, false, 'light', false], [390, 844, true, 'dark', true], [390, 844, true, 'light', false]]) await tiles(b, w, hh, m, th, cf);
    if (!only || only === 'oanda') { await oandaConnect(b, 1440, 900, false, 'dark'); await oandaConnect(b, 390, 844, true, 'light'); }
    if (!only || only === 'trade') for (const k of ['tastytrade', 'tradestation', 'oanda']) {
      await trade(b, k, 1440, 900, false, k === 'tradestation' ? 'light' : 'dark');
      if (k === 'tastytrade') await trade(b, k, 390, 844, true, 'light');
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
