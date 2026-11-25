// Charts WORKSPACES browser test (assets/chart-workspaces.js). No network: recorded NQ bars (phone-layouts-lib.js)
// + an in-memory Firestore in this node process shared by every page of a context (the "server"), so a reload
// reads back what the page wrote. The rules themselves: tools/tests/chart-workspaces-rules-test.py.
//   node tools/tests/chart-fixture-server.mjs 8263 tools/tests/fixtures/empty.json   (or python3 -m http.server)
//   CHART_BASE=http://127.0.0.1:8263 flock -w 3600 /tmp/stryker-chrome.lock node tools/tests/chart-workspaces-browser.js <outDir>
// Checks: create 2 workspaces with different symbols + grids + panels, switch back and forth (tabs, list,
// Ctrl+2 / Ctrl+1), reload -> both restored (index + charts), rename, drag reorder, delete, signed-out mode,
// phone bottom sheet; screenshots at 390 / 412 / 1440 in dark + light.
const fs = require('fs');
const { launch } = require('./lib.js');
const { newCtx, sleep } = require('./phone-layouts-lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8263';
const OUT = process.argv[2] || '.';
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const t = (n, ok, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };

const DB = new Map();
DB.set('students/alice', { name: 'Alice', plan: 'Elite', residenceCountry: 'US', sanctionsAttest: true, emailVerified: true });   // geo gate already answered
const rev = (v) => { if (Array.isArray(v)) return v.map(rev); if (v && typeof v === 'object') { if (v.__ts) return { __ms: Date.now() }; const o = {}; for (const k in v) o[k] = rev(v[k]); return o; } return v; };
const denied = () => { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; throw e; };
const mine = (uid, path) => { const s = path.split('/'); return !!uid && (s[0] !== 'students' || s[1] === uid); };
let writes = 0;
const server = {
  get: (uid, path) => { if (!mine(uid, path)) denied(); return { exists: DB.has(path), data: DB.get(path) || null }; },
  commit: (uid, ws) => {
    ws.forEach((w) => { if (!mine(uid, w.path)) denied(); });
    ws.forEach((w) => {
      writes++;
      const cur = DB.get(w.path);
      if (w.op === 'delete') DB.delete(w.path);
      else if (w.op === 'set') DB.set(w.path, w.merge && cur ? Object.assign({}, cur, rev(w.data)) : rev(w.data));
      else { if (!cur) throw Object.assign(new Error('not-found'), { code: 'not-found' }); DB.set(w.path, Object.assign({}, cur, rev(w.data))); }
    });
    return true;
  },
  query: (uid, coll) => {
    if (!mine(uid, coll)) denied();
    const n = coll.split('/').length;
    return [...DB.entries()].filter(([p]) => p.startsWith(coll + '/') && p.split('/').length === n + 1).map(([p, d]) => ({ id: p.split('/').pop(), data: d }));
  }
};
function mockInit() {
  const cl = (v) => JSON.parse(JSON.stringify(v));
  const back = (v) => { if (Array.isArray(v)) return v.map(back); if (v && typeof v === 'object') { if (v.__ms !== undefined) return { toMillis: () => v.__ms, toDate: () => new Date(v.__ms) }; const o = {}; for (const k in v) o[k] = back(v[k]); return o; } return v; };
  const U = () => window.__UID;
  const snap = (id, r) => ({ id, exists: !!r.exists, data: () => (r.exists ? back(cl(r.data)) : undefined) });
  const FV = { serverTimestamp: () => ({ __ts: 1 }), increment: (n) => ({ __inc: n }), delete: () => 'DEL', arrayUnion: () => 'AU', arrayRemove: () => 'AR' };
  const ref = (path) => ({ id: path.split('/').pop(), path,
    get: () => window.__fs('get', U(), path).then((r) => snap(path.split('/').pop(), r)),
    set: (d, o) => window.__fs('commit', U(), [{ op: 'set', path, data: d, merge: !!(o && o.merge) }]),
    update: (d) => window.__fs('commit', U(), [{ op: 'update', path, data: d }]),
    delete: () => window.__fs('commit', U(), [{ op: 'delete', path }]),
    onSnapshot: (cb) => { ref(path).get().then(cb); return () => {}; },
    collection: (s) => col(path + '/' + s) });
  const col = (path) => { const self = {
    doc: (id) => ref(path + '/' + (id || Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12))),
    where: () => self, orderBy: () => self, limit: () => self, startAfter: () => self,
    get: () => window.__fs('query', U(), path).then((rows) => { const docs = rows.map((r) => snap(r.id, { exists: true, data: r.data })); return { docs, empty: !docs.length, size: docs.length, forEach: (f) => docs.forEach(f), docChanges: () => [] }; }),
    add: async (d) => { const r = self.doc(); await r.set(d); return r; },
    onSnapshot: (cb) => { self.get().then(cb); return () => {}; } }; return self; };
  const db = { collection: col, doc: (p) => ref(p), batch: () => { const w = []; const b = { set: (r, d, o) => { w.push({ op: 'set', path: r.path, data: d, merge: !!(o && o.merge) }); return b; }, update: (r, d) => { w.push({ op: 'update', path: r.path, data: d }); return b; }, delete: (r) => { w.push({ op: 'delete', path: r.path }); return b; }, commit: () => window.__fs('commit', U(), w) }; return b; } };
  window.__stubDb = db; window.db = db;
  window.firebase.apps = [{}];
  window.firebase.firestore = Object.assign(() => db, { FieldValue: FV, Timestamp: { now: () => ({ toDate: () => new Date() }), fromDate: (d) => ({ toDate: () => d }) } });
  if (!U()) { window.__stubAuth.currentUser = null; window.__stubAuth.onAuthStateChanged = (cb) => { setTimeout(() => cb(null), 10); return () => {}; }; }
  else { const u = window.__stubAuth.currentUser; u.uid = U(); }
}
async function session(b, uid, w, h, mobile, theme) {
  const ctx = await newCtx(b, { w, h, mobile });
  await ctx.exposeFunction('__fsRaw', async (op, u, ...a) => { try { return { ok: server[op](u, ...a) }; } catch (e) { return { err: e.code || 'error', msg: e.message }; } });
  await ctx.addInitScript(([u, th]) => {
    window.__UID = u;
    window.__fs = (...a) => window.__fsRaw(...a).then((r) => { if (r.err) { const e = new Error(r.msg); e.code = r.err; throw e; } return r.ok; });
    try { localStorage.setItem('stryker_theme', th === 'light' ? 'day' : 'night'); localStorage.setItem('stryker_chart_theme', th === 'light' ? 'light' : 'dark'); } catch (e) {}
  }, [uid, theme || 'dark']);
  await ctx.addInitScript('(' + mockInit.toString() + ')()');
  return ctx;
}
async function open(ctx, page){
  const p = page || await ctx.newPage();
  if (!page) { p.errs = []; p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) p.errs.push(String(e).slice(0, 200)); }); p.on('dialog', (d) => d.accept()); }
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_LAYOUTS && window.STRYKER_WORKSPACES, null, { timeout: 60000 });
  await sleep(2500);
  return p;
}
const shot = (p, n) => p.screenshot({ path: OUT + '/' + n + '.png' });
const W = (p, fn, a) => p.evaluate(fn, a);
// what is on screen: grid + each visible chart's symbol / interval
const screen = (p) => W(p, () => { const s = window.STRYKER_VELA.getState(); const n = (/^(\d+)/.exec(s.layout || '') || [0, 1])[1]; return { layout: s.layout, charts: s.charts.slice(0, +n).map((c) => c.symbol + '@' + c.timeframe) }; });
const waitIdle = (p) => p.waitForFunction(() => !window.STRYKER_WORKSPACES.busy, null, { timeout: 15000 }).then(() => sleep(1500));
// Owner 24 Nov: workspace tabs look like browser tabs (desktop >= 901 px). No border between the active tab and the toolbar,
// inactive tabs have no box, one centre line, no overflow. Shots: 1440 dark+light with 3 and 8 tabs, 1024, 390.
const geo = (p) => W(p, () => {
  const cs = (e) => getComputedStyle(e), tabs = [...document.querySelectorAll('#stkws-tabs .stkws-tab')].filter((x) => x.offsetWidth > 0), on = tabs.find((x) => x.classList.contains('on')), off = tabs.filter((x) => x !== on);
  const r = (e) => e.getBoundingClientRect(), c = (e) => { const q = e.matches('.stkws-tab') ? e.querySelector('.stkws-tn') : e; const b = r(q); return b.top + b.height / 2; };
  const hdr = document.querySelector('.mobile-topnav'), plus = document.querySelector('.stkws-plus');
  const nb = on && cs(on); const toolbarBg = on && cs(document.body).backgroundColor;
  return {
    n: document.querySelectorAll('#stkws-tabs .stkws-tab').length, h: Math.round((document.getElementById('stkws-tabs') ? r(document.getElementById('stkws-tabs')).height : 0)),
    onBottomBorder: nb && nb.borderBottomWidth, onBg: nb && nb.backgroundColor, onRadius: nb && nb.borderTopLeftRadius, onBottomRadius: nb && nb.borderBottomLeftRadius,
    offBox: off.map((x) => { const s = cs(x); return [s.backgroundColor, s.borderTopColor, s.borderLeftColor, s.boxShadow].join('|'); }),
    widths: tabs.map((x) => Math.round(r(x).width)),
    plusSize: plus && [Math.round(r(plus).width), Math.round(r(plus).height)],
    plusAfterLast: plus && tabs.length && r(plus).left >= r(tabs[tabs.length - 1]).right - 1,
    centreSpread: plus && tabs.length ? Math.max(c(plus), ...tabs.map(c)) - Math.min(c(plus), ...tabs.map(c)) : 0,
    toolbarGap: on && (() => { const tb = document.getElementById('stkc-bar'); return tb ? Math.round(r(tb).top - r(on).bottom) : null; })(), onBorderB: nb && nb.borderBottomStyle, moreShown: !!document.querySelector('.stkws-more') && document.querySelector('.stkws-more').offsetWidth > 0 && document.querySelector('.stkws-more b').textContent === '0',
    hscroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    clipped: tabs.filter((x) => x.scrollWidth > x.clientWidth + 1 && cs(x.querySelector('.stkws-tn')).textOverflow !== 'ellipsis').length
  };
});
(async () => {
  const b = await launch();
  try {
    for (const theme of ['dark', 'light']) {
      const A = await session(b, 'alice', 1440, 900, false, theme);
      const a = await open(A);
      if (theme === 'light') { await a.evaluate(() => window.setStrykerTheme('day')); await sleep(1200); }
      for (const n of [3, 8]) {
        while ((await geo(a)).n < n) { await W(a, () => window.STRYKER_WORKSPACES.createNew('Workspace ' + (window.STRYKER_WORKSPACES.index.items.length + 1))); await waitIdle(a); }
        await a.mouse.move(700, 500); await sleep(300);
        const g = await geo(a);
        t(theme + ' ' + n + ' tabs: active tab no bottom border (joins the toolbar), top radius 8', g.onBottomBorder === '0px' && g.onRadius === '8px', g);
        t(theme + ' ' + n + ' tabs: no border/gap between active tab and toolbar, no empty "0 more"', g.onBorderB === 'none' && g.toolbarGap <= 1 && !g.moreShown, g);
        t(theme + ' ' + n + ' tabs: inactive tabs transparent, no border/shadow box', g.offBox.every((s) => /^rgba\(0, 0, 0, 0\)\|rgba\(0, 0, 0, 0\)\|rgba\(0, 0, 0, 0\)\|none$/.test(s)), g.offBox);
        t(theme + ' ' + n + ' tabs: widths 120..220, + 28px after the last, one centre line, no scroll', g.widths.every((w) => w >= 119 && w <= 221) && g.plusSize[0] === 28 && g.plusAfterLast && g.centreSpread <= 1 && g.hscroll === 0, g);
        t(theme + ' ' + n + ' tabs: strip <= 40px, text never clipped without ellipsis', g.h <= 40 && g.clipped === 0, g);
        await shot(a, 'wstabs-1440-' + theme + '-' + n);
      }
      // hover an inactive tab: highlight appears, shape intact; close x on active
      await a.hover('.stkws-tab:not(.on) >> nth=0'); await sleep(250);
      t(theme + ' hover: close x visible on hover + active', await W(a, () => [...document.querySelectorAll('.stkws-tab')].filter((x) => x.matches('.on,:hover')).every((x) => getComputedStyle(x.querySelector('.stkws-x')).opacity === '1')));
      await shot(a, 'wstabs-1440-' + theme + '-hover');
      if (theme === 'dark') {
        await a.setViewportSize({ width: 1024, height: 768 }); await sleep(600);
        const g = await geo(a);
        t('1024: no scroll, one centre line, strip <= 40', g.hscroll === 0 && g.centreSpread <= 1 && g.h <= 40, g);
        await shot(a, 'wstabs-1024-dark');
        await a.setViewportSize({ width: 390, height: 844 }); await sleep(600);
        t('390: no horizontal scroll', (await geo(a)).hscroll === 0);
        await shot(a, 'wstabs-390-dark');
      }
      t('no page errors', A && a.errs.length === 0, a.errs);
      await A.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
