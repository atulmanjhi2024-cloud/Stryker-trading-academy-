// Beta page + Report a bug button (browser). Firebase and /api/beta/* are stubbed; everything else non-local is aborted.
// Shots (390 + 1440, dark + light) go to the outdir. Also measures the alignment gate (centres, padding, no horizontal scroll).
//   python3 -m http.server 8000 --directory .   (in another shell)   node tools/tests/beta-browser.js [outdir]
const fs = require('fs'), path = require('path');
const { launch, BASE } = require('./lib');
const OUT = process.argv[2] || '/tmp/beta-shots'; fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const check = (l, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + l.padEnd(58) + ' ' + JSON.stringify(got) + (ok ? '' : '  (want ' + JSON.stringify(want) + ')')); };
const ok = (l, c, extra) => check(l + (extra ? ' ' + extra : ''), !!c, true);

function stub(cfg) {
  const body = function (CFG) {
    const snap = (id, d) => ({ id, exists: !!d, data: () => d || {}, ref: {} });
    const DATA = { 'students/u1': { name: 'Test Trader', plan: 'Starter', residenceCountry: 'US', sanctionsAttest: true }, 'plans/free': { name: 'Starter', rank: 0 }, 'settings/pageAccess': {}, 'profiles/u1': { beta: true }, 'admins/u1': { role: 'admin' }, 'settings/betaTesters': { emails: ['alpha@example.com', 'beta@example.com'] } };
    const empty = { empty: true, size: 0, docs: [], forEach() {} };
    const colRef = (col) => ({ doc: (id) => ({ id, get: () => Promise.resolve(snap(id, DATA[col + '/' + id])), set: () => Promise.resolve(), update: () => Promise.resolve(), onSnapshot: (cb) => { setTimeout(() => cb(snap(id, DATA[col + '/' + id])), 10); return () => {}; }, collection: (s) => colRef(col + '/' + id + '/' + s) }),
      get: () => Promise.resolve(empty), where: () => colRef(col), orderBy: () => colRef(col), limit: () => colRef(col), onSnapshot: (cb) => { setTimeout(() => cb(empty), 10); return () => {}; } });
    const db = { collection: colRef, batch: () => ({ set() {}, update() {}, delete() {}, commit: () => Promise.resolve() }) };
    const user = { uid: 'u1', email: 't@e.com', emailVerified: true, displayName: 'Test Trader', getIdToken: () => Promise.resolve('t'), getIdTokenResult: () => Promise.resolve({ claims: {} }), reload: () => Promise.resolve() };
    const authObj = { currentUser: user, onAuthStateChanged: (cb) => { setTimeout(() => cb(user), 10); return () => {}; }, setPersistence: () => Promise.resolve(), signOut: () => Promise.resolve() };
    const fns = { httpsCallable: () => () => new Promise(() => {}) };
    window.firebase = { apps: [{}], initializeApp: () => ({}), app: () => ({ functions: () => fns }), functions: () => fns,
      firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => 'TS', increment: (n) => n, delete: () => 'D', arrayUnion: () => 'AU', arrayRemove: () => 'AR' }, Timestamp: { now: () => ({ toDate: () => new Date() }) } }),
      auth: Object.assign(() => authObj, { Auth: { Persistence: { LOCAL: 'l', SESSION: 's' } }, GoogleAuthProvider: function () {} }), messaging: () => ({ getToken: () => Promise.resolve(null), onMessage: () => {} }) };
    window.db = db; window.auth = authObj;
    try { localStorage.setItem('stryker_install_dismissed', '1'); localStorage.setItem('tz_consent', JSON.stringify({ v: 1, analytics: false, t: Date.now() })); localStorage.setItem('stryker_nav_authed', '1'); localStorage.setItem('stryker_theme', CFG.theme); sessionStorage.removeItem('tz_beta_v1'); } catch (e) {}
  };
  return '(' + body.toString() + ')(' + JSON.stringify(cfg) + ')';
}
async function open(browser, url, status, w, theme, hook) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, deviceScaleFactor: w < 500 ? 2 : 1 });
  const p = await ctx.newPage(), errors = [], reports = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(stub({ theme })); await p.addInitScript('window.__tzBetaDebug=1'); p.on('console', (m) => { if (/beta shot/.test(m.text())) console.log('  console:', m.text()); });
  await p.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
  await p.route('**/api/beta/status', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(status) }));
  await p.route('**/api/beta/report', (r) => { reports.push(JSON.parse(r.request().postData())); r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"thread":"1"}' }); });
  if (hook) await hook(p);
  await p.goto(BASE + '/' + url, { waitUntil: 'load' }); await p.waitForTimeout(1800);
  return { p, ctx, errors, reports };
}
const rect = (p, sel) => p.evaluate((s) => [...document.querySelectorAll(s)].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cy: r.y + r.height / 2 }; }), sel);
(async () => {
  const browser = await launch();
  const ACTIVE = { beta: true, admin: false, cap: 30 };
  try {
    for (const theme of ['dark', 'day']) for (const w of [390, 1440]) {
      console.log('\n== ' + theme + ' ' + w + ' ==');
      let { p, ctx, errors, reports } = await open(browser, 'beta.html', ACTIVE, w, theme);
      const r = await p.evaluate(() => ({ txt: document.body.innerText, over: document.documentElement.scrollWidth > innerWidth, feats: document.querySelectorAll('#beta-features li').length, rp: !document.getElementById('beta-report-panel').hidden }));
      ok('beta page: says you are a beta tester', /You are a beta tester/.test(r.txt));
      check('beta page: features from config', r.feats, 5); check('beta page: no horizontal scroll', r.over, false); check('beta page: report panel visible for beta', r.rp, true);
      ok('beta page: no prices', !/\$\s?\d/.test(r.txt));
      const rows = await p.evaluate(() => [...document.querySelectorAll('.bp-list li')].filter((li) => li.querySelector('.bp-pill')).map((li) => { const a = li.querySelector('.bp-t').getBoundingClientRect(), b = li.querySelector('.bp-pill').getBoundingClientRect(), l = li.getBoundingClientRect(); return { dc: Math.abs((a.y + a.height / 2) - (b.y + b.height / 2)), h: b.height, top: b.y - l.y, bot: l.bottom - b.bottom }; }));
      ok('row: title and pill share a centre (<=1px)', rows.every((x) => x.dc <= 1), JSON.stringify(rows.map((x) => +x.dc.toFixed(1))));
      ok('pills same height', new Set(rows.map((x) => x.h)).size === 1);
      const pad = await p.evaluate(() => [...document.querySelectorAll('.bp-pill')].map((e) => { const r = document.createRange(); r.selectNodeContents(e); const t = r.getBoundingClientRect(), b = e.getBoundingClientRect(); return Math.abs((t.x - b.x) - (b.right - t.right)); }));
      ok('pill text centred horizontally (<=1px)', pad.every((x) => x <= 1.01), JSON.stringify(pad.map((x) => +x.toFixed(1))));
      const fab = await rect(p, '#tz-beta-fab'); check('floating report button shown for beta', fab.length, 1);
      ok('fab is 48x48', fab[0] && Math.round(fab[0].w) === 48 && Math.round(fab[0].h) === 48);
      const ic = await p.evaluate(() => { const b = document.getElementById('tz-beta-fab').getBoundingClientRect(), s = document.querySelector('#tz-beta-fab svg').getBoundingClientRect(); return [Math.abs((b.x + b.width / 2) - (s.x + s.width / 2)), Math.abs((b.y + b.height / 2) - (s.y + s.height / 2))]; });
      ok('fab icon centred (<=1px)', ic[0] <= 1 && ic[1] <= 1, JSON.stringify(ic));
      await p.screenshot({ path: path.join(OUT, 'beta-' + theme + '-' + w + '.png'), fullPage: true });
      await p.click('#tz-beta-fab'); await p.waitForSelector('#tz-beta-dlg', { timeout: 15000 });
      await p.fill('#tzb-title', 'Chart freezes'); await p.fill('#tzb-what', 'It froze after I changed the symbol.');
      const dd = await p.evaluate(() => { const c = document.querySelector('.tzb-card').getBoundingClientRect(), vw = innerWidth; const ins = [...document.querySelectorAll('.tzb-in')].map((e) => e.getBoundingClientRect().height); return { fits: c.left >= 0 && c.right <= vw, ins, shot: !document.getElementById('tzb-shot').disabled, over: document.documentElement.scrollWidth > innerWidth }; });
      ok('dialog fits the screen, no horizontal scroll', dd.fits && !dd.over); ok('dialog inputs >= 48px', dd.ins[0] >= 48); ok('screenshot attached by default', dd.shot);
      await p.screenshot({ path: path.join(OUT, 'beta-report-' + theme + '-' + w + '.png') });
      await p.click('#tzb-send'); await p.waitForFunction(() => /Sent/.test(document.getElementById('tzb-msg') ? document.getElementById('tzb-msg').textContent : ''), null, { timeout: 8000 });
      check('report posted once', reports.length, 1);
      const b = reports[0]; ok('payload: title, what, url, build, ua', b.title === 'Chart freezes' && /froze/.test(b.what) && /beta/.test(b.url) && /^\d+$/.test(b.build) && b.ua.length > 5);
      ok('payload: PNG screenshot', /^data:image\/png;base64,iVBOR/.test(b.screenshot || ''));
      check('no page errors', errors, []); await ctx.close();
    }
    console.log('\n== not a tester ==');
    let { p, ctx, errors } = await open(browser, 'beta.html', { beta: false, admin: false, cap: 30 }, 390, 'dark');
    check('no fab for non-beta', (await rect(p, '#tz-beta-fab')).length, 0);
    check('report panel hidden', await p.evaluate(() => document.getElementById('beta-report-panel').hidden), true);
    ok('says Beta is invite-only', await p.evaluate(() => /Beta is invite-only/.test(document.body.innerText)));
    ok('no Discord link wording', await p.evaluate(() => !/connect discord|beta tester role/i.test(document.body.innerText)));
    await p.screenshot({ path: path.join(OUT, 'beta-invite-only-390.png'), fullPage: true }); check('no page errors', errors, []); await ctx.close();
    for (const theme of ['dark', 'day']) for (const w of [390, 1440]) {
      const calls = [];
      ({ p, ctx, errors } = await open(browser, 'students-admin.html', ACTIVE, w, theme, async (pg) => {
        let list = ['alpha@example.com', 'beta@example.com'];
        await pg.route('**/api/beta/admin', (r) => { const b = JSON.parse(r.request().postData()); calls.push(b); if (b.action === 'add') list = list.concat(b.email); else list = list.filter((x) => x !== b.email); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, emails: list }) }); });
      }));
      await p.waitForSelector('#beta-admin-list .ba-row', { timeout: 15000 });
      const m = await p.evaluate(() => { const rows = [...document.querySelectorAll('.ba-row')].map((r) => { const a = r.querySelector('.ba-who').getBoundingClientRect(), b = r.querySelector('.btn').getBoundingClientRect(); return Math.abs((a.y + a.height / 2) - (b.y + b.height / 2)); }); const i = document.getElementById('beta-admin-email').getBoundingClientRect(), bt = document.getElementById('beta-admin-add').getBoundingClientRect(); return { rows, dform: Math.abs((i.y + i.height / 2) - (bt.y + bt.height / 2)), hi: i.height, hb: bt.height, over: document.documentElement.scrollWidth > innerWidth, count: document.getElementById('beta-admin-count').textContent, clipped: [...document.querySelectorAll('.ba-who b')].some((e) => e.scrollWidth > e.clientWidth + 1) }; });
      ok(theme + ' ' + w + ' admin: count "2 of 30"', m.count === 'Beta testers: 2 of 30', m.count); ok('admin: row text and button share a centre (<=1px)', m.rows.every((x) => x <= 1), JSON.stringify(m.rows)); ok('admin: input and Add button share a centre and height', m.dform <= 1 && m.hi === m.hb);
      check('admin: no horizontal scroll', m.over, false); check('admin: no clipped email', m.clipped, false);
      await p.fill('#beta-admin-email', 'New@Example.com'); await p.click('#beta-admin-add'); await p.waitForFunction(() => /3 of 30/.test(document.getElementById('beta-admin-count').textContent));
      check('admin: add posts the email', calls[0], { action: 'add', email: 'new@example.com' });
      await p.locator('#beta-admin').scrollIntoViewIfNeeded(); await p.locator('#beta-admin').screenshot({ path: path.join(OUT, 'admin-' + theme + '-' + w + '.png') });
      await p.click('[data-ba-rm="alpha@example.com"]'); await p.waitForFunction(() => /2 of 30/.test(document.getElementById('beta-admin-count').textContent));
      check('admin: remove posts the email', calls[1], { action: 'remove', email: 'alpha@example.com' }); check('no page errors', errors.filter((e) => !/students|permission/i.test(e)), []); await ctx.close();
    }
    ({ p, ctx, errors } = await open(browser, 'charts.html', ACTIVE, 1440, 'dark'));
    await p.waitForTimeout(3000);
    check('chart toolbar: Report a bug button', (await rect(p, '#stkc-beta-btn')).length, 1);
    const bar = await p.evaluate(() => ({ bs: [...document.querySelectorAll('#stkc-bar .stkc-bar-r .stkc-ib')].map((e) => { const r = e.getBoundingClientRect(); return { cy: r.y + r.height / 2, h: r.height, w: r.width }; }).filter((x) => x.w > 0) }));
    ok('chart toolbar buttons share one centre (<=1px)', Math.max(...bar.bs.map((x) => x.cy)) - Math.min(...bar.bs.map((x) => x.cy)) <= 1); ok('chart toolbar same size', new Set(bar.bs.map((x) => x.h + 'x' + x.w)).size === 1);
    await ctx.close();
  } finally { await browser.close(); }
  console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASSED'); process.exit(fails ? 1 : 0);
})();
