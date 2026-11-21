// In-memory stand-in for the server-written Firestore docs of _owner.js (brokerUsers, finUsers, liveConsent, settings/liveBlocked).
// memStore({ consent: ['admin1'] }) pre-accepts the live notice for those uids. No network.
import { LIVE_TERMS_VERSION } from '../../functions/connect/finatic/_owner.js';

export function memStore({ consent = [], fail = null } = {}) {
  const docs = new Map();
  for (const u of consent) docs.set('liveConsent/' + u, { uid: u, version: LIVE_TERMS_VERSION, at: '2026-11-21T00:00:00Z' });
  const chk = (op, path) => { if (fail && fail(op, path)) throw new Error('store down'); };
  return {
    docs,
    async get(path) { chk('get', path); const d = docs.get(path); return d ? { ...d } : null; },
    async create(path, obj) { chk('create', path); if (docs.has(path)) { const e = new Error('duplicate'); e.duplicate = true; throw e; } docs.set(path, { ...obj }); return true; },
    async set(path, obj) { chk('set', path); docs.set(path, { ...(docs.get(path) || {}), ...obj }); },
  };
}
