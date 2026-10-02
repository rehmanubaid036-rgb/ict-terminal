"""Model add-ons that need more than one setup: M16 SMT reversal and the M8 Power of 3 filter."""
from __future__ import annotations

from dataclasses import replace

import numpy as np
import pandas as pd

from ..context import Context
from ..core import clock
from ..signals import Signal
from .reversal_models import M2_CONFIG, scan as reversal_scan
from .setup import Setup


def smt_at_raid(ctx: Context, s: Setup, lookback: int = 5) -> bool:
    """M16: while our instrument raided the level, the partner did not make the matching new
    extreme (it held above its own low at the level's origin, or below its high)."""
    p = ctx.partner_aligned
    if p is None:
        return False
    r = s.raid
    # the bar where our level was printed: the last bar before it became known whose low (high)
    # touched the level price, searched up to one day back
    k = r.level.known_pos
    lo, hi = ctx.base["low"].to_numpy(), ctx.base["high"].to_numpy()
    w0 = max(0, k - 1440)
    seg = lo[w0:k] if s.direction == 1 else hi[w0:k]
    hit = np.flatnonzero(seg <= r.level.price + 1e-9) if s.direction == 1 else np.flatnonzero(seg >= r.level.price - 1e-9)
    if hit.size == 0:
        return False
    at = w0 + int(hit[-1])
    origin = slice(max(0, at - lookback), at + lookback + 1)
    during = slice(r.taken_pos, r.reclaim_pos + 1)
    if s.direction == 1:  # we swept a low; bullish SMT if the partner's low held
        before, now = p["low"].iloc[origin].min(), p["low"].iloc[during].min()
        return bool(np.isfinite(before) and np.isfinite(now) and now >= before)
    before, now = p["high"].iloc[origin].max(), p["high"].iloc[during].max()
    return bool(np.isfinite(before) and np.isfinite(now) and now <= before)


# SMT is read on meaningful liquidity (session / daily levels), not on 1m micro swings
M16_CONFIG = replace(M2_CONFIG, model="M16_smt_reversal", accept=smt_at_raid, max_grade="A",
                     level_source="session", raid_lead_min=60)


def scan_m16(ctx: Context, **kw) -> list[Signal]:
    if ctx.partner_aligned is None:
        return []  # needs Context(partner=...) with the correlated instrument
    return reversal_scan(ctx, replace(M16_CONFIG, **kw) if kw else M16_CONFIG)


def po3_filter(ctx: Context, signals: list[Signal]) -> list[Signal]:
    """M8 Power of 3: keep New York signals only when London already manipulated against them
    (raided the Asian range on the opposite side), i.e. accumulation -> manipulation happened
    and New York is the distribution leg. Signals outside New York pass unchanged."""
    keep = []
    for s in signals:
        local = s.created_time.tz_convert(clock.NY)
        if not 6 <= local.hour < 16:
            keep.append(s)
            continue
        t = ctx.pos_of(s.created_time)
        lv = ctx.day_levels(min(t, len(ctx.base) - 1))
        if lv is None or not np.isfinite(lv["asian_range_low"]):
            continue
        day = pd.Timestamp(ctx.trading_day[min(t, len(ctx.base) - 1)]).date()
        l0, l1 = clock.get_window("london").bounds(day)
        seg = ctx.base[(ctx.base.index >= l0) & (ctx.base.index < l1)]
        if seg.empty:
            continue
        if s.direction == 1 and seg["low"].min() < lv["asian_range_low"]:
            keep.append(s)
        elif s.direction == -1 and seg["high"].max() > lv["asian_range_high"]:
            keep.append(s)
    return keep
