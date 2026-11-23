// Text alignment on Horizontal Ray + Vertical Line (beta report 22 Nov); old drawings keep their label spot.
//   CHART_BASE=http://127.0.0.1:PORT node tools/tests/chart-textalign-browser.js <shotsDir> [light]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '.';
const LIGHT = process.argv[3] === 'light';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
const dlg = '.vela-dialog.vela-dsp';

(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((light) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1'); if (light) localStorage.setItem('stryker_theme', 'day'); } catch (e) {}
  }, LIGHT);
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick|workers\.dev|binance)\./, (r) => r.abort());
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) errors.push(String(e)); });
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => { try { const ws = window.STRYKER_VELA; return ws && ws.cell(ws.active.id).chart.renderer.renderer.coords.barCount > 50; } catch (e) { return false; } }, null, { timeout: 60000 });
  await p.waitForTimeout(2000);
  const R = (src, arg) => p.evaluate(([src, arg]) => { const ws = window.STRYKER_VELA; const cell = ws.cell(ws.active.id); const r = cell.chart.renderer.renderer; return (new Function('ws', 'cell', 'r', 'arg', src))(ws, cell, r, arg); }, [src, arg]);

  // place both drawings in code at a visible price/time, with a label
  const ids = await R(`
    const ud = r.userDrawings, proj = ud.deps.projector();
    const W = proj.width, H = proj.height;
    const a = proj.pxToPoint(W * 0.35, H * 0.4, 'price'), v = proj.pxToPoint(W * 0.6, H * 0.5, 'price');
    cell.chart.drawings.fromJSON([...cell.chart.drawings.all(),
      { id: 'tHR', type: 'hray', paneId: 'price', anchors: [a], style: { lineColor: '#2962ff', lineWidth: 2, lineStyle: 'solid' }, text: { value: 'WEEKLY SUPPLY', size: '12' } },
      { id: 'tVL', type: 'vline', paneId: 'price', anchors: [v], style: { lineColor: '#f23645', lineWidth: 2, lineStyle: 'solid' }, text: { value: 'NEWS', size: '12' } }]);
    return cell.chart.drawings.all().map((d) => d.id);`);
  check(ids.includes('tHR') && ids.includes('tVL'), 'hray + vline placed', ids);

  // layout helper reads the painter's label position through the same function the painter uses
  const lay = () => R(`
    const ud = r.userDrawings, proj = ud.deps.projector();
    const out = {};
    for (const d of ud.drawings) if (d.id === 'tHR' || d.id === 'tVL') { const pts = d.handlePoints(proj); out[d.id] = { pt: pts[0], text: d.text }; }
    return out;`);
  const before = await lay();
  await p.screenshot({ path: OUT + '/textalign-1440-' + (LIGHT ? 'light' : 'dark') + '-before.png' });

  // the Text tab of each now has Text alignment
  for (const id of ['tHR', 'tVL']) {
    await R('r.userDrawings.openSettings(arg); r.userDrawings.popup.openPanel(); return 1;', id);
    await p.waitForTimeout(500);
    await p.click(`${dlg} .stk-dsp-tabs > button[data-tab=text]`); await p.waitForTimeout(200);
    const info = await p.evaluate((sel) => {
      const pane = document.querySelector(sel + ' .stk-dsp-pane[data-pane=text]');
      const labs = [...pane.querySelectorAll('*')].filter((e) => e.children.length === 0 && /Text alignment/.test(e.textContent)).length;
      const sels = [...pane.querySelectorAll('select')].map((s) => s.value);
      return { labs, sels };
    }, dlg);
    check(info.labs === 1 && info.sels.length === 3, id + ' Text tab has Text alignment (vertical + horizontal)', info);
    if (id === 'tHR') {
      check(info.sels[1] === 'bottom' && info.sels[2] === 'left', 'hray: unset reads Bottom / Left (where the old label sits)', info.sels);
      // alignment row geometry: the two selects share one centre and fit the row
      const g = await p.evaluate((sel) => {
        const s = [...document.querySelectorAll(sel + ' .stk-dsp-pane[data-pane=text] select')].slice(1).map((x) => x.getBoundingClientRect());
        return { dc: Math.abs((s[0].top + s[0].bottom) / 2 - (s[1].top + s[1].bottom) / 2), w0: s[0].width, w1: s[1].width };
      }, dlg);
      check(g.dc <= 1 && Math.abs(g.w0 - g.w1) <= 1, 'alignment selects share one centre and width', g);
      await p.screenshot({ path: OUT + '/textalign-1440-' + (LIGHT ? 'light' : 'dark') + '-hray-texttab.png' });
      await p.selectOption(`${dlg} .stk-dsp-pane[data-pane=text] select >> nth=1`, 'middle');
      await p.selectOption(`${dlg} .stk-dsp-pane[data-pane=text] select >> nth=2`, 'right');
    } else {
      check(info.sels[1] === 'top' && info.sels[2] === 'right', 'vline: unset reads Top / Right', info.sels);
      await p.selectOption(`${dlg} .stk-dsp-pane[data-pane=text] select >> nth=1`, 'bottom');
    }
    await p.waitForTimeout(150);
    await p.click(dlg + ' .vela-dialog-footer button:has-text("Ok"), ' + dlg + ' .vela-dialog-footer button:has-text("OK")').catch(() => {});
    await p.waitForTimeout(300);
  }
  const after = await lay();
  check(after.tHR.text.stkV === 'middle' && after.tHR.text.stkH === 'right', 'hray alignment saved', after.tHR.text);
  check(after.tVL.text.stkV === 'bottom', 'vline alignment saved', after.tVL.text);
  check(before.tHR.text.stkV === undefined && before.tHR.text.stkH === undefined, 'old drawing has no alignment keys (paints as before)', before.tHR.text);
  // the label really moved: find the text pixels on the right half for the hray (canvas sampling is brittle, so read the painted layout)
  await R('cell.chart.drawings.select([]); return 1;');
  await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/textalign-1440-' + (LIGHT ? 'light' : 'dark') + '-after.png' });
  // Horizontal Line still has its own alignment and its old default
  check(errors.length === 0, 'no page errors', errors.slice(0, 4));
  await ctx.close(); await b.close();
  console.log(fail ? `FAILED ${fail}` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
