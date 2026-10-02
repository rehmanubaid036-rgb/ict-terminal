"""One call that runs every ICT indicator on a candle frame, plus chart overlays.

``analyze(df)`` is what the API, the chart and (later) the models use, so every consumer sees
the same FVGs, pools and structure. ``overlays(analysis, pos)`` turns the state visible at bar
``pos`` into JSON-ready drawing objects for the web terminal / app chart.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

import numpy as np
import pandas as pd

from .core.candles import validate
from .indicators import blocks, fvg, imbalance, liquidity, smt, structure, swings
from .indicators.common import NONE, epoch_ns
from .indicators.pd_array import ote_zone
from .indicators.swings import known_at


@dataclass(frozen=True)
class Params:
    """Indicator settings. Values marked [DEFAULT] in the rulebook; tuned by backtests later."""
    swing_n: int = 1
    fvg_min_size: float = 0.0
    fvg_min_size_atr: float = 0.0
    eq_tol_atr: float = 0.1
    sweep_close_bars: int = 3
    disp_atr_mult: float = 1.5
    disp_body_ratio: float = 0.6
    ob_lookback: int = 5
    rb_min_wick_ratio: float = 0.5

    @classmethod
    def for_timeframe(cls, timeframe: str, **overrides) -> "Params":
        n = 1 if timeframe in ("1m", "3m", "5m") else 2  # rulebook 2.1
        return cls(**{"swing_n": n, **overrides})


@dataclass
class Analysis:
    df: pd.DataFrame
    params: Params
    swings: pd.DataFrame
    displacement: np.ndarray
    structure: pd.DataFrame
    fvgs: pd.DataFrame
    pools: pd.DataFrame
    order_blocks: pd.DataFrame
    rejection_blocks: pd.DataFrame
    volume_imbalances: pd.DataFrame
    bprs: pd.DataFrame = field(repr=False)


def analyze(df: pd.DataFrame, params: Params | None = None) -> Analysis:
    validate(df)
    p = params or Params()
    sw = swings.find_swings(df, n=p.swing_n)
    disp = structure.displacement(df, atr_mult=p.disp_atr_mult, body_ratio=p.disp_body_ratio)
    st = structure.find_structure(df, sw, disp)
    f = fvg.find_fvgs(df, min_size=p.fvg_min_size, min_size_atr=p.fvg_min_size_atr)
    return Analysis(
        df=df, params=p, swings=sw, displacement=disp, structure=st, fvgs=f,
        pools=liquidity.find_pools(df, sw, eq_tol_atr=p.eq_tol_atr, sweep_close_bars=p.sweep_close_bars),
        order_blocks=blocks.find_order_blocks(df, sw, st, lookback=p.ob_lookback),
        rejection_blocks=blocks.find_rejection_blocks(df, sw, min_wick_ratio=p.rb_min_wick_ratio),
        volume_imbalances=imbalance.find_volume_imbalances(df),
        bprs=imbalance.find_bprs(f),
    )


def overlays(a: Analysis, pos: int | None = None, lookback_bars: int = 500,
             include=("fvg", "liquidity", "structure", "order_blocks")) -> list[dict]:
    """Drawing objects visible at the close of bar ``pos`` (default: last bar).

    Only objects created within ``lookback_bars`` are returned. Times are epoch seconds (UTC),
    the format chart libraries expect. Boxes end where they stopped mattering (filled /
    failed) or at ``pos`` if still active.
    """
    n = len(a.df)
    pos = n - 1 if pos is None else pos
    if not 0 <= pos < n:
        raise IndexError(f"pos {pos} outside data of {n} bars")
    t = (epoch_ns(a.df.index) // 1_000_000_000).astype(np.int64)
    first = max(0, pos - lookback_bars)
    out: list[dict] = []

    def end_of(*events) -> int:
        done = [e for e in events if e != NONE and e <= pos]
        return min(done) if done else pos

    if "fvg" in include:
        for r in fvg.state_at(a.fvgs, pos).itertuples(index=False):
            if r.created_pos < first:
                continue
            out.append({"type": "box", "kind": "fvg", "direction": int(r.direction), "status": r.status,
                        "t1": int(t[r.c1_pos + 1]), "t2": int(t[end_of(r.filled_pos)]),
                        "top": float(r.top), "bottom": float(r.bottom), "ce": float(r.ce)})
    if "liquidity" in include:
        for r in a.pools[(a.pools["created_pos"] <= pos) & (a.pools["created_pos"] >= first)].itertuples(index=False):
            taken = r.taken_pos != NONE and r.taken_pos <= pos
            out.append({"type": "line", "kind": "liquidity", "side": r.side, "source": r.source,
                        "t1": int(t[r.pos]), "t2": int(t[r.taken_pos if taken else pos]), "price": float(r.price),
                        "status": (r.outcome or "taken") if taken else "resting"})
    if "structure" in include:
        for r in a.structure[(a.structure["pos"] <= pos) & (a.structure["pos"] >= first)].itertuples(index=False):
            out.append({"type": "label", "kind": "structure", "text": r.kind, "direction": int(r.direction),
                        "t1": int(t[r.broken_swing_pos]), "t2": int(t[r.pos]), "price": float(r.broken_price),
                        "displacement": bool(r.displacement)})
    if "order_blocks" in include:
        for r in blocks.blocks_at(a.order_blocks, pos).itertuples(index=False):
            if r.created_pos < first:
                continue
            out.append({"type": "box", "kind": "order_block", "role": r.role, "direction": int(r.direction),
                        "t1": int(t[r.pos]), "t2": int(t[end_of(r.failed_pos)]),
                        "top": float(r.high), "bottom": float(r.low), "mt": float(r.mt)})
    if "pd_ote" in include:
        dr = dealing_range_object(a, pos, t)
        if dr:
            out.append(dr)
    if "displacement" in include:
        h, lo = a.df["high"].to_numpy(float), a.df["low"].to_numpy(float)
        for i in np.flatnonzero(a.displacement[first:pos + 1]) + first:
            up = a.displacement[i] > 0          # +1 bullish / -1 bearish displacement candle
            out.append({"type": "marker", "kind": "displacement", "direction": 1 if up else -1,
                        "t": int(t[i]), "price": float(lo[i] if up else h[i])})
        vi = a.volume_imbalances
        for r in vi[(vi["pos"] >= max(first, 1)) & (vi["pos"] <= pos)].itertuples(index=False):
            out.append({"type": "box", "kind": "volume_imbalance", "direction": int(r.direction),
                        "t1": int(t[r.pos - 1]), "t2": int(t[r.pos]), "top": float(r.top), "bottom": float(r.bottom)})
    return out


def dealing_range_object(a: Analysis, pos: int, t: np.ndarray) -> dict | None:
    """Premium/discount of the latest swing range known at ``pos`` plus its OTE band.

    The leg runs from the older of the two swings to the newer one: low -> high is a leg up
    (bullish OTE = 62-79% retracement down into discount), high -> low a leg down.
    """
    k = known_at(a.swings, pos)
    hi, lo = k[k["kind"] == "high"], k[k["kind"] == "low"]
    if hi.empty or lo.empty:
        return None
    h, l_ = hi.iloc[-1], lo.iloc[-1]
    if not float(h["price"]) > float(l_["price"]):
        return None
    up = int(l_["pos"]) < int(h["pos"])
    start, end = (float(l_["price"]), float(h["price"])) if up else (float(h["price"]), float(l_["price"]))
    z_lo, sweet, z_hi = ote_zone(start, end)
    return {"type": "range", "kind": "dealing_range", "direction": 1 if up else -1,
            "t1": int(t[min(int(h["pos"]), int(l_["pos"]))]), "t2": int(t[pos]),
            "high": float(h["price"]), "low": float(l_["price"]), "eq": (float(h["price"]) + float(l_["price"])) / 2,
            "ote_top": float(z_hi), "ote_bottom": float(z_lo), "ote_sweet": float(sweet)}


def smt_overlays(a: Analysis, partner: pd.DataFrame, pos: int | None = None, lookback_bars: int = 500,
                 inverse: bool = False) -> list[dict]:
    """SMT divergences between ``a`` and a correlated instrument (e.g. XAUUSD vs XAGUSD), on the
    bars both have. A mark appears once the swing that makes it is confirmed (no look-ahead)."""
    both = a.df.index.intersection(partner.index)
    if len(both) < 10:
        return []
    mine = a.df.loc[both]
    sw = swings.find_swings(mine, n=a.params.swing_n)
    found = smt.find_smt(mine, partner.loc[both, ["open", "high", "low", "close", "volume"]], sw, inverse=inverse)
    pos = len(both) - 1 if pos is None else min(pos, len(both) - 1)
    first = max(0, pos - lookback_bars)
    t = (epoch_ns(both) // 1_000_000_000).astype(np.int64)
    out = []
    for r in found[(found["created_pos"] <= pos) & (found["pos"] >= first)].itertuples(index=False):
        out.append({"type": "label", "kind": "smt", "direction": int(r.direction), "text": "SMT",
                    "t1": int(t[r.pos]), "t2": int(t[r.pos]), "price": float(r.a_new)})
    return out


def params_dict(p: Params) -> dict:
    return asdict(p)
