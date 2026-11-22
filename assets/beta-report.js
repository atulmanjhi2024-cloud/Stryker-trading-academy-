// Report a bug (beta testers + admins only; loaded by assets/beta.js after the server said "beta"). Floating button in the app shell, plus a button in the chart toolbar.
// Sends { title, what, url, build, ua, errors, screenshot } to POST /api/beta/report, which makes a thread in our Discord bug-reports forum and keeps a copy in Firestore.
// The screenshot is taken BEFORE the dialog opens (html2canvas, lazy vendor file) so the dialog is not in it; it can be removed with one tap.
(function () {
  'use strict';
  if (window.__tzBetaReport) return; window.__tzBetaReport = true;
  var errs = [], MAX_ERR = 5;
  window.addEventListener('error', function (e) { if (errs.length < MAX_ERR) errs.push(String(e.message || 'error') + (e.filename ? ' @' + String(e.filename).split('/').pop() + ':' + (e.lineno || 0) : '')); });
  window.addEventListener('unhandledrejection', function (e) { if (errs.length < MAX_ERR) errs.push('Unhandled: ' + String((e.reason && e.reason.message) || e.reason || '').slice(0, 160)); });
  var build = (document.querySelector('meta[name="stryker-build"]') || {}).content || '';
  var shot = null, busy = false, dlg = null, lastFocus = null;
  var ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 7V6a4 4 0 0 1 8 0v1"/><rect x="6" y="7" width="12" height="13" rx="5"/><path d="M12 11v5M3 12h3M18 12h3M4 18l2.5-1.5M20 18l-2.5-1.5M4 6l2.5 1.5M20 6l-2.5 1.5"/></svg>';
  function loadH2C() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = '/assets/vendor/html2canvas-1.4.1.min.js'; s.onload = function () { res(window.html2canvas); }; s.onerror = rej; document.head.appendChild(s); });
  }
  // html2canvas 1.4 cannot parse CSS color(...) values (what color-mix() computes to): beta UI uses plain rgba, and so must anything new on a page people may report from.
  function snap() {
    return loadH2C().then(function (h) {
      return h(document.body, { scale: Math.min(1, 1200 / Math.max(1, window.innerWidth)), logging: false, useCORS: true, backgroundColor: null, width: window.innerWidth, height: window.innerHeight, x: window.scrollX, y: window.scrollY, ignoreElements: function (el) { return el.id === 'tz-beta-fab' || (el.id === 'tz-beta-dlg'); } });
    }).then(function (cv) { return cv.toDataURL('image/png'); }).catch(function (e) { if (window.__tzBetaDebug) console.error('beta shot', e && e.message); return null; });
  }
  function el(h) { var d = document.createElement('div'); d.innerHTML = h; return d.firstChild; }
  function close() { if (dlg) { dlg.remove(); dlg = null; } if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  function open() {
    if (busy || dlg) return; busy = true; lastFocus = document.activeElement;
    snap().then(function (png) { shot = png; busy = false; build_(); });
  }
  function build_() {
    dlg = el('<div class="tzb-back" id="tz-beta-dlg"><div class="tzb-card" role="dialog" aria-modal="true" aria-labelledby="tzb-h">' +
      '<div class="tzb-head"><h2 id="tzb-h">Report a bug</h2><button type="button" class="tzb-x" aria-label="Close">&times;</button></div>' +
      '<label class="tzb-l" for="tzb-title">Title</label><input id="tzb-title" class="tzb-in" maxlength="80" autocomplete="off" placeholder="Short summary">' +
      '<label class="tzb-l" for="tzb-what">What happened</label><textarea id="tzb-what" class="tzb-in tzb-ta" maxlength="1200" placeholder="What did you do, what did you expect, what happened instead?"></textarea>' +
      '<div class="tzb-opts"><label class="tzb-chk"><input type="checkbox" id="tzb-shot" checked' + (shot ? '' : ' disabled') + '> <span>Attach a screenshot of this page' + (shot ? '' : ' (not available)') + '</span></label>' +
      '<label class="tzb-chk"><input type="checkbox" id="tzb-err" checked> <span>Include console errors (' + errs.length + ')</span></label></div>' +
      '<p class="tzb-meta" id="tzb-meta"></p><p class="tzb-msg" id="tzb-msg" role="status" aria-live="polite"></p>' +
      '<div class="tzb-row"><button type="button" class="btn btn-ghost btn-sm" id="tzb-cancel">Cancel</button><button type="button" class="btn btn-primary btn-sm" id="tzb-send">Send report</button></div></div></div>');
    document.body.appendChild(dlg);
    var $ = function (id) { return dlg.querySelector('#' + id); };
    $('tzb-meta').textContent = location.pathname + ' · build ' + build;
    dlg.querySelector('.tzb-x').onclick = close; $('tzb-cancel').onclick = close;
    dlg.addEventListener('mousedown', function (e) { if (e.target === dlg) close(); });
    dlg.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'Tab') { var f = dlg.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea'); if (!f.length) return; var a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { z.focus(); e.preventDefault(); } else if (!e.shiftKey && document.activeElement === z) { a.focus(); e.preventDefault(); } }
    });
    $('tzb-title').focus();
    $('tzb-send').onclick = function () {
      var t = $('tzb-title').value.trim(), w = $('tzb-what').value.trim(), m = $('tzb-msg');
      if (t.length < 3 || w.length < 5) { m.textContent = 'Add a short title and what happened.'; return; }
      var b = $('tzb-send'); b.disabled = true; m.textContent = 'Sending…';
      window.strykerBeta.post('report', { title: t, what: w, url: location.href.split('#')[0].slice(0, 300), build: build, ua: navigator.userAgent, errors: $('tzb-err').checked ? errs.slice() : [], screenshot: $('tzb-shot').checked && shot ? shot : undefined })
        .then(function (d) {
          if (d && d.ok) { m.textContent = 'Sent. Thank you.'; setTimeout(close, 1400); }
          else { m.textContent = (d && d.error) || 'Could not send. Try again.'; b.disabled = false; }
        });
    };
  }
  function mount() {
    if (!document.getElementById('tz-beta-fab') && !document.getElementById('stkc-bar')) {   // the chart page has its own toolbar button
      var b = el('<button type="button" class="tzb-fab" id="tz-beta-fab" aria-label="Report a bug" title="Report a bug">' + ICON + '</button>');
      b.onclick = open; document.body.appendChild(b);
    }
    var bar = document.querySelector('#stkc-bar .stkc-bar-r');
    if (bar && !document.getElementById('stkc-beta-btn')) {
      var c = el('<button type="button" class="stkc-ib" id="stkc-beta-btn" aria-label="Report a bug" title="Report a bug (beta)">' + ICON.replace('width="20" height="20"', 'width="15" height="15"') + '</button>');
      c.onclick = open; bar.insertBefore(c, bar.firstChild);
    }
  }
  mount(); document.addEventListener('DOMContentLoaded', mount); setTimeout(mount, 1500); setTimeout(mount, 5000);
  window.strykerBetaReport = { open: open };
})();
