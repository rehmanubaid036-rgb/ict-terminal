"""ICT screener row for one symbol, built by the engine runner from the context it already has.

What an ICT trader checks first, per symbol: the daily bias, where price sits in the dealing range
(premium / discount of the 20-day IPDA range), whether today's session already took the previous
day's high or low, the nearest active FVG on 15m and 1h, and the day's model setups.
"""
from __future__ import annotations

import numpy as np

from .bias import bias_at
from .context import Context
from .core import clock
from .indicators.fvg import active_at


def _nearest_fvg(ctx: Context, tf: str, t: int, price: float) -> dict | None:
    p = ctx.htf_pos(tf, t)
    if p < 0:
        return None
    f = active_at(ctx.analyses[tf].fvgs, p)
    if not len(f):
        return None
    f = f.assign(dist=(f["ce"] - price).abs()).sort_values("dist").iloc[0]
    return {"tf": tf, "dir": "BISI" if f["direction"] > 0 else "SIBI", "bottom": float(f["bottom"]), "top": float(f["top"]),
            "ce": float(f["ce"]), "inside": bool(f["bottom"] <= price <= f["top"]), "dist_pct": float(abs(f["ce"] - price) / price * 100)}


def screener_row(ctx: Context) -> dict:
    t = len(ctx.base) - 1
    now = ctx.base.index[t]
    price = ctx.price(t)
    b = bias_at(ctx, t)
    lv = ctx.day_levels(t)
    pdh = float(lv["pdh"]) if lv is not None and np.isfinite(lv["pdh"]) else None
    pdl = float(lv["pdl"]) if lv is not None and np.isfinite(lv["pdl"]) else None
    mo = float(lv["midnight_open"]) if lv is not None and np.isfinite(lv.get("midnight_open", np.nan)) else None
    # today's trading day (from 18:00 NY): did it take the previous day's high / low?
    day = ctx.trading_day[t]
    today = ctx.base[ctx.trading_day == day]
    swept_high = bool(pdh is not None and len(today) and today["high"].max() > pdh)
    swept_low = bool(pdl is not None and len(today) and today["low"].min() < pdl)
    windows = clock.active_windows(now, ("killzone", "silver_bullet", "macro"))
    zone = None
    if b.ipda_position is not None:
        zone = "discount" if b.ipda_position < 0.5 else "premium" if b.ipda_position > 0.5 else "equilibrium"
    return {
        "symbol": ctx.symbol, "time": now.isoformat(), "price": price,
        "change_pct": float((price - today["open"].iloc[0]) / today["open"].iloc[0] * 100) if len(today) else None,
        "bias": b.direction, "bias_score": b.score, "draw": b.draw, "draw_source": b.draw_source,
        "ipda_position": b.ipda_position, "zone": zone,
        "pdh": pdh, "pdl": pdl, "midnight_open": mo, "above_mo": bool(mo is not None and price > mo),
        "swept_pdh": swept_high, "swept_pdl": swept_low,
        "windows": [clock.get_window(k).label for k in windows],
        "fvg_15m": _nearest_fvg(ctx, "15m", t, price), "fvg_1h": _nearest_fvg(ctx, "1h", t, price),
    }
