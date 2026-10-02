"""Order blocks and their family (rulebook 2.7).

Bullish OB: the last down-close candle at (or just before) the low of a leg that then
breaks structure upward. Bearish OB mirrors it. The OB is known once the break closes.

  mean threshold (MT)  50% of the OB candle's body
  mitigated_pos        price first trades back into the OB
  mt_broken_pos        a candle *closes* beyond the MT (OB respect lost)
  failed_pos           a candle closes beyond the OB's far extreme -> the OB has failed
  block_type           after failing: 'breaker' if the OB's leg swept a prior swing
                       (took liquidity), otherwise 'mitigation'

Rejection blocks: swing extremes with a long wick; the zone runs from the body edge to the
wick tip.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..core.candles import validate
from .common import NONE, first_true

BULL, BEAR = 1, -1
OB_COLUMNS = ["direction", "pos", "created_pos", "time", "high", "low", "open", "close", "mt",
              "swept_prior", "mitigated_pos", "mt_broken_pos", "failed_pos", "block_type"]
RB_COLUMNS = ["direction", "pos", "created_pos", "time", "top", "bottom", "wick_ratio"]


def find_order_blocks(df: pd.DataFrame, swings: pd.DataFrame, structure: pd.DataFrame,
                      lookback: int = 5) -> pd.DataFrame:
    """One OB per structure break (``structure`` from ``find_structure``)."""
    validate(df)
    o, h, lo, c = (df[k].to_numpy(float) for k in ("open", "high", "low", "close"))
    n = len(df)
    # last confirmed swing low / high before a bar, by binary search on confirmation time
    prior = {}
    for kind in ("low", "high"):
        sk = swings[swings["kind"] == kind].sort_values("confirmed_pos", kind="stable")
        prior[kind] = (sk["confirmed_pos"].to_numpy(), sk["price"].to_numpy(float))
    rows = []
    for r in structure.itertuples(index=False):
        e = int(r.extreme_pos)
        top = min(e, int(r.pos) - 1)  # the OB always precedes the breaking candle
        want = (c < o) if r.direction == BULL else (c > o)
        cand = [i for i in range(top, max(-1, top - lookback - 1), -1) if want[i]]
        i = cand[0] if cand else top
        conf, price = prior["low" if r.direction == BULL else "high"]
        k = int(np.searchsorted(conf, e, side="left")) - 1  # confirmed_pos < e
        swept = False
        if k >= 0:
            swept = bool(lo[e] < price[k]) if r.direction == BULL else bool(h[e] > price[k])
        rows.append({"direction": r.direction, "pos": i, "created_pos": int(r.pos), "high": h[i], "low": lo[i],
                     "open": o[i], "close": c[i], "mt": (o[i] + c[i]) / 2, "swept_prior": swept})
    if not rows:
        return pd.DataFrame(columns=OB_COLUMNS)
    out = pd.DataFrame(rows).drop_duplicates(subset=["direction", "pos"], keep="first").reset_index(drop=True)
    out["time"] = df.index[out["pos"].to_numpy()]

    mit = np.full(len(out), NONE)
    mtb = np.full(len(out), NONE)
    fail = np.full(len(out), NONE)
    for k, r in enumerate(out.itertuples(index=False)):
        start = r.created_pos + 1
        if start >= n:
            continue
        if r.direction == BULL:
            mit[k] = first_true(lo <= r.high, start)
            mtb[k] = first_true(c < r.mt, start)
            fail[k] = first_true(c < r.low, start)
        else:
            mit[k] = first_true(h >= r.low, start)
            mtb[k] = first_true(c > r.mt, start)
            fail[k] = first_true(c > r.high, start)
    out["mitigated_pos"], out["mt_broken_pos"], out["failed_pos"] = mit, mtb, fail
    out["block_type"] = np.where(fail == NONE, "ob", np.where(out["swept_prior"], "breaker", "mitigation"))
    return out[OB_COLUMNS]


def blocks_at(obs: pd.DataFrame, pos: int) -> pd.DataFrame:
    """Order blocks known at bar ``pos`` with their role at that moment:
    'ob' (intact), 'breaker' / 'mitigation' (failed, now acting from the other side)."""
    vis = obs[obs["created_pos"] <= pos].copy()
    failed = (vis["failed_pos"] != NONE) & (vis["failed_pos"] <= pos)
    vis["role"] = np.where(failed, vis["block_type"], "ob")
    vis.loc[~failed, "role"] = "ob"
    return vis


def find_rejection_blocks(df: pd.DataFrame, swings: pd.DataFrame, min_wick_ratio: float = 0.5) -> pd.DataFrame:
    """Rejection blocks at swing highs (bearish) and swing lows (bullish) whose wick is at least
    ``min_wick_ratio`` of the candle range."""
    validate(df)
    o, h, lo, c = (df[k].to_numpy(float) for k in ("open", "high", "low", "close"))
    rows = []
    for r in swings.itertuples(index=False):
        i = int(r.pos)
        rng = h[i] - lo[i]
        if rng <= 0:
            continue
        if r.kind == "high":
            wick = h[i] - max(o[i], c[i])
            top, bottom, d = h[i], max(o[i], c[i]), BEAR
        else:
            wick = min(o[i], c[i]) - lo[i]
            top, bottom, d = min(o[i], c[i]), lo[i], BULL
        if wick / rng >= min_wick_ratio:
            rows.append({"direction": d, "pos": i, "created_pos": int(r.confirmed_pos), "time": df.index[i],
                         "top": top, "bottom": bottom, "wick_ratio": wick / rng})
    return pd.DataFrame(rows, columns=RB_COLUMNS)
