// thinkScript editor + chart test, against tools/tests/chart-dev-server.mjs (needs the dev server's futures bars).
//   CHART_BASE=http://localhost:8031 node tools/tests/chart-thinkscript-browser.js [shotsDir]
// Run under the Chrome lock: flock /tmp/stryker-chrome.lock node tools/tests/chart-thinkscript-browser.js
// Covers: language switch (Zscript | Pine | thinkScript), paste a study, Add to chart, plots reach the chart model, change an
// input in the settings dialog and see the values recompute, a line-numbered error, the not-supported line, the real
// worker lock-down (fetch / importScripts gone), the indicator window rows, reload persistence, ALIGNMENT GATE measures,
// screenshots 1440 + 390 dark/light.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://localhost:8031';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };

async function open(b, { w, h, mobile, light }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((light) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', light ? 'day' : 'night'); } catch (e) {} }, !!light);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/WebSocket connection|ERR_FAILED|\[vela\] indicator "ind-\d+" failed|404|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_PINE && window.STRYKER_ZS && window.STRYKER_TS, null, { timeout: 60000 });
  await p.evaluate(() => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol('futures:ES1!'); c.setTimeframe('15'); });
  await p.evaluate(async () => {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 400));
      if (window.STRYKER_VELA.context().cells.every((c) => { try { return c.chart.orchestrator.rawBars.length > 0; } catch (e) { return false; } })) break;
    }
  });
  await p.waitForTimeout(800);
  return { ctx, p, errors };
}
const chart0 = 'window.STRYKER_VELA.context().cells[0].chart';
const tsOn = (p) => p.evaluate(() => window.STRYKER_TS.handles(window.STRYKER_VELA.context().cells[0].chart).map((h) => window.STRYKER_TS.titleOf(h.source)));
const openTs = (p) => p.evaluate(async () => { window.STRYKER_TS.open(); for (let i = 0; i < 80 && !document.querySelector('#stkc-ts .cm-editor'); i++) await new Promise((r) => setTimeout(r, 100)); });
// paste into the real editor (clipboard-style insert), then press Add to chart
async function paste(p, name, src) {
  await openTs(p);
  await p.evaluate(async ({ name, src }) => { await window.STRYKER_TS.load(name, '', null, 'new'); }, { name, src });
  await p.click('#stkc-ts .cm-content');
  await p.evaluate((src) => {
    const dt = new DataTransfer(); dt.setData('text/plain', src);
    document.querySelector('#stkc-ts .cm-content').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, src);
  await p.fill('#stkc-ts .sed-name, #stkc-ts input[type="text"]', name).catch(() => {});
}
async function addNow(p) {
  await p.evaluate(() => window.STRYKER_TS.addToChart());
  await p.waitForTimeout(600);
  return p.evaluate(() => { const e = document.querySelector('#stkc-ts .stkc-pine-err'); return { err: !e || e.hidden ? '' : e.textContent.trim(), marks: document.querySelectorAll('#stkc-ts .cm-lintRange-error').length }; });
}
const modelOf = (p, title) => p.evaluate((title) => {
  const c = window.STRYKER_VELA.context().cells[0].chart, ins = c.inspect();
  const x = ins.indicators.find((i) => i.title === title);
  return x ? { title: x.title, series: x.series, pane: x.paneId || x.pane || null } : null;
}, title);
// last value of a plot, straight from the chart's indicator model
const lastVal = (p, title, plot) => p.evaluate(({ title, plot }) => {
  const c = window.STRYKER_VELA.context().cells[0].chart;
  const h = window.STRYKER_TS.handles(c).find((x) => window.STRYKER_TS.titleOf(x.source) === title);
  if (!h) return null;
  const m = c.orchestrator.registry.get(h.id);
  const mdl = m && (m.model || m.lastModel);
  const s = mdl && mdl.series.find((x) => x.title === plot);
  if (!s) return null;
  for (let i = s.points.length - 1; i >= 0; i--) if (s.points[i].value != null) return s.points[i].value;
  return null;
}, { title, plot });

// ALIGNMENT GATE on the open thinkScript panel
const align = (p) => p.evaluate(() => {
  const R = (e) => e.getBoundingClientRect(), out = [];
  const cy = (r) => r.top + r.height / 2;
  const P = document.getElementById('stkc-ts');
  const seg = P.querySelector('.stkc-langseg'), bs = [...P.querySelectorAll('.stkc-langseg-b')];
  if (seg && bs.length) {
    const s = R(seg), ys = bs.map((b) => cy(R(b)));
    out.push(['lang switch: one centre line', Math.max(...ys) - Math.min(...ys) <= 1]);
    const padL = R(bs[0]).left - s.left, padR = s.right - R(bs[bs.length - 1]).right, padT = R(bs[0]).top - s.top, padB = s.bottom - R(bs[0]).bottom;
    out.push(['lang switch: even padding ' + [padL, padR, padT, padB].map((x) => x.toFixed(1)).join('/'), Math.abs(padL - padR) <= 1 && Math.abs(padT - padB) <= 1]);
    out.push(['lang switch: labels not clipped', bs.every((b) => b.scrollWidth <= b.clientWidth + 1)]);
    out.push(['lang switch: stays inside the header', R(seg).right <= R(P).right + 0.5]);
  }
  const ft = [...P.querySelectorAll('.sed-ft > .sed-btn, .sed-ft > button')].filter((b) => b.offsetParent);
  if (ft.length) { const ys = ft.map((b) => cy(R(b))); out.push(['footer buttons: one centre line', Math.max(...ys) - Math.min(...ys) <= 1]); }
  const icons = [...P.querySelectorAll('.sed-ib')].filter((b) => b.offsetParent && b.querySelector('svg'));
  out.push(['icon buttons: icon centred', icons.every((b) => { const a = R(b), s = R(b.querySelector('svg')); return Math.abs((a.left + a.right) / 2 - (s.left + s.right) / 2) <= 1 && Math.abs(cy(a) - cy(s)) <= 1; })]);
  const rows = [...P.querySelectorAll('.sed-pane:not([hidden]) .sed-row')].filter((r) => r.offsetParent);
  out.push(['library rows: names not overflowing', rows.every((r) => { const n = r.querySelector('.sed-row-nm'); return !n || R(n).right <= R(r).right + 0.5; })]);
  if (rows.length > 2) { const g = rows.slice(1).map((r, i) => R(r).top - R(rows[i]).bottom); out.push(['library rows: even gaps', Math.max(...g) - Math.min(...g) <= 1]); }
  out.push(['no horizontal page scroll', document.documentElement.scrollWidth <= innerWidth]);
  return out;
});
const toolbarOk = (p) => p.evaluate(() => {
  const bar = document.querySelector('.stkchart-toolbar, .stkc-bar, #stkc-bar') || document.querySelector('.stkchart-bar');
  const pine = document.getElementById('stkc-pine-btn'), tpl = document.querySelector('[id*="tpl"], .stkc-tpl, [aria-label*="emplate"]');
  const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.right <= innerWidth && r.left >= 0; };
  return { moved: !!pine && !!pine.closest('[class*=more], [id*=more], [role=menu]'), pine: vis(pine), tpl: vis(tpl), oneRow: bar ? bar.scrollWidth <= bar.clientWidth + 1 : true };
});

const RSI_SRC = [
  '# Pasted RSI study',
  'declare lower;',
  'input length = 14;',
  'input price = close;',
  'input averageType = AverageType.WILDERS;',
  'input showLabel = yes;',
  'plot R = RSI(length = length, price = price, averageType = averageType);',
  'plot Hi = 70;',
  'plot Lo = 30;',
  'R.SetLineWeight(2);',
  'R.AssignValueColor(if R > 70 then Color.RED else if R < 30 then Color.GREEN else Color.CYAN);',
  'Hi.SetStyle(Curve.SHORT_DASH);',
  'Lo.SetStyle(Curve.SHORT_DASH);',
  'AddLabel(showLabel, "RSI " + Round(R, 1), Color.CYAN);',
  ''
].join('\n');

(async () => {
  const b = await launch();
  try {
    // ---------- 1440 dark ----------
    let { ctx, p, errors } = await open(b, { w: 1440, h: 900 });
    await p.evaluate(() => window.STRYKER_PINE.open());
    await p.waitForTimeout(300);
    const seg = await p.evaluate(() => [...document.querySelectorAll('#stkc-pine .stkc-langseg-b')].map((x) => x.textContent + (x.classList.contains('on') ? '*' : '')));
    check(seg.join() === 'Zscript,Pine (import)*,thinkScript', 'Pine panel switch has thinkScript: ' + seg.join());
    await p.click('#stkc-pine .stkc-langseg-b[data-k="ts"]');
    await p.waitForSelector('#stkc-ts .cm-editor', { timeout: 20000 });
    const st = await p.evaluate(() => ({ ts: !document.getElementById('stkc-ts').hidden, pine: !document.getElementById('stkc-pine').hidden, zs: !document.getElementById('stkc-zs').hidden,
      seg: [...document.querySelectorAll('#stkc-ts .stkc-langseg-b')].map((x) => x.textContent + (x.classList.contains('on') ? '*' : '')).join(),
      ex: [...document.querySelectorAll('#stkc-ts .sed-pane:not([hidden]) .sed-row')].map((x) => x.querySelector('.sed-row-nm').textContent + '|' + ((x.querySelector('.sed-badge') || {}).textContent || '')) }));
    check(st.ts && !st.pine && !st.zs, 'switch opens thinkScript and closes the others');
    check(st.seg === 'Zscript,Pine (import),thinkScript*', 'thinkScript panel switch: ' + st.seg);
    check(st.ex.length === 5 && st.ex.every((x) => /\|Example$/.test(x)), '5 examples labelled Example: ' + st.ex.join(' ; '));
    // switch back to Zscript and forth again
    await p.click('#stkc-ts .stkc-langseg-b[data-k="zs"]');
    await p.waitForTimeout(300);
    check(await p.evaluate(() => !document.getElementById('stkc-zs').hidden && document.getElementById('stkc-ts').hidden), 'switch to Zscript closes thinkScript');
    await p.click('#stkc-zs .stkc-langseg-b[data-k="ts"]');
    await p.waitForTimeout(300);
    // paste + add
    await paste(p, 'Pasted RSI', RSI_SRC);
    await p.waitForTimeout(1500);
    const prob = await p.evaluate(() => (document.querySelector('#stkc-ts .sed-prob-hd') || {}).textContent || '');
    check(/Checked OK/.test(prob), 'live check says OK: ' + prob.trim());
    let r = await addNow(p);
    check(!r.err, 'pasted study added: ' + r.err);
    await p.waitForTimeout(1500);
    let on = await tsOn(p);
    check(on.includes('Pasted RSI'), 'study on the chart: ' + on.join());
    check(await p.evaluate(() => window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.context().cells[0].chart).length) === 0, 'Pine list does not take thinkScript handles');
    const m = await modelOf(p, 'Pasted RSI');
    check(!!m && Object.values(m.series || {}).reduce((a, b) => a + b, 0) >= 3, 'plots reached the chart model ' + JSON.stringify(m));
    const v1 = await lastVal(p, 'Pasted RSI', 'R');
    check(typeof v1 === 'number' && v1 > 0 && v1 < 100, 'RSI value on the chart: ' + v1);
    // inputs -> settings dialog
    const ins = await p.evaluate(() => { const h = window.STRYKER_TS.handles(window.STRYKER_VELA.context().cells[0].chart)[0]; return h.inputs.map((i) => i.title + ':' + i.type + (i.options ? '[' + i.options.length + ']' : '')); });
    check(ins.join() === 'length:int,price:source[8],averageType:string[5],showLabel:bool', 'inputs for the settings dialog: ' + ins.join());
    await p.evaluate(() => window.STRYKER_TS.close());
    const id = await p.evaluate(() => window.STRYKER_TS.handles(window.STRYKER_VELA.context().cells[0].chart)[0].id);
    await p.evaluate((id) => window.STRYKER_VELA.context().cells[0].chart.renderer.openIndicatorSettings(id), id);
    await p.waitForSelector('.vela-ind-dialog', { timeout: 10000 });
    await p.waitForTimeout(400);
    const dlg = await p.evaluate(() => [...document.querySelectorAll('.vela-ind-dialog [id^="vela-inp-"]')].map((e) => e.tagName.toLowerCase() + ':' + (e.type || e.getAttribute('role') || '')));
    check(dlg.length >= 4 && dlg.some((x) => /select|combobox|button/.test(x)), 'dialog fields (stepper, dropdowns, switch): ' + dlg.join());
    await p.screenshot({ path: `${OUT}/ts-1440-dark-settings.png` });
    const sel = '.vela-ind-dialog [id="vela-inp-' + id + '-0"]';
    await p.click(sel, { clickCount: 3 }); await p.keyboard.type('3', { delay: 60 }); await p.press(sel, 'Tab');
    await p.evaluate(() => { const b = [...document.querySelectorAll('.vela-ind-dialog button')].find((x) => /^ok$/i.test(x.textContent.trim())); if (b) b.click(); });
    await p.waitForTimeout(1500);
    const v2 = await lastVal(p, 'Pasted RSI', 'R');
    const iv = await p.evaluate(() => window.STRYKER_TS.handles(window.STRYKER_VELA.context().cells[0].chart)[0].inputValues()['0']);
    check(iv === 3 && typeof v2 === 'number' && v2 !== v1, 'changing length to 3 recomputes: ' + v1 + ' -> ' + v2 + ' (input ' + iv + ')');
    await p.screenshot({ path: `${OUT}/ts-1440-dark-chart.png` });
    // a line-numbered error and the not-supported line
    await paste(p, 'Bad', 'input n = 5;\nplot a = Average(close, n);\nplot b = Averag(close, n);\n');
    r = await addNow(p);
    check(/^Line 3:10 .*Unknown function/.test(r.err) && r.marks >= 1, 'error with line:col + inline mark: ' + r.err + ' marks=' + r.marks);
    await p.screenshot({ path: `${OUT}/ts-1440-dark-error.png` });
    await paste(p, 'Strategy', 'AddOrder(OrderType.BUY_TO_OPEN, close > open);\n');
    r = await addNow(p);
    check(/^Line 1:1 .*not supported/i.test(r.err), 'AddOrder gives one not-supported line: ' + r.err);
    on = await tsOn(p);
    check(on.length === 1, 'failed studies left nothing on the chart: ' + on.join());
    // examples run (one with AggregationPeriod.DAY through the chart's own bars)
    for (const k of [0, 3, 4]) {
      await p.evaluate(async (k) => { const T = window.STRYKER_TS; await T.load(T.examples[k].name, T.examples[k].source, null, 'example'); }, k);
      r = await addNow(p);
      check(!r.err, 'example ' + k + ' runs: ' + r.err);
    }
    await p.waitForTimeout(2500);
    const daily = await lastVal(p, 'Trend bars with a daily average', 'DailyAverage');
    check(typeof daily === 'number' && daily > 0, 'daily-period values reached the chart: ' + daily);
    // the real worker is locked down
    const lock = await p.evaluate(async () => {
      const w = new Worker('/assets/ts/worker.js?v=' + document.querySelector('meta[name="stryker-build"]').content, { type: 'module' });
      const got = await new Promise((res) => { w.onmessage = (e) => { if (e.data && e.data.type === 'ready') res('ready'); }; setTimeout(() => res('timeout'), 8000); });
      // a message that is not part of the protocol is ignored; a study cannot reach fetch: the name is just an unknown thinkScript function
      const out = await new Promise((res) => { w.onmessage = (e) => { if (e.data && e.data.id === 7) res(e.data); }; w.postMessage({ type: 'run', id: 7, source: 'plot x = fetch("https://example.com");', bars: { time: [1, 2], open: [1, 1], high: [1, 1], low: [1, 1], close: [1, 1], volume: [1, 1] } }); setTimeout(() => res(null), 8000); });
      w.terminate();
      return { got, msg: out && out.out && out.out.error && out.out.error.message };
    });
    check(lock.got === 'ready' && /Unknown function/.test(lock.msg || ''), 'worker starts and member text never reaches JS: ' + JSON.stringify(lock));
    const killed = await p.evaluate(async () => {
      const { TsRunner } = await import('/assets/ts/runner.js?v=' + document.querySelector('meta[name="stryker-build"]').content);
      const r = new TsRunner();
      const n = 50000, b = { time: [], open: [], high: [], low: [], close: [], volume: [] };
      for (let i = 0; i < n; i++) { b.time.push(i * 6e4); b.open.push(1); b.high.push(1); b.low.push(1); b.close.push(1); b.volume.push(1); }
      await r.analyze('plot x = 1;');   // worker up
      let settled = false; const pr = r.run({ source: 'plot a = fold i = 0 to 20000 with s do s + (fold j = 0 to 20000 with q do q + 1);', bars: b }).then(() => { settled = true; }, () => { settled = true; });
      await new Promise((res) => setTimeout(res, 3000));
      const before = settled; const t0 = Date.now(); r.dispose(); await pr;
      return { before, ms: Date.now() - t0, gone: r.w === null };
    });
    check(!killed.before && killed.gone && killed.ms < 1000, 'no time limit: a long study keeps running until removed (dispose ends it): ' + JSON.stringify(killed));
    // indicator window rows
    await p.evaluate(() => window.STRYKER_TS.close());
    await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
    await p.waitForTimeout(800);
    const tab = await p.$('.stkiw-tab[data-k="zscript"]');
    if (tab) { await tab.click(); await p.waitForTimeout(300); }
    const rows = await p.evaluate(() => [...document.querySelectorAll('.stkiw-row .stkiw-nm')].map((x) => x.textContent));
    check(rows.includes('New thinkScript study') && rows.includes('MACD histogram'), 'indicator window lists thinkScript rows: ' + rows.filter((x) => /thinkScript|MACD|RSI with zones and/.test(x)).join(', '));
    await p.keyboard.press('Escape');
    // persistence
    const stj = await p.evaluate(() => JSON.stringify(window.STRYKER_VELA.getState()));
    check(/stryker\.thinkscript/.test(stj) && /Pasted RSI/.test(stj), 'studies saved in the workspace state');
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.STRYKER_TS && window.STRYKER_VELA, null, { timeout: 60000 });
    await p.waitForTimeout(6000);
    on = await tsOn(p);
    check(on.includes('Pasted RSI') && on.length === 4, 'reload restores the studies: ' + on.join(', '));
    const kept = await p.evaluate(() => { const h = window.STRYKER_TS.handles(window.STRYKER_VELA.context().cells[0].chart).find((x) => /Pasted RSI/.test(x.source)); return h ? h.inputValues()['0'] : null; });
    check(kept === 3, 'reload keeps the changed input: ' + kept);
    // editor shot with an example open + alignment gate
    await openTs(p);
    await p.evaluate(async () => { const T = window.STRYKER_TS; await T.load(T.examples[1].name, T.examples[1].source, null, 'example'); });
    await p.waitForTimeout(1200);
    for (const [k, ok] of await align(p)) check(ok, '1440 ALIGN ' + k);
    await p.screenshot({ path: `${OUT}/ts-1440-dark.png` });
    await p.evaluate(() => window.STRYKER_TS.close());
    for (const w of [1440, 1280, 1024]) {
      await p.setViewportSize({ width: w, height: 900 }); await p.waitForTimeout(400);
      const t = await toolbarOk(p);
      check((t.pine || t.moved) && t.oneRow, w + ': toolbar one row, script button visible ' + JSON.stringify(t));
    }
    check(errors.length === 0, 'no page errors: ' + errors.slice(0, 3).join(' || '));
    await ctx.close();

    // ---------- 1440 light ----------
    ({ ctx, p, errors } = await open(b, { w: 1440, h: 900, light: true }));
    await openTs(p);
    await p.evaluate(async () => { const T = window.STRYKER_TS; await T.load(T.examples[2].name, T.examples[2].source, null, 'example'); await T.addToChart(); });
    await p.waitForTimeout(2000);
    await openTs(p);
    await p.waitForTimeout(600);
    check(await p.evaluate(() => document.documentElement.dataset.theme === 'light'), 'light theme on');
    for (const [k, ok] of await align(p)) check(ok, '1440 light ALIGN ' + k);
    await p.screenshot({ path: `${OUT}/ts-1440-light.png` });
    check(errors.length === 0, 'light: no page errors: ' + errors.slice(0, 3).join(' || '));
    await ctx.close();

    // ---------- phones ----------
    for (const [w, light] of [[390, false], [390, true], [412, false]]) {
      ({ ctx, p, errors } = await open(b, { w, h: 844, mobile: true, light }));
      await openTs(p);
      await p.waitForTimeout(600);
      const g = await p.evaluate(() => {
        const pn = document.getElementById('stkc-ts').getBoundingClientRect();
        const btns = [...document.querySelectorAll('#stkc-ts .sed-ft > .sed-btn')].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect());
        return { l: pn.left, r: pn.right, vw: innerWidth, vh: innerHeight, bb: btns.length ? Math.max(...btns.map((b) => b.bottom)) : 0, bh: btns.length ? Math.min(...btns.map((b) => b.height)) : 0, docW: document.documentElement.scrollWidth };
      });
      check(g.l <= 0 && g.r >= g.vw - 1 && g.docW <= g.vw, w + (light ? ' light' : '') + ': full-width sheet, no sideways scroll ' + JSON.stringify(g));
      check(g.bb <= g.vh && g.bh >= 40, w + ': buttons visible and >= 40 px high');
      for (const [k, ok] of await align(p)) check(ok, w + (light ? ' light' : '') + ' ALIGN ' + k);
      const tag = w + '-' + (light ? 'light' : 'dark');
      await p.screenshot({ path: `${OUT}/ts-${tag}.png` });
      if (w === 390) {
        const rr = await p.evaluate(async () => { await window.STRYKER_TS.addToChart(); return { open: !document.getElementById('stkc-ts').hidden, n: window.STRYKER_TS.handles(window.STRYKER_VELA.context().cells[0].chart).length }; });
        await p.waitForTimeout(1800);
        check(!rr.open && rr.n === 1, w + ': Add to chart adds and closes the sheet ' + JSON.stringify(rr));
        await p.screenshot({ path: `${OUT}/ts-${tag}-chart.png` });
      }
      check(errors.length === 0, w + ': no page errors: ' + errors.slice(0, 3).join(' || '));
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
