// TradeZoro thinkScript engine: built-in functions and constants. Pure (no DOM, no network).
// Written for TradeZoro from the published maths of each indicator; no third-party code.
//
// A native: { p: [param names], d: { name: default }, s: [indexes of series params], f(c, a, S, st), stmt?, plots?, all? }
//   c   run context (c.I = current bar, c.n = bar count, c.bars, c.out ...)
//   a   argument values at this bar (numbers, text, colours {rgb})
//   S   S[j](i) reads series param j at bar i (NaN outside the data), for every index in `s`
//   st  this call site's own state (one object per place the function is written in the script)
// Booleans are numbers (1 / 0). Missing values are NaN (Double.NaN in a script).

export const isNum = (v) => typeof v === 'number';
export const NAN = NaN;

// ---------- colours ----------
const col = (rgb) => Object.freeze({ rgb });
export const isColor = (v) => !!v && typeof v === 'object' && 'rgb' in v;
const HEX = {
  BLACK: '#000000', WHITE: '#ffffff', RED: '#e5484d', GREEN: '#30a46c', BLUE: '#3e7bfa', YELLOW: '#f5d90a', ORANGE: '#f76b15',
  CYAN: '#00b8d9', MAGENTA: '#d23cc4', GRAY: '#8b8d98', DARK_GRAY: '#4a4c55', LIGHT_GRAY: '#c2c4cc', DARK_GREEN: '#18794e',
  LIGHT_GREEN: '#7fd8a6', DARK_RED: '#a3262b', LIGHT_RED: '#ff9592', DARK_ORANGE: '#bd4b00', LIGHT_ORANGE: '#ffb381', LIME: '#9be15d',
  PINK: '#f17ec0', PLUM: '#9e6bb5', VIOLET: '#8e4ec6', UPTICK: '#30a46c', DOWNTICK: '#e5484d'
};
export const COLOR = Object.fromEntries(Object.keys(HEX).map((k) => [k, col(HEX[k])]));
COLOR.CURRENT = col(null);
// GetColor(0..9): the plot palette
export const PALETTE = ['#00b8d9', '#f76b15', '#8e4ec6', '#30a46c', '#e5484d', '#f5d90a', '#3e7bfa', '#f17ec0', '#9be15d', '#8b8d98'].map(col);
export const colorOf = (v) => (isColor(v) ? v : null);
const hex2 = (x) => Math.max(0, Math.min(255, Math.round(x || 0))).toString(16).padStart(2, '0');

// ---------- constant namespaces (Name.MEMBER) ----------
const names = (list, fn) => Object.fromEntries(list.map((k, i) => [k, fn ? fn(k, i) : k]));
export const AGG = { MIN: 6e4, TWO_MIN: 12e4, THREE_MIN: 18e4, FOUR_MIN: 24e4, FIVE_MIN: 3e5, TEN_MIN: 6e5, FIFTEEN_MIN: 9e5, TWENTY_MIN: 12e5,
  THIRTY_MIN: 18e5, HOUR: 36e5, TWO_HOURS: 72e5, FOUR_HOURS: 144e5, DAY: 864e5, TWO_DAYS: 1728e5, THREE_DAYS: 2592e5, FOUR_DAYS: 3456e5,
  WEEK: 6048e5, MONTH: 2592e6, QUARTER: 7776e6, YEAR: 31536e6 };
export const AVG_TYPES = ['SIMPLE', 'EXPONENTIAL', 'WEIGHTED', 'WILDERS', 'HULL'];
export const STRATEGIES = ['LINE', 'HISTOGRAM', 'POINTS', 'ARROW_UP', 'ARROW_DOWN', 'BOOLEAN_ARROW_UP', 'BOOLEAN_ARROW_DOWN', 'BOOLEAN_POINTS',
  'BOOLEAN_WEDGE_UP', 'BOOLEAN_WEDGE_DOWN', 'SQUARED_HISTOGRAM', 'HORIZONTAL', 'DASHES', 'TRIANGLES', 'SQUARES', 'LINE_VS_POINTS',
  'LINE_VS_TRIANGLES', 'LINE_VS_SQUARES', 'VALUES_ABOVE', 'VALUES_BELOW'];
export const NS = {
  color: COLOR,
  averagetype: names(AVG_TYPES),
  aggregationperiod: AGG,
  paintingstrategy: names(STRATEGIES),
  curve: names(['FIRM', 'LONG_DASH', 'MEDIUM_DASH', 'SHORT_DASH', 'POINTS']),
  alert: names(['BAR', 'ONCE', 'TICK', 'TRIGGER']),
  sound: names(['Bell', 'Chimes', 'Ding', 'NoSound', 'Ring']),
  crossingdirection: { ABOVE: 'above', BELOW: 'below', ANY: 'any' },
  double: { NaN: NaN, POSITIVE_INFINITY: Infinity, NEGATIVE_INFINITY: -Infinity, Pi: Math.PI, E: Math.E },
  location: names(['TOP_LEFT', 'TOP_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_RIGHT']),
  fontsize: names(['SMALL', 'MEDIUM', 'LARGE']),
  numberformat: names(['TWO_DECIMAL_PLACES', 'THREE_DECIMAL_PLACES', 'DOLLAR', 'WHOLE_NUMBER']),
  pricetype: names(['LAST', 'BID', 'ASK', 'MARK'])
};
// members compare case-insensitively: lower-case lookup tables
export const NS_LC = Object.fromEntries(Object.keys(NS).map((k) => [k, Object.fromEntries(Object.keys(NS[k]).map((m) => [m.toLowerCase(), NS[k][m]]))]));
export const NS_NAMES = { color: 'Color', averagetype: 'AverageType', aggregationperiod: 'AggregationPeriod', paintingstrategy: 'PaintingStrategy',
  curve: 'Curve', alert: 'Alert', sound: 'Sound', crossingdirection: 'CrossingDirection', double: 'Double', location: 'Location', fontsize: 'FontSize',
  numberformat: 'NumberFormat', pricetype: 'PriceType' };
export const CONSTS = { yes: 1, no: 0, true: 1, false: 0 };
export const BAR_FIELDS = ['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4'];

// ---------- value helpers ----------
export const num = (v) => (typeof v === 'number' ? v : v && v.study ? v.value() : typeof v === 'boolean' ? +v : NaN);
export const truth = (v) => { const x = num(v); return x === x && x !== 0; };
const fin = Number.isFinite;
export function fmtNum(x, dp) {
  if (typeof x !== 'number') return x == null ? '' : String(x);
  if (x !== x) return 'N/A';
  if (!fin(x)) return x > 0 ? 'Infinity' : '-Infinity';
  if (dp != null) return x.toFixed(dp);
  if (Number.isInteger(x)) return String(x);
  return String(Number(x.toFixed(Math.abs(x) >= 1 ? 4 : 6)));
}
export const text = (v) => (typeof v === 'string' ? v : isColor(v) ? '' : fmtNum(num(v)));

// ---------- window maths (series accessor g(i), current bar I) ----------
function sma(g, I, len) {
  len = Math.trunc(len);
  if (!(len >= 1) || I - len + 1 < 0) return NaN;
  let s = 0;
  for (let k = I - len + 1; k <= I; k++) s += g(k);
  return s / len;
}
function wma(g, I, len) {
  len = Math.trunc(len);
  if (!(len >= 1) || I - len + 1 < 0) return NaN;
  let s = 0, w = 0;
  for (let k = 0; k < len; k++) { const wt = len - k; s += g(I - k) * wt; w += wt; }
  return s / w;
}
function extreme(g, I, len, hi) {
  len = Math.trunc(len);
  if (!(len >= 1) || I - len + 1 < 0) return NaN;
  let m = NaN;
  for (let k = I - len + 1; k <= I; k++) { const v = g(k); if (v === v && (m !== m || (hi ? v > m : v < m))) m = v; }
  return m;
}
function stdev(g, I, len) {
  const m = sma(g, I, len); if (m !== m) return NaN;
  let s = 0; for (let k = I - len + 1; k <= I; k++) { const d = g(k) - m; s += d * d; }
  return Math.sqrt(s / Math.trunc(len));
}
function linreg(g, I, len) {   // least squares over the last len bars, x = 0 (oldest) .. len-1 (now): [value now, slope]
  len = Math.trunc(len);
  if (!(len >= 2) || I - len + 1 < 0) return [NaN, NaN];
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let x = 0; x < len; x++) { const y = g(I - len + 1 + x); sx += x; sy += y; sxy += x * y; sxx += x * x; }
  const d = len * sxx - sx * sx, slope = (len * sxy - sx * sy) / d, icpt = (sy - slope * sx) / len;
  return [icpt + slope * (len - 1), slope];
}
// recursive averages keep their outputs per bar (st.v) so a second call on the same bar gives the same answer
function emaStep(st, I, x, len) {
  const v = st.v || (st.v = []);
  const p = v[I - 1], a = 2 / (Math.trunc(len) + 1);
  const r = x !== x ? NaN : (typeof p === 'number' && p === p ? p + a * (x - p) : x);
  v[I] = r; return r;
}
function wildersStep(st, I, x, len, g) {
  const v = st.v || (st.v = []);
  const p = v[I - 1];
  const r = x !== x ? NaN : (typeof p === 'number' && p === p ? p + (x - p) / Math.trunc(len) : sma(g, I, len));
  v[I] = r; return r;
}
// MovingAverage of x (pushed into st.h so the window functions can read it)
function hist(st, key) { return st[key] || (st[key] = { h: [] }); }
const reader = (h) => (i) => { const v = h[i]; return typeof v === 'number' ? v : NaN; };
export function maStep(type, st, I, x, len) {
  const S = hist(st, 'ma');
  S.h[I] = x;
  const g = S.g || (S.g = reader(S.h));
  switch (String(type).toUpperCase()) {
    case 'EXPONENTIAL': return emaStep(S, I, x, len);
    case 'WEIGHTED': return wma(g, I, len);
    case 'WILDERS': return wildersStep(S, I, x, len, g);
    case 'HULL': {
      const n = Math.trunc(len), A = hist(st, 'hull');
      A.h[I] = 2 * wma(g, I, Math.max(1, Math.floor(n / 2))) - wma(g, I, n);
      const ga = A.g || (A.g = reader(A.h));
      return wma(ga, I, Math.max(1, Math.floor(Math.sqrt(n))));
    }
    default: return sma(g, I, len);
  }
}

// ---------- time (exchange clock: US Eastern) ----------
const ET = (() => { try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }); } catch (e) { return null; } })();
const offCache = new Map();
function etOffset(ms) {   // ms to add to UTC to get US Eastern wall time
  const key = Math.floor(ms / 36e5);
  let o = offCache.get(key);
  if (o === undefined) {
    if (!ET) o = -5 * 36e5;
    else {
      const p = {}; for (const x of ET.formatToParts(new Date(key * 36e5))) p[x.type] = x.value;
      o = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - key * 36e5;
    }
    if (offCache.size > 20000) offCache.clear();
    offCache.set(key, o);
  }
  return o;
}
export const etDate = (ms) => new Date(ms + etOffset(ms));   // read with getUTC*()
// the trading day: futures and crypto sessions start at 18:00 ET and count as the next day
function tradeDay(c, ms) { return c.utcDay ? new Date(ms) : etDate(c.futuresDay ? ms + 6 * 36e5 : ms); }   // crypto: UTC days
const ymd = (d) => d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
const fromYmd = (v) => { v = Math.trunc(v); return Date.UTC(Math.floor(v / 10000), Math.floor(v / 100) % 100 - 1, v % 100); };
const hhmmSec = (v) => { v = Math.trunc(v); return Math.floor(v / 100) * 3600 + (v % 100) * 60; };
function etWallToUtc(dayUtc, sec) {   // a wall clock time in New York on a date -> epoch ms
  const guess = dayUtc + sec * 1000;
  return guess - etOffset(guess - etOffset(guess));
}
const etSecOfDay = (ms) => { const d = etDate(ms); return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds(); };
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t - y0) / 864e5 + 1) / 7);
}

// ---------- the natives ----------
const P = (p, d, s, f, x) => Object.assign({ p, d: d || {}, s: s || [], f }, x || {});
const m1 = (fn) => P(['value'], null, null, (c, a) => fn(num(a[0])));
const t = (c) => c.bars.time[c.I];
const colorArg = (v, d) => colorOf(v) || d;

export const NATIVES = {
  // math
  absvalue: m1(Math.abs), acos: m1(Math.acos), asin: m1(Math.asin), atan: m1(Math.atan), ceil: m1(Math.ceil), cos: m1(Math.cos),
  exp: m1(Math.exp), floor: m1(Math.floor), lg: m1(Math.log10), log: m1(Math.log), sign: m1((x) => (x !== x ? NaN : Math.sign(x))),
  sin: m1(Math.sin), sqr: m1((x) => x * x), sqrt: m1(Math.sqrt), tan: m1(Math.tan),
  isnan: m1((x) => (x !== x ? 1 : 0)), isinfinite: m1((x) => (x === Infinity || x === -Infinity ? 1 : 0)),
  max: P(['value1', 'value2'], null, null, (c, a) => { const x = num(a[0]), y = num(a[1]); return x !== x || y !== y ? NaN : Math.max(x, y); }),
  min: P(['value1', 'value2'], null, null, (c, a) => { const x = num(a[0]), y = num(a[1]); return x !== x || y !== y ? NaN : Math.min(x, y); }),
  power: P(['number', 'power'], null, null, (c, a) => Math.pow(num(a[0]), num(a[1]))),
  round: P(['number', 'numberOfDigits'], { numberofdigits: 2 }, null, (c, a) => { const f = Math.pow(10, Math.trunc(num(a[1]))); return Math.round(num(a[0]) * f) / f; }),
  rounddown: P(['number', 'numberOfDigits'], { numberofdigits: 2 }, null, (c, a) => { const f = Math.pow(10, Math.trunc(num(a[1]))); const x = num(a[0]) * f; return (x < 0 ? Math.ceil(x) : Math.floor(x)) / f; }),
  roundup: P(['number', 'numberOfDigits'], { numberofdigits: 2 }, null, (c, a) => { const f = Math.pow(10, Math.trunc(num(a[1]))); const x = num(a[0]) * f; return (x < 0 ? Math.floor(x) : Math.ceil(x)) / f; }),
  random: P([], null, null, (c) => c.rand()),
  between: P(['parameter', 'value1', 'value2'], null, null, (c, a) => { const x = num(a[0]); return x >= num(a[1]) && x <= num(a[2]) ? 1 : 0; }),
  // series
  average: P(['data', 'length'], { length: 12 }, [0], (c, a, S) => sma(S[0], c.I, num(a[1]))),
  simplemovingaverage: P(['data', 'length'], { length: 12 }, [0], (c, a, S) => sma(S[0], c.I, num(a[1]))),
  expaverage: P(['data', 'length'], { length: 12 }, null, (c, a, S, st) => emaStep(st, c.I, num(a[0]), num(a[1]))),
  wma: P(['data', 'length'], { length: 9 }, [0], (c, a, S) => wma(S[0], c.I, num(a[1]))),
  wildersaverage: P(['data', 'length'], { length: 12 }, [0], (c, a, S, st) => wildersStep(st, c.I, num(a[0]), num(a[1]), S[0])),
  hullaverage: P(['data', 'length'], { length: 20 }, null, (c, a, S, st) => maStep('HULL', st, c.I, num(a[0]), num(a[1]))),
  movingaverage: P(['averageType', 'data', 'length'], { length: 12 }, null, (c, a, S, st) => maStep(a[0], st, c.I, num(a[1]), num(a[2]))),
  highest: P(['data', 'length'], { length: 12 }, [0], (c, a, S) => extreme(S[0], c.I, num(a[1]), true)),
  lowest: P(['data', 'length'], { length: 12 }, [0], (c, a, S) => extreme(S[0], c.I, num(a[1]), false)),
  sum: P(['data', 'length'], { length: 12 }, [0], (c, a, S) => { const l = Math.trunc(num(a[1])); return l >= 1 && c.I - l + 1 >= 0 ? sma(S[0], c.I, l) * l : NaN; }),
  stdev: P(['data', 'length'], { length: 12 }, [0], (c, a, S) => stdev(S[0], c.I, num(a[1]))),
  lindev: P(['data', 'length'], { length: 12 }, [0], (c, a, S) => {
    const l = Math.trunc(num(a[1])), m = sma(S[0], c.I, l); if (m !== m) return NaN;
    let s = 0; for (let k = c.I - l + 1; k <= c.I; k++) s += Math.abs(S[0](k) - m); return s / l;
  }),
  median: P(['data', 'length'], { length: 3 }, [0], (c, a, S) => {
    const l = Math.trunc(num(a[1])); if (!(l >= 1) || c.I - l + 1 < 0) return NaN;
    const w = []; for (let k = c.I - l + 1; k <= c.I; k++) w.push(S[0](k)); if (w.some((x) => x !== x)) return NaN;
    w.sort((x, y) => x - y); return l % 2 ? w[(l - 1) / 2] : (w[l / 2 - 1] + w[l / 2]) / 2;
  }),
  inertia: P(['data', 'length'], { length: 12 }, [0], (c, a, S) => linreg(S[0], c.I, num(a[1]))[0]),
  linearregressionslope: P(['data', 'length'], { length: 12 }, [0], (c, a, S) => linreg(S[0], c.I, num(a[1]))[1]),
  correlation: P(['data1', 'data2', 'length'], { length: 10 }, [0, 1], (c, a, S) => {
    const l = Math.trunc(num(a[2])), mx = sma(S[0], c.I, l), my = sma(S[1], c.I, l); if (mx !== mx || my !== my) return NaN;
    let sxy = 0, sxx = 0, syy = 0; for (let k = c.I - l + 1; k <= c.I; k++) { const dx = S[0](k) - mx, dy = S[1](k) - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
  }),
  covariance: P(['data1', 'data2', 'length'], { length: 10 }, [0, 1], (c, a, S) => {
    const l = Math.trunc(num(a[2])), mx = sma(S[0], c.I, l), my = sma(S[1], c.I, l); if (mx !== mx || my !== my) return NaN;
    let s = 0; for (let k = c.I - l + 1; k <= c.I; k++) s += (S[0](k) - mx) * (S[1](k) - my); return s / l;
  }),
  isascending: P(['value', 'length'], { length: 3 }, [0], (c, a, S) => { const s = linreg(S[0], c.I, num(a[1]))[1]; return s !== s ? 0 : s > 0 ? 1 : 0; }),
  isdescending: P(['value', 'length'], { length: 3 }, [0], (c, a, S) => { const s = linreg(S[0], c.I, num(a[1]))[1]; return s !== s ? 0 : s < 0 ? 1 : 0; }),
  getmaxvalueoffset: P(['data', 'length'], { length: 25 }, [0], (c, a, S) => offsetOf(S[0], c.I, num(a[1]), true)),
  getminvalueoffset: P(['data', 'length'], { length: 25 }, [0], (c, a, S) => offsetOf(S[0], c.I, num(a[1]), false)),
  truerange: P(['high', 'close', 'low'], null, [0, 1, 2], (c, a, S) => {
    const h = num(a[0]), l = num(a[2]), pc = S[1](c.I - 1);
    return pc === pc ? Math.max(h, pc) - Math.min(l, pc) : h - l;
  }),
  getvalue: P(['data', 'dynamicOffset', 'maxOffset'], { maxoffset: 0 }, [0], (c, a, S) => { const o = Math.trunc(num(a[1])); return o === o ? S[0](c.I - o) : NaN; }),
  compoundvalue: P(['length', 'visibleData', 'historicalData'], { historicaldata: 0 }, null, (c, a) => (c.I >= Math.trunc(num(a[0])) ? a[1] : a[2])),
  crosses: P(['data1', 'data2', 'direction'], { direction: 'any' }, [0, 1], (c, a, S) => crossAt(S[0], S[1], c.I, dirOf(a[2]))),
  // whole-chart values (computed after a first pass over every bar)
  highestall: P(['data'], null, [0], null, { all: 'max' }), lowestall: P(['data'], null, [0], null, { all: 'min' }),
  totalsum: P(['data'], null, [0], null, { all: 'sum' }), stdevall: P(['data'], null, [0], null, { all: 'stdev' }),
  inertiaall: P(['data'], null, [0], null, { all: 'inertia' }),
  // TradeZoro helpers (not in every thinkScript platform)
  barssince: P(['condition'], null, null, (c, a, S, st) => {
    const L = st.last || (st.last = []);
    L[c.I] = truth(a[0]) ? c.I : (c.I > 0 && typeof L[c.I - 1] === 'number' ? L[c.I - 1] : NaN);
    return c.I - L[c.I];
  }),
  valuewhen: P(['condition', 'data', 'occurrence'], { occurrence: 0 }, null, (c, a, S, st) => {
    const H = st.hits || (st.hits = []);
    if (H.length && H[H.length - 1][0] === c.I) H.pop();
    if (truth(a[0])) H.push([c.I, num(a[1])]);
    const o = Math.trunc(num(a[2]));
    return o >= 0 && o < H.length ? H[H.length - 1 - o][1] : NaN;
  }),
  sarvalue: P(['accelerationFactor', 'accelerationLimit'], { accelerationfactor: 0.02, accelerationlimit: 0.2 }, null, (c, a, S, st) => sarStep(c, st, num(a[0]), num(a[1]))),
  // bars and time
  barnumber: P([], null, null, (c) => c.I + 1),
  gettime: P([], null, null, (c) => t(c)),
  getday: P([], null, null, (c) => { const d = tradeDay(c, t(c)); return Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5) + 1; }),
  getyyyymmdd: P([], null, null, (c) => ymd(tradeDay(c, t(c)))),
  getyear: P([], null, null, (c) => tradeDay(c, t(c)).getUTCFullYear()),
  getmonth: P([], null, null, (c) => tradeDay(c, t(c)).getUTCMonth() + 1),
  getweek: P([], null, null, (c) => isoWeek(tradeDay(c, t(c)))),
  getlastday: P([], null, null, (c) => { const d = tradeDay(c, c.bars.time[c.n - 1]); return Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5) + 1; }),
  getlastyyyymmdd: P([], null, null, (c) => ymd(tradeDay(c, c.bars.time[c.n - 1]))),
  getlastmonth: P([], null, null, (c) => tradeDay(c, c.bars.time[c.n - 1]).getUTCMonth() + 1),
  getlastyear: P([], null, null, (c) => tradeDay(c, c.bars.time[c.n - 1]).getUTCFullYear()),
  getlastweek: P([], null, null, (c) => isoWeek(tradeDay(c, c.bars.time[c.n - 1]))),
  counttradingdays: P(['fromDate', 'toDate'], null, null, (c, a) => {
    let d = fromYmd(num(a[0])); const e = fromYmd(num(a[1])); if (!(e >= d) || e - d > 3e11) return 0;
    let k = 0; for (; d <= e; d += 864e5) { const w = new Date(d).getUTCDay(); if (w && w !== 6) k++; } return k;
  }),
  getdayofweek: P(['yyyyMmDd'], null, null, (c, a) => { const w = new Date(fromYmd(num(a[0]))).getUTCDay(); return w === 0 ? 7 : w; }),
  getdayofmonth: P(['yyyyMmDd'], null, null, (c, a) => Math.trunc(num(a[0])) % 100),
  daysfromdate: P(['fromDate'], null, null, (c, a) => Math.round((fromYmd(ymd(tradeDay(c, t(c)))) - fromYmd(num(a[0]))) / 864e5)),
  daystilldate: P(['tillDate'], null, null, (c, a) => Math.round((fromYmd(num(a[0])) - fromYmd(ymd(tradeDay(c, t(c))))) / 864e5)),
  secondsfromtime: P(['fromTime'], null, null, (c, a) => etSecOfDay(t(c)) - hhmmSec(num(a[0]))),
  secondstilltime: P(['tillTime'], null, null, (c, a) => hhmmSec(num(a[0])) - etSecOfDay(t(c))),
  regulartradingstart: P(['yyyyMmDd'], null, null, (c, a) => etWallToUtc(fromYmd(num(a[0])), 9.5 * 3600)),
  regulartradingend: P(['yyyyMmDd'], null, null, (c, a) => etWallToUtc(fromYmd(num(a[0])), 16 * 3600)),
  getaggregationperiod: P([], null, null, (c) => c.tfMs),
  getsymbol: P([], null, null, (c) => c.symbol),
  getsymbolpart: P(['position'], { position: 1 }, null, (c) => c.symbol),
  ticksize: P([], null, null, (c) => c.tick),
  tickvalue: P([], null, null, (c) => c.tick),
  isrealtime: P([], null, null, (c) => (c.I === c.n - 1 ? 1 : 0)),
  // text
  concat: P(['value1', 'value2'], null, null, (c, a) => text(a[0]) + text(a[1])),
  astext: P(['number', 'format'], { format: '' }, null, (c, a) => fmtAs(c, num(a[0]), a[1])),
  asprice: P(['number'], null, null, (c, a) => fmtNum(num(a[0]), c.dp)),
  asdollars: P(['number'], null, null, (c, a) => { const x = num(a[0]); return x !== x ? 'N/A' : (x < 0 ? '-$' : '$') + Math.abs(x).toFixed(2); }),
  aspercent: P(['number'], null, null, (c, a) => { const x = num(a[0]); return x !== x ? 'N/A' : (x * 100).toFixed(2) + '%'; }),
  // colours
  createcolor: P(['red', 'green', 'blue'], null, null, (c, a) => col('#' + hex2(num(a[0])) + hex2(num(a[1])) + hex2(num(a[2])))),
  getcolor: P(['index'], null, null, (c, a) => { const i = Math.trunc(num(a[0])); return PALETTE[((i % 10) + 10) % 10] || PALETTE[0]; }),
  globalcolor: P(['name'], null, null, (c, a) => c.globalColors[String(a[0]).toLowerCase()] || COLOR.GRAY),
  // statements: chart output
  addlabel: P(['visible', 'text', 'color', 'location', 'size'], { color: COLOR.GRAY, location: 'TOP_LEFT', size: 'SMALL' }, null, (c, a) => {
    if (c.I !== c.n - 1 || !truth(a[0]) || c.out.labels.length >= c.L.labels) return;
    c.out.labels.push({ text: text(a[1]).slice(0, 200), color: colorArg(a[2], COLOR.GRAY).rgb || HEX.GRAY });
  }, { stmt: true }),
  addchartbubble: P(['timeCondition', 'priceLocation', 'text', 'color', 'up'], { color: COLOR.GRAY, up: 1 }, null, (c, a) => {
    if (!truth(a[0])) return;
    const y = num(a[1]); if (!fin(y)) return;
    if (c.out.bubbles.length >= c.L.bubbles) { c.note('Only the last ' + c.L.bubbles + ' chart bubbles are shown.'); c.out.bubbles.shift(); }
    c.out.bubbles.push({ i: c.I, y, text: text(a[2]).slice(0, 200), color: colorArg(a[3], COLOR.GRAY).rgb || HEX.GRAY, up: truth(a[4]) });
  }, { stmt: true }),
  addverticalline: P(['visible', 'text', 'color', 'stroke'], { text: '', color: COLOR.GRAY, stroke: 'SHORT_DASH' }, null, (c, a) => {
    if (!truth(a[0])) return;
    if (c.out.vlines.length >= c.L.vlines) { c.note('Only the last ' + c.L.vlines + ' vertical lines are shown.'); c.out.vlines.shift(); }
    c.out.vlines.push({ i: c.I, text: text(a[1]).slice(0, 100), color: colorArg(a[2], COLOR.GRAY).rgb || HEX.GRAY, stroke: String(a[3]) });
  }, { stmt: true }),
  addcloud: P(['data1', 'data2', 'color1', 'color2', 'showBorder'], { color1: COLOR.YELLOW, color2: COLOR.RED, showborder: 0 }, null, (c, a, S, st) => {
    if (!st.cloud) { if (c.out.clouds.length >= 20) return; st.cloud = { a: new Float64Array(c.n).fill(NaN), b: new Float64Array(c.n).fill(NaN) }; c.out.clouds.push(st.cloud); }
    st.cloud.a[c.I] = num(a[0]); st.cloud.b[c.I] = num(a[1]);
    st.cloud.up = colorArg(a[2], COLOR.YELLOW).rgb; st.cloud.dn = colorArg(a[3], COLOR.RED).rgb; st.cloud.border = truth(a[4]);
  }, { stmt: true }),
  assignpricecolor: P(['color'], null, null, (c, a) => { const k = colorOf(a[0]); if (k && k.rgb) c.out.barColors[c.I] = k.rgb; }, { stmt: true }),
  alert: P(['condition', 'text', 'alertType', 'sound'], { text: '', alerttype: 'BAR', sound: 'NoSound' }, null, (c, a) => {
    if (c.I !== c.n - 1 || !truth(a[0]) || c.out.alerts.length >= 20) return;
    c.out.alerts.push({ text: text(a[1]).slice(0, 200), type: String(a[2]).toUpperCase(), sound: String(a[3]) });
  }, { stmt: true }),
  defineglobalcolor: P(['name', 'color'], null, null, (c, a) => { const k = colorOf(a[1]); if (k) c.globalColors[String(a[0]).toLowerCase()] = k; }, { stmt: true })
};

function offsetOf(g, I, len, hi) {
  len = Math.trunc(len); if (!(len >= 1) || I - len + 1 < 0) return NaN;
  let best = NaN, at = NaN;
  for (let k = 0; k < len; k++) { const v = g(I - k); if (v === v && (best !== best || (hi ? v > best : v < best))) { best = v; at = k; } }
  return at;
}
const dirOf = (d) => (typeof d === 'number' ? (d ? 'above' : 'below') : String(d).toLowerCase());
export function crossAt(ga, gb, I, dir) {
  if (I < 1) return 0;
  const a = ga(I), b = gb(I), pa = ga(I - 1), pb = gb(I - 1);
  if (a !== a || b !== b || pa !== pa || pb !== pb) return 0;
  const up = a > b && pa <= pb, dn = a < b && pa >= pb;
  return (dir === 'above' ? up : dir === 'below' ? dn : up || dn) ? 1 : 0;
}
function fmtAs(c, x, f) {
  switch (String(f || '').toUpperCase()) {
    case 'WHOLE_NUMBER': return fmtNum(Math.round(x));
    case 'TWO_DECIMAL_PLACES': return fmtNum(x, 2);
    case 'THREE_DECIMAL_PLACES': return fmtNum(x, 3);
    case 'DOLLAR': return x !== x ? 'N/A' : (x < 0 ? '-$' : '$') + Math.abs(x).toFixed(2);
    default: return fmtNum(x);
  }
}
// Parabolic stop and reverse, one bar at a time (state per bar so a repeat call on the same bar is stable)
function sarStep(c, st, af0, afMax) {
  const H = c.bars.high, L = c.bars.low, I = c.I;
  const s = st.s || (st.s = { sar: [], ep: [], af: [], up: [] });
  if (I === 0) { s.up[0] = true; s.sar[0] = L[0]; s.ep[0] = H[0]; s.af[0] = af0; return NaN; }
  if (I === 1) { const up = H[1] + L[1] >= H[0] + L[0]; s.up[1] = up; s.sar[1] = up ? Math.min(L[0], L[1]) : Math.max(H[0], H[1]); s.ep[1] = up ? Math.max(H[0], H[1]) : Math.min(L[0], L[1]); s.af[1] = af0; return s.sar[1]; }
  let up = s.up[I - 1], ep = s.ep[I - 1], af = s.af[I - 1];
  let sar = s.sar[I - 1] + af * (ep - s.sar[I - 1]);
  if (up) {
    sar = Math.min(sar, L[I - 1], L[I - 2]);
    if (L[I] < sar) { up = false; sar = ep; ep = L[I]; af = af0; }
    else if (H[I] > ep) { ep = H[I]; af = Math.min(af + af0, afMax); }
  } else {
    sar = Math.max(sar, H[I - 1], H[I - 2]);
    if (H[I] > sar) { up = true; sar = ep; ep = H[I]; af = af0; }
    else if (L[I] < ep) { ep = L[I]; af = Math.min(af + af0, afMax); }
  }
  s.up[I] = up; s.ep[I] = ep; s.af[I] = af; s.sar[I] = sar;
  return sar;
}
// whole-chart aggregate of a finished series
export function allOf(kind, g, n) {
  const v = []; for (let i = 0; i < n; i++) { const x = g(i); if (x === x) v.push(x); }
  if (!v.length) return NaN;
  if (kind === 'max') return v.reduce((m, x) => (x > m ? x : m), -Infinity);
  if (kind === 'min') return v.reduce((m, x) => (x < m ? x : m), Infinity);
  if (kind === 'sum') return v.reduce((s, x) => s + x, 0);
  if (kind === 'stdev') { const m = v.reduce((s, x) => s + x, 0) / v.length; return Math.sqrt(v.reduce((s, x) => s + (x - m) * (x - m), 0) / v.length); }
  if (kind === 'inertia') return linreg((i) => v[i], v.length - 1, v.length)[0];
  return NaN;
}

// Not available on TradeZoro: one clear line each.
const ORDERS = 'Strategy orders are not supported on TradeZoro. Use plots, labels and alerts instead.';
const FUND = 'Fundamental, option and account data are not available to scripts on TradeZoro.';
const SCAN = 'This scan or watchlist function is not supported on TradeZoro charts.';
export const UNSUPPORTED = Object.fromEntries([
  ...['addorder', 'entryprice', 'getaverageprice', 'getquantity', 'getopenpl', 'getnetliq', 'getdailypl', 'getyyyymmddentry'].map((k) => [k, ORDERS]),
  ...['fundamental', 'imp_volatility', 'open_interest', 'seriesvolatility', 'optionprice', 'getactualearnings', 'getestimatedearnings', 'hasearnings',
    'getdividend', 'isoptionable', 'getnextexpirationoption', 'getstrike', 'getunderlyingsymbol', 'getevent', 'geteventoffset', 'tick_count', 'sizeofticks'].map((k) => [k, FUND]),
  ...['getmarketcap', 'getsectorname', 'getscanname', 'addwatchlist', 'scan', 'gettotalcash'].map((k) => [k, SCAN]),
  ['assignbackgroundcolor', 'AssignBackgroundColor is not supported on TradeZoro. Use AddCloud or AssignPriceColor instead.'],
  ['assignnormgradientcolor', 'Gradient plot colours are not supported yet. Use AssignValueColor with if ... then ... else.'],
  ['assigngradientcolor', 'Gradient plot colours are not supported yet. Use AssignValueColor with if ... then ... else.']
]);
