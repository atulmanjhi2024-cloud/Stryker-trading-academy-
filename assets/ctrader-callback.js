// TradeZoro — cTrader sign-in return page (/connect/ctrader/callback). DATA ONLY, view-only (scope=accounts).
// Flow: strip the code from the URL at once, check the single-use state (same signed-in user, under 10 min), swap the code
// through /connect/ctrader/token, list the accounts over the relay, let the member pick one if there are several, keep the
// tokens + chosen account in the device vault, go back to /charts (fixed address; never taken from the URL).
// 23 Nov: the SAME return page also finishes the admin-only "Allow trading" sign-in (assets/ctrader-trade.js). That sign-in has its
// own single-use state record; when it matches, the tokens go to the separate trading vault entry, never to the data source.
(function () {
  var q = new URLSearchParams(location.search);
  var code = q.get('code'), state = q.get('state'), denied = q.get('error');
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
  var h = document.getElementById('ct-h'), p = document.getElementById('ct-p'), a = document.getElementById('ct-a');
  function end(title, text) { h.textContent = title; p.textContent = text; a.hidden = false; }   // textContent only: nothing from the URL is ever shown
  if (denied || !code || !state) return end('cTrader was not connected', 'You can try again from Data source in the charts.');
  function user() {
    return new Promise(function (res) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; res(null); } }, 10000);
      try { firebase.auth().onAuthStateChanged(function (u) { if (done || !u) return; done = true; clearTimeout(t); res(u); }); } catch (e) { clearTimeout(t); res(null); }
    });
  }
  function pick(list) {   // several accounts: one big button each (login number and broker only)
    return new Promise(function (res) {
      h.textContent = 'Choose your cTrader account'; p.textContent = 'Which account should the charts use?';
      var box = document.createElement('div'); box.style.cssText = 'display:grid;gap:8px;margin:0 0 24px';
      list.forEach(function (x) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-secondary'; b.style.cssText = 'min-height:48px;text-align:left';
        b.textContent = (x.login ? '#' + x.login : 'Account') + (x.broker ? ' · ' + x.broker : '') + (x.isLive ? ' · Live' : ' · Demo');
        b.addEventListener('click', function () { box.remove(); h.textContent = 'Connecting cTrader…'; p.textContent = 'One moment.'; res(x); });
        box.appendChild(b);
      });
      p.after(box);
    });
  }
  // 24 Nov: say WHICH step failed, in plain words, and log the step + status to the console (never a token or a code).
  // Steps: token (functions/connect/ctrader/token.js), accounts (relay account list), save (device vault).
  function reason(step, e, trade) {
    e = e || {};
    var st = e.status, code = e.code || '', up = e.upstream || '';
    if (step === 'token') {
      if (code === 'not_set_up') return 'cTrader isn’t set up on TradeZoro yet.';
      if (code === 'rate' || st === 429) return 'Too many tries. Wait a minute, then try again.';
      if (code === 'auth' || st === 401) return 'Your TradeZoro sign-in expired. Sign in again, then try again.';
      if (code === 'rejected' || st === 400) return 'cTrader didn’t accept the sign-in. Please try again.';
      return 'cTrader didn’t answer. Please try again in a minute.';
    }
    if (step === 'accounts') {
      if (code === 'scope') return 'This cTrader app isn’t allowed to trade yet.';
      if (code === 'CH_ACCESS_TOKEN_INVALID' || code === 'OA_AUTH_TOKEN_EXPIRED') return 'cTrader didn’t accept the sign-in. Please try again.';
      if (code === 'relay') return 'Couldn’t reach cTrader. Please try again in a minute.';
      return 'cTrader didn’t send your account list. Please try again.';
    }
    if (step === 'save') return 'Couldn’t save the sign-in on this device. Allow site storage (not private mode), then try again.';
    return trade ? 'Something went wrong. Try again from the Trade menu in the charts.' : 'Something went wrong. Try again from Data source in the charts.';
  }
  function note(kind, step, e) {   // console only: step, HTTP status, our code, cTrader's error code. Never a token.
    e = e || {};
    try { console.warn('[ctrader-callback]', JSON.stringify({ kind: kind, step: step, status: e.status === undefined ? null : e.status, code: e.code || null, upstream: e.upstream || null, closeCode: e.closeCode || null })); } catch (x) { /* ignore */ }
  }
  // at(step, promise): a failure is tagged with the step it came from
  function at(step, pr) { return pr.catch(function (e) { throw { step: step, e: e }; }); }
  function trade(c, ct, tr, u) {   // "Allow trading": pick the account, keep it in the trading vault entry, back to the charts
    h.textContent = 'Allowing trading…';
    return at('token', u.getIdToken().then(function (idt) { return tr.swapTradeCode(code, idt); })).then(function (creds) {
      return at('accounts', ct.listAccounts(creds)).then(function (list) {
        // cTrader reports the token's scope with the account list: view-only here means the app (or the grant) has no trading permission
        if (list.scope === 0) throw { step: 'accounts', e: { code: 'scope' } };
        if (!list.length) { note('trade', 'accounts', { code: 'no_accounts' }); return end('No cTrader account found', 'No trading account found on this cTrader ID.'); }
        return (list.length === 1 ? Promise.resolve(list[0]) : pick(list)).then(function (x) {
          creds.accountId = x.id; creds.isLive = x.isLive; creds.login = x.login; creds.broker = x.broker;
          return at('save', c.bindUser(u.uid).then(function () { return tr.saveTradeCreds(creds); })).then(function () { try { localStorage.setItem('tz-ctrader-trade-at', String(Date.now())); } catch (e) { /* private mode */ } location.replace('/charts'); });
        });
      });
    }).catch(function (f) {
      var step = f && f.step ? f.step : 'other', e = f && f.step ? f.e : f;
      note('trade', step, e);
      end(step === 'accounts' && e && e.code === 'scope' ? 'Trading isn’t switched on' : 'Trading was not allowed', reason(step, e, true));
    });
  }
  user().then(function (u) {
    if (!u) return end('Sign in first', 'Sign in to TradeZoro, then connect cTrader again.');
    return Promise.all([import('./byo-core.js?v=1254'), import('./byo-ctrader.js?v=1254'), import('./ctrader-trade.js?v=1254')]).then(function (m) {
      var c = m[0], ct = m[1], tr = m[2];
      if (tr.takeTradeState(state, u.uid)) return trade(c, ct, tr, u);
      var rec = ct.takeCtraderState(state, u.uid);
      if (!rec) return end('cTrader was not connected', 'The sign-in link expired. Start again from Data source in the charts.');
      return at('token', u.getIdToken().then(function (idt) { return ct.ctraderTokenCall({ grant: 'code', code: code }, idt); }))
        .then(function (j) {
          var creds = ct.ctraderCreds(j);
          return at('accounts', ct.listAccounts(creds)).then(function (list) {
            if (!list.length) return end('No cTrader account found', 'This cTrader ID has no trading account to read prices from.');
            return (list.length === 1 ? Promise.resolve(list[0]) : pick(list)).then(function (x) {
              creds.accountId = x.id; creds.isLive = x.isLive;
              return at('save', c.bindUser(u.uid).then(function () { return c.saveSource('ctrader', creds, undefined, true); })).then(function () { location.replace('/charts'); });
            });
          });
        });
    });
  }).catch(function (f) {
    var step = f && f.step ? f.step : 'other', e = f && f.step ? f.e : f;
    note('data', step, e);
    end('cTrader was not connected', reason(step, e, false));
  });
})();
