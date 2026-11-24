// Client Firestore read budget (assets/progress.js installFsReadBudget, 24 Nov 2026 quota incident).
// Run: node tools/tests/fs-read-budget.test.mjs . A fake firebase compat SDK counts server reads; no network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../../assets/progress.js', import.meta.url), 'utf8');
const iife = src.slice(src.indexOf('(function installFsReadBudget'), src.indexOf('})();', src.indexOf('(function installFsReadBudget')) + 5);

function world(path = '/charts.html', ls = {}) {
  const docs = { 'students/u1': { plan: 'Pro', n: 1 }, 'settings/logo': { url: 'x.png' }, 'settings/site': { maintenance: false }, 'admins/boss': { at: 1 } };
  const plans = [{ id: 'pro', d: { name: 'Pro', rank: 1 } }, { id: 'free', d: { name: 'Free', rank: 0 } }];
  const W = { reads: 0, persist: 0, docs, plans }; // the SDK returns real snapshots; the fake keeps data by reference
  class Timestamp { constructor(s, n) { this.seconds = s; this.nanoseconds = n; } toMillis() { return this.seconds * 1000; } }
  class Query { get() { W.reads += plans.length; const q = this; const ds = plans.map((p) => ({ id: p.id, exists: true, data: () => p.d })); return Promise.resolve({ docs: ds, size: ds.length, empty: false, forEach: (cb) => ds.forEach(cb), query: q }); } }
  class CollectionReference extends Query { constructor(p) { super(); this.path = p; } doc(id) { return new DocumentReference(this.path + '/' + id); } add() { return Promise.resolve(); } }
  class DocumentReference {
    constructor(p) { this.path = p; this.id = p.split('/').pop(); }
    get() { W.reads++; const d = docs[this.path]; return Promise.resolve({ exists: !!d, id: this.id, data: () => d }); }
    set(v) { docs[this.path] = v; return Promise.resolve(); } update(v) { Object.assign(docs[this.path], v); return Promise.resolve(); } delete() { delete docs[this.path]; return Promise.resolve(); }
  }
  class WriteBatch { commit() { return Promise.resolve(); } }
  class Firestore { runTransaction(f) { return Promise.resolve(f()); } }
  const fsInst = { enablePersistence: () => { W.persist++; return Promise.resolve(); }, collection: (p) => new CollectionReference(p), doc: (p) => new DocumentReference(p) };
  const firestore = () => fsInst;
  Object.assign(firestore, { DocumentReference, Query, CollectionReference, Timestamp, WriteBatch, Firestore });
  const authCbs = []; const auth = { currentUser: { uid: 'u1' }, onAuthStateChanged: (cb) => { authCbs.push(cb); cb(auth.currentUser); } };
  const mk = (o) => ({ getItem: (k) => (k in o ? o[k] : null), setItem: (k, v) => { o[k] = String(v); }, removeItem: (k) => { delete o[k]; }, key: (i) => Object.keys(o)[i], get length() { return Object.keys(o).length; } });
  const ss = {};
  const win = { localStorage: mk(ls), sessionStorage: mk(ss) };
  const ctx = { firebase: { firestore, auth: () => auth }, window: win, location: { pathname: path }, JSON, Object, Array, Promise, Map, Date, String, Error };
  win.window = win;
  vm.createContext(ctx); vm.runInContext(iife, ctx);
  W.db = fsInst; W.win = win; W.auth = auth; W.authCbs = authCbs; W.ss = ss; W.Timestamp = Timestamp; W.WriteBatch = WriteBatch;
  // a second "page" in the same tab = same sessionStorage, new SDK + new install
  W.nextPage = (p2 = path) => { const n = world(p2, ls); Object.assign(n.ss, ss); n.win.sessionStorage = W.win.sessionStorage; return n; };
  return W;
}

// 1. students/{self}: 6 scripts on one page = 1 read
{
  const W = world(); const r = await Promise.all([1, 2, 3, 4, 5, 6].map(() => W.db.collection('students').doc('u1').get()));
  assert.equal(W.reads, 1, 'students/self shared'); assert.equal(r[5].data().plan, 'Pro');
  await W.db.collection('students').doc('u2').get(); assert.equal(W.reads, 2, 'other uid is never shared');
}
// 2. admins/bannedUsers/moderators of self: a "missing" is kept across pages (same tab), an existing doc never
{
  const ls = {}; const W = world('/charts.html', ls);
  for (const c of ['admins', 'bannedUsers', 'moderators']) { const s = await W.db.collection(c).doc('u1').get(); assert.equal(s.exists, false); }
  assert.equal(W.reads, 3);
  const P2 = world('/dashboard-user.html', ls); P2.win.sessionStorage = W.win.sessionStorage;
  vm.runInContext; // same tab
  for (const c of ['admins', 'bannedUsers', 'moderators']) { const s = await P2.db.collection(c).doc('u1').get(); assert.equal(s.exists, false); }
}
{
  const W = world(); W.auth.currentUser = { uid: 'boss' };
  await W.db.collection('admins').doc('boss').get(); await W.db.collection('admins').doc('boss').get();
  assert.equal(W.reads, 2, 'an admin doc that exists is always read live');
}
// cross-page with a shared sessionStorage
{
  const W = world();
  await W.db.collection('admins').doc('u1').get(); await W.db.collection('settings').doc('logo').get(); await W.db.collection('plans').get();
  const before = W.reads; assert.equal(before, 1 + 1 + 2);
  const s1 = await W.db.collection('admins').doc('u1').get(); const s2 = await W.db.collection('settings').doc('logo').get(); const s3 = await W.db.collection('plans').get();
  assert.equal(W.reads, before, 'second look: all from cache');
  assert.equal(s1.exists, false); assert.equal(s2.data().url, 'x.png'); assert.equal(s2.get('url'), 'x.png');
  let n = 0; s3.forEach((d) => { n++; assert.ok(d.data().name); }); assert.equal(n, 2); assert.equal(s3.docs[0].id, 'pro');
  // 3. a write drops the cache
  await W.db.collection('settings').doc('logo').set({ url: 'y.png' });
  const s4 = await W.db.collection('settings').doc('logo').get(); assert.equal(s4.data().url, 'y.png', 'fresh after own write');
  // non-whitelisted settings docs are never cached
  const r0 = W.reads; await W.db.collection('settings').doc('betaTesters').get(); await W.db.collection('settings').doc('betaTesters').get(); assert.equal(W.reads, r0 + 2);
  // source:'server' bypasses
  const r1 = W.reads; await W.db.collection('settings').doc('site').get(); await W.db.collection('settings').doc('site').get({ source: 'server' }); assert.equal(W.reads, r1 + 2);
}
// 4. Timestamps survive the cache
{
  const W = world(); W.docs['settings/site'] = { at: new W.Timestamp(100, 5), nest: { list: [1, { t: new W.Timestamp(7, 0) }] } };
  await W.db.collection('settings').doc('site').get(); const s = await W.db.collection('settings').doc('site').get();
  assert.equal(s.data().at.toMillis(), 100000); assert.equal(s.data().nest.list[1].t.seconds, 7);
}
// 5. admin / checkout pages: no cross-page cache
{
  const W = world('/admin-plans.html'); await W.db.collection('plans').get(); await W.db.collection('plans').get(); assert.equal(W.reads, 4);
  const C = world('/checkout.html'); await C.db.collection('settings').doc('commerce').get(); await C.db.collection('settings').doc('commerce').get(); assert.equal(C.reads, 2);
}
// 6. sign-out / switch user drops everything
{
  const W = world(); await W.db.collection('settings').doc('logo').get(); assert.ok(Object.keys(W.ss).length > 0);
  W.authCbs.forEach((cb) => cb(null)); assert.equal(Object.keys(W.ss).length, 0, 'cleared on sign-out');
}
// 7. kill switch + persistence switch
{
  const K = world('/charts.html', { tz_fs_nocache: '1' }); await K.db.collection('settings').doc('logo').get(); await K.db.collection('settings').doc('logo').get(); assert.equal(K.reads, 2); assert.equal(K.persist, 0);
  const P = world('/charts.html', { tz_fs_nopersist: '1' }); assert.equal(P.persist, 0);
  const D = world(); assert.equal(D.persist, 1, 'IndexedDB cache on by default');
}
// 8. a typical member page view: before = ~14 reads of these docs, after (2nd page in the tab) = 1 (students/self)
{
  const W = world();
  const view = async (db) => { await Promise.all([db.collection('students').doc('u1').get(), db.collection('students').doc('u1').get(), db.collection('students').doc('u1').get(),
    db.collection('admins').doc('u1').get(), db.collection('admins').doc('u1').get(), db.collection('bannedUsers').doc('u1').get(), db.collection('moderators').doc('u1').get(),
    db.collection('settings').doc('logo').get(), db.collection('settings').doc('favicon').get(), db.collection('settings').doc('site').get(), db.collection('settings').doc('commerce').get(),
    db.collection('plans').get()]); };
  await view(W.db); const first = W.reads; W.reads = 0;
  await new Promise((r) => setTimeout(r, 1));
  const realNow = Date.now; Date.now = () => realNow() + 11000; try { await view(W.db); } finally { Date.now = realNow; }
  console.log('fs-read-budget: page view reads first', first, 'next page', W.reads, '(no wrapper: 15)');
  assert.ok(first <= 10 && W.reads <= 1, first + " " + W.reads);
}
console.log('fs-read-budget: all ok');
