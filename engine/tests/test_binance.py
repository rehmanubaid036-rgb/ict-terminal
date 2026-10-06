"""Binance public data client (HTTP faked)."""
import pandas as pd
import pytest
import requests

from ictengine.data.binance import Binance, BinanceError


class FakeResp:
    def __init__(self, status, data):
        self.status_code, self._data = status, data

    def json(self):
        return self._data


class FakeSession:
    def __init__(self, routes, fail_first_base=False):
        self.routes, self.calls, self.fail_first_base = routes, [], fail_first_base

    def get(self, url, params=None, timeout=None, headers=None):
        self.calls.append((url, dict(params or {})))
        if self.fail_first_base and "binance.vision" in url:
            raise requests.ConnectionError("blocked")
        for path, fn in self.routes.items():
            if url.endswith(path):
                return FakeResp(200, fn(params or {}))
        return FakeResp(404, {})


TICKERS = [
    {"symbol": "BTCUSDT", "quoteVolume": "900", "lastPrice": "65000.10000000"},
    {"symbol": "ETHUSDT", "quoteVolume": "800", "lastPrice": "3200.50000000"},
    {"symbol": "USDCUSDT", "quoteVolume": "999", "lastPrice": "1.00010000"},     # stablecoin: excluded
    {"symbol": "BTCUPUSDT", "quoteVolume": "700", "lastPrice": "1.0"},          # leveraged token: excluded
    {"symbol": "PEPEUSDT", "quoteVolume": "600", "lastPrice": "0.00001234"},
    {"symbol": "ETHBTC", "quoteVolume": "5000", "lastPrice": "0.05"},           # not a USDT pair
    {"symbol": "DEADUSDT", "quoteVolume": "0", "lastPrice": "1"},
]


def test_top_usdt_pairs_by_volume():
    b = Binance(FakeSession({"/api/v3/ticker/24hr": lambda p: TICKERS}))
    top = b.top_usdt(20)
    assert [t["symbol"] for t in top] == ["BTCUSDT", "ETHUSDT", "PEPEUSDT"]
    assert top[0]["base"] == "BTC" and top[0]["decimals"] == 2 and top[2]["decimals"] == 8


def test_klines_page_through_and_convert():
    start = pd.Timestamp("2026-10-01 00:00", tz="UTC")

    def kl(p):
        t0 = p["startTime"]
        n = min(1000, (p["endTime"] - t0) // 60000 + 1)
        return [[t0 + i * 60000, "1", "2", "0.5", "1.5", "10", 0] for i in range(n)]

    s = FakeSession({"/api/v3/klines": kl})
    df = Binance(s).klines("BTCUSDT", "1m", start, start + pd.Timedelta(minutes=2500))
    assert len(df) == 2500 and df.index[0] == start and df.index.is_monotonic_increasing
    assert len(s.calls) == 3 and s.calls[0][1]["interval"] == "1m"
    assert list(df.columns) == ["open", "high", "low", "close", "volume"] and df["close"].iloc[0] == 1.5


def test_native_interval_and_bar_cap():
    end = pd.Timestamp("2026-10-01 00:00", tz="UTC")
    s = FakeSession({"/api/v3/klines": lambda p: []})
    Binance(s).klines("ETHUSDT", "4h", end - pd.Timedelta(days=3650), end, max_bars=600)
    p = s.calls[0][1]
    assert p["interval"] == "4h" and p["startTime"] == int((end - pd.Timedelta(hours=4 * 600)).timestamp()) * 1000


def test_falls_back_to_main_api_and_reports_outage():
    s = FakeSession({"/api/v3/ticker/24hr": lambda p: TICKERS}, fail_first_base=True)
    assert Binance(s).top_usdt(2)[0]["symbol"] == "BTCUSDT"
    assert "api.binance.com" in s.calls[-1][0]
    dead = Binance(FakeSession({}))
    with pytest.raises(BinanceError):
        dead.top_usdt()
