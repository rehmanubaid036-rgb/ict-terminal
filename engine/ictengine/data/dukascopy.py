"""Historical 1-minute candles from Dukascopy's public datafeed (for backtests).

One LZMA-compressed ``.bi5`` file per UTC day:
  https://datafeed.dukascopy.com/datafeed/{SYMBOL}/{YYYY}/{MM-1:02}/{DD:02}/BID_candles_min_1.bi5
Each record is 24 bytes big-endian: int32 seconds from midnight UTC, int32 open, close,
low, high (price x divisor) and float32 volume. Closed-market minutes come as flat bars
with zero volume and are dropped.

Raw files are cached under ``cache_dir`` so a day is downloaded only once.
"""
from __future__ import annotations

import lzma
import struct
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

URL = "https://datafeed.dukascopy.com/datafeed/{sym}/{y}/{m:02d}/{d:02d}/{side}_candles_min_1.bi5"

# price divisor per instrument; "verified" ones were checked against real prices
INSTRUMENTS: dict[str, dict] = {
    "XAUUSD": {"divisor": 1000, "verified": True},
    "XAGUSD": {"divisor": 1000, "verified": False},
    "EURUSD": {"divisor": 100000, "verified": False},
    "GBPUSD": {"divisor": 100000, "verified": False},
    "USATECHIDXUSD": {"divisor": 1000, "verified": False},   # NAS100
    "USA500IDXUSD": {"divisor": 1000, "verified": False},    # US500
    "BTCUSD": {"divisor": 10, "verified": False},
}
DEFAULT_CACHE = Path(__file__).resolve().parents[3] / "data" / "dukascopy"
_RECORD = struct.Struct(">5if")


class DownloadError(RuntimeError):
    pass


def parse_bi5(raw: bytes, day: date, divisor: float) -> pd.DataFrame:
    """Decodes one day file into a candle frame (UTC index, zero-volume flat bars removed)."""
    if not raw:
        return _empty()
    data = lzma.decompress(raw)
    if len(data) % _RECORD.size:
        raise DownloadError(f"corrupt candle file for {day}: {len(data)} bytes")
    arr = np.frombuffer(data, dtype=np.dtype([("t", ">i4"), ("o", ">i4"), ("c", ">i4"), ("l", ">i4"),
                                               ("h", ">i4"), ("v", ">f4")]))
    base = pd.Timestamp(day, tz="UTC")
    idx = base + pd.to_timedelta(arr["t"].astype(np.int64), unit="s")
    df = pd.DataFrame({"open": arr["o"] / divisor, "high": arr["h"] / divisor, "low": arr["l"] / divisor,
                       "close": arr["c"] / divisor, "volume": arr["v"].astype(float)}, index=idx)
    flat = (df["volume"] <= 0) & (df["high"] == df["low"])
    return df[~flat]


def fetch_day(symbol: str, day: date, side: str = "BID", cache_dir: Path = DEFAULT_CACHE,
              retries: int = 6, pause: float = 1.0, offline: bool = False) -> pd.DataFrame:
    """One UTC day of candles. ``offline=True`` reads only the cache (missing day -> empty)."""
    if symbol not in INSTRUMENTS:
        raise KeyError(f"unknown Dukascopy instrument {symbol!r}; known: {sorted(INSTRUMENTS)}")
    if day >= datetime.now(timezone.utc).date():
        raise ValueError("only complete past UTC days can be downloaded")
    path = Path(cache_dir) / symbol / f"{day:%Y}" / f"{day:%m}" / f"{day:%d}_{side}.bi5"
    if path.exists():
        raw = path.read_bytes()
    elif offline:
        return _empty()
    else:
        raw = _download(URL.format(sym=symbol, y=day.year, m=day.month - 1, d=day.day, side=side), retries, pause)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
        time.sleep(pause)  # be polite to the free datafeed
    return parse_bi5(raw, day, INSTRUMENTS[symbol]["divisor"])


def load(symbol: str, start: date, end: date, **kw) -> pd.DataFrame:
    """1m candles for UTC days ``start``..``end`` inclusive (weekends simply come back empty)."""
    frames = []
    d = start
    while d <= end:
        frames.append(fetch_day(symbol, d, **kw))
        d += timedelta(days=1)
    frames = [f for f in frames if len(f)]
    if not frames:
        return _empty()
    out = pd.concat(frames)
    return out[~out.index.duplicated(keep="first")].sort_index()


def _download(url: str, retries: int, pause: float) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (ICT Project backtest)"})
    delay = pause
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return b""  # no data that day
            if e.code not in (429, 500, 502, 503, 504) or attempt == retries - 1:
                raise DownloadError(f"{url}: HTTP {e.code}") from e
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == retries - 1:
                raise DownloadError(f"{url}: {e}") from e
        time.sleep(delay)
        delay = min(delay * 2, 60)
    raise DownloadError(url)


def _empty() -> pd.DataFrame:
    return pd.DataFrame({k: pd.Series(dtype=float) for k in ("open", "high", "low", "close", "volume")},
                        index=pd.DatetimeIndex([], tz="UTC"))
