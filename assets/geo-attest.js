// TradeZoro - stored-lock check only. NO country question is ever shown (Owner 22 Nov 2026: the edge IP block is the location check).
// If students/{uid} already has sanctionsLocked or a blocked residenceCountry (server data), the page shows the region message and signs out.
// Depends on: assets/geo-block-list.js (window.TZGeoBlock), assets/auth.js (auth), assets/progress.js (db).
(function () {
  var G = window.TZGeoBlock;
  if (!G) return;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); }

  // ---------- 2/3. signed-in pages ----------
  function lockPage() {
    try {
      document.documentElement.innerHTML =
        '<head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not available in your region - TradeZoro</title></head>' +
        '<body class="geo-locked-body"><main class="geo-card" role="main">' +
        '<p class="geo-brand">TradeZoro</p><h1>Not available in your region</h1><p class="geo-msg">' + esc(G.REGION_MESSAGE) + '</p>' +
        '</main></body>';
      var st = document.createElement('style');
      st.textContent = 'body.geo-locked-body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:#050506;color:rgba(255,255,255,.92);font:400 15px/22px -apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif}' +
        '.geo-card{width:100%;max-width:440px;background:#0b0b0d;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:32px 24px}' +
        '.geo-brand{margin:0 0 8px;font-size:13px;line-height:18px;font-weight:500;color:rgba(255,255,255,.44)}.geo-card h1{margin:0 0 12px;font-size:22px;line-height:28px;font-weight:700}.geo-msg{margin:0;color:rgba(255,255,255,.64)}' +
        '@media (prefers-color-scheme: light){body.geo-locked-body{background:#f5f5f7;color:#1d1d1f}.geo-card{background:#fff;border-color:rgba(0,0,0,.08)}.geo-brand{color:rgba(0,0,0,.5)}.geo-msg{color:rgba(0,0,0,.64)}}';
      document.head.appendChild(st);
    } catch (e) { /* sign-out below regardless */ }
    if (typeof auth !== 'undefined' && auth) auth.signOut().catch(function () {});
  }

  // Always read the SERVER copy. The default get() answers from the local cache when the connection is slow, and a
  // cached doc holding only a pending {theme} write (theme.js, every chart load in the desktop app) looks unanswered:
  // the dialog then asks a member who already answered, and the rules refuse the second answer (bug 22 Nov, Mac app).
  function serverDoc(uid) { return db.collection('students').doc(uid).get({ source: 'server' }); }
  function report(what, code) {
    console.warn('TradeZoro: ' + what, code);
    try { if (typeof logActivity === 'function') logActivity('geo.' + what.replace(/\W+/g, '_'), 'Country confirmation: ' + what + ' (' + code + ')', { detail: String(code) }); } catch (e) { /* logging never blocks */ }
  }

  function checkMember(user) {
    if (typeof db === 'undefined' || !db) return;
    var tries = 0;
    (function look() {
      serverDoc(user.uid).then(function (snap) {
        // A brand-new account: ensureStudentDoc (progress.js) is still creating the doc. Wait for it.
        if (!snap.exists) { if (++tries < 8) setTimeout(look, 750); return; }
        var d = snap.data() || {};
        if (d.sanctionsLocked === true || G.isBlockedResidence(d.residenceCountry)) { lockPage(); return; }
      }).catch(function (e) {
        // Server not reachable yet (slow start, offline): try again a few times, then fail open. The server-side
        // checks (checkout, coupons, Stripe webhook) are the real boundary and refuse an unanswered account.
        if (++tries < 8) { setTimeout(look, 1500); return; }
        report('attestation check failed', (e && e.code) || 'unknown');
      });
    })();
  }

  function start() {
    if (/^\/(login|signup)(\.html)?$/.test(location.pathname)) return;   // the sign-in pages route away first
    if (typeof auth === 'undefined' || !auth) return;
    var done = false;
    auth.onAuthStateChanged(function (user) { if (!user || done) return; done = true; checkMember(user); });
  }
  // Loaded by a plain tag (signup.html) or injected by banned-check.js, which can land after DOMContentLoaded.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  window.TZGeoAttest = { checkMember: checkMember, lockPage: lockPage };
})();
