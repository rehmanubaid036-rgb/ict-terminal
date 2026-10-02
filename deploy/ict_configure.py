r"""VPS settings (.env files) for ICT Terminal. Safe to run again (existing values are kept unless given).

    python deploy/ict_configure.py [--mt5 "C:\ICT engine\mt5\terminal64.exe"]

  * admin_panel/.env  - domain ictadmin.iccterminal.trade, HTTPS behind Cloudflare, superadmin
  * api/.env          - ICT's own MT5 data terminal, login required
Only files inside this folder are written; ICC Terminal is never touched. ICT's Cloudflare
tunnel is set up separately by ict_tunnel.py (its own tunnel and service).
"""
from __future__ import annotations

import argparse
import secrets
import string
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read_env(path: Path) -> dict:
    out = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip()
    return out


def set_env(path: Path, updates: dict, only_if_empty: tuple = ()) -> list[str]:
    """Writes KEY=value lines; keys in ``only_if_empty`` keep an existing non-empty value."""
    current = read_env(path)
    updates = {k: v for k, v in updates.items() if not (k in only_if_empty and current.get(k))}
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    done = set()
    for i, line in enumerate(lines):
        key = line.split("=", 1)[0].strip()
        if "=" in line and not line.lstrip().startswith("#") and key in updates:
            lines[i] = f"{key}={updates[key]}"
            done.add(key)
    lines += [f"{k}={v}" for k, v in updates.items() if k not in done]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return sorted(updates)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mt5", default="", help="terminal64.exe of the broker terminal that feeds data")
    ap.add_argument("--skip-tunnel", action="store_true", help="ignored (kept for older scripts)")
    a = ap.parse_args()

    admin_env = ROOT / "admin_panel" / ".env"
    pw = "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(20))
    changed = set_env(admin_env, {
        "DJANGO_ALLOWED_HOSTS": "127.0.0.1,localhost,ictadmin.iccterminal.trade,ictapi.iccterminal.trade",
        "DJANGO_CSRF_TRUSTED_ORIGINS": "https://ictadmin.iccterminal.trade",
        "DJANGO_HTTPS": "true",
        "DJANGO_TIME_ZONE": "Asia/Karachi",
        "PUBLIC_API_URL": "https://ictapi.iccterminal.trade",
        "DJANGO_SUPERUSER_EMAIL": "rehmanubaid036@gmail.com",
        "DJANGO_SUPERUSER_PASSWORD": pw,
    }, only_if_empty=("DJANGO_SUPERUSER_EMAIL", "DJANGO_SUPERUSER_PASSWORD"))
    print("admin_panel/.env:", ", ".join(changed))
    if "DJANGO_SUPERUSER_PASSWORD" in changed:
        print("  superadmin password was generated: see DJANGO_SUPERUSER_PASSWORD in admin_panel\\.env")

    api_env = ROOT / "api" / ".env"
    updates = {"ICT_REQUIRE_AUTH": "true", "ADMIN_PANEL_URL": "http://127.0.0.1:8101"}
    if a.mt5:
        if not Path(a.mt5).exists():
            raise SystemExit(f"MT5 terminal not found: {a.mt5}")
        updates["ICT_MT5_AXI_DEMO_TERMINAL"] = a.mt5
    print("api/.env:", ", ".join(set_env(api_env, updates)))
    if not read_env(api_env).get("ICT_MT5_AXI_DEMO_TERMINAL"):
        print("  WARNING: no MT5 terminal set yet; run again with --mt5 \"...\\terminal64.exe\"")


if __name__ == "__main__":
    sys.exit(main())
