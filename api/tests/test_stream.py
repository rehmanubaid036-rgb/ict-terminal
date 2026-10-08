"""Live bars over /ws/stream: hello, subscribe, the newest bars; a bad token is closed."""
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from ictapi.main import create_app
from ictapi.market import FrameProvider
from ictengine.store import Store


def frame():
    end = pd.Timestamp.now(tz="UTC").floor("min")
    idx = pd.date_range(end - pd.Timedelta(minutes=30), end, freq="1min")
    return pd.DataFrame({"open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5, "volume": 3.0}, index=idx)


def test_stream_sends_bars(tmp_path):
    c = TestClient(create_app(FrameProvider({"AXI:XAUUSD": frame()}), Store(tmp_path / "w.db"), require_auth=False))
    with c.websocket_connect("/ws/stream") as ws:
        ws.send_json({"auth": "", "device": "d"})
        ws.send_json({"sub": [{"symbol": "AXI:XAUUSD", "resolution": "1"}, {"symbol": "AXI:NOPE", "resolution": "1"}]})
        m = ws.receive_json()
        assert m["symbol"] == "AXI:XAUUSD" and m["resolution"] == "1" and len(m["bars"]) == 2 and m["bars"][-1][4] == 1.5
        ws.send_json({"sub": [{"symbol": "AXI:XAUUSD", "resolution": "5"}]})
        assert ws.receive_json()["resolution"] == "5"


class Guest:
    def verify(self, *a, **k):
        return {"status": "guest"}


def test_stream_needs_login(tmp_path):
    c = TestClient(create_app(FrameProvider({"AXI:XAUUSD": frame()}), Store(tmp_path / "x.db"), auth=Guest(), require_auth=True))
    with pytest.raises(WebSocketDisconnect):
        with c.websocket_connect("/ws/stream") as ws:
            ws.send_json({"auth": "bad"})
            ws.receive_json()
