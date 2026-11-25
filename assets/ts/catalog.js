// TradeZoro thinkScript engine: the reference shown in the editor's Docs tab, autocomplete and hover. Pure (no DOM).
//   catalog() -> [{ name, kind: 'function'|'study'|'constant'|'keyword'|'variable', sig, doc, insert }]
// Signatures come from the engine itself (natives.js parameters, library.js inputs and plots), so they never drift.
import { NATIVES, NS, NS_NAMES, BAR_FIELDS } from './natives.js?v=1278';
import { LIBRARY } from './library.js?v=1278';
import { DISPLAY } from './compiler.js?v=1278';
import { parse } from './parser.js?v=1278';

const D = {
  absvalue: 'Absolute value.', max: 'The larger of two values.', min: 'The smaller of two values.', round: 'Rounds to a number of decimal places.',
  rounddown: 'Rounds toward zero.', roundup: 'Rounds away from zero.', floor: 'Largest whole number not above the value.', ceil: 'Smallest whole number not below the value.',
  sqrt: 'Square root.', sqr: 'The value squared.', power: 'number to the power of power.', log: 'Natural logarithm.', lg: 'Base-10 logarithm.', exp: 'e to the power of the value.',
  sign: '1, 0 or -1 by the sign of the value.', isnan: 'yes when the value is missing (Double.NaN).', isinfinite: 'yes when the value is infinite.',
  between: 'yes when parameter is between value1 and value2 (inclusive).', random: 'A pseudo-random number from 0 to 1 (same sequence every run).',
  average: 'Simple moving average over length bars.', simplemovingaverage: 'Simple moving average over length bars.', expaverage: 'Exponential moving average.',
  wma: 'Linearly weighted moving average.', wildersaverage: 'Wilder\'s smoothing (used by RSI and ATR).', hullaverage: 'Hull moving average.',
  movingaverage: 'Any average by AverageType: SIMPLE, EXPONENTIAL, WEIGHTED, WILDERS or HULL.', highest: 'Highest value over length bars.', lowest: 'Lowest value over length bars.',
  sum: 'Sum over length bars.', stdev: 'Standard deviation (population) over length bars.', lindev: 'Mean absolute deviation over length bars.', median: 'Median over length bars.',
  inertia: 'Linear regression value at the current bar.', linearregressionslope: 'Slope of the linear regression line.', correlation: 'Correlation of two series.',
  covariance: 'Covariance of two series.', isascending: 'yes when the regression slope is up.', isdescending: 'yes when the regression slope is down.',
  getmaxvalueoffset: 'Bars back to the highest value over length bars.', getminvalueoffset: 'Bars back to the lowest value over length bars.',
  truerange: 'True range of the bar.', getvalue: 'The value dynamicOffset bars ago (the offset can change bar to bar).',
  compoundvalue: 'historicalData for the first length bars, then visibleData. Seeds a recursive def.', crosses: 'yes on the bar data1 crosses data2 (direction: CrossingDirection.ABOVE, BELOW or ANY).',
  highestall: 'Highest value on the whole chart.', lowestall: 'Lowest value on the whole chart.', totalsum: 'Sum over the whole chart.', stdevall: 'Standard deviation over the whole chart.',
  inertiaall: 'Linear regression over the whole chart.', barssince: 'Bars since condition was last true (NaN before the first time).', valuewhen: 'data on the bar condition was true, occurrence 0 = the latest.',
  sarvalue: 'Parabolic stop-and-reverse value.', barnumber: 'Bar number, 1 for the first bar on the chart.', gettime: 'Bar open time (milliseconds since 1970, UTC).',
  getday: 'Day of the year of the bar\'s trading day.', getyyyymmdd: 'Trading day as a number, e.g. 20261122.', getyear: 'Year of the trading day.', getmonth: 'Month of the trading day (1-12).',
  getweek: 'ISO week of the trading day.', getlastday: 'Day of the year of the last bar.', getlastyyyymmdd: 'Trading day of the last bar.', getlastmonth: 'Month of the last bar.', getlastyear: 'Year of the last bar.',
  getlastweek: 'ISO week of the last bar.', getdayofweek: 'Day of the week, 1 = Monday ... 7 = Sunday.', getdayofmonth: 'Day of the month.', daysfromdate: 'Days from fromDate to the bar\'s trading day.',
  daystilldate: 'Days from the bar\'s trading day to tillDate.', counttradingdays: 'Weekdays between two dates.', secondsfromtime: 'Seconds since the time of day (HHMM, New York time).',
  secondstilltime: 'Seconds until the time of day (HHMM, New York time).', regulartradingstart: 'Regular session open (09:30 New York) on a date, as a time.',
  regulartradingend: 'Regular session close (16:00 New York) on a date, as a time.', getaggregationperiod: 'The chart timeframe in milliseconds (compare with AggregationPeriod.X).',
  getsymbol: 'The chart symbol as text.', getsymbolpart: 'The chart symbol as text.', ticksize: 'Price step of the symbol.', tickvalue: 'Price step of the symbol.', isrealtime: 'yes on the last bar.',
  concat: 'Joins two values as text.', astext: 'A number as text.', asprice: 'A number as a price.', asdollars: 'A number as dollars, e.g. $12.50.', aspercent: 'A ratio as a percent, e.g. 0.05 -> 5.00%.',
  createcolor: 'A colour from red, green, blue (0-255).', getcolor: 'One of ten palette colours (0-9).', globalcolor: 'A colour defined with DefineGlobalColor.',
  addlabel: 'A label in the row at the top of the pane (uses the last bar\'s values).', addchartbubble: 'A bubble with text at priceLocation on bars where timeCondition is true.',
  addverticalline: 'A vertical line on bars where visible is true.', addcloud: 'Shades between data1 and data2: color1 where data1 is above, color2 where below.',
  assignpricecolor: 'Colours the price bars.', alert: 'Shows a chart notice (and a sound) when condition is true on the last bar. Alert.BAR: once per bar; Alert.ONCE: once.',
  defineglobalcolor: 'Names a colour for GlobalColor("name").', if: 'If(condition, a, b): a when condition is yes, else b.'
};
const SD = {
  rsi: 'Relative strength index.', macd: 'Moving average convergence divergence: Value, Avg, Diff.', bollingerbands: 'Bollinger Bands: LowerBand, MidLine, UpperBand.',
  atr: 'Average true range.', averagetruerange: 'Average true range.', stochasticfull: 'Full stochastic: FullK, FullD.', stochasticslow: 'Slow stochastic.', stochasticfast: 'Fast stochastic.',
  cci: 'Commodity channel index.', dmi: 'Directional movement: DI+, DI-, ADX.', adx: 'Average directional index.', vwap: 'Volume weighted average price from the session (or week / month) start, with bands.',
  momentum: 'Price minus price length bars ago.', rateofchange: 'Percent change over length bars.', ichimoku: 'Ichimoku lines: Tenkan, Kijun, Span A, Span B, Chikou.',
  parabolicsar: 'Parabolic stop and reverse.', supertrend: 'ATR-based trend line.'
};
const KW = ['def', 'rec', 'plot', 'input', 'declare', 'script', 'if', 'then', 'else', 'switch', 'case', 'default', 'fold', 'to', 'with', 'while', 'do', 'and', 'or', 'crosses', 'above', 'below', 'yes', 'no', 'reference'];

let cache = null;
export function catalog() {
  if (cache) return cache;
  const out = [];
  KW.forEach((k) => out.push({ name: k, kind: 'keyword', sig: k, doc: '', insert: k }));
  BAR_FIELDS.concat(['barNumber']).forEach((k) => out.push({ name: k, kind: 'variable', sig: k, doc: k === 'barNumber' ? 'Bar number, 1 for the first bar.' : 'Bar ' + k + '. Read past bars with ' + k + '[1]; another timeframe with ' + k + '(period = AggregationPeriod.DAY).', insert: k }));
  for (const k of Object.keys(NATIVES)) {
    const N = NATIVES[k], name = DISPLAY[k] || k;
    const sig = name + '(' + N.p.map((p) => (p.toLowerCase() in N.d ? p + ' = ' + show(N.d[p.toLowerCase()]) : p)).join(', ') + ')';
    out.push({ name, kind: 'function', sig, doc: D[k] || '', insert: name + '(' });
  }
  for (const k of Object.keys(LIBRARY)) {
    const s = parse(LIBRARY[k])[0];
    const ins = s.body.filter((x) => x.s === 'input').map((x) => x.name + ' = ' + src(x.e));
    const plots = s.body.filter((x) => x.s === 'plot').map((x) => x.name);
    out.push({ name: s.name, kind: 'study', sig: s.name + '(' + ins.join(', ') + ')' + ' → ' + plots.join(', '), doc: (SD[k] ? SD[k] + ' ' : 'Built-in study. ') + (plots.length > 1 ? 'Pick a plot with ' + s.name + '().' + plots[plots.length > 1 ? 1 : 0].replace(/\W/g, '') + '.' : ''), insert: s.name + '(' });
  }
  for (const ns of Object.keys(NS)) for (const m of Object.keys(NS[ns])) out.push({ name: NS_NAMES[ns] + '.' + m, kind: 'constant', sig: NS_NAMES[ns] + '.' + m, doc: '', insert: NS_NAMES[ns] + '.' + m });
  cache = out;
  return out;
}
const show = (v) => (typeof v === 'string' ? v : v && v.rgb ? 'Color' : String(v));
function src(e) {
  if (e.n === 'num') return String(e.v);
  if (e.n === 'un') return '-' + src(e.a);
  if (e.n === 'id') return e.name;
  if (e.n === 'mem') return src(e.obj) + '.' + e.name;
  if (e.n === 'enum') return '{' + e.vals.join(', ') + '}';
  if (e.n === 'str') return '"' + e.v + '"';
  return '…';
}
