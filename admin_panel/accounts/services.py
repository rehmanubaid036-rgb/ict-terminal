"""Account, subscription, device and token logic shared by the API views and the admin."""
import hmac
import logging
from datetime import timedelta
from types import SimpleNamespace
from urllib.parse import quote

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import transaction
from django.db.models import Q
from django.http import JsonResponse
from django.utils import timezone

from .models import (DEVICE_KINDS, ApiToken, CustomerProfile, Device, DeviceClaim, LoginEvent, Payment,
                     PaymentMethod, Plan, SiteSettings, SocialAccount, Subscription, TrialGrant, device_kind)

log = logging.getLogger("accounts")

GUEST_ACCESS = {
    "user": "Guest_Trader",
    "email": "",
    "plan": "Free Guest Tier",
    "plans": [],
    "expiry": "Standard",
    "is_vip": False,
    "status": "guest",
    "days_left": None,
    "device_limit": None,
    "device_limits": None,
    "features": {"signals": False, "signal_delay_minutes": None, "models": [], "ict_indicators": False,
                 "max_charts": 1, "trades": False, "auto_trade": False, "max_mt_accounts": 0,
                 "ai_messages_per_day": 0, "alerts_limit": 0, "backtest": False},
}


def site_features(site=None):
    """Global switches for the API and the apps (users without a plan follow the *_free ticks)."""
    site = site or SiteSettings.load()
    return {"backtest_enabled": site.backtest_enabled, "backtest_free": site.backtest_free,
            "time_offset_hours": site.mt5_time_offset_hours, "symbol_map": site.broker_symbol_map}


def _limit(values):
    """Combine per-plan limits where 0 means unlimited: unlimited wins, else the largest."""
    values = list(values)
    if not values:
        return 0
    return 0 if 0 in values else max(values)


def plan_features(subs):
    """ICT Terminal features granted by a set of active subscriptions (combined across plans)."""
    vip = [s for s in subs if s.plan.is_vip]
    signal_plans = [s.plan for s in subs if s.plan.can_view_signals]
    models = set()
    all_models = False
    for p in signal_plans:
        ids = p.model_ids
        if ids is None:
            all_models = True
        else:
            models.update(ids)
    return {
        "signals": bool(signal_plans),
        "signal_delay_minutes": min(p.signal_delay_minutes for p in signal_plans) if signal_plans else None,
        "models": "all" if all_models else sorted(models),
        "ict_indicators": any(s.plan.ict_indicators for s in subs),
        "max_charts": max(s.plan.max_charts for s in subs),
        "trades": any(s.plan.can_view_trades for s in vip),
        "auto_trade": any(s.plan.can_auto_trade for s in vip),
        "max_mt_accounts": _limit(s.plan.max_mt_accounts for s in vip if s.plan.can_auto_trade),
        "ai_messages_per_day": max(s.plan.ai_messages_per_day for s in subs),
        "alerts_limit": _limit(s.plan.alerts_limit for s in subs),
        "backtest": any(s.plan.can_use_backtest for s in subs),
    }

def features_of_plan(plan):
    """What one plan gives on its own (shown on the website's pricing cards)."""
    return plan_features([SimpleNamespace(plan=plan)])


VALID_PLATFORMS = {choice for choice, _ in Device.PLATFORM_CHOICES}
KIND_LABELS = dict(DEVICE_KINDS)
SESSION_MISMATCH = "This login belongs to another device. Please log in again."
NO_DEVICE_ID = "This app version is too old for your account. Please update ICT Terminal."


def active_subscriptions(user):
    """All currently valid subscriptions of an account."""
    now = timezone.now()
    return list(Subscription.objects.select_related("plan")
                .filter(user=user, status=Subscription.STATUS_ACTIVE, starts_at__lte=now, plan__is_active=True)
                .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))
                .order_by("plan__sort_order"))


def latest_subscription(user):
    """Most recent subscription even if expired, so the user can see why VIP is off."""
    return Subscription.objects.select_related("plan").filter(user=user).order_by("-expires_at").first()


def device_limits_for(subs):
    """Most generous limit per device type across the active plans; 0 = unlimited. None = no plan."""
    if not subs:
        return None
    limits = {}
    for kind, _ in DEVICE_KINDS:
        values = [s.device_limits[kind] for s in subs]
        limits[kind] = 0 if 0 in values else max(values)
    return limits


def device_limit_for(subs):
    """Total devices (all types together), for older app versions that show one number."""
    limits = device_limits_for(subs)
    if limits is None:
        return None
    return 0 if 0 in limits.values() else sum(limits.values())


def access_payload(user):
    """What the dashboard, app and api_server get back. user/plan/expiry/is_vip keep the
    shape the dashboard and app already use; features are combined across all active plans."""
    if user is None:
        return dict(GUEST_ACCESS)
    if is_guest_user(user):
        return guest_payload(user)
    name = user.get_full_name() or user.email or user.username
    subs = active_subscriptions(user)
    if not subs:
        lapsed = latest_subscription(user)
        payload = dict(GUEST_ACCESS)
        payload.update({
            "user": name, "email": user.email, "staff": user.is_staff,
            "plan": lapsed.plan.name if lapsed else "No active plan",
            "status": lapsed.state_label.lower() if lapsed else "no_plan",
            "expiry": lapsed.expires_at.date().isoformat() if lapsed and lapsed.expires_at else "-",
        })
        return payload

    vip_subs = [s for s in subs if s.plan.is_vip]
    lifetime = any(s.expires_at is None for s in subs)
    last_expiry = None if lifetime else max(s.expires_at for s in subs)
    return {
        "user": name,
        "email": user.email,
        "staff": user.is_staff,
        "plan": " + ".join(s.plan.name for s in subs),
        "plans": [{"name": s.plan.name,
                   "expires": s.expires_at.date().isoformat() if s.expires_at else "Lifetime",
                   "days_left": s.days_left} for s in subs],
        "expiry": "Lifetime" if lifetime else last_expiry.date().isoformat(),
        "is_vip": bool(vip_subs),
        "status": "active",
        "days_left": None if lifetime else max(0, (last_expiry - timezone.now()).days),
        "device_limit": device_limit_for(subs),
        "device_limits": device_limits_for(subs),
        "features": plan_features(subs),
    }


def is_guest_user(user):
    profile = getattr(user, "profile", None) if user is not None else None
    return bool(profile and profile.is_guest)


def guest_payload(user):
    """Access of a "Continue as guest" account: the features of Settings > Guest features (a plan),
    or locked when guest login is off or no plan is chosen. ``user`` is the guest's own username,
    so saved layouts stay separate per browser."""
    site = SiteSettings.load()
    plan = site.guest_plan if site.guest_login_enabled else None
    payload = dict(GUEST_ACCESS)
    payload.update({"user": user.username, "email": "", "staff": False, "guest": True})
    if plan is None or not plan.is_active:
        payload.update({"plan": "Guest", "status": "guest_disabled", "expiry": "-"})
        return payload
    payload.update({
        "plan": "Guest", "plans": [{"name": "Guest", "expires": "Lifetime", "days_left": None}],
        "expiry": "Lifetime", "is_vip": False, "status": "active", "days_left": None,
        "device_limit": None, "device_limits": None, "features": features_of_plan(plan),
    })
    return payload


GUEST_PREFIX = "guest-"


def guest_user_for(device_id):
    """The guest account of one browser (created on its first "Continue as guest")."""
    from django.contrib.auth.hashers import make_password
    User = get_user_model()
    key = hmac.new(settings.SECRET_KEY.encode(), device_id.encode(), "sha256").hexdigest()[:16]
    username = GUEST_PREFIX + key
    user = User.objects.filter(username=username).first()
    if user is not None:
        return user, False
    with transaction.atomic():
        user = User.objects.create(username=username, email="", first_name="Guest", password=make_password(None))
        CustomerProfile.objects.create(user=user, is_guest=True, notes="Created by Continue as guest (web terminal).")
    return user, True


def idle_hours():
    return SiteSettings.load().device_idle_hours


def release_device(device, reason, ip=None):
    """Frees a device slot: logs that device out everywhere and removes it."""
    ApiToken.objects.filter(user=device.user, device_id=device.device_id, revoked=False).update(revoked=True)
    record_login("device", device.user.email, True, f"{reason}: {device.name or device.device_id}",
                 user=device.user, ip=ip, device_id=device.device_id, platform=device.platform)
    device.delete()


def register_device(user, device_id, name="", platform="", ip=None, legacy_id=""):
    """Records the device on the account and enforces the plan's limit for its type
    (mobile app / Windows app / web terminal). Returns an error string, or "" when allowed.

    Over the limit, the oldest device of the same type that has been unused for
    SiteSettings.device_idle_hours is logged out and replaced; otherwise the customer
    must log out on the old device first."""
    device_id = (device_id or "").strip()[:128]
    if not device_id:
        return NO_DEVICE_ID
    platform = platform if platform in VALID_PLATFORMS else "other"
    kind = device_kind(platform)
    now = timezone.now()

    device = user.devices.filter(device_id=device_id).first()
    if device is None and legacy_id:
        # Same phone, new app version with a stable id: keep its slot instead of taking another
        old = user.devices.filter(device_id=legacy_id[:128]).first()
        if old is not None and old.kind == kind:
            ApiToken.objects.filter(user=user, device_id=old.device_id).update(device_id=device_id)
            if not DeviceClaim.objects.filter(device_id=device_id).exists():
                DeviceClaim.objects.filter(device_id=old.device_id).update(device_id=device_id)
            old.device_id = device_id
            old.save(update_fields=["device_id"])
            device = old
    if device:
        if device.is_blocked:
            return "This device has been blocked for your account. Contact support."
        device.last_seen = now
        device.last_ip = ip
        fields = ["last_seen", "last_ip"]
        if name and device.name != name[:120]:
            device.name = name[:120]
            fields.append("name")
        if device.kind != kind and platform != "other":
            device.kind, device.platform = kind, platform
            fields += ["kind", "platform"]
        device.save(update_fields=fields)
        return ""

    limits = device_limits_for(active_subscriptions(user)) or {}
    limit = limits.get(kind, 0)
    if limit:
        in_use = user.devices.filter(kind=kind, is_blocked=False).order_by("last_seen")
        if in_use.count() >= limit:
            hours = idle_hours()
            idle = in_use.filter(last_seen__lt=now - timedelta(hours=hours)).first() if hours else None
            if idle is None:
                others = ", ".join(d.name or d.get_platform_display() for d in in_use[:3])
                message = (f"Device limit reached. Your plan allows {limit} {KIND_LABELS[kind].lower()} device(s) and it is in use "
                           f"on: {others}. Log out on that device first"
                           + (f", or try again when it has been unused for {hours} hours." if hours else "."))
                record_login("device", user.email, False, "blocked: " + message, user=user, ip=ip,
                             device_id=device_id, platform=platform)
                return message
            release_device(idle, f"replaced by {name or platform} (unused {hours}h+)", ip=ip)
    Device.objects.create(user=user, device_id=device_id, name=name[:120], platform=platform, kind=kind,
                          last_seen=now, last_ip=ip)
    return ""


def resolve_token(raw):
    """Returns the ApiToken for a raw bearer token, or None."""
    raw = (raw or "").strip()
    if not raw:
        return None
    token = ApiToken.objects.select_related("user").filter(key_hash=ApiToken.hash(raw)).first()
    if token is None or not token.is_valid:
        return None
    # Avoid a write on every request: refresh last_used at most once a minute
    now = timezone.now()
    if token.last_used_at is None or (now - token.last_used_at).total_seconds() > 60:
        token.last_used_at = now
        token.save(update_fields=["last_used_at"])
    return token


def token_matches_device(token, device_id="", platform="", legacy_id=""):
    """A login token only works on the device (and type of client) that signed in with it,
    so a copied token or cookie is useless elsewhere. Moves the token to the phone's new
    stable id when the app reports its old one (legacy_id)."""
    if token.device_id and device_id and device_id != token.device_id:
        if legacy_id and legacy_id == token.device_id:
            token.device_id = device_id[:128]
            token.save(update_fields=["device_id"])
        else:
            return False
    if token.platform and platform and device_kind(token.platform) != device_kind(platform):
        return False
    return True


def access_for_token(token, device_id="", device_name="", platform="", ip=None, legacy_id=""):
    """Access payload for a logged-in account. Returns (payload, error).
    payload["status"] == "session_mismatch" means the token must be dropped (log in again)."""
    user = token.user
    if not token_matches_device(token, device_id, platform, legacy_id):
        record_login("device", user.email, False, "login token used on another device", user=user, ip=ip,
                     device_id=device_id, platform=platform)
        locked = access_payload(None)
        locked["status"] = "session_mismatch"
        return locked, SESSION_MISMATCH
    payload = access_payload(user)
    if not payload["is_vip"]:
        return payload, ""
    error = register_device(user, device_id or token.device_id, device_name or token.device_name,
                            platform or token.platform, ip, legacy_id=legacy_id)
    if error:
        # Over the device limit: the account works, but VIP stays locked on this device
        locked = access_payload(None)
        locked.update({"user": payload["user"], "email": payload["email"], "plan": payload["plan"],
                       "status": "device_limit", "device_limits": payload["device_limits"]})
        return locked, error
    return payload, ""


def devices_payload(user, current_device_id=""):
    """The customer's own devices, for "My devices" in the app and terminals."""
    subs = active_subscriptions(user)
    rows = user.devices.filter(is_blocked=False).order_by("kind", "-last_seen")
    return {
        "used": rows.count(),
        "limit": device_limit_for(subs),
        "limits": device_limits_for(subs) or {},
        "idle_hours": idle_hours(),
        "list": [{"name": d.name or d.get_platform_display(), "type": d.kind, "type_label": d.get_kind_display(),
                  "platform": d.platform, "last_seen": d.last_seen.isoformat(),
                  "this_device": bool(current_device_id) and d.device_id == current_device_id} for d in rows],
    }


def ea_connection_for(user):
    from .models import EaConnection
    conn, _ = EaConnection.objects.get_or_create(user=user)
    return conn


def resolve_ea_token(raw):
    """Returns the EaConnection for a copier EA's token, or None."""
    from .models import EaConnection
    raw = (raw or "").strip()
    if not raw:
        return None
    conn = EaConnection.objects.select_related("user").filter(token_hash=ApiToken.hash(raw)).first()
    if conn is None or not conn.user.is_active:
        return None
    return conn


def copy_settings_payload(conn, access):
    """What the copier EA is allowed to do right now."""
    site = SiteSettings.load()
    reasons = []
    features = access.get("features", {})
    if not site.copy_trading_enabled:
        reasons.append("Auto-trading is paused by the admin.")
    if conn.blocked:
        reasons.append("Auto-trading is blocked for this account. Contact support.")
    if not access.get("is_vip") or not features.get("auto_trade", False):
        reasons.append("Auto-trading needs an active plan with auto-trading (VIP).")
    if not conn.copy_enabled:
        reasons.append("Auto-trading is switched OFF in your terminal / app.")
    plan_models = features.get("models") or []
    models = [m for m in site.approved_models if plan_models == "all" or m in plan_models]
    if not reasons and not models:
        reasons.append("No model is approved for auto-trading yet. Signals are shown in the terminal only.")
    return {
        "active": not reasons,
        "reason": reasons[0] if reasons else "",
        "models": models,
        "max_mt_accounts": features.get("max_mt_accounts", 0),
        "copy_enabled": conn.copy_enabled,
        "multiplier": float(conn.multiplier),
        "lot_per_1000": float(site.copy_lot_per_1000),
        "magic_numbers": site.magic_list,
    }


def assign_signup_plans(user):
    """Gives a new account the plans chosen under Registration settings."""
    created = []
    for plan in SiteSettings.load().signup_plans.filter(is_active=True):
        created.append(Subscription.objects.create(
            user=user, plan=plan, notes="Assigned automatically at registration."))
    return created


def record_login(method, identifier, success, reason="", user=None, ip=None, device_id="", platform=""):
    try:
        LoginEvent.objects.create(method=method, identifier=identifier[:160], success=success, reason=reason[:200],
                                  user=user, ip=ip, device_id=(device_id or "")[:128], platform=(platform or "")[:12])
    except Exception:  # auditing must never break a login
        log.exception("Could not record login event")


# ── Payments ─────────────────────────────────────────────────────────────────
MAX_PENDING_PAYMENTS = 5   # open (unapproved) payments one account may have


def apply_payment(payment):
    """Marks a payment paid and gives the customer its plan: extends their current
    subscription of that plan, or creates one. Runs once per payment (applied flag).
    Returns the subscription, or None when there was nothing to apply."""
    with transaction.atomic():
        payment = Payment.objects.select_for_update().get(pk=payment.pk)
        payment.status = "paid"
        payment.paid_at = payment.paid_at or timezone.now()
        sub = None
        if not payment.applied:
            sub = payment.subscription
            if sub is None and payment.plan_id and payment.user_id:
                sub = (Subscription.objects.filter(user_id=payment.user_id, plan_id=payment.plan_id)
                       .order_by("-expires_at").first())
                if sub is None:
                    sub = Subscription.objects.create(
                        user_id=payment.user_id, plan_id=payment.plan_id,
                        notes=f"Created from payment #{payment.pk}.")
                    payment.applied = True   # a new subscription already starts with the plan's duration
                payment.subscription = sub
            if sub is not None and not payment.applied:
                if sub.plan.duration_days:
                    sub.extend(sub.plan.duration_days)
                elif sub.status != Subscription.STATUS_ACTIVE:
                    sub.status = Subscription.STATUS_ACTIVE      # lifetime plan: just (re)activate
                sub.save()
                payment.applied = True
        payment.save()
    return sub


def whatsapp_link(text):
    number = "".join(ch for ch in settings.SUPPORT_WHATSAPP if ch.isdigit())
    return f"https://wa.me/{number}?text={quote(text)}"


def payment_message(payment):
    user = payment.user
    lines = [
        "Assalam o Alaikum! I have paid for ICT Terminal.",
        f"Payment #{payment.pk}",
        f"Plan: {payment.plan.name if payment.plan else '-'} ({payment.amount} {payment.currency}"
        + (f", {payment.local_amount}" if getattr(payment, "local_amount", "") else "") + ")",
        f"Paid to: {payment.payment_method.name if payment.payment_method else payment.get_method_display()}",
        f"Transaction ID: {payment.reference or '-'}",
        f"Account: {user.email if user else '-'}",
    ]
    if payment.notes:
        lines.append(f"Note: {payment.notes}")
    lines.append("Screenshot of the payment is attached.")
    return "\n".join(lines)


def submit_payment(user, plan_slug, method_id, reference, note="", source="app", local_amount=""):
    """Customer says "I have paid". Returns (payment, error_message)."""
    plan = Plan.objects.filter(slug=str(plan_slug), is_active=True, is_public=True).first()
    if plan is None:
        return None, "Please choose a plan."
    try:
        method = PaymentMethod.objects.filter(pk=int(method_id), is_active=True).first()
    except (TypeError, ValueError):
        method = None
    if method is None:
        return None, "Please choose where you sent the money."
    reference = str(reference or "").strip()
    if len(reference) < 4:
        return None, "Please enter the transaction ID / reference from your payment."
    if Payment.objects.filter(user=user, status="pending").count() >= MAX_PENDING_PAYMENTS:
        return None, "You already have payments waiting for approval. Please wait or contact support."
    if Payment.objects.filter(user=user, reference__iexact=reference[:120]).exclude(status="failed").exists():
        return None, "This transaction ID was already submitted."
    payment = Payment.objects.create(
        user=user, plan=plan, payment_method=method, amount=plan.price, currency=plan.currency,
        method=PaymentMethod.PAYMENT_METHOD_FOR_KIND.get(method.kind, "other"),
        reference=reference[:120], notes=str(note or "").strip()[:500], status="pending",
        local_amount=str(local_amount or "").strip()[:40],
        source=source if source in dict(Payment.SOURCE_CHOICES) else "app")
    log.info("Payment #%s submitted by %s: %s %s via %s", payment.pk, user.email, payment.amount,
             payment.currency, method.name)
    return payment, ""


def payment_dict(payment):
    return {
        "id": payment.pk, "plan": payment.plan.name if payment.plan else "",
        "amount": str(payment.amount), "currency": payment.currency, "local_amount": payment.local_amount,
        "paid_to": payment.payment_method.name if payment.payment_method else payment.get_method_display(),
        "reference": payment.reference, "status": payment.status, "status_label": payment.get_status_display(),
        "created_at": payment.created_at.isoformat(),
    }


# ── Google / Facebook sign-in, account creation limits, automatic free trial ────
def json_ok(**data):
    return JsonResponse({"success": True, **data})


def json_error(message, status=400, **extra):
    return JsonResponse({"success": False, "detail": message, **extra}, status=status)


def support_info():
    return {"whatsapp": settings.SUPPORT_WHATSAPP, "email": settings.SUPPORT_EMAIL,
            "whatsapp_url": whatsapp_link("Assalam o Alaikum, I need help with my ICT Terminal account.")}


def is_internal(request):
    secret = settings.INTERNAL_API_SECRET
    return bool(secret) and hmac.compare_digest(secret, request.headers.get("X-Service-Key", ""))


def request_ip(request):
    """The customer's address. api_server sends it in X-Client-IP (it reads Cloudflare's
    CF-Connecting-IP); only trusted together with the service key."""
    forwarded = request.headers.get("X-Client-IP", "")
    if forwarded and is_internal(request):
        return forwarded.split(",")[0].strip() or None
    return request.META.get("REMOTE_ADDR")


def mask_email(email):
    name, _, domain = (email or "").partition("@")
    if not domain:
        return "another account"
    return f"{name[:2]}***@{domain}"


def issue_token(user, dev):
    """New login session for this device; earlier sessions of the same device are closed,
    so one device never holds several live logins."""
    ids = {dev.get("device_id", ""), dev.get("legacy_id", "")} - {""}
    if ids:
        user.api_tokens.filter(revoked=False, device_id__in=ids).update(revoked=True)
    return ApiToken.issue(user, device_id=dev.get("device_id", ""), device_name=dev.get("device_name", ""),
                          platform=dev.get("platform", ""))


def signup_allowed_from_ip(ip):
    """At most SiteSettings.signups_per_ip_hour new accounts per address per hour."""
    limit = SiteSettings.load().signups_per_ip_hour
    if not limit or not ip:
        return True
    return cache.get(f"signups:{ip}", 0) < limit


def count_signup(ip):
    if not ip:
        return
    key = f"signups:{ip}"
    cache.add(key, 0, 3600)
    try:
        cache.incr(key)
    except ValueError:
        cache.set(key, 1, 3600)


def device_claim(device_id, legacy_id=""):
    ids = [i for i in (device_id, legacy_id) if i]
    return DeviceClaim.objects.select_related("user").filter(device_id__in=ids).first() if ids else None


def maybe_grant_trial(user, dev, provider="", ip=None):
    """Automatic free trial: once per account and once per phone / PC, only in the mobile
    or Windows app (browser ids are too easy to reset). Returns a message for the customer."""
    site = SiteSettings.load()
    if not site.trial_enabled or TrialGrant.objects.filter(user=user).exists():
        return ""
    if user.subscriptions.exists():          # already a customer: no trial needed
        return ""
    kind = device_kind(dev.get("platform", ""))
    # One trial per Google / Facebook account everywhere (web too, so it starts at once);
    # phones and PCs (stable ids) additionally give only one trial per device.
    claim = device_claim(dev.get("device_id", ""), dev.get("legacy_id", "")) if kind != "web" else None
    if claim and (claim.trial_used or (claim.user_id and claim.user_id != user.pk)):
        record_login("trial", user.email, False, f"trial already used on {dev['device_id']}", user=user, ip=ip,
                     device_id=dev["device_id"], platform=dev.get("platform", ""))
        return "The free trial was already used on this device. Choose a plan to continue with VIP."
    plans = assign_signup_plans(user)
    if not plans:
        return ""
    TrialGrant.objects.create(user=user, device_id=dev.get("device_id", ""), provider=provider, ip=ip)
    if kind == "web" or not dev.get("device_id"):
        pass                                   # browser ids are not stable: no device lock
    elif claim is None:
        DeviceClaim.objects.create(device_id=dev["device_id"], kind=kind, name=dev.get("device_name", "")[:120],
                                   user=user, trial_used=True, ip=ip)
    else:
        claim.trial_used = True
        claim.user = claim.user or user
        claim.save(update_fields=["trial_used", "user"])
    record_login("trial", user.email, True, f"{plans[0].plan.name} started", user=user, ip=ip,
                 device_id=dev.get("device_id", ""), platform=dev.get("platform", ""))
    return f"Your free {plans[0].plan.name} has started. Enjoy!"


def social_sign_in(login):
    """Finishes a Google / Facebook login (accounts.oauth). Finds the account (or links the
    one with the same email, so old customers keep their plans), or creates it within the
    device / network limits. Returns (session dict for the app, error message)."""
    User = get_user_model()
    provider, ip = login.provider, login.ip
    dev = {"device_id": login.device_id, "device_name": login.device_name, "platform": login.platform,
           "legacy_id": login.legacy_id}
    kind = device_kind(login.platform)
    social = SocialAccount.objects.select_related("user").filter(provider=provider, uid=login.uid).first()
    user = social.user if social else None
    if user is None and login.email:
        user = User.objects.filter(email__iexact=login.email).order_by("date_joined").first()
    if user is None:
        claim = device_claim(login.device_id, login.legacy_id) if kind != "web" else None
        if claim and claim.user_id:
            claim.blocked_attempts += 1
            claim.save(update_fields=["blocked_attempts"])
            record_login("signup", login.email or login.uid, False,
                         f"device already has account {claim.user.email if claim.user else ''}", ip=ip,
                         device_id=login.device_id, platform=login.platform)
            return None, (f"This device is already registered to {mask_email(claim.user.email)}. "
                          "Log in with that account, or contact the admin to create another one.")
        if not signup_allowed_from_ip(ip):
            record_login("signup", login.email or login.uid, False, "too many new accounts from this IP", ip=ip,
                         device_id=login.device_id, platform=login.platform)
            return None, "Too many new accounts were created from your network. Please try again later or contact the admin."
        first, _, last = (login.name or "").partition(" ")
        username = login.email or f"{provider}_{login.uid}"
        with transaction.atomic():
            user = User(username=username[:150], email=login.email, first_name=first[:150], last_name=last[:150])
            user.set_unusable_password()
            user.save()
            CustomerProfile.objects.create(user=user, notes=f"Created with {provider.title()} login.")
            if claim is None and kind != "web" and login.device_id:
                DeviceClaim.objects.create(device_id=login.device_id, kind=kind, name=login.device_name[:120],
                                           user=user, ip=ip)
            elif claim is not None:
                claim.user = user
                claim.save(update_fields=["user"])
        count_signup(ip)
    if not user.is_active:
        return None, "This account is disabled. Contact the admin."
    social, _ = SocialAccount.objects.get_or_create(provider=provider, uid=login.uid, defaults={"user": user})
    if social.user_id != user.pk:
        return None, "This Google / Facebook account is linked to another ICT Terminal account. Contact the admin."
    social.email, social.name, social.last_login = login.email, login.name[:150], timezone.now()
    social.save()
    trial_message = maybe_grant_trial(user, dev, provider, ip)
    token, raw = issue_token(user, dev)
    access, warning = access_for_token(token, ip=ip, **dev)
    record_login(provider, user.email or login.uid, True, warning, user=user, ip=ip,
                 device_id=login.device_id, platform=login.platform)
    return {"token": raw, "token_expires_at": token.expires_at.isoformat(),
            "account": {"email": user.email, "name": user.get_full_name()},
            "access": access, "warning": warning, "trial_message": trial_message}, ""


def login_methods():
    """What the login screens show (the server enforces the same switches)."""
    from . import oauth
    site = SiteSettings.load()
    return {"email_signup": site.allow_signup, "email_login": site.allow_email_login,
            "google": oauth.configured("google"), "facebook": oauth.configured("facebook"),
            "guest": site.guest_login_enabled and site.guest_plan_id is not None}


# ── Ads (Ad manager) ─────────────────────────────────────────────────────────
AD_PLACEMENTS = {"app_banner": "show_app_banner", "web_banner": "show_web_banner", "app_popup": "show_app_popup"}


def ads_eligible(user):
    """Ads go to users without an active plan (Settings: "Ads for users without a plan") and to
    users whose every active plan has "Show ads" ticked (free / trial). A paying VIP plan hides them."""
    site = SiteSettings.load()
    if not site.ads_enabled:
        return False
    if is_guest_user(user):
        plan = site.guest_plan
        return site.ads_for_free if plan is None else plan.show_ads
    subs = active_subscriptions(user) if user is not None else []
    if not subs:
        return site.ads_for_free
    return all(s.plan.show_ads for s in subs)


def ads_for(user, placement, base_url=""):
    """Running ads for one placement (highest priority first); each counts one impression."""
    from django.db.models import F

    from .models import Ad
    field = AD_PLACEMENTS.get(placement)
    if field is None or not ads_eligible(user):
        return []
    now = timezone.now()
    ads = list(Ad.objects.filter(is_active=True, starts_at__lte=now, **{field: True})
               .filter(Q(ends_at__isnull=True) | Q(ends_at__gt=now))[:5])
    if ads:
        Ad.objects.filter(pk__in=[a.pk for a in ads]).update(impressions=F("impressions") + 1)
    return [{"id": a.pk, "headline": a.headline, "text": a.text, "button_text": a.button_text,
             "image": f"{base_url}/api/v1/ads/{a.pk}/image" if a.image else "",
             "click_url": f"{base_url}/api/v1/ads/{a.pk}/click"} for a in ads]
