/**
 * TradeZoro: "Invite friends, get Pro free" (Owner order 24 Nov 2026, phase 1, no money).
 *
 * When a friend signs up with an invite link AND is verified, the INVITER and the FRIEND each get free Pro days.
 * Verified = email verified + active on 2 different UTC days within 7 days of joining + not the same device (or
 * network) as the inviter + not a disposable email + a genuinely new account. Checked server-side by a daily sweep
 * ("we check new invites within 2 days"). Every number lives in settings/referralRewards so the CoS can change it
 * without code (DEFAULTS below are used for anything missing).
 *
 *   referralPing        (callable, the member)   { dev, fp }  once a day from the browser (assets/referrals.js). Records
 *                       the UTC day, a hash of the caller's IP and a hash of a random per-browser id in
 *                       refSignals/{uid}. That is the "active day" evidence and the device/network fingerprint.
 *   referralRewardSweep (scheduled, daily)       decides every invite row (referrals/*) from the last windowDays+3
 *                       days: verifying / verified (grants) / ineligible (+ reason). No admin review step
 *                       (Owner 24 Nov: no velocity hold); every passing invite is granted on the spot.
 *
 * Grant path = the same fields the paywall and the L2 gate read (functions/api/chart/_rt.js isActiveProDoc,
 * assets/plan-limits.js): students/{uid}.plan = Pro, planId, subscriptionStatus 'active', paidThroughMillis moved
 * forward (max(now, current) + days, never shortened), planSource 'referral' when the member was on the free tier.
 * The daily subscriptionSweep downgrades it when the days run out, as for any other dated Pro grant.
 * A member who is ALREADY paying by autopay (Stripe / Razorpay subscription), a founding member or a permanent Pro
 * gets the days BANKED instead (students.refProDaysBanked) so billing is never touched (money-out / billing = Owner).
 *
 * Firestore (all functions-only writes; firestore.rules):
 *   referralRewards/{friendUid}  ONE per new account (create() is the lock): { referrerUid, referredUid, referralId,
 *                                state: verified|ineligible, reason, inviterDays, friendDays, ... }.
 *                                Readable by the inviter, the friend and admins.
 *   refSignals/{uid}             { days[], ips[{h,d}], devs[{h,d}], fps[{h,d}] } hashes only. Server-only.
 *                                dev = random per-browser id; fp = coarse browser fingerprint (UA, screen, time zone,
 *                                language); ip = caller address. Only salted hashes are stored.
 *   referrals/{id}               the existing invite row gains rewardState / rewardReason / rewardInviterDays /
 *                                rewardFriendDays (clients may not set these; rules).
 *   students/{uid}               plan fields (above) + refProDaysBanked (privileged).
 *
 * DEPLOY: firebase deploy --only functions:referralPing,functions:referralRewardSweep
 * (needs the RESEND_API_KEY secret that sendAuthEmail already binds; email is best effort).
 */
'use strict';

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const crypto = require('crypto');

if (!admin.apps.length) admin.initializeApp();

const DAY = 864e5;
const PRO_PLAN_ID = 'Sj1bjdpwvYJUVErjNMAb';   // = partnerAdmin.js
const PRO_PLAN_NAME = 'Pro';
const SITE = 'https://tradezoro.com';
const FROM = 'TradeZoro <noreply@tradezoro.com>';

const DEFAULTS = {
  enabled: true,
  inviterDays: 5,           // Owner 24 Nov: 5 Pro days each side
  friendDays: 5,
  capDaysPerYear: 365,      // max days one member can earn from invites, rolling 12 months
  activeDaysNeeded: 2,
  windowDays: 7,
  ipMatch: 'block',         // 'block' | 'ignore': friend on the same network as the inviter
  blockedDomains: []        // extra disposable domains on top of the built-in list
};

// Common throwaway-mail domains. settings/referralRewards.blockedDomains adds more without a deploy.
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamailblock.com', 'sharklasers.com',
  'grr.la', 'pokemail.net', 'spam4.me', '10minutemail.com', '10minutemail.net', '10minemail.com', 'temp-mail.org', 'temp-mail.io',
  'tempmail.com', 'tempmail.net', 'tempmailo.com', 'tempmail.dev', 'tempr.email', 'tempinbox.com', 'throwawaymail.com',
  'yopmail.com', 'yopmail.net', 'yopmail.fr', 'getnada.com', 'nada.email', 'dispostable.com', 'maildrop.cc', 'mailnesia.com',
  'mintemail.com', 'mohmal.com', 'trashmail.com', 'trashmail.de', 'trashmail.net', 'fakeinbox.com', 'emailondeck.com',
  'mailcatch.com', 'moakt.com', 'mytemp.email', 'burnermail.io', 'spamgourmet.com', 'getairmail.com', 'discard.email',
  'fakemail.net', 'inboxkitten.com', 'mail.tm', 'emailfake.com', 'tmpmail.org', 'tmpmail.net', 'tmails.net', '1secmail.com',
  '1secmail.net', '1secmail.org', 'mailpoof.com', 'linshiyouxiang.net', 'emltmp.com', 'harakirimail.com', 'jetable.org',
  'spambox.us', 'trbvm.com', 'dropmail.me', 'cuvox.de', 'armyspy.com', 'dayrep.com', 'einrot.com', 'fleckens.hu',
  'gustr.com', 'jourrapide.com', 'rhyta.com', 'superrito.com', 'teleworm.us', 'mailsac.com', 'tempail.com', 'byom.de',
  'luxusmail.org', 'mail-temp.com', 'minuteinbox.com', 'mvrht.net', 'owlymail.com', 'spamdecoy.net', 'tempmailaddress.com'
]);

// ---------------------------------------------------------------- pure helpers (tools/tests/referral-rewards.test.js)

function loadConfig(raw) {
  const d = raw || {};
  const int = (v, def, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : def; };
  return {
    enabled: d.enabled !== false,
    inviterDays: int(d.inviterDays, DEFAULTS.inviterDays, 0, 90),
    friendDays: int(d.friendDays, DEFAULTS.friendDays, 0, 90),
    capDaysPerYear: int(d.capDaysPerYear, DEFAULTS.capDaysPerYear, 0, 3650),
    activeDaysNeeded: int(d.activeDaysNeeded, DEFAULTS.activeDaysNeeded, 1, 14),
    windowDays: int(d.windowDays, DEFAULTS.windowDays, 1, 60),
    ipMatch: ['block', 'ignore'].includes(d.ipMatch) ? d.ipMatch : DEFAULTS.ipMatch,
    blockedDomains: Array.isArray(d.blockedDomains) ? d.blockedDomains.map((x) => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 500) : []
  };
}

// Canonical mailbox: lower case, "+tag" dropped, Gmail dots dropped, googlemail = gmail. So a.b+x@gmail.com == ab@gmail.com.
function normEmail(e) {
  const s = String(e || '').trim().toLowerCase();
  const at = s.lastIndexOf('@');
  if (at < 1) return s;
  let local = s.slice(0, at), dom = s.slice(at + 1);
  if (dom === 'googlemail.com') dom = 'gmail.com';
  local = local.split('+')[0];
  if (dom === 'gmail.com') local = local.replace(/\./g, '');
  return local + '@' + dom;
}

function emailDomain(e) { const s = String(e || '').trim().toLowerCase(); const at = s.lastIndexOf('@'); return at > 0 ? s.slice(at + 1) : ''; }

function isDisposable(email, extra) {
  const dom = emailDomain(email);
  if (!dom) return true;
  const list = new Set((extra || []).map((x) => String(x).toLowerCase()));
  // a subdomain of a listed domain counts too (x.mailinator.com)
  const parts = dom.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const d = parts.slice(i).join('.');
    if (DISPOSABLE.has(d) || list.has(d)) return true;
  }
  return false;
}

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (d) => Date.parse(d + 'T00:00:00Z');

// Distinct UTC days in [joinMs, joinMs + windowDays) the friend was seen on.
function activeDaysInWindow(days, joinMs, windowDays) {
  const lo = utcDay(joinMs), hiMs = joinMs + windowDays * DAY;
  return Array.from(new Set((days || []).filter((d) => typeof d === 'string' && d >= lo && dayMs(d) < hiMs))).length;
}

const hashSet = (list) => new Set((list || []).map((x) => (x && x.h) || x).filter(Boolean));
function overlaps(a, b) { const s = hashSet(a); for (const h of hashSet(b)) if (s.has(h)) return true; return false; }

/**
 * Decide one invite. Pure. Inputs (all plain data read by the caller):
 *   cfg            loadConfig(settings)
 *   now            ms
 *   row            the referrals/{id} doc { referrerUid, referredUid, createdAt(ms) }
 *   friend         { uid, email, emailVerified, createdMs, disabled, banned }
 *   inviter        { uid, email, exists, banned }
 *   friendSig / inviterSig   refSignals docs { days[], ips[], devs[] } (or {})
 *   inviterRecent  [{ state, inviterDays, decidedAtMillis }] the inviter's earlier rewards
 * Returns { state: 'verifying'|'verified'|'ineligible', reason, inviterDays, friendDays }.
 */
function assessReferral(x) {
  const cfg = x.cfg, now = x.now, row = x.row || {}, f = x.friend || {}, inv = x.inviter || {};
  const fs = x.friendSig || {}, is = x.inviterSig || {};
  const no = (reason) => ({ state: 'ineligible', reason, inviterDays: 0, friendDays: 0 });
  if (!cfg.enabled) return { state: 'verifying', reason: 'Programme paused', inviterDays: 0, friendDays: 0 };

  // ---- hard "no" (abuse) first
  if (!row.referrerUid || !row.referredUid) return no('Invalid invite');
  if (row.referrerUid === row.referredUid || inv.uid === f.uid) return no('Self-invite');
  if (!inv.exists) return no('Inviter account not found');
  if (inv.banned) return no('Inviter account suspended');
  if (f.disabled || f.banned) return no('Account suspended');
  if (f.email && inv.email && normEmail(f.email) === normEmail(inv.email)) return no('Same email as inviter');
  if (isDisposable(f.email, cfg.blockedDomains)) return no('Disposable email address');
  if (overlaps(fs.devs, is.devs)) return no('Same device as inviter');
  // A private window gets a new random id, so also: the same coarse browser fingerprint on the same network.
  if (overlaps(fs.fps, is.fps) && overlaps(fs.ips, is.ips)) return no('Same device as inviter');
  // The window starts when the friend's login was created. The invite row is written once the email is confirmed,
  // so it can trail the sign-up; a row written more than windowDays after the account existed is an old account.
  const joinMs = Number(f.createdMs) || Number(row.createdAt) || now;
  if (f.createdMs && Number(row.createdAt) && Number(row.createdAt) - f.createdMs > cfg.windowDays * DAY) return no('Account existed before the invite');

  const windowEnd = joinMs + cfg.windowDays * DAY;
  const active = activeDaysInWindow(fs.days, joinMs, cfg.windowDays);
  const verifiedEmail = f.emailVerified === true;
  if (!verifiedEmail || active < cfg.activeDaysNeeded) {
    if (now < windowEnd + DAY) {   // one spare day so the last day's ping is in before we judge
      return { state: 'verifying', reason: !verifiedEmail ? 'Waiting for email confirmation' : 'Active ' + active + ' of ' + cfg.activeDaysNeeded + ' days', inviterDays: 0, friendDays: 0 };
    }
    return no(!verifiedEmail ? 'Email never confirmed' : 'Not active on ' + cfg.activeDaysNeeded + ' days in the first ' + cfg.windowDays);
  }

  if (cfg.ipMatch === 'block' && overlaps(fs.ips, is.ips)) return no('Same network as inviter');

  // ---- passed. Work out the days (no per-day limit, no review hold: Owner 24 Nov).
  const yearAgo = now - 365 * DAY;
  const earned = (x.inviterRecent || []).filter((r) => r.state === 'verified' && (r.decidedAtMillis || 0) > yearAgo)
    .reduce((s, r) => s + (Number(r.inviterDays) || 0), 0);
  const left = Math.max(0, cfg.capDaysPerYear - earned);
  const inviterDays = Math.min(cfg.inviterDays, left);
  const out = { state: 'verified', reason: inviterDays < cfg.inviterDays ? 'Inviter reached the ' + cfg.capDaysPerYear + '-day yearly cap' : '', inviterDays, friendDays: cfg.friendDays };
  return out;
}

/**
 * students/{uid} patch that adds `days` of Pro. Pure. Never shortens anything, never touches billing.
 * kind 'grant'  -> plan fields set, paidThroughMillis = max(now, current) + days
 * kind 'bank'   -> already paying by autopay / founding / permanent Pro: refProDaysBanked += days only
 * kind 'none'   -> days = 0
 */
function proGrantPatch(s, nowMs, days, paidPlanNames) {
  s = s || {};
  if (!(days > 0)) return { kind: 'none', patch: {} };
  const paid = paidPlanNames || new Set(['pro', 'elite']);
  const onPaid = !!s.plan && paid.has(String(s.plan).toLowerCase()) && s.subscriptionStatus !== 'expired';
  const pt = Number(s.paidThroughMillis) || 0;
  const autopay = (s.subscriptionAutopay === true || !!s.stripeSubscriptionId || !!s.razorpaySubscriptionId) &&
    ['active', 'trialing', 'grace'].includes(s.subscriptionStatus) && pt > nowMs;
  const permanent = s.foundingMember === true || (onPaid && !pt);
  if (autopay || permanent) return { kind: 'bank', patch: { refProDaysBanked: (Number(s.refProDaysBanked) || 0) + days } };
  const patch = {
    plan: onPaid ? s.plan : PRO_PLAN_NAME,
    planId: onPaid && s.planId ? s.planId : PRO_PLAN_ID,
    subscriptionStatus: 'active',
    paidThroughMillis: Math.max(nowMs, pt) + days * DAY
  };
  if (!onPaid || !s.planSource) patch.planSource = 'referral';
  return { kind: 'grant', patch };
}

function handleOf(s, fallback) {
  s = s || {};
  if (s.username) return '@' + String(s.username).slice(0, 30);
  const first = String(s.displayName || '').trim().split(/\s+/)[0];
  return first ? first.slice(0, 30) : (fallback || 'A friend');
}

const sha = (s) => crypto.createHash('sha256').update('tzref:' + s).digest('hex').slice(0, 32);

// Merge one ping into a refSignals doc. Pure. Keeps the last 30 days, 20 IPs, 10 devices.
function mergeSignal(cur, day, ipH, devH, fpH) {
  cur = cur || {};
  const days = Array.from(new Set([].concat(cur.days || [], [day]))).sort().slice(-30);
  const up = (list, h, max) => { if (!h) return (list || []).slice(-max); const l = (list || []).filter((x) => x.h !== h); l.push({ h, d: day }); return l.slice(-max); };
  return { days, ips: up(cur.ips, ipH, 20), devs: up(cur.devs, devH, 10), fps: up(cur.fps, fpH, 10) };
}

// ---------------------------------------------------------------- Firestore side

const db = () => admin.firestore();
const FV = () => admin.firestore.FieldValue;
const ms = (t) => (t && typeof t.toMillis === 'function') ? t.toMillis() : (Number(t) || 0);

async function readConfig() {
  try { const d = await db().collection('settings').doc('referralRewards').get(); return loadConfig(d.exists ? d.data() : {}); }
  catch (e) { return loadConfig({}); }
}

async function paidPlans() {
  const set = new Set();
  try {
    (await db().collection('plans').get()).forEach((d) => {
      const p = d.data() || {};
      if ((p.rank || 0) >= 1 && p.addon !== true) { set.add(d.id.toLowerCase()); if (p.name) set.add(String(p.name).toLowerCase()); }
    });
  } catch (e) { /* fall back below */ }
  return set.size ? set : new Set(['pro', 'elite']);
}

function notify(uid, message) {
  return db().collection('notifications').add({
    recipientUid: uid, type: 'referral_reward', message: String(message).slice(0, 240), link: 'referrals.html',
    read: false, createdAt: FV().serverTimestamp()
  }).catch((e) => console.error('referral notify failed', uid, e.message));
}

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function rewardEmail(kind, days, other) {
  const subject = kind === 'inviter' ? 'You earned ' + days + ' Pro days: ' + other + ' joined' : 'Your ' + days + ' days of Pro are on';
  const line = kind === 'inviter'
    ? other + ' joined TradeZoro with your invite link, so we added ' + days + ' days of Pro to your account.'
    : 'Thanks for joining TradeZoro with ' + other + '\'s invite. We added ' + days + ' days of Pro to your account.';
  const text = line + '\n\nSee your invites: ' + SITE + '/referrals\n\nEducation only. Not financial advice.';
  const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:22px;color:#111">' +
    '<p>' + esc(line) + '</p><p><a href="' + SITE + '/referrals" style="color:#03a171">See your invites</a></p>' +
    '<p style="color:#666;font-size:12px">Education only. Not financial advice.</p></div>';
  return { subject, html, text };
}

async function sendMail(to, mail) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return false;
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], reply_to: 'support@tradezoro.com', subject: mail.subject, html: mail.html, text: mail.text }),
      signal: ac.signal
    });
    return !!(r && r.status >= 200 && r.status < 300);
  } catch (e) { return false; } finally { clearTimeout(t); }
}

async function authUser(uid) { try { return await admin.auth().getUser(uid); } catch (e) { return null; } }

async function inviterRecent(referrerUid) {
  const out = [];
  try { (await db().collection('referralRewards').where('referrerUid', '==', referrerUid).get()).forEach((d) => out.push(d.data())); }
  catch (e) { console.error('referralRewards read failed', e.message); }
  return out;
}

function rowPatch(r) {
  return { rewardState: r.state, rewardReason: r.reason || '', rewardInviterDays: r.inviterDays || 0, rewardFriendDays: r.friendDays || 0, rewardCheckedAt: FV().serverTimestamp() };
}

/**
 * Apply a decision. verified -> transaction: lock referralRewards/{friend} (must not exist), grant both students.
 * ineligible -> lock doc with that state. Returns the stored state or null.
 */
async function applyDecision(rowRef, row, decision) {
  const rRef = db().collection('referralRewards').doc(row.referredUid);
  const now = Date.now();
  if (decision.state === 'verifying') { await rowRef.set(rowPatch(decision), { merge: true }); return 'verifying'; }
  const plans = decision.state === 'verified' ? await paidPlans() : null;
  const res = await db().runTransaction(async (tx) => {
    const cur = await tx.get(rRef);
    if (cur.exists) return null;   // one reward per account
    const doc = {
      referrerUid: row.referrerUid, referredUid: row.referredUid, referralId: rowRef.id,
      state: decision.state, reason: decision.reason || '', inviterDays: 0, friendDays: 0,
      decidedAtMillis: now, updatedAt: FV().serverTimestamp()
    };
    doc.createdAt = FV().serverTimestamp();
    if (decision.state === 'verified') {
      const iRef = db().collection('students').doc(row.referrerUid), fRef = db().collection('students').doc(row.referredUid);
      const [iS, fS] = await Promise.all([tx.get(iRef), tx.get(fRef)]);
      const gi = proGrantPatch(iS.exists ? iS.data() : {}, now, decision.inviterDays, plans);
      const gf = proGrantPatch(fS.exists ? fS.data() : {}, now, decision.friendDays, plans);
      if (gi.kind !== 'none' && iS.exists) tx.set(iRef, gi.patch, { merge: true });
      if (gf.kind !== 'none' && fS.exists) tx.set(fRef, gf.patch, { merge: true });
      Object.assign(doc, { inviterDays: decision.inviterDays, friendDays: decision.friendDays, inviterGrant: gi.kind, friendGrant: gf.kind,
        inviterUntil: gi.patch.paidThroughMillis || null, friendUntil: gf.patch.paidThroughMillis || null });
      if (gi.patch.plan) tx.set(db().collection('profiles').doc(row.referrerUid), { plan: gi.patch.plan }, { merge: true });
      if (gf.patch.plan) tx.set(db().collection('profiles').doc(row.referredUid), { plan: gf.patch.plan }, { merge: true });
    }
    tx.set(rRef, doc, { merge: true });
    tx.set(rowRef, rowPatch(Object.assign({}, decision)), { merge: true });
    return doc;
  });
  if (!res) return null;
  if (res.state === 'verified') await announce(row, res);
  return res.state;
}

async function announce(row, doc) {
  const [iS, fS, iU, fU] = await Promise.all([
    db().collection('students').doc(row.referrerUid).get(), db().collection('students').doc(row.referredUid).get(),
    authUser(row.referrerUid), authUser(row.referredUid)
  ]);
  const friendH = handleOf(fS.exists ? fS.data() : {}, 'A friend'), inviterH = handleOf(iS.exists ? iS.data() : {}, 'a friend');
  const banked = (k) => (k === 'bank' ? ' You already have Pro, so they are saved on your account.' : '');
  if (doc.inviterDays > 0) {
    await notify(row.referrerUid, 'You earned ' + doc.inviterDays + ' Pro days: ' + friendH + ' joined.' + banked(doc.inviterGrant));
    if (iU && iU.email) await sendMail(iU.email, rewardEmail('inviter', doc.inviterDays, friendH));
  }
  if (doc.friendDays > 0) {
    await notify(row.referredUid, 'Welcome gift: ' + doc.friendDays + ' days of Pro are on your account (invited by ' + inviterH + ').' + banked(doc.friendGrant));
    if (fU && fU.email) await sendMail(fU.email, rewardEmail('friend', doc.friendDays, inviterH));
  }
}

async function gather(row) {
  const [fU, iU, fS, iS, fSig, iSig, recent] = await Promise.all([
    authUser(row.referredUid), authUser(row.referrerUid),
    db().collection('students').doc(row.referredUid).get(), db().collection('students').doc(row.referrerUid).get(),
    db().collection('refSignals').doc(row.referredUid).get(), db().collection('refSignals').doc(row.referrerUid).get(),
    inviterRecent(row.referrerUid)
  ]);
  const banned = async (uid) => { try { return (await db().collection('bannedUsers').doc(uid).get()).exists; } catch (e) { return false; } };
  const fsd = fS.exists ? fS.data() : {}, isd = iS.exists ? iS.data() : {};
  return {
    friend: { uid: row.referredUid, email: (fU && fU.email) || fsd.email || '', emailVerified: !!(fU && fU.emailVerified),
      createdMs: fU && fU.metadata ? Date.parse(fU.metadata.creationTime) || 0 : 0, disabled: !!(fU && fU.disabled),
      banned: fsd.banned === true || await banned(row.referredUid) },
    inviter: { uid: row.referrerUid, email: (iU && iU.email) || isd.email || '', exists: iS.exists && !!iU,
      banned: isd.banned === true || !!(iU && iU.disabled) || await banned(row.referrerUid) },
    friendSig: fSig.exists ? fSig.data() : {}, inviterSig: iSig.exists ? iSig.data() : {}, inviterRecent: recent
  };
}

async function sweepOnce(now) {
  const cfg = await readConfig();
  if (!cfg.enabled) { console.log('referralRewardSweep: programme off'); return { checked: 0 }; }
  const since = admin.firestore.Timestamp.fromMillis(now - (cfg.windowDays + 3) * DAY);
  const snap = await db().collection('referrals').where('createdAt', '>=', since).get();
  const tally = { checked: 0, verifying: 0, verified: 0, ineligible: 0, skipped: 0 };
  const seen = new Set();
  // Oldest first so the yearly cap applies in join order.
  const docs = snap.docs.slice().sort((a, b) => ms(a.data().createdAt) - ms(b.data().createdAt));
  for (const d of docs) {
    const raw = d.data() || {};
    if (!raw.referredUid || seen.has(raw.referredUid)) { tally.skipped++; continue; }   // duplicate rows: first one decides
    seen.add(raw.referredUid);
    if (['verified', 'ineligible', 'denied'].includes(raw.rewardState)) { tally.skipped++; continue; }
    try {
      const existing = await db().collection('referralRewards').doc(raw.referredUid).get();
      if (existing.exists) {
        const e = existing.data();
        if (raw.rewardState !== e.state) await d.ref.set(rowPatch({ state: e.state, reason: e.reason, inviterDays: e.inviterDays, friendDays: e.friendDays }), { merge: true });
        tally.skipped++; continue;
      }
      const row = { referrerUid: raw.referrerUid, referredUid: raw.referredUid, createdAt: ms(raw.createdAt) };
      const g = await gather(row);
      const decision = assessReferral(Object.assign({ cfg, now, row }, g));
      const st = await applyDecision(d.ref, row, decision);
      tally.checked++;
      if (st) tally[st] = (tally[st] || 0) + 1;
    } catch (e) {
      console.error('referralRewardSweep: failed for row', d.id, e.message);
    }
  }
  console.log('referralRewardSweep:', JSON.stringify(tally));
  return tally;
}

exports.referralRewardSweep = functions
  .region('us-central1')
  .runWith({ maxInstances: 1, timeoutSeconds: 540, memory: '256MB', secrets: ['RESEND_API_KEY'] })
  .pubsub.schedule('every 24 hours').timeZone('UTC')
  .onRun(async () => { await sweepOnce(Date.now()); return null; });

exports.referralPing = functions
  .region('us-central1')
  .runWith({ maxInstances: 10, timeoutSeconds: 20, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const a = context.auth;
    if (!a || !a.uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
    if (a.token && a.token.firebase && a.token.firebase.sign_in_provider === 'anonymous') throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
    const dev = data && typeof data.dev === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(data.dev) ? data.dev : '';
    const fp = data && typeof data.fp === 'string' && /^[a-z0-9]{4,40}$/.test(data.fp) ? data.fp : '';
    const h = (context.rawRequest && context.rawRequest.headers) || {};
    const ip = String(h['x-forwarded-for'] || (context.rawRequest && context.rawRequest.ip) || '').split(',')[0].trim();
    const day = utcDay(Date.now());
    const ref = db().collection('refSignals').doc(a.uid);
    await db().runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      tx.set(ref, Object.assign(mergeSignal(cur.exists ? cur.data() : {}, day, ip ? sha('ip:' + ip) : '', dev ? sha('dev:' + dev) : '', fp ? sha('fp:' + fp) : ''), { updatedAt: FV().serverTimestamp() }));
    });
    return { ok: true, day };
  });

exports._test = { loadConfig, normEmail, isDisposable, activeDaysInWindow, assessReferral, proGrantPatch, handleOf, mergeSignal, rewardEmail, utcDay, DEFAULTS, PRO_PLAN_ID };
