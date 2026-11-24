// GET /api/chart/rt — "may this caller have real-time CME futures data?" Answers {admin:boolean}
// from a VERIFIED Firebase ID token (Authorization: Bearer) + the admins/{uid} document
// (functions/api/chart/_rt.js). Used by the Charts page only to choose the UI (green Real-time dot,
// open the stream); the data endpoints enforce the same rule themselves.
import { isRealtimeToken, isLiveDataToken, bearerOf } from './_rt.js';

export async function onRequestGet(ctx) {
  const tok = bearerOf(ctx.request);
  const out = {};
  const admin = await isRealtimeToken(tok, { out });
  // l2 (2026-11-13, all tools free): this member also has the LIVE futures order book (the paid data feed). UI hint only; the
  // recorder's /ts-live, /ts-book-history and /ts-aux enforce it themselves (src/ts-access.js).
  const l2 = !!tok && (await isLiveDataToken(tok, { out }));
  const h = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'vary': 'Authorization' };
  // FIRESTORE OUTAGE (Owner bug 24 Nov 2026, quota 429): an answer we could not get is NOT a "no". Unless this isolate confirmed the
  // member recently (then admin / l2 are that yes), answer 503 unknown: the page (assets/rt-access.js askServer) keeps the answer
  // UNKNOWN and asks again, so a paying member never sees the 10-minute label or the paid-feed upsell because of our outage.
  if (out.outage && !admin && !l2) return new Response(JSON.stringify({ admin: false, l2: false, unknown: true }), { status: 503, headers: h });
  return new Response(JSON.stringify(out.outage ? { admin, l2, kept: true } : { admin, l2 }), { headers: h });
}
