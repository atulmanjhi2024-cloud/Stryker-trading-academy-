// MOCK cTrader for the trading tests (Node + browser). A fake WebSocket class for assets/ctrader-trade.js whose other end is the REAL
// relay rules (functions/connect/ctrader/_relay.js + _trade.js) talking to a fake cTrader server below. Nothing leaves the process.
// All numbers are Sample data. M (state) knobs: reject ('NOT_ENOUGH_MONEY' -> OrderErrorEvent), silent (no answer to a write),
// dropOnWrite (the link drops mid-order), scope (0 = view-only token), gates overrides, deals (DealListRes rows), histFail (history calls error).
import { createRelay } from '../../functions/connect/ctrader/_relay.js';
import { tradeHooks } from '../../functions/connect/ctrader/_trade.js';

export const ACC = 77;
export const SYMS = [{ symbolId: 1, symbolName: 'EURUSD', digits: 5 }, { symbolId: 2, symbolName: 'US100', digits: 2 }, { symbolId: 3, symbolName: 'XAUUSD', digits: 2 },
  // suffix variants + the broker's own descriptions (sample data) for the symbol picker test
  { symbolId: 4, symbolName: 'US100.cash', digits: 2 }, { symbolId: 5, symbolName: 'USTEC', digits: 2 }, { symbolId: 6, symbolName: 'NAS100.cash', digits: 2 }];
const DESC = { EURUSD: 'Euro vs US Dollar', US100: 'US Tech 100 Index', XAUUSD: 'Gold vs US Dollar', 'US100.CASH': 'US Tech 100 Cash', USTEC: 'US Tech 100 Index (alt)', 'NAS100.CASH': 'Nasdaq 100 Cash' };
// Sample data: swap / commission / a Mon-Fri schedule (UTC) for the symbol search details pane
const DETAIL = (s) => ({ symbolId: s.symbolId, digits: s.digits, lotSize: 10000000, minVolume: 100000, stepVolume: 100000, maxVolume: 10000000000,
  swapLong: -0.79, swapShort: 0.13, commissionType: 1, preciseTradingCommissionRate: 3000000000, scheduleTimeZone: 'UTC',
  schedule: [1, 2, 3, 4, 5].map((d) => ({ startSecond: d * 86400, endSecond: d * 86400 + 86340 })) });

export function mockState(over = {}) {
  return { positions: [], orders: [], sent: [], n: 100, reject: '', silent: false, dropOnWrite: false, scope: 1, balance: 1000000, lock: null, audits: {}, gate: {}, ...over };
}
export function makeWS(M, { now = () => Date.now() } = {}) {
  const later = (fn) => setTimeout(fn, 5);
  return class FakeWS {
    constructor(url) {
      this.readyState = 0; this.url = url; const self = this;
      const g = {
        isAdmin: async () => { M.gate.adminReads = (M.gate.adminReads || 0) + 1; if (M.gate.adminFail > 0) { M.gate.adminFail--; throw new Error('Firestore error (503)'); } return M.gate.admin !== false; }, switchOn: async () => M.gate.switchOn !== false, consent: async () => M.gate.consent !== false, blocked: async () => !!M.gate.blocked,
        audit: async (entry, id) => { if (M.audits[id]) { const e = new Error('duplicate'); e.duplicate = true; throw e; } M.audits[id] = { ...entry, result: 'attempt' }; return { id, finish: async (r) => Object.assign(M.audits[id], r) }; },
        patchAudit: async (id, r) => Object.assign(M.audits[id] || {}, r),
        lock: { take: async (k) => { if (M.lock) return { ...M.lock }; M.lock = { key: k, at: now() }; return true; }, peek: async () => M.lock, release: async (k) => { if (M.lock && M.lock.key === k) M.lock = null; } },
        defer: (p) => { p.catch(() => {}); }
      };
      const client = { send: (x) => later(() => self.onmessage && self.onmessage({ data: x })), close: (code) => self._closed(code) };
      const up = { send: (x) => later(() => self._ct(JSON.parse(x))), close: () => {} };
      this.hooks = tradeHooks({ uid: 'admin1', account: ACC, envName: /env=live/.test(url) ? 'live' : 'demo', g, now });
      this.relay = createRelay({ client, up, clientId: 'CID', clientSecret: 'SECRET-sample', hooks: this.hooks, now });
      this.hooks.bind(this.relay);
      this.timer = setInterval(() => this.relay.tick(), 200);
      later(() => { this.readyState = 1; this.relay.start(); });
      M.socket = this; M.sockets = (M.sockets || 0) + 1;
    }
    send(x) { if (this.readyState !== 1) throw new Error('closed'); this.relay.onClient(x); }
    close() { this.relay.onClientClose(); }
    _closed(code) { if (this.readyState === 3) return; this.readyState = 3; clearInterval(this.timer); later(() => this.onclose && this.onclose({ code })); }
    _reply(m, payloadType, payload) { this.relay.onUp(JSON.stringify({ payloadType, clientMsgId: m.clientMsgId, payload: { ctidTraderAccountId: ACC, ...payload } })); }
    _ct(m) {   // the fake cTrader server
      const p = m.payload || {}, t = m.payloadType, R = (ty, pl) => this._reply(m, ty, pl);
      M.sent.push(m);
      if (t === 2100) return this.relay.onUp(JSON.stringify({ payloadType: 2101, payload: {} }));
      if (t === 2149) return this.relay.onUp(JSON.stringify({ payloadType: 2150, clientMsgId: m.clientMsgId, payload: { permissionScope: M.scope, ctidTraderAccount: [{ ctidTraderAccountId: ACC, isLive: false, traderLogin: 5551234 }] } }));
      if (t === 2102) return R(2103, {});
      if (t === 2114) return R(2115, { symbol: SYMS.map((s) => ({ symbolId: s.symbolId, symbolName: s.symbolName, description: DESC[s.symbolName.toUpperCase()], baseAssetId: s.symbolName === 'EURUSD' ? 2 : undefined, enabled: true })) });
      if (t === 2116) return R(2117, { symbol: SYMS.filter((s) => p.symbolId.includes(s.symbolId)).map(DETAIL) });
      if (t === 2124) return R(2125, { position: M.positions, order: M.orders });
      if (t === 2121) return R(2122, { trader: { ctidTraderAccountId: ACC, balance: M.balance, moneyDigits: 2, depositAssetId: 1 } });
      if (t === 2112) return R(2113, { asset: [{ assetId: 1, name: 'USD' }, { assetId: 2, name: 'EUR' }] });
      if (t === 2175) { if (M.histFail) return R(2142, { errorCode: 'INTERNAL_ERROR', description: 'Sample failure' }); return R(2176, { order: (M.history || []) }); }
      if (t === 2133) { if (M.histFail) return R(2142, { errorCode: 'INTERNAL_ERROR', description: 'Sample failure' }); return R(2134, { deal: (M.deals || []), hasMore: false }); }
      if (t === 51) return;
      if ([2106, 2108, 2109, 2110, 2111].includes(t)) {
        if (M.dropOnWrite) { M.dropOnWrite = false; return this.relay.onUpClose(); }
        if (M.silent) return;
        if (M.reject) return R(2132, { errorCode: M.reject, description: 'Sample refusal' });
        const id = ++M.n;
        if (t === 2106) {
          (M.history = M.history || []).push({ orderId: id, clientOrderId: p.clientOrderId, positionId: id + 1000 });
          if (p.orderType === 1) {
            const pos = { positionId: id + 1000, positionStatus: 1, price: 18000.5, tradeData: { symbolId: p.symbolId, volume: p.volume, tradeSide: p.tradeSide, label: p.label } };
            M.positions.push(pos);
            return R(2126, { executionType: 3, order: { orderId: id, orderStatus: 2, clientOrderId: p.clientOrderId, tradeData: pos.tradeData }, position: pos });
          }
          const o = { orderId: id, orderStatus: 1, orderType: p.orderType, limitPrice: p.limitPrice, stopPrice: p.stopPrice, tradeData: { symbolId: p.symbolId, volume: p.volume, tradeSide: p.tradeSide, label: p.label } };
          M.orders.push(o); return R(2126, { executionType: 2, order: o });
        }
        if (t === 2108) { const o = M.orders.find((x) => x.orderId === p.orderId); M.orders = M.orders.filter((x) => x.orderId !== p.orderId); return R(2126, { executionType: 5, order: { ...o, orderStatus: 5 } }); }
        if (t === 2109) { const o = M.orders.find((x) => x.orderId === p.orderId); Object.assign(o, p.limitPrice ? { limitPrice: p.limitPrice } : { stopPrice: p.stopPrice }); return R(2126, { executionType: 4, order: o }); }
        if (t === 2110) { const x = M.positions.find((q) => q.positionId === p.positionId); Object.assign(x, { stopLoss: p.stopLoss, takeProfit: p.takeProfit }); return R(2126, { executionType: 4, position: x }); }
        if (t === 2111) { const x = M.positions.find((q) => q.positionId === p.positionId); x.tradeData.volume -= p.volume; if (!x.tradeData.volume) M.positions = M.positions.filter((q) => q !== x); return R(2126, { executionType: 3, position: { ...x, positionStatus: x.tradeData.volume ? 1 : 2 }, order: { orderId: id } }); }
      }
    }
  };
}
