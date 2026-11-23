// Beta reports 22 Nov: Horizontal Ray / Vertical Line text alignment, drawing Copy / Paste / Copy price / Copy text.
//  1. Horizontal Ray, Vertical Line and Trend Line show "Text alignment" on the Text tab; a ray saved
//     before (no alignment set) keeps its old label spot; Right moves the label to the right edge.
//  2. Ctrl+C / Ctrl+V on a selected drawing pastes a copy at the same price/time; the copy also pastes on
//     another chart of the layout; Paste from the chart's right-click lands at the clicked spot.
//  3. Right-click a drawing: Copy, Paste, Copy price (tick decimals), Copy text.
//   CHART_BASE=http://127.0.0.1:PORT tools/chrome-slot.sh node tools/tests/chart-beta1122-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8047';
const OUT = process.argv[2] || '.';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };

const READY = () => { try { const ws = window.STRYKER_VELA; return ws.cells().every((c) => c.chart.renderer.renderer.coords.barCount > 20) && window.__stkHeavyReady; } catch (e) { return false; } };
const ready = (p) => p.waitForFunction(READY, null, { timeout: 90000 }).then(() => p.waitForTimeout(1500));

async function page(b, w, h, theme) {
  const ctx = await b.newContext(w < 700 ? { viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: w, height: h } });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((th) => { try { for (const k of ['stryker_install_prompt_shown_u1', 'stryker_push_prompt_shown_u1', 'stryker_community_disclaimer_ack_v1']) localStorage.setItem(k, '1');
    localStorage.setItem('stryker_theme', th === 'light' ? 'day' : 'night');
    for (const k of Object.keys(localStorage)) if (/^vela-workspace/.test(k)) localStorage.removeItem(k);
    // record what goes to the system clipboard
    window.__copied = [];
    const put = (s) => { window.__copied.push(String(s)); return Promise.resolve(); };
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: put, readText: () => Promise.resolve(window.__copied.at(-1) || '') }, configurable: true });
  } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) errors.push(String(e).slice(0, 200)); });
  await p.goto(BASE + '/charts.html?vela=s17', { waitUntil: 'domcontentloaded' });
  await ready(p);
  return { ctx, p, errors };
}

// Add a drawing of `type` in the middle of cell `ci`; returns its id.
const ADD = ([ci, type, extra]) => { const c = window.STRYKER_VELA.cells()[ci], ch = c.chart, rr = ch.renderer.renderer;
  const r = ch.getVisibleRange(), span = r.to - r.from, mid = (r.from + r.to) / 2, ps = [...rr.scene.panes.values()][0].scale, m = (ps.min + ps.max) / 2, d = (ps.max - ps.min) / 8;
  const two = type === 'trendline';
  const anchors = two ? [{ time: mid - span / 6, price: m - d }, { time: mid + span / 6, price: m + d }] : [{ time: mid - span / 4, price: m }];
  const x = ch.drawings.add(type, Object.assign({ anchors }, extra || {})); return x && (x.id || x); };
const LIST = () => window.STRYKER_VELA.cells().map((c) => c.chart.drawings.all().map((d) => ({ id: d.id, type: d.type, a: d.anchors.map((q) => [Math.round(q.time), +q.price.toFixed(4)]), text: d.text && d.text.value })));
// client coords of a drawing's first anchor (+dx px along the line)
const XY = ([ci, id, dx]) => { const c = window.STRYKER_VELA.cells()[ci], rr = c.chart.renderer.renderer, ud = rr.userDrawings, proj = ud.deps.projector();
  const d = c.chart.drawings.all().find((q) => q.id === id), el = rr.input.el.getBoundingClientRect();
  const pts = ud.interaction.byId ? null : null; void pts;
  const x = proj.xOf ? proj.xOf(d.anchors[0].time) : null, y = proj.yOf(d.anchors[0].price, d.paneId);
  return { x: el.left + x + (dx || 0), y: el.top + y, w: el.width }; };

(async () => {
  const b = await launch();
  // ---------- 1. text alignment ----------
  for (const theme of ['dark', 'light']) {
    const { ctx, p, errors } = await page(b, 1440, 900, theme);
    const id = await p.evaluate(ADD, [0, 'hray', { text: { value: 'WEEKLY SUPPLY 6998.58', size: '14' } }]);
    await p.mouse.click(300, 200); await p.waitForTimeout(500);
    await p.screenshot({ path: `${OUT}/hray-default-1440-${theme}.png` });
    const doc0 = await p.evaluate((id) => JSON.stringify(window.STRYKER_VELA.active.chart.drawings.all().find((d) => d.id === id).text), id);
    check(!/stk[VH]/.test(doc0), 'align: a new ray has no alignment stored (old label spot kept)', doc0);
    for (const [type, extra] of [['hray', null], ['vline', null], ['trendline', null], ['hline', null]]) {
      const did = type === 'hray' ? id : await p.evaluate(ADD, [0, type, extra]);
      // a double-click on the line opens its settings dialog (as a user does)
      await p.keyboard.press('Escape');
      const q = await p.evaluate(XY, [0, did, type === 'hray' || type === 'hline' ? 40 : 0]);
      await p.mouse.dblclick(q.x, type === 'vline' ? q.y - 120 : q.y);
      await p.waitForTimeout(600);
      const tab = await p.evaluate(() => { const t = [...document.querySelectorAll('button,[role=tab]')].find((x) => x.offsetParent && x.textContent.trim() === 'Text'); if (t) t.click(); return !!t; });
      await p.waitForTimeout(300);
      const row = await p.evaluate(() => { const lab = [...document.querySelectorAll('*')].find((x) => x.offsetParent && x.children.length === 0 && x.textContent.trim() === 'Text alignment');
        if (!lab) return null; const r = lab.parentElement, cy = (e) => { const b = e.getBoundingClientRect(); return b.top + b.height / 2; };
        const ctl = [...r.querySelectorAll('select,button,[role=combobox]')].filter((x) => x.offsetParent);
        const off = Math.max(...ctl.map((c) => Math.abs(cy(c) - cy(lab))));
        return { off: Math.round(off * 10) / 10, n: r.querySelectorAll('select,button,[role=combobox]').length, txt: r.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) }; });
      check(tab && !!row, `align: ${type} Text tab shows "Text alignment"`, row);
      check(row && row.off <= 1, `align: ${type} alignment row label and selects share one centre (<=1px)`, row && row.off);
      if (type === 'hray') {
        await p.screenshot({ path: `${OUT}/hray-texttab-1440-${theme}.png` });
      }
      await p.keyboard.press('Escape');
      await p.waitForTimeout(300);
      if (type !== 'hray') await p.evaluate((did) => window.STRYKER_VELA.active.chart.drawings.remove(did), did);
    }
    // set Right / Top through the same edit path the select uses and check it is stored and drawn
    await p.evaluate((id) => window.STRYKER_VELA.active.chart.drawings.update(id, { text: Object.assign({}, window.STRYKER_VELA.active.chart.drawings.all().find((d) => d.id === id).text, { stkH: 'right', stkV: 'top' }) }), id);
    await p.mouse.click(300, 200); await p.waitForTimeout(500);
    const doc1 = await p.evaluate((id) => window.STRYKER_VELA.active.chart.drawings.all().find((d) => d.id === id).text, id);
    check(doc1.stkH === 'right' && doc1.stkV === 'top' && doc1.value === 'WEEKLY SUPPLY 6998.58', 'align: ray saved with Right / Top', doc1);
    await p.screenshot({ path: `${OUT}/hray-right-top-1440-${theme}.png` });
    check(!errors.length, `align ${theme}: no page errors`, errors);
    await ctx.close();
  }

  // ---------- 2 + 3. clipboard ----------
  for (const theme of ['dark', 'light']) {
    const { ctx, p, errors } = await page(b, 1440, 900, theme);
    await p.evaluate(() => window.STRYKER_VELA.setLayout('2h'));
    await p.waitForFunction(() => { try { const c = window.STRYKER_VELA.cells(); return c.length === 2 && c.every((x) => x.chart.renderer.renderer.coords.barCount > 20); } catch (e) { return false; } }, null, { timeout: 90000 }).catch(() => {});
    await p.waitForTimeout(1500);
    check((await p.evaluate(() => window.STRYKER_VELA.cells().length)) === 2, 'clip: two-chart layout loaded');
    const id = await p.evaluate(ADD, [0, 'hray', { text: { value: 'WEEKLY SUPPLY', size: '14' } }]);
    await p.waitForTimeout(400);
    // keyboard: select, Ctrl+C, Ctrl+V
    const pt = await p.evaluate(XY, [0, id, 40]);
    await p.mouse.click(pt.x, pt.y);
    await p.waitForTimeout(200);
    await p.keyboard.press('Control+c');
    await p.keyboard.press('Control+v');
    await p.waitForTimeout(400);
    let l = await p.evaluate(LIST);
    check(l[0].length === 2 && l[0][0].a[0][1] === l[0][1].a[0][1] && l[0][1].text === 'WEEKLY SUPPLY', 'clip: Ctrl+C / Ctrl+V pastes a copy at the same price', l[0]);
    // second chart: paste the same drawing
    await p.evaluate(() => window.STRYKER_VELA.cells()[1].chart.drawings.paste());
    await p.waitForTimeout(300);
    l = await p.evaluate(LIST);
    check(l[1].length === 1 && l[1][0].a[0][1] === l[0][0].a[0][1], 'clip: the copy pastes on the other chart at the same price', l[1]);

    // right-click on the drawing: menu rows
    const open = async (x, y) => { await p.mouse.click(x, y, { button: 'right' }); await p.waitForTimeout(300);
      return p.evaluate(() => [...document.querySelectorAll('[role=menuitem]')].filter((x) => x.offsetParent).map((x) => ({ t: x.textContent.replace(/\s+/g, ' ').trim(), dis: x.getAttribute('aria-disabled') === 'true' || x.disabled }))); };
    const pick = (label) => p.evaluate((label) => { const it = [...document.querySelectorAll('[role=menuitem]')].find((x) => x.offsetParent && x.textContent.trim().startsWith(label)); if (it) it.click(); return !!it; }, label);
    const pt2 = await p.evaluate(XY, [0, id, 60]);
    let items = await open(pt2.x, pt2.y);
    const names = items.map((i) => i.t);
    check(['Copy', 'Paste', 'Copy price', 'Copy text'].every((n) => names.some((t) => t.startsWith(n))), 'menu: drawing right-click has Copy, Paste, Copy price, Copy text', names);
    if (theme === 'dark' || theme === 'light') await p.screenshot({ path: `${OUT}/clip-menu-1440-${theme}.png` });
    // menu alignment: rows share left padding, label centred vertically
    const geo = await p.evaluate(() => [...document.querySelectorAll('[role=menuitem]')].filter((x) => x.offsetParent).slice(0, 6).map((x) => { const r = x.getBoundingClientRect(); const s = [...x.querySelectorAll('span')].find((q) => q.textContent.trim() && !q.children.length); const sr = s && s.getBoundingClientRect(); return { l: Math.round(r.left), cy: r.top + r.height / 2, scy: sr ? sr.top + sr.height / 2 : null, h: Math.round(r.height) }; }));
    check(geo.every((g) => g.l === geo[0].l && (g.scy == null || Math.abs(g.scy - g.cy) <= 1)), 'menu: rows share one left edge, labels centred (<=1px)', geo);
    await pick('Copy price');
    await p.waitForTimeout(300);
    const price = await p.evaluate((id) => window.STRYKER_VELA.cells()[0].chart.drawings.all().find((d) => d.id === id).anchors[0].price, id);
    const copied = await p.evaluate(() => window.__copied.slice());
    check(copied.length === 1 && /^\d+\.\d{2}$/.test(copied[0]) && Math.abs(+copied[0] - price) < 0.01, 'menu: Copy price puts the price at tick decimals on the clipboard', { copied, price });
    await open(pt2.x, pt2.y);
    await pick('Copy text');
    await p.waitForTimeout(300);
    check((await p.evaluate(() => window.__copied.at(-1))) === 'WEEKLY SUPPLY', 'menu: Copy text copies the words');
    await open(pt2.x, pt2.y);
    await pick('Copy');
    // right-click empty chart: Paste here
    const el = await p.evaluate(() => { const r = window.STRYKER_VELA.cells()[0].chart.renderer.renderer.input.el.getBoundingClientRect(); return { x: r.left + r.width * 0.3, y: r.top + r.height * 0.2 }; });
    items = await open(el.x, el.y);
    check(items[0] && items[0].t.startsWith('Paste') && !items[0].dis, 'menu: chart right-click starts with an enabled Paste', items.slice(0, 3));
    await p.screenshot({ path: `${OUT}/clip-chartmenu-1440-${theme}.png` });
    const before = (await p.evaluate(LIST))[0].length;
    await pick('Paste');
    await p.waitForTimeout(400);
    l = await p.evaluate(LIST);
    const ny = await p.evaluate(([id]) => { const c = window.STRYKER_VELA.cells()[0], ds = c.chart.drawings.all(), d = ds[ds.length - 1], rr = c.chart.renderer.renderer, proj = rr.userDrawings.deps.projector(); return rr.input.el.getBoundingClientRect().top + proj.yOf(d.anchors[0].price, d.paneId); }, [id]);
    check(l[0].length === before + 1 && Math.abs(ny - el.y) < 3, 'menu: Paste lands at the clicked spot', { n: l[0].length, ny, y: el.y });
    check(!errors.length, `clip ${theme}: no page errors`, errors);
    await ctx.close();
  }
  // ---------- phone: Text tab of a Horizontal Ray fits ----------
  for (const theme of ['dark', 'light']) {
    const { ctx, p, errors } = await page(b, 390, 844, theme);
    const id = await p.evaluate(ADD, [0, 'hray', { text: { value: 'WEEKLY SUPPLY 6998.58', size: '14' } }]);
    await p.evaluate((id) => { const ud = window.STRYKER_VELA.active.chart.renderer.renderer.userDrawings; ud.openSettingsById(id, 0, 0); ud.popup.openPanel(); }, id);
    await p.waitForTimeout(600);
    await p.evaluate(() => { const t = [...document.querySelectorAll('button,[role=tab]')].find((x) => x.offsetParent && x.textContent.trim() === 'Text'); if (t) t.click(); });
    await p.waitForTimeout(400);
    const fit = await p.evaluate(() => { const lab = [...document.querySelectorAll('*')].find((x) => x.offsetParent && x.children.length === 0 && x.textContent.trim() === 'Text alignment');
      if (!lab) return null; const r = lab.parentElement.getBoundingClientRect(); return { l: r.left, r: r.right }; });
    check(fit && fit.l >= 0 && fit.r <= 390, `phone ${theme}: alignment row inside the screen`, fit);
    await p.screenshot({ path: `${OUT}/hray-texttab-390-${theme}.png` });
    check((await p.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'phone: no horizontal scroll');
    check(!errors.length, 'phone: no page errors', errors);
    await ctx.close();
  }
  await b.close();
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
