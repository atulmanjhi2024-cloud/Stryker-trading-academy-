// TradeZoro — Nemesis: "Broker sync (beta)" button (classic script). Every signed-in member since 21 Nov 2026 (Owner decision; was admins
// only). The server (functions/connect/finatic/*, _owner.js) scopes every call to the member's own broker connection.
(function () {
  'use strict';
  function build() { var m = document.querySelector('meta[name="stryker-build"]'); return m ? m.content : '0'; }
  function addButton(uid, admin) {
    var anchor = document.getElementById('ji-open-rithmic') || document.getElementById('ji-open-btn');
    if (!anchor || document.getElementById('ji-open-broker')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-ghost btn-sm'; b.id = 'ji-open-broker'; b.textContent = 'Broker sync (beta)';
    b.addEventListener('click', function () {
      b.disabled = true;
      import('./finatic-journal-ui.js?v=' + build()).then(function (m) { m.openBrokerSync({ uid: uid, admin: !!admin }); })
        .catch(function (e) { console.error('Broker sync failed to load', e); if (window.showToast) window.showToast('error', 'Could not open broker sync.'); })
        .then(function () { b.disabled = false; });
    });
    anchor.parentNode.insertBefore(b, anchor.nextSibling);
  }
  function init() {
    if (typeof auth === 'undefined' || typeof db === 'undefined') return;
    var seen = false;
    auth.onAuthStateChanged(function (user) {
      if (!user || seen) return; seen = true;
      if (user.isAnonymous) return;
      db.collection('admins').doc(user.uid).get().then(function (a) { return a.exists; }).catch(function () { return false; }).then(function (admin) { addButton(user.uid, admin); });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
