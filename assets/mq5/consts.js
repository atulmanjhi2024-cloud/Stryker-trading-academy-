// TradeZoro MQL5 engine: built-in constants, enums and structs. Pure data.
// Values follow the documented MQL5 numbers where scripts are known to use the number itself
// (timeframes, colours, draw types, chart events, init codes); names are what nearly all code uses.

const DBL_MAX = 1.7976931348623158e308;
export const EMPTY_VALUE = DBL_MAX;
export const CLR_NONE = 0xFFFFFFFF;

// ---------- enums (type name -> [[member, value, label]]) ----------
const E = {};
const en = (name, list) => { E[name] = list; };
en('ENUM_TIMEFRAMES', [['PERIOD_CURRENT', 0, 'Current'], ['PERIOD_M1', 1, '1 minute'], ['PERIOD_M2', 2, '2 minutes'], ['PERIOD_M3', 3, '3 minutes'], ['PERIOD_M4', 4, '4 minutes'],
  ['PERIOD_M5', 5, '5 minutes'], ['PERIOD_M6', 6, '6 minutes'], ['PERIOD_M10', 10, '10 minutes'], ['PERIOD_M12', 12, '12 minutes'], ['PERIOD_M15', 15, '15 minutes'], ['PERIOD_M20', 20, '20 minutes'],
  ['PERIOD_M30', 30, '30 minutes'], ['PERIOD_H1', 16385, '1 hour'], ['PERIOD_H2', 16386, '2 hours'], ['PERIOD_H3', 16387, '3 hours'], ['PERIOD_H4', 16388, '4 hours'], ['PERIOD_H6', 16390, '6 hours'],
  ['PERIOD_H8', 16392, '8 hours'], ['PERIOD_H12', 16396, '12 hours'], ['PERIOD_D1', 16408, '1 day'], ['PERIOD_W1', 32769, '1 week'], ['PERIOD_MN1', 49153, '1 month']]);
en('ENUM_MA_METHOD', [['MODE_SMA', 0, 'Simple'], ['MODE_EMA', 1, 'Exponential'], ['MODE_SMMA', 2, 'Smoothed'], ['MODE_LWMA', 3, 'Linear weighted']]);
en('ENUM_APPLIED_PRICE', [['PRICE_CLOSE', 1, 'Close price'], ['PRICE_OPEN', 2, 'Open price'], ['PRICE_HIGH', 3, 'High price'], ['PRICE_LOW', 4, 'Low price'],
  ['PRICE_MEDIAN', 5, 'Median price (HL/2)'], ['PRICE_TYPICAL', 6, 'Typical price (HLC/3)'], ['PRICE_WEIGHTED', 7, 'Weighted close (HLCC/4)']]);
en('ENUM_APPLIED_VOLUME', [['VOLUME_TICK', 0, 'Tick volume'], ['VOLUME_REAL', 1, 'Real volume']]);
en('ENUM_STO_PRICE', [['STO_LOWHIGH', 0, 'Low/High'], ['STO_CLOSECLOSE', 1, 'Close/Close']]);
en('ENUM_DRAW_TYPE', [['DRAW_NONE', 0], ['DRAW_LINE', 1], ['DRAW_SECTION', 2], ['DRAW_HISTOGRAM', 3], ['DRAW_HISTOGRAM2', 4], ['DRAW_ARROW', 5], ['DRAW_ZIGZAG', 6], ['DRAW_FILLING', 7],
  ['DRAW_COLOR_LINE', 8], ['DRAW_COLOR_SECTION', 9], ['DRAW_COLOR_HISTOGRAM', 10], ['DRAW_COLOR_HISTOGRAM2', 11], ['DRAW_COLOR_ARROW', 12], ['DRAW_COLOR_ZIGZAG', 13], ['DRAW_BARS', 14],
  ['DRAW_CANDLES', 15], ['DRAW_COLOR_BARS', 16], ['DRAW_COLOR_CANDLES', 17]]);
en('ENUM_INDEXBUFFER_TYPE', [['INDICATOR_DATA', 0], ['INDICATOR_COLOR_INDEX', 1], ['INDICATOR_CALCULATIONS', 2]]);
en('ENUM_PLOT_PROPERTY_INTEGER', [['PLOT_ARROW', 0], ['PLOT_ARROW_SHIFT', 1], ['PLOT_DRAW_BEGIN', 2], ['PLOT_DRAW_TYPE', 3], ['PLOT_SHOW_DATA', 4], ['PLOT_SHIFT', 5], ['PLOT_LINE_STYLE', 6],
  ['PLOT_LINE_WIDTH', 7], ['PLOT_COLOR_INDEXES', 8], ['PLOT_LINE_COLOR', 9]]);
en('ENUM_PLOT_PROPERTY_DOUBLE', [['PLOT_EMPTY_VALUE', 0]]);
en('ENUM_PLOT_PROPERTY_STRING', [['PLOT_LABEL', 0]]);
en('ENUM_CUSTOMIND_PROPERTY_INTEGER', [['INDICATOR_DIGITS', 0], ['INDICATOR_HEIGHT', 1], ['INDICATOR_LEVELS', 2], ['INDICATOR_LEVELCOLOR', 3], ['INDICATOR_LEVELSTYLE', 4], ['INDICATOR_LEVELWIDTH', 5], ['INDICATOR_FIXED_HEIGHT', 6]]);
en('ENUM_CUSTOMIND_PROPERTY_DOUBLE', [['INDICATOR_MINIMUM', 0], ['INDICATOR_MAXIMUM', 1], ['INDICATOR_LEVELVALUE', 2]]);
en('ENUM_CUSTOMIND_PROPERTY_STRING', [['INDICATOR_SHORTNAME', 0], ['INDICATOR_LEVELTEXT', 1]]);
en('ENUM_LINE_STYLE', [['STYLE_SOLID', 0, 'Solid'], ['STYLE_DASH', 1, 'Dashed'], ['STYLE_DOT', 2, 'Dotted'], ['STYLE_DASHDOT', 3, 'Dash dot'], ['STYLE_DASHDOTDOT', 4, 'Dash dot dot']]);
en('ENUM_OBJECT', [['OBJ_VLINE', 0], ['OBJ_HLINE', 1], ['OBJ_TREND', 2], ['OBJ_TRENDBYANGLE', 3], ['OBJ_CYCLES', 4], ['OBJ_ARROWED_LINE', 108], ['OBJ_CHANNEL', 5], ['OBJ_STDDEVCHANNEL', 6],
  ['OBJ_REGRESSION', 7], ['OBJ_PITCHFORK', 8], ['OBJ_GANNLINE', 9], ['OBJ_GANNFAN', 10], ['OBJ_GANNGRID', 11], ['OBJ_FIBO', 12], ['OBJ_FIBOTIMES', 13], ['OBJ_FIBOFAN', 14], ['OBJ_FIBOARC', 15],
  ['OBJ_FIBOCHANNEL', 16], ['OBJ_EXPANSION', 17], ['OBJ_RECTANGLE', 18], ['OBJ_TRIANGLE', 19], ['OBJ_ELLIPSE', 20], ['OBJ_ARROW_THUMB_UP', 21], ['OBJ_ARROW_THUMB_DOWN', 22],
  ['OBJ_ARROW_UP', 23], ['OBJ_ARROW_DOWN', 24], ['OBJ_ARROW_STOP', 25], ['OBJ_ARROW_CHECK', 26], ['OBJ_ARROW_LEFT_PRICE', 27], ['OBJ_ARROW_RIGHT_PRICE', 28], ['OBJ_ARROW_BUY', 29],
  ['OBJ_ARROW_SELL', 30], ['OBJ_ARROW', 100], ['OBJ_TEXT', 101], ['OBJ_LABEL', 102], ['OBJ_BUTTON', 103], ['OBJ_CHART', 104], ['OBJ_BITMAP', 105], ['OBJ_BITMAP_LABEL', 106], ['OBJ_EDIT', 107],
  ['OBJ_EVENT', 109], ['OBJ_RECTANGLE_LABEL', 110]]);
en('ENUM_OBJECT_PROPERTY_INTEGER', [['OBJPROP_COLOR', 0], ['OBJPROP_STYLE', 1], ['OBJPROP_WIDTH', 2], ['OBJPROP_BACK', 3], ['OBJPROP_ZORDER', 4], ['OBJPROP_FILL', 5], ['OBJPROP_HIDDEN', 6],
  ['OBJPROP_SELECTED', 7], ['OBJPROP_READONLY', 8], ['OBJPROP_TYPE', 9], ['OBJPROP_TIME', 10], ['OBJPROP_SELECTABLE', 11], ['OBJPROP_CREATETIME', 12], ['OBJPROP_LEVELS', 13],
  ['OBJPROP_LEVELCOLOR', 14], ['OBJPROP_LEVELSTYLE', 15], ['OBJPROP_LEVELWIDTH', 16], ['OBJPROP_ALIGN', 17], ['OBJPROP_FONTSIZE', 18], ['OBJPROP_RAY_LEFT', 19], ['OBJPROP_RAY_RIGHT', 20],
  ['OBJPROP_RAY', 21], ['OBJPROP_ELLIPSE', 22], ['OBJPROP_ARROWCODE', 23], ['OBJPROP_TIMEFRAMES', 24], ['OBJPROP_ANCHOR', 25], ['OBJPROP_XDISTANCE', 26], ['OBJPROP_YDISTANCE', 27],
  ['OBJPROP_DIRECTION', 28], ['OBJPROP_DEGREE', 29], ['OBJPROP_DRAWLINES', 30], ['OBJPROP_STATE', 31], ['OBJPROP_CHART_ID', 32], ['OBJPROP_XSIZE', 33], ['OBJPROP_YSIZE', 34],
  ['OBJPROP_XOFFSET', 35], ['OBJPROP_YOFFSET', 36], ['OBJPROP_PERIOD', 37], ['OBJPROP_DATE_SCALE', 38], ['OBJPROP_PRICE_SCALE', 39], ['OBJPROP_CHART_SCALE', 40], ['OBJPROP_BGCOLOR', 41],
  ['OBJPROP_CORNER', 42], ['OBJPROP_BORDER_TYPE', 43], ['OBJPROP_BORDER_COLOR', 44]]);
en('ENUM_OBJECT_PROPERTY_DOUBLE', [['OBJPROP_PRICE', 100], ['OBJPROP_LEVELVALUE', 101], ['OBJPROP_SCALE', 102], ['OBJPROP_ANGLE', 103], ['OBJPROP_DEVIATION', 104]]);
en('ENUM_OBJECT_PROPERTY_STRING', [['OBJPROP_NAME', 200], ['OBJPROP_TEXT', 201], ['OBJPROP_TOOLTIP', 202], ['OBJPROP_LEVELTEXT', 203], ['OBJPROP_FONT', 204], ['OBJPROP_BMPFILE', 205], ['OBJPROP_SYMBOL', 206]]);
en('ENUM_BASE_CORNER', [['CORNER_LEFT_UPPER', 0, 'Top left'], ['CORNER_LEFT_LOWER', 1, 'Bottom left'], ['CORNER_RIGHT_LOWER', 2, 'Bottom right'], ['CORNER_RIGHT_UPPER', 3, 'Top right']]);
en('ENUM_ANCHOR_POINT', [['ANCHOR_LEFT_UPPER', 0], ['ANCHOR_LEFT', 1], ['ANCHOR_LEFT_LOWER', 2], ['ANCHOR_LOWER', 3], ['ANCHOR_RIGHT_LOWER', 4], ['ANCHOR_RIGHT', 5], ['ANCHOR_RIGHT_UPPER', 6], ['ANCHOR_UPPER', 7], ['ANCHOR_CENTER', 8]]);
en('ENUM_ARROW_ANCHOR', [['ANCHOR_TOP', 0], ['ANCHOR_BOTTOM', 1]]);
en('ENUM_BORDER_TYPE', [['BORDER_FLAT', 0], ['BORDER_RAISED', 1], ['BORDER_SUNKEN', 2]]);
en('ENUM_ALIGN_MODE', [['ALIGN_LEFT', 1], ['ALIGN_CENTER', 2], ['ALIGN_RIGHT', 0]]);
en('ENUM_CHART_EVENT', [['CHARTEVENT_KEYDOWN', 0], ['CHARTEVENT_OBJECT_CLICK', 1], ['CHARTEVENT_OBJECT_DRAG', 2], ['CHARTEVENT_OBJECT_ENDEDIT', 3], ['CHARTEVENT_CLICK', 4],
  ['CHARTEVENT_OBJECT_DELETE', 6], ['CHARTEVENT_OBJECT_CREATE', 7], ['CHARTEVENT_OBJECT_CHANGE', 8], ['CHARTEVENT_CHART_CHANGE', 9], ['CHARTEVENT_MOUSE_MOVE', 10], ['CHARTEVENT_MOUSE_WHEEL', 11],
  ['CHARTEVENT_CUSTOM', 1000], ['CHARTEVENT_CUSTOM_LAST', 66534]]);
en('ENUM_CHART_PROPERTY_INTEGER', [['CHART_SHOW', 0], ['CHART_IS_OBJECT', 1], ['CHART_BRING_TO_TOP', 2], ['CHART_CONTEXT_MENU', 3], ['CHART_CROSSHAIR_TOOL', 4], ['CHART_MOUSE_SCROLL', 5],
  ['CHART_EVENT_MOUSE_WHEEL', 6], ['CHART_EVENT_MOUSE_MOVE', 7], ['CHART_EVENT_OBJECT_CREATE', 8], ['CHART_EVENT_OBJECT_DELETE', 9], ['CHART_MODE', 10], ['CHART_FOREGROUND', 11], ['CHART_SHIFT', 12],
  ['CHART_AUTOSCROLL', 13], ['CHART_KEYBOARD_CONTROL', 14], ['CHART_QUICK_NAVIGATION', 15], ['CHART_SCALE', 16], ['CHART_SCALEFIX', 17], ['CHART_SCALEFIX_11', 18], ['CHART_SCALE_PT_PER_BAR', 19],
  ['CHART_SHOW_TICKER', 20], ['CHART_SHOW_OHLC', 21], ['CHART_SHOW_BID_LINE', 22], ['CHART_SHOW_ASK_LINE', 23], ['CHART_SHOW_LAST_LINE', 24], ['CHART_SHOW_PERIOD_SEP', 25], ['CHART_SHOW_GRID', 26],
  ['CHART_SHOW_VOLUMES', 27], ['CHART_SHOW_OBJECT_DESCR', 28], ['CHART_VISIBLE_BARS', 29], ['CHART_WINDOWS_TOTAL', 30], ['CHART_WINDOW_IS_VISIBLE', 31], ['CHART_WINDOW_HANDLE', 32],
  ['CHART_WINDOW_YDISTANCE', 33], ['CHART_FIRST_VISIBLE_BAR', 34], ['CHART_WIDTH_IN_BARS', 35], ['CHART_WIDTH_IN_PIXELS', 36], ['CHART_HEIGHT_IN_PIXELS', 37], ['CHART_COLOR_BACKGROUND', 38],
  ['CHART_COLOR_FOREGROUND', 39], ['CHART_COLOR_GRID', 40], ['CHART_COLOR_VOLUME', 41], ['CHART_COLOR_CHART_UP', 42], ['CHART_COLOR_CHART_DOWN', 43], ['CHART_COLOR_CHART_LINE', 44],
  ['CHART_COLOR_CANDLE_BULL', 45], ['CHART_COLOR_CANDLE_BEAR', 46], ['CHART_COLOR_BID', 47], ['CHART_COLOR_ASK', 48], ['CHART_COLOR_LAST', 49], ['CHART_COLOR_STOP_LEVEL', 50],
  ['CHART_SHOW_TRADE_LEVELS', 51], ['CHART_DRAG_TRADE_LEVELS', 52], ['CHART_SHOW_DATE_SCALE', 53], ['CHART_SHOW_PRICE_SCALE', 54], ['CHART_SHOW_ONE_CLICK', 55], ['CHART_IS_MAXIMIZED', 56],
  ['CHART_IS_MINIMIZED', 57], ['CHART_IS_DOCKED', 58]]);
en('ENUM_CHART_PROPERTY_DOUBLE', [['CHART_SHIFT_SIZE', 0], ['CHART_FIXED_POSITION', 1], ['CHART_FIXED_MAX', 2], ['CHART_FIXED_MIN', 3], ['CHART_POINTS_PER_BAR', 4], ['CHART_PRICE_MIN', 5], ['CHART_PRICE_MAX', 6]]);
en('ENUM_CHART_PROPERTY_STRING', [['CHART_COMMENT', 0], ['CHART_EXPERT_NAME', 1], ['CHART_SCRIPT_NAME', 2]]);
en('ENUM_CHART_MODE', [['CHART_BARS', 0], ['CHART_CANDLES', 1], ['CHART_LINE', 2]]);
en('ENUM_SYMBOL_INFO_INTEGER', [['SYMBOL_DIGITS', 0], ['SYMBOL_SPREAD', 1], ['SYMBOL_SPREAD_FLOAT', 2], ['SYMBOL_TIME', 3], ['SYMBOL_VOLUME', 4], ['SYMBOL_VOLUMEHIGH', 5], ['SYMBOL_VOLUMELOW', 6],
  ['SYMBOL_SELECT', 7], ['SYMBOL_VISIBLE', 8], ['SYMBOL_TRADE_MODE', 9], ['SYMBOL_TRADE_CALC_MODE', 10], ['SYMBOL_EXIST', 11], ['SYMBOL_CUSTOM', 12], ['SYMBOL_TICKS_BOOKDEPTH', 13], ['SYMBOL_TIME_MSC', 14]]);
en('ENUM_SYMBOL_INFO_DOUBLE', [['SYMBOL_BID', 0], ['SYMBOL_BIDHIGH', 1], ['SYMBOL_BIDLOW', 2], ['SYMBOL_ASK', 3], ['SYMBOL_ASKHIGH', 4], ['SYMBOL_ASKLOW', 5], ['SYMBOL_LAST', 6], ['SYMBOL_LASTHIGH', 7],
  ['SYMBOL_LASTLOW', 8], ['SYMBOL_POINT', 9], ['SYMBOL_TRADE_TICK_VALUE', 10], ['SYMBOL_TRADE_TICK_SIZE', 11], ['SYMBOL_TRADE_CONTRACT_SIZE', 12], ['SYMBOL_VOLUME_MIN', 13], ['SYMBOL_VOLUME_MAX', 14],
  ['SYMBOL_VOLUME_STEP', 15], ['SYMBOL_SESSION_OPEN', 16], ['SYMBOL_SESSION_CLOSE', 17], ['SYMBOL_VOLUME_REAL', 18]]);
en('ENUM_SYMBOL_INFO_STRING', [['SYMBOL_BASIS', 0], ['SYMBOL_CURRENCY_BASE', 1], ['SYMBOL_CURRENCY_PROFIT', 2], ['SYMBOL_CURRENCY_MARGIN', 3], ['SYMBOL_DESCRIPTION', 4], ['SYMBOL_PATH', 5],
  ['SYMBOL_EXCHANGE', 6], ['SYMBOL_ISIN', 7], ['SYMBOL_NAME', 8]]);
en('ENUM_SERIES_INFO_INTEGER', [['SERIES_BARS_COUNT', 0], ['SERIES_FIRSTDATE', 1], ['SERIES_SERVER_FIRSTDATE', 2], ['SERIES_TERMINAL_FIRSTDATE', 3], ['SERIES_SYNCHRONIZED', 4], ['SERIES_LASTBAR_DATE', 5]]);
en('ENUM_MQL_INFO_INTEGER', [['MQL_PROGRAM_TYPE', 0], ['MQL_DLLS_ALLOWED', 1], ['MQL_TRADE_ALLOWED', 2], ['MQL_SIGNALS_ALLOWED', 3], ['MQL_DEBUG', 4], ['MQL_PROFILER', 5], ['MQL_TESTER', 6],
  ['MQL_OPTIMIZATION', 7], ['MQL_VISUAL_MODE', 8], ['MQL_FRAME_MODE', 9], ['MQL_LICENSE_TYPE', 10], ['MQL_MEMORY_LIMIT', 11], ['MQL_MEMORY_USED', 12]]);
en('ENUM_MQL_INFO_STRING', [['MQL_PROGRAM_NAME', 0], ['MQL_PROGRAM_PATH', 1]]);
en('ENUM_PROGRAM_TYPE', [['PROGRAM_SCRIPT', 1], ['PROGRAM_EXPERT', 2], ['PROGRAM_INDICATOR', 3], ['PROGRAM_SERVICE', 4]]);
en('ENUM_TERMINAL_INFO_INTEGER', [['TERMINAL_BUILD', 0], ['TERMINAL_COMMUNITY_ACCOUNT', 1], ['TERMINAL_CONNECTED', 2], ['TERMINAL_DLLS_ALLOWED', 3], ['TERMINAL_TRADE_ALLOWED', 4],
  ['TERMINAL_MAXBARS', 5], ['TERMINAL_CODEPAGE', 6], ['TERMINAL_CPU_CORES', 7], ['TERMINAL_MEMORY_PHYSICAL', 8], ['TERMINAL_MEMORY_TOTAL', 9], ['TERMINAL_MEMORY_AVAILABLE', 10],
  ['TERMINAL_MEMORY_USED', 11], ['TERMINAL_SCREEN_DPI', 12], ['TERMINAL_PING_LAST', 13], ['TERMINAL_KEYSTATE_SHIFT', 14], ['TERMINAL_KEYSTATE_CONTROL', 15], ['TERMINAL_SCREEN_WIDTH', 16], ['TERMINAL_SCREEN_HEIGHT', 17]]);
en('ENUM_TERMINAL_INFO_STRING', [['TERMINAL_LANGUAGE', 0], ['TERMINAL_COMPANY', 1], ['TERMINAL_NAME', 2], ['TERMINAL_PATH', 3], ['TERMINAL_DATA_PATH', 4], ['TERMINAL_COMMONDATA_PATH', 5]]);
en('ENUM_TERMINAL_INFO_DOUBLE', [['TERMINAL_COMMUNITY_BALANCE', 0], ['TERMINAL_RETRANSMISSION', 1]]);
en('ENUM_DAY_OF_WEEK', [['SUNDAY', 0, 'Sunday'], ['MONDAY', 1, 'Monday'], ['TUESDAY', 2, 'Tuesday'], ['WEDNESDAY', 3, 'Wednesday'], ['THURSDAY', 4, 'Thursday'], ['FRIDAY', 5, 'Friday'], ['SATURDAY', 6, 'Saturday']]);
en('ENUM_INIT_RETCODE', [['INIT_SUCCEEDED', 0], ['INIT_FAILED', 1], ['INIT_PARAMETERS_INCORRECT', 32767], ['INIT_AGENT_NOT_SUITABLE', 32768]]);
en('ENUM_SIGNAL_LINE', [['MAIN_LINE', 0], ['SIGNAL_LINE', 1]]);
en('ENUM_SORT_MODE', [['MODE_ASCEND', 0], ['MODE_DESCEND', 1]]);
en('ENUM_POINTER_TYPE', [['POINTER_INVALID', 0], ['POINTER_DYNAMIC', 1], ['POINTER_AUTOMATIC', 2]]);
en('ENUM_INDICATOR', [['IND_AC', 0], ['IND_AD', 1], ['IND_ADX', 2], ['IND_ADXW', 3], ['IND_ALLIGATOR', 4], ['IND_AMA', 5], ['IND_AO', 6], ['IND_ATR', 7], ['IND_BANDS', 8], ['IND_BEARS', 9],
  ['IND_BULLS', 10], ['IND_BWMFI', 11], ['IND_CCI', 12], ['IND_CHAIKIN', 13], ['IND_CUSTOM', 14], ['IND_DEMA', 15], ['IND_DEMARKER', 16], ['IND_ENVELOPES', 17], ['IND_FORCE', 18],
  ['IND_FRACTALS', 19], ['IND_FRAMA', 20], ['IND_GATOR', 21], ['IND_ICHIMOKU', 22], ['IND_MA', 23], ['IND_MACD', 24], ['IND_MFI', 25], ['IND_MOMENTUM', 26], ['IND_OBV', 27], ['IND_OSMA', 28],
  ['IND_RSI', 29], ['IND_RVI', 30], ['IND_SAR', 31], ['IND_STDDEV', 32], ['IND_STOCHASTIC', 33], ['IND_TEMA', 34], ['IND_TRIX', 35], ['IND_VIDYA', 36], ['IND_VOLUMES', 37], ['IND_WPR', 38]]);
en('ENUM_DEINIT_REASON', [['REASON_PROGRAM', 0], ['REASON_REMOVE', 1], ['REASON_RECOMPILE', 2], ['REASON_CHARTCHANGE', 3], ['REASON_CHARTCLOSE', 4], ['REASON_PARAMETERS', 5], ['REASON_ACCOUNT', 6],
  ['REASON_TEMPLATE', 7], ['REASON_INITFAILED', 8], ['REASON_CLOSE', 9]]);
en('ENUM_DATATYPE', [['TYPE_BOOL', 1], ['TYPE_CHAR', 2], ['TYPE_UCHAR', 3], ['TYPE_SHORT', 4], ['TYPE_USHORT', 5], ['TYPE_COLOR', 6], ['TYPE_INT', 7], ['TYPE_UINT', 8], ['TYPE_DATETIME', 9],
  ['TYPE_LONG', 10], ['TYPE_ULONG', 11], ['TYPE_FLOAT', 12], ['TYPE_DOUBLE', 13], ['TYPE_STRING', 14]]);
en('ENUM_SERIESMODE', [['MODE_OPEN', 0], ['MODE_LOW', 1], ['MODE_HIGH', 2], ['MODE_CLOSE', 3], ['MODE_VOLUME', 4], ['MODE_REAL_VOLUME', 5], ['MODE_SPREAD', 6]]);
export const ENUMS = E;

// ---------- plain constants ----------
const C = {
  EMPTY_VALUE: ['double', EMPTY_VALUE], EMPTY: ['int', -1], INVALID_HANDLE: ['int', -1], WHOLE_ARRAY: ['int', -1], WRONG_VALUE: ['int', -1], NULL: ['int', 0], CHARTS_MAX: ['int', 100],
  CLR_NONE: ['color', CLR_NONE], clrNONE: ['color', CLR_NONE], CLR_DEFAULT: ['color', 0xFF000000],
  DBL_MAX: ['double', DBL_MAX], DBL_MIN: ['double', 2.2250738585072014e-308], DBL_EPSILON: ['double', 2.220446049250313e-16], DBL_DIG: ['int', 15], DBL_MANT_DIG: ['int', 53],
  FLT_MAX: ['double', 3.402823466e38], FLT_MIN: ['double', 1.175494351e-38], FLT_EPSILON: ['double', 1.192092896e-7], FLT_DIG: ['int', 6],
  CHAR_MIN: ['int', -128], CHAR_MAX: ['int', 127], UCHAR_MAX: ['int', 255], SHORT_MIN: ['int', -32768], SHORT_MAX: ['int', 32767], USHORT_MAX: ['int', 65535],
  INT_MIN: ['int', -2147483648], INT_MAX: ['int', 2147483647], UINT_MAX: ['uint', 4294967295], LONG_MIN: ['long', -9223372036854775808], LONG_MAX: ['long', 9223372036854775807], ULONG_MAX: ['ulong', 18446744073709551615],
  M_E: ['double', Math.E], M_LOG2E: ['double', Math.LOG2E], M_LOG10E: ['double', Math.LOG10E], M_LN2: ['double', Math.LN2], M_LN10: ['double', Math.LN10], M_PI: ['double', Math.PI],
  M_PI_2: ['double', Math.PI / 2], M_PI_4: ['double', Math.PI / 4], M_1_PI: ['double', 1 / Math.PI], M_2_PI: ['double', 2 / Math.PI], M_2_SQRTPI: ['double', 2 / Math.sqrt(Math.PI)],
  M_SQRT2: ['double', Math.SQRT2], M_SQRT1_2: ['double', Math.SQRT1_2],
  MODE_MAIN: ['int', 0], MODE_SIGNAL: ['int', 1], MODE_PLUSDI: ['int', 1], MODE_MINUSDI: ['int', 2], MODE_UPPER: ['int', 1], MODE_LOWER: ['int', 2],
  BASE_LINE: ['int', 0], UPPER_BAND: ['int', 1], LOWER_BAND: ['int', 2], PLUSDI_LINE: ['int', 1], MINUSDI_LINE: ['int', 2], UPPER_LINE: ['int', 0], LOWER_LINE: ['int', 1],
  GATORJAW_LINE: ['int', 0], GATORTEETH_LINE: ['int', 1], GATORLIPS_LINE: ['int', 2], TENKANSEN_LINE: ['int', 0], KIJUNSEN_LINE: ['int', 1], SENKOUSPANA_LINE: ['int', 2],
  SENKOUSPANB_LINE: ['int', 3], CHIKOUSPAN_LINE: ['int', 4], UPPER_HISTOGRAM: ['int', 0], LOWER_HISTOGRAM: ['int', 2],
  TIME_DATE: ['int', 1], TIME_MINUTES: ['int', 2], TIME_SECONDS: ['int', 4],
  OBJ_ALL_PERIODS: ['int', 0x1FFFFF], OBJ_NO_PERIODS: ['int', -1], OBJ_PERIOD_M1: ['int', 1], OBJ_PERIOD_M5: ['int', 0x10], OBJ_PERIOD_M15: ['int', 0x40], OBJ_PERIOD_H1: ['int', 0x400], OBJ_PERIOD_D1: ['int', 0x8000],
  ERR_SUCCESS: ['int', 0], ERR_INTERNAL_ERROR: ['int', 4001], ERR_WRONG_INTERNAL_PARAMETER: ['int', 4002], ERR_INVALID_PARAMETER: ['int', 4003], ERR_NOT_ENOUGH_MEMORY: ['int', 4004],
  ERR_ARRAY_RESIZE_ERROR: ['int', 4007], ERR_CHART_WRONG_ID: ['int', 4101], ERR_OBJECT_NOT_FOUND: ['int', 4202], ERR_OBJECT_WRONG_PROPERTY: ['int', 4203], ERR_INDICATOR_UNKNOWN_SYMBOL: ['int', 4801],
  ERR_INDICATOR_CANNOT_CREATE: ['int', 4802], ERR_INDICATOR_WRONG_HANDLE: ['int', 4807], ERR_INDICATOR_DATA_NOT_FOUND: ['int', 4806], ERR_USER_ERROR_FIRST: ['int', 65536],
  ERR_HISTORY_NOT_FOUND: ['int', 4401], ERR_MARKET_UNKNOWN_SYMBOL: ['int', 4301], ERR_NOT_ENOUGH_DATA: ['int', 4806],
  ERR_ZEROSIZE_ARRAY: ['int', 4011], ERR_INVALID_ARRAY: ['int', 4012], ERR_SMALL_ARRAY: ['int', 4006], ERR_STRING_RESIZE_ERROR: ['int', 4015], ERR_WRONG_STRING_PARAMETER: ['int', 4019],
  MB_OK: ['int', 0], MB_OKCANCEL: ['int', 1], IDOK: ['int', 1], IDCANCEL: ['int', 2],
  CHART_IS_OBJECT_FALSE: ['int', 0], ANCHOR_LEFT_UPPER_DEF: ['int', 0],
  TERMINAL_X64: ['int', 1],
};
// keys of CHARTEVENT keydown are plain JS key codes; give the usual names for the ones scripts test against
const KEYS = { VK_LEFT: 37, VK_UP: 38, VK_RIGHT: 39, VK_DOWN: 40, VK_RETURN: 13, VK_ESCAPE: 27, VK_SPACE: 32, VK_TAB: 9, VK_BACK: 8, VK_DELETE: 46, VK_HOME: 36, VK_END: 35, VK_PRIOR: 33, VK_NEXT: 34, VK_SHIFT: 16, VK_CONTROL: 17 };
for (const k of Object.keys(KEYS)) C[k] = ['int', KEYS[k]];
delete C.CHART_IS_OBJECT_FALSE; delete C.ANCHOR_LEFT_UPPER_DEF;

// ---------- web colours (clrX). MQL colour = 0x00BBGGRR ----------
const WEB = 'Black 000000 DarkGreen 006400 DarkSlateGray 2F4F4F Olive 808000 Green 008000 Teal 008080 Navy 000080 Purple 800080 Maroon 800000 Indigo 4B0082 MidnightBlue 191970 DarkBlue 00008B ' +
  'DarkOliveGreen 556B2F SaddleBrown 8B4513 ForestGreen 228B22 OliveDrab 6B8E23 SeaGreen 2E8B57 DarkGoldenrod B8860B DarkSlateBlue 483D8B Sienna A0522D MediumBlue 0000CD Brown A52A2A ' +
  'DarkTurquoise 00CED1 DimGray 696969 LightSeaGreen 20B2AA DarkViolet 9400D3 FireBrick B22222 MediumVioletRed C71585 MediumSeaGreen 3CB371 Chocolate D2691E Crimson DC143C SteelBlue 4682B4 ' +
  'Goldenrod DAA520 MediumSpringGreen 00FA9A LawnGreen 7CFC00 CadetBlue 5F9EA0 DarkOrchid 9932CC YellowGreen 9ACD32 LimeGreen 32CD32 OrangeRed FF4500 DarkOrange FF8C00 Orange FFA500 ' +
  'Gold FFD700 Yellow FFFF00 Chartreuse 7FFF00 Lime 00FF00 SpringGreen 00FF7F Aqua 00FFFF DeepSkyBlue 00BFFF Blue 0000FF Magenta FF00FF Red FF0000 Gray 808080 SlateGray 708090 Peru CD853F ' +
  'BlueViolet 8A2BE2 LightSlateGray 778899 DeepPink FF1493 MediumTurquoise 48D1CC DodgerBlue 1E90FF Turquoise 40E0D0 RoyalBlue 4169E1 SlateBlue 6A5ACD DarkKhaki BDB76B IndianRed CD5C5C ' +
  'MediumOrchid BA55D3 GreenYellow ADFF2F MediumAquamarine 66CDAA DarkSeaGreen 8FBC8F Tomato FF6347 RosyBrown BC8F8F Orchid DA70D6 MediumPurple 9370DB PaleVioletRed DB7093 Coral FF7F50 ' +
  'CornflowerBlue 6495ED DarkGray A9A9A9 SandyBrown F4A460 MediumSlateBlue 7B68EE Tan D2B48C DarkSalmon E9967A BurlyWood DEB887 HotPink FF69B4 Salmon FA8072 Violet EE82EE LightCoral F08080 ' +
  'SkyBlue 87CEEB LightSalmon FFA07A Plum DDA0DD Khaki F0E68C LightGreen 90EE90 Aquamarine 7FFFD4 Silver C0C0C0 LightSkyBlue 87CEFA LightSteelBlue B0C4DE LightBlue ADD8E6 PaleGreen 98FB98 ' +
  'Thistle D8BFD8 PowderBlue B0E0E6 PaleGoldenrod EEE8AA PaleTurquoise AFEEEE LightGray D3D3D3 Wheat F5DEB3 NavajoWhite FFDEAD Moccasin FFE4B5 LightPink FFB6C1 Gainsboro DCDCDC PeachPuff FFDAB9 ' +
  'Pink FFC0CB Bisque FFE4C4 LightGoldenrod FAFAD2 BlanchedAlmond FFEBCD LemonChiffon FFFACD Beige F5F5DC AntiqueWhite FAEBD7 PapayaWhip FFEFD5 Cornsilk FFF8DC LightYellow FFFFE0 LightCyan E0FFFF ' +
  'Linen FAF0E6 Lavender E6E6FA MistyRose FFE4E1 OldLace FDF5E6 WhiteSmoke F5F5F5 Seashell FFF5EE Ivory FFFFF0 Honeydew F0FFF0 AliceBlue F0F8FF LavenderBlush FFF0F5 MintCream F5FFFA Snow FFFAFA White FFFFFF';
export const COLOR_NAMES = new Map();   // MQL colour value -> 'clrName'
{
  const w = WEB.split(' ');
  for (let i = 0; i + 1 < w.length; i += 2) {
    const h = parseInt(w[i + 1], 16), r = h >> 16, g = (h >> 8) & 255, b = h & 255, v = r | (g << 8) | (b << 16);
    C['clr' + w[i]] = ['color', v];
    if (!COLOR_NAMES.has(v)) COLOR_NAMES.set(v, 'clr' + w[i]);
  }
}
for (const name of Object.keys(E)) for (const [m, v] of E[name]) C[m] = [name, v];
export const CONSTS = C;

// ---------- built-in structs: name -> [[field, type]] ----------
export const STRUCTS = {
  MqlRates: [['time', 'datetime'], ['open', 'double'], ['high', 'double'], ['low', 'double'], ['close', 'double'], ['tick_volume', 'long'], ['spread', 'int'], ['real_volume', 'long']],
  MqlDateTime: [['year', 'int'], ['mon', 'int'], ['day', 'int'], ['hour', 'int'], ['min', 'int'], ['sec', 'int'], ['day_of_week', 'int'], ['day_of_year', 'int']],
  MqlTick: [['time', 'datetime'], ['bid', 'double'], ['ask', 'double'], ['last', 'double'], ['volume', 'ulong'], ['time_msc', 'long'], ['flags', 'uint'], ['volume_real', 'double']],
  MqlParam: [['type', 'ENUM_DATATYPE'], ['integer_value', 'long'], ['double_value', 'double'], ['string_value', 'string']],
};

// Things an indicator may not do: one clear line each (checked at compile time, by name).
export const UNSUPPORTED = (() => {
  const m = new Map();
  const add = (names, why) => names.split(' ').forEach((n) => m.set(n, why));
  add('OrderSend OrderSendAsync OrderCheck OrderCalcMargin OrderCalcProfit OrderGetTicket OrderSelect OrdersTotal OrderGetDouble OrderGetInteger OrderGetString ' +
    'PositionsTotal PositionGetSymbol PositionSelect PositionSelectByTicket PositionGetTicket PositionGetDouble PositionGetInteger PositionGetString ' +
    'HistorySelect HistorySelectByPosition HistoryOrderSelect HistoryOrdersTotal HistoryOrderGetTicket HistoryOrderGetDouble HistoryOrderGetInteger HistoryOrderGetString ' +
    'HistoryDealSelect HistoryDealsTotal HistoryDealGetTicket HistoryDealGetDouble HistoryDealGetInteger HistoryDealGetString ' +
    'AccountInfoDouble AccountInfoInteger AccountInfoString OrderClose OrderModify OrderDelete', 'trading');
  add('MqlTradeRequest MqlTradeResult MqlTradeCheckResult MqlTradeTransaction', 'tradetype');
  add('FileOpen FileClose FileWrite FileWriteString FileWriteArray FileWriteDouble FileWriteInteger FileWriteStruct FileRead FileReadString FileReadArray FileReadDouble FileReadInteger ' +
    'FileReadNumber FileReadStruct FileDelete FileCopy FileMove FileIsExist FileFindFirst FileFindNext FileFindClose FileSize FileSeek FileTell FileFlush FileIsEnding FileIsLineEnding ' +
    'FolderCreate FolderDelete FolderClean FileLoad FileSave FileGetInteger FileSelectDialog', 'files');
  add('WebRequest SocketCreate SocketConnect SocketSend SocketRead SocketClose SocketIsConnected SocketTlsHandshake SendMail SendFTP SendNotification', 'network');
  add('ExpertRemove TerminalClose ChartApplyTemplate ChartSaveTemplate ChartOpen ChartClose ChartScreenShot ChartIndicatorAdd ChartIndicatorDelete ' +
    'MarketBookAdd MarketBookRelease MarketBookGet CustomSymbolCreate CustomRatesUpdate CustomTicksAdd ResourceCreate ResourceSave ResourceReadImage MessageBox CryptEncode CryptDecode ' +
    'TesterStatistics TesterWithdrawal FrameAdd FrameFirst FrameNext ParameterGetRange ParameterSetRange', 'terminal');
  add('OnTick OnTrade OnTradeTransaction OnBookEvent OnTester OnTesterInit OnTesterPass OnTesterDeinit OnStart', 'event');
  add('CTrade CPositionInfo COrderInfo CDealInfo CHistoryOrderInfo CAccountInfo CSymbolInfo CExpert CArrayDouble CArrayInt CArrayString CArrayObj CObject CChartObject CChartObjectButton ' +
    'CChartObjectLabel CChartObjectEdit CCanvas CFile CFileTxt CFileBin CiMA CiRSI CIndicators CAppDialog CButton CLabel CEdit CPanel CDialog', 'class');
  return m;
})();
export const UNSUPPORTED_WHY = {
  trading: 'Indicators on TradeZoro never place or read orders or positions.',
  tradetype: 'Indicators on TradeZoro never place or read orders or positions.',
  files: 'Scripts on TradeZoro have no access to files.',
  network: 'Scripts on TradeZoro cannot reach the network.',
  terminal: 'This terminal command has no meaning on a TradeZoro chart.',
  event: 'This is an Expert Advisor or script event; TradeZoro runs indicators (OnInit, OnCalculate, OnTimer, OnChartEvent, OnDeinit).',
  class: 'Classes from the standard library are not supported yet. Use plain arrays, functions and chart objects instead.',
};
