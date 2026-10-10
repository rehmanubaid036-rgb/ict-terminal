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
from django.db import IntegrityError, transaction
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


def inverted(s: dict) -> dict:
    """The opposite trade of a signal: direction flipped, stop and targets mirrored around the entry."""
    e = s["entry"]
    return {**s, "direction": -s["direction"], "stop": 2 * e - s["stop"],
            "targets": [[2 * e - t[0], t[1]] for t in s["targets"]], "key": s["key"] + "|inv", "inverted": True}


def signal_text(s: dict) -> str:
    p = signal_params(s)
    flip = " (opposite direction)" if s.get("inverted") else ""
    return f"ICT Terminal signal: {p[0]} {p[1]} {p[2]}{flip} (grade {p[3]}). Entry {p[4]}, SL {p[5]}, TP {p[6]}. {p[7]}. Not financial advice."


def run_once(now=None, path: Path | None = None, sender=send_template, log=print, tg_sender=None) -> int:
    """Sends the signals due now to WhatsApp (and Telegram when connected); returns how many messages were sent."""
    site = SiteSettings.load()
    wa_on = bool(site.whatsapp_alerts_enabled)
    tg_on = bool(site.telegram_bot_token)
    if not (wa_on or tg_on):
        return 0
    tg_sender = tg_sender or (lambda chat, text, site: send_telegram(chat, text, site))
    now = now or timezone.now()
    sigs = new_signals(now - timedelta(minutes=FRESH_MINUTES + 120), path)   # + the longest plan delay
    sigs = [s for s in sigs if s["created_time"] >= now - timedelta(minutes=FRESH_MINUTES + 120)]
    if not sigs:
        return 0
    sent = 0
    for p in AlertPrefs.objects.select_related("user").filter(auto_notify=True):
        if not p.user.is_active:
            continue
        chans = ([("whatsapp", p.whatsapp_number)] if wa_on and p.whatsapp_number else []) +                 ([("telegram", p.telegram_chat_id)] if tg_on and p.telegram_signals and p.telegram_chat_id else [])
        if not chans:
            continue
        subs = active_subscriptions(p.user)
        feats = plan_features(subs) if subs else {}
        delay = timedelta(minutes=(feats.get("signal_delay_minutes") or 0))
        seen = set()
        for s in sigs:
            if s["key"] in seen or now - (s["created_time"] + delay) > timedelta(minutes=FRESH_MINUTES):
                continue
            if not _wants(p, feats, s, now):
                continue
            seen.add(s["key"])
            if p.invert_signals:
                s = inverted(s)
            params = signal_params(s)
            for ch, to in chans:
                try:
                    with transaction.atomic():   # a savepoint: a duplicate must not break the outer transaction
                        d = AlertDelivery.objects.create(user=p.user, signal_key=s["key"], channel=ch, text=" ".join(params)[:400])
                except IntegrityError:
                    continue
                try:
                    if ch == "whatsapp":
                        sender(to, params, site)
                    else:
                        tg_sender(to, signal_text(s), site)
                    d.ok = True
                    sent += 1
                except (WhatsAppError, ChannelError) as e:
                    d.error = str(e)[:300]
                    log(f"{ch} to user {p.user_id}: {e}")
                d.save(update_fields=["ok", "error"])
    return sent


def prefs_dict(p: AlertPrefs | None) -> dict:
    site = SiteSettings.load()
    return {"available": bool(site.whatsapp_alerts_enabled and site.whatsapp_phone_number_id and site.whatsapp_token),
            "whatsapp_number": p.whatsapp_number if p else "", "auto_notify": bool(p and p.auto_notify),
            "min_grade": p.min_grade if p else "A", "models": p.models_csv if p else "", "symbols": p.symbols_csv if p else "",
            "bias_only": p.bias_only if p else True,
            # chart alerts from the server (terminal closed too)
            "chart_alerts_on": bool(site.chart_alerts_enabled),
            "chart_alerts": p.chart_alerts if p else True, "whatsapp_chart": p.whatsapp_chart if p else True,
            "telegram_available": bool(site.telegram_bot_token and site.telegram_bot_username),
            "telegram_connected": bool(p and p.telegram_chat_id), "telegram_signals": p.telegram_signals if p else True,
            "email_available": bool(site.email_alerts_enabled), "email_alerts": bool(p and p.email_alerts),
            "webhook_url": p.webhook_url if p else "",
            "invert_signals": bool(p and p.invert_signals),
            "channels": channels(p, site) if p else []}


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
    for f in ("chart_alerts", "whatsapp_chart", "telegram_signals", "email_alerts", "invert_signals"):
        if f in data:
            setattr(p, f, bool(data.get(f)))
    if data.get("telegram_disconnect"):
        p.telegram_chat_id = ""
    if "webhook_url" in data:
        url = str(data.get("webhook_url") or "").strip()[:300]
        if url and not public_https(url):
            raise ValueError("The webhook must be a public https:// address.")
        p.webhook_url = url
    if p.auto_notify and not p.whatsapp_number:
        raise ValueError("Add your WhatsApp number first.")
    p.save()
    return p


# ---- chart alerts (price, line, zone, session, ICT events) checked by the ICT API server -----------
# The API watches every user's alerts even when the terminal is closed and asks this panel to deliver
# them (internal/alerts/send). Channels: WhatsApp (template with 1 variable), Telegram bot, email, webhook.
TELEGRAM = "https://api.telegram.org"
MAX_CHART_ALERTS_PER_HOUR = 60


class ChannelError(Exception):
    pass


def send_whatsapp_text(number: str, text: str, site: SiteSettings, http=requests) -> str:
    """The chart alert template (1 variable = the alert text)."""
    if not (site.whatsapp_phone_number_id and site.whatsapp_token):
        raise WhatsAppError("WhatsApp is not set up in the admin panel yet.")
    body = {"messaging_product": "whatsapp", "to": number, "type": "template",
            "template": {"name": site.whatsapp_alert_template or "ict_alert", "language": {"code": site.whatsapp_template_lang or "en"},
                         "components": [{"type": "body", "parameters": [{"type": "text", "text": text[:900]}]}]}}
    try:
        r = http.post(f"{GRAPH}/{site.whatsapp_phone_number_id}/messages", json=body, timeout=15,
                      headers={"Authorization": f"Bearer {site.whatsapp_token}"})
        data = r.json() if r.content else {}
    except (requests.RequestException, ValueError) as e:
        raise WhatsAppError(f"WhatsApp could not be reached: {e.__class__.__name__}") from None
    if r.status_code >= 400:
        raise WhatsAppError(str((data.get("error") or {}).get("message") or f"HTTP {r.status_code}")[:280])
    return str(((data.get("messages") or [{}])[0]).get("id", ""))


def send_telegram(chat_id: str, text: str, site: SiteSettings, http=requests) -> None:
    if not site.telegram_bot_token:
        raise ChannelError("Telegram is not set up in the admin panel yet.")
    try:
        r = http.post(f"{TELEGRAM}/bot{site.telegram_bot_token}/sendMessage", timeout=15,
                      json={"chat_id": chat_id, "text": text[:4000], "disable_web_page_preview": True})
        data = r.json() if r.content else {}
    except (requests.RequestException, ValueError) as e:
        raise ChannelError(f"Telegram could not be reached: {e.__class__.__name__}") from None
    if r.status_code >= 400 or not data.get("ok", False):
        raise ChannelError(str(data.get("description") or f"HTTP {r.status_code}")[:280])


def send_email(to: str, text: str) -> None:
    from django.core.mail import send_mail
    try:
        send_mail("ICT Terminal alert", text + "\n\nManage your alerts in the terminal: Alerts tab, Send alerts to my phone.",
                  None, [to], fail_silently=False)
    except Exception as e:  # noqa: BLE001 - SMTP errors of every kind
        raise ChannelError(f"Email failed: {e.__class__.__name__}") from None


def public_https(url: str) -> bool:
    """Webhooks only go to https addresses on the public internet (never this server or a LAN)."""
    import ipaddress
    import socket
    from urllib.parse import urlparse
    u = urlparse(url or "")
    if u.scheme != "https" or not u.hostname:
        return False
    try:
        infos = socket.getaddrinfo(u.hostname, u.port or 443, proto=socket.IPPROTO_TCP)
    except (OSError, ValueError):
        return False
    return bool(infos) and all(ipaddress.ip_address(i[4][0]).is_global for i in infos)


def send_webhook(url: str, payload: dict, http=requests) -> None:
    if not public_https(url):
        raise ChannelError("The webhook must be a public https:// address.")
    try:
        r = http.post(url, json=payload, timeout=10, allow_redirects=False)
    except requests.RequestException as e:
        raise ChannelError(f"Webhook could not be reached: {e.__class__.__name__}") from None
    if r.status_code >= 400:
        raise ChannelError(f"Webhook answered HTTP {r.status_code}")


def channels(p: AlertPrefs | None, site: SiteSettings) -> list[str]:
    """The channels a user's chart alerts go to right now."""
    if p is None or not p.chart_alerts:
        return []
    out = []
    if p.whatsapp_chart and p.whatsapp_number and site.whatsapp_alerts_enabled and site.whatsapp_token:
        out.append("whatsapp")
    if p.telegram_chat_id and site.telegram_bot_token:
        out.append("telegram")
    if p.email_alerts and site.email_alerts_enabled and p.user.email:
        out.append("email")
    if p.webhook_url:
        out.append("webhook")
    return out


def chart_alert_users() -> list[dict]:
    """Users whose chart alerts the API server should watch: an active plan and at least one channel."""
    from .services import access_payload
    site = SiteSettings.load()
    if not site.chart_alerts_enabled:
        return []
    out = []
    for p in AlertPrefs.objects.select_related("user").filter(chart_alerts=True, user__is_active=True):
        ch = channels(p, site)
        if not ch:
            continue
        acc = access_payload(p.user)
        if not acc.get("is_vip"):
            continue
        out.append({"email": p.user.email, "features": acc.get("features") or {}, "channels": ch})
    return out


def deliver_chart_alert(email: str, key: str, text: str, payload: dict | None = None, http=requests, log=print) -> list[str]:
    """Sends one chart alert to every channel of the user, once per (key, channel). Returns the channels sent."""
    from django.contrib.auth import get_user_model
    site = SiteSettings.load()
    user = get_user_model().objects.filter(email__iexact=email, is_active=True).first()
    p = AlertPrefs.objects.select_related("user").filter(user=user).first() if user else None
    if p is None or not site.chart_alerts_enabled:
        return []
    hour_ago = timezone.now() - timedelta(hours=1)
    recent = AlertDelivery.objects.filter(user=user, signal_key__startswith="chart|", created_at__gte=hour_ago)
    if recent.values("signal_key").distinct().count() >= MAX_CHART_ALERTS_PER_HOUR:
        return []                                  # a runaway alert must never flood a phone
    text = text.strip()[:900]
    sent = []
    for ch in channels(p, site):
        try:
            with transaction.atomic():
                d = AlertDelivery.objects.create(user=user, signal_key=key[:160], channel=ch, text=text[:400])
        except IntegrityError:
            continue                               # already sent on this channel
        try:
            if ch == "whatsapp":
                send_whatsapp_text(p.whatsapp_number, text, site, http=http)
            elif ch == "telegram":
                send_telegram(p.telegram_chat_id, "⏰ " + text, site, http=http)
            elif ch == "email":
                send_email(user.email, text)
            elif ch == "webhook":
                send_webhook(p.webhook_url, {"source": "ICT Terminal", "text": text, **(payload or {})}, http=http)
            d.ok = True
            sent.append(ch)
        except (WhatsAppError, ChannelError) as e:
            d.error = str(e)[:300]
            log(f"{ch} to user {user.pk}: {e}")
        d.save(update_fields=["ok", "error"])
    return sent


# ---- Telegram: connect a user's chat to the bot -------------------------------------------------
def telegram_link(user) -> dict:
    """A t.me link with a one-time code; the user presses Start and poll_telegram() saves the chat id."""
    import secrets
    site = SiteSettings.load()
    if not (site.telegram_bot_token and site.telegram_bot_username):
        raise ValueError("Telegram alerts are not switched on by the admin yet.")
    p, _ = AlertPrefs.objects.get_or_create(user=user)
    p.telegram_code = secrets.token_hex(6)
    p.save(update_fields=["telegram_code", "updated_at"])
    return {"url": f"https://t.me/{site.telegram_bot_username.lstrip('@')}?start={p.telegram_code}", "code": p.telegram_code}


_tg_offset = {"v": 0}


def poll_telegram(http=requests, log=print) -> int:
    """Reads the bot's new messages; '/start <code>' connects that chat to the user with the code."""
    site = SiteSettings.load()
    if not site.telegram_bot_token:
        return 0
    try:
        r = http.get(f"{TELEGRAM}/bot{site.telegram_bot_token}/getUpdates", timeout=20,
                     params={"offset": _tg_offset["v"], "timeout": 0, "allowed_updates": json.dumps(["message"])})
        data = r.json()
    except (requests.RequestException, ValueError) as e:
        log(f"telegram: {e.__class__.__name__}")
        return 0
    linked = 0
    for u in data.get("result") or []:
        _tg_offset["v"] = max(_tg_offset["v"], int(u.get("update_id", 0)) + 1)
        msg = u.get("message") or {}
        text, chat = str(msg.get("text") or ""), (msg.get("chat") or {}).get("id")
        m = re.fullmatch(r"/start\s+([0-9a-f]{12})", text.strip())
        if not (m and chat):
            continue
        p = AlertPrefs.objects.filter(telegram_code=m.group(1)).first()
        if p is None:
            continue
        p.telegram_chat_id, p.telegram_code = str(chat), ""
        p.save(update_fields=["telegram_chat_id", "telegram_code", "updated_at"])
        linked += 1
        try:
            send_telegram(str(chat), "✅ ICT Terminal is connected. Your alerts will arrive here.", site, http=http)
        except ChannelError:
            pass
    return linked
