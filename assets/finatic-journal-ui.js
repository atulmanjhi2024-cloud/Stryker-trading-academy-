// TradeZoro — "Connect your broker" sheet (broker grid, linked accounts, trust row) (ES module, every signed-in member since 21 Nov 2026, loaded on demand by
// assets/finatic-journal.js and by the chart's Connect a broker). READ ONLY for the journal: lists accounts and fills through
// /connect/finatic/data (server allow-list, scoped to the member's own connection). The "Order test" step is admins only (admin flag).
// Flow: start session -> broker portal in a new tab (the member logs in there) -> Continue -> pick account + dates -> preview -> import.
// Depends on the journal page globals: auth, db, firebase, JOURNAL_UID, JOURNAL_TRADES, journalCollectionRef, reloadJournalData, showToast.
import { CSS } from './rithmic-journal-ui.js?v=1291';
import { acctInfo, grantFor, ageText } from './chart-live-core.js?v=1291';
import { tripsFromBroker, tripToTrade, tripId, ordersToFetch, planImport } from './finatic-fills.js?v=1291';

// WHICH BROKERS WORK TODAY (CoS: flip one value to true/false; false = tile shows "Coming soon" and cannot be tapped). Checked 24 Nov 2026.
// A broker counts as working only when a member can connect AND trade through our current path.
export const BROKER_AVAILABLE = {
  'ctrader': 'gate',            // our own cTrader API link: true for admins + beta testers only (window.__stkCt, set by chart-live.js); everyone else "Coming soon"
  'interactive-brokers': false, // the Finatic order API has no Interactive Brokers adapter (its order schema lists none), so nothing can be traded
  'metatrader-4': true,         // our MT path (venue 'mt', Finatic mt4 adapter); Owner enabled it 21 Nov; only tested with stubs, no live order log yet
  'metatrader-5': 'gate',       // Owner 24 Nov: hosted sign-in (login + password + server on our server) for admins + beta testers only (window.__stkMtHost);
                                //   members see "Coming soon" (the MT4 tile keeps the own-MetaTrader + EA path). Members back on: set true.
  'ninjatrader': false,         // Owner 24 Nov: coming soon (runs on the same Tradovate backend that fails via Finatic)
  'rithmic': false,             // Finatic connect returns "permission denied (code 13)": not enabled for our app
  'tastytrade': false,          // Owner 25 Nov: coming soon
  'tradovate': false,           // every Tradovate order via Finatic failed with 504 (4 of 4, 2 users, 21-23 Nov); Finatic's order schema has no Tradovate entry; support ticket open. Set true once Finatic confirms
  'webull': false,              // Owner 25 Nov: coming soon
};
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const toast = (t, m) => { try { window.showToast(t, m); } catch (e) {} };
const money = (v) => { const c = (typeof JOURNAL_SETTINGS !== 'undefined' && JOURNAL_SETTINGS && JOURNAL_SETTINGS.currency) || 'USD'; try { return journalFormatCurrency(v, c); } catch (e) { return '$' + Number(v).toFixed(2); } };
const px = (v) => (Math.round(v * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const when = (ms) => { const d = new Date(ms); return ymd(d).slice(5) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const X_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const EXTRA_CSS = `.fjs-tag{ display:inline-block; margin-left:8px; padding:2px 8px; border-radius:999px; font:600 11px/16px var(--rz-font); background:rgba(245,197,66,.16); color:var(--rz-amber); vertical-align:middle; }
.fjs-badge{ display:inline-block; padding:4px 12px; border-radius:999px; font:700 13px/18px var(--rz-font); letter-spacing:.08em; }
.fjs-badge.sb{ background:rgba(245,197,66,.18); color:var(--rz-amber); border:1px solid rgba(245,197,66,.5); } .fjs-badge.lv{ background:rgba(255,107,107,.18); color:var(--rz-red); border:1px solid rgba(255,107,107,.6); }
.fjs-seg2{ display:grid; grid-template-columns:1fr 1fr; gap:4px; padding:4px; margin:0 0 16px; border-radius:12px; background:var(--rz-field); border:1px solid var(--rz-line); }
.fjs-seg2 button{ height:44px; border:0; border-radius:8px; background:transparent; color:var(--rz-ink-2); font:600 15px/20px var(--rz-font); cursor:pointer; }
.fjs-seg2 button[aria-checked="true"].buy{ background:var(--bull,#03c988); color:#050506; } .fjs-seg2 button[aria-checked="true"].sell{ background:var(--bear,#ff6b6b); color:#050506; }
.fjs-ord{ display:flex; align-items:center; justify-content:space-between; gap:8px; padding:10px 12px; border:1px solid var(--rz-line); border-radius:12px; margin:0 0 8px; font:400 13px/18px var(--rz-font); } .fjs-ord button{ height:40px; padding:0 14px; border:1px solid var(--rz-line); border-radius:10px; background:transparent; color:var(--rz-ink); font:600 13px/18px var(--rz-font); cursor:pointer; }
.fjs-confirm{ margin:0 0 16px; padding:14px; border:1px solid var(--rz-amber); border-radius:12px; font:600 16px/22px var(--rz-font); }
.fjs-sample{ margin:0 0 12px; font:600 12px/16px var(--rz-font); color:var(--rz-amber); letter-spacing:.04em; text-transform:uppercase; }
.fjs-sub{ margin:-4px 0 16px; font:400 15px/22px var(--rz-font); color:var(--rz-ink-2); }
#fjs .rjs-x{ width:48px; height:48px; margin-right:-4px; }
.fjs-h{ margin:20px 0 8px; font:600 13px/18px var(--rz-font); letter-spacing:.04em; text-transform:uppercase; color:var(--rz-ink-2); }
.fjs-grid{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); grid-auto-rows:1fr; gap:12px; margin:0; padding:0; list-style:none; }
.fjs-grid li{ display:flex; } .fjs-tile{ display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; width:100%; min-height:104px; padding:12px 8px; border:1px solid var(--rz-line); border-radius:16px; background:var(--rz-field); color:var(--rz-ink); cursor:pointer; transition:border-color .15s, background .15s; }
.fjs-tile:hover{ border-color:var(--rz-mint); }
.fjs-tile:active{ background:rgba(3,201,136,.08); }
.fjs-tile:disabled{ opacity:.6; cursor:default; }
.fjs-tile[aria-disabled="true"]{ opacity:.6; cursor:default; } .fjs-tile[aria-disabled="true"]:hover{ border-color:var(--rz-line); } .fjs-tile[aria-disabled="true"]:active{ background:var(--rz-field); }
.fjs-soon{ display:block; margin-top:-4px; font:400 12px/16px var(--rz-font); color:var(--rz-ink-2); text-align:center; }
.fjs-lg{ flex:none; display:block; width:48px; height:48px; border-radius:12px; overflow:hidden; background:#fff; border:1px solid var(--rz-line); }
.fjs-lg.nobg{ background:none; border:0; border-radius:0; overflow:visible; }
.fjs-lg img{ display:block; width:100%; height:100%; object-fit:contain; }
.fjs-lg.s32{ width:40px; height:40px; border-radius:10px; }
.fjs-tn{ display:block; max-width:100%; font:500 13px/16px var(--rz-font); text-align:center; overflow-wrap:anywhere; }
.fjs-linked{ border:1px solid var(--rz-line); border-radius:16px; background:var(--rz-field); }
.fjs-lrow{ position:relative; display:flex; align-items:center; gap:12px; min-height:64px; padding:8px 4px 8px 12px; border-bottom:1px solid var(--rz-line); }
.fjs-lrow:last-child{ border-bottom:0; }
.fjs-lt{ flex:1; min-width:0; }
.fjs-lt b{ display:block; font:600 15px/20px var(--rz-font); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.fjs-lt small{ display:flex; align-items:center; gap:6px; font:400 13px/18px var(--rz-font); color:var(--rz-ink-2); white-space:nowrap; overflow:hidden; }
.fjs-dot{ flex:none; width:8px; height:8px; border-radius:50%; background:var(--rz-ink-2); }
.fjs-dot.live{ background:var(--rz-mint); } .fjs-dot.paper{ background:var(--rz-amber); } .fjs-dot.need{ background:var(--rz-red); }
.fjs-more{ flex:none; display:inline-grid; place-items:center; width:48px; height:48px; padding:0; border:0; border-radius:50%; background:transparent; color:var(--rz-ink-1); cursor:pointer; }
.fjs-more:hover{ background:rgba(150,160,175,.16); }
.fjs-menu{ position:absolute; right:8px; top:calc(100% - 8px); z-index:5; min-width:176px; padding:4px; border:1px solid var(--rz-line); border-radius:12px; background:var(--rz-bg); box-shadow:0 12px 28px -8px rgba(0,0,0,.5); }
.fjs-menu button{ display:block; width:100%; height:48px; padding:0 12px; border:0; border-radius:8px; background:transparent; color:var(--rz-ink); font:500 15px/20px var(--rz-font); text-align:left; cursor:pointer; }
.fjs-menu button:hover{ background:rgba(150,160,175,.14); } .fjs-menu button.dng{ color:var(--rz-red); }
.fjs-empty{ margin:0; padding:20px 16px; border:1px dashed var(--rz-line); border-radius:16px; text-align:center; font:400 14px/20px var(--rz-font); color:var(--rz-ink-2); }
.fjs-trust{ display:flex; align-items:flex-start; gap:12px; margin:20px 0 0; padding-top:16px; border-top:1px solid var(--rz-line); font:400 13px/18px var(--rz-font); color:var(--rz-ink-1); }
.fjs-trust svg{ flex:none; width:20px; height:20px; color:var(--rz-mint); }
.fjs-trust a,.fjs-quiet a{ color:inherit; text-decoration:underline; text-underline-offset:2px; }
.fjs-quiet{ margin:8px 0 0 32px; font:400 12px/16px var(--rz-font); color:var(--rz-ink-2); }
#fjs .fjs-tag{ margin-left:8px; }
#fjs .rjs-head h2{ display:flex; align-items:center; } #fjs .fjs-tag{ vertical-align:baseline; }
#fjs .rjs-err{ margin-top:8px; padding:12px 16px; }
[data-theme="light"] #fjs .rjs-err{ color:#b3261e; border-color:rgba(179,38,30,.35); background:rgba(179,38,30,.06); }`;

// Errors always carry a readable message: the server's {error} line, or a plain one for a network failure / non-JSON page.
const NET_MSG = 'Couldn’t reach TradeZoro, try again.';
const FALLBACK = (st) => (st === 401 ? 'Your sign-in expired. Reload the page and try again.' : st === 403 ? 'This isn’t allowed for your account.' : st === 429 ? 'Too many tries. Wait a minute.' : 'Broker sync hit an error' + (st ? ' (code ' + st + ')' : '') + '. Try again in a minute.');
async function call(url, body, sample) {
  let t;
  try { t = await auth.currentUser.getIdToken(); } catch (e) { const er = new Error('Your sign-in expired. Reload the page and try again.'); er.status = 401; throw er; }
  let r;
  try { r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: JSON.stringify(body || {}), cache: 'no-store' }); }
  catch (e) { const er = new Error(NET_MSG); er.status = 0; er.network = true; throw er; }
  let j = null; try { j = await r.json(); } catch (e) {}
  if (!r.ok) { const e = new Error((j && typeof j.error === 'string' && j.error) || FALLBACK(r.status)); e.status = r.status; e.code = j && j.code; e.needsConnect = !!(j && j.needsConnect); throw e; }
  return j || {};
}

// onConnected (ZoroCharts live trading, assets/chart-live.js): called once accounts load after connecting; the sheet then closes
// (the chart picks the account itself; the journal import steps need the journal page).
// portal (Owner 19 Nov, "always open the connect page when connecting brokers, not just auto connect"): true = never auto-load the
// saved accounts and close; always show the Connect step, whose button opens the broker portal (the page where you pick a broker and
// sign in), started for the saved Finatic user so the accounts already linked stay linked. false/omitted = the quiet Reconnect path:
// a saved connection is reloaded (and the sheet closes in chart mode) without the portal.
export function openBrokerSync({ uid, onConnected, portal, admin } = {}) {
  if (!document.getElementById('rjs-css')) { const s = document.createElement('style'); s.id = 'rjs-css'; s.textContent = CSS; document.head.appendChild(s); }
  if (!document.getElementById('fjs-css')) { const s = document.createElement('style'); s.id = 'fjs-css'; s.textContent = EXTRA_CSS; document.head.appendChild(s); }
  const LS = 'stryker_broker_sync_user_' + uid;
  const lsGet = () => { try { return localStorage.getItem(LS) || ''; } catch (e) { return ''; } };
  const lsSet = (v) => { try { v ? localStorage.setItem(LS, v) : localStorage.removeItem(LS); } catch (e) {} };

  const back = document.createElement('div'); back.className = 'rjs-back'; back.id = 'fjs-back';
  const sheet = document.createElement('div'); sheet.className = 'rjs'; sheet.id = 'fjs'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', 'Connect your broker');
  back.appendChild(sheet); document.body.appendChild(back);
  const prevFocus = document.activeElement;
  const S = { step: 'start', userId: lsGet(), sessionId: '', accounts: [], account: null, from: ymd(new Date(Date.now() - 30 * 864e5)), to: ymd(new Date()), trips: [], open: [], need: [], pv: {}, raw: [], plan: null, sample: !!window.STRYKER_BROKER_SAMPLE, ord: { side: 'buy', type: 'market', qty: 1, symbol: '', limit: '', stop: '', tif: 'day' }, envMode: '', ordersOn: false, openOrders: [], recent: [] };
  window.STRYKER_BROKER_SYNC = { get step() { return S.step; } };
  function close() { back.remove(); document.removeEventListener('keydown', onKey, true); delete window.STRYKER_BROKER_SYNC; try { prevFocus && prevFocus.focus(); } catch (e) {} }
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  const head = (title, sub) => '<div class="rjs-grab"></div><div class="rjs-head"><h2>' + esc(title) + '</h2><button type="button" class="rjs-x" id="fjs-x" aria-label="Close">' + X_ICON + '</button></div>' + (sub ? '<p class="fjs-sub">' + esc(sub) + '</p>' : '') + (S.sample ? '<p class="fjs-sample">Sample data</p>' : '');
  const err = (m) => (m ? '<div class="rjs-err" role="alert">' + esc(m) + '</div>' : '');
  const wireX = () => { const x = sheet.querySelector('#fjs-x'); if (x) x.addEventListener('click', close); };
  const q = (s) => sheet.querySelector(s);
  const busy = (btn, label) => { btn.disabled = true; btn.innerHTML = '<span class="rjs-spin"></span>' + esc(label); };
  const userBody = () => (S.userId ? { userId: S.userId } : { sessionId: S.sessionId });
  const data = async (op, extra) => { const r = await call('/connect/finatic/data', Object.assign({ op }, userBody(), extra)); if (r.userId && r.userId !== S.userId) { S.userId = r.userId; lsSet(r.userId); } return r.data; };

  // ---- not set up
  function drawNotSetUp() {
    sheet.innerHTML = head('Connect your broker') + '<p class="rjs-lead">Not set up yet. The broker connection key has not been added to the site, so nothing can connect. ' + (admin ? 'Admin note: add FINATIC_API_KEY to the Pages secrets (see the handback notes), then redeploy.' : 'Please try again later.') + '</p><button type="button" class="rjs-ghost" id="fjs-close">Close</button>';
    wireX(); q('#fjs-close').addEventListener('click', close);
  }
  // ---- start: broker grid + already linked + trust row (one flow for the chart and the journal)
  const BROKERS = [['ctrader', 'cTrader', 'ctrader-mark.svg'], ['interactive-brokers', 'Interactive Brokers', 'ibkr.png'], ['metatrader-4', 'MetaTrader 4', 'mt4.png'], ['metatrader-5', 'MetaTrader 5', 'mt5.png'], ['ninjatrader', 'NinjaTrader', 'ninja.png'],
    ['rithmic', 'Rithmic', 'rithmic.png'], ['tastytrade', 'tastytrade', 'tastytrade.svg'], ['tradovate', 'Tradovate', 'tradovate.png'], ['webull', 'Webull', 'webull.png']];
  const logoFor = (name) => { const k = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, ''); const f = BROKERS.find((b) => k.indexOf(b[1].toLowerCase().replace(/[^a-z0-9]/g, '')) === 0 || (b[0] === 'interactive-brokers' && /^ibkr/.test(k))); return f ? '/assets/images/brokers/' + f[2] : ''; };
  const logo = (name, big) => { const u = logoFor(name); return '<span class="fjs-lg' + (big ? '' : ' s32') + (/ctrader/.test(u) ? ' nobg' : '') + '" aria-hidden="true">' + (u ? '<img src="' + u + '" alt="" width="48" height="48" loading="lazy">' : '') + '</span>'; };
  const LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  const DOTS = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>';
  const status = (a) => (a.sync.status === 'failed' ? ['need', 'Needs login'] : /paper|sim|demo|practice|sandbox/i.test(a.number + ' ' + a.broker) ? ['paper', 'Paper'] : ['live', 'Live']);
  const ago = (a) => (a.sync.at ? (ageText(a.sync.at, Date.now(), 0) || 'updated just now') : 'not synced yet');
  function linkedHtml() {
    if (S.lstate === 'loading') return '<p class="fjs-empty">Loading your accounts…</p>';
    if (!S.accounts.length) return '<p class="fjs-empty">No brokers linked yet. Pick one above to connect.</p>';
    return '<div class="fjs-linked">' + S.accounts.map((a) => { const st = status(a);
      return '<div class="fjs-lrow" data-row="' + esc(a.id) + '">' + logo(a.broker, false) + '<span class="fjs-lt"><b>' + esc(a.broker) + (a.last4 ? ' ···· ' + esc(a.last4) : '') + '</b><small><i class="fjs-dot ' + st[0] + '"></i>' + st[1] + ' · ' + esc(ago(a)) + '</small></span>' +
        '<button type="button" class="fjs-more" data-more="' + esc(a.id) + '" aria-haspopup="menu" aria-label="Actions for ' + esc(a.broker) + '">' + DOTS + '</button></div>'; }).join('') + '</div>';
  }
  async function loadLinked() {
    try {
      const r = await data('accounts');
      S.accounts = (Array.isArray(r) ? r : []).map((x) => Object.assign(acctInfo(x), { name: acctInfo(x).number || acctInfo(x).broker, cur: acctInfo(x).currency })).filter((x) => x.id);
      S.lstate = 'ok';
    } catch (e) { S.accounts = []; S.lstate = 'ok'; if (e.needsConnect) { S.userId = ''; lsSet(''); } }   // a stale saved id is forgotten quietly
    const box = q('#fjs-linked'); if (box && S.step === 'start') { box.innerHTML = linkedHtml(); wireLinked(); }
  }
  function wireLinked() {
    const closeMenu = () => { const m = q('.fjs-menu'); if (m) m.remove(); };
    sheet.querySelectorAll('[data-more]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation(); const had = b.parentNode.querySelector('.fjs-menu'); closeMenu(); if (had) return;
      const m = document.createElement('div'); m.className = 'fjs-menu'; m.setAttribute('role', 'menu');
      m.innerHTML = '<button type="button" role="menuitem" data-sync>Sync</button><button type="button" role="menuitem" class="dng" data-off>Disconnect</button>';
      m.addEventListener('click', (ev) => ev.stopPropagation()); b.parentNode.appendChild(m); m.querySelector('[data-sync]').focus();
      m.querySelector('[data-sync]').addEventListener('click', () => { closeMenu(); syncRow(b.dataset.more); });
      const off = m.querySelector('[data-off]');
      off.addEventListener('click', () => { if (!off.dataset.sure) { off.dataset.sure = '1'; off.textContent = 'Tap again to disconnect'; return; } closeMenu(); disconnectRow(b.dataset.more); });
    }));
    sheet.addEventListener('click', closeMenu, { once: true });
  }
  async function syncRow(id) {
    if (!onConnected) { S.account = S.accounts.find((x) => x.id === id) || S.accounts[0]; S.step = 'pick'; return draw(); }   // journal: go on to the account + dates step
    await loadLinked(); toast('success', 'Accounts updated.');
  }
  async function disconnectRow(id) {
    const a = S.accounts.find((x) => x.id === id); if (!a) return;
    try {
      const gs = await data('grants'); const gid = grantFor(a, Array.isArray(gs) ? gs : []);
      if (!gid) return drawStart('Could not tell which connection this is. Disconnect it at your broker.');
      await call('/connect/finatic/data', Object.assign({ op: 'revoke', grantId: gid }, userBody()));
      toast('success', a.broker + ' disconnected.'); await loadLinked();
    } catch (e) { drawStart(e.message || 'Could not disconnect.'); }
  }
  async function startConnect(brokerId, tile) {
    // Hosted MetaTrader 5 (login, password, server signed in on TradeZoro's server): chart only, admins + beta testers only
    // (window.__stkMtHost, set by chart-live.js after the same check as cTrader; the /connect/mt/* server re-checks every call).
    // Everyone else, MetaTrader 4, and the journal keep the existing path below.
    if (onConnected && brokerId === 'metatrader-5' && window.__stkMtHost) {
      return import('./mt-connect-ui.js?v=1291').then((m) => { close(); m.openMtConnect({ platform: 'mt5', onConnected: (acc) => { try { onConnected([acc]); } catch (e) {} } }); }).catch(() => drawStart('Could not open the sign-in. Try again.'));
    }
    const win = window.open('', '_blank');           // opened on the tap so pop-up blockers allow it
    sheet.querySelectorAll('.fjs-tile').forEach((t) => { t.disabled = true; });
    tile.querySelector('.fjs-tn').innerHTML = '<span class="rjs-spin"></span>Opening';
    try {
      const r = await call('/connect/finatic/session', Object.assign({ mode: 'dark', broker: brokerId }, S.userId ? { userId: S.userId } : {}));
      S.sessionId = r.sessionId || '';
      if (S.userId && !r.userId) { S.userId = ''; lsSet(''); }   // the saved user was gone: the new connection starts a new one
      if (win && r.portalUrl) { win.opener = null; win.location.href = r.portalUrl; } else if (r.portalUrl) { location.href = r.portalUrl; return; }
      S.step = 'wait'; draw();
    } catch (e2) { if (win) win.close(); const notSet = e2.status === 503 && (!e2.code || e2.code === 'not_set_up'); drawStart(notSet ? '' : (e2.message || 'Could not start.')); if (notSet) drawNotSetUp(); }
  }
  const brokerOn = (id) => (id === 'ctrader' ? !!window.__stkCt : id === 'metatrader-5' && BROKER_AVAILABLE[id] === 'gate' ? !!window.__stkMtHost : BROKER_AVAILABLE[id] !== false);
  function drawStart(error) {
    if (!(S.accounts[0] && S.accounts[0].sync)) { S.accounts = []; S.lstate = 'loading'; }   // the server knows the member's connection, so always ask
    sheet.innerHTML = head('Connect your broker', onConnected ? 'Trade and sync your accounts from the chart' : 'Pull your fills into the journal. Read only: it never places or changes an order.') + err(error) +
      '<ul class="fjs-grid" aria-label="Brokers">' + BROKERS.map((b) => { const on = brokerOn(b[0]);
        return '<li><button type="button" class="fjs-tile" data-broker="' + b[0] + '"' + (on ? '' : ' aria-disabled="true" title="Coming soon"') + '>' + logo(b[1], true) + '<span class="fjs-tn">' + esc(b[1]) + '</span>' + (on ? '' : '<span class="fjs-soon">Coming soon</span>') + '</button></li>'; }).join('') + '</ul>' +
      '<h3 class="fjs-h">Already linked</h3><div id="fjs-linked">' + linkedHtml() + '</div>' +
      '<p class="fjs-trust">' + LOCK + '<span>You log in on your broker’s own page. We never see your password. <a href="/help/connect-broker" target="_blank" rel="noopener">How it works</a></span></p>' +
      (onConnected ? '<p class="fjs-quiet">Live orders stay off until you <a href="/terms#broker-live" target="_blank" rel="noopener">turn on live trading</a>.</p>' : '');
    wireX(); wireLinked();
    sheet.querySelectorAll('.fjs-tile').forEach((t) => t.addEventListener('click', () => {
      if (t.getAttribute('aria-disabled') === 'true') return;
      if (t.dataset.broker === 'ctrader') { close(); window.__stkCt.open(); return; }   // the same cTrader trading sign-in the old menu button started
      startConnect(t.dataset.broker, t);
    }));
    if (S.lstate !== 'ok') loadLinked();
  }
  function drawWait(error) {
    sheet.innerHTML = head('Finish connecting') + err(error) +
      '<p class="rjs-lead">Choose your broker in the new tab and sign in. When it says you are connected, come back here and tap Continue.</p>' +
      '<button type="button" class="rjs-go" id="fjs-cont">Continue</button><button type="button" class="rjs-ghost" id="fjs-again">Open the broker tab again</button>';
    wireX(); q('#fjs-cont').addEventListener('click', loadAccounts); q('#fjs-again').addEventListener('click', () => { S.step = 'start'; draw(); });
  }
  async function loadAccounts() {
    const b = q('#fjs-cont') || q('#fjs-have'); if (b) busy(b, 'Loading accounts');
    try {
      const a = await data('accounts');
      S.accounts = (Array.isArray(a) ? a : []).map((x) => ({ id: x.accountId || x.id, name: x.accountName || x.name || x.nickname || x.brokerAccountId || x.accountId, broker: x.brokerName || x.brokerId || x.institutionName || '', cur: x.currencyCode || x.currency || '' })).filter((x) => x.id);
      if (!S.accounts.length) { S.step = 'wait'; return drawWait('No connected accounts yet. Finish connecting in the broker tab, then tap Continue.'); }
      if (onConnected) { toast('success', 'Broker connected.'); close(); try { onConnected(S.accounts); } catch (e2) {} return; }
      S.account = S.accounts[0]; S.step = 'pick'; draw();
    } catch (e) { if (e.needsConnect) { S.userId = ''; lsSet(''); if (S.step === 'wait' && S.sessionId) return drawWait('Not connected yet. Finish in the broker tab first, then tap Continue.'); S.step = 'start'; return drawStart(); /* stale stored id (e.g. from the old sandbox): forget it quietly */ } if (e.status === 503) return drawNotSetUp(); S.step = S.step === 'start' ? 'start' : 'wait'; (S.step === 'start' ? drawStart : drawWait)(e.message); }
  }
  // ---- pick account + dates
  function drawPick(error) {
    sheet.innerHTML = head('Choose what to sync') + err(error) +
      '<p class="rjs-sub">Account</p><div class="rjs-rows" role="radiogroup" aria-label="Account">' + S.accounts.map((a) =>
        '<button type="button" class="rjs-row" role="radio" aria-checked="' + (a.id === S.account.id) + '" data-acct="' + esc(a.id) + '"><i></i><span><b>' + esc(a.name) + '</b><small>' + esc(a.broker) + (a.cur ? ' · ' + esc(a.cur) : '') + '</small></span></button>').join('') + '</div>' +
      '<div class="rjs-two"><label class="rjs-f"><span>From</span><input class="rjs-in" type="date" id="fjs-from" value="' + esc(S.from) + '"></label><label class="rjs-f"><span>To</span><input class="rjs-in" type="date" id="fjs-to" value="' + esc(S.to) + '"></label></div>' +
      '<button type="button" class="rjs-go" id="fjs-load">Load trades</button>' + (admin ? '<button type="button" class="rjs-ghost" id="fjs-ordbtn">Order test (admin)</button>' : '') + '<button type="button" class="rjs-ghost" id="fjs-off">Disconnect</button>';
    wireX();
    sheet.querySelectorAll('[data-acct]').forEach((b) => b.addEventListener('click', () => { S.account = S.accounts.find((a) => a.id === b.dataset.acct); S.from = q('#fjs-from').value; S.to = q('#fjs-to').value; drawPick(); }));
    q('#fjs-load').addEventListener('click', loadTrades);
    q('#fjs-off').addEventListener('click', disconnect);
    const ob = q('#fjs-ordbtn'); if (ob) ob.addEventListener('click', () => { S.step = 'order'; draw(); });
  }
  async function loadTrades() {
    S.from = q('#fjs-from').value; S.to = q('#fjs-to').value;
    const f = Date.parse(S.from + 'T00:00:00'), t = Date.parse(S.to + 'T23:59:59');
    if (!isFinite(f) || !isFinite(t) || f > t) return drawPick('Pick a valid date range.');
    busy(q('#fjs-load'), 'Reading fills');
    try {
      let orders = [];
      for (let off = 0; off < 5000; off += 1000) { const page = await data('orders', { accountId: S.account.id, limit: 1000, offset: off }); const arr = Array.isArray(page) ? page : []; orders = orders.concat(arr); if (arr.length < 1000) break; }
      const ids = ordersToFetch(orders, f - 864e5, t + 864e5);
      let raw = [];
      for (let i = 0; i < ids.length; i += 25) raw = raw.concat(await data('fills', { accountId: S.account.id, orderIds: ids.slice(i, i + 25) }));
      S.raw = raw.filter((x) => { const m = Date.parse(x.executedAt); return isFinite(m) && m >= f - 864e5 && m <= t + 864e5; });   // a day of slack so a trade opened before the range still closes
      rebuild(); S.step = 'preview'; draw();
    } catch (e) { if (e.needsConnect) { S.userId = ''; lsSet(''); S.step = 'start'; return drawStart('Connection lost. Connect again.'); } drawPick(e.message || 'Could not read fills.'); }
  }
  function rebuild() {
    const r = tripsFromBroker(S.raw, S.account.id, S.pv);
    const f = Date.parse(S.from + 'T00:00:00'), t = Date.parse(S.to + 'T23:59:59');
    S.trips = r.trips.filter((x) => x.closedAt >= f && x.closedAt <= t); S.open = r.open; S.need = r.needsPointValue;
  }
  // ---- preview + import
  const existingKeys = () => new Set((typeof JOURNAL_TRADES !== 'undefined' ? JOURNAL_TRADES : []).map((t) => t.syncKey).filter(Boolean));
  function drawPreview() {
    const priced = S.trips.filter((t) => t.netPnl != null);
    const plan = planImport(priced, { existingKeys: existingKeys() }); S.plan = plan;
    const total = priced.reduce((a, t) => a + t.netPnl, 0), wins = priced.filter((t) => t.netPnl > 0).length;
    const cls = (v) => (v > 0 ? 'rjs-up' : v < 0 ? 'rjs-down' : '');
    const rows = priced.map((t) => '<tr><td>' + when(t.openedAt) + '</td><td><b>' + esc(t.symbol) + '</b></td><td>' + (t.direction === 'short' ? 'Short' : 'Long') + '</td><td class="r">' + t.quantity + '</td><td class="r">' + px(t.avgEntry) + '</td><td class="r">' + px(t.avgExit) + '</td><td class="r">' + (t.fees == null ? '—' : money(t.fees)) + '</td><td class="r ' + cls(t.netPnl) + '">' + money(t.netPnl) + '</td><td>' + (plan.dupes.includes(t) ? 'Already in journal' : 'New') + '</td></tr>').join('');
    const cards = priced.map((t) => '<div class="rjs-card"><div class="t"><span>' + esc(t.symbol) + ' · ' + (t.direction === 'short' ? 'Short' : 'Long') + ' ' + t.quantity + '</span><span class="' + cls(t.netPnl) + '">' + money(t.netPnl) + '</span></div><div class="m"><span>In ' + px(t.avgEntry) + ' → out ' + px(t.avgExit) + '</span><span>' + when(t.openedAt) + (plan.dupes.includes(t) ? ' · already in journal' : '') + '</span></div></div>').join('');
    sheet.innerHTML = head('Review trades') +
      (S.need.length ? '<div class="rjs-cap"><b>Point value needed.</b> No dollar value per point on file for ' + S.need.map(esc).join(', ') + '. Enter it once to price those trades.' + S.need.map((r) => '<div class="rjs-pv"><span style="min-width:56px"><b>' + esc(r) + '</b></span><input class="rjs-in" inputmode="decimal" data-pv="' + esc(r) + '" placeholder="$ per point" aria-label="Dollars per point for ' + esc(r) + '"><button type="button" class="rjs-ghost" style="width:auto;margin:0" data-setpv="' + esc(r) + '">Use</button></div>').join('') + '</div>' : '') +
      (priced.length ? '<div class="rjs-sum"><div><b>' + priced.length + '</b><span>Trades</span></div><div><b class="' + cls(total) + '">' + money(total) + '</b><span>Net P&amp;L</span></div><div><b>' + Math.round(wins / priced.length * 100) + '%</b><span>Winners</span></div></div>' +
        '<div class="rjs-tablewrap"><table class="rjs-table"><thead><tr><th>Opened</th><th>Symbol</th><th>Side</th><th class="r">Qty</th><th class="r">Entry</th><th class="r">Exit</th><th class="r">Fees</th><th class="r">Net P&amp;L</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div><div class="rjs-cards">' + cards + '</div>'
        : '<p class="rjs-lead">No closed trades found for ' + esc(S.account.name) + ' between ' + esc(S.from) + ' and ' + esc(S.to) + '.</p>') +
      (S.open.length ? '<p class="rjs-hint">Still open, not imported: ' + S.open.map((o) => esc(o.symbol) + ' ' + o.side + ' ' + o.qty).join(', ') + '.</p>' : '') +
      (plan.dupes.length ? '<p class="rjs-hint">' + plan.dupes.length + ' already in your journal. They will not be added again.</p>' : '') +
      '<p class="rjs-hint">Gross P&amp;L = points × the contract’s dollar value per point. Fees are included where the broker sent them. Education only. Not financial advice.</p><div style="height:16px"></div>' +
      '<button type="button" class="rjs-go" id="fjs-import"' + (plan.take.length ? '' : ' disabled') + '>' + (plan.take.length ? 'Import ' + plan.take.length + ' trade' + (plan.take.length === 1 ? '' : 's') : 'Nothing new to import') + '</button>' +
      '<button type="button" class="rjs-ghost" id="fjs-again2">Sync again</button><button type="button" class="rjs-ghost" id="fjs-back2">Back</button>';
    wireX();
    sheet.querySelectorAll('[data-setpv]').forEach((b) => b.addEventListener('click', () => { const r = b.dataset.setpv, v = Number(String(q('[data-pv="' + r + '"]').value).replace(/[$,\s]/g, '')); if (!(v > 0)) return toast('error', 'Enter a dollar value per point greater than 0.'); S.pv[r] = v; rebuild(); drawPreview(); }));
    q('#fjs-back2').addEventListener('click', () => { S.step = 'pick'; draw(); });
    q('#fjs-again2').addEventListener('click', async (e) => { busy(e.currentTarget, 'Syncing'); S.step = 'pick'; draw(); await loadTrades(); });
    const imp = q('#fjs-import'); if (imp) imp.addEventListener('click', () => runImport(plan.take));
  }
  async function runImport(trips) {
    const btn = q('#fjs-import'); busy(btn, 'Importing');
    try {
      const col = journalCollectionRef(JOURNAL_UID);
      const snaps = await Promise.all(trips.map((t) => col.doc(tripId(t)).get()));   // never overwrite a trade that exists (notes may have been added)
      const todo = trips.filter((t, i) => !snaps[i].exists);
      for (let i = 0; i < todo.length; i += 350) {
        const batch = db.batch();
        todo.slice(i, i + 350).forEach((t) => batch.set(col.doc(tripId(t)), Object.assign(tripToTrade(t, { label: S.account.name }), { createdAt: firebase.firestore.FieldValue.serverTimestamp(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() })));
        await batch.commit();
      }
      if (todo.length) { const upd = { journalEntryCount: firebase.firestore.FieldValue.increment(todo.length) }; if (todo.some((t) => t.netPnl > 0)) upd.hasWinningTrade = true; await db.collection('students').doc(JOURNAL_UID).set(upd, { merge: true }).catch(() => {}); }
      S.added = todo.length; toast('success', 'Imported ' + todo.length + ' trade' + (todo.length === 1 ? '' : 's') + '.');
      try { await reloadJournalData(); } catch (e) {}
      S.step = 'done'; draw();
    } catch (e) { console.error('TradeZoro: broker sync import failed', e); btn.disabled = false; btn.textContent = 'Import ' + trips.length + ' trades'; toast('error', 'Import failed: ' + (e && e.message || e)); }
  }

  // ---- ORDER TEST (admin only; sandbox by default). The server enforces admin, env and audit (no size or rate limits since 21 Nov); this is only the form.
  const orderCall = (b) => call('/connect/finatic/order', Object.assign({ userId: S.userId, accountId: S.account.id }, b));
  const badge = () => (S.envMode === 'live' ? '<span class="fjs-badge lv">LIVE</span>' : S.envMode === 'sandbox' ? '<span class="fjs-badge sb">SANDBOX</span>' : '');
  async function refreshOrders() {
    try {
      const o = await data('orders', { accountId: S.account.id, limit: 100 }); const arr = Array.isArray(o) ? o : [];
      S.openOrders = arr.filter((x) => /SUBMIT|PEND|OPEN|WORK|ACCEPT|NEW/i.test(x.status || '') && !/FILL|CANCEL|REJECT/i.test(x.status || '')).slice(0, 10);
      const filled = arr.filter((x) => /FILL/i.test(x.status || '')).slice(0, 5).map((x) => x.orderId);
      S.recent = filled.length ? (await data('fills', { accountId: S.account.id, orderIds: filled })).slice(0, 8) : [];
    } catch (e) { S.openOrders = []; S.recent = []; }
  }
  const sym = (o) => { const l = (o.legs || [])[0] || {}; return l.brokerProvidedSymbol || l.securityId || (l.instrument && l.instrument.displaySymbol) || ''; };
  function drawOrder(error, confirm) {
    const O = S.ord, off = !S.ordersOn;
    sheet.innerHTML = head('Order test (admin)') + '<p style="margin:0 0 12px">' + badge() + '</p>' + err(error) +
      (off ? '<div class="rjs-err" role="alert">' + (S.envMode === 'live' ? 'Live orders are off.' : 'Orders are not available.') + '</div>' : '') +
      '<p class="rjs-lead">Testing only. Orders go to a ' + (S.envMode === 'live' ? 'LIVE' : 'sandbox') + ' account, and every attempt is logged.</p>' +
      '<p class="rjs-sub">Account</p><div class="rjs-rows" role="radiogroup" aria-label="Account">' + S.accounts.map((a) => '<button type="button" class="rjs-row" role="radio" aria-checked="' + (a.id === S.account.id) + '" data-acct="' + esc(a.id) + '"><i></i><span><b>' + esc(a.name) + '</b><small>' + esc(a.broker) + '</small></span></button>').join('') + '</div>' +
      '<div class="fjs-seg2" role="radiogroup" aria-label="Side"><button type="button" class="buy" role="radio" aria-checked="' + (O.side === 'buy') + '" data-side="buy">Buy</button><button type="button" class="sell" role="radio" aria-checked="' + (O.side === 'sell') + '" data-side="sell">Sell</button></div>' +
      '<div class="rjs-two"><label class="rjs-f"><span>Symbol</span><input class="rjs-in" id="fo-sym" value="' + esc(O.symbol) + '" placeholder="MESZ6" autocapitalize="characters" autocomplete="off"></label><label class="rjs-f"><span>Quantity</span><input class="rjs-in" id="fo-qty" inputmode="numeric" value="' + esc(O.qty) + '"></label></div>' +
      '<div class="rjs-two"><label class="rjs-f"><span>Type</span><select class="rjs-in" id="fo-type"><option value="market"' + (O.type === 'market' ? ' selected' : '') + '>Market</option><option value="limit"' + (O.type === 'limit' ? ' selected' : '') + '>Limit</option><option value="stop"' + (O.type === 'stop' ? ' selected' : '') + '>Stop</option></select></label>' +
      '<label class="rjs-f"><span>Time in force</span><select class="rjs-in" id="fo-tif"><option value="day"' + (O.tif === 'day' ? ' selected' : '') + '>Day</option><option value="gtc"' + (O.tif === 'gtc' ? ' selected' : '') + '>GTC</option></select></label></div>' +
      (O.type === 'limit' ? '<label class="rjs-f"><span>Limit price</span><input class="rjs-in" id="fo-lim" inputmode="decimal" value="' + esc(O.limit) + '"></label>' : '') + (O.type === 'stop' ? '<label class="rjs-f"><span>Stop price</span><input class="rjs-in" id="fo-stp" inputmode="decimal" value="' + esc(O.stop) + '"></label>' : '') +
      (confirm ? '<div class="fjs-confirm" id="fo-conf">Place ' + O.side.toUpperCase() + ' ' + esc(O.qty) + ' ' + esc(O.symbol.toUpperCase()) + ' ' + esc(O.type) + (O.type === 'limit' ? ' @ ' + esc(O.limit) : O.type === 'stop' ? ' @ ' + esc(O.stop) : '') + ' on ' + esc(S.account.name) + '?</div><button type="button" class="rjs-go" id="fo-yes">Yes, place order</button><button type="button" class="rjs-ghost" id="fo-no">Back</button>'
        : '<button type="button" class="rjs-go" id="fo-place"' + (off ? ' disabled' : '') + '>Review order</button>') +
      '<p class="rjs-sub" style="margin-top:20px">Open orders</p>' + (S.openOrders.length ? S.openOrders.map((o) => '<div class="fjs-ord"><span><b>' + esc(sym(o)) + '</b> ' + esc(o.status) + '<br><small>' + esc(String(o.orderId).slice(0, 8)) + '</small></span><button type="button" data-cancel="' + esc(o.orderId) + '">Cancel</button></div>').join('') : '<p class="rjs-hint">None.</p>') +
      '<p class="rjs-sub" style="margin-top:16px">Recent fills</p>' + (S.recent.length ? S.recent.map((f) => '<div class="fjs-ord"><span><b>' + esc(f.side) + ' ' + esc(f.quantity) + ' ' + esc((f.instrument && f.instrument.displaySymbol) || f.securityId || '') + '</b> @ ' + esc(f.price) + '</span></div>').join('') : '<p class="rjs-hint">None.</p>') +
      '<button type="button" class="rjs-ghost" id="fo-refresh">Refresh</button><button type="button" class="rjs-ghost" id="fo-back">Back</button>';
    wireX();
    const rd = () => { const g = (id) => { const e = q(id); return e ? e.value : ''; }; O.symbol = g('#fo-sym'); O.qty = g('#fo-qty'); O.type = g('#fo-type') || O.type; O.tif = g('#fo-tif') || O.tif; if (q('#fo-lim')) O.limit = g('#fo-lim'); if (q('#fo-stp')) O.stop = g('#fo-stp'); };
    sheet.querySelectorAll('[data-acct]').forEach((b) => b.addEventListener('click', async () => { rd(); S.account = S.accounts.find((a) => a.id === b.dataset.acct); await refreshOrders(); drawOrder(); }));
    sheet.querySelectorAll('[data-side]').forEach((b) => b.addEventListener('click', () => { rd(); O.side = b.dataset.side; drawOrder(); }));
    q('#fo-type').addEventListener('change', () => { rd(); drawOrder(); });
    q('#fo-back').addEventListener('click', () => { S.step = 'pick'; draw(); });
    q('#fo-refresh').addEventListener('click', async (e) => { rd(); busy(e.currentTarget, 'Refreshing'); await refreshOrders(); drawOrder(); });
    sheet.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => { busy(b, '...'); try { await orderCall({ op: 'cancel', orderId: b.dataset.cancel }); toast('success', 'Cancel sent.'); await refreshOrders(); drawOrder(); } catch (e) { drawOrder(e.message); } }));
    const pl = q('#fo-place'); if (pl) pl.addEventListener('click', () => { rd(); const n = Number(O.qty); if (!/^[A-Za-z0-9._-]{1,20}$/.test(O.symbol)) return drawOrder('Enter a symbol.'); if (!Number.isInteger(n) || n < 1) return drawOrder('Quantity must be a whole number of 1 or more.'); if (O.type === 'limit' && !(Number(O.limit) > 0)) return drawOrder('Enter a limit price.'); if (O.type === 'stop' && !(Number(O.stop) > 0)) return drawOrder('Enter a stop price.'); drawOrder('', true); });
    const no = q('#fo-no'); if (no) no.addEventListener('click', () => drawOrder());
    const yes = q('#fo-yes'); if (yes) yes.addEventListener('click', async () => {
      busy(yes, 'Placing');
      try { const r = await orderCall({ op: 'place', symbol: O.symbol, side: O.side, qty: Number(O.qty), type: O.type, limitPrice: O.type === 'limit' ? O.limit : undefined, stopPrice: O.type === 'stop' ? O.stop : undefined, timeInForce: O.tif }); toast('success', 'Order accepted (' + (r.status || 'ok') + ').'); await refreshOrders(); drawOrder(); }
      catch (e) { drawOrder(e.message || 'Order failed.'); }
    });
  }
  async function openOrderStep() {
    sheet.innerHTML = head('Order test (admin)') + '<p class="rjs-lead">Checking…</p>'; wireX();
    try { const r = await orderCall({ op: 'env' }); S.envMode = r.env; S.ordersOn = !!r.enabled; } catch (e) { S.envMode = ''; S.ordersOn = false; }
    await refreshOrders(); drawOrder();
  }
  async function disconnect() {
    busy(q('#fjs-off'), 'Disconnecting');
    try {
      const gs = await data('grants');
      for (const g of (Array.isArray(gs) ? gs : [])) if (g && g.id && !g.revokedAt) await call('/connect/finatic/data', Object.assign({ op: 'revoke', grantId: g.id }, userBody()));
      S.userId = ''; lsSet(''); S.accounts = []; S.step = 'start'; toast('success', 'Disconnected.'); draw();
    } catch (e) { drawPick(e.message || 'Could not disconnect.'); }
  }
  function drawDone() {
    sheet.innerHTML = head('Done') + '<div class="rjs-done"><b>' + (S.added || 0) + ' trade' + (S.added === 1 ? '' : 's') + ' added</b><p>Tagged “Broker sync”. Syncing the same days again adds nothing twice.</p></div><button type="button" class="rjs-go" id="fjs-fin">Done</button>';
    wireX(); q('#fjs-fin').addEventListener('click', close);
  }
  function draw() { sheet.classList.toggle('rjs-wide', S.step === 'preview'); if (S.step === 'start') drawStart(); else if (S.step === 'wait') drawWait(); else if (S.step === 'pick') drawPick(); else if (S.step === 'preview') drawPreview(); else if (S.step === 'order') openOrderStep(); else drawDone(); sheet.scrollTop = 0; }

  // Probe first: "Not set up yet" when the server key is missing.
  fetch('/connect/finatic/session?probe=1', { cache: 'no-store' }).then((r) => r.json().catch(() => ({}))).then((j) => { if (!(j && j.configured)) return drawNotSetUp(); draw(); if (S.userId && !portal) loadAccounts(); }).catch(() => drawStart(NET_MSG));
  sheet.innerHTML = head('Connect your broker') + '<p class="rjs-lead">Checking…</p>'; wireX();
}
