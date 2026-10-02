"""The raid -> structure shift -> FVG pipeline shared by the reversal models (M1 Silver Bullet,
M2 2022 model, M3 Judas / Turtle Soup, M4 OTE), and the signal builder they all use."""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from ..bias import Bias
from ..context import Context
from ..indicators.common import NONE
from ..indicators.liquidity import BSL, SSL
from ..indicators.pd_array import nearest_institutional, ote_zone
from ..signals import Signal
from .common import KeyLevel, Raid, allocate, find_raids, running_range, session_levels, swing_levels, target_ladder


@dataclass(frozen=True)
class Setup:
    direction: int
    raid: Raid
    brk: object        # structure row (namedtuple from find_structure, positions of ``timeframe``)
    fvg: object        # FVG row (namedtuple from find_fvgs, positions of ``timeframe``)
    ready_pos: int     # base (1m) bar on which every part of the setup exists
    extreme_pos: int   # base bar at the end of which the leg extreme is known
    fresh: bool        # FVG untouched when the setup completed
    timeframe: str = "1m"


def find_setup(ctx: Context, direction: int, levels: list[KeyLevel], raid_start: int, fvg_start: int,
               end: int, max_fvg_delay: int = 10, timeframe: str = "1m", accept=None) -> Setup | None:
    """First FVG of ``timeframe`` completed in [fvg_start, end) (base bars) whose displacement leg
    broke structure in ``direction`` (0 = either) after a raid of the opposite-side liquidity.

    The raid must have reached the leg extreme (taken at or before it) and completed before
    the break; when several qualify, the latest one is used (the raid that started the leg).
    Higher-timeframe positions are converted to the base bar on which that candle has closed,
    so nothing is used before it exists. ``accept(ctx, setup) -> bool`` can reject candidates
    (e.g. the Unicorn model needs a breaker under the FVG); the search then continues.
    """
    a = ctx.analyses[timeframe]
    st, f = a.structure, a.fvgs

    def base(p: int) -> int:  # last base bar of higher-timeframe bar p (its close)
        return int(p) if timeframe == "1m" else ctx.known_from(timeframe, int(p)) - 1

    best: Setup | None = None
    for dirn in ((direction,) if direction else (1, -1)):
        found = _first_setup(ctx, dirn, levels, raid_start, fvg_start, end, max_fvg_delay, timeframe, st, f, base, accept)
        # with no bias, take whichever direction completed first (ties: none, skip ambiguity)
        if found is not None and (best is None or found.ready_pos < best.ready_pos):
            best = found
        elif found is not None and best is not None and found.ready_pos == best.ready_pos:
            return None
    return best


def _first_setup(ctx, dirn, levels, raid_start, fvg_start, end, max_fvg_delay, timeframe, st, f, base, accept=None):
    raids = find_raids(ctx, levels, SSL if dirn == 1 else BSL, raid_start, end)
    if not raids:
        return None
    cands = f[(f["direction"] == dirn) & (f["height"] >= ctx.spec.min_fvg)]
    cands = cands[[fvg_start <= base(p) < end for p in cands["created_pos"]]] if len(cands) else cands
    breaks = st[(st["direction"] == dirn) & ((st["kind"] == "MSS") | st["displacement"])]
    breaks = breaks[[base(p) < end for p in breaks["pos"]]] if len(breaks) else breaks
    first: Setup | None = None
    for g in cands.itertuples():
        if first is not None and base(g.created_pos) > first.ready_pos:
            break  # later FVGs cannot complete earlier than the setup already found
        leg = breaks[(breaks["extreme_pos"] + 2 <= g.created_pos) & (breaks["pos"] + max_fvg_delay >= g.created_pos)]
        for b in leg.itertuples():
            ext_b, brk_b = base(b.extreme_pos), base(b.pos)
            prior = [r for r in raids if r.taken_pos <= ext_b and r.reclaim_pos <= brk_b]
            if prior:
                ready = max(base(g.created_pos), brk_b)
                if first is None or ready < first.ready_pos:
                    fresh = not (g.touched_pos != NONE and base(g.touched_pos) <= ready)
                    cand = Setup(dirn, prior[-1], b, g, ready, ext_b, fresh, timeframe)
                    if accept is not None and not accept(ctx, cand):
                        continue
                    first = cand
                break
    return first


@dataclass(frozen=True)
class Plan:
    entry: str = "ce"            # 'ce' (FVG midpoint) | 'near' (FVG edge first touched) | 'ote' (70.5% of the leg)
    min_rr: float = 2.0
    min_first_rr: float = 1.0
    stop_buffer_mult: float = 1.0  # x SymbolSpec.stop_buffer beyond the raid extreme
    target_mode: str = "ladder"    # 'ladder' = liquidity targets, 'fixed' = one target at fixed_rr x risk
    fixed_rr: float = 2.0


def build_signal(ctx: Context, s: Setup, model: str, window: str, expiry: pd.Timestamp,
                 time_stop: pd.Timestamp | None, exit_by: pd.Timestamp | None, bias: Bias,
                 range_start: pd.Timestamp, plan: Plan = Plan(),
                 extra_checks: dict[str, bool] | None = None, max_grade: str | None = None) -> Signal | None:
    """Entry, stop beyond the raid, liquidity targets and grading for a ``Setup``.
    Returns None when the trade does not offer ``plan.min_rr`` or price already ran away."""
    d, g, b, raid = s.direction, s.fvg, s.brk, s.raid
    ready = s.ready_pos
    created = ctx.base.index[ready]
    if created >= expiry:
        return None
    lows, highs = ctx.base["low"], ctx.base["high"]
    ext = float(min(raid.extreme, lows.iloc[raid.taken_pos:ready + 1].min())) if d == 1 \
        else float(max(raid.extreme, highs.iloc[raid.taken_pos:ready + 1].max()))
    stop = ext - d * ctx.spec.stop_buffer * plan.stop_buffer_mult

    if plan.entry == "ce":
        entry = float(g.ce)
    elif plan.entry == "near":
        entry = float(g.top) if d == 1 else float(g.bottom)
    elif plan.entry == "ote":
        # s.extreme_pos is a base (1m) bar; b.extreme_pos would be a position of the setup timeframe
        leg_end = float(highs.iloc[s.extreme_pos:ready + 1].max()) if d == 1 \
            else float(lows.iloc[s.extreme_pos:ready + 1].min())
        lo, sweet, hi = ote_zone(ext, leg_end)
        if not (g.bottom <= hi and g.top >= lo):  # rulebook M4: OTE needs an FVG inside the zone
            return None
        entry = sweet
    else:
        raise ValueError(f"unknown entry type {plan.entry!r}")
    risk = abs(entry - stop)
    if risk <= 0 or d * (entry - stop) <= 0:
        return None

    if plan.target_mode == "fixed":
        ladder = []
        prices = [entry + d * plan.fixed_rr * risk]
    else:
        tgt = (session_levels(ctx, ready) + swing_levels(ctx, ready, ("5m", "15m", "1h"), 1)
               + running_range(ctx, range_start, ready, "pre_signal"))
        ladder = target_ladder(tgt, entry, risk, d, plan.min_first_rr)
        prices = [l.price for l in ladder[:3]]
        if not prices or abs(prices[-1] - entry) < plan.min_rr * risk:
            inst = nearest_institutional(entry + d * plan.min_rr * risk, ctx.spec.big_figure, "above" if d == 1 else "below")
            prices = (prices + [inst])[-3:] if not prices or d * (inst - prices[-1]) > 0 else prices
        prices = sorted(set(prices), key=lambda p: d * p)[:3]
        if not prices or abs(prices[-1] - entry) < plan.min_rr * risk:
            return None
    bar = ctx.base.iloc[ready]
    if (d == 1 and bar["high"] >= prices[0]) or (d == -1 and bar["low"] <= prices[0]):
        return None  # chase rule: TP1 already traded before the order could be placed

    fresh = s.fresh
    checklist = {
        "kill_zone": True,
        "news_clear": True,
        "htf_structure": bias.components.get("daily_structure", 0) == d,
        "dealing_range_side": bias.components.get("ipda_zone", 0) == d,
        "liquidity_purged": True,
        "ltf_structure": bool(b.kind == "MSS" or b.displacement),
        "fresh_fvg_in_window": fresh,
        "draw_on_liquidity": bias.draw is not None,
        "stop_defined": True,
        "partials_mapped": len(prices) >= 2,
        "expiry_set": True,
        "time_stop_set": time_stop is not None,
    }
    checklist.update(extra_checks or {})
    score = int(sum(checklist.values())) + int(bool(b.displacement)) + int(bias.direction == d)
    top = len(checklist) + 2
    grade = "A+" if score >= top - 1 else "A" if score >= top - 3 else "B"
    order = ["B", "A", "A+"]
    if max_grade is not None and order.index(grade) > order.index(max_grade):
        grade = max_grade
    return Signal(
        model=model, symbol=ctx.symbol, direction=d, created_time=created, entry=entry, stop=stop,
        targets=allocate(prices), expiry=expiry, time_stop=time_stop, exit_by=exit_by, window=window,
        grade=grade, score=score, checklist=checklist,
        notes={"raid_level": raid.level.name, "raid_price": raid.level.price,
               "raid_time": str(ctx.base.index[raid.taken_pos]), "break_kind": str(b.kind),
               "break_time": str(b.time), "fvg": (float(g.bottom), float(g.top)), "bias_score": bias.score,
               "bias_components": bias.components, "draw": bias.draw, "targets_from": [l.name for l in ladder[:3]]},
    )
