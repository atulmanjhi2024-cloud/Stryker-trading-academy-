// TradeZoro — student "Invite friends, get Pro free" page (referrals.html)
// Depends on: assets/auth.js, assets/progress.js (`db`), assets/referrals.js (ensureReferralCode, referralLinkForCode,
//   loadReferralLeaderboard, loadReferralRewardConfig, referralHandle, syncReferralCodeName), assets/sanitize.js (stkEsc)
//
// Rewards are decided ONLY by the server (functions-src/referralRewards.js): this page reads referrals/* rows that name
// the member (rewardState / rewardReason / rewardInviterDays written by the function) and referralRewards/* docs.
// Nothing here can grant or change a reward.

let REFERRAL_UID = null;
let REFX_CFG = null;

// One invitee = one row (older data recorded some people twice: a signed_up row and a converted row).
function collapseInvites(rawInvites){
  const byPerson = new Map();
  const rank = { verified: 5, denied: 3, ineligible: 3, verifying: 2 };
  rawInvites.forEach((inv) => {
    const key = inv.referredUid || ('gone:' + Math.random());
    const existing = byPerson.get(key);
    if (!existing) { byPerson.set(key, Object.assign({}, inv)); return; }
    if ((rank[inv.rewardState] || 0) > (rank[existing.rewardState] || 0)) {
      existing.rewardState = inv.rewardState; existing.rewardReason = inv.rewardReason; existing.rewardInviterDays = inv.rewardInviterDays;
    }
    existing.referredUserDeleted = existing.referredUserDeleted || inv.referredUserDeleted;
    existing.referredName = existing.referredName || inv.referredName;
    const te = existing.createdAt && existing.createdAt.toMillis ? existing.createdAt.toMillis() : 0;
    const ti = inv.createdAt && inv.createdAt.toMillis ? inv.createdAt.toMillis() : 0;
    if (ti && (!te || ti < te)) existing.createdAt = inv.createdAt;
  });
  return Array.from(byPerson.values());
}

function inviteEscape(s){
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// First name only (the invite row stores the name the friend gave; never show their email).
function inviteDisplayName(inv){
  const v = inv.referredName;
  if (v !== null && v !== undefined) {
    const s = String(v).trim();
    if (s && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'undefined') {
      if (s.indexOf('@') !== -1) return s.split('@')[0].slice(0, 2) + '…';
      return s.split(/\s+/)[0];
    }
  }
  return 'A new trader';
}

// rewardState -> chip. Rows from before the reward programme have no state: "Joined".
function inviteStatus(inv){
  const st = inv.rewardState;
  if (st === 'verified') return { cls: 'ok', label: 'Verified', note: (inv.rewardInviterDays ? '+' + inv.rewardInviterDays + ' Pro days' : (inv.rewardReason || 'Yearly cap reached')) };
  if (st === 'verifying') return { cls: 'wait', label: 'Verifying', note: inv.rewardReason || 'We check within 2 days' };
  if (st === 'ineligible' || st === 'denied') return { cls: 'no', label: 'Not eligible', note: inv.rewardReason || 'Did not meet the rules' };
  return { cls: 'new', label: 'Joined', note: 'Check starts soon' };
}

const CHECK_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function renderInviteList(invites){
  const wrap = document.getElementById('referral-invite-list');
  const countEl = document.getElementById('referral-invite-count');
  if (countEl) countEl.textContent = invites.length + ' invite' + (invites.length === 1 ? '' : 's');

  if (!invites.length) {
    wrap.innerHTML = '<p class="refx-empty">No one has joined with your link yet. Share it above and your friends will show up here.</p>';
    return;
  }
  wrap.innerHTML = '';
  const list = document.createElement('ul');
  list.className = 'refx-list';
  invites.forEach((inv) => {
    const when = inv.createdAt && typeof inv.createdAt.toDate === 'function'
      ? inv.createdAt.toDate().toLocaleDateString(undefined, inv.createdAt.toDate().getFullYear() === new Date().getFullYear()
          ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
      : '—';
    const st = inviteStatus(inv);
    const li = document.createElement('li');
    li.className = 'refx-row';
    li.innerHTML =
      '<span class="refx-av" aria-hidden="true">' + inviteEscape(inviteDisplayName(inv).charAt(0).toUpperCase()) + '</span>' +
      '<span class="refx-who"><b>' + inviteEscape(inviteDisplayName(inv)) + '</b><span>Joined ' + inviteEscape(when) +
        (inv.referredUserDeleted ? ' · account removed' : '') + '</span></span>' +
      '<span class="refx-st"><span class="refx-chip refx-chip-' + st.cls + '">' + (st.cls === 'ok' ? CHECK_SVG : '') + inviteEscape(st.label) + '</span>' +
        '<span class="refx-st-note">' + inviteEscape(st.note) + '</span></span>';
    list.appendChild(li);
  });
  wrap.appendChild(list);
}

function renderStats(invites, rewardsAsInviter, rewardsAsFriend){
  // Verified / days from the server-written reward docs (the source of truth); pending from the invite rows.
  const verified = rewardsAsInviter.filter((r) => r.state === 'verified');
  const days = verified.reduce((s, r) => s + (Number(r.inviterDays) || 0), 0) +
    rewardsAsFriend.filter((r) => r.state === 'verified').reduce((s, r) => s + (Number(r.friendDays) || 0), 0);
  const done = new Set(rewardsAsInviter.map((r) => r.referredUid));
  const pending = invites.filter((i) => !done.has(i.referredUid) && !['verified', 'ineligible', 'denied'].includes(i.rewardState) && !i.referredUserDeleted).length;
  document.getElementById('refx-verified').textContent = verified.length;
  document.getElementById('refx-days').textContent = '+' + days;
  document.getElementById('refx-pending').textContent = pending;
}

function renderLeaderboard(list, myUid, myPoints){
  const wrap = document.getElementById('referral-leaderboard');
  const rankEl = document.getElementById('referral-rank');
  const myIndex = list.findIndex((e) => e.uid === myUid);
  if (rankEl) {
    if (myIndex >= 0) rankEl.textContent = '#' + (myIndex + 1);
    else if (!myPoints) rankEl.textContent = '—';
    else rankEl.textContent = '#' + (list.length + 1) + '+';
  }
  if (!list.length) {
    wrap.innerHTML = '<p class="refx-empty">No one is on the board yet. Be the first.</p>';
    return;
  }
  wrap.innerHTML = '';
  const ol = document.createElement('ol');
  ol.className = 'refx-list refx-lb';
  list.forEach((entry, i) => {
    const isMe = entry.uid === myUid;
    const avatarHtml = (typeof avatarImgHtml === 'function') ? avatarImgHtml(entry.uid, entry.name, entry, 32, true) : '';
    const li = document.createElement('li');
    li.className = 'refx-row' + (isMe ? ' is-me' : '');
    li.innerHTML =
      '<span class="refx-rank">' + (i + 1) + '</span>' +
      '<span class="refx-lb-av">' + avatarHtml + '</span>' +
      '<span class="refx-who"><b>' + stkEsc(entry.name) + (isMe ? ' <span class="refx-you">You</span>' : '') + '</b></span>' +
      '<span class="refx-pts">' + entry.points + '<small> pts</small></span>';
    ol.appendChild(li);
  });
  wrap.appendChild(ol);
}

function flash(btn, text){
  const label = btn.querySelector('span') || btn;
  const original = label.textContent;
  label.textContent = text;
  setTimeout(() => { label.textContent = original; }, 1500);
}
function copyText(text){
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    try { document.execCommand('copy') ? resolve() : reject(new Error('copy')); } catch (e) { reject(e); } finally { t.remove(); }
  });
}

// Pre-written message: no prices, no result claims (Owner 24 Nov).
function shareMessage(cfg){
  return 'I use TradeZoro for charts and trading tools, and it\'s FREE. Join with my link and get ' + cfg.friendDays + ' days of Pro free.';
}

function wireShare(link, cfg){
  const msg = shareMessage(cfg);
  const enc = encodeURIComponent;
  document.getElementById('refx-share-x').href = 'https://twitter.com/intent/tweet?text=' + enc(msg) + '&url=' + enc(link);
  document.getElementById('refx-share-wa').href = 'https://wa.me/?text=' + enc(msg + ' ' + link);
  document.getElementById('refx-share-tg').href = 'https://t.me/share/url?url=' + enc(link) + '&text=' + enc(msg);
  document.getElementById('refx-share-rd').href = 'https://www.reddit.com/submit?url=' + enc(link) + '&title=' + enc(msg);
  const nat = document.getElementById('referral-native-share');
  if (navigator.share) {
    nat.hidden = false;
    nat.onclick = () => navigator.share({ title: 'TradeZoro', text: msg, url: link }).catch(() => {});
  }
}

function applyConfigText(cfg){
  document.querySelectorAll('[data-rx]').forEach((el) => {
    const v = cfg[el.getAttribute('data-rx')];
    if (v !== undefined) el.textContent = v;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (!auth) return;

  const copyBtn = document.getElementById('referral-copy-btn');
  copyBtn.addEventListener('click', () => {
    const v = document.getElementById('referral-link-display').value;
    if (!v) return;
    copyText(v).then(() => flash(copyBtn, 'Copied')).catch(() => { document.getElementById('referral-link-display').select(); });
  });
  document.getElementById('referral-code-copy').addEventListener('click', () => {
    const v = document.getElementById('referral-code-display').textContent;
    if (!v || v === '—') return;
    copyText(v).then(() => { if (typeof showToast === 'function') showToast('success', 'Code copied'); }).catch(() => {});
  });

  let handled = false;
  auth.onAuthStateChanged((user) => {
    if (handled) return;
    if (!user) {
      setTimeout(() => { if (!handled) goToLoginPreservingReturn(); }, 1500);
      return;
    }
    handled = true;
    REFERRAL_UID = user.uid;

    const cfgReady = loadReferralRewardConfig().then((cfg) => { REFX_CFG = cfg; applyConfigText(cfg); return cfg; });
    const studentReady = db.collection('students').doc(user.uid).get().then((d) => (d.exists ? d.data() : {})).catch(() => ({}));

    Promise.all([ensureReferralCode(user.uid, user.displayName, user.email), cfgReady, studentReady])
      .then(([code, cfg, student]) => {
        document.getElementById('referral-code-display').textContent = code || '—';
        const link = referralLinkForCode(code);
        document.getElementById('referral-link-display').value = link;
        wireShare(link, cfg);
        syncReferralCodeName(code, Object.assign({ displayName: user.displayName }, student));
      })
      .catch((err) => {
        const e = document.getElementById('referral-error');
        e.textContent = 'Could not make your invite link: ' + (err.message || err);
        e.style.display = 'block';
      });

    let myPoints = 0;
    const pointsReady = studentReady.then((s) => {
      myPoints = s.referralPoints || 0;
      document.getElementById('referral-total-points').textContent = myPoints;
      return myPoints;
    });

    const invitesReady = db.collection('referrals').where('referrerUid', '==', user.uid).get()
      .then((snap) => { const raw = []; snap.forEach((doc) => raw.push(doc.data())); return collapseInvites(raw); });
    const rewardsMine = db.collection('referralRewards').where('referrerUid', '==', user.uid).get()
      .then((snap) => { const a = []; snap.forEach((d) => a.push(d.data())); return a; }).catch(() => []);
    const rewardsFriend = db.collection('referralRewards').where('referredUid', '==', user.uid).get()
      .then((snap) => { const a = []; snap.forEach((d) => a.push(d.data())); return a; }).catch(() => []);

    Promise.all([invitesReady, rewardsMine, rewardsFriend])
      .then(([invites, mine, asFriend]) => {
        invites.sort((a, b) => {
          const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
          const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
          return tb - ta;
        });
        renderInviteList(invites);
        renderStats(invites, mine, asFriend);
      })
      .catch((err) => {
        console.error('TradeZoro: failed to load invites', err);
        document.getElementById('referral-invite-list').innerHTML = '<p class="refx-empty">Could not load your invites right now. Try refreshing.</p>';
        ['refx-verified', 'refx-days', 'refx-pending'].forEach((id) => { document.getElementById(id).textContent = '0'; });
      });

    Promise.all([loadReferralLeaderboard(10), pointsReady])
      .then(([list, points]) => renderLeaderboard(list, user.uid, points))
      .catch((err) => {
        document.getElementById('referral-leaderboard').innerHTML = '<p class="refx-empty">Could not load the leaderboard: ' + inviteEscape(err.message || err) + '</p>';
      });
  });
});
