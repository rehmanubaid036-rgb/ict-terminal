"""Use statistics: page views and visitors, terminal opens / minutes; no IPs or emails are stored."""
import sqlite3

from fastapi.testclient import TestClient

from ictapi.main import create_app
from ictapi.market import FrameProvider
from ictengine.store import Store


def test_counts_and_unique(tmp_path):
    store = Store(tmp_path / "t.db")
    c = TestClient(create_app(FrameProvider({}), store, require_auth=False))
    assert c.post("/api/v1/track", json={"kind": "site", "page": "/donate.html", "ref": "google.com"}).json()["ok"]
    c.post("/api/v1/track", json={"kind": "site", "page": "/donate.html"})          # same visitor within 20 s: not counted
    c.post("/api/v1/track", json={"kind": "terminal_open"}, headers={"X-Device-Platform": "android"})
    c.post("/api/v1/track", json={"kind": "terminal_minute"})
    assert c.post("/api/v1/track", json={"kind": "nope"}).json() == {"ok": False}
    u = store.usage("2000-01-01")
    counts = {(r["metric"], r["key"]): r["n"] for r in u["counts"]}
    assert counts[("site_view", "/donate.html")] == 1 and counts[("site_ref", "google.com")] == 1
    assert counts[("terminal_open", "android")] == 1 and counts[("terminal_minute", "web")] == 1
    uniq = {r["metric"]: r["n"] for r in u["unique"]}
    assert uniq == {"site_visitor": 1, "terminal_user": 1}
    raw = sqlite3.connect(tmp_path / "t.db").execute("SELECT who FROM usage_unique").fetchall()
    assert all("." not in w[0] and "@" not in w[0] for w in raw)                   # hashes only
