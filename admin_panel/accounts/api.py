"""JSON API used by api_server.py (which the Flutter app and desktop dashboard talk to).
All endpoints live under /api/v1/. Customers sign in with an account (email + password);
access comes from the plans / subscriptions on that account.

Public:     health, plans, auth/register, auth/login,
            auth/password/reset, auth/password/reset/confirm
Bearer:     auth/me, auth/logout, auth/password/change
Internal:   internal/verify (needs X-Service-Key = INTERNAL_API_SECRET)
"""
import hmac
import json
import logging

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, password_validation
from django.contrib.auth.tokens import default_token_generator
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.core.validators import validate_email
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django.views.decorators.csrf import csrf_exempt

from . import community, crypto, services
from .models import ApiToken, CustomerProfile, Device, PaymentMethod, Plan, SiteSettings

log = logging.getLogger("accounts")
User = get_user_model()

MAX_ATTEMPTS = 10          # failed logins ...
ATTEMPT_WINDOW = 15 * 60   # ... per 15 minutes, per email and per IP


# ── helpers ──────────────────────────────────────────────────────────────────
def error(message, status=400, **extra):
    return JsonResponse({"success": False, "detail": message, **extra}, status=status)


def ok(**data):
    return JsonResponse({"success": True, **data})


def body(request):
    try:
        data = json.loads(request.body or b"{}")
        return data if isinstance(data, dict) else {}
    except (ValueError, UnicodeDecodeError):
        return {}


def is_internal(request):
    secret = settings.INTERNAL_API_SECRET
    given = request.headers.get("X-Service-Key", "")
    return bool(secret) and hmac.compare_digest(secret, given)


def client_ip(request):
    # api_server forwards the phone/PC address; only trusted together with the service key
    return services.request_ip(request)


def bearer(request):
    header = request.headers.get("Authorization", "")
    return header[7:].strip() if header.lower().startswith("bearer ") else ""


def device_info(data, request):
    """Who is calling: device id, name, platform and (app update) the device's previous id."""
    return {
        "device_id": str(data.get("device_id") or request.headers.get("X-Device-Id", ""))[:128],
        "device_name": str(data.get("device_name") or request.headers.get("X-Device-Name", ""))[:120],
        "platform": str(data.get("platform") or request.headers.get("X-Device-Platform", "")).lower()[:12],
        "legacy_id": str(data.get("legacy_id") or request.headers.get("X-Device-Legacy-Id", ""))[:128],
    }


issue_token = services.issue_token


def rate_limited(*keys):
    return any(cache.get(f"attempts:{k}", 0) >= MAX_ATTEMPTS for k in keys if k)


def count_failure(*keys):
    for k in keys:
        if not k:
            continue
        name = f"attempts:{k}"
        cache.add(name, 0, ATTEMPT_WINDOW)
        try:
            cache.incr(name)
        except ValueError:
            cache.set(name, 1, ATTEMPT_WINDOW)


def clear_failures(*keys):
    for k in keys:
        if k:
            cache.delete(f"attempts:{k}")


def method(*allowed):
    def wrap(view):
        @csrf_exempt
        def inner(request, *args, **kwargs):
            if request.method not in allowed:
                return error(f"Method {request.method} not allowed.", 405)
            return view(request, *args, **kwargs)
        inner.__name__ = view.__name__
        return inner
    return wrap


def token_required(view):
    def inner(request, *args, **kwargs):
        token = services.resolve_token(bearer(request))
        if token is None:
            return error("Please log in again.", 401)
        request.api_token = token
        return view(request, *args, **kwargs)
    inner.__name__ = view.__name__
    return inner


def session_payload(token, raw, access):
    return {
        "token": raw,
        "token_expires_at": token.expires_at.isoformat(),
        "account": {"email": token.user.email, "name": token.user.get_full_name()},
        "access": access,
    }


# ── public ───────────────────────────────────────────────────────────────────
@method("GET")
def health(request):
    return ok(service="admin_panel", signup_open=SiteSettings.load().allow_signup)


@method("GET")
def app_config(request):
    """Public settings the app and dashboard need (broker partner button, support)."""
    site = SiteSettings.load()
    return ok(
        broker={"name": site.broker_name, "partner_link": site.partner_link,
                "button_text": site.partner_button_text},
        support={"whatsapp": settings.SUPPORT_WHATSAPP, "email": settings.SUPPORT_EMAIL},
        copy_trading_enabled=site.copy_trading_enabled,
        login=services.login_methods(),
        min_app_version=site.min_app_version.strip(),
        features={"backtest_enabled": site.backtest_enabled},
        community={"enabled": site.community_enabled},
    )


@method("GET")
def plans(request):
    rows = Plan.objects.filter(is_active=True, is_public=True)
    return ok(plans=[{
        "name": p.name, "slug": p.slug, "description": p.description,
        "price": str(p.price), "currency": p.currency, "duration": p.duration_label,
        "duration_days": p.duration_days, "is_vip": p.is_vip,
        "max_devices": 0 if 0 in p.device_limits.values() else sum(p.device_limits.values()),
        "device_limits": p.device_limits,
        "features": services.features_of_plan(p),
    } for p in rows], support={"whatsapp": settings.SUPPORT_WHATSAPP, "email": settings.SUPPORT_EMAIL})


@method("POST")
def register(request):
    if not SiteSettings.load().allow_signup:
        return error("Create your account with Google or Facebook in the latest ICT Terminal app.", 403,
                     code="email_signup_disabled", support=services.support_info())
    data = body(request)
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    name = str(data.get("name", "")).strip()[:150]
    ip = client_ip(request)
    if rate_limited(f"ip:{ip}"):
        return error("Too many attempts. Try again in 15 minutes.", 429)
    if not services.signup_allowed_from_ip(ip):
        return error("Too many new accounts were created from your network. Try again later.", 429,
                     support=services.support_info())

    dev = device_info(data, request)

    def rejected(message, status=400):
        # Failed sign-ups show up under Login events, so support can see why an account wasn't created
        services.record_login("register", email, False, message, ip=ip,
                              device_id=dev["device_id"], platform=dev["platform"])
        return error(message, status)

    try:
        validate_email(email)
    except ValidationError:
        return rejected("Enter a valid email address.")
    if User.objects.filter(username__iexact=email).exists() or User.objects.filter(email__iexact=email).exists():
        count_failure(f"ip:{ip}")
        return rejected("An account with this email already exists. Log in instead.", 409)

    first, _, last = name.partition(" ")
    candidate = User(username=email, email=email, first_name=first[:150], last_name=last[:150])
    try:
        password_validation.validate_password(password, candidate)
    except ValidationError as e:
        return rejected(" ".join(e.messages))

    with transaction.atomic():
        candidate.set_password(password)
        candidate.save()
        CustomerProfile.objects.create(user=candidate, phone=str(data.get("phone", ""))[:30])
    services.count_signup(ip)
    trial_message = services.maybe_grant_trial(candidate, dev, "email", ip)   # plans switched on for email sign-up

    token, raw = issue_token(candidate, dev)
    access, _ = services.access_for_token(token, ip=ip, **dev)
    services.record_login("register", email, True, user=candidate, ip=ip,
                          device_id=dev["device_id"], platform=dev["platform"])
    return ok(**session_payload(token, raw, access), **({"trial_message": trial_message} if trial_message else {}))


@method("POST")
def guest(request):
    """"Continue as guest" (web terminal): a login for this browser without email or password.
    Features come from Settings > Guest features; the same browser always gets the same guest account."""
    site = SiteSettings.load()
    if not site.guest_login_enabled or site.guest_plan_id is None:
        return error("Guest access is switched off. Please log in or create an account.", 403, code="guest_disabled")
    data = body(request)
    dev = device_info(data, request)
    ip = client_ip(request)
    if not dev["device_id"]:
        return error("This browser could not be identified. Please reload the page.")
    if rate_limited(f"guest:{ip}"):
        return error("Too many attempts. Try again in 15 minutes.", 429)
    user, created = services.guest_user_for(dev["device_id"])
    if created:
        count_failure(f"guest:{ip}")   # new guest accounts per network are capped like failed logins
    if not user.is_active:
        return error("Guest access for this browser was blocked. Please create an account.", 403)
    token, raw = issue_token(user, dev)
    access, _ = services.access_for_token(token, ip=ip, **dev)
    services.record_login("guest", user.username, True, user=user, ip=ip,
                          device_id=dev["device_id"], platform=dev["platform"])
    return ok(**session_payload(token, raw, access))


@method("POST")
def login(request):
    data = body(request)
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    ip = client_ip(request)
    dev = device_info(data, request)
    if not SiteSettings.load().allow_email_login:
        return error("Email login has been replaced. Please update the ICT Terminal app and continue with "
                     "Google or Facebook (use the same email to keep your plan).", 403,
                     code="email_login_disabled", support=services.support_info())
    if not email or not password:
        return error("Email and password are required.")
    if rate_limited(f"login:{email}", f"ip:{ip}"):
        return error("Too many failed attempts. Try again in 15 minutes.", 429)

    user = authenticate(request, username=email, password=password)
    if user is None:
        # Accounts created in the admin may use a username that isn't the email
        match = User.objects.filter(email__iexact=email).first()
        if match:
            user = authenticate(request, username=match.username, password=password)
    if user is None:
        count_failure(f"login:{email}", f"ip:{ip}")
        services.record_login("password", email, False, "wrong credentials", ip=ip,
                              device_id=dev["device_id"], platform=dev["platform"])
        return error("Wrong email or password.", 401)

    clear_failures(f"login:{email}")
    token, raw = issue_token(user, dev)
    access, device_error = services.access_for_token(token, ip=ip, **dev)
    services.record_login("password", email, True, device_error, user=user, ip=ip,
                          device_id=dev["device_id"], platform=dev["platform"])
    return ok(**session_payload(token, raw, access), warning=device_error)


@method("POST")
def password_reset(request):
    data = body(request)
    email = str(data.get("email", "")).strip().lower()
    ip = client_ip(request)
    if rate_limited(f"reset:{ip}"):
        return error("Too many requests. Try again in 15 minutes.", 429)
    count_failure(f"reset:{ip}")  # every request counts, successful or not
    user = User.objects.filter(email__iexact=email, is_active=True).first()
    if user:
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        code = default_token_generator.make_token(user)
        send_mail(
            "ICT Terminal password reset",
            "Use this code in the app to set a new password.\n\n"
            f"Reset code: {uid}.{code}\n\nIf you didn't ask for this, ignore this email.",
            settings.DEFAULT_FROM_EMAIL, [user.email], fail_silently=True,
        )
    # Same answer either way so the endpoint can't be used to find registered emails
    return ok(message="If that email has an account, a reset code has been sent.")


@method("POST")
def password_reset_confirm(request):
    data = body(request)
    raw_code = str(data.get("code", "")).strip()
    new_password = str(data.get("new_password", ""))
    uid_b64, _, code = raw_code.partition(".")
    try:
        user = User.objects.get(pk=force_str(urlsafe_base64_decode(uid_b64)))
    except (ValueError, TypeError, OverflowError, User.DoesNotExist):
        user = None
    if user is None or not default_token_generator.check_token(user, code):
        return error("This reset code is invalid or has expired.")
    try:
        password_validation.validate_password(new_password, user)
    except ValidationError as e:
        return error(" ".join(e.messages))
    user.set_password(new_password)
    user.save(update_fields=["password"])
    user.api_tokens.filter(revoked=False).update(revoked=True)  # sign out everywhere
    return ok(message="Password changed. Log in with your new password.")


# ── logged in ────────────────────────────────────────────────────────────────
@method("GET")
@token_required
def me(request):
    token = request.api_token
    dev = device_info({}, request)
    access, device_error = services.access_for_token(token, ip=client_ip(request), **dev)
    if access.get("status") == "session_mismatch":
        return error(device_error, 401)
    subs = token.user.subscriptions.select_related("plan").order_by("-created_at")
    return ok(
        account={"email": token.user.email, "name": token.user.get_full_name(),
                 "joined": token.user.date_joined.date().isoformat(),
                 "has_password": token.user.has_usable_password(),
                 "logins": sorted(token.user.social_accounts.values_list("provider", flat=True))},
        access=access, warning=device_error,
        subscriptions=[{
            "plan": s.plan.name, "state": s.state_label,
            "starts": s.starts_at.date().isoformat(),
            "expires": s.expires_at.date().isoformat() if s.expires_at else "Lifetime",
            "days_left": s.days_left,
        } for s in subs],
        devices=services.devices_payload(token.user, token.device_id or dev["device_id"]),
    )


@method("POST")
@token_required
def logout(request):
    token = request.api_token
    token.revoked = True
    token.save(update_fields=["revoked"])
    # Free the device slot (blocked devices stay blocked)
    if token.device_id:
        Device.objects.filter(user=token.user, device_id=token.device_id, is_blocked=False).delete()
    return ok(message="Logged out.")


@method("POST")
@token_required
def password_change(request):
    data = body(request)
    user = request.api_token.user
    if not user.check_password(str(data.get("old_password", ""))):
        return error("Current password is wrong.", 400)
    new_password = str(data.get("new_password", ""))
    try:
        password_validation.validate_password(new_password, user)
    except ValidationError as e:
        return error(" ".join(e.messages))
    user.set_password(new_password)
    user.save(update_fields=["password"])
    # Keep this session, sign out the others
    user.api_tokens.filter(revoked=False).exclude(pk=request.api_token.pk).update(revoked=True)
    return ok(message="Password updated.")


def copy_status(user, access):
    conn = services.ea_connection_for(user)
    return {
        **services.copy_settings_payload(conn, access),
        "has_token": bool(conn.token_hash),
        "token_prefix": conn.token_prefix,
        "ea_online": conn.online,
        "last_seen": conn.last_seen.isoformat() if conn.last_seen else None,
        "mt5_login": conn.mt5_login, "mt5_server": conn.mt5_server,
        "balance": float(conn.balance) if conn.balance is not None else None,
        "currency": conn.currency, "open_copies": conn.open_copies, "ea_version": conn.ea_version,
    }


@method("GET", "POST")
@token_required
def copy_settings(request):
    """GET: the customer's copy trading status. POST {copy_enabled, multiplier, filters}: change it."""
    user = request.api_token.user
    access, _ = services.access_for_token(request.api_token, ip=client_ip(request), **device_info({}, request))
    if request.method == "POST":
        data = body(request)
        conn = services.ea_connection_for(user)
        if "copy_enabled" in data:
            conn.copy_enabled = bool(data["copy_enabled"])
        if "multiplier" in data:
            try:
                mult = round(float(data["multiplier"]), 2)
            except (TypeError, ValueError):
                return error("Multiplier must be a number.")
            if not 0.1 <= mult <= 10:
                return error("Multiplier must be between 0.1 and 10.")
            conn.multiplier = mult
        if "filters" in data:
            filters, err = services.clean_ea_filters(data["filters"])
            if err:
                return error(err)
            conn.filters = filters
        conn.save()
    return ok(copy=copy_status(user, access))


@method("POST")
@token_required
def copy_token(request):
    """Creates a new EA token (the old one stops working). The raw token is only returned now."""
    user = request.api_token.user
    conn = services.ea_connection_for(user)
    raw = conn.new_token()
    conn.save()
    access, _ = services.access_for_token(request.api_token, ip=client_ip(request), **device_info({}, request))
    return ok(ea_token=raw, copy=copy_status(user, access),
              message="Copy this token into the ICC Copier EA settings. It is shown only once.")


# ── payments ─────────────────────────────────────────────────────────────────
@method("GET")
def payment_methods(request):
    """Public: where to send money, plus the support WhatsApp (app, desktop, website)."""
    return ok(methods=[m.as_dict() for m in PaymentMethod.objects.filter(is_active=True, for_plans=True)],
              support={"whatsapp": settings.SUPPORT_WHATSAPP, "email": settings.SUPPORT_EMAIL})


@method("GET")
def donations_info(request):
    """Public: is the Donate window on, its text, suggested amounts and where to send."""
    return ok(**services.donation_info())


@method("POST")
def donation_submit(request):
    """Anyone (logged in or not) reports a donation: {amount, method, reference, name, email, message, public}."""
    from django.core.cache import cache
    ip = client_ip(request) or "?"
    key = f"donate-{ip}"
    if cache.get(key, 0) >= 5:
        return error("Too many reports from here. Please try again in an hour.", 429)
    token = services.resolve_token(bearer(request))
    d, problem = services.submit_donation(body(request), user=token.user if token else None,
                                          source=str(body(request).get("source", ""))[:12])
    if problem:
        return error(problem)
    cache.set(key, cache.get(key, 0) + 1, 3600)
    return ok(id=d.pk, message="Thank you! We will confirm it as soon as it arrives.")


@method("POST")
@token_required
def payment_submit(request):
    """Customer: "I have paid". {plan, method, reference, note, source} -> pending payment
    in the admin panel + a WhatsApp link with the details for the customer to send."""
    data = body(request)
    payment, problem = services.submit_payment(
        request.api_token.user, data.get("plan"), data.get("method"), data.get("reference"),
        note=data.get("note", ""), source=str(data.get("source") or request.api_token.platform or "app"),
        local_amount=data.get("local_amount", ""))
    if problem:
        return error(problem)
    return ok(payment=services.payment_dict(payment),
              whatsapp_url=services.whatsapp_link(services.payment_message(payment)),
              message="Payment sent for approval. Your plan starts as soon as it is confirmed.")


@method("GET")
@token_required
def payments_mine(request):
    rows = (request.api_token.user.payments.select_related("plan", "payment_method")
            .order_by("-created_at")[:20])
    return ok(payments=[services.payment_dict(p) for p in rows])


# ── crypto (automatic, verified on the blockchain) ──────────────────────────
@method("GET")
def crypto_networks(request):
    """Public: which crypto networks are on (addresses are only shown inside an order)."""
    return ok(networks=crypto.active_networks(), minutes=crypto.ORDER_MINUTES)


def _own_order(request, order_id):
    return request.api_token.user.crypto_orders.select_related("plan").filter(pk=order_id).first()


@method("POST")
@token_required
def crypto_order_create(request):
    """{plan, network, source} -> order with the exact amount and address to pay."""
    user = request.api_token.user
    if rate_limited(f"crypto:{user.pk}"):
        return error("Too many payment attempts. Try again in 15 minutes.", 429)
    data = body(request)
    order, problem, code = crypto.create_order(user, data.get("plan"), data.get("network"),
                                               source=str(data.get("source") or request.api_token.platform or "app"))
    if code == "open_order":           # another payment is open: the app offers "continue" or "cancel"
        return error(problem, 409, code="open_order", order=crypto.order_dict(order))
    if problem:
        return error(problem)
    if code == "created":
        count_failure(f"crypto:{user.pk}")  # every new order counts: max 10 per 15 minutes
    return ok(order=crypto.order_dict(order), resumed=code == "resumed")


@method("GET")
@token_required
def crypto_order_open(request):
    """The customer's open crypto payment (or null), shown before they pick a network."""
    order = crypto.open_order(request.api_token.user)
    return ok(order=crypto.order_dict(order) if order else None)


@method("POST")
@token_required
def crypto_order_cancel(request, order_id):
    order = _own_order(request, order_id)
    if order is None:
        return error("Order not found.", 404)
    order, problem = crypto.cancel_order(order)
    if problem:
        return error(problem, 409, order=crypto.order_dict(order))
    return ok(order=crypto.order_dict(order))


@method("GET")
@token_required
def crypto_order_status(request, order_id):
    order = _own_order(request, order_id)
    if order is None:
        return error("Order not found.", 404)
    order = crypto.check_order(order)
    return ok(order=crypto.order_dict(order), access=services.access_payload(order.user) if order.status == "paid" else None)


@method("POST")
@token_required
def crypto_order_txid(request, order_id):
    order = _own_order(request, order_id)
    if order is None:
        return error("Order not found.", 404)
    order, problem = crypto.submit_txid(order, body(request).get("txid"))
    if problem:
        return error(problem, order=crypto.order_dict(order))
    return ok(order=crypto.order_dict(order))


# ── crypto donations (no account needed; the order key lets the donor follow it) ─────────
def _donation_order(request, order_id):
    from .models import CryptoOrder
    key = str(request.GET.get("key") or body(request).get("key") or "")
    o = CryptoOrder.objects.select_related("donation").filter(pk=order_id, kind="donation").first()
    return o if o and key and hmac.compare_digest(o.key, key) else None


@method("POST")
def donation_crypto(request):
    """{amount (USD), network, name, email, message, public, source} -> a crypto order to pay."""
    ip = client_ip(request) or "?"
    if rate_limited(f"dcrypto:{ip}"):
        return error("Too many attempts. Try again in 15 minutes.", 429)
    token = services.resolve_token(bearer(request))
    data = body(request)
    order, problem = crypto.create_donation_order(token.user if token else None, data.get("amount"), data.get("network"),
                                                  data, source=str(data.get("source") or "web"))
    if problem:
        return error(problem)
    count_failure(f"dcrypto:{ip}")          # max 10 new orders per 15 minutes from one address
    return ok(order={**crypto.order_dict(order), "key": order.key})


@method("GET")
def donation_crypto_status(request, order_id):
    order = _donation_order(request, order_id)
    if order is None:
        return error("Order not found.", 404)
    return ok(order=crypto.order_dict(crypto.check_order(order)))


@method("POST")
def donation_crypto_txid(request, order_id):
    order = _donation_order(request, order_id)
    if order is None:
        return error("Order not found.", 404)
    order, problem = crypto.submit_txid(order, body(request).get("txid"))
    if problem:
        return error(problem, order=crypto.order_dict(order))
    return ok(order=crypto.order_dict(order))


# ── community chat (nickname only; accounts only) ───────────────────────────
def _community(call):
    try:
        return ok(**call())
    except community.CommunityError as e:
        return error(str(e), e.status, code=e.code)


@method("GET")
@token_required
def community_status(request):
    return _community(lambda: community.status(request.api_token.user))


@method("POST")
@token_required
def community_join(request):
    data = body(request)
    return _community(lambda: {"profile": {"nickname": community.join(
        request.api_token.user, data.get("nickname"), bool(data.get("accept_rules"))).nickname}})


@method("GET", "POST")
@token_required
def community_messages(request):
    user = request.api_token.user
    if request.method == "POST":
        data = body(request)
        return _community(lambda: {"message": community.post(user, str(data.get("room") or "general"),
                                                               str(data.get("text") or ""))})
    q = request.GET

    def num(key):
        v = q.get(key, "0")
        return int(v) if v.isdigit() else 0
    return _community(lambda: {"messages": community.messages(user, q.get("room", "general"), num("after_id"),
                                                               num("before_id"))})


@method("POST")
@token_required
def community_report(request, message_id):
    return _community(lambda: community.report(request.api_token.user, message_id, body(request).get("reason", "")))


# ── ads (Ad manager) ─────────────────────────────────────────────────────────
@method("GET")
def ads(request):
    """Running ads for ?placement=app_banner|web_banner|app_popup, only for users who get ads
    (no plan / free or trial plan). The login token is optional (guests see ads too)."""
    token = services.resolve_token(bearer(request))
    return ok(ads=services.ads_for(token.user if token else None, request.GET.get("placement", ""),
                                   settings.PUBLIC_API_URL))


@method("GET")
def ad_click(request, ad_id):
    """Counts the click, then sends the browser to the advertiser's page."""
    from django.db.models import F
    from django.http import HttpResponseRedirect

    from .models import Ad
    ad = Ad.objects.filter(pk=ad_id).first()
    if ad is None or not ad.link.startswith(("https://", "http://")):
        return error("Ad not found.", 404)
    if ad.running:
        Ad.objects.filter(pk=ad.pk).update(clicks=F("clicks") + 1)
    return HttpResponseRedirect(ad.link)


@method("GET")
def ad_image(request, ad_id):
    import mimetypes

    from django.http import FileResponse

    from .models import Ad
    ad = Ad.objects.filter(pk=ad_id).first()
    if ad is None or not ad.image:
        return error("Image not found.", 404)
    try:
        f = ad.image.open("rb")
    except (FileNotFoundError, OSError):
        return error("Image not found.", 404)
    response = FileResponse(f, content_type=mimetypes.guess_type(ad.image.name)[0] or "image/png")
    response["Cache-Control"] = "public, max-age=3600"
    return response


# ── internal (api_server.py) ─────────────────────────────────────────────────
@method("GET")
def internal_site(request):
    """Settings api_server needs (which master EA magic numbers are published)."""
    if not is_internal(request):
        return error("Forbidden.", 403)
    site = SiteSettings.load()
    return ok(copy_trading_enabled=site.copy_trading_enabled, copy_magic_numbers=site.magic_list,
              copy_lot_per_1000=float(site.copy_lot_per_1000), features=services.site_features(site))


@method("POST")
def internal_ea(request):
    """The copier EA's check-in: identifies the customer by EA token, records the EA's
    status and returns their access plus what copying is allowed right now."""
    if not is_internal(request):
        return error("Forbidden.", 403)
    data = body(request)
    conn = services.resolve_ea_token(str(data.get("ea_token", "")))
    if conn is None:
        return ok(valid=False, reason="Invalid EA token. Generate a new one in the app or dashboard.",
                  access=services.access_payload(None), copy=None)
    if data.get("checkin", True) is False:
        # e.g. the ICC Daily EA asking for its plan: identify only, don't overwrite the copier's status
        access = services.access_payload(conn.user)
        copy = services.copy_settings_payload(conn, access)
        return ok(valid=True, reason="", access=access, copy=copy)
    conn.last_seen = timezone.now()
    conn.mt5_login = str(data.get("mt5_login", ""))[:40]
    conn.mt5_server = str(data.get("mt5_server", ""))[:80]
    conn.currency = str(data.get("currency", ""))[:8]
    conn.ea_version = str(data.get("ea_version", ""))[:20]
    try:
        conn.balance = round(float(data.get("balance")), 2)
    except (TypeError, ValueError):
        pass
    try:
        conn.open_copies = max(0, int(data.get("open_copies", 0)))
    except (TypeError, ValueError):
        pass
    conn.save()
    access = services.access_payload(conn.user)
    copy = services.copy_settings_payload(conn, access)
    return ok(valid=copy["active"], reason=copy["reason"], access=access, copy=copy)



@method("POST")
def internal_ai(request):
    """The AI settings the chart assistant needs: the site's provider / model / key and, for the given
    user, their own key when they turned it on."""
    if not is_internal(request):
        return error("Forbidden.", 403)
    from django.contrib.auth import get_user_model
    from .models import AIPrefs
    site = SiteSettings.load()
    out = {"site": None, "user": None}
    if site.ai_provider != "none" and site.ai_api_key:
        out["site"] = {"provider": site.ai_provider, "model": site.ai_model, "api_key": site.ai_api_key}
    email = str(body(request).get("email", "")).strip()
    if email:
        u = get_user_model().objects.filter(email__iexact=email).first()
        p = AIPrefs.objects.filter(user=u, enabled=True).exclude(api_key="").first() if u else None
        if p:
            out["user"] = {"provider": p.provider, "model": p.model, "api_key": p.api_key}
    return ok(**out)


@method("POST")
def internal_alert_users(request):
    """The users whose chart alerts the API server watches (active plan + a delivery channel)."""
    if not is_internal(request):
        return error("Forbidden.", 403)
    from . import alerts
    return ok(users=alerts.chart_alert_users())


@method("POST")
def internal_alert_send(request):
    """Delivers one chart alert the API server found to the user's channels (once per key and channel)."""
    if not is_internal(request):
        return error("Forbidden.", 403)
    from . import alerts
    data = body(request)
    email, key, text = str(data.get("email", "")), str(data.get("key", "")), str(data.get("text", ""))
    if not (email and key.startswith("chart|") and text):
        return error("email, key (chart|...) and text are needed.")
    payload = data.get("payload") if isinstance(data.get("payload"), dict) else None
    return ok(sent=alerts.deliver_chart_alert(email, key, text, payload))


@method("POST")
def internal_verify(request):
    """Checks a login token on api_server requests (api_server caches the answer)."""
    if not is_internal(request):
        return error("Forbidden.", 403)
    data = body(request)
    raw_token = str(data.get("token", "")).strip()
    if not raw_token:
        return ok(valid=False, reason="", access=services.access_payload(None))
    token = services.resolve_token(raw_token)
    if token is None:
        return ok(valid=False, reason="Session expired. Please log in again.", access=services.access_payload(None))
    access, device_error = services.access_for_token(token, ip=client_ip(request), **device_info(data, request))
    return ok(valid=access["is_vip"], reason=device_error, access=access,
              logout=access.get("status") == "session_mismatch")


# ── community ideas (reading is open to everyone; posting needs an account and a nickname) ───────
def _viewer(request):
    token = services.resolve_token(bearer(request))
    return token.user if token else None


@method("GET", "POST")
def community_ideas(request):
    if request.method == "POST":
        token = services.resolve_token(bearer(request))
        if token is None:
            return error("Please log in to share an idea.", 401)
        return _community(lambda: {"idea": community.post_idea(token.user, body(request))})
    q = request.GET
    page = q.get("page", "1")
    return _community(lambda: community.ideas(_viewer(request), q.get("symbol", "")[:30], q.get("sort", "new"),
                                              int(page) if page.isdigit() else 1, q.get("mine") == "1"))


@method("GET")
def community_idea(request, idea_id):
    return _community(lambda: {"idea": community.idea(_viewer(request), idea_id)})


@method("POST")
@token_required
def community_idea_like(request, idea_id):
    return _community(lambda: community.like_idea(request.api_token.user, idea_id))


@method("POST")
@token_required
def community_idea_comment(request, idea_id):
    return _community(lambda: {"comment": community.comment_idea(request.api_token.user, idea_id,
                                                                  str(body(request).get("text") or ""))})


@method("POST")
@token_required
def community_idea_delete(request, idea_id):
    return _community(lambda: community.delete_idea(request.api_token.user, idea_id))


@method("POST")
@token_required
def community_idea_report(request, idea_id):
    return _community(lambda: community.report_idea(request.api_token.user, idea_id))


# ── signal alerts (WhatsApp) ────────────────────────────────────────────────
@method("GET", "POST")
@token_required
def alert_settings(request):
    from . import alerts
    from .models import AlertPrefs
    user = request.api_token.user
    if request.method == "POST":
        try:
            p = alerts.save_prefs(user, body(request))
        except ValueError as e:
            return error(str(e))
        return ok(settings=alerts.prefs_dict(p))
    return ok(settings=alerts.prefs_dict(AlertPrefs.objects.filter(user=user).first()))


@method("GET", "POST")
@token_required
def ai_settings(request):
    """The user's own AI key for the chart assistant. The key itself is never sent back."""
    from .models import AI_PROVIDERS, AIPrefs
    user = request.api_token.user
    p = AIPrefs.objects.filter(user=user).first()
    if request.method == "POST":
        data = body(request)
        p = p or AIPrefs(user=user)
        provider = str(data.get("provider", p.provider))
        if provider not in {k for k, _ in AI_PROVIDERS} or provider == "none":
            return error("Choose a provider.")
        p.provider = provider
        p.model = str(data.get("model", p.model) or "").strip()[:80]
        if "api_key" in data:
            key = str(data.get("api_key") or "").strip()
            if key and (len(key) < 12 or len(key) > 300 or any(c.isspace() for c in key)):
                return error("That does not look like an API key.")
            p.api_key = key
        p.enabled = bool(data.get("enabled", p.enabled)) and bool(p.api_key)
        p.save()
    return ok(settings={"enabled": bool(p and p.enabled), "provider": p.provider if p else "anthropic",
                        "model": p.model if p else "", "has_key": bool(p and p.api_key),
                        "providers": [{"id": k, "name": n} for k, n in AI_PROVIDERS if k != "none"]})


@method("POST")
@token_required
def alert_telegram(request):
    """A t.me link that connects the user's Telegram chat to the alerts bot."""
    from . import alerts
    try:
        return ok(**alerts.telegram_link(request.api_token.user))
    except ValueError as e:
        return error(str(e))


@method("POST")
@token_required
def alert_test(request):
    """Sends a sample alert to the user's number (at most one a minute)."""
    from django.core.cache import cache

    from . import alerts
    from .models import AlertPrefs
    p = AlertPrefs.objects.filter(user=request.api_token.user).first()
    if body(request).get("channel") == "chart":
        # a test chart alert to every channel the user turned on
        if p is None or not alerts.channels(p, SiteSettings.load()):
            return error("Turn on at least one channel first (WhatsApp, Telegram, email or webhook).")
        key = f"alert-test-chart-{p.user_id}"
        if cache.get(key):
            return error("Wait a minute before the next test message.", 429)
        cache.set(key, 1, 60)
        sent = alerts.deliver_chart_alert(p.user.email, f"chart|test|{int(timezone.now().timestamp())}",
                                          "Test alert: XAUUSD crossed 4000.00. Your chart alerts arrive like this.")
        if not sent:
            return error("Nothing could be sent. Check the channel settings.", 502)
        return ok(sent=sent)
    if p is None or not p.whatsapp_number:
        return error("Save your WhatsApp number first.")
    key = f"alert-test-{p.user_id}"
    if cache.get(key):
        return error("Wait a minute before the next test message.", 429)
    cache.set(key, 1, 60)
    try:
        alerts.send_template(p.whatsapp_number, ["XAUUSD", "TEST", "BUY", "A", "1.00", "0.90", "1.10 / 1.20", "test message"])
    except alerts.WhatsAppError as e:
        return error(str(e), 502)
    return ok(sent=True)
