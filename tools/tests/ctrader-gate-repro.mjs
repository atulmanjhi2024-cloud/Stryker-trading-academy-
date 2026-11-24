// Owner bug 24 Nov ("BUY 0.01 GBPCHF refused: Live cTrader trading is for admins and beta testers only") — reproduction harness.
// Runs the REAL endpoint (functions/connect/ctrader/trade.js + _trade.js + _relay.js + the real Firestore readers in _audit.js /
// _owner.js / beta/_lib.js) against a MOCKED Google token endpoint, MOCKED Firestore and MOCKED cTrader sockets. It counts every fetch
// a socket's request makes (= a Cloudflare subrequest) and throws "Too many subrequests." past the per-request cap, like the platform.
// The fake clock is driven in 5 s ticks (the endpoint's own timer). With reopen:true it plays the browser: after a 4001 'renew' close
// it opens a NEW socket (fresh request = fresh budget). No network; nothing reaches cTrader or Firestore.
// Used by tools/tests/ctrader-gate.test.mjs. Run alone for a side-by-side print: node tools/tests/ctrader-gate-repro.mjs
import { webcrypto as C } from 'node:crypto';
import { handle } from '../../functions/connect/ctrader/trade.js';
import { _resetTok } from '../../functions/api/beta/_lib.js';
import { _resetToken, _resetKill } from '../../functions/connect/finatic/_audit.js';
import { _resetOwner } from '../../functions/connect/finatic/_owner.js';
if (!globalThis.crypto) globalThis.crypto = C;
const f = (o) => JSON.stringify(o);
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };
const ACC = 77; let ipN = 0, kp = null;

// opts: limit (subrequests per socket request), minutes, orderEverySec, adminFailAt (the Nth admins/{uid} read answers 503),
// adminDown (every admins/{uid} read 503), notAdmin (no admins doc and not on the beta list), reopen, env (extra Pages env)
export async function scenario({ limit = 50, minutes = 30, orderEverySec = 300, adminFailAt = 0, adminDown = false, notAdmin = false, reopen = false, env: extra = {} } = {}) {
  _resetTok(); _resetToken(); _resetKill(); _resetOwner();
  kp = kp || await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
  const env = { CTRADER_CLIENT_ID: 'CID', CTRADER_CLIENT_SECRET: 'SECRET-xyz-123', CTRADER_TRADE_LIVE: '1', FIREBASE_SA_KEY: JSON.stringify({ client_email: 'sa@test', private_key: '-----BEGIN PRIVATE KEY-----\n' + der + '\n-----END PRIVATE KEY-----' }), ...extra };
  const uid = 'owner1';
  let clock = 1.8e12; const realNow = Date.now; Date.now = () => clock;
  let adminReads = 0, total = 0;
  const docs = new Map([['liveConsent/' + uid, { uid: { stringValue: uid }, version: { stringValue: '2026-11-21' } }]]);
  if (!notAdmin) docs.set('admins/' + uid, { on: { booleanValue: true } });
  const fetchFor = (sock) => async (url, init = {}) => {
    total++; if (++sock.used > limit) throw new Error('Too many subrequests.');
    url = String(url); const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
    if (url.startsWith('https://oauth2.googleapis.com/token')) return J({ access_token: 'at', expires_in: 3600 });
    const path = decodeURIComponent(url.split('/documents/')[1] || '').split('?')[0];
    const m = (init.method || 'GET').toUpperCase();
    if (path.startsWith('admins/') && (adminDown || ++adminReads === adminFailAt)) return J({}, 503);
    if (m === 'GET') return docs.has(path) ? J({ name: 'x/' + path, fields: docs.get(path) }) : J({}, 404);
    if (m === 'POST') { const id = new URL(url).searchParams.get('documentId'); const p = path + '/' + id; if (docs.has(p)) return J({}, 409); docs.set(p, (JSON.parse(init.body || '{}').fields) || {}); return J({ name: p }); }
    if (m === 'DELETE') { docs.delete(path); return J({}); }
    return J({});
  };
  const mkSock = () => { const L = {}, sent = []; return { L, sent, accept() {}, send(x) { sent.push(JSON.parse(x)); }, close(code, why) { this.closedWith = this.closedWith || (code + ' ' + why); }, addEventListener(k, fn) { L[k] = fn; } }; };
  const tok = 'h.' + Buffer.from(JSON.stringify({ email: 'owner@example.com', email_verified: true, exp: Math.floor(clock / 1000) + 7200 })).toString('base64url') + '.s';
  const out = { events: [], sockets: [], total: () => total };
  // open one socket the way the browser does; returns the live socket record or null
  const connect = async () => {
    const S = { used: 0, up: mkSock(), pair: [mkSock(), mkSock()], tick: null };
    const req = new Request('https://tradezoro.com/connect/ctrader/trade?account=' + ACC + '&env=live', { headers: { 'cf-connecting-ip': '10.0.0.' + (++ipN), upgrade: 'websocket', origin: 'https://tradezoro.com', 'sec-websocket-protocol': 'tz-auth, ' + tok } });
    const ff = fetchFor(S);
    const deps = { verify: async () => uid, connect: async () => S.up, pair: () => S.pair, tickMs: 1e9, betaFetch: ff, auditFetch: ff, defer: (p) => p.catch(() => {}) };
    const realSI = globalThis.setInterval; globalThis.setInterval = (fn, ms) => { if (ms === 1e9) { S.tick = fn; return 0; } return realSI(fn, ms); };
    let res; try { res = await handle(req, env, deps); } finally { globalThis.setInterval = realSI; }
    S.status = res.status; out.sockets.push(S);
    if (res.status !== 101) { S.body = await res.json(); return null; }
    S.relay = res.relay;
    S.toServer = (o) => S.pair[1].L.message({ data: f(o) }); S.fromUp = (o) => S.up.L.message({ data: f(o) });
    S.fromUp({ payloadType: 2101 }); S.toServer({ clientMsgId: 'a1', payloadType: 2149, payload: { accessToken: 'ACCESSTOKEN1' } });
    S.fromUp({ clientMsgId: 'a1', payloadType: 2150, payload: { permissionScope: 1, ctidTraderAccount: [{ ctidTraderAccountId: ACC, isLive: true }] } });
    S.toServer({ clientMsgId: 'a2', payloadType: 2102, payload: { ctidTraderAccountId: ACC, accessToken: 'ACCESSTOKEN1' } });
    S.fromUp({ clientMsgId: 'a2', payloadType: 2103, payload: { ctidTraderAccountId: ACC } });
    S.fromUp({ clientMsgId: 'a3', payloadType: 2117, payload: { ctidTraderAccountId: ACC, symbol: [{ symbolId: 1, minVolume: 100000, maxVolume: 1e10, stepVolume: 100000, lotSize: 10000000 }] } });
    await flush();
    return S;
  };
  let S = await connect(), k = 0;
  out.connect = out.sockets[0].status; out.connectBody = out.sockets[0].body;
  for (let s = 5; S && s <= minutes * 60; s += 5) {
    clock += 5000; if (S.tick) S.tick(); await flush();
    if (S.relay.closed) {
      S.end = S.pair[1].closedWith;
      if (!(reopen && /^4001/.test(S.end))) break;
      S = await connect(); if (!S) break;
    }
    S.toServer({ payloadType: 51, payload: {} });   // the browser's heartbeat
    if (s % orderEverySec === 0) {
      const key = 'k-order-' + String(++k).padStart(10, '0');
      S.toServer({ clientMsgId: key, payloadType: 2106, payload: { ctidTraderAccountId: ACC, symbolId: 1, orderType: 1, tradeSide: 1, volume: 100000 } });
      await flush();
      const ref = S.pair[1].sent.find((x) => x.relay === 'refused' && x.clientMsgId === key);
      const sent = S.up.sent.filter((x) => x.payloadType === 2106 && x.clientMsgId === key).length;
      out.events.push({ min: +(s / 60).toFixed(2), key, sent, refused: ref ? ref.code : '', error: ref ? ref.error : '', socket: out.sockets.length, used: S.used });
      if (sent) { S.fromUp({ clientMsgId: key, payloadType: 2126, payload: { ctidTraderAccountId: ACC, executionType: 3, order: { orderId: 1000 + k } } }); await flush(); }
    }
  }
  if (S && S.relay && !S.end) S.end = S.relay.closed ? S.pair[1].closedWith : '';
  out.last = S; out.closed = out.sockets.at(-1).end || '';
  out.maxUsed = Math.max(...out.sockets.map((x) => x.used));
  out.done = () => { Date.now = realNow; for (const x of out.sockets) if (x.relay && !x.relay.closed) x.relay.onClientClose(); };
  out.summary = () => { const by = {}; for (const e of out.events) { const kk = e.sent ? 'sent' : 'refused ' + e.refused; by[kk] = (by[kk] || 0) + 1; } return by; };
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('ctrader-gate-repro.mjs')) {
  const S = [
    ['A Workers Free cap 50, an order every 30 s for 10 min', { limit: 50, minutes: 10, orderEverySec: 30, reopen: true }],
    ['B no cap; ONE Firestore 503 on the admins/{uid} read at the 2nd order', { limit: 1e9, minutes: 3, orderEverySec: 60, adminFailAt: 3, reopen: true }],
    ['C no cap; one order every 10 min for 70 min (the ID token from connect is over 1 h old at the end)', { limit: 1e9, minutes: 70, orderEverySec: 600, reopen: true }]
  ];
  for (const [name, o] of S) {
    const r = await scenario(o);
    console.log('== ' + name + '\n   connect ' + r.connect + ', sockets ' + r.sockets.length + ' (ends: ' + r.sockets.map((x) => x.end || 'open').join(', ') + '), max subrequests on one socket ' + r.maxUsed + ', orders ' + JSON.stringify(r.summary()));
    r.done();
  }
  process.exit(0);
}
