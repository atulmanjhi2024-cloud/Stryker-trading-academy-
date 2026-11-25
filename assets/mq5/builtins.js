// TradeZoro MQL5 engine: the built-in function library. Pure (no DOM, no network).
// Each entry: { ps: [param], min, va?, ret, f(R, line, ...args), pure?, types?, sig, cat, doc }.
//   param: { t: 'double'|'int'|'long'|'uint'|'str'|'bool'|'datetime'|'color'|'ushort'|'num'|'any', def?, ref?, arr?, w?, st?, anyv? }
//   ref params arrive as Ref objects (get/set); arrays as MArr; structs as plain JS arrays of field values.
// R is the running indicator (assets/mq5/program.js): bars, buffers, plots, objects, timer, handles, output.
import { MArr, rtErr, LIMITS, fmtDouble, timeToString, stringToTime, timeStruct, structTime, colorToString, stringToColor, format, replaceAll, hexOf } from './runtime.js?v=1284';
import { EMPTY_VALUE, ENUMS } from './consts.js?v=1284';
import * as TA from './ta.js?v=1284';

export const BUILTINS = new Map();
const TMAP = { d: 'double', i: 'int', l: 'long', u: 'uint', s: 'str', b: 'bool', t: 'datetime', c: 'color', n: 'num', a: 'any', h: 'ushort', f: 'float' };
const AMAP = { d: 'double', i: 'int', l: 'long', s: 'string', n: 'num', t: 'datetime', '*': 'any', r: 'MqlRates' };
function P(spec) {
  let def;
  const eq = spec.indexOf('=');
  if (eq > 0) { const v = spec.slice(eq + 1); spec = spec.slice(0, eq); def = v === '' ? '' : v === 'true' ? true : v === 'false' ? false : /^-?[\d.]+(e-?\d+)?$/.test(v) ? +v : v === 'EMPTY' ? EMPTY_VALUE : v.replace(/^'|'$/g, ''); }
  if (spec === 'X') return { anyv: true, t: 'any', def };
  if (spec[0] === '&') return { ref: true, t: TMAP[spec[1]] || 'any', def };
  if (spec[0] === 'A') return { arr: true, w: spec.includes('w'), t: AMAP[spec[1]] || 'any', def };
  if (spec.startsWith('S:')) return { st: true, t: spec.slice(2) };
  return { t: TMAP[spec] || 'any', def };
}
// def('Name', 'd,i=0', 'double', fn, { pure, types, va, cat, doc })
function def(name, specs, ret, f, o) {
  o = o || {};
  const ps = specs ? specs.split(',').map((s) => P(s.trim())) : [];
  let min = ps.findIndex((p) => p.def !== undefined); if (min < 0) min = ps.length;
  const d = { name, ps, min, ret, f, pure: !!o.pure, types: !!o.types, va: o.va ? { t: 'any' } : null, cat: o.cat || CAT, doc: o.doc || '', sig: o.sig || name + '(' + (specs || '') + (o.va ? ', ...' : '') + ')', alias: o.alias || '' };
  const old = BUILTINS.get(name);
  if (!old) BUILTINS.set(name, d); else BUILTINS.set(name, (Array.isArray(old) ? old : [old]).concat([d]));
  return d;
}
let CAT = 'Common';
const cat = (c) => { CAT = c; };
const toArr = (b) => (Array.isArray(b) ? b : [b]);
export const builtinCount = () => BUILTINS.size;
export const builtinList = () => [...BUILTINS.values()].map((b) => toArr(b)[0]).map((b) => ({ name: b.name, cat: b.cat, sig: toArr(BUILTINS.get(b.name)).map((x) => x.sig).join('  |  '), doc: b.doc, alias: b.alias }));

const num = (x) => (typeof x === 'boolean' ? +x : x);
const common = (T) => (T.some((t) => t.n === 'double' || t.n === 'float') ? 'double' : T.some((t) => ['long', 'ulong', 'datetime'].includes(t.n)) ? 'long' : T.some((t) => t.n === 'uint' || t.n === 'color') ? 'uint' : 'int');
const WHOLE = -1;

// ---------- printing ----------
export function fmtAny(v, t) {
  if (t && t.n === 'datetime') return timeToString(v, 3);
  if (t && t.n === 'color') return colorToString(v, true);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return t && (t.n === 'double' || t.n === 'float') ? fmtDouble(v) : String(v);
  if (v instanceof MArr) return '(array)';
  if (Array.isArray(v)) return '(struct)';
  return v === undefined ? '' : String(v);
}
const joinArgs = (T, args) => { let s = ''; for (let i = 0; i < args.length; i++) { s += fmtAny(args[i], T[i]); if (s.length > LIMITS.maxString) throw rtErr('A string is longer than 1 million characters.', 0, 'E402'); } return s; };

// ======================= Math =======================
cat('Math');
const m1 = (name, fn, alias, doc) => { def(name, 'd', 'double', (R, l, x) => fn(x), { pure: true, doc }); if (alias) def(alias, 'd', 'double', (R, l, x) => fn(x), { pure: true, alias: name, doc }); };
def('MathAbs', 'n', (T) => (T[0].n === 'double' || T[0].n === 'float' ? 'double' : common(T)), (R, l, x) => Math.abs(num(x)), { pure: true, doc: 'Absolute value.' });
def('fabs', 'd', 'double', (R, l, x) => Math.abs(x), { pure: true, alias: 'MathAbs' });
m1('MathArccos', Math.acos, 'acos', 'Arc cosine, in radians.');
m1('MathArcsin', Math.asin, 'asin', 'Arc sine, in radians.');
m1('MathArctan', Math.atan, 'atan', 'Arc tangent, in radians.');
def('MathArctan2', 'd,d', 'double', (R, l, y, x) => Math.atan2(y, x), { pure: true, doc: 'Angle of the point (x, y).' });
def('atan2', 'd,d', 'double', (R, l, y, x) => Math.atan2(y, x), { pure: true, alias: 'MathArctan2' });
m1('MathCeil', Math.ceil, 'ceil', 'Rounds up to a whole number.');
m1('MathFloor', Math.floor, 'floor', 'Rounds down to a whole number.');
m1('MathCos', Math.cos, 'cos', 'Cosine.');
m1('MathSin', Math.sin, 'sin', 'Sine.');
m1('MathTan', Math.tan, 'tan', 'Tangent.');
m1('MathExp', Math.exp, 'exp', 'e to the power x.');
m1('MathLog', Math.log, 'log', 'Natural logarithm.');
m1('MathLog10', Math.log10, 'log10', 'Base-10 logarithm.');
m1('MathSqrt', Math.sqrt, 'sqrt', 'Square root.');
m1('MathExpm1', Math.expm1, '', 'e^x - 1, exact for small x.');
m1('MathLog1p', Math.log1p, '', 'log(1 + x), exact for small x.');
m1('MathArccosh', Math.acosh, '', 'Inverse hyperbolic cosine.');
m1('MathArcsinh', Math.asinh, '', 'Inverse hyperbolic sine.');
m1('MathArctanh', Math.atanh, '', 'Inverse hyperbolic tangent.');
m1('MathCosh', Math.cosh, 'cosh', 'Hyperbolic cosine.');
m1('MathSinh', Math.sinh, 'sinh', 'Hyperbolic sine.');
m1('MathTanh', Math.tanh, 'tanh', 'Hyperbolic tangent.');
// MathRound: half away from zero, as the terminal does (JS Math.round rounds -2.5 to -2)
const roundAway = (x) => (x < 0 ? -Math.round(-x) : Math.round(x));
m1('MathRound', roundAway, 'round', 'Rounds to the nearest whole number (halves away from zero).');
def('MathMax', 'n,n', common, (R, l, a, b) => Math.max(num(a), num(b)), { pure: true, types: false, doc: 'The larger of two values.' });
def('MathMin', 'n,n', common, (R, l, a, b) => Math.min(num(a), num(b)), { pure: true, doc: 'The smaller of two values.' });
def('fmax', 'd,d', 'double', (R, l, a, b) => Math.max(a, b), { pure: true, alias: 'MathMax' });
def('fmin', 'd,d', 'double', (R, l, a, b) => Math.min(a, b), { pure: true, alias: 'MathMin' });
def('MathMod', 'd,d', 'double', (R, l, a, b) => a % b, { pure: true, doc: 'Remainder of a / b (sign of a).' });
def('fmod', 'd,d', 'double', (R, l, a, b) => a % b, { pure: true, alias: 'MathMod' });
def('MathPow', 'd,d', 'double', (R, l, a, b) => Math.pow(a, b), { pure: true, doc: 'a to the power b.' });
def('pow', 'd,d', 'double', (R, l, a, b) => Math.pow(a, b), { pure: true, alias: 'MathPow' });
def('MathIsValidNumber', 'd', 'bool', (R, l, x) => Number.isFinite(x), { pure: true, doc: 'False for NaN and infinity.' });
const rnd = (R) => { R.seed = (Math.imul(R.seed, 214013) + 2531011) >>> 0; return (R.seed >>> 16) & 0x7fff; };
def('MathRand', '', 'int', (R) => rnd(R), { doc: 'Pseudo-random whole number 0 to 32767.' });
def('rand', '', 'int', (R) => rnd(R), { alias: 'MathRand' });
def('MathSrand', 'u', 'void', (R, l, s) => { R.seed = s >>> 0; }, { doc: 'Sets the start of the MathRand sequence.' });
def('srand', 'u', 'void', (R, l, s) => { R.seed = s >>> 0; }, { alias: 'MathSrand' });
def('MathSwap', 'n', (T) => T[0], (R, l, x) => { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, x >>> 0); return b.getUint32(0, true); }, { pure: true, doc: 'Reverses the byte order of a 32-bit value.' });
def('NormalizeDouble', 'd,i', 'double', (R, l, v, d) => { d = Math.max(0, Math.min(8, d | 0)); const k = 10 ** d; return roundAway(v * k) / k; }, { pure: true, cat: 'Conversion', doc: 'Rounds a price to the given number of decimals (0 to 8).' });

// Math\Stat\Math.mqh (statistics on arrays). Logical order; NaN-safe like the library.
cat('Statistics');
const vals = (a) => a.logical();
const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
const variance = (v) => { if (v.length < 2) return NaN; const m = mean(v); return v.reduce((s, x) => s + (x - m) * (x - m), 0) / (v.length - 1); };
const chargeArr = (R, a) => { R.ops -= a.d.length >> 3; };
def('MathMean', 'An', 'double', (R, l, a) => { chargeArr(R, a); return a.n ? mean(vals(a)) : NaN; }, { doc: 'Average of the array.' });
def('MathVariance', 'An', 'double', (R, l, a) => { chargeArr(R, a); return variance(vals(a)); }, { doc: 'Sample variance (n - 1).' });
def('MathStandardDeviation', 'An', 'double', (R, l, a) => { chargeArr(R, a); return Math.sqrt(variance(vals(a))); }, { doc: 'Sample standard deviation (n - 1).' });
def('MathAverageDeviation', 'An', 'double', (R, l, a) => { chargeArr(R, a); const v = vals(a); if (!v.length) return NaN; const m = mean(v); return v.reduce((s, x) => s + Math.abs(x - m), 0) / v.length; }, { doc: 'Mean absolute deviation from the average.' });
def('MathMedian', 'An', 'double', (R, l, a) => { chargeArr(R, a); const v = vals(a).sort((x, y) => x - y), n = v.length; return !n ? NaN : n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2; }, { doc: 'Middle value of the array.' });
def('MathSkewness', 'An', 'double', (R, l, a) => { chargeArr(R, a); const v = vals(a), n = v.length; if (n < 3) return NaN; const m = mean(v), s = Math.sqrt(variance(v)); return (n / ((n - 1) * (n - 2))) * v.reduce((t, x) => t + ((x - m) / s) ** 3, 0); }, { doc: 'Skewness of the array.' });
def('MathKurtosis', 'An', 'double', (R, l, a) => { chargeArr(R, a); const v = vals(a), n = v.length; if (n < 4) return NaN; const m = mean(v), s = Math.sqrt(variance(v)); const k = v.reduce((t, x) => t + ((x - m) / s) ** 4, 0); return (n * (n + 1) * k) / ((n - 1) * (n - 2) * (n - 3)) - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3)); }, { doc: 'Excess kurtosis of the array.' });
def('MathSum', 'An', 'double', (R, l, a) => { chargeArr(R, a); return vals(a).reduce((s, x) => s + x, 0); }, { doc: 'Sum of the array.' });
def('MathProduct', 'An', 'double', (R, l, a) => { chargeArr(R, a); return vals(a).reduce((s, x) => s * x, 1); }, { doc: 'Product of the array.' });
def('MathRange', 'An,&d,&d', 'bool', (R, l, a, mn, mx) => { chargeArr(R, a); if (!a.n) return false; const v = vals(a); mn.set(Math.min(...v)); mx.set(Math.max(...v)); return true; }, { doc: 'Smallest and largest value of the array.' });
def('MathCorrelationPearson', 'An,An,&d', 'bool', (R, l, a, b, r) => { chargeArr(R, a); const x = vals(a), y = vals(b), n = Math.min(x.length, y.length); if (n < 2) return false; const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n)); let sxy = 0, sx = 0, sy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sx += (x[i] - mx) ** 2; sy += (y[i] - my) ** 2; } r.set(sxy / Math.sqrt(sx * sy)); return true; }, { doc: 'Pearson correlation of two arrays.' });
// Math\Stat\Normal.mqh (scalar forms)
const erf = (x) => { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; };
const normCdf = (x, m, s) => 0.5 * (1 + erf((x - m) / (s * Math.SQRT2)));
// Acklam's rational approximation of the normal quantile
function normInv(p) {
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - lo) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
def('MathProbabilityDensityNormal', 'd,d,d', 'double', (R, l, x, m, s) => Math.exp(-0.5 * ((x - m) / s) ** 2) / (s * Math.sqrt(2 * Math.PI)), { pure: true, doc: 'Normal density at x (mean, sigma).' });
def('MathCumulativeDistributionNormal', 'd,d,d', 'double', (R, l, x, m, s) => normCdf(x, m, s), { pure: true, doc: 'Normal probability of a value below x.' });
def('MathQuantileNormal', 'd,d,d', 'double', (R, l, p, m, s) => m + s * normInv(p), { pure: true, doc: 'Value with probability p below it (normal).' });
def('MathRandomNormal', 'd,d', 'double', (R, l, m, s) => { const u = (rnd(R) + 1) / 32769, v = (rnd(R) + 1) / 32769; return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }, { doc: 'Random value from a normal distribution.' });
// more distributions (Math\Stat): density, probability below x, quantile, random draw
const u01 = (R) => (rnd(R) + 0.5) / 32768;
const fam = (name, pdf, cdf, q, args, doc) => {
  const sp = 'd,' + args.map(() => 'd').join(',');
  def('MathProbabilityDensity' + name, sp, 'double', (R, l, x, ...a) => pdf(x, ...a), { pure: true, doc: doc + ' density at x.' });
  def('MathCumulativeDistribution' + name, sp, 'double', (R, l, x, ...a) => cdf(x, ...a), { pure: true, doc: doc + ' probability of a value below x.' });
  def('MathQuantile' + name, sp, 'double', (R, l, p, ...a) => (p < 0 || p > 1 ? NaN : q(p, ...a)), { pure: true, doc: doc + ' value with probability p below it.' });
  def('MathRandom' + name, args.map(() => 'd').join(','), 'double', (R, l, ...a) => q(u01(R), ...a), { doc: 'Random value from the ' + doc.toLowerCase() + ' distribution.' });
};
fam('Uniform', (x, a, b) => (x >= a && x <= b && b > a ? 1 / (b - a) : 0), (x, a, b) => (x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a)), (p, a, b) => a + p * (b - a), ['a', 'b'], 'Uniform (a, b)');
fam('Exponential', (x, m) => (x < 0 || m <= 0 ? 0 : Math.exp(-x / m) / m), (x, m) => (x <= 0 ? 0 : 1 - Math.exp(-x / m)), (p, m) => -m * Math.log(1 - p), ['m'], 'Exponential (mean m)');
fam('Lognormal', (x, m, s) => (x <= 0 ? 0 : Math.exp(-0.5 * ((Math.log(x) - m) / s) ** 2) / (x * s * Math.sqrt(2 * Math.PI))), (x, m, s) => (x <= 0 ? 0 : normCdf(Math.log(x), m, s)), (p, m, s) => Math.exp(m + s * normInv(p)), ['m', 's'], 'Lognormal');
fam('Logistic', (x, m, s) => { const z = Math.exp(-(x - m) / s); return z / (s * (1 + z) ** 2); }, (x, m, s) => 1 / (1 + Math.exp(-(x - m) / s)), (p, m, s) => m + s * Math.log(p / (1 - p)), ['m', 's'], 'Logistic');
fam('Cauchy', (x, a, b) => 1 / (Math.PI * b * (1 + ((x - a) / b) ** 2)), (x, a, b) => 0.5 + Math.atan((x - a) / b) / Math.PI, (p, a, b) => a + b * Math.tan(Math.PI * (p - 0.5)), ['a', 'b'], 'Cauchy');
fam('Weibull', (x, a, b) => (x < 0 ? 0 : (a / b) * (x / b) ** (a - 1) * Math.exp(-((x / b) ** a))), (x, a, b) => (x <= 0 ? 0 : 1 - Math.exp(-((x / b) ** a))), (p, a, b) => b * (-Math.log(1 - p)) ** (1 / a), ['a', 'b'], 'Weibull (shape a, scale b)');
const lgam = (x) => { // Lanczos log-gamma
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgam(1 - x);
  const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  x -= 1; let a = 0.99999999999980993; const t = x + 7.5;
  for (let i = 0; i < 8; i++) a += g[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
};
const choose = (n, k) => (k < 0 || k > n ? 0 : Math.round(Math.exp(lgam(n + 1) - lgam(k + 1) - lgam(n - k + 1))));
const binPdf = (k, n, p) => (k < 0 || k > n || k !== Math.floor(k) ? 0 : Math.exp(lgam(n + 1) - lgam(k + 1) - lgam(n - k + 1) + k * Math.log(p) + (n - k) * Math.log(1 - p)));
const poiPdf = (k, m) => (k < 0 || k !== Math.floor(k) ? 0 : Math.exp(k * Math.log(m) - m - lgam(k + 1)));
const discQ = (pdf, max) => (p, ...a) => { let s = 0; for (let k = 0; k <= max(...a); k++) { s += pdf(k, ...a); if (s >= p - 1e-12) return k; } return max(...a); };
const discC = (pdf) => (x, ...a) => { let s = 0; for (let k = 0; k <= Math.floor(x) && k < 100000; k++) s += pdf(k, ...a); return Math.min(1, s); };
fam('Binomial', binPdf, discC(binPdf), discQ(binPdf, (n) => n), ['n', 'p'], 'Binomial (n trials, chance p)');
fam('Poisson', poiPdf, discC(poiPdf), discQ(poiPdf, (m) => Math.ceil(m * 10 + 50)), ['m'], 'Poisson (mean m)');
def('MathGamma', 'd', 'double', (R, l, x) => (x <= 0 && x === Math.floor(x) ? NaN : x > 0 ? Math.exp(lgam(x)) : Math.PI / (Math.sin(Math.PI * x) * Math.exp(lgam(1 - x)))), { pure: true, doc: 'Gamma function.' });
def('MathLogGamma', 'd', 'double', (R, l, x) => lgam(x), { pure: true, doc: 'Natural logarithm of the gamma function.' });
def('MathBeta', 'd,d', 'double', (R, l, a, b) => Math.exp(lgam(a) + lgam(b) - lgam(a + b)), { pure: true, doc: 'Beta function.' });
def('MathFactorial', 'i', 'double', (R, l, n) => (n < 0 ? NaN : n > 170 ? Infinity : Math.round(Math.exp(lgam(n + 1)))), { pure: true, doc: 'n! (factorial).' });
def('MathBinomialCoefficient', 'i,i', 'double', (R, l, n, k) => choose(n, k), { pure: true, doc: 'Number of ways to choose k of n.' });
def('MathLog2', 'd', 'double', (R, l, x) => Math.log2(x), { pure: true, doc: 'Base-2 logarithm.' });
def('MathTrunc', 'd', 'double', (R, l, x) => Math.trunc(x), { pure: true, doc: 'Drops the fractional part.' });
def('MathPowInt', 'd,i', 'double', (R, l, x, n) => x ** n, { pure: true, doc: 'x to a whole power.' });
// array -> array helpers (result is a dynamic double array)
const toOut = (R, out, v, l) => { if (out.ro) throw rtErr('This array is read-only.', l); if (out.dyn && !out.buf) out.resize(v.length, l); const m = Math.min(v.length, out.n); for (let i = 0; i < m; i++) out.d[out.ser ? out.d.length - 1 - i : i] = v[i]; return true; };
const A2 = (name, fn, doc) => def(name, 'An,Adw', 'bool', (R, l, a, out) => { chargeArr(R, a); return toOut(R, out, fn(vals(a)), l); }, { doc });
const cum = (op) => (v) => { const o = []; v.forEach((x, i) => o.push(i ? op(o[i - 1], x) : x)); return o; };
A2('MathCumulativeSum', cum((a, b) => a + b), 'Running total of the array into result[].');
A2('MathCumulativeProduct', cum((a, b) => a * b), 'Running product into result[].');
A2('MathCumulativeMin', cum(Math.min), 'Running minimum into result[].');
A2('MathCumulativeMax', cum(Math.max), 'Running maximum into result[].');
A2('MathReverse', (v) => v.slice().reverse(), 'The array in reverse order into result[].');
A2('MathUnique', (v) => [...new Set(v)], 'The distinct values into result[].');
A2('MathQuickSortAscending', (v) => v.slice().sort((a, b) => a - b), 'Sorted copy (small to large) into result[].');
A2('MathQuickSortDescending', (v) => v.slice().sort((a, b) => b - a), 'Sorted copy (large to small) into result[].');
A2('MathRank', (v) => { const s = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]), o = new Array(v.length); for (let i = 0; i < s.length;) { let j = i; while (j + 1 < s.length && s[j + 1][0] === s[i][0]) j++; for (let k = i; k <= j; k++) o[s[k][1]] = (i + j) / 2 + 1; i = j + 1; } return o; }, 'Rank of each element (ties share the average rank) into result[].');
A2('MathOrder', (v) => v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]).map((x) => x[1]), 'Indexes that would sort the array into result[].');
def('MathSequence', 'd,d,d,Adw', 'bool', (R, l, from, to, step, out) => { if (!(step > 0) || (to - from) / step > 1e6) return false; const v = []; for (let x = from; x <= to + step * 1e-9; x += step) v.push(x); return toOut(R, out, v, l); }, { doc: 'Fills result[] with from, from+step ... up to to.' });
def('MathReplicate', 'An,i,Adw', 'bool', (R, l, a, k, out) => { if (k < 0 || a.d.length * k > 1e6) return false; const v = vals(a), o = []; for (let i = 0; i < k; i++) o.push(...v); return toOut(R, out, o, l); }, { doc: 'The array repeated k times into result[].' });
def('MathIdentical', 'An,An', 'bool', (R, l, a, b) => { const x = vals(a), y = vals(b); return x.length === y.length && x.every((v, i) => v === y[i]); }, { doc: 'Do both arrays hold the same values?' });
const quant = (s, p) => { const h = (s.length - 1) * p, lo = Math.floor(h); return s[lo] + (h - lo) * ((s[Math.min(s.length - 1, lo + 1)]) - s[lo]); };
def('MathQuantile', 'An,An,Adw', 'bool', (R, l, a, ps, out) => { const s = vals(a).sort((x, y) => x - y); if (!s.length) return false; return toOut(R, out, vals(ps).map((p) => (p < 0 || p > 1 ? NaN : quant(s, p))), l); }, { doc: 'Sample quantiles of the array for each probability in probs[].' });
def('MathInterquartileRange', 'An', 'double', (R, l, a) => { const s = vals(a).sort((x, y) => x - y); return s.length ? quant(s, 0.75) - quant(s, 0.25) : NaN; }, { doc: 'Spread between the 25% and 75% quantiles.' });
def('MathMoments', 'An,&d,&d,&d,&d,i=0,i=-1', 'bool', (R, l, a, m, v, sk, ku, st, c) => { let x = vals(a); x = x.slice(st, c < 0 ? undefined : st + c); const n = x.length; if (n < 2) return false; const mu = mean(x), s2 = x.reduce((t, y) => t + (y - mu) ** 2, 0) / (n - 1), sd = Math.sqrt(s2); m.set(mu); v.set(s2); sk.set(sd ? x.reduce((t, y) => t + ((y - mu) / sd) ** 3, 0) / n : 0); ku.set(sd ? x.reduce((t, y) => t + ((y - mu) / sd) ** 4, 0) / n - 3 : 0); return true; }, { doc: 'Mean, variance, skewness and excess kurtosis in one call.' });
def('MathCorrelationSpearman', 'An,An,&d', 'bool', (R, l, a, b, r) => {
  const rk = (v) => { const s = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]), o = new Array(v.length); for (let i = 0; i < s.length;) { let j = i; while (j + 1 < s.length && s[j + 1][0] === s[i][0]) j++; for (let k = i; k <= j; k++) o[s[k][1]] = (i + j) / 2; i = j + 1; } return o; };
  const n = Math.min(a.d.length, b.d.length); if (n < 2) return false;
  const x = rk(vals(a).slice(0, n)), y = rk(vals(b).slice(0, n)), mx = mean(x), my = mean(y);
  let sxy = 0, sx = 0, sy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sx += (x[i] - mx) ** 2; sy += (y[i] - my) ** 2; }
  r.set(sx && sy ? sxy / Math.sqrt(sx * sy) : 0); return true;
}, { doc: 'Rank correlation of two arrays (-1 to 1).' });

// ======================= Conversion =======================
cat('Conversion');
def('DoubleToString', 'd,i=8', 'string', (R, l, v, d) => fmtDouble(v, d < 0 ? 8 : Math.min(16, d)), { pure: true, doc: 'A number as text with d decimals (default 8).' });
def('IntegerToString', 'l,i=0,h=32', 'string', (R, l, v, w, ch) => { let s = String(Math.trunc(v)); if (w > 0 && s.length < w) s = String.fromCharCode(ch || 32).repeat(Math.min(512, w) - s.length) + s; return s; }, { pure: true, doc: 'A whole number as text, padded to a width.' });
def('StringToDouble', 's', 'double', (R, l, s) => { const v = parseFloat(s); return Number.isFinite(v) ? v : 0; }, { pure: true, doc: 'Text to a number (0 if it is not one).' });
def('StringToInteger', 's', 'long', (R, l, s) => { const v = parseInt(s, 10); return Number.isFinite(v) ? v : 0; }, { pure: true, doc: 'Text to a whole number.' });
def('TimeToString', 't,i=3', 'string', (R, l, t, m) => timeToString(t, m), { pure: true, doc: 'A time as "yyyy.mm.dd hh:mi" (TIME_DATE, TIME_MINUTES, TIME_SECONDS).' });
def('StringToTime', 's', 'datetime', (R, l, s) => stringToTime(s), { doc: 'Text "yyyy.mm.dd [hh:mi[:ss]]" to a time.' });
def('ColorToString', 'c,b=false', 'string', (R, l, c, names) => colorToString(c, names), { pure: true, doc: 'A colour as "r,g,b" or its clr name.' });
def('StringToColor', 's', 'color', (R, l, s) => stringToColor(s), { pure: true, doc: 'Text "r,g,b" or a colour name to a colour.' });
def('ColorToARGB', 'c,i=255', 'uint', (R, l, c, a) => (((a & 255) << 24) | ((c & 255) << 16) | (c & 0xff00) | ((c >> 16) & 255)) >>> 0, { pure: true, doc: 'A colour with alpha as 0xAARRGGBB.' });
def('CharToString', 'i', 'string', (R, l, c) => String.fromCharCode(c & 255), { pure: true, doc: 'One character code to text.' });
def('ShortToString', 'i', 'string', (R, l, c) => String.fromCharCode(c & 65535), { pure: true, doc: 'One UTF-16 code to text.' });
def('CharArrayToString', 'An,i=0,i=-1,u=0', 'string', (R, l, a, s, c) => { const v = a.logical(); const e = c < 0 ? v.length : Math.min(v.length, s + c); let o = ''; for (let i = s; i < e; i++) { if (!v[i]) break; o += String.fromCharCode(v[i] & 255); } return o; }, { doc: 'Character codes to text (stops at 0).' });
def('ShortArrayToString', 'An,i=0,i=-1', 'string', (R, l, a, s, c) => { const v = a.logical(); const e = c < 0 ? v.length : Math.min(v.length, s + c); let o = ''; for (let i = s; i < e; i++) { if (!v[i]) break; o += String.fromCharCode(v[i] & 65535); } return o; }, { doc: 'UTF-16 codes to text.' });
def('StringToCharArray', 's,Anw,i=0,i=-1,u=0', 'int', (R, l, s, a, st, c) => { const codes = [...s].map((ch) => ch.charCodeAt(0) & 255).concat([0]); const k = c < 0 ? codes.length : Math.min(c, codes.length); if (a.dyn) a.resize(Math.max(a.n, st + k), l); for (let i = 0; i < k && st + i < a.n; i++) a.set(st + i, codes[i], l); return k; }, { doc: 'Text to character codes (with a closing 0).' });
def('StringToShortArray', 's,Anw,i=0,i=-1', 'int', (R, l, s, a, st, c) => { const codes = [...s].map((ch) => ch.charCodeAt(0)).concat([0]); const k = c < 0 ? codes.length : Math.min(c, codes.length); if (a.dyn) a.resize(Math.max(a.n, st + k), l); for (let i = 0; i < k && st + i < a.n; i++) a.set(st + i, codes[i], l); return k; }, { doc: 'Text to UTF-16 codes.' });
def('EnumToString', 'a', 'string', (R, l, T, v) => { const t = T[0]; if (t && t.members && t.members.has(v)) return t.members.get(v); const E = t && ENUMS[t.n]; const m = E && E.find((x) => x[1] === v); return m ? m[0] : t && t.n + '::' + v; }, { types: true, doc: 'The name of an enum value.' });
def('StringFormat', 's', 'string', (R, l, f, ...a) => format(f, a), { va: true, cat: 'Strings', doc: 'printf-style text: %d %i %f %.2f %e %g %s %x %c %%, widths and flags.' });
// MQL4 names many pasted indicators still use
def('DoubleToStr', 'd,i=8', 'string', (R, l, v, d) => fmtDouble(v, d), { pure: true, alias: 'DoubleToString' });
def('IntegerToStr', 'l', 'string', (R, l, v) => String(Math.trunc(v)), { pure: true, alias: 'IntegerToString' });
def('TimeToStr', 't,i=3', 'string', (R, l, t, m) => timeToString(t, m), { pure: true, alias: 'TimeToString' });
def('StrToTime', 's', 'datetime', (R, l, s) => stringToTime(s), { alias: 'StringToTime' });
def('StrToDouble', 's', 'double', (R, l, s) => parseFloat(s) || 0, { pure: true, alias: 'StringToDouble' });
def('StrToInteger', 's', 'int', (R, l, s) => parseInt(s, 10) || 0, { pure: true, alias: 'StringToInteger' });
def('CharToStr', 'i', 'string', (R, l, c) => String.fromCharCode(c & 255), { pure: true, alias: 'CharToString' });

// ======================= Strings =======================
cat('Strings');
const capS = (s, line) => { if (s.length > LIMITS.maxString) throw rtErr('A string is longer than 1 million characters.', line, 'E402'); return s; };
def('StringLen', 's', 'int', (R, l, s) => s.length, { pure: true, doc: 'Number of characters.' });
def('StringBufferLen', 's', 'int', (R, l, s) => s.length, { doc: 'Size of the string buffer (the length here).' });
def('StringSubstr', 's,i,i=-1', 'string', (R, l, s, a, n) => (a < 0 || a >= s.length ? '' : n < 0 ? s.slice(a) : s.substr(a, n)), { pure: true, doc: 'Part of a string from position a, n characters (all if -1).' });
def('StringFind', 's,s,i=0', 'int', (R, l, s, f, a) => s.indexOf(f, Math.max(0, a)), { pure: true, doc: 'Position of a substring, or -1.' });
def('StringGetCharacter', 's,i', 'ushort', (R, l, s, i) => (i >= 0 && i < s.length ? s.charCodeAt(i) : 0), { pure: true, doc: 'Character code at a position.' });
def('StringSetCharacter', '&s,i,h', 'bool', (R, l, r, i, c) => { const s = r.get(); if (i < 0 || i > s.length) return false; r.set(s.slice(0, i) + String.fromCharCode(c) + s.slice(i + 1)); return true; }, { doc: 'Sets the character at a position.' });
def('StringCompare', 's,s,b=true', 'int', (R, l, a, b, cs) => { if (!cs) { a = a.toLowerCase(); b = b.toLowerCase(); } return a < b ? -1 : a > b ? 1 : 0; }, { pure: true, doc: '-1, 0 or 1 comparing two strings.' });
def('StringAdd', '&s,s', 'bool', (R, l, r, s) => { r.set(capS(r.get() + s, l)); return true; }, { doc: 'Appends text to a string variable.' });
def('StringConcatenate', '&s', 'int', (R, l, T, r, ...a) => { const s = capS(joinArgs(T.slice(1), a), l); r.set(s); return s.length; }, { va: true, types: true, doc: 'Joins any values into a string variable.' });
def('StringReplace', '&s,s,s', 'int', (R, l, r, f, w) => { const x = replaceAll(r.get(), f, w); r.set(x.s); return x.n; }, { doc: 'Replaces every copy of a text (plain text, not a pattern). Returns the count.' });
def('StringSplit', 's,h,Asw', 'int', (R, l, s, sep, out) => { const parts = s === '' ? [] : s.split(String.fromCharCode(sep)); R.ops -= parts.length; out.resize(parts.length, l); parts.forEach((p, i) => out.set(i, p, l)); return parts.length; }, { doc: 'Splits on a separator character into a string array.' });
def('StringToLower', '&s', 'bool', (R, l, r) => { r.set(r.get().toLowerCase()); return true; }, { doc: 'Lower-cases a string variable.' });
def('StringToUpper', '&s', 'bool', (R, l, r) => { r.set(r.get().toUpperCase()); return true; }, { doc: 'Upper-cases a string variable.' });
def('StringTrimLeft', '&s', 'int', (R, l, r) => { const s = r.get(), t = s.replace(/^[\s\0]+/, ''); r.set(t); return s.length - t.length; }, { doc: 'Removes leading spaces; returns how many.' });
def('StringTrimRight', '&s', 'int', (R, l, r) => { const s = r.get(), t = s.replace(/[\s\0]+$/, ''); r.set(t); return s.length - t.length; }, { doc: 'Removes trailing spaces; returns how many.' });
def('StringInit', '&s,i=0,h=0', 'bool', (R, l, r, n, c) => { if (n < 0 || n > LIMITS.maxString) return false; R.ops -= n >> 4; r.set(c ? String.fromCharCode(c).repeat(n) : ''); return true; }, { doc: 'Sets a string to n copies of a character.' });
def('StringFill', '&s,h', 'bool', (R, l, r, c) => { r.set(String.fromCharCode(c).repeat(r.get().length)); return true; }, { doc: 'Fills a string with a character.' });
def('StringSetLength', '&s,u', 'bool', (R, l, r, n) => { const s = r.get(); if (n > s.length) return false; r.set(s.slice(0, n)); return true; }, { doc: 'Cuts a string to n characters.' });
def('StringReserve', '&s,u', 'bool', () => true, { doc: 'Reserves buffer space (no effect here).' });
def('StringGetChar', 's,i', 'ushort', (R, l, s, i) => (i >= 0 && i < s.length ? s.charCodeAt(i) : 0), { pure: true, alias: 'StringGetCharacter' });
def('StringTrim', '&s', 'int', (R, l, r) => { const s = r.get(), t = s.trim(); r.set(t); return s.length - t.length; }, { doc: 'Removes spaces at both ends.' });

// ======================= Arrays =======================
cat('Arrays');
const range = (a, start, count) => { const n = a.n; start = Math.max(0, start | 0); const end = count < 0 || count === WHOLE ? n : Math.min(n, start + count); return [start, end]; };
def('ArraySize', 'A*', 'int', (R, l, a) => a.d.length, { doc: 'Number of elements (all dimensions).' });
def('ArrayRange', 'A*,i', 'int', (R, l, a, d) => (d === 0 ? a.n : a.inner[d - 1] || 0), { doc: 'Size of one dimension.' });
def('ArrayResize', 'A*w,i,i=0', 'int', (R, l, a, n) => { if (!a.dyn || a.buf) return a.buf ? a.n : -1; return a.resize(n, l); }, { doc: 'Sets the size of a dynamic array (first dimension). Returns the new size or -1.' });
def('ArrayFree', 'A*w', 'void', (R, l, a) => { if (a.dyn && !a.buf) a.resize(0, l); }, { doc: 'Empties a dynamic array.' });
def('ArrayInitialize', 'A*w,a', 'int', (R, l, a, v) => { R.ops -= a.d.length >> 3; for (let i = 0; i < a.d.length; i++) a.d[i] = v; return a.d.length; }, { doc: 'Sets every element to a value.' });
def('ArrayFill', 'A*w,i,i,a', 'void', (R, l, a, s, c, v) => { const [b, e] = range(a, s, c); R.ops -= (e - b) >> 3; for (let i = b; i < e; i++) a.set(i, v, l); }, { doc: 'Sets count elements from start to a value.' });
def('ArraySetAsSeries', 'A*,b', 'bool', (R, l, a, f) => { if (a.inner.length) return false; a.ser = !!f; return true; }, { doc: 'true: index 0 is the newest element (timeseries order).' });
def('ArrayGetAsSeries', 'A*', 'bool', (R, l, a) => a.ser, { doc: 'Is the array in timeseries order?' });
def('ArrayIsSeries', 'A*', 'bool', (R, l, a) => !!a.series, { doc: 'Is it one of the OnCalculate price arrays?' });
def('ArrayIsDynamic', 'A*', 'bool', (R, l, a) => a.dyn && !a.buf, { doc: 'Can ArrayResize change it?' });
def('ArrayCopy', 'A*w,A*,i=0,i=0,i=-1', 'int', (R, l, d, s, ds, ss, c) => {
  if (d.ro) throw rtErr('This array is read-only.', l);
  const st = s.stride, [b, e] = range(s, ss, c), k = e - b;
  if (k <= 0) return 0;
  if (d.dyn && !d.buf && d.n < ds + k) d.resize(ds + k, l);
  const kk = Math.min(k, d.n - ds); R.ops -= (kk * st) >> 3;
  if (st === 1) { const tmp = []; for (let i = 0; i < kk; i++) tmp.push(s.get(b + i, l)); for (let i = 0; i < kk; i++) d.set(ds + i, tmp[i], l); }
  else for (let i = 0; i < kk * st; i++) d.d[ds * st + i] = s.d[b * st + i];
  return kk;
}, { doc: 'Copies count elements from src[src_start] to dst[dst_start]. Returns how many.' });
def('ArrayCompare', 'A*,A*,i=0,i=0,i=-1', 'int', (R, l, a, b, as, bs, c) => { const [x0, x1] = range(a, as, c), [y0, y1] = range(b, bs, c); const n = Math.min(x1 - x0, y1 - y0); for (let i = 0; i < n; i++) { const p = a.get(x0 + i, l), q = b.get(y0 + i, l); if (p < q) return -1; if (p > q) return 1; } return x1 - x0 < y1 - y0 ? -1 : x1 - x0 > y1 - y0 ? 1 : 0; }, { doc: '-1, 0 or 1 comparing two arrays.' });
def('ArraySort', 'A*w', 'bool', (R, l, a) => {
  if (a.buf) return false;
  R.ops -= a.d.length;
  if (a.stride === 1) { const v = a.logical().sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)); for (let i = 0; i < v.length; i++) a.set(i, v[i], l); return true; }
  const rows = []; for (let r = 0; r < a.n; r++) rows.push(a.d.slice(r * a.stride, (r + 1) * a.stride));
  rows.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)); a.d = rows.flat(); return true;
}, { doc: 'Sorts ascending (by the first column for 2-D arrays).' });
def('ArrayBsearch', 'An,a', 'int', (R, l, a, v) => { let lo = 0, hi = a.n - 1; if (hi < 0) return -1; while (lo < hi) { const m = (lo + hi) >> 1; if (a.get(m, l) < v) lo = m + 1; else hi = m; } if (lo > 0 && Math.abs(a.get(lo - 1, l) - v) < Math.abs(a.get(lo, l) - v)) return lo - 1; return lo; }, { doc: 'Index of the value (or the nearest) in a sorted array.' });
const extreme = (sign) => (R, l, a, s, c) => { const [b, e] = range(a, s, c); let best = -1, bv = 0; R.ops -= (e - b) >> 3; for (let i = b; i < e; i++) { const v = a.get(i, l); if (best < 0 || (sign > 0 ? v > bv : v < bv)) { best = i; bv = v; } } return best; };
def('ArrayMaximum', 'An,i=0,i=-1', 'int', extreme(1), { doc: 'Index of the largest element.' });
def('ArrayMinimum', 'An,i=0,i=-1', 'int', extreme(-1), { doc: 'Index of the smallest element.' });
def('ArrayInsert', 'A*w,A*,i,i=0,i=-1', 'bool', (R, l, d, s, ds, ss, c) => { if (!d.dyn || d.buf || d.stride !== 1) return false; const [b, e] = range(s, ss, c); const ins = []; for (let i = b; i < e; i++) ins.push(s.get(i, l)); const v = d.logical(); v.splice(Math.min(ds, v.length), 0, ...ins); d.resize(v.length, l); v.forEach((x, i) => d.set(i, x, l)); return true; }, { doc: 'Inserts elements of src into a dynamic array.' });
def('ArrayRemove', 'A*w,i,i=-1', 'bool', (R, l, a, s, c) => { if (!a.dyn || a.buf || a.stride !== 1) return false; const [b, e] = range(a, s, c); const v = a.logical(); v.splice(b, e - b); a.resize(v.length, l); v.forEach((x, i) => a.set(i, x, l)); return true; }, { doc: 'Removes count elements from start.' });
def('ArrayReverse', 'A*w,i=0,i=-1', 'bool', (R, l, a, s, c) => { const [b, e] = range(a, s, c); for (let i = b, j = e - 1; i < j; i++, j--) { const t = a.get(i, l); a.set(i, a.get(j, l), l); a.set(j, t, l); } return true; }, { doc: 'Reverses part of an array.' });
def('ArraySwap', 'A*w,A*w', 'bool', (R, l, a, b) => { if (a.buf || b.buf || a.stride !== b.stride) return false; [a.d, b.d] = [b.d, a.d]; return true; }, { doc: 'Swaps the contents of two dynamic arrays.' });
def('ArrayPrint', 'A*,u=0,s= ,i=0,i=-1', 'void', (R, l, a, dg, sep, s, c) => { const [b, e] = range(a, s, c); const out = []; for (let i = b; i < e && out.length < 1000; i++) { const v = a.get(i, l); out.push(typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(dg || R.digits) : Array.isArray(v) ? '{' + v.join(sep) + '}' : String(v)); } R.print(out.join(sep)); }, { doc: 'Prints an array to the log.' });
def('ZeroMemory', 'X', 'void', (R, l, x) => { if (x instanceof MArr) { for (let i = 0; i < x.d.length; i++) x.d[i] = typeof x.d[i] === 'string' ? '' : typeof x.d[i] === 'boolean' ? false : 0; } else if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) if (typeof x[i] === 'number') x[i] = 0; else if (typeof x[i] === 'string') x[i] = ''; else if (typeof x[i] === 'boolean') x[i] = false; } else if (x && x.set) { const v = x.get(); x.set(typeof v === 'string' ? '' : typeof v === 'boolean' ? false : 0); } }, { doc: 'Resets a variable, struct or array to zero.' });

// ======================= Date and time =======================
cat('Date and time');
const nowS = (R) => Math.floor(R.now() / 1000);
const lastBarT = (R) => { const t = R.bars.time; return t.length ? t[t.length - 1] : 0; };
const fillTs = (s, t) => { const v = timeStruct(t); for (let i = 0; i < 8; i++) s[i] = v[i]; };
const tz = () => -new Date().getTimezoneOffset() * 60;
// Server time on TradeZoro is UTC (documented on the help page). TimeCurrent never runs behind the newest bar.
def('TimeCurrent', '', 'datetime', (R) => Math.max(lastBarT(R), nowS(R)), { doc: 'Server time (UTC on TradeZoro).' });
def('TimeCurrent', 'S:MqlDateTime', 'datetime', (R, l, s) => { const t = Math.max(lastBarT(R), nowS(R)); fillTs(s, t); return t; });
def('TimeTradeServer', '', 'datetime', (R) => nowS(R), { doc: 'Server time, counted by the clock (UTC).' });
def('TimeTradeServer', 'S:MqlDateTime', 'datetime', (R, l, s) => { const t = nowS(R); fillTs(s, t); return t; });
def('TimeLocal', '', 'datetime', (R) => nowS(R) + tz(), { doc: 'Your computer\'s local time.' });
def('TimeLocal', 'S:MqlDateTime', 'datetime', (R, l, s) => { const t = nowS(R) + tz(); fillTs(s, t); return t; });
def('TimeGMT', '', 'datetime', (R) => nowS(R), { doc: 'Time in GMT (UTC).' });
def('TimeGMT', 'S:MqlDateTime', 'datetime', (R, l, s) => { const t = nowS(R); fillTs(s, t); return t; });
def('TimeGMTOffset', '', 'int', () => -tz(), { doc: 'GMT minus local time, in seconds.' });
def('TimeDaylightSavings', '', 'int', () => { const y = new Date().getFullYear(); const j = new Date(y, 0, 1).getTimezoneOffset(), u = new Date(y, 6, 1).getTimezoneOffset(), n = new Date().getTimezoneOffset(); return n < Math.max(j, u) ? (Math.max(j, u) - n) * 60 : 0; }, { doc: 'Daylight saving shift now, in seconds.' });
def('TimeToStruct', 't,S:MqlDateTime', 'bool', (R, l, t, s) => { fillTs(s, t); return true; }, { doc: 'Splits a time into an MqlDateTime struct.' });
def('StructToTime', 'S:MqlDateTime', 'datetime', (R, l, s) => structTime(s), { doc: 'An MqlDateTime struct back to a time.' });
def('GetTickCount', '', 'uint', (R) => Math.floor(R.now()) >>> 0, { doc: 'Milliseconds counter.' });
def('GetTickCount64', '', 'ulong', (R) => Math.floor(R.now()), { doc: 'Milliseconds counter (64-bit).' });
def('GetMicrosecondCount', '', 'ulong', (R) => Math.floor(R.perf() * 1000), { doc: 'Microseconds since the indicator started.' });
def('Sleep', 'i', 'void', () => {}, { doc: 'Ignored in indicators (as on the desktop terminal).' });
const tsPart = (k) => (R, l, t) => timeStruct(t)[k];
const PARTS = [['Year', 0], ['Month', 1], ['Day', 2], ['Hour', 3], ['Minute', 4], ['Seconds', 5], ['DayOfWeek', 6], ['DayOfYear', 7]];
for (const [n, k] of PARTS) {
  def('Time' + n, 't', 'int', tsPart(k), { pure: true, alias: 'TimeToStruct', doc: 'MQL4 style: the ' + n.toLowerCase() + ' of a time.' });
  def(n, '', 'int', (R) => timeStruct(Math.max(lastBarT(R), nowS(R)))[k], { alias: 'TimeCurrent', doc: 'MQL4 style: the ' + n.toLowerCase() + ' of the server time.' });
}

// ======================= Timeframes, symbol and series =======================
cat('Series and symbol');
const TF = new Map(ENUMS.ENUM_TIMEFRAMES.map(([, v]) => [v, v === 0 ? 0 : v < 16384 ? v * 60 : v < 32768 ? (v - 16384) * 3600 : v === 32769 ? 604800 : 2592000]));
export const tfSecOf = (v) => TF.get(v);
export function tfEnumOf(sec) { for (const [v, s] of TF) if (s === sec && v) return v; return 0; }
const tfSec = (R, tf) => (tf === 0 || tf === undefined ? R.tfSec : TF.has(tf) ? TF.get(tf) : -1);
// bars of another timeframe, built from the chart's bars (bigger timeframes only)
function bucketOf(t, sec) {
  if (sec === 2592000) { const d = new Date(t * 1000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000; }
  if (sec === 604800) return Math.floor((t - 259200) / 604800) * 604800 + 259200;   // weeks start on Sunday 00:00
  return Math.floor(t / sec) * sec;
}
function aggregate(b, sec) {
  const o = { time: [], open: [], high: [], low: [], close: [], tick_volume: [], volume: [], spread: [] };
  let k = -1;
  for (let i = 0; i < b.time.length; i++) {
    const key = bucketOf(b.time[i], sec);
    if (k < 0 || o.time[k] !== key) { k++; o.time.push(key); o.open.push(b.open[i]); o.high.push(b.high[i]); o.low.push(b.low[i]); o.close.push(b.close[i]); o.tick_volume.push(b.tick_volume[i]); o.volume.push(b.volume[i]); o.spread.push(b.spread[i]); continue; }
    if (b.high[i] > o.high[k]) o.high[k] = b.high[i]; if (b.low[i] < o.low[k]) o.low[k] = b.low[i];
    o.close[k] = b.close[i]; o.tick_volume[k] += b.tick_volume[i]; o.volume[k] += b.volume[i];
  }
  return o;
}
const isCur = (R, s) => s === '' || s === '0' || s === R.symbol || s === R.ticker || s === 'NULL';
export function seriesOf(R, sym, tf) {
  if (!isCur(R, sym)) { R.lastError = 4801; return null; }
  const sec = tfSec(R, tf);
  if (sec === R.tfSec) return R.bars;
  if (!(sec > R.tfSec) || sec % R.tfSec) { R.lastError = 4401; if (!R.warned.has('tf' + sec)) { R.warned.add('tf' + sec); R.notice('Data for a smaller or uneven timeframe is not available on this chart; switch the chart to a smaller timeframe.'); } return null; }
  let c = R.aggs.get(sec);
  if (!c || c.ver !== R.barsVer) { R.ops -= R.bars.time.length >> 2; c = { ver: R.barsVer, b: aggregate(R.bars, sec) }; R.aggs.set(sec, c); }
  return c.b;
}
const FIELD = { 0: 'open', 1: 'low', 2: 'high', 3: 'close', 4: 'tick_volume', 5: 'volume', 6: 'spread' };
const at = (R, sym, tf, shift, field) => { const b = seriesOf(R, sym, tf); if (!b) return 0; const n = b.time.length, i = n - 1 - shift; if (shift < 0 || i < 0) { R.lastError = 4401; return 0; } return b[field][i]; };
def('Symbol', '', 'string', (R) => R.symbol, { doc: 'The chart symbol.' });
def('Period', '', 'ENUM_TIMEFRAMES', (R) => R.period, { doc: 'The chart timeframe.' });
def('Point', '', 'double', (R) => R.point, { doc: 'Price step of the symbol (_Point).' });
def('Digits', '', 'int', (R) => R.digits, { doc: 'Decimals of the symbol price (_Digits).' });
def('PeriodSeconds', 'i=0', 'int', (R, l, tf) => Math.max(0, tfSec(R, tf)), { doc: 'Seconds in a timeframe.' });
for (const [n, f, t] of [['iOpen', 'open', 'double'], ['iHigh', 'high', 'double'], ['iLow', 'low', 'double'], ['iClose', 'close', 'double'], ['iTime', 'time', 'datetime'], ['iVolume', 'tick_volume', 'long'], ['iTickVolume', 'tick_volume', 'long'], ['iRealVolume', 'volume', 'long'], ['iSpread', 'spread', 'long']])
  def(n, 's,i,i', t, (R, l, s, tf, sh) => at(R, s, tf, sh, f), { doc: 'The bar\'s ' + f.replace('_', ' ') + ', shift counted from the newest bar (0).' });
def('iBars', 's,i', 'int', (R, l, s, tf) => { const b = seriesOf(R, s, tf); return b ? b.time.length : 0; }, { doc: 'Number of bars of a symbol and timeframe.' });
def('Bars', 's,i', 'int', (R, l, s, tf) => { const b = seriesOf(R, s, tf); return b ? b.time.length : 0; }, { doc: 'Number of bars.' });
def('Bars', 's,i,t,t', 'int', (R, l, s, tf, a, z) => { const b = seriesOf(R, s, tf); if (!b) return 0; const lo = Math.min(a, z), hi = Math.max(a, z); return b.time.filter((t) => t >= lo && t <= hi).length; });
def('iBarShift', 's,i,t,b=false', 'int', (R, l, s, tf, t, exact) => { const b = seriesOf(R, s, tf); if (!b) return -1; const T = b.time, n = T.length; if (!n) return -1; let lo = 0, hi = n - 1; if (t < T[0]) return exact ? -1 : n - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (T[m] <= t) lo = m; else hi = m - 1; } if (exact && T[lo] !== t) return -1; return n - 1 - lo; }, { doc: 'Shift of the bar that holds a time (-1 with exact=true when no bar starts there).' });
const hiLo = (sign) => (R, l, s, tf, type, count, start) => { const b = seriesOf(R, s, tf); if (!b) return -1; const f = b[FIELD[type] || 'close'], n = f.length; const c = count < 0 || count === WHOLE ? n - start : count; let best = -1, bv = 0; for (let sh = start; sh < start + c && sh < n; sh++) { const v = f[n - 1 - sh]; if (best < 0 || (sign > 0 ? v > bv : v < bv)) { best = sh; bv = v; } } R.ops -= c >> 3; return best; };
def('iHighest', 's,i,i=2,i=-1,i=0', 'int', hiLo(1), { doc: 'Shift of the highest value over count bars from start.' });
def('iLowest', 's,i,i=1,i=-1,i=0', 'int', hiLo(-1), { doc: 'Shift of the lowest value over count bars from start.' });
// Copy* range: (start_pos, count) counted from the newest bar, or (start_time, count) or (start_time, stop_time). Written oldest first.
function span(R, T, times, a, b) {
  const n = times.length;
  const tA = T[2] && T[2].n === 'datetime', tB = T[3] && T[3].n === 'datetime';
  let lo, hi;
  if (!tA) { const s = Math.max(0, a | 0), c = b | 0; hi = n - 1 - s; lo = hi - c + 1; }
  else if (!tB) { const c = b | 0; let i = n - 1; while (i >= 0 && times[i] > a) i--; hi = i; lo = hi - c + 1; }
  else { const t0 = Math.min(a, b), t1 = Math.max(a, b); lo = 0; while (lo < n && times[lo] < t0) lo++; hi = n - 1; while (hi >= 0 && times[hi] > t1) hi--; }
  lo = Math.max(0, lo);
  if (hi < lo || hi < 0) return null;
  return [lo, hi];
}
// write values (oldest first) into a target array; an indicator buffer keeps its size and is filled from its end
function writeOut(R, arr, k, get, endShift, line) {
  if (arr.ro) throw rtErr('This array is read-only.', line);
  R.ops -= k >> 3;
  if (arr.buf) { const N = arr.d.length, e = N - 1 - endShift; for (let i = 0; i < k; i++) { const p = e - (k - 1 - i); if (p >= 0 && p < N) arr.d[p] = get(i); } return k; }
  if (arr.dyn) arr.resize(k, line);
  const m = Math.min(k, arr.n);
  if (arr.ser) for (let i = 0; i < m; i++) arr.d[arr.d.length - m + i] = get(k - m + i);
  else for (let i = 0; i < m; i++) arr.d[i] = get(i);
  return m;
}
const copyField = (field) => (R, l, T, s, tf, a, b, arr) => { const B = seriesOf(R, s, tf); if (!B) return -1; const sp = span(R, T, B.time, a, b); if (!sp) { R.lastError = 4401; return -1; } const [lo, hi] = sp, src = B[field]; return writeOut(R, arr, hi - lo + 1, (i) => src[lo + i], B.time.length - 1 - hi, l); };
for (const [n, f, t] of [['CopyOpen', 'open', 'd'], ['CopyHigh', 'high', 'd'], ['CopyLow', 'low', 'd'], ['CopyClose', 'close', 'd'], ['CopyTime', 'time', 't'], ['CopyTickVolume', 'tick_volume', 'l'], ['CopyRealVolume', 'volume', 'l'], ['CopySpread', 'spread', 'i']])
  def(n, 's,i,a,a,A' + t + 'w', 'int', copyField(f), { types: true, doc: 'Copies bar ' + f.replace('_', ' ') + ' values into an array (oldest first). Returns the count or -1.' });
def('CopyRates', 's,i,a,a,Arw', 'int', (R, l, T, s, tf, a, b, arr) => { const B = seriesOf(R, s, tf); if (!B) return -1; const sp = span(R, T, B.time, a, b); if (!sp) { R.lastError = 4401; return -1; } const [lo, hi] = sp; return writeOut(R, arr, hi - lo + 1, (i) => { const j = lo + i; return [B.time[j], B.open[j], B.high[j], B.low[j], B.close[j], B.tick_volume[j], B.spread[j], B.volume[j]]; }, 0, l); }, { types: true, doc: 'Copies whole bars into an MqlRates array.' });
def('SeriesInfoInteger', 's,i,i', 'long', (R, l, s, tf, p) => { const b = seriesOf(R, s, tf); if (!b) return 0; const n = b.time.length; return p === 0 ? n : p === 1 || p === 2 || p === 3 ? (n ? b.time[0] : 0) : p === 4 ? 1 : p === 5 ? (n ? b.time[n - 1] : 0) : 0; }, { doc: 'Bar count, first date, last bar date of a series.' });
def('SymbolInfoDouble', 's,i', 'double', (R, l, s, p) => symD(R, p), { doc: 'SYMBOL_BID / ASK / LAST (the last close), SYMBOL_POINT, tick size ...' });
def('SymbolInfoDouble', 's,i,&d', 'bool', (R, l, s, p, out) => { out.set(symD(R, p)); return true; });
def('SymbolInfoInteger', 's,i', 'long', (R, l, s, p) => symI(R, p), { doc: 'SYMBOL_DIGITS, SYMBOL_SPREAD, SYMBOL_TIME ...' });
def('SymbolInfoInteger', 's,i,&l', 'bool', (R, l, s, p, out) => { out.set(symI(R, p)); return true; });
def('SymbolInfoString', 's,i', 'string', (R, l, s, p) => symS(R, p), { doc: 'SYMBOL_DESCRIPTION, SYMBOL_CURRENCY_BASE ...' });
def('SymbolInfoString', 's,i,&s', 'bool', (R, l, s, p, out) => { out.set(symS(R, p)); return true; });
def('SymbolInfoTick', 's,S:MqlTick', 'bool', (R, l, s, t) => { const b = R.bars, n = b.time.length; if (!n) return false; const c = b.close[n - 1]; t[0] = b.time[n - 1]; t[1] = c; t[2] = c; t[3] = c; t[4] = b.tick_volume[n - 1]; t[5] = b.time[n - 1] * 1000; t[6] = 0; t[7] = b.volume[n - 1]; return true; }, { doc: 'The latest price as an MqlTick (bid = ask = last close).' });
def('SymbolName', 'i,b', 'string', (R, l, i) => (i === 0 ? R.symbol : ''), { doc: 'Only the chart symbol is available.' });
def('SymbolsTotal', 'b', 'int', () => 1, { doc: 'Always 1: the chart symbol.' });
def('SymbolSelect', 's,b', 'bool', (R, l, s) => isCur(R, s), { doc: 'true for the chart symbol.' });
def('SymbolExist', 's,&b', 'bool', (R, l, s, c) => { c.set(false); return isCur(R, s); }, { doc: 'true for the chart symbol.' });
def('SymbolIsSynchronized', 's', 'bool', (R, l, s) => isCur(R, s), { doc: 'true for the chart symbol.' });
def('RefreshRates', '', 'bool', () => true, { alias: 'SymbolInfoTick', doc: 'MQL4 style: always true.' });
function symD(R, p) {
  const b = R.bars, n = b.time.length, c = n ? b.close[n - 1] : 0;
  switch (p) { case 0: case 3: case 6: return c; case 1: case 4: case 7: return n ? b.high[n - 1] : 0; case 2: case 5: case 8: return n ? b.low[n - 1] : 0; case 9: case 11: return R.point; case 10: return R.point; case 12: return 1; case 13: case 15: return 0.01; case 14: return 100; case 18: return n ? b.volume[n - 1] : 0; default: return 0; }
}
function symI(R, p) { const b = R.bars, n = b.time.length; switch (p) { case 0: return R.digits; case 1: return 0; case 2: return 1; case 3: return n ? b.time[n - 1] : 0; case 4: return n ? b.tick_volume[n - 1] : 0; case 7: case 8: case 11: return 1; case 9: return 0; default: return 0; } }
function symS(R, p) { switch (p) { case 4: case 8: return R.symbol; case 0: return R.ticker; default: return ''; } }

// ======================= Technical indicators (handles + CopyBuffer) =======================
cat('Technical indicators');
const P0 = (R, ap) => ap;   // applied price stays an int code (PRICE_CLOSE = 1 ...)
// handle(R, name, sym, tf, nbuf, compute(b) -> [Float64Array...], key)
function handle(R, line, name, sym, tf, nbuf, compute, check) {
  if (!isCur(R, sym)) { R.lastError = 4801; return -1; }
  if (check && !check()) { R.lastError = 4003; return -1; }
  if (tfSec(R, tf) < 0) { R.lastError = 4003; return -1; }
  if (R.handles.length >= 256) throw rtErr('Too many indicator handles (limit 256). Create them once in OnInit.', line, 'E406');
  R.handles.push({ name, sym, tf, nbuf, compute, ver: -1, bufs: null });
  return R.handles.length - 1 + 10;
}
export function handleData(R, h) {
  const H = R.handles[h - 10];
  if (!H) return null;
  const b = seriesOf(R, H.sym, H.tf);
  if (!b) return null;
  if (H.ver !== R.barsVer) { R.ops -= b.time.length * H.nbuf >> 2; H.bufs = H.compute(b); H.ver = R.barsVer; H.b = b; }
  return H;
}
const src = (b, ap, R) => (typeof ap === 'number' && ap >= 10 ? (handleData(R, ap) || { bufs: [new Float64Array(b.close.length).fill(NaN)] }).bufs[0] : TA.applied(b, ap));
const vol = (b, v) => (v === 1 ? b.volume : b.tick_volume);
const pos = (...a) => () => a.every((x) => x > 0 && x < 100000);
const H = (name, specs, mk, doc) => def(name, specs, 'int', (R, l, sym, tf, ...a) => { const r = mk(R, ...a); return handle(R, l, name, sym, tf, r.n, r.f, r.ok); }, { doc });
H('iMA', 's,i,i,i,i,a', (R, p, sh, m, ap) => ({ n: 1, ok: pos(p), f: (b) => [TA.shift(TA.ma(src(b, ap, R), p, m), sh)] }), 'Moving average: period, shift, MODE_SMA/EMA/SMMA/LWMA, applied price (or another handle).');
H('iRSI', 's,i,i,a', (R, p, ap) => ({ n: 1, ok: pos(p), f: (b) => [TA.rsi(src(b, ap, R), p)] }), 'Relative Strength Index.');
H('iMACD', 's,i,i,i,i,a', (R, f, s, sig, ap) => ({ n: 2, ok: pos(f, s, sig), f: (b) => TA.macd(src(b, ap, R), f, s, sig) }), 'MACD: buffer 0 main, 1 signal (simple average of main).');
H('iBands', 's,i,i,i,d,a', (R, p, sh, dev, ap) => ({ n: 3, ok: pos(p), f: (b) => TA.bands(src(b, ap, R), p, dev).map((x) => TA.shift(x, sh)) }), 'Bollinger Bands: buffer 0 middle, 1 upper, 2 lower.');
H('iATR', 's,i,i', (R, p) => ({ n: 1, ok: pos(p), f: (b) => [TA.atr(b, p)] }), 'Average True Range (simple average).');
H('iStochastic', 's,i,i,i,i,i,i', (R, k, d, sl, m, f) => ({ n: 2, ok: pos(k, d, sl), f: (b) => TA.stoch(b, k, d, sl, m, f) }), 'Stochastic: buffer 0 main, 1 signal.');
H('iCCI', 's,i,i,a', (R, p, ap) => ({ n: 1, ok: pos(p), f: (b) => [TA.cci(src(b, ap, R), p)] }), 'Commodity Channel Index.');
H('iADX', 's,i,i', (R, p) => ({ n: 3, ok: pos(p), f: (b) => TA.adx(b, p) }), 'ADX: buffer 0 ADX, 1 +DI, 2 -DI.');
H('iADXWilder', 's,i,i', (R, p) => ({ n: 3, ok: pos(p), f: (b) => TA.adxWilder(b, p) }), 'ADX by Welles Wilder: buffer 0 ADX, 1 +DI, 2 -DI.');
H('iMomentum', 's,i,i,a', (R, p, ap) => ({ n: 1, ok: pos(p), f: (b) => [TA.momentum(src(b, ap, R), p)] }), 'Momentum (price / price n bars ago x 100).');
H('iSAR', 's,i,d,d', (R, st, mx) => ({ n: 1, ok: () => st > 0 && mx > 0, f: (b) => [TA.sar(b, st, mx)] }), 'Parabolic SAR: step, maximum.');
H('iEnvelopes', 's,i,i,i,i,a,d', (R, p, sh, m, ap, dev) => ({ n: 2, ok: pos(p), f: (b) => TA.envelopes(src(b, ap, R), p, m, dev).map((x) => TA.shift(x, sh)) }), 'Envelopes: buffer 0 upper, 1 lower.');
H('iStdDev', 's,i,i,i,i,a', (R, p, sh, m, ap) => ({ n: 1, ok: pos(p), f: (b) => [TA.shift(TA.stddev(src(b, ap, R), p, m), sh)] }), 'Standard deviation around a moving average.');
H('iDEMA', 's,i,i,i,a', (R, p, sh, ap) => ({ n: 1, ok: pos(p), f: (b) => [TA.shift(TA.dema(src(b, ap, R), p), sh)] }), 'Double exponential moving average.');
H('iTEMA', 's,i,i,i,a', (R, p, sh, ap) => ({ n: 1, ok: pos(p), f: (b) => [TA.shift(TA.tema(src(b, ap, R), p), sh)] }), 'Triple exponential moving average.');
H('iTriX', 's,i,i,a', (R, p, ap) => ({ n: 1, ok: pos(p), f: (b) => [TA.trix(src(b, ap, R), p)] }), 'TRIX (rate of change of a triple EMA).');
H('iWPR', 's,i,i', (R, p) => ({ n: 1, ok: pos(p), f: (b) => [TA.wpr(b, p)] }), 'Williams\' Percent Range.');
H('iOBV', 's,i,i', (R, v) => ({ n: 1, f: (b) => [TA.obv(b, vol(b, v))] }), 'On Balance Volume.');
H('iMFI', 's,i,i,i', (R, p, v) => ({ n: 1, ok: pos(p), f: (b) => [TA.mfi(b, p, vol(b, v))] }), 'Money Flow Index.');
H('iAO', 's,i', () => ({ n: 1, f: (b) => [TA.ao(b)] }), 'Awesome Oscillator.');
H('iAC', 's,i', () => ({ n: 1, f: (b) => [TA.ac(b)] }), 'Accelerator Oscillator.');
H('iOsMA', 's,i,i,i,i,a', (R, f, s, sig, ap) => ({ n: 1, ok: pos(f, s, sig), f: (b) => [TA.osma(src(b, ap, R), f, s, sig)] }), 'MACD minus its signal.');
H('iBearsPower', 's,i,i', (R, p) => ({ n: 1, ok: pos(p), f: (b) => [TA.bears(b, p)] }), 'Bears Power.');
H('iBullsPower', 's,i,i', (R, p) => ({ n: 1, ok: pos(p), f: (b) => [TA.bulls(b, p)] }), 'Bulls Power.');
H('iForce', 's,i,i,i,i', (R, p, m, v) => ({ n: 1, ok: pos(p), f: (b) => [TA.force(b, p, m, vol(b, v))] }), 'Force Index.');
H('iDeMarker', 's,i,i', (R, p) => ({ n: 1, ok: pos(p), f: (b) => [TA.demarker(b, p)] }), 'DeMarker.');
H('iFractals', 's,i', () => ({ n: 2, f: (b) => TA.fractals(b) }), 'Fractals: buffer 0 up, 1 down.');
H('iAD', 's,i,i', (R, v) => ({ n: 1, f: (b) => [TA.ad(b, vol(b, v))] }), 'Accumulation/Distribution.');
H('iChaikin', 's,i,i,i,i,i', (R, f, s, m, v) => ({ n: 1, ok: pos(f, s), f: (b) => [TA.chaikin(b, f, s, m, vol(b, v))] }), 'Chaikin Oscillator.');
H('iVolumes', 's,i,i', (R, v) => ({ n: 1, f: (b) => [Float64Array.from(vol(b, v))] }), 'Volumes.');
H('iBWMFI', 's,i,i', (R, v) => ({ n: 1, f: (b) => [Float64Array.from(b.close, (x, i) => { const w = vol(b, v)[i]; return w ? (b.high[i] - b.low[i]) / w : NaN; })] }), 'Market Facilitation Index (range / volume).');
H('iAlligator', 's,i,i,i,i,i,i,i,i,a', (R, jp, js, tp, ts, lp, ls, m, ap) => ({ n: 3, ok: pos(jp, tp, lp), f: (b) => { const s = src(b, ap, R); return [TA.shift(TA.ma(s, jp, m), js), TA.shift(TA.ma(s, tp, m), ts), TA.shift(TA.ma(s, lp, m), ls)]; } }), 'Alligator: buffer 0 jaw, 1 teeth, 2 lips.');
H('iIchimoku', 's,i,i,i,i', (R, t, k, sb) => ({ n: 5, ok: pos(t, k, sb), f: (b) => {
  const n = b.close.length, mid = (p, i) => { if (i - p + 1 < 0) return NaN; let h = -Infinity, lo = Infinity; for (let j = i - p + 1; j <= i; j++) { h = Math.max(h, b.high[j]); lo = Math.min(lo, b.low[j]); } return (h + lo) / 2; };
  const T = new Float64Array(n), K = new Float64Array(n), A = new Float64Array(n), B = new Float64Array(n);
  for (let i = 0; i < n; i++) { T[i] = mid(t, i); K[i] = mid(k, i); A[i] = (T[i] + K[i]) / 2; B[i] = mid(sb, i); }
  return [T, K, TA.shift(A, k), TA.shift(B, k), TA.shift(Float64Array.from(b.close), -k)];
} }), 'Ichimoku: 0 Tenkan, 1 Kijun, 2 Span A, 3 Span B, 4 Chikou.');
H('iRVI', 's,i,i', (R, p) => ({ n: 2, ok: pos(p), f: (b) => {
  const n = b.close.length, num = new Float64Array(n).fill(NaN), den = new Float64Array(n).fill(NaN), main = new Float64Array(n).fill(NaN), sig = new Float64Array(n).fill(NaN);
  const co = (i) => b.close[i] - b.open[i], hl = (i) => b.high[i] - b.low[i];
  for (let i = 3; i < n; i++) { num[i] = (co(i) + 2 * co(i - 1) + 2 * co(i - 2) + co(i - 3)) / 6; den[i] = (hl(i) + 2 * hl(i - 1) + 2 * hl(i - 2) + hl(i - 3)) / 6; }
  for (let i = p + 2; i < n; i++) { let a = 0, d = 0; for (let j = 0; j < p; j++) { a += num[i - j]; d += den[i - j]; } main[i] = d ? a / d : 0; }
  for (let i = p + 5; i < n; i++) sig[i] = (main[i] + 2 * main[i - 1] + 2 * main[i - 2] + main[i - 3]) / 6;
  return [main, sig];
} }), 'Relative Vigor Index: buffer 0 main, 1 signal.');
H('iGator', 's,i,i,i,i,i,i,i,i,a', (R, jp, js, tp, ts, lp, ls, m, ap) => ({ n: 4, ok: pos(jp, tp, lp), f: (b) => { const s = src(b, ap, R), J = TA.shift(TA.ma(s, jp, m), js), T = TA.shift(TA.ma(s, tp, m), ts), L = TA.shift(TA.ma(s, lp, m), ls), n = s.length; const up = new Float64Array(n), dn = new Float64Array(n); for (let i = 0; i < n; i++) { up[i] = Math.abs(J[i] - T[i]); dn[i] = -Math.abs(T[i] - L[i]); } return [up, new Float64Array(n), dn, new Float64Array(n)]; } }), 'Gator Oscillator: buffer 0 upper, 2 lower.');
def('iCustom', 's,i,s', 'int', (R, l, T, sym, tf, name, ...params) => R.custom(l, sym, tf, name, params, T.slice(3)), { va: true, types: true, doc: 'Another of your saved MQL5 indicators, by its name in My scripts. Its inputs follow in order.' });
def('IndicatorRelease', 'i', 'bool', (R, l, h) => { const x = R.handles[h - 10]; if (!x) return false; x.bufs = null; x.ver = -1; return true; }, { doc: 'Frees an indicator handle.' });
def('BarsCalculated', 'i', 'int', (R, l, h) => { const x = handleData(R, h); return x ? x.H_n || (x.bufs && x.bufs[0] ? x.bufs[0].length : 0) : -1; }, { doc: 'How many bars a handle has calculated (-1 for a bad handle).' });
def('CopyBuffer', 'i,i,a,a,Adw', 'int', (R, l, T, h, bi, a, b, arr) => {
  const x = handleData(R, h); if (!x) { R.lastError = 4807; return -1; }
  const buf = x.bufs[bi]; if (!buf) { R.lastError = 4806; return -1; }
  const TT = [null, null, T[2], T[3]];
  const sp = span(R, TT, x.b.time, a, b); if (!sp) { R.lastError = 4806; return -1; }
  const [lo, hi] = sp;
  return writeOut(R, arr, hi - lo + 1, (i) => { const v = buf[lo + i]; return Number.isFinite(v) ? v : EMPTY_VALUE; }, x.b.time.length - 1 - hi, l);
}, { types: true, doc: 'Copies a handle\'s buffer into an array (start counted from the newest bar). Not yet calculated values are EMPTY_VALUE.' });

// MQL4-style "on array" helpers: array read as a timeseries (index 0 = newest), shift counts back from the newest
const oldest = (a, total) => { const v = a.logical(); const s = a.ser ? v.slice().reverse() : v; return total > 0 && total < s.length ? s.slice(s.length - total) : s; };
const atS = (series, shift) => { const i = series.length - 1 - (shift | 0); const v = i >= 0 && i < series.length ? series[i] : NaN; return Number.isFinite(v) ? v : 0; };
const ON = (name, specs, fn, doc) => def(name, specs, 'double', (R, l, a, total, ...rest) => { chargeArr(R, a); return fn(oldest(a, total), ...rest); }, { cat: 'Technical indicators', doc: doc + ' (MQL4 style; the array is read newest first).' });
ON('iMAOnArray', 'An,i,i,i,i,i', (s, p, sh, m, shift) => atS(TA.shift(TA.ma(s, p, m), sh), shift), 'Moving average of an array');
ON('iRSIOnArray', 'An,i,i,i', (s, p, shift) => atS(TA.rsi(s, p), shift), 'RSI of an array');
ON('iCCIOnArray', 'An,i,i,i', (s, p, shift) => atS(TA.cci(s, p), shift), 'CCI of an array');
ON('iMomentumOnArray', 'An,i,i,i', (s, p, shift) => atS(TA.momentum(s, p), shift), 'Momentum of an array');
ON('iStdDevOnArray', 'An,i,i,i,i,i', (s, p, sh, m, shift) => atS(TA.shift(TA.stddev(s, p, m), sh), shift), 'Standard deviation of an array');
ON('iBandsOnArray', 'An,i,i,d,i,i,i', (s, p, dev, sh, mode, shift) => atS(TA.shift(TA.bands(s, p, dev)[mode === 1 ? 1 : mode === 2 ? 2 : 0], sh), shift), 'Bollinger band of an array (mode 0 middle, 1 upper, 2 lower)');
ON('iEnvelopesOnArray', 'An,i,i,i,i,d,i,i', (s, p, m, sh, dev, mode, shift) => atS(TA.shift(TA.envelopes(s, p, m, dev)[mode === 2 ? 1 : 0], sh), shift), 'Envelope of an array (mode 1 upper, 2 lower)');
def('IndicatorCreate', 's,i,i,i=0,A*=0', 'int', (R, l, sym, tf, type, n, ps) => {
  // MqlParam[] -> the matching i* call; only the common types are mapped
  const v = (k) => { const p = ps && ps.d && ps.d[k]; return p ? (p[0] === 13 ? p[2] : p[0] === 14 ? p[3] : p[1]) : 0; };
  const call = (nm, ...a) => toArr(BUILTINS.get(nm))[0].f(R, l, sym, tf, ...a);
  switch (type) {
    case 22: return call('iMA', v(0) || 14, v(1), v(2), v(3) || 1);
    case 27: return call('iRSI', v(0) || 14, v(1) || 1);
    case 3: return call('iATR', v(0) || 14);
    case 4: return call('iBands', v(0) || 20, v(1), v(2) || 2, v(3) || 1);
    case 8: return call('iCCI', v(0) || 14, v(1) || 5);
    case 23: return call('iMACD', v(0) || 12, v(1) || 26, v(2) || 9, v(3) || 1);
    case 24: return call('iMomentum', v(0) || 14, v(1) || 1);
    case 1: return call('iADX', v(0) || 14);
    case 33: return call('iStochastic', v(0) || 5, v(1) || 3, v(2) || 3, v(3), v(4));
    default: R.lastError = 4003; return -1;
  }
}, { cat: 'Technical indicators', doc: 'Creates an indicator handle from an ENUM_INDICATOR type and MqlParam[] (iMA, iRSI, iATR, iBands, iCCI, iMACD, iMomentum, iADX, iStochastic).' });
def('IndicatorParameters', 'i,&i,A*w', 'int', (R, l, h, typ) => { const x = R.handles[h - 10]; if (!x) return -1; typ.set(0); return 0; }, { cat: 'Technical indicators', doc: 'Parameter count of a handle (returns 0: parameters are not kept).' });
// MovingAverages.mqh (the standard header, written for TradeZoro from its documented behaviour)
cat('MovingAverages.mqh');
def('SimpleMA', 'i,i,Ad', 'double', (R, l, p, n, a) => { if (n <= 0 || p < n - 1) return 0; let s = 0; for (let i = 0; i < n; i++) s += a.get(p - i, l); return s / n; }, { doc: 'Simple average of price[position-period+1 .. position].' });
def('ExponentialMA', 'i,i,d,Ad', 'double', (R, l, p, n, prev, a) => { const v = a.get(p, l); if (n <= 0 || p <= 0) return v; const k = 2 / (n + 1); return v * k + prev * (1 - k); }, { doc: 'One EMA step from the previous value.' });
def('SmoothedMA', 'i,i,d,Ad', 'double', (R, l, p, n, prev, a) => { if (n <= 0) return 0; if (p === n - 1) { let s = 0; for (let i = 0; i < n; i++) s += a.get(p - i, l); return s / n; } if (p < n - 1) return 0; return (prev * (n - 1) + a.get(p, l)) / n; }, { doc: 'One smoothed-MA step.' });
def('LinearWeightedMA', 'i,i,Ad', 'double', (R, l, p, n, a) => { if (n <= 0 || p < n - 1) return 0; let s = 0, w = 0; for (let i = 0; i < n; i++) { s += a.get(p - i, l) * (n - i); w += n - i; } return s / w; }, { doc: 'Linear weighted average.' });
function onBuffer(kind) {
  return (R, l, total, prev, begin, n, price, buf) => {
    if (n <= 1 || total - begin < n) return 0;
    let start;
    R.ops -= (total - prev) >> 2;
    const P_ = (i) => price.get(i, l), S_ = (i, v) => buf.set(i, v, l), G_ = (i) => buf.get(i, l);
    if (prev === 0) {
      start = n + begin;
      for (let i = 0; i < start - 1; i++) S_(i, 0);
      if (kind === 'ema') { S_(begin, P_(begin)); for (let i = begin + 1; i < start; i++) S_(i, P_(i) * (2 / (n + 1)) + G_(i - 1) * (1 - 2 / (n + 1))); }
      else if (kind === 'lwma') { let s = 0, w = 0; for (let i = 0; i < n; i++) { s += P_(begin + i) * (i + 1); w += i + 1; } S_(start - 1, s / w); }
      else { let s = 0; for (let i = begin; i < start; i++) s += P_(i); S_(start - 1, s / n); }
    } else start = prev - 1;
    const k = 2 / (n + 1), w = (n * (n + 1)) / 2;
    for (let i = start; i < total; i++) {
      if (kind === 'sma') S_(i, G_(i - 1) + (P_(i) - P_(i - n)) / n);
      else if (kind === 'ema') S_(i, P_(i) * k + G_(i - 1) * (1 - k));
      else if (kind === 'smma') S_(i, (G_(i - 1) * (n - 1) + P_(i)) / n);
      else { let s = 0; for (let j = 0; j < n; j++) s += P_(i - j) * (n - j); S_(i, s / w); }
    }
    return total;
  };
}
def('SimpleMAOnBuffer', 'i,i,i,i,Ad,Adw', 'int', onBuffer('sma'), { doc: 'Simple MA of price[] into buffer[], incremental with prev_calculated.' });
def('ExponentialMAOnBuffer', 'i,i,i,i,Ad,Adw', 'int', onBuffer('ema'), { doc: 'Exponential MA into buffer[].' });
def('SmoothedMAOnBuffer', 'i,i,i,i,Ad,Adw', 'int', onBuffer('smma'), { doc: 'Smoothed MA into buffer[].' });
def('LinearWeightedMAOnBuffer', 'i,i,i,i,Ad,Adw', 'int', onBuffer('lwma'), { doc: 'Linear weighted MA into buffer[].' });

// ======================= Custom indicator properties =======================
cat('Custom indicators');
def('SetIndexBuffer', 'i,Adw,i=0', 'bool', (R, l, i, a, t) => R.bindBuffer(i, a, t, l), { doc: 'Makes an array the indicator buffer i (INDICATOR_DATA, INDICATOR_COLOR_INDEX, INDICATOR_CALCULATIONS).' });
def('IndicatorSetInteger', 'i,l', 'bool', (R, l, p, v) => R.indSet('i', p, 0, v), { doc: 'INDICATOR_DIGITS, INDICATOR_LEVELS, INDICATOR_LEVELCOLOR ...' });
def('IndicatorSetInteger', 'i,i,l', 'bool', (R, l, p, m, v) => R.indSet('i', p, m, v));
def('IndicatorSetDouble', 'i,d', 'bool', (R, l, p, v) => R.indSet('d', p, 0, v), { doc: 'INDICATOR_MINIMUM, INDICATOR_MAXIMUM, INDICATOR_LEVELVALUE.' });
def('IndicatorSetDouble', 'i,i,d', 'bool', (R, l, p, m, v) => R.indSet('d', p, m, v));
def('IndicatorSetString', 'i,s', 'bool', (R, l, p, v) => R.indSet('s', p, 0, v), { doc: 'INDICATOR_SHORTNAME, INDICATOR_LEVELTEXT.' });
def('IndicatorSetString', 'i,i,s', 'bool', (R, l, p, m, v) => R.indSet('s', p, m, v));
def('PlotIndexSetInteger', 'i,i,l', 'bool', (R, l, i, p, v) => R.plotSet(i, 'i', p, 0, v, l), { doc: 'PLOT_DRAW_TYPE, PLOT_LINE_COLOR, PLOT_LINE_WIDTH, PLOT_ARROW, PLOT_DRAW_BEGIN, PLOT_SHIFT ...' });
def('PlotIndexSetInteger', 'i,i,i,l', 'bool', (R, l, i, p, m, v) => R.plotSet(i, 'i', p, m, v, l));
def('PlotIndexSetDouble', 'i,i,d', 'bool', (R, l, i, p, v) => R.plotSet(i, 'd', p, 0, v, l), { doc: 'PLOT_EMPTY_VALUE.' });
def('PlotIndexSetString', 'i,i,s', 'bool', (R, l, i, p, v) => R.plotSet(i, 's', p, 0, v, l), { doc: 'PLOT_LABEL.' });
def('PlotIndexGetInteger', 'i,i', 'int', (R, l, i, p) => R.plotGet(i, p, 0), { doc: 'Reads a plot property.' });
def('PlotIndexGetInteger', 'i,i,i', 'int', (R, l, i, p, m) => R.plotGet(i, p, m));
def('IndicatorShortName', 's', 'void', (R, l, s) => { R.indSet('s', 0, 0, s); }, { alias: 'IndicatorSetString', doc: 'MQL4 style: sets the short name.' });
def('IndicatorDigits', 'i', 'void', (R, l, d) => { R.indSet('i', 0, 0, d); }, { alias: 'IndicatorSetInteger', doc: 'MQL4 style: sets the digits.' });

// ======================= Chart objects =======================
cat('Objects');
const OBJ_DEFAULTS = { color: 0x0000FF };   // clrRed
const SCREEN = new Set([102, 103, 106, 107, 110]);   // label, button, bitmap label, edit, rectangle label: placed in pixels
function newObj(R, name, type, sub) {
  const o = { name, type, sub, times: [], prices: [], i: new Map(), d: new Map(), s: new Map(), created: Math.floor(R.now() / 1000), screen: SCREEN.has(type) };
  const I = o.i, S = o.s;
  I.set(0, type === 103 || type === 107 ? 0x000000 : type === 102 ? 0xFFFFFF : type === 110 ? 0xFFFFFF : OBJ_DEFAULTS.color);
  I.set(2, 1); I.set(1, 0); I.set(18, 10); I.set(42, 0); I.set(25, type === 101 ? 0 : 0);
  if (type === 103 || type === 107) { I.set(41, 0xD8E9EC); I.set(44, 0x808080); I.set(33, 100); I.set(34, 20); }
  if (type === 110) { I.set(41, 0x202020); I.set(44, 0x808080); I.set(33, 100); I.set(34, 50); I.set(43, 0); }
  if (type === 2) { I.set(20, 0); I.set(19, 0); }
  if (type === 107) I.set(17, 1);
  S.set(204, 'Arial'); S.set(201, type === 103 ? 'Button' : type === 102 ? 'Label' : '');
  return o;
}
const objOf = (R, name) => R.objects.get(String(name));
def('ObjectCreate', 'l,s,i,i', 'bool', (R, l, cid, name, type, sub, ...pts) => {
  if (name === '') return false;
  let o = objOf(R, name);
  if (o && o.type !== type) { R.lastError = 4200; return false; }
  if (!o) {
    if (R.objects.size >= LIMITS.maxObjects) throw rtErr('Too many chart objects (limit ' + LIMITS.maxObjects + '). Delete old ones with ObjectDelete.', l, 'E406');
    o = newObj(R, name, type, sub); R.objects.set(String(name), o);
  }
  for (let k = 0; k + 1 < pts.length && k < 60; k += 2) { o.times[k / 2] = Math.trunc(+pts[k] || 0); o.prices[k / 2] = +pts[k + 1] || 0; }
  R.objDirty = true;
  return true;
}, { va: true, doc: 'Creates a chart object: chart_id, name, OBJ_ type, sub_window, then time1, price1, time2, price2 ...' });
def('ObjectDelete', 'l,s', 'bool', (R, l, c, name) => { const ok = R.objects.delete(String(name)); if (ok) R.objDirty = true; return ok; }, { doc: 'Deletes an object by name.' });
def('ObjectsDeleteAll', 'l,a=-1,i=-1,i=-1', 'int', (R, l, T, c, a, b, d) => {
  let prefix = null, sub = a, type = b;
  if (T[1] && T[1].n === 'string') { prefix = a; sub = b; type = d; }
  let n = 0;
  for (const [k, o] of R.objects) if ((prefix === null || k.startsWith(prefix)) && (sub < 0 || o.sub === sub) && (type < 0 || o.type === type)) { R.objects.delete(k); n++; }
  if (n) R.objDirty = true;
  return n;
}, { types: true, doc: 'Deletes objects (by window and type, or by name prefix). Returns how many.' });
def('ObjectFind', 'l,s', 'int', (R, l, c, name) => { const o = objOf(R, name); return o ? o.sub : -1; }, { doc: 'Window of the object, or -1 if there is none.' });
def('ObjectsTotal', 'l,i=-1,i=-1', 'int', (R, l, c, sub, type) => { let n = 0; for (const o of R.objects.values()) if ((sub < 0 || o.sub === sub) && (type < 0 || o.type === type)) n++; return n; }, { doc: 'Number of objects.' });
def('ObjectName', 'l,i,i=-1,i=-1', 'string', (R, l, c, i, sub, type) => { let k = 0; for (const o of R.objects.values()) if ((sub < 0 || o.sub === sub) && (type < 0 || o.type === type)) { if (k++ === i) return o.name; } return ''; }, { doc: 'Name of the object at a position.' });
def('ObjectMove', 'l,s,i,t,d', 'bool', (R, l, c, name, p, t, v) => { const o = objOf(R, name); if (!o || p < 0 || p > 30) return false; o.times[p] = t; o.prices[p] = v; R.objDirty = true; return true; }, { doc: 'Moves one anchor point of an object.' });
function objSetI(R, name, p, m, v) {
  const o = objOf(R, name); if (!o) { R.lastError = 4202; return false; }
  if (p === 10) { if (m < 0 || m > 30) return false; o.times[m] = v; }
  else if (p === 31 || p === 7) o.i.set(p, v ? 1 : 0);
  else o.i.set(m ? p * 100 + m : p, v);
  R.objDirty = true; return true;
}
def('ObjectSetInteger', 'l,s,i,l', 'bool', (R, l, c, n, p, v) => objSetI(R, n, p, 0, v), { doc: 'OBJPROP_COLOR, STYLE, WIDTH, CORNER, XDISTANCE, YDISTANCE, XSIZE, YSIZE, STATE, FONTSIZE, BGCOLOR, TIME ...' });
def('ObjectSetInteger', 'l,s,i,i,l', 'bool', (R, l, c, n, p, m, v) => objSetI(R, n, p, m, v));
def('ObjectSetDouble', 'l,s,i,d', 'bool', (R, l, c, n, p, v) => { const o = objOf(R, n); if (!o) { R.lastError = 4202; return false; } if (p === 100) o.prices[0] = v; else o.d.set(p, v); R.objDirty = true; return true; }, { doc: 'OBJPROP_PRICE, OBJPROP_ANGLE ...' });
def('ObjectSetDouble', 'l,s,i,i,d', 'bool', (R, l, c, n, p, m, v) => { const o = objOf(R, n); if (!o) { R.lastError = 4202; return false; } if (p === 100) { if (m < 0 || m > 30) return false; o.prices[m] = v; } else o.d.set(p * 100 + m, v); R.objDirty = true; return true; });
def('ObjectSetString', 'l,s,i,s', 'bool', (R, l, c, n, p, v) => { const o = objOf(R, n); if (!o) { R.lastError = 4202; return false; } o.s.set(p, String(v).slice(0, 2000)); R.objDirty = true; return true; }, { doc: 'OBJPROP_TEXT, OBJPROP_FONT, OBJPROP_TOOLTIP.' });
def('ObjectSetString', 'l,s,i,i,s', 'bool', (R, l, c, n, p, m, v) => { const o = objOf(R, n); if (!o) { R.lastError = 4202; return false; } o.s.set(p * 100 + m, String(v).slice(0, 2000)); R.objDirty = true; return true; });
function objGetI(R, name, p, m) {
  const o = objOf(R, name); if (!o) { R.lastError = 4202; return 0; }
  if (p === 9) return o.type; if (p === 10) return o.times[m] || 0; if (p === 12) return o.created;
  const v = o.i.get(m ? p * 100 + m : p);
  return v === undefined ? 0 : v;
}
def('ObjectGetInteger', 'l,s,i,i=0', 'long', (R, l, c, n, p, m) => objGetI(R, n, p, m), { doc: 'Reads an integer object property (OBJPROP_STATE for a pressed button).' });
def('ObjectGetInteger', 'l,s,i,i,&l', 'bool', (R, l, c, n, p, m, out) => { if (!objOf(R, n)) return false; out.set(objGetI(R, n, p, m)); return true; });
const objGetD = (R, n, p, m) => { const o = objOf(R, n); if (!o) { R.lastError = 4202; return 0; } if (p === 100) return o.prices[m] || 0; const v = o.d.get(m ? p * 100 + m : p); return v === undefined ? 0 : v; };
def('ObjectGetDouble', 'l,s,i,i=0', 'double', (R, l, c, n, p, m) => objGetD(R, n, p, m), { doc: 'Reads a double object property.' });
def('ObjectGetDouble', 'l,s,i,i,&d', 'bool', (R, l, c, n, p, m, out) => { if (!objOf(R, n)) return false; out.set(objGetD(R, n, p, m)); return true; });
const objGetS = (R, n, p, m) => { const o = objOf(R, n); if (!o) { R.lastError = 4202; return ''; } if (p === 200) return o.name; return o.s.get(m ? p * 100 + m : p) || ''; };
def('ObjectGetString', 'l,s,i,i=0', 'string', (R, l, c, n, p, m) => objGetS(R, n, p, m), { doc: 'Reads a text object property (OBJPROP_TEXT of an edit box).' });
def('ObjectGetString', 'l,s,i,i,&s', 'bool', (R, l, c, n, p, m, out) => { if (!objOf(R, n)) return false; out.set(objGetS(R, n, p, m)); return true; });
const lineAt = (o, t) => { const [t1, t2] = o.times, [p1, p2] = o.prices; if (t2 === t1) return p1; return p1 + ((p2 - p1) * (t - t1)) / (t2 - t1); };
def('ObjectGetValueByTime', 'l,s,t,i=0', 'double', (R, l, c, n, t) => { const o = objOf(R, n); if (!o) return 0; return o.type === 1 ? o.prices[0] : lineAt(o, t); }, { doc: 'Price of a trend line at a time.' });
def('ObjectGetTimeByValue', 'l,s,d,i=0', 'datetime', (R, l, c, n, v) => { const o = objOf(R, n); if (!o) return 0; const [t1, t2] = o.times, [p1, p2] = o.prices; return p2 === p1 ? t1 : Math.round(t1 + ((t2 - t1) * (v - p1)) / (p2 - p1)); }, { doc: 'Time where a trend line reaches a price.' });
def('TextSetFont', 's,i,u=0,u=0', 'bool', (R, l, f, s) => { R.font = { f, s }; return true; }, { doc: 'Font for TextGetSize.' });
def('TextGetSize', 's,&u,&u', 'bool', (R, l, t, w, h) => { const px = R.font ? Math.abs(R.font.s) / (R.font.s < 0 ? 10 : 1) : 10; w.set(Math.round(t.length * px * 0.6)); h.set(Math.round(px * 1.3)); return true; }, { doc: 'Approximate size of text in pixels.' });

// ======================= Chart =======================
cat('Chart');
const CHI = (R, p, sub) => { const c = R.chart; switch (p) { case 36: return c.w; case 37: return sub > 0 ? c.subH || c.h : c.h; case 29: case 35: return c.visible; case 34: return c.first; case 30: return R.separate ? 2 : 1; case 16: return 2; case 10: return 1; case 38: return c.dark ? 0x1A1A1A : 0xFFFFFF; case 39: return c.dark ? 0xDDDDDD : 0x202020; case 7: return R.mouseMove ? 1 : 0; case 26: return 1; case 53: case 54: return 1; case 31: return 1; case 33: return 0; default: return R.chartI.get(p) || 0; } };
def('ChartGetInteger', 'l,i,i=0', 'long', (R, l, c, p, s) => CHI(R, p, s), { doc: 'CHART_WIDTH_IN_PIXELS, CHART_HEIGHT_IN_PIXELS, CHART_VISIBLE_BARS, CHART_FIRST_VISIBLE_BAR ...' });
def('ChartGetInteger', 'l,i,i,&l', 'bool', (R, l, c, p, s, out) => { out.set(CHI(R, p, s)); return true; });
def('ChartSetInteger', 'l,i,l', 'bool', (R, l, c, p, v) => { if (p === 7) R.mouseMove = !!v; R.chartI.set(p, v); return true; }, { doc: 'CHART_EVENT_MOUSE_MOVE turns mouse-move events on; other chart settings are kept but do not change the chart.' });
def('ChartSetInteger', 'l,i,i,l', 'bool', (R, l, c, p, m, v) => { R.chartI.set(p, v); return true; });
def('ChartGetDouble', 'l,i,i=0', 'double', (R, l, c, p) => (p === 5 ? R.chart.pmin : p === 6 ? R.chart.pmax : 0), { doc: 'CHART_PRICE_MIN, CHART_PRICE_MAX of the visible range.' });
def('ChartGetDouble', 'l,i,i,&d', 'bool', (R, l, c, p, s, out) => { out.set(p === 5 ? R.chart.pmin : p === 6 ? R.chart.pmax : 0); return true; });
def('ChartSetDouble', 'l,i,d', 'bool', () => true, { doc: 'Accepted; the chart keeps its own scale.' });
def('ChartGetString', 'l,i', 'string', (R, l, c, p) => (p === 0 ? R.comment : p === 2 ? R.ind.shortname : ''), { doc: 'CHART_COMMENT.' });
def('ChartSetString', 'l,i,s', 'bool', (R, l, c, p, v) => { if (p === 0) { R.comment = String(v).slice(0, 4000); R.objDirty = true; } return true; }, { doc: 'CHART_COMMENT sets the comment text.' });
def('ChartRedraw', 'l=0', 'void', (R) => { R.objDirty = true; R.redraw = true; }, { doc: 'Draws object changes now (from OnTimer / OnChartEvent).' });
def('ChartID', '', 'long', () => 0, { doc: 'This chart (0).' });
def('ChartSymbol', 'l=0', 'string', (R) => R.symbol, { doc: 'Chart symbol.' });
def('ChartPeriod', 'l=0', 'ENUM_TIMEFRAMES', (R) => R.period, { doc: 'Chart timeframe.' });
def('ChartFirst', '', 'long', () => 0, { doc: 'This chart (0).' });
def('ChartNext', 'l', 'long', () => -1, { doc: 'No other charts (-1).' });
def('ChartWindowFind', '', 'int', (R) => (R.separate ? 1 : 0), { doc: 'Window of this indicator: 0 on the price chart, 1 in its own pane.' });
def('ChartWindowFind', 'l,s', 'int', (R) => (R.separate ? 1 : 0));
def('WindowFind', 's', 'int', (R) => (R.separate ? 1 : 0), { alias: 'ChartWindowFind' });
def('ChartNavigate', 'l,i,i=0', 'bool', () => true, { doc: 'Accepted; the member scrolls the chart.' });
def('ChartIndicatorsTotal', 'l,i', 'int', () => 1, { doc: 'Counts this indicator.' });
def('ChartIndicatorName', 'l,i,i', 'string', (R) => R.ind.shortname, { doc: 'This indicator\'s short name.' });
const xyOf = (R, t, p) => { const c = R.chart, b = R.bars.time, n = b.length; let i = n - 1; if (n) { let lo = 0, hi = n - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (b[m] <= t) lo = m; else hi = m - 1; } i = lo + (t > b[n - 1] ? Math.round((t - b[n - 1]) / R.tfSec) : 0); } return [Math.round(c.x0 - (n - 1 - i) * c.barW), Math.round(c.pmax > c.pmin ? ((c.pmax - p) / (c.pmax - c.pmin)) * c.h : 0)]; };
def('ChartTimePriceToXY', 'l,i,t,d,&i,&i', 'bool', (R, l, c, s, t, p, x, y) => { const [a, b] = xyOf(R, t, p); x.set(a); y.set(b); return true; }, { doc: 'Pixel position of a time and price (main window).' });
def('ChartXYToTimePrice', 'l,i,i,&i,&t,&d', 'bool', (R, l, c, x, y, sub, t, p) => { const C = R.chart, n = R.bars.time.length; const sh = Math.round((C.x0 - x) / (C.barW || 1)); const i = n - 1 - sh; t.set(i >= 0 && i < n ? R.bars.time[i] : n ? R.bars.time[n - 1] + (i - n + 1) * R.tfSec : 0); p.set(C.pmax - (y / (C.h || 1)) * (C.pmax - C.pmin)); sub.set(0); return true; }, { doc: 'Time and price under a pixel position.' });
def('ChartTimeOnDropped', '', 'datetime', () => 0, { doc: 'Indicators are added from the editor: 0.' });
def('ChartPriceOnDropped', '', 'double', () => 0, { doc: 'Indicators are added from the editor: 0.' });
def('ChartWindowOnDropped', '', 'int', () => 0, { doc: 'Indicators are added from the editor: 0.' });
def('ChartXOnDropped', '', 'int', () => 0, { doc: '0.' });
def('ChartYOnDropped', '', 'int', () => 0, { doc: '0.' });

// ======================= Common =======================
cat('Common');
def('Print', '', 'void', (R, l, T, ...a) => R.print(joinArgs(T, a)), { va: true, types: true, doc: 'Writes a line to the script log in the editor.' });
def('PrintFormat', 's', 'void', (R, l, f, ...a) => R.print(format(f, a)), { va: true, doc: 'Print with StringFormat rules.' });
def('Comment', '', 'void', (R, l, T, ...a) => { R.comment = joinArgs(T, a).slice(0, 4000); R.objDirty = true; }, { va: true, types: true, doc: 'Text in the top-left corner of the chart.' });
def('Alert', '', 'void', (R, l, T, ...a) => R.alert(joinArgs(T, a).slice(0, 500)), { va: true, types: true, doc: 'A chart notice with the alert sound (at most one every 2 seconds).' });
def('PlaySound', 's', 'bool', (R) => { R.alert(null); return true; }, { doc: 'Plays the TradeZoro alert sound (sound files are not available).' });
def('GetLastError', '', 'int', (R) => R.lastError, { doc: 'Code of the last error.' });
def('ResetLastError', '', 'void', (R) => { R.lastError = 0; }, { doc: 'Sets the last error to 0.' });
def('SetUserError', 'h', 'void', (R, l, c) => { R.lastError = 65536 + c; }, { doc: 'Sets a user error (65536 + code).' });
def('IsStopped', '', 'bool', () => false, { doc: 'false (the engine stops a script by itself).' });
def('UninitializeReason', '', 'int', (R) => R.uninitReason, { doc: 'Why the indicator was last stopped.' });
def('MQLInfoInteger', 'i', 'int', (R, l, p) => (p === 0 ? 3 : p === 11 ? 256 : p === 12 ? Math.round(R.mem * 8 / 1048576) : 0), { doc: 'MQL_PROGRAM_TYPE (indicator), MQL_MEMORY_LIMIT, MQL_TESTER (0) ...' });
def('MQLInfoString', 'i', 'string', (R, l, p) => (p === 0 ? R.ind.shortname : ''), { doc: 'MQL_PROGRAM_NAME.' });
def('TerminalInfoInteger', 'i', 'int', (R, l, p) => ({ 0: 4000, 2: 1, 5: 100000, 6: 65001, 7: 4, 12: 96, 16: R.chart.w, 17: R.chart.h }[p] || 0), { doc: 'TERMINAL_BUILD, TERMINAL_CONNECTED, TERMINAL_SCREEN_DPI ...' });
def('TerminalInfoString', 'i', 'string', (R, l, p) => ({ 0: 'English', 1: 'TradeZoro', 2: 'TradeZoro' }[p] || ''), { doc: 'TERMINAL_LANGUAGE, TERMINAL_NAME.' });
def('TerminalInfoDouble', 'i', 'double', () => 0, { doc: '0.' });
def('EventSetTimer', 'i', 'bool', (R, l, s) => R.setTimer(s * 1000), { doc: 'Calls OnTimer every n seconds.' });
def('EventSetMillisecondTimer', 'i', 'bool', (R, l, ms) => R.setTimer(ms), { doc: 'Calls OnTimer every n milliseconds (at least 100).' });
def('EventKillTimer', '', 'void', (R) => { R.setTimer(0); }, { doc: 'Stops the timer.' });
def('EventChartCustom', 'l,h,l,d,s', 'bool', (R, l, c, id, lp, dp, sp) => R.custEvent(1000 + id, lp, dp, sp), { doc: 'Sends OnChartEvent(CHARTEVENT_CUSTOM + id) to this indicator.' });
def('DebugBreak', '', 'void', () => {}, { doc: 'No effect.' });
def('TranslateKey', 'i', 'short', (R, l, k) => (k >= 32 && k < 127 ? k : -1), { doc: 'Key code to a character code.' });
def('CheckPointer', 'a', 'int', () => 2, { doc: 'Always POINTER_AUTOMATIC (no objects).' });
def('MarketInfo', 's,i', 'double', (R, l, s, p) => (p === 11 ? R.point : p === 12 ? R.digits : symD(R, 0)), { alias: 'SymbolInfoDouble', doc: 'MQL4 style: price, point or digits.' });

cat('Chart');
// the usual way to make an indicator recalculate: ChartSetSymbolPeriod(0, NULL, 0) (same symbol and timeframe). Changing the chart is not allowed.
def('ChartSetSymbolPeriod', 'l,s,i', 'bool', (R, l, c, sym, tf) => { if (!isCur(R, sym) || (tf && tf !== R.period)) { R.lastError = 4113; R.notice('ChartSetSymbolPeriod can only refresh this chart (NULL, 0); an indicator cannot change the symbol or timeframe.'); return false; } R.recalc = true; return true; }, { doc: 'With NULL and 0: recalculates this indicator from the first bar. An indicator cannot switch the chart.' });
def('WindowRedraw', '', 'void', (R) => { R.redraw = true; }, { alias: 'ChartRedraw', doc: 'MQL4 style: redraws the chart.' });
def('WindowsTotal', '', 'int', (R) => (R.separate ? 2 : 1), { doc: 'MQL4 style: windows on the chart (main + this one).' });
def('WindowPriceMax', 'i=0', 'double', (R) => R.chart.pmax, { alias: 'ChartGetDouble', doc: 'MQL4 style: top price of the visible chart.' });
def('WindowPriceMin', 'i=0', 'double', (R) => R.chart.pmin, { alias: 'ChartGetDouble', doc: 'MQL4 style: bottom price of the visible chart.' });
def('WindowFirstVisibleBar', '', 'int', (R) => R.chart.first, { doc: 'MQL4 style: shift of the first visible bar.' });
def('WindowBarsPerChart', '', 'int', (R) => R.chart.visible, { doc: 'MQL4 style: how many bars fit on the chart.' });
def('WindowOnDropped', '', 'int', () => 0, { doc: 'MQL4 style: 0.' });
cat('Common');
def('IsTesting', '', 'bool', () => false, { doc: 'Always false (charts only).' });
def('IsOptimization', '', 'bool', () => false, { doc: 'Always false.' });
def('IsVisualMode', '', 'bool', () => false, { doc: 'Always false.' });
def('IsConnected', '', 'bool', () => true, { doc: 'True while the chart has data.' });
def('IsDllsAllowed', '', 'bool', () => false, { doc: 'Always false: no DLLs on TradeZoro.' });

// ======================= Global variables (this indicator's own, while the chart is open) =======================
cat('Global variables');
const gvT = (R) => Math.floor(R.now() / 1000);
def('GlobalVariableSet', 's,d', 'datetime', (R, l, n, v) => { if (R.gv.size >= 1000 && !R.gv.has(n)) return 0; R.gv.set(n, { v, t: gvT(R) }); return gvT(R); }, { doc: 'Stores a number under a name (kept while the indicator runs).' });
def('GlobalVariableGet', 's', 'double', (R, l, n) => { const g = R.gv.get(n); if (!g) { R.lastError = 4501; return 0; } return g.v; }, { doc: 'Reads a stored number.' });
def('GlobalVariableGet', 's,&d', 'bool', (R, l, n, out) => { const g = R.gv.get(n); if (!g) return false; out.set(g.v); return true; });
def('GlobalVariableCheck', 's', 'bool', (R, l, n) => R.gv.has(n), { doc: 'Is a name stored?' });
def('GlobalVariableDel', 's', 'bool', (R, l, n) => R.gv.delete(n), { doc: 'Removes a stored name.' });
def('GlobalVariableTime', 's', 'datetime', (R, l, n) => (R.gv.get(n) || { t: 0 }).t, { doc: 'When a name was last set.' });
def('GlobalVariableName', 'i', 'string', (R, l, i) => [...R.gv.keys()][i] || '', { doc: 'Name at a position.' });
def('GlobalVariablesTotal', '', 'int', (R) => R.gv.size, { doc: 'How many names are stored.' });
def('GlobalVariablesDeleteAll', 's=,t=0', 'int', (R, l, p, t) => { let n = 0; for (const [k, g] of R.gv) if (k.startsWith(p) && (!t || g.t < t)) { R.gv.delete(k); n++; } return n; }, { doc: 'Removes names (by prefix).' });
def('GlobalVariableSetOnCondition', 's,d,d', 'bool', (R, l, n, v, c) => { const g = R.gv.get(n); if (!g || g.v !== c) return false; g.v = v; g.t = gvT(R); return true; }, { doc: 'Sets a name only if it holds a given value.' });
def('GlobalVariableTemp', 's', 'bool', (R, l, n) => { if (!R.gv.has(n)) R.gv.set(n, { v: 0, t: gvT(R) }); return true; }, { doc: 'Creates a name (all names here are temporary).' });
def('GlobalVariablesFlush', '', 'void', () => {}, { doc: 'No effect (nothing is written to disk).' });

Object.freeze(BUILTINS);
