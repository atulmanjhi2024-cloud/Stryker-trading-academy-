// MQL5 indicators on the Charts page (assets/chart-mql5.js): editor tab, add to chart, buttons, inputs, timer, shots.
// Bars come from the fixture server (no live data):
//   node tools/tests/chart-fixture-server.mjs 8244 tools/tests/fixtures/monitor-live.json &
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8244 OUT=<dir> node tools/tests/chart-mql5-browser.js
// VIDEO=1 also records a screen video of the desktop run into OUT.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8244';
const OUT = process.env.OUT || '/tmp/mql5-shots';
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(b, { w, h, mobile, light, video }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile,
    recordVideo: video ? { dir: OUT, size: { width: 1280, height: 800 } } : undefined });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((light) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', light ? 'day' : 'night'); } catch (e) {} }, !!light);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|ERR_FAILED|404|Failed to load resource|ERR_CONNECTION/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_ZS && window.STRYKER_MQ5, null, { timeout: 90000 });
  await p.evaluate(() => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol('futures:NQ1!'); c.setTimeframe('15'); });
  await p.evaluate(async () => {
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); try { if (window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 50) break; } catch (e) {} }
  });
  await sleep(800);
  return { ctx, p, errors };
}
const chartOf = 'window.STRYKER_VELA.context().cells[0].chart';
const add = (p, i) => p.evaluate(async (i) => { const M = window.STRYKER_MQ5, x = M.examples[i]; M.open(); await M.load(x.name, x.source, null, 'example'); await M.addToChart();
  const e = document.querySelector('#stkc-mq5 .stkc-pine-err, #stkc-mq5 .sed-problems'); return { on: M.handles(window.STRYKER_VELA.context().cells[0].chart).map((h) => M.titleOf(h.source)), err: e && !e.hidden && /problem/.test(e.textContent) ? e.textContent.slice(0, 200) : '' }; }, i);
const modelOf = (p, title) => p.evaluate(([c, title]) => {
  const chart = eval(c);
  const h = window.STRYKER_MQ5.handles(chart).find((x) => window.STRYKER_MQ5.titleOf(x.source) === title); if (!h) return null;
  const rec = chart.orchestrator.registry.get(h.id); const m = rec && (rec.model || rec.lastModel);
  if (!m) return { id: h.id, keys: rec ? Object.keys(rec) : [] };
  const last = (s) => { const pts = s.points || s.bars || []; for (let i = pts.length - 1; i >= 0; i--) { const v = pts[i] && (pts[i].value != null ? pts[i].value : pts[i].close); if (v != null) return v; } return null; };
  return { id: h.id, series: m.series.map((s) => [s.title, s.kind, last(s)]), fills: m.fills.length, lines: m.lines.length, boxes: m.boxes.length, labels: m.labels.length, priceLines: m.priceLines.length, inputs: (m.inputs || []).map((i) => i.key + ':' + i.type), values: m.inputValues };
}, [chartOf, title]);

// ALIGNMENT GATE: the MQL5 editor header row + language switch
const gate = (p, tag) => p.evaluate(() => {
  const r = (e) => e.getBoundingClientRect(), out = [];
  const seg = document.querySelector('#stkc-mq5 .stkc-langseg');
  if (seg) {
    const bs = [...seg.querySelectorAll('.stkc-langseg-b')].map(r), sr = r(seg);
    const cy = bs.map((b) => b.top + b.height / 2);
    out.push(['seg centres', Math.max(...cy) - Math.min(...cy) <= 1]);
    out.push(['seg padding', Math.abs((bs[0].left - sr.left) - (sr.right - bs[bs.length - 1].right)) <= 1 && Math.abs((bs[0].top - sr.top) - (sr.bottom - bs[0].bottom)) <= 1]);
    out.push(['seg text fits', [...seg.querySelectorAll('.stkc-langseg-b')].every((b) => b.scrollWidth <= b.clientWidth + 1)]);
  }
  out.push(['no h-scroll', document.documentElement.scrollWidth <= window.innerWidth]);
  const btns = [...document.querySelectorAll('.mq5-button')].map(r);
  if (btns.length > 1) { const cy = btns.map((b) => b.top + b.height / 2); out.push(['buttons share a centre', Math.max(...cy) - Math.min(...cy) <= 1]); }
  [...document.querySelectorAll('.mq5-button')].forEach((b) => out.push(['button text fits ' + b.textContent, b.scrollWidth <= b.clientWidth + 1]));
  return out;
});

(async () => {
  const b = await launch();
  try {
    // ---------- desktop 1440 dark (+ video) ----------
    let { ctx, p, errors } = await open(b, { w: 1440, h: 900, video: !!process.env.VIDEO });
    // the editor's language switch has MQL5
    await p.evaluate(() => window.STRYKER_ZS.open());
    await sleep(400);
    let seg = await p.evaluate(() => [...document.querySelectorAll('#stkc-zs .stkc-langseg-b')].map((x) => x.textContent));
    check(seg.join() === 'Zscript,Pine (import),thinkScript,MQL5', 'language switch: ' + seg.join());
    await p.click('#stkc-zs .stkc-langseg-b[data-k="mql5"]');
    await p.waitForSelector('#stkc-mq5 .cm-editor', { timeout: 20000 });
    const st = await p.evaluate(() => ({ mq: !document.getElementById('stkc-mq5').hidden, zs: !document.getElementById('stkc-zs').hidden, on: (document.querySelector('#stkc-mq5 .stkc-langseg-b.on') || {}).textContent }));
    check(st.mq && !st.zs && st.on === 'MQL5', 'switch opens the MQL5 panel', st);
    // paste the MA-cross example (typed in through the editor API, like a paste)
    const r1 = await add(p, 0);
    check(!r1.err && r1.on.length === 1, 'MA cross added', r1);
    await sleep(1500);
    let m = await modelOf(p, r1.on[0]);
    check(m && m.series && m.series.length >= 2 && m.series.every((s) => s[2] != null || s[0] === ''), 'MA cross draws two lines', m);
    const before = m && m.series && m.series[0][2];
    await p.screenshot({ path: OUT + '/mql5-1440-dark-editor.png' });
    // buttons on the chart
    const btns = await p.evaluate(() => [...document.querySelectorAll('.mq5-button')].map((x) => [x.textContent, x.dataset.state, x.getBoundingClientRect().width | 0]));
    check(btns.length >= 2, 'on-chart buttons drawn', btns);
    // close the editor to see the chart, click the first button: OnChartEvent toggles a line
    await p.evaluate(() => window.STRYKER_MQ5.close());
    await sleep(500);
    const b0 = await p.$('.mq5-button');
    if (b0) await b0.click();
    await sleep(1200);
    const afterBtn = await p.evaluate(() => [...document.querySelectorAll('.mq5-button')].map((x) => [x.textContent, x.dataset.state]));
    check(JSON.stringify(afterBtn) !== JSON.stringify(btns.map((x) => [x[0], x[1]])), 'button click reached OnChartEvent (state/text changed)', afterBtn);
    const mBtn = await modelOf(p, r1.on[0]);
    console.log('model after click', JSON.stringify(mBtn && mBtn.series).slice(0, 200));
    await p.screenshot({ path: OUT + '/mql5-1440-dark-chart.png' });
    (await gate(p)).forEach(([k, ok]) => check(ok, 'GATE 1440 ' + k));
    // change an input: the fast period -> recompute
    const keys = m.inputs || [];
    const fastKey = (keys.find((k) => /fast/i.test(k)) || keys[0] || '').split(':')[0];
    await p.evaluate(([c, id, k]) => { const chart = eval(c); const h = chart.indicators().find((x) => x.id === id); const v = Object.assign({}, h.inputValues()); v[k] = (+v[k] || 9) + 11; h.setInputs ? h.setInputs(v) : h.updateInputs(v); }, [chartOf, m.id, fastKey]);
    await sleep(2000);
    const m2 = await modelOf(p, r1.on[0]);
    check(m2 && m2.series && m2.series[0][2] !== before, 'input change recomputes (' + fastKey + ')', [before, m2 && m2.series && m2.series[0][2]]);
    // the settings dialog lists the inputs
    // RSI separate window with levels, Bollinger fill, sessions, countdown (timer)
    for (const i of [1, 2, 3, 4]) { const r = await add(p, i); check(!r.err, 'example ' + i + ' added', r); }
    await p.evaluate(() => window.STRYKER_MQ5.close());
    await sleep(2500);
    const titles = await p.evaluate((c) => window.STRYKER_MQ5.handles(eval(c)).map((h) => window.STRYKER_MQ5.titleOf(h.source)), chartOf);
    check(titles.length === 5, '5 MQL5 indicators on the chart', titles);
    const rsi = await modelOf(p, titles[1]);
    check(rsi && rsi.priceLines >= 2, 'RSI has its 30/70 levels', rsi && rsi.priceLines);
    const bb = await modelOf(p, titles[2]);
    check(bb && bb.fills >= 1, 'Bollinger fill has a fill', bb && bb.fills);
    const ses = await modelOf(p, titles[3]);
    check(ses && ses.boxes >= 1, 'session boxes drawn', ses && [ses.boxes, ses.labels]);
    // timer: the countdown label text changes between two reads
    const lab = () => p.evaluate(() => [...document.querySelectorAll('.mq5-label, .mq5-comment')].map((x) => x.textContent).join('|'));
    const t1 = await lab(); await sleep(2300); const t2 = await lab();
    check(t1 !== t2 && t2.length > 0, 'timer ticks (countdown text changes)', [t1.slice(0, 80), t2.slice(0, 80)]);
    await p.screenshot({ path: OUT + '/mql5-1440-dark-all.png' });
    // workspace state keeps them
    const saved = await p.evaluate(() => JSON.stringify(window.STRYKER_VELA.context().serialize ? window.STRYKER_VELA.context().serialize() : '').includes('stryker.mql5'));
    console.log('INFO state has stryker.mql5: ' + saved);
    check(errors.length === 0, 'no page errors (1440 dark)', errors.slice(0, 5));
    // indicator window lists MQL5 rows
    const iw = await p.evaluate(async () => { const b = document.querySelector('#stkc-ind-btn, [data-act="indicators"], .stkchart-ind-btn'); if (b) b.click(); await new Promise((r) => setTimeout(r, 900)); const rows = [...document.querySelectorAll('.stkiw-row, [data-key]')].map((x) => x.textContent); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return rows.filter((t) => /MQL5/.test(t)).length; });
    console.log('INFO indicator window MQL5 rows: ' + iw);
    await ctx.close();

    // ---------- 1440 light ----------
    ({ ctx, p, errors } = await open(b, { w: 1440, h: 900, light: true }));
    await add(p, 0); await add(p, 1);
    await sleep(1500);
    await p.screenshot({ path: OUT + '/mql5-1440-light-editor.png' });
    await p.evaluate(() => window.STRYKER_MQ5.close()); await sleep(600);
    await p.screenshot({ path: OUT + '/mql5-1440-light-chart.png' });
    check(errors.length === 0, 'no page errors (1440 light)', errors.slice(0, 5));
    await ctx.close();

    // ---------- 390 phone dark + light ----------
    for (const light of [false, true]) {
      ({ ctx, p, errors } = await open(b, { w: 390, h: 844, mobile: true, light }));
      const tag = light ? 'light' : 'dark';
      await p.evaluate(() => window.STRYKER_MQ5.open()); await p.waitForSelector('#stkc-mq5 .cm-editor', { timeout: 20000 }); await sleep(500);
      await p.screenshot({ path: OUT + '/mql5-390-' + tag + '-editor.png' });
      (await gate(p)).forEach(([k, ok]) => check(ok, 'GATE 390 ' + tag + ' ' + k));
      const r = await add(p, 0);
      check(!r.err, '390 ' + tag + ' MA cross added', r);
      await p.evaluate(() => window.STRYKER_MQ5.close()); await sleep(1500);
      await p.screenshot({ path: OUT + '/mql5-390-' + tag + '-chart.png' });
      (await gate(p)).forEach(([k, ok]) => check(ok, 'GATE 390 ' + tag + ' chart ' + k));
      check(errors.length === 0, 'no page errors (390 ' + tag + ')', errors.slice(0, 5));
      await ctx.close();
    }
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
