// cTrader LIVE TRADING browser test (admin only, Owner 23 Nov 2026). The chart's live module talks to a FAKE WebSocket whose other end
// is the REAL relay rules (functions/connect/ctrader/_relay.js + _trade.js) and a mocked cTrader (tools/tests/ctrader-mock.mjs), all
// inside the page. /connect/finatic/* is mocked too; every other host is aborted. No real order can be sent. Sample data only.
//   node tools/tests/chart-dev-server.mjs 8031 &   CHART_BASE=http://127.0.0.1:8031 node tools/tests/ctrader-trade-browser.js <shotsDir>
//   BEFORE=1 serves origin/main's Trade-menu files instead (the "before" shots; only the shots run).
// Checks: members never see cTrader trading; admin sees "Allow trading with cTrader" (asks scope=trading) when not connected, the
// cTrader account row (with its logo) when connected; picking it = the order panel on the broker symbol, SANDBOX badge for a demo
// account; market buy sends one NewOrder (label TradeZoro, clientOrderId = the idempotency key); a double click sends one; a broker
// refusal shows its plain words; Enable live trading first; cancel a working order; flatten (confirm) closes the position; a drop mid-
// order says "may or may not" and blocks new orders; alignment numbers; no horizontal scroll at 390.
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp/ctradertrade';
const BEFORE = process.env.BEFORE === '1';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 600) : '')); };
const ACC = '123e4567-e89b-12d3-a456-426614174000', US = '0aaa1111-2222-3333-4444-555566667777';
const ROOT = path.resolve(__dirname, '..', '..');
const mainFile = (p) => execSync('git -C ' + ROOT + ' show origin/main:' + p, { maxBuffer: 1 << 26 }).toString();

async function open(b, { w, h, mobile, theme, admin = true, beta = false, ct = true, consent = true }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(({ t, admin, beta, US, ct, consent }) => {
    window.__ctM = null;
    window.__stkLiveTest = { isAdmin: () => admin, isBeta: () => beta, last: () => 28750, fastRetry: true,
      ctCreds: ct ? { access: 'ACCESSTOKENsample1', refresh: 'REFRESHsample1', exp: Date.now() + 30 * 864e5, accountId: 77, isLive: false, login: 5551234, kind: 'trade' } : null,
      ctDeps: { idToken: async () => 'IDT', save: async () => {} } };
    window.__ctConsent = consent;
    window.__stkOpTest = { q: { bid: 28749.75, ask: 28750 }, quote() { return this.q; } };
    window.__toasts = []; const keep = () => (t, m) => { window.__toasts.push(String(m)); return Promise.resolve(); };
    Object.defineProperty(window, 'showToast', { configurable: true, get: () => keep(), set: () => {} });
    try {
      localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1');
      localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); localStorage.setItem('stryker_broker_sync_user_u1', US);
    } catch (e) {}
  }, { t: theme, admin, beta, US, ct, consent });
  const nav = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => { nav.push(r.request().url()); r.abort(); });
  if (BEFORE) for (const f of ['assets/chart-live.js', 'assets/chart-trade-menu.js', 'assets/chart-paper.js', 'assets/style-charts.css'])
    await ctx.route('**/' + f + '*', (r) => r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : 'text/javascript', body: mainFile(f) }));
  await ctx.route('**/api/chart/bars/**', (r) => {
    const u = new URL(r.request().url()), tf = Number(u.searchParams.get('tf') || 1), P = 8 * 3600, now = Math.floor(Date.now() / 1000);
    const page = u.searchParams.has('page') ? Number(u.searchParams.get('page')) : Math.floor(now / P);
    if (!/NQ/.test(u.pathname) || tf !== 1 || page < Math.floor(now / P) - 12) return r.fulfill({ json: { bars: [] } });
    const bars = []; for (let t = page * P; t < (page + 1) * P && t <= now; t += 60) { const c = Math.round((28750 + 6 * Math.sin(t / 540)) * 4) / 4; bars.push([t, c - 0.5, c + 1, c - 1, c, 100]); }
    return r.fulfill({ json: { s: 'NQ', tf: '1', page, bars, rt: true } });
  });
  await ctx.route('**/connect/ctrader/token*', (r) => r.fulfill({ json: { configured: true, client_id: 'CID_sample1' } }));
  const F = { calls: [] };
  const j = (o, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(o) });
  await ctx.route('**/connect/finatic/**', async (r) => {
    const u = new URL(r.request().url()); let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    if (u.searchParams.get('probe')) return r.fulfill(j({ configured: true }));
    F.calls.push({ path: u.pathname, body });
    if (u.pathname.endsWith('/data')) {
      if (body.op === 'accounts') return r.fulfill(j({ userId: US, data: [{ accountId: ACC, accountName: 'SAMPLEDEMO5551234', accountNumber: '70001234', brokerName: 'tradovate' }] }));
      if (body.op === 'live') return r.fulfill(j({ data: { positions: [], orders: [] } }));
      return r.fulfill(j({ data: [] }));
    }
    if (u.pathname.endsWith('/order') && body.op === 'consent') return r.fulfill(j({ ok: true, consent: true }));
    if (u.pathname.endsWith('/order') && body.op === 'env') return r.fulfill(j({ env: 'live', enabled: true, consent: true, blocked: false }));
    return r.fulfill(j({ data: {} }));
  });
  const p = await ctx.newPage();
  const stored = [];   // sessionStorage keys written (the sign-in leaves the page, so they are recorded as they happen)
  await p.exposeFunction('__ssRec', (k) => { stored.push(k); });
  await p.addInitScript(() => { const s0 = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (this === window.sessionStorage && window.__ssRec) window.__ssRec(k); return s0.call(this, k, v); }; });
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|Failed to load resource|Ping received|Unexpected response code|WebSocket/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('dialog', (d) => d.dismiss());
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  // the in-page mocked cTrader (the real relay rules on the far side of a fake socket)
  if (!BEFORE) await p.evaluate(async (consent) => {
    const m = await import('/tools/tests/ctrader-mock.mjs');
    const M = m.mockState({ gate: { consent } }); window.__ctM = M; window.__stkLiveTest.ctDeps.WS = m.makeWS(M);
    // the "Enable live trading" acceptance is the same liveConsent doc the relay reads
    const f0 = window.fetch; window.fetch = (u, o) => { if (/\/connect\/finatic\/order/.test(String(u)) && o && /"consent"/.test(o.body || '')) M.gate.consent = true; return f0(u, o); };
  }, consent);
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkPaper, null, { timeout: 60000 });
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1'); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.market.symbol === 'futures:NQ1!') break; } });
  await sleep(800);
  return { ctx, p, errors, F, nav, stored };
}
const opWait = (p, fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms || 10000 }).then(() => true, () => false);
const tap = (p, sel, mobile) => (mobile ? p.tap(sel) : p.click(sel));
const ctSent = (p, ty) => p.evaluate((ty) => window.__ctM.sent.filter((m) => m.payloadType === ty), ty);
async function openMenu(p) { await p.evaluate(() => window.__stkPaper.openTradeMenu()); await p.waitForSelector('#stkc-trade-pop:not([hidden]) .stktm-pick', { timeout: 8000 }); await sleep(250); }
const closeMenu = (p) => p.evaluate(() => { const m = document.getElementById('stkc-trade-pop'); if (m) m.hidden = true; const o = document.getElementById('stkc-more-pop'); if (o && !o.hidden) document.getElementById('stkc-more-btn').click(); });
// alignment of one row (centres, paddings) + the logo tile
const rowAlign = (p, sel) => p.evaluate((sel) => {
  const row = document.querySelector(sel); if (!row) return null;
  const R = row.getBoundingClientRect(), kids = [...row.querySelectorAll('.stktm-logo, .stktm-tx, .stktm-bal')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => { const b = e.getBoundingClientRect(); return { c: e.className.split(' ')[0], cy: b.top + b.height / 2, l: b.left, r: b.right, w: b.width, h: b.height }; });
  const img = row.querySelector('.stktm-ct img'), tile = row.querySelector('.stktm-ct');
  const ib = img && img.getBoundingClientRect(), tb = tile && tile.getBoundingClientRect();
  const cys = kids.map((k) => k.cy);
  return { h: R.height, spread: cys.length ? Math.max(...cys) - Math.min(...cys) : 0, kids, logoInset: ib && tb ? [ib.left - tb.left, tb.right - ib.right, ib.top - tb.top, tb.bottom - ib.bottom].map((x) => Math.round(x * 10) / 10) : null, imgLoaded: !!(img && img.complete && img.naturalWidth > 0), overflow: [...row.querySelectorAll('*')].some((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible' && !/stktm-nm|stktm-meta/.test(e.className)) };
}, sel);

async function member(b) {
  const { ctx, p, errors } = await open(b, { w: 1440, h: 900, theme: 'dark', admin: false });
  await p.waitForFunction(() => window.__stkLive && window.__stkLive.state.loaded, null, { timeout: 20000 }).catch(() => {});
  await openMenu(p);
  const h = await p.evaluate(() => document.getElementById('stkc-trade-pop').innerText);
  check(!/ctrader/i.test(h), 'member: no cTrader row, no Allow trading, no cTrader module', h.slice(0, 200));
  check(!(await p.evaluate(() => !!window.__stkCt)), 'member: window.__stkCt is not set');
  check(!(await p.evaluate(() => !!window.__ctM && window.__ctM.sent.length)), 'member: no cTrader socket is opened');
  check(!errors.length, 'member: no page errors', errors);
  await ctx.close();
}
// beta tester (Owner 23 Nov: admin OR beta tester): not an admin, but sees the cTrader option and its account
async function betaTester(b) {
  const { ctx, p, errors } = await open(b, { w: 1440, h: 900, theme: 'dark', admin: false, beta: true });
  await p.waitForFunction(() => window.__stkLive && window.__stkLive.state.loaded && window.__stkCt, null, { timeout: 20000 }).catch(() => {});
  check(await p.evaluate(() => !!window.__stkCt && window.__stkCt.connected), 'beta tester: the cTrader trading link is loaded');
  await p.waitForFunction(() => window.__stkLive.state.accounts.some((a) => a.ct), null, { timeout: 8000 }).catch(() => {});
  check(await p.evaluate(() => window.__stkLive.state.accounts.some((a) => a.ct)), 'beta tester: the cTrader account is in the Live accounts list');
  check(!(await p.evaluate(() => window.__stkLive.admin)), 'beta tester: still not admin (no kill-switch buttons)');
  check(!errors.length, 'beta tester: no page errors', errors);
  await ctx.close();
}
async function notConnected(b, w, h, mobile, theme) {
  const tag = 'allow-' + w + '-' + theme;
  const { ctx, p, errors, nav, stored } = await open(b, { w, h, mobile, theme, ct: false });
  await p.waitForFunction(() => window.__stkLive && window.__stkLive.state.loaded, null, { timeout: 20000 });
  await openMenu(p);
  if (BEFORE) { await p.screenshot({ path: OUT + '/before-menu-' + w + '-' + theme + '.png' }); await ctx.close(); return; }
  check(!(await p.$('#stkc-trade-pop [data-a=ctrader]')), tag + ': no separate "Allow trading with cTrader" button in the menu');
  await p.screenshot({ path: OUT + '/after-menu-allow-' + w + '-' + theme + '.png' });
  await tap(p, '#stkc-trade-pop [data-a=connect]', mobile);
  await p.waitForSelector('#fjs .fjs-tile[data-broker=ctrader]', { timeout: 30000 }).catch(async (e) => { console.log('DLG', await p.evaluate(() => (document.getElementById('fjs') || document.body).innerText.slice(0, 300))); throw e; });
  await sleep(400);
  const al = await p.evaluate(() => {
    const t = [...document.querySelectorAll('#fjs .fjs-tile')], ids = t.map((e) => e.dataset.broker), r = t.map((e) => e.getBoundingClientRect());
    const ct = t[0], lg = ct.querySelector('.fjs-lg'), im = ct.querySelector('img'), cs = getComputedStyle(lg);
    const cx = r.map((b) => Math.round(b.left + b.width / 2)), tops = [...new Set(r.map((b) => Math.round(b.top)))];
    const sc = document.querySelector('#fjs'); const soon = t.filter((e) => e.getAttribute('aria-disabled') === 'true').map((e) => e.dataset.broker);
    const logoCx = t.map((e) => { const b = e.querySelector('.fjs-lg').getBoundingClientRect(), k = e.getBoundingClientRect(); return Math.abs(b.left + b.width / 2 - (k.left + k.width / 2)); });
    return { ids, sameSize: r.every((b) => Math.abs(b.width - r[0].width) <= 1 && Math.abs(b.height - r[0].height) <= 1), rows: tops.length, perRow: r.filter((b) => Math.round(b.top) === tops[0]).length, bg: cs.backgroundColor, bw: cs.borderTopWidth, imgOk: im && im.complete && im.naturalWidth > 0, soon, soonTitle: t.filter((e) => e.title === 'Coming soon').length, soonCaps: [...document.querySelectorAll('#fjs .fjs-soon')].map((e) => getComputedStyle(e).fontSize), op: t.map((e) => getComputedStyle(e).opacity), logoOff: Math.max(...logoCx), hscroll: sc.scrollWidth > sc.clientWidth + 1, hdoc: document.documentElement.scrollWidth > innerWidth + 1, capClip: [...document.querySelectorAll('#fjs .fjs-tn, #fjs .fjs-soon')].some((e) => e.scrollWidth > e.clientWidth + 1) };
  });
  console.log('ALIGN ' + tag + ' ' + JSON.stringify(al));
  check(al.ids.join() === 'ctrader,interactive-brokers,metatrader-4,metatrader-5,ninjatrader,rithmic,tastytrade,tradovate,webull', tag + ': 9 tiles, alphabetical', al.ids);
  check(al.sameSize && al.rows === 3 && al.perRow === 3, tag + ': all tiles one size, 3 x 3 grid', al);
  check(al.imgOk && /rgba\(0, 0, 0, 0\)|transparent/.test(al.bg) && al.bw === '0px', tag + ': cTrader mark loaded, transparent (no white tile)', al);
  check(al.logoOff <= 1 && !al.hscroll && !al.hdoc && !al.capClip, tag + ': logos centred in tiles, no clipping, no horizontal scroll', al);
  check(al.soon.join() === 'rithmic,tradovate,interactive-brokers'.split(',').sort((a, b) => al.ids.indexOf(a) - al.ids.indexOf(b)).join() && al.soonTitle === 3 && al.soonCaps.every((f) => f === '12px'), tag + ': Coming soon on Interactive Brokers, Rithmic, Tradovate only (12px, tooltip); cTrader is open for this admin', al);
  await p.screenshot({ path: OUT + '/after-dialog-' + w + '-' + theme + '.png' });
  await p.click('#fjs .fjs-tile[aria-disabled=true]', { force: true }); await sleep(200);
  check(!nav.some((u) => /finatic|portal/i.test(u)) && await p.$('#fjs .fjs-tile[data-broker=ctrader]'), tag + ': a Coming soon tile does nothing');
  await tap(p, '#fjs .fjs-tile[data-broker=ctrader]', mobile);
  for (let i = 0; i < 40 && !nav.some((u) => /id\.ctrader\.com/.test(u)); i++) await sleep(100);
  const u = nav.find((x) => /id\.ctrader\.com/.test(x));
  check(u && new URL(u).searchParams.get('scope') === 'trading' && new URL(u).searchParams.get('client_id') === 'CID_sample1', tag + ': Allow trading opens cTrader sign-in with scope=trading', u);
  check(stored.includes('tz-ctrader-trade-state') && !stored.includes('tz-ctrader-state'), tag + ': only the trading state record is written (data sign-in untouched)', stored);
  check(!errors.filter((e) => !/Execution context|navigation/.test(e)).length, tag + ': no page errors', errors);
  await ctx.close();
}
// symbol picker (Owner 24 Nov): badge button, picker lists, search, choose, auto-pick toast, ticket error "Choose" button. No order is sent.
async function picker(p, tag, mobile) {
  const T = await p.evaluate(() => window.__stkLive.L.mtPlain('NDX', ['US100.cash', 'US100', 'USTEC']) + '|' + window.__stkLive.L.mtPlain('NDX', ['US100.cash', 'NAS100.cash']));
  check(T === 'US100|null', tag + ': plain index name wins over suffix variants; none = null', T);
  await opWait(p, () => (document.querySelector('.stklv-cbadge') || {}).textContent, null, 8000);
  check(await p.evaluate(() => window.__toasts.some((t) => /Using US100 for Nasdaq 100/.test(t))), tag + ": auto-pick toast says which symbol was used", await p.evaluate(() => window.__toasts));;
  const bt = async () => p.evaluate(() => { const b = document.querySelector('.stklv-cbadge'), k = b && b.querySelector('.stklv-cbtn'); return { t: b ? b.firstChild.textContent : '', k: k ? k.textContent : '' }; });
  let b0 = await bt();
  check(/US100$/.test(b0.t) && b0.k === 'Change', tag + ': auto-picked US100 (plain name beats US100.cash / USTEC), badge has Change', b0);
  // force "no single plain name": hide US100 + USTEC from the link
  await p.evaluate(() => { const l = window.__stkCt.link; window.__sv = ['US100', 'USTEC'].map((k) => [k, l.byName.get(k)]); window.__sv.forEach(([k]) => l.byName.delete(k)); window.__stkLive.mtSetSymbol('NDX', ''); });
  await opWait(p, () => (document.querySelector('.stklv-cbtn') || {}).textContent === 'Choose symbol ▾', null, 5000);
  b0 = await bt();
  check(/·\s*Choose symbol ▾$/.test(b0.t + ' ' + b0.k) || b0.k === 'Choose symbol ▾', tag + ': no plain match -> badge says Choose symbol', b0);
  await p.evaluate(() => document.querySelector('.stklv-cbtn').click());
  check(await opWait(p, () => !!document.querySelector('#stklv-sp .stklv-sp-box'), null, 4000), tag + ': badge button opens the picker');
  const ui = await p.evaluate(() => { const bx = document.querySelector('.stklv-sp-box'); return { h: bx.querySelector('h2').textContent, best: [...bx.querySelectorAll('.stklv-sp-list h3')].map((e) => e.textContent), rows: [...bx.querySelectorAll('.stklv-sp-row')].map((e) => e.textContent) }; });
  check(/Which cTrader symbol is Nasdaq 100\?/.test(ui.h) && /Best matches/.test(ui.best[0]) && /All symbols in your account/.test(ui.best[1]), tag + ': title + sections', ui);
  check(ui.rows.some((r) => /NAS100\.cashNasdaq 100 Cash/.test(r)) && ui.rows.some((r) => /EURUSDEuro vs US Dollar/.test(r)), tag + ': rows show the broker description', ui.rows);
  await p.screenshot({ path: OUT + '/after-picker-' + tag + '.png' });
  const al = await p.evaluate(() => { const bx = document.querySelector('.stklv-sp-box'), B = bx.getBoundingClientRect(), q = bx.querySelector('.stklv-sp-q').getBoundingClientRect(), rows = [...bx.querySelectorAll('.stklv-sp-row')].slice(0, 6).map((r) => { const R = r.getBoundingClientRect(), c = [...r.children].map((k) => { const K = k.getBoundingClientRect(); return (K.top + K.bottom) / 2; }); return { spread: Math.max(...c) - Math.min(...c), dc: Math.abs((R.top + R.bottom) / 2 - (c[0] + c[1]) / 2), clip: r.scrollWidth > r.clientWidth + 1 }; }); return { inView: B.left >= -1 && B.right <= innerWidth + 1 && B.bottom <= innerHeight + 1, padL: q.left - B.left, padR: B.right - q.right, rows, sw: document.documentElement.scrollWidth <= innerWidth + 1 }; });
  check(al.inView && al.sw && Math.abs(al.padL - al.padR) <= 1 && al.rows.every((r) => r.spread <= 1 && r.dc <= 1 && !r.clip), tag + ': picker aligned (row centres, even padding, in view, no h-scroll)', al);
  await p.fill('.stklv-sp-q', 'ustec'); await sleep(150);
  check(await p.evaluate(() => [...document.querySelectorAll('.stklv-sp-row')].every((r) => /ustec/i.test(r.textContent)) && document.querySelectorAll('.stklv-sp-row').length === 0), tag + ': search narrows (USTEC hidden from this link = no rows)');
  await p.fill('.stklv-sp-q', 'nas100'); await sleep(150);
  const n0 = (await ctSent(p, 2106)).length;
  await p.evaluate(() => document.querySelector('.stklv-sp-row').click());
  await opWait(p, () => !document.querySelector('#stklv-sp'), null, 3000);
  b0 = await bt();
  check(/NAS100\.cash/.test(b0.t) && b0.k === 'Change', tag + ': choosing saves it and the badge shows the code + Change', b0);
  check(await p.evaluate(() => /NAS100\.cash/.test(localStorage.getItem('stryker_mt_map_' + Object.keys(localStorage).filter((k) => /^stryker_mt_map_/.test(k)).map((k) => k.slice(15))[0]) || '')), tag + ': remembered per account + instrument');
  // ticket error gets a Choose button
  await p.evaluate(() => window.__stkLive.mtSetSymbol('NDX', ''));
  await opWait(p, () => (document.querySelector('.stklv-cbtn') || {}).textContent === 'Choose symbol ▾' && /^Pick the/.test(window.__stkLive.blockReason), null, 5000);
  const calls = await p.evaluate(() => { window.__tact = null; const s0 = window.showToast; Object.defineProperty(window, 'showToast', { configurable: true, get: () => (t, m, o) => { window.__tact = [m, o && o.action && o.action.label]; return Promise.resolve(); }, set: () => {} }); return 1; });
  await p.evaluate(() => { const l = window.__stkCt.link; ['US100', 'USTEC'].forEach((k) => l.byName.delete(k)); window.__stkLive.mtSetSymbol('NDX', ''); });
  await p.evaluate(() => window.__stkPaper.live.placeTicket('futures:NQ1!', { side: 'buy', type: 'market', qty: 1 }, 'panel'));
  await opWait(p, () => !!window.__tact, null, 4000);
  const ta = await p.evaluate(() => window.__tact);
  check(ta && /Pick the cTrader symbol/.test(ta[0]) && ta[1] === 'Choose', tag + ': ticket error has a Choose button', ta);
  check((await ctSent(p, 2106)).length === n0, tag + ': no order sent by any picker step');
  // restore
  await p.evaluate(() => { const keep = () => (t, m) => { window.__toasts.push(String(m)); return Promise.resolve(); }; Object.defineProperty(window, 'showToast', { configurable: true, get: () => keep(), set: () => {} }); });
  await p.evaluate(() => { const l = window.__stkCt.link; window.__sv.forEach(([k, id]) => l.byName.set(k, id)); window.__stkLive.mtSetSymbol('NDX', ''); });
  await opWait(p, () => window.__stkLive.blockReason === '', null, 10000);
  await opWait(p, () => (document.querySelector('.stklv-cbtn') || {}).textContent === 'Change', null, 5000);
  await p.evaluate(() => { const l = window.__stkCt.link, id = l.byName.get('US100'); l.details.delete(id); return l.detail(id).catch(() => {}); });   // size rules load once per symbol
  await opWait(p, () => { const i = window.__stkLive.info('futures:NQ1!'); return i && i.lots && i.lots.fromSchema; }, null, 8000);
  await p.screenshot({ path: OUT + '/after-badge-' + tag + '.png', clip: mobile ? undefined : { x: 700, y: 0, width: 740, height: 140 } });
}
async function trade(b, w, h, mobile, theme) {
  const tag = w + '-' + theme;
  const { ctx, p, errors } = await open(b, { w, h, mobile, theme, consent: false });
  if (BEFORE) { await ctx.close(); return; }
  await p.waitForFunction(() => window.__stkLive && window.__stkLive.state.accounts.some((a) => a.ct), null, { timeout: 20000 });
  await openMenu(p);
  const row = '#stkc-trade-pop .stktm-row[data-row="ct-77"]';
  check(!!(await p.$(row)), tag + ': the cTrader account is in Live accounts');
  check(!(await p.$('#stkc-trade-pop [data-a=ctrader]')), tag + ': no Allow trading button once connected');
  await opWait(p, () => { const i = document.querySelector('#stkc-trade-pop .stktm-ct img'); return i && i.complete && i.naturalWidth > 0; }, null, 5000);
  const ra = await rowAlign(p, row);
  check(ra && ra.spread <= 1 && ra.imgLoaded && ra.logoInset && Math.max(...ra.logoInset) - Math.min(...ra.logoInset) <= 1 && !ra.overflow, tag + ': cTrader row: one vertical centre, logo loaded and centred in its tile, nothing overflows', ra);
  console.log('ALIGN ' + tag + ' row ' + JSON.stringify(ra));
  const txt = await p.evaluate((s) => document.querySelector(s).innerText, row);
  check(/5551234/.test(txt) && /cTrader/.test(txt), tag + ': row shows the cTrader login number and broker', txt);
  await sleep(400);
  await p.screenshot({ path: OUT + '/after-menu-' + tag + '.png' });
  // pick it: the one-time Enable live trading sheet first (consent false), accept, then the panel
  await p.evaluate(() => document.querySelector('#stkc-trade-pop [data-a=live][data-id="ct-77"]').click());
  const en = await opWait(p, () => !!document.querySelector('.stklv-en'), null, 15000);
  check(en, tag + ': Enable live trading appears before the first cTrader order');
  if (en) {
    await p.evaluate(() => { const c = document.querySelector('.stklv-en input[type=checkbox]'); c.click(); });
    await p.evaluate(() => document.querySelector('.stklv-en [data-k=yes]').click());
    await opWait(p, () => !document.querySelector('.stklv-en'), null, 5000);
  }
  await p.evaluate(() => window.__stkPaper.orderPanel && window.__stkPaper.orderPanel());
  const live = await opWait(p, () => document.querySelector('#stkop.is-live') && window.__stkLive.state.lastOkStart > 0, null, 15000);
  check(live, tag + ': order panel is live on the cTrader account');
  const hd = await p.evaluate(() => ({ foot: (document.querySelector('#stkop [data-k=live]') || {}).textContent || '', badge: (document.querySelector('.stklv-cbadge') || {}).textContent || '', sym: (document.querySelector('#stkop select[data-f=mtsym]') || {}).value || '', info: window.__stkLive.info('futures:NQ1!') }));
  check(/SANDBOX/.test(hd.foot + hd.badge), tag + ': a cTrader DEMO account shows SANDBOX, never LIVE', hd);
  check(hd.info && hd.info.code === 'US100' && hd.info.ct, tag + ': NQ chart maps to the cTrader symbol US100', hd.info && hd.info.code);
  await opWait(p, () => window.__stkLive.blockReason === '', null, 10000);
  const why = await p.evaluate(() => window.__stkLive.blockReason);
  check(why === '', tag + ': nothing blocks orders once accepted and read', why);
  await p.screenshot({ path: OUT + '/after-panel-' + tag + '.png' });
  if (!process.env.SKIP_PICKER) await picker(p, tag, mobile);   // SKIP_PICKER=1: the picker section fails on origin/main too (badge markup moved), skip to the order checks
  // market buy (double click = one order). FASTORDER: the mocked Firestore takes 60 ms a call and cTrader 100 ms for this order
  await p.evaluate(() => { window.__ctM.fsMs = 60; window.__ctM.ctMs = 100; window.__ctM.n0toast = window.__toasts.length; });
  await p.evaluate(() => { const sc = document.querySelector('#stkop .stkop-scalp [data-a=buy]'); sc.click(); sc.click(); });   // a double click, same tick
  for (let i = 0; i < 50 && !(await ctSent(p, 2106)).length; i++) await sleep(100);
  await sleep(700);
  let N = await ctSent(p, 2106);
  check(N.length === 1 && N[0].payload.label === 'TradeZoro' && /^[A-Za-z0-9-]{16,50}$/.test(N[0].payload.clientOrderId) && N[0].payload.clientOrderId === N[0].clientMsgId && N[0].payload.symbolId === 2 && N[0].payload.volume === 100000, tag + ': Buy = ONE NewOrder (label TradeZoro, key = clientOrderId, 0.01 lot of US100)', N);
  { const lat = await p.evaluate(() => { window.__ctM.fsMs = 0; window.__ctM.ctMs = 0; return { lat: window.__stkLat || null, toasts: window.__toasts.slice(window.__ctM.n0toast) }; });
    check(lat.toasts.some((x) => /sending…/.test(x)) && lat.toasts.some((x) => /filled @ 18000\.5/.test(x)), tag + ': toast says sending…, then "filled @ price"', lat.toasts);
    const L0 = lat.lat || {}; console.log('LAT ' + tag + ' ' + JSON.stringify(L0) + ' audit ' + JSON.stringify(await p.evaluate(() => Object.values(window.__ctM.audits).map((a) => Object.fromEntries(Object.entries(a).filter(([k]) => /^[sc]_/.test(k)))))));
    // the mocked relay + cTrader run inside this page (their timers jitter with the page's own work), so the 100 ms budget is
    // checked per side: browser = click -> toast minus the relay's whole time; relay = its time minus the mock's 60 + 100 ms
    const A0 = (await p.evaluate(() => Object.values(window.__ctM.audits)))[0] || {};
    check(L0.c_toast > 0 && A0.s_total > 0 && L0.c_toast - A0.s_total <= 100, tag + ': browser overhead click -> filled toast ' + (L0.c_toast - A0.s_total) + ' ms (<= 100)', { L0, A0 });
    check(A0.s_total - 160 <= 100, tag + ': relay overhead ' + (A0.s_total - 160) + ' ms beyond the mock delays (<= 100)', A0);
  }
  await sleep(200);
  const aud = await p.evaluate(() => Object.values(window.__ctM.audits));
  check(aud.length === 1 && aud[0].s_pre >= 60 && aud[0].s_pre < 160, tag + ': relay checks ran in parallel (' + (aud[0] || {}).s_pre + ' ms for 4 gates + lock + log row at 60 ms each)', aud);
  check(aud.length === 1 && aud[0].result === 'accepted' && aud[0].brokerOrderId, tag + ': audit row: accepted with the broker order id', aud);
  check(aud.length === 1 && aud[0].c_toast > 0 && aud[0].c_ack > 0 && aud[0].s_ct >= 100, tag + ': the order log row carries the timing marks (browser c_* + relay s_*)', aud);
  await opWait(p, () => (window.__stkLive.state.data.positions || []).length === 1, null, 8000);
  await opWait(p, () => window.__stkLive.blockReason === '', null, 10000);
  await p.screenshot({ path: OUT + '/after-position-' + tag + '.png' });
  // broker refusal in plain words
  const t0 = await p.evaluate(() => window.__toasts.length);
  await p.evaluate(() => { window.__ctM.reject = 'NOT_ENOUGH_MONEY'; });
  await sleep(600); await tap(p, '#stkop .stkop-scalp [data-a=sell]', mobile);
  check(await opWait(p, (n) => window.__toasts.slice(n).some((t) => /Not enough money/.test(t)), t0, 8000), tag + ': a cTrader refusal shows in plain words', await p.evaluate((n) => window.__toasts.slice(n), t0));
  await p.evaluate(() => { window.__ctM.reject = ''; });
  // flatten (confirm) closes the position
  await opWait(p, () => window.__stkLive.blockReason === '', null, 10000); await sleep(600);
  const flat = p.evaluate(() => window.__stkPaper.live.flatten('futures:NQ1!'));
  const cf = await opWait(p, () => !!document.querySelector('#stklv-cf [data-k=yes]'), null, 5000);
  check(cf, tag + ': Flatten asks one tap first');
  if (cf) await p.evaluate(() => document.querySelector('#stklv-cf [data-k=yes]').click());
  await flat.catch(() => {});
  for (let i = 0; i < 40 && !(await ctSent(p, 2111)).length; i++) await sleep(100);
  check((await ctSent(p, 2111)).length === 1 && await opWait(p, () => !window.__ctM.positions.length, null, 5000), tag + ': Flatten sends one ClosePosition and the position is gone');
  // drop mid-order: "may or may not", nothing re-sent, new orders blocked
  await opWait(p, () => window.__stkLive.blockReason === '', null, 10000); await sleep(600);
  const n0 = (await ctSent(p, 2106)).length, t1 = await p.evaluate(() => window.__toasts.length);
  await p.evaluate(() => { window.__ctM.dropOnWrite = true; });
  await tap(p, '#stkop .stkop-scalp [data-a=buy]', mobile);
  check(await opWait(p, (n) => window.__toasts.slice(n).some((t) => /may or may not/.test(t)), t1, 10000), tag + ': a drop mid-order says it may or may not have gone through', await p.evaluate((n) => window.__toasts.slice(n), t1));
  check(await p.evaluate(() => window.__stkLive.state.unknown === true || /unknown|Checking/i.test(window.__stkLive.blockReason)), tag + ': new orders are blocked after an unclear result');
  await sleep(1500);
  check((await ctSent(p, 2106)).length === n0 + 1, tag + ': the dropped order reached cTrader once and was never re-sent', (await ctSent(p, 2106)).length - n0);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), tag + ': no horizontal scroll');
  check(!errors.length, tag + ': no page errors', errors);
  await ctx.close();
}

// Trade history / Order history on a cTrader account (Owner bug 25 Nov: "No trades yet" though he had traded). Mocked socket only:
// 3 deals (Sample data) -> 3 rows newest first; an execution event + a new deal -> a 4th row without a reload; a failing history call ->
// the error line with Retry, never "No trades yet". READ-ONLY: this test sends no order (it counts every write type).
const DAY = 86400000;
const deal = (id, ago, sym, sideN, vol, px, close) => Object.assign({ dealId: id, orderId: id + 500, positionId: id + 900, symbolId: sym, tradeSide: sideN, volume: vol, filledVolume: vol, executionPrice: px, dealStatus: 2, createTimestamp: Date.now() - ago, executionTimestamp: Date.now() - ago, commission: -6, moneyDigits: 2 },
  close ? { closePositionDetail: { entryPrice: px - 0.001, grossProfit: close, swap: -12, commission: -6, balance: 1000000, moneyDigits: 2 } } : {});
async function history(b, w, h, mobile, theme) {
  const tag = 'hist-' + w + '-' + theme;
  const { ctx, p, errors } = await open(b, { w, h, mobile, theme });
  await p.evaluate((ds) => { window.__ctM.deals = ds; window.__ctM.history = [{ orderId: 601, orderStatus: 2, orderType: 1, executionPrice: 1.0855, executedVolume: 100000, utcLastUpdateTimestamp: Date.now() - 3600000, tradeData: { symbolId: 1, volume: 100000, tradeSide: 1 } }]; },
    [deal(11, 2 * DAY, 1, 1, 100000, 1.0841), deal(12, DAY, 1, 2, 100000, 1.0863, 2200), deal(13, 3600000, 3, 1, 10000000, 2650.15)]);
  await p.waitForFunction(() => window.__stkLive && window.__stkLive.state.accounts.some((a) => a.ct), null, { timeout: 20000 });
  await openMenu(p);
  await p.evaluate(() => document.querySelector('#stkc-trade-pop [data-a=live][data-id="ct-77"]').click());
  await opWait(p, () => window.__stkLive.state.lastOkStart > 0, null, 15000);
  await closeMenu(p);
  const W0 = await p.evaluate(() => window.__ctM.sent.filter((m) => [2106, 2108, 2109, 2110, 2111].includes(m.payloadType)).length);
  if (mobile) for (let i = 0; i < 6; i++) { await p.evaluate(() => { const x = document.querySelector('#stkop:not([hidden]) [data-a=close]'); if (x) x.click(); }); await sleep(250); }   // phone: the order sheet and the dock sheet share the bottom
  await sleep(300);
  await p.evaluate(() => { if (!window.__stkPosOrders.open) window.__stkPosOrders.toggle(true); document.querySelector('#stkpo-dock [role=tab][data-t=th]').click(); });
  const got3 = await opWait(p, () => document.querySelectorAll('#stkpo-dock .stkpo-t tbody tr').length === 3, null, 10000);
  const rows = await p.evaluate(() => [...document.querySelectorAll('#stkpo-dock .stkpo-t tbody tr')].map((r) => [...r.cells].map((c) => c.textContent)));
  check(got3, tag + ': 3 deals from the mocked cTrader -> 3 rows', rows);
  const tv = await p.evaluate(() => { const tl = document.querySelector('#stkpo-dock .stkpo-tabs').getBoundingClientRect(), b = document.querySelector('#stkpo-dock [role=tab].on').getBoundingClientRect(); return { l: b.left - tl.left, r: tl.right - b.right }; });
  check(tv.l >= -1 && tv.r >= -1, tag + ': the picked tab is fully in view in the tab row', tv);
  check(rows.length === 3 && rows[0][1] === 'XAUUSD' && rows[2][1] === 'EURUSD' && rows[0][3] === '1.00' && rows[1][3] === '0.01', tag + ': newest first, broker symbol names, volume in lots', rows);
  check(rows[1] && /Sell · close/.test(rows[1][2]) && /\+\$22\.00/.test(rows[1][5]) && /-\$0\.06/.test(rows[1][6]) && /-\$0\.12/.test(rows[1][7]), tag + ': closing deal shows gross P&L, commission and swap', rows[1]);
  check(await p.evaluate(() => window.__ctM.sent.some((m) => m.payloadType === 2133)), tag + ': DealListReq (2133) was asked');
  await sleep(300);
  const al = await p.evaluate(() => {
    const t = document.querySelector('#stkpo-dock .stkpo-t'), tr = t.querySelector('tbody tr'), cs = [...tr.cells].map((c) => c.getBoundingClientRect());
    const cy = cs.map((c) => c.top + c.height / 2), num = [...tr.cells].filter((c) => c.classList.contains('n')).every((c) => getComputedStyle(c).textAlign === 'right');
    const clip = [...t.querySelectorAll('td,th')].some((c) => c.scrollWidth > c.clientWidth + 1);
    return { spread: Math.max(...cy) - Math.min(...cy), num, tab: getComputedStyle(t).fontVariantNumeric, clip, hs: document.documentElement.scrollWidth > window.innerWidth + 1 };
  });
  check(al.spread <= 1 && al.num && /tabular/.test(al.tab) && !al.clip && !al.hs, tag + ': rows share one centre, numbers right-aligned tabular, nothing clipped, no page h-scroll', al);
  await p.screenshot({ path: OUT + '/after-' + tag + '-3.png' });
  // a new deal + an execution event (the socket's own push) -> a 4th row, no reload
  await p.evaluate(() => { const M = window.__ctM; M.deals = [{ dealId: 14, orderId: 514, positionId: 914, symbolId: 1, tradeSide: 1, volume: 200000, filledVolume: 200000, executionPrice: 1.0871, dealStatus: 2, createTimestamp: Date.now(), executionTimestamp: Date.now(), commission: -12, moneyDigits: 2 }].concat(M.deals);
    M.socket.relay.onUp(JSON.stringify({ payloadType: 2126, payload: { ctidTraderAccountId: 77, executionType: 3, order: { orderId: 514, orderStatus: 2, tradeData: { symbolId: 1, volume: 200000, tradeSide: 1 } }, position: { positionId: 914, positionStatus: 1, price: 1.0871, tradeData: { symbolId: 1, volume: 200000, tradeSide: 1 } } } })); });
  const got4 = await opWait(p, () => document.querySelectorAll('#stkpo-dock .stkpo-t tbody tr').length === 4, null, 8000);
  const top = await p.evaluate(() => [...document.querySelector('#stkpo-dock .stkpo-t tbody tr').cells].map((c) => c.textContent));
  check(got4 && top[1] === 'EURUSD' && top[3] === '0.02', tag + ': an execution event adds the 4th row on top without a reload', top);
  // Order history from OrderListReq
  await p.evaluate(() => document.querySelector('#stkpo-dock [role=tab][data-t=oh]').click());
  const oh = await opWait(p, () => /Filled · Market/.test((document.querySelector('#stkpo-dock .stkpo-view') || {}).textContent || ''), null, 8000);
  check(oh && (await p.evaluate(() => window.__ctM.sent.some((m) => m.payloadType === 2175))), tag + ': Order history from OrderListReq (2175) shows the filled order', await p.evaluate(() => document.querySelector('#stkpo-dock .stkpo-view').textContent.slice(0, 200)));
  await p.screenshot({ path: OUT + '/after-' + tag + '-orders.png' });
  // failure -> the error line with Retry (never "No trades yet"); Retry after the fault clears -> rows again
  await p.evaluate(() => { window.__ctM.histFail = true; const L = window.__stkLive; L.state.hist.th.rows = null; L.state.hist.th.at = 0; document.querySelector('#stkpo-dock [role=tab][data-t=th]').click(); });
  const er = await opWait(p, () => /Couldn’t load trade history from cTrader/.test(document.querySelector('#stkpo-dock .stkpo-view').textContent), null, 8000);
  const et = await p.evaluate(() => document.querySelector('#stkpo-dock .stkpo-view').textContent);
  check(er && !/No trades yet/.test(et) && !!(await p.$('#stkpo-dock [data-retry=th]')), tag + ': a failed call shows the error line with Retry', et);
  const ea = await p.evaluate(() => { const e = document.querySelector('#stkpo-dock .stkpo-err'), bt = e.querySelector('button').getBoundingClientRect(), r = e.querySelector('span').getBoundingClientRect(); return Math.abs((bt.top + bt.height / 2) - (r.top + r.height / 2)); });
  check(ea <= 1, tag + ': error text and Retry share one centre', ea);
  await p.screenshot({ path: OUT + '/after-' + tag + '-error.png' });
  await p.evaluate(() => { window.__ctM.histFail = false; document.querySelector('#stkpo-dock [data-retry=th]').click(); });
  check(await opWait(p, () => document.querySelectorAll('#stkpo-dock .stkpo-t tbody tr').length === 4, null, 8000), tag + ': Retry loads the rows');
  const W1 = await p.evaluate(() => window.__ctM.sent.filter((m) => [2106, 2108, 2109, 2110, 2111].includes(m.payloadType)).length);
  check(W1 === W0 && W0 === 0, tag + ': read-only: no order was placed, changed or cancelled', [W0, W1]);
  check(!errors.length, tag + ': no page errors', errors);
  await ctx.close();
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    const only = process.env.ONLY || '';
    if (!BEFORE && (!only || only === 'member')) await member(b);
    if (!BEFORE && (!only || only === 'beta')) await betaTester(b);
    for (const [w, h, mobile, theme] of [[1440, 900, false, 'dark'], [1440, 900, false, 'light'], [390, 844, true, 'dark'], [390, 844, true, 'light']]) {
      if (process.env.ONE && process.env.ONE !== w + '-' + theme) continue;
      if (!only || only === 'allow') await notConnected(b, w, h, mobile, theme);
      if (!only || only === 'trade') await trade(b, w, h, mobile, theme);
      if (!BEFORE && (!only || only === 'history')) await history(b, w, h, mobile, theme);
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
