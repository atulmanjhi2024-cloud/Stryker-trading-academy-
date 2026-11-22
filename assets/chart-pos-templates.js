// TradeZoro — Charts: saved templates for the Long / Short Position tool (ES module, charts.html only)
// Member ask (Edge): "Can the position tool have fix templates that we can save?"
// A template = fixed settings of a position box: risk % and account size, stop and target distance
// (in ticks when the symbol's tick is known, else in price points), zone + line colours, which
// labels show. The position settings window gets a "Templates" button (footer): Save current as...,
// click a template to apply it to this box, star = default for every NEW Long / Short box, x = delete.
// Both tools share one list; a long template applied to a short box keeps the box's side.
// Store: localStorage "stryker_pos_tpl" = {"list":[{id,name,u,s,p,st,tg}],"def":id|null}; the key is in
// the account-sync registry (assets/account-sync.js), so it follows the member to every device.
// Measurement only: no orders, no trading. Depends on: Vela drawings API (cell.chart.drawings).

const KEY = 'stryker_pos_tpl';
const TYPES = new Set(['position', 'shortposition']);
const MAX = 20, NAME_MAX = 60;
const PROP_KEYS = ['riskPercent', 'accountBalance', 'showText', 'showHeader', 'showPrices', 'showLossSize', 'showTargetLabel', 'showStopLabel', 'profitColor', 'lossColor'];
const STYLE_KEYS = ['lineColor', 'lineWidth', 'lineStyle'];

let WS = null, started = false;
const wired = new WeakSet();

// ---- store ---------------------------------------------------------------------------------
export function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    const list = v && Array.isArray(v.list) ? v.list.filter((t) => t && typeof t.id === 'string' && typeof t.name === 'string' && t.p && typeof t.p === 'object').slice(0, MAX) : [];
    return { list, def: v && list.some((t) => t.id === v.def) ? v.def : null };
  } catch (e) { return { list: [], def: null }; }
}
function save(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.warn('TradeZoro: position templates', e); } }
const uid = () => 'pt' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---- the live drawing ----------------------------------------------------------------------
const cellsOf = () => { try { return (WS.context().cells || []).map((c) => WS.cell(c.id)).filter(Boolean); } catch (e) { return []; } };
const rendererOf = (cell) => { try { return cell.chart.renderer.renderer; } catch (e) { return null; } };
function liveOf(cell, id) { const R = rendererOf(cell); return R && R.userDrawings && R.userDrawings.drawings.find((x) => x.id === id) || null; }
const hasTick = (d) => { try { const sp = d.constructor.stkSpec && d.constructor.stkSpec(); return !!(sp && sp.tick > 0); } catch (e) { return false; } };

export function capture(d, name) {
  const w = d.serialize();
  const p = {}; for (const k of PROP_KEYS) if (w.props && w.props[k] !== undefined) p[k] = w.props[k];
  const s = {}; for (const k of STYLE_KEYS) if (d.style && d.style[k] !== undefined) s[k] = d.style[k];
  const t = { id: uid(), name: String(name).trim().slice(0, NAME_MAX), u: hasTick(d) ? 'ticks' : 'pts', s, p };
  if (d.prices()) { t.st = d.levelDisplayValue('stop', 'ticks'); t.tg = d.levelDisplayValue('target', 'ticks'); }
  return t;
}

// Patch for a drawing: props + line style always; stop / target distance only when the template's
// unit matches what this symbol can measure (never ticks onto a symbol without a tick, or the reverse).
export function patchFor(d, t) {
  const patch = { props: Object.assign({}, t.p) };
  if (t.s && Object.keys(t.s).length) patch.style = Object.assign({}, d.style, t.s);
  const p = d.prices();
  if (p && (t.u === 'ticks') === hasTick(d) && t.st > 0 && t.tg > 0 && d.anchors[2]) {
    const stop = d.levelPriceFromDisplay('stop', 'ticks', t.st), target = d.levelPriceFromDisplay('target', 'ticks', t.tg);
    const a = d.anchors;
    patch.anchors = [{ time: a[0].time, price: a[0].price }, { time: a[1].time, price: stop }, { time: a[2].time, price: target }];
  }
  return patch;
}
export function applyTemplate(cell, id, t) {
  const d = liveOf(cell, id);
  if (!d) return false;
  cell.chart.drawings.update(id, patchFor(d, t));
  // an open settings window shows the old values: Vela has no refresh hook for it, so open it again
  try { const ud = rendererOf(cell).userDrawings; if (document.querySelector('.vela-dsp')) { ud.popup.panel.close(); setTimeout(() => { try { ud.openSettings(id); ud.popup.openPanel(); } catch (e) {} }, 30); } } catch (e) {}
  return true;
}

// ---- default on new draw -------------------------------------------------------------------
function wireCells() {
  for (const cell of cellsOf()) {
    const ch = cell.chart;
    if (!ch || wired.has(ch)) continue;
    wired.add(ch);
    let armed = 0;   // the tool was picked (or is active) a moment ago: this creation is a fresh draw, not a paste / restore
    try {
      ch.on('drawing:tool', (e) => { if (e && TYPES.has(e.type)) armed = Date.now(); });
      ch.on('drawing:created', (e) => {
        const id = e && (e.id || (e.drawing && e.drawing.id));
        let tool = null; try { tool = ch.drawings.getTool(); } catch (er) {}
        const fresh = Date.now() - armed < 120000 || TYPES.has(tool);
        if (!id || !fresh) return;
        setTimeout(() => {
          try {
            const db = load(), t = db.list.find((x) => x.id === db.def);
            const d = t && liveOf(cell, id);
            if (d && TYPES.has(d.type) && d.anchors[2]) ch.drawings.update(id, patchFor(d, t));
          } catch (er) { console.warn('TradeZoro: position template default', er); }
        }, 0);
      });
    } catch (e) { /* cell without events: skip */ }
  }
}

// ---- settings window: "Templates" button + menu --------------------------------------------
const CHEV = '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2.5 4.5 3.5 3.5 3.5-3.5"/></svg>';
const STAR = (on) => '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="' + (on ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.5l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/></svg>';
const CROSS = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/></svg>';

function selected() {
  for (const cell of cellsOf()) {
    const R = rendererOf(cell), ud = R && R.userDrawings;
    const id = ud && ud.selectedIds && [...ud.selectedIds][0];
    const d = id && liveOf(cell, id);
    if (d && TYPES.has(d.type)) return { cell, id, d };
  }
  return null;
}

function openMenu(btn, dlg) {
  const close = () => { menu.remove(); btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', away, true); dlg.removeEventListener('keydown', esc, true); };
  const away = (e) => { if (!menu.contains(e.target) && !btn.contains(e.target)) close(); };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); btn.focus(); } };
  const menu = document.createElement('div');
  menu.className = 'stk-ptpl-menu'; menu.setAttribute('role', 'menu');
  const fill = (saving) => {
    const sel = selected();
    const db = load();
    menu.replaceChildren();
    const head = document.createElement('div'); head.className = 'stk-ptpl-h'; head.textContent = 'My templates'; menu.append(head);
    if (!db.list.length) { const e = document.createElement('div'); e.className = 'stk-ptpl-empty'; e.textContent = 'None saved yet.'; menu.append(e); }
    for (const t of db.list) {
      const row = document.createElement('div'); row.className = 'stk-ptpl-row'; row.setAttribute('role', 'none');
      const use = document.createElement('button'); use.type = 'button'; use.className = 'stk-ptpl-use'; use.setAttribute('role', 'menuitem');
      use.title = 'Apply "' + t.name + '" to this position';
      const sw = document.createElement('span'); sw.className = 'stk-ptpl-sw'; sw.style.background = t.p.profitColor || 'transparent';
      const nm = document.createElement('span'); nm.className = 'stk-ptpl-nm'; nm.textContent = t.name;
      use.append(sw, nm);
      use.onclick = () => { const s = selected(); if (s) applyTemplate(s.cell, s.id, t); close(); };
      const star = document.createElement('button'); star.type = 'button'; star.className = 'stk-ptpl-ic' + (db.def === t.id ? ' on' : '');
      star.innerHTML = STAR(db.def === t.id); star.setAttribute('aria-pressed', db.def === t.id ? 'true' : 'false');
      star.title = db.def === t.id ? 'Default for new positions (click to clear)' : 'Use as default for new positions';
      star.setAttribute('aria-label', star.title);
      star.onclick = () => { const x = load(); x.def = x.def === t.id ? null : t.id; save(x); fill(); };
      const del = document.createElement('button'); del.type = 'button'; del.className = 'stk-ptpl-ic'; del.innerHTML = CROSS;
      del.title = 'Delete "' + t.name + '"'; del.setAttribute('aria-label', del.title);
      del.onclick = () => { const x = load(); x.list = x.list.filter((y) => y.id !== t.id); if (x.def === t.id) x.def = null; save(x); fill(); };
      row.append(use, star, del); menu.append(row);
    }
    const sep = document.createElement('div'); sep.className = 'stk-ptpl-sep'; menu.append(sep);
    if (saving) {
      const f = document.createElement('div'); f.className = 'stk-ptpl-form';
      const inp = document.createElement('input'); inp.type = 'text'; inp.maxLength = NAME_MAX; inp.placeholder = 'Template name'; inp.setAttribute('aria-label', 'Template name');
      const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'stk-ptpl-save'; ok.textContent = 'Save';
      const go = () => {
        const name = inp.value.trim(); const s = selected(); const x = load();
        if (!name || !s) return;
        if (x.list.length >= MAX && !x.list.some((y) => y.name === name)) { inp.value = ''; inp.placeholder = 'Limit is ' + MAX + ' templates'; return; }
        const t = capture(s.d, name);
        const i = x.list.findIndex((y) => y.name === name);
        if (i >= 0) { t.id = x.list[i].id; x.list[i] = t; } else x.list.push(t);
        save(x); fill();
      };
      ok.onclick = go;
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') go(); if (e.key === 'Escape') { fill(); } });
      f.append(inp, ok); menu.append(f); setTimeout(() => inp.focus(), 0);
    } else {
      const add = document.createElement('button'); add.type = 'button'; add.className = 'stk-ptpl-add'; add.setAttribute('role', 'menuitem');
      add.textContent = 'Save current as…'; add.disabled = !sel;
      add.onclick = () => fill(true);
      menu.append(add);
    }
    const note = document.createElement('div'); note.className = 'stk-ptpl-note';
    const d = db.list.find((y) => y.id === db.def);
    note.textContent = d ? 'New positions start from: ' + d.name : 'Star a template to start every new position from it.';
    menu.append(note);
    place();
  };
  const place = () => {
    const r = btn.getBoundingClientRect(), dr = dlg.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8)) + 'px';
    const h = menu.offsetHeight;
    menu.style.top = Math.max(8, r.top - h - 6) + 'px';   // the button sits in the footer: open upwards
    menu.style.minWidth = Math.min(Math.max(r.width, 240), innerWidth - 16) + 'px';
  };
  dlg.appendChild(menu);
  btn.setAttribute('aria-expanded', 'true');
  fill();
  document.addEventListener('pointerdown', away, true);
  dlg.addEventListener('keydown', esc, true);
  return close;
}

function addButton(dlg) {
  const foot = dlg.querySelector('.vela-dialog-footer');
  if (!foot || foot.querySelector('.stk-ptpl-btn')) return;
  const s = selected();
  if (!s) return;
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'stk-ptpl-btn'; btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<span>Templates</span>' + CHEV;
  let closeFn = null;
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (dlg.querySelector('.stk-ptpl-menu')) { dlg.querySelector('.stk-ptpl-menu').remove(); btn.setAttribute('aria-expanded', 'false'); return; }
    closeFn = openMenu(btn, dlg);
  });
  dlg.classList.add('stk-ptpl-dlg');   // hides Vela's own one-style "Template" button: this one replaces it for position boxes
  foot.prepend(btn);
}

const CSS = `
.stk-ptpl-dlg .vela-dsp-style{display:none}
.stk-ptpl-dlg .vela-dialog-footer{align-items:center}
.stk-ptpl-btn{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:1px solid var(--vela-border-strong);border-radius:var(--vela-radius-md);color:var(--vela-fg-bright);font:600 13px/1 var(--vela-font);cursor:pointer;margin-right:auto}
.stk-ptpl-btn:hover{background:var(--vela-hover)}
.stk-ptpl-btn:focus-visible,.stk-ptpl-use:focus-visible,.stk-ptpl-ic:focus-visible,.stk-ptpl-add:focus-visible,.stk-ptpl-save:focus-visible{outline:2px solid var(--vela-selected-bg);outline-offset:1px}
.stk-ptpl-btn svg{flex:none}
.stk-ptpl-menu{position:fixed;z-index:6100;box-sizing:border-box;width:280px;max-width:calc(100vw - 16px);max-height:min(60vh,420px);overflow-y:auto;padding:8px;background:var(--vela-surface-elev);color:var(--vela-fg);border:1px solid var(--vela-border);border-radius:var(--vela-radius-lg);box-shadow:var(--vela-shadow);font:13px/1.2 var(--vela-font);scrollbar-width:thin;scrollbar-color:rgba(128,128,128,.35) transparent}
.stk-ptpl-menu::-webkit-scrollbar{width:6px}.stk-ptpl-menu::-webkit-scrollbar-thumb{background:rgba(128,128,128,.35);border-radius:3px}.stk-ptpl-menu::-webkit-scrollbar-thumb:hover{background:rgba(128,128,128,.6)}
.stk-ptpl-menu::-webkit-scrollbar-button{display:none}
.stk-ptpl-h{padding:4px 8px 6px;color:var(--vela-fg-muted);font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.stk-ptpl-empty,.stk-ptpl-note{padding:6px 8px;color:var(--vela-fg-muted);font-size:12px;line-height:1.35}
.stk-ptpl-row{display:flex;align-items:center;gap:2px;min-height:36px}
.stk-ptpl-use{all:unset;box-sizing:border-box;flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:8px;height:36px;padding:0 8px;border-radius:var(--vela-radius-md);cursor:pointer;color:var(--vela-fg-bright)}
.stk-ptpl-use:hover,.stk-ptpl-add:hover{background:var(--vela-hover)}
.stk-ptpl-sw{flex:none;width:10px;height:10px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(128,128,128,.5)}
.stk-ptpl-nm{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.stk-ptpl-ic{all:unset;box-sizing:border-box;flex:none;display:grid;place-items:center;width:32px;height:32px;border-radius:var(--vela-radius-md);color:var(--vela-fg-muted);cursor:pointer}
.stk-ptpl-ic:hover{background:var(--vela-hover);color:var(--vela-fg-bright)}
.stk-ptpl-ic.on{color:var(--vela-highlight)}
.stk-ptpl-sep{height:1px;margin:6px 0;background:var(--vela-border)}
.stk-ptpl-add{all:unset;box-sizing:border-box;display:flex;align-items:center;width:100%;height:36px;padding:0 8px;border-radius:var(--vela-radius-md);cursor:pointer;color:var(--vela-fg-bright)}
.stk-ptpl-add[disabled]{opacity:.4;cursor:default}
.stk-ptpl-form{display:flex;align-items:center;gap:8px;padding:2px 0}
.stk-ptpl-form input{flex:1 1 auto;min-width:0;box-sizing:border-box;height:32px;padding:0 8px;background:transparent;color:var(--vela-fg-bright);border:1px solid var(--vela-border-strong);border-radius:var(--vela-radius-md);font:13px var(--vela-font)}
.stk-ptpl-save{all:unset;box-sizing:border-box;flex:none;height:32px;padding:0 14px;display:inline-flex;align-items:center;border-radius:var(--vela-radius-md);background:var(--vela-selected-bg);color:var(--vela-selected-fg);font:600 13px var(--vela-font);cursor:pointer}
@media (pointer:coarse){.stk-ptpl-btn{height:36px}.stk-ptpl-row,.stk-ptpl-use,.stk-ptpl-add{height:44px;min-height:44px}.stk-ptpl-ic{width:44px;height:44px}.stk-ptpl-form input,.stk-ptpl-save{height:40px}.stk-ptpl-form input{font-size:16px}}
`;

export function mountPositionTemplates(ws) {
  WS = ws; if (started) return; started = true;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  wireCells();
  try { ws.on('layout:changed', () => setTimeout(wireCells, 0)); ws.on('state:changed', () => setTimeout(wireCells, 0)); } catch (e) {}
  let q = 0;
  new MutationObserver(() => { if (q) return; q = requestAnimationFrame(() => { q = 0; for (const dlg of document.querySelectorAll('.vela-dsp')) { try { addButton(dlg); } catch (e) {} } }); })
    .observe(document.body, { childList: true, subtree: true });
  window.__stkPosTpl = { load, capture, patchFor, applyTemplate };
}
