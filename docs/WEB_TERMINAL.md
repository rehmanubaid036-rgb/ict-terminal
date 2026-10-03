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
   (`raid_timeframes=()`); the final target is the previous session's 15:30-16:00 NY high (buy) / low
   (sell), with 1 / 1.25 SD partials before it (SD targets only when that level is behind the entry or
   nearer than 1R). Checked on Dukascopy NAS100 1m, 15 Jul - 29 Aug 2024: 18 filled trades, 38.9% wins,
   +0.8R, PF 1.07 (small sample). Against the PDF journal (18-26 Aug) it takes the 18-08 short, no trade
   on 19-08, the 20-08 long and a late 25-08 long; the journal is partly discretionary.

The admin panel, EA and database did not change.

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
| Other | Dark / light theme, keyboard shortcuts (letters = symbol search, digits = interval, Alt+T/H/J/V/F/R tools, Alt+A alert, Alt+S screenshot, Ctrl+Z/Y, Del, Esc), screenshot, full screen, phone layout (tool sheets, bottom tab bar, bottom sheets, one chart at a time with chips) |

Not built yet (plan items): MT5 positions/orders panel and trade panel (no read API for EA data),
economic calendar / news panel, indicator templates, popout windows, Urdu UI language,
WebSocket streaming (the API has no `/ws`; the terminal polls), patterns/Gann/pitchfork tools,
server-side alerts (alerts only fire while the terminal is open).

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
