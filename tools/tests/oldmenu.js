// Opens the shared public header menus on 5 pages, dark + light, 1440 + 390. Fails on console errors,
// old bento panel, misaligned header items. Usage: node tools/tests/oldmenu.js <outdir> <base> <tag>
const { chromium } = require('playwright-core');
const lib = require('./lib');
const [out, base, tag] = [process.argv[2], process.argv[3] || lib.BASE, process.argv[4] || 'after'];
const pages = ['about', 'features', 'features/gex', 'download', 'help'];
(async () => {
  const b = await chromium.launch({ executablePath: lib.executablePath ? lib.executablePath() : undefined });
  let bad = 0; const fail = (m) => { bad++; console.log('FAIL', m); };
  for (const theme of ['dark', 'light']) for (const [w, h] of [[1440, 900], [390, 844]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w < 500 });
    await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); localStorage.setItem('stryker_cookie_ok', '1'); } catch (e) {} }, theme);
    for (const p of pages) {
      const pg = await ctx.newPage(); const errs = [];
      pg.on('pageerror', (e) => errs.push(String(e))); pg.on('console', (m) => { if (m.type() === 'error' && !/firebase|net::|Failed to load resource|gstatic|googleapis/i.test(m.text())) errs.push(m.text()); });
      await pg.goto(base + '/' + p + '.html', { waitUntil: 'load' }); await pg.waitForTimeout(700);
      const n = p.replace('/', '-') + '-' + w + '-' + theme + '-' + tag;
      await pg.screenshot({ path: `${out}/${n}-closed.png`, clip: { x: 0, y: 0, width: w, height: 160 } });
      const info = await pg.evaluate(() => ({ old: !!document.querySelector('.nfx-panel,.nfx-bento,.nfx-row,.nfx-chev'), hdr: !!document.querySelector('header.hn#site-nav'), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      if (tag === 'after') { if (info.old) fail(n + ' old panel'); if (!info.hdr) fail(n + ' no shared header'); if (info.sw > info.cw) fail(n + ' h-scroll ' + info.sw); }
      if (tag === 'after') {
        const m = await pg.evaluate(() => {
          const r = (s) => { const e = document.querySelector(s); if (!e || !e.offsetParent) return null; const b = e.getBoundingClientRect(); return { cy: b.top + b.height / 2, l: b.left, r: b.right, w: b.width, h: b.height }; };
          const sel = ['.hn-brand', '.hn-prod > summary', '.hn-links > a:nth-of-type(1)', '#theme', '.dl-pill-btn', '.hn-cta .btn-primary', '.hn-login', '#hn-tog'];
          const o = {}; sel.forEach((s) => { o[s] = r(s); });
          const hb = document.querySelector('.hn-in').getBoundingClientRect(); o.mid = hb.top + hb.height / 2;
          const sm = document.querySelector('.dl-pill-btn'); if (sm) { const ic = sm.querySelector('svg').getBoundingClientRect(), sp = sm.querySelector('span').getBoundingClientRect(), sb = sm.getBoundingClientRect(); o.dlpad = [Math.round(ic.left - sb.left), Math.round(sb.right - sm.querySelector('.dl-chev').getBoundingClientRect().right)]; }
          return o;
        });
        for (const k in m) if (m[k] && m[k].cy !== undefined && Math.abs(m[k].cy - m.mid) > 1) fail(`${n} ${k} centre off ${(m[k].cy - m.mid).toFixed(1)}`);
        if (m.dlpad && Math.abs(m.dlpad[0] - m.dlpad[1]) > 1) fail(n + ' download pill padding ' + m.dlpad);
      }
      if (tag === 'after') {
        if (w > 500) {
          await pg.hover('.hn-prod > summary'); await pg.waitForTimeout(500);
          const op = await pg.evaluate(() => { const d = document.querySelector('.hn-prod'); const m = d.querySelector('.hn-menu').getBoundingClientRect(); return [d.open, m.right <= innerWidth, m.bottom <= innerHeight, [...d.querySelectorAll('.hn-menu a')].length]; });
          if (!op[0] || !op[1] || !op[2] || op[3] !== 9) fail(n + ' products menu ' + op);
          await pg.screenshot({ path: `${out}/${n}-products.png` });
          await pg.mouse.move(700, 600); await pg.waitForTimeout(500);
          await pg.hover('.dl-pill-btn'); await pg.waitForTimeout(500);
          const dl = await pg.evaluate(() => { const d = document.querySelector('.dl-menu'); return [d.open, d.querySelectorAll('.dl-panel a svg').length, d.querySelector('.dl-panel').getBoundingClientRect().right <= innerWidth]; });
          if (!dl[0] || dl[1] < 5 || !dl[2]) fail(n + ' download menu ' + dl);
          await pg.screenshot({ path: `${out}/${n}-download.png` });
        } else {
          await pg.tap('#hn-tog'); await pg.waitForTimeout(400);
          await pg.screenshot({ path: `${out}/${n}-burger.png` });
          await pg.tap('.hn-prod > summary'); await pg.waitForTimeout(400);
          const bm = await pg.evaluate(() => [document.querySelector('.hn-prod').open, document.documentElement.scrollWidth <= innerWidth, !!document.querySelector('.hn-links.open')]);
          if (!bm.every(Boolean)) fail(n + ' burger ' + bm);
          await pg.screenshot({ path: `${out}/${n}-burger-products.png` });
        }
      } else {
        // before: just try opening whatever the old header offers
        if (w > 500) { await pg.hover('.nav-links a[href="/features"]').catch(() => {}); await pg.waitForTimeout(600); }
        else { await pg.tap('.nav-toggle').catch(() => {}); await pg.waitForTimeout(400); }
        await pg.screenshot({ path: `${out}/${n}-menu.png` });
      }
      if (errs.length) fail(n + ' console: ' + errs.slice(0, 3).join(' | '));
      await pg.close();
    }
    await ctx.close();
  }
  await b.close(); console.log(bad ? bad + ' FAILURES' : 'ALL OK'); process.exit(bad ? 1 : 0);
})();
