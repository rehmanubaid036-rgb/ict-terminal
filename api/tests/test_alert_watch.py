"""Server-side chart alerts: price / line / zone / session / ICT event checks and the watcher pass."""
import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

from ictapi.alert_watch import AUTOSAVE, AlertWatcher, live_alerts, price_hit, session_hit
from ictapi.main import create_app
from ictapi.market import FrameProvider
from ictengine.store import Store

NOW = pd.Timestamp("2026-10-07 14:00", tz="UTC")


def frame(closes, end=NOW):
    idx = pd.date_range(end=end - pd.Timedelta(minutes=1), periods=len(closes), freq="1min", tz="UTC")
    c = np.array(closes, dtype=float)
    return pd.DataFrame({"open": c, "high": c + 0.5, "low": c - 0.5, "close": c, "volume": 1.0}, index=idx)


def ms(t):
    return int(pd.Timestamp(t).timestamp() * 1000)


def alert(**kw):
    a = {"id": "a1", "ticker": "AXI:XAUUSD", "condition": "crossing", "price": 0, "note": "", "active": True,
         "created": ms(NOW - pd.Timedelta(minutes=30)), "kind": "price"}
    a.update(kw)
    return a


def test_price_conditions():
    bars = frame([100, 101, 102, 103, 104])
    assert price_hit(alert(price=102.2), bars, 99.0)[0] == "XAUUSD crossed 102.2"
    assert price_hit(alert(price=110), bars, 99.0) is None
    assert price_hit(alert(condition="above", price=104.4), bars, None)[0].startswith("XAUUSD is above")
    assert price_hit(alert(condition="below", price=99.6, note="buy zone"), bars, None)[0] == "XAUUSD is below 99.6 - buy zone"
    # crossing needs a price before: no previous close, the first bar only sets it
    assert price_hit(alert(price=100.2), bars.iloc[:1], None) is None


def test_line_and_box():
    bars = frame([100, 100, 100, 104, 104])
    t0 = ms(bars.index[0])
    flat = {"a": {"t": t0, "v": 102}, "b": {"t": t0 + 60_000, "v": 102}, "ray": True}
    assert "crossed the trend line (102)" in price_hit(alert(kind="line", line=flat), bars, 100.0)[0]
    seg = {**flat, "ray": False}
    assert price_hit(alert(kind="line", line=seg), bars, 100.0) is None          # the segment ended before the move
    box = alert(kind="box", condition="enter", box={"top": 103.8, "bottom": 103.0})
    assert price_hit(box, bars, 100.0)[0] == "XAUUSD entered the zone 103-103.8"
    assert price_hit(box, frame([103.4, 103.3, 103.5]), 103.5) is None          # stays inside: not an entry


def test_sessions_once_a_day():
    a = alert(kind="session", session="ny_open")
    at = pd.Timestamp("2026-10-07 09:31", tz="America/New_York").tz_convert("UTC")
    text, day = session_hit(a, at, None)
    assert text.startswith("New York open") and day == "2026-10-07"
    assert session_hit(a, at, "2026-10-07") is None
    assert session_hit(a, at + pd.Timedelta(minutes=10), None) is None            # only in the first 5 minutes


def test_plan_limits():
    alerts = [alert(id=str(i)) for i in range(5)] + [alert(id="x", kind="ict", ict={"event": "mss", "tf": "5m", "dir": 0})]
    assert len(live_alerts(alerts, {"alerts_limit": 3, "ict_indicators": True})) == 3
    assert [a["id"] for a in live_alerts(alerts, {"alerts_limit": 0})] == ["0", "1", "2", "3", "4"]   # no ICT on this plan


class Auth:
    def __init__(self):
        self.sent = []
        self.down = False

    def alert_users(self):
        return [{"email": "u@x.com", "features": {"alerts_limit": 0, "ict_indicators": True}, "channels": ["telegram"]}]

    def send_alert(self, email, key, text, payload=None):
        if self.down:
            return None
        self.sent.append((email, key, text))
        return ["telegram"]


def test_watcher_fires_once_and_terminal_sees_it(tmp_path):
    store = Store(tmp_path / "w.db")
    prov = FrameProvider({"AXI:XAUUSD": frame([100, 100, 101, 102, 103])})
    auth = Auth()
    w = AlertWatcher(prov, store, auth)
    store.save_layout("u@x.com", AUTOSAVE, {"alerts": [alert(price=101.6), alert(id="off", price=101.6, active=False)]})
    auth.down = True
    assert w.run_once(NOW, ict=False) == 0                                      # panel down: nothing lost, tried again
    auth.down = False
    assert w.run_once(NOW, ict=False) == 1
    assert auth.sent[0][2] == "XAUUSD crossed 101.6" and auth.sent[0][1].startswith("chart|a1|")
    assert w.run_once(NOW, ict=False) == 0                                      # once
    fired = store.alerts_fired("u@x.com", 0)
    assert [(f["alert_id"], f["sent"]) for f in fired] == [("a1", ["telegram"])]
    # restarted in the terminal (armedAt after the fire): watched again
    store.save_layout("u@x.com", AUTOSAVE, {"alerts": [alert(price=102.6, armedAt=ms(NOW) + 10**9)]})
    assert w.run_once(NOW, ict=False) == 0                                      # nothing since the restart yet

    c = TestClient(create_app(prov, store, require_auth=False))
    r = c.get("/api/v1/alerts/fired", params={"since": 0}).json()
    assert r["fired"] == []                                                     # another user (developer) sees nothing
    store.add_alert_fired("developer", "z", ms(NOW), "price", "t")
    assert c.get("/api/v1/alerts/fired", params={"since": 0}).json()["fired"][0]["alert_id"] == "z"


def test_ict_event_alerts(gold, tmp_path):
    store = Store(tmp_path / "i.db")
    now = gold.index[-1] + pd.Timedelta(minutes=1)
    auth = Auth()
    w = AlertWatcher(FrameProvider({"AXI:XAUUSD": gold}), store, auth)
    a = alert(kind="ict", ict={"event": "fvg", "tf": "1m", "dir": 0}, created=ms(now - pd.Timedelta(hours=3)))
    store.save_layout("u@x.com", AUTOSAVE, {"alerts": [a]})
    n = w.run_once(now, ict=True)
    if n:                                     # an FVG in the last 10 minutes of the sample
        assert "FVG" in auth.sent[0][2] and store.alert_states("u@x.com")["a1"]["seen"] > 0
        assert w.run_once(now, ict=True) == 0
    # far in the future nothing new is told and nothing old floods
    assert w.run_once(now + pd.Timedelta(days=2), ict=True) == 0
