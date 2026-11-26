// Indian markets in the chart (browser). Mocked: /api/beta/status, /api/chart/india/*, /api/chart/india-info/*. Everything else non-local aborted.
//   node tools/tests/chart-dev-server.mjs 8031 &   CHART_BASE=http://127.0.0.1:8031 node tools/tests/india-browser.js [outdir]
// Checks: beta tester sees Indian symbols; search "nifty" -> chart loads with bars, live tick moves the last bar (mock), NSE chip, logos,
// Sensex shows "15 min delayed" (delay from the mocked info), Nifty "Live"; a member (not beta) sees no Indian symbol and no request is made.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp/india-shots'; fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };
const BASEPX = { NIFTY: 24800, SENSEX: 81000, RELIANCE: 1250 };
let reqs = [], tick = 0; const T0 = Date.now();

async function open(b, { w, h, mobile, beta, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  // the clock reads Wed 25 Nov 2026 11:00 IST (market open) whatever the real time is; timers stay real
  await ctx.addInitScript(() => { const R = Date, off = R.UTC(2026, 10, 25, 5, 30) - R.now(); class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } } window.Date = D; });
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); if (t) localStorage.setItem('stryker-theme', t); } catch (e) {} }, theme === 'light' ? 'light' : '');
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route('**/api/beta/status', (r) => r.fulfill({ json: { beta, admin: false, cap: 30 } }));
  await ctx.route(/\/api\/chart\/rt(\?|$)/, (r) => r.fulfill({ json: { admin: false } }));
  await ctx.route(/\/api\/chart\/india-info\//, (r) => {
    reqs.push(r.request().url());
    const sens = /SENSEX/.test(r.request().url());
    r.fulfill({ json: { delay: sens ? 900 : 0, tick: sens ? 0.01 : 0.05, pv: 1, session: { holidays: [], special: {} } } });
  });
  await ctx.route(/\/api\/chart\/india\//, (r) => {
    reqs.push(r.request().url());
    const u = new URL(r.request().url()), sym = decodeURIComponent(u.pathname.split('/').pop()), tf = u.searchParams.get('tf') || '15';
    const px = BASEPX[sym] || 1000, step = ({ '1': 60, '5': 300, '15': 900, '60': 3600, D: 86400 }[tf] || 900), now = Math.floor(Date.UTC(2026, 10, 25, 5, 30) / 1000) + Math.floor((Date.now() - T0) / 1000), cur = Math.floor(now / step) * step, bars = [];
    // test data: a gentle wave, one page of 300 bars; the last bar moves with `tick` (the "live" mock)
    for (let i = 300; i >= 0; i--) { const t = cur - i * step, c = px + Math.sin(t / 5000) * px * 0.004 + (i === 0 ? tick : 0); bars.push([t, c - 3, c + 6, c - 7, c, 1000 + (i % 17)]); }
    const PS = { '1': 28800, '5': 172800, '15': 432000, '60': 1728000, D: 63072000 }[tf] || 432000, pg = Number(u.searchParams.get('page') || 0);   // PAGE_SECS: a page holds only its own window
    r.fulfill({ json: { s: sym, tf, page: pg, bars: bars.filter((b) => b[0] >= pg * PS && b[0] < (pg + 1) * PS) } });
  });
  const p = await ctx.newPage(), errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|binance|451|status of 4|status of 5|\/api\/chart\/stream|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await sleep(2500);
  return { ctx, p, errors };
}
const setSym = (p, s, tf = '15') => p.evaluate(async ([s, tf]) => { const ws = window.STRYKER_VELA; ws.active.setSymbol(s); ws.active.setTimeframe(tf); for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 300)); if (ws.chart.market.symbol === s && ws.chart.orchestrator.rawBars.length > 50) return true; } return false; }, [s, tf]);
const dot = (p) => p.evaluate(() => { const e = document.querySelector('.vela-cell .stk-dd-tag, .vela-cell [class*="dd-tag"], .vela-statusline [class*="tag"]'); return e ? e.textContent.trim() : (document.querySelector('.vela-statusline') || {}).innerText || ''; });
const ddText = (p) => p.evaluate(() => { const d = document.querySelector('.stkc-dd'); return d ? (d.dataset.s || '') + ' | ' + (d.getAttribute('title') || '') + ' | ' + d.textContent + ' | ' + (d.getAttribute('aria-label') || '') : 'no dot'; });
const last = (p) => p.evaluate(() => { const rb = window.STRYKER_VELA.chart.orchestrator.rawBars, l = rb[rb.length - 1]; return l && (l.close != null ? l.close : l.c); });

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile, theme] of [[1440, 900, false, 'dark'], [390, 844, true, 'dark'], [390, 844, true, 'light']]) {
      const tag = w + '-' + theme;
      reqs = []; tick = 0;
      const { ctx, p, errors } = await open(b, { w, h, mobile, beta: true, theme });
      const ok1 = await setSym(p, 'india:NIFTY'); check(ok1, tag + ': india:NIFTY chart loads with bars');
      await sleep(1200);
      const n = await p.evaluate(() => window.STRYKER_VELA.chart.orchestrator.rawBars.length); check(n > 200, tag + ': bars loaded', n);
      const before = await last(p); tick = 12.5; await sleep(8500); const after = await last(p);
      check(after !== before && Math.abs(after - before) > 5, tag + ': live tick moves the last bar', [before, after]);
      const txt = await ddText(p);
      check(/\| .*Live/i.test(txt) && !/delayed/i.test(txt), tag + ': Nifty tagged Live (delay 0 from the provider)', txt);
      await p.screenshot({ path: OUT + '/nifty-' + tag + '.png' });
      // search
      await p.evaluate(() => { const s = window.__stkSearch || null; }); 
      await p.keyboard.press('Control+k').catch(() => {}); await sleep(600);
      const inp = await p.$('.stkss-input');
      if (inp) {
        await inp.fill('nifty'); await sleep(900);
        const rows = await p.evaluate(() => [...document.querySelectorAll('.stkss-row')].slice(0, 12).map((r) => ({ sym: r.dataset.sym, t: r.innerText.replace(/\n+/g, ' | '), logo: !!r.querySelector('.slg svg, .slg img, .slg-b') })));
        check(rows.some((r) => r.sym === 'india:NIFTY'), tag + ': search "nifty" lists Nifty 50', rows.map((r) => r.sym));
        const nr = rows.find((r) => r.sym === 'india:NIFTY'); check(nr && /NSE/.test(nr.t) && nr.logo, tag + ': row has NSE chip + logo', nr);
        await p.screenshot({ path: OUT + '/search-nifty-' + tag + '.png' });
        await inp.fill('hdfc bank'); await sleep(700);
        const r2 = await p.evaluate(() => [...document.querySelectorAll('.stkss-row')].map((r) => r.dataset.sym));
        check(r2.includes('india:HDFCBANK'), tag + ': "hdfc bank" finds HDFC Bank', r2.slice(0, 8));
        await inp.fill('reliance'); await sleep(700);
        const r3 = await p.evaluate(() => [...document.querySelectorAll('.stkss-row')].map((r) => ({ s: r.dataset.sym, img: (r.querySelector('.slg img') || {}).complete && (r.querySelector('.slg img') || {}).naturalWidth > 0 })));
        const rel = r3.find((r) => r.s === 'india:RELIANCE'); check(!!rel, tag + ': "reliance" finds Reliance', r3.slice(0, 8)); check(rel && rel.img, tag + ': Reliance logo image loaded', rel);
        await p.screenshot({ path: OUT + '/search-reliance-' + tag + '.png' });
        await p.keyboard.press('Escape');
      } else check(false, tag + ': search input opens');
      // Sensex delayed
      await setSym(p, 'india:SENSEX'); await sleep(1500);
      const t2 = await ddText(p);
      check(/15 min delayed/i.test(t2), tag + ': Sensex shows "15 min delayed"', t2);
      await p.screenshot({ path: OUT + '/sensex-' + tag + '.png' });
      // every timeframe returns bars
      for (const tf of ['1', '5', '60', 'D']) { const ok = await setSym(p, 'india:NIFTY', tf); check(ok, tag + ': NIFTY ' + tf + ' loads'); }
      // no vendor names
      const body = await p.evaluate(() => document.body.innerText); check(!/insightsentry/i.test(body), tag + ': no vendor name in the page');
      check(errors.length === 0, tag + ': no console errors', errors);
      await ctx.close();
    }
    // member (not beta): no Indian symbols, no requests
    reqs = [];
    const { ctx, p } = await open(b, { w: 1440, h: 900, beta: false, theme: 'dark' });
    await p.keyboard.press('Control+k'); await sleep(600);
    const inp = await p.$('.stkss-input');
    if (inp) { await inp.fill('nifty'); await sleep(900); const rows = await p.evaluate(() => [...document.querySelectorAll('.stkss-row')].map((r) => r.dataset.sym)); check(!rows.some((s) => /^india:/.test(s)), 'member: no Indian symbol in search', rows.slice(0, 8)); await p.screenshot({ path: OUT + '/member-search-nifty.png' }); }
    else check(false, 'member: search opens');
    check(reqs.length === 0, 'member: no Indian API request', reqs);
    await ctx.close();
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
