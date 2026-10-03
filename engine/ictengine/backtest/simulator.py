"""Bar-by-bar trade simulation on 1m candles (rulebook 5: partials, breakeven, expiry, time stop).

Conservative assumptions, so a backtest never looks better than live trading:
  * the order is placed after the signal bar closes; it can fill from the next bar on
  * a limit fills when price trades through it; a gap through it fills at the bar's open
  * on the fill bar only the stop is checked (we cannot know if a target came first)
  * if stop and target are both inside one bar, the stop is assumed to hit first
  * ``spread`` is paid on entry (long buys the ask, short sells the bid)
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from ..signals import Signal


@dataclass
class Trade:
    signal: Signal
    status: str                      # 'expired' | 'win' | 'loss' | 'breakeven'
    fill_time: pd.Timestamp | None = None
    fill_price: float | None = None
    exit_time: pd.Timestamp | None = None
    r: float = 0.0                   # result in multiples of initial risk
    exits: list[tuple[pd.Timestamp, float, float, str]] = field(default_factory=list)  # (time, price, fraction, why)


def simulate(sig: Signal, df: pd.DataFrame, spread: float = 0.0, be_offset: float = 0.0) -> Trade:
    idx = df.index
    o, h, lo, c = (df[k].to_numpy(float) for k in ("open", "high", "low", "close"))
    d = sig.direction
    start = int(idx.searchsorted(sig.created_time, side="right"))  # first bar opening after the signal bar
    exp_end = int(idx.searchsorted(sig.expiry, side="left"))       # bars opening before expiry may fill

    notes = sig.notes or {}
    cancel_at = notes.get("cancel_if_close_beyond")   # rulebook: a body close beyond the FVG before the fill
    if not be_offset:
        be_offset = float(notes.get("be_offset", 0.0) or 0.0)
    fill = None
    for i in range(start, min(exp_end, len(df))):
        if cancel_at is not None and ((d == 1 and c[i - 1] < cancel_at) or (d == -1 and c[i - 1] > cancel_at)) and i > start:
            break                                      # the previous bar closed through the FVG: order cancelled
        if d == 1 and lo[i] <= sig.entry:
            fill = (i, min(o[i], sig.entry))
            break
        if d == -1 and h[i] >= sig.entry:
            fill = (i, max(o[i], sig.entry))
            break
    if fill is None:
        return Trade(sig, "expired")

    f, px = fill
    px += d * spread
    risk = abs(sig.entry - sig.stop)
    stop = sig.stop
    remaining = 1.0
    targets = list(sig.targets)
    exits: list[tuple] = []
    tp1_hit = False
    ts_pos = len(df) if sig.time_stop is None else int(idx.searchsorted(sig.time_stop, side="left"))
    xb_pos = len(df) if sig.exit_by is None else int(idx.searchsorted(sig.exit_by, side="left"))

    def close_all(i, price, why):
        nonlocal remaining
        exits.append((idx[i], price, remaining, why))
        remaining = 0.0

    # stop on the fill bar itself
    if (d == 1 and lo[f] <= stop) or (d == -1 and h[f] >= stop):
        close_all(f, stop, "stop")
    i = f + 1
    while remaining > 1e-12 and i < len(df):
        if (not tp1_hit and i >= ts_pos) or i >= xb_pos:
            close_all(i, o[i], "time_stop" if not tp1_hit else "exit_by")
            break
        if (d == 1 and lo[i] <= stop) or (d == -1 and h[i] >= stop):
            close_all(i, stop if (d == 1 and o[i] > stop) or (d == -1 and o[i] < stop) else o[i],
                      "breakeven" if tp1_hit else "stop")
            break
        while targets and ((d == 1 and h[i] >= targets[0][0]) or (d == -1 and lo[i] <= targets[0][0])):
            price, frac = targets.pop(0)
            frac = min(frac, remaining)
            exits.append((idx[i], price, frac, "target"))
            remaining -= frac
            if not tp1_hit:
                tp1_hit = True
                stop = sig.entry + d * be_offset
        i += 1
    if remaining > 1e-12:  # data ended
        close_all(len(df) - 1, c[-1], "end_of_data")

    r = sum(frac * d * (price - px) for _, price, frac, _ in exits) / risk
    status = "win" if r > 1e-9 else "loss" if r < -1e-9 else "breakeven"
    return Trade(sig, status, idx[f], px, exits[-1][0], float(r), exits)


def run(signals: list[Signal], df: pd.DataFrame, spread: float = 0.0, one_at_a_time: bool = True) -> list[Trade]:
    """Simulates signals in time order. With ``one_at_a_time`` a signal that arrives while a
    trade on the same symbol is still open is skipped (as the EA would)."""
    trades = []
    busy_until = None
    for s in sorted(signals, key=lambda s: s.created_time):
        if one_at_a_time and busy_until is not None and s.created_time < busy_until:
            continue
        t = simulate(s, df, spread=spread)
        trades.append(t)
        if t.exit_time is not None:
            busy_until = t.exit_time
    return trades


def stats(trades: list[Trade]) -> dict:
    filled = [t for t in trades if t.status != "expired"]
    r = np.array([t.r for t in filled])
    if len(r) == 0:
        return {"signals": len(trades), "filled": 0}
    equity = np.cumsum(r)
    dd = float(np.max(np.maximum.accumulate(np.r_[0, equity])[1:] - equity)) if len(r) else 0.0
    wins, losses = r[r > 1e-9], r[r < -1e-9]
    return {
        "signals": len(trades), "filled": len(filled), "fill_rate": len(filled) / len(trades),
        "wins": int(len(wins)), "losses": int(len(losses)), "breakeven": int(len(r) - len(wins) - len(losses)),
        "win_rate": len(wins) / len(r), "avg_r": float(r.mean()), "total_r": float(r.sum()),
        "best_r": float(r.max()), "worst_r": float(r.min()),
        "profit_factor": float(wins.sum() / -losses.sum()) if len(losses) else float("inf"),
        "max_drawdown_r": dd,
    }


def trades_frame(trades: list[Trade]) -> pd.DataFrame:
    return pd.DataFrame([{
        "model": t.signal.model, "window": t.signal.window, "direction": t.signal.direction,
        "created": t.signal.created_time, "entry": t.signal.entry, "stop": t.signal.stop,
        "status": t.status, "fill_time": t.fill_time, "exit_time": t.exit_time, "r": t.r,
        "grade": t.signal.grade, "score": t.signal.score,
    } for t in trades])
