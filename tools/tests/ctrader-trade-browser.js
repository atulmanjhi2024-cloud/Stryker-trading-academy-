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
  const btn = await p.$('#stkc-trade-pop [data-a=ctrader]');
  check(!!btn, tag + ': admin sees "Allow trading with cTrader"');
  const al = await p.evaluate(() => { const e = document.querySelector('#stkc-trade-pop [data-a=ctrader]'), b = e.getBoundingClientRect(), i = e.querySelector('.stktm-logo').getBoundingClientRect(), s = getComputedStyle(e); return { h: b.height, iconCy: i.top + i.height / 2, btnCy: b.top + b.height / 2, padL: s.paddingLeft, padR: s.paddingRight, w: b.width, popW: e.parentElement.getBoundingClientRect().width, clip: e.scrollWidth > e.clientWidth + 1 }; });
  check(Math.abs(al.iconCy - al.btnCy) <= 1 && !al.clip, tag + ': logo centred in the Allow trading pill, text not clipped', al);
  console.log('ALIGN ' + tag + ' ' + JSON.stringify(al));
  await p.screenshot({ path: OUT + '/after-menu-allow-' + w + '-' + theme + '.png' });
  await tap(p, '#stkc-trade-pop [data-a=ctrader]', mobile);
  for (let i = 0; i < 40 && !nav.some((u) => /id\.ctrader\.com/.test(u)); i++) await sleep(100);
  const u = nav.find((x) => /id\.ctrader\.com/.test(x));
  check(u && new URL(u).searchParams.get('scope') === 'trading' && new URL(u).searchParams.get('client_id') === 'CID_sample1', tag + ': Allow trading opens cTrader sign-in with scope=trading', u);
  check(stored.includes('tz-ctrader-trade-state') && !stored.includes('tz-ctrader-state'), tag + ': only the trading state record is written (data sign-in untouched)', stored);
  check(!errors.filter((e) => !/Execution context|navigation/.test(e)).length, tag + ': no page errors', errors);
  await ctx.close();
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
  // market buy (double click = one order)
  await p.evaluate(() => { const sc = document.querySelector('#stkop .stkop-scalp [data-a=buy]'); sc.click(); sc.click(); });   // a double click, same tick
  for (let i = 0; i < 50 && !(await ctSent(p, 2106)).length; i++) await sleep(100);
  await sleep(700);
  let N = await ctSent(p, 2106);
  check(N.length === 1 && N[0].payload.label === 'TradeZoro' && /^[A-Za-z0-9-]{16,50}$/.test(N[0].payload.clientOrderId) && N[0].payload.clientOrderId === N[0].clientMsgId && N[0].payload.symbolId === 2 && N[0].payload.volume === 100000, tag + ': Buy = ONE NewOrder (label TradeZoro, key = clientOrderId, 0.01 lot of US100)', N);
  const aud = await p.evaluate(() => Object.values(window.__ctM.audits));
  check(aud.length === 1 && aud[0].result === 'accepted' && aud[0].brokerOrderId, tag + ': audit row: accepted with the broker order id', aud);
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
  const flat = p.evaluate(() => import('/assets/chart-live.js?v=1227').then((m) => m.flatten('futures:NQ1!')));
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
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
