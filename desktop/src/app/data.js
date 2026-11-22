// TradeZoro Desktop 2.0: data layer for the native screens. Same sources as the Android app and the site:
//  - Firebase Auth + Firestore with the site's own config (window.TZ_FIREBASE), default app, LOCAL persistence:
//    the same IndexedDB session the embedded chart page uses (one sign-in for both).
//  - tradezoro.com APIs (same origin): /api/chart/bars, /api/gex/levels, /api/passkey, /api/desktop handoff.
//  - Public crypto klines (data-api mirror), Market Stats scan worker (same as assets/market-stats.js).
// In a STUB run (tests only, data-stub="1") every call returns labelled sample data and nothing touches the network.
(function () {
  'use strict';
  var C = window.TZCore;
  var STUB = document.documentElement.getAttribute('data-stub') === '1';
  var SITE = 'https://tradezoro.com';
  var CRYPTO = 'https://data-api.binance.vision/api/v3';
  var MS_API = 'https://book-recorder.theelitegrey.workers.dev/scan?part=';

  var listeners = [], user = null, authReady = false;
  function emit() { listeners.forEach(function (f) { try { f(user); } catch (e) { console.warn(e); } }); }

  var fb = null;
  if (STUB) authReady = true;   // tests start signed out
  else {
    fb = firebase.initializeApp(window.TZ_FIREBASE);
    firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function () {});
    firebase.auth().onAuthStateChanged(function (u) { user = u; authReady = true; emit(); });
  }
  var db = function () { return firebase.firestore(); };
  var ts = function () { return firebase.firestore.FieldValue.serverTimestamp(); };
  var me = function () { return db().collection('students').doc(user.uid); };

  function token() { return user && !STUB ? user.getIdToken() : Promise.resolve(null); }
  function getJson(url, auth) {
    return (auth ? token() : Promise.resolve(null)).then(function (t) {
      var h = { accept: 'application/json' };
      if (t) h.authorization = 'Bearer ' + t;
      return fetch(url, { headers: h, cache: 'no-store', credentials: 'omit' });
    }).then(function (r) { if (!r.ok) { var e = new Error('http ' + r.status); e.status = r.status; throw e; } return r.json(); });
  }

  // ---------- auth ----------
  var Auth = {
    onChange: function (f) { listeners.push(f); if (authReady) f(user); },
    user: function () { return user; },
    email: function (email, pass) { return firebase.auth().signInWithEmailAndPassword(String(email).trim(), pass); },
    reset: function (email) { return firebase.auth().sendPasswordResetEmail(String(email).trim()); },
    // Google: system browser + loopback / tradezoro:// (src/handoff.js), then a Firebase custom token.
    google: function () { return window.tzApp.googleSignIn().then(function (r) { return firebase.auth().signInWithCustomToken(r.token); }); },
    cancelGoogle: function () { window.tzApp.cancelGoogleSignIn(); },
    passkeySupported: function () { return !STUB && !!window.PublicKeyCredential && !!navigator.credentials; },
    // Same calls as assets/passkeys.js signIn(): /api/passkey/login/options -> credentials.get -> /login/verify -> custom token.
    passkey: function () {
      var b64 = function (buf) { var s = '', a = new Uint8Array(buf); for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
      var unb64 = function (s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a.buffer; };
      var api = function (p, body) {
        return fetch(SITE + '/api/passkey' + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit' })
          .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j && j.error || 'Passkey sign-in failed.'); return j; }); });
      };
      return api('/login/options', {}).then(function (o) {
        var pk = o.publicKey; pk.challenge = unb64(pk.challenge);
        if (pk.allowCredentials) pk.allowCredentials.forEach(function (c) { c.id = unb64(c.id); });
        return navigator.credentials.get({ publicKey: pk });
      }).then(function (c) {
        if (!c) throw new Error('No passkey chosen.');
        var r = c.response;
        return api('/login/verify', { id: c.id, rawId: b64(c.rawId), response: { clientDataJSON: b64(r.clientDataJSON), authenticatorData: b64(r.authenticatorData),
          signature: b64(r.signature), userHandle: r.userHandle ? b64(r.userHandle) : null } });
      }).then(function (j) { return firebase.auth().signInWithCustomToken(j.token); });
    },
    signOut: function () { return STUB ? (user = null, emit(), Promise.resolve()) : firebase.auth().signOut(); },
    // tests: a signed-in sample member, no network
    stubSignIn: function () { if (STUB) { user = { uid: 'sample', email: 'sample@example.com', displayName: 'Sample member', photoURL: null }; authReady = true; emit(); } },
    stubSignedOut: function () { if (STUB) { user = null; authReady = true; emit(); } }
  };

  // ---------- quotes (QuoteRepository.kt) ----------
  function quote(sym) {
    if (STUB) return Promise.resolve(Sample.quote(sym));
    if (sym.source === 'crypto') {
      return Promise.all([getJson(CRYPTO + '/klines?symbol=' + sym.chartTicker + '&interval=1d&limit=2'), getJson(CRYPTO + '/klines?symbol=' + sym.chartTicker + '&interval=15m&limit=32')])
        .then(function (a) { return C.quoteFrom(C.parseKlines(a[0]), C.parseKlines(a[1]), true); });
    }
    if (sym.source === 'other') return Promise.reject(new Error('no quote source'));
    var base = SITE + '/api/chart/bars/' + encodeURIComponent(sym.chartTicker), fut = sym.source === 'futures';
    return Promise.all([getJson(base + '?tf=D', fut), getJson(base + '?tf=15', fut)]).then(function (a) {
      var d = C.parseSiteBars(a[0]), i = C.parseSiteBars(a[1]);
      var more = d.bars.length < 2 && d.page > 0 ? getJson(base + '?tf=D&page=' + (d.page - 1), fut).then(function (p) { return C.parseSiteBars(p).bars.concat(d.bars); }) : Promise.resolve(d.bars);
      return more.then(function (daily) { return C.quoteFrom(daily, i.bars, d.rt || !fut); });
    });
  }

  // ---------- watchlists (Watchlists.kt, assets/chart-watchlist.js) ----------
  var GUEST_WL = 'stryker_watchlists_guest';
  var lsGet = function (k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  var lsSet = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full */ } };
  var Watchlists = {
    list: function () {
      if (STUB) return Promise.resolve(Sample.lists.map(function (l) { return C.wlFrom(l.id, l); }));
      if (!user) {
        var g = lsGet(GUEST_WL, []);
        return Promise.resolve((Array.isArray(g) && g.length ? g : [{ id: 'guest', name: 'Watchlist', items: C.DEFAULT_ITEMS }]).map(function (l) { return C.wlFrom(l.id, l); }));
      }
      return me().collection('watchlists').get().then(function (s) {
        var ls = s.docs.map(function (d) { return C.wlFrom(d.id, d.data()); });
        if (ls.length) return ls;
        // a new member's first list, same as the site (chart-watchlist.js DEFAULT_ITEMS)
        var first = { id: C.newListId(), name: 'Watchlist', items: C.DEFAULT_ITEMS.slice(), collapsed: [], view: {}, shared: false };
        return Watchlists.save(first).then(function () { return [first]; });
      });
    },
    active: function () {
      if (STUB || !user) return Promise.resolve(lsGet('stryker_wl_active_' + (user ? user.uid : 'guest'), null));
      return me().collection('watchlistPrefs').doc('active').get().then(function (d) { return d.exists && d.data().id || null; }, function () { return null; });
    },
    setActive: function (id) {
      lsSet('stryker_wl_active_' + (user ? user.uid : 'guest'), id);
      if (STUB || !user) return Promise.resolve();
      return me().collection('watchlistPrefs').doc('active').set({ id: id, updatedAt: ts() }).catch(function () {});
    },
    save: function (l) {
      if (STUB) return Promise.resolve(l);
      if (!user) {
        var all = lsGet(GUEST_WL, []); if (!Array.isArray(all)) all = [];
        var doc = Object.assign({}, C.wlFields(l), { id: l.id, updatedAt: Date.now() }), i = -1;
        all.forEach(function (x, k) { if (x.id === l.id) i = k; });
        if (i >= 0) all[i] = doc; else all.push(doc);
        lsSet(GUEST_WL, all); return Promise.resolve(l);
      }
      var f = C.wlFields(l); f.updatedAt = ts();
      return me().collection('watchlists').doc(l.id).set(f).then(function () {
        if (l.shared) return db().collection('watchlistShared').doc(l.id).set({ ownerUid: user.uid, name: f.name, items: f.items, updatedAt: ts() });
      }).then(function () { return l; });
    },
    remove: function (l) {
      if (STUB) return Promise.resolve();
      if (!user) { lsSet(GUEST_WL, lsGet(GUEST_WL, []).filter(function (x) { return x.id !== l.id; })); return Promise.resolve(); }
      var p = l.shared ? db().collection('watchlistShared').doc(l.id).delete().catch(function () {}) : Promise.resolve();
      return p.then(function () { return me().collection('watchlists').doc(l.id).delete(); });
    }
  };

  // ---------- alerts (AlertsRepository.kt, assets/chart-alerts.js) ----------
  var GUEST_AL = 'stryker_chart_alerts_guest';
  var Alerts = {
    // cb(list) on every change; returns unsubscribe
    watch: function (cb) {
      if (STUB) { cb(Sample.alerts()); return function () {}; }
      if (!user) { cb(lsGet(GUEST_AL, []).map(function (a) { return C.alertFrom(a.id, a); }).filter(Boolean)); return function () {}; }
      return me().collection('chartAlerts').onSnapshot(function (s) {
        cb(s.docs.map(function (d) { return C.alertFrom(d.id, d.data({ serverTimestamps: 'estimate' })); }).filter(Boolean).sort(function (a, b) { return b.updatedAt - a.updatedAt; }));
      }, function (e) { console.warn('alerts', e && e.code); cb(null); });
    },
    // fired history (students/{uid}/alertFires, newest 20); cb(list, newOnes)
    fires: function (cb) {
      if (STUB) { cb(Sample.fires(), []); return function () {}; }
      if (!user) { cb([], []); return function () {}; }
      var first = true, start = Date.now();
      return me().collection('alertFires').orderBy('firedAt', 'desc').limit(20).onSnapshot(function (s) {
        var list = s.docs.map(function (d) { var x = d.data(); return { id: d.id, symbol: x.symbol || '', text: x.text || '', price: x.price, at: x.firedAt && x.firedAt.toMillis ? x.firedAt.toMillis() : 0, stopped: !!x.stopped }; });
        var fresh = first ? [] : s.docChanges().filter(function (c) { return c.type !== 'removed'; }).map(function (c) { return list.filter(function (l) { return l.id === c.doc.id; })[0]; })
          .filter(function (l) { return l && l.at > start - 20000; });
        first = false; cb(list, fresh);
      }, function () { cb([], []); });
    },
    add: function (input) {
      var r = C.newAlertDoc(input);
      if (r.error) return Promise.reject(new Error(r.error));
      if (STUB) return Promise.resolve('sample');
      if (!user) {
        var id = 'l' + Date.now().toString(36);
        lsSet(GUEST_AL, lsGet(GUEST_AL, []).concat([Object.assign({ id: id, popup: true, sound: true }, r.doc)])); return Promise.resolve(id);
      }
      var ref = me().collection('chartAlerts').doc();
      return ref.set(Object.assign(r.doc, { createdAt: ts(), updatedAt: ts() })).then(function () { return ref.id; });
    },
    setActive: function (a, on) {
      if (STUB) return Promise.resolve();
      if (!user) { lsSet(GUEST_AL, lsGet(GUEST_AL, []).map(function (x) { return x.id === a.id ? Object.assign({}, x, { active: on }) : x; })); return Promise.resolve(); }
      return me().collection('chartAlerts').doc(a.id).update({ active: !!on, updatedAt: ts() });
    },
    remove: function (a) {
      if (STUB) return Promise.resolve();
      if (!user) { lsSet(GUEST_AL, lsGet(GUEST_AL, []).filter(function (x) { return x.id !== a.id; })); return Promise.resolve(); }
      return me().collection('chartAlerts').doc(a.id).delete();
    }
  };

  // The member's plan name as stored on their profile (students/{uid}.plan), for the account menu. Read only.
  function plan() {
    if (STUB) return Promise.resolve(user ? 'Free' : '');
    if (!user) return Promise.resolve('');
    return me().get().then(function (d) { var p = d.exists && d.data().plan; return typeof p === 'string' ? p.slice(0, 24) : ''; }, function () { return ''; });
  }

  // Site notifications (the bell): new unread ones become OS notifications (same query as assets/notifications.js).
  function watchNotifications(cb) {
    if (STUB || !user) return function () {};
    var first = true;
    return db().collection('notifications').where('recipientUid', '==', user.uid).where('read', '==', false).limit(30).onSnapshot(function (s) {
      if (first) { first = false; return; }
      s.docChanges().forEach(function (c) { if (c.type === 'added') { var d = c.doc.data() || {}; cb({ id: c.doc.id, type: d.type || '', message: d.message || '' }); } });
    }, function () {});
  }

  // ---------- GEX (Gex.kt) ----------
  function gex(market) {
    if (STUB) return Promise.resolve(Sample.gex(market));
    if (!user) return Promise.reject(Object.assign(new Error('signin'), { status: 401 }));
    return getJson(SITE + '/api/gex/levels/' + market.api + '?dte=1', true).then(function (o) { return C.parseGex(o, market); });
  }

  // ---------- journal (Journal.kt) ----------
  function journal() {
    if (STUB) return Promise.resolve(Sample.journal());
    if (!user) return Promise.resolve(null);
    return me().collection('journal').get().then(function (s) { return s.docs.map(function (d) { return C.journalTradeFrom(d.id, d.data()); }).filter(Boolean); });
  }

  // ---------- learn (Learn.kt): catalog from the bundled index, progress = students/{uid}.completedLessons ----------
  function learn() {
    var chapters = window.TZ_SEED || [];
    if (STUB) return Promise.resolve(C.learnModel(chapters, Sample.done));
    if (!user) return Promise.resolve(C.learnModel(chapters, []));
    return me().get().then(function (d) { return C.learnModel(chapters, (d.exists && d.data().completedLessons) || []); }, function () { return C.learnModel(chapters, []); });
  }

  // ---------- market stats (assets/market-stats.js) ----------
  var MS_SYMS = [['NQ', 'ms_nq', 'Nasdaq-100 E-mini'], ['ES', 'ms_es', 'S&P 500 E-mini'], ['YM', 'ms_ym', 'Dow E-mini'], ['RTY', 'ms_rty', 'Russell 2000 E-mini'], ['GC', 'ms_gc', 'Gold'], ['CL', 'ms_cl', 'Crude oil']];
  var msCache = {};
  function marketStats(sym) {
    if (msCache[sym]) return Promise.resolve(msCache[sym]);
    if (STUB) return Promise.resolve(msCache[sym] = { rows: window.StkMS.toRows(Sample.msPart()), t: 0 });
    var info = MS_SYMS.filter(function (s) { return s[0] === sym; })[0];
    return fetch(MS_API + info[1], { credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw new Error('http');
      return r.arrayBuffer().then(function (b) {
        if (r.headers.get('x-scan-gzip') !== '1') return JSON.parse(new TextDecoder().decode(b));
        return new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).text().then(JSON.parse);
      });
    }).then(function (part) { return (msCache[sym] = { rows: window.StkMS.toRows(part), t: part.t }); });
  }

  // ---------- sample data (tests only; every screen shows a "Sample data" chip in this mode) ----------
  var Sample = {
    lists: [{ id: 'a', name: 'Futures', items: C.DEFAULT_ITEMS.slice() }, { id: 'b', name: 'Crypto', items: ['###CRYPTO', 'binance:BTCUSDT', 'binance:ETHUSDT', 'binance:SOLUSDT'] }],
    seed: function (s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; },
    quote: function (sym) {
      var h = Sample.seed(sym.id), base = { futures: 1000 + h % 9000, fx: 1 + (h % 100) / 100, index: 100 + h % 900, crypto: 1 + h % 3000 }[sym.source] || 100;
      var spark = [], v = base; for (var i = 0; i < 32; i++) { v += Math.sin(i / 3 + h % 7) * base * 0.0015; spark.push(v); }
      var prev = base * (1 + ((h % 21) - 10) / 1000);
      return { last: v, prev: prev, change: v - prev, pct: (v - prev) / prev * 100, spark: spark, realtime: true };
    },
    alerts: function () {
      return [{ id: 's1', symbol: 'futures:NQ1!', ticker: 'NQ1!', cond: 'crossing', price: 1234.5, message: 'Sample alert', freq: 'once', active: true, updatedAt: Date.now() - 3600e3 },
        { id: 's2', symbol: 'binance:BTCUSDT', ticker: 'BTCUSDT', cond: 'greater', price: 1000, message: '', freq: 'every', active: true, updatedAt: Date.now() - 7200e3 },
        { id: 's3', symbol: 'futures:GC1!', ticker: 'GC1!', cond: 'less', price: 100.1, message: 'Paused sample', freq: 'once', active: false, updatedAt: Date.now() - 86400e3 }];
    },
    fires: function () { return [{ id: 'f1', symbol: 'futures:ES1!', text: 'ES1! crossing 1,000.00', price: 1000, at: Date.now() - 40 * 60e3, stopped: true }]; },
    gex: function (m) {
      var s = 1000 + Sample.seed(m.fut) % 500, prof = [];
      for (var k = -10; k <= 10; k++) prof.push({ k: s + k * 5, g: Math.round(Math.cos(k / 3) * 80 - k * 4) });
      return { market: m, spot: s, net: 1.2e9, positive: true, ts: Date.now() / 1000 - 300, stale: false, profile: prof, underSpot: s,
        levels: [{ kind: 'iv68_hi', label: 'Expected high (68%)', price: s + 40 }, { kind: 'call_wall', label: 'Call wall', price: s + 25 }, { kind: 'spot', label: 'Spot', price: s },
          { kind: 'zero_gamma', label: 'Zero gamma', price: s - 10 }, { kind: 'put_wall', label: 'Put wall', price: s - 30 }, { kind: 'iv68_lo', label: 'Expected low (68%)', price: s - 45 }] };
    },
    journal: function () {
      var m = new Date().toISOString().slice(0, 7), out = [];
      [2, 3, 6, 7, 9, 10, 13, 14].forEach(function (d, i) { out.push({ id: 'j' + i, instrument: i % 2 ? 'ES' : 'NQ', direction: i % 3 ? 'long' : 'short', date: m + '-' + (d < 10 ? '0' : '') + d, time: '10:0' + i, size: 1, pnl: [120, -80, 45, -30, 60, -20, 90, -50][i] }); });
      return out;
    },
    done: ['01-0', '01-1', '01-2'],
    msPart: function () {
      // 60 synthetic sessions in the scan worker's column format (labelled Sample data in the UI)
      var cols = window.StkMS.COLS, rows = [], d0 = Date.UTC(2026, 0, 5);
      for (var i = 0, n = 0; n < 60; i++) {
        var dt = new Date(d0 + i * 864e5), wd = dt.getUTCDay(); if (wd === 0 || wd === 6) continue;
        var o = 1000 + Math.sin(n) * 20, r = cols.map(function (c) { return c === 'd' ? +dt.toISOString().slice(0, 10).replace(/-/g, '') : c === 'dow' ? wd - 1 : 0; });
        var set = function (c, v) { r[cols.indexOf(c)] = v; };
        set('o', o); set('h', o + 15); set('l', o - 12); set('c', o + (n % 3 - 1) * 6); set('pdh', o + 10); set('pdl', o - 10); set('pdc', o - (n % 5 - 2) * 3);
        set('gf', n % 3 ? 20 + n : -1); set('thi', n % 2 ? 30 : -1); set('tlo', n % 3 ? 45 : -1); set('bhi', -1); set('blo', -1);
        rows.push(r); n++;
      }
      return { cols: cols, rows: rows, t: 0 };
    }
  };

  window.TZData = { STUB: STUB, Auth: Auth, quote: quote, Watchlists: Watchlists, Alerts: Alerts, watchNotifications: watchNotifications, plan: plan, gex: gex,
    journal: journal, learn: learn, marketStats: marketStats, MS_SYMS: MS_SYMS, SITE: SITE };
})();
