// Long / Short Position saved templates (assets/chart-pos-templates.js): save, apply, delete, default on a new draw,
// alignment measurements, screenshots 1440 dark / light and 390 dark (touch).
//   CHART_BASE=http://127.0.0.1:8071 node tools/tests/chart-pos-templates-browser.js [shotsDir]   (BEFORE=1: feature blocked, baseline shots)
// Run under flock /tmp/stryker-chrome.lock.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const bm = require('./binance-mock.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8071';
const OUT = process.argv[2] || '/tmp';
const BEFORE = !!process.env.BEFORE;
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined || ok ? '' : ' ' + JSON.stringify(x).slice(0, 500))); };

async function run(b, { w, h, theme, mobile, tag }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: !!mobile, isMobile: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((theme) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1'); localStorage.setItem('stryker_theme', theme); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick|workers\.dev)\./, (r) => r.abort());
  if (BEFORE) await ctx.route(/chart-pos-templates\.js/, (r) => r.abort());
  await bm.install(ctx);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) errors.push(String(e)); });
  await p.goto(BASE + '/charts.html?vela=0.9', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => { try { const ws = window.STRYKER_VELA; return ws && ws.cell(ws.active.id).chart.renderer.renderer.bars.length > 20; } catch (e) { return false; } }, null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  const R = (src, arg) => p.evaluate(([src, arg]) => { const ws = window.STRYKER_VELA; const cell = ws.cell(ws.active.id); const r = cell.chart.renderer.renderer; return (new Function('ws', 'cell', 'r', 'arg', src))(ws, cell, r, arg); }, [src, arg]);
  const box = await p.evaluate(() => { const c = [...document.querySelectorAll('#vela-chart canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]; const q = c.getBoundingClientRect(); return { x: q.left, y: q.top, w: q.width, h: q.height }; });
  const tap = async (x, y) => mobile ? p.touchscreen.tap(x, y) : p.mouse.click(x, y);
  const draw = async (type, back) => {
    const at = await R(`const n = r.bars.length; const bar = r.bars[n - arg]; const proj = r.drawingProjector(); const pid = r.scene.panes.keys().next().value; return { x: proj.xOf(bar.time), y: proj.yOf(bar.close, pid) };`, back);
    await R('cell.chart.drawings.setTool(arg); return 1;', type);
    await tap(box.x + at.x, box.y + at.y); await p.waitForTimeout(200);
    await tap(box.x + at.x + (mobile ? 4 : 2), box.y + at.y - 1); await p.waitForTimeout(500);
  };
  const pos = (type) => R(`const ds = r.userDrawings.drawings.filter((x) => x.type === arg); const d = ds[ds.length - 1]; if (!d) return null; const w = d.serialize(); return { id: d.id, risk: d.riskPercent, bal: d.accountBalance, pc: d.profitColor, lc: d.lossColor, lw: d.style.lineWidth, rr: +d.rr().toFixed(3), stopD: Math.abs(d.anchors[1].price - d.anchors[0].price), tgtD: Math.abs(d.anchors[2].price - d.anchors[0].price) };`, type);
  const openSettings = async (id) => {
    if (mobile) {   // the real phone path: select the box, tap the gear on its floating bar
      await R('r.userDrawings.popup.close && r.userDrawings.popup.close(); r.userDrawings.clearSelection && r.userDrawings.clearSelection(); return 1;');
      await p.waitForTimeout(300);
      const c = await R('const d = r.userDrawings.drawings.find((x) => x.id === arg); const pts = d.handlePoints(r.drawingProjector()); return { x: (pts[0][0] + pts[3][0]) / 2, y: (pts[0][1] + pts[2][1]) / 2 };', id);
      await p.touchscreen.tap(box.x + c.x, box.y + c.y); await p.waitForTimeout(500);
      await p.evaluate(() => { const l = [...document.querySelectorAll('.vela-dpop-btn')].find((b) => /lock/i.test(b.getAttribute('aria-label') || '')); const g = l && l.previousElementSibling; if (g) g.click(); });
      await p.waitForTimeout(600);
    } else {
      await R('r.userDrawings.openSettings(arg); r.userDrawings.popup.openPanel(); return 1;', id);
      await p.waitForTimeout(500);
    }
  };
  const clickBtn = async (sel) => { const b = p.locator(sel).first(); await b.scrollIntoViewIfNeeded(); await b.click(); await p.waitForTimeout(250); };
  const set = (id, props) => R('cell.chart.drawings.update(arg.id, { props: arg.props }); return 1;', { id, props });

  await draw('position', 30);
  let d1 = await pos('position');
  check(!!d1, tag + ' long position drawn', d1);
  if (BEFORE) {
    await openSettings(d1.id);
    await p.screenshot({ path: `${OUT}/before-${tag}.png` }); console.log('shot', `${OUT}/before-${tag}.png`);
    check((await p.locator('.stk-ptpl-btn').count()) === 0, tag + ' baseline has no Templates button');
    await ctx.close(); return;
  }
  // make the box "fixed": risk 2.5 %, balance 25 000, colours
  await set(d1.id, { riskPercent: 2.5, accountBalance: 25000, profitColor: '#2962ff', lossColor: '#ff9800' });
  await p.waitForTimeout(200);
  const base = await pos('position');
  await openSettings(d1.id);
  check((await p.locator('.stk-ptpl-btn').count()) === 1, tag + ' Templates button in the settings window', await p.evaluate(() => [document.querySelectorAll('.vela-dsp').length, !!document.querySelector('.vela-dialog-footer'), document.body.innerText.length]));
  check(await p.locator('.vela-dsp-style').first().isHidden(), tag + ' old one-style Template button hidden (replaced)');
  await clickBtn('.stk-ptpl-btn');
  check((await p.locator('.stk-ptpl-menu').count()) === 1, tag + ' menu opens');
  await p.screenshot({ path: `${OUT}/after-${tag}-menu-empty.png` });
  // save "Edge A"
  await clickBtn('.stk-ptpl-add');
  await p.fill('.stk-ptpl-form input', 'Edge A');
  await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  let db = await p.evaluate(() => JSON.parse(localStorage.getItem('stryker_pos_tpl')));
  check(db.list.length === 1 && db.list[0].name === 'Edge A' && db.list[0].p.riskPercent === 2.5 && db.list[0].p.accountBalance === 25000 && db.list[0].p.profitColor === '#2962ff', tag + ' saved to localStorage', db);
  check(db.list[0].st > 0 && db.list[0].tg > 0, tag + ' stores stop / target distance', db.list[0]);
  // save a second one with other settings (via a new box)
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate(() => document.querySelector('.stk-ptpl-menu') && document.querySelector('.stk-ptpl-btn').click());
  await p.waitForTimeout(200);
  // second template: change colours then save "Edge B"
  await set(d1.id, { riskPercent: 0.5, profitColor: '#e91e63' }); await p.waitForTimeout(200);
  if (!(await p.locator('.stk-ptpl-menu').count())) await clickBtn('.stk-ptpl-btn');
  await clickBtn('.stk-ptpl-add'); await p.fill('.stk-ptpl-form input', 'Edge B'); await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  db = await p.evaluate(() => JSON.parse(localStorage.getItem('stryker_pos_tpl')));
  check(db.list.length === 2, tag + ' second template saved', db.list.map((t) => t.name));
  await p.screenshot({ path: `${OUT}/after-${tag}-menu-two.png` }); console.log('shot', `${OUT}/after-${tag}-menu-two.png`);

  // ---- alignment measurements (menu + button) ----
  const al = await p.evaluate(() => {
    const q = (s) => document.querySelector(s), r = (e) => e.getBoundingClientRect(), cy = (e) => { const b = r(e); return b.top + b.height / 2; };
    const menu = q('.stk-ptpl-menu'), mb = r(menu), out = { rows: [], overflowX: document.documentElement.scrollWidth > innerWidth };
    for (const row of menu.querySelectorAll('.stk-ptpl-row')) { const kids = [...row.children].map((k) => k.querySelector('svg, .stk-ptpl-nm, .stk-ptpl-sw') ? cy(k.querySelector('svg, .stk-ptpl-nm') || k) : cy(k)); out.rows.push(Math.max(...kids) - Math.min(...kids)); }
    const nm = [...menu.querySelectorAll('.stk-ptpl-nm')].map((e) => e.scrollWidth <= e.clientWidth + 1);
    const pads = { l: Math.round(r(menu.querySelector('.stk-ptpl-h')).left - mb.left), r: Math.round(mb.right - r(menu.querySelector('.stk-ptpl-ic')).right) };
    const btn = q('.stk-ptpl-btn'), br = r(btn), sp = btn.querySelector('span'), sr = r(sp), sv = r(btn.querySelector('svg'));
    out.btn = { h: br.height, textMid: Math.abs(cy(sp) - cy(btn)), chevMid: Math.abs(cy(btn.querySelector('svg')) - cy(btn)), padL: sr.left - br.left, padR: br.right - sv.right };
    out.inView = mb.left >= 0 && mb.right <= innerWidth && mb.top >= 0 && mb.bottom <= innerHeight;
    out.nmFit = nm.every(Boolean); out.pads = pads; out.menuW = mb.width;
    const foot = q('.vela-dialog-footer'); out.footBtns = [...foot.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => Math.round(cy(b)));
    return out;
  });
  console.log('align', JSON.stringify(al));
  check(al.rows.every((v) => v <= 1), tag + ' menu rows share one vertical centre', al.rows);
  check(al.btn.textMid <= 1 && al.btn.chevMid <= 1, tag + ' button text + chevron centred', al.btn);
  check(Math.abs(al.btn.padL - al.btn.padR) <= 1, tag + ' button even left / right padding', al.btn);
  check(al.inView && al.nmFit && !al.overflowX, tag + ' menu inside the viewport, names not clipped, no horizontal scroll', al);
  check(Math.max(...al.footBtns) - Math.min(...al.footBtns) <= 1, tag + ' footer buttons share one centre', al.footBtns);
  check(al.btn.h >= 32, tag + ' button height ok', al.btn.h);

  // ---- apply: a NEW box takes Edge A ----
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  await R('r.userDrawings.popup.close && r.userDrawings.popup.close(); return 1;');
  await R('cell.chart.drawings.resetToolDefaults("position"); return 1;');
  await draw('position', 26);
  const d2 = await pos('position');
  check(d2 && d2.id !== d1.id && d2.risk === 1 && d2.pc === '#089981', tag + ' new box starts from factory settings (no default yet)', d2);
  await openSettings(d2.id);
  await clickBtn('.stk-ptpl-btn');
  await p.locator('.stk-ptpl-use', { hasText: 'Edge A' }).click(); await p.waitForTimeout(400);
  const d2a = await pos('position');
  check(d2a.risk === 2.5 && d2a.bal === 25000 && d2a.pc === '#2962ff' && d2a.lc === '#ff9800', tag + ' apply Edge A: risk / balance / colours', d2a);
  const exp = await p.evaluate(() => { const t = JSON.parse(localStorage.getItem('stryker_pos_tpl')).list[0]; return { st: t.st, tg: t.tg, u: t.u }; });
  const dist = await R('const d = r.userDrawings.drawings.find((x) => x.id === arg); return { st: d.levelDisplayValue("stop", "ticks"), tg: d.levelDisplayValue("target", "ticks"), u: d.constructor.stkSpec && d.constructor.stkSpec() ? "ticks" : "pts" };', d2.id);
  check(exp.u !== dist.u || (dist.st === exp.st && dist.tg === exp.tg), tag + ' apply Edge A: stop / target distance (' + exp.u + ')', { exp, dist });
  // the window shows the applied value
  const shown = await p.evaluate(() => [...document.querySelectorAll('.vela-dsp input')].map((i) => i.value).join('|'));
  check(/2\.5/.test(shown) && /25000|25,000/.test(shown), tag + ' settings window refreshed with the applied values', shown.slice(0, 200));
  await p.screenshot({ path: `${OUT}/after-${tag}-applied.png` }); console.log('shot', `${OUT}/after-${tag}-applied.png`);

  // ---- default: star Edge B, draw new (long + short) ----
  await p.waitForTimeout(150);
  await clickBtn('.stk-ptpl-btn');
  await p.locator('.stk-ptpl-row', { hasText: 'Edge B' }).locator('.stk-ptpl-ic').first().click(); await p.waitForTimeout(250);
  db = await p.evaluate(() => JSON.parse(localStorage.getItem('stryker_pos_tpl')));
  check(db.def === db.list.find((t) => t.name === 'Edge B').id, tag + ' star sets the default', db.def);
  await p.screenshot({ path: `${OUT}/after-${tag}-default.png` }); console.log('shot', `${OUT}/after-${tag}-default.png`);
  await p.keyboard.press('Escape'); await R('r.userDrawings.popup.close && r.userDrawings.popup.close(); return 1;');
  await draw('position', 22);
  const d3 = await pos('position');
  check(d3 && d3.id !== d2.id && d3.risk === 0.5 && d3.pc === '#e91e63', tag + ' new Long box starts from the default template', d3);
  await draw('shortposition', 18);
  const d4 = await pos('shortposition');
  const side = await R('const d = r.userDrawings.drawings.find((x) => x.id === arg); return d.direction;', d4 && d4.id);
  check(d4 && d4.risk === 0.5 && d4.pc === '#e91e63' && side === 'short', tag + ' new Short box starts from the default template, side kept', { d4, side });
  // survives reload
  const reloadDb = await p.evaluate(() => localStorage.getItem('stryker_pos_tpl'));
  check(!!reloadDb && JSON.parse(reloadDb).list.length === 2, tag + ' templates kept in localStorage');

  // ---- clear default, then delete ----
  await openSettings(d4.id);
  await clickBtn('.stk-ptpl-btn');
  await p.locator('.stk-ptpl-row', { hasText: 'Edge B' }).locator('.stk-ptpl-ic').first().click(); await p.waitForTimeout(200);
  db = await p.evaluate(() => JSON.parse(localStorage.getItem('stryker_pos_tpl')));
  check(db.def === null, tag + ' star again clears the default', db.def);
  await p.keyboard.press('Escape'); await R('r.userDrawings.popup.close && r.userDrawings.popup.close(); return 1;');
  await R('cell.chart.drawings.resetToolDefaults("position"); return 1;');
  await draw('position', 14);
  const d5 = await pos('position');
  check(d5 && d5.risk === 1 && d5.pc === '#089981', tag + ' no default: new box is factory again', d5);
  await openSettings(d5.id);
  await clickBtn('.stk-ptpl-btn');
  await p.locator('.stk-ptpl-row', { hasText: 'Edge A' }).locator('.stk-ptpl-ic').nth(1).click(); await p.waitForTimeout(250);
  db = await p.evaluate(() => JSON.parse(localStorage.getItem('stryker_pos_tpl')));
  check(db.list.length === 1 && db.list[0].name === 'Edge B', tag + ' delete removes Edge A', db.list.map((t) => t.name));
  await p.locator('.stk-ptpl-row', { hasText: 'Edge B' }).locator('.stk-ptpl-ic').first().click(); await p.waitForTimeout(150);
  await p.locator('.stk-ptpl-row', { hasText: 'Edge B' }).locator('.stk-ptpl-ic').nth(1).click(); await p.waitForTimeout(250);
  db = await p.evaluate(() => JSON.parse(localStorage.getItem('stryker_pos_tpl')));
  check(db.list.length === 0 && db.def === null, tag + ' deleting the default template clears the default', db);
  check((await p.locator('.stk-ptpl-empty').count()) === 1, tag + ' empty state shown');
  check(errors.length === 0, tag + ' no page errors', errors.slice(0, 3));
  await ctx.close();
}

(async () => {
  const b = await launch();
  try {
    for (const v of [{ w: 1440, h: 900, theme: 'dark', tag: '1440-dark' }, { w: 1440, h: 900, theme: 'day', tag: '1440-light' }, { w: 390, h: 844, theme: 'dark', mobile: true, tag: '390-dark' }]) await run(b, v);
  } finally { await b.close(); }
  console.log(fail ? `FAILED ${fail}` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
