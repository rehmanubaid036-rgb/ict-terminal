"""Footprint and order book: tick classification, the ladder per bar, the API routes."""
import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

from ictapi.main import create_app
from ictapi.market import FrameProvider, SyntheticProvider
from ictengine.orderflow import classify, footprint
from ictengine.store import Store

T0 = pd.Timestamp("2026-10-07 14:00:00", tz="UTC")


def ticks(prices, bids=None, asks=None, step_ms=250):
    idx = pd.DatetimeIndex([T0 + pd.Timedelta(milliseconds=step_ms * k) for k in range(len(prices))])
    d = {"price": np.array(prices, float), "volume": 1.0}
    if bids is not None:
        d["bid"] = np.array(bids, float)
        d["ask"] = np.array(asks, float)
    return pd.DataFrame(d, index=idx)


def test_classify_uses_bid_ask_then_the_tick_rule():
    t = ticks([10.0, 10.2, 10.0, 10.1], bids=[9.9, 10.0, 9.9, 10.0], asks=[10.1, 10.2, 10.1, 10.2])
    assert list(classify(t)) == [1, 1, -1, 1]       # at ask, at ask, at bid, inside the spread -> up-tick
    t2 = ticks([10, 11, 11, 10])
    assert list(classify(t2)) == [1, 1, 1, -1]      # no book: first = buy, up, unchanged (same), down


def test_footprint_ladder_poc_delta():
    t = ticks([10.00, 10.01, 10.01, 10.02, 10.00, 10.00, 9.99], bids=[9.99] * 7, asks=[10.02] * 7)
    bars = footprint(t, 1, 0.01)
    assert len(bars) == 2                           # 7 ticks x 0.25 s: two 1-second bars
    b = bars[0]
    prices = [lv[0] for lv in b["levels"]]
    assert prices == sorted(prices) and 10.01 in prices
    assert b["poc"] == 10.01 and b["buy"] + b["sell"] == 4
    assert bars[1]["delta"] == -3                   # 10.00, 10.00, 9.99 all at / below the bid
    assert footprint(t.iloc[:0], 1, 0.01) == []


class TickProvider(FrameProvider):
    def __init__(self, frames, t):
        super().__init__(frames)
        self.t = t

    def ticks(self, ticker, start, end):
        return self.t[(self.t.index >= start) & (self.t.index < end)] if ticker == "AXI:XAUUSD" else super().ticks(ticker, start, end)

    def book(self, ticker, depth=20):
        return {"bids": [[4000.1, 3.0], [4000.0, 5.0]], "asks": [[4000.3, 2.0], [4000.4, 4.0]], "depth": 2} if ticker == "AXI:XAUUSD" else super().book(ticker, depth)


def test_routes(tmp_path):
    rng = np.random.default_rng(1)
    t = ticks(4000 + np.cumsum(rng.normal(0, 0.1, 2000)), step_ms=100)
    idx = pd.date_range(T0, periods=10, freq="1min")
    frames = {"AXI:XAUUSD": pd.DataFrame({"open": 4000.0, "high": 4001.0, "low": 3999.0, "close": 4000.5, "volume": 1.0}, index=idx)}
    app = create_app(provider=SyntheticProvider(TickProvider(frames, t)), store=Store(tmp_path / "s.db"), require_auth=False)
    c = TestClient(app)
    r = c.get("/api/v1/footprint", params={"symbol": "AXI:XAUUSD", "resolution": "1", "from": int(T0.timestamp()), "to": int(T0.timestamp()) + 600})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["source"] == "ticks" and 0.01 <= j["tick"] <= 1 and len(j["bars"]) >= 3
    assert all(len(b["levels"]) > 0 for b in j["bars"])
    r = c.get("/api/v1/book", params={"symbol": "AXI:XAUUSD"})
    assert r.status_code == 200 and r.json()["asks"][0][0] == 4000.3
    r = c.get("/api/v1/book", params={"symbol": "AXI:NOPE"})
    assert r.status_code == 404
