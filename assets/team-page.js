/* /team: renders assets/data/team.json (moderators[], ambassadors[]). Entry: {name, avatar?, tz?, socials?{x,instagram,youtube,tiktok}}.
   All text goes in via textContent; handles are charset-checked; avatars only from the Discord CDN. */
(function () {
  var ICONS = {
    x: ['X', 'https://x.com/', 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'],
    instagram: ['Instagram', 'https://instagram.com/', 'M12 2.16c3.2 0 3.58.01 4.85.07 3.25.15 4.77 1.69 4.92 4.92.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.15 3.23-1.66 4.77-4.92 4.92-1.27.06-1.64.07-4.85.07s-3.58-.01-4.85-.07c-3.26-.15-4.77-1.7-4.92-4.92C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85C2.38 3.92 3.9 2.38 7.15 2.23 8.42 2.17 8.8 2.16 12 2.16zM12 0C8.74 0 8.33.01 7.05.07 2.7.27.27 2.69.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.2 4.36 2.62 6.78 6.98 6.98C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c4.35-.2 6.78-2.62 6.98-6.98.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.2-4.35-2.62-6.78-6.98-6.98C15.67.01 15.26 0 12 0zm0 5.84a6.16 6.16 0 100 12.32 6.16 6.16 0 000-12.32zM12 16a4 4 0 110-8 4 4 0 010 8zm6.4-11.85a1.44 1.44 0 100 2.88 1.44 1.44 0 000-2.88z'],
    youtube: ['YouTube', 'https://youtube.com/@', 'M23.5 6.2a3 3 0 00-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 00.5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 002.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 002.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.6 15.6V8.4l6.2 3.6-6.2 3.6z'],
    tiktok: ['TikTok', 'https://tiktok.com/@', 'M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z']
  };
  var HANDLE = /^[A-Za-z0-9._]{1,40}$/;
  var AVATAR = /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//;
  var NS = 'http://www.w3.org/2000/svg';

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function initials(name) {
    var p = String(name).trim().split(/\s+/).filter(Boolean);
    return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }
  function card(m, role) {
    var c = el('article', 'tm-card');
    var av = el('div', 'tm-av');
    if (m.avatar && AVATAR.test(m.avatar)) {
      var img = new Image(); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
      img.onerror = function () { av.textContent = initials(m.name); };
      img.src = m.avatar; av.appendChild(img);
    } else av.textContent = initials(m.name);
    c.appendChild(av);
    c.appendChild(el('h3', 'tm-name', m.name));
    c.appendChild(el('span', 'tm-badge', role));
    if (m.tz) c.appendChild(el('p', 'tm-tz', String(m.tz)));
    var soc = el('div', 'tm-soc');
    Object.keys(ICONS).forEach(function (k) {
      var h = m.socials && m.socials[k];
      if (!h) return;
      h = String(h).replace(/^@/, '');
      if (!HANDLE.test(h)) return;
      var a = el('a'); a.href = ICONS[k][1] + h; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.setAttribute('aria-label', m.name + ' on ' + ICONS[k][0]);
      var s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
      var p = document.createElementNS(NS, 'path'); p.setAttribute('d', ICONS[k][2]); s.appendChild(p); a.appendChild(s);
      soc.appendChild(a);
    });
    if (soc.children.length) c.appendChild(soc);
    return c;
  }
  function empty(role) {
    var e = el('div', 'tm-empty');
    e.appendChild(el('h3', null, 'Want to be here?'));
    e.appendChild(el('p', null, 'Apply to be ' + (role === 'Ambassador' ? 'an ' : 'a ') + role + ' in our Discord. We are looking for friendly, helpful traders.'));
    var a = el('a', 'tm-cta', 'Apply in our Discord');
    a.href = 'https://discord.gg/M4d4gTr5c3'; a.target = '_blank'; a.rel = 'noopener';
    e.appendChild(a);
    return e;
  }
  function fill(id, list, role) {
    var host = document.getElementById(id); if (!host) return;
    host.textContent = '';
    list = (Array.isArray(list) ? list : []).filter(function (m) { return m && typeof m.name === 'string' && m.name.trim(); });
    if (!list.length) { host.appendChild(empty(role)); return; }
    var g = el('div', 'tm-grid');
    list.forEach(function (m) { g.appendChild(card(m, role)); });
    host.appendChild(g);
  }
  var src = (document.currentScript && document.currentScript.dataset.src) || '/assets/data/team.json';
  fetch(src, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
    .then(function (d) { fill('tm-mods', d.moderators, 'Moderator'); fill('tm-amb', d.ambassadors, 'Ambassador'); });
})();
