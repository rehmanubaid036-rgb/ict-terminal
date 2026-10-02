"""Volume imbalances and balanced price ranges (rulebook 2.6).

Volume imbalance (VI): consecutive candles whose bodies do not overlap while their wicks do.
  bullish: min(body2) > max(body1) and low2 <= high1 -> zone [max(body1), min(body2)]
Balanced price range (BPR): a bullish and a bearish FVG overlapping in price, the second one
forming within ``max_bars_apart`` bars of the first (the second leg necessarily trades through
the first gap) -> zone is the overlap.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..core.candles import validate
from .fvg import BULL, BEAR

VI_COLUMNS = ["direction", "pos", "time", "bottom", "top"]
BPR_COLUMNS = ["first_pos", "second_pos", "created_pos", "bottom", "top", "direction"]


def find_volume_imbalances(df: pd.DataFrame, min_size: float = 0.0) -> pd.DataFrame:
    validate(df)
    o, h, lo, c = (df[k].to_numpy(float) for k in ("open", "high", "low", "close"))
    b_hi, b_lo = np.maximum(o, c), np.minimum(o, c)
    up = (b_lo[1:] > b_hi[:-1]) & (lo[1:] <= h[:-1]) & (b_lo[1:] - b_hi[:-1] >= max(min_size, 1e-12))
    dn = (b_hi[1:] < b_lo[:-1]) & (h[1:] >= lo[:-1]) & (b_lo[:-1] - b_hi[1:] >= max(min_size, 1e-12))
    rows = []
    for i in np.flatnonzero(up) + 1:
        rows.append((BULL, i, df.index[i], b_hi[i - 1], b_lo[i]))
    for i in np.flatnonzero(dn) + 1:
        rows.append((BEAR, i, df.index[i], b_hi[i], b_lo[i - 1]))
    out = pd.DataFrame(rows, columns=VI_COLUMNS)
    return out.sort_values("pos", kind="stable").reset_index(drop=True)


def find_bprs(fvgs: pd.DataFrame, max_bars_apart: int = 60) -> pd.DataFrame:
    """BPRs from ``find_fvgs`` output. ``direction`` is that of the later (second) FVG."""
    if fvgs.empty:
        return pd.DataFrame(columns=BPR_COLUMNS)
    f = fvgs.sort_values("created_pos", kind="stable").reset_index(drop=True)
    cp = f["created_pos"].to_numpy()
    dr = f["direction"].to_numpy()
    bo = f["bottom"].to_numpy(float)
    tp = f["top"].to_numpy(float)
    rows = []
    for i in range(len(f)):
        j0 = int(np.searchsorted(cp, cp[i], side="right"))
        j1 = int(np.searchsorted(cp, cp[i] + max_bars_apart, side="right"))
        if j1 <= j0:
            continue
        js = np.arange(j0, j1)
        js = js[dr[js] != dr[i]]
        lo = np.maximum(bo[i], bo[js])
        hi = np.minimum(tp[i], tp[js])
        for j, l_, h_ in zip(js[hi > lo], lo[hi > lo], hi[hi > lo]):
            rows.append((int(cp[i]), int(cp[j]), int(cp[j]), float(l_), float(h_), int(dr[j])))
    return pd.DataFrame(rows, columns=BPR_COLUMNS)
