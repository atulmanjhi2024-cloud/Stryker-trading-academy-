// Broker connecting paused (Owner 23 Nov 2026, assets/broker-pause.js BROKERS_PAUSED). Firebase stubbed (richstub), every
// /connect/finatic/* call is recorded and answered locally: nothing leaves 127.0.0.1, no order op is ever sent.
//   node tools/tests/chart-dev-server.mjs 8041 &   CHART_BASE=http://127.0.0.1:8041 node tools/tests/broker-pause-browser.js <shotsDir>
// Checks: member: Trade menu = Paper + the pause line, no Connect a broker / live accounts / copy trading, no live module, no broker
// calls; admin + beta tester: Connect a broker + live module still there; journal: no Broker sync button, pause line in the Broker sync panel;
// help/connect-broker: pause line, broker tiles hidden; alignment (even padding, nothing clipped, no horizontal scroll at 390).
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8041';
const OUT = process.argv[2] || '/tmp/brokerpause';
fs.mkdirSync(OUT, { recursive: true });
const MSG = 'Broker connections are paused for a short while while we fix a connection issue. Your charts and journal history are not affected.';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 600) : '')); };

async function ctxFor(b, w, h, mobile, admin, calls, beta = false) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((admin) => {
    window.__stkLiveTest = { isAdmin: () => admin, last: () => 28750 };
    Object.defineProperty(window, 'showToast', { configurable: true, get: () => () => Promise.resolve(), set: () => {} });
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', 'night'); } catch (e) {}
  }, admin);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route('**/api/chart/bars/**', (r) => r.fulfill({ json: { bars: [] } }));
  // beta = the server's answer (functions/api/beta/status.js), mocked here: settings/betaTesters is not reachable from the test
  await ctx.route('**/api/beta/status', (r) => r.fulfill({ json: { beta: !!(beta || admin), admin: !!admin, cap: 30 } }));
  await ctx.route('**/connect/finatic/**', (r) => {
    let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
    calls.push({ path: new URL(r.request().url()).pathname, op: body.op });
    const u = r.request().url();
    if (/session/.test(u)) return r.fulfill({ json: { configured: true } });
    if (/data/.test(u) && body.op === 'accounts') return r.fulfill({ json: { userId: 'U', data: [] } });
    if (/order/.test(u) && body.op === 'env') return r.fulfill({ json: { env: 'live', enabled: false } });
    return r.fulfill({ status: 400, json: { error: 'Not allowed in this test' } });
  });
  return ctx;
}

async function menu(b, w, h, mobile, admin, beta = false) {
  const tag = w + '-' + (admin ? 'admin' : beta ? 'beta' : 'member'), calls = [];
  const ctx = await ctxFor(b, w, h, mobile, admin, calls, beta);
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.__stkPaper && window.__stkPaper.openTradeMenu, null, { timeout: 60000 });
  if (admin || beta) await p.waitForFunction(() => window.__stkLive && window.__stkLive.state && window.__stkLive.state.loaded, null, { timeout: 20000 }).catch(() => {});
  else await p.waitForTimeout(2500);
  await p.evaluate(() => window.__stkPaper.openTradeMenu());
  await p.waitForSelector('#stkc-trade-pop:not([hidden])', { timeout: 5000 });
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => {
    const pop = document.getElementById('stkc-trade-pop'), n = pop.querySelector('.stktm-paused'), t = pop.innerText;
    const box = (e) => e && e.getBoundingClientRect();
    const pr = box(pop), nr = box(n), cs = getComputedStyle(pop);
    return { text: t, paused: n ? n.textContent : '', connect: !!pop.querySelector('[data-a=connect]'), live: /Live accounts/i.test(t), copy: !!pop.querySelector('[data-x=copytrade]'),
      liveMod: !!(window.__stkLive && window.__stkLive.connect), vendor: /finatic|snaptrade/i.test(t),
      clip: n ? n.scrollWidth > n.clientWidth + 1 || nr.right > pr.right + 0.5 || nr.left < pr.left - 0.5 : null,
      padL: n ? Math.round(nr.left - pr.left) : null, padR: n ? Math.round(pr.right - nr.right) : null, popPad: [cs.paddingLeft, cs.paddingRight],
      rowL: Math.round(box(pop.querySelector('.stktm-row, [data-a=paper]')).left - pr.left), hscroll: document.documentElement.scrollWidth > innerWidth };
  });
  if (admin || beta) {
    check(r.connect && !r.paused && r.liveMod, tag + ': ' + (admin ? 'admin' : 'beta tester') + ' still sees Live accounts + Connect a broker, no pause line', r);
  } else {
    check(r.paused === MSG, tag + ': pause line shown, exact wording', r.paused);
    check(!r.connect && !r.live && !r.copy && !r.liveMod, tag + ': no Connect a broker / Live accounts / Copy trading / live module', r);
    check(calls.length === 0, tag + ': no /connect/finatic call at all', calls);
    check(!r.clip && !r.hscroll && Math.abs(r.padL - r.rowL) <= 1, tag + ': pause line inside the menu, left edge = Paper row edge, nothing clipped, no h-scroll', r);
  }
  check(!r.vendor, tag + ': no vendor name in the menu');
  check(!errors.length, tag + ': no page errors', errors);
  await p.screenshot({ path: OUT + '/chart-trade-menu-' + tag + '-dark.png' });
  await ctx.close();
}

async function page(b, w, h, mobile, path, name, fn, beta = false) {
  const calls = [], ctx = await ctxFor(b, w, h, mobile, false, calls, beta), p = await ctx.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3500);
  await fn(p, w + '');
  if (!beta) check(calls.length === 0, name + ' ' + w + ': no /connect/finatic call', calls);
  check(!errors.filter((e) => /broker-pause|journal-broker|finatic/.test(e)).length, name + ' ' + w + ': no errors from the changed files', errors);
  await p.screenshot({ path: OUT + '/' + name + '-' + w + (beta ? '-beta' : '') + '-dark.png', fullPage: false });
  await ctx.close();
}

(async () => {
  const b = await launch();
  try {
    for (const [w, h, m] of [[1440, 900, false], [390, 844, true]]) {
      await menu(b, w, h, m, false);
      await menu(b, w, h, m, true);
      await menu(b, w, h, m, false, true);
      await page(b, w, h, m, '/help/connect-broker.html', 'connect-page', async (p, t) => {
        const r = await p.evaluate(() => { const n = document.querySelector('.bh-paused'), g = document.querySelector('.bh-grid'), r = n && n.getBoundingClientRect(), cs = n && getComputedStyle(n);
          if (n) window.scrollTo(0, Math.max(0, n.getBoundingClientRect().top + scrollY - 140));
          return { msg: n && !n.hidden ? n.textContent : '', grid: g ? getComputedStyle(g).display : 'none', h2: getComputedStyle(document.getElementById('brokers')).display,
            pad: cs ? [cs.paddingTop, cs.paddingBottom, cs.paddingLeft, cs.paddingRight] : null, clip: n ? n.scrollWidth > n.clientWidth + 1 : null, hscroll: document.documentElement.scrollWidth > innerWidth }; });
        check(r.msg === MSG && r.grid === 'none' && r.h2 === 'none', 'connect page ' + t + ': pause line shown, broker tiles + "Pick your broker" hidden', r);
        check(r.pad && new Set(r.pad).size === 1 && !r.clip && !r.hscroll, 'connect page ' + t + ': even padding, nothing clipped, no h-scroll', r);
        await p.waitForTimeout(300);
      });
      await page(b, w, h, m, '/trade-journal.html', 'journal', async (p, t) => {
        const r = await p.evaluate(() => ({ btn: !!document.getElementById('ji-open-broker'), note: (document.getElementById('jb-unavailable') || {}).textContent, form: (document.getElementById('jb-form-wrap') || { style: {} }).style.display }));
        check(!r.btn && r.form === 'none' && r.note === MSG, 'journal ' + t + ': no Broker sync (beta) button, no connect form, pause line in the Broker sync panel', r);
      });
      await page(b, w, h, m, '/help/connect-broker.html', 'connect-page', async (p, t) => {
        const r = await p.evaluate(() => { const n = document.querySelector('.bh-paused'), g = document.querySelector('.bh-grid'); return { note: !!(n && !n.hidden), grid: g ? getComputedStyle(g).display : 'none' }; });
        check(!r.note && r.grid !== 'none', 'connect page ' + t + ' beta: no pause line, broker tiles shown', r);
      }, true);
      await page(b, w, h, m, '/trade-journal.html', 'journal', async (p, t) => {
        const r = await p.evaluate(() => ({ btn: !!document.getElementById('ji-open-broker'), note: (document.getElementById('jb-unavailable') || {}).textContent || '' }));
        check(r.btn && r.note !== MSG, 'journal ' + t + ' beta: Broker sync button shown, no pause line', r);
      }, true);
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
