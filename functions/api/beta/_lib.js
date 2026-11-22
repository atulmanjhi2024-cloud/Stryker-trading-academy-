// Beta tester program, server side (Owner 2026-11-22, v3: admin adds testers by EMAIL, no Discord linking). Every network call goes through deps.fetchImpl so tests mock Firestore.
// List = Firestore settings/betaTesters { emails: [lower-case, max 30] }. A user is beta when their VERIFIED sign-in email is in it (or they are admin).
// Secrets (Cloudflare env, never in code): FIREBASE_SA_KEY, DISCORD_BOT_TOKEN (bug reports only); KV binding PASSKEYS (rate limits).
// students.beta is written ONLY here (service account; privileged in the students rules). Billing fields are never touched.
import { BETA, normEmail, emailOk } from '../../../assets/beta-config.mjs';
import { verifyIdToken, bearerOf, RT_PROJECT } from '../chart/_rt.js';
import { saFrom } from '../passkey/[[path]].js';

export const ORIGIN = 'https://tradezoro.com';
const FS = 'https://firestore.googleapis.com/v1/projects/' + RT_PROJECT + '/databases/(default)/documents';
export const json = (o, status = 200, h = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', ...h } });
export const okOrigin = (request, env) => {
  const o = request.headers.get('origin'), dev = env.DEV === '1' && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(o || '') && new URL(request.url).hostname !== 'tradezoro.com';
  const sfs = request.headers.get('sec-fetch-site');
  return (o === ORIGIN || dev) && (!sfs || sfs === 'same-origin');
};

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// KV (binding PASSKEYS) with an in-memory fallback for dev/tests.
const mem = new Map();
export const kv = (env) => env.PASSKEYS ? {
  get: (k) => env.PASSKEYS.get(k), put: (k, v, ttl) => env.PASSKEYS.put(k, v, { expirationTtl: Math.max(60, ttl) }), del: (k) => env.PASSKEYS.delete(k),
} : {
  get: async (k) => { const e = mem.get(k); return e && e.x > Date.now() ? e.v : null; }, put: async (k, v, ttl) => { mem.set(k, { v, x: Date.now() + ttl * 1000 }); }, del: async (k) => { mem.delete(k); },
};
export const _memClear = () => mem.clear();
// shortcut: KV counter is not atomic (same as functions/connect/_token.js); worst case one extra report per race. Upgrade: Durable Object.
export async function bump(env, key, max, ttl) {
  const s = kv(env), n = (Number(await s.get(key)) || 0);
  if (n >= max) return false;
  await s.put(key, String(n + 1), ttl); return true;
}

// ---- Firestore (service account) ----
let tokMemo = null;
export async function saToken(env, f = fetch) {
  if (tokMemo && tokMemo.exp > Date.now() + 60000) return tokMemo.t;
  const sa = saFrom(env); if (!sa) return null;
  const now = Math.floor(Date.now() / 1000), enc = new TextEncoder();
  const pem = sa.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const raw = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', raw, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const h = b64u(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))), p = b64u(enc.encode(JSON.stringify({ iss: sa.client_email, sub: sa.client_email, aud: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/datastore', iat: now, exp: now + 300 })));
  const sig = b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(h + '.' + p)));
  const r = await f('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + h + '.' + p + '.' + sig });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j || !j.access_token) return null;
  tokMemo = { t: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3000) * 1000 };
  return tokMemo.t;
}
export const _resetTok = () => { tokMemo = null; };
const val = (v) => Array.isArray(v) ? { arrayValue: { values: v.map(val) } } : v === null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { integerValue: String(Math.round(v)) } : v instanceof Date ? { timestampValue: v.toISOString() } : { stringValue: String(v) };
const unval = (x) => x == null ? null : 'arrayValue' in x ? ((x.arrayValue.values || []).map(unval)) : 'booleanValue' in x ? x.booleanValue : 'integerValue' in x ? Number(x.integerValue) : 'doubleValue' in x ? x.doubleValue : 'timestampValue' in x ? new Date(x.timestampValue) : 'stringValue' in x ? x.stringValue : null;
const dec = (d) => { const o = { _id: d.name.split('/').pop() }; for (const [k, v] of Object.entries(d.fields || {})) o[k] = unval(v); return o; };

export function fsClient(env, f = fetch) {
  const call = async (method, path, body, q = '') => {
    const t = await saToken(env, f); if (!t) return { status: 503 };
    const r = await f(FS + path + q, { method, headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, ok: r.ok, json: await r.json().catch(() => null) };
  };
  return {
    async get(path) { const r = await call('GET', '/' + path); return r.status === 404 ? null : r.ok ? dec(r.json) : (() => { throw new Error('fs ' + r.status); })(); },
    // patch only the named fields; mustExist: true = fail instead of creating a half-empty student doc
    async patch(path, obj, mustExist = true) {
      const q = '?' + Object.keys(obj).map((k) => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&') + (mustExist ? '&currentDocument.exists=true' : '');
      const fields = {}; for (const [k, v] of Object.entries(obj)) if (v !== undefined) fields[k] = val(v);
      const r = await call('PATCH', '/' + path, { fields }, q); if (!r.ok) throw new Error('fs ' + r.status); return true;
    },
    async create(path, obj) {   // false when it already exists
      const i = path.lastIndexOf('/'), fields = {}; for (const [k, v] of Object.entries(obj)) fields[k] = val(v);
      const r = await call('POST', '/' + path.slice(0, i), { fields }, '?documentId=' + encodeURIComponent(path.slice(i + 1)));
      if (r.status === 409) return false; if (!r.ok) throw new Error('fs ' + r.status); return true;
    },
    async del(path) { const r = await call('DELETE', '/' + path); if (!r.ok && r.status !== 404) throw new Error('fs ' + r.status); },
    async query(coll, field, op, v, limit = 500) {
      const r = await call('POST', ':runQuery', { structuredQuery: { from: [{ collectionId: coll }], where: { fieldFilter: { field: { fieldPath: field }, op, value: val(v) } }, limit } });
      if (!r.ok) throw new Error('fs ' + r.status);
      return (r.json || []).filter((x) => x.document).map((x) => dec(x.document));
    },
    async list(coll, limit = 300) { const r = await call('GET', '/' + coll, null, '?pageSize=' + limit + '&mask.fieldPaths=x'); return r.ok ? ((r.json || {}).documents || []).map((d) => d.name.split('/').pop()) : []; },
  };
}

// ---- the beta decision ----
export async function authUid(request, deps = {}) { return verifyIdToken(bearerOf(request), { fetchImpl: deps.verifyFetch }); }
// uid + sign-in email from the signature-checked ID token. verified = email_verified claim (an unverified email is never accepted).
export async function authClaims(request, deps = {}) {
  const uid = await authUid(request, deps); if (!uid) return null;
  let p = {}; try { p = JSON.parse(atob(bearerOf(request).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { p = {}; }
  return { uid, email: normEmail(p.email), verified: p.email_verified === true };
}
export async function isAdminUid(fs, uid) { return !!(await fs.get('admins/' + uid).catch(() => null)); }
export async function getList(fs) { const d = await fs.get(LIST); return d && Array.isArray(d.emails) ? d.emails.map(normEmail).filter(Boolean) : []; }
export const LIST = 'settings/betaTesters';
export const inList = (list, email, verified) => !!(verified && email && list.includes(normEmail(email)));

// Beta for one signed-in user: { uid, admin, beta, email }. Admin = admins/{uid}; otherwise verified email in the list. Throws if Firestore is unreachable (callers fail closed).
export async function betaFor(env, claims, deps = {}) {
  const fs = fsClient(env, deps.fetchImpl || fetch);
  if (await isAdminUid(fs, claims.uid)) return { uid: claims.uid, admin: true, beta: true, fs };
  return { uid: claims.uid, admin: false, beta: inList(await getList(fs), claims.email, claims.verified), fs };
}
export async function isBetaToken(env, request, deps = {}) {
  const c = await authClaims(request, deps); if (!c) return null;
  try { const b = await betaFor(env, c, deps); return { uid: b.uid, admin: b.admin, beta: b.beta }; } catch (e) { return { uid: c.uid, admin: false, beta: false }; }
}
// Mirror to students/{uid}.beta (what the Pro gate and the badge read). Server-only writer; changes nothing else. Returns the value written (or null if no student doc).
export async function mirrorBeta(fs, uid, beta, now = new Date()) {
  const cur = await fs.get('students/' + uid); if (!cur) return null;
  if ((cur.beta === true) === beta) return beta;
  await fs.patch('students/' + uid, { beta, betaSince: beta ? now : null });
  await fs.patch('profiles/' + uid, { beta }, false).catch(() => {});
  return beta;
}
export { emailOk };
