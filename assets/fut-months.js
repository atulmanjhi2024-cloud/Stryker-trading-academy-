// TradeZoro — individual futures CONTRACT MONTHS (pure ES module, no DOM, no network). Owner/member question 25 Nov:
// "Is there going to be separate contracts for the futures? For example CME December 2026 MES?"
//
// One code form everywhere: root + CME month letter + 4-digit year, e.g. 'MESZ2026' (chart symbol 'futures:MESZ2026').
// Typed forms accepted: MESZ2026, MESZ26, MESZ6, CME_MINI:MESZ2026, "MES Dec 2026", "MES DEC 26", "MES December 2026".
// The continuous contract (MES1!) is untouched: a month is only ever charted when a member picks or types one.
//
// Which months exist and when they expire: the exchange data feed's roll list (chart-symbol-info.js getInfo().syms[key].roll,
// refreshed daily) when we have it; for the CME equity-index roots also the exchange rule (third Friday of Mar/Jun/Sep/Dec).
// LIVE is only claimed for the month the live feed is actually on (liveMonth below): the live tick feed is keyed by root and
// follows the front month, so a deferred month is NEVER fed from the root's ticks (that would be another contract's prices).
// Used by assets/chart-sym.js, chart-futures-provider.js, chart-search.js, chart-fut-month.js, chart-live-core.js consumers,
// and functions/api/chart/_bars.js (server). Tests: tools/tests/fut-months.test.mjs. Education only. Not financial advice.

export const LETTERS = 'FGHJKMNQUVXZ';                       // Jan..Dec
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_LONG = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
// roots we can chart by month (= the futures provider's table); micros share their mini's calendar
export const MONTH_ROOTS = ['NQ', 'MNQ', 'ES', 'MES', 'YM', 'MYM', 'RTY', 'M2K', 'GC', 'MGC', 'SI', 'SIL', 'HG', 'MHG', 'CL', 'MCL', 'NG', 'ZN', 'ZB', '6E'];
export const INFO_KEY = { NQ: 'NQ', MNQ: 'NQ', ES: 'ES', MES: 'ES', YM: 'YM', MYM: 'YM', RTY: 'RTY', M2K: 'RTY', GC: 'GC', MGC: 'GC', SI: 'SI', SIL: 'SI', HG: 'HG', MHG: 'HG', CL: 'CL', MCL: 'CL', NG: 'NG', ZN: 'ZN', ZB: 'ZB', '6E': '6E' };
const QUARTERLY = new Set(['NQ', 'MNQ', 'ES', 'MES', 'YM', 'MYM', 'RTY', 'M2K']);
export const ROLL_DAYS = 8;          // = chart-live-core.js ROLL_DAYS (index futures roll about 8 days before expiry)
const DAY = 864e5;
const BY_LEN = MONTH_ROOTS.slice().sort((a, b) => b.length - a.length);

// one-digit / two-digit year -> full year. One digit: the nearest year >= (this year - 1) ending in it (codes name live contracts).
export function fullYear(y, now = Date.now()) {
  const s = String(y), n = Number(s);
  if (s.length === 4) return n;
  if (s.length === 2) return 2000 + n;
  const y0 = new Date(now).getUTCFullYear();
  for (let k = y0 - 1; k < y0 + 9; k++) if (k % 10 === n) return k;
  return y0;
}
const mk = (root, mi, year) => ({ root, letter: LETTERS[mi], month: mi + 1, year, code: root + LETTERS[mi] + year });

// 'MESZ2026' / 'MESZ26' / 'MESZ6' / 'futures:MESZ2026' / 'CME_MINI:MESZ26' -> { root, letter, month, year, code:'MESZ2026' } | null.
// Only known roots (MONTH_ROOTS), only years now-1 .. now+9 (a typo like MESZ1999 is not a contract).
export function parseMonth(sym, now = Date.now()) {
  let s = String(sym == null ? '' : sym).trim().toUpperCase();
  const p = /^([A-Z0-9_]+):(.+)$/.exec(s);
  if (p) { if (!/^(FUTURES|RITHMIC|CME|CME_MINI|CBOT|CBOT_MINI|COMEX|COMEX_MINI|NYMEX|NYMEX_MINI)$/.test(p[1])) return null; s = p[2]; }
  const m = /^([A-Z0-9]{1,4}?)([FGHJKMNQUVXZ])(\d|\d\d|\d{4})$/.exec(s);
  if (!m || !MONTH_ROOTS.includes(m[1])) return null;
  const year = fullYear(m[3], now), y0 = new Date(now).getUTCFullYear();
  if (year < y0 - 1 || year > y0 + 9) return null;
  return mk(m[1], LETTERS.indexOf(m[2]), year);
}
export const isMonth = (sym) => !!parseMonth(sym);
// search text: "MES Dec 2026", "MES DEC 26", "mes december 2026", "MES Z26", "MESZ6" -> month | null
export function parseQuery(q, now = Date.now()) {
  const s = String(q || '').trim();
  const direct = parseMonth(s.replace(/\s+/g, ''), now); if (direct) return direct;
  const m = /^([A-Za-z0-9]{1,4})\s+([A-Za-z]{3,9})\.?\s*'?(\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  const root = m[1].toUpperCase(); if (!MONTH_ROOTS.includes(root)) return null;
  const w = m[2].toLowerCase(), mi = MON_LONG.findIndex((x) => x === w || (w.length >= 3 && x.startsWith(w)));
  if (mi < 0) return null;
  return parseMonth(root + LETTERS[mi] + fullYear(m[3], now), now);
}
export const label = (x) => MON[x.month - 1] + ' ' + x.year;                       // 'Dec 2026'
export const shortCode = (x) => x.root + x.letter + String(x.year % 10);         // 'MESZ6' (broker / live-order form)
export const chartSym = (x) => 'futures:' + x.code;
// Yahoo Finance per-contract code (server, functions/api/chart/_bars.js): MESZ26.CME, YMZ26.CBT, GCG27.CMX, CLF27.NYM
export const YH_EX = { CME: 'CME', CBOT: 'CBT', COMEX: 'CMX', NYMEX: 'NYM' };
export const yahooCode = (x, exch) => x.root + x.letter + String(x.year % 100).padStart(2, '0') + '.' + (YH_EX[exch] || 'CME');

// third Friday of month m (1-12), 00:00 UTC
export function thirdFriday(y, m) { const d = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); return Date.UTC(y, m - 1, 1 + ((5 - d + 7) % 7) + 14); }
const ymd = (ms) => { const d = new Date(ms); return String(d.getUTCFullYear()) + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0'); };
const ymdMs = (s) => Date.UTC(+String(s).slice(0, 4), +String(s).slice(4, 6) - 1, +String(s).slice(6, 8));

// The months to offer for a root, nearest first: [{ ...month, expiry:'20261218', src:'feed'|'rule' }]. roll = the feed's roll list of
// the root's info key ([{ c:'ESZ2026', d:'20261218' }, ..]) or null. Expired months are dropped. Index roots without a feed: the rule.
export function monthsFor(root, roll, now = Date.now(), n = 6) {
  if (!MONTH_ROOTS.includes(root)) return [];
  const key = INFO_KEY[root] || root, today = ymd(now), out = [];
  for (const r of Array.isArray(roll) ? roll : []) {
    const m = /^([A-Z0-9]{1,4}?)([FGHJKMNQUVXZ])(\d{4})$/.exec(String(r && r.c || ''));
    if (!m || m[1] !== key || !/^\d{8}$/.test(String(r.d)) || String(r.d) < today) continue;
    out.push(Object.assign(mk(root, LETTERS.indexOf(m[2]), +m[3]), { expiry: String(r.d), src: 'feed' }));
  }
  if (!out.length && QUARTERLY.has(root)) {
    const y0 = new Date(now).getUTCFullYear();
    for (let y = y0; y <= y0 + 2; y++) for (const mo of [3, 6, 9, 12]) {
      const e = ymd(thirdFriday(y, mo)); if (e < today) continue;
      out.push(Object.assign(mk(root, mo - 1, y), { expiry: e, src: 'rule' }));
    }
  }
  return out.slice(0, n);
}
// expiry 'YYYYMMDD' of one month: the feed's date, else the index rule, else ''
export function expiryOf(x, roll, now = Date.now()) {
  if (!x) return '';
  const key = INFO_KEY[x.root] || x.root, c = key + x.letter + x.year;
  const r = (Array.isArray(roll) ? roll : []).find((e) => e && e.c === c);
  if (r && /^\d{8}$/.test(String(r.d))) return String(r.d);
  return QUARTERLY.has(x.root) && [3, 6, 9, 12].includes(x.month) ? ymd(thirdFriday(x.year, x.month)) : '';
}
export const daysTo = (exp, now = Date.now()) => (exp ? Math.round((ymdMs(exp) - Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate())) / DAY) : null);
export const fmtExpiry = (exp) => (exp ? (+exp.slice(6, 8)) + ' ' + MON[+exp.slice(4, 6) - 1] : '');   // '18 Dec'

// the next month after x in the root's list (the one it rolls to) | null
export function nextMonth(x, roll, now = Date.now()) {
  const l = monthsFor(x.root, roll, now, 12), i = l.findIndex((m) => m.code === x.code);
  return i >= 0 ? l[i + 1] || null : null;
}
// Roll banner: inside the last ROLL_DAYS days before expiry -> { to: month, days } | null
export function rollInfo(x, roll, now = Date.now()) {
  const d = daysTo(expiryOf(x, roll, now), now);
  if (d == null || d < 0 || d > ROLL_DAYS) return null;
  const to = nextMonth(x, roll, now);
  return to ? { to, days: d } : null;
}

// The month the LIVE feed is on for this root, or '' when we cannot be sure (then no month gets live candles; the delayed
// month history still shows). feedContract = the data feed's current front (syminfo .contract of the info key, 'ESZ2026').
// Index roots only: the feed's front AND the roll rule (8 days before expiry, same as live orders) must agree; in the hours where a
// volume roll and the calendar disagree the answer is '' (never another month's ticks under this month's name).
// shortcut: metals / energy / rates months are delayed-only (their live feed rolls by volume on a date we can't see from here);
// upgrade when the tick hub reports its current contract per root.
export function liveMonth(root, feedContract, roll, now = Date.now()) {
  if (!QUARTERLY.has(root)) return '';
  const key = INFO_KEY[root] || root;
  const f = /^([A-Z0-9]{1,4}?)([FGHJKMNQUVXZ])(\d{4})$/.exec(String(feedContract || ''));
  const feed = f && f[1] === key ? root + f[2] + f[3] : '';
  const l = monthsFor(root, roll, now, 3).filter((m) => [3, 6, 9, 12].includes(m.month));
  if (!l.length) return '';
  const rule = (now >= ymdMs(l[0].expiry) - ROLL_DAYS * DAY && l[1]) ? l[1].code : l[0].code;
  return !feed || feed === rule ? rule : '';
}

// ---- the page's copy of the contract feed (browser). Set once chart-symbol-info.js getInfo() answers; read synchronously.
let FEED = null;   // { NQ: { contract:'NQZ2026', roll:[..] }, ES: .. }
export function setFeed(syms) { FEED = syms && typeof syms === 'object' ? syms : null; }
export const feedOf = (root) => (FEED && FEED[INFO_KEY[root] || root]) || null;
export const rollOf = (root) => { const e = feedOf(root); return e && Array.isArray(e.roll) ? e.roll : null; };
// is this month the one the live feed is on right now (see liveMonth)? false while the feed is not loaded (fails closed)
export function isLiveMonth(x, now = Date.now()) { const e = x && feedOf(x.root); return !!e && liveMonth(x.root, e.contract, e.roll, now) === x.code; }
// the month the market treats as front right now (badge only): index roots by the roll rule, others the feed's own front
export function frontCode(root, now = Date.now()) {
  const e = feedOf(root), roll = e && e.roll;
  if (QUARTERLY.has(root)) { const l = monthsFor(root, roll, now, 2); return l.length ? (now >= ymdMs(l[0].expiry) - ROLL_DAYS * DAY && l[1] ? l[1].code : l[0].code) : ''; }
  const f = /^([A-Z0-9]{1,4}?)([FGHJKMNQUVXZ])(\d{4})$/.exec(String(e && e.contract || ''));
  return f && f[1] === (INFO_KEY[root] || root) ? root + f[2] + f[3] : '';
}
