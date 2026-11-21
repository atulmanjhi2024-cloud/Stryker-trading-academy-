// Trade display (eye button next to Positions & Orders): every toggle, labels, align, P&L units, persistence, phone sheet.
//   node tools/tests/chart-dev-server.mjs 8032 &
//   CHART_BASE=http://127.0.0.1:8032 flock /tmp/stryker-chrome.lock node tools/tests/chart-tradeview-browser.js <shotsDir>
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp/tradeview';
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };
const SYM = 'hyperliquid:BTC';

async function open(b, w, theme) {
  const mobile = w < 500;
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', t); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net|[a-z0-9.-]*hyperliquid\.xyz)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e.message || e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|WebSocket connection/.test(m.text())) errs.push(m.text()); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { window.__stkPaper.setEnabled(true); window.__stkPaper.tradeUi(true); });   // Owner 18 Nov: phone strip (with this pill) shows only while trading is open
  await p.evaluate(async (s) => { const ws = window.STRYKER_VELA; ws.active.setSymbol(s); ws.active.setTimeframe('1'); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.orchestrator.rawBars.length > 50) break; } }, SYM);
  await p.waitForTimeout(3000);
  return { ctx, p, errs };
}
const wait = (p, fn, arg, ms = 8000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
const chartH = (p) => p.evaluate(() => document.querySelector('#vela-chart .vela-ws-main').getBoundingClientRect().height);
const POP = '#stktv-pop';
const state = (p) => p.evaluate(() => {
  const R = window.STRYKER_VELA.active, out = { lines: [], chips: [] };
  for (const c of document.querySelectorAll('.stkpt-chip')) out.chips.push({ id: c.dataset.id, vis: c.style.visibility !== 'hidden', a: c.querySelector('.stkpt-chip-a').textContent, b: c.querySelector('.stkpt-chip-b').textContent, x: !!c.querySelector('.stkpt-chip-x') && getComputedStyle(c.querySelector('.stkpt-chip-x')).display !== 'none', r: Math.round(c.getBoundingClientRect().right), l: Math.round(c.getBoundingClientRect().left) });
  return out;
});
const setTv = (p, k, v) => p.evaluate(([k, v]) => { window.__stkTradeView.set(k, v); window.__stkPaper.pushLines(true); }, [k, v]);
const chipIds = async (p) => { await p.waitForTimeout(300); return (await state(p)).chips.filter((c) => c.vis).map((c) => c.id).sort(); };
const ctr = (p, sel) => p.evaluate((s) => [...document.querySelectorAll(s)].map((e) => { const r = e.getBoundingClientRect(); return { cy: r.top + r.height / 2, cx: r.left + r.width / 2, w: r.width, h: r.height, l: r.left, r: r.right, t: r.top, b: r.bottom, sw: e.scrollWidth, cw: e.clientWidth }; }), sel);

(async () => {
  const b = await launch();
  try {
    for (const [w, theme] of [[1440, 'night'], [1440, 'day']]) {
      const { ctx, p, errs } = await open(b, w, theme), L = w + ' ' + theme + ': ', tn = theme === 'night' ? 'dark' : 'light';
      await p.evaluate(() => localStorage.removeItem('stryker_tradeview_ui'));
      await wait(p, () => { const e = document.getElementById('stktv-btn'); return e && e.previousElementSibling === document.getElementById('stkpo-btn') && e.offsetWidth > 0; });
      const bt = await p.evaluate(() => { const e = document.getElementById('stktv-btn'), po = document.getElementById('stkpo-btn'); return e && { vis: e.offsetWidth > 0, title: e.title, aria: e.getAttribute('aria-label'), after: e.previousElementSibling === po, h: e.getBoundingClientRect().height, poH: po.getBoundingClientRect().height, cy: e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2, pocy: po.getBoundingClientRect().top + po.getBoundingClientRect().height / 2 }; });
      check(bt && bt.vis && bt.title === 'Trade display' && bt.aria === 'Trade display', L + 'button present, tooltip "Trade display"', bt);
      check(bt && bt.after, L + 'button sits right after Positions & Orders');
      check(bt && Math.abs(bt.cy - bt.pocy) <= 1 && bt.h === bt.poH, L + 'same height + centre as Positions & Orders', bt);
      // a position, a working order with TP + SL, a fill in history
      await p.evaluate(() => window.__stkPaper.placeOrder({ symbol: 'hyperliquid:BTC', side: 'buy', type: 'market', qty: 1 }));
      await wait(p, () => Object.keys(window.__stkPaper.account.state.positions).length === 1);
      const last = await p.evaluate(() => window.__stkPaper.account.last['hyperliquid:BTC']);
      await p.evaluate(([l]) => { const a = window.__stkPaper; a.placeOrder({ symbol: 'hyperliquid:BTC', side: 'buy', type: 'limit', qty: 1, price: Math.round(l * 0.9), tp: Math.round(l * 0.95), sl: Math.round(l * 0.85) }); a.account.modifyPosition('hyperliquid:BTC', { tp: Math.round(l * 1.05), sl: Math.round(l * 0.97) }); a.pushLines(true); }, [last]);
      await wait(p, () => document.querySelectorAll('.stkpt-chip').length >= 5);
      const all = await chipIds(p);
      check(all.length >= 5 && all.includes('pos') && all.includes('ptp') && all.includes('psl'), L + 'default look: position, TP, SL, order + its TP/SL chips', all);
      const defChip = (await state(p)).chips.find((c) => c.id === 'pos');
      check(/^LONG 1 @ /.test(defChip.a) && /^[+-]?\$/.test(defChip.b) && defChip.x, L + 'default position label unchanged', defChip);
      await p.click('#stktv-btn');
      check(await wait(p, () => !document.querySelector('#stktv-pop').hidden), L + 'click opens the popover');
      await p.waitForTimeout(300);
      const rows = await p.$$eval(POP + ' .stktv-body > .stktv-r .t, ' + POP + ' .stktv-sec', (a) => a.map((x) => x.textContent.trim()));
      check(['Open trades', 'Orders', 'TP and SL', 'Position', 'Trade history', 'Executions', 'Order preview', 'Labels'].every((t) => rows.includes(t)), L + 'menu rows', rows);
      check(/Every chart, every account\./.test(await p.textContent(POP + ' .stktv-foot')), L + 'footer text');
      check((await p.textContent(POP + ' [data-go=labels] .v')) === 'Right', L + 'Labels row shows "Right"');
      await p.screenshot({ path: OUT + '/menu-' + w + '-' + tn + '.png' });
      // alignment gate on the popover
      const rr = await p.evaluate(() => { const rs = [...document.querySelectorAll('#stktv-pop .stktv-body > .stktv-r')].map((r) => { const rb = r.getBoundingClientRect(); const kids = [...r.children].map((k) => { const kb = k.getBoundingClientRect(); return { cy: kb.top + kb.height / 2, l: kb.left, r: kb.right, t: kb.top, b: kb.bottom }; }); return { rcy: rb.top + rb.height / 2, kids, over: r.scrollWidth > r.clientWidth + 1, l: rb.left, r: rb.right }; }); const pb = document.getElementById('stktv-pop').getBoundingClientRect(); return { rs, pl: pb.left, pr: pb.right, pw: pb.width, hs: document.getElementById('stktv-pop').scrollWidth > document.getElementById('stktv-pop').clientWidth + 1 }; });
      const bad = rr.rs.filter((r) => r.kids.some((k) => Math.abs(k.cy - r.rcy) > 1) || r.over);
      check(bad.length === 0 && !rr.hs, L + 'every row: icon/label/eye share one centre, no overflow', bad.slice(0, 2));
      const eyes = await p.$$eval(POP + ' .stktv-body > .stktv-r .eye', (a) => a.map((x) => Math.round(x.getBoundingClientRect().right)));
      check(new Set(eyes).size === 1, L + 'eye toggles right-aligned in one column', eyes);
      const gaps = rr.rs.map((r) => ({ l: Math.round(r.kids[0].l - r.l), rr: Math.round(r.r - r.kids[r.kids.length - 1].r) }));
      check(gaps.every((g) => Math.abs(g.l - gaps[0].l) <= 1 && Math.abs(g.rr - gaps[0].rr) <= 1 && Math.abs(g.l - g.rr) <= 1), L + 'even left/right padding in rows', gaps[0]);
      // every toggle hides / shows its drawing
      const tog = async (k) => { await p.click(POP + ' [data-t=' + k + ']'); await p.waitForTimeout(250); };
      await tog('ord'); let ids = await chipIds(p);
      check(!ids.some((i) => /^o\d+$/.test(i)) && ids.includes('pos') && ids.includes('ptp'), L + 'Orders toggle hides the order line only', ids);
      await tog('ord'); await tog('tpsl'); ids = await chipIds(p);
      check(!ids.some((i) => /tp|sl/.test(i)) && ids.includes('pos'), L + 'TP and SL toggle hides every TP/SL', ids);
      await tog('tpsl'); await tog('pos'); ids = await chipIds(p);
      check(!ids.includes('pos') && ids.includes('ptp'), L + 'Position toggle hides the avg-price line', ids);
      await tog('pos'); await tog('master'); ids = await chipIds(p);
      check(ids.length === 0, L + 'master eye hides every trading drawing', ids);
      check((await p.getAttribute(POP + ' [data-t=master]', 'aria-checked')) === 'false', L + 'master reports off');
      await tog('master'); ids = await chipIds(p);
      check(ids.length === all.length, L + 'master back on restores them all', [ids.length, all.length]);
      // canvas lines: layer data carries only visible lines
      const nl = () => p.evaluate(() => { const R = window.STRYKER_VELA.active; const l = (R.chart || R).extLayers; return 0; });
      // break-even line + RR box + executions are off by default
      await tog('be'); ids = await chipIds(p);
      check(ids.includes('be'), L + 'Break-even toggle adds the break-even line', ids);
      await tog('be'); ids = await chipIds(p);
      check(!ids.includes('be'), L + 'Break-even off again');
      const exOn = async () => { await tog('exe'); return p.evaluate(() => window.__stkTradeView.get().exe); };
      check(await exOn() === true, L + 'Executions toggle turns on'); await p.waitForTimeout(300); await tog('exe');
      await tog('pv'); check(await p.evaluate(() => window.__stkTradeView.get().pv) === true, L + 'Order preview toggle on'); await tog('pv');
      // order preview draws while the ticket is open
      await p.keyboard.press('Escape'); await p.waitForTimeout(200);
      await setTv(p, 'pv', true);
      await p.evaluate(() => window.__stkPaper.openTicket({ symbol: 'hyperliquid:BTC', side: 'buy', type: 'limit' })); await p.waitForTimeout(500);
      ids = await chipIds(p);
      check(ids.includes('pv-e'), L + 'ticket draws a dashed order-preview line', ids);
      await setTv(p, 'pv', false); ids = await chipIds(p);
      check(!ids.includes('pv-e'), L + 'preview off: line gone', ids);
      await p.evaluate(() => document.getElementById('stkpt-tk').hidden = true); await p.evaluate(() => window.__stkPaper.pushLines(true));
      ids = await chipIds(p);
      await setTv(p, 'pv', true); await p.waitForTimeout(300);
      await setTv(p, 'pv', false);
      // Labels submenu
      await p.click('#stktv-btn'); if (await p.evaluate(() => document.querySelector('#stktv-pop').hidden)) await p.click('#stktv-btn');
      await p.click(POP + ' [data-go=labels]'); await p.waitForTimeout(250);
      const strip = await p.evaluate(() => ({ chips: document.querySelectorAll('#stktv-pop .stktv-strip .stktv-chip').length, note: document.querySelector('#stktv-pop .stktv-strip small').textContent }));
      check(strip.chips === 2 && /sample data/i.test(strip.note), L + 'labels preview strip: TP + position sample chips, "Sample data"', strip);
      await p.screenshot({ path: OUT + '/labels-' + w + '-' + tn + '.png' });
      const pos = async () => (await state(p)).chips.find((c) => c.id === 'pos');
      await p.click(POP + ' [data-t="lab.side"]'); await p.waitForTimeout(250);
      let c1 = await pos(); check(!/LONG/.test(c1.a) && /1/.test(c1.a), L + 'Side off: no LONG/SHORT word', c1);
      await p.click(POP + ' [data-t="lab.side"]'); await p.click(POP + ' [data-t="lab.price"]'); await p.waitForTimeout(250);
      c1 = await pos(); check(!/@/.test(c1.a), L + 'Price off: no @ price', c1);
      await p.click(POP + ' [data-t="lab.price"]'); await p.click(POP + ' [data-t="lab.size"]'); await p.waitForTimeout(250);
      c1 = await pos(); check(/^LONG @/.test(c1.a), L + 'Size off: no quantity', c1);
      await p.click(POP + ' [data-t="lab.size"]'); await p.click(POP + ' [data-t="lab.pnl"]'); await p.waitForTimeout(250);
      c1 = await pos(); check(c1.b === '', L + 'P&L off: no P&L half', c1);
      await p.click(POP + ' [data-t="lab.pnl"]'); await p.click(POP + ' [data-t="lab.btn"]'); await p.waitForTimeout(250);
      c1 = await pos(); check(c1.x === false, L + 'Buttons off: no × on the chip', c1);
      await p.click(POP + ' [data-t="lab.btn"]'); await p.waitForTimeout(250);
      // align
      const al = {};
      for (const a of ['left', 'center', 'right']) { await p.click(POP + ' [data-seg=align][data-v=' + a + ']'); await p.waitForTimeout(350); const c = await pos(); const cw = await p.evaluate(() => document.querySelector('#vela-chart .vela-ws-main').getBoundingClientRect()); al[a] = { l: c.l, r: c.r, cw: Math.round(cw.left + cw.width / 2) }; }
      check(al.left.l < al.center.l && al.center.l < al.right.l, L + 'Align Left < Center < Right on the chart', al);
      check(Math.abs((al.center.l + al.center.r) / 2 - al.center.cw) < al.center.cw * 0.5, L + 'centre alignment is near the pane middle', al);
      check((await p.textContent(POP + ' .stktv-strip .al')) !== null && (await p.getAttribute(POP + ' .stktv-strip .al', 'class')).includes('right'), L + 'strip follows alignment');
      await p.click(POP + ' [data-t=full]'); await p.waitForTimeout(250);
      check((await p.evaluate(() => window.__stkTradeView.get().full)) === false, L + 'Full-width lines toggle');
      await p.click(POP + ' [data-t=full]');
      // P&L units
      const units = {};
      for (const u of ['usd', 'ticks', 'points', 'pct']) { await p.click(POP + ' [data-seg=unit][data-v=' + u + ']'); await p.waitForTimeout(300); units[u] = (await pos()).b; }
      check(/^[+-]?\$/.test(units.usd) && /ticks$/.test(units.ticks) && /pts$/.test(units.points) && /%$/.test(units.pct), L + 'P&L units $ / ticks / points / %', units);
      await p.click(POP + ' [data-seg=unit][data-v=usd]');
      // style submenu
      await p.click(POP + ' [data-go=main]'); await p.click(POP + ' [data-go=style]'); await p.waitForTimeout(250);
      await p.screenshot({ path: OUT + '/style-' + w + '-' + tn + '.png' });
      await p.evaluate(() => { const i = document.querySelector('#stktv-pop [data-col=buy]'); i.value = '#ff00aa'; i.dispatchEvent(new Event('input', { bubbles: true })); });
      await p.waitForTimeout(250);
      check((await p.evaluate(() => window.__stkTradeView.get().col.buy)) === '#ff00aa' && (await p.evaluate(() => getComputedStyle(document.querySelector('.stkpt-chip[data-id=pos]')).getPropertyValue('--c'))).trim() === '#ff00aa', L + 'buy colour applies to the position chip');
      await p.click(POP + ' [data-seg="ls.ord"][data-v=dotted]'); await p.click(POP + ' [data-seg="lw.ord"][data-v="2"]');
      check(await p.evaluate(() => { const s = window.__stkTradeView.get(); return s.ls.ord === 'dotted' && s.lw.ord === 2; }), L + 'line style + width set');
      await p.click(POP + ' [data-go=main]'); await p.click(POP + ' [data-go=more]'); await p.waitForTimeout(250);
      await p.click(POP + ' [data-t=confirm]'); await p.click(POP + ' [data-t=sound]'); await p.click(POP + ' [data-t=exeSize]');
      check(await p.evaluate(() => { const s = window.__stkTradeView.get(); return s.confirm === true && s.sound === false && s.exeSize === true; }), L + 'More: confirm / sound / execution size toggles');
      // persists across reload
      const saved = await p.evaluate(() => localStorage.getItem('stryker_tradeview_ui'));
      check(/ff00aa/.test(saved || ''), L + 'saved to localStorage');
      await p.evaluate((s) => { window.__keep = s; }, saved);
      const p2 = await ctx.newPage(); p2.on('pageerror', (e) => errs.push(String(e.message || e)));
      await p2.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
      await p2.waitForFunction(() => window.__stkTradeView, null, { timeout: 60000 });
      const re = await p2.evaluate(() => window.__stkTradeView.get());
      check(re.col.buy === '#ff00aa' && re.ls.ord === 'dotted' && re.exeSize === true, L + 'settings persist across reload', re.col);
      await p2.close();
      // reset
      await p.click(POP + ' [data-go=main]'); await p.click(POP + ' [data-reset]'); await p.waitForTimeout(300);
      check(await p.evaluate(() => { const s = window.__stkTradeView.get(), d = JSON.stringify; return s.col.buy === '#2962ff' && s.ls.ord === 'dashed' && s.master && s.ord && s.align === 'right' && s.unit === 'usd'; }), L + 'Reset to defaults restores today\'s look');
      ids = await chipIds(p); check(ids.length === all.length, L + 'after reset the chart shows everything again', ids);
      await p.keyboard.press('Escape'); await p.waitForTimeout(200);
      check(await p.evaluate(() => document.querySelector('#stktv-pop').hidden), L + 'Esc closes');
      check(errs.length === 0, L + 'no console errors', errs);
      await ctx.close();
    }
    // phone: bottom sheet
    for (const w of [390]) {
      const { ctx, p, errs } = await open(b, w, 'night'), L = w + ': ';
      await p.evaluate(() => localStorage.removeItem('stryker_tradeview_ui'));
      await p.evaluate(() => window.__stkPaper.placeOrder({ symbol: 'hyperliquid:BTC', side: 'buy', type: 'market', qty: 1 }));
      await wait(p, () => Object.keys(window.__stkPaper.account.state.positions).length === 1);
      const bi = await p.evaluate(() => { const e = document.getElementById('stktv-btn'), r = e.getBoundingClientRect(); return { vis: r.width > 0, w: r.width, h: r.height, title: e.title }; });
      check(bi.vis && bi.title === 'Trade display', L + 'button visible on the phone bar', bi);
      await p.evaluate(() => window.__stkTradeView.open()); await p.waitForTimeout(600);
      const sh = await p.evaluate(() => { const d = document.getElementById('stktv-pop'), r = d.getBoundingClientRect(); return { sheet: d.classList.contains('sheet'), bottom: r.bottom, vh: innerHeight, w: r.width, hscroll: document.documentElement.scrollWidth > innerWidth, grab: !!d.querySelector('.stktv-grab'), top: r.top, rows: [...d.querySelectorAll('.stktv-body > .stktv-r')].map((x) => x.getBoundingClientRect().height) }; });
      check(sh.sheet && Math.abs(sh.bottom - sh.vh) <= 1 && Math.abs(sh.w - w) <= 1 && !sh.hscroll && sh.grab && sh.top >= 0, L + 'bottom sheet with grabber, no page overflow', sh);
      check(sh.rows.every((h) => h >= 44), L + 'rows are tap-size (>= 44)', sh.rows);
      await p.screenshot({ path: OUT + '/sheet-390-dark.png' });
      await p.click('#stktv-pop [data-go=labels]'); await p.waitForTimeout(300);
      await p.screenshot({ path: OUT + '/sheet-labels-390-dark.png' });
      const ov = await p.evaluate(() => { const d = document.getElementById('stktv-pop'); return d.scrollWidth > d.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth; });
      check(!ov, L + 'labels sheet: no horizontal overflow');
      await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
      check(await p.evaluate(() => document.getElementById('stktv-pop').hidden), L + 'Esc steps back then closes');
      check(errs.length === 0, L + 'no console errors', errs);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
