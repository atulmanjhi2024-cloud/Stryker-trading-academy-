// iPhone drawer test: topbar not clipped, drawer fits the viewport, no x-overflow,
// touch taps: in-place controls keep it open, a link tap closes it.
//   node tools/tests/ios-drawer-browser.js [outDir]     (starts its own server)
const http = require('http'), fs = require('fs'), path = require('path');
const { launch, ROOT } = require('./lib');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png' };
function serve() {
  return new Promise((res) => {
    const s = http.createServer((q, r) => {
      let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
      let f = path.join(ROOT, p);
      if (!path.extname(f) && fs.existsSync(f + '.html')) f += '.html';
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end('nf'); return; }
      r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
    }).listen(0, '127.0.0.1', () => res(s));
  });
}
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } else console.log('  ok   ' + m); };
const OUT = process.argv[2];
// What the live header carries once signed in: messages icon + avatar, injected the way the
// real scripts do (auth is blocked in this test).
const EXTRA = () => {
  const r = document.querySelector('.topnav-right'); if (!r) return;
  const m = document.createElement('div'); m.className = 'msg-icon-wrap';
  m.innerHTML = '<a href="messages.html" class="icon-btn" aria-label="Messages"><svg width="17" height="17" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg></a>';
  r.insertBefore(m, r.firstChild);
  const g = document.createElement('div'); g.className = 'gm-icon-wrap';
  g.innerHTML = '<a href="global-monitor.html" class="icon-btn" aria-label="Global"><svg width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg></a>';
  r.insertBefore(g, r.firstChild);
  const so = r.querySelector('[data-sign-out]'); if (so) so.remove();
  const a = document.createElement('div'); a.className = 'account-menu-wrap';
  a.innerHTML = '<button type="button" class="account-trigger" aria-label="Account menu"><div class="floor-avatar" style="width:34px;height:34px"></div></button>';
  r.appendChild(a);
};
(async () => {
  const srv = await serve(), BASE = 'http://127.0.0.1:' + srv.address().port;
  const b = await launch();
  const cases = [];
  for (const w of [320, 335, 360, 375, 390, 430]) for (const u of ['/gex.html', '/trade-journal.html', '/dashboard-user.html']) if (!(w < 360 && u === '/trade-journal.html')) cases.push([w, u]); // journal calendar overflows a few px under 360 (old, not iPhone)
  for (const [w, u] of cases) {
    const ctx = await b.newContext({ viewport: { width: w, height: 760 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const pg = await ctx.newPage();
    await pg.route('**/*', (r) => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
    await pg.addInitScript(() => localStorage.setItem('stryker_nav_authed', '1'));
    await pg.goto(BASE + u); await pg.waitForTimeout(900);
    await pg.evaluate(EXTRA); await pg.waitForTimeout(100);
    const tag = w + ' ' + u;
    await pg.tap('#dash-menu-toggle'); await pg.waitForTimeout(500);
    const m = await pg.evaluate(() => {
      const vw = innerWidth, vh = innerHeight;
      const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, cy: (r.top + r.bottom) / 2 }; };
      const items = [...document.querySelectorAll('.mobile-topnav .topnav-left > *, .mobile-topnav .topnav-right > *, .mobile-topnav > .mclock')].filter((e) => e.getClientRects().length).map(R);
      const icons = [...document.querySelectorAll('.mobile-topnav .topnav-right .icon-btn, .mobile-topnav .topnav-right .account-trigger, #dash-menu-toggle')].filter((e) => e.getClientRects().length).map(R);
      const sb = document.querySelector('.sidebar'), s = R(sb);
      return { vw, vh, open: sb.classList.contains('mobile-open'), maxR: Math.max(...items.map((i) => i.r)), minL: Math.min(...items.map((i) => i.l)),
        iconCy: Math.max(...icons.map((i) => i.cy)) - Math.min(...icons.map((i) => i.cy)), side: s, sh: sb.scrollHeight, ch: sb.clientHeight,
        sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, pill: document.querySelector('.mclock') ? R(document.querySelector('.mclock')) : null };
    });
    ok(m.open, tag + ': drawer open');
    ok(m.maxR <= m.vw - 8 + 0.5 && m.minL >= 8 - 0.5, tag + ': topbar inside viewport (L ' + m.minL.toFixed(0) + ' R ' + m.maxR.toFixed(0) + ')');
    ok(m.iconCy <= 1, tag + ': header icons share one centre (' + m.iconCy.toFixed(1) + 'px)');
    ok(m.side.b <= m.vh + 0.5 && m.side.l >= 0 && m.side.r <= m.vw, tag + ': drawer inside viewport (bottom ' + m.side.b.toFixed(0) + '/' + m.vh + ')');
    ok(m.sw <= m.vw && m.bw <= m.vw, tag + ': no horizontal overflow (' + m.sw + ')');
    ok(m.sh <= m.ch || (await pg.evaluate(() => { const s = document.querySelector('.sidebar'); s.scrollTop = 99999; return s.scrollTop > 0; })), tag + ': long menu scrolls');
    if (OUT && u === '/gex.html') await pg.screenshot({ path: path.join(OUT, 'ios-' + w + '-' + u.replace(/\W/g, '') + '.png') });
    if (w === 390 && u === '/gex.html') {
      const inPlace = (await pg.$$('.sidebar [aria-expanded]')).filter(Boolean); for (let i = inPlace.length - 1; i >= 0; i--) if (!(await inPlace[i].isVisible())) inPlace.splice(i, 1); ok(inPlace.length > 0, tag + ': has in-place controls');
      for (const el of inPlace.slice(0, 3)) { await el.scrollIntoViewIfNeeded(); await el.tap(); await pg.waitForTimeout(150); await el.tap(); await pg.waitForTimeout(150); ok(await pg.evaluate(() => document.querySelector('.sidebar').classList.contains('mobile-open')), tag + ': in-place control tap keeps drawer open'); }
      await pg.evaluate(() => { document.querySelector('.sidebar').scrollTop = 0; });
      await pg.route('**/phantom*', (r) => r.fulfill({ body: '<html>x</html>', contentType: 'text/html' }));
      const link = await pg.$('.sidebar a.side-link[href*="phantom"]');
      await link.scrollIntoViewIfNeeded(); await link.tap(); await pg.waitForTimeout(500);
      ok(!(await pg.evaluate(() => { const s = document.querySelector('.sidebar'); return s && s.classList.contains('mobile-open'); })), tag + ': link tap closes the drawer');
    }
    await ctx.close();
  }
  await b.close(); srv.close();
  console.log(fails ? fails + ' FAIL' : 'ALL OK'); process.exit(fails ? 1 : 0);
})();
