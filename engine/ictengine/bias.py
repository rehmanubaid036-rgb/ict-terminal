"""Daily bias (rulebook section 3), evaluated as-of a base bar.

Score components (each -1, 0 or +1):
  daily_structure   direction of the last daily BOS/MSS
  h4_structure      direction of the last 4h BOS/MSS
  ipda_zone         +1 if price is in the discount half of the 20-day IPDA range, -1 in premium
  pd_reaction       +1 if today raided the previous day's low and reclaimed it, -1 for the high
Bias is the sign of the score when |score| >= ``min_score``.

The draw on liquidity is the nearest resting daily/4h pool (or PDH/PDL) in the bias direction.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .context import Context
from .indicators.liquidity import BSL, SSL, resting_at
from .indicators.structure import trend_at


@dataclass
class Bias:
    direction: int                      # +1 bullish, -1 bearish, 0 neutral
    score: int
    components: dict[str, int] = field(default_factory=dict)
    draw: float | None = None           # draw on liquidity price
    draw_source: str = ""
    ipda_position: float | None = None  # 0..1 inside the 20-day IPDA range


def bias_at(ctx: Context, t: int, min_score: int = 2) -> Bias:
    price = ctx.price(t)
    comp: dict[str, int] = {}

    for name, tf in (("daily_structure", "1d"), ("h4_structure", "4h")):
        p = ctx.htf_pos(tf, t)
        comp[name] = trend_at(ctx.analyses[tf].structure, p) if p >= 0 else 0

    ipda_pos = None
    day = ctx.trading_day[t]
    row = ctx.ipda.loc[ctx.ipda.index == np.datetime64(day, "ns")]
    if len(row) and np.isfinite(row["ipda20_high"].iloc[0]):
        hi, lo = float(row["ipda20_high"].iloc[0]), float(row["ipda20_low"].iloc[0])
        if hi > lo:
            ipda_pos = (price - lo) / (hi - lo)
            comp["ipda_zone"] = 1 if ipda_pos < 0.5 else -1 if ipda_pos > 0.5 else 0
    comp.setdefault("ipda_zone", 0)

    comp["pd_reaction"] = 0
    lv = ctx.day_levels(t)
    if lv is not None:
        first = int(np.searchsorted(ctx.trading_day, day))
        today = ctx.base.iloc[first:t + 1]
        if np.isfinite(lv["pdl"]) and today["low"].min() < lv["pdl"] < price:
            comp["pd_reaction"] += 1
        if np.isfinite(lv["pdh"]) and today["high"].max() > lv["pdh"] > price:
            comp["pd_reaction"] -= 1

    score = int(sum(comp.values()))
    direction = int(np.sign(score)) if abs(score) >= min_score else 0
    draw, src = _draw_on_liquidity(ctx, t, direction, price, lv)
    return Bias(direction, score, comp, draw, src, ipda_pos)


def _draw_on_liquidity(ctx: Context, t: int, direction: int, price: float, lv) -> tuple[float | None, str]:
    if direction == 0:
        return None, ""
    side = BSL if direction == 1 else SSL
    cands: list[tuple[float, str]] = []
    for tf in ("1d", "4h"):
        p = ctx.htf_pos(tf, t)
        if p < 0:
            continue
        for r in resting_at(ctx.analyses[tf].pools, p, side).itertuples(index=False):
            cands.append((float(r.price), f"{tf}_{r.source}"))
    if lv is not None:
        for key in (("pdh",) if direction == 1 else ("pdl",)):
            if np.isfinite(lv[key]):
                cands.append((float(lv[key]), key))
    ahead = [(p, s) for p, s in cands if direction * (p - price) > 0]
    if not ahead:
        return None, ""
    return min(ahead, key=lambda x: abs(x[0] - price))
