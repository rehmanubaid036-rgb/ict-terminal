# VSISA — Volume Spread Imbalance Shift Analysis: the logic for the VSA Models

Source: Sajid Ahmed's course "Volume Spread Imbalance Shift Analysis VSISA", 22 YouTube parts (playlist
PLe-mEHQPIWTaPQWjCTN2pf02tDPqMS_0q), and the user's own annotated screenshots of parts 1-9
(`E:/E/for zaif printing/`). Every rule carries its source: **[Pn mm:ss]** = video part n at that time (see
`NOTES_raw.md` and `transcripts/`), **[SS Bxx/Sxx/Nxx]** = the user's screenshot, **[DEFAULT]** = the course gives
no number, so a starting value is set here and tuned by backtest.

These are NOT ICT models. They live in the terminal under Custom Models > **VSA Models** (ids M20+; M19 is the
user's own EA and stays as it is).

## Khulasa (Roman Urdu)

- Volume hamesha **relative** hai: bar ka volume pichhle bars aur pichhle 2-3 din ke usi session ke volume se
  compare hota hai.
- Bada volume akela kuch nahi batata: 50 % buying, 50 % selling. **Agli candle (reaction)** faisla karti hai.
- **Imbalance shift** = bade volume ke baad agli candle ulti taraf **kam volume** par band ho. Jitna kam volume
  aur jitna mazboot close, utna strong setup.
- Entry reaction candle ke close par; stop bade-volume candle ke low/high se thora neeche/upar (gold 20-40 pips,
  forex 2-5 pips); kam se kam 1:2.
- Behtareen setup trend ki direction mein; forex mein currency strength (CSM) bhi align honi chahiye.

---

## 0. Measurements

### 0.1 Bars
| Term | Definition | Source |
|---|---|---|
| Up bar / down bar | close > open / close < open | [P1 00:04] |
| Spread | high − low of the bar | [P3 00:02] |
| Small spread | range < 0.7 × mean range of the last 20 bars [DEFAULT] | [P6 03:43], [P9 01:57], [P13 00:33] |
| Pin bar (down / hammer) | lower wick ≥ 50 % of the range | [SS B02, B03, N03] "wick half of the body" |
| Pin bar (up / upthrust) | upper wick ≥ 50 % of the range | [P8 04:07], [P17 06:49] |
| Close location | (close − low) / range; closing "on the lows" = < 0.25 [DEFAULT] | [P13 07:28], [P14 03:16] |
| Engulf | the reaction bar's body covers the whole body of the bar before it; "full engulf" also covers its wick | [SS B04], [P14 02:26], [P17 01:12] |

### 0.2 Volume (always relative)
- Compare a bar's volume with the bars just before it AND with the same session on the previous 2-3 days; a bar
  that is big only because London opened is not big. [P1 02:53-03:40], [P4 04:55], [P11 02:51], [P13 03:21]
- Do not read the indicator's colour bands blindly; compare the numbers. [P13 03:21]
- Classes (the "VSA Relative Volume" indicator the course uses): **LOW** (pink, below average), **AVERAGE**,
  **HIGH** (above average only), **VERY HIGH**, **ULTRA** (top band). [SS B04 "only high volume above the
  average"], [SS B03, N01] Thresholds on rel = volume / reference: LOW < 0.8, HIGH ≥ 1.3, VERY HIGH ≥ 1.8,
  ULTRA ≥ 2.5 [DEFAULT]. Code: `engine/ictengine/indicators/vsa_volume.py`.
- **Big volume** = HIGH or above AND higher than each of the previous 2 bars. [P4 04:17] "higher than previous 2"
- **Low volume (reaction)** = lower than the big bar's volume and lower than the previous bar(s); strongest when
  LOW / pink. [SS B02 "lower than previous candle volume"], [SS N01 "lower than previous two bars"], [P4 11:28],
  [P22 06:51] "about 50 % of it"
- "Small bar, big volume" (anomaly) is the strongest single signal. [P9 02:13], [P11 06:08], [P13 00:33]

### 0.3 Timeframes and markets
- The course trades M1 [P21 00:04], M5 [SS B01, N03; P16 00:45], M15 [P21 03:06] and H1 [SS B05; P14 07:16];
  M30 / H1 to confirm. Models run on 5m and 15m by default; 1m and 1h are options.
- Markets: gold, the forex majors and crosses (EUR/USD, GBP/USD, AUD/USD, GBP/JPY, USD/JPY, EUR/JPY, CHF/JPY,
  EUR/GBP), and indices. [P11 03:07], [P21 01:51]

---

## 1. The core reading (the 4 rules)
1. Weakness appears on up bars. [SS all], [P1 00:04]
2. Big volume on an up bar: 50 % aggressive buying / 50 % supply. [P1 01:15]
3. Strength appears on down bars. [SS all]
4. Big volume on a down bar: 50 % aggressive selling / 50 % buying. [P1 09:46]
- **The next bar (the reaction) decides** which one it was. [P1 02:26], [P2 07:41]
- Never buy / sell ON the big-volume bar itself: its buying is not complete. [P4 04:17], [P6 01:57]

### 1.1 Effort vs result
- Same spread, more volume = resistance was in the way (orders had to be absorbed). Same spread, less volume = the
  path was clear: the stronger move. [P3 00:02-06:41], [P4 00:02-01:18]
- "Big volume = big move" is wrong; "rising price + rising volume = bullish" is incomplete: check whether
  weakness (big volume on up bars) already came at the top. [P2 00:32-02:00], [P3 06:44], [P12 05:24]
- Crashes happen on LOW volume; big volume on a falling market is buying. [P11 05:31]

### 1.2 Reading the big-volume bar
- Down bar, big volume, closes OFF its low (lower wick) = buying (demand). Closing ON its low with no lower wick =
  supply still there: wait. [P4 09:47-10:47], [P5 10:42-12:35], [P7 00:20], [P8 05:46]
- Up bar, big volume, small body with an UPPER wick = aggressive selling. [P6 04:24-05:31]
- Big volume with no further progress (bars do not go lower / higher) = absorption. [P8 06:04], [P9 03:28],
  [P13 07:28]

### 1.3 Imbalance and the shift
- The trend does not change until there is an imbalance of demand and supply. [P4 07:39]
- **Imbalance shift (sell → buy)**: big volumes on the way down, then the reaction bar goes UP on LOW volume (the
  sellers / liquidity providers pulled their orders, buyers need little force). The lower the reaction volume,
  the stronger the imbalance and the move. [P4 07:39-11:55], [P8 00:02-01:16], [P10 02:58-04:05]
- If the reaction bar comes on BIG volume (equal to the big bar) there is no imbalance yet: supply hit again,
  no trade, keep waiting. [P4 09:47], [P5 05:29, 07:18-08:17], [P7 03:35]
- Mirror for buy → sell: big volumes on up bars, then the reaction DOWN on LOW volume. [P7 01:27-04:13], [P12]

### 1.4 Areas
- The bars with the big volumes make a buying / selling AREA (support / resistance from volume, not from bare
  highs / lows). The market often returns there; a bullish reaction at the area is a trade with a tight stop
  (3R-8R). [P8 08:43], [P10 07:26-08:57]
- Mark the most recent event. [P8 09:34]

---

## 2. The setups (one VSA Model each)

Entry for every setup: **at the close of the confirming bar** (market order; in the engine a limit at that close,
valid for the next 3 bars [DEFAULT]). [SS N01 "enter after closing of this blue candle"], [SS S01, S02, B04]

Stop for every setup: beyond the extreme of the setup (the big-volume bar / pin bar / test bar, whichever is
further) plus a buffer: gold 20-40 pips ($2-4; default $2.0), forex 2-5 pips (default 2 pips), indices / silver
`spec.stop_buffer` [DEFAULT]. [SS B03, B04, S02], [P5 05:57], [P12 02:36]

Targets: at least 1:2 [P12 09:23]; the course shows 1:3-1:9 [SS S02 "3x to 7x"], [P14 04:30 "1:5.5"],
[P16 04:54 "1:6"], [P17 03:53]. Default: half at 2R, then the stop to breakeven, the rest at 5R [DEFAULT]; the
course also takes partial profit and moves to breakeven once the trade is well in profit [P1 08:05], [P2 10:07].

### V1 — Imbalance Shift (2-bar setup) → model **M20**
BUY:
1. Context: price falling into the bar (the bar's low is the lowest of the last 10 bars [DEFAULT]). [SS B01-B04]
2. Effort bar E (or the last bar of up to 3 consecutive down bars): a DOWN bar with BIG volume (§0.2). [P4 04:34],
   [P5 03:45], [SS B03]
3. Reaction bar R = the very next bar: an UP bar, volume LOW (< E's volume × 0.75 [DEFAULT] and not HIGH), closing
   above E's close. [P4 11:28-11:55], [P5 05:29], [SS B02, N01]
4. No trade when R's volume ≥ E's volume. [P4 09:47], [P5 05:29]
5. Entry at R's close; stop below min(E.low, R.low) − buffer.

Grade (more = stronger): E is ULTRA / VERY HIGH [SS B03, N01]; E is a pin bar or closed off its low [P4 09:47],
[SS B02, B03, N03]; E is the last of 3 down bars with rising volume [SS B03], [P4 04:34]; R is LOW (pink) and lower
than the previous 2 bars [SS N01]; R engulfs E's body [SS B04]; R closes strong (top 25 %) [P15 07:42].
SELL: the mirror (up bars with big volume after a rise, R a down bar on low volume). [SS S01 B], [P7 01:27]

### V2 — Low-Volume Engulf → model **M21**
BUY: E = a DOWN bar with big volume (HIGH+, ideally the session's highest); R = the next bar, an UP bar whose body
ENGULFS E's body, on LOW volume (< E × 0.75 [DEFAULT]). Full engulf (R closes above E's high, covering the wick)
grades higher. Entry at R's close, stop below the lower of the two lows − buffer. [SS B04 "low engulf"],
[SS N01 C], [P17 01:12], [P19 02:04], [P20 03:34], [P22 06:31]
SELL: the mirror; the course's clearest example: an up bar with the day's highest volume, the next bar engulfs its
body and closes ON ITS LOWS on very low volume. [P14 02:02-04:30]

### V3 — End of the Rising / Falling Market (climax) → model **M22**
SELL (end of rising market): after a rise (the bar's high is the highest of the last 10 bars [DEFAULT]) a
SMALL-spread bar (or a doji / a bar with an upper wick ≥ half its body) with VERY HIGH / ULTRA volume (up to 3 such
bars in a row count as one climax [P13]); the confirming bar closes DOWN (a bearish reaction). Entry at that close,
stop above the climax high + buffer. [SS S02, S03], [P6 03:27-05:31], [P9 01:57]
BUY (end of falling market, "bag holding"): the mirror: a small bar with huge volume at a low, the next bar
bullish. [P9 01:57-04:33], [P13 00:02-03:18], [SS N03]
Grade: the following bars on LOW volume [P6 06:39]; a wick showing the failed push [P6 04:24].

### V4 — False Break (sustained selling / buying) → model **M23**
SELL: a previous swing high (resistance, a 5-bar swing [DEFAULT] within the last 60 bars [DEFAULT]) is broken by a
bar with BIG and rising volume; the NEXT bar is a DOWN bar on LOW volume → sell at its close, stop above the new
high + buffer (2-3 pips forex). Repeated supply at the same high = "sustained selling", stronger.
[P12 00:34-06:12], [P15 06:22-06:54], [P17 05:13]
BUY: the mirror: a previous low broken on big volume (often a pin bar with a lower wick = fake break), the next bar
UP on low volume. [P5 09:20-13:46], [SS B01 double bottom]

### V5 — No-Supply / No-Demand Test → model **M24**
BUY: a buying event happened (a V1-type big-volume down bar with a bullish reaction) and price rallied. Within the
next 30 bars [DEFAULT] price comes back down into the buying area (the range of the big-volume bar) on a bar with
LOW volume (lower than the previous bar): either (a) the test bar itself closes UP with a lower wick = strongest,
or (b) it closes down and the NEXT bar closes up. Entry at the up-close, stop below the test low − buffer.
[P9 05:16-05:57], [P10 00:32-01:39], [P11 00:02-02:09]
SELL (no demand after an upthrust): after selling at a top, an upthrust (up pin bar, big volume), then a small up
bar on much lower volume (no demand), the next bar confirms down. [P8 04:00-05:09]

### V6 — AR / AS Line Break (Rule 1) → model **M25**
BUY:
1. Buying event: big-volume down bar(s) then a bullish reaction. [P16 00:45], [P17 01:47]
2. AR (Automatic Rally) = the high of the first rally after the buying (the first swing high after the big-volume
   bar). Draw the line. [P16 01:06], [P17 02:26]
3. Wait for a bar to CLOSE above AR on LOW volume (lower than the average of the previous bars). That bar = entry
   (aggressive), stop below its low − buffer; the conservative stop is below the buying low. [P16 02:40-06:32],
   [P17 02:39-04:01]
4. AR broken on BIG volume with the next bar down = no trade. [P16 07:06], [P17 04:30]
5. Trend option (Rule 1): only in the trend direction, with the buying inside the 50-61.8 % retracement of the
   last swing (fib from the previous swing low to the high). [P16 00:01-00:45], [P17 00:50, 04:01]
SELL: the mirror with AS (Automatic Support = the low of the first reaction after the selling); the AS breaks on a
strong bearish bar closing on its lows on low volume; an upthrust back to the line is a second entry.
[P17 04:58-08:20]
Why: it saves the trades where the reaction after the buying had big volume (V1 skips them) and avoids the dip
that stops V1 out. [P17 04:43, 10:44]

---

## 3. Filters

### 3.1 Trend direction — option on every model, default ON for V6 only
Setups in the trend direction work best; reversals need the AR / AS confirmation. [P2 02:10-03:11],
[P7 04:19], [P17 10:33], [P21 10:42] Trend [DEFAULT]: close above / below the 1h EMA 50 (or the engine's daily
bias when "Only setups with the daily bias" is on).

### 3.2 Currency strength meter (forex only) — option, default OFF until the meter exists
- Trend REVERSAL setup: the two currencies' strengths must be CLOSE (gap ≤ 2 on a 0-7 scale) or moving toward each
  other by the AR / AS break. [P18 04:58-09:56], [P19 02:47], [P20 00:04-02:27], [P22 01:32-05:43]
- Trend DIRECTION setup: the currency you buy must be the STRONGER one; the bigger the gap in your favour, the better.
  [P20 06:54-08:31], [P21 09:50-11:27], [P22 05:57]
- Never sell the strongest currency against the weakest (or the reverse buy); buy the strong one against the
  weakest, sell the weak one against the strongest. [P19 05:44], [P21 04:28-06:35]
- Needs a strength meter from the 7-8 majors (28 pairs); the engine loads only EUR/USD and GBP/USD today. Not for
  gold / indices.

### 3.3 Sessions
No hard filter. The course trades London open and New York, and says Asia gives good trades too; volume is always
compared within its own session. [P2 02:45], [P11 03:17-04:30], [P17 05:08]

---

## 4. What the course says NOT to do
- Do not enter on the big-volume bar; wait for the reaction. [P4 04:17]
- Do not take a setup whose reaction comes on big volume. [P5 07:18]
- Do not trade against a big strength gap (forex). [P18], [P21 00:24]
- Do not read "rising volume + rising price" or "breakout on volume" as bullish without context. [P2], [P12 05:24]
- Take only the taught setups; screenshot and journal them; at least 3 trades per setup to learn it. [P2 12:44],
  [P10 09:36], [P12 00:11]

## 5. Open points (to settle by backtest, not by guessing)
| Item | Default | Why open |
|---|---|---|
| Volume class thresholds | 0.8 / 1.3 / 1.8 / 2.5 | the course reads bands visually |
| Reaction "low volume" | < 0.75 × the effort bar and not HIGH | course says "lower", once "~50 %" |
| Context lookback | 10 bars | "after a fall / rise" |
| Stop buffer gold | $2.0 (20 pips) | course 20-40 pips, once 40-50 |
| Targets | 50 % at 2R → breakeven, 50 % at 5R | course shows 1:2 to 1:9 |
| Timeframes | 5m, 15m (1m, 1h optional) | course uses M1-H1 |
| CSM filter | off | needs the 28-pair meter |

## 6. Later: the MT5 EA "Imbalance + Engulf"
After the models are backtested, the EA combines the winning setups (V1 + V2 at least) with the same parameters,
so the EA and the terminal signals agree.
