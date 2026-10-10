"""Manual trading through the EA: the terminal queues a command, the EA takes it on its poll and reports."""
import pandas as pd
from fastapi.testclient import TestClient

from ictapi import main as m
from ictapi.main import create_app
from ictapi.market import FrameProvider
from ictengine.store import Store

from test_ea import FakeEA


def _app(tmp_path, gold, monkeypatch):
    monkeypatch.setitem(m.FULL_ACCESS["features"], "auto_trade", True)
    store = Store(tmp_path / "t.db")
    fake = FakeEA({"tok": {"valid": True, "reason": "", "access": {"email": "developer"},
                           "copy": {"active": False, "reason": "off", "models": []}}})
    client = TestClient(create_app(FrameProvider({"AXI:XAUUSD": gold}), store, auth=fake, require_auth=False))
    return client, store


def _checkin(client, version="1.13", mode="demo"):
    return client.post("/api/v1/ea/feed", json={"ea_token": "tok", "mt5_login": "555", "balance": 1000, "equity": 1000, "currency": "USD",
                                                "ea_version": version, "trade_mode": mode, "positions": [], "orders": []})


def test_order_goes_to_the_ea_and_comes_back(tmp_path, gold, monkeypatch):
    client, store = _app(tmp_path, gold, monkeypatch)
    # no EA yet
    r = client.post("/api/v1/mt5/trade", json={"kind": "order", "symbol": "XAUUSD", "side": 1, "type": "market", "volume": 0.1})
    assert r.status_code == 400
    assert _checkin(client).status_code == 200
    r = client.post("/api/v1/mt5/trade", json={"kind": "order", "symbol": "AXI:XAUUSD", "side": 1, "type": "market", "volume": 0.1, "sl": 3990, "tp": 4020})
    assert r.status_code == 200, r.text
    cmd = r.json()["command"]
    assert cmd["status"] == "pending" and cmd["payload"]["symbol"] == "XAUUSD" and cmd["payload"]["sl"] == 3990
    # the EA's next poll carries it, once
    feed = _checkin(client).json()
    assert [c["id"] for c in feed["commands"]] == [cmd["id"]] and feed["commands"][0]["kind"] == "order" and feed["commands"][0]["volume"] == 0.1
    assert _checkin(client).json()["commands"] == []
    assert store.ea_command("developer", cmd["id"])["status"] == "sent"
    # the EA reports the fill
    r = client.post("/api/v1/ea/report", json={"ea_token": "tok", "mt5_login": "555",
                                               "events": [{"command_id": cmd["id"], "event": "done", "ticket": 777, "price": 4001.2, "volume": 0.1, "detail": "buy 0.10 XAUUSD.pro"}]})
    assert r.status_code == 200
    done = client.get("/api/v1/mt5/commands").json()["commands"][0]
    assert done["status"] == "done" and done["result"]["ticket"] == 777


def test_validation_real_account_and_expiry(tmp_path, gold, monkeypatch):
    client, store = _app(tmp_path, gold, monkeypatch)
    _checkin(client, version="1.12")
    r = client.post("/api/v1/mt5/trade", json={"kind": "order", "symbol": "XAUUSD", "side": 1, "type": "market", "volume": 0.1})
    assert r.status_code == 400 and "1.13" in r.json()["detail"]
    _checkin(client, mode="real")
    r = client.post("/api/v1/mt5/trade", json={"kind": "order", "symbol": "XAUUSD", "side": -1, "type": "limit", "volume": 0.2})
    assert r.status_code == 400                      # a limit order needs a price
    r = client.post("/api/v1/mt5/trade", json={"kind": "order", "symbol": "XAUUSD", "side": -1, "type": "limit", "volume": 0.2, "price": 4100})
    assert r.status_code == 428                      # real: confirm first
    r = client.post("/api/v1/mt5/trade", json={"kind": "order", "symbol": "XAUUSD", "side": -1, "type": "limit", "volume": 0.2, "price": 4100, "confirm_real": True})
    assert r.status_code == 200
    cid = r.json()["command"]["id"]
    assert client.post(f"/api/v1/mt5/commands/{cid}/cancel").json()["cancelled"] is True
    assert _checkin(client, mode="real").json()["commands"] == []
    # a command nobody picks up expires
    r = client.post("/api/v1/mt5/trade", json={"kind": "close", "ticket": "777", "confirm_real": True})
    cid = r.json()["command"]["id"]
    with store._conn() as c:
        c.execute("UPDATE ea_commands SET expires_at = ? WHERE id = ?", ((pd.Timestamp.now(tz="UTC") - pd.Timedelta(seconds=1)).isoformat(), cid))
    assert client.get("/api/v1/mt5/commands").json()["commands"][0]["status"] == "expired"
    assert _checkin(client, mode="real").json()["commands"] == []
