# Web terminal (`/terminal/`) — handoff notes

Written 2026-10-03 by a Claude Code cloud session for the next session (or a developer).
It covers what was built, how to build and test it, and what is still open.

## What changed in this round

1. **Website** (`web/site/`): new design (hero with live screenshot, markets strip, bento features,
   tabbed showcase, pricing from `/api/v1/plans`, FAQ, phone menu). CSS/JS links carry `?v=N`
   because Cloudflare caches CSS/JS for 4 hours — bump N after editing `style.css` / `site.js`.
2. **Web terminal rebuilt from source.** The old terminal existed only as a built bundle (no source in
   the repo or on the VPS). It is now a React + TypeScript + KLineChart 10 project in
   `web/terminal/` (`src/`, `package.json`, `vite.config.ts`). `npm run build` writes
   `web/terminal/dist/`, which is committed and served by `web/serve_web.py` at `/terminal/`.
   The old `ict-theme.css` / `ict-mobile.js` patch files are gone (the new app is responsive itself).
3. **API** (`api/ictapi/main.py`): the customer's crypto order status / cancel / txid calls are now
   forwarded to the admin panel (`FORWARD_PATTERNS`). Needs an API restart to take effect.

4. **New model M17 · Wolf Asia Session (NDOG)** (`engine/ictengine/models/wolf_asia.py`, registered in
   `models/registry.py`), from the user's PDF "Asia Session Model for Indices NQ/ES" (TheWolfTrades notes).
   NAS100, US500, EURUSD, GBPUSD only. NDOG (17:00 close → 18:00 open) and its CE, initial BSL/SSL of
   18:00–19:00, trades 19:00–21:00 NY: raid → MSS/displacement → FVG CE entry, stop beyond the raid (or the
   NDOG CE), targets 1 / 1.25 / 1.5 standard deviations of the opposite leg (50/25/25). Plans with
   `allowed_models = all` get it automatically; the terminal labels it "M17 Wolf" and draws it on 1m charts
   only (NDOG + CE, initial BSL/SSL, SD levels, wick CE). The engine runner and API pick it up after an ICT
   restart. As in the PDF only the initial BSL/SSL and session levels count as raided liquidity
   (`raid_timeframes=()`). Back to the user's earlier setting (commit 381b7fa: stop at the wick CE, NDOG CE
   when significant) with the PDF targets: the opposite leg's -1 SD (TP1, 50%), -1.25 SD (TP2, 25%) and -1.5 SD
   (TP3, 25%); the previous session's 15:30-16:00 high / low is drawn for reference only. The chart draws the
   SD tool (0, 1, -1, -1.25, -1.5) as in the PDF. Checked on Dukascopy NAS100 1m, 15 Jul - 29 Aug 2024: 13 filled trades,
   53.8% wins, +3.1R, PF 1.53, max drawdown 2.3R (small sample). Against the PDF journal (18-26 Aug) it takes
   the 18-08 short, no trade on 19-08, the 20-08 long and a late 25-08 long; the journal is partly
   discretionary.
5. **ICT Bridge EA 1.10** (`ea/mt5/ICT_Bridge.mq5`): `InpExitMode` = Partial (default: one position, the EA
   closes each target's share - the signal's split or `InpPartials`, e.g. `50,20,15,15` - and the final target
   is the TP at the broker; any number of targets) or Legs (the 1.00 behaviour, max 3). `InpBreakevenAtTP1`.
   Trailing: after `InpTrailStartR` (1R) the stop keeps `InpTrailLockPct` (50%) of the best open profit and
   only moves forward, in steps of at least 0.1R. Trades are managed every second. The state file stays
   readable: signals opened by 1.00 keep their legs and breakeven. Not compiled here (no MetaEditor):
   compile it in MetaEditor on the VPS and check the Journal / Experts tab.
6. **Guest login** (admin panel migration 0003): see the commit "Login as guest".
7. **Models brought to the rulebook (plan PDF section 4)** - engine only, the API / terminal pick them up after
   an ICT restart:
   - M1 Silver Bullet: MSS with displacement only; stop 1 tick beyond the sweep wick (+ spread for a short);
     TP1 nearest internal liquidity (>= 1R and the symbol's `min_target`: indices ~10 pts, FX ~15 pips),
     TP2 next liquidity or an opposing 5m/15m FVG CE, TP3 the draw on liquidity; M8 Power of 3 adds +1.
   - All `build_signal` models: section 7 confluence grade (A+ >= 8, A 6-7, B < 6), premium / discount
     required, `cancel_if_close_beyond` (body close through the FVG before the fill) and `be_offset` notes,
     applied by the backtest simulator and the terminal journal.
   - Bias: Midnight Open filter as a fifth component (threshold stays 2; the rulebook's [DEFAULT] 3 set a
     bias on 4 of 60 NAS100 days).
   - M3 NY window 08:30-10:00 + Power of 3 boost; M4 targets -0.5 / -1 / -2 fib extensions; M5 rebuilt
     (`models/asian_q2.py`: Q1 raid into a 15m/1H/4H FVG, Q2 True Open / Q1 / 1H array targets 50/30/20);
     M6 NAS100/US500 window 20:45-22:15; M14 only after the morning's draw on liquidity was hit, trading
     against it; M15 targets CBDR / Asian range SD -2 / -3 / -4; M10 FOMC days: exit and expiry moved to
     13:55 (`news.fomc_flat`, applied by the runner).
   - Not changed: M9 stays the simplified Market Maker model (the rulebook marks the staged model Phase 2).

## Features (plan section 5)

| Area | What exists |
|---|---|
| Chart | KLineChart 10.0.3, NY timezone, candles / hollow / Heikin Ashi (computed client-side) / bars / line / area; regular, log and percent scale; live updates every 5 s (polling `/udf/history`) |
| Intervals | 1m 3m 5m 15m 30m 1H 2H 4H D W M + custom typed intervals (e.g. `7`, `90`, `2h`): bars not served by the API are built client-side from a smaller resolution; M is built from daily bars |
| ICT layers | All 14 engine layers from `/api/v1/ict/overlays`, drawn with the first terminal's colours/shapes (`src/chart/overlays.ts`), plus the Daily Bias corner panel |
| Model indicators | Setups of the chosen models as boxes on the chart (`/api/v1/signals`), plan locks per model |
| Standard indicators | 26 KLineChart built-ins + VWAP (NY 18:00 session), SuperTrend, ATR, Donchian (`src/chart/indicators.ts`); searchable dialog, editable parameters, "apply to all charts" |
| Drawing tools | 7 groups / 29 tools incl. ICT tools (FVG box with CE, OB with MT, liquidity line BSL/SSL, OTE tool, dealing range, killzone box), ICT Fib preset, long/short position with RR, price & date range, text, brush. Magnet (weak/strong), stay-in-drawing, lock/hide/delete all, undo/redo, eraser, style bar (colour, width, dashed, lock, alert from a horizontal line). Right-click selects (KLineChart's default right-click delete is disabled) |
| Multi-chart | Layouts 1, 2 (side / stacked), 3, 4, 6, 8 (limited by the plan's `max_charts`); sync symbol / interval / crosshair; maximise the active chart; named layouts saved on the account; autosave to `__autosave__` every 8 s (reads the first terminal's v1 layouts too) |
| Right panel | Watchlist (live quotes, price flash), Signals (scan, grade filter, notify on new A/A+), AI assistant (EN / Roman Urdu), Alerts (price crossing / above / below, browser notification + sound, plan limit), Object tree, Data window |
| Bottom panel | Setups journal (each signal's result worked out from 5-minute candles: TP1/TP2/TP3/stop/breakeven/not triggered, R), model stats (win rate, avg R, total R), engine status |
| Replay | Bar replay on the active chart: play / pause / step / speed |
| Account | Plan & features, subscriptions, devices; upgrade with bank/JazzCash (submit transaction ID → WhatsApp) or crypto order (exact amount + address, polls status); payments history; change password |
| Auth | Log in, create account, password reset by code (same token keys as before, so users stay logged in) |
| Trading tools | Paper trading (Trade tab, one-click buy / sell on the chart, draggable SL / TP lines; server `/api/v1/paper*`), strategy tester (`/api/v1/backtest`, one model, 30 / 60 / 90 days, equity curve), screener, economic calendar and news tabs, pop-out chart window (`?popout=1`) |
| ICT Script | Your own indicators in a small formula language (`src/chart/script.ts`): series variables, `x[n]` history, sma / ema / rma / wma / rsi / atr / highest / lowest / stdev / change / abs / max / min, up to 6 `plot()` lines, `@pane`. Parsed and evaluated by the terminal (no JavaScript eval); saved in the layout as `scripts`; Indicators dialog > My scripts |
| ICT event alerts | Alerts tab > ICT event: MSS, BOS, new FVG or liquidity sweep on a symbol + interval (1m-4H), either or one direction. Checked every 30 s from `/api/v1/ict/overlays`; fires on every new event (the alert keeps `ict.seen`), plan with ICT indicators only |
| Server-side alerts | `api/ictapi/alert_watch.py` (thread in the API, `ICT_ALERT_WATCH=off` stops it). Every 15 s it reads the autosave layout of each user the admin panel lists (`internal/alerts/users`: active plan + a channel), checks price / line / zone alerts on 1m candles (last 10 min), session starts, and ICT events every 60 s; delivery through `internal/alerts/send` to WhatsApp (template `ict_alert`, 1 variable), Telegram (bot, Connect Telegram link), email, webhook (public https only). Fired alerts go to `alert_fired`; the terminal pulls `/api/v1/alerts/fired` every 30 s, switches those alerts off and logs them. Restart sets `armedAt` so the server watches it again |
| Indicator templates | Indicators > Templates: save the indicators on a chart (with settings / pane) under a name, apply (replace) or Add to any chart. Saved in the layout (`indTemplates`) so every device has them |
| Drawing style templates | Drawing settings > Template: save a tool's look (colour, width, dashed, Fib levels) under a name, apply it to another drawing of that tool, or Use as default for new drawings (`drawTemplates`, `drawDefaults`; new drawings read `drawDefault(tool)` in registry.ts) |
| Spread / ratio symbols | `FEED:A/B`, `FEED:A-B`, `FEED:A+B`, `FEED:A*B` (e.g. AXI:XAUUSD/XAGUSD). `SyntheticProvider` in market.py combines two symbols of one feed bar by bar (shared minutes only); symbol search offers them when the query has an operator. ICT layers work on them; paper trade buttons are hidden |
| Bar replay | One clock (ms) for every chart on the screen (All charts on by default): each chart shows only bars that have closed by the clock, so a 1H chart never shows the future of a 5m step. Start from the right-clicked bar (Bar replay from this bar), the middle of the view (toolbar), or any New York date/time (Go; history is loaded around it). ⏮ back one bar, ⏭ next bar, play 0.5-10x, Jump to real time ends it (feed.ts startReplayAt / advanceTo / nextClose / prevClose) |
| More indicators (chart/indicators2.ts) | WMA, HMA, VWMA, DEMA, TEMA, ALMA, MA Ribbon, Ichimoku (cloud), Keltner, Pivot Points (Classic / Fibonacci / Camarilla / Woodie from the previous NY day), Zig Zag, Alligator, Fractals, Stoch RSI, MFI, CMF, A/D, Aroon, Ultimate, Vortex, Choppiness, Historical Volatility. Indicator on indicator: '+ MA on it' adds `MAON_<name>` (SMA / EMA of that indicator's line, drawn in its pane from the base indicator's `result`) |
| More drawing tools (chart/tools3.ts) | Fib extension / channel / time zones / speed fan / circles; Gann box / square; Schiff, modified Schiff and inside pitchforks; flat top-bottom and disjoint channels; cross line, info line, trend angle; ellipse, arc, rotated rectangle, path; cypher, three drives, triangle, Elliott triangle / double / triple combo; forecast, projection, bars pattern, cyclic lines, time cycles, sine line; price note, signpost, flag, sticker, picture (shrunk to 360 px JPEG and kept in the drawing; custom `picture` figure) |
| More chart types | HLC area, step line, line with markers, volume candles (width by volume) are drawn by the chart-style layer (`DRAWN_TYPES`); Point & Figure (ATR box, 3-box reversal, `turnover` = box size) and Kagi (ATR reversal, thick yang / thin yin) are built in the feed like Renko. ICT layers are hidden on P&F and Kagi (no time axis) |
| ICT Script strategies | `long(cond)`, `short(cond)`, `exit(cond)`, `@stop` (x ATR 14), `@target` (R), `@maxbars`; `and` / `or`, `crossover` / `crossunder`. The editor's Strategy test runs it on the active chart's bars (`testStrategy` in script.ts: next-bar-open entries, stop before target in one bar, one trade at a time) and shows trades, win rate, net / average R, profit factor, max drawdown, equity curve; trades can be drawn on the chart (group `scriptTest`, not saved) |
| Custom hotkeys | Settings (gear) > Keyboard shortcuts: every drawing tool, intervals, screenshot, alert, go to date, replay, hide drawings, indicators, screener, settings, side panels. Click a key, press the new combo (Ctrl / Alt / Shift or F1-F12; Backspace = none). Saved in the layout (`hotkeys`, only the changes); browser keys (Ctrl+Z/C/V/R/W/T ...) are kept (`RESERVED` in hotkeys.ts) |
| Share a chart picture | Camera button > Copy a share link (also in the right-click menu and as a hotkey). POST `/api/v1/snapshots` (PNG / JPEG data URL, 3 MB, 40 a day per user) saves `data/snapshots/<id>.png`; `/api/v1/snapshots/<id>` is a public page with og:image for chat previews, `<id>.png` the picture; the owner can list and delete them |
| Symbol info | Right rail > Symbol info (`?tab=info`): description, type, feed symbol, tick size, trading hours, whether the engine watches it live, SMT partner (click to open), today's change / range vs ADR, ATR 14, ADR 20, average volume, week / month / 52-week ranges with the position in them (`/api/v1/symbol-info`, from daily bars) |
| Seconds charts | 1s / 5s / 15s / 30s (any 1-59 s in the interval box, e.g. `10s`). Resolutions `<n>S`; MT5 feeds build them from ticks (`mt5.ticks` -> `ticks_to_bars`, asked in the server clock, last 6 h, up to 300k ticks, not cached); Binance uses its 1s klines. Spread symbols work on seconds too; ICT chart layers work (time layers do not) |
| MT5 / Auto-trade tab | Auto-trading ON / OFF and lot multiplier (`copy/settings`), EA token (`copy/token`, shown once), EA files (`/api/v1/ea/download/ICT_Bridge.mq5`, `ICT_Json.mqh`) and install steps. EA 1.11 sends equity, open positions and pending orders with every poll; `/api/v1/mt5/state` returns them (table `ea_state`) with the EA trade log. Positions are listed with P/L and drawn as entry / SL / TP lines on charts of the same symbol (broker suffixes removed) |
| Time and drawings sync | Layout menu > Sync: Time (the active chart leads; the others scroll so the same time is at their right edge, `ict:timesync`) and Drawings (same symbol: a drawing is copied to every chart of that symbol and stays linked by `extendData.syncId`; moving, restyling and deleting follow; `syncDrawing` in registry.ts) |
| Live bars (WebSocket) | One socket `/ws/stream` for all charts (chart/stream.ts): hello `{auth, device}` then `{sub: [...]}`; every second the newest two bars of each subscription (changed, or again every 4 s). The web server (serve_web.py, port 3100) passes `/ws/stream` to the API. A chart whose stream is quiet for 6 s polls as before; grouped intervals (7m, monthly) always poll |
| Model indicator settings | ICT menu > a model's ⚙ (when it is on): grades it draws (all / A and A+ / A+), target lines on / off, reward in R on the label, box colour. Saved per chart (`modelSet`) |
| All-Models scanner | Screener > All-models scanner: every model's setups today on every watched symbol, A+ / A filter, with or against the daily bias; a click opens the symbol with that model on |
| Drawing tools 4 (chart/tools4.ts) | Fib spiral / arcs / wedge, polyline, double curve, highlighter, S/R zone, anchored text, comment, ghost feed, and ICT: session range box (finds high / low / 50%), Silver Bullet windows, Judas swing marker. Object tree: rename, groups (hide / lock / delete together), clone |
| Volume profiles | Visible range (VPVR), Session Volume Profile `SVP` (Asia / London / New York or per day, POC + value area) and the Fixed range volume profile drawing (POC, VAH, VAL) - `src/chart/volprofile.ts` |
| Price scale | Right-click the price scale: Auto (fit), Lock range, Lock price / bar, Regular / Log / Percent, Invert, scale left / right. The lock is saved with the chart (`scaleLock`, a KLineChart `createRange`) |
| Layouts | 1-8 charts (1, 2 side / stacked, 3, 4, 5, 6, 7, 8); the plan's "Charts per layout" (admin, 1-8) limits them; tablets in portrait show 5-8 charts in two columns, phones 2 x 4; indicator panes size to the chart |
| Chart types | Candles, hollow, Heikin Ashi, bars, line, area, Renko, line break, range bars, baseline, columns (`src/chart/charttypes.ts`) |
| Indicator panes | Price-based indicators (MA, EMA, BOLL, VWAP, price scripts) move into a pane of their own and back; oscillator panes move up / down |
| Watchlist columns | List menu > Columns: Chg, Chg%, today's High, Low, Volume and a day-range bar (`/api/v1/quotes` returns high / low / volume) |
| Templates | Top bar Templates: shared chart setups; the default one greets new users; admins save / set default (`/api/v1/templates`, `maketemplate.bat`) |
| Other | Dark / light theme, keyboard shortcuts (letters = symbol search, digits = interval, Alt+T/H/J/V/F/R tools, Alt+A alert, Alt+S screenshot, Ctrl+Z/Y, Del, Esc), screenshot, full screen, phone layout (tool sheets, bottom tab bar, bottom sheets, one chart at a time with chips) |

Not built yet (plan items): Urdu UI language,


## Build

```
cd web/terminal
npm ci
npm run build        # type-checks, then writes dist/
```

`vite.config.ts` contains a small build-time patch for a KLineChart 10.0.3 bug: a second click/tap
within 500 ms of the first but too far away to be a double-click was dropped, so the second point of
a quickly drawn line was lost. The build fails loudly if a KLineChart upgrade changes that code.

## Test locally (no VPS, no MT5)

A cloud session can run the real API + engine on synthetic data and drive the terminal with
Playwright. The script used in this session created a `FrameProvider` with ~45 days of synthetic
1-minute bars per symbol, an `AuthClient` subclass that answers `auth/me` / plans / payments with fixed
data, ran `ictengine.runner.run_once` once to fill the signal store, and served
`serve_web.create_app("http://127.0.0.1:8100", dist=...)` on port 3100. Tests covered every interval,
chart type, indicator dialog, ICT/Models menus, symbol search, all 29 drawing tools (one by one on desktop, 23 of them also with phone touch), undo/redo, hotkeys, all panels, layouts 1–4 + phone chips, replay, context menu, account
dialog, light theme, free-plan locks, login / logout / reset — all passing at 1440×900 and 390×844.

Two read-only hooks exist for browser tests: `window.__ictCount()` (number of drawings) and
`window.__ictOverlays()` (drawing names and steps).

## Deploy on the VPS

```
cd "C:\ICT engine"
git pull
```

The website and terminal update without a restart (HTML is not cached; the terminal's JS/CSS file
names change with each build). The API change (crypto order forwarding) needs ICT restarted once:
run `ictoneclickclose.bat` as administrator, then `deploy\startict.bat` (or `oneclickict.bat`).

## Things to check on the real server

- Log in with a real account (only the mock was tested here) and a free-plan account.
- Crypto payment: create an order, confirm the status poll works after the API restart.
- With many drawings (100+) and all 14 ICT layers the local test server became slow; watch CPU on
  the VPS. Overlay requests are cancelled when the view changes, so stale requests do not pile up
  in the browser, but the API keeps computing a cancelled request.
