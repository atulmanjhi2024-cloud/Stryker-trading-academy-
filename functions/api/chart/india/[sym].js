// GET /api/chart/india/:sym?tf=15&page=N -> { s, tf, page, bars: [[t,o,h,l,c,v], ...] }  Indian markets (NSE / BSE), see _india.js.
// Gate: INDIA_AUDIENCE (assets/india-core.js), checked BEFORE any cache or vendor call: a member outside the audience gets 404, as if the symbol did not exist.
import { entryOf, normTf, pageOf, fetchPage, fetchInfo, ttlFor, OutOfRange, allowed } from '../_india.js';

const json = (data, status, ttl) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': ttl > 0 ? 'private, max-age=' + Math.min(ttl, 600) : 'no-store', vary: 'Authorization' } });
const edge = () => (typeof caches !== 'undefined' && caches.default ? caches.default : null);

export async function onRequestGet(ctx) {
  const { request, params, env } = ctx;
  if (!(await allowed(request, env || {}, ctx.deps))) return json({ error: 'unknown symbol' }, 404, 0);
  const e = entryOf(decodeURIComponent(params.sym || ''), true) || entryOf('india:' + decodeURIComponent(params.sym || ''), true);
  if (!e) return json({ error: 'unknown symbol' }, 404, 0);
  const url = new URL(request.url), tf = normTf(url.searchParams.get('tf') || '15');
  if (!tf) return json({ error: 'unsupported timeframe' }, 400, 0);
  const now = Math.floor(Date.now() / 1000), current = pageOf(tf, now);
  const page = url.searchParams.has('page') ? Number(url.searchParams.get('page')) : current;
  if (!Number.isInteger(page) || page < 0) return json({ error: 'bad page' }, 400, 0);
  if (page > current) return json({ s: e.ticker, tf, page, bars: [] }, 200, 300);
  const cache = edge(), ck = new Request('https://india.tradezoro.internal/' + encodeURIComponent(e.key) + '/' + tf + '/' + page);
  try {
    if (cache) { const hit = await cache.match(ck); if (hit) return new Response(hit.body, { status: 200, headers: hit.headers }); }
    const info = (await fetchInfo(e, Date.now(), fetch, env)).session || null;
    const bars = await fetchPage(e, tf, page, now, fetch, env, info);
    const ttl = bars.length ? ttlFor(tf, page, now) : 30, res = json({ s: e.ticker, tf, page, bars }, 200, ttl);
    if (cache && ttl > 0) { const w = cache.put(ck, new Response(JSON.stringify({ s: e.ticker, tf, page, bars }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, max-age=' + ttl + ', s-maxage=' + ttl, vary: 'Authorization' } })).catch(() => {}); if (ctx.waitUntil) ctx.waitUntil(w); }
    return res;
  } catch (err) {
    if (err instanceof OutOfRange) return json({ s: e.ticker, tf, page, bars: [] }, 200, 60);
    return json({ error: 'upstream unavailable' }, 502, 0);
  }
}
