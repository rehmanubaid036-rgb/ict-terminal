"""M17 Wolf - Asia Session Model for indices (NQ / ES) and forex, built on the NDOG.

Rebuilt (2026-10-08) strictly from the PDF "ASIA SESSION MODEL FOR INDICIES NQ/ES - InnerCircleTrader
Youtube Mentorship 2024" by TheWolfTrades: ICT's example (pages 1-3) and Wolf's daily journal
(18-26 Aug 2024, pages 4-8). Nothing is added that the PDF does not show.

New York time, one trading day (1-minute chart):
  p.1  Market is off 17:00-18:00. Start with the 18:00 open.
  p.1  "once NDOG form, check if its over 20 handle mark mid point (consequent encroachment)":
       NDOG = the last close before 17:00 to the 18:00 open; over 20 handles (20 points on NQ / ES,
       20 pips on forex) its midpoint (CE) is marked.
  p.1  "After gap is formed at 1800 look for initial Buyside liquidity and initial sell side liquidity
       and mark it": the high and the low made from 18:00 until 19:00.
  p.1  "Wait for 0700 (1900) PM open of Asia, the algorithm will come online at 0700pm": the trade window
       is 19:00-21:00 (title) - "Markets operates on TIME first" (p.2); journal 19-08: "There is a setup
       but after our time window" = no trade.
  p.4-8 The setup in the journal: price makes a low, a candle breaks the short-term swing high before it
       (MSS) and the displacement leaves a BISI (orange box with its dotted middle). The entry is the BISI's
       middle; the stop is the "Wick C.E" of the candle that made the low.
  p.2  "stop loss was below the consequent encroachment of NDOG (when its breakaway gap like move)":
       when the displacement is a breakaway move through a marked NDOG, the stop is the NDOG CE.
  p.2-3 "How to set target? look for last opposite leg (down move in this case) before move and measure
       its 1 and 1.5 standard deviation for targets. close half at 1 standard deviation."
       "ICT personally target midpoint of 1 ... and 1.5 standard deviation (1.25)". Targets: -1 SD (half),
       -1.25 SD, -1.5 SD of that leg (0 = where the leg started, 1 = its low).
  A short is the mirror image of a long. The journal shows a short and a long on the same evening
  (18-08), so each direction can give one setup per day.

Not in the PDF and therefore not used here: daily bias, a minimum reward, a minimum FVG size, a time
exit, spread on the stop. The only reading made: the "last opposite leg" runs from the highest high since
price was last below the low (the previous lower low; 18:00 when there is none) to that low - exactly the
leg the PDF measures on pages 2-3.
"""
from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np
import pandas as pd

from ..context import Context
from ..core import clock
from ..signals import Signal

MODEL = "M17_wolf_asia_ndog"
WINDOW = "wolf_asia_1900_2100"
SYMBOLS = ("NAS100", "US500", "EURUSD", "GBPUSD")      # the PDF's markets: indices (NQ / ES) and forex
HANDLE = {"NAS100": 1.0, "US500": 1.0, "EURUSD": 0.0001, "GBPUSD": 0.0001}   # one handle (point / pip)


@dataclass(frozen=True)
class WolfConfig:
    window_start: str = "19:00"                       # p.1: the algorithm comes online
    window_end: str = "21:00"                         # title: 1900 to 2100
    ndog_handles: float = 20.0                        # p.1: "check if its over 20 handle"
    sd_targets: tuple[float, ...] = (1.0, 1.25, 1.5)  # p.2-3: 1 SD, ICT's 1.25 SD, 1.5 SD
    sd_split: tuple[float, ...] = (0.5, 0.25, 0.25)   # p.2: "close half at 1 standard deviation"
    symbols: tuple[str, ...] = SYMBOLS


@dataclass(frozen=True)
class Ndog:
    low: float
    high: float
    ce: float
    size: float
    over_20: bool          # over 20 handles: its CE is marked (and is the breakaway stop)


def ndog(ctx: Context, open_pos: int, handles: float) -> Ndog | None:
    """Gap between the last close before 17:00 and the 18:00 open (bar ``open_pos``)."""
    if open_pos <= 0 or open_pos >= len(ctx.base):
        return None
    t18 = ctx.base.index[open_pos]
    before = ctx.pos_of(t18 - pd.Timedelta(hours=1)) - 1         # last bar opening before 17:00
    if before < 0 or (t18 - ctx.base.index[before]) > pd.Timedelta(hours=72):
        return None
    c, o = float(ctx.base["close"].iloc[before]), float(ctx.base["open"].iloc[open_pos])
    lo, hi = min(c, o), max(c, o)
    return Ndog(lo, hi, (lo + hi) / 2, hi - lo, (hi - lo) > handles * HANDLE.get(ctx.symbol, 1.0))


def scan(ctx: Context, cfg: WolfConfig = WolfConfig()) -> list[Signal]:
    if ctx.symbol not in cfg.symbols:
        return []
    out = []
    for day in np.unique(ctx.trading_day):
        out.extend(_scan_day(ctx, pd.Timestamp(day).date(), cfg))
    return sorted(out, key=lambda s: s.created_time)


def _scan_day(ctx: Context, day, cfg: WolfConfig) -> list[Signal]:
    t18 = clock.get_window("asia").bounds(day)[0]                 # the 18:00 NY open of this trading day
    h1, m1 = map(int, cfg.window_start.split(":"))
    h2, m2 = map(int, cfg.window_end.split(":"))
    w0 = t18 + pd.Timedelta(hours=h1 - 18, minutes=m1)
    w1 = t18 + pd.Timedelta(hours=h2 - 18, minutes=m2)
    o18, ws, we = ctx.pos_of(t18), ctx.pos_of(w0), ctx.pos_of(w1)
    n = len(ctx.base)
    if o18 >= n or ws >= n or ctx.base.index[ws] >= w1 or ctx.base.index[o18] >= t18 + pd.Timedelta(minutes=30):
        return []                                                  # no 18:00 open (holiday / data gap) or no bars in the window
    gap = ndog(ctx, o18, cfg.ndog_handles)
    seg = ctx.base.iloc[o18:ws]                                    # initial buyside / sellside liquidity: 18:00-19:00
    initial = (float(seg["high"].max()), float(seg["low"].min())) if len(seg) else None
    out = []
    for d in (1, -1):
        sig = _find(ctx, d, o18, ws, we, w1, gap, initial, cfg)
        if sig is not None:
            out.append(sig)
    return out


def _find(ctx: Context, d: int, o18: int, ws: int, we: int, w1: pd.Timestamp, gap: Ndog | None,
          initial, cfg: WolfConfig) -> Signal | None:
    b = ctx.base
    O, H, L, C = (b[k].to_numpy(dtype=float) for k in ("open", "high", "low", "close"))
    # "long" arrays: a short is the mirror (prices negated, highs <-> lows)
    hi, lo, op, cl = (H, L, O, C) if d == 1 else (-L, -H, -O, -C)
    for i in range(ws, min(we, len(b))):                            # i = the MSS candle, closing inside 19:00-21:00
        # MSS: the latest short-term swing high (3-bar) since 18:00 that candle i is the first to close above,
        # with the low (x) made after it
        k = x = None
        for j in range(i - 2, o18, -1):
            if not (hi[j] > hi[j - 1] and hi[j] >= hi[j + 1]) or cl[i] <= hi[j]:
                continue
            if np.any(cl[j + 1:i] > hi[j]):
                continue                                            # broken earlier: not the swing of this MSS
            part = lo[j + 1:i]
            xj = j + 1 + int(np.flatnonzero(part == part.min())[-1])
            if lo[xj] < min(lo[j - 1], lo[j]):
                k, x = j, xj
                break
        if k is None:
            continue
        # the displacement's BISI: three candles a, b, c of the move from the low through the MSS with low[c] > high[a]
        fvg = None
        for j in range(x + 1, min(i + 1, len(b) - 1)):
            if lo[j + 1] > hi[j - 1]:
                fvg = (hi[j - 1], lo[j + 1], j + 1)
        if fvg is None:
            continue
        f_lo, f_hi, ready = fvg
        if ready >= we:
            return None                                             # completes after 21:00: "time first", no trade
        sig = _signal(ctx, d, x, k, i, ready, f_lo, f_hi, hi, lo, op, cl, o18, gap, initial, w1, cfg)
        if sig is not None:
            return sig
    return None


def _signal(ctx, d, x, k, i, ready, f_lo, f_hi, hi, lo, op, cl, o18, gap, initial, w1, cfg) -> Signal | None:
    ext = lo[x]
    entry_l = (f_lo + f_hi) / 2                                     # the BISI's middle (journal: dotted line in the orange box)
    wick_ce_l = (lo[x] + min(op[x], cl[x])) / 2                     # "Wick C.E" of the candle that made the low
    stop_l = wick_ce_l
    g_ce = g_hi = None
    if gap is not None:
        g_ce, g_hi = (gap.ce, gap.high) if d == 1 else (-gap.ce, -gap.low)
    # breakaway gap-like move: from below the marked NDOG, the displacement closes through it
    breakaway = bool(gap is not None and gap.over_20 and lo[x] < g_hi and cl[i] > g_hi)
    ndog_stop = bool(breakaway and g_ce < entry_l)
    if ndog_stop:
        stop_l = g_ce                                               # p.2: stop below the NDOG's CE
    if entry_l - stop_l <= 0:
        return None
    leg_from = _leg_start(hi, lo, x, o18)                           # 0 of the SD tool; 1 = the low
    leg = leg_from - ext
    if leg <= 0:
        return None
    sd_l = [leg_from + kk * leg for kk in cfg.sd_targets]
    if sd_l[0] <= entry_l:
        return None                                                 # the first target is not beyond the entry
    back = (lambda v: v) if d == 1 else (lambda v: -v)
    entry, stop, ext_p, leg_p = back(entry_l), back(stop_l), back(ext), back(leg_from)
    targets = [back(v) for v in sd_l]
    init_bsl, init_ssl = initial if initial else (None, None)
    took_initial = bool(initial and (ext_p <= init_ssl if d == 1 else ext_p >= init_bsl))
    checklist = {
        "ndog_over_20_handles": bool(gap and gap.over_20),         # p.1
        "initial_liquidity_marked": initial is not None,           # p.1
        "mss_in_1900_2100": True,                                  # title / p.2 time first
        "bisi_from_displacement": True,                            # p.2 / journal
        "initial_liquidity_taken": took_initial,                   # journal: the low runs the initial liquidity
        "breakaway_through_ndog": breakaway,                       # p.2
    }
    extra = int(checklist["ndog_over_20_handles"]) + int(took_initial) + int(breakaway)
    grade = "A+" if extra == 3 else "A" if extra == 2 else "B"
    return Signal(
        model=MODEL, symbol=ctx.symbol, direction=d, created_time=ctx.base.index[ready], entry=entry, stop=stop,
        targets=list(zip(targets, cfg.sd_split)), expiry=w1, time_stop=None, exit_by=None,
        window=WINDOW, grade=grade, score=int(sum(checklist.values())), checklist=checklist,
        notes={"author": "Wolf (TheWolfTrades)", "source": "ASIA SESSION MODEL FOR INDICIES NQ/ES (PDF)",
               "ndog": None if gap is None else {"low": gap.low, "high": gap.high, "ce": gap.ce, "size": gap.size,
                                                 "significant": gap.over_20},
               "ndog_time": str(ctx.base.index[o18]), "window_end": str(w1),
               "initial_bsl": init_bsl, "initial_ssl": init_ssl,
               "mss_level": back(hi[k]), "mss_time": str(ctx.base.index[i]),
               "fvg": (min(back(f_lo), back(f_hi)), max(back(f_lo), back(f_hi))),
               "wick_ce": back(wick_ce_l), "wick_time": str(ctx.base.index[x]),
               "stop_mode": "ndog_ce" if ndog_stop else "wick_ce", "ndog_stop": ndog_stop,
               "fib": {"0": leg_p, "1": ext_p, **{f"-{kk:g}": p for kk, p in zip(cfg.sd_targets, targets)}},
               "targets_from": [f"-{kk:g} SD" for kk in cfg.sd_targets]},
    )


def _leg_start(hi: np.ndarray, lo: np.ndarray, x: int, o18: int) -> float:
    """Where the last opposite leg (long view: the down move into the low at ``x``) started: the highest high
    since price was last below that low (the previous lower low), or since 18:00 when the low is the
    lowest of the evening. That is the leg the PDF measures (p.2-3: 0 at the 18:24 high after the initial
    sellside low, 1 at the 18:52 low)."""
    j = x - 1
    while j >= o18 and lo[j] >= lo[x]:
        j -= 1
    return float(np.max(hi[j + 1:x + 1]))


def scan_m17(ctx: Context, **kw) -> list[Signal]:
    """The engine passes every model the same options (require_bias, manual_bias ...); the PDF uses no daily
    bias, so options this model does not have are ignored."""
    own = {k: v for k, v in kw.items() if k in WolfConfig.__dataclass_fields__}
    return scan(ctx, replace(WolfConfig(), **own) if own else WolfConfig())
