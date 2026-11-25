// TRADE PANEL (Owner 25 Nov): clean order ticket + floating Scalp card on the chart (replaces the old one-click SELL | qty | BUY box).
// Paper account (member, Sample data NQ 1m bars around 28,750) + a mocked cTrader socket for the Join Bid limit (tools/tests/ctrader-mock.mjs).
// Every other host is aborted. No real order can be sent.
//   node tools/tests/chart-dev-server.mjs 8031 &   CHART_BASE=http://127.0.0.1:8031 node tools/tests/tradepanel-browser.js <shotsDir>
// Checks: Trade -> Paper opens the ORDER panel (Order tab, Scalp card off); every section renders (account chip, symbol, Sell/Buy tiles,
// Market | Limit | Stop | Stop limit, Size + chips, Stop loss / Take profit, summary rows, one primary button, Balance / Equity);
// chips set the size; SL / TP toggles reveal fields; the button is disabled until the ticket is valid; the old .stkpt-1c box is gone;
// Scalp toggle -> card inside the chart plot (never over the price scale) at 1440 / 1024 / 390; drag persists; Join Bid = paper limit at
// the bid; cTrader Join Bid = one 2106 LIMIT at the bid (mock). Alignment gate: tiles one centre, chips even, no horizontal scroll at 390.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp/tradepanel';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 700) : '')); };
const opWait = (p, fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms || 10000 }).then(() => true, () => false);
const US = '0aaa1111-2222-3333-4444-555566667777';

async function open(b, { w, h, mobile, theme, ct }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(({ t, ct, US }) => {
    window.__stkLiveTest = ct ? { isAdmin: () => true, isBeta: () => false, last: () => 100, fastRetry: true,
      ctCreds: { access: 'ACCESSTOKENsample1', refresh: 'REFRESHsample1', exp: Date.now() + 30 * 864e5, accountId: 77, isLive: false, login: 5551234, kind: 'trade' },
      ctDeps: { idToken: async () => 'IDT', save: async () => {} } } : { isAdmin: () => false, last: () => 28750 };
    window.__stkOpTest = ct ? undefined : { q: { bid: 28749.75, ask: 28750 }, quote() { return this.q; } };   // Sample data bid / ask (paper)
    window.__toasts = []; const keep = () => (t, m) => { window.__toasts.push(String(m)); return Promise.resolve(); };
    Object.defineProperty(window, 'showToast', { configurable: true, get: () => keep(), set: () => {} });
    try {
      localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1');
      localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night');
      if (ct) localStorage.setItem('stryker_broker_sync_user_u1', US);
    } catch (e) {}
  }, { t: theme, ct: !!ct, US });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route('**/api/chart/bars/**', (r) => {
    const u = new URL(r.request().url()), tf = Number(u.searchParams.get('tf') || 1), P = 8 * 3600, now = Math.floor(Date.now() / 1000);
    const page = u.searchParams.has('page') ? Number(u.searchParams.get('page')) : Math.floor(now / P);
    if (!/NQ/.test(u.pathname) || tf !== 1 || page < Math.floor(now / P) - 12) return r.fulfill({ json: { bars: [] } });
    const bars = []; for (let t = page * P; t < (page + 1) * P && t <= now; t += 60) { const c = Math.round((28750 + 6 * Math.sin(t / 540)) * 4) / 4; bars.push([t, c - 0.5, c + 1, c - 1, c, 100]); }
    return r.fulfill({ json: { s: 'NQ', tf: '1', page, bars, rt: true } });
  });
  await ctx.route('**/connect/ctrader/token*', (r) => r.fulfill({ json: { configured: true, client_id: 'CID_sample1' } }));
  const j = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  await ctx.route('**/connect/finatic/**', async (r) => {
    const u = new URL(r.request().url()); let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    if (u.searchParams.get('probe')) return r.fulfill(j({ configured: true }));
    if (u.pathname.endsWith('/data')) return r.fulfill(j(body.op === 'accounts' ? { userId: US, data: [] } : { data: [] }));
    return r.fulfill(j({ data: {} }));
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|Failed to load resource|Ping received|Unexpected response code|WebSocket/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('dialog', (d) => d.dismiss());
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  if (ct) await p.evaluate(async () => { (await import('/functions/connect/ctrader/_relay.js')).LIMITS.historyPerSec = 100; const m = await import('/tools/tests/ctrader-mock.mjs'); const M = m.mockState({ extra: [{ symbolId: 13, symbolName: 'NAS100', digits: 2, pipPosition: 1, desc: 'Nasdaq 100 Index' }], barBase: [10005000, 20000, 0] }); window.__ctM = M; window.__stkLiveTest.ctDeps.WS = m.makeWS(M); });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkPaper, null, { timeout: 60000 });
  return { ctx, p, errors };
}
const setSym = (p, s) => p.evaluate(async (s) => { const ws = window.STRYKER_VELA; ws.active.setSymbol(s); ws.active.setTimeframe('1'); for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.orchestrator.rawBars.length > 50) break; } return ws.chart.market.symbol; }, s);

// geometry of the order panel's main rows
const panelGeo = (p) => p.evaluate(() => {
  const q = (s) => document.querySelector('#stkop ' + s), R = (e) => e && e.getBoundingClientRect(), vis = (e) => !!e && !e.hidden && e.offsetWidth > 0;
  const tiles = ['sell', 'buy'].map((k) => R(q('.stkop-tile.' + k)));
  const chips = [...document.querySelectorAll('#stkop [data-k=chips] button')].map(R);
  const chipPad = [...document.querySelectorAll('#stkop [data-k=chips] button')].map((b) => { const r = R(b), g = document.createRange(); g.selectNodeContents(b); const t = g.getBoundingClientRect(); return Math.abs((t.left - r.left) - (r.right - t.right)); });
  return {
    sections: { acct: vis(q('[data-k=acct]')), root: (q('[data-k=root]') || {}).textContent, tiles: tiles.every(Boolean), otabs: [...document.querySelectorAll('#stkop .stkop-otabs button')].map((b) => b.textContent),
      size: vis(q('[data-f=qty]')), chips: chips.length, legs: [...document.querySelectorAll('#stkop .stkop-legs .stkop-chk')].map((l) => l.textContent.trim()),
      rows: [...document.querySelectorAll('#stkop .stkop-rows > div')].filter((d) => !d.hidden).map((d) => d.querySelector('dt').textContent),
      go: (q('[data-k=confirm]') || {}).textContent, acr: [...document.querySelectorAll('#stkop .stkop-acr > div')].filter((d) => !d.hidden).map((d) => d.querySelector('dt').textContent) },
    tileDc: tiles[0] && tiles[1] ? Math.abs((tiles[0].top + tiles[0].height / 2) - (tiles[1].top + tiles[1].height / 2)) : 99,
    chipDc: chips.length ? Math.max(...chips.map((c) => c.top + c.height / 2)) - Math.min(...chips.map((c) => c.top + c.height / 2)) : 0,
    chipGaps: chips.slice(1).map((c, i) => Math.round((c.left - chips[i].right) * 10) / 10), chipPad: Math.max(0, ...chipPad),
    num: getComputedStyle(q('.stkop-tpx')).fontVariantNumeric, hs: document.documentElement.scrollWidth - innerWidth,
    panel: R(document.getElementById('stkop')), vw: innerWidth, vh: innerHeight,
    oneClick: !!document.querySelector('.stkpt-1c'), scalp: !!(window.__stkOrderPanel && window.__stkOrderPanel.scalpOn), tab: window.__stkOrderPanel.prefs.tab };
});
const scGeo = (p) => p.evaluate(() => {
  const s = document.getElementById('stkop-sc'); if (!s || s.hidden) return null;
  const A = window.__stkAxisTags, Rr = A.rendererOf(A.cellsOf()[0]), pr = Rr.plot.getBoundingClientRect(), W = Rr.coords.width, r = s.getBoundingClientRect();
  const row = [...s.querySelectorAll('.stkop-trio > *')].map((e) => { const b = e.getBoundingClientRect(); return b.top + b.height / 2; });
  return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, plotL: pr.left, plotT: pr.top, plotR: pr.left + W, plotB: pr.bottom, rowDc: row.length ? Math.max(...row) - Math.min(...row) : 0, vw: innerWidth,
    joins: [...s.querySelectorAll('.stkop-join')].map((b) => b.textContent), hs: document.documentElement.scrollWidth - innerWidth };
});

async function paper(b, w, h, mobile, theme) {
  const tag = w + '-' + theme;
  const { ctx, p, errors } = await open(b, { w, h, mobile, theme });
  await p.evaluate(() => window.__stkPaper.setEnabled(true));
  await setSym(p, 'futures:NQ1!'); await sleep(800);
  // Trade (the one Trade entry) -> Paper -> the ORDER panel by default
  if (!(await p.isVisible('#stkc-paper-btn'))) { await p.click('#stkc-more-btn'); await sleep(400); }
  await p.click('#stkc-paper-btn'); await p.waitForSelector('#stkc-trade-pop [data-a=paper]', { timeout: 8000 });
  await p.click('#stkc-trade-pop [data-a=paper]');
  check(await opWait(p, () => window.__stkOrderPanel && window.__stkOrderPanel.isOpen && document.querySelector('#stkop .stkop-order'), null, 10000), tag + ': Trade -> Paper opens the order panel');
  await sleep(600);
  let g = await panelGeo(p);
  check(g.tab === 'order' && !g.scalp, tag + ': the Order view is the default, the Scalp card stays off', g);
  check(!g.oneClick, tag + ': the old one-click SELL | qty | BUY box is gone', g);
  const s = g.sections;
  check(s.acct && /^M?NQ$/.test(s.root), tag + ': account chip + symbol shown', s);
  check(s.tiles && s.otabs.join('|') === 'Market|Limit|Stop|Stop limit' && s.size && s.chips === 4, tag + ': Sell / Buy tiles, Market | Limit | Stop | Stop limit, size + 4 chips', s);
  check(s.legs.join('|') === 'Stop loss|Take profit' && s.rows.includes('Order value') && s.acr.includes('Balance') && s.acr.includes('Equity'), tag + ': SL / TP checkboxes, Order value, Balance + Equity', s);
  check(!s.rows.includes('Margin required'), tag + ': no Margin required row without a broker figure (never guessed)', s);
  check(/^Buy \d/.test(s.go), tag + ': one primary button "Buy <size> <symbol>"', s.go);
  check(g.tileDc <= 1 && g.chipDc <= 1 && g.chipPad <= 1 && g.chipGaps.every((x) => Math.abs(x - g.chipGaps[0]) <= 1) && /tabular-nums/.test(g.num), tag + ': tiles one centre, chips one row, even gaps + padding, tabular digits', g);
  check(g.hs <= 0 && g.panel.right <= g.vw + 0.5 && g.panel.left >= -0.5, tag + ': panel inside the screen, no horizontal scroll', g);
  await p.screenshot({ path: OUT + '/panel-' + tag + '.png' });
  // chips set the size
  const chip = await p.evaluate(() => { const b = document.querySelectorAll('#stkop [data-k=chips] button')[2]; b.click(); return b.dataset.chip; });
  await sleep(350);
  const q = await p.evaluate(() => ({ v: document.querySelector('#stkop [data-f=qty]').value, on: document.querySelector('#stkop [data-k=chips] button.on') && document.querySelector('#stkop [data-k=chips] button.on').dataset.chip, go: document.querySelector('#stkop [data-k=confirm]').textContent }));
  check(Number(q.v) === Number(chip) && q.on === chip && q.go.includes(' ' + Number(chip) + ' '), tag + ': a chip sets the size (field, chip state, button text)', { chip, q });
  // SL / TP toggles reveal their fields; invalid ticket -> disabled button
  await p.evaluate(() => document.querySelector('#stkop [data-f="sl.on"]').click()); await sleep(300);
  let lg = await p.evaluate(() => ({ sl: !document.querySelector('#stkop [data-leg=sl]').hidden, tp: !document.querySelector('#stkop [data-leg=tp]').hidden, unit: !document.querySelector('#stkop .stkop-luw').hidden }));
  check(lg.sl && !lg.tp && lg.unit, tag + ': Stop loss on -> its field + Price | Ticks | % switch show, Take profit stays hidden', lg);
  await p.fill('#stkop [data-leg=sl] [data-leg-in]', ''); await sleep(350);
  check(await p.evaluate(() => document.querySelector('#stkop [data-k=confirm]').disabled), tag + ': empty stop loss -> button disabled');
  await p.fill('#stkop [data-leg=sl] [data-leg-in]', '20'); await sleep(350);
  const ok1 = await p.evaluate(() => ({ dis: document.querySelector('#stkop [data-k=confirm]').disabled, proj: document.querySelector('#stkop [data-k=slproj]').textContent }));
  check(!ok1.dis && /@ /.test(ok1.proj), tag + ': 20 ticks -> valid, level + money shown', ok1);
  await p.evaluate(() => document.querySelector('#stkop [data-f="tp.on"]').click()); await sleep(300);
  lg = await p.evaluate(() => !document.querySelector('#stkop [data-leg=tp]').hidden);
  check(lg, tag + ': Take profit on -> its field shows');
  await p.evaluate(() => { document.querySelector('#stkop [data-f="sl.on"]').click(); document.querySelector('#stkop [data-f="tp.on"]').click(); }); await sleep(300);
  // limit without a price -> disabled
  await p.evaluate(() => document.querySelector('#stkop [data-type=limit]').click()); await sleep(300);
  await p.fill('#stkop [data-f=price]', ''); await p.evaluate(() => document.querySelector('#stkop [data-f=price]').blur()); await sleep(350);
  check(await p.evaluate(() => document.querySelector('#stkop [data-k=confirm]').disabled), tag + ': Limit without a price -> button disabled');
  await p.evaluate(() => document.querySelector('#stkop [data-type=market]').click()); await sleep(300);
  // Scalp toggle -> the card on the chart (inside the plot, never over the price scale)
  await p.evaluate(() => document.querySelector('#stkop [data-a=sc]').click());
  check(await opWait(p, () => { const s = document.getElementById('stkop-sc'); return s && !s.hidden && s.offsetWidth > 0; }, null, 5000), tag + ': Scalp toggle shows the card on the chart');
  await sleep(500);
  let sc = await scGeo(p);
  if (mobile) check(sc && sc.l >= 7 && sc.r <= sc.vw - 7 && sc.hs <= 0, tag + ': phone: card full width (8 px sides), no horizontal scroll', sc);
  else check(sc && sc.l >= sc.plotL && sc.r <= sc.plotR && sc.t >= sc.plotT && sc.b <= sc.plotB, tag + ': card inside the chart plot, not over the price scale', sc);
  check(sc && sc.rowDc <= 1 && sc.joins.length === 2 && /Join Bid/.test(sc.joins[0]) && /Join Ask/.test(sc.joins[1]), tag + ': Buy | size | Sell one centre line, Join Bid / Join Ask', sc);
  await p.evaluate(() => window.__stkOrderPanel.close()); await sleep(400);
  check(await p.evaluate(() => { const s = document.getElementById('stkop-sc'); return s && !s.hidden; }), tag + ': the card stays after the order panel closes');
  if (mobile) {
    await sleep(1700);   // the phone zoom button re-places every 1.5 s
    const ov = await p.evaluate(() => { const s = document.getElementById('stkop-sc').getBoundingClientRect(), z = document.querySelector('.stkz-pb'); if (!z || z.hidden) return null; const r = z.getBoundingClientRect(); return r.bottom > s.top && r.top < s.bottom && r.right > s.left && r.left < s.right ? { z: r.top, s: s.top } : null; });
    check(!ov, tag + ': phone zoom button never sits on the Scalp card', ov);
  }
  await p.screenshot({ path: OUT + '/scalp-' + tag + '.png' });
  // Join Bid (paper): a buy LIMIT at the bid
  // Sample data quote one tick under / at the chart's last price (a paper buy limit must sit below it)
  const bid = await p.evaluate(() => { const B = window.STRYKER_VELA.chart.orchestrator.rawBars, L = B[B.length - 1]; const c = L.close != null ? L.close : L[4]; window.__stkOpTest.q = { bid: c - 0.25, ask: c }; return c - 0.25; });
  await sleep(700);
  await p.evaluate(() => document.querySelector('#stkop-sc [data-a=jbid]').click());
  const jb = await opWait(p, (bid) => window.__stkPaper.account.state.orders.some((o) => o.type === 'limit' && o.side === 'buy' && o.price === bid), bid, 5000);
  check(jb, tag + ': Join Bid -> paper buy limit at the bid ' + bid, await p.evaluate(() => window.__stkPaper.account.state.orders.map((o) => [o.type, o.side, o.price])));
  if (!mobile) {
    // drag by the header: the place is remembered (reload keeps it)
    const h0 = await p.evaluate(() => { const r = document.querySelector('#stkop-sc .stkop-sct').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await p.mouse.move(h0.x, h0.y); await p.mouse.down(); await p.mouse.move(h0.x - 200, h0.y - 150, { steps: 8 }); await p.mouse.up(); await sleep(300);
    const a = await scGeo(p);
    check(a && Math.abs((sc.l - a.l) - 200) <= 2 && Math.abs((sc.t - a.t) - 150) <= 2, tag + ': drag moves the card', { before: sc, after: a });
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkPaper, null, { timeout: 60000 });
    await setSym(p, 'futures:NQ1!'); await p.evaluate(() => window.__stkPaper.orderPanel()); await opWait(p, () => window.__stkOrderPanel && window.__stkOrderPanel.isOpen, null, 8000);
    await opWait(p, () => { const s = document.getElementById('stkop-sc'); return s && !s.hidden; }, null, 5000); await sleep(500);
    const r2 = await scGeo(p);
    check(r2 && Math.abs(r2.l - a.l) <= 2 && Math.abs(r2.t - a.t) <= 2, tag + ': the dragged place is remembered after a reload', { a, r2 });
    // 1024: still inside the plot
    await p.setViewportSize({ width: 1024, height: 768 }); await sleep(900);
    const r3 = await scGeo(p);
    check(r3 && r3.l >= r3.plotL && r3.r <= r3.plotR && r3.t >= r3.plotT && r3.b <= r3.plotB, tag + ' @1024: card inside the chart plot', r3);
    await p.screenshot({ path: OUT + '/scalp-1024-' + theme + '.png' });
  }
  check(!errors.length, tag + ': no page errors', errors);
  await ctx.close();
}

// cTrader (mocked socket): Join Bid on the scalp card = ONE NewOrder (2106) LIMIT at the broker's bid
async function ctrader(b) {
  const tag = 'ct-1440';
  const { ctx, p, errors } = await open(b, { w: 1440, h: 900, theme: 'dark', ct: true });
  await p.waitForFunction(() => window.__stkLive && window.__stkLive.state.accounts.some((a) => a.ct), null, { timeout: 20000 });
  await p.evaluate(() => window.__stkLive.pick('ct-77'));
  await setSym(p, 'byo:CT:NAS100');
  await opWait(p, () => !!(window.__ctM.dataSocket && window.__ctM.spots > 0), null, 15000); await sleep(1200);
  await opWait(p, () => { const s = window.__ctM.dataSocket; return s && s.readyState === 1 && window.__ctM.sent.some((m) => m.payloadType === 2127); }, null, 20000);
  await p.evaluate(() => { const s = window.__ctM.dataSocket; s.relay.onUp(JSON.stringify({ payloadType: 2131, payload: { ctidTraderAccountId: 77, symbolId: 13, bid: 10000000, ask: 10012000, timestamp: Date.now() } })); });
  await p.evaluate(() => window.__stkPaper.orderPanel()); await opWait(p, () => window.__stkOrderPanel.isOpen, null, 8000);
  await opWait(p, () => { const n = document.querySelector('#stkop [data-k=spr]'); return n && n.textContent === '1.2'; }, null, 6000);
  const hd = await p.evaluate(() => ({ acct: document.querySelector('#stkop [data-k=acct]').textContent, root: document.querySelector('#stkop [data-k=root]').textContent, sell: document.querySelector('#stkop [data-k=sellp]').textContent, buy: document.querySelector('#stkop [data-k=buyp]').textContent, help: document.querySelector('#stkop [data-k=lothelp]').textContent }));
  check(/Demo/.test(hd.acct) && hd.root === 'NAS100' && hd.sell === '100.00' && hd.buy === '100.12', tag + ': account chip (Demo), NAS100, Sell 100.00 / Buy 100.12', hd);
  check(/lots = .* NAS100/.test(hd.help), tag + ': lot helper "0.01 lots = … NAS100" from the symbol lot size', hd);
  await p.screenshot({ path: OUT + '/ctrader-panel.png' });
  await p.evaluate(() => window.__stkOrderPanel.setScalp(true)); await sleep(500);
  const n0 = await p.evaluate(() => window.__ctM.sent.filter((m) => m.payloadType === 2106).length);
  await p.evaluate(() => document.querySelector('#stkop-sc [data-a=jbid]').click());
  // the live confirm (if the member's confirm setting is on) is accepted here; the mock never reaches a broker
  await sleep(600); await p.evaluate(() => { const y = document.querySelector('#stklv-cf [data-k=yes], #stklv-cf .stklv-go'); if (y) y.click(); });
  await opWait(p, (n) => window.__ctM.sent.filter((m) => m.payloadType === 2106).length > n, n0, 8000);
  const o = await p.evaluate(() => window.__ctM.sent.filter((m) => m.payloadType === 2106).map((m) => m.payload));
  const last = o[o.length - 1];
  check(o.length === n0 + 1 && last && last.orderType === 2 && last.tradeSide === 1 && Math.abs(last.limitPrice - 100) < 1e-9, tag + ': Join Bid -> one LIMIT buy at the bid 100.00 (mock socket)', o);
  await p.screenshot({ path: OUT + '/ctrader-scalp.png' });
  check(!errors.length, tag + ': no page errors', errors);
  await ctx.close();
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile, theme] of [[1440, 900, false, 'dark'], [1440, 900, false, 'light'], [390, 844, true, 'dark'], [412, 915, true, 'light']]) {
      if (process.env.ONE && process.env.ONE !== w + '-' + theme) continue;
      await paper(b, w, h, mobile, theme);
    }
    if (!process.env.ONE || process.env.ONE === 'ct') await ctrader(b);
  } catch (e) { fail++; console.log('FAIL crashed ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
