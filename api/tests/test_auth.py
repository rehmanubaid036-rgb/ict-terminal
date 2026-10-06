"""Plan-based access: the API asks the admin panel (faked here) who the caller is."""
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from conftest import ts
from ictapi.auth_client import GUEST, AuthClient
from ictapi.main import create_app
from ictapi.market import FrameProvider
from ictengine.signals import LONG, Signal

FREE = {"user": "free@x.com", "status": "active", "is_vip": False,
        "features": {"signals": True, "signal_delay_minutes": 30, "models": ["M1"], "ict_indicators": False,
                     "max_charts": 1}}
PRO = {"user": "pro@x.com", "status": "active", "is_vip": True,
       "features": {"signals": True, "signal_delay_minutes": 0, "models": "all", "ict_indicators": True,
                    "max_charts": 4}}
NO_PLAN = {"user": "x@x.com", "status": "no_plan", "is_vip": False,
           "features": {"signals": False, "models": [], "ict_indicators": False}}


class FakeAuth(AuthClient):
    def __init__(self):
        super().__init__(panel_url="http://panel.test", secret="s")
        self.users = {"free": FREE, "pro": PRO, "noplan": NO_PLAN}
        self.forwarded, self.queries = [], []
        self.forgotten = []

    def verify(self, token="", *a, **k):
        return dict(self.users.get(token, GUEST))

    def forward(self, method, path, json_body=None, headers=None, client_ip="", query=None):
        self.forwarded.append((method, path, json_body, (headers or {}).get("authorization")))
        self.queries.append(query)
        return 200, {"success": True, "path": path, "access": PRO if path == "auth/me" else None}

    def forget(self, token=""):
        self.forgotten.append(token)


@pytest.fixture()
def fake():
    return FakeAuth()


@pytest.fixture()
def api(gold, store, fake):
    return TestClient(create_app(FrameProvider({"AXI:XAUUSD": gold}), store, auth=fake, require_auth=True))


def H(token):
    return {"Authorization": f"Bearer {token}"}


HIST = {"symbol": "AXI:XAUUSD", "resolution": "5", "from": ts("2026-09-03 13:00"), "to": ts("2026-09-03 15:00")}


def test_guest_gets_401_on_data(api):
    assert api.get("/udf/history", params=HIST).status_code == 401
    assert api.get("/udf/history", params=HIST, headers=H("unknown-token")).status_code == 401
    assert api.get("/api/v1/health").status_code == 200       # public
    assert api.get("/udf/config").status_code == 200          # public


def test_logged_in_without_plan_can_chart_but_not_signals(api):
    assert api.get("/udf/history", params=HIST, headers=H("noplan")).json()["s"] == "ok"
    r = api.get("/api/v1/signals", params={"symbol": "AXI:XAUUSD", "from": 0, "to": 10}, headers=H("noplan"))
    assert r.status_code == 403 and "signals" in r.json()["detail"]


def test_free_plan_has_no_ict_indicators(api):
    p = {**HIST, "indicators": "fvg"}
    assert api.get("/api/v1/ict/overlays", params=p, headers=H("free")).status_code == 403
    assert api.get("/api/v1/ict/overlays", params=p, headers=H("pro")).status_code == 200


def test_models_list_marks_allowed(api):
    free = {m["id"]: m["allowed"] for m in api.get("/api/v1/models", headers=H("free")).json()}
    pro = {m["id"]: m["allowed"] for m in api.get("/api/v1/models", headers=H("pro")).json()}
    assert free["M1"] and not free["M2"]
    assert all(pro.values())


def test_signals_respect_plan_models_and_delay(api, store):
    now = pd.Timestamp.now(tz="UTC").floor("min")
    recent = Signal("M1_silver_bullet", "XAUUSD", LONG, now - pd.Timedelta(minutes=10), 100, 99, [(102, 1.0)],
                    now + pd.Timedelta(minutes=20))
    older = Signal("M1_silver_bullet", "XAUUSD", LONG, now - pd.Timedelta(hours=2), 100, 99, [(102, 1.0)],
                   now - pd.Timedelta(hours=1))
    m2 = Signal("M2_mentorship_2022", "XAUUSD", LONG, now - pd.Timedelta(hours=3), 100, 99, [(102, 1.0)],
                now - pd.Timedelta(hours=2))
    store.upsert_signals("XAUUSD", "M1", [recent, older], True)
    store.upsert_signals("XAUUSD", "M2", [m2], True)
    q = {"symbol": "AXI:XAUUSD", "from": int((now - pd.Timedelta(days=1)).timestamp()), "to": int(now.timestamp()) + 60}
    free = api.get("/api/v1/signals", params=q, headers=H("free")).json()
    assert free["delay_minutes"] == 30
    assert [s["created_time"] for s in free["signals"]] == [older.created_time.isoformat()]  # recent hidden, M2 not allowed
    pro = api.get("/api/v1/signals", params=q, headers=H("pro")).json()
    assert len(pro["signals"]) == 3 and pro["delay_minutes"] == 0


def test_account_calls_are_forwarded(api, fake):
    r = api.post("/api/v1/auth/login", json={"email": "a@b.c", "password": "x"})
    assert r.status_code == 200 and r.json()["path"] == "auth/login"
    assert api.get("/api/v1/plans").json()["path"] == "plans"
    assert fake.forwarded[0][:3] == ("POST", "auth/login", {"email": "a@b.c", "password": "x"})
    api.post("/api/v1/auth/logout", headers=H("pro"))
    assert fake.forgotten == ["pro"]
    assert api.get("/api/v1/not-a-route").status_code == 404
    assert api.delete("/api/v1/plans").status_code == 405


def test_community_calls_are_forwarded_with_their_query(api, fake):
    assert api.get("/api/v1/community/messages", params={"room": "ict", "after_id": 5}).json()["path"] == "community/messages"
    assert fake.queries[-1] == {"room": "ict", "after_id": "5"}
    assert api.get("/api/v1/community/ideas/12").json()["path"] == "community/ideas/12"
    for p in ("community/ideas", "community/ideas/12/like", "community/ideas/12/comment", "community/messages/3/report"):
        assert api.post("/api/v1/" + p, json={}).json()["path"] == p
    assert api.post("/api/v1/community/ideas/12/hack", json={}).status_code == 404


class _Resp:
    def __init__(self, status, data):
        self.status_code, self._d = status, data

    def json(self):
        return self._d

    def raise_for_status(self):
        if self.status_code >= 400:
            import requests
            raise requests.HTTPError(str(self.status_code))


class _Session:
    def __init__(self):
        self.calls, self.down = 0, False

    def post(self, url, **kw):
        import requests
        self.calls += 1
        if self.down:
            raise requests.ConnectionError("down")
        assert kw["headers"]["X-Service-Key"] == "s"
        return _Resp(200, {"valid": True, "access": dict(PRO)})


def test_auth_client_caches_and_survives_a_panel_outage():
    sess = _Session()
    c = AuthClient(panel_url="http://panel.test", secret="s", session=sess)
    assert c.verify("tok")["user"] == "pro@x.com"
    c.verify("tok")
    assert sess.calls == 1                                   # second call served from cache
    sess.down = True
    c.CACHE_SECONDS = 0                                      # cache expired, panel down -> grace period
    assert c.verify("tok")["user"] == "pro@x.com"
    c.forget("tok")
    out = c.verify("tok")                                    # nothing cached and panel down -> guest
    assert out["status"] == "guest" and "unreachable" in out["reason"]
    assert c.verify("")["status"] == "guest"


def test_layouts_are_saved_per_user(api):
    ws = {"layout": 2, "charts": [{"ticker": "AXI:XAUUSD", "tf": "5m", "ict": ["fvg", "sessions"]}]}
    assert api.get("/api/v1/layouts").status_code == 401                      # guests have none
    r = api.put("/api/v1/layouts/Gold%20London", json=ws, headers=H("pro"))
    assert r.status_code == 200 and r.json()["name"] == "Gold London"
    assert api.get("/api/v1/layouts/Gold%20London", headers=H("pro")).json()["data"] == ws
    assert [x["name"] for x in api.get("/api/v1/layouts", headers=H("pro")).json()["layouts"]] == ["Gold London"]
    assert api.get("/api/v1/layouts", headers=H("free")).json()["layouts"] == []     # another user sees nothing
    assert api.get("/api/v1/layouts/Gold%20London", headers=H("free")).status_code == 404
    assert api.put("/api/v1/layouts/x", content=b"not json", headers=H("pro")).status_code == 400
    assert api.put("/api/v1/layouts/big", json={"d": "x" * 300_000}, headers=H("pro")).status_code == 400
    assert api.delete("/api/v1/layouts/Gold%20London", headers=H("pro")).status_code == 200
    assert api.delete("/api/v1/layouts/Gold%20London", headers=H("pro")).status_code == 404


def test_mt5_down_does_not_block_accounts(store, fake):
    """A dead broker terminal must not hang the API: chart calls fail fast with 503 and
    health / sign-up / login keep working (found on the VPS: MT5 'IPC timeout')."""
    import time
    from ictengine.data.mt5 import MT5Error

    class DeadMT5(FrameProvider):
        def candles(self, ticker, start, end):
            raise MT5Error(r"cannot start/attach MT5 terminal C:\ICT Engine\mt5\terminal64.exe: (-10005, 'IPC timeout')")

    api = TestClient(create_app(DeadMT5({}), store, auth=fake, require_auth=True))
    t = time.time()
    r = api.get("/udf/history", params=HIST, headers=H("pro"))
    assert r.status_code == 503 and "IPC timeout" in r.json()["detail"] and time.time() - t < 2
    assert api.get("/api/v1/health").status_code == 200
    assert api.post("/api/v1/auth/register", json={"email": "n@x.com", "password": "Strong-Pass-123"}).status_code == 200
    assert fake.forwarded[-1][1] == "auth/register"
