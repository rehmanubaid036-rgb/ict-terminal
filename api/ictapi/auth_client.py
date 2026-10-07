"""Talks to the Django admin panel (admin_panel/) for accounts, plans and subscriptions.
Ported from ICC Terminal's tested auth client.

``verify()`` runs on every protected request, so answers are cached for a minute. If the panel
is briefly unreachable, the last good answer is reused for up to 10 minutes; after that the
caller is treated as a guest.
"""
from __future__ import annotations

import os
import threading
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

GUEST_FEATURES = {"signals": False, "signal_delay_minutes": None, "models": [], "ict_indicators": False,
                  "max_charts": 1, "trades": False, "auto_trade": False, "max_mt_accounts": 0,
                  "ai_messages_per_day": 0, "alerts_limit": 0, "backtest": False}
GUEST = {"user": "Guest", "email": "", "plan": "No account", "expiry": "-", "is_vip": False,
         "status": "guest", "days_left": None, "plans": [], "features": dict(GUEST_FEATURES)}

FORWARD_HEADERS = ("Authorization", "X-Device-Id", "X-Device-Name", "X-Device-Platform", "X-Device-Legacy-Id")


class AuthClient:
    CACHE_SECONDS = 60
    GRACE_SECONDS = 600
    TIMEOUT = 8
    CRYPTO_TIMEOUT = 45

    def __init__(self, panel_url: str | None = None, secret: str | None = None, session=None):
        self.panel_url = (panel_url or os.getenv("ADMIN_PANEL_URL", "http://127.0.0.1:8101")).rstrip("/")
        self.secret = secret if secret is not None else os.getenv("INTERNAL_API_SECRET", "")
        self.http = session or requests
        self._cache: dict[tuple, tuple[float, dict]] = {}
        self._lock = threading.Lock()

    def _service_headers(self, client_ip: str = "") -> dict:
        h = {"X-Service-Key": self.secret}
        if client_ip:
            h["X-Client-IP"] = client_ip
        return h

    def ai_config(self, email: str = "") -> dict:
        """{site: {provider, model, api_key} | None, user: ... | None} from the admin panel, cached a
        minute per user; {} when the panel cannot be reached (the assistant then uses templates)."""
        key = ("ai", (email or "").lower())
        now = time.time()
        with self._lock:
            hit = self._cache.get(key)
        if hit and now - hit[0] < self.CACHE_SECONDS:
            return dict(hit[1])
        try:
            r = self.http.post(f"{self.panel_url}/api/v1/internal/ai", timeout=self.TIMEOUT,
                               headers=self._service_headers(), json={"email": email or ""})
            r.raise_for_status()
            data = r.json()
            out = {"site": data.get("site"), "user": data.get("user")}
        except (requests.RequestException, ValueError, AttributeError):
            return {}
        with self._lock:
            self._cache[key] = (now, out)
        return dict(out)

    def verify(self, token: str = "", device_id: str = "", device_name: str = "", platform: str = "",
               client_ip: str = "") -> dict:
        """Access dict (user, plan, expiry, is_vip, features, ...) for a login token."""
        token = (token or "").strip()
        if not token:
            return _copy(GUEST)
        key = ("t:" + token, device_id)
        now = time.time()
        with self._lock:
            hit = self._cache.get(key)
        if hit and now - hit[0] < self.CACHE_SECONDS:
            return _copy(hit[1])
        try:
            r = self.http.post(f"{self.panel_url}/api/v1/internal/verify", timeout=self.TIMEOUT,
                               headers=self._service_headers(client_ip),
                               json={"token": token, "device_id": device_id, "device_name": device_name,
                                     "platform": platform})
            r.raise_for_status()
            data = r.json()
            access = dict(data.get("access") or GUEST)
            access["reason"] = data.get("reason", "")
            if not data.get("valid", False):
                access["status"] = access.get("status") or "guest"
            if data.get("logout"):  # token used on another device: the client must log in again
                access["status"] = "session_mismatch"
        except (requests.RequestException, ValueError):
            if hit and now - hit[0] < self.GRACE_SECONDS:
                return _copy(hit[1])
            access = _copy(GUEST)
            access["reason"] = "Account server unreachable."
            return access
        with self._lock:
            self._cache[key] = (now, access)
            if len(self._cache) > 5000:  # keep memory bounded
                for k, _ in sorted(self._cache.items(), key=lambda kv: kv[1][0])[:1000]:
                    self._cache.pop(k, None)
        return _copy(access)

    EA_CACHE_SECONDS = 10

    def ea_checkin(self, ea_token: str, info: dict, client_ip: str = "") -> dict:
        """Identifies an ICT Bridge EA by its token (admin panel internal/ea) and records its status.
        Returns {valid, reason, access, copy}; cached for 10 s because the EA polls every few seconds."""
        ea_token = (ea_token or "").strip()
        if not ea_token:
            return {"valid": False, "reason": "EA token missing. Paste it in the EA settings.", "copy": None}
        key = ("ea:" + ea_token, "")
        now = time.time()
        with self._lock:
            hit = self._cache.get(key)
        if hit and now - hit[0] < self.EA_CACHE_SECONDS:
            return dict(hit[1])
        try:
            r = self.http.post(f"{self.panel_url}/api/v1/internal/ea", timeout=self.TIMEOUT,
                               headers=self._service_headers(client_ip), json={"ea_token": ea_token, **info})
            r.raise_for_status()
            data = r.json()
        except (requests.RequestException, ValueError):
            if hit and now - hit[0] < self.GRACE_SECONDS:
                return dict(hit[1])
            return {"valid": False, "reason": "Account server unreachable.", "copy": None}
        with self._lock:
            self._cache[key] = (now, data)
        return dict(data)

    def remember(self, token: str, device_id: str, access: dict) -> None:
        if token and isinstance(access, dict):
            with self._lock:
                self._cache[("t:" + token, device_id)] = (time.time(), dict(access, reason=access.get("reason", "")))

    def forget(self, token: str = "") -> None:
        with self._lock:
            for k in [k for k in self._cache if k[0] == "t:" + token]:
                self._cache.pop(k, None)

    def forward(self, method: str, path: str, json_body=None, headers=None, client_ip: str = "",
                query: dict | None = None) -> tuple[int, dict]:
        """Proxies a customer-facing call (login, register, plans, payments ...) to the panel."""
        out = self._service_headers(client_ip)
        incoming = {k.lower(): v for k, v in (headers or {}).items()}
        for name in FORWARD_HEADERS:
            if incoming.get(name.lower()):
                out[name] = incoming[name.lower()]
        timeout = self.CRYPTO_TIMEOUT if path.startswith("payments/crypto/") else self.TIMEOUT
        try:
            r = self.http.request(method, f"{self.panel_url}/api/v1/{path}", json=json_body, headers=out, timeout=timeout,
                                  params=query or None)
            try:
                return r.status_code, r.json()
            except ValueError:
                return 502, {"success": False, "detail": "Account server returned an invalid response."}
        except requests.Timeout:
            return 503, {"success": False, "detail": "The account server is busy. Try again in a minute."}
        except requests.RequestException:
            return 503, {"success": False, "detail": "Account server is unreachable. Try again shortly."}


def _copy(access: dict) -> dict:
    out = dict(access)
    out["features"] = dict(access.get("features") or GUEST_FEATURES)
    return out
