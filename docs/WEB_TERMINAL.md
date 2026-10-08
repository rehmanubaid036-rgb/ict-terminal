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

5. **Model M18 · The Alpha Model Gold** (`engine/ictengine/models/alpha_gold.py`), built only from the PDF
   "The_Alpha_Model_Gold": XAUUSD, London 02:00-05:00 and New York 07:00-10:00. Bias of DXY, silver and gold from the
   previous day's body vs the 50 % of a daily (60 days) / weekly FVG it traded into, confirmed on H1 (last gap of that
   direction not failed by a body); gold opposite DXY; grade A+ / A / B by silver. Entry: previous M5 swing broken in the
   session, then on M1 the last opposite FVG fails with a body (a candle opening inside the gap is ignored); stop beyond
   the M1 extreme since the break; target the previous M15 swing before the session. DXY: the feed's own index, else
   rebuilt from its six pairs (`ictengine/data/dxy.py`); the runner and the API pass it with silver as `Context.extras`.
   Wolf Models button, 1m charts; the chart shows the M15 / M5 swing lines, the failed FVG and the bias.

4. **Model M17 · Wolf Asia Session (NDOG)** (`engine/ictengine/models/wolf_asia.py`), rebuilt on 2026-10-08
   strictly from the PDF "ASIA SESSION MODEL FOR INDICIES NQ/ES" (TheWolfTrades): NAS100, US500, EURUSD,
   GBPUSD. NDOG 17:00 close → 18:00 open, over 20 handles (points / pips) its CE is marked; initial BSL / SSL of
   18:00-19:00; trades 19:00-22:00 NY only (the author, 8 Oct 2026) ("time first"); low → MSS → BISI of the displacement, entry at the
   BISI's middle, stop at the Wick C.E of the low candle (NDOG CE on a breakaway through a marked NDOG);
   targets -1 SD (half), -1.25 SD, -1.5 SD of the last opposite leg (from the highest high since the previous
   lower low to the low). Removed because the PDF does not have them: the 22:30 time exit, the 1R minimum,
   the daily bias, a minimum FVG size, spread on the stop. Grade: A+ = NDOG over 20 + initial liquidity taken +
   breakaway, A = two of them, B = fewer. The terminal draws it on 1m charts (NDOG + CE, initial BSL/SSL,
   SD levels, wick CE).

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
| Usage statistics | The terminal posts `/api/v1/track` {kind: terminal_open} once and terminal_minute every 60 s while visible; the website (`site.js`, `guide.js`) posts kind site with page + referrer. Counted per day in ict.db `usage_counts` / `usage_unique` (visitor = daily hash of address + browser, nothing personal stored, 20 s de-dupe). Admin > Statistics (`accounts/stats.py`, `/admin/stats/`) shows them with users, logins, subscriptions, payments, donations, ads, alerts, community and EAs (7 / 30 / 90 days) |
| Auth | Log in, create account, password reset by code (same token keys as before, so users stay logged in) |
| Trading tools | Paper trading (Trade tab, one-click buy / sell on the chart, draggable SL / TP lines; a position without SL or TP shows a dashed "＋SL / ＋TP drag me" line 3 average bars away, dragging it sets it; server `/api/v1/paper*`), strategy tester (`/api/v1/backtest`, one model, 30 / 60 / 90 days, equity curve), screener, economic calendar and news tabs, pop-out chart window (`?popout=1`) |
| ICT Script | Your own indicators in a small formula language (`src/chart/script.ts`): series variables, `x[n]` history, sma / ema / rma / wma / rsi / atr / highest / lowest / stdev / change / abs / max / min, up to 6 `plot()` lines, `@pane`. Parsed and evaluated by the terminal (no JavaScript eval); saved in the layout as `scripts`; Indicators dialog > My scripts |
| ICT event alerts | Alerts tab > ICT event: MSS, BOS, new FVG or liquidity sweep on a symbol + interval (1m-4H), either or one direction. Checked every 30 s from `/api/v1/ict/overlays`; fires on every new event (the alert keeps `ict.seen`), plan with ICT indicators only |
| Server-side alerts | `api/ictapi/alert_watch.py` (thread in the API, `ICT_ALERT_WATCH=off` stops it). Every 15 s it reads the autosave layout of each user the admin panel lists (`internal/alerts/users`: active plan + a channel), checks price / line / zone alerts on 1m candles (last 10 min), session starts, and ICT events every 60 s; delivery through `internal/alerts/send` to WhatsApp (template `ict_alert`, 1 variable), Telegram (bot, Connect Telegram link), email, webhook (public https only). Fired alerts go to `alert_fired`; the terminal pulls `/api/v1/alerts/fired` every 30 s, switches those alerts off and logs them. Restart sets `armedAt` so the server watches it again |
| Indicator templates | Indicators > Templates: save the indicators on a chart (with settings / pane) under a name, apply (replace) or Add to any chart. Saved in the layout (`indTemplates`) so every device has them |
| Drawing settings (TradingView) | Double-click a drawing. **Fib tools** (`chart/fib.ts`: retracement, ICT, extension, channel, time zones, speed fan, circles, arcs, wedge): levels table (on / value / colour, add / remove / reset, TradingView's 24 default levels), trend line (on, colour, width, style), levels line width / style, one colour, background bands with opacity, extend left / right, reverse, prices, levels as values or percents, label position (left / center / right, top / middle / bottom), font size. **Trend line / ray / extended line** (`chart/lines.ts`, replace klinecharts' own): solid / dashed / dotted, extend left / right, arrow ends, middle point, price labels, stats (change, %, bars, time), text with colour / size / bold / italic / position. **Rectangle**: border, background on / off with colour and opacity, extend left / right, middle line, text. Circle / triangle: background. Templates keep all of these (`cleanLook`) |
| Drawing style templates | Drawing settings > Template: save a tool's look (every Style / Text setting) under a name, apply it to another drawing of that tool, or Use as default for new drawings (`drawTemplates`, `drawDefaults`; new drawings read `drawDefault(tool)` in registry.ts) |
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
| MT5 / Auto-trade tab | Auto-trading ON / OFF and lot multiplier (`copy/settings`), EA token (`copy/token`, shown once), EA files (`/api/v1/ea/download/ICT_Bridge.mq5`, `ICT_Json.mqh`) and install steps. EA 1.11 sends equity, open positions and pending orders with every poll; `/api/v1/mt5/state` returns them (table `ea_state`) with the EA trade log. Positions are listed with P/L and drawn as entry / SL / TP lines on charts of the same symbol (broker suffixes removed). **Auto-trading settings** (`Mt5Settings.tsx`, saved in `EaConnection.filters` via `copy/settings` {filters}): models (of the admin-approved ones), symbols, grade (all / A / A+), daily bias, direction, sessions (New York hours: asia 18-02, london 02-07, ny_am 07-12, ny_pm 12-18), week days, trades a day, risk %, max open, daily loss %. `/api/v1/ea/feed` applies them (`_user_pairs`, `_filter_steps`, `_day_cap`) and sends `user_risk_percent` / `user_max_open` / `user_max_daily_loss` (EA 1.12 uses them instead of its inputs). `POST /api/v1/mt5/preview` {approved, filters, days} shows the filter funnel of the last 7 days. "Take a tour" (`ui/Tour.tsx`, targets `data-tour="mt5-*"`) and the website guide `/auto-trading.html` |
| Time and drawings sync | Layout menu > Sync: Time (the active chart leads; the others scroll so the same time is at their right edge, `ict:timesync`) and Drawings (same symbol: a drawing is copied to every chart of that symbol and stays linked by `extendData.syncId`; moving, restyling and deleting follow; `syncDrawing` in registry.ts) |
| Live bars (WebSocket) | One socket `/ws/stream` for all charts (chart/stream.ts): hello `{auth, device}` then `{sub: [...]}`; every second the newest two bars of each subscription (changed, or again every 4 s). The web server (serve_web.py, port 3100) passes `/ws/stream` to the API. A chart whose stream is quiet for 6 s polls as before; grouped intervals (7m, monthly) always poll |
| Model indicator settings | ICT menu > a model's ⚙ (when it is on): grades it draws (all / A and A+ / A+), target lines on / off, reward in R on the label, box colour. Saved per chart (`modelSet`) |
| All-Models scanner | Screener > All-models scanner: every model's setups today on every watched symbol, A+ / A filter, with or against the daily bias; a click opens the symbol with that model on |
| Drawing tools 4 (chart/tools4.ts) | Fib spiral / arcs / wedge, polyline, double curve, highlighter, S/R zone, anchored text, comment, ghost feed, and ICT: session range box (finds high / low / 50%), Silver Bullet windows, Judas swing marker. Object tree: rename, groups (hide / lock / delete together), clone |
| Indicators 3 + copies | Linear regression curve, Envelope, Auto S/R levels (swing pivots clustered by ATR, strongest first), Standard deviation, Price oscillator (PPO), Correlation with the first compared symbol. '+ Copy' adds another instance of an indicator with its own settings (`EMA#2`: same indicator, its own id; `baseIndicator()` in constants.ts) |
| Indicator condition alerts | Alerts tab > Indicator condition: RSI, Stoch RSI %K (level), price vs EMA / SMA, MACD vs signal; crossing / above / below on the last closed bar of 1m-4H; once or every bar. Checked in the terminal (chart/indalert.ts, every 30 s) and on the server (`ind_hit` in alert_watch.py, every 60 s) so they reach the phone too |
| Google / Facebook login | Buttons on the login screen when the admin panel has the keys and the switch on (`app-config` login.google / facebook). The sign-in runs in a new tab: `/api/v1/oauth/<provider>/start?session=...` (the API passes start / callback / finish pages to the panel, redirects included), the terminal polls `oauth/poll` with its secret session and gets the token once. Setup: GOOGLE_CLIENT_ID / SECRET (or FACEBOOK_APP_ID / SECRET) in admin_panel/.env, redirect URI `https://ictapi.iccterminal.trade/api/v1/oauth/<provider>/callback`, Settings > allow Google / Facebook login |
| Urdu interface | Settings (gear) > Language: English / اردو (kept on the device). src/i18n.ts swaps the interface's words (text, title, placeholder, aria-label) for Urdu from its list as they appear (MutationObserver) and puts the English back; prices, symbols and chart data are untouched. Add a string by adding it to `UR` |
| Volume profiles | Visible range (VPVR), Session Volume Profile `SVP` (Asia / London / New York or per day, POC + value area) and the Fixed range volume profile drawing (POC, VAH, VAL) - `src/chart/volprofile.ts` |
| Price scale | Right-click the price scale: Auto (fit), Lock range, Lock price / bar, Regular / Log / Percent, Invert, scale left / right. The lock is saved with the chart (`scaleLock`, a KLineChart `createRange`) |
| Layouts | 1-8 charts (1, 2 side / stacked, 3, 4, 5, 6, 7, 8); the plan's "Charts per layout" (admin, 1-8) limits them; tablets in portrait show 5-8 charts in two columns, phones 2 x 4; indicator panes size to the chart |
| Chart types | Candles, hollow, Heikin Ashi, bars, line, area, Renko, line break, range bars, baseline, columns (`src/chart/charttypes.ts`) |
| Indicator panes | Price-based indicators (MA, EMA, BOLL, VWAP, price scripts) move into a pane of their own and back; oscillator panes move up / down |
| Watchlist columns | List menu > Columns: Chg, Chg%, today's High, Low, Volume and a day-range bar (`/api/v1/quotes` returns high / low / volume) |
| Templates | Top bar Templates: shared chart setups; the default one greets new users; admins save / set default (`/api/v1/templates`, `maketemplate.bat`) |
| Other | Clock in the top bar (chart time zone, today's UTC offset; click = Chart settings), time-zone list shows the current offset (New York UTC-4 in summer, UTC-5 in winter), dark / light theme, keyboard shortcuts (letters = symbol search, digits = interval, Alt+T/H/J/V/F/R tools, Alt+A alert, Alt+S screenshot, Ctrl+Z/Y, Del, Esc), screenshot, full screen, phone layout (tool sheets, bottom tab bar, bottom sheets, one chart at a time with chips) |

Not built yet (plan items): nothing in the terminal plan; toast messages and long help texts are English only.


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
