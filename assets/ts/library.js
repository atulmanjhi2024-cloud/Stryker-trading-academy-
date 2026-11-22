// TradeZoro thinkScript engine: built-in studies, written in thinkScript for TradeZoro from each indicator's
// standard formula. A script calls them like functions: RSI(14), MACD().Diff, BollingerBands(length = 20).UpperBand.
// The first plot is the value when no plot is named. Compiled on first use (compiler.js libTemplate).
// Parameter names follow the usual thinkScript names so existing calls such as RSI(length = 14) keep working.

export const LIBRARY = {
  simplemovingavg: `script SimpleMovingAvg { input price = close; input length = 9; input displace = 0; plot SMA = Average(price[-displace], length); }`,
  movavgexponential: `script MovAvgExponential { input price = close; input length = 9; input displace = 0; plot AvgExp = ExpAverage(price[-displace], length); }`,
  movavgweighted: `script MovAvgWeighted { input price = close; input length = 9; input displace = 0; plot WMA = WMA(price[-displace], length); }`,
  wilderssmoothing: `script WildersSmoothing { input price = close; input length = 9; plot Wilders = WildersAverage(price, length); }`,
  hullmovingavg: `script HullMovingAvg { input price = close; input length = 20; input displace = 0; plot HMA = HullAverage(price[-displace], length); }`,
  rsi: `script RSI {
    input length = 14; input over_Bought = 70; input over_Sold = 30; input price = close; input averageType = AverageType.WILDERS;
    def chg = price - price[1];
    def net = MovingAverage(averageType, chg, length);
    def tot = MovingAverage(averageType, AbsValue(chg), length);
    plot RSI = if IsNaN(tot) then Double.NaN else if tot == 0 then 50 else 50 * (net / tot + 1);
    plot OverSold = over_Sold; plot OverBought = over_Bought; }`,
  macd: `script MACD {
    input fastLength = 12; input slowLength = 26; input MACDLength = 9; input averageType = AverageType.EXPONENTIAL; input showBreakoutSignals = no;
    plot Value = MovingAverage(averageType, close, fastLength) - MovingAverage(averageType, close, slowLength);
    plot Avg = MovingAverage(averageType, Value, MACDLength);
    plot Diff = Value - Avg;
    plot ZeroLine = 0; }`,
  bollingerbands: `script BollingerBands {
    input price = close; input displace = 0; input length = 20; input Num_Dev_Dn = -2.0; input Num_Dev_up = 2.0; input averageType = AverageType.SIMPLE;
    def mid = MovingAverage(averageType, price[-displace], length);
    def dev = StDev(price[-displace], length);
    plot LowerBand = mid + Num_Dev_Dn * dev; plot MidLine = mid; plot UpperBand = mid + Num_Dev_up * dev; }`,
  bollingerbandwidth: `script BollingerBandwidth {
    input price = close; input length = 20; input Num_Dev = 2.0;
    def mid = Average(price, length); def dev = StDev(price, length);
    plot Bandwidth = if mid == 0 then Double.NaN else 2 * Num_Dev * dev / mid * 100; }`,
  bollingerpercentb: `script BollingerPercentB {
    input price = close; input length = 20; input Num_Dev_Dn = -2.0; input Num_Dev_up = 2.0;
    def mid = Average(price, length); def dev = StDev(price, length);
    def lo = mid + Num_Dev_Dn * dev; def hi = mid + Num_Dev_up * dev;
    plot PercentB = if hi == lo then Double.NaN else (price - lo) / (hi - lo) * 100; }`,
  atr: `script ATR { input length = 14; input averageType = AverageType.WILDERS; plot ATR = MovingAverage(averageType, TrueRange(high, close, low), length); }`,
  averagetruerange: `script AverageTrueRange { input length = 14; input averageType = AverageType.WILDERS; plot ATR = MovingAverage(averageType, TrueRange(high, close, low), length); }`,
  stochasticfull: `script StochasticFull {
    input over_bought = 80; input over_sold = 20; input KPeriod = 10; input DPeriod = 10; input priceH = high; input priceL = low; input priceC = close;
    input slowing_period = 3; input averageType = AverageType.SIMPLE;
    def lo = Lowest(priceL, KPeriod); def hi = Highest(priceH, KPeriod);
    def fastK = if hi - lo == 0 then 0 else (priceC - lo) / (hi - lo) * 100;
    plot FullK = MovingAverage(averageType, fastK, slowing_period);
    plot FullD = MovingAverage(averageType, FullK, DPeriod);
    plot OverBought = over_bought; plot OverSold = over_sold; }`,
  stochasticslow: `script StochasticSlow {
    input over_bought = 80; input over_sold = 20; input KPeriod = 14; input DPeriod = 3; input priceH = high; input priceL = low; input priceC = close;
    input slowing_period = 3; input averageType = AverageType.SIMPLE;
    def s = StochasticFull(over_bought, over_sold, KPeriod, DPeriod, priceH, priceL, priceC, slowing_period, averageType).FullK;
    plot SlowK = s; plot SlowD = MovingAverage(averageType, s, DPeriod);
    plot OverBought = over_bought; plot OverSold = over_sold; }`,
  stochasticfast: `script StochasticFast {
    input over_bought = 80; input over_sold = 20; input KPeriod = 10; input DPeriod = 3; input priceH = high; input priceL = low; input priceC = close;
    input averageType = AverageType.SIMPLE;
    def k = StochasticFull(over_bought, over_sold, KPeriod, DPeriod, priceH, priceL, priceC, 1, averageType).FullK;
    plot FastK = k; plot FastD = MovingAverage(averageType, k, DPeriod);
    plot OverBought = over_bought; plot OverSold = over_sold; }`,
  stochrsi: `script StochRSI {
    input RSI_length = 14; input K_length = 14; input D_length = 3; input price = close; input averageType = AverageType.SIMPLE;
    def r = RSI(length = RSI_length, price = price);
    def lo = Lowest(r, K_length); def hi = Highest(r, K_length);
    plot FullK = if hi == lo then 0 else (r - lo) / (hi - lo);
    plot FullD = MovingAverage(averageType, FullK, D_length); }`,
  williamspercentr: `script WilliamsPercentR {
    input length = 10; input overBought = -20; input overSold = -80;
    def hi = Highest(high, length); def lo = Lowest(low, length);
    plot WR = if hi == lo then 0 else (hi - close) / (hi - lo) * -100;
    plot Over_Bought = overBought; plot Over_Sold = overSold; }`,
  cci: `script CCI {
    input length = 14; input over_sold = -100; input over_bought = 100;
    def tp = hlc3; def dev = LinDev(tp, length);
    plot CCI = if dev == 0 then 0 else (tp - Average(tp, length)) / dev / 0.015;
    plot OverBought = over_bought; plot ZeroLine = 0; plot OverSold = over_sold; }`,
  dmi: `script DMI {
    input length = 14; input averageType = AverageType.WILDERS;
    def upMove = high - high[1]; def downMove = low[1] - low;
    def plusDM = if upMove > downMove and upMove > 0 then upMove else 0;
    def minusDM = if downMove > upMove and downMove > 0 then downMove else 0;
    def range = MovingAverage(averageType, TrueRange(high, close, low), length);
    def diP = if range == 0 then 0 else 100 * MovingAverage(averageType, plusDM, length) / range;
    def diM = if range == 0 then 0 else 100 * MovingAverage(averageType, minusDM, length) / range;
    plot "DI+" = diP; plot "DI-" = diM;
    def dx = if IsNaN(diP) or IsNaN(diM) then Double.NaN else if diP + diM > 0 then 100 * AbsValue(diP - diM) / (diP + diM) else 0;
    plot ADX = MovingAverage(averageType, dx, length); }`,
  adx: `script ADX { input length = 14; input averageType = AverageType.WILDERS; plot ADX = DMI(length, averageType).ADX; }`,
  vwap: `script VWAP {
    input numDevDn = -2.0; input numDevUp = 2.0; input timeFrame = {default DAY, WEEK, MONTH};
    def key = if timeFrame == timeFrame.WEEK then GetYear() * 100 + GetWeek() else if timeFrame == timeFrame.MONTH then GetYear() * 100 + GetMonth() else GetYYYYMMDD();
    def start = key != key[1];
    def vol = if start then volume else vol[1] + volume;
    def pv = if start then volume * hlc3 else pv[1] + volume * hlc3;
    def pv2 = if start then volume * Sqr(hlc3) else pv2[1] + volume * Sqr(hlc3);
    def price = if vol > 0 then pv / vol else Double.NaN;
    def dev = Sqrt(Max(pv2 / vol - Sqr(price), 0));
    plot VWAP = price; plot UpperBand = price + numDevUp * dev; plot LowerBand = price + numDevDn * dev; }`,
  momentum: `script Momentum { input length = 12; input price = close; plot Momentum = price - price[length]; plot ZeroLine = 0; }`,
  rateofchange: `script RateOfChange {
    input length = 14; input colorNormLength = 14; input price = close;
    plot ROC = if IsNaN(price[length]) then Double.NaN else if price[length] != 0 then (price / price[length] - 1) * 100 else 0; plot ZeroLine = 0; }`,
  ichimoku: `script Ichimoku {
    input tenkan_period = 9; input kijun_period = 26;
    plot Tenkan = (Highest(high, tenkan_period) + Lowest(low, tenkan_period)) / 2;
    plot Kijun = (Highest(high, kijun_period) + Lowest(low, kijun_period)) / 2;
    plot "Span A" = (Tenkan[kijun_period] + Kijun[kijun_period]) / 2;
    plot "Span B" = (Highest(high[kijun_period], 2 * kijun_period) + Lowest(low[kijun_period], 2 * kijun_period)) / 2;
    plot Chikou = close[-kijun_period]; }`,
  parabolicsar: `script ParabolicSAR { input accelerationFactor = 0.02; input accelerationLimit = 0.2; plot parSAR = SarValue(accelerationFactor, accelerationLimit); }`,
  onbalancevolume: `script OnBalanceVolume {
    def change = close - close[1];
    def dir = if IsNaN(change) then 0 else Sign(change);
    plot OBV = CompoundValue(1, OBV[1] + dir * volume, 0); }`,
  moneyflowindex: `script MoneyFlowIndex {
    input over_Sold = 20; input over_Bought = 80; input length = 14;
    def tp = hlc3; def flow = tp * volume;
    def pos = Sum(if tp > tp[1] then flow else 0, length);
    def neg = Sum(if tp < tp[1] then flow else 0, length);
    plot MoneyFlowIndex = if neg == 0 then 100 else 100 - 100 / (1 + pos / neg);
    plot OverBought = over_Bought; plot OverSold = over_Sold; }`,
  accdist: `script AccDist {
    def rng = high - low;
    def mfm = if rng == 0 then 0 else ((close - low) - (high - close)) / rng;
    def ad = CompoundValue(1, ad[1] + mfm * volume, mfm * volume);
    plot AccDist = ad; }`,
  chaikinmoneyflow: `script ChaikinMoneyFlow {
    input length = 21;
    def rng = high - low;
    def mfv = if rng == 0 then 0 else ((close - low) - (high - close)) / rng * volume;
    def vs = Sum(volume, length);
    plot CMF = if vs == 0 then 0 else Sum(mfv, length) / vs; plot ZeroLine = 0; }`,
  chaikinosc: `script ChaikinOsc {
    input fastLength = 3; input slowLength = 10;
    def ad = AccDist();
    plot COSC = ExpAverage(ad, fastLength) - ExpAverage(ad, slowLength); plot ZeroLine = 0; }`,
  awesomeoscillator: `script AwesomeOscillator { plot AO = Average(hl2, 5) - Average(hl2, 34); plot Zero = 0; }`,
  keltnerchannels: `script KeltnerChannels {
    input displace = 0; input factor = 1.5; input length = 20; input price = close; input averageType = AverageType.SIMPLE; input trueRangeAverageType = AverageType.SIMPLE;
    def mid = MovingAverage(averageType, price[-displace], length);
    def shift = factor * MovingAverage(trueRangeAverageType, TrueRange(high, close, low), length);
    plot Avg = mid; plot Upper_Band = mid + shift; plot Lower_Band = mid - shift; }`,
  pricechannel: `script PriceChannel {
    input length = 20; input offset = 1;
    plot UpperBand = Highest(high[offset], length); plot LowerBand = Lowest(low[offset], length);
    plot MiddleLine = (UpperBand + LowerBand) / 2; }`,
  donchianchannel: `script DonchianChannel {
    input length = 20;
    plot UpperBand = Highest(high, length); plot LowerBand = Lowest(low, length); plot MiddleBand = (UpperBand + LowerBand) / 2; }`,
  trix: `script TRIX {
    input length = 9; input colorNormLength = 14; input price = close; input signalLength = 3;
    def e3 = ExpAverage(ExpAverage(ExpAverage(Log(price), length), length), length);
    plot TRIX = (e3 - e3[1]) * 10000; plot Signal = ExpAverage(TRIX, signalLength); plot ZeroLine = 0; }`,
  truestrengthindex: `script TrueStrengthIndex {
    input longLength = 25; input shortLength = 13; input signalLength = 8; input averageType = AverageType.EXPONENTIAL;
    def d = close - close[1];
    def n = MovingAverage(averageType, MovingAverage(averageType, d, longLength), shortLength);
    def m = MovingAverage(averageType, MovingAverage(averageType, AbsValue(d), longLength), shortLength);
    plot TSI = if m == 0 then 0 else 100 * n / m; plot Signal = MovingAverage(averageType, TSI, signalLength); plot ZeroLine = 0; }`,
  ultimateoscillator: `script UltimateOscillator {
    input fastLength = 7; input midLength = 14; input slowLength = 28;
    def bp = close - Min(low, close[1]); def tr = TrueRange(high, close, low);
    def a1 = Sum(bp, fastLength) / Sum(tr, fastLength); def a2 = Sum(bp, midLength) / Sum(tr, midLength); def a3 = Sum(bp, slowLength) / Sum(tr, slowLength);
    plot UltOsc = 100 * (4 * a1 + 2 * a2 + a3) / 7; }`,
  aroonindicator: `script AroonIndicator {
    input length = 25;
    plot Up = 100 * (length - GetMaxValueOffset(high, length + 1)) / length;
    plot Down = 100 * (length - GetMinValueOffset(low, length + 1)) / length; }`,
  aroonoscillator: `script AroonOscillator { input length = 25; def a = AroonIndicator(length).Up - AroonIndicator(length).Down; plot Osc = a; plot ZeroLine = 0; }`,
  volumeavg: `script VolumeAvg { input length = 50; plot Vol = volume; plot VolAvg = Average(volume, length); }`,
  detrendedpriceosc: `script DetrendedPriceOsc {
    input length = 14; input price = close;
    plot DPO = price - Average(price, length)[Floor(length / 2) + 1]; plot ZeroLine = 0; }`,
  ppo: `script PPO {
    input fastLength = 12; input slowLength = 26; input signalLength = 9; input price = close;
    def slow = ExpAverage(price, slowLength);
    plot PPO = if slow == 0 then 0 else (ExpAverage(price, fastLength) - slow) / slow * 100;
    plot Signal = ExpAverage(PPO, signalLength); plot ZeroLine = 0; }`,
  linearregcurve: `script LinearRegCurve { input price = close; input length = 10; plot LRC = Inertia(price, length); }`,
  standarddeviation: `script StandardDeviation { input price = close; input length = 20; plot StDev = StDev(price, length); }`,
  historicalvolatility: `script HistoricalVolatility {
    input length = 20; input basis = 252;
    def r = Log(close / close[1]);
    plot HV = StDev(r, length) * Sqrt(basis) * 100; }`,
  elderrayindex: `script ElderRayIndex {
    input length = 13; def e = ExpAverage(close, length);
    plot BullPower = high - e; plot BearPower = low - e; plot ZeroLine = 0; }`,
  percentchg: `script PercentChg { input length = 1; input price = close; plot PercentChg = if price[length] == 0 then 0 else (price / price[length] - 1) * 100; plot ZeroLine = 0; }`,
  supertrend: `script SuperTrend {
    input atrLength = 10; input multiplier = 3.0;
    def a = ATR(atrLength) * multiplier;
    def up0 = hl2 - a; def dn0 = hl2 + a;
    def upB = if IsNaN(upB[1]) or upB[1] == 0 then up0 else if close[1] > upB[1] then Max(up0, upB[1]) else up0;
    def dnB = if IsNaN(dnB[1]) or dnB[1] == 0 then dn0 else if close[1] < dnB[1] then Min(dn0, dnB[1]) else dn0;
    def dir = if BarNumber() == 1 then 1 else if close > dnB[1] then 1 else if close < upB[1] then -1 else dir[1];
    plot ST = if IsNaN(a) then Double.NaN else if dir > 0 then upB else dnB; }`,

  movavgtriangular: `script MovAvgTriangular { input price = close; input length = 9; input displace = 0; plot TRIMA = Average(Average(price[-displace], Ceil((length + 1) / 2)), Floor(length / 2) + 1); }`,
  dema: `script DEMA { input price = close; input length = 9; def e = ExpAverage(price, length); plot DEMA = 2 * e - ExpAverage(e, length); }`,
  tema: `script TEMA { input price = close; input length = 9; def e1 = ExpAverage(price, length); def e2 = ExpAverage(e1, length); plot TEMA = 3 * e1 - 3 * e2 + ExpAverage(e2, length); }`,
  vwma: `script VWMA { input price = close; input length = 20; def v = Sum(volume, length); plot VWMA = if v == 0 then Double.NaN else Sum(price * volume, length) / v; }`,
  movavgadaptive: `script MovAvgAdaptive {
    input price = close; input fastLength = 2; input slowLength = 30; input length = 10;
    def dir = AbsValue(price - price[length]); def vol = Sum(AbsValue(price - price[1]), length);
    def er = if vol == 0 then 0 else dir / vol;
    def sc = Sqr(er * (2 / (fastLength + 1) - 2 / (slowLength + 1)) + 2 / (slowLength + 1));
    def k = if IsNaN(k[1]) or k[1] == 0 then price else if IsNaN(sc) then k[1] else k[1] + sc * (price - k[1]);
    plot AMA = if IsNaN(sc) then Double.NaN else k; }`,
  chandemomentumoscillator: `script ChandeMomentumOscillator {
    input length = 20; def d = close - close[1];
    def up = Sum(if d > 0 then d else 0, length); def dn = Sum(if d < 0 then -d else 0, length);
    plot CMO = if up + dn == 0 then 0 else 100 * (up - dn) / (up + dn); plot ZeroLine = 0; }`,
  forceindex: `script ForceIndex { input length = 13; plot ForceIndex = ExpAverage((close - close[1]) * volume, length); plot ZeroLine = 0; }`,
  easeofmovement: `script EaseOfMovement {
    input length = 14; input scale = 10000;
    def mid = hl2 - hl2[1]; def ratio = if high == low then 0 else volume / scale / (high - low);
    plot EOM = Average(if ratio == 0 then 0 else mid / ratio, length); plot ZeroLine = 0; }`,
  pricevolumetrend: `script PriceVolumeTrend {
    def pc = if close[1] == 0 then 0 else (close - close[1]) / close[1];
    plot PVT = CompoundValue(1, PVT[1] + pc * volume, 0); }`,
  massindex: `script MassIndex {
    input length = 25; def r = high - low; def e1 = ExpAverage(r, 9); def e2 = ExpAverage(e1, 9);
    plot MassIndex = Sum(if e2 == 0 then 1 else e1 / e2, length); }`,
  vortexindicator: `script VortexIndicator {
    input length = 14;
    def vp = Sum(AbsValue(high - low[1]), length); def vm = Sum(AbsValue(low - high[1]), length); def tr = Sum(TrueRange(high, close, low), length);
    plot "VI+" = if tr == 0 then Double.NaN else vp / tr; plot "VI-" = if tr == 0 then Double.NaN else vm / tr; }`,
  choppinessindex: `script ChoppinessIndex {
    input length = 14; def rng = Highest(high, length) - Lowest(low, length);
    plot CI = if rng == 0 then Double.NaN else 100 * Lg(Sum(TrueRange(high, close, low), length) / rng) / Lg(length);
    plot HighLine = 61.8; plot LowLine = 38.2; }`,
  balanceofpower: `script BalanceOfPower { input length = 14; plot BOP = Average(if high == low then 0 else (close - open) / (high - low), length); plot ZeroLine = 0; }`,
  coppockcurve: `script CoppockCurve {
    input longRoC = 14; input shortRoC = 11; input wmaLength = 10;
    plot Coppock = WMA(RateOfChange(longRoC) + RateOfChange(shortRoC), wmaLength); plot ZeroLine = 0; }`,
  relativevolatilityindex: `script RelativeVolatilityIndex {
    input stDevLength = 10; input averageLength = 14;
    def sd = StDev(close, stDevLength); def d = close - close[1];
    def u = WildersAverage(if d > 0 then sd else 0, averageLength); def w = WildersAverage(if d < 0 then sd else 0, averageLength);
    plot RVI = if u + w == 0 then 50 else 100 * u / (u + w); plot OverBought = 80; plot OverSold = 20; }`,
  atrtrailingstop: `script ATRTrailingStop {
    input atrLength = 14; input atrFactor = 3.0;
    def loss = atrFactor * ATR(atrLength);
    def st = if IsNaN(loss) then Double.NaN else if IsNaN(st[1]) or st[1] == 0 then close - loss
      else if close > st[1] and close[1] > st[1] then Max(st[1], close - loss)
      else if close < st[1] and close[1] < st[1] then Min(st[1], close + loss)
      else if close > st[1] then close - loss else close + loss;
    plot TrailingStop = st; }`,
  standarderrorbands: `script StandardErrorBands {
    input price = close; input length = 21; input numDev = 2.0;
    def lr = Inertia(price, length);
    def se = Sqrt(fold i = 0 to length with s do s + Sqr(GetValue(price, i) - (lr - LinearRegressionSlope(price, length) * i))) / Sqrt(Max(length - 2, 1));
    plot MidLine = lr; plot UpperBand = lr + numDev * se; plot LowerBand = lr - numDev * se; }`,
  klingeroscillator: `script KlingerOscillator {
    input fastLength = 34; input slowLength = 55; input signalLength = 13;
    def t = if hlc3 > hlc3[1] then 1 else -1;
    def vf = volume * t;
    plot KO = ExpAverage(vf, fastLength) - ExpAverage(vf, slowLength); plot Signal = ExpAverage(KO, signalLength); plot ZeroLine = 0; }`,
};
// study plot names, for the Docs tab (filled by compiler.js when it compiles the library)
export const LIB_TITLES = Object.fromEntries(Object.keys(LIBRARY).map((k) => [k, /script\s+(\w+)/.exec(LIBRARY[k])[1]]));
