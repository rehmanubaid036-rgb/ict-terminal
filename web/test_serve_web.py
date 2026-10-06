"""serve_web: website, terminal under /terminal/, downloads, API pass-through."""
import sys
from pathlib import Path

import httpx
import pytest
from starlette.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent))
import serve_web  # noqa: E402


@pytest.fixture()
def dirs(tmp_path):
    dist, site, dl = tmp_path / "dist", tmp_path / "site", tmp_path / "downloads"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>TERMINAL</html>", encoding="utf-8")
    (dist / "favicon.svg").write_text("<svg/>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
    site.mkdir()
    (site / "index.html").write_text("<html>WEBSITE</html>", encoding="utf-8")
    (site / "privacy.html").write_text("<html>PRIVACY</html>", encoding="utf-8")
    dl.mkdir()
    (dl / "ICT_Terminal.apk").write_bytes(b"PK\x03\x04apk")
    (tmp_path / "secret.txt").write_text("nope", encoding="utf-8")
    return dist, site, dl


def app(dirs, api="http://api.test"):
    dist, site, dl = dirs
    return TestClient(serve_web.create_app(api, dist, site, dl))


def test_website_at_root(dirs):
    c = app(dirs)
    assert c.get("/").text == "<html>WEBSITE</html>"
    assert c.get("/privacy.html").text == "<html>PRIVACY</html>"
    assert c.get("/no-such-page.html").status_code == 404


def test_terminal_under_terminal_path(dirs):
    c = app(dirs)
    r = c.get("/terminal", follow_redirects=False)
    assert r.status_code == 308 and r.headers["location"] == "/terminal/"
    assert c.get("/terminal/").text == "<html>TERMINAL</html>"
    assert c.get("/terminal/some/deep/link").text == "<html>TERMINAL</html>"      # single-page app
    assert c.get("/terminal/assets/app.js").text == "console.log(1)"
    assert c.get("/terminal/favicon.svg").text == "<svg/>"
    assert c.get("/terminal/..%2Fsecret.txt").text == "<html>TERMINAL</html>"     # no way out of dist


def test_downloads(dirs):
    c = app(dirs)
    r = c.get("/downloads/ICT_Terminal.apk")
    assert r.status_code == 200 and r.content == b"PK\x03\x04apk"
    assert r.headers["content-type"] == "application/vnd.android.package-archive"
    assert c.get("/downloads/missing.exe").status_code == 404
    assert c.get("/downloads/..%2Fsecret.txt").status_code == 404      # nothing outside downloads
    assert c.get("/downloads/").status_code == 404                      # no folder listing


def test_downloads_folder_may_be_missing(dirs, tmp_path):
    dist, site, _ = dirs
    c = TestClient(serve_web.create_app("http://api.test", dist, site, tmp_path / "none"))
    assert c.get("/").status_code == 200
    assert c.get("/downloads/ICT_Terminal.apk").status_code == 404


def test_api_calls_are_passed_through(dirs, monkeypatch):
    seen = {}

    def handler(request: httpx.Request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        seen["body"] = request.content
        return httpx.Response(201, json={"ok": True}, headers={"x-test": "1"})

    real = httpx.AsyncClient
    monkeypatch.setattr(serve_web.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    c = app(dirs)
    r = c.post("/api/v1/auth/login?x=1", json={"email": "a"}, headers={"Authorization": "Bearer t"})
    assert r.status_code == 201 and r.json() == {"ok": True} and r.headers["x-test"] == "1"
    assert seen["url"] == "http://api.test/api/v1/auth/login?x=1" and seen["auth"] == "Bearer t"
    assert b'"email"' in seen["body"]
    assert c.get("/udf/config").status_code == 201


def test_api_down_gives_502(dirs, monkeypatch):
    def handler(request):
        raise httpx.ConnectError("down")

    real = httpx.AsyncClient
    monkeypatch.setattr(serve_web.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    assert app(dirs).get("/api/v1/health").status_code == 502


def test_missing_builds_are_refused(dirs, tmp_path):
    dist, site, dl = dirs
    with pytest.raises(SystemExit):
        serve_web.create_app("http://api.test", tmp_path / "nodist", site, dl)
    with pytest.raises(SystemExit):
        serve_web.create_app("http://api.test", dist, tmp_path / "nosite", dl)
