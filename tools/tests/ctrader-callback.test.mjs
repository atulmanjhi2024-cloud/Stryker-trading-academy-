// cTrader sign-in return page (assets/ctrader-callback.js): each failure step shows its own plain reason and logs the step to the
// console (never a token or the one-time code). Fake DOM, fake Firebase, fake modules. No network. Run: node tools/tests/ctrader-callback.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../../assets/ctrader-callback.js', import.meta.url), 'utf8').replace(/\bimport\(/g, '__imp(');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CODE = 'ONETIMECODE123', TOKEN = 'ACCESSTOKENsecret1';

// mods: { tr, ct, c } overrides. kind 'trade' (Allow trading) or 'data' (Data source)
async function run(kind, over = {}) {
  const el = () => ({ textContent: '', hidden: true, after() {}, remove() {} });
  const els = { 'ct-h': el(), 'ct-p': el(), 'ct-a': el() }, logs = [], replaced = [];
  const creds = { access: TOKEN, refresh: 'REFRESHsecret1', exp: Date.now() + 1e9 };
  const accounts = Object.assign([{ id: 11, isLive: false, login: 5551234, broker: 'Demo broker' }], { scope: 1 });
  const tr = { takeTradeState: () => kind === 'trade', swapTradeCode: async () => ({ ...creds, kind: 'trade' }), saveTradeCreds: async () => {}, ...(over.tr || {}) };
  const ct = { takeCtraderState: () => (kind === 'data' ? {} : null), ctraderTokenCall: async () => ({ access_token: TOKEN }), ctraderCreds: () => ({ ...creds }), listAccounts: async () => accounts, ...(over.ct || {}) };
  const c = { bindUser: async () => {}, saveSource: async () => {}, ...(over.c || {}) };
  const ctx = {
    URLSearchParams, Promise, JSON, String, Date, setTimeout, clearTimeout,
    location: { search: '?code=' + CODE + '&state=S1', pathname: '/connect/ctrader/callback', replace: (u) => replaced.push(u) },
    history: { replaceState() {} },
    localStorage: { setItem() {} },
    document: { getElementById: (id) => els[id], createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }) },
    console: { warn: (...a) => logs.push(a.join(' ')), log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) },
    firebase: { auth: () => ({ onAuthStateChanged: (fn) => fn({ uid: 'u1', getIdToken: async () => 'IDTOKEN' }) }) },
    __imp: async (p) => (/byo-core/.test(p) ? c : /byo-ctrader/.test(p) ? ct : tr)
  };
  vm.runInNewContext(SRC, ctx);
  await sleep(30);
  const out = { h: els['ct-h'].textContent, p: els['ct-p'].textContent, shown: !els['ct-a'].hidden, logs, replaced };
  assert.ok(!logs.join(' ').includes(TOKEN) && !logs.join(' ').includes(CODE) && !logs.join(' ').includes('REFRESHsecret1'), 'console never shows a token or the code');
  return out;
}
const err = (o) => Object.assign(new Error('x'), o);
const stepOf = (r) => { const l = r.logs.find((x) => x.startsWith('[ctrader-callback]')); return l ? JSON.parse(l.slice(l.indexOf('{'))) : null; };

await t('Allow trading: success saves the trading creds and goes back to the charts', async () => {
  let saved = null; const r = await run('trade', { tr: { saveTradeCreds: async (x) => { saved = x; } } });
  assert.deepEqual(r.replaced, ['/charts']); assert.equal(saved.accountId, 11); assert.equal(saved.kind, 'trade');
});
await t('token step: cTrader refused the code -> "didn\'t accept the sign-in", step + cTrader error code logged', async () => {
  const r = await run('trade', { tr: { swapTradeCode: async () => { throw err({ status: 400, code: 'rejected', upstream: 'ACCESS_DENIED' }); } } });
  assert.equal(r.h, 'Trading was not allowed'); assert.equal(r.p, 'cTrader didn’t accept the sign-in. Please try again.'); assert.ok(r.shown);
  assert.deepEqual(stepOf(r), { kind: 'trade', step: 'token', status: 400, code: 'rejected', upstream: 'ACCESS_DENIED', closeCode: null });
});
await t('token step: cTrader down / our function failed (the 24 Nov live bug) -> "didn\'t answer"', async () => {
  const r = await run('trade', { tr: { swapTradeCode: async () => { throw err({ status: 503, code: 'upstream' }); } } });
  assert.equal(r.p, 'cTrader didn’t answer. Please try again in a minute.'); assert.equal(stepOf(r).step, 'token');
});
await t('token step: not set up, rate limit, TradeZoro sign-in expired', async () => {
  assert.equal((await run('trade', { tr: { swapTradeCode: async () => { throw err({ status: 503, code: 'not_set_up' }); } } })).p, 'cTrader isn’t set up on TradeZoro yet.');
  assert.equal((await run('trade', { tr: { swapTradeCode: async () => { throw err({ status: 429, code: 'rate' }); } } })).p, 'Too many tries. Wait a minute, then try again.');
  assert.equal((await run('trade', { tr: { swapTradeCode: async () => { throw err({ status: 401, code: 'auth' }); } } })).p, 'Your TradeZoro sign-in expired. Sign in again, then try again.');
});
await t('accounts step: token is view-only (app has no trading permission) -> "isn\'t allowed to trade yet", nothing saved', async () => {
  let saved = false; const r = await run('trade', { tr: { saveTradeCreds: async () => { saved = true; } }, ct: { listAccounts: async () => Object.assign([{ id: 11, isLive: false }], { scope: 0 }) } });
  assert.equal(r.h, 'Trading isn’t switched on'); assert.equal(r.p, 'This cTrader app isn’t allowed to trade yet.'); assert.equal(saved, false); assert.deepEqual(r.replaced, []);
  assert.deepEqual(stepOf(r), { kind: 'trade', step: 'accounts', status: null, code: 'scope', upstream: null, closeCode: null });
});
await t('accounts step: no account -> "No trading account found on this cTrader ID"', async () => {
  const r = await run('trade', { ct: { listAccounts: async () => Object.assign([], { scope: 1 }) } });
  assert.equal(r.h, 'No cTrader account found'); assert.equal(r.p, 'No trading account found on this cTrader ID.');
});
await t('accounts step: relay closed / cTrader error code', async () => {
  const a = await run('trade', { ct: { listAccounts: async () => { throw err({ status: 0, code: 'relay', closeCode: 1011 }); } } });
  assert.equal(a.p, 'Couldn’t reach cTrader. Please try again in a minute.'); assert.equal(stepOf(a).closeCode, 1011);
  const b = await run('trade', { ct: { listAccounts: async () => { throw err({ status: 0, code: 'CH_ACCESS_TOKEN_INVALID' }); } } });
  assert.equal(b.p, 'cTrader didn’t accept the sign-in. Please try again.'); assert.equal(stepOf(b).step, 'accounts');
});
await t('save step: device vault refused -> storage message', async () => {
  const r = await run('trade', { tr: { saveTradeCreds: async () => { throw new Error('IDB blocked'); } } });
  assert.equal(r.p, 'Couldn’t save the sign-in on this device. Allow site storage (not private mode), then try again.'); assert.equal(stepOf(r).step, 'save');
});
await t('data sign-in (Data source) gets the same specific reasons and still succeeds', async () => {
  const r = await run('data', { ct: { ctraderTokenCall: async () => { throw err({ status: 400, code: 'rejected', upstream: 'ACCESS_DENIED' }); } } });
  assert.equal(r.h, 'cTrader was not connected'); assert.equal(r.p, 'cTrader didn’t accept the sign-in. Please try again.'); assert.equal(stepOf(r).kind, 'data');
  assert.deepEqual((await run('data')).replaced, ['/charts']);
});
console.log('ALL PASS ' + n);
