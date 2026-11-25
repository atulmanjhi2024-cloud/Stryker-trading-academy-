// Browser regression: a NON-admin member opens the chart's "Connect your broker" dialog and taps MetaTrader 5 (and every tile).
// Real server handlers run in Node behind a STALE edge Worker stub (answers "Admin only", as the live one did); broker + token are stubs.
// No network, no order. Usage: node tools/tests/mt-connect-member-browser.js [outDir]   (set MT_BEFORE=1 to skip the fix: shows the bug)
const fs = require('fs'), path = require('path');
const { launch, ROOT } = require('./lib');
(async () => {
  const out = process.argv[2] || path.join(ROOT, 'tmp-mt-shots'); fs.mkdirSync(out, { recursive: true });
  const { generateKeyPairSync, createSign } = require('crypto');
  const F = await import(path.join(ROOT, 'functions/connect/finatic/_fin.js')), S = await import(path.join(ROOT, 'functions/connect/finatic/session.js')), D = await import(path.join(ROOT, 'functions/connect/finatic/data.js'));
  const { memStore } = await import(path.join(ROOT, 'tests/finatic/_store.mjs'));
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000), h = b64({ alg: 'RS256', kid: 'k1' }), p = b64({ iss: 'https://securetoken.google.com/strykertrades-e0cd8', aud: 'strykertrades-e0cd8', sub: 'memberMT', user_id: 'memberMT', iat: now - 5, exp: now + 3000 });
  const tok = h + '.' + p + '.' + createSign('RSA-SHA256').update(h + '.' + p).sign(privateKey, 'base64url');
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const verifyFetch = async (u) => String(u).includes('jwk/securetoken') ? new Response(JSON.stringify({ keys: [jwk] })) : new Response('{}', { status: 404 });
  const ok = (d) => new Response(JSON.stringify({ data: d, errors: [] }));
  const finFetch = async (u) => { const x = new URL(u).pathname; if (x === '/api/v1/session/init') return ok({ one_time_token: 't' }); if (x === '/api/v1/session/start') return ok({ session_id: 's1', company_id: 'c', status: 'pending', user_id: '' }); if (x === '/api/v1/session/portal') return ok({ portal_url: 'https://portal.finatic.dev/?t=x' }); return ok([]); };
  const deps = { store: memStore(), verifyFetch, finFetch, sleep: async () => {} };
  const env = { FINATIC_API_KEY: 'fntc_live_FAKE', DEV: '0' };
  const stale = { fetch: async () => F.json({ error: 'Admin only', code: 'forbidden' }, 403) };
  const entries = { session: F.pagesEntry((rq, e, d) => S.handle(rq, e, { ...deps, ...d })), data: F.pagesEntry((rq, e, d) => D.handle(rq, e, { ...deps, ...d })) };
  const BEFORE = !!process.env.MT_BEFORE;
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.html': 'text/html' };
  const browser = await launch(); const results = [];
  for (const [theme, w, hgt] of [['dark', 1440, 900], ['light', 1440, 900], ['dark', 390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: hgt } }), page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (process.env.DBG) console.log('[c]', m.text().slice(0, 200)); });
    await ctx.route('https://tradezoro.com/**', async (route) => {
      const rq = route.request(), u = new URL(rq.url());
      const m = u.pathname.match(/^\/connect\/finatic\/(session|data)$/);
      if (u.pathname === '/connect/finatic/session' && rq.method() === 'GET') return route.fulfill({ contentType: 'application/json', body: '{"configured":true}' });
      if (m) {
        const hd = { ...rq.headers(), origin: 'https://tradezoro.com', 'content-type': 'application/json', 'cf-connecting-ip': '10.1.1.' + Math.floor(Math.random() * 250) };
        const e = BEFORE ? { ...env, FINATIC_EDGE: { fetch: stale.fetch } } : { ...env, FINATIC_EDGE: stale };
        let r;
        if (BEFORE) { r = await stale.fetch(); } else r = await entries[m[1]]({ request: new Request(rq.url(), { method: 'POST', headers: hd, body: rq.postData() }), env: e });
        return route.fulfill({ status: r.status, headers: { 'content-type': 'application/json' }, body: await r.text() });
      }
      if (u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html data-theme="' + theme + '"><body style="background:' + (theme === 'dark' ? '#0b0e13' : '#f4f6f9') + ';margin:0"><div style="padding:20px;font:14px sans-serif;color:#888">Chart (sample)</div></body></html>' });
      const f = path.join(ROOT, u.pathname.replace(/\.\./g, ''));
      if (fs.existsSync(f) && fs.statSync(f).isFile()) return route.fulfill({ contentType: mime[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
      return route.fulfill({ status: 404, body: '' });
    });
    await page.goto('https://tradezoro.com/');
    await page.evaluate((t) => { window.auth = { currentUser: { getIdToken: async () => t } }; window.db = {}; window.firebase = {}; window.showToast = () => {}; }, tok);
    await page.evaluate(() => { window.open = () => ({ close() {}, location: {} }); });
    await page.evaluate(() => import('/assets/finatic-journal-ui.js?v=1261').then((m) => m.openBrokerSync({ uid: 'memberMT', mode: 'chart', portal: true, onConnected() {} })));
    await page.waitForSelector('.fjs-tile');
    const ids = await page.$$eval('.fjs-tile', (t) => t.map((x) => x.dataset.broker));
    // tap MT5 first, shoot the result
    await page.click('[data-broker="metatrader-5"]'); await page.waitForTimeout(800);
    const step = await page.evaluate(() => window.STRYKER_BROKER_SYNC && window.STRYKER_BROKER_SYNC.step);
    const errTxt = await page.evaluate(() => { const e = document.querySelector('#fjs .rjs-err'); return e ? e.textContent : ''; });
    await page.screenshot({ path: path.join(out, (BEFORE ? 'before' : 'after') + '-' + w + '-' + theme + '.png') });
    const r = { theme, w, tiles: ids.length, mt5Step: step, banner: errTxt, jsErrors: errs };
    if (!BEFORE) {   // every other tile also gets through, and the grid has no overflow at 390
      r.others = {};
      for (const id of ids) { if (id === 'metatrader-5') continue; await page.evaluate(() => { const b = document.querySelector('#fjs-again'); if (b) b.click(); }); await page.waitForSelector('.fjs-tile'); await page.click('[data-broker="' + id + '"]'); await page.waitForTimeout(400); r.others[id] = await page.evaluate(() => window.STRYKER_BROKER_SYNC.step + '|' + ((document.querySelector('#fjs .rjs-err') || {}).textContent || '')); }
      r.hscroll = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    }
    results.push(r); await ctx.close();
  }
  await browser.close(); console.log(JSON.stringify(results, null, 1));
  if (!BEFORE) { for (const r of results) { if (r.mt5Step !== 'wait' || r.banner || r.jsErrors.length || r.hscroll) { console.error('FAIL', r.theme, r.w); process.exit(1); } for (const [k, v] of Object.entries(r.others)) if (v !== 'wait|') { console.error('FAIL tile', k, v); process.exit(1); } } console.log('mt-connect-member: ok'); }
})().catch((e) => { console.error(e); process.exit(1); });
