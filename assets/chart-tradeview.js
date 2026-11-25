// Trade display (Owner 17 Nov 2026, roadmap "trade-display"): the eye button in the chart bottom bar, next to "Positions and orders".
// One popover (bottom sheet on phones) decides which trading drawings the chart shows and how they look: order / TP / SL / position
// lines, executions, order preview, break-even line, risk-reward box, label parts + alignment, P&L units, colours, line styles.
// Settings are per user (localStorage + account-sync key "tradeView"), apply to every chart cell at once, for Paper and live accounts.
// Every default equals the chart's look before this existed. Education only. Not financial advice.
// Renderers: assets/chart-paper.js (lines, chips, executions, boxes), chart-live.js (live lines + fills), chart-order-panel.js (preview).
// Test: tools/tests/chart-tradeview-browser.js.
const KEY = 'stryker_tradeview_ui', PHONE = 700;
export const DEF = Object.freeze({
  master: true, ord: true, tpsl: true, pos: true, be: false, exe: false, exeSize: false, pv: false, rr: false,
  lab: { side: true, price: true, size: true, pnl: true, btn: true, rev: true }, align: 'right', full: true, unit: 'usd',
  col: { buy: '#2962ff', sell: '#ef5350', profit: '#089981', loss: '#ef5350', tp: '#089981', sl: '#ef5350' },   // Owner 25 Nov: no harsh red
  ls: { ord: 'dashed', pos: 'dashed' }, lw: { ord: 1, pos: 1 }, confirm: false, sound: true
});
const clone = (o) => JSON.parse(JSON.stringify(o));
const HEX = /^#[0-9a-f]{6}$/i;
let S = clone(DEF);
const subs = new Set();

// merge saved JSON over the defaults, keeping only known keys of the right type
function merge(base, raw) {
  const out = clone(base); if (!raw || typeof raw !== 'object') return out;
  for (const k of Object.keys(base)) {
    const b = base[k], v = raw[k];
    if (v === undefined) continue;
    if (b && typeof b === 'object') out[k] = merge(b, v);
    else if (typeof b === 'boolean' && typeof v === 'boolean') out[k] = v;
    else if (typeof b === 'number' && [1, 2, 3].includes(v)) out[k] = v;
    else if (typeof b === 'string') {
      if (HEX.test(b)) { if (typeof v === 'string' && HEX.test(v)) out[k] = v.toLowerCase(); }
      else if (k === 'align' ? ['left', 'center', 'right'].includes(v) : k === 'unit' ? ['usd', 'ticks', 'points', 'pct'].includes(v) : ['solid', 'dashed', 'dotted'].includes(v)) out[k] = v;
    }
  }
  return out;
}
function load() { try { S = merge(DEF, JSON.parse(localStorage.getItem(KEY) || 'null')); } catch (e) { S = clone(DEF); } }
load();
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
function fire() { applyVars(); for (const f of subs) { try { f(S); } catch (e) { console.warn('trade display', e); } } }
function applyVars() { const r = document.documentElement.style; r.setProperty('--stk-profit', S.col.profit); r.setProperty('--stk-loss', S.col.loss); }
applyVars();

export const get = () => S;
export const on = (f) => { subs.add(f); return () => subs.delete(f); };
export function set(path, v) {
  const p = String(path).split('.'); let o = S;
  for (let i = 0; i < p.length - 1; i++) o = o[p[i]];
  if (o[p[p.length - 1]] === v) return;
  o[p[p.length - 1]] = v; S = merge(DEF, S); save(); fire();
}
export function reset() { S = clone(DEF); save(); fire(); }
window.addEventListener('storage', (e) => { if (e.key === KEY) { load(); fire(); } });

// ---- what the renderers ask
// is this on-chart line shown? l.kind: pos | ord | tp / otp | sl / osl | pv (order preview) | be (break-even)
export function visible(l) {
  if (!S.master) return false;
  const k = l.kind;
  if (k === 'pos') return S.pos;
  if (k === 'ord') return l.role === 'tp' || l.role === 'sl' ? S.tpsl : S.ord;
  if (k === 'pv') return S.pv;
  if (k === 'be') return S.be;
  return S.tpsl;
}
export const execOn = () => S.master && S.exe;
export const rrOn = () => S.master && S.rr;
export const previewOn = () => S.master && S.pv;
export function lineColor(l) {
  const c = S.col, k = l.kind;
  if (k === 'be') return '#787b86';
  if (k === 'pv') return l.role === 'tp' ? c.tp : l.role === 'sl' ? c.sl : l.side === 'buy' ? c.buy : c.sell;
  if (k === 'tp' || k === 'otp') return c.tp;
  if (k === 'sl' || k === 'osl') return c.sl;
  return l.side === 'buy' ? c.buy : c.sell;
}
// canvas dash + width. Defaults = before: orders [6,3], TP / SL [3,3], position solid, 1 px.
export function lineStyle(l) {
  const k = l.kind, pos = k === 'pos', style = pos ? S.ls.pos : S.ls.ord, w = pos ? S.lw.pos : S.lw.ord;
  if (k === 'pv') return { dash: [4, 4], w: 1 };
  if (k === 'be') return { dash: [2, 4], w: 1 };
  const small = k !== 'ord' && !pos;
  return { dash: style === 'solid' ? [] : style === 'dotted' ? [1, 3] : small ? [3, 3] : [6, 3], w };
}

// ---- label text. parts = { name, size, price, pnl, pa } ; pa 'a' = price sits in the name half (position, TP, SL), 'b' = in the value half (orders)
export function compose(p, kind) {
  const L = S.lab, a = [], pa = p.pa !== 'b';
  if (L.side && p.name) a.push(p.name);
  if (L.size && p.size) a.push(p.size);
  if (L.price && pa && p.price) a.push(p.price);
  const b = L.pnl && p.pnl ? p.pnl : (L.price && !pa && p.price ? p.price : '');
  return [a.join(' '), b];
}
// P&L in the chosen unit. usd = signed dollars (already formatted by the caller), dist = |price - ref| in price units, sign from sgn
export function pnlText(usdText, sgn, dist, tick, ref) {
  const u = S.unit; if (u === 'usd' || !Number.isFinite(dist)) return usdText;
  const sg = sgn > 0 ? '+' : sgn < 0 ? '-' : '';
  if (u === 'ticks') return tick > 0 ? sg + Math.round(dist / tick).toLocaleString('en-US') + ' ticks' : usdText;
  if (u === 'points') return sg + dist.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' pts';
  return ref > 0 ? sg + (dist / ref * 100).toFixed(2) + '%' : usdText;
}

// ---- small confirm (before dragging an order)
export function confirm(title, go) {
  return new Promise((res) => {
    const el = document.createElement('div'); el.className = 'stktv-cf';
    el.innerHTML = '<div class="stktv-cf-box" role="alertdialog" aria-modal="true" aria-labelledby="stktv-cf-h"><h2 id="stktv-cf-h"></h2><div class="stktv-cf-btns"><button type="button" data-k="no">Cancel</button><button type="button" data-k="yes" class="go"></button></div></div>';
    el.querySelector('h2').textContent = title; el.querySelector('.go').textContent = go || 'Move order';
    const done = (v) => { document.removeEventListener('keydown', key, true); el.remove(); res(v); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    document.addEventListener('keydown', key, true);
    el.addEventListener('mousedown', (e) => { if (e.target === el) done(false); });
    el.querySelector('[data-k=no]').onclick = () => done(false); el.querySelector('[data-k=yes]').onclick = () => done(true);
    document.body.appendChild(el); el.querySelector('[data-k=no]').focus();
  });
}

// ---- UI
const EYE = '<svg class="eye" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg class="eye" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" opacity=".55"/><circle cx="12" cy="12" r="3" opacity=".55"/><path d="M4 20 20 4"/></svg>';
const CHEV = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
const BACK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>';
// tiny line-style previews (28 x 16)
const pv = (inner) => '<svg class="pvi" width="28" height="16" viewBox="0 0 28 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' + inner + '</svg>';
const ICON = {
  ord: pv('<rect x="1.5" y="3.5" width="9" height="9" rx="2"/><path d="M13 8h2M18 8h2M23 8h3" stroke-linecap="round"/>'),
  tpsl: pv('<rect x="1.5" y="1.5" width="8" height="4.5" rx="1.5"/><rect x="1.5" y="10" width="8" height="4.5" rx="1.5"/><path d="M12 3.75h2M17 3.75h2M22 3.75h4M12 12.25h2M17 12.25h2M22 12.25h4" stroke-linecap="round"/>'),
  pos: pv('<rect x="1.5" y="3" width="9" height="10" rx="2" fill="currentColor"/><path d="M12 8h14" stroke-linecap="round"/>'),
  be: pv('<path d="M1.5 8h3M8 8h3M14.5 8h3M21 8h5" stroke-linecap="round"/><circle cx="14" cy="8" r="0"/>'),
  exe: pv('<path d="M7 13V3M3.5 6.5 7 3l3.5 3.5M21 3v10M17.5 9.5 21 13l3.5-3.5" stroke-linecap="round" stroke-linejoin="round"/>'),
  pv: pv('<path d="M1.5 5h25M1.5 11h25" stroke-dasharray="3 3" stroke-linecap="round"/>'),
  rr: pv('<rect x="2" y="1.5" width="24" height="5" rx="1" fill="currentColor" opacity=".35" stroke="none"/><rect x="2" y="9.5" width="24" height="5" rx="1" fill="currentColor" opacity=".15" stroke="none"/><path d="M2 8h24" stroke-linecap="round"/>')
};
const ROWS = [
  ['Open trades', [['ord', 'Orders'], ['tpsl', 'TP and SL'], ['pos', 'Position'], ['be', 'Break-even line']]],
  ['Trade history', [['exe', 'Executions']]],
  ['Planning', [['pv', 'Order preview'], ['rr', 'Risk-reward box']]]
];
const ALIGN = { left: 'Left', center: 'Center', right: 'Right' };
const UNITS = [['usd', '$'], ['ticks', 'Ticks'], ['points', 'Points'], ['pct', '%']];
const LSTY = [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let btn = null, pop = null, view = 'main', openNow = false, P = null;
const phone = () => window.innerWidth <= PHONE;

const sw = (path, label, name, val) => '<label class="stktv-r stktv-sw"><span class="t">' + label + '</span><input type="color" data-col="' + name + '" value="' + val + '" aria-label="' + esc(label) + ' colour"></label>';
const seg = (name, opts, cur, label) => '<div class="stktv-seg" role="radiogroup" aria-label="' + esc(label) + '">' + opts.map(([v, t]) => '<button type="button" role="radio" aria-checked="' + (v === cur) + '" data-seg="' + name + '" data-v="' + v + '">' + t + '</button>').join('') + '</div>';
const chk = (k, label, on) => '<button type="button" class="stktv-r" role="switch" aria-checked="' + on + '" data-t="' + k + '"><span class="t">' + label + '</span><span class="stktv-sw-t' + (on ? ' on' : '') + '" aria-hidden="true"></span></button>';
const head = (title) => '<div class="stktv-h"><button type="button" class="stktv-back" data-go="main" aria-label="Back">' + BACK + '</button><b>' + title + '</b></div>';

function sample(kind) {   // preview strip chips: "Sample data", never a real price
  const parts = kind === 'tp' ? { name: 'TP', size: '2', price: '25,450.00', pnl: S.unit === 'usd' ? '+$180.00' : S.unit === 'ticks' ? '+36 ticks' : S.unit === 'points' ? '+9.00 pts' : '+0.04%', pa: 'a' }
    : { name: 'LONG', size: '2', price: '@ 25,400.00', pnl: S.unit === 'usd' ? '+$90.00' : S.unit === 'ticks' ? '+18 ticks' : S.unit === 'points' ? '+4.50 pts' : '+0.02%', pa: 'a' };
  const [a, b] = compose(parts), col = kind === 'tp' ? S.col.tp : S.col.buy;
  if (!a && !b && !S.lab.btn) return '';
  return '<div class="stktv-chip" style="--c:' + col + '">' + (a ? '<span class="a">' + esc(a) + '</span>' : '') + (b ? '<span class="b' + (kind === 'tp' ? '' : ' pos') + '">' + esc(b) + '</span>' : '') +
    (S.lab.btn ? (kind !== 'tp' && S.lab.rev ? '<span class="x" aria-hidden="true">⇄</span>' : '') + '<span class="x" aria-hidden="true">×</span>' : '') + '</div>';
}
function html() {
  if (view === 'labels') {
    const L = S.lab;
    return head('Labels') + '<div class="stktv-body"><div class="stktv-strip" aria-label="Label preview, sample data"><div class="al ' + S.align + '">' + sample('tp') + sample('pos') + '</div><small>Preview · sample data</small></div>' +
      chk('lab.side', 'Side', L.side) + chk('lab.price', 'Price', L.price) + chk('lab.size', 'Size', L.size) + chk('lab.pnl', 'P&amp;L', L.pnl) + chk('lab.btn', 'Buttons (Close / ×)', L.btn) + chk('lab.rev', 'Reverse button (paper)', L.rev) +
      '<div class="stktv-r stk-col"><span class="t">Align</span>' + seg('align', Object.entries(ALIGN), S.align, 'Label alignment') + '</div>' +
      chk('full', 'Full-width lines', S.full) +
      '<div class="stktv-r stk-col"><span class="t">P&amp;L shown as</span>' + seg('unit', UNITS, S.unit, 'P&L unit') + '</div></div>';
  }
  if (view === 'style') {
    const c = S.col;
    return head('Colours and lines') + '<div class="stktv-body"><div class="stktv-sec">Colours</div>' + sw('col', 'Buy', 'buy', c.buy) + sw('col', 'Sell', 'sell', c.sell) + sw('col', 'Profit', 'profit', c.profit) + sw('col', 'Loss', 'loss', c.loss) + sw('col', 'Take profit', 'tp', c.tp) + sw('col', 'Stop loss', 'sl', c.sl) +
      '<div class="stktv-sec">Orders, TP and SL</div><div class="stktv-r stk-col">' + seg('ls.ord', LSTY, S.ls.ord, 'Order line style') + '</div><div class="stktv-r"><span class="t">Width</span>' + seg('lw.ord', [[1, '1'], [2, '2'], [3, '3']], S.lw.ord, 'Order line width') + '</div>' +
      '<div class="stktv-sec">Position</div><div class="stktv-r stk-col">' + seg('ls.pos', LSTY, S.ls.pos, 'Position line style') + '</div><div class="stktv-r"><span class="t">Width</span>' + seg('lw.pos', [[1, '1'], [2, '2'], [3, '3']], S.lw.pos, 'Position line width') + '</div></div>';
  }
  if (view === 'more') {
    return head('More') + '<div class="stktv-body">' + chk('exeSize', 'Size on executions', S.exeSize) + chk('confirm', 'Confirm before dragging an order', S.confirm) + chk('sound', 'Sound on fill', S.sound) + '</div>';
  }
  const grp = ROWS.map(([t, rows]) => '<div class="stktv-sec">' + t + '</div>' + rows.map(([k, n]) => '<button type="button" class="stktv-r" role="switch" aria-checked="' + S[k] + '" data-t="' + k + '">' + ICON[k] + '<span class="t">' + n + '</span>' + (S[k] ? EYE : EYE_OFF) + '</button>').join('')).join('<div class="stktv-sep"></div>');
  return '<div class="stktv-h main"><b>Show on chart</b><button type="button" class="stktv-eye" role="switch" aria-checked="' + S.master + '" data-t="master" aria-label="Show on chart">' + (S.master ? EYE : EYE_OFF) + '</button></div><div class="stktv-body' + (S.master ? '' : ' off') + '">' + grp +
    '<div class="stktv-sep"></div><button type="button" class="stktv-r nav" data-go="labels"><span class="t">Labels</span><span class="v">' + ALIGN[S.align] + '</span>' + CHEV + '</button>' +
    '<button type="button" class="stktv-r nav" data-go="style"><span class="t">Colours and lines</span>' + CHEV + '</button>' +
    '<button type="button" class="stktv-r nav" data-go="more"><span class="t">More</span>' + CHEV + '</button>' +
    '<div class="stktv-sep"></div><button type="button" class="stktv-r reset" data-reset="1"><span class="t">Reset to defaults</span></button></div>';
}
function render(focusKey) {
  if (!pop) return;
  const grab = phone() ? '<div class="stktv-grab" aria-hidden="true"></div>' : '';
  pop.innerHTML = grab + '<div class="stktv-scroll">' + html() + '</div><p class="stktv-foot">Every chart, every account.</p>';
  pop.classList.toggle('sheet', phone());
  if (focusKey) { const el = pop.querySelector('[data-t="' + focusKey + '"],[data-go="' + focusKey + '"],[data-seg="' + focusKey + '"][aria-checked=true]'); if (el) el.focus({ preventScroll: true }); }
  place();
}
function place() {
  if (!pop || !openNow || !btn) return;
  if (phone()) { pop.style.left = pop.style.top = pop.style.bottom = ''; return; }
  const r = btn.getBoundingClientRect(), w = pop.offsetWidth || 300;
  pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
  pop.style.bottom = Math.round(window.innerHeight - r.top + 8) + 'px'; pop.style.top = '';
  pop.style.maxHeight = Math.max(240, Math.round(r.top - 16)) + 'px';
}
function toggle(v) {
  openNow = v == null ? !openNow : v; view = 'main';
  pop.hidden = !openNow; btn.setAttribute('aria-expanded', String(openNow)); btn.classList.toggle('on', openNow);
  document.documentElement.classList.toggle('stktv-sheet-open', openNow && phone());
  if (openNow) render(phone() ? '' : 'master');
}
function onClick(e) {
  const t = e.target.closest('[data-t]'), go = e.target.closest('[data-go]'), sg = e.target.closest('[data-seg]');
  if (t) { const k = t.dataset.t; set(k, !k.split('.').reduce((o, p) => o[p], S)); render(k); }
  else if (go) { const from = view; view = go.dataset.go; render(); const f = view === 'main' ? pop.querySelector('[data-go=' + from + ']') : pop.querySelector('.stktv-back'); if (f) f.focus({ preventScroll: true }); }
  else if (sg) { const v = sg.dataset.v; set(sg.dataset.seg, /^\d$/.test(v) ? +v : v); render(sg.dataset.seg); }
  else if (e.target.closest('[data-reset]')) { reset(); render('master'); }
}
function build() {
  btn = document.createElement('button'); btn.type = 'button'; btn.id = 'stktv-btn'; btn.className = 'stktv-btn'; btn.hidden = true;
  btn.title = 'Trade display'; btn.setAttribute('aria-label', 'Trade display'); btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'stktv-pop');
  btn.innerHTML = EYE.replace('width="20" height="20"', 'width="16" height="16"');
  btn.onclick = (e) => { e.stopPropagation(); toggle(); };
  pop = document.createElement('div'); pop.id = 'stktv-pop'; pop.className = 'stktv'; pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Trade display');
  document.body.appendChild(pop);
  pop.addEventListener('click', onClick);
  pop.addEventListener('pointerdown', (e) => e.stopPropagation());
  pop.addEventListener('input', (e) => { const c = e.target.closest('[data-col]'); if (c) set('col.' + c.dataset.col, c.value); });
  document.addEventListener('pointerdown', (e) => { if (openNow && !pop.contains(e.target) && !btn.contains(e.target)) toggle(false); });
  document.addEventListener('keydown', (e) => {
    if (!openNow) return;
    if (e.key === 'Escape') { e.stopPropagation(); if (view !== 'main') { view = 'main'; render('master'); } else { toggle(false); btn.focus(); } }
  }, true);
  window.addEventListener('resize', () => { if (openNow) { document.documentElement.classList.toggle('stktv-sheet-open', phone()); render(); } });
  const css = document.createElement('style'); css.id = 'stktv-css'; css.textContent = CSS; document.head.appendChild(css);
}
// sit right after the Positions & Orders button (it moves around the bar), hidden with it
function placeBtn() {
  const po = document.getElementById('stkpo-btn'); if (!po || !btn) return;
  if (btn.previousElementSibling !== po || btn.parentNode !== po.parentNode) po.after(btn);
  const hid = po.hidden; if (btn.hidden !== hid) btn.hidden = hid;
  if (hid && openNow) toggle(false);
}
export function mount(paperApi) {
  if (btn) return; P = paperApi; build(); placeBtn();
  setInterval(placeBtn, 500); window.addEventListener('resize', placeBtn);
  window.__stkTradeView = { get, set, reset, open: () => toggle(true), get isOpen() { return openNow; } };
}

const CSS = `
.stktv-btn{ flex:none; display:inline-flex; align-items:center; justify-content:center; width:28px; height:24px; margin:0 4px 0 0; padding:0; border:0; border-radius:4px; background:transparent; color:var(--vela-fg-muted, var(--ink-2)); cursor:pointer; box-sizing:border-box; }
.stktv-btn[hidden]{ display:none; }
.stktv-btn:hover,.stktv-btn.on{ background:var(--vela-hover, var(--bg-2)); color:var(--vela-fg-bright, var(--ink-0)); }
.stktv-btn:focus-visible,.stktv :focus-visible{ outline:2px solid var(--gold); outline-offset:2px; }
.stktv{ position:fixed; z-index:95; width:300px; display:flex; flex-direction:column; box-sizing:border-box; background:var(--surface-1); color:var(--ink-0); border:1px solid var(--line); border-radius:12px; box-shadow:0 12px 32px rgba(0,0,0,.4); font:400 14px/20px -apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif; overflow:hidden; }
.stktv[hidden]{ display:none; }
:root[data-theme="light"] .stktv{ box-shadow:0 12px 32px rgba(14,22,33,.18); }
.stktv-scroll{ overflow-y:auto; overflow-x:hidden; padding:8px; min-height:0; flex:1 1 auto; }
.stktv-h{ display:flex; align-items:center; gap:8px; min-height:40px; padding:0 4px 0 12px; box-sizing:border-box; }
.stktv-h b{ flex:1; font-size:15px; line-height:22px; font-weight:600; }
.stktv-h:not(.main){ padding-left:0; }
.stktv-back,.stktv-eye{ display:inline-flex; align-items:center; justify-content:center; width:40px; height:40px; border:0; border-radius:8px; background:transparent; color:var(--ink-2); cursor:pointer; padding:0; }
.stktv-back:hover,.stktv-eye:hover,.stktv-r:hover{ background:var(--bg-2); } .stktv-eye[aria-checked=true]{ color:var(--ink-0); }
.stktv-body.off > :not(.reset):not(.nav){ opacity:.5; }
.stktv-sec{ padding:12px 12px 4px; font:500 12px/16px -apple-system,BlinkMacSystemFont,Roboto,system-ui,sans-serif; color:var(--ink-2); }
.stktv-sep{ height:1px; margin:8px 4px; background:var(--line); }
.stktv-r{ display:flex; align-items:center; gap:12px; width:100%; min-height:40px; padding:0 12px; box-sizing:border-box; border:0; border-radius:8px; background:transparent; color:var(--ink-0); font:inherit; text-align:left; cursor:pointer; }
.stktv-r .t{ flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.stktv-r .eye{ flex:none; color:var(--ink-2); } .stktv-r[aria-checked=true] .eye{ color:var(--ink-0); }
.stktv-r .pvi{ flex:none; color:var(--ink-1); width:28px; }
.stktv-r .v{ color:var(--ink-2); font-size:13px; } .stktv-r svg{ flex:none; }
.stktv-r.nav{ color:var(--ink-0); } .stktv-r.nav svg{ color:var(--ink-2); }
.stktv-r.reset{ color:var(--ink-2); }
.stktv-r.stk-col{ flex-wrap:wrap; padding-top:4px; padding-bottom:8px; gap:6px; min-height:0; cursor:default; }
.stktv-r.stk-col:hover{ background:transparent; } .stktv-r.stk-col .t{ flex:1 0 100%; font-size:13px; color:var(--ink-2); }
.stktv-r.stk-col .stktv-seg{ flex:1 0 100%; }
.stktv-seg{ display:inline-flex; gap:2px; padding:2px; border-radius:8px; background:var(--bg-2); border:1px solid var(--line); box-sizing:border-box; }
.stktv-r:not(.stk-col) .stktv-seg{ flex:none; }
.stktv-seg button{ flex:1; min-width:32px; height:28px; padding:0 8px; border:0; border-radius:6px; background:transparent; color:var(--ink-2); font-family:inherit; font-size:13px; line-height:18px; font-weight:500; cursor:pointer; }
.stktv-seg button[aria-checked=true]{ background:var(--surface-2); color:var(--ink-0); box-shadow:0 0 0 1px var(--line); }
.stktv-sw-t{ flex:none; position:relative; width:36px; height:20px; border-radius:10px; background:var(--line); transition:background .15s cubic-bezier(.2,0,0,1); }
.stktv-sw-t::after{ content:""; position:absolute; left:2px; top:2px; width:16px; height:16px; border-radius:50%; background:var(--ink-0); transition:transform .15s cubic-bezier(.2,0,0,1); }
.stktv-sw-t.on{ background:var(--gold); } .stktv-sw-t.on::after{ transform:translateX(16px); background:#06130e; }
.stktv-sw input{ flex:none; width:28px; height:28px; padding:0; border:1px solid var(--line); border-radius:50%; background:none; cursor:pointer; -webkit-appearance:none; appearance:none; overflow:hidden; }
.stktv-sw input::-webkit-color-swatch-wrapper{ padding:0; } .stktv-sw input::-webkit-color-swatch{ border:0; border-radius:50%; } .stktv-sw input::-moz-color-swatch{ border:0; border-radius:50%; }
.stktv-strip{ margin:4px 4px 8px; padding:12px; border:1px solid var(--line); border-radius:8px; background:var(--bg-2); }
.stktv-strip .al{ display:flex; flex-direction:column; gap:8px; min-height:60px; } .stktv-strip .al.left{ align-items:flex-start; } .stktv-strip .al.center{ align-items:center; } .stktv-strip .al.right{ align-items:flex-end; }
.stktv-strip small{ display:block; margin-top:8px; font-family:inherit; font-size:11px; line-height:13px; color:var(--ink-2); }
.stktv-chip{ display:inline-flex; align-items:stretch; height:22px; max-width:100%; box-sizing:border-box; border:1px solid var(--c); border-radius:4px; overflow:hidden; background:#131322; color:#d1d4dc; font:600 11px/20px -apple-system,BlinkMacSystemFont,Roboto,sans-serif; }
:root[data-theme="light"] .stktv-chip{ background:#fff; color:#131722; }
.stktv-chip .a{ background:var(--c); color:#fff; padding:0 7px; white-space:nowrap; } .stktv-chip .b{ padding:0 7px; font-family:var(--font-mono); font-weight:500; font-variant-numeric:tabular-nums; white-space:nowrap; }
.stktv-chip .b.pos{ color:var(--stk-profit,#089981); } .stktv-chip .x{ display:inline-flex; align-items:center; justify-content:center; width:22px; border-left:1px solid var(--c); font-size:13px; }
.stktv-foot{ margin:0; padding:8px 20px 12px; font:400 12px/16px -apple-system,BlinkMacSystemFont,Roboto,system-ui,sans-serif; color:var(--ink-2); border-top:1px solid var(--line); }
.stktv-grab{ flex:none; width:36px; height:4px; margin:8px auto 0; border-radius:2px; background:var(--line); }
.stktv.sheet{ left:0; right:0; bottom:0; top:auto; width:auto; max-height:80vh; border-width:1px 0 0; border-radius:20px 20px 0 0; padding-bottom:env(safe-area-inset-bottom); animation:stktv-up .3s cubic-bezier(.2,0,0,1); }
.stktv.sheet .stktv-r{ min-height:48px; } .stktv.sheet .stktv-seg button{ height:36px; }
@keyframes stktv-up{ from{ transform:translateY(24px); opacity:0; } to{ transform:none; opacity:1; } }
@media (prefers-reduced-motion:reduce){ .stktv.sheet{ animation:none; } .stktv-sw-t,.stktv-sw-t::after{ transition:none; } }
.stktv-cf{ position:fixed; inset:0; z-index:120; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.5); }
.stktv-cf-box{ width:min(320px, calc(100vw - 32px)); padding:20px; border-radius:16px; background:var(--surface-1); color:var(--ink-0); border:1px solid var(--line); box-sizing:border-box; }
.stktv-cf-box h2{ margin:0 0 16px; font:600 17px/22px -apple-system,BlinkMacSystemFont,Roboto,system-ui,sans-serif; }
.stktv-cf-btns{ display:flex; gap:8px; justify-content:flex-end; } .stktv-cf-btns button{ height:40px; padding:0 16px; border-radius:12px; border:1px solid var(--line); background:var(--bg-2); color:var(--ink-0); font-family:inherit; font-size:14px; line-height:20px; font-weight:500; cursor:pointer; }
.stktv-cf-btns .go{ background:var(--gold); border-color:var(--gold); color:#06130e; }
`;
