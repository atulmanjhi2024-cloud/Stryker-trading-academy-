// Drawing Copy / Paste / Copy price / Copy text (beta request 22 Nov).
//   CHART_BASE=http://127.0.0.1:PORT node tools/tests/chart-clipboard-browser.js <shotsDir> [light]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '.';
const LIGHT = process.argv[3] === 'light';
const TH = LIGHT ? 'light' : 'dark';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };

(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((light) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1'); if (light) localStorage.setItem('stryker_theme', 'day'); } catch (e) {}
    let L; Object.defineProperty(window, 'StrykerPineLibrary', { configurable: true, get() { return L; }, set(v) { if (v) v.isAdmin = () => Promise.resolve(true); L = v; } });
  }, LIGHT);
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick|workers\.dev|binance)\./, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) errors.push(String(e)); });
  await p.goto(BASE + '/charts.html?vela=0.9', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => { try { const ws = window.STRYKER_VELA; return ws && ws.cell(ws.active.id).chart.renderer.renderer.coords.barCount > 50; } catch (e) { return false; } }, null, { timeout: 60000 });
  await p.waitForTimeout(2000);
  const R = (src, arg) => p.evaluate(([src, arg]) => { const ws = window.STRYKER_VELA; const cell = ws.cell(ws.active.id); const r = cell.chart.renderer.renderer; return (new Function('ws', 'cell', 'r', 'arg', src))(ws, cell, r, arg); }, [src, arg]);
  const clipText = () => p.evaluate(() => navigator.clipboard.readText());

  // unit: price text at tick decimals
  const pt = await p.evaluate(() => [window.__stkPriceText(6998.58, 0.25), window.__stkPriceText(1.234567, 0.00001), window.__stkPriceText(5, undefined)]);
  check(JSON.stringify(pt) === '["6998.58","1.23457","5.00"]', 'price text uses tick decimals', pt);

  // a horizontal ray with words, placed in code
  const geo = await R(`
    const proj = r.userDrawings.deps.projector(), W = proj.width, H = proj.height;
    const a = proj.pxToPoint(W * 0.3, H * 0.45, 'price');
    cell.chart.drawings.fromJSON([{ id: 'cHR', type: 'hray', paneId: 'price', anchors: [a], style: { lineColor: '#2962ff', lineWidth: 2, lineStyle: 'solid' }, text: { value: 'WEEKLY SUPPLY', size: '12' } }]);
    const el = r.input.el.getBoundingClientRect();
    return { x: el.left + W * 0.5, y: el.top + proj.yOf(a.price, 'price'), price: a.price, time: a.time, mt: r.scene.priceMintick, ex: el.left + W * 0.55, ey: el.top + H * 0.75 };`);
  const n0 = (await R('return cell.chart.drawings.all().length;'));

  // right-click the drawing: menu rows
  await p.mouse.move(geo.x, geo.y); await p.waitForTimeout(150);
  await p.mouse.click(geo.x, geo.y, { button: 'right' }); await p.waitForTimeout(400);
  const rows = await p.$$eval('.vela-menu-item', (xs) => xs.filter((x) => x.offsetParent).map((x) => x.querySelector('.vela-menu-label')?.textContent));
  check(['Copy', 'Paste', 'Copy price', 'Copy text'].every((x) => rows.includes(x)), 'drawing menu has Copy / Paste / Copy price / Copy text', rows);
  // menu alignment: label + hint rows share one vertical centre
  const al = await p.evaluate(() => {
    const li = [...document.querySelectorAll('.vela-menu-item')].find((x) => x.offsetParent && x.querySelector('.vela-menu-label')?.textContent === 'Copy');
    const r0 = li.getBoundingClientRect(), l = li.querySelector('.vela-menu-label').getBoundingClientRect(), h = li.querySelector('.vela-menu-hint')?.getBoundingClientRect();
    const c = (q) => (q.top + q.bottom) / 2;
    return { dl: Math.abs(c(l) - c(r0)), dh: h ? Math.abs(c(h) - c(r0)) : null, inside: h ? h.right <= r0.right : true };
  });
  check(al.dl <= 1 && (al.dh == null || al.dh <= 1) && al.inside, 'menu row label + shortcut centred and inside the row', al);
  await p.screenshot({ path: OUT + `/clipboard-1440-${TH}-drawing-menu.png` });
  await p.click('.vela-menu-item:has(.vela-menu-label:text-is("Copy price"))'); await p.waitForTimeout(300);
  const priceTxt = await clipText();
  check(/^\d+(\.\d+)?$/.test(priceTxt) && Math.abs(Number(priceTxt) - geo.price) < 0.01 + (geo.mt || 0), 'Copy price puts the price on the clipboard', { priceTxt, price: geo.price, tick: geo.mt });

  await p.mouse.click(geo.x, geo.y, { button: 'right' }); await p.waitForTimeout(300);
  await p.click('.vela-menu-item:has(.vela-menu-label:text-is("Copy text"))'); await p.waitForTimeout(300);
  check(await clipText() === 'WEEKLY SUPPLY', 'Copy text puts the words on the clipboard');

  // Copy from the menu, then Paste on the chart at another spot
  await p.mouse.click(geo.x, geo.y, { button: 'right' }); await p.waitForTimeout(300);
  await p.click('.vela-menu-item:has(.vela-menu-label:text-is("Copy"))'); await p.waitForTimeout(200);
  await p.mouse.move(geo.ex, geo.ey); await p.waitForTimeout(150);
  await p.mouse.click(geo.ex, geo.ey, { button: 'right' }); await p.waitForTimeout(400);
  const rows2 = await p.$$eval('.vela-menu-item', (xs) => xs.filter((x) => x.offsetParent).map((x) => x.querySelector('.vela-menu-label')?.textContent));
  check(rows2[0] === 'Paste', 'chart menu starts with Paste', rows2);
  await p.screenshot({ path: OUT + `/clipboard-1440-${TH}-chart-menu.png` });
  await p.click('.vela-menu-item:has(.vela-menu-label:text-is("Paste"))'); await p.waitForTimeout(300);
  const at = await R('const a = cell.chart.drawings.all(); const d = a[a.length - 1]; const proj = r.userDrawings.deps.projector(); return { n: a.length, type: d.type, text: d.text && d.text.value, y: proj.yOf(d.anchors[0].price, "price") + r.input.el.getBoundingClientRect().top, price: d.anchors[0].price };');
  check(at.n === n0 + 1 && at.type === 'hray' && at.text === 'WEEKLY SUPPLY', 'Paste here adds a copy', at);
  check(Math.abs(at.y - geo.ey) < 4, 'pasted at the clicked spot', { y: at.y, want: geo.ey });
  await R('cell.chart.drawings.select([]); return 1;'); await p.waitForTimeout(200);
  await p.screenshot({ path: OUT + `/clipboard-1440-${TH}-after-paste.png` });

  // keyboard: select the original, Ctrl+C, Ctrl+V -> a copy at the same price and time
  await R('cell.chart.drawings.select(["cHR"]); return 1;');
  await p.mouse.move(geo.ex, geo.ey + 40);
  await p.keyboard.press('Control+c'); await p.waitForTimeout(150);
  await p.keyboard.press('Control+v'); await p.waitForTimeout(300);
  const kb = await R('const a = cell.chart.drawings.all(); const d = a[a.length - 1]; return { n: a.length, price: d.anchors[0].price, time: d.anchors[0].time, id: d.id };');
  check(kb.n === n0 + 2 && kb.price === geo.price && kb.time === geo.time && kb.id !== 'cHR', 'Ctrl+C / Ctrl+V pastes at the same price and time', kb);

  // other chart: the clipboard is shared by every chart on the page (other timeframe or layout cell)
  const shared = await p.evaluate(() => (globalThis.__stkDrawClip || []).map((d) => d.type));
  check(shared.length === 1 && shared[0] === 'hray', 'clipboard is page-wide (other charts / timeframes can paste it)', shared);
  // switch timeframe and paste
  const tf = await R('const cur = cell.chart.market.timeframe; return cur;');
  await R('const tfs = ["15m", "1h", "4h"]; const cur = cell.chart.market.timeframe; const next = tfs.find((t) => t !== cur); cell.chart.setTimeframe ? cell.chart.setTimeframe(next) : cell.chart.setMarket({ timeframe: next }); return next;').catch((e) => console.log('tf switch', String(e)));
  await p.waitForTimeout(2500);
  const after = await R('const before = cell.chart.drawings.all().length; cell.chart.drawings.paste(); const a = cell.chart.drawings.all(); return { tf: cell.chart.market.timeframe, before, n: a.length, last: a[a.length - 1].anchors[0].price };');
  check(after.n === after.before + 1 && after.last === geo.price, 'paste after a timeframe change keeps the price', { from: tf, ...after });
  check(errors.length === 0, 'no page errors', errors.slice(0, 4));
  await ctx.close(); await b.close();
  console.log(fail ? `FAILED ${fail}` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
