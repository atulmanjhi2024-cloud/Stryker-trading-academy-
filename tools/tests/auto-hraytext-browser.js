// Horizontal Ray text alignment (Edge, Discord): the ray's Text tab has Text alignment like the other lines;
// the label moves on the chart; the choice survives a reload; an old ray (nothing set) keeps its look.
//   CHART_BASE=http://127.0.0.1:PORT tools/chrome-slot.sh node tools/tests/auto-hraytext-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8047';
const OUT = process.argv[2] || '.';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
const READY = () => { try { return window.STRYKER_VELA.cells().every((c) => c.chart.renderer.renderer.coords.barCount > 20) && window.__stkHeavyReady; } catch (e) { return false; } };
const ADD = () => { const ch = window.STRYKER_VELA.active.chart, rr = ch.renderer.renderer, r = ch.getVisibleRange(), mid = (r.from + r.to) / 2, span = r.to - r.from;
  const ps = [...rr.scene.panes.values()][0].scale; const x = ch.drawings.add('hray', { anchors: [{ time: mid - span / 4, price: (ps.min + ps.max) / 2 }], text: { value: 'WEEKLY SUPPLY', size: '14' } }); return x && (x.id || x); };
const XY = (id) => { const ch = window.STRYKER_VELA.active.chart, rr = ch.renderer.renderer, proj = rr.userDrawings.deps.projector(), d = ch.drawings.all().find((q) => q.id === id), el = rr.input.el.getBoundingClientRect();
  return { x: el.left + proj.xOf(d.anchors[0].time), y: el.top + proj.yOf(d.anchors[0].price, d.paneId), left: el.left, w: el.width }; };
// horizontal extent of the label: pixels in a band around the line that differ from the same chart with the text blanked
const EXTENT = async (p, id, q) => {
  const clip = { x: Math.max(0, q.left), y: Math.max(0, q.y - 30), width: q.w, height: 60 };
  const withT = (await p.screenshot({ clip })).toString('base64');
  await p.evaluate((id) => { const ch = window.STRYKER_VELA.active.chart, d = ch.drawings.all().find((x) => x.id === id); window.__t = d.text; ch.drawings.update(id, { text: Object.assign({}, d.text, { value: '' }) }); }, id);
  await p.waitForTimeout(400); const without = (await p.screenshot({ clip })).toString('base64');
  await p.evaluate((id) => { window.STRYKER_VELA.active.chart.drawings.update(id, { text: window.__t }); }, id); await p.waitForTimeout(400);
  const r = await p.evaluate(async ([a, b, left, cw]) => { const load = (s) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = 'data:image/png;base64,' + s; });
    const [A, B] = await Promise.all([load(a), load(b)]); const g = (i) => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; };
    const da = g(A), db = g(B); let lo = 1e9, hi = -1; for (let k = 0; k < da.length; k += 4) if (Math.abs(da[k] - db[k]) + Math.abs(da[k + 1] - db[k + 1]) + Math.abs(da[k + 2] - db[k + 2]) > 90) { const x = (k / 4) % A.width; lo = Math.min(lo, x); hi = Math.max(hi, x); }
    const sc = A.width / cw; return hi < 0 ? null : { lo: Math.round(left + lo / sc), hi: Math.round(left + hi / sc) }; }, [withT, without, clip.x, clip.width]);
  return r;
};
const SET = (p, label, val) => p.evaluate(([label, val]) => { const sel = [...document.querySelectorAll('select.stk-dsp-sel')].find((s) => s.title === label && s.offsetParent); if (!sel) return false; sel.value = val; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; }, [label, val]);
async function open(b, w, h, theme, vela, keep, ctx0) {
  const ctx = ctx0 || await b.newContext(w < 700 ? { viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: w, height: h } });
  if (!ctx0) { await ctx.addInitScript(stub);
    await ctx.addInitScript(([th]) => { try { for (const k of ['stryker_install_prompt_shown_u1', 'stryker_push_prompt_shown_u1', 'stryker_community_disclaimer_ack_v1']) localStorage.setItem(k, '1');
      localStorage.setItem('stryker_theme', th === 'light' ? 'day' : 'night');
      if (!localStorage.getItem('__seen')) { localStorage.setItem('__seen', '1'); for (const k of Object.keys(localStorage)) if (/^vela-workspace/.test(k)) localStorage.removeItem(k); } } catch (e) {} }, [theme]);
    await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort()); }
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) errors.push(String(e).slice(0, 200)); });
  await p.goto(BASE + '/charts.html' + (vela ? '?vela=' + vela : ''), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(READY, null, { timeout: 90000 }); await p.waitForTimeout(1500);
  return { ctx, p, errors };
}
(async () => {
  const b = await launch();
  for (const [w, h, th] of [[1440, 900, 'dark'], [1440, 900, 'light'], [390, 844, 'dark']]) {
    const tag = `${w}-${th}`;
    { const { ctx, p } = await open(b, w, h, th, 's16'); await p.evaluate(ADD); await p.waitForTimeout(500);
      await p.screenshot({ path: `${OUT}/before-${tag}.png` }); await ctx.close(); }
    const { ctx, p, errors } = await open(b, w, h, th, 's17');
    check(await p.evaluate(() => window.__stkVelaDir) === 'vela-0.9.0-s17', `${tag}: new engine active`);
    const id = await p.evaluate(ADD); await p.waitForTimeout(500);
    let q = await p.evaluate(XY, id);
    const d0 = await p.evaluate((id) => window.STRYKER_VELA.active.chart.drawings.all().find((x) => x.id === id).text, id);
    check(!d0.stkH && !d0.stkV, `${tag}: new ray stores no alignment (old look kept)`, d0);
    const e0 = await EXTENT(p, id, q);
    check(e0 && Math.abs(e0.lo - q.x) <= 14, `${tag}: default label starts at the ray's start point`, { e0, startX: Math.round(q.x) });
    await p.screenshot({ path: `${OUT}/after-default-${tag}.png` });
    if (w === 390) { await ctx.close(); continue; }
    // open the real Settings dialog -> Text tab
    await p.mouse.dblclick(q.x + 120, q.y); await p.waitForTimeout(700);
    await p.evaluate(() => { const t = [...document.querySelectorAll('button,[role=tab]')].find((x) => x.offsetParent && x.textContent.trim() === 'Text'); if (t) t.click(); }); await p.waitForTimeout(300);
    const row = await p.evaluate(() => { const lab = [...document.querySelectorAll('*')].find((x) => x.offsetParent && !x.children.length && x.textContent.trim() === 'Text alignment'); if (!lab) return null;
      const cy = (e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; }; const sels = [...lab.parentElement.querySelectorAll('select')];
      return { opts: sels.map((s) => [...s.options].map((o) => o.text).join('/')), off: Math.max(...sels.map((s) => Math.abs(cy(s) - cy(lab)))), vals: sels.map((s) => s.value) }; });
    check(!!row, `${tag}: ray Text tab shows Text alignment`, row);
    check(row && row.off <= 1, `${tag}: alignment row label and boxes share one centre (<=1px)`, row && row.off);
    check(row && row.opts[1] === 'Left/Center/Right' && row.vals[0] === 'bottom' && row.vals[1] === 'left', `${tag}: Left/Center/Right; unset shows Bottom + Left`, row);
    await p.screenshot({ path: `${OUT}/after-texttab-${tag}.png` });
    // pick Right in the dialog, press OK (Cancel would discard it)
    check(await SET(p, 'Horizontal', 'right'), `${tag}: choose Right in the dialog`);
    await p.evaluate(() => { const ok = [...document.querySelectorAll('button')].find((x) => x.offsetParent && x.textContent.trim() === 'OK'); if (ok) ok.click(); }); await p.waitForTimeout(600);
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    const saved = await p.evaluate((id) => window.STRYKER_VELA.active.chart.drawings.all().find((x) => x.id === id).text, id);
    check(saved.stkH === 'right', `${tag}: OK stores Right on the drawing`, saved);
    const eR = await EXTENT(p, id, q);
    check(eR && eR.hi > q.left + q.w - 120 && eR.lo > e0.hi, `${tag}: Right puts the label at the right edge`, { eR, e0 });
    await p.screenshot({ path: `${OUT}/after-right-${tag}.png` });
    await p.evaluate((id) => { const ch = window.STRYKER_VELA.active.chart; ch.drawings.update(id, { text: Object.assign({}, ch.drawings.all().find((x) => x.id === id).text, { stkH: 'center' }) }); }, id); await p.waitForTimeout(500);
    const eC = await EXTENT(p, id, q);
    check(eC && eC.lo > e0.hi && eC.hi < eR.lo, `${tag}: Center sits between start and right edge`, eC);
    await p.screenshot({ path: `${OUT}/after-center-${tag}.png` });
    await p.evaluate((id) => { const ch = window.STRYKER_VELA.active.chart; ch.drawings.update(id, { text: Object.assign({}, ch.drawings.all().find((x) => x.id === id).text, { stkH: 'right' }) }); }, id);
    // persistence: reload in the same browser profile
    await p.waitForTimeout(2500);
    const p2 = await open(b, w, h, th, 's17', true, ctx); // same context keeps localStorage
    const l = await p2.p.evaluate(() => window.STRYKER_VELA.active.chart.drawings.all().filter((d) => d.type === 'hray').map((d) => ({ id: d.id, h: d.text && d.text.stkH, v: d.text && d.text.stkV })));
    check(l.length === 1 && l[0].h === 'right', `${tag}: alignment still Right after reload`, l);
    if (l[0]) { const q2 = await p2.p.evaluate(XY, l[0].id); const e2 = await EXTENT(p2.p, l[0].id, q2);
      check(e2 && e2.hi > q2.left + q2.w - 120, `${tag}: label still at right edge after reload`, e2); await p2.p.screenshot({ path: `${OUT}/after-reload-${tag}.png` }); }
    check(!errors.length && !p2.errors.length, `${tag}: no page errors`, errors.concat(p2.errors));
    await ctx.close();
  }
  await b.close(); process.exit(fail ? 1 : 0);
})();
