// Paper trading on EVERY chartable symbol (Owner 24 Nov: "paper trading should support everything"), browser test.
//
// Offline: the forex bars endpoint (/api/chart/bars/<PAIR>) and the stock engine (/sk-bars) are mocked from prices this test
// controls; every other external request is aborted. Sample data only. Paper only: no broker, no live trading.
//   - fx:GBPCHF: the ticket opens (no "not supported"), shows lots + pips, a market BUY 0.1 lot fills; the CHF -> USD rate comes
//     from the chart's own forex feed (USDCHF), so open P&L = price move x 0.1 x 100,000 / USDCHF; close -> trade P&L in USD
//   - stocks:NASDAQ:AAPL: shares; market BUY 10 fills, close -> P&L = move x 10 (USD, no commission)
//   - stocks:NSE:RELIANCE with NO USDINR feed: the ticket says "Waiting for the INR→USD rate" and a market order is refused
//   - weekend: a GBPCHF market order queues ("fills on the first new price"), fills at the first price after the open
//   - alignment gate: no horizontal scroll at 390, ticket hint text not clipped, Buy/Sell sides share one vertical centre
// Screenshots: ticket GBPCHF 1440 dark, 390 dark, 412 dark; AAPL ticket 1440 light; positions panel 1440.
//   flock /tmp/stryker-chrome.lock node tools/tests/chart-paper-all-browser.js [shotsDir]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { launch, ROOT } = require('./lib.js');
const stub = require('./richstub.js');

const OUT = process.argv[2] || '/tmp';
const T0 = Date.parse('2026-10-07T14:00:00Z');        // Wednesday 10:00 New York: forex + US cash session open
const SAT = Date.parse('2026-10-10T14:00:00Z');       // Saturday: forex closed
const MIN = 60000;
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Sample data: base prices per mocked series
const BASE = { GBPCHF: 1.12, USDCHF: 0.8, EURUSD: 1.1, AAPL: 230, RELIANCE: 2900 };

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
      fs.createReadStream(p).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}
let off = 0;                                          // page clock - node clock (the page runs on T0)
const pnow = () => Date.now() + off;
const flat = (base, n, endMs, step) => { const out = []; for (let i = n; i >= 1; i--) out.push({ t: Math.floor(endMs / step) * step - i * step, p: base }); return out; };

async function newPage(b, url, vp, theme, phone) {
  const ctx = await b.newContext(Object.assign({ viewport: vp, deviceScaleFactor: phone ? 2 : 1 }, phone ? { isMobile: true, hasTouch: true } : {}));
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'dark'); localStorage.setItem('stryker_chart_theme', t); localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1'); } catch (e) {} }, theme);
  const reqs = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = r.request().url();
    if (/book-recorder[^/]*\/sk-bars\?/.test(u)) {
      const code = new URL(u).searchParams.get('code'), tk = code.split(':')[1];
      const inr = code.startsWith('NSE:');
      const now = pnow();
      return r.fulfill({ json: { b: flat(BASE[tk] || 100, 120, now, MIN).map((x) => [x.t, x.p, x.p, x.p, x.p, 100]), lane: 'live', live: false, at: now, now,
        info: { description: tk + ' (sample data)', type: 'STOCK', currency: inr ? 'INR' : 'USD', mintick: 0.01, timezone: 'America/New_York', session: '0000-2359' } } });
    }
    if (/book-recorder[^/]*\/sk-search/.test(u)) return r.fulfill({ json: { r: [] } });
    reqs.push(u); return r.abort();
  });
  await ctx.route(/\/api\/chart\/rt(\?|$)/, (r) => r.fulfill({ json: { admin: false } }));
  await ctx.route(/\/api\/chart\/bars\//, (route) => {
    const u = new URL(route.request().url()), sym = decodeURIComponent(u.pathname.split('/').pop()).toUpperCase();
    if (!BASE[sym]) return route.fulfill({ status: 404, json: { error: 'unknown' } });   // USDINR etc.: no feed in this test
    const now = pnow();
    const bars = flat(BASE[sym], 400, now, MIN).map((x) => [x.t / 1000, x.p, x.p, x.p, x.p, 0]);
    route.fulfill({ json: { s: sym, tf: u.searchParams.get('tf'), page: 0, bars } });
  });
  await ctx.routeWebSocket(/./, (ws) => ws.close());
  const p = await ctx.newPage();
  off = T0 - Date.now();
  await p.clock.install({ time: new Date(T0) });
  const errors = [];
  const IGNORE = [/ERR_FAILED|net::|status of 4|status of 5|Failed to fetch|WebSocket/i];
  p.on('console', (m) => { if (m.type() === 'error' && !IGNORE.some((re) => re.test(m.text()))) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(url + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkPaper && window.__stkPaper.account, null, { timeout: 60000 });
  await p.evaluate(() => window.__stkPaper.setEnabled(true));
  return { ctx, p, errors, reqs };
}
async function setSym(p, sym) {
  return p.evaluate(async (sym) => {
    const ws = window.STRYKER_VELA; ws.active.setSymbol(sym); ws.active.setTimeframe('1');
    const c = ws.chart;
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); if (c.market.symbol === sym && c.orchestrator.rawBars.length > 50) return c.orchestrator.rawBars.length; }
    return 0;
  }, sym);
}
// a real price update on the active chart (the paper feed reads the chart's bars)
async function tick(p, price) {
  await p.evaluate((px) => { const o = window.STRYKER_VELA.chart.orchestrator, lb = o.rawBars[o.rawBars.length - 1]; o.onBar({ time: lb.time + 60000, open: px, high: px, low: px, close: px, volume: 1 }); }, price);
  await p.evaluate(() => window.__stkPaper.poll());
  await sleep(300);
}
async function waitFor(p, fn, arg, ms) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 8000)) { if (await p.evaluate(fn, arg).catch(() => false)) return true; await sleep(200); } return false; }
async function openTicket(p) {
  await p.evaluate(() => window.__stkPaper.openTicket({}));
  await p.waitForSelector('#stkpt-tk:not([hidden])', { timeout: 8000 });
  await sleep(400);
}
const ticketInfo = (p) => p.evaluate(() => {
  const tk = document.getElementById('stkpt-tk'), q = (s) => tk.querySelector(s);
  const r = (el) => el.getBoundingClientRect();
  const hint = q('.stkpt-qhint'), sides = [...tk.querySelectorAll('[data-side]')].map(r), box = r(q('.stkpt-tk-box'));
  return { text: tk.textContent, title: q('#stkpt-tk-h').textContent, hint: hint.textContent, mk: q('.stkpt-mk').hidden ? '' : q('.stkpt-mk').textContent,
    qty: q('input[name=qty]').value, step: q('input[name=qty]').step, hintClip: hint.scrollWidth > hint.clientWidth + 1,
    sideMid: Math.abs((sides[0].top + sides[0].height / 2) - (sides[1].top + sides[1].height / 2)), boxIn: box.left >= 0 && box.right <= innerWidth + 0.5,
    hscroll: document.documentElement.scrollWidth > innerWidth + 1 };
});
const closeTk = (p) => p.evaluate(() => { const x = document.querySelector('#stkpt-tk [data-k=close]'); if (x) x.click(); });

(async () => {
  const srv = await serve();
  const URL0 = `http://127.0.0.1:${srv.address().port}`;
  const b = await launch({ args: ['--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768'] });
  try {
    // ---- desktop 1440 dark: GBPCHF + AAPL round trips, RELIANCE without a rate, weekend queue
    {
      const { ctx, p, errors, reqs } = await newPage(b, URL0, { width: 1440, height: 900 }, 'dark');
      check(await setSym(p, 'fx:GBPCHF') > 50, 'fx:GBPCHF chart loaded (sample data)');
      await tick(p, 1.12);
      check(await waitFor(p, () => window.__stkPaper.account.spec('fx:GBPCHF').pointValue > 0, null, 10000), 'CHF→USD rate read from the chart\'s USDCHF feed');
      const sp = await p.evaluate(() => { const s = window.__stkPaper.account.spec('fx:GBPCHF'); return { kind: s.kind, quote: s.quote, rate: s.rate, pv: s.pointValue }; });
      check(sp.kind === 'forex' && sp.quote === 'CHF' && Math.abs(sp.rate - 1.25) < 1e-9 && Math.abs(sp.pv - 125000) < 1e-6, 'GBPCHF spec: forex, CHF, rate 1/USDCHF = 1.25, $125,000 per 1.0 per lot ' + JSON.stringify(sp));
      await openTicket(p);
      let ti = await ticketInfo(p);
      check(!/not supported/i.test(ti.text), 'GBPCHF ticket opens with no "not supported"');
      check(/1 lot = 100,000 GBP/.test(ti.hint) && /pip/.test(ti.hint) && /CHF → USD/.test(ti.hint), 'ticket hint: lots, pip value, CHF → USD: ' + ti.hint);
      check(ti.qty === '0.1' && ti.step === '0.01', 'default 0.1 lot, step 0.01: ' + ti.qty + ' / ' + ti.step);
      check(!ti.hintClip && ti.sideMid <= 1 && ti.boxIn, 'alignment 1440: hint not clipped, Sell/Buy share one centre (' + ti.sideMid.toFixed(2) + ' px), ticket on screen');
      await p.evaluate(() => { const f = document.querySelector('#stkpt-tk form'); f.slon.checked = true; f.slu.value = 'ticks'; f.slv.value = '200'; f.dispatchEvent(new Event('input', { bubbles: true })); });
      await sleep(300);
      const sl = await p.evaluate(() => document.querySelector('#stkpt-tk .stkpt-brh[data-k=sl]').textContent);
      check(/20\.0 pips/.test(sl) && /-\$25\.00/.test(sl), 'stop 200 ticks = 20.0 pips = 20 CHF at 0.1 lot = -$25.00: ' + sl);
      await p.screenshot({ path: OUT + '/paperall-gbpchf-ticket-1440-dark.png' });
      await p.evaluate(() => { const f = document.querySelector('#stkpt-tk form'); f.slon.checked = false; f.dispatchEvent(new Event('input', { bubbles: true })); });
      await p.click('#stkpt-tk .stkpt-go');
      check(await waitFor(p, () => !!window.__stkPaper.account.position('fx:GBPCHF')), 'GBPCHF market buy 0.1 lot filled (paper)');
      await tick(p, 1.1225);                                  // +25 pips x 0.1 lot = 25 CHF = $31.25
      const up = await p.evaluate(() => window.__stkPaper.account.summary().unrealized);
      check(Math.abs(up - 31.25) < 0.01, 'GBPCHF open P&L in USD: +25 pips x 0.1 lot = 25 CHF x 1.25 = $31.25 → ' + up);
      await p.evaluate(() => window.__stkPaper.openPanel('positions'));
      await sleep(1200);
      const row = await p.evaluate(() => { const tr = [...document.querySelectorAll('#stkpo-dock tr, #stkpt tr')].find((r) => /GBPCHF/.test(r.textContent)); const c = tr && [...tr.querySelectorAll('td')].find((td) => /\$/.test(td.textContent)); return c ? c.textContent.trim() : ''; });
      check(row === '+$31.25', 'positions list shows GBPCHF +$31.25: ' + row);
      await p.screenshot({ path: OUT + '/paperall-positions-1440-dark.png' });
      await p.evaluate(() => window.__stkPaper.closePos('fx:GBPCHF'));
      const tr = await p.evaluate(() => { const t = window.__stkPaper.account.state.trades.slice(-1)[0]; return t && { pnl: t.pnl, quote: t.quote, rate: t.rate, fees: t.fees }; });
      check(tr && tr.pnl === 31.25 && tr.quote === 'CHF' && tr.fees === 0, 'GBPCHF closed: trade P&L $31.25, quote CHF, no commission ' + JSON.stringify(tr));

      // AAPL
      check(await setSym(p, 'stocks:NASDAQ:AAPL') > 50, 'stocks:NASDAQ:AAPL chart loaded (sample data)');
      await tick(p, 230);
      await openTicket(p);
      ti = await ticketInfo(p);
      check(/Shares of/.test(ti.hint) && ti.qty === '1' && ti.step === '1', 'AAPL ticket: shares, step 1: ' + ti.hint + ' / ' + ti.qty);
      await p.evaluate(() => { const f = document.querySelector('#stkpt-tk form'); f.qty.value = '10'; f.dispatchEvent(new Event('input', { bubbles: true })); });
      await p.click('#stkpt-tk .stkpt-go');
      check(await waitFor(p, () => { const x = window.__stkPaper.account.position('stocks:NASDAQ:AAPL'); return x && x.qty === 10; }), 'AAPL market buy 10 shares filled (paper)');
      await tick(p, 232.5);
      await p.evaluate(() => window.__stkPaper.closePos('stocks:NASDAQ:AAPL'));
      const ta = await p.evaluate(() => window.__stkPaper.account.state.trades.slice(-1)[0]);
      check(ta.symbol === 'stocks:NASDAQ:AAPL' && ta.pnl === 25 && ta.fees === 0, 'AAPL closed: +2.50 x 10 = $25.00, no commission → ' + ta.pnl);

      // RELIANCE: no USDINR feed in this test
      check(await setSym(p, 'stocks:NSE:RELIANCE') > 50, 'stocks:NSE:RELIANCE chart loaded (sample data)');
      await tick(p, 2900);
      await sleep(1500);
      await openTicket(p);
      ti = await ticketInfo(p);
      check(/Waiting for the INR→USD rate/.test(ti.mk), 'RELIANCE without a USDINR price: "' + ti.mk + '"');
      const rej = await p.evaluate(() => { try { window.__stkPaper.account.placeOrder({ symbol: 'stocks:NSE:RELIANCE', side: 'buy', type: 'market', qty: 1 }); return 'placed'; } catch (e) { return e.message; } });
      check(/Waiting for the INR→USD rate/.test(rej), 'market order held, never filled at a guessed rate: ' + rej);
      await closeTk(p);

      // weekend: GBPCHF market order queues, fills at the first price after the open
      await setSym(p, 'fx:GBPCHF'); await tick(p, 1.12);
      await p.clock.setSystemTime(new Date(SAT));
      await p.evaluate(() => window.__stkPaper.placeOrder({ symbol: 'fx:GBPCHF', side: 'sell', type: 'market', qty: 0.2 }));
      const q = await p.evaluate(() => window.__stkPaper.account.state.orders.map((o) => o.type + ':' + !!o.queued));
      check(q.join() === 'market:true', 'Saturday: GBPCHF market order queued ' + q.join());
      const qt = await p.evaluate(() => window.__stkPaper.toasts.slice(-1)[0].msg);
      check(/market closed, it fills on the first new price/.test(qt), 'queued toast: ' + qt);
      await p.clock.setSystemTime(new Date(T0 + 3600e3));
      await tick(p, 1.121);
      const pos = await p.evaluate(() => { const x = window.__stkPaper.account.position('fx:GBPCHF'); return x && { side: x.side, qty: x.qty, avg: x.avg }; });
      check(pos && pos.side === 'sell' && pos.qty === 0.2 && pos.avg === 1.121, 'market open again: queued order filled at the first new price ' + JSON.stringify(pos));
      await p.evaluate(() => window.__stkPaper.closePos('fx:GBPCHF'));
      check(errors.length === 0, 'no page errors: ' + errors.slice(0, 3).join(' | '));
      check(!reqs.some((u) => /order|broker|trade/i.test(u) && !/book-recorder/.test(u)) , 'no broker / order request');
      await ctx.close();
    }
    // ---- AAPL ticket, light 1440
    {
      const { ctx, p } = await newPage(b, URL0, { width: 1440, height: 900 }, 'light');
      await setSym(p, 'stocks:NASDAQ:AAPL'); await tick(p, 230);
      await openTicket(p);
      const ti = await ticketInfo(p);
      check(!ti.hintClip && ti.sideMid <= 1, 'light 1440 AAPL ticket aligned');
      await p.screenshot({ path: OUT + '/paperall-aapl-ticket-1440-light.png' });
      await ctx.close();
    }
    // ---- phones
    for (const w of [390, 412]) {
      const { ctx, p, errors } = await newPage(b, URL0, { width: w, height: 844 }, 'dark', true);
      await setSym(p, 'fx:GBPCHF'); await tick(p, 1.12);
      await waitFor(p, () => window.__stkPaper.account.spec('fx:GBPCHF').pointValue > 0, null, 10000);
      await openTicket(p);
      const ti = await ticketInfo(p);
      check(!ti.hscroll && !ti.hintClip && ti.boxIn && ti.sideMid <= 1, w + ': no horizontal scroll, hint not clipped, ticket on screen, sides centred ' + JSON.stringify({ h: ti.hscroll, c: ti.hintClip, b: ti.boxIn, m: ti.sideMid }));
      await p.screenshot({ path: OUT + '/paperall-gbpchf-ticket-' + w + '-dark.png' });
      check(errors.length === 0, w + ': no page errors: ' + errors.slice(0, 3).join(' | '));
      await ctx.close();
    }
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  finally { await b.close(); srv.close(); }
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})();
