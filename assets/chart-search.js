// TradeZoro — Charts SYMBOL SEARCH (Owner order 2026-11-15: "make our search bar like this ... add more"). ES module.
// Depends on: assets/vela-chart.js (calls mountSearch(ws, { toast, normalize }) once the workspace exists; ws.feed,
// ws.active, ws.symbolPicker, ws.trackDialog), assets/chart-search-core.js (matching + numbers, pure),
// assets/chart-formula-core.js + chart-formula.js (ratio / spread rows -> the existing "formula" provider),
// assets/chart-symbol-info.js getInfo() (futures contract months, already fetched once a day for the Symbol info panel),
// assets/chart-data-dot.js window.STRYKER_DATA_DOT.statusOf (the Live / Delayed truth), firebase compat (favourites),
// style.css (.stkss-*).
//
// It REPLACES the header symbol search: ws.symbolPicker.open / type / close / isOpen on the workspace's own instance are
// pointed here, so the toolbar symbol button, bare typing on the chart and every openSymbolSearch() land in this panel.
// The Vela SymbolPicker class itself is untouched (watchlist "+" and indicator inputs keep it).
// Kill switch: charts?search=classic, or localStorage tz_search_classic = '1', keeps the old picker.
//
// Opens with Ctrl+K / Cmd+K / "/" anywhere on the chart page (not while typing in a field), Esc closes.
// Prices: the newest daily close vs the previous one, read from the SAME provider instance the chart uses (our futures /
// forex / index endpoint, the public exchange feeds). Only for the first rows on screen, cached 60 s, never stocks
// (separate server search). No data = no number, never a placeholder figure.
// Favourites: signed in -> students/{uid}/chartFavorites/{sym_...} { key:'sym:<symbol>', name, at } (the existing
// favourites collection and rule; the Indicators window ignores sym: keys); guests -> localStorage. Recents: localStorage.
// Education only. Not financial advice.

import { classify, venueOf, pairOf, metaOf, search, symOf, keyOf, quoteOf, decimalsOf, VENUE_LABEL, VENUE_ORDER, CRYPTO_VENUES } from './chart-search-core.js?v=1266';
import { parseFormula, bodyOf } from './chart-formula-core.js?v=1266';
import { resolveLegs } from './chart-formula.js?v=1266';
import { venueChip } from './venue-logos.js?v=1266';
import { fxMark } from './fx-flags.js?v=1266';
import { symLogo } from './symbol-logos.js?v=1266';
import { getInfo } from './chart-symbol-info.js?v=1266';

const PHONE_MAX = 700;
const PAGE = 50;
const LS_FAV = 'tz_sym_favs', LS_RECENT = 'tz_sym_recent';
const TABS = [['all', 'All'], ['stocks', 'Stocks'], ['futures', 'Futures'], ['crypto', 'Crypto'], ['forex', 'Forex'], ['indices', 'Indices']];
const TYPE_LABEL = { futures: 'Futures', crypto: 'Crypto', forex: 'Forex', indices: 'Index', stocks: 'Stock', other: 'Market' };
const POPULAR = [['futures', 'ES1!'], ['futures', 'NQ1!'], ['binance', 'BTCUSDT'], ['binance', 'ETHUSDT'], ['idx', 'SPY'], ['idx', 'QQQ'], ['futures', 'GC1!'], ['futures', 'CL1!'], ['fx', 'EURUSD'], ['binance', 'SOLUSDT']];
const QUOTE_PROVIDERS = ['futures', 'fx', 'idx'].concat(CRYPTO_VENUES);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// chart root -> contract-info key; micros of the index futures share the E-mini expiries (CME quarterly cycle)
const INFO_KEY = { NQ: 'NQ', ES: 'ES', YM: 'YM', RTY: 'RTY', GC: 'GC', SI: 'SI', CL: 'CL', NG: 'NG', ZN: 'ZN', ZB: 'ZB', '6E': '6E', MNQ: 'NQ', MES: 'ES', MYM: 'YM', M2K: 'RTY' };

const svg = (p, s = 20) => '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
const IC = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chev: '<path d="M7 10l5 5 5-5"/>',
  venue: '<path d="M4 9.5L12 5l8 4.5"/><path d="M5 19.5h14M6.5 10.5v6.5M10 10.5v6.5M14 10.5v6.5M17.5 10.5v6.5"/>',
  ratio: '<path d="M6 18L18 6"/><circle cx="7" cy="7" r="2.2"/><circle cx="17" cy="17" r="2.2"/>'
};

function el(tag, attrs, kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k === 'html') n.innerHTML = v; else n.setAttribute(k, v === true ? '' : v);
  }
  (kids || []).forEach((c) => c && n.appendChild(c));
  return n;
}
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const fbUser = () => { try { return typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length ? firebase.auth().currentUser : null; } catch (e) { return null; } };
const favCol = (u) => firebase.firestore().collection('students').doc(u.uid).collection('chartFavorites');
const isPhone = () => window.innerWidth <= PHONE_MAX || document.documentElement.getAttribute('data-device') === 'mobile';
const editable = (t) => !!(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)));
const initials = (d) => { const p = pairOf(d); const b = (p ? p.base : String(d.ticker || '').replace(/1!$/, '')).replace(/[^A-Z0-9]/gi, ''); return (b.slice(0, 3) || '?').toUpperCase(); };

export function classicWanted() {
  try { if (new URLSearchParams(location.search).get('search') === 'classic') return true; return localStorage.getItem('tz_search_classic') === '1'; } catch (e) { return false; }
}

export function mountSearch(ws, o = {}) {
  if (!ws || !ws.symbolPicker || window.__stkSearch) return window.__stkSearch || null;
  const normalize = o.normalize;
  const sp = ws.symbolPicker;

  // ---------------- state ----------------
  const S = { open: false, src: null, srcs: null, srcData: null, tab: 'all', venue: '', quote: '', products: new Set(), rows: [], hi: 0, shown: 0, filters: false, lastFocus: null };
  const quotes = new Map();   // sym -> { at, q }  (q null = no data)
  let favs = new Map(lsGet(LS_FAV, []).map((x) => [x.s, x]));   // sym -> { s, t, p, n, y }
  let recents = lsGet(LS_RECENT, []);
  let favUid = null;
  let poolCache = { key: '', list: [] };

  function pool() {
    let raw = [];
    try { raw = ws.feed.symbols() || []; } catch (e) {}
    const key = raw.length + ':' + (raw[0] && raw[0].ticker) + ':' + (raw.length && raw[raw.length - 1].ticker);
    if (key !== poolCache.key) {
      const seen = new Set(), list = [];
      for (const d of raw) { if (!d || !d.ticker || d.provider === 'formula') continue; const k = keyOf(symOf(d)); if (seen.has(k)) continue; seen.add(k); list.push(d); }
      // everything the panel needs per open, computed once per pool (open < 100 ms)
      const cats = new Set(), venues = new Set(), counts = new Map();
      for (const d of list) { const m = metaOf(d); cats.add(m.c); venues.add(m.v); if (m.pr && m.c === 'crypto') counts.set(m.pr.quote, (counts.get(m.pr.quote) || 0) + 1); }
      const quotesList = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map((x) => x[0]);
      poolCache = { key, list, cats, venues, quotes: quotesList, byKey: new Map(list.map((d) => [keyOf(symOf(d)), d])), byPT: new Map(list.map((d) => [d.provider + ':' + String(d.ticker).toUpperCase(), d])) };
    }
    return poolCache;
  }
  const descOf = (x) => pool().byKey.get(keyOf(x.s)) || { ticker: x.t || x.s.split(':').pop(), description: x.n || '', type: x.y || '', provider: x.p || '', prefix: x.s.includes(':') ? x.s.split(':')[0] : undefined, __sym: x.s };
  const symFor = (d) => d.__sym || symOf(d);
  const memo = (d) => ({ s: symFor(d), t: d.ticker, p: d.provider || '', n: String(d.description || '').slice(0, 80), y: d.type || '' });

  // ---------------- favourites ----------------
  async function loadFavs() {
    const u = fbUser();
    const uid = u ? u.uid : null;
    if (uid === favUid) return;
    favUid = uid;
    if (!u) { favs = new Map(lsGet(LS_FAV, []).map((x) => [x.s, x])); if (S.open) render(); return; }
    favs = new Map(lsGet(LS_FAV + '_' + uid, []).map((x) => [x.s, x]));
    try {
      const snap = await favCol(u).limit(300).get();
      const m = new Map();
      snap.forEach((doc) => {
        const x = doc.data() || {};
        if (typeof x.key !== 'string' || !x.key.startsWith('sym:')) return;
        const s = x.key.slice(4), parts = String(x.name || '').split('\u001f');
        m.set(s, { s, t: s.split(':').pop(), n: parts[0] || '', y: parts[1] || '', p: parts[2] || '' });
      });
      if (favUid === uid) { favs = m; lsSet(LS_FAV + '_' + uid, [...m.values()]); if (S.open) render(); }
    } catch (e) { console.warn('TradeZoro search: favourites', e); }
  }
  async function toggleFav(d) {
    const x = memo(d), on = !favs.has(x.s), u = fbUser();
    if (on) favs.set(x.s, x); else favs.delete(x.s);
    lsSet(u ? LS_FAV + '_' + u.uid : LS_FAV, [...favs.values()]);
    if (S.open) paintStars();
    if (!u) return;
    try {
      const ref = favCol(u).doc(('sym:' + x.s).replace(/[:/]/g, '_').slice(0, 100));
      if (on) await ref.set({ key: ('sym:' + x.s).slice(0, 90), name: [x.n, x.y, x.p].join('\u001f').slice(0, 80), at: firebase.firestore.FieldValue.serverTimestamp() });
      else await ref.delete();
    } catch (e) {
      if (on) favs.delete(x.s); else favs.set(x.s, x);
      if (S.open) paintStars();
      if (o.toast) o.toast('Could not save the favourite. Try again.', 'error');
    }
  }
  try { if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) firebase.auth().onAuthStateChanged(() => loadFavs()); } catch (e) {}

  function addRecent(d) {
    const x = memo(d);
    recents = [x].concat(recents.filter((r) => r && r.s !== x.s)).slice(0, 10);
    lsSet(LS_RECENT, recents);
  }

  // ---------------- DOM ----------------
  const input = el('input', { class: 'stkss-input', type: 'text', placeholder: 'Search markets, or type a ratio like ES/NQ', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'characters', 'aria-label': 'Search markets', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'stkss-list', 'aria-autocomplete': 'list' });
  const kbdHint = el('span', { class: 'stkss-kbd-hint', html: '<kbd>' + (/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl') + '</kbd><kbd>K</kbd>' });
  const clearBtn = el('button', { type: 'button', class: 'stkss-clear', 'aria-label': 'Clear search', hidden: '', html: svg(IC.close, 16) });
  const closeBtn = el('button', { type: 'button', class: 'stkss-x', 'aria-label': 'Close symbol search', html: svg(IC.close) });
  const field = el('div', { class: 'stkss-field' }, [el('span', { class: 'stkss-field-ic', html: svg(IC.search) }), input, clearBtn, kbdHint]);
  const top = el('div', { class: 'stkss-top' }, [field, closeBtn]);
  const tabs = el('div', { class: 'stkss-tabs', role: 'tablist', 'aria-label': 'Market type' });
  const filterBtn = el('button', { type: 'button', class: 'stkss-filter-btn', 'aria-expanded': 'false', 'aria-controls': 'stkss-rail', html: svg(IC.filter, 18) + '<span>Filters</span><b class="stkss-fcount" hidden></b>' });
  const srcChip = el('button', { type: 'button', class: 'stkss-srcchip', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'stkss-srcmenu' });
  const srcMenu = el('div', { class: 'stkss-srcmenu', id: 'stkss-srcmenu', role: 'menu', 'aria-label': 'Source', hidden: '' });
  const tabRow = el('div', { class: 'stkss-tabrow' }, [filterBtn, srcChip, tabs]);
  const rail = el('aside', { class: 'stkss-rail', id: 'stkss-rail', 'aria-label': 'Filters' });
  const listHead = el('div', { class: 'stkss-lhead' });
  const list = el('div', { class: 'stkss-list', id: 'stkss-list', role: 'listbox', 'aria-label': 'Results' });
  const main = el('div', { class: 'stkss-main' }, [listHead, list]);
  const side = el('aside', { class: 'stkss-side', 'aria-label': 'Details', 'aria-live': 'polite' });
  const body = el('div', { class: 'stkss-body' }, [rail, main, side]);
  const foot = el('div', { class: 'stkss-foot', html: '<span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>Enter</kbd> Open</span><span><kbd>Esc</kbd> Close</span><span class="stkss-foot-note">Prices: latest daily close vs the previous one. Education only. Not financial advice.</span>' });
  const box = el('div', { class: 'stkss-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Symbol search' }, [top, tabRow, body, foot, srcMenu]);
  const scrim = el('div', { class: 'stkss-scrim' });
  const root = el('div', { class: 'stkss', hidden: '' }, [scrim, box]);
  document.body.appendChild(root);

  // tabs (only categories with data)
  function buildTabs() {
    const have = pool().cats;
    tabs.replaceChildren();
    const list = S.src ? [['all', 'All']].concat([...new Set(((S.srcData && S.srcData.rows) || []).map((r) => r.cls))].map((c) => [c, c])) : TABS;   // a broker: its own asset classes
    for (const [id, label] of list) {
      if (S.src) { const b = el('button', { type: 'button', class: 'stkss-tab', role: 'tab', 'data-tab': id, 'aria-selected': String(S.tab === id), text: label }); b.addEventListener('click', () => { setTab(id); input.focus(); }); tabs.appendChild(b); continue; }
      if (id !== 'all' && !have.has(id)) continue;
      const b = el('button', { type: 'button', class: 'stkss-tab', role: 'tab', 'data-tab': id, 'aria-selected': String(S.tab === id), text: label });
      b.addEventListener('click', () => { setTab(id); input.focus(); });
      tabs.appendChild(b);
    }
  }
  function setTab(id) {
    S.tab = id;
    if (S.src) { tabs.querySelectorAll('.stkss-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id))); render(); return; }   // within the broker
    if (id !== 'crypto' && id !== 'all') { S.quote = ''; S.products.clear(); }
    tabs.querySelectorAll('.stkss-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
    const t = tabs.querySelector('[aria-selected="true"]');
    if (t) { const r = t.offsetLeft - (tabs.clientWidth - t.offsetWidth) / 2; tabs.scrollLeft = Math.max(0, Math.min(r, tabs.scrollWidth - tabs.clientWidth)); }
    buildRail(); render();
  }

  // rail: Browse, Exchanges, Refine
  function buildRail() {
    const PC = pool(), P = PC.list;
    rail.replaceChildren();
    const sec = (title, kids) => el('section', { class: 'stkss-sec' }, [el('h3', { class: 'stkss-sec-h', text: title })].concat(kids));
    const item = (label, on, fn, lead) => {
      const b = el('button', { type: 'button', class: 'stkss-ri', 'aria-pressed': String(!!on) }, [lead || null, el('span', { class: 'stkss-ri-l', text: label }), on ? el('span', { class: 'stkss-ri-ck', html: svg(IC.check, 16) }) : null]);
      b.addEventListener('click', () => { fn(); if (isPhone()) setFilters(false); input.focus({ preventScroll: true }); });
      return b;
    };
    const have = PC.cats;
    rail.appendChild(sec('Browse', TABS.filter(([id]) => id === 'all' || have.has(id)).map(([id, l]) => item(l, S.tab === id, () => setTab(id)))));
    const venues = VENUE_ORDER.filter((v) => PC.venues.has(v));
    rail.appendChild(sec('Exchanges', venues.map((v) => item(VENUE_LABEL[v] || v.toUpperCase(), S.venue === v, () => { S.venue = S.venue === v ? '' : v; if (S.src) { setSource(null); return; } buildRail(); render(); }, el('span', { class: 'stkss-vb stkss-vb-' + (CRYPTO_VENUES.includes(v) ? 'crypto' : v === 'fx' ? 'forex' : ['cme', 'cbot', 'comex', 'nymex'].includes(v) ? 'futures' : 'stocks'), 'aria-hidden': 'true' }, [venueChip(v)])))));
    // Refine
    const selWrap = (label, sel) => el('label', { class: 'stkss-sel' }, [el('span', { class: 'stkss-sel-l', text: label }), el('span', { class: 'stkss-sel-box' }, [sel, el('span', { class: 'stkss-sel-ic', html: svg(IC.chev, 16) })])]);
    const exSel = el('select', { 'aria-label': 'Exchange' });
    exSel.appendChild(el('option', { value: '', text: 'Any exchange' }));
    venues.forEach((v) => exSel.appendChild(el('option', { value: v, text: VENUE_LABEL[v] || v })));
    exSel.value = S.venue;
    exSel.addEventListener('change', () => { S.venue = exSel.value; buildRail(); render(); });
    const kids = [selWrap('Exchange', exSel)];
    if (S.tab === 'crypto' || S.tab === 'all') {
      const qs = PC.quotes;
      if (qs.length) {
        const qSel = el('select', { 'aria-label': 'Quote currency' });
        qSel.appendChild(el('option', { value: '', text: 'Any quote' }));
        qs.forEach((q) => qSel.appendChild(el('option', { value: q, text: q })));
        qSel.value = S.quote;
        qSel.addEventListener('change', () => { S.quote = qSel.value; render(); updateFilterCount(); });
        kids.push(selWrap('Quote (crypto)', qSel));
      }
    }
    const chips = el('div', { class: 'stkss-chips', role: 'group', 'aria-label': 'Product' });
    [['spot', 'Spot'], ['perp', 'Perps'], ['fut', 'Futures']].forEach(([id, l]) => {
      const c = el('button', { type: 'button', class: 'stkss-chip', 'aria-pressed': String(S.products.has(id)), text: l });
      c.addEventListener('click', () => { if (!S.products.delete(id)) S.products.add(id); c.setAttribute('aria-pressed', String(S.products.has(id))); render(); updateFilterCount(); });
      chips.appendChild(c);
    });
    kids.push(el('div', { class: 'stkss-sel' }, [el('span', { class: 'stkss-sel-l', text: 'Product' }), chips]));
    if (S.venue || S.quote || S.products.size) {
      const reset = el('button', { type: 'button', class: 'stkss-reset', text: 'Clear filters' });
      reset.addEventListener('click', () => { S.venue = ''; S.quote = ''; S.products.clear(); buildRail(); render(); });
      kids.push(reset);
    }
    rail.appendChild(sec('Refine', kids));
    const done = el('button', { type: 'button', class: 'stkss-done', text: 'Show results' });   // phone sheet only
    done.addEventListener('click', () => { setFilters(false); input.focus({ preventScroll: true }); });
    rail.appendChild(done);
    updateFilterCount();
  }
  function updateFilterCount() {
    const n = (S.venue ? 1 : 0) + (S.quote ? 1 : 0) + S.products.size;
    const b = filterBtn.querySelector('.stkss-fcount');
    b.hidden = !n; b.textContent = String(n);
  }
  function setFilters(on) { S.filters = on; box.classList.toggle('stkss-filters-open', on); filterBtn.setAttribute('aria-expanded', String(on)); }
  filterBtn.addEventListener('click', () => setFilters(!S.filters));

  // ---------------- your brokers & feeds (assets/chart-search-sources.js, loaded on the first open) ----------------
  let SRC = null, SRCM = null;
  const srcMod = () => SRC || (SRC = import('./chart-search-sources.js?v=1266').then((m) => { SRCM = m; return m; }));
  const srcKey = (x) => x.id;
  async function refreshSources() {
    try { const m = await srcMod(); const l = await m.listSources(); const sig = (a) => (a || []).map((x) => x.id + x.ok + x.label).join('|'); if (sig(l) !== sig(S.srcs) || !S.srcs) { S.srcs = l; if (!srcMenu.hidden) paintMenu(); } }
    catch (e) { console.warn('TradeZoro search: sources', e); }
  }
  const dot = (x) => el('span', { class: 'stkss-sdot' + (x.ok ? '' : ' is-warn'), role: 'img', 'aria-label': x.ok ? 'Connected' : 'Needs sign-in', title: x.ok ? 'Connected' : 'Needs sign-in' });
  function connectFlow() {
    close();
    try { if (window.STRYKER_BYO && window.STRYKER_BYO.open) { window.STRYKER_BYO.open(); return; } } catch (e) {}
    try { const lv = window.__stkLive; if (lv && lv.connect) { lv.connect(); return; } } catch (e) {}
    if (o.toast) o.toast('Open Data source in the toolbar to connect a broker or feed.', 'info');
  }
  // the source chip (left of the market tabs): "All markets" or the picked broker / feed, with its status dot
  function paintSrcChip() {
    const x = S.src;
    srcChip.replaceChildren(...[x ? dot(x) : null, el('span', { class: 'stkss-srcchip-l', text: x ? x.name : 'All markets' }), el('span', { class: 'stkss-srcchip-ic', html: svg(IC.chev, 16) })].filter(Boolean));
    srcChip.setAttribute('aria-label', 'Source: ' + (x ? x.name + (x.label ? ' ' + x.label : '') : 'All markets'));
    srcChip.classList.toggle('is-on', !!x);
    input.placeholder = x ? 'Search ' + x.name + ' symbols' : isPhone() ? 'Search markets or ES/NQ' : 'Search markets, or type a ratio like ES/NQ';
  }
  function paintMenu() {
    srcMenu.replaceChildren();
    const item = (kids, on, fn, cls) => { const b = el('button', { type: 'button', class: 'stkss-mi' + (cls ? ' ' + cls : ''), role: cls ? 'menuitem' : 'menuitemradio', 'aria-checked': cls ? null : String(!!on) }, kids.concat(on ? [el('span', { class: 'stkss-ri-ck', html: svg(IC.check, 16) })] : [])); b.addEventListener('click', fn); srcMenu.appendChild(b); return b; };
    item([el('span', { class: 'stkss-mi-l', text: 'All markets' })], !S.src, () => { menu(false); setSource(null); });
    for (const x of S.srcs || []) item([dot(x), el('span', { class: 'stkss-mi-l', text: x.name }), x.label ? el('span', { class: 'stkss-mi-s', text: x.label }) : null], !!(S.src && S.src.id === x.id), () => { menu(false); setSource(x); }).dataset.src = x.id;
    if (!S.srcs) srcMenu.appendChild(el('p', { class: 'stkss-mi-wait', text: 'Loading your brokers and feeds…' }));
    item([el('span', { class: 'stkss-mi-l', text: '+ Connect a broker or feed' })], false, () => { menu(false); connectFlow(); }, 'is-add');
  }
  function menu(on, from) {
    if (on === !srcMenu.hidden) return;
    srcMenu.hidden = !on; srcChip.setAttribute('aria-expanded', String(on));
    if (!on) { (from || input).focus({ preventScroll: true }); return; }
    paintMenu();
    const a = (from || srcChip).getBoundingClientRect(), bx = box.getBoundingClientRect();
    srcMenu.style.left = Math.max(8, Math.min(a.left - bx.left, bx.width - srcMenu.offsetWidth - 8)) + 'px'; srcMenu.style.top = (a.bottom - bx.top + 4) + 'px';
    const f = srcMenu.querySelector('[aria-checked="true"]') || srcMenu.querySelector('.stkss-mi'); if (f) f.focus({ preventScroll: true });
  }
  srcChip.addEventListener('click', () => menu(srcMenu.hidden));
  srcMenu.addEventListener('keydown', (e) => {
    const it = [...srcMenu.querySelectorAll('.stkss-mi')], i = it.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); it[(i + (e.key === 'ArrowDown' ? 1 : it.length - 1)) % it.length].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); menu(false, srcChip); }
    else if (e.key === 'Tab') { menu(false); }
  });
  box.addEventListener('pointerdown', (e) => { if (!srcMenu.hidden && !srcMenu.contains(e.target) && !srcChip.contains(e.target) && !e.target.closest('.stkss-acct')) menu(false); });
  let srcGen = 0;
  async function setSource(x) {
    const gen = ++srcGen;
    S.src = x; S.srcData = x ? { rows: [], note: 'Loading ' + x.name + ' symbols…', loading: true } : null;
    S.tab = 'all'; if (x) { S.venue = ''; S.quote = ''; S.products.clear(); }
    paintSrcChip(); buildTabs(); buildRail(); render();
    if (!x) return;
    const P = pool();
    const find = (p, t) => P.byPT.get(p + ':' + String(t).toUpperCase()) || null;
    find.tickers = (p) => P.list.filter((d) => d.provider === p).map((d) => String(d.ticker));
    try { const m = await srcMod(); const r = await m.loadSymbols(x, find); if (gen === srcGen) S.srcData = r; }
    catch (e) { if (gen === srcGen) S.srcData = { rows: [], note: 'Could not load the symbols of ' + x.name + '.' }; }
    if (gen === srcGen && S.open) { buildTabs(); render(); }
  }
  // a broker row as a list entry: the broker's own name; quotes skipped (the broker symbol is not our ticker)
  const srcRowD = (r) => ({ ticker: r.code, description: r.desc, provider: '', type: '', __src: r, __sym: 'src:' + S.src.id + ':' + r.code });
  function srcCompute(q) {
    const D = S.srcData || { rows: [] }, t = q.toUpperCase();
    const hit = (r) => (S.tab === 'all' || r.cls === S.tab) && (!t || r.code.toUpperCase().includes(t) || r.desc.toUpperCase().includes(t));
    const by = new Map();
    if (t) {   // a query: one list, symbol-name matches before description matches
      const rank = (r) => { const c = r.code.toUpperCase(); return c === t ? 0 : c.startsWith(t) ? 1 : c.includes(t) ? 2 : 3; };
      const res = D.rows.filter(hit).map((r) => [rank(r), r]).sort((a, b) => a[0] - b[0]).map((x) => srcRowD(x[1]));
      if (res.length) by.set('Results', res);
    } else for (const r of D.rows.filter(hit)) { if (!by.has(r.cls)) by.set(r.cls, []); by.get(r.cls).push(srcRowD(r)); }
    const groups = [...by.entries()];
    if (t && D.typed && !D.rows.some((r) => r.code.toUpperCase() === t)) { const x = D.typed(t); if (x) groups.unshift(['Open from ' + S.src.name, [srcRowD(x)]]); }
    return { groups, hits: new Map(), msg: '', note: D.note || '', loading: !!D.loading };
  }

  // ---------------- filtering ----------------
  function productOf(d) {
    const m = metaOf(d);
    return m.c === 'futures' ? 'fut' : m.pr && m.pr.perp ? 'perp' : 'spot';
  }
  function passes(d) {
    const m = metaOf(d);
    if (S.tab !== 'all' && m.c !== S.tab) return false;
    if (S.venue && m.v !== S.venue) return false;
    if (S.quote && (!m.pr || m.pr.quote !== S.quote)) return false;
    if (S.products.size && !S.products.has(productOf(d))) return false;
    return true;
  }

  // ratio / spread: our formula provider (charts "formula:ES1!/NQ1!")
  function formulaRow(v) {
    if (!/[+*/()]/.test(v) && !/\s-\s|1!-/.test(v)) return null;
    try { if (normalize && normalize(v, ws.feed)) return null; if (ws.feed.resolveSymbol && ws.feed.resolveSymbol(v)) return null; } catch (e) {}
    const r = parseFormula(bodyOf(v));
    if (!r.ok) return r.hint ? null : { msg: r.message };
    try { resolveLegs(r.symbols, ws.feed, normalize); } catch (e) { return { msg: e.message }; }
    const label = /^[A-Z0-9_.!:]+\/[A-Z0-9_.!:]+$/.test(r.text) ? 'Ratio chart' : 'Spread / formula chart';
    return { row: { ticker: r.text, description: label + ' · candles computed from ' + r.symbols.join(', '), type: 'formula', provider: 'formula', __sym: 'formula:' + r.text, __formula: true } };
  }

  // ---------------- render ----------------
  function compute() {
    const P = pool();
    const q = input.value.trim();
    if (S.src) return srcCompute(q);
    const groups = [];
    if (!q) {
      const seen = new Set();
      const take = (arr) => arr.filter((d) => { const k = keyOf(symFor(d)); if (seen.has(k) || !passes(d)) return false; seen.add(k); return true; });
      const f = take([...favs.values()].map(descOf));
      if (f.length) groups.push(['Favourites', f]);
      seen.clear();   // a recent may also be a favourite; Popular skips both
      f.forEach((d) => seen.add(keyOf(symFor(d))));
      const r = recents.map(descOf).filter(passes);
      r.forEach((d) => seen.add(keyOf(symFor(d))));
      if (r.length) groups.push(['Recent', r]);
      const pop = take(POPULAR.map(([p, t]) => P.byPT.get(p + ':' + t)).filter(Boolean));
      if (pop.length) groups.push(['Popular', pop]);
      const filtered = S.tab !== 'all' || S.venue || S.quote || S.products.size;
      if (filtered || !groups.length) { const rest = take(search(P.list.filter(passes), '', 400).map((x) => x.d)); if (rest.length) groups.push([filtered ? 'All matching' : 'Markets', rest]); }
      return { groups, hits: new Map(), msg: '' };
    }
    const fr = formulaRow(q.toUpperCase());
    if (fr && fr.row) return { groups: [['Ratio / spread', [fr.row]]], hits: new Map(), msg: '' };
    const res = search(P.list.filter(passes), /^[A-Z]{3}\s*\/\s*[A-Z]{3,4}$/i.test(q) ? q.replace(/\s*\/\s*/, '') : q, 300);   // EUR/USD, BTC/USDT
    const hits = new Map(res.map((x) => [x.d, x.hit]));
    return { groups: res.length ? [['Results', res.map((x) => x.d)]] : [], hits, msg: fr && fr.msg ? fr.msg : '' };
  }

  let cur = { groups: [], hits: new Map(), msg: '' };
  function render(fresh) {
    const t0 = performance.now();
    cur = compute();
    S.rows = []; cur.groups.forEach(([, arr]) => arr.forEach((d) => S.rows.push(d)));
    S.hi = 0; S.shown = 0;
    list.replaceChildren();
    if (!fresh) list.scrollTop = 0;   // a just-shown list is already at the top (no forced layout on open)
    clearBtn.hidden = !input.value;
    const q = input.value.trim();
    if (S.src) srcHead(cur); else listHead.replaceChildren(el('h2', { class: 'stkss-lhead-t', text: q ? (S.rows.length ? S.rows.length + (S.rows.length >= 300 ? '+' : '') + ' results' : 'No results') : 'Markets' }));
    if (!S.src && cur.note && S.rows.length) listHead.appendChild(el('p', { class: 'stkss-lhead-n', text: cur.note }));
    if (!S.rows.length) {
      const m = S.src ? (cur.loading ? cur.note : q ? 'No ' + S.src.name + ' symbol matches "' + q + '".' : cur.note || 'No symbols from ' + S.src.name + '.') : cur.msg || (q ? 'No market matches "' + q + '". Try a ticker like NQ, BTC or EURUSD, or clear the filters.' : 'No markets match these filters.');
      list.appendChild(el('div', { class: 'stkss-empty', role: cur.msg ? 'alert' : 'status', text: m }));
      renderSide(null);
    } else grow();
    window.__stkSearchPerf = Object.assign(window.__stkSearchPerf || {}, { render: Math.round((performance.now() - t0) * 10) / 10 });
  }
  function grow() {
    const end = Math.min(S.rows.length, S.shown + PAGE);
    let i = 0;
    const frag = document.createDocumentFragment();
    for (const [title, arr] of cur.groups) {
      for (let j = 0; j < arr.length; j++, i++) {
        if (i < S.shown) continue;
        if (i >= end) break;
        if (j === 0 && cur.groups.length > 1 || j === 0 && title !== 'Results') frag.appendChild(el('div', { class: 'stkss-gh', role: 'presentation', text: title }));
        frag.appendChild(rowEl(arr[j], i));
      }
      if (i >= end) break;
    }
    list.appendChild(frag);
    const first = S.shown === 0;
    S.shown = end;
    if (first) highlight(0, true);
    fetchQuotes();
  }
  list.addEventListener('scroll', () => { if (S.shown < S.rows.length && list.scrollTop + list.clientHeight > list.scrollHeight - 300) grow(); }, { passive: true });

  function hl(text, hit) {
    const f = document.createDocumentFragment();
    if (!hit || !hit.length) { f.appendChild(document.createTextNode(text)); return f; }
    const set = new Set(hit);
    let buf = '', on = false;
    const flush = () => { if (!buf) return; f.appendChild(on ? el('mark', { text: buf }) : document.createTextNode(buf)); buf = ''; };
    for (let i = 0; i < text.length; i++) { const h = set.has(i); if (h !== on) { flush(); on = h; } buf += text[i]; }
    flush();
    return f;
  }
  function statusTag(d, i) {
    if (d.__formula || i >= 12 || !S.open) return null;   // the first rows only: a futures / forex status may measure the feed's lag (one small request per root a minute)
    try {
      const api = window.STRYKER_DATA_DOT; if (!api || !d.provider) return null;
      const st = api.statusOf(d.provider + ':' + d.ticker);
      if (st && st.s === 'rt') return el('span', { class: 'stkss-livedot', role: 'img', 'aria-label': 'Live', 'data-tip': 'Live', title: 'Live' });   // Owner 15 Nov: subtle dot, 'Live' on hover
      if (st && st.s === 'delayed') return el('span', { class: 'stkss-tag stkss-tag-del', text: 'Delayed', title: st.text });
    } catch (e) {}
    return null;
  }
  // broker header: "<Broker> Live …495 ▾" (▾ = switch account / source) and "<n> symbols"; then the column labels
  function srcHead(c) {
    const x = S.src, n = ((S.srcData && S.srcData.rows) || []).length;
    const acct = el('button', { type: 'button', class: 'stkss-acct', 'aria-haspopup': 'menu', 'aria-label': 'Switch account or source' }, [el('span', { text: x.label || 'Switch' }), el('span', { class: 'stkss-acct-ic', html: svg(IC.chev, 16) })]);
    acct.addEventListener('click', () => menu(srcMenu.hidden, acct));
    listHead.replaceChildren(el('div', { class: 'stkss-lhead-r' }, [el('h2', { class: 'stkss-lhead-t', text: x.name }), acct, n ? el('span', { class: 'stkss-lhead-c', text: n + (n === 1 ? ' symbol' : ' symbols') }) : null]),
      S.rows.length ? el('div', { class: 'stkss-cols', 'aria-hidden': 'true' }, [el('span', { text: 'Symbol' }), el('span', { text: 'Description' }), el('span', { text: 'Opens chart' })]) : null);
    if (c.note && S.rows.length) listHead.appendChild(el('p', { class: 'stkss-lhead-n', text: c.note }));
  }
  // a broker row: logo + symbol · description · our chart for it, or "Broker prices" when it charts from the broker's own prices (no prices
  // in the list: the brokers here don't stream them to the search, no made-up numbers)
  const ownPx = (r) => /^byo:CT:/.test(r.sym || '');
  const srcTo = (r) => (r.d ? r.d.ticker : ownPx(r) ? 'Broker prices' : r.sym ? r.sym.replace(/^byo:/, '') : '');
  const srcLogo = (r, size) => { const a = SRCM ? SRCM.iconOf(r) : ['', r.code, r.desc, '']; return symLogo(a[0], a[1], a[2], a[3], size); };
  function srcRowEl(d, i) {
    const r = d.__src, to = srcTo(r);
    const ic = el('span', { class: 'stkss-ic stkss-ic-fx', 'aria-hidden': 'true' }); ic.appendChild(srcLogo(r, 36));
    return el('div', { class: 'stkss-row stkss-row-src', role: 'option', id: 'stkss-o' + i, 'data-i': String(i), 'data-sym': symFor(d), 'data-code': r.code, 'aria-selected': 'false', 'aria-label': r.code + (r.desc ? ', ' + r.desc : '') + ', via ' + S.src.name },
      [el('span', { class: 'stkss-srcsym' }, [ic, el('span', { class: 'stkss-tk', text: r.code })]), el('span', { class: 'stkss-sd', text: r.desc }), el('span', { class: 'stkss-to' + (to ? '' : ' is-none'), text: to || 'No chart yet' })]);
  }
  function rowEl(d, i) {
    if (d.__src) return srcRowEl(d, i);
    const sym = symFor(d), c = d.__formula ? 'formula' : classify(d), v = venueOf(d);
    const star = el('button', { type: 'button', class: 'stkss-star', tabindex: '-1', 'aria-label': 'Favourite ' + d.ticker, 'aria-pressed': String(favs.has(sym)), html: svg(IC.star, 18) });
    if (d.__formula) star.hidden = true;
    const ic = el('span', { class: 'stkss-ic stkss-ic-' + c, 'aria-hidden': 'true' });
    if (d.__formula) ic.innerHTML = svg(IC.ratio, 18); else { ic.classList.add('stkss-ic-fx'); ic.appendChild(symLogo(d.prefix || d.provider, d.ticker, d.description, d.type, 36)); }
    const tk = el('span', { class: 'stkss-tk' }); tk.appendChild(hl(String(d.ticker), cur.hits.get(d)));
    const line1 = el('span', { class: 'stkss-l1' }, [tk, statusTag(d, i)]);
    const tl = d.__formula ? '' : TYPE_LABEL[c] || '', vl = d.__formula ? '' : VENUE_LABEL[v] || (v ? v.toUpperCase() : '');
    const sub = [d.description || '', tl, vl !== tl ? vl : ''].filter(Boolean).join(' · ');
    const l2 = el('span', { class: 'stkss-l2' }, [d.__formula || !v ? null : venueChip(v), el('span', { text: sub })]);
    const txt = el('span', { class: 'stkss-txt' }, [line1, l2]);
    const px = el('span', { class: 'stkss-px', 'data-q': '' });
    const row = el('div', { class: 'stkss-row', role: 'option', id: 'stkss-o' + i, 'data-i': String(i), 'data-sym': sym, 'aria-selected': 'false' }, [star, ic, txt, px]);
    paintQuote(row, d);
    return row;
  }
  function paintStars() { list.querySelectorAll('.stkss-row').forEach((r) => { const b = r.querySelector('.stkss-star'); if (b) b.setAttribute('aria-pressed', String(favs.has(r.dataset.sym))); }); }

  // ---------------- quotes (existing sources only) ----------------
  function spark(vals, up) {
    const w = 64, h = 24, mn = Math.min(...vals), mx = Math.max(...vals), span = mx - mn || 1;
    const pts = vals.map((v, i) => (i * w / (vals.length - 1)).toFixed(1) + ',' + (h - 2 - (v - mn) / span * (h - 4)).toFixed(1)).join(' ');
    return '<svg class="stkss-spark ' + (up ? 'up' : 'dn') + '" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><polyline points="' + pts + '" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  }
  function paintQuote(row, d) {
    const e = quotes.get(symFor(d)), px = row.querySelector('.stkss-px');
    if (!px || !e || !e.q) return;
    const { last, pct, spark: sp } = e.q, up = pct >= 0, dec = decimalsOf(d, last);
    px.innerHTML = (sp.length >= 5 ? spark(sp, up) : '') + '<span class="stkss-pxv"><b>' + last.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + '</b>' +
      (Number.isFinite(pct) ? '<i class="' + (up ? 'up' : 'dn') + '">' + (up ? '+' : '') + pct.toFixed(2) + '%</i>' : '') + '</span>';
  }
  let qTimer = null, qGen = 0;
  function fetchQuotes() {
    clearTimeout(qTimer);
    const gen = ++qGen;
    qTimer = setTimeout(async () => {
      const want = S.rows.slice(0, 12).filter((d) => !d.__formula && QUOTE_PROVIDERS.includes(d.provider) && !(quotes.has(symFor(d)) && Date.now() - quotes.get(symFor(d)).at < 60000));
      const one = async (d) => {
        const sym = symFor(d);
        quotes.set(sym, { at: Date.now(), q: null });
        try {
          const p = ws.feed.providerInstance(d.provider);
          if (!p || typeof p.getBars !== 'function') return;
          const bars = await p.getBars(d.ticker, 'D', { limit: 20 });
          quotes.set(sym, { at: Date.now(), q: quoteOf(bars) });
        } catch (e) { return; }
        if (gen !== qGen && !S.open) return;
        list.querySelectorAll('.stkss-row').forEach((r) => { if (r.dataset.sym === sym) paintQuote(r, S.rows[+r.dataset.i] || d); });
      };
      for (let i = 0; i < want.length; i += 3) { if (gen !== qGen || !S.open) return; await Promise.all(want.slice(i, i + 3).map(one)); }
    }, 220);
  }

  // ---------------- highlight + right pane ----------------
  function highlight(i, noScroll) {
    if (!S.rows.length) return;
    S.hi = Math.max(0, Math.min(S.rows.length - 1, i));
    while (S.hi >= S.shown && S.shown < S.rows.length) grow();
    list.querySelectorAll('.stkss-row[aria-selected="true"]').forEach((r) => r.setAttribute('aria-selected', 'false'));
    const r = list.querySelector('#stkss-o' + S.hi);
    if (r) {
      r.setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', r.id);
      if (!noScroll) {   // the list's own scroll only (no scrollIntoView: it would move other scrollers too)
        const top = r.offsetTop - list.offsetTop, bot = top + r.offsetHeight;
        if (top < list.scrollTop + 28) list.scrollTop = Math.max(0, top - 28);
        else if (bot > list.scrollTop + list.clientHeight) list.scrollTop = bot - list.clientHeight;
      }
    }
    renderSide(S.rows[S.hi]);
  }
  let sideKey = '';
  function renderSide(d) {
    const k = d ? symFor(d) : '';
    if (k === sideKey) return;
    sideKey = k;
    side.replaceChildren();
    if (d && d.__src) return sideSrc(d);
    if (!d || d.__formula) { side.classList.add('is-empty'); if (d) side.appendChild(sideNote('The ratio is drawn as candles from each leg. Pick it to open it on the active chart.')); return; }
    side.classList.remove('is-empty');
    const c = classify(d);
    if (c === 'futures') return sideFutures(d);
    if (c === 'crypto') return sideCrypto(d);
    sideInfo(d);
  }
  const sideNote = (t) => el('p', { class: 'stkss-note', text: t });
  function sideHead(title, sub, extra) { side.appendChild(el('div', { class: 'stkss-shead' }, [el('h3', { class: 'stkss-shead-t', text: title }), el('span', { class: 'stkss-shead-s', text: sub }), extra ? el('span', { class: 'stkss-shead-x', text: extra }) : null])); }
  function sideRow(main, sub, badges, sym, d) {
    const r = el(sym ? 'button' : 'div', sym ? { type: 'button', class: 'stkss-srow', 'data-sym': sym } : { class: 'stkss-srow is-static' }, [
      el('span', { class: 'stkss-srow-t', text: main }),
      el('span', { class: 'stkss-srow-s' }, [el('span', { text: sub })].concat((badges || []).map((b) => el('span', { class: 'stkss-badge' + (b === 'FRONT' ? ' is-front' : ''), text: b }))))
    ]);
    if (sym) r.addEventListener('click', () => pick(d));
    return r;
  }
  function sideFutures(d) {
    const root = String(d.ticker).replace(/1!$/, '').toUpperCase(), ex = VENUE_LABEL[venueOf(d)] || d.prefix || '';
    sideHead(root, ex + ' Futures');
    side.lastChild.insertBefore(venueChip(venueOf(d)), side.lastChild.firstChild);
    const box2 = el('div', { class: 'stkss-slist' });
    box2.appendChild(sideRow(d.ticker, 'Continuous front month · opens on the chart', ['CONT'], symFor(d), d));
    side.appendChild(box2);
    const key = INFO_KEY[root];
    if (!key) { side.appendChild(sideNote('Contract months for this market are not in our contract calendar yet. The chart uses the continuous front month.')); return; }
    const want = sideKey;
    const wait = el('p', { class: 'stkss-note', text: 'Loading contract months…' });
    side.appendChild(wait);
    getInfo().then((data) => {
      if (sideKey !== want) return;
      wait.remove();
      const e = data && data.syms && data.syms[key];
      const roll = e && e.roll || [];
      if (!roll.length) { side.appendChild(sideNote('No contract calendar for this market right now.')); return; }
      side.appendChild(el('h4', { class: 'stkss-sec-h', text: 'Contract months' }));
      const l = el('div', { class: 'stkss-slist' });
      roll.slice(0, 6).forEach((x, i) => {
        const s = String(x.d), code = root + String(x.c).slice(key.length);
        const mon = MON[+s.slice(4, 6) - 1] + ' ' + s.slice(0, 4);
        l.appendChild(sideRow(code, 'Expires ' + (+s.slice(6, 8)) + ' ' + mon, i === 0 ? ['FRONT', 'FUT'] : ['FUT']));
      });
      side.appendChild(l);
      side.appendChild(sideNote('Charts follow the continuous front month (rolls automatically). Individual months are listed for reference.'));
      if (e.tick != null && e.pv != null) side.appendChild(sideNote('Tick ' + e.tick + ' · $' + (e.tick * e.pv).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' per tick' + (root !== key ? ' (' + key + ' contract)' : '') + '.'));
    }, () => { if (sideKey === want) wait.textContent = 'Contract months are unavailable right now.'; });
  }
  function sideCrypto(d) {
    const p = pairOf(d);
    if (!p) return sideInfo(d);
    const same = pool().list.filter((x) => { const m = metaOf(x); return m.c === 'crypto' && m.pr && m.pr.base === p.base; });
    const venues = new Set(same.map(venueOf));
    sideHead(p.base, 'Crypto', venues.size + (venues.size === 1 ? ' venue' : ' venues'));
    same.sort((a, b) => VENUE_ORDER.indexOf(venueOf(a)) - VENUE_ORDER.indexOf(venueOf(b)) || (pairOf(a).perp - pairOf(b).perp));
    const l = el('div', { class: 'stkss-slist' });
    same.slice(0, 24).forEach((x) => { const q = pairOf(x); l.appendChild(sideRow(x.ticker, (VENUE_LABEL[venueOf(x)] || venueOf(x)) + ' · ' + q.base + '/' + q.quote, [q.perp ? 'PERP' : 'SPOT'], symFor(x), x)); });
    side.appendChild(l);
    if (same.length > 24) side.appendChild(sideNote('Showing 24 of ' + same.length + '. Type a venue (for example "okx:' + p.base + '") to narrow it down.'));
  }
  function sideSrc(d) {
    const r = d.__src, src = S.src, want = sideKey; side.classList.remove('is-empty');
    side.appendChild(el('div', { class: 'stkss-shead stkss-shead-src' }, [el('div', { class: 'stkss-shead-row' }, [srcLogo(r, 40), el('h3', { class: 'stkss-shead-t', text: r.code })]), el('span', { class: 'stkss-shead-s', text: r.desc || 'via ' + src.name }), el('span', { class: 'stkss-tag stkss-tag-via', text: 'via ' + src.name + (src.label ? ' · ' + src.label : '') })]));
    if (src.kind === 'ct') {   // the broker's spec (read-only SymbolById); rows we don't have are left out
      const kv = el('dl', { class: 'stkss-kv', 'aria-busy': 'true' }); side.appendChild(kv);
      (async () => { let rows = []; try { const lv = window.__stkLive, m = await srcMod(), sp = lv && lv.srcSpec ? await lv.srcSpec(src.id, r.code) : null; rows = m.specRows(sp); } catch (e) { rows = []; }
        if (sideKey !== want) return; kv.removeAttribute('aria-busy'); if (!rows.length) { kv.remove(); return; }
        for (const [k, v] of rows) kv.append(el('div', { class: 'stkss-kv-r' }, [el('dt', { text: k }), el('dd', { text: v })])); })();
    }
    const target = r.d || (ownPx(r) ? { ticker: r.code, description: 'prices from ' + src.name, __sym: r.sym } : r.sym ? { ticker: r.sym.replace(/^byo:/, ''), description: '', __sym: r.sym } : null);
    if (!target) { side.appendChild(el('p', { class: 'stkss-note stkss-note-x', role: 'status', text: 'Charting for ' + r.code + ' isn’t available yet.' })); return; }
    const l = el('div', { class: 'stkss-slist' });
    l.appendChild(sideRow(target.ticker, 'Open on the active chart' + (target.description ? ' · ' + target.description : ''), [], symFor(d), d));
    side.appendChild(el('h3', { class: 'stkss-sec-h', text: 'Chart' })); side.appendChild(l);
    if (ownPx(r)) side.appendChild(sideNote('No TradeZoro chart for ' + r.code + ', so it charts from your ' + src.name + ' account\u2019s own prices while it is connected.'));
    else if (r.key && (S.src.kind === 'ct' || S.src.kind === 'mt')) side.appendChild(sideNote('Trading on this chart uses ' + r.code + ' on this account.'));
    else if (S.src.kind === 'byo') side.appendChild(sideNote('Prices come from your ' + S.src.name + ' feed while it is connected.'));
  }
  function sideInfo(d) {
    const c = classify(d), v = venueOf(d);
    sideHead(d.ticker, (TYPE_LABEL[c] || '') + (v ? ' · ' + (VENUE_LABEL[v] || v.toUpperCase()) : ''));
    if (d.description) side.appendChild(sideNote(d.description));
    const l = el('div', { class: 'stkss-slist' });
    l.appendChild(sideRow(d.ticker, 'Open on the active chart', [], symFor(d), d));
    side.appendChild(l);
  }

  // ---------------- open / pick / close ----------------
  function pick(d) {
    if (!d) return;
    if (d.__src) return pickSrc(d);
    const sym = symFor(d);
    if (!d.__formula) addRecent(d);
    close();
    try { ws.active.setSymbol(sym); } catch (e) { console.warn('TradeZoro search: open', e); if (o.toast) o.toast('Could not open ' + d.ticker + '.', 'error'); }
  }
  // a broker / feed symbol: OUR chart for the same instrument, and the broker symbol remembered for that account (trading needs no pick)
  async function pickSrc(d) {
    const r = d.__src, src = S.src, target = r.d ? symOf(r.d) : r.sym;
    if (!target) { renderSide(d); if (o.toast) o.toast('Charting for ' + r.code + ' isn’t available yet.', 'info'); return; }
    try { const m = await srcMod(); m.remember(src, r); } catch (e) {}
    if (ownPx(r)) { try { const lv = window.__stkLive; if (lv && lv.ctFeed) await lv.ctFeed(); } catch (e) {} }   // the account's feed is registered before the chart asks
    if (r.d) addRecent(r.d);
    close();
    try { ws.active.setSymbol(target); } catch (e) { console.warn('TradeZoro search: open', e); if (o.toast) o.toast('Could not open ' + r.code + '.', 'error'); }
  }
  function open(seed) {
    const t0 = performance.now();
    if (!S.open) {
      S.open = true;
      S.lastFocus = document.activeElement;
      try { for (const c of ws.cells()) c.chart.renderer.closeDialogs(); } catch (e) {}
      try { ws.trackDialog && ws.trackDialog(true); } catch (e) {}
      root.hidden = false;
      root.classList.toggle('is-phone', isPhone());
      setFilters(false);
      S.venue = ''; S.quote = ''; S.products.clear(); S.src = null; S.srcData = null; S.tab = S.tab === 'all' || TABS.some(([id]) => id === S.tab) ? S.tab : 'all'; paintSrcChip(); menu(false);   // refine filters are per visit (a hidden filter must never hide a market next time)
      input.value = seed ? String(seed).toUpperCase() : '';
      buildTabs(); buildRail();
      sideKey = null;
      render(true);
      refreshSources();   // first open loads assets/chart-search-sources.js; later opens re-read the member's connections
      favUid = undefined; loadFavs();   // re-read each open: a star added on another device shows
      requestAnimationFrame(() => root.classList.add('is-in'));
    } else if (seed) { input.value = (input.value + seed).toUpperCase(); render(); }
    input.focus({ preventScroll: true });
    const n = input.value.length; try { input.setSelectionRange(n, n); } catch (e) {}
    window.__stkSearchPerf = Object.assign(window.__stkSearchPerf || {}, { open: Math.round((performance.now() - t0) * 10) / 10 });
    // open -> first frame painted (style + layout included)
    requestAnimationFrame(() => setTimeout(() => { window.__stkSearchPerf.paint = Math.round((performance.now() - t0) * 10) / 10; }, 0));
  }
  // Symbol lists land late (crypto venues after the first candles, stocks from the server search): repaint while open
  // when the pool grows, unless the member has already moved down the list.
  setInterval(() => {
    if (!S.open || S.hi > 0 || list.scrollTop > 0) return;
    const k = poolCache.key; pool();
    if (poolCache.key !== k) { buildTabs(); buildRail(); render(); }
  }, 1000);
  function close() {
    if (!S.open) return;
    S.open = false; qGen++;
    root.classList.remove('is-in');
    root.hidden = true;
    input.blur();
    try { ws.trackDialog && ws.trackDialog(false); } catch (e) {}
    const f = S.lastFocus; S.lastFocus = null;
    try { if (f && f.focus && document.contains(f)) f.focus({ preventScroll: true }); } catch (e) {}
  }

  // ---------------- events ----------------
  let typeT = 0;
  input.addEventListener('input', () => {
    const v = input.value, up = v.toUpperCase();
    if (v !== up) { const a = input.selectionStart, b = input.selectionEnd; input.value = up; try { input.setSelectionRange(a, b); } catch (e) {} }
    const t0 = performance.now();
    render();
    typeT = performance.now() - t0;
    window.__stkSearchPerf = Object.assign(window.__stkSearchPerf || {}, { key: Math.round(typeT * 10) / 10, keyMax: Math.max((window.__stkSearchPerf || {}).keyMax || 0, Math.round(typeT * 10) / 10) });
  });
  clearBtn.addEventListener('click', () => { input.value = ''; render(); input.focus(); });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (S.filters && isPhone()) setFilters(false); else close();
      return;
    }
    if (e.target === input || e.target === box) {
      if (e.key === 'ArrowDown') { e.preventDefault(); highlight(S.hi + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(S.hi - 1); }
      else if (e.key === 'PageDown') { e.preventDefault(); highlight(S.hi + 8); }
      else if (e.key === 'PageUp') { e.preventDefault(); highlight(S.hi - 8); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(S.rows[S.hi]); }
    }
    if (e.key === 'Tab') {   // keep focus inside the dialog
      const f = [...box.querySelectorAll('button:not([tabindex="-1"]), input, select')].filter((x) => x.getClientRects().length && !x.disabled);
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
    e.stopPropagation();   // the chart's own shortcuts never see keys typed here
  });
  list.addEventListener('click', (e) => {
    const r = e.target.closest('.stkss-row'); if (!r) return;
    const d = S.rows[+r.dataset.i]; if (!d) return;
    if (e.target.closest('.stkss-star')) { toggleFav(d); input.focus({ preventScroll: true }); return; }
    pick(d);
  });
  list.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const r = e.target.closest('.stkss-row');
    if (r && +r.dataset.i !== S.hi) highlight(+r.dataset.i, true);
  });
  scrim.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  // Ctrl+K / Cmd+K / "/" from anywhere on the chart page (capture: before the chart's own keymap)
  window.addEventListener('keydown', (e) => {
    const k = String(e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && k === 'k') {
      e.preventDefault(); e.stopPropagation();
      if (S.open) { input.focus(); input.select(); } else open('');
      return;
    }
    if (k === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !S.open && !editable(e.target) && !(ws.openDialogs > 0)) {
      e.preventDefault(); e.stopPropagation(); open('');
    }
  }, true);
  window.addEventListener('resize', () => { if (S.open) { root.classList.toggle('is-phone', isPhone()); paintSrcChip(); menu(false); } }, { passive: true });

  // ---------------- take over the header picker ----------------
  const orig = { open: sp.open, type: sp.type, close: sp.close };
  sp.open = (q) => open(q || '');
  sp.type = (t) => open(t || '');
  sp.close = () => { close(); try { orig.close.call(sp); } catch (e) {} };
  try { Object.defineProperty(sp, 'isOpen', { configurable: true, get: () => S.open }); } catch (e) {}

  // pre-warm: the pool index at idle so the first open is instant
  // pre-warm the pool index at idle, and again once the late crypto lists land, so an open never pays for it
  // The first open also paid ~60 ms of style + layout for the new panel DOM; one invisible layout pass at idle takes it.
  let ghosted = false;
  const ghost = () => {
    if (S.open || ghosted) return;
    ghosted = true;
    root.classList.add('stkss-ghost'); root.hidden = false;
    try { buildTabs(); buildRail(); render(true); void box.offsetHeight; } catch (e) {}
    root.hidden = true; root.classList.remove('stkss-ghost');
  };
  const warm = () => (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(() => { try { if (!S.open) { pool(); ghost(); } } catch (e) {} }, { timeout: 3000 });
  warm(); setTimeout(warm, 8000); setTimeout(warm, 25000);

  const api = { open, close, isOpen: () => S.open, pick, setSource, sources: () => S.srcs, toggleFav, favs: () => [...favs.keys()], recents: () => recents.map((x) => x.s), root };
  window.__stkSearch = api;
  return api;
}
