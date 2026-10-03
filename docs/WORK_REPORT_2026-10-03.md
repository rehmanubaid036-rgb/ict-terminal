# ICT Terminal - Work Report (2-3 Oct 2026)

Written at the end of the Claude Code cloud session of 2-3 Oct 2026 for the owner and for the next Claude Code session. Repository: rehmanubaid036-rgb/ict-terminal (branch main). Everything below is committed and pushed; the VPS was pulled and restarted at about 05:05 UTC on 3 Oct and checked online.


## Khulasa (Roman Urdu)

- Website naya design, phone friendly. Web terminal naye sire se bana (React + TypeScript + KLineChart 10), TradingView jaisa, computer / tablet / phone teeno par test.
- Terminal: Log out button, 'Continue as guest' (admin panel se features on/off), Signals tab ki selection layout ke saath save, har setup par TP lines.
- Models: M1 Silver Bullet aur baqi models plan PDF ke rulebook ke mutabiq; M5 naye sire se; sirf M9 ka poora 'stages' version baqi (rulebook ka Phase 2).
- Naya model M17 Wolf Asia Session (NDOG) aap ki PDF se; abhi PDF wale targets (-1 / -1.25 / -1.5 SD), SD 0 = MSS ka swing.
- EA 1.10 (partial close + trailing) GitHub par hai - abhi compile / test nahi hua.
- Bugs theek: weekend par MT5 time 7 ghante khisakna, purane signals ka database mein reh jana, AI assistant ka crash.
- Backtest (NAS100 16 mahine): sirf M1 bias ke saath plus mein (+7.9R, 21 trades). Baqi models ghate mein - koi bhi model abhi auto-trading ke liye approve na karein.


## 1. Where things run

- Windows VPS, folder C:\ICT engine. Website + terminal: https://ict.iccterminal.trade (terminal at /terminal/). API: ictapi.iccterminal.trade (127.0.0.1:8100). Admin panel: ictadmin.iccterminal.trade (127.0.0.1:8101).
- ICC Terminal runs on the same VPS and was never touched.
- Deploy after a push (owner runs on the VPS, mobile RDP - keep commands short): cd "C:\ICT engine" ; .\ictoneclickclose.bat ; git pull ; .\oneclickict.bat. oneclickict backs up the database and runs Django migrations.
- Health check: vpscheckict.bat (or .\.venv\Scripts\python.exe deploy\vpscheck_ict.py), report in deploy\vpscheck_ict_report.txt - the owner can commit and push it for Claude to read.
- This cloud environment cannot reach the VPS (network policy blocks its IP; SSH on port 22 exists). To let Claude restart / check the VPS directly, add the VPS IP under the environment's Network access > Allowed domains.


## 2. Website and web terminal


### Website (web/site)

- New professional design (hero, markets strip, features, showcase, pricing from /api/v1/plans, FAQ, phone menu).
- CSS/JS links carry ?v=N because Cloudflare caches CSS/JS for 4 hours; bump N after editing style.css / site.js.


### Web terminal (web/terminal) - rebuilt from source

- React 19 + TypeScript + Vite 7 + KLineChart 10.0.3. npm ci && npm run build writes web/terminal/dist (committed, served by web/serve_web.py). The old bundle-only terminal is gone. Full feature list and test approach: docs/WEB_TERMINAL.md.
- Chart: all intervals incl. custom, Heikin Ashi, log/percent scale, 14 ICT layers, 30 indicators, 29 drawing tools (a Vite patch fixes KLineChart dropping quick second clicks), multi-chart layouts 1-8 with sync, replay, alerts, journal, AI assistant, account / payments dialog, dark / light, phone layout.
- This session added: Log out in the account dialog; phone fixes (bottom panels open on the first tap, account button pinned on every narrow screen, account dialog tables scroll inside their cards); side panel starts closed below 1100 px; 'Continue as guest'; TP lines with labels on every setup box; M17 levels on 1m charts; selecting an old signal scrolls back until it is loaded; journal applies the rulebook cancel rule and breakeven + spread; Signals tab choices saved with the layout (models, period, grade, bias, notify; buttons All / None / Draw on chart).
- Tested with Playwright against the real API on synthetic data: desktop 1440x900 52 checks, phone 390x844 42 checks pass; 11 screen sizes (320 px phone to 1920 desktop, phone landscape, tablets) checked for overflow.


## 3. Admin panel

- Login as guest (migration 0003_guest_login): Settings > 'Login as guest (web terminal)' on/off and 'Guest features' (a plan). The migration creates a hidden plan 'Guest' with every terminal feature on (AI 50 / day, no MT5 auto-trading) - edit Plans > Guest to switch features. Each browser gets its own guest account (username guest-..., no email / password). POST auth/guest; app-config login.guest; login events 'guest'. Switching guest login off locks existing guests too.
- 105 Django tests pass (7 new guest tests).


## 4. Engine and models


### Rulebook alignment (plan PDF section 4)

| Model | State | What changed / note |
|---|---|---|
| M1 Silver Bullet | Rulebook | MSS with displacement only; stop 1 tick beyond the sweep wick (+spread for a short); TP1 internal liquidity >= 1R and the symbol's min_target (indices ~10 pts, FX ~15 pips), TP2 next liquidity / opposing FVG CE, TP3 draw on liquidity (>= 2R); Power of 3 +1 |
| All build_signal models | Rulebook | Section 7 confluence score (A+ >= 8, A 6-7, B < 6); premium / discount of the setup's dealing range required; notes cancel_if_close_beyond and be_offset used by the simulator and the terminal journal |
| Bias engine | Changed | Midnight Open filter added as 5th component. Threshold kept at 2 - the rulebook's [DEFAULT] 3 set a bias on only 4 of 60 NAS100 days |
| M2, M7, M11, M12, M16 | Rulebook | Unchanged logic; new grading. M16 needs the partner symbol's data (runner partners) |
| M3 Judas | Rulebook | NY window 08:30-10:00; Power of 3 +1 |
| M4 OTE | Rulebook | Targets -0.5 / -1 / -2 fib extensions |
| M5 Asian Q2 Judas | Rebuilt | models/asian_q2.py: Q1 raid into 15m/1H/4H FVG, entry 15m edge / 1H CE, stop beyond 4H FVG, TP Q2 True Open 50% / Q1 30% / 1H array 20% |
| M6 Asian scalp | Rulebook | NAS100 / US500 window 20:45-22:15 |
| M8 Power of 3 | Rulebook | Score +1 for M1 / M3 |
| M9 Market Maker | OPEN | Still the simplified model (PDL/PWL raid + 1H MSS). Rulebook's staged model = Phase 2 |
| M10 News / FOMC | Rulebook | News blackouts; FOMC days: exit and expiry moved to 13:55 (news.fomc_flat, runner) |
| M13 ORG | Fixed | Runs on NAS100 / US30 / US500 only |
| M14 London close | Rulebook | Only after the morning's draw on liquidity was hit; trades against that move |
| M15 Protraction | Rulebook | Targets CBDR (else Asian range) SD -2 / -3 / -4 |


### M17 Wolf Asia Session (NDOG) - from the owner's PDF (TheWolfTrades)

- File: engine/ictengine/models/wolf_asia.py. NAS100, US500, EURUSD, GBPUSD; 1-minute chart only (terminal draws it on 1m charts, selecting a signal switches to 1m).
- Rules: NDOG (17:00 close -> 18:00 open) and its CE (significant at 10 x min FVG, 20 pts on NAS100); initial BSL/SSL = 18:00-19:00 high/low; trades 19:00-21:00 NY; raid of initial or session liquidity, MSS after 19:00, FVG CE entry; stop at the CE of the extreme candle's wick (NDOG CE when significant and nearer).
- Targets now (owner's choice, PDF 'How to set target?'): SD 0 = the swing the MSS broke, SD 1 = raid extreme; TP1 -1 SD (50%), TP2 -1.25 SD (25%), TP3 -1.5 SD (25%). The previous session's 15:30-16:00 high / low is drawn for reference only.
- History of target experiments in this session (all reverted): 15:30-16:00 as final TP, 1R ladder, doubling 2R/4R/8R, fib 1/1.5/2/2.5 with stop at fib 0. The config still has target_mode / leg_start switches.
- Owner's management idea (not implemented): no partial closes, full position, trailing starts at +1.5R. 90-day test: trailing from 1.5R + exit next day 11:00 = +3.1 to +3.6R, PF ~1.25 on 23 trades; starting at 2R or 3R was worse.


### Engine fixes

- Runner prunes stored signals the models no longer produce (store.prune_signals) - the terminal kept showing old targets.
- MT5 clock offset (data/mt5.py server_minus_ny): a Saturday restart read EURUSD's Friday tick as offset 0 and moved CFD candles +7h. Now the freshest tick of BTCUSD/EURUSD/XAUUSD/GBPUSD, within 2 minutes of a whole hour, and at weekends only BTC/ETH count; else NY+7.
- AI assistant crashed (HTTP 500) on the new 'mo_zone' bias component - fixed (assistant.COMPONENT_NAMES).
- SymbolSpec.min_target added (rulebook min target; gold/silver/BTC values are [DEFAULT] guesses).


## 5. ICT Bridge EA 1.10 (ea/mt5/ICT_Bridge.mq5)

- InpExitMode Partial (default): one position, the EA closes each target's share (signal split or InpPartials e.g. 50,20,15,15), final target = broker TP, up to 6 targets. Legs = old behaviour (max 3).
- InpBreakevenAtTP1; trailing after InpTrailStartR (1R) keeps InpTrailLockPct (50%) of the best profit, forward only, steps >= 0.1R. Managed every second.
- State file stays compatible with 1.00 rows. NOT COMPILED (MetaEditor only on the VPS) and NOT TESTED - compile, then test on a demo account. The owner wants trailing from 1.5R and percentage-based management designed later.


## 6. Backtests (Dukascopy 1m, spread 1.5 pts)

NAS100, Oct 2023 - Dec 2024 (16 months, 386 of 418 days downloaded), all models after the rulebook changes. 'Bias' = only setups with the daily bias.

| Model | Bias: trades / win / total | All: trades / win / total |
|---|---|---|
| M1 | 21 / 33% / +7.9R (PF 1.61) | 59 / 31% / -7.3R |
| M2 | 55 / 22% / -19.9R | 105 / 30% / -23.1R |
| M3 | 8 / 25% / -3.7R | 54 / 20% / -28.8R |
| M4 | 48 / 23% / -16.1R | 122 / 27% / -26.4R |
| M5 | 3 / 0% / -3.6R | 36 / 39% / -9.8R |
| M6 | 1 / 0% / -1.2R | 15 / 27% / -7.4R |
| M7 | 28 / 25% / -11.5R | 62 / 32% / -28.5R |
| M9 | 2 / 0% / -2.0R | 7 / 43% / +3.4R |
| M11 | 235 / 29% / -73.5R | 513 / 32% / -140.3R |
| M12 | 219 / 36% / -47.8R | 481 / 36% / -83.5R |
| M13 | 49 / 27% / -5.8R | 49 / 27% / -5.8R |
| M14 | 3 / 33% / +0.1R | 3 / 33% / +0.1R |
| M15 | 0 | 13 / 8% / -8.1R |
| M16 | 0 (no partner data) | 0 |
| M17 (fib version) | 10 / 20% / -6.3R | 93 / 34% / -39.2R |

- M17 current setting (PDF SD targets, SD 0 = MSS swing), NAS100 Oct-Dec 2024: 10 setups, 7 filled, 57% wins, -0.1R; TP1 median 16 pts (1.7R).
- An M17 feature study (230 trades, 15 features, in-sample Oct 2023-Jun 2024 vs out-of-sample Jul-Dec 2024) found no filter that was positive in both halves - no robust edge yet.
- Conclusion: only M1 with bias is positive, on a small sample. Do not approve any model for auto-trading yet (Settings > Models approved for auto-trading).


## 7. Open items / next steps

| # | Item | Note |
|---|---|---|
| 1 | Live test - DONE | Claude tested the live site as a guest after the restart: desktop 52/52, phone 41/41, AI, Signals saving, M17 targets OK - see docs/LIVE_TEST_2026-10-03.md. Still to see: M17 / M1 setups after Sunday's open; a real customer login |
| 2 | EA 1.10 | Compile in MetaEditor, demo test; later redesign for trailing from 1.5R / percentage management |
| 3 | M1 robustness | Backtest M1 on XAUUSD and US500 (16 months); journal's main model was on gold |
| 4 | M9 staged model | Rulebook Phase 2 - the only model not complete |
| 5 | M17 | Decide management (trailing from 1.5R, exit next day 11:00 tested best); entry 'wick of down candle' from the PDF not implemented (FVG CE used) |
| 6 | Defaults to tune | Bias threshold (2 vs rulebook 3), min_target and stop buffers for gold / silver / BTC |
| 7 | M11 / M12 | Many losing signals - consider off by default in the terminal |
| 8 | VPS access | Allow the VPS IP in this environment's network settings so Claude can deploy and check by itself |
| 9 | RAM | VPS has ~1.2-1.4 GB free of 4.2 GB; the plan recommends 16 GB |


## 8. Commits of this session (oldest first)

```
d8e0936 Add CLAUDE.md with VPS and repo notes
74fb694 Redesign website and make web terminal phone friendly
8858016 Pricing: highlight VIP plans only when not every plan is VIP
1058a2d Version CSS/JS links so Cloudflare's 4-hour cache serves updates at once
a2be8bc Terminal on phones: smaller volume pane, one chart at a time with chips, compact bias panel
97a2171 Web terminal source (work in progress, not live yet) + forward crypto order routes
17065b4 Web terminal (WIP): cancel stale requests, Escape closes menus during drawing, legend, phone tool sheets
676c03d Web terminal (WIP): fix klinecharts dropping quick second clicks, plan alert cap, login fallback
dda7332 Ship the rebuilt web terminal (React + TypeScript + KLineChart 10)
35601cd Terminal: Log out button in the account dialog
480f26c Terminal (phone): bottom panels open on the first tap, account button always visible
783d624 New model M17 Wolf Asia Session (NDOG); account dialog fits phones
a0eb265 Terminal: top bar scrolls on any narrow screen with the account button pinned
773036b M17 Wolf: stop at the wick CE, 1-minute chart only, model levels drawn on the chart
1140e31 Login as guest: 'Continue as guest' in the web terminal, features set in the admin panel
d461144 .. ddbdafa  M17 target experiments (see section 4)
677702f ICT Bridge EA 1.10: partial closing and a percentage trailing stop
308d197 M1 Silver Bullet to the rulebook; shared rulebook grading, invalidation and breakeven
3cdfd6f M5 Asian Q2 Judas rebuilt to the rulebook
b961c88 Models to the rulebook: M3, M4, M6, M8, M10, M14, M15
307073b Runner: remove stored signals the models no longer produce
b9b950f M17 Wolf: back to the earlier setting with the PDF's targets (-1 / -1.25 / -1.5 SD)
758cede MT5 clock offset: never read a closed market's stale tick as the offset
6513442 M17 Wolf: SD 0 at the swing the MSS broke, as in the PDF
02af3a1 Signals tab choices saved with the layout; M13 on indices only
30e0624 Fix the AI assistant after the Midnight Open bias component
-       Live test report (docs/LIVE_TEST_2026-10-03.md) and this work report
```


## 9. How the next Claude session should start

- Read CLAUDE.md, docs/WEB_TERMINAL.md and this report. Rules: never print or commit VPS credentials or secrets; never touch ICC Terminal; short PowerShell commands for the owner; the owner writes Roman Urdu / English.
- Local testing without the VPS: build the real API with a FrameProvider of synthetic or Dukascopy data (engine/ictengine/data/dukascopy.py downloads 1m history), a stub AuthClient and require_auth=False, run ictengine.runner.run_once, serve web/serve_web.create_app on 3100, drive it with Playwright (Chromium at /opt/pw-browsers). Details in docs/WEB_TERMINAL.md.
- After any engine change the VPS needs ictoneclickclose + git pull + oneclickict; website / terminal-only changes need just git pull.
