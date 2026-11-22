// POST /api/beta/report (Bearer ID token; beta testers + admins only; 10/day per user) -> { ok, thread }.
// Body JSON: { title, what, url, build, ua, errors?:[string], screenshot?: 'data:image/png;base64,...' }. Posts a new thread in the bug-reports forum with the PNG attached and the
// "Beta" tag, and keeps a copy in Firestore betaReports (text only, no image: the thread holds it). User text is only ever in payload_json (JSON.stringify), inside a code block,
// with allowed_mentions parse [] so nothing pings and no link renders.
import { BETA } from '../../../assets/beta-config.mjs';
import { json, okOrigin, isBetaToken, fsClient, bump } from './_lib.js';

const DC = 'https://discord.com/api/v10';
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/`/g, "'").replace(/@/g, '@\u200b').slice(0, n);
const oneLine = (s, n) => clean(s, n * 2).replace(/\s+/g, ' ').trim().slice(0, n);
export function pngBytes(dataUrl) {   // -> Uint8Array | null; checks the decoded size and the PNG magic bytes
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m || m[1].length > BETA.reportMaxPngBytes * 1.4) return null;
  let b; try { b = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)); } catch (e) { return null; }
  if (b.length > BETA.reportMaxPngBytes || b.length < 8) return null;
  return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x) ? b : null;
}
export function buildPayload(b, who) {
  const errs = (Array.isArray(b.errors) ? b.errors : []).slice(0, 5).map((e) => oneLine(e, 200));
  const body = ['What happened:', clean(b.what, 1200), '', 'Page: ' + oneLine(b.url, 300), 'Build: ' + oneLine(b.build, 20), 'Browser: ' + oneLine(b.ua, 200), 'Reporter: ' + oneLine(who.name, 40)]
    .concat(errs.length ? ['', 'Console errors:'].concat(errs) : []).join('\n');
  return { name: '[Beta] ' + oneLine(b.title, 80), message: { content: '```\n' + body.slice(0, 1800) + '\n```', allowed_mentions: { parse: [] } } };
}

export async function handle(request, env, deps = {}) {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  if (!okOrigin(request, env)) return json({ error: 'Forbidden' }, 403);
  if (Number(request.headers.get('content-length') || 0) > BETA.reportMaxPngBytes * 1.4 + 20000) return json({ error: 'Too big' }, 413);
  if (!env.DISCORD_BOT_TOKEN) return json({ error: 'Bug reports are being set up.' }, 503);
  const f = deps.fetchImpl || fetch;
  const who = await isBetaToken(env, request, deps);
  if (!who) return json({ error: 'Sign in first' }, 401);
  if (!who.beta) return json({ error: 'Bug reports are for beta testers.' }, 403);
  let b; try { b = JSON.parse(await request.text()); } catch (e) { b = null; }
  if (!b || typeof b !== 'object') return json({ error: 'Bad request' }, 400);
  if (oneLine(b.title, 80).length < 3 || clean(b.what, 1200).trim().length < 5) return json({ error: 'Add a short title and what happened.' }, 400);
  const png = b.screenshot ? pngBytes(b.screenshot) : null;
  if (b.screenshot && !png) return json({ error: 'Bad screenshot' }, 400);
  const day = new Date(deps.now || Date.now()).toISOString().slice(0, 10);
  if (!(await bump(env, 'brd:' + who.uid + ':' + day, BETA.reportsPerDay, 90000))) return json({ error: 'You reached 10 reports today. Try again tomorrow.' }, 429);
  const fs = fsClient(env, f), stu = await fs.get('students/' + who.uid).catch(() => null);
  const payload = buildPayload(b, { name: (stu && (stu.name || stu.displayName)) || 'member' });
  const h = { authorization: 'Bot ' + env.DISCORD_BOT_TOKEN };
  try {
    const ch = await f(DC + '/channels/' + BETA.forumChannelId, { headers: h }).then((r) => r.ok ? r.json() : null).catch(() => null);
    const tag = ch && Array.isArray(ch.available_tags) ? ch.available_tags.find((t) => String(t.name).toLowerCase() === 'beta') : null;
    if (tag) payload.applied_tags = [String(tag.id)];
    const form = new FormData();
    form.append('payload_json', JSON.stringify(png ? { ...payload, message: { ...payload.message, attachments: [{ id: 0, filename: 'bug.png' }] } } : payload));
    if (png) form.append('files[0]', new Blob([png], { type: 'image/png' }), 'bug.png');
    const r = await f(DC + '/channels/' + BETA.forumChannelId + '/threads', { method: 'POST', headers: h, body: form });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.id) return json({ error: 'Could not send the report. Try again.' }, 502);
    await fs.create('betaReports/' + Date.now().toString(36) + '-' + who.uid.slice(0, 8), { uid: who.uid, title: oneLine(b.title, 80), what: clean(b.what, 1200), url: oneLine(b.url, 300), build: oneLine(b.build, 20), ua: oneLine(b.ua, 200), errors: (Array.isArray(b.errors) ? b.errors : []).slice(0, 5).map((e) => oneLine(e, 200)).join('\n'), thread: String(j.id), hasShot: !!png, at: new Date() }).catch(() => {});
    return json({ ok: true, thread: String(j.id) });
  } catch (e) { if (deps.debug) console.error(e); return json({ error: 'Could not send the report. Try again.' }, 502); }
}
export const onRequest = ({ request, env }) => handle(request, env);
