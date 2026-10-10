"""Volume and candle features for the VSA Models (VSISA course, docs/research/vsisa/VSISA_LOGIC.md).

Nothing here is ICT: these are the course's own measurements, kept separate from the ICT indicators.

Volume is always RELATIVE (course part 1 [02:53], part 4 [04:55], part 13 [03:21]): a bar's volume is compared
with
  * the bars just before it (rolling mean of ``n`` bars), and
  * the same time of day on the previous ``days`` trading days ("compare with the session's volumes of the
    last 2-3 days"), so a London-open bar is not called big only because London opens.
``rel`` is the smaller of the two ratios: a bar is big only when it is big in both senses. The classes copy the
"VSA Relative Volume" indicator the course reads (pink = low ... top band = ultra high); the thresholds are
[DEFAULT] values (the course gives no numbers) and live in ``VolParams``.

Everything at bar ``i`` uses bars ``<= i`` only (no look-ahead).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from ..core import clock

LOW, AVERAGE, HIGH, VERY_HIGH, ULTRA = 0, 1, 2, 3, 4


@dataclass(frozen=True)
class VolParams:
    n: int = 20                 # rolling mean of the bars before (the indicator's average line)
    days: int = 3               # same time of day on the previous trading days (course: "2-3 days")
    low: float = 0.8            # rel < low                -> LOW (pink)
    high: float = 1.3           # rel >= high              -> HIGH ("above the average")
    very_high: float = 1.8      # rel >= very_high         -> VERY_HIGH
    ultra: float = 2.5          # rel >= ultra             -> ULTRA (top band)
    small_spread: float = 0.7   # range < small_spread x the mean range of the last n bars -> small spread
    pin_wick: float = 0.5       # wick >= pin_wick x range -> pin bar (screenshots: "wick half of the body")
    combine: str = "min"        # rel from rel_n and rel_tod: 'min' (big in both senses) | 'mean' | 'n' | 'tod'


def features(frame: pd.DataFrame, p: VolParams = VolParams()) -> pd.DataFrame:
    """One row per bar of ``frame`` (open/high/low/close/volume, UTC index)."""
    o, h, lo, c = (frame[k].to_numpy(float) for k in ("open", "high", "low", "close"))
    v = frame["volume"].to_numpy(float) if "volume" in frame.columns else np.full(len(frame), np.nan)
    rng = h - lo
    body = np.abs(c - o)
    upper = h - np.maximum(o, c)
    lower = np.minimum(o, c) - lo
    with np.errstate(invalid="ignore", divide="ignore"):
        close_loc = np.where(rng > 0, (c - lo) / rng, 0.5)        # 0 = closed on the low, 1 = on the high
    vs = pd.Series(v, index=frame.index)
    avg_n = vs.shift(1).rolling(p.n, min_periods=max(3, p.n // 2)).mean().to_numpy()
    avg_tod = _time_of_day_mean(vs, p.days)
    with np.errstate(invalid="ignore", divide="ignore"):
        rel_n = v / avg_n
        rel_tod = v / avg_tod
    both = {"min": np.fmin(rel_n, rel_tod), "mean": (rel_n + rel_tod) / 2, "n": rel_n, "tod": rel_tod}[p.combine]
    rel = rel_n if p.combine == "n" else np.where(np.isfinite(rel_tod), both, rel_n)
    vclass = np.select([rel >= p.ultra, rel >= p.very_high, rel >= p.high, rel >= p.low], [ULTRA, VERY_HIGH, HIGH, AVERAGE],
                       LOW)
    vclass = np.where(np.isfinite(rel), vclass, -1)                 # -1: not enough history yet
    mean_rng = pd.Series(rng).shift(1).rolling(p.n, min_periods=max(3, p.n // 2)).mean().to_numpy()
    with np.errstate(invalid="ignore"):
        small = rng < p.small_spread * mean_rng
        pin_low = (rng > 0) & (lower >= p.pin_wick * rng)          # long lower wick (hammer / down pin bar)
        pin_high = (rng > 0) & (upper >= p.pin_wick * rng)         # long upper wick (upthrust / shooting star)
    return pd.DataFrame({
        "up": c > o, "down": c < o, "range": rng, "body": body, "upper": upper, "lower": lower,
        "close_loc": close_loc, "volume": v, "avg_n": avg_n, "avg_tod": avg_tod, "rel_n": rel_n, "rel_tod": rel_tod,
        "rel": rel, "vclass": vclass, "small_spread": small, "pin_low": pin_low, "pin_high": pin_high,
        "mean_range": mean_rng,
    }, index=frame.index)


def _time_of_day_mean(vs: pd.Series, days: int) -> np.ndarray:
    """Mean volume of the bars with the same New York time of day on the previous ``days`` trading days."""
    if days <= 0 or len(vs) == 0:
        return np.full(len(vs), np.nan)
    key = clock.minute_of_day(vs.index)
    g = vs.groupby(key)
    out = g.transform(lambda s: s.shift(1).rolling(days, min_periods=1).mean())
    # a bucket seen only on the same day (e.g. daily bars) has no earlier day: leave it to the rolling mean
    return out.to_numpy(float)
