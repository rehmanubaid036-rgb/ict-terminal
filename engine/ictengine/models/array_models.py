"""Reversal models whose entry array is not the new FVG (rulebook M11, M12, M13).

M11 IFVG reversal: after a raid, an *opposite* FVG is closed through (inverted) in the trade
    direction; the entry is that inversion FVG's CE on the retest.
M12 Breaker model: after a raid and a structure shift, an opposite order block that the shift
    broke (a breaker) is retested; the entry is the breaker's edge.
M13 Opening Range Gap (indices): the gap between the previous 16:15 close and the 09:30 open
    is traded toward its CE: a raid/MSS/FVG setup in the fill direction, target CE then full fill.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import time

import numpy as np
import pandas as pd

from ..bias import bias_at
from ..context import Context
from ..core import clock
from ..indicators.blocks import blocks_at
from ..indicators.common import NONE
from ..indicators.liquidity import BSL, SSL
from ..signals import Signal
from .common import allocate, find_raids, raid_levels, running_range, session_levels, target_ladder, swing_levels
from .reversal_models import ReversalConfig, _scan_window as reversal_window, _session_start

WINDOWS = (clock.get_window("london_kz"), clock.get_window("ny_am_kz"))


@dataclass(frozen=True)
class ArrayConfig:
    model: str
    array: str                  # 'ifvg' | 'breaker'
    windows: tuple = WINDOWS
    require_bias: bool = True
    manual_bias: int = 0
    raid_lead_min: int = 30
    min_rr: float = 2.0
    min_first_rr: float = 1.0
    stop_buffer_mult: float = 1.0
    exit_after_min: int = 120


M11_CONFIG = ArrayConfig("M11_ifvg_reversal", "ifvg")
M12_CONFIG = ArrayConfig("M12_breaker", "breaker")


def scan(ctx: Context, cfg: ArrayConfig) -> list[Signal]:
    out = []
    for day in np.unique(ctx.trading_day):
        d = pd.Timestamp(day).date()
        for w in cfg.windows:
            s = _scan_window(ctx, d, w, cfg)
            if s is not None:
                out.append(s)
    return out


def _scan_window(ctx: Context, day, w, cfg: ArrayConfig) -> Signal | None:
    w0, w1 = w.bounds(day)
    ws, we = ctx.pos_of(w0), ctx.pos_of(w1)
    if ws >= len(ctx.base) or ws == 0 or ctx.base.index[ws] >= w1:
        return None
    bias = bias_at(ctx, ws - 1)
    if cfg.manual_bias:
        bias = replace(bias, direction=cfg.manual_bias)
    if bias.direction == 0 and cfg.require_bias:
        return None
    lead = ctx.pos_of(w0 - pd.Timedelta(minutes=cfg.raid_lead_min))
    session_start = _session_start(day, w0)
    levels = (session_levels(ctx, lead) + running_range(ctx, session_start, lead - 1, "pre_window")
              + raid_levels(ctx, we, since=lead))
    best = None
    for d in ((bias.direction,) if bias.direction else (1, -1)):
        found = _first_array_entry(ctx, d, levels, lead, ws, we, cfg)
        if found is not None and (best is None or found[0] < best[0]):
            best = found
    if best is None:
        return None
    ready, d, raid, entry, zone = best
    lows, highs = ctx.base["low"], ctx.base["high"]
    ext = float(lows.iloc[raid.taken_pos:ready + 1].min()) if d == 1 else float(highs.iloc[raid.taken_pos:ready + 1].max())
    stop = ext - d * ctx.spec.stop_buffer * cfg.stop_buffer_mult
    risk = abs(entry - stop)
    if risk <= 0 or d * (entry - stop) <= 0:
        return None
    ladder = target_ladder(session_levels(ctx, ready) + swing_levels(ctx, ready, ("5m", "15m", "1h"), 1)
                           + running_range(ctx, session_start, ready, "pre_signal"), entry, risk, d, cfg.min_first_rr)
    prices = [lv.price for lv in ladder[:3]]
    if not prices or abs(prices[-1] - entry) < cfg.min_rr * risk:
        return None
    bar = ctx.base.iloc[ready]
    if (d == 1 and bar["high"] >= prices[0]) or (d == -1 and bar["low"] <= prices[0]):
        return None
    created = ctx.base.index[ready]
    if created >= w1:
        return None
    checklist = {"kill_zone": True, "liquidity_purged": True, "array_retest_pending": True,
                 "htf_structure": bias.components.get("daily_structure", 0) == d,
                 "dealing_range_side": bias.components.get("ipda_zone", 0) == d,
                 "partials_mapped": len(prices) >= 2}
    score = int(sum(checklist.values())) + int(bias.direction == d)
    grade = "A+" if score >= 7 else "A" if score >= 5 else "B"
    return Signal(model=cfg.model, symbol=ctx.symbol, direction=d, created_time=created, entry=entry, stop=stop,
                  targets=allocate(prices), expiry=w1, exit_by=w1 + pd.Timedelta(minutes=cfg.exit_after_min),
                  window=w.key, grade=grade, score=score, checklist=checklist,
                  notes={"raid_level": raid.level.name, "raid_price": raid.level.price,
                         "raid_time": str(ctx.base.index[raid.taken_pos]), "array": cfg.array, "zone": zone,
                         "bias_score": bias.score, "targets_from": [lv.name for lv in ladder[:3]]})


def _first_array_entry(ctx: Context, d: int, levels, lead: int, ws: int, we: int, cfg: ArrayConfig):
    """(ready_pos, direction, raid, entry, zone) of the earliest qualifying array, or None."""
    raids = find_raids(ctx, levels, SSL if d == 1 else BSL, lead, we)
    if not raids:
        return None
    a = ctx.analyses["1m"]
    best = None
    if cfg.array == "ifvg":
        f = a.fvgs
        # opposite FVGs that price closed through in our direction after the raid, inside the window
        inv = f[(f["direction"] == -d) & (f["inverted_pos"] != NONE) & (f["inverted_pos"] >= ws)
                & (f["inverted_pos"] < we) & (f["height"] >= ctx.spec.min_fvg)]
        for g in inv.itertuples():
            prior = [r for r in raids if r.reclaim_pos <= g.inverted_pos]
            if prior and g.created_pos >= prior[-1].taken_pos - 120:
                ready = int(g.inverted_pos)
                if best is None or ready < best[0]:
                    best = (ready, d, prior[-1], float(g.ce), (float(g.bottom), float(g.top)))
    else:  # breaker
        st = a.structure
        brks = st[(st["direction"] == d) & (st["pos"] >= ws) & (st["pos"] < we)]
        for b in brks.itertuples():
            prior = [r for r in raids if r.taken_pos <= b.extreme_pos and r.reclaim_pos <= b.pos]
            if not prior:
                continue
            obs = blocks_at(a.order_blocks, int(b.pos))
            br = obs[(obs["role"] == "breaker") & (obs["direction"] == -d)
                     & (obs["failed_pos"] > prior[-1].taken_pos) & (obs["failed_pos"] <= b.pos)]
            if br.empty:
                continue
            z = br.iloc[-1]
            entry = float(z["high"]) if d == 1 else float(z["low"])  # first touch of the breaker on the retest
            best = (int(b.pos), d, prior[-1], entry, (float(z["low"]), float(z["high"])))
            break
    return best


# --- M13 Opening Range Gap -------------------------------------------------------------

def org_direction(ctx: Context, day, t: int, min_gap_adr: float = 0.05) -> int:
    """Direction toward the Opening Range Gap's CE: -1 after a gap up, +1 after a gap down,
    0 when there is no gap of at least ``min_gap_adr`` x 20-day average range."""
    lv = ctx.levels
    key = pd.Timestamp(day)
    if key not in lv.index:
        return 0
    i = lv.index.get_loc(key)
    row = lv.iloc[i]
    if not np.isfinite(row["org_high"]) or not np.isfinite(row["open_0930"]):
        return 0
    adr = float((lv["day_high"] - lv["day_low"]).iloc[max(0, i - 20):i].mean()) if i >= 5 else np.nan
    if not np.isfinite(adr) or (row["org_high"] - row["org_low"]) < min_gap_adr * adr:
        return 0
    return -1 if row["open_0930"] >= row["org_high"] else 1


def _org_precondition(ctx, day, t):
    return org_direction(ctx, day, t) != 0


ORG_SYMBOLS = ("NAS100", "US30", "US500")   # rulebook M13 instruments
M13_CONFIG = ReversalConfig("M13_opening_range_gap",
                            (clock.TimeWindow("org", "Opening Range Gap", "model_window", time(9, 30), time(11, 0)),),
                            "all", require_bias=False, raid_lead_min=0, precondition=_org_precondition)


def scan_m11(ctx: Context, **kw) -> list[Signal]:
    return scan(ctx, replace(M11_CONFIG, **kw) if kw else M11_CONFIG)


def scan_m12(ctx: Context, **kw) -> list[Signal]:
    return scan(ctx, replace(M12_CONFIG, **kw) if kw else M12_CONFIG)


def scan_m13(ctx: Context, **kw) -> list[Signal]:
    """ORG model: each day's gap-fill direction replaces the bias for that day's window.
    Rulebook: indices with a cash session only (NAS100, US30, US500)."""
    if ctx.symbol not in ORG_SYMBOLS:
        return []
    cfg = replace(M13_CONFIG, **kw) if kw else M13_CONFIG
    out = []
    for day in np.unique(ctx.trading_day):
        d = pd.Timestamp(day).date()
        for w in cfg.windows:
            ws = ctx.pos_of(w.bounds(d)[0])
            if ws >= len(ctx.base) or ws == 0:
                continue
            direction = org_direction(ctx, d, ws)
            if direction == 0:
                continue
            sig = reversal_window(ctx, d, w, replace(cfg, manual_bias=direction, require_bias=True))
            if sig is not None:
                out.append(sig)
    return out
