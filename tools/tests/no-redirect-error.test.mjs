// Cloudflare Workers THROW on fetch(..., {redirect:'error'}) (Node accepts it), so every live call fails. Never use it under functions/.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : []; });
const bad = [];
for (const f of walk('functions')) readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (/redirect\s*:\s*['"`]error['"`]/.test(l.replace(/\/\/.*$/, ''))) bad.push(f + ':' + (i + 1)); });
assert.deepEqual(bad, [], "redirect:'error' in functions (use 'manual' and refuse 3xx): " + bad.join(', '));
console.log('no redirect:error in functions: pass');
