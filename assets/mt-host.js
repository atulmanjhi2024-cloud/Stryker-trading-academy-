// MetaTrader accounts hosted by TradeZoro (Owner order 22 Nov 2026: sign in with login, password and server; nothing to run on your PC).
// Pure helpers: turn the host's answers (functions/connect/mt/[op].js -> tools/mthost) into the records the order panel already reads
// (positions / orders / balance rows in the broker-link shape), and the panel's order bodies into host calls. No DOM, no network here:
// chart-live.js passes in its own `call` (ID token + JSON).
export const HOST_ID = /^mt:[a-f0-9]{16}$/;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const iso = (s) => (s > 0 ? new Date(s * 1000).toISOString() : '');
const ORDER_KIND = { 2: ['buy', 'limit'], 3: ['sell', 'limit'], 4: ['buy', 'stop'], 5: ['sell', 'stop'], 6: ['buy', 'stop_limit'], 7: ['sell', 'stop_limit'] };

// host account record -> what chart-live-core acctInfo reads
export function hostAccountRecord(a) {
  const mode = a && a.mode === 'investor' ? 'investor' : 'trading';
  return { accountId: 'mt:' + a.id, brokerName: a.platform === 'mt4' ? 'MetaTrader 4' : 'MetaTrader 5', accountNumber: String(a.login || ''), accountName: String(a.name || ''), currencyCode: String(a.currency || ''), host: true, hostId: a.id, readOnly: mode === 'investor', server: a.server, syncStatus: { status: 'synced', lastSyncedAt: Date.now() } };
}
export const positionRows = (r) => (Array.isArray(r && r.positions) ? r.positions : []).map((p) => ({ positionId: String(p.ticket), symbol: p.symbol, quantity: num(p.volume), side: num(p.type) === 1 ? 'SHORT' : 'LONG', averagePrice: num(p.price_open), unrealizedProfitLoss: num(p.profit), sl: num(p.sl) || null, tp: num(p.tp) || null, status: 'OPEN', positionUpdatedAt: iso(num(p.time)) }));
export const orderRows = (r) => (Array.isArray(r && r.orders) ? r.orders : []).map((o) => { const k = ORDER_KIND[num(o.type)] || ['buy', 'limit']; const row = { orderId: String(o.ticket), symbol: o.symbol, status: 'OPEN', action: k[0], orderType: k[1], orderQty: num(o.volume_current), sl: num(o.sl) || null, tp: num(o.tp) || null }; if (k[1] === 'stop') row.stopPrice = num(o.price_open); else row.limitPrice = num(o.price_open); return row; });
export const balanceRows = (a, at) => [{ equity: num(a && a.equity), balance: num(a && a.balance), currencyCode: String((a && a.currency) || ''), unrealizedPnl: num(a && a.profit), updatedAt: at }];

// panel body (Finatic-shaped) -> { op, args } for POST /connect/mt/op, or { error }
export function toHostOrder(b) {
  if (b.op === 'place') {
    const a = { symbol: b.symbol, side: b.side, type: b.type, volume: b.qty };
    if (b.type === 'limit') a.price = b.limitPrice; else if (b.type === 'stop') a.price = b.stopPrice;
    if (b.slPrice > 0) a.sl = b.slPrice; if (b.tpPrice > 0) a.tp = b.tpPrice;
    return { op: 'place', args: a };
  }
  if (b.op === 'cancel') return { op: 'cancel', args: { ticket: b.orderId } };
  if (b.op === 'close') return { op: 'close', args: { ticket: b.orderId } };
  if (b.op === 'modify') { const a = { ticket: b.orderId }; const p = b.type === 'stop' ? b.stopPrice : b.limitPrice; if (p > 0) a.price = p; if (b.slPrice != null) a.sl = b.slPrice; if (b.tpPrice != null) a.tp = b.tpPrice; return { op: 'modify', args: a }; }
  return { error: 'Not allowed' };
}
// host answer -> what write() reads ({status, orderId}); a broker refusal (200 with ok:false) becomes an Error with the broker's words
export function orderResult(r) {
  if (r && r.ok) return { status: r.comment || 'accepted', orderId: String(r.order || r.deal || '') };
  const e = new Error(r && r.comment ? 'The broker said: ' + r.comment : r && r.error === 'symbol_unknown' ? 'The broker does not list that symbol.' : r && r.error === 'not_found' ? 'That position or order is gone.' : 'The broker refused the order.');
  e.status = 400; e.code = 'broker_refused'; throw e;
}
// the "schema" the panel's symbol map reads: the account's symbol names as an enum
export const symbolSchema = (r) => ({ symbols: { enum: (Array.isArray(r && r.symbols) ? r.symbols : []).map((s) => (typeof s === 'string' ? s : s && s.name)).filter(Boolean) } });
