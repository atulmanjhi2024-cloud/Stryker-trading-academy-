// One-off (Owner 25 Nov 2026, "open Russia and Belarus"): clears stored sanctions locks that came ONLY from RU / BY.
// DRY RUN by default; add --apply to write. Needs Admin credentials (GOOGLE_APPLICATION_CREDENTIALS), run from functions-src/ so firebase-admin resolves.
//   node tools/unlock-ru-by.js            (list)      |      node tools/unlock-ru-by.js --apply
// Touches students/{uid} only when: residenceCountry is RU/BY (any case), or sanctionsLocked is true AND the lock record
// (sanctionsLog entries with that uid) shows country RU/BY only. Other lock reasons (CU IR KP SY, UA regions) are left alone.
// Clears: sanctionsLocked, sanctionsLockedAt, sanctionsLockReason; re-enables the Firebase Auth login (disabled by the webhook). Never touches plan or money.
const admin = require(require('path').resolve(process.cwd(), 'node_modules/firebase-admin'));
admin.initializeApp();
const db = admin.firestore();
const APPLY = process.argv.includes('--apply');
const RUBY = ['RU', 'BY'];
(async () => {
  const logs = {};   // uid -> [countries]
  (await db.collection('sanctionsLog').get()).forEach((d) => { const x = d.data(); if (x.uid) (logs[x.uid] = logs[x.uid] || []).push(String(x.country || '').toUpperCase()); });
  const snap = await db.collection('students').where('sanctionsLocked', '==', true).get();
  let n = 0;
  for (const d of snap.docs) {
    const s = d.data(); const cs = logs[d.id] || [];
    const res = String(s.residenceCountry || '').toUpperCase().split('-')[0];
    const fromRuBy = (cs.length && cs.every((c) => RUBY.includes(c))) || (!cs.length && RUBY.includes(res));
    const otherBlock = (res && !RUBY.includes(res) && ['CU', 'IR', 'KP', 'SY', 'UA'].includes(res)) || cs.some((c) => !RUBY.includes(c) && c);
    if (!fromRuBy || otherBlock) { console.log('SKIP', d.id, 'residence', res || '-', 'log', cs.join(',') || '-'); continue; }
    n++; console.log(APPLY ? 'UNLOCK' : 'would unlock', d.id, 'residence', res || '-', 'log', cs.join(',') || '-');
    if (!APPLY) continue;
    const F = admin.firestore.FieldValue;
    await d.ref.update({ sanctionsLocked: F.delete(), sanctionsLockedAt: F.delete(), sanctionsLockReason: F.delete() });
    await admin.auth().updateUser(d.id, { disabled: false }).catch((e) => console.log('  auth enable failed', d.id, e.message));
  }
  console.log((APPLY ? 'unlocked ' : 'would unlock ') + n + ' of ' + snap.size + ' locked accounts');
})().catch((e) => { console.error(e); process.exit(1); });
