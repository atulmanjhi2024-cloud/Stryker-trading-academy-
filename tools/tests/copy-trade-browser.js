// COPY TRADING panel (assets/chart-copy.js) browser test. EVERY /connect/finatic/* call is answered by a local mock: no request leaves
// 127.0.0.1, no real order can be sent. 1440 + 390, dark + light.
//   node tools/tests/chart-dev-server.mjs 8031 &   CHART_BASE=http://127.0.0.1:8031 node tools/tests/copy-trade-browser.js <shotsDir>
// Checks: Trade menu > Copy trading opens the panel; leader + followers (live + Paper) listed, the leader is never a follower; the
// "Copies orders you place in TradeZoro" line; first turn-on asks the one-line confirm and sends consent; a leader order goes to the copy
// route; per-account toasts + status list (sent / rejected with the broker's message); Paper follower placed on the paper engine;
// Pause / Flatten all copied; alignment numbers (getBoundingClientRect); no horizontal scroll at 390.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp/copytrade';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 600) : '')); };
const A1 = '123e4567-e89b-12d3-a456-426614174001', A2 = '123e4567-e89b-12d3-a456-426614174002', A3 = '123e4567-e89b-12d3-a456-426614174003', US = '0aaa1111-2222-3333-4444-555566667777';

async function open(b, { w, h, mobile, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(({ t, US }) => {
    window.__stkLiveTest = { isAdmin: () => false, last: () => 28750, fastRetry: true };
    window.__toasts = []; const keep = () => (ty, m) => { window.__toasts.push(String(m)); return Promise.resolve(); };
    Object.defineProperty(window, 'showToast', { configurable: true, get: () => keep(), set: () => {} });
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); localStorage.setItem('stryker_broker_sync_user_u1', US); } catch (e) {}
  }, { t: theme, US });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route('**/api/chart/bars/**', (r) => {
    const u = new URL(r.request().url()), tf = Number(u.searchParams.get('tf') || 1), P = 8 * 3600, now = Math.floor(Date.now() / 1000);
    const page = u.searchParams.has('page') ? Number(u.searchParams.get('page')) : Math.floor(now / P);
    if (!/NQ/.test(u.pathname) || tf !== 1 || page < Math.floor(now / P) - 12) return r.fulfill({ json: { bars: [] } });
    const bars = []; for (let t = page * P; t < (page + 1) * P && t <= now; t += 60) { const c = 28750; bars.push([t, c - 0.5, c + 1.5, c - 1.5, c, 100]); }
    return r.fulfill({ json: { s: 'NQ', tf: '1', page, bars, rt: true } });
  });
  // the mock plays functions/connect/finatic/copy.js + order.js (sample data; nothing real)
  const M = { calls: [], cfg: { on: false, paused: false, leader: '', followers: [], consented: false }, n: 0 };
  const j = (o, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(o) });
  await ctx.route('**/connect/finatic/**', async (r) => {
    const u = new URL(r.request().url()); let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    M.calls.push({ path: u.pathname, body });
    if (u.pathname.endsWith('/session')) return r.fulfill(j({ configured: true }));
    if (u.pathname.endsWith('/data')) {
      if (body.op === 'accounts') return r.fulfill(j({ userId: US, data: [
        { accountId: A1, accountName: 'SAMPLE-LEAD-1001', accountNumber: '70001001', brokerName: 'tradovate' },
        { accountId: A2, accountName: 'SAMPLE-PROP-2002', accountNumber: '70002002', brokerName: 'tradovate' },
        { accountId: A3, accountName: 'SAMPLE-EVAL-3003', accountNumber: '3003', brokerName: 'ninjatrader' }] }));
      if (body.op === 'live') return r.fulfill(j({ data: { positions: [], orders: [] } }));
      return r.fulfill(j({ data: [] }));
    }
    if (u.pathname.endsWith('/copy')) {
      if (body.op === 'get') return r.fulfill(j({ ok: true, cfg: M.cfg }));
      if (body.op === 'save') {
        if (body.cfg.on && !M.cfg.consented && !(body.consent === true && body.version === '2026-11-21')) return r.fulfill(j({ error: 'Confirm copy trading once before you turn it on.', code: 'copy_consent_needed' }, 403));
        M.cfg = Object.assign({}, body.cfg, { consented: M.cfg.consented || !!body.consent }); return r.fulfill(j({ ok: true, cfg: M.cfg }));
      }
      if (body.op === 'pause' || body.op === 'resume') { M.cfg.paused = body.op === 'pause'; return r.fulfill(j({ ok: true, cfg: M.cfg })); }
      if (body.op === 'flattenAll') return r.fulfill(j({ ok: true, copy: { results: M.cfg.followers.map((f) => f.id === 'paper' ? { id: 'paper', state: 'paper', paper: { op: 'flatten', symbol: body.symbol } } : { id: f.id, state: 'sent', message: '' }) } }));
      if (body.op === 'sync') return r.fulfill(j({ ok: true, copy: { results: [] } }));
      if (body.op === 'fan') {
        const L = body.lead; M.n++;
        const results = M.cfg.followers.filter((f) => f.on).map((f) => f.id === 'paper' ? { id: 'paper', state: 'paper', paper: { op: 'place', symbol: L.symbol, side: L.side, qty: L.qty, type: L.type } }
          : f.id === A3 ? { id: A3, state: 'rejected', message: 'Insufficient margin (sample broker message)' } : { id: f.id, state: 'sent', orderId: 'f' + M.n, message: 'Broker status: submitted', symbol: L.symbol, qty: L.qty });
        return r.fulfill(j({ ok: true, accepted: true, orderId: 'o' + M.n, status: 'SUBMITTED', copy: { results } }));
      }
    }
    if (u.pathname.endsWith('/order')) {
      if (body.op === 'env') return r.fulfill(j({ env: 'live', enabled: true, consent: true, blocked: false, version: '2026-11-21' }));
      if (body.op === 'schema') return r.fulfill(j({ data: { fields: { symbol: {}, orderQty: {} } }, env: 'live' }));
      if (body.op === 'bracket') return r.fulfill(j({ ok: true, group: null, did: 'ok' }));
      if (body.op === 'place') { M.n++; return r.fulfill(j({ ok: true, accepted: true, orderId: 'o' + M.n, status: 'SUBMITTED' })); }
    }
    return r.fulfill(j({ error: 'Not allowed' }, 400));
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|Failed to load resource|WebSocket|Unexpected response/.test(m.text())) errors.push(m.text()); });
  p.on('dialog', (d) => d.dismiss());
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkPaper, null, { timeout: 60000 });
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1'); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.market.symbol === 'futures:NQ1!') break; } });
  await p.waitForFunction(() => window.__stkLive && window.__stkLive.state && window.__stkLive.state.accounts.length === 3 && window.__stkCopy && window.__stkCopy.state.loaded, null, { timeout: 30000 }).catch(async (e) => { console.log('DBG', JSON.stringify(await p.evaluate(() => ({ live: !!window.__stkLive, n: window.__stkLive && window.__stkLive.state.accounts.length, copy: !!window.__stkCopy, cs: window.__stkCopy && window.__stkCopy.state }))), errors, M.calls.map((c) => c.path + ':' + c.body.op)); throw e; });
  return { ctx, p, errors, M };
}
const wait = (p, fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms || 8000 }).then(() => true, () => false);
// alignment of the open panel: centres in rows, paddings in pills, overflow
const align = (p) => p.evaluate(() => {
  const R = (e) => e.getBoundingClientRect(), out = { issues: [] };
  const box = document.querySelector('.stkcp-box'); if (!box) return { issues: ['no panel'] };
  const vis = (e) => e.offsetParent !== null && R(e).width > 0;
  // header: title, chip, close share one centre
  const hd = [...document.querySelectorAll('.stkcp-hd > *')].filter(vis).map((e) => R(e).top + R(e).height / 2);
  out.hdSpread = Math.round((Math.max(...hd) - Math.min(...hd)) * 10) / 10; if (out.hdSpread > 1) out.issues.push('header centres ' + out.hdSpread);
  // toggle rows: switch, name, tag share one centre
  document.querySelectorAll('.stkcp-tg').forEach((t) => { const c = [...t.children].filter((e) => vis(e) && e.tagName !== 'INPUT').map((e) => R(e).top + R(e).height / 2); const s = Math.max(...c) - Math.min(...c); if (s > 1) out.issues.push('toggle row centres ' + s.toFixed(1)); });
  // footer buttons: one row of equal height, text centred
  const ft = [...document.querySelectorAll('.stkcp-ft .stkcp-btn')].filter(vis).map(R);
  out.ft = ft.map((b) => [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]);
  // pills / chips: even padding left/right (text node inside)
  document.querySelectorAll('.stkcp-chip, .stkcp-st, .stkcp-btn, .stkcp-seg button').forEach((e) => { if (!vis(e)) return; const r = document.createRange(); r.selectNodeContents(e); const t = r.getBoundingClientRect(), b = R(e); if (!t.width) return; const l = t.left - b.left, rr = b.right - t.right, tp = t.top - b.top, bt = b.bottom - t.bottom; if (Math.abs(l - rr) > 1) out.issues.push('pad L/R ' + e.className + ' "' + e.textContent.trim() + '" ' + l.toFixed(1) + '/' + rr.toFixed(1)); if (Math.abs(tp - bt) > 1) out.issues.push('pad T/B ' + e.className + ' ' + tp.toFixed(1) + '/' + bt.toFixed(1)); if (e.scrollWidth > e.clientWidth + 1) out.issues.push('clipped ' + e.textContent.trim()); });
  // close icon centred in its button
  { const x = document.querySelector('.stkcp-x'), s = x.querySelector('svg'), a = R(x), c = R(s); const dx = (c.left + c.width / 2) - (a.left + a.width / 2), dy = (c.top + c.height / 2) - (a.top + a.height / 2); if (Math.abs(dx) > 1 || Math.abs(dy) > 1) out.issues.push('close icon off ' + dx.toFixed(1) + ',' + dy.toFixed(1)); }
  // no text overflow inside the panel
  box.querySelectorAll('.stkcp-nm, .stkcp-l, .stkcp-hint, .stkcp-lw b').forEach((e) => { if (vis(e) && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow !== 'ellipsis') out.issues.push('overflow ' + e.className); });
  out.hscroll = document.documentElement.scrollWidth > window.innerWidth + 1 || box.scrollWidth > box.clientWidth + 1;
  if (out.hscroll) out.issues.push('horizontal scroll');
  // status list times use tabular digits
  const t = document.querySelector('.stkcp-t'); if (t && getComputedStyle(t).fontVariantNumeric.indexOf('tabular-nums') < 0) out.issues.push('times not tabular');
  out.box = [Math.round(R(box).width), Math.round(R(box).height)];
  return out;
});

async function run(b, w, h, mobile, theme) {
  const tag = w + '-' + theme;
  const { ctx, p, errors, M } = await open(b, { w, h, mobile, theme });
  // Trade menu > Copy trading
  await p.evaluate(() => window.__stkPaper.openTradeMenu());
  check(await wait(p, () => !!document.querySelector('#stkc-trade-pop:not([hidden]) [data-x=copytrade]')), tag + ': Trade menu has Copy trading');
  if (theme === 'dark') { await sleep(300); await p.screenshot({ path: OUT + '/' + tag + '-menu.png' }); }
  await p.evaluate(() => document.querySelector('#stkc-trade-pop [data-x=copytrade]').click());
  check(await wait(p, () => !!document.querySelector('#stkcp .stkcp-box')), tag + ': panel opens');
  const lst = await p.evaluate(() => ({ leader: document.querySelector('[data-f=leader]').value, opts: [...document.querySelectorAll('[data-f=leader] option')].length, rows: [...document.querySelectorAll('.stkcp-row')].map((r) => r.dataset.row), note: document.querySelector('.stkcp-note').textContent, help: !!document.querySelector('.stkcp-note a[href="/help/copy-trading"]') }));
  check(lst.opts === 3 && lst.rows.length === 3 && !lst.rows.includes(lst.leader) && lst.rows.includes('paper'), tag + ': leader + 2 live followers + Paper, leader never a follower', lst);
  check(/Copies orders you place in TradeZoro/.test(lst.note) && /not copied/.test(lst.note) && lst.help, tag + ': says broker-platform orders are not copied + help link', lst.note);
  // set up: A2 multiplier 0.5 micro, A3 fixed 1, Paper same
  await p.evaluate(({ A2, A3 }) => {
    const row = (id) => document.querySelector('.stkcp-row[data-row="' + id + '"]');
    const on = (id) => { const c = row(id).querySelector('[data-f=on]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); };
    on(A2); on(A3); on('paper');
    row(A2).querySelector('[data-k=mode][data-v=mult]').click();
    const i = row(A2).querySelector('[data-f=mult]'); i.value = '0.5'; i.dispatchEvent(new Event('input', { bubbles: true }));
    const s = row(A2).querySelector('[data-f=map]'); s.value = 'micro'; s.dispatchEvent(new Event('change', { bubbles: true }));
    row(A3).querySelector('[data-k=mode][data-v=fixed]').click();
    const m = document.querySelector('[data-f=main]'); m.checked = true; m.dispatchEvent(new Event('change', { bubbles: true }));
  }, { A2, A3 });
  await sleep(200);
  let al = await align(p);
  check(al.issues.length === 0, tag + ': alignment (setup)', al);
  console.log('ALIGN ' + tag + ' setup ' + JSON.stringify(al));
  await p.screenshot({ path: OUT + '/' + tag + '-setup.png' });
  // Save -> first time = the one-line confirm
  await p.click('.stkcp-ft [data-k=save]');
  check(await wait(p, () => !!document.querySelector('.stkcp-cf')), tag + ': first turn-on asks the copy confirm');
  const cfText = await p.evaluate(() => document.querySelector('.stkcp-cf p').textContent);
  check(/real orders on every follower/.test(cfText) && /Prop firms may have rules/.test(cfText), tag + ': confirm says real orders + prop firm rules', cfText);
  await p.screenshot({ path: OUT + '/' + tag + '-confirm.png' });
  await p.click('.stkcp-cf [data-k=cf-yes]');
  check(await wait(p, () => window.__stkCopy.state.cfg && window.__stkCopy.state.cfg.on && window.__stkCopy.state.cfg.consented), tag + ': saved with consent');
  const saved = M.calls.filter((c) => c.path.endsWith('/copy') && c.body.op === 'save').pop().body;
  check(saved.consent === true && saved.cfg.leader === A1 && saved.cfg.followers.find((f) => f.id === A2).mult === 0.5 && saved.cfg.followers.find((f) => f.id === A2).map === 'micro' && saved.cfg.followers.find((f) => f.id === A3).mode === 'fixed', tag + ': save body (rules per follower)', saved);
  // close, pick the leader in the Trade menu, Scalp Buy 1 on the order panel: it goes to the copy route
  await p.click('.stkcp-x');
  await p.evaluate(() => window.__stkPaper.orderPanel());
  await wait(p, () => { const o = document.getElementById('stkop'); return o && !o.hidden; });
  await p.evaluate(() => window.__stkPaper.openTradeMenu());
  await p.waitForSelector('#stkc-trade-pop:not([hidden]) .stktm-pick', { timeout: 5000 });
  await p.evaluate((id) => document.querySelector('#stkc-trade-pop [data-a=live][data-id="' + id + '"]').click(), A1);
  await wait(p, () => document.querySelector('#stkop.is-live') && window.__stkLive.state.placeSchema && window.__stkLive.blockReason === '', null, 15000);
  await p.evaluate(() => { const MH = window.StrykerMarketHours; MH.futuresStatus = () => ({ open: true, until: Date.now() + 3600e3 }); window.__stkPaper.setEnabled(true); window.__stkPaper.account.setLast('futures:NQ1!', 28750); });
  const paperBefore = await p.evaluate(() => { const a = window.__stkPaper.account; return a ? Object.keys(a.state.positions || {}).length + (a.state.history || []).length + (a.state.orders || []).length : -1; });
  const n0 = await p.evaluate(() => window.__toasts.length);
  await (mobile ? p.tap('#stkop .stkop-scalp [data-a=buy]') : p.click('#stkop .stkop-scalp [data-a=buy]'));
  if (await p.waitForSelector('#stklv-cf', { timeout: 2000 }).then(() => true, () => false)) await p.click('#stklv-cf [data-k=yes]');
  for (let i = 0; i < 50 && !M.calls.some((c) => c.body.op === 'fan'); i++) await sleep(100);
  const r = true;
  const fan = await wait(p, () => true).then(() => M.calls.filter((c) => c.path.endsWith('/copy') && c.body.op === 'fan'));
  check(r && fan.length === 1 && fan[0].body.lead.accountId === A1 && fan[0].body.lead.op === 'place', tag + ': leader order goes through the copy route', fan.map((x) => x.body));
  check(!M.calls.some((c) => c.path.endsWith('/order') && c.body.op === 'place'), tag + ': no direct second leader order');
  await wait(p, (n) => window.__toasts.length >= n + 3, n0, 5000);
  const ts = await p.evaluate((n) => window.__toasts.slice(n), n0);
  check(ts.some((t) => /Copy to .*SAMPLE-PROP-2002|Copy to .*2002/.test(t) && /Sent/.test(t)) && ts.some((t) => /Rejected/.test(t) && /Insufficient margin/.test(t)), tag + ': per-account toasts (sent + rejected with the broker message)', ts);
  const paperAfter = await p.evaluate(() => { const a = window.__stkPaper.account; return a ? Object.keys(a.state.positions || {}).length + (a.state.history || []).length + (a.state.orders || []).length : -1; });
  const plog = await p.evaluate(() => window.__stkCopy.state.log.filter((x) => x.id === 'paper').map((x) => x.state + ' ' + x.message));
  check(paperAfter > paperBefore && plog.some((x) => /^(sent|filled) /.test(x)), tag + ': Paper follower handled by the paper engine', { paperBefore, paperAfter, plog });
  // status list in the panel
  await p.evaluate(() => window.__stkCopy.open());
  await wait(p, () => !!document.querySelector('.stkcp-log li'));
  const st = await p.evaluate(() => [...document.querySelectorAll('.stkcp-log li')].map((li) => li.querySelector('.stkcp-st').textContent));
  check(st.includes('Sent') && st.includes('Rejected'), tag + ': status list shows sent / rejected', st);
  await p.evaluate(() => { const b = document.querySelector('.stkcp-body'); b.scrollTop = b.scrollHeight; });
  await sleep(150);
  al = await align(p);
  check(al.issues.length === 0, tag + ': alignment (status)', al);
  console.log('ALIGN ' + tag + ' status ' + JSON.stringify(al));
  await p.screenshot({ path: OUT + '/' + tag + '-status.png' });
  // pause
  await p.click('.stkcp-ft [data-k=pause]');
  check(await wait(p, () => window.__stkCopy.state.cfg.paused === true && !window.__stkCopy.active(window.__stkLive.state.acct.id)), tag + ': Pause copying (one tap)');
  // flatten all copied: asks, then one flattenAll call
  await p.click('.stkcp-ft [data-k=flat]');
  check(await wait(p, () => !!document.querySelector('.stkcp-cf')), tag + ': Flatten all copied asks first');
  await p.click('.stkcp-cf [data-k=cf-flat]');
  check(await wait(p, () => true).then(async () => { for (let i = 0; i < 30; i++) { if (M.calls.some((c) => c.body.op === 'flattenAll')) return true; await sleep(100); } return false; }), tag + ': flattenAll sent');
  check(errors.length === 0, tag + ': no page errors', errors);
  await ctx.close();
}

(async () => {
  const b = await launch({ args: ['--no-sandbox'] });
  try {
    for (const theme of ['dark', 'light']) {
      await run(b, 1440, 900, false, theme);
      await run(b, 390, 844, true, theme);
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
