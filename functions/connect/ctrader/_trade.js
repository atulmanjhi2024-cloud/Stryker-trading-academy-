// cTrader Open API TRADING relay rules (pure core, testable). ADMINS AND BETA TESTERS only for now (Owner 23 Nov: "live trading through our own
// cTrader connection"). Used by trade.js through createRelay's hooks (_relay.js): the same parse-once / per-type schema / REBUILD rule
// as the data relay, plus, for every WRITE (new order, amend, cancel, amend SL/TP, close position), in this order:
//   1. a well-formed idempotency key = the frame's clientMsgId (16-50 chars); it becomes the order's clientOrderId and the audit doc id
//   2. one write in flight per socket, 2 a second, 30 a minute
//   3. server-side checks against what THIS socket learned from cTrader for its ONE pinned account: the symbol's volume rules
//      (min / step / max from SymbolByIdRes, plus our cap CTRADER_MAX_LOTS lots, default 10), order ids and position ids that
//      ReconcileRes / ExecutionEvent named, the close volume not above the position
//   4. the gates, every one fails CLOSED: admin or beta tester (admins/{uid}, settings/betaTesters), master switch settings/liveTrading (enabled:false = refused),
//      the one-time "Enable live trading" acceptance (liveConsent/{uid}), the per-member block settings/liveBlocked
//   5. the account lock brokerLocks/ct_<account> (Firestore create-only, shared by every tab, socket and server isolate): one write
//      in flight per cTrader account. It is released when cTrader answers. An unclear write ('unknown') KEEPS it, and only this server
//      clears it, after an OrderListReq shows whether that clientOrderId reached cTrader (found = accepted, absent = not_found).
//      Never retried by the server (advisor review 23 Nov: C1 / C2 / H5)
//   6. the audit row brokerOrderAudit/ct-<key>, created BEFORE the frame goes out (Firestore create-only: an existing key = 409 =
//      "duplicate", the frame is never sent twice; no audit, no order)
//   7. only then the rebuilt frame goes to cTrader (label "TradeZoro", clientOrderId = key on a new order)
// The answer (ExecutionEvent / OrderErrorEvent / ErrorRes with the same clientMsgId) finishes the audit row with the result and the
// broker's order / position id. No answer in ANSWER_MS, or the socket closes first = 'unknown' (the browser blocks new orders until a
// fresh Reconcile has landed). A refused write never closes the socket: the browser gets { relay:'refused', clientMsgId, code, error }.
// Nothing here logs a token, a secret or a price.
const P = 'ctidTraderAccountId';
export const TRADE_ALLOW = {
  2102: { [P]: 'i!', accessToken: 'tok!' },                       // AccountAuth
  2149: { accessToken: 'tok!' },                                   // GetAccountListByAccessToken
  2114: { [P]: 'i!', includeArchivedSymbols: 'b' },                // SymbolsList (names)
  2116: { [P]: 'i!', symbolId: 'ids!' },                           // SymbolById (volume rules)
  2121: { [P]: 'i!' },                                             // TraderReq (balance)
  2112: { [P]: 'i!' },                                             // AssetListReq (the balance's currency name)
  2124: { [P]: 'i!' },                                             // ReconcileReq (positions + working orders)
  2175: { [P]: 'i!', fromTimestamp: 'i!', toTimestamp: 'i!' },    // OrderListReq
  2133: { [P]: 'i!', fromTimestamp: 'i!', toTimestamp: 'i!', maxRows: 'rows' },   // DealListReq
  2106: { [P]: 'i!', symbolId: 'i!', orderType: 'ot!', tradeSide: 'q!', volume: 'i!', limitPrice: 'px', stopPrice: 'px', timeInForce: 'tif', stopLoss: 'px', takeProfit: 'px', relativeStopLoss: 'ri', relativeTakeProfit: 'ri' },   // NewOrderReq
  2109: { [P]: 'i!', orderId: 'i!', volume: 'i', limitPrice: 'px', stopPrice: 'px', stopLoss: 'px', takeProfit: 'px' },   // AmendOrderReq
  2108: { [P]: 'i!', orderId: 'i!' },                              // CancelOrderReq
  2110: { [P]: 'i!', positionId: 'i!', stopLoss: 'px', takeProfit: 'px' },   // AmendPositionSLTPReq
  2111: { [P]: 'i!', positionId: 'i!', volume: 'i!' },             // ClosePositionReq
  51: {}                                                           // Heartbeat
};
export const WRITES = new Set([2106, 2109, 2108, 2110, 2111]);
export const TRADE_SERVER_ALLOW = new Set([2103, 2150, 2113, 2115, 2117, 2122, 2123, 2125, 2126, 2132, 2176, 2134, 2142, 50, 51, 2147, 2148, 2164]);
export const TLIMITS = { writesPerSec: 2, writesPerMin: 30, answerMs: 15000, perUid: 1, capLots: 10 };
export const KEY = /^[A-Za-z0-9-]{16,50}$/;
export const LABEL = 'TradeZoro';
const isInt = (v) => Number.isSafeInteger(v) && v >= 0;
const OP = { 2106: 'place', 2109: 'modify', 2108: 'cancel', 2110: 'sltp', 2111: 'close' };
const TYPE = { 1: 'market', 2: 'limit', 3: 'stop' };
// plain words for the browser (code -> message); the cTrader error code itself goes to the audit row
export const MSG = {
  busy: 'Another order is still on its way. Wait for its answer.',
  too_fast: 'Too many orders too quickly. Wait a moment.',
  key: 'This order has no valid key, nothing sent.',
  duplicate: 'This order was already sent once. It was not sent again.',
  not_admin: 'Live cTrader trading is for admins and beta testers only right now.',
  switched_off: 'Live trading is switched off.',
  switch_unreadable: 'The live trading switch could not be read, order not sent.',
  consent_needed: 'Enable live trading first: read and accept the notice in the Trade menu.',
  consent_unreadable: 'Your live trading acceptance could not be read, order not sent.',
  member_blocked: 'Live trading is switched off for your account. Contact support.',
  audit: 'The order log is unavailable, so nothing was sent. Try again in a moment.',
  symbol: 'This symbol’s size rules are not loaded yet. Try again in a moment.',
  volume: 'That size is not allowed for this symbol.',
  cap: 'That size is above the TradeZoro limit for cTrader.',
  shape: 'That order is not complete (price, stop loss or take profit missing or in the wrong place).',
  unresolved: 'The result of your last order is not known yet. Checking your cTrader orders first; try again in a moment.',
  lock: 'The order lock could not be taken, nothing sent. Try again in a moment.',
  unknown_order: 'That order is not working on this account any more.',
  unknown_position: 'That position is not open on this account any more.',
  close_volume: 'You can close at most the position’s size.'
};

// order shape rules per type (the schema already checked each field on its own)
export function shapeOk(type, p) {
  if (type === 2106) {
    const t = p.orderType, has = (k) => p[k] !== undefined;
    if (t === 1) return !has('limitPrice') && !has('stopPrice') && !has('stopLoss') && !has('takeProfit') && (!has('timeInForce') || p.timeInForce !== 2);   // market: relative SL / TP only
    if (t === 2) return has('limitPrice') && !has('stopPrice') && !has('relativeStopLoss') && !has('relativeTakeProfit');
    if (t === 3) return has('stopPrice') && !has('limitPrice') && !has('relativeStopLoss') && !has('relativeTakeProfit');
    return false;
  }
  if (type === 2109) return ['volume', 'limitPrice', 'stopPrice', 'stopLoss', 'takeProfit'].some((k) => p[k] !== undefined) && !(p.limitPrice !== undefined && p.stopPrice !== undefined);
  return true;
}
// the absolute SL / TP must sit on the right side of the entry (buy: SL below, TP above)
export function sidesOk(p) {
  const e = p.orderType === 2 ? p.limitPrice : p.orderType === 3 ? p.stopPrice : null;
  if (e == null) return true;
  const buy = p.tradeSide === 1;
  if (p.stopLoss !== undefined && (buy ? p.stopLoss >= e : p.stopLoss <= e)) return false;
  if (p.takeProfit !== undefined && (buy ? p.takeProfit <= e : p.takeProfit >= e)) return false;
  return true;
}
// volume rules: step multiple, inside the symbol's min / max and our cap (lots x lotSize). sym = { minVolume, maxVolume, stepVolume, lotSize }
export function volumeErr(v, sym, capLots) {
  if (!sym) return 'symbol';
  const step = sym.stepVolume > 0 ? sym.stepVolume : 1, min = sym.minVolume > 0 ? sym.minVolume : step;
  if (!(v >= min) || v % step !== 0 || (sym.maxVolume > 0 && v > sym.maxVolume)) return 'volume';
  if (sym.lotSize > 0 && v > capLots * sym.lotSize) return 'cap';
  return '';
}

// Per-socket trading state + the hooks for createRelay. g = gates: { isAdmin(), switchOn(), consent(), blocked(), audit(entry, id) ->
// { finish(res) } (throws e.duplicate), patchAudit(id, res), lock: { take(key) -> true | { key, at } (held), peek() -> { key, at } | null,
// release(key) }, defer(promise) }. account = the ONE ctid account pinned at connect; envName 'live' | 'demo'.
export const RESOLVE_AFTER_MS = 30000;   // an order id still absent from cTrader's order list this long after the send = it never arrived
export function tradeHooks({ uid, account, envName, g, now = () => Date.now(), capLots = TLIMITS.capLots }) {
  let relay = null, inflight = null, releasing = Promise.resolve(), held = null, asked = 0, askId = '', scope = null, n = 0;
  const syms = new Map(), names = new Map(), orders = new Map(), positions = new Map();
  let ws = [];   // write times (rate)
  const refuse = (key, code, extra) => relay && relay.toClient({ relay: 'refused', clientMsgId: key || '', code, error: (extra && extra.error) || MSG[code] || 'Not sent.' });
  const finish = (res) => {
    const f = inflight; inflight = null; if (!f) return f;
    g.defer(f.audit.finish(res).catch(() => {}));
    // the next write on this socket waits for this release (else it would find its own finished lock and call it unresolved)
    if (res.result === 'unknown') held = { key: f.key, at: f.at }; else { releasing = Promise.resolve().then(() => g.lock.release(f.key)).catch(() => {}); g.defer(releasing); }
    return f;
  };
  // ask cTrader for the account's orders around a held lock's send time (at most every 5 s); observe() settles it
  const ask = () => {
    const t = now(); if (!held || !relay || !relay.isAuthed(account) || t - asked < 5000) return; asked = t;
    askId = 'tzlock' + (++n) + '-' + t.toString(36);
    relay.forward(JSON.stringify({ payloadType: 2175, clientMsgId: askId, payload: { [P]: account, fromTimestamp: Math.max(0, held.at - 120000), toTimestamp: t + 60000 } }));
  };
  // only a lock that still holds that key is settled (a lock another socket already finished is just dropped here)
  const settle = (result, extra) => {
    const h = held; held = null;
    g.defer(Promise.resolve(g.lock.peek()).then(async (cur) => {
      if (!cur || cur.key !== h.key) return;
      await g.patchAudit('ct-' + h.key, { result, message: 'settled from the order list', ...extra });
      await g.lock.release(h.key);
      if (relay) relay.toClient({ relay: 'resolved', clientMsgId: h.key, result });
    }).catch(() => {}));
  };
  const learnOrder = (o) => {
    if (!o || !isInt(o.orderId)) return;
    const st = String(o.orderStatus == null ? '' : o.orderStatus);
    const td = o.tradeData || {};
    if (/^(1|ORDER_STATUS_ACCEPTED)$/.test(st) || st === '') orders.set(o.orderId, { volume: Number(td.volume) || 0, symbolId: td.symbolId });
    else orders.delete(o.orderId);   // filled / rejected / expired / cancelled
  };
  const learnPos = (p) => {
    if (!p || !isInt(p.positionId)) return;
    const st = String(p.positionStatus == null ? '' : p.positionStatus), td = p.tradeData || {};
    if (/^(2|POSITION_STATUS_CLOSED)$/.test(st) || Number(td.volume) === 0) positions.delete(p.positionId);
    else positions.set(p.positionId, { volume: Number(td.volume) || 0, symbolId: td.symbolId });
  };
  const hooks = {
    allow: TRADE_ALLOW, serverAllow: TRADE_SERVER_ALLOW,
    // only the account picked at connect, and only on the matching server (live / demo)
    // and only with a token that may trade (GetAccountList's permissionScope 1 = SCOPE_TRADE)
    authOk: (id, isLive) => id === account && (envName === 'live') === (isLive !== false) && scope === 1,
    ready() {
      // the browser's "Enable live trading" / switch state for the panel (the write path re-reads every one of them)
      const soft = (f) => Promise.resolve().then(f).then((v) => !!v, () => null);
      Promise.all([soft(g.consent), soft(g.blocked), soft(g.switchOn)]).then(([consent, blocked, switchOn]) => relay && relay.toClient({ relay: 'gates', consent, blocked, switchOn }));
      Promise.resolve(g.lock.peek()).then((h) => { if (h && !inflight) { held = h; ask(); } }).catch(() => {}); },
    bind(r) { relay = r; },
    intercept(c) {
      const key = c.frame && JSON.parse(c.frame).clientMsgId;
      if (typeof key === 'string' && /^tz/i.test(key)) { relay.end(1008, 'not allowed'); return 'drop'; }   // 'tz…' ids are the relay's own
      if (!WRITES.has(c.type)) return undefined;
      const p = c.payload;
      if (!(typeof key === 'string' && KEY.test(key))) { refuse(key, 'key'); return 'drop'; }
      if (!relay.isAuthed(p[P])) { relay.end(1008, 'not allowed'); return 'drop'; }
      if (inflight) { refuse(key, 'busy'); return 'drop'; }
      const t = now(); ws = ws.filter((x) => t - x < 60000);
      if (ws.filter((x) => t - x < 1000).length >= TLIMITS.writesPerSec || ws.length >= TLIMITS.writesPerMin) { refuse(key, 'too_fast'); return 'drop'; }
      // what this socket learned from cTrader decides what may be touched
      if (!shapeOk(c.type, p) || (c.type === 2106 && !sidesOk(p))) { refuse(key, 'shape'); return 'drop'; }
      let symbolId = p.symbolId;
      if (c.type === 2106) { const e = volumeErr(p.volume, syms.get(p.symbolId), capLots); if (e) { refuse(key, e); return 'drop'; } }
      if (c.type === 2109 || c.type === 2108) {
        const o = orders.get(p.orderId); if (!o) { refuse(key, 'unknown_order'); return 'drop'; }
        symbolId = o.symbolId;
        if (p.volume !== undefined) { const e = volumeErr(p.volume, syms.get(o.symbolId), capLots); if (e) { refuse(key, e); return 'drop'; } }
      }
      if (c.type === 2110 || c.type === 2111) {
        const pos = positions.get(p.positionId); if (!pos) { refuse(key, 'unknown_position'); return 'drop'; }
        symbolId = pos.symbolId;
        if (c.type === 2111) {
          const s = syms.get(pos.symbolId), step = s && s.stepVolume > 0 ? s.stepVolume : 1;
          if (!(p.volume > 0) || p.volume > pos.volume || (p.volume !== pos.volume && p.volume % step !== 0)) { refuse(key, 'close_volume'); return 'drop'; }
        }
      }
      ws.push(t);
      // rebuilt frame: our label and the key as clientOrderId on a new order (never the client's)
      const payload = { ...p }; if (c.type === 2106) { payload.label = LABEL; payload.clientOrderId = key; }
      const frame = JSON.stringify({ payloadType: c.type, clientMsgId: key, payload });
      const entry = { uid, env: envName, op: OP[c.type], src: 'ctrader', account: String(p[P]), symbol: String(names.get(symbolId) || symbolId || '').slice(0, 24),
        side: c.type === 2106 ? (p.tradeSide === 1 ? 'buy' : 'sell') : '', qty: Number(p.volume) || 0, type: c.type === 2106 ? TYPE[p.orderType] : OP[c.type],
        orderRef: String(p.orderId || p.positionId || '') };
      if (held) { ask(); refuse(key, 'unresolved'); return 'drop'; }
      inflight = { key, at: t, type: c.type, audit: null, sent: false };
      const mine = inflight;
      return (async () => {
        const v = await Promise.all([g.isAdmin(), g.switchOn(), g.consent(), g.blocked()].map((x) => Promise.resolve(x).then((y) => ({ y }), () => ({ err: true }))));
        const [ad, sw, cs, bl] = v;
        const no = !ad.y || ad.err ? 'not_admin' : sw.err ? 'switch_unreadable' : !sw.y ? 'switched_off' : bl.err ? 'switch_unreadable' : bl.y ? 'member_blocked' : cs.err ? 'consent_unreadable' : !cs.y ? 'consent_needed' : '';
        if (no) { if (inflight === mine) inflight = null; refuse(key, no); if (no !== 'not_admin') g.defer(g.audit({ ...entry }, 'ct-' + key + '-r').then((a) => a.finish({ result: 'rejected', message: no })).catch(() => {})); return; }
        await releasing;
        let lk;
        try { lk = await g.lock.take(key); } catch (e) { lk = null; }
        if (lk !== true) { if (inflight === mine) inflight = null; if (lk && lk.key) { held = lk; ask(); refuse(key, 'unresolved'); } else refuse(key, 'lock'); return; }
        let a;
        try { a = await g.audit(entry, 'ct-' + key); }
        catch (e) { if (inflight === mine) inflight = null; g.defer(Promise.resolve(g.lock.release(key)).catch(() => {})); refuse(key, e && e.duplicate ? 'duplicate' : 'audit'); return; }
        if (inflight !== mine) { g.defer(a.finish({ result: 'rejected', message: 'socket closed before send' }).catch(() => {})); g.defer(Promise.resolve(g.lock.release(key)).catch(() => {})); return; }
        mine.audit = a; mine.at = now();
        if (!relay.forward(frame)) { finish({ result: 'rejected', message: 'not sent: link closed' }); refuse(key, 'audit', { error: 'The cTrader link closed, nothing was sent.' }); return; }
        mine.sent = true;
      })();
    },
    observe(o) {
      const t = o.payloadType, pl = o.payload || {};
      if (t === 2150) scope = pl.permissionScope === 'SCOPE_TRADE' ? 1 : Number(pl.permissionScope);   // 0 = view only, 1 = trade
      if (t === 2117 && Array.isArray(pl.symbol)) for (const s of pl.symbol) if (s && isInt(s.symbolId)) syms.set(s.symbolId, { minVolume: Number(s.minVolume) || 0, maxVolume: Number(s.maxVolume) || 0, stepVolume: Number(s.stepVolume) || 0, lotSize: Number(s.lotSize) || 0 });
      if (t === 2115 && Array.isArray(pl.symbol)) for (const s of pl.symbol) if (s && isInt(s.symbolId)) names.set(s.symbolId, String(s.symbolName || ''));
      if (pl[P] !== undefined && pl[P] !== account) return;   // another account's frame teaches nothing
      if (t === 2103) { asked = 0; setTimeout(ask, 0); }   // authorised now: a held lock can be checked
      if (t === 2125) { orders.clear(); positions.clear(); (pl.order || []).forEach(learnOrder); (pl.position || []).forEach(learnPos); }
      if (t === 2126) { learnOrder(pl.order); learnPos(pl.position); }
      if (t === 2176 && held && askId && o.clientMsgId === askId) {
        askId = '';
        const hit = (pl.order || []).find((x) => x && x.clientOrderId === held.key);
        if (hit) settle('accepted', { brokerOrderId: String(hit.orderId || ''), positionId: String(hit.positionId || '') });
        else if (now() - held.at > RESOLVE_AFTER_MS) settle('not_found');
      }
      if (inflight && inflight.sent && o.clientMsgId === inflight.key && (t === 2126 || t === 2132 || t === 2142 || t === 50)) {
        const et = String(pl.executionType == null ? '' : pl.executionType);
        const bad = t !== 2126 || /^(7|8|ORDER_REJECTED|ORDER_CANCEL_REJECTED)$/.test(et);
        finish({ result: bad ? 'rejected' : 'accepted', message: String(pl.errorCode || '').slice(0, 60), brokerOrderId: String((pl.order && pl.order.orderId) || pl.orderId || ''), positionId: String((pl.position && pl.position.positionId) || pl.positionId || ''), exec: et.slice(0, 30) });
      }
    },
    tick(t) {
      if (inflight && inflight.sent && t - inflight.at > TLIMITS.answerMs) { const f = finish({ result: 'unknown', message: 'no answer in ' + TLIMITS.answerMs / 1000 + ' s' }); relay.toClient({ relay: 'unknown', clientMsgId: f.key }); }
      if (held && t - held.at > 5000) ask();
    },
    closed() { if (inflight && inflight.sent) finish({ result: 'unknown', message: 'socket closed before the answer' }); else inflight = null; },
    _state: () => ({ syms, orders, positions, inflight, held })
  };
  return hooks;
}
