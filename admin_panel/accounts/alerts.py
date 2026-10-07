"""Signal alerts on WhatsApp (Meta WhatsApp Cloud API).

The engine runner writes every model signal to ICT's SQLite store (data/ict.db). ``run_once`` reads
the new ones and sends each to every user whose alert settings match: auto-notify on, a WhatsApp number,
a plan that includes signals (and that model), the plan's signal delay passed, grade / model / symbol /
bias filters. Every (user, signal) is sent once (AlertDelivery).

WhatsApp only allows business-started messages through an approved template. The admin creates one in
Meta's WhatsApp Manager, named as in Settings (default ``ict_signal``), with 8 body variables:
  {{1}} symbol  {{2}} model  {{3}} BUY / SELL  {{4}} grade  {{5}} entry  {{6}} stop  {{7}} targets  {{8}} time (NY)
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
from datetime import datetime, timedelta, timezone as dt_tz
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from django.conf import settings
from django.db import IntegrityError
from django.utils import timezone

from .models import AlertDelivery, AlertPrefs, SiteSettings
from .services import active_subscriptions, plan_features

GRAPH = "https://graph.facebook.com/v21.0"
FRESH_MINUTES = 45            # older signals are never sent (no flood after a restart)
NY = ZoneInfo("America/New_York")
NUMBER_RE = re.compile(r"^[1-9][0-9]{7,14}$")
GRADE_RANK = {"B": 0, "A": 1, "A+": 2}


def ict_db() -> Path:
    return Path(os.getenv("ICT_DB") or (Path(settings.BASE_DIR).parent / "data" / "ict.db"))


def clean_number(raw: str) -> str:
    return re.sub(r"\D", "", raw or "").lstrip("0")


class WhatsAppError(Exception):
    pass


def send_template(number: str, params: list[str], site: SiteSettings | None = None, http=requests) -> str:
    """Sends the alert template; returns Meta's message id or raises WhatsAppError."""
    site = site or SiteSettings.load()
    if not (site.whatsapp_phone_number_id and site.whatsapp_token):
        raise WhatsAppError("WhatsApp is not set up in the admin panel yet.")
    body = {"messaging_product": "whatsapp", "to": number, "type": "template",
            "template": {"name": site.whatsapp_template, "language": {"code": site.whatsapp_template_lang or "en"},
                         "components": [{"type": "body", "parameters": [{"type": "text", "text": str(p)[:200]} for p in params]}]}}
    try:
        r = http.post(f"{GRAPH}/{site.whatsapp_phone_number_id}/messages", json=body, timeout=15,
                      headers={"Authorization": f"Bearer {site.whatsapp_token}"})
        data = r.json() if r.content else {}
    except (requests.RequestException, ValueError) as e:
        raise WhatsAppError(f"WhatsApp could not be reached: {e.__class__.__name__}") from None
    if r.status_code >= 400:
        raise WhatsAppError(str((data.get("error") or {}).get("message") or f"HTTP {r.status_code}")[:280])
    return str(((data.get("messages") or [{}])[0]).get("id", ""))


def _fmt(v: float) -> str:
    return f"{v:,.5f}".rstrip("0").rstrip(".") if abs(v) < 10 else f"{v:,.2f}"


def signal_params(s: dict) -> list[str]:
    t = s["created_time"].astimezone(NY)
    tps = " / ".join(_fmt(p) for p, _ in s["targets"])
    return [s["symbol"], s["model_id"], "BUY" if s["direction"] > 0 else "SELL", s.get("grade") or "-",
            _fmt(s["entry"]), _fmt(s["stop"]), tps, t.strftime("%d %b %H:%M") + " NY"]


def new_signals(since, path: Path | None = None) -> list[dict]:
    """Signals created after ``since`` (aware datetime), both bias-filter variants."""
    path = path or ict_db()
    if not path.exists():
        return []
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=10)
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute("SELECT symbol, model_id, direction, created_time, entry, stop, targets, grade, bias_filter "
                           "FROM signals WHERE created_time >= ? ORDER BY created_time",
                           (since.astimezone(dt_tz.utc).isoformat(),)).fetchall()
    finally:
        con.close()
    out = []
    for r in rows:
        d = dict(r)
        d["created_time"] = datetime.fromisoformat(d["created_time"])
        if d["created_time"].tzinfo is None:
            d["created_time"] = d["created_time"].replace(tzinfo=dt_tz.utc)
        d["targets"] = json.loads(d["targets"])
        d["key"] = f"{d['symbol']}|{d['model_id']}|{d['created_time'].isoformat()}|{d['direction']}"
        out.append(d)
    return out


DEFAULT_OFF = {"M11"}   # the engine's models that are off by default (see ictengine.models.registry)


def _wants(p: AlertPrefs, feats: dict, s: dict, now) -> bool:
    if not feats.get("signals"):
        return False
    allowed = feats.get("models")
    if allowed != "all" and s["model_id"] not in (allowed or []):
        return False
    delay = feats.get("signal_delay_minutes") or 0
    if now < s["created_time"] + timedelta(minutes=delay):
        return False                                   # the plan sees it later; sent on a later pass
    if p.bias_only and not s["bias_filter"]:
        return False                                   # bias-only users get the bias-filtered signals only
    if p.min_grade != "all" and GRADE_RANK.get(s.get("grade") or "B", 0) < GRADE_RANK[p.min_grade]:
        return False
    models = {m.strip().upper() for m in p.models_csv.split(",") if m.strip()}
    if models and s["model_id"].upper() not in models:
        return False
    if not models and s["model_id"].upper() in DEFAULT_OFF:
        return False                                   # weak models only when the user lists them
    syms = {m.strip().upper().split(":")[-1] for m in p.symbols_csv.split(",") if m.strip()}
    return not syms or s["symbol"].upper() in syms


def run_once(now=None, path: Path | None = None, sender=send_template, log=print) -> int:
    """Sends the alerts due now; returns how many were sent."""
    site = SiteSettings.load()
    if not site.whatsapp_alerts_enabled:
        return 0
    now = now or timezone.now()
    sigs = new_signals(now - timedelta(minutes=FRESH_MINUTES + 120), path)   # + the longest plan delay
    sigs = [s for s in sigs if s["created_time"] >= now - timedelta(minutes=FRESH_MINUTES + 120)]
    if not sigs:
        return 0
    sent = 0
    for p in AlertPrefs.objects.select_related("user").filter(auto_notify=True).exclude(whatsapp_number=""):
        if not p.user.is_active:
            continue
        feats = plan_features(active_subscriptions(p.user)) if active_subscriptions(p.user) else {}
        delay = timedelta(minutes=(feats.get("signal_delay_minutes") or 0))
        seen = set()
        for s in sigs:
            if s["key"] in seen or now - (s["created_time"] + delay) > timedelta(minutes=FRESH_MINUTES):
                continue
            if not _wants(p, feats, s, now):
                continue
            seen.add(s["key"])
            if AlertDelivery.objects.filter(user=p.user, signal_key=s["key"]).exists():
                continue
            params = signal_params(s)
            try:
                d = AlertDelivery.objects.create(user=p.user, signal_key=s["key"], text=" ".join(params)[:400])
            except IntegrityError:
                continue
            try:
                sender(p.whatsapp_number, params, site)
                d.ok = True
                sent += 1
            except WhatsAppError as e:
                d.error = str(e)[:300]
                log(f"WhatsApp to user {p.user_id}: {e}")
            d.save(update_fields=["ok", "error"])
    return sent


def prefs_dict(p: AlertPrefs | None) -> dict:
    site = SiteSettings.load()
    return {"available": bool(site.whatsapp_alerts_enabled and site.whatsapp_phone_number_id and site.whatsapp_token),
            "whatsapp_number": p.whatsapp_number if p else "", "auto_notify": bool(p and p.auto_notify),
            "min_grade": p.min_grade if p else "A", "models": p.models_csv if p else "", "symbols": p.symbols_csv if p else "",
            "bias_only": p.bias_only if p else True}


def save_prefs(user, data: dict) -> AlertPrefs:
    p, _ = AlertPrefs.objects.get_or_create(user=user)
    if "whatsapp_number" in data:
        n = clean_number(str(data.get("whatsapp_number") or ""))
        if n and not NUMBER_RE.match(n):
            raise ValueError("Write the WhatsApp number with the country code, e.g. 923001234567.")
        p.whatsapp_number = n
    if "auto_notify" in data:
        p.auto_notify = bool(data.get("auto_notify"))
    if data.get("min_grade") in dict(AlertPrefs.GRADES):
        p.min_grade = data["min_grade"]
    if "models" in data:
        p.models_csv = ",".join(m for m in re.split(r"[\s,]+", str(data.get("models") or "").upper()) if re.fullmatch(r"M\d{1,2}", m))[:200]
    if "symbols" in data:
        p.symbols_csv = ",".join(s for s in re.split(r"[\s,]+", str(data.get("symbols") or "").upper()) if re.fullmatch(r"[A-Z0-9._:]{2,20}", s))[:200]
    if "bias_only" in data:
        p.bias_only = bool(data.get("bias_only"))
    if p.auto_notify and not p.whatsapp_number:
        raise ValueError("Add your WhatsApp number first.")
    p.save()
    return p
