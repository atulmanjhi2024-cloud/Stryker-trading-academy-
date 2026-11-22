// Beta tester program (email list): match rules, admin-only edit, cap 30, removal, Pro-by-beta, channel pick, report rate limit + payload. Run: node tools/tests/beta.test.mjs
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import * as L from '../../functions/api/beta/_lib.js';
import { BETA, pickChannel } from '../../assets/beta-config.mjs';
import * as RT from '../../functions/api/chart/_rt.js';
import { handle as status } from '../../functions/api/beta/status.js';
import { handle as report, pngBytes, buildPayload } from '../../functions/api/beta/report.js';
import { handle as admin } from '../../functions/api/beta/admin.js';
import { handle as appver } from '../../functions/api/beta/app-version.js';

const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const pem = '-----BEGIN PRIVATE KEY-----\n' + Buffer.from(await crypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64') + '\n-----END PRIVATE KEY-----';
const b64u = (b) => Buffer.from(b).toString('base64url');
async function idToken(uid, email, verified = true) {
  const now = Math.floor(Date.now() / 1000), h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1' })), p = b64u(JSON.stringify({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: uid, iat: now - 5, exp: now + 3000, firebase: { sign_in_provider: 'password' }, ...(email ? { email, email_verified: verified } : {}) }));
  return h + '.' + p + '.' + b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(h + '.' + p)));
}
// ---- fake Firestore (REST shape) + fake Discord ----
const docs = new Map();   // 'students/u1' -> {fields}
const put = (path, o) => docs.set(path, Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? { arrayValue: { values: v.map((x) => ({ stringValue: x })) } } : typeof v === 'boolean' ? { booleanValue: v } : v instanceof Date ? { timestampValue: v.toISOString() } : { stringValue: String(v) }])));
let discordMode = 'ok', threads = [];
const FSB = 'https://firestore.googleapis.com/v1/projects/strykertrades-e0cd8/databases/(default)/documents';
const doc = (path) => ({ name: 'projects/x/databases/(default)/documents/' + path, fields: docs.get(path) });
async function fetchMock(url, init = {}) {
  url = String(url); const m = (init.method || 'GET').toUpperCase();
  const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
  if (url.includes('securetoken@system')) return J({ keys: [jwk] });
  if (url === 'https://oauth2.googleapis.com/token') return J({ access_token: 'sa-tok', expires_in: 3000 });
  if (url.includes('/channels/' + BETA.forumChannelId + '/threads')) { if (discordMode === 'threadfail') return J({}, 500); threads.push(init); return J({ id: '999' + threads.length }); }
  if (url.endsWith('/channels/' + BETA.forumChannelId)) return J({ available_tags: [{ id: '55', name: 'Beta' }] });
  if (url.includes('/documents/plans')) return J({ documents: [{ name: 'x/plans/pro', fields: { name: { stringValue: 'Pro' }, rank: { integerValue: '1' } } }] });
  if (url.startsWith(FSB)) {
    const path = decodeURIComponent(url.slice(FSB.length).replace(/^\//, '').split('?')[0]);
    if (path === ':runQuery') {
      const q = JSON.parse(init.body).structuredQuery, c = q.from[0].collectionId, f = q.where.fieldFilter, fp = f.field.fieldPath, want = f.value;
      const out = [...docs.keys()].filter((k) => k.startsWith(c + '/')).filter((k) => { const v = docs.get(k)[fp]; return v && (f.op === 'EQUAL' ? JSON.stringify(v) === JSON.stringify(want) : f.op === 'GREATER_THAN' ? !!(v.stringValue !== undefined && v.stringValue > want.stringValue) : false); }).slice(0, q.limit).map((k) => ({ document: doc(k) }));
      return J(out);
    }
    if (m === 'GET' && !url.includes('?pageSize') ) { return docs.has(path) ? J(doc(path)) : J({}, 404); }
    if (m === 'GET') { const c = path; return J({ documents: [...docs.keys()].filter((k) => k.startsWith(c + '/')).map(doc) }); }
    if (m === 'DELETE') { docs.delete(path); return J({}); }
    if (m === 'POST') { const id = new URL(url).searchParams.get('documentId'), p = path + '/' + id; if (docs.has(p)) return J({}, 409); docs.set(p, JSON.parse(init.body).fields); return J(doc(p)); }
    if (m === 'PATCH') {
      const u = new URL(url), exists = u.searchParams.get('currentDocument.exists') === 'true';
      if (exists && !docs.has(path)) return J({}, 404);
      const cur = docs.get(path) || {}, masks = u.searchParams.getAll('updateMask.fieldPaths'), body = JSON.parse(init.body).fields;
      for (const k of masks) { if (k in body) cur[k] = body[k]; else delete cur[k]; }
      docs.set(path, cur); writes.push({ path, keys: masks }); return J(doc(path));
    }
  }
  throw new Error('unmocked ' + m + ' ' + url);
}
globalThis.fetch = fetchMock;
const writes = [];
const env = () => ({ DISCORD_BOT_TOKEN: 'bot', FIREBASE_SA_KEY: JSON.stringify({ client_email: 'sa@x', private_key: pem }), DEV: '0' });
const req = async (path, { uid, email, method = 'POST', body, headers = {} } = {}) => new Request('https://tradezoro.com' + path, { method, headers: { origin: 'https://tradezoro.com', 'content-type': 'application/json', ...(uid ? { authorization: 'Bearer ' + await idToken(uid, email || uid + '@example.com') } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const reset = () => { docs.clear(); writes.length = 0; threads = []; discordMode = 'ok'; L._memClear(); L._resetTok(); RT._resetForTests(); };

// ---- 1. email match: case-insensitive, verified only, admin, removal ----
{
  reset(); const e = env(); put('settings/betaTesters', { emails: ['tester@example.com', 'other@example.com'] }); put('students/u1', { name: 'U1', plan: 'Starter', email: 'tester@example.com' }); put('admins/ad', {});
  const st = async (uid, email, verified = true) => (await status(new Request('https://tradezoro.com/api/beta/status', { method: 'POST', headers: { origin: 'https://tradezoro.com', authorization: 'Bearer ' + await idToken(uid, email, verified) } }), e)).json();
  assert.equal((await st('u1', 'tester@example.com')).beta, true, 'listed email');
  assert.equal(docs.get('students/u1').beta.booleanValue, true, 'mirror set'); assert.equal(docs.get('students/u1').plan.stringValue, 'Starter', 'plan untouched');
  assert.equal((await st('u1', 'Tester@Example.COM')).beta, true, 'match ignores case');
  assert.equal((await st('u1', '  tester@example.com ')).beta, true, 'and spaces');
  assert.equal((await st('u1', 'tester@example.com', false)).beta, false, 'UNVERIFIED email is never accepted');
  assert.equal((await st('u1', undefined)).beta, false, 'no email claim = no');
  assert.equal((await st('u2', 'stranger@example.com')).beta, false, 'not listed');
  assert.equal((await st('ad', 'nobody@example.com')).beta, true, 'admins are always beta'); assert.equal((await st('ad', 'nobody@example.com')).admin, true);
  assert.equal((await status(new Request('https://tradezoro.com/api/beta/status', { method: 'POST', headers: { origin: 'https://tradezoro.com' } }), e)).status, 401);
  // list unreachable = closed
  L._resetTok(); const bad = (await L.isBetaToken({ ...e, FIREBASE_SA_KEY: '' }, new Request('https://tradezoro.com/x', { headers: { authorization: 'Bearer ' + await idToken('u1', 'tester@example.com') } })));
  assert.equal(bad.beta, false, 'Firestore unreachable = not beta');
  assert.ok(writes.filter((w) => w.path.startsWith('students/')).every((w) => w.keys.every((k) => /^beta/.test(k))), 'only beta fields written to students');
  // removal takes effect at the next check
  put('settings/betaTesters', { emails: ['tester@example.com'] }); assert.equal((await st('u1', 'tester@example.com')).beta, true); put('settings/betaTesters', { emails: ['other@example.com'] });
  assert.equal((await st('u1', 'tester@example.com')).beta, false, 'removed from list = off'); assert.equal(docs.get('students/u1').beta.booleanValue, false, 'mirror cleared');
}

// ---- 2. admin edit: admin-only, normalised, cap 30, removal ----
{
  reset(); const e = env(); put('admins/ad', {}); put('students/m1', { email: 'a@example.com', name: 'A' }); put('students/ad', { email: 'boss@example.com' });
  const ed = async (uid, body, headers = {}) => admin(await req('/api/beta/admin', { uid, body, headers }), e);
  assert.equal((await ed(null, { action: 'add', email: 'a@example.com' })).status, 401, 'needs sign-in');
  assert.equal((await ed('m1', { action: 'add', email: 'a@example.com' })).status, 403, 'a member cannot edit the list'); assert.ok(!docs.has('settings/betaTesters'));
  assert.equal((await ed('ad', { action: 'add', email: 'a@example.com' }, { origin: 'https://evil.example' })).status, 403, 'origin check');
  assert.equal((await ed('ad', { action: 'add', email: 'not-an-email' })).status, 400); assert.equal((await ed('ad', { action: 'nuke', email: 'a@example.com' })).status, 400);
  let j = await (await ed('ad', { action: 'add', email: '  A@Example.com ' })).json(); assert.deepEqual(j.emails, ['a@example.com'], 'lower-cased');
  assert.equal(docs.get('students/m1').beta.booleanValue, true, 'existing account gets the mirror at once');
  j = await (await ed('ad', { action: 'add', email: 'a@example.com' })).json(); assert.equal(j.emails.length, 1, 'no duplicates');
  for (let i = 2; i <= 30; i++) assert.equal((await ed('ad', { action: 'add', email: 't' + i + '@example.com' })).status, 200);
  assert.equal((await (await ed('ad', { action: 'add', email: 'x@example.com' })).json()).error.includes('full'), true, '31st refused'); assert.equal((await ed('ad', { action: 'add', email: 'x@example.com' })).status, 409);
  assert.equal(L.getList ? (await L.getList(L.fsClient(e))).length : 30, 30);
  j = await (await ed('ad', { action: 'remove', email: 'A@example.com' })).json(); assert.equal(j.emails.length, 29); assert.ok(!j.emails.includes('a@example.com'));
  assert.equal(docs.get('students/m1').beta.booleanValue, false, 'removal cuts beta (and Pro-by-beta) at once');
  assert.equal((await ed('ad', { action: 'add', email: 'x@example.com' })).status, 200, 'a freed seat can be reused');
  assert.ok(writes.filter((w) => w.path.startsWith('students/')).every((w) => w.keys.every((k) => /^beta/.test(k))), 'billing never written');
}

// ---- 6. Pro by beta, billing untouched ----
{
  const tok = await idToken('p1'); reset();
  put('students/p1', { plan: 'Starter', beta: true }); put('students/p2', { plan: 'Starter' }); put('students/p3', { plan: 'Starter', beta: false });
  assert.equal(await RT.isLiveDataToken(tok, { fetchImpl: fetchMock }), true, 'beta = Pro for the live order book');
  assert.equal(await RT.isLiveDataToken(await idToken('p2'), { fetchImpl: fetchMock }), false); assert.equal(await RT.isLiveDataToken(await idToken('p3'), { fetchImpl: fetchMock }), false);
  assert.equal(RT.isBetaDoc({ beta: { stringValue: 'true' } }), false, 'odd shapes = no');
  assert.equal(docs.get('students/p1').plan.stringValue, 'Starter', 'plan not changed'); assert.equal(writes.length, 0);
  const { readFileSync } = await import('node:fs');
  assert.equal(readFileSync(new URL('../../functions/api/chart/_rt.js', import.meta.url), 'utf8'), readFileSync(new URL('../../workers/book-recorder/src/rt-auth.js', import.meta.url), 'utf8'), 'rt-auth.js copies differ');
}

// ---- 7. beta channel ----
{
  const m = { android: { versionCode: 10, versionName: '2.1.0', url: '/a.apk', beta: { versionCode: 11, versionName: '2.2.0-beta', url: '/b.apk', notes: ['t'] } }, windows: { version: '2.0.0', url: '/w.exe', beta: null } };
  assert.equal(pickChannel(m, 'android', true).versionName, '2.2.0-beta'); assert.equal(pickChannel(m, 'android', true).channel, 'beta'); assert.equal(pickChannel(m, 'android', true).minVersionCode, undefined);
  assert.equal(pickChannel(m, 'android', false).versionName, '2.1.0'); assert.ok(!('beta' in pickChannel(m, 'android', false)), 'normal users never see the beta block');
  assert.equal(pickChannel(m, 'windows', true).channel, 'stable', 'no beta build = normal'); assert.equal(pickChannel(m, 'mac', true), null);
  reset(); const e = env(); put('settings/betaTesters', { emails: ['b1@example.com'] });
  const get = async (uid) => appver(new Request('https://tradezoro.com/api/beta/app-version?platform=android', { headers: uid ? { authorization: 'Bearer ' + await idToken(uid, uid + '@example.com') } : {} }), e, { manifest: async () => m });
  assert.equal((await (await get('b1')).json()).channel, 'beta'); assert.equal((await (await get('n1')).json()).channel, 'stable'); assert.equal((await (await get(null)).json()).channel, 'stable');
  assert.equal((await appver(new Request('https://tradezoro.com/api/beta/app-version?platform=ios'), e, { manifest: async () => m })).status, 400);
}

// ---- 8. bug report: access, payload, rate limit ----
{
  reset(); const e = env(); put('settings/betaTesters', { emails: ['b1@example.com'] }); put('students/b1', { name: 'Beta One' }); put('students/n1', { name: 'Nope' }); put('admins/ad', {}); put('students/ad', { name: 'Admin' });
  const PNG = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64');
  const send = async (uid, over = {}) => report(await req('/api/beta/report', { uid, email: uid + '@example.com', body: { title: 'Chart freezes', what: 'It froze when I @everyone `clicked` <@123>', url: 'https://tradezoro.com/charts?x=1', build: '1207', ua: 'UA', errors: ['TypeError: x'], screenshot: PNG, ...over } }), e);
  assert.equal((await send('n1')).status, 403, 'non-beta refused'); assert.equal((await report(await req('/api/beta/report', { body: {} }), e)).status, 401);
  assert.equal(threads.length, 0);
  const ok = await send('b1'); assert.equal(ok.status, 200); assert.equal(threads.length, 1);
  const form = threads[0].body; assert.ok(form instanceof FormData); const pj = JSON.parse(form.get('payload_json'));
  assert.deepEqual(pj.message.allowed_mentions, { parse: [] }); assert.deepEqual(pj.applied_tags, ['55'], 'Beta tag'); assert.match(pj.name, /^\[Beta\] Chart freezes/);
  assert.ok(pj.message.content.startsWith('```') && !pj.message.content.includes('@everyone') && !pj.message.content.slice(3, -3).includes('`'), 'code block, no mention, no backtick breakout');
  assert.match(pj.message.content, /Build: 1207/); assert.match(pj.message.content, /TypeError/); assert.equal(form.get('files[0]').type, 'image/png');
  assert.equal([...docs.keys()].filter((k) => k.startsWith('betaReports/')).length, 1, 'copy saved'); const rep = [...docs.entries()].find(([k]) => k.startsWith('betaReports/'))[1]; assert.ok(!JSON.stringify(rep).includes('base64'), 'no image in Firestore');
  assert.equal((await send('b1', { screenshot: 'data:image/png;base64,AAAA' })).status, 400, 'not a PNG'); assert.equal((await send('b1', { title: '' })).status, 400);
  assert.equal(pngBytes('data:image/jpeg;base64,AAAA'), null);
  assert.equal((await send('ad')).status, 200, 'admins can report');
  for (let i = 0; i < 8; i++) assert.equal((await send('b1')).status, 200);   // 1 + 1 (bad PNG not counted: refused first) ... total ok = 9 so far
  assert.equal((await send('b1')).status, 200, '10th ok'); assert.equal((await send('b1')).status, 429, '11th refused: 10/day'); assert.equal((await send('ad')).status, 200, 'limit is per user');
  discordMode = 'threadfail'; assert.equal((await send('ad')).status, 502);
  assert.ok(buildPayload({ title: 'x'.repeat(300), what: 'y', url: 'u', build: 'b', ua: 'a', errors: new Array(20).fill('e') }, { name: 'n' }).name.length <= 87);
}
console.log('beta.test.mjs: all passed');
