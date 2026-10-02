"""Liquidity pools and raids (rulebook 2.2, 2.3).

Buy-side liquidity (BSL) rests above swing highs, sell-side liquidity (SSL) below swing
lows. Two or more swing highs within ``eq_tol_atr`` x ATR of each other, with no raid in
between, form relative equal highs (EQH); lows likewise form EQL.

When price trades beyond a pool (``taken_pos``) the outcome is:
  'sweep'  a close back on the original side within ``sweep_close_bars`` bars (stop raid,
           turtle soup) -> ``reclaim_pos`` is that bar
  'run'    no close back inside in time: liquidity taken and price accepted beyond it
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..core.candles import validate
from .common import NONE, atr, first_true

BSL, SSL = "bsl", "ssl"
COLUMNS = ["side", "source", "price", "pos", "created_pos", "members", "level",
           "taken_pos", "outcome", "reclaim_pos"]


def find_pools(df: pd.DataFrame, swings: pd.DataFrame, eq_tol_atr: float = 0.1,
               sweep_close_bars: int = 3, atr_period: int = 14, min_level: int = 1) -> pd.DataFrame:
    """Pools from swing points (``swings`` from ``find_swings``) plus EQH/EQL clusters."""
    validate(df)
    if sweep_close_bars < 1:
        raise ValueError("sweep_close_bars must be >= 1")
    h, lo, c = (df[k].to_numpy(float) for k in ("high", "low", "close"))
    a = atr(df, atr_period)
    rows = []
    for kind, side in (("high", BSL), ("low", SSL)):
        sw = swings[(swings["kind"] == kind) & (swings["level"] >= min_level)].sort_values("pos")
        for r in sw.itertuples(index=False):
            rows.append({"side": side, "source": "swing", "price": r.price, "pos": r.pos,
                         "created_pos": r.confirmed_pos, "members": (r.pos,), "level": r.level})
        rows.extend(_equal_clusters(sw, side, a, h, lo, eq_tol_atr))
    if not rows:
        return pd.DataFrame(columns=COLUMNS)
    out = pd.DataFrame(rows).sort_values(["created_pos", "side", "source"], kind="stable").reset_index(drop=True)

    taken = np.full(len(out), NONE)
    reclaim = np.full(len(out), NONE)
    outcome = np.full(len(out), "", dtype=object)
    n = len(df)
    for i, r in enumerate(out.itertuples(index=False)):
        start = r.created_pos + 1
        if start >= n:
            continue
        beyond = h > r.price if r.side == BSL else lo < r.price
        t = first_true(beyond, start)
        if t == NONE:
            continue
        taken[i] = t
        end = min(n, t + sweep_close_bars)
        back = c[t:end] < r.price if r.side == BSL else c[t:end] > r.price
        if back.any():
            outcome[i], reclaim[i] = "sweep", t + int(np.argmax(back))
        elif end - t == sweep_close_bars:
            outcome[i] = "run"
        # else: data ends before the outcome is decided -> leave outcome empty
    out["taken_pos"], out["outcome"], out["reclaim_pos"] = taken, outcome, reclaim
    return out[COLUMNS]


def _equal_clusters(sw: pd.DataFrame, side: str, a: np.ndarray, h: np.ndarray, lo: np.ndarray,
                    eq_tol_atr: float) -> list[dict]:
    """Groups consecutive same-side swings whose prices stay within tolerance and that were
    not raided before the next member formed."""
    out = []
    prices, pos, conf = sw["price"].to_numpy(), sw["pos"].to_numpy(), sw["confirmed_pos"].to_numpy()
    k = 0
    while k < len(prices):
        members = [k]
        j = k + 1
        while j < len(prices):
            tol = eq_tol_atr * a[pos[j]]
            if not np.isfinite(tol):
                break
            ref = max(prices[m] for m in members) if side == BSL else min(prices[m] for m in members)
            if abs(prices[j] - ref) > tol:
                break
            # raided between the last member and this swing? then it is not resting liquidity
            seg = slice(pos[members[-1]] + 1, pos[j])
            raided = (h[seg] > ref).any() if side == BSL else (lo[seg] < ref).any()
            if raided:
                break
            members.append(j)
            j += 1
        if len(members) >= 2:
            mp = prices[members]
            out.append({"side": side, "source": "eqh" if side == BSL else "eql",
                        "price": mp.max() if side == BSL else mp.min(),
                        "pos": int(pos[members[0]]), "created_pos": int(conf[members[-1]]),
                        "members": tuple(int(pos[m]) for m in members), "level": 1})
        k = members[-1] + 1 if len(members) >= 2 else k + 1
    return out


def resting_at(pools: pd.DataFrame, pos: int, side: str | None = None) -> pd.DataFrame:
    """Pools known at bar ``pos`` that price has not traded through yet."""
    p = pools[(pools["created_pos"] <= pos) & ((pools["taken_pos"] == NONE) | (pools["taken_pos"] > pos))]
    return p if side is None else p[p["side"] == side]


def raids_at(pools: pd.DataFrame, pos: int) -> pd.DataFrame:
    """Sweeps whose reclaim (close back inside) happened exactly on bar ``pos``."""
    return pools[(pools["outcome"] == "sweep") & (pools["reclaim_pos"] == pos)]
