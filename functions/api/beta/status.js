// POST /api/beta/status (Bearer ID token) -> { beta, admin, cap }. Beta = admin, or the VERIFIED sign-in email is on settings/betaTesters.
// Also keeps the students/{uid}.beta mirror (read by the Pro live-data gate and the badge) in step with the list, so an add or a removal takes effect at the next sign-in at the latest.
import { BETA } from '../../../assets/beta-config.mjs';
import { json, okOrigin, authClaims, betaFor, mirrorBeta } from './_lib.js';

export async function handle(request, env, deps = {}) {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  if (!okOrigin(request, env)) return json({ error: 'Forbidden' }, 403);
  const c = await authClaims(request, deps);
  if (!c) return json({ error: 'Sign in first' }, 401);
  try {
    const b = await betaFor(env, c, deps);
    if (!b.admin) await mirrorBeta(b.fs, c.uid, b.beta);
    return json({ beta: b.beta, admin: b.admin, cap: BETA.cap });
  } catch (e) { return json({ error: 'Beta status is not available right now.' }, 502); }
}
export const onRequest = ({ request, env }) => handle(request, env);
