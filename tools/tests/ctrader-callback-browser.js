// cTrader callback page in a real browser: each failure shows its plain reason, centred, at 390/412/1440, dark + light.
// Fake Firebase user and fake cTrader modules (routes); nothing leaves the machine. Shots go to $SHOTS (default: scratch).
// Run: python3 -m http.server 8000 (repo root) then node tools/tests/ctrader-callback-browser.js
const { launch, BASE } = require('./lib.js');
const fs = require('fs');
const OUT = process.env.SHOTS || (process.env.TMPDIR || '/tmp') + '/ctcb';
fs.mkdirSync(OUT, { recursive: true });
const FB = `window.firebase={auth:()=>({onAuthStateChanged:(f)=>setTimeout(()=>f({uid:'u1',getIdToken:async()=>'IDT'}),10)}),initializeApp(){},apps:[1]};`;
const CASES = {
  rejected: `export const takeTradeState=()=>true;export const swapTradeCode=async()=>{throw Object.assign(new Error('x'),{status:400,code:'rejected',upstream:'ACCESS_DENIED'})};export const saveTradeCreds=async()=>{};`,
  scope: `export const takeTradeState=()=>true;export const swapTradeCode=async()=>({access:'A',kind:'trade'});export const saveTradeCreds=async()=>{};`,
};
const CT = { rejected: `export const listAccounts=async()=>[];`, scope: `export const listAccounts=async()=>Object.assign([{id:1,isLive:false}],{scope:0});` };
(async () => {
  const b = await launch(); let fails = 0;
  for (const kase of Object.keys(CASES)) for (const theme of ['dark', 'light']) for (const w of [390, 412, 1440]) {
    const p = await b.newPage({ viewport: { width: w, height: w === 1440 ? 900 : 844 } });
    const logs = []; p.on('console', (m) => logs.push(m.text()));
    await p.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ contentType: 'text/javascript', body: /auth-compat/.test(r.request().url()) ? '' : FB }));
    await p.route(/\/assets\/auth\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
    await p.route(/\/assets\/ctrader-trade\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: CASES[kase] }));
    await p.route(/\/assets\/byo-ctrader\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: CT[kase] }));
    await p.route(/\/assets\/byo-core\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: 'export const bindUser=async()=>{};' }));
    await p.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
    await p.goto(BASE + '/ctrader-callback.html?code=ONETIMECODE123&state=S1');
    await p.waitForFunction(() => !document.getElementById('ct-a').hidden, null, { timeout: 8000 });
    const m = await p.evaluate(() => {
      const r = (id) => document.getElementById(id).getBoundingClientRect();
      const h = r('ct-h'), q = r('ct-p'), a = r('ct-a'), box = document.getElementById('ct-h').parentElement.getBoundingClientRect();
      return { h: document.getElementById('ct-h').textContent, p: document.getElementById('ct-p').textContent, cx: [h.left + h.width / 2, q.left + q.width / 2, a.left + a.width / 2, box.left + box.width / 2, innerWidth / 2], hscroll: document.documentElement.scrollWidth > innerWidth, url: location.search, aH: a.height, aR: a.right, vw: innerWidth };
    });
    const centred = Math.max(...m.cx) - Math.min(...m.cx) <= 1;
    const leak = logs.join(' ').includes('ONETIMECODE123');
    const ok = centred && !m.hscroll && !m.url && !leak && m.aR <= m.vw && (kase === 'rejected' ? /didn’t accept the sign-in/.test(m.p) : /isn’t allowed to trade yet/.test(m.p));
    if (!ok) fails++;
    const shot = `${OUT}/cb-${kase}-${theme}-${w}.png`; await p.screenshot({ path: shot });
    console.log(ok ? 'ok' : 'FAIL', kase, theme, w, JSON.stringify({ h: m.h, p: m.p, centredSpread: +(Math.max(...m.cx) - Math.min(...m.cx)).toFixed(2), hscroll: m.hscroll, btnH: m.aH }), logs.filter((l) => l.includes('[ctrader-callback]'))[0] || '', shot);
    await p.close();
  }
  await b.close();
  console.log(fails ? 'FAILED ' + fails : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
