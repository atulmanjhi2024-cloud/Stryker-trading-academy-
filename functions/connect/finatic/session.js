// Admin-only broker sync (beta): start a Finatic Connect session and hand back the portal URL (redirect flow).
//   GET  ?probe=1 -> {configured}      (flag only, nothing else)
//   POST {userId?}                   -> {portalUrl, sessionId, userId}   (admin ID token required: 401 unsigned, 403 non-admin)
// userId (Owner 19 Nov, "always open the connect page, I want to add a new broker"): the Finatic user the admin already linked
// brokers under. The portal session is started FOR that user, so a broker added in the portal joins the same user and the accounts
// already linked stay linked and listed. Unknown / stale user id -> an anonymous session (as before) and userId '' in the reply.
// The portal URL is a secret: it goes only to the admin who asked. The API key never leaves this server.
import { gate, readBody, fin, startSession, sessionHeaders, json, fail, configured, methodNotAllowed, safe, pagesEntry, deferOf, UUID } from './_fin.js';

async function run(request, env, deps) {
  if (request.method === 'GET') {
    if (new URL(request.url).searchParams.get('probe') !== '1') return fail(404, 'Not found');
    return json({ configured: configured(env) }, configured(env) ? 200 : 503);
  }
  if (request.method !== 'POST') return methodNotAllowed('GET, POST');
  const g = await gate(request, env, deps, 'finatic-session');
  if (g instanceof Response) return g;
  const b = await readBody(request);
  if (!b || typeof b !== 'object') return fail(400, 'Bad request');
  const want = typeof b.userId === 'string' && UUID.test(b.userId) ? b.userId : '';
  let s = await startSession(env, deps, want || null), user = want;
  if (s.failed && want && s.staleUser) { s = await startSession(env, deps, null); user = ''; }   // that user is gone: start clean
  const DOWN = 'Broker sync could not start: the connection service answered with an error. Try again in a minute; if it keeps happening, tell support.';
  if (s.failed) return fail(502, DOWN + (s.status ? ' (code ' + s.status + ')' : ''), 'upstream');
  const p = await fin(env, deps, 'GET', '/api/v1/session/portal', { headers: sessionHeaders(s) });
  let url = p.ok && p.data && (p.data.portal_url || p.data.portalUrl);
  try { url = new URL(url); } catch (e) { url = null; }
  if (!url || url.protocol !== 'https:') { console.warn('finatic: portal url missing, status ' + p.status); return fail(502, DOWN + (p.status ? ' (code ' + p.status + ')' : ''), 'upstream'); }
  url.searchParams.set('parent_origin', 'https://tradezoro.com');
  url.searchParams.set('mode', b.mode === 'light' ? 'light' : 'dark');
  return json({ portalUrl: url.toString(), sessionId: s.sessionId, userId: user && (!s.userId || s.userId === user) ? user : '' });
}
export const handle = safe('session', run);
export const onRequest = pagesEntry(handle);
