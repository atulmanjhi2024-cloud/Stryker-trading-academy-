// Free pan (upstream 0.10.6 port, vela-0.9.0-s15): off by default (a drag moves time only, the price axis stays auto);
// switched on under chart settings > Scales and lines, a mouse drag moves time and price together; saved charts without
// the key load as off. Shots of the settings row at 1440 / 390, dark + light.
//   CHART_BASE=http://127.0.0.1:PORT tools/chrome-slot.sh node tools/tests/chart-freepan-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '.';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };

const STATE = () => { const ws = window.STRYKER_VELA, c = ws.cell(ws.active.id).chart, rr = c.renderer.renderer, pane = rr.scene.panes ? [...rr.scene.panes.values()][0] : null;
  const cfg = rr.getConfig ? rr.getConfig() : null;
  return { manual: !!(pane && pane.manualScale), scale: pane ? [pane.scale.min, pane.scale.max] : null, ro: rr.coords.getViewport().rightOffset, fp: cfg && cfg.priceScale.freePan, input: rr.input && rr.input.freePan }; };

(async () => {
  const b = await launch();
  for (const [w, h, theme] of [[1440, 900, 'dark'], [1440, 900, 'light'], [390, 844, 'dark'], [390, 844, 'light']]) {
    const tag = `${w}-${theme}`;
    const ctx = await b.newContext(w < 700 ? { viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: w, height: h } });
    await ctx.addInitScript(stub);
    await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); for (const k of ['stryker_install_prompt_shown_u1', 'stryker_push_prompt_shown_u1', 'stryker_community_disclaimer_ack_v1']) localStorage.setItem(k, '1'); } catch (e) {} }, theme);
    await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) errors.push(String(e).slice(0, 200)); });
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => { try { const ws = window.STRYKER_VELA; return ws.cell(ws.active.id).chart.renderer.renderer.coords.barCount > 20; } catch (e) { return false; } }, null, { timeout: 90000 });
    await p.waitForTimeout(1200);
    const s0 = await p.evaluate(STATE);
    check(s0.fp === false && s0.input === false, `${tag}: free pan is off by default`, s0);
    const box = await p.evaluate(() => { const ws = window.STRYKER_VELA, rr = ws.cell(ws.active.id).chart.renderer.renderer, r = rr.dataCanvas.getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.45 }; });
    if (w >= 700) {
      const drag = async () => { await p.mouse.move(box.x, box.y); await p.mouse.down(); for (let i = 1; i <= 10; i++) await p.mouse.move(box.x - 8 * i, box.y + 8 * i); await p.mouse.up(); await p.waitForTimeout(300); };
      await drag();
      const s1 = await p.evaluate(STATE);
      check(!s1.manual && s1.ro !== s0.ro, `${tag}: off: a drag moves time only (price axis stays auto)`, s1);
    }
    // settings dialog: the row, then switch on
    await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.cell(ws.active.id).chart.renderer.openSettings(); });
    await p.waitForTimeout(800);
    await p.evaluate(() => { const t = [...document.querySelectorAll('.vela-dialog--settings .vela-sd-tab')].find((b) => /^Scales/.test(b.textContent.trim())); if (t) t.click(); });
    await p.waitForTimeout(500);
    const row = await p.evaluate(() => { const r = document.querySelector('[data-sd-id="scales.price-scale.free-pan"]');
      if (!r) return null; r.scrollIntoView({ block: 'center' }); const q = r.getBoundingClientRect(); const kids = [...r.querySelectorAll('*')].filter((k) => k.children.length === 0 && k.getBoundingClientRect().width > 0).map((k) => { const z = k.getBoundingClientRect(); return [k.tagName, Math.round((z.top + z.height / 2 - (q.top + q.height / 2)) * 10) / 10, z.right <= q.right + 0.5]; });
      return { text: r.textContent.trim(), h: q.height, kids, sx: document.documentElement.scrollWidth - innerWidth }; });
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/freepan-${tag}-settings.png` });
    check(row && /^Free pan/.test(row.text), `${tag}: "Free pan" row under Scales and lines`, row);
    check(row && row.kids.every((k) => Math.abs(k[1]) <= 1.5 || k[0] === 'path' || k[0] === 'svg') && row.kids.every((k) => k[2]), `${tag}: row items share one centre, nothing overflows`, row);
    check(row && row.sx <= 0, `${tag}: no horizontal scroll`, row && row.sx);
    await p.evaluate(() => { const r = document.querySelector('[data-sd-id="scales.price-scale.free-pan"]'); const i = r && r.querySelector('input, [role="switch"], button'); if (i) i.click(); });
    await p.waitForTimeout(300);
    await p.keyboard.press('Escape').catch(() => {});
    await p.evaluate(() => { const ok = [...document.querySelectorAll('button')].find((b) => /^ok$/i.test(b.textContent.trim()) && b.getBoundingClientRect().width); if (ok) ok.click(); });
    await p.waitForTimeout(500);
    const s2 = await p.evaluate(STATE);
    check(s2.fp === true && s2.input === true, `${tag}: switch turns free pan on`, s2);
    if (w >= 700) {
      await p.mouse.move(box.x, box.y); await p.mouse.down(); for (let i = 1; i <= 10; i++) await p.mouse.move(box.x - 8 * i, box.y + 8 * i); await p.mouse.up(); await p.waitForTimeout(300);
      const s3 = await p.evaluate(STATE);
      check(s3.manual && s3.scale[0] !== s2.scale[0] && s3.ro !== s2.ro, `${tag}: on: one drag moves time and price`, { s2, s3 });
      // a plain click still does not freeze the scale (reset first)
      await p.evaluate(() => { const ws = window.STRYKER_VELA, rr = ws.cell(ws.active.id).chart.renderer.renderer; [...rr.scene.panes.values()][0].manualScale = null; rr.scheduler.invalidate(4); });
      await p.mouse.click(box.x, box.y); await p.waitForTimeout(200);
      check(!(await p.evaluate(STATE)).manual, `${tag}: a click leaves the scale auto`);
      // saved in the workspace state, restored on reload
      await p.waitForTimeout(1500);
      await p.reload({ waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => { try { const ws = window.STRYKER_VELA; return ws.cell(ws.active.id).chart.renderer.renderer.coords.barCount > 20; } catch (e) { return false; } }, null, { timeout: 90000 });
      await p.waitForTimeout(800);
      check((await p.evaluate(STATE)).fp === true, `${tag}: on survives a reload`);
      // switch back off for the next run of this profile
      await p.evaluate(() => { const ws = window.STRYKER_VELA, rr = ws.cell(ws.active.id).chart.renderer.renderer; rr.applyConfig({ priceScale: { freePan: false } }); });
    }
    check(!errors.length, `${tag}: no page errors`, errors);
    await ctx.close();
  }
  await b.close();
  console.log(fail ? `FAILED ${fail}` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
