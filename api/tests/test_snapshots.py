"""Chart pictures shared by link: upload (logged in), public page and image, limits, delete."""
import base64

from fastapi.testclient import TestClient

from ictapi.main import create_app
from ictapi.market import FrameProvider
from ictengine.store import Store

PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64).decode()


def test_share_view_delete(tmp_path):
    store = Store(tmp_path / "s.db")
    c = TestClient(create_app(FrameProvider({}), store, require_auth=False))
    bad = c.post("/api/v1/snapshots", json={"image": "data:image/png;base64," + base64.b64encode(b"<svg>").decode()})
    assert bad.status_code == 400
    assert c.post("/api/v1/snapshots", json={"image": "data:text/html;base64,AAAA"}).status_code == 400
    r = c.post("/api/v1/snapshots", json={"image": "data:image/png;base64," + PNG, "title": "XAUUSD 5m <b>"}).json()
    page = c.get(r["url"])
    assert page.status_code == 200 and "og:image" in page.text and "<b>" not in page.text
    img = c.get(r["image"])
    assert img.status_code == 200 and img.headers["content-type"] == "image/png" and img.content.startswith(b"\x89PNG")
    assert c.get("/api/v1/snapshots/zzzzzzzzzzzz.png").status_code == 404
    assert c.get(r["url"] + ".jpg").status_code == 404
    assert [s["id"] for s in c.get("/api/v1/snapshots").json()["snapshots"]] == [r["id"]]
    assert c.delete(f"/api/v1/snapshots/{r['id']}").json()["deleted"]
    assert c.get(r["image"]).status_code == 404
    assert not list((tmp_path / "snapshots").iterdir())
