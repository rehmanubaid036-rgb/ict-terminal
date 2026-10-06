"""ICT Bridge EA endpoints: check-in, live signal feed, execution reports."""
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from ictapi.auth_client import AuthClient
from ictapi.main import create_app
from ictapi.market import FrameProvider
from ictengine.signals import LONG, SHORT, Signal
from ictengine.store import Store


class FakeEA(AuthClient):
    def __init__(self, answers):
        super().__init__(panel_url="http://panel.test", secret="s")
        self.answers = answers
        self.calls = []

    def ea_checkin(self, ea_token, info, client_ip=""):
        self.calls.append((ea_token, info))
        return self.answers.get(ea_token, {"valid": False, "reason": "Invalid EA token.", "copy": None})


ACTIVE = {"valid": True, "reason": "", "access": {"email": "pro@x.com"},
          "copy": {"active": True, "reason": "", "models": ["M9", "M1:BIAS"]}}
NOT_APPROVED = {"valid": False, "reason": "No model is approved for auto-trading yet.", "access": {"email": "p@x.com"},
                "copy": {"active": False, "reason": "No model is approved for auto-trading yet.", "models": []}}


def sig(model, minutes_ago, direction=LONG, expiry_in=30):
    now = pd.Timestamp.now(tz="UTC").floor("s")
    t = now - pd.Timedelta(minutes=minutes_ago)
    e, s = (100.0, 99.0) if direction == LONG else (100.0, 101.0)
    tgt = 103.0 if direction == LONG else 97.0
    return Signal(model, "XAUUSD", direction, t, e, s, [(tgt, 1.0)], now + pd.Timedelta(minutes=expiry_in))


@pytest.fixture()
def ea(tmp_path, gold):
    store = Store(tmp_path / "ea.db")
    fake = FakeEA({"good": ACTIVE, "waiting": NOT_APPROVED})
    client = TestClient(create_app(FrameProvider({"AXI:XAUUSD": gold}), store, auth=fake, require_auth=True))
    return client, store, fake


def test_bad_token_is_401(ea):
    client, _, _ = ea
    r = client.post("/api/v1/ea/feed", json={"ea_token": "nope"})
    assert r.status_code == 401 and r.json()["signals"] == []


def test_connected_but_not_approved(ea):
    client, store, fake = ea
    store.upsert_signals("XAUUSD", "M9", [sig("M9_market_maker", 5)], False)
    r = client.post("/api/v1/ea/feed", json={"ea_token": "waiting", "mt5_login": "123", "balance": 1000}).json()
    assert r["active"] is False and "approved" in r["reason"] and r["signals"] == []
    assert fake.calls[-1][1]["mt5_login"] == "123"


def test_feed_returns_only_live_approved_signals(ea):
    client, store, _ = ea
    store.upsert_signals("XAUUSD", "M9", [sig("M9_market_maker", 5), sig("M9_market_maker", 90)], False)  # 2nd too old
    store.upsert_signals("XAUUSD", "M9", [sig("M9_market_maker", 6, SHORT)], True)        # bias variant not approved
    store.upsert_signals("XAUUSD", "M1", [sig("M1_silver_bullet", 3)], True)              # M1:BIAS approved
    store.upsert_signals("XAUUSD", "M1", [sig("M1_silver_bullet", 4, SHORT)], False)      # M1 without bias: no
    store.upsert_signals("XAUUSD", "M2", [sig("M2_mentorship_2022", 2)], False)           # not approved
    store.upsert_signals("XAUUSD", "M9", [sig("M9_market_maker", 10, expiry_in=-1)], False)  # expired
    r = client.post("/api/v1/ea/feed", json={"ea_token": "good"}).json()
    assert r["active"] and r["models"] == ["M9", "M1"]
    got = [(s["model_id"], s["direction"]) for s in r["signals"]]
    assert sorted(got) == [("M1", 1), ("M9", 1)]
    s = r["signals"][0]
    assert {"id", "symbol", "entry", "stop", "targets", "expiry", "time_stop", "exit_by"} <= set(s)
    assert isinstance(s["id"], int) and s["symbol"] == "XAUUSD"


def test_reports_are_stored(ea):
    client, store, _ = ea
    events = [{"signal_id": 7, "event": "filled", "price": 100.1, "volume": 0.2, "at": "2026-10-01T10:00:00Z"},
              {"signal_id": 7, "event": "tp", "price": 103.0, "profit": 60.0, "at": "2026-10-01T11:00:00Z"}]
    r = client.post("/api/v1/ea/report", json={"ea_token": "good", "mt5_login": "123", "events": events})
    assert r.json() == {"stored": 2}
    rows = store.ea_events("pro@x.com")
    assert [x["event"] for x in rows] == ["tp", "filled"] and rows[0]["mt_login"] == "123"
    assert client.post("/api/v1/ea/report", json={"ea_token": "nope", "events": events}).status_code == 401
