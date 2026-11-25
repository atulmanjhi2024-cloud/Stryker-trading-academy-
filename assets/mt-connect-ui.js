// MetaTrader 4 / 5 sign-in sheet (Owner order 22 Nov 2026): Server (search), Login, Password, read-only switch, Connect.
// The password goes to /connect/mt/link once, over HTTPS with the member's sign-in token. It is kept sealed on TradeZoro's server and
// never comes back to the browser. Sheet styling = the Connect sheet's tokens (rithmic-journal-ui CSS, design standard).
import { CSS } from './rithmic-journal-ui.js?v=1283';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const X = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
export const MT_CSS = `
#mtc .mtc-sub{ margin:-4px 0 16px; font:400 15px/22px var(--rz-font); color:var(--rz-ink-2); }
#mtc .rjs-in{ font-variant-numeric:tabular-nums; }
#mtc .mtc-box{ position:relative; }
#mtc .mtc-list{ position:absolute; left:0; right:0; top:calc(100% + 4px); z-index:6; max-height:208px; overflow-y:auto; margin:0; padding:4px; list-style:none; border:1px solid var(--rz-line); border-radius:12px; background:var(--rz-bg); box-shadow:0 12px 28px -8px rgba(0,0,0,.5); }
#mtc .mtc-list button{ display:flex; align-items:center; width:100%; height:44px; padding:0 12px; border:0; border-radius:8px; background:transparent; color:var(--rz-ink); font:400 15px/20px var(--rz-font); text-align:left; cursor:pointer; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#mtc .mtc-list button:hover,#mtc .mtc-list button[aria-selected="true"]{ background:rgba(150,160,175,.14); }
#mtc .mtc-list .mtc-none{ padding:12px; font:400 13px/18px var(--rz-font); color:var(--rz-ink-2); }
#mtc .mtc-sw{ display:flex; align-items:center; gap:12px; width:100%; min-height:56px; margin:0 0 16px; padding:8px 14px; border:1px solid var(--rz-line); border-radius:12px; background:var(--rz-field); color:var(--rz-ink); text-align:left; cursor:pointer; font:400 15px/20px var(--rz-font); }
#mtc .mtc-sw b{ display:block; font-weight:600; } #mtc .mtc-sw small{ display:block; font:400 12px/16px var(--rz-font); color:var(--rz-ink-2); }
#mtc .mtc-sw .mtc-tx{ flex:1; min-width:0; }
#mtc .mtc-knob{ flex:none; position:relative; width:44px; height:26px; border-radius:999px; background:rgba(150,160,175,.35); transition:background .2s cubic-bezier(.2,0,0,1); }
#mtc .mtc-knob::after{ content:''; position:absolute; top:3px; left:3px; width:20px; height:20px; border-radius:50%; background:#fff; transition:transform .2s cubic-bezier(.2,0,0,1); }
#mtc .mtc-sw[aria-checked="true"] .mtc-knob{ background:var(--rz-mint); } #mtc .mtc-sw[aria-checked="true"] .mtc-knob::after{ transform:translateX(18px); }
#mtc .mtc-prog{ display:flex; align-items:center; gap:12px; margin:0 0 16px; font:500 14px/20px var(--rz-font); color:var(--rz-ink-1); }
#mtc .mtc-prog[hidden]{ display:none; }
#mtc .mtc-adv{ display:block; margin:16px 0 0; text-align:center; font:400 13px/18px var(--rz-font); color:var(--rz-ink-2); }
#mtc .mtc-adv a,#mtc .mtc-lock a{ color:inherit; text-decoration:underline; text-underline-offset:2px; }
#mtc .rjs-lock{ align-items:flex-start; } #mtc .rjs-lock svg{ margin-top:0; }
@media (prefers-reduced-motion:reduce){ #mtc .mtc-knob,#mtc .mtc-knob::after{ transition:none; } }`;

// plain-English line for each host error code
export const MT_ERR = { bad_credentials: 'Login, password or server is not right. Check all three.', server_timeout: 'That server did not answer. Check the server name and try again.',
  bad_login: 'The login is the number your broker gave you.', bad_server: 'Pick the server your broker gave you.', bad_password: 'Enter your password.', exists: 'This account is already linked.',
  limit: 'You have reached the account limit. Remove one first.', rate_limited: 'Too many tries. Wait a minute.', not_set_up: 'MetaTrader sign-in is coming soon.', upstream: 'MetaTrader connection is restarting. Try again in a minute.', restarting: 'MetaTrader connection is restarting. Try again in a minute.',
  signed_out: 'Your sign-in expired. Reload the page and try again.', mt4_not_ready: 'MetaTrader 4 sign-in is not open yet. Use MetaTrader 5, or the Advanced guide for MetaTrader 4.', login_failed: 'Could not sign in. Check login, password and server.' };
export const errText = (e) => (e && (MT_ERR[e.code] || e.message)) || 'Could not connect. Try again.';

async function call(path, body) {
  let t; try { t = await firebase.auth().currentUser.getIdToken(); } catch (e) { const er = new Error(MT_ERR.signed_out); er.code = 'signed_out'; throw er; }
  let r; try { r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: Object.assign({ authorization: 'Bearer ' + t }, body === undefined ? {} : { 'content-type': 'application/json' }), body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' }); }
  catch (e) { const er = new Error('Couldn’t reach TradeZoro, try again.'); er.code = 'upstream'; throw er; }
  let j = null; try { j = await r.json(); } catch (e) {}
  if (!r.ok) { const e = new Error((j && j.error) || 'Request failed (code ' + r.status + ').'); e.code = j && j.code; e.status = r.status; throw e; }
  return j || {};
}
export const mtCall = call;

// openMtConnect({ platform: 'mt5'|'mt4', onConnected(account) })
export function openMtConnect({ platform = 'mt5', onConnected, advancedHref = '/help/connect-broker-metatrader-' + (platform === 'mt4' ? '4' : '5') } = {}) {
  for (const [id, css] of [['rjs-css', CSS], ['mtc-css', MT_CSS]]) if (!document.getElementById(id)) { const s = document.createElement('style'); s.id = id; s.textContent = css; document.head.appendChild(s); }
  const name = platform === 'mt4' ? 'MetaTrader 4' : 'MetaTrader 5';
  const back = document.createElement('div'); back.className = 'rjs-back';
  const sheet = document.createElement('div'); sheet.className = 'rjs'; sheet.id = 'mtc'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', 'Connect ' + name);
  back.appendChild(sheet); document.body.appendChild(back);
  const prev = document.activeElement;
  const S = { ro: false, busy: false, sel: -1, list: [], timer: null, tq: 0 };
  const close = () => { clearInterval(S.timer); back.remove(); document.removeEventListener('keydown', onKey, true); try { prev && prev.focus(); } catch (e) {} };
  const onKey = (e) => { if (e.key === 'Escape' && !S.busy) { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('mousedown', (e) => { if (e.target === back && !S.busy) close(); });
  sheet.innerHTML = '<div class="rjs-grab"></div><div class="rjs-head"><h2>Connect ' + name + '</h2><button type="button" class="rjs-x" id="mtc-x" aria-label="Close">' + X + '</button></div>' +
    '<p class="mtc-sub">Sign in with the login your broker gave you. Nothing to install or keep running on your computer.</p>' +
    '<div id="mtc-err"></div>' +
    '<div class="rjs-f mtc-srv"><span id="mtc-sl">Server</span><div class="mtc-box"><input class="rjs-in" id="mtc-server" type="text" role="combobox" aria-expanded="false" aria-controls="mtc-list" aria-labelledby="mtc-sl" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Search your broker’s server" maxlength="60"><ul class="mtc-list" id="mtc-list" role="listbox" hidden></ul></div><small class="rjs-hint">The exact server name from your broker’s email, for example “BrokerName-Live”.</small></div>' +
    '<label class="rjs-f"><span>Login</span><input class="rjs-in" id="mtc-login" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="12" placeholder="Account number"></label>' +
    '<label class="rjs-f"><span>Password</span><input class="rjs-in" id="mtc-pw" type="password" autocomplete="new-password" maxlength="100" placeholder="Your trading password"></label>' +
    '<button type="button" class="mtc-sw" id="mtc-ro" role="switch" aria-checked="false"><span class="mtc-tx"><b>Read-only (investor password)</b><small>See balance and trades. No orders can be sent.</small></span><i class="mtc-knob" aria-hidden="true"></i></button>' +
    '<div id="mtc-prog" class="mtc-prog" hidden></div>' +
    '<button type="button" class="rjs-go" id="mtc-go">Connect</button>' +
    '<p class="rjs-lock mtc-lock">' + LOCK + '<span>Your password is encrypted on our server, used only to keep your account connected, and never shown again. Remove the account any time and it is deleted.</span></p>' +
    '<p class="mtc-adv">Prefer to run MetaTrader on your own computer? <a href="' + esc(advancedHref) + '" target="_blank" rel="noopener">Advanced: use your own MetaTrader</a></p>';
  const q = (s) => sheet.querySelector(s);
  const srv = q('#mtc-server'), list = q('#mtc-list'), go = q('#mtc-go');
  q('#mtc-x').addEventListener('click', () => { if (!S.busy) close(); });
  const showErr = (m) => { q('#mtc-err').innerHTML = m ? '<div class="rjs-err" role="alert">' + esc(m) + '</div>' : ''; };
  // server search: typed text -> /connect/mt/servers?q=, debounced; a name that is not in the list can still be used as typed
  const draw = () => {
    const v = srv.value.trim();
    list.innerHTML = S.list.length ? S.list.map((s, i) => '<li role="presentation"><button type="button" role="option" tabindex="-1" aria-selected="' + (i === S.sel) + '" data-i="' + i + '">' + esc(s) + '</button></li>').join('') : '<li class="mtc-none">' + (v ? 'No match in our list. Use “' + esc(v) + '” as typed.' : 'Type to search.') + '</li>';
    list.hidden = false; srv.setAttribute('aria-expanded', 'true');
  };
  const hide = () => { list.hidden = true; srv.setAttribute('aria-expanded', 'false'); };
  const pick = (i) => { if (S.list[i]) { srv.value = S.list[i]; hide(); q('#mtc-login').focus(); } };
  const search = () => { const mine = ++S.tq; call('/connect/mt/servers?q=' + encodeURIComponent(srv.value.trim())).then((r) => { if (mine !== S.tq) return; S.list = Array.isArray(r.servers) ? r.servers : []; S.sel = -1; draw(); }).catch(() => { if (mine === S.tq) { S.list = []; draw(); } }); };
  let deb = 0; srv.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(search, 180); });
  srv.addEventListener('focus', () => { search(); });
  srv.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (list.hidden) { search(); return; } S.sel = Math.max(0, Math.min(S.list.length - 1, S.sel + (e.key === 'ArrowDown' ? 1 : -1))); draw(); }
    else if (e.key === 'Enter' && !list.hidden && S.sel >= 0) { e.preventDefault(); pick(S.sel); }
    else if (e.key === 'Escape' && !list.hidden) { e.stopPropagation(); hide(); }
  });
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) pick(Number(b.dataset.i)); });
  sheet.addEventListener('mousedown', (e) => { if (!e.target.closest('.mtc-srv')) hide(); });
  const ro = q('#mtc-ro'); ro.addEventListener('click', () => { S.ro = !S.ro; ro.setAttribute('aria-checked', String(S.ro)); q('#mtc-pw').placeholder = S.ro ? 'Your investor password' : 'Your trading password'; });
  // progress: one request, so the labels follow the time it normally takes (find server, sign in, load the account)
  const STEPS = ['Finding your server…', 'Signing in…', 'Loading your account…'];
  const progress = (on) => {
    const p = q('#mtc-prog'); clearInterval(S.timer);
    if (!on) { p.hidden = true; return; }
    let i = 0; p.hidden = false; const set = () => { p.innerHTML = '<span class="rjs-spin"></span><span role="status">' + STEPS[Math.min(i, STEPS.length - 1)] + '</span>'; }; set();
    S.timer = setInterval(() => { i++; set(); }, 4500);
  };
  async function submit() {
    if (S.busy) return;
    const server = srv.value.trim(), login = q('#mtc-login').value.trim(), password = q('#mtc-pw').value;
    if (!server) return showErr(MT_ERR.bad_server); if (!/^\d{1,12}$/.test(login)) return showErr(MT_ERR.bad_login); if (!password) return showErr(MT_ERR.bad_password);
    showErr(''); S.busy = true; go.disabled = true; go.innerHTML = '<span class="rjs-spin"></span>Connecting'; sheet.querySelectorAll('input,#mtc-ro').forEach((x) => { x.disabled = true; }); progress(true);
    try {
      const r = await call('/connect/mt/link', { platform, server, login, password, mode: S.ro ? 'investor' : 'trading' });
      q('#mtc-pw').value = '';
      close();
      try { onConnected && onConnected(r.account, r.account_info); } catch (e) {}
    } catch (e) {
      progress(false); S.busy = false; go.disabled = false; go.textContent = 'Connect'; sheet.querySelectorAll('input,#mtc-ro').forEach((x) => { x.disabled = false; });
      showErr(errText(e)); q('#mtc-pw').focus();
    }
  }
  go.addEventListener('click', submit);
  sheet.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target !== srv) { e.preventDefault(); submit(); } });
  setTimeout(() => srv.focus(), 60);
  return { close };
}
