// referrals.html redesign (Owner 25 Nov): shots + alignment numbers for the "three" (3 invites, 15 Pro days)
// and "empty" states, dark + light, 390 / 412 / 1440. Firebase stubbed, every page stamped "Sample data".
// Run (server on STRYKER_TEST_PORT serving the repo root): node tools/tests/referrals-page-shots.js <shotDir> [prefix]
const fs = require('fs');
const path = require('path');
const { launch, BASE } = require('./lib.js');
const OUT = process.argv[2] || path.join(__dirname, 'shots-refui');
const PREFIX = process.argv[3] || 'after';
fs.mkdirSync(OUT, { recursive: true });

const stub = '(' + function () {
  const NOW = Date.now(), D = 864e5;
  const sc = new URLSearchParams(location.search).get('sc') || 'three';
  const ts = (ms) => ({ toDate: () => new Date(ms), toMillis: () => ms, seconds: Math.floor(ms / 1000) });
  const store = {};
  const put = (p, v) => { store[p] = v; };
  const empty = sc === 'empty';
  put('students/u1', { displayName: 'Maya Rao', email: 'maya@example.com', plan: empty ? 'Starter' : 'Pro', planSource: 'referral', paidThroughMillis: empty ? 0 : NOW + 13 * D, subscriptionStatus: empty ? '' : 'active', referralCode: 'maya4821', referralPoints: empty ? 0 : 30 });
  put('referralCodes/maya4821', { uid: 'u1', name: 'Maya' });
  put('settings/referralRewards', { inviterDays: 5, friendDays: 5, capDaysPerYear: 365 });
  if (!empty) {
    const row = (id, name, st, reason, days, ago) => put('referrals/' + id, { referrerUid: 'u1', referredUid: id, referredName: name, status: 'signed_up', createdAt: ts(NOW - ago * D), rewardState: st, rewardReason: reason, rewardInviterDays: days });
    row('f1', 'Arjun Mehta', 'verified', '', 5, 9);
    row('f2', 'Lena Fischer', 'verified', '', 5, 6);
    row('f3', 'Tom Baker', 'verifying', 'Waiting for email confirmation', 0, 1);
    put('referralRewards/f1', { referrerUid: 'u1', referredUid: 'f1', state: 'verified', inviterDays: 5, friendDays: 5 });
    put('referralRewards/f2', { referrerUid: 'u1', referredUid: 'f2', state: 'verified', inviterDays: 5, friendDays: 5 });
    put('referralRewards/u1', { referrerUid: 'x9', referredUid: 'u1', state: 'verified', inviterDays: 5, friendDays: 5 });
    [['p1', 'ravitrades', 120], ['p2', 'jopark', 60], ['p3', 'kenji', 45], ['u1', 'maya', 30], ['p5', 'sofia', 20], ['p6', 'dev_t', 15], ['p7', 'nora', 10], ['p8', 'ali', 10], ['p9', 'max', 5], ['p10', 'zed', 5], ['p11', 'omar', 5]]
      .forEach(([id, u, pts]) => put('profiles/' + id, { username: u, displayName: u, referralPoints: pts }));
  }
  const snapOf = (rows) => ({ size: rows.length, empty: !rows.length, docs: rows, forEach(f) { rows.forEach(f); } });
  const mk = (p) => ({ id: p.split('/').pop(), exists: p in store, data: () => store[p] ? Object.assign({}, store[p]) : undefined, ref: docRef(p) });
  function docRef(p) {
    return { id: p.split('/').pop(), path: p, get: () => Promise.resolve(mk(p)), set: (v, o) => { store[p] = Object.assign({}, o && o.merge ? store[p] : {}, v); return Promise.resolve(); },
      update: () => Promise.resolve(), delete: () => Promise.resolve(), onSnapshot: (cb) => { setTimeout(() => cb(mk(p)), 5); return () => {}; }, collection: (sub) => colRef(p + '/' + sub) };
  }
  function colRef(p, filters, order, lim) {
    filters = filters || [];
    const rows = () => {
      const depth = p.split('/').length + 1;
      let r = Object.keys(store).filter((k) => k.startsWith(p + '/') && k.split('/').length === depth).filter((k) => filters.every(([f, op, v]) => op === '==' ? store[k][f] === v : true));
      if (order) r.sort((a, b) => (store[b][order] || 0) - (store[a][order] || 0));
      if (lim) r = r.slice(0, lim);
      return r.map(mk);
    };
    return { doc: (id) => docRef(p + '/' + (id || 'auto')), get: () => Promise.resolve(snapOf(rows())), add: () => Promise.resolve({ id: 'new' }),
      where: (f, op, v) => colRef(p, filters.concat([[f, op, v]]), order, lim), orderBy: (f) => colRef(p, filters, f, lim), limit: (n) => colRef(p, filters, order, n), startAfter: () => colRef(p, filters, order, lim),
      onSnapshot: (cb) => { setTimeout(() => cb(snapOf(rows())), 5); return () => {}; } };
  }
  const user = { uid: 'u1', email: 'maya@example.com', displayName: 'Maya Rao', emailVerified: true, photoURL: null, metadata: {}, getIdTokenResult: () => Promise.resolve({ claims: {} }), getIdToken: () => Promise.resolve('t') };
  const fns = { httpsCallable: () => () => Promise.resolve({ data: { ok: true } }) };
  window.__stubDb = { collection: (p) => colRef(p), doc: (p) => docRef(String(p)), batch: () => ({ set() {}, update() {}, delete() {}, commit: () => Promise.resolve() }), runTransaction: (f) => f({ get: (r) => r.get(), set() {}, update() {} }), enablePersistence: () => Promise.resolve(), settings() {} };
  window.db = window.__stubDb;
  window.__stubAuth = { currentUser: user, onAuthStateChanged: (cb) => { setTimeout(() => cb(user), 10); return () => {}; }, onIdTokenChanged: (cb) => { setTimeout(() => cb(user), 10); return () => {}; }, setPersistence: () => Promise.resolve(), signOut: () => Promise.resolve(), useDeviceLanguage() {} };
  const fsFn = Object.assign(() => window.__stubDb, { FieldValue: { serverTimestamp: () => ({}), increment: (n) => ({ inc: n }), delete: () => 'DEL', arrayUnion: () => 'AU', arrayRemove: () => 'AR' }, Timestamp: { now: () => ts(NOW), fromDate: (d) => ts(+d), fromMillis: (m) => ts(m) } });
  const fb = { apps: [{}], initializeApp: () => ({}), app: () => ({ functions: () => fns }), firestore: fsFn, auth: Object.assign(() => window.__stubAuth, { Auth: { Persistence: { LOCAL: 'l', SESSION: 's', NONE: 'n' } }, GoogleAuthProvider: function () { this.setCustomParameters = () => {}; } }), functions: () => fns, messaging: Object.assign(() => ({ getToken: () => Promise.resolve(null), onMessage: () => {} }), { isSupported: () => false }) };
  Object.defineProperty(window, 'firebase', { get: () => fb, set: () => {}, configurable: false });
  window.auth = window.__stubAuth;
  try { localStorage.setItem('stryker_tour_done', '1'); localStorage.setItem('tz_consent', JSON.stringify({ v: 1, analytics: false, t: NOW })); localStorage.setItem('stryker_push_prompt_dismissed', String(NOW)); localStorage.setItem('stryker_nav_authed', '1'); localStorage.setItem('tz_ref_nudge_done_u1', '1'); } catch (e) {}
  document.addEventListener('DOMContentLoaded', () => {
    const b = document.createElement('div'); b.textContent = 'Sample data';
    b.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:9999;background:#f5c542;color:#111;font:600 11px/16px sans-serif;padding:2px 8px;border-radius:999px;pointer-events:none';
    document.body.appendChild(b);
  });
}.toString() + ')()';

// Alignment gate: worst vertical-centre offset per row (px), even padding, 48 px controls, tabular right edges.
const MEASURE = () => {
  const r = (e) => e.getBoundingClientRect();
  const cy = (b) => b.top + b.height / 2;
  const worst = (rows, kids) => Math.max(0, ...Array.from(document.querySelectorAll(rows)).map((row) => { const c = cy(r(row)); return Math.max(0, ...Array.from(row.querySelectorAll(kids)).map((k) => Math.abs(cy(r(k)) - c))); }));
  const pad = (sel) => Math.max(0, ...Array.from(document.querySelectorAll(sel)).filter((e) => e.offsetParent).map((e) => { const b = r(e), cs = getComputedStyle(e), bw = parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth); const rg = document.createRange(); rg.selectNodeContents(e); const c = rg.getBoundingClientRect(); return Math.abs((c.left - b.left) - (b.right - c.right) - bw); }));
  const inp = r(document.getElementById('referral-link-display')), cp = r(document.getElementById('referral-copy-btn'));
  const pts = Array.from(document.querySelectorAll('.refx-pts')).map((e) => Math.round(r(e).right));
  const gapsOf = (sel) => { const k = Array.from(document.querySelectorAll(sel)).map(r); const g = []; for (let i = 1; i < k.length; i++) g.push(Math.round(k[i].top === k[i - 1].top ? k[i].left - k[i - 1].right : k[i].top - k[i - 1].bottom)); return Array.from(new Set(g)); };
  const clipped = Array.from(document.querySelectorAll('#main *')).filter((e) => e.offsetParent && !e.closest('.refx-link,.sr-only') && e.children.length === 0 && e.scrollWidth > e.clientWidth + 1 && /hidden|clip/.test(getComputedStyle(e).overflowX) && getComputedStyle(e).textOverflow !== 'ellipsis').length;
  return {
    linkInputH: Math.round(inp.height), copyBtnH: Math.round(cp.height), linkRowCentreOff: +Math.abs(cy(inp) - cy(cp)).toFixed(1),
    copyBtnContentCentreOff: +worst('#referral-copy-btn', 'svg,span').toFixed(1), copyBtnPadLR: +pad('#referral-copy-btn').toFixed(1),
    shareChipCentreOff: +worst('.refx-soc', 'svg,span').toFixed(1), shareChipPadLR: +pad('.refx-soc:not([hidden])').toFixed(1), shareChipH: Array.from(new Set(Array.from(document.querySelectorAll('.refx-soc:not([hidden])')).map((e) => Math.round(r(e).height)))),
    shareChipGaps: gapsOf('.refx-soc:not([hidden])'),
    inviteRowCentreOff: +worst('#referral-invite-list .refx-row', '.refx-av,.refx-who,.refx-st').toFixed(1),
    chipDotCentreOff: +worst('.refx-chip', 'i').toFixed(1), chipPadLR: +pad('.refx-chip').toFixed(1),
    lbRowCentreOff: +worst('.refx-lb .refx-row', '.refx-rank,.refx-lb-av,.refx-who,.refx-pts').toFixed(1), pointsRightEdges: Array.from(new Set(pts)),
    stepIconCentreOff: +worst('.refx-step-ic', 'svg').toFixed(1), stepGaps: gapsOf('.refx-steps li'),
    faqRowCentreOff: +worst('.refx-faq-item summary', 'span,svg').toFixed(1), faqRowH: Array.from(new Set(Array.from(document.querySelectorAll('.refx-faq-item summary')).map((e) => Math.round(r(e).height)))),
    cardGaps: gapsOf('.refx-page > *:not(.auth-error):not(.refx-fine)'), clipped
  };
};

(async () => {
  const browser = await launch({ args: ['--js-flags=--max-old-space-size=600'] });
  const report = {};
  for (const theme of ['dark', 'light']) for (const w of [390, 412, 1440]) for (const sc of ['three', 'empty']) {
    const mobile = w < 700;
    const ctx = await browser.newContext({ viewport: { width: w, height: mobile ? 860 : 1000 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile,
      userAgent: mobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' : undefined });
    await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
    await ctx.addInitScript(stub);
    await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e.message || e)));
    await page.goto(BASE + '/referrals.html?sc=' + sc, { waitUntil: 'load' });
    await page.waitForFunction(() => { const l = document.getElementById('referral-invite-list'); return l && !l.querySelector('[data-skel]') && document.getElementById('referral-link-display').value; }, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(600);
    const tag = PREFIX + '-' + sc + '-' + w + '-' + theme;
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth }));
    report[tag] = { scrollWidth: m.sw, viewport: m.vw, errors: errs.slice(0, 3) };
    if (PREFIX !== 'before') report[tag].align = await page.evaluate(MEASURE);
    if (mobile) await page.screenshot({ path: path.join(OUT, tag + '-top.png') });
    await page.screenshot({ path: path.join(OUT, tag + '.png'), fullPage: true });
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, PREFIX + '-report.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report));
})().catch((e) => { console.error(e); process.exit(2); });
