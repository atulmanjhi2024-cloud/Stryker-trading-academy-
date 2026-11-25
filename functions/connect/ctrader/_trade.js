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
  51: {},                                                          // Heartbeat
  // NOT a cTrader type: the browser's latency marks for one of ITS writes (FASTORDER 25 Nov). Always dropped by the relay, never
  // forwarded; only accepted for a key this socket itself sent, merged into that order's audit row (numbers only)
  9001: { c_open: 'ms', c_send: 'ms', c_ack: 'ms', c_toast: 'ms', c_cf: 'ms', c_fill: 'ms' }
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
  gate_unreadable: 'Couldn’t confirm your trading access just now. Nothing was sent. Try again.',
  renew: 'The trading link was refreshing. Nothing was sent. Try again.',
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

// ---- per-socket gate cache (owner bug 24 Nov) ------------------------------------------------------------------------------
// Every write used to re-read admin/beta + switch + consent + block from Firestore, on the order's path, on ONE long-lived socket
// request. On Cloudflare every fetch counts against that request's subrequest cap, so after a few orders the reads failed and the
// failure was shown as "admins and beta testers only". Now: a GOOD answer (admin/beta yes, switch on, consent yes, not blocked) is
// kept per socket for GATE_TTL[name]; a NO is never kept (re-read on the next write); an ERROR is never kept (thrown = fail closed).
// warm(names) refreshes entries in the background (after a write, at app auth) so the next order finds them fresh.
// FASTORDER (25 Nov): the master switch is kept at most 5 s per socket (= the isolate memo in liveSwitchOn), so switching live
// trading off stops orders within 5 s. It costs no order time: every gate read runs in parallel with the lock and the audit row.
export const GATE_TTL = { isAdmin: 5 * 60000, switchOn: 5000, consent: 30000, blocked: 30000 };
export const WARM_KEYS = ['isAdmin', 'consent', 'blocked'];   // background refresh (the switch is read with every write instead)
// FASTORDER: one hung Firestore call must not stall an order. Past this the write is refused (nothing sent) and anything that
// still succeeds later is cleaned up (our lock released, our audit row finished as rejected).
export const PHASE_MS = 8000;
// latency marks: the browser's own marks for a write (frame 9001) are patched onto its audit row (mark fields only)
const MAX_SENT = 50;   // keys this socket sent whose marks may still arrive (oldest dropped first)
const GOOD = { isAdmin: (v) => v === true, switchOn: (v) => v === true, consent: (v) => v === true, blocked: (v) => v === false };
export function gateCache(read, { now = () => Date.now(), ttl = GATE_TTL } = {}) {
  const e = new Map(), pend = new Map();
  const load = (k) => {
    if (pend.has(k)) return pend.get(k);
    // a reader may answer { v, keep: false } (a fallback value, e.g. the switch's last-good read): used for this write, never kept
    const p = Promise.resolve().then(() => read[k]()).then((r) => { const keep = !(r && typeof r === 'object' && r.keep === false); const v = !!(r && typeof r === 'object' ? r.v : r); if (keep && GOOD[k](v)) e.set(k, { v, at: now() }); else e.delete(k); return v; })
      .finally(() => pend.delete(k));
    pend.set(k, p); return p;
  };
  const fresh = (k, f = 1) => { const x = e.get(k); return !!x && now() - x.at < ttl[k] * f; };
  return {
    get(k) { return fresh(k) ? Promise.resolve(e.get(k).v) : load(k); },
    refresh: (k) => load(k),   // always a real read (the minute admin re-check)
    seed(k, v) { if (GOOD[k](v)) e.set(k, { v, at: now() }); },
    // background: entries past `frac` of their life are re-read; errors are swallowed (the entry just ages out)
    warm(keys = Object.keys(ttl), frac = 0.6) { return Promise.all(keys.filter((k) => !fresh(k, frac) && !pend.has(k)).map((k) => load(k).catch(() => null))); },
    age: (k) => (e.has(k) ? now() - e.get(k).at : Infinity)
  };
}
// Subrequest budget per socket: count = every fetch this socket's request made. WRITE_COST = the most one write can spend (all gates
// stale + one retry each, lock, audit, finish, release). Below that, a write is refused ('renew', nothing sent) and the socket ends
// cleanly (close 4001) so the browser opens a fresh request = a fresh budget. Nothing is ever resent by the server or the browser.
export const WRITE_COST = 16;
export const RENEW_CODE = 4001;

// Per-socket trading state + the hooks for createRelay. g = gates: { isAdmin(), switchOn(), consent(), blocked(), audit(entry, id) ->
// { finish(res) } (throws e.duplicate), patchAudit(id, res), lock: { take(key) -> true | { key, at } (held), peek() -> { key, at } | null,
// release(key) }, defer(promise) }. account = the ONE ctid account pinned at connect; envName 'live' | 'demo'.
export const RESOLVE_AFTER_MS = 30000;   // an order id still absent from cTrader's order list this long after the send = it never arrived
export function tradeHooks({ uid, account, envName, g, now = () => Date.now(), capLots = TLIMITS.capLots }) {
  let relay = null, inflight = null, releasing = Promise.resolve(), held = null, asked = 0, askId = '', scope = null, n = 0, lastWrite = 0, settling = false;
  const B = g.budget || null;   // { left() -> subrequests still free, capHit() -> a fetch hit the platform cap }
  // the renew close waits until nothing is in flight, unresolved or releasing its lock (tick() closes it then)
  let renewDue = false;
  const renew = () => { renewDue = true; if (relay && !relay.closed && !inflight && !held && !settling) relay.end(RENEW_CODE, 'renew'); };
  const syms = new Map(), names = new Map(), orders = new Map(), positions = new Map();
  let ws = [];   // write times (rate)
  const refuse = (key, code, extra) => relay && relay.toClient({ relay: 'refused', clientMsgId: key || '', code, error: (extra && extra.error) || MSG[code] || 'Not sent.' });
  // FASTORDER: keys this socket forwarded and finished -> the browser's marks (frame 9001) may still come for them. The RESULT is
  // written at once as before (never delayed); the marks are a second PATCH limited to the mark fields only (updateMask), skipped
  // when the socket's subrequest budget is low. At most MAX_SENT keys are remembered; marks for any other key are dropped.
  const sent = new Map();
  const finish = (res) => {
    const f = inflight; inflight = null; if (!f) return f;
    const tm = f.tm || null, ans = now();
    const timing = tm ? { s_gate: tm.gate, s_lock: tm.lock, s_audit: tm.audit, s_pre: tm.pre, s_ct: Math.max(0, ans - f.at), s_total: Math.max(0, ans - tm.t0) } : {};
    g.defer(f.audit.finish({ ...res, ...timing }).catch(() => {}));
    if (f.sent) { sent.set(f.key, { at: ans, marked: false }); while (sent.size > MAX_SENT) sent.delete(sent.keys().next().value); }
    // the browser's own split (after the answer frame): numbers only
    if (tm && relay) { const k = f.key; Promise.resolve().then(() => relay && relay.toClient({ relay: 'timing', clientMsgId: k, t: timing })); }
    // the next write on this socket waits for this release (else it would find its own finished lock and call it unresolved)
    if (res.result === 'unknown') held = { key: f.key, at: f.at }; else { settling = true; releasing = Promise.resolve().then(() => g.lock.release(f.key)).catch(() => {}).finally(() => { settling = false; }); g.defer(releasing); }
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
      // the browser's latency marks: never forwarded; kept only for a key this socket itself sent and has not logged yet
      if (c.type === 9001) {
        const s = typeof key === 'string' ? sent.get(key) : null;
        if (s && !s.marked && now() - s.at < 120000 && (!B || B.left() >= WRITE_COST + 1)) { s.marked = true; g.defer(Promise.resolve().then(() => g.patchAudit('ct-' + key, { ...c.payload })).catch(() => {})); }
        return 'drop';
      }
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
      // not enough subrequests left on this socket for one whole write: nothing sent, the socket renews (the browser reopens it)
      if (B && (B.capHit() || B.left() < WRITE_COST)) { refuse(key, 'renew'); renew(); return 'drop'; }
      lastWrite = t;
      inflight = { key, at: t, type: c.type, audit: null, sent: false, tm: null };
      const mine = inflight;
      // FASTORDER (25 Nov, advisor-reviewed): the gates, the account lock and the audit row run IN PARALLEL (they were one after
      // another: 3 Firestore round trips, ~750 ms from India). The frame goes out ONLY when all three succeeded. On any refusal,
      // only what THIS write created is undone: our own lock (released by its key) and our own audit row (finished 'rejected').
      // A 409 audit row (an earlier attempt with this key) or a lock held by another key is never touched. One decision, once.
      return (async () => {
        const t0 = now(), tm = { t0, gate: 0, lock: 0, audit: 0, pre: 0 };
        await releasing;   // the previous write's lock release on this socket (stays serial, else a spurious 'unresolved')
        const soft = (x) => Promise.resolve().then(x).then((y) => ({ y }), (e) => ({ err: e || true }));
        // undo = what THIS write created and must take back (set once, at the decision). A step that answers after the decision
        // (the PHASE_MS timeout) is taken back the moment it answers.
        let undo = null, lk = null, au = null;
        const dropLock = () => g.defer(Promise.resolve().then(() => g.lock.release(key)).catch(() => {}));
        const dropAudit = (r, why) => g.defer(Promise.resolve().then(() => r.finish({ result: 'rejected', message: why })).catch(() => {}));
        const lockP = soft(() => g.lock.take(key)).then((r) => { lk = r; tm.lock = now() - t0; if (undo && r.y === true) dropLock(); return r; });
        const auditP = soft(() => g.audit(entry, 'ct-' + key)).then((r) => { au = r; tm.audit = now() - t0; if (undo && r.y) dropAudit(r.y, undo); return r; });
        const gateP = Promise.all([g.isAdmin(), g.switchOn(), g.consent(), g.blocked()].map((x) => soft(() => x))).then((r) => { tm.gate = now() - t0; return r; });
        let to; const late = new Promise((r) => { to = setTimeout(() => r('timeout'), PHASE_MS); });
        const all = await Promise.race([Promise.all([gateP, lockP, auditP]), late]); clearTimeout(to);
        tm.pre = now() - t0;
        const refuseUndo = (why, code, extra) => {
          undo = why;   // from here on a late answer is taken back by its own handler above
          if (lk && lk.y === true) dropLock();
          if (au && au.y) dropAudit(au.y, why);
          if (inflight === mine) inflight = null;
          if (code) refuse(key, code, extra);
        };
        if (all === 'timeout') { refuseUndo('timeout', 'lock'); return; }
        const gv = all[0];
        // the same order of answers as before: gates first, then the lock, then the audit row.
        // An ERROR reading admin / beta is "couldn't confirm" (gate_unreadable), never "not an admin"; only a real NO says not_admin
        const [ad, sw, cs, bl] = gv.map((r) => (r.err ? { err: true } : { y: r.y }));
        const no = ad.err ? 'gate_unreadable' : !ad.y ? 'not_admin' : sw.err ? 'switch_unreadable' : !sw.y ? 'switched_off' : bl.err ? 'switch_unreadable' : bl.y ? 'member_blocked' : cs.err ? 'consent_unreadable' : !cs.y ? 'consent_needed' : '';
        if (no) {
          // our own audit row becomes the 'rejected' record; if it could not be created (not a duplicate), a '-r' row as before
          refuseUndo(no, no);
          if (au.err && !au.err.duplicate && no !== 'not_admin') g.defer(g.audit({ ...entry }, 'ct-' + key + '-r').then((x) => x.finish({ result: 'rejected', message: no })).catch(() => {}));
          if (B && B.capHit()) renew();   // the platform cap was hit: this socket can't read anything any more
          return;
        }
        if (lk.err || lk.y !== true) {
          const h = lk.err ? null : lk.y;
          if (h && h.key) { refuseUndo('lock held', ''); held = h; ask(); refuse(key, 'unresolved'); } else refuseUndo('lock', 'lock');
          return;
        }
        if (au.err) { const d = !!au.err.duplicate; refuseUndo(d ? 'duplicate' : 'audit', d ? 'duplicate' : 'audit'); return; }
        // the socket closed while the checks ran (closed() cleared inflight): nothing is sent
        if (inflight !== mine) { refuseUndo('socket closed before send', ''); return; }
        const a = au.y;
        mine.audit = a; mine.tm = tm; mine.at = now();
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
      // a socket that ran low on subrequests renews while nothing is in flight or unresolved (the browser reopens it quietly)
      if (!inflight && !held && !settling && (renewDue || (B && (B.capHit() || B.left() < WRITE_COST)))) { renew(); return; }
      // keep the gates fresh during active trading, off the order path; only while the budget has room for it (never at the cost of a write)
      if (g.warm && !inflight && t - lastWrite < 60000 && (!B || B.left() >= 2 * WRITE_COST)) g.warm();
      if (inflight && inflight.sent && t - inflight.at > TLIMITS.answerMs) { const f = finish({ result: 'unknown', message: 'no answer in ' + TLIMITS.answerMs / 1000 + ' s' }); relay.toClient({ relay: 'unknown', clientMsgId: f.key }); }
      if (held && t - held.at > 5000) ask();
    },
    closed() { if (inflight && inflight.sent) finish({ result: 'unknown', message: 'socket closed before the answer' }); else inflight = null; if (g.ended) g.ended(); },
    _state: () => ({ syms, orders, positions, inflight, held })
  };
  return hooks;
}
