// TradeZoro MQL5 engine: lexer + preprocessor. Pure (no DOM, no network). Runs inside the sandboxed
// worker (assets/mq5/worker.js) and in the node tests.
//
// lex(source) -> { toks, comments }                 tokens with 1-based line/col; trailing // comments by line
// preprocess(source) -> { toks, props, includes, comments }   macros expanded, #property collected, #ifdef applied
// Errors are thrown as MqError (code, line, col, message, hint): the worker turns them into diagnostics.

export class MqError extends Error {
  constructor(code, message, line, col, hint) { super(message); this.code = code; this.line = line || 1; this.col = col || 1; this.hint = hint || ''; }
}
export const err = (code, msg, at, hint) => new MqError(code, msg, at && at.line, at && at.col, hint);

const LIM = { tokens: 400000, expand: 64, macroOut: 1000000, includeDepth: 4 };
const PUNCT = ['<<=', '>>=', '...', '::', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '==', '!=', '<=', '>=', '&&', '||', '<<', '>>', '##', '->',
  '+', '-', '*', '/', '%', '=', '<', '>', '!', '~', '&', '|', '^', '?', ':', ';', ',', '.', '(', ')', '[', ']', '{', '}', '#'];
const ESC = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'", '0': '\0', a: '\x07', b: '\b', f: '\f', v: '\v' };

// D'2024.01.31 10:30:00' -> seconds; accepts the forms the docs list (date only, time only = today, missing seconds)
function dateLit(s, at) {
  const m = /^\s*(?:(\d{4})\.(\d{1,2})\.(\d{1,2}))?\s*(?:(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*$/.exec(s);
  if (!m) throw err('E101', "This date literal is not valid: D'" + s + "'.", at, "Write it as D'2024.01.31 10:30'.");
  let y = +m[1], mo = +m[2], d = +m[3];
  if (!m[1]) { const n = new Date(); y = n.getUTCFullYear(); mo = n.getUTCMonth() + 1; d = n.getUTCDate(); }
  return Math.floor(Date.UTC(y, mo - 1, d, +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) / 1000);
}
// C'128,128,128' or C'0x00,0x80,0xFF' -> MQL colour (0x00BBGGRR)
function colorLit(s, at) {
  const p = s.split(',').map((x) => x.trim());
  if (p.length !== 3) throw err('E101', "This colour literal is not valid: C'" + s + "'.", at, "Write it as C'255,128,0' (red, green, blue).");
  const v = p.map((x) => (/^0x[0-9a-f]+$/i.test(x) ? parseInt(x, 16) : /^\d+$/.test(x) ? +x : NaN));
  if (v.some((x) => !(x >= 0 && x <= 255))) throw err('E101', "Colour parts must be 0 to 255: C'" + s + "'.", at);
  return v[0] | (v[1] << 8) | (v[2] << 16);
}

// Tokens: { t: 'id'|'num'|'str'|'op'|'pp'|'eof', v, line, col, f?: float literal, k?: 'dt'|'color'|'char' }
export function lex(src) {
  const toks = [], comments = new Map();
  let i = 0, line = 1, col = 1, lineStart = true;
  const n = src.length;
  const adv = (k) => { for (let j = 0; j < k; j++) { if (src.charCodeAt(i) === 10) { line++; col = 1; lineStart = true; } else col++; i++; } };
  while (i < n) {
    if (toks.length > LIM.tokens) throw err('E102', 'The script is too long (too many tokens).', { line, col });
    const c = src[i];
    if (c === '\n') { adv(1); continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === '\uFEFF') { adv(1); continue; }
    if (c === '/' && src[i + 1] === '/') {
      let j = i + 2; while (j < n && src[j] !== '\n') j++;
      const text = src.slice(i + 2, j).trim();
      if (!lineStart && text && !/^[-+=|*\s]*$/.test(text)) comments.set(line, text);
      col += j - i; i = j; continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2);
      if (j < 0) throw err('E103', 'This comment is never closed with */.', { line, col });
      const was = lineStart; adv(j + 2 - i); lineStart = was && lineStart; continue;
    }
    const at = { line, col };
    if (c === '#' && lineStart) {
      // a preprocessor line (with \ continuations)
      let j = i + 1, text = '';
      for (;;) {
        let k = j; while (k < n && src[k] !== '\n') k++;
        let seg = src.slice(j, k);
        if (seg.endsWith('\r')) seg = seg.slice(0, -1);
        if (seg.endsWith('\\')) { text += seg.slice(0, -1) + ' '; j = k + 1; if (k >= n) break; continue; }
        text += seg; j = k; break;
      }
      adv(j - i);
      toks.push({ t: 'pp', v: text, line: at.line, col: at.col });
      continue;
    }
    lineStart = false;
    if ((c === 'D' || c === 'C') && src[i + 1] === "'") {
      const j = src.indexOf("'", i + 2);
      if (j < 0 || src.slice(i, j).includes('\n')) throw err('E101', 'This literal is never closed with a quote.', at);
      const body = src.slice(i + 2, j);
      toks.push(c === 'D' ? { t: 'num', v: dateLit(body, at), k: 'dt', line, col } : { t: 'num', v: colorLit(body, at), k: 'color', line, col });
      adv(j + 1 - i); continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1; while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      toks.push({ t: 'id', v: src.slice(i, j), line, col }); adv(j - i); continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i, f = false, v;
      if (c === '0' && /[xX]/.test(src[i + 1] || '')) {
        j = i + 2; while (j < n && /[0-9a-fA-F]/.test(src[j])) j++;
        v = parseInt(src.slice(i + 2, j) || '0', 16);
      } else {
        while (j < n && /[0-9]/.test(src[j])) j++;
        if (src[j] === '.') { f = true; j++; while (j < n && /[0-9]/.test(src[j])) j++; }
        if (/[eE]/.test(src[j] || '') && /[-+0-9]/.test(src[j + 1] || '')) { f = true; j++; if (/[-+]/.test(src[j])) j++; while (j < n && /[0-9]/.test(src[j])) j++; }
        v = Number(src.slice(i, j));
      }
      while (j < n && /[uUlLfF]/.test(src[j])) { if (/[fF]/.test(src[j])) f = true; j++; }
      if (j < n && /[A-Za-z_]/.test(src[j])) throw err('E104', 'This number is not valid: ' + src.slice(i, j + 1) + '.', at);
      toks.push({ t: 'num', v, f, line, col }); adv(j - i); continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      for (;;) {
        if (j >= n || src[j] === '\n') throw err('E105', c === '"' ? 'This string is never closed with ".' : 'This character is never closed with \'.', at);
        const ch = src[j];
        if (ch === c) break;
        if (ch === '\\') {
          const e = src[j + 1];
          if (e === 'x' || e === 'X') { const m = /^[0-9a-fA-F]{1,4}/.exec(src.slice(j + 2)); s += String.fromCharCode(m ? parseInt(m[0], 16) : 0); j += 2 + (m ? m[0].length : 0); continue; }
          if (e === 'u') { const m = /^[0-9a-fA-F]{4}/.exec(src.slice(j + 2)); s += String.fromCharCode(m ? parseInt(m[0], 16) : 0); j += 2 + (m ? 4 : 0); continue; }
          s += ESC[e] !== undefined ? ESC[e] : e; j += 2; continue;
        }
        s += ch; j++;
      }
      if (c === "'") toks.push({ t: 'num', v: s.length ? s.charCodeAt(0) : 0, k: 'char', line, col });
      else toks.push({ t: 'str', v: s, line, col });
      adv(j + 1 - i); continue;
    }
    let p = null;
    for (const q of PUNCT) if (src.startsWith(q, i)) { p = q; break; }
    if (!p) throw err('E106', 'Unexpected character "' + c + '".', at);
    toks.push({ t: 'op', v: p, line, col }); adv(p.length);
  }
  return { toks, comments };
}

// Headers the standard install has. Their functions are built in here, so the #include is accepted and does nothing.
const KNOWN_INCLUDES = new Set(['movingaverages.mqh', 'math\\stat\\math.mqh', 'arrays\\arraydouble.mqh', 'arrays\\arrayint.mqh', 'arrays\\arraystring.mqh',
  'object.mqh', 'charts\\chart.mqh', 'chartobjects\\chartobjectstxtcontrols.mqh', 'chartobjects\\chartobjectslines.mqh', 'chartobjects\\chartobjectsshapes.mqh',
  'stderror.mqh', 'stdlib.mqh', 'indicators\\indicators.mqh']);
const BLOCKED_INCLUDES = [[/^trade\\/i, 'Trading classes'], [/^expert\\/i, 'Expert Advisor classes'], [/^files\\/i, 'File classes'], [/^tools\\datetime/i, null]];
// Classes from these headers are not supported (v1 has no classes): say so at the #include, not later at a strange parse error.
const CLASS_INCLUDES = /^(arrays\\|chartobjects\\|charts\\|object\.mqh|indicators\\)/i;

const PREDEF = { __MQL5__: [{ t: 'num', v: 1 }], __MQL__: [{ t: 'num', v: 1 }], __MQLBUILD__: [{ t: 'num', v: 4000 }], __MQL5BUILD__: [{ t: 'num', v: 4000 }] };

export function preprocess(src) {
  const { toks, comments } = lex(String(src));
  const macros = new Map();
  for (const k of Object.keys(PREDEF)) macros.set(k, { params: null, body: PREDEF[k] });
  const out = [], props = [], includes = [];
  const cond = [];   // stack of { on, seenElse }
  const active = () => cond.every((c) => c.on);
  let outCount = 0;

  const expand = (list, hide, depth) => {
    if (depth > LIM.expand) throw err('E110', 'A #define expands into itself too many times.', list[0]);
    const res = [];
    for (let i = 0; i < list.length; i++) {
      const tk = list[i];
      if (tk.t === 'id' && tk.v === '__LINE__') { res.push({ t: 'num', v: tk.line, line: tk.line, col: tk.col }); continue; }
      const m = tk.t === 'id' && !hide.has(tk.v) ? macros.get(tk.v) : null;
      if (!m) { res.push(tk); continue; }
      let args = null, end = i;
      if (m.params) {
        if (!(list[i + 1] && list[i + 1].t === 'op' && list[i + 1].v === '(')) { res.push(tk); continue; }
        args = []; let depthP = 0, cur = [], j = i + 2;
        for (; j < list.length; j++) {
          const a = list[j];
          if (a.t === 'op' && (a.v === '(' || a.v === '[' || a.v === '{')) depthP++;
          if (a.t === 'op' && (a.v === ')' || a.v === ']' || a.v === '}')) { if (depthP === 0 && a.v === ')') break; depthP--; }
          if (a.t === 'op' && a.v === ',' && depthP === 0) { args.push(cur); cur = []; continue; }
          cur.push(a);
        }
        if (j >= list.length) throw err('E111', 'The call of macro ' + tk.v + ' is missing a ")".', tk);
        args.push(cur); end = j;
        if (m.params.length === 0 && args.length === 1 && !args[0].length) args = [];
        if (args.length !== m.params.length) throw err('E112', 'Macro ' + tk.v + ' takes ' + m.params.length + ' argument' + (m.params.length === 1 ? '' : 's') + ', not ' + args.length + '.', tk);
      }
      // substitute (#x stringizes, a##b pastes), then rescan with this name hidden
      const body = [];
      const at = (x) => Object.assign({}, x, { line: tk.line, col: tk.col });
      for (let b = 0; b < m.body.length; b++) {
        const bt = m.body[b];
        if (args && bt.t === 'op' && bt.v === '#' && m.body[b + 1] && m.body[b + 1].t === 'id' && m.params.includes(m.body[b + 1].v)) {
          const a = args[m.params.indexOf(m.body[b + 1].v)];
          body.push({ t: 'str', v: a.map((x) => (x.t === 'str' ? JSON.stringify(x.v) : String(x.v))).join(' '), line: tk.line, col: tk.col }); b++; continue;
        }
        if (bt.t === 'op' && bt.v === '##' && body.length && m.body[b + 1]) {
          const prev = body.pop(), nx = m.body[++b];
          const nxs = args && nx.t === 'id' && m.params.includes(nx.v) ? args[m.params.indexOf(nx.v)] : [nx];
          const glued = String(prev.v) + nxs.map((x) => String(x.v)).join('');
          const lx = lex(glued).toks.map(at);
          body.push(...lx); continue;
        }
        if (args && bt.t === 'id' && m.params.includes(bt.v)) {
          const a = args[m.params.indexOf(bt.v)];
          body.push(...expand(a, hide, depth + 1).map(at)); continue;
        }
        body.push(at(bt));
      }
      outCount += body.length;
      if (outCount > LIM.macroOut) throw err('E110', 'Macros expand to a script that is too long.', tk);
      const h2 = new Set(hide); h2.add(tk.v);
      res.push(...expand(body, h2, depth + 1));
      i = end;
    }
    return res;
  };

  let pending = [];
  const flush = () => { if (pending.length) { for (const x of expand(pending, new Set(), 0)) out.push(x); pending = []; } };
  for (const tk of toks) {
    if (tk.t !== 'pp') { if (active()) pending.push(tk); continue; }
    flush();
    const m = /^\s*([A-Za-z_]+)\s*([\s\S]*)$/.exec(tk.v);
    if (!m) continue;
    const dir = m[1], rest = m[2];
    const body = () => lex(rest).toks.map((x) => Object.assign(x, { line: tk.line, col: tk.col + 1 + x.col }));
    if (dir === 'ifdef' || dir === 'ifndef') { const name = rest.trim().split(/\s+/)[0]; const has = macros.has(name); cond.push({ on: dir === 'ifdef' ? has : !has, seenElse: false }); continue; }
    if (dir === 'else') { const c = cond[cond.length - 1]; if (!c || c.seenElse) throw err('E113', '#else without #ifdef.', tk); c.on = !c.on; c.seenElse = true; continue; }
    if (dir === 'endif') { if (!cond.length) throw err('E113', '#endif without #ifdef.', tk); cond.pop(); continue; }
    if (!active()) continue;
    if (dir === 'define') {
      const dm = /^([A-Za-z_]\w*)(\(([^)]*)\))?\s*([\s\S]*)$/.exec(rest.trim());
      if (!dm) throw err('E114', '#define needs a name.', tk);
      const params = dm[2] ? dm[3].split(',').map((s) => s.trim()).filter(Boolean) : null;
      const bodyToks = lex(dm[4] || '').toks.map((x) => Object.assign(x, { line: tk.line, col: tk.col }));
      macros.set(dm[1], { params, body: bodyToks });
      continue;
    }
    if (dir === 'undef') { macros.delete(rest.trim()); continue; }
    if (dir === 'property') {
      const pm = /^([A-Za-z_]\w*)\s*([\s\S]*)$/.exec(rest.trim());
      if (!pm) continue;
      const vt = lex(pm[2]).toks.map((x) => Object.assign(x, { line: tk.line, col: tk.col }));
      props.push({ name: pm[1], toks: expand(vt, new Set(), 0), raw: pm[2].trim(), line: tk.line });
      continue;
    }
    if (dir === 'include') {
      const im = /^[<"]([^>"]+)[>"]/.exec(rest.trim());
      const file = im ? im[1].replace(/\//g, '\\') : rest.trim();
      const low = file.toLowerCase();
      for (const [re, what] of BLOCKED_INCLUDES) if (re.test(low) && what) throw err('E120', what + ' (' + file + ') are not supported in indicators on TradeZoro.', tk, 'Indicators on TradeZoro draw on the chart; they never place orders or read files.');
      if (!KNOWN_INCLUDES.has(low)) throw err('E121', 'The file ' + file + ' is not available on TradeZoro.', tk, 'Paste the code you need from that file into this script.');
      if (CLASS_INCLUDES.test(low)) throw err('E122', 'The classes in ' + file + ' are not supported in indicators on TradeZoro yet.', tk, 'Use plain arrays and functions instead.');
      includes.push(file);
      continue;
    }
    if (dir === 'import') throw err('E123', '#import (DLL and library calls) is not supported in indicators on TradeZoro.', tk);
    if (dir === 'resource') throw err('E124', '#resource is not supported in indicators on TradeZoro.', tk);
    if (dir === 'pragma' || dir === 'line' || dir === 'error') continue;
    throw err('E115', 'Unknown preprocessor command #' + dir + '.', tk);
  }
  flush();
  if (cond.length) throw err('E113', '#ifdef without #endif.', toks[toks.length - 1]);
  const last = out[out.length - 1] || { line: 1, col: 1 };
  out.push({ t: 'eof', v: '', line: last.line, col: last.col + 1 });
  return { toks: out, props, includes, comments };
}
