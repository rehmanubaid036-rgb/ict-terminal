"""Small numeric helpers shared by the indicators."""
from __future__ import annotations

import numpy as np
import pandas as pd

NONE = -1  # "no position" marker in integer position columns


def epoch_ns(index: pd.DatetimeIndex) -> np.ndarray:
    """Nanoseconds since epoch. Never use ``.asi8`` directly: pandas indexes can hold
    second / milli / microsecond units, and ``asi8`` returns raw values in that unit."""
    return index.as_unit("ns").asi8


def atr(df: pd.DataFrame, period: int = 14) -> np.ndarray:
    """Wilder's Average True Range. The first ``period - 1`` values are NaN."""
    h, lo, c = df["high"].to_numpy(float), df["low"].to_numpy(float), df["close"].to_numpy(float)
    prev_c = np.r_[np.nan, c[:-1]]
    tr = np.nanmax(np.vstack([h - lo, np.abs(h - prev_c), np.abs(lo - prev_c)]), axis=0)
    out = np.full(len(tr), np.nan)
    if len(tr) < period:
        return out
    out[period - 1] = tr[:period].mean()
    for i in range(period, len(tr)):
        out[i] = (out[i - 1] * (period - 1) + tr[i]) / period
    return out


def first_true(mask: np.ndarray, start: int) -> int:
    """Index of the first True in ``mask[start:]``, or NONE. Searches in growing chunks so
    events that happen soon (the usual case) are found without scanning the whole array."""
    n = len(mask)
    lo, size = start, 256
    while lo < n:
        hi = min(n, lo + size)
        chunk = mask[lo:hi]
        if chunk.any():
            return lo + int(np.argmax(chunk))
        lo, size = hi, size * 4
    return NONE
