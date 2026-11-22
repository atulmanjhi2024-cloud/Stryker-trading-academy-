// TradeZoro Desktop 2.0: pure data rules for the native screens (no DOM, no Electron).
// Every rule here is the Android app's (android/native/app/src/main/java/com/tradezoro/app/data/*.kt), which in turn
// follows the website's own modules; the file names are given per function so the three stay in step.
// Loads as a classic script in the app window (window.TZCore) and under node for test/core.test.js.
(function (root) {
  'use strict';

  // ---------- symbols (Symbols.kt, assets/chart-watchlist.js ids) ----------
  var SECTION = '###';
  var CRYPTO_VENUES = ['binance', 'coinbase', 'hyperliquid', 'bybit', 'okx', 'bitget', 'kraken', 'vest'];
  // [id, name, exchange, tick]
  var CATALOG = [
    ['futures:NQ1!', 'Nasdaq-100 E-mini', 'CME', 0.25], ['futures:MNQ1!', 'Micro Nasdaq-100 E-mini', 'CME', 0.25],
    ['futures:ES1!', 'S&P 500 E-mini', 'CME', 0.25], ['futures:MES1!', 'Micro S&P 500 E-mini', 'CME', 0.25],
    ['futures:YM1!', 'Dow Jones E-mini', 'CBOT', 1], ['futures:MYM1!', 'Micro Dow Jones E-mini', 'CBOT', 1],
    ['futures:RTY1!', 'Russell 2000 E-mini', 'CME', 0.1], ['futures:M2K1!', 'Micro Russell 2000 E-mini', 'CME', 0.1],
    ['futures:GC1!', 'Gold', 'COMEX', 0.1], ['futures:MGC1!', 'Micro Gold', 'COMEX', 0.1],
    ['futures:SI1!', 'Silver', 'COMEX', 0.005], ['futures:SIL1!', 'Micro Silver', 'COMEX', 0.005],
    ['futures:HG1!', 'Copper', 'COMEX', 0.0005], ['futures:CL1!', 'Crude Oil WTI', 'NYMEX', 0.01],
    ['futures:MCL1!', 'Micro WTI Crude Oil', 'NYMEX', 0.01], ['futures:NG1!', 'Natural Gas', 'NYMEX', 0.001],
    ['futures:ZN1!', '10-Year T-Note', 'CBOT', 0.015625], ['futures:ZB1!', 'U.S. Treasury Bond', 'CBOT', 0.03125],
    ['futures:6E1!', 'Euro FX', 'CME', 0.00005],
    ['fx:EURUSD', 'Euro / U.S. Dollar', 'Forex', 0.00001], ['fx:GBPUSD', 'British Pound / U.S. Dollar', 'Forex', 0.00001],
    ['fx:USDJPY', 'U.S. Dollar / Japanese Yen', 'Forex', 0.001], ['fx:AUDUSD', 'Australian Dollar / U.S. Dollar', 'Forex', 0.00001],
    ['fx:USDCAD', 'U.S. Dollar / Canadian Dollar', 'Forex', 0.00001], ['fx:USDCHF', 'U.S. Dollar / Swiss Franc', 'Forex', 0.00001],
    ['fx:NZDUSD', 'New Zealand Dollar / U.S. Dollar', 'Forex', 0.00001], ['fx:EURGBP', 'Euro / British Pound', 'Forex', 0.00001],
    ['fx:EURJPY', 'Euro / Japanese Yen', 'Forex', 0.001], ['fx:GBPJPY', 'British Pound / Japanese Yen', 'Forex', 0.001],
    ['idx:SPX', 'S&P 500 Index', 'Index', 0.01], ['idx:NDX', 'Nasdaq-100 Index', 'Index', 0.01],
    ['idx:VIX', 'CBOE Volatility Index', 'Index', 0.01], ['idx:RUT', 'Russell 2000 Index', 'Index', 0.01],
    ['idx:QQQ', 'Invesco QQQ', 'NASDAQ', 0.01], ['idx:SPY', 'SPDR S&P 500 ETF', 'NYSE', 0.01],
    ['binance:BTCUSDT', 'Bitcoin', 'Crypto', 0.01], ['binance:ETHUSDT', 'Ethereum', 'Crypto', 0.01],
    ['binance:SOLUSDT', 'Solana', 'Crypto', 0.01], ['binance:XRPUSDT', 'XRP', 'Crypto', 0.0001],
    ['binance:BNBUSDT', 'BNB', 'Crypto', 0.01], ['binance:DOGEUSDT', 'Dogecoin', 'Crypto', 0.00001]
  ];
  var BY_ID = {};
  CATALOG.forEach(function (c) { BY_ID[c[0]] = c; });

  // The site's default list (chart-watchlist.js DEFAULT_ITEMS): a new member's first list and the guest list.
  var DEFAULT_ITEMS = ['###FUTURES', 'futures:NQ1!', 'futures:ES1!', 'futures:YM1!', 'futures:RTY1!', 'futures:GC1!', 'futures:CL1!',
    '###FOREX', 'fx:EURUSD', 'fx:GBPUSD', 'fx:USDJPY', '###CRYPTO', 'binance:BTCUSDT', 'binance:ETHUSDT'];

  function isSection(s) { return typeof s === 'string' && s.indexOf(SECTION) === 0; }

  // "MNQ1!" / "CME_MINI:MNQ1!" -> "futures:MNQ1!"; "BTC" -> "binance:BTCUSDT"; known ids unchanged (canonicalId).
  function canonicalId(raw) {
    var s = String(raw || '').trim();
    var i = s.indexOf(':');
    if (i >= 0) {
      var pre = s.slice(0, i).toLowerCase(), tk = s.slice(i + 1);
      if (['futures', 'fx', 'idx', 'stocks', 'formula'].indexOf(pre) >= 0 || CRYPTO_VENUES.indexOf(pre) >= 0) return pre + ':' + tk;
      return canonicalId(tk);
    }
    var u = s.toUpperCase();
    var tries = ['futures:' + u, 'futures:' + u + '1!', 'fx:' + u, 'idx:' + u, 'binance:' + u, 'binance:' + u + 'USDT'];
    for (var k = 0; k < tries.length; k++) if (BY_ID[tries[k]]) return tries[k];
    return s;
  }

  function decimalsOf(tick) {
    var s = String(tick); if (/e-/.test(s)) return Number(s.split('e-')[1]);
    return s.indexOf('.') >= 0 ? s.length - s.indexOf('.') - 1 : 0;
  }

  // Any watchlist item -> display symbol {id, ticker, name, source, decimals, exchange, chartTicker}.
  function symbolOf(rawId) {
    var id = canonicalId(rawId), cat = BY_ID[id];
    var pre = id.indexOf(':') >= 0 ? id.slice(0, id.indexOf(':')) : '';
    var tk = id.slice(id.indexOf(':') + 1);
    var source = pre === 'futures' ? 'futures' : pre === 'fx' ? 'fx' : pre === 'idx' ? 'index' : (pre === 'binance' && /USDT$/.test(tk)) ? 'crypto' : 'other';
    var ticker = pre === 'stocks' ? tk.slice(tk.indexOf(':') + 1) : /[12]!$/.test(tk) ? tk.slice(0, -2) : (pre === 'binance' && /USDT$/.test(tk) && tk.length > 4) ? tk.slice(0, -4) : tk;
    var exchange = cat ? cat[2] : ({ futures: 'CME', fx: 'Forex', idx: 'Index' })[pre] || (CRYPTO_VENUES.indexOf(pre) >= 0 ? pre.charAt(0).toUpperCase() + pre.slice(1) : '');
    var dec = cat ? Math.min(5, decimalsOf(cat[3])) : 2;
    if (source === 'futures') dec = Math.max(2, dec);
    return { id: id, ticker: ticker, name: cat ? cat[1] : tk, source: source, decimals: dec, exchange: exchange, chartTicker: id.slice(id.lastIndexOf(':') + 1) };
  }
  // Crypto prices span 5 orders of magnitude: decimals follow the price.
  function decimalsFor(sym, price) {
    if (sym.source !== 'crypto') return sym.decimals;
    return price >= 1000 ? 0 : price >= 1 ? 2 : price >= 0.01 ? 4 : 6;
  }

  function searchCatalog(q, limit) {
    limit = limit || 30;
    var t = String(q || '').trim().toUpperCase().replace('/', '');
    if (!t) return CATALOG.slice(0, limit).map(function (c) { return symbolOf(c[0]); });
    var tk = function (c) { return c[0].slice(c[0].indexOf(':') + 1).toUpperCase(); };
    var first = CATALOG.filter(function (c) { return tk(c).indexOf(t) === 0; });
    var then = CATALOG.filter(function (c) { return first.indexOf(c) < 0 && (tk(c).indexOf(t) >= 0 || c[1].toUpperCase().indexOf(t) >= 0); });
    return first.concat(then).slice(0, limit).map(function (c) { return symbolOf(c[0]); });
  }

  // ---------- watchlists (Watchlists.kt, firestore.rules validWatchlist) ----------
  var MAX_LISTS = 20, MAX_SYMBOLS = 200, MAX_ITEMS = 260, NAME_MAX = 60;
  var TYPE_WORDS = { FUTURES: 'FUTURES', FOREX: 'FOREX', FX: 'FOREX', CRYPTO: 'CRYPTO', INDICES: 'INDICES', INDEX: 'INDICES', STOCKS: 'STOCKS', STOCK: 'STOCKS', ETF: 'STOCKS', ETFS: 'STOCKS' };
  function typeOf(id) {
    var pre = id.indexOf(':') >= 0 ? id.slice(0, id.indexOf(':')).toLowerCase() : '';
    if (pre === 'futures') return 'FUTURES';
    if (pre === 'fx') return 'FOREX';
    if (pre === 'idx') return ['SPX', 'NDX', 'VIX', 'RUT'].indexOf(id.slice(4)) >= 0 ? 'INDICES' : 'STOCKS';
    if (pre === 'stocks') return 'STOCKS';
    if (pre === 'formula' || pre === '') return 'OTHER';
    return 'CRYPTO';
  }
  function symbolsOf(items) { return (items || []).filter(function (s) { return !isSection(s); }); }
  function cleanName(s) { return String(s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, NAME_MAX); }
  // Where a new id goes: end of the section named after its type, else the end (insertAt).
  function insertAt(items, id) {
    var t = typeOf(id), start = -1;
    for (var i = 0; i < items.length; i++) if (isSection(items[i]) && TYPE_WORDS[items[i].slice(3).trim().toUpperCase()] === t) { start = i; break; }
    if (start < 0) return items.length;
    for (var j = start + 1; j < items.length; j++) if (isSection(items[j])) return j;
    return items.length;
  }
  // -> {ok, list} or {ok:false, why}
  function wlAdd(list, raw) {
    var id = canonicalId(raw);
    if (list.items.indexOf(id) >= 0) return { ok: false, why: symbolOf(id).chartTicker + ' is already in this list.' };
    if (symbolsOf(list.items).length >= MAX_SYMBOLS) return { ok: false, why: 'A list holds up to ' + MAX_SYMBOLS + ' symbols.' };
    if (list.items.length >= MAX_ITEMS) return { ok: false, why: 'This list is full.' };
    var items = list.items.slice(); items.splice(insertAt(items, id), 0, id);
    return { ok: true, list: Object.assign({}, list, { items: items }) };
  }
  function wlRemove(list, id) { return Object.assign({}, list, { items: list.items.filter(function (x) { return x !== id; }) }); }
  // Drag and drop: symbol id goes to the place of symbol over. Sections stay put.
  function wlMove(list, id, over) {
    if (id === over) return list;
    var items = list.items.slice(), from = items.indexOf(id), to = items.indexOf(over);
    if (from < 0 || to < 0) return list;
    items.splice(from, 1); items.splice(to, 0, id);
    return Object.assign({}, list, { items: items });
  }
  // Firestore fields exactly as the rules allow (updatedAt is added by the caller as a server timestamp).
  function wlFields(l) {
    var view = {}, n = 0;
    Object.keys(l.view || {}).forEach(function (k) { if (l.view[k] != null && n < 12) { view[k] = l.view[k]; n++; } });
    return { name: cleanName(l.name) || 'Watchlist', items: l.items.slice(0, MAX_ITEMS), collapsed: (l.collapsed || []).slice(0, 50), view: view, shared: !!l.shared };
  }
  function wlFrom(id, d) {
    d = d || {};
    return { id: id, name: d.name || 'Watchlist', items: Array.isArray(d.items) ? d.items.filter(function (s) { return typeof s === 'string'; }) : [],
      collapsed: Array.isArray(d.collapsed) ? d.collapsed : [], view: d.view && typeof d.view === 'object' ? d.view : {}, shared: d.shared === true };
  }
  var ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  function newListId(rand) {
    var r = rand || function () { var a = new Uint32Array(1); (root.crypto || require('crypto').webcrypto).getRandomValues(a); return a[0]; };
    var s = ''; for (var i = 0; i < 20; i++) s += ALPHA[r() % 62]; return s;
  }

  // ---------- quotes (Quotes.kt, QuoteRepository.kt) ----------
  function parseSiteBars(body) {
    var o = typeof body === 'string' ? JSON.parse(body) : body;
    var bars = (o.bars || []).map(function (a) { return { t: +a[0], o: +a[1], h: +a[2], l: +a[3], c: +a[4], v: +(a[5] || 0) }; });
    return { bars: bars, rt: o.rt === true, page: typeof o.page === 'number' ? o.page : null };
  }
  function parseKlines(body) {
    var a = typeof body === 'string' ? JSON.parse(body) : body;
    return a.map(function (k) { return { t: Math.floor(+k[0] / 1000), o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }; });
  }
  // Daily change = last close vs the previous daily close (same rule as the site's watchlist).
  function quoteFrom(daily, intraday, realtime, sparkPoints) {
    if (!daily || !daily.length) return null;
    var d = daily.slice().sort(function (a, b) { return a.t - b.t; });
    var i = (intraday || []).slice().sort(function (a, b) { return a.t - b.t; });
    var lastI = i.length ? i[i.length - 1] : null;
    var last = lastI && lastI.t >= d[d.length - 1].t ? lastI.c : d[d.length - 1].c;
    var prev = d.length > 1 ? d[d.length - 2].c : null;
    return { last: last, prev: prev, change: prev == null ? null : last - prev, pct: prev ? (last - prev) / prev * 100 : null,
      spark: i.slice(-(sparkPoints || 32)).map(function (b) { return b.c; }), realtime: !!realtime };
  }

  // ---------- formatting ----------
  function fmtNum(v, dec) { return Number(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
  function fmtPct(p) { if (p == null || !isFinite(p)) return '—'; var s = Math.abs(p).toFixed(2) + '%'; return p < 0 ? '\u2212' + s : '+' + s; }
  function fmtSigned(v, dec) { return (v < 0 ? '\u2212' : '+') + fmtNum(Math.abs(v), dec); }
  function fmtUsd(v) { return (v < 0 ? '\u2212' : '+') + '$' + fmtNum(Math.abs(v), 2); }
  // Alert level text: two decimals at least, more when the level has them (Alerts.kt alertPrice).
  function alertPrice(x) {
    if (Math.abs(x) < 1) return (x.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')) || '0';
    var dec = (x.toFixed(6).replace(/0+$/, '').split('.')[1] || '').length;
    return fmtNum(x, Math.max(2, dec));
  }

  // ---------- alerts (Alerts.kt, assets/chart-alerts.js clean(), firestore.rules validAlert) ----------
  var ALERT_CONDS = { crossing: 'Crossing', crossing_up: 'Crossing up', crossing_down: 'Crossing down', greater: 'Greater than', less: 'Less than' };
  function displayAlertSymbol(raw) { return String(raw).replace(/^(futures|binance|coinbase|hyperliquid|fx):/i, ''); }
  function alertFrom(id, d) {
    if (!d || typeof d.symbol !== 'string' || !d.symbol || typeof d.price !== 'number' || !isFinite(d.price)) return null;
    return { id: id, symbol: d.symbol, ticker: displayAlertSymbol(d.symbol), cond: ALERT_CONDS[d.cond] ? d.cond : 'crossing', price: d.price,
      message: typeof d.message === 'string' ? d.message : '', freq: d.freq === 'every' ? 'every' : 'once', active: d.active === true,
      updatedAt: d.updatedAt && d.updatedAt.toMillis ? d.updatedAt.toMillis() : 0 };
  }
  // A new alert doc (without the server timestamps) or {error}. Same shape the chart page writes.
  function newAlertDoc(input) {
    var symbol = String(input.symbol || '').trim().slice(0, 40);
    var price = Number(String(input.price == null ? '' : input.price).replace(/,/g, ''));
    if (!symbol) return { error: 'Pick a symbol.' };
    if (!isFinite(price) || String(input.price).trim() === '') return { error: 'Enter a price.' };
    return { doc: { symbol: symbol, cond: ALERT_CONDS[input.cond] ? input.cond : 'crossing', price: price,
      message: String(input.message || '').slice(0, 140), freq: input.freq === 'every' ? 'every' : 'once', active: true } };
  }
  // The server alert engine only covers these futures roots and two crypto venues (chart-alerts.js serverCovers).
  var SRV_FUT = ['NQ', 'MNQ', 'ES', 'MES', 'RTY', 'YM', 'MYM', 'GC', 'MGC', 'SI', 'SIL', 'CL', 'MCL'];
  function serverCovers(sym) {
    var m = /^([A-Za-z_]+):(.+)$/.exec(String(sym || '').trim());
    var pre = m ? m[1].toLowerCase() : '', t = (m ? m[2] : String(sym || '')).trim().toUpperCase();
    if (pre === 'binance' || pre === 'coinbase') return /^[A-Z0-9._\-]{3,30}$/.test(t);
    if (pre === '' || /^(futures|cme|cme_mini|cbot|cbot_mini|comex|comex_mini|nymex|nymex_mini)$/.test(pre)) return SRV_FUT.indexOf(t.replace(/1!$/, '')) >= 0;
    return false;
  }

  // ---------- GEX (Gex.kt) ----------
  var GEX_MARKETS = [{ fut: 'MNQ', api: 'QQQ', dec: 2, name: 'Nasdaq-100' }, { fut: 'MES', api: 'SPX', dec: 2, name: 'S&P 500' }, { fut: 'MGC', api: 'GLD', dec: 1, name: 'Gold' }];
  var LEVEL_LABEL = { call_wall: 'Call wall', zero_gamma: 'Zero gamma', spot: 'Spot', put_wall: 'Put wall', iv68_hi: 'Expected high (68%)', iv68_lo: 'Expected low (68%)' };
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function parseGex(body, market) {
    var o = typeof body === 'string' ? JSON.parse(body) : body;
    var fut = o && o.futures && o.futures[market.fut];
    if (!fut || fut.error || !fut.levels) return null;
    var lv = fut.levels, spot = num(lv.spot) != null ? lv.spot : num(fut.futures_price);
    if (spot == null) return null;
    var levels = [];
    ['call_wall', 'zero_gamma', 'put_wall', 'iv68_hi', 'iv68_lo'].forEach(function (k) { if (num(lv[k]) != null) levels.push({ kind: k, label: LEVEL_LABEL[k], price: lv[k] }); });
    levels.push({ kind: 'spot', label: 'Spot', price: spot });
    levels.sort(function (a, b) { return b.price - a.price; });
    var m = o.market || {};
    var ts = num(m.options_ts) != null ? m.options_ts : num(m.data_ts) != null ? m.data_ts : num(o.fetched_at);
    var net = num(o.net_gex);
    // Profile: net GEX per strike ($M per 1%), in the underlying's strikes (the API's own histogram data).
    var prof = o.profile && Array.isArray(o.profile.k) && Array.isArray(o.profile.g) ? o.profile.k.map(function (k, i) { return { k: k, g: +o.profile.g[i] || 0 }; }) : [];
    return { market: market, spot: spot, net: net, positive: o.regime ? o.regime === 'POSITIVE' : net == null ? null : net > 0,
      levels: levels, ts: ts, stale: o.stale === true, profile: prof, underSpot: num(o.spot) };
  }
  // Site wording (chart-gex-levels.js agoText): "GEX live" only under a minute old, never "real-time".
  function gexAgo(tsSec, nowMs) {
    if (tsSec == null) return 'GEX updated time unknown';
    var min = Math.max(0, Math.floor((nowMs / 1000 - tsSec) / 60));
    if (min < 1) return 'GEX live';
    if (min < 120) return 'GEX updated ' + min + ' min ago';
    var h = Math.floor(min / 60);
    return h < 48 ? 'GEX updated ' + h + ' h ago' : 'GEX updated ' + Math.floor(h / 24) + ' days ago';
  }
  function fmtGex(v) { var a = Math.abs(v); return (v < 0 ? '\u2212' : '+') + (a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : (a / 1e6).toFixed(0) + 'M'); }
  function gexSummary(v) {
    var walls = v.levels.filter(function (l) { return l.kind !== 'spot'; });
    var above = walls.filter(function (l) { return l.price > v.spot; }).sort(function (a, b) { return a.price - b.price; })[0];
    var below = walls.filter(function (l) { return l.price < v.spot; }).sort(function (a, b) { return b.price - a.price; })[0];
    var where = above && below ? 'Spot sits between the ' + below.label.toLowerCase() + ' and the ' + above.label.toLowerCase() + '.'
      : above ? 'Spot sits below the ' + above.label.toLowerCase() + '.' : below ? 'Spot sits above the ' + below.label.toLowerCase() + '.' : '';
    var regime = v.positive === true ? 'Net GEX is positive: dealer hedging tends to dampen moves, so price is often calmer.'
      : v.positive === false ? 'Net GEX is negative: dealer hedging can add to moves, so swings can be bigger.' : 'Net GEX is not available for this update.';
    return [where, regime, 'Levels refresh through the session.'].filter(Boolean).join(' ');
  }

  // ---------- journal (Journal.kt, assets/journal-calc.js) ----------
  function toD(v) { if (typeof v === 'number') return v; if (typeof v === 'string' && v.trim() !== '' && isFinite(+v)) return +v; return null; }
  function journalPnl(dir, entry, exit, size, fees) {
    if (entry == null || exit == null || size == null) return null;
    return (dir === 'short' ? (entry - exit) * size : (exit - entry) * size) - (fees || 0);
  }
  function journalTradeFrom(id, d) {
    if (!d || id.charAt(0) === '_' || typeof d.date !== 'string') return null;
    var pnl = toD(d.pnl);
    if (pnl == null) pnl = journalPnl(d.direction, toD(d.entryPrice), toD(d.exitPrice), toD(d.positionSize), toD(d.fees));
    return { id: id, instrument: d.instrument || '', direction: d.direction || 'long', date: d.date, time: d.time || null, size: toD(d.positionSize), pnl: pnl };
  }
  // Month summary: days with a net gain among days with closed trades, average closed trade, net, count.
  function monthStats(month, trades) {
    var inM = trades.filter(function (t) { return t.date.indexOf(month) === 0; });
    var closed = inM.filter(function (t) { return t.pnl != null; });
    var perDay = {};
    closed.forEach(function (t) { perDay[t.date] = (perDay[t.date] || 0) + t.pnl; });
    var days = Object.keys(perDay);
    var net = closed.reduce(function (a, t) { return a + t.pnl; }, 0);
    return { winDays: days.filter(function (d) { return perDay[d] > 0; }).length, tradedDays: days.length, net: net,
      avg: closed.length ? net / closed.length : null, closed: closed.length, trades: inM.length, perDay: perDay };
  }
  // Weekday calendar cells for a month ("2026-11"): null = leading blank.
  function monthCells(month, perDay) {
    var y = +month.slice(0, 4), m = +month.slice(5, 7), n = new Date(Date.UTC(y, m, 0)).getUTCDate(), out = [];
    for (var d = 1; d <= n; d++) {
      var dt = new Date(Date.UTC(y, m - 1, d)), wd = dt.getUTCDay();
      if (wd === 0 || wd === 6) continue;
      if (!out.length) for (var k = 1; k < wd; k++) out.push(null);
      var key = month + '-' + (d < 10 ? '0' : '') + d;
      out.push({ day: d, date: key, pnl: perDay[key] == null ? null : perDay[key] });
    }
    return out;
  }

  // ---------- learn (Learn.kt, assets/courses.js) ----------
  var TRACK_NAMES = [['core', 'Core curriculum'], ['vp', 'Volume Profile & Order Flow'], ['pf', 'Prop Firm Mastery']];
  function learnModel(chapters, done) {
    var has = function (k) { return done.indexOf ? done.indexOf(k) >= 0 : done.has(k); };
    var prog = chapters.map(function (c) {
      var n = 0; for (var i = 0; i < c.lessons.length; i++) if (has(c.num + '-' + i)) n++;
      return { chapter: c, done: n, total: c.lessons.length };
    });
    var sections = TRACK_NAMES.map(function (t) {
      return [t[1], prog.filter(function (p) { return (p.chapter.track || 'core') === t[0]; }).sort(function (a, b) { return a.chapter.num < b.chapter.num ? -1 : 1; })];
    }).filter(function (s) { return s[1].length; });
    var core = sections.length ? sections[0][1] : [];
    var total = core.reduce(function (a, p) { return a + p.total; }, 0), doneN = core.reduce(function (a, p) { return a + p.done; }, 0);
    var target = core.filter(function (p) { return p.done < p.total; })[0];
    var cont = null;
    if (doneN > 0 && target) {
      var li = 0; for (var j = 0; j < target.chapter.lessons.length; j++) if (!has(target.chapter.num + '-' + j)) { li = j; break; }
      cont = { chapter: target.chapter, lesson: li, lessonTitle: target.chapter.lessons[li] || '', done: target.done, total: target.total };
    }
    return { sections: sections, cont: cont, done: doneN, total: total };
  }

  // ---------- market sessions (assets/market-hours.js definitions) ----------
  // Asia 09:00-18:00 Tokyo, London 08:00-17:00 London, New York 08:00-17:00 New York, Mon-Fri in each city's calendar.
  var SESSIONS = [['Asia', 'Asia/Tokyo', 9, 18], ['London', 'Europe/London', 8, 17], ['New York', 'America/New_York', 8, 17]];
  var fmts = {};
  function cityParts(ms, tz) {
    var f = fmts[tz] || (fmts[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', hour: 'numeric', minute: 'numeric', second: 'numeric' }));
    var o = {}; f.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    return { wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday), mins: (+o.hour % 24) * 60 + +o.minute, sec: +o.second };
  }
  function sessionOpen(s, ms) { var p = cityParts(ms, s[1]); return p.wd >= 1 && p.wd <= 5 && p.mins >= s[2] * 60 && p.mins < s[3] * 60; }
  // Minutes until the state flips (searched minute by minute, at most 4 days ahead).
  function minutesToFlip(s, ms) {
    var now = sessionOpen(s, ms), base = Math.floor(ms / 60000) * 60000;
    for (var i = 1; i <= 4 * 1440; i++) if (sessionOpen(s, base + i * 60000) !== now) return i;
    return null;
  }
  function sessionsNow(ms) {
    return SESSIONS.map(function (s) {
      var open = sessionOpen(s, ms), p = cityParts(ms, s[1]), until = minutesToFlip(s, ms);
      return { name: s[0], tz: s[1], open: open, local: (p.mins / 60 | 0) + ':' + ('0' + p.mins % 60).slice(-2), until: until,
        progress: open ? Math.min(1, Math.max(0, (p.mins - s[2] * 60) / ((s[3] - s[2]) * 60))) : 0 };
    });
  }
  // CME equity-index futures: Sun 18:00 to Fri 17:00 New York, daily break 17:00-18:00 (MarketHours.kt).
  function futuresOpen(ms) {
    var p = cityParts(ms, 'America/New_York');
    if (p.wd === 6) return false;
    if (p.wd === 0) return p.mins >= 18 * 60;
    if (p.wd === 5) return p.mins < 17 * 60;
    return p.mins < 17 * 60 || p.mins >= 18 * 60;
  }
  function fmtDur(min) {
    if (min == null) return '';
    if (min < 60) return min + 'm';
    var h = Math.floor(min / 60), m = min % 60;
    if (h < 24) return h + 'h ' + (m < 10 ? '0' : '') + m + 'm';
    return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
  }

  // ---------- command palette ranking ----------
  // items: [{title, sub, kw}] -> best first; prefix of title beats word start beats substring; empty query keeps order.
  function rankItems(items, q, limit) {
    var t = String(q || '').trim().toLowerCase();
    if (!t) return items.slice(0, limit || 50);
    var scored = [];
    items.forEach(function (it, i) {
      var title = String(it.title).toLowerCase(), hay = title + ' ' + String(it.kw || '').toLowerCase() + ' ' + String(it.sub || '').toLowerCase();
      var s = title.indexOf(t) === 0 ? 0 : new RegExp('(^|[\\s:/(])' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(hay) ? 1 : hay.indexOf(t) >= 0 ? 2 : -1;
      if (s >= 0) scored.push([s, i, it]);
    });
    scored.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    return scored.slice(0, limit || 50).map(function (x) { return x[2]; });
  }

  // Sparkline SVG path for values in a w x h box (flat series sits in the middle).
  function sparkPath(vals, w, h, pad) {
    if (!vals || vals.length < 2) return '';
    pad = pad == null ? 2 : pad;
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), span = hi - lo;
    return vals.map(function (v, i) {
      var x = (i / (vals.length - 1)) * w, y = span ? pad + (1 - (v - lo) / span) * (h - 2 * pad) : h / 2;
      return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }).join('');
  }

  var api = {
    SECTION: SECTION, CATALOG: CATALOG, DEFAULT_ITEMS: DEFAULT_ITEMS, MAX_LISTS: MAX_LISTS, MAX_SYMBOLS: MAX_SYMBOLS, MAX_ITEMS: MAX_ITEMS,
    isSection: isSection, canonicalId: canonicalId, symbolOf: symbolOf, decimalsFor: decimalsFor, searchCatalog: searchCatalog, typeOf: typeOf,
    symbolsOf: symbolsOf, cleanName: cleanName, insertAt: insertAt, wlAdd: wlAdd, wlRemove: wlRemove, wlMove: wlMove, wlFields: wlFields, wlFrom: wlFrom, newListId: newListId,
    parseSiteBars: parseSiteBars, parseKlines: parseKlines, quoteFrom: quoteFrom,
    fmtNum: fmtNum, fmtPct: fmtPct, fmtSigned: fmtSigned, fmtUsd: fmtUsd, alertPrice: alertPrice,
    ALERT_CONDS: ALERT_CONDS, alertFrom: alertFrom, newAlertDoc: newAlertDoc, serverCovers: serverCovers, displayAlertSymbol: displayAlertSymbol,
    GEX_MARKETS: GEX_MARKETS, parseGex: parseGex, gexAgo: gexAgo, fmtGex: fmtGex, gexSummary: gexSummary,
    journalPnl: journalPnl, journalTradeFrom: journalTradeFrom, monthStats: monthStats, monthCells: monthCells,
    TRACK_NAMES: TRACK_NAMES, learnModel: learnModel,
    sessionsNow: sessionsNow, futuresOpen: futuresOpen, fmtDur: fmtDur, rankItems: rankItems, sparkPath: sparkPath
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TZCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
