// ZoroCharts top bar: "Get Pro free" pill (Owner 25 Nov). Free signed-in members only (not Pro / beta / admin).
// Click opens the real referrals page (referrals?embed=1, chrome hidden by assets/referrals-page.css) in a modal over the chart.
(function () {
  'use strict';
  var host = document.querySelector('.mobile-topnav');
  if (!host || !window.firebase || !firebase.auth) return;
  var btn = null, overlay = null, frame = null, lastFocus = null;

  function gift() {
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg>';
  }
  function mount() {
    if (btn) return;
    btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'stk-getpro'; btn.className = 'stk-getpro';
    btn.title = 'Get Pro free'; btn.setAttribute('aria-label', 'Get Pro free'); btn.setAttribute('aria-haspopup', 'dialog');
    btn.innerHTML = gift() + '<span class="stk-getpro-l">Get Pro free</span>';
    btn.onclick = open;
    place();
  }
  // Left of Trade; Trade / account strip / session pill may arrive after this, so keep re-placing
  function place() {
    if (!btn) return;
    var ref = host.querySelector(':scope > .stktm-hdr') || host.querySelector(':scope > #stkas') || host.querySelector(':scope > #mclock');
    if (ref && btn.nextElementSibling !== ref) host.insertBefore(btn, ref);
  }
  new MutationObserver(place).observe(host, { childList: true });
  function unmount() { if (btn) { btn.remove(); btn = null; } close(); }

  function open() {
    lastFocus = document.activeElement;
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'stk-getpro-ov'; overlay.className = 'stk-getpro-ov'; overlay.hidden = true;
      overlay.innerHTML = '<div class="stk-getpro-sheet" role="dialog" aria-modal="true" aria-label="Invite friends, get Pro free">' +
        '<button type="button" class="stk-getpro-x" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
        '<iframe title="Invite friends, get Pro free" src="referrals?embed=1"></iframe></div>';
      document.body.appendChild(overlay);
      frame = overlay.querySelector('iframe');
      overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
      overlay.querySelector('.stk-getpro-x').onclick = close;
      var esc = function (w) { try { w.addEventListener('keydown', onKey); } catch (e) {} };
      frame.addEventListener('load', function () { esc(frame.contentWindow); });
    }
    overlay.hidden = false; document.documentElement.classList.add('stk-getpro-open');
    overlay.querySelector('.stk-getpro-x').focus();
  }
  function onKey(e) { if (e.key === 'Escape' && overlay && !overlay.hidden) { e.stopPropagation(); close(); } }
  document.addEventListener('keydown', onKey, true);
  function close() {
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true; document.documentElement.classList.remove('stk-getpro-open');
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {}
  }
  window.__stkGetPro = { open: open, close: close };

  // free member = signed in, not admin, not beta, plan rank 0 or expired
  function check(u) {
    if (!u) return unmount();
    var db = firebase.firestore();
    Promise.all([
      db.collection('admins').doc(u.uid).get().then(function (d) { return d.exists; }, function () { return true; }),
      db.collection('students').doc(u.uid).get().then(function (d) { return d.exists ? d.data() : {}; }, function () { return null; }),
      (window.strykerBeta ? window.strykerBeta.ready().then(function (s) { return !!(s && (s.beta || s.admin)); }, function () { return false; }) : Promise.resolve(false)),
      (typeof loadPlansForRoles === 'function' ? loadPlansForRoles().catch(function () {}) : Promise.resolve())
    ]).then(function (r) {
      if (!firebase.auth().currentUser || firebase.auth().currentUser.uid !== u.uid) return;
      var admin = r[0], s = r[1], beta = r[2];
      if (admin || beta || !s) return unmount();   // unknown plan: stay hidden rather than offer Pro to a Pro member
      var paid = s.plan && typeof rankOf === 'function' && rankOf(s.plan) > 0 && s.subscriptionStatus !== 'expired';
      var until = Number(s.paidThroughMillis) || 0;
      if (paid && !(s.planSource === 'referral' && until && until < Date.now())) return unmount();
      mount();
    });
  }
  firebase.auth().onAuthStateChanged(check);
})();
