// TICKGAP (24 Nov 2026) browser test with a FAKE hub socket (no Worker, no key). Member report: NQ/MNQ 1m "stuck for 10-15 s".
//   node tools/tests/chart-dev-server.mjs 8055 &
//   CHART_BASE=http://127.0.0.1:8055 flock /tmp/stryker-chrome.lock node tools/tests/tickgap-browser.js <shotsDir>
// NQ1! 1m fed by a fake /ts-live (a trade every 150 ms, ping every 5 s). Measures what the CHART paints (the forming candle's close,
// read every 100 ms), not what the socket gets:
//   1. steady feed: no paint gap > 1 s over 15 s
//   2. a dropped socket (1006) after data: the candle moves again within ~1.5 s, three drops in a row too (the old backoff grew 1.5/3/6 s)
//   3. a half-open socket (silent, never closed): dropped by the watchdog and moving again within 14 s (was 20 s + backoff)
//   4. admin / beta tester: the data dot tooltip carries the "Data gaps" line and counts the stall; a member's tooltip does not
// Shots at 390 and 1440 (tooltip open).
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8055', OUT = process.argv[2] || '/tmp/tickgap-shots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };

function fakeHub(cfg) {
  window.__stkL2Test = { base: 'http://127.0.0.1:9' }; globalThis.__TZ_CME_OPEN = true;   // CME session clock: open (the run must not depend on the hour)
  window.__opens = 0; window.__mode = 'live';   // live | silent | down
  const Real = window.WebSocket;
  window.WebSocket = function (url, proto) {
    if (!/\/ts-live/.test(String(url))) return new Real(url, proto);
    window.__opens++;
    const ws = { readyState: 0, send() {}, close(code) { if (this.readyState === 3) return; this.readyState = 3; clearInterval(this.iv); clearInterval(this.pv); clearInterval(this.bv); setTimeout(() => this.onclose && this.onclose({ code: code || 1000 }), 0); } };
    window.__hubWs = ws; let n = 0;
    setTimeout(() => {
      if (window.__mode === 'down') { ws.readyState = 3; ws.onclose && ws.onclose({ code: 1006 }); return; }
      ws.readyState = 1; ws.onopen && ws.onopen(); const send = (o) => { if (ws.readyState === 1 && window.__mode === 'live') ws.onmessage && ws.onmessage({ data: JSON.stringify(o) }); };
      send({ event: 'hub_attached', state: 'live', tier: 'book' }); send({ event: 'status', state: 'live' });
      const m0 = Math.floor(Date.now() / 60000) * 60000, b = [];
      for (let k = 12; k >= 0; k--) { const o = 28000 + Math.sin(k) * 14; b.push([m0 - k * 60000, o, o + 11, o - 11, o + 3, 100]); }
      send({ type: 'bars', symbol: 'NQ', b });
      ws.pv = setInterval(() => send({ event: 'ping', up: 50, state: 'live' }), 5000);
      ws.bv = setInterval(() => {
        if (!window.__book) return;
        const mid = window.__px || 28000, now = Date.now(), step = 2.5, i0 = Math.floor(mid * 0.996 / step), len = Math.ceil(mid * 0.008 / step) + 2, v = new Array(len).fill(0);
        for (let k = 0; k < len; k++) { const p = (i0 + k + 0.5) * step, d = Math.abs(p - mid); const q = Math.round(30 + 25 * Math.abs(Math.sin(k * 1.7 + n / 40)) + Math.max(0, 200 - d * 4)); v[k] = p < mid ? q : -q; }
        const bid = Math.floor(mid * 4) / 4, ask = bid + 0.25, bids = [], asks = [];
        for (let j = 0; j < 150; j++) { bids.push([bid - j * 0.25, 5 + ((j * 7 + n) % 40)]); asks.push([ask + j * 0.25, 5 + ((j * 11 + n) % 40)]); }
        send({ type: 'snap', symbol: 'NQ', ts: now, bids, asks, imb: 0.1, imb10: 0.2 });
        if (n % 4 === 0) send({ type: 'coarse', symbol: 'NQ', ts: now, mid, bb: bid, ba: ask, step, i0, v });
      }, 250);
      ws.iv = setInterval(() => { n++; window.__px = Math.round((28000 + (window.__opens * 40) + (n % 40)) * 4) / 4; send({ type: 'ticks', symbol: 'NQ', t: [[window.__px, 1, n % 2 ? 1 : -1, Date.now()]] }); }, 150);
    }, 40);
    return ws;
  };
  window.WebSocket.OPEN = 1; window.WebSocket.CONNECTING = 0;
}

async function run(b, w, h, mobile, beta) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(stub); await ctx.addInitScript(fakeHub, { beta });
  await ctx.addInitScript((THEME) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); localStorage.setItem('stryker_theme', THEME); } catch (e) {} }, process.env.TG_THEME || 'night');
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:9\//, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  const p = await ctx.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await sleep(1500);
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1'); for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); if (ws.chart.market.symbol === 'futures:NQ1!' && ws.chart.orchestrator.rawBars.length) break; } });
  await p.waitForFunction(() => window.__stkL2Live && window.__stkL2Live.has('NQ'), null, { timeout: 30000 }).catch(() => {});
  if (beta) await p.evaluate(() => { const B = window.strykerBeta; if (B && B._set) B._set({ beta: true, admin: false }); else window.strykerBeta = { isBeta: () => true }; });   // the beta tester answer (assets/beta.js), as /api/beta/status would give it
  await sleep(2000);
  // a recorder in the page: every 100 ms, the time the painted close last changed; gaps between changes
  await p.evaluate(() => {
    const R = window.__rec = { last: null, at: Date.now(), gaps: [] };
    setInterval(() => { const rb = window.STRYKER_VELA.chart.orchestrator.rawBars, l = rb[rb.length - 1], c = l && (l.close != null ? l.close : l.c); const now = Date.now(); if (c !== R.last) { R.gaps.push([now, now - R.at]); R.last = c; R.at = now; } }, 100);
  });
  const gapsSince = (t0) => p.evaluate((t0) => window.__rec.gaps.filter((g) => g[0] > t0).map((g) => g[1]), t0);
  const now = () => p.evaluate(() => Date.now());
  const tag = (beta ? 'beta' : 'member') + (process.env.TG_THEME === 'day' ? '-day' : '') + '@' + w;
  // 1. steady
  let t0 = await now(); await sleep(15000);
  let g = await gapsSince(t0);
  check(g.length > 20 && Math.max(...g) <= 1000, tag + ': steady feed, max paint gap ' + Math.max(...g) + ' ms over ' + g.length + ' changes (<= 1000)', g.slice(-10));
  // 1b. heavy tools on (the member's screen: heatmap + DOM + depth heat on a live book): the candle still moves every second, no long task > 1 s
  if (!process.env.TG_LIGHT) {
    await p.evaluate(() => { window.__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ type: 'longtask' }); } catch (e) {} window.__book = true; });
    await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; for (const t of ['stk_fut_dom', 'stk_depth_heat']) { try { c.addNativeIndicator(t, { inputs: t === 'stk_fut_dom' ? { style: 'Combined (heatmap + depth + walls)' } : {} }); } catch (e) {} } window.STRYKER_VELA.context().stateChanged(); });
    await sleep(4000);
    const nInd = await p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.indicators().map((i) => i.nativeType || i.type || '').join(','));
    check(/stk_fut_dom/.test(nInd) && /stk_depth_heat/.test(nInd), tag + ': heavy tools mounted: ' + nInd, nInd);
    t0 = await now(); await sleep(15000);
    g = await gapsSince(t0);
    const lt = await p.evaluate(() => window.__lt.slice());
    check(g.length > 20 && Math.max(...g) <= 1000, tag + ': heatmap + DOM + depth heat on, max paint gap ' + Math.max(...g) + ' ms over ' + g.length + ' changes (<= 1000)', g.slice(-10));
    check(!lt.length || Math.max(...lt) < 1000, tag + ': heavy tools: ' + lt.length + ' long tasks, longest ' + (lt.length ? Math.max(...lt) : 0) + ' ms (< 1000)', lt.slice(-10));
  }
  // 2. three drops in a row, each after data
  for (let k = 1; k <= 3; k++) {
    t0 = await now();
    await p.evaluate(() => { const ws = window.__hubWs; ws.readyState = 3; clearInterval(ws.iv); clearInterval(ws.pv); clearInterval(ws.bv); ws.onclose && ws.onclose({ code: 1006 }); });
    await sleep(6000);
    g = await gapsSince(t0);
    const resume = g.length ? g[0] : 99999;
    check(resume <= 1600, tag + ': drop ' + k + ' -> candle moves again after ' + resume + ' ms (<= 1600)', g.slice(0, 5));
  }
  // 3. half-open: the socket stays "open" and says nothing
  t0 = await now();
  await p.evaluate(() => { window.__mode = 'silent'; });
  await sleep(300);
  await p.evaluate(() => { window.__mode = 'live'; const ws = window.__hubWs; clearInterval(ws.iv); clearInterval(ws.pv); clearInterval(ws.bv); });   // only that socket stays mute; a new one is live
  await sleep(16000);
  g = await gapsSince(t0);
  const resume = g.length ? g[0] : 99999;
  check(resume <= 14000, tag + ': half-open socket -> candle moves again after ' + resume + ' ms (<= 14000, was 20000 + backoff)', g.slice(0, 5));
  // 3b. a resync (tab back from hidden / focus after an absence / the Reconnect button): the chart re-subscribes. The forming candle must
  // keep moving within ~1 s AND keep its open / high / low (it used to restart from the next trade: open jumped, the wicks vanished)
  await sleep(1500);
  const before = await p.evaluate(() => { const rb = window.STRYKER_VELA.chart.orchestrator.rawBars, l = rb[rb.length - 1]; return { t: l.time, o: l.open, h: l.high, l: l.low }; });
  // the back-fill read is slow (2.4 s, as on a busy mobile link): the forming candle must not wait for it
  await p.route(/\/api\/chart\/bars\//, async (r) => { await sleep(2400); try { await r.continue(); } catch (e) {} });
  t0 = await now();
  await p.evaluate(async () => { const v = [...document.querySelectorAll('script[src*="?v="]')].map((s) => /\?v=(\d+)/.exec(s.src)).filter(Boolean)[0]; const m = await import('/assets/chart-live-resume.js?v=' + (v ? v[1] : '')); m.resyncAll(); });
  await sleep(5000);
  await p.unroute(/\/api\/chart\/bars\//);
  g = await gapsSince(t0);
  const after = await p.evaluate(() => { const rb = window.STRYKER_VELA.chart.orchestrator.rawBars, l = rb[rb.length - 1]; return { t: l.time, o: l.open, h: l.high, l: l.low }; });
  check(g.length && g[0] <= 1200 && Math.max(...g) <= 1200, tag + ': resync -> candle moves again after ' + (g.length ? g[0] : 99999) + ' ms, max gap ' + (g.length ? Math.max(...g) : 0) + ' ms (<= 1200)', g.slice(0, 6));
  check(after.t !== before.t || (after.o === before.o && after.h >= before.h && after.l <= before.l), tag + ': resync keeps the forming candle (open ' + before.o + ' -> ' + after.o + ', high ' + before.h + ' -> ' + after.h + ', low ' + before.l + ' -> ' + after.l + ')', { before, after });
  // 4. tooltip
  const tip = await p.evaluate(async () => { window.STRYKER_DATA_DOT.sync(); await new Promise((r) => requestAnimationFrame(r)); const d = document.querySelector('.stkc-dd'); return { tip: d && d.dataset.tip, tag: d && d.querySelector('.stkc-dd-t').textContent, gaps: window.__stkGaps && window.__stkGaps() }; });
  if (beta) {
    const nq = tip.gaps && tip.gaps.NQ;
    check(!!nq && nq.stalls >= 1 && nq.quiet === 0, tag + ': gap counter counted the stall, no false market pauses', tip.gaps);
    if (tip.tag === 'Live') check(/Data gaps \(30 min\): [1-9]\d* feed stall/.test(tip.tip || '') && !/market pause/.test(tip.tip || ''), tag + ': tooltip counts the stall: ' + tip.tip, tip);
    else console.log('NOTE ' + tag + ': status is ' + tip.tag + ' (CME clock), the gaps line shows only under Live: ' + tip.tip);
  } else check(!/Data gaps/.test(tip.tip || ''), tag + ': member tooltip has no data gaps line: ' + tip.tip, tip);
  // open the tooltip for the shot (hover on desktop, tap on phone)
  const box = await p.evaluate(() => { const r = document.querySelector('.stkc-dd').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  if (mobile) await p.touchscreen.tap(box.x, box.y); else await p.mouse.move(box.x, box.y);
  await sleep(400);
  const al = await p.evaluate(() => {
    const t = document.querySelector('.stkc-dd-tip'), r = t && !t.hidden ? t.getBoundingClientRect() : null;
    const cs = t && getComputedStyle(t), pad = cs ? [parseFloat(cs.paddingLeft), parseFloat(cs.paddingRight), parseFloat(cs.paddingTop), parseFloat(cs.paddingBottom)] : [];
    return { pad, padOk: pad.length === 4 && Math.abs(pad[0] - pad[1]) <= 1 && Math.abs(pad[2] - pad[3]) <= 1, shown: !!r, inView: !!r && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, clipped: !!t && t.scrollWidth > t.clientWidth + 1, hscroll: document.documentElement.scrollWidth > innerWidth };
  });
  check(al.shown && al.inView && !al.clipped && !al.hscroll && al.padOk, tag + ': tooltip shown inside the viewport, not clipped, no horizontal scroll, even padding ' + JSON.stringify(al.pad), al);
  await p.screenshot({ path: OUT + '/tickgap-' + tag.replace('@', '-') + '.png' });
  check(errors.length === 0, tag + ': no page errors', errors);
  await ctx.close();
}
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try { if (process.env.TG_ONLY === 'member') await run(b, 1440, 900, false, false); else if (process.env.TG_ONLY === 'beta') { await run(b, 1440, 900, false, true); await run(b, 390, 844, true, true); } else { await run(b, 1440, 900, false, true); await run(b, 390, 844, true, true); await run(b, 1440, 900, false, false); } }
  finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
