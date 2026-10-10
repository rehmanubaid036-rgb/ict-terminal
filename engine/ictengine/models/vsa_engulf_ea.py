"""M19 — VSA Engulf Hybrid EA (Gold), ported from ``engulf hybird ea 18 december 6pm ver.mq5``.

A custom (non-ICT) model, listed under the terminal's Custom Models > VSA Models: volume-spread-analysis entries the EA takes on XAUUSD. It runs on the
5m and 15m frames by default (1m is available but loses to the spread in backtests). Every
input keeps the EA's name and default so results can be compared with the MT5 tester.

Setups, evaluated on the close of bar1 (bar2 = the bar before it):
  Engulf          bar2 bearish, bar1 bullish closing above bar2's high (mirror for sells),
                  close above SMA200, bar1 volume >= the 16-bar average, EMA50 aligned on
                  M1/M5/M15 (price above, slope >= 2 points) and a swing low on M15 in the
                  last 40 bars.                                   -> "BullEngulfLowVol" / "BearEngulfLowVol"
  Imbalance shift bar2 bearish on >= 1.5x average volume, bar1 bullish on < 2x average volume,
                  close above SMA200 (mirror for sells).          -> "ImbalanceShiftBuy" / "ImbalanceShiftSell"
Stop: bar1 low/high -/+ SL_BufferPips. The EA takes profit at 5R but in practice almost every
trade is closed by its breakeven (at 240 pips) and 240-pip trailing stop, so the signal carries
a two-step ladder — half at 1R (after which the simulator moves the stop to breakeven) and half
at 5R — which is the closest the Signal contract gets to that management. The EA's own
parameters travel in ``notes`` for the bridge EA.

Not ported: the USD-strength filter (needs seven forex pairs the engine does not load) and the
news filter (empty in the EA as well).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from ..bias import bias_at
from ..context import Context
from ..signals import LONG, SHORT, Signal

MODEL = "M19"
COMMENTS = {LONG: ("BullEngulfLowVol", "ImbalanceShiftBuy"), SHORT: ("BearEngulfLowVol", "ImbalanceShiftSell")}


@dataclass(frozen=True)
class EAConfig:
    symbols: tuple[str, ...] = ("XAUUSD",)
    timeframes: tuple[str, ...] = ("5m", "15m")
    require_bias: bool = True
    # EA inputs (same names and defaults as the .mq5)
    SL_BufferPips: float = 240
    TP_Ratio: float = 5.0
    VolumeLookback: int = 16
    HighVolMultiplier: float = 1.5
    MassiveVolMultiplier: float = 2.0
    UltraVolMultiplier: float = 2.0
    UseAvgVol: bool = True
    UseHighVol: bool = True
    UseMassiveVol: bool = True
    EnableTrendFilter: bool = True           # close vs SMA200 of the signal timeframe
    EnableEngulf: bool = True
    EnableImbalanceShift: bool = True
    ImbalanceUseTrendFilter: bool = True
    ImbalanceAllowMassiveOnSecond: bool = True
    EnableTrendAlignmentMultiTF: bool = True
    TrendTFs: tuple[str, ...] = ("1m", "5m", "15m")
    TrendMAPeriod: int = 50
    TrendSlopePoints: float = 2.0
    EnableSwingCheck: bool = True
    SwingTF: str = "15m"
    SwingLRBars: int = 2
    MaxBarsSinceSwing: int = 40
    TrailingStopPips: float = 240
    BreakevenPips: float = 240
    BreakevenOffsetPips: float = 50
    expiry_bars: int = 3                     # a market entry the EA takes at once; we allow 3 bars


def pip(ctx: Context) -> float:
    """MT5 pip: the point, x10 on 3/5-digit symbols (the EA's PipPointMultiplier auto mode)."""
    tick = ctx.spec.tick_size
    digits = max(0, round(-np.log10(tick)))
    return tick * (10.0 if digits in (3, 5) else 1.0)


def _vol_class(v: np.ndarray, avg: np.ndarray, cfg: EAConfig) -> np.ndarray:
    with np.errstate(invalid="ignore"):
        return np.select([v >= avg * cfg.UltraVolMultiplier, v >= avg * cfg.MassiveVolMultiplier,
                          v >= avg * cfg.HighVolMultiplier, v >= avg], [4, 3, 2, 1], 0)


def _ema(frame: pd.DataFrame, n: int) -> np.ndarray:
    return frame["close"].ewm(span=n, adjust=False).mean().to_numpy(float)


def _swing_known(frame: pd.DataFrame, lr: int, max_since: int, low: bool) -> np.ndarray:
    """For every bar p of ``frame``: a pivot low/high (lr bars each side) was confirmed within
    the last ``max_since`` bars, using closed bars only (EA HasRecentSwingPivot)."""
    x = frame["low" if low else "high"].to_numpy(float)
    piv = np.ones(len(x), dtype=bool)
    for k in range(1, lr + 1):
        left, right = np.roll(x, k), np.roll(x, -k)       # x[i-k], x[i+k]
        piv &= (x < left) & (x <= right) if low else (x > left) & (x >= right)
    piv[:lr] = False
    piv[len(x) - lr:] = False
    confirmed = np.r_[np.zeros(lr, dtype=bool), piv[:len(piv) - lr]]   # pivot i known at bar i+lr
    return pd.Series(confirmed.astype(int)).rolling(max_since + 1, min_periods=1).max().to_numpy() > 0


def _scan_frame(ctx: Context, tf: str, cfg: EAConfig, pip_size: float) -> list[Signal]:
    frame = ctx.frames[tf]
    if "volume" not in frame.columns or len(frame) < max(cfg.VolumeLookback, 200) + 3:
        return []
    o, h, l, c = (frame[k].to_numpy(float) for k in ("open", "high", "low", "close"))
    v = frame["volume"].to_numpy(float)
    n = len(frame)
    up, down = c > o, c < o
    avg = pd.Series(v).rolling(cfg.VolumeLookback, min_periods=cfg.VolumeLookback).mean().to_numpy()
    vc1 = _vol_class(v, avg, cfg)
    vc2 = _vol_class(np.r_[np.nan, v[:-1]], avg, cfg)        # EA VolClass(2) uses the same average
    sma = pd.Series(c).rolling(200, min_periods=200).mean().to_numpy()
    trend_buy = (c > sma) if cfg.EnableTrendFilter else np.ones(n, dtype=bool)
    trend_sell = (c < sma) if cfg.EnableTrendFilter else np.ones(n, dtype=bool)
    with np.errstate(invalid="ignore"):
        vol_pass = ((cfg.UseAvgVol & (v >= avg)) | (cfg.UseHighVol & (v >= avg * cfg.HighVolMultiplier))
                    | (cfg.UseMassiveVol & (v >= avg * cfg.MassiveVolMultiplier)))
    up2, down2 = np.r_[False, up[:-1]], np.r_[False, down[:-1]]
    h2, l2 = np.r_[np.nan, h[:-1]], np.r_[np.nan, l[:-1]]
    second_ok = (vc1 <= 3) if cfg.ImbalanceAllowMassiveOnSecond else (vc1 <= 1)

    eng_buy = down2 & up & (c > h2) & trend_buy & vol_pass
    eng_sell = up2 & down & (c < l2) & trend_sell & vol_pass
    imb_buy = down2 & (vc2 >= 2) & up & second_ok & (trend_buy if cfg.ImbalanceUseTrendFilter else True)
    imb_sell = up2 & (vc2 >= 2) & down & second_ok & (trend_sell if cfg.ImbalanceUseTrendFilter else True)
    if not cfg.EnableEngulf:
        eng_buy = eng_sell = np.zeros(n, dtype=bool)
    if not cfg.EnableImbalanceShift:
        imb_buy = imb_sell = np.zeros(n, dtype=bool)
    cand = np.flatnonzero(eng_buy | eng_sell | imb_buy | imb_sell)
    if len(cand) == 0:
        return []

    # as-of helpers for the extra engulf filters (EMA alignment on M1/M5/M15, swing on M15)
    emas = {f: _ema(ctx.frames[f], cfg.TrendMAPeriod) for f in cfg.TrendTFs if f in ctx.frames}
    alpha = 2.0 / (cfg.TrendMAPeriod + 1)
    slope_min = cfg.TrendSlopePoints * ctx.spec.tick_size
    swing_lo = swing_hi = None
    if cfg.EnableSwingCheck and cfg.SwingTF in ctx.frames:
        sf = ctx.frames[cfg.SwingTF]
        swing_lo = _swing_known(sf, cfg.SwingLRBars, cfg.MaxBarsSinceSwing, True)
        swing_hi = _swing_known(sf, cfg.SwingLRBars, cfg.MaxBarsSinceSwing, False)

    def aligned(t: int, direction: int) -> bool:
        if not cfg.EnableTrendAlignmentMultiTF:
            return True
        price = float(ctx.base["close"].iloc[t])
        for f, ema in emas.items():
            p = ctx.htf_pos(f, t)
            if p < cfg.TrendMAPeriod:
                return False
            prev = ema[p]                                  # EMA of the last closed bar of f
            cur = alpha * price + (1 - alpha) * prev       # the forming bar's EMA at this price
            slope = cur - prev
            ok = (price > cur and slope >= slope_min) if direction == LONG else (price < cur and -slope >= slope_min)
            if not ok:
                return False
        return True

    def swing_ok(t: int, direction: int) -> bool:
        if swing_lo is None:
            return True
        p = ctx.htf_pos(cfg.SwingTF, t)
        return p >= 0 and bool((swing_lo if direction == LONG else swing_hi)[p])

    buf = cfg.SL_BufferPips * pip_size
    step = pd.Timedelta(ctx.frames[tf].index.freq) if ctx.frames[tf].index.freq is not None else None
    out: list[Signal] = []
    for p in cand:
        t = ctx.known_from(tf, int(p)) - 1                 # last base bar of this bar
        if t >= len(ctx.base) or t < 0:
            continue                                       # the bar has not closed yet
        for direction, eng, imb in ((LONG, eng_buy[p], imb_buy[p]), (SHORT, eng_sell[p], imb_sell[p])):
            if not (eng or imb):
                continue
            if eng and not (aligned(t, direction) and swing_ok(t, direction)):
                eng = False
            if not (eng or imb):
                continue
            if cfg.require_bias:
                b = bias_at(ctx, t)
                if b.direction == 0 or b.direction != direction:
                    continue
            entry = float(c[p])
            stop = float(l[p]) - buf if direction == LONG else float(h[p]) + buf
            risk = abs(entry - stop)
            if risk <= 0:
                continue
            created = ctx.base.index[t]
            bar_len = step if step is not None else (frame.index[p + 1] - frame.index[p] if p + 1 < n else pd.Timedelta(minutes=1))
            parts = [COMMENTS[direction][0]] * bool(eng) + [COMMENTS[direction][1]] * bool(imb)
            out.append(Signal(
                model=f"{MODEL}_{parts[0]}", symbol=ctx.symbol, direction=direction, created_time=created,
                entry=entry, stop=stop,
                targets=[(entry + direction * risk, 0.5), (entry + direction * risk * cfg.TP_Ratio, 0.5)],
                expiry=created + cfg.expiry_bars * bar_len, window=tf,
                grade="A+" if len(parts) == 2 else "A" if eng else "B", score=len(parts),
                checklist={"engulf": bool(eng), "imbalance_shift": bool(imb), "mtf_ema_aligned": bool(eng),
                           "swing_recent": bool(eng)},
                notes={"setups": parts, "timeframe": tf, "ea": {
                    "SL_BufferPips": cfg.SL_BufferPips, "TP_Ratio": cfg.TP_Ratio,
                    "TrailingStopPips": cfg.TrailingStopPips, "BreakevenPips": cfg.BreakevenPips,
                    "BreakevenOffsetPips": cfg.BreakevenOffsetPips}}))
    return out


def scan(ctx: Context, cfg: EAConfig | None = None, **kw) -> list[Signal]:
    """All EA entries on the context's symbol, oldest first. ``kw`` overrides EAConfig fields."""
    from dataclasses import replace
    cfg = replace(cfg or EAConfig(), **kw) if kw else (cfg or EAConfig())
    if ctx.symbol not in cfg.symbols or "volume" not in ctx.base.columns:
        return []
    size = pip(ctx)
    out: list[Signal] = []
    for tf in cfg.timeframes:
        if tf in ctx.frames:
            out.extend(_scan_frame(ctx, tf, cfg, size))
    return sorted(out, key=lambda s: (s.created_time, s.window, s.direction))


def scan_m19(ctx: Context, **kw) -> list[Signal]:
    """The engine passes every model the same options (require_bias, manual_bias ...); options this
    model does not have are ignored."""
    from dataclasses import replace
    own = {k: v for k, v in kw.items() if k in EAConfig.__dataclass_fields__}
    return scan(ctx, cfg=replace(EAConfig(), **own) if own else EAConfig())
