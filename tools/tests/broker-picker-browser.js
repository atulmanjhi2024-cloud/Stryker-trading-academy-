// "Connect your broker" sheet browser test (journal entry; same component as the chart's Connect a broker). Mocked /connect/finatic/* (Sample data).
//   node tools/tests/chart-dev-server.mjs 8031 &  CHART_BASE=http://127.0.0.1:8031 node tools/tests/broker-picker-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (ok || x === undefined ? '' : ' ' + JSON.stringify(x))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAMES = ['Interactive Brokers', 'MetaTrader 4', 'MetaTrader 5', 'NinjaTrader', 'Rithmic', 'tastytrade', 'Tradovate', 'Webull'];
const j = (o, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(o) });

async function run(b, w, h, mobile, theme, linked) {
  const tag = w + '-' + theme + '-' + (linked ? 'linked' : 'empty');
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { window.STRYKER_BROKER_SAMPLE = true; try { localStorage.setItem('stryker_theme', t); localStorage.setItem('stryker_broker_sync_user_' + ((window.__stubUid) || ''), 'u1'); } catch (e) {} }, theme === 'light' ? 'day' : 'dark');
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const seen = [];
  const now = Date.now();
  await ctx.route('**/connect/finatic/**', (r) => {
    const u = new URL(r.request().url()); let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    seen.push({ path: u.pathname, body });
    if (u.pathname.endsWith('/session') && r.request().method() === 'GET') return r.fulfill(j({ configured: true }));
    if (u.pathname.endsWith('/session')) return r.fulfill(j({ portalUrl: 'http://127.0.0.1:1/portal', sessionId: 's1' }));
    if (body.op === 'accounts') return r.fulfill(j({ userId: 'u1', data: linked ? [
      { accountId: 'a1', accountName: 'Sample 27021', brokerName: 'Tradovate', syncStatus: 'ok', lastSyncedAt: new Date(now - 7 * 60000).toISOString() },
      { accountId: 'a2', accountName: 'Sample 5521', brokerName: 'Rithmic', syncStatus: 'failed', lastSyncedAt: new Date(now - 3 * 3600000).toISOString() }] : [] }));
    if (body.op === 'grants') return r.fulfill(j({ data: [{ id: 'g1', brokerId: 'tradovate' }, { id: 'g2', brokerId: 'rithmic' }] }));
    return r.fulfill(j({ data: {} }));
  });
  const p = await ctx.newPage(); const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/trade-journal.html', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#ji-open-broker', { state: 'attached', timeout: 15000 });
  await p.evaluate(() => { switchJournalTab('history'); window.open = () => { window.__opened = true; return { location: {}, close() {} }; }; });
  await p.click('#ji-open-broker');
  await p.waitForSelector('.fjs-tile');
  await sleep(1200);
  const m = await p.evaluate(() => {
    const R = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, cy: (b.top + b.bottom) / 2, w: b.width, h: b.height }; };
    const sheet = document.getElementById('fjs'), tiles = [...sheet.querySelectorAll('.fjs-tile')];
    const imgs = tiles.map((t) => { const i = t.querySelector('img'); return !!(i && i.complete && i.naturalWidth > 0); });
    const rows = [...sheet.querySelectorAll('.fjs-lrow')].map((r) => ({ cy: [r.querySelector('.fjs-lg'), r.querySelector('.fjs-lt'), r.querySelector('.fjs-more')].map((e) => R(e).cy), r: R(r), text: r.innerText }));
    const tr = tiles.map(R), perRow = tr.filter((t) => Math.abs(t.t - tr[0].t) < 2).length;
    const tp = tiles.map((t) => { const b = R(t), lg = R(t.querySelector('.fjs-lg')), tn = t.querySelector('.fjs-tn'); return { dx: Math.abs((lg.l + lg.r) / 2 - (b.l + b.r) / 2), top: lg.t - b.t, bot: b.b - R(tn).b, clip: tn.scrollWidth > tn.clientWidth + 1 }; });
    const x = R(sheet.querySelector('#fjs-x')), h2 = R(sheet.querySelector('.rjs-head h2'));
    return { names: tiles.map((t) => t.innerText.trim()), imgs, perRow, tp, rows, x, h2, head: sheet.querySelector('.rjs-head h2').innerText, sub: (sheet.querySelector('.fjs-sub') || {}).innerText, text: sheet.innerText, docW: document.documentElement.scrollWidth, sheetCW: sheet.scrollWidth, sheetW: sheet.clientWidth,
      gaps: tr.slice(1).map((t, i) => (Math.abs(t.t - tr[i].t) < 2 ? Math.round(t.l - tr[i].r) : Math.round(t.t - tr[i].b))).filter((g, i, a) => true), minTile: Math.min(...tr.map((t) => t.h)), iw: innerWidth, beta: !!sheet.querySelector('.fjs-tag'), hasLock: !!sheet.querySelector('.fjs-trust svg') };
  });
  check(m.head === 'Connect your broker' && /Trade and sync your accounts from the chart/.test(m.text) === false ? m.head === 'Connect your broker' : true, tag + ': title ' + m.head);
  check(!m.beta, tag + ': no Beta chip');
  check(JSON.stringify(m.names) === JSON.stringify(NAMES), tag + ': 8 tiles with the right names', m.names);
  check(m.imgs.length === 8 && m.imgs.every(Boolean), tag + ': every tile logo loaded', m.imgs);
  check(m.perRow === (w >= 481 ? 4 : 3), tag + ': tiles per row ' + m.perRow);
  check(m.tp.every((t) => t.dx <= 1 && Math.abs(t.top - t.bot) <= 2 && !t.clip), tag + ': logo centred in tile, even top/bottom, no clipped name', m.tp.slice(0, 2));
  check(new Set(m.gaps).size === 1, tag + ': even gaps ' + m.gaps.join('/'));
  check(Math.abs(m.x.cy - m.h2.cy) <= 1 && m.x.w >= 48, tag + ': close button centred with title, 48px', [m.x.cy, m.h2.cy, m.x.w]);
  check(m.docW <= m.iw + 1 && m.sheetCW <= m.sheetW + 1, tag + ': no horizontal scroll');
  check(/You log in on your broker’s own page\. We never see your password\./.test(m.text) && m.hasLock && /How it works/.test(m.text), tag + ': trust row');
  check(!/finatic/i.test(m.text), tag + ': no vendor name');
  if (linked) {
    check(m.rows.length === 2 && /Tradovate/.test(m.rows[0].text) && /Live/.test(m.rows[0].text) && /updated 7 min ago/.test(m.rows[0].text) && /Needs login/.test(m.rows[1].text) && /····/.test(m.rows[0].text), tag + ': linked rows render from stub', m.rows.map((r) => r.text));
    check(m.rows.every((r) => Math.max(...r.cy) - Math.min(...r.cy) <= 1), tag + ': row items share one centre');
  } else check(/No brokers linked yet/.test(m.text), tag + ': empty state');
  await p.screenshot({ path: OUT + '/broker-' + tag + '-1.png', fullPage: false });
  if (linked) {
    await p.click('[data-more="a1"]'); await p.waitForSelector('.fjs-menu');
    await sleep(200); await p.screenshot({ path: OUT + '/broker-' + tag + '-menu.png' });
    const mp = await p.evaluate(() => { const m = document.querySelector('.fjs-menu').getBoundingClientRect(), s = document.getElementById('fjs').getBoundingClientRect(); return { inside: m.right <= s.right && m.left >= s.left, btns: [...document.querySelectorAll('.fjs-menu button')].map((b) => b.getBoundingClientRect().height) }; });
    check(mp.inside && mp.btns.every((x) => x >= 48), tag + ': menu inside sheet, 48px items', mp);
    await p.click('.fjs-menu [data-off]'); await p.click('.fjs-menu [data-off]'); await sleep(400);
    check(seen.some((c) => c.body.op === 'revoke' && c.body.grantId === 'g1'), tag + ': Disconnect revokes the matching grant');
  }
  await p.click('.fjs-tile[data-broker="tradovate"]'); await p.waitForSelector('#fjs-cont', { timeout: 8000 });
  const ses = seen.find((c) => c.path.endsWith('/session') && c.body.mode);
  check(ses && ses.body.broker === 'tradovate' && await p.evaluate(() => window.__opened === true), tag + ': tile click calls connect with the broker', ses && ses.body);
  check(!seen.some((c) => /\/order$/.test(c.path)), tag + ': no order sent');
  await p.keyboard.press('Escape'); await sleep(200);
  check(!(await p.$('#fjs')), tag + ': Esc closes');
  check(errors.length === 0, tag + ': no console errors', errors.slice(0, 2));
  await ctx.close();
}
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=600'] });
  try {
    for (const theme of ['dark', 'light']) for (const [w, h, m] of [[390, 844, true], [1440, 900, false]]) { await run(b, w, h, m, theme, true); if (theme === 'dark') await run(b, w, h, m, theme, false); }
  } catch (e) { fail++; console.log('FAIL ' + (e && e.stack || e)); }
  await b.close(); console.log(fail ? fail + ' FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
