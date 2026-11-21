// Chart full screen (brief AUTO-VELAUP B): button at the right of the top bar + Alt+Enter; on desktop only the charts stay
// (top bar, drawing column, bottom bar, right icon bar and side panels hidden); Esc / Alt+Enter restore exactly.
//   CHART_BASE=http://127.0.0.1:PORT tools/chrome-slot.sh node tools/tests/chart-fullscreen-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '.';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };

const SNAP = () => {
  const vis = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none' ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null; };
  const ws = window.STRYKER_VELA; const c = ws.cell(ws.active.id).host.getBoundingClientRect();
  return { on: document.documentElement.classList.contains('stk-chart-fs'), only: document.documentElement.classList.contains('stk-fs-only'),
    bar: vis('#stkc-bar'), col: vis('.vela-ws-toolbar'), bottom: vis('.vela-widget-bottombar'), rail: vis('.stkw-rail'), wl: vis('#stkw'), head: vis('.mobile-topnav'),
    cell: [Math.round(c.left), Math.round(c.top), Math.round(c.width), Math.round(c.height)], sx: document.documentElement.scrollWidth - innerWidth };
};

(async () => {
  const b = await launch();
  for (const [w, h, theme] of [[1440, 900, 'dark'], [1440, 900, 'light'], [390, 844, 'dark'], [390, 844, 'light']]) {
    const tag = `${w}-${theme}`;
    const ctx = await b.newContext(w < 700 ? { viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: w, height: h } });
    await ctx.addInitScript(stub);
    await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); for (const k of ['stryker_install_prompt_shown_u1', 'stryker_push_prompt_shown_u1', 'stryker_community_disclaimer_ack_v1']) localStorage.setItem(k, '1'); localStorage.removeItem('stk_chart_fs'); } catch (e) {} }, theme);
    await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) errors.push(String(e).slice(0, 200)); });
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => { try { const ws = window.STRYKER_VELA; return ws.cell(ws.active.id).chart.renderer.renderer.coords.barCount > 20 && document.getElementById('stkc-fs-btn'); } catch (e) { return false; } }, null, { timeout: 90000 });
        await p.waitForTimeout(1200);
    if (w >= 700) {
      // open the watchlist so "restores exactly" covers a side panel
      await p.evaluate(() => { const b = document.querySelector('.stkw-rail [aria-label*="atchlist" i]'); if (b) b.click(); });
      await p.waitForTimeout(500);
      const before = await p.evaluate(SNAP);
      const fsBtn = await p.evaluate(() => { const b = document.getElementById('stkc-fs-btn'), r = b.getBoundingClientRect(), bar = document.getElementById('stkc-bar').getBoundingClientRect(); return { r: [r.left, r.right], barR: bar.right, title: b.title }; });
      check(fsBtn.r[1] > fsBtn.barR - 260, `${tag}: full-screen button sits in the right end of the top bar`, fsBtn);
      await p.keyboard.press('Alt+Enter'); await p.waitForTimeout(700);
      const on = await p.evaluate(SNAP);
      await p.screenshot({ path: `${OUT}/fullscreen-${tag}-on.png` });
      check(on.on && on.only, `${tag}: Alt+Enter enters full screen`, on);
      check(!on.bar && !on.col && !on.bottom && !on.rail && !on.wl && !on.head, `${tag}: top bar, drawing column, bottom bar, rail, watchlist, header hidden`, on);
      check(on.cell[2] >= w - 4 && on.cell[3] >= h - 4, `${tag}: chart fills the window`, on.cell);
      // pill: shown on entry, centred, even padding
      const pill = await p.evaluate(() => { const e = document.querySelector('.stkt-fs-pill'); const r = e.getBoundingClientRect(); const kids = [...e.children].map((k) => { const q = k.getBoundingClientRect(); return q.top + q.height / 2; }); const cs = getComputedStyle(e); return { op: +cs.opacity, cx: r.left + r.width / 2, mid: r.top + r.height / 2, kids, pl: e.firstElementChild.getBoundingClientRect().left - r.left, pr: r.right - e.lastElementChild.getBoundingClientRect().right }; });
      check(pill.op > 0.9 && Math.abs(pill.cx - w / 2) <= 1, `${tag}: exit pill shown, centred`, pill);
      check(pill.kids.every((m) => Math.abs(m - pill.mid) <= 1) && Math.abs(pill.pl - pill.pr) <= 1.5, `${tag}: pill items share one centre, even padding`, pill);
      await p.screenshot({ path: `${OUT}/fullscreen-${tag}-pill.png`, clip: { x: w / 2 - 160, y: 0, width: 320, height: 56 } });
      await p.keyboard.press('Escape'); await p.waitForTimeout(700);
      const off = await p.evaluate(SNAP);
      check(!off.on && !off.only, `${tag}: Esc leaves`, off);
      check(JSON.stringify({ ...off, on: 0, only: 0 }) === JSON.stringify({ ...before, on: 0, only: 0 }), `${tag}: Esc restores exactly`, { before, off });
      await p.evaluate(() => document.getElementById('stkc-fs-btn').click()); await p.waitForTimeout(500);
      check((await p.evaluate(SNAP)).only, `${tag}: button enters`);
      await p.keyboard.press('Alt+Enter'); await p.waitForTimeout(700);
      const off2 = await p.evaluate(SNAP);
      check(JSON.stringify({ ...off2, on: 0, only: 0 }) === JSON.stringify({ ...before, on: 0, only: 0 }), `${tag}: Alt+Enter restores exactly`, off2);
      await p.screenshot({ path: `${OUT}/fullscreen-${tag}-off.png` });
    } else {
      // phone: page full screen keeps the chart bar (no Esc key on a phone; the button is the way out)
      await p.evaluate(() => window.__stkChartFs.set(true)); await p.waitForTimeout(700);
      const on = await p.evaluate(SNAP);
      await p.screenshot({ path: `${OUT}/fullscreen-${tag}-on.png` });
      check(on.on && !on.only && !!on.bar && !on.head, `${tag}: phone full screen hides the header, keeps the chart bar`, on);
      check(on.sx <= 0, `${tag}: no horizontal scroll`, on.sx);
      await p.evaluate(() => window.__stkChartFs.set(false)); await p.waitForTimeout(500);
      check(!(await p.evaluate(SNAP)).on, `${tag}: leaves`);
    }
    check(!errors.length, `${tag}: no page errors`, errors);
    await ctx.close();
  }
  await b.close();
  console.log(fail ? `FAILED ${fail}` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
