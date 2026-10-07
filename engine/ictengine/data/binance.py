"""Free live crypto candles from Binance's public market-data API (no key, no account).

``data-api.binance.vision`` serves only public market data and is reachable where the main
api.binance.com is blocked; api.binance.com is the fallback. Candles come in the interval the
chart asks for (1m … 1w), so a 4h chart needs one request, not 240 one-minute pages.
"""
from __future__ import annotations

import threading
import time

import pandas as pd
import requests

BASES = ("https://data-api.binance.vision", "https://api.binance.com")
INTERVALS = {"1s": "1s", "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "2h": "2h",
             "4h": "4h", "1d": "1d", "1w": "1w"}
STEP = {"1s": 1, "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "2h": 7200, "4h": 14400,
        "1d": 86400, "1w": 604800}
# never in the "top 20": stablecoins and pegged / leveraged tokens trade flat or against USD itself
EXCLUDE_BASES = {"USDC", "FDUSD", "TUSD", "BUSD", "DAI", "USDP", "EUR", "AEUR", "USDE", "PAXG", "WBTC", "WBETH",
                 "BFUSD", "XUSD", "USD1", "EURI", "RLUSD", "PYUSD", "USDS", "USDD", "FRAX", "LUSD"}


class BinanceError(RuntimeError):
    pass


class Binance:
    def __init__(self, session: requests.Session | None = None, timeout: float = 10.0):
        self.http = session or requests.Session()
        self.timeout = timeout
        self._lock = threading.Lock()
        self._top: tuple[float, list[dict]] = (0.0, [])
        self._ticks: dict[str, int] = {}          # symbol -> price decimals

    def _get(self, path: str, params: dict | None = None):
        last = None
        for base in BASES:
            try:
                r = self.http.get(base + path, params=params, timeout=self.timeout,
                                  headers={"User-Agent": "ICT-Terminal/1.0"})
                if r.status_code == 200:
                    return r.json()
                last = f"HTTP {r.status_code} from {base}"
            except requests.RequestException as e:
                last = f"{type(e).__name__} from {base}"
        raise BinanceError(f"Binance market data not reachable ({last})")

    def top_usdt(self, n: int = 20, max_age: float = 3600) -> list[dict]:
        """The ``n`` USDT pairs with the most 24h quote volume: [{symbol, base, decimals}], hourly."""
        with self._lock:
            if self._top[1] and time.time() - self._top[0] < max_age:
                return self._top[1][:n]
            rows = self._get("/api/v3/ticker/24hr")
            pairs = []
            for r in rows:
                s = r.get("symbol", "")
                base = s[:-4]
                if not s.endswith("USDT") or base in EXCLUDE_BASES or base.endswith(("UP", "DOWN", "BULL", "BEAR")):
                    continue
                if float(r.get("quoteVolume", 0) or 0) <= 0:
                    continue
                pairs.append((float(r["quoteVolume"]), s, base, r.get("lastPrice", "0")))
            pairs.sort(reverse=True)
            top = [{"symbol": s, "base": b, "decimals": _decimals(last)} for _, s, b, last in pairs[:max(n, 20)]]
            self._top = (time.time(), top)
            return top[:n]

    def klines(self, symbol: str, tf: str, start: pd.Timestamp, end: pd.Timestamp, max_bars: int = 5000) -> pd.DataFrame:
        """Candles [start, end) in the chart's own interval (newest ``max_bars`` if the range is longer)."""
        if tf not in INTERVALS:
            raise BinanceError(f"unsupported interval {tf}")
        step = STEP[tf]
        start_s = max(int(start.timestamp()), int(end.timestamp()) - step * max_bars)
        end_ms = int(end.timestamp()) * 1000 - 1
        out, cursor = [], start_s * 1000
        while cursor <= end_ms:
            rows = self._get("/api/v3/klines", {"symbol": symbol, "interval": INTERVALS[tf], "startTime": cursor,
                                                "endTime": end_ms, "limit": 1000})
            if not rows:
                break
            out += rows
            cursor = int(rows[-1][0]) + step * 1000
            if len(rows) < 1000:
                break
        return frame(out)


def frame(rows: list) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame({k: pd.Series(dtype=float) for k in ("open", "high", "low", "close", "volume")},
                            index=pd.DatetimeIndex([], tz="UTC"))
    idx = pd.to_datetime([int(r[0]) for r in rows], unit="ms", utc=True)
    df = pd.DataFrame({"open": [float(r[1]) for r in rows], "high": [float(r[2]) for r in rows],
                       "low": [float(r[3]) for r in rows], "close": [float(r[4]) for r in rows],
                       "volume": [float(r[5]) for r in rows]}, index=idx)
    return df[~df.index.duplicated(keep="last")].sort_index()


def _decimals(price: str) -> int:
    """Price decimals from Binance's own string ('0.00012340' -> 8 minus trailing zeros, at least 2)."""
    if "." not in price:
        return 2
    frac = price.split(".")[1].rstrip("0")
    return max(2, min(8, len(frac)))
