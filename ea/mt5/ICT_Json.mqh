//+------------------------------------------------------------------+
//|                                                     ICT_Json.mqh |
//|  URL encoding, ISO time parsing and minimal JSON readers for the  |
//|  ICT Terminal server's flat responses (adapted from ICC_Json).    |
//+------------------------------------------------------------------+
#property strict

//--- raw value of "key": in a flat JSON object ("..." strings, numbers, true/false/null)
string JsonRaw(const string json, const string key)
{
   string pat = "\"" + key + "\":";
   int p = StringFind(json, pat);
   if(p < 0) return "";
   p += StringLen(pat);
   while(p < StringLen(json) && StringGetCharacter(json, p) == ' ') p++;
   if(StringGetCharacter(json, p) == '"')
   {
      int e = p + 1;
      while(e < StringLen(json))
      {
         ushort ch = StringGetCharacter(json, e);
         if(ch == '\\') { e += 2; continue; }
         if(ch == '"') break;
         e++;
      }
      return StringSubstr(json, p, e - p + 1);
   }
   int e = p;
   while(e < StringLen(json))
   {
      ushort ch = StringGetCharacter(json, e);
      if(ch == ',' || ch == '}' || ch == ']') break;
      e++;
   }
   return StringSubstr(json, p, e - p);
}

string JsonString(const string json, const string key)
{
   string raw = JsonRaw(json, key);
   if(StringLen(raw) >= 2 && StringGetCharacter(raw, 0) == '"')
      return StringSubstr(raw, 1, StringLen(raw) - 2);
   return raw == "null" ? "" : raw;
}

double JsonNumber(const string json, const string key, double def)
{
   string raw = JsonRaw(json, key);
   if(raw == "" || raw == "null") return def;
   return StringToDouble(raw);
}

bool JsonBool(const string json, const string key) { return JsonRaw(json, key) == "true"; }

//--- the text between the brackets of "key": [ ... ] (handles nested brackets)
string JsonArrayText(const string json, const string key)
{
   string pat = "\"" + key + "\":";
   int p = StringFind(json, pat);
   if(p < 0) return "";
   p = StringFind(json, "[", p);
   if(p < 0) return "";
   int depth = 0;
   bool inStr = false;
   for(int e = p; e < StringLen(json); e++)
   {
      ushort ch = StringGetCharacter(json, e);
      if(inStr) { if(ch == '\\') { e++; continue; } if(ch == '"') inStr = false; continue; }
      if(ch == '"') { inStr = true; continue; }
      if(ch == '[') depth++;
      if(ch == ']') { depth--; if(depth == 0) return StringSubstr(json, p + 1, e - p - 1); }
   }
   return "";
}

//--- the objects { ... } of an array text
int JsonObjects(const string arrayText, string &objs[])
{
   ArrayResize(objs, 0);
   int depth = 0, start = -1;
   bool inStr = false;
   for(int i = 0; i < StringLen(arrayText); i++)
   {
      ushort ch = StringGetCharacter(arrayText, i);
      if(inStr) { if(ch == '\\') { i++; continue; } if(ch == '"') inStr = false; continue; }
      if(ch == '"') { inStr = true; continue; }
      if(ch == '{') { if(depth == 0) start = i; depth++; }
      if(ch == '}')
      {
         depth--;
         if(depth == 0 && start >= 0)
         {
            int k = ArraySize(objs);
            ArrayResize(objs, k + 1);
            objs[k] = StringSubstr(arrayText, start, i - start + 1);
            start = -1;
         }
      }
   }
   return ArraySize(objs);
}

//--- targets: [[price, fraction], ...] -> parallel arrays
int JsonTargets(const string obj, double &prices[], double &fractions[])
{
   ArrayResize(prices, 0); ArrayResize(fractions, 0);
   string inner = JsonArrayText(obj, "targets");
   StringReplace(inner, " ", "");
   string pairs[];
   StringReplace(inner, "],[", "|");
   StringReplace(inner, "[", "");
   StringReplace(inner, "]", "");
   int n = StringSplit(inner, '|', pairs);
   for(int i = 0; i < n; i++)
   {
      string kv[];
      if(StringSplit(pairs[i], ',', kv) != 2) continue;
      int k = ArraySize(prices);
      ArrayResize(prices, k + 1); ArrayResize(fractions, k + 1);
      prices[k] = StringToDouble(kv[0]);
      fractions[k] = StringToDouble(kv[1]);
   }
   return ArraySize(prices);
}

//--- "2026-10-01T14:08:00+00:00" (UTC) -> datetime (UTC); 0 if empty
datetime IsoToUtc(const string iso)
{
   if(StringLen(iso) < 19) return 0;
   string s = StringSubstr(iso, 0, 19);
   StringReplace(s, "-", ".");
   StringReplace(s, "T", " ");
   return StringToTime(s);
}

string UrlEncode(const string s)
{
   string out = "";
   uchar bytes[];
   int n = StringToCharArray(s, bytes, 0, WHOLE_ARRAY, CP_UTF8) - 1;
   for(int i = 0; i < n; i++)
   {
      uchar c = bytes[i];
      if((c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '-' || c == '_' || c == '.')
         out += CharToString(c);
      else
         out += StringFormat("%%%02X", c);
   }
   return out;
}

string JsonEscape(const string s)
{
   string out = s;
   StringReplace(out, "\\", "\\\\");
   StringReplace(out, "\"", "\\\"");
   return out;
}
