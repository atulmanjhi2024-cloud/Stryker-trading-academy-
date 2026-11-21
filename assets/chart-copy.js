// TradeZoro — COPY TRADING ACROSS YOUR OWN ACCOUNTS (Owner order 21 Nov 2026, roadmap card copy-trading). ES module, loaded by
// assets/chart-live.js for every signed-in member with the live module. Trade menu > Copy trading opens this panel.
// One member, their OWN accounts only: pick ONE leader (a connected live account) and followers (the member's other connected accounts,
// any broker, plus Paper). Per follower: on/off, size (same / multiplier x0.1..x10 / fixed qty), contract (same / to micro / to full
// size, the order window's mini / micro pairs), copy exits (on by default). Orders placed in TradeZoro on the leader go through the copy
// route (functions/connect/finatic/copy.js): the leader first, then each follower ONLY once the leader is accepted, each with its own
// audit row and idempotency key; one failing never blocks another. Paper followers run here (window.__stkPaper.copyRun).
// Orders placed in the broker's own platform are NOT copied (the broker link has no reliable near-real-time order feed); the panel says so.
// Safety: the global kill switch and the per-member admin block apply to every follower order (server); one-tap Pause copying and
// Flatten all copied accounts; turning it on needs Enable live trading accepted plus a one-time copy confirm (stored server-side).
// Test hooks: localhost only (window.__stkLiveTest). Tests: tools/tests/copy-trade-browser.js. Education only. Not financial advice.
import * as C from './copy-trade-core.js?v=1198';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 14));
const MAP_LABEL = { same: 'Same contract', micro: 'Micro (NQ to MNQ)', full: 'Full size (MNQ to NQ)' };
const STATE_LABEL = { sent: 'Sent', filled: 'Filled', rejected: 'Rejected', unknown: 'No clear answer', skipped: 'Skipped', duplicate: 'Already sent', paper: 'Paper' };
let LV = null, PP = null, toast = () => {};
const S = { cfg: null, loaded: false, err: '', log: [], paperLinks: new Map(), syncAt: 0, bracketOpen: false, draft: null, busy: false };

async function call(body, fresh) {
  let t; try { t = await firebase.auth().currentUser.getIdToken(!!fresh); } catch (e) { throw Object.assign(new Error('Sign in again.'), { status: 401 }); }
  let r; try { r = await fetch('/connect/finatic/copy', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: JSON.stringify(body), cache: 'no-store' }); }
  catch (e) { throw Object.assign(new Error('No answer from TradeZoro.'), { status: 0 }); }
  if (r.status === 401 && !fresh) return call(body, true);
  let j = null; try { j = await r.json(); } catch (e) {}
  if (!r.ok) throw Object.assign(new Error((j && j.error) || 'Request failed (code ' + r.status + ').'), { status: r.status, code: j && j.code });
  return j || {};
}
const accounts = () => (LV && LV.state && Array.isArray(LV.state.accounts) ? LV.state.accounts : []);
const nameOf = (id) => { if (C.isPaper(id)) return 'Paper'; const a = accounts().find((x) => x.id === id); return a ? a.label : 'Account …' + String(id).slice(-4); };
const runningFor = (id) => { const c = S.cfg; return !!(c && c.on && !c.paused && c.consented && c.leader === id && c.followers.some((f) => f.on)); };

async function load() {
  try { const r = await call({ op: 'get' }); S.cfg = r.cfg; S.err = ''; } catch (e) { S.err = e.message; }
  S.loaded = true; redraw(); menuRefresh();
}
const menuRefresh = () => { try { window.dispatchEvent(new CustomEvent('stklive:menu', { detail: { what: 'copy' } })); } catch (e) {} };

// ---- after a leader write: per-account toasts, the status list, Paper followers ----------------------------------------------
function after(lead, r) {
  const res = r && r.copy && Array.isArray(r.copy.results) ? r.copy.results : null;
  if (!res) return;
  const what = describe(lead);
  for (const x of res) {
    let row = x;
    if (x.state === 'paper') row = Object.assign({ id: 'paper' }, paperRun(x.paper, lead, r.orderId));
    if (row.bracket) S.bracketOpen = true;
    S.log.unshift({ at: Date.now(), id: row.id, what, state: row.state, message: row.message || '' });
    const ok = row.state === 'sent' || row.state === 'filled';
    if (row.state !== 'skipped') toast('Copy to ' + nameOf(row.id) + ': ' + (STATE_LABEL[row.state] || row.state) + (row.message && !ok ? '. ' + row.message : '.'), ok ? 'success' : row.state === 'duplicate' ? 'info' : 'error');
  }
  S.log = S.log.slice(0, 30);
  redraw();
}
const describe = (b) => (b.op === 'place' ? (b.side === 'buy' ? 'Buy ' : 'Sell ') + b.qty + ' ' + b.symbol + ' ' + String(b.type || '').replace('_', ' ') : b.op === 'flatten' ? 'Flatten ' + b.symbol : b.op === 'cancel' ? 'Cancel order' : 'Move order');
// a Paper follower: the server sized and mapped the order; the paper engine places it (its own checks and messages)
function paperRun(body, lead, leaderOrderId) {
  if (!PP || !PP.copyRun) return { state: 'rejected', message: 'Paper trading is not loaded on this chart.' };
  const s = C.splitCode(body.symbol), sym = 'futures:' + (s ? s.root : body.symbol) + '1!';
  try {
    if (body.op === 'place') {
      const price = body.type === 'limit' ? body.limitPrice : body.type === 'stop' ? body.stopPrice : undefined;
      if (body.type === 'stop_limit') return { state: 'rejected', message: 'Paper has no stop limit orders.' };
      const out = PP.copyRun((a) => a.placeOrder({ symbol: sym, side: body.side, type: body.type, qty: body.qty, price, sl: body.bracket ? body.bracket.sl : undefined, tp: body.bracket ? body.bracket.tp : undefined }));
      if (out && out.order && leaderOrderId) S.paperLinks.set(String(leaderOrderId), out.order.id);
      return { state: out && out.order ? 'sent' : 'filled', message: out && out.order ? 'Working on Paper' : 'Filled on Paper' };
    }
    if (body.op === 'flatten') { PP.copyRun((a, specOf) => { const sp = specOf(sym); a.cancelAll(sp.symbol); return a.position(sym) ? a.closePosition(sym) : []; }); return { state: 'filled', message: 'Flattened on Paper' }; }
    const pid = S.paperLinks.get(String(lead.orderId || ''));
    if (!pid) return { state: 'skipped', message: 'No copied Paper order.' };
    if (body.op === 'cancel') { PP.copyRun((a) => { a.cancelOrder(pid); return []; }); S.paperLinks.delete(String(lead.orderId)); return { state: 'sent', message: 'Cancelled on Paper' }; }
    if (body.op === 'modify') { PP.copyRun((a) => { a.modifyOrder(pid, { price: body.limitPrice != null ? body.limitPrice : body.stopPrice }); return []; }); return { state: 'sent', message: 'Moved on Paper' }; }
  } catch (e) { return { state: 'rejected', message: String((e && e.message) || 'Paper refused it.').slice(0, 200) }; }
  return { state: 'skipped', message: '' };
}
// copied stop loss / take profit: each follower's own group moves on (children after the fill, one-cancels-other), at most every 10 s
async function sync(code) {
  if (!S.bracketOpen || Date.now() - S.syncAt < 10000) return;
  S.syncAt = Date.now();
  try { const r = await call({ op: 'sync', symbol: code }); const res = (r.copy && r.copy.results) || []; S.bracketOpen = res.some((x) => x.group && x.group.state !== 'closed'); } catch (e) {}
}

// ---- panel -----------------------------------------------------------------------------------------------------------------
let el = null;
function draftFrom(c) {
  const live = accounts(), cfg = c || { on: false, paused: false, leader: '', followers: [] };
  const leader = cfg.leader && live.some((a) => a.id === cfg.leader) ? cfg.leader : (live[0] ? live[0].id : '');
  const fol = new Map((cfg.followers || []).map((f) => [f.id, f]));
  const ids = live.map((a) => a.id).concat('paper');
  return { on: !!cfg.on, paused: !!cfg.paused, leader, rows: ids.map((id) => Object.assign({ id, on: false, mode: 'same', mult: 1, qty: 1, map: 'same', exits: true }, fol.get(id) || {}, { listed: fol.has(id) })) };
}
function open() {
  if (el) el.remove();
  S.draft = draftFrom(S.cfg);
  el = document.createElement('div'); el.id = 'stkcp'; el.className = 'stkcp';
  el.innerHTML = '<div class="stkcp-box" role="dialog" aria-modal="true" aria-labelledby="stkcp-h"><div class="stkcp-grab" aria-hidden="true"></div><div class="stkcp-hd"><h2 id="stkcp-h">Copy trading</h2><span class="stkcp-chip" data-chip></span><button type="button" class="stkcp-x" data-k="x" aria-label="Close" title="Close"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div><div class="stkcp-body" data-body></div><div class="stkcp-ft" data-ft></div></div>';
  document.body.appendChild(el);
  const prev = document.activeElement;
  const close = () => { if (!el) return; el.remove(); el = null; document.removeEventListener('keydown', key, true); try { prev && prev.focus && prev.focus(); } catch (e) {} };
  const key = (e) => { if (!el) return; if (e.key === 'Escape') { e.stopPropagation(); if (el.querySelector('.stkcp-cf')) { el.querySelector('.stkcp-cf').remove(); return; } close(); } };
  document.addEventListener('keydown', key, true);
  el.addEventListener('mousedown', (e) => { if (e.target === el) close(); });
  el.addEventListener('click', (e) => { const k = e.target.closest('[data-k]'); if (!k) return; onAct(k.dataset.k, k, close); });
  el.addEventListener('change', (e) => onChange(e.target));
  el.addEventListener('input', (e) => { if (e.target.matches('input[type=number]')) onChange(e.target, true); });
  redraw();
  setTimeout(() => { const x = el && (el.querySelector('select') || el.querySelector('.stkcp-x')); if (x) x.focus(); }, 0);
  if (!S.loaded) load();
}
function rowHtml(r) {
  const d = S.draft, isLead = r.id === d.leader; if (isLead) return '';
  const nm = nameOf(r.id), num = r.mode === 'mult' ? r.mult : r.qty;
  return '<div class="stkcp-row' + (r.on ? ' on' : '') + '" data-row="' + esc(r.id) + '">' +
    '<label class="stkcp-tg"><input type="checkbox" role="switch" data-f="on" ' + (r.on ? 'checked' : '') + ' aria-label="Copy to ' + esc(nm) + '"><span class="stkcp-tgk" aria-hidden="true"></span><span class="stkcp-nm">' + esc(nm) + '</span>' + (C.isPaper(r.id) ? '<span class="stkcp-tag">Practice</span>' : '') + '</label>' +
    '<div class="stkcp-opts"' + (r.on ? '' : ' hidden') + '>' +
      '<div class="stkcp-f"><span class="stkcp-l">Size</span><div class="stkcp-seg" role="radiogroup" aria-label="Size for ' + esc(nm) + '">' + C.MODES.map((m) => '<button type="button" role="radio" aria-checked="' + (r.mode === m) + '" data-k="mode" data-v="' + m + '">' + ({ same: 'Same size', mult: 'Multiplier', fixed: 'Fixed qty' }[m]) + '</button>').join('') + '</div>' +
        (r.mode === 'same' ? '' : '<input type="number" inputmode="decimal" data-f="' + (r.mode === 'mult' ? 'mult' : 'qty') + '" value="' + esc(num) + '" min="' + (r.mode === 'mult' ? '0.1' : '1') + '" max="' + (r.mode === 'mult' ? '10' : '1000000') + '" step="' + (r.mode === 'mult' ? '0.1' : '1') + '" aria-label="' + (r.mode === 'mult' ? 'Multiplier, 0.1 to 10' : 'Fixed quantity') + '"><span class="stkcp-hint">' + (r.mode === 'mult' ? 'x0.1 to x10, rounded to whole contracts' : 'Contracts on every copied order') + '</span>') + '</div>' +
      '<div class="stkcp-2"><label class="stkcp-f"><span class="stkcp-l">Contract</span><select data-f="map">' + C.MAPS.map((m) => '<option value="' + m + '"' + (r.map === m ? ' selected' : '') + '>' + MAP_LABEL[m] + '</option>').join('') + '</select></label>' +
      '<label class="stkcp-ck"><input type="checkbox" data-f="exits" ' + (r.exits ? 'checked' : '') + '><span>Copy exits</span></label></div>' +
    '</div></div>';
}
function redraw() {
  if (!el) return;
  const d = S.draft || draftFrom(S.cfg), live = accounts(), cfg = S.cfg;
  const chip = el.querySelector('[data-chip]'), st = badge();
  chip.textContent = st ? st.text : 'Off'; chip.className = 'stkcp-chip' + (st && st.on ? ' on' : st && st.text === 'Paused' ? ' paused' : '');
  const body = el.querySelector('[data-body]');
  if (!live.length) { body.innerHTML = '<p class="stkcp-p">Connect a broker first. Copy trading copies orders from one of your accounts to your other accounts.</p>'; el.querySelector('[data-ft]').innerHTML = ''; return; }
  const scroll = body.scrollTop;
  body.innerHTML =
    '<p class="stkcp-note"><b>Copies orders you place in TradeZoro.</b> Orders you place in your broker’s own platform are not copied. Only your own accounts. <a href="/help/copy-trading" target="_blank" rel="noopener">How it works</a></p>' +
    (S.err ? '<p class="stkcp-err" role="alert">' + esc(S.err) + '</p>' : '') +
    '<label class="stkcp-f"><span class="stkcp-l">Leader account</span><select data-f="leader" aria-describedby="stkcp-lh">' + live.map((a) => '<option value="' + esc(a.id) + '"' + (a.id === d.leader ? ' selected' : '') + '>' + esc(a.label) + '</option>').join('') + '</select><span class="stkcp-hint" id="stkcp-lh">Orders you place on this account are copied.</span></label>' +
    '<div class="stkcp-sec"><span class="stkcp-l">Follower accounts</span>' + d.rows.map(rowHtml).join('') + '</div>' +
    '<label class="stkcp-main"><input type="checkbox" role="switch" data-f="main" ' + (d.on ? 'checked' : '') + '><span class="stkcp-tgk" aria-hidden="true"></span><span><b>Copy trading on</b><span class="stkcp-hint">Copied orders are real orders on every live follower.</span></span></label>' +
    statusHtml() +
    '<p class="stkcp-fine">Education only. Not financial advice. Copied orders are your own orders; see the <a href="/terms#broker-live" target="_blank" rel="noopener">Terms</a>.</p>';
  body.scrollTop = scroll;
  const saved = cfg && cfg.on;
  el.querySelector('[data-ft]').innerHTML =
    '<button type="button" class="stkcp-btn" data-k="pause"' + (saved ? '' : ' disabled') + '>' + (cfg && cfg.paused ? 'Resume copying' : 'Pause copying') + '</button>' +
    '<button type="button" class="stkcp-btn bad" data-k="flat"' + (cfg && cfg.followers && cfg.followers.length ? '' : ' disabled') + '>Flatten all copied</button>' +
    '<button type="button" class="stkcp-btn pri" data-k="save"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Saving…' : 'Save') + '</button>';
}
function statusHtml() {
  if (!S.log.length) return '<div class="stkcp-sec"><span class="stkcp-l">Copy status</span><p class="stkcp-empty">Nothing copied yet in this session.</p></div>';
  const tm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return '<div class="stkcp-sec"><span class="stkcp-l">Copy status</span><ul class="stkcp-log">' + S.log.map((x) => '<li><span class="stkcp-t">' + esc(tm(x.at)) + '</span><span class="stkcp-lw"><b>' + esc(nameOf(x.id)) + '</b><span>' + esc(x.what) + (x.message ? ' · ' + esc(x.message) : '') + '</span></span><span class="stkcp-st ' + esc(x.state) + '">' + esc(STATE_LABEL[x.state] || x.state) + '</span></li>').join('') + '</ul></div>';
}
function rowOf(t) { const r = t.closest('[data-row]'); return r && S.draft.rows.find((x) => x.id === r.dataset.row); }
function onChange(t, typing) {
  const d = S.draft, f = t.dataset.f; if (!f) return;
  if (f === 'leader') { d.leader = t.value; d.rows.forEach((r) => { if (r.id === d.leader) r.on = false; }); redraw(); return; }
  if (f === 'main') { d.on = t.checked; return; }
  const r = rowOf(t); if (!r) return;
  if (f === 'on') { r.on = t.checked; redraw(); return; }
  if (f === 'exits') { r.exits = t.checked; return; }
  if (f === 'map') { r.map = t.value; return; }
  if (f === 'mult') { r.mult = Number(t.value); return; }
  if (f === 'qty') { r.qty = Number(t.value); return; }
  if (!typing) redraw();
}
async function onAct(k, b, close) {
  const d = S.draft;
  if (k === 'x') return close();
  if (k === 'mode') { const r = rowOf(b); if (r) { r.mode = b.dataset.v; redraw(); const i = el.querySelector('[data-row="' + CSS.escape(r.id) + '"] input[type=number]'); if (i) i.focus(); } return; }
  if (k === 'save') return save(false);
  if (k === 'pause') { const p = !(S.cfg && S.cfg.paused); try { const r = await call({ op: p ? 'pause' : 'resume' }); S.cfg = r.cfg; toast(p ? 'Copy trading paused. Orders on the leader are no longer copied.' : 'Copy trading resumed.', 'success'); } catch (e) { toast(e.message, 'error'); } S.draft = draftFrom(S.cfg); redraw(); menuRefresh(); return; }
  if (k === 'flat') return flattenAll();
  if (k === 'cf-no') { const c = el.querySelector('.stkcp-cf'); if (c) c.remove(); return; }
  if (k === 'cf-yes') { const c = el.querySelector('.stkcp-cf'); if (c) c.remove(); return save(true); }
}
function confirmStep(title, line, go, bad) {
  const box = el.querySelector('.stkcp-box'), c = document.createElement('div'); c.className = 'stkcp-cf'; c.setAttribute('role', 'alertdialog'); c.setAttribute('aria-labelledby', 'stkcp-cfh');
  c.innerHTML = '<div class="stkcp-cfb"><h3 id="stkcp-cfh">' + esc(title) + '</h3><p>' + line + '</p><div class="stkcp-cfbtns"><button type="button" class="stkcp-btn" data-k="cf-no">Cancel</button><button type="button" class="stkcp-btn ' + (bad ? 'bad' : 'pri') + '" data-k="cf-yes">' + esc(go) + '</button></div></div>';
  box.appendChild(c); const yes = c.querySelector('[data-k=cf-yes]'); setTimeout(() => yes.focus(), 0);
}
async function save(consent) {
  const d = S.draft;
  const cfg = { on: d.on, paused: S.cfg ? S.cfg.paused : false, leader: d.leader, followers: d.rows.filter((r) => r.id !== d.leader && (r.on || r.listed)).map((r) => ({ id: r.id, on: r.on, mode: r.mode, mult: r.mult, qty: r.qty, map: r.map, exits: r.exits })) };
  const v = C.cleanConfig(cfg); if (v.error) { toast(v.error, 'error'); return; }
  if (d.on && !(S.cfg && S.cfg.consented) && !consent) { confirmStep('Turn on copy trading', 'Copied orders are real orders on every follower account. Prop firms may have rules about copy trading; check your firm’s rules.', 'Turn on copy trading'); return; }
  S.busy = true; redraw();
  try {
    const r = await call(Object.assign({ op: 'save', cfg }, consent ? { consent: true, version: C.COPY_TERMS_VERSION } : {}));
    S.cfg = r.cfg; S.err = ''; S.draft = draftFrom(S.cfg);
    toast(S.cfg.on ? 'Copy trading is on. Orders you place on ' + nameOf(S.cfg.leader) + ' are copied.' : 'Copy trading saved (off).', 'success');
  } catch (e) {
    if (e.code === 'consent_needed') toast('Enable live trading first: pick a live account in the Trade menu and accept the notice.', 'error');
    else if (e.code === 'copy_consent_needed') { S.busy = false; confirmStep('Turn on copy trading', 'Copied orders are real orders on every follower account. Prop firms may have rules about copy trading; check your firm’s rules.', 'Turn on copy trading'); return; }
    else toast(e.message, 'error');
  }
  S.busy = false; redraw(); menuRefresh();
}
function flattenAll() {
  const P = PP, sym = P && P.activeSymbol ? P.activeSymbol() : '', i = sym && LV.info ? LV.info(sym) : null;
  if (!i || !i.code) { toast('Open the NQ, ES, MNQ or MES chart of the position to flatten it on the copied accounts.', 'error'); return; }
  const n = (S.cfg.followers || []).length;
  confirmStep('Flatten ' + i.code + ' on copied accounts', 'Cancels working orders and closes the ' + esc(i.code) + ' position (or its mapped contract) on all ' + n + ' follower account' + (n === 1 ? '' : 's') + '. The leader is not touched.', 'Flatten all copied', true);
  const yes = el.querySelector('.stkcp-cf [data-k=cf-yes]');
  yes.dataset.k = 'cf-flat';
  yes.addEventListener('click', async () => {
    el.querySelector('.stkcp-cf').remove();
    try { const r = await call({ op: 'flattenAll', symbol: i.code, idemKey: 'fa-' + uuid().replace(/-/g, '').slice(0, 24) }); after({ op: 'flatten', symbol: i.code }, r); }
    catch (e) { toast(e.message, 'error'); }
  });
}
function badge() { const c = S.cfg; if (!c || (!c.on && !c.followers.length)) return null; return c.on ? (c.paused ? { text: 'Paused', on: false } : { text: 'On', on: true }) : { text: 'Off', on: false }; }

const STYLE = `
#stkcp{ position:fixed; inset:0; z-index:9060; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(0,0,0,.6); }
.stkcp-box{ position:relative; width:min(560px,100%); max-height:min(760px, calc(100dvh - 32px)); display:flex; flex-direction:column; border:1px solid var(--line); border-radius:16px; background:var(--bg-2, #131316); color:var(--ink-1); box-shadow:0 24px 64px rgba(0,0,0,.5); font:400 14px/20px var(--font-body, system-ui, sans-serif); overflow:hidden; }
.stkcp-grab{ display:none; }
.stkcp-hd{ flex:none; display:flex; align-items:center; gap:8px; height:64px; padding:0 12px 0 24px; box-sizing:border-box; }
.stkcp-hd h2{ margin:0; font:600 17px/22px var(--font-body, system-ui, sans-serif); color:var(--ink-0); }
.stkcp-chip{ display:inline-flex; align-items:center; height:24px; padding:0 8px; border-radius:999px; border:1px solid var(--line); font:500 12px/16px var(--font-body, system-ui, sans-serif); color:var(--ink-2); box-sizing:border-box; }
.stkcp-chip.on{ border-color:rgba(3,201,136,.6); color:#03c988; } .stkcp-chip.paused{ border-color:rgba(255,176,32,.6); color:#ffb020; }
.stkcp-x{ margin-left:auto; display:inline-flex; align-items:center; justify-content:center; width:44px; height:44px; padding:0; border:0; border-radius:999px; background:transparent; color:var(--ink-2); cursor:pointer; }
.stkcp-x:hover{ background:var(--bg-1); color:var(--ink-0); }
.stkcp-body{ flex:1 1 auto; min-height:0; overflow-y:auto; padding:0 24px 16px; display:flex; flex-direction:column; gap:16px; scrollbar-width:thin; scrollbar-color:var(--line) transparent; }
.stkcp-body::-webkit-scrollbar{ width:8px; } .stkcp-body::-webkit-scrollbar-track{ background:transparent; } .stkcp-body::-webkit-scrollbar-button{ display:none; }
.stkcp-body::-webkit-scrollbar-thumb{ background:var(--line); border-radius:8px; border:2px solid transparent; background-clip:padding-box; } .stkcp-body::-webkit-scrollbar-thumb:hover{ background-color:var(--ink-3); }
.stkcp-p, .stkcp-note, .stkcp-fine, .stkcp-err, .stkcp-empty{ margin:0; }
.stkcp-note{ padding:12px 16px; border:1px solid var(--line); border-radius:12px; background:var(--bg-1); color:var(--ink-1); }
.stkcp-note b{ color:var(--ink-0); font-weight:600; }
.stkcp-body a{ color:var(--gold, #03c988); text-decoration:underline; text-underline-offset:2px; }
.stkcp-err{ color:#f23645; font-weight:600; }
.stkcp-fine{ font-size:12px; line-height:16px; color:var(--ink-3); }
.stkcp-f{ display:flex; flex-direction:column; gap:8px; min-width:0; }
.stkcp-l{ font:500 13px/18px var(--font-body, system-ui, sans-serif); color:var(--ink-2); }
.stkcp-hint{ display:block; font:400 12px/16px var(--font-body, system-ui, sans-serif); color:var(--ink-3); }
.stkcp select, .stkcp input[type=number]{ width:100%; height:44px; box-sizing:border-box; padding:0 12px; border:1px solid var(--line); border-radius:12px; background:var(--bg-1); color:var(--ink-0); font:400 15px/20px var(--font-body, system-ui, sans-serif); font-variant-numeric:tabular-nums; }
.stkcp select:focus-visible, .stkcp input:focus-visible, .stkcp button:focus-visible{ outline:2px solid #03c988; outline-offset:2px; }
.stkcp-sec{ display:flex; flex-direction:column; gap:8px; }
.stkcp-row{ border:1px solid var(--line); border-radius:12px; background:var(--bg-1); }
.stkcp-row.on{ border-color:rgba(3,201,136,.45); }
.stkcp-tg, .stkcp-main{ display:flex; align-items:center; gap:12px; min-height:48px; padding:0 16px; cursor:pointer; -webkit-tap-highlight-color:transparent; }
.stkcp-tg input, .stkcp-main input{ position:absolute; opacity:0; width:1px; height:1px; pointer-events:none; }
.stkcp-tgk{ flex:none; position:relative; width:36px; height:20px; border-radius:999px; background:var(--line); transition:background .15s cubic-bezier(.2,0,0,1); }
.stkcp-tgk::after{ content:""; position:absolute; top:2px; left:2px; width:16px; height:16px; border-radius:50%; background:#fff; transition:transform .15s cubic-bezier(.2,0,0,1); }
input:checked + .stkcp-tgk{ background:#03c988; } input:checked + .stkcp-tgk::after{ transform:translateX(16px); }
input:focus-visible + .stkcp-tgk{ outline:2px solid #03c988; outline-offset:2px; }
.stkcp-nm{ flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:500 14px/20px var(--font-body, system-ui, sans-serif); color:var(--ink-0); }
.stkcp-tag{ flex:none; height:20px; padding:0 8px; border-radius:999px; background:var(--bg-2); font:500 11px/20px var(--font-body, system-ui, sans-serif); color:var(--ink-2); }
.stkcp-opts{ display:flex; flex-direction:column; gap:16px; padding:4px 16px 16px; }
.stkcp-opts[hidden]{ display:none; }
.stkcp-seg{ display:grid; grid-template-columns:repeat(3,1fr); gap:4px; padding:4px; border:1px solid var(--line); border-radius:12px; background:var(--bg-2); }
.stkcp-seg button{ height:36px; padding:0 8px; border:0; border-radius:8px; background:transparent; color:var(--ink-1); font:500 13px/18px var(--font-body, system-ui, sans-serif); cursor:pointer; white-space:nowrap; }
.stkcp-seg button[aria-checked=true]{ background:var(--bg-1); color:var(--ink-0); box-shadow:inset 0 0 0 1px var(--line); }
.stkcp-2{ display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:end; gap:16px; }
.stkcp-ck{ display:flex; align-items:center; gap:8px; height:44px; font:500 14px/20px var(--font-body, system-ui, sans-serif); color:var(--ink-1); cursor:pointer; white-space:nowrap; }
.stkcp-ck input{ width:20px; height:20px; margin:0; accent-color:#03c988; }
.stkcp-main{ min-height:64px; border:1px solid var(--line); border-radius:12px; background:var(--bg-1); }
.stkcp-main b{ display:block; font:600 15px/22px var(--font-body, system-ui, sans-serif); color:var(--ink-0); }
.stkcp-log{ list-style:none; margin:0; padding:0; border:1px solid var(--line); border-radius:12px; background:var(--bg-1); max-height:200px; overflow-y:auto; scrollbar-width:thin; scrollbar-color:var(--line) transparent; }
.stkcp-log::-webkit-scrollbar{ width:8px; } .stkcp-log::-webkit-scrollbar-button{ display:none; } .stkcp-log::-webkit-scrollbar-thumb{ background:var(--line); border-radius:8px; }
.stkcp-log li{ display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:12px; min-height:48px; padding:8px 12px; box-sizing:border-box; border-top:1px solid var(--line); }
.stkcp-log li:first-child{ border-top:0; }
.stkcp-t{ font:400 12px/16px var(--font-body, system-ui, sans-serif); font-variant-numeric:tabular-nums; color:var(--ink-3); }
.stkcp-lw{ display:flex; flex-direction:column; min-width:0; } .stkcp-lw b{ font:500 13px/18px var(--font-body, system-ui, sans-serif); color:var(--ink-0); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.stkcp-lw span{ font:400 12px/16px var(--font-body, system-ui, sans-serif); color:var(--ink-2); overflow-wrap:anywhere; }
.stkcp-st{ display:inline-flex; align-items:center; height:24px; padding:0 8px; border-radius:999px; border:1px solid var(--line); font:500 12px/16px var(--font-body, system-ui, sans-serif); color:var(--ink-2); white-space:nowrap; box-sizing:border-box; }
.stkcp-st.sent, .stkcp-st.filled{ color:#03c988; border-color:rgba(3,201,136,.5); } .stkcp-st.rejected, .stkcp-st.unknown{ color:#f23645; border-color:rgba(242,54,69,.5); }
.stkcp-empty{ font-size:13px; line-height:18px; color:var(--ink-3); }
.stkcp-ft{ flex:none; display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; padding:16px 24px 24px; border-top:1px solid var(--line); }
.stkcp-ft:empty{ display:none; }
.stkcp-btn{ display:inline-flex; align-items:center; justify-content:center; height:44px; padding:0 12px; border:1px solid var(--line); border-radius:12px; background:transparent; color:var(--ink-0); font:600 14px/20px var(--font-body, system-ui, sans-serif); cursor:pointer; white-space:nowrap; box-sizing:border-box; }
.stkcp-btn:hover:not(:disabled){ border-color:var(--ink-3); }
.stkcp-btn:disabled{ opacity:.45; cursor:default; }
.stkcp-btn.pri{ border-color:#03c988; background:#03c988; color:#04110b; }
.stkcp-btn.bad{ border-color:rgba(242,54,69,.6); color:#f23645; }
.stkcp-cf{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; padding:24px; background:rgba(0,0,0,.55); }
.stkcp-cfb{ width:100%; max-width:400px; display:flex; flex-direction:column; gap:12px; padding:24px; border:1px solid var(--line); border-radius:16px; background:var(--bg-2, #131316); box-sizing:border-box; }
.stkcp-cfb h3{ margin:0; font:600 17px/22px var(--font-body, system-ui, sans-serif); color:var(--ink-0); } .stkcp-cfb p{ margin:0; }
.stkcp-cfbtns{ display:grid; grid-template-columns:1fr 1.4fr; gap:8px; margin-top:4px; }
.stktm-copytr{ width:100%; margin-top:8px; }
.stktm-copytr .stktm-copyst{ font-weight:500; color:var(--ink-2); } .stktm-copytr .stktm-copyst::before{ content:"· "; } .stktm-copytr .stktm-copyst.on{ color:#03c988; }
:root[data-theme="light"] #stkcp{ background:rgba(20,24,33,.4); }
:root[data-theme="light"] .stkcp-box, :root[data-theme="light"] .stkcp-cfb{ background:#fff; box-shadow:0 24px 64px rgba(20,24,33,.18); }
:root[data-theme="light"] .stkcp-row, :root[data-theme="light"] .stkcp-main, :root[data-theme="light"] .stkcp-note, :root[data-theme="light"] .stkcp-log, :root[data-theme="light"] .stkcp select, :root[data-theme="light"] .stkcp input[type=number]{ background:#f5f5f7; }
:root[data-theme="light"] .stkcp-seg{ background:#fff; } :root[data-theme="light"] .stkcp-seg button[aria-checked=true]{ background:#f5f5f7; }
:root[data-theme="light"] .stkcp-chip.on, :root[data-theme="light"] .stkcp-st.sent, :root[data-theme="light"] .stkcp-st.filled, :root[data-theme="light"] .stktm-copytr .stktm-copyst.on{ color:#067a67; }
:root[data-theme="light"] .stkcp-btn.pri{ background:#03a872; border-color:#03a872; color:#fff; }
:root[data-theme="light"] .stkcp-cf{ background:rgba(20,24,33,.3); }
@media (max-width:700px){
  #stkcp{ align-items:flex-end; padding:0; }
  .stkcp-box{ width:100%; max-height:92dvh; border-radius:20px 20px 0 0; border-width:1px 0 0; }
  .stkcp-grab{ display:block; width:36px; height:4px; margin:8px auto 0; border-radius:2px; background:var(--line); }
  .stkcp-hd{ height:56px; padding:0 4px 0 16px; }
  .stkcp-body{ padding:0 16px 16px; }
  .stkcp-ft{ grid-template-columns:1fr 1fr; padding:12px 16px calc(16px + env(safe-area-inset-bottom)); }
  .stkcp-ft .pri{ grid-column:1 / -1; order:-1; height:48px; }
  .stkcp select, .stkcp input[type=number]{ height:48px; font-size:16px; }
  .stkcp-2{ grid-template-columns:1fr; gap:8px; }
}
`;

export function mountCopy(o) {
  LV = o.live; PP = o.paper; toast = o.toast || toast;
  if (!document.getElementById('stkcp-css')) { const st = document.createElement('style'); st.id = 'stkcp-css'; st.textContent = STYLE; document.head.appendChild(st); }
  window.__stkCopy = { active: runningFor, after, sync, badge, open, load, get state() { return S; } };
  // the account list arrives a moment later: load the copy setup once there is something to copy between
  const tryLoad = () => { if (!S.loaded && accounts().length) load(); else if (el) { if (!S.draft || !S.draft.rows.length) S.draft = draftFrom(S.cfg); redraw(); } };
  window.addEventListener('stklive:menu', (e) => { if (e.detail && e.detail.what === 'accounts') tryLoad(); });
  tryLoad();
}
