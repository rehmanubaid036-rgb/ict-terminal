# VSISA course - raw notes per video (work in progress)

Source: YouTube playlist "Volume Spread Imbalance Shift Analysis VSISA" by Sajid Ahmed (Trade With Sajid Ahmed),
playlist id PLe-mEHQPIWTaPQWjCTN2pf02tDPqMS_0q, 22 parts, uploaded Nov 2020 onwards.
YouTube's auto-captions were useless (Urdu speech read as Hindi words), so the audio was transcribed with Whisper
(small model, Urdu). Transcripts: `transcripts/NN.ur.transcribe.txt` (timestamps [mm:ss]). Whisper misses some
sentences, so every rule below carries the video + timestamp it comes from, and unclear parts are marked (?).

## Part 1 (Sjpho2hqHvU, 15 min) - big volume on an up bar
- [00:04-01:15] VSA says weakness appears on bullish candles: a bullish candle with big volume ("big volume on up
  bars") is a sign of weakness = supply came in. BUT: never say with certainty that it is buying or selling - it is
  50 % supply (aggressive selling into the up bar), 50 % aggressive buying.
- [02:26-02:53] The NEXT bar decides: next bar goes DOWN -> the big volume was selling (supply); next bar goes UP ->
  it was aggressive buying (demand).
- [02:53-03:40] "Big volume" is relative: compare with the volume of the last 2-3 days (same session), not only
  today's bars. A session's big bar that is small next to the previous days' bars is ignored; comparable to the
  big bars of the last 2-3 days -> big.
- [04:16-04:31] His own trades: VSA setups do not appear on "sell phone"(?) ... (unclear).
- [05:05-05:41] Candle anatomy: a big candle - if the next bar goes down, the big volume was selling.
- [06:37] Go INSIDE the big-volume candle on a lower timeframe: which portion (2nd / 3rd / 4th part) of the candle
  carried the volume and whether those were down bars.
- [06:49-08:24] His gold trade: waited for the next bar, dropped from 10 min to 5 min to see the story, sold; after
  one hour in profit -> partial profit taken and stop to breakeven (his rule: when a trade is 1 hour in profit,
  partial + breakeven).
- [09:17-10:20] Summary: big volume on a single bullish candle = 50 % aggressive buying / 50 % supply; the next bar
  tells which. (?) "same phenomenon: big volume on down bars = aggressive selling or buying".
- [11:54-12:17] THE PROBLEM with classic VSA: while you wait for the next candle to confirm, the move is already
  mostly done (example: entry would have been at 80, by the time the next candle closed price was at 74). This is
  the "incomplete" part of VSA (13:51) - the reason people lose with VSA, and what VSISA fixes.
- [14:05-14:27] Rising volume while price goes down, market still moves up ... (fake volume?) (unclear).

## Part 3 (oXzX3ohkQ7I, 10 min) - effort vs result (case A / case B)
- [00:02-02:08] Two bullish candles of the same size (spread). Case A: high volume. Case B: low volume.
  Which gives the strong bullish move? B.
- [02:08-03:58] Reason: in A the high volume means many sell orders were in the way and buyers had to absorb them
  (buy and sell trades both happen inside the bar -> big volume) = resistance / supply present. In B few sellers,
  so less force was needed to move the same distance = no resistance = buyers add in, strong move.
- [04:32-06:41] Mechanics: more transactions inside the bar = sellers' orders (commercials / "sell orders at higher
  prices") had to be filled before price moves; 150 sell orders need 150 aggressive buys. A low-volume up bar
  proves the path was clear.
- [06:44] The common belief "big volume = big move, small volume = small move" is WRONG.
- [07:23-08:32] After case A's bar, if a new low forms and price still goes up, fewer orders remain above (?).
  Price going up draws sellers at higher prices, so buyers need more force again.
- [09:33-10:00] (end) case B: bullish candle on even lower volume ... continued in part 4.

## The user's own course notes (parts 1-9, screenshots in `E:/E/for zaif printing/`, April 2026)
The 4 core rules (`bullish bearish volume explaination.txt`, repeated on every screenshot):
1. Weakness appears on up bars.
2. Big volume on an up bar: 50 % aggressive buying / 50 % supply. The reaction (next candle) decides.
3. Strength appears on down bars.
4. Big volume on a down bar: 50 % aggressive selling / 50 % buying. The reaction (next candle) decides.

Volume classes come from the "VSA Relative Volume" indicator: bars coloured by size against a rolling average with
bands: pink = low (below average), blue/red = average / high, bars reaching the upper bands = very high / ultra high.
"High" = above the average only; "ultra high" = far above (top band).

Buy setups (screenshots):
- B01 "buying appears on down bars with double bottom" (XAUUSD M5, 19 Jan 2021): market falling, volume rising on
  bearish candles; big bearish candle with a lower wick (shake-out) on high volume; the very next candle is
  bullish -> imbalance shift (clear on a lower TF). Entry after that; market then makes a swing and comes back to
  make a double bottom with ULTRA high volume on down candles -> re-entry at the double-bottom test with a stop
  buffer; "totally imbalance shift".
- B02 "down pin bar imbalance shift": scenario A = low made with 2 down candles then a bullish candle; market
  ranges under a horizontal line; scenario B = down candles with high volume (= buying), the last one a down PIN
  BAR (big lower wick), the very next candle bullish with LOW volume (lower than the previous candle's volume) =
  "pure imbalance shift pattern for buying entry".
- B03 "3 down bars": 3 down candles with increasing volume, the last bearish candle is a pin bar with ULTRA high
  volume, next candle bullish (not big) = imbalance shift. Buy with a 2-5 pip stop gap below the pin bar (forex);
  on gold the stop goes 40-50 pips below the pin bar.
- B04 "imbalance shift + low engulf in ranging": scenario A = red candle with HIGH volume (only above average),
  next candle bullish with high volume -> low, then range. Scenario B = 2 red candles, first average volume,
  second a hammer / pin bar with ULTRA high volume, the next candle a blue bullish candle with a small wick and
  LOW volume whose BODY engulfs the red candle's body and also its wick = "very good imbalance shift and low
  engulf pattern", pure sign of strength. Enter after the blue candle closes; stop buffer below the red candle:
  gold 20-40 pips, forex 2-5 pips.
- B05 "absorption volume candle" (XAUUSD H1, Nov 2020): "buying with high volume" = big bearish candle with high
  volume followed by bullish candles; "buying on down bars" = cluster of small down bars with high volume at the
  low; "absorption volume candle" = a big bullish candle on high volume after a rise (supply absorbed, later
  weakness).
- N01 "3 times buying on down bars" (AUDUSD M5, 8 Jan 2021): A = falling market, down candles with ULTRA high
  volume, next candle blue with a 50 % lower wick and PINK (lower than the previous 2 bars) volume = pure
  imbalance shift, enter after its close with a stop buffer. B = confirmation: average-volume bearish candle, next
  a blue candle with a wick and LOW volume -> buy / re-enter. C = ultra high volume on a bearish candle, the next
  candle also high volume but an ENGULFING candle (body and high of the previous candle) -> buy signal.
- N02 / N05 "buying on down bars with ultra high volume" (XAUUSD H1 Jan 2021, EURUSD M5): the low of a fall is
  a big red candle on ultra high volume followed immediately by a big blue candle; market rallies.
- N03 "buying on down bars with ultra high volume 05" (XAUUSD M5, 20 Jan 2021): after a range, market falls with
  high then ultra high volume on down candles; the next blue candle is a PIN BAR (wick = half the body) = clear
  imbalance shift = immediate buy entry, stop buffer below the pin bar's low. A red candle after the pin bar
  testing its wick on LOW volume may fail it, but the market responds very fast there.
- N04 "selling on up bars with ultra high volume 2 times" (USDINDEX M5): two ultra-high-volume up bars at the top
  of a rise, market then falls (mirror of buying on down bars).

Sell setups:
- S01 "sell setup on bullish candle with imbalance shift": A = blue bullish candle with HIGH volume (50/50), the
  very next candle bearish with ULTRA high volume -> that was pure buying, market goes up to B. B = first blue
  candle with high volume = selling pressure, the very next candle bearish with LOW (pink) volume = pure
  imbalance shift -> sell after the bearish candle closes.
- S02 "end of the rising market": A = big bullish candle, volume increased = aggressive buying. B = small candle
  with HIGH volume and a wick half the body = clear end-of-rising-market sign. C = same small candle closing down
  with the same wick but ULTRA high volume = end of the rising market. Enter sell after C closes; stop buffer gold
  20-40 pips, forex 2-4 pips; 3x-7x reward:risk.
- S03 "marubozu pattern": A = market falling with decreasing volume, then rising with low volume. B = a doji-like
  blue candle on ULTRA high volume = end of the rising market / strong weakness; after it a big engulfing (red)
  candle with high volume -> the 3-candle setup ("Marubozu" price-action pattern) = pure sell entry.
- "gold liquidity trap" (XAUUSD M15, Sep 2022): a different screenshot (session boxes, trend lines, "liq" marked)
  - a liquidity trap at session lows before the rally; not part of the VSISA rules.

Summary of what the screenshots define (to be cross-checked with the transcripts):
- Volume classes: low (below average / lower than the previous 1-2 bars), average, high (above average), very
  high, ultra high (top band).
- "Imbalance shift" = a big-volume bar in the direction of the move (down bar after a fall / up bar after a rise)
  followed by the NEXT bar closing the other way on LOWER volume (ideally low / pink, lower than the previous
  bar(s)). The lower volume on the reaction bar is the point: the opposing side has dried up.
- Strong variants: the big-volume bar is a pin bar (wick >= half the body / 50 % of the range); the reaction bar
  engulfs the body (and wick) of the big-volume bar ("low engulf" when on low volume); the big-volume bar is the
  last of 3 down bars with rising volume (climax).
- Reverse reading: if the reaction bar closes the SAME way as the big-volume bar's direction is NOT the point;
  "big volume on an up bar followed by an ultra-high-volume down bar" = that was buying (S01 A).
- Entry: after the reaction (imbalance-shift) candle closes, at market. Stop: beyond the big-volume candle's
  extreme (pin bar low / high) with a buffer: gold 20-40 (sometimes 40-50) pips, forex 2-5 pips.
- Context: buy after a fall (down bars into a low, double bottom / range low), sell after a rise (end of rising
  market). Re-entries when the pattern repeats at the same area.
- Targets: 3x-7x risk mentioned on the end-of-rising-market sell; course trade management (part 1): partial
  profit and stop to breakeven when the trade is 1 hour in profit.

## Part 2 (f4RzHjYzQjA, 14 min) - "rising volume rising prices" is incomplete; trend direction; discipline
- [00:02-00:32] Example gold 1886 -> 1853: price falling, people say "no supply, it will not go down, buy" - wrong.
- [00:32-02:00] The textbook rule "rising volume + rising prices = bullish, falling volume + falling prices = bullish
  (healthy pullback)" is INCOMPLETE. Do not apply it in every situation. If after the rise (rising prices, rising
  volume) WEAKNESS has appeared (big volume on up bars, sign of weakness), then the low-volume fall is not strength:
  it is weakness. First check whether weakness appeared at the top; only then is low volume on the pullback a
  sign of strength.
- [02:10-03:11] The setups come in the TREND direction. Smart money retests the day after. Apply the setup
  especially at the London opening (12-13:00 Pakistan time = 02:00-03:00 NY) in the trend direction; if the trend
  is down, do not look for buys there.
- [05:39-06:34] Example: a pin bar with big volume; the market then went up and closed above its tail -> the trend
  turned up.
- [07:41-08:11] A down bar closing but not closing further down while big volumes come = a down "speed"/stop; the
  reaction after a big-volume bar tells whether buying or selling happened. Do not try to predict, wait for the
  reaction.
- [08:37-08:53] "Market going up on low volume must come down" is a wrong belief; the next class shows why the
  market goes up on low volume (part 3-4: no supply).
- [09:46-10:28] Trade management: he took partial profit; risk and discipline; follow your own rules.
- [12:44-13:28] Only take the 3-4 taught setups; 2-3-4 setups per week on gold; one setup is at 01:00 Pakistan
  time (London), others when the market is active.

## Part 4 (Zg5thlZU920, 12 min) - low volume on the reaction bar = the imbalance
- [00:02-01:18] Case B (continued from part 3): a bullish candle on low volume means sellers were absent (80 sell
  orders instead of 200), buyers needed little force -> easy to move up. "Selling liquidity is not there."
- [01:25-02:24] What people wrongly think: "next candle's volume got smaller -> no power / not bullish". Wrong: no
  sellers = the up move is easy.
- [04:17-04:34] A bar with volume higher than the previous 2 bars: heavy buying there, but we do NOT buy on that bar
  because the buying is not complete (supply still present).
- [04:34-05:06] 3-bar / 2-bar formations: ULTRA high volumes coming in; compare the bars with the previous bars of
  the session or the previous 2-3 days; ultra = abnormal against that; and never trade against the trend.
- [06:25-06:53] The close of the big-volume down bar also tells: a close off the low = buying.
  Then WAIT for the reaction: the bullish candle after it. Look at ITS volume: big compared with the previous bars
  = supply still there; buying continues but there is no imbalance yet.
- [07:39-08:12] "Until there is an imbalance of demand and supply the trend will not change." Before, the
  imbalance was on the sell side (market falling); heavy buying came; the imbalance (demand > supply) is seen
  through volume: after the heavy buying, a bullish candle on LOW volume.
- [08:46-09:43] Why: liquidity providers (who sell / provide pending sell orders) see the big buyer move the
  market and pull their sell liquidity; the bullish move then runs on low volume because buyers need only a small
  force. Supply present -> big volume; no supply -> small volume. A big move can come from one order.
- [09:47-10:47] If the reaction candle comes on BIG volume: keep waiting (supply hit again). The WICK: if the
  big-volume down bar has a LOWER wick (closes above its low) that is buying (sellers came first, then aggressive
  buying); if it had no lower wick and closed on its low (upper wick only) -> hold / wait. "With a lower wick and
  big volume, I say buying is here."
- [10:47-11:05] 3-bar setup: on the way down big volumes start -> get ready; the imbalance shows when bullish
  candles start forming on SMALLER volume.
- [11:05-11:55] People call "big volume down, small volume up" bearish volume. Wrong: the SMALLER the volume on
  the bullish reaction bar the better = the stronger the imbalance = the stronger the bullish move. If the bullish
  reaction bar is not on low volume, no entry: selling is still coming in.

## Part 5 (Kq8LtzlTUCc, 14 min) - two-bar setup, stop placement, fake break of support
- [00:02-00:28] (repeat) the bullish reaction bar after the big buying must be on low volume. Going down big
  volume came; compare its volume with the bars before it.
- [01:05-01:45] Bullish candle with big volume compared to the previous bars = supply (many transactions, heavy
  buying absorbed). Confirmed by the next bar going DOWN, and that next bar's volume is smaller / not bigger
  (going up on small volume, coming down on big = bearish). (?) 
- [02:44-03:03] Going up supply is hit, big buying then down again = selling happened. Why the market goes up
  anyway: next lecture.
- [03:11-03:43] Coming down: big volume on a down close = buying; the close shows it; compare with the previous
  session's / day's bars (the bottom's big volumes). "Buying is here."
- [03:45-04:49] Two-bar setup: bar 1 = heavy buying (big volume down bar, biggest of the session / comparable with
  the previous days); then look at the REACTION after it. Yesterday's buying had a big-volume reaction (supply
  again); today's buying is followed by a bullish move on ... (check volume).
- [05:29-05:57] If the bullish bar after the buying bar also has big volume (equal to it) -> we do NOT buy: supply
  was hit again. "This is the 2-bar setup, after it the market will definitely go up: as soon as I see the bullish
  bar on low volume I take the trade."
- [05:57-06:44] Entry and stop: entry when that low-volume bullish bar completes; the stop goes 2 pips below the
  low of the (big-volume) candle; 2-3 pips buffer under the low. Even better if there is a support there (a
  previous support), and better still if that support was FAKE-broken.
- [07:18-08:17] Counter-example: big volume bar (session high volume), next bar also big volume with heavy selling
  -> the imbalance has not come; supply still lies on that bar; if the next bar goes down it confirms supply was
  hit; we do not take a buy. A strong setup is when that next bar is on LOW volume.
- [08:20-09:12] Big volume on a down bar followed by the next bar going down: had you bought, your stop would be
  hit. Big volume on a downtrend bar = buying, but the market does not have to move up immediately: accumulation
  can take 2-3 attempts (the buying is "stopped" first).
- [09:20-10:09] Big volumes on several bars (buy and sell both, supply hit, demand coming); then the market broke
  the support (previous low) with big volume and made a PIN BAR -> fake break of support.
- [10:42-12:35] That pin bar closes bullish with a lower wick on big volume: not supply volume (supply volume would
  open and go straight down); the wick shows the market went down, hit the buy orders, and they turned it
  bullish = big volume because of aggressive buying.
- [12:36-13:46] The strongest setup: big volumes while coming down (strong buying), then the area is retested and
  the previous low FAKE-broken (stops below taken, liquidity grabbed), then the strong move up. Three-four bars of
  very big (rising) volume = buying; wait for the bullish reaction, then buy.
- [13:51-14:11] Stop: above the low of that candle with a 2-pip buffer (tight), or below the low. He keeps stops
  tight; if it is too tight the entry may not survive.

## Part 6 (Zo57wbdu_PQ, 10 min) - end of the rising market; reading the reaction of a supply bar
- [00:46-02:05] Chart walk: supply hit on an up bar (big volume), the reaction is bearish = sell. Compare the big
  volume with the previous "big volume" bars nearby. A down bar with big volume = buying there, reaction
  bullish. "Buying happened here, selling happened there - the reaction tells." He would not buy on the
  big-volume bar itself.
- [02:08-02:22] Market going up on SMALL volume = normal (no supply), fine.
- [03:27-03:50] End of the rising market (example gold 1750->1730): a SMALL candle (narrow spread) with BIG
  volume whose reaction is bearish and the next part goes down = "end of rising market".
- [04:24-05:31] Big volume on a down candle normally means demand; BUT when that bar has an UPPER wick (the market
  tried to go up again and was sold, the bar closes down with an upper wick) and the body is small, the big
  volume came from that failed push = aggressive selling. Two signs together: small candle + big volume, and an
  upper wick = aggressive selling; he would not wait for more.
- [06:39-07:29] After an end-of-rising-market sign, the following candles should go down on LOW volume (the
  imbalance is on the sell side). If a down bar comes with BIG volume again -> that is buying (demand is back), the
  short idea is in doubt ("big volume should not come on the down bars; with an imbalance they come on low
  volume").
- [08:30-10:25] Case: market going up, small volume, then big volume on an up bar, then bigger... reaction
  candle. Confirmation of aggressive selling: big volume on the PREVIOUS bullish candles (supply hit while going
  up), and NOT big volume on the down candles that follow (big volume on the way down would mean demand).

## Part 7 (rksfDgBUauc, 10 min) - the 3-bar SELL setup; why the move runs on low volume; basics / COT
- [00:02-00:34] Aggressive selling needs big volume on the PREVIOUS bullish candles (supply hit while going up).
  If the market went up without big volume and big volume comes on the way down with a bullish candle leaving a
  LOWER wick -> that big volume is demand. No lower wick + big volume before it = aggressive selling.
- [01:27-02:17] 3-bar sell setup: going up, supply hit (big volume on an up bar); the next candle has even more
  transactions (bigger volume on a bullish candle) = more supply hit; the third again big volume. Compare the
  three volumes: they confirm supply is being hit. "3-bar setup = 3 bars with big volume; WAIT for its reaction;
  when the reaction is bearish (next bar goes down), supply is confirmed."
- [02:17-03:20] Mechanism: liquidity providers who provided buy liquidity remove it / buyers close (take profit);
  no buy liquidity left -> the market comes down on LOW volume. Pending buy orders (10 -> 5) removed, so
  sellers need less force.
- [03:20-04:13] The reaction bar: bearish formation (small or big), proper close, and its volume LOW. If its volume
  were big (equal to the three) -> "demand is hitting too", no setup. Low volume on the reaction after 3 big-volume
  up bars = good setup, imbalance of demand/supply is there, market will go down -> take the trade.
- [04:19-04:35] Best in the direction of the trend; trend reversals are caught with the same setup (shown later).
- [04:47-05:23] Summary: aggressive selling = supply hit behind (big volume on up bars), the bar has an UPPER wick
  (?) and a strong bearish close; and the next bar goes down on LOW volume (pending buy orders removed, sellers
  need little force).
- [05:23-10:00] General talk: basics, price is leading, indicators lag, volume is leading; divergence (regular /
  hidden); the COT report shows big players' positions (lagging but useful). Nothing for the model.

## Part 8 (f6uc0c-cKgA, 10 min) - the "campaign" structure: big volume down, low-volume rise, no demand upthrust
- [00:02-01:16] Yesterday's gold: on the way down the BIGGEST volumes of the move (buying); then the market goes
  up on LOW volume -> confirms the aggressive selling has ended and aggressive buying came = the IMBALANCE
  SHIFTED (sell -> buy). We buy. Structure: falling with big volumes, then rising on low volume.
- [01:21-01:35] They do not buy only at the low; a buying campaign starts and continues in that area; after it
  the market going up on low volume confirms gold will go up.
- [01:49-02:38] Once the campaign is done the big volumes stop: small volumes while going up. If instead the
  market fell again on low volume after the buying -> the campaign failed; the market can be taken lower.
- [02:43-03:29] The structure: price broke a swing low (a "fake move" 200 pips?), everybody sold, but at the low
  no big selling volume appeared (no big volume = they can push small moves).
- [04:00-05:09] UPTHRUST: after selling at the top, an up bar with a big upper wick on big volume = upthrust;
  after it a "NO DEMAND" bar: a small up bar on volume much smaller than before = no demand; the next bar confirms
  (goes down). Those who sold at the top never got a chance to book profit (the market reversed fast).
- [05:15-06:04] Same structure again: big volumes on the way down = buying; the candle with a LOWER wick: the
  market went down then aggressive buying created the wick = demand (not supply).
- [06:04-07:06] A candle with huge volume but no further fall shows selling pressure is absorbed; compare the next
  candle: its width is HALF and its volume is a quarter (54004 vs ~13500) -> market then goes up on low volume
  = confirmation.
- [07:10-08:29] Fast moves: when the market shoots up after this behaviour, do not fear; smart money moves it so
  fast sellers get no chance; the same the other way (strong selling, no demand on the rise, people get no
  chance to buy).
- [08:29-08:43] "When you see this behaviour (big volumes on down bars) and after it the market goes up on low
  volume, it is confirmed: the imbalance shifted from selling to buying."
- [08:43-09:26] Mark the buying AREA (the bars with the big volumes) as a zone; "low volume" means do not look at
  far-away bars; compare with the bars right before: if big volumes came on the way down, bigger volumes would
  have to come on the way up for a real fight - they did not. A decent sized up bar on LOW volume = good.
- [09:34-10:11] Mark the most RECENT such event; on this setup the stop is small and the reward big.

## Part 9 (tltsjLtD_GQ, 10 min) - bag holding (small candle, huge volume), no-supply test, impulse
- [00:40-00:53] Setup 1 recap: big volumes come in an AREA; later the market crosses that area again on LOW volume
  -> buying. For selling it is the opposite (big volumes at the top, then the area crossed down on low volume).
- [01:57-03:28] "BAG HOLDING" (end of falling market): a very SMALL candle with a very BIG volume (compare size and
  volume against the big candles around) = the most powerful single signal: so much aggressive buying that the
  market was not allowed to go down - the sellers were "packed in the bag". Textbook pictures rarely appear;
  in real charts it looks like this.
- [03:28-04:33] Smart-money reading: a seller puts big lots in, the market does not move -> someone big is buying
  -> he exits. Volume numbers: a small-move bar with 1500-1900 vs. 600 on bars that moved more: more transactions
  with no move = absorption / buying. The NEXT bar being bullish confirms the buying.
- [04:36-05:16] 2-bar setup recap: falling on RISING volume (increasing volume on the way down, the last bar
  bullish?) -> not "selling": when increasing volume comes on the way down and the last bar reverses and the next
  bar is bullish, that is buying confirmed.
- [05:16-05:57] NO SUPPLY TEST: after the buying, a test (a down bar into the buying area) on SMALL volume = no
  supply; big volume on the test would be more selling (then "sustained buying" is needed, wait). Small volume on
  the test -> wait for the next bar to be bullish -> setup confirmed -> ENTRY there (he enters a bit earlier,
  his stop is under the low). Then profit comfortably.
- [07:46-08:15] Gold example, Pakistan 06:00 (= 20:00 NY previous day, Asia): big volume on the way down = buying.
- [08:52-09:39] SELL mirror: a bar with big volume whose reaction is bearish = selling confirmed; the market then
  ranges and the volume gets small in the range -> imbalance shifted from buying to selling -> a big fall
  follows (a series of big volumes = confirmation).
- [09:48-10:11] IMPULSE: a strong impulse candle after many days; if the next (daily) candle is bullish on top of
  the impulse, the impulse holds; context for the direction.

## Part 10 (cB8zmMIBhMc, 10 min) - student recap; supply/demand tests; the buying AREA as support
- [00:32-01:39] Student recap (teacher agrees): a down move with big volume; its reaction bearish? then a SUPPLY
  TEST comes - on low volume it is a buy (on high volume it is "even better"? - unclear, (?)); if a strong bullish
  candle then forms, buy with the stop below and take 2-4R. Mirror for sells: up move on big volume, bearish
  reaction, then a DEMAND TEST, market ranges -> sell.
- [01:44-03:12] Setup 2 (recap): very big volumes in an area (campaign); later the market crosses / revisits that
  area on SMALL volume = imbalance has shifted from sell to buy. How to see the shift: big volumes while going
  down, reaction bullish, then the market goes up on LOW volume = confirmation.
- [03:12-04:05] Mechanism again: sellers / liquidity providers see the shift and pull their sell orders (sell
  limits removed) -> buyers need less force for the same move -> low volume on the way up = no supply there.
- [04:05-04:14] (student) high volume coming down, low volume going up, and it crosses the level where the
  campaign started -> buy.
- [04:52-05:10] Abnormal-activity candles: big volume with a SMALL spread; sometimes you miss the entry, but the
  market retraces to the area and goes up again (re-entry chance).
- [06:33-07:26] Discussion: we always buy bottoms / sell tops; support & resistance: the market often returns to
  where it moved from before.
- [07:26-08:57] Make your support / resistance from the BUYING AREAS seen on the volume (where the big volumes
  came), not from the bare lows / highs. Mark the area with a line and a note (e.g. "3-bar setup here"). When the
  market comes back and touches that area and a bullish reaction appears -> trade with a 1-2 pip stop; big gain,
  3R to 8R with a small stop.
- [09:36-10:06] Take at least 3 trades of a setup to learn it. Buying is "sustained" when big volumes come in;
  the next bar's volume does not have to be smaller, but it is a strong sign when a big volume bar is followed by a
  bullish reaction.

## Part 11 (5yJy-LBNbbU, 10 min) - no-supply test closing bullish; session volume; crashes happen on low volume
- [00:02-02:09] NO-SUPPLY TEST, strongest form: the test candle goes DOWN into the buying area and, because there
  is no supply at all, closes BULLISH on the SAME candle (a lower wick with a bullish close) instead of closing
  down. Its volume is PINK (low): smaller than the previous bar's volume. After buying, a series of small bullish
  candles starts. Take note of both forms: (a) test bar closes down on low volume, next bar bullish; (b) the test
  bar itself closes bullish with a lower wick on low volume = strong signal.
- [02:51-04:30] Volume psychology by session: banks open / close move the volume. Focus on EUR/USD, GBP/USD,
  AUD/USD, GBP/JPY, USD/JPY, EUR/JPY (and gold). Compare a session's volume within itself; London opening volume
  (13:00 Pakistan) is big; a bar is "big" relative to its session.
- [05:10-05:58] Don't panic when big red candles appear with BIG volume: that is buying. "Crashes happen on LOW
  volume; on big volume there is buying." Falling on big volumes = buying; then the market goes up on low volume
  = imbalance shifted.
- [06:08-06:16] Lesson: on a SMALL bar, when you see BIG volume, understand that is buying (at a low).
- [07:52-08:57] Example: an area is broken (big volume on the break of the area), then while the market goes
  up through the upper side no volume comes = no supply = continues up (1800 pips). "This is the power of VSA."
- [09:19-09:27] Homework: focus on these setups, note them with circles and timing.

## Part 12 (M4VHwKhP4EU, 11 min) - sustained selling at a high; false breakouts; stop and R:R rules
- [00:11-00:27] Train your eyes: screenshot every setup and its result, build a booklet.
- [00:34-01:28] SUSTAINED SELLING: market goes up; a SMALL-spread bar with big volume (and the next bars too),
  reaction bearish = supply came. When a resistance is broken on BIG volume that is NOT a breakout, it is supply
  being hit (a real breakout happens on low volume). 
- [01:38-02:30] The market returns to that high: near the high on LOW volume -> it may go on up; but if BIG volume
  comes again near the high (good volume on a small candle) and the reaction is bearish = selling again. Supply
  hit at the same high 2-3 times = sustained selling; the more often, the stronger the move down will be. The
  next rise comes without big volume (selling already done) -> down move.
- [02:36-03:14] Stop for sustained selling: 2-3 pips (max 5?) above the HIGH that was made. Entry at the
  confirmation; the stop is small and the profit good.
- [03:53-05:24] Typical: supply is hit when a PREVIOUS RESISTANCE is BROKEN to a new high ("false breakout" /
  stop hunt): breaking the high the volume INCREASES, big volumes; the NEXT bar's reaction is BEARISH on LOW
  volume = confirmation that heavy selling happened. Response must be bearish AND on low volume.
- [05:24-06:12] Do not read "rising price + rising volume = bullish, will break out" here. Rule: a previous
  resistance broken with big volumes -> most likely selling; if the next bar confirms down on low volume -> take
  the sell; stop above the high.
- [09:23-09:41] Stops: aggressive case stop at the (nearer) level; conservative stop above the whole high; reward
  must be at least 1:2 (1:1.5 to 1:2). Pattern: rising, big volumes on the rise, next bar down on low volume =
  the setup; entry there; stop above.
- [10:17-10:36] Look at what happened after the fall (next part).

## Part 13 (z5FKl4Bo7uQ, 9 min) - anomaly bars (small spread, 3x volume) shift the imbalance; low-volume rise
- [00:02-01:49] The ANOMALY: after a wide bar with volume ~2464, three SMALL bars with ~10,000 volume each
  (3-4x the normal bars with the same spread) = "small bar, big volume = stronger signal" (strongest).
- [01:49-03:18] Imbalance was on the sell side (selling on H1); until big buying comes the imbalance does not
  shift. These three bars (big volume, small candles, market not going down, ~25 pip total move) = so much
  aggressive buying that it shifts the imbalance from the down side to the up side. Our job is to FIND where the
  imbalance shifts (reversal of the imbalance).
- [03:21-03:35] Do not look at the indicator's bands (ultra-high colouring); COMPARE the volumes with the previous
  volumes of that session / day. Stuck in bands, you miss it.
- [03:36-04:35] After that strong buying the sellers (pending sell limits) pull their liquidity; the following
  bullish candles go on LOW volume vs the three bars -> call it "no supply / low supply"; little force needed = bullish.
- [04:35-05:04] After the strong buying when the market rises on low volume; if BIG volumes came on the way up that
  could be supply; small volumes going up = the imbalance has come and shifted -> bullish continues (410 pips).
- [05:48-06:32] Screenshot / note such examples; the pattern repeats: market falls, big volumes, next bar bullish
  reaction on low volume (as taught before). Here: previous high broken, selling seen there, boom down, then
  buying (the anomaly bars) and up again.
- [06:37-07:18] Compare with the session's volume: 3 small bars with 10,000+ vs 3,000 on a normal candle = 3x.
- [07:28-08:04] CLOSES: if those bars closed on their LOWS the big volume would be supply (demand failing to absorb
  it); they closed off the low with WICKS = the supply is being absorbed; once absorbed -> big move up.
- [08:04-08:45] Without volume you would call it a retracement and sell the pin bar - wrong; volume tells it is
  buying.

## Part 14 (RwxQwzlvBhc, 9 min) - the engulfing on low volume (sell), accumulation, M30/H1 confirmation
- [02:02-02:32] SELL example: market going up; a candle with the day's HIGHEST volume (supply); the NEXT bar,
  on very LOW volume ("no demand" volume), ENGULFS the whole body of the big-volume candle and closes on its lows
  = very strong sign. 
- [03:16-04:05] "Big volume, next bar engulfing closing on the lows on very low volume": compare the two volumes
  (e.g. 11,000 vs much less). Even if the engulfing bar's volume were equal it would still be selling, but LOW
  volume on a wide-spread down bar means no buy orders were there: sellers needed little force.
- [04:05-04:30] Entry at that bar's close; stop above the high; result 1:5.5.
- [04:37-05:25] "Low demand / no demand": after supply, the reaction on low volume = no demand -> boom down. Where
  big volume came on the way up with a reaction and the market still rose, the earlier imbalance (demand) was
  stronger - compare volumes.
- [05:29-06:16] Buying campaigns: in a big market (gold) one candle cannot do the buying; it is done in a range,
  repeatedly ("a bar buys, then again"). The small bars with big volume on the way down = buying.
- [06:22-07:08] Rule again: a SMALL bar with BIG volume followed by the next bar on much LOWER volume = strong
  imbalance; the shift to the buy side is confirmed when the next bar goes up on low volume (sell orders pulled).
- [07:16-07:56] Seen more clearly on M30 / H1: the H1 confirmation; buying = accumulation; today's highest volume
  came on those bars; then the next bar bullish on much lower volume = imbalance came.
- [08:22-08:56] The high was broken earlier, market came down, bought, went up to the resistance, down again,
  clear buying; confirmed by the next bar: a bullish ENGULFING candle; check its volume (next part).

## Part 15 (u2Qv6F8Y1QE, 8 min) - support test on low volume, break of a high -> immediate sell, strength grading
- [00:11-01:00] Market rises to a support/resistance on LOW volume: if big volume came on the touch that would
  be selling; low volume on the test = no sellers (they moved their orders away) -> continues.
- [01:10-01:39] A big-volume bar near the level: if it were sustained selling the next bar would close DOWN on
  LOW volume; instead the next bar closes up with volume -> buying, the level is broken. Always check the next
  bar's CLOSE and VOLUME.
- [04:30-04:57] Setup recap "metro 2": wait for the FIRST supply after a break of a level.
- [05:53-06:08] If a very big volume comes against your trade the trend can reverse: use tight stops, enter after
  the confirmation bar.
- [06:22-06:54] Today's gold: the high was broken with big volumes while breaking; next bar went DOWN on LOW
  volume -> SELL immediately, no need to wait for sustained selling. (Break of a high on big volume + next bar
  down on low volume = the sell.) After it the market rose once more (projection) then fell.
- [07:42-08:07] Grading: the smaller the volume on the reaction bar and the stronger its close (bullish for a
  buy), the stronger the setup = strong imbalance shift. Follow only this; no order flow / market profile needed.

## Part 16 (LE2VfM1lIhg, 8 min) - RULE 1: trend + Fibonacci 50-61.8 retracement + AR line break on low volume
(Whisper writes the trend word as "برش", which can be "bullish" or "bearish"; the logic - BUYING in the
retracement, fib from the recent low to the recent high - only fits a BULLISH trend; the sell side is the mirror.)
- [00:01-00:45] New setup. In the trend, take the previous / recent swing LOW to the recent HIGH and draw the
  Fibonacci. Wait for the retracement to reach the 50 % - 61.8 % area. There buying appears: on H1 big volumes
  in that area ("they tried to break the 61.8 level", big volume of the session).
- [00:45-01:15] Go to M5 inside that H1 area: the big volumes are visible on M5 (e.g. 4 big-volume bars); after
  the big volume a bullish reaction: that first reaction high is the "AR" line (Automatic Rally) - the first
  resistance made by the buying reaction. Mark a line there.
- [02:40-03:18] Wait for the AR line to be BROKEN ON LOW VOLUME (lower than the previous volumes). The bar that
  breaks it on low volume = signal; aggressive entry right there. Or wait more: a NO SUPPLY bar (low volume
  down/test bar) and the NEXT bar's bullish confirmation on low volume -> entry. (A no-supply bar whose reaction
  is not bullish is not yet the entry; wait for one whose reaction is bullish.)
- [03:55-04:37] Stop: do not put it far. Aggressive: just below the no-supply bar. Conservative: below the AR
  line / the low. Example result: stop ~7 pips, ~40 pips move = 1:6.
- [05:05-05:49] Summary: swing low -> high fib; wait for the retracement; market breaks into 50 / 61.8; buying on
  big volume of the session there; watch the reaction; mark the AR line; wait for the AR break on LOW volume
  (why low: a low-volume break means no supply, then the market retests the AR area, a no-supply bar forms and the
  next bar confirms -> enter).
- [05:49-06:32] Two entries / stops: aggressive (entry on the AR break bar, stop below it) and conservative (entry
  after the no-supply + next-bar confirmation, bigger stop ~ 22 pips?, still 1:2+).
- [06:35-07:32] Rule 1 restated: trend, retracement into 50-61.8, buying on M5, the reaction makes the AR line;
  wait for its break on LOW volume; if the break comes on BIG volume / selling comes back there -> do NOT buy. Two
  trades possible: aggressive and conservative (sometimes the conservative confirmation never comes).
- [07:54-08:05] The AR line often does not break: selling comes at it and the market continues down to the
  previous trend's level - waiting for the break is mandatory.

## Part 17 (gywHFOUdf-k, 12 min) - AR / AS line method (trend continuation), buy and sell examples
- [00:03-00:44] Trend-direction setup. Suppose the market is rallying: check whether SELLING happened at the top or
  only profit taking. Selling: the reaction after it is on LOW volume. Not clear selling: the next down bar /
  reaction has BIG volume. Selling then buying again from below = the setup forms.
- [00:50-01:12] Fib from the previous LOW to the HIGH; the setup = buying appears in the 50 - 61.8 area. On H1
  too: buying, again buying, and the next bar ENGULFS both candles on LOW volume.
- [01:47-02:39] Method: the H1 candle's low support - big volumes all over that area; the reaction went on low
  volume (an M5 structure too). The lesson that saves you from many losing trades: after the buying (the small
  big-volume bar), the first reaction goes up = AUTOMATIC RALLY (AR). Draw a line at the AR high.
- [02:39-03:13] Wait for the market to come down and then BREAK the AR line on LOW volume (volume lower than many
  previous candles = the imbalance is in the market). If a BIG volume came there and the next bar went down =
  selling again. Here a no-supply that failed(?): supply came first and the next bar went low then engulfed the
  whole range.
- [03:19-04:01] Normally we take the trade at the first candle (aggressive) with the stop under it, or wait for a
  no-supply for more confirmation (then the entry may be missed / the stop gets bigger). Result: ~110 pips on a
  small stop (1:9 vs 1:3 depending on the stop).
- [04:01-04:54] Summary: trade in the TREND direction; on the retracement draw the fib low -> high; in the
  50 / 61.8 area a FAKE BREAK happens, buying appears, the reaction is bullish; on M5 the AR line forms; wait for
  its break; on LOW volume -> trade; if it breaks on HIGH volume and the next bar goes down -> no trade. Normally
  after the buying + reaction the market dips again and would stop you out; waiting for the AR break avoids that.
- [04:58-07:13] SELL example (Asia session - "good trades in Asia"): market going up, previous resistance broken,
  first supply comes there: BIG volumes in that area (big for Asia), reaction DOWN on low volume (much smaller
  than before; the next bar even smaller). The reaction low = AUTOMATIC SUPPORT (AS) - draw a line. Entry can be
  at the close of that candle, or for confirmation wait for the AS line to BREAK on LOW volume: a strong bearish
  candle closing on its lows with volume smaller than many previous candles = confirmation. Then an UPTHRUST
  often comes back to that line (tries to go up): on high volume = selling, on low volume = no buyers - take the
  trade in both cases; the upthrust close shows strong selling.
- [07:17-08:20] Two entries: (1) at the close of the AS-break candle, stop above; (2) at the upthrust. The move was
  ~130 pips from a small setup.
- [09:00-09:52] Re-adding: after the first trade, when the AR/AS line breaks on low volume add another trade
  (scale in); an upthrust on big volume can be another add.
- [10:07-11:21] The two ways: (1) trend direction: market retraces, next day trend continuation; fib 50/61.8
  buying; M5 automatic rally; wait for its break on LOW volume - performs better in trend direction than for
  reversals, but also helps reversals. This method saves the trades where the reaction bar after the buying had
  BIG volume (we skipped them before): if the AR / AS line then breaks on low volume the market is imbalanced ->
  take it.

## Part 18 (E7gktA2AFXg, 10 min) - combine VSA with a CURRENCY STRENGTH METER (forex filter)
(Middle of the audio [03:48-04:36] is garbled by Whisper; the rule is repeated clearly at the end.)
- [00:12-01:13] Combine VSA with a currency strength meter ("CSM", "consistent meter"): a setup can appear - a big
  volume bar and the next bar ENGULFING it on LOW volume - and still fail (stop hit) if you ignore currency
  strength.
- [01:13-03:10] Check the strength of the pair's two currencies (scale 0-7). Example GBP/JPY: a sell setup while
  GBP was 6.6 and JPY ~1 -> definitely stopped out. If weakness appears in the pair while the currency it is
  against is LOSING strength, the setup can work; a big gap against your direction kills it.
- [04:58-07:51] Rule (EUR/JPY example): the sell setup has come (selling, reaction on low volume / down). If EUR is
  5 and JPY 4 or 3 (comparable, gap of 1-2) -> you can take the sell. If EUR is 5-7 and JPY 3-2-1 (gap 4-5-6) ->
  do NOT take the sell setup.
- [08:54-09:56] When the two currencies' strengths are far apart (e.g. GBP 6, JPY 1.7-2 for several days) the
  counter setup will not play; take setups only when the gap is small (strengths close), or in favour of the
  stronger currency.
- For the models: this filter applies to FOREX pairs only (not gold / indices). It needs a strength meter built
  from the major pairs (the engine loads only EURUSD and GBPUSD today) -> optional filter, [DEFAULT] gap limit 2.

## Part 19 (LsB13M674h8, 13 min) - currency strength meter in practice (forex filter, continued)
- [00:05-00:41] A sell setup (selling, engulfing) failed because the pound was strong. Another pair: high volume,
  next bar down on LOW volume -> sell, worked (1R+).
- [01:27-02:04] A setup that came today: when it appeared the pound was strong vs JPY; very big volume, the reaction
  ENGULFED the whole range with a big candle on low volume - still risky because of strength.
- [02:47-03:29] Rule: when your setup comes, compare the strength of the currency you sell and the one you buy:
  the DIFFERENCE must be small (1-2). If the difference is 3-4-5 -> AVOID the trade.
- [04:20-05:20] EUR/GBP example: selling happened, the reaction candle engulfed the whole range on low volume;
  if GBP and EUR strengths are very close you can sell; if GBP is weak (2-3) and EUR strong (5-6-7), do not sell
  EUR/GBP (the setup fails, the stop is hit).
- [05:44-07:51] Use the CSM before trading. Best practice: trade the STRONGEST currency against the WEAKEST one
  (e.g. GBP strong -> buy GBP against CHF / JPY / the weak ones); trades then run well.
- [08:13-10:33] If the two currencies of a pair are close (e.g. GBP vs EUR both ~5) a setup may not play / gets
  stopped; prefer pairs where the gap matches the setup's direction.
- [10:41-11:35] Trade management with the CSM: once in a trade, if the strength you rely on collapses (e.g. the
  pound drops from strong to ~5, equal to the other side) -> the trade may not play: close or take profit.
- [11:37-12:45] GBP/JPY still going up because GBP strong and JPY weak (gap ~4.6): avoid sells there.
- For the models: same optional forex filter as part 18 (gap limit, trade with the stronger currency). Not for
  gold / indices.

## Part 20 (Dv0tzFdnegc, 9 min) - CSM rule refined: reversal vs trend-direction
- [00:04-01:20] GBP/USD sell setup (3 bars of selling, then a low-volume reaction). GBP 6.7 vs USD 3.4 = gap ~3:
  if you sell now the trade will not play. Sell only when the gap is small (1-2), e.g. GBP 6.4 vs USD 4.5-5.5.
- [01:23-02:27] What to do: when the setup forms, wait for its BREAK (the AS line, part 17) and re-check: if by
  then GBP has dropped to 5-4 and USD risen to ~4, the gap is small -> take it. If at the break GBP has not lost
  strength / USD has not gained, the market may go up - do not sell. On small timeframes (M5) take the CSM very
  seriously.
- [02:33-05:24] CHF/JPY buy he took: sustained buying, the next bar ENGULFED on LOW volume = buying confirmed;
  CHF 1, JPY 2 (gap 1) -> played; later CHF rose to 2.3 and the trade ran. If JPY had been 3-4 vs CHF 1 he would
  not buy; he would wait for the gap to shrink to 1-2. In a REVERSAL buy the currency you buy is weak at first
  and gains strength as the trade plays.
- [06:54-08:31] KEY RULE: 
  * Trend REVERSAL setup: the currency you buy is initially weaker -> the two strengths must be CLOSE (small gap).
  * Trend DIRECTION setup (e.g. USD/JPY in an uptrend, buying on the retracement, USD 4 vs JPY 1): the currency you
    buy is STRONGER -> the BIGGER the gap in your favour, the better (GBP 6 vs JPY 1 -> buy GBP/JPY in trend).
  * So: with the trend, a large gap in your direction is good; against the trend, the gap must be small.
- [08:35-09:14] EUR/JPY sell (a reversal setup) worked because EUR 5 vs JPY 4 (comparable); with EUR 7 vs JPY 4 it
  would have failed or been slow.

## Part 21 (rEOkATLuDmw, 12 min) - CSM alignment as a hard filter; strongest vs weakest; trend setup with CSM
- [00:00-00:43] GBP/JPY M1: selling came, the reaction was on low volume, but it did NOT play: GBP very strong,
  JPY very weak. When one currency is very strong and the other very weak, do not sell the strong one; only buy
  setups there. Even an engulfing + low-volume reaction is not taken if the CSM is not aligned: the CSM is the
  filter.
- [00:45-01:37] CHF/JPY: buying, then sustained buying, the reaction on low volume; CHF and JPY close (gap 1) ->
  buy, it ran. EUR/GBP sell worked: EUR and GBP close, CSM aligned.
- [01:51-02:36] Rule for any market (indices / forex): trade a VSA setup only when the CSM is aligned; without
  alignment skip it, however good the setup looks (many setups with a low-volume reaction fail otherwise).
- [02:39-03:06] Example numbers: CHF 4 / JPY 3 or CHF 5 / JPY 4 -> take the sell; CHF 5-6 / JPY 1 -> ignore the
  sell even if it is an engulfing setup.
- [03:06-03:44] EUR/GBP setup on M5 and M15: strong reaction on low volume, it engulfed, went 2R easily - CSM
  aligned (EUR and GBP close).
- [04:28-06:35] Buy the strong currency against the WEAKEST currency (lowest numbers 1-2-3 on the CSM); sell the
  weak currency against the STRONG one. Buying GBP against AUD (both strong) fails; buying GBP against EUR / JPY /
  CHF (weak) profits.
- [07:31-08:28] Followed blindly (e.g. a GBP/AUD sell when both are strong) the market ranges and wastes time.
  Take sell setups only where one currency is strong and the other weak.
- [08:28-09:16] When buying appears in a currency and its strength then INCREASES (1 -> 2-3), the setup is likely
  to play; buying a currency at 0-1 with no strength gain -> ranges / loses. Trade it against the weak ones.
- [09:50-11:27] Trend setup with the CSM (the best): e.g. GBP/JPY with GBP strong and JPY weak: wait for the
  retracement, check no selling at the top, buying again on the retracement, strong reaction on LOW volume; CSM
  strong 5-6 vs weak 2-3 -> it plays. Trade in the trend direction: CSM, VSA setup and trend all aligned. In
  reversals be cautious: wait for the AR break or for the currency to gain strength first. Ideal setup = VSA setup
  AND CSM aligned; if the CSM is not aligned, wait (let the currency strengthen, wait for the AR).

## Part 22 (xWKT3wLmCXM, 9 min) - CSM at the AR / AS break; trend-direction buy example (USD/JPY M5)
- [00:04-00:39] GBP/JPY: selling on the way up with big volume, next bar engulfing - failed (GBP strong, JPY weak);
  again selling, failed again; the market kept rising. Selling GBP/JPY while GBP is strong keeps losing.
- [00:39-01:29] CHF/JPY M1: buying, the reaction a small bar that ENGULFED on low volume -> big move up; CHF 1.5 vs
  JPY 2 (comparable) -> bought.
- [01:32-04:15] RULE: after selling comes the AUTOMATIC SUPPORT (AS); after buying the AUTOMATIC RALLY (AR). WAIT
  until the AR / AS line breaks and check at that moment whether the two currencies' strengths have become
  comparable (the one you buy stronger / the one you sell weaker). Example EUR/USD buy setup: EUR 1-2, USD 6-8
  -> wait for the AR break; if by the break EUR has gone to 2.5+ and USD is losing strength -> good chance up; if
  at the break USD is still 7-8 and EUR still 1-2 -> the market will go further down (they will fake-break again).
- [04:21-05:43] Same for a sell (EUR/JPY, EUR 7, JPY 1): draw the AS; at the AS break if EUR has dropped to ~5-6 and
  JPY risen to 2.5-3 -> take the sell; if EUR is still 6+ and JPY under 2 -> it can fail. Strength moving your
  way at the break = higher chance.
- [05:57-07:20] USD/JPY M5 trend-direction buy: not the "ideal" setup at a low - it came in the retracement near
  the high: buying during the retracement (the biggest buying), the next bar ENGULFED on LOW volume (about 50 %
  of the previous volume); USD stronger than JPY -> buy in the trend direction; stop 2-3 pips, ran ~25 pips.
- [07:20-07:57] Recipe: market bullish, retracement, buying comes, the next bar engulfs on LOW volume, the strength
  meter shows JPY weak and USD strong -> buy. Against the trend (buying then the AR forms) still use the CSM.
- [08:11-08:49] EUR/JPY: retracement, buying; EUR strong, JPY weak -> it keeps going up; selling seen at the top
  would lose because EUR is strong and JPY weak; it may break up.
