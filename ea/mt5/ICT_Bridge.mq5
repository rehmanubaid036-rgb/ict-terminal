//+------------------------------------------------------------------+
//|                                                   ICT_Bridge.mq5 |
//|  ICT Terminal Bridge EA: trades the ICT engine's approved signals |
//|                                                                   |
//|  Setup                                                            |
//|   1. Tools > Options > Expert Advisors: tick "Allow WebRequest"   |
//|      and add the server URL below.                                |
//|   2. Paste your EA token (ICT Terminal > Auto-trading).           |
//|   3. Attach to ANY one chart; it trades every approved symbol.    |
//|                                                                   |
//|  Each signal opens up to 3 legs (one per target, e.g. 50/25/25)   |
//|  with the same stop. After TP1 the other legs move to breakeven.  |
//|  Pending orders are cancelled at the signal's expiry; if TP1 was  |
//|  not reached by its time stop everything is closed; any remainder |
//|  is closed at its exit time. Risk per signal = InpRiskPercent.    |
//+------------------------------------------------------------------+
#property copyright "ICT Terminal"
#property version   "1.00"
#property strict

#include <Trade/Trade.mqh>
#include "ICT_Json.mqh"

#define EA_VERSION "1.00"
#define TAG        "ICT#"
#define MAX_LEGS   3

input string InpServerURL       = "https://ictapi.iccterminal.trade"; // ICT Terminal server URL
input string InpEaToken         = "";      // Your EA token (starts with ea_)
input double InpRiskPercent     = 0.5;     // Risk per signal, % of balance
input double InpMaxDailyLossPct = 3.0;     // Stop opening trades after losing this % today
input int    InpMaxOpenSignals  = 2;       // Signals open at the same time (all symbols)
input double InpMaxLot          = 5.0;     // Never more than this lot in total per signal
input bool   InpAllowMinLot     = false;   // If the risk lot is below the broker minimum, trade the minimum anyway
input string InpSymbolSuffix    = "";      // Your broker's symbol suffix, e.g. ".pro" (empty = auto)
input string InpSymbolMap       = "";      // Different names, e.g. NAS100=USTEC;US500=SPX500 (empty = auto)
input int    InpPollSeconds     = 5;       // How often to ask the server (seconds)
input int    InpSlippagePoints  = 30;      // Max slippage for market entries (points)
input long   InpMagic           = 7740001; // Magic number of this EA's trades

struct SignalState
{
   long     id;
   string   symbol;
   int      dir;
   double   entry;
   datetime expiry, timeStop, exitBy;   // UTC
   bool     tp1Done;
   bool     done;
   ulong    legTicket[MAX_LEGS];        // open position per leg (0 = none)
   bool     legClosed[MAX_LEGS];
};

CTrade      trade;
SignalState g_states[];
string      g_events[];                 // JSON event objects waiting to be reported
string      g_status = "Starting...", g_reason = "";
bool        g_active = false;
int         g_feedCount = 0;
datetime    g_lastOk = 0;

//+------------------------------------------------------------------+
int OnInit()
{
   if(StringLen(InpEaToken) < 10)
   {
      Alert("ICT Bridge: paste your EA token (ICT Terminal > Auto-trading).");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(InpRiskPercent <= 0 || InpRiskPercent > 5)
   {
      Alert("ICT Bridge: risk per signal must be between 0 and 5 %.");
      return INIT_PARAMETERS_INCORRECT;
   }
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpSlippagePoints);
   LoadStates();
   EventSetTimer(MathMax(2, InpPollSeconds));
   OnTimer();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   SaveStates();
   Comment("");
}

void OnTimer()
{
   Poll();
   Manage();
   FlushReports();
   ShowStatus();
}

//+------------------------------------------------------------------+
//| Server: check in and receive the signals we may trade             |
//+------------------------------------------------------------------+
void Poll()
{
   string body = StringFormat("{\"ea_token\":\"%s\",\"mt5_login\":\"%I64d\",\"mt5_server\":\"%s\",\"balance\":%.2f,"
                              "\"currency\":\"%s\",\"ea_version\":\"%s\",\"open_copies\":%d}",
                              JsonEscape(InpEaToken), AccountInfoInteger(ACCOUNT_LOGIN),
                              JsonEscape(AccountInfoString(ACCOUNT_SERVER)), AccountInfoDouble(ACCOUNT_BALANCE),
                              AccountInfoString(ACCOUNT_CURRENCY), EA_VERSION, OpenSignalCount());
   string resp; int code;
   if(!HttpPost(InpServerURL + "/api/v1/ea/feed", body, resp, code))
      return;                                    // offline: existing trades keep their SL / TP at the broker
   if(code == 401)
   {
      g_active = false;
      g_status = "Token rejected";
      g_reason = JsonString(resp, "reason");
      return;
   }
   if(code != 200)
   {
      g_status = "Server error " + (string)code;
      return;
   }
   g_lastOk = TimeCurrent();
   g_active = JsonBool(resp, "active");
   g_reason = JsonString(resp, "reason");
   g_status = g_active ? "Auto-trading" : "Connected (not trading)";
   if(!g_active)
      return;

   string objs[];
   g_feedCount = JsonObjects(JsonArrayText(resp, "signals"), objs);
   for(int i = 0; i < g_feedCount; i++)
   {
      long id = (long)JsonNumber(objs[i], "id", 0);
      if(id <= 0 || FindState(id) >= 0)
         continue;                               // already handled (placed, skipped or finished)
      if(DailyLossHit())
      {
         g_status = "Daily loss limit reached";
         return;
      }
      if(OpenSignalCount() >= InpMaxOpenSignals)
         return;
      Place(objs[i], id);
   }
}

//+------------------------------------------------------------------+
//| Open the legs of one signal                                       |
//+------------------------------------------------------------------+
void Place(const string obj, long id)
{
   SignalState st;
   ZeroMemory(st);
   st.id       = id;
   st.dir      = (int)JsonNumber(obj, "direction", 0);
   st.entry    = JsonNumber(obj, "entry", 0);
   st.expiry   = IsoToUtc(JsonString(obj, "expiry"));
   st.timeStop = IsoToUtc(JsonString(obj, "time_stop"));
   st.exitBy   = IsoToUtc(JsonString(obj, "exit_by"));
   double stop = JsonNumber(obj, "stop", 0);
   string engineSymbol = JsonString(obj, "symbol");
   st.symbol   = ResolveSymbol(engineSymbol);

   double tp[], fr[];
   int nt = JsonTargets(obj, tp, fr);
   if(st.symbol == "" || (st.dir != 1 && st.dir != -1) || st.entry <= 0 || stop <= 0 || nt == 0
      || st.dir * (st.entry - stop) <= 0)
   {
      st.done = true;
      AddState(st);
      Event(id, "error", 0, 0, 0, "invalid signal or symbol " + engineSymbol + " not found");
      return;
   }
   if(st.expiry > 0 && TimeGMT() >= st.expiry)
   {
      st.done = true;
      AddState(st);
      Event(id, "cancelled", 0, 0, 0, "expired before it could be placed");
      return;
   }

   int digits  = (int)SymbolInfoInteger(st.symbol, SYMBOL_DIGITS);
   double total = RiskLot(st.symbol, st.entry, stop);
   double minLot = SymbolInfoDouble(st.symbol, SYMBOL_VOLUME_MIN);
   if(total < minLot)
   {
      if(!InpAllowMinLot)
      {
         st.done = true;
         AddState(st);
         Event(id, "error", 0, total, 0, "risk lot below the broker minimum; raise risk or enable InpAllowMinLot");
         return;
      }
      total = minLot;
   }

   // split the lot over the targets; legs below the minimum lot are merged into the first leg
   double legs[];
   ArrayResize(legs, MathMin(nt, MAX_LEGS));
   double step = SymbolInfoDouble(st.symbol, SYMBOL_VOLUME_STEP);
   if(step <= 0) step = 0.01;
   double used = 0;
   for(int k = ArraySize(legs) - 1; k >= 1; k--)
   {
      legs[k] = MathFloor(total * fr[k] / step + 1e-9) * step;
      if(legs[k] < minLot) legs[k] = 0;
      used += legs[k];
   }
   legs[0] = MathFloor((total - used) / step + 1e-9) * step;

   double ask = SymbolInfoDouble(st.symbol, SYMBOL_ASK), bid = SymbolInfoDouble(st.symbol, SYMBOL_BID);
   bool market = (st.dir == 1 && ask <= st.entry && ask > stop) || (st.dir == -1 && bid >= st.entry && bid < stop);
   trade.SetTypeFillingBySymbol(st.symbol);
   int placed = 0;
   for(int k = 0; k < ArraySize(legs); k++)
   {
      if(legs[k] < minLot) continue;
      double lot = NormalizeDouble(legs[k], 2);
      double sl  = NormalizeDouble(stop, digits);
      double t   = NormalizeDouble(tp[k], digits);
      string comment = TAG + (string)id + "#" + (string)k;
      bool ok;
      if(market)
         ok = st.dir == 1 ? trade.Buy(lot, st.symbol, 0, sl, t, comment) : trade.Sell(lot, st.symbol, 0, sl, t, comment);
      else
         ok = st.dir == 1 ? trade.BuyLimit(lot, NormalizeDouble(st.entry, digits), st.symbol, sl, t, ORDER_TIME_GTC, 0, comment)
                          : trade.SellLimit(lot, NormalizeDouble(st.entry, digits), st.symbol, sl, t, ORDER_TIME_GTC, 0, comment);
      if(ok)
         placed++;
      else
         Event(id, "error", st.entry, lot, 0, "leg " + (string)k + ": " + trade.ResultRetcodeDescription());
   }
   st.done = placed == 0;
   AddState(st);
   if(placed > 0)
      Event(id, market ? "filled" : "placed", st.entry, total, 0, StringFormat("%d legs %s", placed, st.symbol));
}

//+------------------------------------------------------------------+
//| Breakeven, expiry, time stop and exit time for open signals       |
//+------------------------------------------------------------------+
void Manage()
{
   datetime now = TimeGMT();
   bool changed = false;
   for(int i = 0; i < ArraySize(g_states); i++)
   {
      if(g_states[i].done) continue;
      long id = g_states[i].id;

      // positions per leg
      bool open[MAX_LEGS];
      ArrayInitialize(open, false);
      for(int p = PositionsTotal() - 1; p >= 0; p--)
      {
         ulong t = PositionGetTicket(p);
         if(t == 0 || PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
         int leg = LegOf(PositionGetString(POSITION_COMMENT), id);
         if(leg < 0) continue;
         open[leg] = true;
         if(g_states[i].legTicket[leg] != t)
         {
            g_states[i].legTicket[leg] = t;
            changed = true;
         }
      }
      // legs that were open and are gone: find out how they closed
      for(int k = 0; k < MAX_LEGS; k++)
      {
         if(g_states[i].legTicket[k] == 0 || open[k] || g_states[i].legClosed[k]) continue;
         string why; double price, profit;
         ClosedHow(g_states[i].legTicket[k], why, price, profit);
         Event(id, why, price, 0, profit, "leg " + (string)k);
         g_states[i].legClosed[k] = true;
         changed = true;
         if(k == 0 && why == "tp")
         {
            g_states[i].tp1Done = true;
            MoveToBreakeven(i);
         }
      }

      int pending = PendingCount(id);
      bool anyOpen = open[0] || open[1] || open[2];
      if(pending > 0 && g_states[i].expiry > 0 && now >= g_states[i].expiry)
      {
         DeletePending(id);
         Event(id, "cancelled", 0, 0, 0, "entry not filled before expiry");
         pending = 0;
         changed = true;
      }
      if(anyOpen && !g_states[i].tp1Done && g_states[i].timeStop > 0 && now >= g_states[i].timeStop)
      {
         CloseAll(id, "time_stop");
         changed = true;
      }
      else if(anyOpen && g_states[i].exitBy > 0 && now >= g_states[i].exitBy)
      {
         CloseAll(id, "exit_by");
         changed = true;
      }
      if(pending == 0 && !anyOpen && !(g_states[i].legTicket[0] == 0 && g_states[i].expiry > 0 && now < g_states[i].expiry))
      {
         g_states[i].done = true;
         changed = true;
      }
   }
   if(changed)
      SaveStates();
}

void MoveToBreakeven(int i)
{
   for(int p = PositionsTotal() - 1; p >= 0; p--)
   {
      ulong t = PositionGetTicket(p);
      if(t == 0 || PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      if(LegOf(PositionGetString(POSITION_COMMENT), g_states[i].id) < 0) continue;
      double open = PositionGetDouble(POSITION_PRICE_OPEN);
      double tp   = PositionGetDouble(POSITION_TP);
      if(trade.PositionModify(t, open, tp))
         Event(g_states[i].id, "breakeven", open, 0, 0, "stop moved to entry after TP1");
   }
}

void CloseAll(long id, string why)
{
   DeletePending(id);
   for(int p = PositionsTotal() - 1; p >= 0; p--)
   {
      ulong t = PositionGetTicket(p);
      if(t == 0 || PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      if(LegOf(PositionGetString(POSITION_COMMENT), id) < 0) continue;
      if(trade.PositionClose(t))
         Event(id, why, trade.ResultPrice(), 0, 0, "closed by rule");
   }
}

void DeletePending(long id)
{
   for(int o = OrdersTotal() - 1; o >= 0; o--)
   {
      ulong t = OrderGetTicket(o);
      if(t == 0 || OrderGetInteger(ORDER_MAGIC) != InpMagic) continue;
      if(LegOf(OrderGetString(ORDER_COMMENT), id) >= 0)
         trade.OrderDelete(t);
   }
}

int PendingCount(long id)
{
   int n = 0;
   for(int o = OrdersTotal() - 1; o >= 0; o--)
   {
      ulong t = OrderGetTicket(o);
      if(t != 0 && OrderGetInteger(ORDER_MAGIC) == InpMagic && LegOf(OrderGetString(ORDER_COMMENT), id) >= 0)
         n++;
   }
   return n;
}

//--- "ICT#<id>#<leg>" -> leg number for this id, else -1
int LegOf(const string comment, long id)
{
   string prefix = TAG + (string)id + "#";
   if(StringFind(comment, prefix) != 0) return -1;
   int leg = (int)StringToInteger(StringSubstr(comment, StringLen(prefix)));
   return (leg >= 0 && leg < MAX_LEGS) ? leg : -1;
}

//--- how a position closed: tp / sl / closed, with the exit price and the result
void ClosedHow(ulong positionId, string &why, double &price, double &profit)
{
   why = "closed"; price = 0; profit = 0;
   if(!HistorySelectByPosition(positionId)) return;
   for(int d = HistoryDealsTotal() - 1; d >= 0; d--)
   {
      ulong deal = HistoryDealGetTicket(d);
      if(HistoryDealGetInteger(deal, DEAL_ENTRY) != DEAL_ENTRY_OUT) continue;
      long reason = HistoryDealGetInteger(deal, DEAL_REASON);
      why    = reason == DEAL_REASON_TP ? "tp" : reason == DEAL_REASON_SL ? "sl" : "closed";
      price  = HistoryDealGetDouble(deal, DEAL_PRICE);
      profit = HistoryDealGetDouble(deal, DEAL_PROFIT) + HistoryDealGetDouble(deal, DEAL_COMMISSION)
               + HistoryDealGetDouble(deal, DEAL_SWAP);
      return;
   }
}

//+------------------------------------------------------------------+
//| Risk                                                              |
//+------------------------------------------------------------------+
double RiskLot(const string symbol, double entry, double stop)
{
   double tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
   if(tickValue <= 0) tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize  = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
   double distance  = MathAbs(entry - stop);
   if(tickValue <= 0 || tickSize <= 0 || distance <= 0) return 0;
   double riskMoney = AccountInfoDouble(ACCOUNT_BALANCE) * InpRiskPercent / 100.0;
   double lot = riskMoney / (distance / tickSize * tickValue);
   double step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   if(step <= 0) step = 0.01;
   lot = MathFloor(lot / step + 1e-9) * step;
   double maxLot = MathMin(SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX), InpMaxLot);
   return MathMin(lot, maxLot);
}

bool DailyLossHit()
{
   if(InpMaxDailyLossPct <= 0) return false;
   MqlDateTime t;
   TimeToStruct(TimeCurrent(), t);
   t.hour = 0; t.min = 0; t.sec = 0;
   datetime dayStart = StructToTime(t);
   if(!HistorySelect(dayStart, TimeCurrent() + 60)) return false;
   double result = 0;
   for(int d = HistoryDealsTotal() - 1; d >= 0; d--)
   {
      ulong deal = HistoryDealGetTicket(d);
      if(HistoryDealGetInteger(deal, DEAL_MAGIC) != InpMagic) continue;
      result += HistoryDealGetDouble(deal, DEAL_PROFIT) + HistoryDealGetDouble(deal, DEAL_COMMISSION)
                + HistoryDealGetDouble(deal, DEAL_SWAP);
   }
   double startBalance = AccountInfoDouble(ACCOUNT_BALANCE) - result;
   return startBalance > 0 && -result >= startBalance * InpMaxDailyLossPct / 100.0;
}

int OpenSignalCount()
{
   int n = 0;
   for(int i = 0; i < ArraySize(g_states); i++)
      if(!g_states[i].done) n++;
   return n;
}

//+------------------------------------------------------------------+
//| State file: survives terminal restarts so no signal is traded twice|
//+------------------------------------------------------------------+
string StateFile() { return "ICT_Bridge_" + (string)AccountInfoInteger(ACCOUNT_LOGIN) + ".csv"; }

int FindState(long id)
{
   for(int i = 0; i < ArraySize(g_states); i++)
      if(g_states[i].id == id) return i;
   return -1;
}

void AddState(SignalState &st)
{
   int n = ArraySize(g_states);
   ArrayResize(g_states, n + 1);
   g_states[n] = st;
   SaveStates();
}

void SaveStates()
{
   int h = FileOpen(StateFile(), FILE_WRITE | FILE_CSV | FILE_ANSI, ';');
   if(h == INVALID_HANDLE) return;
   int from = MathMax(0, ArraySize(g_states) - 500);      // keep the file small
   for(int i = from; i < ArraySize(g_states); i++)
   {
      SignalState s = g_states[i];
      FileWrite(h, s.id, s.symbol, s.dir, DoubleToString(s.entry, 8), (long)s.expiry, (long)s.timeStop, (long)s.exitBy,
                (int)s.tp1Done, (int)s.done, s.legTicket[0], s.legTicket[1], s.legTicket[2],
                (int)s.legClosed[0], (int)s.legClosed[1], (int)s.legClosed[2]);
   }
   FileClose(h);
}

void LoadStates()
{
   ArrayResize(g_states, 0);
   if(!FileIsExist(StateFile())) return;
   int h = FileOpen(StateFile(), FILE_READ | FILE_CSV | FILE_ANSI, ';');
   if(h == INVALID_HANDLE) return;
   while(!FileIsEnding(h))
   {
      SignalState s;
      ZeroMemory(s);
      s.id = (long)StringToInteger(FileReadString(h));
      if(s.id <= 0) break;
      s.symbol   = FileReadString(h);
      s.dir      = (int)StringToInteger(FileReadString(h));
      s.entry    = StringToDouble(FileReadString(h));
      s.expiry   = (datetime)StringToInteger(FileReadString(h));
      s.timeStop = (datetime)StringToInteger(FileReadString(h));
      s.exitBy   = (datetime)StringToInteger(FileReadString(h));
      s.tp1Done  = StringToInteger(FileReadString(h)) != 0;
      s.done     = StringToInteger(FileReadString(h)) != 0;
      for(int k = 0; k < MAX_LEGS; k++) s.legTicket[k] = (ulong)StringToInteger(FileReadString(h));
      for(int k = 0; k < MAX_LEGS; k++) s.legClosed[k] = StringToInteger(FileReadString(h)) != 0;
      int n = ArraySize(g_states);
      ArrayResize(g_states, n + 1);
      g_states[n] = s;
   }
   FileClose(h);
}

//+------------------------------------------------------------------+
//| Reports to the server (journal)                                    |
//+------------------------------------------------------------------+
void Event(long id, string what, double price, double volume, double profit, string detail)
{
   PrintFormat("ICT Bridge: signal %I64d %s %s", id, what, detail);
   int n = ArraySize(g_events);
   ArrayResize(g_events, n + 1);
   g_events[n] = StringFormat("{\"signal_id\":%I64d,\"event\":\"%s\",\"price\":%.8f,\"volume\":%.2f,\"profit\":%.2f,"
                              "\"detail\":\"%s\",\"at\":\"%s\"}", id, what, price, volume, profit, JsonEscape(detail),
                              TimeToString(TimeGMT(), TIME_DATE | TIME_SECONDS));
}

void FlushReports()
{
   if(ArraySize(g_events) == 0) return;
   string list = "";
   for(int i = 0; i < ArraySize(g_events); i++)
      list += (i ? "," : "") + g_events[i];
   string body = StringFormat("{\"ea_token\":\"%s\",\"mt5_login\":\"%I64d\",\"events\":[%s]}",
                              JsonEscape(InpEaToken), AccountInfoInteger(ACCOUNT_LOGIN), list);
   string resp; int code;
   if(HttpPost(InpServerURL + "/api/v1/ea/report", body, resp, code) && code == 200)
      ArrayResize(g_events, 0);
   else if(ArraySize(g_events) > 200)
      ArrayRemove(g_events, 0, ArraySize(g_events) - 200);   // never grow without bound while offline
}

//+------------------------------------------------------------------+
//| Symbols: the engine names (XAUUSD, NAS100...) on this broker       |
//+------------------------------------------------------------------+
bool Tradable(const string name)
{
   return SymbolSelect(name, true) && SymbolInfoInteger(name, SYMBOL_TRADE_MODE) != SYMBOL_TRADE_MODE_DISABLED;
}

string MappedName(const string engine)
{
   string pairs[];
   int n = StringSplit(InpSymbolMap, ';', pairs);
   for(int i = 0; i < n; i++)
   {
      string kv[];
      if(StringSplit(pairs[i], '=', kv) != 2) continue;
      string from = kv[0], to = kv[1];
      StringTrimLeft(from); StringTrimRight(from); StringTrimLeft(to); StringTrimRight(to);
      if(from == engine && to != "") return to;
   }
   return "";
}

string ResolveSymbol(const string engine)
{
   string mapped = MappedName(engine);
   if(mapped != "")
      return Tradable(mapped) ? mapped : "";
   if(Tradable(engine + InpSymbolSuffix)) return engine + InpSymbolSuffix;
   if(Tradable(engine)) return engine;
   string best = "";
   int total = SymbolsTotal(false);
   for(int k = 0; k < total; k++)
   {
      string name = SymbolName(k, false);
      if(StringFind(name, engine) == 0 && (best == "" || StringLen(name) < StringLen(best)) && Tradable(name))
         best = name;
   }
   return best;
}

//+------------------------------------------------------------------+
bool HttpPost(const string url, const string body, string &resp, int &code)
{
   char data[], result[];
   string respHeaders;
   int len = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(len > 0) ArrayResize(data, len - 1);      // drop the terminating zero
   ResetLastError();
   code = WebRequest("POST", url, "Content-Type: application/json\r\n", 8000, data, result, respHeaders);
   if(code == -1)
   {
      int err = GetLastError();
      g_status = err == 4014 ? "Add " + InpServerURL + " in Tools > Options > Expert Advisors > Allow WebRequest"
                             : "Server unreachable (error " + (string)err + ")";
      return false;
   }
   resp = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   return true;
}

void ShowStatus()
{
   string last = g_lastOk > 0 ? TimeToString(g_lastOk, TIME_SECONDS) : "-";
   Comment(StringFormat("ICT Bridge %s\nStatus: %s\n%s\nOpen signals: %d / %d   Feed: %d   Risk: %.2f%%\nLast contact: %s",
                        EA_VERSION, g_status, g_reason, OpenSignalCount(), InpMaxOpenSignals, g_feedCount,
                        InpRiskPercent, last));
}
//+------------------------------------------------------------------+
