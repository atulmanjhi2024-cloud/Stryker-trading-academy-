// Unit tests for the Desktop 2.0 app logic (src/app/core.js) and the tzapp:// file rules (src/assets.js). Plain node.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const C = require('../src/app/core.js');
const Assets = require('../src/assets.js');

test('tzapp:// serves only files inside src/app with known types', () => {
  assert.strictEqual(Assets.fileFor('tzapp://app/ui.js'), path.join(Assets.ROOT, 'ui.js'));
  assert.strictEqual(Assets.fileFor('tzapp://app/img/omega-64.webp'), path.join(Assets.ROOT, 'img', 'omega-64.webp'));
  assert.strictEqual(Assets.fileFor('tzapp://app/../main.js'), path.join(Assets.ROOT, 'main.js'), 'URL parsing clamps .. at the root');
  { const f = Assets.fileFor('tzapp://app/%2e%2e/main.js'); assert.ok(f === null || f.startsWith(Assets.ROOT + path.sep), 'encoded dots stay inside src/app'); }
  assert.strictEqual(Assets.fileFor('tzapp://app/..%5cmain.js'), null);
  assert.strictEqual(Assets.fileFor('tzapp://evil/ui.js'), null);
  assert.strictEqual(Assets.fileFor('https://app/ui.js'), null);
  assert.strictEqual(Assets.fileFor('tzapp://app/x.exe'), null);
  assert.strictEqual(Assets.typeOf('a.css'), 'text/css; charset=utf-8');
});

test('symbols: canonical ids, catalog search, decimals', () => {
  assert.strictEqual(C.canonicalId('nq1!'), 'futures:NQ1!');
  const s = C.symbolOf('futures:NQ1!');
  assert.strictEqual(s.ticker, 'NQ');
  assert.ok(C.searchCatalog('nq', 5).some((x) => x.ticker === 'NQ'));
  assert.ok(C.decimalsFor(C.symbolOf('EURUSD'), 1.08) >= 4);
});

test('watchlist add / remove / move keep sections and limits', () => {
  const l = { id: 'a', name: 'A', items: ['futures:NQ1!', 'futures:ES1!', 'futures:YM1!'] };
  const add = C.wlAdd(l, 'futures:GC1!');
  assert.ok(add.ok); assert.strictEqual(add.list.items.length, 4);
  assert.ok(!C.wlAdd(add.list, 'futures:GC1!').ok, 'no duplicates');
  assert.deepStrictEqual(C.wlRemove(l, 'futures:ES1!').items, ['futures:NQ1!', 'futures:YM1!']);
  assert.deepStrictEqual(C.wlMove(l, 'futures:YM1!', 'futures:NQ1!').items.slice(0, 2), ['futures:YM1!', 'futures:NQ1!']);
  assert.strictEqual(C.cleanName('  My list  '), 'My list');
  assert.strictEqual(l.items.length, 3, 'inputs are not mutated');
});

test('formatting uses real minus signs and grouping', () => {
  assert.strictEqual(C.fmtNum(1234.5, 2), '1,234.50');
  assert.match(C.fmtPct(-0.7), /^−0\.70%$/);
  assert.match(C.fmtPct(1), /^\+1\.00%$/);
  assert.match(C.fmtUsd(-20), /−\$20\.00/);
});

test('alerts: new alert doc validates price and condition', () => {
  assert.ok(C.newAlertDoc({ symbol: 'futures:NQ1!', cond: 'crossing', price: 'abc', freq: 'once' }).error);
  assert.ok(C.newAlertDoc({ symbol: '', cond: 'crossing', price: '1' }).error);
  const d = C.newAlertDoc({ symbol: 'futures:NQ1!', cond: 'crossing', price: '1,234.5', freq: 'once', message: 'x' }).doc;
  assert.strictEqual(d.price, 1234.5);
  assert.strictEqual(d.active, true);
  assert.ok(C.ALERT_CONDS[d.cond]);
});

test('journal month stats and calendar cells', () => {
  const t = [['a', { date: '2026-11-02', pnl: 100 }], ['b', { date: '2026-11-03', pnl: -50 }], ['c', { date: '2026-11-03', pnl: 10 }], ['_meta', { date: '2026-11-03' }]]
    .map(([id, d]) => C.journalTradeFrom(id, d)).filter(Boolean);
  assert.strictEqual(t.length, 3, 'meta docs skipped');
  const st = C.monthStats('2026-11', t);
  assert.strictEqual(st.trades, 3); assert.strictEqual(st.net, 60);
  assert.strictEqual(C.journalPnl('long', 100, 110, 2, 1), 19);
  const cells = C.monthCells('2026-11', st.perDay);
  assert.ok(cells.filter(Boolean).length >= 20);
});

test('market sessions report open/closed and countdowns', () => {
  const now = Date.UTC(2026, 10, 18, 15, 0);   // Wed 15:00 UTC: New York open
  const ny = C.sessionsNow(now).find((s) => /New York/.test(s.name));
  assert.ok(ny.open);
  assert.ok(C.futuresOpen(now));
  assert.ok(!C.futuresOpen(Date.UTC(2026, 10, 21, 12, 0)), 'closed on Saturday');
  assert.strictEqual(C.fmtDur(90), '1h 30m');
});

test('palette ranking prefers prefix matches', () => {
  const items = [{ title: 'Settings', kw: '' }, { title: 'Alerts', kw: 'bell' }, { title: 'GEX', kw: 'gamma' }];
  assert.strictEqual(C.rankItems(items, 'al', 5)[0].title, 'Alerts');
  assert.strictEqual(C.rankItems(items, 'gamma', 5)[0].title, 'GEX');
});

test('sparkline path spans the box', () => {
  const p = C.sparkPath([1, 2, 3], 100, 20, 2);
  assert.match(p, /^M0\.0 18\.0L50\.0 10\.0L100\.0 2\.0$/);
});
