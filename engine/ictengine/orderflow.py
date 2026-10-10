"""Order flow from ticks: footprint bars (volume per price level, split into buying and selling) and the
depth of market as the terminal shows them.

A tick is a buy (an aggressor lifting the offer) when its price is at or above the ask, a sell when at or
below the bid; with no bid / ask (or inside the spread) the direction of the price change decides, as in
the classic tick rule. CFD brokers send tick counts rather than true volume, so the numbers are a
proxy: the shape of the bar (where the activity sat, the imbalances, the delta) is what matters.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def classify(t: pd.DataFrame) -> np.ndarray:
    """+1 buy / -1 sell per tick."""
    price = t["price"].to_numpy(float)
    side = np.zeros(len(price), dtype=np.int8)
    if "ask" in t and "bid" in t:
        ask, bid = t["ask"].to_numpy(float), t["bid"].to_numpy(float)
        ok = (ask > 0) & (bid > 0) & (ask >= bid)
        side[ok & (price >= ask)] = 1
        side[ok & (price <= bid)] = -1
    # the tick rule for the rest: up-tick = buy, down-tick = sell, unchanged = like the previous tick
    chg = np.sign(np.diff(price, prepend=price[0] if len(price) else 0.0))
    last = 1
    for k in range(len(price)):
        if side[k] == 0:
            side[k] = chg[k] if chg[k] != 0 else last
        last = side[k] if side[k] != 0 else last
    return side


def footprint(t: pd.DataFrame, seconds: int, tick: float, max_levels: int = 400) -> list[dict]:
    """Bars of ``seconds`` with their price ladder: [{"t": epoch_s, "o","h","l","c", "levels": [[price, buy, sell], ...],
    "poc": price, "delta": buy - sell, "buy": total, "sell": total}] (prices rounded to ``tick``)."""
    if t.empty or tick <= 0:
        return []
    t = t.sort_index()
    side = classify(t)
    vol = t["volume"].to_numpy(float) if "volume" in t else np.ones(len(t))
    price = np.round(t["price"].to_numpy(float) / tick) * tick
    idx = t.index.as_unit("ns") if hasattr(t.index, "as_unit") else t.index     # pandas 2 keeps ms / us units
    bucket = (idx.asi8 // 1_000_000_000) // seconds * seconds
    out = []
    df = pd.DataFrame({"b": bucket, "p": price, "buy": np.where(side > 0, vol, 0.0), "sell": np.where(side < 0, vol, 0.0),
                       "raw": t["price"].to_numpy(float)})
    for b, g in df.groupby("b", sort=True):
        lv = g.groupby("p", sort=True)[["buy", "sell"]].sum()
        if len(lv) > max_levels:                      # a wild bar: keep the busiest levels
            lv = lv.loc[(lv["buy"] + lv["sell"]).nlargest(max_levels).index].sort_index()
        levels = [[round(float(p), 10), float(r.buy), float(r.sell)] for p, r in lv.iterrows()]
        tot = lv["buy"] + lv["sell"]
        poc = float(tot.idxmax()) if len(tot) else float("nan")
        raw = g["raw"].to_numpy(float)
        out.append({"t": int(b), "o": float(raw[0]), "h": float(raw.max()), "l": float(raw.min()), "c": float(raw[-1]),
                    "levels": levels, "poc": round(poc, 10), "buy": float(lv["buy"].sum()), "sell": float(lv["sell"].sum()),
                    "delta": float(lv["buy"].sum() - lv["sell"].sum())})
    return out


def auto_step(t: pd.DataFrame, seconds: int, mintick: float, rows: int = 18) -> float:
    """A ladder step that gives a typical bar about ``rows`` levels: the median bar range / rows, rounded
    to 1 / 2 / 5 x 10^k multiples of the symbol's tick (so gold on 1m gets 0.05-0.10, BTC gets 5-10)."""
    if t.empty or mintick <= 0:
        return mintick or 0.01
    idx = t.index.as_unit("ns") if hasattr(t.index, "as_unit") else t.index
    bucket = (idx.asi8 // 1_000_000_000) // seconds
    rng = t["price"].groupby(bucket).agg(lambda x: x.max() - x.min())
    med = float(rng.median()) if len(rng) else 0.0
    want = med / rows if med > 0 else mintick
    k = max(1.0, want / mintick)
    exp = 10 ** np.floor(np.log10(k))
    nice = min((m for m in (1, 2, 5, 10) if m * exp >= k), default=10) * exp
    return float(round(nice * mintick, 10))


def book_from_tick(bid: float, ask: float, bid_vol: float = 0.0, ask_vol: float = 0.0) -> dict:
    """A one-level book (brokers without depth): what the terminal shows when nothing better exists."""
    return {"bids": [[bid, bid_vol]] if bid > 0 else [], "asks": [[ask, ask_vol]] if ask > 0 else [], "depth": 1}
