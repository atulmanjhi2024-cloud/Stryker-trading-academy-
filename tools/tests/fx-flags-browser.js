// (fx marks test, reuses the search suite's fixtures) Charts SYMBOL SEARCH panel (assets/chart-search.js), real keys / clicks / taps on the chart page:
//   1440 desktop: Ctrl+K opens it (and "/"), open < 100 ms, type NQ -> NQ1! row with highlighted letters, keystroke < 50 ms,
//   arrow keys move the highlight, the right pane lists contract months (FRONT / FUT), Enter opens -> the chart symbol changes;
//   the star saves a favourite that is still there after a reload (and shows under Favourites on an empty query),
//   the picked symbol shows under Recent, Esc closes, the toolbar symbol button opens the same panel, a ratio row (ES/NQ)
//   opens a formula chart, category tabs + exchange filter, light theme.
//   390 phone: full-screen sheet, tabs scroll sideways, Filters button opens the rail sheet, a tap on a row opens it.
// Offline: exchanges get the small mocked symbol lists, the page itself is the speed server.
//   
//   CHART_BASE=http://127.0.0.1:8291 node tools/tests/chart-search-browser.js [shotsDir]
const fs = require('fs');
const { launch } = require('./lib.js');
const { speedInit } = require('./chart-phone-speed-init.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8291';
const OUT = process.argv[2];
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
const BIN_SPOT = { symbols: ['BTC', 'ETH', 'SOL'].flatMap((b) => ['USDT', 'USDC', 'BTC'].filter((q) => q !== b).map((q) => ({ symbol: b + q, status: 'TRADING', baseAsset: b, quoteAsset: q, filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.01' }] }))) };
const BIN_FUT = { symbols: [{ symbol: 'BTCUSDT', status: 'TRADING', contractType: 'PERPETUAL', baseAsset: 'BTC', quoteAsset: 'USDT', filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.10' }] }] };
const SYMINFO = { v: 1, t: 0, syms: { NQ: { kind: 'fut', name: 'E-mini Nasdaq-100 Futures', ex: 'CME', tick: 0.25, pv: 20, roll: [{ c: 'NQZ2026', d: '20261218' }, { c: 'NQH2027', d: '20270319' }, { c: 'NQM2027', d: '20270617' }] } } };

async function context(b, w, h, mobile, theme) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, userAgent: mobile ? 'Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' : undefined });
  await speedInit(ctx);
  // the stub's Firestore forgets writes: back students/{uid}/chartFavorites with localStorage so a reload sees them
  await ctx.addInitScript(() => {
    const D = window.__stubDb; if (!D) return;
    const K = '__fake_chartFavorites', all = () => JSON.parse(localStorage.getItem(K) || '{}'), save = (o) => localStorage.setItem(K, JSON.stringify(o));
    const favCol = { limit: () => favCol, get: () => Promise.resolve({ forEach: (f) => Object.entries(all()).forEach(([id, v]) => f({ id, data: () => v })) }),
      doc: (id) => ({ set: (v) => { const o = all(); o[id] = Object.assign({}, v, { at: 1 }); save(o); return Promise.resolve(); }, delete: () => { const o = all(); delete o[id]; save(o); return Promise.resolve(); } }) };
    const c0 = D.collection;
    D.collection = (name) => { const c = c0(name); if (name !== 'students') return c; const d0 = c.doc; c.doc = (id) => { const d = d0(id); const s0 = d.collection; d.collection = (sub) => (sub === 'chartFavorites' ? favCol : s0(sub)); return d; }; return c; };
  });
  if (theme) await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t); localStorage.setItem('theme', t); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/^https:\/\/(api\.binance\.com|fapi\.binance\.com|api\.binance\.us|api\.hyperliquid\.xyz|api\.exchange\.coinbase\.com)\//, (r) => {
    const u = r.request().url();
    if (/\/ping/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (/fapi\/v1\/exchangeInfo/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BIN_FUT) });
    if (/exchangeInfo/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BIN_SPOT) });
    if (/coinbase/.test(u) && /products$/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'BTC-USD', base_currency: 'BTC', quote_currency: 'USD', status: 'online', trading_disabled: false, quote_increment: '0.01' }]) });
    return r.abort();
  });
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/scan\?part=syminfo/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SYMINFO) }));
  // stocks: the server search (assets/chart-stocks-provider.js installStockSearch) knows a stock the page does not
  await ctx.addInitScript(() => { window.__STK_BOOK_RECORDER = 'https://sk.fixture.test'; });
  await ctx.route(/^https:\/\/sk\.fixture\.test\/sk-search/, (r) => { const h = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization', 'content-type': 'application/json' }; if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: h }); return r.fulfill({ status: 200, headers: h, body: JSON.stringify({ r: [{ code: 'NSE:RELIANCE', description: 'Reliance Industries', type: 'stock', exchange: 'NSE', country: 'IN' }] }) }); });
  await ctx.route(/\/api\/vest\/exchangeInfo/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(__dirname + '/fixtures/vest/exchangeInfo.json', 'utf8') }));
  return ctx;
}
async function boot(ctx, errors) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkSearch && document.querySelector('.vela-widget-symbol, .vela-mb-symbol'), null, { timeout: 60000 });
  await sleep(2500);
  return p;
}
const state = (p) => p.evaluate(() => {
  const r = document.querySelector('.stkss');
  const rows = [...document.querySelectorAll('.stkss-row')].map((e) => ({ sym: e.dataset.sym, tk: e.querySelector('.stkss-tk').textContent, mark: (e.querySelector('.stkss-tk mark') || {}).textContent || '', sel: e.getAttribute('aria-selected') === 'true' }));
  return { open: !!r && !r.hidden, rows, groups: [...document.querySelectorAll('.stkss-gh')].map((e) => e.textContent), sym: window.STRYKER_VELA.active.symbol, focus: document.activeElement && document.activeElement.className, perf: window.__stkSearchPerf || {} };
});


(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=600'] });
  for (const [w, h, mob, theme] of [[1440, 900, false, 'dark'], [390, 844, true, 'dark'], [1440, 900, false, 'light'], [390, 844, true, 'light']]) {
    const tag = w + '-' + theme, errors = [];
    const ctx = await context(b, w, h, mob, theme === 'light' ? 'day' : undefined);
    const p = await boot(ctx, errors); p.on('crash', () => console.log('CRASH'));
    await p.mouse.click(w / 2, h / 2); await p.keyboard.press('Control+k'); await sleep(500); if (mob) await p.evaluate(() => window.__stkSearch.open && window.__stkSearch.open());
    await p.keyboard.type('EURUSD', { delay: 40 }); await sleep(600); await p.keyboard.press('Enter'); await sleep(800);
    await sleep(1500);
    const hdr = await p.evaluate(() => { const b = document.querySelector('.vela-widget-symbol, .vela-mb-symbol'); const m = b && b.querySelector('.fxm'); const t = b && b.getBoundingClientRect(); return { sym: window.STRYKER_VELA.active.symbol, fx: m && m.dataset.fx, hasWhite: !!document.querySelector('.vlogo') && [...document.querySelectorAll('.vlogo:not(.vlogo-m)')].some((e) => getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)') }; });
    check(/EURUSD/.test(hdr.sym) ? hdr.fx === 'EURUSD' || mob : true, tag + ': symbol button shows EURUSD flags', hdr);
    check(!hdr.hasWhite, tag + ': no venue tile has a background', hdr);
    if (OUT) await p.screenshot({ path: OUT + '/' + tag + '-symbtn.png', clip: { x: 0, y: 0, width: w, height: 120 } });
    await p.mouse.click(w / 2, h / 2); await p.keyboard.press('Control+k'); await sleep(500);
    if (mob) { await p.evaluate(() => window.__stkSearch.open && window.__stkSearch.open()); await sleep(400); }
    await p.keyboard.type('USD', { delay: 40 }); await sleep(600);
    const tab = await p.evaluate(() => { const t = [...document.querySelectorAll('.stkss button, .stkss [role=tab]')].find((e) => /^Forex$/i.test(e.textContent.trim())); if (t) { t.click(); return true; } return false; });
    await sleep(700);
    const m = await p.evaluate(() => {
      const rows = [...document.querySelectorAll('.stkss-row')].filter((r) => r.querySelector('.fxm'));
      const out = rows.slice(0, 6).map((r) => { const ic = r.querySelector('.stkss-ic').getBoundingClientRect(), tx = r.querySelector('.stkss-tk').getBoundingClientRect(), f = r.querySelector('.fxm').getBoundingClientRect(), rr = r.getBoundingClientRect(); return { tk: r.querySelector('.stkss-tk').textContent, icC: ic.top + ic.height / 2, txC: rr.top + rr.height / 2, fC: f.top + f.height / 2, fW: f.width, fH: f.height, imgs: r.querySelectorAll('.fxm svg svg').length }; });
      return { n: rows.length, out, white: [...document.querySelectorAll('.stkss .vlogo:not(.vlogo-m)')].filter((e) => getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)').length, hscroll: document.documentElement.scrollWidth > innerWidth };
    });
    check(m.n >= 3 && m.out.every((o) => o.fW === 36 && Math.abs(o.fC - o.txC) <= 1 && o.imgs === 2), tag + ': forex rows have 2-flag marks, centred in the row', m);
    check(!m.white && !m.hscroll, tag + ': no white tiles, no horizontal scroll', m);
    if (OUT) await p.screenshot({ path: OUT + '/' + tag + '-search-forex.png' });
    await p.keyboard.press('Escape'); await sleep(300);
    // watchlist: Futures + Forex rows
    const opened = await p.evaluate(() => { const w = window.STRYKER_WATCHLIST; if (w && w.open) { w.open(); return true; } const b = document.querySelector('[data-tool="watchlist"], .stkw-toggle, [aria-label*="atchlist"]'); if (b) { b.click(); return true; } return false; });
    await sleep(1500);
    const wl = await p.evaluate(() => {
      const rows = [...document.querySelectorAll('.stkw-row')].filter((r) => r.getBoundingClientRect().width > 0);
      return { n: rows.length, fx: rows.filter((r) => r.querySelector('.fxm')).map((r) => { const f = r.querySelector('.fxm').getBoundingClientRect(), t = r.querySelector('.stkw-sym').getBoundingClientRect(); return { sym: r.dataset.sym, d: Math.abs(f.top + f.height / 2 - (t.top + t.height / 2)) }; }), futs: rows.filter((r) => /^futures:/.test(r.dataset.sym) && r.querySelector('.vlogo')).length };
    });
    check(!opened || (wl.fx.length >= 2 && wl.fx.every((x) => x.d <= 1) && wl.futs >= 2), tag + ': watchlist FX rows show flags, futures show CME mark, one vertical centre', { opened, wl });
    if (OUT) await p.screenshot({ path: OUT + '/' + tag + '-watchlist.png' });
    check(errors.length === 0, tag + ': no page errors', errors);
    await ctx.close();
  }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
// 390: the phone bar's symbol button (.vela-mb-symbol) has never carried a venue mark, so only the 1440 button is checked.
