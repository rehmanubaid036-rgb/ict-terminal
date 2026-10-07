"""M10 News aftermath (rulebook M10, PDF journal: "Do not trade during shock windows; trade the
aftermath inefficiency").

For each high-impact USD event (NFP 08:30, FOMC 14:00; see ``news.us_high_impact_history``):
  1. Shock window: the first ``shock_min`` minutes after the release are never traded.
  2. The release must displace: the shock leg (event -> shock end) moves at least ``min_leg_adr`` of
     the 20-day average daily range.
  3. The inefficiency: the nearest unfilled 5m FVG the leg left in its own direction.
  4. Entry: a limit at that FVG's CE, in the leg's direction, placed after the shock window
     (NFP: when the window ends; FOMC: at the Asian open, 20:00, as the journal says) and valid for
     ``valid_hours``. Stop beyond the leg's origin (its low for a long) plus a buffer.
  5. Targets: the move's extreme by the time the order is placed, then the leg's 1.618 extension
     (at least ``min_rr`` to the last one).
Grade: A+ with the daily bias and a leg of 2x the minimum, A with one of them, else B.
"""
from __future__ import annotations

from dataclasses import dataclass, replace

import pandas as pd

from ..bias import bias_at
from ..context import Context
from ..core import clock
from ..indicators.fvg import active_at
from ..news import NewsEvent, us_high_impact_history
from ..signals import Signal

MODEL = "M10_news_aftermath"


@dataclass(frozen=True)
class NewsConfig:
    shock_min: int = 15
    min_leg_adr: float = 0.15
    valid_hours: float = 3.0
    fomc_entry_ny: str = "20:00"     # FOMC: the aftermath is traded in Asia
    fomc_valid_hours: float = 6.0
    min_rr: float = 1.5
    exit_after_min: int = 240
    require_bias: bool = False       # the release sets the direction; the bias only grades it
    events: tuple[NewsEvent, ...] | None = None   # default: the USD history for the context's dates


def _adr(ctx: Context, t: int, days: int = 20) -> float | None:
    lv = ctx.levels
    key = pd.Timestamp(ctx.trading_day[t])
    if key not in lv.index:
        return None
    i = lv.index.get_loc(key)
    rng = (lv["day_high"] - lv["day_low"]).iloc[max(0, i - days):i]
    return float(rng.mean()) if len(rng) >= 5 else None


def _one(ctx: Context, e: NewsEvent, cfg: NewsConfig) -> Signal | None:
    idx = ctx.base.index
    t0 = ctx.pos_of(e.time)
    shock_end = e.time + pd.Timedelta(minutes=cfg.shock_min)
    t1 = ctx.pos_of(shock_end)                  # first bar after the shock window
    if t0 <= 0 or t1 >= len(idx) or idx[t0] >= shock_end or t1 <= t0:
        return None
    leg = ctx.base.iloc[t0:t1]
    o, c = float(leg["open"].iloc[0]), float(leg["close"].iloc[-1])
    d = 1 if c > o else -1 if c < o else 0
    adr = _adr(ctx, t0)
    if d == 0 or adr is None:
        return None
    hi, lo = float(leg["high"].max()), float(leg["low"].min())
    size = hi - lo
    if size < cfg.min_leg_adr * adr:
        return None                              # no displacement: nothing to trade
    fomc = "FOMC" in e.title
    if fomc:
        day = pd.Timestamp(e.time.tz_convert(clock.NY).date())
        h, m = map(int, cfg.fomc_entry_ny.split(":"))
        place = (day + pd.Timedelta(hours=h, minutes=m)).tz_localize(clock.NY).tz_convert("UTC")
        hours = cfg.fomc_valid_hours
    else:
        place, hours = shock_end + pd.Timedelta(minutes=5), cfg.valid_hours
    tp = ctx.pos_of(place)                      # the order is placed when this bar has closed
    if tp >= len(idx):
        return None
    # the inefficiency: 5m FVGs of the leg's direction created during the leg, still open at placement
    p5 = ctx.htf_pos("5m", tp)
    if p5 < 0:
        return None
    f = active_at(ctx.analyses["5m"].fvgs, p5, d)
    f5 = ctx.frames["5m"].index
    f = f[[(e.time - pd.Timedelta(minutes=5)) <= f5[int(r)] < shock_end + pd.Timedelta(minutes=5) for r in f["created_pos"]]] if len(f) else f
    price = float(ctx.base["close"].iloc[tp])
    f = f[(f["ce"] < price) if d == 1 else (f["ce"] > price)] if len(f) else f
    if not len(f):
        return None
    stop = (lo if d == 1 else hi) - d * ctx.spec.stop_buffer
    # the move often runs on after the shock window: its extreme is the one reached by the time the
    # order is placed (so TP1 is a level price has not yet traded beyond)
    seg = ctx.base.iloc[t0:tp + 1]
    extreme = float(seg["high"].max()) if d == 1 else float(seg["low"].min())
    ext = (lo if d == 1 else hi) + d * 1.618 * size
    # the nearest FVG to price that still pays ``min_rr`` (deeper ones are filled less often)
    pick = None
    for _, row in f.assign(dist=(f["ce"] - price).abs()).sort_values("dist").iterrows():
        entry = float(row["ce"])
        risk = d * (entry - stop)
        tps = sorted({x for x in (extreme, ext) if d * (x - entry) > 0}, key=lambda x: d * x)
        if risk > 0 and tps and d * (tps[-1] - entry) >= cfg.min_rr * risk:
            pick = (row, entry, tps)
            break
    if pick is None:
        return None
    row, entry, tps = pick
    bias = bias_at(ctx, tp)
    if cfg.require_bias and bias.direction != d:
        return None
    targets = [(tps[0], 1.0)] if len(tps) == 1 else [(tps[0], 0.5), (tps[1], 0.5)]
    checklist = {"shock_window_skipped": True, "displacement": True, "fvg_left_by_release": True,
                 "with_daily_bias": bias.direction == d, "strong_leg": size >= 2 * cfg.min_leg_adr * adr}
    extra = int(checklist["with_daily_bias"]) + int(checklist["strong_leg"])
    grade = "A+" if extra == 2 else "A" if extra == 1 else "B"
    created = idx[tp]
    expiry = created + pd.Timedelta(hours=hours)
    return Signal(
        model=MODEL, symbol=ctx.symbol, direction=d, created_time=created, entry=entry, stop=stop,
        targets=targets, expiry=expiry, time_stop=None, exit_by=expiry + pd.Timedelta(minutes=cfg.exit_after_min),
        window="news_aftermath", grade=grade, score=3 + extra, checklist=checklist,
        notes={"event": e.title, "event_time": str(e.time), "leg": (lo, hi), "leg_adr": round(size / adr, 2),
               "fvg": (float(row["bottom"]), float(row["top"])), "entry_array": "5m FVG CE",
               "bias_score": bias.score, "draw": bias.draw, "be_offset": ctx.spec.spread},
    )


def scan(ctx: Context, cfg: NewsConfig = NewsConfig()) -> list[Signal]:
    if not len(ctx.base):
        return []
    idx = ctx.base.index
    events = cfg.events if cfg.events is not None else tuple(
        us_high_impact_history(idx[0].date(), idx[-1].date()))
    out = []
    for e in events:
        if e.impact != "High" or e.currency != "USD" or not (idx[0] <= e.time <= idx[-1]):
            continue
        s = _one(ctx, e, cfg)
        if s is not None:
            out.append(s)
    return out


def scan_m10(ctx: Context, **kw) -> list[Signal]:
    return scan(ctx, replace(NewsConfig(), **kw) if kw else NewsConfig())
