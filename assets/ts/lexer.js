// TradeZoro thinkScript engine: lexer. Pure (no DOM, no network).
// Source text -> tokens { t: 'num'|'str'|'id'|'op'|'eof', v, k (lower-case for ids), line, col }.
// The language is case-insensitive: identifiers and keywords compare by `k`.

export class TsError extends Error {
  constructor(message, line, col, hint) { super(message); this.line = line || 1; this.col = col || 1; this.hint = hint || ''; this.ts = true; }
}

const OPS = ['==', '!=', '<>', '<=', '>=', '&&', '||', '+', '-', '*', '/', '%', '<', '>', '=', '!', '(', ')', '[', ']', '{', '}', ',', ';', '.', ':'];

export function lex(src) {
  const s = String(src).replace(/\r\n?/g, '\n');
  const out = [];
  let i = 0, line = 1, col = 1;
  const adv = (n) => { for (let k = 0; k < n; k++) { if (s[i] === '\n') { line++; col = 1; } else col++; i++; } };
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\v' || c === '\u00a0') { adv(1); continue; }
    if (c === '#') { while (i < s.length && s[i] !== '\n') adv(1); continue; }
    const L = line, C = col;
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(s.slice(i, i + 64));
      out.push({ t: 'num', v: Number(m[0]), raw: m[0], line: L, col: C });
      adv(m[0].length);
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(s.slice(i, i + 256));
      out.push({ t: 'id', v: m[0], k: m[0].toLowerCase(), line: L, col: C });
      adv(m[0].length);
      continue;
    }
    if (c === '"') {
      let j = i + 1, txt = '';
      while (j < s.length && s[j] !== '"') {
        if (s[j] === '\n') throw new TsError('This text has no closing quote (").', L, C, 'Close the text on the same line.');
        if (s[j] === '\\' && j + 1 < s.length) { txt += s[j + 1] === 'n' ? '\n' : s[j + 1]; j += 2; continue; }
        txt += s[j++];
      }
      if (j >= s.length) throw new TsError('This text has no closing quote (").', L, C, 'Close the text on the same line.');
      out.push({ t: 'str', v: txt, line: L, col: C });
      adv(j + 1 - i);
      continue;
    }
    const op = OPS.find((o) => s.startsWith(o, i));
    if (!op) throw new TsError('Unexpected character "' + c + '".', L, C);
    out.push({ t: 'op', v: op, line: L, col: C });
    adv(op.length);
  }
  out.push({ t: 'eof', v: '', line, col });
  return out;
}
