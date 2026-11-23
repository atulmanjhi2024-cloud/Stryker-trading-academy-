// Broker pause, server side (Owner 23 Nov 2026; follow-up: beta testers keep brokers like admins). While BROKERS_PAUSED
// (assets/broker-pause.js, the one flag) is on, every /connect/finatic/* call from a normal member is refused 403 brokers_paused.
// Admins (admins/{uid}) and beta testers (verified sign-in email on settings/betaTesters: the SAME check as the /beta page,
// functions/api/beta/_lib.js) pass. Separate from the global kill switch settings/liveTrading, which stays the emergency stop for
// everyone (admins and beta testers too). Fails CLOSED: a list that cannot be read = not beta (refused).
import { BROKERS_PAUSED } from '../../../assets/broker-pause.js';
import { isBetaToken } from '../../api/beta/_lib.js';
import { fail } from './_fin.js';

export const PAUSED_ERR = 'Broker connections are paused for a short while while we fix a connection issue.';
const memo = new Map();   // uid -> { v, at, ttl }: a "yes" 60 s, a "no" 5 s (so adding a tester takes effect fast)
export const _resetPause = () => memo.clear();

async function betaUser(request, env, deps, uid) {
  if (deps.isBeta) return deps.isBeta(uid);   // tests
  const hit = memo.get(uid); if (hit && Date.now() - hit.at < hit.ttl) return hit.v;
  const b = await isBetaToken(env, request, { verifyFetch: deps.verifyFetch, fetchImpl: deps.betaFetch });
  const v = !!(b && b.uid === uid && b.beta);
  memo.set(uid, { v, at: Date.now(), ttl: v ? 60000 : 5000 });
  return v;
}

// null = allowed, else the Response to send. g = gate() result { uid, admin }.
export async function pausedReply(request, env, deps, g) {
  const paused = deps.brokersPaused !== undefined ? deps.brokersPaused : BROKERS_PAUSED;
  if (!paused || g.admin) return null;
  let ok = false; try { ok = await betaUser(request, env, deps, g.uid); } catch (e) { ok = false; }
  return ok ? null : fail(403, PAUSED_ERR, 'brokers_paused');
}
