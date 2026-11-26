// Regression test for "more than 3 scripts on the chart and scrolling is laggy" (Discord bug-reports, Nov 2026).
//   node tools/tests/chart-dev-server.mjs 8031 &
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/chart-scriptlag-browser.js
// Drives chart-perf-pan.js (member page, NQ sample bars from fixtures, no network, no orders) with 6 indicators
// (EMA, Bollinger, RSI, VWAP, volume profile, MACD) + a QT-style Pine script (fixtures/scriptlag/qt-style.pine), 2 runs of 5 s drag-pan + 3 s zoom, and asserts:
//   1. no page errors
//   2. the page-wide MutationObserver passes (venue-logos relabel/avatars, beta badges) stay coalesced:
//      they re-queried the whole document on every pan-frame DOM change before the fix
//   3. pan frame p95 stays under a loose cap (shared server, so only gross regressions trip it)
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const out = path.join(os.tmpdir(), 'scriptlag-' + process.pid + '.json');
const env = Object.assign({}, process.env, { NATIVES: 'ema,bollinger-bands,rsi,vwap,vpvr,macd', RUNS: '2', PROFILE: '0', PINE: '1',
  PROBE_JS: path.join(__dirname, 'fixtures/scriptlag/probe-count.js'), PROBE_AFTER: path.join(__dirname, 'fixtures/scriptlag/probe-read.js') });
const r = spawnSync('node', [path.join(__dirname, 'chart-perf-pan.js'), out, 'member', '1'], { env, encoding: 'utf8', timeout: 280000 });
const txt = (r.stdout || '') + (r.stderr || '');
const m = /after (\{.*\})/.exec(txt);
const res = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8'))['member@1'] : null;
let fail = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fail++; };
ok(!!res && !!m, 'benchmark ran');
if (res && m) {
  const calls = JSON.parse(m[1]).qsaCalls, secs = 2 * (5 + 3) + 1;
  const perS = Math.round(calls / secs);
  console.log('observer document queries per second:', perS, ' pan p50/p95:', res.pan.p50, res.pan.p95, ' dropped', res.pan.dropped + '/' + res.pan.frames);
  ok(!(res.errors || []).length, 'no page errors ' + JSON.stringify(res.errors));
  const A = JSON.parse(m[1]);
  console.log('after:', JSON.stringify(A));
  // event-driven axis tags: an idle chart (3 s, no pan, no data) repaints only on the 500 ms safety timer, not 180 frames
  ok(A.idlePaints3s >= 0 && A.idlePaints3s <= 15, 'axis tags idle repaints in 3 s <= 15 (got ' + A.idlePaints3s + ')');
  // the QT-style Pine script runs once (execute) and is not re-executed by pan / zoom
  ok(A.pineExecutes === 1, 'Pine script executed exactly once through add + pan + zoom (got ' + A.pineExecutes + ')');
  // mouse-move hit-tests share one cached canvas list (chart-hit-cache.js): about 5 queries a second at most, was one per handler per move
  ok(A.hitQueries / secs < 12, 'hit-test document queries per second < 12 (got ' + Math.round(A.hitQueries / secs) + ')');
  ok(perS < 20, 'observer-driven document queries per second < 20 (got ' + perS + ')');
  ok(res.pan.p95 <= 250, 'pan frame p95 <= 250 ms (got ' + res.pan.p95 + ')');
}
try { fs.unlinkSync(out); } catch (e) {}
process.exit(fail ? 1 : 0);
