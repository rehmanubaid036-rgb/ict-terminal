"""Candle validation and timeframe resampling.

Intraday timeframes up to 1h are bucketed in UTC (New York is a whole number of hours from
UTC, so the buckets match NY wall-clock buckets and DST never merges two hours).
4h, daily and weekly bars are anchored to the 18:00 New York trading-day open, like CME
futures charts: 4h bars open at 18, 22, 02, 06, 10, 14 NY time; weekly bars open Sunday 18:00.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .clock import NY, TRADING_DAY_START

PRICE_COLUMNS = ("open", "high", "low", "close")

TIMEFRAMES: dict[str, pd.Timedelta] = {
    "1m": pd.Timedelta(minutes=1), "3m": pd.Timedelta(minutes=3), "5m": pd.Timedelta(minutes=5),
    "15m": pd.Timedelta(minutes=15), "30m": pd.Timedelta(minutes=30), "1h": pd.Timedelta(hours=1),
    "2h": pd.Timedelta(hours=2), "4h": pd.Timedelta(hours=4), "1d": pd.Timedelta(days=1),
    "1w": pd.Timedelta(weeks=1),
}
_ANCHORED = {"2h", "4h", "1d", "1w"}
_DAY_SHIFT = pd.Timedelta(hours=TRADING_DAY_START.hour, minutes=TRADING_DAY_START.minute)


class CandleError(ValueError):
    """Raised when a candle frame is malformed."""


def validate(df: pd.DataFrame) -> pd.DataFrame:
    """Checks columns, index and OHLC consistency. Returns ``df`` unchanged if valid."""
    missing = [c for c in PRICE_COLUMNS if c not in df.columns]
    if missing:
        raise CandleError(f"missing columns: {missing}")
    idx = df.index
    if not isinstance(idx, pd.DatetimeIndex):
        raise CandleError("index must be a DatetimeIndex of bar open times")
    if idx.tz is None:
        raise CandleError("index must be timezone-aware (UTC)")
    if not idx.is_monotonic_increasing:
        raise CandleError("index must be sorted ascending")
    if idx.has_duplicates:
        raise CandleError("index has duplicate timestamps")
    prices = df[list(PRICE_COLUMNS)]
    if prices.isna().any().any():
        raise CandleError("prices contain NaN")
    o, h, lo, c = (prices[k].to_numpy() for k in PRICE_COLUMNS)
    bad = (h < np.maximum(o, c)) | (lo > np.minimum(o, c)) | (lo > h)
    if bad.any():
        first = idx[np.argmax(bad)]
        raise CandleError(f"high/low inconsistent with open/close at {first} ({int(bad.sum())} bars)")
    return df


def to_utc(df: pd.DataFrame, source_tz: str | None = None) -> pd.DataFrame:
    """Returns a copy indexed in UTC. Naive indexes need ``source_tz`` (e.g. a broker's
    server zone such as 'Etc/GMT-2'), so time is never guessed."""
    out = df.copy()
    if out.index.tz is None:
        if source_tz is None:
            raise CandleError("naive index: pass source_tz so the broker time zone is explicit")
        out.index = out.index.tz_localize(source_tz)
    out.index = out.index.tz_convert("UTC")
    return out


def resample(df: pd.DataFrame, timeframe: str) -> pd.DataFrame:
    """Aggregates candles to ``timeframe`` (see TIMEFRAMES). Bars are labelled by open time.

    The last bucket may be incomplete while it is still forming; ``n_bars`` tells how many
    source bars went into each output bar.
    """
    if timeframe not in TIMEFRAMES:
        raise CandleError(f"unknown timeframe {timeframe!r}; use one of {list(TIMEFRAMES)}")
    validate(df)
    if df.empty:
        return df.copy()
    labels = bucket_labels(df.index, timeframe)
    agg = {"open": "first", "high": "max", "low": "min", "close": "last"}
    if "volume" in df.columns:
        agg["volume"] = "sum"
    out = df.groupby(labels, sort=True).agg(agg)
    out["n_bars"] = df.groupby(labels, sort=True).size().to_numpy()
    out.index.name = None
    return out


def bucket_labels(index: pd.DatetimeIndex, timeframe: str) -> pd.DatetimeIndex:
    """Open time (UTC) of the ``timeframe`` bucket each timestamp belongs to."""
    step = TIMEFRAMES[timeframe]
    utc = index.tz_convert("UTC")
    if timeframe not in _ANCHORED:
        return utc.floor(step)
    # wall-clock NY time, shifted so the 18:00 trading-day open becomes midnight
    shifted = utc.tz_convert(NY).tz_localize(None) - _DAY_SHIFT
    if timeframe == "1w":
        floored = shifted.to_period("W-SAT").start_time  # weeks run Sunday..Saturday
    elif timeframe == "1d":
        floored = shifted.floor("D")
    else:
        floored = shifted.floor(step)
    local = (floored + _DAY_SHIFT).tz_localize(NY, nonexistent="shift_forward", ambiguous=False)
    return pd.DatetimeIndex(local.tz_convert("UTC"))
