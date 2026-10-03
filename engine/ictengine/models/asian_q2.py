"""M5 - Asian Q2 Judas / Turtle Soup (rulebook section 4/M5, from the 29 Sep WhatsApp screenshot).

Per trading day (New York time):
  Reference   Asian Q1 range (18:00-19:30) high / low and the Q2 True Open (19:30 open).
  Window      19:45 - 21:00 (Asia Q2, the manipulation quarter).
  Setup       short: price raids above the Asian Q1 high and trades into a higher-timeframe SIBI
              (bearish FVG on 15m / 1H / 4H) that sits above the Q1 high. Long: the mirror (Q1 low
              raided into a 15m / 1H / 4H BISI).
  Entry       limit at the 15m SIBI's bottom (BISI's top for a long); without a 15m one, the 1H SIBI's
              CE (the 4H one's CE as the last choice).
  Stop        beyond the 4H SIBI's upper boundary (BISI's lower one); without a 4H FVG over the
              entry, beyond the entered FVG's far edge + SymbolSpec.stop_buffer [DEFAULT].
  Targets     TP1 (50%) the Q2 True Open retest -> stop to breakeven; TP2 (30%) the Asian Q1 low
              (high for a long); TP3 (20%) the nearest 1H bullish OB / BISI below it (bearish OB /
              SIBI above it for a long).
  The order is cancelled at 21:00; a body close beyond the FVG's far edge before the fill cancels it.
"""
from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np
import pandas as pd

from ..bias import bias_at
from ..context import Context
from ..core import clock
from ..indicators.blocks import blocks_at
from ..indicators.fvg import active_at
from ..signals import Signal

MODEL = "M5_asian_q2_judas"
WINDOW = "asia_q2_judas"
FRACTIONS = (0.5, 0.3, 0.2)


@dataclass(frozen=True)
class AsianQ2Config:
    require_bias: bool = False       # True: only the bias side (the rulebook does not ask for it)
    manual_bias: int = 0
    window_start: str = "19:45"
    window_end: str = "21:00"
    exit_after_min: int = 180        # any runner is closed 00:00 NY
    entry_timeframes: tuple[str, ...] = ("15m", "1h", "4h")
    min_rr: float = 1.0              # TP3 at least this x risk


def scan(ctx: Context, cfg: AsianQ2Config = AsianQ2Config()) -> list[Signal]:
    out = []
    for day in np.unique(ctx.trading_day):
        out.extend(_scan_day(ctx, pd.Timestamp(day).date(), cfg))
    return sorted(out, key=lambda s: s.created_time)


def _at(t18: pd.Timestamp, hhmm: str) -> pd.Timestamp:
    h, m = map(int, hhmm.split(":"))
    return t18 + pd.Timedelta(hours=(h - 18) % 24, minutes=m)


def _scan_day(ctx: Context, day, cfg: AsianQ2Config) -> list[Signal]:
    t18 = clock.get_window("asia").bounds(day)[0]
    q1_end, w0, w1 = _at(t18, "19:30"), _at(t18, cfg.window_start), _at(t18, cfg.window_end)
    o18, oq2, ws, we = ctx.pos_of(t18), ctx.pos_of(q1_end), ctx.pos_of(w0), ctx.pos_of(w1)
    if ws >= len(ctx.base) or ctx.base.index[ws] >= w1 or oq2 >= len(ctx.base) or oq2 <= o18:
        return []
    if ctx.base.index[o18] >= t18 + pd.Timedelta(minutes=30) or ctx.base.index[oq2] >= w0:
        return []
    q1 = ctx.base.iloc[o18:oq2]
    q1_high, q1_low = float(q1["high"].max()), float(q1["low"].min())
    true_open = float(ctx.base["open"].iloc[oq2])
    bias = bias_at(ctx, ws - 1)
    if cfg.manual_bias:
        bias = replace(bias, direction=cfg.manual_bias)
    dirs = (bias.direction,) if cfg.require_bias else (-1, 1)
    out = []
    for d in dirs:
        if d == 0:
            continue
        sig = _setup(ctx, d, ws, we, q1_high, q1_low, true_open, bias, t18, w1, cfg)
        if sig is not None:
            out.append(sig)
    return out


def _htf_fvgs(ctx: Context, tf: str, t: int, direction: int) -> pd.DataFrame:
    p = ctx.htf_pos(tf, t)
    return active_at(ctx.analyses[tf].fvgs, max(p, -1), direction)


def _setup(ctx: Context, d: int, ws: int, we: int, q1_high: float, q1_low: float, true_open: float, bias,
           t18: pd.Timestamp, w1: pd.Timestamp, cfg: AsianQ2Config) -> Signal | None:
    """d = -1: short after a raid of the Q1 high; d = 1: long after a raid of the Q1 low."""
    h, lo, c = (ctx.base[k].to_numpy(float) for k in ("high", "low", "close"))
    level = q1_high if d == -1 else q1_low
    beyond = (h[ws:we] > level) if d == -1 else (lo[ws:we] < level)
    if not beyond.any():
        return None
    t = ws + int(np.argmax(beyond))           # the raid bar; the order is placed when it has closed
    spec = ctx.spec
    # the higher-timeframe FVG that price trades into (a SIBI above the Q1 high for a short): the first
    # timeframe whose entry (15m: the near edge, 1H / 4H: the CE) is still ahead of price when the raid
    # bar closes, so the limit order rests there
    picked = None
    for tf in cfg.entry_timeframes:
        f = _htf_fvgs(ctx, tf, t, d)          # SIBI (bearish, -1) for a short, BISI (+1) for a long
        if not len(f):
            continue
        f = f[(f["bottom"] > q1_high) if d == -1 else (f["top"] < q1_low)]
        rows = sorted(f.itertuples(index=False), key=lambda r: (r.bottom if d == -1 else -r.top))
        for row in rows:                       # nearest first
            entry = float(row.bottom if d == -1 else row.top) if tf == "15m" else float(row.ce)
            if d * (entry - c[t]) < 0:         # ahead of price: above the close for a short
                picked = (tf, row, entry)
                break
        if picked:
            break
    if picked is None:
        return None
    tf, row, entry = picked
    # stop beyond the 4H FVG over the entry, else beyond the entered FVG + buffer
    stop = None
    f4 = _htf_fvgs(ctx, "4h", t, d)
    if len(f4):
        over = f4[(f4["bottom"] <= entry) & (f4["top"] >= entry)]
        if len(over):
            stop = float(over["top"].max() if d == -1 else over["bottom"].min()) - d * spec.stop_buffer
    if stop is None:
        stop = float(row.top if d == -1 else row.bottom) - d * spec.stop_buffer
    risk = d * (entry - stop)
    if risk <= 0:
        return None

    # targets: Q2 True Open, the other side of Q1, a 1H opposite OB / FVG beyond it
    tp = []
    if d * (true_open - entry) > 0:
        tp.append((true_open, "q2_true_open"))
    other = q1_low if d == -1 else q1_high
    if d * (other - entry) > 0:
        tp.append((other, "asia_q1_low" if d == -1 else "asia_q1_high"))
    third = _h1_array(ctx, t, d, other)
    if third is not None:
        tp.append((third, "1h_bullish_array" if d == -1 else "1h_bearish_array"))
    tp = sorted({round(p, 10): (p, n) for p, n in tp}.values(), key=lambda x: d * x[0])
    if not tp or d * (tp[-1][0] - entry) < cfg.min_rr * risk:
        return None
    if (d == 1 and h[t] >= tp[0][0]) or (d == -1 and lo[t] <= tp[0][0]):
        return None                            # chase rule: TP1 already traded
    fr = {1: [1.0], 2: [0.6, 0.4]}.get(len(tp), list(FRACTIONS))
    targets = list(zip([p for p, _ in tp], fr[:len(tp)]))
    targets[-1] = (targets[-1][0], round(1.0 - sum(f for _, f in targets[:-1]), 10))

    created = ctx.base.index[t]
    checklist = {"q1_raided": True, "htf_fvg_entry": True, "stop_beyond_4h_fvg": bool(len(f4)),
                 "true_open_target": any(n == "q2_true_open" for _, n in tp), "with_daily_bias": bias.direction == d}
    score = int(sum(checklist.values()))
    grade = "A+" if score == 5 else "A" if score >= 4 else "B"
    return Signal(
        model=MODEL, symbol=ctx.symbol, direction=d, created_time=created, entry=entry, stop=stop,
        targets=targets, expiry=w1, time_stop=None, exit_by=w1 + pd.Timedelta(minutes=cfg.exit_after_min),
        window=WINDOW, grade=grade, score=score, checklist=checklist,
        notes={"raid_level": "asia_q1_high" if d == -1 else "asia_q1_low", "raid_price": q1_high if d == -1 else q1_low,
               "raid_time": str(created), "entry_array": f"{tf} {'SIBI' if d == -1 else 'BISI'}",
               "fvg": (float(row.bottom), float(row.top)), "q1": (q1_low, q1_high), "true_open": true_open,
               "targets_from": [n for _, n in tp], "bias_score": bias.score, "draw": bias.draw,
               "cancel_if_close_beyond": float(row.top if d == -1 else row.bottom), "be_offset": spec.spread},
    )


def _h1_array(ctx: Context, t: int, d: int, beyond: float) -> float | None:
    """Nearest 1H array on the far side of ``beyond``: for a short a bullish OB's high or BISI's top
    below it; for a long a bearish OB's low or SIBI's bottom above it."""
    p = ctx.htf_pos("1h", t)
    if p < 0:
        return None
    cands = []
    f = active_at(ctx.analyses["1h"].fvgs, p, -d)     # BISI for a short, SIBI for a long
    for r in f.itertuples(index=False):
        price = float(r.top if d == -1 else r.bottom)
        if d * (price - beyond) > 0:
            cands.append(price)
    obs = blocks_at(ctx.analyses["1h"].order_blocks, p)
    obs = obs[(obs["role"] == "ob") & (obs["direction"] == -d)]
    for r in obs.itertuples(index=False):
        price = float(r.high if d == -1 else r.low)
        if d * (price - beyond) > 0:
            cands.append(price)
    if not cands:
        return None
    return min(cands, key=lambda x: abs(x - beyond))


def scan_m5(ctx: Context, **kw) -> list[Signal]:
    return scan(ctx, replace(AsianQ2Config(), **kw) if kw else AsianQ2Config())
