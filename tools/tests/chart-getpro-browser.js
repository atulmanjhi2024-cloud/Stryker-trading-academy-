// "Get Pro free" pill on the ZoroCharts top bar. flock /tmp/stryker-chrome.lock node tools/tests/chart-getpro-browser.js [shotsDir]
const http = require('http'), fs = require('fs'), path = require('path');
const { launch, ROOT } = require('./lib.js');
const stub = require('./richstub.js');
const OUT = process.argv[2] || '/tmp/getpro'; fs.mkdirSync(OUT, { recursive: true });
let fail = 0; const ck = (ok, m) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + m); };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png' };
const srv = http.createServer((q, r) => {
  let p = path.join(ROOT, decodeURIComponent(new URL(q.url, 'http://x').pathname));
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p) && fs.existsSync(p + '.html')) p += '.html';
  if (!fs.existsSync(p) || !p.startsWith(ROOT)) { r.writeHead(404); r.end('nf'); return; }
  r.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r);
});
const PLAN = (who) => () => {   // runs after the stub: change what students/u1 says
  const o = window.__stubDb.collection;
  const mode = window.__WHO;
  window.__stubDb.collection = (n) => { const c = o(n); if (n !== 'students') return c; const od = c.doc;
    c.doc = (id) => { const d = od(id); if (mode === 'free') d.get = () => Promise.resolve({ id, exists: true, data: () => ({ uid: 'u1', plan: 'Starter', name: 'Test Trader', referralCode: 'test1234' }) });
      if (mode === 'expired') d.get = () => Promise.resolve({ id, exists: true, data: () => ({ uid: 'u1', plan: 'Pro', planSource: 'referral', subscriptionStatus: 'active', paidThroughMillis: Date.now() - 864e5 }) });
      return d; }; return c; };
};
(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const BASE = 'http://127.0.0.1:' + srv.address().port;
  const b = await launch();
  async function page(who, w, h, theme) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript(stub);
    await ctx.addInitScript((a) => { window.__WHO = a.who; try { localStorage.setItem('stryker_theme', a.t); } catch (e) {} }, { who, t: theme === 'light' ? 'day' : 'night' });
    await ctx.addInitScript(PLAN().toString().replace(/^\(\) => /, '').replace(/^\{/, '(() => {').replace(/\}$/, '})()'));
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await ctx.route(/\/api\//, (r) => r.fulfill({ json: {} }));
    const p = await ctx.newPage();
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => document.querySelector('#stkc-paper-btn'), null, { timeout: 40000 }).catch(() => {});
    await p.waitForTimeout(1500);
    return { ctx, p };
  }
  const rect = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e || !e.offsetWidth) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height, cy: (r.top + r.bottom) / 2 }; }, sel);
  // Pro hidden
  let s = await page('pro', 1440, 900, 'dark'); ck(!(await rect(s.p, '#stk-getpro')), 'Pro member: pill hidden'); await s.ctx.close();
  s = await page('expired', 1440, 900, 'dark'); ck(!!(await rect(s.p, '#stk-getpro')), 'expired referral Pro: pill shown'); await s.ctx.close();
  for (const theme of ['dark', 'light']) {
    s = await page('free', 1440, 900, theme); const p = s.p;
    const g = await rect(p, '#stk-getpro'), t = await rect(p, '#stkc-paper-btn'), m = await rect(p, '.mclock-pill');
    ck(!!g && !!t, theme + ' 1440: free member sees pill + Trade');
    if (g && t) { ck(Math.abs(g.cy - t.cy) <= 1 && g.h === t.h, 'height/centre match Trade ' + JSON.stringify([g.h, t.h, g.cy, t.cy])); ck(Math.abs((t.l - g.r) - 8) <= 1, 'gap 8px: ' + (t.l - g.r)); ck(g.r <= t.l, 'no overlap'); }
    await p.screenshot({ path: OUT + '/bar-1440-' + theme + '.png', clip: { x: 700, y: 0, width: 740, height: 120 } });
    if (theme === 'dark') {
      await p.click('#stk-getpro'); await p.waitForSelector('#stk-getpro-ov:not([hidden])');
      const fr = p.frameLocator('#stk-getpro-ov iframe');
      await fr.locator('.refx-hero').waitFor({ timeout: 20000 }).catch(() => {});
      await p.waitForTimeout(1500);
      const info = await p.evaluate(() => { const f = document.querySelector('#stk-getpro-ov iframe'), d = f.contentDocument; const vis = (s) => { const e = d.querySelector(s); return !!e && e.offsetWidth > 0; };
        return { hero: vis('.refx-hero'), side: vis('.sidebar'), dock: vis('.appnav-dock'), link: (d.body.innerText.match(/https?:\/\/\S+/) || [''])[0], txt: /\$|cash|commission/i.test(d.body.innerText) }; });
      ck(info.hero, 'modal shows referrals hero'); ck(!info.side && !info.dock, 'embed hides site chrome'); console.log('link:', info.link, 'money words:', info.txt);
      await p.screenshot({ path: OUT + '/modal-1440-dark.png' });
      await p.keyboard.press('Escape'); await p.waitForTimeout(200);
      ck(await p.evaluate(() => document.getElementById('stk-getpro-ov').hidden), 'Esc closes');
      await p.click('#stk-getpro'); await p.mouse.click(10, 10); await p.waitForTimeout(200);
      ck(await p.evaluate(() => document.getElementById('stk-getpro-ov').hidden), 'outside click closes');
      await p.click('#stk-getpro'); await p.click('.stk-getpro-x'); ck(await p.evaluate(() => document.getElementById('stk-getpro-ov').hidden), 'X closes');
    }
    await s.ctx.close();
  }
  for (const w of [1500, 1440, 1280, 1100, 960]) {
    s = await page('free', w, 800, 'dark'); const g = await rect(s.p, '#stk-getpro'), t = await rect(s.p, '#stkc-paper-btn'), m = await rect(s.p, '.mclock-pill');
    console.log(w, 'getpro', g && [g.l | 0, g.r | 0, g.w], 'trade', t && [t.l | 0, t.r | 0], 'sess', m && [m.l | 0, m.r | 0], 'cy', g && t && [g.cy, t.cy]);
    ck(!g || !t || (g.r <= t.l && Math.abs(g.cy - t.cy) <= 1), w + ': pill clear of Trade, centred');
    ck(!t || !m || t.r <= m.l, w + ': Trade clear of session');
    if (w === 960 || w === 1100) await s.p.screenshot({ path: OUT + '/bar-' + w + '.png', clip: { x: 0, y: 0, width: w, height: 120 } });
    await s.ctx.close();
  }
  for (const theme of ['dark', 'light']) {
    s = await page('free', 390, 844, theme); const p = s.p;
    const g = await rect(p, '#stk-getpro'); console.log('390 pill', g);
    console.log('390 pill in DOM:', await p.evaluate(() => !!document.getElementById('stk-getpro'))); await p.evaluate(() => window.__stkGetPro.open()); { await p.waitForTimeout(2500); const sh = await rect(p, '.stk-getpro-sheet'); console.log('sheet', sh); ck(sh && sh.w >= 389 && sh.h >= 843, '390: full-height sheet');
      ck(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '390: no horizontal scroll'); await p.screenshot({ path: OUT + '/modal-390-' + theme + '.png' }); }
    
    await s.ctx.close();
  }
  await b.close(); srv.close(); console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
