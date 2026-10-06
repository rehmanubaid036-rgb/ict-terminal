"""build_release: what goes into the VPS zip."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_release as b  # noqa: E402


def test_wanted_rules():
    w = lambda s: b.wanted(Path(s))  # noqa: E731
    assert w("engine/ictengine/data/mt5.py")                 # engine package named "data" is kept
    assert w("web/terminal/dist/assets/index.js") and w("web/serve_web.py")
    assert not w("web/terminal/src/App.tsx") and not w("web/terminal/package.json")
    assert not w("web/terminal/node_modules/x/index.js")
    assert not w("admin_panel/.env") and not w("api/.env") and w("admin_panel/.env.example")
    assert not w("admin_panel/data/admin_panel.sqlite3") and not w("admin_panel/staticfiles/a.css")
    assert not w("engine/tests/test_fvg.py") and not w("deploy/test_build_release.py")
    assert not w("engine/ictengine/__pycache__/x.pyc")
    assert not w("mobile/ict_terminal/android/key.properties")
    assert not w("deploy/cloudflared/ict-terminal.json") and not w("deploy/cloudflared/cloudflared.exe")
    assert not w("deploy/vpscheck_ict_report.txt")
    assert w("oneclickict.bat") and w("deploy/oneclick_ict.py") and w("deploy/ict_tunnel.py")


def test_release_manifest_lists_only_built_apps(tmp_path):
    apk = tmp_path / "app.apk"
    apk.write_bytes(b"x" * 2_500_000)
    m = b.release_manifest("0.3.0", {"android": ("ICT_Terminal.apk", apk),
                                     "windows": ("ICT_Terminal_Windows.exe", tmp_path / "missing.exe")})
    assert m == {"version": "0.3.0", "files": {"android": {"file": "ICT_Terminal.apk", "size_mb": 2.5}}}
    assert b.wanted(Path("web/site/index.html")) and b.wanted(Path("web/site/site.js"))


def test_code_only_update_leaves_out_the_apps(tmp_path, monkeypatch):
    import zipfile
    monkeypatch.setattr(b, "OUT", tmp_path)
    zpath, _ = b.build("9.9.9", with_apps=False)
    names = zipfile.ZipFile(zpath).namelist()
    assert zpath.name == "ICT_Terminal_VPS_v9.9.9_update.zip"
    assert not [n for n in names if n.startswith("downloads/")]      # the VPS keeps its apps and release.json
    assert "oneclickict.bat" in names and "VERSION.txt" in names
