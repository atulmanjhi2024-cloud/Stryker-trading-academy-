// TradeZoro MQL5 engine: parser (tokens from lexer.js -> AST). Pure.
// The subset an indicator uses: globals, input/sinput (+ input group), enums, structs (fields only), functions
// (overloads, default arguments, by-reference parameters, simple templates), the C statement set and operators.
// Classes, pointers, new/delete and operator overloading give one clear error.
import { err } from './lexer.js?v=1278';

export const BASE_TYPES = new Set(['void', 'bool', 'char', 'uchar', 'short', 'ushort', 'int', 'uint', 'long', 'ulong', 'float', 'double', 'string', 'datetime', 'color']);
const KW = new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'static', 'const', 'input', 'sinput',
  'enum', 'struct', 'class', 'true', 'false', 'template', 'typename', 'typedef', 'extern', 'delete', 'new', 'this', 'operator', 'virtual', 'public', 'private',
  'protected', 'union', 'interface', 'sizeof']);
const BIN = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '<=', '>', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);

export function parse(pp, builtinTypes) {
  const T = pp.toks, comments = pp.comments || new Map();
  let p = 0;
  const types = new Set(builtinTypes || []);
  for (let i = 0; i + 1 < T.length; i++) if (T[i].t === 'id' && (T[i].v === 'enum' || T[i].v === 'struct' || T[i].v === 'class') && T[i + 1].t === 'id') types.add(T[i + 1].v);
  let tparams = null;   // template parameter names while parsing a template function
  const isType = (v) => BASE_TYPES.has(v) || types.has(v) || (tparams && tparams.includes(v));
  const peek = (o) => T[Math.min(p + (o || 0), T.length - 1)];
  const isOp = (v, o) => { const t = peek(o); return t.t === 'op' && t.v === v; };
  const isId = (v, o) => { const t = peek(o); return t.t === 'id' && t.v === v; };
  const next = () => T[p < T.length - 1 ? p++ : p];
  const desc = (t) => (t.t === 'eof' ? 'the end of the script' : t.t === 'str' ? 'a string' : '"' + t.v + '"');
  const expect = (v, what) => { const t = peek(); if (t.t === 'op' && t.v === v) return next(); throw err('E201', 'Expected ' + (what || '"' + v + '"') + ' but found ' + desc(t) + '.', t, v === ';' ? 'A statement ends with ";".' : ''); };
  const ident = (what) => { const t = peek(); if (t.t === 'id' && !KW.has(t.v)) return next(); throw err('E202', 'Expected ' + (what || 'a name') + ' but found ' + desc(t) + '.', t); };
  const nope = (t, what) => { throw err('E290', what + ' are not supported in indicators on TradeZoro yet.', t, 'Use structs with plain fields, arrays and functions instead.'); };

  function typeSpec() {
    const at = peek();
    let isConst = false;
    while (isId('const')) { next(); isConst = true; }
    const t = next();
    if (t.t !== 'id' || !isType(t.v)) throw err('E203', 'Expected a type but found ' + desc(t) + '.', t);
    if (isOp('<') && !BASE_TYPES.has(t.v)) nope(t, 'Template classes');
    if (isOp('*')) nope(peek(), 'Pointers');
    while (isId('const')) { next(); isConst = true; }
    return { name: t.v, const: isConst, line: at.line, col: at.col };
  }
  function dims() {
    const d = [];
    while (isOp('[')) { next(); if (isOp(']')) { next(); d.push(null); continue; } d.push(expr()); expect(']'); }
    return d;
  }
  function initializer() {
    if (isOp('{')) {
      const at = next(), items = [];
      while (!isOp('}')) { items.push(initializer()); if (!isOp(',')) break; next(); }
      expect('}');
      return { k: 'list', items, line: at.line, col: at.col };
    }
    return assign();
  }
  function declarators(type, first) {
    const list = [];
    let nameTok = first;
    for (;;) {
      const nt = nameTok || ident('a variable name');
      nameTok = null;
      if (types.has(nt.v) && !BASE_TYPES.has(nt.v)) { /* shadowing a type name: allowed but rare */ }
      const d = { name: nt.v, dims: dims(), init: null, line: nt.line, col: nt.col };
      if (isOp('=')) { next(); d.init = initializer(); }
      else if (isOp('(') && !d.dims.length) { // struct constructor style: MqlDateTime dt(); -> not supported
        nope(peek(), 'Constructors');
      }
      list.push(d);
      if (!isOp(',')) break;
      next();
    }
    return list;
  }

  // ---------- top level ----------
  const decls = [];
  let group = '';
  function topLevel() {
    const t = peek();
    if (t.t === 'eof') return false;
    if (isOp(';')) { next(); return true; }
    if (t.t !== 'id') throw err('E204', 'Unexpected ' + desc(t) + ' at the top of the script.', t);
    if (t.v === 'class' || t.v === 'interface' || t.v === 'union') nope(t, t.v === 'class' ? 'Classes' : t.v === 'union' ? 'Unions' : 'Interfaces');
    if (t.v === 'typedef') nope(t, 'typedef declarations');
    if (t.v === 'enum') { decls.push(enumDecl()); return true; }
    if (t.v === 'struct') { decls.push(structDecl()); return true; }
    if (t.v === 'template') {
      next(); expect('<'); const names = [];
      for (;;) { if (!(isId('typename') || isId('class'))) throw err('E205', 'Expected typename in the template list.', peek()); next(); names.push(ident('a type parameter').v); if (!isOp(',')) break; next(); }
      expect('>');
      tparams = names;
      const f = funcOrVar(false);
      tparams = null;
      if (f.k !== 'func') throw err('E205', 'Only functions can be templates.', t);
      f.tparams = names; decls.push(f); return true;
    }
    if (t.v === 'input' || t.v === 'sinput') {
      next();
      if (isId('group')) {
        next(); const g = next();
        if (g.t !== 'str') throw err('E206', 'input group needs a title in quotes.', g);
        group = g.v; decls.push({ k: 'group', title: g.v, line: t.line }); if (isOp(';')) next();
        return true;
      }
      const ty = typeSpec(), ds = declarators(ty);
      const semi = expect(';');
      const label = comments.get(semi.line) || '';
      decls.push({ k: 'var', type: ty, decls: ds, input: t.v, group, label, line: t.line, col: t.col });
      return true;
    }
    if (t.v === 'extern') { next(); }
    decls.push(funcOrVar(true));
    return true;
  }
  function funcOrVar() {
    let isStatic = false;
    while (isId('static') || isId('virtual')) { if (peek().v === 'virtual') nope(peek(), 'Virtual functions'); next(); isStatic = true; }
    const ty = typeSpec();
    if (isOp('&')) next();   // a function returning a reference: treat as value
    const nt = ident('a name');
    if (isOp('::')) nope(nt, 'Class methods');
    if (nt.v === 'operator') nope(nt, 'Operator overloads');
    if (isOp('(')) {
      next();
      const params = [];
      if (!isOp(')')) for (;;) {
        if (isId('void') && isOp(')', 1)) { next(); break; }
        const pt = typeSpec();
        let ref = false;
        if (isOp('&')) { next(); ref = true; }
        if (isOp('*')) nope(peek(), 'Pointers');
        const pn = isOp(',') || isOp(')') || isOp('[') || isOp('=') ? { v: '_p' + params.length, line: pt.line, col: pt.col } : ident('a parameter name');
        const pd = dims();
        let def = null;
        if (isOp('=')) { next(); def = assign(); }
        params.push({ type: pt, name: pn.v, ref: ref || pd.length > 0, dims: pd, def, line: pn.line, col: pn.col });
        if (!isOp(',')) break;
        next();
      }
      expect(')');
      while (isId('const')) next();
      if (isOp(';')) { next(); return { k: 'func', ret: ty, name: nt.v, params, body: null, line: nt.line, col: nt.col }; }
      const body = block();
      return { k: 'func', ret: ty, name: nt.v, params, body, line: nt.line, col: nt.col, static: isStatic };
    }
    const ds = declarators(ty, nt);
    expect(';');
    return { k: 'var', type: ty, decls: ds, line: nt.line, col: nt.col, static: isStatic, const: ty.const };
  }
  function enumDecl() {
    const at = next(), nt = ident('an enum name');
    expect('{');
    const members = [];
    while (!isOp('}')) {
      const m = ident('an enum value');
      let value = null;
      if (isOp('=')) { next(); value = cond(); }
      const sep = peek();
      const label = comments.get(sep.t === 'op' && (sep.v === ',' || sep.v === '}') ? sep.line : m.line) || comments.get(m.line) || '';
      members.push({ name: m.v, value, label, line: m.line, col: m.col });
      if (!isOp(',')) break;
      next();
    }
    expect('}'); if (isOp(';')) next();
    return { k: 'enum', name: nt.v, members, line: at.line, col: at.col };
  }
  function structDecl() {
    const at = next(), nt = ident('a struct name');
    if (isOp(':')) nope(peek(), 'Struct inheritance');
    if (isOp(';')) { next(); return { k: 'struct', name: nt.v, fields: [], line: at.line, col: at.col, fwd: true }; }
    expect('{');
    const fields = [];
    while (!isOp('}')) {
      if (isId('public') || isId('private') || isId('protected')) { next(); expect(':'); continue; }
      const ty = typeSpec();
      if (isOp('(') || isOp('~') || (peek().t === 'id' && isOp('(', 1))) nope(peek(), 'Struct methods and constructors');
      for (;;) {
        const fn = ident('a field name');
        if (isOp('(')) nope(fn, 'Struct methods and constructors');
        fields.push({ type: ty, name: fn.v, dims: dims(), line: fn.line, col: fn.col });
        if (!isOp(',')) break;
        next();
      }
      expect(';');
    }
    expect('}'); expect(';');
    return { k: 'struct', name: nt.v, fields, line: at.line, col: at.col };
  }

  // ---------- statements ----------
  function block() {
    const at = expect('{'), body = [];
    while (!isOp('}')) { if (peek().t === 'eof') throw err('E207', 'This block is never closed with "}".', at); body.push(stmt()); }
    next();
    return { k: 'block', body, line: at.line, col: at.col };
  }
  const startsDecl = () => {
    const t = peek();
    if (t.t !== 'id') return false;
    if (t.v === 'static' || t.v === 'const') return true;
    if (!isType(t.v)) return false;
    const n1 = peek(1);
    if (n1.t === 'op' && n1.v === '(') return false;          // double(x) cast
    if (n1.t === 'op' && n1.v === '::') return false;
    return true;
  };
  function localDecl() {
    const at = peek();
    let isStatic = false, isConst = false;
    while (isId('static') || isId('const')) { if (next().v === 'static') isStatic = true; else isConst = true; }
    const ty = typeSpec(); if (isConst) ty.const = true;
    const ds = declarators(ty);
    return { k: 'decl', type: ty, decls: ds, static: isStatic, line: at.line, col: at.col };
  }
  function stmt() {
    const t = peek(), at = { line: t.line, col: t.col };
    if (t.t === 'op' && t.v === '{') return block();
    if (t.t === 'op' && t.v === ';') { next(); return { k: 'empty', ...at }; }
    if (t.t === 'id') switch (t.v) {
      case 'if': { next(); expect('('); const c = expr(); expect(')'); const a = stmt(); let b = null; if (isId('else')) { next(); b = stmt(); } return { k: 'if', c, a, b, ...at }; }
      case 'while': { next(); expect('('); const c = expr(); expect(')'); return { k: 'while', c, body: stmt(), ...at }; }
      case 'do': { next(); const body = stmt(); if (!isId('while')) throw err('E208', 'A do block needs "while (...)" after it.', peek()); next(); expect('('); const c = expr(); expect(')'); expect(';'); return { k: 'do', c, body, ...at }; }
      case 'for': {
        next(); expect('(');
        let init = null;
        if (!isOp(';')) init = startsDecl() ? localDecl() : { k: 'expr', e: expr(), ...at };
        expect(';');
        const c = isOp(';') ? null : expr(); expect(';');
        const step = isOp(')') ? null : expr(); expect(')');
        return { k: 'for', init, c, step, body: stmt(), ...at };
      }
      case 'switch': {
        next(); expect('('); const e = expr(); expect(')'); expect('{');
        const cases = [];
        while (!isOp('}')) {
          const ct = peek();
          if (isId('case')) { next(); const test = cond(); expect(':'); cases.push({ test, body: [], line: ct.line }); continue; }
          if (isId('default')) { next(); expect(':'); cases.push({ test: null, body: [], line: ct.line }); continue; }
          if (!cases.length) throw err('E209', 'Expected "case" inside switch.', ct);
          cases[cases.length - 1].body.push(stmt());
        }
        next();
        return { k: 'switch', e, cases, ...at };
      }
      case 'break': next(); expect(';'); return { k: 'break', ...at };
      case 'continue': next(); expect(';'); return { k: 'continue', ...at };
      case 'return': { next(); const e = isOp(';') ? null : expr(); expect(';'); return { k: 'return', e, ...at }; }
      case 'delete': case 'new': nope(t, 'new and delete (objects)');
      case 'class': nope(t, 'Classes');
      default: break;
    }
    if (startsDecl()) { const d = localDecl(); expect(';'); return d; }
    const e = expr();
    expect(';');
    return { k: 'expr', e, ...at };
  }

  // ---------- expressions ----------
  function expr() {
    const at = peek();
    const first = assign();
    if (!isOp(',')) return first;
    const list = [first];
    while (isOp(',')) { next(); list.push(assign()); }
    return { k: 'comma', list, line: at.line, col: at.col };
  }
  function assign() {
    const a = cond();
    const t = peek();
    if (t.t === 'op' && ASSIGN.has(t.v)) { next(); const b = assign(); return { k: 'assign', op: t.v, a, b, line: t.line, col: t.col }; }
    return a;
  }
  function cond() {
    const c = bin(0);
    if (!isOp('?')) return c;
    const t = next();
    const a = assign(); expect(':'); const b = assign();
    return { k: 'cond', c, a, b, line: t.line, col: t.col };
  }
  function bin(level) {
    if (level >= BIN.length) return unary();
    let a = bin(level + 1);
    for (;;) {
      const t = peek();
      if (t.t !== 'op' || !BIN[level].includes(t.v)) return a;
      next();
      a = { k: 'bin', op: t.v, a, b: bin(level + 1), line: t.line, col: t.col };
    }
  }
  function unary() {
    const t = peek();
    if (t.t === 'op') {
      if (t.v === '!' || t.v === '-' || t.v === '+' || t.v === '~') { next(); return { k: 'un', op: t.v, a: unary(), line: t.line, col: t.col }; }
      if (t.v === '++' || t.v === '--') { next(); return { k: 'pre', op: t.v, a: unary(), line: t.line, col: t.col }; }
      if (t.v === '&' || t.v === '*') nope(t, 'Pointers');
      if (t.v === '(' && peek(1).t === 'id' && isType(peek(1).v) && (isOp(')', 2) || (isId('const', 1)))) {
        next(); const ty = typeSpec(); expect(')');
        return { k: 'cast', type: ty, a: unary(), line: t.line, col: t.col };
      }
    }
    if (t.t === 'id' && t.v === 'sizeof') {
      next(); expect('(');
      let arg;
      if (peek().t === 'id' && isType(peek().v) && isOp(')', 1)) arg = { type: next().v }; else arg = { e: expr() };
      expect(')');
      return { k: 'sizeof', arg, line: t.line, col: t.col };
    }
    return postfix(primary());
  }
  function args() {
    expect('(');
    const list = [];
    if (!isOp(')')) for (;;) {
      if (isOp(',')) { list.push({ k: 'skip', line: peek().line, col: peek().col }); next(); continue; }   // f(a,,b): default for the gap
      list.push(assign());
      if (!isOp(',')) break;
      next();
      if (isOp(')')) break;
    }
    expect(')');
    return list;
  }
  function postfix(a) {
    for (;;) {
      const t = peek();
      if (t.t !== 'op') return a;
      if (t.v === '[') { next(); const i = expr(); expect(']'); a = { k: 'idx', a, i, line: t.line, col: t.col }; continue; }
      if (t.v === '.') {
        next(); const nt = ident('a field name');
        if (isOp('(')) nope(nt, 'Methods (obj.Method())');
        a = { k: 'mem', a, name: nt.v, line: nt.line, col: nt.col }; continue;
      }
      if (t.v === '->') nope(t, 'Pointers');
      if (t.v === '++' || t.v === '--') { next(); a = { k: 'post', op: t.v, a, line: t.line, col: t.col }; continue; }
      if (t.v === '(' ) {
        if (a.k === 'id' || a.k === 'scope') { a = { k: 'call', name: a.name, args: args(), line: a.line, col: a.col, global: a.k === 'scope' }; continue; }
        throw err('E210', 'Only named functions can be called.', t);
      }
      return a;
    }
  }
  function primary() {
    const t = next();
    const at = { line: t.line, col: t.col };
    if (t.t === 'num') return { k: 'num', v: t.v, f: !!t.f, lk: t.k || null, ...at };
    if (t.t === 'str') {
      let s = t.v;
      while (peek().t === 'str') s += next().v;   // "a" "b" joins like C
      return { k: 'str', v: s, ...at };
    }
    if (t.t === 'op') {
      if (t.v === '(') { const e = expr(); expect(')'); return e; }
      if (t.v === '::') { const nt = ident('a name'); return { k: 'scope', name: nt.v, line: nt.line, col: nt.col }; }
      throw err('E211', 'Unexpected ' + desc(t) + '.', t);
    }
    if (t.t === 'id') {
      if (t.v === 'true' || t.v === 'false') return { k: 'bool', v: t.v === 'true', ...at };
      if (t.v === 'this') nope(t, 'Classes');
      if (t.v === 'new' || t.v === 'delete') nope(t, 'new and delete (objects)');
      if (BASE_TYPES.has(t.v) && isOp('(')) { next(); const a = expr(); expect(')'); return { k: 'cast', type: { name: t.v }, a, ...at }; }
      if (isOp('::')) { if (types.has(t.v)) { next(); const nt = ident('a name'); return { k: 'id', name: nt.v, line: nt.line, col: nt.col }; } nope(t, 'Class methods'); }
      if (KW.has(t.v)) throw err('E212', 'Unexpected keyword "' + t.v + '".', t);
      return { k: 'id', name: t.v, ...at };
    }
    throw err('E211', 'Unexpected ' + desc(t) + '.', t);
  }

  while (topLevel()) { /* */ }
  return { decls, props: pp.props, includes: pp.includes };
}
