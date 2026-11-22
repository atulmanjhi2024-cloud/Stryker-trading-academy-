// TradeZoro Desktop 2.0: the app UI (shell, sidebar, palette, every native screen). Plain DOM, no framework:
// opens fast and idles at ~0 CPU (timers run only for the visible screen and only while the window is shown).
(function () {
  'use strict';
  var C = window.TZCore, D = window.TZData, A = window.tzApp, MS = window.StkMS;
  var root = document.documentElement, PLATFORM = root.getAttribute('data-platform'), IS_MAC = PLATFORM === 'darwin';
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var IMG = function (n, sz) { return '<img src="tzapp://app/img/' + n + '-' + (sz > 32 ? 128 : 64) + '.webp" width="' + sz + '" height="' + sz + '" alt="" draggable="false">'; };
  var ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
    pop: '<path d="M14 4h6v6M20 4l-8 8"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    win: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>', reload: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>', chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
    pause: '<path d="M9 5v14M15 5v14"/>', play: '<path d="M7 5v14l11-7z"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>', ext: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5H5V5h5"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.2-8.2M17 6l2 2M15 8l2 2"/>', mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    book: '<path d="M12 6.5C10.5 5 8 4 4 4v14c4 0 6.5 1 8 2.5 1.5-1.5 4-2.5 8-2.5V4c-4 0-6.5 1-8 2.5zM12 6.5V20.5"/>', up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', check: '<path d="m5 12 5 5L20 7"/>'
  };
  var ic = function (n, cls) { return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[n] + '</svg>'; };
  var G_MARK = '<svg class="gmark" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

  // The 9 screens (Ctrl/Cmd+1..9) live in the profile-picture menu of the top bar (src/app/bar.js).
  var SCREENS = window.TZBar.SCREENS;
  // Every product (11 icons). Native ones go to their screen; chart tools open the chart; the rest open on tradezoro.com.
  var TOOLS = [
    { img: 'zorocharts', t: 'ZoroCharts', s: 'Charts with every tool', go: 'charts' },
    { img: 'omega', t: 'Omega', s: 'Gamma exposure levels', go: 'gex' },
    { img: 'market-stats', t: 'Market Stats', s: 'How sessions behaved, with sample sizes', go: 'stats' },
    { img: 'nemesis', t: 'Nemesis', s: 'Trading journal', go: 'journal' },
    { img: 'mentis', t: 'Mentis', s: 'Lessons and courses', go: 'learn' },
    { img: 'kronos', t: 'Kronos', s: 'Replay and backtesting', url: '/backtests' },
    { img: 'phantom', t: 'Phantom', s: 'Options money flow', url: '/phantom' },
    { img: 'zorotide', t: 'ZoroTide', s: 'Net call vs put premium', go: 'charts' },
    { img: 'liquidity-map', t: 'Liquidity Map', s: 'Resting orders heatmap', go: 'charts' },
    { img: 'global-monitor', t: 'Global Monitor', s: 'World events and news', url: '/global-monitor' },
    { img: 'creator-hub', t: 'Creator Hub', s: 'Communities and indicators', url: '/creator' }
  ];

  // ---------- state ----------
  var S = { screen: null, user: null, signedInChecked: false, guest: false, shown: true, lists: [], wl: null, quotes: {}, alerts: null, fires: [], gex: {}, gexMarket: 0,
    learn: null, journal: null, month: new Date().toISOString().slice(0, 7), ms: { sym: 'NQ', rep: 'gap', range: '1y' }, update: null, info: {} };
  var timers = [];
  function every(ms, fn) { timers.push(setInterval(function () { if (S.shown) fn(); }, ms)); }
  function clearTimers() { timers.forEach(clearInterval); timers = []; }
  function toast(msg) {
    var t = $('.toast'); if (t) t.remove();
    t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3200);
  }
  var ls = { get: function (k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }, set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };

  // ---------- theme (same key as the site: the embedded chart follows it too) ----------
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  function themePref() { var p = ls.get('tz_desktop_theme', 'night'); return p === 'light' ? 'day' : p; }
  function applyTheme() {
    var p = themePref(), t = p === 'system' ? (mq.matches ? 'night' : 'day') : p;
    root.setAttribute('data-theme', t === 'day' ? 'light' : 'night');
    try { localStorage.setItem('stryker_theme', t); } catch (e) {}
    A.theme(t);
  }
  mq.addEventListener('change', function () { if (themePref() === 'system') applyTheme(); });

  // ---------- shell ----------
  var bar = null;
  function planLabel(p) { var k = String(p || '').trim(); return { starter: 'Free', elite: 'Pro' }[k.toLowerCase()] || k; }
  function setAvatar() { pushBar(); }
  function pushBar() {
    var u = S.user, st = { user: u ? { name: u.displayName || '', email: u.email || '', photo: u.photoURL || '', plan: planLabel(S.plan) } : null, screen: S.screen, signin: S.screen === 'signin' };
    bar.set(st); A.barState(st);
  }
  // One handler for the bar here and its copy inside the chart (main forwards those clicks: tz:bar-act)
  function barAct(a, arg) {
    if (a === 'go') return go(arg);
    if (a === 'palette') return S.screen !== 'signin' && openPalette(arg);
    if (a === 'signin') return showSignin();
    if (a === 'signout') return D.Auth.signOut();
    if (a === 'check-updates') { go('settings'); A.checkUpdates(); var el = $('#set-upd'); if (el) el.textContent = 'Checking…'; return; }
    if (a === 'new-window') return A.newChartWindow();
    if (a === 'popout') return A.popOut();
    if (a === 'reload') return A.chartReload();
    if (a === 'win') return A.win(arg);
  }

  function go(id, opts) {
    if (!SCREENS.some(function (s) { return s.id === id; })) id = 'home';
    if (!S.user && !S.guest) id = 'signin';
    S.screen = id;
    clearTimers();
    closeLayer();
    var sc = SCREENS.filter(function (x) { return x.id === id; })[0];
    $('#tb-title').textContent = sc ? (sc.title || sc.label) : '';
    document.title = (sc ? (sc.title || sc.label) + ' · ' : '') + 'TradeZoro';
    pushBar();
    var main = $('#main');
    main.innerHTML = '';
    var scr = document.createElement('section'); scr.className = 'scr'; scr.setAttribute('data-screen', id);
    main.appendChild(scr);
    if (id !== 'charts') A.chartShow(false);
    $('#app').classList.toggle('on-chart', id === 'charts');
    (RENDER[id] || RENDER.home)(scr, opts || {});
    if (id !== 'signin') ls.set('tz_desktop_screen', id);
  }

  // ---------- quotes (shared by Home, Watchlist, tray) ----------
  function activeList() { return S.lists.filter(function (l) { return l.id === S.wl; })[0] || S.lists[0] || null; }
  function loadLists() {
    return D.Watchlists.list().then(function (ls_) {
      S.lists = ls_;
      return D.Watchlists.active().then(function (id) { S.wl = ls_.some(function (l) { return l.id === id; }) ? id : (ls_[0] && ls_[0].id); });
    }).catch(function (e) { console.warn('watchlists', e); S.lists = []; });
  }
  var qBusy = false;
  function refreshQuotes(ids) {
    if (qBusy) return Promise.resolve();
    qBusy = true;
    return Promise.all(ids.map(function (id) {
      var sym = C.symbolOf(id);
      return D.quote(sym).then(function (q) { if (q) S.quotes[sym.id] = q; }, function () { S.quotes[sym.id] = S.quotes[sym.id] || { err: true }; });
    })).then(function () { qBusy = false; pushTray(); }, function () { qBusy = false; });
  }
  function pushTray() {
    var l = activeList(); if (!l) return;
    A.tray(C.symbolsOf(l.items).slice(0, 6).map(function (id) {
      var s = C.symbolOf(id), q = S.quotes[s.id];
      return q && q.last != null ? { t: s.ticker, last: C.fmtNum(q.last, C.decimalsFor(s, q.last)), pct: C.fmtPct(q.pct) } : null;
    }).filter(Boolean));
  }
  function priceTxt(s, q) { return q && q.last != null ? C.fmtNum(q.last, C.decimalsFor(s, q.last)) : '—'; }
  function sparkSvg(q, w, h) {
    if (!q || !q.spark || q.spark.length < 2) return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"></svg>';
    var col = q.pct == null ? 'var(--ink-3)' : q.pct >= 0 ? 'var(--bull)' : 'var(--bear)';
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true"><path d="' + C.sparkPath(q.spark, w, h, 3) + '" stroke="' + col + '" vector-effect="non-scaling-stroke"/></svg>';
  }
  function openChart(id) { go('charts', { symbol: id }); }

  // ---------- screens ----------
  var RENDER = {};

  // The screen's name is in the top bar; the page starts with its one-line description and actions (Home keeps its greeting).
  function head(title, sub, actions, big) {
    if (!sub && !actions && !big) return '';
    return '<div class="phead"><div class="tt">' + (big ? '<h1 class="h1">' + esc(title) + '</h1>' : '') + (sub ? '<p class="sub">' + sub + '</p>' : '') + '</div><div class="act">' + (actions || '') + '</div></div>';
  }
  function signInCard(what) {
    return '<div class="empty">' + ic('key') + '<b>Sign in to see ' + esc(what) + '</b><p>Your TradeZoro account keeps it in step with the website and the phone app.</p><button class="btn btn-p" type="button" data-act="signin">Sign in</button></div>';
  }

  // HOME
  RENDER.home = function (el) {
    var hr = new Date().getHours(), hi = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    var name = S.user && (S.user.displayName || '').split(' ')[0];
    el.innerHTML = '<div class="wrap">' + head(hi + (name ? ', ' + name : ''), 'Your markets at a glance. Education only. Not financial advice.',
      '<button class="btn" type="button" data-go="charts">' + ic('chart') + 'Open charts</button>', true) +
      '<div class="grid g-home">' +
      '<div class="card span-12" id="h-wl"><div class="card-h"><h2 class="h3">Watchlist</h2><button class="lnk" type="button" data-go="watchlist">Open watchlist</button></div><div class="qgrid" id="h-q"></div></div>' +
      '<div class="card span-4" id="h-ses"><div class="card-h"><h2 class="h3">Market sessions</h2></div><div class="sess"></div></div>' +
      '<div class="card span-4" id="h-al"><div class="card-h"><h2 class="h3">Alerts</h2><button class="lnk" type="button" data-go="alerts">All alerts</button></div><div class="rows"></div></div>' +
      '<div class="card span-4" id="h-gex"><div class="card-h"><h2 class="h3">GEX levels</h2><button class="lnk" type="button" data-go="gex">Open GEX</button></div><div></div></div>' +
      '<div class="card span-6" id="h-learn"><div class="card-h"><h2 class="h3">Continue learning</h2><button class="lnk" type="button" data-go="learn">All chapters</button></div><div></div></div>' +
      '<div class="card span-6"><div class="card-h"><h2 class="h3">All tools</h2></div><div class="tools">' + TOOLS.map(function (t, i) {
        return '<button class="tool" type="button" data-tool="' + i + '">' + IMG(t.img, 40) + '<div><b>' + esc(t.t) + '</b><span>' + esc(t.s) + '</span></div></button>';
      }).join('') + '</div></div>' +
      '</div></div>';
    var drawQ = function () {
      var l = activeList(), box = $('#h-q', el); if (!box) return;
      if (!l) { box.innerHTML = '<p class="sub">No watchlist yet.</p>'; return; }
      var ids = C.symbolsOf(l.items).slice(0, 8);
      box.innerHTML = ids.map(function (id) {
        var s = C.symbolOf(id), q = S.quotes[s.id], cls = !q || q.pct == null ? '' : q.pct >= 0 ? 'up' : 'dn';
        return '<button class="qc" type="button" data-sym="' + esc(s.id) + '" title="Open ' + esc(s.ticker) + ' chart"><div class="qc-t"><b>' + esc(s.ticker) + '</b><span>' + esc(s.name) + '</span></div>' +
          sparkSvg(q, 200, 36) + '<div class="qc-p"><b>' + priceTxt(s, q) + '</b><span class="' + cls + '">' + (q && !q.err ? C.fmtPct(q.pct) : '—') + '</span></div></button>';
      }).join('');
    };
    var drawSes = function () {
      var b = $('#h-ses .sess', el); if (!b) return;
      var now = Date.now();
      b.innerHTML = C.sessionsNow(now).map(function (s) {
        return '<div class="ses"><b>' + esc(s.name) + '</b><div class="bar"><i style="width:' + Math.round(s.progress * 100) + '%"></i></div><span class="st num' + (s.open ? ' on' : '') + '">' +
          (s.open ? 'Open · closes in ' : 'Closed · opens in ') + C.fmtDur(s.until) + '</span></div>';
      }).join('') + '<div class="ses"><b>CME futures</b><div></div><span class="st' + (C.futuresOpen(now) ? ' on' : '') + '">' + (C.futuresOpen(now) ? 'Trading' : 'Closed') + '</span></div>';
    };
    var drawAl = function () {
      var b = $('#h-al .rows', el); if (!b) return;
      if (!S.user && !D.STUB) { b.innerHTML = '<p class="sub">Sign in to see your alerts.</p>'; return; }
      var list = (S.alerts || []).filter(function (a) { return a.active; }).slice(0, 4);
      var fired = S.fires.filter(function (f) { return new Date(f.at).toDateString() === new Date().toDateString(); });
      b.innerHTML = (fired.length ? fired.slice(0, 2).map(function (f) {
        return '<div class="row"><span class="dot on"></span><div class="tx"><b>' + esc(f.text || C.displayAlertSymbol(f.symbol)) + '</b><span>Fired ' + new Date(f.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</span></div></div>';
      }).join('') : '') + (list.length ? list.map(alertRowSmall).join('') : (fired.length ? '' : '<p class="sub">No active alerts. Create one from the Alerts screen or the chart.</p>'));
    };
    var drawGex = function () {
      var b = $('#h-gex > div:last-child', el); if (!b) return;
      if (!S.user && !D.STUB) { b.innerHTML = '<p class="sub">Sign in to see the latest gamma levels. Free for members.</p>'; return; }
      var m = C.GEX_MARKETS[0], v = S.gex[m.fut];
      if (!v) { b.innerHTML = '<div class="skel" style="height:132px"></div>'; return; }
      if (v.err) { b.innerHTML = '<p class="sub">GEX levels are not available right now.</p>'; return; }
      b.innerHTML = '<p class="lbl" style="margin:0 0 4px">' + esc(m.fut) + ' · ' + esc(C.gexAgo(v.ts, Date.now())) + '</p>' + v.levels.filter(function (l) { return /call_wall|zero_gamma|put_wall|spot/.test(l.kind); }).map(function (l) {
        return '<div class="lv ' + (l.kind === 'spot' ? 'spot' : '') + '"><i style="background:' + levelColor(l.kind) + '"></i><b>' + esc(l.label) + '</b><span></span><span class="num">' + C.fmtNum(l.price, m.dec) + '</span></div>';
      }).join('');
    };
    var drawLearn = function () {
      var b = $('#h-learn > div:last-child', el); if (!b || !S.learn) return;
      var m = S.learn, c = m.cont, first = m.sections[0] && m.sections[0][1][0];
      var ch = c ? c.chapter : first && first.chapter;
      if (!ch) { b.innerHTML = ''; return; }
      b.innerHTML = '<div class="cont">' + IMG('mentis', 56) + '<div class="tx"><span class="lbl">' + (c ? 'Chapter ' + esc(ch.num) + ' · lesson ' + (c.lesson + 1) + ' of ' + c.total : 'Start with chapter ' + esc(ch.num)) + '</span><b>' + esc(c ? c.lessonTitle : ch.title) + '</b>' +
        '<div class="prog"><i style="width:' + (m.total ? Math.round(m.done / m.total * 100) : 0) + '%"></i></div><span class="foot num">' + m.done + ' of ' + m.total + ' core lessons done</span></div>' +
        '<button class="btn btn-p" type="button" data-chapter="' + esc(ch.num) + '">' + (c ? 'Resume' : 'Start') + '</button></div>';
    };
    drawQ(); drawSes(); drawAl(); drawGex();
    var l = activeList();
    (S.lists.length ? Promise.resolve() : loadLists()).then(function () { drawQ(); l = activeList(); if (l) return refreshQuotes(C.symbolsOf(l.items).slice(0, 8)); }).then(drawQ);
    if (S.user || D.STUB) loadGex(0).then(drawGex);
    (S.learn ? Promise.resolve() : D.learn().then(function (m) { S.learn = m; })).then(drawLearn);
    el._redrawAlerts = drawAl;
    every(30000, function () { var l2 = activeList(); if (l2) refreshQuotes(C.symbolsOf(l2.items).slice(0, 8)).then(drawQ); drawSes(); });
  };
  function levelColor(k) { return { call_wall: 'var(--bull)', put_wall: 'var(--bear)', zero_gamma: 'var(--warn)', spot: 'var(--gold)', iv68_hi: 'var(--teal)', iv68_lo: 'var(--teal)' }[k] || 'var(--ink-3)'; }
  function alertRowSmall(a) {
    return '<div class="row"><span class="dot' + (a.active ? ' on' : '') + '"></span><div class="tx"><b>' + esc(a.ticker) + ' · ' + esc(C.ALERT_CONDS[a.cond]) + '</b><span>' + esc(a.message || (a.freq === 'every' ? 'Every time' : 'Only once')) + '</span></div><span class="rv">' + C.alertPrice(a.price) + '</span></div>';
  }
  function loadGex(i) {
    var m = C.GEX_MARKETS[i];
    return D.gex(m).then(function (v) { S.gex[m.fut] = v || { err: true }; }, function (e) { S.gex[m.fut] = { err: true, signin: e && (e.status === 401 || e.status === 403) }; });
  }

  // CHARTS: the real ZoroCharts page, laid over this area by the main process
  RENDER.charts = function (el, o) {
    // The chart covers the whole window: its own top row (workspace tabs, Trade, market status) becomes the window's bar,
    // with this app's search, menu, profile picture and window controls added (main.js EMBED_CSS + bar.js).
    el.className = 'scr flush';
    el.innerHTML = '<div class="chart-host" id="chart-host">' + (S.chartLoaded ? '' : '<div class="chart-load"><div class="spin" role="progressbar" aria-label="Loading chart"></div></div>') + '</div>';
    var send = function () { if (S.screen !== 'charts' || $('.scrim') || $('.menu')) return; A.chartBounds({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }); };
    new ResizeObserver(send).observe(document.documentElement);
    send();
    A.chartShow(true);
    if (o.symbol) A.chartSymbol(o.symbol);
  };
  // A dialog over the chart: the chart view steps aside and our own bar shows above the dialog's scrim.
  function chartCover(on) { if (S.screen === 'charts') { A.chartShow(!on); $('#app').classList.toggle('on-chart', !on); } }

  // WATCHLIST
  RENDER.watchlist = function (el) {
    var draw = function () {
      var l = activeList();
      el.innerHTML = '<div class="wrap">' + head('Watchlist', (S.user ? 'Synced with your account on the website and the phone app.' : 'Saved on this computer. Sign in to sync your lists.') ,
        '<button class="btn" type="button" data-act="wl-new">' + ic('plus') + 'New list</button><button class="btn btn-p" type="button" data-act="wl-add">' + ic('plus') + 'Add symbol</button>') +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px"><div class="tabs" role="tablist" aria-label="Your watchlists">' + S.lists.map(function (x) {
          return '<button class="tab" role="tab" type="button" data-wl="' + esc(x.id) + '" aria-selected="' + (x.id === (l && l.id)) + '">' + esc(x.name) + '</button>';
        }).join('') + '</div>' + (l ? '<button class="ib" type="button" data-act="wl-menu" aria-label="List options" title="List options">' + ic('dots') + '</button>' : '') + '</div>' +
        (!l ? '<div class="card"><div class="empty">' + ic('list') + '<b>No watchlist yet</b><p>Make a list of the markets you follow.</p><button class="btn btn-p" type="button" data-act="wl-new">New list</button></div></div>' :
        '<div class="tbl-wrap"><table class="tbl" aria-label="' + esc(l.name) + '"><thead><tr><th style="width:40%">Symbol</th><th class="r">Last</th><th class="r">Change</th><th class="r">Change %</th><th style="width:140px">Today</th><th class="ra"><span class="sr">Actions</span></th></tr></thead><tbody>' +
        (l.items.length ? l.items.map(function (it) {
          if (C.isSection(it)) return '<tr class="sec"><td colspan="6">' + esc(it.slice(3)) + '</td></tr>';
          var s = C.symbolOf(it), q = S.quotes[s.id], cls = !q || q.pct == null ? '' : q.pct >= 0 ? 'up' : 'dn', dec = q && q.last != null ? C.decimalsFor(s, q.last) : 2;
          return '<tr draggable="true" data-sym="' + esc(it) + '"><td><div class="sym"><span class="grip" aria-hidden="true">' + ic('grip').replace('class="ic"', 'class="ic" style="width:16px;height:16px"') + '</span><b>' + esc(s.ticker) + '</b><span>' + esc(s.name) + '</span></div></td>' +
            '<td class="r">' + priceTxt(s, q) + '</td><td class="r ' + cls + '">' + (q && q.change != null ? C.fmtSigned(q.change, dec) : '—') + '</td><td class="r ' + cls + '">' + (q && !q.err ? C.fmtPct(q.pct) : '—') + '</td>' +
            '<td>' + sparkSvg(q, 140, 28).replace('class="spark"', 'class="spark" style="height:28px"') + '</td>' +
            '<td class="ra"><button class="ib" type="button" data-act="wl-rm" data-id="' + esc(it) + '" aria-label="Remove ' + esc(s.ticker) + '" title="Remove">' + ic('x') + '</button></td></tr>';
        }).join('') : '<tr><td colspan="6"><div class="empty"><b>This list is empty</b><p>Add the symbols you want to follow.</p></div></td></tr>') +
        '</tbody></table></div><p class="foot" style="margin:12px 4px 0">Futures are continuous front-month. Drag rows to reorder. Click a row to open its chart.</p>') + '</div>';
      wireDrag();
    };
    var wireDrag = function () {
      var dragId = null;
      $$('tr[draggable]', el).forEach(function (tr) {
        tr.addEventListener('dragstart', function (e) { dragId = tr.getAttribute('data-sym'); tr.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); });
        tr.addEventListener('dragend', function () { tr.classList.remove('drag'); $$('tr.over', el).forEach(function (x) { x.classList.remove('over'); }); });
        tr.addEventListener('dragover', function (e) { if (!dragId) return; e.preventDefault(); $$('tr.over', el).forEach(function (x) { x.classList.remove('over'); }); tr.classList.add('over'); });
        tr.addEventListener('drop', function (e) {
          e.preventDefault(); var over = tr.getAttribute('data-sym'), l = activeList();
          if (!dragId || !l) return;
          saveList(C.wlMove(l, dragId, over)); dragId = null;
        });
      });
    };
    el._draw = draw;
    draw();
    (S.lists.length ? Promise.resolve() : loadLists()).then(function () { draw(); var l = activeList(); if (l) return refreshQuotes(C.symbolsOf(l.items)); }).then(draw);
    every(30000, function () { var l = activeList(); if (l && !$('tr.drag', el)) refreshQuotes(C.symbolsOf(l.items)).then(draw); });
  };
  var saveT = null;
  function saveList(l) {
    S.lists = S.lists.map(function (x) { return x.id === l.id ? l : x; });
    redraw();
    clearTimeout(saveT);
    saveT = setTimeout(function () { D.Watchlists.save(l).catch(function () { toast('Could not save your watchlist. Check your connection.'); }); }, 400);
    pushTray();
  }
  function redraw() { var s = $('.scr'); if (s && s._draw) s._draw(); }

  // ALERTS
  RENDER.alerts = function (el) {
    var draw = function () {
      var list = S.alerts;
      el.innerHTML = '<div class="wrap">' + head('Alerts', 'Price alerts reach this computer as notifications while TradeZoro runs, even from the tray.',
        '<button class="btn btn-p" type="button" data-act="al-new">' + ic('plus') + 'New alert</button>') +
        '<div class="grid g-home"><div class="span-8"><div class="tbl-wrap">' +
        (list == null ? '<div style="padding:16px"><div class="skel" style="height:44px;margin-bottom:8px"></div><div class="skel" style="height:44px"></div></div>' :
          !list.length ? '<div class="empty">' + ic('bell') + '<b>No alerts yet</b><p>Get a notification when a market crosses a price.</p><button class="btn btn-p" type="button" data-act="al-new">New alert</button></div>' :
          '<table class="tbl" aria-label="Your alerts"><thead><tr><th>Symbol</th><th>Condition</th><th class="r">Price</th><th>Repeats</th><th>Status</th><th class="ra"></th></tr></thead><tbody>' + list.map(function (a) {
            return '<tr><td><div class="sym"><b>' + esc(a.ticker) + '</b>' + (a.message ? '<span>' + esc(a.message) + '</span>' : '') + '</div></td><td>' + esc(C.ALERT_CONDS[a.cond]) + '</td><td class="r">' + C.alertPrice(a.price) + '</td>' +
              '<td>' + (a.freq === 'every' ? 'Every time' : 'Only once') + '</td><td><span class="pill' + (a.active ? ' ok' : '') + '">' + (a.active ? 'Active' : 'Paused') + '</span></td>' +
              '<td class="ra" style="white-space:nowrap"><button class="ib" type="button" data-act="al-toggle" data-id="' + esc(a.id) + '" aria-label="' + (a.active ? 'Pause' : 'Restart') + ' alert" title="' + (a.active ? 'Pause' : 'Restart') + '">' + ic(a.active ? 'pause' : 'play') + '</button>' +
              '<button class="ib" type="button" data-act="al-del" data-id="' + esc(a.id) + '" aria-label="Delete alert" title="Delete">' + ic('trash') + '</button></td></tr>';
          }).join('') + '</tbody></table>') +
        '</div></div><div class="card span-4"><div class="card-h"><h2 class="h3">History</h2></div><div class="rows">' +
        (S.fires.length ? S.fires.map(function (f) {
          return '<div class="row"><span class="dot on"></span><div class="tx"><b>' + esc(f.text || C.displayAlertSymbol(f.symbol)) + '</b><span>' + new Date(f.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</span></div></div>';
        }).join('') : '<p class="sub">Alerts that fire show here.</p>') + '</div></div></div>' +
        (S.user || D.STUB ? '' : '<p class="foot" style="margin-top:12px">Signed out: alerts are kept on this computer. Sign in to sync them and get them on your phone too.</p>') + '</div>';
    };
    el._draw = draw; draw();
  };
  function alertDialog(preset) {
    var syms = C.CATALOG.map(function (c) { return C.symbolOf(c[0]); });
    var d = openDialog('<div class="dlg" role="dialog" aria-modal="true" aria-labelledby="al-h"><div class="dlg-h"><h2 class="h2" id="al-h">New alert</h2><button class="ib" type="button" data-close aria-label="Close">' + ic('x') + '</button></div>' +
      '<label class="field"><span class="lbl">Symbol</span><select class="inp" id="al-sym">' + syms.map(function (s) { return '<option value="' + esc(s.id) + '"' + (preset === s.id ? ' selected' : '') + '>' + esc(s.ticker + ' · ' + s.name) + '</option>'; }).join('') + '</select></label>' +
      '<div class="row2"><label class="field"><span class="lbl">Condition</span><select class="inp" id="al-cond">' + Object.keys(C.ALERT_CONDS).map(function (k) { return '<option value="' + k + '">' + C.ALERT_CONDS[k] + '</option>'; }).join('') + '</select></label>' +
      '<label class="field"><span class="lbl">Price</span><input class="inp num" id="al-price" inputmode="decimal" autocomplete="off" placeholder="0.00"></label></div>' +
      '<label class="field"><span class="lbl">Message (optional)</span><input class="inp" id="al-msg" maxlength="140" autocomplete="off"></label>' +
      '<div class="field"><span class="lbl">Repeats</span><div class="seg" role="group"><button type="button" data-freq="once" aria-pressed="true">Only once</button><button type="button" data-freq="every" aria-pressed="false">Every time</button></div></div>' +
      '<p class="foot" id="al-note"></p><p class="err" id="al-err" role="alert"></p>' +
      '<div class="dlg-a"><button class="btn btn-g" type="button" data-close>Cancel</button><button class="btn btn-p" type="button" id="al-save">Create alert</button></div></div>');
    var note = function () { var s = $('#al-sym', d).value; $('#al-note', d).textContent = C.serverCovers(s) ? 'Checked on our servers around the clock.' : 'Checked while a chart of this symbol is open in TradeZoro.'; };
    $('#al-sym', d).addEventListener('change', note); note();
    $$('[data-freq]', d).forEach(function (b) { b.addEventListener('click', function () { $$('[data-freq]', d).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); }); });
    $('#al-price', d).focus();
    $('#al-save', d).addEventListener('click', function () {
      var input = { symbol: $('#al-sym', d).value, cond: $('#al-cond', d).value, price: $('#al-price', d).value, message: $('#al-msg', d).value, freq: $('[data-freq][aria-pressed="true"]', d).getAttribute('data-freq') };
      D.Alerts.add(input).then(function () { closeLayer(); toast('Alert created.'); if (!S.user) watchAlerts(); }, function (e) { $('#al-err', d).textContent = e.message || 'Could not create the alert.'; });
    });
  }
  var alUnsub = null, fireUnsub = null, noteUnsub = null;
  function watchAlerts() {
    if (alUnsub) alUnsub(); if (fireUnsub) fireUnsub();
    alUnsub = D.Alerts.watch(function (list) { S.alerts = list || []; var s = $('.scr'); if (s && s._draw && S.screen === 'alerts') s._draw(); if (s && s._redrawAlerts) s._redrawAlerts(); });
    fireUnsub = D.Alerts.fires(function (list) { S.fires = list; var s = $('.scr'); if (s && s._draw && S.screen === 'alerts') s._draw(); if (s && s._redrawAlerts) s._redrawAlerts(); });
    if (noteUnsub) noteUnsub();
    // Site notifications (price alerts fired by the server engine and the rest of the bell) -> OS notifications.
    noteUnsub = D.watchNotifications(function (n) { A.notify({ id: n.id, title: n.type === 'chart_alert' ? 'TradeZoro alert' : 'TradeZoro', body: n.message || 'You have a new notification', screen: 'alerts' }); });
  }

  // GEX
  RENDER.gex = function (el) {
    var draw = function () {
      var m = C.GEX_MARKETS[S.gexMarket], v = S.gex[m.fut];
      el.innerHTML = '<div class="wrap">' + head('GEX levels', 'Gamma exposure walls for the futures, from options on the underlying. Education only. Not financial advice.',
        '<div class="seg" role="group" aria-label="Market">' + C.GEX_MARKETS.map(function (x, i) { return '<button type="button" data-gex="' + i + '" aria-pressed="' + (i === S.gexMarket) + '">' + esc(x.fut) + '</button>'; }).join('') + '</div>') +
        (!S.user && !D.STUB ? '<div class="card">' + signInCard('GEX levels') + '</div>' :
        !v ? '<div class="grid g-home"><div class="card span-6"><div class="skel" style="height:300px"></div></div><div class="card span-6"><div class="skel" style="height:300px"></div></div></div>' :
        v.err ? '<div class="card"><div class="empty">' + ic('clock') + '<b>' + (v.signin ? 'GEX is for signed-in members' : 'GEX levels are not available right now') + '</b><p>' + (v.signin ? 'Sign in with your TradeZoro account.' : 'Try again in a few minutes.') + '</p><button class="btn" type="button" data-act="gex-retry">Try again</button></div></div>' :
        '<div class="grid g-home"><div class="card span-6"><div class="card-h"><h2 class="h3">' + esc(m.name) + ' · ' + esc(m.fut) + '</h2><span class="pill' + (v.stale ? ' bad' : ' ok') + '">' + esc(C.gexAgo(v.ts, Date.now())) + '</span></div>' +
          v.levels.map(function (l) {
            var dist = l.kind === 'spot' ? '' : C.fmtSigned(l.price - v.spot, m.dec);
            return '<div class="lv' + (l.kind === 'spot' ? ' spot' : '') + '"><i style="background:' + levelColor(l.kind) + '"></i><b>' + esc(l.label) + '</b><span class="dist">' + dist + '</span><span class="num">' + C.fmtNum(l.price, m.dec) + '</span></div>';
          }).join('') +
          '<p class="sub" style="margin-top:16px">' + esc(C.gexSummary(v)) + '</p>' +
          '<div style="display:flex;gap:8px;margin-top:16px"><button class="btn" type="button" data-act="gex-chart">' + ic('chart') + 'Show on chart</button></div></div>' +
          '<div class="card span-6"><div class="card-h"><h2 class="h3">Net GEX by strike</h2>' + (v.net != null ? '<span class="pill' + (v.positive ? ' ok' : ' bad') + ' num">Net ' + C.fmtGex(v.net) + '</span>' : '') + '</div>' + profileSvg(v) +
          '<p class="foot" style="margin-top:8px">Strikes of the underlying, $M per 1% move. Green adds calm, red adds movement.</p></div></div>') + '</div>';
    };
    el._draw = draw; draw();
    if ((S.user || D.STUB) && !S.gex[C.GEX_MARKETS[S.gexMarket].fut]) loadGex(S.gexMarket).then(draw);
    every(5 * 60000, function () { if (S.user || D.STUB) loadGex(S.gexMarket).then(draw); });
  };
  function profileSvg(v) {
    var p = v.profile; if (!p || !p.length) return '<p class="sub">No strike profile in this update.</p>';
    var W = 560, H = 280, L = 56, n = p.length, bh = Math.max(2, (H - 8) / n - 2), max = Math.max.apply(null, p.map(function (x) { return Math.abs(x.g); })) || 1, mid = L + (W - L) / 2;
    var spot = v.underSpot, out = '<svg class="prof" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Net GEX by strike"><line class="ax" x1="' + mid + '" x2="' + mid + '" y1="0" y2="' + H + '"/>';
    p.slice().sort(function (a, b) { return b.k - a.k; }).forEach(function (x, i) {
      var y = 4 + i * ((H - 8) / n), w = Math.abs(x.g) / max * ((W - L) / 2 - 4);
      out += '<rect x="' + (x.g >= 0 ? mid : mid - w) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="1.5" fill="' + (x.g >= 0 ? 'var(--bull)' : 'var(--bear)') + '" opacity=".85"/>';
      if (i % Math.ceil(n / 10) === 0) out += '<text x="' + (L - 8) + '" y="' + (y + bh / 2 + 4).toFixed(1) + '" text-anchor="end">' + C.fmtNum(x.k, x.k % 1 ? 1 : 0) + '</text>';
      if (spot != null && i < n - 1) { var nx = p.slice().sort(function (a, b) { return b.k - a.k; })[i + 1]; if (x.k >= spot && nx.k < spot) out += '<line x1="' + L + '" x2="' + W + '" y1="' + (y + bh + 1).toFixed(1) + '" y2="' + (y + bh + 1).toFixed(1) + '" stroke="var(--gold)" stroke-dasharray="4 4"/>'; }
    });
    return out + '</svg>';
  }

  // MARKET STATS
  RENDER.stats = function (el) {
    var RANGES = [['3m', 'Last 3 months', 92], ['6m', 'Last 6 months', 183], ['1y', 'Last year', 365], ['3y', 'All', 0]];
    var st = S.ms;
    var draw = function (data, err) {
      var rep = MS.REPORTS[st.rep];
      var h = '<div class="wrap">' + head('Market Stats', 'How often sessions behaved a certain way, with the sample size and a 95% range on every number. History, not a forecast.') +
        '<div class="ms-bar"><select class="inp" id="ms-sym" style="width:280px">' + D.MS_SYMS.map(function (s) { return '<option value="' + s[0] + '"' + (s[0] === st.sym ? ' selected' : '') + '>' + s[0] + ' · ' + esc(s[2]) + '</option>'; }).join('') + '</select>' +
        '<select class="inp" id="ms-rep" style="width:280px">' + Object.keys(MS.REPORTS).map(function (k) { return '<option value="' + k + '"' + (k === st.rep ? ' selected' : '') + '>' + esc(MS.REPORTS[k].title) + '</option>'; }).join('') + '</select>' +
        '<div class="seg" role="group" aria-label="Dates">' + RANGES.map(function (r) { return '<button type="button" data-msr="' + r[0] + '" aria-pressed="' + (r[0] === st.range) + '">' + r[1] + '</button>'; }).join('') + '</div></div>' +
        '<p class="sub" style="margin:0 0 16px">' + esc(rep.blurb) + '</p>';
      if (err) h += '<div class="card"><div class="empty"><b>Could not load the data</b><p>Try again in a minute.</p><button class="btn" type="button" data-act="ms-retry">Try again</button></div></div>';
      else if (!data) h += '<div class="ms-cards">' + [1, 2, 3, 4, 5, 6].map(function () { return '<div class="msc"><div class="skel" style="height:96px"></div></div>'; }).join('') + '</div>';
      else {
        var r = RANGES.filter(function (x) { return x[0] === st.range; })[0], last = data.rows.length ? data.rows[data.rows.length - 1].date : '';
        var from = r[2] && last ? new Date(Date.parse(last) - r[2] * 864e5).toISOString().slice(0, 10) : '';
        var res = MS.run(st.rep, data.rows, { from: from, dow: -1, bucket: 'any', session: 'ny' });
        h += '<p class="foot" style="margin:0 0 12px">' + res.sessions + ' sessions' + (last ? ' · last ' + esc(last) : '') + '</p><div class="ms-cards">' + res.cards.filter(function (c) { return !c.group; }).map(function (c) {
          var s = c.s, held = s.guard === 'withheld';
          return '<div class="msc' + (c.main ? ' main' : '') + '"><b>' + esc(c.title) + '</b><span class="foot">' + esc(c.sub) + '</span>' +
            '<span class="pct">' + (held ? '—' : MS.pct(s.p)) + '</span>' +
            (held ? '<span class="ci">Too few sessions (' + s.n + ') to show a number.</span>' : '<div class="bar" aria-hidden="true"><i style="left:' + (s.lo * 100) + '%;width:' + ((s.hi - s.lo) * 100) + '%"></i><u style="left:calc(' + (s.p * 100) + '% - 1px)"></u></div>' +
            '<span class="ci">' + s.k + ' of ' + s.n + ' sessions · 95% range ' + MS.pct(s.lo) + ' to ' + MS.pct(s.hi) + (s.guard === 'low' ? ' · small sample' : '') + '</span>') + '</div>';
        }).join('') + '</div>' + (D.STUB ? '<p class="foot" style="margin-top:12px">Sample data.</p>' : '');
      }
      el.innerHTML = h + '</div>';
      $('#ms-sym', el).addEventListener('change', function (e) { st.sym = e.target.value; ls.set('tz_desktop_ms', st); load(); });
      $('#ms-rep', el).addEventListener('change', function (e) { st.rep = e.target.value; ls.set('tz_desktop_ms', st); load(); });
    };
    var load = function () { draw(null); D.marketStats(st.sym).then(function (d) { if (S.screen === 'stats') draw(d); }, function () { if (S.screen === 'stats') draw(null, true); }); };
    el._load = load; el._draw = function () { load(); };
    load();
  };

  // JOURNAL
  RENDER.journal = function (el) {
    var draw = function () {
      var t = S.journal, m = S.month, label = new Date(m + '-15').toLocaleDateString([], { month: 'long', year: 'numeric' });
      var h = '<div class="wrap">' + head('Journal', 'A summary of the trades you logged in Nemesis. Add and edit trades on the website.',
        '<button class="ib" type="button" data-month="-1" aria-label="Previous month">' + '<svg class="ic" viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg></button><span class="h3 num" style="min-width:160px;text-align:center">' + esc(label) + '</span>' +
        '<button class="ib" type="button" data-month="1" aria-label="Next month"><svg class="ic" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button>' +
        '<button class="btn" type="button" data-open="/trade-journal">' + ic('ext') + 'Open Nemesis</button>');
      if (!S.user && !D.STUB) h += '<div class="card">' + signInCard('your journal') + '</div>';
      else if (!t) h += '<div class="card"><div class="skel" style="height:320px"></div></div>';
      else {
        var st = C.monthStats(m, t), cells = C.monthCells(m, st.perDay), cls = function (v) { return v == null ? '' : v >= 0 ? 'up' : 'dn'; };
        h += '<div class="card" style="margin-bottom:16px"><div class="stats">' +
          '<div class="stat"><span class="lbl">Net for the month</span><b class="' + cls(st.closed ? st.net : null) + '">' + (st.closed ? C.fmtUsd(st.net) : '—') + '</b></div>' +
          '<div class="stat"><span class="lbl">Green days</span><b>' + (st.tradedDays ? st.winDays + ' of ' + st.tradedDays : '—') + '</b></div>' +
          '<div class="stat"><span class="lbl">Average closed trade</span><b class="' + cls(st.avg) + '">' + (st.avg != null ? C.fmtUsd(st.avg) : '—') + '</b></div>' +
          '<div class="stat"><span class="lbl">Trades logged</span><b>' + st.trades + '</b></div></div></div>' +
          '<div class="card"><div class="cal"><span class="wd">Mon</span><span class="wd">Tue</span><span class="wd">Wed</span><span class="wd">Thu</span><span class="wd">Fri</span>' + cells.map(function (c) {
            if (!c) return '<span></span>';
            return '<div class="d' + (c.pnl == null ? '' : c.pnl >= 0 ? ' w' : ' l') + '"><span class="n num">' + c.day + '</span><span class="v ' + cls(c.pnl) + '">' + (c.pnl == null ? '' : C.fmtUsd(c.pnl)) + '</span></div>';
          }).join('') + '</div></div>' + (D.STUB ? '<p class="foot" style="margin-top:12px">Sample data.</p>' : '<p class="foot" style="margin-top:12px">Your own logged trades. Education only. Not financial advice.</p>');
      }
      el.innerHTML = h + '</div>';
    };
    el._draw = draw; draw();
    if (!S.journal && (S.user || D.STUB)) D.journal().then(function (t) { S.journal = t || []; if (S.screen === 'journal') draw(); }, function () { S.journal = []; draw(); });
  };

  // LEARN
  RENDER.learn = function (el) {
    var draw = function () {
      var m = S.learn;
      var h = '<div class="wrap">' + head('Learn', 'Mentis: the TradeZoro curriculum. Lessons open in your browser; your progress syncs to your account.');
      if (!m) h += '<div class="card"><div class="skel" style="height:320px"></div></div>';
      else {
        var c = m.cont, first = m.sections[0] && m.sections[0][1][0], ch = c ? c.chapter : first && first.chapter;
        if (ch) h += '<div class="card" style="margin-bottom:16px"><div class="cont">' + IMG('mentis', 56) + '<div class="tx"><span class="lbl">' + (c ? 'Continue · chapter ' + esc(ch.num) + ', lesson ' + (c.lesson + 1) : 'Start here') + '</span><b>' + esc(c ? c.lessonTitle : ch.title) + '</b>' +
          '<div class="prog"><i style="width:' + (m.total ? Math.round(m.done / m.total * 100) : 0) + '%"></i></div><span class="foot num">' + m.done + ' of ' + m.total + ' core lessons done' + (S.user || D.STUB ? '' : ' · sign in to track progress') + '</span></div>' +
          '<button class="btn btn-p" type="button" data-chapter="' + esc(ch.num) + '">' + (c ? 'Resume' : 'Start') + '</button></div></div>';
        h += m.sections.map(function (sec) {
          return '<div class="card" style="margin-bottom:16px"><div class="card-h"><h2 class="h3">' + esc(sec[0]) + '</h2><span class="lbl num">' + sec[1].length + ' chapters</span></div>' + sec[1].map(function (p) {
            var done = p.done === p.total && p.total > 0;
            return '<button class="chap" type="button" data-chapter="' + esc(p.chapter.num) + '"><span class="no' + (done ? ' done' : '') + '">' + (done ? ic('check') : esc(p.chapter.num)) + '</span><span class="tx"><b>' + esc(p.chapter.title) + '</b><span class="num">' + p.done + ' of ' + p.total + ' lessons</span></span>' +
              '<span style="width:120px" class="prog"><i style="width:' + (p.total ? Math.round(p.done / p.total * 100) : 0) + '%"></i></span></button>';
          }).join('') + '</div>';
        }).join('');
      }
      el.innerHTML = h + '</div>';
    };
    el._draw = draw; draw();
    if (!S.learn) D.learn().then(function (m) { S.learn = m; if (S.screen === 'learn') draw(); });
  };

  // SETTINGS / ACCOUNT
  RENDER.settings = function (el) {
    var info = S.info, p = info.prefs || {};
    var HK = [['CommandOrControl+Shift+Space', (IS_MAC ? '⌘' : 'Ctrl') + ' Shift Space'], ['CommandOrControl+Alt+T', (IS_MAC ? '⌘ ⌥' : 'Ctrl Alt') + ' T'], ['Alt+Shift+Z', (IS_MAC ? '⌥' : 'Alt') + ' Shift Z'], ['off', 'Off']];
    var u = S.user, sw = function (id, on) { return '<button class="sw" type="button" role="switch" id="' + id + '" aria-checked="' + !!on + '"></button>'; };
    el.innerHTML = '<div class="wrap"><div class="set">' + head('Settings') +
      '<div class="set-g"><span class="lbl">Account</span><div class="set-c">' + (u ? '<div class="acct"><span class="av" id="set-av"></span><div class="tx" style="flex:1;min-width:0;display:flex;flex-direction:column"><b class="h3">' + esc(u.displayName || 'TradeZoro member') + '</b><span class="sub">' + esc(u.email || '') + '</span></div>' +
        '<button class="btn" type="button" data-open="/account">' + ic('ext') + 'Manage account</button><button class="btn btn-g" type="button" data-act="signout">' + ic('out') + 'Sign out</button></div>' :
        '<div class="set-r"><div class="tx"><b>Not signed in</b><span>Sign in to sync watchlists, alerts and your progress.</span></div><button class="btn btn-p" type="button" data-act="signin">Sign in</button></div>') + '</div></div>' +
      '<div class="set-g"><span class="lbl">Appearance</span><div class="set-c"><div class="set-r"><div class="tx"><b>Theme</b><span>The chart follows the same theme.</span></div><div class="seg" role="group" aria-label="Theme">' +
        [['night', 'Dark'], ['day', 'Light'], ['system', 'System']].map(function (t) { return '<button type="button" data-themeopt="' + t[0] + '" aria-pressed="' + (themePref() === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div></div></div></div>' +
      '<div class="set-g"><span class="lbl">Desktop</span><div class="set-c">' +
        (info.login != null ? '<div class="set-r"><div class="tx"><b>Start at login</b><span>Opens quietly in the ' + (IS_MAC ? 'menu bar' : 'tray') + ' so alerts arrive.</span></div>' + sw('set-login', info.login) + '</div>' : '') +
        '<div class="set-r"><div class="tx"><b>Notifications</b><span>Price alerts and account messages as ' + (IS_MAC ? 'macOS' : PLATFORM === 'win32' ? 'Windows' : 'system') + ' notifications.</span></div>' + sw('set-notify', p.notify !== false) + '</div>' +
        '<div class="set-r"><div class="tx"><b>Prices in the ' + (IS_MAC ? 'menu bar' : 'tray') + '</b><span>Your watchlist\'s first symbols, updated every 30 seconds.</span></div>' + sw('set-tray', p.trayPrices !== false) + '</div>' +
        '<div class="set-r"><div class="tx"><b>Show / hide shortcut</b><span>Works from any app.' + (info.hotkeyOk === false && p.hotkey !== 'off' ? ' This one is taken by another app.' : '') + '</span></div><select class="inp" id="set-hk">' + HK.map(function (h) { return '<option value="' + h[0] + '"' + (p.hotkey === h[0] ? ' selected' : '') + '>' + h[1] + '</option>'; }).join('') + '</select></div>' +
        '<div class="set-r"><div class="tx"><b>Command palette</b><span>Symbols, screens, tools and settings.</span></div><kbd>' + (IS_MAC ? '⌘ K' : 'Ctrl K') + '</kbd></div></div></div>' +
      '<div class="set-g"><span class="lbl">Updates</span><div class="set-c"><div class="set-r"><div class="tx"><b>TradeZoro ' + esc(info.version || '') + '</b><span id="set-upd">' + (IS_MAC ? 'New versions show a banner with a download link.' : 'Updates download by themselves and install when you quit.') + '</span></div><button class="btn" type="button" data-act="check-upd">Check for updates</button></div></div></div>' +
      '<p class="foot" style="text-align:center">Education only. Not financial advice.</p></div></div>';
    if (u) $('#set-av', el).innerHTML = window.TZBar.avatarHtml({ name: u.displayName, email: u.email, photo: u.photoURL });
    var swClick = function (id, fn) { var b = $('#' + id, el); if (b) b.addEventListener('click', function () { var on = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(on)); fn(on); }); };
    swClick('set-login', function (on) { A.startAtLogin(on); S.info.login = on; });
    swClick('set-notify', function (on) { A.prefs({ notify: on }); p.notify = on; });
    swClick('set-tray', function (on) { A.prefs({ trayPrices: on }); p.trayPrices = on; });
    $('#set-hk', el).addEventListener('change', function (e) { A.prefs({ hotkey: e.target.value }); p.hotkey = e.target.value; setTimeout(refreshInfo, 300); });
  };

  // SIGN-IN
  RENDER.signin = function (el) {
    el.innerHTML = '<div class="signin"><div class="si-art"><img src="tzapp://app/img/wordmark.webp" alt="TradeZoro" style="height:24px;width:auto;align-self:flex-start" class="tb-mark">' +
      '<h1 class="h1">Charts, levels, alerts and lessons, in one desktop app.</h1><p class="sub" style="max-width:420px">Sign in with your TradeZoro account. Your watchlists, alerts and progress stay in step with the website and the phone app.</p>' +
      '<div class="si-icons">' + ['zorocharts', 'omega', 'market-stats', 'nemesis', 'mentis', 'kronos', 'phantom', 'liquidity-map'].map(function (n) { return IMG(n, 64); }).join('') + '</div>' +
      '<p class="foot">Education only. Not financial advice.</p></div>' +
      '<div class="si-form"><div class="si-box"><h2 class="h2">Sign in</h2>' +
      '<button class="btn btn-lg" type="button" id="si-google">' + G_MARK + '<span>Continue with Google</span></button>' +
      (D.Auth.passkeySupported() ? '<button class="btn btn-lg" type="button" id="si-pk">' + ic('key') + '<span>Sign in with a passkey</span></button>' : '') +
      '<div class="or">or with email</div>' +
      '<label class="field"><span class="lbl">Email</span><input class="inp" id="si-email" type="email" autocomplete="username" spellcheck="false"></label>' +
      '<label class="field"><span class="lbl">Password</span><input class="inp" id="si-pass" type="password" autocomplete="current-password"></label>' +
      '<p class="err" id="si-err" role="alert"></p>' +
      '<button class="btn btn-p btn-lg" type="button" id="si-go">Sign in</button>' +
      '<div style="display:flex;justify-content:space-between"><button class="linkb" type="button" id="si-reset">Forgot password?</button><button class="linkb" type="button" data-open="/signup">Create an account</button></div>' +
      '<div class="or"></div><button class="btn btn-g" type="button" id="si-guest">Continue without signing in</button></div></div></div>';
    var err = function (m) { $('#si-err', el).textContent = m || ''; };
    var busy = function (b, on, txt) { b.disabled = on; if (txt) b.querySelector('span') ? (b.querySelector('span').textContent = txt) : (b.textContent = txt); };
    var friendly = function (e) {
      var c = e && e.code || '';
      if (/wrong-password|invalid-credential|user-not-found|invalid-login/.test(c)) return 'That email and password do not match.';
      if (/too-many-requests/.test(c)) return 'Too many tries. Wait a minute and try again.';
      if (/network/.test(c)) return 'No connection. Check your internet and try again.';
      if (/invalid-email/.test(c)) return 'Enter a valid email address.';
      return e && e.message && e.message.length < 120 ? e.message : 'Sign-in failed. Try again.';
    };
    $('#si-google', el).addEventListener('click', function () {
      var b = this; err(''); busy(b, true, 'Finish in your browser…');
      D.Auth.google().catch(function (e) { if (!/cancelled/.test(e.message)) err(/timeout/.test(e.message) ? 'Sign-in timed out. Try again.' : /no-browser/.test(e.message) ? 'Could not open your browser.' : 'Google sign-in did not finish. Try again.'); })
        .then(function () { busy(b, false, 'Continue with Google'); });
    });
    var pk = $('#si-pk', el);
    if (pk) pk.addEventListener('click', function () { err(''); D.Auth.passkey().catch(function (e) { if (!/NotAllowed|abort/i.test(e && e.name || '')) err(e.message || 'Passkey sign-in failed.'); }); });
    var submit = function () {
      var b = $('#si-go', el), em = $('#si-email', el).value, pw = $('#si-pass', el).value;
      if (!em || !pw) return err('Enter your email and password.');
      err(''); busy(b, true, 'Signing in…');
      D.Auth.email(em, pw).catch(function (e) { err(friendly(e)); }).then(function () { busy(b, false, 'Sign in'); });
    };
    $('#si-go', el).addEventListener('click', submit);
    $('#si-pass', el).addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    $('#si-reset', el).addEventListener('click', function () {
      var em = $('#si-email', el).value; if (!em) return err('Enter your email first, then choose Forgot password.');
      D.Auth.reset(em).then(function () { err(''); toast('Check your email for a reset link.'); }, function (e) { err(friendly(e)); });
    });
    $('#si-guest', el).addEventListener('click', function () { S.guest = true; ls.set('tz_desktop_guest', true); go(ls.get('tz_desktop_screen', 'home')); });
  };

  // ---------- overlays: dialogs, menus, command palette ----------
  function closeLayer() { var had = !!$('#layer').firstChild; $('#layer').innerHTML = ''; if (had) chartCover(false); }
  function openDialog(html) {
    closeLayer(); chartCover(true);
    var s = document.createElement('div'); s.className = 'scrim'; s.innerHTML = html;
    s.addEventListener('mousedown', function (e) { if (e.target === s) closeLayer(); });
    $$('[data-close]', s).forEach(function (b) { b.addEventListener('click', closeLayer); });
    $('#layer').appendChild(s);
    return s;
  }
  function openMenu(anchor, items) {
    closeLayer(); chartCover(true);
    var r = anchor.getBoundingClientRect(), m = document.createElement('div');
    m.className = 'menu'; m.setAttribute('role', 'menu');
    m.innerHTML = items.map(function (it, i) { return it === '-' ? '<hr>' : '<button type="button" role="menuitem" data-i="' + i + '"' + (it.danger ? ' class="danger"' : '') + '>' + (it.icon ? ic(it.icon) : '') + esc(it.t) + '</button>'; }).join('');
    var wrap = document.createElement('div'); wrap.style.cssText = 'position:fixed;inset:0;z-index:59';
    wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) closeLayer(); });
    wrap.appendChild(m); $('#layer').appendChild(wrap);
    var w = m.offsetWidth; m.style.top = (r.bottom + 4) + 'px'; m.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
    $$('button', m).forEach(function (b) { b.addEventListener('click', function () { var it = items[+b.getAttribute('data-i')]; closeLayer(); it.fn(); }); });
    var f = $('button', m); if (f) f.focus();
  }
  function promptDialog(title, value, okText, cb) {
    var d = openDialog('<div class="dlg" role="dialog" aria-modal="true"><div class="dlg-h"><h2 class="h2">' + esc(title) + '</h2><button class="ib" type="button" data-close aria-label="Close">' + ic('x') + '</button></div>' +
      '<input class="inp" id="pd-in" maxlength="60" value="' + esc(value || '') + '" autocomplete="off"><div class="dlg-a"><button class="btn btn-g" type="button" data-close>Cancel</button><button class="btn btn-p" type="button" id="pd-ok">' + esc(okText) + '</button></div></div>');
    var inp = $('#pd-in', d); inp.focus(); inp.select();
    var ok = function () { var v = C.cleanName(inp.value); if (!v) return; closeLayer(); cb(v); };
    $('#pd-ok', d).addEventListener('click', ok); inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') ok(); });
  }
  function confirmDialog(title, body, okText, cb) {
    var d = openDialog('<div class="dlg" role="alertdialog" aria-modal="true"><h2 class="h2">' + esc(title) + '</h2><p class="sub">' + esc(body) + '</p><div class="dlg-a"><button class="btn btn-g" type="button" data-close>Cancel</button><button class="btn btn-p" type="button" id="cd-ok">' + esc(okText) + '</button></div></div>');
    $('#cd-ok', d).addEventListener('click', function () { closeLayer(); cb(); }); $('#cd-ok', d).focus();
  }
  function addSymbolDialog() {
    var l = activeList(); if (!l) return;
    var d = openDialog('<div class="pal" role="dialog" aria-modal="true" aria-label="Add symbol"><div class="pal-in">' + ic('search') + '<input id="as-q" placeholder="Search symbols to add to ' + esc(l.name) + '" autocomplete="off" spellcheck="false"></div><div class="pal-l" id="as-l" role="listbox"></div></div>');
    var q = $('#as-q', d), sel = 0, res = [];
    var draw = function () {
      res = C.searchCatalog(q.value, 30);
      var raw = q.value.trim(); if (raw && !res.length) res = [C.symbolOf(raw)];
      $('#as-l', d).innerHTML = res.map(function (s, i) { var has = l.items.indexOf(s.id) >= 0; return '<button class="pal-i" type="button" role="option" data-i="' + i + '" aria-selected="' + (i === sel) + '"><span class="ico">' + esc(s.ticker.slice(0, 4)) + '</span><span class="tx"><b>' + esc(s.ticker) + '</b><span>' + esc(s.name + ' · ' + s.exchange) + '</span></span>' + (has ? '<span class="pill ok">In list</span>' : '') + '</button>'; }).join('');
    };
    var pick = function (i) { var s = res[i]; if (!s) return; var r = C.wlAdd(activeList(), s.id); if (!r.ok) return toast(r.why); saveList(r.list); refreshQuotes([s.id]).then(redraw); toast(s.ticker + ' added to ' + l.name + '.'); draw(); };
    q.addEventListener('input', function () { sel = 0; draw(); });
    q.addEventListener('keydown', function (e) { if (e.key === 'ArrowDown') { sel = Math.min(res.length - 1, sel + 1); draw(); e.preventDefault(); } else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); } else if (e.key === 'Enter') pick(sel); });
    $('#as-l', d).addEventListener('click', function (e) { var b = e.target.closest('[data-i]'); if (b) pick(+b.getAttribute('data-i')); });
    draw(); q.focus();
  }

  function paletteItems(q) {
    var out = [];
    SCREENS.forEach(function (s, i) { out.push({ g: 'Screens', title: s.title || s.label, sub: 'Go to ' + (s.title || s.label), kw: 'screen ' + s.id, icon: s.img ? IMG(s.img, 32) : s.icon, kbd: (IS_MAC ? '⌘' : 'Ctrl ') + (i + 1), run: function () { go(s.id); } }); });
    TOOLS.forEach(function (t) { out.push({ g: 'Tools', title: t.t, sub: t.s + (t.url ? ' · opens on tradezoro.com' : ''), kw: 'tool product', icon: IMG(t.img, 32), run: function () { runTool(t); } }); });
    var acts = [
      ['New alert', 'Create a price alert', 'bell', function () { go('alerts'); alertDialog(); }],
      ['New chart window', 'Open another chart window', 'win', function () { A.newChartWindow(); }],
      ['Pop out chart', 'Move the chart into its own window', 'pop', function () { A.popOut(); }],
      ['Theme: Dark', 'Appearance', 'sun', function () { ls.set('tz_desktop_theme', 'night'); applyTheme(); }],
      ['Theme: Light', 'Appearance', 'sun', function () { ls.set('tz_desktop_theme', 'day'); applyTheme(); }],
      ['Theme: System', 'Appearance', 'sun', function () { ls.set('tz_desktop_theme', 'system'); applyTheme(); }],
      ['Check for updates', 'Settings', 'up', function () { A.checkUpdates(); toast('Checking for updates…'); }],
      ['Settings', 'Theme, start at login, shortcuts, updates', 'gear', function () { go('settings'); }]
    ];
    if (S.user) acts.push(['Sign out', S.user.email || '', 'out', function () { D.Auth.signOut(); }]); else acts.push(['Sign in', 'Use your TradeZoro account', 'key', function () { showSignin(); }]);
    acts.forEach(function (a) { out.push({ g: 'Actions', title: a[0], sub: a[1], kw: 'setting action', icon: ic(a[2]), run: a[3] }); });
    var syms = C.searchCatalog(q, q ? 12 : 6).map(function (s) { return { g: 'Symbols', title: s.ticker, sub: s.name + ' · open chart', kw: s.id + ' ' + s.name, icon: '<span>' + esc(s.ticker.slice(0, 4)) + '</span>', run: function () { openChart(s.id); } }; });
    return q ? syms.concat(C.rankItems(out, q, 20)) : C.rankItems(out, '', 40).concat(syms);
  }
  function runTool(t) { if (t.go) go(t.go); else A.open(D.SITE + t.url); }
  function openPalette(q0) {
    var d = openDialog('<div class="pal" role="dialog" aria-modal="true" aria-label="Command palette"><div class="pal-in">' + ic('search') + '<input id="pal-q" placeholder="Search symbols, screens, tools and settings" autocomplete="off" spellcheck="false" aria-controls="pal-l"></div><div class="pal-l" id="pal-l" role="listbox"></div>' +
      '<div class="pal-f foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div></div>');
    var q = $('#pal-q', d), list = [], sel = 0;
    var draw = function () {
      list = paletteItems(q.value.trim());
      var g = null, h = '';
      list.forEach(function (it, i) {
        if (it.g !== g) { g = it.g; h += '<div class="pal-g">' + esc(g) + '</div>'; }
        h += '<button class="pal-i" type="button" role="option" data-i="' + i + '" aria-selected="' + (i === sel) + '"><span class="ico">' + it.icon + '</span><span class="tx"><b>' + esc(it.title) + '</b><span>' + esc(it.sub) + '</span></span>' + (it.kbd ? '<kbd>' + esc(it.kbd) + '</kbd>' : '') + '</button>';
      });
      $('#pal-l', d).innerHTML = h || '<div class="empty"><b>No matches</b></div>';
      var s = $('[aria-selected="true"]', d); if (s) s.scrollIntoView({ block: 'nearest' });
    };
    var run = function (i) { var it = list[i]; if (!it) return; closeLayer(); it.run(); };
    q.addEventListener('input', function () { sel = 0; draw(); });
    q.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { sel = Math.min(list.length - 1, sel + 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
      else if (e.key === 'Enter') run(sel);
    });
    $('#pal-l', d).addEventListener('click', function (e) { var b = e.target.closest('[data-i]'); if (b) run(+b.getAttribute('data-i')); });
    if (typeof q0 === 'string' && q0) q.value = q0;
    draw(); q.focus();
  }

  // ---------- update banner (state from src/updates.js via main) ----------
  function drawUpdate(st) {
    S.update = st;
    var chip = $('#tb-upd'), old = $('.ubar'), blk = $('.ublock');
    if (old) old.remove(); if (blk) blk.remove();
    chip.hidden = true;
    if (!st) return;
    var v = esc(st.version);
    if (st.kind === 'block') {
      var b = document.createElement('div'); b.className = 'ublock'; b.setAttribute('role', 'alertdialog');
      b.innerHTML = '<div class="dlg" style="text-align:center;align-items:center"><h2 class="h2">Please update to keep using TradeZoro</h2><p class="sub">' + (st.ready ? 'Version ' + v + ' is ready. Restart TradeZoro to finish.' : 'Get the newest version from tradezoro.com.') + '</p><button class="btn btn-p btn-lg" type="button" data-upd="' + (st.ready ? 'install' : 'download') + '">' + (st.ready ? 'Restart to update' : 'Download the update') + '</button></div>';
      document.body.appendChild(b); chartCover(true); return;
    }
    chip.hidden = false;
    chip.textContent = st.kind === 'ready' ? 'Restart to update' : 'Update available';
    chip.setAttribute('data-upd', st.kind === 'ready' ? 'install' : 'download');
    chip.title = (st.kind === 'ready' ? 'Version ' + st.version + ' is ready' : 'Version ' + st.version + ' is available') + (st.note ? ': ' + st.note : '');
  }

  // ---------- events ----------
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-go],[data-act],[data-sym],[data-wl],[data-tool],[data-chapter],[data-open],[data-gex],[data-msr],[data-themeopt],[data-month],[data-upd],[data-w]');
    if (!t) return;
    if (t.hasAttribute('data-w')) return A.win(t.getAttribute('data-w'));
    if (t.hasAttribute('data-upd')) return A.updateAction(t.getAttribute('data-upd'));
    if (t.hasAttribute('data-go')) return go(t.getAttribute('data-go'));
    if (t.hasAttribute('data-tool')) return runTool(TOOLS[+t.getAttribute('data-tool')]);
    if (t.hasAttribute('data-chapter')) return A.open(D.SITE + '/chapter.html?ch=' + encodeURIComponent(t.getAttribute('data-chapter')));
    if (t.hasAttribute('data-open')) return A.open(D.SITE + t.getAttribute('data-open'));
    if (t.hasAttribute('data-wl')) { S.wl = t.getAttribute('data-wl'); D.Watchlists.setActive(S.wl); redraw(); var l = activeList(); if (l) refreshQuotes(C.symbolsOf(l.items)).then(redraw); return; }
    if (t.hasAttribute('data-gex')) { S.gexMarket = +t.getAttribute('data-gex'); redraw(); if (!S.gex[C.GEX_MARKETS[S.gexMarket].fut]) loadGex(S.gexMarket).then(redraw); return; }
    if (t.hasAttribute('data-msr')) { S.ms.range = t.getAttribute('data-msr'); ls.set('tz_desktop_ms', S.ms); return $('.scr')._load(); }
    if (t.hasAttribute('data-themeopt')) { ls.set('tz_desktop_theme', t.getAttribute('data-themeopt')); applyTheme(); $$('[data-themeopt]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === t)); }); return; }
    if (t.hasAttribute('data-month')) { var d = new Date(S.month + '-15'); d.setMonth(d.getMonth() + +t.getAttribute('data-month')); S.month = d.toISOString().slice(0, 7); return redraw(); }
    if (t.hasAttribute('data-sym') && !t.hasAttribute('data-act')) { if (e.target.closest('.ra,.grip')) return; return openChart(C.canonicalId(t.getAttribute('data-sym'))); }
    var a = t.getAttribute('data-act'), id = t.getAttribute('data-id');
    if (a === 'signin') return showSignin();
    if (a === 'signout') return D.Auth.signOut();
    if (a === 'popout') return A.popOut();
    if (a === 'new-chart') return A.newChartWindow();
    if (a === 'chart-reload') return A.chartReload();
    if (a === 'check-upd') { A.checkUpdates(); $('#set-upd') && ($('#set-upd').textContent = 'Checking…'); return; }
    if (a === 'gex-retry') { delete S.gex[C.GEX_MARKETS[S.gexMarket].fut]; redraw(); return loadGex(S.gexMarket).then(redraw); }
    if (a === 'gex-chart') return openChart('futures:' + C.GEX_MARKETS[S.gexMarket].fut + '1!');
    if (a === 'ms-retry') return $('.scr')._load();
    if (a === 'wl-add') return addSymbolDialog();
    if (a === 'wl-rm') { var l2 = activeList(); if (l2) saveList(C.wlRemove(l2, id)); return; }
    if (a === 'wl-new') {
      if (S.lists.length >= C.MAX_LISTS) return toast('You can have up to ' + C.MAX_LISTS + ' lists.');
      return promptDialog('New list', 'Watchlist ' + (S.lists.length + 1), 'Create', function (name) {
        var l3 = { id: C.newListId(), name: name, items: [], collapsed: [], view: {}, shared: false };
        S.lists.push(l3); S.wl = l3.id; D.Watchlists.setActive(l3.id); saveList(l3);
      });
    }
    if (a === 'wl-menu') {
      var cur = activeList();
      return openMenu(t, [
        { t: 'Rename list', fn: function () { promptDialog('Rename list', cur.name, 'Save', function (n) { saveList(Object.assign({}, cur, { name: n })); }); } },
        { t: 'Add symbol', fn: addSymbolDialog }, '-',
        { t: 'Delete list', danger: true, fn: function () { confirmDialog('Delete "' + cur.name + '"?', 'This removes the list from every device signed in to your account.', 'Delete', function () {
          D.Watchlists.remove(cur).then(function () { S.lists = S.lists.filter(function (x) { return x.id !== cur.id; }); S.wl = S.lists[0] && S.lists[0].id; if (S.wl) D.Watchlists.setActive(S.wl); redraw(); pushTray(); }, function () { toast('Could not delete the list.'); });
        }); } }
      ]);
    }
    if (a === 'al-new') return alertDialog();
    var al = (S.alerts || []).filter(function (x) { return x.id === id; })[0];
    if (a === 'al-toggle' && al) return D.Alerts.setActive(al, !al.active).then(function () { if (!S.user) watchAlerts(); }, function () { toast('Could not change the alert.'); });
    if (a === 'al-del' && al) return confirmDialog('Delete this alert?', al.ticker + ' ' + C.ALERT_CONDS[al.cond].toLowerCase() + ' ' + C.alertPrice(al.price), 'Delete', function () { D.Alerts.remove(al).then(function () { if (!S.user) watchAlerts(); }, function () { toast('Could not delete the alert.'); }); });
  });
  document.addEventListener('keydown', function (e) {
    var mod = IS_MAC ? e.metaKey : e.ctrlKey;
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); if ($('.pal')) closeLayer(); else openPalette(); return; }
    if (mod && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key) && S.screen !== 'signin') { e.preventDefault(); go(SCREENS[+e.key - 1].id); return; }
    if (mod && e.key === ',') { e.preventDefault(); go('settings'); return; }
    if (e.key === 'Escape' && $('#layer').firstChild) { closeLayer(); }
  });
  function showSignin() { S.guest = false; ls.set('tz_desktop_guest', false); go('signin'); }

  A.onGoto(function (id) { if (S.screen !== 'signin') go(id); });
  A.onPalette(function () { if (S.screen !== 'signin') openPalette(); });
  A.onShown(function (v) { S.shown = v; });
  A.onWin(function (w) { bar.set({ maximized: !!w.maximized }); });
  A.onBarAct(function (m) { if (m) barAct(m.a, m.arg); });
  A.onChart(function (c) { S.chartLoaded = !!c.loaded; var l = $('.chart-load'); if (l && c.loaded) l.remove(); else if (l && c.error) l.innerHTML = '<div class="empty"><b>The chart did not load</b><p>Check your connection.</p><button class="btn" type="button" data-act="chart-reload">Try again</button></div>'; });
  A.onUpdate(drawUpdate);
  A.onUpdateCheck(function (r) {
    var m = !r.ok ? (r.why === 'portable' ? 'The portable version does not update itself. Get the newest one from tradezoro.com.' : r.why === 'dev' ? 'Updates are checked in the installed app.' : 'Could not check for updates. Try again later.')
      : r.available ? 'Version ' + r.version + ' is on its way.' : 'You have the latest version.';
    var el = $('#set-upd'); if (el) el.textContent = m; else toast(m);
  });
  function refreshInfo() { return A.info().then(function (i) { S.info = i; if (S.screen === 'settings') go('settings'); }); }

  // ---------- start ----------
  bar = window.TZBar.mount({ platform: PLATFORM, logo: 'tzapp://app/img/tzmark.webp', img: function (n) { return 'tzapp://app/img/' + n + '-64.webp'; }, act: barAct },
    { logo: $('#tb-logo'), search: $('#tb-search'), end: $('#tb-end') });
  applyTheme();
  if (D.STUB) $('#tb-sample').hidden = false;
  S.ms = Object.assign(S.ms, ls.get('tz_desktop_ms', {}));
  if (!MS.REPORTS[S.ms.rep]) S.ms.rep = 'gap';
  S.guest = ls.get('tz_desktop_guest', false) === true;
  A.info().then(function (i) { S.info = i; });
  A.updateState().then(drawUpdate).catch(function () {});
  // Paint Home straight away from what this computer knows; the auth answer (IndexedDB) follows in a few ms.
  var started = false;
  D.Auth.onChange(function (u) {
    var was = S.user && S.user.uid;
    S.user = u; setAvatar();
    if ((u && u.uid) !== was) { S.lists = []; S.quotes = {}; S.alerts = null; S.fires = []; S.gex = {}; S.learn = null; S.journal = null; S.plan = ''; watchAlerts();
      if (u) D.plan().then(function (p) { if (S.user === u) { S.plan = p; setAvatar(); } }); }
    if (u) S.guest = false;
    if (!started || S.screen === 'signin' || (u && u.uid) !== was) { started = true; go(u || S.guest ? (S.screen && S.screen !== 'signin' ? S.screen : ls.get('tz_desktop_screen', 'home')) : 'signin'); }
    else if (!u && !S.guest) go('signin');
  });
  A.info().then(function (i) { if (i && i.win) bar.set({ maximized: !!i.win.maximized }); });
  window.__tzUi = { bar: function () { return bar; }, go: go, state: S, openPalette: openPalette, closeLayer: closeLayer, alertDialog: alertDialog, addSymbolDialog: addSymbolDialog };
})();
