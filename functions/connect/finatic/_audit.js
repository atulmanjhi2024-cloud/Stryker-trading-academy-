// Order-test audit log: Firestore collection brokerOrderAudit (server-written with the service account; rules: admin read, no client write).
// Holds uid, time, env, account, symbol, side, qty, type, result status and the broker order id. Never tokens or keys.
// Chart live orders (2026-11-15): the audit doc id IS the order's idempotency key, created with ?documentId= (Firestore answers 409 for an id
// that exists), so a repeated key never reaches the broker twice (openAudit throws an Error with .duplicate). Also here: the live-trading kill
// switch settings/liveTrading {enabled:false} (admin-writable through the existing settings rule), read by the server before every live write.
const PROJECT = 'strykertrades-e0cd8';
const enc = new TextEncoder();
const b64u = (b) => { let s = ''; const a = new Uint8Array(b); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

// The Google access token is cached in the isolate (TOKEN_TTL_MS, well inside its 1 h life): signing a JWT and the OAuth round trip
// cost ~250 ms per order before (16 Nov baseline). A Firestore 401 drops it (the next order mints a new one).
export const TOKEN_TTL_MS = 45 * 60000;
let tokMemo = { at: 0, v: '', k: '' };
export const _resetToken = () => { tokMemo = { at: 0, v: '', k: '' }; };
async function accessToken(env, fetchImpl, now = Date.now()) {
  const k = String(env.FIREBASE_SA_KEY || '').length + ':' + String(env.FIREBASE_SA_KEY || '').slice(-24);   // a rotated key never reuses the old token
  if (tokMemo.v && tokMemo.k === k && now - tokMemo.at < TOKEN_TTL_MS) return tokMemo.v;
  const v = await mintToken(env, fetchImpl);
  tokMemo = { at: now, v, k };
  return v;
}
const dropToken = () => { tokMemo = { at: 0, v: '', k: '' }; };
// every failure below carries e.reason: a short plain cause with a status code, never a key, token or URL (it goes into the
// audit row, the server log and the order's error message)
const why = (reason) => { const e = new Error(reason); e.reason = reason; return e; };
const fsWhy = (s, what) => (s === 403 ? 'Firestore permission denied (403): the service account may not ' + what
  : s === 401 ? 'Firestore sign-in refused (401)' : s === 429 ? 'Firestore busy (429)' : s >= 500 ? 'Firestore error (' + s + ')' : 'Firestore answered ' + s);
async function mintToken(env, fetchImpl) {
  if (!env.FIREBASE_SA_KEY) throw why('service account key missing');
  let sa; try { sa = JSON.parse(env.FIREBASE_SA_KEY); } catch (e) { throw why('service account key unreadable'); }
  if (!sa || !sa.private_key || !sa.client_email) throw why('service account key incomplete');
  const pem = sa.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const raw = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', raw, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))), p = b64u(enc.encode(JSON.stringify({ iss: sa.client_email, sub: sa.client_email, aud: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/datastore', iat: now, exp: now + 3600 })));
  const sig = b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(h + '.' + p)));
  let r; try { r = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + h + '.' + p + '.' + sig }); }
  catch (e) { throw why('Google sign-in unreachable'); }
  if (!r.ok) throw why('Google sign-in refused the service account (' + r.status + ')');
  let at = ''; try { at = (await r.json()).access_token; } catch (e) {}
  if (!at) throw why('Google sign-in gave no token');
  return at;
}
const val = (v) => (v === null || v === undefined ? { nullValue: null } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : { stringValue: String(v).slice(0, 300) });
const fields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, val(v)]));
const DOCS = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents/';
const base = DOCS + 'brokerOrderAudit';

// -> { id, finish(result) } or throws (caller refuses the order: no audit, no order). docId (optional) = the idempotency key.
// The 'attempt' row is still written BEFORE the order (it is also the duplicate guard); order.js runs it in parallel with the fresh
// positions/orders read, so it costs no extra time on a chart place. finish() (the result) goes out after the reply (deps.defer).
export async function openAudit(env, deps, entry, docId) {
  if (deps.audit) return deps.audit(entry, docId);
  const f = deps.auditFetch || fetch;
  const id = docId || crypto.randomUUID().replace(/-/g, '');
  const doc = { ...entry, at: new Date().toISOString(), result: 'attempt' };
  const create = async (at) => f(base + '?documentId=' + encodeURIComponent(id), { method: 'POST', headers: { authorization: 'Bearer ' + at, 'content-type': 'application/json' }, body: JSON.stringify({ fields: fields(doc) }) });
  let at = await accessToken(env, f);
  let r = await create(at);
  if (r.status === 401) { dropToken(); at = await accessToken(env, f); r = await create(at); }   // cached token revoked/expired early
  if (r.status === 409) { const e = new Error('duplicate'); e.duplicate = true; throw e; }
  if (!r.ok) throw why(fsWhy(r.status, 'write the audit log'));
  return { id, finish: async (res) => { try { const mask = Object.keys(res).map((k) => 'updateMask.fieldPaths=' + k).join('&'); await f(base + '/' + encodeURIComponent(id) + '?' + mask, { method: 'PATCH', headers: { authorization: 'Bearer ' + at, 'content-type': 'application/json' }, body: JSON.stringify({ fields: fields(res) }) }); } catch (e) { /* attempt row already exists */ } } };
}

// Kill switch: settings/liveTrading. -> true (live writes allowed) | false (switched off); throws (e.reason set) when it cannot be read
// and there is no recent good value (the caller fails CLOSED).
// No doc = never switched off (the FINATIC_LIVE_ORDERS env switch must still be on). A good read is reused for 5 s per isolate.
// Owner bug 19 Nov ("Live trading switch could not be read"): one failed read refused the order. Now a failed read (token mint,
// 401/403, 429, 5xx, network) is retried ONCE with a freshly minted token; if that fails too, the last GOOD value read in this
// isolate within LAST_GOOD_MS is used (that is still the switch's real state, at most 60 s old; "off" stays off). Nothing ever read
// = refused. A failure is never cached.
export const LAST_GOOD_MS = 60000;
let killMemo = { at: 0, v: null };
export const _resetKill = () => { killMemo = { at: 0, v: null }; };
async function readSwitch(env, f) {
  const at = await accessToken(env, f);
  let r; try { r = await f(DOCS + 'settings/liveTrading', { headers: { authorization: 'Bearer ' + at } }); } catch (e) { throw why('Firestore unreachable'); }
  if (r.status === 404) return true;
  if (!r.ok) throw Object.assign(why(fsWhy(r.status, 'read settings/liveTrading')), { status: r.status });
  let j; try { j = await r.json(); } catch (e) { throw why('Firestore answer unreadable'); }
  const e = j && j.fields && j.fields.enabled;
  return !(e && e.booleanValue === false);
}
export async function liveSwitchOn(env, deps) {
  if (deps.liveSwitch) return deps.liveSwitch();
  const now = (deps.now || Date.now)();
  if (killMemo.v !== null && now - killMemo.at < 5000) return killMemo.v;
  const f = deps.auditFetch || fetch;
  let v;
  try { v = await readSwitch(env, f); }
  catch (e1) {
    dropToken();   // the retry always mints a fresh token (a revoked / rotated / bad cached token is the cheap thing to rule out)
    try { v = await readSwitch(env, f); }
    catch (e2) {
      const reason = (e2 && e2.reason) || (e1 && e1.reason) || 'unknown error';
      const fresh = killMemo.v !== null && now - killMemo.at < LAST_GOOD_MS;
      try { console.warn('finatic: live switch read failed twice: ' + reason + (fresh ? ' (using the value read ' + Math.round((now - killMemo.at) / 1000) + ' s ago)' : ' (no recent value, refusing)')); } catch (e) {}
      if (fresh) return killMemo.v;
      throw why(reason);
    }
  }
  killMemo = { at: now, v };
  return v;
}

// ---- live bracket groups (stop loss + take profit, Owner order 2026-11-17) ----------------------------------------------------
// brokerBrackets/{account_CONTRACT}: the server's own record of which broker order ids are the entry, the stop loss and the take
// profit of one bracket. Server-written only (no client rule: the catch-all denies). order.js only ever modifies / cancels ids
// that are recorded here, so a client can't pass arbitrary ids to the OCO logic. Fields are flat strings / numbers.
const unval = (v) => (!v ? null : 'stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue : null);
const BR = DOCS + 'brokerBrackets/';
async function fsCall(env, deps, method, url, body) {
  const f = deps.auditFetch || fetch;
  const go = async (at) => f(url, { method, headers: { authorization: 'Bearer ' + at, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  let at = await accessToken(env, f);
  let r = await go(at);
  if (r.status === 401) { dropToken(); at = await accessToken(env, f); r = await go(at); }
  return r;
}
// -> group object | null (none). Throws when it can't be read.
export async function getBracket(env, deps, id) {
  if (deps.brackets) return deps.brackets.get(id) || null;
  const r = await fsCall(env, deps, 'GET', BR + encodeURIComponent(id));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('bracket read');
  const j = await r.json(); const out = {};
  for (const [k, v] of Object.entries((j && j.fields) || {})) out[k] = unval(v);
  return out;
}
// whole-document write (a group is small; last writer wins inside the per-account lock in order.js). Throws on failure.
export async function putBracket(env, deps, id, g) {
  const doc = { ...g, updatedAt: new Date().toISOString() };
  if (deps.brackets) { deps.brackets.set(id, doc); return; }
  const r = await fsCall(env, deps, 'PATCH', BR + encodeURIComponent(id), { fields: fields(doc) });
  if (!r.ok) throw new Error('bracket write');
}
export async function delBracket(env, deps, id) {
  if (deps.brackets) { deps.brackets.delete(id); return; }
  const r = await fsCall(env, deps, 'DELETE', BR + encodeURIComponent(id));
  if (!r.ok && r.status !== 404) throw new Error('bracket delete');
}
// one row in brokerOrderAudit for every bracket decision (place child, OCO cancel, alarm), never blocks the caller
export async function logBracket(env, deps, entry) {
  try { const a = await openAudit(env, deps, { ...entry, src: 'chart-bracket' }); await a.finish({ result: entry.result || 'logged' }); } catch (e) {}
}
