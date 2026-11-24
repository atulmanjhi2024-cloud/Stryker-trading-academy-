// LIVEFIX browser test (Owner bug 24 Nov 2026: the Owner, an admin, saw "10 min delayed · CME" and the "Order book 10 min delayed · live
// book is a paid data feed · Get live data" popup on MNQ1! while the hub was live). The page's /ts-live socket is wired to a REAL TSHub
// (workers/book-recorder/src/ts-hub.js) with the REAL access gate (src/ts-access.js tsTierWhy + src/rt-auth.js), real RS256 ID tokens
// from a throwaway key and a fake Google / Firestore; /api/chart/rt is the REAL Pages Function. The page's Firebase user hands out short-lived
// tokens, so the token expires mid-session, then Firestore goes to 429 (quota) like on 24 Nov.
// Checks: admin keeps the live book through token expiry and the quota outage (no socket close, no 4003, no delayed label, no popup,
// the hub got the refreshed token over {op:'auth'}); a FREE member is still on the 10-minute book with "Get live data". Shots 1440 + 390.
//   node tools/tests/chart-dev-server.mjs 8031 &
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/livefix-browser.mjs <shotsDir>
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { TSHub } from '../../workers/book-recorder/src/ts-hub.js';
import { tsTierWhy } from '../../workers/book-recorder/src/ts-access.js';
import * as RT from '../../functions/api/chart/_rt.js';
import * as RTW from '../../workers/book-recorder/src/rt-auth.js';
import { onRequestGet as rtGet } from '../../functions/api/chart/rt.js';
const require = createRequire(import.meta.url);
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp/livefix';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };

// ---- real tokens + fake Google / Firestore
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'k1', alg: 'RS256', use: 'sig' });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const mint = (uid, life) => { const now = Math.floor(Date.now() / 1000); const h = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' }), p = b64({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: uid, iat: now - 1, exp: now + life }); return h + '.' + p + '.' + createSign('RSA-SHA256').update(h + '.' + p).sign(privateKey).toString('base64url'); };
let fsState = 'up', fsReads = 0;
const realFetch = globalThis.fetch;
const fake = async (url, init) => {
  const u = String(url && url.url ? url.url : url);
  if (/securetoken@system/.test(u)) return Response.json({ keys: [jwk] });
  if (!/firestore\.googleapis\.com/.test(u)) return realFetch(url, init);
  fsReads++;
  if (fsState === 'quota') return new Response(JSON.stringify({ error: { code: 429, message: 'Quota exceeded.', status: 'RESOURCE_EXHAUSTED' } }), { status: 429 });
  if (/admins\/u-admin/.test(u)) return Response.json({ name: 'x' });
  if (/admins\//.test(u)) return new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED' } }), { status: 403 });
  if (/plans/.test(u)) return Response.json({ documents: [{ name: 'p/pro', fields: { rank: { integerValue: '1' } } }] });
  if (/students\/u-free/.test(u)) return Response.json({ fields: { plan: { stringValue: 'Free' } } });
  return new Response('{}', { status: 404 });
};
globalThis.fetch = fake;   // the real /api/chart/rt + rt-auth use the global fetch
const ENV = { TS_ACCESS: 'pro' };

// ---- a real hub with a fake upstream that streams a book for NQ + MNQ
const ups = [];
class UpWS { constructor() { this.l = {}; ups.push(this); setTimeout(() => this.emit('open', {}), 5); } addEventListener(e, f) { (this.l[e] = this.l[e] || []).push(f); } emit(e, ev) { for (const f of this.l[e] || []) f(ev); } send() {} close() { this.emit('close', { code: 1000 }); } }
const bookOf = (sym, mid) => { const bids = [], asks = []; for (let i = 0; i < 200; i++) { bids.push([mid - 0.25 - i * 0.25, 5 + (i % 7)]); asks.push([mid + 0.25 + i * 0.25, 4 + (i % 5)]); } return { type: 'book', symbol: sym, bids, asks, imbalance: 0.2, ts: Date.now() }; };
let hub;
function newHub() {
  if (hub) hub.shutdown();
  hub = new TSHub({ putMin() {}, prune() {}, range() { return []; } }, 'SECRETKEY', { WebSocket: UpWS, RECORD: false, RECHECK_MS: 3000, AUTH_GRACE_MS: 60000, AUTH_MIN_MS: 1000, tierOf: (env, t) => tsTierWhy(env, t, { fetchImpl: fake }) });
  return hub;
}
const feed = setInterval(() => { for (const u of ups) { try { const mid = 21000 + Math.round(Math.sin(Date.now() / 7000) * 8) * 0.25; for (const s of ['NQ', 'MNQ']) u.emit('message', { data: JSON.stringify(bookOf(s, mid)) }); u.emit('message', { data: JSON.stringify({ type: 'tick', symbol: 'MNQ', price: mid, size: 1, side: 'buy', ts: Date.now() }) }); } catch (e) {} } }, 250);

async function run(b, { uid, w, h, theme, life }) {
  newHub(); RT._resetForTests(); RTW._resetForTests(); fsState = 'up';
  const tag = uid + '-' + w + '-' + theme, mobile = w < 700;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(stub);
  await ctx.exposeBinding('__mint', (src, force) => mint(uid, life));
  await ctx.addInitScript(({ uid, theme }) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', theme === 'light' ? 'day' : 'night'); localStorage.setItem('theme', theme); } catch (e) {}
    window.__STK_BOOK_RECORDER = 'http://127.0.0.1:9';
    let cur = null;   // Firebase: getIdToken() = the cached token (even expired, like a throttled tab), getIdToken(true) = a fresh one
    const user = { uid, getIdTokenResult: () => Promise.resolve({ claims: {} }), getIdToken: async (force) => { if (force || !cur) cur = await window.__mint(!!force); window.__tokN = (window.__tokN || 0) + 1; return cur; } };
    firebase.apps = [{}];
    const a = firebase.auth(); a.currentUser = user; a.onIdTokenChanged = (cb) => { setTimeout(() => cb(user), 20); return () => {}; };
  }, { uid, theme });
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  await ctx.route('**/api/chart/rt', async (r) => { const res = await rtGet({ request: new Request('https://x/api/chart/rt', { headers: r.request().headers() }) }); r.fulfill({ status: res.status, body: await res.text(), headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }); });
  await ctx.route(/127\.0\.0\.1:9\/(ts-aux|ts-book-history|ts-trades|te-|sk-)/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"imb":[],"fp":[],"trades":[],"delta":[]}' }));
  await ctx.route(/\/api\/gex\//, (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"test"}' }));
  const sockets = { opened: 0, closedByHub: [], refused: 0, auth: 0 };
  // the Worker in front of the hub (src/index.js /ts-live): the same gate, then the hub
  await ctx.routeWebSocket(/\/ts-live/, async (ws) => {
    const tok = new URL(ws.url()).searchParams.get('__tok') || '';
    const a = await tsTierWhy(ENV, tok, { fetchImpl: fake });
    const tier = a.tier || (a.why === 'outage' ? hub.vouched(String(RTW.tokClaims(tok).sub || '')) : null);
    if (!tier) { sockets.refused++; if (process.env.DBG) console.log('refused', uid, a, ws.url().slice(0, 120)); ws.close({ code: 1006 }).catch(() => {}); return; }
    sockets.opened++;
    const u = new URL(ws.url());
    const sock = { send: (s) => { try { ws.send(s); } catch (e) {} }, close: (c, r) => { sockets.closedByHub.push(c); try { ws.close({ code: c, reason: r }); } catch (e) {} } };
    const hnd = hub.attach(sock, u.searchParams.get('symbol'), u.searchParams.get('levels'), tier, { tok, env: ENV, exp: RTW.tokClaims(tok).exp || 0, uid: String(RTW.tokClaims(tok).sub || '') });
    if (!hnd) return;
    ws.onMessage((m) => { if (typeof m === 'string') { (sockets.msgs = sockets.msgs || []).push(m.slice(0, 30)); if (/"op":"auth"/.test(m)) sockets.auth++; hnd.onMessage(m); } });
    ws.onClose(() => hnd.close());
  });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  // Playwright's routed socket cannot read the subprotocol: copy the tz-auth token into a test-only query param the fake Worker reads.
  // Installed after load, on top of Playwright's own WebSocket patch (an init script would sit under it and never run).
  await p.evaluate(() => {
    const W0 = window.WebSocket;
    window.WebSocket = function (url, proto) { if (/\/ts-live/.test(String(url)) && Array.isArray(proto) && proto[0] === 'tz-auth') url = String(url) + (String(url).includes('?') ? '&' : '?') + '__tok=' + encodeURIComponent(proto[1] || ''); return proto ? new W0(url, proto) : new W0(url); };
    window.WebSocket.prototype = W0.prototype; Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  });
  await p.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 60000 });
  await p.evaluate(() => { window.STRYKER_VELA.active.setSymbol('futures:MNQ1!'); window.STRYKER_VELA.active.setTimeframe('1'); });
  await sleep(2500);
  await p.evaluate(() => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); for (const k of ['stk_depth_heat', 'stk_l2f_fp']) { try { c.chart.addNativeIndicator(k, { inputs: {} }); } catch (e) {} } });
  const state = () => p.evaluate(() => {
    const txt = document.body.innerText, d = window.tzL2Diag ? window.tzL2Diag('MNQ1!') : {};
    const pop = [...document.querySelectorAll('.stkfeed-unlock, .stkl2-live')].filter((x) => x.offsetParent && /get live data/i.test(x.textContent || ''));
    return { delayedFn: !!(window.STRYKER_L2_DELAYED && window.STRYKER_L2_DELAYED()), delayedText: /10 min delayed/i.test(txt), paidPopup: /live book is a paid data feed/i.test(txt), getLive: pop.length, bookTier: d.bookTier, l2Proven: d.l2Proven, sock: d.sockets && d.sockets.MNQ, rt: window.tzRtState && window.tzRtState(), lastClose: d.lastClose };
  });
  await sleep(6000);
  const s1 = await state();
  if (uid === 'u-admin') {
    check(s1.bookTier === true && s1.l2Proven === true, tag + ': admin gets the live book from the hub', s1);
    check(!s1.delayedFn && !s1.paidPopup && !s1.getLive, tag + ': admin: no delayed book, no paid-feed popup, no Get live data', s1);
    // token expires mid-session (life s), then the hub re-checks: it must ask for a fresh token, not revoke
    await sleep(Math.max(0, life * 1000 - 6000) + 7000);
    const st1 = hub.stats();
    if (process.env.DBG) console.log('DBG', JSON.stringify({ keptExpired: st1.keptExpired, keptOutage: st1.keptOutage, keptInvalid: st1.keptInvalid, authOk: st1.authOk, authBad: st1.authBad, closedToken: st1.closedToken, tokN: await p.evaluate(() => window.__tokN), rt: await p.evaluate(() => window.tzRtState()), msgs: sockets.msgs }));
    check(!sockets.closedByHub.includes(4003), tag + ': hub never closed the admin with 4003 after the token expired', sockets);
    check(st1.revoked === 0, tag + ': hub revoked 0', st1);
    check(st1.authOk >= 1 && sockets.auth >= 1, tag + ': refreshed ID token reached the hub over {op:auth} (authOk ' + st1.authOk + ', sent ' + sockets.auth + ')', st1);
    const s2 = await state();
    check(s2.bookTier === true && s2.l2Proven === true && !s2.delayedFn && !s2.paidPopup && !s2.getLive, tag + ': after token expiry: still live, no popup', s2);
    // Firestore quota outage (24 Nov): hub re-checks + the page re-asks /api/chart/rt -> nothing changes for the admin
    fsState = 'quota'; RT._resetForTests(true); RTW._resetForTests(true);
    await p.evaluate(() => import('/assets/rt-access.js?v=1244').then((m) => m.rtRecheck(true))).catch(() => {});
    await sleep(8000);
    const st2 = hub.stats(), s3 = await state();
    check(st2.revoked === 0 && st2.keptOutage >= 1, tag + ': Firestore 429: hub kept the admin (keptOutage ' + st2.keptOutage + ', revoked ' + st2.revoked + ')', st2);
    check(s3.bookTier === true && !s3.delayedFn && !s3.paidPopup && !s3.getLive && s3.rt && s3.rt.admin === true, tag + ': Firestore 429: page still live, still admin, no popup', s3);
    check(sockets.opened === 1, tag + ': one socket the whole session (no reconnect)', sockets);
    fsState = 'up';
  } else {
    await sleep(4000);
    const s2 = await state();
    check(sockets.refused >= 1 && sockets.opened === 0, tag + ': free member: live book socket refused by the gate', sockets);
    check(s2.delayedFn === true, tag + ': free member: order book 10 min delayed (STRYKER_L2_DELAYED)', s2);
    check(s2.delayedText && s2.getLive >= 1, tag + ': free member: delayed label + Get live data shown', s2);
  }
  await p.screenshot({ path: OUT + '/livefix-' + tag + '.png' });
  check(!errors.length, tag + ': no page errors' + (errors.length ? ' ' + errors.slice(0, 2).join(' | ') : ''));
  await ctx.close();
}

const b = await launch();
try {
  for (const c of (process.env.ONE ? [{ uid: 'u-admin', w: 1440, h: 900, theme: 'dark', life: 20 }] : [{ uid: 'u-admin', w: 1440, h: 900, theme: 'dark', life: 20 }, { uid: 'u-admin', w: 390, h: 844, theme: 'light', life: 20 }, { uid: 'u-free', w: 1440, h: 900, theme: 'dark', life: 3600 }, { uid: 'u-free', w: 390, h: 844, theme: 'dark', life: 3600 }])) await run(b, c);
} catch (e) { fail++; console.log('FAIL crashed: ' + (e && e.stack || e)); }
await b.close(); clearInterval(feed); if (hub) hub.shutdown();
console.log(fail ? 'FAILED ' + fail : 'ALL PASSED');
process.exit(fail ? 1 : 0);
