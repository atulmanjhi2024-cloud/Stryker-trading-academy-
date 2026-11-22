// Beta tester program: ONE config (Owner 2026-11-22). Testers are added by email by an admin (Firestore settings/betaTesters). Used by functions/api/beta and, through assets/beta.js, the pages. No secrets here.
export const BETA = {
  forumChannelId: '1567407797128265768',   // bug-reports forum
  cap: 30,                                 // max emails on the list; adding the 31st is refused
  reportsPerDay: 10,                       // bug reports per user per UTC day
  reportMaxPngBytes: 1500000,
  // Features gated "beta" (visible to beta testers + admins) instead of hidden. A feature calls isBeta('<id>') (assets/beta.js).
  // state: 'testing' = live for beta now; 'soon' = gate wired, feature lands on its own branch (that branch calls isBeta).
  // Copy trading and admin pages are NOT listed: they stay admin-only.
  features: [
    { id: 'mql5', title: 'MQL5 script language', note: 'Write and run MQL5 scripts in the script editor.', state: 'soon' },
    { id: 'thinkscript', title: 'thinkScript language', note: 'Write and run thinkScript studies in the script editor.', state: 'soon' },
    { id: 'metatrader', title: 'MetaTrader login connection', note: 'Connect your MetaTrader account to the charts.', state: 'soon' },
    { id: 'l2', title: 'Live order book', note: 'Pro-level live data while you are in the beta.', state: 'testing' },
    { id: 'appchannel', title: 'Test app versions', note: 'Android and desktop apps offer test builds before everyone else.', state: 'testing' },
  ],
};
export const ADMIN_ONLY_NOT_FLIPPED = [];   // see the report: candidates are listed there for the Owner to decide, none are flipped here
export const normEmail = (e) => String(e == null ? '' : e).trim().toLowerCase();
export const emailOk = (e) => /^[^\s@<>"'`]{1,64}@[^\s@<>"'`]{1,190}\.[^\s@<>"'`]{2,}$/.test(e) && e.length <= 254;
export const betaFeature = (id) => BETA.features.find((f) => f.id === id) || null;

// app-version.json channel: beta users get entry.beta (when present) on top of the normal entry; everyone else the normal one.
export function pickChannel(manifest, platform, isBetaUser) {
  const e = manifest && manifest[platform];
  if (!e) return null;
  const { beta, ...stable } = e;
  if (isBetaUser && beta && typeof beta === 'object') return { ...stable, ...beta, channel: 'beta' };
  return { ...stable, channel: 'stable' };
}
