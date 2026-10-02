"""Google / Facebook sign-in for the mobile app, the Windows app and the web terminal.

The app (or terminal) makes a secret session id, opens
    PUBLIC_API_URL/api/v1/oauth/<provider>/start?session=...&device_id=...&platform=...
in the phone's / PC's normal browser (Google refuses sign-in inside embedded windows) and
polls oauth/poll with the same session id. The browser goes through Google / Facebook,
comes back to oauth/<provider>/callback, and the customer confirms "continue on <device>"
(so a login link sent by someone else can't hand them the session). The account is then
created or found, the free-trial rules run and a login token bound to that device is
handed to the waiting app once.
"""
import hashlib
import hmac
import html
import json
import logging
import secrets
from datetime import timedelta
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from django.conf import settings
from django.http import HttpResponse, HttpResponseRedirect
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from . import services
from .models import OAuthLogin, SiteSettings

log = logging.getLogger("accounts")
TIMEOUT = 10
FB_VERSION = "v19.0"


# ── providers ────────────────────────────────────────────────────────────────
def configured(provider):
    site = SiteSettings.load()
    if provider == "google":
        return site.allow_google_login and bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET)
    if provider == "facebook":
        return site.allow_facebook_login and bool(settings.FACEBOOK_APP_ID and settings.FACEBOOK_APP_SECRET)
    return False


def redirect_uri(provider):
    return f"{settings.PUBLIC_API_URL}/api/v1/oauth/{provider}/callback"


def auth_url(provider, state):
    if provider == "google":
        return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode({
            "client_id": settings.GOOGLE_CLIENT_ID, "redirect_uri": redirect_uri(provider),
            "response_type": "code", "scope": "openid email profile", "state": state,
            "prompt": "select_account"})
    return f"https://www.facebook.com/{FB_VERSION}/dialog/oauth?" + urlencode({
        "client_id": settings.FACEBOOK_APP_ID, "redirect_uri": redirect_uri(provider),
        "state": state, "scope": "public_profile,email", "response_type": "code"})


def _get_json(url, data=None):
    body = urlencode(data).encode() if data is not None else None
    req = Request(url, data=body, headers={"Accept": "application/json", "User-Agent": "ICC-Terminal"})
    with urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode())


def fetch_identity(provider, code):
    """Returns {"uid", "email", "name"} for the signed-in person. The code is exchanged
    server-to-server with our client secret, so the answer comes straight from Google / Meta."""
    if provider == "google":
        tokens = _get_json("https://oauth2.googleapis.com/token", {
            "code": code, "client_id": settings.GOOGLE_CLIENT_ID, "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "redirect_uri": redirect_uri(provider), "grant_type": "authorization_code"})
        info = _get_json("https://openidconnect.googleapis.com/v1/userinfo?"
                         + urlencode({"access_token": tokens["access_token"]}))
        email = info.get("email", "") if info.get("email_verified") else ""
        return {"uid": str(info["sub"]), "email": email.lower(), "name": info.get("name", "")}
    tokens = _get_json(f"https://graph.facebook.com/{FB_VERSION}/oauth/access_token?" + urlencode({
        "client_id": settings.FACEBOOK_APP_ID, "client_secret": settings.FACEBOOK_APP_SECRET,
        "redirect_uri": redirect_uri(provider), "code": code}))
    access = tokens["access_token"]
    proof = hmac.new(settings.FACEBOOK_APP_SECRET.encode(), access.encode(), hashlib.sha256).hexdigest()
    info = _get_json(f"https://graph.facebook.com/{FB_VERSION}/me?" + urlencode({
        "fields": "id,name,email", "access_token": access, "appsecret_proof": proof}))
    return {"uid": str(info["id"]), "email": (info.get("email") or "").lower(), "name": info.get("name", "")}


# ── pages shown in the browser ───────────────────────────────────────────────
PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>ICT Terminal</title>
<style>body{{margin:0;background:#0B0E14;color:#ECEFF1;font-family:Segoe UI,Roboto,Arial,sans-serif;
display:flex;min-height:100vh;align-items:center;justify-content:center}}
.card{{max-width:420px;margin:16px;padding:28px 24px;background:#12161F;border:1px solid #1E2638;border-radius:14px;
text-align:center}}h2{{color:#F5A623;margin:8px 0 12px}}p{{color:#B0BEC5;line-height:1.5}}
.btn{{display:block;margin:12px 0 0;padding:13px;border-radius:9px;font-weight:700;text-decoration:none;border:0;
width:100%;font-size:15px;cursor:pointer}}.go{{background:#F5A623;color:#111}}.wa{{background:#25D366;color:#fff}}
.mail{{background:#1E2638;color:#ECEFF1}}small{{color:#78909C}}</style></head>
<body><div class="card"><div style="font-size:40px">{icon}</div><h2>{title}</h2>{body}</div></body></html>"""


def page(icon, title, body, status=200):
    return HttpResponse(PAGE.format(icon=icon, title=html.escape(title), body=body), status=status)


def contact_html(problem):
    text = f"Assalam o Alaikum, I need help with ICT Terminal login. {problem}"
    wa = services.whatsapp_link(text)
    mail = f"mailto:{settings.SUPPORT_EMAIL}?subject=ICC%20Terminal%20login"
    return (f'<a class="btn wa" href="{html.escape(wa)}">💬 WhatsApp admin</a>'
            f'<a class="btn mail" href="{html.escape(mail)}">✉️ Email admin</a>')


def error_page(message, status=400):
    return page("⚠️", "Login not possible", f"<p>{html.escape(message)}</p>{contact_html(message)}", status)


# ── views ────────────────────────────────────────────────────────────────────
def start(request, provider):
    """Opened in the browser by the app / terminal."""
    if provider not in ("google", "facebook") or not configured(provider):
        return error_page("This login method is not available right now.", 404)
    q = request.GET
    session = q.get("session", "")
    if len(session) < 24 or len(session) > 128:
        return error_page("This login link is incomplete. Please start again from the ICT Terminal app.")
    session_hash = hashlib.sha256(session.encode()).hexdigest()
    if OAuthLogin.objects.filter(session_hash=session_hash).exists():
        return error_page("This login link was already used. Please start again from the app.")
    OAuthLogin.objects.filter(created_at__lt=timezone.now() - timedelta(hours=1)).delete()
    login = OAuthLogin.objects.create(
        session_hash=session_hash, state=secrets.token_urlsafe(24), provider=provider,
        device_id=q.get("device_id", "")[:128], device_name=q.get("device_name", "")[:120],
        platform=q.get("platform", "").lower()[:12], legacy_id=q.get("legacy_id", "")[:128],
        ip=services.request_ip(request))
    return HttpResponseRedirect(auth_url(provider, login.state))


def callback(request, provider):
    login = OAuthLogin.objects.filter(state=request.GET.get("state", ""), provider=provider).first()
    if login is None or login.status != "pending" or login.expired:
        return error_page("This login has expired. Please start again from the ICT Terminal app.")
    if request.GET.get("error") or not request.GET.get("code"):
        login.status, login.result = "error", json.dumps({"detail": "Login was cancelled."})
        login.save(update_fields=["status", "result"])
        return error_page("Login was cancelled. Go back to ICT Terminal and try again.")
    try:
        ident = fetch_identity(provider, request.GET["code"])
    except (URLError, KeyError, ValueError) as e:
        log.warning("%s login failed: %s", provider, e)
        return error_page(f"{provider.title()} did not confirm the login. Please try again.")
    login.uid, login.email, login.name = ident["uid"], ident["email"], ident["name"][:150]
    login.status, login.confirm_key = "verified", secrets.token_urlsafe(24)
    login.save()
    who = html.escape(login.email or login.name or "your account")
    device = html.escape(login.device_name or services.KIND_LABELS.get(services.device_kind(login.platform), "device"))
    return page("🔐", "Continue to ICT Terminal?", (
        f"<p>Log in as <b>{who}</b> on <b>{device}</b>?</p>"
        f'<form method="post" action="{settings.PUBLIC_API_URL}/api/v1/oauth/finish">'
        f'<input type="hidden" name="key" value="{login.confirm_key}">'
        '<button class="btn go" type="submit">Continue</button></form>'
        "<p><small>Only continue if you started this login yourself in the ICT Terminal app.</small></p>"))


@csrf_exempt
def finish(request):
    if request.method != "POST":
        return error_page("Please start the login from the ICT Terminal app.", 405)
    login = OAuthLogin.objects.filter(confirm_key=request.POST.get("key", "") or "-", status="verified").first()
    if login is None or login.expired:
        return error_page("This login has expired. Please start again from the ICT Terminal app.")
    result, problem = services.social_sign_in(login)
    login.confirm_key = ""
    if problem:
        login.status, login.result = "error", json.dumps({"detail": problem})
        login.save()
        return error_page(problem, 403)
    login.status, login.result = "done", json.dumps(result)
    login.save()
    note = result.get("trial_message") or result.get("warning") or ""
    return page("✅", "You are logged in", (
        "<p>Go back to the <b>ICT Terminal</b> app or tab — it opens in a moment.</p>"
        + (f"<p>{html.escape(note)}</p>" if note else "") + "<p><small>You can close this page.</small></p>"))


@csrf_exempt
def poll(request):
    """The waiting app asks: {"session": "..."} -> pending / done (token, once) / error."""
    if request.method != "POST":
        return services.json_error("Method not allowed.", 405)
    try:
        session = str(json.loads(request.body or b"{}").get("session", ""))
    except ValueError:
        session = ""
    login = OAuthLogin.objects.filter(session_hash=hashlib.sha256(session.encode()).hexdigest()).first()
    if login is None:
        return services.json_ok(status="pending")      # the browser has not opened the link yet
    if login.expired and login.status != "done":
        login.delete()
        return services.json_ok(status="error", detail="Login timed out. Please try again.",
                                support=services.support_info())
    if login.status == "done":
        data = json.loads(login.result or "{}")
        login.delete()                                  # the token is handed out exactly once
        return services.json_ok(status="done", **data)
    if login.status == "error":
        data = json.loads(login.result or "{}")
        login.delete()
        return services.json_ok(status="error", detail=data.get("detail", "Login failed."),
                                support=services.support_info())
    return services.json_ok(status="pending")
