// TradeZoro — Firestore-backed student progress
// Requires firebase-app-compat.js, firebase-auth-compat.js, firebase-firestore-compat.js,
// and assets/auth.js (initializes the Firebase app + `auth`) to be loaded first.

// Guarded the same way `auth` is in auth.js: if Firebase failed to
// initialize upstream, calling firebase.firestore() here would throw
// synchronously and silently kill every script that loads after this one
// (chapters-store.js, reader.js, dashboard.js, etc. all depend on `db`).
// ---- Firestore read budget (24 Nov 2026 incident: the project hit its daily read quota) ----
// Every page used to re-read the same handful of documents on every page view: admins/{uid}, bannedUsers/{uid} and
// moderators/{uid} (which do NOT exist for members, still one billed read each), settings/* (logo, favicon, site,
// commerce, ...), the plans collection (twice), and students/{self} 5-7 times from different scripts. This layer
// answers those from a short cache instead; what members see does not change. Rules:
//  - students/{self}: concurrent and back-to-back reads on one page share ONE server read for 10 s (never across pages).
//  - admins|bannedUsers|moderators/{self}: a "does not exist" answer is kept for 10 min in sessionStorage (an existing
//    doc is never cached, so admins/moderators/bans are always read live; a new ban/admin bites within 10 min).
//  - settings/<public docs> and the plans collection: kept 5 min in sessionStorage.
//  - Any write from this page (set/update/delete, batch, transaction) drops the cache. Admin, checkout and plan-editing
//    pages never use the cross-page cache. Kill switch: localStorage tz_fs_nocache = '1'.
//  - Listeners (onSnapshot) keep working as before; with the IndexedDB cache on, a listener re-opened on the next page
//    resumes from its resume token and is billed only for changed docs (Firestore pricing: within 30 min).
(function installFsReadBudget(){
  if (typeof firebase === 'undefined' || !firebase.firestore || !firebase.firestore.DocumentReference) return;
  if (window.__tzFsBudget) return;
  window.__tzFsBudget = { hits: 0, misses: 0 };
  var ls = function(k){ try { return window.localStorage.getItem(k); } catch (e) { return null; } };
  if (ls('tz_fs_nocache') === '1') return;
  var FS = firebase.firestore, DR = FS.DocumentReference.prototype, Q = FS.Query.prototype;
  var origDocGet = DR.get, origQGet = Q.get;
  var PFX = 'tzfsc1:';
  var NOCROSS = /admin|checkout|coupon|commerce|plans-|pricing-admin|students|moderat/i.test(location.pathname);
  var SETTINGS = { commerce: 1, tradingview: 1, logo: 1, favicon: 1, site: 1, seo: 1, giveaways: 1, roadmap: 1, referralConfig: 1, pageAccess: 1, push: 1 };
  var SELF_ABSENT = { admins: 1, bannedUsers: 1, moderators: 1 };
  var mem = new Map();   // path -> { at, p } in-page promise share (students/{self})
  var stat = window.__tzFsBudget;
  var flying = new Map();   // key -> in-flight promise (two scripts asking at once share one read)
  function share(key, mk){ var f = flying.get(key); if (f) { stat.hits++; return f; } stat.misses++; f = mk(); flying.set(key, f); var done = function(){ if (flying.get(key) === f) flying.delete(key); }; f.then(done, done); return f; }
  var uidNow = function(){ try { var u = firebase.auth().currentUser; return u ? u.uid : ''; } catch (e) { return ''; } };
  var plainOpts = function(o){ return !o || !o.source || o.source === 'default'; };

  // JSON with Firestore Timestamps kept (any other special type: not cacheable)
  function enc(v){
    if (v === null || typeof v !== 'object') return v;
    if (v instanceof FS.Timestamp) return { __ts: [v.seconds, v.nanoseconds] };
    if (Array.isArray(v)) return v.map(enc);
    var proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) throw new Error('nocache');
    var o = {}; for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = enc(v[k]); return o;
  }
  function dec(v){
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(dec);
    if (v.__ts && Array.isArray(v.__ts) && Object.keys(v).length === 1) return new FS.Timestamp(v.__ts[0], v.__ts[1]);
    var o = {}; for (var k in v) o[k] = dec(v[k]); return o;
  }
  function sget(key, ttl){
    try { var o = JSON.parse(window.sessionStorage.getItem(PFX + key) || 'null'); return o && Date.now() - o.t < ttl ? o : null; } catch (e) { return null; }
  }
  function sput(key, o){ try { o.t = Date.now(); window.sessionStorage.setItem(PFX + key, JSON.stringify(o)); } catch (e) {} }
  function dropAll(){
    mem.clear(); flying.clear();
    try { var s = window.sessionStorage, ks = []; for (var i = 0; i < s.length; i++) { var k = s.key(i); if (k && k.indexOf(PFX) === 0) ks.push(k); } ks.forEach(function(k){ s.removeItem(k); }); } catch (e) {}
  }
  window.tzFsCacheClear = dropAll;
  function fakeDoc(ref, exists, data){
    return {
      exists: exists, id: ref.id, ref: ref, metadata: { fromCache: true, hasPendingWrites: false },
      data: function(){ return exists ? dec(data) : undefined; },
      get: function(f){ if (!exists) return undefined; var cur = dec(data); String(f).split('.').forEach(function(p){ cur = cur == null ? undefined : cur[p]; }); return cur; },
      isEqual: function(o){ return !!o && o.ref && o.ref.path === ref.path; }
    };
  }

  DR.get = function(opts){
    var ref = this, path = ref.path || '', parts = path.split('/');
    if (!plainOpts(opts) || parts.length !== 2) return origDocGet.apply(this, arguments);
    var col = parts[0], id = parts[1], me = uidNow(), args = arguments;
    // students/{self}: share one read per page for 10 s
    if (col === 'students' && me && id === me) {
      var h = mem.get(path);
      if (h && Date.now() - h.at < 10000) { stat.hits++; return h.p; }
      stat.misses++;
      var p = origDocGet.apply(ref, args);
      mem.set(path, { at: Date.now(), p: p });
      p.catch(function(){ if (mem.get(path) && mem.get(path).p === p) mem.delete(path); });
      return p;
    }
    if (NOCROSS) return origDocGet.apply(this, arguments);
    // admins / bannedUsers / moderators of the signed-in user: only a "does not exist" is kept
    if (SELF_ABSENT[col] && me && id === me) {
      var key = path + '|' + me;
      if (sget(key, 600000)) { stat.hits++; return Promise.resolve(fakeDoc(ref, false)); }
      return share(key, function(){ return origDocGet.apply(ref, args).then(function(s){ if (s && !s.exists) sput(key, { x: 0 }); return s; }); });
    }
    if (col === 'settings' && SETTINGS[id]) {
      var c = sget(path, 300000);
      if (c) { stat.hits++; return Promise.resolve(fakeDoc(ref, !!c.e, c.d)); }
      return share(path, function(){ return origDocGet.apply(ref, args).then(function(s){
        try { if (s) sput(path, s.exists ? { e: 1, d: enc(s.data()) } : { e: 0 }); } catch (e) {}
        return s;
      }); });
    }
    return origDocGet.apply(this, arguments);
  };

  // the whole plans collection (pricing, role access): 5 min
  Q.get = function(opts){
    var q = this;
    if (NOCROSS || !plainOpts(opts) || !(q instanceof FS.CollectionReference) || q.path !== 'plans') return origQGet.apply(this, arguments);
    var c = sget('plans', 300000);
    if (c && Array.isArray(c.docs)) {
      stat.hits++;
      var docs = c.docs.map(function(d){ return fakeDoc(q.doc(d.id), true, d.d); });
      return Promise.resolve({ docs: docs, size: docs.length, empty: !docs.length, query: q, metadata: { fromCache: true, hasPendingWrites: false },
        forEach: function(cb, th){ docs.forEach(function(d){ cb.call(th, d); }); }, docChanges: function(){ return []; } });
    }
    var qa = arguments;
    return share('plans', function(){ return origQGet.apply(q, qa).then(function(snap){
      try { sput('plans', { docs: snap.docs.map(function(d){ return { id: d.id, d: enc(d.data()) }; }) }); } catch (e) {}
      return snap;
    }); });
  };

  // any write from this page drops the cache (so a page never re-reads its own stale copy)
  ['set', 'update', 'delete'].forEach(function(m){
    var o = DR[m]; if (typeof o !== 'function') return;
    DR[m] = function(){ dropAll(); var r = o.apply(this, arguments); if (r && r.then) r.then(dropAll, function(){}); return r; };
  });
  if (FS.WriteBatch && FS.WriteBatch.prototype.commit) {
    var oc = FS.WriteBatch.prototype.commit;
    FS.WriteBatch.prototype.commit = function(){ dropAll(); var r = oc.apply(this, arguments); if (r && r.then) r.then(dropAll, function(){}); return r; };
  }
  if (FS.Firestore && FS.Firestore.prototype.runTransaction) {
    var ot = FS.Firestore.prototype.runTransaction;
    FS.Firestore.prototype.runTransaction = function(){ dropAll(); var r = ot.apply(this, arguments); if (r && r.then) r.then(function(v){ dropAll(); return v; }, function(){}); return r; };
  }
  if (FS.CollectionReference && FS.CollectionReference.prototype.add) {
    var oa = FS.CollectionReference.prototype.add;
    FS.CollectionReference.prototype.add = function(){ if (this.path === 'plans') dropAll(); return oa.apply(this, arguments); };
  }
  // sign-in / sign-out / account switch: the per-user entries are keyed by uid; drop everything on a change anyway
  try { var lastU = null; firebase.auth().onAuthStateChanged(function(u){ var n = u ? u.uid : ''; if (lastU !== null && lastU !== n) dropAll(); lastU = n; }); } catch (e) {}

  // IndexedDB cache: listeners resume instead of re-reading every doc on each page view. Must run before any other use.
  if (ls('tz_fs_nopersist') !== '1') {
    try { firebase.firestore().enablePersistence({ synchronizeTabs: true }).catch(function(){}); } catch (e) {}
  }
})();

let db = null;
try {
  db = firebase.firestore();
} catch (err) {
  console.error('TradeZoro: Firestore failed to initialize', err);
}

function todayStr(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function daysBetween(a, b){
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((new Date(b) - new Date(a)) / msPerDay);
}

// Creates the student's Firestore doc on first sign-in, and advances their
// study streak at most once per calendar day. Safe to call on every page load
// — it's a no-op write if nothing has changed since today.
// First-touch attribution (see assets/acquisition.js). Returns the stored
// landing record shaped for the student doc, or null when there is none.
// Only these five keys are ever written, all short strings.
function acquisitionForStudentDoc(){
  let a = null;
  try { a = JSON.parse(localStorage.getItem('stryker_acq') || 'null'); } catch (e) {}
  if (!a || typeof a !== 'object') return null;
  const s = (v, n) => String(v || '').slice(0, n || 100);
  return {
    source: s(a.source), medium: s(a.medium), campaign: s(a.campaign),
    referrer: s(a.referrer, 200), landedAt: s(a.landedAt, 40)
  };
}

// Saves first touch onto an existing student doc if it has none yet. Used
// after a paid checkout for accounts created before tracking existed.
// Never overwrites: the first recorded touch stays the source of record.
function saveAcquisitionIfMissing(uid){
  const acq = acquisitionForStudentDoc();
  if (!uid || !acq) return Promise.resolve(false);
  const ref = db.collection('students').doc(uid);
  return ref.get().then(snap => {
    if (!snap.exists || snap.data().acquisition) return false;
    return ref.update({ acquisition: acq }).then(() => true);
  }).catch(err => { console.warn('TradeZoro: acquisition not saved', err && err.code); return false; });
}

function ensureStudentDoc(user){
  if (!user) return Promise.resolve(null);
  const ref = db.collection('students').doc(user.uid);
  // Resolved up front because both branches below need it: new accounts start
  // on it, and existing accounts sitting on a null plan get healed onto it.
  const defaultPlan = (typeof resolveDefaultPlanName === 'function')
    ? resolveDefaultPlanName()
    : Promise.resolve('Starter');

  return Promise.all([ref.get(), defaultPlan]).then(([snap, planName]) => {
    const today = todayStr();

    if (!snap.exists) {
      let referralPark = Promise.resolve();
      const data = {
        displayName: user.displayName || '',
        email: user.email || '',
        photoURL: user.photoURL || null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastActiveDate: today,
        currentStreak: 1,
        bestStreak: 1,
        completedLessons: [],
        completedChapters: [],
        // Everyone starts on the entry plan. A null plan used to mean "no
        // access to anything", which made plan-guard throw an upgrade modal
        // at people the moment they finished signing up — before they'd seen
        // a single page. Gating is now opt-in per page instead.
        plan: planName
      };
      // Where this person first arrived from (utm tags / referrer), if the
      // browser recorded it. Absent rather than empty when there is nothing.
      // Our own e2e probes set this flag so their accounts can be hidden and swept.
      try { if (localStorage.getItem('tz_test_user') === '1') data.test = true; } catch (e) { /* ignore */ }
      const acquisition = acquisitionForStudentDoc();
      if (acquisition) data.acquisition = acquisition;
      return ref.set(data).then(() => {
        // Non-blocking: resolve any pending ?ref= invite code from signup.
        // A failure here should never prevent the student doc itself from
        // being created, so it's intentionally not chained into the return.
        // Parking the code is now awaited (see referralPark below) rather than
        // fired and forgotten, so the deferred completion step at the end of
        // this branch can act on it in the same page load. For a Google
        // signup, which is verified from the very first moment, that means the
        // referrer is credited immediately instead of one navigation later.
        referralPark = (typeof processPendingReferralForNewStudent === 'function')
          ? processPendingReferralForNewStudent(user.uid, data.displayName, data.email)
          : Promise.resolve();
        // Non-blocking: bump the public "traders enrolled" counter shown on
        // the homepage. This is a separate count-only doc, not a query
        // against the students collection itself — see main.js for why.
        db.collection('publicStats').doc('enrollment')
          .set({ count: firebase.firestore.FieldValue.increment(1) }, { merge: true })
          .catch((err) => console.error('TradeZoro: failed to update enrolled count', err));
        // Non-blocking: seed this student's public profile doc (see
        // assets/profiles-sync.js for why this is a separate collection).
        if (typeof syncPublicProfile === 'function') {
          syncPublicProfile(user.uid, {
            displayName: data.displayName,
            photoURL: data.photoURL,
            createdAt: data.createdAt,
            currentStreak: data.currentStreak,
            bestStreak: data.bestStreak,
            plan: data.plan
          });
        }
      }).then(() => referralPark).then(() => ref.get()).then(s => {
        const student = Object.assign({ uid: user.uid }, s.data());
        if (typeof processPendingReferralIfReady === 'function') {
          processPendingReferralIfReady(user.uid, student);
        }
        return student;
      });
    }

    const data = snap.data();
    const updates = {
      displayName: user.displayName || data.displayName || '',
      email: user.email || data.email || ''
    };
    // Accounts created before the entry plan became the default carry a null
    // plan, which still reads as "blocked from everything". Heal them on next
    // sign-in rather than requiring a manual backfill. Only ever fills an
    // ABSENT plan — never overwrites one an admin has set.
    if (!data.plan && planName) updates.plan = planName;
    // Refresh the Google photo if one is newly available and no custom
    // upload is set — a custom upload always wins and is never overwritten.
    if (user.photoURL && !data.customPhotoURL && user.photoURL !== data.photoURL) {
      updates.photoURL = user.photoURL;
    }

    if (data.lastActiveDate !== today) {
      const gap = daysBetween(data.lastActiveDate, today);
      const newStreak = (gap === 1) ? (data.currentStreak || 0) + 1 : 1;
      updates.currentStreak = newStreak;
      updates.bestStreak = Math.max(newStreak, data.bestStreak || 0);
      updates.lastActiveDate = today;
    }

    return ref.set(updates, { merge: true }).then(() => {
      // Non-blocking: keep the public profile's copy of these specific
      // fields current. Deliberately excludes `email` (never public) and
      // doesn't touch avatarSeed/customPhotoURL/plan — those are synced by
      // whichever file actually owns that change (settings.js, students-admin.js).
      if (typeof syncPublicProfile === 'function') {
        const profileUpdate = { displayName: updates.displayName };
        if (updates.plan) profileUpdate.plan = updates.plan;
        if (updates.photoURL) profileUpdate.photoURL = updates.photoURL;
        if (updates.currentStreak !== undefined) profileUpdate.currentStreak = updates.currentStreak;
        if (updates.bestStreak !== undefined) profileUpdate.bestStreak = updates.bestStreak;
        syncPublicProfile(user.uid, profileUpdate);
      }
    }).then(() => ref.get()).then(s => {
      const student = Object.assign({ uid: user.uid }, s.data());
      // Non-blocking: finish any referral that was parked at signup but
      // couldn't be written until the account was email-verified. Runs on
      // every load and bails immediately when there's nothing parked.
      if (typeof processPendingReferralIfReady === 'function') {
        processPendingReferralIfReady(user.uid, student);
      }
      return student;
    });
  });
}

function getStudentDoc(uid){
  return db.collection('students').doc(uid).get()
    .then(snap => snap.exists ? Object.assign({ uid }, snap.data()) : null);
}

function saveStudentProgress(uid, completedLessonsSet, completedChaptersSet){
  // Non-blocking: keep the public profile's chapter/lesson COUNTS current —
  // not the actual lists, which stay private. A count is enough to compute
  // most achievement badges (first chapter, curriculum complete, lesson
  // milestones) without revealing exactly which chapters someone's done.
  if (typeof syncPublicProfile === 'function') {
    syncPublicProfile(uid, {
      completedChaptersCount: completedChaptersSet.size,
      completedLessonsCount: completedLessonsSet.size
    });
  }
  return db.collection('students').doc(uid).set({
    completedLessons: Array.from(completedLessonsSet),
    completedChapters: Array.from(completedChaptersSet)
  }, { merge: true });
}
