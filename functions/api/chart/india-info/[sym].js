// GET /api/chart/india-info/:sym -> { delay, tick, pv, name, session: { holidays, special } }  read from the data plan at request time (never hard-coded):
// delay 0 = live, > 0 = the page shows the "15 min delayed" tag. Same gate as india/[sym].js. No vendor name is returned.
import { entryOf, fetchInfo, allowed } from '../_india.js';

export async function onRequestGet(ctx) {
  const { request, params, env } = ctx;
  const no = () => new Response(JSON.stringify({ error: 'unknown symbol' }), { status: 404, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  if (!(await allowed(request, env || {}, ctx.deps))) return no();
  const e = entryOf(decodeURIComponent(params.sym || ''), true) || entryOf('india:' + decodeURIComponent(params.sym || ''), true);
  if (!e) return no();
  const out = await fetchInfo(e, Date.now(), fetch, env || {});
  const ok = out.delay != null && out.session;
  return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': ok ? 'private, max-age=300' : 'private, max-age=20', vary: 'Authorization' } });
}
