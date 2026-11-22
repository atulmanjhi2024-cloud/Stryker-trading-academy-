// Phone top bar never overlaps (member Mr.P, iPhone Safari, 2026-11-21): a long workspace name and a big negative
// P&L chip ("-$65,045.30") ran into the symbol and the tool icons. At 375 and 390 (and 1440 for the desktop check):
// no two bar controls' boxes overlap, the chip's text fits its box, the workspace name ellipsizes, no h-scroll.
//   node tools/tests/chart-speed-server.mjs 8271 &
//   CHART_BASE=http://127.0.0.1:8271 flock /tmp/stryker-chrome.lock node tools/tests/chart-phone-bar-overlap-browser.js [shotsDir]
const fs = require('fs');
const { launch } = require('./lib.js');
const { speedInit } = require('./chart-phone-speed-init.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8271';
const OUT = process.argv[2];
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 500))); };

// runs in the page. Sample data only: the chip text and workspace name are forced to the worst case.
function measure() {
  const wn = document.querySelector('.stkws-name'); if (wn) wn.textContent = 'My very long workspace name for NQ scalping';
  const pb = document.querySelector('.stkas'); if (pb) pb.hidden = false;
  document.querySelectorAll('.stkas-f').forEach((e) => { e.textContent = '-$65,045.30'; });
  document.querySelectorAll('.stkas-s').forEach((e) => { e.textContent = '-$65.0K'; });
  document.querySelectorAll('.stkas-v').forEach((e) => { e.className = 'stkas-v down'; });
  const vw = document.documentElement.clientWidth;
  const hosts = ['.mobile-topnav', '#stkc-bar'].map((s) => document.querySelector(s)).filter(Boolean);
  const sel = 'button, a, [role=button], .mclock-pill, .stkas, .stkws-btn, .vela-mb-symbol';
  const items = []; const seen = new Set();
  for (const hst of hosts) for (const e of hst.querySelectorAll(sel)) {
    if (seen.has(e) || e.closest('.stkc-pop, .stkc-ob-pop, #stkc-credits, .mclock-pop, .stkas-pop, [hidden]') || !e.getClientRects().length) continue;
    seen.add(e); const r = e.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden') items.push({ e, r, n: (e.id || (e.className && e.className.baseVal === undefined ? e.className : '') || e.tagName).toString().slice(0, 30) });
  }
  const overlaps = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j]; if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
    const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (w > 1 && h > 1) overlaps.push(a.n + ' x ' + b.n);
  }
  const spill = items.filter((o) => o.r.left < -0.5 || o.r.right > vw + 0.5).map((o) => o.n);
  const chip = document.querySelector('.stkas:not([hidden]) .stkas-b');
  let chipInfo = null;
  if (chip) { const t = [...chip.querySelectorAll('.stkas-v')].find((e) => e.getClientRects().length); const tr = t && t.getBoundingClientRect(), cr = chip.getBoundingClientRect(); chipInfo = { visible: !!t, fits: !t || (tr.left >= cr.left - 0.5 && tr.right <= cr.right + 0.5), w: Math.round(cr.width) }; }
  const nm = document.querySelector('.stkws-name'); const nmI = nm && nm.getClientRects().length ? { clipped: nm.scrollWidth > nm.clientWidth, ell: getComputedStyle(nm).textOverflow === 'ellipsis' } : null;
  const ys = items.filter((o) => o.r.top < 60).map((o) => o.r.top + o.r.height / 2);
  return { overlaps, spill, chipInfo, nmI, hscroll: document.documentElement.scrollWidth > vw + 1, n: items.length, rowSpread: ys.length ? Math.round((Math.max(...ys) - Math.min(...ys)) * 10) / 10 : 0 };
}

(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=600'] });
  for (const [w, h, mob, theme] of [[375, 812, true, 'dark'], [390, 844, true, 'dark'], [390, 844, true, 'light'], [1440, 900, false, 'dark'], [1440, 900, false, 'light']]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: 2 });
    await speedInit(ctx);
    await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); localStorage.setItem('stryker_theme', t);
      const st = { v: 1, currency: 'USD', startBalance: 100000, balance: 100000, realized: 0, fees: 0, createdAt: 1, resetAt: 1, savedAt: 1, settings: { enabled: true }, positions: { 'NQ1!': { symbol: 'NQ1!', side: 'buy', qty: 5, avg: 25291, openedAt: 1 } }, orders: [], history: [], trades: [], nextId: 2 };
      localStorage.setItem('stryker_paper_u1', JSON.stringify(st)); } catch (e) {} }, theme);
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
    const p = await ctx.newPage();
    await p.goto(BASE + '/charts.html?vela=0.9', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#stkc-bar .vela-mb-symbol, #stkc-bar .vela-widget-symbol', { timeout: 60000 });
    await sleep(5000);
    await p.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); }, theme); await sleep(300);
    const m = await p.evaluate(measure); await sleep(300);
    const m2 = await p.evaluate(measure);
    const tag = w + theme;
    check(m2.n > 3 && m2.overlaps.length === 0, tag + ': no bar items overlap', m2.overlaps);
    check(m2.spill.length === 0 && !m2.hscroll, tag + ': nothing spills / no h-scroll', m2.spill);
    check(!m2.chipInfo || m2.chipInfo.fits, tag + ': P&L text fits its chip', m2.chipInfo);
    if (w < 600) check(m2.rowSpread <= 2, tag + ': bar items share one centre line (spread px)', m2.rowSpread);
    if (m2.nmI) check(m2.nmI.ell, tag + ': workspace name ellipsizes', m2.nmI);
    console.log('  info', JSON.stringify(m2));
    if (OUT) await p.screenshot({ path: OUT + '/' + tag + '.png', clip: { x: 0, y: 0, width: w, height: 150 } });
    await ctx.close();
  }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
