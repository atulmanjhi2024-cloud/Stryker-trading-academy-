// Indian markets: symbol mapping, search names, IST sessions, bars paging/aggregation, delay read from the provider, the gate. Run: node tools/tests/india.test.mjs
import assert from 'node:assert/strict';
import * as C from '../../assets/india-core.js';
import * as S from '../../functions/api/chart/_india.js';

// mapping
assert.equal(C.entryOf('NIFTY').code, 'NSE:NIFTY');
assert.equal(C.entryOf('india:BANKNIFTY').code, 'NSE:BANKNIFTY');
assert.equal(C.entryOf('NSE:NIFTY1!').type, 'futures');
assert.equal(C.entryOf('BSE:SENSEX').exchange, 'BSE');
assert.equal(C.entryOf('NSE:SENSEX'), null, 'Sensex is BSE only');
assert.equal(C.entryOf('FINNIFTY').code, 'NSE:CNXFINANCE');
assert.equal(C.entryOf('RELIANCE'), null, 'bare stock names stay with world stocks');
assert.equal(C.entryOf('NSE:RELIANCE').sym, 'india:RELIANCE');
assert.equal(C.entryOf('NSE:M&M').key, 'IN-MM');
assert.equal(C.entryOf('india:TATAMOTORS').ticker, 'TMPV');
assert.ok(C.INDIA.filter((e) => e.type === 'stock').length >= 50);
assert.equal(new Set(C.INDIA.map((e) => e.key)).size, C.INDIA.length, 'logo keys unique');
assert.equal(C.entryOf('india:NOPE'), null);
// session
const ist = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi) - C.IST_S * 1000;
assert.ok(!C.isOpen(ist(2026, 11, 25, 9, 14)) && C.isOpen(ist(2026, 11, 25, 9, 15)) && C.isOpen(ist(2026, 11, 25, 15, 29)) && !C.isOpen(ist(2026, 11, 25, 15, 30)));
assert.ok(!C.isOpen(ist(2026, 11, 28, 11, 0)), 'Saturday closed');
const info = { holidays: ['20261126'], special: { '20261129': [18 * 60, 19 * 60] } };
assert.ok(!C.isOpen(ist(2026, 11, 26, 11, 0), info), 'holiday closed');
assert.ok(C.isOpen(ist(2026, 11, 29, 18, 30), info), 'special Sunday session');
assert.equal(C.nextOpen(ist(2026, 11, 25, 16, 0), info), ist(2026, 11, 27, 9, 15));
assert.equal(C.sessionKey(ist(2026, 11, 25, 10, 20), 45 * 60e3), ist(2026, 11, 25, 10, 0));
assert.equal(C.sessionKey(ist(2026, 11, 25, 15, 25), 3600e3), ist(2026, 11, 25, 15, 15));
const cal = C.calendar(ist(2026, 11, 25, 0, 0), ist(2026, 11, 28, 0, 0), info);
assert.equal(cal.length, 2);   // Wed + Fri (Thu is a holiday)
assert.deepEqual(C.parseSession({ holidays: ['20230101', '20261126'], details: [{ description: 'Regular', session_correction: [{ start_hour: '1800', end_hour: '1900', dates: ['20261129'] }] }] }), { holidays: ['20261126'], special: { '20261129': [1080, 1140] } });
// gate
assert.ok(C.audienceOk('beta', true) && !C.audienceOk('beta', false) && C.audienceOk('all', false) && !C.audienceOk('off', true));
assert.equal(C.INDIA_AUDIENCE, 'beta', 'ships behind the beta gate');

// bars: 15m rows 09:15, 09:30 ... -> 1h anchored 09:15
const t0 = ist(2026, 11, 25, 9, 15) / 1000;
const mk = (t, c) => ({ time: t, open: c, high: c + 1, low: c - 1, close: c, volume: 10 });
const calls = [];
const fetchImpl = async (url) => {
  calls.push(url);
  if (/\/info$/.test(url)) return Response.json({ delay_seconds: /SENSEX/.test(url) ? 900 : 0, tick_size: [0.05], point_value: 1 });
  if (/\/session$/.test(url)) return Response.json({ holidays: ['20261126'], details: [] });
  const series = []; for (let i = 0; i < 8; i++) series.push(mk(t0 + i * 900, 100 + i));
  series.push({ time: t0 - 900, open: 99, high: 99, low: 99, close: 99, volume: 0 });   // pre-open print, no volume
  return Response.json({ series });
};
S._clear();
const now = t0 + 3 * 3600, e = C.entryOf('NIFTY'), env = { INSIGHTSENTRY_WEBSOCKET_API_KEY: 'k' };
const p = S.pageOf('60', t0);
const rows = await S.fetchPage(e, '60', p, now, fetchImpl, env, null);
assert.equal(rows.length, 2, 'hour bars: 09:15 and 10:15');
assert.equal(rows[0][0], t0); assert.equal(rows[0][5], 40); assert.equal(rows[0][4], 103);
const r15 = await S.fetchPage(e, '15', S.pageOf('15', t0), now, fetchImpl, env, null);
assert.equal(r15.length, 8, 'pre-open print dropped');
assert.ok(calls.every((u) => !/Bearer/.test(u)) && calls.some((u) => /NSE%3ANIFTY\/history\?bar_type=minute&bar_interval=15&start_ym=2026-11/.test(u)));
const inf = await S.fetchInfo(C.entryOf('BSE:SENSEX'), Date.now(), fetchImpl, env);
assert.equal(inf.delay, 900); assert.deepEqual(inf.session.holidays, ['20261126']);
assert.equal((await S.fetchInfo(e, Date.now(), fetchImpl, env)).delay, 0);
assert.equal(S.normTf('1h'), '60'); assert.equal(S.normTf('x'), null);
await assert.rejects(S.fetchPage(e, '15', S.pageOf('15', now) + 5, now, fetchImpl, env, null), S.OutOfRange);
// vendor name never in client files
import { readFileSync } from 'node:fs';
for (const f of ['assets/chart-india.js', 'assets/india-core.js']) assert.ok(!/insightsentry/i.test(readFileSync(new URL('../../' + f, import.meta.url), 'utf8')), f);
console.log('india.test.mjs OK');
