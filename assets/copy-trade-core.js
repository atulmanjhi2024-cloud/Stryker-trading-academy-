// TradeZoro — COPY TRADING ACROSS A MEMBER'S OWN ACCOUNTS: pure rules shared by the server (functions/connect/finatic/copy.js) and the
// chart (assets/chart-copy.js). No DOM, no network. Owner order 21 Nov 2026 ("Can't we copytrade rn as well?").
// One member, their OWN accounts only: one leader (a connected live account) and followers (their other connected accounts, any broker,
// plus Paper). An order the member places in TradeZoro on the leader is sent to each follower right after the leader accepts it.
// Orders placed in the broker's own platform are NOT copied (the broker link gives no reliable near-real-time order feed).
// Per follower: on/off, size (same / multiplier x0.1..x10 / fixed qty), contract mapping (same / to micro / to full size, the same
// mini/micro pairs as the order window), copy exits (flatten + stop loss / take profit; on by default).
// Tests: tests/finatic/copy-trade.test.mjs. Education only. Not financial advice.

export const COPY_TERMS_VERSION = '2026-11-21';
export const MAX_FOLLOWERS = 8;
export const MODES = ['same', 'mult', 'fixed'];
export const MAPS = ['same', 'micro', 'full'];
// full size <-> micro pairs (= assets/paper-engine.js PAIRS, the order window's mini / micro switch)
export const PAIRS = { NQ: 'MNQ', ES: 'MES', YM: 'MYM', RTY: 'M2K', GC: 'MGC', CL: 'MCL', SI: 'SIL' };
const MICRO_OF = PAIRS, FULL_OF = Object.fromEntries(Object.entries(PAIRS).map(([a, b]) => [b, a]));
const ACCT = /^[0-9a-fA-F-]{8,64}$/;
export const isPaper = (id) => id === 'paper';

// contract code -> { root, rest } ('MNQZ6' -> MNQ + Z6). Futures codes only; anything else -> null (copied unchanged)
export function splitCode(code) {
  const m = /^([A-Z0-9]{1,6}?)([FGHJKMNQUVXZ]\d{1,2})$/.exec(String(code || '').toUpperCase());
  return m ? { root: m[1], rest: m[2] } : null;
}
// the follower's root for a leader root under one mapping
export function mapRoot(root, map) {
  const r = String(root || '').toUpperCase();
  if (map === 'micro') return MICRO_OF[r] || r;
  if (map === 'full') return FULL_OF[r] || r;
  return r;
}
// leader contract -> follower contract ('NQZ6' + micro -> 'MNQZ6'); unknown shapes are copied as they are
export function mapCode(code, map) {
  const s = splitCode(code); if (!s) return String(code || '').toUpperCase();
  return mapRoot(s.root, map) + s.rest;
}
// follower quantity -> integer >= 1, or 0 (= skip: the rule rounds it to nothing)
export function sizeFor(f, qty) {
  const q = Number(qty); if (!(q > 0)) return 0;
  if (f.mode === 'fixed') return Math.max(0, Math.floor(Number(f.qty) || 0));
  if (f.mode === 'mult') return Math.max(0, Math.round(q * (Number(f.mult) || 0)));
  return Math.floor(q);
}

// one config from anything (the client's save body or the stored doc). -> { cfg } | { error }
// cfg = { on, paused, leader, followers: [{ id, on, mode, mult, qty, map, exits }], consentAt, consentVersion }
export function cleanConfig(x, prev) {
  const o = x && typeof x === 'object' ? x : {};
  const leader = typeof o.leader === 'string' ? o.leader : '';
  if (leader && !ACCT.test(leader)) return { error: 'Pick a connected account as the leader.' };
  const list = Array.isArray(o.followers) ? o.followers : [];
  if (list.length > MAX_FOLLOWERS) return { error: 'At most ' + MAX_FOLLOWERS + ' follower accounts.' };
  const seen = new Set(), followers = [];
  for (const f of list) {
    const id = f && typeof f.id === 'string' ? f.id : '';
    if (!(isPaper(id) || ACCT.test(id))) return { error: 'A follower account is not valid.' };
    if (id === leader) return { error: 'The leader cannot follow itself.' };
    if (seen.has(id)) continue; seen.add(id);
    const mode = MODES.includes(f.mode) ? f.mode : 'same', map = MAPS.includes(f.map) ? f.map : 'same';
    const mult = Math.round((Number(f.mult) || 1) * 10) / 10, qty = Math.floor(Number(f.qty) || 1);
    if (mode === 'mult' && !(mult >= 0.1 && mult <= 10)) return { error: 'Multiplier is x0.1 to x10.' };
    if (mode === 'fixed' && !(qty >= 1 && qty <= 1e6)) return { error: 'Fixed size is a whole number, 1 or more.' };
    followers.push({ id, on: f.on !== false, mode, mult: mode === 'mult' ? mult : 1, qty: mode === 'fixed' ? qty : 1, map, exits: f.exits !== false });
  }
  const p = prev || {};
  return { cfg: { on: o.on === true, paused: o.paused === true, leader, followers, consentAt: p.consentAt || '', consentVersion: p.consentVersion || '' } };
}
export const hasCopyConsent = (cfg) => !!(cfg && cfg.consentAt && cfg.consentVersion === COPY_TERMS_VERSION);
export const activeFollowers = (cfg) => (cfg && Array.isArray(cfg.followers) ? cfg.followers.filter((f) => f.on) : []);
// is copying running for this leader account right now (the client's fast check; the server re-checks everything)
export const copyActive = (cfg, leaderId) => !!(cfg && cfg.on && !cfg.paused && cfg.leader && cfg.leader === leaderId && hasCopyConsent(cfg) && activeFollowers(cfg).length);

// deterministic follower key from the leader's key: a repeat of the same leader order maps to the same follower key, so the
// server's audit row (doc id = key) refuses it the second time. Matches chart-live-core IDEM (16..64 of [A-Za-z0-9-]).
export function copyKey(base, follower, extra) {
  const s = 'copy|' + base + '|' + follower + '|' + (extra || '');
  let h1 = 0x811c9dc5, h2 = 0x01000193, h3 = 0x9e3779b9;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 ^ c, 2246822519) >>> 0; h3 = Math.imul(h3 ^ c, 3266489917) >>> 0; }
  return 'cp-' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + h3.toString(16).padStart(8, '0');
}

// What one follower gets for one leader action. lead = the leader's order body (op place / modify / cancel / flatten / bracket) as the
// chart sent it, link = { [followerId]: followerOrderId } for the leader order (modify / cancel), roleIds = { slId, tpId } of the
// follower's own stop loss / take profit group (a moved leader stop loss moves the follower's). -> { body } | { skip: why }
export function followerBody(f, lead, { link, roleIds, role } = {}) {
  const op = lead && lead.op;
  const key = typeof lead.idemKey === 'string' ? copyKey(lead.idemKey, f.id) : '';
  if (op === 'place') {
    const qty = sizeFor(f, lead.qty); if (!qty) return { skip: 'Size rule rounds this order to 0.' };
    const body = { op: 'place', symbol: mapCode(lead.symbol, f.map), side: lead.side, qty, type: lead.type, assetType: lead.assetType || 'future', timeInForce: lead.timeInForce || 'day', idemKey: key };
    if (lead.limitPrice != null) body.limitPrice = lead.limitPrice;
    if (lead.stopPrice != null) body.stopPrice = lead.stopPrice;
    if (lead.bracket && f.exits) body.bracket = { sl: lead.bracket.sl, tp: lead.bracket.tp };   // same price scale (mini / micro pairs)
    return { body };
  }
  if (op === 'flatten') {
    if (!f.exits) return { skip: 'Copy exits is off for this account.' };
    return { body: { op: 'flatten', symbol: mapCode(lead.symbol, f.map), idemKey: key } };
  }
  if (op === 'bracket') {
    if (!f.exits) return { skip: 'Copy exits is off for this account.' };
    return { body: { op: 'bracket', symbol: mapCode(lead.symbol, f.map) } };
  }
  if (op === 'cancel' || op === 'modify') {
    let id = '';
    if (role === 'sl' || role === 'tp') { if (!f.exits) return { skip: 'Copy exits is off for this account.' }; id = roleIds && roleIds[role === 'sl' ? 'slId' : 'tpId']; }
    else id = link && link[f.id];
    if (!id) return { skip: 'No copied order to ' + (op === 'cancel' ? 'cancel' : 'change') + ' on this account.' };
    if (op === 'cancel') return { body: { op: 'cancel', orderId: String(id), idemKey: key } };
    const body = { op: 'modify', orderId: String(id), type: lead.type, idemKey: key };
    if (lead.limitPrice != null) body.limitPrice = lead.limitPrice;
    if (lead.stopPrice != null) body.stopPrice = lead.stopPrice;
    if (lead.symbol) body.symbol = mapCode(lead.symbol, f.map);
    return { body };
  }
  return { skip: 'Not copied.' };
}

// one follower's answer -> a status line for the panel: sent / filled / rejected / skipped / duplicate
export function resultOf(status, j) {
  const x = j || {};
  if (status >= 200 && status < 300 && x.ok !== false) {
    const st = String(x.status || '').toUpperCase();
    return { state: /FILL/.test(st) ? 'filled' : 'sent', orderId: String(x.orderId || ''), message: st ? 'Broker status: ' + st.toLowerCase().replace(/_/g, ' ') : '' };
  }
  if (x.code === 'duplicate' || x.duplicate) return { state: 'duplicate', message: 'Already sent once. Nothing new was sent.' };
  return { state: x.code === 'unknown' ? 'unknown' : 'rejected', message: String(x.error || 'Refused (code ' + status + ').').slice(0, 240) };
}
