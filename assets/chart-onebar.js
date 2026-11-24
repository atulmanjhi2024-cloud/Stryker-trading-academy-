// TradeZoro — Charts single toolbar (ES module, charts.html only)
// Owner order 2026-10-14: "combine the two menus, taking space of chart".
//
// Before: two bars. Ours (#stkc-bar: layout, grid, Templates, Pine | Replay, Trade, Connect
// broker, price alerts, settings, Credits) and Vela's own .vela-widget-topbar inside the chart
// (symbol, intervals, chart style, Indicators, undo/redo | alert log, data window, object tree,
// screenshot). After: on a desktop-mode chart Vela's bar ELEMENT is moved into #stkc-bar, so the
// chart grid gets the height of the second row.
//
// Nothing is rebuilt: every button keeps its node, id, listeners, test hooks and shortcuts.
//   - The moved bar, .stkc-bar-l and .stkc-bar-r are display:contents in merged mode
//     (style.css, #stkc-bar.stkc-onebar), and each item gets a CSS `order`: symbol, intervals,
//     style, Indicators, undo/redo, then our layout group; right: Replay, Trade, Connect broker,
//     price alerts + Vela's alert log side by side (both kept: one opens the price-alert manager,
//     the other Vela's log of fired alerts), data window, object tree, screenshot, settings,
//     Credits, ⋯ More.
//   - Vela's colour tokens are inline custom properties on its root (.vela-ui); they are copied
//     onto the moved bar and the More menu, and re-copied when the root's style changes (theme).
//   - Vela routes plain typing (letter = symbol search, digit = interval) from its root's keydown;
//     keys pressed while focus is on a moved Vela button are forwarded to the same router.
//   - When Vela flips to its phone layout (data-layout="mobile": narrow, or a touch tablet) the
//     bar goes back to its original spot, where Vela hides it in favour of its bottom bar, and
//     #stkc-bar is the phone row it was before.
//
// Fitting (both modes): never wraps, never clips. While the items are wider than the bar, steps
// apply in this order (Owner: layout/Templates/info first, then Replay/Trade labels): Credits,
// Templates, layout menu, grid button -> ⋯ More; Replay / Trade / Connect broker labels hidden;
// interval chips collapse to the active one (chart-intervals.js listens for "stkc:onebar-fit");
// then data window / object tree, screenshot, Connect broker, Pine, settings -> ⋯ More.
// Every pass starts from scratch: moved items return to their exact spot (comment placeholder).
//
// TRADINGVIEW LAYOUT (Owner order 2026-10-14, part 2, "same as tradingview", inspired not copied):
// left  symbol | intervals | chart type | Indicators, Templates, Pine | Alert, Replay | undo, redo;
// right layout name | grid | settings, fullscreen, screenshot | Trade, Connect broker | info, ⋯.
// Vela's alert log, data window and object tree moved to the right icon bar (chart-tv-toolbars.js).
// Phone: Vela's bottom bar becomes the start of this one top row (symbol, interval, Indicators,
// drawing pencil); the rest folds into ⋯ More.
//
// Depends on: vela-chart.js (ws = VelaWorkspace: ws.root, ws.topbar.el, ws.layoutCtl,
// ws.routeTyping), style.css (.stkc-onebar / .stkc-ob-* block), chart-intervals.js (fit event).

const byId = (id) => document.getElementById(id);
function menuOf(id){
  const b = byId(id);
  return b && b.parentElement && b.parentElement.classList.contains('stkc-menu') ? b.parentElement : b;
}
const q = (s) => document.querySelector('#stkc-bar ' + s);

// [kind, arg]: 'more' moves the nodes into ⋯ More, 'cls' adds a class to the bar.
// TradingView-style order (Owner order 2026-10-14 part 2): extras first, then labels, then chips,
// then the right-side icons; on the phone row (Vela's bar moved in, see mergePhone) the last steps
// leave symbol, interval, Indicators, the pencil and ⋯.
const STEPS = [
  ['more', () => [byId('stkc-ai-btn')]],
  ['more', () => [byId('stkc-credits-btn'), byId('stkc-credits')]],
  ['more', () => [menuOf('stkc-tpl-btn')]],
  ['more', () => [byId('stkc-pine-btn')]],
  ['more', () => [byId('stkc-fs-btn')]],
  ['more', () => [menuOf('stkl-btn')]],
  ['more', () => [menuOf('stkc-layout-btn')]],
  ['cls', 'stkc-ob-nolabel'],
  ['cls', 'stkc-ob-ivn'],
  ['more', () => [q('.vela-widget-screenshot')]],
  ['more', () => [byId('stkrb-chip')]],
  ['more', () => [byId('stkc-settings-btn')]],
  ['more', () => [q('.vela-mb-maximize')]],
  ['more', () => [q('.stknw-phonebtn')]],
  ['more', () => [q('.stkgl-phonebtn')]],
  ['more', () => [q('.stkl2-phonebtn')]],
  ['more', () => [q('.stkw-phonebtn')]],
  ['more', () => [q('.stkdkp-phonebtn')]],
  ['more', () => [q('.stkph-phonebtn')]],
  ['more', () => [q('.stkin-phonebtn')]],
  ['more', () => [menuOf('byo-btn')]],
  ['more', () => [byId('stkc-heatmap-btn')]],
  ['more', () => [byId('stkc-alerts-btn')]],
  ['more', () => [q('.stkr-menu'), q('.stkr-badge')]],
  ['more', () => [q('.vela-widget-undo'), q('.vela-widget-redo')]],
  ['more', () => [q('.vela-mb-more')]],
  ['more', () => [menuOf('stkc-paper-btn')]]
];
// Thin dividers between the TradingView groups (CSS `order` puts each in place; style.css).
// A divider with no visible item on one side (its group went to ⋯ More) is switched off by fit().
const DIVIDERS = [-1, 2, 4, 6, 9, 12, 21, 23, 27, 31];
const CLASSES = STEPS.filter((s) => s[0] === 'cls').map((s) => s[1]);

// PHONE ⋯ LIST (Owner 2026-10-26: "Fix this chart extra menu in mobile. Add appropriate text and
// align properly"). On the phone row (not merged) ⋯ More is a clean list: every row = a 20 px icon
// in a fixed 24 px column + a text label, one left edge, 44 px rows, grouped Chart / Tools / Panels
// under thin dividers; it fits the screen and scrolls when taller. The moved node keeps its own
// button (listeners, popover, ids); only its look changes, through data-ob-* attributes + CSS
// (style.css, .stkc-ob-list) that are removed again when it goes back to the bar. Desktop's ⋯ More
// (merged bar) is not touched.
// [match(node) -> trigger, group, order, label(trigger), icon]
const IC = {
  layout: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9h17"/>',
  ws: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9h17M9 9v10.5"/>',
  grid: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M12 3.5v17M3.5 12h17"/>',
  tpl: '<path d="M6 4h12v16l-6-4-6 4z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  heat: '<rect x="3.5" y="3.5" width="5" height="5"/><rect x="9.5" y="9.5" width="5" height="5"/><rect x="15.5" y="15.5" width="5" height="5"/><rect x="15.5" y="3.5" width="5" height="5"/><rect x="3.5" y="15.5" width="5" height="5"/>',
  fs: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  fsOff: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  max: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
  dots: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  replay: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M10 9l5 3-5 3z"/>',
  alarm: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M4 4.5 6.5 2.5M20 4.5 17.5 2.5"/>',
  pine: '<path d="M12 2.5 6.5 9h3L5 15h4.5L5.5 20h13L14.5 15H19l-4.5-6h3z"/><path d="M12 20v2"/>',
  link: '<path d="M9 7H7a5 5 0 0 0 0 10h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  shot: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  trade: '<path d="M4 17l5-5 4 4 7-8"/><path d="M15 8h5v5"/>',
  news: '<path d="M4 5h13v14H6a2 2 0 0 1-2-2z"/><path d="M17 9h3v8a2 2 0 0 1-2 2"/><path d="M7.5 9h6M7.5 12.5h6M7.5 16h4"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  ladder: '<path d="M7 3v18M17 3v18M7 7h10M7 12h10M7 17h10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  wallet: '<rect x="3.5" y="6" width="17" height="13" rx="2"/><path d="M3.5 10h17M16 14.5h1.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  dot: '<circle cx="12" cy="12" r="5" fill="#000"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  spark: '<path d="M3 17l5-6 4 3 5-8 4 5"/>',
  ai: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>'
};
const trig = (n) => (n.classList.contains('stkc-menu') ? n.querySelector(':scope > button') : n);
const txt = (e) => (e ? e.textContent.trim() : '');
// [match(node) -> trigger, group, order, label(trigger), icon, state(trigger)?]
// PHONE ⋯ SHEET CATEGORIES (Owner bug 2026-11-23 "arrange it neatly with proper categorisation"): Chart /
// Indicators & scripts / Trading / View / Panels / Share & alerts. state() = the row's current state on its right.
const ROWS = [
  // CHART
  [(n) => n.classList.contains('vela-mb-more') && n, 'chart', 0, () => 'Chart type & options', 'dots'],
  [(n) => n.classList.contains('vela-mb-drawings') && n, 'chart', 0.5, () => 'Drawings', 'pen'],
  [(n) => n.classList.contains('stkws-menu') && trig(n), 'chart', 1, () => 'Workspace', 'ws', (t) => txt(t.querySelector('.stkws-name')) || 'Workspace 1'],
  [(n) => n.classList.contains('stkl-menu') && trig(n), 'chart', 2, () => 'Layout', 'layout', (t) => (txt(t.querySelector('.stkl-name')) || txt(t)).replace(/^Viewing:\s*/, '') || 'Unsaved'],
  [(n) => n.querySelector && n.querySelector(':scope > #stkc-layout-btn'), 'chart', 3, () => 'Charts in layout', 'grid', (t) => { const m = /(\d+)/.exec(txt(t.querySelector('.stkc-btn-l') || t)); return m ? m[1] : '1'; }],
  [(n) => n.querySelector && n.querySelector(':scope > #stkc-tpl-btn'), 'chart', 4, () => 'Templates', 'tpl'],
  [(n) => n.id === 'stkc-settings-btn' && n, 'chart', 5, () => 'Chart settings', 'gear'],
  [(n) => n.classList.contains('vela-widget-undo') && n, 'chart', 6, () => 'Undo', 'undo'],
  [(n) => n.classList.contains('vela-widget-redo') && n, 'chart', 7, () => 'Redo', 'redo'],
  // INDICATORS & SCRIPTS
  [(n) => n.classList.contains('vela-mb-indicators') && n, 'scripts', 10, () => 'Indicators', 'spark'],
  [(n) => n.id === 'stkc-pine-btn' && n, 'scripts', 11, () => 'Script editor', 'pine'],
  [(n) => n.id === 'stkc-ai-btn' && n, 'scripts', 12, () => 'Connect your AI', 'ai'],
  // TRADING
  [(n) => n.querySelector && n.querySelector(':scope > #stkc-paper-btn'), 'trading', 20, () => 'Trade', 'trade', () => { const P = window.__stkPaper; return P && P.live ? 'Live' : P && P.enabled ? 'Paper' : ''; }],
  [(n) => n.id === 'stkas' && n.querySelector('.stkas-b'), 'trading', 21, () => 'Account', 'wallet', (t) => txt(t.querySelector('[data-k="bal"] .stkas-f'))],
  // VIEW
  [(n) => n.querySelector && n.querySelector(':scope > #byo-btn'), 'view', 30.5, () => 'Data source', 'link'],
  [(n) => n.id === 'mclock' && n.querySelector('.mclock-pill'), 'view', 31, () => 'Market sessions', 'clock', (t) => txt(t.querySelector('.mclock-shead'))],
  [(n) => n.id === 'stkc-hideprice-btn' && n, 'view', 32, () => 'Price candles', 'eye', (t) => (t.getAttribute('aria-pressed') === 'true' ? 'Hidden' : 'Shown')],
  [(n) => n.id === 'stkc-heatmap-btn' && n, 'view', 33, () => 'Heatmap', 'heat'],
  [(n) => n.id === 'stkc-fs-btn' && n, 'view', 34, () => (document.documentElement.classList.contains('stk-chart-fs') ? 'Exit full screen' : 'Full screen'), 'fs'],
  [(n) => n.classList.contains('vela-mb-maximize') && n, 'view', 35, () => 'Maximize / restore chart', 'max'],
  // PANELS
  [(n) => n.classList.contains('stkw-phonebtn') && n, 'panels', 41, () => 'Watchlist', 'list'],
  [(n) => n.classList.contains('stknw-phonebtn') && n, 'panels', 42, () => 'News', 'news'],
  [(n) => n.classList.contains('stkgl-phonebtn') && n, 'panels', 43, () => 'GEX Ladder', 'ladder'],
  [(n) => n.classList.contains('stkl2-phonebtn') && n, 'panels', 44, () => 'Book · DOM · Trades', 'ladder'],
  [(n) => n.classList.contains('stkdkp-phonebtn') && n, 'panels', 45, () => 'Dark pool prints', 'ladder'],
  [(n) => n.classList.contains('stkph-phonebtn') && n, 'panels', 46, () => 'Phantom options flow', 'trade'],
  [(n) => n.classList.contains('stksp-phonebtn') && n, 'panels', 47, () => 'Spectra', 'heat'],
  [(n) => n.classList.contains('stkin-phonebtn') && n, 'panels', 48, () => 'Symbol info', 'info'],
  [(n) => n.id === 'stkc-credits-btn' && n, 'panels', 49, () => 'Data source & credits', 'info'],
  // SHARE & ALERTS
  [(n) => n.id === 'stkc-alerts-btn' && n, 'share', 51, () => 'Price alerts', 'alarm'],
  [(n) => n.classList.contains('stkr-menu') && trig(n), 'share', 52, () => 'Replay', 'replay'],
  [(n) => n.classList.contains('vela-widget-screenshot') && n, 'share', 53, () => 'Snapshot', 'shot']
];
const GROUP_ORDER = { chart: -0.5, scripts: 9.5, trading: 19.5, view: 29.5, panels: 39.5, share: 49.5 };
const GROUP_LABEL = { chart: 'Chart', scripts: 'Indicators & scripts', trading: 'Trading', view: 'View', panels: 'Panels', share: 'Share & alerts' };
// Phone sheet only: rows that are not a toolbar button. [id, group, order, label, icon, state, run]
const DOT = { rt: '#089981', delayed: '#F5A623', closed: '#787B86', replay: '#787B86' };
const EXTRA = [
  ['stkc-ob-data', 'view', 30, () => 'Market data', 'dot', () => { const d = dataStatus(); return d ? (d.s === 'rt' ? 'Live data' : d.s === 'delayed' ? 'Delayed data' : d.tag) : ''; },
    () => { const b = document.querySelector('.stkin-phonebtn'); if (b) b.click(); }],
  ['stkc-ob-theme', 'view', 36, () => 'Theme', 'moon', () => (document.documentElement.getAttribute('data-theme') === 'light' ? 'Light' : 'Dark'),
    () => { if (window.toggleStrykerTheme) window.toggleStrykerTheme(); }]
];
function dataStatus(){
  try { const D = window.STRYKER_DATA_DOT, V = window.STRYKER_VELA; return D && V && V.active ? D.statusOf(V.active.symbol) : null; } catch (e) { return null; }
}
// CSS `order` takes integers only (4.5 was ignored): the list orders are doubled
const ord2 = (o) => Math.round(o * 2);
const icUrl = (k) => 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + IC[k] + '</svg>') + '")';

export function mountOneBar(ws){
  const bar = byId('stkc-bar');
  const barL = byId('stkc-bar-l');
  const barR = bar && bar.querySelector('.stkc-bar-r');
  const tb = ws && ws.topbar && ws.topbar.el;
  const root = ws && ws.root;
  if (!bar || !barL || !barR || !tb || !root) return null;

  const home = document.createComment('vela topbar home');
  tb.parentNode.insertBefore(home, tb);

  const spacer = document.createElement('span');
  spacer.className = 'stkc-ob-sp';
  spacer.setAttribute('aria-hidden', 'true');
  const divs = DIVIDERS.map((o) => {
    const d = document.createElement('span');
    d.className = 'stkc-tv-div';
    d.setAttribute('aria-hidden', 'true');
    d.style.order = String(o);
    bar.appendChild(d);
    return d;
  });

  // Phone (Vela's mobile layout): Vela's bottom bar (symbol, interval, Indicators, the drawing
  // pencil, ⋯ chart menu, maximize, settings) moves to the START of #stkc-bar, so the phone has
  // ONE slim top row like TradingView's app and the chart gets the bottom bar's height.
  const mb = (ws.mobileBar && ws.mobileBar.el) || root.querySelector('.vela-mobilebar');
  const mbHome = mb ? document.createComment('vela mobilebar home') : null;
  if (mb) mb.parentNode.insertBefore(mbHome, mb);

  // ⋯ More
  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'stkc-ib stkc-ob-more-btn';
  moreBtn.id = 'stkc-more-btn';
  moreBtn.title = 'More tools and chart options';
  moreBtn.setAttribute('aria-label', 'More toolbar items');
  moreBtn.setAttribute('aria-haspopup', 'true');
  moreBtn.setAttribute('aria-expanded', 'false');
  moreBtn.setAttribute('aria-controls', 'stkc-more-pop');
  moreBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
  const morePop = document.createElement('div');
  // Not .stkc-pop: the Connect-broker button closes every .stkc-pop when it opens its own, and
  // that must not close the menu it sits in.
  morePop.className = 'stkc-ob-pop';
  morePop.id = 'stkc-more-pop';
  morePop.setAttribute('role', 'group');
  morePop.setAttribute('aria-label', 'More toolbar items');
  morePop.hidden = true;
  // group headings for the phone list (hidden in the desktop ⋯ More)
  const heads = {};
  Object.keys(GROUP_LABEL).forEach((g) => {
    const h = document.createElement('div');
    h.className = 'stkc-ob-gh';
    h.setAttribute('role', 'presentation');
    h.textContent = GROUP_LABEL[g];
    h.style.order = String(ord2(GROUP_ORDER[g]));
    h.hidden = true;
    heads[g] = h;
    morePop.appendChild(h);
  });
  // phone list: while a menu opened from it is showing, the list itself steps back (style.css .stkc-ob-sub)
  const subOpen = () => !!morePop.querySelector('.stkc-pop:not([hidden]), #stkc-credits:not([hidden]), .mclock-pop:not([hidden]), .stkas-pop:not([hidden])');
  new MutationObserver(() => {
    const was = morePop.classList.contains('stkc-ob-sub'), now = !merged && !morePop.hidden && subOpen();
    morePop.classList.toggle('stkc-ob-sub', now);
    if (strict) scrim.hidden = morePop.hidden || now;   // a sub-menu shown from ⋯ has its own scrim: ours would cover it (dim, taps dead)
    if (was && !now && !morePop.hidden && strict) setMore(false);   // a sheet opened from the phone list closes back to the chart
  }).observe(morePop, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  // phone list: a tap on a heading or the sheet's padding keeps it open (only rows act)
  morePop.addEventListener('click', (e) => { if (strict && !(e.target.closest && e.target.closest('[data-ob-trig], .stkc-pop, #stkc-credits, .mclock-pop, .stkas-pop'))) e.stopPropagation(); });
  // phone list: a row that does its job in place (opens a sheet / panel / editor, toggles full
  // screen) closes the list, even when its button stops the click; a row that opens a menu inside
  // the list (Templates, Layout, Charts in layout, Replay, Credits) keeps it, as the sub-menu
  morePop.addEventListener('click', (e) => {
    if (merged || !e.target.closest || !e.target.closest('[data-ob-trig]')) return;
    setTimeout(() => { if (!morePop.hidden && !subOpen()) setMore(false); }, 0);
  }, true);
  const more = document.createElement('div');
  more.className = 'stkc-menu stkc-ob-more';
  more.hidden = true;
  // phone sheet scrim: dims the page and catches the outside tap (only while the phone list is open)
  const scrim = document.createElement('div');
  scrim.className = 'stkc-ob-scrim';
  scrim.hidden = true;
  scrim.addEventListener('click', (e) => { e.stopPropagation(); setMore(false); });
  more.append(moreBtn, scrim, morePop);
  const setMore = (open, keep) => {
    // phone list: room from just under the toolbar to the bottom of the screen; taller lists scroll
    if (open && !merged) {
      const b = bar.getBoundingClientRect().bottom;
      // just under the toolbar (never over it), whatever the ⋯ button's height
      morePop.style.top = Math.ceil(b - more.getBoundingClientRect().top + 4) + 'px';
      morePop.style.setProperty('--ob-maxh', Math.max(160, Math.floor(window.innerHeight - b - 14)) + 'px');
      if (!keep) morePop.scrollTop = 0;
    } else if (merged) morePop.style.removeProperty('top');
    if (!open) morePop.classList.remove('stkc-ob-sub');
    morePop.hidden = !open; moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    scrim.hidden = !(open && strict);
    bar.classList.toggle('stkc-ob-up', !!(open && strict));   // the bar is a z 40 stacking context: lift it over open panels while its sheet shows
    if (open && strict) refreshStates();
    if (open) { const n = document.getElementById('notif-panel'); if (n) n.style.display = 'none'; }   // one menu at a time
    else if (late) { late = false; queue(); }
  };
  moreBtn.addEventListener('click', (e) => { e.stopPropagation(); setMore(morePop.hidden); });
  // Items that open their own popover (Templates, Credits, grid, layout menu) stop the click's
  // propagation, so More stays open around them; any other click (an action, or outside) closes it.
  document.addEventListener('click', () => { if (!morePop.hidden) setMore(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !morePop.hidden) setMore(false); });
  // the bell stops its click, so it never reaches the handler above: close the sheet here (one menu at a time)
  document.addEventListener('click', (e) => { if (!morePop.hidden && e.target.closest && e.target.closest('#notif-bell-btn')) setMore(false); }, true);

  barR.insertBefore(spacer, barR.firstChild);
  barR.appendChild(more);

  // tokens + font from Vela's root
  const copyTokens = () => {
    const st = root.style;
    let font = '';
    try { font = getComputedStyle(root).fontFamily; } catch (e) {}
    [tb, morePop, mb].filter(Boolean).forEach((n) => {
      for (let i = 0; i < st.length; i++) {
        const k = st[i];
        if (k.startsWith('--vela')) n.style.setProperty(k, st.getPropertyValue(k));
      }
    });
    if (font) tb.style.fontFamily = font;
  };
  new MutationObserver(() => { if (merged) copyTokens(); }).observe(root, { attributes: true, attributeFilter: ['style', 'class'] });

  // plain typing on a moved Vela button -> Vela's router (symbol search / interval)
  const route = (ev) => {
    if (!merged || root.contains(ev.target)) return;
    if (!ev.target.closest || !ev.target.closest('.vela-widget-topbar, [data-ob-vela]')) return;
    try { if (typeof ws.routeTyping === 'function') ws.routeTyping(ev); } catch (e) {}
  };
  tb.addEventListener('keydown', route);
  morePop.addEventListener('keydown', route);

  let merged = false, strict = false;
  const moved = [];   // [{ node, ph }]
  const extras = [];  // phone-only sheet rows (data status, theme)

  function restoreMoved(){
    while (moved.length) {
      const m = moved.pop();
      if (m.ph.parentNode) m.ph.parentNode.replaceChild(m.node, m.ph);
      m.node.removeAttribute('data-ob-more');
      m.node.removeAttribute('data-ob-vela');
      unlist(m.node);
    }
    extras.forEach((b) => b.remove());
    extras.length = 0;
    // a panel button added later next to a sibling that sat in the list landed in the list with no home: back to the bar
    [...morePop.children].forEach((c) => { if (!c.classList.contains('stkc-ob-gh')) barR.insertBefore(c, more); });
    // chart-paper.js keeps the account strip right before the session clock; with the clock in ⋯ the strip may have followed it
    const sa = byId('stkas'), mc = byId('mclock');
    if (sa && morePop.contains(sa)) { if (mc && mc.parentNode && !morePop.contains(mc)) mc.parentNode.insertBefore(sa, mc); else barR.insertBefore(sa, more); }
    Object.values(heads).forEach((h) => { h.hidden = true; });
    morePop.classList.remove('stkc-ob-list');
  }
  function unlist(n){
    n.removeAttribute('data-ob-row');
    n.style.removeProperty('order');
    const t = n.__obTrig;
    if (t) { t.removeAttribute('data-ob-trig'); t.removeAttribute('data-ob-label'); t.style.removeProperty('--ob-ic'); n.__obTrig = null; }
    if (n.__obSt) { n.__obSt.remove(); n.__obSt = null; n.__obState = null; }
  }
  // phone list: label + icon + group on every moved item
  function listify(){
    if (merged) return;
    morePop.classList.add('stkc-ob-list');
    const used = {};
    moved.forEach(({ node }) => {
      for (const [match, g, ord, label, ic, state] of ROWS) {
        const t = match(node);
        if (!t) continue;
        node.setAttribute('data-ob-row', g);
        node.style.order = String(ord2(ord));
        t.setAttribute('data-ob-trig', '1');
        t.setAttribute('data-ob-label', label(t));
        const icon = ic === 'fs' && document.documentElement.classList.contains('stk-chart-fs') ? 'fsOff' : ic;
        t.style.setProperty('--ob-ic', icUrl(icon));
        node.__obTrig = t;
        if (state && strict) addState(node, t, state);
        used[g] = true;
        return;
      }
    });
    if (strict) EXTRA.forEach(([id, g, ord, label, ic, state, run]) => {
      if (id === 'stkc-ob-data' && !dataStatus()) return;
      const b = document.createElement('button');
      b.type = 'button'; b.id = id; b.className = 'stkc-ob-x';
      b.setAttribute('data-ob-row', g); b.setAttribute('data-ob-trig', '1'); b.setAttribute('data-ob-label', label());
      b.style.order = String(ord2(ord)); b.style.setProperty('--ob-ic', icUrl(ic));
      b.addEventListener('click', run);
      morePop.appendChild(b); extras.push(b);
      addState(b, b, state);
      used[g] = true;
    });
    moved.forEach(({ node }) => { if (!node.hasAttribute('data-ob-row') && !node.matches('#stkc-credits')) node.style.order = '120'; });
    Object.keys(heads).forEach((g) => { heads[g].hidden = !used[g]; });
  }
  // the row's current state on its right ("Live data", "Paper", the balance); the data row's icon takes the data colour
  function addState(node, t, fn){
    const sp = document.createElement('span');
    sp.className = 'stkc-ob-st';
    sp.setAttribute('aria-hidden', 'true');
    t.appendChild(sp);
    node.__obSt = sp; node.__obState = () => fn(t);
    paintState(node);
  }
  function paintState(node){
    let v = ''; try { v = node.__obState() || ''; } catch (e) {}
    if (node.__obSt.textContent !== v) node.__obSt.textContent = v;
    if (node.id === 'stkc-ob-data') { const d = dataStatus(); node.style.setProperty('--ob-dc', d ? DOT[d.s] || 'currentColor' : 'currentColor'); }
  }
  function refreshStates(){
    moved.forEach(({ node }) => {
      if (node.__obSt) paintState(node);
      const t = node.__obTrig, r = t && ROWS.find((x) => x[0](node));
      if (r) t.setAttribute('data-ob-label', r[3](t));   // labels that follow state (Full screen / Exit full screen)
    });
    extras.forEach((b) => { if (b.__obSt) paintState(b); });
  }
  // PHONE TOP BAR (Owner bug 2026-11-23): left menu, symbol, interval; right Indicators, bell, ⋯ More.
  // Everything else is a row of the ⋯ sheet, whatever the width (never squeezed, never overlapping).
  const KEEP = '.stkcps-menu, .vela-mb-symbol, .vela-mb-tf, .vela-mb-indicators, .notif-bell-wrap, .stkc-ob-more, .stkc-ob-sp, .stkc-cells, .stkc-tv-div';
  function strictItems(){
    const out = [];
    [barL, barR, mb].filter(Boolean).forEach((box) => {
      for (const c of box.children) {
        if (c === mb || c.matches(KEEP)) continue;
        if (c.classList.contains('vela-mb-actions')) { out.push(...c.children); continue; }
        out.push(c);
      }
    });
    return out.filter((n) => !n.matches('.vela-mb-settings, .stkc-pop, .stkc-scrim'));
  }
  // the data-status dot on the symbol chip (green live / amber delayed / grey closed), named in its label
  function paintSymDot(){
    const sym = mb && mb.querySelector('.vela-mb-symbol'); if (!sym) return;
    const d = strict ? dataStatus() : null, c = d ? DOT[d.s] : '';
    if (!c) { if (sym.hasAttribute('data-dd')) { sym.removeAttribute('data-dd'); sym.style.removeProperty('--dd'); sym.setAttribute('aria-label', 'Symbol search'); } return; }
    if (sym.getAttribute('data-dd') !== d.s) { sym.setAttribute('data-dd', d.s); sym.style.setProperty('--dd', c); }
    const lab = 'Symbol search · ' + (d.s === 'rt' ? 'Live data' : d.s === 'delayed' ? 'Delayed data' : d.tag || '');
    if (sym.getAttribute('aria-label') !== lab) sym.setAttribute('aria-label', lab);
  }
  function moveToMore(nodes){
    let any = false;
    nodes.forEach((n) => {
      if (!n || !n.isConnected || !bar.contains(n) || morePop.contains(n) || n.contains(more)) return;
      if (n.hidden || getComputedStyle(n).display === 'none') return;
      const ph = document.createComment('onebar');
      n.parentNode.insertBefore(ph, n);
      const wide = n.classList.contains('stkc-menu') || !!n.querySelector('.stkc-btn-l') || n.id === 'stkc-credits' || n.id === 'stkrb-chip';
      n.setAttribute('data-ob-more', wide ? 'row' : 'icon');
      if (tb.contains(n)) n.setAttribute('data-ob-vela', '1');
      morePop.appendChild(n);
      moved.push({ node: n, ph });
      any = true;
    });
    return any;
  }

  // Do the visible items need more room than the bar has?
  function flexItems(p, out){
    for (const c of p.children) {
      const cs = getComputedStyle(c);
      if (cs.display === 'contents') { flexItems(c, out); continue; }
      if (cs.display === 'none' || cs.position === 'absolute' || cs.position === 'fixed') continue;
      out.push(c);
    }
    return out;
  }
  function need(box){
    const cs = getComputedStyle(box);
    const its = flexItems(box, []).filter((c) => c !== spacer);
    let w = Math.max(0, its.length - 1) * (parseFloat(cs.columnGap) || 0);
    its.forEach((c) => {
      const s = getComputedStyle(c);
      w += c.getBoundingClientRect().width + parseFloat(s.marginLeft) + parseFloat(s.marginRight);
    });
    return w;
  }
  function overflows(){
    const cs = getComputedStyle(bar);
    const room = bar.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    // need() misses the layout-group hairline and the spacer's floor, so the bar's own
    // scrollWidth (items never shrink) is the second, exact test.
    // (not bar.scrollWidth: an open popover of a right-hand menu sticks out past the bar and
    // would read as overflow; the items' own right edge is the exact test)
    if (merged) {
      const right = bar.getBoundingClientRect().right - parseFloat(cs.paddingRight);
      const edge = flexItems(bar, []).reduce((m, c) => Math.max(m, c.getBoundingClientRect().right), 0);
      return need(bar) > room + 0.5 || edge > right + 1;
    }
    // phone row: neither half (nor the bar, nor Vela's mobile bar) may overflow its box (that is how the pencil
    // landed on the data-source icon), the symbol keeps its room, and no two buttons may touch.
    if ([bar, barL, barR, mb].some((b) => b && b.scrollWidth > b.clientWidth + 1)) return true;
    const sym = mb && mb.querySelector('.vela-mb-symbol');
    if (sym && sym.scrollWidth > sym.clientWidth + 1 && sym.clientWidth < 90) return true;
    const rs = flexItems(barL, []).concat(flexItems(barR, []), mb ? flexItems(mb, []) : [])
      .filter((c) => c !== mb && c !== spacer).map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0)
      .sort((a, b) => a.left - b.left);
    return rs.some((r, i) => i && r.left < rs[i - 1].right - 0.5);
  }

  // A divider shows only between two visible items (never first, last, twice, or by the spacer).
  function tidyDividers(){
    divs.forEach((d) => d.classList.remove('stkc-tv-off'));
    if (!merged) return;
    const its = flexItems(bar, []).filter((c) => c.getBoundingClientRect().width > 0 || c === spacer)
      .map((c) => ({ c, o: parseFloat(getComputedStyle(c).order) || 0, x: c.getBoundingClientRect().left }))
      .sort((a, b) => a.o - b.o || a.x - b.x).map((e) => e.c);
    let prevReal = false;
    its.forEach((c, i) => {
      if (c === spacer) { prevReal = false; return; }
      if (!divs.includes(c)) { prevReal = true; return; }
      let nextReal = false;
      for (let j = i + 1; j < its.length; j++) { if (its[j] === spacer) break; if (!divs.includes(its[j])) { nextReal = true; break; } }
      if (!prevReal || !nextReal) c.classList.add('stkc-tv-off');
      else prevReal = false;
    });
  }

  let fitting = false;
  function fit(){
    if (fitting) return;
    fitting = true;
    lastFit = performance.now();
    try {
      const wasOpen = !morePop.hidden, st = morePop.scrollTop;
      restoreMoved();
      CLASSES.forEach((c) => bar.classList.remove(c));
      more.hidden = true;
      const clk = byId('mclock'); if (clk) clk.classList.remove('mclock-dotonly');
      document.dispatchEvent(new CustomEvent('stkc:onebar-fit'));
      // phone: the session clock gives up its text (dot only) before any button leaves the bar
      if (clk && !merged && overflows()) clk.classList.add('mclock-dotonly');
      // (not in the Android app: it hides this bar and draws its own native toolbar, chart-bridge.js html.tzapp)
      strict = !merged && document.documentElement.classList.contains('stk-cps') && !document.documentElement.classList.contains('tzapp');
      bar.classList.toggle('stkc-ob-strict', strict);
      if (strict && moveToMore(strictItems())) more.hidden = false;
      for (const [kind, arg] of STEPS) {
        if (!overflows()) break;
        if (kind === 'cls') { bar.classList.add(arg); document.dispatchEvent(new CustomEvent('stkc:onebar-fit')); }
        else if (moveToMore(arg())) more.hidden = false;
      }
      listify();
      paintSymDot();
      if (more.hidden) setMore(false); else if (wasOpen) { setMore(true, true); morePop.scrollTop = st; }
      tidyDividers();
    } finally {
      mo.takeRecords();
      fitting = false;
    }
  }
  let raf = 0;
  // Ticks / clocks / badges mutate the bar many times a second. A refit pulls every row out of the open
  // sheet and puts it back (scroll jumps to 0, taps land on rebuilt nodes), so while the phone sheet is
  // open a mutation-driven refit waits until it closes; resize still refits (scroll position is kept).
  let late = false;
  const queue = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; fit(); }); };
  // LAYOUT-PERF (2026-11-08): at load ~20 modules each add a button in their own task, so the bar was refitted
  // once per module. Mutation refits now run at most once per 150 ms (resize still refits on the next frame).
  let lastFit = 0, later = 0;
  const queueSoon = () => { if (later || raf) return; const wait = lastFit + 150 - performance.now(); if (wait <= 0) return queue(); later = setTimeout(() => { later = 0; queue(); }, wait); };
  // While the phone sheet is open, NOTHING rebuilds it: on Android the address bar shows/hides as the finger scrolls
  // inside the sheet, which fires resize; a refit then reset the scroll mid-fling ("scroll up -> jumps back down").
  // An open sheet only gets its height re-measured; the full refit runs when it closes.
  const sheetOpen = () => !merged && !morePop.hidden;
  const onResize = () => {
    if (sheetOpen()) {
      late = true;
      const b = bar.getBoundingClientRect().bottom;
      morePop.style.setProperty('--ob-maxh', Math.max(160, Math.floor(window.innerHeight - b - 14)) + 'px');
      return;
    }
    queue();
  };
  // LAYOUT-PERF (2026-11-08): the session clock's text ticks every second inside the bar. A refit forces several
  // layouts (on a phone ~1.7 s of main thread at load, ~5.7 s while an indicator loaded), so a text-only change
  // refits only when it changed the width of the item that holds it (one measure instead of a full refit).
  const textOnly = (r) => r.type === 'characterData' || (r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every((n) => n.nodeType === 3));
  const itemW = new WeakMap();
  const itemOf = (n) => { let e = n.nodeType === 1 ? n : n.parentElement; while (e && e.parentElement && e.parentElement !== bar && e.parentElement !== barL && e.parentElement !== barR && e.parentElement !== morePop) e = e.parentElement; return e; };
  const sameWidth = (rs) => {
    if (!rs.every(textOnly)) return false;
    const items = new Set(rs.map((r) => itemOf(r.target)).filter(Boolean));
    let same = true;
    items.forEach((e) => { const w = Math.max(e.offsetWidth, e.scrollWidth); if (itemW.get(e) !== w) same = false; itemW.set(e, w); });
    return same;
  };
  const mo = new MutationObserver((rs) => { if (fitting) return; if (sameWidth(rs)) return; if (!merged && !morePop.hidden) { late = true; return; } queueSoon(); });
  mo.observe(bar, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  new ResizeObserver(onResize).observe(bar);

  let started = false;
  function merge(on){
    if (on === merged && started) return;
    started = true;
    restoreMoved();
    setMore(false);
    if (on) {
      if (mb && mbHome.parentNode) { mbHome.parentNode.insertBefore(mb, mbHome.nextSibling); bar.classList.remove('stkc-ob-phone'); }
      copyTokens();
      bar.insertBefore(tb, bar.firstChild);
      bar.classList.add('stkc-onebar');
    } else {
      bar.classList.remove('stkc-onebar');
      if (home.parentNode) home.parentNode.insertBefore(tb, home.nextSibling);
      if (mb) { copyTokens(); barL.insertBefore(mb, barL.firstChild); bar.classList.add('stkc-ob-phone'); }
    }
    merged = on;
    fit();
  }

  const mode = () => (root.dataset && root.dataset.layout) || 'desktop';
  const apply = () => merge(mode() !== 'mobile');
  apply();
  fit();
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['data-layout'] });
  window.addEventListener('resize', onResize, { passive: true });
  try { document.fonts && document.fonts.ready.then(queue); } catch (e) {}

  setInterval(() => { if (strict && !document.hidden) { paintSymDot(); if (!morePop.hidden) refreshStates(); } }, 3000);
  document.addEventListener('stryker:theme', () => { if (!morePop.hidden) refreshStates(); });

  const api = { fit, get strict(){ return strict; }, get merged(){ return merged; }, get moreCount(){ return moved.length; }, more: moreBtn, mobileBar: mb };
  window.__stkOneBar = api;
  return api;
}
