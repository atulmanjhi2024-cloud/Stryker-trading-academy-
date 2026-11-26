// Indian markets (NSE / BSE) chart data, server side. Pure module, no Pages context; every network call goes through fetchImpl so tests mock it.
// Used by functions/api/chart/india/[sym].js (bars) and functions/api/chart/india-info/[sym].js (delay + session), tested in tools/tests/india.test.mjs.
// Source: the REST data plan (same key as the dollar index and GEX engine: INSIGHTSENTRY_WEBSOCKET_API_KEY). The vendor's name never leaves this file.
// Bars: [t, o, h, l, c, v] (t = bar open, epoch seconds). Minute bars come one IST-month per vendor call (memoised 10 s for the current
// month so a few members polling share one call, 10 min otherwise). 1h / 2h / 4h are built from 15-minute rows anchored to the 09:15 IST open.
// The delay (delay_seconds) of each symbol is read from the vendor at runtime (never written here): 0 = live, > 0 = the "delayed" tag.
import { entryOf, istParts, aggregateIst, parseSession, INDIA_AUDIENCE, audienceOk, IST_S } from '../../../assets/india-core.js';

export const IS_REST = 'https://api.insightsentry.com/v3/symbols/';
const H = 3600, D = 86400;
// page = window in seconds (0 = everything in one page). MUST equal PAGE_SECS in assets/chart-futures-provider.js.
export const TIMEFRAMES = {
  '1': { type: 'minute', n: 1, page: 8 * H }, '5': { type: 'minute', n: 5, page: 2 * D }, '15': { type: 'minute', n: 15, page: 5 * D },
  '30': { type: 'minute', n: 30, page: 10 * D }, '60': { type: 'minute', n: 15, page: 20 * D, agg: 4 }, '120': { type: 'minute', n: 15, page: 40 * D, agg: 8 },
  '240': { type: 'minute', n: 15, page: 60 * D, agg: 16 }, 'D': { type: 'day', n: 1, page: 730 * D }, 'W': { type: 'week', n: 1, page: 0 }, 'M': { type: 'month', n: 1, page: 0 }
};
const TF_ALIASES = { '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '60m': '60', '2h': '120', '4h': '240', '1d': 'D', '1D': 'D', d: 'D', '1w': 'W', '1W': 'W', w: 'W', '1M': 'M', '1mo': 'M' };
export const normTf = (tf) => { tf = String(tf || ''); return TIMEFRAMES[tf] ? tf : TF_ALIASES[tf] || null; };
export const pageBounds = (tf, page) => { const p = TIMEFRAMES[tf].page; return p ? [page * p, (page + 1) * p] : [0, Infinity]; };
export const pageOf = (tf, t) => { const p = TIMEFRAMES[tf].page; return p ? Math.floor(t / p) : 0; };
export class OutOfRange extends Error {}
export const keyOf = (env) => env && (env.INSIGHTSENTRY_WEBSOCKET_API_KEY || env.INSIGHTSENTRY_API_KEY);

const memo = new Map(), inflight = new Map();
export const _clear = () => { memo.clear(); inflight.clear(); };
const ymOf = (t) => { const d = new Date((t + IST_S) * 1000); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); };
async function vget(path, key, fetchImpl, ttlMs) {
  const url = IS_REST + path, hit = memo.get(url);
  if (hit && hit.exp > Date.now()) return hit.v;
  let p = inflight.get(url);
  if (!p) {
    p = (async () => {
      const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort('timeout'), 12000);
      try {
        const res = await fetchImpl(url, { signal: ctrl.signal, headers: { authorization: 'Bearer ' + key, accept: 'application/json' } });
        if (res.status === 400 || res.status === 404) return null;   // no data for that month / unknown code: an empty answer, not an error
        if (!res.ok) throw new Error('upstream ' + res.status);
        const v = await res.json();
        memo.set(url, { exp: Date.now() + ttlMs, v });
        if (memo.size > 80) memo.delete(memo.keys().next().value);
        return v;
      } finally { clearTimeout(timer); }
    })().finally(() => inflight.delete(url));
    inflight.set(url, p);
  }
  return p;
}
const rowsOf = (j) => {
  const rows = [];
  for (const b of (j && j.series) || []) {
    const t = Math.floor(Number(b.time)), o = +b.open, h = +b.high, l = +b.low, c = +b.close;
    if (!(t > 0) || !(Math.min(o, h, l, c) > 0)) continue;
    rows.push([t, o, Math.max(h, o, c), Math.min(l, o, c), c, Math.max(0, Math.round(+b.volume || 0))]);
  }
  return rows.sort((a, b) => a[0] - b[0]);
};
const enc = (code) => encodeURIComponent(code);

// one page of bars for entry e. Throws on an upstream failure (the caller falls back to last-good), OutOfRange for a future page.
export async function fetchPage(e, tf, page, now = Math.floor(Date.now() / 1000), fetchImpl = fetch, env = {}, info = null) {
  const key = keyOf(env); if (!key) throw new Error('no data key');
  const cfg = TIMEFRAMES[tf];
  const [p1, p2] = pageBounds(tf, page);
  if (cfg.page && p1 > now) throw new OutOfRange('future page');
  if (!cfg.page && page !== 0) return [];
  let rows;
  if (cfg.type === 'minute') {
    // IST-months overlapping [p1 - 1 day, min(p2, now)]
    const from = Math.max(p1 - D, 0), to = Math.min(p2, now + 60), months = [];
    for (let t = from; ; t += 20 * D) { const y = ymOf(Math.min(t, to)); if (!months.includes(y)) months.push(y); if (t >= to) break; }
    const cur = ymOf(now);
    const got = await Promise.all(months.map((ym) => vget(enc(e.code) + '/history?bar_type=minute&bar_interval=' + cfg.n + '&start_ym=' + ym, key, fetchImpl, ym === cur ? 10000 : 600000).then(rowsOf)));
    const by = new Map(); for (const g of got) for (const r of g) by.set(r[0], r);
    rows = [...by.values()].sort((a, b) => a[0] - b[0]);
    rows = rows.filter((r) => r[0] >= p1 - (cfg.agg ? 2 * H : 0) && r[0] < p2 + (cfg.agg ? 2 * H : 0));
    if (cfg.agg) rows = aggregateIst(rows, cfg.agg * cfg.n * 60);
  } else rows = rowsOf(await vget(enc(e.code) + '/history?bar_type=' + cfg.type + '&bar_interval=' + cfg.n, key, fetchImpl, 60000));
  if (cfg.type === 'minute') rows = rows.filter((r) => r[5] > 0 || inSession(r[0], info));   // pre-open prints (no volume, outside 09:15-15:30) are not candles
  if (cfg.page) rows = rows.filter((r) => r[0] >= p1 && r[0] < p2);
  return rows;
}
function inSession(t, info) {
  const p = istParts(t * 1000), s = info && info.special && info.special[p.ymd] || [555, 930];
  return p.dow !== 0 && p.dow !== 6 ? p.min >= s[0] && p.min < s[1] : !!(info && info.special && info.special[p.ymd]) && p.min >= s[0] && p.min < s[1];
}
export function ttlFor(tf, page, now) {
  const cfg = TIMEFRAMES[tf], end = cfg.page ? pageBounds(tf, page)[1] : Infinity;
  if (end <= now - 2 * H) return 3600;
  return tf === '1' || tf === '5' ? 8 : 12;
}

// delay (seconds) + session + tick for one symbol, read from the vendor. Never throws; a missing field is left out.
export async function fetchInfo(e, now = Date.now(), fetchImpl = fetch, env = {}) {
  const key = keyOf(env); if (!key) return {};
  const out = {};
  await Promise.all([
    vget(enc(e.code) + '/info', key, fetchImpl, 3600e3).then((d) => {
      if (!d) return;
      if (Number.isFinite(Number(d.delay_seconds))) out.delay = Math.max(0, Math.round(Number(d.delay_seconds)));
      const tk = Array.isArray(d.tick_size) ? Number(d.tick_size[0]) : Number(d.tick_size);
      if (tk > 0) out.tick = tk;
      if (Number(d.point_value) > 0) out.pv = Number(d.point_value);
      if (d.name) out.name = String(d.name);
    }).catch(() => {}),
    vget(enc(e.code) + '/session', key, fetchImpl, 6 * 3600e3).then((j) => { if (j) out.session = parseSession(j); }).catch(() => {})
  ]);
  return out;
}

// ---- the gate (admins + beta testers while INDIA_AUDIENCE = 'beta'; same check as functions/api/beta/_lib.js, server side by verified email) ----
export async function allowed(request, env, deps = {}) {
  if (INDIA_AUDIENCE === 'all') return true;
  if (INDIA_AUDIENCE !== 'beta') return false;
  const { isBetaToken } = await import('../beta/_lib.js');
  const t = await isBetaToken(env, request, deps).catch(() => null);
  return audienceOk(INDIA_AUDIENCE, !!(t && (t.admin || t.beta)));
}
export { entryOf };
