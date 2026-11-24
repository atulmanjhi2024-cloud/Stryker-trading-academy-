// TradeZoro MQL5 engine: compiler. AST -> JavaScript closures over slot-indexed frames.
//
// SAFETY: member text never becomes JavaScript source. Every AST node is turned into a closure written here, so the
// worker needs no eval / new Function and keeps its strict CSP. Member-chosen names are resolved to array slots at
// compile time (globals, locals, struct fields); they are never used as JS property keys.
//
// build(source, env) -> Instance (assets/mq5/program.js) ready to run; check(source) -> { ok, diagnostics, meta }.
import { preprocess, MqError, err } from './lexer.js?v=1257';
import { parse, BASE_TYPES } from './parser.js?v=1257';
import { CONSTS, ENUMS, STRUCTS, UNSUPPORTED, UNSUPPORTED_WHY, EMPTY_VALUE } from './consts.js?v=1257';
import { MArr, rtErr, cloneVal, copyInto, fmtDouble, timeToString, colorToString, LIMITS } from './runtime.js?v=1257';
import { BUILTINS } from './builtins.js?v=1257';

// ---------- types ----------
const TY = {};
for (const n of BASE_TYPES) TY[n] = { n };
const KIND = { bool: 'b', char: 'i', uchar: 'i', short: 'i', ushort: 'i', int: 'i', uint: 'u', color: 'u', long: 'l', ulong: 'l', datetime: 'l', float: 'd', double: 'd', string: 's', void: 'x' };
const kindOf = (t) => (t.arr || t.st ? 'x' : t.en ? 'i' : KIND[t.n] || 'x');
const isNum = (t) => { const k = kindOf(t); return k === 'b' || k === 'i' || k === 'u' || k === 'l' || k === 'd'; };
const tname = (t) => (t.arr ? t.elem.n + '[]' : t.n);
const RANK = { b: 0, i: 1, u: 2, l: 3, d: 4 };
const promote = (a, b) => { const ka = kindOf(a), kb = kindOf(b); if (ka === 's' || kb === 's') return 's'; return RANK[ka] >= RANK[kb] ? (ka === 'b' ? 'i' : ka) : kb === 'b' ? 'i' : kb; };
const KT = { i: TY.int, u: TY.uint, l: TY.long, d: TY.double, s: TY.string, b: TY.bool };

export function toStr(t) {
  const k = kindOf(t);
  if (t.n === 'datetime') return (v) => timeToString(v, 3);
  if (t.n === 'color') return (v) => colorToString(v, true);
  if (k === 'd') return (v) => fmtDouble(v);
  if (k === 'b') return (v) => (v ? 'true' : 'false');
  if (k === 's') return null;
  return (v) => String(v);
}
const pf = (s) => { const v = parseFloat(s); return Number.isFinite(v) ? v : 0; };
// a converter from type a to type b (null = no conversion needed), or throws E3xx
function convFn(a, b, at) {
  if (b.n === 'void') return null;
  if (a.arr || b.arr) { if (a.arr && b.arr) return null; throw err('E301', 'Cannot use ' + tname(a) + ' as ' + tname(b) + '.', at); }
  if (a.st || b.st) { if (a.st && b.st && a.st === b.st) return null; throw err('E301', 'Cannot use ' + tname(a) + ' as ' + tname(b) + '.', at); }
  const ka = kindOf(a), kb = kindOf(b);
  if (kb === 's') return ka === 's' ? null : toStr(a);
  if (ka === 'x' || kb === 'x') throw err('E301', 'Cannot use ' + tname(a) + ' as ' + tname(b) + '.', at);
  if (kb === 'b') return ka === 'b' ? null : ka === 's' ? (v) => v !== '' : (v) => v !== 0;
  if (ka === 's') return kb === 'd' ? pf : kb === 'u' ? (v) => pf(v) >>> 0 : kb === 'l' ? (v) => Math.trunc(pf(v)) : (v) => pf(v) | 0;
  switch (b.n) {
    case 'char': return (v) => (v << 24) >> 24;
    case 'uchar': return (v) => v & 255;
    case 'short': return (v) => (v << 16) >> 16;
    case 'ushort': return (v) => v & 65535;
    case 'float': return ka === 'd' ? (v) => Math.fround(v) : (v) => Math.fround(+v);
    default: break;
  }
  if (kb === 'd') return ka === 'b' ? (v) => +v : null;
  if (kb === 'i') return ka === 'i' && !a.en ? null : (v) => v | 0;
  if (kb === 'u') return ka === 'u' ? null : (v) => v >>> 0;
  if (kb === 'l') return ka === 'l' ? null : ka === 'd' ? (v) => (Number.isFinite(v) ? Math.trunc(v) : 0) : (v) => +v;
  return null;
}
const wrapConv = (f, cv) => (cv ? (F) => cv(f(F)) : f);

export class Ref { constructor(g, s) { this.g = g; this.s = s; } get() { return this.g(); } set(v) { this.s(v); return v; } }

const BRK = 1, CONT = 2, RET = 3;

// ---------- the compiler ----------
export function compileProgram(source, R) {
  const pp = preprocess(source);
  const ast = parse(pp, structAndEnumNames());
  const C = new Compiler(R, pp, ast);
  C.run();
  return C;
}
// library class names count as types so `CTrade trade;` gives the clear "not supported" line, not a parse error
function structAndEnumNames() { return Object.keys(ENUMS).concat(Object.keys(STRUCTS), [...UNSUPPORTED].filter(([, w]) => w === 'class' || w === 'tradetype').map(([n]) => n)); }

class Compiler {
  constructor(R, pp, ast) {
    this.R = R; this.pp = pp; this.ast = ast;
    this.types = new Map();      // name -> type (enums, structs)
    this.globals = new Map();    // name -> sym
    this.funcs = new Map();      // name -> [fn]
    this.nG = 0;                 // global slots
    this.inits = [];             // global initialisers (in order)
    this.inputs = [];            // input descriptors
    this.scopes = []; this.fn = null; this.loop = 0; this.sw = 0;
    this.uses = new Set();       // built-ins the script calls (meta)
    for (const n of Object.keys(ENUMS)) this.types.set(n, this.enumType(n, new Map(ENUMS[n].map(([m, v]) => [v, m]))));
    for (const n of Object.keys(STRUCTS)) this.types.set(n, this.structType(n, STRUCTS[n].map(([f, t]) => ({ name: f, t: TY[t] || this.types.get(t) || TY.int }))));
  }
  enumType(name, members) { return { n: name, en: true, members }; }
  structType(name, fields) {
    const st = { name, fields, index: new Map(fields.map((f, i) => [f.name, i])) };
    const R = this.R;
    st.make = () => fields.map((f) => this.defaultOf(f.t, R));
    return { n: name, st };
  }
  defaultOf(t) {
    if (t.st) return t.st.make();
    if (t.arr) return this.newArray(t, null);
    const k = kindOf(t);
    return k === 's' ? '' : k === 'b' ? false : 0;
  }
  newArray(t, size) {
    const el = t.elem, inner = t.dims.slice(1);
    const def = el.st ? el.st.make : this.defaultOf(el);
    return new MArr(this.R, def, t.dims[0] == null, inner, size != null ? size : t.dims[0] || 0);
  }
  resolveType(spec, dimsAst) {
    let t = TY[spec.name] || this.types.get(spec.name) || (this.tbind && this.tbind.get(spec.name));
    if (!t) {
      { const w = UNSUPPORTED.get(spec.name); if (w === 'class' || w === 'tradetype') throw err('E290', spec.name + ' is not supported in indicators on TradeZoro.', spec, UNSUPPORTED_WHY[w]); }
      throw err('E302', 'Unknown type ' + spec.name + '.', spec);
    }
    if (dimsAst && dimsAst.length) {
      if (t.arr) throw err('E303', 'Arrays of arrays are not supported; use more dimensions: a[5][3].', spec);
      const dims = dimsAst.map((d, i) => {
        if (d == null) { if (i > 0) throw err('E304', 'Only the first array dimension can be left empty.', spec); return null; }
        const c = this.constOf(d);
        if (!(Number.isInteger(c) && c > 0)) throw err('E304', 'An array size must be a whole number above zero.', d);
        if (c > LIMITS.maxElems) throw err('E304', 'This array is too large.', d);
        return c;
      });
      return { n: t.n, arr: true, elem: t, dims };
    }
    return t;
  }
  // a compile-time constant (array sizes, case labels, enum values, #property values)
  constOf(e) {
    const x = this.expr(e);
    if (x.c === undefined) throw err('E305', 'This must be a constant value.', e);
    return x.c;
  }

  run() {
    const A = this.ast;
    // 1. types
    for (const d of A.decls) if (d.k === 'enum') this.declEnum(d);
    for (const d of A.decls) if (d.k === 'struct' && !d.fwd) this.declStruct(d);
    // 2. function signatures
    for (const d of A.decls) if (d.k === 'func') this.declFunc(d);
    // 3. globals (in source order)
    for (const d of A.decls) if (d.k === 'var') this.declGlobal(d);
    // 4. bodies
    for (const list of this.funcs.values()) for (const f of list) if (!f.tparams) this.compileFn(f);
    this.entries();
  }
  declEnum(d) {
    const members = new Map(), list = [];
    let v = 0;
    for (const m of d.members) {
      if (m.value) { const c = this.constOf(m.value); if (!Number.isFinite(c)) throw err('E306', 'An enum value must be a whole number.', m.value); v = c | 0; }
      if (this.globals.has(m.name)) throw err('E307', m.name + ' is already defined.', m);
      members.set(v, m.name); list.push({ name: m.name, value: v, label: m.label });
      v++;
    }
    const t = this.enumType(d.name, members); t.list = list;
    this.types.set(d.name, t);
    for (const m of list) this.globals.set(m.name, { k: 'c', t, v: m.value });
  }
  declStruct(d) {
    if (this.types.has(d.name) && this.types.get(d.name).st && STRUCTS[d.name]) throw err('E307', 'The struct ' + d.name + ' is built in.', d);
    const fields = d.fields.map((f) => ({ name: f.name, t: this.resolveType(f.type, f.dims) }));
    const t = this.structType(d.name, fields);
    this.types.set(d.name, t);
  }
  declFunc(d) {
    if (UNSUPPORTED.get(d.name) === 'event') throw err('E291', d.name + ' is not supported in indicators on TradeZoro.', d, UNSUPPORTED_WHY.event);
    if (BUILTINS.has(d.name) && !d.tparams && d.name !== 'OnCalculate') throw err('E308', d.name + ' is a built-in function; give your function another name.', d);
    let f;
    if (d.tparams) f = { name: d.name, ast: d, tparams: d.tparams, inst: new Map(), line: d.line };
    else {
      const ret = this.resolveType(d.ret);
      const params = d.params.map((p) => {
        const t = this.resolveType(p.type, p.dims);
        if ((t.st) && !p.ref) throw err('E309', 'A struct parameter must be passed by reference: ' + t.n + ' &' + p.name + '.', p);
        return { name: p.name, t, ref: p.ref, def: p.def, line: p.line, col: p.col };
      });
      f = { name: d.name, ast: d, ret, params, body: null, nslots: 0, line: d.line };
    }
    const list = this.funcs.get(d.name) || [];
    if (!d.body) { if (!list.length) this.funcs.set(d.name, list.concat([Object.assign(f, { proto: true })])); return; }
    // a prototype declared earlier: replace it
    const same = list.findIndex((g) => g.proto && g.params && f.params && g.params.length === f.params.length);
    if (same >= 0) { Object.assign(list[same], f, { proto: false }); this.funcs.set(d.name, list); return; }
    list.push(f); this.funcs.set(d.name, list);
  }
  declGlobal(d) {
    const R = this.R;
    for (const v of d.decls) {
      if (this.globals.has(v.name)) throw err('E307', v.name + ' is already defined.', v);
      const t = this.resolveType(d.type, v.dims);
      const slot = this.nG++;
      const sym = { k: 'g', t, slot, ro: !!d.input || !!d.type.const, name: v.name };
      this.globals.set(v.name, sym);
      const init = this.initOf(t, v, true);
      if (d.input) {
        if (t.arr || t.st) throw err('E310', 'An input must be a plain value, not an array or struct.', v);
        let def = init.c;
        if (def === undefined) { if (v.init) throw err('E305', 'An input needs a constant default value.', v.init); def = this.defaultOf(t); }
        const inp = this.inputDesc(v.name, t, def, d);
        this.inputs.push(inp);
        const cv = convFn(t, t, v);
        this.inits.push(() => { R.G[slot] = this.inputValue(inp, t, def, cv); });
      } else {
        const f = init.f;
        this.inits.push(() => { R.G[slot] = f(null); });
      }
    }
  }
  inputDesc(name, t, def, d) {
    const title = d.label || name;
    const o = { key: name, title: title.slice(0, 80), group: d.group || '', sinput: d.input === 'sinput' };
    const k = kindOf(t);
    if (t.en) {
      const list = t.list || (ENUMS[t.n] || []).map(([m, v, label]) => ({ name: m, value: v, label }));
      o.type = 'string'; o.options = list.map((m) => m.name).slice(0, 100);
      o.display = { options: Object.fromEntries(list.slice(0, 100).map((m) => [m.name, (m.label || pretty(m.name)).slice(0, 60)])) };
      o.defval = t.members.get(def) || o.options[0]; o.enumType = t.n;
    } else if (t.n === 'color') { o.type = 'color'; o.defval = hexOfColor(def); }
    else if (t.n === 'datetime') { o.type = 'time'; o.defval = def * 1000; }
    else if (k === 'b') { o.type = 'bool'; o.defval = !!def; }
    else if (k === 'd') { o.type = 'float'; o.defval = def; o.step = stepOf(def); }
    else if (k === 'i' || k === 'u' || k === 'l') { o.type = 'int'; o.defval = def; if (k === 'u' || t.n === 'uchar' || t.n === 'ushort' || t.n === 'ulong') o.min = 0; }
    else { o.type = 'string'; o.defval = String(def); }
    return o;
  }
  inputValue(inp, t, def, cv) {
    const raw = this.R.env.inputs ? this.R.env.inputs[inp.key] : undefined;
    if (raw === undefined || raw === null) return def;
    if (t.en) { for (const [v, m] of t.members) if (m === raw) return v; return def; }
    if (t.n === 'color') return typeof raw === 'string' ? colorOfHexStr(raw) : def;
    if (t.n === 'datetime') return typeof raw === 'number' ? Math.floor(raw / 1000) : def;
    const k = kindOf(t);
    if (k === 'b') return !!raw;
    if (k === 's') return String(raw).slice(0, 4096);
    const n = +raw; if (!Number.isFinite(n)) return def;
    return k === 'd' ? n : cv ? cv(n) : Math.trunc(n);
  }
  // initialiser closure for a declaration (global or local). Returns { f(F), c? }
  initOf(t, v, global) {
    const at = v;
    if (t.arr) {
      if (v.init) {
        if (v.init.k !== 'list') throw err('E311', 'An array is initialised with { ... }.', v.init);
        const flat = [];
        const walk = (node, depth) => { if (node.k === 'list') node.items.forEach((x) => walk(x, depth + 1)); else flat.push(node); };
        walk(v.init, 0);
        const items = flat.map((x) => this.expr(x)).map((x) => wrapConv(x.f, t.elem.st ? null : convFn(x.t, t.elem, at)));
        const stride = t.dims.slice(1).reduce((a, b) => a * b, 1);
        const n0 = t.dims[0] || Math.ceil(items.length / stride);
        return { f: (F) => { const a = this.newArray(t, n0); for (let i = 0; i < items.length && i < a.d.length; i++) a.d[i] = items[i](F); if (t.dims[0] == null) a.dyn = false; return a; } };
      }
      return { f: () => this.newArray(t, null) };
    }
    if (t.st) {
      if (v.init) {
        if (v.init.k === 'list') {
          const fields = t.st.fields;
          const vals = v.init.items.map((x, i) => { if (i >= fields.length) throw err('E311', 'Too many values for struct ' + t.n + '.', x); const e = this.expr(x); return wrapConv(e.f, convFn(e.t, fields[i].t, x)); });
          return { f: (F) => { const s = t.st.make(); vals.forEach((g, i) => { s[i] = g(F); }); return s; } };
        }
        const e = this.expr(v.init); convFn(e.t, t, v.init);
        return { f: (F) => cloneVal(e.f(F)) };
      }
      return { f: () => t.st.make() };
    }
    if (!v.init) { const d = this.defaultOf(t); return { f: () => d, c: d }; }
    if (v.init.k === 'list') throw err('E311', 'Only arrays and structs are initialised with { ... }.', v.init);
    const e = this.expr(v.init);
    const cv = convFn(e.t, t, v.init);
    if (e.c !== undefined) { const c = cv ? cv(e.c) : e.c; return { f: () => c, c }; }
    return { f: wrapConv(e.f, cv) };
  }

  // ---------- scopes ----------
  lookup(name) {
    for (let i = this.scopes.length - 1; i >= 0; i--) { const s = this.scopes[i].get(name); if (s) return s; }
    const g = this.globals.get(name);
    if (g) return g;
    if (CONSTS[name]) { const [tn, v] = CONSTS[name]; return { k: 'c', t: TY[tn] || this.types.get(tn) || TY.int, v }; }
    const pv = PREDEF[name];
    if (pv) return { k: 'v', t: TY[pv[0]], get: pv[1] };
    return null;
  }
  local(name, t, at, ref) {
    const sc = this.scopes[this.scopes.length - 1];
    if (sc.has(name)) throw err('E307', name + ' is already defined in this block.', at);
    const s = { k: 'l', t, slot: this.fn.nslots++, ref: !!ref, name };
    sc.set(name, s);
    return s;
  }

  // ---------- functions ----------
  compileFn(f) {
    if (f.proto) throw err('E312', 'The function ' + f.name + ' is declared but never defined.', f);
    if (f.body || f.compiling) return;
    f.compiling = true;
    const saveFn = this.fn, saveSc = this.scopes, saveL = [this.loop, this.sw];
    this.fn = f; f.nslots = 1; this.loop = 0; this.sw = 0;   // slot 0 = return value; loops never reach into a called function
    this.scopes = [new Map()];
    f.params.forEach((p) => { p.slot = this.local(p.name, p.t, p, p.ref && !p.t.arr && !p.t.st).slot; });
    f.defs = f.params.map((p) => (p.def ? (() => { const e = this.expr(p.def); const cv = convFn(e.t, p.t, p.def); return wrapConv(e.f, cv); })() : null));
    const body = this.block(f.ast.body, true);
    const retT = f.ret;
    f.body = body;
    f.checkRet = retT.n !== 'void';
    this.fn = saveFn; this.scopes = saveSc; [this.loop, this.sw] = saveL;
    f.compiling = false;
  }
  // pick the overload for a call (exact match 0, promotion 1, conversion 2 per argument)
  pick(name, args, at) {
    const list = this.funcs.get(name);
    let best = null, bestScore = Infinity, tie = false;
    for (const f of list) {
      if (f.tparams) { const g = this.instantiate(f, args, at); if (g) { const s = this.score(g, args); if (s < bestScore) { best = g; bestScore = s; tie = false; } } continue; }
      const s = this.score(f, args);
      if (s < bestScore) { best = f; bestScore = s; tie = false; } else if (s === bestScore && s < Infinity) tie = true;
    }
    if (!best || bestScore === Infinity) {
      const f = list[0];
      if (list.length === 1 && f.params) {
        const need = f.params.filter((p) => !p.def).length;
        if (args.length < need || args.length > f.params.length) throw err('E313', name + ' takes ' + (need === f.params.length ? need : need + ' to ' + f.params.length) + ' argument' + (f.params.length === 1 ? '' : 's') + ', not ' + args.length + '.', at);
      }
      throw err('E314', 'No version of ' + name + ' accepts (' + args.map((a) => tname(a.t)).join(', ') + ').', at);
    }
    if (tie && list.length > 1) { /* the first declared wins, as the terminal's compiler warns */ }
    return best;
  }
  score(f, args) {
    if (!f.params || args.length > f.params.length) return Infinity;
    let s = 0;
    for (let i = 0; i < f.params.length; i++) {
      const p = f.params[i], a = args[i];
      if (!a || a.skip) { if (!p.def) return Infinity; continue; }
      if (p.t.arr) { if (!a.t.arr) return Infinity; if (a.t.elem.n !== p.t.elem.n && !(isNum(a.t.elem) && isNum(p.t.elem) && kindOf(a.t.elem) === kindOf(p.t.elem))) return Infinity; continue; }
      if (p.t.st) { if (a.t.st !== p.t.st) return Infinity; continue; }
      if (a.t.arr || a.t.st) return Infinity;
      if (p.ref && !a.lv) return Infinity;
      if (a.t.n === p.t.n) continue;
      const ka = kindOf(a.t), kp = kindOf(p.t);
      if (ka === 's' || kp === 's') { if (ka !== kp) s += 3; continue; }
      if (ka === kp) { s += 1; continue; }
      s += RANK[kp] > RANK[ka] ? 1 : 2;
    }
    return s;
  }
  instantiate(f, args, at) {
    const bind = new Map();
    const ps = f.ast.params;
    for (let i = 0; i < ps.length && i < args.length; i++) {
      const pn = ps[i].type.name;
      if (!f.tparams.includes(pn) || !args[i] || args[i].skip) continue;
      const at2 = args[i].t.arr && ps[i].dims.length ? args[i].t.elem : args[i].t;
      if (bind.has(pn) && bind.get(pn).n !== at2.n) return null;
      bind.set(pn, at2);
    }
    if (f.tparams.some((n) => !bind.has(n))) return null;
    const key = f.tparams.map((n) => bind.get(n).n).join(',');
    if (f.inst.has(key)) return f.inst.get(key);
    const save = this.tbind; this.tbind = bind;
    const d = f.ast;
    const g = { name: f.name, ast: d, ret: this.resolveType(d.ret), params: d.params.map((p) => ({ name: p.name, t: this.resolveType(p.type, p.dims), ref: p.ref, def: p.def, line: p.line, col: p.col })), body: null, nslots: 0, line: d.line };
    f.inst.set(key, g);
    const saveFn = this.fn, saveSc = this.scopes;
    this.compileFn(g);
    this.fn = saveFn; this.scopes = saveSc;
    this.tbind = save;
    return g;
  }
  // a JS function that calls user function f with already evaluated values (entry points: OnInit, OnCalculate ...)
  invoker(f) {
    const R = this.R;
    return (vals) => {
      const F = new Array(f.nslots);
      f.params.forEach((p, i) => {
        let v = vals[i];
        if (v === undefined && f.defs[i]) v = f.defs[i](null);
        if (p.ref && !p.t.arr && !p.t.st && !(v instanceof Ref)) { const cell = [v]; v = new Ref(() => cell[0], (x) => { cell[0] = x; }); }
        F[p.slot] = v;
      });
      R.depth = 0;
      f.body(F);
      return F[0];
    };
  }

  // ---------- statements ----------
  block(b, fnBody) {
    if (!fnBody) this.scopes.push(new Map());
    const list = b.body.map((s) => this.stmt(s)).filter(Boolean);
    if (!fnBody) this.scopes.pop();
    const n = list.length;
    if (n === 0) return () => 0;
    if (n === 1) return list[0];
    if (n === 2) { const [a, c] = list; return (F) => a(F) || c(F); }
    return (F) => { for (let i = 0; i < n; i++) { const r = list[i](F); if (r) return r; } return 0; };
  }
  stmt(s) {
    const R = this.R;
    switch (s.k) {
      case 'block': return this.block(s);
      case 'empty': return null;
      case 'expr': { const e = this.expr(s.e).f; return (F) => { e(F); return 0; }; }
      case 'decl': return this.localDecl(s);
      case 'if': {
        const c = this.truth(s.c), a = this.stmt(s.a) || (() => 0), b = s.b ? this.stmt(s.b) || (() => 0) : null;
        return b ? (F) => (c(F) ? a(F) : b(F)) : (F) => (c(F) ? a(F) : 0);
      }
      case 'while': {
        const c = this.truth(s.c), line = s.line;
        this.loop++; const body = this.stmt(s.body) || (() => 0); this.loop--;
        return (F) => { while (c(F)) { if (--R.ops < 0) R.slice(line); const r = body(F); if (r === BRK) break; if (r === RET) return r; } return 0; };
      }
      case 'do': {
        const c = this.truth(s.c), line = s.line;
        this.loop++; const body = this.stmt(s.body) || (() => 0); this.loop--;
        return (F) => { do { if (--R.ops < 0) R.slice(line); const r = body(F); if (r === BRK) break; if (r === RET) return r; } while (c(F)); return 0; };
      }
      case 'for': {
        this.scopes.push(new Map());
        const init = s.init ? (s.init.k === 'decl' ? this.localDecl(s.init) : ((e) => (F) => { e(F); return 0; })(this.expr(s.init.e).f)) : null;
        const c = s.c ? this.truth(s.c) : null, step = s.step ? this.expr(s.step).f : null, line = s.line;
        this.loop++; const body = this.stmt(s.body) || (() => 0); this.loop--;
        this.scopes.pop();
        return (F) => {
          if (init) init(F);
          for (;;) {
            if (c && !c(F)) break;
            if (--R.ops < 0) R.slice(line);
            const r = body(F);
            if (r === BRK) break;
            if (r === RET) return r;
            if (step) step(F);
          }
          return 0;
        };
      }
      case 'switch': {
        const e = this.expr(s.e);
        if (!(isNum(e.t) || kindOf(e.t) === 's')) throw err('E315', 'switch needs a whole number.', s.e);
        const map = new Map(); let dflt = -1;
        this.sw++;
        const bodies = s.cases.map((c, i) => {
          if (c.test) { const v = this.constOf(c.test); if (map.has(v)) throw err('E316', 'This case value is used twice.', c.test); map.set(v, i); } else dflt = i;
          this.scopes.push(new Map());
          const b = c.body.map((x) => this.stmt(x)).filter(Boolean);
          this.scopes.pop();
          return b;
        });
        this.sw--;
        const flat = [], starts = [];
        bodies.forEach((b) => { starts.push(flat.length); flat.push(...b); });
        const ef = e.f, n = flat.length;
        return (F) => {
          const v = ef(F);
          const ci = map.has(v) ? map.get(v) : dflt;
          if (ci < 0) return 0;
          for (let i = starts[ci]; i < n; i++) { const r = flat[i](F); if (r === BRK) return 0; if (r) return r; }
          return 0;
        };
      }
      case 'break': if (!this.loop && !this.sw) throw err('E317', 'break outside a loop or switch.', s); return () => BRK;
      case 'continue': if (!this.loop) throw err('E317', 'continue outside a loop.', s); return () => CONT;
      case 'return': {
        const f = this.fn, rt = f.ret;
        if (!s.e) { if (rt.n !== 'void') throw err('E318', f.name + ' must return a ' + tname(rt) + ' value.', s); return () => RET; }
        if (rt.n === 'void') { const e = this.expr(s.e).f; return (F) => { e(F); return RET; }; }
        const e = this.expr(s.e);
        const cv = rt.st ? null : convFn(e.t, rt, s.e);
        if (rt.st) { const g = e.f; return (F) => { F[0] = cloneVal(g(F)); return RET; }; }
        const g = wrapConv(e.f, cv);
        return (F) => { F[0] = g(F); return RET; };
      }
      default: throw err('E319', 'This statement is not supported.', s);
    }
  }
  localDecl(s) {
    const R = this.R, out = [];
    for (const v of s.decls) {
      const t = this.resolveType(s.type, v.dims);
      const init = this.initOf(t, v, false);
      if (s.static) {
        const gs = this.nG++, flag = this.nG++;
        const sym = { k: 'g', t, slot: gs, ro: !!s.type.const, name: v.name };
        this.scopes[this.scopes.length - 1].set(v.name, sym);
        const f = init.f;
        this.inits.push(() => { R.G[flag] = false; });
        out.push((F) => { if (!R.G[flag]) { R.G[flag] = true; R.G[gs] = f(F); } return 0; });
        continue;
      }
      const f = init.f;
      const sym = this.local(v.name, t, v);
      sym.ro = !!s.type.const;
      const slot = sym.slot;
      if (init.c !== undefined) { const c = init.c; out.push((F) => { F[slot] = c; return 0; }); }
      else out.push((F) => { F[slot] = f(F); return 0; });
    }
    if (out.length === 1) return out[0];
    return (F) => { for (const o of out) o(F); return 0; };
  }
  truth(e) {
    const x = this.expr(e);
    const k = kindOf(x.t);
    if (k === 'b') return x.f;
    if (k === 's') { const f = x.f; return (F) => f(F) !== ''; }
    if (k === 'x') throw err('E320', 'A ' + tname(x.t) + ' cannot be used as a condition.', e);
    const f = x.f; return (F) => f(F) !== 0;
  }

  // ---------- expressions: { t, f(F), c?, lv? } ----------
  expr(e) {
    switch (e.k) {
      case 'num': {
        if (e.lk === 'dt') return { t: TY.datetime, f: () => e.v, c: e.v };
        if (e.lk === 'color') return { t: TY.color, f: () => e.v, c: e.v };
        if (e.lk === 'char') return { t: TY.ushort, f: () => e.v, c: e.v };
        const t = e.f ? TY.double : e.v > 2147483647 || e.v < -2147483648 ? TY.long : TY.int;
        return { t, f: () => e.v, c: e.v };
      }
      case 'str': return { t: TY.string, f: () => e.v, c: e.v };
      case 'bool': return { t: TY.bool, f: () => e.v, c: e.v };
      case 'id': return this.ident(e);
      case 'scope': return this.ident(e);
      case 'bin': return this.bin(e);
      case 'un': return this.unary(e);
      case 'pre': case 'post': return this.incdec(e);
      case 'assign': return this.assign(e);
      case 'cond': {
        const c = this.truth(e.c), a = this.expr(e.a), b = this.expr(e.b);
        let t;
        if (kindOf(a.t) === 's' || kindOf(b.t) === 's') t = TY.string;
        else if (isNum(a.t) && isNum(b.t)) t = a.t.n === b.t.n ? a.t : KT[promote(a.t, b.t)];
        else if (a.t.st && a.t.st === b.t.st) t = a.t;
        else throw err('E321', 'Both sides of ? : need the same kind of value.', e);
        const fa = wrapConv(a.f, t.st ? null : convFn(a.t, t, e.a)), fb = wrapConv(b.f, t.st ? null : convFn(b.t, t, e.b));
        const cc = this.expr(e.c);
        if (cc.c !== undefined && a.c !== undefined && b.c !== undefined) { const v = cc.c ? fa(null) : fb(null); return { t, f: () => v, c: v }; }
        return { t, f: (F) => (c(F) ? fa(F) : fb(F)) };
      }
      case 'cast': {
        const a = this.expr(e.a), t = this.resolveType(e.type);
        const cv = convFn(a.t, t, e);
        const f = wrapConv(a.f, cv);
        if (a.c !== undefined) { const v = f(null); return { t, f: () => v, c: v }; }
        return { t, f };
      }
      case 'idx': return this.index(e);
      case 'mem': return this.member(e);
      case 'call': return this.call(e);
      case 'comma': { const xs = e.list.map((x) => this.expr(x)), fs = xs.map((x) => x.f), last = xs[xs.length - 1]; return { t: last.t, f: (F) => { let v; for (const f of fs) v = f(F); return v; } }; }
      case 'sizeof': {
        const SZ = { bool: 1, char: 1, uchar: 1, short: 2, ushort: 2, int: 4, uint: 4, color: 4, float: 4, long: 8, ulong: 8, datetime: 8, double: 8, string: 12 };
        let t = e.arg.type ? (TY[e.arg.type] || this.types.get(e.arg.type)) : this.expr(e.arg.e).t;
        let v = t.arr ? 52 : t.st ? t.st.fields.reduce((s, f) => s + (SZ[f.t.n] || 8), 0) : t.en ? 4 : SZ[t.n] || 8;
        return { t: TY.int, f: () => v, c: v };
      }
      case 'list': throw err('E311', '{ ... } can only be used to initialise an array or struct.', e);
      case 'skip': throw err('E322', 'An argument is missing.', e);
      default: throw err('E323', 'This expression is not supported.', e);
    }
  }
  ident(e) {
    const s = this.lookup(e.name);
    if (!s) {
      if (this.funcs.has(e.name) || BUILTINS.has(e.name)) throw err('E324', e.name + ' is a function: call it with ( ).', e);
      if (UNSUPPORTED.has(e.name)) throw err('E290', e.name + ' is not supported in indicators on TradeZoro.', e, UNSUPPORTED_WHY[UNSUPPORTED.get(e.name)]);
      throw err('E325', 'Unknown name ' + e.name + '.', e, hintFor(e.name, this));
    }
    const R = this.R;
    if (s.k === 'c') return { t: s.t, f: () => s.v, c: s.v };
    if (s.k === 'v') { const g = s.get; return { t: s.t, f: () => g(R) }; }
    if (s.k === 'g') {
      const slot = s.slot, G = () => R.G;
      return { t: s.t, f: () => R.G[slot], lv: { ro: s.ro, name: s.name, get: () => R.G[slot], set: (F, v) => (R.G[slot] = v), ref: () => new Ref(() => R.G[slot], (v) => { R.G[slot] = v; }), G } };
    }
    const slot = s.slot;
    if (s.ref) return { t: s.t, f: (F) => F[slot].get(), lv: { ro: s.ro, name: s.name, get: (F) => F[slot].get(), set: (F, v) => F[slot].set(v), ref: (F) => F[slot] } };
    return { t: s.t, f: (F) => F[slot], lv: { ro: s.ro, name: s.name, get: (F) => F[slot], set: (F, v) => (F[slot] = v), ref: (F) => new Ref(() => F[slot], (v) => { F[slot] = v; }) } };
  }
  index(e) {
    // collect a[i][j]... down to the array
    const idx = []; let base = e;
    while (base.k === 'idx') { idx.unshift(base.i); base = base.a; }
    const b = this.expr(base);
    if (!b.t.arr) {
      if (kindOf(b.t) === 's') throw err('E326', 'Strings are not indexed with [ ]: use StringGetCharacter(s, i).', e);
      throw err('E326', 'Only arrays can be indexed with [ ].', e);
    }
    const nd = b.t.dims.length;
    if (idx.length !== nd) throw err('E327', 'This array has ' + nd + ' dimension' + (nd === 1 ? '' : 's') + '; give ' + nd + ' index' + (nd === 1 ? '' : 'es') + '.', e);
    const ix = idx.map((x) => { const r = this.expr(x); if (!isNum(r.t)) throw err('E328', 'An array index must be a number.', x); return kindOf(r.t) === 'd' ? ((g) => (F) => Math.trunc(g(F)))(r.f) : r.f; });
    const af = b.f, line = e.line, t = b.t.elem, ro = !!(b.lv && b.lv.ro);
    if (nd === 1) {
      const i0 = ix[0];
      return { t, f: (F) => af(F).get(i0(F), line), lv: { ro, name: 'element',
        get: (F) => af(F).get(i0(F), line), set: (F, v) => af(F).set(i0(F), v, line),
        loc: (F) => { const a = af(F); if (a.ro) throw rtErr('This array is read-only.', line); return [a.d, a.pi(i0(F), line)]; },
        ref: (F) => { const a = af(F), p = a.pi(i0(F), line); return new Ref(() => a.d[p], (v) => { if (a.ro) throw rtErr('This array is read-only.', line); a.d[p] = v; }); } } };
    }
    const off = (F) => { const a = af(F); return [a, a.off(ix.map((g) => g(F)), line)]; };
    return { t, f: (F) => { const [a, o] = off(F); return a.d[o]; }, lv: { ro, name: 'element',
      get: (F) => { const [a, o] = off(F); return a.d[o]; }, set: (F, v) => { const [a, o] = off(F); return (a.d[o] = v); },
      loc: (F) => { const [a, o] = off(F); return [a.d, o]; },
      ref: (F) => { const [a, o] = off(F); return new Ref(() => a.d[o], (v) => { a.d[o] = v; }); } } };
  }
  member(e) {
    const b = this.expr(e.a);
    if (!b.t.st) throw err('E329', 'Only structs have fields (.' + e.name + ').', e);
    const k = b.t.st.index.get(e.name);
    if (k === undefined) throw err('E330', b.t.n + ' has no field ' + e.name + '.', e, 'Fields: ' + b.t.st.fields.map((f) => f.name).join(', ') + '.');
    const t = b.t.st.fields[k].t, bf = b.f, ro = !!(b.lv && b.lv.ro);
    return { t, f: (F) => bf(F)[k], lv: { ro, name: e.name, get: (F) => bf(F)[k], set: (F, v) => (bf(F)[k] = v), loc: (F) => [bf(F), k], ref: (F) => { const o = bf(F); return new Ref(() => o[k], (v) => { o[k] = v; }); } } };
  }
  needLv(x, e) {
    if (!x.lv) throw err('E331', 'This cannot be assigned to.', e);
    if (x.lv.ro) throw err('E332', (x.lv.name && x.lv.name !== 'element' ? x.lv.name : 'This value') + ' is read-only (an input or a constant).', e, x.lv.name ? 'Copy the input into a variable first.' : '');
    return x.lv;
  }
  // arithmetic on kind k
  arith(op, k, line) {
    const R = this.R;
    const zero = () => { throw rtErr('Zero divide.', line, 'E404'); };
    switch (k) {
      case 'd': return { '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b, '%': (a, b) => a % b }[op];
      case 'i': return { '+': (a, b) => (a + b) | 0, '-': (a, b) => (a - b) | 0, '*': (a, b) => Math.imul(a, b), '/': (a, b) => (b === 0 ? zero() : (a / b) | 0), '%': (a, b) => (b === 0 ? zero() : a % b | 0),
        '&': (a, b) => a & b, '|': (a, b) => a | b, '^': (a, b) => a ^ b, '<<': (a, b) => a << b, '>>': (a, b) => a >> b }[op];
      case 'u': return { '+': (a, b) => (a + b) >>> 0, '-': (a, b) => (a - b) >>> 0, '*': (a, b) => Math.imul(a, b) >>> 0, '/': (a, b) => (b === 0 ? zero() : Math.floor((a >>> 0) / (b >>> 0)) >>> 0), '%': (a, b) => (b === 0 ? zero() : (a >>> 0) % (b >>> 0)),
        '&': (a, b) => (a & b) >>> 0, '|': (a, b) => (a | b) >>> 0, '^': (a, b) => (a ^ b) >>> 0, '<<': (a, b) => (a << b) >>> 0, '>>': (a, b) => a >>> b }[op];
      case 'l': return { '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => (b === 0 ? zero() : Math.trunc(a / b)), '%': (a, b) => (b === 0 ? zero() : a % b),
        '&': (a, b) => big(a, b, '&'), '|': (a, b) => big(a, b, '|'), '^': (a, b) => big(a, b, '^'), '<<': (a, b) => a * 2 ** b, '>>': (a, b) => Math.floor(a / 2 ** b) }[op];
      default: return null;
    }
  }
  bin(e) {
    const op = e.op;
    if (op === '&&' || op === '||') {
      const a = this.truth(e.a), b = this.truth(e.b);
      return { t: TY.bool, f: op === '&&' ? (F) => a(F) && b(F) : (F) => a(F) || b(F) };
    }
    const A = this.expr(e.a), B = this.expr(e.b);
    if (A.t.arr || B.t.arr || A.t.st || B.t.st) throw err('E333', 'Operator ' + op + ' cannot be used on ' + tname(A.t.arr || A.t.st ? A.t : B.t) + '.', e);
    if (A.t.n === 'void' || B.t.n === 'void') throw err('E333', 'A function that returns nothing (void) has no value.', e);
    const isCmp = ['==', '!=', '<', '<=', '>', '>='].includes(op);
    let k = promote(A.t, B.t);
    if ((op === '<<' || op === '>>') && kindOf(A.t) !== 'd') k = kindOf(A.t) === 'b' ? 'i' : kindOf(A.t);
    if (k === 's' && !isCmp && op !== '+') throw err('E333', 'Operator ' + op + ' cannot be used on strings.', e);
    if (k === 'd' && ['&', '|', '^', '<<', '>>'].includes(op)) throw err('E333', 'Operator ' + op + ' needs whole numbers, not double.', e);
    const ct = KT[k];
    const fa = wrapConv(A.f, convFn(A.t, ct, e.a)), fb = wrapConv(B.f, convFn(B.t, ct, e.b));
    let f, t;
    if (isCmp) {
      t = TY.bool;
      f = { '==': (F) => fa(F) === fb(F), '!=': (F) => fa(F) !== fb(F), '<': (F) => fa(F) < fb(F), '<=': (F) => fa(F) <= fb(F), '>': (F) => fa(F) > fb(F), '>=': (F) => fa(F) >= fb(F) }[op];
      if (k === 'd' && (op === '==' || op === '!=')) { /* plain IEEE compare, as the terminal */ }
    } else if (k === 's') { t = TY.string; f = (F) => { const s = fa(F) + fb(F); if (s.length > LIMITS.maxString) throw rtErr('A string is longer than 1 million characters.', e.line, 'E402'); return s; }; }
    else {
      const g = this.arith(op, k, e.line);
      if (!g) throw err('E333', 'Operator ' + op + ' is not supported here.', e);
      t = ct.n === 'int' && A.t.n === B.t.n && (A.t.n === 'datetime' || A.t.n === 'color') ? A.t : (k === 'l' && (A.t.n === 'datetime' || B.t.n === 'datetime') && op !== '-' ? TY.datetime : ct);
      f = (F) => g(fa(F), fb(F));
    }
    if (A.c !== undefined && B.c !== undefined) { const v = f(null); return { t, f: () => v, c: v }; }
    return { t, f };
  }
  unary(e) {
    const a = this.expr(e.a);
    if (e.op === '!') { const g = this.truth(e.a); if (a.c !== undefined) { const v = !g(null); return { t: TY.bool, f: () => v, c: v }; } return { t: TY.bool, f: (F) => !g(F) }; }
    if (!isNum(a.t)) throw err('E333', 'Operator ' + e.op + ' needs a number.', e);
    const k = kindOf(a.t) === 'b' ? 'i' : kindOf(a.t), t = k === 'i' && !a.t.en && a.t.n !== 'bool' ? a.t : KT[k];
    const fa = wrapConv(a.f, convFn(a.t, KT[k], e.a));
    let f;
    if (e.op === '-') f = k === 'i' ? (F) => -fa(F) | 0 : k === 'u' ? (F) => -fa(F) >>> 0 : (F) => -fa(F);
    else if (e.op === '+') f = fa;
    else { if (k === 'd') throw err('E333', 'Operator ~ needs a whole number.', e); f = k === 'u' ? (F) => ~fa(F) >>> 0 : (F) => ~fa(F); }
    if (a.c !== undefined) { const v = f(null); return { t, f: () => v, c: v }; }
    return { t, f };
  }
  incdec(e) {
    const x = this.expr(e.a), lv = this.needLv(x, e.a);
    if (!isNum(x.t)) throw err('E333', e.op + ' needs a number.', e);
    const k = kindOf(x.t), d = e.op === '++' ? 1 : -1, cv = convFn(KT[k === 'b' ? 'i' : k], x.t, e) || ((v) => v);
    const step = k === 'i' ? (v) => cv((v + d) | 0) : k === 'u' ? (v) => (v + d) >>> 0 : (v) => v + d;
    const pre = e.k === 'pre';
    if (lv.loc) { const loc = lv.loc; return { t: x.t, f: (F) => { const [o, i] = loc(F), old = o[i], nv = step(old); o[i] = nv; return pre ? nv : old; } }; }
    const get = lv.get, set = lv.set;
    return { t: x.t, f: (F) => { const old = get(F), nv = step(old); set(F, nv); return pre ? nv : old; } };
  }
  assign(e) {
    const x = this.expr(e.a), lv = this.needLv(x, e.a), y = this.expr(e.b);
    const t = x.t;
    if (t.arr) {
      if (e.op !== '=' || !y.t.arr) throw err('E334', 'Arrays are copied with ArrayCopy(dst, src).', e);
      const g = x.f, h = y.f, line = e.line;
      return { t, f: (F) => { const d = g(F), s = h(F); if (d === s) return d; if (d.ro) throw rtErr('This array is read-only.', line); d.resize(s.n, line); for (let i = 0; i < s.d.length; i++) d.d[i] = cloneVal(s.d[i]); return d; } };
    }
    if (t.st) {
      if (e.op !== '=') throw err('E333', 'Operator ' + e.op + ' cannot be used on a struct.', e);
      convFn(y.t, t, e);
      const g = x.f, h = y.f;
      return { t, f: (F) => copyInto(g(F), h(F)) };
    }
    if (e.op === '=') {
      const cv = convFn(y.t, t, e.b), h = wrapConv(y.f, cv), set = lv.set;
      return { t, f: (F) => set(F, h(F)) };
    }
    const op = e.op.slice(0, -1);
    let k = promote(t, y.t);
    if (op === '<<' || op === '>>') k = kindOf(t) === 'b' ? 'i' : kindOf(t);
    if (k === 's' && op !== '+') throw err('E333', 'Operator ' + e.op + ' cannot be used on strings.', e);
    const ct = KT[k];
    const g = k === 's' ? (a, b) => a + b : this.arith(op, k, e.line);
    if (!g) throw err('E333', 'Operator ' + e.op + ' is not supported here.', e);
    const ca = convFn(t, ct, e) || ((v) => v), cb = wrapConv(y.f, convFn(y.t, ct, e.b)), back = convFn(ct, t, e) || ((v) => v);
    if (lv.loc) { const loc = lv.loc; return { t, f: (F) => { const b = cb(F), [o, i] = loc(F); return (o[i] = back(g(ca(o[i]), b))); } }; }
    const get = lv.get, set = lv.set;
    return { t, f: (F) => { const b = cb(F); return set(F, back(g(ca(get(F)), b))); } };
  }

  // ---------- calls ----------
  call(e) {
    const name = e.name;
    if (!e.global && this.funcs.has(name)) return this.userCall(e);
    const b = BUILTINS.get(name);
    if (!b) {
      if (this.funcs.has(name)) return this.userCall(e);
      const why = UNSUPPORTED.get(name);
      if (why) throw err('E290', name + ' is not supported in indicators on TradeZoro.', e, UNSUPPORTED_WHY[why]);
      throw err('E335', 'Unknown function ' + name + '.', e, hintFor(name, this, true));
    }
    this.uses.add(name);
    if (Array.isArray(b)) {
      // overloads by argument count (and, for equal counts, the first whose by-reference slots get variables)
      const n = e.args.length;
      const fits = b.filter((d) => n >= d.min && (d.va || n <= d.ps.length));
      const pick = fits.find((d) => d.ps.every((p, i) => !p.ref || !e.args[i] || ['id', 'idx', 'mem'].includes(e.args[i].k))) || fits[0] || b[0];
      return this.builtinCall(e, pick);
    }
    return this.builtinCall(e, b);
  }
  userCall(e) {
    const R = this.R;
    const args = e.args.map((a) => (a.k === 'skip' ? { skip: true } : this.expr(a)));
    const f = this.pick(e.name, args, e);
    if (!f.body && !f.compiling && !f.tparams) this.compileFn(f);
    const ps = f.params;
    const getters = ps.map((p, i) => {
      const a = args[i];
      if (!a || a.skip) {
        if (!p.def) throw err('E313', 'Argument ' + (i + 1) + ' of ' + f.name + ' is missing.', e);
        const ex = this.expr(p.def); return wrapConv(ex.f, convFn(ex.t, p.t, p.def));
      }
      if (p.t.arr || p.t.st) { if (!a.lv && p.ref && !p.ast) { /* temporary passed by ref: allowed for const & */ } return a.f; }
      if (p.ref) {
        if (!a.lv) throw err('E336', 'Argument ' + (i + 1) + ' of ' + f.name + ' is passed by reference, so it must be a variable.', e.args[i]);
        if (a.t.n !== p.t.n && !(a.t.en && p.t.en && a.t.n === p.t.n)) throw err('E336', 'Argument ' + (i + 1) + ' of ' + f.name + ' must be a ' + tname(p.t) + ' variable (passed by reference).', e.args[i]);
        return a.lv.ref;
      }
      return wrapConv(a.f, convFn(a.t, p.t, e.args[i]));
    });
    const slots = ps.map((p) => p.slot), n = ps.length, line = e.line;
    const enter = (F) => {
      if (++R.depth > LIMITS.maxDepth) throw rtErr('Too many nested calls (deeper than ' + LIMITS.maxDepth + '). Check for a function that calls itself without end.', line, 'E405');
      if (--R.ops < 0) R.slice(line);
      const NF = new Array(f.nslots);
      for (let i = 0; i < n; i++) NF[slots[i] === undefined ? ps[i].slot : slots[i]] = getters[i](F);
      return NF;
    };
    return { t: f.ret, f: (F) => { const NF = enter(F); f.body(NF); R.depth--; return NF[0]; } };
  }
  builtinCall(e, b) {
    const R = this.R;
    const argsAst = e.args;
    const ps = b.ps;
    if (!b.va && argsAst.length > ps.length) throw err('E313', e.name + ' takes at most ' + ps.length + ' argument' + (ps.length === 1 ? '' : 's') + ', not ' + argsAst.length + '.', e);
    if (argsAst.length < b.min) throw err('E313', e.name + ' needs ' + (b.min === ps.length || b.va ? 'at least ' + b.min : b.min + ' to ' + ps.length) + ' argument' + (b.min === 1 ? '' : 's') + '.', e, 'Usage: ' + b.sig);
    const types = [];
    const getters = [];
    for (let i = 0; i < Math.max(argsAst.length, ps.length); i++) {
      const p = ps[i] || b.va, a = argsAst[i];
      if (!a || a.k === 'skip') { if (!ps[i] || ps[i].def === undefined) throw err('E322', 'Argument ' + (i + 1) + ' of ' + e.name + ' is missing.', e); const d = ps[i].def; types.push(TY[ps[i].t] || TY.int); getters.push(() => d); continue; }
      const x = this.expr(a);
      types.push(x.t);
      if (p.anyv) { getters.push(x.t.arr || x.t.st ? x.f : x.lv && !x.lv.ro ? x.lv.ref : x.f); continue; }
      if (p.arr) {
        if (!x.t.arr) throw err('E337', 'Argument ' + (i + 1) + ' of ' + e.name + ' must be an array.', a, 'Usage: ' + b.sig);
        if (p.t !== 'any' && !compatElem(x.t.elem, p.t)) throw err('E337', 'Argument ' + (i + 1) + ' of ' + e.name + ' must be a ' + p.t + ' array, not ' + tname(x.t) + '.', a, 'Usage: ' + b.sig);
        if (p.w && x.lv && x.lv.ro) throw err('E332', 'Argument ' + (i + 1) + ' of ' + e.name + ' is read-only (an input array of OnCalculate).', a);
        getters.push(x.f); continue;
      }
      if (p.st) {
        if (!x.t.st || (p.t !== 'any' && x.t.n !== p.t)) throw err('E337', 'Argument ' + (i + 1) + ' of ' + e.name + ' must be a ' + p.t + ' struct.', a, 'Usage: ' + b.sig);
        getters.push(x.f); continue;
      }
      if (p.ref) {
        if (!x.lv) throw err('E336', 'Argument ' + (i + 1) + ' of ' + e.name + ' must be a variable (it receives a value).', a, 'Usage: ' + b.sig);
        if (x.lv.ro) throw err('E332', 'Argument ' + (i + 1) + ' of ' + e.name + ' is read-only.', a);
        getters.push(x.lv.ref); continue;
      }
      if (x.t.arr || x.t.st) throw err('E337', 'Argument ' + (i + 1) + ' of ' + e.name + ' cannot be an ' + (x.t.arr ? 'array' : 'struct') + '.', a, 'Usage: ' + b.sig);
      if (p === 'str' || p.t === 'str') { getters.push(wrapConv(x.f, convFn(x.t, TY.string, a))); continue; }
      if (p.t === 'any' || p === 'any') { getters.push(x.f); continue; }
      if (p.t === 'num') { if (!isNum(x.t)) throw err('E337', 'Argument ' + (i + 1) + ' of ' + e.name + ' must be a number.', a, 'Usage: ' + b.sig); getters.push(kindOf(x.t) === 'b' ? ((g) => (F) => +g(F))(x.f) : x.f); continue; }
      const pt = TY[p.t] || this.types.get(p.t) || TY.int;
      getters.push(wrapConv(x.f, convFn(x.t, pt, a)));
    }
    const rr = typeof b.ret === 'function' ? b.ret(types, this) : b.ret;
    const ret = typeof rr === 'string' ? TY[rr] || this.types.get(rr) || TY.int : rr;
    const fn = b.f, line = e.line, n = getters.length;
    const T = b.types ? types : null;
    const [g0, g1, g2, g3, g4, g5] = getters;
    let f;
    if (T) f = (F) => { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = getters[i](F); return fn(R, line, T, ...a); };
    else switch (n) {
      case 0: f = () => fn(R, line); break;
      case 1: f = (F) => fn(R, line, g0(F)); break;
      case 2: f = (F) => fn(R, line, g0(F), g1(F)); break;
      case 3: f = (F) => fn(R, line, g0(F), g1(F), g2(F)); break;
      case 4: f = (F) => fn(R, line, g0(F), g1(F), g2(F), g3(F)); break;
      case 5: f = (F) => fn(R, line, g0(F), g1(F), g2(F), g3(F), g4(F)); break;
      case 6: f = (F) => fn(R, line, g0(F), g1(F), g2(F), g3(F), g4(F), g5(F)); break;
      default: f = (F) => { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = getters[i](F); return fn(R, line, ...a); };
    }
    // pure maths on constants folds at compile time (MathMax(3, 4) as an array size)
    if (b.pure && argsAst.length && getters.length === argsAst.length) {
      const xs = argsAst.map((a) => this.expr(a));
      if (xs.every((x) => x.c !== undefined)) { const v = f(null); return { t: ret, f: () => v, c: v }; }
    }
    return { t: ret, f };
  }

  // ---------- entry points + meta ----------
  entries() {
    const one = (n) => { const l = this.funcs.get(n); return l && l.find((f) => !f.proto && !f.tparams); };
    const calc = one('OnCalculate');
    if (!calc) throw err('E340', 'An indicator needs an OnCalculate function.', { line: 1, col: 1 }, 'Add: int OnCalculate(const int rates_total, const int prev_calculated, const int begin, const double &price[]) { ... return rates_total; }');
    if (calc.params.length !== 10 && calc.params.length !== 4) throw err('E341', 'OnCalculate must have the 4-parameter (price[]) or the 10-parameter (time, open, high, low, close ...) form.', calc);
    if (calc.ret.n !== 'int') throw err('E341', 'OnCalculate must return an int (usually rates_total).', calc);
    this.calc = calc; this.calcForm = calc.params.length === 10 ? 'full' : 'price';
    this.onInit = one('OnInit'); this.onDeinit = one('OnDeinit'); this.onTimer = one('OnTimer'); this.onEvent = one('OnChartEvent');
    if (this.onEvent && this.onEvent.params.length !== 4) throw err('E341', 'OnChartEvent takes (const int id, const long &lparam, const double &dparam, const string &sparam).', this.onEvent);
    if (this.onDeinit && this.onDeinit.params.length > 1) throw err('E341', 'OnDeinit takes (const int reason).', this.onDeinit);
  }
  // #property values: name -> value (constants evaluated with the same rules as code)
  properties() {
    const out = [];
    for (const p of this.pp.props) {
      let v = null;
      if (p.toks.length) {
        if (p.toks.length === 1 && p.toks[0].t === 'str') v = p.toks[0].v;
        else {
          // a comma list (indicator_color1 clrRed,clrBlue) or one constant expression
          const parts = [[]];
          for (const t of p.toks) { if (t.t === 'op' && t.v === ',') parts.push([]); else parts[parts.length - 1].push(t); }
          try {
            const vals = parts.filter((x) => x.length).map((x) => { const sub = parse({ toks: [{ t: 'id', v: 'int', line: p.line, col: 1 }, { t: 'id', v: '__p', line: p.line, col: 1 }, { t: 'op', v: '=', line: p.line, col: 1 }, ...x, { t: 'op', v: ';', line: p.line, col: 1 }, { t: 'eof', v: '', line: p.line, col: 1 }], props: [], includes: [] }, structAndEnumNames()); return this.constOf(sub.decls[0].decls[0].init); });
            v = vals.length > 1 ? vals : vals[0];
          } catch (e) { if (e instanceof MqError) throw Object.assign(e, { message: 'In #property ' + p.name + ': ' + e.message }); throw e; }
        }
      }
      out.push({ name: p.name, value: v, line: p.line });
    }
    return out;
  }
}
function compatElem(t, want) {
  if (want === 'num') return isNum(t);
  if (want === 'double') return kindOf(t) === 'd';
  if (want === 'int') return kindOf(t) === 'i' || kindOf(t) === 'u';
  if (want === 'long') return kindOf(t) === 'l' || kindOf(t) === 'i';
  return t.n === want || (want === 'string' && kindOf(t) === 's');
}
function big(a, b, op) {
  if (Number.isSafeInteger(a) && Number.isSafeInteger(b) && a >= -2147483648 && a <= 2147483647 && b >= -2147483648 && b <= 2147483647) return op === '&' ? a & b : op === '|' ? a | b : a ^ b;
  const x = BigInt(Math.trunc(a)), y = BigInt(Math.trunc(b));
  return Number(op === '&' ? x & y : op === '|' ? x | y : x ^ y);
}
const pretty = (s) => s.replace(/^(MODE|PRICE|PERIOD|STYLE|CORNER|ANCHOR|DRAW|STO|VOLUME)_/, '').toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const stepOf = (v) => { const s = String(v); const i = s.indexOf('.'); if (i < 0) return 1; const d = Math.min(8, s.length - i - 1); return +(10 ** -d).toFixed(d); };
function hexOfColor(c) { c = c >>> 0; if (c === 0xFFFFFFFF) return '#000000'; const r = c & 255, g = (c >> 8) & 255, b = (c >> 16) & 255; return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join(''); }
function colorOfHexStr(s) { const m = /^#?([0-9a-f]{6})/i.exec(s); if (!m) return 0; const h = parseInt(m[1], 16); return ((h >> 16) & 255) | (((h >> 8) & 255) << 8) | ((h & 255) << 16); }
// "did you mean" for unknown names: the closest built-in or script name by edit distance (case-insensitive first)
function hintFor(name, C, fn) {
  const low = name.toLowerCase();
  const pool = fn ? [...BUILTINS.keys(), ...C.funcs.keys()] : [...C.globals.keys(), ...Object.keys(CONSTS), ...Object.keys(PREDEF)].concat(C.scopes.flatMap((s) => [...s.keys()]));
  let best = null, bd = 3;
  for (const p of pool) {
    if (p.toLowerCase() === low) return 'Names are case-sensitive: did you mean ' + p + '?';
    if (Math.abs(p.length - name.length) > 2) continue;
    const d = lev(low, p.toLowerCase());
    if (d < bd) { bd = d; best = p; }
  }
  return best ? 'Did you mean ' + best + '?' : '';
}
function lev(a, b) {
  const m = a.length, n = b.length; if (m * n > 2500) return 9;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
// predefined variables
const PREDEF = {
  _Symbol: ['string', (R) => R.symbol], _Period: ['int', (R) => R.period], _Point: ['double', (R) => R.point], _Digits: ['int', (R) => R.digits],
  _LastError: ['int', (R) => R.lastError], _StopFlag: ['bool', (R) => false], _UninitReason: ['int', (R) => R.uninitReason], _RandomSeed: ['uint', (R) => R.seed >>> 0],
  _IsX64: ['bool', () => true], _AppliedTo: ['int', (R) => R.appliedTo || 0],
};
export const PREDEF_NAMES = Object.keys(PREDEF);
export { TY, kindOf, EMPTY_VALUE };
