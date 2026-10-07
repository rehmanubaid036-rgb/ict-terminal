"""Spread / ratio symbols: FEED:A/B, FEED:A-B built bar by bar from two symbols of one feed."""
import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

from ictapi.main import create_app
from ictapi.market import FrameProvider, SyntheticProvider, split_synthetic
from ictengine.store import Store


def frame(start, closes):
    idx = pd.date_range(start, periods=len(closes), freq="1min", tz="UTC")
    c = np.array(closes, dtype=float)
    return pd.DataFrame({"open": c, "high": c + 1, "low": c - 1, "close": c, "volume": 5.0}, index=idx)


def test_split():
    assert split_synthetic("AXI:XAUUSD/XAGUSD") == ("AXI", "XAUUSD", "/", "XAGUSD")
    assert split_synthetic("axi:nas100-us500") == ("AXI", "NAS100", "-", "US500")
    assert split_synthetic("AXI:XAUUSD") is None
    assert split_synthetic("XAUUSD/XAGUSD") is None          # the feed is needed


def test_ratio_and_spread_bars(tmp_path):
    gold = frame("2026-10-06 10:00", [4000, 4010, 4020, 4030])
    silver = frame("2026-10-06 10:01", [50, 50, 40])             # starts a minute later: only shared minutes count
    p = SyntheticProvider(FrameProvider({"AXI:XAUUSD": gold, "AXI:XAGUSD": silver}))
    assert "AXI:XAUUSD/XAGUSD" in p.symbols() and p.symbols().get("AXI:XAUUSD/XAUUSD") is None
    assert p.symbols().get("AXI:XAUUSD/NOPE") is None
    s, e = pd.Timestamp("2026-10-06", tz="UTC"), pd.Timestamp("2026-10-07", tz="UTC")
    r = p.candles("AXI:XAUUSD/XAGUSD", s, e)
    assert list(r["close"]) == [4010 / 50, 4020 / 50, 4030 / 40]
    assert r["high"].iloc[0] == 4011 / 49 and r["low"].iloc[0] == 4009 / 51
    d = p.candles("AXI:XAUUSD-XAGUSD", s, e)
    assert list(d["close"]) == [3960, 3970, 3990]
    assert len(p.bars("AXI:XAUUSD/XAGUSD", "5m", s, e)) == 1

    c = TestClient(create_app(p, Store(tmp_path / "s.db"), require_auth=False))
    info = c.get("/udf/symbols", params={"symbol": "AXI:XAUUSD/XAGUSD"}).json()
    assert (info["ticker"], info["type"], info["pricescale"]) == ("AXI:XAUUSD/XAGUSD", "spread", 10000)
    h = c.get("/udf/history", params={"symbol": "AXI:XAUUSD/XAGUSD", "resolution": "1", "from": int(s.timestamp()), "to": int(e.timestamp())}).json()
    assert h["s"] == "ok" and h["c"][-1] == round(4030 / 40, 8)
    found = c.get("/udf/search", params={"query": "XAUUSD/XAGUSD"}).json()
    assert found[0]["symbol"] == "AXI:XAUUSD/XAGUSD"
    q = c.get("/api/v1/quotes", params={"symbols": "AXI:XAUUSD/XAGUSD"}).json()["quotes"]
    assert q[0]["price"] == 4030 / 40


def test_symbol_info(gold, tmp_path):
    c = TestClient(create_app(SyntheticProvider(FrameProvider({"AXI:XAUUSD": gold})), Store(tmp_path / "i.db"), require_auth=False))
    r = c.get("/api/v1/symbol-info", params={"symbol": "AXI:XAUUSD"}).json()
    assert (r["symbol"], r["type"], r["smt_partner"], r["tick"]) == ("XAUUSD", "commodity", "XAGUSD", 0.01)
    s = r["stats"]
    assert s["day"]["high"] >= s["day"]["low"] and s["atr14"] > 0 and s["week"]["high"] >= s["last"] >= s["week"]["low"]
    assert c.get("/api/v1/symbol-info", params={"symbol": "AXI:NOPE"}).status_code == 404
