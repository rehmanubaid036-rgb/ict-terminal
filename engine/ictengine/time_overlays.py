"""Chart objects for the time- and level-based ICT indicators (plan 5.5 A, indicators 5-11).

They are built from 1-minute candles, so the times and prices are exact on every chart
timeframe (a 4h chart still shows the true 08:30 open). Everything comes from the same
engine code the models use: ``clock`` (windows, rulebook part 1), ``levels.daily_levels`` and
``pd_array`` (IPDA, SD projections).

Object shapes (all times epoch seconds UTC, like ``analysis.overlays``):
  zone   {type, kind, key, label, t1, t2, top, bottom}            session / killzone / silver_bullet / macro / range
  level  {type, kind, key, label, t1, t2, price}                   key_level / true_open / projection / ipda
  vline  {type, kind, key, label, t}                               quarter
  gap    {type, kind, key, label, t1, t2, top, bottom, ce}         ndog / nwog / org
"""
from __future__ import annotations

from datetime import time

import numpy as np
import pandas as pd

from .core import clock
from .core.levels import OPEN_TOLERANCE_MIN, daily_levels
from .indicators.common import epoch_ns
from .indicators.pd_array import ipda_ranges, sd_projections

LAYERS = ("sessions", "key_levels", "quarters", "projections", "opening_gaps", "ipda")

KEY_LEVELS = (  # (column of daily_levels, label, from-time of the line or None = trading-day start)
    ("midnight_open", "Midnight Open", time(0, 0)),
    ("day_open", "18:00 Open", None),
    ("ny_true_open", "NY True Open", time(7, 30)),
    ("open_0830", "08:30 Open", time(8, 30)),
    ("open_0930", "09:30 Open", time(9, 30)),
    ("pdh", "PDH", None), ("pdl", "PDL", None),
    ("pwh", "PWH", None), ("pwl", "PWL", None),
)


def _sec(ts: pd.Timestamp) -> int:
    return int(ts.value // 1_000_000_000)


class _Bars:
    """Fast [start, end) slices of a 1m frame by UTC timestamp."""

    def __init__(self, df: pd.DataFrame):
        self.ns = epoch_ns(df.index)
        self.high = df["high"].to_numpy(float)
        self.low = df["low"].to_numpy(float)
        self.open = df["open"].to_numpy(float)

    def span(self, start: pd.Timestamp, end: pd.Timestamp) -> tuple[int, int]:
        return (int(np.searchsorted(self.ns, start.value, "left")),
                int(np.searchsorted(self.ns, end.value, "left")))

    def range(self, start: pd.Timestamp, end: pd.Timestamp) -> tuple[float, float] | None:
        a, b = self.span(start, end)
        if b <= a:
            return None
        return float(self.high[a:b].max()), float(self.low[a:b].min())

    def first_open(self, start: pd.Timestamp, end: pd.Timestamp) -> float | None:
        a, b = self.span(start, end)
        return float(self.open[a]) if b > a else None


def _day_bounds(day) -> tuple[pd.Timestamp, pd.Timestamp]:
    """[18:00 the evening before, 18:00) of a trading day, UTC."""
    start = clock.ny_datetime(day - pd.Timedelta(days=1), clock.TRADING_DAY_START).tz_convert(clock.UTC)
    end = clock.ny_datetime(day, clock.TRADING_DAY_START).tz_convert(clock.UTC)
    return start, end


def _zones(bars: _Bars, days, windows, kind_of=lambda w: w.kind) -> list[dict]:
    out = []
    for day in days:
        for w in windows:
            s, e = w.bounds(day)
            r = bars.range(s, e)
            if r is None:
                continue
            out.append({"type": "zone", "kind": kind_of(w), "key": w.key, "label": w.label,
                        "t1": _sec(s), "t2": _sec(e), "top": r[0], "bottom": r[1]})
    return out


def time_layers(df_1m: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp, include=LAYERS,
                max_days: int = 20, macros: bool = False, ipda_levels: pd.DataFrame | None = None) -> list[dict]:
    """Objects of the requested layers for the trading days that overlap [start, end).

    ``df_1m`` must hold 1m candles from well before ``start`` (previous week for PWH/PWL,
    60+ trading days for IPDA, unless ``ipda_levels`` - ``daily_levels`` of a longer history,
    e.g. cached by the caller - is given). At most the last ``max_days`` trading days are drawn.
    """
    if df_1m.empty:
        return []
    bad = set(include) - set(LAYERS)
    if bad:
        raise ValueError(f"unknown layers {sorted(bad)}")
    bars = _Bars(df_1m)
    lv = daily_levels(df_1m)
    all_days = [d.date() for d in lv.index]
    visible = [d for d in all_days if _day_bounds(d)[1] > start and _day_bounds(d)[0] < end][-max_days:]
    out: list[dict] = []

    if "sessions" in include:
        windows = clock.SESSIONS + clock.KILLZONES + clock.SILVER_BULLETS + (clock.MACROS if macros else ())
        out += _zones(bars, visible, windows)

    if "key_levels" in include:
        for d in visible:
            row = lv.loc[pd.Timestamp(d)]
            d0, d1 = _day_bounds(d)
            for col, label, at in KEY_LEVELS:
                price = row.get(col)
                if price is None or not np.isfinite(price):
                    continue
                t1 = d0 if at is None else clock.ny_datetime(d, at).tz_convert(clock.UTC)
                out.append({"type": "level", "kind": "key_level", "key": col, "label": label,
                            "t1": _sec(t1), "t2": _sec(d1), "price": float(price)})

    if "quarters" in include:
        for d in visible:
            for w in clock.QUARTERS:
                s, e = w.bounds(d)
                if bars.range(s, e) is None:
                    continue
                out.append({"type": "vline", "kind": "quarter", "key": w.key, "label": w.label.split()[-1], "t": _sec(s)})
            for sess in clock.SESSIONS:            # Q2 open = the session's True Open
                q2 = clock.WINDOWS[f"{sess.key}_q2"]
                s, _ = q2.bounds(d)
                _, e = sess.bounds(d)
                price = bars.first_open(s, s + pd.Timedelta(minutes=OPEN_TOLERANCE_MIN))
                if price is not None:
                    out.append({"type": "level", "kind": "true_open", "key": f"{sess.key}_true_open",
                                "label": f"{sess.label} True Open", "t1": _sec(s), "t2": _sec(e), "price": price})

    if "projections" in include:
        for d in visible:
            d1 = _day_bounds(d)[1]
            for key, label in (("asian_range", "Asian Range"), ("cbdr", "CBDR")):
                w = clock.WINDOWS[key]
                s, e = w.bounds(d)
                r = bars.range(s, e)
                if r is None or not r[0] > r[1]:
                    continue
                out.append({"type": "zone", "kind": "range", "key": key, "label": label,
                            "t1": _sec(s), "t2": _sec(e), "top": r[0], "bottom": r[1]})
                for name, price in sd_projections(r[0], r[1]).items():
                    out.append({"type": "level", "kind": "projection", "key": f"{key}_sd{name}",
                                "label": f"{label} SD {name}", "t1": _sec(e), "t2": _sec(d1), "price": float(price)})

    if "opening_gaps" in include:
        for d in visible:
            row = lv.loc[pd.Timestamp(d)]
            d0, d1 = _day_bounds(d)
            week_end = d0 + pd.Timedelta(days=7)
            gaps = (("ndog", "NDOG", d0, d1), ("nwog", "NWOG", d0, week_end))
            for key, label, t1, t2 in gaps:
                hi, lo = row.get(f"{key}_high"), row.get(f"{key}_low")
                if hi is None or not (np.isfinite(hi) and np.isfinite(lo)) or not hi > lo:
                    continue
                out.append({"type": "gap", "kind": key, "key": key, "label": label, "t1": _sec(t1),
                            "t2": _sec(min(t2, end)), "top": float(hi), "bottom": float(lo), "ce": float((hi + lo) / 2)})
            hi, lo = row.get("org_high"), row.get("org_low")
            if hi is not None and np.isfinite(hi) and np.isfinite(lo) and hi > lo:
                t1 = clock.ny_datetime(d, time(9, 30)).tz_convert(clock.UTC)
                out.append({"type": "gap", "kind": "org", "key": "org", "label": "Opening Range Gap",
                            "t1": _sec(t1), "t2": _sec(d1), "top": float(hi), "bottom": float(lo),
                            "ce": float(row["org_ce"])})

    if "ipda" in include and visible:
        ip = ipda_ranges(lv if ipda_levels is None else ipda_levels)
        last = pd.Timestamp(visible[-1])
        if last not in ip.index:
            return out
        first_t = _day_bounds(visible[0])[0]
        t2 = _day_bounds(visible[-1])[1]
        for n in (20, 40, 60):
            for side, word in (("high", "High"), ("low", "Low")):
                price = ip.loc[last, f"ipda{n}_{side}"]
                if np.isfinite(price):
                    out.append({"type": "level", "kind": "ipda", "key": f"ipda{n}_{side}", "label": f"IPDA {n}D {word}",
                                "t1": _sec(first_t), "t2": _sec(t2), "price": float(price)})
    return out

