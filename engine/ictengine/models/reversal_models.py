"""Reversal models built on the shared raid -> structure shift -> FVG pipeline.

M2  ICT 2022 Mentorship model: any raid in a killzone, MSS with displacement, FVG entry.
M3  Judas Swing / Turtle Soup: the session open raids a *session* level (Asian range, CBDR,
    previous day, London range) and reverses.
M4  OTE: the same reversal, entered at the 70.5% retracement of the leg when an FVG sits in
    the 62-79% zone.
M5  Asian Q2 Judas: 19:45-21:00 raid of the Asian Q1 (18:00-19:30) high/low, 5m FVG entry.
M6  Asian range scalp: 20:00-23:30, bias-direction OTE + 5m FVG, smaller targets.
M7  Unicorn: the FVG must overlap a breaker block of the same direction.
M14 London close reversal: 10:00-12:00, counter-move after the morning, graded at most A.
M15 London protraction: small CBDR and Asian range, Judas raid 00:00-05:00 of those ranges,
    London reversal entry.
M9  Market Maker Buy / Sell model (simplified): a raid of daily / weekly liquidity (PDL/PWL for
    the buy model, PDH/PWH for the sell model) followed by a 1h smart money reversal (MSS) and
    an entry at the 1h FVG; wide stop, minimum 3R toward the opposite HTF liquidity.
(M1 Silver Bullet lives in silver_bullet.py.)
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import time
from typing import Callable

import numpy as np
import pandas as pd

from ..bias import bias_at
from ..context import Context
from ..core import clock
from ..core.clock import TimeWindow
from ..signals import Signal
from ..indicators.blocks import blocks_at
from .common import raid_levels, running_range, session_levels, trend_direction
from .setup import Plan, Setup, build_signal, find_setup


@dataclass(frozen=True)
class ReversalConfig:
    model: str
    windows: tuple[TimeWindow, ...]
    level_source: str            # 'all' = session + swing liquidity, 'session' = session/daily levels only,
                                 # 'ranges' = previous day + ``extra_ranges`` only
    entry: str = "ce"            # Plan entry type
    require_bias: bool = True
    raid_lead_min: int = 30
    min_rr: float = 2.0
    min_first_rr: float = 1.0
    max_fvg_delay: int = 10
    exit_after_min: int = 120
    time_stop_min: int | None = None  # close if TP1 not hit this long after the window opens
    timeframe: str = "1m"             # timeframe of the structure shift and FVG
    manual_bias: int = 0              # +1 / -1: the trader's own bias overrides the bias engine
    stop_buffer_mult: float = 1.0
    extra_ranges: tuple[str, ...] = ()  # clock window keys whose completed high/low are raid levels
    max_grade: str | None = None
    precondition: Callable | None = None  # (ctx, day, first_bar) -> bool, checked before scanning
    accept: Callable | None = None        # (ctx, setup) -> bool, see find_setup
    target_mode: str = "ladder"
    fixed_rr: float = 2.0
    trend_filter: str = "none"
    po3_boost: bool = False               # rulebook M8: score +1 when London manipulated against the trade
    direction_fn: Callable | None = None  # (ctx, day, first_bar, bias) -> +1 / -1 / 0: the setup direction
                                          # (default: the bias); M14 trades against the morning's move
    targets_fn: Callable | None = None    # (ctx, day, setup, entry, risk) -> [(price, name)]: model targets


def _tw(key, start, end):
    h1, m1 = map(int, start.split(":"))
    h2, m2 = map(int, end.split(":"))
    return TimeWindow(key, key, "model_window", time(h1, m1), time(h2, m2))


M2_CONFIG = ReversalConfig("M2_mentorship_2022", (clock.get_window("london_kz"), clock.get_window("ny_am_kz")), "all")
M3_CONFIG = ReversalConfig("M3_judas_turtle_soup",
                           (_tw("london_judas", "00:00", "05:00"), _tw("ny_judas", "08:30", "10:00")),
                           "session", raid_lead_min=0, po3_boost=True)
# rulebook M4: OTE of a meaningful leg (5m) with the stop 0.5-1.0 beyond the 1.0 level on gold
M4_CONFIG = ReversalConfig("M4_ote", (clock.get_window("london_kz"), clock.get_window("ny_am_kz")), "all", entry="ote",
                           timeframe="5m", max_fvg_delay=4, stop_buffer_mult=3.0, target_mode="ote_ext")


def unicorn_breaker_under_fvg(ctx: Context, s: Setup) -> bool:
    """M7: the setup's own displacement turned an opposite order block into a breaker (it failed
    after the raid, by the time the setup completed) and that breaker overlaps the FVG."""
    obs = blocks_at(ctx.analyses["1m"].order_blocks, s.ready_pos)
    br = obs[(obs["role"] == "breaker") & (obs["direction"] == -s.direction)
             & (obs["failed_pos"] > s.raid.taken_pos) & (obs["failed_pos"] <= s.ready_pos)]
    g = s.fvg
    return bool(((br["low"] <= g.top) & (br["high"] >= g.bottom)).any())


def protraction_ranges_are_small(ctx: Context, day, t: int, cbdr_adr: float = 0.35, asia_adr: float = 0.30) -> bool:
    """M15 [DEFAULT]: CBDR <= 35% and Asian range <= 30% of the 20-day average daily range.
    The rulebook numbers (40 / 20-30 pips) are for FX; this scales them to any symbol."""
    lv = ctx.levels
    key = pd.Timestamp(day)
    if key not in lv.index:
        return False
    i = lv.index.get_loc(key)
    adr = (lv["day_high"] - lv["day_low"]).iloc[max(0, i - 20):i]
    if len(adr) < 10:
        return False
    adr = float(adr.mean())
    row = lv.iloc[i]
    return bool((row["cbdr_high"] - row["cbdr_low"]) <= cbdr_adr * adr and
                (row["asian_range_high"] - row["asian_range_low"]) <= asia_adr * adr)


M5_CONFIG = ReversalConfig("M5_asian_q2_judas", (_tw("asia_q2_judas", "19:45", "21:00"),), "ranges",
                           extra_ranges=("asia_q1",), raid_lead_min=15, timeframe="5m", max_fvg_delay=4,
                           stop_buffer_mult=2.0, exit_after_min=180)
M6_CONFIG = ReversalConfig("M6_asian_range_scalp", (_tw("asia_scalp", "20:00", "23:30"),), "all", entry="ote",
                           timeframe="5m", max_fvg_delay=4, stop_buffer_mult=2.0, min_rr=1.5, exit_after_min=60)
M7_CONFIG = ReversalConfig("M7_unicorn", (clock.get_window("london_kz"), clock.get_window("ny_am_kz")), "all",
                           accept=unicorn_breaker_under_fvg)
def morning_draw_hit(ctx: Context, day, ws: int, bias) -> int:
    """M14: the day's main move is done - the draw on liquidity set at the NY session open (06:00) was
    reached before the window. The reversal trades against that move; 0 = no setup."""
    t0 = ctx.pos_of(clock.get_window("ny_am").bounds(day)[0])
    if t0 >= ws or t0 <= 0:
        return 0
    b = bias_at(ctx, t0 - 1)
    if b.direction == 0 or b.draw is None:
        return 0
    seg = ctx.base.iloc[t0:ws]
    hit = seg["high"].max() >= b.draw if b.direction == 1 else seg["low"].min() <= b.draw
    return -b.direction if hit else 0


M14_CONFIG = ReversalConfig("M14_london_close_reversal", (clock.get_window("london_close_kz"),), "all",
                            max_grade="A", exit_after_min=60, direction_fn=morning_draw_hit)
M9_CONFIG = ReversalConfig("M9_market_maker", (_tw("trading_day", "18:00", "18:00"),), "htf",
                           raid_lead_min=24 * 60, timeframe="1h", max_fvg_delay=3, stop_buffer_mult=5.0,
                           min_rr=3.0, exit_after_min=3 * 24 * 60)
def protraction_targets(ctx: Context, day, s: Setup, entry: float, risk: float) -> list[tuple[float, str]]:
    """M15 targets: CBDR (Asian range when CBDR is missing) standard deviations -2, -3, -4 in the
    trade direction, projected from the range's far side."""
    lv = ctx.levels.loc[pd.Timestamp(day)] if pd.Timestamp(day) in ctx.levels.index else None
    if lv is None:
        return []
    for key in ("cbdr", "asian_range"):
        hi, lo = lv.get(f"{key}_high", np.nan), lv.get(f"{key}_low", np.nan)
        if np.isfinite(hi) and np.isfinite(lo) and hi > lo:
            rng, d = hi - lo, s.direction
            base = hi if d == 1 else lo
            return [(float(base + d * k * rng), f"{key}_sd_-{k}") for k in (2, 3, 4)]
    return []


M15_CONFIG = ReversalConfig("M15_london_protraction", (_tw("london_protraction", "00:00", "05:00"),), "session",
                            raid_lead_min=0, precondition=protraction_ranges_are_small, targets_fn=protraction_targets)


def scan(ctx: Context, cfg: ReversalConfig) -> list[Signal]:
    out = []
    for day in np.unique(ctx.trading_day):
        d = pd.Timestamp(day).date()
        for w in cfg.windows:
            s = _scan_window(ctx, d, w, cfg)
            if s is not None:
                out.append(s)
    return out


def _scan_window(ctx: Context, day, w: TimeWindow, cfg: ReversalConfig) -> Signal | None:
    w0, w1 = w.bounds(day)
    ws, we = ctx.pos_of(w0), ctx.pos_of(w1)
    if ws >= len(ctx.base) or ws == 0 or ctx.base.index[ws] >= w1:
        return None
    bias = bias_at(ctx, ws - 1)
    if cfg.manual_bias:
        bias = replace(bias, direction=cfg.manual_bias)
    forced = None                     # a model-specific direction (M14: against the morning's move)
    if cfg.direction_fn is not None:
        forced = cfg.direction_fn(ctx, day, ws, bias)
        if forced == 0:
            return None
    if bias.direction == 0 and cfg.require_bias and forced is None:
        return None
    if cfg.precondition is not None and not cfg.precondition(ctx, day, ws):
        return None
    trend = trend_direction(ctx, ws - 1, cfg.trend_filter)
    if cfg.trend_filter != "none":
        if trend == 0 or (bias.direction and bias.direction != trend):
            return None
        bias = replace(bias, direction=trend)
    lead = ctx.pos_of(w0 - pd.Timedelta(minutes=cfg.raid_lead_min))
    session_start = _session_start(day, w0)
    levels = session_levels(ctx, lead)
    if cfg.level_source == "ranges":
        levels = [lv for lv in levels if lv.name in ("pdh", "pdl")]
    elif cfg.level_source == "htf":
        levels = [lv for lv in levels if lv.name in ("pdh", "pdl", "pwh", "pwl")]
    for key in cfg.extra_ranges:
        r0, r1 = clock.get_window(key).bounds(day)
        if ctx.pos_of(r1) <= lead:
            levels += running_range(ctx, r0, ctx.pos_of(r1) - 1, key)
    if w.key == "ny_judas":  # the London session range is complete by then
        levels += running_range(ctx, clock.get_window("london").bounds(day)[0], lead - 1, "london_range")
    if cfg.level_source == "all":
        levels += running_range(ctx, session_start, lead - 1, "pre_window") + raid_levels(ctx, we, since=lead)
    setup = find_setup(ctx, forced if forced is not None else bias.direction, levels, lead, ws, we,
                       cfg.max_fvg_delay, cfg.timeframe, cfg.accept)
    if setup is None:
        return None
    time_stop = None if cfg.time_stop_min is None else w0 + pd.Timedelta(minutes=cfg.time_stop_min)
    return build_signal(ctx, setup, cfg.model, w.key, expiry=w1, time_stop=time_stop,
                        exit_by=w1 + pd.Timedelta(minutes=cfg.exit_after_min), bias=bias,
                        range_start=session_start, plan=Plan(cfg.entry, cfg.min_rr, cfg.min_first_rr, cfg.stop_buffer_mult,
                                  cfg.target_mode, cfg.fixed_rr, po3_boost=cfg.po3_boost),
                        targets_fn=(lambda e, r: cfg.targets_fn(ctx, day, setup, e, r)) if cfg.targets_fn else None,
                        max_grade=cfg.max_grade)


def _session_start(day, w0: pd.Timestamp) -> pd.Timestamp:
    """Open of the Quarterly-Theory session containing ``w0``."""
    for key in ("asia", "london", "ny_am", "ny_pm"):
        s0, s1 = clock.get_window(key).bounds(day)
        if s0 <= w0 < s1:
            return s0
    return clock.get_window("ny_am").bounds(day)[0]


def scan_m2(ctx: Context, **kw) -> list[Signal]:
    return scan(ctx, _with(M2_CONFIG, kw))


def scan_m3(ctx: Context, **kw) -> list[Signal]:
    return scan(ctx, _with(M3_CONFIG, kw))


def scan_m4(ctx: Context, **kw) -> list[Signal]:
    return scan(ctx, _with(M4_CONFIG, kw))


def _with(cfg: ReversalConfig, overrides: dict) -> ReversalConfig:
    return replace(cfg, **overrides) if overrides else cfg


def scan_m5(ctx: Context, **kw) -> list[Signal]:
    return scan(ctx, _with(M5_CONFIG, kw))


# rulebook M6: NAS100 variant 20:45-22:15 (Asia Q3)
M6_INDEX_WINDOWS = (_tw("asia_scalp_index", "20:45", "22:15"),)


def scan_m6(ctx: Context, **kw) -> list[Signal]:
    cfg = M6_CONFIG
    if ctx.symbol in ("NAS100", "US500") and "windows" not in kw:
        cfg = replace(cfg, windows=M6_INDEX_WINDOWS)
    return scan(ctx, _with(cfg, kw))


def scan_m7(ctx: Context, **kw) -> list[Signal]:
    return scan(ctx, _with(M7_CONFIG, kw))


def scan_m14(ctx: Context, **kw) -> list[Signal]:
    return scan(ctx, _with(M14_CONFIG, kw))


def scan_m15(ctx: Context, **kw) -> list[Signal]:
    return scan(ctx, _with(M15_CONFIG, kw))


def scan_m9(ctx: Context, **kw) -> list[Signal]:
    return scan(ctx, _with(M9_CONFIG, kw))
