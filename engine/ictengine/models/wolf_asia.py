"""M17 - Wolf Asia Session model (NDOG) for indices and forex.

Source: "Asia Session Model for Indices NQ/ES" (ICT YouTube mentorship 2024), notes and daily
journal by TheWolfTrades.

Per trading day (New York time):
  1. The market is closed 17:00-18:00. The New Day Opening Gap (NDOG) is the gap between the
     last close before 17:00 and the 18:00 open; its midpoint is the consequent encroachment (CE).
     A gap counts as significant when it is at least ``gap_min_fvg`` x the symbol's minimum FVG
     (20 handles on NQ).
  2. After the gap forms, the initial buyside / sellside liquidity of the new day is marked:
     the 18:00-19:00 high and low, plus the short-term swings around them.
  3. The algorithm comes online at 19:00: trades are taken 19:00-21:00 only. Liquidity on one
     side is taken (from 18:00 on), then a market structure shift / displacement and an FVG
     created inside the window; limit entry at the FVG's CE.
  4. Stop at the CE of the wick of the candle that made the leg extreme ("Wick C.E" in the journal);
     when a significant NDOG's CE sits between that wick CE and the entry, the stop goes just beyond
     the NDOG CE instead (ICT's example).
  The model reads the 1-minute chart only.
  5. Targets: standard deviations of the last opposite leg (from the swing the shift broke to
     the raid extreme): 1 SD (close half), 1.25 SD and 1.5 SD.
"""
from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np
import pandas as pd

from ..bias import bias_at
from ..context import Context
from ..core import clock
from ..signals import Signal
from .common import allocate, raid_levels, running_range, session_levels
from .setup import find_setup

MODEL = "M17_wolf_asia_ndog"
WINDOW = "wolf_asia_1900_2100"
SYMBOLS = ("NAS100", "US500", "EURUSD", "GBPUSD")   # indices and forex (the PDF's markets)


@dataclass(frozen=True)
class WolfAsiaConfig:
    require_bias: bool = False       # the model trades the side that was raided; True = bias side only
    manual_bias: int = 0
    window_start: str = "19:00"
    window_end: str = "21:00"
    exit_after_min: int = 90         # any runner is closed 22:30 NY
    gap_min_fvg: float = 10.0        # significant NDOG = 10 x min FVG (20 handles on NAS100)
    sd_targets: tuple[float, ...] = (1.0, 1.25, 1.5)
    min_first_rr: float = 1.0        # 1 SD must pay at least the risk
    max_fvg_delay: int = 10
    timeframe: str = "1m"            # a 1-minute chart model
    stop: str = "wick_ce"            # 'wick_ce' (journal) | 'extreme' (beyond the raid extreme + buffer)
    stop_buffer_mult: float = 1.0
    symbols: tuple[str, ...] = SYMBOLS


@dataclass(frozen=True)
class Ndog:
    low: float
    high: float
    ce: float
    size: float
    significant: bool


def ndog(ctx: Context, open_pos: int, gap_min: float) -> Ndog | None:
    """Gap between the last close before 17:00 and the 18:00 open (bar ``open_pos``)."""
    if open_pos <= 0 or open_pos >= len(ctx.base):
        return None
    t18 = ctx.base.index[open_pos]
    before = ctx.pos_of(t18 - pd.Timedelta(hours=1)) - 1   # last bar opening before 17:00
    if before < 0 or (t18 - ctx.base.index[before]) > pd.Timedelta(hours=72):
        return None
    c, o = float(ctx.base["close"].iloc[before]), float(ctx.base["open"].iloc[open_pos])
    lo, hi = min(c, o), max(c, o)
    return Ndog(lo, hi, (lo + hi) / 2, hi - lo, (hi - lo) >= gap_min)


def scan(ctx: Context, cfg: WolfAsiaConfig = WolfAsiaConfig()) -> list[Signal]:
    if ctx.symbol not in cfg.symbols:
        return []
    out = []
    for day in np.unique(ctx.trading_day):
        s = _scan_day(ctx, pd.Timestamp(day).date(), cfg)
        if s is not None:
            out.append(s)
    return out


def _scan_day(ctx: Context, day, cfg: WolfAsiaConfig) -> Signal | None:
    t18 = clock.get_window("asia").bounds(day)[0]
    h1, m1 = map(int, cfg.window_start.split(":"))
    h2, m2 = map(int, cfg.window_end.split(":"))
    w0 = t18 + pd.Timedelta(hours=h1 - 18, minutes=m1)
    w1 = t18 + pd.Timedelta(hours=h2 - 18, minutes=m2)
    o18, ws, we = ctx.pos_of(t18), ctx.pos_of(w0), ctx.pos_of(w1)
    if o18 >= len(ctx.base) or ws >= len(ctx.base) or ctx.base.index[ws] >= w1:
        return None
    if ctx.base.index[o18] >= t18 + pd.Timedelta(minutes=30):
        return None  # no 18:00 open (holiday / data gap)

    gap = ndog(ctx, o18, cfg.gap_min_fvg * ctx.spec.min_fvg)
    bias = bias_at(ctx, ws - 1)
    if cfg.manual_bias:
        bias = replace(bias, direction=cfg.manual_bias)
    direction = bias.direction if cfg.require_bias else 0
    if cfg.require_bias and direction == 0:
        return None

    initial = running_range(ctx, t18, ws - 1, "initial")   # initial BSL / SSL, known at 19:00
    levels = session_levels(ctx, o18) + initial + raid_levels(ctx, we, since=o18)
    setup = find_setup(ctx, direction, levels, o18, ws, we, cfg.max_fvg_delay, cfg.timeframe)
    if setup is None:
        return None
    return _signal(ctx, setup, gap, initial, bias, t18, w1, cfg)


def _signal(ctx: Context, s, gap: Ndog | None, initial, bias, t18: pd.Timestamp, w1: pd.Timestamp,
            cfg: WolfAsiaConfig) -> Signal | None:
    d, g, b, raid = s.direction, s.fvg, s.brk, s.raid
    ready = s.ready_pos
    created = ctx.base.index[ready]
    if created >= w1:
        return None
    lows, highs = ctx.base["low"], ctx.base["high"]
    ext = float(min(raid.extreme, lows.iloc[raid.taken_pos:ready + 1].min())) if d == 1 \
        else float(max(raid.extreme, highs.iloc[raid.taken_pos:ready + 1].max()))
    entry = float(g.ce)
    seg = ctx.base.iloc[raid.taken_pos:ready + 1]
    xbar = seg.iloc[int(np.argmin(seg["low"].to_numpy()) if d == 1 else np.argmax(seg["high"].to_numpy()))]
    wick_ce = (float(xbar["low"]) + min(float(xbar["open"]), float(xbar["close"]))) / 2 if d == 1 \
        else (float(xbar["high"]) + max(float(xbar["open"]), float(xbar["close"]))) / 2
    if cfg.stop == "wick_ce":
        buf = ctx.spec.spread
        stop = wick_ce - d * buf
    else:
        buf = ctx.spec.stop_buffer * cfg.stop_buffer_mult
        stop = ext - d * buf
    ndog_stop = bool(gap and gap.significant and d * (gap.ce - stop) > 0 and d * (entry - gap.ce) > 2 * buf)
    if ndog_stop:
        stop = gap.ce - d * buf
    risk = d * (entry - stop)
    if risk <= 0:
        return None

    # standard deviations of the opposite leg: 0 = the swing the shift broke, 1 = the raid extreme
    leg_from = float(b.broken_price)
    leg = d * (leg_from - ext)
    if leg <= 0:
        return None
    prices = [leg_from + d * k * leg for k in cfg.sd_targets]
    prices = [p for p in prices if d * (p - entry) > 0]
    if len(prices) < len(cfg.sd_targets) or d * (prices[0] - entry) < cfg.min_first_rr * risk:
        return None
    bar = ctx.base.iloc[ready]
    if (d == 1 and bar["high"] >= prices[0]) or (d == -1 and bar["low"] <= prices[0]):
        return None  # 1 SD already traded before the order could be placed

    checklist = {
        "ndog_marked": gap is not None,
        "ndog_significant": bool(gap and gap.significant),
        "initial_liquidity_taken": raid.level.name.startswith("initial"),
        "time_window_1900_2100": True,
        "ltf_structure": bool(b.kind == "MSS" or b.displacement),
        "fresh_fvg_in_window": bool(s.fresh),
        "entry_away_from_ndog": bool(gap is None or d * (entry - gap.high if d == 1 else entry - gap.low) > 0),
        "with_daily_bias": bias.direction == d,
        "stop_defined": True,
        "partials_mapped": True,
    }
    score = int(sum(checklist.values())) + int(bool(b.displacement))
    top = len(checklist) + 1
    grade = "A+" if score >= top - 1 else "A" if score >= top - 3 else "B"
    exit_by = w1 + pd.Timedelta(minutes=cfg.exit_after_min)
    return Signal(
        model=MODEL, symbol=ctx.symbol, direction=d, created_time=created, entry=entry, stop=stop,
        targets=allocate(prices), expiry=w1, time_stop=None, exit_by=exit_by, window=WINDOW,
        grade=grade, score=score, checklist=checklist,
        notes={"author": "Wolf (TheWolfTrades)", "raid_level": raid.level.name, "raid_price": raid.level.price,
               "raid_time": str(ctx.base.index[raid.taken_pos]), "break_kind": str(b.kind),
               "break_time": str(b.time), "fvg": (float(g.bottom), float(g.top)),
               "ndog": None if gap is None else {"low": gap.low, "high": gap.high, "ce": gap.ce,
                                                 "size": gap.size, "significant": gap.significant},
               "ndog_stop": ndog_stop, "wick_ce": wick_ce, "wick_time": str(xbar.name),
               "ndog_time": str(t18), "window_end": str(w1),
               "initial_bsl": initial[0].price if initial else None,
               "initial_ssl": initial[1].price if initial else None,
               "sd_leg": (leg_from, ext), "sd_levels": dict(zip([str(k) for k in cfg.sd_targets], prices)),
               "bias_score": bias.score, "bias_components": bias.components, "draw": bias.draw,
               "targets_from": [f"{k} SD" for k in cfg.sd_targets]},
    )


def scan_m17(ctx: Context, **kw) -> list[Signal]:
    return scan(ctx, replace(WolfAsiaConfig(), **kw) if kw else WolfAsiaConfig())
