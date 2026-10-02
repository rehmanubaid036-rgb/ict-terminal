"""Premium / discount, OTE, standard-deviation projections, IPDA ranges and institutional
price levels (rulebook 1.7, 2.8, 2.9, 2.11, 2.11b)."""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import pandas as pd

from .swings import SHORT, known_at

RETRACEMENTS = (0.0, 0.5, 0.62, 0.705, 0.79, 1.0)
EXTENSIONS = (-0.27, -0.5, -0.62, -1.0, -2.0, -2.5, -4.0)
OTE_LOW, OTE_SWEET, OTE_HIGH = 0.62, 0.705, 0.79


@dataclass(frozen=True)
class DealingRange:
    high: float
    low: float

    def __post_init__(self):
        if not self.high > self.low:
            raise ValueError(f"dealing range needs high > low, got {self.high} / {self.low}")

    @property
    def equilibrium(self) -> float:
        return (self.high + self.low) / 2

    def position(self, price: float) -> float:
        """0.0 at the low, 1.0 at the high (0.323 = 32.3%, deep in discount)."""
        return (price - self.low) / (self.high - self.low)

    def zone(self, price: float) -> str:
        p = self.position(price)
        return "premium" if p > 0.5 else "discount" if p < 0.5 else "equilibrium"


def fib_levels(start: float, end: float) -> dict[float, float]:
    """ICT fib anchored on a leg from ``start`` (0) to ``end`` (1).

    Bullish leg: start = swing low, end = swing high -> retracements are below the high and
    extensions (negative) project above it. Bearish: start = high, end = low.
    Level r maps to ``end - r * (end - start)``.
    """
    if start == end:
        raise ValueError("fib leg has zero length")
    span = end - start
    return {r: end - r * span for r in RETRACEMENTS + EXTENSIONS}


def ote_zone(start: float, end: float) -> tuple[float, float, float]:
    """(zone_low, sweet_spot, zone_high) of the 62-79% optimal trade entry."""
    lv = fib_levels(start, end)
    a, b = lv[OTE_LOW], lv[OTE_HIGH]
    return min(a, b), lv[OTE_SWEET], max(a, b)


def dealing_range_at(swings: pd.DataFrame, pos: int, level: int = SHORT) -> DealingRange | None:
    """Range between the latest swing high and swing low (of at least ``level``) known at ``pos``."""
    k = known_at(swings, pos, level)
    hi, lo = k[k["kind"] == "high"], k[k["kind"] == "low"]
    if hi.empty or lo.empty:
        return None
    h, l_ = float(hi.iloc[-1]["price"]), float(lo.iloc[-1]["price"])
    return DealingRange(h, l_) if h > l_ else None


def sd_projections(high: float, low: float, mults=(1.0, 2.0, 2.5, 4.0)) -> dict[str, float]:
    """Range-height multiples above the high (``+1``…) and below the low (``-1``…)."""
    if not high > low:
        raise ValueError("projection range needs high > low")
    r = high - low
    out = {}
    for m in mults:
        out[f"+{m:g}"] = high + m * r
        out[f"-{m:g}"] = low - m * r
    return out


def ipda_ranges(levels: pd.DataFrame, lookbacks=(20, 40, 60)) -> pd.DataFrame:
    """Highest high / lowest low of the previous N trading days, known at each day's open
    (``levels`` from ``daily_levels``). Rows lack a value until N full days exist."""
    out = pd.DataFrame(index=levels.index)
    prev_h, prev_l = levels["day_high"].shift(1), levels["day_low"].shift(1)
    for n in lookbacks:
        out[f"ipda{n}_high"] = prev_h.rolling(n, min_periods=n).max()
        out[f"ipda{n}_low"] = prev_l.rolling(n, min_periods=n).min()
    return out


def institutional_levels(price: float, big_figure: float, count: int = 2) -> list[float]:
    """The .00 / .20 / .50 / .80 levels of the ``big_figure`` grid around ``price``.

    NAS100 with big_figure=1000 at 30583 -> ..., 30000, 30200, 30500, 30800, 31000, ...
    ``count`` big figures are covered below and above the one containing ``price``.
    """
    if big_figure <= 0:
        raise ValueError("big_figure must be positive")
    base = math.floor(price / big_figure) * big_figure
    out = set()
    for k in range(-count, count + 1):
        b = base + k * big_figure
        for f in (0.0, 0.2, 0.5, 0.8):
            out.add(round(b + f * big_figure, 10))
    return sorted(out)


def nearest_institutional(price: float, big_figure: float, side: str) -> float:
    """Next institutional level strictly above (``side='above'``) or below the price."""
    levels = np.array(institutional_levels(price, big_figure, 1))
    if side == "above":
        return float(levels[levels > price][0])
    if side == "below":
        return float(levels[levels < price][-1])
    raise ValueError("side must be 'above' or 'below'")
