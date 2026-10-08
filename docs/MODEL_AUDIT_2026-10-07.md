# ICT models and indicators audit (7 Oct 2026)

Data: Axi MT5 1-minute bars, 1 Jun - 30 Sep 2026. Signals counted from 1 Jul (June is warm-up).
Symbols: NAS100, XAUUSD, US500. Each model ran with its default settings (daily bias filter on where
the model uses it). The backtest uses `ictengine.backtest.simulator`: next-bar fills, stop first when
stop and target are in one bar, the symbol's spread paid on entry.

## 1. Look-ahead (does a model or indicator use bars from the future?)

- **Indicators:** none found. FVG / IFVG, order blocks / breakers, swings, market structure, liquidity
  pools, rejection blocks, volume imbalances and BPRs were computed on all the data and again on data
  cut at three times per symbol, on 1m, 5m, 15m, 1h, 4h and 1d. 96 checks, 0 differences. The first
  run showed 6 differences; all were on the unfinished last 4h / 1d candle at the cut time, which is
  expected.
- **Models:** each model was run again on data cut right after two of its own signals. 64 of 65 samples
  gave the identical signal. The one exception (M5, NAS100, 16 Aug) is identical when the cut data has
  80 days of history instead of 40. That is a history-length effect, not look-ahead (see 3).

## 2. Rule checks on every signal

Stop on the correct side of the entry, every target beyond the entry, expiry after creation,
non-zero risk, position fractions summing to 1, no duplicate signal on the same bar:
**0 problems in 927 signals.**

## 3. Findings and fixes

| # | Finding | Status |
|---|---------|--------|
| 1 | **M13 Opening Range Gap** did not use its own targets. The rulebook says "target the gap's CE, then the full fill", but the targets came from the general liquidity ladder. | **Fixed**: TP1 = ORG CE, TP2 = full fill (previous 16:15 close); minimum 1.5R to the fill. |
| 2 | The live runner reads 40 days of 1m history. M5 takes its targets from 4h / 1d swing liquidity, and older swings are missing with 40 days. On XAUUSD, 4 of 9 M5 signals of the last 10 days were not produced live. No other model was affected. 120 days would make a runner pass about 3 times slower on the VPS. | **Fixed**: the runner reads 120 days (month files are cached) and passes the older part as `Context(history=...)`: the 15m / 1h / 4h / 1d analyses and the daily levels (IPDA, bias) use it, the 1m / 5m work stays on 40 days. The cause was old unfilled 15m FVGs used as M5 entries. Check on Sep 2026 cut points: XAUUSD 22 differing M5 signals -> 0, NAS100 1 -> 0; a pass is ~10% slower. |
| 3 | **M15 London protraction**: 0 signals in 3 months. 26 of 73 NAS100 days pass the small-CBDR / Asian-range rule, but no bias-direction raid -> MSS -> FVG formed 00:00-05:00 on those days. Without the bias filter it gives 6. | Not a bug; the model is very strict. Kept. |
| 4 | **M16 SMT** needs the partner symbol (XAGUSD for gold, US500 for NAS100). The runner passes it; the API's on-demand scan (`source=scan`) does not, so M16 is empty there. | **Fixed**: the on-demand scan and the strategy tester load the partner when M16 is asked for; the runner also pairs US500 -> NAS100 and XAGUSD -> XAUUSD. |
| 5 | **M17 Wolf** gives about 2 setups a day on NAS100 / US500 (one per direction allowed, as in the journal). A grade is the common grade; the A+ grade is rare (needs NDOG over 20 handles and a breakaway). | Kept as the PDF says. Results below. |
| 6 | **M11 IFVG** is the weakest model: many signals and clearly negative on all three symbols. | **Done**: M11 is off by default (`default_on=False`): it stays selectable, but the Signals tab and WhatsApp alerts leave it out until the user picks it. |

## 4. Backtest, 1 Jul - 30 Sep 2026 (R = multiples of the risk)

| Model | Source | NAS100 (filled / win % / total R) | XAUUSD | US500 |
|-------|--------|-------------------|--------|-------|
| M1 Silver Bullet | PDF | 5 / 40% / +0.6 | 4 / 25% / -1.2 | 4 / 50% / 0.0 |
| M2 2022 Mentorship | WEB | 8 / 12% / -6.6 | 13 / 31% / +0.3 | 12 / 33% / -5.7 |
| M3 Judas / Turtle Soup | PDF | 1 / 0% / -1.0 | 3 / 0% / -3.3 | 1 / 0% / -1.1 |
| M4 OTE | PDF | 8 / 12% / -4.5 | 5 / 20% / -1.7 | 8 / 12% / -6.8 |
| M5 Asian Q2 Judas | PDF | 15 / 47% / +7.0 | 15 / 27% / +0.2 | 7 / 57% / +4.5 |
| M6 Asian range scalp | PDF | 1 / 0% / -1.1 | 2 / 0% / -2.2 | 0 |
| M7 Unicorn | WEB | 5 / 20% / -2.3 | 5 / 40% / +3.7 | 5 / 20% / -3.8 |
| M9 Market Maker | WEB | 1 / 100% / +1.2 | 0 | 1 / 100% / +1.9 |
| M11 IFVG reversal | WEB | 52 / 29% / -14.1 | 45 / 36% / -2.3 | 64 / 28% / -27.5 |
| M12 Breaker | WEB | 45 / 40% / -1.6 | 39 / 36% / -2.1 | 57 / 46% / +3.0 |
| M13 ORG (new targets) | WEB | 14 / 29% / -0.8 | indices only | 14 / 29% / +9.1 |
| M14 London close | WEB | 1 / 0% / -1.1 | 1 / 0% / -1.1 | 0 |
| M15 London protraction | WEB | 0 | 0 | 0 |
| M16 SMT (with partner) | WEB | 3 / 0% / -3.2 | 0 | 3 / 0% / -3.5 |
| M17 Wolf Asia (NDOG) | WOLF | 93 / 35% / +4.5 | NQ / ES / FX only | 84 / 40% / -10.4 |

Three months is a small sample for most models (fewer than 20 trades): these numbers say "no proven
edge yet", not "broken". Models with more trades: M5 positive on all three symbols; M12 about break-even;
M11 negative; M17 mixed (positive on NAS100, negative on US500).

## 6. New models (2026-10-07)

| Model | Rules | Jul - Sep 2026 (any bias: signals / filled / total R) |
|-------|-------|------------------------------------------------------|
| **M8 Power of 3 (AMD)** | Asia accumulates (Asian range at most half the 20-day ADR); 01:00-05:00 or 08:30-11:00 NY a raid of the Asian range against the bias, then a bias-direction MSS + FVG; buy below / sell above the midnight open. | NAS100 7 / 4 / -1.4R; XAUUSD 6 / 5 / -5.7R; US500 8 / 8 / -7.5R. With the bias filter: 1 signal per symbol. |
| **M10 News aftermath** | NFP / FOMC: skip the 15-minute shock window; the release leg must move at least 15% of the ADR; entry at the CE of the 5m FVG the leg left (the nearest one that still pays 1.5R), stop beyond the leg's origin, targets the move's extreme then the 1.618 extension. FOMC is traded at the Asian open (20:00 NY). | NAS100 1 / 1 / -1.0R; XAUUSD 3 / 2 / +0.5R; US500 2 / 2 / +0.9R. |

Both are small samples: no edge is claimed. M10 only knows FOMC and NFP history (CPI dates are not in the
history list), so it trades at most two or three events a month.

## 5. How to repeat

The audit scripts are short Python scripts run against `data/mt5/axi/<SYMBOL>/*.pkl`; see
`engine/scripts/backtest.py` for the full backtest (per model, with and without the bias filter).


## M17 rebuilt from the PDF (2026-10-08)

The user asked to delete M17 and build it again exactly as the PDF, with nothing added. Removed: the 22:30
time exit, the 1R minimum (and the leg rule tied to it), the daily bias, the minimum FVG size, the 10-bar FVG
delay, the 90-bar look-back, spread on the stop, and "20 handles = 10 x min FVG" (now 20 points / pips as the
PDF says). The last opposite leg now runs from the highest high since the previous lower low to the low, which
gives the PDF's own example exactly (0 = 18,565.75, 1 = 18,534, -1 SD = 18,597.50 as on page 2).

Axi 1m, last 14 months, spread charged:

| | Signals | Win rate | Total R | Profit factor |
|---|---|---|---|---|
| NAS100 old | 604 | 32.2% | -68.9 | 0.78 |
| NAS100 PDF | 605 | 29.1% | -46.1 | 0.87 |
| US500 old | 600 | 34.4% | -103.4 | 0.66 |
| US500 PDF | 603 | 30.8% | -139.7 | 0.64 |

Neither version has an edge on this data; most PDF signals grade B (the NDOG is rarely over 20 handles).
