// Node unit tests for assets/paper-engine.js (Charts paper trading, Owner order 2026-10-12).
//   node tools/tests/paper-engine.test.js
// Fills (market + slippage, limit touch, gap fills, stop entries), OCO brackets, SL-first on an
// ambiguous segment, P&L with contract point values, commission, net positions (add / reduce /
// flip), reset, closed-market rules, persistence round trip and load-time hardening.
const assert = require('assert');
const path = require('path');
const PE = require(path.join(__dirname, '..', '..', 'assets', 'paper-engine.js'));

let n = 0, fail = 0;
function t(name, fn) { n++; try { fn(); console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n   ' + (e && e.stack || e)); } }

let clock = Date.parse('2026-10-07T14:00:00Z');
let open = true;
const deps = () => ({ now: () => clock, isOpen: () => open, tickOf: () => 0.01 });
const acct = (bal) => { open = true; return PE.PaperAccount.fresh(bal == null ? 100000 : bal, deps()); };
const seg = (o, h, l, c) => ({ t: clock, o, h, l, c });

t('default balance $100,000 USD, custom balance honoured, silly balance falls back', () => {
  assert.strictEqual(acct().summary().balance, 100000);
  assert.strictEqual(acct().summary().currency, 'USD');
  assert.strictEqual(acct(25000).summary().balance, 25000);
  assert.strictEqual(acct(-5).summary().balance, 100000);
});

t('point values per the brief', () => {
  const pv = (s) => PE.specOf('futures:' + s + '1!').pointValue;
  assert.deepStrictEqual(['NQ', 'MNQ', 'ES', 'MES', 'YM', 'MYM', 'GC', 'MGC', 'SI', 'SIL', 'CL', 'MCL', 'RTY', 'M2K'].map(pv), [20, 2, 50, 5, 5, 0.5, 100, 10, 5000, 1000, 1000, 100, 50, 5]);
  assert.strictEqual(PE.specOf('binance:BTCUSDT', 0.01).pointValue, 1);
  assert.strictEqual(PE.specOf('fx:EURUSD').kind, 'forex');     // every chartable symbol trades (Owner 24 Nov)
  assert.strictEqual(PE.specOf('binance:ETHBTC').quote, 'BTC');
});



t('futures ids normalise to one canonical paper symbol', () => {
  const ids = ['futures:NQ1!', 'futures:NQ2!', 'rithmic:NQ1!', 'CME:NQ1!', 'CME_MINI:NQ1!', 'CBOT:YM1!', 'CBOT_MINI:YM1!', 'COMEX:GC1!', 'COMEX_MINI:MGC1!', 'NYMEX:CL1!', 'NYMEX_MINI:CL1!', 'NQ1!', 'NQ2!', 'NQ'];
  for (const id of ids) {
    const sp = PE.specOf(id);
    assert.strictEqual(sp.ok, true, id);
    assert.strictEqual(sp.kind, 'futures', id);
    assert.ok(/^futures:[A-Z0-9]+1!$/.test(sp.symbol), id + ' -> ' + sp.symbol);
  }
  assert.strictEqual(PE.specOf('CME_MINI:NQ1!').symbol, 'futures:NQ1!');
  assert.strictEqual(PE.specOf('rithmic:NQ2!').symbol, 'futures:NQ1!');
  assert.strictEqual(PE.specOf('CBOT_MINI:YM1!').symbol, 'futures:YM1!');
});

t('exchange-prefixed futures share one canonical net position', () => {
  const a = acct();
  a.setLast('CME_MINI:NQ1!', 21000);
  a.placeOrder({ symbol: 'CME_MINI:NQ1!', side: 'buy', type: 'market', qty: 1 });
  assert.strictEqual(a.position('futures:NQ1!').qty, 1);
  a.setLast('NQ1!', 21010);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1 });
  assert.strictEqual(Object.keys(a.state.positions).join(','), 'futures:NQ1!');
  assert.strictEqual(a.position('rithmic:NQ1!').qty, 2);
  assert.strictEqual(a.summary().unrealized, ((21010 - 21005) * 2 * 20));
});

t('futures root outside the table: chart tick + point value, else 1 per point with a note', () => {
  const sp = PE.specOf('CME_MINI:ABC1!');
  assert.strictEqual(sp.ok, true); assert.strictEqual(sp.symbol, 'futures:ABC1!'); assert.strictEqual(sp.pointValue, 1);
  assert.match(sp.note, /Point value not known for ABC/);
  const zc = PE.specOf('CBOT:ZC1!', { tick: 0.25, pv: 50, type: 'futures' });
  assert.strictEqual(zc.tick, 0.25); assert.strictEqual(zc.pointValue, 50); assert.strictEqual(zc.note, undefined);
});

t('market buy fills at last price, P&L uses NQ $20/point', () => {
  const a = acct();
  a.setLast('futures:NQ1!', 21000);
  const ev = a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 2 }).events;
  assert.strictEqual(ev[0].type, 'open'); assert.strictEqual(ev[0].price, 21000);
  a.setLast('futures:NQ1!', 21010);
  assert.strictEqual(a.summary().unrealized, 10 * 2 * 20);   // +$400
  const cl = a.closePosition('futures:NQ1!');
  assert.strictEqual(cl[0].type, 'close'); assert.strictEqual(cl[0].trade.pnl, 400);
  assert.strictEqual(a.summary().balance, 100400);
  assert.strictEqual(a.summary().realized, 400);
});

t('market fill adds slippage ticks against you; commission per contract per side', () => {
  const a = acct();
  a.setSettings({ slippage: 2, commission: 2.5 });
  a.setLast('futures:ES1!', 5000);
  const ev = a.placeOrder({ symbol: 'futures:ES1!', side: 'buy', type: 'market', qty: 1 }).events;
  assert.strictEqual(ev[0].price, 5000.5);                    // 2 ticks x 0.25
  a.setLast('futures:ES1!', 5010);
  const cl = a.closePosition('futures:ES1!');
  assert.strictEqual(cl[0].price, 5009.5);                    // sell side slips down
  assert.strictEqual(cl[0].trade.gross, (5009.5 - 5000.5) * 50);
  assert.strictEqual(cl[0].trade.fees, 5);
  assert.strictEqual(cl[0].trade.pnl, 450 - 5);
  assert.strictEqual(a.summary().balance, 100000 + 445);
});

t('buy limit waits, fills on touch at the limit price, gap fills at the (better) open', () => {
  const a = acct();
  a.setLast('futures:NQ1!', 21000);
  const { order } = a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'limit', qty: 1, price: 20990 });
  assert.ok(order && order.id);
  assert.strictEqual(a.onSegment('futures:NQ1!', seg(21000, 21002, 20995, 20996)).length, 0);
  const ev = a.onSegment('futures:NQ1!', seg(20996, 20997, 20989, 20992));
  assert.strictEqual(ev[0].type, 'open'); assert.strictEqual(ev[0].price, 20990);
  assert.strictEqual(a.state.orders.length, 0);
  // gap: sell limit above, next segment opens above it -> fills at the open
  const b = acct(); b.setLast('futures:NQ1!', 21000);
  b.placeOrder({ symbol: 'futures:NQ1!', side: 'sell', type: 'limit', qty: 1, price: 21010 });
  const g = b.onSegment('futures:NQ1!', seg(21020, 21025, 21015, 21018));
  assert.strictEqual(g[0].price, 21020);
});

t('stop entry fills when traded through, gap = worse open, slippage applied', () => {
  const a = acct(); a.setSettings({ slippage: 1 }); a.setLast('futures:NQ1!', 21000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'stop', qty: 1, price: 21010 });
  const ev = a.onSegment('futures:NQ1!', seg(21012, 21015, 21011, 21014));   // gap above the stop
  assert.strictEqual(ev[0].price, 21012.25);
});

t('wrong-side limit / stop and bad brackets are rejected with a message', () => {
  const a = acct(); a.setLast('futures:NQ1!', 21000);
  assert.throws(() => a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'limit', qty: 1, price: 21010 }), /below the current price/);
  assert.throws(() => a.placeOrder({ symbol: 'futures:NQ1!', side: 'sell', type: 'stop', qty: 1, price: 21010 }), /below the current price/);
  assert.throws(() => a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1, sl: 21005 }), /stop loss must be below/);
  assert.throws(() => a.placeOrder({ symbol: 'futures:NQ1!', side: 'sell', type: 'market', qty: 1, tp: 21005 }), /take profit must be below/);
  assert.throws(() => a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 0 }), /greater than zero/);
  assert.throws(() => a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 0.4 }), /smallest size is 1 contract/);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1.6 });
  assert.strictEqual(a.position('futures:NQ1!').qty, 2, 'futures quantity rounds to whole contracts');
  assert.throws(() => a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 501 }), /largest paper order/);
});

t('bracket is OCO: TP fills, SL leg is gone; P&L at TP', () => {
  const a = acct(); a.setLast('futures:MNQ1!', 21000);
  a.placeOrder({ symbol: 'futures:MNQ1!', side: 'buy', type: 'market', qty: 3, tp: 21020, sl: 20990 });
  const p = a.position('futures:MNQ1!'); assert.strictEqual(p.tp, 21020); assert.strictEqual(p.sl, 20990);
  const ev = a.onSegment('futures:MNQ1!', seg(21010, 21021, 21008, 21019));
  assert.strictEqual(ev[0].type, 'tp'); assert.strictEqual(ev[0].price, 21020);
  assert.strictEqual(ev[0].trade.pnl, 20 * 3 * 2);
  assert.strictEqual(a.position('futures:MNQ1!'), null);
  assert.strictEqual(a.onSegment('futures:MNQ1!', seg(21000, 21000, 20980, 20985)).length, 0, 'SL leg cancelled with the TP');
});

t('segment touching both TP and SL -> stop loss assumed first; SL gap fills at the open', () => {
  const a = acct(); a.setLast('futures:GC1!', 2400);
  a.placeOrder({ symbol: 'futures:GC1!', side: 'buy', type: 'market', qty: 1, tp: 2410, sl: 2395 });
  const ev = a.onSegment('futures:GC1!', seg(2400, 2411, 2394, 2402));
  assert.strictEqual(ev[0].type, 'sl'); assert.strictEqual(ev[0].trade.pnl, -5 * 100);
  const b = acct(); b.setLast('futures:CL1!', 70);
  b.placeOrder({ symbol: 'futures:CL1!', side: 'sell', type: 'market', qty: 1, sl: 70.5 });
  const g = b.onSegment('futures:CL1!', seg(70.8, 71, 70.7, 70.9));   // gaps above the stop
  assert.strictEqual(g[0].price, 70.8); assert.strictEqual(g[0].trade.pnl, -0.8 * 1000);
});

t('limit with bracket fills and the same segment can hit its stop (conservative)', () => {
  const a = acct(); a.setLast('futures:NQ1!', 21000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'limit', qty: 1, price: 20990, sl: 20980, tp: 21020 });
  const ev = a.onSegment('futures:NQ1!', seg(20995, 20996, 20975, 20978));
  assert.deepStrictEqual(ev.map((e) => e.type), ['open', 'sl']);
  assert.strictEqual(ev[1].trade.pnl, -10 * 20);
});

t('net position: add averages, opposite reduces, flip opens the other side', () => {
  const a = acct(); a.setLast('futures:ES1!', 5000);
  a.placeOrder({ symbol: 'futures:ES1!', side: 'buy', type: 'market', qty: 1 });
  a.setLast('futures:ES1!', 5010);
  a.placeOrder({ symbol: 'futures:ES1!', side: 'buy', type: 'market', qty: 1 });
  assert.strictEqual(a.position('futures:ES1!').qty, 2); assert.strictEqual(a.position('futures:ES1!').avg, 5005);
  const r = a.placeOrder({ symbol: 'futures:ES1!', side: 'sell', type: 'market', qty: 1 }).events;
  assert.strictEqual(r[0].type, 'reduce'); assert.strictEqual(r[0].trade.pnl, 5 * 50);
  a.setLast('futures:ES1!', 5020);
  const f = a.reversePosition('futures:ES1!');
  assert.deepStrictEqual(f.map((e) => e.type), ['close', 'open']);
  assert.strictEqual(a.position('futures:ES1!').side, 'sell'); assert.strictEqual(a.position('futures:ES1!').qty, 1);
});

t('crypto per unit: 0.5 BTC +$100 move = +$50', () => {
  const a = acct(); a.setLast('binance:BTCUSDT', 64000);
  a.placeOrder({ symbol: 'binance:BTCUSDT', side: 'buy', type: 'market', qty: 0.5 });
  a.setLast('binance:BTCUSDT', 64100);
  assert.strictEqual(a.summary().unrealized, 50);
});

t('closed market: market orders rejected (and logged), limits wait and do not fill', () => {
  const a = acct(); a.setLast('futures:NQ1!', 21000);
  const { order } = a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'limit', qty: 1, price: 20990 });
  open = false;
  assert.throws(() => a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1 }), /Market closed/);
  assert.strictEqual(a.state.history[a.state.history.length - 1].kind, 'reject');
  assert.throws(() => a.closePosition('futures:NQ1!'), /already closed/);
  assert.strictEqual(a.onSegment('futures:NQ1!', seg(20990, 20991, 20980, 20985)).length, 0, 'no fill while closed');
  assert.ok(a.state.orders.find((o) => o.id === order.id), 'limit still working');
  open = true;
  assert.strictEqual(a.onSegment('futures:NQ1!', seg(20990, 20991, 20980, 20985))[0].type, 'open');
});

t('modify: drag TP / SL validates the side; moving an order drags its bracket', () => {
  const a = acct(); a.setLast('futures:NQ1!', 21000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1, tp: 21020, sl: 20980 });
  a.modifyPosition('futures:NQ1!', { tp: 21030.1 });
  assert.strictEqual(a.position('futures:NQ1!').tp, 21030);
  assert.throws(() => a.modifyPosition('futures:NQ1!', { tp: 20990 }), /above the current price/);
  assert.throws(() => a.modifyPosition('futures:NQ1!', { sl: 21010 }), /below the current price/);
  const { order } = a.placeOrder({ symbol: 'futures:NQ1!', side: 'sell', type: 'limit', qty: 1, price: 21050, sl: 21060, tp: 21040 });
  a.modifyOrder(order.id, { price: 21055 });
  assert.deepStrictEqual([order.price, order.sl, order.tp], [21055, 21065, 21045]);
  assert.throws(() => a.modifyOrder(order.id, { price: 20990 }), /stay above/);
  a.cancelOrder(order.id);
  assert.strictEqual(a.state.orders.length, 0);
  assert.strictEqual(a.state.history[a.state.history.length - 1].kind, 'cancel');
});

t('flatten all closes every position and cancels every order', () => {
  const a = acct(); a.setLast('futures:NQ1!', 21000); a.setLast('binance:BTCUSDT', 64000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1 });
  a.placeOrder({ symbol: 'binance:BTCUSDT', side: 'sell', type: 'market', qty: 1 });
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'limit', qty: 1, price: 20900 });
  const r = a.flattenAll();
  assert.strictEqual(r.events.length, 2); assert.strictEqual(Object.keys(a.state.positions).length, 0); assert.strictEqual(a.state.orders.length, 0);
});

t('reset: new balance, positions/orders/trades cleared, settings kept', () => {
  const a = acct(); a.setSettings({ commission: 1.2 }); a.setLast('futures:NQ1!', 21000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1 });
  a.reset(50000);
  const s = a.summary();
  assert.deepStrictEqual([s.balance, s.equity, s.positions, s.orders, s.trades], [50000, 50000, 0, 0, 0]);
  assert.strictEqual(a.settings.commission, 1.2);
});

t('JSON round trip keeps the account; tampered state is hardened', () => {
  const a = acct(); a.setLast('futures:NQ1!', 21000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 2, tp: 21050 });
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'limit', qty: 1, price: 20950 });
  const b = new PE.PaperAccount(JSON.parse(JSON.stringify(a)), deps());
  assert.strictEqual(b.position('futures:NQ1!').qty, 2); assert.strictEqual(b.state.orders.length, 1);
  assert.ok(b.state.nextId > a.state.orders[0].id);
  const bad = new PE.PaperAccount({ v: 1, startBalance: 'x', balance: null, positions: { 'evil:X': { qty: 1, avg: 1 }, 'futures:NQ1!': { side: 'buy', qty: -1, avg: 1 } }, orders: [{ symbol: 'futures:NQ1!', type: 'market' }], settings: { commission: 1e9 } }, deps());
  assert.strictEqual(Object.keys(bad.state.positions).length, 0); assert.strictEqual(bad.state.orders.length, 0); assert.strictEqual(bad.settings.commission, 100);
  assert.strictEqual(new PE.PaperAccount('garbage', deps()).summary().balance, 100000);
});

t('"Enable paper trading" switch: off by default (also for accounts saved before it), on survives a round trip and a reset, orders keep filling', () => {
  assert.strictEqual(acct().settings.enabled, false);
  const old = JSON.parse(JSON.stringify(acct())); delete old.settings.enabled;           // saved before the switch existed
  assert.strictEqual(new PE.PaperAccount(old, deps()).settings.enabled, false);
  assert.strictEqual(new PE.PaperAccount(Object.assign(old, { settings: Object.assign({}, old.settings, { enabled: 'yes' }) }), deps()).settings.enabled, false);
  const a = acct(); a.setSettings({ enabled: true });
  assert.strictEqual(new PE.PaperAccount(JSON.parse(JSON.stringify(a)), deps()).settings.enabled, true);
  a.reset(50000); assert.strictEqual(a.settings.enabled, true);
  // switch off: the engine is not gated (the chart keeps a working limit filling in the background)
  a.setSettings({ enabled: false }); a.setLast('futures:NQ1!', 21000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'limit', qty: 1, price: 20990 });
  a.onSegment('futures:NQ1!', seg(21000, 21001, 20989, 20995));
  assert.strictEqual(a.position('futures:NQ1!').qty, 1); assert.strictEqual(a.state.orders.length, 0);
});

t('day P&L counts trades closed since the day start', () => {
  const a = acct(); a.setLast('futures:NQ1!', 21000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1 });
  a.setLast('futures:NQ1!', 21005); a.closePosition('futures:NQ1!');
  assert.strictEqual(a.summary(clock - 1000).dayPnl, 100);
  assert.strictEqual(a.summary(clock + 1000).dayPnl, 0);
});

t('the engine has no network or broker surface', () => {
  const src = require('fs').readFileSync(path.join(__dirname, '..', '..', 'assets', 'paper-engine.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|sendBeacon|tradovate|import\(/i.test(src));
});

// ---- edge cases added in the Website Manager review (2026-10-12) ----
t('P&L per point for all 12 brief contracts, long and short, after a 1-point move', () => {
  const want = { NQ: 20, MNQ: 2, ES: 50, MES: 5, YM: 5, MYM: 0.5, GC: 100, MGC: 10, SI: 5000, SIL: 1000, CL: 1000, MCL: 100 };
  for (const r of Object.keys(want)) {
    const sym = 'futures:' + r + '1!';
    for (const side of ['buy', 'sell']) {
      const a = acct(); a.setLast(sym, 100);
      a.placeOrder({ symbol: sym, side, type: 'market', qty: 1 });
      a.setLast(sym, 101);
      const ev = a.closePosition(sym);
      assert.strictEqual(ev[0].trade.pnl, (side === 'buy' ? 1 : -1) * want[r], r + ' ' + side);
    }
  }
});

t('tick rounding has no float drift (SI 0.005, CL 0.01, MYM 1, GC 0.1)', () => {
  const r = PE.roundTick;
  assert.strictEqual(r(30.1234, 0.005), 30.125); assert.strictEqual(r(70.123, 0.01), 70.12);
  assert.strictEqual(r(42010.6, 1), 42011); assert.strictEqual(r(2400.37, 0.1), 2400.4);
  const a = acct(); a.setLast('futures:SI1!', 30.1);
  a.placeOrder({ symbol: 'futures:SI1!', side: 'buy', type: 'market', qty: 3 });
  a.setLast('futures:SI1!', 30.115);
  assert.strictEqual(a.closePosition('futures:SI1!')[0].trade.pnl, 225);   // 0.015 x 3 x 5000
});

t('sell limit gap UP fills at the (better) open; sell stop gap DOWN fills at the (worse) open', () => {
  const a = acct(); a.setLast('futures:ES1!', 5000);
  a.placeOrder({ symbol: 'futures:ES1!', side: 'sell', type: 'limit', qty: 1, price: 5010 });
  assert.strictEqual(a.onSegment('futures:ES1!', seg(5015, 5016, 5012, 5013))[0].price, 5015);
  const b = acct(); b.setLast('futures:ES1!', 5000);
  b.placeOrder({ symbol: 'futures:ES1!', side: 'sell', type: 'stop', qty: 1, price: 4990 });
  assert.strictEqual(b.onSegment('futures:ES1!', seg(4985, 4986, 4980, 4982))[0].price, 4985);
});

t('short bracket: TP below fills, gap down through TP fills at the (better) open, OCO leg gone', () => {
  const a = acct(); a.setLast('futures:NQ1!', 21000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'sell', type: 'market', qty: 1, tp: 20980, sl: 21010 });
  const ev = a.onSegment('futures:NQ1!', seg(20975, 20977, 20970, 20972));
  assert.strictEqual(ev[0].type, 'tp'); assert.strictEqual(ev[0].price, 20975); assert.strictEqual(ev[0].trade.pnl, 25 * 20);
  assert.strictEqual(a.onSegment('futures:NQ1!', seg(21000, 21020, 20999, 21015)).length, 0);
});

t('commission on partial reduce and flip: fees split pro rata, balance == start + realized', () => {
  const a = acct(); a.setSettings({ commission: 2 }); a.setLast('futures:MES1!', 5000);
  a.placeOrder({ symbol: 'futures:MES1!', side: 'buy', type: 'market', qty: 4 });       // fee 8
  a.setLast('futures:MES1!', 5010);
  const r = a.placeOrder({ symbol: 'futures:MES1!', side: 'sell', type: 'market', qty: 1 }).events;   // in 2 + out 2
  assert.strictEqual(r[0].trade.fees, 4); assert.strictEqual(r[0].trade.pnl, 10 * 5 - 4);
  a.setLast('futures:MES1!', 5020);
  const f = a.placeOrder({ symbol: 'futures:MES1!', side: 'sell', type: 'market', qty: 5 }).events;   // close 3 (in 6 + out 6), open 2 short (fee 4)
  assert.deepStrictEqual(f.map((e) => e.type), ['close', 'open']);
  assert.strictEqual(f[0].trade.fees, 12); assert.strictEqual(f[0].trade.pnl, 20 * 3 * 5 - 12);
  a.setLast('futures:MES1!', 5020); a.closePosition('futures:MES1!');                // short 2 flat: in 4 + out 4
  const s = a.summary();
  assert.strictEqual(s.balance, PE.round2(100000 + s.realized));
  assert.strictEqual(s.fees, 8 + 2 + 10 + 4);
});

t('a blown account refuses new exposure but can still close what it holds', () => {
  const a = acct(1000); a.setLast('futures:NQ1!', 21000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 2 });
  a.setLast('futures:NQ1!', 20940);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'sell', type: 'market', qty: 1 });     // -60 x 20 = -1200
  assert.ok(a.summary().balance <= 0, 'balance blown: ' + a.summary().balance);
  assert.throws(() => a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1 }), /no balance left/);
  assert.throws(() => a.placeOrder({ symbol: 'futures:NQ1!', side: 'sell', type: 'limit', qty: 1, price: 21500 }), /no balance left/);
  assert.throws(() => a.reversePosition('futures:NQ1!'), /no balance left/);
  const ev = a.closePosition('futures:NQ1!');                                       // closing is always allowed
  assert.strictEqual(ev[0].type, 'close'); assert.strictEqual(a.position('futures:NQ1!'), null);
});

t('closed market: a working stop that would have triggered fills at the reopen open, not the old price', () => {
  const a = acct(); a.setLast('futures:CL1!', 70);
  a.placeOrder({ symbol: 'futures:CL1!', side: 'buy', type: 'market', qty: 1, sl: 69.5 });
  open = false;
  assert.strictEqual(a.onSegment('futures:CL1!', seg(69, 69.1, 68.8, 69)).length, 0, 'no stop-out while closed');
  assert.throws(() => a.closePosition('futures:CL1!'), /Market closed/);
  open = true;
  const ev = a.onSegment('futures:CL1!', seg(68.9, 69.2, 68.7, 69.1));
  assert.strictEqual(ev[0].type, 'sl'); assert.strictEqual(ev[0].price, 68.9); assert.strictEqual(ev[0].trade.pnl, -1100);
});

t('journal hook maths: trade record carries the point value and the point-value P&L', () => {
  const a = acct(); a.setLast('futures:GC1!', 2400);
  a.placeOrder({ symbol: 'futures:GC1!', side: 'sell', type: 'market', qty: 2, sl: 2405 });
  a.setLast('futures:GC1!', 2396.3);
  const t1 = a.closePosition('futures:GC1!')[0].trade;
  assert.strictEqual(t1.pointValue, 100); assert.strictEqual(t1.pnl, 740);           // 3.7 x 2 x 100
  assert.strictEqual(PE.round2((t1.entry - t1.exit) * t1.qty * t1.pointValue), t1.pnl);
});

// ---- TP1 + TP2 + break-even + risk sizing + mini/micro (member feature 2026-11-18, roadmap card trade-instrument) ----
t('TP1 then TP2: partial close at TP1, the rest at TP2, two trades, flat after', () => {
  const a = acct(); a.setLast('futures:NQ1!', 20000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 3, sl: 19990, tp1: 20010, tp1Qty: 2, tp: 20020 });
  let p = a.position('futures:NQ1!'); assert.strictEqual(p.tp1, 20010); assert.strictEqual(p.tp1Qty, 2); assert.strictEqual(p.tp, 20020);
  let ev = a.onSegment('futures:NQ1!', seg(20001, 20012, 20000, 20011));
  assert.strictEqual(ev.length, 1); assert.strictEqual(ev[0].type, 'tp1'); assert.strictEqual(ev[0].qty, 2); assert.strictEqual(ev[0].price, 20010);
  assert.strictEqual(ev[0].trade.reason, 'tp1'); assert.strictEqual(ev[0].trade.pnl, 400); assert.strictEqual(ev[0].trade.tp, 20010);
  p = a.position('futures:NQ1!'); assert.strictEqual(p.qty, 1); assert.strictEqual(p.tp1, null); assert.strictEqual(p.sl, 19990, 'no BE asked: stop stays');
  ev = a.onSegment('futures:NQ1!', seg(20015, 20021, 20014, 20019));
  assert.strictEqual(ev[0].type, 'tp'); assert.strictEqual(ev[0].qty, 1); assert.strictEqual(ev[0].trade.pnl, 400);
  assert.strictEqual(a.position('futures:NQ1!'), null, 'flat: the stop is gone with it (OCO)');
  assert.strictEqual(a.state.trades.length, 2); assert.strictEqual(a.summary().realized, 800);
});

t('TP1 by percent rounds down; validation of TP1 size and order', () => {
  const a = acct(); a.setLast('futures:ES1!', 5000);
  a.placeOrder({ symbol: 'futures:ES1!', side: 'sell', type: 'market', qty: 5, tp1: 4990, tp1Pct: 50, tp: 4980 });
  assert.strictEqual(a.position('futures:ES1!').tp1Qty, 2, '50% of 5 = 2 (rounded down)');
  const b = acct(); b.setLast('futures:ES1!', 5000);
  assert.throws(() => b.placeOrder({ symbol: 'futures:ES1!', side: 'buy', type: 'market', qty: 1, tp1: 5010, tp1Qty: 1, tp: 5020 }), /at least 2/);
  assert.throws(() => b.placeOrder({ symbol: 'futures:ES1!', side: 'buy', type: 'market', qty: 2, tp1: 5010, tp1Qty: 2, tp: 5020 }), /less than the whole/);
  assert.throws(() => b.placeOrder({ symbol: 'futures:ES1!', side: 'buy', type: 'market', qty: 3, tp1: 5010, tp1Pct: 10, tp: 5020 }), /at least 1/);
  assert.throws(() => b.placeOrder({ symbol: 'futures:ES1!', side: 'buy', type: 'market', qty: 3, tp1: 5030, tp1Qty: 1, tp: 5020 }), /between the entry and TP2/);
  assert.throws(() => b.placeOrder({ symbol: 'futures:ES1!', side: 'buy', type: 'market', qty: 3, tp1: 4990, tp1Qty: 1, tp: 5020 }), /TP1 must be above/);
  assert.throws(() => b.placeOrder({ symbol: 'futures:ES1!', side: 'buy', type: 'market', qty: 3, tp1: 5001, tp1Qty: 1, tp: 5020, be: 4 }), /smaller than the distance/);
  assert.strictEqual(b.position('futures:ES1!'), null, 'rejected orders open nothing');
});

t('break-even: after TP1 the stop moves to entry + offset ticks; the rest stops out there', () => {
  const a = acct(); a.setLast('futures:MNQ1!', 20000);
  a.placeOrder({ symbol: 'futures:MNQ1!', side: 'buy', type: 'market', qty: 4, sl: 19980, tp1: 20010, tp1Qty: 2, tp: 20040, be: 2 });
  let ev = a.onSegment('futures:MNQ1!', seg(20002, 20010.5, 20001, 20008));
  assert.deepStrictEqual(ev.map((e) => e.type), ['tp1', 'be']);
  const p = a.position('futures:MNQ1!'); assert.strictEqual(p.sl, 20000.5, 'entry 20000 + 2 ticks x 0.25'); assert.strictEqual(p.qty, 2); assert.strictEqual(p.beMoved, true);
  assert.strictEqual(p.sl0, 19980, 'the risk the trade was taken with stays the first stop');
  ev = a.onSegment('futures:MNQ1!', seg(20005, 20006, 20000, 20000.25));
  assert.strictEqual(ev[0].type, 'sl'); assert.strictEqual(ev[0].price, 20000.5); assert.strictEqual(ev[0].qty, 2); assert.strictEqual(ev[0].trade.pnl, 2);   // 0.5 x 2 x $2
  assert.strictEqual(a.position('futures:MNQ1!'), null);
});

t('break-even never loosens a stop that is already better; short side mirrors', () => {
  const a = acct(); a.setLast('futures:GC1!', 2400);
  a.placeOrder({ symbol: 'futures:GC1!', side: 'sell', type: 'market', qty: 2, sl: 2405, tp1: 2395, tp1Qty: 1, tp: 2390, be: 0 });
  a.setLast('futures:GC1!', 2397); a.modifyPosition('futures:GC1!', { sl: 2399 });   // price moved; trader tightened past break-even
  const ev = a.onSegment('futures:GC1!', seg(2398, 2398.5, 2394.9, 2396));
  assert.deepStrictEqual(ev.map((e) => e.type), ['tp1'], 'no BE event: 2400 would be worse than 2399');
  assert.strictEqual(a.position('futures:GC1!').sl, 2399);
  const b = acct(); b.setLast('futures:GC1!', 2400);
  b.placeOrder({ symbol: 'futures:GC1!', side: 'sell', type: 'market', qty: 2, sl: 2405, tp1: 2395, tp1Qty: 1, tp: 2390, be: 3 });
  b.onSegment('futures:GC1!', seg(2398, 2398.5, 2394.9, 2396));
  assert.strictEqual(b.position('futures:GC1!').sl, 2399.7, 'short: entry - 3 ticks');
});

t('OCO: stop loss before TP1 closes the WHOLE position and cancels both targets', () => {
  const a = acct(); a.setLast('futures:NQ1!', 20000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 3, sl: 19990, tp1: 20010, tp1Qty: 1, tp: 20020, be: 0 });
  const ev = a.onSegment('futures:NQ1!', seg(19995, 19996, 19989, 19992));
  assert.strictEqual(ev.length, 1); assert.strictEqual(ev[0].type, 'sl'); assert.strictEqual(ev[0].qty, 3); assert.strictEqual(ev[0].trade.pnl, -600);
  assert.strictEqual(a.position('futures:NQ1!'), null);
  assert.strictEqual(a.onSegment('futures:NQ1!', seg(20015, 20025, 20015, 20025)).length, 0, 'targets gone with the position');
});

t('one segment touching the stop AND TP1: stop first (conservative), whole position', () => {
  const a = acct(); a.setLast('futures:NQ1!', 20000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 2, sl: 19990, tp1: 20010, tp1Qty: 1, tp: 20020 });
  const ev = a.onSegment('futures:NQ1!', seg(20000, 20011, 19989, 20000));
  assert.strictEqual(ev[0].type, 'sl'); assert.strictEqual(ev[0].qty, 2);
});

t('one segment running through TP1 and TP2: both fill in order, flat', () => {
  const a = acct(); a.setLast('futures:NQ1!', 20000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 2, sl: 19990, tp1: 20010, tp1Qty: 1, tp: 20020, be: 1 });
  const ev = a.onSegment('futures:NQ1!', seg(20001, 20022, 20001, 20021));
  assert.deepStrictEqual(ev.map((e) => e.type), ['tp1', 'be', 'tp']);
  assert.strictEqual(ev[0].price, 20010); assert.strictEqual(ev[2].price, 20020); assert.strictEqual(a.position('futures:NQ1!'), null);
});

t('BE moved in a segment whose earlier range sits under the new stop: no stop-out until the NEXT segment', () => {
  const a = acct(); a.setLast('futures:MNQ1!', 20000);
  a.placeOrder({ symbol: 'futures:MNQ1!', side: 'buy', type: 'market', qty: 5, sl: 19990, tp1: 20010, tp1Qty: 2, tp: 20020, be: 2 });
  let ev = a.onSegment('futures:MNQ1!', seg(20000, 20011, 20000, 20011));   // low = entry (under BE 20000.5), then TP1
  assert.deepStrictEqual(ev.map((e) => e.type), ['tp1', 'be']);
  assert.strictEqual(a.position('futures:MNQ1!').qty, 3); assert.strictEqual(a.position('futures:MNQ1!').sl, 20000.5);
  ev = a.onSegment('futures:MNQ1!', seg(20011, 20012, 20000, 20000));
  assert.strictEqual(ev[0].type, 'sl'); assert.strictEqual(ev[0].qty, 3);
});

t('gap through TP1 fills at the open (never better than the market gave)', () => {
  const a = acct(); a.setLast('futures:NQ1!', 20000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 2, sl: 19990, tp1: 20010, tp1Qty: 1, tp: 20030 });
  const ev = a.onSegment('futures:NQ1!', seg(20012, 20013, 20011, 20012));
  assert.strictEqual(ev[0].type, 'tp1'); assert.strictEqual(ev[0].price, 20012);
});

t('limit entry carries TP1/TP2/BE onto the position when it fills; dragging the entry drags TP1 too', () => {
  const a = acct(); a.setLast('futures:ES1!', 5000);
  const { order } = a.placeOrder({ symbol: 'futures:ES1!', side: 'buy', type: 'limit', price: 4990, qty: 2, sl: 4985, tp1: 4995, tp1Qty: 1, tp: 5000, be: 0 });
  a.modifyOrder(order.id, { price: 4991 });
  const o = a.state.orders[0]; assert.strictEqual(o.tp1, 4996); assert.strictEqual(o.sl, 4986); assert.strictEqual(o.tp, 5001);
  assert.throws(() => a.modifyOrder(order.id, { qty: 1 }), /Remove TP1 first/);
  a.onSegment('futures:ES1!', seg(4992, 4992, 4990.5, 4991));
  const p = a.position('futures:ES1!'); assert.strictEqual(p.tp1, 4996); assert.strictEqual(p.tp1Qty, 1); assert.strictEqual(p.be, 0);
  a.modifyPosition('futures:ES1!', { tp1: 4997 }); assert.strictEqual(a.position('futures:ES1!').tp1, 4997);
  assert.throws(() => a.modifyPosition('futures:ES1!', { tp1: 5002 }), /between the entry and TP2/);
  a.modifyPosition('futures:ES1!', { tp1: null }); assert.strictEqual(a.position('futures:ES1!').tp1Qty, null);
});

t('a manual part-close that leaves only the TP1 size turns TP1 into the last target', () => {
  const a = acct(); a.setLast('futures:NQ1!', 20000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 3, tp1: 20010, tp1Qty: 2 });
  a.closePosition('futures:NQ1!', 1);
  const p = a.position('futures:NQ1!'); assert.strictEqual(p.qty, 2); assert.strictEqual(p.tp1, null); assert.strictEqual(p.tp, 20010);
});

t('TP1 / BE survive a save + load; a broken TP1 is dropped at load', () => {
  const a = acct(); a.setLast('futures:NQ1!', 20000);
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 3, sl: 19990, tp1: 20010, tp1Qty: 1, tp: 20020, be: 2 });
  a.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'limit', price: 19995, qty: 2, tp1: 20005, tp1Qty: 1 });
  const b = new PE.PaperAccount(JSON.parse(JSON.stringify(a.toJSON())), deps());
  const p = b.position('futures:NQ1!'); assert.strictEqual(p.tp1, 20010); assert.strictEqual(p.tp1Qty, 1); assert.strictEqual(p.be, 2);
  assert.strictEqual(b.state.orders[0].tp1, 20005);
  const raw = JSON.parse(JSON.stringify(a.toJSON())); raw.positions['futures:NQ1!'].tp1Qty = 9;
  const c = new PE.PaperAccount(raw, deps()); assert.strictEqual(c.position('futures:NQ1!').tp1, null); assert.strictEqual(c.position('futures:NQ1!').be, null);
});

t('risk sizing: $ risk / (stop distance x point value), rounded down, min 1, capped', () => {
  const nq = PE.specOf('futures:NQ1!'), mnq = PE.specOf('futures:MNQ1!');
  assert.strictEqual(PE.sizeForRisk(nq, 1000, 20000, 19990).qty, 5);          // 10 pts x $20 = $200 a contract
  assert.strictEqual(PE.sizeForRisk(nq, 1099, 20000, 19990).qty, 5, 'rounded down');
  assert.strictEqual(PE.sizeForRisk(nq, 1000, 20000, 19990).risk, 1000);
  const one = PE.sizeForRisk(nq, 50, 20000, 19990); assert.strictEqual(one.qty, 1); assert.strictEqual(one.over, true, 'min 1 even when it risks more');
  assert.strictEqual(PE.sizeForRisk(mnq, 1000, 20000, 19990).qty, 50);
  assert.strictEqual(PE.sizeForRisk(mnq, 100000, 20000, 19990).qty, 500, 'capped at the paper max');
  assert.strictEqual(PE.sizeForRisk(mnq, 1000, 20000, 19990, 2).qty, 2, 'capped by the caller (live 2)');
  assert.strictEqual(PE.sizeForRisk(mnq, 1000, 20000, 19990, 2).capped, true);
  assert.ok(PE.sizeForRisk(nq, 1000, 20000, 20000).error); assert.ok(PE.sizeForRisk(nq, 0, 20000, 19990).error);
  // risk % of balance is the caller's maths: 1% of 100,000 = 1,000
  assert.strictEqual(PE.sizeForRisk(nq, 100000 * 1 / 100, 20000, 20010).qty, 5, 'short stop above');
  const btc = PE.specOf('binance:BTCUSDT', 0.01); assert.strictEqual(PE.sizeForRisk(btc, 100, 60000, 59000).qty, 0.1);
});

t('mini / micro pairs: NQ<->MNQ, ES<->MES, YM<->MYM, RTY<->M2K, GC<->MGC, CL<->MCL, SI<->SIL', () => {
  const pairs = [['NQ', 'MNQ'], ['ES', 'MES'], ['YM', 'MYM'], ['RTY', 'M2K'], ['GC', 'MGC'], ['CL', 'MCL'], ['SI', 'SIL']];
  for (const [a, b] of pairs) { assert.strictEqual(PE.pairOf(a), b); assert.strictEqual(PE.pairOf(b), a); assert.strictEqual(PE.specOf('futures:' + a + '1!').tick, PE.specOf('futures:' + b + '1!').tick, a + ' same price scale'); }
  assert.strictEqual(PE.pairSymbol('CME_MINI:NQ1!'), 'futures:MNQ1!'); assert.strictEqual(PE.pairSymbol('futures:MNQ1!'), 'futures:NQ1!');
  assert.strictEqual(PE.pairSymbol('MNQZ6'), 'futures:NQ1!'); assert.strictEqual(PE.pairSymbol('futures:ZN1!'), ''); assert.strictEqual(PE.pairSymbol('binance:BTCUSDT'), '');
  assert.deepStrictEqual(PE.familyOf('futures:M2K1!'), { mini: 'RTY', micro: 'M2K' });
  // the chart's price feeds the pair 1:1: an MNQ order fills on NQ prices, P&L at $2 a point
  const a = acct(); a.setLast('futures:MNQ1!', 20000);
  a.placeOrder({ symbol: 'futures:MNQ1!', side: 'buy', type: 'market', qty: 1, tp: 20010 });
  const ev = a.onSegment('futures:MNQ1!', seg(20005, 20011, 20004, 20010));
  assert.strictEqual(ev[0].trade.pnl, 20); assert.strictEqual(ev[0].symbol, 'futures:MNQ1!');
});


// ---------------------------------------------------------------- every chartable symbol (Owner 24 Nov)
const R = { CHF: 1.25, JPY: 1 / 150, INR: 1 / 84, BTC: 60000 };       // Sample data: USD per 1 quote unit
const rdeps = (rates) => Object.assign(deps(), { rate: (q) => (rates[q] != null ? rates[q] : null), tickOf: (s) => (/ETHBTC/.test(s) ? 0.00001 : undefined) });
const racct = (rates) => { open = true; return PE.PaperAccount.fresh(100000, rdeps(rates || R)); };
const roundTrip = (a, sym, side, qty, inPx, outPx) => {
  a.setLast(sym, inPx); a.placeOrder({ symbol: sym, side, type: 'market', qty });
  a.setLast(sym, outPx); return a.closePosition(sym)[0].trade;
};

t('spec per class: GBPCHF EURJPY XAUUSD AAPL RELIANCE ETHBTC BTCUSDT NQ', () => {
  const g = PE.specOf('fx:GBPCHF');
  assert.deepStrictEqual([g.kind, g.quote, g.pointValue, g.unit, g.minQty, g.qtyStep, g.pip, g.tick], ['forex', 'CHF', 100000, 'lot', 0.01, 0.01, 0.0001, 0.00001]);
  const j = PE.specOf('fx:EURJPY'); assert.deepStrictEqual([j.quote, j.pip, j.tick], ['JPY', 0.01, 0.001]);
  const x = PE.specOf('byo:XAUUSD'); assert.deepStrictEqual([x.kind, x.pointValue, x.quote, x.unit], ['metal', 100, 'USD', 'lot']);
  assert.strictEqual(PE.specOf('byo:XAGUSD').pointValue, 5000);
  const ap = PE.specOf('stocks:NASDAQ:AAPL'); assert.deepStrictEqual([ap.kind, ap.quote, ap.unit, ap.qtyStep, ap.fees], ['stock', 'USD', 'share', 1, false]);
  const rl = PE.specOf('stocks:NSE:RELIANCE'); assert.deepStrictEqual([rl.kind, rl.quote], ['stock', 'INR']);
  assert.strictEqual(PE.specOf('stocks:XETR:SAP', { currency: 'EUR' }).quote, 'EUR');         // symbol info wins
  const eb = PE.specOf('binance:ETHBTC', 0.00001); assert.deepStrictEqual([eb.kind, eb.quote, eb.tick], ['crypto', 'BTC', 0.00001]);
  const bt = PE.specOf('binance:BTCUSDT'); assert.deepStrictEqual([bt.quote, bt.rate, bt.fees], ['USDT', 1, true]);
  assert.strictEqual(PE.specOf('binance:BTCUSDT.P').quote, 'USDT');
  assert.strictEqual(PE.specOf('okx:BTC-USDT-SWAP').quote, 'USDT');
  assert.strictEqual(PE.specOf('kraken:XBTEUR').quote, 'EUR');
  assert.strictEqual(PE.specOf('coinbase:ETH-BTC').quote, 'BTC');
  assert.strictEqual(PE.specOf('hyperliquid:BTC').quote, 'USD');
  const ix = PE.specOf('idx:SPX'); assert.deepStrictEqual([ix.kind, ix.pointValue, ix.unit], ['index', 1, 'contract']);
  assert.strictEqual(PE.specOf('idx:SPY').kind, 'stock');
  const nq = PE.specOf('NQ1!'); assert.deepStrictEqual([nq.kind, nq.pointValue, nq.quote], ['futures', 20, 'USD']);
});

t('no "not supported" for chartable symbols; no feed -> live-prices message', () => {
  for (const s of ['fx:GBPCHF', 'stocks:NSE:RELIANCE', 'binance:ETHBTC', 'idx:VIX', 'byo:AAPL', 'vest:BTC-PERP']) assert.strictEqual(PE.specOf(s).ok, true, s);
  const r = PE.specOf('weird:THING');
  assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'Paper trading needs live prices for THING. Try again when the market is open.');
  assert.doesNotMatch(r.reason, /not supported/);
});

t('GBPCHF: P&L in CHF converted to USD (USD per CHF); pips; no commission', () => {
  const a = racct(); a.setSettings({ commission: 5 });
  const tr = roundTrip(a, 'fx:GBPCHF', 'buy', 0.5, 1.12000, 1.12500);       // +50 pips x 0.5 lot = 250 CHF
  assert.strictEqual(tr.gross, 312.5); assert.strictEqual(tr.fees, 0); assert.strictEqual(tr.pnl, 312.5);
  assert.strictEqual(tr.quote, 'CHF'); assert.strictEqual(tr.rate, 1.25);
  assert.strictEqual(a.summary().balance, 100312.5);
  assert.strictEqual(a.spec('fx:GBPCHF').pointValue, 125000);              // per 1.0 price move per lot, in USD
});

t('EURJPY via USDJPY; XAUUSD 100 oz lots; AAPL shares; RELIANCE INR; ETHBTC via BTCUSD; BTCUSDT; NQ', () => {
  assert.strictEqual(roundTrip(racct(), 'fx:EURJPY', 'sell', 1, 160.000, 159.500).pnl, 333.33);    // 50 pips x 100,000 = 50,000 JPY / 150
  assert.strictEqual(roundTrip(racct(), 'byo:XAUUSD', 'buy', 0.1, 2400.00, 2410.00).pnl, 100);     // 10 x 10 oz
  assert.strictEqual(roundTrip(racct(), 'stocks:NASDAQ:AAPL', 'buy', 10, 230.00, 232.50).pnl, 25);
  assert.strictEqual(roundTrip(racct(), 'stocks:NSE:RELIANCE', 'buy', 100, 2900, 2942).pnl, 50);   // 4,200 INR / 84
  assert.strictEqual(roundTrip(racct(), 'binance:ETHBTC', 'buy', 2, 0.05, 0.051).pnl, 120);       // 0.002 BTC x 60,000
  const a = racct(); a.setSettings({ commission: 1 });
  assert.strictEqual(roundTrip(a, 'binance:BTCUSDT', 'buy', 0.5, 60000, 60100).pnl, 49);           // fees kept for crypto: 0.5 + 0.5
  const b = racct(); b.setSettings({ commission: 2 });
  assert.strictEqual(roundTrip(b, 'futures:NQ1!', 'buy', 1, 21000, 21010).pnl, 196);               // futures unchanged
});

t('open P&L marks at the live rate; risk sizing uses the USD point value', () => {
  const rates = Object.assign({}, R), a = racct(rates);
  a.setLast('fx:GBPCHF', 1.12); a.placeOrder({ symbol: 'fx:GBPCHF', side: 'buy', type: 'market', qty: 1 });
  a.setLast('fx:GBPCHF', 1.121);                                    // +10 pips x 1 lot = 100 CHF
  assert.strictEqual(a.summary().unrealized, 125);
  rates.CHF = 1.1; assert.strictEqual(a.summary().unrealized, 110);
  const sz = PE.sizeForRisk(a.spec('fx:GBPCHF'), 500, 1.12, 1.118, 100);  // 20 pips: 1 lot risks 200 CHF = $220
  assert.strictEqual(sz.qty, 2.27); assert.strictEqual(sz.risk, 499.4);
});

t('conversion rate missing: order held with a "Waiting for the CHF→USD rate" message, nothing fills or marks', () => {
  const rates = {}, a = racct(rates);
  a.setLast('fx:GBPCHF', 1.12);
  assert.throws(() => a.placeOrder({ symbol: 'fx:GBPCHF', side: 'buy', type: 'market', qty: 0.1 }), /Waiting for the CHF\u2192USD rate/);
  assert.strictEqual(Object.keys(a.state.positions).length, 0);
  rates.CHF = 1.25;
  a.placeOrder({ symbol: 'fx:GBPCHF', side: 'buy', type: 'limit', qty: 0.1, price: 1.119 });
  delete rates.CHF;
  assert.deepStrictEqual(a.onSegment('fx:GBPCHF', seg(1.12, 1.12, 1.118, 1.119)), []);       // touched, but no rate: held
  assert.strictEqual(a.state.orders.length, 1);
  rates.CHF = 1.25;
  assert.strictEqual(a.onSegment('fx:GBPCHF', seg(1.119, 1.1195, 1.1185, 1.119))[0].type, 'open');
  assert.strictEqual(PE.sizeForRisk(racct({}).spec('fx:GBPCHF'), 100, 1.12, 1.11, 10).error.indexOf('Waiting for the CHF'), 0);
});

t('closed forex market: a market order queues and fills at the open of the first new price', () => {
  const a = racct(); a.setLast('fx:EURJPY', 160);
  open = false;
  const r = a.placeOrder({ symbol: 'fx:EURJPY', side: 'buy', type: 'market', qty: 0.1, sl: 159 });
  assert.ok(r.order && r.order.queued); assert.strictEqual(a.state.orders.length, 1);
  assert.deepStrictEqual(a.onSegment('fx:EURJPY', seg(160, 160, 160, 160)), []);           // still closed: waits
  const back = new PE.PaperAccount(JSON.parse(JSON.stringify(a.state)), rdeps(R));          // survives a reload
  assert.strictEqual(back.state.orders[0].type, 'market'); assert.strictEqual(back.state.orders[0].queued, true);
  open = true;
  const ev = a.onSegment('fx:EURJPY', seg(160.2, 160.3, 160.1, 160.25));
  assert.strictEqual(ev[0].type, 'open'); assert.strictEqual(ev[0].price, 160.2); assert.strictEqual(a.position('fx:EURJPY').sl, 159);
  open = false;   // futures keep the old rule: rejected while closed
  const f = racct(); f.setLast('futures:NQ1!', 21000); open = false;
  assert.throws(() => f.placeOrder({ symbol: 'futures:NQ1!', side: 'buy', type: 'market', qty: 1 }), /Market closed/);
  open = true;
});

t('brackets, TP1 and quantities work in lots', () => {
  const a = racct(); a.setLast('fx:GBPCHF', 1.12);
  a.placeOrder({ symbol: 'fx:GBPCHF', side: 'buy', type: 'market', qty: 0.3, sl: 1.118, tp: 1.124, tp1: 1.122, tp1Qty: 0.1 });
  const ev = a.onSegment('fx:GBPCHF', seg(1.12, 1.1225, 1.1199, 1.122));
  assert.strictEqual(ev[0].type, 'tp1'); assert.strictEqual(a.position('fx:GBPCHF').qty, 0.2);
  assert.strictEqual(a.onSegment('fx:GBPCHF', seg(1.122, 1.1222, 1.1179, 1.118))[0].type, 'sl');
  assert.throws(() => a.placeOrder({ symbol: 'fx:GBPCHF', side: 'buy', type: 'market', qty: 0.001 }), /smallest size is 0.01 lots/);
  assert.strictEqual(a.qtyFor('fx:GBPCHF'), 0.1); assert.strictEqual(a.qtyFor('stocks:NASDAQ:AAPL'), 1);
});

t('migration: an old v1 state (futures + USDT crypto, no quote fields) loads unchanged and keeps trading', () => {
  const old = { v: 1, currency: 'USD', startBalance: 50000, balance: 50210, realized: 210, fees: 4, createdAt: 1, resetAt: 1, nextId: 9,
    settings: { enabled: true, commission: 2, slippage: 0, qty: { 'futures:NQ1!': 2, 'binance:BTCUSDT': 0.05 } },
    positions: { 'futures:NQ1!': { symbol: 'futures:NQ1!', side: 'buy', qty: 2, avg: 21000, sl: 20900, tp: null, openedAt: 5, fees: 4 },
      'binance:BTCUSDT': { symbol: 'binance:BTCUSDT', side: 'sell', qty: 0.5, avg: 60000, openedAt: 6, fees: 0 } },
    orders: [{ id: 7, symbol: 'futures:ES1!', side: 'sell', type: 'limit', qty: 1, price: 6000, placedAt: 7 }],
    trades: [{ id: 3, symbol: 'futures:NQ1!', side: 'buy', qty: 1, entry: 20000, exit: 20010.5, pnl: 210, pointValue: 20 }], history: [] };
  const a = new PE.PaperAccount(JSON.parse(JSON.stringify(old)), rdeps({}));     // no rates at all: USD symbols need none
  assert.strictEqual(a.state.v, PE.VERSION); assert.strictEqual(PE.VERSION, 1);
  assert.deepStrictEqual(Object.keys(a.state.positions).sort(), ['binance:BTCUSDT', 'futures:NQ1!']);
  assert.strictEqual(a.state.orders.length, 1); assert.strictEqual(a.state.trades[0].pnl, 210);
  assert.strictEqual(a.summary().balance, 50210); assert.strictEqual(a.qtyFor('futures:NQ1!'), 2);
  a.setLast('futures:NQ1!', 21010); a.setLast('binance:BTCUSDT', 59900);
  assert.strictEqual(a.summary().unrealized, 400 + 50);
  assert.strictEqual(a.closePosition('futures:NQ1!')[0].trade.pnl, 400 - 4 - 4);
});

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
