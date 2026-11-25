// Symbol search "Your brokers & feeds" (assets/chart-search.js + chart-search-sources.js, Owner 24 Nov), real clicks / keys on the chart page.
// Sources are MOCKED: a cTrader demo account on a fake socket (tools/tests/ctrader-mock.mjs, the real relay rules), /connect/finatic/* returns
// a Tradovate account + a MetaTrader 5 account, and an OANDA "own data" feed is activated in the page with sample creds (no network: every
// other host is aborted). Nothing places, changes or cancels an order (checked: no NewOrder / cancel frames, no /order place calls).
//   node tools/tests/chart-dev-server.mjs 8031 &   CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-search-sources-browser.js <shotsDir>
// Checks (Owner update 24 Nov layout): the source chip left of the market tabs ("All markets"), its menu lists All markets + only the
// connected sources (status dot + "Live|Demo …123") + "+ Connect a broker or feed"; picking cTrader: placeholder "Search cTrader symbols",
// header "cTrader Demo …234 ▾" + "<n> symbols", rows grouped by asset class (symbol · description · chart), the tabs become the broker's
// classes and filter, search within the source, keyboard nav, details pane spec list (1 lot, smallest trade, swap, commission, market),
// Enter on NAS100.cash opens NQ1! and saves it for NDX on that account; MetaTrader: usual names + note; Tradovate: front months; OANDA:
// forex; no chart = says so; member without access sees only the data feed; nothing connected = All markets + Connect; phone 390 / 412:
// chip in the tab row, menu fits; alignment numbers; no horizontal scroll.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp/srcfilter';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 600) : '')); };
// extra cTrader symbols (Sample data): crypto / index / energy / forex pairs with no TradeZoro chart / a stock CFD
const EXTRA = [{ symbolId: 7, symbolName: 'BTCUSD', digits: 2, desc: 'Bitcoin vs US Dollar' }, { symbolId: 8, symbolName: 'US30', digits: 2, desc: 'Wall Street 30' }, { symbolId: 9, symbolName: 'WTI', digits: 3, desc: 'US Crude Oil' },
  { symbolId: 13, symbolName: 'NAS100', digits: 2, desc: 'Nasdaq 100 Index' }, { symbolId: 14, symbolName: 'SPX500', digits: 2, desc: 'S&P 500 Index' },
  { symbolId: 10, symbolName: 'AUDCAD', digits: 5, desc: 'Australian Dollar vs Canadian Dollar' }, { symbolId: 11, symbolName: 'AUDCHF', digits: 5, desc: 'Australian Dollar vs Swiss Franc' }, { symbolId: 12, symbolName: 'AAPL.US', digits: 2, desc: 'Apple Inc (CFD)' }];
const ACC = '123e4567-e89b-12d3-a456-426614174000', MT = '223e4567-e89b-12d3-a456-426614174001', US = '0aaa1111-2222-3333-4444-555566667777';

async function open(b, { w, h, mobile, theme, admin = true, broker = true, byo = true, extra = false }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(({ t, admin, US, broker, EX }) => {
    window.__stkLiveTest = { isAdmin: () => admin, isBeta: () => false, last: () => 28750, fastRetry: true,
      ctCreds: broker ? { access: 'ACCESSTOKENsample1', refresh: 'REFRESHsample1', exp: Date.now() + 30 * 864e5, accountId: 77, isLive: false, login: 5551234, kind: 'trade' } : null,
      ctDeps: { idToken: async () => 'IDT', save: async () => {} } };
    window.__toasts = []; const keep = () => (t, m) => { window.__toasts.push(String(m)); return Promise.resolve(); };
    Object.defineProperty(window, 'showToast', { configurable: true, get: () => keep(), set: () => {} });
    try {
      localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1');
      localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); localStorage.setItem('stryker_broker_sync_user_u1', US);
    } catch (e) {}
    window.__EXTRA = EX;
  }, { t: theme, admin, US, broker, EX: extra ? EXTRA : [] });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route('**/connect/ctrader/token*', (r) => r.fulfill({ json: { configured: true, client_id: 'CID_sample1' } }));
  const F = { calls: [] };
  const j = (o, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(o) });
  await ctx.route('**/connect/finatic/**', async (r) => {
    const u = new URL(r.request().url()); let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    F.calls.push({ path: u.pathname, op: body.op });
    if (u.pathname.endsWith('/data')) {
      if (body.op === 'accounts') return broker ? r.fulfill(j({ userId: US, data: [{ accountId: ACC, accountName: 'SAMPLEDEMO5551234', accountNumber: '70001234', brokerName: 'tradovate' }, { accountId: MT, accountName: 'SAMPLEMT5', accountNumber: '880011', brokerName: 'MetaTrader 5' }] })) : r.fulfill(j({ needsConnect: true, error: 'connect' }, 409));
      return r.fulfill(j({ data: [] }));
    }
    return r.fulfill(j({ data: {} }));
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|Failed to load resource|Ping received|Unexpected response code|WebSocket/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('dialog', (d) => d.dismiss());
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  if (broker) await p.evaluate(async () => { const m = await import('/tools/tests/ctrader-mock.mjs'); const M = m.mockState({ extra: window.__EXTRA }); window.__ctM = M; window.__stkLiveTest.ctDeps.WS = m.makeWS(M); });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkSearch, null, { timeout: 60000 });
  if (broker) await p.waitForFunction(() => window.__stkLive && window.__stkLive.state && window.__stkLive.state.accounts.length >= 3, null, { timeout: 20000 }).catch(() => {});
  if (byo) await p.waitForFunction(() => performance.getEntriesByType('resource').some((e) => /\/assets\/byo-core\.js\?v=/.test(e.name)), null, { timeout: 20000 });
  if (byo) await p.evaluate(async () => { const u = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\/assets\/byo-core\.js\?v=/.test(n)); const c = await import(u); c.activate('oanda', { token: 'SAMPLETOKEN', env: 'practice', account: '101-001-0000000-001' }); });
  await sleep(1500);
  return { ctx, p, errors, F };
}
const openSearch = async (p) => { await p.evaluate(() => window.__stkSearch.open('')); await p.waitForFunction(() => window.__stkSearch.sources(), null, { timeout: 10000 }); await sleep(300); };
const menuOpen = async (p) => { if (await p.evaluate(() => document.querySelector('.stkss-srcmenu').hidden)) await p.click('.stkss-srcchip'); await sleep(150); };
const menu = (p) => p.evaluate(() => [...document.querySelectorAll('.stkss-srcmenu .stkss-mi')].map((e) => ({ t: e.innerText.replace(/\n/g, ' | '), src: e.dataset.src || '', dot: !!e.querySelector('.stkss-sdot'), img: !!e.querySelector('img'), on: e.getAttribute('aria-checked') === 'true' })));
const pickSrc = async (p, id) => { await menuOpen(p); await p.click('.stkss-srcmenu [data-src="' + id + '"]'); await p.waitForFunction(() => document.querySelectorAll('.stkss-row-src').length > 0 || /Could not|doesn’t/.test((document.querySelector('.stkss-list') || {}).innerText || ''), null, { timeout: 10000 }).catch(() => {}); await sleep(300); };
const list = (p) => p.evaluate(() => ({ head: (document.querySelector('.stkss-lhead') || {}).innerText || '', groups: [...document.querySelectorAll('.stkss-gh')].map((e) => e.textContent),
  tabs: [...document.querySelectorAll('.stkss-tabs .stkss-tab')].map((e) => e.textContent), ph: document.querySelector('.stkss-input').placeholder,
  rows: [...document.querySelectorAll('.stkss-row')].map((e) => ({ code: e.dataset.code || e.querySelector('.stkss-tk').textContent, desc: (e.querySelector('.stkss-sd') || {}).textContent || '', to: (e.querySelector('.stkss-to') || {}).textContent || '', sel: e.getAttribute('aria-selected') === 'true' })),
  chip: document.querySelector('.stkss-srcchip').innerText, side: (document.querySelector('.stkss-side') || {}).innerText || '', empty: (document.querySelector('.stkss-empty') || {}).textContent || '' }));
// alignment: chip vs tabs, chip padding, menu rows, list header, columns, spec rows
const align = (p) => p.evaluate(() => {
  const out = {}, cy = (b) => b.top + b.height / 2, R = (x) => Math.round(x * 10) / 10;
  const c = document.querySelector('.stkss-srcchip'), t = document.querySelector('.stkss-tab');
  if (c && c.offsetParent) { const b = c.getBoundingClientRect(), kids = [...c.children].map((k) => k.getBoundingClientRect()), tb = t.getBoundingClientRect();
    out.chip = { h: b.height, tabH: tb.height, tabCyOff: R(Math.abs(cy(tb) - cy(b))), kidOff: R(Math.max(...kids.map((k) => Math.abs(cy(k) - cy(b))))), padL: R(kids[0].left - b.left), padR: R(b.right - c.querySelector('.stkss-srcchip-ic path').getBoundingClientRect().right) }; /* the chevron's drawn edge, not its 24-unit box */; }
  const m = document.querySelector('.stkss-srcmenu');
  if (m && !m.hidden) out.menu = [...m.querySelectorAll('.stkss-mi')].map((r) => { const b = r.getBoundingClientRect(); return { off: R(Math.max(...[...r.children].map((k) => Math.abs(cy(k.getBoundingClientRect()) - cy(b))))), clip: [...r.querySelectorAll('.stkss-mi-l')].some((l) => l.scrollWidth > l.clientWidth + 1), right: b.right }; });
  if (m && !m.hidden) { const b = m.getBoundingClientRect(); out.menuIn = b.left >= 0 && b.right <= innerWidth && b.bottom <= innerHeight; }
  const hr = document.querySelector('.stkss-lhead-r');
  if (hr) { const b = hr.getBoundingClientRect(); out.head = R(Math.max(...[...hr.children].map((k) => Math.abs(cy(k.getBoundingClientRect()) - cy(b))))); }
  const r = document.querySelector('.stkss-row-src'), cols = document.querySelector('.stkss-cols');
  if (r) { const b = r.getBoundingClientRect(); out.row = { off: R(Math.max(...[...r.children].map((k) => Math.abs(cy(k.getBoundingClientRect()) - cy(b))))), h: b.height };
    if (cols) out.colX = [...cols.children].map((k, i) => R(Math.abs(k.getBoundingClientRect()[i === 2 ? 'right' : 'left'] - r.children[i].getBoundingClientRect()[i === 2 ? 'right' : 'left']))); }
  out.descX = new Set([...document.querySelectorAll('.stkss-row-src .stkss-sd')].map((e) => Math.round(e.getBoundingClientRect().left))).size;
  out.kv = [...document.querySelectorAll('.stkss-kv-r')].map((k) => { const a = k.children[0].getBoundingClientRect(), d = k.children[1].getBoundingClientRect(); return R(Math.abs(cy(a) - cy(d))); });
  out.tabsOneRow = (() => { const tr = document.querySelector('.stkss-tabrow'); return tr.scrollHeight <= tr.clientHeight + 1; })();
  out.hscroll = document.documentElement.scrollWidth > innerWidth + 1 || document.querySelector('.stkss-box').scrollWidth > document.querySelector('.stkss-box').clientWidth + 1;
  return out;
});
const ok1 = (a) => a.chip && a.chip.tabCyOff <= 1 && Math.abs(a.chip.padL - a.chip.padR) <= 1 && a.chip.h === a.chip.tabH && a.chip.kidOff <= 1 && (!a.head && a.head !== 0 || a.head <= 1) && (!a.row || a.row.off <= 1) && (!a.colX || a.colX.every((x) => x <= 1)) && a.kv.every((x) => x <= 1) && (a.descX || 0) <= 1 && !a.hscroll;

async function desktop(b, theme) {
  const tag = '1440-' + theme;
  const { ctx, p, errors } = await open(b, { w: 1440, h: 900, theme });
  await openSearch(p);
  let l = await list(p);
  check(/All markets/.test(l.chip), tag + ': source chip reads "All markets" by default', l.chip);
  const before = await p.evaluate(() => { const c = document.querySelector('.stkss-srcchip'), t = document.querySelector('.stkss-tabs'); return c.compareDocumentPosition(t) & 4; });
  check(!!before, tag + ': the chip sits left of the market tabs');
  await menuOpen(p);
  let m = await menu(p);
  check(m.length === 6 && m[0].t === 'All markets' && m[0].on && /cTrader \| Demo …234/.test(m.map((x) => x.t).join()) && /MetaTrader 5 \| Live …011/.test(m.map((x) => x.t).join()) && /Tradovate/i.test(m.map((x) => x.t).join()) && /OANDA/.test(m.map((x) => x.t).join()) && m[5].t === '+ Connect a broker or feed', tag + ': menu = All markets, the 4 connected sources with account labels, Connect', m);
  check(m.slice(1, 5).every((x) => x.dot && !x.img), tag + ': each source has a status dot, no logos', m);
  let al = await align(p); console.log('ALIGN menu ' + tag + ' ' + JSON.stringify(al));
  check(al.menu.every((x) => x.off <= 1 && !x.clip) && al.menuIn && ok1(al), tag + ': chip + menu aligned (1 px), nothing clipped', al);
  await p.screenshot({ path: OUT + '/menu-' + tag + '.png' });
  await p.keyboard.press('Escape'); await sleep(100);
  check(await p.evaluate(() => document.querySelector('.stkss-srcmenu').hidden && window.__stkSearch.isOpen()), tag + ': Esc closes the menu only');
  // cTrader
  await pickSrc(p, 'ct-77');
  l = await list(p);
  check(/cTrader/.test(l.chip) && l.ph === 'Search cTrader symbols', tag + ': chip shows cTrader, placeholder "Search cTrader symbols"', [l.chip, l.ph]);
  check(/cTrader\s+Demo …234/.test(l.head) && /6 symbols/.test(l.head), tag + ': header "cTrader Demo …234" + "6 symbols"', l.head);
  check(l.rows.length === 6 && l.groups.includes('Indices') && l.groups.includes('Forex') && l.groups.includes('Metals'), tag + ': 6 symbols grouped by asset class', [l.rows.length, l.groups]);
  check(l.rows.some((x) => x.code === 'USTEC' && x.desc === 'US Tech 100 Index (alt)' && x.to === 'Broker prices'), tag + ': USTEC row: broker description + charts from the broker\'s own prices (Owner 25 Nov, never NQ1!)', l.rows);
  check(l.tabs.join() === 'All,Forex,Indices,Metals', tag + ': tabs become the broker\'s classes', l.tabs);
  check(!/Bid|Today/.test(l.head), tag + ': no price columns (no streamed prices, no fake numbers)');
  await p.waitForFunction(() => document.querySelectorAll('.stkss-kv-r').length >= 4, null, { timeout: 8000 }).catch(() => {});
  l = await list(p);
  check(/EURUSD/.test(l.side) && /1 lot\s+100,000 EUR/.test(l.side) && /Smallest trade\s+0\.01 lots/.test(l.side) && /Swap \(pips\)\s+Long −0\.79 · Short \+0\.13/.test(l.side) && /Commission per side\s+30 USD \/ 1M USD/.test(l.side) && /Market\s+(Open, closes|Closed, opens)/.test(l.side), tag + ': details pane spec list from the broker', l.side);
  al = await align(p); console.log('ALIGN ct ' + tag + ' ' + JSON.stringify(al));
  check(ok1(al) && al.tabsOneRow, tag + ': chip / header / row / columns / spec rows aligned within 1 px, one-row tab bar', al);
  await p.screenshot({ path: OUT + '/ctrader-' + tag + '.png' });
  await p.click('.stkss-tab[data-tab="Indices"]'); await sleep(200);
  l = await list(p);
  check(l.rows.length === 4 && l.rows.every((x) => x.to === 'Broker prices'), tag + ': Indices tab filters within the broker', l.rows);
  await p.click('.stkss-tab[data-tab="all"]'); await sleep(150);
  // search within the source + keyboard
  await p.focus('.stkss-input'); await p.keyboard.type('TEC'); await sleep(250);
  l = await list(p);
  check(l.rows.length === 3 && l.rows[0].code === 'USTEC' && l.rows[0].sel, tag + ': typing TEC narrows the list, symbol-name match first and highlighted', l.rows);
  await p.keyboard.press('Backspace'); await p.keyboard.press('Backspace'); await p.keyboard.press('Backspace'); await p.keyboard.type('NAS'); await sleep(200);
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowUp'); l = await list(p);
  check(l.rows[0] && l.rows[0].code === 'NAS100.cash' && l.rows[0].sel, tag + ': arrow keys keep working', l.rows);
  check(/NAS100\.cash/.test(l.side) && /Open on the active chart/.test(l.side), tag + ': details pane shows the target chart', l.side);
  await p.keyboard.press('Enter'); await sleep(1500);
  const after = await p.evaluate(() => ({ sym: window.STRYKER_VELA.active.symbol, open: window.__stkSearch.isOpen(), map: JSON.parse(localStorage.getItem('stryker_mt_map_u1') || '{}') }));
  check(/^byo:CT:NAS100\.?cash$/i.test(after.sym) && !after.open, tag + ': Enter on NAS100.cash opens the broker\'s own NAS100.cash chart, not NQ1!', after.sym);
  check(after.map['ct-77'] && after.map['ct-77'].NDX === 'NAS100.cash', tag + ': NAS100.cash remembered for NDX on the cTrader account', after.map);
  // MetaTrader: no shared list -> usual names + note
  await openSearch(p);
  check(/All markets/.test((await list(p)).chip), tag + ': the source resets to All markets on the next open');
  await pickSrc(p, MT);
  l = await list(p);
  check(/MetaTrader doesn’t share its full list; showing the usual names/.test(l.head) && l.rows.some((x) => x.code === 'US100'), tag + ': MetaTrader: usual names + the note', { head: l.head, n: l.rows.length });
  await p.click('.stkss-row-src[data-code="US100"]'); await sleep(1200);
  const mtMap = await p.evaluate(() => JSON.parse(localStorage.getItem('stryker_mt_map_u1') || '{}'));
  check(mtMap[MT] && mtMap[MT].NDX === 'US100', tag + ': US100 remembered for the MetaTrader account', mtMap);
  // Tradovate via the header ▾ (switch account / source)
  await openSearch(p); await pickSrc(p, 'ct-77');
  await p.click('.stkss-acct'); await sleep(150);
  check(!(await p.evaluate(() => document.querySelector('.stkss-srcmenu').hidden)), tag + ': ▾ in the list header opens the account / source menu');
  await p.click('.stkss-srcmenu [data-src="' + ACC + '"]'); await p.waitForFunction(() => document.querySelectorAll('.stkss-row-src').length > 5, null, { timeout: 8000 }).catch(() => {});
  l = await list(p);
  check(l.rows.some((x) => /^NQ[HMUZ]\d$/.test(x.code)) && l.rows.some((x) => /^MES[HMUZ]\d$/.test(x.code)) && l.groups.includes('Futures'), tag + ': Tradovate lists futures front months', l.rows.slice(0, 6));
  await p.screenshot({ path: OUT + '/tradovate-' + tag + '.png' });
  // OANDA (own data): forex the adapter serves
  await pickSrc(p, 'byo:oanda');
  l = await list(p);
  check(l.rows.length > 0 && l.rows.some((x) => x.code === 'EURUSD') && /OANDA/.test(l.head), tag + ': OANDA lists the forex pairs it serves', l.rows.slice(0, 4));
  await p.screenshot({ path: OUT + '/oanda-' + tag + '.png' });
  await p.click('.stkss-row-src[data-code="EURUSD"]'); await sleep(1200);
  check(/EURUSD/.test(await p.evaluate(() => window.STRYKER_VELA.active.symbol)), tag + ': EURUSD from OANDA opens fx:EURUSD (the feed routes it)');
  // back to All markets from the menu
  await openSearch(p); await pickSrc(p, 'ct-77'); await menuOpen(p); await p.click('.stkss-srcmenu .stkss-mi'); await sleep(200);
  l = await list(p);
  check(/All markets/.test(l.chip) && /Markets/.test(l.head) && l.tabs[1] === 'Stocks' || l.tabs.includes('Futures'), tag + ': "All markets" brings back the normal list and tabs', [l.chip, l.head, l.tabs]);
  // a broker symbol with no chart
  await p.evaluate(async () => { const lv = window.__stkLive, f0 = lv.srcSymbols; lv.srcSymbols = async (id) => (await f0(id)).concat([{ code: 'SAMPLEX', desc: 'Sample instrument' }]); });
  await pickSrc(p, 'ct-77');
  await p.focus('.stkss-input'); await p.keyboard.type('SAMPLEX'); await sleep(250);
  l = await list(p);
  check(/charts from your cTrader account’s own prices/.test(l.side) && (l.rows[0] || {}).to === 'Broker prices', tag + ': no TradeZoro chart: "Broker prices" + the pane says it charts from cTrader', [l.side, l.rows[0]]);
  await p.screenshot({ path: OUT + '/nochart-' + tag + '.png' });
  check(!errors.length, tag + ': no page errors', errors);
  const sent = await p.evaluate(() => (window.__ctM ? window.__ctM.sent.filter((m) => [2106, 2107, 2108, 2109, 2111, 2110].includes(m.payloadType)).length : 0));
  check(sent === 0, tag + ': no order frames reached the mocked cTrader', sent);
  await ctx.close();
}
// Owner 25 Nov "add symbols to broker as well": every broker row has the symbol's own icon (coin / index mark / oil / two flags / company
// logo, never initials for a known symbol), the details header too; a symbol with no TradeZoro chart (AUDCAD) opens a chart from the
// cTrader account's own trendbars (fixture) labelled "via cTrader", and nothing ever says "No chart yet".
async function brokersyms(b, theme, w = 1440) {
  const tag = 'syms-' + w + '-' + theme;
  const { ctx, p, errors } = await open(b, { w, h: w < 600 ? 844 : 900, mobile: w < 600, theme, extra: true });
  await openSearch(p); await pickSrc(p, 'ct-77');
  await p.waitForFunction(() => [...document.querySelectorAll('.stkss-row-src')].every((r) => !r.querySelector('.slg-b') || r.dataset.code === 'SAMPLEX'), null, { timeout: 5000 }).catch(() => {});
  await sleep(600);
  const rows = await p.evaluate(() => [...document.querySelectorAll('.stkss-row-src')].slice(0, 30).map((r) => { const ic = r.querySelector('.stkss-ic'), s = ic && ic.querySelector('.slg'), b = ic && ic.getBoundingClientRect(), g = s && s.getBoundingClientRect(), img = s && s.querySelector('img');
    return { code: r.dataset.code, kind: !s ? 'none' : s.classList.contains('slg-b') ? 'initials' : img ? 'img' : s.querySelector('svg') ? 'svg' : 'other', loaded: !img || (img.complete && img.naturalWidth > 0), to: r.querySelector('.stkss-to').textContent,
      box: b && [Math.round(b.width), Math.round(b.height)], cOff: b && g ? Math.round(Math.max(Math.abs((b.left + b.width / 2) - (g.left + g.width / 2)), Math.abs((b.top + b.height / 2) - (g.top + g.height / 2))) * 10) / 10 : 99,
      rowOff: (() => { const rb = r.getBoundingClientRect(), cy = (x) => x.top + x.height / 2; return Math.round(Math.max(...[b, r.querySelector('.stkss-tk').getBoundingClientRect(), r.querySelector('.stkss-sd').getBoundingClientRect(), r.querySelector('.stkss-to').getBoundingClientRect()].map((x) => Math.abs(cy(x) - cy(rb)))) * 10) / 10; })() }; }));
  console.log('ROWS ' + tag + ' ' + JSON.stringify(rows.map((r) => r.code + ':' + r.kind + ':' + r.to)));
  check(rows.length === 14 && rows.every((r) => r.kind !== 'none' && r.kind !== 'initials' && r.loaded), tag + ': every broker row has a symbol icon (img / svg / flags), none fall back to initials', rows.filter((r) => r.kind === 'none' || r.kind === 'initials' || !r.loaded));
  const by = Object.fromEntries(rows.map((r) => [r.code, r]));
  check(by.BTCUSD.kind === 'img' && by.US30.kind === 'svg' && by.WTI.kind === 'svg' && by.AUDCAD.kind === 'svg' && by.XAUUSD.kind === 'svg' && by['AAPL.US'].kind === 'img', tag + ': BTC coin, Dow mark, oil drop, AUD/CAD flags, gold, Apple logo', by);
  check(rows.every((r) => r.box[0] === 36 && r.box[1] === 36 && r.cOff <= 1 && r.rowOff <= 1), tag + ': icons 36 px like the main list, centred, one row centre (1 px)', rows.map((r) => [r.code, r.box, r.cOff, r.rowOff]));
  check(rows.every((r) => r.to && r.to !== 'No chart yet') && rows.every((r) => r.to === 'Broker prices'), tag + ': "Opens chart" says "Broker prices" for every cTrader symbol (never YM1! / NQ1!, never "No chart yet")', rows.map((r) => r.code + '=' + r.to));
  const al = await align(p); check(ok1(al), tag + ': header / rows / columns aligned, no horizontal scroll', al);
  await p.screenshot({ path: OUT + '/brokersyms-' + w + '-' + theme + '.png' });
  // AUDCAD: details pane header icon + opens a chart from the broker's prices
  await p.focus('.stkss-input'); await p.keyboard.type('AUDCAD'); await sleep(400);
  const sh = await p.evaluate(() => { const h = document.querySelector('.stkss-shead-row'), s = h && h.querySelector('.slg'), t = h && h.querySelector('.stkss-shead-t'); if (!s) return null; const a = s.getBoundingClientRect(), b = t.getBoundingClientRect(); return { svg: !!s.querySelector('svg'), w: a.width, off: Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)), side: document.querySelector('.stkss-side').innerText }; });
  check(sh && sh.svg && (sh.w === 40 || w < 600) && sh.off <= 1 && /cTrader account’s own prices/.test(sh.side), tag + ': details header has the AUD/CAD flags, centred with the name; pane explains the broker prices', sh);
  if (w >= 1000) await p.screenshot({ path: OUT + '/brokersyms-audcad-' + w + '-' + theme + '.png' });
  await p.click('.stkss-row-src[data-code="AUDCAD"]');
  await p.waitForFunction(() => { try { const c = window.__stkAxisTags.cellsOf()[0], R = window.__stkAxisTags.rendererOf(c); return /CT:AUDCAD/.test(window.STRYKER_VELA.active.symbol) && R.scene.bars.length > 50; } catch (e) { return false; } }, null, { timeout: 20000 }).catch(() => {});
  const ch = await p.evaluate(() => { const c = window.__stkAxisTags.cellsOf()[0], R = window.__stkAxisTags.rendererOf(c), bars = R.scene.bars; return { sym: window.STRYKER_VELA.active.symbol, n: bars.length, last: bars.length ? bars[bars.length - 1].close : null, open: window.__stkSearch.isOpen(), credit: (document.querySelector('.stkchart-credit') || {}).textContent || '', head: (document.querySelector('.vela-header, header') || {}).innerText || '' }; });
  check(!ch.open && /^byo:CT:AUDCAD$/i.test(ch.sym) && ch.n > 50 && ch.last > 0.8 && ch.last < 1, tag + ': clicking AUDCAD opens byo:CT:AUDCAD with the broker\'s bars (fixture)', ch);
  check(/via cTrader|your cTrader/.test(ch.credit + ' ' + ch.head), tag + ': chart source reads cTrader', [ch.credit, ch.head.slice(0, 200)]);
  const M = await p.evaluate(() => ({ bars: window.__ctM.bars || 0, orders: window.__ctM.sent.filter((m) => [2106, 2107, 2108, 2109, 2110, 2111].includes(m.payloadType)).length }));
  check(M.bars > 0 && M.orders === 0, tag + ': bars came from GetTrendbars on the data relay; no order frames', M);
  await p.screenshot({ path: OUT + '/brokersyms-chart-' + w + '-' + theme + '.png' });
  check(!errors.length, tag + ': no page errors', errors);
  await ctx.close();
}
// Owner 25 Nov (2nd report): in the broker view EVERY broker symbol opens THAT broker's instrument chart from its own prices. NAS100 ->
// byo:CT:NAS100 ("NAS100 · via cTrader"), never NQ1!; US30 never YM1!; XAUUSD the broker's gold. Orders from that chart go to NAS100.
// Index rows carry the drawn index marks (Nasdaq / S&P / Dow), never the "100" / "500" / "30" number badges. Fixture bars, no orders.
async function brokerown(b, theme, w = 1440) {
  const tag = 'own-' + w + '-' + theme;
  const { ctx, p, errors } = await open(b, { w, h: w < 600 ? 844 : 900, mobile: w < 600, theme, extra: true });
  const mark = (sel) => p.evaluate((sel) => { const s = document.querySelector(sel); if (!s) return null; const t = s.querySelector('svg text'); return { svg: !!s.querySelector('svg'), text: t ? t.textContent : '', path: !!s.querySelector('svg path') }; }, sel);
  for (const [code, re, bad, mk] of [['NAS100', /NAS100/, /\bNQ/, (m) => m && m.svg && m.path && !m.text], ['US30', /US30/, /\bYM/, (m) => m && m.svg && m.text === 'DJ'], ['XAUUSD', /XAUUSD/, /\bGC1/, () => true], ['SPX500', /SPX500/, /\bES1/, (m) => m && m.svg && m.text === 'S&P']]) {
    await openSearch(p); await pickSrc(p, 'ct-77');
    await p.focus('.stkss-input'); await p.keyboard.type(code); await sleep(400);
    const row = await p.evaluate((c) => { const r = document.querySelector('.stkss-row-src[data-code="' + c + '"]'); return r ? { to: r.querySelector('.stkss-to').textContent, side: document.querySelector('.stkss-side').innerText } : null; }, code);
    const m = await mark('.stkss-row-src[data-code="' + code + '"] .slg');
    check(row && row.to === 'Broker prices' && !bad.test(row.to), tag + ': ' + code + ' row says "Broker prices"', row);
    check(mk(m), tag + ': ' + code + ' row icon is the index mark / its own icon, not a number badge', m);
    check(row && new RegExp('Chart\\s*' + code + '\\s*Open on the active chart · prices from cTrader').test(row.side) && (code === 'XAUUSD' || /Also on\s*(NQ1!|YM1!|ES1!)/.test(row.side)), tag + ': ' + code + ' details pane: Chart = ' + code + ', the futures only as "Also on"', row && row.side);
    if (code === 'NAS100' && w >= 1000) await p.screenshot({ path: OUT + '/own-nas100-' + w + '-' + theme + '.png' });
    if (code === 'US30' && w < 600) await p.screenshot({ path: OUT + '/own-us30-' + w + '-' + theme + '.png' });
    await p.click('.stkss-row-src[data-code="' + code + '"]');
    await p.waitForFunction((c) => { try { const R = window.__stkAxisTags.rendererOf(window.__stkAxisTags.cellsOf()[0]); return new RegExp('CT:' + c + '$', 'i').test(window.STRYKER_VELA.active.symbol) && R.scene.bars.length > 50; } catch (e) { return false; } }, code, { timeout: 20000 }).catch(() => {});
    await sleep(500);
    const ch = await p.evaluate(() => ({ sym: window.STRYKER_VELA.active.symbol, head: ((document.querySelector('.vela-widget-symbol') || {}).textContent || '') + ' | ' + ((document.querySelector('.vela-statusline .vela-sl-symbol') || {}).textContent || '') + ' ' + ((document.querySelector('.vela-statusline .vela-sl-meta') || {}).textContent || ''), open: window.__stkSearch.isOpen(), wm: (document.querySelector('.vela-watermark') || {}).textContent || '', mb: (document.querySelector('.vela-mb-symbol') || {}).textContent || '', hm: (() => { const s = document.querySelector('.vela-widget-symbol .slg'); return s ? { svg: !!s.querySelector('svg'), text: (s.querySelector('svg text') || {}).textContent || '', path: !!s.querySelector('svg path'), img: !!s.querySelector('img') } : null; })() }));
    check(!ch.open && new RegExp('^byo:CT:' + code + '$', 'i').test(ch.sym) && re.test(ch.head) && !bad.test(ch.head), tag + ': click ' + code + ' -> chart is the broker instrument, header has ' + code + ', not the future', ch);
    if (code === 'NAS100') {
      check(mk(ch.hm), tag + ': chart header icon for NAS100 is the Nasdaq mark', ch.hm);
      check(/^\s*NAS100\s*\|\s*NAS100\b.*cTrader/.test(ch.head) && !/CT:|BYO/.test(ch.head) && !/CT:/.test(ch.wm + ch.mb),  tag + ': header reads "NAS100" and the legend "NAS100 · cTrader" (no CT: / BYO)', ch.head);
      // orders from this chart go to NAS100 on the cTrader account (read the mapping only; nothing is sent)
      const t = await p.evaluate(async () => { const v = /\?v=(\d+)/.exec(performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\/assets\/chart-[a-z-]+\.js\?v=\d+/.test(n)))[1]; const L = await import('/assets/chart-live.js?v=' + v); const S = window.__stkLive.state, keep = S.acct; S.acct = S.accounts.find((a) => a.ct); const m = L.mtFor(window.STRYKER_VELA.active.symbol), a = L.badgeAct(window.STRYKER_VELA.active.symbol), nq = L.mtFor('CME:NQ1!'); S.acct = keep; return { sym: m && m.sym, same: m && m.same, act: a, nq: nq && nq.key }; });
      check(t.sym === 'NAS100' && t.same === true && t.act === '' && t.nq === 'NDX', tag + ': trading on the NAS100 chart uses NAS100 (broker prices), no picker; an NQ1! chart keeps today\'s mapping', t);
      await p.screenshot({ path: OUT + '/own-nas100-chart-' + w + '-' + theme + '.png' });
    }
  }
  const al = await (async () => { await openSearch(p); await pickSrc(p, 'ct-77'); await sleep(300); return align(p); })();
  check(ok1(al), tag + ': rows / columns aligned, no horizontal scroll', al);
  const M = await p.evaluate(() => window.__ctM.sent.filter((m) => [2106, 2107, 2108, 2109, 2110, 2111].includes(m.payloadType)).length);
  check(M === 0, tag + ': no order frames', M);
  check(!errors.length, tag + ': no page errors', errors);
  await ctx.close();
}
async function member(b) {
  const { ctx, p, errors } = await open(b, { w: 1440, h: 900, theme: 'dark', admin: false, broker: false });
  await openSearch(p); await menuOpen(p);
  const m = await menu(p);
  check(m.length === 3 && m[0].t === 'All markets' && /OANDA/.test(m[1].t) && /Connect/.test(m[2].t), 'member without broker access: only the data feed + Connect', m);
  await ctx.close();
  const z = await open(b, { w: 1440, h: 900, theme: 'dark', admin: false, broker: false, byo: false });
  await openSearch(z.p); await menuOpen(z.p);
  const m2 = await menu(z.p);
  check(m2.length === 2 && m2[1].t === '+ Connect a broker or feed', 'nothing connected: All markets + "+ Connect a broker or feed"', m2);
  await z.p.screenshot({ path: OUT + '/menu-empty-1440-dark.png' });
  await z.p.click('.stkss-srcmenu .stkss-mi.is-add'); await sleep(600);
  check(await z.p.evaluate(() => !window.__stkSearch.isOpen() && !!(window.STRYKER_BYO && window.STRYKER_BYO.isOpen)), '+ Connect opens the existing Data source sheet');
  await z.p.screenshot({ path: OUT + '/connect-sheet.png' });
  check(!errors.length && !z.errors.length, 'member: no page errors', errors.concat(z.errors));
  await z.ctx.close();
}
async function phone(b, w, theme) {
  const tag = w + '-' + theme;
  const { ctx, p, errors } = await open(b, { w, h: 844, mobile: true, theme });
  await openSearch(p);
  await p.tap('.stkss-srcchip'); await sleep(200);
  let al = await align(p); console.log('ALIGN menu ' + tag + ' ' + JSON.stringify(al));
  check(al.menu && al.menu.length === 6 && al.menuIn && al.menu.every((x) => x.off <= 1 && !x.clip) && ok1(al), tag + ': chip in the tab row, menu fits on screen, aligned', al);
  await p.screenshot({ path: OUT + '/phone-menu-' + tag + '.png' });
  await p.tap('.stkss-srcmenu [data-src="ct-77"]'); await p.waitForFunction(() => document.querySelectorAll('.stkss-row-src').length > 0, null, { timeout: 8000 }).catch(() => {});
  await sleep(300);
  al = await align(p); console.log('ALIGN ct ' + tag + ' ' + JSON.stringify(al));
  check(ok1(al), tag + ': no horizontal scroll, header / rows / columns aligned', al);
  await p.screenshot({ path: OUT + '/phone-ctrader-' + tag + '.png' });
  await p.tap('.stkss-row-src[data-code="XAUUSD"]'); await sleep(1200);
  check(/XAUUSD|GC1!/.test(await p.evaluate(() => window.STRYKER_VELA.active.symbol)), tag + ': tap XAUUSD opens the gold chart');
  check(!errors.length, tag + ': no page errors', errors);
  await ctx.close();
}
async function widths(b) {   // the tab row stays one row with the chip at 1280 / 1024
  for (const w of [1280, 1024]) {
    const { ctx, p } = await open(b, { w, h: 800, theme: 'dark' });
    await openSearch(p); await pickSrc(p, 'ct-77');
    const al = await align(p);
    check(al.tabsOneRow && !al.hscroll && al.chip && al.chip.tabCyOff <= 1, w + ': tab row one row, chip centred, no overflow', al);
    await ctx.close();
  }
}
(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=700'] });
  try {
    const only = process.env.ONLY || '';
    if (!only || only === 'd') { await desktop(b, 'dark'); await desktop(b, 'light'); }
    if (!only || only === 'm') await member(b);
    if (!only || only === 'p') { await phone(b, 390, 'dark'); await phone(b, 390, 'light'); await phone(b, 412, 'dark'); }
    if (!only || only === 'w') await widths(b);
    if (!only || only === 'o') { await brokerown(b, 'dark'); await brokerown(b, 'light'); await brokerown(b, 'dark', 390); }
    if (!only || only === 's') { await brokersyms(b, 'dark'); await brokersyms(b, 'light'); await brokersyms(b, 'dark', 390); }
  } catch (e) { fail++; console.log('FAIL crashed ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
