// CONTRACT MONTHS in the Charts symbol search + header (assets/chart-search.js, chart-fut-month.js, fut-months.js), offline:
//   1440 dark: type "MES" -> MES1! first, then its next months with expiry dates; type "MES Dec 2026" / "MESZ26" -> MESZ2026 first;
//   Enter opens futures:MESZ2026 (bars asked for MESZ2026, never MES); header "MES · Dec 2026 · CME" + "Expires 18 Dec" chip;
//   side panel: the month rows are clickable and open that month; MES1! stays MES1!; a month with no prices says so;
//   roll week (clock 12 Dec): "Rolls to Mar 2027" switches the chart in one tap; alignment gate on the chip row; light theme.
//   390 dark: header chip fits, no horizontal scroll.
// Candles are the recorded fixture (Sample data), labelled as such in every shot.
//   node tools/tests/chart-speed-server.mjs 8291 &
//   CHART_BASE=http://127.0.0.1:8291 node tools/tests/fut-months-browser.js [shotsDir]
const fs = require('fs');
const { launch } = require('./lib.js');
const { speedInit } = require('./chart-phone-speed-init.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8291';
const OUT = process.argv[2];
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };
const SYMINFO = { v: 1, t: 0, syms: {
  ES: { kind: 'fut', name: 'E-mini S&P 500 Futures', ex: 'CME', tick: 0.25, pv: 50, contract: 'ESZ2026', roll: [{ c: 'ESZ2026', d: '20261218' }, { c: 'ESH2027', d: '20270319' }, { c: 'ESM2027', d: '20270618' }, { c: 'ESU2027', d: '20270917' }, { c: 'ESZ2027', d: '20271217' }] } } };

async function context(b, w, h, mobile, theme, clockMs) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, userAgent: mobile ? 'Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' : undefined });
  await speedInit(ctx);
  if (clockMs) await ctx.addInitScript((now) => {   // move the fixture clock (roll week)
    const D0 = window.Date, off = now - D0.now();
    class D extends D0 { constructor(...a) { if (a.length) super(...a); else super(D0.now() + off); } static now() { return D0.now() + off; } }
    window.Date = D;
  }, clockMs);
  if (theme) await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t); localStorage.setItem('theme', t); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/scan\?part=syminfo/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SYMINFO) }));
  // a far month with no prices yet: the source answers empty
  await ctx.route(/\/api\/chart\/bars\/MESZ2027/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'MESZ2027', bars: [] }) }));
  return ctx;
}
async function boot(ctx, errors, asked) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  p.on('request', (r) => { const m = /\/api\/chart\/bars\/([^?]+)/.exec(r.url()); if (m) asked.add(decodeURIComponent(m[1])); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkSearch && window.STRYKER_VELA && document.querySelector('.vela-widget-symbol, .vela-mb-symbol'), null, { timeout: 60000 });
  await sleep(2500);
  return p;
}
const sample = (p) => p.evaluate(() => { if (document.getElementById('tz-sample')) return; const d = document.createElement('div'); d.id = 'tz-sample'; d.textContent = 'Sample data'; d.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9999;padding:4px 10px;border-radius:999px;background:rgba(245,166,35,.18);color:#F5A623;font:600 12px system-ui'; document.body.appendChild(d); });
const shot = async (p, name) => { if (!OUT) return; await sample(p); await p.screenshot({ path: OUT + '/' + name + '.png' }); console.log('shot ' + OUT + '/' + name + '.png'); };
const rows = (p) => p.evaluate(() => [...document.querySelectorAll('.stkss-row')].map((e) => ({ sym: e.dataset.sym, tk: e.querySelector('.stkss-tk').textContent, sub: (e.querySelector('.stkss-sub, .stkss-l2') || {}).textContent || '' })));
async function typeQ(p, q) {
  await p.evaluate(() => window.__stkSearch.open()); await sleep(300);
  await p.fill('.stkss-input', q); await sleep(500);
}
const header = (p) => p.evaluate(() => {
  const sl = document.querySelector('.vela-cell .vela-statusline');
  const q = (s) => sl && sl.querySelector(s);
  const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, cy: (r.top + r.bottom) / 2, w: r.width, sw: e.scrollWidth, cw: e.clientWidth }; };
  const chip = q('.stkc-fm-chip'), cs = chip && getComputedStyle(chip);
  return { sym: window.STRYKER_VELA.active.symbol, root: (q('.vela-sl-symbol') || {}).textContent, meta: (q('.vela-sl-meta') || {}).textContent,
    chips: [...(sl ? sl.querySelectorAll('.stkc-fm-chip') : [])].map((e) => e.textContent), dd: (q('.stkc-dd') || {}).textContent,
    bSym: box(q('.vela-sl-symbol')), bMeta: box(q('.vela-sl-meta')), bDd: box(q('.stkc-dd')), bChip: box(chip), pad: cs ? [cs.paddingLeft, cs.paddingRight] : null,
    tnum: cs ? cs.fontVariantNumeric : '', note: (document.querySelector('.stkc-fm-empty') || {}).textContent || '', hscroll: document.documentElement.scrollWidth > window.innerWidth };
});

(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    // ---------------- 1440 dark ----------------
    {
      const errors = [], asked = new Set();
      const ctx = await context(b, 1440, 900, false, 'dark');
      const p = await boot(ctx, errors, asked);
      await typeQ(p, 'MES');
      let r = await rows(p);
      check(r[0] && r[0].tk === 'MES1!', '1440: "MES" lists MES1! first', r.slice(0, 2));
      const months = r.slice(1, 7).map((x) => x.tk);
      check(JSON.stringify(months.slice(0, 5)) === JSON.stringify(['MESZ2026', 'MESH2027', 'MESM2027', 'MESU2027', 'MESZ2027']), '1440: then its next months, nearest first', months);
      check(r[1] && /Dec 2026 contract · expires 18 Dec/.test(r[1].sub), '1440: month row shows its expiry date', r[1]);
      check(r[1] && r[1].sym === 'futures:MESZ2026', '1440: month row opens futures:MESZ2026', r[1] && r[1].sym);
      await shot(p, 'search-mes-1440-dark');
      // side panel for the month row (hover/highlight), then click a side-panel month
      await p.hover('.stkss-row[data-i="1"]'); await sleep(200);
      await p.keyboard.press('ArrowDown'); await sleep(600);
      const side = await p.evaluate(() => [...document.querySelectorAll('.stkss-side .stkss-srow')].map((e) => ({ t: e.textContent, sym: e.dataset.sym || '', btn: e.tagName })));
      check(side.length >= 6 && side.some((x) => /MESH2027/.test(x.t)), '1440: side panel lists the contract months', side.map((x) => x.t));
      check(side.some((x) => /MESZ2026/.test(x.t) && /FRONT/.test(x.t)), '1440: front month tagged FRONT', side.map((x) => x.t));
      await shot(p, 'search-side-1440-dark');
      const sr = await p.evaluate(() => { const e = [...document.querySelectorAll('.stkss-side .stkss-srow')].find((x) => /MESH2027/.test(x.textContent)); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
      await p.mouse.click(sr[0], sr[1]); await sleep(2500);
      let h = await header(p);
      check(h.sym === 'futures:MESH2027', '1440: a side-panel month click opens that month', h.sym);
      check(asked.has('MESH2027'), '1440: bars are asked for MESH2027 itself', [...asked]);
      // typed phrases open the same month
      for (const q of ['MES Dec 2026', 'MESZ26', 'MESZ6']) {
        await typeQ(p, q); r = await rows(p);
        check(r[0] && r[0].sym === 'futures:MESZ2026', '1440: "' + q + '" puts MESZ2026 first', r.slice(0, 2));
        await p.keyboard.press('Escape'); await sleep(200);
      }
      await typeQ(p, 'MES Dec 2026'); await p.keyboard.press('Enter'); await sleep(3000);
      h = await header(p);
      check(h.sym === 'futures:MESZ2026', '1440: Enter opens futures:MESZ2026', h.sym);
      check(h.root === 'MES' && /^· Dec 2026 · CME/.test(h.meta), '1440: header reads "MES · Dec 2026 · CME"', [h.root, h.meta]);
      check(h.chips[0] === 'Expires 18 Dec' && h.chips.length === 1, '1440: "Expires 18 Dec" chip, no roll yet (21 Oct)', h.chips);
      check(/Delayed/.test(h.dd || ''), '1440: data dot says Delayed for a member', h.dd);
      // alignment gate: symbol, meta, dot, chip share one vertical centre; chip padding even; no clipping
      // (Vela's own "· CME · 15m" text sits 1.4 px low on every chart, MES1! too: its baseline, not ours, so it is left out)
      const cys = [h.bSym, h.bDd, h.bChip].filter(Boolean).map((x) => x.cy);
      check(Math.max(...cys) - Math.min(...cys) <= 1, '1440: symbol, data dot and chip share one vertical centre (<=1px)', cys);
      check(h.pad && h.pad[0] === h.pad[1], '1440: chip padding even left/right', h.pad);
      check(h.bChip && h.bChip.sw <= h.bChip.cw + 1, '1440: chip text not clipped', h.bChip);
      check(/tabular-nums/.test(h.tnum), '1440: chip uses tabular digits', h.tnum);
      const g1 = h.bDd.l - h.bMeta.r, g2 = h.bChip.l - h.bDd.r;
      check(Math.abs(g1 - g2) <= 1, '1440: chip sits as far from the dot as the dot from the meta', [g1, g2]);
      await shot(p, 'chart-mesz2026-1440-dark');
      // MES1! untouched
      await p.evaluate(() => window.STRYKER_VELA.active.setSymbol('futures:MES1!')); await sleep(2000);
      h = await header(p);
      check(h.sym === 'futures:MES1!' && h.root === 'MES1!' && !h.chips.length, '1440: MES1! keeps its own header, no month chip', [h.root, h.meta, h.chips]);
      // empty far month
      await p.evaluate(() => window.STRYKER_VELA.active.setSymbol('futures:MESZ2027')); await sleep(9000);
      h = await header(p);
      check(/Prices for this month start closer to expiry/.test(h.note), '1440: an empty month says why', h.note);
      await shot(p, 'chart-empty-month-1440-dark');
      // layout save/restore keeps the month
      await p.evaluate(() => window.STRYKER_VELA.active.setSymbol('futures:MESH2027')); await sleep(1500);
      const st = await p.evaluate(() => JSON.stringify(window.STRYKER_VELA.getState ? window.STRYKER_VELA.getState() : window.STRYKER_VELA.serialize ? window.STRYKER_VELA.serialize() : null));
      check(/MESH2027/.test(st || ''), '1440: workspace state saves the month code', (st || '').slice(0, 80));
      await p.reload({ waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.active, null, { timeout: 60000 }); await sleep(3000);
      check(await p.evaluate(() => window.STRYKER_VELA.active.symbol) === 'futures:MESH2027', '1440: reload restores futures:MESH2027');
      check(!errors.length, '1440: no page errors', errors);
      await ctx.close();
    }
    // ---------------- 1440 roll week (12 Dec), light ----------------
    {
      const errors = [], asked = new Set();
      const ctx = await context(b, 1440, 900, false, 'light', Date.UTC(2026, 11, 12, 15));
      const p = await boot(ctx, errors, asked);
      await p.evaluate(() => window.STRYKER_VELA.active.setSymbol('futures:MESZ2026')); await sleep(2500);
      let h = await header(p);
      check(h.chips.join('|') === 'Expires 18 Dec|Rolls to Mar 2027', 'roll week: "Rolls to Mar 2027" shows 6 days out', h.chips);
      await shot(p, 'chart-roll-1440-light');
      await p.click('.stkc-fm-roll'); await sleep(2500);
      h = await header(p);
      check(h.sym === 'futures:MESH2027' && /Mar 2027/.test(h.meta), 'roll week: one tap switches to MESH2027', [h.sym, h.meta]);
      check(!errors.length, 'roll: no page errors', errors);
      await ctx.close();
    }
    // ---------------- 390 dark phone ----------------
    {
      const errors = [], asked = new Set();
      const ctx = await context(b, 390, 844, true, 'dark');
      const p = await boot(ctx, errors, asked);
      await p.evaluate(() => window.__stkSearch.open && window.__stkSearch.open()); await sleep(300);
      await p.fill('.stkss-input', 'MES'); await sleep(600);
      const r = await rows(p);
      check(r[0] && r[0].tk === 'MES1!' && r[1] && r[1].tk === 'MESZ2026', '390: MES1! then MESZ2026', r.slice(0, 2).map((x) => x.tk));
      check(!(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), '390: search sheet has no horizontal scroll');
      await shot(p, 'search-mes-390-dark');
      await p.tap('.stkss-row[data-i="1"]'); await sleep(3000);
      const h = await header(p);
      check(h.sym === 'futures:MESZ2026' && h.chips[0] === 'Expires 18 Dec', '390: tap opens the month, chip shows', [h.sym, h.chips]);
      check(!h.hscroll, '390: no horizontal scroll on the chart');
      check(h.bChip && h.bChip.r <= 390 && h.bChip.sw <= h.bChip.cw + 1, '390: chip inside the screen and not clipped', h.bChip);
      const cys = [h.bSym, h.bChip].filter(Boolean).map((x) => x.cy);
      check(h.bChip && h.bMeta && h.bChip.l >= h.bMeta.r, '390: chip comes after the meta', [h.bMeta && h.bMeta.r, h.bChip && h.bChip.l]);
      check(Math.max(...cys) - Math.min(...cys) <= 1, '390: header row shares one vertical centre', cys);
      await shot(p, 'chart-mesz2026-390-dark');
      check(!errors.length, '390: no page errors', errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
