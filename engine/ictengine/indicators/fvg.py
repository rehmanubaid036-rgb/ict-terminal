"""Fair Value Gaps (rulebook 2.6).

Three candles c1, c2, c3:
  bullish FVG (BISI): c1.high < c3.low  -> gap [c1.high, c3.low]
  bearish FVG (SIBI): c1.low  > c3.high -> gap [c3.high, c1.low]
The gap exists once c3 closes (``created_pos`` = c3). CE (consequent encroachment) is its 50%.

Lifecycle, scanned from the bar after c3 (positions are -1 until it happens):
  touched_pos   price trades back into the gap
  ce_pos        price trades to the CE
  filled_pos    price trades through the far edge (gap fully rebalanced)
  inverted_pos  a candle *closes* beyond the far edge: the FVG becomes an inversion FVG
                (IFVG) and acts from the other side
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..core.candles import validate
from .common import NONE, atr, first_true

BULL, BEAR = 1, -1
COLUMNS = ["direction", "c1_pos", "created_pos", "time", "bottom", "top", "ce", "height", "height_atr",
           "touched_pos", "ce_pos", "filled_pos", "inverted_pos"]


def find_fvgs(df: pd.DataFrame, min_size: float = 0.0, min_size_atr: float = 0.0,
              atr_period: int = 14) -> pd.DataFrame:
    """Every FVG at least ``min_size`` (price units) and ``min_size_atr`` x ATR wide.

    ``height_atr`` is the gap height divided by the ATR at c1 (NaN at the start of the data).
    """
    validate(df)
    h, lo, c = (df[k].to_numpy(float) for k in ("high", "low", "close"))
    n = len(df)
    if n < 3:
        return pd.DataFrame(columns=COLUMNS)
    a = atr(df, atr_period)

    rows = []
    for direction in (BULL, BEAR):
        if direction == BULL:
            bottom, top = h[:-2], lo[2:]
        else:
            bottom, top = h[2:], lo[:-2]
        size = top - bottom
        c1 = np.flatnonzero(size > 0)
        if len(c1) == 0:
            continue
        sz = size[c1]
        sz_atr = sz / a[c1]
        keep = sz >= min_size
        if min_size_atr > 0:
            keep &= sz_atr >= min_size_atr  # NaN ATR (start of data) never qualifies
        c1, sz, sz_atr = c1[keep], sz[keep], sz_atr[keep]
        rows.append(pd.DataFrame({
            "direction": direction, "c1_pos": c1, "created_pos": c1 + 2,
            "bottom": bottom[c1], "top": top[c1], "height": sz, "height_atr": sz_atr,
        }))
    if not rows:
        return pd.DataFrame(columns=COLUMNS)
    out = pd.concat(rows, ignore_index=True).sort_values(["created_pos", "direction"], kind="stable")
    out = out.reset_index(drop=True)
    out["ce"] = (out["top"] + out["bottom"]) / 2
    out["time"] = df.index[out["c1_pos"].to_numpy() + 1]  # drawn from the displacement candle c2

    events = {k: np.full(len(out), NONE) for k in ("touched_pos", "ce_pos", "filled_pos", "inverted_pos")}
    for i, r in enumerate(out.itertuples(index=False)):
        start = r.created_pos + 1
        if start >= n:
            continue
        if r.direction == BULL:
            touched, ce, filled, inverted = lo <= r.top, lo <= r.ce, lo <= r.bottom, c < r.bottom
        else:
            touched, ce, filled, inverted = h >= r.bottom, h >= r.ce, h >= r.top, c > r.top
        events["touched_pos"][i] = first_true(touched, start)
        if events["touched_pos"][i] == NONE:
            continue  # nothing else can happen before the first touch
        t = events["touched_pos"][i]
        events["ce_pos"][i] = first_true(ce, t)
        events["filled_pos"][i] = NONE if events["ce_pos"][i] == NONE else first_true(filled, events["ce_pos"][i])
        events["inverted_pos"][i] = NONE if events["filled_pos"][i] == NONE else first_true(inverted, events["filled_pos"][i])
    for k, v in events.items():
        out[k] = v
    return out[COLUMNS]


def state_at(fvgs: pd.DataFrame, pos: int) -> pd.DataFrame:
    """FVGs that exist at the close of bar ``pos`` with their status at that moment
    ('fresh', 'touched', 'ce', 'filled' or 'inverted'). Later events are hidden."""
    vis = fvgs[fvgs["created_pos"] <= pos].copy()
    status = np.full(len(vis), "fresh", dtype=object)
    for col, name in (("touched_pos", "touched"), ("ce_pos", "ce"), ("filled_pos", "filled"),
                      ("inverted_pos", "inverted")):
        v = vis[col].to_numpy()
        status[(v != NONE) & (v <= pos)] = name
    vis["status"] = status
    return vis


def active_at(fvgs: pd.DataFrame, pos: int, direction: int | None = None) -> pd.DataFrame:
    """FVGs still usable as entry arrays at bar ``pos``: created and not yet filled."""
    s = state_at(fvgs, pos)
    s = s[s["status"].isin(["fresh", "touched", "ce"])]
    if direction is not None:
        s = s[s["direction"] == direction]
    return s
