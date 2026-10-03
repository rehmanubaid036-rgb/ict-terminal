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
from .common import (KeyLevel, Raid, allocate, find_raids, po3_matches, running_range, session_levels, swing_levels,
                     target_ladder)


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
               end: int, max_fvg_delay: int = 10, timeframe: str = "1m", accept=None,
               strict_mss: bool = False) -> Setup | None:
    """First FVG of ``timeframe`` completed in [fvg_start, end) (base bars) whose displacement leg
    broke structure in ``direction`` (0 = either) after a raid of the opposite-side liquidity.

    The raid must have reached the leg extreme (taken at or before it) and completed before
    the break; when several qualify, the latest one is used (the raid that started the leg).
    Higher-timeframe positions are converted to the base bar on which that candle has closed,
    so nothing is used before it exists. ``accept(ctx, setup) -> bool`` can reject candidates
    (e.g. the Unicorn model needs a breaker under the FVG); the search then continues.
    ``strict_mss`` (rulebook M1 step 2): only an MSS made with displacement counts; otherwise an MSS,
    or a BOS with displacement, does.
    """
    a = ctx.analyses[timeframe]
    st, f = a.structure, a.fvgs

    def base(p: int) -> int:  # last base bar of higher-timeframe bar p (its close)
        return int(p) if timeframe == "1m" else ctx.known_from(timeframe, int(p)) - 1

    best: Setup | None = None
    for dirn in ((direction,) if direction else (1, -1)):
        found = _first_setup(ctx, dirn, levels, raid_start, fvg_start, end, max_fvg_delay, timeframe, st, f, base, accept,
                             strict_mss)
        # with no bias, take whichever direction completed first (ties: none, skip ambiguity)
        if found is not None and (best is None or found.ready_pos < best.ready_pos):
            best = found
        elif found is not None and best is not None and found.ready_pos == best.ready_pos:
            return None
    return best


def _first_setup(ctx, dirn, levels, raid_start, fvg_start, end, max_fvg_delay, timeframe, st, f, base, accept=None,
                 strict_mss=False):
    raids = find_raids(ctx, levels, SSL if dirn == 1 else BSL, raid_start, end)
    if not raids:
        return None
    cands = f[(f["direction"] == dirn) & (f["height"] >= ctx.spec.min_fvg)]
    cands = cands[[fvg_start <= base(p) < end for p in cands["created_pos"]]] if len(cands) else cands
    if strict_mss:
        breaks = st[(st["direction"] == dirn) & (st["kind"] == "MSS") & st["displacement"].astype(bool)]
    else:
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
    target_mode: str = "ladder"    # 'ladder' = liquidity targets, 'fixed' = one target at fixed_rr x risk,
                                   # 'rulebook' = TP1 internal liquidity, TP2 next liquidity / opposing FVG CE,
                                   # TP3 the draw on liquidity (terminus)
    fixed_rr: float = 2.0
    stop_mode: str = "buffer"      # 'buffer' = SymbolSpec.stop_buffer x stop_buffer_mult beyond the raid extreme,
                                   # 'tick' = 1 tick beyond the sweep wick (+ the spread for a short) - rulebook M1
    require_discount: bool = True  # rulebook 7: a buy enters in the discount half of the setup's dealing range
                                   # (raid extreme -> leg extreme), a sell in the premium half
    min_target_mult: float = 0.0   # TP1 at least this x SymbolSpec.min_target away (rulebook M1: 1.0)
    po3_boost: bool = False        # rulebook M8: +1 when London already manipulated against the trade (M1, M3)


def build_signal(ctx: Context, s: Setup, model: str, window: str, expiry: pd.Timestamp,
                 time_stop: pd.Timestamp | None, exit_by: pd.Timestamp | None, bias: Bias,
                 range_start: pd.Timestamp, plan: Plan = Plan(),
                 extra_checks: dict[str, bool] | None = None, max_grade: str | None = None,
                 targets_fn=None) -> Signal | None:
    """Entry, stop, targets and the rulebook section 7 confluence grade for a ``Setup``.
    ``targets_fn(entry, risk) -> [(price, name)]`` gives a model's own targets (M15 SD projections).
    Returns None when the trade does not offer ``plan.min_rr``, sits on the wrong side of its
    dealing range (premium / discount) or price already ran away."""
    d, g, b, raid = s.direction, s.fvg, s.brk, s.raid
    spec = ctx.spec
    ready = s.ready_pos
    created = ctx.base.index[ready]
    if created >= expiry:
        return None
    lows, highs = ctx.base["low"], ctx.base["high"]
    ext = float(min(raid.extreme, lows.iloc[raid.taken_pos:ready + 1].min())) if d == 1 \
        else float(max(raid.extreme, highs.iloc[raid.taken_pos:ready + 1].max()))
    if plan.stop_mode == "tick":
        # rulebook M1: 1 tick beyond the sweep wick; a short's stop is hit by the ask, so add the spread
        stop = ext - d * spec.tick_size + (spec.spread if d == -1 else 0.0)
    else:
        stop = ext - d * spec.stop_buffer * plan.stop_buffer_mult
    # s.extreme_pos is a base (1m) bar; b.extreme_pos would be a position of the setup timeframe
    leg_end = float(highs.iloc[s.extreme_pos:ready + 1].max()) if d == 1 \
        else float(lows.iloc[s.extreme_pos:ready + 1].min())

    if plan.entry == "ce":
        entry = float(g.ce)
    elif plan.entry == "near":
        entry = float(g.top) if d == 1 else float(g.bottom)
    elif plan.entry == "ote":
        lo, sweet, hi = ote_zone(ext, leg_end)
        if not (g.bottom <= hi and g.top >= lo):  # rulebook M4: OTE needs an FVG inside the zone
            return None
        entry = sweet
    else:
        raise ValueError(f"unknown entry type {plan.entry!r}")
    risk = abs(entry - stop)
    if risk <= 0 or d * (entry - stop) <= 0:
        return None

    # rulebook 7: premium / discount on the right side is required - a buy in the lower half of the
    # dealing range from the raid extreme to the leg extreme, a sell in the upper half
    mid = (ext + leg_end) / 2
    discount_ok = d * (mid - entry) >= 0
    if plan.require_discount and not discount_ok:
        return None

    ladder: list = []
    custom = targets_fn(entry, risk) if targets_fn is not None else None
    if custom:
        ahead = sorted([(p, n) for p, n in custom if d * (p - entry) >= plan.min_first_rr * risk], key=lambda x: d * x[0])
        ladder = [KeyLevel(p, BSL if d == 1 else SSL, n, ready) for p, n in ahead[:3]]
        prices = [l.price for l in ladder]
        if not prices or abs(prices[-1] - entry) < plan.min_rr * risk:
            return None
    elif plan.target_mode == "ote_ext":
        # rulebook M4: fib extensions of the anchor leg - -0.5 (TP1), -1.0 (TP2), -2.0 (runner)
        rng = abs(leg_end - ext)
        ladder = [KeyLevel(leg_end + d * k * rng, BSL if d == 1 else SSL, f"ote_ext_-{k:g}", ready) for k in (0.5, 1.0, 2.0)]
        ladder = [l for l in ladder if d * (l.price - entry) > 0]
        prices = [l.price for l in ladder]
        if not prices or abs(prices[-1] - entry) < plan.min_rr * risk:
            return None
    elif plan.target_mode == "fixed":
        prices = [entry + d * plan.fixed_rr * risk]
    else:
        tgt = (session_levels(ctx, ready) + swing_levels(ctx, ready, ("5m", "15m", "1h"), 1)
               + running_range(ctx, range_start, ready, "pre_signal"))
        if plan.target_mode == "rulebook":
            tgt += _opposing_fvg_levels(ctx, ready, d)
        min_dist = max(plan.min_first_rr * risk, plan.min_target_mult * spec.min_target)
        ladder = target_ladder(tgt, entry, min_dist, d, 1.0)
        if plan.target_mode == "rulebook":
            # TP1 nearest internal liquidity, TP2 the next one, TP3 the main draw on liquidity (terminus)
            picks = ladder[:2]
            draw = bias.draw if bias.direction == d and bias.draw is not None else None
            if draw is not None and (not picks or d * (draw - picks[-1].price) > 0.25 * risk) and d * (draw - entry) >= min_dist:
                picks = picks + [KeyLevel(float(draw), BSL if d == 1 else SSL, "draw_" + (bias.draw_source or "liquidity"), ready)]
            elif len(ladder) > 2:
                picks = ladder[:3]
            ladder = picks
        prices = [l.price for l in ladder[:3]]
        if not prices or abs(prices[-1] - entry) < plan.min_rr * risk:
            inst = nearest_institutional(entry + d * plan.min_rr * risk, spec.big_figure, "above" if d == 1 else "below")
            prices = (prices + [inst])[-3:] if not prices or d * (inst - prices[-1]) > 0 else prices
        prices = sorted(set(prices), key=lambda p: d * p)[:3]
        if not prices or abs(prices[-1] - entry) < plan.min_rr * risk:
            return None
    bar = ctx.base.iloc[ready]
    if (d == 1 and bar["high"] >= prices[0]) or (d == -1 and bar["low"] <= prices[0]):
        return None  # chase rule: TP1 already traded before the order could be placed

    # rulebook 7 confluence score (0-10): A+ >= 8, A 6-7, B < 6
    lo_ote, _, hi_ote = ote_zone(ext, leg_end)
    factors = {
        "bias_align": 2 if bias.direction == d else 0,
        "killzone_or_sb_window": 1,
        "macro_time": 1 if _in_macro(ctx, raid.taken_pos) or _in_macro(ctx, ready) else 0,
        "htf_liquidity_sweep": 2 if _htf_level(raid.level.name) else 0,
        "displacement_fvg": 1 if bool(b.displacement) else 0,
        "ote_overlap": 1 if (g.bottom <= hi_ote and g.top >= lo_ote) else 0,
        "ob_overlap": 1 if _ob_overlap(ctx, s) else 0,
        "smt": 1 if _smt(ctx, s) else 0,
    }
    if plan.po3_boost:
        factors["power_of_3"] = 1 if po3_matches(ctx, d, ready) else 0
    score = int(sum(factors.values()))
    grade = "A+" if score >= 8 else "A" if score >= 6 else "B"
    order = ["B", "A", "A+"]
    if max_grade is not None and order.index(grade) > order.index(max_grade):
        grade = max_grade
    checklist = {
        "kill_zone": True,
        "news_clear": True,
        "htf_structure": bias.components.get("daily_structure", 0) == d,
        "dealing_range_side": discount_ok,
        "liquidity_purged": True,
        "ltf_structure": bool(b.kind == "MSS" or b.displacement),
        "fresh_fvg_in_window": bool(s.fresh),
        "draw_on_liquidity": bias.draw is not None,
        "stop_defined": True,
        "partials_mapped": len(prices) >= 2,
        "expiry_set": True,
        "time_stop_set": time_stop is not None,
    }
    checklist.update(extra_checks or {})
    return Signal(
        model=model, symbol=ctx.symbol, direction=d, created_time=created, entry=entry, stop=stop,
        targets=allocate(prices), expiry=expiry, time_stop=time_stop, exit_by=exit_by, window=window,
        grade=grade, score=score, checklist=checklist,
        notes={"raid_level": raid.level.name, "raid_price": raid.level.price,
               "raid_time": str(ctx.base.index[raid.taken_pos]), "break_kind": str(b.kind),
               "break_time": str(b.time), "fvg": (float(g.bottom), float(g.top)), "bias_score": bias.score,
               "bias_components": bias.components, "draw": bias.draw, "targets_from": [l.name for l in ladder[:3]],
               "confluence": factors, "dealing_range": (ext, leg_end),
               # rulebook invalidation: a body close beyond the FVG (wrong side) before the fill cancels it
               "cancel_if_close_beyond": float(g.bottom) if d == 1 else float(g.top),
               # rulebook 5: breakeven after TP1 is the entry + a little to cover the spread
               "be_offset": spec.spread},
    )


_HTF_NAMES = ("pdh", "pdl", "pwh", "pwl", "asian_range", "asia_", "london_", "cbdr", "initial", "1h_", "4h_", "1d_")


def _htf_level(name: str) -> bool:
    """Rulebook 7 "HTF liquidity sweep (1H+)": daily / weekly / session levels or 1h+ swing pools."""
    return name.startswith(_HTF_NAMES)


def _in_macro(ctx: Context, pos: int) -> bool:
    from ..core import clock
    return any(w.kind == "macro" and w.contains(ctx.base.index[pos]) for w in clock.ALL_WINDOWS)


def _opposing_fvg_levels(ctx: Context, pos: int, d: int) -> list[KeyLevel]:
    """CE of unfilled opposing 5m / 15m FVGs ahead of price (a SIBI above a buy, a BISI below a sell):
    rulebook M1 TP2 "SIBI CE"."""
    from ..indicators.fvg import active_at
    out = []
    for tf in ("5m", "15m"):
        p = ctx.htf_pos(tf, pos)
        if p < 0:
            continue
        for r in active_at(ctx.analyses[tf].fvgs, p, -d).itertuples(index=False):
            out.append(KeyLevel(float(r.ce), BSL if d == 1 else SSL, f"{tf}_{'sibi' if d == 1 else 'bisi'}_ce", pos))
    return out


def _ob_overlap(ctx: Context, s: Setup) -> bool:
    """An order block or breaker of the trade's direction overlaps the entry FVG (Unicorn / OB confluence)."""
    from ..indicators.blocks import blocks_at
    obs = blocks_at(ctx.analyses["1m"].order_blocks, s.ready_pos)
    same = obs[((obs["role"] == "ob") & (obs["direction"] == s.direction))
               | ((obs["role"] == "breaker") & (obs["direction"] == -s.direction))]
    return bool(((same["low"] <= s.fvg.top) & (same["high"] >= s.fvg.bottom)).any())


def _smt(ctx: Context, s: Setup) -> bool:
    if getattr(ctx, "partner_aligned", None) is None:
        return False
    from .filters import smt_at_raid
    return smt_at_raid(ctx, s)
