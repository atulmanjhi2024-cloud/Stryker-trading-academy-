// No country question anywhere (Owner 22 Nov 2026): signed-in page shows no dialog and writes nothing, signup has no picker and
// its buttons are enabled, a stored blocked residence / server lock still locks the page. The IP block is covered by geo-block.test.mjs.
//   (python3 -m http.server 8000 &)   flock /tmp/stryker-chrome.lock node tools/tests/geo-attest-browser.js [outdir]
const fs = require('fs');
const path = require('path');
const { launch, BASE } = require('./lib');
const OUT = process.argv[2] || '/tmp/geo-shots';
fs.mkdirSync(OUT, { recursive: true });

function stub(cfg) {
  const body = function (CFG) {
    const DATA = {
      'settings/commerce': { usdInr: 88, stripeCheckout: true },
      'settings/pageAccess': {},
      'plans/free': { name: 'Starter', displayName: 'Free', rank: 0, price: '0', period: 'month' },
      'students/u1': CFG.student || null
    };
    window.__sets = []; window.__signedOut = 0;
    const snap = (id, d) => ({ id, exists: !!d, data: () => d || {}, ref: {} });
    const list = () => ({ empty: true, size: 0, docs: [], forEach() {} });
    const docRef = (col, id) => ({
      // CFG.cache = what the local Firestore cache holds (a default get() answers from it); {source:'server'} reads DATA.
      id, get: (o) => { window.__gets = (window.__gets || []).concat([(o && o.source) || 'default']);
        const k = col + '/' + id; return Promise.resolve(snap(id, !(o && o.source === 'server') && CFG.cache && k in CFG.cache ? CFG.cache[k] : DATA[k])); },
      set: (d, o) => { window.__sets.push({ path: col + '/' + id, d, o }); if (CFG.failSet && col === 'students') { if (CFG.answerOnFail && d && d.sanctionsAttest) DATA[col + '/' + id] = Object.assign({}, DATA[col + '/' + id], { residenceCountry: 'US', sanctionsAttest: true }); return Promise.reject({ code: CFG.failSet === true ? 'unavailable' : CFG.failSet }); } return Promise.resolve(); },
      update: () => Promise.resolve(), delete: () => Promise.resolve(),
      onSnapshot: (cb) => { setTimeout(() => cb(snap(id, DATA[col + '/' + id])), 10); return () => {}; },
      collection: (sub) => colRef(col + '/' + id + '/' + sub)
    });
    const colRef = (col) => ({
      doc: (id) => docRef(col, id || 'auto'), get: () => Promise.resolve(list()), add: () => Promise.resolve({ id: 'x' }),
      where: () => colRef(col), orderBy: () => colRef(col), limit: () => colRef(col), startAfter: () => colRef(col),
      onSnapshot: (cb) => { setTimeout(() => cb(list()), 10); return () => {}; }
    });
    const db = { collection: colRef, batch: () => ({ set() {}, update() {}, delete() {}, commit: () => Promise.resolve() }),
      runTransaction: (f) => f({ get: (r) => r.get(), set() {}, update() {} }) };
    const user = CFG.signedIn ? { uid: 'u1', email: 't@e.com', emailVerified: true, displayName: 'Test Trader', providerData: [],
      getIdToken: () => Promise.resolve('t'), getIdTokenResult: () => Promise.resolve({ claims: {} }), reload: () => Promise.resolve() } : null;
    const authObj = {
      currentUser: user,
      onAuthStateChanged: (cb) => { setTimeout(() => cb(user), 10); return () => {}; },
      setPersistence: () => Promise.resolve(), signOut: () => { window.__signedOut++; return Promise.resolve(); },
      createUserWithEmailAndPassword: () => { window.__created = (window.__created || 0) + 1; return new Promise(() => {}); },
      signInWithPopup: () => { window.__popup = (window.__popup || 0) + 1; return new Promise(() => {}); }
    };
    const fns = { httpsCallable: () => () => new Promise(() => {}) };
    window.firebase = {
      apps: [{}], initializeApp: () => ({}), app: () => ({ functions: () => fns }), functions: () => fns,
      firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => 'TS', increment: (n) => n, delete: () => 'D', arrayUnion: () => 'AU', arrayRemove: () => 'AR' },
        Timestamp: { now: () => ({ toDate: () => new Date() }) } }),
      auth: Object.assign(() => authObj, { Auth: { Persistence: { LOCAL: 'l', SESSION: 's' } }, GoogleAuthProvider: function () { this.setCustomParameters = () => {}; } }),
      messaging: () => ({ getToken: () => Promise.resolve(null), onMessage: () => {} })
    };
    try {
      localStorage.setItem('stryker_install_dismissed', '1');
      localStorage.setItem('stryker_cookie_notice', '1');
      if (CFG.light) localStorage.setItem('stryker_theme', 'day'); else localStorage.removeItem('stryker_theme');
    } catch (e) { /* ignore */ }
  };
  return '(' + body.toString() + ')(' + JSON.stringify(cfg) + ')';
}

let fails = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + label.padEnd(66) + ' ' + JSON.stringify(got) + (ok ? '' : '   (want ' + JSON.stringify(want) + ')'));
}

async function open(browser, url, cfg, width) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, deviceScaleFactor: width < 500 ? 2 : 1,
    colorScheme: cfg.light ? 'light' : 'dark' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(stub(cfg));
  await p.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
  await p.goto(BASE + '/' + url, { waitUntil: 'load' });
  await p.waitForTimeout(cfg.wait || 1500);
  return { p, ctx, errors };
}
const hideOverlays = (p) => p.evaluate(() => document.querySelectorAll('body *').forEach((e) => {
  const cs = getComputedStyle(e);
  if (cs.position === 'fixed' && e.offsetHeight > 60) e.style.display = 'none';
}));

(async () => {
  const browser = await launch();
  try {
    for (const [w, light] of [[390, false], [1440, false], [390, true], [1440, true]]) {
      const tag = w + (light ? ' light' : ' dark');
      const { p, ctx, errors } = await open(browser, 'signup.html', { light }, w);
      check('signup ' + tag + ': no country picker / attest checkbox', await p.evaluate(() => [!!document.querySelector('#geo-signup, select[autocomplete=country], .geo-attest, .geo-hint')]), [false]);
      check('signup ' + tag + ': Google + email buttons enabled', await p.evaluate(() => [document.querySelector('[data-google-signin]').disabled,
        document.querySelector('#signup-form button[type=submit]').disabled]), [false, false]);
      check('signup ' + tag + ': no page errors, no h-scroll', [errors, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)], [[], true]);
      await hideOverlays(p);
      await p.screenshot({ path: path.join(OUT, 'signup-' + w + (light ? '-light' : '-dark') + '.png') });
      await ctx.close();
    }
    for (const page of ['dashboard-user.html', 'settings.html', 'charts.html']) {
      const { p, ctx, errors } = await open(browser, page, { signedIn: true, student: { plan: 'Starter', displayName: 'Test Trader' }, wait: 2500 }, 390);
      check(page + ': signed-in, no country dialog, no residence write', await p.evaluate(() => [!document.getElementById('geo-gate'), !document.querySelector('.geo-gate, .geo-attest'),
        window.__sets.filter((s) => s.d && ('residenceCountry' in s.d || 'sanctionsAttest' in s.d)).length, window.__signedOut]), [true, true, 0, 0]);
      check(page + ': no page errors', errors.filter((e) => !/Failed to fetch|NetworkError|net::/.test(e)), []);
      await ctx.close();
    }
    for (const [label, student] of [['stored RU', { plan: 'Starter', residenceCountry: 'RU' }], ['server lock', { plan: 'Pro', sanctionsLocked: true }]]) {
      const { p, ctx } = await open(browser, 'charts.html', { signedIn: true, student, wait: 3000 }, 1440);
      check('still locked on load (' + label + ')', await p.evaluate(() => [document.querySelector('h1') && document.querySelector('h1').textContent, window.__signedOut > 0]), ['Not available in your region', true]);
      await ctx.close();
    }
    {
      const { p, ctx } = await open(browser, 'dashboard-user.html', { signedIn: true, wait: 2500, student: { plan: 'Starter' } }, 390);
      check('member check asks for the server copy', await p.evaluate(() => (window.__gets || []).includes('server')), true);
      await ctx.close();
    }
    {
      const { p, ctx } = await open(browser, 'terms.html#restricted-regions', { signedIn: true, student: { plan: 'Starter' }, wait: 2500 }, 390);
      check('terms: no prompt, Restricted regions section present', await p.evaluate(() => [!document.getElementById('geo-gate'), !!document.getElementById('restricted-regions'),
        (document.getElementById('site-page-updated') || {}).textContent]), [true, true, 'Last updated 9 November 2026']);
      await p.screenshot({ path: path.join(OUT, 'terms-restricted-390-dark.png') });
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(fails ? 'FAILED: ' + fails : 'geo-attest browser: all pass');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
