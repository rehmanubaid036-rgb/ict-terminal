"""Google / Facebook sign-in pages pass through the API to the admin panel; oauth/poll is forwarded as JSON."""
import requests
from fastapi.testclient import TestClient

from ictapi.auth_client import AuthClient
from ictapi.main import create_app
from ictapi.market import FrameProvider
from ictengine.store import Store


class Panel(AuthClient):
    def __init__(self):
        super().__init__(panel_url="http://panel.test", secret="s")
        self.forwarded = []

    def forward(self, method, path, json_body=None, headers=None, client_ip="", query=None):
        self.forwarded.append((method, path, json_body))
        return 200, {"success": True, "status": "pending"}


def test_pages_and_poll(tmp_path, monkeypatch):
    seen = []

    class R:
        def __init__(self, status, headers, content):
            self.status_code, self.headers, self.content = status, headers, content

    def fake(method, url, params=None, data=None, headers=None, allow_redirects=True, timeout=None):
        seen.append((method, url, params, data, headers.get("X-Service-Key"), allow_redirects))
        if url.endswith("/start"):
            return R(302, {"Location": "https://accounts.google.com/o/oauth2/v2/auth?x=1", "Server": "x"}, b"")
        return R(200, {"Content-Type": "text/html; charset=utf-8"}, b"<html>ok</html>")

    monkeypatch.setattr(requests, "request", fake)
    panel = Panel()
    c = TestClient(create_app(FrameProvider({}), Store(tmp_path / "o.db"), auth=panel, require_auth=False), follow_redirects=False)
    r = c.get("/api/v1/oauth/google/start", params={"session": "a" * 40, "platform": "web"})
    assert r.status_code == 302 and r.headers["location"].startswith("https://accounts.google.com/") and "server" not in r.headers
    assert seen[0][2]["session"] == "a" * 40 and seen[0][4] == "s" and seen[0][5] is False
    f = c.post("/api/v1/oauth/finish", content=b"key=abc", headers={"Content-Type": "application/x-www-form-urlencoded"})
    assert f.text == "<html>ok</html>" and seen[1][3] == b"key=abc"
    assert c.get("/api/v1/oauth/evil/start").status_code == 404
    assert c.post("/api/v1/oauth/poll", json={"session": "a" * 40}).json()["status"] == "pending"
    assert panel.forwarded[-1] == ("POST", "oauth/poll", {"session": "a" * 40})
