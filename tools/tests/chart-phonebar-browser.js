// Phone top bar + categorised ⋯ sheet (Owner bug 2026-11-23, Android Chrome 412: "MNQ M…" symbol over its name, the
// balance pill drawn on the trade icon, nine items crammed in one row). Phone browser only (the Android app hides this bar).
// Bar: left menu, symbol, interval; right Indicators, bell, ⋯. Every other item is a row of the ⋯ sheet under a heading.
// Sizes 360 / 390 / 412 / 430 portrait + 844x390 landscape, dark + light; admin with a live broker account (local mock,
// Sample data, nothing leaves 127.0.0.1), a member, signed out. Real touch (hasTouch + tap) for every sheet check.
//   node tools/tests/chart-speed-server.mjs 8271 &
//   CHART_BASE=http://127.0.0.1:8271 flock /tmp/stryker-chrome.lock node tools/tests/chart-phonebar-browser.js [shotsDir]
const fs = require('fs');
const { launch } = require('./lib.js');
const { speedInit } = require('./chart-phone-speed-init.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8271';
const OUT = process.argv[2];
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined || ok ? '' : ' ' + JSON.stringify(x).slice(0, 500))); };
const ACC = '123e4567-e89b-12d3-a456-426614174000', US = '0aaa1111-2222-3333-4444-555566667777';

// runs in the page: every visible top-bar control (not the ⋯ sheet)
function measureBar() {
  const bar = document.getElementById('stkc-bar'), pop = document.getElementById('stkc-more-pop');
  const vw = document.documentElement.clientWidth;
  const ctl = 'button, a, [role=button], .stkas, .mclock';
  const items = [...bar.querySelectorAll(ctl)].filter((e) => !(pop && pop.contains(e)) && !e.closest('.stkc-pop, .mclock-pop, .notif-panel, [hidden]')
    && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 0)
    .filter((e) => !e.parentElement.closest(ctl) || !bar.contains(e.parentElement.closest(ctl)));   // outermost controls only
  const R = items.map((e) => ({ e, r: e.getBoundingClientRect(), n: (e.id || (typeof e.className === 'string' ? e.className.split(' ').pop() : e.tagName)) }));
  const overlaps = [];
  for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
    const a = R[i], b = R[j];
    const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (w > 0.5 && h > 0.5) overlaps.push(a.n + ' x ' + b.n);
  }
  const cy = R.map((o) => o.r.top + o.r.height / 2);
  const clipped = R.filter((o) => o.e.scrollWidth > o.e.clientWidth + 1 && /\S/.test(o.e.textContent)).map((o) => o.n + ':' + o.e.textContent.trim());
  const sym = bar.querySelector('.vela-mb-symbol');
  return {
    order: R.slice().sort((a, b) => a.r.left - b.r.left).map((o) => o.n),
    overlaps, clipped,
    spill: R.filter((o) => o.r.left < -0.5 || o.r.right > vw + 0.5).map((o) => o.n),
    spread: Math.round((Math.max(...cy) - Math.min(...cy)) * 10) / 10,
    small: R.filter((o) => o.r.height < 43.5 || o.r.width < 43.5).map((o) => o.n + ' ' + Math.round(o.r.width) + 'x' + Math.round(o.r.height)),
    icons: R.filter((o) => o.r.left > vw / 2 && !o.e.matches('.vela-mb-symbol, .vela-mb-tf')).map((o) => o.n),
    // icon centred in its button (max 1 px)
    iconOff: R.map((o) => { const s = o.e.querySelector('svg'); if (!s || /\S/.test(o.e.textContent.replace(/\d+/g, ''))) return 0; const r = s.getBoundingClientRect(); return Math.max(Math.abs((r.left + r.width / 2) - (o.r.left + o.r.width / 2)), Math.abs((r.top + r.height / 2) - (o.r.top + o.r.height / 2))); }).reduce((m, v) => Math.max(m, v), 0),
    sym: sym ? { t: sym.textContent.trim(), dot: sym.getAttribute('data-dd'), label: sym.getAttribute('aria-label') } : null,
    hscroll: document.documentElement.scrollWidth > vw + 1,
    strict: !!(window.__stkOneBar && window.__stkOneBar.strict)
  };
}
// a translucent full-page cover left on screen (the "chart greyed out" check)
function stuckCover() {
  const vw = innerWidth, vh = innerHeight, out = [];
  for (const e of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(e);
    if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) continue;
    const m = /rgba?\(\d+, \d+, \d+(?:, ([\d.]+))?\)/.exec(cs.backgroundColor); const a = m ? (m[1] === undefined ? 1 : +m[1]) : 0;
    if (a < 0.05 || a > 0.95) continue;
    const r = e.getBoundingClientRect();
    if (r.width * r.height < vw * vh * 0.4) continue;
    out.push((e.id || e.className || e.tagName).toString().slice(0, 40));
  }
  return out;
}
function sheetInfo() {
  const pop = document.getElementById('stkc-more-pop');
  const open = !!pop && !pop.hidden && pop.getClientRects().length > 0 && !pop.classList.contains('stkc-ob-sub');
  const heads = [...pop.querySelectorAll(':scope > .stkc-ob-gh')].filter((h) => !h.hidden).map((h) => h.textContent);
  const rows = [...pop.querySelectorAll('[data-ob-trig]')].filter((t) => t.getClientRects().length).map((t) => {
    const r = t.getBoundingClientRect(), st = t.querySelector('.stkc-ob-st'), cs = getComputedStyle(t, '::after');
    return { label: t.getAttribute('data-ob-label'), state: st ? st.textContent : '', h: Math.round(r.height), pl: parseFloat(getComputedStyle(t).paddingLeft), pr: parseFloat(getComputedStyle(t).paddingRight),
      g: t.closest('[data-ob-row]') ? t.closest('[data-ob-row]').getAttribute('data-ob-row') : '' };
  });
  return { open, heads, rows };
}

async function liveMock(ctx) {
  const iso = (ms) => new Date(ms).toISOString();
  const j = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  await ctx.route('**/connect/finatic/**', async (r) => {
    const u = new URL(r.request().url()); let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    if (u.pathname.endsWith('/session')) return r.fulfill(j({ configured: true }));
    if (u.pathname.endsWith('/data')) {
      if (body.op === 'accounts') return r.fulfill(j({ userId: US, data: [{ accountId: ACC, accountName: 'DEMO 5551234', accountNumber: 'DEMO5551234', brokerName: 'tradovate', currency: 'USD' }] }));
      if (body.op === 'live') return r.fulfill(j({ data: { positions: [], orders: [] } }));
      // Sample data
      if (body.op === 'balances') return r.fulfill(j({ data: [{ balanceId: 'b1', balanceType: 'ACCOUNT', currencyCode: 'USD', cashBalance: '503312.40', netLiquidationValue: '503312.40', totalRealizedPnl: '0', balanceCreatedAt: iso(Date.now() - 60e3), lastUpdated: iso(Date.now() - 60e3) }] }));
      return r.fulfill(j({ data: [] }));
    }
    if (u.pathname.endsWith('/order') && body.op === 'env') return r.fulfill(j({ env: 'live', enabled: true }));
    return r.fulfill(j({ error: 'Not allowed in this test' }));
  });
}

async function open(b, { w, h, theme, who }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36' });
  await speedInit(ctx);
  await ctx.addInitScript(({ t, who, US }) => {
    try {
      localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night');
      Object.defineProperty(window, 'showToast', { configurable: true, get: () => () => Promise.resolve(), set: () => {} });
      if (who === 'admin') {
        window.__stkLiveTest = { isAdmin: () => true, fastRetry: true, last: () => 26710.5 };
        localStorage.setItem('stryker_broker_sync_user_u1', US);
        const st = { v: 1, currency: 'USD', startBalance: 100000, balance: 100000, realized: 0, fees: 0, createdAt: 1, resetAt: 1, savedAt: 1, settings: { enabled: true }, positions: {}, orders: [], history: [], trades: [], nextId: 2 };
        localStorage.setItem('stryker_paper_u1', JSON.stringify(st));   // Sample data
      }
      if (who === 'out') { const a = window.__stubAuth; a.currentUser = null; a.onAuthStateChanged = (cb) => { setTimeout(() => cb(null), 10); return () => {}; }; a.onIdTokenChanged = (cb) => { setTimeout(() => cb(null), 30); return () => {}; }; }
    } catch (e) {}
  }, { t: theme, who, US });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  if (who === 'admin') await liveMock(ctx);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('  pageerror', String(e).slice(0, 160)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#stkc-bar .vela-mb-symbol', { timeout: 60000 });
  await p.evaluate(() => window.STRYKER_VELA.active.setSymbol('futures:MNQ1!'));
  await sleep(6000);
  if (who === 'admin') {
    const ok = await p.waitForFunction(() => window.__stkLive && window.__stkLive.pick && window.__stkLive.state.accounts.length, null, { timeout: 15000 }).then(() => true, () => false);
    if (ok) { await p.evaluate((id) => window.__stkLive.pick(id), ACC); await sleep(2500); }
    console.log('  admin live account picked:', ok);
  }
  await p.evaluate((t) => { if (window.setStrykerTheme) window.setStrykerTheme(t === 'light' ? 'day' : 'night', { silent: true }); }, theme);
  await sleep(500);
  return { ctx, p };
}

async function barChecks(p, tag, w) {
  const m = await p.evaluate(measureBar);
  check(m.strict, tag + ': phone bar mode on');
  check(m.overlaps.length === 0, tag + ': no top-bar items overlap', m.overlaps);
  check(m.clipped.length === 0, tag + ': no text clipped', m.clipped);
  check(m.spill.length === 0 && !m.hscroll, tag + ': nothing off-screen, no horizontal scroll', m);
  check(m.spread <= 1, tag + ': one centre line (max 1 px)', m.spread);
  check(m.small.length === 0, tag + ': every target >= 44 x 44', m.small);
  check(m.iconOff <= 1, tag + ': icons centred in their buttons (max 1 px)', m.iconOff);
  const want = ['stkcps-menu', 'vela-mb-symbol', 'vela-mb-tf', 'vela-mb-indicators'];
  check(want.every((k, i) => m.order[i] === k) && m.order.includes('notif-bell-btn') && m.order.at(-1) === 'stkc-more-btn' && m.order.length <= 7,
    tag + ': order = menu, symbol, interval | Indicators, bell, More', m.order);
  check(m.icons.length <= 3, tag + ': at most 3 icons on the right', m.icons);
  check(m.sym && /^[A-Z0-9!]+$/.test(m.sym.t), tag + ': symbol chip = ticker only', m.sym);
  console.log('  info ' + tag + ' ' + JSON.stringify({ order: m.order, sym: m.sym, spread: m.spread }));
  return m;
}

const tapEl = async (p, sel) => { const r = await p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel); if (!r) return false; await p.touchscreen.tap(r.x, r.y); return true; };
const openSheet = async (p) => { await tapEl(p, '#stkc-more-btn'); await sleep(450); return p.evaluate(sheetInfo); };
// close whatever a row opened: Escape, a visible close button, then a tap on the chart
async function closeAll(p) {
  for (let i = 0; i < 2; i++) { await p.keyboard.press('Escape'); await sleep(150); }
  await p.evaluate(() => {
    const vis = (e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
    for (const b of document.querySelectorAll('.stkc-sh-x, .stkms-x, .stklat-x, [aria-label="Close"], [aria-label="Close panel"], .vela-dialog-close')) if (vis(b)) { b.click(); }
    for (const s of document.querySelectorAll('.stkc-scrim:not([hidden]), .stkms-scrim:not([hidden]), .stkw-scrim:not([hidden]), .vela-dialog-backdrop')) if (vis(s)) s.click();
  });
  await sleep(350);
  if (await p.evaluate(() => document.documentElement.classList.contains('stk-chart-fs'))) { await p.evaluate(() => document.getElementById('stkc-fs-btn') && document.getElementById('stkc-fs-btn').click()); await sleep(300); }
}
// surfaces (sheets, panels, dialogs) visible right now, marked so a new one is recognised
const surfaces = () => {
  const out = [];
  for (const e of document.querySelectorAll('body *')) {
    if (e.closest('#stkc-more-pop > .stkc-ob-gh, #stkc-bar') && !e.closest('.stkc-pop, .mclock-pop, .stkas-pop')) continue;
    const cs = getComputedStyle(e);
    if (!/fixed|absolute/.test(cs.position) || cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = e.getBoundingClientRect(); if (r.width < 150 || r.height < 120) continue;
    if (!e.__sf) e.__sf = Math.random().toString(36).slice(2);
    out.push(e.__sf);
  }
  return out;
};
const state = () => ({ cls: document.documentElement.className, theme: document.documentElement.getAttribute('data-theme'), hp: (document.getElementById('stkc-hideprice-btn') || { getAttribute: () => '' }).getAttribute('aria-pressed'),
  max: !!document.querySelector('.vela-mb-maximize.vela-mb-on'), url: location.href });

async function rowChecks(p, tag, w, h) {
  let s = await openSheet(p);
  check(s.open, tag + ': ⋯ opens the sheet (tap)');
  const order = ['Chart', 'Indicators & scripts', 'Trading', 'View', 'Panels', 'Share & alerts'];
  check(s.heads.length >= 4 && s.heads.every((x, i) => i === 0 || order.indexOf(x) > order.indexOf(s.heads[i - 1])), tag + ': section headings in order', s.heads);
  check(s.rows.every((r) => r.h === 56 && r.pl === 16 && r.pr === 16), tag + ': rows 56 px, 16 px gutters', s.rows.filter((r) => r.h !== 56 || r.pl !== 16));
  console.log('  sheet ' + tag + ' ' + JSON.stringify(s.heads) + ' ' + s.rows.map((r) => r.g + ':' + r.label + (r.state ? ' [' + r.state + ']' : '')).join(' | '));
  if (OUT) await p.screenshot({ path: OUT + '/' + tag + '-sheet.png' });
  // sheet scrolled to the end too
  if (OUT) { await p.evaluate(() => { const m = document.getElementById('stkc-more-pop'); m.scrollTop = m.scrollHeight; }); await sleep(200); await p.screenshot({ path: OUT + '/' + tag + '-sheet-end.png' }); await p.evaluate(() => { document.getElementById('stkc-more-pop').scrollTop = 0; }); }
  // a tap on a heading and on the grabber area keeps it open
  const hd = await p.evaluate(() => { const g = [...document.querySelectorAll('#stkc-more-pop > .stkc-ob-gh')].find((x) => !x.hidden); const r = g.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await p.touchscreen.tap(hd.x, hd.y); await sleep(250);
  const gb = await p.evaluate(() => { const r = document.getElementById('stkc-more-pop').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 10 }; });
  await p.touchscreen.tap(gb.x, gb.y); await sleep(250);
  check((await p.evaluate(sheetInfo)).open, tag + ': tapping inside the sheet (heading, grabber) keeps it open');
  await p.touchscreen.tap(w / 2, 70); await sleep(400);
  check(!(await p.evaluate(sheetInfo)).open, tag + ': tapping outside closes it');
  check((await p.evaluate(stuckCover)).length === 0, tag + ': no dim layer left after closing', await p.evaluate(stuckCover));

  // every row opens its tool
  const labels = s.rows.map((r) => r.label);
  const bad = [];
  for (const label of labels) {
    await closeAll(p);
    s = await openSheet(p);
    if (!s.open) { bad.push(label + ': sheet did not open'); continue; }
    const before = await p.evaluate(surfaces), st0 = await p.evaluate(state);
    const pos = await p.evaluate((l) => { const t = [...document.querySelectorAll('#stkc-more-pop [data-ob-trig]')].find((x) => x.getAttribute('data-ob-label') === l); if (!t) return null; t.scrollIntoView({ block: 'center' }); const r = t.getBoundingClientRect(); return { x: r.left + 60, y: r.top + r.height / 2 }; }, label);
    if (!pos) { bad.push(label + ': row gone'); continue; }
    await sleep(150);
    await p.touchscreen.tap(pos.x, pos.y); await sleep(1100);
    const after = await p.evaluate(surfaces), st1 = await p.evaluate(state);
    const opened = after.some((x) => !before.includes(x)) || JSON.stringify(st0) !== JSON.stringify(st1);
    if (!opened) bad.push(label);
    if (OUT && /Account|Market data|Trade$/.test(label)) await p.screenshot({ path: OUT + '/' + tag + '-row-' + label.replace(/\W+/g, '') + '.png' });
    // toggles back
    if (/^Theme$/.test(label)) { await p.evaluate(() => window.toggleStrykerTheme && window.toggleStrykerTheme()); await sleep(300); }
    if (/^Price candles$/.test(label)) { await p.evaluate(() => { const b = document.getElementById('stkc-hideprice-btn'); if (b && b.getAttribute('aria-pressed') === 'true') b.click(); }); }
    if (/Maximize/.test(label)) { await p.evaluate(() => { const b = document.querySelector('.vela-mb-maximize.vela-mb-on'); if (b) b.click(); }); }
  }
  check(bad.length === 0, tag + ': every ⋯ row opens its tool (' + labels.length + ' rows)', bad);
  await closeAll(p); await p.touchscreen.tap(w / 2, h / 2); await sleep(500);
  check((await p.evaluate(stuckCover)).length === 0, tag + ': no dim layer stuck on the chart after all rows', await p.evaluate(stuckCover));
  const m = await p.evaluate(measureBar);
  check(m.overlaps.length === 0 && m.spread <= 1, tag + ': bar still clean after all rows', m.overlaps);
}

(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=600'] });
  const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
  const runs = [];
  for (const [w, h] of [[360, 780], [390, 844], [412, 915], [430, 932], [844, 390]]) for (const theme of ['dark', 'light']) runs.push({ w, h, theme, who: 'admin', rows: (w === 412 && theme === 'dark') || (w === 844 && theme === 'light') });
  for (const [w, h] of [[360, 780], [390, 844], [844, 390]]) runs.push({ w, h, theme: 'dark', who: 'member', rows: w === 390 });
  for (const [w, h] of [[360, 780], [412, 915]]) runs.push({ w, h, theme: w === 360 ? 'light' : 'dark', who: 'out', rows: w === 360 });
  for (const r of runs) {
    const tag = r.who + '-' + r.w + 'x' + r.h + '-' + r.theme;
    if (only && !only.test(tag)) continue;
    const { ctx, p } = await open(b, r);
    try {
      await barChecks(p, tag, r.w);
      if (OUT) await p.screenshot({ path: OUT + '/' + tag + '-bar.png', clip: { x: 0, y: 0, width: r.w, height: Math.min(r.h, 160) } });
      if (OUT && (r.w === 412 || r.w === 844)) await p.screenshot({ path: OUT + '/' + tag + '-full.png' });
      // the symbol chip opens symbol search, the interval chip its menu (real taps)
      if (r.rows) {
        const s0 = await p.evaluate(surfaces); await tapEl(p, '#stkc-bar .vela-mb-symbol'); await sleep(900);
        check((await p.evaluate(surfaces)).some((x) => !s0.includes(x)), tag + ': tap symbol chip = symbol search');
        await closeAll(p);
        const s1 = await p.evaluate(surfaces); await tapEl(p, '#stkc-bar .vela-mb-tf'); await sleep(700);
        check((await p.evaluate(surfaces)).some((x) => !s1.includes(x)), tag + ': tap interval chip = interval menu');
        await closeAll(p);
        await rowChecks(p, tag, r.w, r.h);
      }
    } catch (e) { fail++; console.log('FAIL ' + tag + ' threw ' + String(e).slice(0, 300)); }
    await ctx.close();
  }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
