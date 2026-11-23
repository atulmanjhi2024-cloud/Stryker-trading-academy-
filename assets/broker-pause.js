// TradeZoro — ONE flag that pauses broker connecting for members (Owner 23 Nov 2026: "broker access will be temporarily removed till
// the issue of users not being able to connect is fixed"). While BROKERS_PAUSED is true, members get PAUSED_MSG instead of every
// "Connect a broker" / broker account / live order / copy trading entry (chart Trade menu, order panel, journal Broker sync).
// Admins AND beta testers (Owner 23 Nov follow-up) still see everything. Beta = the server's answer (POST /api/beta/status: verified
// sign-in email on settings/betaTesters), the same check as the /beta page. Server twin: functions/connect/finatic/_pause.js refuses
// every broker call from other members. The global kill switch settings/liveTrading stays the separate emergency stop for everyone.
// Turn back on: set BROKERS_PAUSED = false (build bump). Used by: chart-paper.js, finatic-journal.js, journal-broker.js, the help pages
// and the server (functions/connect/finatic/_fin.js gate). Education only. Not financial advice.
export const BROKERS_PAUSED = true;
export const PAUSED_MSG = 'Broker connections are paused for a short while while we fix a connection issue. Your charts and journal history are not affected.';
const isAdmin = (uid) => firebase.firestore().collection('admins').doc(uid).get().then((d) => d.exists).catch(() => false);
const isBeta = () => {
  if (typeof window !== 'undefined' && window.strykerBeta) return window.strykerBeta.ready().then((s) => !!(s && s.beta)).catch(() => false);
  const u = firebase.auth().currentUser; if (!u) return Promise.resolve(false);
  return u.getIdToken().then((t) => fetch('/api/beta/status', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: '{}' }))
    .then((r) => (r.ok ? r.json() : null)).then((d) => !!(d && d.beta)).catch(() => false);
};
// -> Promise<boolean>: true = hide broker connecting for this user (not admin, not beta). Unknown = paused (fails closed).
export const pausedFor = (uid, admin) => (!BROKERS_PAUSED ? Promise.resolve(false)
  : (admin != null ? Promise.resolve(!!admin) : isAdmin(uid)).then((a) => (a ? false : isBeta().then((b) => !b))));
// Help pages (help/connect-broker*.html): the pause line at the top of the article and the broker tiles hidden (signed out = paused).
export function helpPage() {
  if (!BROKERS_PAUSED) return;
  const body = document.querySelector('.article-body'); if (!body) return;
  const note = document.createElement('div'); note.className = 'bh-card bh-paused'; note.setAttribute('role', 'note'); note.textContent = PAUSED_MSG;
  // style.display, not [hidden]: the page's display:grid on .bh-grid beats the hidden attribute
  const show = (on) => { note.hidden = !on; document.querySelectorAll('.bh-grid, #brokers').forEach((g) => { g.style.display = on ? 'none' : ''; }); };
  body.insertBefore(note, body.firstChild); show(true);
  try { auth.onAuthStateChanged((u) => { if (u && !u.isAnonymous) pausedFor(u.uid).then(show); else show(true); }); } catch (e) { /* no auth: stay paused */ }
}
