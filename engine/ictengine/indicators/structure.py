"""Displacement and market structure (rulebook 2.4, 2.5).

Displacement: a candle with body >= ``atr_mult`` x ATR and body/range >= ``body_ratio``.

Structure breaks use **body closes** through the most recent confirmed short-term swing:
  bullish break: close > last swing high   bearish break: close < last swing low
A break against the prevailing direction is a Market Structure Shift (MSS); one in the same
direction is a Break of Structure (BOS). The first break in the data is labelled BOS.

Each break records the leg extreme it came from (lowest low before a bullish break,
highest high before a bearish one) and whether a displacement candle drove the leg.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..core.candles import validate
from .common import atr

COLUMNS = ["pos", "time", "direction", "kind", "broken_swing_pos", "broken_price",
           "extreme_pos", "extreme_price", "displacement"]


def displacement(df: pd.DataFrame, atr_mult: float = 1.5, body_ratio: float = 0.6,
                 atr_period: int = 14) -> np.ndarray:
    """+1 bullish displacement candle, -1 bearish, 0 otherwise. Uses the ATR of the previous
    bar so the candle being judged does not inflate its own yardstick."""
    validate(df)
    o, h, lo, c = (df[k].to_numpy(float) for k in ("open", "high", "low", "close"))
    a = np.r_[np.nan, atr(df, atr_period)[:-1]]
    body = np.abs(c - o)
    rng = h - lo
    with np.errstate(invalid="ignore", divide="ignore"):
        strong = (body >= atr_mult * a) & (body >= body_ratio * rng) & (rng > 0)
    return np.where(strong, np.sign(c - o), 0).astype(int)


def find_structure(df: pd.DataFrame, swings: pd.DataFrame, disp: np.ndarray | None = None) -> pd.DataFrame:
    """Every BOS / MSS. ``swings`` from ``find_swings`` (short-term level is used)."""
    validate(df)
    if disp is None:
        disp = displacement(df)
    h, lo, c = (df[k].to_numpy(float) for k in ("high", "low", "close"))
    sw = swings.sort_values("confirmed_pos", kind="stable")
    s_kind, s_pos = sw["kind"].to_numpy(), sw["pos"].to_numpy()
    s_price, s_conf = sw["price"].to_numpy(), sw["confirmed_pos"].to_numpy()

    events = []
    trend = 0
    last_high = last_low = None  # (pos, price) of the latest unbroken confirmed swing
    k = 0
    for t in range(len(df)):
        while k < len(sw) and s_conf[k] < t:  # a swing confirmed at bar c is usable from c + 1
            if s_kind[k] == "high":
                last_high = (s_pos[k], s_price[k])
            else:
                last_low = (s_pos[k], s_price[k])
            k += 1
        if last_high is not None and c[t] > last_high[1]:
            sp = last_high[0]
            ext = sp + int(np.argmin(lo[sp:t + 1]))
            events.append((t, 1, "MSS" if trend == -1 else "BOS", sp, last_high[1], ext, lo[ext],
                           bool((disp[ext:t + 1] == 1).any())))
            trend, last_high = 1, None
        elif last_low is not None and c[t] < last_low[1]:
            sp = last_low[0]
            ext = sp + int(np.argmax(h[sp:t + 1]))
            events.append((t, -1, "MSS" if trend == 1 else "BOS", sp, last_low[1], ext, h[ext],
                           bool((disp[ext:t + 1] == -1).any())))
            trend, last_low = -1, None
    out = pd.DataFrame(events, columns=[x for x in COLUMNS if x != "time"])
    out["time"] = df.index[out["pos"].to_numpy()] if len(out) else pd.DatetimeIndex([], tz="UTC")
    return out[COLUMNS]


def trend_at(structure: pd.DataFrame, pos: int) -> int:
    """Direction of the last structure break at or before ``pos`` (0 if none)."""
    past = structure[structure["pos"] <= pos]
    return int(past["direction"].iloc[-1]) if len(past) else 0
