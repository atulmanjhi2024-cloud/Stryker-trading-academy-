#!/usr/bin/env python3
"""FEATC feature pages (Owner 19 Nov 2026): Market Stats, Global Monitor, Smart Money Desk, Community, Creator Hub and
Curriculum on the shared template. Reuses build.py (FEATA generator: build_main/write + helpers); only the page specs
live here. Run: python3 tools/feature-pages/build-featc.py [page ...]   (no args = all six)
Screens: assets/images/features/<page>/ (cut by crop-featc.py from shoot-featc.js captures).
Feature indexes come from the code where a list exists (Market Stats reports from market-stats-core.js, curriculum
counts from chapters-index.js, badge counts from achievements-data.js); the rest lists the real panels/controls of
each tool page. Copy rules: no prices, no results/win-rate claims, no vendor or data-provider names, no "real-time".
Education only. Not financial advice."""
import json, pathlib, re, subprocess, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import build as B
from html import escape as E

ROOT = B.ROOT

# extra icons for tools that have no product tile image (same 24px stroke family as build.ICON)
B.ICON.update({
  'globe': '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
  'bank': '<path d="M3 10h18M5 10v8M9.7 10v8M14.3 10v8M19 10v8M3 20h18M12 3l9 5H3z"/>',
  'users': '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M15.5 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.4 3.5 5.2"/>',
})
_picon = B.picon
def picon(name, size):
    """Product tile image, or for 'svg:<icon>' a tile-shaped svg badge in the same box."""
    if not name.startswith('svg:'):
        return _picon(name, size)
    return f'<span class="fpg-svgic" style="--s:{size}px" aria-hidden="true">{B.ci(name[4:])}</span>'
B.picon = picon

def node(expr):
    return json.loads(subprocess.run(['node', '-e', expr], cwd=ROOT, capture_output=True, text=True, check=True).stdout)

FINE = 'Screens are the real tool on sample data. Education only. Not financial advice.'

# ---------------------------------------------------------------- Market Stats
def ms_spec():
    reps = node("const S=require('./assets/market-stats-core.js');process.stdout.write(JSON.stringify(Object.values(S.REPORTS).map(r=>[r.group,r.title,r.blurb||r.desc])))")
    order = ['Gaps', 'Open', 'Ranges', 'Candles', 'ICT']
    rep_groups = [(g, [(t, d) for gg, t, d in reps if gg == g]) for g in order]
    assert sum(len(x[1]) for x in rep_groups) == len(reps)
    return dict(
      page='market-stats', tool='Market Stats', crumb='Market Stats', icon='market-stats', chip=('Market Stats', 'Historical frequencies'),
      open='/market-stats', guide='/help#market-stats-what',
      h1='See how often it <em>actually happened</em>.',
      intro='Market Stats counts what past sessions did: how often an opening gap filled, which side of the opening range broke first, '
            'how often yesterday’s high or low was reached. Every number shows its sample size and a 95% interval.',
      fine='Historical frequencies, not predictions. ' + FINE,
      hero=('hero', 'Market Stats: NQ gap-fill report with the Today panel, filters and report tabs. Sample data.', 'Market Stats · NQ · Gap fill'),
      ids=dict(pair='problem', steps='tour', bento='more', values='how', index='list'),
      pair_h2='Rules of thumb, with the count behind them',
      problem=['“Gaps usually fill” gets repeated everywhere, with no count behind it.',
               'A percentage with no sample size could rest on ten sessions.',
               'Checking it yourself means exporting bars into a spreadsheet.'],
      solution=[f'{len(reps)} reports ask the same questions across up to three years of sessions.',
                'Every figure carries N, a 95% interval and a check that both halves of the history agree.',
                'Under 30 sessions the card says low sample; under 10 the number is withheld.'],
      steps_lead='Four steps from picking a market to checking the sessions behind a number.',
      stage_label='Market Stats · sample data',
      steps=[
        dict(t='Pick a market and a report', img='hero', alt='Market Stats with the market chips, report tabs and filters. Sample data.',
             p='Choose NQ, ES, SPX, YM, RTY, GC or CL, then a report. Narrow it by date range, weekday and gap size.'),
        dict(t='Read the number with its sample', img='cards', alt='Gap fill cards: percentage, 95% interval, N, halves check and typical time. Sample data.',
             p='Each card shows the percentage, its 95% interval, N, the yes count, the typical time and whether the two halves of the history agree.'),
        dict(t='Open the sessions behind it', img='sessions', alt='Sessions behind the gap-fill number: date and gap size for every session, filtered to all, yes or no. Sample data.',
             p='“Sessions behind this number” lists every session that counted, with its date and value, so you can check the count yourself.'),
        dict(t='Check today against history', img='today', alt='The Today panel: gap, opening ranges, initial balance and prior day range, each with its history. Sample data.',
             p='The Today panel shows where the current session stands on the gap, opening ranges, initial balance and prior-day range, beside the history for the same setup.'),
      ],
      bento=[
        dict(t='Prior day levels', img='prior-day', alt='Prior day high touched and prior day low touched cards with sample sizes. Sample data.',
             p='How often the session reached yesterday’s high, low and close, and how long it took.'),
        dict(t='Opening candle', img='opening-candle', alt='Opening candle card: how often the first 5-minute candle closed up. Sample data.', pos='50% 30%',
             p='How often the session ended on the same side as its first 5-minute, 15-minute or 1-hour candle.'),
        dict(t='Initial balance', img='initial-balance', alt='Initial balance cards: broke the high only, the low only, both sides, or stayed inside. Sample data.', pos='0% 50%',
             p='The first hour’s range: how often the high, the low, both or neither broke afterwards.'),
        dict(t='Every session listed', img='sessions', alt='List of sessions with dates and gap sizes. Sample data.', pos='50% 20%',
             p='Tap any number to see the dates behind it, filtered to the sessions that did or did not.'),
        dict(t='Gap fill by size', img='cards', alt='Gap fill cards split by direction and timing. Sample data.', pos='0% 0%',
             p='Up and down gaps, filled in the first 30 minutes or the first hour, from XS to XL gap sizes.'),
      ],
      values=[
        ('spark', 'What’s unique', 'Every number shows its sample', 'N, a 95% interval and a two-halves stability check on every card. Thin samples are flagged or withheld.'),
        ('clock', 'Time it saves', 'No spreadsheet to build', f'{len(reps)} reports across seven markets and up to three years, refreshed once a day after the close.'),
        ('swap', 'What it replaces', 'Rules of thumb', 'Instead of “gaps usually fill”, you see how often they did, on which days and at which size.'),
      ],
      index=rep_groups + [
        ('Filters and checks', [
          ('Markets', 'NQ, ES, SPX, YM, RTY, GC and CL, regular session 09:30 to 16:00 New York.'),
          ('Date range', 'Last 3 months, 6 months, 1 year or all three years.'),
          ('Day of week', 'Count only Mondays, Fridays or any single weekday.'),
          ('Gap size', 'XS to XL buckets, so a small gap is not judged with a large one.'),
          ('Sample size and 95% interval', 'N and the interval the frequency likely sits in, on every card.'),
          ('Halves check', 'Compares the first and second half of the history and flags when they differ.'),
          ('Low-sample guard', 'Marked low sample under 30 sessions; withheld under 10.'),
          ('Sessions behind this number', 'The full list of sessions that counted, with dates and values.'),
          ('Today panel', 'The current session’s gap, opening ranges, initial balance and prior-day range, with their history.'),
        ]),
      ],
      related=[
        ('/features/gex', 'omega', 'Omega', 'Options levels for ES and NQ, beside the stats.'),
        ('/features/charts', 'zorocharts', 'ZoroCharts', 'Mark the levels the stats talk about on your chart.'),
        ('/features/backtesting', 'kronos', 'Kronos', 'Replay past sessions and watch the setups play out.'),
      ],
      faq_h2='Before you open Market Stats',
      faq=[
        ('Does it tell me what will happen next?', 'No. It counts what happened in past sessions. Education only. Not financial advice.'),
        ('Which markets and how much history?', 'NQ, ES, SPX, YM, RTY, GC and CL, regular session, up to three years of history. It refreshes once a day after the close.'),
        ('What does N mean?', 'N is the number of sessions behind a figure. Under 30 the card is marked low sample; under 10 the number is withheld.'),
        ('What is the 95% interval?', 'The range the true frequency likely sits in, given the sample. A wide interval means fewer sessions or a less steady pattern.'),
        ('Which plan includes it?', 'Market Stats is free for every account.'),
      ],
      final=('Check the count before the open', 'Open Market Stats, pick your market and see how often it happened.'),
    )

# ---------------------------------------------------------------- Global Monitor
def gm_spec():
    return dict(
      page='global-monitor', tool='Global Monitor', crumb='Global Monitor', icon='svg:globe', chip=('Global Monitor', 'World events board'),
      open='/global-monitor', guide='/help#global-monitor-what',
      h1='Headlines and markets, <em>on one screen</em>.',
      intro='Global Monitor puts an events map, a headline wire, cross-asset markets, a risk board and a written brief in one terminal. '
            'Open it before a session to see what is moving and where.',
      fine='For context only. Each panel names its source inside the tool. ' + FINE,
      hero=('map', 'Global Monitor map tab: events plotted by type on a world map, with the most active places and the tension index. Sample data.', 'Global Monitor · Map'),
      ids=dict(pair='problem', steps='tour', bento='more', values='how', index='list'),
      pair_h2='The outside world, without twenty tabs',
      problem=['Headlines, quotes and the economic calendar live in separate tabs.',
               'On a busy news day it is hard to tell one story from ten.',
               'A scheduled release can catch you in the middle of a session.'],
      solution=['Markets, map, wire, risk and a brief, one tab each in one window.',
                'Events on a world map, ranked by place, with a severity count on the wire.',
                'A market calendar with impact colours beside the financial newswire.'],
      steps_lead='Five tabs, read in the order most members check them.',
      stage_label='Global Monitor · sample data',
      steps=[
        dict(t='Start with the markets', img='markets', alt='Markets tab: market signals above index, futures, haven, forex, energy, defence and crypto boards with sparklines. Sample data.',
             p='Risk tone, breadth, rotation, curve and volatility on top; indices, US futures, havens, forex, energy, defence stocks and crypto below, each with a sparkline.'),
        dict(t='See where events are happening', img='map', alt='Map tab with events coloured by type. Sample data.',
             p='Events on a world map coloured by type: armed conflict, military moves, civil unrest, diplomacy and sanctions, with the most active places and a tension index beside it.'),
        dict(t='Scan the wire', img='wire', alt='The Wire: headlines tagged by country and severity, with a search box and severity chips. Sample data.',
             p='Headlines latest first, tagged by country and severity. Search them, or filter to critical, high or elevated.'),
        dict(t='Check the risk board', img='risk', alt='Risk tab: readiness status and disease outbreaks ranked by severity. Sample data.',
             p='A readiness-level estimate and disease outbreaks ranked by severity, with prediction-market odds on geopolitical outcomes.'),
        dict(t='Read the brief', img='brief', alt='Brief tab: executive summary, hotspot assessment and market read. Sample data.',
             p='A rule-based written summary: the executive summary, the hot spots, a market read and the priority signals.'),
      ],
      bento=[
        dict(t='Cross-asset board', img='markets-grid', alt='Boards for indices, futures, havens, forex, energy, defence stocks and crypto. Sample data.', pos='0% 0%',
             p='Seven boards of quotes with sparklines, so you see risk-on or risk-off across assets at a glance.'),
        dict(t='Market calendar', img='calendar', alt='Market calendar: release times, currency, impact colour, forecast and prior. Sample data.', pos='0% 0%',
             p='The day’s scheduled releases with impact colour, forecast and prior.'),
        dict(t='Financial map', img='finmap', alt='Financial map with central bank rings. Sample data.',
             p='Central banks and market-stress stories by country. Hover a ring for its next high-impact release.'),
        dict(t='Headline search', img='wire', alt='The Wire with severity chips. Sample data.', pos='0% 40%',
             p='Search the wire by country or topic and filter by severity.'),
        dict(t='Hot spots in the brief', img='brief', alt='Brief hotspot assessment. Sample data.', pos='0% 30%',
             p='The places with the most tracked events, with a one-line note on each.'),
      ],
      values=[
        ('spark', 'What’s unique', 'Events and markets side by side', 'The map, the wire and the cross-asset boards share one terminal, so a headline and its market move sit together.'),
        ('clock', 'Time it saves', 'One window, five tabs', 'A context check before the session without opening a news site, a calendar and a quote screen.'),
        ('swap', 'What it replaces', 'A stack of news tabs', 'The wire, the map and the calendar replace several news pages and a separate calendar site.'),
      ],
      index=[
        ('Markets', [
          ('Market signals', 'Risk tone, sector breadth, rotation leader, curve and credit, and volatility.'),
          ('Cross-asset boards', 'Indices, US futures, havens, forex, energy, defence stocks and crypto with sparklines.'),
          ('Sector rotation', 'Which sectors lead and lag.'),
          ('Movers', 'The biggest moves on the board.'),
          ('Financial map', 'Central banks and market-stress stories by country.'),
          ('Financial newswire', 'Market headlines, latest first, filtered by severity.'),
          ('Market calendar', 'Scheduled releases with impact colour, forecast and prior.'),
          ('Prediction markets, trending', 'The most traded prediction markets of the last 24 hours.'),
          ('Quotes for event-sensitive assets', 'Prices that tend to react to geopolitical news.'),
        ]),
        ('Map', [
          ('Events map', 'Events plotted on a world map, with zoom.'),
          ('Event types', 'Armed conflict, terror attacks, military moves, civil unrest, diplomacy and sanctions, humanitarian.'),
          ('Most active, 24 hours', 'The places with the most events in the last day.'),
          ('Tension index', 'Countries ranked by weighted conflict coverage over the last six hours.'),
          ('Events list', 'Every event on the map as a list.'),
        ]),
        ('Wire', [
          ('The Wire', 'Headlines tagged by country and severity.'),
          ('Search', 'Search headlines, countries and topics.'),
          ('Severity chips', 'Filter to critical, high, elevated or all.'),
        ]),
        ('Risk', [
          ('Readiness status', 'A five-level readiness estimate derived from event volume.'),
          ('Disease outbreaks', 'Outbreak notices ranked by severity.'),
          ('Prediction markets', 'Odds on geopolitical outcomes.'),
        ]),
        ('Brief and streams', [
          ('Executive summary', 'A rule-based summary of the current event picture.'),
          ('Hotspot assessment', 'The places with the most tracked events.'),
          ('Market read', 'What risk assets, havens and rates are doing.'),
          ('Priority signals', 'The headlines the rules rank highest.'),
          ('News streams', 'News video channels in one panel.'),
        ]),
      ],
      related=[
        ('/features/smart-money-desk', 'svg:bank', 'Smart Money Desk', 'Congress and insider filings, beside the headlines.'),
        ('/features/market-stats', 'market-stats', 'Market Stats', 'How often gaps and ranges played out, with sample sizes.'),
        ('/features/charts', 'zorocharts', 'ZoroCharts', 'Take the context to the chart you trade.'),
      ],
      faq_h2='Before you open Global Monitor',
      faq=[
        ('What is it for?', 'It is the one-screen context check before a session: events, headlines, markets, risk and the calendar in one place.'),
        ('Where does the data come from?', 'Public news, market and event sources. Each panel inside the tool names its source. For context only.'),
        ('Is the brief written by AI?', 'No. It is a rule-based summary built from the same events and market data as the other tabs.'),
        ('Where is it?', 'In the Terminal section of your dashboard, beside ZoroCharts and the Smart Money desk.'),
        ('Which plan includes it?', 'Global Monitor is free for every account.'),
        ('Is it trade advice?', 'No. It shows what is happening in the world, not what to trade. Education only. Not financial advice.'),
      ],
      final=('See the world before the open', 'Open Global Monitor and check the map, the wire and the calendar in one place.'),
    )

# ---------------------------------------------------------------- Smart Money Desk
def sm_spec():
    return dict(
      page='smart-money-desk', tool='Smart Money', crumb='Smart Money Desk', icon='svg:bank', chip=('Smart Money Desk', 'Public filings'),
      open='/smart-money.html', guide='/help#smart-money',
      h1='See what Congress and insiders <em>file</em>.',
      intro='The Smart Money desk reads congressional trade disclosures and corporate insider filings from official government records '
            'and lays them out as searchable rows and charts. Every row links to the original filing.',
      fine='Public-record context, not signals. ' + FINE,
      hero=('hero', 'Smart Money desk: four overview tiles, the Hill and insider flow charts, and Congress on the tape. Sample data.', 'Smart Money · overview'),
      ids=dict(pair='problem', steps='tour', bento='more', values='how', index='list'),
      pair_h2='Public filings, without the paperwork',
      problem=['Disclosures sit on separate government sites, each in its own format.',
               'Congressional amounts are ranges and arrive weeks after the trade.',
               'One filing says little without the rest of the week beside it.'],
      solution=['Congress and insider filings parsed into one desk.',
                'Each row shows the trade date, the filing date and the disclosed range.',
                'Charts sum the most traded tickers and the biggest buying and selling.'],
      steps_lead='Four steps from the overview to a single filing.',
      stage_label='Smart Money · sample data',
      steps=[
        dict(t='Start at the overview', img='overview', alt='Overview tiles and the two charts. Sample data.',
             p='Four tiles: Congress trades tracked, Hill sentiment, insider buying and insider selling, above the two charts.'),
        dict(t='See what the Hill traded most', img='hill', alt='Most traded on the Hill: trades per ticker, buys and sells. Sample data.',
             p='Trades per ticker across tracked congressional filings, with buys and sells side by side.'),
        dict(t='Search Congress on the tape', img='congress', alt='Congress on the tape: buy and sell rows with disclosed ranges and filing links. Names blurred. Sample data.',
             p='Filter to buys or sells and search by politician, ticker or asset. Each row shows both dates and links to the official filing.'),
        dict(t='Read the insider filings', img='insider', alt='Insider filings: buys with shares, price, value and filing link. Names blurred. Sample data.',
             p='Big buys, big sells or the latest, searchable by ticker, company or insider, with shares, price, value and the filing link.'),
      ],
      bento=[
        dict(t='Insider flow', img='flow', alt='Insider flow: biggest buying and selling per ticker on one scale. Sample data.',
             p='The biggest open-market buying and selling per ticker, both columns on one shared scale.'),
        dict(t='Most traded on the Hill', img='hill', alt='Most traded on the Hill chart. Sample data.',
             p='Which tickers show up most across congressional filings, and on which side.'),
        dict(t='Overview tiles', img='tiles', alt='Four overview tiles. Sample data.', pos='0% 50%',
             p='Trades tracked, Hill sentiment, insider buying and selling, in one row.'),
        dict(t='Congress rows', img='congress', alt='Congress rows with disclosed ranges. Sample data.', pos='50% 0%',
             p='Disclosed ranges, trade and filing dates, and a link to each official filing.'),
        dict(t='Insider rows', img='insider', alt='Insider rows with shares and price. Sample data.', pos='50% 0%',
             p='Shares, price and value for each insider filing, with derivative trades tagged.'),
      ],
      values=[
        ('spark', 'What’s unique', 'Official records, linked', 'Every row comes from a government filing and links back to the original.'),
        ('clock', 'Time it saves', 'Parsed for you, daily', 'Filings are read from official records each day and turned into rows and charts.'),
        ('swap', 'What it replaces', 'Several disclosure sites', 'One searchable desk instead of separate congressional and insider filing sites.'),
      ],
      index=[
        ('Overview', [
          ('Congress trades tracked', 'How many congressional trades are on the desk, with buys and sells.'),
          ('Hill sentiment', 'The share of disclosed trades that are buys.'),
          ('Insider buying', 'Open-market insider buying in the window, by value.'),
          ('Insider selling', 'Insider selling in the window, by value.'),
          ('Most traded on the Hill', 'Trades per ticker across tracked congressional filings.'),
          ('Insider flow', 'Biggest buying and selling per ticker on one shared scale.'),
        ]),
        ('Congress on the tape', [
          ('Buys and sells filter', 'All, buys or sells.'),
          ('Search', 'By politician, ticker or asset.'),
          ('Disclosed ranges', 'Amounts shown as the range given in the filing.'),
          ('Trade and filing dates', 'Both dates on every row, so the reporting lag is visible.'),
          ('Official filing link', 'Open the original disclosure from each row.'),
        ]),
        ('Insider filings', [
          ('Big buys, big sells, latest', 'Three views of the insider filings.'),
          ('Search', 'By ticker, company or insider.'),
          ('Shares, price and value', 'The size of each filed trade.'),
          ('Derivative tag', 'Marks filings that are option or other derivative trades.'),
          ('Filing link', 'Open the original filing from each row.'),
        ]),
      ],
      related=[
        ('/features/global-monitor', 'svg:globe', 'Global Monitor', 'Headlines, events and markets on one screen.'),
        ('/features/market-stats', 'market-stats', 'Market Stats', 'How often gaps and ranges played out, with sample sizes.'),
        ('/features/charts', 'zorocharts', 'ZoroCharts', 'Open the ticker on a chart and see the context.'),
      ],
      faq_h2='Before you open the desk',
      faq=[
        ('Is this a signal service?', 'No. It is public-record context. Education only. Not financial advice.'),
        ('Where does the data come from?', 'Official government records: congressional trade disclosures and SEC insider filings, parsed into rows.'),
        ('Are amounts exact?', 'No. Congressional amounts are the disclosed ranges.'),
        ('Why the lag?', 'Congressional trades are due within 45 days of the trade, so each row shows both dates.'),
        ('Which plan includes it?', 'The Smart Money desk is free for every signed-in member.'),
      ],
      final=('Read the filings, not the rumours', 'Open the Smart Money desk and search the latest congressional and insider filings.'),
    )

# ---------------------------------------------------------------- Community
def cm_spec():
    badges = node("const A=require('./assets/achievements-data.js');const L=A.ACHIEVEMENTS||A.list||A.default||A;const by={};(Array.isArray(L)?L:Object.values(L)).forEach(a=>by[a.category]=(by[a.category]||0)+1);process.stdout.write(JSON.stringify(by))")
    nb = sum(badges.values())
    return dict(
      page='community', tool='Trading Floor', crumb='Community', icon='svg:users', chip=('Community', 'Trading Floor'),
      open='/trading-floor', guide='/help#trading-floor-what',
      h1='Study with people <em>on the same path</em>.',
      intro='The Trading Floor is the members’ feed for daily bias, questions and setups. '
            'Badges mark your progress, and direct messages and your invite link sit one click away.',
      fine='Posts are members’ own notes, not signals. Screens are the real tool with sample posts. Education only. Not financial advice.',
      hero=('replies', 'Trading Floor: a post with replies, reactions and the reply box. Sample posts.', 'Trading Floor · Posts'),
      ids=dict(pair='story', steps='floor', bento='more', values='mobile', index='list'), rename={'story-h': 'st-h'},
      pair_h2='Learning alone is the slow way',
      problem=['Studying alone, you can’t tell whether you read a setup the way it is taught.',
               'Group chats bury good questions under noise within minutes.',
               'Progress through a long course is easy to lose track of.'],
      solution=['A feed of members working through the same curriculum.',
                'Sort by New, Top or Trending, and filter to Setups or Questions.',
                f'{nb} badges for chapters, lessons, streaks and more, on your profile.'],
      steps_lead='Five steps from reading the floor to earning your first badge.',
      stage_label='Trading Floor · sample posts',
      steps=[
        dict(t='Read the floor', img='hero', alt='Trading Floor feed: posts with tags, reactions and reply counts. Sample posts.',
             p='Posts and Prop firm feed tabs, sorted by New, Top or Trending.'),
        dict(t='Filter to what you need', img='setups', alt='The feed filtered to Setups. Sample posts.',
             p='Show only Setups or only Questions, so you study one kind of post at a time.'),
        dict(t='Post your own', img='composer', alt='New post window with Setup and Question tags and formatting. Sample data.',
             p='Write your bias, a setup or a question. Tag it, add an image, mention someone with @ or label a topic with #.'),
        dict(t='Reply and react', img='replies', alt='A post with a reply thread. Sample posts.',
             p='Like, vote up or down, bookmark, and reply in a thread under the post.'),
        dict(t='Earn badges as you go', img='badges', alt='Achievements page with curriculum and lesson badges. Sample data.',
             p=f'{nb} achievements for curriculum chapters, lessons, streaks, community, profile and referrals.'),
      ],
      bento=[
        dict(t='Threads that stay on topic', img='replies', alt='Reply thread under a post. Sample posts.', pos='0% 60%',
             p='Replies sit under the post they answer, not in a chat that scrolls away.'),
        dict(t='Setups and questions', img='setups', alt='Setups filter. Sample posts.', pos='0% 40%',
             p='Tag a post as a setup or a question so others can find it.'),
        dict(t='A simple composer', img='composer', alt='New post window. Sample data.', pos='50% 25%',
             p='Bold, italic, images, mentions and hashtags.'),
        dict(t='Badges', img='badges', alt='Badges grid. Sample data.', pos='0% 20%',
             p='Milestones from your first chapter to the full curriculum.'),
        dict(t='Sort the floor', img='hero', alt='Sort and filter chips above the feed. Sample posts.', pos='0% 0%',
             p='New, Top and Trending, plus the Prop firm feed tab.'),
      ],
      values=[
        ('spark', 'What’s unique', 'Same method, same language', 'Members study the same curriculum, so a question about a chapter gets an answer about that chapter.'),
        ('clock', 'Time it saves', 'One place to ask', 'Ask on the floor instead of hunting through chats and comment sections.'),
        ('swap', 'What it replaces', 'Scattered group chats', 'A feed you can sort and filter, instead of a chat that scrolls away.'),
      ],
      index=[
        ('Feed', [
          ('Posts tab', 'The members’ feed for bias, setups and questions.'),
          ('Prop firm feed tab', 'Posts about prop firm challenges, in their own tab.'),
          ('New, Top, Trending', 'Three ways to sort the feed.'),
          ('Setups and Questions filters', 'Show one kind of post at a time.'),
        ]),
        ('Posting', [
          ('Composer', 'Write a post with bold, italic and underline.'),
          ('Tags', 'Mark a post as a setup or a question.'),
          ('Images', 'Attach a chart screenshot.'),
          ('Mentions and hashtags', '@name to mention someone, #tag to label a topic.'),
          ('Edit and delete', 'Change or remove your own posts.'),
        ]),
        ('Reactions', [
          ('Likes and votes', 'Like a post, or vote it up or down.'),
          ('Replies', 'Threaded replies under each post.'),
          ('Bookmarks', 'Save a post to read later.'),
          ('Block', 'Hide a member’s posts from your feed.'),
        ]),
        ('Badges', [(f'{k} badges', f'{v} achievements in the {k.lower()} group.') for k, v in badges.items()]),
        ('Messages and invites', [
          ('Direct messages', 'Message another member from More → Messages.'),
          ('Invite link and code', 'Your own link; sign-ups through it are credited to you.'),
          ('Referral points', 'Points for the leaderboard. They have no cash or credit value.'),
        ]),
      ],
      related=[
        ('/features/curriculum', 'mentis', 'Curriculum', 'The chapters the floor is talking about.'),
        ('/features/creators', 'creator-hub', 'Creator Hub', 'Start your own community with a feed and events.'),
        ('/features/journal', 'nemesis', 'Nemesis', 'Journal your trades and bring the lessons to the floor.'),
      ],
      faq_h2='Before you post',
      faq=[
        ('Who can see my posts?', 'Posts on the Trading Floor are visible to every signed-in member.'),
        ('Can I post on every plan?', 'Every signed-in member can read the floor. If posting is not open on your account, the floor shows a note.'),
        ('What are badges?', 'Achievements for milestones, such as First chapter complete or Foundations complete. See them at More → Achievements.'),
        ('How do referrals work?', 'Anyone who signs up through your link is credited to you, and you earn points for the leaderboard. Points have no cash or credit value.'),
        ('Are posts trade signals?', 'No. Posts are members’ own notes and questions, shared to learn the method.'),
      ],
      final=('Bring your question to the floor', 'Open the Trading Floor, read today’s posts and ask yours.'),
    )

# ---------------------------------------------------------------- Creator Hub
def cr_spec():
    return dict(
      page='creators', tool='Creator Hub', crumb='Creator Hub', icon='creator-hub', chip=('Creator Hub', 'Communities'),
      open='/signup', guide='/help#what-is-creator-hub', open_label='Start your community', open_attr=' data-cl-start',
      h1='Build <em>your</em> trading community.',
      intro='The Creator Hub gives you a community page on TradeZoro: indicators that run on ZoroCharts, written courses, '
            'a members’ feed, events and Discord roles for your plans. Communities are run by independent creators.',
      fine='TradeZoro does not verify creators or their claims. Screens show an example community. Education only. Not financial advice.',
      hero=('hero', 'An example community page with a chart cover, logo, tabs, about section and plans. Sample data.', 'Creator Hub · example community'),
      ids=dict(pair='build', steps='how-it-works', bento='community', values='payments', index='dashboard'),
      rename={'how-it-works-h': 'how-h', 'community-h': 'cmty-h', 'payments-h': 'pay-h', 'dashboard-h': 'db-h'},
      add_ids=[('indicators', 'h3', 'ind-h'), ('courses', 'h3', 'co-h'), ('discord', 'h3', 'dc-h'), ('discord', 'figure', 'dpath')],
      pair_h2='One home for what you teach',
      problem=['Indicators, lessons and chat sit on three platforms that don’t talk to each other.',
               'Pine code you share can be copied the day you post it.',
               'Members join the chat but never find the course.'],
      solution=['One community page with indicators, courses, feed, events and a leaderboard.',
                'Protected indicators run on members’ charts without showing the source.',
                'Plans decide who gets which indicator, course and Discord role.'],
      steps_lead='Five steps from an empty page to a running community.',
      stage_label='Creator Hub · example community',
      steps=[
        dict(t='Start in three steps', img='start', alt='Start a community: name, web address and topics. Sample data.',
             p='A name and web address, the look of your page, and your first plan. Up to three communities per account.'),
        dict(t='Set up your page', img='hero', alt='Community page with About, Indicators, Courses, Feed, Events and Leaderboard tabs. Sample data.',
             p='Cover, logo, an about section and an intro video, with Indicators, Courses, Feed, Events and Leaderboard tabs.'),
        dict(t='Publish an indicator', img='rn-ind1', id='indicators', alt='A protected community indicator on a ZoroCharts chart with its description. Sample data.',
             p='Paste Pine Script v5 or v6. It is compiled on the same engine members’ charts use, then delivered protected to the members you choose.'),
        dict(t='Build a course', img='rn-curr', id='courses', alt='A course module with lessons, a free preview and locked lessons. Sample data.',
             p='Modules and lessons with video links, text, PDFs and quizzes. Release lessons over time or in order.'),
        dict(t='Run the feed and events', img='feed', alt='Community feed with the post box. Sample data.',
             p='Members post and comment; you pin or remove. Schedule events with a meeting link only members see.'),
      ],
      bento=[
        dict(t='Indicators on ZoroCharts', img='indicators', alt='Indicators tab of a community. Sample data.',
             p='Your indicators run on members’ charts in ZoroCharts, with nothing to install.'),
        dict(t='Courses with progress', img='courses', alt='Courses tab with a course progress bar. Sample data.',
             p='Members see their progress; you see where learners drop off.'),
        dict(t='Discord roles per plan', img='discord', id='discord', alt='Discord card: you are in the server with your role. Sample data.', pos='50% 30%',
             p='Members link Discord, get the role for their plan, and lose it when membership ends.'),
        dict(t='Plans and access', img='rn-plan', id='ppath', alt='A free plan card listing what members get. Sample data.', pos='50% 0%',
             p='Free plans, invite links and member import. Each plan decides what members get.'),
        dict(t='Your about page', img='rn-about', alt='About section of an example community. Sample data.', pos='50% 0%',
             p='Say who you are and what members get, with an Education-only note.'),
      ],
      values=[
        ('spark', 'What’s unique', 'Built into the charts', 'Your indicators run inside ZoroCharts for members, protected and traceable.'),
        ('clock', 'Time it saves', 'One dashboard', 'Indicators, courses, feed, events, Discord roles and members, managed in one Creator Hub.'),
        ('swap', 'What it replaces', 'Three separate platforms', 'A course site, a chat server and a script-sharing page, joined up by your plans.'),
      ],
      index=[
        ('Community page', [
          ('Cover, logo and about', 'Your page’s look, with an about section and intro video.'),
          ('Tabs', 'About, Indicators, Courses, Feed, Events and Leaderboard, each switched on in Settings.'),
          ('Invite links and member import', 'Bring members in by link or by email.'),
          ('Up to three communities', 'Each account can run up to three.'),
          ('Report button', 'Members can report a community from its page.'),
        ]),
        ('Indicators', [
          ('Pine Script v5 and v6', 'Paste your code; it is compiled before publishing, with the line number of any error.'),
          ('Protected delivery', 'Members run it on their chart without seeing the source.'),
          ('Traceable copies', 'Each delivered copy carries a hidden mark for the account that loaded it.'),
          ('Access by plan, email or code', 'Give or revoke access at any time.'),
          ('Versions', 'New versions reach members on their next chart load; old ones stay in your history.'),
        ]),
        ('Courses', [
          ('Modules and lessons', 'Video links, text pages, PDFs or links, in drag-to-order modules.'),
          ('Attachments', 'Up to eight files per lesson, read in the TradeZoro viewer.'),
          ('Quizzes', 'Up to ten multiple-choice questions with a pass mark.'),
          ('Drip and in-order release', 'Open lessons after a number of days, on a date, or one after another.'),
          ('Learner analytics', 'Started, finished, completion per lesson and the drop-off point.'),
          ('Leak deterrent', 'A moving label with the member’s email on videos and PDFs.'),
        ]),
        ('Feed, events and leaderboard', [
          ('Feed', 'Members post and comment; creators and moderators pin or delete.'),
          ('Events', 'Title, start time, length and a meeting link members see after signing in.'),
          ('Leaderboard', 'The most active members of the last 30 days. Activity only, not a trading ranking.'),
        ]),
        ('Discord roles', [
          ('Connect your server', 'The bot asks for two permissions only, and cannot read messages.'),
          ('A role per plan', 'Pick which Discord role each plan hands out.'),
          ('Automatic removal', 'The role is removed when a membership ends.'),
        ]),
      ],
      related=[
        ('/features/charts', 'zorocharts', 'ZoroCharts', 'Where your members run your indicators.'),
        ('/features/community', 'svg:users', 'Trading Floor', 'TradeZoro’s own members’ feed.'),
        ('/features/curriculum', 'mentis', 'Curriculum', 'The written course every member can study.'),
      ],
      faq_h2='Before you start a community',
      faq=[
        ('Can I start free?', 'Yes. Free plans, invite links and member import work today. Each account can run up to 3 communities.'),
        ('Who handles refunds?', 'You do. You are an independent creator, so you set a refund rule that shows on your page and you answer your members. The Creator Rules cover what you must tell them.'),
        ('How is my indicator code protected?', 'It is hidden and traceable, not unbreakable. Members run it on their chart without seeing the source, and each delivered copy carries a hidden mark that can be traced to the account that loaded it. No protection is perfect, so only publish what you can live with being copied.'),
        ('How do Discord roles work?', 'You connect your Discord server and choose a role for each plan. Members link their Discord, get the role, and lose it when their membership ends.'),
        ('What can’t I sell or post?', 'No promised profits, income or win rates, no fake proof or testimonials, no copied or leaked material, and no trading bots or signals run through TradeZoro. Read the full Creator Rules before you start.'),
        ('Does TradeZoro vouch for creators?', 'No. Every community is run by an independent creator, and TradeZoro does not verify creators or their claims. Members can report a community from its page.'),
      ],
      final=('Start the community you wished existed', 'Set up your page, publish your first indicator and invite your members.'),
    )

# ---------------------------------------------------------------- Curriculum
def cu_spec():
    ch = node("const vm=require('vm'),fs=require('fs');const c={};vm.createContext(c);vm.runInContext(fs.readFileSync('assets/chapters-index.js','utf8')+';this.X=CHAPTERS_SEED',c);"
              "const by={};c.X.forEach(x=>{const k=x.track||x.level;by[k]=(by[k]||0)+1});process.stdout.write(JSON.stringify(by))")
    core = ch['foundation'] + ch['intermediate'] + ch['advanced']
    total = sum(ch.values())
    return dict(
      page='curriculum', tool='Curriculum', crumb='Curriculum', icon='mentis', chip=('Mentis', 'Curriculum'),
      open='/courses', guide='/help#curriculum-what', open_label='Open the curriculum',
      h1='Learn ICT and SMT, <em>in order</em>.',
      intro=f'{total} written chapters with chart diagrams take you from candles and structure to SMT divergence, plus specialist tracks '
            'on volume profile and prop firms. Each lesson has a checklist, and your progress saves to your account.',
      fine='Written lessons with diagrams, not video. Education only. Not financial advice.',
      hero=('hero', 'Curriculum page: chapter filters, the continue-learning bar and Part I chapters. Sample progress.', 'Mentis · Curriculum'),
      ids=dict(pair='story', steps='levels', bento='inside', values='mobile', index='list'), rename={'story-h': 'st-h'},
      pair_h2='A path, not a playlist',
      problem=['Free trading content jumps between topics with no order.',
               'Order blocks and liquidity make little sense without the structure behind them.',
               'Without a record, it is hard to know what you have actually covered.'],
      solution=['Three parts in order, Foundation, Intermediate and Advanced, each building on the last.',
                'Written lessons with chart diagrams you can read at your own pace and come back to.',
                'A checklist per lesson, and progress saved on every device.'],
      steps_lead='Four steps from the chapter list to your first milestone.',
      stage_label='Mentis · sample progress',
      steps=[
        dict(t='See the whole path', img='hero', alt='All chapters with filters and the continue-learning bar. Sample progress.',
             p='All chapters on one page, with filters for Foundation, Intermediate, Advanced and the specialist tracks, and a bar to resume where you stopped.'),
        dict(t='Read the chapter', img='reader', alt='A chapter page: chapter list on the left, written lesson and chart diagram on the right.',
             p='Each chapter is a written lesson with chart diagrams, the chapter list down the side and a tick for each one you finish.'),
        dict(t='Go deeper with a track', img='tracks', alt='Specialist track: Volume Profile and Order Flow chapters.',
             p=f'Volume Profile and Order Flow ({ch["vp"]} chapters) and Prop Firm ({ch["pf"]} chapters), after the core path.'),
        dict(t='Collect the milestones', img='badges', alt='Achievements with curriculum badges. Sample progress.',
             p='Badges for your first chapter, Foundations complete, SMT Certified and Curriculum complete.'),
      ],
      bento=[
        dict(t='Part I to Part III', img='foundation', alt='Part I Foundation chapters with done ticks. Sample progress.', pos='0% 40%',
             p=f'{core} core chapters: {ch["foundation"]} foundation, {ch["intermediate"]} intermediate and {ch["advanced"]} advanced.'),
        dict(t='SMT and execution', img='advanced', alt='Part III Advanced chapters on SMT divergence.', pos='0% 50%',
             p='Correlated pairs, SMT divergence and institutional execution in Part III.'),
        dict(t='Diagrams in every chapter', img='reader', alt='Chapter diagram comparing every level with the levels that matter.', pos='60% 90%',
             p='Charts drawn for the idea being taught, beside the text.'),
        dict(t='Your place on the path', img='path', alt='Progress path with finished chapters ticked. Sample progress.', pos='50% 50%',
             p='Finished chapters ticked, the current one marked.'),
        dict(t='Specialist tracks', img='tracks', alt='Volume Profile track chapter list.', pos='0% 60%',
             p='Auction theory, profiles, VWAP and footprint, then prop firm rules.'),
      ],
      values=[
        ('spark', 'What’s unique', 'Each chapter assumes the last', 'The order is the point: structure before order blocks, order blocks before SMT.'),
        ('clock', 'Time it saves', 'Read, don’t scrub', 'Written chapters you can skim, reread and come back to, with diagrams where they help.'),
        ('swap', 'What it replaces', 'A pile of saved videos', 'One ordered path with a record of what you finished.'),
      ],
      index=[
        ('Chapters', [
          ('Part I · Foundation', f'{ch["foundation"]} chapters: candles, market structure, discipline, support and resistance.'),
          ('Part II · Intermediate', f'{ch["intermediate"]} chapters: market structure, order blocks, fair value gaps, premium and discount.'),
          ('Part III · Advanced', f'{ch["advanced"]} chapters: correlated pairs, SMT divergence and institutional execution.'),
          ('Volume Profile and Order Flow track', f'{ch["vp"]} chapters: auction theory, profiles, VWAP, the order book and footprint.'),
          ('Prop Firm track', f'{ch["pf"]} chapters on prop firm challenges.'),
        ]),
        ('Reading', [
          ('Written lessons', 'Every chapter split into short lessons, with a read time.'),
          ('Chart diagrams', 'Drawn for the concept, inside the text.'),
          ('Chapter list', 'The whole path down the side of every chapter.'),
          ('Lesson checklist', 'Tick each lesson as you finish it.'),
        ]),
        ('Progress', [
          ('Continue learning', 'Resume the chapter you were on, from the top of the page.'),
          ('Saved to your account', 'Progress follows you on any device.'),
          ('Done ticks', 'Finished chapters are marked in the list.'),
          ('Curriculum badges', 'Nine milestones, from your first chapter to the full core path.'),
        ]),
        ('Finding a chapter', [
          ('Level filters', 'All chapters, Foundation, Intermediate, Advanced or Specialist tracks.'),
          ('Open any chapter', 'Built to be read in order, but every chapter is one click away.'),
        ]),
      ],
      related=[
        ('/features/community', 'svg:users', 'Trading Floor', 'Ask about a chapter and share what you marked.'),
        ('/features/backtesting', 'kronos', 'Kronos', 'Practise what a chapter teaches on past sessions.'),
        ('/features/charts', 'zorocharts', 'ZoroCharts', 'Mark up the concepts on a live chart.'),
      ],
      faq_h2='Before you start chapter one',
      faq=[
        ('Is the curriculum free?', f'Yes. All {total} chapters, including both specialist tracks, are free with an account. No card required.'),
        ('Do I have to go in order?', 'The chapters are built to be taken in order, because each one assumes the ones before it. You can open any chapter from the list.'),
        ('Does my progress save?', 'Yes. Every chapter you complete is saved to your account and shows on your dashboard on any device.'),
        ('Is it video?', 'No. The chapters are written lessons with chart diagrams.'),
        ('Is this financial advice?', 'No. The curriculum teaches methods many traders use, for study. It does not tell you what to trade.'),
      ],
      final=('Start with chapter one', 'Open the curriculum and read the first chapter today.'),
    )

PAGES = {'market-stats': ms_spec, 'global-monitor': gm_spec, 'smart-money-desk': sm_spec,
         'community': cm_spec, 'creators': cr_spec, 'curriculum': cu_spec}

def write(s):
    # build.write with two per-page tweaks: a custom primary button label/attribute (Creator Hub start flow).
    label, attr = s.get('open_label'), s.get('open_attr', '')
    orig = B.build_main
    def bm(spec):
        h = orig(spec)
        for a, b in spec.get('rename', {}).items():
            assert h.count(f'"{a}"') == 2, (spec['page'], a)
            h = h.replace(f'"{a}"', f'"{b}"')
        for cid, tag, nid in spec.get('add_ids', []):
            i = h.index(f'id="{cid}"'); j = h.index(f'<{tag}', i) + len(tag) + 1
            assert h[j] in ' >', (cid, tag)
            h = h[:j] + f' id="{nid}"' + h[j:]
        if label or attr:
            a = f'<a href="{s["open"]}" class="btn btn-primary">Open {E(s["tool"])}</a>'
            assert h.count(a) == 2, s['page']
            h = h.replace(a, f'<a href="{s["open"]}" class="btn btn-primary"{attr}>{E(label or "Open " + s["tool"])}</a>')
        return h
    B.build_main = bm
    try:
        B.write(s)
    finally:
        B.build_main = orig
    html = (ROOT / f'features/{s["page"]}.html').read_text()
    assert not re.search(r'LuxAlgo|TradingView|Polymarket|Forex Factory|Stripe|real-time|delayed', html[html.index('<main'):html.index('</main>')]), s['page']

if __name__ == '__main__':
    for p in (sys.argv[1:] or PAGES):
        write(PAGES[p]())
