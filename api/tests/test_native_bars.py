"""Chart intervals from MT5's own timeframes: minutes / hour as they are, 2h / 4h / day / week from H1 on the
New York 18:00 trading day; /udf/history reads at most MAX_HISTORY_DAYS per request."""
import numpy as np
import pandas as pd

from ictapi import market
from ictapi.market import MT5Provider, SymbolInfo

NY = "America/New_York"


def _h1(start: str, hours: int) -> pd.DataFrame:
    idx = pd.date_range(pd.Timestamp(start, tz=NY).tz_convert("UTC"), periods=hours, freq="1h")
    v = np.arange(hours, dtype=float)
    return pd.DataFrame({"open": v, "high": v + 1, "low": v - 1, "close": v + 0.5, "volume": 1.0}, index=idx)


def _provider(monkeypatch, frames):
    asked = []

    def load(broker, symbol, start, end, timeframe="M1"):
        asked.append(timeframe)
        return frames[timeframe]
    monkeypatch.setattr(market.m5, "load", load)
    p = MT5Provider(terminals=[])
    p._symbols = {"AXI:XAUUSD": SymbolInfo("AXI:XAUUSD", "AXI", "XAUUSD", "Gold", "commodity", 100, "24x7", "XAUUSD")}
    p._broker_key = {"AXI": "axi"}
    p._at = 1e18
    return p, asked


def test_day_and_4h_from_h1_on_new_york_time(monkeypatch):
    h1 = _h1("2026-10-05 00:00", 24 * 4)                     # Mon 00:00 NY .. Thu 23:00 NY
    p, asked = _provider(monkeypatch, {"H1": h1})
    start, end = pd.Timestamp("2026-10-05", tz="UTC"), pd.Timestamp("2026-10-09", tz="UTC")
    d = p.bars("AXI:XAUUSD", "1d", start, end)
    assert asked == ["H1"]
    assert all(t.tz_convert(NY).hour == 18 for t in d.index)  # each day opens 18:00 New York
    first = d.index[1]                                        # Mon 18:00 .. Tue 17:59
    day = h1[(h1.index >= first) & (h1.index < first + pd.Timedelta(days=1))]
    assert d.loc[first, "high"] == day["high"].max() and d.loc[first, "open"] == day["open"].iloc[0]
    four = p.bars("AXI:XAUUSD", "4h", start, end)
    assert sorted({t.tz_convert(NY).hour for t in four.index}) == [2, 6, 10, 14, 18, 22]
    one = p.bars("AXI:XAUUSD", "1h", start, end)
    assert len(one) == len(h1[(h1.index >= start) & (h1.index < end)])


def test_minutes_read_natively(monkeypatch):
    m15 = _h1("2026-10-05 00:00", 10).set_axis(pd.date_range(pd.Timestamp("2026-10-05", tz="UTC"), periods=10, freq="15min"))
    p, asked = _provider(monkeypatch, {"M15": m15})
    out = p.bars("AXI:XAUUSD", "15m", pd.Timestamp("2026-10-05", tz="UTC"), pd.Timestamp("2026-10-06", tz="UTC"))
    assert asked == ["M15"] and len(out) == 10


def test_history_request_is_capped(tmp_path, gold):
    from fastapi.testclient import TestClient
    from ictapi.main import MAX_HISTORY_DAYS, create_app
    from ictapi.market import FrameProvider
    from ictengine.store import Store
    seen = []

    class Spy(FrameProvider):
        def bars(self, ticker, tf, start, end):
            seen.append((tf, end - start))
            return super().bars(ticker, tf, start, end)
    c = TestClient(create_app(Spy({"AXI:XAUUSD": gold}), Store(tmp_path / "h.db"), require_auth=False))
    end = int(gold.index[-1].timestamp())
    c.get("/udf/history", params={"symbol": "AXI:XAUUSD", "resolution": "1", "from": end - 400 * 86400, "to": end})
    assert seen[-1] == ("1m", pd.Timedelta(days=MAX_HISTORY_DAYS["1m"]))
