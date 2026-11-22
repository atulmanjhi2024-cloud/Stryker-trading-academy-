// TradeZoro beta tester program (Owner 2026-11-22): the ONE client flag. Server twin: functions/api/beta/_lib.js isBetaToken. Config: assets/beta-config.mjs.
//   await strykerBeta.ready()          -> { beta, admin, cap } (cached; the answer comes from POST /api/beta/status: admin, or verified email on settings/betaTesters)
//   strykerBeta.isBeta(featureId?)     -> true for beta testers and admins (sync; false until ready() resolved). A feature gated "beta" calls isBeta('mql5') instead of being hidden.
//   strykerBeta.badge()                -> small "Beta" tag html; <span data-beta-uid="UID"></span> placeholders anywhere fill themselves from profiles/{uid}.beta.
// Copy trading and admin pages never use this: they stay admin-only. Depends on: firebase auth (+ firestore compat for the tags).
(function () {
  'use strict';
  (function () {   // the badge / report styles come with the script, so every page that loads it can show them
    if (document.getElementById('tz-beta-css')) return;
    var m = document.querySelector('meta[name="stryker-build"]'), l = document.createElement('link');
    l.id = 'tz-beta-css'; l.rel = 'stylesheet'; l.href = '/assets/beta.css?v=' + (m ? m.content : '0'); document.head.appendChild(l);
  })();
  var KEY = 'tz_beta_v1', API = '/api/beta/';
  var st = null, pending = null;
  try { var c = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (c && Date.now() - c.t < 900000) st = c.s; } catch (e) {}   // session cache; the server decides every 15 min
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify({ t: Date.now(), s: st })); } catch (e) {} }
  function user() { return window.firebase && firebase.auth ? firebase.auth().currentUser : null; }
  function post(path, body) {
    var u = user(); if (!u) return Promise.resolve(null);
    return u.getIdToken().then(function (t) {
      return fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: JSON.stringify(body || {}) })
        .then(function (r) { return r.json().then(function (d) { d._status = r.status; return d; }); });
    }).catch(function () { return null; });
  }
  function ready(refresh) {
    if (pending && !refresh) return pending;
    if (st && !refresh) return Promise.resolve(st);
    pending = new Promise(function (resolve) {
      var go = function (u) { if (!u) { resolve(null); return; } post('status', refresh ? { refresh: true } : {}).then(function (d) { if (d && !d.error) { st = d; save(); } resolve(st); pending = null; }); };
      if (user()) go(user()); else if (window.firebase && firebase.auth) { var off = firebase.auth().onAuthStateChanged(function (u) { off(); go(u); }); } else resolve(null);
    });
    return pending;
  }
  function isBeta() { return !!(st && st.beta); }
  function badge() { return '<span class="beta-tag" title="TradeZoro beta tester">Beta</span>'; }
  var cache = {};
  function hydrate(root) {
    if (!(window.firebase && firebase.firestore)) return;
    (root || document).querySelectorAll('[data-beta-uid]:not([data-beta-done])').forEach(function (el) {
      var uid = el.getAttribute('data-beta-uid'); el.setAttribute('data-beta-done', '1');
      if (!uid) return;
      (cache[uid] = cache[uid] || firebase.firestore().collection('profiles').doc(uid).get().then(function (d) { return !!(d.exists && d.data().beta === true); }).catch(function () { return false; }))
        .then(function (on) { if (on) el.innerHTML = badge(); });
    });
  }
  window.strykerBeta = { ready: ready, isBeta: isBeta, badge: badge, hydrate: hydrate, post: post, state: function () { return st; }, _set: function (s) { st = s; } };
  function loadReport() {
    if (window.__tzBetaReport || document.getElementById('tz-beta-report-js')) return;
    var b = document.querySelector('meta[name="stryker-build"]'), sc = document.createElement('script');
    sc.id = 'tz-beta-report-js'; sc.src = '/assets/beta-report.js?v=' + (b ? b.content : '0'); document.head.appendChild(sc);
  }
  function boot() {
    if (typeof MutationObserver !== 'undefined' && document.body) { hydrate(); new MutationObserver(function () { hydrate(); }).observe(document.body, { childList: true, subtree: true }); }
    if (window.firebase && firebase.auth) firebase.auth().onAuthStateChanged(function (u) {
      if (u) ready().then(function (s) { if (s && s.beta) loadReport(); }); else { st = null; try { sessionStorage.removeItem(KEY); } catch (e) {} }
    });
  }
  // loaded by app-nav.js on every signed-in page, before firebase: start once the page (and firebase) is there
  if (document.readyState === 'complete') boot(); else window.addEventListener('load', boot);
})();
