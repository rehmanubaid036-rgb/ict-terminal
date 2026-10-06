"""Builders for synthetic candle data used across the tests."""
from __future__ import annotations

import numpy as np
import pandas as pd


def bars(rows, start="2025-07-15 14:00", freq="1min", tz="UTC") -> pd.DataFrame:
    """DataFrame from (open, high, low, close) tuples starting at ``start`` (UTC by default)."""
    idx = pd.date_range(pd.Timestamp(start, tz=tz), periods=len(rows), freq=freq).tz_convert("UTC")
    df = pd.DataFrame(rows, columns=["open", "high", "low", "close"], index=idx, dtype=float)
    df["volume"] = 1.0
    return df


def path(prices, start="2025-07-15 14:00", freq="1min", wick=0.0) -> pd.DataFrame:
    """Candles that walk through ``prices``: each bar opens at the previous price and closes
    at the next one, with optional wick padding."""
    prices = np.asarray(prices, dtype=float)
    o, c = prices[:-1], prices[1:]
    h = np.maximum(o, c) + wick
    lo = np.minimum(o, c) - wick
    return bars(list(zip(o, h, lo, c)), start=start, freq=freq)


def random_walk(n=5000, start="2025-07-14 22:00", seed=7, step=0.6, base=2400.0) -> pd.DataFrame:
    """Deterministic gold-like 1m random walk, for property tests (no look-ahead etc.)."""
    rng = np.random.default_rng(seed)
    close = base + np.cumsum(rng.normal(0, step, n))
    open_ = np.concatenate([[base], close[:-1]])
    spread = np.abs(rng.normal(0, step * 0.8, (2, n)))
    high = np.maximum(open_, close) + spread[0]
    low = np.minimum(open_, close) - spread[1]
    idx = pd.date_range(pd.Timestamp(start, tz="UTC"), periods=n, freq="1min")
    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close, "volume": 1.0}, index=idx)
