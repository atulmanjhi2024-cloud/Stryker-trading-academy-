// Day/Night switch changes the site chrome only; chart canvas pixels stay. Run: node tools/tests/chart-themesplit-browser.js <shotsDir>
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '.';
let fail = 0, d1, d2, d3;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 200))); };
const ready = (p) => p.waitForFunction(() => { try { const ws = window.STRYKER_VELA; return ws && ws.cell(ws.active.id).chart.renderer.renderer.coords.barCount > 20; } catch (e) { return false; } }, null, { timeout: 60000 });
let dp = null;   // decodes both PNGs in a blank page (no image lib needed)
const diff = async (a, b) => dp.evaluate(async ([x, y]) => { const px = async (u) => { const im = await createImageBitmap(await (await fetch('data:image/png;base64,' + u)).blob()); const c = new OffscreenCanvas(im.width, im.height), g = c.getContext('2d'); g.drawImage(im, 0, 0); return g.getImageData(0, 0, im.width, im.height).data; }; const A = await px(x), B = await px(y); if (A.length !== B.length) return 999; let s = 0; for (let i = 0; i < A.length; i += 4) s += (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2])) / 3; return s / (A.length / 4); }, [a.toString('base64'), b.toString('base64')]);
(async () => {
  const b = await launch(); dp = await b.newPage(); await dp.goto('about:blank');
  for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
    for (const [site, chart] of [['night', 'dark'], ['night', 'light'], ['day', 'dark']]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
      await ctx.addInitScript(stub);
      await ctx.addInitScript(([s, c]) => { try { localStorage.setItem('stryker_theme', s); localStorage.setItem('stryker_chart_theme', c); localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1'); } catch (e) {} }, [site, chart]);
      await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
      const p = await ctx.newPage(); const errs = [];
      p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) errs.push(String(e)); });
      await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' }); await ready(p); await p.waitForTimeout(3000);
      const area = async () => { const r = await p.evaluate(() => { const ws = window.STRYKER_VELA; const host = ws.cell(ws.active.id).host || document.querySelector('.vela-cell'); const c = [...host.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0].getBoundingClientRect(); return { x: c.left + 20, y: c.top + 20, width: c.width - 120, height: c.height - 130 }; }); return p.screenshot({ clip: r }); };
      const tag = `${w}-${site}-${chart}`;
      const bg = () => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const a0 = await area(); const bg0 = await bg();
      await p.screenshot({ path: `${OUT}/ts-${tag}-1.png` });
      await p.evaluate((s) => window.setStrykerTheme(s), site === 'night' ? 'day' : 'night'); await p.waitForTimeout(1500);
      const a1 = await area(); const bg1 = await bg();
      await p.screenshot({ path: `${OUT}/ts-${tag}-2.png` });
      check(bg0 !== bg1, `${tag}: site chrome changed`, [bg0, bg1]);
      check((d1 = await diff(a0, a1)) < 0.5, `${tag}: chart pixels unchanged after switch`, d1);
      await p.evaluate((s) => window.setStrykerTheme(s), site); await p.waitForTimeout(1500);
      const a2 = await area();
      check((d2 = await diff(a0, a2)) < 0.5, `${tag}: chart unchanged after switching back`, d2);
      await p.reload({ waitUntil: 'domcontentloaded' }); await ready(p); await p.waitForTimeout(3000);
      const a3 = await area();
      check((d3 = await diff(a0, a3)) < 1, `${tag}: reload keeps chart`, d3);
      check(errs.length === 0, `${tag}: no page errors`, errs);
      await ctx.close();
    }
  }
  await b.close(); process.exit(fail ? 1 : 0);
})();
