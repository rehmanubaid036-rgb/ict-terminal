"""VSA Models M20-M25: the six setups of the VSISA course (Volume Spread Imbalance Shift Analysis, Sajid Ahmed).

The rules and their sources (video part + timestamp, the user's screenshots) are in
docs/research/vsisa/VSISA_LOGIC.md; the section numbers below point there. These are not ICT models: they are
listed under Custom Models > VSA Models and share nothing with the ICT pipeline except the Signal contract.

  M20  V1 Imbalance Shift          big volume, the next bar the other way on LOW volume            (§2 V1)
  M21  V2 Low-Volume Engulf        big volume, the next bar ENGULFS its body on LOW volume          (§2 V2)
  M22  V3 End of Rising/Falling    small-spread bar(s) on very high volume at the extreme, reversal (§2 V3)
  M23  V4 False Break              a swing high/low broken on big volume, next bar back on low vol  (§2 V4)
  M24  V5 No-Supply / No-Demand    after a buying event, a low-volume test of its area holds        (§2 V5)
  M25  V6 AR / AS Line Break       after a buying event, the first rally's high broken on low vol   (§2 V6)

Every setup is written once for a BUY on "long" arrays; a SELL is the same code on the mirrored chart (prices
negated, highs <-> lows, up <-> down bars), so the two sides can never drift apart.

Timing: a setup is complete at the CLOSE of its confirming bar on the model's timeframe; the signal's created_time
is the last 1-minute bar of that candle (so the simulator can only fill after it) and the entry is that candle's
close (the course enters at market after the close; here a limit at that price valid for ``expiry_bars``).
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace

import numpy as np
import pandas as pd

from ..bias import bias_at
from ..context import Context
from ..indicators.vsa_volume import AVERAGE, HIGH, LOW, VERY_HIGH, VolParams, features
from ..signals import LONG, SHORT, Signal

SETUPS = {"M20": "imbalance_shift", "M21": "low_volume_engulf", "M22": "end_of_market", "M23": "false_break",
          "M24": "no_supply_test", "M25": "ar_line_break"}
# stop buffer beyond the setup's extreme (§2): gold 20-40 pips -> $2.0, forex 2-5 pips -> 2 pips; others [DEFAULT]
BUFFER = {"XAUUSD": 2.0, "EURUSD": 0.0002, "GBPUSD": 0.0002}


@dataclass(frozen=True)
class VsaConfig:
    timeframes: tuple[str, ...] = ("5m", "15m")      # §0.3
    vol: VolParams = field(default_factory=VolParams)
    context_bars: int = 10           # "after a fall / rise": the setup's extreme is the lowest / highest of N bars [DEFAULT]
    reaction_max: float = 0.75       # the reaction's volume below this x the big bar's volume [DEFAULT]
    targets_r: tuple[float, ...] = (2.0, 5.0)     # §2 targets: half at 2R (then breakeven), half at 5R [DEFAULT]
    split: tuple[float, ...] = (0.5, 0.5)
    expiry_bars: int = 3             # the entry order lives this many bars of the timeframe
    buffer: float | None = None      # None: BUFFER / the symbol's stop_buffer
    require_bias: bool = False       # engine option "Only setups with the daily bias"
    trend: str = "none"              # 'none' | 'ema1h': only with the 1h EMA-50 trend (§3.1)
    trend_ema: int = 50
    swing_n: int = 2                 # V4: a swing high has n lower highs on each side [DEFAULT]
    swing_lookback: int = 60         # V4: the broken swing is at most this many bars old [DEFAULT]
    test_window: int = 30            # V5: the test comes within this many bars of the buying event [DEFAULT]
    ar_window: int = 40              # V6: the AR break comes within this many bars of the buying event [DEFAULT]
    fib: bool = False                # V6 Rule 1: the buying inside the 50-61.8 % retracement (§2 V6 step 5)
    fib_zone: tuple[float, float] = (0.45, 0.705)   # [DEFAULT] around 50-61.8 (the course allows a fake break of 61.8)
    fib_lookback: int = 120
    symbols: tuple[str, ...] | None = None          # None: every symbol with volume


# defaults per model where the logic doc says so (§3.1: the trend filter is on for V6 only)
MODEL_DEFAULTS: dict[str, dict] = {"M25": {"trend": "ema1h"}}


# ---- the chart, plain and mirrored --------------------------------------------------------------------------
@dataclass
class Bars:
    """One timeframe's bars and VSA features; ``side(d)`` gives the arrays as seen by a long (d=1) or, mirrored,
    by a short (d=-1)."""
    frame: pd.DataFrame
    f: pd.DataFrame
    ctx_n: int = 10                                      # context_bars

    def __post_init__(self):
        self.n = len(self.frame)
        self.v = self.f["volume"].to_numpy(float)
        self.vclass = self.f["vclass"].to_numpy(int)
        self.rel_n = self.f["rel_n"].to_numpy(float)
        self.small = self.f["small_spread"].to_numpy(bool)
        self.rng = self.f["range"].to_numpy(float)
        self.body = self.f["body"].to_numpy(float)
        o, h, l, c = (self.frame[k].to_numpy(float) for k in ("open", "high", "low", "close"))
        self._raw = (o, h, l, c)
        self.big = np.zeros(self.n, dtype=bool)          # §0.2 big volume: HIGH+ and above each of the 2 bars before
        self.big[2:] = (self.vclass[2:] >= HIGH) & (self.v[2:] > self.v[1:-1]) & (self.v[2:] > self.v[:-2])
        self._sides = {}

    def side(self, d: int) -> dict:
        if d not in self._sides:
            o, h, l, c = self._raw
            if d == LONG:
                s = dict(o=o, h=h, l=l, c=c, up=self.f["up"].to_numpy(bool), down=self.f["down"].to_numpy(bool),
                         pin=self.f["pin_low"].to_numpy(bool), pin_x=self.f["pin_high"].to_numpy(bool),
                         cl=self.f["close_loc"].to_numpy(float))
            else:
                s = dict(o=-o, h=-l, l=-h, c=-c, up=self.f["down"].to_numpy(bool), down=self.f["up"].to_numpy(bool),
                         pin=self.f["pin_high"].to_numpy(bool), pin_x=self.f["pin_low"].to_numpy(bool),
                         cl=1.0 - self.f["close_loc"].to_numpy(float))
            # lowest low of the last N bars including i: the "after a fall" context (§2 V1 step 1)
            s["lowest"] = s["l"] <= pd.Series(s["l"]).rolling(self.ctx_n, min_periods=1).min().to_numpy()
            self._sides[d] = s
        return self._sides[d]


def _bars(ctx: Context, tf: str, cfg: VsaConfig) -> Bars | None:
    frame = ctx.frames.get(tf)
    if frame is None or "volume" not in frame.columns or len(frame) < cfg.vol.n + 5:
        return None
    return Bars(frame, features(frame, cfg.vol), cfg.context_bars)


# ---- the six setups (long view); each yields (confirm_pos, stop_long, kind, quality: dict, notes: dict) -------
def _v1_imbalance_shift(b: Bars, s: dict, cfg: VsaConfig):
    """§2 V1: effort bar e = a down bar with big volume at a low; reaction p = e+1 an up bar on low volume closing
    above e's close. A reaction on volume >= e's is no trade (supply hit again)."""
    v, vc = b.v, b.vclass
    e = np.arange(2, b.n - 1)
    p = e + 1
    ok = (s["down"][e] & b.big[e] & s["lowest"][e] & s["up"][p] & (vc[p] >= 0) & (vc[p] <= AVERAGE)
          & (v[p] < cfg.reaction_max * v[e]) & (s["c"][p] > s["c"][e]))
    for ee, pp in zip(e[ok], p[ok]):
        three = ee >= 2 and s["down"][ee - 1] and s["down"][ee - 2] and v[ee - 2] < v[ee - 1] < v[ee]
        quality = {"effort_very_high": bool(vc[ee] >= VERY_HIGH),
                   "effort_closed_off_low": bool(s["pin"][ee] or s["cl"][ee] >= 0.4),
                   "three_bar_climax": bool(three),
                   "reaction_pink": bool(vc[pp] == LOW and v[pp] < v[ee - 1]),
                   "reaction_engulfs_body": bool(s["c"][pp] >= s["o"][ee] and s["o"][pp] <= s["c"][ee]),
                   "reaction_strong_close": bool(s["cl"][pp] >= 0.75)}
        yield pp, min(s["l"][ee], s["l"][pp]), "imbalance_shift", quality, {"effort_pos": int(ee)}


def _v2_low_volume_engulf(b: Bars, s: dict, cfg: VsaConfig):
    """§2 V2: e a down bar with big volume at a low; p = e+1 an up bar whose body engulfs e's body, on low volume."""
    v, vc = b.v, b.vclass
    e = np.arange(2, b.n - 1)
    p = e + 1
    ok = (s["down"][e] & b.big[e] & s["lowest"][e] & s["up"][p] & (vc[p] >= 0) & (vc[p] <= AVERAGE)
          & (v[p] < cfg.reaction_max * v[e]) & (s["c"][p] >= s["o"][e]) & (s["o"][p] <= s["c"][e]))
    for ee, pp in zip(e[ok], p[ok]):
        quality = {"full_engulf": bool(s["c"][pp] > s["h"][ee]),
                   "reaction_pink": bool(vc[pp] == LOW),
                   "effort_very_high": bool(vc[ee] >= VERY_HIGH),
                   "effort_pin_bar": bool(s["pin"][ee]),
                   "reaction_strong_close": bool(s["cl"][pp] >= 0.75)}
        yield pp, min(s["l"][ee], s["l"][pp]), "low_volume_engulf", quality, {"effort_pos": int(ee)}


def _v3_end_of_market(b: Bars, s: dict, cfg: VsaConfig):
    """§2 V3 (long view = end of the FALLING market / bag holding): climax = up to 3 consecutive bars ending at k,
    each a small-spread / pin / doji bar on VERY HIGH+ volume, at the low of the last N bars; p = k+1 an up bar."""
    v, vc = b.v, b.vclass
    doji = b.body <= 0.3 * b.rng
    climax = (vc >= VERY_HIGH) & (b.small | s["pin"] | doji)
    for pp in np.flatnonzero(climax[:-1]) + 1:
        k = pp - 1
        if not s["up"][pp] or not (s["c"][pp] > s["c"][k]):
            continue
        first = k
        while first > k - 2 and first - 1 >= 0 and climax[first - 1]:
            first -= 1
        low = float(np.min(s["l"][first:k + 1]))
        lo_n = float(np.min(s["l"][max(0, first - cfg.context_bars):k + 1]))
        if low > lo_n:
            continue                                                   # not at the extreme of the move
        quality = {"ultra": bool(np.any(vc[first:k + 1] >= 4)),
                   "cluster": bool(k > first),
                   "wick_shows_failed_push": bool(s["pin"][k]),
                   "confirm_low_volume": bool(0 <= vc[pp] <= AVERAGE),
                   "confirm_strong_close": bool(s["cl"][pp] >= 0.75)}
        yield pp, min(low, s["l"][pp]), "end_of_market", quality, {"climax_from": int(first), "climax_to": int(k)}


def _v4_false_break(b: Bars, s: dict, cfg: VsaConfig):
    """§2 V4 (long view = a previous swing LOW broken): bar k breaks below a confirmed swing low on big volume;
    p = k+1 an up bar on low volume."""
    v, vc, n = b.v, b.vclass, cfg.swing_n
    l = s["l"]
    lw = np.lib.stride_tricks.sliding_window_view(l, 2 * n + 1)        # window j-n .. j+n
    is_sw = np.zeros(b.n, dtype=bool)
    mid = lw[:, n]
    is_sw[n:b.n - n] = (mid < np.min(lw[:, :n], axis=1)) & (mid <= np.min(lw[:, n + 1:], axis=1))
    sw = np.flatnonzero(is_sw)
    for k in np.flatnonzero(b.big[:-1]):
        pp = k + 1
        if not (s["up"][pp] and 0 <= vc[pp] <= AVERAGE and v[pp] < cfg.reaction_max * v[k]):
            continue
        # the most recent swing low confirmed before k (j + n < k), not broken between it and k, and broken by k
        cand = sw[(sw + n < k) & (sw >= k - cfg.swing_lookback)]
        hit = None
        for j in cand[::-1]:
            if l[k] < l[j] and (k - j <= 1 or np.min(l[j + 1:k]) >= l[j]):
                hit = j
                break
        if hit is None:
            continue
        quality = {"closed_back_inside": bool(s["c"][k] > l[hit]),
                   "pin_bar": bool(s["pin"][k]),
                   "effort_very_high": bool(vc[k] >= VERY_HIGH),
                   "reaction_pink": bool(vc[pp] == LOW)}
        yield pp, min(l[k], l[pp]), "false_break", quality, {"swing_pos": int(hit), "swing_level_long": float(l[hit]),
                                                             "break_pos": int(k)}


def _events(b: Bars, s: dict):
    """Buying events (long view): a down bar with big volume whose next bar is an up bar (§2 V5 / V6 step 1)."""
    e = np.arange(2, b.n - 1)
    return e[s["down"][e] & b.big[e] & s["up"][e + 1]]


def _v5_no_supply_test(b: Bars, s: dict, cfg: VsaConfig):
    """§2 V5: after a buying event e (reaction r = e+1) price rallies above e's high; later a bar t comes back into
    e's range (low <= high[e], low >= low[e]) on low volume (below the bar before, not HIGH). Form (a): t closes up
    with a lower wick; form (b): t closes down and t+1 closes up. One signal per event, the first test."""
    v, vc = b.v, b.vclass
    for e in _events(b, s):
        r = e + 1
        rallied = False
        for t in range(r + 1, min(b.n, r + 1 + cfg.test_window)):
            if s["l"][t] < s["l"][e]:
                break                                                  # the event's low broken: it failed
            if not rallied:
                rallied = s["h"][t] > s["h"][e] and s["h"][t] > s["h"][r]
                continue
            if s["l"][t] > s["h"][e]:
                continue                                               # not back in the buying area yet
            if not (0 <= vc[t] <= AVERAGE and v[t] < v[t - 1]):
                break                                                  # the test came on volume: supply, no trade
            lower_wick = (min(s["o"][t], s["c"][t]) - s["l"][t]) >= 0.3 * max(b.rng[t], 1e-12)
            if s["up"][t] and lower_wick:
                conf, form = t, "a"
            elif t + 1 < b.n and s["up"][t + 1] and s["l"][t + 1] >= s["l"][e]:
                conf, form = t + 1, "b"
            else:
                break
            quality = {"test_pink": bool(vc[t] == LOW), "same_bar_reversal": form == "a",
                       "event_very_high": bool(vc[e] >= VERY_HIGH),
                       "confirm_strong_close": bool(s["cl"][conf] >= 0.75)}
            yield conf, min(s["l"][t], s["l"][conf]), "no_supply_test", quality, {"event_pos": int(e), "test_pos": int(t),
                                                                                  "form": form}
            break


def _v6_ar_break(b: Bars, s: dict, cfg: VsaConfig):
    """§2 V6: after a buying event e (reaction r = e+1 up) the first rally ends at the first down bar j > r;
    AR = the highest high of r..j-1. The first bar after j that CLOSES above AR decides: on low volume (below the
    bars' average, not HIGH) it is the entry; on more volume, no trade. The event's low must hold until then."""
    v, vc = b.v, b.vclass
    for e in _events(b, s):
        if cfg.fib and not _in_fib_zone(s, e, cfg):
            continue
        r = e + 1
        j = r + 1
        while j < b.n and not s["down"][j]:
            j += 1
        if j >= b.n or j - r > 10:
            continue
        ar = float(np.max(s["h"][r:j]))
        for t in range(j + 1, min(b.n, e + 1 + cfg.ar_window)):
            if s["l"][t] < s["l"][e]:
                break
            if s["c"][t] <= ar:
                continue
            if 0 <= vc[t] <= AVERAGE and b.rel_n[t] < 1.0:
                quality = {"break_pink": bool(vc[t] == LOW), "event_very_high": bool(vc[e] >= VERY_HIGH),
                           "strong_close": bool(s["cl"][t] >= 0.75), "event_pin_bar": bool(s["pin"][e])}
                yield t, s["l"][t], "ar_line_break", quality, {"event_pos": int(e), "ar_level_long": ar, "ar_pos": int(j)}
            break


def _in_fib_zone(s: dict, e: int, cfg: VsaConfig) -> bool:
    """Rule 1: the event's low inside the 50-61.8 % retracement of the up swing before it (long view)."""
    lo = max(0, e - cfg.fib_lookback)
    if e - lo < 5:
        return False
    hi_i = lo + int(np.argmax(s["h"][lo:e]))
    if hi_i - lo < 2:
        return False
    swing_low = float(np.min(s["l"][lo:hi_i]))
    top = float(s["h"][hi_i])
    if top <= swing_low:
        return False
    ret = (top - s["l"][e]) / (top - swing_low)
    return cfg.fib_zone[0] <= ret <= cfg.fib_zone[1]


DETECTORS = {"M20": _v1_imbalance_shift, "M21": _v2_low_volume_engulf, "M22": _v3_end_of_market,
             "M23": _v4_false_break, "M24": _v5_no_supply_test, "M25": _v6_ar_break}


# ---- signals ----------------------------------------------------------------------------------------------------
def scan(ctx: Context, model_id: str, cfg: VsaConfig = VsaConfig()) -> list[Signal]:
    if (cfg.symbols is not None and ctx.symbol not in cfg.symbols) or "volume" not in ctx.base.columns:
        return []
    buf = cfg.buffer if cfg.buffer is not None else BUFFER.get(ctx.symbol, ctx.spec.stop_buffer)
    trend = _trend(ctx, cfg) if cfg.trend != "none" else None
    out: list[Signal] = []
    for tf in cfg.timeframes:
        b = _bars(ctx, tf, cfg)
        if b is None:
            continue
        for d in (LONG, SHORT):
            s = b.side(d)
            for pos, stop_l, kind, quality, notes in DETECTORS[model_id](b, s, cfg):
                sig = _signal(ctx, model_id, tf, b, d, int(pos), float(stop_l), kind, quality, notes, buf, cfg, trend)
                if sig is not None:
                    out.append(sig)
    out.sort(key=lambda x: (x.created_time, x.window, x.direction))
    return out


def _signal(ctx, model_id, tf, b: Bars, d, pos, stop_l, kind, quality, notes, buf, cfg, trend) -> Signal | None:
    t = ctx.known_from(tf, pos) - 1                     # the last 1m bar of the confirming candle
    if t < 0 or t >= len(ctx.base):
        return None                                     # the candle has not closed yet
    if cfg.require_bias:
        bias = bias_at(ctx, t)
        if bias.direction != d:
            return None
    if trend is not None:
        tr = trend(t)
        if tr != d:
            return None
    s = b.side(d)
    entry_l = float(s["c"][pos])
    stop_l = stop_l - buf
    risk = entry_l - stop_l
    if risk <= 0:
        return None
    back = (lambda x: x) if d == LONG else (lambda x: -x)
    entry, stop = back(entry_l), back(stop_l)
    targets = [(back(entry_l + k * risk), f) for k, f in zip(cfg.targets_r, cfg.split)]
    created = ctx.base.index[t]
    step = b.frame.index[pos + 1] - b.frame.index[pos] if pos + 1 < b.n else pd.Timedelta(tf.replace("m", "min"))
    extra = int(sum(bool(x) for x in quality.values()))
    grade = "A+" if extra >= 3 else "A" if extra == 2 else "B"
    times = {k: str(b.frame.index[v]) for k, v in notes.items() if k.endswith("_pos") or k in ("climax_from", "climax_to")}
    levels = {k.replace("_long", ""): back(v) for k, v in notes.items() if k.endswith("_long")}
    plain = {k: v for k, v in notes.items() if not (k.endswith("_pos") or k.endswith("_long") or k in ("climax_from", "climax_to"))}
    return Signal(
        model=f"{model_id}_{kind}", symbol=ctx.symbol, direction=d, created_time=created, entry=entry, stop=stop,
        targets=targets, expiry=created + cfg.expiry_bars * step, time_stop=None, exit_by=None, window=tf,
        grade=grade, score=extra, checklist={"setup": True, **quality},
        notes={"family": "VSA", "source": "VSISA course (Sajid Ahmed), docs/research/vsisa/VSISA_LOGIC.md",
               "timeframe": tf, "confirm_time": str(b.frame.index[pos]), "times": times, "levels": levels,
               "volume": float(b.v[pos]), "volume_class": int(b.vclass[pos]), **plain})


def _trend(ctx: Context, cfg: VsaConfig):
    """§3.1 [DEFAULT]: the close of the last closed 1h bar above / below its EMA."""
    h1 = ctx.frames.get("1h")
    if h1 is None or len(h1) < cfg.trend_ema:
        return lambda t: 0
    ema = h1["close"].ewm(span=cfg.trend_ema, adjust=False).mean().to_numpy(float)
    close = h1["close"].to_numpy(float)

    def at(t: int) -> int:
        p = ctx.htf_pos("1h", t)
        if p < cfg.trend_ema:
            return 0
        return LONG if close[p] > ema[p] else SHORT if close[p] < ema[p] else 0
    return at


def _make(model_id: str):
    def scan_model(ctx: Context, **kw) -> list[Signal]:
        """The engine passes every model the same options (require_bias, manual_bias ...); VsaConfig fields are used,
        the rest ignored."""
        own = {**MODEL_DEFAULTS.get(model_id, {}), **{k: v for k, v in kw.items() if k in VsaConfig.__dataclass_fields__}}
        return scan(ctx, model_id, replace(VsaConfig(), **own) if own else VsaConfig())
    scan_model.__name__ = f"scan_{model_id.lower()}"
    return scan_model


scan_m20, scan_m21, scan_m22, scan_m23, scan_m24, scan_m25 = (_make(m) for m in ("M20", "M21", "M22", "M23", "M24", "M25"))
