// POST /api/beta/admin (Bearer ID token, admins only) body { action: 'add' | 'remove', email } -> { ok, emails }. The only writer of settings/betaTesters.
// Cap 30 (add refused at 30). Also flips the students/{uid}.beta mirror for the account with that email, so a removal cuts Pro-by-beta at once.
// shortcut: read-modify-write of one doc is not atomic; two admins adding at the same second could drop one email. Upgrade: Firestore transaction.
import { BETA, normEmail, emailOk } from '../../../assets/beta-config.mjs';
import { json, okOrigin, authUid, fsClient, isAdminUid, getList, mirrorBeta, LIST } from './_lib.js';

export async function handle(request, env, deps = {}) {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  if (!okOrigin(request, env)) return json({ error: 'Forbidden' }, 403);
  const uid = await authUid(request, deps);
  if (!uid) return json({ error: 'Sign in first' }, 401);
  const fs = fsClient(env, deps.fetchImpl || fetch);
  try {
    if (!(await isAdminUid(fs, uid))) return json({ error: 'Admins only' }, 403);
    let b; try { b = JSON.parse(await request.text()); } catch (e) { b = null; }
    const email = normEmail(b && b.email), action = b && b.action;
    if ((action !== 'add' && action !== 'remove') || !emailOk(email)) return json({ error: 'Enter a valid email.' }, 400);
    const list = await getList(fs);
    let next = list;
    if (action === 'add' && !list.includes(email)) {
      if (list.length >= BETA.cap) return json({ error: 'The list is full (' + BETA.cap + ' of ' + BETA.cap + '). Remove someone first.' }, 409);
      next = list.concat(email);
    } else if (action === 'remove') next = list.filter((x) => x !== email);
    if (next !== list) await fs.patch(LIST, { emails: next }, false);
    // mirror for the matching account(s); the list is the truth, status.js re-syncs at sign-in
    const hits = await fs.query('students', 'email', 'EQUAL', email, 5);
    for (const s of hits) if (!(await isAdminUid(fs, s._id))) await mirrorBeta(fs, s._id, next.includes(email));
    return json({ ok: true, emails: next });
  } catch (e) { return json({ error: 'Could not save. Try again.' }, 502); }
}
export const onRequest = ({ request, env }) => handle(request, env);
