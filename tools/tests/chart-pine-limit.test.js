// Pine size limit = 256 KB everywhere (guard, saved scripts, editor, library, rules).
'use strict';
const fs = require('fs'), assert = require('assert');
const gen = require('./pine-big-gen.js');
const G = require('../../assets/chart-pine-guard.js');
const R = (f) => fs.readFileSync(require('path').join(__dirname, '../../', f), 'utf8');
const big = gen(130); let huge = gen(300); huge += "//" + "x".repeat(300 * 1024 - huge.length - 3) + "\n";
console.log('big', big.length, big.split('\n').length, 'lines; huge', huge.length);
assert(big.length > 127 * 1024 && big.split('\n').length > 2000, 'fixture size');
assert(G.check(big).ok, 'guard accepts 130 KB: ' + JSON.stringify(G.check(big)));
const r = G.check(huge);
assert(!r.ok && /too long \(300 KB, limit 256 KB\)/.test(r.msg), 'guard message: ' + r.msg);
assert(!/65536|64 KB/.test(R('assets/chart-pine-guard.js') + R('assets/chart-pine-library.js') + R('assets/chart-pine-scripts.js')), 'no 64 KB left');
global.window = {}; require('../../assets/chart-pine-scripts.js');
assert.strictEqual(global.window.StrykerPineScripts.SOURCE_MAX, 262144);
assert(/const SRC_MAX = 262144;/.test(R('assets/chart-pine.js')));
const rules = R('functions-src/firestore.rules');
assert(/match \/pineScripts\/\{sid\} \{[\s\S]*?size\(\) <= 262144/.test(rules), 'rules pineScripts');
console.log('OK');
