// Live crypto footprint vs Binance's own aggTrades (Owner bug 22 Nov: "the live footprint bar looks frozen").
//   node tools/tests/chart-dev-server.mjs 8031
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node --max-old-space-size=768 \
//     tools/tests/fp-live-binance-browser.js [shotsDir]
// Talks to the REAL public Binance endpoints (no key). SYM=binance:ETHUSDT etc. to check another pair; SECS=60 window.
// Checks, over a SECS-long window with the footprint chart type on and the chart live:
//   - the trades the footprint holds for the window are within 2 % of Binance aggTrades (REST, same window) by volume
//     and by count (in practice they match exactly: same ids);
//   - the footprint layer re-painted >= 30 times in the window (it follows the trades, it is not frozen);
//   - the live bar's volume grew during the window.
const { launch } = require('./lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
const SYM = process.env.SYM || 'binance:BTCUSDT';
const SECS = +process.env.SECS || 60;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 400) : '')); };
const PAIR = SYM.split(':').pop().replace(/\.P$/i, '').toUpperCase();
const PERP = /\.P$/i.test(SYM);
const RESTS = PERP ? ['https://fapi.binance.com/fapi/v1'] : ['https://api.binance.com/api/v3', 'https://data-api.binance.vision/api/v3'];

async function binance(from, to) {
  let err;
  for (const base of RESTS) {
    try {
      const all = []; let fromId = null;
      for (let i = 0; i < 60; i++) {
        const q = fromId == null ? `&startTime=${from}&endTime=${to - 1}&limit=1000` : `&fromId=${fromId}&limit=1000`;
        const r = await fetch(`${base}/aggTrades?symbol=${PAIR}${q}`);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const pg = await r.json(), inWin = pg.filter((t) => t.T >= from && t.T < to);
        all.push(...inWin);
        if (pg.length < 1000 || inWin.length < pg.length) break;
        fromId = pg[pg.length - 1].a + 1;
      }
      return { buckets: new Set(all.map((t) => Math.floor(t.T / 200))).size, n: all.length, vol: all.reduce((s, t) => s + +t.q, 0), minId: all.length ? all[0].a : null, maxId: all.length ? all[all.length - 1].a : null };
    } catch (e) { err = e; }
  }
  throw err;
}

(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.removeItem('stryker.vela.session'); } catch (e) {} });
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => { if (!/onAuthStateChanged|f\.auth is not a function/.test(String(e))) errors.push(String(e).slice(0, 200)); });   // local dev server: no Firebase config
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkOrderflow, null, { timeout: 90000 });
    await sleep(2500);
    await p.evaluate(async (s) => {
      const ws = window.STRYKER_VELA; ws.active.setSymbol(s); ws.active.setTimeframe('1');
      for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.market.symbol === s && ws.chart.orchestrator.rawBars.length > 50) break; }
      ws.active.setPriceStyle('stk_fp');
      const c = ws.chart, rb = c.orchestrator.rawBars, k = rb.length; c.setVisibleRange({ from: rb[k - 12].time, to: rb[k - 1].time + 120000 });
    }, SYM);
    await p.waitForFunction(() => { const c = window.__stkOrderflow.crypto(); return c && c.status === 'live' && c.minutes > 5; }, null, { timeout: 60000 });
    await sleep(3000);   // let the backfill gap fill land
    const t0 = await p.evaluate(() => Date.now());
    const p0 = await p.evaluate(() => window.__stkFpPaints || 0);
    const v0 = await p.evaluate(() => window.__stkOrderflow.crypto().lastVol);
    await sleep(SECS * 1000);
    const t1 = await p.evaluate(() => Date.now());
    const p1 = await p.evaluate(() => window.__stkFpPaints || 0);
    await sleep(3000);   // trades stamped before t1 can arrive a moment later
    const ours = await p.evaluate(([a, z]) => window.__stkOrderflow.cryptoWindow(a, z), [t0, t1]);
    const last = await p.evaluate(() => window.__stkOrderflow.crypto());
    await p.screenshot({ path: OUT + '/fp-live-binance-1440.png' });
    const ref = await binance(t0, t1);
    const dv = ref.vol > 0 ? Math.abs(ours.vol - ref.vol) / ref.vol : (ours.vol === 0 ? 0 : 1);
    const dn = ref.n > 0 ? Math.abs(ours.n - ref.n) / ref.n : (ours.n === 0 ? 0 : 1);
    console.log('WINDOW', new Date(t0).toISOString(), '->', new Date(t1).toISOString(), SYM);
    console.log('OURS   ', JSON.stringify({ n: ours.n, vol: +ours.vol.toFixed(6), minId: ours.minId, maxId: ours.maxId }));
    console.log('BINANCE', JSON.stringify({ n: ref.n, vol: +ref.vol.toFixed(6), minId: ref.minId, maxId: ref.maxId }));
    check(ref.n > 0, 'Binance traded in the window', ref);
    check(dv <= 0.02, `footprint volume within 2 % of Binance aggTrades (off ${(dv * 100).toFixed(3)} %)`);
    check(dn <= 0.02, `footprint trade count within 2 % of Binance aggTrades (off ${(dn * 100).toFixed(3)} %)`);
    check(p1 - p0 >= 30, `footprint re-painted >= 30 times in ${SECS} s (${p1 - p0}, ${((p1 - p0) / SECS).toFixed(1)}/s; trades fell in ${ref.buckets} distinct 200 ms slots)`);
    check(last.lastVol !== v0 || ref.n === 0, 'live bar volume changed during the window', { v0, v1: last.lastVol });
    check(!errors.length, 'no page errors', errors);
  } finally { await b.close(); }
  console.log(fail ? `FAIL (${fail})` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
