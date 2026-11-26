// TICK / SECONDS bars on a dated futures CONTRACT MONTH (member bug 25 Nov: "Tick charts for the monthly contracts are not working",
// MESZ2026 100 ticks -> "not available ... Showing 1 minute"). node tools/tests/tick-month.test.mjs
// The live trade record is keyed by ROOT and follows the front month, so: the month the live feed is on (MESZ2026, MNQZ6 typed short)
// reads the root's trades exactly like MES1!; any other month is blocked with an honest message, never fed another month's trades.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const A = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets') + '/';
const rt = await import(A + 'rt-access.js?v=1301');
const fm = await import(A + 'fut-months.js?v=1301');
const iv = await import(A + 'chart-intervals.js?v=1301');
let n = 0; const ok = (m) => { n++; console.log('PASS', m); };

// clock: 25 Nov 2026 (Dec is the front month for the index roots; roll rule = 10 Dec)
const NOW = Date.UTC(2026, 10, 25, 15);
const D0 = Date; globalThis.Date = class extends D0 { constructor(...a) { if (a.length) super(...a); else super(NOW); } static now() { return NOW; } };
rt._rtSetForTests(true, 'test-token');
const roll = (k) => [{ c: k + 'Z2026', d: '20261218' }, { c: k + 'H2027', d: '20270319' }, { c: k + 'M2027', d: '20270618' }];
fm.setFeed({ ES: { contract: 'ESZ2026', roll: roll('ES') }, NQ: { contract: 'NQZ2026', roll: roll('NQ') }, GC: { contract: 'GCZ2026', roll: [{ c: 'GCZ2026', d: '20261229' }] } });

const asked = [];
globalThis.fetch = async (u) => {
  u = String(u); asked.push(u);
  const sym = /[?&]sym=([^&]+)/.exec(u);
  if (/\/te-bars\?/.test(u)) {
    const b = []; for (let i = 0; i < 20; i++) b.push([NOW - (20 - i) * 30000, 100 + i, 101 + i, 99 + i, 100.5 + i, 7]);
    return { ok: true, headers: { get: () => 'live' }, json: async () => ({ sym: sym && sym[1], b, rec: NOW - 864e5, e: 1, q: 99, c: 3, more: 0 }) };
  }
  return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
};
const inner = { getBars: async () => [], subscribe: () => () => {} };
const prov = iv.wrapProvider(inner, 'futures', 20000);

for (const [ticker, root] of [['MESZ2026', 'MES'], ['MNQZ6', 'MNQ'], ['CME_MINI:MESZ26', 'MES']]) {
  assert.equal(iv.secTickBlock('100T', 'futures', ticker), '', ticker + ' 100T is not blocked');
  asked.length = 0;
  const bars = await prov.getBars(ticker, '100T', { limit: 10 });
  assert.equal(bars.length, 10, ticker + ' 100T has bars');
  assert.ok(asked.length && asked.every((u) => u.includes('sym=' + root + '&') && u.includes('tf=100T')), ticker + ' reads the ' + root + ' trade record: ' + asked.join(' '));
  ok(ticker + ' 100T: ' + bars.length + ' bars from the ' + root + ' trade record (= ' + root + '1!)');
}
// the continuous chart is unchanged
asked.length = 0;
assert.equal((await prov.getBars('MES1!', '100T', { limit: 10 })).length, 10);
assert.ok(asked.every((u) => u.includes('sym=MES&')));
ok('MES1! 100T unchanged');
// seconds on the live month: same root record
asked.length = 0;
assert.ok((await prov.getBars('MESZ2026', '5S', { limit: 10 })).length > 0 && asked.every((u) => u.includes('sym=MES&')));
ok('MESZ2026 5S reads the MES record');

// a month the live feed is NOT on: blocked, honest, and no trade record is read (never another month's trades)
const why = iv.secTickBlock('100T', 'futures', 'MESH2027');
assert.match(why, /MESH2027/); assert.match(why, /front month/i); assert.match(why, /MESZ2026/);
asked.length = 0;
assert.equal((await prov.getBars('MESH2027', '100T', { limit: 10 })).length, 0);
assert.ok(!asked.some((u) => /te-bars|stream/.test(u)), asked.join(' '));
ok('MESH2027 100T blocked: "' + why + '"');
// metals / energy months have no front-month proof: blocked, never fed
assert.ok(iv.secTickBlock('100T', 'futures', 'GCZ2026'));
ok('GCZ2026 100T blocked (no proof the live feed is on it)');
console.log(n + ' passed');
