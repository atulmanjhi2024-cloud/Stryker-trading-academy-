// TradeZoro — Referral / Invite tracking module
// Depends on: assets/progress.js (`db`), assets/auth.js (`auth`)
//
// Data model:
// - referralCodes/{code}: { uid } — a small, PUBLICLY READABLE lookup table
//   mapping a short code to the student who owns it. Public read is required
//   so a brand-new signup (not yet authenticated as anyone) can resolve a
//   code in the URL to a referrer. Only the owning student (or an admin)
//   can create their own entry.
// - students/{uid}.referralCode: the same code, stored on the student's own
//   profile for quick display without a second lookup.
// - students/{uid}.referralPoints: running point total, incremented here.
// - referrals/{autoId}: { referrerUid, referrerCode, referredUid,
//   referredEmail, referredName, status: 'signed_up' | 'converted',
//   pointsAwarded, createdAt } — one doc per successful referral event.
// - settings/referralConfig: { pointsPerSignup, pointsPerConversion,
//   enabled } — admin-tunable point values.
//
// Everything here fails open and logs rather than throwing where reasonable,
// since a referral-tracking hiccup should never block a signup or purchase.

const REFERRAL_STORAGE_KEY = 'stryker_referral_code';

function generateReferralCode(displayName, email){
  const base = (displayName || (email ? email.split('@')[0] : 'trader'))
    .toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'trader';
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return base + suffix;
}

// Called once per student, the first time they visit a page that needs
// their referral code (e.g. the Invite & Earn page). Uses a Firestore
// transaction on the referralCodes lookup doc so two students can't
// collide on the same generated code.
function ensureReferralCode(uid, displayName, email){
  if (typeof db === 'undefined' || !db) return Promise.resolve(null);
  return db.collection('students').doc(uid).get().then((studentDoc) => {
    const existing = studentDoc.exists ? studentDoc.data().referralCode : null;
    if (existing) return existing;

    function attempt(triesLeft){
      if (triesLeft <= 0) return Promise.reject(new Error('Could not generate a unique referral code.'));
      const code = generateReferralCode(displayName, email);
      const codeRef = db.collection('referralCodes').doc(code);
      return db.runTransaction((tx) => {
        return tx.get(codeRef).then((codeDoc) => {
          if (codeDoc.exists) throw new Error('COLLISION');
          tx.set(codeRef, { uid: uid, name: referralHandle({ displayName: displayName }) });
          tx.set(db.collection('students').doc(uid), { referralCode: code }, { merge: true });
        });
      }).then(() => code).catch((err) => {
        if (err && err.message === 'COLLISION') return attempt(triesLeft - 1);
        throw err;
      });
    }
    return attempt(5);
  });
}

// Public handle shown to an invited friend on the sign-up page ("You were invited by Maya"): the @username when
// there is one, else the first name. Never an email (referralCodes/* is publicly readable).
function referralHandle(s){
  s = s || {};
  if (s.username) return ('@' + String(s.username)).slice(0, 31);
  const first = String(s.displayName || '').trim().split(/\s+/)[0];
  return first && first.toLowerCase() !== 'null' && first.indexOf('@') === -1 ? first.slice(0, 30) : '';
}

// Codes made before the sign-up page named the inviter have no `name`; the owner fills it in (rules allow only that).
function syncReferralCodeName(code, student){
  if (!code || typeof db === 'undefined' || !db) return Promise.resolve();
  const name = referralHandle(student);
  if (!name) return Promise.resolve();
  const ref = db.collection('referralCodes').doc(code);
  return ref.get().then((d) => {
    if (d.exists && d.data().name !== name) return ref.set({ name: name }, { merge: true });
  }).catch(() => {});
}

// Reward numbers (settings/referralRewards, functions-src/referralRewards.js DEFAULTS). Readable signed out.
const REFERRAL_REWARD_DEFAULTS = { enabled: true, inviterDays: 5, friendDays: 5, capDaysPerYear: 365, activeDaysNeeded: 2, windowDays: 7 };
function loadReferralRewardConfig(){
  const base = Object.assign({}, REFERRAL_REWARD_DEFAULTS);
  if (typeof db === 'undefined' || !db) return Promise.resolve(base);
  return db.collection('settings').doc('referralRewards').get()
    .then((d) => {
      const x = d.exists ? (d.data() || {}) : {};
      Object.keys(REFERRAL_REWARD_DEFAULTS).forEach((k) => {
        if (k === 'enabled') { if (x.enabled === false) base.enabled = false; return; }
        const n = Math.floor(Number(x[k])); if (Number.isFinite(n) && n >= 0) base[k] = n;
      });
      return base;
    })
    .catch(() => base);
}

// ---- Activity ping (server-side reward checks) ---------------------------------------------------------------
// Once per UTC day, members who invite or were invited tell referralPing they were here. The function records the
// day plus salted hashes of: a random id kept in this browser, a coarse browser fingerprint and the network address.
// That is how "active on 2 different days" and "not the same device as the inviter" are checked. Fire and forget.
function referralDeviceId(){
  try {
    let id = localStorage.getItem('tz_dev_id');
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      const a = new Uint8Array(16); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.random() * 256; });
      id = Array.from(a, (b) => ('0' + b.toString(16)).slice(-2)).join('');
      localStorage.setItem('tz_dev_id', id);
    }
    return id;
  } catch (e) { return ''; }
}
function referralCoarseFingerprint(){
  try {
    const parts = [navigator.userAgent, screen.width + 'x' + screen.height, window.devicePixelRatio,
      (Intl.DateTimeFormat().resolvedOptions().timeZone || ''), navigator.language, navigator.hardwareConcurrency || 0];
    let h = 2166136261;
    const str = parts.join('|');
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(36);
  } catch (e) { return ''; }
}
function referralActivityPing(uid, studentData){
  const s = studentData || {};
  if (!uid || !(s.referralCode || s.referredBy || s.pendingReferralCode)) return;
  const day = new Date().toISOString().slice(0, 10);
  const key = 'tz_ref_ping_' + uid;
  try { if (localStorage.getItem(key) === day) return; } catch (e) { /* no storage: ping anyway */ }
  if (typeof loadFunctionsSdk !== 'function' || typeof firebase === 'undefined') return;
  loadFunctionsSdk()
    .then(() => firebase.app().functions('us-central1').httpsCallable('referralPing')({ dev: referralDeviceId(), fp: referralCoarseFingerprint() }))
    .then(() => { try { localStorage.setItem(key, day); } catch (e) {} })
    .catch(() => { /* not deployed yet / offline: try again next load */ });
}

// ---- One-time nudge after a member's 3rd active day -----------------------------------------------------------
// Small card low on the screen, dismissable, shown once per account, never on chart / data pages.
const REFERRAL_NUDGE_NEVER = /^\/(charts|gex|replay|backtests|terminal|overlay|stream-overlay|referrals|checkout|signup|login|global-monitor|market-map)(\.html)?$/;
function referralMaybeNudge(uid){
  if (!uid || document.getElementById('ref-nudge')) return;
  if (REFERRAL_NUDGE_NEVER.test(location.pathname) || /-admin(\.html)?$/.test(location.pathname)) return;
  if (document.querySelector('[data-no-ref-nudge], .chart-root, #chart-root')) return;
  const doneKey = 'tz_ref_nudge_done_' + uid, daysKey = 'tz_ref_days_' + uid;
  let days = [];
  try {
    if (localStorage.getItem(doneKey)) return;
    days = JSON.parse(localStorage.getItem(daysKey) || '[]');
    if (!Array.isArray(days)) days = [];
    const today = new Date().toISOString().slice(0, 10);
    if (days.indexOf(today) === -1) { days.push(today); days = days.slice(-5); localStorage.setItem(daysKey, JSON.stringify(days)); }
  } catch (e) { return; }
  if (days.length < 3) return;
  loadReferralRewardConfig().then((cfg) => {
    if (!cfg.enabled || document.getElementById('ref-nudge')) return;
    // Never stack on the cookie notice (same corner): wait for a later page load.
    if (document.querySelector('.tzc.on')) return;
    const el = document.createElement('aside');
    el.id = 'ref-nudge'; el.className = 'ref-nudge'; el.setAttribute('aria-label', 'Invite friends');
    el.innerHTML =
      '<span class="ref-nudge-ic" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v9H5v-9"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg></span>' +
      '<span class="ref-nudge-txt"><b>Invite friends, get Pro free</b><span>You and each friend get ' + cfg.inviterDays + ' days of Pro.</span></span>' +
      '<a class="btn btn-primary btn-sm ref-nudge-go" href="referrals.html">Invite</a>' +
      '<button type="button" class="ref-nudge-x" aria-label="Dismiss"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
    const done = () => { try { localStorage.setItem(doneKey, '1'); } catch (e) {} el.remove(); };
    el.querySelector('.ref-nudge-x').addEventListener('click', done);
    el.querySelector('.ref-nudge-go').addEventListener('click', () => { try { localStorage.setItem(doneKey, '1'); } catch (e) {} });
    document.body.appendChild(el);
  });
}

function referralLinkForCode(code){
  if (!code) return '';
  const origin = window.location.origin || 'https://tradezoro.com';
  return origin + '/signup.html?ref=' + encodeURIComponent(code);
}

// Called on the signup page: stash a ?ref= code from the URL into
// sessionStorage so it survives the redirect to the dashboard, where the
// student doc actually gets created.
function capturePendingReferralCode(){
  const code = new URLSearchParams(window.location.search).get('ref');
  if (code) {
    try { sessionStorage.setItem(REFERRAL_STORAGE_KEY, code); } catch (e) { /* storage unavailable, fail open */ }
  }
}

function takePendingReferralCode(){
  try {
    const code = sessionStorage.getItem(REFERRAL_STORAGE_KEY);
    if (code) sessionStorage.removeItem(REFERRAL_STORAGE_KEY);
    return code;
  } catch (e) {
    return null;
  }
}

function loadReferralConfig(){
  if (typeof db === 'undefined' || !db) return Promise.resolve({ pointsPerSignup: 10, pointsPerConversion: 50, enabled: true });
  return db.collection('settings').doc('referralConfig').get()
    .then((doc) => doc.exists ? Object.assign({ pointsPerSignup: 10, pointsPerConversion: 50, enabled: true }, doc.data()) : { pointsPerSignup: 10, pointsPerConversion: 50, enabled: true })
    .catch(() => ({ pointsPerSignup: 10, pointsPerConversion: 50, enabled: true }));
}

// Normalizes a name that may have been stored as the literal string "null"
// or "undefined" by an earlier code path, so the UI never renders those.
function cleanReferredName(value){
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined') return null;
  return s;
}

// Mirrors the running point total onto the PUBLIC profiles doc as well as the
// private student doc. The leaderboard has to read every competitor's total,
// and students/{uid} is readable only by its owner and admins — so a
// leaderboard built on students/ returns nothing for a normal student. The
// public profiles collection is the only place a cross-student read can work.
//
// CREDITING NOW HAPPENS ON THE SERVER. This function used to increment
// referralPoints on ANOTHER user's student and profile documents from the
// referred person's browser. That required Firestore rules permissive enough
// for one account to write another's document — and with that door open,
// anyone could award themselves unlimited points from the console, which the
// leaderboard and the giveaway draws both take seriously.
//
// The browser now only records the referral event in referrals/{id}. The
// onReferralWritten trigger (functions-src/referralPoints.js) reads the point
// values from settings/referralConfig and credits the referrer with the Admin
// SDK, exactly once per stage. Kept as a no-op so the three call sites below
// still read as a sequence of steps.
function awardReferralPoints(referrerUid, points){
  return Promise.resolve();
}

function notifyReferrer(referrerUid, type, message){
  if (typeof createNotification !== 'function') return Promise.resolve();
  return createNotification(referrerUid, type, message, 'referrals.html')
    .catch((err) => console.error('TradeZoro: referral notification failed', err));
}

// Called once, right after a brand-new student doc is created (see
// progress.js's ensureStudentDoc).
//
// This no longer awards anything directly. It PARKS the code on the student's
// own doc and lets processPendingReferralIfReady() finish the job later.
//
// Why: a brand-new account is not email-verified yet, and the security rules
// require verification before writing to referrals/ or another student's
// points. Doing the work here meant every single referral write was rejected,
// so the invite never appeared on the referrer's page at all. Parking it on
// the student's OWN doc always succeeds, and sessionStorage — where the code
// used to live — is gone by the time they come back from their inbox, quite
// possibly in a different tab.
//
// It also means only CONFIRMED humans earn anyone points, which is what the
// verification requirement was for.
function processPendingReferralForNewStudent(newUid, newDisplayName, newEmail){
  const code = takePendingReferralCode();
  if (!code || typeof db === 'undefined' || !db) return Promise.resolve(null);

  return db.collection('students').doc(newUid).set({
    pendingReferralCode: code
  }, { merge: true }).catch((err) => {
    console.error('TradeZoro: could not park pending referral code', err);
    return null;
  });
}

// Runs on every page load for a signed-in user. Completes a parked referral
// once the account is verified. Safe to call repeatedly: it clears the parked
// code as part of the same write that records referredBy, and bails
// immediately if there is nothing to do.
function processPendingReferralIfReady(uid, studentData){
  // Runs on every signed-in page load (progress.js), so the reward ping and the one-time nudge hang off it too.
  try { referralActivityPing(uid, studentData); referralMaybeNudge(uid); } catch (e) { /* never block */ }
  if (typeof db === 'undefined' || !db) return Promise.resolve(null);
  if (typeof auth === 'undefined' || !auth || !auth.currentUser) return Promise.resolve(null);

  const user = auth.currentUser;
  if (!user.emailVerified) return Promise.resolve(null);   // not yet allowed to write
  if (!studentData) return Promise.resolve(null);
  if (studentData.referredBy) return Promise.resolve(null); // already credited
  const code = studentData.pendingReferralCode;
  if (!code) return Promise.resolve(null);

  return db.collection('referralCodes').doc(code).get()
    .then((codeDoc) => {
      if (!codeDoc.exists) {
        // Bad code — drop it so this doesn't retry on every page load forever.
        return db.collection('students').doc(uid).set({
          pendingReferralCode: firebase.firestore.FieldValue.delete()
        }, { merge: true });
      }

      const referrerUid = codeDoc.data().uid;
      if (!referrerUid || referrerUid === uid) {
        return db.collection('students').doc(uid).set({
          pendingReferralCode: firebase.firestore.FieldValue.delete()
        }, { merge: true });
      }

      return loadReferralConfig().then((config) => {
        if (!config.enabled) return null;
        const points = config.pointsPerSignup || 0;
        const name = cleanReferredName(studentData.displayName) || cleanReferredName(studentData.email);

        // Clear the parked code and set referredBy in ONE write, so a failure
        // later can't leave this eligible to run a second time and double-pay.
        return db.collection('students').doc(uid).set({
          referredBy: referrerUid,
          pendingReferralCode: firebase.firestore.FieldValue.delete()
        }, { merge: true })
          .then(() => db.collection('referrals').add({
            referrerUid: referrerUid,
            referrerCode: code,
            referredUid: uid,
            referredName: name,
            referredEmail: studentData.email || null,
            status: 'signed_up',
            // Split out rather than folded into one running total, so the
            // invite list can show what was earned for joining versus what
            // was earned for upgrading. pointsAwarded stays as the sum for
            // anything already reading it.
            signupPoints: points,
            conversionPoints: 0,
            pointsAwarded: points,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          }))
          .then(() => awardReferralPoints(referrerUid, points))
          .then(() => notifyReferrer(
            referrerUid,
            'referral_signup',
            (name || 'Someone') + ' just joined using your invite link — +' + points + ' pts.'
          ))
          .then(() => {
            if (typeof checkAndNotifyNewAchievementsFor === 'function') checkAndNotifyNewAchievementsFor(referrerUid, false);
          });
      });
    })
    .catch((err) => {
      console.error('TradeZoro: deferred referral processing failed (non-fatal)', err);
      return null;
    });
}

// Called from checkout.js right after an order completes. If the
// purchasing student was referred by someone, award that referrer the
// one-time conversion bonus — but only once per referred student, checked
// via a marker field on their own student doc so a second purchase (e.g.
// an upgrade) doesn't pay out twice.
// Is this plan actually an upgrade worth paying a conversion bonus for?
//
// Every account now DEFAULTS to the entry plan, so "has a plan" no longer
// means "has paid for something" — without this check, simply signing up
// would look like a conversion and pay the bonus twice for one free user.
// An upgrade means ranking strictly above the entry tier.
function isUpgradePlan(planName){
  if (!planName) return false;
  if (typeof rankOf !== 'function' || typeof defaultPlanName !== 'function') {
    // Roles module unavailable — fall back to "anything that isn't the
    // conventional entry plan name".
    return String(planName).toLowerCase() !== 'starter';
  }
  return rankOf(planName) > rankOf(defaultPlanName());
}

// planName is optional. When supplied it is checked against the entry tier and
// recorded on the referral row; when omitted the caller has already decided
// this is a genuine upgrade.
function processReferralConversion(purchasingUid, planName){
  if (typeof db === 'undefined' || !db) return Promise.resolve(null);
  return db.collection('students').doc(purchasingUid).get().then((studentDoc) => {
    if (!studentDoc.exists) return null;
    const data = studentDoc.data();
    const referrerUid = data.referredBy;
    if (!referrerUid || data.referralConversionPaid) return null; // never referred, or already paid out

    const plan = planName || data.plan;
    if (!isUpgradePlan(plan)) return null; // still on the free entry tier

    const rolesReady = (typeof loadPlansForRoles === 'function') ? loadPlansForRoles() : Promise.resolve();
    return rolesReady.then(() => loadReferralConfig()).then((config) => {
      if (!config.enabled) return null;
      const points = config.pointsPerConversion || 0;
      const name = cleanReferredName(data.displayName) || cleanReferredName(data.email);

      // Own doc first, same reasoning as the signup path: the paid marker is
      // what stops a second purchase paying out twice, so it must not depend
      // on a cross-user write succeeding.
      return db.collection('students').doc(purchasingUid)
        .set({ referralConversionPaid: true }, { merge: true })
        .then(() => db.collection('referrals')
          .where('referredUid', '==', purchasingUid)
          .where('referrerUid', '==', referrerUid)
          .limit(1).get())
        .then((snap) => {
          if (!snap.empty) {
            // Upgrade the EXISTING signup row rather than adding another —
            // one invitee is one row, whatever stage they've reached.
            return snap.docs[0].ref.update({
              status: 'converted',
              conversionPoints: points,
              convertedPlan: plan || null,
              convertedAt: firebase.firestore.FieldValue.serverTimestamp(),
              pointsAwarded: firebase.firestore.FieldValue.increment(points)
            });
          }
          return null;
        })
        .then(() => awardReferralPoints(referrerUid, points))
        .then(() => notifyReferrer(
          referrerUid,
          'referral_conversion',
          (name || 'Someone you invited') + ' upgraded to ' + (plan || 'a paid plan') + ' — +' + points + ' pts.'
        ))
        .then(() => {
          if (typeof checkAndNotifyNewAchievementsFor === 'function') checkAndNotifyNewAchievementsFor(referrerUid, false);
        });
    });
  }).catch((err) => {
    console.error('TradeZoro: referral conversion processing failed (non-fatal)', err);
    return null;
  });
}

// Leaderboard: top N by referralPoints, read from the PUBLIC profiles
// collection. It used to query students/, which the rules restrict to the
// owning student and admins — so a list query from a normal student was
// rejected outright and the leaderboard silently came back empty for
// everyone. profiles/ is readable by any signed-in user, which is exactly
// what a leaderboard needs.
function loadReferralLeaderboard(limitCount){
  if (typeof db === 'undefined' || !db) return Promise.resolve([]);
  return db.collection('profiles')
    .orderBy('referralPoints', 'desc')
    .limit(limitCount || 10)
    .get()
    .then((snap) => {
      const list = [];
      snap.forEach((doc) => {
        const d = doc.data();
        // Handles only (Owner 24 Nov): @username or first name, never an email or a full name.
        if (d.referralPoints > 0) list.push({ uid: doc.id, name: referralHandle(d) || 'Trader', points: d.referralPoints || 0, plan: d.plan || null, photoURL: d.photoURL || null, customPhotoURL: d.customPhotoURL || null, avatarSeed: d.avatarSeed || null });
      });
      return list;
    })
    .catch((err) => {
      console.error('TradeZoro: failed to load referral leaderboard', err);
      return [];
    });
}

// Called from checkout.js when the person manually typed an invite code at
// checkout (rather than arriving via a signup link). Only applies if this
// student doesn't already have a referrer on record — it won't override an
// existing signup-time referral, and won't pay out twice. Since both the
// "signup" and "conversion" events are effectively happening at once here,
// the referrer receives both point values in a single award.
function applyReferralCodeAtCheckout(purchasingUid, rawCode){
  const code = (rawCode || '').trim();
  if (!code || typeof db === 'undefined' || !db) return Promise.resolve(null);

  return db.collection('students').doc(purchasingUid).get().then((studentDoc) => {
    const data = studentDoc.exists ? studentDoc.data() : {};
    if (data.referredBy || data.referralConversionPaid) return null; // already tracked, don't override or double-pay

    return db.collection('referralCodes').doc(code).get().then((codeDoc) => {
      if (!codeDoc.exists) return null;
      const referrerUid = codeDoc.data().uid;
      if (!referrerUid || referrerUid === purchasingUid) return null;

      // Second line of defence against duplicate rows: even if referredBy is
      // missing for some reason, a referral doc may already exist for this
      // person. Adding another would show one invitee as two.
      return db.collection('referrals')
        .where('referredUid', '==', purchasingUid)
        .limit(1).get()
        .then((existing) => {
          if (!existing.empty) return null;

          return loadReferralConfig().then((config) => {
            if (!config.enabled) return null;
            const points = (config.pointsPerSignup || 0) + (config.pointsPerConversion || 0);
            const name = cleanReferredName(data.displayName) || cleanReferredName(data.email);

            return db.collection('students').doc(purchasingUid)
              .set({ referredBy: referrerUid, referralConversionPaid: true }, { merge: true })
              .then(() => db.collection('referrals').add({
                referrerUid: referrerUid,
                referrerCode: code,
                referredUid: purchasingUid,
                referredName: name,
                referredEmail: data.email || null,
                status: 'converted',
                signupPoints: config.pointsPerSignup || 0,
                conversionPoints: config.pointsPerConversion || 0,
                convertedAt: firebase.firestore.FieldValue.serverTimestamp(),
                pointsAwarded: points,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
              }))
              .then(() => awardReferralPoints(referrerUid, points))
              .then(() => notifyReferrer(
                referrerUid,
                'referral_conversion',
                (name || 'Someone') + ' joined on a paid plan using your invite code — +' + points + ' pts.'
              ))
              .then(() => {
                if (typeof checkAndNotifyNewAchievementsFor === 'function') checkAndNotifyNewAchievementsFor(referrerUid, false);
              });
          });
        });
    });
  }).catch((err) => {
    console.error('TradeZoro: checkout-time referral code failed (non-fatal)', err);
    return null;
  });
}
