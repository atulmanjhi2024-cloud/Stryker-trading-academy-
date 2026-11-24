// ACCESS GATE for the futures L2 / L1 trades feed. ALL TOOLS FREE (Owner order 2026-11-13): the tools are free for every signed-in
// member; only the LIVE data feed is paid (the existing Pro subscription), because the exchange's rules make it paid.
// Worker var TS_ACCESS = 'pro' (wrangler.jsonc) opens the LIVE L2 book to isLiveDataToken (admin, demo, active Pro incl. grandfathered).
// Unset or unknown = 'admin' only for the live book (fails closed).
import { isAdminToken, isLiveDataToken, isRealtimeToken, isMemberToken, verifyIdToken, tokClaims, RT_DELAY_S } from './rt-auth.js';

export const tsAccess = (env) => (env && String(env.TS_ACCESS || '').toLowerCase() === 'pro' ? 'pro' : 'admin');
// LIVE L2 book (the /ts-live 'book' tier and the undelayed book history)
export async function tsAllowed(env, token, opts = {}) {
  if (!token) return false;
  return tsAccess(env) === 'pro' ? isLiveDataToken(token, opts) : isAdminToken(token, opts);
}

// TIERS for the /ts-live WebSocket (unchanged rules, Owner 2026-11-03 / 2026-11-04):
//   'book'   = tsAllowed() above: trades AND the live L2 book (the paid data feed).
//   'trades' = isRealtimeToken (L1 live: admin, demo, switched-on members, the live-data add-on, kept-live early Pro, and any member
//              with the signed market data agreement): trades, candles and quotes only, never the book.
//   null     = nobody else (signed out, anonymous, bad token, no agreement). Fails closed; the server is the gate, the page only hides things.
export async function tsTier(env, token, opts = {}) {
  if (!token) return null;
  if (await tsAllowed(env, token, opts)) return 'book';
  return (await isRealtimeToken(token, opts)) ? 'trades' : null;
}

// Same rule, with the REASON, for the hub's periodic re-check of an OPEN socket (Owner bug 24 Nov 2026: a Firestore quota outage and the
// 1-hour ID token made the re-check answer null, and paying members / the Owner were closed with 4003 'access ended').
// -> { tier: 'book' | 'trades' | null, why }:
//   'ok'      the token is valid and the tier is the server's definite answer (or a last confirmed yes kept through an outage)
//   'no'      valid, unexpired token and a DEFINITE answer: no live tier. The ONLY answer that may revoke an open socket.
//   'expired' the token's exp has passed (the browser has to send a fresh one: {op:'auth'})
//   'invalid' not a token we could verify (bad signature, wrong project, anonymous, or Google's keys unreadable)
//   'outage'  the token IS verified but Firestore could not be read: unknown (tier = a last confirmed yes, or null). Keep what the socket has.
export async function tsTierWhy(env, token, opts = {}) {
  if (!token) return { tier: null, why: 'invalid' };
  const c = tokClaims(token), now = opts.nowSec || Math.floor(Date.now() / 1000);
  if (c.exp && !(c.exp > now)) return { tier: null, why: 'expired' };
  const o = Object.assign({}, opts, { out: {} });
  if (!(await verifyIdToken(token, o))) return { tier: null, why: 'invalid' };   // also when Google's keys could not be read: an UNVERIFIED token never vouches for anyone
  const tier = await tsTier(env, token, o);
  if (o.out.outage) return { tier, why: 'outage' };
  return { tier, why: tier ? 'ok' : 'no' };
}

// HISTORY reads (/ts-book-history, /ts-aux, /ts-trades) feed the free tools (Footprint (L2), the DOM heatmap's history, the book pack),
// so ANY signed-in, non-anonymous member may read them, but only up to now - 11 min (the 10-minute exchange delay + 60 s) unless they
// hold the LIVE level for that data:
//   /ts-book-history, /ts-aux (book-derived): live = tsAllowed (L2, the paid feed).
//   /ts-trades (trade prints + delta): live = isRealtimeToken (L1: the signed agreement is enough, as on /ts-live) or the L2 level
//   (the 'book' tier always carried trades, so a payer without the agreement keeps live prints, as before).
// -> { cutMs } (0 = no cut, live) or null = refused (no token, anonymous, bad token).
export const TS_HIST_CUT_MS = RT_DELAY_S * 1000 + 60000;
export async function tsHistoryAccess(env, token, path, opts = {}) {
  if (!token || !(await isMemberToken(token, opts))) return null;
  const live = (await tsAllowed(env, token, opts)) || (path === '/ts-trades' && (await isRealtimeToken(token, opts)));
  return { cutMs: live ? 0 : (opts.nowMs || Date.now()) - TS_HIST_CUT_MS };
}
