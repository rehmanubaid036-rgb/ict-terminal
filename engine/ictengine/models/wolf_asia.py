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
  5. Targets: TP1 = 2R (double the stop), TP2 = 4R (double TP1), TP3 = 8R ... and the final target at
     the previous session's 15:30-16:00 NY high for a buy (low for a sell). Half closes at TP1, the
     other half is shared equally. When that high / low is not at least 2R away the targets are 2R,
     4R and 8R. The standard deviations of the last opposite leg (from the last intermediate-term swing
     before the extreme to the raid extreme) are drawn on the chart for reference.
  Time first: the structure shift itself must happen after 19:00. Each direction can give one
  setup a day (the journal's 18-08 had a short, then a long).
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import time

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
    sd_targets: tuple[float, ...] = (1.0, 1.25, 1.5)   # standard deviations drawn on the chart (not targets)
    first_target_r: float = 2.0      # TP1 in R (double the stop); each next target doubles the one before
    max_targets: int = 30            # up to the final target (a safety cap only)
    min_first_rr: float = 1.0        # 1 SD must pay at least the risk
    max_fvg_delay: int = 10
    timeframe: str = "1m"            # a 1-minute chart model
    raid_timeframes: tuple[str, ...] = ()  # PDF: only the initial BSL / SSL and session levels are raided;
                                            # ("15m",) etc. adds swing liquidity of those timeframes
    pm_target: bool = True           # previous session's 15:30-16:00 high (buy) / low (sell) is the target
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
        out.extend(_scan_day(ctx, pd.Timestamp(day).date(), cfg))
    return sorted(out, key=lambda s: s.created_time)


def _scan_day(ctx: Context, day, cfg: WolfAsiaConfig) -> list[Signal]:
    t18 = clock.get_window("asia").bounds(day)[0]
    h1, m1 = map(int, cfg.window_start.split(":"))
    h2, m2 = map(int, cfg.window_end.split(":"))
    w0 = t18 + pd.Timedelta(hours=h1 - 18, minutes=m1)
    w1 = t18 + pd.Timedelta(hours=h2 - 18, minutes=m2)
    o18, ws, we = ctx.pos_of(t18), ctx.pos_of(w0), ctx.pos_of(w1)
    if o18 >= len(ctx.base) or ws >= len(ctx.base) or ctx.base.index[ws] >= w1:
        return []
    if ctx.base.index[o18] >= t18 + pd.Timedelta(minutes=30):
        return []  # no 18:00 open (holiday / data gap)

    gap = ndog(ctx, o18, cfg.gap_min_fvg * ctx.spec.min_fvg)
    bias = bias_at(ctx, ws - 1)
    if cfg.manual_bias:
        bias = replace(bias, direction=cfg.manual_bias)
    if cfg.require_bias and bias.direction == 0:
        return []
    initial = running_range(ctx, t18, ws - 1, "initial")   # initial BSL / SSL, known at 19:00
    levels = session_levels(ctx, o18) + initial + raid_levels(ctx, we, cfg.raid_timeframes, since=o18)
    after_open = lambda c, st: int(st.brk.pos) >= ws       # time first: the shift happens after 19:00
    out = []
    for dirn in ((bias.direction,) if cfg.require_bias else (1, -1)):
        setup = find_setup(ctx, dirn, levels, o18, ws, we, cfg.max_fvg_delay, cfg.timeframe, accept=after_open)
        sig = None if setup is None else _signal(ctx, setup, gap, initial, bias, t18, w1, cfg)
        if sig is not None:
            out.append(sig)
    return out


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

    # standard deviations of the last opposite leg: 0 = where it started (last intermediate-term swing
    # before the extreme, known by now), 1 = the raid extreme
    leg_from = _leg_start(ctx, d, int(np.argmin(seg["low"].to_numpy()) if d == 1 else np.argmax(seg["high"].to_numpy()))
                          + raid.taken_pos, ready, float(b.broken_price))
    leg = d * (leg_from - ext)
    if leg <= 0:
        return None
    sd_prices = [leg_from + d * k * leg for k in cfg.sd_targets]
    pm = _pm_range(ctx, t18) if cfg.pm_target else None
    pm_price = None if pm is None else (pm[0] if d == 1 else pm[1])
    # TP1 = 2R (double the stop), every next target doubles the one before (4R, 8R, 16R ...), all the way
    # to the final target at the previous session's 15:30-16:00 high (buy) / low (sell). Without that
    # level at least TP1 away: 2R, 4R, 8R.
    first = cfg.first_target_r
    final_ok = pm_price is not None and d * (pm_price - entry) >= first * risk
    picked = []
    m = first
    while len(picked) < (cfg.max_targets - 1 if final_ok else 3):
        p = entry + d * m * risk
        if final_ok and d * (pm_price - p) < 0.25 * risk:      # this level is (almost) the final target
            break
        picked.append((p, f"{m:g}R"))
        m *= 2
    if final_ok:
        picked.append((pm_price, "15:30-16:00 " + ("high" if d == 1 else "low")))
    prices = [p for p, _ in picked]
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
        targets=_allocate(prices), expiry=w1, time_stop=None, exit_by=exit_by, window=WINDOW,
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
               "sd_leg": (leg_from, ext), "sd_levels": dict(zip([str(k) for k in cfg.sd_targets], sd_prices)),
               "pm_range": None if pm is None else {"high": pm[0], "low": pm[1], "start": str(pm[2]), "end": str(pm[3])},
               "bias_score": bias.score, "bias_components": bias.components, "draw": bias.draw,
               "targets_from": [n for _, n in picked]},
    )


def _allocate(prices: list[float]) -> list[tuple[float, float]]:
    """Half at TP1 (as in the PDF), the other half shared equally by the remaining targets."""
    if len(prices) < 2:
        return allocate(prices)
    rest = round(0.5 / (len(prices) - 1), 4)
    fr = [0.5] + [rest] * (len(prices) - 2)
    return list(zip(prices, fr + [round(1.0 - sum(fr), 4)]))


def _pm_range(ctx: Context, t18: pd.Timestamp):
    """High, low, start and end of 15:30-16:00 NY of the session before this 18:00 open (Friday's for a
    Sunday open), or None without data."""
    last = ctx.pos_of(t18 - pd.Timedelta(hours=1)) - 1          # last bar before the 17:00 close
    if last < 0:
        return None
    day = ctx.base.index[last].tz_convert(clock.NY).date()
    a, b = clock.ny_datetime(day, time(15, 30)), clock.ny_datetime(day, time(16, 0))
    seg = ctx.base.iloc[ctx.pos_of(a):ctx.pos_of(b)]
    if not len(seg):
        return None
    return float(seg["high"].max()), float(seg["low"].min()), a, b


def _leg_start(ctx: Context, d: int, extreme_pos: int, ready: int, fallback: float, max_bars: int = 240) -> float:
    """Price of the last intermediate-term (level >= 2) swing on the other side before the leg extreme:
    a swing high for a long (the down leg started there), a swing low for a short."""
    sw = ctx.analyses["1m"].swings
    kind = "high" if d == 1 else "low"
    c = sw[(sw["kind"] == kind) & (sw["level"] >= 2) & (sw["pos"] < extreme_pos) & (sw["pos"] >= extreme_pos - max_bars)
           & (sw["it_confirmed_pos"] <= ready)]
    if not len(c):
        return fallback
    price = float(c["price"].iloc[-1])
    return price if d * (price - fallback) >= 0 else fallback


def scan_m17(ctx: Context, **kw) -> list[Signal]:
    return scan(ctx, replace(WolfAsiaConfig(), **kw) if kw else WolfAsiaConfig())
