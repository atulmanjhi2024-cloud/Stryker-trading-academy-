// Writes the built-in function list into help/mql5-on-tradezoro.html (between the MQ5-BUILTINS markers) from the
// engine's own catalogue (assets/mq5/builtins.js), so the page never drifts from what runs.
//   node tools/gen-mql5-help.mjs          # write
//   node tools/gen-mql5-help.mjs --check  # exit 1 if the page is out of date (tools/check.py)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinList } from '../assets/mq5/builtins.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'help', 'mql5-on-tradezoro.html');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const list = builtinList();
const cats = new Map();
for (const b of list) { const c = b.cat || 'Other'; if (!cats.has(c)) cats.set(c, []); cats.get(c).push(b); }
let out = '<p>' + list.length + ' built-in functions in ' + cats.size + ' groups. Hover a name to see its form.</p>\n';
for (const [c, items] of [...cats].sort((a, b) => a[0].localeCompare(b[0]))) {
  items.sort((a, b) => a.name.localeCompare(b.name));
  out += '<h3 class="bh-cat">' + esc(c) + ' <span>' + items.length + '</span></h3>\n<ul class="bh-fn">'
    + items.map((b) => '<li><code title="' + esc(String(b.sig || b.name).slice(0, 300)) + '">' + esc(b.name) + '</code></li>').join('') + '</ul>\n';
}
const html = fs.readFileSync(FILE, 'utf8');
const re = /(<!-- MQ5-BUILTINS:START -->\n)[\s\S]*?(<!-- MQ5-BUILTINS:END -->)/;
if (!re.test(html)) { console.error('markers missing'); process.exit(1); }
const next = html.replace(re, (_, a, b) => a + out + b);
if (process.argv.includes('--check')) { if (next !== html) { console.error('out of date'); process.exit(1); } console.log('ok ' + list.length); }
else { fs.writeFileSync(FILE, next); console.log('wrote ' + list.length + ' built-ins in ' + cats.size + ' groups'); }
