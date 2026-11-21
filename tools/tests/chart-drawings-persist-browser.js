// Drawings persistence + "Keep drawings on their own symbol" (brief AUTO-VELAUP E; upstream 0.10.9 / 0.10.6 fixes).
//  1. an undone drawing does not come back after a reload (the undo is saved)
//  2. with drawings sync on, a drawing from an earlier session still moves with its copy after a reload
//  3. "Keep drawings on their own symbol" is OFF by default (a drawing stays on the chart across a symbol switch);
//     ON: switching symbol shows only that symbol's drawings, switching back brings them back, and the
//     setting survives a reload. A workspace saved before (no setting) loads unchanged.
//   CHART_BASE=http://127.0.0.1:PORT tools/chrome-slot.sh node tools/tests/chart-drawings-persist-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '.';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };

const READY = () => { try { const ws = window.STRYKER_VELA; return ws.cells().every((c) => c.chart.renderer.renderer.coords.barCount > 20) && window.__stkHeavyReady; } catch (e) { return false; } };
const ready = (p) => p.waitForFunction(READY, null, { timeout: 90000 }).then(() => p.waitForTimeout(1500));
// a trend line in the middle of the visible window of one cell
const ADD = (cellIdx) => { const ws = window.STRYKER_VELA, c = ws.cells()[cellIdx], ch = c.chart, rr = ch.renderer.renderer;
  const r = ch.getVisibleRange(), span = r.to - r.from, mid = (r.from + r.to) / 2, pane = [...rr.scene.panes.values()][0], ps = pane.scale, m = (ps.min + ps.max) / 2, d = (ps.max - ps.min) / 8;
  const x = ch.drawings.add('trendline', { anchors: [{ time: mid - span / 6, price: m - d }, { time: mid + span / 6, price: m + d }] }); return x && (x.id || x); };
const LIST = () => window.STRYKER_VELA.cells().map((c) => c.chart.drawings.all().map((d) => ({ id: d.id, type: d.type, a: JSON.stringify(d.anchors) })));

async function page(b, w, h, init) {
  const ctx = await b.newContext(w < 700 ? { viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: w, height: h } });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((seed) => { try { for (const k of ['stryker_install_prompt_shown_u1', 'stryker_push_prompt_shown_u1', 'stryker_community_disclaimer_ack_v1']) localStorage.setItem(k, '1');
    if (seed && seed.theme) localStorage.setItem('stryker_theme', seed.theme === 'light' ? 'day' : 'night');
    if (seed && !sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); for (const k of Object.keys(localStorage)) if (/^vela-workspace/.test(k)) localStorage.removeItem(k); if (seed.ws) localStorage.setItem('vela-workspace-090', seed.ws); } } catch (e) {} }, init || null);
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) errors.push(String(e).slice(0, 200)); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await ready(p);
  return { ctx, p, errors };
}
const reload = async (p) => { await p.waitForTimeout(1200); await p.reload({ waitUntil: 'domcontentloaded' }); await ready(p); };
const setSym = async (p, sym) => { await p.evaluate((s) => window.STRYKER_VELA.active.setSymbol(s), sym); await p.waitForFunction((s) => { try { const c = window.STRYKER_VELA.active; return c.symbol === s && c.chart.renderer.renderer.coords.barCount > 20; } catch (e) { return false; } }, sym, { timeout: 60000 }); await p.waitForTimeout(800); };

(async () => {
  const b = await launch();
  // ---- 1. undo is saved -------------------------------------------------------------------------
  {
    const { ctx, p, errors } = await page(b, 1440, 900, { ws: null });
    const id = await p.evaluate(ADD, 0);
    await p.waitForTimeout(1200);
    check(!!id && (await p.evaluate(LIST))[0].length === 1, 'undo: line drawn');
    await p.evaluate(() => window.STRYKER_VELA.active.history.undo());
    await p.waitForTimeout(300);
    check((await p.evaluate(LIST))[0].length === 0, 'undo: undo removes it');
    await reload(p);
    const after = await p.evaluate(LIST);
    check(after[0].length === 0, 'undo: an undone drawing does not come back after a reload', after);
    check(!errors.length, 'undo: no page errors', errors);
    await ctx.close();
  }
  // ---- 2. synced drawings stay linked after a reload ------------------------------------------------
  {
    const { ctx, p, errors } = await page(b, 1440, 900, { ws: null });
    await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.setLayout('2h'); });
    await ready(p);
    await p.evaluate(() => window.STRYKER_VELA.sync.set('drawings', true));
    await p.evaluate(ADD, 0);
    await p.waitForTimeout(600);
    const l0 = await p.evaluate(LIST);
    check(l0.length === 2 && l0[0].length === 1 && l0[1].length === 1 && l0[0][0].a === l0[1][0].a, 'sync: the copy lands on the second chart', l0);
    await reload(p);
    // move the line on chart 1: its copy on chart 2 must follow
    await p.evaluate(() => { const c = window.STRYKER_VELA.cells()[0], d = c.chart.drawings.all()[0]; c.chart.drawings.update(d.id, { anchors: d.anchors.map((a) => ({ ...a, price: a.price * 1.01 })) }); });
    await p.waitForTimeout(600);
    const l1 = await p.evaluate(LIST);
    check(l1[0].length === 1 && l1[1].length === 1 && l1[0][0].a === l1[1][0].a && l1[0][0].a !== l0[0][0].a, 'sync: after a reload, moving the line moves its copy', l1);
    await p.evaluate(() => { const c = window.STRYKER_VELA.cells()[0]; c.chart.drawings.remove(c.chart.drawings.all()[0].id); });
    await p.waitForTimeout(600);
    const l2 = await p.evaluate(LIST);
    check(l2[0].length === 0 && l2[1].length === 0, 'sync: after a reload, deleting the line deletes its copy', l2);
    check(!errors.length, 'sync: no page errors', errors);
    await ctx.close();
  }
  // ---- 3. Keep drawings on their own symbol ----------------------------------------------------------
  for (const [w, h, theme] of [[1440, 900, 'dark'], [1440, 900, 'light'], [390, 844, 'dark'], [390, 844, 'light']]) {
    const tag = `${w}-${theme}`;
    const { ctx, p, errors } = await page(b, w, h, { ws: null, theme });
    if (w >= 700 && theme === 'dark') {
      // OFF (default): a drawing follows the chart to the next symbol, as before
      const s0 = await p.evaluate(() => window.STRYKER_VELA.active.symbol);
      await p.evaluate(ADD, 0);
      await setSym(p, 'binance:ETHUSDT');
      check((await p.evaluate(LIST))[0].length === 1, `${tag}: off by default: the drawing stays across a symbol switch`);
      await setSym(p, s0);
      await p.evaluate(() => { const c = window.STRYKER_VELA.active.chart; c.drawings.removeMany(c.drawings.all().map((d) => d.id)); });
    }
    // the switch in chart settings > Symbol
    await p.evaluate(() => window.STRYKER_VELA.active.chart.renderer.openSettings());
    await p.waitForTimeout(800);
    await p.evaluate(() => { const t = [...document.querySelectorAll('.vela-dialog--settings .vela-sd-tab')].find((b) => /^Symbol/.test(b.textContent.trim())); if (t) t.click(); });
    await p.waitForTimeout(500);
    const row = await p.evaluate(() => { const lab = [...document.querySelectorAll('.vela-dialog--settings *')].find((e) => e.children.length === 0 && /^Keep drawings on their own symbol$/.test(e.textContent.trim()));
      if (!lab) return null; let r = lab; while (r.parentElement && !r.querySelector('input,[role="switch"]')) r = r.parentElement;
      r.scrollIntoView({ block: 'center' }); const q = r.getBoundingClientRect(); const inp = r.querySelector('input,[role="switch"]');
      const kids = [lab, inp].map((k) => { const z = k.getBoundingClientRect(); return [Math.round((z.top + z.height / 2 - (q.top + q.height / 2)) * 10) / 10, z.right <= q.right + 0.5]; });
      return { on: inp.checked === true || inp.getAttribute('aria-checked') === 'true', kids, sx: document.documentElement.scrollWidth - innerWidth }; });
    await p.waitForTimeout(250);
    await p.screenshot({ path: `${OUT}/ownsym-${tag}-settings.png` });
    check(row && row.on === false, `${tag}: "Keep drawings on their own symbol" row, off by default`, row);
    check(row && row.kids.every((k) => Math.abs(k[0]) <= 1.5 && k[1]) && row.sx <= 0, `${tag}: row centred, nothing overflows, no horizontal scroll`, row);
    await p.evaluate(() => { const lab = [...document.querySelectorAll('.vela-dialog--settings *')].find((e) => e.children.length === 0 && /^Keep drawings on their own symbol$/.test(e.textContent.trim()));
      let r = lab; while (r.parentElement && !r.querySelector('input,[role="switch"]')) r = r.parentElement; r.querySelector('input,[role="switch"]').click(); });
    await p.waitForTimeout(300);
    await p.evaluate(() => { const ok = [...document.querySelectorAll('button')].find((b) => /^ok$/i.test(b.textContent.trim()) && b.getBoundingClientRect().width); if (ok) ok.click(); });
    await p.waitForTimeout(500);
    if (w >= 700) {
      const s0 = await p.evaluate(() => window.STRYKER_VELA.active.symbol);
      await p.evaluate(ADD, 0);
      await p.waitForTimeout(300);
      await setSym(p, 'binance:ETHUSDT');
      check((await p.evaluate(LIST))[0].length === 0, `${tag}: on: the other symbol shows none of the first symbol's drawings`);
      await p.evaluate(ADD, 0);
      await setSym(p, s0);
      const back = await p.evaluate(LIST);
      check(back[0].length === 1, `${tag}: on: switching back brings the first symbol's drawing back (and only it)`, back);
      await reload(p);
      const r1 = await p.evaluate(() => ({ n: window.STRYKER_VELA.active.chart.drawings.all().length }));
      check(r1.n === 1, `${tag}: on: survives a reload`, r1);
      await setSym(p, 'binance:ETHUSDT');
      check((await p.evaluate(LIST))[0].length === 1, `${tag}: on: the second symbol's drawing survives a reload too`);
    }
    check(!errors.length, `${tag}: no page errors`, errors);
    await ctx.close();
  }
  // ---- 4. a workspace saved before this change loads unchanged ------------------------------------------
  {
    const { ctx, p } = await page(b, 1440, 900, { ws: null });
    await p.evaluate(ADD, 0);
    await p.waitForTimeout(1200);
    const saved = await p.evaluate(() => { const k = Object.keys(localStorage).find((x) => /^vela-workspace/.test(x)); return { k, v: localStorage.getItem(k), list: JSON.stringify(window.STRYKER_VELA.cells().map((c) => c.chart.drawings.all().map((d) => d.anchors))) }; });
    await ctx.close();
    const { ctx: c2, p: p2, errors } = await page(b, 1440, 900, { ws: saved.v });
    const list = await p2.evaluate(() => JSON.stringify(window.STRYKER_VELA.cells().map((c) => c.chart.drawings.all().map((d) => d.anchors))));
    check(saved.k === 'vela-workspace-090' && list === saved.list, 'old workspace: loads with the same drawings', { k: saved.k });
    check(!errors.length, 'old workspace: no page errors', errors);
    await c2.close();
  }
  await b.close();
  console.log(fail ? `FAILED ${fail}` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
