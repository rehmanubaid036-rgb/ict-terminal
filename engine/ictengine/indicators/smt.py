"""SMT divergence between two correlated instruments (rulebook 2.12).

For each new confirmed swing high of instrument A that is a higher high than A's previous
swing high, look at B's highest high in a window around both A swings: if B did not make a
higher high, that is a bearish SMT. Lows mirror it (bullish SMT). Inverse correlations (e.g.
DXY vs EURUSD) are handled with ``inverse=True``.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..core.candles import validate

COLUMNS = ["direction", "pos", "created_pos", "time", "a_prev", "a_new", "b_prev", "b_new"]


def find_smt(a: pd.DataFrame, b: pd.DataFrame, swings_a: pd.DataFrame, window: int = 2,
             inverse: bool = False) -> pd.DataFrame:
    """``a`` and ``b`` must share the same index (align them first, e.g. with an inner join)."""
    validate(a)
    validate(b)
    if not a.index.equals(b.index):
        raise ValueError("instruments must be aligned on the same bar index")
    bh, bl = b["high"].to_numpy(float), b["low"].to_numpy(float)
    if inverse:
        bh, bl = -bl, -bh
    rows = []
    for kind, direction in (("high", -1), ("low", 1)):
        s = swings_a[swings_a["kind"] == kind].sort_values("pos")
        pos, price, conf = s["pos"].to_numpy(), s["price"].to_numpy(), s["confirmed_pos"].to_numpy()
        for k in range(1, len(s)):
            p0, p1 = int(pos[k - 1]), int(pos[k])
            made_new = price[k] > price[k - 1] if kind == "high" else price[k] < price[k - 1]
            if not made_new:
                continue
            w0 = slice(max(0, p0 - window), p0 + window + 1)
            w1 = slice(max(0, p1 - window), min(int(conf[k]) + 1, p1 + window + 1))  # no bars after confirmation
            if kind == "high":
                b0, b1 = bh[w0].max(), bh[w1].max()
                diverged = b1 <= b0
            else:
                b0, b1 = bl[w0].min(), bl[w1].min()
                diverged = b1 >= b0
            if diverged:
                rows.append((direction, p1, int(conf[k]), a.index[p1], price[k - 1], price[k], b0, b1))
    out = pd.DataFrame(rows, columns=COLUMNS)
    return out.sort_values("created_pos", kind="stable").reset_index(drop=True)
