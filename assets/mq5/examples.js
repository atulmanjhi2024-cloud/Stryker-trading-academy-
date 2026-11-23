// TradeZoro MQL5 examples for the script editor's Examples tab. Written for TradeZoro; education only, not financial advice.
// Each runs as pasted: { id, name, source }.
const MA_CROSS = `//+------------------------------------------------------------------+
//| MA cross with buttons                                             |
//| Two moving averages, arrows where they cross, and on-chart        |
//| buttons to switch the fast line type and to hide the arrows.      |
//+------------------------------------------------------------------+
#property description "Two moving averages with cross arrows and on-chart buttons."
#property indicator_chart_window
#property indicator_buffers 4
#property indicator_plots   4
#property indicator_type1   DRAW_LINE
#property indicator_color1  clrDodgerBlue
#property indicator_width1  2
#property indicator_label1  "Fast MA"
#property indicator_type2   DRAW_LINE
#property indicator_color2  clrOrange
#property indicator_width2  2
#property indicator_label2  "Slow MA"
#property indicator_type3   DRAW_ARROW
#property indicator_color3  clrLimeGreen
#property indicator_label3  "Cross up"
#property indicator_type4   DRAW_ARROW
#property indicator_color4  clrTomato
#property indicator_label4  "Cross down"

input group "Moving averages"
input int            InpFast   = 9;          // Fast period
input int            InpSlow   = 21;         // Slow period
input ENUM_MA_METHOD InpMethod = MODE_EMA;   // Method
input group "Buttons"
input bool           InpButtons = true;      // Show the buttons

double Fast[], Slow[], Up[], Down[];
bool   g_ema = true, g_arrows = true;

void MakeButton(const string name, const string text, const int x, const bool on)
  {
   ObjectCreate(0, name, OBJ_BUTTON, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE, 36);
   ObjectSetInteger(0, name, OBJPROP_XSIZE, 104);
   ObjectSetInteger(0, name, OBJPROP_YSIZE, 28);
   ObjectSetString(0, name, OBJPROP_TEXT, text);
   ObjectSetInteger(0, name, OBJPROP_STATE, on);
  }

int OnInit()
  {
   if(InpFast < 1 || InpSlow <= InpFast) return(INIT_PARAMETERS_INCORRECT);
   SetIndexBuffer(0, Fast, INDICATOR_DATA);
   SetIndexBuffer(1, Slow, INDICATOR_DATA);
   SetIndexBuffer(2, Up,   INDICATOR_DATA);
   SetIndexBuffer(3, Down, INDICATOR_DATA);
   PlotIndexSetInteger(2, PLOT_ARROW, 233);
   PlotIndexSetInteger(3, PLOT_ARROW, 234);
   PlotIndexSetInteger(0, PLOT_DRAW_BEGIN, InpSlow);
   PlotIndexSetInteger(1, PLOT_DRAW_BEGIN, InpSlow);
   g_ema = (InpMethod == MODE_EMA);
   IndicatorSetString(INDICATOR_SHORTNAME, "MA cross " + IntegerToString(InpFast) + "/" + IntegerToString(InpSlow));
   if(InpButtons)
     {
      MakeButton("mac_type", g_ema ? "Fast: EMA" : "Fast: SMA", 12, g_ema);
      MakeButton("mac_arrows", "Arrows: on", 124, true);
     }
   return(INIT_SUCCEEDED);
  }

double Average(const double &price[], const int i, const int period, const bool ema, const double prev)
  {
   if(ema && prev != EMPTY_VALUE && i > 0)
      return price[i] * 2.0 / (period + 1) + prev * (1.0 - 2.0 / (period + 1));
   double sum = 0;
   for(int k = 0; k < period; k++) sum += price[i - k];
   return sum / period;
  }

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[],
                const double &open[], const double &high[], const double &low[], const double &close[],
                const long &tick_volume[], const long &volume[], const int &spread[])
  {
   if(rates_total < InpSlow + 2) return(0);
   int start = prev_calculated > 1 ? prev_calculated - 1 : InpSlow - 1;
   if(start == InpSlow - 1)
      for(int i = 0; i < start; i++) { Fast[i] = EMPTY_VALUE; Slow[i] = EMPTY_VALUE; Up[i] = EMPTY_VALUE; Down[i] = EMPTY_VALUE; }
   for(int i = start; i < rates_total; i++)
     {
      Fast[i] = Average(close, i, InpFast, g_ema, i > start || prev_calculated > 1 ? Fast[i - 1] : EMPTY_VALUE);
      Slow[i] = Average(close, i, InpSlow, InpMethod == MODE_EMA, i > start || prev_calculated > 1 ? Slow[i - 1] : EMPTY_VALUE);
      Up[i] = EMPTY_VALUE; Down[i] = EMPTY_VALUE;
      if(!g_arrows || i == InpSlow - 1 || Fast[i - 1] == EMPTY_VALUE) continue;
      double range = high[i] - low[i];
      if(Fast[i - 1] <= Slow[i - 1] && Fast[i] > Slow[i]) Up[i] = low[i] - range * 0.5;
      if(Fast[i - 1] >= Slow[i - 1] && Fast[i] < Slow[i]) Down[i] = high[i] + range * 0.5;
     }
   return(rates_total);
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(id != CHARTEVENT_OBJECT_CLICK) return;
   if(sparam == "mac_type")
     {
      g_ema = (bool)ObjectGetInteger(0, "mac_type", OBJPROP_STATE);
      ObjectSetString(0, "mac_type", OBJPROP_TEXT, g_ema ? "Fast: EMA" : "Fast: SMA");
     }
   else if(sparam == "mac_arrows")
     {
      g_arrows = (bool)ObjectGetInteger(0, "mac_arrows", OBJPROP_STATE);
      ObjectSetString(0, "mac_arrows", OBJPROP_TEXT, g_arrows ? "Arrows: on" : "Arrows: off");
     }
   else return;
   ChartSetSymbolPeriod(0, NULL, 0);   // recalculate everything with the new choice
  }

void OnDeinit(const int reason)
  {
   ObjectsDeleteAll(0, "mac_");
  }
`;

const RSI = `//+------------------------------------------------------------------+
//| RSI with levels                                                   |
//| Relative Strength Index in its own window, with 30/70 levels and  |
//| the line coloured by zone.                                        |
//+------------------------------------------------------------------+
#property description "RSI in a separate window with 30 and 70 levels."
#property indicator_separate_window
#property indicator_minimum 0
#property indicator_maximum 100
#property indicator_level1  30
#property indicator_level2  70
#property indicator_levelcolor clrSilver
#property indicator_levelstyle STYLE_DOT
#property indicator_buffers 4
#property indicator_plots   1
#property indicator_type1   DRAW_COLOR_LINE
#property indicator_color1  clrDodgerBlue,clrTomato,clrLimeGreen
#property indicator_width1  2
#property indicator_label1  "RSI"

input int    InpPeriod = 14;   // Period
input double InpHigh   = 70;   // Upper level
input double InpLow    = 30;   // Lower level

double Rsi[], Clr[], Gain[], Loss[];

int OnInit()
  {
   SetIndexBuffer(0, Rsi,  INDICATOR_DATA);
   SetIndexBuffer(1, Clr,  INDICATOR_COLOR_INDEX);
   SetIndexBuffer(2, Gain, INDICATOR_CALCULATIONS);
   SetIndexBuffer(3, Loss, INDICATOR_CALCULATIONS);
   IndicatorSetInteger(INDICATOR_DIGITS, 2);
   IndicatorSetDouble(INDICATOR_LEVELVALUE, 0, InpLow);
   IndicatorSetDouble(INDICATOR_LEVELVALUE, 1, InpHigh);
   IndicatorSetString(INDICATOR_SHORTNAME, "RSI(" + IntegerToString(InpPeriod) + ")");
   PlotIndexSetInteger(0, PLOT_DRAW_BEGIN, InpPeriod);
   return(INIT_SUCCEEDED);
  }

int OnCalculate(const int rates_total, const int prev_calculated, const int begin, const double &price[])
  {
   if(rates_total <= InpPeriod) return(0);
   int start = prev_calculated - 1;
   if(prev_calculated == 0)
     {
      double up = 0, dn = 0;
      for(int i = 1; i <= InpPeriod; i++)
        {
         double d = price[i] - price[i - 1];
         if(d > 0) up += d; else dn -= d;
        }
      for(int i = 0; i < InpPeriod; i++) { Rsi[i] = EMPTY_VALUE; Clr[i] = 0; Gain[i] = 0; Loss[i] = 0; }
      Gain[InpPeriod] = up / InpPeriod;
      Loss[InpPeriod] = dn / InpPeriod;
      start = InpPeriod;
     }
   for(int i = start; i < rates_total; i++)
     {
      if(i > InpPeriod)
        {
         double d = price[i] - price[i - 1];
         Gain[i] = (Gain[i - 1] * (InpPeriod - 1) + (d > 0 ? d : 0)) / InpPeriod;
         Loss[i] = (Loss[i - 1] * (InpPeriod - 1) + (d < 0 ? -d : 0)) / InpPeriod;
        }
      Rsi[i] = Loss[i] == 0 ? 100.0 : 100.0 - 100.0 / (1.0 + Gain[i] / Loss[i]);
      Clr[i] = Rsi[i] >= InpHigh ? 1 : Rsi[i] <= InpLow ? 2 : 0;
     }
   return(rates_total);
  }
`;

const BANDS = `//+------------------------------------------------------------------+
//| Bollinger fill                                                    |
//| Bollinger Bands from the built-in iBands handle, with the space   |
//| between the bands filled.                                         |
//+------------------------------------------------------------------+
#property description "Bollinger Bands with a filled channel, read from an iBands handle."
#property indicator_chart_window
#property indicator_buffers 5
#property indicator_plots   3
#property indicator_type1   DRAW_FILLING
#property indicator_color1  C'33,150,243',C'33,150,243'
#property indicator_label1  "Band fill"
#property indicator_type2   DRAW_LINE
#property indicator_color2  clrDodgerBlue
#property indicator_label2  "Upper"
#property indicator_type3   DRAW_LINE
#property indicator_color3  clrDodgerBlue
#property indicator_label3  "Lower"

input int                InpPeriod = 20;            // Period
input double             InpDev    = 2.0;           // Deviations
input ENUM_APPLIED_PRICE InpPrice  = PRICE_CLOSE;   // Price

double FillUp[], FillDn[], Upper[], Lower[], Mid[];
int    h_bands = INVALID_HANDLE;

int OnInit()
  {
   SetIndexBuffer(0, FillUp, INDICATOR_DATA);
   SetIndexBuffer(1, FillDn, INDICATOR_DATA);
   SetIndexBuffer(2, Upper,  INDICATOR_DATA);
   SetIndexBuffer(3, Lower,  INDICATOR_DATA);
   SetIndexBuffer(4, Mid,    INDICATOR_CALCULATIONS);
   h_bands = iBands(_Symbol, PERIOD_CURRENT, InpPeriod, 0, InpDev, InpPrice);
   if(h_bands == INVALID_HANDLE) return(INIT_FAILED);
   IndicatorSetString(INDICATOR_SHORTNAME, StringFormat("Bands(%d, %.1f)", InpPeriod, InpDev));
   return(INIT_SUCCEEDED);
  }

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[],
                const double &open[], const double &high[], const double &low[], const double &close[],
                const long &tick_volume[], const long &volume[], const int &spread[])
  {
   if(BarsCalculated(h_bands) < rates_total) return(0);
   int count = prev_calculated == 0 ? rates_total : rates_total - prev_calculated + 1;
   if(CopyBuffer(h_bands, 0, 0, count, Mid) <= 0) return(0);
   if(CopyBuffer(h_bands, 1, 0, count, Upper) <= 0) return(0);
   if(CopyBuffer(h_bands, 2, 0, count, Lower) <= 0) return(0);
   for(int i = rates_total - count; i < rates_total; i++)
     {
      FillUp[i] = Upper[i];
      FillDn[i] = Lower[i];
     }
   return(rates_total);
  }
`;

const SESSIONS = `//+------------------------------------------------------------------+
//| Session boxes                                                     |
//| A box around each day's session (high to low) with a label that   |
//| shows the session range in points.                                |
//+------------------------------------------------------------------+
#property description "Boxes around each session's high and low, with a range label."
#property indicator_chart_window
#property indicator_plots 0

input int   InpStartHour = 9;            // Session start (hour, chart time)
input int   InpEndHour   = 16;           // Session end (hour, chart time)
input int   InpDays      = 10;           // Sessions to draw
input color InpBox       = C'41,98,255'; // Box colour
input color InpText      = clrSilver;    // Label colour

string Prefix = "sess_";

bool InSession(const datetime t)
  {
   MqlDateTime s;
   TimeToStruct(t, s);
   if(InpStartHour <= InpEndHour) return(s.hour >= InpStartHour && s.hour < InpEndHour);
   return(s.hour >= InpStartHour || s.hour < InpEndHour);
  }

int OnInit()
  {
   if(PeriodSeconds() >= PeriodSeconds(PERIOD_D1))
     {
      Print("Session boxes need an intraday timeframe.");
      return(INIT_SUCCEEDED);
     }
   return(INIT_SUCCEEDED);
  }

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[],
                const double &open[], const double &high[], const double &low[], const double &close[],
                const long &tick_volume[], const long &volume[], const int &spread[])
  {
   if(PeriodSeconds() >= PeriodSeconds(PERIOD_D1)) return(rates_total);
   ObjectsDeleteAll(0, Prefix);
   int drawn = 0, i = rates_total - 1;
   while(i >= 0 && drawn < InpDays)
     {
      while(i >= 0 && !InSession(time[i])) i--;
      if(i < 0) break;
      int last = i;
      double hi = high[i], lo = low[i];
      while(i > 0 && InSession(time[i - 1]) && time[last] - time[i - 1] < 86400)
        {
         i--;
         hi = MathMax(hi, high[i]);
         lo = MathMin(lo, low[i]);
        }
      int first = i;
      string box = Prefix + "box" + IntegerToString(drawn);
      ObjectCreate(0, box, OBJ_RECTANGLE, 0, time[first], hi, time[last], lo);
      ObjectSetInteger(0, box, OBJPROP_COLOR, InpBox);
      ObjectSetInteger(0, box, OBJPROP_FILL, true);
      ObjectSetInteger(0, box, OBJPROP_BACK, true);
      string lbl = Prefix + "lbl" + IntegerToString(drawn);
      ObjectCreate(0, lbl, OBJ_TEXT, 0, time[first], hi);
      ObjectSetString(0, lbl, OBJPROP_TEXT, "Range " + DoubleToString((hi - lo) / _Point, 0) + " pts");
      ObjectSetInteger(0, lbl, OBJPROP_COLOR, InpText);
      ObjectSetInteger(0, lbl, OBJPROP_ANCHOR, ANCHOR_LEFT_LOWER);
      ObjectSetInteger(0, lbl, OBJPROP_FONTSIZE, 9);
      drawn++;
      i--;
     }
   return(rates_total);
  }

void OnDeinit(const int reason) { ObjectsDeleteAll(0, Prefix); }
`;

const COUNTDOWN = `//+------------------------------------------------------------------+
//| Bar countdown                                                     |
//| A timer that shows how long until the current bar closes, in a    |
//| panel in the corner of the chart.                                 |
//+------------------------------------------------------------------+
#property description "Time left until the current bar closes, updated every second."
#property indicator_chart_window
#property indicator_plots 0

input ENUM_BASE_CORNER InpCorner = CORNER_RIGHT_UPPER;   // Corner
input int              InpX      = 16;                   // Distance from the side (px)
input int              InpY      = 40;                   // Distance from the edge (px)
input color            InpText   = clrWhite;             // Text colour
input color            InpPanel  = C'30,34,45';          // Panel colour

datetime g_bar = 0;

int OnInit()
  {
   ObjectCreate(0, "cd_panel", OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, "cd_panel", OBJPROP_CORNER, InpCorner);
   ObjectSetInteger(0, "cd_panel", OBJPROP_XDISTANCE, InpX + 132);
   ObjectSetInteger(0, "cd_panel", OBJPROP_YDISTANCE, InpY);
   ObjectSetInteger(0, "cd_panel", OBJPROP_XSIZE, 132);
   ObjectSetInteger(0, "cd_panel", OBJPROP_YSIZE, 32);
   ObjectSetInteger(0, "cd_panel", OBJPROP_BGCOLOR, InpPanel);
   ObjectSetInteger(0, "cd_panel", OBJPROP_BORDER_COLOR, InpPanel);
   if(InpCorner == CORNER_LEFT_UPPER || InpCorner == CORNER_LEFT_LOWER)
      ObjectSetInteger(0, "cd_panel", OBJPROP_XDISTANCE, InpX);
   ObjectCreate(0, "cd_text", OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(0, "cd_text", OBJPROP_CORNER, InpCorner);
   ObjectSetInteger(0, "cd_text", OBJPROP_XDISTANCE, InpCorner == CORNER_LEFT_UPPER || InpCorner == CORNER_LEFT_LOWER ? InpX + 12 : InpX + 120);
   ObjectSetInteger(0, "cd_text", OBJPROP_YDISTANCE, InpY + 8);
   ObjectSetInteger(0, "cd_text", OBJPROP_COLOR, InpText);
   ObjectSetInteger(0, "cd_text", OBJPROP_FONTSIZE, 10);
   ObjectSetString(0, "cd_text", OBJPROP_TEXT, "Bar closes in --:--");
   EventSetTimer(1);
   return(INIT_SUCCEEDED);
  }

void Show()
  {
   if(g_bar == 0) return;
   long left = (long)(g_bar + PeriodSeconds() - TimeCurrent());
   if(left < 0) left = 0;
   long h = left / 3600, m = (left % 3600) / 60, s = left % 60;
   string txt = h > 0 ? StringFormat("%d:%02d:%02d", h, m, s) : StringFormat("%02d:%02d", m, s);
   ObjectSetString(0, "cd_text", OBJPROP_TEXT, "Bar closes in " + txt);
   ChartRedraw();
  }

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[],
                const double &open[], const double &high[], const double &low[], const double &close[],
                const long &tick_volume[], const long &volume[], const int &spread[])
  {
   if(rates_total > 0) g_bar = time[rates_total - 1];
   Show();
   return(rates_total);
  }

void OnTimer() { Show(); }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   ObjectDelete(0, "cd_panel");
   ObjectDelete(0, "cd_text");
  }
`;

export const MQ5_EXAMPLES = [
  { id: 'mq5-example:ma-cross', name: 'MA cross with buttons', source: MA_CROSS },
  { id: 'mq5-example:rsi', name: 'RSI with levels', source: RSI },
  { id: 'mq5-example:bands', name: 'Bollinger fill', source: BANDS },
  { id: 'mq5-example:sessions', name: 'Session boxes', source: SESSIONS },
  { id: 'mq5-example:countdown', name: 'Bar countdown', source: COUNTDOWN },
];
export const MQ5_NEW = `//+------------------------------------------------------------------+
//| My indicator                                                      |
//+------------------------------------------------------------------+
#property indicator_chart_window
#property indicator_buffers 1
#property indicator_plots   1
#property indicator_type1   DRAW_LINE
#property indicator_color1  clrDodgerBlue
#property indicator_width1  2
#property indicator_label1  "SMA"

input int InpPeriod = 20;   // Period

double Line[];

int OnInit()
  {
   SetIndexBuffer(0, Line, INDICATOR_DATA);
   PlotIndexSetInteger(0, PLOT_DRAW_BEGIN, InpPeriod - 1);
   return(INIT_SUCCEEDED);
  }

int OnCalculate(const int rates_total, const int prev_calculated, const int begin, const double &price[])
  {
   if(rates_total < InpPeriod) return(0);
   int start = prev_calculated > 0 ? prev_calculated - 1 : InpPeriod - 1;
   for(int i = start; i < rates_total; i++)
     {
      double sum = 0;
      for(int k = 0; k < InpPeriod; k++) sum += price[i - k];
      Line[i] = sum / InpPeriod;
     }
   return(rates_total);
  }
`;
