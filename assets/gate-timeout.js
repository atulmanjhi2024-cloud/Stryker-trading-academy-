// TradeZoro — last-resort safety net for gated pages
//
// Every gated page starts with .dash-shell.gate-pending (visibility:hidden)
// behind #access-gate-overlay, so nobody sees a flash of real content before
// the access check resolves. The contract is that some guard — plan-guard.js,
// reader.js, model-reader.js, indicator-reader.js — always finishes by
// revealing the shell.
//
// That contract can break: Firebase never resolves auth state (browser is
// blocking IndexedDB), a Firestore read hangs on a dead connection, a guard
// throws before its reveal path, or the page is a stale cached copy whose
// guard script no longer matches. In every one of those cases the visitor is
// left staring at a spinner with no error and no way out — indistinguishable
// from the site being broken.
//
// So: if the shell is STILL hidden after the timeout, reveal it anyway and
// say something. Revealing is safe here — plan-guard has its own paywall for
// people who lack a plan, and the Firestore rules are the real access
// boundary regardless of what the DOM shows.

(function(){
  var TIMEOUT_MS = 8000;

  function stillHidden(){
    var shell = document.querySelector('.dash-shell.gate-pending, .reader-shell.gate-pending');
    return !!shell;
  }

  function rescue(){
    if (!stillHidden()) return;

    var shell = document.querySelector('.dash-shell.gate-pending, .reader-shell.gate-pending');
    var gateOverlay = document.getElementById('access-gate-overlay');
    if (gateOverlay) gateOverlay.style.display = 'none';
    if (shell) shell.classList.remove('gate-pending');

    // Don't stack on top of a notice another script already put up.
    if (document.getElementById('session-notice')) return;
    if (document.getElementById('gate-timeout-notice')) return;

    var el = document.createElement('div');
    el.id = 'gate-timeout-notice';
    el.className = 'notice gate-timeout-notice';
    el.setAttribute('role', 'status');
    el.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>' +
      '<p><b>This page took too long to confirm your access.</b><br>' +
      'Usually this means your browser is blocking the storage the login needs, ' +
      'or you are viewing an out-of-date cached copy of the site. ' +
      'Signing in again normally clears it.' +
      '<br><a href="login.html" class="btn btn-primary btn-sm" style="margin-top:10px; display:inline-flex;">Go to login</a></p>' +
      '<button type="button" class="gate-timeout-close" aria-label="Dismiss">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';

    // Floating toast, never in the page flow: it must not push or cover the
    // chart/dashboard content, and it can always be dismissed.
    var st = document.createElement('style');
    st.textContent =
      '.gate-timeout-notice{position:fixed;z-index:9000;top:12px;left:50%;transform:translateX(-50%);' +
      'width:min(440px,calc(100vw - 24px));margin:0;box-sizing:border-box;padding:12px 44px 12px 14px;' +
      'background:var(--bg-1,#0f1a17);box-shadow:0 8px 24px rgba(0,0,0,.35)}' +
      '.charts-page .gate-timeout-notice{top:auto;bottom:16px}' +
      '.gate-timeout-close{position:absolute;top:6px;right:6px;width:32px;height:32px;display:inline-flex;' +
      'align-items:center;justify-content:center;padding:0;border:0;border-radius:8px;background:transparent;' +
      'color:inherit;cursor:pointer}.gate-timeout-close:hover{background:rgba(127,127,127,.2)}' +
      '.gate-timeout-notice svg:first-child{margin-top:2px}';
    document.head.appendChild(st);
    document.body.appendChild(el);

    function remove() {
      window.removeEventListener('tz:gate-resolved', remove);
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    el.querySelector('.gate-timeout-close').addEventListener('click', remove);
    window.addEventListener('tz:gate-resolved', remove);
    // Auth/plan resolving late (plan-guard reveal, or a signed-in user showing up)
    try {
      if (typeof auth !== 'undefined' && auth && auth.onAuthStateChanged) {
        auth.onAuthStateChanged(function (u) { if (u) setTimeout(remove, 0); });
      }
    } catch (e) {}
    window.__gateTimeoutRemove = remove;
    console.warn('TradeZoro: access gate never resolved — revealed by gate-timeout.js after ' + TIMEOUT_MS + 'ms');
  }

  document.addEventListener('DOMContentLoaded', function(){
    setTimeout(rescue, TIMEOUT_MS);
  });
})();
