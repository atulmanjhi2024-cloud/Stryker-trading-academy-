// Charts PRICE TAGS ON THE SCALE browser test (Owner bug 22 Nov 2026, assets/chart-axis-tags.js).
// Offline + deterministic (same mocks as chart-paper-trading-browser.js). NQ1! 1m, paper account only (no broker, no real orders):
//   paper position + TP + SL + limit order => 4 scale tags at the right y / colour / text; drag SL => its tag follows;
//   horizontal line => tag; "Price label on scale" off => no tag; trend line only while selected; collision nudge;
//   last-price tag never covered; no console errors. Shots 1440 dark + light, 390 dark.
//   flock /tmp/stryker-chrome.lock node tools/tests/chart-axistags-browser.js [shotsDir]
//   flock /tmp/stryker-chrome.lock node tools/tests/chart-paper-trading-browser.js [shotsDir]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { launch, ROOT } = require('./lib.js');
const stub = require('./richstub.js');

const OUT = process.argv[2] || '/tmp';
const T0 = Date.parse('2026-10-07T14:00:00Z'); // a Wednesday, CME Globex open (10:00 New York)
const MIN = 60000, H = 3600, D = 86400;
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let offset = 0;
const vnow = () => Date.now() + offset;
const NQ_BASE = 21000, BTC_BASE = 64000;
function hist(tMs, stepMs, base) {
  const i = Math.floor(tMs / stepMs);
  const o = base + 20 * Math.sin(i / 37), c = base + 20 * Math.sin((i + 1) / 37);
  return { t: i * stepMs, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 100 + (i % 50) };
}
const r4 = (x) => Math.round(x * 4) / 4;
// the price the test drives + the forming bar built from it
const px = { futures: null, binance: null };
const forming = { futures: null, binance: null };
function formingBar(kind, stepMs, base) {
  const now = vnow(), t = Math.floor(now / stepMs) * stepMs;
  if (px[kind] == null) px[kind] = hist(t - stepMs, stepMs, base).c;
  let f = forming[kind];
  if (!f || f.t !== t) f = forming[kind] = { t, o: px[kind], h: px[kind], l: px[kind], c: px[kind], v: 1 };
  f.c = px[kind]; f.h = Math.max(f.h, f.c); f.l = Math.min(f.l, f.c); f.v++;
  return f;
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webp': 'image/webp', '.ico': 'image/x-icon' };
function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      const u = new URL(req.url, 'http://x');
      let p = path.join(ROOT, decodeURIComponent(u.pathname));
      if (!p.startsWith(ROOT)) { rsp.writeHead(403); rsp.end(); return; }
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
      if (!fs.existsSync(p) && fs.existsSync(p + '.html')) p += '.html';
      if (!fs.existsSync(p)) { rsp.writeHead(404); rsp.end('nf'); return; }
      rsp.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
      // The live feed is the tick hub by default (2026-11-03); this test scripts ticks through the old /api/chart/stream mock, so serve the flag as 'is'.
      if (/\/live-source\.js$/.test(p)) { rsp.end(fs.readFileSync(p, 'utf8').replace("LIVE_SOURCE = 'hub'", "LIVE_SOURCE = 'is'")); return; }
      fs.createReadStream(p).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

const TF_MIN = { '1': 1, '5': 5, '15': 15, '30': 30, '60': 60, '120': 120, '240': 240, D: 1440 };
const PAGE_SECS = { '1': 8 * H, '5': 2 * D, '15': 5 * D, '30': 10 * D, '60': 20 * D, '120': 40 * D, '240': 60 * D, D: 730 * D };
const timers = [];
async function mockRoutes(ctx) {
  // Real-time futures are admin only since 2026-10-16 (assets/rt-access.js): a non-admin polls the
  // 10-min-delayed REST tail every 20 s, so the scripted ticks below never arrived. The paper engine is
  // the same on both feeds; the test rides the live stream as a realtime admin (faked server answer).
  await ctx.route(/\/api\/chart\/rt(\?|$)/, (r) => r.fulfill({ json: { admin: true }, headers: { 'cache-control': 'no-store' } }));
  await ctx.route(/\/api\/chart\/bars\//, (route) => {
    const u = new URL(route.request().url());
    const tf = u.searchParams.get('tf') || '1';
    const step = (TF_MIN[tf] || 1) * MIN;
    const page = Number(u.searchParams.get('page') || 0);
    const ps = PAGE_SECS[tf] || 8 * H;
    const cur = Math.floor(vnow() / step) * step;
    const from = page * ps * 1000, to = Math.min((page + 1) * ps * 1000, cur);
    const bars = [];
    for (let t = Math.ceil(from / step) * step; t < to; t += step) { const b = hist(t, step, NQ_BASE); bars.push([t / 1000, r4(b.o), r4(b.h), r4(b.l), r4(b.c), b.v]); }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf, page, bars }) });
  });
  await ctx.routeWebSocket(/\/api\/chart\/stream\//, (ws) => {
    const tf = new URL(ws.url()).searchParams.get('tf') || '1';
    const step = (TF_MIN[tf] || 1) * MIN;
    const row = (b) => [b.t / 1000, r4(b.o), r4(b.h), r4(b.l), r4(b.c), b.v];
    ws.send(JSON.stringify({ event: 'connected', s: 'NQ', tf }));
    setTimeout(() => {
      const cur = Math.floor(vnow() / step) * step;
      for (let t = cur - 200 * step; t < cur; t += step) ws.send(JSON.stringify({ event: 'bar', s: 'NQ', tf, bar: row(hist(t, step, NQ_BASE)) }));
      ws.send(JSON.stringify({ event: 'bar', s: 'NQ', tf, bar: row(step === MIN ? formingBar('futures', step, NQ_BASE) : hist(cur, step, NQ_BASE)) }));
    }, 300);
    const iv = setInterval(() => { if (step === MIN) { try { ws.send(JSON.stringify({ event: 'bar', s: 'NQ', tf, bar: row(formingBar('futures', step, NQ_BASE)) })); } catch (e) {} } }, 400);
    timers.push(iv); ws.onClose(() => clearInterval(iv));
  });
  await ctx.route(/^https:\/\/(api\.binance\.com|data-api\.binance\.vision|api\.binance\.us)\//, (route) => {
    const u = new URL(route.request().url());
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (/\/ping$/.test(u.pathname)) return json({});
    if (/\/exchangeInfo$/.test(u.pathname)) return json({ symbols: [{ symbol: 'BTCUSDT', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT', filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.01' }] }] });
    if (/\/klines$/.test(u.pathname)) {
      const iv = u.searchParams.get('interval') || '1m';
      const m = { '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '2h': 120, '4h': 240, '1d': 1440 }[iv] || 1;
      const step = m * MIN, now = vnow();
      const limit = Math.min(1000, Number(u.searchParams.get('limit') || 500));
      const st = u.searchParams.get('startTime'), en = u.searchParams.get('endTime');
      const endT = Math.min(en != null ? Number(en) : now, now);
      let ts = [];
      if (st != null) { for (let t = Math.ceil(Number(st) / step) * step; t <= endT && ts.length < limit; t += step) ts.push(t); }
      else { for (let t = Math.floor(endT / step) * step; ts.length < limit; t -= step) ts.unshift(t); }
      const curT = Math.floor(now / step) * step;
      return json(ts.map((t) => { const b = t === curT && step === MIN ? formingBar('binance', step, BTC_BASE) : hist(t, step, BTC_BASE); return [t, String(b.o), String(b.h), String(b.l), String(b.c), String(b.v), t + step - 1, '0', 1, '0', '0', '0']; }));
    }
    return json([]);
  });
  await ctx.routeWebSocket(/^wss:\/\/[^/]*binance[^/]*\//, (ws) => {
    const m = /@kline_(\w+)$/.exec(ws.url());
    if (!m) return;
    const step = ({ '1m': 1, '5m': 5, '15m': 15, '1h': 60 }[m[1]] || 1) * MIN;
    const iv = setInterval(() => { const b = step === MIN ? formingBar('binance', step, BTC_BASE) : hist(vnow(), step, BTC_BASE); try { ws.send(JSON.stringify({ e: 'kline', k: { t: b.t, o: String(b.o), h: String(b.h), l: String(b.l), c: String(b.c), v: String(b.v), x: false } })); } catch (e) {} }, 400);
    timers.push(iv); ws.onClose(() => clearInterval(iv));
  });
}

// Records the paper account doc + journal writes (persisted across reloads in localStorage keys
// the page never uses), on top of the rich stub.
const RECORDER = () => {
  try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {}
  const fb = window.firebase; if (!fb) return;
  // realtime-admin lane for assets/rt-access.js (see mockRoutes): it listens on onIdTokenChanged of an initialised app
  try { fb.apps = [{}]; const A = fb.auth(); if (!A.onIdTokenChanged) A.onIdTokenChanged = (cb) => { setTimeout(() => cb(A.currentUser), 20); return () => {}; }; } catch (e) {}
  const orig = fb.firestore;
  const CLOUD = '__test_cloud_paper', JW = '__test_journal_writes';
  const wrapD = (d, p) => {
    const w = Object.assign({}, d, { collection: (sub) => wrapC(d.collection(sub), p + '/' + sub) });
    if (/\/paperTrading\/account$/.test(p)) {
      w.get = () => { const s = localStorage.getItem(CLOUD); return Promise.resolve({ id: 'account', exists: !!s, data: () => (s ? JSON.parse(s) : {}) }); };
      w.set = (data) => { localStorage.setItem(CLOUD, JSON.stringify({ state: data.state, updatedAt: data.updatedAt, keys: Object.keys(data) })); return Promise.resolve(); };
    }
    if (/\/journal\/[^/]+$/.test(p)) w.set = (data) => { const a = JSON.parse(localStorage.getItem(JW) || '[]'); a.push(data); localStorage.setItem(JW, JSON.stringify(a)); return Promise.resolve(); };
    return w;
  };
  const wrapC = (c, p) => Object.assign({}, c, { doc: (id) => wrapD(c.doc(id), p + '/' + (id || 'auto')) });
  const db = Object.assign({}, orig(), { collection: (n) => wrapC(orig().collection(n), n) });
  fb.firestore = Object.assign(() => db, orig);
  window.__toasts = []; window.__simSounds = [];
  window.addEventListener('stryker:chart-sim-sound', (e) => window.__simSounds.push(e.detail.event + ':' + e.detail.source));
  // assets/toast.js assigns window.showToast later: wrap whatever it sets
  let st = null;
  Object.defineProperty(window, 'showToast', { configurable: true,
    get: () => function (type, msg) { window.__toasts.push({ type, msg: String(msg) }); return st && st.apply(this, arguments); },
    set: (f) => { st = f; } });
};

// Every paper line must sit on the MAIN PRICE PANE at priceToY(price) of that pane.
async function linesOnPricePane(p, label) {
  await sleep(700);
  const r = await p.evaluate(() => {
    const R = window.STRYKER_VELA.chart.renderer.renderer, l = R.extLayers.find((x) => x.def.id === 'stk_paper');
    const inst = l.instance, a = inst.args, pane = R.scene.panes.get('price');
    const out = { paneTop: pane.bounds.top, paneH: pane.bounds.height, argTop: a.bounds.top, argH: a.bounds.height, lines: [] };
    for (const ln of (a.data && a.data.lines) || []) {
      const want = Math.round(R.coords.priceToY(ln.price, pane.scale, pane.bounds)) + 0.5;
      out.lines.push({ id: ln.id, price: ln.price, y: inst.ys[ln.id], want, inPane: want >= pane.bounds.top && want <= pane.bounds.top + pane.bounds.height });
    }
    return out;
  });
  const ok = r.lines.length > 0 && r.argTop === r.paneTop && r.argH === r.paneH && r.lines.every((x) => Math.abs(x.y - x.want) < 1) && r.lines.some((x) => x.id === 'pos' && x.inPane);
  check(ok, label + ': every paper line at priceToY(price) on the main price pane: ' + r.lines.map((x) => x.id + '@' + x.price + ' y=' + x.y + '/' + x.want + (x.inPane ? '' : '(off)')).join(' | ') + ` pane ${r.paneTop}+${r.paneH} layer ${r.argTop}+${r.argH}`);
}
async function setMarket(p, sym, tf) {
  await p.evaluate(async ([sym, tf]) => {
    const ws = window.STRYKER_VELA;
    ws.active.setSymbol(sym); ws.active.setTimeframe(tf);
    const c = ws.chart;
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); if (c.market.symbol === sym && c.market.timeframe === tf && c.orchestrator.rawBars.length > 50) break; }
  }, [sym, tf]);
  await sleep(2000);
}

// ---- the "Enable paper trading" switch ----
// What paper trading currently shows on the page.
const paperUi = (p) => p.evaluate(() => {
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  let lines = 0; try { const R = window.STRYKER_VELA.chart.renderer.renderer, l = R.extLayers.find((x) => x.def.id === 'stk_paper'); lines = ((l.instance.args && l.instance.args.data && l.instance.args.data.lines) || []).length; } catch (e) {}
  return { enabled: window.__stkPaper.enabled, cls: document.documentElement.classList.contains('stkpt-on'), panel: vis(document.querySelector('.stkpt-toggle')), trade: vis(document.getElementById('stkc-paper-btn')),
    oneClick: [...document.querySelectorAll('.stkpt-1c')].filter(vis).length, chips: [...document.querySelectorAll('.stkpt-chip')].filter(vis).length, lines };
});
const allHidden = (u) => !u.enabled && !u.cls && !u.panel && u.oneClick === 0 && u.chips === 0 && u.lines === 0;
// Opens Chart settings (top-bar gear; ☰ tab list on a phone) on the "Paper trading" tab.
async function openPaperTab(p, phone) {
  // phone (build 537): the slim TradingView-style row keeps the gear behind ⋯ More
  if (!(await p.isVisible('#stkc-settings-btn'))) { await (phone ? p.tap('#stkc-more-btn') : p.click('#stkc-more-btn')); await sleep(700); }
  await (phone ? p.tap('#stkc-settings-btn') : p.click('#stkc-settings-btn'));
  await p.waitForSelector('.vela-dialog--settings .vela-sd-rail', { state: 'attached', timeout: 10000 });
  await sleep(300);
  if (phone && await p.isVisible('.vela-dialog--settings .vela-sd-burger')) { await p.click('.vela-dialog--settings .vela-sd-burger'); await sleep(300); }
  const tab = p.locator('.vela-dialog--settings .vela-sd-tab', { hasText: /^\s*Paper trading\s*$/ });
  check(await tab.count() === 1, (phone ? 'phone: ' : '') + 'Chart settings has a "Paper trading" tab');
  await tab.first().click();
  await p.waitForSelector('.vela-dialog--settings .stkpt-set-ui .stkpt-switch input', { state: 'attached', timeout: 5000 });
  await sleep(250);
}
async function closeSettings(p) {
  await p.keyboard.press('Escape'); await sleep(250);
  if (await p.$('.vela-dialog--settings')) { const x = await p.$('.vela-dialog--settings [aria-label="Close"], .vela-dialog--settings .vela-sd-close'); if (x) await x.click().catch(() => {}); await sleep(250); }
}
// Flip the switch from the settings tab (a real click on the switch), returns the new state.
async function flipSwitch(p, phone, shot) {
  await openPaperTab(p, phone);
  const before = await p.evaluate(() => document.querySelector('.vela-dialog--settings .stkpt-switch input').checked);
  await p.click('.vela-dialog--settings .stkpt-switch');
  await sleep(400);
  const after = await p.evaluate(() => ({ sw: document.querySelector('.vela-dialog--settings .stkpt-switch input').checked, en: window.__stkPaper.enabled, note: document.querySelector('.vela-dialog--settings .stkpt-set-note').textContent }));
  if (shot) { await p.screenshot({ path: shot }); console.log('screenshot', shot); }
  await closeSettings(p);
  return Object.assign({ before }, after);
}
const paper = (p, fn, arg) => p.evaluate(fn, arg);
async function waitFor(p, fn, arg, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 8000)) { if (await p.evaluate(fn, arg).catch(() => false)) return true; await sleep(200); }
  return false;
}
const BROKER_RE = /rithmic|tradovate|ninjatrader|tradestation|interactivebrokers|ibkr|alpaca|oanda|tastytrade|tradier|projectx|topstepx|\/order(s)?\b|\/trade(s)?\/(place|submit)|\/api\/(paper|broker|order)/i;
// Site features that load with the chart page and are not paper trading: the Connect-broker 'is this provider set up' GET probes (/connect/<broker>/token?probe=1), broker logo images, the Vest symbol list.
const SITE_PROBES = /^http:\/\/127\.0\.0\.1:\d+\/(connect\/[\w-]+\/token\?probe=1$|assets\/images\/|api\/vest\/exchangeInfo$)/;
const ALLOWED = (u) => SITE_PROBES.test(u) || /^https:\/\/(api\.bitget\.com\/api\/v2\/mix\/market\/|api\.kraken\.com\/0\/public\/|book-recorder\.theelitegrey\.workers\.dev\/te-bars\?|cdn\.jsdelivr\.net\/npm\/)/.test(u) || /^https:\/\/(api\.bybit\.com\/v5\/market\/instruments-info|www\.okx\.com\/api\/v5\/public\/instruments|api\.bitget\.com\/api\/v2\/spot\/public\/symbols)/.test(u) || /^http:\/\/127\.0\.0\.1:\d+\/(assets\/|api\/chart\/(bars|stream)\/|api\/chart\/rt$|[\w-]+(\.html)?(\?|$)|manifest\.json|favicon)/.test(u)
  || /^https:\/\/(api\.binance\.com|data-api\.binance\.vision|api\.binance\.us)\/api\/v3\/(klines|exchangeInfo|ping|depth|trades|aggTrades|ticker)/.test(u)
  || /^wss:\/\/[^/]*binance[^/]*\//.test(u)
  || /^https:\/\/www\.gstatic\.com\/firebasejs\//.test(u) || /^https:\/\/api\.dicebear\.com\//.test(u)
  || /^https:\/\/api\.hyperliquid\.xyz\/info$/.test(u)
  // existing Charts market data / symbol metadata (not paper trading)
  || /^https:\/\/fapi\.binance\.com\/fapi\/v1\/(exchangeInfo|klines|ticker)/.test(u)
  || /^https:\/\/api\.exchange\.coinbase\.com\/products/.test(u)
  || /^https:\/\/crypto-icons\.ledger\.com\//.test(u);

// ---- trade instrument (mini / micro switch) + TP1 / TP2 / break-even / risk size in the order panel ----
async function tradeInstSection(b, BASE, reqs, vp, theme) {
  const phone = vp.width < 700, tag = vp.width + '-' + theme;
  const { ctx, p, errors } = await newPage(b, BASE, Object.assign({ viewport: vp, deviceScaleFactor: phone ? 2 : 1 }, phone ? { isMobile: true, hasTouch: true } : {}), reqs);
  await p.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t); } catch (e) {} }, theme);
  await boot(p, BASE);
  await p.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); }, theme);
  await setMarket(p, 'futures:NQ1!', '1');
  await waitFor(p, () => Number.isFinite(window.__stkPaper.account.last['futures:NQ1!']));
  await p.evaluate(() => window.__stkPaper.setEnabled(true));
  await sleep(600);
  if (phone) await p.evaluate(() => window.__stkPaper.orderPanel({ tab: 'order' }));
  else { await p.click('#stkc-paper-btn'); await p.waitForSelector('#stkc-trade-pop:not([hidden]) [data-a=paper]', { timeout: 5000 }); await p.click('#stkc-trade-pop [data-a=paper]'); }
  await p.waitForSelector('#stkop:not([hidden])', { timeout: 10000 });
  await p.evaluate(() => window.__stkOrderPanel.setTab('order'));
  await sleep(500);
  // the mini / micro switch: NQ | MNQ, NQ picked (the chart symbol)
  const sw = await p.evaluate(() => [...document.querySelectorAll('#stkop [data-inst]')].map((x) => x.textContent + (x.classList.contains('on') ? '*' : '')));
  check(sw.join(',') === 'NQ*,MNQ', tag + ': order panel header has the NQ | MNQ switch, NQ (the chart symbol) picked: ' + sw.join(','));
  await p.click('#stkop [data-inst=MNQ]'); await sleep(400);
  const st = await p.evaluate(() => ({ trade: window.__stkPaper.tradeSym(window.__stkPaper.activeSymbol()), chart: window.STRYKER_VELA.chart.market.symbol, root: document.querySelector('#stkop [data-k=root]').textContent, last: window.__stkPaper.lastPrice('futures:MNQ1!'), nq: window.__stkPaper.lastPrice('futures:NQ1!') }));
  check(st.trade === 'futures:MNQ1!' && st.chart === 'futures:NQ1!' && /MNQ/.test(st.root) && st.last === st.nq, tag + ': MNQ picked: panel trades MNQ, the chart stays NQ1!, MNQ price = the chart price 1:1 ' + JSON.stringify(st));
  // TP1 / TP2 / BE / risk on the Order tab
  const set = async (f, v) => p.evaluate(([f, v]) => { const i = document.querySelector('#stkop [data-f="' + f + '"]'); if (i.type === 'checkbox') { if (i.checked !== v) i.click(); } else { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); } }, [f, v]);
  // Advanced (2026-11-20): the simple ticket is the default: no TP1, no risk size, no layout until the switch is on
  const simple = await p.evaluate(() => ({ adv: document.querySelector('#stkop [data-f=adv]').checked, tp1: document.querySelector('#stkop [data-leg=tp1]').hidden, risk: document.querySelector('#stkop [data-leg=risk]').hidden, lay: document.querySelector('#stkop [data-leg=lay]').hidden, sl: !document.querySelector('#stkop [data-leg=sl]').hidden, tp: !document.querySelector('#stkop [data-leg=tp]').hidden }));
  check(!simple.adv && simple.tp1 && simple.risk && simple.lay && simple.sl && simple.tp, tag + ': default = simple ticket (SL + TP only; TP1, risk size, layout hidden) ' + JSON.stringify(simple));
  if (theme === 'dark') { const sh = `${OUT}/tradewin-${tag}-simple.png`; await p.screenshot({ path: sh }); console.log('screenshot', sh); }
  await set('adv', true); await sleep(200);
  await set('sl.on', true); await set('sl.ticks', '40');
  await set('tp1.on', true); await set('tp1.ticks', '40'); await set('tp1.size', '50');
  await p.click('#stkop [data-unit=pct]');
  await set('be.on', true); await set('be.ticks', '2');
  await set('tp.on', true); await set('tp.ticks', '80');
  await set('risk.on', true); await set('risk.v', '100');
  await sleep(500);
  const form = await p.evaluate(() => ({ qty: document.querySelector('#stkop [data-f=qty]').value, t1: document.querySelector('#stkop [data-k=t1sum]').textContent, rs: document.querySelector('#stkop [data-k=rsum]').textContent, tpLbl: document.querySelector('#stkop [data-leg=tp] .stkop-chk').textContent.trim() }));
  // $100 risk / (40 ticks x 0.25 = 10 pts x $2 MNQ) = 5 contracts
  check(form.qty === '5' && /TP1 closes 2, TP2 closes 3/.test(form.t1) && /break-even|entry \+ 2 ticks/.test(form.t1) && /^5 lots · risk \$100/.test(form.rs) && /Take profit 2/.test(form.tpLbl), tag + ': risk $100, SL 40 ticks -> 5 MNQ; TP1 50% = 2, TP2 = 3, BE +2 ticks ' + JSON.stringify(form));
  // ---- ALIGNMENT GATE on the bracket rows ----
  const al = await p.evaluate(() => {
    const R = (e) => e.getBoundingClientRect(), mid = (e) => { const r = R(e); return r.top + r.height / 2; };
    const out = { rows: [], pad: [], clip: [], docW: document.documentElement.scrollWidth, panelW: Math.round(R(document.getElementById('stkop')).width) };
    for (const row of document.querySelectorAll('#stkop .stkop-t1q, #stkop [data-leg=risk] .stkop-brh, #stkop .stkop-il')) {
      const kids = [...row.children].filter((k) => R(k).width > 0); if (kids.length < 2) continue;
      const m = kids.map(mid); out.rows.push(Math.round((Math.max(...m) - Math.min(...m)) * 10) / 10);
    }
    for (const pill of document.querySelectorAll('#stkop .stkop-inst, #stkop .stkop-seg')) {
      const r = R(pill), k = [...pill.children].filter((x) => R(x).width > 0); if (!k.length) continue;
      const a = R(k[0]), z = R(k[k.length - 1]);
      out.pad.push([Math.round(a.left - r.left), Math.round(r.right - z.right), Math.round(a.top - r.top), Math.round(r.bottom - a.bottom)]);
    }
    for (const t of document.querySelectorAll('#stkop .stkop-t1s, #stkop .stkop-t1n span, #stkop [data-inst], #stkop .stkop-seg button, #stkop .stkop-chk')) {
      if (R(t).width > 0 && (t.scrollWidth > t.clientWidth + 1)) out.clip.push(t.textContent.trim().slice(0, 30));
    }
    out.tab = getComputedStyle(document.querySelector('#stkop [data-f="risk.v"]')).fontVariantNumeric;
    return out;
  });
  check(al.rows.every((d) => d <= 1) && al.pad.every((q) => Math.abs(q[0] - q[1]) <= 1 && Math.abs(q[2] - q[3]) <= 1) && al.clip.length === 0 && al.docW <= vp.width && /tabular/.test(al.tab),
    tag + ': alignment gate (one centre per row <= 1 px, even pill padding, no clipped text, no sideways scroll, tabular digits) ' + JSON.stringify(al));
  const shot = `${OUT}/tradeinst-${tag}-panel.png`;
  await p.screenshot({ path: shot }); console.log('screenshot', shot);
  await p.evaluate(() => { const b = document.querySelector('#stkop .stkop-op'); if (b) b.scrollTop = b.scrollHeight; const s = document.querySelector('#stkop [data-leg=risk]'); if (s) s.scrollIntoView({ block: 'end' }); });
  await sleep(200);
  const shot2 = `${OUT}/tradeinst-${tag}-panel-bottom.png`; await p.screenshot({ path: shot2 }); console.log('screenshot', shot2);
  // place it: a market BUY 5 MNQ with TP1 2 / TP2 3 / BE +2
  await p.evaluate(() => document.querySelector('#stkop [data-side=buy]').click());
  await sleep(300);
  await p.evaluate(() => document.querySelector('#stkop [data-k=confirm]').click());
  const placed = await waitFor(p, () => !!window.__stkPaper.account.position('futures:MNQ1!'), null, 5000);
  const pos = await p.evaluate(() => JSON.parse(JSON.stringify(window.__stkPaper.account.position('futures:MNQ1!') || null)));
  const nq = await p.evaluate(() => window.__stkPaper.account.position('futures:NQ1!'));
  check(placed && pos.qty === 5 && pos.tp1Qty === 2 && pos.be === 2 && pos.tp1 === pos.avg + 10 && pos.tp === pos.avg + 20 && pos.sl === pos.avg - 10 && !nq, tag + ': BUY 5 MNQ placed on the NQ chart with SL / TP1 2 / TP2 / BE; no NQ position ' + JSON.stringify(pos && { qty: pos.qty, avg: pos.avg, sl: pos.sl, tp1: pos.tp1, tp1Qty: pos.tp1Qty, tp: pos.tp, be: pos.be }));
  if (!placed) { console.log('toasts', JSON.stringify(await p.evaluate(() => window.__stkPaper.toasts.slice(-4)))); await ctx.close(); return; }
  await sleep(2300);
  const chips = await p.evaluate(() => [...document.querySelectorAll('.stkpt-chip')].map((c) => c.dataset.id + ':' + c.querySelector('.stkpt-chip-a').textContent));
  check(['xpos', 'xptp1', 'xptp', 'xpsl'].every((k) => chips.some((c) => c.startsWith(k + ':'))) && chips.some((c) => /^xptp1:MNQ TP1 2 /.test(c)) && chips.some((c) => /^xptp:MNQ TP2 3 /.test(c)), tag + ': MNQ position, TP1, TP2 and SL lines on the NQ chart: ' + chips.join(' | '));
  const shot3 = `${OUT}/tradeinst-${tag}-chart.png`; await p.screenshot({ path: shot3 }); console.log('screenshot', shot3);
  if (!phone && theme === 'dark') {
    // drag TP1 up a little -> the position's TP1 moves
    const t0 = pos.tp1;
    await p.evaluate(() => window.__stkOrderPanel.close()); await sleep(400);
    const c = await p.evaluate(() => { const e = document.querySelector('.stkpt-chip[data-id=xptp1]'); const r = e.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2, vis: e.style.visibility }; });
    await p.mouse.move(c.x, c.y); await p.mouse.down();
    for (let i = 1; i <= 6; i++) { await p.mouse.move(c.x, c.y - i * 4); await sleep(30); }
    await p.mouse.up(); await sleep(500);
    const t1 = await p.evaluate(() => window.__stkPaper.account.position('futures:MNQ1!').tp1);
    if (!(t1 > t0)) console.log('debug chip', JSON.stringify(c));
    check(t1 > t0 && t1 < pos.tp, tag + `: dragged the MNQ TP1 line up on the NQ chart: ${t0} -> ${t1}`);
    // price runs through TP1: 2 close, the stop moves to entry + 2 ticks; then through TP2: flat, the stop gone (OCO)
    px.futures = t1 + 1;
    const hit1 = await waitFor(p, () => { const q = window.__stkPaper.account.position('futures:MNQ1!'); return q && q.qty === 3; }, null, 8000);
    const after1 = await p.evaluate(() => JSON.parse(JSON.stringify(window.__stkPaper.account.position('futures:MNQ1!')))) || {};
    if (!hit1) console.log('debug trades', JSON.stringify(await p.evaluate(() => window.__stkPaper.account.state.trades.slice(-3).map((t) => [t.symbol, t.reason, t.qty, t.entry, t.exit]))), 'px', px.futures);
    check(hit1 && after1.sl === pos.avg + 0.5 && after1.beMoved && after1.tp1 == null, tag + ': TP1 filled 2 MNQ; stop moved to break-even + 2 ticks ' + JSON.stringify({ qty: after1.qty, sl: after1.sl, avg: after1.avg }));
    await sleep(2300);
    const chips2 = await p.evaluate(() => [...document.querySelectorAll('.stkpt-chip')].map((c) => c.dataset.id + ':' + c.querySelector('.stkpt-chip-a').textContent));
    check(chips2.some((c) => /^xpsl:MNQ SL BE /.test(c)) && !chips2.some((c) => /^xptp1/.test(c)), tag + ': after TP1 the stop chip reads "SL BE", TP1 line gone: ' + chips2.join(' | '));
    px.futures = pos.tp + 1;
    const flat = await waitFor(p, () => !window.__stkPaper.account.position('futures:MNQ1!'), null, 8000);
    const tr = await p.evaluate(() => window.__stkPaper.account.state.trades.filter((t) => t.symbol === 'futures:MNQ1!').map((t) => t.reason + ' ' + t.qty));
    check(flat && tr.join(',') === 'tp1 2,tp 3' && (await p.evaluate(() => document.querySelectorAll('.stkpt-chip[data-id^=x]').length)) <= 1, tag + ': TP2 filled the rest: flat, stop cancelled (OCO), trades ' + tr.join(','));
    // DOM tab follows the trade instrument
    await p.evaluate(() => window.__stkOrderPanel.open({ tab: 'dom' })); await sleep(1200);
    const dom = await p.evaluate(() => { const e = document.querySelector('#stkop .stkbp-pl'); return e ? e.textContent : ''; });
    check(/MNQ/.test(dom), tag + ': DOM tab paper bar names the trade instrument: ' + dom);
    const shot4 = `${OUT}/tradeinst-${tag}-dom.png`; await p.screenshot({ path: shot4 }); console.log('screenshot', shot4);
    // switching back to NQ: the panel trades the chart symbol again
    await p.evaluate(() => window.__stkOrderPanel.setTab('order')); await sleep(300);
    await p.click('#stkop [data-inst=NQ]'); await sleep(300);
    check(await p.evaluate(() => window.__stkPaper.tradeSym('futures:NQ1!') === 'futures:NQ1!'), tag + ': NQ picked again: the panel trades the chart symbol');
    px.futures = NQ_BASE;
  }
  check(errors.length === 0, tag + ': console errors: ' + (errors.slice(0, 4).join(' | ') || 'none'));
  await ctx.close();
}

// ---- Advanced: panel layout (Float / Left / Right / Bottom) + account numbers in the footer (member feature 2026-11-20) ----
async function advancedSection(b, BASE, reqs, vp, theme) {
  const phone = vp.width < 700, tag = vp.width + '-' + theme;
  const { ctx, p, errors } = await newPage(b, BASE, Object.assign({ viewport: vp, deviceScaleFactor: phone ? 2 : 1 }, phone ? { isMobile: true, hasTouch: true } : {}), reqs);
  await p.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t); } catch (e) {} }, theme);
  await boot(p, BASE);
  await p.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); }, theme);
  await setMarket(p, 'futures:NQ1!', '1');
  await waitFor(p, () => Number.isFinite(window.__stkPaper.account.last['futures:NQ1!']));
  await p.evaluate(() => window.__stkPaper.setEnabled(true));
  await sleep(600);
  await p.evaluate(() => window.__stkPaper.orderPanel({ tab: 'order' }));
  await p.waitForSelector('#stkop:not([hidden])', { timeout: 10000 });
  await sleep(500);
  const set = async (f, v) => p.evaluate(([f, v]) => { const i = document.querySelector('#stkop [data-f="' + f + '"]'); if (i.type === 'checkbox') { if (i.checked !== v) i.click(); } else { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); } }, [f, v]);
  check(await p.evaluate(() => !document.querySelector('#stkop .stkop-ai') && window.__stkOrderPanel.prefs.adv === false), tag + ': advanced off by default, no account numbers in the footer');
  await set('adv', true); await sleep(300);
  // a position so the open P&L / equity are not zero
  await p.evaluate(() => window.__stkPaper.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1 }));
  px.futures = NQ_BASE + 5; await sleep(1500);
  for (const k of ['bal', 'eq', 'day', 'up']) await p.evaluate((k) => document.querySelector('#stkop [data-ai=' + k + ']').click(), k);
  await sleep(500);
  const ai = await p.evaluate(() => { const o = {}; for (const e of document.querySelectorAll('#stkop [data-ai-v]')) o[e.dataset.aiV] = e.textContent; const s = window.__stkPaper.account.summary(); return { o, s: { bal: s.balance, eq: s.equity, up: s.unrealized }, pressed: [...document.querySelectorAll('#stkop [data-ai][aria-pressed=true]')].length, saved: window.__stkOrderPanel.prefs.ai }; });
  const m = (n) => '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  check(ai.pressed === 4 && ai.saved.join() === 'bal,eq,day,up' && ai.o.bal === m(ai.s.bal) && ai.o.eq === m(ai.s.eq) && ai.o.up.endsWith(m(ai.s.up)) && ai.s.up > 0 && 'day' in ai.o, tag + ': footer shows Balance, Equity, Today\'s P&L, Open P&L from the paper account ' + JSON.stringify(ai));
  // no broker names anywhere in a member's panel
  const txt = await p.evaluate(() => document.getElementById('stkop').innerText);
  check(!/tradovate|rithmic|ninja|topstep|interactive brokers|ibkr|tastytrade|finatic|binance|coinbase/i.test(txt), tag + ': no broker / data-provider names in the member panel');
  const alignFt = async () => p.evaluate(() => {
    const R = (e) => e.getBoundingClientRect(), out = { rows: [], clip: [], dd: [], docW: document.documentElement.scrollWidth, pad: [] };
    for (const row of document.querySelectorAll('#stkop .stkop-ai > div, #stkop .stkop-wpos, #stkop .stkop-adv')) { const k = [...row.children].filter((x) => R(x).width > 0 && R(x).height > 0); if (k.length < 2) continue; const mm = k.map((x) => R(x).top + R(x).height / 2); out.rows.push(Math.round((Math.max(...mm) - Math.min(...mm)) * 10) / 10); }
    for (const t of document.querySelectorAll('#stkop .stkop-ai dt, #stkop .stkop-ai dd, #stkop .stkop-aib button, #stkop [data-wmode], #stkop .stkop-adv .stkop-chk')) if (R(t).width > 0 && t.scrollWidth > t.clientWidth + 1) out.clip.push(t.textContent);
    for (const d of document.querySelectorAll('#stkop .stkop-ai dd')) { const cs = getComputedStyle(d); out.dd.push(cs.fontVariantNumeric + '|' + cs.textAlign); }
    for (const sg of document.querySelectorAll('#stkop .stkop-wpos .stkop-seg')) { const r = R(sg), k = [...sg.children]; const a = R(k[0]), z = R(k[k.length - 1]); out.pad.push([Math.round(a.left - r.left), Math.round(r.right - z.right), Math.round(a.top - r.top), Math.round(r.bottom - a.bottom)]); }
    return out;
  });
  const gate = (A, what) => check(A.rows.every((d) => d <= 1) && A.clip.length === 0 && A.docW <= vp.width && A.dd.every((x) => /tabular/.test(x) && /right/.test(x)) && A.pad.every((q) => Math.abs(q[0] - q[1]) <= 1 && Math.abs(q[2] - q[3]) <= 1), tag + ' ' + what + ': alignment gate ' + JSON.stringify(A));
  await p.evaluate(() => { const s = document.querySelector('#stkop [data-leg=lay]'); s.scrollIntoView({ block: 'end' }); }); await sleep(200);
  gate(await alignFt(), 'float');
  let sh = `${OUT}/tradewin-${tag}-float.png`; await p.screenshot({ path: sh }); console.log('screenshot', sh);
  if (phone) {
    check(await p.evaluate(() => document.querySelector('#stkop .stkop-wpos').hidden), tag + ': phone: position picker hidden (bottom sheet)');
  } else {
    const vc0 = await p.evaluate(() => { const r = document.getElementById('vela-chart').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; });
    const geo = async () => p.evaluate(() => { const o = document.getElementById('stkop').getBoundingClientRect(), v = document.getElementById('vela-chart').getBoundingClientRect(); return { oL: o.left, oR: o.right, oT: o.top, oB: o.bottom, oW: o.width, oH: o.height, vL: v.left, vR: v.right, vT: v.top, vB: v.bottom, cls: document.getElementById('stkop').className, mode: window.__stkOrderPanel.prefs.mode }; });
    // LEFT
    await p.click('#stkop [data-wmode=left]'); await sleep(700);
    let g = await geo();
    check(g.mode === 'left' && /is-dock-l/.test(g.cls) && Math.abs(g.oR - g.vL) <= 1 && Math.abs(g.oL - vc0.l) <= 1 && Math.abs(g.oT - g.vT) <= 1 && Math.abs(g.oH - (g.vB - g.vT)) <= 1, tag + ': Left docks the panel on the chart\'s left edge; the chart shrinks ' + JSON.stringify(g));
    await p.evaluate(() => { const s = document.querySelector('#stkop [data-leg=lay]'); s.scrollIntoView({ block: 'end' }); }); await sleep(200);
    gate(await alignFt(), 'left');
    sh = `${OUT}/tradewin-${tag}-left.png`; await p.screenshot({ path: sh }); console.log('screenshot', sh);
    // BOTTOM
    await p.click('#stkop [data-wmode=bottom]'); await sleep(700);
    g = await geo();
    check(g.mode === 'bottom' && /is-dock-b/.test(g.cls) && Math.abs(g.oT - g.vB) <= 1 && Math.abs(g.oL - g.vL) <= 1 && Math.abs(g.oW - (g.vR - g.vL)) <= 1 && g.oH === 300 && Math.abs(g.vB - (vc0.b - 300)) <= 1, tag + ': Bottom docks the panel under the chart, full chart width, 300 px; the chart shrinks ' + JSON.stringify(g));
    gate(await alignFt(), 'bottom');
    sh = `${OUT}/tradewin-${tag}-bottom.png`; await p.screenshot({ path: sh }); console.log('screenshot', sh);
    // resize the bottom dock from its top edge, then reload: mode + height + advanced + numbers kept
    const dl = await (await p.$('#stkop .stkop-dl')).boundingBox();
    const hit = await p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? e.className : ''; }, [dl.x + 600, dl.y + 4]); console.log('dock edge hit', hit);
    await p.mouse.move(dl.x + 600, dl.y + 4); await p.mouse.down(); await p.mouse.move(dl.x + 600, dl.y - 56, { steps: 4 }); await p.mouse.up(); await sleep(300);
    const h1 = await p.evaluate(() => Math.round(document.getElementById('stkop').getBoundingClientRect().height));
    check(h1 === 360, tag + ': bottom dock height drags from its top edge (300 -> ' + h1 + ')');
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__stkPaper && window.__stkPaper.account, null, { timeout: 60000 });
    const back = await waitFor(p, () => { const o = document.getElementById('stkop'); return o && !o.hidden && o.classList.contains('is-dock-b') && Math.round(o.getBoundingClientRect().height) === 360 && !!document.querySelector('#stkop .stkop-ai [data-ai-v=eq]'); }, null, 20000);
    check(back, tag + ': after a reload: bottom dock, same height, advanced + account numbers kept');
    // RIGHT then Float: the chart gets its full size back
    await p.evaluate(() => window.__stkOrderPanel.setTab('order')); await sleep(300);
    await p.click('#stkop [data-wmode=dock]'); await sleep(600);
    g = await geo();
    check(g.mode === 'dock' && Math.abs(g.oL - g.vR) <= 1 && !/is-dock-[lb]/.test(g.cls), tag + ': Right = the original dock right ' + JSON.stringify(g));
    await p.click('#stkop [data-wmode=float]'); await sleep(600);
    const vc1 = await p.evaluate(() => { const r = document.getElementById('vela-chart').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; });
    check(JSON.stringify(vc1) === JSON.stringify(vc0) && !(await p.evaluate(() => document.querySelector('.stkchart-panel').dataset.stkopSide)), tag + ': Float: the chart is back to its full size ' + JSON.stringify([vc0, vc1]));
  }
  // advanced off again: the simple ticket, footer numbers gone, TP1 not sent
  await set('adv', false); await sleep(400);
  const off = await p.evaluate(() => ({ ai: !!document.querySelector('#stkop .stkop-ai'), tp1: document.querySelector('#stkop [data-leg=tp1]').hidden, lay: document.querySelector('#stkop [data-leg=lay]').hidden }));
  check(!off.ai && off.tp1 && off.lay, tag + ': Advanced off = simple ticket again, no footer numbers ' + JSON.stringify(off));
  px.futures = NQ_BASE;
  check(errors.length === 0, tag + ': console errors: ' + (errors.slice(0, 4).join(' | ') || 'none'));
  await ctx.close();
}

async function newPage(b, BASE, opts, reqs) {
  const ctx = await b.newContext(opts);
  await ctx.addInitScript(stub);
  await ctx.addInitScript(RECORDER);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|api\.binance\.com|data-api\.binance\.vision|api\.binance\.us)/, (r) => { reqs.push({ url: r.request().url(), method: r.request().method(), blocked: true }); r.abort(); });
  await mockRoutes(ctx);
  ctx.on('request', (r) => reqs.push({ url: r.url(), method: r.method() }));
  ctx.on('websocket', (w) => reqs.push({ url: w.url(), method: 'WS' }));
  const p = await ctx.newPage();
  offset = T0 - Date.now();
  await p.clock.install({ time: new Date(T0) });
  const errors = [];
  const IGNORE = [/ERR_FAILED|ERR_INTERNET_DISCONNECTED|net::|status of 4|status of 5|Failed to fetch/i, /WebSocket connection to/];
  p.on('console', (m) => { if (m.type() === 'error' && !IGNORE.some((re) => re.test(m.text()))) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  return { ctx, p, errors };
}
async function boot(p, BASE) {
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkPaper, null, { timeout: 60000 });
  await p.waitForFunction(() => window.__stkPaper.account, null, { timeout: 15000 });
  offset = (await p.evaluate(() => Date.now())) - Date.now();
  await sleep(1500);
}

const AX = (p) => p.evaluate(() => {
  const A = window.__stkAxisTags, R = A.rendererOf(A.cellsOf()[0]), pane = R.scene.panes.get('price');
  const last = R.scene.bars[R.scene.bars.length - 1], ly = R.coords.priceToY(last.close, pane.scale, pane.bounds);
  return { boxes: A.boxes(R), want: (pr) => 0, top: pane.bounds.top, bot: pane.bounds.top + pane.bounds.height, ly, last: last.close, W: R.coords.width, pw: R.plot.clientWidth, t: last.time,
    y: null };
});
const yOf = (p, price) => p.evaluate((pr) => { const A = window.__stkAxisTags, R = A.rendererOf(A.cellsOf()[0]), pane = R.scene.panes.get('price'); return R.coords.priceToY(pr, pane.scale, pane.bounds); }, price);
const fmt2 = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SEL = { tp: '#089981', sl: '#f23645', buy: '#2962ff' };

async function scenario(b, BASE, reqs, vp, theme, full) {
  const phone = vp.width < 700, tag = vp.width + '-' + theme;
  const { ctx, p, errors } = await newPage(b, BASE, Object.assign({ viewport: vp, deviceScaleFactor: phone ? 2 : 1 }, phone ? { isMobile: true, hasTouch: true } : {}), reqs);
  await p.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t); } catch (e) {} }, theme);
  await boot(p, BASE);
  await p.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await setMarket(p, 'futures:NQ1!', '1');
  await waitFor(p, () => Number.isFinite(window.__stkPaper.account.last['futures:NQ1!']));
  await p.evaluate(() => window.__stkPaper.setEnabled(true)); await sleep(600);
  check(await waitFor(p, () => !!window.__stkAxisTags && window.__stkAxisTags.cellsOf().length > 0, null, 15000), tag + ': axis-tags module mounted');
  // 1) a paper position with TP + SL and a working buy limit: 4 tags
  const last = await p.evaluate(() => window.__stkPaper.account.last['futures:NQ1!']);
  const tp = last + 10, sl = last - 2;
  await p.evaluate(([tp, sl]) => window.__stkPaper.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1, tp, sl }), [tp, sl]);
  check(await waitFor(p, () => !!window.__stkPaper.account.position('futures:NQ1!'), null, 6000), tag + ': paper position opened');
  const pos = await p.evaluate(() => JSON.parse(JSON.stringify(window.__stkPaper.account.position('futures:NQ1!'))));
  await p.evaluate((price) => window.__stkPaper.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'limit', qty: 1, price }), pos.avg - 4);
  await waitFor(p, () => (window.__stkAxisTags.boxes(window.__stkAxisTags.rendererOf(window.__stkAxisTags.cellsOf()[0])) || []).length >= 4, null, 8000);
  await sleep(400);
  let a = await AX(p);
  const exp = [['position', pos.avg, SEL.buy], ['TP', pos.tp, SEL.tp], ['SL', pos.sl, SEL.sl], ['limit', pos.avg - 4, SEL.buy]];
  const rows = [];
  for (const [nm, price, col] of exp) {
    const y = await yOf(p, price), bx = a.boxes.find((x) => x.text === fmt2(price));
    const ok = !!bx && bx.color === col && Math.abs((bx.top + bx.h / 2) - y) <= (nm === 'TP' ? 1.01 : 20) && bx.x >= a.W && bx.x + bx.w <= a.pw;
    rows.push(nm + ':' + (bx ? bx.text + '/' + bx.color + '/dy=' + (bx.top + bx.h / 2 - y).toFixed(1) : 'MISSING'));
    check(ok, tag + ': ' + nm + ' tag at the exact price, ' + col + ', text ' + fmt2(price) + ' inside the scale (' + rows[rows.length - 1] + ')');
  }
  check(a.boxes.length === 4, tag + ': exactly 4 trade tags, no duplicates (' + a.boxes.length + ')');
  // text colour: white on the dark/solid tags (contrast helper)
  // 2) drag the SL chip: its tag follows live
  if (!phone) {
    const chip = await p.evaluate(() => { const c = document.querySelector('.stkpt-chip[data-id=psl]'); const r = c.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
    await p.mouse.move(chip.x, chip.y); await p.mouse.down();
    for (let i = 1; i <= 6; i++) { await p.mouse.move(chip.x, chip.y + i * 5); await sleep(40); }
    await sleep(250);
    const mid = await AX(p), dragPrice = await p.evaluate(() => { const A = window.__stkAxisTags; const R = A.rendererOf(A.cellsOf()[0]); const l = R.extLayers.find((x) => x.def.id === 'stk_paper').instance.args.data.lines.find((x) => x.id === 'psl'); return l.price; });
    const bx = mid.boxes.find((x) => x.text === fmt2(dragPrice)), y = await yOf(p, dragPrice);
    check(dragPrice < pos.sl && !!bx && Math.abs(bx.top + bx.h / 2 - y) <= 20, tag + ': dragging SL: the scale tag follows live (' + pos.sl + ' -> ' + dragPrice + ', tag ' + (bx ? bx.text : 'none') + ')');
    await p.mouse.up(); await sleep(600);
    const newSl = await p.evaluate(() => window.__stkPaper.account.position('futures:NQ1!').sl);
    a = await AX(p);
    check(newSl < pos.sl && a.boxes.some((x) => x.text === fmt2(newSl)) && !a.boxes.some((x) => x.text === fmt2(pos.sl)), tag + ': after the drop the tag shows the new SL ' + newSl + ', the old one is gone');
  }
  // 3) drawings
  const mk = (type, price, extra) => p.evaluate(([type, price, extra]) => { const c = window.__stkAxisTags.cellsOf()[0], R = window.__stkAxisTags.rendererOf(c), n = R.scene.bars.length; const t = R.scene.bars[n - 5].time;
    const an = extra && extra.two ? [{ time: R.scene.bars[n - 30].time, price }, { time: t, price: price + extra.two }] : [{ time: t, price }]; const d = c.chart.drawings.add(type, { paneId: 'price', anchors: an }); return d && d.id; }, [type, price, extra]);
  const hp = Math.round((last + 40) * 4) / 4;
  const hid = await mk('hline', hp);
  await sleep(500); a = await AX(p);
  check(!!hid && a.boxes.some((x) => x.text === fmt2(hp)), tag + ': horizontal line shows a scale tag by default (' + hp + ')');
  const hbx = a.boxes.find((x) => x.text === fmt2(hp)); const hcol = hbx && hbx.color;
  check(!!hbx && /^#[0-9a-f]{6}$/.test(hcol), tag + ': drawing tag has the line colour ' + hcol);
  // settings window: the "Price label on scale" row
  await p.evaluate((id) => { const c = window.__stkAxisTags.cellsOf()[0]; const R = window.__stkAxisTags.rendererOf(c); c.chart.drawings.select(id); R.userDrawings.openSettings(id); R.userDrawings.popup.openPanel(); }, hid);
  const hasRow = await waitFor(p, () => !!document.querySelector('.stk-axt-row input'), null, 6000);
  check(hasRow, tag + ': drawing settings has a "Price label on scale" checkbox, on by default');
  if (hasRow) {
    const on0 = await p.evaluate(() => document.querySelector('.stk-axt-row input').checked);
    if (full) { await p.screenshot({ path: `${OUT}/axistags-${tag}-settings.png` }); console.log('screenshot', `${OUT}/axistags-${tag}-settings.png`); }
    await p.click('.stk-axt-row input'); await sleep(500); a = await AX(p);
    check(on0 && !a.boxes.some((x) => x.text === fmt2(hp)), tag + ': unticking the option removes the tag');
    await p.click('.stk-axt-row input'); await sleep(500); a = await AX(p);
    check(a.boxes.some((x) => x.text === fmt2(hp)), tag + ': ticking it again brings the tag back');
    const al = await p.evaluate(() => { const r = document.querySelector('.stk-axt-row'), i = r.querySelector('input'), R = (e) => e.getBoundingClientRect(); return { mid: Math.abs((R(r).top + R(r).height / 2) - (R(i).top + R(i).height / 2)), clip: r.scrollWidth > r.clientWidth + 1 }; });
    check(al.mid <= 1 && !al.clip, tag + ': settings row aligned (checkbox centre vs row <= 1 px, no clipping) ' + JSON.stringify(al));
  }
  await p.keyboard.press('Escape'); await sleep(200);
  await p.evaluate(() => { const c = window.__stkAxisTags.cellsOf()[0]; c.chart.drawings.select([]); });
  // trend line: no tags while unselected, tags for both ends while selected
  const tp1 = Math.round((last + 15) * 4) / 4, tid = await mk('trendline', tp1, { two: 6 });
  await p.evaluate(() => { const c = window.__stkAxisTags.cellsOf()[0]; c.chart.drawings.select([]); }); await sleep(500);
  a = await AX(p);
  check(!a.boxes.some((x) => x.text === fmt2(tp1)), tag + ': trend line: no scale tag while it is not selected');
  await p.evaluate((id) => window.__stkAxisTags.cellsOf()[0].chart.drawings.select(id), tid); await sleep(500);
  a = await AX(p);
  check(a.boxes.some((x) => x.text === fmt2(tp1)) && a.boxes.some((x) => x.text === fmt2(tp1 + 6)), tag + ': trend line selected: both end prices tagged');
  await p.evaluate(() => window.__stkAxisTags.cellsOf()[0].chart.drawings.select([])); await sleep(300);
  // 4) collisions: three lines within one tag height of each other and one right at the last price
  const lastNow = (await AX(p)).last;
  for (const dp of [0, 0.25, 0.5]) await mk('hline', Math.round((last + 30 + dp) * 4) / 4);
  const lid = await mk('hline', Math.round(lastNow * 4) / 4);
  await sleep(700); a = await AX(p);
  const bs = a.boxes.slice().sort((x, y) => x.top - y.top);
  let overlap = false; for (let i = 1; i < bs.length; i++) if (bs[i].top < bs[i - 1].top + bs[i - 1].h - 0.01) overlap = true;
  const lastTop = a.ly - 8, lastBot = lastTop + 16;
  const cover = bs.some((x) => x.top < lastBot && x.top + x.h > lastTop);
  check(!overlap && bs.length >= 8, tag + ': ' + bs.length + ' tags, none overlapping each other (nudged apart)');
  check(!cover, tag + ': no tag covers the last-price tag (last price y ' + a.ly.toFixed(1) + ')');
  check(bs.every((x) => x.top >= a.top - 0.01 && x.top + x.h <= a.bot + 0.01 && x.x >= a.W && x.x + x.w <= a.pw), tag + ': every tag inside the price scale and pane');
  // pure layout unit: 5 at one y in a small pane + one reserved box
  const L = await p.evaluate(() => window.__stkAxisTags.layout([1, 2, 3, 4, 5].map(() => ({ y: 100 })), 0, 120, [{ t: 92, b: 108, gap: 1 }]).map((x) => x.t));
  const Ls = L.slice().sort((x, y) => x - y);
  check(Ls.every((t, i) => i === 0 || t >= Ls[i - 1] + 16) && Ls.every((t) => t >= 0 && t + 16 <= 120 && !(t < 108 && t + 16 > 92)), tag + ': layout(): 5 tags + a reserved box in a 120 px pane never overlap and stay inside ' + JSON.stringify(Ls));
  // 5) turning the trade tags off hides them (hook for the "Show on chart" popover); on again restores
  await p.evaluate(() => window.__stkAxisTags.setTradeTags(false)); await sleep(400);
  a = await AX(p); const pnow = await p.evaluate(() => window.__stkPaper.account.position('futures:NQ1!').tp);
  check(!a.boxes.some((x) => x.text === fmt2(pnow)), tag + ': setTradeTags(false) hides the order/TP/SL tags (hook for the popover)');
  await p.evaluate(() => window.__stkAxisTags.setTradeTags(true)); await sleep(400);
  // shots
  await p.evaluate((id) => window.__stkAxisTags.cellsOf()[0].chart.drawings.select([]), null);
  const shot = `${OUT}/axistags-${tag}.png`; await p.screenshot({ path: shot }); console.log('screenshot', shot);
  // alignment gate: tag text fits its box (squeezed font), 390 no horizontal scroll
  const dw = await p.evaluate(() => document.documentElement.scrollWidth); check(dw <= vp.width, tag + ': no horizontal scroll (' + dw + ')');
  check(errors.length === 0, tag + ': no console errors ' + JSON.stringify(errors.slice(0, 3)));
  await ctx.close();
}

(async () => {
  const srv = await serve();
  const BASE = `http://127.0.0.1:${srv.address().port}`;
  const b = await launch({ args: ['--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768'] });
  const reqs = [];
  try {
    await scenario(b, BASE, reqs, { width: 1440, height: 900 }, 'dark', true);
    if (!process.env.AXTAGS_QUICK) {
      await scenario(b, BASE, reqs, { width: 1440, height: 900 }, 'light', false);
      await scenario(b, BASE, reqs, { width: 390, height: 844 }, 'dark', false);
    }
    const bad = reqs.filter((r) => !r.blocked && r.method !== 'GET' && r.method !== 'WS' && r.method !== 'OPTIONS' && !/\/api\/ai\/grants$|\/connect\/finatic\/data$|hyperliquid\.xyz\/info$/.test(r.url));
    check(bad.length === 0, 'no non-GET request, no order endpoint touched ' + JSON.stringify(bad.slice(0, 3).map((r) => r.method + ' ' + r.url)));
  } catch (e) { fail++; console.log('FAIL exception', e && e.stack || e); }
  finally { timers.forEach(clearInterval); await b.close(); srv.close(); console.log(fail ? fail + ' FAILED' : 'ALL PASSED'); process.exit(fail ? 1 : 0); }
})();
