// TradeZoro MQL5 engine: the maths behind the technical indicator handles (iMA, iRSI, iMACD ...).
// Pure. Inputs are plain arrays, oldest first; outputs are Float64Array, NaN where a value is not defined yet.
// The conventions follow the terminal's standard indicators: EMA seeded with the first price, the MACD signal is a
// simple average, ATR is a simple average of true range, ADX smooths with the EMA factor 2/(n+1).

const N = (n) => new Float64Array(n).fill(NaN);
const first = (a) => { for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i])) return i; return a.length; };

export function applied(b, mode) {
  const n = b.close.length, o = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const H = b.high[i], L = b.low[i], C = b.close[i];
    o[i] = mode === 2 ? b.open[i] : mode === 3 ? H : mode === 4 ? L : mode === 5 ? (H + L) / 2 : mode === 6 ? (H + L + C) / 3 : mode === 7 ? (H + L + 2 * C) / 4 : C;
  }
  return o;
}
export function sma(src, p) {
  const n = src.length, o = N(n), s0 = first(src);
  let sum = 0;
  for (let i = s0; i < n; i++) {
    sum += src[i];
    if (i - p >= s0) sum -= src[i - p];
    if (i - s0 >= p - 1) o[i] = sum / p;
  }
  // re-sum every 4096 bars would cut drift; a 1e-9 drift over 20k bars is far below what a chart shows
  return o;
}
export function ema(src, p, alpha) {
  const n = src.length, o = N(n), s0 = first(src), a = alpha || 2 / (p + 1);
  if (s0 >= n) return o;
  o[s0] = src[s0];
  for (let i = s0 + 1; i < n; i++) o[i] = src[i] * a + o[i - 1] * (1 - a);
  return o;
}
export function smma(src, p) {
  const n = src.length, o = N(n), s0 = first(src);
  if (s0 + p > n) return o;
  let s = 0; for (let i = s0; i < s0 + p; i++) s += src[i];
  o[s0 + p - 1] = s / p;
  for (let i = s0 + p; i < n; i++) o[i] = (o[i - 1] * (p - 1) + src[i]) / p;
  return o;
}
export function lwma(src, p) {
  const n = src.length, o = N(n), s0 = first(src), w = (p * (p + 1)) / 2;
  for (let i = s0 + p - 1; i < n; i++) { let s = 0; for (let k = 0; k < p; k++) s += src[i - k] * (p - k); o[i] = s / w; }
  return o;
}
export const ma = (src, p, m) => (m === 1 ? ema(src, p) : m === 2 ? smma(src, p) : m === 3 ? lwma(src, p) : sma(src, p));
export function shift(a, s) {
  if (!s) return a;
  const n = a.length, o = N(n);
  for (let i = 0; i < n; i++) { const j = i - s; if (j >= 0 && j < n) o[i] = a[j]; }
  return o;
}
export function rsi(src, p) {
  const n = src.length, o = N(n), s0 = first(src);
  if (s0 + p >= n) return o;
  let pos = 0, neg = 0;
  for (let i = s0 + 1; i <= s0 + p; i++) { const d = src[i] - src[i - 1]; if (d > 0) pos += d; else neg -= d; }
  pos /= p; neg /= p;
  const val = () => (neg !== 0 ? 100 - 100 / (1 + pos / neg) : pos !== 0 ? 100 : 50);
  o[s0 + p] = val();
  for (let i = s0 + p + 1; i < n; i++) {
    const d = src[i] - src[i - 1];
    pos = (pos * (p - 1) + (d > 0 ? d : 0)) / p;
    neg = (neg * (p - 1) + (d < 0 ? -d : 0)) / p;
    o[i] = val();
  }
  return o;
}
export function macd(src, f, s, sig) {
  const a = ema(src, f), b = ema(src, s), n = src.length, m = new Float64Array(n);
  for (let i = 0; i < n; i++) m[i] = a[i] - b[i];
  return [m, sma(m, sig)];
}
export function stdevAround(src, mid, p) {
  const n = src.length, o = N(n);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(mid[i]) || i - p + 1 < 0) continue;
    let s = 0; for (let k = 0; k < p; k++) { const d = src[i - k] - mid[i]; s += d * d; }
    o[i] = Math.sqrt(s / p);
  }
  return o;
}
export function bands(src, p, dev) {
  const mid = sma(src, p), sd = stdevAround(src, mid, p), n = src.length, up = N(n), lo = N(n);
  for (let i = 0; i < n; i++) if (Number.isFinite(mid[i])) { up[i] = mid[i] + dev * sd[i]; lo[i] = mid[i] - dev * sd[i]; }
  return [mid, up, lo];
}
export function trueRange(b) {
  const n = b.close.length, t = N(n);
  for (let i = 1; i < n; i++) t[i] = Math.max(b.high[i], b.close[i - 1]) - Math.min(b.low[i], b.close[i - 1]);
  return t;
}
export function atr(b, p) {
  const tr = trueRange(b), n = tr.length, o = N(n);
  if (p + 1 > n) return o;
  let s = 0; for (let i = 1; i <= p; i++) s += tr[i];
  o[p] = s / p;
  for (let i = p + 1; i < n; i++) o[i] = o[i - 1] + (tr[i] - tr[i - p]) / p;
  return o;
}
export function stoch(b, kp, dp, slow, method, field) {
  const n = b.close.length, hh = N(n), ll = N(n), main = N(n);
  const hi = field === 1 ? b.close : b.high, lo = field === 1 ? b.close : b.low;
  for (let i = kp - 1; i < n; i++) { let h = -Infinity, l = Infinity; for (let k = 0; k < kp; k++) { if (hi[i - k] > h) h = hi[i - k]; if (lo[i - k] < l) l = lo[i - k]; } hh[i] = h; ll[i] = l; }
  for (let i = kp - 1 + slow - 1; i < n; i++) {
    let sh = 0, sl = 0;
    for (let k = 0; k < slow; k++) { sl += b.close[i - k] - ll[i - k]; sh += hh[i - k] - ll[i - k]; }
    main[i] = sh === 0 ? 100 : (sl / sh) * 100;
  }
  return [main, ma(main, dp, method)];
}
export function cci(src, p) {
  const n = src.length, m = sma(src, p), o = N(n);
  for (let i = p - 1; i < n; i++) {
    if (!Number.isFinite(m[i])) continue;
    let d = 0; for (let k = 0; k < p; k++) d += Math.abs(src[i - k] - m[i]);
    d *= 0.015 / p;
    o[i] = d !== 0 ? (src[i] - m[i]) / d : 0;
  }
  return o;
}
function dmParts(b, i) {
  let up = b.high[i] - b.high[i - 1], dn = b.low[i - 1] - b.low[i];
  if (up < 0) up = 0; if (dn < 0) dn = 0;
  if (up > dn) dn = 0; else if (up < dn) up = 0; else { up = 0; dn = 0; }
  const tr = Math.max(Math.abs(b.high[i] - b.low[i]), Math.abs(b.high[i] - b.close[i - 1]), Math.abs(b.low[i] - b.close[i - 1]));
  return [up, dn, tr];
}
export function adx(b, p) {
  const n = b.close.length, A = N(n), P = N(n), M = N(n), a = 2 / (p + 1);
  if (!n) return [A, P, M];
  A[0] = P[0] = M[0] = 0;
  for (let i = 1; i < n; i++) {
    const [up, dn, tr] = dmParts(b, i);
    const pd = tr !== 0 ? (100 * up) / tr : 0, nd = tr !== 0 ? (100 * dn) / tr : 0;
    P[i] = pd * a + P[i - 1] * (1 - a);
    M[i] = nd * a + M[i - 1] * (1 - a);
    const s = P[i] + M[i], dx = s !== 0 ? (100 * Math.abs(P[i] - M[i])) / s : 0;
    A[i] = dx * a + A[i - 1] * (1 - a);
  }
  return [A, P, M];
}
// Wilder's original: running sums smoothed by 1/n, ADX = Wilder average of DX
export function adxWilder(b, p) {
  const n = b.close.length, A = N(n), P = N(n), M = N(n);
  let str = 0, sp = 0, sm = 0, dxs = 0, cnt = 0, prev = NaN;
  for (let i = 1; i < n; i++) {
    const [up, dn, tr] = dmParts(b, i);
    if (i <= p) { str += tr; sp += up; sm += dn; if (i < p) continue; }
    else { str = str - str / p + tr; sp = sp - sp / p + up; sm = sm - sm / p + dn; }
    P[i] = str ? (100 * sp) / str : 0; M[i] = str ? (100 * sm) / str : 0;
    const s = P[i] + M[i], dx = s ? (100 * Math.abs(P[i] - M[i])) / s : 0;
    if (cnt < p) { dxs += dx; cnt++; if (cnt === p) { prev = dxs / p; A[i] = prev; } }
    else { prev = (prev * (p - 1) + dx) / p; A[i] = prev; }
  }
  return [A, P, M];
}
export function momentum(src, p) { const n = src.length, o = N(n); for (let i = p; i < n; i++) o[i] = src[i - p] !== 0 ? (src[i] * 100) / src[i - p] : NaN; return o; }
// Parabolic SAR (Wilder): starts long on bar 1 if close rose, else short
export function sar(b, step, max) {
  const n = b.close.length, o = N(n);
  if (n < 2) return o;
  let long = b.close[1] >= b.close[0], af = step, ep = long ? Math.max(b.high[0], b.high[1]) : Math.min(b.low[0], b.low[1]);
  let s = long ? Math.min(b.low[0], b.low[1]) : Math.max(b.high[0], b.high[1]);
  o[1] = s;
  for (let i = 2; i < n; i++) {
    s = s + af * (ep - s);
    if (long) {
      s = Math.min(s, b.low[i - 1], b.low[i - 2]);
      if (b.low[i] < s) { long = false; s = ep; ep = b.low[i]; af = step; }
      else if (b.high[i] > ep) { ep = b.high[i]; af = Math.min(max, af + step); }
    } else {
      s = Math.max(s, b.high[i - 1], b.high[i - 2]);
      if (b.high[i] > s) { long = true; s = ep; ep = b.high[i]; af = step; }
      else if (b.low[i] < ep) { ep = b.low[i]; af = Math.min(max, af + step); }
    }
    o[i] = s;
  }
  return o;
}
export function envelopes(src, p, m, dev) {
  const mid = ma(src, p, m), n = src.length, up = N(n), lo = N(n);
  for (let i = 0; i < n; i++) if (Number.isFinite(mid[i])) { up[i] = mid[i] * (1 + dev / 100); lo[i] = mid[i] * (1 - dev / 100); }
  return [up, lo];
}
export const stddev = (src, p, m) => stdevAround(src, ma(src, p, m), p);
export function dema(src, p) { const e1 = ema(src, p), e2 = ema(e1, p), n = src.length, o = N(n); for (let i = 0; i < n; i++) o[i] = 2 * e1[i] - e2[i]; return o; }
export function tema(src, p) { const e1 = ema(src, p), e2 = ema(e1, p), e3 = ema(e2, p), n = src.length, o = N(n); for (let i = 0; i < n; i++) o[i] = 3 * e1[i] - 3 * e2[i] + e3[i]; return o; }
export function trix(src, p) { const e3 = ema(ema(ema(src, p), p), p), n = src.length, o = N(n); for (let i = 1; i < n; i++) o[i] = e3[i - 1] ? (e3[i] - e3[i - 1]) / e3[i - 1] : NaN; return o; }
export function wpr(b, p) {
  const n = b.close.length, o = N(n);
  for (let i = p - 1; i < n; i++) { let h = -Infinity, l = Infinity; for (let k = 0; k < p; k++) { h = Math.max(h, b.high[i - k]); l = Math.min(l, b.low[i - k]); } o[i] = h !== l ? (-(h - b.close[i]) * 100) / (h - l) : 0; }
  return o;
}
export function obv(b, vol) { const n = b.close.length, o = N(n); if (!n) return o; o[0] = vol[0]; for (let i = 1; i < n; i++) o[i] = o[i - 1] + (b.close[i] > b.close[i - 1] ? vol[i] : b.close[i] < b.close[i - 1] ? -vol[i] : 0); return o; }
export function mfi(b, p, vol) {
  const n = b.close.length, tp = applied(b, 6), o = N(n);
  for (let i = p; i < n; i++) {
    let pos = 0, neg = 0;
    for (let k = 0; k < p; k++) { const j = i - k, f = tp[j] * vol[j]; if (tp[j] > tp[j - 1]) pos += f; else if (tp[j] < tp[j - 1]) neg += f; }
    o[i] = neg !== 0 ? 100 - 100 / (1 + pos / neg) : 100;
  }
  return o;
}
export function ao(b) { const m = applied(b, 5), f = sma(m, 5), s = sma(m, 34), n = m.length, o = N(n); for (let i = 0; i < n; i++) o[i] = f[i] - s[i]; return o; }
export function ac(b) { const a = ao(b), s = sma(a, 5), n = a.length, o = N(n); for (let i = 0; i < n; i++) o[i] = a[i] - s[i]; return o; }
export function osma(src, f, s, sig) { const [m, g] = macd(src, f, s, sig), n = m.length, o = N(n); for (let i = 0; i < n; i++) o[i] = m[i] - g[i]; return o; }
export function bears(b, p) { const e = ema(b.close, p), n = e.length, o = N(n); for (let i = 0; i < n; i++) o[i] = b.low[i] - e[i]; return o; }
export function bulls(b, p) { const e = ema(b.close, p), n = e.length, o = N(n); for (let i = 0; i < n; i++) o[i] = b.high[i] - e[i]; return o; }
export function force(b, p, m, vol) { const n = b.close.length, raw = N(n); for (let i = 1; i < n; i++) raw[i] = vol[i] * (b.close[i] - b.close[i - 1]); return ma(raw, p, m); }
export function demarker(b, p) {
  const n = b.close.length, mx = N(n), mn = N(n), o = N(n);
  for (let i = 1; i < n; i++) { mx[i] = Math.max(0, b.high[i] - b.high[i - 1]); mn[i] = Math.max(0, b.low[i - 1] - b.low[i]); }
  const a = sma(mx, p), c = sma(mn, p);
  for (let i = 0; i < n; i++) if (Number.isFinite(a[i])) o[i] = a[i] + c[i] !== 0 ? a[i] / (a[i] + c[i]) : 0;
  return o;
}
export function fractals(b) {
  const n = b.close.length, up = N(n), dn = N(n);
  for (let i = 2; i < n - 2; i++) {
    const h = b.high[i], l = b.low[i];
    if (h > b.high[i - 1] && h > b.high[i - 2] && h >= b.high[i + 1] && h >= b.high[i + 2]) up[i] = h;
    if (l < b.low[i - 1] && l < b.low[i - 2] && l <= b.low[i + 1] && l <= b.low[i + 2]) dn[i] = l;
  }
  return [up, dn];
}
export function ad(b, vol) {
  const n = b.close.length, o = N(n); let s = 0;
  for (let i = 0; i < n; i++) { const r = b.high[i] - b.low[i]; s += r ? ((b.close[i] - b.low[i] - (b.high[i] - b.close[i])) / r) * vol[i] : 0; o[i] = s; }
  return o;
}
export function chaikin(b, f, s, m, vol) { const a = ad(b, vol), x = ma(a, f, m), y = ma(a, s, m), n = a.length, o = N(n); for (let i = 0; i < n; i++) o[i] = x[i] - y[i]; return o; }
