// Unit test: "Invite friends, get Pro free" rules (functions-src/referralRewards.js). Node only, SDKs stubbed.
// Run: node tools/tests/referral-rewards.test.js
const Module = require('module'), assert = require('assert');
const chain = { region() { return chain; }, runWith() { return chain; }, pubsub: { schedule() { return { timeZone() { return { onRun: (f) => f }; } }; } },
  https: { onCall: (f) => f, HttpsError: class extends Error {} } };
const adminStub = { apps: [1], initializeApp() {}, firestore: Object.assign(() => ({}), { FieldValue: {}, Timestamp: {} }), auth: () => ({}) };
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return (r === 'firebase-functions/v1' || r === 'firebase-admin') ? r : orig.call(this, r, ...a); };
require.cache['firebase-functions/v1'] = { id: 'f', filename: 'f', loaded: true, exports: chain };
require.cache['firebase-admin'] = { id: 'a', filename: 'a', loaded: true, exports: adminStub };
const R = require('../../functions-src/referralRewards.js')._test;

const DAY = 864e5, JOIN = Date.UTC(2026, 10, 10, 9), NOW8 = JOIN + 8 * DAY + 3600e3;
const day = (n) => R.utcDay(JOIN + n * DAY);
let n = 0; const t = (name, f) => { f(); n++; console.log('PASS ' + name); };
const cfg = R.loadConfig({});
function base(over) {
  return Object.assign({
    cfg, now: NOW8,
    row: { referrerUid: 'inv', referredUid: 'fr', createdAt: JOIN + 3600e3 },
    friend: { uid: 'fr', email: 'friend@gmail.com', emailVerified: true, createdMs: JOIN },
    inviter: { uid: 'inv', email: 'inviter@gmail.com', exists: true },
    friendSig: { days: [day(0), day(2)], ips: [{ h: 'ipF' }], devs: [{ h: 'devF' }] },
    inviterSig: { days: [day(0)], ips: [{ h: 'ipI' }], devs: [{ h: 'devI' }] },
    inviterRecent: []
  }, over || {});
}
const A = (over) => R.assessReferral(base(over));

// ---- config
t('defaults (Owner 24 Nov): 5 + 5 days, 365-day cap, 2 active days in 7, no daily limit', () => {
  assert.deepStrictEqual([cfg.inviterDays, cfg.friendDays, cfg.capDaysPerYear, cfg.activeDaysNeeded, cfg.windowDays], [5, 5, 365, 2, 7]);
  assert.ok(!('dailyVerifiedLimit' in cfg) && !('dailyVerifiedLimit' in R.DEFAULTS));
});
t('config from the settings doc; junk values fall back to defaults', () => {
  const c = R.loadConfig({ inviterDays: 3, friendDays: '10', capDaysPerYear: -1, ipMatch: 'hold' });
  assert.deepStrictEqual([c.inviterDays, c.friendDays, c.capDaysPerYear, c.ipMatch], [3, 10, 365, 'block']);
});

// ---- the happy path
t('verified: email confirmed + 2 active days + different device and network', () => {
  const r = A(); assert.strictEqual(r.state, 'verified'); assert.strictEqual(r.inviterDays, 5); assert.strictEqual(r.friendDays, 5);
});
t('verifying: only 1 active day, still inside the window', () => {
  const r = A({ now: JOIN + 3 * DAY, friendSig: { days: [day(0)] } }); assert.strictEqual(r.state, 'verifying'); assert.match(r.reason, /1 of 2/);
});
t('verifying: email not confirmed yet', () => assert.strictEqual(A({ now: JOIN + 3 * DAY, friend: Object.assign({}, base().friend, { emailVerified: false }) }).state, 'verifying'));
t('ineligible after the window: only 1 active day', () => {
  const r = A({ friendSig: { days: [day(0), day(0)] } }); assert.strictEqual(r.state, 'ineligible'); assert.match(r.reason, /2 days in the first 7/);
});
t('active days outside the 7-day window do not count', () => {
  const r = A({ now: JOIN + 12 * DAY, friendSig: { days: [day(0), day(9)] } }); assert.strictEqual(r.state, 'ineligible');
});
t('ineligible after the window: email never confirmed', () => assert.match(A({ friend: Object.assign({}, base().friend, { emailVerified: false }) }).reason, /never confirmed/));
t('two pings on the same UTC day are one active day', () => assert.strictEqual(R.activeDaysInWindow([day(1), day(1)], JOIN, 7), 1));

// ---- abuse
t('self-invite (same uid) blocked', () => assert.strictEqual(A({ row: { referrerUid: 'fr', referredUid: 'fr' } }).reason, 'Self-invite'));
t('same email (gmail dots / +tag) blocked', () => {
  const r = A({ friend: Object.assign({}, base().friend, { email: 'in.vi.ter+alt@googlemail.com' }) }); assert.strictEqual(r.reason, 'Same email as inviter');
});
t('same device fingerprint blocked', () => assert.strictEqual(A({ friendSig: Object.assign({}, base().friendSig, { devs: [{ h: 'devI' }] }) }).reason, 'Same device as inviter'));
t('private window: same coarse fingerprint AND same network = same device', () => {
  const fsig = Object.assign({}, base().friendSig, { fps: [{ h: 'fpX' }], ips: [{ h: 'ipI' }] });
  assert.strictEqual(A({ friendSig: fsig, inviterSig: Object.assign({}, base().inviterSig, { fps: [{ h: 'fpX' }] }) }).reason, 'Same device as inviter');
  // same phone model on a different network is a different person
  const other = Object.assign({}, base().friendSig, { fps: [{ h: 'fpX' }] });
  assert.strictEqual(A({ friendSig: other, inviterSig: Object.assign({}, base().inviterSig, { fps: [{ h: 'fpX' }] }) }).state, 'verified');
});
t('same network as the inviter is not eligible by default (no review hold)', () => {
  const r = A({ friendSig: Object.assign({}, base().friendSig, { ips: [{ h: 'ipI' }] }) }); assert.strictEqual(r.state, 'ineligible'); assert.strictEqual(r.reason, 'Same network as inviter');
});
t('same network: ipMatch block / ignore', () => {
  const sig = Object.assign({}, base().friendSig, { ips: [{ h: 'ipI' }] });
  assert.strictEqual(A({ cfg: R.loadConfig({ ipMatch: 'block' }), friendSig: sig }).state, 'ineligible');
  assert.strictEqual(A({ cfg: R.loadConfig({ ipMatch: 'ignore' }), friendSig: sig }).state, 'verified');
});
t('disposable email domains blocked (built-in, subdomain, settings list)', () => {
  assert.strictEqual(A({ friend: Object.assign({}, base().friend, { email: 'x@mailinator.com' }) }).reason, 'Disposable email address');
  assert.ok(R.isDisposable('x@eu.yopmail.com', []));
  assert.ok(R.isDisposable('x@newtrash.io', ['newtrash.io']));
  assert.ok(!R.isDisposable('x@gmail.com', []));
  assert.ok(R.isDisposable('no-at-sign', []));
});
t('old account (row written long after the login existed) is not a new account', () => {
  const r = A({ friend: Object.assign({}, base().friend, { createdMs: JOIN - 30 * DAY }) }); assert.strictEqual(r.reason, 'Account existed before the invite');
});
t('suspended friend / inviter, missing inviter', () => {
  assert.strictEqual(A({ friend: Object.assign({}, base().friend, { banned: true }) }).state, 'ineligible');
  assert.strictEqual(A({ inviter: Object.assign({}, base().inviter, { banned: true }) }).state, 'ineligible');
  assert.strictEqual(A({ inviter: Object.assign({}, base().inviter, { exists: false }) }).state, 'ineligible');
});
t('no velocity hold: 50 friends verified in the same day are all granted', () => {
  const recent = Array.from({ length: 50 }, () => ({ state: 'verified', inviterDays: 5, decidedAtMillis: NOW8 - 3600e3 }));
  const r = A({ inviterRecent: recent }); assert.strictEqual(r.state, 'verified'); assert.strictEqual(r.inviterDays, 5);
});
t('yearly cap: 365 days per member, rolling 12 months; friend still gets theirs', () => {
  const full = Array.from({ length: 73 }, (_, i) => ({ state: 'verified', inviterDays: 5, decidedAtMillis: NOW8 - (1 + i * 4) * DAY }));   // 365 days
  let r = A({ inviterRecent: full }); assert.strictEqual(r.state, 'verified'); assert.strictEqual(r.inviterDays, 0); assert.strictEqual(r.friendDays, 5);
  assert.match(r.reason, /365-day yearly cap/);
  const near = full.slice(0, 72);   // 360 used, 5 left
  assert.strictEqual(A({ inviterRecent: near }).inviterDays, 5);
  const at362 = near.concat([{ state: 'verified', inviterDays: 2, decidedAtMillis: NOW8 - 2 * DAY }]);   // 362 used, 3 left
  assert.strictEqual(A({ inviterRecent: at362 }).inviterDays, 3);
  const expired = full.map((x) => Object.assign({}, x, { decidedAtMillis: NOW8 - 400 * DAY }));
  assert.strictEqual(A({ inviterRecent: expired }).inviterDays, 5);
  const notGranted = full.map((x) => Object.assign({}, x, { state: 'ineligible' }));
  assert.strictEqual(A({ inviterRecent: notGranted }).inviterDays, 5);
});
t('the reward decision never returns a held state', () => {
  const cases = [A(), A({ friendSig: Object.assign({}, base().friendSig, { ips: [{ h: 'ipI' }] }) }),
    A({ inviterRecent: Array.from({ length: 20 }, () => ({ state: 'verified', inviterDays: 5, decidedAtMillis: NOW8 })) })];
  cases.forEach((r) => assert.ok(['verified', 'verifying', 'ineligible'].includes(r.state), r.state));
});
t('programme switched off: nothing decided', () => assert.strictEqual(A({ cfg: R.loadConfig({ enabled: false }) }).state, 'verifying'));

// ---- the Pro grant (same fields the paywall / L2 gate read)
const NOW = Date.UTC(2026, 10, 20);
t('free member: Pro, active, +7 days from now, planSource referral', () => {
  const g = R.proGrantPatch({ plan: 'Starter' }, NOW, 7);
  assert.strictEqual(g.kind, 'grant');
  assert.deepStrictEqual(g.patch, { plan: 'Pro', planId: R.PRO_PLAN_ID, subscriptionStatus: 'active', paidThroughMillis: NOW + 7 * DAY, planSource: 'referral' });
});
t('grants stack: an existing dated Pro is extended, never shortened', () => {
  const g = R.proGrantPatch({ plan: 'Pro', planId: 'p', planSource: 'referral', subscriptionStatus: 'active', paidThroughMillis: NOW + 3 * DAY }, NOW, 7);
  assert.strictEqual(g.patch.paidThroughMillis, NOW + 10 * DAY); assert.strictEqual(g.patch.plan, 'Pro');
});
t('lapsed member (expired) restarts from now', () => {
  const g = R.proGrantPatch({ plan: 'Starter', subscriptionStatus: 'expired', paidThroughMillis: NOW - 20 * DAY }, NOW, 7);
  assert.strictEqual(g.patch.paidThroughMillis, NOW + 7 * DAY); assert.strictEqual(g.patch.plan, 'Pro');
});
t('autopay subscriber: billing untouched, days banked', () => {
  const s = { plan: 'Pro', subscriptionStatus: 'active', stripeSubscriptionId: 'sub_1', subscriptionAutopay: true, paidThroughMillis: NOW + 12 * DAY, refProDaysBanked: 7 };
  const g = R.proGrantPatch(s, NOW, 7); assert.strictEqual(g.kind, 'bank'); assert.deepStrictEqual(g.patch, { refProDaysBanked: 14 });
});
t('founding member / permanent Pro: banked, plan untouched', () => {
  assert.strictEqual(R.proGrantPatch({ plan: 'Pro', foundingMember: true }, NOW, 7).kind, 'bank');
  assert.strictEqual(R.proGrantPatch({ plan: 'Elite' }, NOW, 7).kind, 'bank');
});
t('Elite with a dated grant keeps Elite and is extended', () => {
  const g = R.proGrantPatch({ plan: 'Elite', planId: 'e', planSource: 'partner', subscriptionStatus: 'active', paidThroughMillis: NOW + DAY }, NOW, 7);
  assert.strictEqual(g.patch.plan, 'Elite'); assert.strictEqual(g.patch.planId, 'e'); assert.strictEqual(g.patch.paidThroughMillis, NOW + 8 * DAY); assert.ok(!('planSource' in g.patch));
});
t('0 days = no write', () => assert.strictEqual(R.proGrantPatch({ plan: 'Starter' }, NOW, 0).kind, 'none'));

// ---- signals + wording
t('ping merge: days de-duplicated, hashes kept, capped', () => {
  let s = {};
  for (let i = 0; i < 40; i++) s = R.mergeSignal(s, R.utcDay(NOW + i * DAY), 'ip' + (i % 3), 'dev1', 'fp' + i);
  assert.strictEqual(s.days.length, 30); assert.strictEqual(s.ips.length, 3); assert.strictEqual(s.devs.length, 1); assert.strictEqual(s.fps.length, 10);
  s = R.mergeSignal(s, s.days[29], '', ''); assert.strictEqual(s.days.length, 30);
});
t('handle: @username, else first name, never an email', () => {
  assert.strictEqual(R.handleOf({ username: 'zoro', displayName: 'Maya Rao', email: 'm@x.com' }), '@zoro');
  assert.strictEqual(R.handleOf({ displayName: 'Maya Rao', email: 'm@x.com' }), 'Maya');
  assert.strictEqual(R.handleOf({ email: 'm@x.com' }, 'A friend'), 'A friend');
});
t('email: no prices, no result claims, carries the education line', () => {
  for (const k of ['inviter', 'friend']) {
    const m = R.rewardEmail(k, 5, '@zoro');
    assert.ok(!/\$|₹|profit|win rate|return/i.test(m.text)); assert.match(m.text, /Education only\. Not financial advice\./); assert.match(m.subject, /5/);
  }
  assert.strictEqual(R.rewardEmail('inviter', 5, '@zoro').subject, 'You earned 5 Pro days: @zoro joined');
  assert.ok(!/<script/.test(R.rewardEmail('inviter', 5, '<script>').html));
});
console.log(n + '/' + n + ' passed');
