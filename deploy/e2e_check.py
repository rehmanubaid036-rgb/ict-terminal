"""End-to-end check against the running servers (API :8100 + admin panel :8101).

    python deploy/e2e_check.py

Creates a throw-away account through the public API, checks plan-based access before and after
a plan is granted, and deletes the account again. Exits non-zero on the first failure.
"""
from __future__ import annotations

import os
import secrets
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
API = os.getenv("ICT_API", "http://127.0.0.1:8100")
sys.path.insert(0, str(ROOT / "admin_panel"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")


def check(cond, what):
    print(("PASS " if cond else "FAIL ") + what, flush=True)
    if not cond:
        sys.exit(1)


def django_orm():
    os.chdir(ROOT / "admin_panel")
    import django
    django.setup()
    from django.contrib.auth import get_user_model
    from accounts.models import Plan, Subscription
    return get_user_model(), Plan, Subscription


def main():
    email = f"e2e-{secrets.token_hex(4)}@example.com"
    password = secrets.token_urlsafe(16)
    dev = {"X-Device-Id": "e2e-" + secrets.token_hex(6), "X-Device-Platform": "web", "X-Device-Name": "e2e"}
    now = int(time.time())
    hist = {"symbol": "AXI:XAUUSD", "resolution": "15", "from": now - 86400 * 3, "to": now}
    User, Plan, Subscription = django_orm()
    try:
        r = requests.get(f"{API}/udf/history", params=hist, timeout=30)
        check(r.status_code == 401, "guest cannot read chart data (401)")

        r = requests.post(f"{API}/api/v1/auth/register", json={"email": email, "password": password, "name": "E2E",
                                                               "device_id": dev["X-Device-Id"], "platform": "web"},
                          headers=dev, timeout=30)
        check(r.status_code in (200, 201) and r.json().get("token"), f"register through API ({r.status_code})")
        token = r.json()["token"]
        auth = {**dev, "Authorization": f"Bearer {token}"}

        me = requests.get(f"{API}/api/v1/auth/me", headers=auth, timeout=30).json()
        check(me.get("success") and me["access"]["features"]["signals"] is False, "new account has no signal access")

        r = requests.get(f"{API}/udf/history", params=hist, headers=auth, timeout=60)
        check(r.status_code == 200 and r.json()["s"] == "ok", "logged-in account reads chart data")
        r = requests.get(f"{API}/api/v1/signals", params={"symbol": "AXI:XAUUSD", "from": now - 86400, "to": now},
                         headers=auth, timeout=30)
        check(r.status_code == 403, "signals blocked without a plan (403)")
        r = requests.get(f"{API}/api/v1/ict/overlays", params={**hist, "indicators": "fvg"}, headers=auth, timeout=60)
        check(r.status_code == 403, "ICT indicators blocked without a plan (403)")

        user = User.objects.get(email=email)
        Subscription.objects.create(user=user, plan=Plan.objects.get(slug="pro-monthly"))
        me = requests.get(f"{API}/api/v1/auth/me", headers=auth, timeout=30).json()  # refreshes the API cache
        f = me["access"]["features"]
        check(f["signals"] and f["models"] == "all" and f["ict_indicators"], "Pro plan grants signals + indicators")

        r = requests.get(f"{API}/api/v1/signals", params={"symbol": "AXI:XAUUSD", "from": now - 86400 * 7, "to": now},
                         headers=auth, timeout=60)
        check(r.status_code == 200 and isinstance(r.json()["signals"], list), f"Pro reads signals ({len(r.json()['signals'])})")
        r = requests.get(f"{API}/api/v1/ict/overlays", params={**hist, "indicators": "fvg"}, headers=auth, timeout=120)
        check(r.status_code == 200 and r.json()["objects"], f"Pro reads ICT overlays ({len(r.json()['objects'])})")

        r = requests.post(f"{API}/api/v1/auth/logout", headers=auth, timeout=30)
        check(r.status_code == 200, "logout")
        r = requests.get(f"{API}/udf/history", params=hist, headers=auth, timeout=30)
        check(r.status_code == 401, "token rejected after logout (401)")
    finally:
        n, _ = User.objects.filter(email=email).delete()
        print(f"cleanup: deleted {n} row(s) for the e2e account", flush=True)
    print("ALL E2E CHECKS PASSED")


if __name__ == "__main__":
    main()
