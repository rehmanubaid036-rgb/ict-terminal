"""M1 - ICT Silver Bullet (rulebook 4/M1 and the 12-point execution checklist).

Per trading day and window (London 03-04, NY AM 10-11, NY PM 14-15 New York time):
  1. bias set before the window (``bias_at``); no bias -> no trade (unless require_bias=False)
  2. a liquidity level on the side *against* the bias is raided (wick through, close back)
     from ``raid_lead_min`` before the window up to its end
  3. a 1m market structure shift made with displacement in the bias direction after the raid
  4. the first FVG of that displacement leg created inside the window
  5. limit entry at the FVG's CE (option: near edge / OTE overlap); stop 1 tick beyond the sweep wick
     (+ the spread for a short); the entry must be in the discount (buy) / premium (sell) half of
     the setup's dealing range
  6. TP1 (50%) the nearest internal liquidity / session high-low, at least 1R and the symbol's
     minimum target (indices ~10 points, FX ~15 pips) -> stop to breakeven; TP2 (25%) the next
     liquidity or an opposing FVG's CE; TP3 / terminus (25%) the main draw on liquidity; TP3 >= 2R
     Invalidation: a body close beyond the FVG (wrong side) before the fill cancels the order;
     high-impact news in the window -> no trade. Grade = rulebook section 7 confluence score.
  7. order expires ``expiry_min`` after the window opens; the trade is closed then if TP1 has
     not been reached (checklist items 11 and 12)
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace

import numpy as np
import pandas as pd

from ..bias import bias_at
from ..context import Context
from ..core import clock
from ..signals import Signal
from .common import raid_levels, running_range, session_levels, trend_direction
from .setup import Plan, build_signal, find_setup

MODEL = "M1_silver_bullet"
WINDOW_KEYS = ("london_sb", "ny_am_sb", "ny_pm_sb")


@dataclass(frozen=True)
class SBConfig:
    windows: tuple[str, ...] = WINDOW_KEYS
    require_bias: bool = True
    raid_lead_min: int = 30          # raids during the macro before the window count (09:50 etc.)
    expiry_min: int = 45             # checklist: entry and TP1 by 10:45
    exit_after_window_min: int = 120  # any runner is flat 2h after the window ends
    min_rr: float = 2.0              # final target vs risk
    min_first_rr: float = 1.0
    max_fvg_delay: int = 10          # bars after the structure break to find the FVG
    raid_min_level: int = 1          # 1 = short-term swings count as raidable liquidity
    manual_bias: int = 0             # +1 / -1: the trader's own bias overrides the bias engine
    entry: str = "ce"                # 'ce' | 'near' | 'ote'
    timeframe: str = "1m"            # timeframe of the structure shift and FVG
    stop_buffer_mult: float = 1.0    # only for stop_mode='buffer'
    stop_mode: str = "tick"          # rulebook: 1 tick beyond the sweep wick | 'buffer'
    strict_mss: bool = True          # rulebook step 2: MSS with displacement (False: MSS, or BOS with displacement)
    min_target_mult: float = 1.0     # TP1 at least the symbol's minimum target (0 = off)
    require_discount: bool = True    # rulebook 7: premium / discount on the right side
    target_mode: str = "rulebook"    # 'rulebook' (internal liquidity, next / opposing FVG CE, draw) | 'ladder' | 'fixed'
    fixed_rr: float = 2.0
    trend_filter: str = "none"       # 'none' | 'daily' | 'h4': only trade with that structure
    news_blackouts: tuple[tuple[pd.Timestamp, pd.Timestamp], ...] = field(default_factory=tuple)


def scan(ctx: Context, cfg: SBConfig = SBConfig()) -> list[Signal]:
    signals = []
    for day in np.unique(ctx.trading_day):
        d = pd.Timestamp(day).date()
        for key in cfg.windows:
            s = _scan_window(ctx, d, key, cfg)
            if s is not None:
                signals.append(s)
    return signals


def _scan_window(ctx: Context, day, key: str, cfg: SBConfig) -> Signal | None:
    w0, w1 = clock.get_window(key).bounds(day)
    ws, we = ctx.pos_of(w0), ctx.pos_of(w1)
    if ws >= len(ctx.base) or ws == 0 or ctx.base.index[ws] >= w1:
        return None  # no data inside the window
    if any(a <= w0 < b or a < w1 <= b for a, b in cfg.news_blackouts):
        return None  # checklist 2: high-impact news in the window

    bias = bias_at(ctx, ws - 1)
    if cfg.manual_bias:
        bias = replace(bias, direction=cfg.manual_bias)
    if bias.direction == 0 and cfg.require_bias:
        return None
    trend = trend_direction(ctx, ws - 1, cfg.trend_filter)
    if cfg.trend_filter != "none":
        if trend == 0 or (bias.direction and bias.direction != trend):
            return None
        bias = replace(bias, direction=trend)

    lead = ctx.pos_of(w0 - pd.Timedelta(minutes=cfg.raid_lead_min))
    pre_open = clock.get_window("london" if key == "london_sb" else "ny_am").bounds(day)[0]
    levels = (session_levels(ctx, lead) + running_range(ctx, pre_open, lead - 1, "pre_window")
              + raid_levels(ctx, we, ("1m", "5m", "15m"), cfg.raid_min_level, since=lead))
    setup = find_setup(ctx, bias.direction, levels, lead, ws, we, cfg.max_fvg_delay, cfg.timeframe,
                       strict_mss=cfg.strict_mss)
    if setup is None:
        return None
    expiry = w0 + pd.Timedelta(minutes=cfg.expiry_min)
    return build_signal(ctx, setup, MODEL, key, expiry, expiry, w1 + pd.Timedelta(minutes=cfg.exit_after_window_min),
                        bias, pre_open, Plan(cfg.entry, cfg.min_rr, cfg.min_first_rr, cfg.stop_buffer_mult,
                                             cfg.target_mode, cfg.fixed_rr, cfg.stop_mode, cfg.require_discount,
                                             cfg.min_target_mult))
