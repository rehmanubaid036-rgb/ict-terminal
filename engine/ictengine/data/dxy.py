"""US Dollar Index (DXY) candles for models that read it (M18).

Brokers rarely offer the DXY itself, so it is rebuilt from its six currencies with ICE's published formula:
    DXY = 50.14348112 x EURUSD^-0.576 x USDJPY^0.136 x GBPUSD^-0.119 x USDCAD^0.091 x USDSEK^0.042 x USDCHF^0.036
from the 1-minute closes, then grouped into hourly candles (the model reads 1h / 1d / 1w only). A pair the feed
does not have is left out and the result rescaled, so the shape stays the same.
"""
from __future__ import annotations

from typing import Callable

import numpy as np
import pandas as pd

from ..core.candles import resample

WEIGHTS = {"EURUSD": -0.576, "USDJPY": 0.136, "GBPUSD": -0.119, "USDCAD": 0.091, "USDSEK": 0.042, "USDCHF": 0.036}
FACTOR = 50.14348112
NAMES = ("DXY", "USDX", "USDINDEX", "DX")

Loader = Callable[[str, pd.Timestamp, pd.Timestamp], pd.DataFrame]


def _try(load: Loader, symbol: str, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame | None:
    try:
        df = load(symbol, start, end)
    except Exception:  # noqa: BLE001 - this feed does not have it
        return None
    return df if df is not None and len(df) else None


def synthetic(load: Loader, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame | None:
    """Hourly DXY candles from the six pairs (None when EURUSD is missing: it is 58 % of the index)."""
    closes = {}
    for pair in WEIGHTS:
        df = _try(load, pair, start, end)
        if df is not None:
            closes[pair] = df["close"].resample("1min").last()
    if "EURUSD" not in closes:
        return None
    frame = pd.DataFrame(closes).ffill().dropna()
    if frame.empty:
        return None
    logv = sum(w * np.log(frame[p]) for p, w in WEIGHTS.items() if p in frame)
    used = sum(abs(w) for p, w in WEIGHTS.items() if p in frame)
    logv = logv * (sum(abs(w) for w in WEIGHTS.values()) / used)
    idx = pd.Series(FACTOR * np.exp(logv), index=frame.index)
    one = pd.DataFrame({"open": idx, "high": idx, "low": idx, "close": idx})
    return resample(one, "1h").drop(columns="n_bars")


def load_dxy(load: Loader, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame | None:
    """The broker's own index when it has one, else the rebuilt one."""
    for name in NAMES:
        df = _try(load, name, start, end)
        if df is not None:
            return df
    return synthetic(load, start, end)


def alpha_extras(load: Loader, start: pd.Timestamp, end: pd.Timestamp) -> dict[str, pd.DataFrame]:
    """What M18 reads besides gold: silver and the dollar index."""
    out = {}
    silver = _try(load, "XAGUSD", start, end)
    if silver is not None:
        out["XAGUSD"] = silver
    dxy = load_dxy(load, start, end)
    if dxy is not None:
        out["DXY"] = dxy
    return out
