// TradeZoro Desktop: the window's ONE top bar (Owner 22 Nov): logo, search, "..." overflow, profile picture (opens the
// app menu: account, every screen, Settings, updates, sign out) and the window controls.
// Used twice, same code and look: by the app's own UI (src/app/ui.js) on every screen but Charts, and injected by
// src/main.js into the embedded ZoroCharts page, where the chart's own workspace-tab row becomes the window's bar.
// Everything renders in shadow roots, so neither page's CSS can reach it. No network, no secrets.
(function (G) {
  'use strict';
  if (G.TZBar) return;
  var P = { home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
    list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
    bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
    up: 'M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5', out: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
    key: 'M8 19a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM10.8 12.2 19 4M17 6l2 2M15 8l2 2',
    reload: 'M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5', win: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 9h18',
    pop: 'M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
search: 'M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.2-4.2',
    dots: 'M5 12h.01M12 12h.01M19 12h.01', ext: 'M14 4h6v6M20 4l-9 9M19 14v5H5V5h5' };
  var svg = function (n, cls) { return '<svg class="' + (cls || 'i') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + P[n] + '"/></svg>'; };
  // Screens, in Ctrl/Cmd+1..9 order. Product screens show their product icon, the rest a line icon.
  var SCREENS = [
    { id: 'home', label: 'Home', icon: 'home' }, { id: 'charts', label: 'Charts', img: 'zorocharts' },
    { id: 'watchlist', label: 'Watchlist', icon: 'list' }, { id: 'alerts', label: 'Alerts', icon: 'bell' },
    { id: 'gex', label: 'GEX', img: 'omega' }, { id: 'stats', label: 'Stats', title: 'Market Stats', img: 'market-stats' },
    { id: 'journal', label: 'Journal', img: 'nemesis' }, { id: 'learn', label: 'Learn', img: 'mentis' },
    { id: 'settings', label: 'Settings', icon: 'gear' }
  ];
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  // One font, 8-pt grid, 32px controls with 8px gaps, 8px radii (menus) / 6px (menu rows), 150-200 ms standard ease.
  var CSS = ':host{all:initial;display:flex;align-items:center;gap:8px;height:32px;flex:none;-webkit-app-region:no-drag;' +
    '--f:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI Variable Text","Segoe UI",Inter,Roboto,system-ui,sans-serif;font:400 13px/18px var(--f);' +
    '--i0:#eeeeee;--i1:#c9cdd3;--i2:#8b93a0;--i3:#6b7380;--sf:#131316;--sf2:#1b1b1f;--ln:rgba(255,255,255,.08);--lh:rgba(255,255,255,.16);' +
    '--hv:rgba(255,255,255,.06);--pr:rgba(255,255,255,.10);--m:#03c988;--ms:rgba(3,201,136,.14);--on:#04140e;--sh:0 12px 32px rgba(0,0,0,.5),0 2px 6px rgba(0,0,0,.3);color:var(--i0)}' +
    ':host([data-light]){--i0:#0e1621;--i1:#2a3543;--i2:#57626f;--i3:#6b7380;--sf:#ffffff;--sf2:#f3f5f8;--ln:#e1e5ec;--lh:#c6cfdb;--hv:rgba(14,22,33,.05);--pr:rgba(14,22,33,.09);' +
    '--m:#07996a;--ms:rgba(7,153,106,.12);--on:#fff;--sh:0 12px 32px rgba(14,22,33,.16),0 2px 6px rgba(14,22,33,.08)}' +
    ':host([data-drag]){-webkit-app-region:drag}:host(.end){height:48px;gap:8px}' +
    '*{box-sizing:border-box}button,input{font:inherit;color:inherit;margin:0}button{background:none;border:0;padding:0;cursor:default}' +
    ':focus-visible{outline:2px solid var(--m);outline-offset:2px}' +
    '.i{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round;display:block;flex:none}' +
    '.dots{stroke-width:3}.logo{width:20px;height:20px;display:block;-webkit-user-drag:none}' +
    '.ib{width:32px;height:32px;border-radius:8px;display:grid;place-items:center;color:var(--i1);transition:background .15s cubic-bezier(.2,0,0,1),color .15s}' +
    '.ib:hover{background:var(--hv);color:var(--i0)}.ib:active,.ib[aria-expanded="true"]{background:var(--pr);color:var(--i0)}' +
    // search: compact pill, grows on focus; under 1280px it is an icon until focused
    '.s{display:flex;align-items:center;gap:8px;height:32px;width:208px;padding:0 4px 0 8px;border-radius:8px;background:var(--sf);border:1px solid var(--ln);color:var(--i2);' +
    'transition:width .2s cubic-bezier(.2,0,0,1),border-color .15s,box-shadow .15s;cursor:text}' +
    '.s:hover{border-color:var(--lh)}.s:focus-within{width:320px;border-color:var(--m);box-shadow:0 0 0 3px var(--ms)}' +
    '.s .i{width:16px;height:16px}.s input{flex:1;min-width:0;height:30px;border:0;outline:0;background:transparent;font-size:13px;line-height:18px;color:var(--i0);padding:0}' +
    '.s input::placeholder{color:var(--i2)}' +
    'kbd{font:500 12px/16px var(--f);padding:2px 6px;border-radius:4px;border:1px solid var(--ln);color:var(--i2);background:var(--sf2);white-space:nowrap;flex:none}' +
    '.s:focus-within kbd{opacity:0}' +
    '@media (max-width:1279px){.s{width:32px;padding:0;justify-content:center;gap:0}.s input,.s kbd{width:0;flex:0 0 0;opacity:0}' +
    '.s:focus-within{width:240px;padding:0 4px 0 8px;justify-content:flex-start;gap:8px}.s:focus-within input{flex:1;opacity:1}}' +
    '.av{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;overflow:hidden;background:var(--ms);color:var(--m);font:600 13px/18px var(--f);' +
    'box-shadow:0 0 0 0 var(--lh);transition:box-shadow .15s cubic-bezier(.2,0,0,1)}' +
    '.av img{width:100%;height:100%;object-fit:cover;display:block}.av:hover{box-shadow:0 0 0 2px var(--lh)}.av[aria-expanded="true"]{box-shadow:0 0 0 2px var(--m)}' +
    '.av.out{background:transparent;color:var(--i1);border-radius:8px}.av.out:hover{background:var(--hv);box-shadow:none}' +
    '.wc{display:flex;height:48px;margin-left:0}.wc button{width:46px;height:48px;display:grid;place-items:center;color:var(--i1);transition:background .15s}' +
    '.wc button:hover{background:var(--hv);color:var(--i0)}.wc button:active{background:var(--pr)}.wc .x:hover{background:#c42b1c;color:#fff}.wc .x:active{background:#b22a1b;color:#fff}' +
    '.wc svg{width:10px;height:10px;fill:none;stroke:currentColor;stroke-width:1;shape-rendering:crispEdges;display:block}' +
    '@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}';
  var MENU_CSS = CSS.replace(/^:host\{[^}]*\}/, ':host{all:initial;position:fixed;inset:0;z-index:2147483600;-webkit-app-region:no-drag;' +
    '--f:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI Variable Text","Segoe UI",Inter,Roboto,system-ui,sans-serif;font:400 13px/18px var(--f);' +
    '--i0:#eeeeee;--i1:#c9cdd3;--i2:#8b93a0;--i3:#6b7380;--sf:#18181b;--sf2:#1f1f23;--ln:rgba(255,255,255,.08);--lh:rgba(255,255,255,.14);' +
    '--hv:rgba(255,255,255,.07);--pr:rgba(255,255,255,.11);--m:#03c988;--ms:rgba(3,201,136,.14);--on:#04140e;--sh:0 12px 32px rgba(0,0,0,.5),0 2px 6px rgba(0,0,0,.3);color:var(--i0)}') +
    '.m{position:fixed;min-width:240px;max-height:calc(100vh - 64px);overflow:auto;padding:4px;background:var(--sf);border:1px solid var(--lh);border-radius:8px;box-shadow:var(--sh);' +
    'transform-origin:top right;animation:pop .16s cubic-bezier(.2,0,0,1)}' +
    '@keyframes pop{from{opacity:0;transform:translateY(-4px) scale(.98)}}' +
    '.m.acc{width:288px}' +
    '.it{display:flex;align-items:center;gap:12px;width:100%;height:32px;padding:0 8px;border-radius:6px;font:400 13px/18px var(--f);color:var(--i0);text-align:left;white-space:nowrap}' +
    '.it:hover,.it:focus-visible,.it.k-on{background:var(--hv);outline:none}.it:active{background:var(--pr)}' +
    '.it .i{color:var(--i1)}.it img{width:20px;height:20px;border-radius:5px;display:block;flex:none;-webkit-user-drag:none}' +
    '.it span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}.it .k{flex:none;color:var(--i2);font:400 12px/16px var(--f);font-variant-numeric:tabular-nums}' +
    '.it[aria-current="page"]{background:var(--ms)}.it[aria-current="page"] span{font-weight:600}' +
    '.it.danger{color:#e5484d}.it.danger .i{color:#e5484d}:host([data-light]) .it.danger,:host([data-light]) .it.danger .i{color:#c9353a}' +
    'hr{border:0;border-top:1px solid var(--ln);margin:4px 0}' +
    '.hd{display:flex;align-items:center;gap:12px;padding:8px}.hd .av{width:40px;height:40px;font-size:15px;line-height:20px;box-shadow:none}' +
    '.hd .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:0}.hd b{font:600 13px/18px var(--f);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.hd small{font:400 12px/16px var(--f);color:var(--i2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.pl{flex:none;height:24px;padding:0 8px;border-radius:999px;background:var(--ms);color:var(--m);font:600 12px/24px var(--f);white-space:nowrap}' +
    '.lbl{padding:8px 8px 4px;font:500 12px/16px var(--f);color:var(--i2)}';

  function avatarHtml(u) {
    if (u && u.photo && /^https:\/\//.test(u.photo)) return '<img src="' + esc(u.photo) + '" alt="" referrerpolicy="no-referrer">';
    var n = u && (u.name || u.email) || '?';
    return esc(n.trim().charAt(0).toUpperCase());
  }

  // api: { platform, img(name) -> url, logo, act(action, arg) }. Slots: host elements to fill.
  function mount(api, slots) {
    var IS_MAC = api.platform === 'darwin', MOD = IS_MAC ? '⌘' : 'Ctrl ';
    var st = { user: null, screen: null, maximized: false, chart: false, signin: false };
    var hosts = [], layer = null, open = null;
    var root = function (el, cls) { el.className = (el.className ? el.className + ' ' : '') + (cls || ''); var r = el.shadowRoot || el.attachShadow({ mode: 'open' }); hosts.push(el); return r; };
    var light = function () { var t = document.documentElement.getAttribute('data-theme'); return t === 'light' || t === 'day'; };
    function theme() { hosts.concat(layer ? [layer] : []).forEach(function (h) { if (light()) h.setAttribute('data-light', ''); else h.removeAttribute('data-light'); }); }
    new MutationObserver(theme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    var logoR = slots.logo && root(slots.logo, 'tzbar-logo');
    if (logoR) { slots.logo.setAttribute('data-drag', ''); logoR.innerHTML = '<style>' + CSS + '</style><img class="logo" src="' + esc(api.logo) + '" alt="TradeZoro" draggable="false">'; }
    var sR = root(slots.search, 'tzbar-search');
    sR.innerHTML = '<style>' + CSS + '</style><label class="s" title="Search symbols, screens, tools and settings (' + MOD.trim() + '+K)">' + svg('search') +
      '<input type="text" placeholder="Search" aria-label="Search symbols, screens, tools and settings" autocomplete="off" spellcheck="false"><kbd>' + (IS_MAC ? '⌘K' : 'Ctrl K') + '</kbd></label>';
    var inp = sR.querySelector('input');
    // Typing (or Enter) hands the text to the command palette, which owns search results for the whole app.
    inp.addEventListener('input', function () { var q = inp.value; inp.value = ''; inp.blur(); api.act('palette', q); });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); api.act('palette', ''); } else if (e.key === 'Escape') inp.blur(); });

    var eR = root(slots.end, 'end');
    eR.innerHTML = '<style>' + CSS + '</style>' +
      '<button class="ib" type="button" id="more" aria-label="More" title="More" aria-haspopup="menu" aria-expanded="false">' + svg('dots', 'i dots') + '</button>' +
      '<button class="av" type="button" id="av" aria-haspopup="menu" aria-expanded="false"></button>' +
      (IS_MAC ? '' : '<div class="wc"><button type="button" data-w="min" aria-label="Minimize" title="Minimize"><svg viewBox="0 0 10 10"><path d="M0 5.5h10"/></svg></button>' +
        '<button type="button" data-w="max" aria-label="Maximize" title="Maximize"></button>' +
        '<button type="button" data-w="close" class="x" aria-label="Close" title="Close"><svg viewBox="0 0 10 10"><path d="M.5.5l9 9M9.5.5l-9 9"/></svg></button></div>');
    var more = eR.getElementById('more'), av = eR.getElementById('av');
    eR.querySelectorAll('[data-w]').forEach(function (b) { b.addEventListener('click', function () { api.act('win', b.getAttribute('data-w')); }); });
    more.addEventListener('click', function () { toggle(more, overflowItems, ''); });
    av.addEventListener('click', function () { if (!st.user) return api.act('signin'); toggle(av, accountItems, 'acc'); });
    [more, av].forEach(function (b) { b.addEventListener('keydown', function (e) { if (e.key === 'ArrowDown') { e.preventDefault(); b.click(); } }); });

    function overflowItems() {
      var it = [];
      if (st.chart) it.push({ t: 'Reload chart', i: 'reload', k: MOD + 'R', a: 'reload' });
      it.push({ t: 'New chart window', i: 'win', k: MOD + (IS_MAC ? '⇧N' : 'Shift N'), a: 'new-window' });
      if (st.chart) it.push({ t: 'Pop out chart', i: 'pop', k: MOD + (IS_MAC ? '⇧P' : 'Shift P'), a: 'popout' });
      return it;
    }
    function accountItems() {
      var u = st.user || {}, it = [{ head: true }, '-'];
      SCREENS.forEach(function (s, i) { if (s.id !== 'settings') it.push({ t: s.title || s.label, img: s.img, i: s.icon, k: MOD + (i + 1), a: 'go', arg: s.id, cur: st.screen === s.id }); });
      it.push('-', { t: 'Settings', i: 'gear', k: MOD + ',', a: 'go', arg: 'settings', cur: st.screen === 'settings' },
        { t: 'Check for updates', i: 'up', a: 'check-updates' }, '-', { t: 'Sign out', i: 'out', a: 'signout' });
      it[0].html = '<div class="hd"><span class="av">' + avatarHtml(u) + '</span><span class="tx"><b>' + esc(u.name || 'TradeZoro member') + '</b><small>' + esc(u.email || '') + '</small></span>' +
        (u.plan ? '<span class="pl">' + esc(u.plan) + '</span>' : '') + '</div>';
      return it;
    }
    function close(focusBack) {
      if (!open) return;
      var o = open; open = null;
      o.btn.setAttribute('aria-expanded', 'false');
      layer.shadowRoot.innerHTML = ''; layer.remove();
      if (focusBack) o.btn.focus();
    }
    function toggle(btn, build, cls) {
      if (open && open.btn === btn) return close(false);
      close(false);
      if (!layer) layer = document.createElement('tz-bar-menu');
      var r = layer.shadowRoot || layer.attachShadow({ mode: 'open' });
      var items = build();
      r.innerHTML = '<style>' + MENU_CSS + '</style><div class="m ' + cls + '" role="menu" aria-label="' + (cls ? 'Account and screens' : 'More') + '">' + items.map(function (x, n) {
        if (x === '-') return '<hr>';
        if (x.head) return x.html;
        return '<button class="it' + (x.a === 'signout' ? ' danger' : '') + '" type="button" role="menuitem" tabindex="-1" data-n="' + n + '"' + (x.cur ? ' aria-current="page"' : '') + '>' +
          (x.img ? '<img src="' + esc(api.img(x.img)) + '" alt="" draggable="false">' : svg(x.i)) + '<span>' + esc(x.t) + '</span>' + (x.k ? '<span class="k">' + esc(x.k) + '</span>' : '') + '</button>';
      }).join('') + '</div>';
      document.documentElement.appendChild(layer); theme();
      var m = r.querySelector('.m'), b = btn.getBoundingClientRect();
      m.style.top = Math.round(b.bottom + 8) + 'px';
      m.style.right = Math.max(8, Math.round(window.innerWidth - b.right)) + 'px';
      btn.setAttribute('aria-expanded', 'true');
      open = { btn: btn };
      var rows = [].slice.call(r.querySelectorAll('.it'));
      var focus = function (i) { rows[(i + rows.length) % rows.length].focus(); };
      layer.addEventListener('mousedown', function (e) { if (e.composedPath()[0] === layer) close(false); });
      r.addEventListener('click', function (e) {
        var t = e.target.closest && e.target.closest('.it'); if (!t) return;
        var x = items[+t.getAttribute('data-n')]; close(false); api.act(x.a, x.arg || '');
      });
      r.addEventListener('keydown', function (e) {
        var i = rows.indexOf(r.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); focus(i + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); focus(i - 1); }
        else if (e.key === 'Home') { e.preventDefault(); focus(0); }
        else if (e.key === 'End') { e.preventDefault(); focus(-1); }
        else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(true); }
      });
      focus(Math.max(0, rows.findIndex(function (x) { return x.hasAttribute('aria-current'); })));
    }
    window.addEventListener('blur', function () { close(false); });
    window.addEventListener('resize', function () { close(false); });

    function paint() {
      var u = st.user;
      av.className = 'av' + (u ? '' : ' out');
      av.innerHTML = u ? avatarHtml(u) : svg('key');
      var nm = u ? (u.name || u.email || 'Account') : 'Sign in';
      av.setAttribute('aria-label', u ? 'Account and screens: ' + nm : 'Sign in'); av.title = u ? nm : 'Sign in';
      [slots.search, more, av].forEach(function (el) { el.style.display = st.signin ? 'none' : ''; });
      var mx = eR.querySelector('[data-w="max"]');
      if (mx) { mx.setAttribute('aria-label', st.maximized ? 'Restore' : 'Maximize'); mx.title = mx.getAttribute('aria-label');
        mx.innerHTML = st.maximized ? '<svg viewBox="0 0 10 10"><path d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z"/></svg>' : '<svg viewBox="0 0 10 10"><path d="M.5.5h9v9h-9z"/></svg>'; }
    }
    theme(); paint();
    return {
      set: function (s) { Object.keys(s || {}).forEach(function (k) { st[k] = s[k]; }); if (open && s && ('user' in s || 'screen' in s)) close(false); paint(); },
      focusSearch: function () { inp.focus(); },
      close: close
    };
  }

  // The embedded ZoroCharts page: put the bar pieces into the site's top row (.mobile-topnav), which src/main.js
  // styles as the window bar (CHART_CSS). Called from main on every chart page load, in the preload's isolated world.
  function mountChart(bridge, init) {
    var nav = document.querySelector('.mobile-topnav');
    if (!nav || document.getElementById('tzd-end')) return !!nav;
    var de = document.documentElement;
    de.classList.add('tzd', 'tzd-' + init.platform);
    var mk = function (id) { var e = document.createElement('div'); e.id = id; return e; };
    var logo = mk('tzd-logo'), search = mk('tzd-search'), end = mk('tzd-end');
    nav.insertBefore(logo, nav.firstChild); nav.appendChild(search); nav.appendChild(end);
    var bar = mount({ platform: init.platform, logo: init.logo, img: function (n) { return init.icons[n] || ''; }, act: bridge.act }, { logo: logo, search: search, end: end });
    bar.set(Object.assign({ chart: true }, init.state || {}));
    bridge.onState(function (s) { bar.set(Object.assign({ chart: true }, s)); });
    return true;
  }

  G.TZBar = { mount: mount, mountChart: mountChart, SCREENS: SCREENS, avatarHtml: avatarHtml };
})(typeof globalThis !== 'undefined' ? globalThis : window);
