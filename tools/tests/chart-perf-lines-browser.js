// Line-plot frame cost, old vs new engine folder (upstream 0.10.9 "many line plots pan and zoom about three times faster").
//   node tools/tests/chart-dev-server.mjs 8137 &
//   CHART_BASE=http://127.0.0.1:8137 tools/chrome-slot.sh node tools/tests/chart-perf-lines-browser.js <outDir> [oldEng] [newEng]
// Bare engine page (tools/tests/perf-bare-vela.html) with LINES EMA lines (default 20), same recorded NQ bars as
// chart-perf-pan.js. Per engine, per viewport (1440 desktop, 390 phone emulation @3x):
//   - frame cost: the median wall time of one full chart frame (the renderer's own synchronous flush + gl.finish), at
//     the default view (180 bars) and zoomed out (1500 bars), while panning (1 bar per frame) and zooming;
//   - pixels: a screenshot at the same view on both engines, compared byte for byte (must be identical).
// PASS = new engine's pan and zoom frame cost lower than old at both widths, and every pixel compare identical.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { launch } = require('./lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8137';
const OUT = process.argv[2] || '.';
const OLD = process.argv[3] || 'vela-0.9.0-s11';
const NEW = process.argv[4] || 'vela-0.9.0-s14';
const LINES = +(process.env.LINES || 20);
const FIX = path.join(__dirname, 'fixtures');
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };

// Bars: the recorded NQ days (fixtures/orderflow), fixed timestamps so both engines see the same chart.
const readUv = (b, i) => { let x = 0, s = 1, c; do { c = b[i++]; x += (c & 127) * s; s *= 128; } while (c & 128); return [x, i]; };
let CANDLES = null;
async function candles() {
  if (CANDLES) return CANDLES;
  const D = await import(path.resolve(__dirname, '../../assets/chart-footprint-data.js'));
  CANDLES = [];
  for (const f of ['NQ-2026-10-20', 'NQ-2026-10-21']) {
    const u8 = new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(FIX, 'orderflow', f + '.bin.gz'))));
    for (const b of D.decodeOrderflow(u8).bars) CANDLES.push([b.t / 1000, b.o * 0.25, b.hi * 0.25, b.lo * 0.25, b.c * 0.25, b.vol]);
  }
  return CANDLES;
}

async function openEng(b, eng, vw, vh, mob) {
  const ctx = await b.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: mob ? 3 : 1, isMobile: mob, hasTouch: mob });
  const bars = await candles(), LAST_T = bars[bars.length - 1][0];
  await ctx.addInitScript((t) => { const RealNow = Date.now; const d = RealNow() - (t * 1000 + 60000); Date.now = () => RealNow() - d; }, LAST_T);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await ctx.route(/\/api\/chart\/bars\//, (r) => {
    const u = new URL(r.request().url()), page = Number(u.searchParams.get('page')) || 0, P = 8 * 3600;
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: '1', page, bars: page ? bars.filter((x) => Math.floor(x[0] / P) === page) : bars }) });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await p.goto(`${BASE}/tools/tests/perf-bare-vela.html?eng=${eng}&lines=${LINES}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__perfLines > 0, null, { timeout: 90000 });
  await p.waitForTimeout(4000);
  return { ctx, p, errors };
}

// Visible span of `bars` bars ending at the newest bar (the renderer's own instant viewport set).
const VIEW = (bars) => { const rr = window.STRYKER_VELA.cell(window.STRYKER_VELA.active.id).chart.renderer.renderer; rr.applyViewport({ barSpacing: rr.coords.width / bars, rightOffset: 3 }); };

// Full chart frames, synchronously (Scheduler.flushNow(Full) = what a pan/zoom rAF runs), timed with gl.finish().
// `mode`: still (same view) | pan (1 bar per frame) | zoom (span grows and shrinks).
const BENCH = ([bars, mode, frames]) => {
  const rr = window.STRYKER_VELA.cell(window.STRYKER_VELA.active.id).chart.renderer.renderer;
  const be = rr.backend, W = rr.coords.width;
  if (!be || be.kind === 'canvas2d' || !be.gl) return { err: 'no webgl backend', kind: be && be.kind };
  const times = [];
  for (let f = 0; f < frames; f++) {
    let span = bars, ro = 3;
    if (mode === 'pan') ro = 3 - (f % 60);
    if (mode === 'zoom') { const k = (f % 40) < 20 ? f % 20 : 20 - (f % 20); span = Math.round(bars * (1 + k / 20)); }
    rr.applyViewport({ barSpacing: W / span, rightOffset: ro });
    const t0 = performance.now();
    rr.scheduler.flushNow(4);
    be.gl.finish();
    times.push(performance.now() - t0);
  }
  times.sort((x, y) => x - y);
  return { med: +times[times.length >> 1].toFixed(2), p90: +times[Math.floor(times.length * 0.9)].toFixed(2), lines: rr.scene.indicators.size, bs: +rr.coords.getViewport().barSpacing.toFixed(3) };
};

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=1024'] });
  const res = {};
  try {
    for (const [vw, vh, mob] of [[1440, 900, false], [390, 844, true]]) {
      const shots = {};
      for (const eng of [OLD, NEW]) {
        const { ctx, p, errors } = await openEng(b, eng, vw, vh, mob);
        const r = {};
        for (const [label, bars] of [['default', 180], ['zoomedOut', 1500]]) {
          for (const mode of ['still', 'pan', 'zoom']) {
            await p.evaluate(BENCH, [bars, mode, 20]);   // warm-up
            const runs = [];
            for (let k = 0; k < 3; k++) runs.push(await p.evaluate(BENCH, [bars, mode, 80]));
            runs.sort((x, y) => x.med - y.med);
            r[label + '.' + mode] = runs[1];
          }
        }
        // pixels: same view, let the normal frame loop draw it, then shoot the plot.
        await p.evaluate(VIEW, 400); await p.waitForTimeout(1500);
        const f = path.join(OUT, `perf-lines-${eng}-${vw}.png`);
        // clip to the plot canvas: the bottom bar's clock ticks between the two engines' shots
        const clip = await p.evaluate(() => { const c = [...document.querySelectorAll('#vela-chart canvas')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0].getBoundingClientRect(); return { x: c.left, y: c.top, width: c.width, height: c.height }; });
        await p.screenshot({ path: f, clip });
        shots[eng] = fs.readFileSync(f);
        r.errors = errors;
        res[eng + '@' + vw] = r;
        console.log(eng + '@' + vw, JSON.stringify(r));
        await ctx.close();
      }
      check(Buffer.compare(shots[OLD], shots[NEW]) === 0, `${vw}: ${LINES} lines, screenshot identical on ${OLD} and ${NEW}`, { a: shots[OLD].length, b: shots[NEW].length });
      for (const k of ['default.pan', 'default.zoom', 'zoomedOut.pan', 'zoomedOut.zoom']) {
        const o = res[OLD + '@' + vw][k], n = res[NEW + '@' + vw][k];
        check(n.med < o.med, `${vw}: ${k} frame ${o.med} -> ${n.med} ms (x${(o.med / n.med).toFixed(2)} faster)`, { lines: n.lines });
      }
      check(!res[NEW + '@' + vw].errors.length, `${vw}: no page errors`, res[NEW + '@' + vw].errors);
    }
  } finally { await b.close(); }
  fs.writeFileSync(path.join(OUT, 'perf-lines.json'), JSON.stringify(res, null, 1));
  console.log(fail ? `FAILED ${fail}` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
