"""Seconds charts: ticks -> 1s / 5s bars, the S resolutions, spread symbols on seconds."""
import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

from ictapi.main import create_app
from ictapi.market import FrameProvider, SyntheticProvider
from ictengine.data.mt5 import ticks_to_bars
from ictengine.store import Store

T0 = pd.Timestamp("2026-10-07 14:00:00", tz="UTC")


def tick_frame(prices, step_ms=400):
    idx = pd.DatetimeIndex([T0 + pd.Timedelta(milliseconds=step_ms * k) for k in range(len(prices))])
    return pd.DataFrame({"price": np.array(prices, float), "volume": 1.0}, index=idx)


def test_ticks_to_bars():
    t = tick_frame([10, 11, 9, 10.5, 12, 12.5, 11, 13])          # 0.4 s apart: 0-0.8 s, 1.2-1.6 s, 2.0-2.8 s
    b = ticks_to_bars(t, 1)
    assert list(b.index) == [T0, T0 + pd.Timedelta(seconds=1), T0 + pd.Timedelta(seconds=2)]
    assert list(b.iloc[0][["open", "high", "low", "close", "volume"]]) == [10, 11, 9, 9, 3]
    assert ticks_to_bars(t, 5).iloc[0]["high"] == 13
    assert ticks_to_bars(t.iloc[:0], 1).empty


class TickProvider(FrameProvider):
    def __init__(self, ticks):
        super().__init__({})
        self.t = ticks

    def seconds(self, ticker, sec, start, end):
        t = self.t.get(ticker)
        return ticks_to_bars(t[(t.index >= start) & (t.index < end)], sec) if t is not None else super().seconds(ticker, sec, start, end)


def test_seconds_history_and_spread(tmp_path):
    rng = np.random.default_rng(3)
    gold = tick_frame(4000 + np.cumsum(rng.normal(0, 0.2, 3000)), 200)
    silver = tick_frame(50 + np.cumsum(rng.normal(0, 0.01, 3000)), 200)
    p = SyntheticProvider(TickProvider({"AXI:XAUUSD": gold, "AXI:XAGUSD": silver}))
    c = TestClient(create_app(p, Store(tmp_path / "s.db"), require_auth=False))
    q = {"symbol": "AXI:XAUUSD", "from": int(T0.timestamp()), "to": int(T0.timestamp()) + 600}
    h1 = c.get("/udf/history", params={**q, "resolution": "1S"}).json()
    h5 = c.get("/udf/history", params={**q, "resolution": "5S"}).json()
    assert h1["s"] == "ok" and len(h1["t"]) == 600 and h1["t"][1] - h1["t"][0] == 1
    assert len(h5["t"]) == 120 and h5["h"][0] == max(h1["h"][:5])
    assert c.get("/udf/history", params={**q, "resolution": "75S"}).status_code == 400
    r = c.get("/udf/history", params={**q, "symbol": "AXI:XAUUSD/XAGUSD", "resolution": "15S"}).json()
    assert r["s"] == "ok" and len(r["t"]) == 40
    ov = c.get("/api/v1/ict/overlays", params={**q, "resolution": "5S", "indicators": "fvg,structure,sessions"})
    assert ov.status_code == 200
    assert "1S" in c.get("/udf/symbols", params={"symbol": "AXI:XAUUSD"}).json()["supported_resolutions"]
