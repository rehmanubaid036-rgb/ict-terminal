"""Chart feeds: MT5 brokers discovered automatically, Binance top 20, main ICT pairs first."""
import pandas as pd
from fastapi.testclient import TestClient

from ictapi import market
from ictapi.main import create_app
from ictapi.market import BinanceProvider, FrameProvider, MT5Provider, MultiProvider, SymbolInfo


def _disc(feed, names):
    kinds = {"XAUUSD": "commodity", "NAS100": "index", "EURUSD": "forex", "US500": "index"}
    return {"feed": feed, "offset": 7, "server": f"{feed}-Demo", "demo": True,
            "symbols": {n: {"broker": b, "kind": kinds.get(n, "forex"), "digits": 2, "description": n} for n, b in names.items()}}


def test_mt5_terminals_are_discovered_and_named_by_broker(monkeypatch):
    found = {r"C:\ICT Engine\mt5\terminal64.exe": _disc("FUSION", {"XAUUSD": "XAUUSD", "NAS100": "NAS100"}),
             r"C:\ICT Engine\mt5-pepper\terminal64.exe": _disc("PEPPERSTONE", {"XAUUSD": "XAUUSD.a", "EURUSD": "EURUSD"}),
             r"C:\ICT Engine\mt5-dead\terminal64.exe": None}
    registered = {}

    def discover(path):
        if found[path] is None:
            raise RuntimeError("IPC timeout")
        return found[path]
    monkeypatch.setattr(market.m5, "discover", discover)
    monkeypatch.setattr(market.m5, "register_broker", lambda key, path, off, syms: registered.update({key: syms}))
    p = MT5Provider(terminals=list(found))
    syms = p.symbols()
    assert set(syms) == {"FUSION:XAUUSD", "FUSION:NAS100", "PEPPERSTONE:XAUUSD", "PEPPERSTONE:EURUSD"}
    assert syms["PEPPERSTONE:XAUUSD"].source == "XAUUSD.a" and syms["FUSION:NAS100"].type == "index"
    assert registered["pepperstone"] == {"XAUUSD": "XAUUSD.a", "EURUSD": "EURUSD"}
    assert "IPC timeout" in p.errors[r"C:\ICT Engine\mt5-dead\terminal64.exe"]     # one dead terminal, others fine


def test_only_ict_folder_terminals(tmp_path, monkeypatch):
    (tmp_path / "mt5").mkdir()
    (tmp_path / "mt5" / "terminal64.exe").write_text("x")
    (tmp_path / "mt5-pepperstone").mkdir()
    (tmp_path / "mt5-pepperstone" / "terminal64.exe").write_text("x")
    (tmp_path / "other").mkdir()
    (tmp_path / "other" / "terminal64.exe").write_text("x")
    monkeypatch.delenv("ICT_MT5_TERMINALS", raising=False)
    monkeypatch.delenv("ICT_MT5_AXI_DEMO_TERMINAL", raising=False)
    monkeypatch.setattr(market.m5, "BROKERS", {})            # no development-PC demo path here
    found = market.ict_terminals(tmp_path)
    from pathlib import Path
    assert [Path(p).parent.name for p in found] == ["mt5", "mt5-pepperstone"]     # 'other' is never used


class FakeBinance:
    def __init__(self):
        self.calls = []

    def top_usdt(self, n):
        return [{"symbol": "BTCUSDT", "base": "BTC", "decimals": 2}, {"symbol": "ETHUSDT", "base": "ETH", "decimals": 2}]

    def klines(self, symbol, tf, start, end, max_bars=5000):
        self.calls.append((symbol, tf))
        idx = pd.date_range(start.floor("min"), end, freq={"1m": "1min", "4h": "4h"}[tf], tz="UTC", inclusive="left")
        return pd.DataFrame({"open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5, "volume": 1.0}, index=idx)


def test_binance_feed_native_timeframes_and_1m_cache():
    fb = FakeBinance()
    b = BinanceProvider(fb)
    assert set(b.symbols()) == {"BINANCE:BTCUSDT", "BINANCE:ETHUSDT"}
    end = pd.Timestamp.now(tz="UTC").floor("min")
    h4 = b.bars("BINANCE:BTCUSDT", "4h", end - pd.Timedelta(days=10), end)
    assert len(h4) > 0 and fb.calls[-1] == ("BTCUSDT", "4h")                    # one native request
    b.candles("BINANCE:BTCUSDT", end - pd.Timedelta(hours=2), end)
    n = len(fb.calls)
    b.candles("BINANCE:BTCUSDT", end - pd.Timedelta(hours=1), end)                # cached: at most the tail
    assert len(fb.calls) - n <= 1


def test_multi_provider_routes_and_main_pairs_come_first(gold, store):
    syms = {"FUSION:EURUSD": SymbolInfo("FUSION:EURUSD", "FUSION", "EURUSD", "Euro", "forex", 100000),
            "FUSION:XAUUSD": SymbolInfo("FUSION:XAUUSD", "FUSION", "XAUUSD", "Gold", "commodity", 100),
            "FUSION:AUDNZD": SymbolInfo("FUSION:AUDNZD", "FUSION", "AUDNZD", "Aussie Kiwi", "forex", 100000)}
    mt5 = FrameProvider({"FUSION:XAUUSD": gold}, syms)
    multi = MultiProvider([mt5, BinanceProvider(FakeBinance())])
    c = TestClient(create_app(multi, store, require_auth=False))
    cfg = c.get("/udf/config").json()
    assert cfg["default_symbol"] == "FUSION:XAUUSD"
    assert {e["value"] for e in cfg["exchanges"]} == {"FUSION", "BINANCE"}
    order = [r["symbol"] for r in c.get("/udf/search", params={"query": ""}).json()]
    assert order == ["FUSION:XAUUSD", "FUSION:EURUSD", "BINANCE:BTCUSDT", "BINANCE:ETHUSDT", "FUSION:AUDNZD"]
    assert c.get("/udf/symbols", params={"symbol": "BINANCE:ETHUSDT"}).json()["exchange"] == "BINANCE"
    r = c.get("/udf/history", params={"symbol": "FUSION:XAUUSD", "resolution": "5",
                                      "from": int(pd.Timestamp("2026-09-03 13:00", tz="UTC").timestamp()),
                                      "to": int(pd.Timestamp("2026-09-03 14:00", tz="UTC").timestamp())}).json()
    assert r["s"] == "ok" and len(r["t"]) == 12
