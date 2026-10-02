"""Builds the VPS package and collects the release APK into release/.

    python deploy/build_release.py 0.3.1            full package: code + apps (~37 MB, first install)
    python deploy/build_release.py 0.3.2 --code     update: code only (~0.4 MB; the VPS keeps its apps)

  release/ICT_Terminal_VPS_v<version>.zip   - extract into the VPS folder (e.g. C:\\ICT engine; first install
                                              or update), then run oneclickict.bat as administrator
  release/ICT_Terminal_v<version>.apk        - signed Android app (if it has been built)

The zip also carries the apps for the website's download buttons (served from /downloads/):
  downloads/ICT_Terminal.apk, downloads/ICT_Terminal_Windows.exe and downloads/release.json

Secrets, databases, caches and dev-only folders are never packed, so an update zip never
overwrites the VPS's .env files, users or signals.
"""
from __future__ import annotations

import json
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "release"

INCLUDE = ["oneclickict.bat", "vpscheckict.bat", "ictoneclickclose.bat", "README.md", "engine", "api", "admin_panel", "web", "ea", "deploy", "docs/VPS_SETUP_UR.md"]
SKIP_DIRS = {".venv", "node_modules", "__pycache__", ".pytest_cache", ".mypy_cache", "ictengine.egg-info",
             "tests", ".git"}
SKIP_PATHS = {("admin_panel", "data"), ("admin_panel", "staticfiles"),   # VPS database/media, built on the VPS
              ("deploy", "cloudflared")}                                 # the VPS's own tunnel key
SKIP_FILES = {".env", "key.properties", "vpscheck_ict_report.txt"}
SKIP_SUFFIX = {".pyc", ".pyo", ".log", ".sqlite3", ".db", ".pkl", ".bi5", ".bak", ".ex5"}
SKIP_PREFIX = ("test_",)
# Apps for the website: name inside the zip's downloads/ -> where the build puts them
APPS = {"android": ("ICT_Terminal.apk", ROOT / "mobile/ict_terminal/build/app/outputs/flutter-apk/app-release.apk"),
        "windows": ("ICT_Terminal_Windows.exe", ROOT / "release" / "ICT Terminal.exe")}
REQUIRED = ["oneclickict.bat", "ictoneclickclose.bat", "web/site/index.html", "vpscheckict.bat", "deploy/oneclick_ict.py", "deploy/vpscheck_ict.py",
            "deploy/ict_services.py", "deploy/ict_tunnel.py", "deploy/ict_configure.py",
            "web/terminal/dist/index.html", "deploy/startict.bat", "deploy/stopict.bat",
            "deploy/requirements.txt", "admin_panel/manage.py", "engine/pyproject.toml",
            "api/ictapi/main.py", "ea/mt5/ICT_Bridge.mq5"]


def wanted(rel: Path) -> bool:
    parts = rel.parts
    # web/terminal: only the built dist folder is shipped
    if parts[:2] == ("web", "terminal") and (len(parts) < 3 or parts[2] != "dist"):
        return False
    if any(p in SKIP_DIRS for p in parts[:-1]) or parts[:2] in SKIP_PATHS:
        return False
    name = parts[-1]
    if name in SKIP_FILES or name.endswith(".env") or name.startswith(".env."):
        return name == ".env.example"
    return rel.suffix.lower() not in SKIP_SUFFIX and not name.startswith(SKIP_PREFIX)


def files() -> list[Path]:
    out = []
    for item in INCLUDE:
        p = ROOT / item
        if p.is_file():
            out.append(p.relative_to(ROOT))
        elif p.is_dir():
            out += [f.relative_to(ROOT) for f in sorted(p.rglob("*")) if f.is_file() and wanted(f.relative_to(ROOT))]
    return out


def release_manifest(version: str, apps: dict[str, tuple[str, Path]]) -> dict:
    """downloads/release.json: what the website's download buttons offer."""
    return {"version": version,
            "files": {kind: {"file": name, "size_mb": round(src.stat().st_size / 1e6, 1)}
                      for kind, (name, src) in apps.items() if src.exists()}}


def build(version: str, with_apps: bool = True) -> tuple[Path, list[Path]]:
    missing = [r for r in REQUIRED if not (ROOT / r).exists()]
    if missing:
        raise SystemExit(f"cannot build, missing: {missing} (run `npm run build` in web/terminal first)")
    OUT.mkdir(exist_ok=True)
    zpath = OUT / f"ICT_Terminal_VPS_v{version}{'' if with_apps else '_update'}.zip"
    listing = files()
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in listing:
            z.write(ROOT / rel, rel.as_posix())   # no top folder: extracts straight into C:\ICT engine
        z.writestr("VERSION.txt", version + "\n")
        if not with_apps:
            return zpath, listing      # downloads/ (apps + release.json) on the VPS stay as they are
        for kind, (name, src) in APPS.items():
            if src.exists():
                z.write(src, f"downloads/{name}")
            else:
                print(f"WARNING: no {kind} app built ({src}); the website shows 'Coming soon'")
        z.writestr("downloads/release.json", json.dumps(release_manifest(version, APPS), indent=2) + "\n")
    return zpath, listing


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: python deploy/build_release.py <version> [--code]")
    version = sys.argv[1]
    with_apps = "--code" not in sys.argv[2:]
    zpath, listing = build(version, with_apps)
    print(f"{zpath.name}: {len(listing)} files, {zpath.stat().st_size / 1e6:.1f} MB")
    if not with_apps:
        return
    apk = ROOT / "mobile/ict_terminal/build/app/outputs/flutter-apk/app-release.apk"
    if apk.exists():
        dst = OUT / f"ICT_Terminal_v{version}.apk"
        shutil.copy2(apk, dst)
        print(f"{dst.name}: {dst.stat().st_size / 1e6:.1f} MB")
    else:
        print("no release APK yet (flutter build apk --release)")


if __name__ == "__main__":
    main()
