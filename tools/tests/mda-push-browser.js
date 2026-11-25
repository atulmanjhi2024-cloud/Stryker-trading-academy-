// Discord bug 24 Nov (jgray1976, Mac desktop app 2.0.1): "Accept and continue" on the Market Data Agreement showed
// "Registration failed - push service not available" and nothing was saved.
// Cause: the Firebase Functions SDK attaches a push (FCM) token to every callable when firebase-messaging-compat is on the page and
// Notification.permission is 'granted'. Where the browser has no push service (Electron desktop app, some Chromium builds) that
// getToken() REJECTS and the SDK fails the whole call with the browser's AbortError. Fix: assets/auth.js tzSafeFunctions().
//
// This drives the REAL Firebase compat SDKs (gstatic) + the real assets/auth.js + assets/market-data-agreement.js on a local page,
// with notifications granted and a push service that fails like the desktop app's (PushManager.subscribe -> AbortError), under the
// desktop app's user agent. The callable endpoint is intercepted (no live write). Checks:
//   1. the agreement saves (callable reached, onDone ran)  2. no raw browser error is ever shown
//   3. a server failure shows the friendly text  4. a server validation message (HttpsError) is still shown as is
//   5. an already-signed member (students/{uid}.marketDataAgreement current) is not prompted again
//
//   node tools/tests/mda-push-browser.js [outdir]     (needs the local http.server, see lib.js; run.js starts one)
const fs = require('fs');
const path = require('path');
const { launch, BASE } = require('./lib');

const OUT = process.argv[2] || path.join(process.env.TMPDIR || '/tmp', 'mda-push-shots');
fs.mkdirSync(OUT, { recursive: true });
// the Mac desktop app's UA after desktop/src/main.js strips "Electron/x" (it still says Chrome); PushManager exists but push fails
const MAC_APP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const FN_URL = 'https://us-central1-strykertrades-e0cd8.cloudfunctions.net/acceptMarketDataAgreement';
const V = '10.14.1';
const PAGE = (extra) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/assets/style.css"></head><body style="background:#0b0b0d">
<script src="https://www.gstatic.com/firebasejs/${V}/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/${V}/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/${V}/firebase-functions-compat.js"></script>
<script src="/assets/auth.js"></script>
<script src="https://www.gstatic.com/firebasejs/${V}/firebase-messaging-compat.js"></script>
<script>firebase.messaging();</script>
<script src="/assets/market-data-agreement.js"></script>
${extra || ''}
</body></html>`;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };

async function fillAndSubmit(page) {
  await page.evaluate(() => { document.querySelectorAll('.mda-scrim').forEach((s) => s.remove()); window.__done = 0; window.StkMDA.modal(() => { window.__done++; }); });
  await page.waitForSelector('.mda-btn');
  for (const q of ['regulated', 'business', 'advisor', 'redistribute']) await page.click(`input[name="mda-${q}"][value="no"]`, { force: true });
  await page.check('.mda-c');
  await page.fill('.mda-name', 'Sample Member');
  await page.click('.mda-btn');
}

(async () => {
  const browser = await launch();
  try {
    for (const vw of [1440, 390]) {
      const ctx = await browser.newContext({ userAgent: MAC_APP_UA, viewport: { width: vw, height: vw > 500 ? 900 : 844 } });
      await ctx.grantPermissions(['notifications'], { origin: BASE });
      // Push service unavailable, exactly the desktop app's error (also what a headless shell does on its own)
      await ctx.addInitScript(() => {
        if (window.PushManager) PushManager.prototype.subscribe = function () { return Promise.reject(new DOMException('Registration failed - push service not available', 'AbortError')); };
      });
      let mode = 'ok', calls = 0, sawFcmHeader = false;
      await ctx.route('**/*', (route) => {
        const u = route.request().url();
        if (u.startsWith(BASE) || u.startsWith('https://www.gstatic.com/firebasejs/')) return route.continue();
        if (u === FN_URL) {
          if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
          calls++; if (route.request().headers()['firebase-instance-id-token']) sawFcmHeader = true;
          const h = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
          if (mode === 'ok') return route.fulfill({ status: 200, headers: h, body: JSON.stringify({ result: { ok: true, version: 'v1' } }) });
          if (mode === 'invalid') return route.fulfill({ status: 400, headers: h, body: JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'Type your full name to sign.' } }) });
          return route.fulfill({ status: 500, headers: h, body: JSON.stringify({ error: { status: 'INTERNAL', message: 'INTERNAL' } }) });
        }
        return route.abort();
      });
      await ctx.route(BASE + '/__mda-test.html', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: PAGE() }));
      const page = await ctx.newPage();
      const logs = []; page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
      await page.goto(BASE + '/__mda-test.html');
      await page.waitForFunction(() => window.StkMDA && window.firebase && firebase.apps.length);
      ok(await page.evaluate(() => Notification.permission === 'granted' && 'PushManager' in window), vw + ': push looks supported + granted (the failing case)');

      // 1 + 2: saves
      await fillAndSubmit(page);
      await page.waitForFunction(() => window.__done > 0 || !document.querySelector('.mda-err').hidden, null, { timeout: 15000 }).catch(() => {});
      const err1 = await page.evaluate(() => { const e = document.querySelector('.mda-err'); return e && !e.hidden ? e.textContent : ''; });
      if (err1) await page.screenshot({ path: path.join(OUT, `fail-${vw}.png`) });
      ok(await page.evaluate(() => window.__done === 1), `${vw}: agreement saved (onDone ran), shown error: "${err1}"`);
      ok(calls === 1, `${vw}: callable reached once (${calls})`);
      ok(!sawFcmHeader, `${vw}: no push token header sent`);
      ok(!/push service|Registration failed/i.test(err1), `${vw}: no raw push error shown`);

      // 3: server failure -> friendly text, raw text only in the console
      mode = 'fail'; await fillAndSubmit(page);
      await page.waitForFunction(() => { const e = document.querySelectorAll('.mda-err'); const l = e[e.length - 1]; return l && !l.hidden; }, null, { timeout: 15000 }).catch(() => {});
      const err2 = await page.evaluate(() => { const e = document.querySelectorAll('.mda-err'); return e[e.length - 1].textContent; });
      ok(err2 === "Couldn't save just now. Please try again.", `${vw}: server failure shows the friendly text ("${err2}")`);
      await page.screenshot({ path: path.join(OUT, `mda-error-${vw}.png`) });
      ok(logs.some((l) => /market data agreement/i.test(l)), `${vw}: real error logged to the console`); if (vw === 1440) console.log('  console:', logs.filter((l) => /agreement|guard/i.test(l)).slice(0, 3).join(' | '));

      // 4: validation message from the server stays readable
      mode = 'invalid';
      await page.evaluate(() => document.querySelectorAll('.mda-scrim').forEach((s) => s.remove()));
      await fillAndSubmit(page);
      await page.waitForFunction(() => { const e = document.querySelectorAll('.mda-err'); const l = e[e.length - 1]; return l && !l.hidden; }, null, { timeout: 15000 }).catch(() => {});
      const err3 = await page.evaluate(() => { const e = document.querySelectorAll('.mda-err'); return e[e.length - 1].textContent; });
      ok(err3 === 'Type your full name to sign.', `${vw}: server validation text kept ("${err3}")`);
      await page.close();

      // 5: already signed -> no prompt (autoPrompt), unsigned liveFeed member -> prompt
      for (const signed of [true, false]) {
        const p2 = await ctx.newPage();
        const stub = `<script>window.__sd=${JSON.stringify({ liveFeed: true, marketDataAgreement: signed ? { version: 'v1', nonProfessional: true } : undefined })};
          window.db={collection:()=>({doc:()=>({get:()=>Promise.resolve({exists:true,data:()=>window.__sd})})})};
          window.auth={onAuthStateChanged:(cb)=>{setTimeout(()=>cb({uid:'u1'}),10);return()=>{};}};</script>
          <script src="/assets/market-data-agreement.js" data-mda-auto="1"></script>`;
        await ctx.route(BASE + '/__mda-auto.html', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><body>${stub}</body></html>` }));
        await p2.goto(BASE + '/__mda-auto.html'); await p2.waitForTimeout(2200);
        const shown = await p2.evaluate(() => !!document.querySelector('.mda-scrim'));
        ok(shown === !signed, `${vw}: ${signed ? 'signed member not prompted' : 'unsigned live member prompted'}`);
        // the banner / Settings path (StkMDA.modal): a signed member gets onDone, never the form again
        const m = await p2.evaluate(() => new Promise((res) => { document.querySelectorAll('.mda-scrim').forEach((s) => s.remove()); window.auth.currentUser = { uid: 'u1' };
          let done = false; window.StkMDA.modal(() => { done = true; }); setTimeout(() => res({ done, form: !!document.querySelector('.mda-scrim') }), 300); }));
        ok(signed ? (m.done && !m.form) : (!m.done && m.form), `${vw}: modal() ${signed ? 'skips the form for a signed member' : 'shows the form to an unsigned member'} ${JSON.stringify(m)}`);
        await ctx.unroute(BASE + '/__mda-auto.html'); await p2.close();
      }
      // shot of the filled form at this width (design check)
      const p3 = await ctx.newPage(); await p3.goto(BASE + '/__mda-test.html'); await p3.waitForFunction(() => window.StkMDA);
      mode = 'fail'; await fillAndSubmit(p3);
      await p3.waitForFunction(() => !document.querySelector('.mda-err').hidden, null, { timeout: 15000 }).catch(() => {});
      await p3.evaluate(() => { const d = document.querySelector('.mda-dlg'); d.scrollTop = d.scrollHeight; });
      await p3.screenshot({ path: path.join(OUT, `mda-friendly-${vw}.png`) });
      const geo = await p3.evaluate(() => { const b = document.querySelector('.mda-btn').getBoundingClientRect(), e = document.querySelector('.mda-err').getBoundingClientRect(), d = document.querySelector('.mda-dlg');
        return { overflowX: document.documentElement.scrollWidth > innerWidth, errInside: e.left >= d.getBoundingClientRect().left && e.right <= d.getBoundingClientRect().right, btnW: b.width, errW: e.width, errLines: Math.round(e.height / 17) }; });
      ok(!geo.overflowX && geo.errInside, `${vw}: no horizontal scroll, error text inside the dialog ${JSON.stringify(geo)}`);
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(`\n${pass} passed, ${fail} failed. Shots: ${OUT}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
