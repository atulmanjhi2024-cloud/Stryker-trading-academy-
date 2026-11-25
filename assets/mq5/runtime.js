// TradeZoro MQL5 engine: runtime core. Arrays, runtime errors, number/time/colour formatting, the op budget.
// Pure. One Runtime object per running indicator (the compiler's closures capture it).
import { EMPTY_VALUE, CLR_NONE, COLOR_NAMES } from './consts.js?v=1279';

export class MqRuntimeError extends Error {
  constructor(message, line, code) { super(message); this.line = line || 0; this.code = code || 'E400'; this.mqRuntime = true; }
}
export const rtErr = (msg, line, code) => new MqRuntimeError(msg, line, code);

export const LIMITS = {
  opsPerSlice: 200000,
  calcMs: 20000,           // one OnInit / OnCalculate call
  eventMs: 2000,           // one OnTimer / OnChartEvent call
  maxElems: 6000000,       // all array elements held by one indicator
  maxString: 1 << 20,      // characters in one string
  maxDepth: 400,           // nested calls
  maxObjects: 2000,        // chart objects
  maxPrints: 400,
};

// ---------- arrays ----------
// d = storage, oldest first (index 0) unless the array is a timeseries (ser), which only remaps indexes.
// inner = fixed sizes of the 2nd..4th dimensions (C-style flat storage); dyn = first dimension can be resized.
export class MArr {
  constructor(R, def, dyn, inner, n) {
    this.R = R; this.def = def; this.dyn = dyn; this.inner = inner || []; this.ser = false; this.buf = null; this.ro = false;
    this.stride = 1; for (const k of this.inner) this.stride *= k;
    this.d = [];
    if (n) this.resize(n, 0);
  }
  get n() { return this.stride === 1 ? this.d.length : (this.d.length / this.stride) | 0; }
  fresh() { const v = this.def; return typeof v === 'function' ? v() : v; }
  resize(n, line) {
    n = Math.max(0, n | 0);
    const want = n * this.stride, have = this.d.length;
    if (want === have) return n;
    const R = this.R;
    if (R) { R.mem += want - have; if (R.mem > LIMITS.maxElems) { R.mem -= want - have; throw rtErr('Out of memory: the arrays hold more than ' + (LIMITS.maxElems / 1e6) + ' million values.', line, 'E402'); } R.ops -= Math.abs(want - have) >> 4; }
    if (want < have) this.d.length = want;
    else { const d = this.d; const f = typeof this.def === 'function'; for (let i = have; i < want; i++) d.push(f ? this.def() : this.def); }
    return n;
  }
  // physical index of a 1-D logical index (timeseries arrays count from the newest element)
  pi(i, line) {
    const n = this.d.length;
    if (!(i >= 0 && i < n) || i !== Math.floor(i)) throw rtErr('Array out of range (index ' + i + ', size ' + n + ').', line, 'E403');
    return this.ser ? n - 1 - i : i;
  }
  get(i, line) { return this.d[this.pi(i, line)]; }
  set(i, v, line) { if (this.ro) throw rtErr('This array is read-only.', line); this.d[this.pi(i, line)] = v; return v; }
  // multi-dimensional flat offset
  off(ix, line) {
    const n0 = this.n;
    let i0 = ix[0];
    if (!(i0 >= 0 && i0 < n0)) throw rtErr('Array out of range (index ' + i0 + ', size ' + n0 + ').', line, 'E403');
    let o = i0;
    for (let k = 1; k < ix.length; k++) {
      const lim = this.inner[k - 1], v = ix[k];
      if (!(v >= 0 && v < lim)) throw rtErr('Array out of range (index ' + v + ', size ' + lim + ').', line, 'E403');
      o = o * lim + v;
    }
    for (let k = ix.length; k <= this.inner.length; k++) o *= this.inner[k - 1];
    return o;
  }
  clone() { const a = new MArr(this.R, this.def, this.dyn, this.inner); a.ser = this.ser; a.d = this.d.map(cloneVal); if (this.R) this.R.mem += a.d.length; return a; }
  // logical view as a plain JS array (oldest first when not series)
  logical() { return this.ser ? this.d.slice().reverse() : this.d.slice(); }
}
// structs are plain JS arrays of field values (fields resolved to slots at compile time, never member-named keys)
export function cloneVal(v) {
  if (v instanceof MArr) return v.clone();
  if (Array.isArray(v)) return v.map(cloneVal);
  return v;
}
// in-place struct copy (keeps the reference a by-reference parameter holds)
export function copyInto(dst, src) {
  for (let i = 0; i < src.length; i++) {
    const s = src[i];
    if (s instanceof MArr) { const d = dst[i]; d.resize(s.n); for (let k = 0; k < s.d.length; k++) d.d[k] = cloneVal(s.d[k]); }
    else if (Array.isArray(s)) copyInto(dst[i], s);
    else dst[i] = s;
  }
  return dst;
}

// ---------- numbers ----------
export const toInt = (x) => (typeof x === 'number' ? x | 0 : +x | 0);
export const toLong = (x) => { x = +x; return Number.isFinite(x) ? Math.trunc(x) : 0; };
export function fmtDouble(v, digits) {
  if (digits === undefined || digits < 0) {
    if (!Number.isFinite(v)) return Number.isNaN(v) ? 'nan' : v > 0 ? 'inf' : '-inf';
    if (Math.abs(v) >= 1e16 || (v !== 0 && Math.abs(v) < 1e-5)) return String(Number(v.toPrecision(16))).replace('e+', 'e+').replace(/e([+-])(\d)$/, 'e$10$2');
    return String(Number(v.toPrecision(16)));
  }
  if (!Number.isFinite(v)) return Number.isNaN(v) ? 'nan' : v > 0 ? 'inf' : '-inf';
  return v.toFixed(Math.min(16, Math.max(0, digits | 0)));
}
export const fmtBool = (b) => (b ? 'true' : 'false');

// ---------- colours ----------
export const clamp255 = (v) => Math.max(0, Math.min(255, v | 0));
// MQL colour (0x00BBGGRR) -> '#rrggbb' (or null for clrNONE)
export function hexOf(c, alpha) {
  c = c >>> 0;
  if (c === CLR_NONE) return null;
  const r = c & 255, g = (c >> 8) & 255, b = (c >> 16) & 255;
  const h = (x) => (x < 16 ? '0' : '') + x.toString(16);
  return '#' + h(r) + h(g) + h(b) + (alpha === undefined ? '' : h(clamp255(alpha)));
}
export function colorOfHex(s) {
  const m = /^#?([0-9a-f]{6})/i.exec(String(s || ''));
  if (!m) return 0;
  const h = parseInt(m[1], 16);
  return ((h >> 16) & 255) | (((h >> 8) & 255) << 8) | ((h & 255) << 16);
}
export function colorToString(c, names) {
  c = c >>> 0;
  if (c === CLR_NONE) return names ? 'clrNONE' : 'CLR_NONE';
  if (names && COLOR_NAMES.has(c)) return COLOR_NAMES.get(c);
  return (c & 255) + ',' + ((c >> 8) & 255) + ',' + ((c >> 16) & 255);
}
export function stringToColor(s) {
  s = String(s || '').trim();
  for (const [v, n] of COLOR_NAMES) if (n.toLowerCase() === s.toLowerCase() || n.slice(3).toLowerCase() === s.toLowerCase()) return v;
  const p = s.split(',').map((x) => parseInt(x, 10));
  if (p.length === 3 && p.every((x) => x >= 0 && x <= 255)) return p[0] | (p[1] << 8) | (p[2] << 16);
  const m = /^(?:0x|#)([0-9a-f]{6})$/i.exec(s);
  if (m) return colorOfHex(m[1]);
  return 0;
}

// ---------- time (datetime = seconds since 1970, UTC is the "server" clock here) ----------
const p2 = (x) => (x < 10 ? '0' : '') + x;
export function timeToString(t, mode) {
  if (mode === undefined) mode = 3;
  const d = new Date(Math.trunc(+t || 0) * 1000);
  if (Number.isNaN(d.getTime())) return '';
  let s = '';
  if (mode & 1) s = d.getUTCFullYear() + '.' + p2(d.getUTCMonth() + 1) + '.' + p2(d.getUTCDate());
  if (mode & 6) s += (s ? ' ' : '') + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + (mode & 4 ? ':' + p2(d.getUTCSeconds()) : '');
  return s;
}
export function stringToTime(s) {
  const m = /^\s*(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(String(s || ''));
  if (m) return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) / 1000);
  const t = /^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/.exec(String(s || ''));
  if (t) { const n = new Date(); return Math.floor(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), +t[1], +t[2], +(t[3] || 0)) / 1000); }
  return 0;
}
export function timeStruct(t) {
  const d = new Date(Math.trunc(+t || 0) * 1000);
  const y0 = Date.UTC(d.getUTCFullYear(), 0, 1);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCDay(), Math.floor((d.getTime() - y0) / 86400000)];
}
export const structTime = (s) => Math.floor(Date.UTC(s[0] | 0, (s[1] | 0) - 1, s[2] | 0, s[3] | 0, s[4] | 0, s[5] | 0) / 1000);

// ---------- StringFormat / PrintFormat (hand-written: widths and precisions are capped) ----------
export function format(fmt, args) {
  fmt = String(fmt);
  let out = '', ai = 0;
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i];
    if (c !== '%') { out += c; continue; }
    if (fmt[i + 1] === '%') { out += '%'; i++; continue; }
    const m = /^([-+ 0#]*)(\*|\d+)?(?:\.(\*|\d+))?(hh|h|ll|l|I64|I32)?([diouxXeEfgGcsaA])/.exec(fmt.slice(i + 1));
    if (!m) { out += c; continue; }
    i += m[0].length;
    const flags = m[1];
    let w = m[2] === '*' ? +args[ai++] : m[2] ? +m[2] : 0;
    let pr = m[3] === '*' ? +args[ai++] : m[3] !== undefined ? +m[3] : -1;
    w = Math.min(512, Math.max(0, w | 0)); pr = Math.min(64, pr | 0);
    const v = args[ai++];
    let s;
    switch (m[5]) {
      case 'd': case 'i': { const n = Math.trunc(+v || 0); s = String(Math.abs(n)); if (pr >= 0) s = s.padStart(pr, '0'); s = (n < 0 ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '') + s; break; }
      case 'u': s = String(Math.trunc(+v || 0) >>> 0); break;
      case 'o': s = (Math.trunc(+v || 0) >>> 0).toString(8); break;
      case 'x': case 'X': { const n = Math.trunc(+v || 0); s = (n < 0 ? (n >>> 0) : n).toString(16); if (pr >= 0) s = s.padStart(pr, '0'); if (flags.includes('#') && n) s = '0x' + s; if (m[5] === 'X') s = s.toUpperCase(); break; }
      case 'f': { const n = +v; s = Number.isFinite(n) ? n.toFixed(pr < 0 ? 6 : pr) : fmtDouble(n); if (n >= 0 && flags.includes('+')) s = '+' + s; else if (n >= 0 && flags.includes(' ')) s = ' ' + s; break; }
      case 'e': case 'E': { const n = +v; s = Number.isFinite(n) ? n.toExponential(pr < 0 ? 6 : pr).replace(/e([+-])(\d)$/, 'e$10$2') : fmtDouble(n); if (m[5] === 'E') s = s.toUpperCase(); if (n >= 0 && flags.includes('+')) s = '+' + s; break; }
      case 'g': case 'G': { const n = +v; s = Number.isFinite(n) ? String(Number(n.toPrecision(pr < 0 ? 6 : Math.max(1, pr)))) : fmtDouble(n); if (m[5] === 'G') s = s.toUpperCase(); break; }
      case 'a': case 'A': s = fmtDouble(+v); break;
      case 'c': s = String.fromCharCode(+v || 0); break;
      case 's': s = typeof v === 'string' ? v : typeof v === 'boolean' ? fmtBool(v) : v === undefined ? '' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : fmtDouble(v)) : String(v); if (pr >= 0) s = s.slice(0, pr); break;
      default: s = '';
    }
    if (s.length < w) {
      if (flags.includes('-')) s = s.padEnd(w, ' ');
      else if (flags.includes('0') && /[dioxXufeEgG]/.test(m[5])) { const sign = /^[-+ ]/.test(s) ? s[0] : ''; s = sign + s.slice(sign.length).padStart(w - sign.length, '0'); }
      else s = s.padStart(w, ' ');
    }
    out += s;
    if (out.length > LIMITS.maxString) throw rtErr('A string is longer than 1 million characters.', 0, 'E402');
  }
  return out;
}

// literal text replace (never a RegExp built from member text)
export function replaceAll(s, find, rep) {
  if (!find) return { s, n: 0 };
  let out = '', i = 0, n = 0;
  for (;;) {
    const j = s.indexOf(find, i);
    if (j < 0) break;
    out += s.slice(i, j) + rep; i = j + find.length; n++;
    if (out.length > LIMITS.maxString) throw rtErr('A string is longer than 1 million characters.', 0, 'E402');
  }
  return { s: out + s.slice(i), n };
}
export const isEmpty = (v, ev) => v === ev || v === EMPTY_VALUE || !Number.isFinite(v);
