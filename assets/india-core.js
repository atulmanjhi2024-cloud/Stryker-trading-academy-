// TradeZoro — Indian markets (NSE / BSE): symbol table, name matching, IST session maths. Pure, no DOM, no network.
// Used by assets/chart-india.js (browser provider), functions/api/chart/_bars.js + _india.js (server) and tools/tests/india.test.mjs.
// Chart symbols are "india:<TICKER>" (india:NIFTY, india:BANKNIFTY, india:NIFTY1!, india:RELIANCE). NIFTY, BANKNIFTY, SENSEX, FINNIFTY,
// NIFTY1! and BANKNIFTY1! are typed bare too. The delay of every symbol is read from the data provider at load (never in this file);
// the session below is the regular 09:15-15:30 IST day, holidays and special sessions (Muhurat, Budget Sunday) come from the provider.
// ONE GATE (Owner 25 Nov): INDIA_AUDIENCE. 'beta' = admins + beta testers only; 'all' = every member; 'off' = nobody.
// Education only. Not financial advice.

export const INDIA_AUDIENCE = 'beta';   // the one flag: change to 'all' once the exchange display terms are confirmed
export const IST_S = 19800;            // Asia/Kolkata = UTC+5:30, no daylight saving
export const OPEN_MIN = 9 * 60 + 15, CLOSE_MIN = 15 * 60 + 30;

// [ticker, provider code, name, type, exchange, point value (fallback only; the provider's value wins), aliases]
const IDX = [
  ['NIFTY', 'NSE:NIFTY', 'Nifty 50', 'index', 'NSE', 1, ['NIFTY50', 'NIFTY 50', 'NIFTY_50', 'CNXNIFTY']],
  ['BANKNIFTY', 'NSE:BANKNIFTY', 'Bank Nifty', 'index', 'NSE', 1, ['NIFTYBANK', 'NIFTY BANK', 'BANK NIFTY', 'CNXBANK']],
  ['FINNIFTY', 'NSE:CNXFINANCE', 'Fin Nifty', 'index', 'NSE', 1, ['NIFTYFIN', 'NIFTY FIN SERVICE', 'NIFTY FINANCIAL SERVICES', 'FIN NIFTY', 'CNXFINANCE']],
  ['SENSEX', 'BSE:SENSEX', 'BSE Sensex', 'index', 'BSE', 1, ['BSE SENSEX', 'BSESN', 'SENSEX30']],
  ['NIFTY1!', 'NSE:NIFTY1!', 'Nifty 50 futures', 'futures', 'NSE', 65, ['NIFTY FUT', 'NIFTY FUTURES', 'NIFTYFUT']],
  ['BANKNIFTY1!', 'NSE:BANKNIFTY1!', 'Bank Nifty futures', 'futures', 'NSE', 30, ['BANKNIFTY FUT', 'BANK NIFTY FUTURES', 'BANKNIFTYFUT']],
  ['FINNIFTY1!', 'NSE:FINNIFTY1!', 'Fin Nifty futures', 'futures', 'NSE', 60, ['FINNIFTY FUT', 'FIN NIFTY FUTURES']]
];
// Nifty 50 constituents (+ a few recent members): [ticker as the exchange writes it, display name]
const STOCKS = [
  ['ADANIENT', 'Adani Enterprises'], ['ADANIPORTS', 'Adani Ports & Special Economic Zone'], ['APOLLOHOSP', 'Apollo Hospitals Enterprise'],
  ['ASIANPAINT', 'Asian Paints'], ['AXISBANK', 'Axis Bank'], ['BAJAJ_AUTO', 'Bajaj Auto'], ['BAJFINANCE', 'Bajaj Finance'],
  ['BAJAJFINSV', 'Bajaj Finserv'], ['BEL', 'Bharat Electronics'], ['BHARTIARTL', 'Bharti Airtel'], ['CIPLA', 'Cipla'],
  ['COALINDIA', 'Coal India'], ['DRREDDY', "Dr. Reddy's Laboratories"], ['EICHERMOT', 'Eicher Motors'], ['ETERNAL', 'Eternal (Zomato)'],
  ['GRASIM', 'Grasim Industries'], ['HCLTECH', 'HCL Technologies'], ['HDFCBANK', 'HDFC Bank'], ['HDFCLIFE', 'HDFC Life Insurance'],
  ['HINDALCO', 'Hindalco Industries'], ['HINDUNILVR', 'Hindustan Unilever'], ['ICICIBANK', 'ICICI Bank'], ['INDIGO', 'InterGlobe Aviation (IndiGo)'],
  ['INDUSINDBK', 'IndusInd Bank'], ['INFY', 'Infosys'], ['ITC', 'ITC'], ['JIOFIN', 'Jio Financial Services'], ['JSWSTEEL', 'JSW Steel'],
  ['KOTAKBANK', 'Kotak Mahindra Bank'], ['LT', 'Larsen & Toubro'], ['M&M', 'Mahindra & Mahindra'], ['MARUTI', 'Maruti Suzuki India'],
  ['MAXHEALTH', 'Max Healthcare Institute'], ['NESTLEIND', 'Nestle India'], ['NTPC', 'NTPC'], ['ONGC', 'Oil & Natural Gas Corp'],
  ['POWERGRID', 'Power Grid Corporation of India'], ['RELIANCE', 'Reliance Industries'], ['SBILIFE', 'SBI Life Insurance'],
  ['SBIN', 'State Bank of India'], ['SHRIRAMFIN', 'Shriram Finance'], ['SUNPHARMA', 'Sun Pharmaceutical Industries'],
  ['TATACONSUM', 'Tata Consumer Products'], ['TMPV', 'Tata Motors Passenger Vehicles'], ['TATASTEEL', 'Tata Steel'],
  ['TCS', 'Tata Consultancy Services'], ['TECHM', 'Tech Mahindra'], ['TITAN', 'Titan Company'], ['TRENT', 'Trent'],
  ['ULTRACEMCO', 'UltraTech Cement'], ['WIPRO', 'Wipro']
];
const STOCK_ALIAS = {
  BAJAJ_AUTO: ['BAJAJ-AUTO', 'BAJAJAUTO'], 'M&M': ['M_M', 'MM', 'MAHINDRA'], TMPV: ['TATAMOTORS', 'TATA MOTORS'], ETERNAL: ['ZOMATO'],
  HDFCBANK: ['HDFC'], INDIGO: ['INTERGLOBE'], LT: ['L&T', 'L_T'], ITC: ['ITCLTD'], SBIN: ['SBI'], HINDUNILVR: ['HUL'], DRREDDY: ['DR REDDY', 'DR REDDYS'],
  RELIANCE: ['RIL'], BHARTIARTL: ['AIRTEL'], NESTLEIND: ['NESTLE'], ULTRACEMCO: ['ULTRATECH'], INFY: ['INFOSYS'], POWERGRID: ['PGCIL'], ONGC: ['OIL AND NATURAL GAS']
};

// "IN-" + the ticker without punctuation: the key used in the symbol-logo map, the server table and the watchlist.
export const keyOf = (ticker) => 'IN-' + String(ticker).toUpperCase().replace(/!$/, 'F').replace(/[^A-Z0-9]/g, '');
const entry = (ticker, code, name, type, exchange, pv, aliases) => ({
  ticker, key: keyOf(ticker), code, name, type, exchange, tick: 0.05, pv, aliases,
  sym: 'india:' + ticker, description: name + (type === 'futures' ? ' (' + exchange + ')' : type === 'index' ? ' Index' : ' · ' + exchange), currency: 'INR'
});
export const INDIA = [
  ...IDX.map((r) => entry(...r)),
  ...STOCKS.map(([t, n]) => entry(t, 'NSE:' + t, n, 'stock', 'NSE', 1, STOCK_ALIAS[t] || []))
];
const norm = (s) => String(s).toUpperCase().replace(/\s+/g, ' ').trim();
const BY = new Map();
for (const e of INDIA) {
  BY.set(e.ticker, e); BY.set(e.key, e); BY.set(e.code.toUpperCase(), e);
  for (const a of e.aliases) BY.set(norm(a), e);
}
// Bare words that mean an Indian index (only these resolve without a prefix; a bare RELIANCE stays with the world-stocks search).
const BARE = new Set(['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'SENSEX', 'NIFTY1!', 'BANKNIFTY1!', 'FINNIFTY1!', 'NIFTY50', 'NIFTYBANK']);

// "india:NIFTY", "NSE:RELIANCE", "BSE:SENSEX", "NIFTY1!", "IN-TCS" -> the table entry, or null.
export function entryOf(raw, bareOk = true) {
  const s = norm(raw);
  if (!s) return null;
  const m = /^([A-Z_]+):(.+)$/.exec(s);
  if (!m) return bareOk && BARE.has(s) ? BY.get(s) || null : null;
  const pre = m[1].toLowerCase(), t = m[2].trim();
  if (pre === 'india') return BY.get(t) || null;
  if (pre === 'nse' || pre === 'bse') { const e = BY.get(t) || BY.get(pre.toUpperCase() + ':' + t); return e && e.exchange === pre.toUpperCase() ? e : null; }
  return null;
}
export const symOf = (e) => e.sym;
export const isIndiaSym = (s) => /^india:/i.test(String(s || ''));

// ---- the gate ----
export const audienceOk = (aud, beta) => aud === 'all' || (aud === 'beta' && !!beta);

// ---- IST sessions ----
// info = { holidays: ['YYYYMMDD', ...], special: { 'YYYYMMDD': [openMin, closeMin] } } (from the provider; missing = weekdays 09:15-15:30)
const pad = (n) => String(n).padStart(2, '0');
export function istParts(ms) {
  const d = new Date(ms + IST_S * 1000);
  return { dow: d.getUTCDay(), min: d.getUTCHours() * 60 + d.getUTCMinutes(), ymd: '' + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()), dayStart: Math.floor((ms + IST_S * 1000) / 864e5) * 864e5 - IST_S * 1000 };
}
// the open window of an IST calendar day: [openMin, closeMin] or null
export function sessionOf(dow, ymd, info) {
  const sp = info && info.special && info.special[ymd];
  if (sp) return sp;
  if (dow === 0 || dow === 6) return null;
  if (info && info.holidays && (Array.isArray(info.holidays) ? info.holidays.includes(ymd) : info.holidays.has(ymd))) return null;
  return [OPEN_MIN, CLOSE_MIN];
}
export function isOpen(ms, info) {
  const p = istParts(ms), s = sessionOf(p.dow, p.ymd, info);
  return !!s && p.min >= s[0] && p.min < s[1];
}
// next moment the market is open (epoch ms), up to 14 days ahead; null if none
export function nextOpen(ms, info) {
  if (isOpen(ms, info)) return ms;
  const p0 = istParts(ms);
  for (let i = 0; i < 15; i++) {
    const day = p0.dayStart + i * 864e5, p = istParts(day + 12 * 3600e3), s = sessionOf(p.dow, p.ymd, info);
    if (!s) continue;
    const at = day + s[0] * 60e3;
    if (at > ms) return at;
  }
  return null;
}
// open windows over [from, to) epoch ms, one per trading day
export function calendar(from, to, info) {
  const out = [];
  let day = istParts(from).dayStart - 864e5;
  for (; day < to; day += 864e5) {
    const p = istParts(day + 12 * 3600e3), s = sessionOf(p.dow, p.ymd, info);
    if (!s) continue;
    const a = day + s[0] * 60e3, b = day + s[1] * 60e3;
    if (b > from && a < to) out.push([Math.max(a, from), Math.min(b, to)]);
  }
  return out;
}
// N-minute bars anchored to the 09:15 IST open (t, sizeMs in epoch ms): 45m = 09:15, 10:00, 10:45 ...
export function sessionKey(t, sizeMs) {
  const open = Math.floor((t + IST_S * 1000 - OPEN_MIN * 60e3) / 864e5) * 864e5 + OPEN_MIN * 60e3 - IST_S * 1000;
  return open + Math.floor((t - open) / sizeMs) * sizeMs;
}
// Minute rows [t,o,h,l,c,v] (t epoch s, ascending) -> bars of sizeSec seconds anchored to the 09:15 IST open (1h: 09:15, 10:15 ... 15:15 (15 min)).
export function aggregateIst(rows, sizeSec) {
  const out = [];
  for (const r of rows) {
    const key = sessionKey(r[0] * 1000, sizeSec * 1000) / 1000, prev = out[out.length - 1];
    if (prev && prev[0] === key) { if (r[2] > prev[2]) prev[2] = r[2]; if (r[3] < prev[3]) prev[3] = r[3]; prev[4] = r[4]; prev[5] += r[5]; } else out.push([key, r[1], r[2], r[3], r[4], r[5]]);
  }
  return out;
}
// The provider's session answer -> { holidays, special } for 2024 onwards (older dates never matter to a chart someone scrolls to).
export function parseSession(j) {
  const holidays = (j && Array.isArray(j.holidays) ? j.holidays : []).filter((d) => /^\d{8}$/.test(d) && d >= '20240101');
  const special = {};
  for (const d of (j && j.details) || []) {
    if (!/regular/i.test(String(d.description || ''))) continue;
    for (const c of d.session_correction || []) {
      const a = hm(c.start_hour), b = hm(c.end_hour);
      if (a == null || b == null) continue;
      for (const day of c.dates || []) if (/^\d{8}$/.test(day) && day >= '20240101') special[day] = [a, b];
    }
  }
  return { holidays, special };
}
function hm(s) { const m = /^(\d{2})(\d{2})$/.exec(String(s || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
