"""M17 Wolf - Asia Session Model for indices (NQ / ES) and forex, built on the NDOG.

Source: "ASIA SESSION MODEL FOR INDICIES NQ/ES" (ICT YouTube mentorship 2024), notes and daily
journal (18-26 Aug 2024) by TheWolfTrades. Every rule below is from that PDF; the journal charts
were measured to pin down the levels.

Per trading day, New York time:
  1. 17:00-18:00 the market is closed. NDOG = the gap between the last close before 17:00 and the
     18:00 open; its midpoint is the consequent encroachment (CE). PDF: "check if it is over 20
     handles" (20 handles on NQ = 10 x the symbol's minimum FVG here, 5 on ES, 20 pips on FX).
  2. After the gap forms, mark the initial buyside and sellside liquidity: the high and low made
     from 18:00 until the algorithm comes online.
  3. 19:00 the algorithm comes online; the trade window is 19:00-21:00 ("time first, not price":
     a setup after 21:00 is not taken - journal 19-08).
  4. Setup (long; a short is the mirror): price runs to a low (the leg extreme), then a candle
     closes above the short-term swing high made just before that low (MSS, orange line in the
     journal) inside the window, and the displacement leaves a bullish FVG (BISI).
     Entry: limit at the CE of that FVG (orange box with the dotted CE line in the journal).
  5. Stop: the CE of the wick of the candle that made the low ("Wick C.E" in the journal). When the
     displacement is a breakaway move through the NDOG, ICT's stop just under the NDOG CE is used.
  6. Targets ("How to set target?"): the last opposite leg before the move (0 = where that leg
     started, 1 = its low) projected 1, 1.25 and 1.5 standard deviations: close half at -1 SD,
     ICT's own target -1.25 SD, the rest at -1.5 SD.
     The leg start, as measured on the PDF's charts: walking back from the low, the highest high before
     a real pullback (a bar below the middle of the leg), skipping pullbacks while the leg is still too
     small to pay the trade. ICT's example and 4 of the 5 journal days match; on 26-08 Wolf measured
     from the 18:10 high, one swing further back.
  One setup per direction per day (journal 18-08: a short, then a long). Reads the 1-minute chart.
"""
from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np
import pandas as pd

from ..bias import bias_at
from ..context import Context
from ..core import clock
from ..signals import Signal

MODEL = "M17_wolf_asia_ndog"
WINDOW = "wolf_asia_1900_2100"
SYMBOLS = ("NAS100", "US500", "EURUSD", "GBPUSD")   # indices and forex (the PDF's markets)


@dataclass(frozen=True)
class WolfConfig:
    window_start: str = "19:00"
    window_end: str = "21:00"
    exit_after_min: int = 90          # any remainder is closed 22:30 NY (not in the PDF; keeps a night trade short)
    gap_handles_fvg: float = 10.0     # "over 20 handles" = 10 x min FVG (NQ 20, ES 5, FX 20 pips)
    sd_targets: tuple[float, ...] = (1.0, 1.25, 1.5)
    sd_split: tuple[float, ...] = (0.5, 0.25, 0.25)   # PDF: close half at 1 SD
    fvg_min_mult: float = 0.5         # journal FVGs are 1.5-2.5 points on NQ (min FVG 2)
    lookback_bars: int = 90           # the leg low is looked for this far back (and not before 18:00)
    max_fvg_delay: int = 10           # bars after the MSS for the FVG to form
    min_first_rr: float = 1.0         # -1 SD must pay at least the risk
    require_bias: bool = False        # the PDF trades what the 19:00 algorithm does; True = daily bias side only
    manual_bias: int = 0
    symbols: tuple[str, ...] = SYMBOLS


@dataclass(frozen=True)
class Ndog:
    low: float
    high: float
    ce: float
    size: float
    over_20: bool


def ndog(ctx: Context, open_pos: int, min_size: float) -> Ndog | None:
    """Gap between the last close before 17:00 and the 18:00 open (bar ``open_pos``)."""
    if open_pos <= 0 or open_pos >= len(ctx.base):
        return None
    t18 = ctx.base.index[open_pos]
    before = ctx.pos_of(t18 - pd.Timedelta(hours=1)) - 1   # last bar opening before 17:00
    if before < 0 or (t18 - ctx.base.index[before]) > pd.Timedelta(hours=72):
        return None
    c, o = float(ctx.base["close"].iloc[before]), float(ctx.base["open"].iloc[open_pos])
    lo, hi = min(c, o), max(c, o)
    return Ndog(lo, hi, (lo + hi) / 2, hi - lo, (hi - lo) >= min_size)


def scan(ctx: Context, cfg: WolfConfig = WolfConfig()) -> list[Signal]:
    if ctx.symbol not in cfg.symbols:
        return []
    out = []
    for day in np.unique(ctx.trading_day):
        out.extend(_scan_day(ctx, pd.Timestamp(day).date(), cfg))
    return sorted(out, key=lambda s: s.created_time)


def _scan_day(ctx: Context, day, cfg: WolfConfig) -> list[Signal]:
    t18 = clock.get_window("asia").bounds(day)[0]                    # 18:00 NY open of this trading day
    h1, m1 = map(int, cfg.window_start.split(":"))
    h2, m2 = map(int, cfg.window_end.split(":"))
    w0 = t18 + pd.Timedelta(hours=h1 - 18, minutes=m1)
    w1 = t18 + pd.Timedelta(hours=h2 - 18, minutes=m2)
    o18, ws, we = ctx.pos_of(t18), ctx.pos_of(w0), ctx.pos_of(w1)
    n = len(ctx.base)
    if o18 >= n or ws >= n or ctx.base.index[ws] >= w1 or ctx.base.index[o18] >= t18 + pd.Timedelta(minutes=30):
        return []   # no 18:00 open (holiday / data gap) or no bars in the window
    gap = ndog(ctx, o18, cfg.gap_handles_fvg * ctx.spec.min_fvg)
    bias = bias_at(ctx, ws - 1)
    if cfg.manual_bias:
        bias = replace(bias, direction=cfg.manual_bias)
    if cfg.require_bias and bias.direction == 0:
        return []
    # initial buyside / sellside liquidity: 18:00 up to the 19:00 open
    seg = ctx.base.iloc[o18:ws]
    initial = (float(seg["high"].max()), float(seg["low"].min())) if len(seg) else None
    out = []
    for d in ((bias.direction,) if cfg.require_bias else (1, -1)):
        sig = _find(ctx, d, o18, ws, we, w1, gap, initial, bias, cfg)
        if sig is not None:
            out.append(sig)
    return out


def _find(ctx: Context, d: int, o18: int, ws: int, we: int, w1: pd.Timestamp, gap: Ndog | None,
          initial, bias, cfg: WolfConfig) -> Signal | None:
    b = ctx.base
    O, H, L, C = (b[k].to_numpy(dtype=float) for k in ("open", "high", "low", "close"))
    # work on "long" arrays: a short is the mirror image (prices negated, highs <-> lows)
    if d == 1:
        hi, lo, op, cl = H, L, O, C
    else:
        hi, lo, op, cl = -L, -H, -O, -C
    min_fvg = cfg.fvg_min_mult * ctx.spec.min_fvg
    for i in range(ws, min(we, len(b))):                     # i = the MSS candle, closing inside the window
        start = max(o18 + 1, i - cfg.lookback_bars)
        k = x = None
        # MSS: the latest short-term swing high (3-bar fractal) that candle i is the first to close above,
        # with a lower low made after it (the leg low, x)
        for j in range(i - 2, start - 1, -1):
            if not (hi[j] > hi[j - 1] and hi[j] >= hi[j + 1]) or cl[i] <= hi[j]:
                continue
            if np.any(cl[j + 1:i] > hi[j]):
                continue                                       # this swing was broken earlier
            part = lo[j + 1:i]
            xj = j + 1 + int(np.flatnonzero(part == part.min())[-1])
            if lo[xj] < min(lo[j - 1], lo[j]):
                k, x = j, xj
                break
        if k is None:
            continue
        # the displacement's FVG (BISI): candles j-1, j, j+1 with low[j+1] > high[j-1]
        fvg = None
        for j in range(max(x + 1, i - 1), min(i + cfg.max_fvg_delay, len(b) - 1)):
            if lo[j + 1] - hi[j - 1] >= min_fvg:
                fvg = (hi[j - 1], lo[j + 1], j + 1)
                break
        if fvg is None:
            continue
        f_lo, f_hi, ready = fvg
        if ready >= we:
            return None                                        # the setup completes after 21:00: no trade
        sig = _signal(ctx, d, x, k, i, ready, f_lo, f_hi, hi, lo, op, cl, o18, gap, initial, bias, w1, cfg)
        if sig is not None:
            return sig
    return None


def _signal(ctx, d, x, k, i, ready, f_lo, f_hi, hi, lo, op, cl, o18, gap, initial, bias, w1, cfg) -> Signal | None:
    sgn = float(d)
    ext = lo[x]
    entry_l = (f_lo + f_hi) / 2                                # CE of the FVG
    # stop: CE of the low candle's wick, or just under the NDOG CE on a breakaway move through the gap
    wick_ce_l = (lo[x] + min(op[x], cl[x])) / 2
    buf = ctx.spec.spread
    stop_l = wick_ce_l - buf
    g_ce = g_lo = g_hi = None
    if gap is not None:
        g_ce, g_lo, g_hi = (gap.ce, gap.low, gap.high) if d == 1 else (-gap.ce, -gap.high, -gap.low)
    breakaway = bool(gap is not None and gap.size > 0 and lo[x] < g_hi and cl[i] > g_hi)
    ndog_stop = bool(breakaway and stop_l < g_ce - buf and entry_l - g_ce > 2 * buf)
    if ndog_stop:
        stop_l = g_ce - buf
    risk = entry_l - stop_l
    if risk <= 0:
        return None
    # SD tool on the last opposite leg: 1 at the low, 0 where the leg started
    # -1 SD = 2 x leg_from - low must reach entry + min_rr x risk
    leg_from = _leg_start(hi, lo, x, o18, (entry_l + cfg.min_first_rr * risk + ext) / 2)
    leg = leg_from - ext
    if leg <= 0:
        return None
    sd_l = [leg_from + kk * leg for kk in cfg.sd_targets]
    if sd_l[0] - entry_l < cfg.min_first_rr * risk:
        return None
    if hi[ready] >= sd_l[0]:
        return None                                            # -1 SD traded before the order existed
    back = (lambda v: v) if d == 1 else (lambda v: -v)
    entry, stop, ext_p, leg_p = back(entry_l), back(stop_l), back(ext), back(leg_from)
    targets = [back(v) for v in sd_l]
    created = ctx.base.index[ready]

    init_bsl, init_ssl = initial if initial else (None, None)
    took_initial = bool(initial and (ext_p <= init_ssl if d == 1 else ext_p >= init_bsl))
    draw = init_bsl if d == 1 else init_ssl
    checklist = {
        "ndog_marked": gap is not None,
        "ndog_over_20_handles": bool(gap and gap.over_20),
        "initial_liquidity_marked": initial is not None,
        "mss_in_1900_2100": True,
        "fvg_from_displacement": True,
        "initial_liquidity_taken": took_initial,
        "draw_on_initial_liquidity": bool(draw is not None and sgn * (draw - entry) > 0),
        "breakaway_through_ndog": breakaway,
        "with_daily_bias": bias.direction == d,
    }
    score = int(sum(checklist.values()))
    grade = "A+" if score >= 8 else "A" if score >= 6 else "B"
    return Signal(
        model=MODEL, symbol=ctx.symbol, direction=d, created_time=created, entry=entry, stop=stop,
        targets=list(zip(targets, cfg.sd_split)), expiry=w1, time_stop=None,
        exit_by=w1 + pd.Timedelta(minutes=cfg.exit_after_min), window=WINDOW, grade=grade, score=score,
        checklist=checklist,
        notes={"author": "Wolf (TheWolfTrades)",
               "ndog": None if gap is None else {"low": gap.low, "high": gap.high, "ce": gap.ce, "size": gap.size,
                                                 "significant": gap.over_20},
               "ndog_time": str(ctx.base.index[o18]), "window_end": str(w1),
               "initial_bsl": init_bsl, "initial_ssl": init_ssl,
               "mss_level": back(hi[k]), "mss_time": str(ctx.base.index[i]),
               "fvg": (min(back(f_lo), back(f_hi)), max(back(f_lo), back(f_hi))),
               "wick_ce": back(wick_ce_l), "wick_time": str(ctx.base.index[x]),
               "stop_mode": "ndog_ce" if ndog_stop else "wick_ce", "ndog_stop": ndog_stop,
               "fib": {"0": leg_p, "1": ext_p, **{f"-{kk:g}": p for kk, p in zip(cfg.sd_targets, targets)}},
               "targets_from": [f"-{kk:g} SD" for kk in cfg.sd_targets],
               "bias_score": bias.score},
    )


def _leg_start(hi: np.ndarray, lo: np.ndarray, x: int, o18: int, need: float) -> float:
    """Start of the last opposite leg (long view). Walking back from the low at ``x``, the highest high
    reached before a bar traded below the middle of the leg - a real pullback, so the leg before it
    started at that high. Pullbacks are ignored while the leg is too small to pay the trade
    (``need``: the -1 SD target must clear the entry by the risk). Not before the 18:00 open."""
    top = hi[x]
    for j in range(x - 1, o18 - 1, -1):
        if hi[j] > top:
            top = hi[j]
        elif lo[j] < (top + lo[x]) / 2 and top >= need:
            break
    return float(top)


def scan_m17(ctx: Context, **kw) -> list[Signal]:
    return scan(ctx, replace(WolfConfig(), **kw) if kw else WolfConfig())
