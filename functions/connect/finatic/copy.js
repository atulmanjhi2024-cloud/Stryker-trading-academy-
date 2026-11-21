// COPY TRADING ACROSS A MEMBER'S OWN ACCOUNTS (Owner order 21 Nov 2026). POST /connect/finatic/copy {op, ...}. One signed-in member only:
// the leader and every follower must be accounts of THAT member's own broker connection (or Paper, which runs in the member's browser).
// Copying between members does not exist here: the config is keyed by the uid from the ID token, and every follower order runs the
// full order route (order.js exec) again as the same member, so ownership (ownsAccount), the "Enable live trading" acceptance, the
// global kill switch, the per-member admin block, the audit row and the idempotency key all apply to each follower order on its own.
//   get     -> { cfg, consentVersion }                            this member's copy setup (server record)
//   save    {cfg, consent?, version?}                              validate + store; every live account is checked as the member's own.
//                                                                  Turning copying on needs the live-trading acceptance AND, the first
//                                                                  time, the copy-trading confirm (consent:true + current version).
//   pause / resume                                                 one tap, no other change
//   fan     {lead}                                                 the chart's leader order body (place / modify / cancel /
//                                                                  flatten). The leader runs first; ONLY when it is accepted, each
//                                                                  follower gets its own order (in parallel, one failing never blocks
//                                                                  the others). Reply = the leader's own reply + copy: { results }.
//                                                                  Paper followers come back as { paper: body } for the browser.
//   flattenAll {symbol, idemKey}                                   flatten the (mapped) contract on every follower (copy exits or not)
//   sync    {symbol}                                               move each follower's own copied stop loss / take profit on (op
//                                                                  'bracket' of order.js per follower: children after the fill,
//                                                                  one-cancels-other); the chart calls it while copies are open
// Server-written docs (service account; the catch-all rule denies clients): copyConfig/{uid} { on, paused, leader, followersJson,
// consentAt, consentVersion, updatedAt }, copyLinks/{uid}_{leaderAccount}_{leaderOrderId} { linksJson } (leader order -> follower
// order ids, so a leader modify / cancel reaches the copies). Orders placed in the broker's own platform are NOT copied: the broker
// link has no reliable near-real-time order feed. Tests: tests/finatic/copy-trade.test.mjs. Education only. Not financial advice.
import { gate, readBody, json, fail, needsConnect, methodNotAllowed, safe, pagesEntry, cachedSession, finSession, UUID, ID } from './_fin.js';
import { store, resolveFinUser, ownsAccount, notYours, hasConsent, memberBlocked } from './_owner.js';
import { exec } from './order.js';
import { getBracket } from './_audit.js';
import { groupId } from '../../../assets/chart-live-core.js';
import * as C from '../../../assets/copy-trade-core.js';

const LEAD_OPS = ['place', 'modify', 'cancel', 'flatten'];
const parse = (s, d) => { try { const v = JSON.parse(s); return v == null ? d : v; } catch (e) { return d; } };
export async function readCfg(env, deps, uid) {
  const d = await store(env, deps).get('copyConfig/' + uid);   // throws when unreadable
  if (!d) return null;
  return { on: d.on === true, paused: d.paused === true, leader: d.leader || '', followers: parse(d.followersJson, []), consentAt: d.consentAt || '', consentVersion: d.consentVersion || '' };
}
const writeCfg = (env, deps, uid, c) => store(env, deps).set('copyConfig/' + uid, { on: !!c.on, paused: !!c.paused, leader: c.leader || '', followersJson: JSON.stringify(c.followers || []), consentAt: c.consentAt || '', consentVersion: c.consentVersion || '', updatedAt: new Date((deps.now || Date.now)()).toISOString() });
const linkPath = (uid, acct, oid) => 'copyLinks/' + uid + '_' + acct + '_' + String(oid).replace(/[^A-Za-z0-9._:-]/g, '');
const view = (c) => (c ? { on: c.on, paused: c.paused, leader: c.leader, followers: c.followers, consented: C.hasCopyConsent(c) } : { on: false, paused: false, leader: '', followers: [], consented: false });
// a Response -> { status, j } (the order route always answers JSON)
const unpack = async (r) => { let j = {}; try { j = await r.clone().json(); } catch (e) {} return { status: r.status, j }; };

async function run(request, env, deps) {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  const g = await gate(request, env, deps, 'finatic-copy');
  if (g instanceof Response) return g;
  // ADMIN ONLY (Owner 21 Nov: "Only enable copytrading for admin for now, let me first test it")
  if (!g.admin) return fail(403, 'Copy trading is not available yet.', 'copy_admin_only');
  const b = await readBody(request);
  if (!b || typeof b !== 'object') return fail(400, 'Bad request');
  const op = b.op;
  let cfg;
  try { cfg = await readCfg(env, deps, g.uid); } catch (e) { return fail(503, 'Could not read your copy trading setup. Nothing was sent.', 'copy_unreadable'); }

  if (op === 'get') return json({ ok: true, cfg: view(cfg), version: C.COPY_TERMS_VERSION });
  if (op === 'pause' || op === 'resume') {
    if (!cfg) return fail(400, 'Copy trading is not set up yet.', 'copy_none');
    cfg.paused = op === 'pause';
    try { await writeCfg(env, deps, g.uid, cfg); } catch (e) { return fail(503, 'Could not save. Try again in a moment.', 'copy_unwritable'); }
    return json({ ok: true, cfg: view(cfg) });
  }
  if (op === 'save') {
    const c = C.cleanConfig(b.cfg, cfg); if (c.error) return fail(400, c.error, 'copy_invalid');
    const n = c.cfg;
    if (n.on) {
      if (!n.leader) return fail(400, 'Pick a leader account first.', 'copy_invalid');
      if (!C.activeFollowers(n).length) return fail(400, 'Turn on at least one follower account.', 'copy_invalid');
      let live; try { live = await hasConsent(env, deps, g.uid); } catch (e) { return fail(503, 'Your live trading acceptance could not be read.', 'consent_unreadable'); }
      if (!live) return fail(403, 'Enable live trading first: read and accept the notice in the Trade menu.', 'consent_needed');
      if (!C.hasCopyConsent(n)) {
        if (b.consent !== true || b.version !== C.COPY_TERMS_VERSION) return fail(403, 'Confirm copy trading once before you turn it on.', 'copy_consent_needed');
        n.consentAt = new Date((deps.now || Date.now)()).toISOString(); n.consentVersion = C.COPY_TERMS_VERSION;
      }
    }
    // ownership: the leader and every live follower must be in THIS member's own account list (unreadable = refused)
    const ids = [n.leader, ...n.followers.map((f) => f.id)].filter((id) => id && !C.isPaper(id));
    if (ids.length) {
      const ow = await resolveFinUser(env, deps, g, b); if (ow instanceof Response) return ow;
      if (!ow.finUser) return needsConnect();
      let s = await cachedSession(env, deps, ow.finUser);
      if (s.failed || !s.authenticated) return s.staleUser || !s.failed ? needsConnect() : fail(502, 'Could not check your accounts at the broker right now. Nothing was saved.', 'upstream');
      const call = async (m, p, o) => { const x = await finSession(env, deps, ow.finUser, s, m, p, o); s = x.s; return x.r; };
      for (const id of ids) { const own = await ownsAccount(deps, ow.finUser, call, id); if (own instanceof Response) return own; if (!own) return notYours(); }
    }
    try { await writeCfg(env, deps, g.uid, n); } catch (e) { return fail(503, 'Could not save your copy trading setup. Try again in a moment.', 'copy_unwritable'); }
    return json({ ok: true, cfg: view(n) });
  }
  if (op === 'flattenAll') {
    if (!cfg || !cfg.followers.length) return fail(400, 'No follower accounts set up.', 'copy_none');
    if (typeof b.symbol !== 'string' || !/^[A-Z0-9]{2,12}$/.test(b.symbol.toUpperCase()) || !(typeof b.idemKey === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(b.idemKey))) return fail(400, 'Bad request');
    const lead = { op: 'flatten', symbol: b.symbol.toUpperCase(), idemKey: b.idemKey };
    const results = await fanOut(request, env, deps, g, cfg.followers.map((f) => ({ ...f, exits: true })), lead, {});
    return json({ ok: true, copy: { results } });
  }
  if (op === 'sync') {
    if (!cfg || !cfg.followers.length) return json({ ok: true, copy: { results: [] } });
    if (typeof b.symbol !== 'string' || !/^[A-Z0-9]{2,12}$/.test(b.symbol.toUpperCase())) return fail(400, 'Bad request');
    const results = await fanOut(request, env, deps, g, cfg.followers.filter((f) => f.exits && !C.isPaper(f.id)), { op: 'bracket', symbol: b.symbol.toUpperCase() }, {});
    return json({ ok: true, copy: { results } });
  }
  if (op !== 'fan') return fail(400, 'Not allowed');

  // ---- fan: leader first, then the followers ------------------------------------------------------------------------------
  const lead = b.lead && typeof b.lead === 'object' ? b.lead : null;
  if (!lead || !LEAD_OPS.includes(lead.op) || !(typeof lead.accountId === 'string' && UUID.test(lead.accountId))) return fail(400, 'Bad request');
  const leadBody = { ...lead, src: 'chart' };
  delete leadBody.userId;   // the server's record wins anyway (_owner.js); never forwarded
  // a leader stop loss / take profit being moved or cancelled: its role, so each follower moves ITS own one
  let role = '';
  if ((lead.op === 'modify' || lead.op === 'cancel') && typeof lead.symbol === 'string' && ID.test(String(lead.orderId || ''))) {
    try { const grp = await getBracket(env, deps, groupId(lead.accountId, String(lead.symbol).toUpperCase())); if (grp) role = grp.slId === lead.orderId ? 'sl' : grp.tpId === lead.orderId ? 'tp' : ''; } catch (e) {}
  }
  const lr = await exec(request, env, deps, g, leadBody);
  const leader = await unpack(lr);
  const active = C.copyActive(cfg, lead.accountId);
  // copy only after the leader was ACCEPTED (an unclear / refused / duplicate leader order sends nothing to the followers)
  if (!(leader.status >= 200 && leader.status < 300 && leader.j.ok !== false) || !active) {
    if (leader.status >= 200 && leader.status < 300 && !active) leader.j.copy = { results: [], off: cfg && cfg.on && cfg.paused ? 'paused' : 'off' };
    return json(leader.j, leader.status);
  }
  let link = {};
  if (lead.op === 'modify' || lead.op === 'cancel') { try { const d = await store(env, deps).get(linkPath(g.uid, lead.accountId, lead.orderId)); link = d ? parse(d.linksJson, {}) : {}; } catch (e) { link = {}; } }
  const results = await fanOut(request, env, deps, g, C.activeFollowers(cfg), lead, { link, role });
  if (lead.op === 'place' && leader.j.orderId) {
    const m = {}; for (const x of results) if (x.orderId && !C.isPaper(x.id)) m[x.id] = x.orderId;
    if (Object.keys(m).length) { const w = store(env, deps).set(linkPath(g.uid, lead.accountId, leader.j.orderId), { linksJson: JSON.stringify(m), at: new Date((deps.now || Date.now)()).toISOString() }).catch(() => {}); (deps.defer ? deps.defer(w) : w); }
  }
  return json({ ...leader.j, copy: { results } }, leader.status);
}

// every follower in parallel; each result is that follower's own (one failing never blocks another). Paper = handed to the browser.
export async function fanOut(request, env, deps, g, followers, lead, ctx) {
  const child = Object.assign(Object.create(deps), { fanChild: true });
  return Promise.all(followers.map(async (f) => {
    let roleIds = null;
    if (ctx.role && !C.isPaper(f.id)) { try { roleIds = await getBracket(env, deps, groupId(f.id, C.mapCode(lead.symbol, f.map))); } catch (e) { roleIds = null; } }
    const fb = C.followerBody(f, lead, { link: ctx.link, roleIds, role: ctx.role });
    if (fb.skip) return { id: f.id, state: 'skipped', message: fb.skip };
    if (C.isPaper(f.id)) return { id: f.id, state: 'paper', paper: fb.body };
    try {
      const r = await exec(request, env, child, g, { ...fb.body, src: 'chart', accountId: f.id });
      const u = await unpack(r);
      return { id: f.id, symbol: fb.body.symbol || '', qty: fb.body.qty || 0, ...C.resultOf(u.status, u.j), ...(u.j.bracket ? { bracket: u.j.bracket } : {}), ...(lead.op === 'bracket' ? { group: u.j.group || null } : {}) };
    } catch (e) { return { id: f.id, state: 'rejected', message: 'Error on our side. Nothing more was sent to this account.' }; }
  }));
}
export const handle = safe('copy', run);
export const onRequest = pagesEntry(handle, { retryHere: false });
