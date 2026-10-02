"""Daily ICT reference levels per trading day (rulebook 1.6, 2.6 gaps, M13 ORG).

``daily_levels(df)`` returns one row per trading day. Each value becomes known at a
specific time, so callers must not use a level before then:

* an open (``midnight_open`` …)        -> at that bar's open
* a window range (``asian_range_high``) -> when the window ends (see ``clock.get_window(..).bounds``)
* ``day_high`` / ``day_low``            -> only after the trading day closes (18:00 NY)
* ``pdh``, ``pdl``, ``pwh``, ``pwl``, gaps -> at the start of the trading day
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import clock
from .candles import validate

# window key -> column prefix in the result
RANGE_WINDOWS = {
    "asia": "asia", "london": "london", "ny_am": "ny_am", "ny_pm": "ny_pm",
    "asian_range": "asian_range", "cbdr": "cbdr",
}
OPEN_TOLERANCE_MIN = 5   # an open may come from a bar up to 5 min late (data gaps)
RTH_CLOSE_MIN = 16 * 60 + 15  # 16:15 NY: index cash-session close used by the Opening Range Gap


def daily_levels(df: pd.DataFrame) -> pd.DataFrame:
    validate(df)
    if df.empty:
        return pd.DataFrame()
    idx = df.index
    mod = clock.minute_of_day(idx)
    tday = clock.trading_days(idx)
    o, h, lo, c = (df[k].to_numpy() for k in ("open", "high", "low", "close"))
    days = np.unique(tday)
    out = pd.DataFrame(index=pd.Index(days, name="trading_day"))

    # trading-day OHLC
    g = pd.DataFrame({"d": tday, "o": o, "h": h, "l": lo, "c": c}).groupby("d", sort=True)
    out["day_open"] = g["o"].first().reindex(days).to_numpy()
    out["day_high"] = g["h"].max().reindex(days).to_numpy()
    out["day_low"] = g["l"].min().reindex(days).to_numpy()
    out["day_close"] = g["c"].last().reindex(days).to_numpy()

    # reference opens (exact minute, or the first bar shortly after it)
    for ref in clock.REFERENCE_OPENS:
        if ref.key == "day_open":
            continue
        t = ref.at.hour * 60 + ref.at.minute
        sel = (mod >= t) & (mod < t + OPEN_TOLERANCE_MIN)
        first = pd.Series(o[sel]).groupby(tday[sel]).first()
        out[ref.key] = first.reindex(days).to_numpy()

    # window ranges
    for key, prefix in RANGE_WINDOWS.items():
        w = clock.get_window(key)
        sel = w.mask(idx)
        labels = window_trading_days(idx, w)[sel]
        gh = pd.Series(h[sel]).groupby(labels)
        gl = pd.Series(lo[sel]).groupby(labels)
        out[f"{prefix}_high"] = gh.max().reindex(days).to_numpy()
        out[f"{prefix}_low"] = gl.min().reindex(days).to_numpy()

    # previous day / previous week
    out["pdh"] = out["day_high"].shift(1)
    out["pdl"] = out["day_low"].shift(1)
    week = _week_id(days)
    wk = pd.DataFrame({"w": week, "h": out["day_high"].to_numpy(), "l": out["day_low"].to_numpy(),
                       "o": out["day_open"].to_numpy(), "c": out["day_close"].to_numpy()}).groupby("w", sort=True)
    weeks = np.unique(week)
    prev_wh = wk["h"].max().reindex(weeks).shift(1)
    prev_wl = wk["l"].min().reindex(weeks).shift(1)
    prev_wc = wk["c"].last().reindex(weeks).shift(1)
    out["pwh"] = prev_wh.reindex(week).to_numpy()
    out["pwl"] = prev_wl.reindex(week).to_numpy()

    # New Day Opening Gap: previous trading day's last close vs this day's first open
    prev_close = out["day_close"].shift(1).to_numpy()
    day_open = out["day_open"].to_numpy()
    out["ndog_high"] = np.maximum(prev_close, day_open)
    out["ndog_low"] = np.minimum(prev_close, day_open)
    # New Week Opening Gap: only on the first trading day of a week
    first_of_week = np.r_[True, week[1:] != week[:-1]]
    nw_prev = prev_wc.reindex(week).to_numpy()
    out["nwog_high"] = np.where(first_of_week, np.maximum(nw_prev, day_open), np.nan)
    out["nwog_low"] = np.where(first_of_week, np.minimum(nw_prev, day_open), np.nan)

    # Opening Range Gap (indices): previous day's 16:15 close vs today's 09:30 open
    rth = mod < RTH_CLOSE_MIN
    rth &= mod >= 9 * 60 + 30
    rth_close = pd.Series(c[rth]).groupby(tday[rth]).last().reindex(days)
    prev_rth_close = rth_close.shift(1).to_numpy()
    out["rth_close"] = rth_close.to_numpy()
    out["org_high"] = np.maximum(prev_rth_close, out["open_0930"].to_numpy())
    out["org_low"] = np.minimum(prev_rth_close, out["open_0930"].to_numpy())
    out["org_ce"] = (out["org_high"] + out["org_low"]) / 2

    out.index = pd.to_datetime(out.index)
    return out


def window_trading_days(index: pd.DatetimeIndex, window: clock.TimeWindow) -> np.ndarray:
    """Trading day each bar of ``window`` is used for. Differs from the bar's own trading day
    only for windows that start before 18:00 on the evening before (the CBDR)."""
    days = clock.trading_days(index)
    if window.offset_days == -1 and window.start_min < clock._DAY_START_MIN:
        before_roll = clock.minute_of_day(index) < clock._DAY_START_MIN
        days = days + before_roll.astype("timedelta64[D]")
    return days


def _week_id(days: np.ndarray) -> np.ndarray:
    """Week number (Sunday-evening start) of each trading day. Trading days are Mon..Fri
    (a Sunday 18:00 open belongs to Monday), so ISO weeks group them correctly."""
    d = pd.to_datetime(days)
    iso = d.isocalendar()
    return (iso["year"].to_numpy().astype(np.int64) * 100 + iso["week"].to_numpy().astype(np.int64))
