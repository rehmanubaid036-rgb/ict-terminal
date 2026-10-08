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
//|  Exits (InpExitMode)                                              |
//|   Partial: one position; at each target the EA closes that        |
//|   target's share (the signal's split, e.g. 50/20/15/15, or        |
//|   InpPartials). The final target is the position's TP at the      |
//|   broker. Any number of targets.                                  |
//|   Legs: one position per target (max 3), each with its own TP.    |
//|  After TP1 the stop moves to breakeven. Trailing: once the trade   |
//|  is InpTrailStartR in profit, the stop keeps InpTrailLockPct % of |
//|  the best open profit (it only moves forward).                    |
//|  Pending orders are cancelled at the signal's expiry; if TP1 was  |
//|  not reached by its time stop everything is closed; any remainder |
//|  is closed at its exit time. Risk per signal = InpRiskPercent.    |
//+------------------------------------------------------------------+
#property copyright "ICT Terminal"
#property version   "1.12"
#property strict

#include <Trade/Trade.mqh>
#include "ICT_Json.mqh"

#define EA_VERSION "1.12"
#define TAG        "ICT#"
#define MAX_LEGS   3
#define MAX_TARGETS 6

enum ENUM_ICT_EXIT
{
   EXIT_PARTIAL = 0, // One position, partial close at each target
   EXIT_LEGS    = 1  // One position per target (max 3)
};

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
input ENUM_ICT_EXIT InpExitMode = EXIT_PARTIAL; // How targets are taken
input string InpPartials        = "";      // Partial: % closed at each target, e.g. 50,20,15,15 (empty = the signal's split)
input bool   InpBreakevenAtTP1  = true;    // Move the stop to the entry after TP1
input double InpTrailStartR     = 1.0;     // Trailing starts after this profit in R (0 = trailing off)
input double InpTrailLockPct    = 50.0;    // Trailing stop keeps this % of the best open profit (0 = off)

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
   // added in 1.10 (older state rows load with mode = legs and no targets)
   int      mode;                       // ENUM_ICT_EXIT used for this signal
   double   stop;                       // original stop (1R = |entry - stop|)
   double   volume;                     // total lot opened
   int      nt;                         // targets
   int      hits;                       // targets reached (partial mode)
   double   best;                       // best price reached since the fill
   double   tp[MAX_TARGETS];
   double   fr[MAX_TARGETS];
};

CTrade      trade;
SignalState g_states[];
string      g_events[];                 // JSON event objects waiting to be reported
string      g_status = "Starting...", g_reason = "";
bool        g_active = false;
int         g_feedCount = 0;
// risk settings in use: the EA inputs, or the customer's own from the terminal (MT5 tab) when set there
double      g_riskPct = 0.5, g_maxLossPct = 3.0;
int         g_maxOpen = 2;
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
   g_riskPct = InpRiskPercent;
   g_maxOpen = InpMaxOpenSignals;
   g_maxLossPct = InpMaxDailyLossPct;
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpSlippagePoints);
   LoadStates();
   if(InpTrailLockPct < 0 || InpTrailLockPct >= 100)
   {
      Alert("ICT Bridge: trailing lock must be between 0 and 99 %.");
      return INIT_PARAMETERS_INCORRECT;
   }
   EventSetTimer(1);
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
   // trades are managed every second; the server is asked every InpPollSeconds
   static datetime lastPoll = 0;
   if(TimeLocal() - lastPoll >= MathMax(2, InpPollSeconds))
   {
      lastPoll = TimeLocal();
      Poll();
      FlushReports();
   }
   Manage();
   ShowStatus();
}

//+------------------------------------------------------------------+
//| The account's open positions / pending orders as JSON (max 50)    |
//+------------------------------------------------------------------+
long ServerMinusUtc() { return (long)(TimeTradeServer() - TimeGMT()); }

string PositionsJson()
{
   string out = "";
   int n = 0;
   long off = ServerMinusUtc();
   for(int p = PositionsTotal() - 1; p >= 0 && n < 50; p--)
   {
      ulong ticket = PositionGetTicket(p);
      if(ticket == 0 || !PositionSelectByTicket(ticket)) continue;
      string sym = PositionGetString(POSITION_SYMBOL);
      int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      out += (n > 0 ? "," : "") + StringFormat(
         "{\"ticket\":%I64u,\"symbol\":\"%s\",\"side\":%d,\"volume\":%.2f,\"open\":%s,\"sl\":%s,\"tp\":%s,\"price\":%s,"
         "\"profit\":%.2f,\"swap\":%.2f,\"magic\":%I64d,\"time\":%I64d,\"comment\":\"%s\"}",
         ticket, JsonEscape(sym), PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1, PositionGetDouble(POSITION_VOLUME),
         DoubleToString(PositionGetDouble(POSITION_PRICE_OPEN), dg), DoubleToString(PositionGetDouble(POSITION_SL), dg),
         DoubleToString(PositionGetDouble(POSITION_TP), dg), DoubleToString(PositionGetDouble(POSITION_PRICE_CURRENT), dg),
         PositionGetDouble(POSITION_PROFIT), PositionGetDouble(POSITION_SWAP), PositionGetInteger(POSITION_MAGIC),
         (long)PositionGetInteger(POSITION_TIME) - off, JsonEscape(PositionGetString(POSITION_COMMENT)));
      n++;
   }
   return out;
}

string OrdersJson()
{
   string out = "";
   int n = 0;
   for(int i = OrdersTotal() - 1; i >= 0 && n < 50; i--)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0) continue;
      string sym = OrderGetString(ORDER_SYMBOL);
      int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      out += (n > 0 ? "," : "") + StringFormat(
         "{\"ticket\":%I64u,\"symbol\":\"%s\",\"type\":%d,\"volume\":%.2f,\"price\":%s,\"sl\":%s,\"tp\":%s,\"magic\":%I64d}",
         ticket, JsonEscape(sym), (int)OrderGetInteger(ORDER_TYPE), OrderGetDouble(ORDER_VOLUME_CURRENT),
         DoubleToString(OrderGetDouble(ORDER_PRICE_OPEN), dg), DoubleToString(OrderGetDouble(ORDER_SL), dg),
         DoubleToString(OrderGetDouble(ORDER_TP), dg), OrderGetInteger(ORDER_MAGIC));
      n++;
   }
   return out;
}

//+------------------------------------------------------------------+
//| Server: check in and receive the signals we may trade             |
//+------------------------------------------------------------------+
void Poll()
{
   // the account, its positions and pending orders go along, so the terminal can show them (MT5 tab)
   string body = StringFormat("{\"ea_token\":\"%s\",\"mt5_login\":\"%I64d\",\"mt5_server\":\"%s\",\"balance\":%.2f,"
                              "\"currency\":\"%s\",\"ea_version\":\"%s\",\"open_copies\":%d,\"equity\":%.2f,"
                              "\"magic\":%I64d,\"positions\":[%s],\"orders\":[%s]}",
                              JsonEscape(InpEaToken), AccountInfoInteger(ACCOUNT_LOGIN),
                              JsonEscape(AccountInfoString(ACCOUNT_SERVER)), AccountInfoDouble(ACCOUNT_BALANCE),
                              AccountInfoString(ACCOUNT_CURRENCY), EA_VERSION, OpenSignalCount(),
                              AccountInfoDouble(ACCOUNT_EQUITY), InpMagic, PositionsJson(), OrdersJson());
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
   // the customer's settings from the terminal (sent only when set there); otherwise the EA inputs
   double userRisk = JsonNumber(resp, "user_risk_percent", 0);
   g_riskPct = (userRisk > 0 && userRisk <= 5) ? userRisk : InpRiskPercent;
   int userOpen = (int)JsonNumber(resp, "user_max_open", 0);
   g_maxOpen = (userOpen > 0 && userOpen <= 20) ? userOpen : InpMaxOpenSignals;
   double userLoss = JsonNumber(resp, "user_max_daily_loss", 0);
   g_maxLossPct = (userLoss > 0 && userLoss <= 50) ? userLoss : InpMaxDailyLossPct;
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
      if(OpenSignalCount() >= g_maxOpen)
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

   st.stop   = stop;
   st.volume = total;
   st.nt     = MathMin(nt, MAX_TARGETS);
   for(int k = 0; k < st.nt; k++) { st.tp[k] = tp[k]; st.fr[k] = fr[k]; }
   if(st.nt < nt)                                          // more targets than stored: keep the final one,
   {                                                       // which takes the share of the dropped ones
      double kept = 0;
      for(int k = 0; k < st.nt - 1; k++) kept += st.fr[k];
      st.tp[st.nt - 1] = tp[nt - 1];
      st.fr[st.nt - 1] = MathMax(0.0, 1.0 - kept);
   }
   CustomPartials(st);
   st.mode = InpExitMode == EXIT_PARTIAL ? EXIT_PARTIAL : EXIT_LEGS;

   // partial mode: one position for the whole lot, the final target as its TP
   // legs mode: split the lot over the targets; legs below the minimum lot are merged into the first leg
   double legs[];
   ArrayResize(legs, st.mode == EXIT_PARTIAL ? 1 : MathMin(nt, MAX_LEGS));
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
      double t   = NormalizeDouble(st.mode == EXIT_PARTIAL ? st.tp[st.nt - 1] : tp[k], digits);
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
      Event(id, market ? "filled" : "placed", st.entry, total, 0,
            st.mode == EXIT_PARTIAL ? StringFormat("1 position, %d targets, partial closes %s", st.nt, st.symbol)
                                    : StringFormat("%d legs %s", placed, st.symbol));
}

//--- InpPartials ("50,20,15,15") replaces the signal's split; missing shares go to the last target
void CustomPartials(SignalState &st)
{
   if(StringLen(InpPartials) == 0 || st.nt == 0) return;
   string parts[];
   int n = StringSplit(InpPartials, ',', parts);
   double sum = 0;
   double f[MAX_TARGETS];
   ArrayInitialize(f, 0);
   for(int k = 0; k < st.nt; k++)
   {
      f[k] = k < n ? MathMax(0.0, StringToDouble(parts[k])) / 100.0 : 0;
      if(k == st.nt - 1) f[k] = MathMax(0.0, 1.0 - sum);  // the final target takes what is left
      sum += f[k];
   }
   if(sum <= 0) return;
   for(int k = 0; k < st.nt; k++) st.fr[k] = f[k] / sum;
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
         if(k == 0 && why == "tp" && g_states[i].mode == EXIT_LEGS)
         {
            g_states[i].tp1Done = true;
            if(InpBreakevenAtTP1)
               MoveToBreakeven(i);
         }
      }

      int pending = PendingCount(id);
      bool anyOpen = open[0] || open[1] || open[2];
      if(anyOpen && ManageExits(g_states[i]))
         changed = true;
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

//--- partial closes (partial mode), breakeven after TP1 and the trailing stop of one signal's
//--- open position(s); true when the signal's state changed
bool ManageExits(SignalState &st)
{
   if(st.nt == 0 || st.volume <= 0) return false;      // signal placed by EA 1.00: no targets stored
   bool changed = false;
   int digits = (int)SymbolInfoInteger(st.symbol, SYMBOL_DIGITS);
   double point = SymbolInfoDouble(st.symbol, SYMBOL_POINT);
   double price = st.dir == 1 ? SymbolInfoDouble(st.symbol, SYMBOL_BID) : SymbolInfoDouble(st.symbol, SYMBOL_ASK);
   if(price <= 0) return false;
   if(st.best == 0 || st.dir * (price - st.best) > 0)
   {
      st.best = price;
      changed = true;
   }
   double risk = MathAbs(st.entry - st.stop);

   // partial closes; the final target is the position's TP at the broker
   if(st.mode == EXIT_PARTIAL)
   {
      while(st.hits < st.nt - 1 && st.dir * (price - st.tp[st.hits]) >= 0)
      {
         int k = st.hits;
         st.hits++;
         changed = true;
         ulong ticket = st.legTicket[0];
         if(ticket == 0 || !PositionSelectByTicket(ticket)) break;
         double vol    = PositionGetDouble(POSITION_VOLUME);
         double step   = SymbolInfoDouble(st.symbol, SYMBOL_VOLUME_STEP);
         double minLot = SymbolInfoDouble(st.symbol, SYMBOL_VOLUME_MIN);
         if(step <= 0) step = 0.01;
         double part = MathFloor(st.volume * st.fr[k] / step + 1e-9) * step;
         if(vol - part < minLot) part = 0;                // the rest must stay tradable; the final TP takes it
         if(part >= minLot)
         {
            if(trade.PositionClosePartial(ticket, NormalizeDouble(part, 2)))
               Event(st.id, "partial", trade.ResultPrice(), part, 0, StringFormat("TP%d: closed %.0f%%", k + 1, st.fr[k] * 100));
            else
               Event(st.id, "error", price, part, 0, StringFormat("TP%d partial close: %s", k + 1, trade.ResultRetcodeDescription()));
         }
         else
            Event(st.id, "partial", price, 0, 0, StringFormat("TP%d reached (lot too small to split)", k + 1));
         if(k == 0)
         {
            st.tp1Done = true;
            if(InpBreakevenAtTP1)
               SetStop(st, st.entry, 0, "breakeven", "stop moved to entry after TP1");
         }
      }
   }

   // trailing: once InpTrailStartR in profit, the stop keeps InpTrailLockPct % of the best open profit
   if(InpTrailStartR > 0 && InpTrailLockPct > 0 && risk > 0)
   {
      double gain = st.dir * (st.best - st.entry);
      if(gain >= InpTrailStartR * risk)
      {
         double level   = NormalizeDouble(st.entry + st.dir * gain * InpTrailLockPct / 100.0, digits);
         double minDist = (double)SymbolInfoInteger(st.symbol, SYMBOL_TRADE_STOPS_LEVEL) * point;
         if(st.dir * (price - level) > minDist)
            SetStop(st, level, 0.1 * risk, "trail",
                    StringFormat("stop trailed to %s (keeps %.0f%% of the best profit)", DoubleToString(level, digits), InpTrailLockPct));
      }
   }
   return changed;
}

//--- moves the stop of every open position of the signal to `level` when that is at least
//--- `minStep` better than its current stop (stops only move forward)
void SetStop(SignalState &st, double level, double minStep, string what, string detail)
{
   int digits = (int)SymbolInfoInteger(st.symbol, SYMBOL_DIGITS);
   double point = SymbolInfoDouble(st.symbol, SYMBOL_POINT);
   level = NormalizeDouble(level, digits);
   bool moved = false;
   for(int p = PositionsTotal() - 1; p >= 0; p--)
   {
      ulong t = PositionGetTicket(p);
      if(t == 0 || PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      if(LegOf(PositionGetString(POSITION_COMMENT), st.id) < 0) continue;
      double sl = PositionGetDouble(POSITION_SL);
      if(sl != 0 && st.dir * (level - sl) <= MathMax(minStep, point / 2)) continue;
      if(trade.PositionModify(t, level, PositionGetDouble(POSITION_TP)))
         moved = true;
   }
   if(moved)
      Event(st.id, what, level, 0, 0, detail);
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
   double riskMoney = AccountInfoDouble(ACCOUNT_BALANCE) * g_riskPct / 100.0;
   double lot = riskMoney / (distance / tickSize * tickValue);
   double step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   if(step <= 0) step = 0.01;
   lot = MathFloor(lot / step + 1e-9) * step;
   double maxLot = MathMin(SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX), InpMaxLot);
   return MathMin(lot, maxLot);
}

bool DailyLossHit()
{
   if(g_maxLossPct <= 0) return false;
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
   return startBalance > 0 && -result >= startBalance * g_maxLossPct / 100.0;
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
                (int)s.legClosed[0], (int)s.legClosed[1], (int)s.legClosed[2],
                s.mode, DoubleToString(s.stop, 8), DoubleToString(s.volume, 2), s.nt, s.hits, DoubleToString(s.best, 8),
                DoubleToString(s.tp[0], 8), DoubleToString(s.tp[1], 8), DoubleToString(s.tp[2], 8),
                DoubleToString(s.tp[3], 8), DoubleToString(s.tp[4], 8), DoubleToString(s.tp[5], 8),
                DoubleToString(s.fr[0], 4), DoubleToString(s.fr[1], 4), DoubleToString(s.fr[2], 4),
                DoubleToString(s.fr[3], 4), DoubleToString(s.fr[4], 4), DoubleToString(s.fr[5], 4));
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
      s.mode = EXIT_LEGS;                       // rows written by EA 1.00 end here
      if(!FileIsLineEnding(h) && !FileIsEnding(h))
      {
         s.mode   = (int)StringToInteger(FileReadString(h));
         s.stop   = StringToDouble(FileReadString(h));
         s.volume = StringToDouble(FileReadString(h));
         s.nt     = (int)StringToInteger(FileReadString(h));
         s.hits   = (int)StringToInteger(FileReadString(h));
         s.best   = StringToDouble(FileReadString(h));
         for(int k = 0; k < MAX_TARGETS; k++) s.tp[k] = StringToDouble(FileReadString(h));
         for(int k = 0; k < MAX_TARGETS; k++) s.fr[k] = StringToDouble(FileReadString(h));
         s.nt = MathMax(0, MathMin(s.nt, MAX_TARGETS));
      }
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
   string exits = (InpExitMode == EXIT_PARTIAL ? "partial closes" : "legs")
                  + (InpTrailStartR > 0 && InpTrailLockPct > 0 ? StringFormat(", trail %.0f%% after %.1fR", InpTrailLockPct, InpTrailStartR) : ", no trailing");
   Comment(StringFormat("ICT Bridge %s\nStatus: %s\n%s\nOpen signals: %d / %d   Feed: %d   Risk: %.2f%%\nExits: %s\nLast contact: %s",
                        EA_VERSION, g_status, g_reason, OpenSignalCount(), g_maxOpen, g_feedCount,
                        g_riskPct, exits, last));
}
//+------------------------------------------------------------------+
