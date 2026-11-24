// BROKERS 3: the three broker adapters behind /connect/brokers/trade (Owner 24 Nov 2026). ONE shape for all:
//   adapter.accounts(x)            -> [{ accountId, accountNumber, accountName, kind }]
//   adapter.live(x, acct)          -> { positions, orders }      (the shapes assets/chart-live-core.js reads)
//   adapter.balances(x, acct)      -> [{ netLiquidationValue | balance, currency, unrealizedPnl, updatedAt }]
//   adapter.schema(x, acct)        -> { supportedOrderTypesByAssetClass, symbols?, rules? }
//   adapter.place(x, acct, o, key) -> { ok, status, orderId, bracket? }    o = checked order (see trade.js clean())
//   adapter.cancel / modify / flatten / find(key)
// x = { call(method, path, body, opts) } bound to ONE broker + env + the member's token by trade.js (every call goes through
// _hosts.js guardFetch: a live host is unreachable while that broker's live flag is off). Errors thrown here carry .origin
// ('broker' = the broker said it, 'ours' = TradeZoro refused) and plain words. Nothing here logs a token, a price or an account.
import { toBroker, fromBroker, oandaInstrument, oandaDisplay, oandaRules, unitsOf, roundPx } from '../../../assets/broker-trade-map.js';

export const ours = (msg, code = 'refused', status = 400) => Object.assign(new Error('TradeZoro: ' + msg), { origin: 'ours', code, status });
const S = (v) => (v == null ? '' : String(v));
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const items = (j) => (j && j.data && Array.isArray(j.data.items) ? j.data.items : []);
// close-or-open for brokers that need it (tastytrade actions, TradeStation equities). Crossing through zero in one order is refused.
function openClose(side, held, qty) {
  if (side === 'buy') { if (held < 0 && qty > -held) throw ours('close the short position first, then buy.', 'cross'); return held < 0 ? 'close' : 'open'; }
  if (held > 0 && qty > held) throw ours('close the long position first, then sell.', 'cross'); return held > 0 ? 'close' : 'open';
}
const heldOf = (positions, code) => positions.filter((p) => S(p.symbol).toUpperCase() === S(code).toUpperCase()).reduce((n, p) => n + N(p.quantity), 0);
const kindOf = (code, asset) => (asset === 'option' ? 'option' : /^[A-Z0-9]{1,4}?[FGHJKMNQUVXZ]\d{1,2}$/.test(S(code).toUpperCase()) ? 'future' : 'equity');

// ================================================================================================ tastytrade
const TT_WORK = { received: 'RECEIVED', routed: 'WORKING', 'in flight': 'WORKING', live: 'WORKING', contingent: 'PENDING', 'replace requested': 'PENDING_REPLACE', 'cancel requested': 'PENDING_CANCEL', filled: 'FILLED', cancelled: 'CANCELLED', expired: 'EXPIRED', rejected: 'REJECTED', removed: 'CANCELLED', 'partially removed': 'CANCELLED' };
const ttType = { market: 'Market', limit: 'Limit', stop: 'Stop', stop_limit: 'Stop Limit' };
const ttInstr = { future: 'Future', equity: 'Equity', option: 'Equity Option' };
function ttOrder(o) {
  const legs = (o.legs || []).map((l) => ({ symbol: fromBroker('tastytrade', l.symbol), side: /^buy/i.test(S(l.action)) ? 'buy' : 'sell', quantity: N(l.quantity), remainingQuantity: l['remaining-quantity'] != null ? N(l['remaining-quantity']) : undefined, limitPrice: o.price != null ? N(o.price) : undefined, stopPrice: o['stop-trigger'] != null ? N(o['stop-trigger']) : undefined, instrumentType: S(l['instrument-type']) }));
  const t = S(o['order-type']).toLowerCase().replace(' ', '_');
  return { orderId: S(o.id), status: TT_WORK[S(o.status).toLowerCase()] || S(o.status).toUpperCase(), orderType: t, complexOrderId: o['complex-order-id'] != null ? S(o['complex-order-id']) : undefined, externalId: S(o['external-identifier']), legs };
}
function ttLeg(o, action, sym) { return { 'instrument-type': ttInstr[o.kind], symbol: sym, quantity: o.qty, action }; }
function ttAction(o, oc) { return (o.side === 'buy' ? 'Buy' : 'Sell') + (oc === 'close' ? ' to Close' : ' to Open'); }
function ttBody(o, sym, action, key) {
  const b = { 'time-in-force': o.type === 'market' ? 'Day' : (o.tif === 'gtc' ? 'GTC' : 'Day'), 'order-type': ttType[o.type], legs: [ttLeg(o, action, sym)], source: 'TradeZoro' };
  if (key) b['external-identifier'] = key;
  if (o.type === 'limit' || o.type === 'stop_limit') { b.price = String(o.limitPrice); b['price-effect'] = o.side === 'buy' ? 'Debit' : 'Credit'; }
  if (o.type === 'stop' || o.type === 'stop_limit') b['stop-trigger'] = String(o.stopPrice);
  return b;
}
export const tastytrade = {
  async accounts(x) {
    const j = await x.call('GET', '/customers/me/accounts');
    return items(j).map((it) => it.account || it).filter((a) => a && a['account-number']).map((a) => ({ accountId: S(a['account-number']), accountNumber: S(a['account-number']), accountName: S(a.nickname || a['account-type-name'] || a['account-number']), kind: S(a['margin-or-cash']) }));
  },
  async live(x, acct) {
    const [p, o] = await Promise.all([x.call('GET', '/accounts/' + acct + '/positions'), x.call('GET', '/accounts/' + acct + '/orders/live')]);
    const positions = items(p).map((r) => { const q = N(r.quantity) * (/short/i.test(S(r['quantity-direction'])) ? -1 : 1); return { symbol: fromBroker('tastytrade', r.symbol), brokerSymbol: S(r.symbol), instrumentType: S(r['instrument-type']), quantity: q, averagePrice: N(r['average-open-price']) || null, status: 'OPEN' }; }).filter((r) => r.quantity);
    return { positions, orders: items(o).map(ttOrder) };
  },
  async balances(x, acct) {
    const j = await x.call('GET', '/accounts/' + acct + '/balances'), d = (j && j.data) || {};
    return [{ netLiquidationValue: N(d['net-liquidating-value']), cashBalance: N(d['cash-balance']), currency: S(d.currency || 'USD'), updatedAt: S(d['updated-at']) || new Date().toISOString() }];
  },
  async schema() { return { supportedOrderTypesByAssetClass: { future: ['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT'], equity: ['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT'], option: ['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT'] } }; },
  async place(x, acct, o, key) {
    const sym = toBroker('tastytrade', o.symbol, o.kind); if (!sym) throw ours('tastytrade does not take ' + o.symbol + ' in that form.', 'symbol');
    const st = await this.live(x, acct), action = ttAction(o, openClose(o.side, heldOf(st.positions, o.symbol), o.qty));
    if (!o.bracket) {
      const j = await x.call('POST', '/accounts/' + acct + '/orders', ttBody(o, sym, action, key), { write: true });
      const ord = (j && j.data && j.data.order) || {};
      return { ok: true, status: TT_WORK[S(ord.status).toLowerCase()] || S(ord.status).toUpperCase() || 'RECEIVED', orderId: S(ord.id) };
    }
    // stop loss + take profit: one OTOCO (the entry, then a profit Limit and a Stop that cancel each other)
    const exit = o.side === 'buy' ? 'sell' : 'buy', ca = (exit === 'buy' ? 'Buy' : 'Sell') + ' to Close';
    const ex = (t, px) => ({ 'order-type': t === 'limit' ? 'Limit' : 'Stop', 'time-in-force': 'GTC', ...(t === 'limit' ? { price: String(px), 'price-effect': exit === 'buy' ? 'Debit' : 'Credit' } : { 'stop-trigger': String(px) }), legs: [ttLeg(o, ca, sym)] });
    const orders = []; if (o.bracket.tp != null) orders.push(ex('limit', o.bracket.tp)); if (o.bracket.sl != null) orders.push(ex('stop', o.bracket.sl));
    const body = { type: orders.length === 2 ? 'OTOCO' : 'OTO', 'trigger-order': ttBody(o, sym, action, key), orders };
    const j = await x.call('POST', '/accounts/' + acct + '/complex-orders', body, { write: true });
    const co = (j && j.data && j.data['complex-order']) || {};
    return { ok: true, status: 'RECEIVED', orderId: S(co['trigger-order'] && co['trigger-order'].id), complexOrderId: S(co.id), bracket: { native: true } };
  },
  async cancel(x, acct, id) {
    const st = await this.live(x, acct), o = st.orders.find((r) => r.orderId === id); if (!o) throw ours('that order is not working on this account any more.', 'unknown_order');
    if (o.complexOrderId) await x.call('DELETE', '/accounts/' + acct + '/complex-orders/' + encodeURIComponent(o.complexOrderId), null, { write: true });
    else await x.call('DELETE', '/accounts/' + acct + '/orders/' + encodeURIComponent(id), null, { write: true });
    return { ok: true, status: 'PENDING_CANCEL', orderId: id };
  },
  async modify(x, acct, id, m) {
    const j = await x.call('GET', '/accounts/' + acct + '/orders/' + encodeURIComponent(id)), r = (j && j.data) || {};
    if (!r.id) throw ours('that order is not working on this account any more.', 'unknown_order');
    const b = { 'order-type': r['order-type'], 'time-in-force': r['time-in-force'], legs: (r.legs || []).map((l) => ({ 'instrument-type': l['instrument-type'], symbol: l.symbol, quantity: N(l.quantity), action: l.action })) };
    if (r.price != null) { b.price = String(m.limitPrice != null ? m.limitPrice : r.price); b['price-effect'] = r['price-effect']; }
    if (r['stop-trigger'] != null) b['stop-trigger'] = String(m.stopPrice != null ? m.stopPrice : r['stop-trigger']);
    if (m.limitPrice != null && r.price == null) throw ours('only a limit order has a limit price to move.', 'shape');
    if (m.stopPrice != null && r['stop-trigger'] == null) throw ours('only a stop order has a stop price to move.', 'shape');
    await x.call('PUT', '/accounts/' + acct + '/orders/' + encodeURIComponent(id), b, { write: true });
    return { ok: true, status: 'PENDING_REPLACE', orderId: id };
  },
  async flatten(x, acct, code, key) {
    const st = await this.live(x, acct), same = (s) => S(s).toUpperCase() === S(code).toUpperCase();
    const work = st.orders.filter((o) => (o.legs || []).some((l) => same(l.symbol)) && /WORK|RECEIV|PENDING/.test(o.status));
    for (const o of work) await this.cancel(x, acct, o.orderId).catch(() => null);
    const pos = st.positions.filter((p) => same(p.symbol));
    let closed = 0;
    for (const p of pos) {
      const side = p.quantity > 0 ? 'sell' : 'buy', kind = /option/i.test(p.instrumentType) ? 'option' : /future/i.test(p.instrumentType) ? 'future' : 'equity';
      const o = { symbol: p.symbol, side, qty: Math.abs(p.quantity), type: 'market', kind };
      await x.call('POST', '/accounts/' + acct + '/orders', ttBody(o, p.brokerSymbol, ttAction(o, 'close'), key + '-c' + (++closed)), { write: true });
    }
    return { ok: true, op: 'flatten', closed: pos.length, cancelled: work.length };
  },
  // an unclear place: did an order with our external-identifier reach tastytrade? (searched in today's live orders)
  async find(x, acct, key) { const j = await x.call('GET', '/accounts/' + acct + '/orders/live'); const o = items(j).find((r) => S(r['external-identifier']) === key); return o ? ttOrder(o) : null; },
  errorText(j) { const e = j && j.error; if (!e) return ''; const sub = Array.isArray(e.errors) && e.errors[0] ? (e.errors[0].message || e.errors[0].reason || e.errors[0].code) : ''; return S(sub || e.message || e.code); }
};

// ================================================================================================ TradeStation (API v3)
const TS_STATUS = { ACK: 'RECEIVED', DON: 'PENDING', OPN: 'WORKING', FPR: 'PARTIALLY_FILLED', UCH: 'PENDING_REPLACE', UCN: 'PENDING_CANCEL', FLL: 'FILLED', FLP: 'FILLED', OUT: 'CANCELLED', CAN: 'CANCELLED', REJ: 'REJECTED', EXP: 'EXPIRED', BRO: 'CANCELLED', TSC: 'CANCELLED', LAT: 'REJECTED', OSO: 'PENDING', OSP: 'PENDING', RSN: 'WORKING', PLA: 'WORKING', SUS: 'PENDING', DOA: 'RECEIVED' };
const tsType = { market: 'Market', limit: 'Limit', stop: 'StopMarket', stop_limit: 'StopLimit' };
function tsOrder(o) {
  const t = S(o.OrderType).toLowerCase(), ty = t === 'stopmarket' ? 'stop' : t === 'stoplimit' ? 'stop_limit' : t;
  const legs = (o.Legs || []).map((l) => ({ symbol: fromBroker('tradestation', l.Symbol), side: /^buy/i.test(S(l.BuyOrSell || l.TradeAction)) ? 'buy' : 'sell', quantity: N(l.QuantityOrdered), remainingQuantity: l.QuantityRemaining != null ? N(l.QuantityRemaining) : undefined, limitPrice: o.LimitPrice != null ? N(o.LimitPrice) : undefined, stopPrice: o.StopPrice != null ? N(o.StopPrice) : undefined }));
  return { orderId: S(o.OrderID), status: TS_STATUS[S(o.Status)] || S(o.Status).toUpperCase(), orderType: ty, groupName: S(o.GroupName), legs };
}
function tsAction(o, oc) {
  if (o.kind === 'future') return o.side === 'buy' ? 'BUY' : 'SELL';
  if (o.kind === 'option') return o.side === 'buy' ? (oc === 'close' ? 'BUYTOCLOSE' : 'BUYTOOPEN') : (oc === 'close' ? 'SELLTOCLOSE' : 'SELLTOOPEN');
  return o.side === 'buy' ? (oc === 'close' ? 'BUYTOCOVER' : 'BUY') : (oc === 'close' ? 'SELL' : 'SELLSHORT');
}
function tsBody(acct, o, sym, action) {
  const b = { AccountID: acct, Symbol: sym, Quantity: String(o.qty), OrderType: tsType[o.type], TradeAction: action, TimeInForce: { Duration: o.type === 'market' ? 'DAY' : (o.tif === 'gtc' ? 'GTC' : 'DAY') }, Route: 'Intelligent' };
  if (o.type === 'limit' || o.type === 'stop_limit') b.LimitPrice = String(o.limitPrice);
  if (o.type === 'stop' || o.type === 'stop_limit') b.StopPrice = String(o.stopPrice);
  return b;
}
const tsIds = (j) => { const e = (j && Array.isArray(j.Errors) && j.Errors[0]) || null; if (e) throw Object.assign(new Error('TradeStation said: ' + S(e.Message || e.Error).slice(0, 200)), { origin: 'broker', code: 'rejected', status: 400 }); return (j && Array.isArray(j.Orders) ? j.Orders : []).map((r) => S(r.OrderID)); };
export const tradestation = {
  async accounts(x, envName) {
    const j = await x.call('GET', '/v3/brokerage/accounts');
    return (j && Array.isArray(j.Accounts) ? j.Accounts : []).filter((a) => a && a.AccountID && (envName === 'live' || /^SIM/i.test(S(a.AccountID))) && !/closed/i.test(S(a.Status))).map((a) => ({ accountId: S(a.AccountID), accountNumber: S(a.AccountID), accountName: S(a.AccountID), kind: S(a.AccountType) }));
  },
  async live(x, acct) {
    const [p, o] = await Promise.all([x.call('GET', '/v3/brokerage/accounts/' + acct + '/positions'), x.call('GET', '/v3/brokerage/accounts/' + acct + '/orders')]);
    const positions = (p && Array.isArray(p.Positions) ? p.Positions : []).map((r) => ({ symbol: fromBroker('tradestation', r.Symbol), brokerSymbol: S(r.Symbol), assetType: S(r.AssetType), quantity: Math.abs(N(r.Quantity)) * (/short/i.test(S(r.LongShort)) ? -1 : 1), averagePrice: N(r.AveragePrice) || null, unrealizedProfitLoss: r.UnrealizedProfitLoss != null ? N(r.UnrealizedProfitLoss) : undefined, status: 'OPEN' })).filter((r) => r.quantity);
    return { positions, orders: (o && Array.isArray(o.Orders) ? o.Orders : []).map(tsOrder) };
  },
  async balances(x, acct) {
    const j = await x.call('GET', '/v3/brokerage/accounts/' + acct + '/balances'), b = (j && Array.isArray(j.Balances) && j.Balances[0]) || {};
    return [{ netLiquidationValue: N(b.Equity), cashBalance: N(b.CashBalance), unrealizedPnl: b.BalanceDetail && b.BalanceDetail.UnrealizedProfitLoss != null ? N(b.BalanceDetail.UnrealizedProfitLoss) : undefined, currency: 'USD', updatedAt: new Date().toISOString() }];
  },
  async schema() { return { supportedOrderTypesByAssetClass: { future: ['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT'], equity: ['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT'], option: ['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT'] } }; },
  async place(x, acct, o) {
    const sym = toBroker('tradestation', o.symbol, o.kind); if (!sym) throw ours('TradeStation does not take ' + o.symbol + ' in that form.', 'symbol');
    let oc = 'open'; if (o.kind !== 'future') oc = openClose(o.side, heldOf((await this.live(x, acct)).positions, o.symbol), o.qty);
    const body = tsBody(acct, o, sym, tsAction(o, oc));
    if (o.bracket) {   // the entry sends a BRK group (profit limit + stop, one cancels the other) once it fills: OSO
      const exit = { ...o, side: o.side === 'buy' ? 'sell' : 'buy' }, ea = tsAction(exit, 'close'), kids = [];
      if (o.bracket.tp != null) kids.push(tsBody(acct, { ...exit, type: 'limit', limitPrice: o.bracket.tp, tif: 'gtc' }, sym, ea));
      if (o.bracket.sl != null) kids.push(tsBody(acct, { ...exit, type: 'stop', stopPrice: o.bracket.sl, tif: 'gtc' }, sym, ea));
      body.OSOs = [{ Type: kids.length === 2 ? 'BRK' : 'NORMAL', Orders: kids }];
    }
    const ids = tsIds(await x.call('POST', '/v3/orderexecution/orders', body, { write: true }));
    return { ok: true, status: 'RECEIVED', orderId: ids[0] || '', bracket: o.bracket ? { native: true } : undefined };
  },
  async cancel(x, acct, id) { await x.call('DELETE', '/v3/orderexecution/orders/' + encodeURIComponent(id), null, { write: true }); return { ok: true, status: 'PENDING_CANCEL', orderId: id }; },
  async modify(x, acct, id, m) {
    const b = m.limitPrice != null ? { LimitPrice: String(m.limitPrice) } : { StopPrice: String(m.stopPrice) };
    await x.call('PUT', '/v3/orderexecution/orders/' + encodeURIComponent(id), b, { write: true });
    return { ok: true, status: 'PENDING_REPLACE', orderId: id };
  },
  async flatten(x, acct, code) {
    const st = await this.live(x, acct), same = (s) => S(s).toUpperCase() === S(code).toUpperCase();
    const work = st.orders.filter((o) => (o.legs || []).some((l) => same(l.symbol)) && /WORK|RECEIV|PENDING|PARTIAL/.test(o.status));
    for (const o of work) await this.cancel(x, acct, o.orderId).catch(() => null);
    const pos = st.positions.filter((p) => same(p.symbol));
    for (const p of pos) {
      const kind = /FUTURE/i.test(p.assetType) ? 'future' : /OPTION/i.test(p.assetType) ? 'option' : 'equity', o = { side: p.quantity > 0 ? 'sell' : 'buy', qty: Math.abs(p.quantity), type: 'market', kind };
      tsIds(await x.call('POST', '/v3/orderexecution/orders', tsBody(acct, o, p.brokerSymbol, tsAction(o, 'close')), { write: true }));
    }
    return { ok: true, op: 'flatten', closed: pos.length, cancelled: work.length };
  },
  async find() { return null; },   // TradeStation has no client order id on v3 orders: an unclear place stays 'unknown'
  errorText(j) { return j ? S(j.Message || j.Error || (Array.isArray(j.Errors) && j.Errors[0] && (j.Errors[0].Message || j.Errors[0].Error)) || '') : ''; }
};

// ================================================================================================ OANDA (v20)
const OA_TYPES = new Set(['LIMIT', 'STOP', 'MARKET_IF_TOUCHED']);
function oaOrder(o) {
  const t = S(o.type).toLowerCase(), u = N(o.units), inst = S(o.instrument);
  return { orderId: S(o.id), status: S(o.state) === 'PENDING' ? 'WORKING' : S(o.state), orderType: t === 'limit' ? 'limit' : 'stop', clientId: S(o.clientExtensions && o.clientExtensions.id), legs: [{ symbol: oandaDisplay(inst), instrument: inst, side: u < 0 ? 'sell' : 'buy', quantity: Math.abs(u), limitPrice: t === 'limit' ? N(o.price) : undefined, stopPrice: t !== 'limit' ? N(o.price) : undefined }] };
}
async function oaRules(x, acct, inst) {
  const j = await x.call('GET', '/v3/accounts/' + acct + '/instruments?instruments=' + encodeURIComponent(inst));
  const r = j && Array.isArray(j.instruments) && j.instruments[0]; if (!r) throw ours('OANDA does not list ' + inst + ' on this account.', 'symbol');
  return oandaRules(r);
}
export const oanda = {
  async accounts(x) {
    const j = await x.call('GET', '/v3/accounts');
    return (j && Array.isArray(j.accounts) ? j.accounts : []).filter((a) => a && a.id).map((a) => ({ accountId: S(a.id), accountNumber: S(a.id), accountName: S(a.id), kind: 'forex' }));
  },
  async live(x, acct) {
    const [p, o] = await Promise.all([x.call('GET', '/v3/accounts/' + acct + '/openPositions'), x.call('GET', '/v3/accounts/' + acct + '/pendingOrders')]);
    const positions = [];
    for (const r of (p && p.positions) || []) for (const sd of ['long', 'short']) {
      const s = r[sd]; if (!s || !N(s.units)) continue;
      positions.push({ symbol: oandaDisplay(r.instrument), instrument: S(r.instrument), quantity: N(s.units) / oandaRules({ name: r.instrument }).lotSize, units: N(s.units), averagePrice: N(s.averagePrice) || null, unrealizedProfitLoss: N(s.unrealizedPL), status: 'OPEN' });
    }
    // entry orders only (the stop loss / take profit of an open trade belong to the trade, not to a symbol row)
    const orders = ((o && o.orders) || []).filter((r) => OA_TYPES.has(S(r.type)) && r.instrument).map((r) => { const m = oaOrder(r), L = oandaRules({ name: r.instrument }).lotSize; m.legs[0].quantity = m.legs[0].quantity / L; return m; });
    return { positions, orders };
  },
  async balances(x, acct) {
    const j = await x.call('GET', '/v3/accounts/' + acct + '/summary'), a = (j && j.account) || {};
    return [{ netLiquidationValue: N(a.NAV), balance: N(a.balance), unrealizedPnl: N(a.unrealizedPL), currency: S(a.currency), updatedAt: new Date().toISOString() }];
  },
  async schema(x, acct) {
    const j = await x.call('GET', '/v3/accounts/' + acct + '/instruments'), list = (j && j.instruments) || [];
    const rules = {}; for (const r of list) rules[oandaDisplay(r.name)] = oandaRules(r);
    return { symbols: { enum: Object.keys(rules) }, rules, supportedOrderTypesByAssetClass: { forex: ['MARKET', 'LIMIT', 'STOP'], cfd: ['MARKET', 'LIMIT', 'STOP'] } };
  },
  async place(x, acct, o, key) {
    const inst = oandaInstrument(o.symbol); if (!inst) throw ours('OANDA has no instrument for ' + o.symbol + '.', 'symbol');
    const r = await oaRules(x, acct, inst), units = unitsOf(o.qty, r);
    if (!(Math.abs(units) > 0) || o.qty < r.min - 1e-9 || o.qty > r.max + 1e-9) throw ours('size is ' + r.min + ' to ' + r.max + ' lots for ' + oandaDisplay(inst) + '.', 'volume');
    const px = (v) => roundPx(v, Math.pow(10, -r.priceDp)).toFixed(r.priceDp);
    const ord = { type: o.type === 'market' ? 'MARKET' : o.type === 'limit' ? 'LIMIT' : 'STOP', instrument: inst, units: String(o.side === 'sell' ? -units : units), positionFill: 'DEFAULT', timeInForce: o.type === 'market' ? 'FOK' : 'GTC', clientExtensions: { id: key.slice(0, 64), tag: 'TradeZoro' } };
    if (o.type === 'limit') ord.price = px(o.limitPrice); if (o.type === 'stop') ord.price = px(o.stopPrice);
    if (o.bracket && o.bracket.sl != null) ord.stopLossOnFill = { price: px(o.bracket.sl), timeInForce: 'GTC' };
    if (o.bracket && o.bracket.tp != null) ord.takeProfitOnFill = { price: px(o.bracket.tp), timeInForce: 'GTC' };
    const j = await x.call('POST', '/v3/accounts/' + acct + '/orders', { order: ord }, { write: true });
    if (j && j.orderCancelTransaction && !j.orderFillTransaction) throw Object.assign(new Error('OANDA said: ' + S(j.orderCancelTransaction.reason || 'cancelled').replace(/_/g, ' ').toLowerCase()), { origin: 'broker', code: 'rejected', status: 400 });
    return { ok: true, status: j && j.orderFillTransaction ? 'FILLED' : 'WORKING', orderId: S(j && j.orderCreateTransaction && j.orderCreateTransaction.id), bracket: o.bracket ? { native: true } : undefined, lastTransactionID: S(j && j.lastTransactionID) };
  },
  async cancel(x, acct, id) { await x.call('PUT', '/v3/accounts/' + acct + '/orders/' + encodeURIComponent(id) + '/cancel', null, { write: true }); return { ok: true, status: 'CANCELLED', orderId: id }; },
  async modify(x, acct, id, m) {
    const j = await x.call('GET', '/v3/accounts/' + acct + '/orders/' + encodeURIComponent(id)), r = (j && j.order) || {};
    if (!OA_TYPES.has(S(r.type)) || S(r.state) !== 'PENDING') throw ours('that order is not working on this account any more.', 'unknown_order');
    const rules = await oaRules(x, acct, r.instrument), p = m.limitPrice != null ? m.limitPrice : m.stopPrice;
    const ord = { type: r.type, instrument: r.instrument, units: S(r.units), price: roundPx(p, Math.pow(10, -rules.priceDp)).toFixed(rules.priceDp), timeInForce: r.timeInForce || 'GTC', positionFill: r.positionFill || 'DEFAULT' };
    if (r.stopLossOnFill) ord.stopLossOnFill = r.stopLossOnFill; if (r.takeProfitOnFill) ord.takeProfitOnFill = r.takeProfitOnFill;
    const k = await x.call('PUT', '/v3/accounts/' + acct + '/orders/' + encodeURIComponent(id), { order: ord }, { write: true });
    return { ok: true, status: 'WORKING', orderId: S(k && k.orderCreateTransaction && k.orderCreateTransaction.id) || id };
  },
  async flatten(x, acct, code) {
    const inst = oandaInstrument(code); if (!inst) throw ours('OANDA has no instrument for ' + code + '.', 'symbol');
    const st = await this.live(x, acct), work = st.orders.filter((o) => o.legs[0].instrument === inst);
    for (const o of work) await this.cancel(x, acct, o.orderId).catch(() => null);
    const pos = st.positions.filter((p) => p.instrument === inst);
    if (pos.length) await x.call('PUT', '/v3/accounts/' + acct + '/positions/' + inst + '/close', { ...(pos.some((p) => p.units > 0) ? { longUnits: 'ALL' } : {}), ...(pos.some((p) => p.units < 0) ? { shortUnits: 'ALL' } : {}) }, { write: true });
    return { ok: true, op: 'flatten', closed: pos.length, cancelled: work.length };
  },
  // OANDA keeps our client id on the order: "@<id>" finds it whatever its state
  async find(x, acct, key) { try { const j = await x.call('GET', '/v3/accounts/' + acct + '/orders/@' + encodeURIComponent(key.slice(0, 64))); return j && j.order ? oaOrder(j.order) : null; } catch (e) { if (e.status === 404) return null; throw e; } },
  // fills since a transaction id (the chart's status feed between reads; trade.js 'events')
  async events(x, acct, since) {
    if (!since) { const j = await x.call('GET', '/v3/accounts/' + acct + '/summary'); return { last: S(j && j.lastTransactionID), events: [] }; }
    const j = await x.call('GET', '/v3/accounts/' + acct + '/transactions/sinceid?id=' + encodeURIComponent(since));
    const ev = ((j && j.transactions) || []).filter((t) => /ORDER_FILL|ORDER_CANCEL|STOP_LOSS|TAKE_PROFIT|ORDER_REJECT/.test(S(t.type))).map((t) => ({ type: S(t.type), id: S(t.id), orderId: S(t.orderID), instrument: S(t.instrument), reason: S(t.reason) }));
    return { last: S(j && j.lastTransactionID) || since, events: ev };
  },
  errorText(j) { return j ? S(j.errorMessage || (j.orderRejectTransaction && j.orderRejectTransaction.rejectReason) || j.errorCode || '').replace(/_/g, ' ') : ''; }
};
export const ADAPTERS = { tastytrade, tradestation, oanda };
export { kindOf };
