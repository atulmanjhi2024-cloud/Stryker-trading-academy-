// A corpus of MQL5 indicators written for the engine tests (tools/tests/mq5-engine.test.mjs). Our own code, in the style
// members paste: classic forms (full OnCalculate, price[] form, handles + CopyBuffer, series arrays), every DRAW_* type,
// colour buffers, objects, timers, events, structs, enums, #define, strings and time functions.
import assert from 'node:assert/strict';

const FULL = 'const int rates_total,const int prev_calculated,const datetime &time[],const double &open[],const double &high[],const double &low[],const double &close[],const long &tick_volume[],const long &volume[],const int &spread[]';
const fin = (v) => Number.isFinite(v) && v < 1e300;
const lastVal = (o, k = 0, j = 0) => { const d = o.plots[k].data[j]; for (let i = d.length - 1; i >= 0; i--) if (fin(d[i])) return d[i]; return NaN; };

export const CORPUS = [
{ name: 'Hand RSI', source: `
#property indicator_separate_window
#property indicator_minimum 0
#property indicator_maximum 100
#property indicator_level1 30
#property indicator_level2 70
#property indicator_buffers 3
#property indicator_plots 1
#property indicator_type1 DRAW_LINE
#property indicator_color1 clrDodgerBlue
input int Period = 14;
double R[], Up[], Dn[];
int OnInit(){
  SetIndexBuffer(0, R, INDICATOR_DATA); SetIndexBuffer(1, Up, INDICATOR_CALCULATIONS); SetIndexBuffer(2, Dn, INDICATOR_CALCULATIONS);
  PlotIndexSetInteger(0, PLOT_DRAW_BEGIN, Period);
  IndicatorSetString(INDICATOR_SHORTNAME, "RSI(" + IntegerToString(Period) + ")");
  IndicatorSetInteger(INDICATOR_DIGITS, 2);
  return INIT_SUCCEEDED; }
int OnCalculate(${FULL}){
  if (rates_total <= Period) return 0;
  int start = prev_calculated - 1;
  if (prev_calculated == 0) {
    double u = 0, d = 0;
    for (int i = 1; i <= Period; i++) { double ch = close[i] - close[i-1]; if (ch > 0) u += ch; else d -= ch; }
    for (int i = 0; i < Period; i++) { R[i] = EMPTY_VALUE; Up[i] = 0; Dn[i] = 0; }
    Up[Period] = u / Period; Dn[Period] = d / Period;
    R[Period] = Dn[Period] != 0 ? 100.0 - 100.0 / (1.0 + Up[Period] / Dn[Period]) : 100;
    start = Period + 1;
  }
  for (int i = start; i < rates_total && !IsStopped(); i++) {
    double ch = close[i] - close[i-1];
    Up[i] = (Up[i-1] * (Period - 1) + (ch > 0 ? ch : 0)) / Period;
    Dn[i] = (Dn[i-1] * (Period - 1) + (ch < 0 ? -ch : 0)) / Period;
    R[i] = Dn[i] != 0 ? 100.0 - 100.0 / (1.0 + Up[i] / Dn[i]) : 100;
  }
  return rates_total; }`, check: (o) => { assert.equal(o.title, 'RSI(14)'); assert.equal(o.levels.length, 2); } },

{ name: 'Plot kinds', source: `
#property indicator_separate_window
#property indicator_buffers 22
#property indicator_plots 11
#property indicator_minimum -5
#property indicator_maximum 205
#property indicator_level1 50
#property indicator_level2 150
#property indicator_type1 DRAW_LINE
#property indicator_type2 DRAW_SECTION
#property indicator_type3 DRAW_HISTOGRAM
#property indicator_type4 DRAW_HISTOGRAM2
#property indicator_type5 DRAW_ARROW
#property indicator_type6 DRAW_ZIGZAG
#property indicator_type7 DRAW_FILLING
#property indicator_type8 DRAW_COLOR_HISTOGRAM
#property indicator_color8 clrLime,clrRed
#property indicator_type9 DRAW_BARS
#property indicator_type10 DRAW_CANDLES
#property indicator_color10 clrGray,clrGreen,clrRed
#property indicator_type11 DRAW_COLOR_CANDLES
#property indicator_color11 clrAqua,clrOrange
#property indicator_style1 STYLE_DASH
#property indicator_width1 2
#property indicator_label1 "Line"
double L[], S[], H[], H2a[], H2b[], A[], Za[], Zb[], Fa[], Fb[], CH[], CHc[], Bo[], Bh[], Bl[], Bc[], Co[], Ch[], Cl[], Cc[], XC[], XCc[];
int OnInit(){
  SetIndexBuffer(0,L); SetIndexBuffer(1,S); SetIndexBuffer(2,H); SetIndexBuffer(3,H2a); SetIndexBuffer(4,H2b); SetIndexBuffer(5,A);
  SetIndexBuffer(6,Za); SetIndexBuffer(7,Zb); SetIndexBuffer(8,Fa); SetIndexBuffer(9,Fb); SetIndexBuffer(10,CH); SetIndexBuffer(11,CHc,INDICATOR_COLOR_INDEX);
  SetIndexBuffer(12,Bo); SetIndexBuffer(13,Bh); SetIndexBuffer(14,Bl); SetIndexBuffer(15,Bc); SetIndexBuffer(16,Co); SetIndexBuffer(17,Ch); SetIndexBuffer(18,Cl); SetIndexBuffer(19,Cc);
  // 11th plot needs 5 buffers; only 2 left, so it borrows the candle buffers' layout check
  SetIndexBuffer(20,XC); SetIndexBuffer(21,XCc,INDICATOR_COLOR_INDEX);
  PlotIndexSetInteger(4, PLOT_ARROW, 233); PlotIndexSetInteger(4, PLOT_ARROW_SHIFT, -10);
  PlotIndexSetDouble(1, PLOT_EMPTY_VALUE, 0.0);
  PlotIndexSetString(2, PLOT_LABEL, "Hist");
  PlotIndexSetInteger(7, PLOT_LINE_COLOR, 1, clrMagenta);
  return 0; }
int OnCalculate(${FULL}){
  for (int i = prev_calculated; i < rates_total; i++) {
    double v = 100 + 50 * MathSin(i / 10.0);
    L[i] = v; S[i] = i % 7 == 0 ? v : 0.0; H[i] = v - 100; H2a[i] = v; H2b[i] = v - 10;
    A[i] = i % 13 == 0 ? v : EMPTY_VALUE; Za[i] = i % 9 == 0 ? v + 5 : EMPTY_VALUE; Zb[i] = i % 9 == 4 ? v - 5 : EMPTY_VALUE;
    Fa[i] = v + 3; Fb[i] = v - 3; CH[i] = v - 100; CHc[i] = v > 100 ? 0 : 1;
    Bo[i] = open[i]; Bh[i] = high[i]; Bl[i] = low[i]; Bc[i] = close[i];
    Co[i] = open[i]; Ch[i] = high[i]; Cl[i] = low[i]; Cc[i] = close[i]; XC[i] = v; XCc[i] = 0;
  }
  return rates_total; }`, check: (o) => { assert.ok(o.plots.length >= 10, 'plots ' + o.plots.length); } },

{ name: 'Objects', source: `
#property indicator_chart_window
int OnInit(){
  datetime t1 = iTime(_Symbol, _Period, 30), t2 = iTime(_Symbol, _Period, 5);
  double p1 = iLow(_Symbol, _Period, 30), p2 = iHigh(_Symbol, _Period, 5);
  ObjectCreate(0, "hl", OBJ_HLINE, 0, 0, p1); ObjectSetInteger(0, "hl", OBJPROP_COLOR, clrGold); ObjectSetInteger(0, "hl", OBJPROP_STYLE, STYLE_DOT);
  ObjectCreate(0, "vl", OBJ_VLINE, 0, t1, 0);
  ObjectCreate(0, "tr", OBJ_TREND, 0, t1, p1, t2, p2); ObjectSetInteger(0, "tr", OBJPROP_RAY_RIGHT, true); ObjectSetInteger(0, "tr", OBJPROP_WIDTH, 2);
  ObjectCreate(0, "rc", OBJ_RECTANGLE, 0, t1, p1, t2, p2); ObjectSetInteger(0, "rc", OBJPROP_FILL, true);
  ObjectCreate(0, "tx", OBJ_TEXT, 0, t2, p2); ObjectSetString(0, "tx", OBJPROP_TEXT, "High"); ObjectSetInteger(0, "tx", OBJPROP_FONTSIZE, 9);
  ObjectCreate(0, "lb", OBJ_LABEL, 0, 0, 0); ObjectSetInteger(0, "lb", OBJPROP_CORNER, CORNER_RIGHT_UPPER); ObjectSetInteger(0, "lb", OBJPROP_XDISTANCE, 10);
  ObjectSetInteger(0, "lb", OBJPROP_ANCHOR, ANCHOR_RIGHT_UPPER); ObjectSetString(0, "lb", OBJPROP_TEXT, "Sample label");
  ObjectCreate(0, "btn", OBJ_BUTTON, 0, 0, 0); ObjectSetInteger(0, "btn", OBJPROP_CORNER, CORNER_LEFT_LOWER);
  ObjectSetInteger(0, "btn", OBJPROP_XDISTANCE, 15); ObjectSetInteger(0, "btn", OBJPROP_YDISTANCE, 25); ObjectSetInteger(0, "btn", OBJPROP_XSIZE, 80); ObjectSetInteger(0, "btn", OBJPROP_YSIZE, 22);
  ObjectSetString(0, "btn", OBJPROP_TEXT, "Toggle"); ObjectSetInteger(0, "btn", OBJPROP_BGCOLOR, clrDimGray);
  ObjectCreate(0, "ed", OBJ_EDIT, 0, 0, 0); ObjectSetString(0, "ed", OBJPROP_TEXT, "20");
  ObjectCreate(0, "rl", OBJ_RECTANGLE_LABEL, 0, 0, 0); ObjectSetInteger(0, "rl", OBJPROP_BORDER_TYPE, BORDER_FLAT);
  ObjectCreate(0, "ar", OBJ_ARROW, 0, t2, p2); ObjectSetInteger(0, "ar", OBJPROP_ARROWCODE, 234);
  ObjectCreate(0, "au", OBJ_ARROW_UP, 0, t1, p1); ObjectCreate(0, "ad", OBJ_ARROW_DOWN, 0, t2, p2);
  ObjectCreate(0, "gone", OBJ_HLINE, 0, 0, p2); ObjectDelete(0, "gone");
  ObjectCreate(0, "pfx_1", OBJ_HLINE, 0, 0, p2); ObjectCreate(0, "pfx_2", OBJ_HLINE, 0, 0, p2); ObjectCreate(0, "pfx_3", OBJ_HLINE, 0, 0, p2);
  int f = ObjectFind(0, "btn") >= 0 ? 1 : 0;
  int k = ObjectsDeleteAll(0, "pfx_");
  Print("found ", f + k - 1, " left ", ObjectsTotal(0));
  ChartRedraw();
  return INIT_SUCCEEDED; }
int OnCalculate(${FULL}){ return rates_total; }
void OnDeinit(const int reason){ ObjectsDeleteAll(0, -1, -1); }` },

{ name: 'MA cross arrows', source: `
#property indicator_chart_window
#property indicator_buffers 4
#property indicator_plots 4
#property indicator_type1 DRAW_LINE
#property indicator_color1 clrOrange
#property indicator_type2 DRAW_LINE
#property indicator_color2 clrDodgerBlue
#property indicator_type3 DRAW_ARROW
#property indicator_color3 clrLime
#property indicator_type4 DRAW_ARROW
#property indicator_color4 clrRed
input int Fast = 9; input int Slow = 21; input ENUM_MA_METHOD Method = MODE_EMA;
double F[], S[], Up[], Dn[]; int hf, hs;
int OnInit(){
  SetIndexBuffer(0,F); SetIndexBuffer(1,S); SetIndexBuffer(2,Up); SetIndexBuffer(3,Dn);
  PlotIndexSetInteger(2, PLOT_ARROW, 233); PlotIndexSetInteger(3, PLOT_ARROW, 234);
  hf = iMA(_Symbol, _Period, Fast, 0, Method, PRICE_CLOSE); hs = iMA(_Symbol, _Period, Slow, 0, Method, PRICE_CLOSE);
  return 0; }
int OnCalculate(${FULL}){
  int n = prev_calculated == 0 ? rates_total : rates_total - prev_calculated + 1;
  if (CopyBuffer(hf, 0, 0, n, F) <= 0 || CopyBuffer(hs, 0, 0, n, S) <= 0) return 0;
  int from = prev_calculated == 0 ? 1 : prev_calculated - 1;
  for (int i = from; i < rates_total; i++) {
    Up[i] = EMPTY_VALUE; Dn[i] = EMPTY_VALUE;
    if (F[i-1] <= S[i-1] && F[i] > S[i]) Up[i] = low[i];
    if (F[i-1] >= S[i-1] && F[i] < S[i]) Dn[i] = high[i];
  }
  return rates_total; }`, check: (o) => { assert.equal(o.plots.length, 4); assert.ok(fin(lastVal(o, 0))); } },

{ name: 'MACD histogram colour', source: `
#property indicator_separate_window
#property indicator_buffers 4
#property indicator_plots 2
#property indicator_type1 DRAW_COLOR_HISTOGRAM
#property indicator_color1 clrSeaGreen,clrIndianRed
#property indicator_type2 DRAW_LINE
#property indicator_color2 clrSilver
double Hist[], HC[], Sig[], M[]; int h;
int OnInit(){ SetIndexBuffer(0,Hist); SetIndexBuffer(1,HC,INDICATOR_COLOR_INDEX); SetIndexBuffer(2,Sig); SetIndexBuffer(3,M,INDICATOR_CALCULATIONS);
  h = iMACD(NULL, 0, 12, 26, 9, PRICE_CLOSE); return 0; }
int OnCalculate(${FULL}){
  if (CopyBuffer(h, 0, 0, rates_total, M) <= 0 || CopyBuffer(h, 1, 0, rates_total, Sig) <= 0) return 0;
  for (int i = MathMax(prev_calculated - 1, 0); i < rates_total; i++) { Hist[i] = M[i] - Sig[i]; HC[i] = Hist[i] >= 0 ? 0 : 1; }
  return rates_total; }`, check: (o) => { assert.ok(o.plots[0].ci); } },

{ name: 'ATR bands', source: `
#property indicator_chart_window
#property indicator_buffers 3
#property indicator_plots 2
#property indicator_type1 DRAW_LINE
#property indicator_type2 DRAW_LINE
input int AtrLen = 14; input double Mult = 1.5;
double U[], D[], A[]; int ha;
int OnInit(){ SetIndexBuffer(0,U); SetIndexBuffer(1,D); SetIndexBuffer(2,A,INDICATOR_CALCULATIONS); ha = iATR(_Symbol,_Period,AtrLen); return 0; }
int OnCalculate(${FULL}){
  if (CopyBuffer(ha,0,0,rates_total,A) <= 0) return 0;
  for (int i = prev_calculated > 0 ? prev_calculated - 1 : 0; i < rates_total; i++) { U[i] = close[i] + Mult * A[i]; D[i] = close[i] - Mult * A[i]; }
  return rates_total; }` },

{ name: 'Stochastic two lines', source: `
#property indicator_separate_window
#property indicator_buffers 2
#property indicator_plots 2
#property indicator_level1 20
#property indicator_level2 80
#property indicator_levelcolor clrGray
double K[], D[]; int h;
int OnInit(){ SetIndexBuffer(0,K); SetIndexBuffer(1,D); h = iStochastic(_Symbol,_Period,14,3,3,MODE_SMA,STO_LOWHIGH); return 0; }
int OnCalculate(${FULL}){ if (CopyBuffer(h,0,0,rates_total,K)<=0 || CopyBuffer(h,1,0,rates_total,D)<=0) return 0; return rates_total; }` },

{ name: 'CCI zero-cross colours', source: `
#property indicator_separate_window
#property indicator_buffers 2
#property indicator_plots 1
#property indicator_type1 DRAW_COLOR_LINE
#property indicator_color1 clrTeal,clrTomato
#property indicator_level1 100
#property indicator_level2 -100
double C[], CC[]; int h;
int OnInit(){ SetIndexBuffer(0,C); SetIndexBuffer(1,CC,INDICATOR_COLOR_INDEX); h = iCCI(_Symbol,_Period,20,PRICE_TYPICAL); return 0; }
int OnCalculate(${FULL}){ if (CopyBuffer(h,0,0,rates_total,C)<=0) return 0; for (int i=0;i<rates_total;i++) CC[i] = C[i] >= 0 ? 0 : 1; return rates_total; }` },

{ name: 'ADX three lines', source: `
#property indicator_separate_window
#property indicator_buffers 3
#property indicator_plots 3
double A[], P[], M[]; int h;
int OnInit(){ SetIndexBuffer(0,A); SetIndexBuffer(1,P); SetIndexBuffer(2,M); h = iADX(_Symbol,_Period,14);
  PlotIndexSetString(0,PLOT_LABEL,"ADX"); PlotIndexSetString(1,PLOT_LABEL,"+DI"); PlotIndexSetString(2,PLOT_LABEL,"-DI"); return 0; }
int OnCalculate(${FULL}){ for (int b=0;b<3;b++) { double t[]; if (CopyBuffer(h,b,0,rates_total,t)<=0) return 0; for (int i=0;i<rates_total;i++) { if (b==0) A[i]=t[i]; else if (b==1) P[i]=t[i]; else M[i]=t[i]; } } return rates_total; }`,
  check: (o) => assert.deepEqual(o.plots.map((p) => p.label), ['ADX', '+DI', '-DI']) },

{ name: 'Parabolic SAR dots', source: `
#property indicator_chart_window
#property indicator_buffers 1
#property indicator_plots 1
#property indicator_type1 DRAW_ARROW
#property indicator_color1 clrYellow
input double Step = 0.02; input double Max = 0.2;
double S[]; int h;
int OnInit(){ SetIndexBuffer(0,S); PlotIndexSetInteger(0,PLOT_ARROW,159); h = iSAR(_Symbol,_Period,Step,Max); return 0; }
int OnCalculate(${FULL}){ return CopyBuffer(h,0,0,rates_total,S) > 0 ? rates_total : 0; }` },

{ name: 'Bollinger fill', source: `
#property indicator_chart_window
#property indicator_buffers 3
#property indicator_plots 2
#property indicator_type1 DRAW_FILLING
#property indicator_color1 clrLightBlue,clrLightBlue
#property indicator_type2 DRAW_LINE
double U[], L[], M[]; int h;
int OnInit(){ SetIndexBuffer(0,U); SetIndexBuffer(1,L); SetIndexBuffer(2,M); h = iBands(_Symbol,_Period,20,0,2.0,PRICE_CLOSE); return 0; }
int OnCalculate(${FULL}){ if (CopyBuffer(h,1,0,rates_total,U)<=0 || CopyBuffer(h,2,0,rates_total,L)<=0 || CopyBuffer(h,0,0,rates_total,M)<=0) return 0; return rates_total; }` },

{ name: 'Envelopes + StdDev', source: `
#property indicator_chart_window
#property indicator_buffers 3
#property indicator_plots 3
double U[], L[], SD[]; int he, hs;
int OnInit(){ SetIndexBuffer(0,U); SetIndexBuffer(1,L); SetIndexBuffer(2,SD); PlotIndexSetInteger(2,PLOT_DRAW_TYPE,DRAW_NONE);
  he = iEnvelopes(_Symbol,_Period,14,0,MODE_SMA,PRICE_CLOSE,0.1); hs = iStdDev(_Symbol,_Period,20,0,MODE_SMA,PRICE_CLOSE); return 0; }
int OnCalculate(${FULL}){ if (CopyBuffer(he,0,0,rates_total,U)<=0 || CopyBuffer(he,1,0,rates_total,L)<=0 || CopyBuffer(hs,0,0,rates_total,SD)<=0) return 0; return rates_total; }` },

{ name: 'Momentum price form', source: `
#property indicator_separate_window
#property indicator_buffers 1
#property indicator_plots 1
input int Len = 10;
double X[];
int OnInit(){ SetIndexBuffer(0,X); return 0; }
int OnCalculate(const int rates_total,const int prev_calculated,const int begin,const double &price[]){
  for (int i = MathMax(Len, prev_calculated - 1); i < rates_total; i++) X[i] = price[i] * 100 / price[i - Len];
  return rates_total; }`, check: (o) => assert.ok(fin(lastVal(o))) },

{ name: 'Donchian channel', source: `
#property indicator_chart_window
#property indicator_buffers 3
#property indicator_plots 3
input int Len = 20;
double U[], L[], M[];
int OnInit(){ SetIndexBuffer(0,U); SetIndexBuffer(1,L); SetIndexBuffer(2,M); for (int k=0;k<3;k++) PlotIndexSetInteger(k,PLOT_DRAW_BEGIN,Len-1); return 0; }
int OnCalculate(${FULL}){
  for (int i = MathMax(Len - 1, prev_calculated - 1); i < rates_total; i++) {
    U[i] = high[ArrayMaximum(high, i - Len + 1, Len)]; L[i] = low[ArrayMinimum(low, i - Len + 1, Len)]; M[i] = (U[i] + L[i]) / 2;
  }
  return rates_total; }`, check: (o, ind, B) => { const n = B.close.length; assert.equal(ind.buffer(0)[n - 1], Math.max(...B.high.slice(n - 20))); } },

{ name: 'Heikin Ashi candles', source: `
#property indicator_chart_window
#property indicator_buffers 5
#property indicator_plots 1
#property indicator_type1 DRAW_COLOR_CANDLES
#property indicator_color1 clrDodgerBlue,clrTomato
double O[], H[], L[], C[], K[];
int OnInit(){ SetIndexBuffer(0,O); SetIndexBuffer(1,H); SetIndexBuffer(2,L); SetIndexBuffer(3,C); SetIndexBuffer(4,K,INDICATOR_COLOR_INDEX); return 0; }
int OnCalculate(${FULL}){
  int s = prev_calculated == 0 ? 1 : prev_calculated - 1;
  if (prev_calculated == 0) { O[0] = open[0]; C[0] = close[0]; H[0] = high[0]; L[0] = low[0]; K[0] = 0; }
  for (int i = s; i < rates_total; i++) {
    C[i] = (open[i] + high[i] + low[i] + close[i]) / 4; O[i] = (O[i-1] + C[i-1]) / 2;
    H[i] = MathMax(high[i], MathMax(O[i], C[i])); L[i] = MathMin(low[i], MathMin(O[i], C[i])); K[i] = O[i] < C[i] ? 0 : 1;
  }
  return rates_total; }`, check: (o) => { assert.equal(o.plots[0].type, 17); assert.equal(o.plots[0].data.length, 4); } },

{ name: 'Series-indexed loop', source: `
#property indicator_separate_window
#property indicator_buffers 1
#property indicator_plots 1
#property indicator_type1 DRAW_HISTOGRAM
double X[];
int OnInit(){ SetIndexBuffer(0,X); ArraySetAsSeries(X,true); return 0; }
int OnCalculate(${FULL}){
  ArraySetAsSeries(close,true); ArraySetAsSeries(open,true);
  int limit = prev_calculated == 0 ? rates_total - 1 : rates_total - prev_calculated;
  for (int i = limit; i >= 0; i--) X[i] = close[i] - open[i];
  return rates_total; }`, check: (o, ind, B) => { const n = B.close.length; assert.ok(Math.abs(ind.buffer(0)[n - 1] - (B.close[n - 1] - B.open[n - 1])) < 1e-12); } },

{ name: 'Strings and time', source: `
#property indicator_chart_window
int OnCalculate(${FULL}){
  if (prev_calculated > 0) return rates_total;
  MqlDateTime d; TimeToStruct(time[rates_total-1], d);
  string parts[]; int k = StringSplit("a,b,,c", ',', parts);
  string s = "  Mixed Case  "; StringTrimLeft(s); StringTrimRight(s); StringToUpper(s);
  Print(TimeToString(time[0], TIME_DATE|TIME_MINUTES), "|", d.year, "|", k, "|", s, "|", StringSubstr("abcdef", 2, 3), "|", StringFind("abcabc", "c", 3),
        "|", DoubleToString(M_PI, 4), "|", IntegerToString(42, 6, '0'), "|", StringReplace(s, "CASE", "x"), s, "|", PeriodSeconds(), "|", (int)StringToInteger("17") + 1,
        "|", StringToTime("2026.01.02 03:04") == D'2026.01.02 03:04', "|", CharToString(65), "|", ShortToString(0x42), "|", StringLen(_Symbol));
  return rates_total; }`, check: (o) => assert.deepEqual(o.prints, ['2026.01.01 00:00|2026|4|MIXED CASE|cde|5|3.1416|000042|1MIXED x|900|18|true|A|B|6']) },

{ name: 'Math functions', source: `
#property indicator_chart_window
int OnCalculate(${FULL}){
  if (prev_calculated > 0) return rates_total;
  Print(MathAbs(-2), " ", MathMax(3, 7), " ", MathMin(3, 7), " ", MathPow(2, 10), " ", MathSqrt(81), " ", MathRound(2.5), " ", MathFloor(-1.5), " ", MathCeil(1.2), " ",
        DoubleToString(MathLog(M_E), 3), " ", MathMod(10, 3), " ", MathIsValidNumber(MathArccos(2)), " ", NormalizeDouble(1.234567, 2), " ", fmax(1, 2), " ", MathExp(0));
  return rates_total; }`, check: (o) => assert.deepEqual(o.prints, ['2 7 3 1024 9 3 -2 2 1.000 1 false 1.23 2 1']) },

{ name: 'Array functions', source: `
#property indicator_chart_window
int OnCalculate(${FULL}){
  if (prev_calculated > 0) return rates_total;
  double a[]; ArrayResize(a, 5); for (int i=0;i<5;i++) a[i] = 5 - i;
  ArraySort(a); double b[]; ArrayCopy(b, a, 0, 1, 3);
  int idx = ArrayBsearch(a, 4.0); ArrayReverse(a);
  int z[10]; ArrayInitialize(z, 7); ArrayFill(z, 2, 3, 1);
  double c[]; ArrayResize(c, 3, 100); ArrayFree(c);
  Print(ArraySize(a), " ", a[0], " ", b[0], ",", b[2], " ", idx, " ", z[1], z[2], z[4], z[5], " ", ArraySize(c), " ", ArrayMaximum(b), " ", ArrayIsDynamic(a), " ", ArrayGetAsSeries(a));
  return rates_total; }`, check: (o) => assert.deepEqual(o.prints, ['5 5 2,4 3 7117 0 2 true false']) },

{ name: 'Struct ring buffer', source: `
#property indicator_separate_window
#property indicator_buffers 1
#property indicator_plots 1
struct Ring { double v[]; int head; int cnt; int cap; };
Ring r;
void RingInit(Ring &q, int n) { q.cap = n; ArrayResize(q.v, n); q.head = 0; q.cnt = 0; }
void RingPush(Ring &q, double x) { q.v[q.head] = x; q.head = (q.head + 1) % q.cap; if (q.cnt < q.cap) q.cnt++; }
double RingMean(const Ring &q) { double s = 0; for (int i = 0; i < q.cnt; i++) s += q.v[i]; return q.cnt ? s / q.cnt : 0; }
double X[];
int OnInit(){ SetIndexBuffer(0,X); RingInit(r, 10); return 0; }
int OnCalculate(${FULL}){
  if (prev_calculated == 0) RingInit(r, 10);
  for (int i = MathMax(prev_calculated - 1, 0); i < rates_total; i++) { if (i == rates_total - 1 && prev_calculated > 0) break; RingPush(r, close[i]); X[i] = r.cnt == r.cap ? RingMean(r) : EMPTY_VALUE; }
  return rates_total; }`, check: (o, ind, B) => { const n = B.close.length; assert.ok(Math.abs(ind.buffer(0)[n - 1] - B.close.slice(n - 10).reduce((a, b) => a + b, 0) / 10) < 1e-9); } },

{ name: 'Session boxes', source: `
#property indicator_chart_window
input int StartHour = 8; input int EndHour = 12; input color BoxColor = clrSlateGray;
int OnCalculate(${FULL}){
  int made = 0;
  for (int i = MathMax(1, prev_calculated - 1); i < rates_total; i++) {
    MqlDateTime a, b; TimeToStruct(time[i], a); TimeToStruct(time[i-1], b);
    if (a.hour == StartHour && b.hour != StartHour) {
      string nm = "ses_" + TimeToString(time[i], TIME_DATE);
      datetime t2 = time[i] + (EndHour - StartHour) * 3600;
      int sh = iBarShift(_Symbol, _Period, t2), s0 = rates_total - 1 - i;
      int len = MathMax(1, s0 - sh);
      double hi = iHigh(_Symbol, _Period, iHighest(_Symbol, _Period, MODE_HIGH, len, sh));
      double lo = iLow(_Symbol, _Period, iLowest(_Symbol, _Period, MODE_LOW, len, sh));
      ObjectCreate(0, nm, OBJ_RECTANGLE, 0, time[i], hi, t2, lo); ObjectSetInteger(0, nm, OBJPROP_COLOR, BoxColor);
      ObjectCreate(0, nm + "_t", OBJ_TEXT, 0, time[i], hi); ObjectSetString(0, nm + "_t", OBJPROP_TEXT, "Session"); made++;
    }
  }
  return rates_total; }`, check: (o) => assert.ok(o.objects.filter((x) => x.type === 18).length >= 2) },

{ name: 'Countdown timer label', timer: true, source: `
#property indicator_chart_window
int OnInit(){ EventSetTimer(1); ObjectCreate(0,"cd",OBJ_LABEL,0,0,0); ObjectSetInteger(0,"cd",OBJPROP_CORNER,CORNER_RIGHT_LOWER); ObjectSetInteger(0,"cd",OBJPROP_XDISTANCE,10); ObjectSetInteger(0,"cd",OBJPROP_YDISTANCE,10); return 0; }
void Show(){ datetime open = iTime(_Symbol,_Period,0); long left = (long)(open + PeriodSeconds() - TimeCurrent()); if (left < 0) left = 0;
  ObjectSetString(0,"cd",OBJPROP_TEXT,StringFormat("%02d:%02d", (int)(left/60), (int)(left%60))); }
void OnTimer(){ Show(); }
int OnCalculate(${FULL}){ Show(); return rates_total; }
void OnDeinit(const int r){ EventKillTimer(); ObjectDelete(0,"cd"); }`, check: (o) => { const s = new Map(o.objects.find((x) => x.name === 'cd').s); assert.equal(s.get(201), '05:00'); } },

{ name: 'Buttons toggle plots', source: `
#property indicator_chart_window
#property indicator_buffers 1
#property indicator_plots 1
double X[]; bool on = true;
int OnInit(){ SetIndexBuffer(0,X); ObjectCreate(0,"t",OBJ_BUTTON,0,0,0); ObjectSetString(0,"t",OBJPROP_TEXT,"Hide"); ObjectSetInteger(0,"t",OBJPROP_STATE,true); return 0; }
int OnCalculate(${FULL}){ for (int i=MathMax(0,prev_calculated-1);i<rates_total;i++) X[i]=close[i]; return rates_total; }
void OnChartEvent(const int id,const long &l,const double &d,const string &s){
  if (id == CHARTEVENT_OBJECT_CLICK && s == "t") { on = (bool)ObjectGetInteger(0,"t",OBJPROP_STATE); PlotIndexSetInteger(0,PLOT_DRAW_TYPE,on ? DRAW_LINE : DRAW_NONE); ObjectSetString(0,"t",OBJPROP_TEXT,on ? "Hide" : "Show"); ChartRedraw(); } }` },

{ name: 'Edit box period', source: `
#property indicator_chart_window
#property indicator_buffers 1
#property indicator_plots 1
double X[]; int len = 10;
int OnInit(){ SetIndexBuffer(0,X); ObjectCreate(0,"e",OBJ_EDIT,0,0,0); ObjectSetString(0,"e",OBJPROP_TEXT,"10"); return 0; }
int OnCalculate(${FULL}){ for (int i=len;i<rates_total;i++){ double s=0; for(int k=0;k<len;k++) s+=close[i-k]; X[i]=s/len; } return rates_total; }
void OnChartEvent(const int id,const long &l,const double &d,const string &s){
  if (id == CHARTEVENT_OBJECT_ENDEDIT && s == "e") { int v = (int)StringToInteger(ObjectGetString(0,"e",OBJPROP_TEXT)); if (v >= 2 && v <= 500) { len = v; ChartSetSymbolPeriod(0, NULL, 0); } } }` },

{ name: 'Info panel', source: `
#property indicator_chart_window
int OnInit(){
  ObjectCreate(0,"bg",OBJ_RECTANGLE_LABEL,0,0,0); ObjectSetInteger(0,"bg",OBJPROP_XDISTANCE,8); ObjectSetInteger(0,"bg",OBJPROP_YDISTANCE,8);
  ObjectSetInteger(0,"bg",OBJPROP_XSIZE,180); ObjectSetInteger(0,"bg",OBJPROP_YSIZE,60); ObjectSetInteger(0,"bg",OBJPROP_BGCOLOR,C'30,34,45');
  for (int k = 0; k < 3; k++) { string n = "row" + (string)k; ObjectCreate(0,n,OBJ_LABEL,0,0,0); ObjectSetInteger(0,n,OBJPROP_XDISTANCE,16); ObjectSetInteger(0,n,OBJPROP_YDISTANCE,14 + 16*k); ObjectSetString(0,n,OBJPROP_FONT,"Consolas"); }
  return 0; }
int OnCalculate(${FULL}){
  int i = rates_total - 1;
  ObjectSetString(0,"row0",OBJPROP_TEXT,"Symbol " + _Symbol);
  ObjectSetString(0,"row1",OBJPROP_TEXT,"Close  " + DoubleToString(close[i], _Digits));
  ObjectSetString(0,"row2",OBJPROP_TEXT,"Range  " + DoubleToString((high[i]-low[i]) / _Point, 0) + " pts");
  Comment("Bars: ", rates_total, "\\nSpread: ", SymbolInfoInteger(_Symbol, SYMBOL_SPREAD));
  return rates_total; }`, check: (o) => assert.ok(/^Bars: 400\n/.test(o.comment), o.comment) },

{ name: 'iCustom-free zigzag', source: `
#property indicator_chart_window
#property indicator_buffers 2
#property indicator_plots 1
#property indicator_type1 DRAW_ZIGZAG
#property indicator_color1 clrGold
input int Depth = 12;
double Hi[], Lo[];
int OnInit(){ SetIndexBuffer(0,Hi); SetIndexBuffer(1,Lo); PlotIndexSetDouble(0,PLOT_EMPTY_VALUE,0.0); return 0; }
int OnCalculate(${FULL}){
  ArrayInitialize(Hi, 0.0); ArrayInitialize(Lo, 0.0);
  int last = 0; // 1 = last pivot was a high
  for (int i = Depth; i < rates_total - Depth; i++) {
    bool isH = true, isL = true;
    for (int k = 1; k <= Depth; k++) { if (high[i-k] > high[i] || high[i+k] > high[i]) isH = false; if (low[i-k] < low[i] || low[i+k] < low[i]) isL = false; }
    if (isH && last != 1) { Hi[i] = high[i]; last = 1; } else if (isL && last != -1) { Lo[i] = low[i]; last = -1; }
  }
  return rates_total; }` },

{ name: 'Multi-timeframe close', source: `
#property indicator_chart_window
#property indicator_buffers 1
#property indicator_plots 1
#property indicator_type1 DRAW_SECTION
double X[];
int OnInit(){ SetIndexBuffer(0,X); return 0; }
int OnCalculate(${FULL}){
  MqlRates r[]; int got = CopyRates(_Symbol, _Period, 0, 50, r);
  double cl[]; int g2 = CopyClose(_Symbol, _Period, 0, 50, cl);
  datetime tt[]; CopyTime(_Symbol, _Period, 0, 3, tt);
  for (int i = 0; i < rates_total; i++) X[i] = i % 10 == 0 ? close[i] : EMPTY_VALUE;
  Print(got, " ", g2, " ", r[49].close == close[rates_total-1], " ", cl[0] == close[rates_total-50], " ", tt[2] == time[rates_total-1], " ", iBars(_Symbol,_Period), " ", Bars(_Symbol,_Period));
  return rates_total; }`, check: (o) => assert.deepEqual(o.prints, ['50 50 true true true 400 400']) },

{ name: 'Volume histogram 2', source: `
#property indicator_separate_window
#property indicator_buffers 3
#property indicator_plots 1
#property indicator_type1 DRAW_COLOR_HISTOGRAM2
#property indicator_color1 clrGreen,clrRed
double A[], Z[], K[];
int OnInit(){ SetIndexBuffer(0,A); SetIndexBuffer(1,Z); SetIndexBuffer(2,K,INDICATOR_COLOR_INDEX); return 0; }
int OnCalculate(${FULL}){ for (int i=prev_calculated>0?prev_calculated-1:0;i<rates_total;i++){ A[i]=(double)tick_volume[i]; Z[i]=0; K[i]=close[i]>=open[i]?0:1; } return rates_total; }`, check: (o) => assert.equal(o.plots[0].type, 11) },

{ name: 'Alert on RSI extreme', source: `
#property indicator_separate_window
#property indicator_buffers 1
#property indicator_plots 1
double R[]; int h; datetime lastAlert = 0;
int OnInit(){ SetIndexBuffer(0,R); h = iRSI(_Symbol,_Period,14,PRICE_CLOSE); return 0; }
int OnCalculate(${FULL}){
  if (CopyBuffer(h,0,0,rates_total,R) <= 0) return 0;
  int i = rates_total - 2;
  if (time[i] != lastAlert && (R[i] > 70 || R[i] < 30)) { Alert("RSI ", DoubleToString(R[i],1)); lastAlert = time[i]; }
  return rates_total; }` },

{ name: 'Globals, statics, macros', source: `
#property indicator_chart_window
#define SQR(x) ((x)*(x))
#define NAME "calc"
int counter() { static int c = 0; return ++c; }
const double K = 0.5;
int OnCalculate(${FULL}){
  int a = counter(); int b = counter();
  uint u = (uint)-1; long big = 1 << 20; char ch = (char)200; uchar uc = (uchar)300;
  Print(NAME, " ", SQR(3+1), " ", a, b, " ", u, " ", big, " ", (int)ch, " ", (int)uc, " ", K * 4, " ", 7 / 2, " ", 7.0 / 2, " ", -7 % 3, " ", (5 & 3) | 8, " ", true && !false);
  return rates_total; }`, check: (o) => assert.equal(o.prints[0], 'calc 16 12 4294967295 1048576 -56 44 2 3 3.5 -1 9 true') },
];
