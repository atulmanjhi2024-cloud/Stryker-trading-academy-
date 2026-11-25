// "Invite friends, get Pro free": referrals.html (filled + empty), signup.html?ref=, the account-menu entry, the
// one-time nudge, and the referrals-admin.html reward rules (no review queue). Firebase stubbed (SAMPLE DATA ONLY; every shot is stamped
// "Sample data"). Measures alignment with getBoundingClientRect.
// Run (server on STRYKER_TEST_PORT serving the repo root): node tools/tests/referral-rewards-browser.js [shotDir]
const fs = require('fs');
const path = require('path');
const { launch, BASE } = require('./lib.js');
const SHOTS = process.argv[2] || path.join(__dirname, 'shots-refpro');
fs.mkdirSync(SHOTS, { recursive: true });

const stub = '(' + function () {
  const NOW = Date.now(), D = 864e5;
  const sc = new URLSearchParams(location.search).get('sc') || (sessionStorage.getItem('sc') || 'filled');
  if (new URLSearchParams(location.search).get('sc') && sc !== 'nudge') { try { sessionStorage.removeItem('nudge_seeded'); } catch (e) {} }
  try { sessionStorage.setItem('sc', sc); } catch (e) {}
  const ts = (ms) => ({ toDate: () => new Date(ms), toMillis: () => ms, seconds: Math.floor(ms / 1000) });
  const me = sc === 'admin' ? 'adm1' : 'u1';
  const store = {};
  const put = (p, v) => { store[p] = v; };
  put('admins/adm1', { email: 'owner@example.com' });
  put('students/u1', { displayName: 'Maya Rao', email: 'maya@example.com', plan: 'Starter', referralCode: 'maya4821', referralPoints: sc === 'empty' ? 0 : 40 });
  put('referralCodes/maya4821', { uid: 'u1', name: 'Maya' });
  put('settings/referralRewards', { inviterDays: 5, friendDays: 5, capDaysPerYear: 365 });
  if (sc !== 'empty') {
    const row = (id, name, st, reason, days, ago) => put('referrals/' + id, { referrerUid: 'u1', referredUid: id, referredName: name, status: 'signed_up', createdAt: ts(NOW - ago * D), rewardState: st, rewardReason: reason, rewardInviterDays: days });
    row('f1', 'Arjun Mehta', 'verified', '', 5, 9);
    row('f2', 'Lena Fischer', 'verified', '', 5, 8);
    row('f3', 'Tom Baker', 'verifying', 'Active 1 of 2 days', 0, 2);
    row('f4', 'Priya Nair', undefined, undefined, 0, 0);
    row('f5', 'Sam Okafor', 'ineligible', 'Same device as inviter', 0, 12);
    row('f6', 'Chen Wei', 'ineligible', 'Disposable email address', 0, 10);
    put('referralRewards/f1', { referrerUid: 'u1', referredUid: 'f1', state: 'verified', inviterDays: 5, friendDays: 5 });
    put('referralRewards/f2', { referrerUid: 'u1', referredUid: 'f2', state: 'verified', inviterDays: 5, friendDays: 5 });
    put('referralRewards/f5', { referrerUid: 'u1', referredUid: 'f5', state: 'ineligible' });
    put('referralRewards/f6', { referrerUid: 'u1', referredUid: 'f6', state: 'ineligible' });
    put('profiles/p1', { displayName: 'Ravi Kumar', username: 'ravitrades', email: 'ravi@example.com', referralPoints: 120 });
    put('profiles/u1', { displayName: 'Maya Rao', email: 'maya@example.com', referralPoints: 40 });
    put('profiles/p3', { displayName: 'Jo Park', email: 'jo@example.com', referralPoints: 20 });
  }
  window.__writes = []; window.__calls = [];
  const snapOf = (rows) => ({ size: rows.length, empty: !rows.length, docs: rows, forEach(f) { rows.forEach(f); } });
  const mk = (p) => ({ id: p.split('/').pop(), exists: p in store, data: () => store[p] ? Object.assign({}, store[p]) : undefined, ref: docRef(p) });
  function docRef(p) {
    return {
      id: p.split('/').pop(), path: p,
      get: () => Promise.resolve(mk(p)),
      set: (v, o) => { window.__writes.push({ p, v: JSON.parse(JSON.stringify(v)), o }); store[p] = Object.assign({}, o && o.merge ? store[p] : {}, v); return Promise.resolve(); },
      update: () => Promise.resolve(), delete: () => { delete store[p]; return Promise.resolve(); },
      onSnapshot: (cb) => { setTimeout(() => cb(mk(p)), 5); return () => {}; },
      collection: (sub) => colRef(p + '/' + sub)
    };
  }
  function colRef(p, filters, order, lim) {
    filters = filters || [];
    const rows = () => {
      const depth = p.split('/').length + 1;
      let r = Object.keys(store).filter((k) => k.startsWith(p + '/') && k.split('/').length === depth)
        .filter((k) => filters.every(([f, op, v]) => op === '==' ? store[k][f] === v : op === '>=' ? store[k][f] >= v : true));
      if (order) r.sort((a, b) => (store[b][order] || 0) - (store[a][order] || 0));
      if (lim) r = r.slice(0, lim);
      return r.map(mk);
    };
    return {
      doc: (id) => docRef(p + '/' + (id || 'auto' + Math.random().toString(36).slice(2, 8))),
      get: () => Promise.resolve(snapOf(rows())),
      add: (v) => { window.__writes.push({ p, v: JSON.parse(JSON.stringify(v)) }); return Promise.resolve({ id: 'new' }); },
      where: (f, op, v) => colRef(p, filters.concat([[f, op, v]]), order, lim),
      orderBy: (f) => colRef(p, filters, f, lim), limit: (n) => colRef(p, filters, order, n), startAfter: () => colRef(p, filters, order, lim),
      onSnapshot: (cb) => { setTimeout(() => cb(snapOf(rows())), 5); return () => {}; }
    };
  }
  const signedOut = sc === 'signup';
  const user = signedOut ? null : { uid: me, email: me === 'adm1' ? 'owner@example.com' : 'maya@example.com', displayName: me === 'adm1' ? 'Owner Admin' : 'Maya Rao', emailVerified: true, photoURL: null, metadata: {}, getIdTokenResult: () => Promise.resolve({ claims: {} }), getIdToken: () => Promise.resolve('t') };
  const callable = (name) => (data) => { window.__calls.push({ name, data }); return Promise.resolve({ data: { ok: true } }); };
  const fns = { httpsCallable: callable };
  window.__stubDb = { collection: (p) => colRef(p), doc: (p) => docRef(String(p)), batch: () => ({ set() {}, update() {}, delete() {}, commit: () => Promise.resolve() }), runTransaction: (f) => f({ get: (r) => r.get(), set() {}, update() {} }), enablePersistence: () => Promise.resolve(), settings() {} };
  window.db = window.__stubDb;
  window.__stubAuth = { currentUser: user, onAuthStateChanged: (cb) => { setTimeout(() => cb(user), 10); return () => {}; }, onIdTokenChanged: (cb) => { setTimeout(() => cb(user), 10); return () => {}; }, setPersistence: () => Promise.resolve(), signOut: () => Promise.resolve(), useDeviceLanguage() {} };
  const fsFn = Object.assign(() => window.__stubDb, { FieldValue: { serverTimestamp: () => ({ __ts: 'server' }), increment: (n) => ({ inc: n }), delete: () => 'DEL', arrayUnion: () => 'AU', arrayRemove: () => 'AR' }, Timestamp: { now: () => ts(NOW), fromDate: (d) => ts(+d), fromMillis: (m) => ts(m) } });
  const fb = { apps: [{}], initializeApp: () => ({}), app: () => ({ functions: () => fns }), firestore: fsFn, auth: Object.assign(() => window.__stubAuth, { Auth: { Persistence: { LOCAL: 'l', SESSION: 's', NONE: 'n' } }, GoogleAuthProvider: function () { this.setCustomParameters = () => {}; } }), functions: () => fns, messaging: Object.assign(() => ({ getToken: () => Promise.resolve(null), onMessage: () => {} }), { isSupported: () => false }) };
  Object.defineProperty(window, 'firebase', { get: () => fb, set: () => {}, configurable: false });
  window.auth = window.__stubAuth;
  try {
    localStorage.setItem('stryker_tour_done', '1'); localStorage.setItem('tz_consent', JSON.stringify({ v: 1, analytics: false, t: NOW })); localStorage.setItem('stryker_push_prompt_dismissed', String(Date.now()));
    if (!signedOut) localStorage.setItem('stryker_nav_authed', '1');
    if (sc === 'nudge' && !sessionStorage.getItem('nudge_seeded')) { sessionStorage.setItem('nudge_seeded', '1'); localStorage.removeItem('tz_ref_ping_u1'); const d = (n) => new Date(NOW - n * D).toISOString().slice(0, 10); localStorage.setItem('tz_ref_days_u1', JSON.stringify([d(3), d(1)])); localStorage.removeItem('tz_ref_nudge_done_u1'); }
    else if (sc !== 'nudge') localStorage.setItem('tz_ref_nudge_done_u1', '1');
  } catch (e) {}
  // "Sample data" stamp on every test page (truth rule)
  document.addEventListener('DOMContentLoaded', () => {
    const b = document.createElement('div'); b.textContent = 'Sample data';
    b.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:9999;background:#f5c542;color:#111;font:600 11px/16px sans-serif;padding:2px 8px;border-radius:999px;pointer-events:none';
    document.body.appendChild(b);
  });
}.toString() + ')()';

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const BANNED = /KOL|Member Tier|commission|\$\s?\d|₹\s?\d|profit|win rate|guaranteed/i;

(async () => {
  const browser = await launch({ args: ['--js-flags=--max-old-space-size=600'] });
  const shots = [];
  for (const theme of ['dark', 'light']) for (const vp of [{ w: 390, h: 844 }, { w: 1440, h: 1000 }]) {
    const mobile = vp.w < 700;
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile,
      userAgent: mobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' : undefined });
    await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
    await ctx.addInitScript(stub);
    await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e.message || e)));
    const tag = vp.w + '-' + theme;
    const noOverflow = async (n) => { const sw = await page.evaluate(() => document.documentElement.scrollWidth); ok(sw <= vp.w, tag + ' ' + n + ' no sideways scroll (' + sw + ')'); };
    const shot = async (name, full) => { const p = path.join(SHOTS, tag + '-' + name + '.png'); await page.screenshot({ path: p, fullPage: !!full }); shots.push(p); };

    // ---------- referrals.html, filled
    await page.goto(BASE + '/referrals.html?sc=filled', { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('#referral-invite-list .refx-row').length === 6 && document.getElementById('refx-verified').textContent !== '—', null, { timeout: 15000 });
    await page.waitForTimeout(400);
    await noOverflow('filled');
    const txt = await page.evaluate(() => document.getElementById('main').innerText);
    ok(/Invite friends, get Pro free/.test(txt), tag + ' title');
    ok(/[Yy]ou both get 5 days of Pro/.test(txt) && /\+5 days for you, \+5 days for them/.test(txt) && /Up to 365 Pro days a year/.test(txt) && !/\b7 days of Pro|\b90 Pro days|review/i.test(txt), tag + ' copy: 5 + 5 days, 365 cap, no review wording');
    ok(!BANNED.test(txt), tag + ' no KOL / tier / commission / prices / result claims');
    ok(/Education only\. Not financial advice\./.test(txt) && /within 2 days/.test(txt), tag + ' fine print');
    const st = await page.evaluate(() => ['refx-verified', 'refx-days', 'refx-pending'].map((id) => document.getElementById(id).textContent));
    ok(st[0] === '2' && st[1] === '10' && st[2] === '2', tag + ' stats verified 2 / 10 days / pending 2 (' + st.join(',') + ')');
    ok(await page.evaluate(() => /width: ?2\.7/.test(document.getElementById('refx-bar-fill').getAttribute('style')) && document.querySelectorAll('.refx-tick').length === 4 && document.getElementById('refx-bar').getAttribute('aria-valuenow') === '10'), tag + ' progress bar 10 / 365 with 4 ticks');
    const chips = await page.evaluate(() => Array.from(document.querySelectorAll('.refx-chip')).map((c) => c.textContent.trim()));
    ok(chips.join('|') === 'Pending|Pending|Rewarded|Rewarded|Not eligible|Not eligible', tag + ' status chips ' + chips.join('|'));
    ok(mobile || (/Same device as inviter/.test(txt) && /Disposable email address/.test(txt)), tag + ' not-eligible reasons shown (desktop; phone hides the note)');
    ok(await page.evaluate(() => document.getElementById('referral-link-display').value.endsWith('/signup.html?ref=maya4821')), tag + ' link');
    const lb = await page.evaluate(() => Array.from(document.querySelectorAll('.refx-lb .refx-who b')).map((b) => b.textContent));
    ok(lb.length === 3 && lb[0] === '@ravitrades' && /^Maya/.test(lb[1]) && !lb.some((x) => /@example|Rao|Park/.test(x)), tag + ' leaderboard handles only: ' + lb.join(','));
    const hrefs = await page.evaluate(() => ['x', 'wa', 'tg', 'rd'].map((k) => document.getElementById('refx-share-' + k).href));
    ok(/twitter\.com\/intent\/tweet\?text=.*FREE.*maya4821/.test(decodeURIComponent(hrefs[0])) && /wa\.me/.test(hrefs[1]) && /t\.me\/share/.test(hrefs[2]) && /reddit\.com\/submit/.test(hrefs[3]), tag + ' share links');
    ok(!hrefs.some((h) => BANNED.test(decodeURIComponent(h))), tag + ' share message: no prices / claims');
    ok(/get 5 days of Pro free/.test(decodeURIComponent(hrefs[1])), tag + ' share message says 5 days');
    // copy
    await page.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }; });
    await page.click('#referral-copy-btn');
    await page.waitForTimeout(100);
    ok(await page.evaluate(() => /ref=maya4821$/.test(window.__copied || '') && document.querySelector('#referral-copy-btn span').textContent === 'Copied' && document.getElementById('referral-copy-btn').classList.contains('is-copied')), tag + ' copy link (copied state)');
    ok(await page.evaluate(() => Array.from(document.querySelectorAll('.toast, [class*=toast]')).some((e) => /Invite link copied/.test(e.textContent))), tag + ' copy toast');
    ok(await page.evaluate(() => /^mailto:\?subject=/.test(document.getElementById('refx-share-em').getAttribute('href')) && !!document.getElementById('refx-share-dc')), tag + ' email + discord share');
    // alignment
    const al = await page.evaluate(() => {
      const r = (q) => { const e = typeof q === 'string' ? document.querySelector(q) : q; const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right, h: b.height, w: b.width, cy: b.top + b.height / 2, cx: b.left + b.width / 2 }; };
      const out = {};
      const inp = r('#referral-link-display'), cp = r('#referral-copy-btn');
      out.linkRowCy = Math.abs(inp.cy - cp.cy); out.linkH = [inp.h, cp.h];
      const ic = r('#referral-copy-btn svg'), lab = r('#referral-copy-btn span');
      out.copyIconCy = Math.abs(ic.cy - lab.cy);
      const btn = document.getElementById('referral-copy-btn'); const cs = getComputedStyle(btn);
      out.copyPadLR = [parseFloat(cs.paddingLeft), parseFloat(cs.paddingRight)];
      out.copyInnerLR = Math.abs((ic.l - cp.l) - (cp.r - lab.r));
      const soc = Array.from(document.querySelectorAll('.refx-soc:not([hidden])')).map((e) => r(e));
      out.socH = soc.map((s) => s.h);
      out.socIcon = Array.from(document.querySelectorAll('.refx-soc')).map((e) => { const a = r(e.querySelector('svg')), b = r(e.querySelector('span')), c = r(e); return Math.max(Math.abs(a.cy - c.cy), Math.abs(b.cy - c.cy)); });
      out.socInnerLR = Array.from(document.querySelectorAll('.refx-soc')).map((e) => { const a = r(e.querySelector('svg')), b = r(e.querySelector('span')), c = r(e); return Math.abs((a.l - c.l) - (c.r - b.r)); });
            out.rows = Array.from(document.querySelectorAll('#referral-invite-list .refx-row')).map((row) => { const a = r(row.querySelector('.refx-av')), w = r(row.querySelector('.refx-who')), s = r(row.querySelector('.refx-st')), rr = r(row); return Math.max(Math.abs(a.cy - rr.cy), Math.abs(w.cy - rr.cy), Math.abs(s.cy - rr.cy)); });
      out.chipText = Array.from(document.querySelectorAll('.refx-chip')).map((c) => { const k = r(c); const range = document.createRange(); range.selectNodeContents(c); const t = range.getBoundingClientRect(); return Math.abs((t.top + t.height / 2) - k.cy); });
      out.lbRows = Array.from(document.querySelectorAll('.refx-lb .refx-row')).map((row) => { const a = r(row.querySelector('.refx-rank')), p = r(row.querySelector('.refx-pts')), rr = r(row); return Math.max(Math.abs(a.cy - rr.cy), Math.abs(p.cy - rr.cy)); });
      out.ptsRight = (() => { const p = Array.from(document.querySelectorAll('.refx-pts')).map((e) => r(e).r); return Math.max(...p) - Math.min(...p); })();
      out.steps = Array.from(document.querySelectorAll('.refx-step-ic')).map((e) => { const k = r(e); const range = document.createRange(); range.selectNodeContents(e); const t = range.getBoundingClientRect(); return Math.max(Math.abs(t.top + t.height / 2 - k.cy), Math.abs(t.left + t.width / 2 - k.cx)); });
      out.clipped = Array.from(document.querySelectorAll('#main *')).filter((e) => { if (!e.offsetParent || e.closest('.refx-link, .sr-only')) return false; const cs = getComputedStyle(e); if (cs.textOverflow === 'ellipsis') return false; return e.children.length === 0 && e.scrollWidth > e.clientWidth + 1 && /hidden|clip/.test(cs.overflowX); }).map((e) => e.className || e.tagName);
      const panel = document.querySelector('.refx-share'); const pcs = getComputedStyle(panel); out.panelPad = [pcs.paddingLeft, pcs.paddingRight, pcs.paddingTop, pcs.paddingBottom];
      return out;
    });
    ok(al.linkRowCy <= 1 || vp.w < 641, tag + ' link input + copy share a centre (' + al.linkRowCy.toFixed(1) + ')');
    ok(Math.round(al.linkH[0]) === 48 && Math.round(al.linkH[1]) === 48, tag + ' input + button 48 px (' + al.linkH + ')');
    ok(al.copyIconCy <= 1, tag + ' copy icon centred with label (' + al.copyIconCy.toFixed(1) + ')');
    ok(al.copyInnerLR <= 1 || vp.w < 641, tag + ' copy button content centred L/R (' + al.copyInnerLR.toFixed(1) + ')');
    ok(al.socH.every((h) => h === 40), tag + ' share pills 40 px');
    ok(al.socIcon.every((d) => d <= 1), tag + ' share pill icon + text centred (' + al.socIcon.map((d) => d.toFixed(1)) + ')');
    ok(al.socInnerLR.every((d) => d <= 1 || vp.w < 641), tag + ' share pill padding even (' + al.socInnerLR.map((d) => d.toFixed(1)) + ')');
        ok(al.rows.every((d) => d <= 1), tag + ' invite rows: avatar / name / status share a centre (' + al.rows.map((d) => d.toFixed(1)) + ')');
    ok(al.chipText.every((d) => d <= 1), tag + ' chip text centred (' + al.chipText.map((d) => d.toFixed(1)) + ')');
    ok(al.lbRows.every((d) => d <= 1), tag + ' leaderboard rows centred');
    ok(al.ptsRight <= 1, tag + ' points right-aligned');
    ok(al.steps.every((d) => d <= 1), tag + ' step icons centred (' + al.steps.map((d) => d.toFixed(1)) + ')');
    ok(al.clipped.length === 0, tag + ' nothing clipped ' + al.clipped.join(','));
    ok(al.panelPad[0] === al.panelPad[1] && al.panelPad[2] === al.panelPad[3], tag + ' panel padding even ' + al.panelPad);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot('1-referrals-top');
    await shot('1-referrals-full', true);

    // ---------- empty
    await page.goto(BASE + '/referrals.html?sc=empty', { waitUntil: 'load' });
    await page.waitForFunction(() => /No one has joined/.test(document.getElementById('referral-invite-list').innerText), null, { timeout: 15000 });
    await page.waitForTimeout(300);
    await noOverflow('empty');
    const st2 = await page.evaluate(() => ['refx-verified', 'refx-days', 'refx-pending'].map((id) => document.getElementById(id).textContent));
    ok(st2.join() === '0,0,0', tag + ' empty stats 0 / 0 / 0');
    ok(await page.evaluate(() => /Your first invite gets you both 5 days/.test(document.getElementById('main').innerText) && !!document.getElementById('refx-empty-copy')), tag + ' friendly zero state + Copy link in the empty list');
    if (theme === 'dark') await shot('2-referrals-empty', true);

    // ---------- account menu entry
    await page.goto(BASE + '/referrals.html?sc=filled', { waitUntil: 'load' });
    await page.waitForSelector('#account-trigger', { timeout: 15000 });
    await page.click('#account-trigger');
    await page.waitForTimeout(200);
    const menu = await page.evaluate(() => { const a = document.querySelector('.account-item-invite'); if (!a) return null; const b = a.getBoundingClientRect(), s = a.querySelector('svg').getBoundingClientRect(); const range = document.createRange(); range.setStartAfter(a.querySelector('svg')); range.setEnd(a, a.childNodes.length); const t = range.getBoundingClientRect(); return { href: a.getAttribute('href'), txt: a.textContent.trim(), d: Math.max(Math.abs(s.top + s.height / 2 - (b.top + b.height / 2)), Math.abs(t.top + t.height / 2 - (b.top + b.height / 2))), overflow: a.scrollWidth > a.clientWidth + 1 }; });
    ok(menu && menu.href === 'referrals.html' && menu.txt === 'Invite friends, get Pro free', tag + ' account menu entry');
    ok(menu && menu.d <= 1 && !menu.overflow, tag + ' account menu entry aligned, not clipped');
    await shot('3-account-menu');

    // ---------- nudge (3rd active day), shown once, dismiss
    await page.goto(BASE + '/profile.html?sc=nudge', { waitUntil: 'load' });
    let nudged = await page.waitForSelector('#ref-nudge', { timeout: 8000 }).then(() => true).catch(() => false);
    ok(nudged, tag + ' nudge appears on the 3rd active day');
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => (window.__calls || []).some((c) => c.name === 'referralPing' && /^[0-9a-f]{32}$/.test(c.data.dev) && c.data.fp)), tag + ' activity ping sent with device id + fingerprint');
    if (nudged) {
      await page.waitForTimeout(300);
      const nd = await page.evaluate(() => { const n = document.getElementById('ref-nudge').getBoundingClientRect(); const kids = Array.from(document.querySelectorAll('#ref-nudge > *')).map((e) => { const b = e.getBoundingClientRect(); return Math.abs(b.top + b.height / 2 - (n.top + n.height / 2)); }); const dock = document.getElementById('appnav-dock'); const db = dock && getComputedStyle(dock).display !== 'none' ? dock.getBoundingClientRect().top : innerHeight; return { kids, inView: n.left >= 0 && n.right <= innerWidth && n.bottom <= db, txt: document.getElementById('ref-nudge').innerText }; });
      ok(nd.kids.every((d) => d <= 1), tag + ' nudge items share a centre (' + nd.kids.map((d) => d.toFixed(1)) + ')');
      ok(nd.inView, tag + ' nudge sits above the dock, inside the screen');
      ok(/Invite friends, get Pro free/.test(nd.txt) && !BANNED.test(nd.txt), tag + ' nudge wording');
      await page.mouse.move(5, vp.h / 2); await page.waitForTimeout(300);
      await shot('4-nudge');
      await page.click('.ref-nudge-x');
      ok(await page.evaluate(() => !document.getElementById('ref-nudge') && localStorage.getItem('tz_ref_nudge_done_u1') === '1'), tag + ' nudge dismissed for good');
      await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1500);
      ok(await page.evaluate(() => !document.getElementById('ref-nudge')), tag + ' nudge not shown again');
    }

    // ---------- signup ?ref=
    await page.goto(BASE + '/signup.html?ref=maya4821&sc=signup', { waitUntil: 'load' });
    const inv = await page.waitForSelector('#signup-invited', { timeout: 8000 }).then(() => true).catch(() => false);
    ok(inv, tag + ' sign-up shows the invite note');
    if (inv) {
      const it = await page.evaluate(() => { const n = document.getElementById('signup-invited'); const cs = getComputedStyle(n); return { t: n.innerText, pad: [cs.paddingLeft, cs.paddingRight, cs.paddingTop, cs.paddingBottom], v: document.getElementById('signup-referral').value }; });
      ok(it.t === 'You were invited by Maya. Join and you\'ll get 5 days of Pro free.', tag + ' invite note wording: ' + it.t);
      ok(it.v === 'maya4821', tag + ' code prefilled');
      await noOverflow('signup');
      await page.evaluate(() => document.getElementById('signup-invited').scrollIntoView({ block: 'center' }));
      await shot('5-signup-invited');
    }
    await page.goto(BASE + '/signup.html?ref=nosuchcode&sc=signup', { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    ok(await page.evaluate(() => !document.getElementById('signup-invited')), tag + ' unknown code: no note');

    // ---------- admin reward rules (no review queue: Owner 24 Nov)
    if (theme === 'dark' || !mobile) {
      await page.goto(BASE + '/referrals-admin.html?sc=admin', { waitUntil: 'load' });
      const loaded = await page.waitForFunction(() => document.getElementById('rr-cap') && document.getElementById('rr-cap').value !== '', null, { timeout: 15000 }).then(() => true).catch(() => false);
      ok(loaded, tag + ' admin: reward rules loaded');
      if (loaded) {
        ok(await page.evaluate(() => document.getElementById('rr-inviter-days').value === '5' && document.getElementById('rr-friend-days').value === '5' && document.getElementById('rr-cap').value === '365'), tag + ' admin rules show 5 / 5 / 365');
        ok(await page.evaluate(() => !document.getElementById('rr-held-list') && !document.getElementById('rr-daily') && !document.querySelector('#rr-ipmatch option[value="hold"]') && !/waiting for review|Approve/i.test(document.getElementById('main').innerText)), tag + ' admin: no review queue, no daily limit, no hold option');
        await page.evaluate(() => document.getElementById('rr-save').scrollIntoView({ block: 'center' }));
        await shot('6-admin-rules');
        await page.fill('#rr-cap', '200');
        await page.click('#rr-save');
        await page.waitForTimeout(300);
        const w = await page.evaluate(() => window.__writes.filter((x) => x.p === 'settings/referralRewards').map((x) => x.v));
        ok(w.length === 1 && w[0].capDaysPerYear === 200 && w[0].inviterDays === 5 && !('dailyVerifiedLimit' in w[0]) && w[0].ipMatch === 'block', tag + ' admin save writes the settings doc only ' + JSON.stringify(w[0] || {}));
        const bad = await page.evaluate(() => window.__writes.filter((w) => /^referralRewards\//.test(w.p) || (/^students\//.test(w.p) && /paidThrough|refPro|liveData|plan/.test(JSON.stringify(w.v)))).map((w) => w.p));
        ok(bad.length === 0, tag + ' admin page wrote no reward / plan field itself ' + bad.join(' | '));
        ok(await page.evaluate(() => !window.__calls.some((c) => c.name === 'referralRewardAdmin')), tag + ' admin page calls no review function');
      }
    }
    ok(errs.length === 0, tag + ' no page errors ' + errs.slice(0, 3).join(' | '));
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(SHOTS, 'shots.txt'), shots.join('\n') + '\n');
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
