// Symbol logos (Owner 24 Nov): the first 40 rows of each search tab carry a logo (img/svg), not initials; centred, transparent, one size.
//   node tools/tests/chart-speed-server.mjs 8291 &  ;  CHART_BASE=http://127.0.0.1:8291 node tools/tests/symbol-logos-browser.js [shotsDir]
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

const MUST = { stocks: ['SPY', 'QQQ', 'AAPL'], crypto: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'], futures: ['ES1!', 'MES1!', 'NQ1!', 'GC1!', 'CL1!'], forex: ['EURUSD'] };
(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=600'] });
  for (const [theme, w, h, mobile] of [['dark', 1440, 900, false], ['light', 390, 844, true], ['dark', 412, 860, true], ['dark', 390, 844, true], ['light', 1440, 900, false]]) {
    const errors = [];
    const ctx = await context(b, w, h, mobile, theme);
    const p = await boot(ctx, errors);
    const tag = w + '-' + theme;
    await p.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); }, theme); await sleep(300);
    await p.mouse.click(Math.round(w / 2), Math.round(h / 2));
    await p.keyboard.press('Control+k'); await sleep(1500);
    if (!await p.$('.stkss-tab')) await p.evaluate(() => window.STRYKER_VELA.symbolPicker.open());
    await sleep(1200);
    for (const tab of ['all', 'stocks', 'crypto', 'futures', 'forex']) {
      await p.click('.stkss-tab[data-tab="' + tab + '"]'); await sleep(1500);
      const rows = await p.evaluate(() => [...document.querySelectorAll('.stkss-row')].slice(0, 40).map((r) => {
        const ic = r.querySelector('.stkss-ic'), g = ic.querySelector('.slg'), im = ic.querySelector('img'), sv = ic.querySelector('svg');
        const q = (e) => { const c = e.getBoundingClientRect(); return { x: c.x + c.width / 2, y: c.y + c.height / 2, w: c.width, h: c.height }; };
        const rb = r.getBoundingClientRect();
        return { tk: r.querySelector('.stkss-tk').textContent, logo: !!(g && !g.classList.contains('slg-b') && (im || sv)), icBox: q(ic), g: g && q(g), rowMid: rb.y + rb.height / 2, bg: getComputedStyle(g || ic).backgroundColor, imgErr: im ? im.complete && im.naturalWidth === 0 : false };
      }));
      check(rows.length > 0, tag + ' ' + tab + ': rows listed', rows.length);
      const need = MUST[tab] || [], bad = rows.filter((r) => !r.logo && (need.includes(r.tk) || tab === 'futures' || tab === 'forex'));
      check(!bad.length, tag + ' ' + tab + ': listed tickers have a logo, not initials', bad.map((r) => r.tk));
      const misc = rows.filter((r) => r.g && (Math.abs(r.g.x - r.icBox.x) > 1 || Math.abs(r.g.y - r.icBox.y) > 1 || Math.abs(r.icBox.y - r.rowMid) > 1));
      check(!misc.length, tag + ' ' + tab + ': logo centred in its circle and row (<=1px)', misc.slice(0, 3));
      check(rows.every((r) => !r.logo || r.bg === 'rgba(0, 0, 0, 0)'), tag + ' ' + tab + ': logo background transparent (no tile)');
      check(rows.every((r) => !r.imgErr), tag + ' ' + tab + ': no broken images');
      check(new Set(rows.map((r) => Math.round(r.icBox.w))).size === 1, tag + ' ' + tab + ': one icon size');
      console.log('  ' + tab + ' first rows:', rows.slice(0, 12).map((r) => r.tk + (r.logo ? '' : '(initials)')).join(' '));
      if (OUT) await p.screenshot({ path: OUT + '/search-' + tag + '-' + tab + '.png' });
    }
    check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), tag + ': no horizontal scroll');
    await p.keyboard.press('Escape'); await sleep(500);
    const hd = await p.evaluate(() => { const l = document.querySelector('.vela-statusline .vela-sl-avatar .slg, .vela-widget-symbol .slg'); return { has: !!l, kind: l && (l.querySelector('img') ? 'img' : l.querySelector('svg') ? 'svg' : 'badge') }; });
    check(hd.has, tag + ': chart header pill shows the symbol logo', hd);
    if (OUT) await p.screenshot({ path: OUT + '/header-' + tag + '.png' });
    check(!errors.length, tag + ': no page errors', errors);
    await ctx.close();
  }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
