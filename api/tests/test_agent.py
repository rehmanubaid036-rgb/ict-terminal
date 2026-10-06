"""ICT Assistant endpoint: template answers, plan limits for the optional LLM rewrite."""
import pytest
from fastapi.testclient import TestClient

from ictapi.auth_client import AuthClient
from ictapi.llm import LLM
from ictapi.main import create_app
from ictapi.market import FrameProvider

AS_OF = "2026-09-03T14:30:00+00:00"
USERS = {
    "pro": {"user": "pro@x.com", "email": "pro@x.com", "status": "active",
            "features": {"signals": True, "models": "all", "ai_messages_per_day": 2, "ict_indicators": True}},
    "free": {"user": "free@x.com", "email": "free@x.com", "status": "active",
             "features": {"signals": True, "models": ["M1"], "ai_messages_per_day": 0}},
}


class Auth(AuthClient):
    def __init__(self):
        super().__init__(panel_url="http://x", secret="s")

    def verify(self, token="", *a, **k):
        return dict(USERS.get(token, {"status": "guest", "features": {}}))


class FakeLLM(LLM):
    def __init__(self, reply="Rewritten answer."):
        super().__init__(base_url="http://llm", api_key="k", model="m")
        self.reply, self.calls = reply, 0

    def rephrase(self, question, facts, lang="en"):
        self.calls += 1
        return self.reply


@pytest.fixture()
def setup(gold, tmp_path):
    from ictengine.store import Store
    llm = FakeLLM()
    c = TestClient(create_app(FrameProvider({"AXI:XAUUSD": gold}), Store(tmp_path / "a.db"), auth=Auth(),
                              require_auth=True, llm=llm))
    return c, llm


def ask(c, token, q, **kw):
    return c.post("/api/v1/agent/ask", headers={"Authorization": f"Bearer {token}"},
                  json={"symbol": "AXI:XAUUSD", "question": q, "as_of": AS_OF, **kw})


def test_guest_cannot_ask(setup):
    c, _ = setup
    assert ask(c, "nobody", "levels").status_code == 401


def test_free_plan_gets_template_answers_without_llm(setup):
    c, llm = setup
    r = ask(c, "free", "levels").json()
    assert r["intent"] == "levels" and r["llm"] is False and "Midnight Open 4,431.12" in r["text"]
    assert llm.calls == 0
    r = ask(c, "free", "session", lang="ur").json()
    assert "New York time Thu 10:30" in r["text"]


def test_pro_plan_llm_rewrite_respects_daily_limit(setup):
    c, llm = setup
    r1 = ask(c, "pro", "where is liquidity").json()
    assert r1["llm"] and r1["text"] == "Rewritten answer." and "liquidity" in r1["facts"]
    ask(c, "pro", "levels")
    r3 = ask(c, "pro", "fvg").json()          # third question today: limit 2 reached -> template text
    assert r3["llm"] is False and llm.calls == 2
    assert ask(c, "pro", "hello there").json()["intent"] == "unknown"


def test_bad_requests(setup):
    c, _ = setup
    assert ask(c, "pro", "   ").status_code == 400
    assert ask(c, "pro", "levels", as_of="yesterday").status_code == 400
    r = c.post("/api/v1/agent/ask", headers={"Authorization": "Bearer pro"},
               json={"symbol": "AXI:XAUUSD", "question": "levels", "as_of": "2020-01-01T00:00:00Z"})
    assert r.status_code == 503


class _R:
    def __init__(self, data, status=200):
        self.d, self.status_code = data, status

    def json(self):
        return self.d

    def raise_for_status(self):
        if self.status_code >= 400:
            import requests
            raise requests.HTTPError("x")


class _S:
    def __init__(self, resp):
        self.resp, self.sent = resp, None

    def post(self, url, **kw):
        self.sent = (url, kw)
        return self.resp


def test_llm_client_openai_compatible():
    s = _S(_R({"choices": [{"message": {"content": " Short answer. "}}]}))
    llm = LLM(base_url="https://api.groq.com/openai/v1", api_key="k", model="llama-3.1-8b-instant", session=s)
    assert llm.rephrase("q", "facts", "ur") == "Short answer."
    url, kw = s.sent
    assert url.endswith("/chat/completions") and kw["headers"]["Authorization"] == "Bearer k"
    assert "Roman Urdu" in kw["json"]["messages"][0]["content"] and "facts" in kw["json"]["messages"][1]["content"]
    assert LLM(base_url="", api_key="", model="").rephrase("q", "f") is None           # disabled
    assert LLM(base_url="http://x", api_key="k", model="m", session=_S(_R({}, 500))).rephrase("q", "f") is None
