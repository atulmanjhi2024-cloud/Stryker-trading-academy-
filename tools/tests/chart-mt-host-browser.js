// HOSTED MetaTrader 5 account (AUTO-MTCLOUD, Owner 22 Nov): sign-in sheet + Trade menu + order panel with stop loss / take profit: Trade menu row, order panel symbol picker (chart NQ -> broker
// NDX100), lots stepper (min / step from the account), market-only from a futures chart, payload, remembered mapping, alignment.
// EVERY /connect/finatic/* call is answered by the local mock below (Sample data): nothing leaves 127.0.0.1, no real order is sent.
//   node tools/tests/chart-dev-server.mjs 8031 &   CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-mt-host-browser.js <shotsDir>
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

async function run(b, w, h, mobile, theme, who) {
  const tag = w + '-' + theme + (who ? '-' + who : '');
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(({ t, US, who }) => {
    window.__stkLiveTest = { isAdmin: () => who === 'admin', isBeta: () => who === 'beta', last: () => 1.1, fastRetry: true };
    window.__stkOpTest = { q: { bid: 1.0999, ask: 1.1 }, quote() { return this.q; } };
    window.__toasts = []; const keep = () => (t, m) => { window.__toasts.push(String(m)); return Promise.resolve(); };
    Object.defineProperty(window, 'showToast', { configurable: true, get: () => keep(), set: () => {} });
    try {
      localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1');
      localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); localStorage.setItem('stryker_broker_sync_user_u1', US);
    } catch (e) {}
  }, { t: theme, US, who: who || 'admin' });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route('**/api/chart/bars/**', (r) => {
    const u = new URL(r.request().url()), tf = Number(u.searchParams.get('tf') || 1), P = 8 * 3600, now = Math.floor(Date.now() / 1000);
    const page = u.searchParams.has('page') ? Number(u.searchParams.get('page')) : Math.floor(now / P);
    if (!/NQ|EURUSD/.test(u.pathname) || tf !== 1 || page < Math.floor(now / P) - 12) return r.fulfill({ json: { bars: [] } });
    const bars = []; for (let t = page * P; t < (page + 1) * P && t <= now; t += 60) bars.push([t, 28749.5, 28751.5, 28748.5, 28750, 100]);
    return r.fulfill({ json: { s: 'NQ', tf: '1', page, bars, rt: true } });
  });
  // Sample data: one hosted MT5 account (trading) and one read-only; every /connect/* call is answered here
  const HID = 'a1b2c3d4e5f60718', RID = '0f1e2d3c4b5a6978';
  const M = { calls: [], positions: [], orders: [], linked: [{ id: HID, platform: 'mt5', login: '5551234', server: 'Sample-Live', mode: 'trading', state: 'linked', name: 'Sample Trader', currency: 'USD' }] };
  const j = (o, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(o) });
  await ctx.route('**/api/beta/status', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ beta: who === 'beta' || who === 'admin', admin: who === 'admin' }) }));
  await ctx.route('**/connect/mt/**', async (r) => {
    const u = new URL(r.request().url()); let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    M.calls.push({ path: u.pathname, body });
    if (u.pathname.endsWith('/accounts')) return r.fulfill(j({ accounts: M.linked }));
    if (u.pathname.endsWith('/servers')) { const q = (u.searchParams.get('q') || '').toLowerCase(); return r.fulfill(j({ servers: ['MetaQuotes-Demo', 'Sample-Demo', 'Sample-Live'].filter((s) => s.toLowerCase().includes(q)) })); }
    if (u.pathname.endsWith('/link')) { if (body.password === 'bad') return r.fulfill(j({ error: 'x', code: 'bad_credentials' }, 422)); if (body.password === 'restart') return r.fulfill(j({ error: 'MetaTrader connection is restarting. Try again in a minute.', code: 'restarting' }, 503)); await sleep(700); const a = { id: RID, platform: 'mt5', login: body.login, server: body.server, mode: body.mode, state: 'linked', name: 'Sample', currency: 'USD' }; M.linked.push(a); return r.fulfill(j({ account: a, account_info: { balance: 1000, equity: 1000, currency: 'USD' } })); }
    if (u.pathname.endsWith('/unlink')) { M.linked = M.linked.filter((x) => x.id !== body.accountId); return r.fulfill(j({ ok: true })); }
    if (u.pathname.endsWith('/op')) {
      if (body.op === 'account') return r.fulfill(j({ ok: true, balance: 1000, equity: 1002.5, profit: 2.5, currency: 'USD' }));
      if (body.op === 'live') return r.fulfill(j({ ok: true, positions: M.positions, orders: M.orders }));
      if (body.op === 'symbols') return r.fulfill(j({ ok: true, symbols: ['EURUSD', 'GBPUSD', 'NDX100', 'XAUUSD'] }));
      if (body.op === 'place') { M.positions = [{ ticket: 9001, symbol: body.args.symbol, type: body.args.side === 'buy' ? 0 : 1, volume: body.args.volume, price_open: 1.1, price_current: 1.1, sl: body.args.sl || 0, tp: body.args.tp || 0, profit: 0, time: Math.floor(Date.now() / 1000) }]; return r.fulfill(j({ ok: true, retcode: 10009, order: 9001, comment: 'Request executed' })); }
      if (body.op === 'close') { M.positions = []; return r.fulfill(j({ ok: true, retcode: 10009, order: 9002 })); }
      return r.fulfill(j({ ok: true }));
    }
    return r.fulfill(j({ error: 'Not allowed' }, 400));
  });
  await ctx.route('**/connect/finatic/**', async (r) => {
    const u = new URL(r.request().url()); let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    M.calls.push({ path: u.pathname, body });
    if (u.pathname.endsWith('/data')) return r.fulfill(j({ error: 'Not connected yet', code: 'needs_connect', needsConnect: true }, 409));
    if (u.pathname.endsWith('/order') && body.op === 'env') return r.fulfill(j({ env: 'live', enabled: true, consent: true, version: '2026-11-21', blocked: false }));
    return r.fulfill(j({ configured: true }));
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|Failed to load resource|Ping received|Unexpected response code|WebSocket/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkPaper, null, { timeout: 60000 });
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('fx:EURUSD'); ws.active.setTimeframe('1'); await new Promise((r) => setTimeout(r, 1500)); });
  if (who === 'member') {   // GATE: a normal member never reaches the hosted MetaTrader (no /connect/mt call, no hosted sign-in sheet)
    await sleep(6000);
    check(!(await p.evaluate(() => !!window.__stkMtHost)), tag + ': member: hosted MetaTrader is off');
    check(!M.calls.some((c) => c.path.includes('/connect/mt/')), tag + ': member: no call to /connect/mt/*', M.calls.map((c) => c.path));
    check(!(await p.evaluate(() => !!(window.__stkLive && window.__stkLive.state && window.__stkLive.state.accounts.some((a) => a.host)))), tag + ': member: no hosted account listed');
    await p.evaluate(() => window.__stkPaper.openTradeMenu()); await sleep(600);
    await p.screenshot({ path: OUT + '/mtc-' + tag + '-menu.png' });
    const con = await p.$('#stkc-trade-pop [data-a=connect]');
    // members have the broker pause on today (no Connect button): open the same sheet directly to check the tiles
    if (con) await con.click(); else await p.evaluate(async () => { const v = [...document.scripts].map((x) => x.src).concat([...document.querySelectorAll('link[rel=modulepreload]')].map((l) => l.href)).join(' ').match(/v=(\d+)/); const m = await import('/assets/finatic-journal-ui.js' + (v ? '?v=' + v[1] : '')); m.openBrokerSync({ uid: 'm1', onConnected: () => {} }); });
    if (await p.waitForSelector('#fjs .fjs-tile', { timeout: 8000 }).then(() => true, () => false)) { await sleep(500);
      const tiles = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#fjs .fjs-tile')].map((t) => [t.dataset.broker, { soon: t.getAttribute('aria-disabled') === 'true' && /Coming soon/.test(t.innerText) }])));
      check(tiles['metatrader-5'] && tiles['metatrader-5'].soon, tag + ': member: MetaTrader 5 tile says Coming soon', tiles);
      check(tiles['metatrader-4'] && !tiles['metatrader-4'].soon, tag + ': member: MetaTrader 4 tile still open (Advanced / EA path)', tiles);
      check(tiles['ninjatrader'] && tiles['ninjatrader'].soon, tag + ': member: NinjaTrader tile says Coming soon', tiles);
      await p.screenshot({ path: OUT + '/mtc-' + tag + '-tiles.png' });
      const t = await p.$('#fjs .fjs-tile[data-broker="metatrader-5"]'); if (t) { await p.evaluate(() => { window.open = () => null; }); await t.click({ force: true }).catch(() => {}); await sleep(800); } }
    check(!(await p.$('#mtc')), tag + ': member: no hosted MetaTrader sign-in sheet');
    check(errors.length === 0, tag + ': no console errors ' + errors.slice(0, 2).join(' | '));
    await ctx.close(); return;
  }
  await p.waitForFunction(() => window.__stkLive && window.__stkLive.pick && window.__stkLive.state.accounts.length, null, { timeout: 20000 });
  const wait = (fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms || 10000 }).then(() => true, () => false);
  const hostWrites = () => M.calls.filter((c) => c.path.endsWith('/mt/op') && ['place', 'cancel', 'modify', 'close'].includes(c.body.op)).map((c) => c.body);
  const rect = (sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, cy: (r.top + r.bottom) / 2, w: r.width, h: r.height }; }, sel);

  // ---- Trade menu: hosted account listed like the other brokers
  await p.evaluate(() => window.__stkPaper.openTradeMenu());
  await p.waitForSelector('#stkc-trade-pop:not([hidden]) .stktm-pick', { timeout: 5000 });
  const row = await p.evaluate(() => { const r = document.querySelector('#stkc-trade-pop [data-a=live]'); const c = r && (r.closest('.stktm-row') || r); return c ? { t: c.innerText.replace(/\s+/g, ' '), id: r.dataset.id } : null; });
  check(row && /MetaTrader 5/.test(row.t) && /5551234/.test(row.t) && /^mt:/.test(row.id), tag + ': Trade menu lists the hosted MT5 account', row);
  await p.screenshot({ path: OUT + '/mtc-' + tag + '-1-menu.png' });
  await p.evaluate((id) => document.querySelector('#stkc-trade-pop [data-a=live][data-id="' + id + '"]').click(), row.id);
  await wait(() => window.__stkLive.state.acct && window.__stkLive.state.acct.host && window.__stkLive.state.lastOkStart > 0 && window.__stkLive.state.placeSchema);
  check(await p.evaluate(() => window.__stkLive.state.acct.hostId) === HID, tag + ': hosted account picked, host id set');
  check(await p.evaluate(() => JSON.stringify(window.__stkLive.state.placeSchema).includes('EURUSD')), tag + ': symbol list read from the host');
  check(await wait(() => { const b = window.__stkLive.state.bal['mt:a1b2c3d4e5f60718']; return b && b.snap && Math.abs(b.snap.amount - 1002.5) < 1e-6; }), tag + ': balance = equity from the host');
  await p.evaluate(() => { const m = document.getElementById('stkc-trade-pop'); if (m) m.hidden = true; });
  await p.evaluate(() => window.__stkPaper.orderPanel && window.__stkPaper.orderPanel());
  await wait(() => { const o = document.getElementById('stkop'); return o && !o.hidden && o.getBoundingClientRect().height > 100; });
  await p.evaluate(() => { const t = document.querySelector('#stkop .stkop-tabs [data-tab=scalp]'); if (t) t.click(); });
  check(await wait(() => window.__stkLive.blockReason === '' && !window.__stkLive.state.busy), tag + ': orders allowed (no block reason)', await p.evaluate(() => window.__stkLive.blockReason));
  await p.screenshot({ path: OUT + '/mtc-' + tag + '-2-panel.png' });
  // order with stop loss + take profit -> goes to the host with slPrice / tpPrice, symbol from the picker
  const px0 = await p.evaluate(() => window.__stkLive.info('fx:EURUSD').last); console.log('LAST', px0);
  const SL = Number((px0 * 0.99).toFixed(5)), TP = Number((px0 * 1.01).toFixed(5));
  const sent = await p.evaluate(async ([SL, TP]) => { const lv = window.__stkLive; return await lv.placeTicket('fx:EURUSD', { side: 'buy', type: 'market', qty: 0.1, sl: SL, tp: TP }, 'test').then((r) => ({ r }), (e) => ({ e: String(e && e.message) })); }, [SL, TP]);
  console.log('TOASTS', JSON.stringify(await p.evaluate(() => window.__toasts.slice(-3))), JSON.stringify(sent).slice(0, 200));
  const W = hostWrites();
  check(W.length === 1 && W[0].op === 'place' && W[0].args.volume === 0.1 && W[0].args.sl === SL && W[0].args.tp === TP && W[0].args.side === 'buy' && /^[A-Za-z0-9-]{16,64}$/.test(W[0].idemKey || ''), tag + ': market order with stop loss and take profit sent to the host', { W, sent });
  check(await wait(() => window.__stkLive.info('fx:EURUSD') && window.__stkLive.info('fx:EURUSD').pos.qty === 0.1), tag + ': position read back (0.1 lot)', await p.evaluate(() => ({ t: window.__toasts.slice(-3), i: !!window.__stkLive.info('fx:EURUSD') })));
  // close
  await p.evaluate(() => window.__stkLive.flatten('fx:EURUSD'));
  for (let i = 0; i < 120 && !hostWrites().some((w) => w.op === 'close'); i++) await sleep(100);
  check(hostWrites().some((w) => w.op === 'close' && w.args.ticket === '9001'), tag + ': close sends the position ticket');
  // read-only account: orders refused client side
  await p.evaluate(() => { const s = window.__stkLive.state; s.acct.readOnly = true; });
  check(await p.evaluate(() => /read-only/.test(window.__stkLive.blockReason)), tag + ': investor account is blocked with a plain reason');
  await p.evaluate(() => { window.__stkLive.state.acct.readOnly = false; });

  // ---- sign-in sheet
  await p.evaluate(() => { document.getElementById('stkc-trade-pop') && (document.getElementById('stkc-trade-pop').hidden = true); window.__stkPaper.openTradeMenu(); });
  await p.waitForSelector('#stkc-trade-pop [data-a=connect]', { timeout: 5000 });
  await p.click('#stkc-trade-pop [data-a=connect]');
  await p.waitForSelector('#fjs .fjs-tile', { timeout: 10000 });
  await p.screenshot({ path: OUT + '/mtc-' + tag + '-3-tiles.png' });
  check(await p.evaluate(() => { const t = document.querySelector('#fjs .fjs-tile[data-broker="metatrader-5"]'); return t && t.getAttribute('aria-disabled') !== 'true' && !/Coming soon/.test(t.innerText); }), tag + ': admin/beta: MetaTrader 5 tile is open');
  await p.click('#fjs .fjs-tile[data-broker="metatrader-5"]');
  await p.waitForSelector('#mtc #mtc-server', { timeout: 10000 });
  check(await p.evaluate(() => !document.querySelector('#fjs')), tag + ': tile opens the MetaTrader sheet, portal sheet closed');
  await sleep(500);
  await p.screenshot({ path: OUT + '/mtc-' + tag + '-4-sheet.png' });
  // server search
  await p.fill('#mtc-server', 'sample'); await wait(() => document.querySelectorAll('#mtc-list button').length === 2);
  const opts = await p.evaluate(() => [...document.querySelectorAll('#mtc-list button')].map((b) => b.textContent));
  check(opts.join() === 'Sample-Demo,Sample-Live', tag + ': server search filters by name', opts);
  await p.screenshot({ path: OUT + '/mtc-' + tag + '-5-search.png' });
  await p.click('#mtc-list button:nth-child(1)', { force: true }).catch(() => {});
  await p.evaluate(() => { const b = document.querySelector('#mtc-list button'); if (b) b.click(); });
  check(await p.inputValue('#mtc-server') === 'Sample-Demo', tag + ': picking a server fills the field');
  // validation + wrong password
  await p.fill('#mtc-login', '12ab'); await p.click('#mtc-go');
  check(await p.evaluate(() => /number your broker/.test(document.querySelector('#mtc-err').innerText)), tag + ': bad login says so');
  await p.fill('#mtc-login', '777'); await p.fill('#mtc-pw', 'bad'); await p.click('#mtc-go');
  check(await wait(() => /Login, password or server is not right/.test(document.querySelector('#mtc-err').innerText)), tag + ': wrong password shows a clear error');
  check(await wait(() => getComputedStyle(document.querySelector('#mtc-prog')).display === 'none'), tag + ': progress line hidden after an error');
  await p.screenshot({ path: OUT + '/mtc-' + tag + '-6-error.png' });
  // the tunnel is restarting (quick tunnel got a new address): a friendly line, never a raw error
  await p.fill('#mtc-pw', 'restart'); await p.click('#mtc-go');
  check(await wait(() => /^MetaTrader connection is restarting\. Try again in a minute\.$/.test(document.querySelector('#mtc-err').innerText.trim())), tag + ': host restarting shows the friendly line');
  check(await wait(() => getComputedStyle(document.querySelector('#mtc-prog')).display === 'none'), tag + ': progress hidden after restarting');
  await p.screenshot({ path: OUT + '/mtc-' + tag + '-6b-restarting.png' });
  check(await p.evaluate(() => document.querySelector('#mtc-pw').type === 'password' && !document.querySelector('#mtc-pw').disabled), tag + ': password field is a password field and usable again');
  // read-only switch + success with progress
  await p.click('#mtc-ro');
  check(await p.getAttribute('#mtc-ro', 'aria-checked') === 'true', tag + ': read-only switch on');
  await p.fill('#mtc-pw', 'goodpass'); await p.click('#mtc-go');
  await p.waitForSelector('#mtc-prog:not([hidden])', { timeout: 3000 });
  await p.screenshot({ path: OUT + '/mtc-' + tag + '-7-progress.png' });
  check(await wait(() => !document.querySelector('#mtc'), null, 8000), tag + ': sheet closes after the link');
  const L = M.calls.find((c) => c.path.endsWith('/link')); const lastLink = M.calls.filter((c) => c.path.endsWith('/link')).pop();
  check(lastLink.body.mode === 'investor' && lastLink.body.platform === 'mt5' && lastLink.body.server === 'Sample-Demo' && lastLink.body.login === '777', tag + ': link body: investor mode, mt5, server, login', lastLink.body);
  await p.evaluate(() => window.__stkLive.loadAccounts());
  check(await wait((id) => window.__stkLive.state.accounts.some((a) => a.hostId === id && a.readOnly), RID), tag + ': new read-only account appears in the list');
  check(await p.evaluate(() => !JSON.stringify(Object.assign({}, localStorage)).includes('goodpass')), tag + ': password is not kept in the browser');

  // ---- measurements of the sheet (alignment gate)
  await p.evaluate(() => { document.getElementById('stkc-trade-pop') && (document.getElementById('stkc-trade-pop').hidden = true); });
  await p.evaluate(() => window.__stkPaper.openTradeMenu()); await p.click('#stkc-trade-pop [data-a=connect]'); await p.waitForSelector('#fjs .fjs-tile');
  await p.click('#fjs .fjs-tile[data-broker="metatrader-5"]'); await p.waitForSelector('#mtc #mtc-server'); await sleep(450);
  const m = await p.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, h: b.height, w: b.width, cy: (b.top + b.bottom) / 2 }; };
    const sh = r('#mtc'), f = ['#mtc-server', '#mtc-login', '#mtc-pw', '#mtc-ro', '#mtc-go'].map(r);
    const knob = r('#mtc-ro .mtc-knob'), sw = r('#mtc-ro'), txt = r('#mtc-ro .mtc-tx');
    const clip = [...document.querySelectorAll('#mtc input, #mtc button, #mtc small, #mtc span, #mtc p')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible' && e.clientWidth > 0).map((e) => e.className || e.tagName);
    return { sheet: sh, padL: f.map((x) => Math.round(x.l - sh.l)), padR: f.map((x) => Math.round(sh.r - x.r)), h: f.map((x) => Math.round(x.h)), knobDy: knob.cy - sw.cy, txtDy: txt.cy - sw.cy, knobPadR: sw.r - knob.r, hscroll: document.documentElement.scrollWidth > innerWidth + 1, clip, gaps: f.slice(1).map((x, i) => Math.round(x.t - f[i].b)), top: sh.t, vh: innerHeight };
  });
  console.log('ALIGN-SHEET ' + tag + ' ' + JSON.stringify(m));
  check(new Set(m.padL).size === 1 && new Set(m.padR).size === 1 && Math.abs(m.padL[0] - m.padR[0]) <= 1, tag + ': fields share left and right padding inside the sheet', m);
  check(Math.abs(m.knobDy) <= 1 && Math.abs(m.txtDy) <= 1, tag + ': switch knob and text centred in the row (<=1 px)', m);
  check(m.h[0] >= 48 && m.h[1] >= 48 && m.h[2] >= 48 && m.h[3] >= 48 && m.h[4] >= 48, tag + ': every control is at least 48 px tall', m.h);
  check(!m.hscroll && m.clip.length === 0, tag + ': no horizontal scroll, nothing clipped', m);
  const fz = await p.evaluate(() => ['#mtc-server', '#mtc-login', '#mtc-pw'].map((s) => parseFloat(getComputedStyle(document.querySelector(s)).fontSize)));
  check(fz.every((x) => x >= 16), tag + ': inputs are 16 px (no iOS zoom)', fz);
  check(!(await p.evaluate(() => /finatic|vela|luxalgo/i.test(document.body.innerText))), tag + ': no vendor name on screen');
  check(await p.evaluate(() => /Advanced: use your own MetaTrader/.test(document.querySelector('#mtc').innerText) && document.querySelector('#mtc .mtc-adv a').getAttribute('href') === '/help/connect-broker-metatrader-5'), tag + ': Advanced link to the own-terminal guide');
  await p.screenshot({ path: OUT + '/mtc-' + tag + '-8-final.png' });
  { const sh = await p.$('#mtc'); if (sh) await sh.screenshot({ path: OUT + '/crop-mtc-' + tag + '-sheet.png' }); }
  check(errors.length === 0, tag + ': no console errors ' + errors.slice(0, 2).join(' | '));
  await ctx.close();
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    const only = process.env.ONLY || '';
    for (const [w, h, mobile, theme, who] of [[1440, 900, false, 'dark', 'admin'], [1440, 900, false, 'light', 'beta'], [412, 915, true, 'dark', 'beta'], [412, 915, true, 'light', 'admin'], [390, 844, true, 'dark', 'admin'], [390, 844, true, 'light', 'beta'], [1440, 900, false, 'dark', 'member'], [390, 844, true, 'dark', 'member']]) if (!only || only === w + '-' + theme + '-' + who) await run(b, w, h, mobile, theme, who);
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
