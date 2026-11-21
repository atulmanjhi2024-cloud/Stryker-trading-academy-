// MEMBER LIVE TRADING (Owner decision 21 Nov 2026: every signed-in member may connect their own broker and place live orders).
// Ownership, the one-time "Enable live trading" acceptance and the per-member admin kill. Server-written Firestore docs only
// (service account; the client rules deny writes, see functions-src/firestore.rules):
//   brokerUsers/{uid}   { finUserId, pendingHash, updatedAt }  the broker-link user this member connected under (one per member)
//   finUsers/{finUserId} { uid, at }                              reverse claim, CREATE-ONLY: a broker-link user belongs to one uid forever
//   liveConsent/{uid}   { uid, version, at, ip }                  the live-trading risk notice this member accepted
//   settings/liveBlocked { <uid>: true }                          admin kill per member (a map field per uid; true = blocked).
//                                                                  One doc (admin-writable through the existing settings rule).
// Rules every route follows (data.js, order.js, session.js):
// - The broker-link user id is NEVER taken from the client for a member. It comes from brokerUsers/{uid}, or it is claimed from a
//   portal session this server started FOR THIS uid (pendingHash = SHA-256 of that session id; the id itself is never stored). Admins may claim the id their browser kept (the pre-21 Nov
//   admin-only setup kept it in localStorage only); a claim fails if another uid already holds it.
// - Every account-scoped call checks the account is in that user's own account list (ownsAccount); a grant revoke checks the grant.
// Tests: tests/finatic/member-live.test.mjs (deps.store = in-memory store; no network).
import { DOCS, fields, fsCall } from './_audit.js';
import { fail, needsConnect, fin, UUID, ID } from './_fin.js';

export const LIVE_TERMS_VERSION = '2026-11-21';
const unv = (v) => (!v ? null : 'mapValue' in v ? Object.fromEntries(Object.entries((v.mapValue && v.mapValue.fields) || {}).map(([k, x]) => [k, unv(x)])) : 'stringValue' in v ? v.stringValue : 'booleanValue' in v ? v.booleanValue : 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue : 'timestampValue' in v ? v.timestampValue : null);
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

// ---- tiny document store: Firestore REST with the service account, or deps.store in tests -------------------------------
// get -> object | null (throws when unreadable); create -> true, or throws e.duplicate; set -> merge the given fields (throws)
function store(env, deps) {
  if (deps.store) return deps.store;
  return {
    async get(path) {
      const r = await fsCall(env, deps, 'GET', DOCS + enc(path));
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('read ' + r.status);
      const j = await r.json(), o = {};
      for (const [k, v] of Object.entries((j && j.fields) || {})) o[k] = unv(v);
      return o;
    },
    async create(path, obj) {
      const i = path.lastIndexOf('/');
      const r = await fsCall(env, deps, 'POST', DOCS + enc(path.slice(0, i)) + '?documentId=' + encodeURIComponent(path.slice(i + 1)), { fields: fields(obj) });
      if (r.status === 409) { const e = new Error('duplicate'); e.duplicate = true; throw e; }
      if (!r.ok) throw new Error('create ' + r.status);
      return true;
    },
    async set(path, obj) {
      const mask = Object.keys(obj).map((k) => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
      const r = await fsCall(env, deps, 'PATCH', DOCS + enc(path) + '?' + mask, { fields: fields(obj) });
      if (!r.ok) throw new Error('write ' + r.status);
    },
  };
}

// ---- who owns what (cached per isolate; a cache is only ever a "yes", a "no" is always re-checked) -------------------------
const ownerMemo = new Map(), acctMemo = new Map(), consentMemo = new Map(), blockMemo = new Map();
export const _resetOwner = () => { ownerMemo.clear(); acctMemo.clear(); consentMemo.clear(); blockMemo.clear(); };
const OWNER_TTL = 60000, ACCT_TTL = 60000, CONSENT_TTL = 10 * 60000, BLOCK_TTL = 5000;
const clock = (deps) => (deps.now || Date.now)();
const sha = async (s) => { const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)))); let h = ''; for (const x of b) h += x.toString(16).padStart(2, '0'); return h; };

async function ownerRec(env, deps, uid) {
  const hit = ownerMemo.get(uid), t = clock(deps);
  if (hit && t - hit.at < OWNER_TTL) return hit.v;
  const v = (await store(env, deps).get('brokerUsers/' + uid)) || {};
  if (ownerMemo.size > 500) ownerMemo.clear();
  ownerMemo.set(uid, { v, at: t });
  return v;
}
// claim finUser for uid: create-only reverse doc; an existing claim by the same uid is fine, by another uid is refused
async function claim(env, deps, uid, finUser) {
  const st = store(env, deps);
  try { await st.create('finUsers/' + finUser, { uid, at: new Date(clock(deps)).toISOString() }); }
  catch (e) {
    if (!e.duplicate) throw e;
    const cur = await st.get('finUsers/' + finUser);
    if (!cur || cur.uid !== uid) return false;
  }
  await st.set('brokerUsers/' + uid, { finUserId: finUser, pendingHash: '', updatedAt: new Date(clock(deps)).toISOString() });
  ownerMemo.delete(uid); acctMemo.delete(finUser);
  return true;
}
// session.js: remember the portal session this server started for uid (only that session may claim a new broker-link user)
export async function rememberSession(env, deps, uid, sessionId) {
  await store(env, deps).set('brokerUsers/' + uid, { pendingHash: await sha(sessionId), updatedAt: new Date(clock(deps)).toISOString() });
  ownerMemo.delete(uid);
}

// -> { finUser } (may be '' = not connected yet) | Response. g = { uid, admin } from gate(); b = the request body.
// opts.session: the route may finish a portal connect with b.sessionId (data.js only).
export async function resolveFinUser(env, deps, g, b, opts = {}) {
  let rec;
  try { rec = await ownerRec(env, deps, g.uid); } catch (e) { return fail(503, 'Could not read your broker connection. Try again in a moment.', 'owner_unreadable'); }
  const mine = typeof rec.finUserId === 'string' && UUID.test(rec.finUserId) ? rec.finUserId : '';
  const asked = typeof b.userId === 'string' && UUID.test(b.userId) ? b.userId : '';
  // a finished portal connect: only the session this server started for this uid counts
  if (opts.session && typeof b.sessionId === 'string' && ID.test(b.sessionId)) {
    if (!rec.pendingHash || rec.pendingHash !== (await sha(b.sessionId))) return mine ? { finUser: mine } : fail(403, 'This connection was not started from your account. Start Connect a broker again.', 'not_owner');
    const u = await fin(env, deps, 'GET', '/api/v1/sessions/' + encodeURIComponent(b.sessionId) + '/user');
    if (!u.ok && (u.status === 0 || u.status >= 500 || u.bad)) return fail(502, 'The broker connection service is not answering properly right now. Try again in a minute.', 'upstream');
    const fu = (u.ok && u.data && (u.data.userId || u.data.user_id)) || '';
    if (!(typeof fu === 'string' && UUID.test(fu))) return mine ? { finUser: mine } : { finUser: '' };   // that session has no user yet
    if (fu === mine) return { finUser: mine };
    let ok; try { ok = await claim(env, deps, g.uid, fu); } catch (e) { return fail(503, 'Could not save your broker connection. Try again in a moment.', 'owner_unwritable'); }
    return ok ? { finUser: fu } : fail(403, 'This broker connection belongs to another TradeZoro account.', 'not_owner');
  }
  if (mine) return { finUser: mine };   // the client's own copy is ignored: the server's record wins (a stale id just gets replaced)
  // legacy (admins only): the id the admin's browser kept from the admin-only beta; claimed once, refused if someone else holds it
  if (asked && g.admin) {
    let ok; try { ok = await claim(env, deps, g.uid, asked); } catch (e) { return fail(503, 'Could not save your broker connection. Try again in a moment.', 'owner_unwritable'); }
    return ok ? { finUser: asked } : fail(403, 'This broker connection belongs to another TradeZoro account.', 'not_owner');
  }
  return { finUser: '' };
}
// convenience for routes that need a connected user: -> { finUser } | Response (needsConnect when none)
export async function requireFinUser(env, deps, g, b, opts) {
  const r = await resolveFinUser(env, deps, g, b, opts);
  if (r instanceof Response) return r;
  return r.finUser ? r : needsConnect();
}

// -> true | false | Response. call(method, path, opts) = a session call for finUser. Positive answers are cached 60 s; an id that
// is not in the cached list is re-read once (a broker connected a moment ago). An unreadable list = refused (fails closed).
export async function ownsAccount(deps, finUser, call, accountId) {
  const t = clock(deps), hit = acctMemo.get(finUser);
  if (hit && t - hit.at < ACCT_TTL && hit.ids.has(accountId)) return true;
  const r = await call('GET', '/api/v1/accounts', { query: { limit: 1000, offset: 0 } });
  if (!r.ok) return fail(502, 'Could not check your accounts at the broker right now. Nothing was sent.', 'upstream');
  const ids = new Set((Array.isArray(r.data) ? r.data : []).map((x) => String((x && (x.accountId || x.id)) || '')).filter(Boolean));
  if (acctMemo.size > 500) acctMemo.clear();
  acctMemo.set(finUser, { ids, at: t });
  return ids.has(accountId);
}
export const notYours = () => fail(403, 'That account is not connected to your TradeZoro account.', 'not_owner');

// ---- "Enable live trading" acceptance -----------------------------------------------------------------------------------
export async function hasConsent(env, deps, uid) {
  const hit = consentMemo.get(uid), t = clock(deps);
  if (hit && t - hit.at < CONSENT_TTL) return true;
  const d = await store(env, deps).get('liveConsent/' + uid);   // throws when unreadable (caller fails closed)
  const ok = !!(d && d.uid === uid && d.version === LIVE_TERMS_VERSION);
  if (ok) { if (consentMemo.size > 500) consentMemo.clear(); consentMemo.set(uid, { at: t }); }
  return ok;
}
export async function saveConsent(env, deps, uid, ip) {
  const at = new Date(clock(deps)).toISOString();
  await store(env, deps).set('liveConsent/' + uid, { uid, version: LIVE_TERMS_VERSION, at, ip: String(ip || '').slice(0, 64) });
  consentMemo.set(uid, { at: clock(deps) });
  return at;
}

// ---- per-member admin kill: settings/liveBlocked { <uid>: true }. Throws when unreadable (the caller fails closed). -> true = blocked
// One doc for everyone, read at most every 5 s per isolate.
export async function memberBlocked(env, deps, uid) {
  const t = clock(deps), hit = blockMemo.get('doc');
  let d;
  if (hit && t - hit.at < BLOCK_TTL) d = hit.v;
  else { d = (await store(env, deps).get('settings/liveBlocked')) || {}; blockMemo.set('doc', { v: d, at: t }); }
  return d[uid] === true;
}
