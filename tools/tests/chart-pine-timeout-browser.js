// Pine "times out / won't load" sweep (member report 22 Nov 2026, custom scripts pasted from public libraries).
// Runs every tools/tests/fixtures/pine/timeout/*.pine through the real Charts engine path (STRYKER_PINE.runOnChart,
// the same call the editor's Add to chart makes) on futures:NQ1! at 1m and 5m, demo account (richstub), and records
// load time + outcome. Pass bar: on 5m every script either loads in under LIMIT_MS (10 s) or shows a clear reason
// (a message that is not the generic "heavy / did not finish" timeout).
//   node tools/tests/chart-dev-server.mjs 8077 &   # serves this worktree
//   CHART_BASE=http://127.0.0.1:8077 flock /tmp/stryker-chrome.lock node tools/tests/chart-pine-timeout-browser.js
// Safari bug (UnoMas 22 Nov): PW_BROWSER=webkit|firefox runs it on that engine (tools/tests/lib.js); SHARED=1 runs
// the community-script path (classic worker first). 00-v5-simple-sma must plot in under FAST_MS (3 s).
// Env: DEEP=5000 (bars to load first; default = what the page loads), TFS=5,1 (default "5,1"), ONLY=03,07 (file prefixes), JSON_OUT=<file>, LIMIT_MS=10000.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const fs = require('fs');
const path = require('path');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8077';
const DIR = path.join(__dirname, 'fixtures', 'pine', 'timeout');
const TFS = (process.env.TFS || '5,1').split(',');
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const LIMIT = Number(process.env.LIMIT_MS || 10000);
const SHARED = process.env.SHARED === '1';
const FAST_MS = Number(process.env.FAST_MS || 3000);
const FAST = new Set(['00-v5-simple-sma.pine']);
const DEEP = Number(process.env.DEEP || 0);   // load this many bars first (chart.setMarket({ bars })), e.g. 5000
// Expected outcome per fixture: 'ok' must load; 'reason' must fail with a clear message (never the timeout).
const EXPECT = { '10-v5-import-library.pine': 'reason', '13-v4-classic.pine': 'reason' };
const TIMEOUT_MSG = /heavy for this device|did not finish|took too long|stopped making progress|^Syntax error: Unexpected token KEYWORD 'import'|^Unsupported Pine Script version/i;

(async () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.pine') && (!ONLY.length || ONLY.some((o) => f.startsWith(o)))).sort();
  const b = await launch();
  const out = [];
  let fails = 0;
  try {
    for (const tf of TFS) {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      await ctx.addInitScript(stub);
      await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
      await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
      const p = await ctx.newPage();
      p.on('pageerror', (e) => console.log('PAGEERROR ' + String(e).slice(0, 200)));
      await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_PINE, null, { timeout: 60000 });
      await p.evaluate((tf) => { const c = window.STRYKER_VELA.cell(window.STRYKER_VELA.context().cells[0].id); c.setSymbol('futures:NQ1!'); c.setTimeframe(tf); }, tf);
      const nb = await p.evaluate(async (DEEP) => {
        let n = 0;
        for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 500)); try { n = window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length; if (n > 300 && i > 6) break; } catch (e) {} }
        if (DEEP) { const ch = window.STRYKER_VELA.context().cells[0].chart; await ch.setMarket({ bars: DEEP }); await ch.historyComplete(); n = ch.orchestrator.rawBars.length; }
        return n;
      }, DEEP);
      console.log(`== ${process.env.PW_BROWSER || 'chromium'} ${SHARED ? 'shared' : 'own'} ${tf}m  bars=${nb}`);
      for (const f of files) {
        const src = fs.readFileSync(path.join(DIR, f), 'utf8');
        const r = await p.evaluate(async ([src, SHARED]) => {
          const P = window.STRYKER_PINE;
          const chart = window.STRYKER_VELA.context().cells[0].chart;
          P.pineHandles(chart).forEach((h) => h.remove());
          await new Promise((r) => setTimeout(r, 300));
          const t0 = performance.now();
          let res;
          try { res = await P.runOnChart(chart, src, undefined, SHARED, { inline: true }); } catch (e) { res = { ok: false, msg: 'THREW ' + e.message }; }
          const ms = Math.round(performance.now() - t0);
          let drawn = '';
          if (res.ok) {
            try { const i = chart.inspect().indicators.find((x) => x.id === res.handle.id) || {}; drawn = ['series', 'lines', 'boxes', 'labels', 'tables'].map((k) => k[0] + Object.keys(i[k] || {}).length).join(' '); } catch (e) {}
          }
          return { ok: !!res.ok, ms, engine: res.engine || '', msg: res.msg || '', line: res.line || null, heavy: !!res.heavy, drawn };
        }, [src, SHARED]);
        const want = EXPECT[f] || 'ok';
        const clear = !r.ok && r.msg && !TIMEOUT_MSG.test(r.msg);
        const pass = tf !== '5' ? true : (want === 'ok' ? (r.ok && r.ms < (FAST.has(f) ? FAST_MS : LIMIT) && (!FAST.has(f) || /^s[1-9]/.test(r.drawn))) : clear);
        if (!pass) fails++;
        out.push({ tf, file: f, ...r, pass });
        console.log(`${pass ? 'PASS' : 'FAIL'} ${tf}m ${f.padEnd(34)} ${String(r.ms).padStart(6)}ms ${r.ok ? 'OK ' + r.engine + ' ' + r.drawn : 'ERR ' + (r.line ? 'Line ' + r.line + ': ' : '') + r.msg}`);
      }
      await ctx.close();
    }
  } finally { await b.close(); }
  if (process.env.JSON_OUT) fs.writeFileSync(process.env.JSON_OUT, JSON.stringify(out, null, 1));
  console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
