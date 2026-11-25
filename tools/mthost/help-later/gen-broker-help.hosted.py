#!/usr/bin/env python3
"""Generates the public "Connect your broker" help pages (help/connect-broker*.html).
Run: python3 tools/gen-broker-help.py   (template = head/footer of help/desktop-bridge.html)
PUBLIC since 21 Nov 2026 (Owner decision: every signed-in member may connect their own broker and place live trades after the
one-time "Enable live trading" step). Listed in help-data.json (category rithmic) and the sitemap. No logo images, names only."""
import os, re, html

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tpl = open(os.path.join(ROOT, 'help', 'desktop-bridge.html'), encoding='utf-8').read()
head, rest = tpl.split('<main id="main"', 1)
foot = rest.split('</main>', 1)[1]
UPDATED = '21 November 2026'
DISC = '<p class="bh-small">Education only. Not financial advice. Live orders are real and use your own money. See <a href="/terms#broker-live">Broker connections and live trading</a> in the Terms. Beta.</p>'

STYLE = '''<style>
.bh-card{ border:1px solid var(--line,#2c2c32); border-radius:12px; padding:16px; margin:0 0 20px; background:var(--bg-2,rgba(255,255,255,.03)); }
.bh-card ul{ margin:8px 0 0; }
.bh-warn{ border-color:rgba(255,176,32,.6); background:rgba(255,176,32,.09); }
:root[data-theme="light"] .bh-warn{ border-color:rgba(176,112,0,.6); background:rgba(176,112,0,.08); }
.bh-small{ font-size:13px; line-height:20px; color:var(--ink-2,#8b93a0); margin:8px 0 0; }
.bh code{ font-family:var(--font-code); font-size:.9em; overflow-wrap:anywhere; }
.bh-path{ display:flex; flex-wrap:wrap; align-items:center; gap:8px; list-style:none; margin:0 0 20px; padding:0; }
.bh-path li{ display:inline-flex; align-items:center; min-height:32px; padding:0 12px; border:1px solid var(--line,#2c2c32); border-radius:999px; background:var(--bg-2,rgba(255,255,255,.04)); font-size:14px; line-height:20px; font-variant-numeric:tabular-nums; }
.bh-path li+li::before{ content:"\\203A"; margin:0 8px 0 -4px; color:var(--ink-2,#8b93a0); }
.bh-grid{ display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:16px; margin:0 0 24px; }
.bh-grid a{ display:flex; flex-direction:column; justify-content:flex-start; gap:4px; min-height:88px; padding:16px; border:1px solid var(--line,#2c2c32); border-radius:12px; background:var(--bg-2,rgba(255,255,255,.03)); text-decoration:none; color:inherit; }
.bh-grid a:hover,.bh-grid a:focus-visible{ border-color:var(--accent,#7aa2ff); }
.bh-grid b{ font-size:16px; line-height:24px; } .bh-grid span{ font-size:13px; line-height:20px; color:var(--ink-2,#8b93a0); }
.bh-tbl{ width:100%; border-collapse:collapse; margin:0 0 20px; font-size:14px; line-height:20px; }
.bh-tbl th,.bh-tbl td{ text-align:left; vertical-align:top; padding:10px 12px; border-bottom:1px solid var(--line,#2c2c32); }
.bh-tblw{ overflow-x:auto; margin:0 0 20px; } .bh-tblw .bh-tbl{ margin:0; min-width:520px; }
</style>
</head>'''

BROKERS = {
 'ibkr': dict(name='Interactive Brokers', short='IBKR', slug='connect-broker-interactive-brokers',
  blurb='Connect Interactive Brokers (IBKR): what you need, steps, what syncs.',
  login='your Interactive Brokers (IBKR) account. IBKR connects with a <strong>Flex token</strong> that you create yourself in IBKR Client Portal. It is not a normal login box.',
  types=['<strong>Live</strong> and <strong>paper</strong> IBKR accounts: the connection works from your IBKR account details. Our code does not tell live from paper, so check the account name shown in the list.',
         'Brokerage accounts with stocks, options, futures, forex or crypto. The connection service lists these product types for IBKR.'],
  auth=['Open the connect window and pick <strong>Interactive Brokers</strong>.',
        'The window asks for a <strong>Flex token</strong>. You create it in IBKR Client Portal (the window points you to IBKR\u2019s own steps; IBKR\u2019s menu names change, so follow IBKR\u2019s page). Paste the token in the window.',
        'Choose the accounts to share and finish.'],
  extra='<p><strong>Two-step login (2FA).</strong> If your IBKR account asks you to approve a login in the IBKR app when you open Client Portal, do that first. Which step asks for it is IBKR\u2019s choice, not ours, and we have not tested every case.</p>',
  syncs='The connection service lists IBKR as <strong>data only</strong>. You get your accounts, balances, positions, orders and fills to read. <strong>You cannot place or change IBKR orders from TradeZoro.</strong>',
  limits=['No order placing for IBKR. It is read only.',
          'A Flex token can expire or be removed in IBKR. Then the connection stops and you connect again.',
          'Balance is the figure IBKR last reported, not a live tick.'],
  faq=[('I cannot find where to make a Flex token.','Open IBKR Client Portal and look for the reporting or Flex area. IBKR moves menus around. The connect window links to IBKR\u2019s own steps.'),
       ('Does TradeZoro see my IBKR password?','No. You never type your IBKR password into TradeZoro. The token only gives read access to reports.'),
       ('Can I trade IBKR from the chart?','No. IBKR is read only here.')]),
 'ninjatrader': dict(name='NinjaTrader', short='NinjaTrader', slug='connect-broker-ninjatrader',
  blurb='Connect NinjaTrader: logins, steps, what syncs.',
  login='your <strong>NinjaTrader</strong> account login. You sign in on NinjaTrader\u2019s own page and approve access (an OAuth sign-in).',
  types=['NinjaTrader brokerage accounts, <strong>live</strong> and <strong>sim</strong>, that your NinjaTrader login can see.',
         'Futures and other products NinjaTrader lists for the account.',
         'Prop firm accounts that sit on the NinjaTrader platform and log in with NinjaTrader credentials may show up. If your firm gave you a Rithmic login instead, use the Rithmic guide.'],
  auth=['Open the connect window and pick <strong>NinjaTrader</strong>.','A NinjaTrader sign-in page opens. Log in with your NinjaTrader username and password there.','Approve access when NinjaTrader asks, then choose the accounts to share.'],
  extra='<p><strong>This is not the Data Bridge.</strong> The <a href="/help/desktop-bridge">Data Bridge</a> add-on only sends prices to a chart. Connecting a broker reads your account, positions, balance and fills.</p>',
  syncs='Accounts, balance, positions, orders and fills. You can also place live orders from the chart once you enable live trading for your account.',
  limits=['If your account list is empty, the login you used has no account the connection can read.','Balance can be a little behind NinjaTrader (see Troubleshooting in the hub).'],
  faq=[('Which login do I use?','The same one you use at NinjaTrader\u2019s own site or platform.'),
       ('My prop firm gave me a NinjaTrader login. Does it work?','Try it. If the sign-in page rejects it, ask your firm which platform login it is.')]),
 'rithmic': dict(name='Rithmic', short='Rithmic', slug='connect-broker-rithmic',
  blurb='Connect Rithmic: which logins work, steps, what syncs.',
  login='your <strong>Rithmic username and password</strong>, the one you use in R | Trader Pro. This is not the login for your firm\u2019s website.',
  types=['Futures accounts that log in through Rithmic: <strong>live</strong>, <strong>sim/evaluation</strong> and <strong>funded</strong> prop firm accounts.',
         'Prop firms that run on Rithmic give you a separate Rithmic username and password (for example Bulenox, as in our <a href="/help#rithmic-errors">Rithmic data guide</a>). We do not keep a checked list of every firm. If you can sign in to R | Trader Pro with it, it is a Rithmic login.',
         'Not sure? Look in your firm\u2019s welcome email or dashboard for \u201cRithmic\u201d, or ask their support.'],
  auth=['Open the connect window and pick <strong>Rithmic</strong>.','Enter your Rithmic username and password in the sign-in form. Rithmic uses a username and password, so this is the one broker here where you type them (in the secure connect window, not in TradeZoro).','Choose the accounts to share and finish.'],
  extra='<p><strong>Rithmic data vs broker connection.</strong> The chart\u2019s <em>Data source</em> then Rithmic gives futures prices. Connecting a broker here reads your account (positions, balance, fills). They are separate.</p>',
  syncs='Futures accounts: balance, positions, orders and fills. You can also place live orders from the chart once you enable live trading for your account.',
  limits=['Futures only.','A new Rithmic login must first accept the market data agreements in R | Trader Pro, or the sign-in can be refused.','Some firms must allow third-party apps on your login. If the same login works in R | Trader Pro but not here, ask your firm.'],
  faq=[('Is my Rithmic password safe?','TradeZoro never sees it. It goes to our connection service, which keeps it encrypted and uses it only to keep your session open. Disconnect removes the link.'),
       ('Which firms use Rithmic?','Ask your firm. We only know a firm uses Rithmic when it gives you a Rithmic username. We do not publish a list.')]),
 'tastytrade': dict(name='tastytrade', short='tastytrade', slug='connect-broker-tastytrade',
  blurb='Connect tastytrade: login, steps, what syncs.',
  login='your <strong>tastytrade</strong> login. You sign in on tastytrade\u2019s own page and approve access (an OAuth sign-in).',
  types=['tastytrade brokerage accounts, <strong>live</strong> and <strong>paper</strong> where tastytrade offers them on your login.','Stocks, options, futures, forex and crypto, as listed for tastytrade.'],
  auth=['Open the connect window and pick <strong>tastytrade</strong>.','A tastytrade sign-in page opens. Log in with your tastytrade username and password there.','Approve access when tastytrade asks, then choose the accounts to share.'],
  extra='',
  syncs='Accounts, balance, positions, orders and fills. You can also place live orders from the chart once you enable live trading for your account.',
  limits=['Event contracts: tastytrade offers them but they are not available through our connection.','tastytrade needs a funded and approved account before it shows anything to read.'],
  faq=[('Can I connect more than one tastytrade account?','Yes. Tick every account you want on the \u201cchoose accounts\u201d step.'),
       ('The sign-in page asks for a code.','That is tastytrade\u2019s own two-step login. Enter the code it sends or shows.')]),
 'tradovate': dict(name='Tradovate', short='Tradovate', slug='connect-broker-tradovate',
  blurb='Connect Tradovate: logins, prop firm accounts, steps, what syncs.',
  login='your <strong>Tradovate</strong> login. You sign in on Tradovate\u2019s own page and approve access (an OAuth sign-in).',
  types=['Tradovate <strong>live</strong> accounts and <strong>sim</strong> (demo) accounts on your login.','Prop firm accounts that run on Tradovate (they show as accounts under your Tradovate login). Many firms use a Tradovate login; if yours gave you a Rithmic login instead, use the Rithmic guide.','Futures, options and forex, as listed for Tradovate.'],
  auth=['Open the connect window and pick <strong>Tradovate</strong>.','A Tradovate sign-in page opens. Log in with your Tradovate username and password there.','Approve access when Tradovate asks, then choose the accounts to share.'],
  extra='<p><strong>Account names.</strong> Tradovate also has a long number for each account. TradeZoro shows the account <em>name</em> from Tradovate. In the Trade menu you can rename an account with <strong>Edit details</strong> (label, prop firm and type: Evaluation, Funded, Live or Sim). Labels are for you only.</p>',
  syncs='Accounts, balance, positions, orders and fills. You can also place live orders from the chart once you enable live trading for your account.',
  limits=['If you have a live and a sim account, both are listed. Check the name before you use one.','Balance is the last figure Tradovate reported plus fills since then, so it can lag a little.'],
  faq=[('Do prop firm accounts show up?','If the firm\u2019s accounts sit under your Tradovate login, yes. Rename them with Edit details.'),
       ('Same login as the Tradovate app?','Yes, the one you use at Tradovate\u2019s own site.')]),
 'webull': dict(name='Webull', short='Webull', slug='connect-broker-webull',
  blurb='Connect Webull: login, steps, what syncs.',
  login='your <strong>Webull</strong> login. You sign in on Webull\u2019s own page and approve access (an OAuth sign-in).',
  types=['Webull brokerage accounts on your login.','Stocks, options, crypto, forex and futures, as listed for Webull. We have not checked which of these your own Webull account has switched on.'],
  auth=['Open the connect window and pick <strong>Webull</strong>.','A Webull sign-in page opens. Log in with your Webull login there.','Approve access when Webull asks, then choose the accounts to share.'],
  extra='',
  syncs='Accounts, balance, positions, orders and fills. You can also place live orders from the chart once you enable live trading for your account.',
  limits=['The journal import is built around futures round trips. For stocks and options, read the preview carefully before you import.','Balance can be a little behind Webull.'],
  faq=[('Webull asks me to verify.','That is Webull\u2019s own check. Finish it, then continue.'),
       ('Do I need an API application at Webull?','Our connection handles the sign-in. If Webull asks for something extra on its page, follow Webull\u2019s steps.')]),
}
def mt(v):
    o = 'MT4' if v == '4' else 'MT5'; app = 'MetaTrader %s' % v; ex = 'MQL4/Experts' if v == '4' else 'MQL5/Experts'
    algo = 'AutoTrading' if v == '4' else 'Algo Trading'
    hosted = (v == '5')
    adv = """<h2 id="advanced">Advanced: use your own MetaTrader</h2>
<p>You can also keep %(app)s running on your own computer and link it with a small add-on (an Expert Advisor, \u201cEA\u201d). Use this if you want to see the terminal yourself%(why)s.</p>
<ol><li>Open the connect window and pick <strong>%(app)s</strong>%(own)s. It shows <strong>connector details</strong> (an address, a connector ID and a connector secret). <strong>The secret is shown once</strong>: keep that tab open until you have pasted it.</li>
<li>Download the connector add-on from the link there. In %(app)s choose <strong>File \u203a Open Data Folder</strong> and copy it into <code>%(ex)s</code>. Restart %(o)s (or refresh <strong>Navigator \u203a Expert Advisors</strong>).</li>
<li>In <strong>Tools \u203a Options \u203a Expert Advisors</strong> tick <strong>Allow WebRequest for listed URL</strong> and add the address (only the <code>https://</code> part and the host name).</li>
<li>Drag the EA onto any chart. In its <strong>Inputs</strong> paste the address, connector ID, secret and secret version. Leave <strong>sign envelopes</strong> switched on.</li>
<li>Switch on <strong>%(algo)s</strong> in the %(o)s toolbar. After about 15 seconds the connector shows as online. Choose the account and finish.</li></ol>
<div class="bh-card bh-warn"><strong>Keep %(o)s running.</strong> With your own terminal, TradeZoro cannot read the account or send orders while the terminal is closed, the computer sleeps, or %(algo)s is off. An order sent while it is offline waits up to 90 seconds and then fails; it is not kept for later. Stop loss, take profit and closing a position are done in MetaTrader on this path.</div>""" % dict(app=app, ex=ex, o=o, algo=algo, why=' or to run your own add-ons', own=' (the Advanced option)' if hosted else '')
    extra = """<div class="bh-card bh-warn"><strong>Prop firm rules.</strong> Some firms do not allow outside tools on their accounts. Read your firm\u2019s rules or ask its support before you connect. If your firm blocks outside tools, the sign-in will not work.</div>""" if hosted else """<div class="bh-card bh-warn"><strong>MetaTrader 4 sign-in is not open yet.</strong> For now %(o)s works the Advanced way: a small add-on in your own terminal. MetaTrader 5 accounts can sign in with login, password and server.</div>""" % dict(o=o)
    after = """<h2 id="symbols">Symbols: chart vs broker</h2>
<p>MetaTrader brokers name their instruments their own way. The Nasdaq 100 is <code>NDX100</code> at one firm and <code>US100</code>, <code>NAS100</code>, <code>USTEC</code> or <code>US100.cash</code> at others. TradeZoro charts use exchange symbols (NQ, ES, the index itself, or the forex pair).</p>
<ul><li>When a %(o)s account is picked, the order panel shows a <strong>%(o)s symbol</strong> box next to the chart name. If your account\u2019s symbol list says which one it is, it is filled in for you.</li>
<li>If not, pick it once from the list, or choose <strong>Other\u2026</strong> and type the name <strong>exactly</strong> as MetaTrader\u2019s <strong>Market Watch</strong> shows it (including any ending like <code>.cash</code> or <code>.r</code>). TradeZoro remembers it for that chart instrument and that account on this device.</li>
<li>One choice covers related charts: NQ, MNQ and Nasdaq 100 index charts all trade the Nasdaq 100 symbol you picked.</li></ul>
<div class="bh-tblw"><table class="bh-tbl"><thead><tr><th>Chart</th><th>Usual MetaTrader names (check yours)</th></tr></thead><tbody>
<tr><td>NQ, MNQ, Nasdaq 100</td><td><code>NDX100</code> <code>US100</code> <code>NAS100</code> <code>USTEC</code></td></tr>
<tr><td>ES, MES, S&amp;P 500</td><td><code>US500</code> <code>SPX500</code> <code>SP500</code></td></tr>
<tr><td>YM, MYM, Dow 30</td><td><code>US30</code> <code>DJ30</code> <code>WS30</code></td></tr>
<tr><td>RTY, M2K, Russell 2000</td><td><code>US2000</code> <code>RUSS2000</code></td></tr>
<tr><td>GC, MGC (gold)</td><td><code>XAUUSD</code> <code>GOLD</code></td></tr>
<tr><td>CL, MCL (crude oil)</td><td><code>USOIL</code> <code>WTI</code> <code>XTIUSD</code></td></tr>
<tr><td>Forex pairs (EURUSD and others)</td><td>The same pair, sometimes with an ending like <code>EURUSD.m</code></td></tr></tbody></table></div>
<p><strong>Prices differ.</strong> A futures chart (NQ) is not your broker\u2019s CFD price (NDX100): the two move together but are not the same number. So from a futures or index chart only <strong>market</strong> orders go to MetaTrader, and no order lines are drawn on the chart. Limit and stop orders from the chart need a chart of the broker\u2019s own instrument, such as a forex pair or spot gold (XAUUSD).</p>
<h2 id="lots">Size in lots</h2>
<ul><li>MetaTrader trades in <strong>lots</strong>, not contracts. The size box shows lots and steps by the account\u2019s lot step (usually 0.01, the smallest lot).</li>
<li>What one lot is worth is set by your broker for each symbol. Check the symbol\u2019s <strong>Specification</strong> in Market Watch before you size a trade.</li>
<li>TradeZoro sets no size limit of its own. Your broker applies its own lot limits and its message is shown if it refuses an order.</li></ul>
""" % dict(o=o) + adv
    if hosted:
        types=['<strong>%s</strong> accounts at a broker or prop firm: live, demo, evaluation and funded.' % app,
               '<strong>Prop firm accounts</strong>: sign in with the login number, password and server name from the firm\u2019s dashboard or welcome email. That is the only login you need. The firm\u2019s website login is not used.',
               'Forex, indices, gold, oil and the other CFDs your account can trade, sized in <strong>lots</strong>.',
               'Each MetaTrader account is one connection. With two accounts you sign in twice.']
        auth=['Open the connect window and pick <strong>%s</strong>.' % app,
              'Search for your <strong>server</strong> by name and pick it. Type the exact name from your broker\u2019s email if it is not in the list.',
              'Enter your <strong>login</strong> (the account number) and <strong>password</strong>. Turn on <strong>Read-only (investor password)</strong> if you only want to watch the account and use the investor password.',
              'Tap <strong>Connect</strong>. It takes a few seconds while the account signs in. The account then appears in the Trade menu like any other.']
        syncs='Balance and equity, open positions and working orders, and your trade history. Orders from TradeZoro (market, limit, stop, with optional stop loss and take profit, and closing a position) are placed on your account after you enable live trading once. Read-only accounts never place orders.'
        limits=['<strong>Your password is kept safe.</strong> It is encrypted on our server, used only to keep your account connected, never shown again and never put in your browser. Removing the account deletes it.',
                'Read-only (investor password) accounts can be watched but never traded from TradeZoro.',
                'Some firms do not allow outside tools. If yours blocks the sign-in, use your firm\u2019s own platform.',
                'No order lines or DOM ladder on a chart whose prices are not the broker\u2019s instrument (see Symbols).']
        faq=[('Does TradeZoro see my MetaTrader password?','You type it into the connect window once. It is encrypted on our server and used only to keep your account connected. It is never shown again, never sent back to your browser, and deleted when you remove the account.'),
             ('What is the investor password?','A second, view-only password most brokers let you set. It shows balance and trades but cannot place orders. Use it with the Read-only switch if you only want to watch.'),
             ('My server is not in the list.','Type it exactly as your broker wrote it. The list only helps you search.'),
             ('It says the login, password or server is not right.','Check all three. Prop firms: use the server name from your welcome email, not the website login. Demo and live accounts use different servers.'),
             ('Do I need to keep MetaTrader running on my computer?','No. The account stays connected on our side. If you prefer your own terminal, see Advanced: use your own MetaTrader.'),
             ('I trade the NDX100 CFD. How do I connect it?','Sign in as above. On an NQ or Nasdaq 100 chart pick <code>NDX100</code> as the MT5 symbol once, and size in lots.'),
             ('My symbol is not in the list.','Choose <strong>Other\u2026</strong> and type it exactly as Market Watch shows it. If the name is wrong the broker rejects the order; pick the box again to change it.')]
        login='A MetaTrader 5 <strong>login, password and server</strong> from your broker or prop firm. Nothing to install or keep running.'
        blurb='Connect %s with login, password and server: the safe password, read-only, symbols, lots, what syncs.' % app
    else:
        types=['<strong>%s</strong> accounts at a broker or prop firm: live, demo, evaluation and funded.' % app, 'Forex, indices, gold, oil and the other CFDs your account can trade, sized in <strong>lots</strong>.', 'Each MetaTrader account is one connection.']
        auth=['Follow the steps under <strong>Advanced: use your own MetaTrader</strong> below. Sign-in with login, password and server is available for MetaTrader 5 first.']
        syncs='Accounts, balance, open positions and working orders, read through the add-on. Orders from TradeZoro (market, limit, stop) go to the add-on, which places them in your terminal. Orders work after you enable live trading once.'
        limits=['Your terminal must be running with the add-on attached and %s on.' % algo, 'Stop loss, take profit and closing a position: set them in MetaTrader for now.', 'No order lines or DOM ladder on a chart whose prices are not the broker\u2019s instrument (see Symbols).', 'If you make a new connector secret, paste it into the add-on, or connect again.']
        faq=[('Does TradeZoro see my MetaTrader password?','No. On this path you type it into MetaTrader only. The add-on uses its own connector secret.'),
             ('The connector does not show online.','Check that the terminal is open, the add-on is on a chart, %s is on, and the WebRequest list has the address from the connect window. If you made a new secret, paste the new one.' % algo),
             ('MetaTrader 4 or 5?','Use the one your broker or firm gave you a login for. MT4 uses <code>MQL4/Experts</code>, MT5 uses <code>MQL5/Experts</code>.'),
             ('My symbol is not in the list.','Choose <strong>Other\u2026</strong> and type it exactly as Market Watch shows it.'),
             ('Can I use a phone?','The add-on needs desktop MetaTrader; the phone app cannot run it. Once the desktop terminal is running, you can trade from TradeZoro on any device.')]
        login='%s on a computer, logged in to your trading account, with the connector add-on.' % app
        blurb='Connect %s: the connector add-on, symbols, lots, what syncs.' % app
    return dict(name=app, short=o, slug='connect-broker-metatrader-%s' % v, blurb=blurb, login=login, types=types, auth=auth, extra=extra, after=after, syncs=syncs, limits=limits, faq=faq)
BROKERS['mt4'] = mt('4'); BROKERS['mt5'] = mt('5')
ORDER = ['ibkr','mt4','mt5','ninjatrader','rithmic','tastytrade','tradovate','webull']
HUB = 'connect-broker'

def page(slug, title, desc, h1, body):
    h = head
    h = re.sub(r'<meta name="description" content="[^"]*">', '<meta name="description" content="%s">' % html.escape(desc, True), h)
    for k in ('og:title','twitter:title'):
        h = re.sub(r'(<meta (?:property|name)="%s" content=")[^"]*' % k, lambda m: m.group(1) + html.escape(title, True), h)
    for k in ('og:description','twitter:description'):
        h = re.sub(r'(<meta (?:property|name)="%s" content=")[^"]*' % k, lambda m: m.group(1) + html.escape(desc, True), h)
    h = h.replace('og:url" content="https://tradezoro.com/help/desktop-bridge"', 'og:url" content="https://tradezoro.com/help/%s"' % slug)
    h = h.replace('<link rel="canonical" href="https://tradezoro.com/help/desktop-bridge">', '<link rel="canonical" href="https://tradezoro.com/help/%s">' % slug)
    h = re.sub(r'<title>[^<]*</title>', '<title>%s | TradeZoro</title>' % html.escape(title), h)
    h = re.sub(r'<style>[\s\S]*?</style>\n</head>', lambda m: STYLE, h)
    return (h + '<main id="main" tabindex="-1">\n<header class="site-page-hero"><div class="container"><h1 id="site-page-title">%s</h1>\n<span class="updated-note">Beta · Last updated %s</span></div></header>\n<div class="container"><div class="article-wrap"><div class="article-body bh">\n%s\n</div></div></div>\n</main>' % (h1, UPDATED, body) + foot)

PATH = '<ol class="bh-path" aria-label="The steps in TradeZoro"><li>Charts</li><li>Trade menu</li><li>Connect a broker</li><li>Pick your broker</li><li>Log in</li><li>Choose accounts</li><li>Done</li></ol>'

def hub():
    cards = ''.join('<a href="/help/%s"><b>%s</b><span>%s</span></a>' % (BROKERS[k]['slug'], BROKERS[k]['name'], BROKERS[k]['blurb'].split(':')[1].strip().capitalize()) for k in ORDER)
    return '''<p>Connecting a broker links your trading account to TradeZoro. It is optional. This page explains what it does, what you need, and how to fix the common problems. Then pick your broker below for its own step by step guide.</p>
<div class="bh-card"><strong>In short</strong>
<ul><li><strong>Your broker password stays with your broker.</strong> You log in on the broker\u2019s own page, not on a TradeZoro form.</li>
<li><strong>It reads your account.</strong> Trades and fills for the journal, open positions, and your balance.</li>
<li><strong>Live orders after one step.</strong> Live trading is off until you enable it once for your account and accept the risk notice. Until then your broker accounts are view-only.</li></ul>%s</div>
<h2 id="brokers">Pick your broker</h2>
<div class="bh-grid">%s</div>
<h2 id="what">What connecting does</h2>
<div class="bh-tblw"><table class="bh-tbl"><thead><tr><th>Part</th><th>What you get</th></tr></thead><tbody>
<tr><td>Accounts</td><td>The accounts you tick in the connect window appear in the Trade menu and in the journal sync.</td></tr>
<tr><td>Journal sync</td><td>Your fills become journal trades (round trips from flat to flat). Syncing the same days twice adds nothing twice. Trades still open are not imported.</td></tr>
<tr><td>Positions</td><td>Your open position and working orders are read from the broker and shown on the chart panel.</td></tr>
<tr><td>Balance</td><td>The broker\u2019s last reported balance. If the broker\u2019s figure is old, TradeZoro adds the profit or loss of fills made after it.</td></tr>
<tr><td>Live orders</td><td>From the chart, after you enable live trading once (see below). TradeZoro sets no limits of its own: your broker decides which symbols and sizes it accepts, and its message is shown if it refuses. Interactive Brokers is read only.</td></tr></tbody></table></div>
<h2 id="before">Before you start</h2>
<ul><li>An account at the broker with its login working. Log in once at the broker yourself first.</li>
<li>A computer or tablet browser is easiest. The broker page opens in a <strong>new tab</strong>, so allow pop-ups for TradeZoro.</li>
<li>Your two-step login (2FA) device, if the broker uses one.</li>
<li>For a prop firm account: the login type your firm gave you (Rithmic, Tradovate, NinjaTrader or MetaTrader 4 / 5). The firm\u2019s website login is not the one to use.</li></ul>
<h2 id="how">How to connect</h2>
%s
<ol><li>Open a chart and click <strong>Trade</strong> in the toolbar. (In the order panel you can also open the account picker and choose <strong>Connect a broker\u2026</strong>.)</li>
<li>At the bottom of the menu click <strong>Connect a broker</strong>. The connect window opens.</li>
<li>Click <strong>Connect a broker</strong> in the window. A new tab opens with the broker list.</li>
<li>Pick your broker and log in there. Choose the accounts you want to share.</li>
<li>Come back to TradeZoro and click <strong>Continue</strong>. The window closes and your accounts show in the Trade menu.</li></ol>
<p>In the journal the same window is the <strong>Broker sync (beta)</strong> button. After connecting you choose an account and dates, click <strong>Load trades</strong>, check the preview and import.</p>
<h2 id="live">Enable live trading</h2>
<p>Live orders are real and use your own money at your broker. Before your first live order TradeZoro asks you once:</p>
<ol><li>In the Trade menu pick one of your broker accounts (Paper stays the default).</li>
<li>Try your first order, or click <strong>Enable live trading</strong>. A short risk notice opens.</li>
<li>Read it, tick the box and click <strong>Enable live trading</strong>. We save when you accepted it.</li></ol>
<p>After that, clicking Buy, Sell, Flatten or the order book sends a real order to your broker. There is no extra confirm step. TradeZoro is not a broker and gives no advice; you are responsible for your orders. If you click <strong>Not now</strong>, the account stays view-only. TradeZoro can switch live trading off for everyone or for one account at any time.</p>
<p>Have several accounts? <a href="/help/copy-trading">Copy trading across your accounts</a> copies an order you place on one of them to the others.</p>
<h2 id="disconnect">How to disconnect</h2>
<ol><li>Open the <strong>Trade</strong> menu.</li><li>Click the small gear on the account, then <strong>Disconnect</strong> (or <strong>Manage</strong> to see all accounts), then confirm.</li></ol>
<p>This removes the link. Trades already imported stay in your journal. You can connect again any time. You can also remove TradeZoro\u2019s access in your broker\u2019s own settings.</p>
<h2 id="privacy">Privacy</h2>
<ul><li><strong>We never see your broker password.</strong> You log in on the broker\u2019s own page. For Rithmic, which uses a username and password, you type them in the secure connect window, and TradeZoro does not receive or store them.</li>
<li>TradeZoro reads your accounts, balance, positions, orders and fills. It sends an order only when you click to trade, after you enabled live trading.</li>
<li>MetaTrader: you log in only in MetaTrader. The connector add-on uses its own secret, not your MetaTrader password.</li>
<li>Your account details stay in your own view. We do not show them to other members.</li></ul>
<h2 id="fix">Troubleshooting</h2>
<ul><li><strong>It asks me to log in again.</strong> The saved link expired. Open the Trade menu and click <strong>Reconnect</strong>. If that does not help, click <strong>Connect a broker</strong> and sign in again.</li>
<li><strong>My account is not in the list.</strong> You did not tick it on the choose-accounts step, or the login you used cannot see it. Click <strong>Connect a broker</strong> again, sign in, tick the account. Brand new accounts can take a few minutes to appear.</li>
<li><strong>The new tab did not open.</strong> Allow pop-ups for TradeZoro and click <strong>Open the broker tab again</strong>.</li>
<li><strong>The balance looks old.</strong> Brokers refresh their balance on their own schedule. TradeZoro shows the broker\u2019s last figure plus the result of fills after it, and re-reads it every 30 seconds while the Trade menu is open. Compare with your broker\u2019s own screen.</li>
<li><strong>\u201cNo clear answer from the broker.\u201d</strong> The broker did not confirm your last order, so it may or may not be live. <strong>Check your working orders and position at the broker first</strong>. Do not send it again until you know. The chart blocks new orders until it can read the account again.</li>
<li><strong>\u201cBroker data is unavailable right now.\u201d</strong> The connection service or the broker is down for a moment. Wait a minute and try again.</li>
<li><strong>Journal import found no trades.</strong> Widen the dates. Only closed trades are imported.</li></ul>
<p>Still stuck? <a href="https://discord.gg/M4d4gTr5c3" target="_blank" rel="noopener">Get help on Discord</a> (#help-and-support channel) or <a href="/contact">contact us</a>.</p>
%s''' % (DISC, cards, PATH, DISC)

def broker(k):
    b = BROKERS[k]
    types = ''.join('<li>%s</li>' % t for t in b['types'])
    auth = ''.join('<li>%s</li>' % t for t in b['auth'])
    lim = ''.join('<li>%s</li>' % t for t in b['limits'])
    faq = ''.join('<h3>%s</h3><p>%s</p>' % (q, a) for q, a in b['faq'])
    others = ' · '.join('<a href="/help/%s">%s</a>' % (BROKERS[o]['slug'], BROKERS[o]['name']) for o in ORDER if o != k)
    return '''<p>This guide connects <strong>%(n)s</strong> to TradeZoro. Read the <a href="/help/%(hub)s">Connect your broker</a> guide first if you want the big picture.</p>
<div class="bh-card"><strong>What you need</strong><ul><li>%(login)s</li><li>The accounts you want to share, ready at %(n)s.</li><li>Pop-ups allowed for TradeZoro (the sign-in opens in a new tab).</li></ul></div>
<h2 id="accounts">Accounts that work</h2><ul>%(types)s</ul>%(extra)s
<h2 id="steps">Step by step</h2>
%(path)s
<ol><li>Open a chart and click <strong>Trade</strong>, then <strong>Connect a broker</strong> at the bottom of the menu. (Journal: <strong>Broker sync (beta)</strong>.)</li>
<li>In the connect window click <strong>Connect a broker</strong>. A new tab opens.</li>
%(auth)s
<li>Go back to the TradeZoro tab and click <strong>Continue</strong>. Your %(n)s accounts show in the Trade menu.</li>
<li>Journal only: pick the account and dates, click <strong>Load trades</strong>, check the preview, then <strong>Import</strong>.</li></ol>
%(after)s<h2 id="syncs">What syncs</h2><p>%(syncs)s</p>
<h2 id="limits">Known limits</h2><ul>%(lim)s</ul>
<h2 id="disconnect">Disconnect</h2><p>Trade menu, gear on the account, <strong>Disconnect</strong>, confirm. Imported journal trades stay. You can also remove access in %(n)s\u2019s own settings.</p>
<h2 id="faq">FAQ</h2>%(faq)s
<h3>Something went wrong. Where do I look?</h3><p>See Troubleshooting in <a href="/help/%(hub)s#fix">Connect your broker</a>. If you get \u201cno clear answer from the broker\u201d, check your working orders at %(n)s before you send anything again.</p>
<p class="bh-small">Other brokers: %(others)s</p>
%(disc)s''' % dict(n=b['name'], hub=HUB, login=b['login'], types=types, extra=b['extra'], path=PATH, after=b.get('after', ''), auth=auth, syncs=b['syncs'], lim=lim, faq=faq, others=others, disc=DISC)

COPY_PATH = '<ol class="bh-path" aria-label="The steps in TradeZoro"><li>Charts</li><li>Trade menu</li><li>Copy trading</li><li>Leader</li><li>Followers</li><li>Save</li></ol>'
def copy_page():
    # Copy trading across your own accounts (Owner order 21 Nov 2026). The panel links here (assets/chart-copy.js).
    return '''<p>Copy trading sends an order you place on one of your accounts (the <strong>leader</strong>) to your other accounts (the <strong>followers</strong>). It works across brokers and with Paper. It only ever uses <strong>your own</strong> connected accounts. You cannot copy another member, and nobody can copy you.</p>
<div class="bh-card bh-warn"><strong>Copied orders are real orders</strong><ul><li>Every live follower gets a real order at its broker, using that account\u2019s money.</li><li>Prop firms and brokers may have rules about copy trading or trading the same idea on several accounts. Check your firm\u2019s rules before you turn it on.</li><li>TradeZoro is not a broker and gives no advice. Copied orders are your own orders; see <a href="/terms#copy-trading">the Terms</a>.</li></ul></div>
<h2 id="what">What is copied</h2>
<ul><li><strong>Orders you place in TradeZoro</strong> on the leader: market, limit and stop orders, the stop loss and take profit you add, moving an order, cancelling it, and Flatten.</li>
<li>Each follower gets its order <strong>right after the leader\u2019s order is accepted</strong>. If the leader\u2019s order is refused or has no clear answer, nothing is sent to the followers.</li>
<li><strong>Orders you place in your broker\u2019s own platform are not copied.</strong> The broker connection does not give TradeZoro a reliable live feed of those orders, so we do not try.</li></ul>
<h2 id="setup">Set it up</h2>
%s
<ol><li>Connect your brokers and pick a live account once in the Trade menu, then <strong>Enable live trading</strong> (see <a href="/help/connect-broker#live">Connect your broker</a>).</li>
<li>Open a chart, click <strong>Trade</strong>, then <strong>Copy trading</strong> at the bottom of the menu.</li>
<li>Pick the <strong>Leader account</strong>.</li>
<li>Switch on each <strong>follower</strong> you want and set its rules (below).</li>
<li>Switch <strong>Copy trading on</strong> and click <strong>Save</strong>. The first time, a short confirm asks you to accept that copied orders are real orders.</li></ol>
<h2 id="rules">Rules per follower</h2>
<div class="bh-tblw"><table class="bh-tbl"><thead><tr><th>Setting</th><th>What it does</th></tr></thead><tbody>
<tr><td>On / off</td><td>Copy to this account or not.</td></tr>
<tr><td>Same size</td><td>The follower gets the same quantity as the leader.</td></tr>
<tr><td>Multiplier</td><td>x0.1 to x10 of the leader\u2019s quantity, rounded to whole contracts. If it rounds to 0, that order is skipped for this account.</td></tr>
<tr><td>Fixed qty</td><td>The same quantity on every copied order, whatever the leader trades.</td></tr>
<tr><td>Contract</td><td>Same contract, or map it: <strong>Micro</strong> (NQ to MNQ, ES to MES) or <strong>Full size</strong> (MNQ to NQ). Same month.</td></tr>
<tr><td>Copy exits</td><td>On by default. Copies Flatten and the stop loss / take profit. Off: only entries are copied, and you manage exits on that account yourself.</td></tr>
</tbody></table></div>
<h2 id="status">See what happened</h2>
<p>After each copied order you see a short message per account, and the <strong>Copy status</strong> list in the panel shows every account: <strong>Sent</strong>, <strong>Filled</strong>, <strong>Rejected</strong> (with the broker\u2019s message), or <strong>Skipped</strong> (with the reason). One account failing never stops the others. Every copied order is logged on its own, with its own duplicate guard, so a repeated tap never sends it twice.</p>
<h2 id="safety">Stop it fast</h2>
<ul><li><strong>Pause copying</strong>: one tap. Orders on the leader still go; nothing is copied until you resume.</li>
<li><strong>Flatten all copied</strong>: closes the chart\u2019s contract (or its mapped contract) and cancels its working orders on every follower. The leader is not touched.</li>
<li>If TradeZoro switches live trading off for everyone or for your account, no copied order goes out either.</li></ul>
<h2 id="faq">FAQ</h2>
<h3>Can I copy a friend\u2019s trades, or let others copy mine?</h3><p>No. Copy trading only works between accounts connected to your own TradeZoro login.</p>
<h3>Can a follower be on a different broker?</h3><p>Yes, any connected broker that allows orders from TradeZoro, plus Paper. Some brokers are read only (see each broker\u2019s guide); copies to them are rejected with the broker\u2019s message.</p>
<h3>The leader filled but a follower was rejected. What now?</h3><p>Read the message in Copy status, then check that account at its broker. TradeZoro does not retry on its own.</p>
<p class="bh-small">Related: <a href="/help/%s">Connect your broker</a></p>
%s''' % (COPY_PATH, HUB, DISC)

def main():
    out = os.path.join(ROOT, 'help')
    open(os.path.join(out, HUB + '.html'), 'w', encoding='utf-8').write(page(HUB, 'Connect your broker', 'What connecting a broker does in TradeZoro, what you need, how to disconnect, privacy and fixes.', 'Connect your broker', hub()))
    for k in ORDER:
        b = BROKERS[k]
        open(os.path.join(out, b['slug'] + '.html'), 'w', encoding='utf-8').write(page(b['slug'], 'Connect %s: step by step' % b['name'], b['blurb'], 'Connect %s: step by step' % b['name'], broker(k)))
    open(os.path.join(out, 'copy-trading.html'), 'w', encoding='utf-8').write(page('copy-trading', 'Copy trading across your accounts', 'Copy orders you place in TradeZoro from one of your accounts to your other accounts: setup, size rules, contract mapping and safety.', 'Copy trading across your accounts', copy_page()))
    print('wrote', 2 + len(ORDER), 'pages')

main()
