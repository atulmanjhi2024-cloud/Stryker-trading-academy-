// TICK bars on a dated futures CONTRACT MONTH (member bug 25 Nov: MESZ2026 100 ticks -> "not available ... Showing 1 minute").
// HERMETIC: the tick engine's /te-bars answer is stubbed inside the test (Sample data: a seeded tape built here, N-tick bars = every N trades),
// plus a fixture contract feed (ES/NQ front = Dec 2026). No hub, no websockets venv, no Worker, no key, no network.
//   node tools/tests/chart-dev-server.mjs 8055 &
//   CHART_BASE=http://127.0.0.1:8055 node tools/tests/tick-month-browser.js <shotsDir> [tag]
// MESZ2026 and MNQZ2026 at 100T (chart symbol 'futures:MNQZ6' folds to MNQ1! by design, chart-sym.js; the short form is in tick-month.test.mjs): tick bars load (read from the MES / MNQ record, = MES1!), the chart stays on 100T past the 15 s
// "no bars" watch, no fallback toast. MESH2027 (not the live month) 100T: refused at once with an honest message, chart stays put.
// Shots: 1440 dark + light, 390 dark.
// (HUB 127.0.0.1:9: nothing listens; the route stub answers it)
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8055', HUB = 'http://127.0.0.1:9', OUT = process.argv[2] || '/tmp/tick-month', TAG = process.argv[3] || 'after';
fs.mkdirSync(OUT, { recursive: true });
const V = JSON.parse(fs.readFileSync(__dirname + '/../../assets/version.json', 'utf8')).build;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };
const roll = (k) => [{ c: k + 'Z2026', d: '20261218' }, { c: k + 'H2027', d: '20270319' }, { c: k + 'M2027', d: '20270618' }];
const SYMINFO = { v: 1, t: 0, syms: {
  ES: { kind: 'fut', name: 'E-mini S&P 500 Futures', ex: 'CME', tick: 0.25, pv: 50, contract: 'ESZ2026', roll: roll('ES') },
  NQ: { kind: 'fut', name: 'E-mini Nasdaq-100 Futures', ex: 'CME', tick: 0.25, pv: 20, contract: 'NQZ2026', roll: roll('NQ') } } };
// Sample data tape: 30000 trades, seeded random walk. N-tick bars = every N trades: [t,o,h,l,c,vol,buyVol].
const TAPE = (() => { let x = 7, t = Date.now() - 72e5, p = 28400; const out = []; const r = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 30000; i++) { t += Math.floor(r() * 400); p += Math.floor(r() * 3) - 1; out.push([t, p * 0.25, 1 + Math.floor(r() * 4), r() < 0.5 ? 1 : -1]); } return out; })();
function tickBars(n, limit) { const out = []; TAPE.forEach((q, i) => { if (i % n === 0) out.push([q[0], q[1], q[1], q[1], q[1], 0, 0]); const o = out[out.length - 1]; o[2] = Math.max(o[2], q[1]); o[3] = Math.min(o[3], q[1]); o[4] = q[1]; o[5] += q[2]; o[6] += q[3] > 0 ? q[2] : 0; }); return out.slice(-limit); }
const CLOCK = Date.UTC(2026, 10, 25, 15);   // 25 Nov 2026: Dec is the front month

async function page(b, w, h, theme, mobile) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(([hub, t, now]) => {
    window.__STK_BOOK_RECORDER = hub;
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', t); localStorage.setItem('theme', t); } catch (e) {}
    window.__toasts = [];
    let real = null;   // every toast the page shows (window.showToast is set later by the site's toast module)
    Object.defineProperty(window, 'showToast', { configurable: true, set(f) { real = f; }, get() { return (t, m) => { window.__toasts.push(String(m)); return real && real(t, m); }; } });
  }, [HUB, theme, CLOCK]);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/^http:\/\/127\.0\.0\.1:9\//, (r) => {
    const u = new URL(r.request().url()), tf = u.searchParams.get('tf') || '', cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-te-lane', 'access-control-allow-headers': 'authorization', 'x-te-lane': 'live' };
    if (u.pathname === '/te-bars' && /T$/.test(tf)) return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ sym: u.searchParams.get('sym'), tf, b: tickBars(parseInt(tf, 10), +u.searchParams.get('limit') || 500), rec: TAPE[0][0], e: 1, q: TAPE.length, c: 0, more: 0, cut: null }) });
    return r.fulfill({ status: 404, headers: cors, body: '' });
  });
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/scan\?part=syminfo/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SYMINFO) }));
  const p = await ctx.newPage(); p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  await p.goto(BASE + '/charts.html?engine=1', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkIntervals, null, { timeout: 60000 });
  await p.evaluate(async (v) => { (await import('/assets/rt-access.js?v=' + v))._rtSetForTests(true, 'test-token'); }, V);
  return p;
}
// symbol on 1m first, then 100T through the interval picker's own apply (= the member's tap); wait past the 15 s watch
async function tick(p, sym, wait) {
  return p.evaluate(async ([sym, wait]) => {
    const ws = window.STRYKER_VELA, c = ws.cell(ws.active.id);
    c.setSymbol(sym); c.setTimeframe('1');
    for (let i = 0; i < 100 && !(c.chart.orchestrator.config.market.symbol === sym && c.chart.orchestrator.rawBars.length); i++) await new Promise((r) => setTimeout(r, 200));
    window.__toasts.length = 0;
    const applied = window.__stkIntervals.apply('100T');
    await new Promise((r) => setTimeout(r, wait));
    const o = c.chart.orchestrator;
    return { applied, tf: String(c.timeframe), sym: o.config.market.symbol, bars: o.config.market.timeframe === '100T' ? o.rawBars.length : 0, toasts: window.__toasts.slice() };
  }, [sym, wait]);
}

(async () => {
  const b = await launch();
  try {
    const p = await page(b, 1440, 900, 'night');
    for (const sym of ['futures:MESZ2026', 'futures:MNQZ2026']) {
      const r = await tick(p, sym, 17000);
      check(r.applied && r.tf === '100T' && r.bars >= 50, sym + ' 100T: stays on 100 ticks with bars', r);
      check(!r.toasts.some((t) => /not available/i.test(t)), sym + ' 100T: no "not available ... Showing 1 minute" toast', r.toasts);
      if (sym.includes('MES')) await p.screenshot({ path: OUT + '/' + TAG + '-MESZ2026-100T-1440-dark.png' });
    }
    const r = await tick(p, 'futures:MESH2027', 1500);
    check(!r.applied && r.tf === '1' && r.toasts.some((t) => /MESH2027.*front month/i.test(t)), 'MESH2027 100T (not the live month): refused at once, honest toast', r);
    await p.screenshot({ path: OUT + '/' + TAG + '-MESH2027-refused-1440-dark.png' });
    check(p.errors.length === 0, 'no page errors (dark)', p.errors.slice(0, 3));
    await p.context().close();

    const l = await page(b, 1440, 900, 'day');
    const rl = await tick(l, 'futures:MESZ2026', 17000);
    check(rl.tf === '100T' && rl.bars >= 50, 'light: MESZ2026 100T bars', rl);
    await l.screenshot({ path: OUT + '/' + TAG + '-MESZ2026-100T-1440-light.png' });
    await l.context().close();

    const m = await page(b, 390, 844, 'night', true);
    const rm = await tick(m, 'futures:MESZ2026', 17000);
    check(rm.tf === '100T' && rm.bars >= 50, '390: MESZ2026 100T bars', rm);
    const sx = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(sx <= 0, '390: no horizontal scroll', sx);
    await m.screenshot({ path: OUT + '/' + TAG + '-MESZ2026-100T-390-dark.png' });
    // PHONE PICKER (member ArturroX 25 Nov: "tick charts on mobile"): at 390 touch the caret opens the sheet; 1/10/100/1000 ticks are listed, fully on screen, and a TAP on 1000 ticks applies it
    await m.evaluate(() => { const ws = window.STRYKER_VELA, c = ws.cell(ws.active.id); c.setTimeframe('1'); });
    await m.evaluate(() => document.querySelector('.stk-iv-caret').click());
    await sleep(600);
    const pk = await m.evaluate(() => { const mn = document.querySelector('.stk-iv-menu'); const rows = [...mn.querySelectorAll('li')].filter((l) => /tick/i.test(l.textContent)).map((l) => { const r = l.getBoundingClientRect(); return { t: l.textContent.trim(), x: r.x, w: r.width, top: r.top, h: r.height, sw: l.scrollWidth, cw: l.clientWidth }; }); return { sheet: mn.classList.contains('sheet'), rows, vh: innerHeight }; });
    check(pk.sheet && pk.rows.map((r) => r.t.replace(/\s*★.*/, '')).join('|').match(/1 tick.*10 ticks.*100 ticks.*1000 ticks/), '390 picker: 1/10/100/1000 ticks are listed', pk.rows.map((r) => r.t));
    check(pk.rows.length === 4 && pk.rows.every((r) => r.top >= 0 && r.top + r.h <= pk.vh && r.x >= 0 && r.x + r.w <= 390 && r.h >= 40 && r.sw <= r.cw + 1), '390 picker: tick rows on screen, >=40px tall (touch), not clipped', pk.rows);
    await m.screenshot({ path: OUT + '/' + TAG + '-picker-390-dark.png' });
    await m.evaluate(() => [...document.querySelectorAll('.stk-iv-menu li')].find((l) => /1000 ticks/.test(l.textContent)).click());
    await sleep(8000);
    const tp = await m.evaluate(() => { const ws = window.STRYKER_VELA, c = ws.cell(ws.active.id); return { tf: String(c.timeframe), menuHidden: document.querySelector('.stk-iv-menu').hidden }; });
    check(tp.tf === '1000T' && tp.menuHidden, '390 picker: tapping 1000 ticks applies it and closes the sheet', tp);
    await m.context().close();
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
