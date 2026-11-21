// Admin-only READ pass-through to Finatic for the journal's broker sync (beta). POST {op, ...}.
// Allow-list below is the whole surface: every op maps to a fixed GET path (plus the grant revoke used by "Disconnect").
// There is deliberately NO order create / modify / cancel path, and the client never supplies a path. Stores and logs nothing.
// op 'live' (chart live orders, 2026-11-15): positions + orders of one account in ONE session (two GETs), for the chart's live lines.
// SPEED (2026-11-16): the Finatic session is cached per isolate (_fin.js cachedSession, 2 min; a 401 renews it once), so the chart's
// 10 s poll keeps it warm for the order route, and 'live' reads positions + orders in parallel. 'revoke' always uses a fresh session
// and drops the cached one afterwards.
import { gate, readBody, fin, startSession, cachedSession, finSession, dropSession, pagesEntry, json, fail, needsConnect, methodNotAllowed, safe, listAll, UPSTREAM_MSG, UUID, ID } from './_fin.js';

const A = (id) => '/api/v1/accounts/' + encodeURIComponent(id);
export const OPS = {
  accounts: () => '/api/v1/accounts',
  grants: () => '/api/v1/account-grants',
  orders: (b) => A(b.accountId) + '/orders',
  transactions: (b) => A(b.accountId) + '/transactions',
  positions: (b) => A(b.accountId) + '/positions',
  balances: (b) => A(b.accountId) + '/balances',
};
const MAX_ORDERS_PER_CALL = 25;
export const LIVE_PAGE = { limit: 500, maxPages: 4 };   // one call while the account has under 500 orders

async function run(request, env, deps) {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  const g = await gate(request, env, deps, 'finatic-data');
  if (g instanceof Response) return g;
  const b = await readBody(request);
  if (!b || typeof b !== 'object') return fail(400, 'Bad request');
  const op = b.op;
  const isRead = Object.prototype.hasOwnProperty.call(OPS, op);
  if (!isRead && op !== 'fills' && op !== 'revoke' && op !== 'live') return fail(400, 'Not allowed');
  if (op !== 'accounts' && op !== 'grants' && op !== 'revoke' && !(typeof b.accountId === 'string' && UUID.test(b.accountId))) return fail(400, 'accountId missing');
  if (op === 'revoke' && !(typeof b.grantId === 'string' && UUID.test(b.grantId))) return fail(400, 'grantId missing');
  if (op === 'fills' && !(Array.isArray(b.orderIds) && b.orderIds.length >= 1 && b.orderIds.length <= MAX_ORDERS_PER_CALL && b.orderIds.every((x) => typeof x === 'string' && ID.test(x)))) return fail(400, 'orderIds missing');

  // Finatic user: the id the Connect portal created for this admin. Known id (kept by the admin's browser) or the session that just ran the portal.
  let finUser = typeof b.userId === 'string' && UUID.test(b.userId) ? b.userId : '';
  if (!finUser && typeof b.sessionId === 'string' && ID.test(b.sessionId)) {
    const u = await fin(env, deps, 'GET', '/api/v1/sessions/' + encodeURIComponent(b.sessionId) + '/user');
    if (!u.ok && (u.status === 0 || u.status >= 500 || u.bad)) return fail(502, UPSTREAM_MSG, 'upstream');
    finUser = (u.ok && u.data && (u.data.userId || u.data.user_id)) || '';   // 4xx = that session has no user (yet)
    if (finUser && !(typeof finUser === 'string' && UUID.test(finUser))) finUser = '';
  }
  if (!finUser) return needsConnect();
  let s = op === 'revoke' ? await startSession(env, deps, finUser) : await cachedSession(env, deps, finUser);
  if (s.failed) return s.staleUser ? needsConnect() : fail(502, UPSTREAM_MSG, 'upstream');   // stale id (e.g. sandbox user on live): connect again
  if (!s.authenticated) return needsConnect();
  let renewFail = false;
  const call = async (method, path, opts) => { const x = await finSession(env, deps, finUser, s, method, path, opts); if (x.s !== s) { if (x.s.failed || !x.s.authenticated) renewFail = true; else s = x.s; } return x.r; };
  const page = { limit: Math.min(Math.max(parseInt(b.limit, 10) || 100, 1), 1000), offset: Math.max(parseInt(b.offset, 10) || 0, 0) };

  if (op === 'revoke') {
    const r = await call('POST', '/api/v1/account-grants/' + encodeURIComponent(b.grantId) + '/revoke');
    dropSession(env, finUser);
    return r.ok ? json({ ok: true, userId: finUser }) : fail(502, 'Could not disconnect');
  }
  if (op === 'live') {
    // every page (no documented sort order): the newest orders may sit past the first page (21 Nov)
    const [p, o] = await Promise.all([listAll(call, OPS.positions(b), LIVE_PAGE), listAll(call, OPS.orders(b), LIVE_PAGE)]);
    if (renewFail) return needsConnect();
    if (!p.ok || !o.ok) return fail(502, 'Broker data is unavailable right now', 'upstream');
    return json({ data: { positions: p.data, orders: o.data, truncated: p.truncated || o.truncated }, userId: finUser });
  }
  if (op === 'fills') {
    const out = [];
    for (const oid of b.orderIds) {
      const r = await call('GET', A(b.accountId) + '/orders/' + encodeURIComponent(oid) + '/fills');
      if (!r.ok) return fail(502, 'Broker data is unavailable right now', 'upstream');
      (Array.isArray(r.data) ? r.data : []).forEach((f) => out.push(f));
    }
    return json({ data: out, userId: finUser });
  }
  if (op === 'balances') {   // all snapshots (21 Nov): no documented sort order, so page 1 alone may not hold the newest one
    const l = await listAll(call, OPS.balances(b), { limit: 1000, maxPages: 3 });
    if (renewFail) return needsConnect();
    if (!l.ok) return fail(502, 'Broker data is unavailable right now', 'upstream');
    return json({ data: l.data, truncated: l.truncated, userId: finUser });
  }
  const r = await call('GET', OPS[op](b), { query: op === 'accounts' ? { ...page, include_sync_status: 'true' } : page });
  if (!r.ok) return fail(502, 'Broker data is unavailable right now', 'upstream');
  return json({ data: r.data, userId: finUser });
}
export const handle = safe('data', run);
export const onRequest = pagesEntry(handle);
