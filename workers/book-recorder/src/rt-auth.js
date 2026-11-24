// Real-time access gate for CME futures data (Owner order 2026-10-16: "remove real time candles
// access for cme futures for everyone except admin"). Pure module, no Pages context.
// Used by: functions/api/chart/stream/[sym].js, functions/api/chart/bars/[sym].js, functions/api/chart/rt.js, functions/api/gex/_pro.js, functions/api/zo/[name].js.
// IDENTICAL COPY (kept in step by tools/tests/rt-access.test.mjs): workers/book-recorder/src/rt-auth.js.
//
// Who is an admin: the site's own rule, an existing document at admins/{uid} in Firestore
// (assets/admin-guard.js, firestore.rules isAdmin()). The caller sends its Firebase ID token;
// this module (1) verifies the JWT signature (RS256) against Google's public keys (cached),
// issuer, audience, expiry, then (2) reads admins/{uid} over the Firestore REST API USING THE
// USER'S OWN TOKEN, so the live security rules decide (200 = exists = admin). No secret is
// needed and a client "isAdmin" flag is never trusted. Everything fails CLOSED (not admin).
// Result per uid is memoised 5 min in the isolate (admins, a yes); the students/{uid} answer (demo / liveFeed) 30 s,
// so an admin switching someone's live feed OFF takes effect within about a minute.
export const RT_DELAY_S = 600;
// Market Data Agreement version (Owner 2026-11-04: live futures L1 is free for every member who signed the CURRENT agreement).
// MUST equal AGREEMENT_VERSION in functions-src/marketData.js and VERSION in assets/market-data-agreement.js (tools/tests/market-data-terms.test.js).
export const MDA_VERSION = 'v1';          // non-admins see nothing newer than now - 10 min
export const RT_PROJECT = 'strykertrades-e0cd8';
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const ISSUER = 'https://securetoken.google.com/' + RT_PROJECT;
const ADMIN_TTL_MS = 300000;   // a confirmed admin, 5 min (was 60 s; 24 Nov 2026: Firestore's daily read quota ran out). A "no" stays 5 s.
const GRACE_MS = 3 * 24 * 3600 * 1000;   // same grace as functions-src/subscriptions.js: access continues 3 days past paidThroughMillis
const STUDENT_TTL_MS = 30000;   // demo / liveFeed: switching a user off bites within ~1 min (memo + stream re-check)
// READ BUDGET (24 Nov 2026: the Firestore daily read quota ran out). Every chart bars request re-read admins/{uid} (a 404 for
// every member, memo 5 s) and students/{uid} (memo 30 s) per isolate, ~160k billed reads a day. Now a DEFINITE answer is also
// shared across isolates through the Cloudflare Cache API (key = an internal URL per uid, never served to anyone; no-op where
// the Cache API is missing, e.g. tests and *.workers.dev), and the isolate memo keeps a "no admin" 10 min (students/{uid}: isolate 30 s; shared yes 5 min, shared no 45 s, so a switch-OFF by an admin bites within ~5 min, a switch-ON at once via fresh).
// A students/{uid} answer stays short, and /api/chart/rt asks with opts.fresh (no cached "no"),
// so a member who just signed the agreement / paid goes live as fast as before. Outages are never stored.
const ADMIN_NO_TTL_MS = 600000;
const STUDENT_YES_TTL_MS = STUDENT_TTL_MS;   // a yes stays 30 s: switching a member off must still bite within ~1 min
const SHARED_TTL_S = { admin1: 300, admin0: 600, rt1: 300, rt0: 45, l21: 300, l20: 60 };
const SHARED_BASE = 'https://rt-memo.tradezoro.internal/v1/';
const sharedCache = () => { try { return (globalThis.caches && globalThis.caches.default) || null; } catch (e) { return null; } };
async function sharedGet(kind, uid) {
  const c = sharedCache(); if (!c) return null;
  try { const r = await c.match(SHARED_BASE + kind + '/' + encodeURIComponent(uid)); if (!r) return null; const j = await r.json(); return typeof j.v === 'boolean' ? j.v : null; } catch (e) { return null; }
}
function sharedPut(kind, uid, v, opts) {
  const c = sharedCache(); if (!c) return;
  const ttl = SHARED_TTL_S[kind + (v ? '1' : '0')];
  const p = c.put(SHARED_BASE + kind + '/' + encodeURIComponent(uid), new Response(JSON.stringify({ v }), { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=' + ttl } })).catch(() => {});
  try { if (opts && opts.waitUntil) opts.waitUntil(p); } catch (e) {}
}
export const _sharedForTests = { get: sharedGet, put: sharedPut, TTL: SHARED_TTL_S };

const PLANS_TTL_MS = 300000;   // plans collection (public read) memo: which plan names are paid (rank >= 1)
let jwks = null, jwksAt = 0, jwksTry = 0;
const adminMemo = new Map();
const demoMemo = new Map();
// FIRESTORE OUTAGE != "NO" (Owner bug 24 Nov 2026: the project's daily Firestore quota ran out, every read answered 429, and the Owner,
// an admin, was demoted to the 10-minute feed with the paid-feed upsell while the L2 hub revoked every open socket). A read is DEFINITE
// only when Firestore answered 200 / 404, or 403 PERMISSION_DENIED (the rules said no). Anything else (429 quota, 5xx, network, other
// 403s such as billing / API disabled) is an OUTAGE: a uid this isolate CONFIRMED in the last LASTYES_MS keeps that answer, anyone else
// still fails closed. An outage is never memoised as a "no", and callers can see it (opts.out.outage = true) so they never revoke on it.
const LASTYES_MS = { admin: 24 * 3600e3, rt: 6 * 3600e3, l2: 6 * 3600e3 };
const lastYes = new Map();
const yesKey = (kind, uid) => kind + ':' + uid;
function noteYes(kind, uid, v) { if (lastYes.size > 2000) lastYes.clear(); if (v) lastYes.set(yesKey(kind, uid), Date.now()); else lastYes.delete(yesKey(kind, uid)); }
const hadYes = (kind, uid) => { const t = lastYes.get(yesKey(kind, uid)); return !!t && Date.now() - t < LASTYES_MS[kind]; };
const markOutage = (opts) => { if (opts && opts.out) opts.out.outage = true; };
// -> 'ok' (200), 'no' (404 / rules said no), 'outage'
async function definite(r) {
  if (!r) return 'outage';
  if (r.status === 200) return 'ok';
  if (r.status === 404) return 'no';
  if (r.status === 403) { let b = ''; try { b = await r.clone().text(); } catch (e) {} return /PERMISSION_DENIED/.test(b) ? 'no' : 'outage'; }
  return 'outage';
}
let plansMemo = null;   // { at, paid:Set(lowercased plan names/ids with rank >= 1) }

// Live Futures Data add-on (Owner order 2026-10-30, $7/month): students/{uid}.liveData = { active, paidThroughMillis,
// source: 'stripe'|'razorpay'|'manual' }, written only by Cloud Functions / an admin. Active = active === true and, when there is a
// paidThroughMillis, now <= paidThrough + 3 days grace. Being on Pro does NOT count. Fails closed (missing / odd shapes = no).
export function isActiveLiveDataDoc(f, nowMs = Date.now()) {
  const m = f && f.liveData && f.liveData.mapValue && f.liveData.mapValue.fields;
  if (!m || !m.active || m.active.booleanValue !== true) return false;
  const pt = m.paidThroughMillis ? Number(m.paidThroughMillis.integerValue ?? m.paidThroughMillis.doubleValue ?? m.paidThroughMillis.stringValue) : 0;
  if (pt > 0 && nowMs > pt + GRACE_MS) return false;
  return true;
}

// Pro (used ONLY to keep grandfathered members live while their Pro stays active, Owner 2026-10-30) = the same rule the paywall uses (assets/plan-limits.js: rankOf(students.plan) >= 1, ranks from the public plans
// collection). Read server-side from the student's own doc. Active = status not expired/cancelled and, when the member
// has a paidThroughMillis, now <= paidThrough + 3 days grace (the daily sweep downgrades plan itself; this closes the gap).
export async function paidPlanNames(fetchImpl) {
  if (plansMemo && Date.now() - plansMemo.at < PLANS_TTL_MS) return plansMemo.paid;
  let paid = null;
  try {
    const r = await fetchImpl('https://firestore.googleapis.com/v1/projects/' + RT_PROJECT + '/databases/(default)/documents/plans?pageSize=100');
    if (r.ok) {
      paid = new Set();
      for (const d of (await r.json()).documents || []) {
        const f = d.fields || {}, rk = f.rank ? Number(f.rank.integerValue ?? f.rank.doubleValue ?? f.rank.stringValue) : 0;
        if (rk >= 1) {
          paid.add(d.name.split('/').pop().toLowerCase());
          if (f.name && f.name.stringValue) paid.add(f.name.stringValue.toLowerCase());
        }
      }
    }
  } catch (e) { paid = null; }
  if (!paid || !paid.size) { if (plansMemo) { plansMemo.at = Date.now() - PLANS_TTL_MS + 15000; return plansMemo.paid; } return new Set(['pro', 'elite']); }
  plansMemo = { at: Date.now(), paid };
  return paid;
}
export function isActiveProDoc(f, paid, nowMs = Date.now()) {
  const plan = f.plan && f.plan.stringValue ? f.plan.stringValue.toLowerCase() : '';
  if (!plan || !paid.has(plan)) return false;
  const st = f.subscriptionStatus && f.subscriptionStatus.stringValue;
  if (st === 'expired' || st === 'cancelled' || st === 'canceled') return false;
  if (f.foundingMember && f.foundingMember.booleanValue === true) return true;
  const pt = f.paidThroughMillis ? Number(f.paidThroughMillis.integerValue ?? f.paidThroughMillis.doubleValue ?? f.paidThroughMillis.stringValue) : 0;
  if (pt > 0 && nowMs > pt + GRACE_MS) return false;
  return true;
}

// Beta tester (Owner 2026-11-22): students/{uid}.beta === true, written ONLY by the server (functions/api/beta, the Discord role sync); counts as Pro
// for the live data gate below. Billing fields are never touched. Needs the live rule that makes `beta` privileged (reports/workers/w-beta.md).
export const isBetaDoc = (f) => !!(f && f.beta && f.beta.booleanValue === true);

// Signed agreement = students/{uid}.marketDataAgreement { version: MDA_VERSION, nonProfessional: true }, written ONLY by the callable
// acceptMarketDataAgreement (privileged in firestore.rules). Old version / missing / odd shapes = no. Fails closed.
export function hasAgreementDoc(f) {
  const m = f && f.marketDataAgreement && f.marketDataAgreement.mapValue && f.marketDataAgreement.mapValue.fields;
  return !!m && !!m.version && m.version.stringValue === MDA_VERSION && !!m.nonProfessional && m.nonProfessional.booleanValue === true;
}

function b64uBytes(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64uJson = (s) => JSON.parse(new TextDecoder().decode(b64uBytes(s)));

async function keyFor(kid, fetchImpl) {
  const now = Date.now();
  const fresh = jwks && now - jwksAt < 3600e3;
  if ((!fresh || !jwks.has(kid)) && now - jwksTry > 30000) {
    jwksTry = now;
    try {
      const r = await fetchImpl(JWKS_URL);
      if (r.ok) {
        const j = await r.json(), m = new Map();
        for (const k of j.keys || []) {
          try { m.set(k.kid, await crypto.subtle.importKey('jwk', k, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])); } catch (e) {}
        }
        if (m.size) { jwks = m; jwksAt = now; }
      }
    } catch (e) {}
  }
  return jwks && jwks.get(kid) || null;
}

// -> uid string, or null. opts.fetchImpl / opts.nowSec are for tests.
export async function verifyIdToken(token, opts = {}) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3 || token.length > 4096) return null;
    const head = b64uJson(parts[0]), p = b64uJson(parts[1]);
    if (head.alg !== 'RS256' || !head.kid) return null;
    const now = opts.nowSec || Math.floor(Date.now() / 1000);
    if (p.iss !== ISSUER || p.aud !== RT_PROJECT) return null;
    if (typeof p.sub !== 'string' || !p.sub || p.sub.length > 128) return null;
    if (p.firebase && p.firebase.sign_in_provider === 'anonymous') return null;   // anonymous sign-in is never a member (free L1 needs a real account)
    if (!(p.exp > now) || !(p.iat <= now + 300)) return null;
    const key = await keyFor(head.kid, opts.fetchImpl || fetch);
    if (!key) { markOutage(opts); return null; }   // Google's keys could not be read: unknown, not a bad token
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64uBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    return ok ? p.sub : null;
  } catch (e) { return null; }
}

// true only for a verified token whose uid has an admins/{uid} document.
export async function isAdminToken(token, opts = {}) {
  const uid = await verifyIdToken(token, opts);
  if (!uid) return false;
  const hit = adminMemo.get(uid);
  if (hit && Date.now() - hit.at < hit.ttl && !(opts.fresh && !hit.v)) { if (hit.o) markOutage(opts); return hit.v; }
  if (!opts.fresh) {
    const sv = await sharedGet('admin', uid);
    if (sv !== null) { noteYes('admin', uid, sv); adminMemo.set(uid, { v: sv, at: Date.now(), ttl: sv ? ADMIN_TTL_MS : ADMIN_NO_TTL_MS, o: false }); return sv; }
  }
  let v = false, ttl = ADMIN_TTL_MS, out = false;
  try {
    const url = 'https://firestore.googleapis.com/v1/projects/' + RT_PROJECT + '/databases/(default)/documents/admins/' + encodeURIComponent(uid);
    // Frozen-candles fix 2026-10-20: a "no" must never stick. One retry on any non-definitive answer, and a
    // negative answer is remembered only 5 s (a positive 60 s), so a Firestore blip cannot hold an admin on
    // the delayed feed for a minute. 404 = no admins/{uid} doc = a definite "not admin".
    let r = null, d = 'outage';
    for (let i = 0; i < 2; i++) {
      try { r = await (opts.fetchImpl || fetch)(url, { headers: { authorization: 'Bearer ' + token } }); } catch (e) { r = null; }
      d = await definite(r);
      if (d !== 'outage') break;
    }
    if (d === 'ok') v = true;
    else if (d === 'no') ttl = ADMIN_NO_TTL_MS;   // was 5 s: a member is not an admin; new admins wait up to 10 min (read budget)
    else out = true;   // outage (429 quota / 5xx / network): never a "no" for an admin this isolate confirmed
  } catch (e) { out = true; }
  if (out) { markOutage(opts); v = hadYes('admin', uid); ttl = v ? 15000 : 0; }
  else { noteYes('admin', uid, v); sharedPut('admin', uid, v, opts); }
  if (adminMemo.size > 500) adminMemo.clear();
  if (ttl) adminMemo.set(uid, { v, at: Date.now(), ttl, o: out });
  return v;
}

// Real-time entitlement = admin, OR the marketing demo account (CoS decision 2026-10-17), OR a member the
// Owner switched on from the admin page (liveFeed, Owner 2026-10-26 "I can select which users get live feed"):
// a token-verified uid whose OWN students/{uid} document has demo === true or liveFeed === true, OR an active Live Futures Data add-on (students/{uid}.liveData, $7/month, Owner 2026-10-30). Pro alone no longer includes real-time, EXCEPT the 46 grandfathered early Pro members (liveFeed + liveFeedGrandfathered, CoS-set): live only while isActiveProDoc stays true (Owner 2026-10-30). The doc is read
// over the Firestore REST API with the caller's own token, so the live rules decide (a student can only read
// their own doc), and `demo` / `liveFeed` are server-only fields (privileged in firestore.rules: only an admin
// writes them). Since 2026-11-04 also ANY signed-in member whose students/{uid}.marketDataAgreement is the current version
// (hasAgreementDoc): this gate is L1 only (candles, trades, quotes); the L2 book uses tsAllowed / isLiveDataToken; tools use isMemberToken. Fails CLOSED.
export async function isDemoToken(token, opts = {}) {
  const uid = await verifyIdToken(token, opts);
  if (!uid) return false;
  const hit = demoMemo.get(uid);
  if (hit && Date.now() - hit.at < hit.ttl && !(opts.fresh && !hit.v)) { if (hit.o) markOutage(opts); return hit.v; }
  if (!opts.fresh) {
    const sv = await sharedGet('rt', uid);
    if (sv !== null) { noteYes('rt', uid, sv); demoMemo.set(uid, { v: sv, at: Date.now(), ttl: sv ? STUDENT_YES_TTL_MS : STUDENT_TTL_MS, o: false }); return sv; }
  }
  let v = false, ttl = STUDENT_TTL_MS, out = false;
  try {
    const url = 'https://firestore.googleapis.com/v1/projects/' + RT_PROJECT + '/databases/(default)/documents/students/' + encodeURIComponent(uid);
    const r = await (opts.fetchImpl || fetch)(url, { headers: { authorization: 'Bearer ' + token } });
    const d = await definite(r);
    if (d === 'ok') {
      const f = ((await r.json()) || {}).fields || {};
      const nowMs = opts.nowMs || Date.now();
      const lf = !!(f.liveFeed && f.liveFeed.booleanValue === true), gf = !!(f.liveFeedGrandfathered && f.liveFeedGrandfathered.booleanValue === true);
      // live = demo || (liveFeed && !grandfathered: manual, unconditional) || (grandfathered && Pro still active) || add-on
      v = !!(f.demo && f.demo.booleanValue === true) || (lf && !gf);
      if (!v && lf && gf) v = isActiveProDoc(f, await paidPlanNames(opts.fetchImpl || fetch), nowMs);
      if (!v) v = isActiveLiveDataDoc(f, nowMs);
      if (!v) v = hasAgreementDoc(f);   // free live L1 for any member with the current agreement (Owner 2026-11-04). L2 never uses this gate (ts-access.js tsAllowed).
    }
    else if (d === 'outage') out = true;   // a read blip / quota is not a "no"
  } catch (e) { out = true; }
  if (out) { markOutage(opts); v = hadYes('rt', uid); ttl = v ? 15000 : 0; }
  else { noteYes('rt', uid, v); if (v) ttl = STUDENT_YES_TTL_MS; sharedPut('rt', uid, v, opts); }
  if (demoMemo.size > 500) demoMemo.clear();
  if (ttl) demoMemo.set(uid, { v, at: Date.now(), ttl, o: out });
  return v;
}
export async function isRealtimeToken(token, opts = {}) {
  return (await isAdminToken(token, opts)) || (await isDemoToken(token, opts));
}

// ALL TOOLS FREE (Owner order 2026-11-13, "Pro tools will be made free from tonight onwards ... Only paid will be data feed"):
// every tool (GEX+, options analytics, order-flow history, levels export) answers any verified, NON-ANONYMOUS member token.
// No Firestore read: the signature, issuer, audience, expiry and the anonymous refusal (verifyIdToken) are the whole check.
// Fails CLOSED. Used by functions/api/gex/_pro.js, functions/api/zo/[name].js and the recorder's GEX / history routes.
export async function isMemberToken(token, opts = {}) {
  return !!(await verifyIdToken(token, opts));
}

// LIVE DATA (the paid part, the existing Pro subscription): who gets the LIVE futures order book (L2) and anything derived from it.
// = a verified token that is an admin, the marketing demo account, or an ACTIVE paid plan (isActiveProDoc; grandfathered early Pro
// members are Pro too). Same rule as the old GEX Pro gate (the old GEX+ Pro check, renamed 2026-11-13). The student doc is read with the
// caller's own token, so the live rules decide. Fails CLOSED. Memoised 60 s (positive) / 10 s (negative).
const liveMemo = new Map();
export async function isLiveDataToken(token, opts = {}) {
  const uid = await verifyIdToken(token, opts);
  if (!uid) return false;
  const hit = liveMemo.get(uid);
  if (hit && Date.now() - hit.at < hit.ttl && !(opts.fresh && !hit.v)) { if (hit.o) markOutage(opts); return hit.v; }
  if (!opts.fresh) {
    const sv = await sharedGet('l2', uid);
    if (sv !== null) { noteYes('l2', uid, sv); liveMemo.set(uid, { v: sv, at: Date.now(), ttl: sv ? 300000 : 10000, o: false }); return sv; }
  }
  let v = false, ttl = 10000, out = false;
  const sub = { fetchImpl: opts.fetchImpl, nowSec: opts.nowSec, nowMs: opts.nowMs, fresh: opts.fresh, waitUntil: opts.waitUntil, out: {} };
  try {
    if (await isAdminToken(token, sub)) { v = true; }
    else {
      const f = opts.fetchImpl || fetch;
      const r = await f('https://firestore.googleapis.com/v1/projects/' + RT_PROJECT + '/databases/(default)/documents/students/' + encodeURIComponent(uid), { headers: { authorization: 'Bearer ' + token } });
      const d = await definite(r);
      if (d === 'ok') {
        const fl = ((await r.json()) || {}).fields || {};
        v = !!(fl.demo && fl.demo.booleanValue === true) || isBetaDoc(fl) || isActiveProDoc(fl, await paidPlanNames(f), opts.nowMs || Date.now());
      } else if (d === 'outage' || sub.out.outage) out = true;   // the admin read failed too, or the student read did: unknown, not "no"
    }
    if (v) ttl = 300000;   // a confirmed live-book member, 5 min (was 60 s): fewer Firestore reads; a "no" stays 10 s
  } catch (e) { v = false; out = true; }
  if (out || sub.out.outage) { out = true; markOutage(opts); v = v || hadYes('l2', uid); ttl = v ? 15000 : 0; }   // v already true = an admin kept through the outage
  else { noteYes('l2', uid, v); sharedPut('l2', uid, v, opts); }
  if (liveMemo.size > 500) liveMemo.clear();
  if (ttl) liveMemo.set(uid, { v, at: Date.now(), ttl, o: out });
  return v;
}

export const bearerOf = (request) => {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '');
  return m ? m[1] : '';
};
// WebSocket: the browser sends the token as a subprotocol ("tz-auth", "<jwt>"), never in the URL.
export function wsTokenOf(request) {
  const list = String(request.headers.get('sec-websocket-protocol') || '').split(',').map((x) => x.trim());
  const i = list.indexOf('tz-auth');
  return i >= 0 && list[i + 1] ? list[i + 1] : '';
}
// JWT payload of a token WITHOUT verifying it (exp / sub of a token the caller already verified, or to tell an expired token from a bad one)
export const tokClaims = (t) => { try { return JSON.parse(atob(String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) || {}; } catch (e) { return {}; } };
export const _resetForTests = (keepYes) => { jwks = null; jwksAt = 0; jwksTry = 0; plansMemo = null; adminMemo.clear(); demoMemo.clear(); liveMemo.clear(); if (!keepYes) lastYes.clear(); };
