# ICT Terminal

SaaS ICT trading engine: TradingView-style web terminal, Android app, MT5/MT4 auto-trading, membership system.
Lives on `ict.iccterminal.trade` (part of ICC Terminal).

| Folder | What |
|---|---|
| `docs/` | Master plan, ICT rulebook, `build_pdf.py` |
| `pdf/` | Printable plan (`ICT_Project_Plan.pdf`) |
| `source_material/` | Original journal PDF + screenshots (rules come from here) |
| `engine/` | Python ICT engine: time engine, indicators, models, backtest |
| `api/` | FastAPI: datafeed, signals, auth, EA bridge, payments |
| `admin_panel/` | Django + Jazzmin admin (adapted from ICC Terminal) |
| `feeds/` | Broker MT5 collectors, crypto WebSockets, futures |
| `web/` | Next.js website + web terminal |
| `mobile/` | Flutter app (Android + Windows) |
| `ea/` | ICT Bridge EA (MQL5 / MQL4) |
| `deploy/` | VPS + Cloudflare setup |
| `tests/` | Engine tests (journal trades as test cases) |

Rebuild the PDF after editing docs:

```
python docs/build_pdf.py
```
