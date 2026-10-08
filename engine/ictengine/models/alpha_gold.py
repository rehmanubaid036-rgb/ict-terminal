"""M18 The Alpha Model Gold - built only from the PDF "The_Alpha_Model_Gold" (18 pages).

New York time (UTC-4). Gold (XAUUSD) only; Silver (XAGUSD) and the Dollar Index (DXY) give the bias.

Model execution time (p.1): London 02:00-05:00, New York 07:00-10:00.

HTF bias, for each of DXY, Silver and Gold (p.1-11):
  Step 1 (p.1)  weekly FVGs near the current price, with their 50 % level.
  Step 2 (p.5)  daily FVGs near the current price, with their 50 % level, found in the last 60 days
                (older ones only when there is none in 60 days).
  Step 3 (p.7)  the previous day's candle: its body closing above the 50 % of a daily or weekly FVG "in
                close vicinity" is bullish, closing below it is bearish (body, not wicks).
                Reading used: "in close vicinity" = an FVG the previous day's candle traded into; when it
                traded into several, the one whose 50 % is nearest its close. No such FVG: no daily bias.
  Step 4 (p.8)  confirm on H1 at 02:00 / 07:00: bullish bias - the last bullish H1 FVG before 02:00 / 07:00
                must not have failed (no H1 bearish body closed below its low); bearish - the mirror.
                A failed (or missing) gap leaves that asset without a confirmed bias (neutral).
  Step 5 (p.11) DXY bullish -> gold / silver bearish; DXY bearish -> gold / silver bullish.
  Scenarios (p.11-12), gold always opposite to DXY:
                A+  silver opposite to DXY (agrees with gold)
                A   silver neutral
                B   silver the same as DXY. (The PDF's B scenario 2 repeats A+ scenario 2 - "Dollar Bullish,
                    Silver Bearish, Gold Bearish" - read as the mirror of B scenario 1: silver bullish.)
                No trade when DXY or gold has no confirmed bias, or gold is not opposite to DXY.

Institutional entry on gold (p.13-16):
  Step 1  at 02:00 / 07:00 mark the previous M15 swing low (bullish bias) / swing high (bearish).
  Step 2  mark the previous M5 swing low / swing high.
  Step 3  when price breaks below that M5 swing low (bullish) / above the M5 swing high (bearish) inside the
          session window, on M1: bullish entry = failure of the last bearish FVG, a bearish entry = failure of
          the last bullish FVG, "with body not wick": the candle's body crosses the whole gap (open on one
          side, close beyond the other). A gap left with a wick inside it (the candle opens inside the gap)
          is ignored and the next signal is awaited (p.15). Entry at that candle's close.
          Stop: beyond the recent M1 swing (the extreme made since the M5 swing was broken).
Target (p.16-18): the previous M15 swing high (bullish) / swing low (bearish) before 02:00 / 07:00 - the most
recent one beyond the entry.

Not in the PDF and therefore not used: a time exit, partial closes, spread or buffers, minimum sizes.
One setup per session (the first one).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import time

import numpy as np
import pandas as pd

from ..context import Context, bar_close_times, epoch_ns
from ..core import clock
from ..core.candles import resample
from ..signals import Signal

MODEL = "M18_alpha_gold"
SYMBOLS = ("XAUUSD",)
SESSIONS = (("london", "02:00", "05:00"), ("new_york", "07:00", "10:00"))     # p.1


@dataclass(frozen=True)
class AlphaConfig:
    daily_lookback: int = 60          # p.5: FVGs found in the last 60 days
    sessions: tuple = SESSIONS
    symbols: tuple[str, ...] = SYMBOLS


# ---- candles of one instrument ---------------------------------------------------------------
class Frames:
    """1h / 1d / 1w candles of one instrument with the time each bar closes (no look-ahead)."""

    def __init__(self, df: pd.DataFrame):
        df = df[["open", "high", "low", "close"]].sort_index()
        self.tf: dict[str, pd.DataFrame] = {}
        self.closes: dict[str, np.ndarray] = {}
        for tf in ("1h", "1d", "1w"):
            f = resample(df, tf).drop(columns="n_bars")
            self.tf[tf] = f
            c = bar_close_times(f.index, tf)
            nxt = np.r_[epoch_ns(f.index)[1:], np.iinfo(np.int64).max]   # a bucket is complete once the next one began
            self.closes[tf] = np.minimum(c, nxt)

    def closed(self, tf: str, at: pd.Timestamp) -> int:
        """Number of ``tf`` bars closed at ``at``."""
        return int(np.searchsorted(self.closes[tf], int(epoch_ns(pd.DatetimeIndex([at]))[0]), side="right"))


def fvgs(f: pd.DataFrame, upto: int, first: int = 0) -> list[tuple[int, float, float, int]]:
    """FVGs among bars [first, upto): (direction, bottom, top, index of the third candle)."""
    h, l = f["high"].to_numpy(float), f["low"].to_numpy(float)
    out = []
    for i in range(max(first, 1), upto - 1):
        if l[i + 1] > h[i - 1]:
            out.append((1, h[i - 1], l[i + 1], i + 1))
        elif h[i + 1] < l[i - 1]:
            out.append((-1, h[i + 1], l[i - 1], i + 1))
    return out


def daily_bias(fr: Frames, at: pd.Timestamp, lookback: int) -> tuple[int, dict]:
    """p.1-7: +1 / -1 from the previous day's body against the 50 % of a nearby daily / weekly FVG, 0 = none."""
    d, w = fr.tf["1d"], fr.tf["1w"]
    nd, nw = fr.closed("1d", at), fr.closed("1w", at)
    if nd < 2:
        return 0, {}
    prev = nd - 1                                                   # the previous day's candle
    ph, pl, pc = float(d["high"].iloc[prev]), float(d["low"].iloc[prev]), float(d["close"].iloc[prev])
    daily = [g for g in fvgs(d, prev, max(0, prev - lookback))]
    if not daily:                                                   # p.5: older ones when none in 60 days
        daily = fvgs(d, prev)
    weekly = fvgs(w, nw)
    near = [(abs(pc - (b + t) / 2), tf, b, t) for tf, gaps in (("1d", daily), ("1w", weekly))
            for _, b, t, _ in gaps if pl <= t and ph >= b]          # the previous day traded into it
    if not near:
        return 0, {"prev_close": pc}
    _, tf, b, t = min(near)
    ce = (b + t) / 2
    bias = 1 if pc > ce else -1 if pc < ce else 0
    return bias, {"prev_close": pc, "fvg_tf": tf, "fvg": [b, t], "fvg_50": ce}


def h1_confirmed(fr: Frames, at: pd.Timestamp, bias: int) -> tuple[bool, dict]:
    """p.8: the last H1 gap of the bias' direction before ``at`` has not failed (no H1 body closed through it)."""
    h = fr.tf["1h"]
    n = fr.closed("1h", at)
    gaps = [g for g in fvgs(h, n) if g[0] == bias]
    if not gaps:
        return False, {"h1_fvg": None}
    _, b, t, k = gaps[-1]
    o, c = h["open"].to_numpy(float)[k + 1:n], h["close"].to_numpy(float)[k + 1:n]
    if bias == 1:
        failed = bool(np.any((c < o) & (c < b)))                    # a bearish body closed below its low
    else:
        failed = bool(np.any((c > o) & (c > t)))                    # a bullish body closed above its high
    return not failed, {"h1_fvg": [b, t], "h1_fvg_time": str(h.index[k]), "h1_failed": failed}


def asset_bias(fr: Frames | None, at: pd.Timestamp, cfg: AlphaConfig) -> tuple[int, dict]:
    if fr is None:
        return 0, {"missing": True}
    b, info = daily_bias(fr, at, cfg.daily_lookback)
    if b == 0:
        return 0, {**info, "daily": 0}
    ok, more = h1_confirmed(fr, at, b)
    return (b if ok else 0), {**info, **more, "daily": b, "confirmed": ok}


def scenario(dxy: int, silver: int, gold: int) -> str | None:
    """p.11-12."""
    if dxy == 0 or gold == 0 or gold != -dxy:
        return None
    return "A+" if silver == gold else "A" if silver == 0 else "B"


# ---- entry -----------------------------------------------------------------------------------
def swings(f: pd.DataFrame, at_ns: int, closes: np.ndarray) -> tuple[list, list]:
    """3-bar swing highs / lows of ``f`` whose right bar closed by ``at_ns``: [(index, price)]."""
    h, l = f["high"].to_numpy(float), f["low"].to_numpy(float)
    n = int(np.searchsorted(closes, at_ns, side="right"))
    highs = [(j, h[j]) for j in range(1, n - 1) if h[j] > h[j - 1] and h[j] >= h[j + 1]]
    lows = [(j, l[j]) for j in range(1, n - 1) if l[j] < l[j - 1] and l[j] <= l[j + 1]]
    return highs, lows


def scan(ctx: Context, cfg: AlphaConfig = AlphaConfig()) -> list[Signal]:
    if ctx.symbol not in cfg.symbols or len(ctx.base) < 100:
        return []
    long_src = ctx.base
    if ctx.history is not None and len(ctx.history):
        old = ctx.history[ctx.history.index < ctx.base.index[0]]
        long_src = pd.concat([old[["open", "high", "low", "close"]], ctx.base[["open", "high", "low", "close"]]])
    gold = Frames(long_src)
    others = {k: Frames(v) for k, v in (ctx.extras or {}).items() if v is not None and len(v)}
    m5, m15 = resample(ctx.base, "5m"), resample(ctx.base, "15m")
    c5, c15 = bar_close_times(m5.index, "5m"), bar_close_times(m15.index, "15m")
    out = []
    for day in np.unique(ctx.trading_day):
        d = pd.Timestamp(day).date()
        for name, s0, s1 in cfg.sessions:
            start = clock.ny_datetime(d, time(*map(int, s0.split(":")))).tz_convert("UTC")
            end = clock.ny_datetime(d, time(*map(int, s1.split(":")))).tz_convert("UTC")
            if start < ctx.base.index[0] or start > ctx.base.index[-1]:
                continue
            sig = _session(ctx, name, start, end, gold, others, m5, m15, c5, c15, cfg)
            if sig is not None:
                out.append(sig)
    return sorted(out, key=lambda s: s.created_time)


def _session(ctx, name, start, end, gold, others, m5, m15, c5, c15, cfg) -> Signal | None:
    bd, nd = asset_bias(others.get("DXY"), start, cfg)
    bs, ns = asset_bias(others.get("XAGUSD"), start, cfg)
    bg, ng = asset_bias(gold, start, cfg)
    grade = scenario(bd, bs, bg)
    if grade is None:
        return None
    d = bg
    # Step 1 / 2: the previous M15 and M5 swing (low for a bullish bias, high for a bearish one) before the session
    at = int(epoch_ns(pd.DatetimeIndex([start]))[0])
    h5, l5 = swings(m5, at, c5)
    h15, l15 = swings(m15, at, c15)
    sw5 = (l5 if d == 1 else h5)
    sw15 = (l15 if d == 1 else h15)
    if not sw5 or not sw15:
        return None
    m5_level, m15_level = float(sw5[-1][1]), float(sw15[-1][1])
    b = ctx.base
    O, H, L, C = (b[k].to_numpy(float) for k in ("open", "high", "low", "close"))
    i0, i1 = ctx.pos_of(start), ctx.pos_of(end)
    # long view: a short is the mirror (prices negated, highs <-> lows)
    hi, lo, op, cl = (H, L, O, C) if d == 1 else (-L, -H, -O, -C)
    lvl5 = m5_level if d == 1 else -m5_level
    brk = next((t for t in range(i0, min(i1, len(b))) if lo[t] < lvl5), None)   # Step 3: the M5 swing is broken
    if brk is None:
        return None
    used: set[int] = set()
    for t in range(brk + 1, min(i1, len(b))):
        # the last opposite FVG on M1 before candle t (bearish gap for a long: high[c] < low[a])
        gap = None
        for c in range(t - 1, max(i0 - 120, 1), -1):
            if hi[c] < lo[c - 2]:
                gap = (hi[c], lo[c - 2], c)
                break
        if gap is None or gap[2] in used:
            continue
        g_lo, g_hi, gc = gap
        if cl[t] <= g_hi:
            continue                                                # not failed yet
        used.add(gc)
        if op[t] > g_lo:
            continue                                                # p.15: opened inside the gap (wick inside): wait for the next
        entry_l = cl[t]
        stop_l = float(lo[brk:t + 1].min())                         # the recent M1 swing low since the M5 break
        if entry_l - stop_l <= 0:
            continue
        # target: the previous M15 swing high (long) / low (short) before the session, beyond the entry
        tgt_list = (h15 if d == 1 else l15)
        tgt = next((p for _, p in reversed(tgt_list) if d * (p - (entry_l if d == 1 else -entry_l)) > 0), None)
        if tgt is None:
            return None
        back = (lambda v: v) if d == 1 else (lambda v: -v)
        entry, stop = back(entry_l), back(stop_l)
        checklist = {"dxy_bias": True, "gold_bias_opposite_dxy": True, "silver_agrees": bs == bg,
                     "m5_swing_broken": True, "fvg_failed_with_body": True}
        return Signal(
            model=MODEL, symbol=ctx.symbol, direction=d, created_time=b.index[t], entry=entry, stop=stop,
            targets=[(float(tgt), 1.0)], expiry=end, time_stop=None, exit_by=None,
            window=f"alpha_{name}", grade=grade, score=int(sum(checklist.values())), checklist=checklist,
            notes={"author": "The Alpha Model Gold (PDF)", "session": name, "session_start": str(start),
                   "window_end": str(end), "scenario": grade,
                   "bias": {"DXY": bd, "XAGUSD": bs, "XAUUSD": bg},
                   "bias_detail": {"DXY": nd, "XAGUSD": ns, "XAUUSD": ng},
                   "m15_swing": m15_level, "m5_swing": m5_level, "m5_break_time": str(b.index[brk]),
                   "fvg": (min(back(g_lo), back(g_hi)), max(back(g_lo), back(g_hi))), "fvg_time": str(b.index[gc]),
                   "targets_from": ["M15 swing " + ("high" if d == 1 else "low")]},
        )
    return None


def scan_m18(ctx: Context, **kw) -> list[Signal]:
    """The engine passes every model the same options (require_bias ...); this model makes its own bias."""
    return scan(ctx)
