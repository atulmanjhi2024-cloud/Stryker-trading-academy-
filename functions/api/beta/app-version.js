// POST|GET /api/beta/app-version?platform=android|windows|mac|linux  (optional Bearer ID token) -> the manifest entry for that platform: the beta channel for beta testers / admins,
// the normal channel for everyone else (no token, invalid token, not beta). The static /app-version.json stays the normal channel (its "beta" blocks are stripped by this API only; see report).
import { json, isBetaToken } from './_lib.js';
import { pickChannel } from '../../../assets/beta-config.mjs';

export async function handle(request, env, deps = {}) {
  const url = new URL(request.url), platform = url.searchParams.get('platform') || '';
  if (!/^(android|windows|mac|linux)$/.test(platform)) return json({ error: 'platform?' }, 400);
  const m = await (deps.manifest ? deps.manifest() : (env.ASSETS ? env.ASSETS.fetch(new URL('/app-version.json', url)).then((r) => r.json()) : fetch(url.origin + '/app-version.json').then((r) => r.json()))).catch(() => null);
  if (!m || !m[platform]) return json({ error: 'No version' }, 404);
  let beta = false;
  if (request.headers.get('authorization')) { try { const w = await isBetaToken(env, request, deps); beta = !!(w && w.beta); } catch (e) { beta = false; } }
  return json(pickChannel(m, platform, beta), 200, { vary: 'authorization' });
}
export const onRequest = ({ request, env }) => handle(request, env);
