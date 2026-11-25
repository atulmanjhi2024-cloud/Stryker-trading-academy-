// Contract months: parsing, round-trip, expiries, roll window, live-month rule, the symbol layer and the order mapping.
// node tools/tests/fut-months.test.mjs
import assert from 'node:assert/strict';
import * as F from '../../assets/fut-months.js';
import { normFutures, futRoot, monthOfSym, splitSym } from '../../assets/chart-sym.js';
import { contractFor } from '../../assets/chart-live-core.js';
import { normSym, rowOf, isMonthSym } from '../../functions/api/chart/_bars.js';

const NOW = Date.UTC(2026, 10, 25, 12);   // 25 Nov 2026
let n = 0; const t = (name, fn) => { fn(); n++; };

t('every month letter round-trips in all three year forms', () => {
  F.LETTERS.split('').forEach((L, i) => {
    for (const y of ['2027', '27', '7']) {
      const m = F.parseMonth('MES' + L + y, NOW);
      assert.ok(m, 'MES' + L + y);
      assert.equal(m.month, i + 1); assert.equal(m.year, 2027); assert.equal(m.code, 'MES' + L + '2027');
      assert.equal(F.parseMonth(m.code, NOW).code, m.code);
      assert.equal(F.shortCode(m), 'MES' + L + '7');
    }
  });
});
t('year rollover: one-digit years', () => {
  assert.equal(F.parseMonth('MESZ6', NOW).year, 2026);
  assert.equal(F.parseMonth('MESH7', NOW).year, 2027);
  assert.equal(F.parseMonth('MESZ5', NOW).year, 2025);   // last year stays last year
  assert.equal(F.parseMonth('MESH4', NOW).year, 2034);   // 4 wraps to the next decade
  assert.equal(F.parseMonth('MESH9', Date.UTC(2029, 11, 30)).year, 2029);
  assert.equal(F.parseMonth('MESH0', Date.UTC(2029, 11, 30)).year, 2030);
});
t('prefixes, other roots, rejects', () => {
  assert.equal(F.parseMonth('CME_MINI:MESZ2026', NOW).code, 'MESZ2026');
  assert.equal(F.parseMonth('futures:mnqh27', NOW).code, 'MNQH2027');
  assert.equal(F.parseMonth('M2KZ26', NOW).code, 'M2KZ2026');
  assert.equal(F.parseMonth('6EH27', NOW).code, '6EH2027');
  assert.equal(F.parseMonth('GCG2027', NOW).root, 'GC');
  for (const bad of ['MES1!', 'MES', 'FOOZ2026', 'MESZ1999', 'MESA26', 'binance:MESZ26', 'MESZ262', '']) assert.equal(F.parseMonth(bad, NOW), null, bad);
});
t('search phrases', () => {
  for (const q of ['MES Dec 2026', 'mes december 2026', 'MES DEC 26', "MES Dec '26", 'MESZ2026', 'MESZ26', 'MESZ6', 'MES Z26']) assert.equal((F.parseQuery(q, NOW) || {}).code, 'MESZ2026', q);
  assert.equal(F.parseQuery('MES', NOW), null);
  assert.equal(F.parseQuery('MES Foo 2026', NOW), null);
});
t('labels and exchange codes', () => {
  const m = F.parseMonth('MESZ2026', NOW);
  assert.equal(F.label(m), 'Dec 2026'); assert.equal(F.chartSym(m), 'futures:MESZ2026');
  assert.equal(F.yahooCode(m, 'CME'), 'MESZ26.CME');
  assert.equal(F.yahooCode(F.parseMonth('GCG27', NOW), 'COMEX'), 'GCG27.CMX');
});
t('index months by the exchange rule (third Friday), expired ones dropped', () => {
  const l = F.monthsFor('MES', null, NOW, 6);
  assert.deepEqual(l.map((m) => m.code), ['MESZ2026', 'MESH2027', 'MESM2027', 'MESU2027', 'MESZ2027', 'MESH2028']);
  assert.deepEqual(l.map((m) => m.expiry), ['20261218', '20270319', '20270618', '20270917', '20271217', '20280317']);
  assert.equal(F.monthsFor('MES', null, Date.UTC(2026, 11, 19), 1)[0].code, 'MESH2027');
  assert.deepEqual(F.monthsFor('GC', null, NOW), []);   // no rule for metals: only the feed's list
});
t('feed roll list wins, micro reads its mini', () => {
  const roll = [{ c: 'GCZ2026', d: '20261229' }, { c: 'GCG2027', d: '20270224' }, { c: 'GCJ2027', d: '20270428' }, { c: 'GCZ2025', d: '20251229' }];
  assert.deepEqual(F.monthsFor('MGC', roll, NOW).map((m) => m.code), ['MGCZ2026', 'MGCG2027', 'MGCJ2027']);
  assert.equal(F.expiryOf(F.parseMonth('MGCG27', NOW), roll, NOW), '20270224');
  assert.equal(F.fmtExpiry('20270224'), '24 Feb');
});
t('roll window: last 8 days only', () => {
  const z = F.parseMonth('MESZ2026', NOW);
  assert.equal(F.rollInfo(z, null, NOW), null);                                  // 23 days out
  const r = F.rollInfo(z, null, Date.UTC(2026, 11, 10, 15));                    // 8 days out
  assert.equal(r.to.code, 'MESH2027'); assert.equal(r.days, 8);
  assert.equal(F.rollInfo(z, null, Date.UTC(2026, 11, 9, 15)), null);           // 9 days out
  assert.equal(F.rollInfo(z, null, Date.UTC(2026, 11, 18, 15)).days, 0);        // expiry day
});
t('live month: front and the roll rule must agree, else nobody is live', () => {
  assert.equal(F.liveMonth('MES', 'ESZ2026', null, NOW), 'MESZ2026');
  assert.equal(F.liveMonth('MES', 'ESH2027', null, NOW), '');                    // feed rolled early: fail closed
  assert.equal(F.liveMonth('MES', '', null, NOW), 'MESZ2026');
  assert.equal(F.liveMonth('MES', 'ESH2027', null, Date.UTC(2026, 11, 11)), 'MESH2027');   // roll week: next month is live
  assert.equal(F.liveMonth('GC', 'GCG2027', null, NOW), '');                     // metals: delayed only (see shortcut note)
  F.setFeed({ ES: { contract: 'ESZ2026' } });
  assert.equal(F.isLiveMonth(F.parseMonth('MESZ2026', NOW), NOW), true);
  assert.equal(F.isLiveMonth(F.parseMonth('MESH2027', NOW), NOW), false);
  F.setFeed(null);
  assert.equal(F.isLiveMonth(F.parseMonth('MESZ2026', NOW), NOW), false);        // feed not loaded: not live
});
t('symbol layer keeps months apart from the continuous contract', () => {
  assert.equal(normFutures('MES1!'), 'futures:MES1!');
  assert.equal(normFutures('CME_MINI:MES1!'), 'futures:MES1!');
  assert.equal(normFutures('MESZ6'), 'futures:MES1!');                 // older forms fold exactly as before
  assert.equal(normFutures('CME_MINI:MESZ2026'), 'futures:MES1!');
  assert.equal(normFutures('futures:MESZ2026'), 'futures:MESZ2026');   // the canonical month chart symbol stays
  assert.equal(normFutures('futures:mesz2026'), 'futures:MESZ2026');
  assert.equal(normFutures('futures:MESZ26'), 'futures:MES1!');
  assert.equal(futRoot('futures:MESZ2026'), 'MES');
  assert.deepEqual(splitSym('futures:MESZ2026'), ['futures', 'MESZ2026']);
  assert.equal(monthOfSym('futures:MES1!'), null);
  assert.equal(monthOfSym('futures:MESZ2026').code, 'MESZ2026');
});
t('orders: a month chart trades that month, the continuous chart keeps the front', () => {
  const m = contractFor('futures:MESH2027', [], NOW, {});
  assert.equal(m.code, 'MESH7'); assert.equal(m.month, true);
  const c = contractFor('futures:MES1!', [], NOW, {});
  assert.equal(c.code, 'MESZ6'); assert.ok(!c.month);
});
t('server: month symbols get their own series code', () => {
  assert.equal(normSym('MESZ2026'), 'MESZ2026'); assert.equal(normSym('MES1!'), 'MES');
  assert.equal(normSym('MESZ1999'), null);
  assert.equal(rowOf('MESH2027')[0], 'MESH27.CME'); assert.equal(rowOf('MES')[0], rowOf('MES')[0]);
  assert.equal(isMonthSym('MESZ2026'), true); assert.equal(isMonthSym('MES'), false);
});
console.log('fut-months: ' + n + ' groups ok');
