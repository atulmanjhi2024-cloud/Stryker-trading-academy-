// Import levels: the review sheet on the real charts page (Sample data, offline).
// Opens it from the chart's right-click menu, loads a fixture screenshot, checks the review list,
// the alignment gate, the text/Pine tab, Add (horizontal lines + "Imported levels" group, one undo)
// and that nothing reaches the chart before Add. Shots: 1440 + 390, dark + light.
//   flock /tmp/stryker-chrome.lock node tools/tests/levels-import-sheet-browser.js <outDir>
const path = require('path');
const fs = require('fs');
const R = require('./bt-rig.js');
const OUT = process.argv[2] || process.env.TMPDIR || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const FX = path.join(__dirname, 'fixtures', 'levels');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };

// alignment gate, measured inside the open sheet
const gate = (p) => p.evaluate(() => {
  const r = (e) => e.getBoundingClientRect(), mid = (b) => b.top + b.height / 2, vis = (e) => e && e.offsetParent && r(e).width > 0;
  const out = { ovf: document.documentElement.scrollWidth - innerWidth, bad: [] };
  const box = document.querySelector('.stkli'); const bb = r(box);
  if (bb.left < -0.5 || bb.right > innerWidth + 0.5) out.bad.push('sheet off screen');
  // header row: title, tabs, close share one centre
  const hd = [...document.querySelectorAll('.stkli-title, .stkli-x')].filter(vis);
  if (hd.length === 2 && Math.abs(mid(r(hd[0])) - mid(r(hd[1]))) > 1) out.bad.push('header centres ' + hd.map((e) => mid(r(e)).toFixed(1)));
  // icons centred in their buttons
  for (const b of document.querySelectorAll('.stkli-x, .stkli-del')) { if (!vis(b)) continue; const s = b.querySelector('svg'); const a = r(b), c = r(s);
    if (Math.abs((a.left + a.right) / 2 - (c.left + c.right) / 2) > 1 || Math.abs(mid(a) - mid(c)) > 1) out.bad.push('icon off-centre in ' + b.className); }
  // review rows: checkbox, swatch, inputs, delete share one centre; price right-aligned tabular
  for (const row of document.querySelectorAll('.stkli-row')) {
    const kids = [...row.querySelectorAll('.stkli-ck, .stkli-sw, .stkli-p, .stkli-l, .stkli-del')].filter(vis); if (!kids.length) continue;
    const m = kids.map((k) => mid(r(k))); if (Math.max(...m) - Math.min(...m) > 1) out.bad.push('row centres ' + m.map((v) => v.toFixed(1)));
  }
  const p0 = document.querySelector('.stkli-p'); if (p0) { const cs = getComputedStyle(p0); if (cs.textAlign !== 'right' || !/tabular/.test(cs.fontVariantNumeric)) out.bad.push('price not right/tabular'); }
  // buttons: even padding, text not clipped
  for (const b of document.querySelectorAll('.stkli .stkli-btn, .stkli-seg button')) { if (!vis(b)) continue;
    const cs = getComputedStyle(b); if (Math.abs(parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) > 1) out.bad.push('uneven padding ' + b.textContent);
    if (b.scrollWidth > b.clientWidth + 1) out.bad.push('clipped ' + b.textContent); }
  // footer: buttons share one centre
  const ft = [...document.querySelectorAll('.stkli-foot .stkli-btn')].filter(vis);
  if (ft.length === 2 && Math.abs(mid(r(ft[0])) - mid(r(ft[1]))) > 1) out.bad.push('footer centres');
  return out;
});

async function openFromMenu(p) {
  const cv = await p.evaluate(() => { const e = document.querySelector('#vela-chart canvas'); const b = e.getBoundingClientRect(); return { x: b.left + b.width * 0.45, y: b.top + b.height * 0.45 }; });
  await p.mouse.click(cv.x, cv.y, { button: 'right' }); await sleep(500);
  const item = await p.evaluateHandle(() => [...document.querySelectorAll('[role=menuitem]')].find((e) => e.offsetParent && /^Import levels/.test(e.textContent.trim())));
  if (!item.asElement()) return false;
  await item.asElement().click(); await sleep(400);
  return true;
}

(async () => {
  const srv = await R.serve(); const b = await R.launch();
  try {
    for (const [dev, theme] of [['desktop', 'dark'], ['desktop', 'light'], ['phone', 'dark'], ['phone', 'light']]) {
      const tag = (dev === 'phone' ? '390' : '1440') + '-' + theme;
      const { ctx, p, errors } = await R.page(b, srv, dev, (t) => { try { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1'); } catch (e) {} });
      await ctx.addInitScript(`try{localStorage.setItem('stryker_theme','${theme === 'light' ? 'day' : 'night'}')}catch(e){}`);
      await ctx.route(/\/api\/chart\/bars\//, (r) => { const now = Math.floor(Date.now() / 1000); const bars = R.bars(now - 86400 * 3, now).map((x) => [Math.floor(x[0] / 1000), x[1], x[2], x[3], x[4], x[5]]); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ bars }) }); });
      await require('./binance-mock.js').install(ctx);   // BTCUSDT (the default chart) offline
      await p.goto(srv.base + '/charts.html', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.STRYKER_VELA && window.__stkImportLevels && window.STRYKER_VELA.chart.renderer.renderer.bars.length > 10, null, { timeout: 40000 }).catch(() => {});
      await sleep(1500);
      // one drawing of the member's own, before the import: it must survive the import's undo
      await p.evaluate(() => { const ch = window.STRYKER_VELA.chart, bs = ch.renderer.renderer.bars, l = bs[bs.length - 1]; ch.drawings.add('hline', { anchors: [{ time: l.time, price: l.close }] }); });
      const n0 = await p.evaluate(() => window.STRYKER_VELA.chart.drawings.all().length);
      const u0 = await p.evaluate(() => window.STRYKER_VELA.active.history.undoStack.length);
      // open: right-click on desktop, the shared entry (drawings sheet / column) on the phone
      let opened = false;
      if (dev === 'desktop') { opened = await openFromMenu(p); check(opened, tag + ': right-click menu has "Import levels" and it opens the sheet'); }
      if (!opened) await p.evaluate(() => window.__stkImportLevels());
      await p.waitForSelector('.stkli', { timeout: 5000 });
      check(await p.evaluate(() => !!document.querySelector('.stkli-drop')), tag + ': starts on the screenshot drop area');
      const txt0 = await p.evaluate(() => document.querySelector('.stkli').innerText);
      check(!/tradingview|ninja|sierra|thinkorswim|luxalgo|vela/i.test(txt0), tag + ': no platform names in the sheet');
      check(await p.evaluate(() => !window.Tesseract && ![...performance.getEntriesByType('resource')].some((e) => /eng\.traineddata/.test(e.name))), tag + ': OCR not loaded before a picture is given');
      await p.screenshot({ path: path.join(OUT, 'li-' + tag + '-start.png') });
      // screenshot -> review
      await p.setInputFiles('.stkli input[type=file]', path.join(FX, 'a-dark-solid-boxes.png'));
      await p.waitForSelector('.stkli-row .stkli-p', { timeout: 60000 });
      await sleep(400);
      const rev = await p.evaluate(() => ({ prices: [...document.querySelectorAll('.stkli-row')].filter((r) => r.querySelector('.stkli-ck').checked).map((r) => r.querySelector('.stkli-p').value), warn: [...document.querySelectorAll('.stkli-warn')].map((e) => e.textContent), lines: document.querySelectorAll('.stkli-prev svg line').length, add: document.querySelector('.stkli-add').textContent }));
      for (const want of [21525.25, 21487.5, 21442.75, 21401]) check(rev.prices.some((v) => Number(v.replace(/,/g, '')) === want), tag + ': review lists ' + want, rev.prices);
      check(rev.lines >= 4, tag + ': detected lines drawn over the screenshot', rev.lines);
      check(rev.warn.some((w) => /far from|another market/i.test(w)), tag + ': warns that NQ-range levels do not match this chart', rev.warn);
      check(/^Add \d+ levels? to chart$/.test(rev.add), tag + ': button says Add N levels to chart', rev.add);
      check(await p.evaluate(() => window.STRYKER_VELA.chart.drawings.all().length) === n0, tag + ': chart untouched before Add');
      const g = await gate(p); check(g.ovf <= 0 && !g.bad.length, tag + ': alignment gate (review)', g);
      await p.screenshot({ path: path.join(OUT, 'li-' + tag + '-review.png') });
      // edit a price, delete a row, add a row
      const nRows = await p.evaluate(() => document.querySelectorAll('.stkli-row').length);
      await p.fill('.stkli-row:nth-child(1) .stkli-p', '21530.123'); await p.press('.stkli-row:nth-child(1) .stkli-p', 'Tab');
      check(Number((await p.inputValue('.stkli-row:nth-child(1) .stkli-p')).replace(/,/g, '')) === 21530.12, tag + ': edited price rounds to the tick (0.01)');
      await p.click('.stkli-row:nth-child(2) .stkli-del');
      check(await p.evaluate(() => document.querySelectorAll('.stkli-row').length) === nRows - 1, tag + ': delete removes the row');
      await p.click('.stkli-addrow'); await p.keyboard.type('21600'); await p.keyboard.press('Tab');
      check(await p.evaluate(() => document.querySelectorAll('.stkli-row').length) === nRows, tag + ': Add a level adds a row');
      // text tab
      await p.click('.stkli-seg [data-tab=text]');
      await p.fill('.stkli-ta', '//@version=5\nindicator("x")\nhline(21450, "PDH")\nline.new(bar_index, 21500.25, bar_index+1, 21500.25)\n');
      await p.click('.stkli-ta-row .stkli-btn'); await p.waitForSelector('.stkli-row .stkli-p');
      const tv = await p.evaluate(() => [...document.querySelectorAll('.stkli-row')].map((r) => [r.querySelector('.stkli-p').value.replace(/,/g, ''), r.querySelector('.stkli-l').value]));
      tv.sort((a, b2) => a[0] - b2[0]);
      check(tv.length === 2 && Number(tv[0][0]) === 21450 && tv[0][1] === 'PDH' && Number(tv[1][0]) === 21500.25, tag + ': Pine hline/line.new read', tv);
      await p.click('.stkli-again'); await p.fill('.stkli-ta', '');
      const ref = await p.evaluate(() => { const bs = window.STRYKER_VELA.chart.renderer.renderer.bars; return bs[bs.length - 1].close; });
      const lv = [Math.round(ref) + 100, Math.round(ref) - 100.5];
      await p.fill('.stkli-ta', lv[0] + ' PDH\n' + lv[1] + ' PDL');
      await p.click('.stkli-ta-row .stkli-btn'); await p.waitForSelector('.stkli-row .stkli-p');
      check(await p.evaluate(() => !document.querySelector('.stkli-warn')), tag + ': no range warning when levels match the chart');
      const g2 = await gate(p); check(g2.ovf <= 0 && !g2.bad.length, tag + ': alignment gate (text review)', g2);
      await p.screenshot({ path: path.join(OUT, 'li-' + tag + '-text.png') });
      await p.click('.stkli-add'); await sleep(600);
      const after = await p.evaluate((n0) => { const ch = window.STRYKER_VELA.chart; const all = ch.drawings.all(); const t = window.STRYKER_VELA.objectTree; const grp = t && t.groupsPerChart && (t.groupsPerChart.get(ch) || []).filter((g) => /^imp-/.test(g.id)); return { added: all.slice(n0).map((d) => [d.type, d.anchors[0].price]), open: !!document.querySelector('.stkli'), grp: grp && grp.map((g) => [g.name, g.ids.length]) }; }, n0);
      check(!after.open && after.added.length === 2 && after.added.every((x) => x[0] === 'hline'), tag + ': Add puts 2 horizontal lines on the chart and closes', after);
      check(after.added.map((x) => x[1]).sort().join() === lv.slice().sort().join(), tag + ': at the pasted prices', after.added);
      check(!after.grp || (after.grp.length === 1 && /^Imported levels /.test(after.grp[0][0]) && after.grp[0][1] === 2), tag + ': grouped as "Imported levels <date>"', after.grp);
      const hs = await p.evaluate(() => { const h = window.STRYKER_VELA.active.history; const n = h.undoStack.length; h.undo(); return n; });
      await sleep(400);
      check(await p.evaluate(() => window.STRYKER_VELA.chart.drawings.all().length) === n0, tag + ': one undo removes the whole import', hs);
      check(hs === u0 + 1, tag + ': the import is exactly one undo step', { before: u0, after: hs });
      check(n0 >= 1, tag + ': the member\'s own line is still there after the undo');
      if (dev === 'desktop') await p.screenshot({ path: path.join(OUT, 'li-' + tag + '-after-undo.png') });
      check(!errors.filter((e) => !/Firebase|firestore|WebSocket|websocket/i.test(e)).length, tag + ': no page errors', errors.slice(0, 3));
      await ctx.close();
    }
  } finally { await b.close(); srv.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
