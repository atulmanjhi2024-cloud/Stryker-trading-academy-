// thinkScript sandbox guard tests (node side). The engine never turns member text into JavaScript, imports only its own
// files, has no network/storage/DOM access, and the worker closes every door before it reads a message.
// The live worker (fetch / importScripts really gone, runaway run killed) is checked in a browser by
// tools/tests/chart-thinkscript-browser.js.        node tools/tests/ts-worker.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute } from '../../assets/ts/compiler.js';
import { t, done, makeBars, assert } from './ts-helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TS = path.join(ROOT, 'assets/ts');
const src = Object.fromEntries(fs.readdirSync(TS).filter((f) => f.endsWith('.js')).map((f) => [f, fs.readFileSync(path.join(TS, f), 'utf8')]));
const code = (s) => s.replace(/`[^`]*`/g, '``').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const polluted = () => ({}).polluted !== undefined || [].polluted !== undefined;

t('no eval / new Function / string timers in the engine', () => { for (const [f, s] of Object.entries(src)) assert.ok(!/\beval\s*\(|new\s+Function\b|\bFunction\s*\(|setTimeout\s*\(\s*['"`]/.test(code(s)), f); });
t('no network / storage / DOM in the engine (worker + runner are the plumbing)', () => {
  for (const [f, s] of Object.entries(src)) {
    if (f === 'runner.js' || f === 'worker.js') continue;
    assert.ok(!/\b(fetch|XMLHttpRequest|WebSocket|importScripts|localStorage|sessionStorage|indexedDB|document|window|cookie|postMessage|navigator)\b/.test(code(s)), f);
  }
});
t('no dynamic import() in the engine', () => { for (const [f, s] of Object.entries(src)) assert.ok(!/\bimport\s*\(/.test(code(s)), f); });
t('engine imports only its own files', () => { for (const [f, s] of Object.entries(src)) for (const m of s.matchAll(/from\s+['"]([^'"]+)['"]/g)) assert.match(m[1], /^\.\/[a-z-]+\.js\?v=\d+$/, f + ' imports ' + m[1]); });
t('worker closes the doors before handling messages', () => {
  const w = code(src['worker.js']);
  for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'EventSource', 'WebTransport', 'Function', 'eval', 'MessageChannel', 'WebAssembly']) assert.ok(w.includes(`'${k}'`), k);
  assert.ok(w.indexOf('DOORS') < w.indexOf('self.onmessage'));
  assert.match(src['worker.js'], /Object\.freeze\(o\)/);
});
t('_headers gives the worker an enforced no-network CSP', () => {
  const h = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8');
  const i = h.indexOf('/assets/ts/worker.js'); assert.ok(i >= 0, 'rule present');
  const block = h.slice(i, i + 300).split('\n').slice(0, 2).join('\n');
  assert.match(block, /Content-Security-Policy: default-src 'none'/); assert.match(block, /connect-src 'none'/);
});
t('runner kills a run that takes too long', () => { assert.match(src['runner.js'], /terminate\(\)/); assert.match(src['runner.js'], /KILL_MS/); });

// hostile member text: names that look like JavaScript are only thinkScript names
const B = makeBars(60, 3);
t('hostile names compile to nothing dangerous', () => {
  for (const s of ['plot constructor = 1;', 'def __proto__ = 1;\nplot x = __proto__;', 'plot x = constructor.constructor("return 1")();', 'def prototype = 2;\nplot polluted = prototype;', 'plot x = toString;', 'input __proto__ = 5;\nplot x = 1;']) {
    const r = execute(s, { bars: B });
    assert.ok(!polluted(), s);
    if (r.ok) for (const p of r.plots) assert.ok(p.values instanceof Float64Array, s);
  }
});
t('input values cannot pollute prototypes', () => {
  execute('input a = 1;\nplot x = a;', { bars: B, inputs: JSON.parse('{"__proto__":{"polluted":1},"0":"x"}') });
  assert.ok(!polluted());
});
t('strings in output are plain text, sizes capped', () => {
  const r = execute('AddLabel(yes, "<img src=x onerror=alert(1)>", Color.RED);\nplot x = 1;', { bars: B });
  assert.equal(r.tables[0].cells[0].text, '<img src=x onerror=alert(1)>');   // the chart draws it on canvas as text
  assert.equal(execute('def s = "a" + "' + 'b'.repeat(9000) + '" + "' + 'c'.repeat(2000) + '";\nAddLabel(yes, s);\nplot x = 1;', { bars: B }).ok, false);
});
t('too many bars and bad bars are refused cleanly', () => {
  assert.equal(execute('plot x = 1;', { bars: { time: { length: 1e9 } } }).ok, false);
  assert.equal(execute('plot x = 1;', { bars: null }).ok, false);
});
done('ts-worker');
