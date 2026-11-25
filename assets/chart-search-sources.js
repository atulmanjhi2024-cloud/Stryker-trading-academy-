// TradeZoro — symbol search: "Your brokers & feeds" source filter (Owner feature 24 Nov). ES module, lazy-loaded by assets/chart-search.js
// the first time the search opens. Lists only what THIS member has connected, and what each source can serve:
//   - trading accounts (window.__stkLive, assets/chart-live.js; only mounted for members with broker access, cTrader only for admins + beta
//     testers, so members without access never see a trading source): cTrader (the account's symbol list + descriptions), MetaTrader
//     (the picked account's schema / positions list; else the usual names), Finatic brokers (futures roots, front months);
//   - "Connect your own data" feeds (assets/byo-core.js connectedIds): the symbols each adapter can serve.
// Opening a broker symbol opens OUR chart for the same instrument (mapCode) and, for MetaTrader / cTrader, remembers the broker symbol
// for that account (chart-live mtRemember = the same map the trade badge's picker writes), so trading on that chart needs no pick step.
// Reads only: never places, changes or cancels an order. Education only. Not financial advice.
import * as L from './chart-live-core.js?v=1273';

const IDX_KEYS = ['NDX', 'SPX', 'DJI', 'RUT', 'XAU', 'XAG', 'WTI'];
// broker index / metal / oil -> our chart(s), first one present in the symbol pool wins
const IDX_CHART = { NDX: [['futures', 'NQ1!']], SPX: [['futures', 'ES1!']], DJI: [['futures', 'YM1!']], RUT: [['futures', 'RTY1!']],
  XAU: [['fx', 'XAUUSD'], ['futures', 'GC1!']], XAG: [['fx', 'XAGUSD'], ['futures', 'SI1!']], WTI: [['futures', 'CL1!']] };
const IDX_CLS = { NDX: 'Indices', SPX: 'Indices', DJI: 'Indices', RUT: 'Indices', XAU: 'Metals', XAG: 'Metals', WTI: 'Energy' };
const USUAL = ['NQ1!', 'ES1!', 'YM1!', 'RTY1!', 'GC1!', 'SI1!', 'CL1!', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'BTCUSD'];
const FIN_ROOTS = ['NQ', 'MNQ', 'ES', 'MES', 'YM', 'MYM', 'RTY', 'M2K', 'GC', 'MGC', 'SI', 'SIL', 'CL', 'MCL', 'NG', 'HG', 'MHG', 'ZN', 'ZB', '6E'];
const CORE = () => import('./byo-core.js?v=1273');

// broker energy / metal names our pool may not carry -> the futures chart whose icon they share (row logo only; no trading key)
const ICON_ALIAS = { USOIL: 'CL1!', XTIUSD: 'CL1!', UKOIL: 'BZ1!', BRENT: 'BZ1!', XBRUSD: 'BZ1!', XNGUSD: 'NG1!', NATGAS: 'NG1!', NGAS: 'NG1!', XPTUSD: 'PL1!', XPDUSD: 'PA1!', COPPER: 'HG1!', XCUUSD: 'HG1!' };
// a broker row -> [prefix, ticker, desc, type] for symLogo (assets/symbol-logos.js): our chart's symbol when there is one, else the
// mapped instrument, else the code as a stock ticker (AAPL.US / #AAPL / AAPL.OQ -> AAPL); unknown names fall back to the initials badge
export function iconOf(r) {
  if (r.d) return [r.d.prefix || r.d.provider, r.d.ticker, r.d.description, r.d.type];
  const up = String(r.code || '').toUpperCase(), m = mapCode(up), a = ICON_ALIAS[up.replace(/[^A-Z0-9]/g, '')];
  if (m && m.charts && m.charts[0]) return [m.charts[0][0], m.charts[0][1], '', ''];
  if (a) return ['futures', a, '', 'futures'];
  return ['', up.replace(/^#/, '').replace(/[._](US|USA|OQ|O|N|NAS|NYSE|NASDAQ|CFD)$/, ''), r.desc, r.cls === 'Stocks' ? 'stock' : ''];
}

// broker symbol -> { key, cls, charts: [[provider, ticker], ...] } | null.  US100 / USTEC / NAS100.cash -> NDX -> futures:NQ1!;
// EURUSD / EURUSDm / EURUSD.pro -> fx:EURUSD; BTCUSD -> binance BTCUSDT; NQZ6 / NQ (futures broker) -> futures:NQ1!.
export function mapCode(code, futures) {
  const up = String(code || '').toUpperCase().trim(); if (!up) return null;
  if (futures) { const r = L.rootOfCode(up) || up.replace(/1!$/, ''); return L.ROOTS[r] ? { key: '', cls: 'Futures', charts: [['futures', r + '1!']] } : null; }
  for (const k of IDX_KEYS) if (L.mtMatches(k, [code]).length) return { key: k, cls: IDX_CLS[k], charts: IDX_CHART[k] };
  const bare = up.replace(/\.?(CASH|PRO|ECN|RAW|STD|MICRO|MINI|SB|M|R|I|X|C|Z|P)$/, '').replace(/[._#+\-/]/g, '');
  const k = L.mtChartKey(up.replace(/[._#+\-/]/g, '')) || L.mtChartKey(bare);
  if (!k || !k.same) return null;
  if (k.key === 'XAU' || k.key === 'XAG') return { key: k.key, cls: 'Metals', charts: IDX_CHART[k.key] };
  if (k.cands.length === 2) { const b = k.key.slice(0, -3); return { key: k.key, cls: 'Crypto', charts: [['binance', b + 'USDT'], ['coinbase', b + '-USD']] }; }
  return { key: k.key, cls: 'Forex', charts: [['fx', k.key]] };   // mtChartKey: crypto has two candidates (XUSD, XUSDT), forex one
}

// "Live …495" / "Demo …234": the account kind + the last 3 characters of its number (never the full number on screen)
export function acctLabel(a) {
  const num = String([a.alt, a.number, a.name].find((x) => /\d{3}$/.test(String(x || ''))) || a.number || '').replace(/[^A-Za-z0-9]/g, ''), demo = a.demo === true || (a.demo == null && /demo|sim|paper|practice/i.test(String(a.name || '') + ' ' + String(a.number || '')));
  return (demo ? 'Demo' : 'Live') + (num ? ' …' + num.slice(-3) : '');
}

// -> the member's sources: [{ id, kind: 'ct'|'mt'|'fin'|'byo', name, label, ok, acct?, byo? }]
export async function listSources() {
  const out = [], lv = window.__stkLive, accts = (lv && lv.state && lv.state.accounts) || [];
  for (const a of accts) {
    if (!a || !a.id) continue;
    if (a.ct) out.push({ id: a.id, kind: 'ct', name: 'cTrader', label: acctLabel(a), ok: true, acct: a });
    else if (a.mt) out.push({ id: a.id, kind: 'mt', name: a.mt === 'MT4' ? 'MetaTrader 4' : 'MetaTrader 5', label: acctLabel(a), ok: true, acct: a });
    else out.push({ id: a.id, kind: 'fin', name: a.broker || 'Broker', label: acctLabel(a), ok: !(a.sync && a.sync.status === 'failed'), acct: a });
  }
  try {
    const c = await CORE();
    for (const id of c.connectedIds()) {
      const s = c.srcById(id); if (!s) continue;
      const st = c.statusOf(id) || {};
      out.push({ id: 'byo:' + id, kind: 'byo', byo: id, name: s.name, label: 'Data feed', ok: st.status !== 'error' });
    }
  } catch (e) { /* no own-data module on this page */ }
  return out;
}

// -> { rows: [{ code, desc, cls, sym, d }], note, typed(q) -> row | null }. find(provider, ticker) -> the pool's symbol or null.
// sym = what the chart opens ('' = no chart for it yet); d = the pool entry when there is one.
export async function loadSymbols(src, find) {
  const target = (charts) => { for (const [p, t] of charts || []) { const d = find(p, t); if (d) return d; } return null; };
  const row = (code, desc, m, d, sym) => ({ code, desc: desc || (d && d.description) || '', cls: (m && m.cls) || 'Other', key: (m && m.key) || '', d: d || null, sym: sym || '' });
  if (src.kind === 'ct' || src.kind === 'mt') {
    const lv = window.__stkLive; let list = [];
    try { list = lv && lv.srcSymbols ? await lv.srcSymbols(src.id) : []; } catch (e) { list = []; }
    // cTrader: a symbol with no TradeZoro chart charts from the account's own prices (byo:CT:<name>, assets/byo-ctrader.js ctacct)
    const own = (code, d) => (!d && src.kind === 'ct' ? 'byo:CT:' + code : '');
    if (list.length) return { rows: list.map((x) => { const m = mapCode(x.code), d = m && target(m.charts); return row(x.code, x.desc, m, d, own(x.code, d)); }).sort((a, b) => a.cls.localeCompare(b.cls) || a.code.localeCompare(b.code)), note: '' };
    const seen = new Set(), rows = [];
    for (const s of USUAL) { const k = L.mtChartKey(s); if (!k) continue; for (const c of k.cands.slice(0, k.key.length === 6 ? 1 : 4)) { if (seen.has(c)) continue; seen.add(c); const m = mapCode(c), d = m && target(m.charts); rows.push(row(c, '', m, d, own(c, d))); } }
    return { rows, note: src.kind === 'ct' ? 'Your cTrader symbol list could not be loaded right now; showing the usual names. Sign in to cTrader again from the Trade menu if this stays.' : 'MetaTrader doesn’t share its full list; showing the usual names.' };
  }
  if (src.kind === 'fin') {
    let fronts = null;
    try { const m = await import('./chart-symbol-info.js?v=1273'); const d = await m.getInfo(); fronts = L.frontsOf(d && d.syms); } catch (e) { fronts = null; }
    const now = Date.now();
    return { rows: FIN_ROOTS.map((r) => { const f = L.frontMonth(r, now, fronts), m = mapCode(r, true), d = target(m.charts); return row(f ? f.code : r, d ? d.description + ' · front month' : 'Front month', m, d); }), note: 'Futures at ' + src.name + ', front months. Charts follow the continuous front month.' };
  }
  // own data feed: what the adapter can serve
  const c = await CORE(), id = src.byo, s = c.srcById(id) || {}, rows = [], seen = new Set();
  const add = (code, desc, d, sym, cls) => { if (seen.has(sym)) return; seen.add(sym); rows.push({ code, desc: desc || (d && d.description) || '', cls, key: '', d, sym }); };
  for (const [p, cls] of [['fx', 'Forex'], ['idx', 'Indices']]) for (const t of find.tickers(p)) if (c.serves(id, p, t)) add(t, '', find(p, t), '', cls);
  if (c.serves(id, 'byo', 'AAPL')) { const P = (await import('./byo-provider.js?v=1273')).POPULAR; for (const [t, n] of P) if (c.serves(id, 'byo', t)) add(t, n, find('byo', t), 'byo:' + t, 'Stocks'); }
  for (const m of String((s.manage || '') + ' ' + (s.help || '')).matchAll(/byo:([A-Z0-9][A-Z0-9:!&-]*(?:\.[A-Z]\d{2})?(?: \d{2}-\d{2})?)/gi)) { const t = m[1]; if (c.serves(id, 'byo', t)) add(t, 'Example', null, 'byo:' + t, 'Examples'); }
  const typed = (q) => { const t = String(q || '').trim().toUpperCase(); return t && c.serves(id, 'byo', t) ? { code: t, desc: 'Open from ' + s.name, cls: 'Typed', key: '', d: null, sym: 'byo:' + t } : null; };
  return { rows, typed, note: rows.length ? '' : 'Type a symbol the way ' + (s.name || 'this feed') + ' names it.' };
}

// remember the broker symbol for this account's chart instrument (MetaTrader / cTrader); returns the mapping key or ''
export function remember(src, r) {
  if (!(src.kind === 'ct' || src.kind === 'mt') || !r.key) return '';
  const lv = window.__stkLive; try { return lv && lv.mtRemember && lv.mtRemember(src.id, r.key, r.code) ? r.key : ''; } catch (e) { return ''; }
}

// the details pane spec list from a cTrader ProtoOASymbol (+ the base asset name) -> [[label, value]]; rows we don't have are left out.
// Volumes are in cents of units (cTrader). Market hours: schedule = [{ startSecond, endSecond }] from Sunday 00:00 in scheduleTimeZone;
// shown as open / closed with the next change in the member's own time zone.
export function specRows(spec, now = Date.now()) {
  const d = spec && spec.d; if (!d) return [];
  const out = [], num = (v) => Number(v), fmt = (v, dp) => num(v).toLocaleString(undefined, { maximumFractionDigits: dp == null ? 2 : dp });
  const lot = num(d.lotSize) / 100;
  if (lot > 0) out.push(['1 lot', fmt(lot, 2) + (spec.base ? ' ' + spec.base : ' units')]);
  if (num(d.lotSize) > 0 && num(d.minVolume) > 0) {
    const mn = num(d.minVolume) / num(d.lotSize), st = num(d.stepVolume) > 0 ? num(d.stepVolume) / num(d.lotSize) : 0;
    out.push(['Smallest trade', fmt(mn, 4) + (mn === 1 ? ' lot' : ' lots') + (st && st !== mn ? ' (step ' + fmt(st, 4) + ')' : '')]);
  }
  if (d.swapLong != null || d.swapShort != null) {
    const u = { 1: '%', PERCENTAGE: '%', 2: ' points', POINTS: ' points' }[d.swapCalculationType] || ' pips', sg = (v) => (num(v) > 0 ? '+' : num(v) < 0 ? '−' : '') + fmt(Math.abs(num(v)), 2);
    out.push(['Swap' + (u === '%' ? ' (%)' : ' (' + u.trim() + ')'), 'Long ' + sg(d.swapLong || 0) + ' · Short ' + sg(d.swapShort || 0)]);
  }
  const pct = d.commissionType === 3 || d.commissionType === 'PERCENTAGE_OF_VALUE', rate = num(d.preciseTradingCommissionRate) / (pct ? 1e5 : 1e8);   // cTrader: x10^5 for percentage, x10^8 otherwise
  if (rate > 0) {
    const t = { 1: ' USD / 1M USD', USD_PER_MIL_USD: ' USD / 1M USD', 2: ' USD / lot', USD_PER_LOT: ' USD / lot', 3: '% of value', PERCENTAGE_OF_VALUE: '% of value', 4: ' quote ccy / lot', QUOTE_CCY_PER_LOT: ' quote ccy / lot' }[d.commissionType];
    if (t) out.push(['Commission per side', fmt(rate, 4) + t]);
  }
  const m = marketState(d.schedule, d.scheduleTimeZone, now);
  if (m) out.push(['Market', m]);
  return out;
}
// "Open, closes Wed 03:29" / "Closed, opens Mon 05:30" (member's time) | '' when the schedule is unknown
export function marketState(sched, tz, now = Date.now()) {
  const iv = (sched || []).map((x) => [num0(x.startSecond), num0(x.endSecond)]).filter((x) => x[1] > x[0]);
  if (!iv.length) return '';
  let p; try { p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', weekday: 'short', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(now)).map((x) => [x.type, x.value])); } catch (e) { return ''; }
  const W = 604800, at = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) * 86400 + (+p.hour) * 3600 + (+p.minute) * 60 + (+p.second);
  const when = (sec) => new Date(now + sec * 1000).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const open = iv.find(([a, b]) => at >= a && at < b);
  if (open) return 'Open, closes ' + when(open[1] - at);   // shortcut: an interval that runs into the next one (e.g. over Sunday 00:00) shows its own end
  const next = iv.map(([a]) => (a - at + W) % W).sort((x, y) => x - y)[0];
  return 'Closed, opens ' + when(next);
}
const num0 = (v) => Number(v) || 0;
