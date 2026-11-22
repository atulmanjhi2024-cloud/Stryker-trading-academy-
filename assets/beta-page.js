// /beta page: testers see their status, what is being tested (assets/beta-config.mjs) and Report a bug. Everyone else sees "Beta is invite-only".
(function () {
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var STATE = { testing: ['Testing now', 'on'], soon: ['Coming soon', ''] };
  function paint(s) {
    var on = !!(s && s.beta), box = document.getElementById('beta-status');
    if (!s) box.innerHTML = '<p class="bp-p">Beta status is not available right now. Try again in a minute.</p>';
    else if (on) box.innerHTML = '<ul class="bp-list"><li><div class="bp-t"><b>You are a beta tester</b><span>' + (s.admin ? 'Admins always have beta access.' : 'Pro tools and live order book data, with no change to your billing.') + '</span></div><span class="bp-pill on">Active</span></li></ul>';
    else box.innerHTML = '<ul class="bp-list"><li><div class="bp-t"><b>Beta is invite-only</b><span>Testers are added by the TradeZoro team. Nothing to do here.</span></div><span class="bp-pill">Invite-only</span></li></ul>';
    document.getElementById('beta-report-panel').hidden = !on; document.getElementById('beta-tested-panel').hidden = !on;
    var b = document.getElementById('beta-report-btn');
    if (b && on) b.onclick = function () { var go = function () { if (window.strykerBetaReport) window.strykerBetaReport.open(); else setTimeout(go, 200); }; go(); };
  }
  import('/assets/beta-config.mjs').then(function (m) {
    var list = document.getElementById('beta-features');
    if (list) list.innerHTML = m.BETA.features.map(function (f) { var s = STATE[f.state] || STATE.soon; return '<li><div class="bp-t"><b>' + esc(f.title) + '</b><span>' + esc(f.note) + '</span></div><span class="bp-pill ' + s[1] + '">' + s[0] + '</span></li>'; }).join('');
  });
  var run = function () {
    if (!(window.firebase && firebase.auth && window.strykerBeta)) return setTimeout(run, 100);
    firebase.auth().onAuthStateChanged(function (u) { if (u) window.strykerBeta.ready(true).then(paint); });
  };
  run();
})();
