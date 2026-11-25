// TradeZoro thinkScript engine: parser. Pure (no DOM, no network).
// tokens (lexer.js) -> AST. Every node carries line/col so errors point at the member's code.
//
// Statements: { s: 'declare'|'input'|'def'|'plot'|'assign'|'method'|'call'|'if'|'switch'|'script', line, col, ... }
// Expressions: { n: 'num'|'str'|'id'|'mem'|'call'|'idx'|'bin'|'un'|'if'|'fold'|'cross'|'enum', line, col, ... }
import { lex, TsError } from './lexer.js?v=1262';

const MAX_DEPTH = 120;
const HARD = new Set(['def', 'rec', 'plot', 'input', 'declare', 'script', 'if', 'then', 'else', 'switch', 'case', 'fold', 'do']);

export function parse(src) {
  const T = lex(src);
  let p = 0, depth = 0;
  const peek = (o) => T[p + (o || 0)];
  const at = (v, o) => { const t = peek(o); return t.t === 'op' ? t.v === v : (t.t === 'id' && t.k === v); };
  const next = () => T[p++];
  const err = (msg, t, hint) => { t = t || peek(); throw new TsError(msg, t.line, t.col, hint); };
  const what = (t) => (t.t === 'eof' ? 'the end of the script' : t.t === 'str' ? 'text "' + t.v + '"' : '"' + t.v + '"');
  const expect = (v, hint) => { if (!at(v)) err('Expected "' + v + '" but found ' + what(peek()) + '.', peek(), hint); return next(); };
  const semi = () => {
    if (at(';')) { next(); return; }
    // the member forgot the ";" at the end of the line before
    const t = peek(), prev = T[p - 1];
    throw new TsError('Missing ";" at the end of the statement.', prev ? prev.line : t.line, prev ? prev.col + String(prev.v).length : t.col, 'Every thinkScript statement ends with a semicolon.');
  };
  const name = (hint) => {
    const t = peek();
    if (t.t !== 'id') err('Expected a name but found ' + what(t) + '.', t, hint);
    if (HARD.has(t.k)) err('"' + t.v + '" is a reserved word and cannot be used as a name.', t);
    next(); return t;
  };
  const enter = () => { if (++depth > MAX_DEPTH) err('The script is nested too deeply.'); };

  // ---------- statements ----------
  function block() {   // { stmt* }
    expect('{');
    const body = [];
    while (!at('}')) { if (peek().t === 'eof') err('Missing "}" to close the block.'); body.push(stmt()); }
    next();
    return body;
  }
  function stmt() {
    enter();
    try {
      const t = peek();
      if (at(';')) { next(); return { s: 'empty', line: t.line, col: t.col }; }
      if (t.t === 'id') {
        switch (t.k) {
          case 'declare': {
            next(); const d = name(); semi();
            return { s: 'declare', v: d.k, line: t.line, col: t.col };
          }
          case 'input': {
            next(); const nm = name(); expect('=', 'An input needs a default value: input length = 14;');
            const e = at('{') ? enumLit() : expr(); semi();
            return { s: 'input', name: nm.v, k: nm.k, e, line: nm.line, col: nm.col };
          }
          case 'def': case 'rec': case 'plot': {
            next(); const nm = at('.') ? null : (peek().t === 'str' ? next() : name());
            if (!nm) err('Expected a name after "' + t.v + '".');
            let e = null;
            if (at('=')) { next(); e = at('{') ? enumLit() : expr(); }
            semi();
            return { s: t.k === 'plot' ? 'plot' : 'def', name: nm.v, k: String(nm.v).toLowerCase(), e, line: nm.line, col: nm.col };
          }
          case 'script': {
            next(); const nm = name();
            const body = block();
            if (at(';')) next();
            return { s: 'script', name: nm.v, k: nm.k, body, line: nm.line, col: nm.col };
          }
          case 'if': return ifStmt();
          case 'switch': return switchStmt();
        }
      }
      // name = expr;   name.Method(args);   Function(args);
      if (t.t === 'id' && at('=', 1)) {
        next(); next(); const e = expr(); semi();
        return { s: 'assign', name: t.v, k: t.k, e, line: t.line, col: t.col };
      }
      const e = expr();
      if (e.n === 'call' && e.fn.n === 'mem' && e.fn.obj.n === 'id' && !e.post) {
        semi();
        return { s: 'method', obj: e.fn.obj.k, objName: e.fn.obj.name, m: e.fn.k, mName: e.fn.name, args: e.args, line: e.line, col: e.col };
      }
      if (e.n === 'call' && e.fn.n === 'id') { semi(); return { s: 'call', fn: e.fn.k, fnName: e.fn.name, args: e.args, line: e.line, col: e.col }; }
      err('This line does nothing. Start it with def, plot, input or a function such as AddLabel.', t);
    } finally { depth--; }
  }
  function ifStmt() {
    const t = next();
    const c = cond();
    if (at('then')) {
      // an "if ... then ... else ..." expression used as a statement is a mistake; point at it
      err('"if ... then ... else ..." gives a value; use it after "=" (def x = if a then b else c;).', t);
    }
    const then = at('{') ? block() : [stmt()];
    let els = null;
    if (at('else')) {
      next();
      els = at('if') ? [ifStmt()] : at('{') ? block() : [stmt()];
    }
    return { s: 'if', c, then, els, line: t.line, col: t.col };
  }
  function switchStmt() {
    const t = next();
    expect('(');
    const subj = expr();
    expect(')');
    expect('{');
    const cases = [];
    while (!at('}')) {
      const ct = peek();
      if (at('case')) {
        next();
        const lab = peek().t === 'str' ? next() : name();
        expect(':');
        const body = [];
        while (!at('case') && !at('default') && !at('}')) { if (peek().t === 'eof') err('Missing "}" to close the switch.'); body.push(stmt()); }
        cases.push({ label: String(lab.v).toLowerCase(), body, line: ct.line, col: ct.col });
      } else if (at('default')) {
        next(); expect(':');
        const body = [];
        while (!at('case') && !at('default') && !at('}')) { if (peek().t === 'eof') err('Missing "}" to close the switch.'); body.push(stmt()); }
        cases.push({ label: null, body, line: ct.line, col: ct.col });
      } else err('Inside a switch, expected "case" or "default" but found ' + what(ct) + '.', ct);
    }
    next();
    return { s: 'switch', subj, cases, line: t.line, col: t.col };
  }
  // input mode = {default fast, slow, "very slow"};
  function enumLit() {
    const t = expect('{');
    const vals = []; let def = null;
    while (!at('}')) {
      let isDef = false;
      if (at('default')) { next(); isDef = true; }
      const v = peek();
      if (v.t !== 'id' && v.t !== 'str') err('An option list holds names or "text" separated by commas.', v);
      next();
      vals.push(String(v.v));
      if (isDef) def = String(v.v);
      if (at(',')) next(); else if (!at('}')) err('Expected "," or "}" in the option list.');
    }
    next();
    if (!vals.length) err('The option list is empty.', t);
    return { n: 'enum', vals, def: def == null ? vals[0] : def, line: t.line, col: t.col };
  }

  // ---------- expressions (lowest to highest) ----------
  function expr() {
    enter();
    try {
      const t = peek();
      if (at('if') && at('(', 1)) {
        // function form: if(condition, a, b)
        const save = p; next();
        let a = null; try { a = args(); } catch (e) { a = null; }
        if (a && a.length === 3 && !at('then')) return { n: 'call', fn: { n: 'id', name: 'If', k: 'if', line: t.line, col: t.col }, args: a, line: t.line, col: t.col };
        p = save;
      }
      if (at('if')) {
        next();
        const c = cond(); expect('then', 'Write it as: if condition then value else other');
        const a = expr(); expect('else', 'An "if ... then" value also needs "else".');
        const b = expr();
        return { n: 'if', c, a, b, line: t.line, col: t.col };
      }
      if (at('fold')) return fold();
      return orE();
    } finally { depth--; }
  }
  function fold() {
    const t = next();
    const v = name('Write it as: fold i = 0 to 10 with s do s + close[i]');
    expect('=');
    const from = orE(); expect('to');
    const to = orE();
    let acc = null, init = null, wh = null;
    if (at('with')) { next(); acc = name(); if (at('=')) { next(); init = orE(); } }
    if (at('while')) { next(); wh = orE(); }
    expect('do');
    const body = expr();
    return { n: 'fold', v: v.k, from, to, acc: acc && acc.k, init, wh, body, line: t.line, col: t.col };
  }
  const bin = (op, a, b, t) => ({ n: 'bin', op, a, b, line: t.line, col: t.col });
  function orE() {
    let a = andE();
    while (at('or') || at('||')) { const t = next(); a = bin('or', a, andE(), t); }
    return a;
  }
  function andE() {
    let a = cmpE();
    while (at('and') || at('&&')) { const t = next(); a = bin('and', a, cmpE(), t); }
    return a;
  }
  function cmpE() {
    let a = addE();
    for (;;) {
      const t = peek();
      if (t.t === 'op' && ['==', '!=', '<>', '<', '>', '<=', '>='].includes(t.v)) {
        next(); a = bin(t.v === '<>' ? '!=' : t.v, a, addE(), t);
      } else if (t.t === 'op' && t.v === '=' && depthEq) {
        next(); a = bin('==', a, addE(), t);   // "if x = 1 then" compares inside conditions
      } else if (at('crosses')) {
        next();
        let dir = 'any';
        if (at('above')) { next(); dir = 'above'; } else if (at('below')) { next(); dir = 'below'; }
        a = { n: 'cross', dir, a, b: addE(), line: t.line, col: t.col };
      } else return a;
    }
  }
  let depthEq = 0;
  // a condition (if ... then / if ... {) may use "=" to compare: if mode = 1 then ...
  function cond() { depthEq++; try { return orE(); } finally { depthEq--; } }
  function addE() {
    let a = mulE();
    while (at('+') || at('-')) { const t = next(); a = bin(t.v, a, mulE(), t); }
    return a;
  }
  function mulE() {
    let a = unE();
    while (at('*') || at('/') || at('%')) { const t = next(); a = bin(t.v, a, unE(), t); }
    return a;
  }
  function unE() {
    const t = peek();
    if (at('-')) { next(); return { n: 'un', op: '-', a: unE(), line: t.line, col: t.col }; }
    if (at('+')) { next(); return unE(); }
    if (at('!') || at('not')) { next(); return { n: 'un', op: '!', a: unE(), line: t.line, col: t.col }; }
    return postE();
  }
  function args() {   // ( [name =] expr, ... )
    expect('(');
    const out = [];
    while (!at(')')) {
      if (peek().t === 'id' && at('=', 1)) { const nm = next(); next(); out.push({ name: nm.k, e: expr(), line: nm.line, col: nm.col }); }
      else { const t = peek(); out.push({ name: null, e: expr(), line: t.line, col: t.col }); }
      if (at(',')) next(); else if (!at(')')) err('Expected "," or ")" in the list of values.');
    }
    next();
    return out;
  }
  function postE() {
    let e = primary();
    for (;;) {
      const t = peek();
      if (at('(') && (e.n === 'id' || e.n === 'mem')) { e = { n: 'call', fn: e, args: args(), line: e.line, col: e.col }; continue; }
      if (at('[')) { next(); const off = expr(); expect(']'); e = { n: 'idx', e, off, line: t.line, col: t.col }; continue; }
      if (at('.')) {
        next();
        const m = peek();
        if (m.t !== 'id' && m.t !== 'str') err('Expected a name after ".".', m);
        next();
        e = { n: 'mem', obj: e, name: String(m.v), k: String(m.v).toLowerCase(), line: m.line, col: m.col };
        if (e.obj.n === 'call') e.post = true;
        continue;
      }
      // close from 2 bars ago
      if (at('from') && peek(1).t !== 'eof') {
        next(); const off = addE();
        if (!at('bars') && !at('bar')) err('Write it as: close from 2 bars ago');
        next(); expect('ago');
        e = { n: 'idx', e, off, line: t.line, col: t.col };
        continue;
      }
      return e;
    }
  }
  function primary() {
    const t = peek();
    if (t.t === 'num') { next(); return { n: 'num', v: t.v, int: !/[.eE]/.test(t.raw), line: t.line, col: t.col }; }
    if (t.t === 'str') { next(); return { n: 'str', v: t.v, line: t.line, col: t.col }; }
    if (at('fold') || at('if')) return expr();   // "s + fold ..." / "1 + if a then b else c": the rest of the expression
    if (at('(')) {
      next(); depthEq++;
      try { const e = expr(); expect(')'); return e; } finally { depthEq--; }
    }
    if (t.t === 'id') {
      if (t.k === 'reference') { next(); return primary(); }   // "reference MACD()" = MACD()
      if (HARD.has(t.k)) err('Expected a value but found the word "' + t.v + '".', t);
      next();
      return { n: 'id', name: t.v, k: t.k, line: t.line, col: t.col };
    }
    err('Expected a value but found ' + what(t) + '.', t);
  }

  const body = [];
  while (peek().t !== 'eof') body.push(stmt());
  return body;
}
