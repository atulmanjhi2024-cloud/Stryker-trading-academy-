// Admin: Beta testers by email (students-admin.html). List = Firestore settings/betaTesters { emails }. Reads from Firestore (admins only);
// add/remove go through POST /api/beta/admin (server checks admin, cap 30, and flips the students.beta mirror). Account name/plan come from ALL_STUDENTS when the account exists.
(function () {
  'use strict';
  var CAP = 30, emails = [];
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function msg(t, err) { var m = $('beta-admin-msg'); m.textContent = t || ''; m.className = 'ba-msg' + (err ? ' err' : ''); }
  function accounts() { var m = {}; (window.__betaAdminStudents ? window.__betaAdminStudents() : []).forEach(function (s) { if (s.email) m[String(s.email).toLowerCase()] = s; }); return m; }
  function paint() {
    $('beta-admin-count').textContent = 'Beta testers: ' + emails.length + ' of ' + CAP;
    var acc = accounts();
    $('beta-admin-list').innerHTML = emails.length ? emails.map(function (e) {
      var s = acc[e];
      return '<div class="ba-row"><div class="ba-who"><b>' + esc(e) + '</b><span>' + (s ? esc(s.displayName || 'No name') + ' · ' + esc(s.plan || 'Starter') : 'No account yet') + '</span></div>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-ba-rm="' + esc(e) + '" aria-label="Remove ' + esc(e) + '">Remove</button></div>';
    }).join('') : '<p class="ba-empty">No testers yet. Add an email above.</p>';
    $('beta-admin-add').disabled = emails.length >= CAP;
  }
  function call(action, email) {
    return firebase.auth().currentUser.getIdToken().then(function (t) {
      return fetch('/api/beta/admin', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: JSON.stringify({ action: action, email: email }) })
        .then(function (r) { return r.json().catch(function () { return {}; }); });
    }).catch(function () { return { error: 'Could not reach the server. Try again.' }; });
  }
  function load() { return firebase.firestore().collection('settings').doc('betaTesters').get().then(function (d) { emails = (d.exists && d.data().emails) || []; paint(); }).catch(function () { msg('Could not load the list.', true); }); }
  function init() {
    $('beta-admin-form').addEventListener('submit', function (ev) {
      ev.preventDefault(); var inp = $('beta-admin-email'), v = inp.value.trim().toLowerCase(); if (!v) return;
      $('beta-admin-add').disabled = true;
      call('add', v).then(function (d) { if (d.ok) { emails = d.emails; inp.value = ''; msg(v + ' added.'); } else msg(d.error || 'Could not add.', true); paint(); });
    });
    $('beta-admin-list').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-ba-rm]'); if (!b) return; var e = b.getAttribute('data-ba-rm'); b.disabled = true;
      call('remove', e).then(function (d) { if (d.ok) { emails = d.emails; msg(e + ' removed. Their beta access is off.'); } else msg(d.error || 'Could not remove.', true); paint(); });
    });
    window.__betaAdminRepaint = paint;
    firebase.auth().onAuthStateChanged(function (u) { if (u) load(); });
  }
  var t = function () { if (window.firebase && firebase.auth && $('beta-admin-form')) init(); else setTimeout(t, 100); }; t();
})();
