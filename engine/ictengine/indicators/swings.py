"""Swing points (rulebook 2.1).

Short-term high (STH): a bar whose high is above the ``n`` bars on its left and not below
the ``n`` bars on its right (the first bar of an equal-high plateau counts). Lows mirror it.
A swing is only known once its right-side bars have closed: ``confirmed_pos = pos + n``.

Intermediate-term (ITH) and long-term (LTH) highs are swing highs of the swing highs:
an STH with lower STHs on both sides is an ITH, an ITH with lower ITHs on both sides is an
LTH. They are confirmed when the next swing on their right is confirmed.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from numpy.lib.stride_tricks import sliding_window_view

from ..core.candles import validate
from .common import NONE

SHORT, INTERMEDIATE, LONG = 1, 2, 3
COLUMNS = ["kind", "pos", "time", "price", "level", "confirmed_pos", "it_confirmed_pos", "lt_confirmed_pos"]


def find_swings(df: pd.DataFrame, n: int = 1) -> pd.DataFrame:
    """All swing highs and lows, ordered by position.

    Columns: kind ('high'|'low'), pos (bar of the extreme), time, price, level (1=ST, 2=IT,
    3=LT), confirmed_pos (when the ST swing is known), it_confirmed_pos / lt_confirmed_pos
    (when it is known to be IT / LT, or -1).
    """
    if n < 1:
        raise ValueError("n must be >= 1")
    validate(df)
    parts = []
    for kind, col in (("high", "high"), ("low", "low")):
        values = df[col].to_numpy(float)
        sign = 1.0 if kind == "high" else -1.0
        pos = _fractal_positions(sign * values, n)
        part = _classify(kind, pos, values[pos], n)
        part["time"] = df.index[pos]
        parts.append(part)
    out = pd.concat(parts, ignore_index=True).sort_values(["pos", "kind"], kind="stable").reset_index(drop=True)
    return out[COLUMNS]


def known_at(swings: pd.DataFrame, pos: int, level: int = SHORT) -> pd.DataFrame:
    """Swings of at least ``level`` that were confirmed by the close of bar ``pos``."""
    col = {SHORT: "confirmed_pos", INTERMEDIATE: "it_confirmed_pos", LONG: "lt_confirmed_pos"}[level]
    c = swings[col]
    return swings[(c != NONE) & (c <= pos)]


def _fractal_positions(x: np.ndarray, n: int) -> np.ndarray:
    """Positions i with x[i] > max(x[i-n:i]) and x[i] >= max(x[i+1:i+n+1])."""
    if len(x) < 2 * n + 1:
        return np.array([], dtype=np.int64)
    win = sliding_window_view(x, 2 * n + 1)
    centre = win[:, n]
    left = win[:, :n].max(axis=1)
    right = win[:, n + 1:].max(axis=1)
    return np.flatnonzero((centre > left) & (centre >= right)) + n


def _classify(kind: str, pos: np.ndarray, price: np.ndarray, n: int) -> pd.DataFrame:
    sign = 1.0 if kind == "high" else -1.0
    confirmed = pos + n
    level = np.full(len(pos), SHORT)
    it_conf = np.full(len(pos), NONE)
    lt_conf = np.full(len(pos), NONE)

    # ST -> IT: higher (lower for lows) than the neighbouring swings of the same kind
    it_idx = _peaks(sign * price)
    level[it_idx] = INTERMEDIATE
    it_conf[it_idx] = confirmed[it_idx + 1]
    # IT -> LT, over the IT subsequence
    if len(it_idx) >= 3:
        lt_local = _peaks(sign * price[it_idx])
        lt_idx = it_idx[lt_local]
        level[lt_idx] = LONG
        lt_conf[lt_idx] = it_conf[it_idx[lt_local + 1]]
    return pd.DataFrame({"kind": kind, "pos": pos, "price": price, "level": level,
                         "confirmed_pos": confirmed, "it_confirmed_pos": it_conf, "lt_confirmed_pos": lt_conf})


def _peaks(x: np.ndarray) -> np.ndarray:
    """Interior indices k with x[k] > x[k-1] and x[k] >= x[k+1]."""
    if len(x) < 3:
        return np.array([], dtype=np.int64)
    return np.flatnonzero((x[1:-1] > x[:-2]) & (x[1:-1] >= x[2:])) + 1
